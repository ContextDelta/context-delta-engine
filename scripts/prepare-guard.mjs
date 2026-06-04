#!/usr/bin/env node
// Guards the npm "prepare" lifecycle. npm runs a script named `prepare`
// automatically on install / ci / publish, which would otherwise trigger a full
// Context Delta packet build at install time (and during publish). We only want
// the CLI to run when a user explicitly types `npm run prepare`, so we
// distinguish explicit runs (npm_command = run-script/run/exec) from lifecycle
// invocations and no-op on the latter. Keeps `npm run prepare -- "task"`
// working with no documentation changes.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const explicit = ["run-script", "run", "exec"].includes(process.env.npm_command ?? "");
if (!explicit) {
  process.exit(0);
}

const cli = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "cli",
  "bin",
  "context-delta.js"
);
const result = spawnSync(process.execPath, [cli, "prepare", ...process.argv.slice(2)], {
  stdio: "inherit"
});
process.exit(result.status ?? 0);
