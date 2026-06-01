export type ConnectionStatus = "idle" | "connecting" | "ws_open" | "challenged" | "connect_sent" | "ready" | "failed";

export type AgentNode = {
  id: string;
  title: string;
  executor: {
    agentId: string;
    role: "planner" | "coder" | "tester" | "reviewer" | "operator";
    fallbackAgentId: string | null;
    sessionId: string | null;
  };
  status: "queued" | "running" | "success" | "failed" | "blocked";
  dependsOn: string[];
  artifacts: {
    id: string;
    type: string;
    schemaVersion: number;
    name: string;
    path: string;
    hash: string;
    sourceNodeId: string;
    createdAt: string;
  }[];
};

export type AppSnapshot = {
  gateway: {
    status: ConnectionStatus;
    protocol: number;
    scopes: string[];
    serverVersion: string;
    latencyMs: number;
  };
  agents: { id: string; role: string; online: boolean }[];
  pipeline: AgentNode[];
  timeline: { ts: string; createdAt: string; text: string; level: "info" | "warn" | "error" }[];
};

export const mockSnapshot: AppSnapshot = {
  gateway: {
    status: "ready",
    protocol: 3,
    scopes: ["operator.read", "operator.write"],
    serverVersion: "2026.4.10",
    latencyMs: 38,
  },
  agents: [
    { id: "planner-main", role: "planner", online: true },
    { id: "coder-a", role: "worker", online: true },
    { id: "reviewer-a", role: "reviewer", online: false },
  ],
  pipeline: [
    {
      id: "n1",
      title: "Requirement Analysis",
      executor: { agentId: "planner-main", role: "planner", fallbackAgentId: null, sessionId: null },
      status: "success",
      dependsOn: [],
      artifacts: [
        {
          id: "a1",
          type: "brief.v1",
          schemaVersion: 1,
          name: "brief",
          path: "brief.md",
          hash: "sha256:demo001",
          sourceNodeId: "n1",
          createdAt: "2026-04-13T00:00:00.000Z",
        },
      ],
    },
    {
      id: "n2",
      title: "Code Generation",
      executor: { agentId: "coder-a", role: "coder", fallbackAgentId: "coder-b", sessionId: null },
      status: "running",
      dependsOn: ["n1"],
      artifacts: [
        {
          id: "a2",
          type: "patch.v1",
          schemaVersion: 1,
          name: "patch",
          path: "patch.diff",
          hash: "sha256:demo002",
          sourceNodeId: "n2",
          createdAt: "2026-04-13T00:01:00.000Z",
        },
      ],
    },
    {
      id: "n3",
      title: "Test Verification",
      executor: { agentId: "tester-a", role: "tester", fallbackAgentId: null, sessionId: null },
      status: "blocked",
      dependsOn: ["n2"],
      artifacts: [],
    },
    {
      id: "n4",
      title: "Release Approval",
      executor: { agentId: "reviewer-a", role: "reviewer", fallbackAgentId: null, sessionId: null },
      status: "queued",
      dependsOn: ["n3"],
      artifacts: [],
    },
  ],
  timeline: [
    { ts: "20:39:18", createdAt: "2026-04-13T20:39:18.000Z", text: "Gateway handshake complete (protocol v3)", level: "info" },
    { ts: "20:39:20", createdAt: "2026-04-13T20:39:20.000Z", text: "Pipeline run #241 started", level: "info" },
    { ts: "20:39:33", createdAt: "2026-04-13T20:39:33.000Z", text: "Node n2 still executing", level: "warn" },
  ],
};
