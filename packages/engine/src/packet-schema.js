// The Context Delta packet contract, enforced in code (dependency-free) so the
// package's structure can't drift unnoticed and any consumer — ours or a third
// party — can rely on it. The published JSON Schema in docs/packet.schema.json
// mirrors this for external tooling; this module is the authoritative check used
// by tests and `npm run validate:packet`.

const TOP_LEVEL = {
  budget: "object",
  changed_artifacts: "array",
  compliance: "object",
  controls: "object",
  created_at: "string",
  delivery: "object",
  excluded: "array",
  governing_constraints: "array",
  id: "string",
  impacted_neighbors: "array",
  intent: "object",
  metrics: "object",
  schema_version: "string",
  summary: "object",
  supporting_evidence: "array",
  warnings: "array",
  workspace: "object"
};

const NESTED = {
  "budget.target_tokens": "number",
  "budget.pressure": "string",
  "intent.task": "string",
  "intent.keywords": "array",
  "metrics.delivered_tokens_estimate": "number",
  "metrics.baseline_tokens_estimate": "number",
  "metrics.context_reduction_percent": "number",
  "metrics.packet_tokens_estimate": "number",
  "metrics.token_count_method": "string",
  "summary.included_files_count": "number",
  "summary.excluded_files_count": "number",
  "compliance.within_token_ceiling": "boolean",
  "compliance.violations": "array",
  "workspace.root": "string"
};

const ITEM_ARRAYS = ["changed_artifacts", "supporting_evidence", "governing_constraints", "impacted_neighbors"];

function typeOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function get(object, dottedPath) {
  return dottedPath.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), object);
}

export function validatePacket(packet) {
  const errors = [];
  if (typeOf(packet) !== "object") {
    return { errors: ["packet is not an object"], valid: false };
  }

  for (const [key, expected] of Object.entries(TOP_LEVEL)) {
    if (!(key in packet)) {
      errors.push(`missing required field: ${key}`);
    } else if (typeOf(packet[key]) !== expected) {
      errors.push(`field ${key} should be ${expected}, got ${typeOf(packet[key])}`);
    }
  }

  for (const [dotted, expected] of Object.entries(NESTED)) {
    const value = get(packet, dotted);
    if (value === undefined) {
      errors.push(`missing required field: ${dotted}`);
    } else if (typeOf(value) !== expected) {
      errors.push(`field ${dotted} should be ${expected}, got ${typeOf(value)}`);
    }
  }

  // Every delivered/excluded item must be an object with a string `type`, and a
  // string `path` or `heading` so it can be identified and de-duplicated.
  for (const arrayKey of ITEM_ARRAYS) {
    const items = Array.isArray(packet[arrayKey]) ? packet[arrayKey] : [];
    items.forEach((item, index) => {
      if (typeOf(item) !== "object") {
        errors.push(`${arrayKey}[${index}] is not an object`);
        return;
      }
      if (typeof item.type !== "string" || item.type.length === 0) {
        errors.push(`${arrayKey}[${index}] is missing a string "type"`);
      }
      if (typeof item.path !== "string" && typeof item.heading !== "string") {
        errors.push(`${arrayKey}[${index}] needs a string "path" or "heading"`);
      }
    });
  }

  for (const [index, item] of (packet.excluded ?? []).entries()) {
    if (typeOf(item) !== "object" || typeof item.path !== "string") {
      errors.push(`excluded[${index}] needs a string "path"`);
    }
  }

  // Internal consistency: a packet must never claim to deliver more than its
  // own baseline, and reduction must be a sane percentage.
  const m = packet.metrics ?? {};
  if (Number.isFinite(m.delivered_tokens_estimate) && Number.isFinite(m.baseline_tokens_estimate)) {
    if (m.delivered_tokens_estimate > m.baseline_tokens_estimate) {
      errors.push("metrics.delivered_tokens_estimate exceeds baseline_tokens_estimate");
    }
  }
  if (Number.isFinite(m.context_reduction_percent) && (m.context_reduction_percent < 0 || m.context_reduction_percent > 100)) {
    errors.push("metrics.context_reduction_percent out of range [0,100]");
  }

  return { errors, valid: errors.length === 0 };
}
