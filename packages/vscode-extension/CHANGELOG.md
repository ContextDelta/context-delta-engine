# Changelog

## 0.1.0 - Unreleased

### Added

- Context Delta activity bar dashboard.
- Packet creation command with mode picker.
- Latest packet, insights, packet diff, metrics, report, and manager summary
  webviews.
- Copy commands for full packet JSON, compact packet JSON, and agent handoff
  formats.
- Packet item actions for opening files, copying paths, copying snippets,
  pinning, and excluding context.
- Local CLI/engine locator that supports both monorepo development and staged
  extension packaging.
- Real-time dashboard: a file watcher refreshes the dashboard and status bar
  whenever a new packet is written, including by the CLI or an MCP client.
- Dashboard shows the token-count method (exact tokenizer vs estimated) and the
  resolved model/encoding.
- Metrics, insights, diff, summary, report, drift, and setup panels now have an
  in-place Refresh button, so new numbers appear without closing and reopening
  the panel.
