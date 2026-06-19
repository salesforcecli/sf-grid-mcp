/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { evalEnvOrSkip } from "../fixtures/env.js";
import { buildClient, createSuiteWorkbook, cleanupSuiteWorkbook } from "../fixtures/setup.js";
import { waitForCellsTerminal, sleep } from "../helpers/polling.js";
import type { GridClient } from "../../src/client.js";

/**
 * Phase 2 — Typed Bucket C.2 path: column.add → save → reprocess on an AI column
 * where the config is a typed object (not a JSON string).
 *
 * Locks in the typed-object code path that landed in W-22702833 plus the
 * save-and-reprocess flow that exercises the Core round-trip end-to-end.
 *
 * Async-status notes (per the column-creation-slow Slack thread):
 *  - The `Complete → Stale` flip after save rides on Core's MQ. Latency on
 *    PLATFORM_METABOLISM_ASYNC_ACTIVITY can be 60s+. We poll, not snapshot.
 *  - After reprocess, cells transition Stale → Queued → InProgress → Complete.
 *    A short grace sleep keeps the first poll from seeing "all Stale" and
 *    short-circuiting (Stale is treated as terminal by waitForCellsTerminal).
 */
describe("Phase 2: typed config (Bucket C.2)", () => {
  const env = evalEnvOrSkip("phase-2-typed-config");
  if (!env) {
    it.skip("skipped — env not set", () => {});
    return;
  }

  let client: GridClient;
  let workbookId: string | undefined;
  let worksheetId: string;
  let columnId: string;
  let rowCount: number;

  const aiConfig = (instruction: string) => ({
    type: "AI" as const,
    queryResponseFormat: { type: "EACH_ROW" as const },
    autoUpdate: true,
    config: {
      autoUpdate: true,
      instruction,
      mode: "llm",
      modelConfig: {
        modelId: "sfdc_ai__DefaultGPT4Omni",
        modelName: "GPT-4o (default)",
      },
      responseFormat: { type: "PLAIN_TEXT" as const },
    },
  });

  beforeAll(async () => {
    client = buildClient(env);
    const ids = await createSuiteWorkbook(client, "phase-2");
    workbookId = ids.workbookId;
    worksheetId = ids.worksheetId;
    // Row count is captured after column.add (columnData is empty until a
    // column exists, so reading it earlier would always return 0).
  }, 30_000);

  afterAll(async () => {
    await cleanupSuiteWorkbook(client, workbookId);
  });

  it("column.add accepts a typed-object config and returns a column id", async () => {
    const result = await client.post(
      `/worksheets/${encodeURIComponent(worksheetId)}/columns`,
      {
        name: "AI Greeting (typed)",
        type: "AI",
        config: aiConfig("Say a one-sentence friendly hello."),
      }
    );
    expect(result.id).toMatch(/^1W5/);
    expect(result.name).toBe("AI Greeting (typed)");
    expect(result.type).toBe("AI");
    columnId = result.id;

    // Capture the row count Core seeded into the worksheet for use by later
    // assertions in this suite.
    const ws = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}/data`);
    const cells = (ws.columnData?.[columnId] as unknown[] | undefined) ?? [];
    rowCount = cells.length;
    expect(rowCount).toBeGreaterThan(0);
  });

  it("cells reach Complete after initial column.add", async () => {
    const final = await waitForCellsTerminal(client, worksheetId, { maxAttempts: 40 });
    expect(final.done).toBe(true);
    expect(final.error).toBe(0);
    expect(final.complete).toBe(rowCount);
  }, 180_000);

  it("column.save with a modified instruction persists the new config", async () => {
    const newInstruction = "Say a one-sentence friendly hello in pirate style.";
    await client.post(
      `/worksheets/${encodeURIComponent(worksheetId)}/columns/${encodeURIComponent(columnId)}/save`,
      {
        name: "AI Greeting (typed)",
        type: "AI",
        config: aiConfig(newInstruction),
      }
    );

    // Verify the saved instruction is what Core now has. We don't assert on
    // the column status flip — with autoUpdate=true Core may auto-reprocess
    // and skip the Stale intermediate, while autoUpdate=false leaves cells
    // Stale until the next reprocess. Either is correct; the contract for
    // Bucket C.2 is that the typed config round-trips through save.
    const ws = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}`);
    const col = ws.columns?.find((c: any) => c.id === columnId);
    expect(col).toBeDefined();
    expect(col.config?.instruction).toBe(newInstruction);
  });

  it("column.reprocess re-runs cells against the new instruction", async () => {
    await client.post(
      `/worksheets/${encodeURIComponent(worksheetId)}/columns/${encodeURIComponent(columnId)}/reprocess`,
      {
        name: "AI Greeting (typed)",
        type: "AI",
        config: aiConfig("Say a one-sentence friendly hello in pirate style."),
      }
    );

    // Grace period so cells transition Stale → Queued before the first poll;
    // otherwise waitForCellsTerminal sees "all Stale" and exits immediately.
    await sleep(5_000);

    const final = await waitForCellsTerminal(client, worksheetId, { maxAttempts: 40 });
    expect(final.done).toBe(true);
    expect(final.error).toBe(0);
    expect(final.complete).toBe(rowCount);
  }, 180_000);
});

async function waitForColumnStatus(
  client: GridClient,
  worksheetId: string,
  columnId: string,
  expected: string,
  opts: { maxAttempts: number; intervalMs: number }
): Promise<string | undefined> {
  let last: string | undefined;
  for (let i = 0; i < opts.maxAttempts; i++) {
    const ws = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}`);
    const col = ws.columns?.find((c: any) => c.id === columnId);
    last = col?.status;
    if (last === expected) return last;
    if (i < opts.maxAttempts - 1) await sleep(opts.intervalMs);
  }
  return last;
}
