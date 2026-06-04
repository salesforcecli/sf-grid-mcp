/**
 * Singleton cache for column configs.
 *
 * The Grid API returns `config: {}` for columns in worksheet data responses,
 * making read-modify-write impossible. This cache stores the full outer config
 * object (with nested `config`) at creation time so typed mutation tools can
 * read it back later in the same session.
 *
 * Keyed by columnId. No TTL — entries persist for the lifetime of the process
 * and are explicitly set/invalidated.
 */

export class ColumnConfigCache {
  private store = new Map<string, any>();

  /** Retrieve the cached outer config for a column, or undefined. */
  get(columnId: string): any | undefined {
    return this.store.get(columnId);
  }

  /** Store the full outer config for a column. */
  set(columnId: string, config: any): void {
    this.store.set(columnId, config);
  }

  /** Remove a cached entry (e.g., after column deletion). */
  invalidate(columnId: string): void {
    this.store.delete(columnId);
  }

  /** Number of cached entries (useful for diagnostics). */
  get size(): number {
    return this.store.size;
  }
}

/** Singleton instance shared across the process. */
export const configCache = new ColumnConfigCache();
