// Spec Kit awareness: detect the .specify / specs/<NNN-feature> layout, decide
// which feature is the one being worked on right now, and treat the other
// features' specs as out of scope so the agent gets the current slice — not the
// whole accumulated spec pile.

const FEATURE_PATTERN = /(?:^|\/)specs\/([0-9]{1,4}[-_][A-Za-z0-9-_]+)(?:\/|$)/;

export function detectSpecKit(files, options = {}) {
  const branch = String(options.branch ?? "").toLowerCase();
  const task = String(options.task ?? "").toLowerCase();
  const changedPaths = options.changedPaths ?? new Set();
  const specFiles = files.filter((file) => file.kind === "spec");
  const hasSpecify = files.some((file) => /(?:^|\/)\.specify\//i.test(file.path));

  const features = new Map();
  for (const file of specFiles) {
    const match = file.path.match(FEATURE_PATTERN);
    if (!match) continue;
    const id = match[1].toLowerCase();
    const dir = file.path.slice(0, match.index + match[0].indexOf(id) + id.length);
    if (!features.has(id)) {
      features.set(id, { id, dir, files: [], mtimeMs: 0 });
    }
    const feature = features.get(id);
    feature.files.push(file.path);
    feature.mtimeMs = Math.max(feature.mtimeMs, file.mtimeMs ?? 0);
  }

  const featureList = [...features.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const constitution =
    specFiles.find(
      (file) => /constitution\.md$/i.test(file.path) && /(?:^|\/)memory\//i.test(file.path)
    )?.path ?? null;

  if (!hasSpecify && featureList.length === 0) {
    return { isSpecKit: false, hasSpecify: false, constitution: null, activeFeature: null, features: [] };
  }

  let active = null;
  let reason = null;
  const branchMatch =
    branch && featureList.find((feature) => branch.includes(feature.id) || feature.id.includes(branch));
  if (branchMatch) {
    active = branchMatch;
    reason = `git branch "${options.branch}"`;
  }
  if (!active && task) {
    // An explicit feature id in the task ("...for 004-admin-auth") is a strong,
    // user-stated signal — it outranks the changed-file and recency heuristics.
    const taskMatch = featureList.find((feature) => task.includes(feature.id));
    if (taskMatch) {
      active = taskMatch;
      reason = "feature named in the task";
    }
  }
  if (!active) {
    const changedFeature = featureList.find((feature) =>
      feature.files.some((filePath) => changedPaths.has(filePath))
    );
    if (changedFeature) {
      active = changedFeature;
      reason = "recent changes in this feature";
    }
  }
  if (!active && featureList.length) {
    active = featureList[0];
    reason = "most recently modified feature";
  }

  return {
    isSpecKit: true,
    hasSpecify,
    constitution,
    activeFeature: active
      ? { id: active.id, dir: active.dir, files: active.files, reason }
      : null,
    features: featureList.map((feature) => ({
      id: feature.id,
      dir: feature.dir,
      files: feature.files,
      active: Boolean(active && feature.id === active.id)
    }))
  };
}

// Returns the feature id that a given spec path belongs to, or null for
// top-level / non-feature specs (which are always kept).
function featureIdForPath(filePath) {
  const match = String(filePath ?? "").match(FEATURE_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

// Splits spec evidence into the active feature's sections (kept) and other
// features' sections (demoted to excluded as out of scope).
export function scopeSpecEvidence(specKit, supportingEvidence) {
  if (!specKit?.isSpecKit || !specKit.activeFeature || specKit.features.length <= 1) {
    return { kept: supportingEvidence, demoted: [] };
  }

  const activeId = specKit.activeFeature.id;
  const kept = [];
  const demoted = [];

  for (const item of supportingEvidence) {
    const isSpec = item.type === "spec_section" || item.kind === "spec";
    if (!isSpec) {
      kept.push(item);
      continue;
    }
    const featureId = featureIdForPath(item.path);
    if (featureId && featureId !== activeId) {
      demoted.push({
        kind: item.kind ?? "spec",
        path: item.path,
        reason: `Belongs to Spec Kit feature ${featureId}, not the active feature ${activeId}`,
        type: "stale_spec_feature"
      });
    } else {
      kept.push(item);
    }
  }

  return { kept, demoted };
}

export function buildSpecKitWarnings(specKit) {
  if (!specKit?.isSpecKit) return [];
  const warnings = [];
  const otherFeatures = specKit.features.filter((feature) => !feature.active);

  if (specKit.activeFeature && otherFeatures.length > 0) {
    warnings.push({
      type: "spec-kit-active-feature",
      message: `Active Spec Kit feature is ${specKit.activeFeature.id} (${specKit.activeFeature.reason}). ${otherFeatures.length} other feature spec(s) were treated as out of scope.`
    });
  }

  if (specKit.isSpecKit && !specKit.activeFeature) {
    warnings.push({
      type: "spec-kit-no-active-feature",
      message: "Spec Kit layout detected but no active feature could be determined; all specs were considered."
    });
  }

  return warnings;
}
