import { describe, it, expect } from "vitest";
import { expandColumnConfig, type ExpansionContext } from "../config-expander.js";
import type { ColumnSpec } from "../yaml-parser.js";

// ---------------------------------------------------------------------------
// Bucket D (W-22703237): YAML DSL gaps in apply_grid
//   1. soql: shorthand on Object columns no longer crashes; emits the canonical
//      advancedMode shape with inputs.queryString (matches Core's
//      AIWorkbookConstants.SOQL_QUERY_STRING_PARAM).
//   2. Filter with `value:` (singular) coerces to single-element `values`.
//   3. Bad filter operator surfaces a helpful error listing both shorthand
//      and canonical names.
//   4. Missing filter `field` surfaces a positionally-anchored error.
// ---------------------------------------------------------------------------

function makeCtx(): ExpansionContext {
  return {
    columnMap: new Map(),
    defaults: { numberOfRows: 10, model: "gpt-4-omni" },
    resolveModel: (s: string) => ({ modelId: `sfdc_ai__${s}`, modelName: s }),
  };
}

function objectCol(extras: Record<string, unknown>): ColumnSpec {
  return { name: "Accounts", type: "Object", ...extras };
}

function dmoCol(extras: Record<string, unknown>): ColumnSpec {
  return { name: "DMO", type: "DataModelObject", ...extras };
}

function inner(result: ReturnType<typeof expandColumnConfig>): Record<string, unknown> {
  return ((result.config as Record<string, unknown>).config as Record<string, unknown>);
}

// ---------------------------------------------------------------------------

describe("Bucket D — soql shorthand on Object columns (Gap 1)", () => {
  it("expands soql: to advancedMode with the canonical queryString key", () => {
    const result = expandColumnConfig(
      objectCol({ soql: "SELECT Id, Name FROM Account WHERE Industry = 'Tech'" }),
      makeCtx(),
    );
    const c = inner(result);
    expect(c.objectApiName).toBeUndefined();
    expect(c.fields).toBeUndefined();
    expect(c.advancedMode).toEqual({
      type: "SOQL",
      inputs: {
        queryString: "SELECT Id, Name FROM Account WHERE Industry = 'Tech'",
      },
    });
  });

  it("does not crash when fields is omitted with soql", () => {
    expect(() =>
      expandColumnConfig(objectCol({ soql: "SELECT Id FROM Account" }), makeCtx()),
    ).not.toThrow();
  });

  it("allows soql + fields + filters together", () => {
    const result = expandColumnConfig(
      objectCol({
        object: "Account",
        fields: ["Id", "Name"],
        filters: [{ field: "Name", operator: "starts_with", values: ["A"] }],
        soql: "SELECT Id, Name FROM Account",
      }),
      makeCtx(),
    );
    const c = inner(result);
    expect(c.objectApiName).toBe("Account");
    expect(Array.isArray(c.fields)).toBe(true);
    expect(Array.isArray(c.filters)).toBe(true);
    expect((c.advancedMode as Record<string, unknown>).type).toBe("SOQL");
  });
});

describe("Bucket D — dcsql shorthand on DataModelObject columns (Gap 1, DMO)", () => {
  it("expands dcsql: to advancedMode with queryString key", () => {
    const result = expandColumnConfig(
      dmoCol({
        dmo: "my_dmo__dlm",
        dataspace: "default",
        dcsql: "SELECT Id__c FROM my_dmo__dlm",
      }),
      makeCtx(),
    );
    const c = inner(result);
    expect(c.fields).toBeUndefined();
    expect(c.advancedMode).toEqual({
      type: "DCSQL",
      inputs: { queryString: "SELECT Id__c FROM my_dmo__dlm" },
    });
  });
});

describe("Bucket D — filter scalar value normalization", () => {
  it("wraps scalar string values into {value, type: STRING} for Core", () => {
    const result = expandColumnConfig(
      objectCol({
        object: "Account",
        fields: ["Id"],
        filters: [{ field: "Industry", operator: "IN", values: ["Tech", "Finance"] }],
      }),
      makeCtx(),
    );
    const c = inner(result);
    expect((c.filters as Array<{ values: unknown[] }>)[0].values).toEqual([
      { value: "Tech", type: "STRING" },
      { value: "Finance", type: "STRING" },
    ]);
  });

  it("infers INTEGER, DOUBLE, BOOLEAN from scalar JS types", () => {
    const result = expandColumnConfig(
      objectCol({
        object: "Account",
        fields: ["Id"],
        filters: [
          { field: "NumberOfEmployees", operator: "gt", values: [100] },
          { field: "AnnualRevenue", operator: "lt", values: [12.5] },
          { field: "IsDeleted", operator: "eq", values: [false] },
        ],
      }),
      makeCtx(),
    );
    const f = inner(result).filters as Array<{ values: unknown[] }>;
    expect(f[0].values).toEqual([{ value: 100, type: "INTEGER" }]);
    expect(f[1].values).toEqual([{ value: 12.5, type: "DOUBLE" }]);
    expect(f[2].values).toEqual([{ value: false, type: "BOOLEAN" }]);
  });

  it("leaves pre-wrapped {value, type} objects untouched", () => {
    const result = expandColumnConfig(
      objectCol({
        object: "Account",
        fields: ["Id"],
        filters: [
          {
            field: "Industry",
            operator: "eq",
            values: [{ value: "Technology", type: "STRING" }],
          },
        ],
      }),
      makeCtx(),
    );
    expect((inner(result).filters as Array<{ values: unknown[] }>)[0].values).toEqual([
      { value: "Technology", type: "STRING" },
    ]);
  });
});

describe("Bucket D — filter `value:` singular coercion (Gap 2)", () => {
  it("accepts `value:` (singular) and emits a single-element `values` array", () => {
    const result = expandColumnConfig(
      objectCol({
        object: "Account",
        fields: ["Id", "Name"],
        filters: [{ field: "Name", operator: "eq", value: "Acme" }],
      }),
      makeCtx(),
    );
    const c = inner(result);
    expect(c.filters).toEqual([
      { field: "Name", operator: "EQUAL_TO", values: [{ value: "Acme", type: "STRING" }] },
    ]);
  });

  it("when both `value` and `values` are provided, `values` (plural) wins", () => {
    const result = expandColumnConfig(
      objectCol({
        object: "Account",
        fields: ["Id"],
        filters: [{ field: "Name", operator: "eq", value: "X", values: ["A", "B"] }],
      }),
      makeCtx(),
    );
    expect((inner(result).filters as Array<{ values: unknown[] }>)[0].values).toEqual([
      { value: "A", type: "STRING" },
      { value: "B", type: "STRING" },
    ]);
  });

  it("emits no values key when neither `value` nor `values` is provided (e.g. is_null)", () => {
    const result = expandColumnConfig(
      objectCol({
        object: "Account",
        fields: ["Id"],
        filters: [{ field: "Description", operator: "is_null" }],
      }),
      makeCtx(),
    );
    const filter = (inner(result).filters as Array<Record<string, unknown>>)[0];
    expect(filter).toEqual({ field: "Description", operator: "IS_NULL" });
    expect("values" in filter).toBe(false);
  });
});

describe("Bucket D — bad filter operator error message (Gap 3)", () => {
  it("rejects an unknown operator with a message listing shorthand and canonical names", () => {
    expect(() =>
      expandColumnConfig(
        objectCol({
          object: "Account",
          fields: ["Id"],
          filters: [{ field: "Name", operator: "starts-with", values: ["A"] }],
        }),
        makeCtx(),
      ),
    ).toThrow(/unknown filter operator "starts-with"/);
  });

  it("error message contains shorthand examples", () => {
    let caught: Error | null = null;
    try {
      expandColumnConfig(
        objectCol({
          object: "Account",
          fields: ["Id"],
          filters: [{ field: "Name", operator: "fuzzy_match", values: ["x"] }],
        }),
        makeCtx(),
      );
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain("starts_with");
    expect(caught!.message).toContain("STARTS_WITH");
  });
});

describe("Bucket D — missing field error (Gap 4)", () => {
  it("includes column name and filter index in the error", () => {
    expect(() =>
      expandColumnConfig(
        objectCol({
          object: "Account",
          fields: ["Id"],
          filters: [{ operator: "eq", values: ["Acme"] }],
        }),
        makeCtx(),
      ),
    ).toThrow(/Column "Accounts" filters\[0\]: missing required "field"/);
  });

  it("missing operator is also caught with positional context", () => {
    expect(() =>
      expandColumnConfig(
        objectCol({
          object: "Account",
          fields: ["Id"],
          filters: [{ field: "Name", values: ["x"] }],
        }),
        makeCtx(),
      ),
    ).toThrow(/Column "Accounts" filters\[0\]: missing required "operator"/);
  });
});