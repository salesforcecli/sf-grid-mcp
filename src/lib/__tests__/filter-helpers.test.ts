/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeFilterValue,
  normalizeFilterValues,
  normalizeFilters,
  normalizeColumnConfigFilters,
} from "../filter-helpers.js";

describe("normalizeFilterValue", () => {
  it("wraps a string scalar with type STRING", () => {
    expect(normalizeFilterValue("Technology")).toEqual({ value: "Technology", type: "STRING" });
  });

  it("wraps an integer with type INTEGER", () => {
    expect(normalizeFilterValue(42)).toEqual({ value: 42, type: "INTEGER" });
  });

  it("wraps a float with type DOUBLE", () => {
    expect(normalizeFilterValue(3.14)).toEqual({ value: 3.14, type: "DOUBLE" });
  });

  it("wraps a boolean with type BOOLEAN", () => {
    expect(normalizeFilterValue(true)).toEqual({ value: true, type: "BOOLEAN" });
  });

  it("leaves an already-wrapped {value, type} object untouched", () => {
    const wrapped = { value: "Technology", type: "STRING" };
    expect(normalizeFilterValue(wrapped)).toBe(wrapped);
  });

  it("leaves a referenceAttribute object untouched", () => {
    const ref = { referenceAttribute: { columnId: "x", columnName: "X" } };
    expect(normalizeFilterValue(ref)).toBe(ref);
  });
});

describe("normalizeFilterValues", () => {
  it("returns undefined when input is undefined", () => {
    expect(normalizeFilterValues(undefined)).toBeUndefined();
  });

  it("normalizes a mixed scalar array", () => {
    expect(normalizeFilterValues(["a", 1, false])).toEqual([
      { value: "a", type: "STRING" },
      { value: 1, type: "INTEGER" },
      { value: false, type: "BOOLEAN" },
    ]);
  });

  it("preserves pre-wrapped values", () => {
    const input = [{ value: "Tech", type: "STRING" }, "Finance"];
    expect(normalizeFilterValues(input)).toEqual([
      { value: "Tech", type: "STRING" },
      { value: "Finance", type: "STRING" },
    ]);
  });
});

describe("normalizeFilters", () => {
  it("normalizes values per filter", () => {
    const filters = [
      { field: "Industry", operator: "IN", values: ["Tech", "Finance"] },
      { field: "Revenue", operator: "GREATER_THAN", values: [1000] },
    ];
    expect(normalizeFilters(filters)).toEqual([
      { field: "Industry", operator: "IN", values: [{ value: "Tech", type: "STRING" }, { value: "Finance", type: "STRING" }] },
      { field: "Revenue", operator: "GREATER_THAN", values: [{ value: 1000, type: "INTEGER" }] },
    ]);
  });

  it("preserves filters with no values (e.g., IS_NULL)", () => {
    const filters = [{ field: "Description", operator: "IS_NULL" }];
    expect(normalizeFilters(filters)).toEqual([{ field: "Description", operator: "IS_NULL", values: undefined }]);
  });
});

describe("normalizeColumnConfigFilters", () => {
  it("normalizes filters in the inner Object config (edit/save shape)", () => {
    const config = {
      type: "Object",
      queryResponseFormat: { type: "EACH_ROW" },
      autoUpdate: true,
      config: {
        autoUpdate: true,
        objectApiName: "Account",
        fields: [{ name: "Id", type: "ID" }],
        filters: [{ field: "Industry", operator: "EQUAL_TO", values: ["Technology"] }],
      },
    };
    const out: any = normalizeColumnConfigFilters(config);
    expect(out.config.filters[0].values[0]).toEqual({ value: "Technology", type: "STRING" });
  });

  it("normalizes filters in the add shape (one extra wrapper)", () => {
    const config = {
      name: "AccountTechCo",
      type: "Object",
      config: {
        type: "Object",
        queryResponseFormat: { type: "EACH_ROW" },
        autoUpdate: true,
        config: {
          autoUpdate: true,
          objectApiName: "Account",
          fields: [{ name: "Id", type: "ID" }],
          filters: [{ field: "Industry", operator: "IN", values: ["Tech", "Finance"] }],
        },
      },
    };
    const out: any = normalizeColumnConfigFilters(config);
    expect(out.config.config.filters[0].values).toEqual([
      { value: "Tech", type: "STRING" },
      { value: "Finance", type: "STRING" },
    ]);
  });

  it("passes through configs with no filters untouched", () => {
    const config = { type: "AI", config: { instruction: "hi" } };
    expect(normalizeColumnConfigFilters(config)).toEqual(config);
  });

  it("does not mutate the original config", () => {
    const config = {
      type: "Object",
      config: {
        objectApiName: "Account",
        filters: [{ field: "Industry", operator: "IN", values: ["Tech"] }],
      },
    };
    const before = JSON.stringify(config);
    normalizeColumnConfigFilters(config);
    expect(JSON.stringify(config)).toBe(before);
  });
});