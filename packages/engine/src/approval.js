import fs from "node:fs/promises";
import path from "node:path";
import { nowIso } from "../../shared/src/index.js";
import { buildCompactPacketView } from "./insights.js";
import { writeEvent } from "./observability.js";

export async function writePacketApproval(workspaceRoot, packet, options = {}) {
  const approvalDir = path.join(workspaceRoot, ".contextdelta", "approvals");
  const decision = options.decision ?? "approved";
  const approval = {
    created_at: nowIso(),
    decision,
    notes: options.notes ?? "",
    packet_id: packet.id,
    packet_summary: {
      budget_pressure: packet.budget?.pressure ?? "unknown",
      included_files_count: packet.summary?.included_files_count ?? 0,
      risk_level: packet.insights?.risk_level ?? "unknown",
      warnings_count: packet.warnings?.length ?? 0
    },
    reviewer: options.reviewer ?? "local-user"
  };
  const timestamp = approval.created_at.replace(/[:.]/g, "-");
  const approvalPath = path.join(approvalDir, `${timestamp}-${packet.id}.json`);
  const latestPath = path.join(approvalDir, "latest.json");

  await fs.mkdir(approvalDir, { recursive: true });
  await fs.writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`);
  await fs.writeFile(latestPath, `${JSON.stringify(approval, null, 2)}\n`);
  await writeEvent(workspaceRoot, "packet_approval_written", {
    decision,
    packet_id: packet.id
  });

  return {
    approval,
    approvalPath,
    latestPath
  };
}

export function renderReplayPrompt(packet) {
  return [
    "# Context Delta Replay",
    "",
    "Use this as a replay artifact for reviewing an AI coding result against the exact packet that was available.",
    "",
    JSON.stringify(packet.compact_view ?? buildCompactPacketView(packet), null, 2),
    "",
    "## Replay Questions",
    "",
    "- Did the agent use the included changed files, specs, tests, and instructions?",
    "- Did the agent need a file that was omitted from the packet?",
    "- Were any excluded files actually required?",
    "- Should this packet be marked approved, needs-expansion, or failed?",
    ""
  ].join("\n");
}
