import fs from "node:fs/promises";
import path from "node:path";
import { normalizeRelativePath } from "../../shared/src/index.js";
import { DEFAULT_CONFIG, DEFAULT_CONFIG_FILE } from "./config.js";

export async function cleanupStaleControls(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const configPath = path.join(root, DEFAULT_CONFIG_FILE);
  let config = structuredClone(DEFAULT_CONFIG);

  try {
    config = {
      ...config,
      ...JSON.parse(await fs.readFile(configPath, "utf8"))
    };
  } catch {
    // If the config does not exist yet, write a cleaned default shape below.
  }

  config.controls = {
    exclude: normalizeControlList(config.controls?.exclude ?? []),
    pin: normalizeControlList(config.controls?.pin ?? [])
  };

  const cleaned = {
    exclude: [],
    pin: []
  };

  for (const control of ["exclude", "pin"]) {
    for (const value of config.controls[control]) {
      if (await controlPathExists(root, value)) {
        cleaned[control].push(value);
      }
    }
  }

  const removed = [
    ...config.controls.exclude.filter((item) => !cleaned.exclude.includes(item)),
    ...config.controls.pin.filter((item) => !cleaned.pin.includes(item))
  ];

  config.controls = cleaned;
  if (removed.length > 0) {
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  return {
    config_path: configPath,
    controls: cleaned,
    removed,
    removed_count: removed.length
  };
}

function normalizeControlList(values) {
  return [...new Set(values.filter(Boolean).map((value) => normalizeRelativePath(String(value))))];
}

async function controlPathExists(workspaceRoot, value) {
  if (!value || /[*?[\]{}]/.test(value)) return true;
  const normalized = value.replace(/\/+$/, "");
  if (!normalized) return true;
  try {
    await fs.access(path.join(workspaceRoot, normalized));
    return true;
  } catch {
    return false;
  }
}
