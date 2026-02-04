/**
 * Interactive test script for the MCP server.
 * Sends JSON-RPC messages and displays responses.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const server = spawn("node", ["dist/src/index.js"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    XDG_DATA_HOME: "/tmp/wegmans-mcp-test",
  },
});

let messageId = 1;

function send(method: string, params?: Record<string, unknown>): void {
  const message = {
    jsonrpc: "2.0",
    id: messageId++,
    method,
    params,
  };
  const json = JSON.stringify(message);
  server.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  console.log(`\n>>> SENT: ${method}`);
  if (params) console.log(JSON.stringify(params, null, 2));
}

// Parse responses
let buffer = "";
server.stdout.on("data", (chunk: Buffer) => {
  buffer += chunk.toString();

  // Parse Content-Length header and body
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;

    const header = buffer.slice(0, headerEnd);
    const match = header.match(/Content-Length: (\d+)/);
    if (!match) break;

    const length = parseInt(match[1]!, 10);
    const bodyStart = headerEnd + 4;

    if (buffer.length < bodyStart + length) break;

    const body = buffer.slice(bodyStart, bodyStart + length);
    buffer = buffer.slice(bodyStart + length);

    try {
      const response = JSON.parse(body);
      console.log("\n<<< RESPONSE:");
      console.log(JSON.stringify(response, null, 2));
    } catch {
      console.log("\n<<< RAW:", body);
    }
  }
});

server.stderr.on("data", (chunk: Buffer) => {
  console.log(`[server] ${chunk.toString().trim()}`);
});

server.on("close", (code) => {
  console.log(`\nServer exited with code ${code}`);
  process.exit(code ?? 0);
});

// Interactive CLI
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log("MCP Server Test CLI");
console.log("Commands:");
console.log("  init          - Initialize connection");
console.log("  tools         - List available tools");
console.log("  stores        - Query stores database");
console.log("  setstore <n>  - Set active store");
console.log("  products      - Query products (after setstore)");
console.log("  sql <query>   - Run arbitrary SQL");
console.log("  quit          - Exit");
console.log("");

function prompt(): void {
  rl.question("> ", (input) => {
    const [cmd, ...args] = input.trim().split(/\s+/);

    switch (cmd) {
      case "init":
        send("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-cli", version: "1.0" },
        });
        break;

      case "tools":
        send("tools/list", {});
        break;

      case "stores":
        send("tools/call", {
          name: "query",
          arguments: {
            database: "stores",
            sql: "SELECT store_number, name, city, state FROM stores LIMIT 10",
          },
        });
        break;

      case "setstore":
        send("tools/call", {
          name: "setStore",
          arguments: { storeNumber: args[0] || "74" },
        });
        break;

      case "products":
        send("tools/call", {
          name: "query",
          arguments: {
            database: "products",
            sql: "SELECT name, price_in_store, aisle FROM products LIMIT 5",
          },
        });
        break;

      case "sql":
        send("tools/call", {
          name: "query",
          arguments: {
            database: args[0] === "stores" ? "stores" : "products",
            sql: args.slice(args[0] === "stores" ? 1 : 0).join(" "),
          },
        });
        break;

      case "quit":
      case "exit":
        server.kill();
        rl.close();
        return;

      default:
        console.log("Unknown command. Try: init, tools, stores, setstore, products, sql, quit");
    }

    setTimeout(prompt, 500);
  });
}

prompt();
