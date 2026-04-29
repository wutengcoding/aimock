#!/usr/bin/env node
/**
 * mcp-to-aimock.mjs
 *
 * 从 mcporter.json 读取指定 MCP server，查询其所有 tools，
 * 转换成 aimock.json 格式并输出。
 *
 * 用法：
 *   node scripts/mcp-to-aimock.mjs <server-name> [mcporter-config] [output-file]
 *
 * 示例：
 *   node scripts/mcp-to-aimock.mjs org_transfer
 *   node scripts/mcp-to-aimock.mjs mihub-service-mcp /root/.openclaw/mcporter/mcporter.json
 *   node scripts/mcp-to-aimock.mjs org_transfer /root/.openclaw/mcporter/mcporter.json ./aimock.json
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_CONFIG = "/root/.openclaw/mcporter/mcporter.json";

// ---- CLI args ---------------------------------------------------------------

const [serverName, configPath = DEFAULT_CONFIG, outputFile] = process.argv.slice(2);

if (!serverName || serverName === "--help" || serverName === "-h") {
  console.log(
    `Usage: node scripts/mcp-to-aimock.mjs <server-name> [mcporter-config] [output-file]`,
  );
  console.log(`\nExamples:`);
  console.log(`  node scripts/mcp-to-aimock.mjs org_transfer`);
  console.log(
    `  node scripts/mcp-to-aimock.mjs mihub-service-mcp /root/.openclaw/mcporter/mcporter.json`,
  );
  console.log(
    `  node scripts/mcp-to-aimock.mjs org_transfer /root/.openclaw/mcporter/mcporter.json ./aimock.json`,
  );
  process.exit(0);
}

// ---- Load mcporter config ---------------------------------------------------

let mcporterConfig;
try {
  mcporterConfig = JSON.parse(fs.readFileSync(path.resolve(configPath), "utf-8"));
} catch (err) {
  console.error(`Failed to load config from ${configPath}: ${err.message}`);
  process.exit(1);
}

const servers = mcporterConfig.mcpServers ?? {};
const serverConfig = servers[serverName];
if (!serverConfig) {
  console.error(`Server "${serverName}" not found in config.`);
  console.error(`Available servers: ${Object.keys(servers).join(", ")}`);
  process.exit(1);
}

const { baseUrl, headers: extraHeaders = {} } = serverConfig;
console.error(`Connecting to "${serverName}" → ${baseUrl}`);

// ---- HTTP helper ------------------------------------------------------------

function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const payload = JSON.stringify(body);
    const req = transport.request(
      parsed,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ---- MCP handshake ----------------------------------------------------------

async function mcpToolsList(baseUrl, extraHeaders) {
  // 1. initialize
  const initResp = await post(
    baseUrl,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mcp-to-aimock", version: "1.0.0" },
      },
    },
    extraHeaders,
  );

  const sessionId = initResp.headers["mcp-session-id"];
  if (!sessionId) {
    throw new Error(`No mcp-session-id returned. Response: ${initResp.body}`);
  }

  const sessionHeaders = { ...extraHeaders, "mcp-session-id": sessionId };

  // 2. initialized notification
  await post(
    baseUrl,
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    sessionHeaders,
  );

  // 3. tools/list
  const listResp = await post(
    baseUrl,
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    sessionHeaders,
  );

  const parsed = JSON.parse(listResp.body);
  if (parsed.error) {
    throw new Error(`tools/list error: ${JSON.stringify(parsed.error)}`);
  }

  return parsed.result?.tools ?? [];
}

// ---- Convert to aimock format -----------------------------------------------

function toolsToAimock(serverName, tools) {
  return {
    port: 4010,
    mcp: {
      path: "/mcp",
      serverInfo: { name: `${serverName}-mock`, version: "1.0.0" },
      tools: tools.map((t) => ({
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        result: "{}", // 填写实际 mock 返回值
      })),
    },
  };
}

// ---- Main -------------------------------------------------------------------

try {
  const tools = await mcpToolsList(baseUrl, extraHeaders);

  console.error(`Found ${tools.length} tool(s):`);
  for (const t of tools) {
    console.error(`  - ${t.name}${t.description ? `: ${t.description}` : ""}`);
  }
  console.error("");

  const aimockConfig = toolsToAimock(serverName, tools);
  const json = JSON.stringify(aimockConfig, null, 2);

  if (outputFile) {
    fs.writeFileSync(path.resolve(outputFile), json, "utf-8");
    console.error(`Written to ${outputFile}`);
  } else {
    console.log(json);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
