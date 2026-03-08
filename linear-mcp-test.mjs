#!/usr/bin/env node
// Test harness: run Claude via SDK with Linear MCP and ask it to list projects

import { query } from "@anthropic-ai/claude-agent-sdk";

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
if (!LINEAR_API_KEY) {
  console.error("ERROR: LINEAR_API_KEY not set");
  process.exit(1);
}

const t0 = Date.now();
const ts = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

console.log(`${ts()} starting query with Linear MCP...`);

// Strip CLAUDECODE so subprocess doesn't refuse to start inside Claude Code
const env = { ...process.env };
delete env.CLAUDECODE;

// Linear's official MCP is a remote server; mcp-remote bridges it as stdio.
// Auth via Authorization header using the API key.
const mcpServers = {
  "linear-server": {
    type: "stdio",
    command: "npx",
    args: [
      "-y",
      "mcp-remote",
      "https://mcp.linear.app/mcp",
      "--header",
      `Authorization: Bearer ${LINEAR_API_KEY}`,
    ],
    env,
  },
};

let lastText = "";

for await (const msg of query({
  prompt: "Use Linear MCP tools to list all projects and teams. Report back with their names and IDs.",
  options: {
    model: "claude-haiku-4-5-20251001",
    permissionMode: "bypassPermissions",
    mcpServers,
    env,
    stderr: (line) => process.stderr.write(`[sdk-stderr] ${line}`),
  },
})) {
  const type = msg.type;

  if (type === "assistant") {
    for (const block of msg.message.content) {
      if (block.type === "tool_use") {
        console.log(`${ts()} [tool_use] ${block.name} input=${JSON.stringify(block.input).slice(0, 120)}`);
      } else if (block.type === "text") {
        lastText = block.text;
        console.log(`${ts()} [text] ${block.text.slice(0, 200)}`);
      } else {
        console.log(`${ts()} [assistant/${block.type}]`);
      }
    }
  } else if (type === "result") {
    console.log(`${ts()} [result] subtype=${msg.subtype} is_error=${msg.is_error} cost=$${msg.total_cost_usd?.toFixed(4)} stop_reason=${msg.stop_reason}`);
  } else if (type === "system") {
    console.log(`${ts()} [system] subtype=${msg.subtype}`);
  } else if (type === "tool_progress") {
    console.log(`${ts()} [tool_progress] ${msg.tool_use_id ?? "?"}`);
  } else {
    console.log(`${ts()} [${type}]`, JSON.stringify(msg).slice(0, 100));
  }
}

console.log(`\n${ts()} === FINAL OUTPUT ===`);
console.log(lastText);
