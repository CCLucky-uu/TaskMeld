import React from "react";
import type { PipelineNode, PipelineNodeStatus } from "../../../entities/pipeline";
import { isNodeReturnErrorNode, isStructuredErrorNode, parsePipelineError } from "../../../entities/pipeline/error-display";

type OverviewPipelineItem = {
  id: string;
  title: string;
  nodes: PipelineNode[];
  isRunning?: boolean;
};

type OverviewBoardProps = {
  pipelines: OverviewPipelineItem[];
  onStartPipeline: (pipelineId: string) => Promise<void>;
  onNavigatePipeline: (pipelineId: string) => void;
  onOpenAgentSession: (agentId: string) => void;
};

const monoClassName = "font-[JetBrains_Mono,monospace]";

const cardBaseClassName =
  "grid min-h-[220px] grid-rows-[auto_auto_1fr_auto] gap-3 border border-[#29414f] bg-[linear-gradient(180deg,rgba(18,31,38,0.92)_0%,rgba(14,24,30,0.92)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_12px_28px_rgba(2,6,10,0.14)]";

const resolveDepartmentStatus = (nodes: PipelineNode[]): PipelineNodeStatus | "idle" => {
  if (nodes.some((node) => node.status === "running")) return "running";
  if (nodes.some((node) => node.status === "failed")) return "failed";
  if (nodes.some((node) => node.status === "stopped")) return "stopped";
  if (nodes.some((node) => node.status === "blocked")) return "blocked";
  if (nodes.some((node) => node.status === "waiting")) return "waiting";
  if (nodes.some((node) => node.status === "success")) return "success";
  return "idle";
};

const resolveStatusToneClassName = (status: PipelineNodeStatus | "idle") => {
  if (status === "running") return "bg-[rgba(50,215,186,0.15)] text-(--live)";
  if (status === "failed") return "bg-[rgba(255,107,107,0.16)] text-(--bad)";
  if (status === "blocked" || status === "waiting") return "bg-[rgba(255,184,77,0.16)] text-(--warn)";
  if (status === "success") return "bg-[rgba(50,215,186,0.15)] text-(--live)";
  return "bg-[rgba(142,163,179,0.2)] text-(--muted)";
};

const resolveStatusLabel = (status: PipelineNodeStatus | "idle") => {
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  if (status === "blocked") return "阻塞";
  if (status === "waiting") return "等待中";
  if (status === "stopped") return "已停止";
  if (status === "success") return "已完成";
  return "空闲";
};

const pickRunningNode = (nodes: PipelineNode[]): PipelineNode | null =>
  nodes.find((node) => node.status === "running") ?? null;

const pickLatestArtifact = (nodes: PipelineNode[]) => {
  const artifacts = nodes.flatMap((node) => node.artifacts ?? []);
  if (artifacts.length === 0) return null;
  return [...artifacts].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt || "") || 0;
    const rightTime = Date.parse(right.createdAt || "") || 0;
    return rightTime - leftTime;
  })[0] ?? null;
};

const formatTime = (value: string | null | undefined) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  const hh = String(parsed.getHours()).padStart(2, "0");
  const min = String(parsed.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
};

export function OverviewBoard({ pipelines, onStartPipeline, onNavigatePipeline, onOpenAgentSession }: OverviewBoardProps) {
  const [startingPipelineId, setStartingPipelineId] = React.useState<string>("");
  return (
    <section data-center-card className="min-h-0 min-w-0">
      <div className="px-3 pt-3">
        <div className="border border-(--line) bg-[rgba(13,22,28,0.82)] px-3 py-2">
          <p className="m-0 text-sm font-semibold text-(--text)">部门运营总览</p>
          <p className="m-0 mt-1 text-xs text-(--muted)">每个卡片代表一条流水线（部门），展示当前运行节点与最新产物。</p>
        </div>
      </div>
      <div className="p-3">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(310px,1fr))] gap-3">
          {pipelines.map((pipeline) => {
            const status = resolveDepartmentStatus(pipeline.nodes);
            const runningNode = pickRunningNode(pipeline.nodes);
            const failedNode = pipeline.nodes.find((node) => node.status === "failed") ?? null;
            const structuredErrorNode = pipeline.nodes.find((node) => isStructuredErrorNode(node)) ?? null;
            const nodeReturnErrorNode = pipeline.nodes.find((node) => isNodeReturnErrorNode(node)) ?? null;
            // 会话按钮优先打开“节点返回错误”的执行者，便于直接追踪业务失败上下文。
            const sessionTargetNode = nodeReturnErrorNode ?? structuredErrorNode ?? failedNode;
            const sessionTargetAgentId = sessionTargetNode?.executor.agentId?.trim() ?? "";
            const latestArtifact = pickLatestArtifact(pipeline.nodes);
            const successCount = pipeline.nodes.filter((node) => node.status === "success").length;
            const failedCount = pipeline.nodes.filter((node) => node.status === "failed").length;
            const blockedCount = pipeline.nodes.filter((node) => node.status === "blocked").length;
            const finishedCount = pipeline.nodes.filter((node) => ["success", "failed", "skipped", "stopped"].includes(node.status)).length;
            const totalCount = pipeline.nodes.length;
            const latestActivityTime =
              runningNode?.startedAt ??
              latestArtifact?.createdAt ??
              pipeline.nodes.find((node) => node.finishedAt)?.finishedAt ??
              null;
            const isStarting = startingPipelineId === pipeline.id;
            const isBusy = isStarting || pipeline.isRunning === true;
            return (
              <article key={pipeline.id} className={cardBaseClassName}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-base font-semibold text-(--text)">{pipeline.title}</p>
                    <p className={`${monoClassName} m-0 mt-1 text-xs text-(--muted)`}>DAG-{pipeline.id}</p>
                  </div>
                  <span className={`inline-flex h-5 items-center px-2 text-xs ${resolveStatusToneClassName(status)}`}>
                    {resolveStatusLabel(status)}
                  </span>
                </div>

                <div className="border border-(--line) bg-[rgba(10,18,24,0.7)] px-2.5 py-2">
                  <p className="m-0 text-xs text-(--muted)">当前运行节点</p>
                  <p className={`${monoClassName} m-0 mt-1 truncate text-sm text-(--text)`}>
                    {runningNode ? `${runningNode.id} · ${runningNode.title}` : "暂无运行节点"}
                  </p>
                </div>

                <div className="grid content-start gap-1">
                  <p className="m-0 text-xs text-(--muted)">最新产物</p>
                  <p className={`${monoClassName} m-0 truncate text-sm text-(--text)`}>{latestArtifact?.name ?? "暂无产物"}</p>
                  <p className={`${monoClassName} m-0 text-xs text-(--muted)`}>
                    {latestArtifact ? `生成时间 ${formatTime(latestArtifact.createdAt)}` : "-"}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2 border border-(--line) bg-[rgba(10,18,24,0.55)] px-2.5 py-2">
                  <div>
                    <p className="m-0 text-[10px] text-(--muted)">成功</p>
                    <p className={`${monoClassName} m-0 mt-0.5 text-sm text-(--live)`}>{successCount}</p>
                  </div>
                  <div>
                    <p className="m-0 text-[10px] text-(--muted)">失败</p>
                    <p className={`${monoClassName} m-0 mt-0.5 text-sm text-(--bad)`}>{failedCount}</p>
                  </div>
                  <div>
                    <p className="m-0 text-[10px] text-(--muted)">阻塞</p>
                    <p className={`${monoClassName} m-0 mt-0.5 text-sm text-(--warn)`}>{blockedCount}</p>
                  </div>
                </div>

                <div className="grid gap-1.5 border border-[rgba(255,107,107,0.35)] bg-[linear-gradient(180deg,rgba(58,22,22,0.45)_0%,rgba(25,13,13,0.38)_100%)] px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="m-0 text-xs text-(--muted)">异常节点</p>
                    <button
                      className="inline-flex h-6 items-center justify-center border border-[rgba(255,107,107,0.45)] bg-[rgba(255,107,107,0.08)] px-2 text-xs font-semibold text-(--bad) hover:bg-[rgba(255,107,107,0.16)] disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      disabled={!sessionTargetAgentId}
                      onClick={() => {
                        if (!sessionTargetAgentId) return;
                        onOpenAgentSession(sessionTargetAgentId);
                      }}
                    >
                      打开会话
                    </button>
                  </div>
                  <p className={`${monoClassName} m-0 truncate text-xs text-(--text)`}>
                    {sessionTargetNode ? `${sessionTargetNode.id} · ${sessionTargetNode.title}` : "当前无失败节点"}
                  </p>
                  <p className={`${monoClassName} m-0 truncate text-xs text-(--muted)`}>
                    {structuredErrorNode
                      ? `结构化: ${structuredErrorNode.id} · ${parsePipelineError(structuredErrorNode.lastError)?.message ?? "-"}`
                      : "结构化: -"}{" "}
                    |{" "}
                    {nodeReturnErrorNode
                      ? `节点返回: ${nodeReturnErrorNode.id} · ${parsePipelineError(nodeReturnErrorNode.lastError)?.message ?? "-"}`
                      : "节点返回: -"}
                  </p>
                  <p className={`${monoClassName} m-0 truncate text-xs text-(--muted)`}>
                    {sessionTargetAgentId ? `Agent: ${sessionTargetAgentId}` : "Agent: -"}
                  </p>
                </div>

                <div className="flex items-center justify-between border-t border-(--line) pt-2 text-xs text-(--muted)">
                  <span>{`进度 ${finishedCount}/${totalCount}`}</span>
                  <span>{`更新时间 ${formatTime(latestActivityTime)}`}</span>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    className="inline-flex h-8 items-center justify-center border border-(--line) bg-[rgba(15,23,29,0.6)] px-3 text-xs text-(--text) hover:bg-[rgba(19,34,43,0.82)]"
                    type="button"
                    onClick={() => onNavigatePipeline(pipeline.id)}
                  >
                    进入流水线
                  </button>
                  <button
                    className="inline-flex h-8 items-center justify-center border border-(--live-25) bg-[rgba(50,215,186,0.1)] px-3 text-xs font-semibold text-(--live) hover:bg-[rgba(50,215,186,0.18)] disabled:cursor-not-allowed disabled:opacity-60"
                    type="button"
                    onClick={async () => {
                      setStartingPipelineId(pipeline.id);
                      try {
                        await onStartPipeline(pipeline.id);
                      } finally {
                        setStartingPipelineId((current) => (current === pipeline.id ? "" : current));
                      }
                    }}
                    disabled={isBusy}
                  >
                    {isBusy ? "工作中..." : "开始工作"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
