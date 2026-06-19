/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { evalEnvOrSkip } from "../fixtures/env.js";
import { buildClient } from "../fixtures/setup.js";
import type { GridClient } from "../../src/client.js";

describe("Phase 1: sanity", () => {
  const env = evalEnvOrSkip("phase-1-sanity");
  if (!env) {
    it.skip("skipped — env not set", () => {});
    return;
  }

  let client: GridClient;
  beforeAll(() => {
    client = buildClient(env);
  });

  it("workbook.list returns a list shape", async () => {
    const res = await client.get("/workbooks");
    expect(res).toBeTruthy();
    // Core wraps the list; accept either {workbooks: [...]} or a direct array.
    const list = Array.isArray(res) ? res : res.workbooks ?? res.results ?? res;
    expect(Array.isArray(list)).toBe(true);
  });

  it("discover.llm_models returns at least one model with the expected shape", async () => {
    const res = await client.get("/llm-models");
    expect(res).toBeTruthy();
    const models = res.models ?? res;
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    const m = models[0];
    expect(typeof m.name).toBe("string");
    expect(typeof m.label).toBe("string");
  });
});