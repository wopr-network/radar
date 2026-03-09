# Radar

## Check before committing
```bash
npm run check
```

## Gotchas
- **worker/repo**: All IWorkerRepo methods must return Promise<T> — radar follows async/await convention; sync repo methods break callers.
- **worker/lifecycle**: Always await deregister() in stop() — fire-and-forget causes race conditions on shutdown.
- **worker/register**: Reset abortController to null in the catch block on register failure — stale controller prevents re-registration.
- **cli/roles**: Reject multiple bare `--role` flags — each bare role spawns a slot, so duplicates silently over-provision concurrency.
- **cli/roles**: Validate `role:concurrency` args have exactly one colon — extra segments must be an error, not silently ignored.
- **outcome**: Map all non-success signals to "failed" — not just "crash"; unrecognized signals must never silently count as "completed".
- **shutdown**: Count aborted entities in throughput stats as "failed" — dropping them hides real workload from metrics.
- **throughput**: Back ThroughputTracker with DrizzleThroughputRepo/SQLite — ephemeral in-memory arrays violate the DB-backed convention.
- **interfaces**: Always depend on `IWorkerRepo` (or equivalent interface), never the concrete `WorkerRepo` — direct usage defeats DI and breaks testability.
- **fire-and-forget promises**: Always `.catch()` promises that are not awaited (e.g., `reap()` in interval callbacks) — unhandled rejections crash the process.
- **Map iteration**: Snapshot Map keys (`[...map.keys()]`) before iterating if the loop body may delete entries — direct iteration over a mutating Map skips elements.
- **child_process**: Never use `execFileSync` / `execSync` in production code — blocking the event loop stalls all slots; use `execFile` from `child_process/promises`.
