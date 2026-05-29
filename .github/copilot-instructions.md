# Copilot Instructions

Use Context Delta as the first context step for coding, reviewing, debugging,
or documentation work in this repository.

When GitHub Copilot Chat is in Agent mode and MCP tools are available:

- Before reading many files or editing code, call the Context Delta MCP tool
  `prepare_context` for the user's task.
- Use the returned risk header and handoff as the focused working context.
- If the user asks for a review, audit, critique, or assessment, stay
  read-only. Report findings with file paths and reasoning, but do not edit
  files, apply patches, run formatters, or otherwise modify the workspace.
- Only make changes when the user explicitly asks to implement, fix, update,
  or edit.
- Treat omitted files as out of scope unless the task proves that more context
  is required.
- If `prepare_context` reports high risk, missing tests, stale specs, or budget
  pressure, mention the risk briefly before editing.
- After making edits, call `review_context_drift` and summarize whether any
  changed files moved outside the prepared context. For review-only tasks,
  mention that drift review is unnecessary because no files were changed.

If Context Delta MCP tools are not available, continue normally and tell the
user that automatic Context Delta context was not available in this Copilot
session.
