import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GridClient } from "../client.js";
import { z } from "zod";
import { requireParam, ValidationError } from "../lib/validation.js";
import { ColumnInputSchema, ColumnConfigUnionSchema } from "../schemas.js";
import { configCache } from "../lib/column-config-cache.js";
import { getColumnConfig } from "../lib/config-helpers.js";
import { errorTextResult, errorResult, jsonResult } from "../lib/result-helpers.js";
import { normalizeColumnConfigFilters } from "../lib/filter-helpers.js";

// Accept the column config as a typed object OR a JSON string (back-compat).
// Returns the parsed value as `unknown` — callers run their own action-specific
// safeParse against ColumnInputSchema or ColumnConfigUnionSchema afterward.
function parseColumnConfig(config: unknown): unknown {
  if (typeof config !== "string") return config;
  try {
    return JSON.parse(config);
  } catch (e) {
    throw new ValidationError(`Invalid JSON in config parameter: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Main tool registration — CRUD only.
// Typed mutation shorthands live on the `column_mutation` tool.
// ---------------------------------------------------------------------------

export function registerColumnTool(server: McpServer, client: GridClient): void {
  server.tool(
    "column",
    `Manage columns: add, edit, save, delete, reprocess, get_data, create_from_utterance, generate_json_path.

Column types: AI, Agent, AgentTest, Object, Text, Reference, Formula, Evaluation, PromptTemplate, InvocableAction, Action, DataModelObject

CRITICAL: All configs use the canonical nested structure:
{"name":"...", "type":"AI", "config":{"type":"AI", "queryResponseFormat":{"type":"EACH_ROW"}, "autoUpdate":true, "config":{"autoUpdate":true, ...type-specific fields...}}}

For typed-mutation shorthands (edit_ai_prompt, edit_agent_config, add_evaluation, change_model, update_filters, reprocess_typed, edit_prompt_template) use the \`column_mutation\` tool instead.`,
    {
      action: z.enum([
        "add", "edit", "save", "delete", "reprocess", "get_data",
        "create_from_utterance", "generate_json_path",
      ]),
      worksheetId: z.string().optional().describe("Worksheet containing the column"),
      columnId: z.string().optional().describe("Column ID (required for edit, save, delete, reprocess, get_data)"),
      name: z.string().optional().describe("Column name (for add)"),
      type: z.string().optional().describe("Column type (for add): AI, Agent, AgentTest, Formula, Object, PromptTemplate, Action, InvocableAction, Reference, Text, Evaluation, DataModelObject"),
      config: z.union([ColumnInputSchema, ColumnConfigUnionSchema, z.record(z.string(), z.any()), z.string()]).optional().describe(`Column configuration (for add, edit, save, reprocess). Accepts a typed object OR a JSON string. For 'add', pass the full {name, type, config} shape. For 'edit'/'save'/'reprocess', pass the inner {type, queryResponseFormat, autoUpdate, config} shape. JSON string still accepted for back-compat.`),
      // For create_from_utterance
      utterance: z.string().optional().describe("Natural language description (for create_from_utterance)"),
      // For generate_json_path
      userInput: z.string().optional().describe("User input (for generate_json_path)"),
      variableName: z.string().optional().describe("Variable name (for generate_json_path)"),
      dataType: z.string().optional().describe("Data type (for generate_json_path). Salesforce display types: string, boolean, integer, double, long, date, datetime, time, currency, percent, picklist, multipicklist, id, reference, textarea, phone, url, email, json, sobject, address, location, base64, combobox, encryptedstring, complexvalue, anytype, plain_text_area, rich_text_area, image_url, external_lookup, indirect_lookup, switchable_personname, personname, extensionentity_lookup. Case-insensitive; underscores are stripped before sending to Core."),
    },
    async (params) => {
      const { action, worksheetId, columnId, name, type, config } = params;

      try {
        switch (action) {
          case "add": {
            requireParam(worksheetId, "worksheetId", "add");
            requireParam(name, "name", "add");
            requireParam(type, "type", "add");
            requireParam(config, "config", "add");

            const configObj = parseColumnConfig(config);

            const validation = ColumnInputSchema.safeParse(configObj);
            if (!validation.success) {
              const errors = validation.error.issues.map(i => `  ${i.path.join(".")}: ${i.message}`).join("\n");
              return errorTextResult(
                `Config validation failed:\n${errors}\n\n` +
                `Expected canonical structure:\n` +
                `{"name":"...", "type":"...", "config":{"type":"...", "queryResponseFormat":{"type":"EACH_ROW"}, "autoUpdate":true, "config":{"autoUpdate":true, ...type-specific fields...}}}`
              );
            }

            const normalizedOuter = normalizeColumnConfigFilters(validation.data.config);
            const body = { name, type, config: normalizedOuter };
            const result = await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/columns`, body);
            if (result?.id) {
              configCache.set(result.id, normalizedOuter);
            }
            return jsonResult(result);
          }

          case "edit": {
            requireParam(worksheetId, "worksheetId", "edit");
            requireParam(columnId, "columnId", "edit");
            requireParam(config, "config", "edit");

            const configObj = parseColumnConfig(config);
            const validation = ColumnConfigUnionSchema.safeParse(configObj);
            if (!validation.success) {
              const errors = validation.error.issues.map(i => `  ${i.path.join(".")}: ${i.message}`).join("\n");
              return errorTextResult(`Config validation failed:\n${errors}\n\nExpected outer config object with type, queryResponseFormat, autoUpdate, and nested config.`);
            }
            // Core's gRPC builder NPEs if name is missing — fetch the existing column's name.
            const { column: existingCol } = await getColumnConfig(client, columnId, worksheetId);
            const normalized = normalizeColumnConfigFilters(validation.data);
            // Send the full outer wrapper so Core's normalizeNumberOfRows can read
            // queryResponseFormat. Without it, Core falls into the else branch and
            // clamps numberOfRows to DEFAULT_ROW_LIMIT (200), growing the worksheet.
            const body = {
              name: existingCol.name,
              type: normalized.type,
              config: normalized,
            };
            const result = await client.put(`/worksheets/${encodeURIComponent(worksheetId)}/columns/${encodeURIComponent(columnId)}`, body);
            configCache.set(columnId, normalized);
            return jsonResult(result);
          }

          case "save": {
            requireParam(worksheetId, "worksheetId", "save");
            requireParam(columnId, "columnId", "save");
            requireParam(config, "config", "save");

            const configObj = parseColumnConfig(config);
            const validation = ColumnConfigUnionSchema.safeParse(configObj);
            if (!validation.success) {
              const errors = validation.error.issues.map(i => `  ${i.path.join(".")}: ${i.message}`).join("\n");
              return errorTextResult(`Config validation failed:\n${errors}\n\nExpected outer config object with type, queryResponseFormat, autoUpdate, and nested config.`);
            }
            const { column: existingCol } = await getColumnConfig(client, columnId, worksheetId);
            const normalized = normalizeColumnConfigFilters(validation.data);
            const body = {
              name: existingCol.name,
              type: normalized.type,
              config: normalized,
            };
            const result = await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/columns/${encodeURIComponent(columnId)}/save`, body);
            configCache.set(columnId, normalized);
            return jsonResult(result);
          }

          case "delete": {
            requireParam(worksheetId, "worksheetId", "delete");
            requireParam(columnId, "columnId", "delete");
            const result = await client.delete(`/worksheets/${encodeURIComponent(worksheetId)}/columns/${encodeURIComponent(columnId)}`);
            configCache.invalidate(columnId);
            return jsonResult(result);
          }

          case "reprocess": {
            requireParam(worksheetId, "worksheetId", "reprocess");
            requireParam(columnId, "columnId", "reprocess");
            requireParam(config, "config", "reprocess");

            const configObj = parseColumnConfig(config);
            const validation = ColumnConfigUnionSchema.safeParse(configObj);
            if (!validation.success) {
              const errors = validation.error.issues.map(i => `  ${i.path.join(".")}: ${i.message}`).join("\n");
              return errorTextResult(`Config validation failed:\n${errors}\n\nExpected outer config object with type, queryResponseFormat, autoUpdate, and nested config.`);
            }
            const { column: existingCol } = await getColumnConfig(client, columnId, worksheetId);
            const normalized = normalizeColumnConfigFilters(validation.data);
            const body = {
              name: existingCol.name,
              type: normalized.type,
              config: normalized,
            };
            const result = await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/columns/${encodeURIComponent(columnId)}/reprocess`, body);
            configCache.set(columnId, normalized);
            return jsonResult(result);
          }

          case "get_data": {
            requireParam(worksheetId, "worksheetId", "get_data");
            requireParam(columnId, "columnId", "get_data");
            const result = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}/columns/${encodeURIComponent(columnId)}/data`);
            return jsonResult(result);
          }

          case "create_from_utterance": {
            requireParam(worksheetId, "worksheetId", "create_from_utterance");
            requireParam(params.utterance, "utterance", "create_from_utterance");
            const result = await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/create-column-from-utterance`, { utterance: params.utterance });
            return jsonResult(result);
          }

          case "generate_json_path": {
            requireParam(worksheetId, "worksheetId", "generate_json_path");
            requireParam(params.userInput, "userInput", "generate_json_path");
            requireParam(params.variableName, "variableName", "generate_json_path");
            requireParam(params.dataType, "dataType", "generate_json_path");
            // Core's ValueType.fromApiValue is case-sensitive and uses Salesforce's
            // SfdcDisplayType / ExtendedDisplayType API names — mostly lowercase, with
            // ExtendedDisplayType values concatenated (e.g. PLAIN_TEXT_AREA→"plaintextarea")
            // and two oddities on SfdcDisplayType: INTEGER→"int" and ANYTYPE→"anyType".
            // A non-match returns null and the downstream generateValidJinjavaExpression
            // NPEs without catching it. Normalize the user's input so common casings work.
            const dataTypeAliases: Record<string, string> = {
              integer: "int",
              anytype: "anyType",
            };
            const lowered = params.dataType!.toLowerCase().replace(/_/g, "");
            const dataType = dataTypeAliases[lowered] ?? lowered;
            const result = await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/generate-json-path`, {
              userInput: params.userInput,
              variableName: params.variableName,
              dataType,
            });
            return jsonResult(result);
          }
        }
      } catch (error: unknown) {
        if (error instanceof ValidationError) {
          return errorTextResult(`Error: ${error.message}`);
        }
        return errorResult(error);
      }
    }
  );
}
