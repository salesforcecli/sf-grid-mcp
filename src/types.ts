/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE.txt file in the repo root.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GridClient } from "./client.js";

export type RegisterToolsFn = (server: McpServer, client: GridClient) => void;
