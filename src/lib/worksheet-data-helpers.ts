/**
 * Shared helpers for accessing worksheet data in a format-agnostic way.
 *
 * The Grid API response structure uses `columnData` (a map of columnId -> cells)
 * at the worksheet level, rather than embedding cells inside each column object.
 * The `rows` array may or may not be present; row IDs can be extracted from cells.
 *
 * These helpers provide backwards-compatible access that works with both old
 * (col.cells, data.rows) and new (data.columnData) response formats.
 */

// ---------------------------------------------------------------------------
// Row ID extraction
// ---------------------------------------------------------------------------

/**
 * Extract ordered row IDs from a worksheet data response.
 * Tries `data.rows` first (may still exist), then falls back to extracting
 * unique `worksheetRowId` values from `columnData`, preserving cell order.
 */
export function extractRowIds(data: any): string[] {
  // Prefer explicit rows array if present
  if (Array.isArray(data?.rows) && data.rows.length > 0) {
    return data.rows;
  }

  // Fall back to extracting from columnData
  if (data?.columnData && typeof data.columnData === "object") {
    const columnIds = Object.keys(data.columnData);
    if (columnIds.length > 0) {
      // Use the first column's cells to preserve row order
      const firstColCells = data.columnData[columnIds[0]];
      if (Array.isArray(firstColCells)) {
        const seen = new Set<string>();
        const rowIds: string[] = [];
        for (const cell of firstColCells) {
          const rid = cell?.worksheetRowId;
          if (rid && !seen.has(rid)) {
            seen.add(rid);
            rowIds.push(rid);
          }
        }
        return rowIds;
      }
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Column cell access
// ---------------------------------------------------------------------------

/**
 * Get cells for a specific column from a worksheet data response.
 * Tries `data.columnData[columnId]` first, then falls back to `col.cells`.
 */
export function getColumnCells(data: any, columnId: string): any[] {
  // New format: columnData map at worksheet level
  if (data?.columnData?.[columnId]) {
    return data.columnData[columnId];
  }

  // Old format: cells nested inside column objects
  if (Array.isArray(data?.columns)) {
    const col = data.columns.find((c: any) => c.id === columnId);
    if (col?.cells) {
      return col.cells;
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Status counting (unified replacement for duplicate implementations)
// ---------------------------------------------------------------------------

const KNOWN_STATUSES = new Set(["Complete", "InProgress", "New", "Error", "Queued"]);

export interface StatusCounts {
  Complete: number;
  InProgress: number;
  New: number;
  Error: number;
  Queued: number;
  Other: number;
}

export interface ColumnStatusResult {
  statusCounts: StatusCounts;
  columnSummaries: Record<string, unknown>[];
  totalRows: number;
  total: number;
  done: number;
  allDone: boolean;
}

/**
 * Count cell statuses across all columns in a worksheet data response.
 * Works with both old (col.cells) and new (columnData) response formats.
 */
export function countColumnStatuses(data: any): ColumnStatusResult {
  const columns: any[] = data?.columns || [];
  const totalRows = extractRowIds(data).length;
  const columnSummaries: Record<string, unknown>[] = [];
  const statusCounts: StatusCounts = {
    Complete: 0, InProgress: 0, New: 0, Error: 0, Queued: 0, Other: 0,
  };

  for (const col of columns) {
    const cells = getColumnCells(data, col.id);
    const colStatus: StatusCounts = {
      Complete: 0, InProgress: 0, New: 0, Error: 0, Queued: 0, Other: 0,
    };
    for (const cell of cells) {
      const s: string = cell.status || "New";
      const bucket = KNOWN_STATUSES.has(s) ? s as keyof StatusCounts : "Other";
      colStatus[bucket]++;
      statusCounts[bucket]++;
    }
    columnSummaries.push({ id: col.id, name: col.name, type: col.type, ...colStatus });
  }

  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const done = statusCounts.Complete + statusCounts.Error;
  const allDone = total > 0 && total === done;

  return { statusCounts, columnSummaries, totalRows, total, done, allDone };
}
