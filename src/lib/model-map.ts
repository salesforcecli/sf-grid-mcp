/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

/**
 * Model shorthand <-> full sfdc_ai__ ID mapping.
 * Shorthands defined in the Grid YAML DSL spec (Section 3).
 */

export const MODEL_SHORTHANDS: Record<string, string> = {
  "gpt-4-omni": "sfdc_ai__DefaultGPT4Omni",
  "gpt-4-omni-mini": "sfdc_ai__DefaultGPT4OmniMini",
  "gpt-4.1": "sfdc_ai__DefaultGPT41",
  "gpt-4.1-mini": "sfdc_ai__DefaultGPT41Mini",
  "gpt-5": "sfdc_ai__DefaultGPT5",
  "gpt-5-mini": "sfdc_ai__DefaultGPT5Mini",
  "o3": "sfdc_ai__DefaultO3",
  "o4-mini": "sfdc_ai__DefaultO4Mini",
  "claude-4.5-sonnet": "sfdc_ai__DefaultBedrockAnthropicClaude45Sonnet",
  "claude-4.5-haiku": "sfdc_ai__DefaultBedrockAnthropicClaude45Haiku",
  "claude-4-sonnet": "sfdc_ai__DefaultBedrockAnthropicClaude4Sonnet",
  "gemini-2.5-flash": "sfdc_ai__DefaultVertexAIGemini25Flash001",
  "gemini-2.5-flash-lite": "sfdc_ai__DefaultVertexAIGemini25FlashLite001",
  "gemini-2.5-pro": "sfdc_ai__DefaultVertexAIGeminiPro25",
  "nova-lite": "sfdc_ai__DefaultBedrockAmazonNovaLite",
  "nova-pro": "sfdc_ai__DefaultBedrockAmazonNovaPro",
  "gpt-5.1": "sfdc_ai__DefaultGPT51",
  "gpt-5.2": "sfdc_ai__DefaultGPT52",
  "claude-4.5-opus": "sfdc_ai__DefaultBedrockAnthropicClaude45Opus",
  "claude-4.6-sonnet": "sfdc_ai__DefaultBedrockAnthropicClaude46Sonnet",
};

/** Reverse map: full sfdc_ai__ ID -> shorthand */
const REVERSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(MODEL_SHORTHANDS).map(([short, full]) => [full, short])
);

/**
 * Resolve a model shorthand to a { modelId, modelName } pair.
 * If the input is already a full sfdc_ai__ ID, it is passed through unchanged.
 * Unrecognized names are also passed through as-is.
 *
 * modelName matches modelId (full sfdc_ai__ form) to match the UI's stored
 * config shape. Core's runtime extracts modelId for the LLM call, so modelName
 * is effectively metadata — but keeping it consistent with the UI avoids
 * spurious diffs between UI-added and MCP-added columns.
 */
export function resolveModelShorthand(shorthand: string): { modelId: string; modelName: string } {
  const fullId = MODEL_SHORTHANDS[shorthand] ?? shorthand;
  return { modelId: fullId, modelName: fullId };
}

/**
 * Reverse lookup: given a full sfdc_ai__ model ID, return its shorthand.
 * Returns undefined if the ID is not in the map.
 */
export function reverseModelMap(fullId: string): string | undefined {
  return REVERSE_MAP[fullId];
}
