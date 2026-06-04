import fs from "node:fs/promises";
import path from "node:path";
import { normalizeRelativePath } from "../../shared/src/index.js";

export const DEFAULT_CONFIG_FILE = "contextdelta.config.json";

export const DEFAULT_CONFIG = {
  schema_version: "0.1",
  mode: "balanced",
  // Tokenizer target model for token-count estimates. null uses the modern
  // default (o200k_base, GPT-4o family). Set e.g. "gpt-4" for cl100k_base.
  targetModel: null,
  controls: {
    exclude: [],
    pin: []
  },
  limits: {
    changed: 12,
    excluded: 20,
    impacted: 12,
    instructions: 8,
    markdownSections: 10,
    snippetChars: 10000,
    targetTokens: 12000,
    tests: 8
  },
  baseline: {
    strategy: "naive_agent_context_model",
    openRecentFiles: 6,
    chatHistoryTokens: 2000,
    includeAllSpecs: true,
    includeAllInstructions: true
  },
  inject: {
    enabled: true,
    targets: [".github/copilot-instructions.md", "AGENTS.md"]
  },
  feedback: {
    enabled: true
  },
  contract: {
    require: []
  },
  policy: {
    maxDeliveredTokens: null,
    excludePaths: [
      ".env",
      ".env.*",
      "*.pem",
      "*.key",
      "*.p12",
      "*.pfx",
      "secrets/",
      ".contextdelta/cache/",
      ".contextdelta/index/",
      ".contextdelta/local/",
      ".contextdelta/packets/"
    ],
    redactSecrets: true,
    redactionPatterns: [
      {
        name: "openai_api_key",
        pattern: "sk-[A-Za-z0-9_-]{20,}"
      },
      {
        name: "generic_assignment_secret",
        pattern: "(api[_-]?key|secret|password)\\s*[:=]\\s*[^\\s'\\\"]+"
      },
      {
        name: "private_key_block",
        pattern: "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----"
      }
    ]
  },
  reports: {
    emitEvents: true,
    emitMetrics: true,
    emitPacketText: true
  }
};

export async function loadConfig(workspaceRoot, overrides = {}) {
  const configPath = overrides.configPath
    ? path.resolve(workspaceRoot, overrides.configPath)
    : path.join(workspaceRoot, DEFAULT_CONFIG_FILE);

  let fileConfig = {};
  try {
    fileConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch {
    fileConfig = {};
  }

  return normalizeConfig(mergeDeep(DEFAULT_CONFIG, fileConfig, overrides.inlineConfig ?? {}));
}

export async function writeDefaultConfig(workspaceRoot, options = {}) {
  const configPath = path.join(workspaceRoot, DEFAULT_CONFIG_FILE);
  if (!options.force) {
    try {
      await fs.access(configPath);
      return { created: false, path: configPath };
    } catch {
      // Continue and create the file.
    }
  }

  await fs.writeFile(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  return { created: true, path: configPath };
}

export function normalizeModeLimits(mode, limits) {
  if (mode === "conservative") {
    return {
      ...limits,
      changed: Math.max(limits.changed, 18),
      impacted: Math.max(limits.impacted, 18),
      markdownSections: Math.max(limits.markdownSections, 16),
      tests: Math.max(limits.tests, 12)
    };
  }

  if (mode === "strict") {
    return {
      ...limits,
      changed: Math.min(limits.changed, 8),
      impacted: Math.min(limits.impacted, 8),
      markdownSections: Math.min(limits.markdownSections, 8),
      snippetChars: Math.min(limits.snippetChars, 6000),
      targetTokens: Math.min(limits.targetTokens, 8000),
      tests: Math.min(limits.tests, 6)
    };
  }

  return limits;
}

export function isPathExcluded(relativePath, config) {
  const normalized = normalizeRelativePath(relativePath).toLowerCase();
  return [...(config.policy?.excludePaths ?? []), ...(config.controls?.exclude ?? [])].some(
    (pattern) => matchesPathPattern(normalized, pattern)
  );
}

export function matchesPathPattern(relativePath, pattern) {
  const normalizedPattern = normalizeRelativePath(String(pattern)).toLowerCase();
  const normalizedPath = normalizeRelativePath(relativePath).toLowerCase();

  if (!normalizedPattern) return false;
  if (normalizedPattern === normalizedPath) return true;

  if (normalizedPattern.endsWith("/")) {
    return normalizedPath.startsWith(normalizedPattern);
  }

  if (normalizedPattern.startsWith("*.")) {
    return normalizedPath.endsWith(normalizedPattern.slice(1));
  }

  if (normalizedPattern.includes("*")) {
    const escaped = normalizedPattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*");
    return new RegExp(`^${escaped}$`).test(normalizedPath);
  }

  return normalizedPath.includes(normalizedPattern);
}

function normalizeConfig(config) {
  const mode = ["balanced", "conservative", "strict"].includes(config.mode)
    ? config.mode
    : "balanced";
  const limits = normalizeModeLimits(mode, {
    ...DEFAULT_CONFIG.limits,
    ...(config.limits ?? {})
  });

  return {
    ...config,
    targetModel:
      typeof config.targetModel === "string" && config.targetModel.trim()
        ? config.targetModel.trim()
        : null,
    baseline: {
      ...DEFAULT_CONFIG.baseline,
      ...(config.baseline ?? {})
    },
    inject: {
      ...DEFAULT_CONFIG.inject,
      ...(config.inject ?? {})
    },
    controls: {
      exclude: uniquePaths(config.controls?.exclude ?? []),
      pin: uniquePaths(config.controls?.pin ?? [])
    },
    limits,
    mode,
    policy: {
      ...DEFAULT_CONFIG.policy,
      ...(config.policy ?? {}),
      excludePaths: uniquePaths([
        ...(DEFAULT_CONFIG.policy.excludePaths ?? []),
        ...(config.policy?.excludePaths ?? [])
      ]),
      redactionPatterns: [
        ...(DEFAULT_CONFIG.policy.redactionPatterns ?? []),
        ...(config.policy?.redactionPatterns ?? [])
      ]
    },
    reports: {
      ...DEFAULT_CONFIG.reports,
      ...(config.reports ?? {})
    }
  };
}

function uniquePaths(values) {
  return [...new Set(values.filter(Boolean).map((value) => normalizeRelativePath(String(value))))];
}

function mergeDeep(...objects) {
  const result = {};

  for (const object of objects) {
    for (const [key, value] of Object.entries(object ?? {})) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof result[key] === "object" &&
        !Array.isArray(result[key])
      ) {
        result[key] = mergeDeep(result[key], value);
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}
