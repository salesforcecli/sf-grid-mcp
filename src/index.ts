#!/usr/bin/env node

import { execSync } from "node:child_process";
import { Command } from "commander";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GridClient, GridClientConfig } from "./client.js";
import { registerWorkbookTool } from "./tools/workbook.js";
import { registerWorksheetTool } from "./tools/worksheet.js";
import { registerColumnTool } from "./tools/column.js";
import { registerColumnMutationTool } from "./tools/column-mutation.js";
import { registerCellTool } from "./tools/cell.js";
import { registerDiscoverTool } from "./tools/discover.js";
import { registerWorkflowTools } from "./tools/workflows.js";
import { registerApplyGridTool } from "./tools/apply-grid.js";
import { registerUrlTools } from "./tools/urls.js";
import { ResourceCache } from "./lib/resource-cache.js";
import { registerWorksheetResources } from "./resources/worksheet-resources.js";
import { registerMetadataResources } from "./resources/metadata-resources.js";
import { registerDslResource } from "./resources/dsl-resource.js";
import { registerPrompts } from "./prompts/index.js";

// Parse CLI flags. The `--orgs` flag follows the `salesforcecli/mcp` convention:
// accepts DEFAULT_TARGET_ORG, ALLOW_ALL_ORGS, or a comma-separated list of org
// aliases / @-style usernames. The first usable value is what GridClient resolves
// against `sf` CLI on each request. Env vars stay supported as a fallback for
// direct-token flows used by automated test harnesses.
const program = new Command()
  .name("sf-grid-mcp")
  .description(
    "Agentforce Grid MCP server. Exposes the Grid Connect API as MCP tools for LLM agents (Claude Code, Cursor, ChatGPT desktop)."
  )
  .option(
    "-o, --orgs <orgs>",
    "Comma-separated list of orgs to allow. Accepts DEFAULT_TARGET_ORG, ALLOW_ALL_ORGS, or org aliases / usernames (e.g. me@example.com,my-alias).",
  )
  .option("--instance-url <url>", "Instance URL override (advanced; usually inferred from `sf` CLI auth).")
  .option("--api-version <version>", "Salesforce API version (default: v66.0).")
  .option(
    "--timeout-ms <ms>",
    "HTTP request timeout in milliseconds (default: 60000).",
    (v) => {
      const n = parseInt(v, 10);
      if (isNaN(n)) throw new Error("--timeout-ms must be a number");
      return n;
    },
  )
  .option("--debug", "Enable debug logging on stderr.")
  .parse(process.argv);

const opts = program.opts<{
  orgs?: string;
  instanceUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
  debug?: boolean;
}>();

if (opts.debug) {
  process.env.GRID_DEBUG = "true";
}

// Preflight: confirm the `sf` CLI is on PATH. We only need this when the
// access-token env-var fallback isn't being used — the eval harness sets
// GRID_ACCESS_TOKEN/INSTANCE_URL and never invokes `sf`. For everyone else
// (the published-npm install path), `sf` is required; failing fast with a
// clear message is friendlier than a cryptic ENOENT inside execSync later.
if (!process.env.GRID_ACCESS_TOKEN) {
  try {
    execSync("sf --version", { stdio: "pipe" });
  } catch {
    process.stderr.write(
      "Error: Salesforce CLI (`sf`) is required but not found on PATH.\n" +
        "Install it (https://developer.salesforce.com/tools/salesforcecli) and run `sf org login web` before starting this MCP server.\n",
    );
    process.exit(1);
  }
}

// Resolve orgAlias from --orgs. For MVP, the first comma-separated entry wins
// when it's a concrete alias / username; sentinel values (DEFAULT_TARGET_ORG,
// ALLOW_ALL_ORGS) fall through to `sf`'s default-target-org resolution.
const orgsList = opts.orgs
  ? opts.orgs.split(",").map((s) => s.trim()).filter(Boolean)
  : [];
const firstConcreteOrg = orgsList.find(
  (v) => v !== "DEFAULT_TARGET_ORG" && v !== "ALLOW_ALL_ORGS" && v !== "DEFAULT_TARGET_DEV_HUB",
);

const config: GridClientConfig = {
  instanceUrl: opts.instanceUrl ?? process.env.INSTANCE_URL,
  orgAlias: firstConcreteOrg ?? process.env.ORG_ALIAS,
  apiVersion: opts.apiVersion ?? process.env.API_VERSION,
  timeoutMs:
    opts.timeoutMs ??
    (process.env.GRID_TIMEOUT
      ? (() => {
          const n = parseInt(process.env.GRID_TIMEOUT!, 10);
          if (isNaN(n)) throw new Error("GRID_TIMEOUT must be a number");
          return n;
        })()
      : undefined),
  accessToken: process.env.GRID_ACCESS_TOKEN,
};

const client = new GridClient(config);

const server = new McpServer({
  name: "sf-grid-mcp",
  version: "0.1.0",
});

// Consolidated tools (~15 instead of 65)
registerWorkbookTool(server, client);      // workbook (list, create, create_with_worksheet, get, get_worksheets, delete)
registerWorksheetTool(server, client);     // worksheet (create, get, get_data, get_data_generic, update, delete, add_rows, delete_rows, import_csv, run, get_run_job)
registerColumnTool(server, client);        // column (CRUD: add, edit, save, delete, reprocess, get_data, create_from_utterance, generate_json_path)
registerColumnMutationTool(server, client); // column_mutation (typed shorthands: edit_ai_prompt, edit_agent_config, add_evaluation, change_model, update_filters, reprocess_typed, edit_prompt_template)
registerCellTool(server, client);          // cell (update, paste, trigger_execution, validate_formula, generate_ia_input)
registerDiscoverTool(server, client);      // discover (23+ metadata/data/agent discovery actions)
registerWorkflowTools(server, client);     // poll_worksheet_status, get_worksheet_summary, setup_agent_test
registerApplyGridTool(server, client);     // apply_grid (declarative YAML)
registerUrlTools(server, client);          // get_url

const resourceCache = new ResourceCache();
registerWorksheetResources(server, client, resourceCache);
registerMetadataResources(server, client, resourceCache);
registerDslResource(server);

registerPrompts(server);

const transport = new StdioServerTransport();
await server.connect(transport);
