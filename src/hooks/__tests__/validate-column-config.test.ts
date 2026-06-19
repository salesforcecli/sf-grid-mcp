/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

import { describe, it, expect } from 'vitest';
import {
  validate,
  checkMissingNestedConfig,
  checkTypeMismatch,
  checkQueryResponseFormat,
  checkReferenceAttributesColumnType,
  checkMissingModelConfig,
  checkModelConfigFields,
  checkAIColumnModeAndResponseFormat,
  checkContextVariableBothValueAndReference,
} from '../validate-column-config.js';

// ---------------------------------------------------------------------------
// Helper to build hook input
// ---------------------------------------------------------------------------

function hookInput(
  toolName: string,
  type: string | undefined,
  config: Record<string, unknown> | string,
) {
  return {
    tool_name: toolName,
    tool_input: { type, config },
  };
}

const TOOL = 'mcp__grid-connect__add_column';

// ---------------------------------------------------------------------------
// Pass-through: non-applicable tools
// ---------------------------------------------------------------------------

describe('non-applicable tools', () => {
  it('returns no errors for unrelated tools', () => {
    const errors = validate({
      tool_name: 'mcp__grid-connect__get_workbooks',
      tool_input: { config: '{}' },
    });
    expect(errors).toEqual([]);
  });

  it('returns no errors when tool_input is missing', () => {
    const errors = validate({ tool_name: TOOL });
    expect(errors).toEqual([]);
  });

  it('returns no errors when config is missing', () => {
    const errors = validate({ tool_name: TOOL, tool_input: { type: 'AI' } });
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Config as JSON string vs object
// ---------------------------------------------------------------------------

describe('config as JSON string', () => {
  it('parses config when provided as a JSON string', () => {
    const config = JSON.stringify({
      type: 'Ai',
      config: { mode: 'llm', responseFormat: { type: 'PLAIN_TEXT' }, modelConfig: { modelId: 'x', modelName: 'x' } },
    });
    const errors = validate(hookInput(TOOL, 'AI', config));
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Check 1: Missing nested config.config
// ---------------------------------------------------------------------------

describe('Check 1: missing nested config.config', () => {
  it('blocks when config.config is missing for non-Text type', () => {
    const err = checkMissingNestedConfig('AI', { type: 'AI' });
    expect(err).toContain('Missing nested config.config');
  });

  it('allows Text columns without config.config', () => {
    const err = checkMissingNestedConfig('Text', { type: 'Text' });
    expect(err).toBeNull();
  });

  it('allows when config.config is present', () => {
    const err = checkMissingNestedConfig('AI', { type: 'AI', config: { mode: 'llm' } });
    expect(err).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Check 2: Type field mismatch
// ---------------------------------------------------------------------------

describe('Check 2: type mismatch', () => {
  it('blocks when config.type is missing', () => {
    const err = checkTypeMismatch('AI', { config: {} });
    expect(err).toContain('config.type is missing');
  });

  it('blocks when types do not match', () => {
    const err = checkTypeMismatch('AI', { type: 'Formula', config: {} });
    expect(err).toContain('Type mismatch');
  });

  it('allows when types match', () => {
    const err = checkTypeMismatch('AI', { type: 'AI', config: {} });
    expect(err).toBeNull();
  });

  it('allows when no top-level type and config.type exists', () => {
    const err = checkTypeMismatch(undefined, { type: 'AI', config: {} });
    expect(err).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Check 3: queryResponseFormat must be an object
// ---------------------------------------------------------------------------

describe('Check 3: queryResponseFormat', () => {
  it('blocks bare string', () => {
    const err = checkQueryResponseFormat({ queryResponseFormat: 'EACH_ROW' });
    expect(err).toContain('must be an object');
    expect(err).toContain('EACH_ROW');
  });

  it('allows object', () => {
    const err = checkQueryResponseFormat({ queryResponseFormat: { type: 'EACH_ROW' } });
    expect(err).toBeNull();
  });

  it('allows when absent', () => {
    const err = checkQueryResponseFormat({});
    expect(err).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Check 4: referenceAttributes columnType PascalCase
// ---------------------------------------------------------------------------

describe('Check 4: columnType PascalCase', () => {
  it('allows UPPER_CASE (API returns this)', () => {
    const err = checkReferenceAttributesColumnType({
      referenceAttributes: { columnType: 'TEXT' },
    });
    expect(err).toBeNull();
  });

  it('allows UPPER_SNAKE_CASE (API returns this)', () => {
    const err = checkReferenceAttributesColumnType({
      referenceAttributes: { columnType: 'AGENT_TEST' },
    });
    expect(err).toBeNull();
  });

  it('allows PascalCase AgentTest', () => {
    const err = checkReferenceAttributesColumnType({
      referenceAttributes: { columnType: 'AgentTest' },
    });
    expect(err).toBeNull();
  });

  it('allows AI (canonical API value)', () => {
    const err = checkReferenceAttributesColumnType({
      referenceAttributes: { columnType: 'AI' },
    });
    expect(err).toBeNull();
  });

  it('allows Ai (Connect API variant)', () => {
    const err = checkReferenceAttributesColumnType({
      referenceAttributes: { columnType: 'Ai' },
    });
    expect(err).toBeNull();
  });

  it('blocks lowercase', () => {
    const err = checkReferenceAttributesColumnType({
      referenceAttributes: { columnType: 'text' },
    });
    expect(err).toContain('not a recognized column type');
  });

  it('allows PascalCase PromptTemplate', () => {
    const err = checkReferenceAttributesColumnType({
      referenceAttributes: { columnType: 'PromptTemplate' },
    });
    expect(err).toBeNull();
  });

  it('allows PascalCase Object', () => {
    const err = checkReferenceAttributesColumnType({
      referenceAttributes: { columnType: 'Object' },
    });
    expect(err).toBeNull();
  });

  it('blocks lowercase agenttest', () => {
    const err = checkReferenceAttributesColumnType({
      referenceAttributes: { columnType: 'agenttest' },
    });
    expect(err).toContain('not a recognized column type');
  });

  it('allows when absent', () => {
    const err = checkReferenceAttributesColumnType({});
    expect(err).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Check 5: Missing modelConfig on AI / PromptTemplate
// ---------------------------------------------------------------------------

describe('Check 5: missing modelConfig', () => {
  it('blocks Ai without modelConfig', () => {
    const err = checkMissingModelConfig('AI', { mode: 'llm' });
    expect(err).toContain('missing modelConfig');
  });

  it('blocks PromptTemplate without modelConfig', () => {
    const err = checkMissingModelConfig('PromptTemplate', {});
    expect(err).toContain('missing modelConfig');
  });

  it('allows Ai with modelConfig', () => {
    const err = checkMissingModelConfig('AI', { modelConfig: { modelId: 'x', modelName: 'x' } });
    expect(err).toBeNull();
  });

  it('allows Formula (no modelConfig needed)', () => {
    const err = checkMissingModelConfig('Formula', {});
    expect(err).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Check 6: modelConfig invalid fields
// ---------------------------------------------------------------------------

describe('Check 6: modelConfig fields', () => {
  it('blocks extra fields like maxOutputTokens', () => {
    const err = checkModelConfigFields({
      modelConfig: { modelId: 'x', modelName: 'x', maxOutputTokens: 2048 },
    });
    expect(err).toContain('maxOutputTokens');
  });

  it('blocks temperature', () => {
    const err = checkModelConfigFields({
      modelConfig: { modelId: 'x', modelName: 'x', temperature: 0.7 },
    });
    expect(err).toContain('temperature');
  });

  it('allows valid modelConfig', () => {
    const err = checkModelConfigFields({
      modelConfig: { modelId: 'x', modelName: 'x' },
    });
    expect(err).toBeNull();
  });

  it('allows when no modelConfig', () => {
    const err = checkModelConfigFields({});
    expect(err).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Check 7: AI column missing mode / responseFormat
// ---------------------------------------------------------------------------

describe('Check 7: Ai mode and responseFormat', () => {
  it('blocks when mode is missing', () => {
    const err = checkAIColumnModeAndResponseFormat('AI', {
      responseFormat: { type: 'PLAIN_TEXT' },
    });
    expect(err).toContain('mode');
  });

  it('blocks when responseFormat is missing', () => {
    const err = checkAIColumnModeAndResponseFormat('AI', { mode: 'llm' });
    expect(err).toContain('responseFormat');
  });

  it('blocks when both are missing', () => {
    const err = checkAIColumnModeAndResponseFormat('AI', {});
    expect(err).toContain('mode');
    expect(err).toContain('responseFormat');
  });

  it('allows valid Ai config', () => {
    const err = checkAIColumnModeAndResponseFormat('AI', {
      mode: 'llm',
      responseFormat: { type: 'PLAIN_TEXT' },
    });
    expect(err).toBeNull();
  });

  it('skips non-Ai types', () => {
    const err = checkAIColumnModeAndResponseFormat('Formula', {});
    expect(err).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Check 8: contextVariable with both value and reference
// ---------------------------------------------------------------------------

describe('Check 8: contextVariable value+reference', () => {
  it('blocks when both value and reference are set', () => {
    const err = checkContextVariableBothValueAndReference({
      contextVariables: [{ value: 'hello', reference: 'col1' }],
    });
    expect(err).toContain('both "value" AND "reference"');
  });

  it('allows value only', () => {
    const err = checkContextVariableBothValueAndReference({
      contextVariables: [{ value: 'hello' }],
    });
    expect(err).toBeNull();
  });

  it('allows reference only', () => {
    const err = checkContextVariableBothValueAndReference({
      contextVariables: [{ reference: 'col1' }],
    });
    expect(err).toBeNull();
  });

  it('allows when no contextVariables', () => {
    const err = checkContextVariableBothValueAndReference({});
    expect(err).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration: full validate() with multiple errors
// ---------------------------------------------------------------------------

describe('validate() integration', () => {
  it('returns multiple errors for a bad Ai config', () => {
    const errors = validate(
      hookInput(TOOL, 'AI', {
        type: 'Ai',
        config: {
          queryResponseFormat: 'EACH_ROW',
          referenceAttributes: { columnType: 'AGENT_TEST' },
        },
      }),
    );
    // Should catch: queryResponseFormat, missing modelConfig, missing mode+responseFormat
    // (AGENT_TEST is now a valid columnType since the API returns UPPER_CASE)
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it('returns no errors for a valid Ai config', () => {
    const errors = validate(
      hookInput(TOOL, 'AI', {
        type: 'Ai',
        config: {
          mode: 'llm',
          responseFormat: { type: 'PLAIN_TEXT' },
          modelConfig: { modelId: 'sfdc_ai__DefaultGPT4Omni', modelName: 'sfdc_ai__DefaultGPT4Omni' },
        },
      }),
    );
    expect(errors).toEqual([]);
  });

  it('returns no errors for a valid Text config (no nested config needed)', () => {
    const errors = validate(
      hookInput(TOOL, 'Text', { type: 'Text' }),
    );
    expect(errors).toEqual([]);
  });

  it('works with all four applicable tools', () => {
    const tools = [
      'mcp__grid-connect__add_column',
      'mcp__grid-connect__edit_column',
      'mcp__grid-connect__save_column',
      'mcp__grid-connect__reprocess_column',
    ];
    for (const tool of tools) {
      const errors = validate(
        hookInput(tool, 'Ai', { type: 'AI', config: {} }),
      );
      // Should at least catch missing modelConfig and missing mode/responseFormat
      expect(errors.length).toBeGreaterThan(0);
    }
  });
});
