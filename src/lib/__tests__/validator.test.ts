/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

import { describe, it, expect } from "vitest";
import { validateAndSort } from "../validator.js";
import type { GridSpec, ColumnSpec } from "../yaml-parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spec(columns: ColumnSpec[], overrides: Partial<GridSpec> = {}): GridSpec {
  return {
    workbook: "wb",
    worksheet: "ws",
    columns,
    ...overrides,
  };
}

function col(name: string, type: string, extras: Record<string, unknown> = {}): ColumnSpec {
  return { name, type, ...extras };
}

function expectNoErrors(result: ReturnType<typeof validateAndSort>) {
  expect(result.errors).toEqual([]);
}

function expectErrorCode(result: ReturnType<typeof validateAndSort>, code: string) {
  expect(result.errors.some((e) => e.code === code)).toBe(true);
}

// ---------------------------------------------------------------------------
// Pass 1: Schema validation
// ---------------------------------------------------------------------------

describe("Pass 1: Schema validation", () => {
  it("rejects duplicate column names", () => {
    const result = validateAndSort(spec([
      col("Dup", "Text"),
      col("Dup", "Text"),
    ]));
    expectErrorCode(result, "Y-004");
  });

  it("rejects invalid type", () => {
    const result = validateAndSort(spec([
      col("C1", "Banana"),
    ]));
    expectErrorCode(result, "Y-006");
  });
});

// ---------------------------------------------------------------------------
// Pass 2: Type-specific required fields
// ---------------------------------------------------------------------------

describe("Pass 2: Type-specific required fields", () => {
  it("rejects AI without instruction", () => {
    const result = validateAndSort(spec([col("C1", "AI")]));
    expectErrorCode(result, "T-001");
  });

  it("rejects Agent without agent", () => {
    const result = validateAndSort(spec([
      col("C1", "Agent", { utterance: "hi" }),
    ]));
    expectErrorCode(result, "T-010");
  });

  it("rejects Agent without utterance", () => {
    const result = validateAndSort(spec([
      col("C1", "Agent", { agent: "myAgent" }),
    ]));
    expectErrorCode(result, "T-010");
  });

  it("rejects AgentTest without agent", () => {
    const result = validateAndSort(spec([
      col("Input", "Text"),
      col("C1", "AgentTest", { inputUtterance: "Input" }),
    ]));
    expectErrorCode(result, "T-020");
  });

  it("rejects AgentTest without inputUtterance", () => {
    const result = validateAndSort(spec([
      col("C1", "AgentTest", { agent: "myAgent" }),
    ]));
    expectErrorCode(result, "T-020");
  });

  it("rejects Object without object", () => {
    const result = validateAndSort(spec([
      col("C1", "Object", { fields: ["Id"] }),
    ]));
    expectErrorCode(result, "T-030");
  });

  it("rejects Object without fields or soql", () => {
    const result = validateAndSort(spec([
      col("C1", "Object", { object: "Account" }),
    ]));
    expectErrorCode(result, "T-031");
  });

  it("accepts Object with soql shorthand and no object/fields", () => {
    const result = validateAndSort(spec([
      col("C1", "Object", { soql: "SELECT Id, Name FROM Account LIMIT 5" }),
    ]));
    expect(result.errors.filter((e) => e.code === "T-030" || e.code === "T-031")).toEqual([]);
  });

  it("accepts DataModelObject with dcsql shorthand and no dmo/dataspace/fields", () => {
    const result = validateAndSort(spec([
      col("C1", "DataModelObject", { dcsql: "SELECT * FROM SomeDmo__dlm LIMIT 5" }),
    ]));
    expect(result.errors.filter((e) => e.code === "T-090")).toEqual([]);
  });

  it("rejects DataModelObject without dmo/dataspace when dcsql absent", () => {
    const result = validateAndSort(spec([
      col("C1", "DataModelObject", { fields: ["Id"] }),
    ]));
    expectErrorCode(result, "T-090");
  });

  it("rejects Formula without formula", () => {
    const result = validateAndSort(spec([
      col("C1", "Formula", { returnType: "string" }),
    ]));
    expectErrorCode(result, "T-040");
  });

  it("rejects Formula without returnType", () => {
    const result = validateAndSort(spec([
      col("C1", "Formula", { formula: "1+1" }),
    ]));
    expectErrorCode(result, "T-040");
  });

  it("rejects Evaluation without input", () => {
    const result = validateAndSort(spec([
      col("C1", "Evaluation", { evaluationType: "COHERENCE" }),
    ]));
    expectErrorCode(result, "T-060");
  });

  it("rejects Evaluation without evaluationType", () => {
    const result = validateAndSort(spec([
      col("Source", "AI", { instruction: "hi" }),
      col("C1", "Evaluation", { input: "Source" }),
    ]));
    expectErrorCode(result, "T-060");
  });

  it("rejects Reference without source", () => {
    const result = validateAndSort(spec([
      col("C1", "Reference", { field: "Name" }),
    ]));
    expectErrorCode(result, "T-050");
  });

  it("rejects Reference without field", () => {
    const result = validateAndSort(spec([
      col("Src", "Object", { object: "Account", fields: ["Id"] }),
      col("C1", "Reference", { source: "Src" }),
    ]));
    expectErrorCode(result, "T-050");
  });

  it("rejects PromptTemplate without template", () => {
    const result = validateAndSort(spec([
      col("C1", "PromptTemplate", { inputs: {} }),
    ]));
    expectErrorCode(result, "T-070");
  });

  it("rejects PromptTemplate without inputs", () => {
    const result = validateAndSort(spec([
      col("C1", "PromptTemplate", { template: "myTmpl" }),
    ]));
    expectErrorCode(result, "T-071");
  });
});

// ---------------------------------------------------------------------------
// Pass 3: Reference integrity
// ---------------------------------------------------------------------------

describe("Pass 3: Reference integrity", () => {
  it("detects undefined column reference in AI instruction placeholder", () => {
    const result = validateAndSort(spec([
      col("C1", "AI", { instruction: "Summarize {Missing}" }),
    ]));
    expectErrorCode(result, "R-001");
  });

  it("detects undefined AgentTest inputUtterance reference", () => {
    const result = validateAndSort(spec([
      col("C1", "AgentTest", { agent: "a", agentId: "a", inputUtterance: "Missing" }),
    ]));
    expectErrorCode(result, "R-002");
  });

  it("detects undefined Evaluation input reference", () => {
    const result = validateAndSort(spec([
      col("C1", "Evaluation", { input: "Missing", evaluationType: "COHERENCE" }),
    ]));
    expectErrorCode(result, "R-003");
  });

  it("detects undefined Evaluation reference column", () => {
    const result = validateAndSort(spec([
      col("Src", "AI", { instruction: "hello" }),
      col("C1", "Evaluation", {
        input: "Src",
        evaluationType: "RESPONSE_MATCH",
        reference: "Missing",
      }),
    ]));
    expectErrorCode(result, "R-004");
  });

  it("detects undefined Reference source", () => {
    const result = validateAndSort(spec([
      col("C1", "Reference", { source: "Missing", field: "Name" }),
    ]));
    expectErrorCode(result, "R-005");
  });
});

// ---------------------------------------------------------------------------
// Pass 4: Circular dependency detection
// ---------------------------------------------------------------------------

describe("Pass 4: Circular dependency detection", () => {
  it("detects self-references", () => {
    const result = validateAndSort(spec([
      col("C1", "AI", { instruction: "Use {C1}" }),
    ]));
    expectErrorCode(result, "D-001");
  });

  it("detects simple cycle (A -> B -> A)", () => {
    const result = validateAndSort(spec([
      col("A", "AI", { instruction: "Use {B}" }),
      col("B", "AI", { instruction: "Use {A}" }),
    ]));
    expectErrorCode(result, "D-002");
  });

  it("detects complex cycle (A -> B -> C -> A)", () => {
    const result = validateAndSort(spec([
      col("A", "AI", { instruction: "Use {B}" }),
      col("B", "AI", { instruction: "Use {C}" }),
      col("C", "AI", { instruction: "Use {A}" }),
    ]));
    expectErrorCode(result, "D-002");
  });

  it("returns topologically sorted columns for acyclic graphs", () => {
    const result = validateAndSort(spec([
      col("Output", "AI", { instruction: "Use {Input}" }),
      col("Input", "Text"),
    ]));
    expectNoErrors(result);
    expect(result.sortedColumns.map((c) => c.name)).toEqual(["Input", "Output"]);
  });
});

// ---------------------------------------------------------------------------
// Pass 5: Type compatibility
// ---------------------------------------------------------------------------

describe("Pass 5: Type compatibility", () => {
  it("rejects eval targeting non-evaluable column type", () => {
    const result = validateAndSort(spec([
      col("Src", "Text"),
      col("E1", "Evaluation", { input: "Src", evaluationType: "COHERENCE" }),
    ]));
    expectErrorCode(result, "C-001");
  });

  it("rejects eval reference column that is not Text", () => {
    const result = validateAndSort(spec([
      col("Src", "AI", { instruction: "hello" }),
      col("Ref", "AI", { instruction: "world" }),
      col("E1", "Evaluation", {
        input: "Src",
        evaluationType: "RESPONSE_MATCH",
        reference: "Ref",
      }),
    ]));
    expectErrorCode(result, "C-002");
  });
});

// ---------------------------------------------------------------------------
// Pass 6: Value validation
// ---------------------------------------------------------------------------

describe("Pass 6: Value validation", () => {
  it("accepts known model shorthands", () => {
    const result = validateAndSort(spec(
      [col("C1", "AI", { instruction: "hi", model: "gpt-4-omni" })],
    ));
    expectNoErrors(result);
  });

  it("accepts sfdc_ai__ full model IDs", () => {
    const result = validateAndSort(spec(
      [col("C1", "AI", { instruction: "hi", model: "sfdc_ai__DefaultGPT4Omni" })],
    ));
    expectNoErrors(result);
  });

  it("rejects unknown model names", () => {
    const result = validateAndSort(spec(
      [col("C1", "AI", { instruction: "hi", model: "not-a-model" })],
    ));
    expectErrorCode(result, "V-002");
  });

  it("rejects unknown evaluation types", () => {
    const result = validateAndSort(spec([
      col("Src", "AI", { instruction: "hi" }),
      col("E1", "Evaluation", { input: "Src", evaluationType: "BANANA" }),
    ]));
    expectErrorCode(result, "V-001");
  });

  it("rejects invalid response format", () => {
    const result = validateAndSort(spec([
      col("C1", "AI", { instruction: "hi", responseFormat: "json" }),
    ]));
    expectErrorCode(result, "V-003");
  });

  it("returns topologically sorted columns for valid specs", () => {
    const result = validateAndSort(spec([
      col("Data", "Text"),
      col("Summary", "AI", { instruction: "Summarize {Data}" }),
      col("Eval", "Evaluation", { input: "Summary", evaluationType: "COHERENCE" }),
    ]));
    expectNoErrors(result);
    expect(result.sortedColumns.map((c) => c.name)).toEqual(["Data", "Summary", "Eval"]);
  });
});
