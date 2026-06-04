import { GridClient } from "../../src/client.js";

/**
 * Poll a worksheet until all cells reach a terminal status (Complete or Error)
 * — or until maxAttempts elapses. Returns the final per-column counts.
 *
 * This mirrors the runtime tool `poll_worksheet_status` but stays inside the
 * eval harness so suites don't need the MCP server running.
 */
export async function waitForCellsTerminal(
  client: GridClient,
  worksheetId: string,
  opts: { maxAttempts?: number; intervalMs?: number } = {}
): Promise<{
  attempts: number;
  done: boolean;
  total: number;
  complete: number;
  error: number;
}> {
  const maxAttempts = opts.maxAttempts ?? 30;
  const intervalMs = opts.intervalMs ?? 3000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const data = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}/data`);
    const counts = countCells(data);
    if (counts.inProgress === 0 && counts.queued === 0 && counts.new === 0) {
      return {
        attempts: attempt,
        done: true,
        total: counts.total,
        complete: counts.complete,
        error: counts.error,
      };
    }
    if (attempt < maxAttempts) await sleep(intervalMs);
  }

  // Timeout — read once more to report the latest counts.
  const final = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}/data`);
  const counts = countCells(final);
  return {
    attempts: maxAttempts,
    done: false,
    total: counts.total,
    complete: counts.complete,
    error: counts.error,
  };
}

interface CellCounts {
  total: number;
  complete: number;
  inProgress: number;
  queued: number;
  error: number;
  new: number;
}

function countCells(worksheetData: any): CellCounts {
  const out: CellCounts = { total: 0, complete: 0, inProgress: 0, queued: 0, error: 0, new: 0 };
  const columnData = worksheetData?.columnData ?? {};
  for (const cells of Object.values(columnData)) {
    if (!Array.isArray(cells)) continue;
    for (const c of cells as Array<{ status?: string }>) {
      out.total++;
      const s = (c.status ?? "").toLowerCase();
      if (s === "complete") out.complete++;
      else if (s === "inprogress") out.inProgress++;
      else if (s === "queued") out.queued++;
      else if (s === "error") out.error++;
      else if (s === "new") out.new++;
    }
  }
  return out;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}