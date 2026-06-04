/**
 * Semantic validator for parsed GridSpec.
 *
 * Runs 6 validation passes in order — each pass assumes the prior pass succeeded.
 * Pass 1 (Y-xxx): Schema basics (workbook/worksheet/columns, valid types)
 * Pass 2 (T-xxx): Type-specific required fields
 * Pass 3 (R-xxx): Reference integrity ({ColumnName} refs resolve)
 * Pass 4 (D-xxx): Circular dependency detection (Kahn's algorithm)
 * Pass 5 (C-xxx): Type compatibility (eval targets, agent input types)
 * Pass 6 (V-xxx): Value validation (eval types, models, response formats)
 */

import { GridSpec, ColumnSpec, DSL_TYPE_MAP, EVAL_TYPE_MAP } from "./yaml-parser.js";
import { MODEL_SHORTHANDS } from "./model-map.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ValidationError {
  code: string;
  message: string;
  suggestion: string;
  details: Record<string, unknown>;
}

export interface ValidationResult {
  errors: ValidationError[];
  sortedColumns: ColumnSpec[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_TYPES = new Set(Object.values(DSL_TYPE_MAP));

const VALID_EVAL_TYPES = new Set(Object.values(EVAL_TYPE_MAP));

/** Eval types that require a `reference` column. */
const EVAL_TYPES_REQUIRING_REFERENCE = new Set([
  "RESPONSE_MATCH",
  "TOPIC_ASSERTION",
  "ACTION_ASSERTION",
  "BOT_RESPONSE_RATING",
  "CUSTOM_LLM_EVALUATION",
]);

/** Column types that can be the `input` target of an Evaluation column. */
const VALID_EVAL_INPUT_TYPES = new Set([
  "Agent", "AgentTest", "AI", "PromptTemplate",
]);

const VALID_RESPONSE_FORMATS = new Set(["plain_text", "single_select"]);

const VALID_RETURN_TYPES = new Set([
  "string", "boolean", "double", "integer", "long",
  "date", "datetime", "time", "id", "reference",
]);

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Validate a parsed GridSpec for semantic correctness and return errors
 * plus the topologically sorted column order (empty if cycles exist).
 */
export function validateAndSort(spec: GridSpec): ValidationResult {
  const errors: ValidationError[] = [];
  let sortedColumns: ColumnSpec[] = [];

  // Pass 1
  const p1 = pass1SchemaValidation(spec);
  errors.push(...p1);
  if (p1.length > 0) return { errors, sortedColumns };

  // Pass 2
  const p2 = pass2TypeSpecificFields(spec);
  errors.push(...p2);
  if (p2.length > 0) return { errors, sortedColumns };

  // Build column lookup (used by passes 3-6)
  const columnMap = new Map<string, ColumnSpec>();
  for (const col of spec.columns) {
    columnMap.set(col.name, col);
  }

  // Pass 3
  const p3 = pass3ReferenceIntegrity(spec, columnMap);
  errors.push(...p3);
  if (p3.length > 0) return { errors, sortedColumns };

  // Pass 4
  const { errors: p4, sorted } = pass4CircularDependency(spec, columnMap);
  errors.push(...p4);
  if (p4.length > 0) return { errors, sortedColumns };
  sortedColumns = sorted;

  // Pass 5
  const p5 = pass5TypeCompatibility(spec, columnMap);
  errors.push(...p5);
  if (p5.length > 0) return { errors, sortedColumns };

  // Pass 6
  const p6 = pass6ValueValidation(spec, columnMap);
  errors.push(...p6);

  return { errors, sortedColumns };
}

/** Convenience wrapper that returns just the error list. */
export function validateGridSpec(spec: GridSpec): ValidationError[] {
  return validateAndSort(spec).errors;
}

// ---------------------------------------------------------------------------
// Pass 1: Schema validation (Y-xxx)
// ---------------------------------------------------------------------------

function pass1SchemaValidation(spec: GridSpec): ValidationError[] {
  const errors: ValidationError[] = [];

  // Y-002: workbook present
  if (!spec.workbook || typeof spec.workbook !== "string") {
    errors.push({
      code: "Y-002",
      message: 'Missing required top-level field "workbook"',
      suggestion: 'Add a "workbook" field with the workbook name.',
      details: { field: "workbook" },
    });
  }

  // Y-003: columns present and non-empty (worksheet checked by parser)
  if (!spec.columns || !Array.isArray(spec.columns) || spec.columns.length === 0) {
    errors.push({
      code: "Y-003",
      message: 'Missing or empty required field "columns"',
      suggestion: "Add at least one column definition to the columns list.",
      details: { field: "columns" },
    });
    return errors; // Can't validate further without columns
  }

  const seenNames = new Set<string>();

  for (let i = 0; i < spec.columns.length; i++) {
    const col = spec.columns[i];

    // Y-004: each column has a name
    if (!col.name || typeof col.name !== "string") {
      errors.push({
        code: "Y-004",
        message: `columns[${i}]: missing required field "name"`,
        suggestion: "Add a name field to this column definition.",
        details: { index: i },
      });
      continue;
    }

    // Duplicate name check
    if (seenNames.has(col.name)) {
      errors.push({
        code: "Y-004",
        message: `Duplicate column name "${col.name}"`,
        suggestion: "Each column must have a unique name. Rename one of the duplicates.",
        details: { column: col.name, index: i },
      });
    }
    seenNames.add(col.name);

    // Y-005: each column has a type
    if (!col.type || typeof col.type !== "string") {
      errors.push({
        code: "Y-005",
        message: `Column "${col.name}": missing required field "type"`,
        suggestion: `Add a type field. Valid types: ${[...VALID_TYPES].join(", ")}`,
        details: { column: col.name },
      });
      continue;
    }

    // Y-006: type is valid (parser normalizes to PascalCase API types)
    if (!VALID_TYPES.has(col.type)) {
      errors.push({
        code: "Y-006",
        message: `Column "${col.name}": invalid type "${col.type}"`,
        suggestion: `Valid types: ${[...VALID_TYPES].join(", ")}`,
        details: { column: col.name, value: col.type },
      });
    }
  }

  // Y-008: numberOfRows validation
  if (spec.numberOfRows !== undefined) {
    if (typeof spec.numberOfRows !== "number" || !Number.isInteger(spec.numberOfRows) || spec.numberOfRows <= 0) {
      errors.push({
        code: "Y-008",
        message: `"numberOfRows" must be a positive integer, got ${JSON.stringify(spec.numberOfRows)}`,
        suggestion: "Set numberOfRows to a positive integer (e.g. 50).",
        details: { field: "numberOfRows", value: spec.numberOfRows },
      });
    }
  }

  // Y-009: data section validation
  if (spec.data !== undefined) {
    if (typeof spec.data !== "object" || Array.isArray(spec.data)) {
      errors.push({
        code: "Y-009",
        message: '"data" must be a map of column name to list of values',
        suggestion: 'Format data as: data:\\n  "Column Name":\\n    - "value1"\\n    - "value2"',
        details: { field: "data" },
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Pass 2: Type-specific required fields (T-xxx)
// ---------------------------------------------------------------------------

function pass2TypeSpecificFields(spec: GridSpec): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const col of spec.columns) {
    switch (col.type) {
      case "AI":
        // T-001: instruction required
        if (!col.instruction || typeof col.instruction !== "string") {
          errors.push(missingField(col.name, col.type, "instruction", "T-001"));
        }
        // T-003: single_select requires options
        if (isSingleSelect(col) && !hasNonEmptyArray(col, "options")) {
          errors.push({
            code: "T-003",
            message: `Column "${col.name}": single_select response format requires an "options" list with at least 1 item`,
            suggestion: "Add an options list: options:\\n  - Option1\\n  - Option2",
            details: { column: col.name, field: "options" },
          });
        }
        break;

      case "Agent":
        // T-010: agent + utterance required
        if (!col.agent) errors.push(missingField(col.name, col.type, "agent", "T-010"));
        if (!col.utterance || typeof col.utterance !== "string") {
          errors.push(missingField(col.name, col.type, "utterance", "T-010"));
        }
        break;

      case "AgentTest":
        // T-020: agent + inputUtterance required
        if (!col.agent) errors.push(missingField(col.name, col.type, "agent", "T-020"));
        if (!col.inputUtterance || typeof col.inputUtterance !== "string") {
          errors.push(missingField(col.name, col.type, "inputUtterance", "T-020"));
        }
        break;

      case "Object":
        // T-030: object required (skipped when soql is provided — advancedMode owns the schema)
        if (!col.soql && (!col.object || typeof col.object !== "string")) {
          errors.push(missingField(col.name, col.type, "object", "T-030"));
        }
        // T-031/T-032: fields or soql required
        if (!hasNonEmptyArray(col, "fields") && !col.soql) {
          errors.push({
            code: "T-031",
            message: `Column "${col.name}": Object column requires either "fields" (non-empty list) or "soql"`,
            suggestion: "Add fields: [Id, Name] or provide a soql query.",
            details: { column: col.name },
          });
        }
        break;

      case "DataModelObject":
        // T-090: dmo + dataspace required (skipped when dcsql is provided — advancedMode owns the schema)
        if (!col.dcsql) {
          if (!col.dmo || typeof col.dmo !== "string") {
            errors.push(missingField(col.name, col.type, "dmo", "T-090"));
          }
          if (!col.dataspace || typeof col.dataspace !== "string") {
            errors.push(missingField(col.name, col.type, "dataspace", "T-090"));
          }
        }
        if (!hasNonEmptyArray(col, "fields") && !col.dcsql) {
          errors.push({
            code: "T-090",
            message: `Column "${col.name}": DataModelObject column requires either "fields" or "dcsql"`,
            suggestion: "Add a fields list or provide a dcsql query.",
            details: { column: col.name },
          });
        }
        break;

      case "Formula":
        // T-040: formula + returnType required
        if (!col.formula || typeof col.formula !== "string") {
          errors.push(missingField(col.name, col.type, "formula", "T-040"));
        }
        if (!col.returnType || typeof col.returnType !== "string") {
          errors.push(missingField(col.name, col.type, "returnType", "T-040"));
        }
        break;

      case "Reference":
        // T-050: source + field required
        if (!col.source || typeof col.source !== "string") {
          errors.push(missingField(col.name, col.type, "source", "T-050"));
        }
        if (!col.field || typeof col.field !== "string") {
          errors.push(missingField(col.name, col.type, "field", "T-050"));
        }
        break;

      case "Evaluation":
        // T-060: input required, evaluationType required
        if (!col.input || typeof col.input !== "string") {
          errors.push(missingField(col.name, col.type, "input", "T-060"));
        }
        if (!col.evaluationType || typeof col.evaluationType !== "string") {
          errors.push(missingField(col.name, col.type, "evaluationType", "T-060"));
        }
        // T-061: reference required for certain eval types
        if (col.evaluationType && EVAL_TYPES_REQUIRING_REFERENCE.has(col.evaluationType as string)) {
          if (!col.reference || typeof col.reference !== "string") {
            errors.push({
              code: "T-061",
              message: `Column "${col.name}": evaluation type "${col.evaluationType}" requires a "reference" column`,
              suggestion: `Add reference: "ColumnName" pointing to the ground-truth column.`,
              details: { column: col.name, evaluationType: col.evaluationType },
            });
          }
        }
        break;

      case "PromptTemplate":
        // T-070: template + model (model can inherit from spec-level default)
        if (!col.template || typeof col.template !== "string") {
          errors.push(missingField(col.name, col.type, "template", "T-070"));
        }
        // T-071: inputs mapping
        if (!col.inputs || typeof col.inputs !== "object") {
          errors.push(missingField(col.name, col.type, "inputs", "T-071"));
        }
        break;

      case "InvocableAction":
        // T-080: action (object with type + name)
        if (!col.action || typeof col.action !== "object") {
          errors.push(missingField(col.name, col.type, "action", "T-080"));
        } else {
          const action = col.action as Record<string, unknown>;
          if (!action.type) errors.push(missingField(col.name, col.type, "action.type", "T-080"));
          if (!action.name) errors.push(missingField(col.name, col.type, "action.name", "T-080"));
        }
        // T-081: payload
        if (!col.payload || typeof col.payload !== "object") {
          errors.push(missingField(col.name, col.type, "payload", "T-081"));
        }
        break;

      case "Action":
        if (!col.actionName || typeof col.actionName !== "string") {
          errors.push(missingField(col.name, col.type, "actionName", "T-080"));
        }
        break;

      // Text: no required fields beyond name/type
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Pass 3: Reference integrity (R-xxx)
// ---------------------------------------------------------------------------

function pass3ReferenceIntegrity(spec: GridSpec, columnMap: Map<string, ColumnSpec>): ValidationError[] {
  const errors: ValidationError[] = [];
  const defined = [...columnMap.keys()];

  for (const col of spec.columns) {
    // R-001 / R-006 / R-007 / R-009: {ColumnName} placeholders in text fields
    const textFields: { field: string; ruleId: string }[] = [];

    if (col.type === "AI" && typeof col.instruction === "string") {
      textFields.push({ field: "instruction", ruleId: "R-001" });
    }
    if (col.type === "Agent" && typeof col.utterance === "string") {
      textFields.push({ field: "utterance", ruleId: "R-006" });
    }
    if (col.type === "Formula" && typeof col.formula === "string") {
      textFields.push({ field: "formula", ruleId: "R-007" });
    }

    for (const { field, ruleId } of textFields) {
      const refs = extractPlaceholderRefs(col[field] as string);
      for (const ref of refs) {
        const baseName = ref.split(".")[0];
        if (!columnMap.has(baseName)) {
          errors.push(undefinedRef(col.name, ref, field, ruleId, defined));
        }
      }
    }

    // R-009: InvocableAction payload placeholders
    if (col.type === "InvocableAction" && col.payload && typeof col.payload === "object") {
      const payloadStr = JSON.stringify(col.payload);
      const refs = extractPlaceholderRefs(payloadStr);
      for (const ref of refs) {
        const baseName = ref.split(".")[0];
        if (!columnMap.has(baseName)) {
          errors.push(undefinedRef(col.name, ref, "payload", "R-009", defined));
        }
      }
    }

    // R-010: Object/DMO soql/dcsql placeholders
    if ((col.type === "Object" && typeof col.soql === "string") ||
        (col.type === "DataModelObject" && typeof col.dcsql === "string")) {
      const queryStr = (col.soql ?? col.dcsql) as string;
      const refs = extractPlaceholderRefs(queryStr);
      for (const ref of refs) {
        const baseName = ref.split(".")[0];
        if (!columnMap.has(baseName)) {
          errors.push(undefinedRef(col.name, ref, col.soql ? "soql" : "dcsql", "R-010", defined));
        }
      }
    }

    // R-002: AgentTest inputUtterance
    if (col.type === "AgentTest" && typeof col.inputUtterance === "string") {
      if (!columnMap.has(col.inputUtterance as string)) {
        errors.push(undefinedRef(col.name, col.inputUtterance as string, "inputUtterance", "R-002", defined));
      }
    }

    // R-003: Evaluation input
    if (col.type === "Evaluation" && typeof col.input === "string") {
      if (!columnMap.has(col.input as string)) {
        errors.push(undefinedRef(col.name, col.input as string, "input", "R-003", defined));
      }
    }

    // R-004: Evaluation reference
    if (col.type === "Evaluation" && typeof col.reference === "string") {
      if (!columnMap.has(col.reference as string)) {
        errors.push(undefinedRef(col.name, col.reference as string, "reference", "R-004", defined));
      }
    }

    // R-005: Reference source
    if (col.type === "Reference" && typeof col.source === "string") {
      if (!columnMap.has(col.source as string)) {
        errors.push(undefinedRef(col.name, col.source as string, "source", "R-005", defined));
      }
    }

    // R-008: PromptTemplate inputs references
    if (col.type === "PromptTemplate" && col.inputs && typeof col.inputs === "object") {
      const inputs = col.inputs as Record<string, unknown>;
      for (const [inputName, inputVal] of Object.entries(inputs)) {
        if (typeof inputVal === "string") {
          const refs = extractPlaceholderRefs(inputVal);
          for (const ref of refs) {
            const baseName = ref.split(".")[0];
            if (!columnMap.has(baseName)) {
              errors.push(undefinedRef(col.name, ref, `inputs.${inputName}`, "R-008", defined));
            }
          }
        }
      }
    }

    // Agent/AgentTest contextVariables references
    if ((col.type === "Agent" || col.type === "AgentTest") && col.contextVariables) {
      const cvs = col.contextVariables as Record<string, unknown>;
      for (const [varName, varVal] of Object.entries(cvs)) {
        if (typeof varVal === "string") {
          const refs = extractPlaceholderRefs(varVal);
          for (const ref of refs) {
            const baseName = ref.split(".")[0];
            if (!columnMap.has(baseName)) {
              errors.push(undefinedRef(col.name, ref, `contextVariables.${varName}`, "R-006", defined));
            }
          }
        }
      }
    }

    // Agent/AgentTest conversationHistory reference
    if ((col.type === "Agent" || col.type === "AgentTest") && typeof col.conversationHistory === "string") {
      if (!columnMap.has(col.conversationHistory as string)) {
        errors.push(undefinedRef(col.name, col.conversationHistory as string, "conversationHistory", "R-006", defined));
      }
    }

    // Agent/AgentTest initialState reference
    if ((col.type === "Agent" || col.type === "AgentTest") && typeof col.initialState === "string") {
      if (!columnMap.has(col.initialState as string)) {
        errors.push(undefinedRef(col.name, col.initialState as string, "initialState", "R-006", defined));
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Pass 4: Circular dependency detection (D-xxx)
// ---------------------------------------------------------------------------

function pass4CircularDependency(
  spec: GridSpec,
  columnMap: Map<string, ColumnSpec>,
): { errors: ValidationError[]; sorted: ColumnSpec[] } {
  const errors: ValidationError[] = [];

  // Build adjacency: for each column, compute its set of dependency column names
  const deps = new Map<string, Set<string>>();
  for (const col of spec.columns) {
    deps.set(col.name, getDependencies(col, columnMap));
  }

  // D-001: self-references
  for (const col of spec.columns) {
    const colDeps = deps.get(col.name)!;
    if (colDeps.has(col.name)) {
      errors.push({
        code: "D-001",
        message: `Column "${col.name}" references itself`,
        suggestion: "A column cannot use its own output as input. Reference a different column.",
        details: { column: col.name },
      });
      colDeps.delete(col.name); // remove to continue cycle detection
    }
  }

  // Kahn's algorithm for topological sort
  const inDegree = new Map<string, number>();
  const reverseAdj = new Map<string, string[]>(); // dependency -> dependents

  for (const col of spec.columns) {
    inDegree.set(col.name, 0);
    reverseAdj.set(col.name, []);
  }

  for (const col of spec.columns) {
    const colDeps = deps.get(col.name)!;
    // Only count deps that are within the spec columns
    let count = 0;
    for (const dep of colDeps) {
      if (columnMap.has(dep)) {
        reverseAdj.get(dep)!.push(col.name);
        count++;
      }
    }
    inDegree.set(col.name, count);
  }

  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const dependent of reverseAdj.get(current)!) {
      const newDegree = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) queue.push(dependent);
    }
  }

  // D-002: if not all columns are in sorted, there's a cycle
  if (sorted.length < spec.columns.length) {
    const inCycle = spec.columns
      .map((c) => c.name)
      .filter((name) => !sorted.includes(name));

    // Find a specific cycle path for the error message
    const cyclePath = findCyclePath(inCycle, deps);
    errors.push({
      code: "D-002",
      message: `Circular dependency detected: ${cyclePath.join(" -> ")}`,
      suggestion: "Break the cycle by removing one of the references. Column execution requires a directed acyclic graph.",
      details: { cycle: cyclePath },
    });
  }

  const sortedColumns = sorted.map((name) => columnMap.get(name)!);
  return { errors, sorted: sortedColumns };
}

// ---------------------------------------------------------------------------
// Pass 5: Type compatibility (C-xxx)
// ---------------------------------------------------------------------------

function pass5TypeCompatibility(spec: GridSpec, columnMap: Map<string, ColumnSpec>): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const col of spec.columns) {
    if (col.type === "Evaluation") {
      // C-001: Evaluation input must target Agent/AgentTest/AI/PromptTemplate
      if (typeof col.input === "string" && columnMap.has(col.input as string)) {
        const target = columnMap.get(col.input as string)!;
        if (!VALID_EVAL_INPUT_TYPES.has(target.type)) {
          errors.push({
            code: "C-001",
            message: `Evaluation column "${col.name}" targets "${target.name}" which is type "${target.type}", but evaluations only support: ${[...VALID_EVAL_INPUT_TYPES].join(", ")}`,
            suggestion: `Change "input" to reference a column of type ${[...VALID_EVAL_INPUT_TYPES].join(", ")}.`,
            details: { column: col.name, target: target.name, targetType: target.type },
          });
        }
      }

      // C-002: Evaluation reference must be Text
      if (typeof col.reference === "string" && columnMap.has(col.reference as string)) {
        const refCol = columnMap.get(col.reference as string)!;
        if (refCol.type !== "Text") {
          errors.push({
            code: "C-002",
            message: `Evaluation column "${col.name}" reference "${refCol.name}" is type "${refCol.type}", but reference must be Text`,
            suggestion: 'Change "reference" to point to a Text column containing ground-truth values.',
            details: { column: col.name, reference: refCol.name, referenceType: refCol.type },
          });
        }
      }
    }

    // C-004: AgentTest inputUtterance must reference a Text column
    if (col.type === "AgentTest" && typeof col.inputUtterance === "string") {
      const target = columnMap.get(col.inputUtterance as string);
      if (target && target.type !== "Text") {
        errors.push({
          code: "C-004",
          message: `AgentTest column "${col.name}" inputUtterance references "${target.name}" which is type "${target.type}", but must be Text`,
          suggestion: 'Change "inputUtterance" to reference a Text column.',
          details: { column: col.name, target: target.name, targetType: target.type },
        });
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Pass 6: Value validation (V-xxx)
// ---------------------------------------------------------------------------

function pass6ValueValidation(spec: GridSpec, columnMap: Map<string, ColumnSpec>): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const col of spec.columns) {
    // V-001: eval_type validity
    if (col.type === "Evaluation" && typeof col.evaluationType === "string") {
      if (!VALID_EVAL_TYPES.has(col.evaluationType as string)) {
        errors.push({
          code: "V-001",
          message: `Column "${col.name}": unknown evaluation type "${col.evaluationType}"`,
          suggestion: `Valid evaluation types: ${[...VALID_EVAL_TYPES].join(", ")}`,
          details: { column: col.name, value: col.evaluationType },
        });
      }
    }

    // V-002: model validation (on columns that have model field)
    if (typeof col.model === "string") {
      validateModel(col.model as string, col.name, errors);
    }

    // V-003: response format validation (AI columns)
    if (col.type === "AI" && col.responseFormat !== undefined) {
      const rf = col.responseFormat;
      if (typeof rf === "string") {
        if (!VALID_RESPONSE_FORMATS.has(rf)) {
          errors.push({
            code: "V-003",
            message: `Column "${col.name}": invalid response format "${rf}"`,
            suggestion: "Use plain_text or single_select.",
            details: { column: col.name, value: rf },
          });
        }
      } else if (typeof rf === "object" && rf !== null) {
        const rfObj = rf as Record<string, unknown>;
        if (rfObj.type && typeof rfObj.type === "string" && !VALID_RESPONSE_FORMATS.has(rfObj.type)) {
          errors.push({
            code: "V-003",
            message: `Column "${col.name}": invalid response format type "${rfObj.type}"`,
            suggestion: "Use plain_text or single_select.",
            details: { column: col.name, value: rfObj.type },
          });
        }
      }
    }

    // V-004: Formula return type
    if (col.type === "Formula" && typeof col.returnType === "string") {
      if (!VALID_RETURN_TYPES.has(col.returnType as string)) {
        errors.push({
          code: "V-004",
          message: `Column "${col.name}": invalid return type "${col.returnType}"`,
          suggestion: `Valid return types: ${[...VALID_RETURN_TYPES].join(", ")}`,
          details: { column: col.name, value: col.returnType },
        });
      }
    }

    // V-007: Context variable conflict (value AND reference both set)
    if ((col.type === "Agent" || col.type === "AgentTest") && col.contextVariables) {
      const cvs = col.contextVariables as Record<string, unknown>;
      for (const [varName, varVal] of Object.entries(cvs)) {
        if (varVal && typeof varVal === "object" && !Array.isArray(varVal)) {
          const obj = varVal as Record<string, unknown>;
          if (obj.value !== undefined && obj.reference !== undefined) {
            errors.push({
              code: "V-007",
              message: `Column "${col.name}": context variable "${varName}" has both "value" and "reference" set`,
              suggestion: "Remove either value or reference. A context variable must use one or the other, not both.",
              details: { column: col.name, variable: varName },
            });
          }
        }
      }
    }
  }

  // V-002: spec-level model
  if (typeof spec.model === "string") {
    validateModel(spec.model, "(spec-level)", errors);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract {ColumnName} or {ColumnName.Field} references from a string. */
function extractPlaceholderRefs(text: string): string[] {
  const refs: string[] = [];
  const regex = /\{([^{}$]+?)\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const inner = match[1].trim();
    // Skip things that look like JSON paths (response.xxx), pure numbers, etc.
    if (inner && !inner.startsWith("response.") && !inner.startsWith("json.") && !/^\d+$/.test(inner)) {
      refs.push(inner);
    }
  }
  return refs;
}

/** Compute the set of column names that a given column depends on. */
function getDependencies(col: ColumnSpec, columnMap: Map<string, ColumnSpec>): Set<string> {
  const deps = new Set<string>();

  // Placeholder refs in text fields
  const textFieldsToCheck: string[] = [];
  if (col.type === "AI" && typeof col.instruction === "string") textFieldsToCheck.push(col.instruction as string);
  if (col.type === "Agent" && typeof col.utterance === "string") textFieldsToCheck.push(col.utterance as string);
  if (col.type === "Formula" && typeof col.formula === "string") textFieldsToCheck.push(col.formula as string);

  for (const text of textFieldsToCheck) {
    for (const ref of extractPlaceholderRefs(text)) {
      const baseName = ref.split(".")[0];
      if (columnMap.has(baseName)) deps.add(baseName);
    }
  }

  // InvocableAction payload
  if (col.type === "InvocableAction" && col.payload && typeof col.payload === "object") {
    for (const ref of extractPlaceholderRefs(JSON.stringify(col.payload))) {
      const baseName = ref.split(".")[0];
      if (columnMap.has(baseName)) deps.add(baseName);
    }
  }

  // Object/DMO query placeholders
  if (col.type === "Object" && typeof col.soql === "string") {
    for (const ref of extractPlaceholderRefs(col.soql as string)) {
      const baseName = ref.split(".")[0];
      if (columnMap.has(baseName)) deps.add(baseName);
    }
  }
  if (col.type === "DataModelObject" && typeof col.dcsql === "string") {
    for (const ref of extractPlaceholderRefs(col.dcsql as string)) {
      const baseName = ref.split(".")[0];
      if (columnMap.has(baseName)) deps.add(baseName);
    }
  }

  // Direct name references
  if (col.type === "AgentTest" && typeof col.inputUtterance === "string" && columnMap.has(col.inputUtterance as string)) {
    deps.add(col.inputUtterance as string);
  }
  if (col.type === "Evaluation" && typeof col.input === "string" && columnMap.has(col.input as string)) {
    deps.add(col.input as string);
  }
  if (col.type === "Evaluation" && typeof col.reference === "string" && columnMap.has(col.reference as string)) {
    deps.add(col.reference as string);
  }
  if (col.type === "Reference" && typeof col.source === "string" && columnMap.has(col.source as string)) {
    deps.add(col.source as string);
  }

  // PromptTemplate inputs
  if (col.type === "PromptTemplate" && col.inputs && typeof col.inputs === "object") {
    for (const val of Object.values(col.inputs as Record<string, unknown>)) {
      if (typeof val === "string") {
        for (const ref of extractPlaceholderRefs(val)) {
          const baseName = ref.split(".")[0];
          if (columnMap.has(baseName)) deps.add(baseName);
        }
      }
    }
  }

  // Agent/AgentTest contextVariables refs
  if ((col.type === "Agent" || col.type === "AgentTest") && col.contextVariables) {
    for (const val of Object.values(col.contextVariables as Record<string, unknown>)) {
      if (typeof val === "string") {
        for (const ref of extractPlaceholderRefs(val)) {
          const baseName = ref.split(".")[0];
          if (columnMap.has(baseName)) deps.add(baseName);
        }
      }
    }
  }

  // Agent/AgentTest conversationHistory / initialState
  if ((col.type === "Agent" || col.type === "AgentTest") && typeof col.conversationHistory === "string") {
    if (columnMap.has(col.conversationHistory as string)) deps.add(col.conversationHistory as string);
  }
  if ((col.type === "Agent" || col.type === "AgentTest") && typeof col.initialState === "string") {
    if (columnMap.has(col.initialState as string)) deps.add(col.initialState as string);
  }

  return deps;
}

/** Find a cycle path for error reporting. */
function findCyclePath(cycleNodes: string[], deps: Map<string, Set<string>>): string[] {
  if (cycleNodes.length === 0) return [];

  const inCycle = new Set(cycleNodes);
  const start = cycleNodes[0];
  const path: string[] = [start];
  const visited = new Set<string>();
  visited.add(start);

  let current = start;
  while (true) {
    const neighbors = deps.get(current);
    if (!neighbors) break;
    let next: string | undefined;
    for (const n of neighbors) {
      if (inCycle.has(n)) {
        if (n === start && path.length > 1) {
          path.push(n);
          return path;
        }
        if (!visited.has(n)) {
          next = n;
          break;
        }
      }
    }
    if (!next) {
      // fallback: close the loop back to start
      path.push(start);
      return path;
    }
    path.push(next);
    visited.add(next);
    current = next;
  }

  path.push(start);
  return path;
}

function missingField(column: string, type: string, field: string, code: string): ValidationError {
  return {
    code,
    message: `Column "${column}" is missing required field "${field}" for type "${type}"`,
    suggestion: `Add "${field}" to the column definition. See DSL reference for ${type} columns.`,
    details: { column, type, field },
  };
}

function undefinedRef(
  column: string,
  ref: string,
  field: string,
  code: string,
  defined: string[],
): ValidationError {
  return {
    code,
    message: `Column "${column}" references "${ref}" in "${field}" but no column named "${ref}" is defined`,
    suggestion: `Add a column named "${ref}" or fix the reference. Defined columns: ${defined.join(", ")}`,
    details: { column, field, ref, availableColumns: defined },
  };
}

function isSingleSelect(col: ColumnSpec): boolean {
  if (typeof col.responseFormat === "string") return col.responseFormat === "single_select";
  if (typeof col.responseFormat === "object" && col.responseFormat !== null) {
    return (col.responseFormat as Record<string, unknown>).type === "single_select";
  }
  return false;
}

function hasNonEmptyArray(col: ColumnSpec, field: string): boolean {
  const val = col[field];
  return Array.isArray(val) && val.length > 0;
}

function validateModel(model: string, columnName: string, errors: ValidationError[]): void {
  // Accept known shorthands
  if (MODEL_SHORTHANDS[model]) return;
  // Accept full sfdc_ai__ IDs
  if (model.startsWith("sfdc_ai__")) return;

  // Find closest match for suggestion
  const shorthands = Object.keys(MODEL_SHORTHANDS);
  let closest = shorthands[0];
  let closestDist = Infinity;
  for (const s of shorthands) {
    const d = levenshtein(model, s);
    if (d < closestDist) {
      closestDist = d;
      closest = s;
    }
  }

  errors.push({
    code: "V-002",
    message: `${columnName === "(spec-level)" ? "Spec-level" : `Column "${columnName}"`}: model "${model}" is not a recognized shorthand or full model ID`,
    suggestion: `Did you mean "${closest}"? Valid shorthands: ${shorthands.join(", ")}`,
    details: { column: columnName, value: model, closestMatch: closest },
  });
}

/** Simple Levenshtein distance for "did you mean?" suggestions. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}
