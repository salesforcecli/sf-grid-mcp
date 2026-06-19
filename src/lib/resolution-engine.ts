/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

/**
 * Resolution engine: orchestrates the full YAML -> Grid API pipeline.
 *
 * Pipeline:
 * 1. Parse YAML -> GridSpec
 * 2. Validate (return errors if any)
 * 3. Resolve external names (agents, models)
 * 4. Create/find workbook and worksheet
 * 5. If incremental: fetch existing columns
 * 6. Topological sort (from validator)
 * 7. For each column in order: expand config -> POST to API -> record ID
 * 8. Paste data if present
 * 9. Return structured result
 */

import { GridClient } from "../client.js";
import { parseGridYaml, type GridSpec, type ColumnSpec } from "./yaml-parser.js";
import { validateAndSort } from "./validator.js";
import { expandColumnConfig, type ExpansionContext, type ColumnMapEntry } from "./config-expander.js";
import { resolveModelShorthand } from "./model-map.js";
import { configCache } from "./column-config-cache.js";
import { extractRowIds } from "./worksheet-data-helpers.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ApplyGridResult {
  workbookId: string;
  worksheetId: string;
  columns: Record<string, string>; // name -> columnId
  rowIds: string[];
  errors: ApplyGridError[];
  plan: PlanStep[];
}

export interface ApplyGridError {
  column: string;
  step: string;
  message: string;
  recoverable: boolean;
}

export interface PlanStep {
  action: string;
  target: string;
  status: "success" | "failed" | "skipped" | "pending";
  details?: string;
}

export interface ApplyGridOptions {
  worksheetId?: string;
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ResolvedAgent {
  definitionId: string;
  versionId: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function applyGridSpec(
  client: GridClient,
  yamlString: string,
  options?: ApplyGridOptions,
): Promise<ApplyGridResult> {
  const errors: ApplyGridError[] = [];
  const plan: PlanStep[] = [];
  const columnIds: Record<string, string> = {};
  let rowIds: string[] = [];

  // Step 1: Parse YAML
  let spec: GridSpec;
  try {
    spec = parseGridYaml(yamlString);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      workbookId: "",
      worksheetId: "",
      columns: {},
      rowIds: [],
      errors: [{ column: "", step: "parse", message: msg, recoverable: false }],
      plan: [{ action: "parse", target: "yaml", status: "failed", details: msg }],
    };
  }
  plan.push({ action: "parse", target: "yaml", status: "success" });

  // Step 2: Validate and topological sort
  const validation = validateAndSort(spec);
  if (validation.errors.length > 0) {
    const validationErrors: ApplyGridError[] = validation.errors.map((e) => ({
      column: (e.details as Record<string, unknown>).column as string ?? "",
      step: "validate",
      message: `[${e.code}] ${e.message}`,
      recoverable: false,
    }));
    return {
      workbookId: "",
      worksheetId: "",
      columns: {},
      rowIds: [],
      errors: validationErrors,
      plan: [{ action: "validate", target: "spec", status: "failed", details: `${validation.errors.length} validation error(s)` }],
    };
  }
  plan.push({ action: "validate", target: "spec", status: "success" });

  const sortedColumns = validation.sortedColumns;

  // Step 3: Resolve agent names -> IDs
  const agentNames = collectAgentNames(spec);
  const resolvedAgents = new Map<string, ResolvedAgent>();

  if (agentNames.size > 0 && !options?.dryRun) {
    try {
      const agentsResponse = await client.get("/agents");
      const agents: Array<Record<string, unknown>> = Array.isArray(agentsResponse)
        ? agentsResponse
        : agentsResponse?.agents ?? [];

      for (const name of agentNames) {
        const match = agents.find(
          (a) => (a.name as string)?.toLowerCase() === name.toLowerCase()
            || (a.label as string)?.toLowerCase() === name.toLowerCase(),
        );
        if (match) {
          resolvedAgents.set(name, {
            definitionId: match.id as string,
            versionId: (match.activeVersion as string) ?? (match.id as string),
          });
          plan.push({ action: "resolve_agent", target: name, status: "success", details: `id=${match.id}` });
        } else {
          errors.push({ column: "", step: "resolve_agent", message: `Agent "${name}" not found`, recoverable: false });
          plan.push({ action: "resolve_agent", target: name, status: "failed", details: "Not found in org" });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ column: "", step: "resolve_agent", message: `Failed to fetch agents: ${msg}`, recoverable: false });
      plan.push({ action: "resolve_agents", target: "all", status: "failed", details: msg });
    }

    // Bail if any agents couldn't be resolved
    if (errors.some((e) => e.step === "resolve_agent")) {
      return { workbookId: "", worksheetId: "", columns: columnIds, rowIds, errors, plan };
    }
  } else if (agentNames.size > 0 && options?.dryRun) {
    for (const name of agentNames) {
      plan.push({ action: "resolve_agent", target: name, status: "pending", details: "dry-run" });
    }
  }

  // Step 4: Create/find workbook and worksheet
  let workbookId = "";
  let worksheetId = options?.worksheetId ?? "";

  if (options?.dryRun) {
    plan.push({ action: "find_or_create_workbook", target: spec.workbook, status: "pending", details: "dry-run" });
    plan.push({ action: "find_or_create_worksheet", target: spec.worksheet, status: "pending", details: "dry-run" });

    // Build the plan for columns
    for (const col of sortedColumns) {
      plan.push({ action: "create_column", target: col.name, status: "pending", details: `type=${col.type}` });
    }

    if (spec.data) {
      plan.push({ action: "paste_data", target: "data", status: "pending", details: `${Object.keys(spec.data).length} column(s)` });
    }

    return { workbookId, worksheetId, columns: columnIds, rowIds, errors, plan };
  }

  // Find or create workbook
  try {
    workbookId = await findOrCreateWorkbook(client, spec.workbook);
    plan.push({ action: "find_or_create_workbook", target: spec.workbook, status: "success", details: `id=${workbookId}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push({ column: "", step: "workbook", message: msg, recoverable: false });
    plan.push({ action: "find_or_create_workbook", target: spec.workbook, status: "failed", details: msg });
    return { workbookId, worksheetId, columns: columnIds, rowIds, errors, plan };
  }

  // Find or create worksheet
  if (!worksheetId) {
    try {
      worksheetId = await findOrCreateWorksheet(client, workbookId, spec.worksheet);
      plan.push({ action: "find_or_create_worksheet", target: spec.worksheet, status: "success", details: `id=${worksheetId}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ column: "", step: "worksheet", message: msg, recoverable: false });
      plan.push({ action: "find_or_create_worksheet", target: spec.worksheet, status: "failed", details: msg });
      return { workbookId, worksheetId, columns: columnIds, rowIds, errors, plan };
    }
  } else {
    plan.push({ action: "use_existing_worksheet", target: worksheetId, status: "success" });
  }

  // Step 5: If incremental, fetch existing columns
  const existingColumnMap = new Map<string, ColumnMapEntry>();
  if (options?.worksheetId) {
    try {
      const wsData = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}/data`);
      const existingCols: Array<Record<string, unknown>> = wsData?.columns ?? [];
      for (const col of existingCols) {
        const name = col.name as string;
        const entry: ColumnMapEntry = {
          id: col.id as string,
          name,
          type: (col.type as string) ?? "Text",
        };
        existingColumnMap.set(name, entry);
        columnIds[name] = entry.id;
      }
      plan.push({ action: "fetch_existing_columns", target: worksheetId, status: "success", details: `${existingCols.length} existing column(s)` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ column: "", step: "fetch_existing", message: msg, recoverable: true });
      plan.push({ action: "fetch_existing_columns", target: worksheetId, status: "failed", details: msg });
    }
  }

  // Step 6-7: Create columns in topological order
  const columnMap = new Map<string, ColumnMapEntry>(existingColumnMap);
  const skippedColumns = new Set<string>();
  let precedingColumnId: string | undefined;

  // Inject resolved agent IDs into column specs
  injectAgentIds(sortedColumns, resolvedAgents);

  for (const col of sortedColumns) {
    // Skip if this column already exists (incremental mode)
    if (existingColumnMap.has(col.name)) {
      plan.push({ action: "skip_existing_column", target: col.name, status: "success", details: `id=${existingColumnMap.get(col.name)!.id}` });
      precedingColumnId = existingColumnMap.get(col.name)!.id;
      continue;
    }

    // Check if any dependency was skipped/failed
    const deps = getDependencyNames(col);
    const blockedBy = deps.find((d) => skippedColumns.has(d));
    if (blockedBy) {
      skippedColumns.add(col.name);
      errors.push({
        column: col.name,
        step: "create_column",
        message: `Skipped because dependency "${blockedBy}" failed`,
        recoverable: true,
      });
      plan.push({ action: "create_column", target: col.name, status: "skipped", details: `blocked by ${blockedBy}` });
      continue;
    }

    // Build expansion context
    const ctx: ExpansionContext = {
      columnMap,
      defaults: {
        numberOfRows: spec.numberOfRows ?? 50,
        model: spec.model ?? "gpt-4-omni",
      },
      resolveModel: resolveModelShorthand,
    };

    try {
      // Expand config
      const expanded = expandColumnConfig(col, ctx);

      // POST to API
      const body: Record<string, unknown> = {
        name: expanded.name,
        type: expanded.type,
        config: expanded.config,
      };
      if (precedingColumnId) {
        body.precedingColumnId = precedingColumnId;
      }

      const result = await client.post(
        `/worksheets/${encodeURIComponent(worksheetId)}/columns`,
        body,
      );

      const newColId = result.id as string;
      columnIds[col.name] = newColId;
      const mapEntry: ColumnMapEntry = { id: newColId, name: col.name, type: col.type };
      if ((col.type === "Object" || col.type === "DataModelObject") && Array.isArray(col.fields)) {
        mapEntry.fields = (col.fields as Array<string | Record<string, unknown>>).map(
          (f) => typeof f === "string" ? f : (f as Record<string, unknown>).name as string ?? String(f),
        );
      }
      columnMap.set(col.name, mapEntry);
      precedingColumnId = newColId;

      // Cache the full outer config so typed mutation tools can read it back
      configCache.set(newColId, expanded.config);

      plan.push({ action: "create_column", target: col.name, status: "success", details: `id=${newColId}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skippedColumns.add(col.name);
      errors.push({ column: col.name, step: "create_column", message: msg, recoverable: true });
      plan.push({ action: "create_column", target: col.name, status: "failed", details: msg });
    }
  }

  // Step 8: Paste data if present
  if (spec.data && Object.keys(spec.data).length > 0) {
    try {
      rowIds = await pasteData(client, worksheetId, spec.data, columnIds, spec.numberOfRows);
      plan.push({ action: "paste_data", target: "data", status: "success", details: `${rowIds.length} row(s)` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ column: "", step: "paste_data", message: msg, recoverable: true });
      plan.push({ action: "paste_data", target: "data", status: "failed", details: msg });
    }
  }

  // Step 9: Return result
  return { workbookId, worksheetId, columns: columnIds, rowIds, errors, plan };
}

// ---------------------------------------------------------------------------
// Helpers: Agent resolution
// ---------------------------------------------------------------------------

function collectAgentNames(spec: GridSpec): Set<string> {
  const names = new Set<string>();
  for (const col of spec.columns) {
    if ((col.type === "Agent" || col.type === "AgentTest") && typeof col.agent === "string") {
      names.add(col.agent as string);
    }
  }
  return names;
}

function injectAgentIds(columns: ColumnSpec[], resolvedAgents: Map<string, ResolvedAgent>): void {
  for (const col of columns) {
    if ((col.type === "Agent" || col.type === "AgentTest") && typeof col.agent === "string") {
      const resolved = resolvedAgents.get(col.agent as string);
      if (resolved) {
        col.agentId = resolved.definitionId;
        col.agentVersion = resolved.versionId;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers: Dependency tracking (lightweight version for skip detection)
// ---------------------------------------------------------------------------

function getDependencyNames(col: ColumnSpec): string[] {
  const deps: string[] = [];

  // Direct name references
  if (col.type === "AgentTest" && typeof col.inputUtterance === "string") {
    deps.push(col.inputUtterance as string);
  }
  if (col.type === "Evaluation" && typeof col.input === "string") {
    deps.push(col.input as string);
  }
  if (col.type === "Evaluation" && typeof col.reference === "string") {
    deps.push(col.reference as string);
  }
  if (col.type === "Reference" && typeof col.source === "string") {
    deps.push(col.source as string);
  }

  // Agent/AgentTest: conversationHistory, initialState
  if (typeof col.conversationHistory === "string") deps.push(col.conversationHistory as string);
  if (typeof col.initialState === "string") deps.push(col.initialState as string);

  // Agent/AgentTest: contextVariables with column references
  if (col.contextVariables && typeof col.contextVariables === "object") {
    const cvMap = col.contextVariables as Record<string, unknown>;
    for (const val of Object.values(cvMap)) {
      if (typeof val === "string") {
        const cvMatch = /^\{(.+)\}$/.exec(val);
        if (cvMatch) deps.push(cvMatch[1].split(".")[0]);
      }
    }
  }

  // PromptTemplate: inputs with column references
  if (col.type === "PromptTemplate" && col.inputs && typeof col.inputs === "object") {
    const inputs = col.inputs as Record<string, unknown>;
    for (const val of Object.values(inputs)) {
      if (typeof val === "string") {
        const inputMatch = /^\{(.+)\}$/.exec(val);
        if (inputMatch) deps.push(inputMatch[1].split(".")[0]);
      }
    }
  }

  // Placeholder refs in text fields (instructions, utterances, formulas, payloads, SOQL/DCSQL)
  const textFields: string[] = [];
  if (col.type === "AI" && typeof col.instruction === "string") textFields.push(col.instruction as string);
  if (col.type === "Agent" && typeof col.utterance === "string") textFields.push(col.utterance as string);
  if (col.type === "Formula" && typeof col.formula === "string") textFields.push(col.formula as string);
  if (col.type === "InvocableAction" && col.payload && typeof col.payload === "object") {
    for (const val of Object.values(col.payload as Record<string, unknown>)) {
      if (typeof val === "string") textFields.push(val);
    }
  }
  if (col.type === "Object" && typeof col.soql === "string") textFields.push(col.soql as string);
  if (col.type === "DataModelObject" && typeof col.dcsql === "string") textFields.push(col.dcsql as string);

  for (const text of textFields) {
    const regex = /\{([^{}$]+?)\}/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const inner = match[1].trim();
      if (inner && !inner.startsWith("response.") && !inner.startsWith("json.") && !/^\d+$/.test(inner)) {
        deps.push(inner.split(".")[0]);
      }
    }
  }

  return deps;
}

// ---------------------------------------------------------------------------
// Helpers: Workbook/Worksheet CRUD
// ---------------------------------------------------------------------------

async function findOrCreateWorkbook(client: GridClient, name: string): Promise<string> {
  const response = await client.get("/workbooks");
  const workbooks: Array<Record<string, unknown>> = Array.isArray(response)
    ? response
    : response?.workbooks ?? [];

  const existing = workbooks.find(
    (wb) => (wb.name as string)?.toLowerCase() === name.toLowerCase(),
  );
  if (existing) {
    return existing.id as string;
  }

  const created = await client.post("/workbooks", { name });
  return created.id as string;
}

async function findOrCreateWorksheet(
  client: GridClient,
  workbookId: string,
  name: string,
): Promise<string> {
  // Get workbook details to find worksheets
  const workbook = await client.get(`/workbooks/${encodeURIComponent(workbookId)}`);
  const worksheetIds: string[] = workbook?.worksheetIds
    ?? (workbook?.worksheets as Array<Record<string, unknown>>)?.map((w) => w.id as string)
    ?? [];

  // Check each worksheet for a name match
  for (const wsId of worksheetIds) {
    try {
      const ws = await client.get(`/worksheets/${encodeURIComponent(wsId)}/data`);
      if ((ws.name as string)?.toLowerCase() === name.toLowerCase()) {
        return wsId;
      }
    } catch {
      // Skip worksheets we can't read
    }
  }

  const created = await client.post("/worksheets", { name, workbookId });
  return created.id as string;
}

// ---------------------------------------------------------------------------
// Helpers: Data pasting
// ---------------------------------------------------------------------------

async function pasteData(
  client: GridClient,
  worksheetId: string,
  data: Record<string, string[]>,
  columnIds: Record<string, string>,
  numberOfRows?: number,
): Promise<string[]> {
  const wsPath = `/worksheets/${encodeURIComponent(worksheetId)}`;

  // Find the first data column that has a matching column ID
  const dataColumns = Object.entries(data).filter(([name]) => columnIds[name]);
  if (dataColumns.length === 0) return [];

  // Determine how many rows we need
  const maxDataRows = Math.max(...dataColumns.map(([, values]) => values.length));

  // Fetch current rows
  const wsData = await client.get(`${wsPath}/data`);
  let rowIds: string[] = extractRowIds(wsData);

  // Add rows if needed
  const neededRows = maxDataRows - rowIds.length;
  if (neededRows > 0) {
    await client.post(`${wsPath}/rows`, {
      numberOfRows: neededRows,
      ...(rowIds.length > 0 ? { anchorRowId: rowIds[rowIds.length - 1], position: "after" } : {}),
    });
    const updatedData = await client.get(`${wsPath}/data`);
    rowIds = extractRowIds(updatedData);
  }

  if (rowIds.length === 0) return [];

  // Paste each data column
  for (const [colName, values] of dataColumns) {
    const colId = columnIds[colName];
    if (!colId) continue;

    const matrix = values.map((v) => [{ displayContent: v }]);
    await client.post(`${wsPath}/paste`, {
      startColumnId: colId,
      startRowId: rowIds[0],
      matrix,
    });
  }

  return rowIds;
}
