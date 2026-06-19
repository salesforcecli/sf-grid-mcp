/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

/**
 * Per-suite workbook lifecycle. Each phase suite calls `createSuiteWorkbook`
 * in its beforeAll and `cleanupSuiteWorkbook` in its afterAll, so failed runs
 * leave no orgfarm debris.
 */

import { GridClient } from "../../src/client.js";
import type { EvalEnv } from "./env.js";

export interface SuiteWorkbook {
  client: GridClient;
  workbookId: string;
  worksheetId: string;
}

export function buildClient(env: EvalEnv): GridClient {
  return new GridClient({
    instanceUrl: env.instanceUrl,
    accessToken: env.accessToken,
  });
}

export async function createSuiteWorkbook(
  client: GridClient,
  suiteName: string
): Promise<{ workbookId: string; worksheetId: string }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const wb = await client.post("/workbooks", { name: `Eval-${suiteName}-${stamp}` });
  const ws = await client.post("/worksheets", {
    name: "Phase",
    workbookId: wb.id,
  });
  return { workbookId: wb.id, worksheetId: ws.id };
}

export async function cleanupSuiteWorkbook(
  client: GridClient,
  workbookId: string | undefined
): Promise<void> {
  if (!workbookId) return;
  try {
    await client.delete(`/workbooks/${encodeURIComponent(workbookId)}`);
  } catch (err) {
    // Cleanup is best-effort. Log and move on so a teardown failure doesn't
    // mask the real test failure.
    process.stderr.write(`[evals] cleanup failed for workbook ${workbookId}: ${(err as Error).message}\n`);
  }
}