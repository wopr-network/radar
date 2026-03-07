import type { LinearIssue, LinearIssueState, LinearRelation, LinearSearchIssue } from "./types.js";

const LINEAR_API_URL = "https://api.linear.app/graphql";

const SEARCH_ISSUES_QUERY = `
  query SearchIssues($stateName: String!, $first: Int) {
    issues(filter: { state: { name: { eq: $stateName } } }, first: $first) {
      nodes {
        id
        identifier
        title
        description
        state { type name }
        labels { nodes { name } }
      }
    }
  }
`;

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
      inverseRelations {
        nodes {
          type
          issue {
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

interface SearchIssuesResponse {
  data?: {
    issues: {
      nodes: Array<{
        id: string;
        identifier: string;
        title: string;
        description: string | null;
        state: { type: string; name: string };
        labels: { nodes: Array<{ name: string }> };
      }>;
    };
  };
  errors?: Array<{ message: string }>;
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
      inverseRelations: {
        nodes: Array<{
          type: string;
          issue: {
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

  async searchIssues(filter: { stateName: string; first?: number }): Promise<LinearSearchIssue[]> {
    const res = await fetch(LINEAR_API_URL, {
      method: "POST",
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: SEARCH_ISSUES_QUERY,
        variables: { stateName: filter.stateName, first: filter.first ?? 50 },
      }),
    });

    if (!res.ok) {
      throw new Error(`Linear API error: ${res.status}`);
    }

    const json = (await res.json()) as SearchIssuesResponse;

    if (json.errors?.length) {
      throw new Error(json.errors[0].message);
    }

    if (!json.data) {
      throw new Error("Linear API returned no data");
    }

    return json.data.issues.nodes.map((n) => ({
      id: n.id,
      identifier: n.identifier,
      title: n.title,
      description: n.description,
      state: n.state as LinearIssueState,
      labels: n.labels.nodes,
    }));
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

    const directRelations: LinearRelation[] = issue.relations.nodes.map((n) => ({
      type: n.type as LinearRelation["type"],
      relatedIssue: {
        identifier: n.relatedIssue.identifier,
        title: n.relatedIssue.title,
        state: n.relatedIssue.state as LinearIssue["state"],
      },
    }));

    // inverseRelations where type="blocks" mean the related issue blocks this one,
    // which is semantically equivalent to this issue having a "blocked_by" relation.
    const inverseRelations: LinearRelation[] = issue.inverseRelations.nodes
      .filter((n) => n.type === "blocks")
      .map((n) => ({
        type: "blocked_by" as LinearRelation["type"],
        relatedIssue: {
          identifier: n.issue.identifier,
          title: n.issue.title,
          state: n.issue.state as LinearIssue["state"],
        },
      }));

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      state: issue.state as LinearIssue["state"],
      relations: [...directRelations, ...inverseRelations],
    };
  }
}
