import { describe, it, expect, beforeAll } from "vitest";
import { evalEnvOrSkip } from "../fixtures/env.js";
import { buildClient } from "../fixtures/setup.js";
import { applyGridSpec } from "../../src/lib/resolution-engine.js";
import type { GridClient } from "../../src/client.js";

/**
 * Phase 5 — Error paths (Bucket E.2).
 *
 * Verifies that broken specs / requests reach the user as structured error
 * results, not silent successes. The retry-policy classification + backoff
 * logic is already covered by unit tests in error-handling-bucket-e2.test.ts;
 * this phase exercises the user-facing surfaces against orgfarm to make sure
 * those error paths actually reach the caller end-to-end.
 *
 * Specifically locked in:
 *   - apply_grid surfaces spec-validation errors (not silent success)
 *   - apply_grid surfaces YAML parse errors (not silent success)
 *   - apply_grid distinguishes recoverable vs fatal errors
 */
describe("Phase 5: error paths (Bucket E.2)", () => {
  const env = evalEnvOrSkip("phase-5-error-paths");
  if (!env) {
    it.skip("skipped — env not set", () => {});
    return;
  }

  let client: GridClient;
  beforeAll(() => {
    client = buildClient(env);
  });

  it("apply_grid surfaces a YAML parse error rather than silently failing", async () => {
    const malformedSpec = `workbook: Eval Phase5 Bad
worksheet: Bad
columns:
  - name: Topic
    type: text
  - name: Broken[unclosed-bracket
    type: text
data:
  Topic
    - "value-without-colon"
`;
    const result = await applyGridSpec(client, malformedSpec);
    // Either a parse error or a validate error — both are "structured failure"
    // outcomes and that's what we want to lock in.
    expect(result.errors.length).toBeGreaterThan(0);
    const errMsg = result.errors.map((e: any) => e.message ?? "").join(" | ");
    expect(errMsg.length).toBeGreaterThan(0);
  });

  it("apply_grid surfaces a spec-validation error when a column is missing required fields", async () => {
    const spec = `workbook: Eval Phase5 Validate
worksheet: V
columns:
  - name: NoType
`;
    const result = await applyGridSpec(client, spec);
    expect(result.errors.length).toBeGreaterThan(0);
    const errMsg = result.errors.map((e: any) => e.message ?? "").join(" | ");
    expect(errMsg).toMatch(/type/i);
  });

  it("apply_grid spec validation failures are non-recoverable (fatal)", async () => {
    // A spec-validation error happens before any Core call, so there's
    // nothing to retry. The tool layer wraps these with isError:true; the
    // engine layer marks them recoverable=false. Lock in the engine contract.
    const spec = `workbook: Eval Phase5 Fatal
worksheet: F
columns:
  - name: NoType
`;
    const result = await applyGridSpec(client, spec);
    expect(result.errors.length).toBeGreaterThan(0);
    const fatalErrors = result.errors.filter((e: any) => !e.recoverable);
    expect(fatalErrors.length).toBeGreaterThan(0);
  });
});
