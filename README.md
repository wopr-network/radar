# NORAD

**The only winning move is to have gates.**

WOPR will try to reach DEFCON 1. It will not stop. It will escalate — architect, code, review, fix, merge — until the product ships or something external says no.

That's not a bug. That's the point. The problem is what happens when the code is wrong, the tests fail, or the migration drops a live table. WOPR doesn't know the difference. It just keeps going.

NORAD is the runtime that marries WOPR and DEFCON. DEFCON runs the gates. WOPR tries to launch. NORAD makes sure WOPR never gets to DEFCON 1 without earning it.

---

## What NORAD Does

NORAD speaks two protocols and connects them:

```
NORAD ──→ DEFCON  (flow.claim, flow.report)
NORAD ──→ Worker  (send prompt, receive signal + artifacts)
```

1. Call `flow.claim` — DEFCON returns an entity and a prompt
2. Send the prompt to a worker — it does the work
3. Worker returns a signal and artifacts
4. Call `flow.report` — DEFCON runs the gate, returns next action
5. `continue` → send new prompt to worker. `waiting` → release. `check_back` → wait and retry.

The worker can be anything that takes a prompt and returns a signal:

- **WOPR** — the full agent stack. Wraps Claude with tools, context, and skills. Tries to reach DEFCON 1.
- **Raw Claude** — lightweight. No tooling. For simpler tasks.
- **Claude Code** — human-in-the-loop. Same protocol. Human makes the decisions.
- **Codex, Gemini, anything** — if it speaks the worker protocol, NORAD can run it.

DEFCON doesn't know what the worker is. WOPR doesn't know what DEFCON is. NORAD is the marriage.

---

## The Stack

```
DEFCON  — pipeline engine. Gates, state machines, claim/report protocol.
WOPR    — agent stack. Wraps Claude. Tries to reach DEFCON 1 and ship.
NORAD   — runtime adapter. Speaks DEFCON. Speaks workers. Wires them together.
```

DEFCON runs the gates. WOPR tries to launch the missiles. NORAD makes sure it earns every level.

---

## Usage

```bash
norad run --workers 8 --role engineering --worker wopr
norad run --workers 4 --role devops --worker claude --flow wopr-deploy
norad run --workers 1 --role engineering --worker codex
```

---

## License

MIT
