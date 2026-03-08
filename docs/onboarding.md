# NORAD Onboarding

> For new contributors, operators, and AI agents setting up or debugging the NORAD service.

---

## What NORAD Is

NORAD is the worker adapter that sits between external event sources (Linear, GitHub) and DEFCON. It does two things:

1. **Ingestion** — watches Linear/GitHub webhooks and creates entities in DEFCON when issues are assigned
2. **Dispatch** — runs worker slots that claim entities from DEFCON and spawn `claude` to process them

NORAD is stateless between restarts (its SQLite DB tracks ingestion dedup only). All pipeline state lives in DEFCON.

---

## Quick Start (Docker)

### 1. Create a `Dockerfile.norad`

```dockerfile
FROM node:24-alpine
RUN npm install -g @wopr-network/norad@latest @anthropic-ai/claude-code
RUN apk add --no-cache git
ENV CLI=/usr/local/lib/node_modules/@wopr-network/norad/dist/cli/index.js
WORKDIR /app
CMD sh -c "mkdir -p /root/.claude && cp /claude-host/.credentials.json /root/.claude/.credentials.json && node $CLI seed /app/seed/norad.json --defcon-url $DEFCON_URL --db $NORAD_DB_PATH && node $CLI run --workers 4 --role engineering --defcon-url $DEFCON_URL --seed /app/seed/norad.json"
```

**Why `@anthropic-ai/claude-code`?** NORAD's dispatcher spawns `claude` as a subprocess. Without the package installed globally, the dispatch fails with `spawn claude ENOENT`.

**Why `git`?** Claude agents run git commands inside worktrees. They need git in PATH.

**Why copy credentials instead of bind-mounting the file?** On WSL2 with Docker Desktop, atomic file replacement (which Claude's OAuth token refresh does) creates a new inode. A file-level bind mount tracks the original inode and goes stale after the first refresh. Mounting the directory and copying the file at startup gives the container a writable copy that is always current as of container start.

### 2. Set up credentials

NORAD needs Claude credentials to dispatch agents. Mount `~/.claude` as a read-only directory and copy the credentials file in at startup (as shown in the Dockerfile above):

```yaml
volumes:
  - ~/.claude:/claude-host:ro
```

The startup `cp` command in CMD handles the copy. If you run `claude /login` on the host after starting the container, restart the container to pick up the new credentials.

### 3. Write a seed file

```json
{
  "flows": [{ "name": "my-flow", "defconFlowName": "my-flow" }],
  "sources": [{ "name": "linear-prod", "type": "linear", "config": { "apiKey": "..." } }],
  "watches": [{ "sourceName": "linear-prod", "flowName": "my-flow", "filter": { "state": "In Progress" } }]
}
```

### 4. Run with DEFCON

```yaml
# docker-compose.yml
services:
  defcon:
    build: { dockerfile: Dockerfile.defcon }
    ports: ["3001:3001"]
    networks: [pipeline]

  norad:
    build: { dockerfile: Dockerfile.norad }
    volumes:
      - norad-data:/data
      - ./seed:/app/seed:ro
      - ~/.claude:/claude-host:ro
    environment:
      NORAD_DB_PATH: /data/norad.db
      DEFCON_URL: http://defcon:3001
      DEFCON_WORKER_TOKEN: ${DEFCON_WORKER_TOKEN}
      DEFCON_ADMIN_TOKEN: ${DEFCON_ADMIN_TOKEN}
    depends_on:
      defcon: { condition: service_healthy }
    networks: [pipeline]
```

---

## How the Run Loop Works

When `norad run` starts, it spawns N worker slots (default 4). Each slot loops independently:

```
slot starts
  → call DEFCON /api/claim
  → if check_back: sleep retry_after_ms (usually 30s), then retry
  → if work: spawn claude with the prompt
  → wait for claude to exit (up to 30 min)
  → parse signal from claude's stdout
  → report signal + artifacts to DEFCON /api/report
  → if check_back from report: sleep, retry report
  → release slot, loop back to claim
```

### What "healthy" looks like

NORAD logs are intentionally sparse. Startup:

```
[norad] Seeded: 1 flows, 1 sources, 1 watches
[norad] Seed loaded: 1 flows, 1 sources, 1 watches
[norad] API server listening on port 8080
[norad] Starting 4 worker slots — role: engineering
```

Then silence. **Silence is normal.** The run loop does not log successful claims or dispatches. Only errors appear.

To confirm a slot is working, check:

```bash
# Inside the norad container
ps aux | grep claude
# claude process appears when a slot is dispatching

# From the host
docker compose exec defcon wget -qO- http://127.0.0.1:3001/api/status
# activeInvocations: 1 means claude is running
```

### Why slots take 30s+ to claim after startup

On a fresh container, all 4 slots immediately call `/api/claim`. If DEFCON has no work yet, all 4 get `check_back` and sleep 30 seconds. During that sleep, if you create an entity, no slot will pick it up until the sleep expires. This is expected behavior — not a bug.

---

## Diagnosing Problems

### No `entity.claimed` event after 60+ seconds

1. Check `pendingClaims` in DEFCON status. If 0, the entity's `onEnter` hasn't finished — check the entity's `artifacts.onEnter_error`.
2. If `pendingClaims: 1`, the slots are sleeping. Wait for the 30s sleep to expire.
3. If still no claim after 90s, check for errors in norad logs:
   ```bash
   docker compose logs norad
   ```
   `slot claim error:` lines indicate the defcon HTTP call is failing.

### `spawn claude ENOENT`

`@anthropic-ai/claude-code` is not installed. Rebuild the norad image:

```bash
docker compose build --no-cache norad
docker compose up -d norad
```

### `401 Invalid authentication credentials`

The credentials in the container are expired or missing. On the host, run:

```bash
claude /login
```

Then restart the norad container:

```bash
docker compose restart norad
```

The startup `cp` command will copy the fresh credentials.

### Credentials missing entirely (`/root/.claude/` is empty)

The `~/.claude:/claude-host:ro` volume mount isn't working, or `.credentials.json` doesn't exist on the host. Verify:

```bash
# On host
ls ~/.claude/.credentials.json

# In container
docker compose exec norad ls /claude-host/.credentials.json
docker compose exec norad ls /root/.claude/.credentials.json
```

### Claude runs but always crashes immediately

Check claude's stderr output (it inherits the container's stderr):

```bash
docker compose logs norad 2>&1 | grep -i "error\|failed\|crash"
```

Common causes: expired credentials (see above), prompt template error, or hitting the context limit on a very large repo.

---

## How claude Signals Back to DEFCON

NORAD's dispatcher captures claude's stdout after the process exits. It scans the last 200 lines for a signal in this format:

```
Signal: spec_ready
Artifacts: {"prUrl": "https://github.com/..."}
```

The `parseSignal` function extracts the signal name and any JSON artifacts. The signal is then forwarded to DEFCON via `/api/report`, which advances the entity through the flow's gate.

Agent prompts must end with a send-to-team-lead message containing the signal. Example from the architecting state:

```
Then send to team-lead: "Spec ready: {{entity.refs.linear.key}}"
```

NORAD's signal parser recognizes common patterns (`spec_ready`, `pr_created`, `clean`, `issues`, `crash`, etc.).

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NORAD_DB_PATH` | yes | Path to SQLite database file |
| `DEFCON_URL` | yes | Base URL of the DEFCON HTTP API |
| `DEFCON_WORKER_TOKEN` | yes | Bearer token for claim/report calls |
| `DEFCON_ADMIN_TOKEN` | yes | Bearer token for admin entity creation |
| `LINEAR_API_KEY` | if using Linear source | Linear API key for webhook ingestion |

---

## Further Reading

- [DEFCON onboarding](https://github.com/wopr-network/defcon/blob/main/docs/wopr/devops/onboarding.md) — how to set up the flow engine NORAD connects to
- [Run loop source](../src/run-loop/run-loop.ts) — the slot lifecycle in code
- [Dispatcher source](../src/dispatcher/claude-code-dispatcher.ts) — how claude is spawned and its output parsed
- [NORAD architecture design](./plans/2026-03-06-norad-architecture-design.md) — full system design
