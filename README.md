# NORAD

**The only winning move is to have gates.**

---

In 1983, a kid with a modem called the wrong number and nearly started World War III. WOPR — the War Operation Plan Response computer — didn't know it was playing a game. It didn't know the difference between a simulation and a real Soviet first strike. It just played. It escalated. DEFCON 5. 4. 3. 2. And it played perfectly — so perfectly that NORAD almost turned the key.

The movie's lesson was supposed to be "the only winning move is not to play."

We disagree.

The only winning move is to have gates.

---

## The Metaphor That Isn't a Metaphor

Every deploy to production is a potential thermonuclear event. Every merge to main can take down the system. Every release goes out to real users who depend on your software being correct. These aren't dramatic comparisons — ask anyone who's shipped a broken auth flow to production at 2am, or dropped a migration on a live database, or pushed a payment bug that charged customers twice.

Shipping software is dangerous. We do it anyway because shipping is the mission. The question isn't whether to launch — it's whether the launch was earned.

In WarGames, WOPR played the game to perfection. It moved through every DEFCON level. It satisfied every check. The escalation was flawless. And if the game had been real — if the targets were real, if the evidence was real, if the stakes were real — then the launch would have been correct.

That's the insight. WOPR's problem wasn't that it played the game. Its problem was that the game wasn't real.

**We made the game real.**

WOPR writes code. Real code. It runs real tests. Real linters. Real CI pipelines. It opens real PRs and passes real review. Every DEFCON level is a gate that checks real evidence — not simulated scenarios, not vibes, not "the AI said it looks good." Shell commands. Exit codes. Binary pass/fail.

Here's what that means in practice: a competent AI agent working on a real codebase needs roughly three cycles to produce correct code. Not because the model is bad. Because that's the cost of correctness — context limits, missed edge cases, implicit contracts that aren't written down anywhere. The first pass gets you most of the way there. The next cycles close the gap. You can't spend your way out of it by loading more context upfront. The iteration is the work.

DEFCON is built around that reality. The `reviewing → fixing → reviewing` loop isn't a fallback for bad agents — it's the designed path. The gates exist because correction cycles are expected, and the only question is whether they happen inside a controlled loop or in production at 2am.

And when WOPR plays this game to perfection — when it clears every gate, satisfies every check, earns every escalation — it launches. The merge happens. The deploy goes out. The feature ships.

We gave an AI the launch codes. On purpose. Because the loop is real.

---

## What NORAD Is

NORAD is the operations center. It watches the world.

In the movie, NORAD was the room full of people staring at screens, watching for events — radar contacts, satellite feeds, communications intercepts. When something appeared on the board, NORAD decided how to respond. It didn't launch the missiles. It didn't decide policy. It ran the operations floor.

In this system, NORAD does the same thing. Events come in — a Linear ticket moves to "Ready", a cron fires, a webhook arrives, a human says "go." NORAD notices. It claims work from DEFCON. It dispatches WOPR. And then it watches while WOPR tries to escalate.

```
World event
  → NORAD notices
    → claims from DEFCON
      → dispatches WOPR
        → WOPR works, emits signal
          → NORAD feeds signal to DEFCON
            → DEFCON checks gate
              → pass? escalate. fail? hold.
                → repeat until DEFCON 1
                  → launch.
```

NORAD doesn't make judgment calls. It doesn't decide if the code is good. It doesn't evaluate the architecture. It manages the operations floor — how many workers are running, who's working what, routing signals between the thing that does the work (WOPR) and the thing that decides if the work is good enough (DEFCON).

---

## The Stack

Three systems. Three roles. One metaphor that refuses to break down.

```
WOPR    — the AI. It thinks. It codes. It tries to launch.
DEFCON  — the escalation ladder. Gates at every level. Earns the launch.
NORAD   — the operations center. Watches the world. Dispatches WOPR. Wires it all together.
```

DEFCON doesn't know what WOPR is. It just sees claims and signals. WOPR doesn't know what DEFCON is. It just gets prompts and reports results. NORAD is the marriage — the thing that speaks both protocols and connects them.

### The Protocols

NORAD speaks two languages:

**Upstream — DEFCON** (the pipeline):
- `flow.claim(role)` — "What needs doing?" DEFCON returns an entity and a prompt.
- `flow.report(signal, artifacts)` — "I did the thing." DEFCON runs the gate, returns the next action.

**Downstream — Workers** (the agents):
- Send a prompt. Receive a signal and artifacts.

That's it. NORAD claims work, hands it to a worker, takes the result, reports it back. The worker never touches DEFCON. DEFCON never touches the worker. NORAD is the bridge.

### The Workers

A worker is anything that takes a prompt and returns a signal:

- **WOPR** — the full agent stack. Claude with tools, context, skills, and the relentless drive to reach DEFCON 1.
- **Raw Claude** — lightweight. No tooling. For simpler tasks where you don't need the full arsenal.
- **Claude Code** — human-in-the-loop. Same protocol. The human makes the decisions.
- **Codex, Gemini, o3, anything** — if it speaks the worker protocol, NORAD can dispatch it.

NORAD doesn't care what's inside the worker. It cares that the worker takes a prompt and returns a signal. The gate doesn't care who wrote the code. It cares whether `pnpm test` exits 0.

---

## How It Plays

NORAD starts its shift. Workers come online. The world generates events.

```bash
# 8 engineering workers, powered by WOPR, working the pipeline
norad run --workers 8 --role engineering --worker wopr

# 4 devops workers, raw Claude, running deployments
norad run --workers 4 --role devops --worker claude --flow deploy

# 1 worker, Codex backend, for a specific experiment
norad run --workers 1 --role engineering --worker codex
```

Each worker enters a loop:

1. NORAD calls `flow.claim` on their behalf. DEFCON returns the highest-priority work for their discipline.
2. NORAD sends the prompt to the worker. The worker does the work — writes code, runs tests, reviews PRs, whatever the current state demands.
3. The worker returns a signal: `spec_ready`, `pr_created`, `clean`, `issues`, `fixes_pushed`, `merged`.
4. NORAD calls `flow.report` with the signal. DEFCON runs the gate.
5. Three outcomes:
   - **`continue`** — gate passed. New prompt. Send it to the worker. Keep going.
   - **`waiting`** — gate failed. Release the worker. Something external needs to change.
   - **`check_back`** — gate still evaluating. Wait. Retry.

The worker never decides what state comes next. It never decides "good enough." It does work, emits a signal, and the system — based on evidence, not opinion — tells it what happens next.

---

## The Game

Here's what actually happens when NORAD runs a pipeline:

WOPR picks up a feature ticket. It doesn't know it's at DEFCON 5. It just knows it has a prompt: *write an implementation spec*. It reads the codebase. Identifies the files. Maps the edge cases. Posts the spec. Reports `spec_ready`.

DEFCON checks the gate. The spec exists? The issue is updated? Gate passes. DEFCON 4. New prompt: *implement the spec. Write failing tests first, then code. Push a PR.*

WOPR writes the code. Pushes the PR. Reports `pr_created`. DEFCON runs the gate — `tsc`, `biome check`, full test suite. Eight minutes pass. CI finishes. Gate passes. DEFCON 3. New prompt: *review the PR. Check every bot comment. Check the diff. Report clean or issues.*

WOPR reviews. Security bot flagged unvalidated input on line 47. WOPR reports `issues`. DEFCON moves to `fixing` — not forward, sideways. A fixing prompt: *here's what the reviewer found. Fix it. Push. Report fixes_pushed.*

WOPR fixes the finding. Pushes. Reports `fixes_pushed`. DEFCON sends it back to reviewing. Not forward — **back**. A fresh review from scratch. New CI. New diff. New check.

This time it's clean. WOPR reports `clean`. Gate passes. DEFCON 2. Merge queue entered. CI runs on the merge commit. Validates against everything else that landed since the PR was opened.

Gate passes. DEFCON 1.

**Launch.**

The PR merges. The feature ships. WOPR played the game to perfection — and because the game was real, because every gate checked real evidence, the launch was earned.

No one stayed up until 2am. No one got paged. No broken auth in production. No angry customers. No incident room. The AI wrote the code, the gates verified the code, and the code shipped. Exactly as designed.

---

## Why Not Just Use Temporal?

Temporal is a workflow orchestration platform for distributed systems. It's battle-tested, widely adopted, and excellent at what it does. The primitives map:

| Temporal | NORAD + DEFCON |
|----------|---------------|
| Workflow | Flow (state machine) |
| Activity | Invocation (agent assignment) |
| Signal | Signal (deterministic trigger) |
| Timer | Gate (with timeout) |
| Worker | NORAD worker |
| Task Queue | Claim protocol |
| Child Workflow | Flow composition |

But the design goals are different:

**Temporal** is a general-purpose durable execution platform. You write workflows as deterministic code. The server replays event history to reconstruct state after failures. It runs as a cluster. It scales to millions of workflows. It has a managed cloud offering with multi-region replication.

**DEFCON + NORAD** is purpose-built for AI agents shipping software. The flows are data, not code — stored in SQLite, mutated at runtime by the agents themselves. The gates are deterministic predicates that no amount of AI reasoning can bypass. The whole thing is ~5000 lines, runs on one machine, and stores state in a single file.

The philosophical difference:

- Temporal: "Write your workflow as deterministic code. We'll make it durable."
- DEFCON: "Define your workflow as data. Let agents play the game. Gate every level."

If you're building payment processing or order fulfillment or microservice orchestration — use Temporal. It's designed for that and it's very good.

If you're giving AI agents the launch codes and you need to make sure they earn every escalation — that's what this is for.

---

## The Lesson

The movie ended with WOPR learning that nuclear war has no winners. "The only winning move is not to play." It's a good lesson — for thermonuclear war.

But we're not launching missiles. We're launching software. And software that never launches is software that never ships. Features that never deploy are features that never exist. Code that never reaches production is code that never matters.

The game has to be played. The question is whether the game is real.

DEFCON makes the game real. WOPR plays it. NORAD runs the operations floor.

And when WOPR plays perfectly — when the code compiles, the tests pass, the linter is clean, the security scanner is quiet, the reviewer says clean, the CI is green, and the merge queue validates the final commit — NORAD turns the key.

**Launch authorized.**

---

## License

MIT
