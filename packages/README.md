# Packages

Implementation packages live here.

Current structure:

```text
packages/
  cli/               local command-line interface
  engine/            local scanning, diffing, ranking, packet building, reports
  mcp-server/        MCP-style stdio server for agent tool and resource calls
  shared/            packet schema, token estimates, shared utilities
  vscode-extension/  VS Code dashboard and packet viewer shell
```

The first implementation is dependency-light and runs directly on Node.js.
