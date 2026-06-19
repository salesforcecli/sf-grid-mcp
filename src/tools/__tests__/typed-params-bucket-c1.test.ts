/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  ContextVariableSchema,
  FilterConditionSchema,
  PromptTemplateInputConfigSchema,
} from "../../schemas.js";

// ---------------------------------------------------------------------------
// Bucket C.1 (W-22702496): typed Zod params accept both array/object AND string
// (back-compat). These tests lock that contract by replaying the same union
// shapes used in the tool registrations.
// ---------------------------------------------------------------------------

describe("Bucket C.1 — column-mutation typed params", () => {
  describe("contextVariables", () => {
    const schema = z.union([z.array(ContextVariableSchema), z.string()]).optional();

    it("accepts a typed array of context variables", () => {
      const parsed = schema.parse([
        { variableName: "userId", type: "Text", value: "abc" },
        { variableName: "accountId", type: "Text" },
      ]);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it("accepts a JSON string (back-compat)", () => {
      const parsed = schema.parse('[{"variableName":"x","value":"y"}]');
      expect(typeof parsed).toBe("string");
    });

    it("accepts undefined", () => {
      expect(schema.parse(undefined)).toBeUndefined();
    });
  });

  describe("filters", () => {
    const schema = z.union([z.array(FilterConditionSchema), z.string()]).optional();

    it("accepts a typed array of filter conditions", () => {
      const parsed = schema.parse([
        { field: "Name", operator: "STARTS_WITH", values: ["A"] },
      ]);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it("accepts a JSON string (back-compat)", () => {
      const parsed = schema.parse('[{"field":"Name","operator":"EQUAL_TO","values":["Acme"]}]');
      expect(typeof parsed).toBe("string");
    });

    it("rejects an invalid operator in typed array", () => {
      expect(() => schema.parse([{ field: "Name", operator: "FUZZY_MATCH" }])).toThrow();
    });
  });

  describe("inputMappings", () => {
    const schema = z.union([z.array(PromptTemplateInputConfigSchema), z.string()]).optional();

    it("accepts a typed array of input mappings", () => {
      const parsed = schema.parse([
        { referenceName: "input1", definition: "string" },
      ]);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it("accepts a JSON string (back-compat)", () => {
      const parsed = schema.parse('[{"referenceName":"input1"}]');
      expect(typeof parsed).toBe("string");
    });
  });
});

describe("Bucket C.1 — cell typed params", () => {
  // Replay the local schemas used in src/tools/cell.ts so this test is
  // self-contained. If the local schemas drift, this test should be updated.
  const CellUpdateItemSchema = z.object({
    id: z.string(),
    fullContent: z.record(z.string(), z.any()).optional(),
    displayContent: z.any().optional(),
  }).passthrough();

  const PasteCellSchema = z.object({
    displayContent: z.any().optional(),
  }).passthrough();

  const TriggerRowExecutionConfigSchema = z.object({
    trigger: z.enum(["RUN_ROW", "RUN_SELECTION", "EDIT", "PASTE"]),
    rowIds: z.array(z.string()).optional(),
    seedCellIds: z.array(z.string()).optional(),
    editedCells: z.array(z.record(z.string(), z.any())).optional(),
    startColumnId: z.string().optional(),
    matrix: z.array(z.array(z.record(z.string(), z.any()))).optional(),
  }).passthrough();

  describe("cells (update)", () => {
    const schema = z.union([z.array(CellUpdateItemSchema), z.string()]).optional();

    it("accepts a typed array of cell updates", () => {
      const parsed = schema.parse([
        { id: "1W7xx0000004CtoCAE", fullContent: { text: "hello" } },
      ]);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it("accepts a JSON string (back-compat)", () => {
      const parsed = schema.parse('[{"id":"1W7","fullContent":{"text":"hi"}}]');
      expect(typeof parsed).toBe("string");
    });
  });

  describe("matrix (paste)", () => {
    const schema = z.union([z.array(z.array(PasteCellSchema)), z.string()]).optional();

    it("accepts a typed 2D matrix", () => {
      const parsed = schema.parse([
        [{ displayContent: "a" }, { displayContent: "b" }],
        [{ displayContent: "c" }, { displayContent: "d" }],
      ]);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it("accepts a JSON string (back-compat)", () => {
      const parsed = schema.parse('[[{"displayContent":"a"}]]');
      expect(typeof parsed).toBe("string");
    });
  });

  describe("config (trigger_execution)", () => {
    const schema = z.union([
      TriggerRowExecutionConfigSchema,
      z.record(z.string(), z.any()),
      z.string(),
    ]).optional();

    it("accepts a typed RUN_ROW config", () => {
      const parsed = schema.parse({ trigger: "RUN_ROW", rowIds: ["r1", "r2"] });
      expect(parsed).toMatchObject({ trigger: "RUN_ROW" });
    });

    it("accepts an arbitrary record (validate_formula / generate_ia_input)", () => {
      const parsed = schema.parse({ formula: "1+1" });
      expect(parsed).toMatchObject({ formula: "1+1" });
    });

    it("accepts a JSON string (back-compat)", () => {
      const parsed = schema.parse('{"trigger":"RUN_ROW","rowIds":["r1"]}');
      expect(typeof parsed).toBe("string");
    });
  });
});

describe("Bucket C.1 — worksheet typed params", () => {
  describe("config (run)", () => {
    const schema = z.union([z.record(z.string(), z.any()), z.string()]).optional();

    it("accepts a typed run config object", () => {
      const parsed = schema.parse({ rowInputs: { r1: ["c1"] } });
      expect(typeof parsed).toBe("object");
    });

    it("accepts a JSON string (back-compat)", () => {
      const parsed = schema.parse('{"rowInputs":{"r1":["c1"]}}');
      expect(typeof parsed).toBe("string");
    });
  });
});

describe("Bucket C.1 — discover typed params", () => {
  describe("sobjectList", () => {
    const schema = z.union([z.array(z.string()), z.string()]).optional();

    it("accepts a typed array of API names", () => {
      const parsed = schema.parse(["Account", "Contact"]);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it("accepts a JSON string (back-compat)", () => {
      const parsed = schema.parse('["Account","Contact"]');
      expect(typeof parsed).toBe("string");
    });
  });

  describe("testData", () => {
    const schema = z.union([z.record(z.string(), z.any()), z.string()]).optional();

    it("accepts a typed test-data object", () => {
      const parsed = schema.parse({ numberOfTestCases: 3, agentId: "0XxAgent" });
      expect(typeof parsed).toBe("object");
    });

    it("accepts a JSON string (back-compat)", () => {
      const parsed = schema.parse('{"numberOfTestCases":3,"agentId":"0XxAgent"}');
      expect(typeof parsed).toBe("string");
    });
  });
});