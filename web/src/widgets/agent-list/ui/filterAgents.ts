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
    // 中文注释：按常用定位信息搜索，覆盖智能体 ID、角色、最近输出与事件摘要，方便快速定位目标智能体。
    const text = [agent.id, agent.role, agent.outputPreview, agent.eventPreview].join(" ").toLowerCase();
    return text.includes(normalized);
  });
}
