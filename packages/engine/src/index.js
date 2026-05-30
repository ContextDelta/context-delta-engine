export { buildContextPacket, getUniqueIncludedItems } from "./packet.js";
export { renderReplayPrompt, writePacketApproval } from "./approval.js";
export {
  renderEvalMarkdown,
  runPacketEval,
  scorePacketAgainstCase,
  writeEvalReport
} from "./eval.js";
export { buildCompactPacketView, buildPacketInsights } from "./insights.js";
export {
  buildIncrementalHandoffModel,
  getSupportedHandoffFormats,
  renderHandoff,
  renderRiskHeader
} from "./handoff.js";
export { inferWorkspaceIntent } from "./intent.js";
export { detectSpecKit, scopeSpecEvidence, buildSpecKitWarnings } from "./spec-kit.js";
export {
  MANAGED_BEGIN,
  MANAGED_END,
  getDefaultInjectTargets,
  renderInstructionDigest,
  syncInstructionFiles,
  upsertManagedBlock
} from "./inject.js";
export { cleanupStaleControls } from "./controls.js";
export { reviewContextDrift, renderContextDriftMarkdown } from "./drift.js";
export {
  buildPacketDiff,
  listPacketHistory,
  readLatestPacket,
  readPacketByIdOrPath,
  readPreviousPacket,
  renderPacketDiffMarkdown
} from "./history.js";
export { loadConfig, writeDefaultConfig } from "./config.js";
export {
  buildManagerSummary,
  readMetricsEvents,
  readMetricsSummary,
  renderManagerSummaryMarkdown,
  writeManagerSummary,
  writePacketAndMetrics
} from "./metrics.js";
export { renderHtmlReport, writeHtmlReport } from "./report.js";
export { scanWorkspace } from "./scanner.js";
export { applySetupFixes, getSetupStatus, renderSetupMarkdown } from "./setup.js";
export { readSnapshot, writeSnapshot } from "./snapshot.js";
export { getGitState } from "./git.js";
export { getTokenizerInfo, resolveEncoding } from "../../shared/src/index.js";
