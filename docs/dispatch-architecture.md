# Dispatch Architecture

How RADAR launches, tracks, and collects results from agent invocations (nukes).

---

## The Dispatcher Contract

Every dispatcher implements the same interface:

```typescript
interface Dispatcher {
  dispatch(prompt: string, opts: DispatchOpts): Promise<WorkerResult>;
}

interface DispatchOpts {
  modelTier: "opus" | "sonnet" | "haiku";
  workerId: string;
  entityId: string;
  agentRole?: string | null;
  timeout?: number;
  templateContext?: Record<string, unknown> | null;
}

interface WorkerResult {
  signal: string;                        // e.g. "pr_created", "clean", "crash"
  artifacts: Record<string, unknown>;    // e.g. { prUrl, prNumber }
  exitCode: number;
}
```

RADAR doesn't care HOW the agent runs. It sends a prompt and model tier, gets back a signal and artifacts. The dispatcher is a pluggable adapter.

---

## Three Dispatchers

### NukeDispatcher — Docker containers over HTTP/SSE

**The production dispatcher.** Launches a Docker container per entity, communicates via HTTP POST + Server-Sent Events (SSE).

```
RADAR                           NUKE container
  │                                │
  │── docker run (launch) ────────>│
  │                                │ (container starts, HTTP server listens)
  │── POST /dispatch ─────────────>│
  │                                │── runs claude agent-sdk query()
  │<─── SSE: session ──────────────│
  │<─── SSE: tool_use ─────────────│
  │<─── SSE: text ─────────────────│
  │<─── SSE: result ───────────────│
  │                                │
  │── (parse signal from result) ──│
  │── (report to defcon) ──────────│
```

**Key properties:**

- **One container per entity.** Container lives across multiple dispatches (continue cycles). Session state persists via `sessionId`.
- **SSE streaming.** RADAR reads events in real time. Every `tool_use`, `text`, and `result` event is inserted into the activity repo as it arrives.
- **Credential injection.** Claude credentials and GitHub tokens are mounted as Docker secrets. Linear API key is passed as an env var.
- **Isolation.** Each nuke runs in its own container with its own filesystem, git worktree, and tool access. Nukes can't interfere with each other.

**Dispatch request:**

```json
POST /dispatch
{
  "prompt": "You are a software engineer...",
  "modelTier": "sonnet",
  "newSession": true
}
```

On continue dispatches:

```json
POST /dispatch
{
  "prompt": "Continue your work. Here is what happened last time:\n---\n...",
  "modelTier": "sonnet",
  "sessionId": "ses_abc123"
}
```

**SSE event types:**

| Event type | Fields | Description |
|------------|--------|-------------|
| `session` | `sessionId` | Emitted once at dispatch start. RADAR stores this for continue dispatches. |
| `tool_use` | `name`, `input` | Agent called a tool (Read, Edit, Bash, etc.). Logged to activity repo. |
| `text` | `text` | Agent produced text output. Logged to activity repo. |
| `result` | `signal`, `artifacts`, `isError`, `costUsd`, `stopReason` | Terminal event. Contains parsed signal and extracted artifacts. |
| `error` | `message` | Agent crashed or timed out. |

**Container lifecycle:**

```
entity created → first dispatch → container launched → session starts
                 continue dispatch → same container, same session
                 continue dispatch → same container, same session
entity done → container stopped and removed
```

The `DEFAULT_TIMEOUT_MS` (30 minutes) is the SSE stream read deadline — not a container idle TTL. Container cleanup happens when the entity completes (`stopEntity`) or on RADAR shutdown (`stopAll`). There is no automatic idle reaper yet; orphaned containers from crashed RADAR processes must be cleaned up manually (`docker rm -f $(docker ps -q --filter label=nuke.entity)`).

### SdkDispatcher — In-process Claude Agent SDK

**The lightweight dispatcher.** Runs `@anthropic-ai/claude-agent-sdk` `query()` directly in the RADAR process. No Docker, no containers, no HTTP.

```
RADAR process
  │
  │── query({ prompt, model, mcpServers, systemPrompt }) ──> Claude API
  │<── async iterator of SDK messages ─────────────────────
  │── parse signal from collected text ────────────────────
```

**Key properties:**

- **No container overhead.** Fast startup, lower resource usage.
- **Agent role templates.** Loads `agents/{agentRole}.md` from a configurable directory, renders Handlebars templates, prepends to the prompt.
- **MCP integration.** Configures Linear MCP server automatically when `LINEAR_API_KEY` is set:
  ```
  npx -y mcp-remote https://mcp.linear.app/mcp --header "Authorization: Bearer <key>"
  ```
- **Activity tracking.** Inserts `start`, `tool_use`, `text`, `result` rows into the activity repo. Both SdkDispatcher and NukeDispatcher follow this convention — a `start` row marks each attempt boundary.

**Model mapping:**

| Tier | Model ID |
|------|----------|
| opus | claude-opus-4-6 |
| sonnet | claude-sonnet-4-6 |
| haiku | claude-haiku-4-5 |

### ClaudeCodeDispatcher — CLI subprocess

**The original dispatcher.** Spawns `claude` as a child process. Simple but limited.

```
RADAR
  │── spawn("claude", ["-p", prompt, "--model", tier, "--allowedTools", ...])
  │── collect stdout ──────────────
  │── on exit: parse signal from last 200 lines
```

**Key properties:**

- **No streaming.** Stdout is collected after the process exits. No real-time activity tracking.
- **Tool restriction.** Only allows `Edit,Read,Write,Bash,Glob,Grep` — no MCP, no custom tools.
- **Simple failure modes.** Non-zero exit + no signal = `crash`. Timeout = `timeout`.

---

## Signal Parsing

All dispatchers extract a signal from agent output. The parser scans from the **bottom up** — last match wins.

| Signal | Pattern | Extracted Artifacts |
|--------|---------|---------------------|
| `spec_ready` | `Spec ready: WOP-123` | `{ issueKey }` |
| `pr_created` | `PR created: https://...pull/456` | `{ prUrl, prNumber }` |
| `clean` | `CLEAN: https://...` | `{ url }` |
| `issues` | `ISSUES: https://... — finding1; finding2` | `{ url, reviewFindings }` |
| `fixes_pushed` | `Fixes pushed: https://...` | `{ url }` |
| `merged` | `Merged: https://...` | `{ url }` |
| `cant_resolve` | `cant_resolve` | `{}` |
| `design_needed` | `design_needed` | `{}` |
| `design_ready` | `design_ready` | `{}` |
| `crash` | (no recognized signal) | `{}` |

Signals must appear on their own line. The agent's prompt template tells it what signal to emit. The parser is dumb — it pattern-matches, nothing more.

See [signal-format.md](./signal-format.md) for the full specification.

---

## Activity Tracking

Every dispatcher inserts activity rows into the activity repo as events arrive:

```typescript
interface ActivityRow {
  id: string;
  entityId: string;
  slotId: string;
  seq: number;
  type: "start" | "tool_use" | "text" | "result";
  data: Record<string, unknown>;
  createdAt: number;
}
```

Activity is exposed via `GET /api/entities/{entityId}/activity?since={seq}` for NORAD's real-time feed.

On **continue dispatches**, the activity repo provides `getSummary(entityId)` — a prose-formatted history of the previous attempt. This is injected into the next prompt with a `---` separator so the agent knows what it already tried.

---

## The Dispatch Cycle

Inside the run loop, dispatch integrates with claim/report:

```
1. CLAIM
   slot calls defcon /api/claim
   → receives: entityId, prompt, modelTier, agentRole, templateContext

2. DISPATCH
   slot calls dispatcher.dispatch(prompt, opts)
   → nuke launches, runs, streams events
   → returns WorkerResult { signal, artifacts, exitCode }

3. REPORT
   slot calls defcon /api/report with signal + artifacts
   → defcon advances the entity through gates/transitions
   → response: { next_action: "continue" | "check_back" | "waiting" }

4a. CONTINUE (if next_action = "continue")
    fetch activity history, inject into new prompt
    loop back to step 2 — same entity, same slot

4b. CHECK_BACK (if next_action = "check_back")
    sleep retry_after_ms, retry report

4c. WAITING (if next_action = "waiting")
    release slot, loop back to step 1
```

---

## Concurrency Control

The pool enforces two limits from the flow definition:

| Limit | Source | Effect |
|-------|--------|--------|
| `maxConcurrent` | flow definition | Max active entities across all repos for this flow |
| `maxConcurrentPerRepo` | flow definition | Max active entities per repo within this flow |

Review/watcher states (mode: `passive`) don't consume slots. Only `active` states count against concurrency.

---

## Choosing a Dispatcher

| Dispatcher | Use case | Pros | Cons |
|------------|----------|------|------|
| **NukeDispatcher** | Production | Full isolation, streaming, session persistence, credential isolation | Docker overhead, container management |
| **SdkDispatcher** | Development, lightweight production | Fast, no Docker, MCP integration, agent role templates | Shares RADAR process, no filesystem isolation |
| **ClaudeCodeDispatcher** | Legacy, simple setups | Simple, no dependencies beyond `claude` CLI | No streaming, no MCP, limited tool access |
| **DummyDispatcher** | Testing | Zero cost, deterministic | Not real |

---

## The NUKE Container

NUKE containers are defined in [wopr-network/nuke](https://github.com/wopr-network/nuke). Each discipline gets its own Dockerfile:

```
nuke/
  packages/worker-runtime/    — HTTP server (/dispatch, /health), SSE streaming,
                                signal parsing, claude-agent-sdk query()
  workers/coder/Dockerfile    — node + git + gh + pnpm (engineering discipline)
  workers/devops/Dockerfile   — node + git + curl (devops discipline)
```

The worker-runtime is shared infrastructure. The Dockerfile per discipline adds project-specific tooling. A Python shop adds `pip`, `pytest`, `ruff`. A Rust shop adds `cargo`, `clippy`.

**You fork the NUKE** to customize what's installed in your agent containers. You fork the SILO to customize what work they do.

---

## Cross-References

- [signal-format.md](./signal-format.md) — signal specification
- [onboarding.md](./onboarding.md) — setup and troubleshooting
- [NUKE repo](https://github.com/wopr-network/nuke) — agent container definitions
- [DEFCON API](https://github.com/wopr-network/defcon) — claim/report protocol
- [SILO](https://github.com/wopr-network/bunker) — flow definitions that drive dispatch
