/**
 * Tool-result helpers used across all MCP tools to keep MCP-protocol
 * shape (`{ content: [{ type: "text", text }], isError? }`) consistent.
 *
 * Re-exported from {@link ./column-helpers.ts} for back-compat — that
 * file owned these helpers historically when only column tools needed
 * them. Prefer importing from `result-helpers` going forward.
 */

export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function errorTextResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

export function jsonResult(data: unknown) {
  return textResult(JSON.stringify(data, null, 2));
}

export function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return errorTextResult(`Error: ${message}`);
}