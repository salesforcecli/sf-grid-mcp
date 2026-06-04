import { execSync } from "node:child_process";

export interface GridClientConfig {
  instanceUrl?: string;
  orgAlias?: string;
  apiVersion?: string;
  timeoutMs?: number;
}

interface SfApiResponse {
  status: number;
  result?: any;
  message?: string;
  warnings?: string[];
}

export class GridClient {
  private config: GridClientConfig;
  private basePath: string;
  private timeoutMs: number;

  constructor(config: GridClientConfig) {
    this.config = config;
    const version = config.apiVersion ?? "v66.0";
    this.basePath = `/services/data/${version}/public/grid`;
    this.timeoutMs = config.timeoutMs ?? 60000;
  }

  /** Derive the Lightning Experience base URL from the instance URL. Throws if instanceUrl is not configured. */
  get lightningBaseUrl(): string {
    if (!this.config.instanceUrl) {
      throw new Error("instanceUrl is required to generate Lightning Experience URLs. Please set INSTANCE_URL environment variable.");
    }
    return this.config.instanceUrl
      .replace(".my.salesforce-com.", ".lightning.force-com.")
      .replace(".my.salesforce.com", ".lightning.force.com");
  }

  private debug(msg: string): void {
    if (process.env.GRID_DEBUG === "true") {
      process.stderr.write(`[GridClient] ${msg}\n`);
    }
  }

  private async sfApiRequest(
    method: string,
    path: string,
    body?: unknown
  ): Promise<any> {
    const startTime = Date.now();

    // Build the sf api request command
    let cmd = `sf api request rest "${path}" --method ${method}`;

    // Add target org if specified, otherwise SF CLI will use the default org
    if (this.config.orgAlias) {
      cmd += ` --target-org ${this.config.orgAlias}`;
    }

    if (body) {
      const bodyJson = JSON.stringify(body);
      // Escape single quotes in JSON for shell
      const escapedBody = bodyJson.replace(/'/g, "'\\''");
      cmd += ` --body '${escapedBody}'`;
    } else if (method === "DELETE") {
      // SF CLI requires --body for DELETE requests (even if empty)
      cmd += ` --body '{}'`;
    }

    try {
      this.debug(`Executing: ${method} ${path}`);
      const result = execSync(cmd, {
        encoding: "utf-8",
        timeout: this.timeoutMs,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Handle empty responses (e.g., DELETE 204 No Content)
      if (!result || result.trim() === '') {
        const duration = Date.now() - startTime;
        this.debug(`${method} ${path} -> SUCCESS (empty response) (${duration}ms)`);
        return null;
      }

      const response: SfApiResponse = JSON.parse(result);
      const duration = Date.now() - startTime;

      // If response has a numeric status field, it's the SF CLI wrapper envelope
      // {status: 0, result: {...}} = success, {status: 1, ...} = error
      // If status is a string (e.g., "New", "Complete"), the response IS the API object
      if ('status' in response && typeof response.status === 'number') {
        if (response.status === 0) {
          this.debug(`${method} ${path} -> SUCCESS (${duration}ms)`);
          return response.result;
        } else {
          this.debug(`${method} ${path} -> ERROR status ${response.status} (${duration}ms)`);
          throw new Error(
            `SF CLI error (status ${response.status}): ${response.message || JSON.stringify(response)}`
          );
        }
      }

      // If no status field, assume the response is the actual data (success case)
      this.debug(`${method} ${path} -> SUCCESS (no status field) (${duration}ms)`);
      return response;
    } catch (err: any) {
      const duration = Date.now() - startTime;
      this.debug(`${method} ${path} -> ERROR (${duration}ms): ${err.message}`);

      // Try to parse error output as JSON to extract HTTP status
      if (err.stdout) {
        try {
          const errorResponse: SfApiResponse = JSON.parse(err.stdout);
          if (errorResponse.result && typeof errorResponse.result === 'object') {
            const httpError = errorResponse.result;
            throw new Error(
              `HTTP error: ${JSON.stringify(httpError)}`
            );
          }
          if (errorResponse.message) {
            throw new Error(`SF CLI error: ${errorResponse.message}`);
          }
        } catch (parseErr) {
          if (parseErr instanceof Error && parseErr.message.startsWith('HTTP error:') || parseErr instanceof Error && parseErr.message.startsWith('SF CLI error:')) {
            throw parseErr;
          }
          // If not JSON, fall through
        }
      }

      // Check stderr for error details (SF CLI often writes errors here)
      if (err.stderr) {
        const stderr = typeof err.stderr === 'string' ? err.stderr.trim() : '';
        if (stderr && !stderr.startsWith('Warning:')) {
          throw new Error(`SF CLI error: ${stderr}`);
        }
      }

      // If we have a generic message from execSync, improve it
      if (err.message && err.message.includes('Command failed:')) {
        throw new Error(`SF CLI command failed for ${method} ${path}. Check org connectivity and API version.`);
      }

      throw err;
    }
  }

  /**
   * Classify an error message into a retry category. Matches anchored HTTP
   * status patterns ("HTTP 503:", "HTTP error... 429") so column IDs that
   * happen to contain digits matching server-error or rate-limit codes
   * (e.g. "1W7xx0000004C503YAE") don't false-positive into retry.
   *
   * Returns the category, or null if the error is non-retryable.
   */
  private classifyError(errMsg: string): "rate-limit" | "server-error" | "network" | null {
    // Rate limit: only match status code in HTTP-shape contexts
    if (/\bHTTP\s+429\b/i.test(errMsg) || /"errorCode":"REQUEST_LIMIT_EXCEEDED"/i.test(errMsg) || /\brate[-\s]?limit/i.test(errMsg)) {
      return "rate-limit";
    }
    // Server error 5xx: same anchoring
    if (/\bHTTP\s+5\d{2}\b/i.test(errMsg) || /\bHTTP error.*\b5\d{2}\b/i.test(errMsg)) {
      return "server-error";
    }
    // Network / timeout
    if (/\bETIMEDOUT\b|\bECONNRESET\b|\btimed out\b|\bENOTFOUND\b|\bECONNREFUSED\b/i.test(errMsg)) {
      return "network";
    }
    return null;
  }

  /** Compute backoff with jitter — full jitter strategy (random in [0, base*2^attempt]). */
  private backoffMs(attempt: number, baseMs: number = 1000): number {
    const cap = baseMs * Math.pow(2, attempt);
    return Math.floor(Math.random() * cap);
  }

  private async requestWithRetry(
    method: string,
    path: string,
    body?: unknown
  ): Promise<any> {
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.sfApiRequest(method, path, body);
      } catch (err: any) {
        const errMsg = err.message || "";
        const category = this.classifyError(errMsg);

        if (category && attempt < maxRetries) {
          const delay = this.backoffMs(attempt);
          this.debug(`${category} error, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
          await this.sleep(delay);
          continue;
        }

        // No more retries or non-retryable error
        throw err;
      }
    }

    // Should not reach here, but just in case
    throw new Error(`Request failed after ${maxRetries + 1} attempts: ${method} ${path}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async get(path: string): Promise<any> {
    return this.requestWithRetry("GET", `${this.basePath}${path}`);
  }

  async post(path: string, body?: unknown): Promise<any> {
    return this.requestWithRetry("POST", `${this.basePath}${path}`, body);
  }

  async put(path: string, body?: unknown): Promise<any> {
    return this.requestWithRetry("PUT", `${this.basePath}${path}`, body);
  }

  async delete(path: string): Promise<any> {
    return this.requestWithRetry("DELETE", `${this.basePath}${path}`);
  }
}
