/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

/**
 * Centralized parameter validation for MCP tool handlers.
 *
 * Replaces ad-hoc `if (!param) return errorResponse(...)` checks scattered across
 * each action with a single `requireParam(...)` call. Tool handlers throw a
 * ValidationError, which the surrounding wrapper converts into an MCP-compliant
 * { isError: true } response.
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Asserts that `value` is present (not undefined, null, or empty string).
 * Throws ValidationError otherwise.
 */
export function requireParam<T>(
  value: T | undefined | null,
  name: string,
  action: string
): asserts value is T {
  if (value === undefined || value === null || value === "") {
    throw new ValidationError(`${name} is required for ${action}`);
  }
}

/**
 * Asserts that all named params are present. Convenience for actions with
 * multiple required params.
 */
export function requireParams(
  params: Record<string, unknown>,
  required: readonly string[],
  action: string
): void {
  for (const name of required) {
    requireParam(params[name], name, action);
  }
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/**
 * Wraps a tool handler so that ValidationError thrown via requireParam(...)
 * is converted to an MCP error response. Other errors continue to propagate
 * to the handler's own catch (which usually maps them with `Error: ${message}`).
 */
export function withValidation<Args extends unknown[]>(
  handler: (...args: Args) => Promise<ToolResult>
): (...args: Args) => Promise<ToolResult> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ValidationError) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
      throw error;
    }
  };
}