#!/usr/bin/env node
/**
 * dsh-browser MCP server.
 *
 * Spawned by dsh via @deepseek-ai/dsh-mcp-client (transport: stdio). Talks MCP
 * on stdio to dsh, and owns a Unix domain socket that the browser extension
 * connects to through the native-messaging host.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from "@dsh-browser/protocol";
import { Bridge } from "./bridge.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  const bridge = new Bridge();
  bridge.onStateChange = (s) => {
    process.stderr.write(
      `[dsh-browser-mcp] browser ${s.connected ? "connected" : "disconnected"}` +
        `${s.browser ? ` (${s.browser})` : ""}\n`,
    );
  };

  try {
    await bridge.start();
    process.stderr.write(`[dsh-browser-mcp] listening on ${bridge.socketPath}\n`);
  } catch (err) {
    process.stderr.write(`[dsh-browser-mcp] failed to open bridge socket: ${String(err)}\n`);
    process.exit(1);
  }

  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });
  registerTools(server, bridge);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[dsh-browser-mcp] MCP transport ready\n");

  const shutdown = async () => {
    await bridge.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);
}

main().catch((err) => {
  process.stderr.write(`[dsh-browser-mcp] fatal: ${String(err)}\n`);
  process.exit(1);
});
