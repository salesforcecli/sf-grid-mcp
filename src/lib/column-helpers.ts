/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

import { GridClient } from "../client.js";
import { configCache } from "./column-config-cache.js";
import { resolveColumnRef } from "./config-helpers.js";

// Result builders moved to result-helpers.ts (Bucket E.1, W-22703908) so
// non-column tools can use them without dragging in column-cache imports.
// Re-exported here for back-compat with existing column-tool imports.
export { textResult, errorTextResult, jsonResult, errorResult } from "./result-helpers.js";

// ---------------------------------------------------------------------------
// Reference resolution
// ---------------------------------------------------------------------------

/** Build {$N} indexed instruction from {ColumnName} references */
export function resolveInstructionRefs(
  instruction: string,
  worksheetColumns: any[]
): { instruction: string; referenceAttributes: any[] } {
  const refPattern = /\{([^}]+)\}/g;
  const refs: any[] = [];
  const seenExprs = new Map<string, number>();

  let resolved = instruction;
  const matches = [...instruction.matchAll(refPattern)];

  for (const match of matches) {
    const rawName = match[1];
    if (rawName.startsWith("$")) continue;

    const dotIdx = rawName.indexOf(".");
    const colName = dotIdx >= 0 ? rawName.substring(0, dotIdx) : rawName;
    const fieldName = dotIdx >= 0 ? rawName.substring(dotIdx + 1) : undefined;

    const ref = resolveColumnRef(colName, worksheetColumns);
    if (!ref) continue;

    const exprKey = `${ref.columnId}:${fieldName ?? ""}`;
    if (seenExprs.has(exprKey)) continue;

    const idx = refs.length + 1;
    seenExprs.set(exprKey, idx);
    refs.push({
      columnId: ref.columnId,
      columnName: ref.columnName,
      columnType: ref.columnType,
      ...(fieldName ? { fieldName } : {}),
    });
    resolved = resolved.replaceAll(match[0], `{$${idx}}`);
  }

  return { instruction: resolved, referenceAttributes: refs };
}

// ---------------------------------------------------------------------------
// Save / reprocess switch
// ---------------------------------------------------------------------------

/**
 * Recursively remove keys whose value is `null` or `undefined`. Core's JSON
 * schema validation rejects explicit nulls (e.g. `compoundFieldName: null`,
 * `advancedMode: null`) with "null found, X expected" errors. The /data-generic
 * endpoint returns nulls for unset fields, so when typed mutations re-fetch
 * after a cache miss we have to strip them before round-tripping back to Core.
 */
function stripNulls(value: any): any {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined) continue;
      out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}

export async function saveOrReprocess(
  client: GridClient,
  worksheetId: string,
  columnId: string,
  config: any,
  reprocess: boolean,
  name?: string
): Promise<any> {
  // Body shape matches column.add: { name, type, config: <full outer wrapper> }.
  // Core's normalizeNumberOfRows reads queryResponseFormat from the wrapper; if
  // we send only the inner, it defaults numberOfRows to DEFAULT_ROW_LIMIT (200)
  // and the worksheet grows to match. The gRPC EditColumnAndReprocess builder
  // also NPEs without `name`.
  const cleanConfig = stripNulls(config);
  const body: Record<string, any> = { type: cleanConfig?.type, config: cleanConfig };
  if (name !== undefined) body.name = name;
  const result = reprocess
    ? await client.put(`/worksheets/${encodeURIComponent(worksheetId)}/columns/${encodeURIComponent(columnId)}`, body)
    : await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/columns/${encodeURIComponent(columnId)}/save`, body);
  configCache.set(columnId, cleanConfig);
  return result;
}