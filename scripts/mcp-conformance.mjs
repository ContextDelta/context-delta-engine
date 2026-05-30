#!/usr/bin/env node
// MCP multi-host conformance harness: drives the LIVE Context Delta MCP server
// over stdio JSON-RPC and asserts the protocol behaviors that real hosts
// (Claude Code, Cursor, Windsurf, GitHub Copilot / VS Code) depend on:
// the initialize handshake + version negotiation, ping liveness, tool and
// resource discovery shape, templates/prompts probes, tool invocation,
// MCP-correct tool-error semantics (isError, not a transport error), resource
// reads, and JSON-RPC error codes.
//
// It is host-agnostic by design: it speaks the wire protocol the hosts speak,
// so a green run is evidence the same calls those hosts make will succeed,
// without needing each proprietary client installed in CI.
//
// Run: npm run mcp:conformance   (exits non-zero on any failed check)

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanWorkspace, writeSnapshot } from "../packages/engine/src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpPath = path.join(repoRoot, "packages", "mcp-server", "bin", "context-delta-mcp.js");

const results = [];
function check(label, condition, detail = "") {
  const ok = Boolean(condition);
  results.push({ label, ok, detail });
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail && !ok ? ` -> ${detail}` : ""}`);
}

async function makeWorkspace() {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "cd-mcp-conf-"));
  const write = async (rel, content) => {
    const full = path.join(ws, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  };
  await write("src/auth/service.ts", "export function login(user: string) {\n  return `${user}:ok`;\n}\n");
  await write("tests/auth/service.test.ts", 'import { login } from "../../src/auth/service";\ntest("login", () => { expect(login("a")).toBe("a:ok"); });\n');
  await write("specs/login/spec.md", "# Login\n\n## Acceptance Criteria\n\n- Users can log in.\n");
  await write("AGENTS.md", "# Agent Instructions\n\nKeep auth changes small and covered by tests.\n");
  return ws;
}

// A flexible stdio client: it buffers every inbound message so we can match on
// id, wait for the next response, or assert silence (for notifications).
function startServer() {
  const server = spawn(process.execPath, [mcpPath], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "inherit"]
  });
  const inbox = [];
  const waiters = [];
  let buffer = "";

  server.stdout.on("data", (data) => {
    buffer += data;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      // Deliver to the first matching waiter; only buffer if nobody is waiting,
      // so a consumed response never lingers to spoof a later silence check.
      let consumed = false;
      for (let i = 0; i < waiters.length; i += 1) {
        if (waiters[i].predicate(message)) {
          clearTimeout(waiters[i].timer);
          waiters[i].resolve(message);
          waiters.splice(i, 1);
          consumed = true;
          break;
        }
      }
      if (!consumed) inbox.push(message);
    }
  });

  const nextMatching = (predicate, timeout = 15000) =>
    new Promise((resolve, reject) => {
      const existing = inbox.findIndex(predicate);
      if (existing >= 0) {
        resolve(inbox.splice(existing, 1)[0]);
        return;
      }
      const waiter = { predicate, resolve };
      waiter.timer = setTimeout(() => {
        const i = waiters.indexOf(waiter);
        if (i >= 0) waiters.splice(i, 1);
        reject(new Error("timeout waiting for response"));
      }, timeout);
      waiters.push(waiter);
    });

  let nextId = 1;
  const rpc = (method, params, { id = nextId++ } = {}) => {
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return nextMatching((m) => m.id === id);
  };
  const writeRaw = (line) => server.stdin.write(`${line}\n`);

  return { server, rpc, writeRaw, nextMatching };
}

async function main() {
  const ws = await makeWorkspace();
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), "cd-mcp-empty-"));
  const { server, rpc, writeRaw, nextMatching } = startServer();

  try {
    const scan = await scanWorkspace(ws);
    await writeSnapshot(ws, scan.files);
    await fs.appendFile(path.join(ws, "src/auth/service.ts"), "\nexport function logout() {\n  return true;\n}\n");

    console.log("\n# Initialize handshake + version negotiation");
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
    check("initialize returns serverInfo.name", init.result?.serverInfo?.name === "context-delta");
    check("initialize returns serverInfo.version", typeof init.result?.serverInfo?.version === "string");
    check("initialize advertises tools capability", typeof init.result?.capabilities?.tools === "object");
    check("initialize advertises resources capability", typeof init.result?.capabilities?.resources === "object");
    check("echoes a supported protocolVersion", init.result?.protocolVersion === "2025-06-18", init.result?.protocolVersion);

    const bogus = await rpc("initialize", { protocolVersion: "1999-01-01" });
    check("unsupported version negotiates to a real one", bogus.result?.protocolVersion === "2025-06-18", bogus.result?.protocolVersion);
    const noVersion = await rpc("initialize", {});
    check("missing version falls back to a default", typeof noVersion.result?.protocolVersion === "string", noVersion.result?.protocolVersion);

    console.log("\n# Notifications + liveness");
    // initialized is a notification (no id) -> the server must process it
    // silently and stay responsive. Assert silence, then prove liveness.
    writeRaw(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    let silent = false;
    try {
      await nextMatching(() => true, 300);
    } catch {
      silent = true;
    }
    check("notification produces no response", silent);
    const ping = await rpc("ping", {});
    check("ping returns an empty result", ping.result && Object.keys(ping.result).length === 0);

    console.log("\n# Tool discovery");
    const toolsList = await rpc("tools/list", {});
    const toolList = toolsList.result?.tools ?? [];
    check("tools/list returns a non-empty array", Array.isArray(toolList) && toolList.length > 0);
    check("every tool has a name + description", toolList.every((t) => t.name && t.description));
    check("every tool inputSchema is an object schema", toolList.every((t) => t.inputSchema?.type === "object"));
    check("primary prepare_context tool is present", toolList.some((t) => t.name === "prepare_context"));

    console.log("\n# Resource discovery + connect-time probes");
    const resList = await rpc("resources/list", {});
    const resources = resList.result?.resources ?? [];
    check("resources/list returns a non-empty array", Array.isArray(resources) && resources.length > 0);
    check("every resource has uri + name + mimeType", resources.every((r) => r.uri && r.name && r.mimeType));
    const templates = await rpc("resources/templates/list", {});
    check("resources/templates/list returns an array (no error)", Array.isArray(templates.result?.resourceTemplates));
    const prompts = await rpc("prompts/list", {});
    check("prompts/list returns an array (no error)", Array.isArray(prompts.result?.prompts));

    console.log("\n# Tool invocation");
    const prepared = await rpc("tools/call", {
      name: "prepare_context",
      arguments: { workspaceRoot: ws, task: "harden the login flow", writeOutputs: true }
    });
    check("prepare_context returns text content", prepared.result?.content?.[0]?.type === "text");
    check("prepare_context returns a risk header", /Context ready/.test(prepared.result?.structuredContent?.risk_header ?? ""));
    check("prepare_context is not flagged isError", prepared.result?.isError !== true);

    const handoff = await rpc("tools/call", { name: "render_context_handoff", arguments: { workspaceRoot: ws } });
    check("render_context_handoff returns non-empty text", (handoff.result?.content?.[0]?.text ?? "").length > 0);

    console.log("\n# MCP tool-error semantics (isError, not a transport error)");
    // A tool that fails at runtime must report it inside the result so the
    // agent can recover, never as a JSON-RPC error that hard-fails the host.
    const missing = await rpc("tools/call", { name: "explain_context_packet", arguments: { workspaceRoot: empty } });
    check("runtime tool error returns a result, not transport error", missing.result !== undefined && missing.error === undefined);
    check("runtime tool error sets isError:true", missing.result?.isError === true);
    const unknownTool = await rpc("tools/call", { name: "no_such_tool", arguments: {} });
    check("unknown tool returns isError result", unknownTool.result?.isError === true);

    console.log("\n# Resource reads");
    const current = await rpc("resources/read", {
      uri: "contextdelta://packet/current",
      arguments: { workspaceRoot: ws }
    });
    const currentContent = current.result?.contents?.[0];
    check("packet/current read returns contents with uri+mimeType+text", Boolean(currentContent?.uri && currentContent?.mimeType && currentContent?.text));
    check("packet/current text is valid JSON", isJson(currentContent?.text));
    const risk = await rpc("resources/read", { uri: "contextdelta://packet/risk", arguments: { workspaceRoot: ws } });
    check("packet/risk read is text/plain with a risk line", risk.result?.contents?.[0]?.mimeType === "text/plain" && /risk=/.test(risk.result?.contents?.[0]?.text ?? ""));

    console.log("\n# JSON-RPC error semantics");
    const unknownMethod = await rpc("no/such/method", {});
    check("unknown method returns -32601 (method not found)", unknownMethod.error?.code === -32601, JSON.stringify(unknownMethod.error));
    writeRaw("{ this is not valid json");
    const parseError = await nextMatching((m) => m.error?.code === -32700);
    check("malformed line returns -32700 (parse error)", parseError.error?.code === -32700);
    check("parse error response carries a null id", parseError.id === null);
    const zeroId = await rpc("ping", {}, { id: 0 });
    check("respects a request id of 0 (falsy-id edge case)", zeroId.id === 0 && zeroId.result !== undefined);
  } finally {
    server.kill();
    await fs.rm(ws, { recursive: true, force: true });
    await fs.rm(empty, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} conformance checks passed.`);
  if (failed.length) {
    console.log("FAILED:", failed.map((f) => f.label).join("; "));
    process.exit(1);
  }
  console.log("MCP conformance: all green.");
}

function isJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error("MCP conformance harness error:", error);
  process.exit(1);
});
