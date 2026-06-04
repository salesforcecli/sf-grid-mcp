import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ColumnInputSchema, ColumnConfigUnionSchema } from "../../schemas.js";

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