/**
 * MCP resource templates for worksheet-level data:
 *   - grid://worksheets/{id}/schema  (TTL 30s)
 *   - grid://worksheets/{id}/status  (TTL 10s)
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GridClient } from "../client.js";
import { ResourceCache } from "../lib/resource-cache.js";
import { extractRowIds, countColumnStatuses } from "../lib/worksheet-data-helpers.js";

const SCHEMA_TTL_MS = 30_000;
const STATUS_TTL_MS = 10_000;

export function registerWorksheetResources(server: McpServer, client: GridClient, cache: ResourceCache): void {
  // --- grid://worksheets/{id}/schema ---
  server.resource(
    "worksheet-schema",
    new ResourceTemplate("grid://worksheets/{id}/schema", { list: undefined }),
    { description: "Column schema, types, dependency graph, and row count for a worksheet", mimeType: "application/json" },
    async (uri, variables) => {
      const id = String(variables.id);
      const cacheKey = `worksheet-schema:${id}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const data = await client.get(`/worksheets/${encodeURIComponent(id)}/data`);

      const columns = (data.columns || []).map((col: any) => {
        const deps: string[] = [];
        const innerCfg = col.config?.config;
        if (innerCfg) {
          // Collect column references from various reference fields
          for (const refField of [
            "referenceAttributes",
            "utteranceReferences",
            "runIfReferenceAttributes",
          ]) {
            if (Array.isArray(innerCfg[refField])) {
              for (const ref of innerCfg[refField]) {
                if (ref.columnId) deps.push(ref.columnId);
              }
            }
          }
          // Single-column references
          for (const singleRef of [
            "inputUtterance",
            "inputColumnReference",
            "referenceColumnReference",
            "conversationHistory",
            "initialState",
          ]) {
            if (innerCfg[singleRef]?.columnId) {
              deps.push(innerCfg[singleRef].columnId);
            }
          }
          if (innerCfg.referenceColumnId) {
            deps.push(innerCfg.referenceColumnId);
          }
        }

        return {
          id: col.id,
          name: col.name,
          type: col.type,
          dependsOn: [...new Set(deps)],
        };
      });

      const result = {
        contents: [{
          uri: uri.href,
          mimeType: "application/json" as const,
          text: JSON.stringify({
            worksheetId: id,
            worksheetName: data.name,
            workbookId: data.workbookId,
            rowCount: extractRowIds(data).length,
            columns,
          }, null, 2),
        }],
      };

      cache.set(cacheKey, result, SCHEMA_TTL_MS);
      return result;
    },
  );

  // --- grid://worksheets/{id}/status ---
  server.resource(
    "worksheet-status",
    new ResourceTemplate("grid://worksheets/{id}/status", { list: undefined }),
    { description: "Per-column processing status counts (complete/inprogress/failed/stale) for a worksheet", mimeType: "application/json" },
    async (uri, variables) => {
      const id = String(variables.id);
      const cacheKey = `worksheet-status:${id}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const data = await client.get(`/worksheets/${encodeURIComponent(id)}/data`);
      const stats = countColumnStatuses(data);

      const completionPct = stats.total > 0
        ? Math.round((stats.done / stats.total) * 100)
        : 100;

      const result = {
        contents: [{
          uri: uri.href,
          mimeType: "application/json" as const,
          text: JSON.stringify({
            worksheetId: id,
            worksheetName: data.name,
            allDone: stats.allDone,
            completionPct,
            statusCounts: stats.statusCounts,
            columns: stats.columnSummaries,
            totalRows: stats.totalRows,
          }, null, 2),
        }],
      };

      cache.set(cacheKey, result, STATUS_TTL_MS);
      return result;
    },
  );
}
