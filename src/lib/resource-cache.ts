/**
 * Simple TTL-based cache for MCP resources.
 */

interface CacheEntry {
  data: any;
  expiresAt: number;
}

export class ResourceCache {
  private store = new Map<string, CacheEntry>();
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  /**
   * Get a cached value by key. Returns null if missing or expired.
   */
  get(key: string): any | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  /**
   * Set a cached value with a TTL in milliseconds.
   */
  set(key: string, data: any, ttlMs: number): void {
    if (this.store.size >= this.maxSize) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Invalidate (remove) a cached entry by key.
   */
  invalidate(key: string): void {
    this.store.delete(key);
  }
}
