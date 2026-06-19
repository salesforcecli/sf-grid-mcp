/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

/**
 * PreToolUse validation hook for column config mutations.
 *
 * Reads the Claude Code hook JSON from stdin, validates the tool_input
 * config against the 8 most common API mistakes, and exits:
 *   0 — allow (no issues or non-applicable tool)
 *   2 — block (validation errors found)
 *
 * This file is standalone — no imports from the rest of the project.
 */

// ---------------------------------------------------------------------------
// Types (local, minimal)
// ---------------------------------------------------------------------------

interface HookInput {
  tool_name?: string;
  tool_input?: {
    type?: string;
    config?: string | Record<string, unknown>;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APPLICABLE_TOOLS = [
  'mcp__grid-connect__add_column',
  'mcp__grid-connect__edit_column',
  'mcp__grid-connect__save_column',
  'mcp__grid-connect__reprocess_column',
];

// The API accepts both PascalCase and UPPER_CASE for columnType, and returns
// UPPER_CASE in responses. We accept both to avoid blocking round-tripped configs.
const VALID_COLUMN_TYPES = new Set([
  // PascalCase (canonical input format — AI is the API value, Ai is the Connect API variant)
  'AI', 'Ai', 'Agent', 'AgentTest', 'Formula', 'Object', 'PromptTemplate',
  'Action', 'InvocableAction', 'Reference', 'Text', 'Evaluation', 'DataModelObject',
  // UPPER_CASE (returned by API in referenceAttributes)
  'AGENT', 'AGENT_TEST', 'FORMULA', 'OBJECT', 'PROMPT_TEMPLATE',
  'ACTION', 'INVOCABLE_ACTION', 'REFERENCE', 'TEXT', 'EVALUATION', 'DATA_MODEL_OBJECT',
]);

const MODEL_CONFIG_ALLOWED_KEYS = new Set(['modelId', 'modelName']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseConfig(raw: string | Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validation checks — each returns an error string or null
// ---------------------------------------------------------------------------

export function checkMissingNestedConfig(
  topType: string | undefined,
  config: Record<string, unknown>,
): string | null {
  const innerConfig = config.config;
  const type = config.type ?? topType;
  if (type === 'Text') return null;
  if (innerConfig == null || typeof innerConfig !== 'object') {
    return `Missing nested config.config structure. Column configs must be {type, config: {…}} — two levels.`;
  }
  return null;
}

export function checkTypeMismatch(
  topType: string | undefined,
  config: Record<string, unknown>,
): string | null {
  if (!config.type) {
    return `config.type is missing — it must be present inside the config object.`;
  }
  if (topType && String(config.type).toLowerCase() !== topType.toLowerCase()) {
    return `Type mismatch: top-level type "${topType}" does not match config.type "${config.type}".`;
  }
  return null;
}

export function checkQueryResponseFormat(
  inner: Record<string, unknown> | null,
): string | null {
  if (!inner) return null;
  const qrf = inner.queryResponseFormat;
  if (qrf == null) return null;
  if (typeof qrf === 'string') {
    return `queryResponseFormat must be an object {"type": "${qrf}"}, not a bare string "${qrf}".`;
  }
  return null;
}

export function checkReferenceAttributesColumnType(
  inner: Record<string, unknown> | null,
): string | null {
  if (!inner) return null;
  const refAttrs = inner.referenceAttributes as Record<string, unknown> | undefined;
  if (!refAttrs) return null;
  const ct = refAttrs.columnType;
  if (typeof ct !== 'string') return null;
  if (!VALID_COLUMN_TYPES.has(ct)) {
    return `referenceAttributes.columnType "${ct}" is not a recognized column type. Use PascalCase (AI, Object, AgentTest, etc.) or UPPER_CASE (OBJECT, AGENT_TEST, etc.).`;
  }
  return null;
}

export function checkMissingModelConfig(
  configType: string | undefined,
  inner: Record<string, unknown> | null,
): string | null {
  if (!inner) return null;
  const type = configType;
  if (type !== 'AI' && type !== 'Ai' && type !== 'PromptTemplate') return null;
  if (!inner.modelConfig) {
    return `${type} column missing modelConfig. Add: {"modelId": "sfdc_ai__DefaultGPT4Omni", "modelName": "sfdc_ai__DefaultGPT4Omni"}.`;
  }
  return null;
}

export function checkModelConfigFields(
  inner: Record<string, unknown> | null,
): string | null {
  if (!inner) return null;
  const mc = inner.modelConfig;
  if (mc == null || typeof mc !== 'object') return null;
  const extra = Object.keys(mc as Record<string, unknown>).filter(
    (k) => !MODEL_CONFIG_ALLOWED_KEYS.has(k),
  );
  if (extra.length > 0) {
    return `modelConfig contains invalid fields: ${extra.join(', ')}. Only modelId and modelName are allowed.`;
  }
  return null;
}

export function checkAIColumnModeAndResponseFormat(
  configType: string | undefined,
  inner: Record<string, unknown> | null,
): string | null {
  if (configType !== 'AI' && configType !== 'Ai') return null;
  if (!inner) return null;
  const errors: string[] = [];
  if (inner.mode !== 'llm') {
    errors.push(`AI column missing "mode": "llm" in config.config.`);
  }
  const rf = inner.responseFormat;
  if (rf == null || typeof rf !== 'object') {
    errors.push(`AI column missing responseFormat. Add: {"type": "PLAIN_TEXT"}.`);
  }
  return errors.length > 0 ? errors.join(' ') : null;
}

export function checkContextVariableBothValueAndReference(
  inner: Record<string, unknown> | null,
): string | null {
  if (!inner) return null;
  const cvs = inner.contextVariables;
  if (!Array.isArray(cvs)) return null;
  const bad: number[] = [];
  cvs.forEach((cv: Record<string, unknown>, i: number) => {
    if (cv && cv.value != null && cv.reference != null) {
      bad.push(i);
    }
  });
  if (bad.length > 0) {
    return `contextVariable(s) at index ${bad.join(', ')} have both "value" AND "reference" — each must have one or the other, not both.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main validation orchestrator (exported for tests)
// ---------------------------------------------------------------------------

export function validate(input: HookInput): string[] {
  const toolName = input.tool_name ?? '';
  if (!APPLICABLE_TOOLS.includes(toolName)) return [];

  const toolInput = input.tool_input;
  if (!toolInput) return [];

  const config = parseConfig(toolInput.config);
  if (!config) return [];

  const topType = (toolInput.type as string | undefined) ?? (config.type as string | undefined);
  const configType = (config.type as string | undefined) ?? topType;

  // Inner config (config.config)
  let inner: Record<string, unknown> | null = null;
  if (config.config != null && typeof config.config === 'object') {
    inner = config.config as Record<string, unknown>;
  }

  const checks = [
    checkMissingNestedConfig(topType, config),
    checkTypeMismatch(topType, config),
    checkQueryResponseFormat(inner),
    checkReferenceAttributesColumnType(inner),
    checkMissingModelConfig(configType, inner),
    checkModelConfigFields(inner),
    checkAIColumnModeAndResponseFormat(configType, inner),
    checkContextVariableBothValueAndReference(inner),
  ];

  return checks.filter((e): e is string => e !== null);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    if (!raw) process.exit(0);

    let input: HookInput;
    try {
      input = JSON.parse(raw) as HookInput;
    } catch {
      // Can't parse — don't block
      process.exit(0);
    }

    const errors = validate(input);
    if (errors.length === 0) {
      process.exit(0);
    }

    const numbered = errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n');
    process.stderr.write(
      `Column config validation failed:\n\n${numbered}\n\nFix these issues before calling the tool.\n`,
    );
    process.exit(2);
  } catch {
    // Defensive: never block on hook errors
    process.exit(0);
  }
}

main();
