import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GridClient } from "./client.js";

export type RegisterToolsFn = (server: McpServer, client: GridClient) => void;
