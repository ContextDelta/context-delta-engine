import fs from "node:fs/promises";
import path from "node:path";
import { buildCompactPacketView } from "./insights.js";

export async function listPacketHistory(workspaceRoot, options = {}) {
  const limit = options.limit ?? 20;
  const packetDir = path.join(workspaceRoot, ".contextdelta", "packets");

  let entries;
  try {
    entries = await fs.readdir(packetDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const packets = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "latest.json") continue;
    if (entry.name === "latest-diff.json") continue;

    const packetPath = path.join(packetDir, entry.name);
    try {
      const stat = await fs.stat(packetPath);
      const packet = JSON.parse(await fs.readFile(packetPath, "utf8"));
      packets.push({
        created_at: packet.created_at,
        id: packet.id,
        metrics: packet.metrics,
        path: packetPath,
        relative_path: path.relative(workspaceRoot, packetPath),
        risk_level: packet.insights?.risk_level ?? "unknown",
        stat_mtime_ms: stat.mtimeMs,
        summary: packet.summary,
        task: packet.intent?.task ?? ""
      });
    } catch {
      // Ignore malformed historical packet files.
    }
  }

  return packets
    .sort((left, right) => getPacketSortTime(right) - getPacketSortTime(left))
    .slice(0, limit);
}

export async function readLatestPacket(workspaceRoot) {
  const packetPath = path.join(workspaceRoot, ".contextdelta", "packets", "latest.json");
  return JSON.parse(await fs.readFile(packetPath, "utf8"));
}

export async function readPacketByIdOrPath(workspaceRoot, value) {
  if (!value || value === "latest") {
    return readLatestPacket(workspaceRoot);
  }

  const directPath = path.isAbsolute(value)
    ? value
    : path.join(workspaceRoot, ".contextdelta", "packets", value.endsWith(".json") ? value : `${value}.json`);

  try {
    return JSON.parse(await fs.readFile(directPath, "utf8"));
  } catch {
    // Fall through and try matching by packet id.
  }

  const packetDir = path.join(workspaceRoot, ".contextdelta", "packets");
  const entries = await fs.readdir(packetDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "latest-diff.json") continue;
    const packet = JSON.parse(await fs.readFile(path.join(packetDir, entry.name), "utf8"));
    if (packet.id === value) return packet;
  }

  throw new Error(`Could not find packet '${value}'.`);
}

export async function readPreviousPacket(workspaceRoot, currentPacketId) {
  const history = await listPacketHistory(workspaceRoot, { limit: 50 });
  if (!history.length) return null;

  if (!currentPacketId) {
    const latest = await safeReadLatestPacket(workspaceRoot);
    currentPacketId = latest?.id;
  }

  const currentIndex = history.findIndex((packet) => packet.id === currentPacketId);
  const previousMeta = currentIndex >= 0 ? history[currentIndex + 1] : history[0];
  if (!previousMeta) return null;

  return JSON.parse(await fs.readFile(previousMeta.path, "utf8"));
}

export function buildPacketDiff(previousPacket, currentPacket) {
  const previousIncluded = mapItems(getComparableIncluded(previousPacket));
  const currentIncluded = mapItems(getComparableIncluded(currentPacket));
  const previousWarnings = mapWarnings(previousPacket.warnings ?? []);
  const currentWarnings = mapWarnings(currentPacket.warnings ?? []);

  const added = [];
  const removed = [];
  const retained = [];

  for (const [key, item] of currentIncluded) {
    if (previousIncluded.has(key)) retained.push(item);
    else added.push(item);
  }

  for (const [key, item] of previousIncluded) {
    if (!currentIncluded.has(key)) removed.push(item);
  }

  return {
    added,
    budget_pressure_delta: {
      current: currentPacket.budget?.pressure ?? "unknown",
      previous: previousPacket.budget?.pressure ?? "unknown"
    },
    current_packet_id: currentPacket.id,
    metrics_delta: {
      context_reduction_percent: deltaNumber(
        previousPacket.metrics?.context_reduction_percent,
        currentPacket.metrics?.context_reduction_percent
      ),
      packet_tokens_estimate: deltaNumber(
        previousPacket.metrics?.packet_tokens_estimate,
        currentPacket.metrics?.packet_tokens_estimate
      ),
      tokens_saved_estimate: deltaNumber(
        previousPacket.metrics?.tokens_saved_estimate,
        currentPacket.metrics?.tokens_saved_estimate
      )
    },
    previous_packet_id: previousPacket.id,
    removed,
    retained_count: retained.length,
    risk_delta: {
      current: currentPacket.insights?.risk_level ?? "unknown",
      previous: previousPacket.insights?.risk_level ?? "unknown"
    },
    summary: {
      added_count: added.length,
      current_included_count: currentIncluded.size,
      previous_included_count: previousIncluded.size,
      removed_count: removed.length,
      warning_added_count: countNewKeys(previousWarnings, currentWarnings),
      warning_removed_count: countNewKeys(currentWarnings, previousWarnings)
    },
    task_delta: {
      current: currentPacket.intent?.task ?? "",
      previous: previousPacket.intent?.task ?? ""
    },
    warning_changes: {
      added: [...currentWarnings.entries()]
        .filter(([key]) => !previousWarnings.has(key))
        .map(([, warning]) => warning),
      removed: [...previousWarnings.entries()]
        .filter(([key]) => !currentWarnings.has(key))
        .map(([, warning]) => warning)
    }
  };
}

export function renderPacketDiffMarkdown(diff) {
  return [
    "# Context Delta Packet Diff",
    "",
    `Previous: ${diff.previous_packet_id}`,
    `Current: ${diff.current_packet_id}`,
    "",
    "## Summary",
    "",
    `- Added context: ${diff.summary.added_count}`,
    `- Removed context: ${diff.summary.removed_count}`,
    `- Retained context: ${diff.retained_count}`,
    `- Risk: ${diff.risk_delta.previous} -> ${diff.risk_delta.current}`,
    `- Budget: ${diff.budget_pressure_delta.previous} -> ${diff.budget_pressure_delta.current}`,
    `- Packet tokens delta: ${formatDelta(diff.metrics_delta.packet_tokens_estimate)}`,
    `- Tokens saved delta: ${formatDelta(diff.metrics_delta.tokens_saved_estimate)}`,
    "",
    "## Added",
    "",
    ...renderItems(diff.added),
    "",
    "## Removed",
    "",
    ...renderItems(diff.removed),
    "",
    "## Warning Changes",
    "",
    ...renderWarnings(diff.warning_changes)
  ].join("\n");
}

async function safeReadLatestPacket(workspaceRoot) {
  try {
    return await readLatestPacket(workspaceRoot);
  } catch {
    return null;
  }
}

function getComparableIncluded(packet) {
  const view = packet.compact_view ?? buildCompactPacketView(packet);
  return view.included ?? [];
}

function mapItems(items) {
  return new Map(items.map((item) => [itemKey(item), item]));
}

function mapWarnings(warnings) {
  return new Map(warnings.map((warning) => [warningKey(warning), warning]));
}

function itemKey(item) {
  return [
    item.type ?? item.kind ?? "context",
    item.path ?? "unknown",
    item.heading ?? item.line_start ?? ""
  ].join(":");
}

function warningKey(warning) {
  return [warning.type ?? "warning", warning.message ?? ""].join(":");
}

function deltaNumber(previous, current) {
  const before = Number(previous ?? 0);
  const after = Number(current ?? 0);
  return {
    current: after,
    delta: Number((after - before).toFixed(1)),
    previous: before
  };
}

function countNewKeys(previousMap, currentMap) {
  return [...currentMap.keys()].filter((key) => !previousMap.has(key)).length;
}

function getPacketSortTime(packet) {
  const parsed = Date.parse(packet.created_at ?? "");
  return Number.isFinite(parsed) ? parsed : packet.stat_mtime_ms ?? 0;
}

function renderItems(items) {
  if (!items.length) return ["No changes."];
  return items.map((item) => {
    const heading = item.heading ? `#${item.heading}` : "";
    return `- ${item.path ?? "unknown"}${heading} (${item.type ?? item.kind ?? "context"}) - ${item.reason ?? ""}`;
  });
}

function renderWarnings(changes) {
  const lines = [];
  if (changes.added.length) {
    lines.push("Added warnings:");
    lines.push(...changes.added.map((warning) => `- ${warning.type}: ${warning.message}`));
  }
  if (changes.removed.length) {
    lines.push("Removed warnings:");
    lines.push(...changes.removed.map((warning) => `- ${warning.type}: ${warning.message}`));
  }
  return lines.length ? lines : ["No warning changes."];
}

function formatDelta(value) {
  if (!value) return "0";
  return value.delta > 0 ? `+${value.delta}` : String(value.delta);
}
