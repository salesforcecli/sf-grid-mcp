/**
 * Eval-suite environment helpers.
 *
 * Two required env vars:
 *   ORGFARM_INSTANCE_URL  — e.g. https://orgfarmout.my.localhost.sfdcdev.salesforce.com:6101
 *   ORGFARM_OAUTH_TOKEN   — bearer token (client_credentials flow); see
 *     reference_orgfarm_oauth_setup.md for how to obtain
 *
 * If either is missing, evals print a single skip notice and exit 0 — they
 * are intended to run only when an authenticated orgfarm is reachable.
 */

export interface EvalEnv {
  instanceUrl: string;
  accessToken: string;
}

let cached: EvalEnv | null | undefined;

export function getEvalEnv(): EvalEnv | null {
  if (cached !== undefined) return cached;
  const instanceUrl = process.env.ORGFARM_INSTANCE_URL;
  const accessToken = process.env.ORGFARM_OAUTH_TOKEN;
  if (!instanceUrl || !accessToken) {
    cached = null;
    return null;
  }
  // Allow self-signed orgfarm certs without TLS errors. Scoped to this process.
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  cached = { instanceUrl, accessToken };
  return cached;
}

export function evalEnvOrSkip(suiteName: string): EvalEnv | null {
  const env = getEvalEnv();
  if (!env) {
    process.stderr.write(
      `[evals] skipping "${suiteName}" — set ORGFARM_INSTANCE_URL and ORGFARM_OAUTH_TOKEN to run\n`
    );
  }
  return env;
}