---
name: Bug report
about: Report something that isn't working as expected
title: ""
labels: bug
assignees: ""
---

## Description

A clear and concise description of what the bug is.

## Reproduction

Steps to reproduce:

1. Configure MCP client with `...`
2. Run tool `...` with arguments `...`
3. See error

## Expected behavior

What you expected to happen.

## Actual behavior

What actually happened. Include error messages, stack traces, or stderr output (run with `--debug` for verbose logs).

## Environment

- **`@salesforce/sf-grid-mcp` version:** (from `package.json` or `npm ls @salesforce/sf-grid-mcp`)
- **MCP client:** (Claude Code / Cursor / VS Code Copilot / other — include version)
- **Node version:** (`node --version`)
- **`sf` CLI version:** (`sf --version`)
- **OS:** (macOS / Linux / Windows + version)
- **Salesforce org type:** (production / sandbox / scratch / Data Cloud)

## Additional context

- Org alias / `--orgs` flag value used (redact usernames if sharing)
- Relevant tool call payload (redact PII)
- Any related logs from the MCP client