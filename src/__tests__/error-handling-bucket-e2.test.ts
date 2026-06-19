/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GridClient } from "../client.js";

// ---------------------------------------------------------------------------
// Bucket E.2 (W-22711273): retry policy hardening + apply_grid partial-failure
// isError surfacing. Parse-error surfacing is exercised indirectly via the
// column-mutation handlers (their error paths now include the underlying
// JSON.parse error message); this file focuses on the testable units.
// ---------------------------------------------------------------------------

// Helper to expose private classifyError / backoffMs on the GridClient.
// The functions are private but functionally pure, so we cast through any.
function classify(client: GridClient, msg: string): string | null {
  return (client as any).classifyError(msg);
}

function backoffMs(client: GridClient, attempt: number, baseMs?: number): number {
  return (client as any).backoffMs(attempt, baseMs);
}

let client: GridClient;
beforeEach(() => {
  client = new GridClient({ orgAlias: "test-org" });
});

describe("Bucket E.2 — classifyError (retry classification)", () => {
  describe("rate-limit category", () => {
    it("matches anchored HTTP 429", () => {
      expect(classify(client, "HTTP 429: too many requests")).toBe("rate-limit");
    });

    it("matches Salesforce REQUEST_LIMIT_EXCEEDED errorCode", () => {
      expect(
        classify(client, 'HTTP error: {"errorCode":"REQUEST_LIMIT_EXCEEDED","message":"x"}'),
      ).toBe("rate-limit");
    });

    it("matches the phrase 'rate limit'", () => {
      expect(classify(client, "rate limit exceeded")).toBe("rate-limit");
    });

    it("matches the phrase 'rate-limit' (hyphenated)", () => {
      expect(classify(client, "rate-limit hit")).toBe("rate-limit");
    });
  });

  describe("server-error category (5xx)", () => {
    it("matches HTTP 503 in HTTP-shape context", () => {
      expect(classify(client, "HTTP 503: service unavailable")).toBe("server-error");
    });

    it("matches HTTP 500 in HTTP error wrapper", () => {
      expect(classify(client, 'HTTP error: {"status":500}')).toBe("server-error");
    });

    it("does NOT false-positive on a column ID that contains '503'", () => {
      // Pre-fix: /5\d{2}/ regex would match '503' here. Post-fix: must not.
      expect(classify(client, 'Column ID 1W7xx0000004C503YAE not found')).toBeNull();
    });

    it("does NOT false-positive on a row ID with '500' embedded", () => {
      expect(classify(client, "Row 1W6xx0000004C500ABC error")).toBeNull();
    });
  });

  describe("network category", () => {
    it("matches ETIMEDOUT", () => {
      expect(classify(client, "request failed with ETIMEDOUT")).toBe("network");
    });

    it("matches ECONNRESET", () => {
      expect(classify(client, "ECONNRESET on socket")).toBe("network");
    });

    it("matches 'timed out'", () => {
      expect(classify(client, "the call timed out after 60s")).toBe("network");
    });

    it("matches ENOTFOUND (DNS)", () => {
      expect(classify(client, "ENOTFOUND orgfarm.example.com")).toBe("network");
    });

    it("matches ECONNREFUSED", () => {
      expect(classify(client, "ECONNREFUSED 127.0.0.1:6101")).toBe("network");
    });
  });

  describe("non-retryable", () => {
    it("returns null for HTTP 400", () => {
      expect(classify(client, "HTTP 400: bad request")).toBeNull();
    });

    it("returns null for HTTP 404", () => {
      expect(classify(client, "HTTP 404: not found")).toBeNull();
    });

    it("returns null for arbitrary errors", () => {
      expect(classify(client, "validation failed: missing field")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(classify(client, "")).toBeNull();
    });
  });
});

describe("Bucket E.2 — backoffMs (jitter)", () => {
  it("returns a non-negative integer at attempt 0", () => {
    const ms = backoffMs(client, 0, 1000);
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThanOrEqual(1000);
    expect(Number.isInteger(ms)).toBe(true);
  });

  it("caps grow exponentially with attempt", () => {
    // attempt 3: cap = 1000 * 2^3 = 8000ms
    const ms = backoffMs(client, 3, 1000);
    expect(ms).toBeLessThanOrEqual(8000);
  });

  it("produces variance across calls (not deterministic)", () => {
    // Spy on Math.random to verify it IS called (the variance source)
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const ms = backoffMs(client, 2, 1000);
    expect(spy).toHaveBeenCalled();
    expect(ms).toBe(Math.floor(0.5 * 4000)); // 0.5 * (1000 * 2^2)
    spy.mockRestore();
  });
});