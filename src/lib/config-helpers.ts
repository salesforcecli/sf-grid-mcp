/**
 * Shared helper functions for column config resolution and mutation.
 */

import { GridClient } from "../client.js";
import { configCache } from "./column-config-cache.js";

/**
 * Default queryResponseFormat for a given column type. Object columns import
 * external rows (WHOLE_COLUMN); every other type processes the existing rows
 * (EACH_ROW). Mirrors the defaults Core's UI sends on column creation. We need
 * this because /data-generic strips the wrapper from the response, so when a
 * typed mutation re-fetches a column on cold cache there's no other way to
 * know what queryResponseFormat to send back. Without it, Core's
 * normalizeNumberOfRows defaults numberOfRows to DEFAULT_ROW_LIMIT (200) and
 * the worksheet grows to match.
 */
function defaultQueryResponseFormat(columnType: string): Record<string, string> {
  return columnType === "Object"
    ? { type: "WHOLE_COLUMN", splitByType: "OBJECT_PER_ROW" }
    : { type: "EACH_ROW" };
}

/**
 * Get or reconstruct the full outer config for a column.
 * First checks the in-memory cache. On miss, fetches the worksheet data
 * from the generic endpoint (which returns nested config.config) and
 * reconstructs the outer config object that typed mutation tools need.
 *
 * Returns null only if the column has no config at all (shouldn't happen).
 */
export async function getOrFetchColumnConfig(
  client: GridClient,
  columnId: string,
  worksheetId: string,
): Promise<any | null> {
  // Fast path: cache hit
  const cached = configCache.get(columnId);
  if (cached) return cached;

  // Slow path: fetch from API using the generic endpoint which includes full config
  const wsData = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}/data-generic`);
  const columns: any[] = wsData?.columns ?? [];
  const col = columns.find((c: any) => c.id === columnId);

  if (!col?.config) return null;

  // /data-generic returns col.config = { config: {...innerFields} } and strips
  // the wrapper (queryResponseFormat, autoUpdate, numberOfRows). Synthesize
  // queryResponseFormat from column type so round-tripping back to Core's
  // PUT/POST doesn't fail schema validation. numberOfRows is intentionally
  // not synthesized — Core's read API hides the user's stored value, so
  // inferring it would silently overwrite their setting. For WHOLE_COLUMN
  // columns this means Core clamps numberOfRows to DEFAULT_ROW_LIMIT (200)
  // and the worksheet may grow on edit; that's accepted as a known limitation
  // until Core exposes the wrapper on /data-generic.
  const innerConfig = col.config.config ?? col.config;
  const outerConfig: Record<string, any> = {
    type: col.type,
    queryResponseFormat: defaultQueryResponseFormat(col.type),
    autoUpdate: true,
    config: innerConfig,
  };

  // Cache it for future use
  configCache.set(columnId, outerConfig);
  return outerConfig;
}

/**
 * Fetch worksheet data containing the given column and extract its config.
 * Searches all worksheets in all workbooks to find the column.
 */
export async function getColumnConfig(
  client: GridClient,
  columnId: string,
  worksheetId?: string,
): Promise<{ column: any; worksheetId: string; worksheetColumns: any[] }> {
  // Fast path: if worksheetId provided, go directly to it
  if (worksheetId) {
    const wsData = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}/data`);
    const columns: any[] = wsData?.columns ?? [];
    const match = columns.find((col: any) => col.id === columnId);
    if (match) {
      return { column: match, worksheetId, worksheetColumns: columns };
    }
    throw new Error(`Column ${columnId} not found in worksheet ${worksheetId}`);
  }

  // Slow path: scan all workbooks/worksheets
  const workbooks = await client.get("/workbooks");
  const wbList = Array.isArray(workbooks) ? workbooks : workbooks?.workbooks ?? [];

  for (const wb of wbList) {
    const workbook = await client.get(`/workbooks/${encodeURIComponent(wb.id)}`);
    const worksheetIds: string[] = workbook?.worksheetIds ?? workbook?.worksheets?.map((w: any) => w.id) ?? [];

    for (const wsId of worksheetIds) {
      const wsData = await client.get(`/worksheets/${encodeURIComponent(wsId)}/data`);
      const columns: any[] = wsData?.columns ?? [];
      const match = columns.find((col: any) => col.id === columnId);
      if (match) {
        return { column: match, worksheetId: wsId, worksheetColumns: columns };
      }
    }
  }

  throw new Error(`Column ${columnId} not found in any worksheet`);
}

/**
 * Resolve a column reference by name (case-insensitive) or by ID.
 * Returns a referenceAttribute-compatible object, or null if not found.
 */
export function resolveColumnRef(
  nameOrId: string,
  columns: any[]
): { columnId: string; columnName: string; columnType: string } | null {
  const lower = nameOrId.toLowerCase();

  for (const col of columns) {
    if (col.id === nameOrId || (col.name && col.name.toLowerCase() === lower)) {
      return {
        columnId: col.id,
        columnName: col.name,
        columnType: col.type ?? col.config?.type ?? "Text",
      };
    }
  }

  return null;
}

/**
 * Deep merge changes into existing config. Arrays are replaced, not concatenated.
 * Returns a new object; does not mutate inputs.
 */
export function mergeConfig(existing: any, changes: Record<string, any>): any {
  if (existing == null || typeof existing !== "object" || Array.isArray(existing)) {
    return changes;
  }

  const result: Record<string, any> = { ...existing };

  for (const [key, value] of Object.entries(changes)) {
    const prev = result[key];
    if (
      value != null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      prev != null &&
      typeof prev === "object" &&
      !Array.isArray(prev)
    ) {
      result[key] = mergeConfig(prev, value);
    } else {
      result[key] = value;
    }
  }

  return result;
}
