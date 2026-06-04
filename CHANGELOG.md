# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — Initial release

### Added

- 10 consolidated MCP tools covering the Grid Connect API surface:
  - `workbook`, `worksheet`, `column`, `cell` — action-discriminated CRUD
  - `column_mutation` — typed mutations (edit prompt, swap model, add evaluation, etc.) without raw JSON
  - `discover` — single tool for 25+ metadata/data/agent discovery queries
  - `apply_grid` — declarative YAML DSL for creating an entire grid in one call
  - `get_url` — Lightning Experience deep links for workbooks/worksheets
  - Composite workflows: `setup_agent_test`, `poll_worksheet_status`, `get_worksheet_summary`
- All 12 Agentforce Grid column types validated by Zod schemas (AI, Agent, AgentTest, Object, DataModelObject, Evaluation, Reference, Formula, PromptTemplate, InvocableAction, Action, Text)
- 20 model shorthands (e.g. `claude-4.5-sonnet`, `gpt-4-omni`) instead of full `sfdc_ai__*` identifiers
- `apply_grid` 6-pass semantic validation: schema, type-specific fields, reference integrity, cycle detection (Kahn's algorithm), type compatibility, value validation
- MCP resources for worksheet schema, agents, models, column schema, and the YAML DSL
- Hardened request logic with retry on network errors, 429 rate-limit respect, and 5xx exponential backoff
- Authentication via the user's `sf` CLI — no token management

[Unreleased]: https://github.com/salesforcecli/sf-grid-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/salesforcecli/sf-grid-mcp/releases/tag/v0.1.0
