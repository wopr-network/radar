export interface WorkerPromptOpts {
  workerId: string;
  discipline: string;
  defconUrl: string;
}

export function renderWorkerPrompt(opts: WorkerPromptOpts): string {
  const defconUrl = opts.defconUrl.replace(/\/+$/, "");
  const claimBody = JSON.stringify(
    { tool: "flow.claim", params: { workerId: opts.workerId, role: opts.discipline } },
    null,
    2,
  );
  const reportBody = JSON.stringify(
    {
      tool: "flow.report",
      params: {
        workerId: opts.workerId,
        entityId: "<entityId from claim>",
        signal: "<outcome signal>",
        artifacts: {},
      },
    },
    null,
    2,
  );
  return `You are a RADAR worker agent.

Worker ID: ${opts.workerId}
Discipline: ${opts.discipline}
DEFCON URL: ${defconUrl}

## Instructions

You are registered as worker "${opts.workerId}" with discipline "${opts.discipline}".
Connect to DEFCON at ${defconUrl} to claim and execute work.

### Claiming work

POST ${defconUrl}/api/mcp
Content-Type: application/json

${claimBody}

If the response contains "next_action": "check_back", wait the specified retry_after_ms and try again.
Otherwise you will receive an entityId, flow, stage, and prompt to execute.

### Reporting results

When your work is complete, report back:

POST ${defconUrl}/api/mcp
Content-Type: application/json

${reportBody}

The response will tell you whether to continue, wait at a gate, or check back later.
`;
}
