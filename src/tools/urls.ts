/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GridClient } from "../client.js";
import { requireParam, ValidationError } from "../lib/validation.js";
import { errorResult, errorTextResult, textResult } from "../lib/result-helpers.js";

export function registerUrlTools(server: McpServer, client: GridClient): void {
  server.tool(
    "get_url",
    `Generate a Lightning Experience URL for a Salesforce resource. Supports:
- grid: Agentforce Grid Studio workbook/worksheet (default)
- record: Lightning record page for any SObject
- flow: Flow Builder for a specific flow
- setup: Setup page (e.g. ObjectManager, FlowDefinition)

Returns the full URL that can be opened in a browser.`,
    {
      type: z.enum(["grid", "record", "flow", "setup"]).optional().describe(
        "Type of URL to generate (default: 'grid')"
      ),
      workbookId: z.string().optional().describe("Grid workbook ID (for type 'grid')"),
      worksheetId: z.string().optional().describe("Grid worksheet ID (for type 'grid', optional)"),
      recordId: z.string().optional().describe("Record ID (for type 'record')"),
      sobjectType: z.string().optional().describe("SObject API name, e.g. 'Account' (for type 'record')"),
      flowId: z.string().optional().describe("Flow definition ID (for type 'flow')"),
      page: z.string().optional().describe("Setup page name, e.g. 'ObjectManager', 'FlowDefinition' (for type 'setup')"),
    },
    async ({ type: _type, workbookId, worksheetId, recordId, sobjectType, flowId, page }) => {
      try {
        const type = _type ?? "grid";
        const base = client.lightningBaseUrl;

        switch (type) {
          case "grid": {
            requireParam(workbookId, "workbookId", "type 'grid'");
            let url = `${base}/AgentforceGrid/gridStudio.app#/grid?gridId=${encodeURIComponent(workbookId)}`;
            if (worksheetId) {
              url += `&worksheetId=${encodeURIComponent(worksheetId)}`;
            }
            return textResult(url);
          }

          case "record": {
            requireParam(recordId, "recordId", "type 'record'");
            requireParam(sobjectType, "sobjectType", "type 'record'");
            const url = `${base}/lightning/r/${encodeURIComponent(sobjectType)}/${encodeURIComponent(recordId)}/view`;
            return textResult(url);
          }

          case "flow": {
            requireParam(flowId, "flowId", "type 'flow'");
            const url = `${base}/builder_platform_interaction/flowBuilder.app?flowId=${encodeURIComponent(flowId)}`;
            return textResult(url);
          }

          case "setup": {
            requireParam(page, "page", "type 'setup'");
            const url = `${base}/lightning/setup/${encodeURIComponent(page)}/home`;
            return textResult(url);
          }

          default:
            return errorTextResult(`Error: Unknown URL type '${type}'`);
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