/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GridClient } from "../client.js";
import { z } from "zod";
import { requireParam, ValidationError } from "../lib/validation.js";
import { errorResult, errorTextResult, jsonResult } from "../lib/result-helpers.js";

// Accept array/object directly OR a JSON string (back-compat).
function parseIfString<T>(value: T | string, paramName: string): T {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as T;
  } catch (e) {
    throw new ValidationError(`Invalid JSON in ${paramName} parameter: ${(e as Error).message}`);
  }
}

export function registerDiscoverTool(server: McpServer, client: GridClient): void {
  server.tool(
    "discover",
    "Discover available metadata: column_types, llm_models, supported_types, evaluation_types, formula_functions, formula_operators, invocable_actions, invocable_action_details, prompt_templates, prompt_template_details, list_views, list_view_soql, sobjects, sobject_fields_display, sobject_fields_filter, sobject_fields_record_update, dataspaces, data_model_objects, data_model_object_fields, agents, agent_variables, generate_soql, generate_test_columns",
    {
      what: z.enum([
        "column_types", "llm_models", "supported_types", "evaluation_types",
        "formula_functions", "formula_operators", "invocable_actions", "invocable_action_details",
        "prompt_templates", "prompt_template_details",
        "list_views", "list_view_soql",
        "sobjects", "sobject_fields_display", "sobject_fields_filter", "sobject_fields_record_update",
        "dataspaces", "data_model_objects", "data_model_object_fields",
        "agents", "agent_variables",
        "generate_soql", "generate_test_columns",
      ]),
      // Params needed by specific discovery types
      actionName: z.string().optional().describe("For invocable_action_details"),
      actionType: z.string().optional().describe("For invocable_action_details"),
      actionUrl: z.string().optional().describe("For invocable_action_details (the action's url field from invocable_actions response, e.g. /actions/standard/emailSimple)"),
      promptTemplateDevName: z.string().optional().describe("For prompt_template_details"),
      listViewId: z.string().optional().describe("For list_view_soql"),
      sObjectType: z.string().optional().describe("For list_view_soql"),
      sobjectList: z.union([z.array(z.string()), z.string()]).optional().describe('Array of SObject API names for sobject_fields_display/filter/record_update, e.g. ["Account", "Contact"]. JSON string still accepted for back-compat.'),
      dataspace: z.string().optional().describe("For data_model_objects, data_model_object_fields"),
      dmoName: z.string().optional().describe("For data_model_object_fields"),
      versionId: z.string().optional().describe("Agent version ID for agent_variables"),
      includeDrafts: z.boolean().optional().describe("For agents"),
      text: z.string().optional().describe("Natural language for generate_soql"),
      testData: z.union([z.record(z.string(), z.any()), z.string()]).optional().describe("Config object for generate_test_columns. Generates a test-suite workbook for an Agentforce agent. Required: numberOfTestCases (int), agentId (string from `discover agents`). Optional: testSuiteLabel, testSuiteDevName, testSuiteDescription, agentVersionId, customInstructions, selectedContextVariables (object), metrics (string[]), topicsList (string[]), conversationHistory, customEvaluations (object[]), isDraft (bool), enableSimulationMode (bool), dataSpace, language. Example: {\"numberOfTestCases\":3,\"agentId\":\"...\"}. JSON string still accepted for back-compat."),
    },
    async (params) => {
      const { what } = params;
      try {
        switch (what) {
          // ===============================================================
          // Metadata (from metadata.ts)
          // ===============================================================
          case "column_types": {
            const result = await client.get("/column-types");
            return jsonResult(result);
          }

          case "llm_models": {
            const result = await client.get("/llm-models");
            return jsonResult(result);
          }

          case "supported_types": {
            const result = await client.get("/supported-types");
            return jsonResult(result);
          }

          case "evaluation_types": {
            const result = await client.get("/evaluation-types");
            return jsonResult(result);
          }

          case "formula_functions": {
            const result = await client.get("/formula-functions");
            return jsonResult(result);
          }

          case "formula_operators": {
            const result = await client.get("/formula-operators");
            return jsonResult(result);
          }

          case "invocable_actions": {
            const result = await client.get("/invocable-actions");
            return jsonResult(result);
          }

          case "invocable_action_details": {
            requireParam(params.actionName, "actionName", "invocable_action_details");
            requireParam(params.actionType, "actionType", "invocable_action_details");
            requireParam(params.actionUrl, "actionUrl", "invocable_action_details (use the 'url' field from invocable_actions response)");
            const path = `/invocable-actions/describe?actionName=${encodeURIComponent(params.actionName)}&actionType=${encodeURIComponent(params.actionType)}&url=${encodeURIComponent(params.actionUrl)}`;
            const result = await client.get(path);
            return jsonResult(result);
          }

          case "prompt_templates": {
            const result = await client.get("/prompt-templates");
            return jsonResult(result);
          }

          case "prompt_template_details": {
            requireParam(params.promptTemplateDevName, "promptTemplateDevName", "prompt_template_details");
            const result = await client.get(`/prompt-templates/${encodeURIComponent(params.promptTemplateDevName)}`);
            return jsonResult(result);
          }

          case "list_views": {
            const result = await client.get("/list-views");
            return jsonResult(result);
          }

          case "list_view_soql": {
            requireParam(params.listViewId, "listViewId", "list_view_soql");
            requireParam(params.sObjectType, "sObjectType", "list_view_soql");
            const result = await client.get(
              `/list-views/${encodeURIComponent(params.listViewId)}/soql?sObjectType=${encodeURIComponent(params.sObjectType)}`
            );
            return jsonResult(result);
          }

          case "generate_soql": {
            requireParam(params.text, "text", "generate_soql");
            const result = await client.post("/generate-soql", { text: params.text });
            return jsonResult(result);
          }

          case "generate_test_columns": {
            requireParam(params.testData, "testData", "generate_test_columns");
            const body = parseIfString(params.testData, "testData");
            const result = await client.post("/worksheets/test-case-generation", body);
            return jsonResult(result);
          }

          // ===============================================================
          // Data (from data.ts)
          // ===============================================================
          case "sobjects": {
            const result = await client.get("/sobjects");
            return jsonResult(result);
          }

          case "sobject_fields_display": {
            requireParam(params.sobjectList, "sobjectList", "sobject_fields_display");
            const parsed = parseIfString(params.sobjectList, "sobjectList");
            const result = await client.post("/sobjects/fields-display", { sobjectList: parsed });
            return jsonResult(result);
          }

          case "sobject_fields_filter": {
            requireParam(params.sobjectList, "sobjectList", "sobject_fields_filter");
            const parsed = parseIfString(params.sobjectList, "sobjectList");
            const result = await client.post("/sobjects/fields-filter", { sobjectList: parsed });
            return jsonResult(result);
          }

          case "sobject_fields_record_update": {
            requireParam(params.sobjectList, "sobjectList", "sobject_fields_record_update");
            const parsed = parseIfString(params.sobjectList, "sobjectList");
            const result = await client.post("/sobjects/fields-record-update", { sobjectList: parsed });
            return jsonResult(result);
          }

          case "dataspaces": {
            const result = await client.get("/dataspaces");
            return jsonResult(result);
          }

          case "data_model_objects": {
            requireParam(params.dataspace, "dataspace", "data_model_objects");
            const result = await client.get(`/dataspaces/${encodeURIComponent(params.dataspace)}/data-model-objects`);
            return jsonResult(result);
          }

          case "data_model_object_fields": {
            requireParam(params.dataspace, "dataspace", "data_model_object_fields");
            requireParam(params.dmoName, "dmoName", "data_model_object_fields");
            const result = await client.get(
              `/dataspaces/${encodeURIComponent(params.dataspace)}/data-model-objects/${encodeURIComponent(params.dmoName)}/fields`
            );
            return jsonResult(result);
          }

          // ===============================================================
          // Agents (from agents.ts)
          // ===============================================================
          case "agents": {
            const path = params.includeDrafts ? "/agents?includeDrafts=true" : "/agents";
            const result = await client.get(path);
            return jsonResult(result);
          }

          case "agent_variables": {
            requireParam(params.versionId, "versionId", "agent_variables");
            const result = await client.get(`/agents/${encodeURIComponent(params.versionId)}/variables`);
            return jsonResult(result);
          }
        }
      } catch (error: unknown) {
        if (error instanceof ValidationError) {
          return errorTextResult(`Error: ${error.message}`);
        }
        return errorResult(error);
      }
    }
  );
}
