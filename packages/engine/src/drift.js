import { loadConfig } from "./config.js";
import { recordFeedback } from "./feedback.js";
import { getGitState } from "./git.js";
import { readLatestPacket } from "./history.js";
import { inferWorkspaceIntent } from "./intent.js";

export async function reviewContextDrift(workspaceRoot, options = {}) {
  const packet = await readLatestPacket(workspaceRoot);
  const git = await getGitState(workspaceRoot);
  const currentIntent = await inferWorkspaceIntent(workspaceRoot);
  const includedPaths = new Set(getIncludedPaths(packet));
  const excludedPaths = new Set((packet.excluded ?? []).map((item) => item.path).filter(Boolean));
  const changedPaths = git.changedPaths ?? [];
  const insidePacket = [];
  const outsidePacket = [];
  const changedExcluded = [];

  for (const changedPath of changedPaths) {
    if (includedPaths.has(changedPath)) {
      insidePacket.push(changedPath);
    } else if (excludedPaths.has(changedPath)) {
      changedExcluded.push(changedPath);
      outsidePacket.push(changedPath);
    } else {
      outsidePacket.push(changedPath);
    }
  }

  const packetTask = packet.intent?.task ?? "";
  const packetTaskStale = isPacketTaskStale(packetTask, currentIntent, changedPaths);
  const risk =
    packetTaskStale
      ? "high"
      : !git.available
      ? "medium"
      : outsidePacket.length === 0
        ? "low"
        : changedExcluded.length > 0 || outsidePacket.length >= 5
          ? "high"
          : "medium";

  const recommendations = [];
  if (packetTaskStale) {
    recommendations.push("The latest packet task looks stale for the current changed files; rebuild context before trusting the result.");
  }
  if (outsidePacket.length > 0) {
    recommendations.push("Review files changed outside the packet before trusting the agent result.");
    recommendations.push("Re-run prepare_context or rebuild the packet if those files are intentional.");
  }
  if (changedExcluded.length > 0) {
    recommendations.push("At least one changed file was explicitly excluded from the packet.");
  }
  if (!git.available) {
    recommendations.push("Git was unavailable, so drift review could not compare current git changes.");
  }

  // Feedback flywheel: files changed outside the packet that were NOT explicitly
  // excluded are genuine ranking misses. Record them (locally) so a future task
  // with overlapping keywords surfaces them proactively.
  if (options.recordFeedback !== false && git.available) {
    const genuineMisses = [...new Set(outsidePacket)].filter((changedPath) => !excludedPaths.has(changedPath));
    if (genuineMisses.length) {
      const config = await loadConfig(workspaceRoot).catch(() => ({}));
      await recordFeedback(
        workspaceRoot,
        { missedPaths: genuineMisses, task: packetTask },
        { enabled: config.feedback?.enabled }
      );
    }
  }

  return {
    changed_excluded: changedExcluded.sort(),
    changed_inside_packet: insidePacket.sort(),
    changed_outside_packet: [...new Set(outsidePacket)].sort(),
    current_intent: currentIntent,
    current_changed_paths_count: changedPaths.length,
    git_available: git.available,
    packet_id: packet.id,
    packet_task_stale: packetTaskStale,
    recommendations,
    risk,
    task: packetTask,
    workspace_root: workspaceRoot
  };
}

export function renderContextDriftMarkdown(review) {
  return [
    "# Context Delta Drift Review",
    "",
    `Packet: ${review.packet_id}`,
    `Task: ${review.task}`,
    `Current intent: ${review.current_intent ?? "unknown"}`,
    `Risk: ${review.risk}`,
    `Packet task stale: ${review.packet_task_stale ? "yes" : "no"}`,
    `Current changed paths: ${review.current_changed_paths_count}`,
    `Changed inside packet: ${review.changed_inside_packet.length}`,
    `Changed outside packet: ${review.changed_outside_packet.length}`,
    `Changed but excluded: ${review.changed_excluded.length}`,
    "",
    "## Next Best Action",
    "",
    renderNextBestAction(review),
    "",
    "## Changed Inside Packet",
    "",
    ...renderPathList(review.changed_inside_packet, 25),
    "",
    "## Changed Outside Packet",
    "",
    ...renderPathList(review.changed_outside_packet, 25),
    "",
    "## Changed But Excluded",
    "",
    ...renderPathList(review.changed_excluded, 25),
    "",
    "## Recommendations",
    "",
    ...renderPathList(review.recommendations, 25)
  ].join("\n");
}

function getIncludedPaths(packet) {
  const view = packet.compact_view;
  if (view?.included?.length) {
    return view.included.map((item) => item.path).filter(Boolean);
  }

  return [
    ...(packet.changed_artifacts ?? []),
    ...(packet.supporting_evidence ?? []),
    ...(packet.governing_constraints ?? []),
    ...(packet.impacted_neighbors ?? [])
  ].map((item) => item.path).filter(Boolean);
}

function renderNextBestAction(review) {
  if (review.packet_task_stale) {
    return "Rebuild context first. The latest packet task no longer appears to match the current changed files.";
  }
  if (!review.git_available) {
    return "Git was unavailable. Rebuild the packet from the current workspace before trusting a multi-file agent result.";
  }
  if (review.changed_excluded.length > 0) {
    return "Rebuild context or remove stale exclusions before trusting the result; the agent changed files that were excluded from the packet.";
  }
  if (review.changed_outside_packet.length > 0) {
    return "Review the outside-packet files, then rerun prepare_context if those edits are intentional.";
  }
  return "No outside-packet edits detected. Continue with normal review.";
}

function isPacketTaskStale(packetTask, currentIntent, changedPaths) {
  if (!changedPaths.length) return false;
  if (!packetTask || !currentIntent) return false;
  if (currentIntent.startsWith("Continue the previous Context Delta task:")) return false;

  const packetKeywords = meaningfulKeywords(packetTask);
  const currentKeywords = meaningfulKeywords([currentIntent, ...changedPaths].join(" "));
  if (!packetKeywords.size || !currentKeywords.size) return false;

  for (const keyword of packetKeywords) {
    if (currentKeywords.has(keyword)) return false;
  }
  return true;
}

function meaningfulKeywords(value) {
  const stopWords = new Set([
    "add",
    "agent",
    "change",
    "changes",
    "code",
    "context",
    "current",
    "delta",
    "file",
    "files",
    "for",
    "from",
    "review",
    "task",
    "the",
    "this",
    "ts",
    "tsx",
    "user",
    "users",
    "workspace"
  ]);

  return new Set(
    String(value)
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((token) => token.length >= 3 && !stopWords.has(token))
  );
}

function renderPathList(items, limit = 25) {
  if (!items.length) return ["No items."];
  const visible = items.slice(0, limit).map((item) => `- ${item}`);
  if (items.length > limit) {
    visible.push(`- ...and ${items.length - limit} more`);
  }
  return visible;
}
