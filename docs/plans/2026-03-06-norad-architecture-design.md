# NORAD Architecture Design

**Date:** 2026-03-06
**Status:** Approved

## Overview

NORAD is the stateful, DB-backed runtime adapter that marries DEFCON and WOPR. It speaks two protocols: DEFCON (REST — claim/report/entity creation) and workers (prompt in, signal + artifacts out). NORAD watches the world via **sources**, translates events into DEFCON protocol via **watches**, and manages **worker pools** that claim work from DEFCON and dispatch it to WOPR/Claude/Codex/whatever.

DEFCON runs standalone. NORAD is a client.

## 1. Architecture

One binary, two subsystems sharing a single SQLite database:

```
┌─────────────────────────────────────────────┐
│                   NORAD                      │
│                                              │
│  ┌──────────────┐    ┌───────────────────┐   │
│  │  Source       │    │  Worker Pool      │   │
│  │  Watcher      │    │  Manager          │   │
│  │              │    │                   │   │
│  │  webhooks ←──│    │  claim ──→ DEFCON │   │
│  │  polling     │    │  dispatch → WOPR  │   │
│  │  cron        │    │  report ──→ DEFCON│   │
│  └──────┬───────┘    └───────────────────┘   │
│         │                                    │
│         ▼                                    │
│  ┌──────────────────────────────────────┐    │
│  │           SQLite (Drizzle)            │    │
│  │  sources │ watches │ event_log │ workers │ │
│  └──────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
      DEFCON (REST)        Workers (WOPR, Claude, etc.)
```

**Source Watcher** — listens to external systems (GitHub webhooks, Linear webhooks, PagerDuty, cron schedules). When an event matches a watch, it either creates an entity in DEFCON or reports a signal on an existing one.

**Worker Pool Manager** — calls `flow.claim` on DEFCON, dispatches prompts to workers, collects results, calls `flow.report`. Manages slot capacity.

Both subsystems run in a single process. They share the SQLite database for state and coordinate through it.

## 2. Data Model

Four tables:

### `sources`

A connection to an external system. One source per system.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| name | TEXT UNIQUE | Human-readable identifier (e.g. "linear-prod") |
| type | TEXT | Source type: "webhook", "poll", "cron" |
| config | JSON | Connection details (URL, auth, schedule) |
| enabled | BOOLEAN | Whether source is active |
| created_at | INTEGER | Unix timestamp |
| updated_at | INTEGER | Unix timestamp |

### `watches`

A routing rule on a source. Filters events, maps to DEFCON actions.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| source_id | TEXT FK | References sources.id |
| name | TEXT | Human-readable identifier |
| filter | JSON | Event matching criteria |
| action | TEXT | "create_entity" or "report_signal" |
| action_config | JSON | Flow ID, signal name, entity mapping |
| enabled | BOOLEAN | Whether watch is active |
| created_at | INTEGER | Unix timestamp |
| updated_at | INTEGER | Unix timestamp |

### `event_log`

Append-only log of all events processed.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| source_id | TEXT FK | References sources.id |
| watch_id | TEXT FK | References watches.id (nullable — unmatched events) |
| raw_event | JSON | Original event payload |
| action_taken | TEXT | What NORAD did (nullable if no match) |
| defcon_response | JSON | DEFCON's response (nullable) |
| created_at | INTEGER | Unix timestamp |

### `workers`

Registered worker instances.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| name | TEXT | Human-readable identifier |
| type | TEXT | "wopr", "claude", "codex", "claude-code" |
| discipline | TEXT | "engineering", "devops", "qa", "security" |
| status | TEXT | "idle", "working", "offline" |
| config | JSON | Worker-specific configuration |
| last_heartbeat | INTEGER | Unix timestamp |
| created_at | INTEGER | Unix timestamp |

## 3. API

NORAD exposes a REST API for runtime management and an HTTP endpoint for webhook ingestion.

### Webhook Ingestion

```
POST /webhooks/:sourceId    — receive events from external systems
```

### Source CRUD

```
GET    /api/sources          — list all sources
POST   /api/sources          — create a source
GET    /api/sources/:id      — get a source
PUT    /api/sources/:id      — update a source
DELETE /api/sources/:id      — delete a source
```

### Watch CRUD

```
GET    /api/sources/:id/watches     — list watches for a source
POST   /api/sources/:id/watches     — create a watch
GET    /api/watches/:id             — get a watch
PUT    /api/watches/:id             — update a watch
DELETE /api/watches/:id             — delete a watch
```

### Workers

```
GET    /api/workers           — list workers
POST   /api/workers           — register a worker
DELETE /api/workers/:id       — deregister a worker
```

### Operations

```
POST   /api/pool/claim        — manually trigger a claim cycle
GET    /api/pool/slots         — view active slots
GET    /api/events             — query event log
```

## 4. Seed File

One config file, owned by NORAD. NORAD splits it: flow definitions go to DEFCON via REST, sources and watches go to NORAD's local database.

```json
{
  "flows": {
    "engineering": {
      "discipline": "engineering",
      "states": {
        "architecting": { "onEnter": ["..."], "transitions": { "arch_approved": "coding" } },
        "coding": { "..." : "..." }
      }
    }
  },
  "sources": {
    "linear-prod": {
      "type": "webhook",
      "config": { "secret": "$LINEAR_WEBHOOK_SECRET" }
    }
  },
  "watches": {
    "new-issue-to-engineering": {
      "source": "linear-prod",
      "filter": { "type": "Issue", "action": "create", "label": "engineering" },
      "action": "create_entity",
      "action_config": {
        "flow": "engineering",
        "entity_id_from": "issue.id",
        "metadata_from": { "title": "issue.title", "url": "issue.url" }
      }
    }
  }
}
```

On startup, NORAD:
1. Reads the seed file
2. Pushes flow definitions to DEFCON via `PUT /api/flows/:id`
3. Upserts sources and watches into local SQLite
4. Starts the source watcher and worker pool manager

## 5. How It Composes

```
Linear webhook fires
  → NORAD receives on POST /webhooks/linear-prod
  → Watch "new-issue-to-engineering" matches
  → NORAD calls DEFCON: POST /api/entities { flow: "engineering", externalId: "LIN-123" }
  → DEFCON creates entity in "architecting" state, runs onEnter gates

Worker pool manager loop:
  → NORAD calls DEFCON: POST /api/flows/engineering/claim { discipline: "engineering" }
  → DEFCON returns { entityId: "...", prompt: "...", state: "architecting" }
  → NORAD dispatches prompt to WOPR worker
  → WOPR returns { signal: "arch_approved", artifacts: { doc: "..." } }
  → NORAD calls DEFCON: POST /api/entities/:id/report { signal: "arch_approved", artifacts: {...} }
  → DEFCON runs gate, transitions to "coding", returns { action: "continue", prompt: "..." }
  → NORAD sends new prompt to same worker
  → Cycle continues until DEFCON returns { action: "waiting" }
  → NORAD releases the slot
```

## Design Decisions

1. **SQLite + Drizzle** — single-file database, no external dependencies, Drizzle for type-safe queries.
2. **One binary** — source watcher and worker pool run in the same process, share the DB.
3. **REST everywhere** — NORAD speaks REST to DEFCON. DEFCON also keeps MCP transport as an option for Claude Code sessions.
4. **Full CRUD API** — sources and watches are runtime-manageable, not just seed-file config.
5. **Single seed file** — NORAD owns the config. Pushes flows to DEFCON, stores sources/watches locally.
6. **DEFCON is standalone** — has no knowledge of external systems. NORAD is the membrane.
