/**
 * Non-interactive test script for the MCP server.
 * Runs a sequence of commands and displays results.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const testDataDir = "/tmp/wegmans-mcp-test-" + Date.now();
mkdirSync(testDataDir, { recursive: true });

console.log(`Using test data directory: ${testDataDir}\n`);

const server = spawn("node", ["dist/src/index.js"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    XDG_DATA_HOME: testDataDir,
  },
});

let messageId = 1;
let responseBuffer = "";
const pendingResponses: Map<number, (response: unknown) => void> = new Map();

function send(method: string, params?: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    const id = messageId++;
    const message = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    const json = JSON.stringify(message);
    pendingResponses.set(id, resolve);
    server.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  });
}

// Parse responses
server.stdout.on("data", (chunk: Buffer) => {
  responseBuffer += chunk.toString();

  while (true) {
    const headerEnd = responseBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;

    const header = responseBuffer.slice(0, headerEnd);
    const match = header.match(/Content-Length: (\d+)/);
    if (!match) break;

    const length = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;

    if (responseBuffer.length < bodyStart + length) break;

    const body = responseBuffer.slice(bodyStart, bodyStart + length);
    responseBuffer = responseBuffer.slice(bodyStart + length);

    try {
      const response = JSON.parse(body) as { id?: number };
      if (response.id && pendingResponses.has(response.id)) {
        pendingResponses.get(response.id)!(response);
        pendingResponses.delete(response.id);
      }
    } catch {
      // ignore parse errors
    }
  }
});

server.stderr.on("data", (chunk: Buffer) => {
  console.log(`[server] ${chunk.toString().trim()}`);
});

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  // Wait for server to start
  await sleep(1000);

  console.log("=== 1. Initialize MCP connection ===");
  const initResult = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-script", version: "1.0" },
  });
  console.log(JSON.stringify(initResult, null, 2));

  // Send initialized notification
  const notif = { jsonrpc: "2.0", method: "notifications/initialized" };
  const notifJson = JSON.stringify(notif);
  server.stdin.write(`Content-Length: ${Buffer.byteLength(notifJson)}\r\n\r\n${notifJson}`);
  await sleep(500);

  console.log("\n=== 2. List available tools ===");
  const toolsResult = await send("tools/list", {});
  const tools = toolsResult as { result?: { tools?: Array<{ name: string; description?: string }> } };
  if (tools.result?.tools) {
    for (const tool of tools.result.tools) {
      console.log(`\n[${tool.name}]`);
      // Just show first 200 chars of description
      const desc = tool.description?.slice(0, 200) || "";
      console.log(desc + (desc.length >= 200 ? "..." : ""));
    }
  }

  console.log("\n\n=== 3. Query stores database ===");
  const storesResult = await send("tools/call", {
    name: "query",
    arguments: {
      database: "stores",
      sql: "SELECT store_number, name, city, state FROM stores WHERE state = 'NY' LIMIT 5",
    },
  });
  console.log(JSON.stringify(storesResult, null, 2));

  console.log("\n=== 4. Try to query products without selecting a store ===");
  const noStoreResult = await send("tools/call", {
    name: "query",
    arguments: {
      database: "products",
      sql: "SELECT * FROM products LIMIT 1",
    },
  });
  console.log(JSON.stringify(noStoreResult, null, 2));

  console.log("\n=== 5. Count stores ===");
  const countResult = await send("tools/call", {
    name: "query",
    arguments: {
      database: "stores",
      sql: "SELECT COUNT(*) as total_stores FROM stores",
    },
  });
  console.log(JSON.stringify(countResult, null, 2));

  console.log("\n=== Done! ===");
  server.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  server.kill();
  process.exit(1);
});
