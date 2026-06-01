import { AgentItem } from "../../../entities/agent";

export type AgentListCardItem = AgentItem & {
  workStatus: "idle" | "busy";
  outputRunId: string | null;
  outputContent: string;
  outputPreview: string;
  eventPreview: string;
  lastExecution: {
    nodeId: string;
    nodeTitle: string;
    status: string;
    finishedAt: string | null;
  } | null;
};

const normalizeKeyword = (value: string) => value.trim().toLowerCase();

export function filterAgentCards(agents: AgentListCardItem[], keyword: string): AgentListCardItem[] {
  const normalized = normalizeKeyword(keyword);
  if (!normalized) return agents;

  return agents.filter((agent) => {
    // Search by common identification info — covers agent ID, role, recent output, and event summary for quick targeting.
    const text = [agent.id, agent.role, agent.outputPreview, agent.eventPreview].join(" ").toLowerCase();
    return text.includes(normalized);
  });
}
