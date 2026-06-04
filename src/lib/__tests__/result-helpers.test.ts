import { describe, it, expect } from "vitest";
import {
  textResult,
  errorTextResult,
  jsonResult,
  errorResult,
} from "../result-helpers.js";

// ---------------------------------------------------------------------------
// Bucket E.1 (W-22703908): centralized tool-result helpers. These tests lock
// the MCP-protocol shape so any future contract change shows up as a test
// regression rather than silently diverging across tool files.
// ---------------------------------------------------------------------------

describe("Bucket E.1 — result-helpers shape", () => {
  describe("textResult", () => {
    it("wraps a plain string into the MCP content array, no isError", () => {
      const r = textResult("hello");
      expect(r).toEqual({ content: [{ type: "text", text: "hello" }] });
      expect("isError" in r).toBe(false);
    });
  });

  describe("errorTextResult", () => {
    it("wraps a plain string and sets isError: true", () => {
      const r = errorTextResult("something broke");
      expect(r).toEqual({
        content: [{ type: "text", text: "something broke" }],
        isError: true,
      });
    });
  });

  describe("jsonResult", () => {
    it("stringifies the data with 2-space indentation and no isError", () => {
      const r = jsonResult({ ok: true, count: 1 });
      expect(r.content).toEqual([
        { type: "text", text: JSON.stringify({ ok: true, count: 1 }, null, 2) },
      ]);
      expect("isError" in r).toBe(false);
    });

    it("handles arrays", () => {
      const r = jsonResult([1, 2, 3]);
      expect(r.content[0].text).toBe("[\n  1,\n  2,\n  3\n]");
    });

    it("handles null", () => {
      const r = jsonResult(null);
      expect(r.content[0].text).toBe("null");
    });
  });

  describe("errorResult", () => {
    it("formats an Error instance with the message", () => {
      const r = errorResult(new Error("boom"));
      expect(r).toEqual({
        content: [{ type: "text", text: "Error: boom" }],
        isError: true,
      });
    });

    it("stringifies non-Error values", () => {
      const r = errorResult("just a string");
      expect(r.content[0].text).toBe("Error: just a string");
      expect(r.isError).toBe(true);
    });

    it("falls back to String() for non-Error non-string", () => {
      const r = errorResult({ weird: "thing" });
      expect(r.content[0].text).toBe("Error: [object Object]");
      expect(r.isError).toBe(true);
    });
  });
});

describe("Bucket E.1 — column-helpers re-export", () => {
  it("column-helpers re-exports the same helpers (back-compat for column tools)", async () => {
    const ch = await import("../column-helpers.js");
    expect(typeof ch.textResult).toBe("function");
    expect(typeof ch.errorTextResult).toBe("function");
    expect(typeof ch.jsonResult).toBe("function");
    expect(typeof ch.errorResult).toBe("function");
  });
});