import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { evalEnvOrSkip } from "../fixtures/env.js";
import { buildClient, cleanupSuiteWorkbook } from "../fixtures/setup.js";
import { applyGridSpec } from "../../src/lib/resolution-engine.js";
import type { GridClient } from "../../src/client.js";

/**
 * Phase 4 — YAML DSL via apply_grid (Bucket D).
 *
 * Locks in the YAML DSL gaps Bucket D (W-22703237) fixed:
 *   - Filter operator shorthand → canonical mapping (eq → EQUAL_TO)
 *   - Singular `value:` → single-element `values:` array coercion
 *   - Helpful error message listing both shorthand and canonical operator names
 * Plus the soql shorthand path that was unblocked by W-22711273 PR #28
 * (validator skips T-030 when soql is present).
 *
 * apply_grid creates its own workbook from the spec, so this suite tracks the
 * created workbook id and deletes it in afterAll.
 */
describe("Phase 4: YAML DSL (Bucket D)", () => {
  const env = evalEnvOrSkip("phase-4-yaml-dsl");
  if (!env) {
    it.skip("skipped — env not set", () => {});
    return;
  }

  let client: GridClient;
  const createdWorkbookIds: string[] = [];

  beforeAll(() => {
    client = buildClient(env);
  });

  afterAll(async () => {
    for (const id of createdWorkbookIds) {
      await cleanupSuiteWorkbook(client, id);
    }
  });

  it("happy path: workbook + worksheet + Text + AI columns + data", async () => {
    const spec = `workbook: Eval Phase4 Happy
worksheet: DSL
model: gpt-4-omni
columns:
  - name: Topic
    type: text
  - name: Summary
    type: ai
    instruction: "Give me one sentence about: {Topic}."
data:
  Topic:
    - "REST APIs"
    - "OAuth"
    - "Bazel"
`;

    const result = await applyGridSpec(client, spec);
    if (result.workbookId) createdWorkbookIds.push(result.workbookId);

    expect(result.workbookId).toMatch(/^1W4/);
    expect(result.worksheetId).toMatch(/^1W1/);
    expect(result.columns.Topic).toMatch(/^1W5/);
    expect(result.columns.Summary).toMatch(/^1W5/);
    expect(result.errors).toEqual([]);
  }, 60_000);

  it("filter operator shorthand `eq` is mapped to EQUAL_TO and scalar value is wrapped", async () => {
    const spec = `workbook: Eval Phase4 Filters
worksheet: DSL
columns:
  - name: AccountTechCo
    type: object
    object: Account
    fields: [Id, Name, Industry]
    filters:
      - field: Industry
        operator: eq
        value: Technology
`;

    const result = await applyGridSpec(client, spec);
    if (result.workbookId) createdWorkbookIds.push(result.workbookId);

    expect(result.errors).toEqual([]);
    expect(result.columns.AccountTechCo).toMatch(/^1W5/);

    // Inspect the persisted column config via the worksheet-level endpoint —
    // operator should be canonical EQUAL_TO and the scalar value should be
    // wrapped into {value, type}.
    const ws = await client.get(`/worksheets/${encodeURIComponent(result.worksheetId!)}`);
    const col = ws.columns?.find((c: any) => c.id === result.columns.AccountTechCo);
    expect(col).toBeDefined();
    const filters = col.config?.filters;
    expect(Array.isArray(filters)).toBe(true);
    expect(filters[0].operator).toBe("EQUAL_TO");
    expect(filters[0].values).toHaveLength(1);
    expect(filters[0].values[0].value).toBe("Technology");
  }, 60_000);

  it("soql shorthand on Object column does not get rejected by validator (PR #28)", async () => {
    const spec = `workbook: Eval Phase4 SOQL
worksheet: DSL
columns:
  - name: AccountQuery
    type: object
    soql: SELECT Id, Name, Industry FROM Account LIMIT 5
`;

    const result = await applyGridSpec(client, spec);
    if (result.workbookId) createdWorkbookIds.push(result.workbookId);

    // PR #28 made T-030 skip when soql is present. If it regresses, the
    // validator stops before the expander and emits a T-030 error.
    const t030Errors = result.errors.filter((e: any) => /T-030/.test(e.message ?? ""));
    expect(t030Errors).toEqual([]);
    // The column should be created (it may have run-time errors against an
    // empty Account table on this orgfarm, but the YAML DSL itself shouldn't
    // be the cause of failure).
    expect(result.columns.AccountQuery).toBeDefined();
  }, 60_000);

  it("bad operator surfaces a helpful error listing both shorthand and canonical names", async () => {
    const spec = `workbook: Eval Phase4 BadOp
worksheet: DSL
columns:
  - name: AccountQuery
    type: object
    object: Account
    fields: [Id, Name]
    filters:
      - field: Industry
        operator: bogus_op
        value: Technology
`;

    const result = await applyGridSpec(client, spec);
    if (result.workbookId) createdWorkbookIds.push(result.workbookId);

    // Should fail; error message should mention both shorthand and canonical names.
    expect(result.errors.length).toBeGreaterThan(0);
    const errMsg = result.errors.map((e: any) => e.message ?? "").join(" | ");
    // Bucket D made resolveFilterOperator throw with both naming styles listed.
    expect(errMsg).toMatch(/eq.*EQUAL_TO|EQUAL_TO.*eq/);
  }, 60_000);
});
