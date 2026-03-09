#!/usr/bin/env node
// Test harness: run query() and timestamp every emitted SDKMessage type

import { query } from "@anthropic-ai/claude-agent-sdk";

const t0 = Date.now();
const ts = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

console.log(`${ts()} starting query...`);

let lastText = "";

for await (const msg of query({
  prompt: "Say exactly: SIGNAL: hello_world — nothing else.",
  options: {
    model: "haiku",
    allowedTools: [],
  },
})) {
  const type = msg.type;

  if (type === "assistant") {
    for (const block of msg.message.content) {
      if (block.type === "tool_use") {
        console.log(`${ts()} [assistant/tool_use] name=${block.name}`);
      } else if (block.type === "text") {
        lastText = block.text;
        console.log(`${ts()} [assistant/text] ${block.text.slice(0, 80)}`);
      } else {
        console.log(`${ts()} [assistant/${block.type}]`);
      }
    }
  } else if (type === "result") {
    console.log(`${ts()} [result] subtype=${msg.subtype} is_error=${msg.is_error} cost=$${msg.total_cost_usd?.toFixed(4)} stop_reason=${msg.stop_reason}`);
    console.log(`${ts()} lastText: ${lastText.slice(0, 120)}`);
  } else if (type === "system") {
    console.log(`${ts()} [system] subtype=${msg.subtype}`);
  } else if (type === "tool_progress") {
    console.log(`${ts()} [tool_progress] tool=${msg.tool_use_id ?? "?"}`);
  } else {
    console.log(`${ts()} [${type}]`, JSON.stringify(msg).slice(0, 100));
  }
}

console.log(`${ts()} done`);
