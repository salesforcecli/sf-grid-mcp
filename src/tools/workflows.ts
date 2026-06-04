import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GridClient } from "../client.js";
import { extractRowIds, getColumnCells, countColumnStatuses } from "../lib/worksheet-data-helpers.js";
import { errorResult, errorTextResult, jsonResult } from "../lib/result-helpers.js";

export function registerWorkflowTools(server: McpServer, client: GridClient): void {
  server.tool(
    "poll_worksheet_status",
    "Poll a worksheet until all cells finish processing (complete or error). Returns a structured summary with per-column status counts and overall completion percentage. Use after adding columns that trigger processing (AI, Agent, AgentTest, Evaluation, etc.).",
    {
      worksheetId: z.string().describe("The ID of the worksheet to poll"),
      maxAttempts: z.number().optional().describe("Maximum number of polling attempts before giving up (default: 30)"),
      intervalMs: z.number().optional().describe("Milliseconds between polls (default: 3000)"),
    },
    async ({ worksheetId, maxAttempts: _maxAttempts, intervalMs: _intervalMs }) => {
      const maxAttempts = _maxAttempts ?? 30;
      const intervalMs = _intervalMs ?? 3000;
      try {
        const result = await pollWorksheet(client, worksheetId, maxAttempts, intervalMs);
        return jsonResult(result);
      } catch (error: unknown) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "get_worksheet_summary",
    "Get a structured summary of a worksheet including column names, types, and per-column cell status counts (complete/in-progress/error/new). Much more readable than raw get_worksheet_data output. Use this for status checks and progress monitoring.",
    {
      worksheetId: z.string().describe("The ID of the worksheet to summarize"),
    },
    async ({ worksheetId }) => {
      try {
        const data = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}/data`);

        const rowIds = extractRowIds(data);
        const columns = (data.columns || []).map((col: any) => {
          const cells = getColumnCells(data, col.id);
          const total = cells.length;
          const complete = cells.filter((c: any) => c.status === "Complete").length;
          const inProgress = cells.filter((c: any) => c.status === "InProgress").length;
          const error = cells.filter((c: any) => c.status === "Error").length;
          const newCount = cells.filter((c: any) => c.status === "New").length;
          return {
            id: col.id,
            name: col.name,
            type: col.type,
            status: col.status,
            cells: { total, complete, inProgress, error, new: newCount },
          };
        });

        const totalCells = columns.reduce((sum: number, col: any) => sum + col.cells.total, 0);
        const completeCells = columns.reduce((sum: number, col: any) => sum + col.cells.complete, 0);
        const pct = totalCells > 0 ? Math.round((completeCells / totalCells) * 100) : 100;

        const result = {
          worksheetId,
          worksheetName: data.name,
          workbookId: data.workbookId,
          totalRows: rowIds.length,
          columns,
          overallCompletion: `${pct}% (${completeCells}/${totalCells} cells complete)`,
        };

        return jsonResult(result);
      } catch (error: unknown) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "setup_agent_test",
    `Set up a complete agent test suite in a single operation. Creates a workbook, worksheet, Text column for utterances, pastes the test utterances, adds an AgentTest column wired to the utterance column, and optionally adds Evaluation columns. Returns all created resource IDs.

This replaces a 10-15 step manual workflow. After this tool completes, use poll_worksheet_status to wait for agent processing to finish.

Supported evaluationTypes: COHERENCE, CONCISENESS, FACTUALITY, INSTRUCTION_FOLLOWING, COMPLETENESS, RESPONSE_MATCH, TOPIC_ASSERTION, ACTION_ASSERTION, LATENCY_ASSERTION, BOT_RESPONSE_RATING

Note: RESPONSE_MATCH, TOPIC_ASSERTION, ACTION_ASSERTION, and BOT_RESPONSE_RATING require expectedResponses to be provided for a reference column.`,
    {
      agentId: z.string().describe("The agent definition ID (e.g., 0XxRM000000xxxxx)"),
      agentVersion: z.string().describe("The agent version ID (e.g., 0XyRM000000xxxxx). Get this from get_agents using the activeVersion field."),
      utterances: z.array(z.string()).describe('Array of test utterance strings, e.g. ["Hello", "Help me with my order"]'),
      workbookName: z.string().optional().describe("Name for the test workbook (default: 'Agent Test Suite')"),
      worksheetName: z.string().optional().describe("Name for the test worksheet (default: 'Tests')"),
      evaluationTypes: z.array(z.string()).optional().describe("Evaluation types to add, e.g. ['COHERENCE', 'TOPIC_ASSERTION']. See tool description for supported types."),
      expectedResponses: z.array(z.string()).optional().describe("Expected responses for reference-based evaluations (RESPONSE_MATCH, TOPIC_ASSERTION, etc.). Must match utterances array length."),
      isDraft: z.boolean().optional().describe("Set to true to test a draft (unpublished) agent version"),
    },
    async ({ agentId, agentVersion, utterances, workbookName, worksheetName, evaluationTypes, expectedResponses, isDraft }) => {
      try {
        const wbName = workbookName ?? "Agent Test Suite";
        const wsName = worksheetName ?? "Tests";
        const evals = evaluationTypes ?? [];
        const REFERENCE_EVALS = new Set(["RESPONSE_MATCH", "TOPIC_ASSERTION", "ACTION_ASSERTION", "BOT_RESPONSE_RATING"]);
        const needsExpected = evals.some(e => REFERENCE_EVALS.has(e));

        if (needsExpected && (!expectedResponses || expectedResponses.length !== utterances.length)) {
          return errorTextResult(
            `Error: evaluationTypes includes reference-based evaluations (${evals.filter(e => REFERENCE_EVALS.has(e)).join(", ")}) but expectedResponses is missing or doesn't match utterances length (${utterances.length}).`,
          );
        }

        // Step 1: Create workbook + worksheet
        const workbook = await client.post("/workbooks", { name: wbName });
        const worksheet = await client.post("/worksheets", { name: wsName, workbookId: workbook.id });
        const worksheetId = worksheet.id;

        // Step 2: Add Text column for utterances
        const utteranceCol = await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/columns`, {
          name: "Utterances",
          type: "Text",
          config: { type: "Text", autoUpdate: true, config: { autoUpdate: true } },
        });
        const utteranceColId = utteranceCol.id;

        // Step 3: Get worksheet data to find row IDs (adding column may have created rows)
        let wsData = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}/data`);
        let rowIds: string[] = extractRowIds(wsData);

        // Step 4: Add rows if needed
        const neededRows = utterances.length - rowIds.length;
        if (neededRows > 0) {
          const addResult = await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/rows`, {
            numberOfRows: neededRows,
            ...(rowIds.length > 0 ? { anchorRowId: rowIds[rowIds.length - 1], position: "after" } : {}),
          });
          // Re-fetch to get updated row IDs
          wsData = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}/data`);
          rowIds = extractRowIds(wsData);
        }

        // Step 5: Paste utterances
        const utteranceMatrix = utterances.map(u => [{ displayContent: u }]);
        await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/paste`, {
          startColumnId: utteranceColId,
          startRowId: rowIds[0],
          matrix: utteranceMatrix,
        });

        // Step 6: Add Expected Responses column if needed
        let expectedColId: string | null = null;
        if (needsExpected && expectedResponses) {
          const expectedCol = await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/columns`, {
            name: "Expected Response",
            type: "Text",
            precedingColumnId: utteranceColId,
            config: { type: "Text", autoUpdate: true, config: { autoUpdate: true } },
          });
          expectedColId = expectedCol.id;

          const expectedMatrix = expectedResponses.map(r => [{ displayContent: r }]);
          await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/paste`, {
            startColumnId: expectedColId,
            startRowId: rowIds[0],
            matrix: expectedMatrix,
          });
        }

        // Step 7: Add AgentTest column
        const agentTestCol = await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/columns`, {
          name: "Agent Output",
          type: "AgentTest",
          precedingColumnId: expectedColId ?? utteranceColId,
          config: {
            type: "AgentTest",
            numberOfRows: utterances.length,
            queryResponseFormat: { type: "EACH_ROW" },
            autoUpdate: true,
            config: {
              autoUpdate: true,
              agentId,
              agentVersion,
              inputUtterance: {
                columnId: utteranceColId,
                columnName: "Utterances",
                columnType: "TEXT",
              },
              contextVariables: [],
              isDraft: isDraft ?? false,
              enableSimulationMode: false,
            },
          },
        });
        const agentTestColId = agentTestCol.id;

        // Step 8: Add Evaluation columns
        const evalColumns: Record<string, string> = {};
        let precedingId = agentTestColId;

        for (const evalType of evals) {
          const evalConfig: any = {
            autoUpdate: true,
            evaluationType: evalType,
            inputColumnReference: {
              columnId: agentTestColId,
              columnName: "Agent Output",
              columnType: "AGENT_TEST",
            },
            autoEvaluate: true,
          };

          // Add reference column for comparison evaluations
          if (REFERENCE_EVALS.has(evalType) && expectedColId) {
            evalConfig.referenceColumnReference = {
              columnId: expectedColId,
              columnName: "Expected Response",
              columnType: "TEXT",
            };
          }

          const evalCol = await client.post(`/worksheets/${encodeURIComponent(worksheetId)}/columns`, {
            name: evalType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
            type: "Evaluation",
            precedingColumnId: precedingId,
            config: {
              type: "Evaluation",
              queryResponseFormat: { type: "EACH_ROW" },
              autoUpdate: true,
              config: evalConfig,
            },
          });
          evalColumns[evalType] = evalCol.id;
          precedingId = evalCol.id;
        }

        const result = {
          workbookId: workbook.id,
          worksheetId,
          utteranceColumnId: utteranceColId,
          expectedResponseColumnId: expectedColId,
          agentTestColumnId: agentTestColId,
          evaluationColumnIds: evalColumns,
          utteranceCount: utterances.length,
          message: `Agent test suite created with ${utterances.length} utterances and ${evals.length} evaluations. Use poll_worksheet_status("${worksheetId}") to monitor processing.`,
        };

        return jsonResult(result);
      } catch (error: unknown) {
        return errorResult(error);
      }
    }
  );
}

async function pollWorksheet(
  client: GridClient,
  worksheetId: string,
  maxAttempts: number,
  intervalMs: number
): Promise<Record<string, unknown>> {
  let lastResult: ReturnType<typeof countColumnStatuses> | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const data = await client.get(`/worksheets/${encodeURIComponent(worksheetId)}/data`);
    lastResult = countColumnStatuses(data);

    if (lastResult.allDone) {
      return {
        status: lastResult.statusCounts.Error > 0 ? "completed_with_errors" : "complete",
        attempts: attempt,
        progress: { ...lastResult.statusCounts, total: lastResult.total },
        completionPct: lastResult.total > 0 ? Math.round((lastResult.done / lastResult.total) * 100) : 100,
        columns: lastResult.columnSummaries,
        totalRows: lastResult.totalRows,
      };
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  // Timed out — return last polled status (no extra fetch)
  const r = lastResult!;
  return {
    status: "timeout",
    attempts: maxAttempts,
    progress: { ...r.statusCounts, total: r.total },
    completionPct: r.total > 0 ? Math.round((r.done / r.total) * 100) : 0,
    columns: r.columnSummaries,
    totalRows: r.totalRows,
  };
}
