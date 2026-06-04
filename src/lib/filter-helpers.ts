/**
 * Filter value normalization for Object / DataModelObject column filters.
 *
 * Core's filter schema requires each value in `filters[].values[]` to be an
 * object of shape `{value, type, referenceAttribute?, referenceAttributes?}`.
 * Callers commonly pass scalar JS values (strings, numbers, booleans). Without
 * normalization, Core returns HTTP 500 with
 *   "$.config.filters[i].values[j]: string found, object expected"
 *
 * This helper wraps scalars and leaves already-wrapped objects unchanged.
 */

type ScalarType = "STRING" | "INTEGER" | "DOUBLE" | "BOOLEAN";

export interface NormalizedFilterValue {
  value: unknown;
  type?: ScalarType;
  referenceAttribute?: unknown;
  referenceAttributes?: unknown;
}

export interface FilterCondition {
  field: string;
  operator: string;
  values?: unknown[];
}

function inferType(v: unknown): ScalarType | undefined {
  if (typeof v === "string") return "STRING";
  if (typeof v === "boolean") return "BOOLEAN";
  if (typeof v === "number") return Number.isInteger(v) ? "INTEGER" : "DOUBLE";
  return undefined;
}

function isWrapped(v: unknown): v is NormalizedFilterValue {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    ("value" in v || "referenceAttribute" in v || "referenceAttributes" in v)
  );
}

export function normalizeFilterValue(v: unknown): NormalizedFilterValue {
  if (isWrapped(v)) return v;
  const t = inferType(v);
  return t ? { value: v, type: t } : { value: v };
}

export function normalizeFilterValues(values: unknown[] | undefined): NormalizedFilterValue[] | undefined {
  if (!values) return values;
  return values.map(normalizeFilterValue);
}

export function normalizeFilters<T extends FilterCondition>(filters: T[] | undefined): T[] | undefined {
  if (!filters) return filters;
  return filters.map((f) => ({ ...f, values: normalizeFilterValues(f.values) })) as T[];
}

/**
 * Normalize filter values inside a column config wrapper. Mutates a deep copy
 * and returns it. Safe to call on any config shape — only Object/DataModelObject
 * inner configs carry `filters`, all others pass through untouched.
 *
 * Accepts both:
 *   - outer-only shape: { type, queryResponseFormat?, autoUpdate?, config: { filters?, ... } }
 *   - add-shape:        { name, type, config: { ...outer-shape... } }
 */
export function normalizeColumnConfigFilters<T>(config: T): T {
  if (!config || typeof config !== "object") return config;
  const cloned = JSON.parse(JSON.stringify(config));
  // Find the inner config that may carry filters. Try the two known shapes.
  const inner = cloned?.config?.config ?? cloned?.config ?? cloned;
  if (inner && typeof inner === "object" && Array.isArray(inner.filters)) {
    inner.filters = normalizeFilters(inner.filters);
  }
  return cloned;
}