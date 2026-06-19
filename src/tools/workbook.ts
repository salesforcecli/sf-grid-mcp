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

export function registerWorkbookTool(server: McpServer, client: GridClient): void {
  server.tool(
    "workbook",
    "Manage workbooks: list, create, create_with_worksheet, get, get_worksheets, delete",
    {
      action: z.enum(["list", "create", "create_with_worksheet", "get", "get_worksheets", "delete"]),
      workbookId: z.string().optional().describe("Required for get, get_worksheets, delete"),
      name: z.string().optional().describe("Required for create and create_with_worksheet (workbook name)"),
      worksheetName: z.string().optional().describe("Required for create_with_worksheet"),
    },
    async ({ action, workbookId, name, worksheetName }) => {
      try {
        switch (action) {
          case "list": {
            const result = await client.get("/workbooks");
            return jsonResult(result);
          }

          case "create": {
            requireParam(name, "name", "create");
            const result = await client.post("/workbooks", { name });
            return jsonResult(result);
          }

          case "create_with_worksheet": {
            requireParam(name, "name", "create_with_worksheet");
            requireParam(worksheetName, "worksheetName", "create_with_worksheet");
            const workbook = await client.post("/workbooks", { name });
            const worksheet = await client.post("/worksheets", { name: worksheetName, workbookId: workbook.id });
            const result = { workbookId: workbook.id, worksheetId: worksheet.id, workbook, worksheet };
            return jsonResult(result);
          }

          case "get": {
            requireParam(workbookId, "workbookId", "get");
            const result = await client.get(`/workbooks/${encodeURIComponent(workbookId)}`);
            return jsonResult(result);
          }

          case "get_worksheets": {
            requireParam(workbookId, "workbookId", "get_worksheets");
            const result = await client.get(`/workbooks/${encodeURIComponent(workbookId)}/worksheets`);
            return jsonResult(result);
          }

          case "delete": {
            requireParam(workbookId, "workbookId", "delete");
            const result = await client.delete(`/workbooks/${encodeURIComponent(workbookId)}`);
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
