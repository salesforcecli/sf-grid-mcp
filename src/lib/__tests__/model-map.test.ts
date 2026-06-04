import { describe, it, expect } from "vitest";
import {
  resolveModelShorthand,
  reverseModelMap,
  MODEL_SHORTHANDS,
} from "../model-map.js";

describe("resolveModelShorthand", () => {
  it("resolves known shorthands to sfdc_ai__ IDs (modelName matches modelId)", () => {
    const result = resolveModelShorthand("gpt-4-omni");
    expect(result.modelId).toBe("sfdc_ai__DefaultGPT4Omni");
    expect(result.modelName).toBe("sfdc_ai__DefaultGPT4Omni");
  });

  it("passes through full sfdc_ai__ IDs", () => {
    const result = resolveModelShorthand("sfdc_ai__DefaultGPT4Omni");
    expect(result.modelId).toBe("sfdc_ai__DefaultGPT4Omni");
    expect(result.modelName).toBe("sfdc_ai__DefaultGPT4Omni");
  });

  it("passes through unrecognized names as-is", () => {
    const result = resolveModelShorthand("custom-model-xyz");
    expect(result.modelId).toBe("custom-model-xyz");
    expect(result.modelName).toBe("custom-model-xyz");
  });

  it("resolves all shorthands in the map (modelName equals modelId)", () => {
    for (const [shorthand, fullId] of Object.entries(MODEL_SHORTHANDS)) {
      const result = resolveModelShorthand(shorthand);
      expect(result.modelId).toBe(fullId);
      expect(result.modelName).toBe(fullId);
    }
  });
});

describe("reverseModelMap", () => {
  it("returns shorthand for known full IDs", () => {
    expect(reverseModelMap("sfdc_ai__DefaultGPT4Omni")).toBe("gpt-4-omni");
  });

  it("returns undefined for unknown IDs", () => {
    expect(reverseModelMap("sfdc_ai__UnknownModel")).toBeUndefined();
  });

  it("reverse lookup works for all entries", () => {
    for (const [shorthand, fullId] of Object.entries(MODEL_SHORTHANDS)) {
      expect(reverseModelMap(fullId)).toBe(shorthand);
    }
  });
});
