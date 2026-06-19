/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

import { describe, it, expect } from "vitest";
import { expandColumnConfig, ExpansionContext, ColumnMapEntry } from "../config-expander.js";
import type { ColumnSpec } from "../yaml-parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(
  entries: Array<{ id: string; name: string; type: string }> = [],
  defaultModel = "gpt-4-omni",
): ExpansionContext {
  const columnMap = new Map<string, ColumnMapEntry>();
  for (const e of entries) {
    columnMap.set(e.name, e);
  }
  return {
    columnMap,
    defaults: { numberOfRows: 50, model: defaultModel },
    resolveModel: (shorthand: string) => ({
      modelId: `sfdc_ai__${shorthand}`,
      modelName: shorthand,
    }),
  };
}

function col(name: string, type: string, extras: Record<string, unknown> = {}): ColumnSpec {
  return { name, type, ...extras };
}

// ---------------------------------------------------------------------------
// AI column
// ---------------------------------------------------------------------------

describe("expandColumnConfig — AI", () => {
  it("rewrites {ColumnName} to {$N} and adds referenceAttributes and modelConfig", () => {
    const ctx = makeCtx([
      { id: "col-1", name: "Input", type: "Text" },
    ]);
    const result = expandColumnConfig(
      col("Summary", "AI", { instruction: "Summarize {Input}" }),
      ctx,
    );
    expect(result.name).toBe("Summary");
    expect(result.type).toBe("AI");

    const cfg = result.config as Record<string, unknown>;
    const inner = cfg.config as Record<string, unknown>;
    expect(inner.instruction).toBe("Summarize {$1}");
    expect(inner.referenceAttributes).toEqual([
      { columnId: "col-1", columnName: "Input", columnType: "Text" },
    ]);
    expect(inner.modelConfig).toEqual({
      modelId: "sfdc_ai__gpt-4-omni",
      modelName: "gpt-4-omni",
    });
  });

  it("uses default model when column does not specify one", () => {
    const ctx = makeCtx([], "gpt-4-omni");
    const result = expandColumnConfig(col("C1", "AI", { instruction: "hello" }), ctx);
    const cfg = result.config as Record<string, unknown>;
    const inner = cfg.config as Record<string, unknown>;
    expect((inner.modelConfig as Record<string, string>).modelName).toBe("gpt-4-omni");
  });

  it("uses column-level model override", () => {
    const ctx = makeCtx([], "gpt-4-omni");
    const result = expandColumnConfig(
      col("C1", "AI", { instruction: "hello", model: "claude-4-sonnet" }),
      ctx,
    );
    const cfg = result.config as Record<string, unknown>;
    const inner = cfg.config as Record<string, unknown>;
    expect((inner.modelConfig as Record<string, string>).modelName).toBe("claude-4-sonnet");
  });
});

// ---------------------------------------------------------------------------
// AgentTest column
// ---------------------------------------------------------------------------

describe("expandColumnConfig — AgentTest", () => {
  it("builds inputUtterance as column ref", () => {
    const ctx = makeCtx([
      { id: "col-input", name: "Utterance", type: "Text" },
    ]);
    const result = expandColumnConfig(
      col("Test", "AgentTest", {
        agentId: "agent-1",
        agent: "myAgent",
        inputUtterance: "Utterance",
      }),
      ctx,
    );
    const cfg = result.config as Record<string, unknown>;
    const inner = cfg.config as Record<string, unknown>;
    expect(inner.inputUtterance).toEqual({
      columnId: "col-input",
      columnName: "Utterance",
      columnType: "Text",
    });
  });
});

// ---------------------------------------------------------------------------
// Evaluation column
// ---------------------------------------------------------------------------

describe("expandColumnConfig — Evaluation", () => {
  it("builds inputColumnReference from input", () => {
    const ctx = makeCtx([
      { id: "col-ai", name: "Answer", type: "AI" },
    ]);
    const result = expandColumnConfig(
      col("Eval", "Evaluation", {
        input: "Answer",
        evaluationType: "COHERENCE",
      }),
      ctx,
    );
    const cfg = result.config as Record<string, unknown>;
    const inner = cfg.config as Record<string, unknown>;
    expect(inner.inputColumnReference).toEqual({
      columnId: "col-ai",
      columnName: "Answer",
      columnType: "AI",
    });
  });
});

// ---------------------------------------------------------------------------
// Object column
// ---------------------------------------------------------------------------

describe("expandColumnConfig — Object", () => {
  it("expands fields and filters with operator shorthand mapping", () => {
    const ctx = makeCtx();
    const result = expandColumnConfig(
      col("Accounts", "Object", {
        object: "Account",
        fields: ["Id", "Name"],
        filters: [{ field: "Name", operator: "eq", values: ["Acme"] }],
      }),
      ctx,
    );
    const cfg = result.config as Record<string, unknown>;
    const inner = cfg.config as Record<string, unknown>;
    expect(inner.objectApiName).toBe("Account");
    expect(inner.fields).toEqual([
      { name: "Id", type: "STRING" },
      { name: "Name", type: "STRING" },
    ]);
    expect(inner.filters).toEqual([
      { field: "Name", operator: "EQUAL_TO", values: [{ value: "Acme", type: "STRING" }] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Formula column
// ---------------------------------------------------------------------------

describe("expandColumnConfig — Formula", () => {
  it("rewrites placeholders in formula", () => {
    const ctx = makeCtx([
      { id: "col-a", name: "A", type: "Text" },
    ]);
    const result = expandColumnConfig(
      col("F1", "Formula", { formula: "LEN({A})", returnType: "integer" }),
      ctx,
    );
    const cfg = result.config as Record<string, unknown>;
    const inner = cfg.config as Record<string, unknown>;
    expect(inner.formula).toBe("LEN({$1})");
  });
});

// ---------------------------------------------------------------------------
// PromptTemplate column
// ---------------------------------------------------------------------------

describe("expandColumnConfig — PromptTemplate", () => {
  it("handles column refs in inputs (referenceAttribute)", () => {
    const ctx = makeCtx([
      { id: "col-data", name: "Data", type: "Text" },
    ]);
    const result = expandColumnConfig(
      col("PT", "PromptTemplate", {
        template: "myTemplate",
        inputs: { context: "{Data}" },
      }),
      ctx,
    );
    const cfg = result.config as Record<string, unknown>;
    const inner = cfg.config as Record<string, unknown>;
    const inputConfigs = inner.promptTemplateInputConfigs as Array<Record<string, unknown>>;
    expect(inputConfigs).toHaveLength(1);
    expect(inputConfigs[0].referenceName).toBe("context");
    expect(inputConfigs[0].referenceAttribute).toEqual({
      columnId: "col-data",
      columnName: "Data",
      columnType: "Text",
    });
  });

  it("handles static values in inputs (definition field)", () => {
    const ctx = makeCtx();
    const result = expandColumnConfig(
      col("PT", "PromptTemplate", {
        template: "myTemplate",
        inputs: { tone: "formal" },
      }),
      ctx,
    );
    const cfg = result.config as Record<string, unknown>;
    const inner = cfg.config as Record<string, unknown>;
    const inputConfigs = inner.promptTemplateInputConfigs as Array<Record<string, unknown>>;
    expect(inputConfigs).toHaveLength(1);
    expect(inputConfigs[0].referenceName).toBe("tone");
    expect(inputConfigs[0].definition).toBe("formal");
  });
});

// ---------------------------------------------------------------------------
// Text column
// ---------------------------------------------------------------------------

describe("expandColumnConfig — Text", () => {
  it("produces minimal config", () => {
    const ctx = makeCtx();
    const result = expandColumnConfig(col("T1", "Text"), ctx);
    expect(result.name).toBe("T1");
    expect(result.type).toBe("Text");
  });
});

// ---------------------------------------------------------------------------
// queryResponseFormat inference
// ---------------------------------------------------------------------------

describe("queryResponseFormat inference", () => {
  it("Object columns get WHOLE_COLUMN", () => {
    const ctx = makeCtx();
    const result = expandColumnConfig(
      col("Obj", "Object", { object: "Account", fields: ["Id"] }),
      ctx,
    );
    const cfg = result.config as Record<string, unknown>;
    expect(cfg.queryResponseFormat).toEqual({
      type: "WHOLE_COLUMN",
      splitByType: "OBJECT_PER_ROW",
    });
  });

  it("AI columns get EACH_ROW", () => {
    const ctx = makeCtx();
    const result = expandColumnConfig(
      col("C1", "AI", { instruction: "hello" }),
      ctx,
    );
    const cfg = result.config as Record<string, unknown>;
    expect(cfg.queryResponseFormat).toEqual({ type: "EACH_ROW" });
  });

  it("Text columns get no queryResponseFormat", () => {
    const ctx = makeCtx();
    const result = expandColumnConfig(col("T1", "Text"), ctx);
    const cfg = result.config as Record<string, unknown>;
    expect(cfg.queryResponseFormat).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("expandColumnConfig — errors", () => {
  it("throws on unknown column reference in placeholder", () => {
    const ctx = makeCtx();
    expect(() =>
      expandColumnConfig(col("C1", "AI", { instruction: "Use {Missing}" }), ctx),
    ).toThrow(/Missing/);
  });
});
