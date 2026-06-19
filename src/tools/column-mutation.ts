/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GridClient } from "../client.js";
import { z } from "zod";
import { requireParam, ValidationError } from "../lib/validation.js";
import { configCache } from "../lib/column-config-cache.js";
import { getColumnConfig, resolveColumnRef, getOrFetchColumnConfig } from "../lib/config-helpers.js";
import { resolveModelShorthand } from "../lib/model-map.js";
import { getColumnCells } from "../lib/worksheet-data-helpers.js";
import {
  ContextVariableSchema,
  FILTER_OPERATORS,
  FilterConditionSchema,
  PromptTemplateInputConfigSchema,
} from "../schemas.js";
import {
  errorTextResult,
  errorResult,
  jsonResult,
  resolveInstructionRefs,
  saveOrReprocess,
} from "../lib/column-helpers.js";
import { normalizeFilterValues } from "../lib/filter-helpers.js";

// ---------------------------------------------------------------------------
// Typed mutation sub-handlers (ported from typed-mutations.ts)
// ---------------------------------------------------------------------------

async function handleEditAiPrompt(
  client: GridClient,
  params: Record<string, any>
): Promise<{ content: { type: "text"; text: string }[] }> {
  const { columnId, worksheetId, instruction, model, responseFormat, responseOptions, reprocess: _reprocess } = params;
  const reprocess = _reprocess ?? true;

  const { column, worksheetId: wsId, worksheetColumns } = await getColumnConfig(client, columnId, worksheetId);
  const outerConfig = await getOrFetchColumnConfig(client, columnId, wsId);
  if (!outerConfig) {
    return errorTextResult(`Error: Could not retrieve config for column ${columnId}. Use column edit with full config JSON instead.`);
  }
  const innerConfig = { ...outerConfig.config };

  if (instruction !== undefined) {
    const resolved = resolveInstructionRefs(instruction, worksheetColumns);
    innerConfig.instruction = resolved.instruction;
    innerConfig.referenceAttributes = resolved.referenceAttributes;
  }

  if (model !== undefined) {
    innerConfig.modelConfig = resolveModelShorthand(model);
  }

  if (responseFormat !== undefined) {
    const formatType = responseFormat.toUpperCase() === "SINGLE_SELECT" ? "SINGLE_SELECT" : "PLAIN_TEXT";
    innerConfig.responseFormat = {
      type: formatType,
      options: formatType === "SINGLE_SELECT" && responseOptions
        ? responseOptions.map((o: string) => ({ label: o, identifier: o }))
        : innerConfig.responseFormat?.options ?? [],
    };
  } else if (responseOptions !== undefined && innerConfig.responseFormat?.type === "SINGLE_SELECT") {
    innerConfig.responseFormat = {
      ...innerConfig.responseFormat,
      options: responseOptions.map((o: string) => ({ label: o, identifier: o })),
    };
  }

  const updatedConfig = { ...outerConfig, config: innerConfig };
  const result = await saveOrReprocess(client, wsId, columnId, updatedConfig, reprocess, column?.name);
  return jsonResult({ columnId, updated: true, reprocessing: reprocess, result });
}

async function handleEditAgentConfig(
  client: GridClient,
  params: Record<string, any>
): Promise<{ content: { type: "text"; text: string }[] }> {
  const { columnId, worksheetId, agent, agentVersion, utteranceColumn, contextVariables, isDraft, reprocess: _reprocess } = params;
  const reprocess = _reprocess ?? true;

  const { column, worksheetId: wsId, worksheetColumns } = await getColumnConfig(client, columnId, worksheetId);
  const outerConfig = await getOrFetchColumnConfig(client, columnId, wsId);
  if (!outerConfig) {
    return errorTextResult(`Error: Could not retrieve config for column ${columnId}. Use column edit with full config JSON instead.`);
  }
  const innerConfig = { ...outerConfig.config };
  const colType = outerConfig.type ?? column.type;

  if (agent !== undefined) innerConfig.agentId = agent;
  if (agentVersion !== undefined) innerConfig.agentVersion = agentVersion;
  if (isDraft !== undefined) innerConfig.isDraft = isDraft;

  if (utteranceColumn !== undefined && colType === "Agent") {
    const resolved = resolveInstructionRefs(utteranceColumn, worksheetColumns);
    innerConfig.utterance = resolved.instruction;
    innerConfig.utteranceReferences = resolved.referenceAttributes;
  }

  if (contextVariables !== undefined) {
    let cvArr: any[];
    try {
      cvArr = typeof contextVariables === "string" ? JSON.parse(contextVariables) : contextVariables;
    } catch (e) {
      return errorTextResult(`Error: contextVariables must be a valid JSON array string. ${(e as Error).message}`);
    }
    innerConfig.contextVariables = cvArr.map((cv: any) => {
      const base: any = { variableName: cv.name ?? cv.variableName };
      if (cv.column) {
        const ref = resolveColumnRef(cv.column, worksheetColumns);
        if (ref) {
          base.reference = {
            columnId: ref.columnId,
            columnName: ref.columnName,
            columnType: ref.columnType,
            ...(cv.field ? { fieldName: cv.field } : {}),
          };
        }
      } else if (cv.value !== undefined) {
        base.value = cv.value;
      }
      return base;
    });
  }

  const updatedConfig = { ...outerConfig, config: innerConfig };
  const result = await saveOrReprocess(client, wsId, columnId, updatedConfig, reprocess, column?.name);
  return jsonResult({ columnId, columnType: colType, updated: true, reprocessing: reprocess, result });
}

async function handleAddEvaluation(
  client: GridClient,
  params: Record<string, any>
): Promise<{ content: { type: "text"; text: string }[] }> {
  const { worksheetId, evaluationType, targetColumn, referenceColumn, name, expressionFormula, customEvalTemplate } = params;

  requireParam(worksheetId, "worksheetId", "add_evaluation");
  requireParam(evaluationType, "evaluationType", "add_evaluation");
  requireParam(targetColumn, "targetColumn", "add_evaluation");

  const wsData = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}/data`);
  const columns = wsData.columns || [];

  const REFERENCE_EVALS = new Set([
    "RESPONSE_MATCH", "TOPIC_ASSERTION", "ACTION_ASSERTION",
    "BOT_RESPONSE_RATING", "CUSTOM_LLM_EVALUATION",
  ]);

  const targetRef = resolveColumnRef(targetColumn, columns);
  if (!targetRef) return errorTextResult(`Error: Target column "${targetColumn}" not found in worksheet.`);

  let expectedRef: ReturnType<typeof resolveColumnRef> = null;
  if (REFERENCE_EVALS.has(evaluationType)) {
    if (!referenceColumn) {
      return errorTextResult(`Error: Evaluation type ${evaluationType} requires a referenceColumn parameter.`);
    }
    expectedRef = resolveColumnRef(referenceColumn, columns);
    if (!expectedRef) return errorTextResult(`Error: Reference column "${referenceColumn}" not found in worksheet.`);
  }

  const displayName = name ?? evaluationType.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());

  const innerConfig: any = {
    autoUpdate: true,
    evaluationType,
    inputColumnReference: {
      columnId: targetRef.columnId,
      columnName: targetRef.columnName,
      columnType: targetRef.columnType,
    },
    autoEvaluate: true,
  };

  if (expectedRef) {
    innerConfig.referenceColumnReference = {
      columnId: expectedRef.columnId,
      columnName: expectedRef.columnName,
      columnType: expectedRef.columnType,
    };
  }

  if (evaluationType === "EXPRESSION_EVAL" && expressionFormula) {
    innerConfig.expressionFormula = expressionFormula;
    innerConfig.expressionReturnType = "Boolean";
  }

  if (evaluationType === "CUSTOM_LLM_EVALUATION" && customEvalTemplate) {
    innerConfig.customEvaluation = {
      type: "CUSTOM_LLM_EVALUATION",
      instruction: customEvalTemplate,
    };
  }

  const body = {
    name: displayName,
    type: "Evaluation",
    config: {
      type: "Evaluation",
      queryResponseFormat: { type: "EACH_ROW" },
      autoUpdate: true,
      config: innerConfig,
    },
  };

  const result = await client.post(
    `/worksheets/${encodeURIComponent(worksheetId)}/columns`,
    body
  );

  if (result?.id) {
    configCache.set(result.id, body.config);
  }

  return jsonResult({
    columnId: result.id,
    name: displayName,
    evaluationType,
    targetColumn: targetRef.columnName,
    expectedColumn: expectedRef?.columnName ?? null,
    result,
  });
}

async function handleChangeModel(
  client: GridClient,
  params: Record<string, any>
): Promise<{ content: { type: "text"; text: string }[] }> {
  const { columnId, worksheetId, model, reprocess: _reprocess } = params;
  const reprocess = _reprocess ?? true;

  requireParam(model, "model", "change_model");

  const { column, worksheetId: wsId } = await getColumnConfig(client, columnId, worksheetId);
  const outerConfig = await getOrFetchColumnConfig(client, columnId, wsId);
  if (!outerConfig) {
    return errorTextResult(`Error: Could not retrieve config for column ${columnId}. Use column edit with full config JSON instead.`);
  }
  const colType = outerConfig.type ?? column.type;

  if (colType !== "AI" && colType !== "PromptTemplate") {
    return errorTextResult(`Error: change_model only works on AI or PromptTemplate columns (this column is ${colType}).`);
  }

  const modelConfig = resolveModelShorthand(model);
  const innerConfig = { ...outerConfig.config, modelConfig };
  const updatedConfig = { ...outerConfig, config: innerConfig };

  const previousModel = outerConfig.config?.modelConfig?.modelId ?? "unknown";
  const result = await saveOrReprocess(client, wsId, columnId, updatedConfig, reprocess, column?.name);

  return jsonResult({
    columnId,
    updated: true,
    reprocessing: reprocess,
    previousModel,
    newModel: modelConfig.modelId,
    result,
  });
}

async function handleUpdateFilters(
  client: GridClient,
  params: Record<string, any>
): Promise<{ content: { type: "text"; text: string }[] }> {
  const { columnId, worksheetId, filters: filtersStr, reprocess: _reprocess } = params;
  const reprocess = _reprocess ?? true;

  requireParam(filtersStr, "filters", "update_filters");

  let filters: any[];
  try {
    filters = typeof filtersStr === "string" ? JSON.parse(filtersStr) : filtersStr;
  } catch (e) {
    return errorTextResult(`Error: filters must be a valid JSON array string. ${(e as Error).message}`);
  }

  const { column, worksheetId: wsId } = await getColumnConfig(client, columnId, worksheetId);
  const outerConfig = await getOrFetchColumnConfig(client, columnId, wsId);
  if (!outerConfig) {
    return errorTextResult(`Error: Could not retrieve config for column ${columnId}. Use column edit with full config JSON instead.`);
  }
  const colType = outerConfig.type ?? column.type;

  if (colType !== "Object" && colType !== "DataModelObject") {
    return errorTextResult(`Error: update_filters only works on Object or DataModelObject columns (this column is ${colType}).`);
  }

  const validOps = FILTER_OPERATORS as readonly string[];
  const invalid = filters.find((f: any) => !validOps.includes(f.operator));
  if (invalid) {
    return errorTextResult(
      `Error: invalid filter operator "${invalid.operator}". Valid operators: ${validOps.join(", ")}.`
    );
  }

  const typedFilters = filters.map((f: any) => ({
    field: f.field,
    operator: f.operator,
    values: normalizeFilterValues(f.values),
  }));

  const innerConfig = { ...outerConfig.config, filters: typedFilters };
  const updatedConfig = { ...outerConfig, config: innerConfig };

  const result = await saveOrReprocess(client, wsId, columnId, updatedConfig, reprocess, column?.name);
  return jsonResult({ columnId, updated: true, reprocessing: reprocess, filterCount: filters.length, result });
}

async function handleReprocessTyped(
  client: GridClient,
  params: Record<string, any>
): Promise<{ content: { type: "text"; text: string }[] }> {
  const { columnId, worksheetId, reprocessFilter } = params;
  const filter = reprocessFilter ?? "all";

  if (!columnId && !worksheetId) {
    return errorTextResult("Error: Must provide either columnId or worksheetId for reprocess.");
  }

  const PROCESSING_TYPES = new Set([
    "AI", "Agent", "AgentTest", "Evaluation", "PromptTemplate",
    "Object", "DataModelObject", "InvocableAction", "Formula",
  ]);

  if (columnId) {
    const { column, worksheetId: wsId } = await getColumnConfig(client, columnId, worksheetId);
    if (!column?.config) {
      return errorTextResult(`Error: Could not retrieve config for column ${columnId}. Use column reprocess with full config JSON instead.`);
    }

    // Helper: full column-level reprocess (re-execute every cell with current config)
    const reprocessWholeColumn = async () => {
      const reprocessPayload = {
        name: column.name,
        type: column.type,
        config: column.config,
      };
      return client.post(
        `/worksheets/${encodeURIComponent(wsId)}/columns/${encodeURIComponent(columnId)}/reprocess`,
        reprocessPayload
      );
    };

    if (filter === "all") {
      const result = await reprocessWholeColumn();
      return jsonResult({ reprocessed: "all", columnId, result });
    }

    const wsData = await client.get(`/worksheets/${encodeURIComponent(wsId)}/data`);
    const cells = getColumnCells(wsData, columnId);
    if (cells.length === 0) return errorTextResult(`Error: Column ${columnId} cells not found.`);

    // Cell/column status comes back capitalized ("Complete", "Stale", "Failed");
    // some endpoints upper-case. Match case-insensitively.
    const matchStatus = (s: any, target: string) =>
      typeof s === "string" && s.toLowerCase() === target;

    if (filter === "stale") {
      // Cells go Stale via three Core paths:
      //   (A) column.save without reprocess — entire column STALE
      //   (B) upstream column config changed — entire dependent column STALE
      //   (C) upstream cell value changed — only specific rowIds STALE in dependents
      // For (A) and (B) the column itself is Stale → re-run the column with the
      // current config. For (C) the column is Complete but holds a subset of
      // Stale cells → fire row-level retry on just those rowIds so unaffected
      // cells aren't re-executed.
      if (matchStatus(column.status, "stale")) {
        const result = await reprocessWholeColumn();
        return jsonResult({
          reprocessed: "all",
          columnId,
          filter,
          message: "Column itself is Stale — running full column reprocess.",
          result,
        });
      }
      const staleRowIds: string[] = cells
        .filter((c: any) => matchStatus(c.status, "stale"))
        .map((c: any) => c.worksheetRowId)
        .filter(Boolean);
      if (staleRowIds.length === 0) {
        return jsonResult({ reprocessed: 0, columnId, filter, message: "No stale cells found." });
      }
      const result = await client.post(
        `/worksheets/${encodeURIComponent(wsId)}/trigger-row-execution`,
        { trigger: "RUN_ROW", rowIds: staleRowIds }
      );
      return jsonResult({
        reprocessed: staleRowIds.length,
        columnId,
        filter,
        message: `Column is ${column.status} with ${staleRowIds.length} stale cells — retrying just those rows.`,
        result,
      });
    }

    // filter === "failed": retry only the cells that errored.
    const failedRowIds: string[] = cells
      .filter((c: any) => matchStatus(c.status, "failed"))
      .map((c: any) => c.worksheetRowId)
      .filter(Boolean);

    if (failedRowIds.length === 0) {
      return jsonResult({ reprocessed: 0, columnId, filter, message: "No failed cells found." });
    }

    const result = await client.post(
      `/worksheets/${encodeURIComponent(wsId)}/trigger-row-execution`,
      { trigger: "RUN_ROW", rowIds: failedRowIds }
    );

    return jsonResult({
      reprocessed: failedRowIds.length,
      columnId,
      filter,
      message: `Reprocessing ${failedRowIds.length} failed cells.`,
      result,
    });
  }

  // Worksheet-level reprocess
  const wsData = await client.get(`/worksheets/${encodeURIComponent(worksheetId!)}/data`);
  const columns = wsData.columns || [];
  const processingCols = columns.filter((c: any) => PROCESSING_TYPES.has(c.config?.type ?? c.type));

  if (filter === "all") {
    const results: any[] = [];
    const skipped: string[] = [];
    for (const col of processingCols) {
      const cached = configCache.get(col.id);
      if (!cached) {
        skipped.push(col.name ?? col.id);
        continue;
      }
      const result = await client.post(
        `/worksheets/${encodeURIComponent(worksheetId!)}/columns/${encodeURIComponent(col.id)}/reprocess`,
        cached
      );
      results.push({ columnId: col.id, name: col.name, result });
    }
    return jsonResult({
      reprocessed: "all",
      worksheetId,
      columnsReprocessed: results.length,
      ...(skipped.length > 0 ? { skippedNoCache: skipped } : {}),
      results,
    });
  }

  const targetStatus = filter === "failed" ? "Error" : "New";
  const matchingRowIds = new Set<string>();

  for (const col of processingCols) {
    const cells = getColumnCells(wsData, col.id);
    for (const cell of cells) {
      if (cell.status === targetStatus && cell.worksheetRowId) {
        matchingRowIds.add(cell.worksheetRowId);
      }
    }
  }

  if (matchingRowIds.size === 0) {
    return jsonResult({
      reprocessed: 0,
      worksheetId,
      filter,
      message: `No ${filter} cells found in any processing column.`,
    });
  }

  const result = await client.post(
    `/worksheets/${encodeURIComponent(worksheetId!)}/trigger-row-execution`,
    { trigger: "RUN_ROW", rowIds: [...matchingRowIds] }
  );

  return jsonResult({
    reprocessed: matchingRowIds.size,
    worksheetId,
    filter,
    message: `Reprocessing ${matchingRowIds.size} rows with ${filter} cells.`,
    result,
  });
}

async function handleEditPromptTemplate(
  client: GridClient,
  params: Record<string, any>
): Promise<{ content: { type: "text"; text: string }[] }> {
  const { columnId, worksheetId, promptTemplateName, inputMappings: inputMappingsStr, model, reprocess: _reprocess } = params;
  const reprocess = _reprocess ?? true;

  const { column, worksheetId: wsId, worksheetColumns } = await getColumnConfig(client, columnId, worksheetId);
  const outerConfig = await getOrFetchColumnConfig(client, columnId, wsId);
  if (!outerConfig) {
    return errorTextResult(`Error: Could not retrieve config for column ${columnId}. Use column edit with full config JSON instead.`);
  }
  const innerConfig = { ...outerConfig.config };
  const colType = outerConfig.type ?? column.type;

  if (colType !== "PromptTemplate") {
    return errorTextResult(`Error: edit_prompt_template only works on PromptTemplate columns (this column is ${colType}).`);
  }

  if (promptTemplateName !== undefined) {
    innerConfig.promptTemplateDevName = promptTemplateName;
  }

  if (model !== undefined) {
    innerConfig.modelConfig = resolveModelShorthand(model);
  }

  if (inputMappingsStr !== undefined) {
    let inputMappings: any[];
    try {
      inputMappings = typeof inputMappingsStr === "string" ? JSON.parse(inputMappingsStr) : inputMappingsStr;
    } catch (e) {
      return errorTextResult(`Error: inputMappings must be a valid JSON array string. ${(e as Error).message}`);
    }
    innerConfig.promptTemplateInputConfigs = inputMappings.map((mapping: any) => {
      const ref = resolveColumnRef(mapping.column, worksheetColumns);
      const config: any = { referenceName: mapping.variable };
      if (ref) {
        config.referenceAttribute = {
          columnId: ref.columnId,
          columnName: ref.columnName,
          columnType: ref.columnType,
          ...(mapping.field ? { fieldName: mapping.field } : {}),
        };
      }
      return config;
    });
  }

  const updatedConfig = { ...outerConfig, config: innerConfig };
  const result = await saveOrReprocess(client, wsId, columnId, updatedConfig, reprocess, column?.name);

  return jsonResult({ columnId, updated: true, reprocessing: reprocess, result });
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerColumnMutationTool(server: McpServer, client: GridClient): void {
  server.tool(
    "column_mutation",
    `Typed column mutations — narrow shorthands for editing specific column-type fields without rebuilding the full config JSON.

Actions:
- edit_ai_prompt: edit instruction/model/responseFormat/responseOptions on an AI column
- edit_agent_config: edit agent/agentVersion/utteranceColumn/contextVariables/isDraft on an Agent or AgentTest column
- add_evaluation: add an Evaluation column wired to a target (and optional reference) column
- change_model: change the model on an AI or PromptTemplate column
- update_filters: update filters on an Object or DataModelObject column
- reprocess_typed: reprocess column or worksheet with optional filter (all/failed/stale)
- edit_prompt_template: edit promptTemplateName/model/inputMappings on a PromptTemplate column

For full-config edits or CRUD (add/edit/save/delete/reprocess/get_data), use the \`column\` tool instead.`,
    {
      action: z.enum([
        "edit_ai_prompt", "edit_agent_config", "add_evaluation",
        "change_model", "update_filters", "reprocess_typed", "edit_prompt_template",
      ]),
      worksheetId: z.string().optional().describe("Worksheet containing the column"),
      columnId: z.string().optional().describe("Column ID (required for all actions except add_evaluation and reprocess_typed when worksheetId is provided)"),
      name: z.string().optional().describe("Column name (for add_evaluation)"),
      // edit_ai_prompt
      instruction: z.string().optional().describe("AI column prompt text (for edit_ai_prompt)"),
      model: z.string().optional().describe("Model name or shorthand (for edit_ai_prompt, change_model, edit_prompt_template)"),
      responseFormat: z.string().optional().describe("PLAIN_TEXT or SINGLE_SELECT (for edit_ai_prompt)"),
      responseOptions: z.array(z.string()).optional().describe("Options for SINGLE_SELECT (for edit_ai_prompt)"),
      // edit_agent_config
      agent: z.string().optional().describe("Agent name or ID (for edit_agent_config)"),
      agentVersion: z.string().optional().describe("Agent version ID (for edit_agent_config)"),
      utteranceColumn: z.string().optional().describe("Utterance template with {ColumnName} refs (for edit_agent_config)"),
      contextVariables: z.union([z.array(ContextVariableSchema), z.string()]).optional().describe("Array of context variables (for edit_agent_config). Pass an array directly; JSON string still accepted for back-compat."),
      isDraft: z.boolean().optional().describe("Test draft agent version (for edit_agent_config)"),
      // add_evaluation
      evaluationType: z.string().optional().describe("Evaluation type (for add_evaluation)"),
      targetColumn: z.string().optional().describe("Column to evaluate (for add_evaluation)"),
      referenceColumn: z.string().optional().describe("Expected values column (for add_evaluation)"),
      expressionFormula: z.string().optional().describe("Formula for EXPRESSION_EVAL (for add_evaluation)"),
      customEvalTemplate: z.string().optional().describe("Template for CUSTOM_LLM_EVALUATION (for add_evaluation)"),
      // update_filters
      filters: z.union([z.array(FilterConditionSchema), z.string()]).optional().describe("Array of filter conditions (for update_filters). Each: { field, operator, values? }. JSON string still accepted for back-compat."),
      // reprocess_typed
      reprocessFilter: z.enum(["all", "failed", "stale"]).optional().describe("Which cells to reprocess (for reprocess_typed)"),
      reprocess: z.boolean().optional().describe("Whether to reprocess after mutation (default: true)"),
      // edit_prompt_template
      promptTemplateName: z.string().optional().describe("Prompt template dev name (for edit_prompt_template)"),
      inputMappings: z.union([z.array(PromptTemplateInputConfigSchema), z.string()]).optional().describe("Array of prompt-template input mappings (for edit_prompt_template). JSON string still accepted for back-compat."),
    },
    async (params) => {
      const { action, columnId } = params;

      try {
        switch (action) {
          case "edit_ai_prompt": {
            requireParam(columnId, "columnId", "edit_ai_prompt");
            return handleEditAiPrompt(client, params);
          }
          case "edit_agent_config": {
            requireParam(columnId, "columnId", "edit_agent_config");
            return handleEditAgentConfig(client, params);
          }
          case "add_evaluation": {
            return handleAddEvaluation(client, params);
          }
          case "change_model": {
            requireParam(columnId, "columnId", "change_model");
            return handleChangeModel(client, params);
          }
          case "update_filters": {
            requireParam(columnId, "columnId", "update_filters");
            return handleUpdateFilters(client, params);
          }
          case "reprocess_typed": {
            return handleReprocessTyped(client, params);
          }
          case "edit_prompt_template": {
            requireParam(columnId, "columnId", "edit_prompt_template");
            return handleEditPromptTemplate(client, params);
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