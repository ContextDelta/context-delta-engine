export function redactPacket(packet, config) {
  if (config.policy?.redactSecrets === false) {
    return {
      packet,
      redactions: {
        applied: 0,
        rules: []
      }
    };
  }

  const rules = compileRules(config.policy?.redactionPatterns ?? []);
  const cloned = JSON.parse(JSON.stringify(packet));
  let applied = 0;
  const appliedRules = new Set();

  for (const bucketName of [
    "changed_artifacts",
    "governing_constraints",
    "impacted_neighbors",
    "supporting_evidence"
  ]) {
    for (const item of cloned[bucketName] ?? []) {
      if (typeof item.content !== "string") continue;
      const result = redactText(item.content, rules);
      item.content = result.text;
      applied += result.applied;
      for (const ruleName of result.rules) appliedRules.add(ruleName);
    }
  }

  cloned.security = {
    ...(cloned.security ?? {}),
    redactions_applied: applied,
    redaction_rules: [...appliedRules].sort()
  };

  return {
    packet: cloned,
    redactions: cloned.security
  };
}

export function redactText(text, rules) {
  let output = text;
  let applied = 0;
  const appliedRules = new Set();

  for (const rule of rules) {
    output = output.replace(rule.regex, (match) => {
      applied += 1;
      appliedRules.add(rule.name);
      if (match.includes("=") || match.includes(":")) {
        const separator = match.includes("=") ? "=" : ":";
        const [key] = match.split(separator);
        return `${key}${separator}[REDACTED:${rule.name}]`;
      }
      return `[REDACTED:${rule.name}]`;
    });
  }

  return {
    applied,
    rules: [...appliedRules],
    text: output
  };
}

function compileRules(patterns) {
  return patterns
    .filter((rule) => rule?.name && rule?.pattern)
    .map((rule) => ({
      name: rule.name,
      regex: new RegExp(rule.pattern, "gi")
    }));
}

