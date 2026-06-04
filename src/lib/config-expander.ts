/**
 * Config expander: transforms flat YAML ColumnSpec into triple-nested GCC JSON
 * that passes ColumnConfigUnionSchema.parse().
 */

import { z } from "zod";
import { ColumnInputSchema, ColumnConfigUnionSchema } from "../schemas.js";
import { resolveModelShorthand } from "./model-map.js";
import type { ColumnSpec } from "./yaml-parser.js";
import { normalizeFilterValues } from "./filter-helpers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColumnMapEntry {
  id: string;
  name: string;
  type: string; // API PascalCase type (AI, Object, AgentTest, etc.)
  fields?: string[]; // Field API names for Object/DataModelObject columns
}

export interface ExpansionContext {
  columnMap: Map<string, ColumnMapEntry>;
  defaults: { numberOfRows: number; model: string };
  resolveModel: (shorthand: string) => { modelId: string; modelName: string };
}

// ---------------------------------------------------------------------------
// Column type -> referenceAttribute columnType mapping
// ---------------------------------------------------------------------------

/** Maps API type names to the values accepted by ColumnTypeEnum in schemas.ts (PascalCase). */
const REF_TYPE_MAP: Record<string, string> = {
  AI: "AI",
  Agent: "Agent",
  AgentTest: "AgentTest",
  Object: "Object",
  DataModelObject: "DataModelObject",
  Text: "Text",
  Reference: "Reference",
  Formula: "Formula",
  PromptTemplate: "PromptTemplate",
  InvocableAction: "InvocableAction",
  Action: "Action",
  Evaluation: "Evaluation",
};

// Filter operator shorthand -> API uppercase snake (matches Core's enum)
const FILTER_OP_MAP: Record<string, string> = {
  in: "IN",
  not_in: "NOT_IN",
  eq: "EQUAL_TO",
  neq: "NOT_EQUAL_TO",
  contains: "CONTAINS",
  starts_with: "STARTS_WITH",
  ends_with: "ENDS_WITH",
  is_null: "IS_NULL",
  is_not_null: "IS_NOT_NULL",
  lt: "LESS_THAN",
  lte: "LESS_THAN_OR_EQUAL_TO",
  gt: "GREATER_THAN",
  gte: "GREATER_THAN_OR_EQUAL_TO",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function expandColumnConfig(
  yamlCol: ColumnSpec,
  ctx: ExpansionContext,
): z.infer<typeof ColumnInputSchema> {
  const colType = yamlCol.type; // Already API PascalCase from yaml-parser
  const innerConfig = buildInnerConfig(yamlCol, colType, ctx);
  const qrf = inferQueryResponseFormat(yamlCol, colType);
  const numberOfRows = (yamlCol.numberOfRows as number | undefined) ?? ctx.defaults.numberOfRows;

  const outerConfig: Record<string, unknown> = {
    type: colType,
    autoUpdate: true,
    config: { autoUpdate: true, ...innerConfig },
  };

  if (qrf) {
    outerConfig.queryResponseFormat = qrf;
  }

  // numberOfRows on the outer config for types that use it
  if (colType !== "Text" || yamlCol.documentId) {
    outerConfig.numberOfRows = numberOfRows;
  }

  // Validate against the Zod schema
  const parseResult = ColumnConfigUnionSchema.safeParse(outerConfig);
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Config expansion failed for column "${yamlCol.name}" (type: ${colType}):\n${issues}`,
    );
  }

  return {
    name: yamlCol.name,
    type: colType as z.infer<typeof ColumnInputSchema>["type"],
    config: parseResult.data,
  };
}

// ---------------------------------------------------------------------------
// queryResponseFormat inference
// ---------------------------------------------------------------------------

function inferQueryResponseFormat(
  yamlCol: ColumnSpec,
  colType: string,
): { type: string; splitByType?: string } | undefined {
  if (colType === "Object" || colType === "DataModelObject") {
    return { type: "WHOLE_COLUMN", splitByType: "OBJECT_PER_ROW" };
  }
  if (colType === "Text" && yamlCol.documentId) {
    return { type: "WHOLE_COLUMN", splitByType: "OBJECT_PER_ROW" };
  }
  if (colType === "Text") {
    return undefined;
  }
  return { type: "EACH_ROW" };
}

// ---------------------------------------------------------------------------
// Inner config builders by type
// ---------------------------------------------------------------------------

function buildInnerConfig(
  col: ColumnSpec,
  colType: string,
  ctx: ExpansionContext,
): Record<string, unknown> {
  switch (colType) {
    case "AI":
      return buildAIConfig(col, ctx);
    case "Agent":
      return buildAgentConfig(col, ctx);
    case "AgentTest":
      return buildAgentTestConfig(col, ctx);
    case "Object":
      return buildObjectConfig(col);
    case "DataModelObject":
      return buildDataModelObjectConfig(col);
    case "Evaluation":
      return buildEvaluationConfig(col, ctx);
    case "Reference":
      return buildReferenceConfig(col, ctx);
    case "Formula":
      return buildFormulaConfig(col, ctx);
    case "PromptTemplate":
      return buildPromptTemplateConfig(col, ctx);
    case "InvocableAction":
      return buildInvocableActionConfig(col, ctx);
    case "Action":
      return buildActionConfig(col, ctx);
    case "Text":
      return buildTextConfig(col);
    default:
      throw new Error(`Unknown column type: ${colType}`);
  }
}

// ---------------------------------------------------------------------------
// Placeholder rewriting: {ColumnName} and {ColumnName.FieldName} -> {$N}
// ---------------------------------------------------------------------------

interface RewriteResult {
  rewritten: string;
  referenceAttributes: Array<{
    columnId: string;
    columnName: string;
    columnType: string;
    fieldName?: string;
  }>;
}

function rewritePlaceholders(text: string, ctx: ExpansionContext): RewriteResult {
  const refs: RewriteResult["referenceAttributes"] = [];
  const seenRefs = new Map<string, string>(); // "ColName.Field" -> "{$N}"
  let index = 1;

  const rewritten = text.replace(/\{([^}$]+)\}/g, (_match, refExpr: string) => {
    // Skip if already seen (dedup)
    if (seenRefs.has(refExpr)) {
      return seenRefs.get(refExpr)!;
    }

    const dotIdx = refExpr.indexOf(".");
    const columnName = dotIdx >= 0 ? refExpr.slice(0, dotIdx) : refExpr;
    const fieldName = dotIdx >= 0 ? refExpr.slice(dotIdx + 1) : undefined;

    const entry = ctx.columnMap.get(columnName);
    if (!entry) {
      throw new Error(
        `Column "${columnName}" referenced in placeholder "{${refExpr}}" not found in column map`,
      );
    }

    const placeholder = `{$${index}}`;
    seenRefs.set(refExpr, placeholder);

    // For Object/DataModelObject columns, Core requires fieldName to resolve the
    // cell value. If the YAML didn't use dot notation ({Col.Field}), auto-populate
    // from the column's first field.
    let resolvedFieldName = fieldName;
    if (!resolvedFieldName && (entry.type === "Object" || entry.type === "DataModelObject")) {
      if (entry.fields && entry.fields.length > 0) {
        resolvedFieldName = entry.fields[0];
      }
    }

    refs.push({
      columnId: entry.id,
      columnName: entry.name,
      columnType: REF_TYPE_MAP[entry.type] ?? entry.type,
      ...(resolvedFieldName ? { fieldName: resolvedFieldName } : {}),
    });

    index++;
    return placeholder;
  });

  return { rewritten, referenceAttributes: refs };
}

// ---------------------------------------------------------------------------
// Build a referenceAttribute for a single column name reference
// ---------------------------------------------------------------------------

function buildColumnRef(
  columnName: string,
  ctx: ExpansionContext,
  fieldName?: string,
): { columnId: string; columnName: string; columnType: string; fieldName?: string } {
  const entry = ctx.columnMap.get(columnName);
  if (!entry) {
    throw new Error(`Referenced column "${columnName}" not found in column map`);
  }
  let resolvedFieldName = fieldName;
  if (!resolvedFieldName && (entry.type === "Object" || entry.type === "DataModelObject")) {
    if (entry.fields && entry.fields.length > 0) {
      resolvedFieldName = entry.fields[0];
    }
  }
  return {
    columnId: entry.id,
    columnName: entry.name,
    columnType: REF_TYPE_MAP[entry.type] ?? entry.type,
    ...(resolvedFieldName ? { fieldName: resolvedFieldName } : {}),
  };
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

function buildAIConfig(col: ColumnSpec, ctx: ExpansionContext): Record<string, unknown> {
  const instruction = col.instruction as string;
  const { rewritten, referenceAttributes } = rewritePlaceholders(instruction, ctx);

  const modelShorthand = (col.model as string | undefined) ?? ctx.defaults.model;
  const modelConfig = ctx.resolveModel(modelShorthand);

  const config: Record<string, unknown> = {
    mode: "llm",
    modelConfig,
    instruction: rewritten,
  };

  if (referenceAttributes.length > 0) {
    config.referenceAttributes = referenceAttributes;
  }

  config.responseFormat = expandResponseFormat(col.responseFormat);

  return config;
}

function expandResponseFormat(
  rf: unknown,
): { type: string; outputExample?: string; options?: Array<{ label: string; identifier?: string }> } {
  if (rf === undefined || rf === null || rf === "plain_text") {
    return { type: "PLAIN_TEXT" };
  }

  if (typeof rf === "string") {
    if (rf === "single_select") {
      return { type: "SINGLE_SELECT" };
    }
    return { type: rf.toUpperCase() };
  }

  if (typeof rf === "object" && rf !== null) {
    const obj = rf as Record<string, unknown>;
    const result: Record<string, unknown> = {
      type: ((obj.type as string) ?? "plain_text").toUpperCase(),
    };

    if (obj.outputExample) {
      result.outputExample = obj.outputExample;
    }

    if (Array.isArray(obj.options)) {
      result.options = (obj.options as unknown[]).map((opt) => {
        if (typeof opt === "string") {
          return { label: opt };
        }
        return opt;
      });
    }

    return result as ReturnType<typeof expandResponseFormat>;
  }

  return { type: "PLAIN_TEXT" };
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

function buildAgentConfig(col: ColumnSpec, ctx: ExpansionContext): Record<string, unknown> {
  const agentId = col.agentId as string;
  const agentVersion = col.agentVersion as string | undefined;
  const utterance = col.utterance as string;

  const { rewritten, referenceAttributes } = rewritePlaceholders(utterance, ctx);

  const config: Record<string, unknown> = {
    agentId,
    utterance: rewritten,
  };

  if (agentVersion) {
    config.agentVersion = agentVersion;
  }

  if (referenceAttributes.length > 0) {
    config.utteranceReferences = referenceAttributes;
  }

  // Context variables
  if (col.contextVariables) {
    config.contextVariables = expandContextVariables(
      col.contextVariables as Record<string, unknown>,
      ctx,
    );
  }

  // Conversation history / initial state
  if (col.conversationHistory) {
    config.conversationHistory = buildColumnRef(col.conversationHistory as string, ctx);
  }
  if (col.initialState) {
    config.initialState = buildColumnRef(col.initialState as string, ctx);
  }

  return config;
}

// ---------------------------------------------------------------------------
// AgentTest
// ---------------------------------------------------------------------------

function buildAgentTestConfig(col: ColumnSpec, ctx: ExpansionContext): Record<string, unknown> {
  const agentId = col.agentId as string;
  const agentVersion = col.agentVersion as string | undefined;
  const inputUtteranceCol = col.inputUtterance as string;

  const config: Record<string, unknown> = {
    agentId,
    inputUtterance: buildColumnRef(inputUtteranceCol, ctx),
    contextVariables: col.contextVariables
      ? expandContextVariables(col.contextVariables as Record<string, unknown>, ctx)
      : [],
    isDraft: (col.isDraft as boolean) ?? false,
    enableSimulationMode: (col.enableSimulationMode as boolean) ?? false,
  };

  if (agentVersion) {
    config.agentVersion = agentVersion;
  }

  if (col.conversationHistory) {
    config.conversationHistory = buildColumnRef(col.conversationHistory as string, ctx);
  }
  if (col.initialState) {
    config.initialState = buildColumnRef(col.initialState as string, ctx);
  }

  return config;
}

// ---------------------------------------------------------------------------
// Context variable expansion (shared by Agent/AgentTest)
// ---------------------------------------------------------------------------

function expandContextVariables(
  vars: Record<string, unknown>,
  ctx: ExpansionContext,
): Array<Record<string, unknown>> {
  return Object.entries(vars).map(([variableName, value]) => {
    if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) {
      // Column reference: {ColumnName} or {ColumnName.FieldName}
      const refExpr = value.slice(1, -1);
      const dotIdx = refExpr.indexOf(".");
      const columnName = dotIdx >= 0 ? refExpr.slice(0, dotIdx) : refExpr;
      const fieldName = dotIdx >= 0 ? refExpr.slice(dotIdx + 1) : undefined;

      return {
        variableName,
        type: "Text",
        reference: buildColumnRef(columnName, ctx, fieldName),
      };
    }

    // Static value
    return {
      variableName,
      type: "Text",
      value,
    };
  });
}

// ---------------------------------------------------------------------------
// Object
// ---------------------------------------------------------------------------

function buildObjectConfig(col: ColumnSpec): Record<string, unknown> {
  const config: Record<string, unknown> = {
    objectApiName: col.object as string,
  };

  // `fields` is optional when `soql:` is provided (advancedMode covers the field selection
  // via the SOQL select-list). Without this guard, expandFields(undefined) crashes.
  if (col.fields !== undefined) {
    config.fields = expandFields(col.fields as unknown[], col.name as string);
  }

  if (col.filters) {
    config.filters = expandFilters(col.filters as unknown[], col.name as string);
  }

  if (col.soql) {
    // Core's SObjectProcessingServiceImpl.getAdvancedModeQueryString reads
    // `inputs.queryString` (AIWorkbookConstants.SOQL_QUERY_STRING_PARAM).
    // Using any other key — including the previous `query` — causes Core to
    // throw "The SOQL query string is missing." on processing.
    config.advancedMode = {
      type: "SOQL",
      inputs: { queryString: col.soql as string },
    };
  }

  return config;
}

// ---------------------------------------------------------------------------
// DataModelObject
// ---------------------------------------------------------------------------

function buildDataModelObjectConfig(col: ColumnSpec): Record<string, unknown> {
  const config: Record<string, unknown> = {
    dataModelObjectApiName: col.dmo as string,
    dataspaceName: col.dataspace as string,
  };

  // `fields` is optional when `dcsql:` is provided.
  if (col.fields !== undefined) {
    config.fields = expandFields(col.fields as unknown[], col.name as string);
  }

  if (col.filters) {
    config.filters = expandFilters(col.filters as unknown[], col.name as string);
  }

  if (col.dcsql) {
    // Mirrors Object's SOQL handling — Core reads `inputs.queryString`.
    config.advancedMode = {
      type: "DCSQL",
      inputs: { queryString: col.dcsql as string },
    };
  }

  return config;
}

// ---------------------------------------------------------------------------
// Fields and filters (shared by Object/DataModelObject)
// ---------------------------------------------------------------------------

function expandFields(
  fields: unknown[],
  columnName?: string,
): Array<{ name: string; type?: string }> {
  if (!Array.isArray(fields)) {
    throw new Error(
      `Column${columnName ? ` "${columnName}"` : ""}: "fields" must be a list (got ${typeof fields}).`,
    );
  }
  return fields.map((f) => {
    if (typeof f === "string") {
      return { name: f, type: "STRING" };
    }
    if (typeof f === "object" && f !== null) {
      // { FieldName: type } format
      const entries = Object.entries(f as Record<string, unknown>);
      if (entries.length === 1) {
        const [name, type] = entries[0];
        return { name, type: String(type).toUpperCase() };
      }
      // Already a {name, type} object
      return f as { name: string; type?: string };
    }
    return { name: String(f), type: "STRING" };
  });
}

function expandFilters(
  filters: unknown[],
  columnName?: string,
): Array<{ field: string; operator: string; values?: unknown[] }> {
  return (filters as Array<Record<string, unknown>>).map((f, index) => {
    const ctx = `Column${columnName ? ` "${columnName}"` : ""} filters[${index}]`;

    if (f === null || typeof f !== "object") {
      throw new Error(`${ctx}: filter must be an object (got ${typeof f}).`);
    }

    if (f.field === undefined || f.field === null || f.field === "") {
      throw new Error(`${ctx}: missing required "field" (the column to filter on).`);
    }
    if (f.operator === undefined || f.operator === null || f.operator === "") {
      throw new Error(`${ctx}: missing required "operator". Valid: ${describeFilterOperators()}.`);
    }

    const operator = resolveFilterOperator(f.operator as string, ctx);
    const result: Record<string, unknown> = {
      field: f.field as string,
      operator,
    };

    // Accept `value:` (singular) as a single-element `values` array. Common LLM/user
    // mistake; without this coercion the value silently disappeared and the filter
    // matched nothing. `values` (plural) takes precedence if both are provided.
    let rawValues: unknown[] | undefined;
    if (f.values !== undefined) {
      rawValues = (f.values as unknown[]).map((v) => v);
    } else if (f.value !== undefined) {
      rawValues = [f.value];
    }

    // Wrap scalar values into Core's expected `{value, type}` object shape.
    // Already-wrapped objects pass through unchanged.
    if (rawValues !== undefined) {
      result.values = normalizeFilterValues(rawValues);
    }

    return result as { field: string; operator: string; values?: unknown[] };
  });
}

function resolveFilterOperator(op: string, errorContext?: string): string {
  // Check the shorthand map (case-insensitive)
  const lower = op.toLowerCase();
  if (FILTER_OP_MAP[lower]) {
    return FILTER_OP_MAP[lower];
  }
  // Already canonical (uppercase) and listed in the value map's image
  const canonical = Object.values(FILTER_OP_MAP);
  if (canonical.includes(op)) {
    return op;
  }
  // Unknown — surface a helpful error that lists both shorthand and canonical names.
  const ctx = errorContext ? `${errorContext}: ` : "";
  throw new Error(
    `${ctx}unknown filter operator "${op}". Valid: ${describeFilterOperators()}.`,
  );
}

/** Human-friendly listing of accepted filter operators (shorthand + canonical). */
function describeFilterOperators(): string {
  const shorthand = Object.keys(FILTER_OP_MAP).join(", ");
  const canonical = Array.from(new Set(Object.values(FILTER_OP_MAP))).join(", ");
  return `shorthand (${shorthand}) or canonical (${canonical})`;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function buildEvaluationConfig(col: ColumnSpec, ctx: ExpansionContext): Record<string, unknown> {
  const inputColName = col.input as string;
  const referenceColName = col.reference as string | undefined;

  const config: Record<string, unknown> = {
    inputColumnReference: buildColumnRef(inputColName, ctx),
    autoEvaluate: (col.autoEvaluate as boolean) ?? true,
  };

  // evaluationType from eval/* shorthand or explicit
  if (col.evaluationType) {
    config.evaluationType = col.evaluationType as string;
  }

  if (referenceColName) {
    config.referenceColumnReference = buildColumnRef(referenceColName, ctx);
  }

  // Expression evaluation fields
  if (col.formula) {
    config.expressionFormula = col.formula as string;
    config.expressionReturnType = (col.returnType as string) ?? "boolean";
  }

  // Custom evaluation
  if (col.customEvaluation) {
    config.customEvaluation = col.customEvaluation;
  }

  return config;
}

// ---------------------------------------------------------------------------
// Reference
// ---------------------------------------------------------------------------

function buildReferenceConfig(col: ColumnSpec, ctx: ExpansionContext): Record<string, unknown> {
  const sourceColName = col.source as string;
  const entry = ctx.columnMap.get(sourceColName);
  if (!entry) {
    throw new Error(`Referenced source column "${sourceColName}" not found in column map`);
  }

  return {
    referenceColumnId: entry.id,
    referenceField: col.field as string,
  };
}

// ---------------------------------------------------------------------------
// Formula
// ---------------------------------------------------------------------------

function buildFormulaConfig(col: ColumnSpec, ctx: ExpansionContext): Record<string, unknown> {
  const formula = col.formula as string;
  const { rewritten, referenceAttributes } = rewritePlaceholders(formula, ctx);

  const config: Record<string, unknown> = {
    formula: rewritten,
  };

  if (col.returnType) {
    config.returnType = col.returnType as string;
  }

  if (referenceAttributes.length > 0) {
    config.referenceAttributes = referenceAttributes;
  }

  return config;
}

// ---------------------------------------------------------------------------
// PromptTemplate
// ---------------------------------------------------------------------------

function buildPromptTemplateConfig(col: ColumnSpec, ctx: ExpansionContext): Record<string, unknown> {
  const modelShorthand = (col.model as string | undefined) ?? ctx.defaults.model;
  const modelConfig = ctx.resolveModel(modelShorthand);

  const config: Record<string, unknown> = {
    promptTemplateDevName: col.template as string,
    modelConfig,
  };

  if (col.templateType) {
    config.promptTemplateType = col.templateType as string;
  }

  // Map inputs to promptTemplateInputConfigs
  if (col.inputs) {
    const inputs = col.inputs as Record<string, unknown>;
    config.promptTemplateInputConfigs = Object.entries(inputs).map(
      ([referenceName, value]) => {
        const inputConfig: Record<string, unknown> = { referenceName };

        if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) {
          const refExpr = value.slice(1, -1);
          const dotIdx = refExpr.indexOf(".");
          const columnName = dotIdx >= 0 ? refExpr.slice(0, dotIdx) : refExpr;
          const fieldName = dotIdx >= 0 ? refExpr.slice(dotIdx + 1) : undefined;
          inputConfig.referenceAttribute = buildColumnRef(columnName, ctx, fieldName);
        } else if (value !== undefined && value !== null) {
          // Static value — pass through as definition
          inputConfig.definition = String(value);
        }

        return inputConfig;
      },
    );
  }

  return config;
}

// ---------------------------------------------------------------------------
// InvocableAction
// ---------------------------------------------------------------------------

function buildInvocableActionConfig(col: ColumnSpec, ctx: ExpansionContext): Record<string, unknown> {
  const action = col.action as Record<string, unknown>;

  const config: Record<string, unknown> = {
    actionInfo: {
      actionName: action.name as string,
      actionType: action.type as string,
    },
  };

  // Build payload with placeholder rewriting
  if (col.payload) {
    const payloadObj = col.payload as Record<string, unknown>;
    const payloadStr = JSON.stringify(payloadObj);
    const { rewritten, referenceAttributes } = rewritePlaceholders(payloadStr, ctx);
    config.inputPayload = rewritten;

    if (referenceAttributes.length > 0) {
      config.referenceAttributes = referenceAttributes;
    }
  }

  return config;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

function buildActionConfig(col: ColumnSpec, ctx: ExpansionContext): Record<string, unknown> {
  const config: Record<string, unknown> = {
    actionName: col.actionName as string,
  };

  if (col.inputs) {
    const inputs = col.inputs as Record<string, unknown>;
    const fieldUpdateConfigs: Array<Record<string, unknown>> = [];

    for (const [fieldName, value] of Object.entries(inputs)) {
      if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) {
        const colName = value.slice(1, -1);
        const entry = ctx.columnMap.get(colName);
        if (entry) {
          fieldUpdateConfigs.push({ fieldName, columnId: entry.id });
          continue;
        }
      }
      fieldUpdateConfigs.push({ fieldName, value });
    }

    if (fieldUpdateConfigs.length > 0) {
      config.inputParams = { fieldUpdateConfigs };
    }
  }

  return config;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function buildTextConfig(col: ColumnSpec): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  if (col.documentId) {
    config.documentId = col.documentId as string;
  }
  if (col.documentColumnIndex !== undefined) {
    config.documentColumnIndex = col.documentColumnIndex as number;
  }
  if (col.includeHeaders !== undefined) {
    config.includeHeaders = col.includeHeaders as boolean;
  }

  return config;
}
