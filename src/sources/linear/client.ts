import type { LinearIssue, LinearRelation } from "./types.js";

const LINEAR_API_URL = "https://api.linear.app/graphql";

const ISSUE_WITH_RELATIONS_QUERY = `
  query IssueWithRelations($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      state { type name }
      relations {
        nodes {
          type
          relatedIssue {
            identifier
            title
            state { type name }
          }
        }
      }
    }
  }
`;

export interface LinearClientConfig {
  apiKey: string;
}

interface GraphQLResponse {
  data?: {
    issue: {
      id: string;
      identifier: string;
      title: string;
      state: { type: string; name: string };
      relations: {
        nodes: Array<{
          type: string;
          relatedIssue: {
            identifier: string;
            title: string;
            state: { type: string; name: string };
          };
        }>;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

export class LinearClient {
  private apiKey: string;

  constructor(config: LinearClientConfig) {
    this.apiKey = config.apiKey;
  }

  async getIssueWithRelations(issueId: string): Promise<LinearIssue> {
    const res = await fetch(LINEAR_API_URL, {
      method: "POST",
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: ISSUE_WITH_RELATIONS_QUERY, variables: { id: issueId } }),
    });

    if (!res.ok) {
      throw new Error(`Linear API error: ${res.status}`);
    }

    const json = (await res.json()) as GraphQLResponse;

    if (json.errors?.length) {
      throw new Error(json.errors[0].message);
    }

    if (!json.data) {
      throw new Error("Linear API returned no data");
    }

    const issue = json.data.issue;

    if (!issue) {
      throw new Error(`Issue ${issueId} not found`);
    }

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      state: issue.state as LinearIssue["state"],
      relations: issue.relations.nodes.map(
        (n) =>
          ({
            type: n.type,
            relatedIssue: {
              identifier: n.relatedIssue.identifier,
              title: n.relatedIssue.title,
              state: n.relatedIssue.state as LinearIssue["state"],
            },
          }) as LinearRelation,
      ),
    };
  }
}
