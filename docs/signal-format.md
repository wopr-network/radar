# Signal Format

How claude agents communicate outcomes back to NORAD.

---

## Overview

When claude finishes processing an entity, NORAD reads the last 200 lines of claude's stdout and scans them (from the end) for a recognized signal phrase. The signal phrase determines what gets reported to DEFCON, which advances the entity to the next state.

**There is no structured output required.** Claude writes normal prose. The signal parser looks for specific phrases anywhere in the output. Everything else is ignored.

---

## Signal Phrases

Each signal has an exact phrase that must appear in claude's stdout. The parser scans lines in reverse order — the signal can appear anywhere, but should appear at or near the end.

### `spec_ready`

```
Spec ready: WOP-123
```

Signals that the architect has posted an implementation spec. The issue key is extracted as an artifact.

**Used by:** Architect state. Send after posting the spec comment to Linear.

---

### `pr_created`

```
PR created: https://github.com/wopr-network/wopr/pull/456 for WOP-123
```

Signals that the coder has created a PR. The PR URL and number are extracted as artifacts.

**Used by:** Coding state. Send after `gh pr create` succeeds.

---

### `CLEAN: <url>`

```
CLEAN: https://github.com/wopr-network/wopr/pull/456
```

Signals that the reviewer found no issues. The PR URL is extracted.

**Used by:** Reviewing state. Send when CI is green and no actionable review findings exist.

---

### `ISSUES: <url> — <findings>`

```
ISSUES: https://github.com/wopr-network/wopr/pull/456 — unused import in auth.ts:42; missing null check in handler.ts:17
```

Signals that the reviewer found problems. The PR URL and semicolon-separated findings are extracted.

**Used by:** Reviewing state. Send when CI fails or actionable review comments exist.

---

### `Fixes pushed: <url>`

```
Fixes pushed: https://github.com/wopr-network/wopr/pull/456
```

Signals that the fixer has addressed review findings and pushed.

**Used by:** Fixing state. Send after committing and pushing fixes.

---

### `Merged: <url>`

```
Merged: https://github.com/wopr-network/wopr/pull/456
```

Signals that the PR has merged successfully.

**Used by:** Merging/watcher state. Send when `gh pr view` shows merged state.

---

### `cant_resolve`

```
cant_resolve
```

Signals that the fixer cannot resolve a conflict or issue and needs human intervention.

**Used by:** Fixing state. Send when a rebase conflict cannot be resolved or a blocker exists.

---

## Rules

**Place the signal at the very end of your message.** The parser scans from the bottom up and returns the first match. Putting it last ensures it's found even if similar text appears earlier in the output.

**Use exact capitalization.** `CLEAN:` must be uppercase. `Spec ready:` must match exactly (capital S, lowercase r). `PR created:` must match exactly.

**The signal must be on its own line.** Inline signals (embedded mid-sentence) will not match.

**Prose before the signal is fine.** Write as much context as needed before the signal line. The parser only extracts the signal — the rest is for human readability in logs.

---

## Example: Architect Output

```
I've read the codebase at /data/worktrees/wopr-wopr-coder-0001 and analyzed
the existing auth module. The implementation spec has been posted as a
comment on WOP-123.

Key findings:
- Auth tokens expire after 1h, refresh logic is in src/auth/refresh.ts
- Tests use vitest, run with npx vitest run <file>
- No existing coverage for the edge case described in the issue

The spec covers 4 tasks with TDD approach. See the Linear comment for details.

Spec ready: WOP-123
```

The parser finds `Spec ready: WOP-123`, extracts signal `spec_ready` and artifact `{ issueKey: "WOP-123" }`, and reports to DEFCON.

---

## Example: Reviewer Output

```
## Review Results

CI: all checks green
Qodo: 1 inline suggestion (outdated, line: null — resolved)
CodeRabbit: LGTM with minor comment about variable naming

The diff looks clean. No blocking issues found.

CLEAN: https://github.com/wopr-network/wopr/pull/456
```

Or with issues:

```
CI failed on the `test` check. Three test failures in auth.test.ts.

ISSUES: https://github.com/wopr-network/wopr/pull/456 — test failure in auth.test.ts:89; unused import flagged by lint
```

---

## What Happens on Unknown Signal

If no recognized signal is found and claude exits with a non-zero code, NORAD reports `crash` to DEFCON. The entity is re-queued with a crash artifact and the gate failure prompt (if configured).

If claude exits 0 but no signal is found, NORAD also reports `crash`. **Always end with a signal phrase.**

---

## Prompt Templates

Each state's `promptTemplate` in `seed/flows.json` specifies what signal the agent should send at the end. The templates use this exact wording — match it literally.

Example from the architecting state:

```
Then send to team-lead: "Spec ready: {{entity.refs.linear.key}}"
```

The `{{entity.refs.linear.key}}` renders to the actual issue key (e.g., `WOP-123`) at claim time. The agent writes that rendered string verbatim.
