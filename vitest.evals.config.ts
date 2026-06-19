/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["evals/**/*.eval.ts"],
    exclude: ["dist/**", "node_modules/**"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
    reporters: ["verbose"],
  },
});