#!/usr/bin/env node

import path from "node:path";
import { readFile } from "node:fs/promises";
import readline from "node:readline";
import {
  buildManagerSummary,
  buildPacketDiff,
  buildCompactPacketView,
  buildContextPacket,
  buildPacketInsights,
  getSetupStatus,
  getUniqueIncludedItems,
  inferWorkspaceIntent,
  listPacketHistory,
  readMetricsSummary,
  readPacketByIdOrPath,
  readPreviousPacket,
  renderReplayPrompt,
  renderContextDriftMarkdown,
  renderSetupMarkdown,
  renderRiskHeader,
  runPacketEval,
  renderHandoff,
  renderPacketDiffMarkdown,
  reviewContextDrift,
  scanWorkspace,
  writePacketApproval,
  writeManagerSummary,
  writeHtmlReport,
  writePacketAndMetrics
} from "../../engine/src/index.js";

const serverInfo = {
  name: "context-delta",
  version: "0.1.0"
};

const tools = [
  {
    name: "prepare_context",
    description:
      "Primary Context Delta tool. Call this before coding, reviewing, or debugging. It builds fresh local context and returns a prompt-ready handoff with a one-line risk header; prefer it over raw packet JSON unless the user asks to inspect details.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "The user's coding task. If omitted, Context Delta infers a broad task from the current git branch and changed paths."
        },
        workspaceRoot: {
          type: "string",
          description: "Optional workspace root. Defaults to process cwd or CONTEXT_DELTA_WORKSPACE."
        },
        format: {
          type: "string",
          enum: ["markdown", "copilot", "spec-kit"],
          description: "Prompt-ready handoff format. Defaults to markdown."
        },
        writeOutputs: {
          type: "boolean",
          description: "Write packet and metrics files under .contextdelta. Defaults to true."
        },
        mode: {
          type: "string",
          enum: ["balanced", "conservative", "strict"]
        },
        model: {
          type: "string",
          description:
            "Target model for token-count estimates (e.g. \"gpt-4o\", \"gpt-4\", \"gpt-5.1\"). Selects the matching tokenizer encoding. Omit to use the modern default (o200k_base)."
        },
        pin: {
          type: "array",
          items: { type: "string" },
          description:
            "Workspace-relative paths to force into the packet. Accepts files (e.g. \"src/auth/service.ts\") or directories (e.g. \"docs/site\"); a directory expands to the text files under it, capped to protect the token budget."
        },
        exclude: {
          type: "array",
          items: { type: "string" },
          description:
            "Workspace-relative file or directory paths to keep out of the packet (e.g. \"docs/\", \"tests/engine.test.js\")."
        }
      }
    }
  },
  {
    name: "check_context_setup",
    description:
      "Check whether Context Delta is ready in this workspace, including config, latest packet, VS Code extension, and MCP registration. Use this when the user asks why Context Delta is not working.",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["json", "markdown"]
        },
        workspaceRoot: {
          type: "string",
          description: "Optional workspace root. Defaults to process cwd or CONTEXT_DELTA_WORKSPACE."
        },
        target: {
          type: "string",
          enum: ["cli", "mcp", "vscode", "all"],
          description: "Which setup path to check. Defaults to all local integrations."
        }
      }
    }
  },
  {
    name: "review_context_drift",
    description:
      "Compare the latest packet with current git changes after agent work. Use this before final answers to spot files changed outside the prepared context.",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["json", "markdown"]
        },
        workspaceRoot: {
          type: "string",
          description: "Optional workspace root. Defaults to process cwd or CONTEXT_DELTA_WORKSPACE."
        }
      }
    }
  },
  {
    name: "get_context_packet",
    description:
      "Advanced/debug tool. Build and return the full Context Delta packet JSON for an AI coding task. Use prepare_context for normal agent work.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The coding task or user intent."
        },
        workspaceRoot: {
          type: "string",
          description: "Optional workspace root. Defaults to process cwd or CONTEXT_DELTA_WORKSPACE."
        },
        writeOutputs: {
          type: "boolean",
          description: "Write packet and metrics files under .contextdelta."
        },
        mode: {
          type: "string",
          enum: ["balanced", "conservative", "strict"]
        },
        model: {
          type: "string",
          description:
            "Target model for token-count estimates (e.g. \"gpt-4o\", \"gpt-4\", \"gpt-5.1\"). Selects the matching tokenizer encoding. Omit to use the modern default (o200k_base)."
        },
        pin: {
          type: "array",
          items: { type: "string" },
          description:
            "Workspace-relative paths to force into the packet. Accepts files (e.g. \"src/auth/service.ts\") or directories (e.g. \"docs/site\"); a directory expands to the text files under it, capped to protect the token budget."
        },
        exclude: {
          type: "array",
          items: { type: "string" },
          description:
            "Workspace-relative file or directory paths to keep out of the packet (e.g. \"docs/\", \"tests/engine.test.js\")."
        }
      },
      required: ["task"]
    }
  },
  {
    name: "explain_context_packet",
    description: "Read the latest packet and return the included/excluded reasons.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: {
          type: "string",
          description: "Optional workspace root."
        }
      }
    }
  },
  {
    name: "get_context_insights",
    description: "Read the latest packet and return quality signals, risks, and recommendations.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: {
          type: "string",
          description: "Optional workspace root."
        }
      }
    }
  },
  {
    name: "get_compact_context_packet",
    description: "Read the latest packet and return a content-free compact preview.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: {
          type: "string",
          description: "Optional workspace root."
        }
      }
    }
  },
  {
    name: "generate_context_report",
    description: "Generate an HTML report for the latest context packet.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: {
          type: "string",
          description: "Optional workspace root."
        }
      }
    }
  },
  {
    name: "get_context_history",
    description: "Read recent local Context Delta packet history.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum packet history entries to return."
        },
        workspaceRoot: {
          type: "string",
          description: "Optional workspace root."
        }
      }
    }
  },
  {
    name: "diff_context_packets",
    description: "Compare the latest context packet with the previous packet.",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["json", "markdown"]
        },
        from: {
          type: "string",
          description: "Optional previous packet id or filename."
        },
        to: {
          type: "string",
          description: "Optional current packet id or filename."
        },
        workspaceRoot: {
          type: "string",
          description: "Optional workspace root."
        }
      }
    }
  },
  {
    name: "render_context_handoff",
    description:
      "Render the latest packet as prompt-ready text for an AI coding agent. Use format 'incremental' on later turns to send only context that changed since the previous packet.",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["markdown", "copilot", "spec-kit", "incremental", "compact", "json"]
        },
        workspaceRoot: {
          type: "string",
          description: "Optional workspace root."
        }
      }
    }
  },
  {
    name: "generate_manager_summary",
    description: "Generate privacy-safe manager summary files and return aggregate metrics.",
    inputSchema: {
      type: "object",
      properties: {
        writeOutputs: {
          type: "boolean",
          description: "Write weekly-summary Markdown and JSON files."
        },
        workspaceRoot: {
          type: "string",
          description: "Optional workspace root."
        }
      }
    }
  },
  {
    name: "run_context_eval",
    description: "Score Context Delta packets against a local labeled gold set.",
    inputSchema: {
      type: "object",
      properties: {
        casesPath: {
          type: "string",
          description: "Optional eval gold-set path relative to workspace."
        },
        workspaceRoot: {
          type: "string",
          description: "Optional workspace root."
        },
        writeOutputs: {
          type: "boolean",
          description: "Write eval reports under .contextdelta/eval."
        }
      }
    }
  },
  {
    name: "approve_context_packet",
    description: "Record a local approval or needs-expansion decision for the latest packet.",
    inputSchema: {
      type: "object",
      properties: {
        decision: {
          type: "string",
          enum: ["approved", "needs-expansion", "failed"]
        },
        notes: {
          type: "string"
        },
        workspaceRoot: {
          type: "string",
          description: "Optional workspace root."
        }
      }
    }
  },
  {
    name: "render_context_replay",
    description: "Render a replay prompt for reviewing the latest packet against an agent result.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: {
          type: "string",
          description: "Optional workspace root."
        }
      }
    }
  },
  {
    name: "scan_workspace",
    description: "Scan and classify files in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: {
          type: "string",
          description: "Optional workspace root."
        }
      }
    }
  },
  {
    name: "get_context_metrics",
    description:
      "Read the local Context Delta metrics rollup. Optionally window it with `since` (ISO date) or `limit` (most recent N sessions) so it reflects current behavior instead of all history.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: {
          type: "string",
          description: "Optional workspace root."
        },
        since: {
          type: "string",
          description: "Only include sessions at or after this ISO date/time."
        },
        limit: {
          type: "number",
          description: "Only include the most recent N sessions."
        }
      }
    }
  }
];

const resources = [
  {
    name: "Current Context Packet",
    uri: "contextdelta://packet/current",
    description: "Latest Context Delta packet JSON for the workspace.",
    mimeType: "application/json"
  },
  {
    name: "Context Metrics",
    uri: "contextdelta://metrics/session",
    description: "Privacy-safe local Context Delta metrics summary.",
    mimeType: "application/json"
  },
  {
    name: "Context Packet Insights",
    uri: "contextdelta://packet/insights",
    description: "Risk, quality signals, and recommendations for the latest packet.",
    mimeType: "application/json"
  },
  {
    name: "Compact Context Packet",
    uri: "contextdelta://packet/compact",
    description: "Content-free latest packet preview for review and dashboards.",
    mimeType: "application/json"
  },
  {
    name: "Context Risk Header",
    uri: "contextdelta://packet/risk",
    description: "One-line readiness, risk, budget, and warning summary for the latest packet.",
    mimeType: "text/plain"
  },
  {
    name: "Context Drift Review",
    uri: "contextdelta://packet/drift",
    description: "Current changed files compared with the latest context packet.",
    mimeType: "application/json"
  },
  {
    name: "Context Setup Status",
    uri: "contextdelta://setup/status",
    description: "First-run readiness checks for Context Delta, VS Code, and MCP.",
    mimeType: "application/json"
  },
  {
    name: "Latest HTML Report Path",
    uri: "contextdelta://report/latest",
    description: "Path to the latest local Context Delta HTML report.",
    mimeType: "application/json"
  },
  {
    name: "Latest Packet Diff",
    uri: "contextdelta://packet/diff",
    description: "Previous vs current packet diff.",
    mimeType: "application/json"
  },
  {
    name: "Markdown Handoff",
    uri: "contextdelta://handoff/markdown",
    description: "Prompt-ready Markdown handoff for the latest packet.",
    mimeType: "text/markdown"
  },
  {
    name: "Manager Summary",
    uri: "contextdelta://metrics/manager-summary",
    description: "Privacy-safe manager summary for the local workspace.",
    mimeType: "application/json"
  },
  {
    name: "Packet Replay Prompt",
    uri: "contextdelta://packet/replay",
    description: "Replay prompt for reviewing an agent output against the latest packet.",
    mimeType: "text/markdown"
  }
];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on("line", async (line) => {
  if (!line.trim()) return;

  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    writeResponse(null, null, {
      code: -32700,
      message: `Parse error: ${error.message}`
    });
    return;
  }

  if (!("id" in message)) return;

  try {
    const result = await handleRequest(message);
    writeResponse(message.id, result);
  } catch (error) {
    writeResponse(message.id, null, {
      code: -32000,
      message: error.message
    });
  }
});

async function handleRequest(message) {
  if (message.method === "initialize") {
    return {
      capabilities: {
        resources: {},
        tools: {}
      },
      protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
      serverInfo
    };
  }

  if (message.method === "tools/list") {
    return { tools };
  }

  if (message.method === "tools/call") {
    return callTool(message.params?.name, message.params?.arguments ?? {});
  }

  if (message.method === "resources/list") {
    return { resources };
  }

  if (message.method === "resources/read") {
    return readResource(message.params?.uri, message.params?.arguments ?? {});
  }

  throw new Error(`Unsupported method: ${message.method}`);
}

async function callTool(name, args) {
  if (name === "prepare_context") {
    const workspaceRoot = resolveWorkspace(args.workspaceRoot);
    const task = String(args.task ?? "").trim() || (await inferWorkspaceIntent(workspaceRoot));
    const { packet } = await buildContextPacket({
      exclude: args.exclude ?? [],
      mode: args.mode,
      model: args.model,
      pin: args.pin ?? [],
      target: "mcp-prepare-context",
      task,
      updateSnapshot: args.writeOutputs !== false,
      workspaceRoot
    });

    let outputPaths = null;
    if (args.writeOutputs !== false) {
      outputPaths = await writePacketAndMetrics(workspaceRoot, packet);
    }

    const format = args.format ?? "markdown";
    const riskHeader = renderRiskHeader(packet);
    const handoff = renderHandoff(packet, { format });

    return {
      content: [
        {
          type: "text",
          text: [
            "# Context Delta Prepared Context",
            "",
            riskHeader,
            "",
            "Use the handoff below as the focused working context. Do not ask the user to inspect the packet unless the risk header or task result requires it.",
            "",
            handoff
          ].join("\n")
        }
      ],
      structuredContent: {
        format,
        inferred_task: !String(args.task ?? "").trim(),
        output_paths: outputPaths,
        packet_id: packet.id,
        risk_header: riskHeader,
        task
      }
    };
  }

  if (name === "check_context_setup") {
    const status = await getSetupStatus(resolveWorkspace(args.workspaceRoot), {
      target: args.target
    });
    if (args.format === "markdown") {
      return {
        content: [
          {
            type: "text",
            text: renderSetupMarkdown(status)
          }
        ],
        structuredContent: status
      };
    }
    return toolText(status);
  }

  if (name === "review_context_drift") {
    const review = await reviewContextDrift(resolveWorkspace(args.workspaceRoot));
    if (args.format === "markdown") {
      return {
        content: [
          {
            type: "text",
            text: renderContextDriftMarkdown(review)
          }
        ],
        structuredContent: review
      };
    }
    return toolText(review);
  }

  if (name === "get_context_packet") {
    const workspaceRoot = resolveWorkspace(args.workspaceRoot);
    const { packet } = await buildContextPacket({
      exclude: args.exclude ?? [],
      mode: args.mode,
      model: args.model,
      pin: args.pin ?? [],
      task: args.task,
      updateSnapshot: args.writeOutputs === true,
      workspaceRoot
    });

    let outputPaths = null;
    if (args.writeOutputs === true) {
      outputPaths = await writePacketAndMetrics(workspaceRoot, packet);
    }

    return toolText({
      output_paths: outputPaths,
      packet
    });
  }

  if (name === "explain_context_packet") {
    const workspaceRoot = resolveWorkspace(args.workspaceRoot);
    const packet = await readLatestPacket(workspaceRoot);
    return toolText({
      excluded: packet.excluded.map((item) => ({
        path: item.path,
        reason: item.reason
      })),
      included: getUniqueIncludedItems(packet).map((item) => ({
        heading: item.heading,
        path: item.path,
        reason: item.reason,
        type: item.type
      })),
      packet_id: packet.id,
      summary: packet.summary,
      warnings: packet.warnings
    });
  }

  if (name === "get_context_insights") {
    const workspaceRoot = resolveWorkspace(args.workspaceRoot);
    const packet = await readLatestPacket(workspaceRoot);
    return toolText({
      packet_id: packet.id,
      insights: packet.insights ?? buildPacketInsights(packet)
    });
  }

  if (name === "get_compact_context_packet") {
    const workspaceRoot = resolveWorkspace(args.workspaceRoot);
    const packet = await readLatestPacket(workspaceRoot);
    return toolText(packet.compact_view ?? buildCompactPacketView(packet));
  }

  if (name === "generate_context_report") {
    const workspaceRoot = resolveWorkspace(args.workspaceRoot);
    const packet = await readLatestPacket(workspaceRoot);
    const reportPath = await writeHtmlReport(workspaceRoot, packet);
    return toolText({ report_path: reportPath });
  }

  if (name === "get_context_history") {
    const workspaceRoot = resolveWorkspace(args.workspaceRoot);
    return toolText({
      history: await listPacketHistory(workspaceRoot, { limit: args.limit ?? 20 })
    });
  }

  if (name === "diff_context_packets") {
    const workspaceRoot = resolveWorkspace(args.workspaceRoot);
    const current = args.to
      ? await readPacketByIdOrPath(workspaceRoot, args.to)
      : await readLatestPacket(workspaceRoot);
    const previous = args.from
      ? await readPacketByIdOrPath(workspaceRoot, args.from)
      : await readPreviousPacket(workspaceRoot, current.id);
    if (!previous) throw new Error("No previous packet found to diff against.");
    const diff = buildPacketDiff(previous, current);
    if (args.format === "markdown") return toolText({ markdown: renderPacketDiffMarkdown(diff) });
    return toolText(diff);
  }

  if (name === "render_context_handoff") {
    const workspaceRoot = resolveWorkspace(args.workspaceRoot);
    const packet = await readLatestPacket(workspaceRoot);
    const format = args.format ?? "markdown";
    const renderOptions = { format };
    if (format === "incremental" || format === "delta") {
      renderOptions.previousPacket = await readPreviousPacket(workspaceRoot, packet.id);
    }
    return {
      content: [
        {
          type: "text",
          text: renderHandoff(packet, renderOptions)
        }
      ]
    };
  }

  if (name === "generate_manager_summary") {
    const workspaceRoot = resolveWorkspace(args.workspaceRoot);
    if (args.writeOutputs === true) {
      return toolText(await writeManagerSummary(workspaceRoot));
    }
    return toolText(await buildManagerSummary(workspaceRoot));
  }

  if (name === "run_context_eval") {
    const workspaceRoot = resolveWorkspace(args.workspaceRoot);
    return toolText(
      await runPacketEval(workspaceRoot, {
        casesPath: args.casesPath,
        writeOutputs: args.writeOutputs === true
      })
    );
  }

  if (name === "approve_context_packet") {
    const workspaceRoot = resolveWorkspace(args.workspaceRoot);
    const packet = await readLatestPacket(workspaceRoot);
    return toolText(
      await writePacketApproval(workspaceRoot, packet, {
        decision: args.decision ?? "approved",
        notes: args.notes ?? ""
      })
    );
  }

  if (name === "render_context_replay") {
    const packet = await readLatestPacket(resolveWorkspace(args.workspaceRoot));
    return {
      content: [
        {
          type: "text",
          text: renderReplayPrompt(packet)
        }
      ]
    };
  }

  if (name === "scan_workspace") {
    const scan = await scanWorkspace(resolveWorkspace(args.workspaceRoot));
    return toolText({
      files: scan.files.map((file) => ({
        kind: file.kind,
        path: file.path,
        size: file.size
      })),
      ignored: scan.ignored,
      root: scan.root
    });
  }

  if (name === "get_context_metrics") {
    const metrics = await readMetricsSummary(resolveWorkspace(args.workspaceRoot), {
      since: args.since,
      limit: args.limit
    });
    return toolText(metrics);
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function readResource(uri, args) {
  const workspaceRoot = resolveWorkspace(args.workspaceRoot);

  if (uri === "contextdelta://packet/current") {
    const packet = await readLatestPacket(workspaceRoot);
    return resourceText(uri, JSON.stringify(packet, null, 2), "application/json");
  }

  if (uri === "contextdelta://metrics/session") {
    const metrics = await readMetricsSummary(workspaceRoot);
    return resourceText(uri, JSON.stringify(metrics, null, 2), "application/json");
  }

  if (uri === "contextdelta://packet/insights") {
    const packet = await readLatestPacket(workspaceRoot);
    return resourceText(
      uri,
      JSON.stringify(packet.insights ?? buildPacketInsights(packet), null, 2),
      "application/json"
    );
  }

  if (uri === "contextdelta://packet/compact") {
    const packet = await readLatestPacket(workspaceRoot);
    return resourceText(
      uri,
      JSON.stringify(packet.compact_view ?? buildCompactPacketView(packet), null, 2),
      "application/json"
    );
  }

  if (uri === "contextdelta://packet/risk") {
    const packet = await readLatestPacket(workspaceRoot);
    return resourceText(uri, renderRiskHeader(packet), "text/plain");
  }

  if (uri === "contextdelta://packet/drift") {
    const review = await reviewContextDrift(workspaceRoot);
    return resourceText(uri, JSON.stringify(review, null, 2), "application/json");
  }

  if (uri === "contextdelta://setup/status") {
    const status = await getSetupStatus(workspaceRoot);
    return resourceText(uri, JSON.stringify(status, null, 2), "application/json");
  }

  if (uri === "contextdelta://report/latest") {
    const packet = await readLatestPacket(workspaceRoot);
    const reportPath = await writeHtmlReport(workspaceRoot, packet);
    return resourceText(uri, JSON.stringify({ report_path: reportPath }, null, 2), "application/json");
  }

  if (uri === "contextdelta://packet/diff") {
    const current = await readLatestPacket(workspaceRoot);
    const previous = await readPreviousPacket(workspaceRoot, current.id);
    if (!previous) throw new Error("No previous packet found to diff against.");
    return resourceText(uri, JSON.stringify(buildPacketDiff(previous, current), null, 2), "application/json");
  }

  if (uri === "contextdelta://handoff/markdown") {
    const packet = await readLatestPacket(workspaceRoot);
    return resourceText(uri, renderHandoff(packet, { format: "markdown" }), "text/markdown");
  }

  if (uri === "contextdelta://metrics/manager-summary") {
    const summary = await buildManagerSummary(workspaceRoot);
    return resourceText(uri, JSON.stringify(summary, null, 2), "application/json");
  }

  if (uri === "contextdelta://packet/replay") {
    const packet = await readLatestPacket(workspaceRoot);
    return resourceText(uri, renderReplayPrompt(packet), "text/markdown");
  }

  throw new Error(`Unknown resource: ${uri}`);
}

async function readLatestPacket(workspaceRoot) {
  const packetPath = path.join(workspaceRoot, ".contextdelta", "packets", "latest.json");
  return JSON.parse(await readFile(packetPath, "utf8"));
}

function resolveWorkspace(value) {
  return path.resolve(value ?? process.env.CONTEXT_DELTA_WORKSPACE ?? process.cwd());
}

function toolText(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function resourceText(uri, text, mimeType) {
  return {
    contents: [
      {
        mimeType,
        text,
        uri
      }
    ]
  };
}

function writeResponse(id, result, error) {
  const response = {
    id,
    jsonrpc: "2.0"
  };

  if (error) response.error = error;
  else response.result = result;

  process.stdout.write(`${JSON.stringify(response)}\n`);
}
