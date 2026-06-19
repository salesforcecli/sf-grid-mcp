/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

/**
 * Zod schemas for Grid Connect column configuration.
 * Derived from the Java model classes in the Salesforce Core codebase.
 */
import { z } from "zod";

// =============================================================================
// Column Type Enum
// =============================================================================

export const ColumnTypeEnum = z.enum([
  "AI",
  "Agent",
  "AgentTest",
  "Formula",
  "Object",
  "PromptTemplate",
  "Action",
  "InvocableAction",
  "Reference",
  "Text",
  "Evaluation",
  "DataModelObject",
]).describe("The column type");

// =============================================================================
// Shared / Reusable Schemas
// =============================================================================

/** ModelConfig: LLM model selection (modelId + modelName) */
export const ModelConfigSchema = z.object({
  modelId: z.string().describe("Model identifier, e.g. sfdc_ai__DefaultGPT4Omni"),
  modelName: z.string().describe("Model display name"),
}).describe("LLM model configuration");

/** ReferenceAttribute: pointer to another column's data */
export const ReferenceAttributeSchema = z.object({
  columnId: z.string().describe("ID of the referenced column"),
  columnName: z.string().describe("Display name of the referenced column"),
  columnType: ColumnTypeEnum.optional().describe("Type of the referenced column"),
  fieldName: z.string().optional().describe("Specific field within the referenced column"),
  isRequired: z.boolean().optional().describe("Whether this reference is required"),
}).describe("Reference to another column");

/** ContextVariable: agent session variable with either a static value or a column reference */
export const ContextVariableSchema = z.object({
  variableName: z.string().describe("Name of the context variable"),
  type: z.string().optional().describe("Variable type, e.g. Text, Number"),
  value: z.any().optional().describe("Static value (mutually exclusive with reference)"),
  reference: ReferenceAttributeSchema.optional().describe("Column reference (mutually exclusive with value)"),
}).describe("Agent context variable");

/** ColumnQueryResponseFormat: how query results map to rows */
export const ColumnQueryResponseFormatSchema = z.object({
  type: z.enum(["EACH_ROW", "WHOLE_COLUMN"]).describe("EACH_ROW processes existing rows; WHOLE_COLUMN imports new data"),
  splitByType: z.enum(["OBJECT_PER_ROW", "DELIMITER"]).optional().describe("How to split WHOLE_COLUMN results into rows"),
  delimiter: z.string().optional().describe("Delimiter string when splitByType is DELIMITER"),
}).describe("Query response format");

/** SelectableOption: option for single-select AI response format */
export const SelectableOptionSchema = z.object({
  identifier: z.string().optional().describe("Unique identifier for the option"),
  color: z.string().optional().describe("Display color"),
  label: z.string().describe("Display label"),
}).describe("Selectable option for single-select responses");

/** AIColumnResponseFormat: AI column output format */
export const AIColumnResponseFormatSchema = z.object({
  type: z.enum(["PLAIN_TEXT", "SINGLE_SELECT"]).describe("Response format type"),
  outputExample: z.string().optional().describe("Example output to guide the model"),
  options: z.array(SelectableOptionSchema).optional().describe("Options for SINGLE_SELECT type"),
}).describe("AI column response format");

/** FieldConfig: field selection for Object/DataModelObject columns */
export const FieldConfigSchema = z.object({
  name: z.string().describe("API name of the field"),
  type: z.string().describe("Data type of the field in UPPERCASE (e.g., ID, STRING, PICKLIST, CURRENCY, PHONE, URL, TEXTAREA, INTEGER, DOUBLE, DATE, DATETIME, BOOLEAN, REFERENCE, etc.). Required for Object columns. Use get_sobject_fields_display to get correct types."),
  compoundFieldName: z.string().optional().describe("Parent compound field name if applicable"),
}).describe("Field configuration");

/** Canonical filter operator enum — matches Core's JSON schema. */
export const FILTER_OPERATORS = [
  "IN", "NOT_IN", "EQUAL_TO", "NOT_EQUAL_TO",
  "CONTAINS", "STARTS_WITH", "ENDS_WITH",
  "IS_NULL", "IS_NOT_NULL",
  "LESS_THAN", "LESS_THAN_OR_EQUAL_TO",
  "GREATER_THAN", "GREATER_THAN_OR_EQUAL_TO",
] as const;

/** FilterCondition: filter for Object/DataModelObject queries */
export const FilterConditionSchema = z.object({
  field: z.string().describe("Field API name to filter on"),
  operator: z.enum(FILTER_OPERATORS).describe("Filter operator (uppercase snake — matches Core schema)"),
  values: z.array(z.any()).optional().describe("Filter values"),
}).describe("Filter condition");

/** ObjectColumnAdvancedMode: raw SOQL/DCSQL mode */
export const ObjectColumnAdvancedModeSchema = z.object({
  type: z.enum(["SOQL", "DCSQL"]).describe("Query language type"),
  inputs: z.record(z.string(), z.any()).optional().describe("Query input parameters"),
  referenceAttributes: z.array(ReferenceAttributeSchema).optional().describe("Column references used in the query"),
}).describe("Advanced query mode for Object/DataModelObject columns");

/** PromptTemplateInputConfig: maps prompt template inputs to columns */
export const PromptTemplateInputConfigSchema = z.object({
  referenceName: z.string().describe("Reference name from the prompt template input definition"),
  definition: z.string().optional().describe("Definition from the prompt template input"),
  referenceAttribute: ReferenceAttributeSchema.optional().describe("Column reference for this input"),
}).describe("Prompt template input mapping");

/** FieldUpdateConfig: field update for Action columns */
export const FieldUpdateConfigSchema = z.object({
  fieldName: z.string().optional().describe("API name of the field to update"),
  value: z.any().optional().describe("Value to set"),
  columnId: z.string().optional().describe("Source column ID"),
}).describe("Field update configuration");

/** ActionInputParams: input parameters for Action columns */
export const ActionInputParamsSchema = z.object({
  sourceColumnId: z.string().optional().describe("Source column providing record IDs"),
  objectApiName: z.string().optional().describe("SObject API name to act on"),
  fieldUpdateConfigs: z.array(FieldUpdateConfigSchema).optional().describe("Field update configurations"),
}).describe("Action column input parameters");

/** InvocableActionInfo: identifies the invocable action */
export const InvocableActionInfoSchema = z.object({
  actionName: z.string().optional().describe("API name of the invocable action"),
  actionType: z.string().optional().describe("Type of invocable action"),
}).describe("Invocable action identifier");

/** CustomEvaluation: custom evaluation configuration */
export const CustomEvaluationSchema = z.object({
  type: z.string().optional().describe("Custom evaluation type"),
  expression: z.string().optional().describe("Evaluation expression"),
  modelConfig: ModelConfigSchema.optional().describe("LLM model for custom LLM evaluation"),
  instruction: z.string().optional().describe("Instruction for custom LLM evaluation"),
  referenceAttributes: z.array(ReferenceAttributeSchema).optional(),
}).describe("Custom evaluation configuration");

// =============================================================================
// Base column config fields (from ColumnConfig.java)
// =============================================================================

const BaseColumnConfigFields = {
  numberOfRows: z.number().optional().describe("Number of rows to return"),
  queryResponseFormat: ColumnQueryResponseFormatSchema.optional().describe("How results map to rows"),
  autoUpdate: z.boolean().optional().describe("Whether the column auto-updates when dependencies change"),
  runIfExpression: z.string().optional().describe("SEL expression evaluated per row to gate execution"),
  runIfReferenceAttributes: z.array(ReferenceAttributeSchema).optional().describe("References used in runIfExpression"),
};

// =============================================================================
// Per-Column-Type Inner Config Schemas (the nested config.config object)
// =============================================================================

/** AI column inner config */
export const AIColumnInnerConfigSchema = z.object({
  mode: z.string().optional().describe("AI mode, typically 'llm'"),
  modelConfig: ModelConfigSchema.describe("LLM model to use"),
  instruction: z.string().describe("Prompt instruction. Use {$N} to reference columns"),
  referenceAttributes: z.array(ReferenceAttributeSchema).optional().describe("Columns referenced in the instruction via {$N}"),
  responseFormat: AIColumnResponseFormatSchema.optional().describe("Output format"),
  autoUpdate: z.boolean().optional(),
  useWebSearch: z.boolean().optional().describe("Enable web search grounding"),
  featureId: z.string().optional(),
}).describe("AI column inner configuration");

/** Agent column inner config */
export const AgentColumnInnerConfigSchema = z.object({
  agentId: z.string().describe("ID of the agent to invoke"),
  agentVersion: z.string().optional().describe("Agent version"),
  utterance: z.string().describe("Utterance to send. Use {$N} to reference columns"),
  utteranceReferences: z.array(ReferenceAttributeSchema).optional().describe("Columns referenced in the utterance via {$N}"),
  contextVariables: z.array(ContextVariableSchema).optional().describe("Session context variables"),
  initialState: ReferenceAttributeSchema.optional().describe("Column providing initial conversation state"),
  conversationHistory: ReferenceAttributeSchema.optional().describe("Column providing conversation history"),
  autoUpdate: z.boolean().optional(),
}).describe("Agent column inner configuration");

/** AgentTest column inner config */
export const AgentTestColumnInnerConfigSchema = z.object({
  agentId: z.string().describe("ID of the agent to test"),
  agentVersion: z.string().optional().describe("Agent version"),
  inputUtterance: ReferenceAttributeSchema.describe("Reference to column containing test utterances"),
  contextVariables: z.array(ContextVariableSchema).optional().describe("Session context variables"),
  isDraft: z.boolean().optional().describe("Whether to test the draft version of the agent"),
  enableSimulationMode: z.boolean().optional().describe("Enable simulation mode for testing"),
  initialState: ReferenceAttributeSchema.optional().describe("Column providing initial conversation state"),
  conversationHistory: ReferenceAttributeSchema.optional().describe("Column providing conversation history"),
  autoUpdate: z.boolean().optional(),
  featureId: z.string().optional(),
}).describe("Agent test column inner configuration");

/** Object column inner config */
// Object columns can be defined two ways:
// 1. Field-mode: objectApiName + fields (+ optional filters)
// 2. SOQL-mode: advancedMode (raw SOQL string in inputs.queryString)
// At least one mode must be present. Both objectApiName and fields are
// optional at the schema level so SOQL-mode validates; the apply_grid
// expander treats `soql:` as the canonical SOQL-mode shorthand.
export const ObjectColumnInnerConfigSchema = z.object({
  objectApiName: z.string().optional().describe("SObject API name, e.g. Account, Contact (required for field-mode; omit when using advancedMode/soql)"),
  fields: z.array(FieldConfigSchema).optional().describe("Fields to retrieve (required for field-mode; omit when using advancedMode/soql)"),
  filters: z.array(FilterConditionSchema).optional().describe("Filter conditions for the query"),
  advancedMode: ObjectColumnAdvancedModeSchema.optional().describe("Raw SOQL mode"),
  autoUpdate: z.boolean().optional(),
}).describe("Object column inner configuration");

/** Formula column inner config */
export const FormulaColumnInnerConfigSchema = z.object({
  formula: z.string().describe("Formula expression"),
  returnType: z.string().optional().describe("Expected return type"),
  referenceAttributes: z.array(ReferenceAttributeSchema).optional().describe("Columns referenced in the formula"),
  autoUpdate: z.boolean().optional(),
}).describe("Formula column inner configuration");

/** Evaluation column inner config */
export const EvaluationColumnInnerConfigSchema = z.object({
  evaluationType: z.string().optional().describe("OOTB evaluation type"),
  inputColumnReference: ReferenceAttributeSchema.describe("Column to evaluate"),
  referenceColumnReference: ReferenceAttributeSchema.optional().describe("Reference/ground-truth column"),
  autoEvaluate: z.boolean().optional().describe("Auto-evaluate when input changes"),
  expressionFormula: z.string().optional().describe("Expression formula with {json.path} tokens"),
  expressionReturnType: z.string().optional().describe("Expected return type for expression"),
  customEvaluation: CustomEvaluationSchema.optional().describe("Custom evaluation configuration"),
  autoUpdate: z.boolean().optional(),
  featureId: z.string().optional(),
}).describe("Evaluation column inner configuration");

/** PromptTemplate column inner config */
export const PromptTemplateColumnInnerConfigSchema = z.object({
  promptTemplateDevName: z.string().describe("Developer name of the prompt template"),
  promptTemplateVersionId: z.string().optional().describe("Specific version ID"),
  promptTemplateType: z.string().optional().describe("Prompt template type"),
  modelConfig: ModelConfigSchema.describe("LLM model to use"),
  promptTemplateInputConfigs: z.array(PromptTemplateInputConfigSchema).optional().describe("Input mappings"),
  autoUpdate: z.boolean().optional(),
  featureId: z.string().optional(),
}).describe("Prompt template column inner configuration");

/** InvocableAction column inner config */
export const InvocableActionColumnInnerConfigSchema = z.object({
  actionInfo: InvocableActionInfoSchema.describe("Invocable action identifier"),
  inputPayload: z.string().optional().describe("JSON input payload template. Use {$N} for column references"),
  referenceAttributes: z.array(ReferenceAttributeSchema).optional().describe("Columns referenced in inputPayload"),
  autoUpdate: z.boolean().optional(),
}).describe("Invocable action column inner configuration");

/** Action column inner config */
export const ActionColumnInnerConfigSchema = z.object({
  actionName: z.string().describe("Action name, e.g. 'create', 'update'"),
  inputParams: ActionInputParamsSchema.optional().describe("Action input parameters"),
  autoUpdate: z.boolean().optional(),
}).describe("Action column inner configuration");

/** Reference column inner config */
export const ReferenceColumnInnerConfigSchema = z.object({
  referenceColumnId: z.string().describe("ID of the column to extract a field from"),
  referenceField: z.string().describe("JSON field/path to extract"),
  autoUpdate: z.boolean().optional(),
}).describe("Reference column inner configuration");

/** Text column inner config */
export const TextColumnInnerConfigSchema = z.object({
  documentId: z.string().optional().describe("Document/file ID for CSV import"),
  documentColumnIndex: z.number().optional().describe("Column index in the CSV document"),
  includeHeaders: z.boolean().optional().describe("Whether to include CSV headers"),
  autoUpdate: z.boolean().optional(),
}).describe("Text column inner configuration");

/** DataModelObject column inner config */
// DMO columns mirror Object columns: field-mode (dataModelObjectApiName +
// fields) or DCSQL-mode (advancedMode). `fields` is optional at the schema
// level so DCSQL-mode validates.
export const DataModelObjectColumnInnerConfigSchema = z.object({
  dataModelObjectApiName: z.string().describe("API name of the Data Model Object"),
  dataspaceName: z.string().describe("Data Space the DMO belongs to"),
  fields: z.array(FieldConfigSchema).optional().describe("Fields to retrieve (required for field-mode; omit when using advancedMode/dcsql)"),
  filters: z.array(FilterConditionSchema).optional().describe("Filter conditions"),
  advancedMode: ObjectColumnAdvancedModeSchema.optional().describe("Raw DCSQL mode"),
  autoUpdate: z.boolean().optional(),
}).describe("Data Model Object column inner configuration");

// =============================================================================
// Wrapper Schemas (outer config with type discriminator + nested inner config)
// =============================================================================

const AIColumnConfigSchema = z.object({
  type: z.literal("AI"),
  ...BaseColumnConfigFields,
  config: AIColumnInnerConfigSchema,
});

const AgentColumnConfigSchema = z.object({
  type: z.literal("Agent"),
  ...BaseColumnConfigFields,
  config: AgentColumnInnerConfigSchema,
});

const AgentTestColumnConfigSchema = z.object({
  type: z.literal("AgentTest"),
  ...BaseColumnConfigFields,
  config: AgentTestColumnInnerConfigSchema,
});

const ObjectColumnConfigSchema = z.object({
  type: z.literal("Object"),
  ...BaseColumnConfigFields,
  config: ObjectColumnInnerConfigSchema,
});

const FormulaColumnConfigSchema = z.object({
  type: z.literal("Formula"),
  ...BaseColumnConfigFields,
  config: FormulaColumnInnerConfigSchema,
});

const EvaluationColumnConfigSchema = z.object({
  type: z.literal("Evaluation"),
  ...BaseColumnConfigFields,
  config: EvaluationColumnInnerConfigSchema,
});

const PromptTemplateColumnConfigSchema = z.object({
  type: z.literal("PromptTemplate"),
  ...BaseColumnConfigFields,
  config: PromptTemplateColumnInnerConfigSchema,
});

const InvocableActionColumnConfigSchema = z.object({
  type: z.literal("InvocableAction"),
  ...BaseColumnConfigFields,
  config: InvocableActionColumnInnerConfigSchema,
});

const ActionColumnConfigSchema = z.object({
  type: z.literal("Action"),
  ...BaseColumnConfigFields,
  config: ActionColumnInnerConfigSchema,
});

const ReferenceColumnConfigSchema = z.object({
  type: z.literal("Reference"),
  ...BaseColumnConfigFields,
  config: ReferenceColumnInnerConfigSchema,
});

const TextColumnConfigSchema = z.object({
  type: z.literal("Text"),
  ...BaseColumnConfigFields,
  config: TextColumnInnerConfigSchema.optional(),
});

const DataModelObjectColumnConfigSchema = z.object({
  type: z.literal("DataModelObject"),
  ...BaseColumnConfigFields,
  config: DataModelObjectColumnInnerConfigSchema,
});

/** Union of all outer column config schemas, discriminated by `type` */
export const ColumnConfigUnionSchema = z.discriminatedUnion("type", [
  AIColumnConfigSchema,
  AgentColumnConfigSchema,
  AgentTestColumnConfigSchema,
  ObjectColumnConfigSchema,
  FormulaColumnConfigSchema,
  EvaluationColumnConfigSchema,
  PromptTemplateColumnConfigSchema,
  InvocableActionColumnConfigSchema,
  ActionColumnConfigSchema,
  ReferenceColumnConfigSchema,
  TextColumnConfigSchema,
  DataModelObjectColumnConfigSchema,
]);

// =============================================================================
// Top-Level Column Input Schema (what the MCP client sends as the config JSON)
// =============================================================================

/**
 * Full column input schema. The `config` field contains the outer wrapper
 * (type + queryResponseFormat + autoUpdate + nested inner config).
 */
export const ColumnInputSchema = z.object({
  name: z.string().describe("Column display name"),
  type: ColumnTypeEnum.describe("Column type"),
  precedingColumnId: z.string().optional().describe("Insert after this column ID"),
  config: ColumnConfigUnionSchema.describe("Full column configuration with nested type-specific config"),
});

export type ColumnInput = z.infer<typeof ColumnInputSchema>;
