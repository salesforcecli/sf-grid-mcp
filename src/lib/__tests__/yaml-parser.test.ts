import { describe, it, expect } from "vitest";
import { parseGridYaml, DSL_TYPE_MAP, EVAL_TYPE_MAP } from "../yaml-parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalYaml(overrides: Record<string, unknown> = {}): string {
  const base = {
    workbook: "wb",
    worksheet: "ws",
    columns: [{ name: "Col1", type: "text" }],
    ...overrides,
  };
  // Simple YAML serialization for tests
  return toYaml(base);
}

function toYaml(obj: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string") return JSON.stringify(obj);
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) {
    return obj.map((item) => {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item);
        const first = `${pad}- ${entries[0][0]}: ${toYaml(entries[0][1], indent + 2)}`;
        const rest = entries
          .slice(1)
          .map(([k, v]) => `${pad}  ${k}: ${toYaml(v, indent + 2)}`)
          .join("\n");
        return rest ? `${first}\n${rest}` : first;
      }
      return `${pad}- ${toYaml(item, indent + 1)}`;
    }).join("\n");
  }
  if (typeof obj === "object") {
    return Object.entries(obj as Record<string, unknown>)
      .map(([k, v]) => {
        if (Array.isArray(v)) {
          return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
        }
        if (typeof v === "object" && v !== null) {
          return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
        }
        return `${pad}${k}: ${toYaml(v, indent + 1)}`;
      })
      .join("\n");
  }
  return String(obj);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseGridYaml", () => {
  it("parses minimal valid YAML with workbook, worksheet, and 1 text column", () => {
    const result = parseGridYaml(minimalYaml());
    expect(result.workbook).toBe("wb");
    expect(result.worksheet).toBe("ws");
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].name).toBe("Col1");
    expect(result.columns[0].type).toBe("Text");
  });

  it("parses all 12 DSL types with correct API type mapping", () => {
    const columns = Object.entries(DSL_TYPE_MAP).map(([dsl], i) => ({
      name: `Col${i}`,
      type: dsl,
    }));
    const result = parseGridYaml(minimalYaml({ columns }));
    const expected = Object.values(DSL_TYPE_MAP);
    expect(result.columns.map((c) => c.type)).toEqual(expected);
  });

  it("parses eval/* shorthands to Evaluation type + evaluationType", () => {
    for (const [suffix, evalType] of Object.entries(EVAL_TYPE_MAP)) {
      const yaml = minimalYaml({
        columns: [{ name: "EvalCol", type: `eval/${suffix}` }],
      });
      const result = parseGridYaml(yaml);
      expect(result.columns[0].type).toBe("Evaluation");
      expect(result.columns[0].evaluationType).toBe(evalType);
    }
  });

  it("rejects missing workbook", () => {
    const yaml = `
worksheet: ws
columns:
  - name: Col1
    type: text`;
    expect(() => parseGridYaml(yaml)).toThrow(/workbook/);
  });

  it("rejects missing worksheet", () => {
    const yaml = `
workbook: wb
columns:
  - name: Col1
    type: text`;
    expect(() => parseGridYaml(yaml)).toThrow(/worksheet/);
  });

  it("rejects missing columns", () => {
    const yaml = `
workbook: wb
worksheet: ws`;
    expect(() => parseGridYaml(yaml)).toThrow(/columns/);
  });

  it("rejects empty columns array", () => {
    const yaml = `
workbook: wb
worksheet: ws
columns: []`;
    expect(() => parseGridYaml(yaml)).toThrow(/columns/);
  });

  it("rejects column without name", () => {
    const yaml = `
workbook: wb
worksheet: ws
columns:
  - type: text`;
    expect(() => parseGridYaml(yaml)).toThrow(/name/);
  });

  it("rejects column without type", () => {
    const yaml = `
workbook: wb
worksheet: ws
columns:
  - name: Col1`;
    expect(() => parseGridYaml(yaml)).toThrow(/type/);
  });

  it("rejects unknown type", () => {
    const yaml = `
workbook: wb
worksheet: ws
columns:
  - name: Col1
    type: banana`;
    expect(() => parseGridYaml(yaml)).toThrow(/unknown type/i);
  });

  it("rejects unknown eval shorthand", () => {
    const yaml = `
workbook: wb
worksheet: ws
columns:
  - name: Col1
    type: eval/banana`;
    expect(() => parseGridYaml(yaml)).toThrow(/unknown evaluation shorthand/i);
  });

  it("parses optional numberOfRows field", () => {
    const result = parseGridYaml(minimalYaml({ numberOfRows: 42 }));
    expect(result.numberOfRows).toBe(42);
  });

  it("parses optional model field", () => {
    const result = parseGridYaml(minimalYaml({ model: "gpt-4-omni" }));
    expect(result.model).toBe("gpt-4-omni");
  });

  it("unwraps optional top-level grid: wrapper", () => {
    const yaml = `
grid:
  workbook: wb
  worksheet: ws
  columns:
    - name: Col1
      type: text`;
    const result = parseGridYaml(yaml);
    expect(result.workbook).toBe("wb");
    expect(result.columns).toHaveLength(1);
  });

  it("parses data section with string coercion", () => {
    const yaml = `
workbook: wb
worksheet: ws
columns:
  - name: Col1
    type: text
data:
  Col1:
    - hello
    - 42
    - true`;
    const result = parseGridYaml(yaml);
    expect(result.data).toBeDefined();
    expect(result.data!["Col1"]).toEqual(["hello", "42", "true"]);
  });

  it("preserves extra column fields for downstream processing", () => {
    const yaml = `
workbook: wb
worksheet: ws
columns:
  - name: MyAI
    type: ai
    instruction: "Do something"
    model: "gpt-4-omni"`;
    const result = parseGridYaml(yaml);
    expect(result.columns[0].instruction).toBe("Do something");
    expect(result.columns[0].model).toBe("gpt-4-omni");
  });
});
