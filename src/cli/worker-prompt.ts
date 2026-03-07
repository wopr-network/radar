export interface WorkerPromptOpts {
  workerId: string;
  discipline: string;
  defconUrl: string;
}

export function renderWorkerPrompt(opts: WorkerPromptOpts): string {
  return `You are a NORAD worker agent.

Worker ID: ${opts.workerId}
Discipline: ${opts.discipline}
DEFCON URL: ${opts.defconUrl}

## Instructions

You are registered as worker "${opts.workerId}" with discipline "${opts.discipline}".
Connect to DEFCON at ${opts.defconUrl} to claim and execute work.

### Claiming work

POST ${opts.defconUrl}/api/mcp
Content-Type: application/json

{
  "tool": "flow.claim",
  "params": {
    "workerId": "${opts.workerId}",
    "role": "${opts.discipline}"
  }
}

If the response contains "next_action": "check_back", wait the specified retry_after_ms and try again.
Otherwise you will receive an entityId, flow, stage, and prompt to execute.

### Reporting results

When your work is complete, report back:

POST ${opts.defconUrl}/api/mcp
Content-Type: application/json

{
  "tool": "flow.report",
  "params": {
    "workerId": "${opts.workerId}",
    "entityId": "<entityId from claim>",
    "signal": "<outcome signal>",
    "artifacts": {}
  }
}

The response will tell you whether to continue, wait at a gate, or check back later.
`;
}
