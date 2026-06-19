/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

/**
 * MCP resource for the Grid YAML DSL reference documentation.
 *   - grid://schema/dsl  (static / infinite TTL)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MODEL_SHORTHANDS } from "../lib/model-map.js";
import { DSL_TYPE_MAP, EVAL_TYPE_MAP } from "../lib/yaml-parser.js";

const DSL_REFERENCE = {
  title: "Grid YAML DSL Reference",
  description: "Declarative YAML syntax for defining Grid worksheets with columns, data, and evaluations. Processed by the apply_grid tool.",

  syntax: {
    topLevel: {
      workbook: "string (required) - Name of the workbook to create or target",
      worksheet: "string (required) - Name of the worksheet to create or target",
      numberOfRows: "number (optional) - Default row count for columns that import data",
      model: "string (optional) - Default LLM model shorthand for AI/PromptTemplate columns",
      columns: "list (required) - Array of column definitions",
      data: "map (optional) - Column name -> list of values to paste into Text columns",
    },
    columnFields: {
      name: "string (required) - Column display name",
      type: "string (required) - Column type (see typeMap below)",
      "...": "Type-specific fields (see examples below)",
    },
    placeholders: {
      description: "Use {ColumnName} in instruction/utterance/formula fields to reference other columns. The DSL engine rewrites these to {$N} with proper referenceAttributes.",
      fieldReferences: "Use {ColumnName.fieldName} to reference a specific field within a column's output.",
    },
  },

  typeMap: DSL_TYPE_MAP,
  evalShorthands: EVAL_TYPE_MAP,
  modelShorthands: MODEL_SHORTHANDS,

  examples: {
    text: {
      description: "Manual data entry column",
      yaml: `- name: Utterances
  type: text`,
    },
    ai: {
      description: "LLM-powered column with column references",
      yaml: `- name: Summary
  type: ai
  model: gpt-4-omni
  instruction: "Summarize this text: {Input}"
  responseFormat: plain_text`,
    },
    ai_single_select: {
      description: "AI column with single-select output",
      yaml: `- name: Sentiment
  type: ai
  instruction: "Classify the sentiment of: {Input}"
  responseFormat:
    type: single_select
    options:
      - Positive
      - Negative
      - Neutral`,
    },
    object: {
      description: "Salesforce object query column",
      yaml: `- name: Accounts
  type: object
  object: Account
  fields:
    - Name
    - Industry
  filters:
    - field: Industry
      operator: eq
      values: [Technology]`,
    },
    data_model_object: {
      description: "Data Cloud DMO query column",
      yaml: `- name: Contacts
  type: data_model_object
  dmo: ContactDMO__dlm
  dataspace: default
  fields:
    - FirstName__c
    - LastName__c`,
    },
    agent: {
      description: "Agent invocation column (agent name resolved to ID by apply_grid)",
      yaml: `- name: Agent Response
  type: agent
  agent: "Sales Coach"
  utterance: "Help me with {Topic}"
  contextVariables:
    region: "US-West"
    accountName: "{Accounts.Name}"`,
    },
    agent_test: {
      description: "Agent testing column (agent name resolved to ID by apply_grid)",
      yaml: `- name: Agent Output
  type: agent_test
  agent: "Sales Coach"
  inputUtterance: Utterances
  isDraft: false`,
    },
    evaluation: {
      description: "Evaluation column using eval/* shorthands",
      yaml: `- name: Coherence Score
  type: eval/coherence
  input: Agent Output`,
    },
    evaluation_with_reference: {
      description: "Reference-based evaluation",
      yaml: `- name: Topic Check
  type: eval/topic_assertion
  input: Agent Output
  reference: Expected Response`,
    },
    evaluation_expression: {
      description: "Expression-based evaluation",
      yaml: `- name: Latency Check
  type: eval/expression
  input: Agent Output
  formula: "{json.latency} < 5000"
  returnType: boolean`,
    },
    reference: {
      description: "Extract a specific field from another column's output",
      yaml: `- name: Bot Reply
  type: reference
  source: Agent Output
  field: botResponse`,
    },
    formula: {
      description: "Formula column with column references",
      yaml: `- name: Length
  type: formula
  formula: "LEN({Input})"`,
    },
    prompt_template: {
      description: "Prompt template column",
      yaml: `- name: Generated
  type: prompt_template
  template: My_Prompt_Template
  model: gpt-4-omni
  inputs:
    input1: "{Source}"`,
    },
    invocable_action: {
      description: "Invocable action (Flow, Apex, etc.)",
      yaml: `- name: Flow Result
  type: invocable_action
  action:
    name: myFlow
    type: FLOW
  payload:
    input: "{Data}"`,
    },
    action: {
      description: "CRM action (create/update records)",
      yaml: `- name: Create Case
  type: action
  actionName: create
  inputs:
    Subject: "{Summary}"
    Priority: "High"`,
    },
  },

  fullExample: `workbook: Agent Test Suite
worksheet: Tests
model: gpt-4-omni

columns:
  - name: Utterances
    type: text

  - name: Agent Output
    type: agent_test
    agentId: "0XxRM000000xxxxx"
    agentVersion: "0XyRM000000xxxxx"
    inputUtterance: Utterances

  - name: Bot Reply
    type: reference
    source: Agent Output
    field: botResponse

  - name: Coherence
    type: eval/coherence
    input: Agent Output

  - name: Topic Check
    type: eval/topic_assertion
    input: Agent Output
    reference: Expected Response

data:
  Utterances:
    - "Hello, I need help"
    - "What is my order status?"
    - "Cancel my subscription"`,

  filterOperatorShorthands: {
    eq: "EQUAL_TO",
    neq: "NOT_EQUAL_TO",
    in: "IN",
    not_in: "NOT_IN",
    contains: "CONTAINS",
    starts_with: "STARTS_WITH",
    ends_with: "ENDS_WITH",
    is_null: "IS_NULL",
    is_not_null: "IS_NOT_NULL",
    lt: "LESS_THAN",
    lte: "LESS_THAN_OR_EQUAL_TO",
    gt: "GREATER_THAN",
    gte: "GREATER_THAN_OR_EQUAL_TO",
  },
};

export function registerDslResource(server: McpServer): void {
  server.resource(
    "dsl-reference",
    "grid://schema/dsl",
    { description: "Grid YAML DSL reference documentation with syntax, all 12 column type examples, and shorthand model names", mimeType: "application/json" },
    async (uri) => {
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json" as const,
          text: JSON.stringify(DSL_REFERENCE, null, 2),
        }],
      };
    },
  );
}
