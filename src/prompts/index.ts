import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  server.prompt(
    "suggest-columns",
    "Suggest columns to add based on current grid state and user role",
    {
      worksheetId: z.string().describe("The worksheet ID to analyze"),
      userRole: z.string().optional().describe("User role: Sales Rep, CSM, RevOps, Developer, Admin"),
      goal: z.string().optional().describe("What the user is trying to accomplish"),
    },
    async ({ worksheetId, userRole, goal }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Analyze Grid worksheet ${worksheetId} and suggest columns to add.
${userRole ? `User role: ${userRole}` : "Ask about the user's role first."}
${goal ? `Goal: ${goal}` : ""}

COLUMN SUGGESTION RULES:
1. VALID REFERENCES: Only reference columns that exist. Never hallucinate column IDs.
2. NO CIRCULAR DEPS: New columns can only depend on existing columns.
3. CORRECT TYPE: AI(SINGLE_SELECT) for categorization, AI(PLAIN_TEXT) for free-text, Formula for computation, Reference for extraction.
4. ROLE-RELEVANT: Tailor to the user's role — RevOps needs quality flags, not outreach emails.
5. NO DUPLICATES: Don't recreate existing columns.
6. FORMAT MATCHES USE: SINGLE_SELECT for filtering/sorting, PLAIN_TEXT for content generation.

Steps:
1. Call get_worksheet_data for current grid state
2. Check get_prompt_templates and get_invocable_actions for available resources
3. Suggest 1-3 columns that fill the highest-value gaps
4. For each: name, type, config rationale, and which eval criteria it passes`,
          },
        },
      ],
    })
  );

  server.prompt(
    "create-agent-test",
    "Set up a complete agent test workbook with utterances and evaluations",
    {
      agentId: z.string().describe("The agent ID to test"),
      utterances: z.string().describe("Comma-separated test utterances"),
      evaluationTypes: z.string().optional().describe("Comma-separated eval types (default: RESPONSE_MATCH,TOPIC_ASSERTION,COHERENCE)"),
    },
    async ({ agentId, utterances, evaluationTypes }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Create an agent test workbook for agent ${agentId}.
Utterances: ${utterances}
Evaluations: ${evaluationTypes || "RESPONSE_MATCH, TOPIC_ASSERTION, COHERENCE"}

Use setup_agent_test for the fastest path. If it fails, create manually:
1. Create workbook + worksheet via create_workbook_with_worksheet
2. Text column for utterances, paste data
3. AgentTest column referencing utterance column
4. Evaluation columns for each type
5. Poll until complete
6. Report pass/fail counts`,
          },
        },
      ],
    })
  );

  server.prompt(
    "analyze-results",
    "Analyze evaluation results and identify failure patterns",
    {
      worksheetId: z.string().describe("The worksheet ID to analyze"),
      thresholds: z.string().optional().describe("Custom thresholds as JSON, e.g. {\"COHERENCE\": 3.5, \"FACTUALITY\": 4.0}. Defaults to standard OOTB thresholds if omitted."),
    },
    async ({ worksheetId, thresholds }) => {
      const defaultThresholds = "COHERENCE >= 3.5, FACTUALITY >= 4.0, COMPLETENESS >= 3.0, CONCISENESS >= 3.0, INSTRUCTION_FOLLOWING >= 3.5";
      const thresholdText = thresholds
        ? `Custom thresholds: ${thresholds}`
        : `Default OOTB thresholds: ${defaultThresholds}`;
      return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Analyze evaluation results in worksheet ${worksheetId}.

Steps:
1. get_worksheet_data for all columns and cells
2. Find Evaluation columns, compute pass/fail rates and score stats
3. Identify worst-performing rows and cross-failure patterns
4. Generate report: overall rates, top 5 failures, improvement suggestions
5. Compare to thresholds — ${thresholdText}`,
          },
        },
      ],
    };
    }
  );
}
