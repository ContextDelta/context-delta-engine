import fs from "node:fs/promises";
import path from "node:path";
import { nowIso } from "../../shared/src/index.js";

export async function writeEvent(workspaceRoot, type, payload = {}) {
  const reportsDir = path.join(workspaceRoot, ".contextdelta", "reports");
  const eventsPath = path.join(reportsDir, "events.jsonl");
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.appendFile(
    eventsPath,
    `${JSON.stringify({
      payload,
      timestamp: nowIso(),
      type
    })}\n`
  );
  return eventsPath;
}

