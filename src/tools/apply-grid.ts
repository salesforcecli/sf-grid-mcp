import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GridClient } from "../client.js";
import { applyGridSpec, type ApplyGridResult } from "../lib/resolution-engine.js";
import { errorResult, errorTextResult, textResult } from "../lib/result-helpers.js";

export function registerApplyGridTool(server: McpServer, client: GridClient): void {
  server.tool(
    "apply_grid",
    `Create or update an Agentforce Grid from a YAML specification. Accepts a declarative YAML
string describing the grid structure (workbook, worksheet, columns, data). Creates all resources
in dependency order, resolving column references automatically.

Use this tool when:
- Creating a new grid from scratch (omit worksheetId)
- Adding columns to an existing grid (provide worksheetId)
- Rebuilding a grid from a modified spec

The YAML format uses column names as references -- you never need to know column IDs.
Returns the created resource IDs (workbook, worksheet, columns) and any errors.

YAML format:
  workbook: <name>
  worksheet: <name>
  model: <default model shorthand, e.g. gpt-4o>
  columns:
    - name: <column name>
      type: <text|ai|object|agent|agent_test|evaluation|formula|reference|prompt_template|action|invocable_action|data_model_object>
      <type-specific fields...>
  data:
    <column name>:
      - value1
      - value2

Agent test suite example:
  workbook: My Agent Tests
  worksheet: Tests
  columns:
    - name: Utterances
      type: text
    - name: Expected Topics
      type: text
    - name: Agent Output
      type: agent_test
      agent: Sales Agent
      inputUtterance: Utterances
    - name: Coherence
      type: eval/coherence
      input: Agent Output
    - name: Topic Check
      type: eval/topic_assertion
      input: Agent Output
      reference: Expected Topics
  data:
    Utterances:
      - "I want to buy your enterprise plan"
      - "Can you help me with a refund?"
    Expected Topics:
      - "Sales"
      - "Support"

Column type quick reference:
- text: plain text column (no extra fields needed)
- ai: LLM generation. Fields: instruction, model, responseFormat (plain_text|single_select), options
- object: Salesforce query. Fields: object, fields, filters, soql
- agent: invoke agent. Fields: agent, utterance, contextVariables
- agent_test: batch test agent. Fields: agent, inputUtterance (column name), isDraft
- eval/*: evaluate column. Shorthand types: eval/coherence, eval/conciseness, eval/factuality,
  eval/response_match, eval/topic_assertion, eval/action_assertion, eval/latency, etc.
  Fields: input (column name), reference (column name, for comparison evals)
- formula: computed value. Fields: formula, returnType
- reference: extract field. Fields: source (column name), field (JSON path)
- prompt_template: execute template. Fields: template, model, inputs
- invocable_action: run Flow/Apex. Fields: action (type+name), payload
- data_model_object: Data Cloud query. Fields: dmo, dataspace, fields

Model shorthands: gpt-4-omni, gpt-4.1, gpt-5, gpt-5-mini, o3, o4-mini, claude-4.5-sonnet, claude-4-sonnet, gemini-2.5-flash, gemini-2.5-pro`,
    {
      spec: z.string().describe(
        "YAML string defining the grid. Must include 'workbook', 'worksheet', and 'columns' at minimum.",
      ),
      worksheetId: z.string().optional().describe(
        "If provided, adds columns to this existing worksheet instead of creating a new one. " +
        "Existing columns are matched by name and skipped; new columns are appended.",
      ),
      dryRun: z.boolean().optional().describe(
        "If true, validates the spec and returns the execution plan without making API calls.",
      ),
    },
    async ({ spec, worksheetId, dryRun }) => {
      try {
        const result = await applyGridSpec(client, spec, { worksheetId, dryRun });
        const output = formatResult(result, dryRun);
        // Surface fatal failures as MCP errors so callers can branch on
        // isError without parsing the formatted output. Recoverable errors
        // (where some columns failed but the worksheet exists for retry)
        // stay as a non-error result — formatResult already includes the
        // recovery instructions in the text.
        const hasFatalErrors = result.errors.some((e) => !e.recoverable);
        return hasFatalErrors ? errorTextResult(output) : textResult(output);
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );
}

function formatResult(result: ApplyGridResult, dryRun?: boolean): string {
  const hasErrors = result.errors.length > 0;
  const hasFatalErrors = result.errors.some((e) => !e.recoverable);

  // Dry run output
  if (dryRun) {
    const lines: string[] = ["## Dry Run - Execution Plan\n"];
    for (const step of result.plan) {
      const icon = step.status === "pending" ? "[PENDING]" : `[${step.status.toUpperCase()}]`;
      lines.push(`${icon} ${step.action}: ${step.target}${step.details ? ` (${step.details})` : ""}`);
    }
    if (hasErrors) {
      lines.push("\n## Validation Errors\n");
      for (const err of result.errors) {
        const prefix = err.column ? `Column "${err.column}"` : "Spec";
        lines.push(`- ${prefix}: ${err.message}`);
      }
    }
    return lines.join("\n");
  }

  // Success or partial failure
  const lines: string[] = [];

  if (hasFatalErrors) {
    lines.push("## Failed\n");
  } else if (hasErrors) {
    lines.push("## Completed with Errors\n");
  } else {
    lines.push("## Success\n");
  }

  // IDs
  if (result.workbookId) lines.push(`Workbook ID: ${result.workbookId}`);
  if (result.worksheetId) lines.push(`Worksheet ID: ${result.worksheetId}`);

  // Column map
  const colEntries = Object.entries(result.columns);
  if (colEntries.length > 0) {
    lines.push("\nColumns:");
    for (const [name, id] of colEntries) {
      lines.push(`  ${name}: ${id}`);
    }
  }

  // Rows
  if (result.rowIds.length > 0) {
    lines.push(`\nRows created: ${result.rowIds.length}`);
  }

  // Execution plan
  lines.push("\nExecution Plan:");
  for (const step of result.plan) {
    const icon = step.status === "success" ? "[OK]"
      : step.status === "failed" ? "[FAIL]"
      : step.status === "skipped" ? "[SKIP]"
      : "[PENDING]";
    lines.push(`  ${icon} ${step.action}: ${step.target}${step.details ? ` (${step.details})` : ""}`);
  }

  // Errors
  if (hasErrors) {
    lines.push("\nErrors:");
    for (const err of result.errors) {
      const prefix = err.column ? `Column "${err.column}"` : "Spec";
      const recoverHint = err.recoverable ? " [recoverable - retry with worksheetId]" : "";
      lines.push(`  - ${prefix} (${err.step}): ${err.message}${recoverHint}`);
    }
  }

  // Recovery instructions for partial failures
  if (hasErrors && result.worksheetId && result.errors.some((e) => e.recoverable)) {
    lines.push(`\nTo retry failed columns, re-run apply_grid with worksheetId: "${result.worksheetId}"`);
    lines.push("Existing columns will be skipped; only failed/missing columns will be created.");
  }

  return lines.join("\n");
}
