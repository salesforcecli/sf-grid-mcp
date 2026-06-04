/**
 * MCP resource templates for metadata:
 *   - grid://agents          (TTL 5min)
 *   - grid://models          (TTL 30min)
 *   - grid://schema/{columnType}  (static / infinite TTL)
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GridClient } from "../client.js";
import { ResourceCache } from "../lib/resource-cache.js";
import { MODEL_SHORTHANDS } from "../lib/model-map.js";

const AGENTS_TTL_MS = 5 * 60_000;
const MODELS_TTL_MS = 30 * 60_000;

// ---------------------------------------------------------------------------
// Column type schema reference (derived from Zod schemas in schemas.ts)
// ---------------------------------------------------------------------------

const COLUMN_TYPE_SCHEMAS: Record<string, object> = {
  AI: {
    requiredFields: ["instruction", "modelConfig"],
    optionalFields: ["mode", "referenceAttributes", "responseFormat", "autoUpdate", "useWebSearch"],
    exampleConfig: {
      type: "AI",
      autoUpdate: true,
      queryResponseFormat: { type: "EACH_ROW" },
      config: {
        mode: "llm",
        autoUpdate: true,
        modelConfig: { modelId: "sfdc_ai__DefaultGPT4Omni", modelName: "gpt-4-omni" },
        instruction: "Summarize {$1}",
        referenceAttributes: [{ columnId: "col-id", columnName: "Source", columnType: "TEXT" }],
        responseFormat: { type: "PLAIN_TEXT" },
      },
    },
    commonPitfalls: [
      "instruction must use {$N} placeholders (not column names directly) with matching referenceAttributes",
      "modelConfig requires both modelId and modelName; use model shorthands via the DSL for convenience",
      "responseFormat.type must be PLAIN_TEXT or SINGLE_SELECT",
    ],
  },
  Agent: {
    requiredFields: ["agentId", "utterance"],
    optionalFields: ["agentVersion", "utteranceReferences", "contextVariables", "conversationHistory", "initialState", "autoUpdate"],
    exampleConfig: {
      type: "Agent",
      autoUpdate: true,
      queryResponseFormat: { type: "EACH_ROW" },
      config: {
        autoUpdate: true,
        agentId: "0XxRM000000xxxxx",
        utterance: "Help with {$1}",
        utteranceReferences: [{ columnId: "col-id", columnName: "Topic", columnType: "TEXT" }],
        contextVariables: [],
      },
    },
    commonPitfalls: [
      "utterance placeholders {$N} must have matching utteranceReferences array",
      "contextVariables can use static values OR column references, not both on the same variable",
    ],
  },
  AgentTest: {
    requiredFields: ["agentId", "inputUtterance"],
    optionalFields: ["agentVersion", "contextVariables", "isDraft", "enableSimulationMode", "conversationHistory", "initialState", "autoUpdate"],
    exampleConfig: {
      type: "AgentTest",
      autoUpdate: true,
      queryResponseFormat: { type: "EACH_ROW" },
      config: {
        autoUpdate: true,
        agentId: "0XxRM000000xxxxx",
        inputUtterance: { columnId: "col-id", columnName: "Utterances", columnType: "TEXT" },
        contextVariables: [],
        isDraft: false,
        enableSimulationMode: false,
      },
    },
    commonPitfalls: [
      "inputUtterance is a column reference, not a string",
      "isDraft=true tests the unpublished draft version of the agent",
    ],
  },
  Object: {
    requiredFields: ["objectApiName", "fields"],
    optionalFields: ["filters", "advancedMode", "autoUpdate"],
    exampleConfig: {
      type: "Object",
      autoUpdate: true,
      queryResponseFormat: { type: "WHOLE_COLUMN", splitByType: "OBJECT_PER_ROW" },
      config: {
        autoUpdate: true,
        objectApiName: "Account",
        fields: [{ name: "Name", type: "string" }, { name: "Industry", type: "string" }],
        filters: [{ field: "Industry", operator: "EQUAL_TO", values: ["Technology"] }],
      },
    },
    commonPitfalls: [
      "queryResponseFormat should usually be WHOLE_COLUMN with OBJECT_PER_ROW for Object columns",
      "advancedMode.type must be 'SOQL' for raw queries",
    ],
  },
  DataModelObject: {
    requiredFields: ["dataModelObjectApiName", "dataspaceName", "fields"],
    optionalFields: ["filters", "advancedMode", "autoUpdate"],
    exampleConfig: {
      type: "DataModelObject",
      autoUpdate: true,
      queryResponseFormat: { type: "WHOLE_COLUMN", splitByType: "OBJECT_PER_ROW" },
      config: {
        autoUpdate: true,
        dataModelObjectApiName: "MyDMO__dlm",
        dataspaceName: "default",
        fields: [{ name: "Field1__c", type: "string" }],
      },
    },
    commonPitfalls: [
      "advancedMode.type must be 'DCSQL' (not SOQL) for Data Model Objects",
      "dataspaceName is required",
    ],
  },
  Evaluation: {
    requiredFields: ["inputColumnReference"],
    optionalFields: ["evaluationType", "referenceColumnReference", "autoEvaluate", "expressionFormula", "expressionReturnType", "customEvaluation", "autoUpdate"],
    exampleConfig: {
      type: "Evaluation",
      autoUpdate: true,
      queryResponseFormat: { type: "EACH_ROW" },
      config: {
        autoUpdate: true,
        evaluationType: "COHERENCE",
        inputColumnReference: { columnId: "col-id", columnName: "Agent Output", columnType: "AGENT_TEST" },
        autoEvaluate: true,
      },
    },
    commonPitfalls: [
      "Reference-based evaluations (RESPONSE_MATCH, TOPIC_ASSERTION, ACTION_ASSERTION, BOT_RESPONSE_RATING) require referenceColumnReference",
      "EXPRESSION_EVAL requires expressionFormula and expressionReturnType",
      "CUSTOM_LLM_EVALUATION requires customEvaluation with modelConfig and instruction",
    ],
  },
  Formula: {
    requiredFields: ["formula"],
    optionalFields: ["returnType", "referenceAttributes", "autoUpdate"],
    exampleConfig: {
      type: "Formula",
      autoUpdate: true,
      queryResponseFormat: { type: "EACH_ROW" },
      config: {
        autoUpdate: true,
        formula: "LEN({$1})",
        referenceAttributes: [{ columnId: "col-id", columnName: "Text", columnType: "TEXT" }],
      },
    },
    commonPitfalls: [
      "Formula uses {$N} placeholders just like AI instructions",
      "referenceAttributes must match the {$N} references in the formula",
    ],
  },
  PromptTemplate: {
    requiredFields: ["promptTemplateDevName", "modelConfig"],
    optionalFields: ["promptTemplateVersionId", "promptTemplateType", "promptTemplateInputConfigs", "autoUpdate"],
    exampleConfig: {
      type: "PromptTemplate",
      autoUpdate: true,
      queryResponseFormat: { type: "EACH_ROW" },
      config: {
        autoUpdate: true,
        promptTemplateDevName: "My_Template",
        modelConfig: { modelId: "sfdc_ai__DefaultGPT4Omni", modelName: "gpt-4-omni" },
        promptTemplateInputConfigs: [
          { referenceName: "input1", referenceAttribute: { columnId: "col-id", columnName: "Source", columnType: "TEXT" } },
        ],
      },
    },
    commonPitfalls: [
      "promptTemplateDevName is the developer name, not the display name",
      "promptTemplateInputConfigs map template inputs to column references",
    ],
  },
  InvocableAction: {
    requiredFields: ["actionInfo"],
    optionalFields: ["inputPayload", "referenceAttributes", "autoUpdate"],
    exampleConfig: {
      type: "InvocableAction",
      autoUpdate: true,
      queryResponseFormat: { type: "EACH_ROW" },
      config: {
        autoUpdate: true,
        actionInfo: { actionName: "myFlow", actionType: "FLOW" },
        inputPayload: "{\"input\": \"{$1}\"}",
        referenceAttributes: [{ columnId: "col-id", columnName: "Data", columnType: "TEXT" }],
      },
    },
    commonPitfalls: [
      "inputPayload is a JSON string with {$N} placeholders, not a JSON object",
      "actionInfo requires both actionName and actionType",
    ],
  },
  Action: {
    requiredFields: ["actionName"],
    optionalFields: ["inputParams", "autoUpdate"],
    exampleConfig: {
      type: "Action",
      autoUpdate: true,
      queryResponseFormat: { type: "EACH_ROW" },
      config: {
        autoUpdate: true,
        actionName: "create",
        inputParams: {
          objectApiName: "Case",
          fieldUpdateConfigs: [{ fieldName: "Subject", columnId: "col-id" }],
        },
      },
    },
    commonPitfalls: [
      "actionName is typically 'create' or 'update'",
      "fieldUpdateConfigs can reference columns by columnId or set static values",
    ],
  },
  Reference: {
    requiredFields: ["referenceColumnId", "referenceField"],
    optionalFields: ["autoUpdate"],
    exampleConfig: {
      type: "Reference",
      autoUpdate: true,
      queryResponseFormat: { type: "EACH_ROW" },
      config: {
        autoUpdate: true,
        referenceColumnId: "col-id",
        referenceField: "botResponse",
      },
    },
    commonPitfalls: [
      "referenceField is a JSON path/key within the referenced column's output",
      "Used to extract specific fields from complex column outputs like AgentTest",
    ],
  },
  Text: {
    requiredFields: [],
    optionalFields: ["documentId", "documentColumnIndex", "includeHeaders", "autoUpdate"],
    exampleConfig: {
      type: "Text",
      autoUpdate: true,
      config: { autoUpdate: true },
    },
    commonPitfalls: [
      "Text columns with no config are used for manual data entry / paste",
      "documentId is only needed when importing from a CSV file",
    ],
  },
};

export function registerMetadataResources(server: McpServer, client: GridClient, cache: ResourceCache): void {
  // --- grid://agents ---
  server.resource(
    "agents",
    "grid://agents",
    { description: "List of available agents with IDs, names, and active versions", mimeType: "application/json" },
    async (uri) => {
      const cacheKey = "agents";
      const cached = cache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const agents = await client.get("/agents");
      const agentList = (Array.isArray(agents) ? agents : agents.records || agents.agents || []).map((a: any) => ({
        id: a.id,
        name: a.name ?? a.masterLabel ?? a.developerName,
        developerName: a.developerName,
        activeVersion: a.activeVersion ?? a.activeVersionId,
      }));

      const result = {
        contents: [{
          uri: uri.href,
          mimeType: "application/json" as const,
          text: JSON.stringify({ agents: agentList }, null, 2),
        }],
      };

      cache.set(cacheKey, result, AGENTS_TTL_MS);
      return result;
    },
  );

  // --- grid://models ---
  server.resource(
    "models",
    "grid://models",
    { description: "Available LLM models with full IDs and shorthand aliases", mimeType: "application/json" },
    async (uri) => {
      const cacheKey = "models";
      const cached = cache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const modelsResponse = await client.get("/llm-models");
      const models = (Array.isArray(modelsResponse) ? modelsResponse : modelsResponse.models || modelsResponse.records || []).map((m: any) => {
        const fullId = m.id ?? m.modelId;
        const shorthand = Object.entries(MODEL_SHORTHANDS).find(([_, v]) => v === fullId)?.[0];
        return {
          modelId: fullId,
          modelName: m.name ?? m.modelName ?? m.label,
          shorthand: shorthand ?? null,
        };
      });

      // Also include shorthands that may not be in the API response yet
      const apiIds = new Set(models.map((m: any) => m.modelId));
      const extraShorthands = Object.entries(MODEL_SHORTHANDS)
        .filter(([_, fullId]) => !apiIds.has(fullId))
        .map(([shorthand, fullId]) => ({
          modelId: fullId,
          modelName: shorthand,
          shorthand,
          note: "Known shorthand alias (not returned by /llm-models)",
        }));

      const result = {
        contents: [{
          uri: uri.href,
          mimeType: "application/json" as const,
          text: JSON.stringify({
            models: [...models, ...extraShorthands],
            shorthandMap: MODEL_SHORTHANDS,
          }, null, 2),
        }],
      };

      cache.set(cacheKey, result, MODELS_TTL_MS);
      return result;
    },
  );

  // --- grid://schema/{columnType} ---
  server.resource(
    "column-type-schema",
    new ResourceTemplate("grid://schema/{columnType}", { list: undefined }),
    { description: "Human-readable schema reference for a specific column type, including required/optional fields, example config, and common pitfalls", mimeType: "application/json" },
    async (uri, variables) => {
      const columnType = String(variables.columnType);
      const schema = COLUMN_TYPE_SCHEMAS[columnType];
      if (!schema) {
        const validTypes = Object.keys(COLUMN_TYPE_SCHEMAS).join(", ");
        return {
          contents: [{
            uri: uri.href,
            mimeType: "application/json" as const,
            text: JSON.stringify({
              error: `Unknown column type "${columnType}". Valid types: ${validTypes}`,
            }, null, 2),
          }],
        };
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json" as const,
          text: JSON.stringify({ columnType, ...schema }, null, 2),
        }],
      };
    },
  );
}
