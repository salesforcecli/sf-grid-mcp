import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GridClient } from "../client.js";
import { z } from "zod";
import { requireParam, ValidationError } from "../lib/validation.js";
import { errorResult, errorTextResult, jsonResult } from "../lib/result-helpers.js";

// Local typed shapes for cell-tool params. Kept here (not in schemas.ts) because
// they're tool-surface-only — the Core API accepts a richer payload than these
// schemas describe; we only require the minimum shape MCP callers need.
const CellUpdateItemSchema = z.object({
  id: z.string().describe("Cell ID"),
  fullContent: z.record(z.string(), z.any()).optional().describe("Cell payload, e.g. { text: \"value\" }"),
  displayContent: z.any().optional().describe("Display text for the cell"),
}).passthrough();

const PasteCellSchema = z.object({
  displayContent: z.any().optional().describe("Display text for the pasted cell"),
}).passthrough();

const TriggerRowExecutionConfigSchema = z.object({
  trigger: z.enum(["RUN_ROW", "RUN_SELECTION", "EDIT", "PASTE"]).describe("Trigger type"),
  rowIds: z.array(z.string()).optional().describe("Row IDs (for RUN_ROW)"),
  seedCellIds: z.array(z.string()).optional().describe("Seed cell IDs (for RUN_SELECTION)"),
  editedCells: z.array(z.record(z.string(), z.any())).optional().describe("Edited cells (for EDIT)"),
  startColumnId: z.string().optional().describe("Start column ID (for PASTE)"),
  matrix: z.array(z.array(z.record(z.string(), z.any()))).optional().describe("Paste matrix (for PASTE)"),
}).passthrough();

// Helper: accept array/object directly OR a JSON string (back-compat).
function parseIfString<T>(value: T | string, paramName: string): T {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as T;
  } catch (e) {
    throw new ValidationError(`Invalid JSON in ${paramName} parameter: ${(e as Error).message}`);
  }
}

export function registerCellTool(server: McpServer, client: GridClient): void {
  server.tool(
    "cell",
    "Cell operations: update, paste, trigger_execution, validate_formula, generate_ia_input",
    {
      action: z.enum(["update", "paste", "trigger_execution", "validate_formula", "generate_ia_input"]),
      worksheetId: z.string().describe("The worksheet containing the cells"),
      cells: z.union([z.array(CellUpdateItemSchema), z.string()]).optional().describe('Array of cells for update. Each cell: { id, fullContent: { text: "value" } }. JSON string still accepted for back-compat.'),
      startColumnId: z.string().optional().describe("Column ID to start pasting at (for paste)"),
      startRowId: z.string().optional().describe("Row ID to start pasting at (for paste)"),
      matrix: z.union([z.array(z.array(PasteCellSchema)), z.string()]).optional().describe('2D array for paste. Each cell: { displayContent: "value" }. JSON string still accepted for back-compat.'),
      config: z.union([TriggerRowExecutionConfigSchema, z.record(z.string(), z.any()), z.string()]).optional().describe("Config object for trigger_execution (e.g. { trigger: \"RUN_ROW\", rowIds: [...] }), validate_formula, or generate_ia_input. JSON string still accepted for back-compat."),
    },
    async ({ action, worksheetId, cells, startColumnId, startRowId, matrix, config }) => {
      try {
        switch (action) {
          case "update": {
            requireParam(cells, "cells", "update");
            const cellsArr = parseIfString(cells, "cells");
            const result = await client.put(`/worksheets/${encodeURIComponent(worksheetId)}/cells`, { cells: cellsArr });
            return jsonResult(result);
          }

          case "paste": {
            requireParam(startColumnId, "startColumnId", "paste");
            requireParam(startRowId, "startRowId", "paste");
            requireParam(matrix, "matrix", "paste");
            const matrixArr = parseIfString(matrix, "matrix");
            const result = await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/paste`, {
              startColumnId,
              startRowId,
              matrix: matrixArr,
            });
            return jsonResult(result);
          }

          case "trigger_execution": {
            requireParam(config, "config", "trigger_execution");
            const configObj = parseIfString(config, "config");
            const result = await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/trigger-row-execution`, configObj);
            return jsonResult(result);
          }

          case "validate_formula": {
            requireParam(config, "config", "validate_formula");
            const configObj = parseIfString(config, "config");
            const result = await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/validate-formula`, configObj);
            return jsonResult(result);
          }

          case "generate_ia_input": {
            requireParam(config, "config", "generate_ia_input");
            const configObj = parseIfString(config, "config");
            const result = await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/generate-ia-input`, configObj);
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