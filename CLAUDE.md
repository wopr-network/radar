# Radar

## Check before committing
```bash
npm run check
```

## Gotchas
- **worker/repo**: All IWorkerRepo methods must return Promise<T> — radar follows async/await convention; sync repo methods break callers.
- **worker/lifecycle**: Always await deregister() in stop() — fire-and-forget causes race conditions on shutdown.
- **worker/register**: Reset abortController to null in the catch block on register failure — stale controller prevents re-registration.
