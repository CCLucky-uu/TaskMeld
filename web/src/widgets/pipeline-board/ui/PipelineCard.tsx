import { DragEvent, Fragment, KeyboardEvent, ReactNode, useState } from "react";
import ArrowDownIcon from "@iconify-react/lucide/arrow-down";
import ArrowUpIcon from "@iconify-react/lucide/arrow-up";
import BracesIcon from "@iconify-react/lucide/braces";
import ChevronDownIcon from "@iconify-react/lucide/chevron-down";
import ChevronRightIcon from "@iconify-react/lucide/chevron-right";
import PencilIcon from "@iconify-react/lucide/pencil";
import PlayIcon from "@iconify-react/lucide/play";
import PlugIcon from "@iconify-react/lucide/plug";
import SaveIcon from "@iconify-react/lucide/save";
import LoaderCircleIcon from "@iconify-react/lucide/loader-circle";
import SquareIcon from "@iconify-react/lucide/square";
import Trash2Icon from "@iconify-react/lucide/trash-2";
import {
  PipelineNode,
  WorkflowRemoteBatchPlugin,
} from "../../../entities/pipeline";
import { actionRowEndClassName } from "../../../shared/ui/panelClasses";
import { RemoteBatchPanel } from "./RemoteBatchPanel";
import { SchedulerCard } from "../../../widgets/scheduler-card";

type PipelineSection = {
  pipelineId: string;
  title: string;
  canDelete?: boolean;
  pipeline: PipelineNode[];
  workflowNodeOrder: string[];
  parallelGroups: Array<{ id: string; members: string[] }>;
  pluginState: WorkflowRemoteBatchPlugin;
  schedulerPluginEnabled: boolean;
  schedulerMode: string;
  schedulerEnabled: boolean;
  batchStartBatch?: string;
  isBatchOperating?: boolean;
  batchRunStatus?: string;
  batchRunProcessedItems?: number;
  batchRunTotalItems?: number;
  batchRunProcessedBatches?: number;
  batchRunTotalBatches?: number;
  batchRunBatchSize?: number;
  batchRunError?: string | null;
  isRunning: boolean;
  hasPipelineExecution: boolean;
  isEditing: boolean;
};

type PipelineCardProps = {
  sections: PipelineSection[];
  selectedNodeId: string;
  selectedGroupId: string;
  activePipelineId: string;
  onSelectNode: (pipelineId: string, nodeId: string) => void;
  onSelectGroup: (pipelineId: string, groupId: string) => void;
  onRun: (pipelineId: string) => void;
  onStop: (pipelineId: string) => void;
  deletingEntity: boolean;
  deletingPipeline?: boolean;
  savingNodeOrder: boolean;
  onToggleEditing: (pipelineId: string, editing: boolean) => void;
  onOpenWorkflowJson: (pipelineId: string) => void;
  onOpenPlugins: (pipelineId: string) => void;
  onRenamePipeline: (pipelineId: string, title: string) => Promise<{ ok: boolean; message?: string }>;
  onRequestDeletePipeline: (pipelineId: string) => void;
  onRequestDeleteNode: (pipelineId: string, nodeId: string) => void;
  onRequestDeleteGroup: (pipelineId: string, groupId: string) => void;
  onRequestCreateNode: () => void;
  onMoveNode: (
    pipelineId: string,
    nodeId: string,
    direction: "up" | "down",
  ) => void;
  onReorderNode: (
    pipelineId: string,
    nodeId: string,
    targetNodeId: string,
    position: "before" | "after",
  ) => void;
  onChangeBatchStartBatch: (pipelineId: string, value: string) => void;
  onStartRemoteKeywordBatchRun: (pipelineId: string) => void;
  onToggleScheduler: (pipelineId: string, enabled: boolean) => void;
  onSwitchSchedulerMode: (
    pipelineId: string,
    mode: "auto" | "manual",
  ) => void;
  onManualTick: (pipelineId: string) => void;
  statusTone: Record<string, string>;
  statusLabel: Record<string, string>;
};

// 流水线容器直接使用左右内边距制造留白，不再依赖额外 grid 轨道兜边距。
const pipelineGridShellClassName =
  "mb-3 overflow-hidden bg-[rgba(9,15,21,0.1)] px-3 [background-image:repeating-linear-gradient(-45deg,rgba(150,170,190,0.07)_0,rgba(150,170,190,0.07)_2px,transparent_2px,transparent_8px)]";
const pipelineGridClassName =
  // 节点高度统一为 96px，保持卡片密度与列表滚动节奏一致。
  "grid max-h-[calc(96px*2+8px+2px)] grid-flow-row auto-rows-[minmax(96px,auto)] grid-cols-[repeat(auto-fill,minmax(230px,1fr))] content-start gap-3 overflow-x-hidden overflow-y-auto pb-0";
const pipelineFrameGridTileClassName =
  "bg-[rgba(9,15,21,0.1)] [background-image:repeating-linear-gradient(-45deg,rgba(150,170,190,0.07)_0,rgba(150,170,190,0.07)_2px,transparent_2px,transparent_8px)]";
// 顶部和底部中段需要和流水线卡片同宽，并带左右描边。
const pipelineFrameHorizontalBandClassName =
  `border-x border-[#29414f]`;
// 左右立柱需要和流水线容器同高，并补上上下描边闭合外框。
const pipelineFrameVerticalRailClassName = pipelineFrameGridTileClassName;
const pipelineFrameVerticalRailBorderedClassName =
  ` border-y border-[#29414f]`;
// 标题、支线文案、空状态统一复用主体左右内边距，避免再用 grid 空轨道制造缩进。
const pipelineInsetRowClassName = "px-3";
const pipelineInsetContentClassName = "min-w-0";

const pipelineActionRowClassName = actionRowEndClassName;
const pipelineNodeActionButtonClassName =
  "inline-flex h-5 w-5 items-center justify-center border border-(--line) bg-transparent p-0.5 text-(--muted) leading-none hover:border-[#3b5568] hover:bg-[rgba(142,163,179,0.08)] hover:text-(--text) disabled:cursor-not-allowed disabled:opacity-50";
const pipelineNodeDeleteButtonClassName =
  "inline-flex h-5 w-5 items-center justify-center border border-[rgba(255,107,107,0.2)] bg-transparent  p-0.5 text-(--bad) leading-none hover:bg-[rgba(255,107,107,0.1)] disabled:cursor-not-allowed disabled:opacity-50";
// 使用伪元素单独绘制渐变描边，避免影响选中态和拖拽态已有的真实边框颜色。
const pipelineNodeBaseClassName =
  // 当前节点结构只有“内容块 + 状态操作块”两层，网格必须是两行，避免第三行空轨道制造底部空隙。
  "relative grid h-full min-h-0 w-full min-w-0 grid-rows-[minmax(0,1fr)_auto] content-start gap-1.25 overflow-hidden  border border-[color:rgb(from_var(--live)_r_g_b_/_0.06)] bg-[linear-gradient(180deg,rgb(from_var(--live)_r_g_b_/_0.22)_0%,rgba(15,25,31,0.8)_100%)] backdrop-blur-[8px] px-3 py-2 text-left text-[var(--text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_16px_32px_rgba(4,10,14,0.16)] transition-[border-color,background-color,box-shadow] before:pointer-events-none before:absolute before:inset-0  before:border before:border-transparent before:content-[''] before:[border-image:linear-gradient(180deg,rgba(120,255,230,0.38)_0%,rgba(88,214,192,0.18)_34%,rgba(50,215,186,0.06)_62%,rgba(50,215,186,0)_100%)_1] hover:border-[color:rgb(from_var(--live)_r_g_b_/_0.1)] hover:bg-[linear-gradient(180deg,rgb(from_var(--live)_r_g_b_/_0.3)_0%,rgba(18,29,35,0.86)_100%)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_34px_rgba(4,10,14,0.2)] hover:before:[border-image:linear-gradient(180deg,rgba(140,255,235,0.48)_0%,rgba(92,224,200,0.24)_34%,rgba(50,215,186,0.1)_62%,rgba(50,215,186,0)_100%)_1]";
const pipelineParallelGroupBaseClassName =
  "grid cursor-pointer gap-2 border border-[color:rgb(from_var(--live)_r_g_b_/_0.16)] bg-[linear-gradient(180deg,rgb(from_var(--live)_r_g_b_/_0.14)_0%,rgba(10,17,23,0.72)_100%)] backdrop-blur-[6px] p-2";
// 流水线分区自身也铺删格底纹，确保标题左侧和节点外侧留白不是纯色空带。
const pipelineStageBaseClassName =
  "border border-[#29414f] bg-[linear-gradient(180deg,rgba(18,31,38,0.92)_0%,rgba(14,24,30,0.92)_100%)] [background-image:repeating-linear-gradient(-45deg,rgba(150,170,190,0.07)_0,rgba(150,170,190,0.07)_2px,transparent_2px,transparent_8px)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_12px_28px_rgba(2,6,10,0.14)]";
const monoClassName = "font-[JetBrains_Mono,monospace]";
const statusTagBaseClassName =
  "inline-flex h-5 w-fit items-center justify-center px-1.5 text-[12px] leading-none uppercase";
const statusTagToneClassName = {
  good: "bg-[rgba(50,215,186,0.15)] text-(--live)",
  live: "bg-[rgba(50,215,186,0.15)] text-(--live)",
  warn: "bg-[rgba(255,184,77,0.16)] text-(--warn)",
  bad: "bg-[rgba(255,107,107,0.16)] text-(--bad)",
  muted: "bg-[rgba(142,163,179,0.2)] text-(--muted)",
} as const;
const actionButtonClassName =
  "mt-0 cursor-pointer border border-(--live-25) bg-transparent px-[10px] py-2 font-semibold text-(--live) hover:bg-[rgba(50,215,186,0.1)]";
// 顶部操作按钮统一改成图标按钮，继续复用节点卡片同组 lucide 图标，避免视觉语言不一致。
const actionIconButtonClassName =
  "mt-0 inline-flex h-8 w-8 items-center justify-center border border-(--live-25) bg-transparent p-0 text-(--live) hover:bg-[rgba(50,215,186,0.1)]";
// 新增节点入口保持和容器同主题的深色层级，避免出现发灰发白的异常底色。
const pipelineCreateEntryClassName =
  "relative grid h-full min-h-0 w-full min-w-0 content-center justify-items-center gap-1 border border-dashed border-[rgba(50,215,186,0.18)] bg-[rgba(18,31,38,0.7)] p-2.5 text-center text-(--text) shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] hover:border-[rgba(50,215,186,0.3)] hover:bg-[rgba(23,39,47,0.84)]";

// 节点卡片内部只展示关键信息：标题、ID、Agent，避免长文本挤占状态和操作区域。
const toCompactAgentLabel = (agentId: string): string => {
  const normalized = agentId.trim();
  if (!normalized) return "未配置 Agent";
  return normalized.startsWith("@") ? normalized : `@${normalized}`;
};

export function PipelineCard({
  sections,
  selectedNodeId,
  selectedGroupId,
  activePipelineId,
  onSelectNode,
  onSelectGroup,
  onRun,
  onStop,
  deletingEntity,
  deletingPipeline,
  savingNodeOrder,
  onToggleEditing,
  onOpenWorkflowJson,
  onOpenPlugins,
  onRenamePipeline,
  onRequestDeletePipeline,
  onRequestDeleteNode,
  onRequestDeleteGroup,
  onRequestCreateNode,
  onMoveNode,
  onReorderNode,
  onChangeBatchStartBatch,
  onStartRemoteKeywordBatchRun,
  onToggleScheduler,
  onSwitchSchedulerMode,
  onManualTick,
  statusTone,
  statusLabel,
}: PipelineCardProps) {
  const [draggedNodeKey, setDraggedNodeKey] = useState("");
  const [dragOverNodeId, setDragOverNodeId] = useState("");
  const [dragOverPosition, setDragOverPosition] = useState<"before" | "after">(
    "before",
  );
  // 每条流水线独立维护折叠状态，折叠后仅保留顶部栏。
  const [collapsedByPipelineId, setCollapsedByPipelineId] = useState<Record<string, boolean>>({});
  // 标题内联编辑状态：双击标题进入输入，避免额外“改名”按钮。
  const [editingTitlePipelineId, setEditingTitlePipelineId] = useState<string | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState("");

  const resetDragState = () => {
    setDraggedNodeKey("");
    setDragOverNodeId("");
    setDragOverPosition("before");
  };

  const resolveDropPosition = (
    sourceNodeId: string,
    targetElement: HTMLDivElement,
  ): "before" | "after" => {
    const sourceElement = sourceNodeId
      ? document.querySelector<HTMLElement>(
          `[data-pipeline-node-id="${sourceNodeId}"]`,
        )
      : null;
    if (!sourceElement) return "before";
    const relation = targetElement.compareDocumentPosition(sourceElement);
    // source 在 target 前面时，拖到 target 上默认应理解成“放到 target 后面”。
    return (relation & Node.DOCUMENT_POSITION_PRECEDING) !== 0
      ? "after"
      : "before";
  };

  const handleNodeDragStart = (
    event: DragEvent<HTMLDivElement>,
    pipelineId: string,
    isEditing: boolean,
    nodeId: string,
  ) => {
    if (!isEditing || savingNodeOrder) return;
    const dragKey = `${pipelineId}:${nodeId}`;
    // 拖拽状态需要携带 pipeline 维度，避免多条流水线共存时把来源节点识别错。
    setDraggedNodeKey(dragKey);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragKey);
  };

  const handleNodeDragOver = (
    event: DragEvent<HTMLDivElement>,
    pipelineId: string,
    isEditing: boolean,
    nodeId: string,
  ) => {
    const currentDragKey = `${pipelineId}:${nodeId}`;
    if (
      !isEditing ||
      savingNodeOrder ||
      !draggedNodeKey ||
      draggedNodeKey === currentDragKey
    )
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const [, sourceNodeId] = draggedNodeKey.split(":");
    // 拖到更后的卡片默认理解为“放到它后面”，拖到更前的卡片默认理解为“放到它前面”。
    const nextDragOverPosition = resolveDropPosition(
      sourceNodeId ?? "",
      event.currentTarget,
    );
    if (dragOverNodeId !== nodeId) {
      setDragOverNodeId(nodeId);
    }
    if (dragOverPosition !== nextDragOverPosition) {
      setDragOverPosition(nextDragOverPosition);
    }
  };

  const handleNodeDrop = (
    event: DragEvent<HTMLDivElement>,
    pipelineId: string,
    isEditing: boolean,
    nodeId: string,
  ) => {
    if (!isEditing || savingNodeOrder) return;
    event.preventDefault();
    const sourceNodeId =
      event.dataTransfer.getData("text/plain") || draggedNodeKey;
    resetDragState();
    if (!sourceNodeId || sourceNodeId === nodeId) return;
    const [sourcePipelineId, pureNodeId] = sourceNodeId.split(":");
    if (sourcePipelineId !== pipelineId || !pureNodeId || pureNodeId === nodeId)
      return;
    const dropPosition = resolveDropPosition(pureNodeId, event.currentTarget);
    onReorderNode(pipelineId, pureNodeId, nodeId, dropPosition);
  };

  const renderNode = (
    pipelineId: string,
    node: PipelineNode,
    isEditing: boolean,
    hasPipelineExecution: boolean,
  ) => {
    const displayStatus = resolveDisplayStatus(
      node.status,
      hasPipelineExecution,
    );
    const pipelineNodeClassName = [
      pipelineNodeBaseClassName,
      selectedNodeId === node.id && activePipelineId === pipelineId
        ? "border-[#32d7ba]"
        : "",
      isEditing ? "cursor-grab active:cursor-grabbing" : "",
      savingNodeOrder ? "cursor-wait opacity-70" : "",
      dragOverNodeId === node.id
        ? `border-[#32d7ba] bg-[linear-gradient(180deg,rgb(from_var(--live)_r_g_b_/_0.38)_0%,rgba(18,33,40,0.94)_100%)] ${dragOverPosition === "before" ? "shadow-[inset_0_2px_0_#32d7ba]" : "shadow-[inset_0_-2px_0_#32d7ba]"}`
        : "",
    ].join(" ");

    return (
      <div
        key={node.id}
        className={pipelineNodeClassName}
        data-pipeline-node-id={node.id}
        onClick={(event) => {
          event.stopPropagation();
          onSelectNode(pipelineId, node.id);
        }}
        onKeyDown={(event) => handleNodeKeyDown(event, pipelineId, node.id)}
        onDragStart={(event) =>
          handleNodeDragStart(event, pipelineId, isEditing, node.id)
        }
        onDragOver={(event) =>
          handleNodeDragOver(event, pipelineId, isEditing, node.id)
        }
        onDragLeave={() => {
          if (dragOverNodeId === node.id) setDragOverNodeId("");
        }}
        onDrop={(event) =>
          handleNodeDrop(event, pipelineId, isEditing, node.id)
        }
        onDragEnd={resetDragState}
        role="button"
        tabIndex={0}
        draggable={isEditing && !savingNodeOrder}
      >
        <div className="min-w-0 space-y-1">
          <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-base leading-tight font-medium">
            {node.title}
          </strong>
          <div className="flex min-w-0 items-center gap-2 text-xs leading-none text-(--muted)">
            <small
              className={`${monoClassName} inline-block max-w-[45%] overflow-hidden text-ellipsis whitespace-nowrap text-xs`}
              title={node.id}
            >
              #{node.id}
            </small>
            <small
              className={`${monoClassName} inline-block flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-right text-xs`}
              title={node.executor.agentId}
            >
              {toCompactAgentLabel(node.executor.agentId)}
            </small>
          </div>
        </div>
        <div className="flex items-end justify-between gap-2">
          <small
            className={`${statusTagBaseClassName} ${statusTagToneClassName[(statusTone[displayStatus] ?? "muted") as keyof typeof statusTagToneClassName]}`}
          >
            {statusLabel[displayStatus]}
          </small>
          {isEditing ? (
            <div className="flex items-center gap-1.5 self-end">
              <button
                className={pipelineNodeActionButtonClassName}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onMoveNode(pipelineId, node.id, "up");
                }}
                disabled={deletingEntity || savingNodeOrder}
                aria-label="上移节点"
                title="上移节点"
              >
                <ArrowUpIcon className="h-full w-full" />
              </button>
              <button
                className={pipelineNodeActionButtonClassName}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onMoveNode(pipelineId, node.id, "down");
                }}
                disabled={deletingEntity || savingNodeOrder}
                aria-label="下移节点"
                title="下移节点"
              >
                <ArrowDownIcon className="h-full w-full" />
              </button>
              <button
                className={pipelineNodeDeleteButtonClassName}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onRequestDeleteNode(pipelineId, node.id);
                }}
                disabled={deletingEntity || savingNodeOrder}
                aria-label="删除节点"
                title="删除节点"
              >
                <Trash2Icon className="h-full w-full" />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const resolveDisplayStatus = (
    status: PipelineNode["status"],
    hasPipelineExecution: boolean,
  ) =>
    !hasPipelineExecution && (status === "queued" || status === "blocked")
      ? "ready"
      : status;

  const handleNodeKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    pipelineId: string,
    nodeId: string,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelectNode(pipelineId, nodeId);
  };

  const renderInsetBlock = (
    content: ReactNode,
    options?: {
      wrapperClassName?: string;
      contentClassName?: string;
    },
  ) => (
    <div className={`${pipelineInsetRowClassName} ${options?.wrapperClassName ?? ""}`.trim()}>
      <div className={`${pipelineInsetContentClassName} ${options?.contentClassName ?? ""}`.trim()}>
        {content}
      </div>
    </div>
  );

  const renderEmptyState = (
    message: string,
    options?: {
      wrapperClassName?: string;
      contentClassName?: string;
      padded?: boolean;
    },
  ) =>
    renderInsetBlock(message, {
      wrapperClassName: options?.wrapperClassName,
      // 空状态统一走同一套边框和字色，差异只允许由调用方补充外层间距或内层 padding。
      contentClassName: [
        `${monoClassName} border border-dashed border-[#2b3e4d] text-xs text-[#6f8798]`,
        options?.padded === false ? "" : "p-3",
        options?.contentClassName ?? "",
      ]
        .filter(Boolean)
        .join(" "),
    });

  const renderLane = (
    pipelineId: string,
    nodes: PipelineNode[],
    workflowNodeOrder: string[],
    parallelGroups: Array<{ id: string; members: string[] }>,
    laneClassName: string,
    isEditing: boolean,
    hasPipelineExecution: boolean,
    showCreateEntry: boolean,
  ) => {
    if (nodes.length === 0) return null;
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const groupById = new Map(parallelGroups.map((group) => [group.id, group]));
    const groupIdByMemberId = new Map<string, string>();
    for (const group of parallelGroups) {
      for (const memberId of group.members) {
        groupIdByMemberId.set(memberId, group.id);
      }
    }
    const workflowOrderIndexById = new Map(
      workflowNodeOrder.map((nodeId, index) => [nodeId, index]),
    );
    // 运行态节点顺序可能滞后于 workflow 持久化顺序；
    // DAG 面板优先按 workflow 顺序渲染，避免“新增后只跑到底部”的错位显示。
    const orderedNodes = [...nodes].sort((left, right) => {
      const leftIndex =
        workflowOrderIndexById.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex =
        workflowOrderIndexById.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return left.id.localeCompare(right.id);
    });
    const orderedBlocks: Array<
      { type: "node"; node: PipelineNode } | { type: "group"; groupId: string }
    > = [];
    const renderedGroupIds = new Set<string>();
    for (const node of orderedNodes) {
      const groupId = groupIdByMemberId.get(node.id)?.trim();
      if (!groupId) {
        orderedBlocks.push({ type: "node", node });
        continue;
      }
      if (renderedGroupIds.has(groupId)) continue;
      const groupMembers = (groupById.get(groupId)?.members ?? [])
        .map((memberId) => nodeById.get(memberId))
        .filter((member): member is PipelineNode => Boolean(member));
      if (groupMembers.length < 2) {
        orderedBlocks.push({ type: "node", node });
        continue;
      }
      renderedGroupIds.add(groupId);
      orderedBlocks.push({ type: "group", groupId });
    }

    return (
      <div className={pipelineGridShellClassName}>
        <div className={`${pipelineGridClassName} ${laneClassName}`}>
        {orderedBlocks.map((block) =>
          block.type === "node" ? (
            renderNode(pipelineId, block.node, isEditing, hasPipelineExecution)
          ) : (
            <div
              className={`${pipelineParallelGroupBaseClassName} ${selectedGroupId === block.groupId && activePipelineId === pipelineId ? "border-[#32d7ba]" : ""}`}
              key={block.groupId}
              data-pipeline-group-id={block.groupId}
              onClick={() => onSelectGroup(pipelineId, block.groupId)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelectGroup(pipelineId, block.groupId);
              }}
              role="button"
              tabIndex={0}
            >
              {isEditing ? (
                <button
                  className={`${pipelineNodeActionButtonClassName}`}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRequestDeleteGroup(pipelineId, block.groupId);
                  }}
                  disabled={deletingEntity}
                >
                  删除组
                </button>
              ) : null}
              <div className={`${monoClassName} text-xs text-[#95b4c8]`}>
                并行组: {block.groupId}
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
                {(groupById.get(block.groupId)?.members ?? [])
                  .map((memberId) => nodeById.get(memberId))
                  .filter((member): member is PipelineNode => Boolean(member))
                  .map((member) =>
                    renderNode(
                      pipelineId,
                      member,
                      isEditing,
                      hasPipelineExecution,
                    ),
                  )}
              </div>
            </div>
          ),
        )}
        {showCreateEntry ? (
          <button
            className={pipelineCreateEntryClassName}
            type="button"
            onClick={onRequestCreateNode}
          >
            {/* 新增入口跟随当前编辑中的流水线网格渲染，避免始终掉到整页最底部。 */}
            <span className={`${monoClassName} text-[18px]`}>+</span>
            <strong>新增对象</strong>
            <small>点击创建节点或并行组</small>
          </button>
        ) : null}
        </div>
      </div>
    );
  };

  const renderPipelineSection = ({
    pipelineId,
    title,
    canDelete,
    nodes,
    workflowNodeOrder,
    parallelGroups,
    branchNodes,
    pluginState,
    schedulerPluginEnabled,
    schedulerMode,
    schedulerEnabled,
    batchStartBatch,
    isBatchOperating,
    batchRunStatus,
    batchRunProcessedItems,
    batchRunTotalItems,
    batchRunProcessedBatches,
    batchRunTotalBatches,
    batchRunBatchSize,
    batchRunError,
    isRunning,
    hasPipelineExecution,
    isEditing,
    tone = "default",
    showActions,
    emptyMessage,
    showTopBand = true,
    showBottomBand = true,
    collapsed = false,
  }: {
    pipelineId: string;
    title: string;
    canDelete?: boolean;
    nodes: PipelineNode[];
    workflowNodeOrder: string[];
    parallelGroups: Array<{ id: string; members: string[] }>;
    branchNodes?: PipelineNode[];
    pluginState: WorkflowRemoteBatchPlugin;
    schedulerPluginEnabled: boolean;
    schedulerMode: string;
    schedulerEnabled: boolean;
    batchStartBatch?: string;
    isBatchOperating?: boolean;
    batchRunStatus?: string;
    batchRunProcessedItems?: number;
    batchRunTotalItems?: number;
    batchRunProcessedBatches?: number;
    batchRunTotalBatches?: number;
    batchRunBatchSize?: number;
    batchRunError?: string | null;
    isRunning: boolean;
    hasPipelineExecution: boolean;
    isEditing: boolean;
    tone?: "default" | "primary" | "secondary";
    showActions?: boolean;
    emptyMessage?: string;
    showTopBand?: boolean;
    showBottomBand?: boolean;
    collapsed?: boolean;
  }) => {
    const resolvedSectionClassName =
      tone === "primary"
        ? "border-[#29414f]"
        : tone === "secondary"
          ? "border-[#29414f]"
          : "";
    const batchStatusText =
      batchRunStatus !== undefined
        ? `status=${batchRunStatus} | ${batchRunProcessedItems ?? 0}/${batchRunTotalItems ?? 0} | batch ${batchRunProcessedBatches ?? 0}/${batchRunTotalBatches ?? 0} | size=${
            batchRunStatus === "idle" ? 5 : (batchRunBatchSize ?? 0)
          }${batchRunError ? ` | error=${batchRunError}` : ""}`
        : "暂无批跑状态";
    const isRemoteBatchEnabled = pluginState.enabled;
    const hasRunningNode = [...nodes, ...(branchNodes ?? [])].some((node) => node.status === "running");
    const canStopPipeline = Boolean(isRunning || batchRunStatus === "running" || hasRunningNode);
    const isPrimaryActionBusy = isRemoteBatchEnabled
      ? Boolean(isBatchOperating) || batchRunStatus === "running"
      : canStopPipeline;
    // 外层框体继续保留原来的三列删格风格，避免影响整体视觉骨架。
    const pipelineFrameClassName = `grid grid-cols-[32px_minmax(0,1fr)_32px] ${
      showTopBand && showBottomBand
        ? "grid-rows-[32px_auto_32px]"
        : showTopBand
          ? "grid-rows-[32px_auto]"
          : showBottomBand
            ? "grid-rows-[auto_32px]"
            : "grid-rows-[auto]"
    }`;
    const sectionRowClassName = showTopBand ? "row-start-2" : "row-start-1";
    const bandRowClassName = showTopBand ? "row-start-3" : "row-start-2";
    const isCollapsed = collapsed === true;
    const isEditingTitle = editingTitlePipelineId === pipelineId;

    const commitInlineTitleRename = async () => {
      const nextTitle = editingTitleValue.trim();
      if (!nextTitle) {
        setEditingTitleValue(title);
        setEditingTitlePipelineId(null);
        return;
      }
      if (nextTitle === title.trim()) {
        setEditingTitlePipelineId(null);
        return;
      }
      const result = await onRenamePipeline(pipelineId, nextTitle);
      if (result.ok) {
        setEditingTitlePipelineId(null);
      }
    };

    return (
      <div key={pipelineId} className={`${pipelineFrameClassName} scroll-mt-16`} data-pipeline-section-id={pipelineId}>
        {showTopBand ? (
          <>
            <div className={pipelineFrameGridTileClassName} aria-hidden="true" />
            <div className={pipelineFrameHorizontalBandClassName} aria-hidden="true" />
            <div className={pipelineFrameGridTileClassName} aria-hidden="true" />
          </>
        ) : null}
        <div className={`${pipelineFrameVerticalRailBorderedClassName} ${sectionRowClassName}`} aria-hidden="true" />
        <section
          className={`${pipelineStageBaseClassName} ${resolvedSectionClassName} ${sectionRowClassName}`.trim()}
        >
        <div className={`${pipelineInsetRowClassName} ${isCollapsed ? "border-b-0 mb-0" : "border-b border-(--line) mb-3"} bg-transparent`}>
          <div className={`${pipelineInsetContentClassName} flex items-center justify-between gap-3 max-[760px]:flex-col`}>
          <div>
            {/* 标题行高按文字实际占高收紧，并按要求改成斜体。 */}
            {isEditingTitle ? (
              <input
                className={`${monoClassName} h-8 w-[min(420px,58vw)] border border-(--line) bg-[rgba(15,23,29,0.82)] px-2 text-sm italic text-(--text) outline-none focus:border-(--live)`}
                value={editingTitleValue}
                onChange={(event) => setEditingTitleValue(event.target.value)}
                onBlur={() => {
                  void commitInlineTitleRename();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void commitInlineTitleRename();
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setEditingTitleValue(title);
                    setEditingTitlePipelineId(null);
                  }
                }}
                autoFocus
              />
            ) : (
              <p
                className="m-0 cursor-text whitespace-nowrap text-base font-medium italic leading-none"
                title="双击修改标题"
                onDoubleClick={() => {
                  setEditingTitlePipelineId(pipelineId);
                  setEditingTitleValue(title);
                }}
              >
                {title}
              </p>
            )}
          </div>
          {showActions ? (
            <div className="flex w-full min-w-0 flex-wrap gap-2  ml-auto justify-end">
              <button
                className={actionIconButtonClassName}
                onClick={() =>
                  setCollapsedByPipelineId((prev) => ({
                    ...prev,
                    [pipelineId]: !isCollapsed,
                  }))
                }
                aria-label={isCollapsed ? "展开流水线" : "折叠流水线"}
                title={isCollapsed ? "展开流水线" : "折叠流水线"}
              >
                {isCollapsed ? (
                  <ChevronRightIcon className="h-4 w-4" />
                ) : (
                  <ChevronDownIcon className="h-4 w-4" />
                )}
              </button>
              <button
                className={`${actionIconButtonClassName} ${canStopPipeline ? "border-[rgba(255,107,107,0.35)] text-(--bad) hover:bg-[rgba(255,107,107,0.1)]" : "border-(--line) text-(--muted)"}`}
                onClick={() => onStop(pipelineId)}
                disabled={!canStopPipeline || Boolean(isBatchOperating)}
                aria-label={canStopPipeline ? "停止流水线" : "流水线未运行"}
                title={canStopPipeline ? "停止流水线" : "流水线未运行"}
              >
                <SquareIcon className="h-3.5 w-3.5" />
              </button>
              <button
                className={actionIconButtonClassName}
                onClick={() => {
                  if (isRemoteBatchEnabled) {
                    onStartRemoteKeywordBatchRun(pipelineId);
                    return;
                  }
                  onRun(pipelineId);
                }}
                disabled={isPrimaryActionBusy}
                aria-label={
                  isRemoteBatchEnabled
                    ? isPrimaryActionBusy
                      ? "远程批跑中"
                      : "启动远程批跑"
                    : isRunning
                      ? "运行启动中"
                      : "启动运行"
                }
                title={
                  isRemoteBatchEnabled
                    ? isPrimaryActionBusy
                      ? "远程批跑中"
                      : "启动远程批跑"
                    : isRunning
                      ? "运行启动中"
                      : "启动运行"
                }
              >
                {isPrimaryActionBusy ? (
                  <LoaderCircleIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <PlayIcon className="h-4 w-4" />
                )}
              </button>
              <button
                className={actionIconButtonClassName}
                onClick={() => onOpenPlugins(pipelineId)}
                aria-label="插件配置"
                title="插件配置"
              >
                <PlugIcon className="h-4 w-4" />
              </button>
              <button
                className={actionIconButtonClassName}
                onClick={() => onOpenWorkflowJson(pipelineId)}
                aria-label="查看工作流 JSON"
                title="查看工作流 JSON"
              >
                <BracesIcon className="h-4 w-4" />
              </button>
              <button
                className={`${actionIconButtonClassName} ${isEditing ? "border-(--warn) text-(--warn) hover:bg-[rgba(255,184,77,0.12)]" : ""}`}
                onClick={() => onToggleEditing(pipelineId, !isEditing)}
                aria-label={isEditing ? "保存编辑" : "进入编辑"}
                title={isEditing ? "保存编辑" : "进入编辑"}
              >
                {isEditing ? (
                  <SaveIcon className="h-4 w-4" />
                ) : (
                  <PencilIcon className="h-4 w-4" />
                )}
              </button>
              <button
                className={actionIconButtonClassName}
                onClick={() => onRequestDeletePipeline(pipelineId)}
                disabled={!canDelete || deletingPipeline}
                aria-label="删除流水线"
                title={!canDelete ? "至少保留一条流水线" : "删除流水线"}
              >
                <Trash2Icon className="h-4 w-4" />
              </button>
            </div>
          ) : null}
          </div>
        </div>
        {!isCollapsed && schedulerPluginEnabled ? (
          <SchedulerCard
            pipelineId={pipelineId}
            schedulerMode={schedulerMode}
            schedulerEnabled={schedulerEnabled}
            onToggleScheduler={() =>
              onToggleScheduler(pipelineId, !schedulerEnabled)
            }
            onSwitchSchedulerMode={() =>
              onSwitchSchedulerMode(
                pipelineId,
                schedulerMode === "manual" ? "auto" : "manual",
              )
            }
            onManualTick={() => onManualTick(pipelineId)}
            embedded
          />
        ) : null}
        {!isCollapsed && pluginState.enabled ? (
          <RemoteBatchPanel
            title={`远程关键词池批跑（DAG-${pipelineId}）`}
            statusText={batchStatusText}
            startBatch={batchStartBatch ?? "1"}
            isOperating={Boolean(isBatchOperating)}
            onChangeStartBatch={(value) =>
              onChangeBatchStartBatch(pipelineId, value)
            }
          />
        ) : null}
        {!isCollapsed && nodes.length > 0 ? (
          renderLane(
            pipelineId,
            nodes,
            workflowNodeOrder,
            parallelGroups,
            "max-h-none",
            isEditing,
            hasPipelineExecution,
            isEditing,
          )
        ) : !isCollapsed ? (
          <div className={pipelineGridShellClassName}>
            <div className={`${pipelineGridClassName} max-h-none`}>
              {renderEmptyState(emptyMessage ?? "暂无节点", {
                wrapperClassName: "px-0",
              })}
              {isEditing ? (
                <button
                  className={pipelineCreateEntryClassName}
                  type="button"
                  onClick={onRequestCreateNode}
                >
                  {/* 空流水线也要把新增入口放在当前 DAG 区块内，保持交互位置一致。 */}
                  <span className={`${monoClassName} text-[18px]`}>+</span>
                  <strong>新增对象</strong>
                  <small>点击创建节点或并行组</small>
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {!isCollapsed && branchNodes ? (
          <div>
            {renderInsetBlock("支线节点", {
              contentClassName: `${monoClassName} mb-2 text-xs text-[#8da2b3]`,
            })}
            {branchNodes.length > 0 ? (
              renderLane(
                pipelineId,
                branchNodes,
                workflowNodeOrder,
                parallelGroups,
                "max-h-none",
                isEditing,
                hasPipelineExecution,
                false,
              )
            ) : (
              renderEmptyState("暂无支线节点（可在 workflow.lane=branch 后显示）", {
                wrapperClassName: "mb-3",
                contentClassName: "p-2.5",
              })
            )}
          </div>
        ) : null}
        </section>
        <div className={`${pipelineFrameVerticalRailBorderedClassName} ${sectionRowClassName}`} aria-hidden="true" />
        {showBottomBand ? (
          <>
            <div className={`${pipelineFrameGridTileClassName} ${bandRowClassName}`} aria-hidden="true" />
            <div className={`${pipelineFrameHorizontalBandClassName} ${bandRowClassName}`} aria-hidden="true" />
            <div className={`${pipelineFrameGridTileClassName} ${bandRowClassName}`} aria-hidden="true" />
          </>
        ) : null}
      </div>
    );
  };

  return (
    <section data-center-card data-pipeline-card className="min-w-0">
      {sections.map((section, index) => {
        const isSectionCollapsed = collapsedByPipelineId[section.pipelineId] === true;
        const mainlineNodes = section.pipeline.filter(
          (node) => node.lane !== "branch",
        );
        const branchNodes = section.pipeline.filter(
          (node) => node.lane === "branch",
        );
        const sectionNode = renderPipelineSection({
          pipelineId: section.pipelineId,
          title: section.title,
          canDelete: section.canDelete,
          nodes: mainlineNodes,
          workflowNodeOrder: section.workflowNodeOrder,
          parallelGroups: section.parallelGroups,
          branchNodes,
          pluginState: section.pluginState,
          schedulerPluginEnabled: section.schedulerPluginEnabled,
          schedulerMode: section.schedulerMode,
          schedulerEnabled: section.schedulerEnabled,
          batchStartBatch: section.batchStartBatch,
          isBatchOperating: section.isBatchOperating,
          batchRunStatus: section.batchRunStatus,
          batchRunProcessedItems: section.batchRunProcessedItems,
          batchRunTotalItems: section.batchRunTotalItems,
          batchRunProcessedBatches: section.batchRunProcessedBatches,
          batchRunTotalBatches: section.batchRunTotalBatches,
          batchRunBatchSize: section.batchRunBatchSize,
          batchRunError: section.batchRunError,
          isRunning: section.isRunning,
          hasPipelineExecution: section.hasPipelineExecution,
          isEditing: section.isEditing,
          tone: index === 0 ? "primary" : "secondary",
          showActions: true,
          emptyMessage: `当前流水线 ${section.pipelineId} 暂无节点`,
          showTopBand: index === 0,
          showBottomBand: true,
          collapsed: isSectionCollapsed,
        });
        if (index === 0) return sectionNode;
        return <Fragment key={`pipeline-block-${section.pipelineId}`}>{sectionNode}</Fragment>;
      })}
    </section>
  );
}
