# @salesforce/sf-grid-mcp

MCP server for [Agentforce Grid](https://help.salesforce.com/s/articleView?id=sf.ai_workbench.htm) (formerly AI Workbench). Distributed as a standalone npm package — invoked by MCP clients (Claude Code, Cursor, ChatGPT desktop, VS Code Copilot) via `npx`. Authenticates against your existing `sf` CLI org auth — no tokens to manage.

## Highlights

- **10 consolidated MCP tools** (down from 65) — less tool-selection overhead, faster LLM inference
- **`apply_grid`** — create an entire grid from a single YAML spec (one tool call replaces 10-15 sequential calls)
- **Action-discriminated CRUD** — `workbook`, `worksheet`, `column`, `cell` each handle all operations via an `action` parameter
- **`discover`** — single tool for all 25 metadata/data/agent discovery queries
- **`column`** — absorbs typed mutations (edit prompt, swap model, add evaluation) as flat parameters alongside raw config
- **Composite workflows** — `setup_agent_test`, `poll_worksheet_status`, `get_worksheet_summary`
- **20 model shorthands** including GPT 5.1/5.2, Claude 4.5 Opus, Claude 4.6 Sonnet
- **Hardened request logic** with retry on network errors, 429 rate-limit respect, 5xx exponential backoff

## Authentication

This server uses **Salesforce CLI (sf) `api request` commands** for all API calls. Authentication is handled entirely by the SF CLI:

- No manual token management required
- SF CLI handles OAuth flows, token refresh, and expiration automatically
- Supports all SF CLI authentication methods (web login, JWT, refresh tokens, etc.)
- Works with any org authenticated via `sf org login`

## Quick Start

### Prerequisites

1. **Install the Salesforce CLI** (the MCP server uses it for org auth):

   ```bash
   brew install sf            # macOS
   npm install -g @salesforce/cli   # any platform
   ```

2. **Log into the org you want the MCP to use:**

   ```bash
   sf org login web --alias my-org
   ```

   Or use whichever org alias / username you've already set up.

### Configure your MCP client

You don't install this package directly — your MCP client invokes it via `npx -y` and Node will fetch it from the npm registry on first run.

**Claude Code** (`.mcp.json` in your project, or `~/.claude/mcp.json` globally):

```json
{
  "mcpServers": {
    "sf-grid": {
      "command": "npx",
      "args": ["-y", "@salesforce/sf-grid-mcp", "--orgs", "DEFAULT_TARGET_ORG"]
    }
  }
}
```

**Cursor** (`mcp.json`):

```json
{
  "mcpServers": {
    "sf-grid": {
      "command": "npx",
      "args": ["-y", "@salesforce/sf-grid-mcp", "--orgs", "DEFAULT_TARGET_ORG"]
    }
  }
}
```

**VS Code / GitHub Copilot** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "sf-grid": {
      "command": "npx",
      "args": ["-y", "@salesforce/sf-grid-mcp", "--orgs", "DEFAULT_TARGET_ORG"]
    }
  }
}
```

### CLI flags

| Flag | Description |
|---|---|
| `--orgs` | **Required.** Comma-separated list. Accepts `DEFAULT_TARGET_ORG`, `ALLOW_ALL_ORGS`, or specific org aliases / usernames (e.g. `me@example.com,my-alias`). |
| `--instance-url` | Override instance URL (advanced; usually inferred from `sf` CLI). |
| `--api-version` | Salesforce API version (default: `v66.0`). |
| `--timeout-ms` | HTTP request timeout in milliseconds (default: `60000`). |
| `--debug` | Enable debug logging on stderr. |

### Choosing the right `--orgs` value

| Value | When to use |
|---|---|
| `DEFAULT_TARGET_ORG` | Recommended default. Uses whichever org `sf config get target-org` returns. |
| `my-alias` | Pin the MCP to a specific org regardless of what your default-target-org is. |
| `ALLOW_ALL_ORGS` | All authenticated orgs available; the LLM picks via tool calls. Use cautiously — agents can hit any org you've logged into. |

## Architecture

```
src/
  index.ts                    # MCP server entry point
  client.ts                   # SF CLI API wrapper with retry logic
  schemas.ts                  # Zod schemas for all 12 column types
  types.ts                    # Shared types
  tools/
    workbook.ts               # 1 tool: workbook (6 actions: list, create, create_with_worksheet, get, get_worksheets, delete)
    worksheet.ts              # 1 tool: worksheet (11 actions: create, get, get_data, update, delete, add_rows, etc.)
    column.ts                 # 1 tool: column (15+ actions: CRUD + typed mutations like edit_ai_prompt, change_model)
    cell.ts                   # 1 tool: cell (5 actions: update, paste, trigger_execution, validate_formula, generate_ia_input)
    discover.ts               # 1 tool: discover (25 actions: all metadata, data, agent discovery)
    workflows.ts              # 3 tools: setup_agent_test, poll_worksheet_status, get_worksheet_summary
    apply-grid.ts             # 1 tool: apply_grid (YAML DSL → entire grid in one call)
    urls.ts                   # 1 tool: get_url (Lightning Experience URLs)
  lib/
    yaml-parser.ts            # Parse YAML DSL → GridSpec AST
    validator.ts              # 6-pass semantic validation (refs, cycles, types)
    config-expander.ts        # Flat YAML → triple-nested GCC JSON (Zod-validated)
    resolution-engine.ts      # Full pipeline: parse → validate → sort → create
    model-map.ts              # Model shorthand ↔ sfdc_ai__ ID mapping (20 shorthands)
    config-helpers.ts         # Shared: fetch config, resolve refs, deep merge
    column-config-cache.ts    # Session-lifetime config cache for typed mutations
    worksheet-data-helpers.ts # Helpers for columnData response format
    resource-cache.ts         # TTL-based cache for MCP resources
```

## Tool Categories

### `apply_grid` — Declarative Grid Creation

The flagship tool. Pass a YAML spec and get a complete grid:

```yaml
workbook: Sales Agent Tests
worksheet: Q1 Regression
columns:
  - name: Utterances
    type: text

  - name: Agent Output
    type: agent_test
    agent: "Sales Coach"
    inputUtterance: "Utterances"

  - name: Coherence
    type: eval/coherence
    input: "Agent Output"

  - name: Topic Check
    type: eval/topic_assertion
    input: "Agent Output"
    reference: "Expected Topics"

data:
  Utterances:
    - "How do I reset my password?"
    - "What is my account balance?"
```

The tool handles:
- Workbook/worksheet creation
- Agent name → ID resolution
- Column dependency ordering (topological sort)
- Config expansion (flat YAML → nested JSON validated by Zod)
- Sequential column creation with ID wiring
- Data population
- `dryRun` mode for validation without API calls

### Typed Mutation Tools

Modify existing grids without constructing raw JSON:

| Tool | Purpose |
|------|---------|
| `edit_ai_prompt` | Change instruction, model, response format on AI columns |
| `edit_agent_config` | Update agent, utterance, context variables |
| `add_evaluation` | Add evaluation column with auto-wired references |
| `change_model` | Switch LLM model (supports shorthands like `gpt-4-omni`, `claude-4.5-sonnet`) |
| `update_filters` | Change Object/DataModelObject query filters |
| `reprocess` | Reprocess column or worksheet (all/failed/stale) |
| `edit_prompt_template` | Update template and input mappings |

### CRUD Tools

Standard operations for workbooks, worksheets, columns, cells, rows.

### Discovery Tools

| Tool | Returns |
|------|---------|
| `get_agents` | Available agents with IDs, versions, topics |
| `get_llm_models` | Available models |
| `get_evaluation_types` | All 12 evaluation types |
| `get_sobjects` / `get_sobject_fields` | SObject metadata |
| `get_dataspaces` / `get_data_model_objects` | Data Cloud DMOs |
| `get_prompt_templates` | Available prompt templates |
| `get_invocable_actions` | Available Flows, Apex, etc. |
| `get_formula_functions` / `get_formula_operators` | Formula reference |

### Composite Workflows

| Tool | Purpose |
|------|---------|
| `setup_agent_test` | Create a full agent test suite in one call |
| `poll_worksheet_status` | Poll until processing completes |
| `get_worksheet_summary` | Structured column/status summary |
| `create_workbook_with_worksheet` | Create both in one step |

## Column Types

All 12 Agentforce Grid column types are supported with typed Zod schemas:

| Type | DSL Name | Purpose |
|------|----------|---------|
| AI | `ai` | LLM text generation with custom prompts |
| Agent | `agent` | Run agent conversations |
| AgentTest | `agent_test` | Batch agent testing |
| Object | `object` | Query Salesforce SObjects |
| DataModelObject | `data_model_object` | Query Data Cloud DMOs |
| Evaluation | `eval/*` | Evaluate outputs (12 evaluation types) |
| Reference | `reference` | Extract fields via JSON path |
| Formula | `formula` | Computed values |
| PromptTemplate | `prompt_template` | Execute prompt templates |
| InvocableAction | `invocable_action` | Execute Flows/Apex |
| Action | `action` | Standard platform actions |
| Text | `text` | Static/editable text |

## Model Shorthands

Use short names instead of full `sfdc_ai__*` identifiers:

| Shorthand | Model |
|-----------|-------|
| `gpt-4-omni` | GPT 4 Omni |
| `gpt-4-omni-mini` | GPT 4 Omni Mini |
| `gpt-4.1` | GPT 4.1 |
| `gpt-4.1-mini` | GPT 4.1 Mini |
| `gpt-5` | GPT 5 |
| `gpt-5-mini` | GPT 5 Mini |
| `o3` | O3 |
| `o4-mini` | O4 Mini |
| `claude-4.5-sonnet` | Claude 4.5 Sonnet |
| `claude-4.5-haiku` | Claude 4.5 Haiku |
| `claude-4-sonnet` | Claude 4 Sonnet |
| `gemini-2.5-flash` | Gemini 2.5 Flash |
| `gemini-2.5-flash-lite` | Gemini 2.5 Flash Lite |
| `gemini-2.5-pro` | Gemini 2.5 Pro |
| `nova-lite` | Amazon Nova Lite |
| `nova-pro` | Amazon Nova Pro |

## Validation

Every column config is validated against typed Zod schemas before hitting the API. The `apply_grid` tool adds 6-pass semantic validation:

1. **Schema** — required fields, valid types
2. **Type-specific fields** — each column type's required config
3. **Reference integrity** — all column name references resolve
4. **Cycle detection** — no circular dependencies (Kahn's algorithm)
5. **Type compatibility** — eval targets valid column types
6. **Value validation** — valid eval types, model names, response formats

## Development

```bash
git clone https://github.com/<org>/sf-grid-mcp.git
cd sf-grid-mcp
npm install
npm run build      # Compile TypeScript
npm run dev        # Watch mode (rebuild on save)
npm test           # Unit tests (offline, no orgfarm needed)
npm run evals      # Integration tests against an authenticated org (see evals/README.md)
```

To test a local build against an MCP client, point the client at the absolute path of `dist/index.js` instead of `npx -y @salesforce/sf-grid-mcp`:

```json
{
  "mcpServers": {
    "sf-grid-local": {
      "command": "node",
      "args": ["/path/to/sf-grid-mcp/dist/index.js", "--orgs", "DEFAULT_TARGET_ORG"]
    }
  }
}
```
