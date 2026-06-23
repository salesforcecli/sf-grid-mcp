/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

/**
 * Eval-suite environment helpers.
 *
 * Two required env vars:
 *   ORGFARM_INSTANCE_URL  — e.g. https://<your-org>.my.salesforce.com
 *   ORGFARM_OAUTH_TOKEN   — bearer token from a Connected App / External
 *     Client App configured with the OAuth client_credentials grant flow
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