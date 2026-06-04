/**
 * YAML parser for the Grid DSL.
 *
 * Parses a YAML string into a typed GridSpec AST. This is the first stage of
 * the apply_grid pipeline: YAML string -> GridSpec -> (config expander) -> GCC JSON.
 *
 * The parser validates top-level structure but does NOT validate column-specific
 * fields — that responsibility belongs to the validator.
 */

import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Top-level grid specification parsed from YAML. */
export interface GridSpec {
  workbook: string;
  worksheet: string;
  numberOfRows?: number;
  model?: string;
  columns: ColumnSpec[];
  data?: Record<string, string[]>;
}

/**
 * Individual column spec. The `type` is normalised to the API PascalCase value.
 * All other fields are type-specific and loosely typed at parse time.
 */
export interface ColumnSpec {
  name: string;
  type: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// DSL type -> API type mapping
// ---------------------------------------------------------------------------

/** Maps DSL snake_case type names to API PascalCase type values. */
export const DSL_TYPE_MAP: Record<string, string> = {
  text: "Text",
  ai: "AI",
  object: "Object",
  data_model_object: "DataModelObject",
  agent: "Agent",
  agent_test: "AgentTest",
  evaluation: "Evaluation",
  reference: "Reference",
  formula: "Formula",
  prompt_template: "PromptTemplate",
  invocable_action: "InvocableAction",
  action: "Action",
};

/** Maps eval/* shorthand suffixes to their evaluationType values. */
export const EVAL_TYPE_MAP: Record<string, string> = {
  coherence: "COHERENCE",
  conciseness: "CONCISENESS",
  factuality: "FACTUALITY",
  instruction_following: "INSTRUCTION_FOLLOWING",
  completeness: "COMPLETENESS",
  response_match: "RESPONSE_MATCH",
  topic_assertion: "TOPIC_ASSERTION",
  action_assertion: "ACTION_ASSERTION",
  latency: "LATENCY_ASSERTION",
  response_rating: "BOT_RESPONSE_RATING",
  expression: "EXPRESSION_EVAL",
  custom_llm: "CUSTOM_LLM_EVALUATION",
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a Grid YAML DSL string into a {@link GridSpec}.
 *
 * @throws {Error} on malformed YAML or missing required top-level fields.
 */
export function parseGridYaml(yamlString: string): GridSpec {
  // --- Parse raw YAML ---
  let doc: unknown;
  try {
    doc = parseYaml(yamlString);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid YAML: ${msg}`);
  }

  if (doc == null || typeof doc !== "object") {
    throw new Error("YAML document must be an object");
  }

  // Unwrap optional top-level `grid:` wrapper
  const root = hasKey(doc, "grid") && isObject(doc.grid) ? doc.grid : doc;

  // --- Validate required top-level fields ---
  if (!hasKey(root, "workbook") || typeof root.workbook !== "string" || root.workbook === "") {
    throw new Error('Missing required top-level field "workbook"');
  }
  if (!hasKey(root, "worksheet") || typeof root.worksheet !== "string" || root.worksheet === "") {
    throw new Error('Missing required top-level field "worksheet"');
  }
  if (!hasKey(root, "columns") || !Array.isArray(root.columns) || root.columns.length === 0) {
    throw new Error('Missing or empty required top-level field "columns"');
  }

  // --- Optional fields ---
  const numberOfRows = hasKey(root, "numberOfRows") ? toPositiveInt(root.numberOfRows, "numberOfRows") : undefined;
  const model = hasKey(root, "model") ? String(root.model) : undefined;
  const data = hasKey(root, "data") ? parseDataSection(root.data) : undefined;

  // --- Parse columns ---
  const columns: ColumnSpec[] = (root.columns as unknown[]).map((raw, idx) => parseColumn(raw, idx));

  return {
    workbook: root.workbook as string,
    worksheet: root.worksheet as string,
    ...(numberOfRows !== undefined && { numberOfRows }),
    ...(model !== undefined && { model }),
    columns,
    ...(data !== undefined && { data }),
  };
}

// ---------------------------------------------------------------------------
// Column parsing helpers
// ---------------------------------------------------------------------------

function parseColumn(raw: unknown, index: number): ColumnSpec {
  if (!isObject(raw)) {
    throw new Error(`columns[${index}]: expected an object, got ${typeof raw}`);
  }

  if (!hasKey(raw, "name") || typeof raw.name !== "string" || raw.name === "") {
    throw new Error(`columns[${index}]: missing required field "name"`);
  }
  if (!hasKey(raw, "type") || typeof raw.type !== "string" || raw.type === "") {
    throw new Error(`columns[${index}] ("${raw.name ?? ""}"): missing required field "type"`);
  }

  const name = raw.name as string;
  const dslType = (raw.type as string).toLowerCase();

  // Resolve type
  const { apiType, evaluationType } = resolveType(dslType, name);

  // Build the column spec: copy all fields, override type, inject evaluationType if needed
  const spec: ColumnSpec = { ...raw as Record<string, unknown>, name, type: apiType };

  if (evaluationType !== undefined) {
    spec.evaluationType = evaluationType;
  }

  return spec;
}

/**
 * Resolve a DSL type string to its API type and optional evaluationType.
 * Handles both plain types (`ai`, `text`) and eval shorthands (`eval/coherence`).
 */
function resolveType(dslType: string, columnName: string): { apiType: string; evaluationType?: string } {
  // eval/* shorthand
  if (dslType.startsWith("eval/")) {
    const suffix = dslType.slice(5);
    const evaluationType = EVAL_TYPE_MAP[suffix];
    if (evaluationType === undefined) {
      const valid = Object.keys(EVAL_TYPE_MAP).map((k) => `eval/${k}`).join(", ");
      throw new Error(`Column "${columnName}": unknown evaluation shorthand "type: ${dslType}". Valid shorthands: ${valid}`);
    }
    return { apiType: "Evaluation", evaluationType };
  }

  // Standard type
  const apiType = DSL_TYPE_MAP[dslType];
  if (apiType === undefined) {
    const valid = [...Object.keys(DSL_TYPE_MAP), ...Object.keys(EVAL_TYPE_MAP).map((k) => `eval/${k}`)].join(", ");
    throw new Error(`Column "${columnName}": unknown type "${dslType}". Valid types: ${valid}`);
  }

  return { apiType };
}

// ---------------------------------------------------------------------------
// Data section parsing
// ---------------------------------------------------------------------------

function parseDataSection(raw: unknown): Record<string, string[]> {
  if (!isObject(raw)) {
    throw new Error('"data" must be a map of column name to list of string values');
  }

  const result: Record<string, string[]> = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      throw new Error(`data["${key}"]: expected a list of values, got ${typeof value}`);
    }
    result[key] = value.map((v) => String(v));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function isObject(val: unknown): val is Record<string, unknown> {
  return val != null && typeof val === "object" && !Array.isArray(val);
}

function hasKey<K extends string>(obj: unknown, key: K): obj is Record<K, unknown> {
  return isObject(obj) && key in obj;
}

function toPositiveInt(val: unknown, field: string): number {
  const n = Number(val);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`"${field}" must be a positive integer, got ${JSON.stringify(val)}`);
  }
  return n;
}
