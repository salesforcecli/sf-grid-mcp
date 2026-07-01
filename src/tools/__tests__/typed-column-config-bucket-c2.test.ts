/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ColumnInputSchema, ColumnConfigUnionSchema, AIColumnInnerConfigSchema } from "../../schemas.js";

// ---------------------------------------------------------------------------
// Bucket C.2 (W-22702833): typed column.config param accepts ColumnInputSchema
// (for `add`), ColumnConfigUnionSchema (for `edit`/`save`/`reprocess`), a
// permissive record (so callers passing partial/loose shapes still hit the
// action-specific safeParse), AND a JSON string for back-compat.
// ---------------------------------------------------------------------------

const columnConfigParamSchema = z
  .union([
    ColumnInputSchema,
    ColumnConfigUnionSchema,
    z.record(z.string(), z.any()),
    z.string(),
  ])
  .optional();

describe("Bucket C.2 — column.config typed param", () => {
  describe("add (ColumnInputSchema shape — full {name, type, config})", () => {
    it("accepts a typed AI-column input", () => {
      const input = {
        name: "Smoke Test AI",
        type: "AI",
        config: {
          type: "AI",
          queryResponseFormat: { type: "EACH_ROW" },
          autoUpdate: true,
          config: {
            mode: "llm",
            modelConfig: {
              modelId: "sfdc_ai__DefaultGPT4OmniMini",
              modelName: "gpt-4-omni-mini",
            },
            instruction: "Reply with: hello",
            responseFormat: { type: "PLAIN_TEXT" },
          },
        },
      };
      const parsed = columnConfigParamSchema.parse(input);
      expect(parsed).toMatchObject({ name: "Smoke Test AI", type: "AI" });
    });

    it("accepts a typed Object-column input", () => {
      const input = {
        name: "Test Accounts",
        type: "Object",
        config: {
          type: "Object",
          queryResponseFormat: { type: "EACH_ROW" },
          autoUpdate: true,
          config: {
            objectApiName: "Account",
            fields: [
              { name: "Id", type: "ID" },
              { name: "Name", type: "STRING" },
            ],
          },
        },
      };
      const parsed = columnConfigParamSchema.parse(input);
      expect(parsed).toMatchObject({ name: "Test Accounts", type: "Object" });
    });
  });

  describe("edit/save/reprocess (ColumnConfigUnionSchema shape — inner-only)", () => {
    it("accepts a typed inner-only AI config", () => {
      const input = {
        type: "AI",
        queryResponseFormat: { type: "EACH_ROW" },
        autoUpdate: true,
        config: {
          mode: "llm",
          modelConfig: {
            modelId: "sfdc_ai__DefaultGPT4OmniMini",
            modelName: "gpt-4-omni-mini",
          },
          instruction: "Reply with: edited",
          responseFormat: { type: "PLAIN_TEXT" },
        },
      };
      const parsed = columnConfigParamSchema.parse(input);
      expect(parsed).toMatchObject({ type: "AI" });
    });

    it("accepts a typed inner-only Object config with filters", () => {
      const input = {
        type: "Object",
        queryResponseFormat: { type: "EACH_ROW" },
        autoUpdate: true,
        config: {
          objectApiName: "Account",
          fields: [{ name: "Id", type: "ID" }],
          filters: [
            { field: "Name", operator: "STARTS_WITH", values: ["A"] },
          ],
        },
      };
      const parsed = columnConfigParamSchema.parse(input);
      expect(parsed).toMatchObject({ type: "Object" });
    });
  });

  describe("string (back-compat)", () => {
    it("accepts a JSON string of the full input", () => {
      const json = JSON.stringify({
        name: "Smoke Test AI",
        type: "AI",
        config: {
          type: "AI",
          queryResponseFormat: { type: "EACH_ROW" },
          autoUpdate: true,
          config: {
            mode: "llm",
            modelConfig: { modelId: "x", modelName: "y" },
            instruction: "hi",
            responseFormat: { type: "PLAIN_TEXT" },
          },
        },
      });
      const parsed = columnConfigParamSchema.parse(json);
      expect(typeof parsed).toBe("string");
    });

    it("accepts a JSON string of the inner-only shape", () => {
      const json = '{"type":"AI","queryResponseFormat":{"type":"EACH_ROW"},"autoUpdate":true,"config":{}}';
      const parsed = columnConfigParamSchema.parse(json);
      expect(typeof parsed).toBe("string");
    });
  });

  describe("undefined", () => {
    it("accepts undefined (param is optional)", () => {
      expect(columnConfigParamSchema.parse(undefined)).toBeUndefined();
    });
  });

  describe("permissive record fallback", () => {
    it("accepts an arbitrary record (which the action-specific safeParse will reject downstream)", () => {
      const parsed = columnConfigParamSchema.parse({ random: "shape", that: "is not a column config" });
      expect(typeof parsed).toBe("object");
    });
  });
});

// ---------------------------------------------------------------------------
// W-23261198: AIColumnInnerConfigSchema strict field requirements
// mode, responseFormat, referenceAttributes.columnType must all be required.
// ---------------------------------------------------------------------------

/** Canonical AI column payload from a live orgfarm dry-run */
const canonicalAIInnerConfig = {
  autoUpdate: true,
  mode: "llm" as const,
  responseFormat: { type: "PLAIN_TEXT" as const },
  modelConfig: {
    modelId: "sfdc_ai__DefaultGPT4OmniMini",
    modelName: "sfdc_ai__DefaultGPT4OmniMini",
  },
  instruction: "Summarize the subject: {$1}",
  referenceAttributes: [
    {
      placeholder: "$1",
      columnName: "Subject",
      columnId: "1W5xx0000004H7cCAE",
      columnType: "Text" as const,
    },
  ],
};

describe("W-23261198 — AIColumnInnerConfigSchema strict fields", () => {
  it("parses the canonical live-orgfarm AI column payload", () => {
    const result = AIColumnInnerConfigSchema.safeParse(canonicalAIInnerConfig);
    expect(result.success).toBe(true);
  });

  it("parses SINGLE_SELECT responseFormat", () => {
    const result = AIColumnInnerConfigSchema.safeParse({
      ...canonicalAIInnerConfig,
      responseFormat: { type: "SINGLE_SELECT", options: [{ label: "Yes" }, { label: "No" }] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing mode", () => {
    const { mode: _mode, ...withoutMode } = canonicalAIInnerConfig;
    const result = AIColumnInnerConfigSchema.safeParse(withoutMode);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("mode"))).toBe(true);
    }
  });

  it("rejects mode that is not 'llm'", () => {
    const result = AIColumnInnerConfigSchema.safeParse({ ...canonicalAIInnerConfig, mode: "other" });
    expect(result.success).toBe(false);
  });

  it("rejects missing responseFormat", () => {
    const { responseFormat: _rf, ...withoutRf } = canonicalAIInnerConfig;
    const result = AIColumnInnerConfigSchema.safeParse(withoutRf);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("responseFormat"))).toBe(true);
    }
  });

  it("rejects responseFormat.type that is not PLAIN_TEXT or SINGLE_SELECT", () => {
    const result = AIColumnInnerConfigSchema.safeParse({
      ...canonicalAIInnerConfig,
      responseFormat: { type: "JSON" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects referenceAttribute entry missing columnType", () => {
    const result = AIColumnInnerConfigSchema.safeParse({
      ...canonicalAIInnerConfig,
      referenceAttributes: [
        { columnName: "Subject", columnId: "1W5xx0000004H7cCAE" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("columnType"))).toBe(true);
    }
  });

  it("accepts referenceAttributes with columnType present", () => {
    const result = AIColumnInnerConfigSchema.safeParse({
      ...canonicalAIInnerConfig,
      referenceAttributes: [
        { columnName: "Subject", columnId: "1W5xx0000004H7cCAE", columnType: "Text" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing modelConfig", () => {
    const { modelConfig: _mc, ...withoutMc } = canonicalAIInnerConfig;
    const result = AIColumnInnerConfigSchema.safeParse(withoutMc);
    expect(result.success).toBe(false);
  });

  it("rejects modelConfig missing modelId", () => {
    const result = AIColumnInnerConfigSchema.safeParse({
      ...canonicalAIInnerConfig,
      modelConfig: { modelName: "sfdc_ai__DefaultGPT4OmniMini" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects modelConfig missing modelName", () => {
    const result = AIColumnInnerConfigSchema.safeParse({
      ...canonicalAIInnerConfig,
      modelConfig: { modelId: "sfdc_ai__DefaultGPT4OmniMini" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts AI column with no referenceAttributes (no-placeholder instruction)", () => {
    const { referenceAttributes: _ra, ...withoutRa } = canonicalAIInnerConfig;
    const result = AIColumnInnerConfigSchema.safeParse(withoutRa);
    expect(result.success).toBe(true);
  });
});