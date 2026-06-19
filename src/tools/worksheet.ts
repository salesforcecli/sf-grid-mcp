/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GridClient } from "../client.js";
import { z } from "zod";
import { requireParam, ValidationError } from "../lib/validation.js";
import { errorResult, errorTextResult, jsonResult } from "../lib/result-helpers.js";

export function registerWorksheetTool(server: McpServer, client: GridClient): void {
  server.tool(
    "worksheet",
    "Manage worksheets: create, get, get_data, get_data_generic, update, delete, add_rows, delete_rows, import_csv, run, get_run_job",
    {
      action: z.enum(["create", "get", "get_data", "get_data_generic", "update", "delete", "add_rows", "delete_rows", "import_csv", "run", "get_run_job"]),
      worksheetId: z.string().optional().describe("Required for most actions except create and run"),
      workbookId: z.string().optional().describe("Required for create"),
      name: z.string().optional().describe("Required for create and update"),
      numberOfRows: z.number().optional().describe("Required for add_rows"),
      anchorRowId: z.string().optional().describe("For add_rows: anchor row for positioning"),
      position: z.string().optional().describe("For add_rows: 'before' or 'after' relative to anchor"),
      rowIds: z.array(z.string()).optional().describe("Required for delete_rows"),
      documentId: z.string().optional().describe("Required for import_csv"),
      includeHeaders: z.boolean().optional().describe("Required for import_csv"),
      config: z.union([z.record(z.string(), z.any()), z.string()]).optional().describe("Config object for run (the run-worksheet payload). JSON string still accepted for back-compat."),
      jobId: z.string().optional().describe("Required for get_run_job"),
    },
    async ({ action, worksheetId, workbookId, name, numberOfRows, anchorRowId, position, rowIds, documentId, includeHeaders, config, jobId }) => {
      try {
        switch (action) {
          case "create": {
            requireParam(name, "name", "create");
            requireParam(workbookId, "workbookId", "create");
            const result = await client.post("/worksheets", { name, workbookId });
            return jsonResult(result);
          }

          case "get": {
            requireParam(worksheetId, "worksheetId", "get");
            const result = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}`);
            return jsonResult(result);
          }

          case "get_data": {
            requireParam(worksheetId, "worksheetId", "get_data");
            const result = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}/data`);
            return jsonResult(result);
          }

          case "get_data_generic": {
            requireParam(worksheetId, "worksheetId", "get_data_generic");
            const result = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}/data-generic`);
            return jsonResult(result);
          }

          case "update": {
            requireParam(worksheetId, "worksheetId", "update");
            requireParam(name, "name", "update");
            const result = await client.put(`/worksheets/${encodeURIComponent(worksheetId)}`, { name });
            return jsonResult(result);
          }

          case "delete": {
            requireParam(worksheetId, "worksheetId", "delete");
            const result = await client.delete(`/worksheets/${encodeURIComponent(worksheetId)}`);
            return jsonResult(result);
          }

          case "add_rows": {
            requireParam(worksheetId, "worksheetId", "add_rows");
            if (numberOfRows === undefined) {
              throw new ValidationError("numberOfRows is required for add_rows");
            }
            const body: Record<string, unknown> = { numberOfRows };
            if (anchorRowId !== undefined) body.anchorRowId = anchorRowId;
            if (position !== undefined) body.position = position;
            const result = await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/rows`, body);
            return jsonResult(result);
          }

          case "delete_rows": {
            requireParam(worksheetId, "worksheetId", "delete_rows");
            requireParam(rowIds, "rowIds", "delete_rows");
            const result = await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/delete-rows`, { rowIds });
            return jsonResult(result);
          }

          case "import_csv": {
            requireParam(worksheetId, "worksheetId", "import_csv");
            requireParam(documentId, "documentId", "import_csv");
            if (includeHeaders === undefined) {
              throw new ValidationError("includeHeaders is required for import_csv");
            }
            const result = await client.post(
              `/worksheets/${encodeURIComponent(worksheetId)}/import-csv?documentId=${encodeURIComponent(documentId)}&includeHeaders=${includeHeaders}`
            );
            return jsonResult(result);
          }

          case "run": {
            requireParam(config, "config", "run");
            let configObj: unknown;
            if (typeof config === "string") {
              try {
                configObj = JSON.parse(config);
              } catch (e) {
                return errorTextResult(`Invalid JSON in config parameter: ${(e as Error).message}`);
              }
            } else {
              configObj = config;
            }
            const result = await client.post("/run-worksheet", configObj);
            return jsonResult(result);
          }

          case "get_run_job": {
            requireParam(jobId, "jobId", "get_run_job");
            const result = await client.get(`/run-worksheet/${encodeURIComponent(jobId)}`);
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