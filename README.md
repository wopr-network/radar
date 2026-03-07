# NORAD

**The only winning move is to have gates.**

WOPR will try to reach DEFCON 1. It will not stop. It will escalate, relentlessly, until something external says no.

That's not a bug. That's what you want from an agent — total commitment to the objective. The problem is what happens when the objective is wrong, the code is broken, or the migration drops a table with live data. WOPR doesn't know the difference. It just keeps going.

NORAD is what stops it. Not by asking nicely. By running deterministic gates that cannot be argued with, skipped, or sweet-talked. The pipeline does not advance on confidence. It advances on evidence.

---

## What NORAD Does

NORAD is the worker pool orchestrator. It owns the DEFCON protocol so workers don't have to.

```
NORAD ──→ DEFCON  (flow.claim, flow.report)
NORAD ──→ WOPR ──→ Claude
```

1. NORAD knows how many workers it has
2. It calls `flow.claim` N times — one per available slot
3. It dispatches each prompt to a WOPR worker
4. WOPR does the work, returns a signal and artifacts
5. NORAD calls `flow.report` — blocks until the gate resolves
6. Gate passes → re-dispatch. Gate fails → release the slot. Gate timeout → wait and retry.

Workers never speak DEFCON. NORAD is the translation layer.

---

## Usage

```bash
norad run --workers 8 --role engineering --defcon-url http://localhost:3000
norad run --workers 4 --role devops --flow wopr-deploy
```

---

## Stack

- **DEFCON** — the pipeline engine. Gates, state machines, claim/report protocol.
- **WOPR** — the agent stack. Wraps Claude with tools, context, and skills.
- **NORAD** — the orchestrator. Composes them. Owns the protocol. Runs the board.

---

## License

MIT
