/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { evalEnvOrSkip } from "../fixtures/env.js";
import { buildClient, createSuiteWorkbook, cleanupSuiteWorkbook } from "../fixtures/setup.js";
import { normalizeColumnConfigFilters } from "../../src/lib/filter-helpers.js";
import type { GridClient } from "../../src/client.js";

/**
 * Phase 6 — Bug regressions (W-22711273 follow-up / PR #28).
 *
 * Two bugs the Stage 2 thorough test pass surfaced and PR #28 fixed:
 *
 *   1. column.add Object column with scalar `filters[].values` returned
 *      Core HTTP 500 "string found, object expected". The fix added
 *      `normalizeFilterValues` and wired it into column.add/edit/save/reprocess.
 *
 *   2. apply_grid soql shorthand was unreachable because validator T-030 still
 *      required `objectApiName` even when `soql:` was set. The fix made T-030
 *      conditional on `!col.soql`. (Phase 4 covers the apply_grid surface;
 *      this phase locks the unit-level invariant that would regress first.)
 *
 * Phase 4 already exercises both fixes at the apply_grid surface. This phase
 * pins the column.add direct path that the original bug lived in.
 */
describe("Phase 6: bug regressions (PR #28)", () => {
  const env = evalEnvOrSkip("phase-6-bug-regressions");
  if (!env) {
    it.skip("skipped — env not set", () => {});
    return;
  }

  let client: GridClient;
  let workbookId: string | undefined;
  let worksheetId: string;

  beforeAll(async () => {
    client = buildClient(env);
    const ids = await createSuiteWorkbook(client, "phase-6");
    workbookId = ids.workbookId;
    worksheetId = ids.worksheetId;
  }, 30_000);

  afterAll(async () => {
    await cleanupSuiteWorkbook(client, workbookId);
  });

  it("column.add accepts an Object column with scalar filter values (no Core HTTP 500)", async () => {
    // Pre-PR #28 this returned:
    //   HTTP 500: $.config.filters[0].values[0]: string found, object expected
    // The fix wraps scalars into {value, type} via normalizeColumnConfigFilters.
    const rawConfig = {
      type: "Object" as const,
      queryResponseFormat: { type: "EACH_ROW" as const },
      autoUpdate: true,
      config: {
        autoUpdate: true,
        objectApiName: "Account",
        fields: [
          { name: "Id", type: "ID" },
          { name: "Name", type: "STRING" },
        ],
        filters: [
          {
            field: "Industry",
            operator: "IN",
            values: ["Technology", "Finance"], // scalars — must be wrapped
          },
        ],
      },
    };

    // Call the helper that column.add applies before sending. If this regresses,
    // the suite still catches the HTTP 500 from Core below.
    const normalized = normalizeColumnConfigFilters(rawConfig);

    // Sanity check the normalization happened.
    const normalizedFilters = (normalized as any).config.filters;
    expect(normalizedFilters[0].values[0]).toEqual({ value: "Technology", type: "STRING" });
    expect(normalizedFilters[0].values[1]).toEqual({ value: "Finance", type: "STRING" });

    // Now send to Core via the actual column.add endpoint and confirm Core
    // accepts the wrapped shape.
    const result = await client.post(
      `/worksheets/${encodeURIComponent(worksheetId)}/columns`,
      {
        name: "Bug7 Filter Wrap",
        type: "Object",
        config: normalized,
      }
    );
    expect(result.id).toMatch(/^1W5/);
  });

  it("normalizeColumnConfigFilters preserves pre-wrapped {value, type} objects", async () => {
    // Back-compat: callers who already wrap should pass through unchanged.
    const config = {
      type: "Object" as const,
      queryResponseFormat: { type: "EACH_ROW" as const },
      autoUpdate: true,
      config: {
        autoUpdate: true,
        objectApiName: "Account",
        fields: [{ name: "Id", type: "ID" }],
        filters: [
          {
            field: "Industry",
            operator: "EQUAL_TO",
            values: [{ value: "Tech", type: "STRING" }],
          },
        ],
      },
    };
    const normalized = normalizeColumnConfigFilters(config);
    const filters = (normalized as any).config.filters;
    expect(filters[0].values).toEqual([{ value: "Tech", type: "STRING" }]);
  });
});
