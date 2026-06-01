import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentListCard } from "../../../widgets/agent-list/ui/AgentListCard";
import { NavPanel } from "../../../widgets/nav-panel/ui/NavPanel";
import { GroupDetailPanel, NodeDetailPanel } from "../../../widgets/node-detail";
import { PipelineCard } from "../../../widgets/pipeline-board/ui/PipelineCard";
import { PipelinePluginModal } from "../../../widgets/pipeline-board/ui/PipelinePluginModal";
import { PipelineDispatchBoard } from "../../../widgets/pipeline-dispatch-board/ui/PipelineDispatchBoard";
import { SessionModal } from "../../../widgets/session-modal/ui/SessionModal";
import { RunLogPage } from "../../../widgets/run-log-viewer";
import { TopBar } from "../../../widgets/top-bar/ui/TopBar";
import { OverviewBoard } from "../../../widgets/overview-board/ui/OverviewBoard";
import { ArtifactBoard } from "../../../widgets/artifact-board";
import { SettingsBoard } from "../../../widgets/settings-board/ui/SettingsBoard";
import { CloseIcon, InlineSelect } from "../../../shared/ui";
import { useMediaQuery } from "../../../shared/lib/useMediaQuery";
import { actionRowClassName, panelHeaderClassName } from "../../../shared/ui/panelClasses";
import { detailPanelShellClassName } from "../../../widgets/node-detail/ui/detailPanelClasses";
import {
  controlInputClassName,
  controlInputMonoClassName,
  controlSingleLineClassName,
  controlSingleLineMonoClassName,
  controlTextAreaMonoClassName,
  drawerCloseClassName,
  modalFrameBaseClassName,
  modalFrameClosedClassName,
  modalFrameOpenClassName,
  modalMaskBaseClassName,
  modalMaskClosedClassName,
  modalMaskOpenClassName,
  modalPanelBaseClassName,
  modalSublineClassName,
} from "../../../shared/ui/surfaceClassNames";
import { controlPlaneNavItems } from "../model/controlPlaneNavItems";
import { useControlPlanePage } from "../model/useControlPlanePage";
import type { NavKey } from "../../../widgets/nav-panel/model/navItem";
import PlusIcon from "@iconify-react/lucide/plus";
const smallModalPanelClassName = `${modalPanelBaseClassName} w-[min(560px,94vw)]`;
const outputModalPanelClassName =
  `${modalPanelBaseClassName} grid max-h-[90vh] w-[min(980px,96vw)] grid-rows-[auto_auto_minmax(0,1fr)] gap-[10px] max-[760px]:h-screen max-[760px]:max-h-screen max-[760px]:w-screen`;
const workflowModalPanelClassName =
  `${modalPanelBaseClassName} max-h-[90vh] w-[min(1100px,96vw)] max-[760px]:h-screen max-[760px]:max-h-screen max-[760px]:w-screen`;
const monoClassName = "font-[JetBrains_Mono,monospace]";
const fieldClassName = "mx-3 min-w-0";
const fieldLabelClassName = "mb-1.5 block text-xs text-[var(--muted)]";
const actionButtonClassName =
  "mt-0 cursor-pointer border border-[var(--live-25)] bg-transparent px-[10px] py-2 font-semibold text-[var(--live)] hover:bg-[rgba(50,215,186,0.1)]";
// Pipeline create button: fixed 32px height, strip vertical padding from its row.
const pipelineCreateButtonClassName =
  "mt-0 inline-flex h-8 items-center justify-center cursor-pointer border border-[var(--live-25)] bg-[rgba(12,21,27,0.96)] px-[10px] text-[13px] font-semibold text-[var(--live)] hover:bg-[rgba(18,31,38,0.98)]";

const statusTone: Record<string, string> = {
  ready: "muted",
  success: "good",
  running: "live",
  blocked: "warn",
  waiting: "warn",
  rejected: "warn",
  skipped: "muted",
  stopped: "muted",
  queued: "muted",
  failed: "bad",
};

const statusLabel: Record<string, string> = {
  ready: "ready",
  connecting: "connecting",
  ws_open: "ws_open",
  challenged: "challenged",
  connect_sent: "connect_sent",
  idle: "idle",
  failed: "failed",
  success: "success",
  running: "running",
  blocked: "blocked",
  waiting: "waiting",
  rejected: "rejected",
  skipped: "skipped",
  stopped: "stopped",
  queued: "queued",
};

type ModalLayerProps = {
  open: boolean;
  onClose: () => void;
  panelClassName: string;
  /** Screen-reader accessible modal title */
  ariaLabel: string;
  children: React.ReactNode;
};

function ModalLayer({ open, onClose, panelClassName, ariaLabel, children }: ModalLayerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Close on Escape key
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      onCloseRef.current();
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    document.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus panel so screen readers pick up the context change
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <>
      <div
        className={`${modalMaskBaseClassName} ${modalMaskOpenClassName}`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`${modalFrameBaseClassName} ${modalFrameOpenClassName}`}
        aria-hidden
        onClick={onClose}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          tabIndex={-1}
          className={`${panelClassName} outline-none`}
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      </aside>
    </>
  );
}

type ControlPlanePageProps = {
  pageRoute?: "home" | "pipeline" | "logs" | "agents" | "artifacts" | "settings";
  initialActive?: NavKey;
  onNavigateByNav?: (label: NavKey, pipelineId?: string) => void;
  onNavigateHome?: () => void;
  focusPipelineId?: string;
};

export function ControlPlanePage({
  pageRoute = "home",
  initialActive = "overview",
  onNavigateByNav,
  onNavigateHome,
  focusPipelineId,
}: ControlPlanePageProps) {
  const { t } = useTranslation(["modal", "common", "nav", "pipeline", "agent"]);
  const translatedStatusLabel = useMemo(() => Object.fromEntries(
    Object.entries(statusLabel).map(([key, val]) => [key, t(`common:status.${val}`)]),
  ), [t]);
  const vm = useControlPlanePage();
  const effectivePageRoute: "home" | "pipeline" | "logs" | "agents" | "artifacts" | "settings" = pageRoute;
  const isPipelineRoute = effectivePageRoute === "pipeline";

  const ROUTE_TEXT_MAP: Record<string, string> = {
    pipeline: "nav:pipeline",
    logs: "nav:logs",
    agents: "nav:agents",
    artifacts: "nav:artifacts",
    settings: "nav:settings",
    overview: "nav:overview",
  };
  const routeText = t(ROUTE_TEXT_MAP[effectivePageRoute] ?? "nav:overview");
  const onSelectNode = useCallback(
    (pipelineId: string, nodeId: string) => {
      vm.selectNodeInPipeline(pipelineId, nodeId);
      if (nodeId) setDetailCollapsed(false);
    },
    [vm.selectNodeInPipeline],
  );
  const onSelectGroup = useCallback(
    (pipelineId: string, groupId: string) => {
      vm.selectGroupInPipeline(pipelineId, groupId);
      if (groupId) setDetailCollapsed(false);
    },
    [vm.selectGroupInPipeline],
  );
  const onReorderNode = useCallback(
    (pipelineId: string, nodeId: string, targetNodeId: string, position: "before" | "after") => {
      vm.selectNodeInPipeline(pipelineId, nodeId);
      void vm.reorderNode(pipelineId, nodeId, targetNodeId, position);
    },
    [vm.selectNodeInPipeline, vm.reorderNode],
  );
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [navCollapsed, setNavCollapsed] = useState(false);
  // Close drawer when window resizes below mobile breakpoint to avoid mid-frame flicker
  useLayoutEffect(() => {
    if (isMobile) setNavCollapsed(true);
  }, [isMobile]);
  const [detailCollapsed, setDetailCollapsed] = useState(true);
  const [workflowJsonModalOpen, setWorkflowJsonModalOpen] = useState(false);
  const [pluginModalPipelineId, setPluginModalPipelineId] = useState<string | null>(null);
  const [createPipelineModalOpen, setCreatePipelineModalOpen] = useState(false);
  const [createPipelineId, setCreatePipelineId] = useState("");
  const [createPipelineTitle, setCreatePipelineTitle] = useState("");
  const [createPipelineCloneEnabled, setCreatePipelineCloneEnabled] = useState(false);
  const [createPipelineCloneFrom, setCreatePipelineCloneFrom] = useState("");
  const [createPipelineError, setCreatePipelineError] = useState("");
  const [renamePipelineTargetId, setRenamePipelineTargetId] = useState<string | null>(null);
  const [renamePipelineTitle, setRenamePipelineTitle] = useState("");
  const [renamePipelineError, setRenamePipelineError] = useState("");
  const [deletePipelineTargetId, setDeletePipelineTargetId] = useState<string | null>(null);
  const [deletePipelineError, setDeletePipelineError] = useState("");
  const [createAgentModalOpen, setCreateAgentModalOpen] = useState(false);
  const [createAgentName, setCreateAgentName] = useState("");
  const [createAgentWorkspace, setCreateAgentWorkspace] = useState("");
  const [createAgentWorkspaceRoot, setCreateAgentWorkspaceRoot] = useState("");
  const [createAgentError, setCreateAgentError] = useState("");
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [editAgentModalOpen, setEditAgentModalOpen] = useState(false);
  const [editAgentId, setEditAgentId] = useState("");
  const [editAgentName, setEditAgentName] = useState("");
  const [editAgentWorkspace, setEditAgentWorkspace] = useState("");
  const [editAgentError, setEditAgentError] = useState("");
  const [isUpdatingAgent, setIsUpdatingAgent] = useState(false);
  const [deleteAgentModalOpen, setDeleteAgentModalOpen] = useState(false);
  const [deleteAgentId, setDeleteAgentId] = useState("");
  const [deleteAgentFiles, setDeleteAgentFiles] = useState(false);
  const [deleteAgentError, setDeleteAgentError] = useState("");
  const [isDeletingAgent, setIsDeletingAgent] = useState(false);
  const [dispatchBoardOpen, setDispatchBoardOpen] = useState(false);
  const renamePipelineTarget = vm.pipelineList.find((item) => item.id === renamePipelineTargetId) ?? null;
  const deletePipelineTarget = vm.pipelineList.find((item) => item.id === deletePipelineTargetId) ?? null;
  // Mobile: sidebar renders as a floating drawer, not part of the layout grid.
  const pageLayoutClassName = isMobile
    ? "grid h-screen overflow-hidden grid-cols-[minmax(0,1fr)]"
    : [
        "grid h-screen overflow-hidden",
        navCollapsed ? "grid-cols-[53px_minmax(0,1fr)]" : "grid-cols-[210px_minmax(0,1fr)]",
      ].join(" ");
  const contentLayoutClassName = "grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden";
  const shellLayoutClassName = [
    // Main area must only take the row below TopBar, so the right panel doesn't stretch the grid past the viewport.
    "grid h-full min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden border-b border-r border-[var(--line)]",
    !isPipelineRoute
      ? "grid-cols-[minmax(0,1fr)]"
      : detailCollapsed
        ? "grid-cols-[minmax(0,1fr)_0px]"
        : "grid-cols-[minmax(0,1fr)_300px]",
  ].join(" ");
  const centerColumnClassName = [
    `flex min-h-0 min-w-0 flex-col ${
      effectivePageRoute === "settings"
        ? "overflow-visible"
        : `overflow-x-hidden ${
            effectivePageRoute === "agents" || effectivePageRoute === "pipeline" || effectivePageRoute === "artifacts"
              ? "overflow-y-hidden"
              : "overflow-y-auto"
          }`
    } border-r border-[var(--line)]`,
    "[&>[data-center-card]]:min-h-0 [&>[data-center-card]]:min-w-0 [&>[data-center-card]]:shrink-0 [&>[data-center-card]]:border-b [&>[data-center-card]]:border-[var(--line)]",
    "[&>[data-pipeline-card]]:shrink [&>[data-pipeline-card]]:flex-1 [&>[data-pipeline-card]]:overflow-y-auto",
    "[&>[data-agent-card]]:shrink [&>[data-agent-card]]:flex-1 [&>[data-agent-card]]:overflow-hidden",
    "[&>[data-center-card]:last-child]:border-b-0",
    // Log page keeps its own scroll / height strategy to avoid disturbing virtual-list measurements during outer-layout refactors.
    "[&>[data-run-log-page]]:min-h-0 [&>[data-run-log-page]]:flex-1 [&>[data-run-log-page]]:overflow-hidden [&>[data-run-log-page]]:border-b-0",
  ].join(" ");
  const deleteTargetNode = vm.pipeline.find((node) => node.id === vm.deleteTargetNodeId);
  const deleteTargetGroup = vm.parallelGroups.find((group) => group.id === vm.deleteTargetGroupId);
  const outputAgent = vm.agentCards.find((agent) => agent.id === vm.agentOutputModalAgentId);
  const blurActiveElement = () => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur();
  };
  const closePipelineScopedOverlays = (pipelineId: string) => {
    if (pluginModalPipelineId === pipelineId) {
      setPluginModalPipelineId(null);
    }
    if (workflowJsonModalOpen && vm.activePipelineId === pipelineId) {
      setWorkflowJsonModalOpen(false);
    }
    if (renamePipelineTargetId === pipelineId) {
      setRenamePipelineError("");
      setRenamePipelineTargetId(null);
    }
    if (vm.activePipelineId === pipelineId) {
      vm.setIsCreateNodeModalOpen(false);
      vm.setDeleteTargetNodeId("");
      vm.setDeleteTargetGroupId("");
      setDetailCollapsed(true);
    }
  };
  const resetCreateAgentDraft = () => {
    setCreateAgentName("");
    setCreateAgentWorkspace("");
    setCreateAgentWorkspaceRoot("");
    setCreateAgentError("");
  };
  const resetCreatePipelineDraft = () => {
    setCreatePipelineId("");
    setCreatePipelineTitle("");
    setCreatePipelineCloneEnabled(false);
    setCreatePipelineCloneFrom(vm.activePipelineId || vm.pipelineList[0]?.id || "");
    setCreatePipelineError("");
  };
  const closeRenamePipelineModal = () => {
    setRenamePipelineError("");
    setRenamePipelineTargetId(null);
    setRenamePipelineTitle("");
  };
  const submitEditAgent = async () => {
    if (!editAgentName.trim() && !editAgentWorkspace.trim()) {
      setEditAgentError("At least one field must be provided");
      return;
    }
    setIsUpdatingAgent(true);
    setEditAgentError("");
    try {
      const { updateAgent } = await import("../../../entities/agent/service");
      await updateAgent({
        agentId: editAgentId,
        name: editAgentName.trim() || undefined,
        workspace: editAgentWorkspace.trim() || undefined,
      });
      blurActiveElement();
      setEditAgentModalOpen(false);
      void vm.refreshAgents();
    } catch (err) {
      setEditAgentError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsUpdatingAgent(false);
    }
  };
  const submitDeleteAgent = async () => {
    setIsDeletingAgent(true);
    setDeleteAgentError("");
    try {
      const { deleteAgent } = await import("../../../entities/agent/service");
      await deleteAgent({ agentId: deleteAgentId, deleteFiles: deleteAgentFiles });
      blurActiveElement();
      setDeleteAgentModalOpen(false);
      void vm.refreshAgents();
    } catch (err) {
      setDeleteAgentError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsDeletingAgent(false);
    }
  };
  const submitCreateAgent = async () => {
    if (!createAgentName.trim()) {
      setCreateAgentError(t("agent:fieldLabel.agentName") + " is required");
      return;
    }
    setIsCreatingAgent(true);
    setCreateAgentError("");
    try {
      const { createAgent } = await import("../../../entities/agent/service");
      await createAgent({
        name: createAgentName.trim(),
        workspace: createAgentWorkspace.trim() || undefined,
      });
      blurActiveElement();
      setCreateAgentModalOpen(false);
      resetCreateAgentDraft();
      void vm.refreshAgents();
    } catch (err) {
      setCreateAgentError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsCreatingAgent(false);
    }
  };
  const submitCreatePipeline = async () => {
    const result = await vm.createPipeline({
      id: createPipelineId,
      title: createPipelineTitle,
      cloneFrom: createPipelineCloneEnabled ? createPipelineCloneFrom : undefined,
    });
    if (!result.ok) {
      setCreatePipelineError(result.message);
      return;
    }
    blurActiveElement();
    setCreatePipelineModalOpen(false);
    resetCreatePipelineDraft();
  };
  const submitRenamePipeline = async () => {
    if (!renamePipelineTargetId) return;
    const result = await vm.renamePipeline(renamePipelineTargetId, renamePipelineTitle);
    if (!result.ok) {
      setRenamePipelineError(result.message);
      return;
    }
    blurActiveElement();
    closeRenamePipelineModal();
  };
  const confirmDeletePipeline = async (pipelineId: string) => {
    const result = await vm.deletePipeline(pipelineId);
    if (!result.ok) {
      setDeletePipelineError(result.message);
      return;
    }
    setDeletePipelineError("");
    closePipelineScopedOverlays(pipelineId);
    blurActiveElement();
    setDeletePipelineTargetId(null);
  };

  useEffect(() => {
    // Sync active nav item on route change, so URL and highlight never diverge.
    vm.setActive(initialActive);
  }, [initialActive, vm.setActive]);

  useEffect(() => {
    if (!isPipelineRoute || detailCollapsed) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      // Don't close when clicking a node or parallel group — avoids flash closing/reopening when switching from node A to B.
      if (target.closest("[data-pipeline-node-id]") || target.closest("[data-pipeline-group-id]")) return;
      // Don't close when clicking inside the right detail panel — keeps editing uninterrupted.
      if (target.closest("[data-pipeline-detail-panel]")) return;
      setDetailCollapsed(true);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [detailCollapsed, isPipelineRoute]);

  useEffect(() => {
    if (!isPipelineRoute || !focusPipelineId?.trim()) return;
    const targetPipelineId = focusPipelineId.trim();
    vm.setActivePipelineId(targetPipelineId);
    const timer = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(`[data-pipeline-section-id="${targetPipelineId}"]`);
      target?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusPipelineId, isPipelineRoute, vm.setActivePipelineId]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (renamePipelineTargetId) {
        blurActiveElement();
        closeRenamePipelineModal();
        return;
      }
      if (deletePipelineTargetId) {
        blurActiveElement();
        setDeletePipelineError("");
        setDeletePipelineTargetId(null);
        return;
      }
      if (createPipelineModalOpen) {
        blurActiveElement();
        setCreatePipelineModalOpen(false);
        resetCreatePipelineDraft();
        return;
      }
      if (vm.agentOutputModalAgentId) {
        blurActiveElement();
        vm.setAgentOutputModalAgentId("");
        return;
      }
      if (vm.deleteTargetNodeId) {
        blurActiveElement();
        vm.setDeleteTargetNodeId("");
        return;
      }
      if (vm.deleteTargetGroupId) {
        blurActiveElement();
        vm.setDeleteTargetGroupId("");
        return;
      }
      if (vm.isCreateNodeModalOpen) {
        blurActiveElement();
        vm.setIsCreateNodeModalOpen(false);
        return;
      }
      if (workflowJsonModalOpen) {
        blurActiveElement();
        setWorkflowJsonModalOpen(false);
        return;
      }
      if (pluginModalPipelineId) {
        blurActiveElement();
        setPluginModalPipelineId(null);
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [
    createPipelineModalOpen,
    renamePipelineTargetId,
    deletePipelineTargetId,
    vm.agentOutputModalAgentId,
    vm.deleteTargetNodeId,
    vm.deleteTargetGroupId,
    vm.isCreateNodeModalOpen,
    workflowJsonModalOpen,
    pluginModalPipelineId,
    vm.setAgentOutputModalAgentId,
    vm.setDeleteTargetNodeId,
    vm.setDeleteTargetGroupId,
    vm.setIsCreateNodeModalOpen,
  ]);

  useEffect(() => {
    const pipelineIds = new Set(vm.pipelineList.map((item) => item.id));
    if (pluginModalPipelineId && !pipelineIds.has(pluginModalPipelineId)) {
      setPluginModalPipelineId(null);
    }
    if (renamePipelineTargetId && !pipelineIds.has(renamePipelineTargetId)) {
      closeRenamePipelineModal();
    }
    if (deletePipelineTargetId && !pipelineIds.has(deletePipelineTargetId)) {
      setDeletePipelineError("");
      setDeletePipelineTargetId(null);
    }
    if (workflowJsonModalOpen && !vm.activePipelineId) {
      setWorkflowJsonModalOpen(false);
    }
  }, [deletePipelineTargetId, pluginModalPipelineId, renamePipelineTargetId, vm.activePipelineId, vm.pipelineList, workflowJsonModalOpen]);

  return (
    <div className={pageLayoutClassName}>
      {isMobile ? (
          <>
            {/* Mobile: sidebar as a slide-out drawer from the left */}
            {!navCollapsed && (
              <div
                className="fixed inset-0 z-40 bg-black/50"
                onClick={() => setNavCollapsed(true)}
                aria-hidden
              />
            )}
            <NavPanel
              navItems={controlPlaneNavItems}
              active={vm.active}
              onChangeActive={(label) => {
                vm.setActive(label);
                onNavigateByNav?.(label);
              }}
              onNavigateHome={onNavigateHome}
              protocol={vm.gateway.protocol}
              scopes={vm.gateway.scopes}
              collapsed={navCollapsed}
              variant="overlay"
              onCloseDrawer={() => setNavCollapsed(true)}
            />
          </>
        ) : (
          <NavPanel
            navItems={controlPlaneNavItems}
            active={vm.active}
            onChangeActive={(label) => {
              vm.setActive(label);
              onNavigateByNav?.(label);
            }}
            onNavigateHome={onNavigateHome}
            protocol={vm.gateway.protocol}
            scopes={vm.gateway.scopes}
            collapsed={navCollapsed}
          />
        )}

      <div className={contentLayoutClassName}>
        <TopBar
          runId={vm.runId}
          gateway={vm.gateway}
          latencyMs={vm.latencyMs}
          agentCount={vm.agents.length}
          sessionCount={vm.sessions.length}
          statusLabel={translatedStatusLabel}
          navCollapsed={navCollapsed}
          onToggleNav={() => setNavCollapsed((prev) => !prev)}
          routeText={routeText}
        />

        <main className={shellLayoutClassName} id="main-content">
        <section className={centerColumnClassName}>
          {effectivePageRoute === "logs" ? (
            <RunLogPage currentRunId={vm.runId} />
          ) : effectivePageRoute === "pipeline" ? (
            <>
          <div
            data-center-card
            className="sticky top-0 z-10 shrink-0 flex h-[66px] items-center justify-start px-8 [background-color:rgba(9,15,21,0.1)] [background-image:repeating-linear-gradient(-45deg,rgba(150,170,190,0.07)_0,rgba(150,170,190,0.07)_2px,transparent_2px,transparent_8px)]"
          >
            <button
              className={pipelineCreateButtonClassName}
              type="button"
              onClick={() => {
                setCreatePipelineModalOpen(true);
                setCreatePipelineId("");
                setCreatePipelineTitle("");
                setCreatePipelineCloneEnabled(Boolean(vm.activePipelineId));
                setCreatePipelineCloneFrom(vm.activePipelineId || vm.pipelineList[0]?.id || "");
                setCreatePipelineError("");
              }}
              disabled={vm.isCreatingPipeline || vm.isDeletingPipeline || vm.isRenamingPipeline}
            >
              <PlusIcon className="mr-1.5 h-4 w-4" />
              {vm.isCreatingPipeline ? t("modal:creating") : t("modal:createPipeline")}
            </button>
            <button
              className={`${pipelineCreateButtonClassName} ml-2`}
              type="button"
              onClick={() => setDispatchBoardOpen(true)}
            >
              {t("pipeline:schedulerPanel")}
            </button>
          </div>
          <PipelineCard
            sections={vm.pipelineList.map((pipelineItem) => {
              const pipelineId = pipelineItem.id;
              const state = vm.pipelineStateById[pipelineId];
              if (!state) return null;
              const workflow = state.workflow;
              const inferredGroups = workflow ? vm.getParallelGroupsForPipeline(pipelineId) : [];
              return {
                pipelineId,
                title: pipelineItem.title,
                canDelete: vm.pipelineList.length > 1,
                pipeline: state.pipeline,
                workflowNodeOrder: state.workflow?.nodes.map((node) => node.id) ?? state.pipeline.map((node) => node.id),
                parallelGroups: inferredGroups,
                pluginState: vm.getPipelineRemoteBatchPlugin(pipelineId),
                schedulerPluginEnabled: vm.getPipelineSchedulerPlugin(pipelineId).enabled,
                schedulerMode: state.schedulerState?.mode ?? "-",
                schedulerEnabled: state.schedulerState?.enabled !== false,
                batchStartBatch: vm.batchStartBatchById[pipelineId],
                isBatchOperating: vm.isBatchOperating,
                batchRunStatus: state.batchRunState?.status,
                batchRunProcessedItems: state.batchRunState?.processedItems,
                batchRunTotalItems: state.batchRunState?.totalItems,
                batchRunProcessedBatches: state.batchRunState?.processedBatches,
                batchRunTotalBatches: state.batchRunState?.totalBatches,
                batchRunBatchSize: state.batchRunState?.batchSize,
                batchRunError: state.batchRunState?.error ?? null,
                isRunning: state.isRunning,
                hasPipelineExecution: vm.getHasPipelineExecutionForPipeline(pipelineId),
                isEditing: vm.getIsPipelineEditing(pipelineId),
              };
            }).filter((section): section is NonNullable<typeof section> => Boolean(section))}
            selectedNodeId={vm.selectedNode?.id ?? ""}
            selectedGroupId={vm.selectedGroup?.id ?? ""}
            activePipelineId={vm.activePipelineId}
            onSelectNode={onSelectNode}
            onSelectGroup={onSelectGroup}
            onRun={(pipelineId) => void vm.startPipelineRun(pipelineId)}
            onStop={(pipelineId) => void vm.stopPipelineRun(pipelineId)}
            deletingEntity={vm.isDeletingNode}
            savingNodeOrder={vm.isSavingNodeConfig}
            onToggleEditing={(pipelineId, editing) => vm.setPipelineEditing(pipelineId, editing)}
            onOpenWorkflowJson={(pipelineId) => {
              vm.setActivePipelineId(pipelineId);
              setWorkflowJsonModalOpen(true);
            }}
            onOpenPlugins={(pipelineId) => {
              vm.setActivePipelineId(pipelineId);
              setPluginModalPipelineId(pipelineId);
            }}
            onRenamePipeline={(pipelineId, title) => vm.renamePipeline(pipelineId, title)}
            onRequestDeletePipeline={(pipelineId) => {
              setDeletePipelineError("");
              setDeletePipelineTargetId(pipelineId);
            }}
            onRequestDeleteNode={(pipelineId, nodeId) => {
              vm.setActivePipelineId(pipelineId);
              vm.setDeleteTargetNodeId(nodeId);
            }}
            onRequestDeleteGroup={(pipelineId, groupId) => {
              vm.setActivePipelineId(pipelineId);
              vm.setDeleteTargetGroupId(groupId);
            }}
            onRequestCreateNode={() => vm.setIsCreateNodeModalOpen(true)}
            onMoveNode={(pipelineId, nodeId, direction) => {
              vm.selectNodeInPipeline(pipelineId, nodeId);
              if (direction === "up") {
                void vm.moveSelectedNodeUp(nodeId, pipelineId);
              } else {
                void vm.moveSelectedNodeDown(nodeId, pipelineId);
              }
            }}
            onReorderNode={onReorderNode}
            onChangeBatchStartBatch={(pipelineId, value) => vm.setBatchStartBatch(pipelineId, value)}
            onStartRemoteKeywordBatchRun={(pipelineId) => void vm.startRemoteKeywordBatchRun(pipelineId)}
            onToggleScheduler={(pipelineId, enabled) => {
              void vm.toggleScheduler(enabled, pipelineId);
            }}
            onSwitchSchedulerMode={(pipelineId, mode) => {
              void vm.switchSchedulerMode(mode, pipelineId);
            }}
            onManualTick={(pipelineId) => {
              void vm.manualTick(pipelineId);
            }}
            deletingPipeline={vm.isDeletingPipeline}
            statusTone={statusTone}
            statusLabel={translatedStatusLabel}
          />
            </>
          ) : effectivePageRoute === "agents" ? (
            <AgentListCard
              agents={vm.agentCards}
              onOpenAgentSession={vm.openSessionModalForAgent}
              onOpenAgentOutput={(agentId) => vm.setAgentOutputModalAgentId(agentId)}
              onCreateAgent={() => {
                setCreateAgentName("");
                setCreateAgentWorkspace("Detecting...");
                setCreateAgentWorkspaceRoot("");
                setCreateAgentError("");
                setCreateAgentModalOpen(true);
                import("../../../entities/agent/service").then(({ resolveDefaultWorkspace }) => {
                  resolveDefaultWorkspace("").then((prefix) => {
                    const root = prefix.endsWith("workspace-") ? prefix.slice(0, -"workspace-".length) : "";
                    setCreateAgentWorkspaceRoot(root);
                    setCreateAgentWorkspace(prefix);
                  }).catch(() => {
                    setCreateAgentWorkspace("workspace-");
                  });
                });
              }}
              onEditAgent={(agentId) => {
                setEditAgentId(agentId);
                setEditAgentName("");
                setEditAgentWorkspace("");
                setEditAgentError("");
                setEditAgentModalOpen(true);
              }}
              onDeleteAgent={(agentId) => {
                setDeleteAgentId(agentId);
                setDeleteAgentFiles(false);
                setDeleteAgentError("");
                setDeleteAgentModalOpen(true);
              }}
            />
          ) : effectivePageRoute === "artifacts" ? (
            <ArtifactBoard
              pipelines={vm.pipelineList.map((item) => ({
                id: item.id,
                title: item.title,
              }))}
              onNavigatePipeline={(pipelineId) => {
                vm.setActivePipelineId(pipelineId);
                onNavigateByNav?.("pipeline", pipelineId);
              }}
            />
          ) : effectivePageRoute === "settings" ? (
            <SettingsBoard />
          ) : (
            <OverviewBoard
              pipelines={vm.pipelineList.map((pipelineItem) => ({
                id: pipelineItem.id,
                title: pipelineItem.title,
                nodes: vm.pipelineStateById[pipelineItem.id]?.pipeline ?? [],
                isRunning: vm.pipelineStateById[pipelineItem.id]?.isRunning ?? false,
              }))}
              onStartPipeline={async (pipelineId) => {
                const pluginState = vm.getPipelineRemoteBatchPlugin(pipelineId);
                if (pluginState.enabled) {
                  await vm.startRemoteKeywordBatchRun(pipelineId);
                  return;
                }
                await vm.startPipelineRun(pipelineId);
              }}
              onNavigatePipeline={(pipelineId) => {
                vm.setActivePipelineId(pipelineId);
                onNavigateByNav?.("pipeline", pipelineId);
              }}
              onOpenAgentSession={vm.openSessionModalForAgent}
            />
          )}
        </section>

        {effectivePageRoute === "pipeline" && !detailCollapsed && vm.selectedNode ? (
          <div className={detailPanelShellClassName} data-pipeline-detail-panel>
            <NodeDetailPanel
            selectedNode={vm.selectedNode}
            selectedWorkflowNode={vm.selectedWorkflowNode}
            agentOptions={vm.agents.map((a) => a.id)}
            dependencyOptions={vm.dependencyOptions}
            routeTargetOptions={vm.routeTargetOptions}
            draftTitle={vm.draftTitle}
            draftAgentId={vm.draftAgentId}
            draftExecutorSessionId={vm.draftExecutorSessionId}
            draftInstruction={vm.draftInstruction}
            draftDependsOn={vm.draftDependsOn}
            draftAllowReject={vm.draftAllowReject}
            draftMaxRejectCount={vm.draftMaxRejectCount}
            draftWorkflowLane={vm.draftWorkflowLane}
            draftWorkflowRouteAllowed={vm.draftWorkflowRouteAllowed}
            draftWorkflowRouteTargets={vm.draftWorkflowRouteTargets}
            isSavingWorkflowConfig={vm.isSavingWorkflowConfig}
            savingConfig={vm.isSavingNodeConfig}
            hasPipelineExecution={vm.hasPipelineExecution}
            onChangeDraftTitle={vm.setDraftTitle}
            onChangeDraftAgentId={vm.setDraftAgentId}
            onChangeDraftExecutorSessionId={vm.setDraftExecutorSessionId}
            onChangeDraftInstruction={vm.setDraftInstruction}
            sessionOptions={vm.nodeSessionOptions}
            onChangeDraftDependsOn={vm.setDraftDependsOn}
            onChangeDraftAllowReject={vm.setDraftAllowReject}
            onChangeDraftMaxRejectCount={vm.setDraftMaxRejectCount}
            onChangeDraftWorkflowLane={vm.setDraftWorkflowLane}
            onChangeDraftWorkflowRouteAllowed={vm.setDraftWorkflowRouteAllowed}
            onChangeDraftWorkflowRouteTarget={vm.setDraftWorkflowRouteTarget}
            onBlurSave={vm.saveSelectedNodeConfigOnBlur}
            onRetry={vm.retryNode}
            statusTone={statusTone}
            statusLabel={translatedStatusLabel}
            />
          </div>
        ) : effectivePageRoute === "pipeline" && !detailCollapsed && vm.selectedGroup ? (
          <div className={detailPanelShellClassName} data-pipeline-detail-panel>
            <GroupDetailPanel
            selectedGroup={vm.selectedGroup}
            groupMemberOptions={vm.groupMemberOptions}
            groupUpstreamOptions={vm.groupUpstreamOptions}
            draftGroupId={vm.draftGroupId}
            draftGroupMembers={vm.draftGroupMembers}
            draftGroupUpstreams={vm.draftGroupUpstreams}
            draftGroupJoinPolicy={vm.draftGroupJoinPolicy}
            isSaving={vm.isSavingGroupConfig}
            onChangeDraftGroupId={vm.setDraftGroupId}
            onChangeDraftGroupMembers={vm.setDraftGroupMembers}
            onChangeDraftGroupUpstreams={vm.setDraftGroupUpstreams}
            onChangeDraftGroupJoinPolicy={vm.setDraftGroupJoinPolicy}
            onSave={vm.saveSelectedGroupConfig}
            isDeleting={vm.isDeletingNode}
            statusTone={statusTone}
            statusLabel={translatedStatusLabel}
            onDelete={() => vm.setDeleteTargetGroupId(vm.selectedGroup?.id ?? "")}
            />
          </div>
        ) : detailCollapsed ? null : <aside className={detailPanelShellClassName} />}
        </main>
      </div>

      <ModalLayer
        open={createPipelineModalOpen}
        onClose={() => {
          blurActiveElement();
          setCreatePipelineModalOpen(false);
          resetCreatePipelineDraft();
        }}
        panelClassName={smallModalPanelClassName}
        ariaLabel={t("modal:createPipelineTitle")}
      >
          <div className={panelHeaderClassName}>
            <h2>{t("modal:createPipeline")}</h2>
            <button
              className={drawerCloseClassName}
              type="button"
              onClick={() => {
                blurActiveElement();
                setCreatePipelineModalOpen(false);
                resetCreatePipelineDraft();
              }}
              aria-label={t("modal:close")}
            >
              <CloseIcon />
            </button>
          </div>
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>{t("modal:fieldLabel.pipelineId")}</label>
            <input
              className={controlSingleLineMonoClassName}
              value={createPipelineId}
              onChange={(event) => setCreatePipelineId(event.target.value)}
              placeholder={t("modal:placeholder.pipelineId")}
            />
          </div>
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>{t("modal:fieldLabel.pipelineTitle")}</label>
            <input
              className={controlSingleLineClassName}
              value={createPipelineTitle}
              onChange={(event) => setCreatePipelineTitle(event.target.value)}
              placeholder={t("modal:placeholder.pipelineTitle")}
            />
          </div>
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>{t("modal:fieldLabel.createMethod")}</label>
            <InlineSelect
              value={createPipelineCloneEnabled ? "clone" : "blank"}
              options={[
                { value: "blank", label: t("modal:fieldLabel.blank") },
                { value: "clone", label: t("modal:fieldLabel.clone") },
              ]}
              onChange={(next) => {
                const cloneEnabled = next === "clone";
                setCreatePipelineCloneEnabled(cloneEnabled);
                if (cloneEnabled && !createPipelineCloneFrom) {
                  setCreatePipelineCloneFrom(vm.activePipelineId || vm.pipelineList[0]?.id || "");
                }
              }}
              triggerClassName={controlInputClassName}
              ariaLabel={t("modal:fieldLabel.createMethod")}
            />
          </div>
          {createPipelineCloneEnabled ? (
            <div className={fieldClassName}>
              <label className={fieldLabelClassName}>{t("modal:fieldLabel.cloneSource")}</label>
              <InlineSelect
                value={createPipelineCloneFrom}
                options={vm.pipelineList.map((item) => ({
                  value: item.id,
                  label: `${item.id} | ${item.title}`,
                }))}
                onChange={setCreatePipelineCloneFrom}
                triggerClassName={controlInputClassName}
                ariaLabel={t("modal:fieldLabel.cloneSource")}
              />
            </div>
          ) : null}
          {createPipelineError ? (
            <p className={`${modalSublineClassName} text-(--bad)`}>{createPipelineError}</p>
          ) : null}
          <div className={actionRowClassName}>
            <button
              className={actionButtonClassName}
              type="button"
              onClick={() => void submitCreatePipeline()}
              disabled={vm.isCreatingPipeline || (createPipelineCloneEnabled && !createPipelineCloneFrom)}
            >
              {vm.isCreatingPipeline ? t("modal:creating") : t("modal:action.confirmCreate")}
            </button>
          </div>
      </ModalLayer>

      <ModalLayer
        open={Boolean(renamePipelineTargetId)}
        onClose={() => {
          blurActiveElement();
          closeRenamePipelineModal();
        }}
        panelClassName={smallModalPanelClassName}
        ariaLabel={t("modal:renamePipeline")}
      >
          <div className={panelHeaderClassName}>
            <h2>{t("modal:renamePipeline")}</h2>
            <button
              className={drawerCloseClassName}
              type="button"
              onClick={() => {
                blurActiveElement();
                closeRenamePipelineModal();
              }}
              aria-label={t("modal:close")}
            >
              <CloseIcon />
            </button>
          </div>
          <p className={modalSublineClassName}>
            {t("modal:currentPipeline")} <code>{renamePipelineTarget?.id ?? renamePipelineTargetId ?? "-"}</code>
            {renamePipelineTarget?.title ? ` (${t("modal:currentTitle")}: ${renamePipelineTarget.title})` : ""}.
          </p>
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>{t("modal:fieldLabel.newTitle")}</label>
            <input
              className={controlSingleLineClassName}
              value={renamePipelineTitle}
              onChange={(event) => setRenamePipelineTitle(event.target.value)}
              placeholder={t("modal:placeholder.newTitle")}
            />
          </div>
          {renamePipelineError ? (
            <p className={`${modalSublineClassName} text-(--bad)`}>{renamePipelineError}</p>
          ) : null}
          <div className={actionRowClassName}>
            <button
              className={actionButtonClassName}
              type="button"
              onClick={() => void submitRenamePipeline()}
              disabled={!renamePipelineTargetId || !renamePipelineTitle.trim() || vm.isRenamingPipeline}
            >
              {vm.isRenamingPipeline ? t("modal:saving") : t("modal:action.confirmRename")}
            </button>
          </div>
      </ModalLayer>

      <ModalLayer
        open={Boolean(deletePipelineTargetId)}
        onClose={() => {
          blurActiveElement();
          setDeletePipelineError("");
          setDeletePipelineTargetId(null);
        }}
        panelClassName={smallModalPanelClassName}
        ariaLabel={t("modal:deletePipeline")}
      >
          <div className={panelHeaderClassName}>
            <h2>{t("modal:deletePipeline")}</h2>
            <button
              className={drawerCloseClassName}
              type="button"
              onClick={() => {
                blurActiveElement();
                setDeletePipelineError("");
                setDeletePipelineTargetId(null);
              }}
              aria-label={t("modal:close")}
            >
              <CloseIcon />
            </button>
          </div>
          <p className={modalSublineClassName}>
            {t("modal:deleteConfirm")} <code>{deletePipelineTarget?.id ?? deletePipelineTargetId ?? "-"}</code>
            {deletePipelineTarget?.title ? ` (${deletePipelineTarget.title})` : ""}. {t("modal:archiveNote")} <code>.data/pipelines/_deleted</code>.
          </p>
          {deletePipelineError ? (
            <p className={`${modalSublineClassName} text-(--bad)`}>{deletePipelineError}</p>
          ) : null}
          <div className={actionRowClassName}>
            <button
              className={actionButtonClassName}
              type="button"
              onClick={() => deletePipelineTargetId && void confirmDeletePipeline(deletePipelineTargetId)}
              disabled={!deletePipelineTargetId || vm.isDeletingPipeline}
            >
              {vm.isDeletingPipeline ? t("modal:deleting") : t("modal:action.confirmDeletePipeline")}
            </button>
          </div>
      </ModalLayer>

      <ModalLayer
        open={createAgentModalOpen}
        onClose={() => {
          blurActiveElement();
          setCreateAgentModalOpen(false);
          resetCreateAgentDraft();
        }}
        panelClassName={smallModalPanelClassName}
        ariaLabel={t("agent:createAgentTitle")}
      >
          <div className={panelHeaderClassName}>
            <h2>{t("agent:createAgentTitle")}</h2>
            <button
              className={drawerCloseClassName}
              type="button"
              onClick={() => {
                blurActiveElement();
                setCreateAgentModalOpen(false);
                resetCreateAgentDraft();
              }}
              aria-label={t("modal:close")}
            >
              <CloseIcon />
            </button>
          </div>
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>{t("agent:fieldLabel.agentName")}</label>
            <input
              className={controlSingleLineMonoClassName}
              value={createAgentName}
              onChange={(event) => {
                const name = event.target.value;
                setCreateAgentName(name);
                // Auto-sync workspace when root is known and user hasn't manually edited workspace
                if (createAgentWorkspaceRoot && createAgentWorkspace === `${createAgentWorkspaceRoot}workspace-${createAgentName}`) {
                  setCreateAgentWorkspace(`${createAgentWorkspaceRoot}workspace-${name}`);
                }
              }}
              onFocus={(event) => {
                // If workspace still shows the bare prefix, append name on focus
                if (createAgentWorkspaceRoot && createAgentWorkspace === `${createAgentWorkspaceRoot}workspace-` && createAgentName) {
                  setCreateAgentWorkspace(`${createAgentWorkspaceRoot}workspace-${createAgentName}`);
                }
              }}
              placeholder={t("agent:placeholder.agentName")}
            />
          </div>
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>{t("agent:fieldLabel.agentWorkspace")}</label>
            <input
              className={controlSingleLineMonoClassName}
              value={createAgentWorkspace}
              onChange={(event) => setCreateAgentWorkspace(event.target.value)}
              placeholder={t("agent:placeholder.agentWorkspace")}
            />
          </div>
          {createAgentError ? (
            <p className={`${modalSublineClassName} text-(--bad)`}>{createAgentError}</p>
          ) : null}
          <div className={actionRowClassName}>
            <button
              className={actionButtonClassName}
              type="button"
              onClick={() => void submitCreateAgent()}
              disabled={isCreatingAgent || !createAgentName.trim()}
            >
              {isCreatingAgent ? t("agent:creating") : t("agent:action.confirmCreate")}
            </button>
          </div>
      </ModalLayer>

      <ModalLayer
        open={editAgentModalOpen}
        onClose={() => {
          blurActiveElement();
          setEditAgentModalOpen(false);
          setEditAgentError("");
        }}
        panelClassName={smallModalPanelClassName}
        ariaLabel={t("agent:editAgentTitle")}
      >
          <div className={panelHeaderClassName}>
            <h2>{t("agent:editAgentTitle")}</h2>
            <button
              className={drawerCloseClassName}
              type="button"
              onClick={() => {
                blurActiveElement();
                setEditAgentModalOpen(false);
                setEditAgentError("");
              }}
              aria-label={t("modal:close")}
            >
              <CloseIcon />
            </button>
          </div>
          <p className={modalSublineClassName}>
            Agent ID: <code>{editAgentId}</code>
          </p>
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>{t("agent:fieldLabel.agentName")}</label>
            <input
              className={controlSingleLineMonoClassName}
              value={editAgentName}
              onChange={(event) => setEditAgentName(event.target.value)}
              placeholder={t("agent:placeholder.agentName")}
            />
          </div>
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>{t("agent:fieldLabel.agentWorkspace")}</label>
            <input
              className={controlSingleLineMonoClassName}
              value={editAgentWorkspace}
              onChange={(event) => setEditAgentWorkspace(event.target.value)}
              placeholder={t("agent:placeholder.agentWorkspace")}
            />
          </div>
          {editAgentError ? (
            <p className={`${modalSublineClassName} text-(--bad)`}>{editAgentError}</p>
          ) : null}
          <div className={actionRowClassName}>
            <button
              className={actionButtonClassName}
              type="button"
              onClick={() => void submitEditAgent()}
              disabled={isUpdatingAgent || (!editAgentName.trim() && !editAgentWorkspace.trim())}
            >
              {isUpdatingAgent ? t("agent:updating") : t("agent:action.confirmUpdate")}
            </button>
          </div>
      </ModalLayer>

      <ModalLayer
        open={deleteAgentModalOpen}
        onClose={() => {
          blurActiveElement();
          setDeleteAgentModalOpen(false);
          setDeleteAgentError("");
        }}
        panelClassName={smallModalPanelClassName}
        ariaLabel={t("agent:deleteAgentTitle")}
      >
          <div className={panelHeaderClassName}>
            <h2>{t("agent:deleteAgentTitle")}</h2>
            <button
              className={drawerCloseClassName}
              type="button"
              onClick={() => {
                blurActiveElement();
                setDeleteAgentModalOpen(false);
                setDeleteAgentError("");
              }}
              aria-label={t("modal:close")}
            >
              <CloseIcon />
            </button>
          </div>
          <p className={modalSublineClassName}>
            {t("agent:deleteAgentConfirm")} <code>{deleteAgentId}</code>.
          </p>
          <p className={modalSublineClassName}>{t("agent:deleteAgentNote")}</p>
          <div className={fieldClassName}>
            <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={deleteAgentFiles}
                onChange={(event) => setDeleteAgentFiles(event.target.checked)}
              />
              {t("agent:deleteFiles")}
            </label>
          </div>
          {deleteAgentError ? (
            <p className={`${modalSublineClassName} text-(--bad)`}>{deleteAgentError}</p>
          ) : null}
          <div className={actionRowClassName}>
            <button
              className={actionButtonClassName}
              type="button"
              onClick={() => void submitDeleteAgent()}
              disabled={isDeletingAgent}
            >
              {isDeletingAgent ? t("agent:deleting") : t("agent:action.confirmDelete")}
            </button>
          </div>
      </ModalLayer>

      <div
        className={`${modalMaskBaseClassName} ${vm.isCreateNodeModalOpen ? modalMaskOpenClassName : modalMaskClosedClassName}`}
        onClick={() => {
          blurActiveElement();
          vm.setIsCreateNodeModalOpen(false);
        }}
        aria-hidden={!vm.isCreateNodeModalOpen}
      />
      <aside
        className={`${modalFrameBaseClassName} ${vm.isCreateNodeModalOpen ? modalFrameOpenClassName : modalFrameClosedClassName}`}
        aria-hidden={!vm.isCreateNodeModalOpen}
        onClick={() => {
          blurActiveElement();
          vm.setIsCreateNodeModalOpen(false);
        }}
      >
        <div className={smallModalPanelClassName} onClick={(event) => event.stopPropagation()}>
          <div className={panelHeaderClassName}>
            <h2>{t("modal:addObject")}</h2>
            <button
              className={drawerCloseClassName}
              type="button"
              onClick={() => {
                blurActiveElement();
                vm.setIsCreateNodeModalOpen(false);
              }}
              aria-label={t("modal:close")}
            >
              <CloseIcon />
            </button>
          </div>
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>{t("modal:fieldLabel.createType")}</label>
            <InlineSelect
              value={vm.draftCreateKind}
              options={[
                { value: "node", label: t("modal:fieldLabel.node") },
                { value: "group", label: t("modal:fieldLabel.group") },
              ]}
              onChange={(next) => vm.setDraftCreateKind(next as "node" | "group")}
              triggerClassName={controlInputMonoClassName}
              ariaLabel={t("modal:fieldLabel.createType")}
            />
          </div>
          {vm.draftCreateKind === "node" ? (
            <>
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>{t("modal:fieldLabel.nodeId")}</label>
            <input
              className={controlSingleLineMonoClassName}
              value={vm.draftNewNodeId}
              onChange={(event) => vm.setDraftNewNodeId(event.target.value)}
              placeholder={t("modal:placeholder.nodeId")}
            />
          </div>
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>{t("modal:fieldLabel.nodeTitle")}</label>
            <input
              className={controlSingleLineClassName}
              value={vm.draftNewNodeTitle}
              onChange={(event) => vm.setDraftNewNodeTitle(event.target.value)}
              placeholder={t("modal:placeholder.nodeTitle")}
            />
          </div>
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>Agent</label>
            <InlineSelect
              value={vm.draftNewNodeAgentId}
              options={(vm.agents.length ? vm.agents.map((agent) => agent.id) : [vm.draftNewNodeAgentId || "-"]).map(
                (agentId) => ({
                  value: agentId,
                  label: agentId,
                }),
              )}
              onChange={vm.setDraftNewNodeAgentId}
              triggerClassName={controlInputClassName}
              ariaLabel="Agent"
            />
          </div>
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>{t("modal:fieldLabel.nodeInstruction")}</label>
            <textarea
              className={controlTextAreaMonoClassName}
              value={vm.draftNewNodeInstruction}
              onChange={(event) => vm.setDraftNewNodeInstruction(event.target.value)}
              rows={4}
              placeholder={t("modal:placeholder.nodeInstruction")}
            />
          </div>
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>{t("modal:fieldLabel.dependsOn")}</label>
            <select
              className={controlInputMonoClassName}
              value={vm.draftNewNodeDependsOn}
              onChange={(event) =>
                vm.setDraftNewNodeDependsOn(
                  Array.from(event.target.selectedOptions)
                    .map((option) => option.value)
                    .filter(Boolean),
                )
              }
              multiple
              size={Math.max(3, Math.min(8, vm.newNodeDependencyOptions.length || 3))}
            >
              {vm.newNodeDependencyOptions.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.id} - {node.title}
                </option>
              ))}
            </select>
            <small className={`${monoClassName} mt-1.5 block text-xs text-(--muted)`}>{t("modal:multiSelectHint")}</small>
          </div>
          <button className={actionButtonClassName} type="button" onClick={vm.addTemplateNode} disabled={vm.isAddingNode}>
            {vm.isAddingNode ? t("modal:creating") : t("modal:action.confirmAdd")}
          </button>
            </>
          ) : (
            <>
              <div className={fieldClassName}>
                <label className={fieldLabelClassName}>{t("modal:fieldLabel.groupId")}</label>
                <input
                  className={controlInputMonoClassName}
                  value={vm.draftNewGroupId}
                  onChange={(event) => vm.setDraftNewGroupId(event.target.value)}
                  placeholder={t("modal:placeholder.groupId")}
                />
              </div>
              <div className={fieldClassName}>
                <label className={fieldLabelClassName}>{t("modal:fieldLabel.members")}</label>
                <select
                  className={controlInputMonoClassName}
                  value={vm.draftNewGroupMembers}
                  onChange={(event) =>
                    vm.setDraftNewGroupMembers(
                      Array.from(event.target.selectedOptions)
                        .map((option) => option.value)
                        .filter(Boolean),
                    )
                  }
                  multiple
                  size={Math.max(3, Math.min(8, vm.newGroupMemberOptions.length || 3))}
                >
                  {vm.newGroupMemberOptions.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.id} - {node.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className={fieldClassName}>
                <label className={fieldLabelClassName}>{t("modal:fieldLabel.commonUpstream")}</label>
                <select
                  className={controlInputMonoClassName}
                  value={vm.draftNewGroupUpstreams}
                  onChange={(event) =>
                    vm.setDraftNewGroupUpstreams(
                      Array.from(event.target.selectedOptions)
                        .map((option) => option.value)
                        .filter(Boolean),
                    )
                  }
                  multiple
                  size={Math.max(3, Math.min(8, vm.newGroupUpstreamOptions.length || 3))}
                >
                  {vm.newGroupUpstreamOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id} - {item.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className={fieldClassName}>
                <label className={fieldLabelClassName}>{t("modal:fieldLabel.joinPolicy")}</label>
                <InlineSelect
                  value={vm.draftNewGroupJoinPolicy}
                  options={[
                    { value: "all", label: "all" },
                    { value: "any", label: "any" },
                    { value: "quorum", label: "quorum" },
                  ]}
                  onChange={(next) => vm.setDraftNewGroupJoinPolicy(next as "all" | "any" | "quorum")}
                  triggerClassName={controlInputMonoClassName}
                  ariaLabel={t("modal:fieldLabel.joinPolicy")}
                />
              </div>
              <button className={actionButtonClassName} type="button" onClick={vm.addParallelGroup} disabled={vm.isAddingNode}>
                {vm.isAddingNode ? t("modal:creating") : t("modal:action.confirmAddGroup")}
              </button>
            </>
          )}
        </div>
      </aside>

      <div
        className={`${modalMaskBaseClassName} ${Boolean(vm.deleteTargetNodeId || vm.deleteTargetGroupId) ? modalMaskOpenClassName : modalMaskClosedClassName}`}
        onClick={() => {
          blurActiveElement();
          vm.setDeleteTargetNodeId("");
          vm.setDeleteTargetGroupId("");
        }}
        aria-hidden={!vm.deleteTargetNodeId && !vm.deleteTargetGroupId}
      />
      <aside
        className={`${modalFrameBaseClassName} ${vm.deleteTargetNodeId || vm.deleteTargetGroupId ? modalFrameOpenClassName : modalFrameClosedClassName}`}
        aria-hidden={!vm.deleteTargetNodeId && !vm.deleteTargetGroupId}
        onClick={() => {
          blurActiveElement();
          vm.setDeleteTargetNodeId("");
          vm.setDeleteTargetGroupId("");
        }}
      >
        <div className={smallModalPanelClassName} onClick={(event) => event.stopPropagation()}>
          <div className={panelHeaderClassName}>
            <h2>{vm.deleteTargetGroupId ? t("modal:deleteGroup") : t("modal:deleteNode")}</h2>
            <button
              className={drawerCloseClassName}
              type="button"
              onClick={() => {
                blurActiveElement();
                vm.setDeleteTargetNodeId("");
                vm.setDeleteTargetGroupId("");
              }}
              aria-label={t("modal:close")}
            >
              <CloseIcon />
            </button>
          </div>
          {vm.deleteTargetGroupId ? (
            <p className={modalSublineClassName}>
              {t("modal:deleteGroupConfirm")} <code>{deleteTargetGroup?.id ?? vm.deleteTargetGroupId}</code>
              {deleteTargetGroup ? t("modal:deleteGroupNote", { members: deleteTargetGroup.members.join(", ") }) : ""}
            </p>
          ) : (
            <p className={modalSublineClassName}>
              {t("modal:deleteNodeConfirm")} <code>{deleteTargetNode?.id ?? vm.deleteTargetNodeId}</code>
              {deleteTargetNode ? ` (${deleteTargetNode.title})` : ""}{t("modal:deleteNodeNote")}
            </p>
          )}
          <button
            className={actionButtonClassName}
            type="button"
            onClick={() =>
              void (vm.deleteTargetGroupId
                ? vm.deleteParallelGroupById(vm.deleteTargetGroupId)
                : vm.deleteTemplateNodeById(vm.deleteTargetNodeId))
            }
            disabled={(!vm.deleteTargetNodeId && !vm.deleteTargetGroupId) || vm.isDeletingNode}
          >
            {vm.isDeletingNode ? t("modal:deleting") : t("modal:action.confirmDelete")}
          </button>
        </div>
      </aside>

      <div
        className={`${modalMaskBaseClassName} ${Boolean(vm.agentOutputModalAgentId) ? modalMaskOpenClassName : modalMaskClosedClassName}`}
        onClick={() => {
          blurActiveElement();
          vm.setAgentOutputModalAgentId("");
        }}
        aria-hidden={!vm.agentOutputModalAgentId}
      />
      <aside
        className={`${modalFrameBaseClassName} ${vm.agentOutputModalAgentId ? modalFrameOpenClassName : modalFrameClosedClassName}`}
        aria-hidden={!vm.agentOutputModalAgentId}
        onClick={() => {
          blurActiveElement();
          vm.setAgentOutputModalAgentId("");
        }}
      >
        <div className={outputModalPanelClassName} onClick={(event) => event.stopPropagation()}>
          <div className={panelHeaderClassName}>
            <h2>{t("modal:outputContent")}</h2>
            <button
              className={drawerCloseClassName}
              type="button"
              onClick={() => {
                blurActiveElement();
                vm.setAgentOutputModalAgentId("");
              }}
              aria-label={t("modal:close")}
            >
              <CloseIcon />
            </button>
          </div>
          <div className={`${monoClassName} flex items-center justify-between gap-3 overflow-hidden border border-(--line) bg-[rgba(15,23,29,0.6)] px-2.5 py-2 text-xs text-(--muted)`}>
            <span>Agent: {outputAgent?.id ?? vm.agentOutputModalAgentId}</span>
            <span>{outputAgent?.outputRunId ?? "run:unknown"}</span>
          </div>
          <div className="min-h-26.25 max-h-[calc(90vh-160px)] overflow-auto border border-(--line) bg-[#0f171d] max-[760px]:h-full max-[760px]:min-h-0 max-[760px]:max-h-none">
            <pre className="m-0 whitespace-pre-wrap wrap-break-word p-3 font-[JetBrains_Mono,monospace] text-[13px] leading-[1.45] text-(--text)">{outputAgent?.outputContent || t("modal:noOutput")}</pre>
          </div>
        </div>
      </aside>

      <SessionModal
        open={vm.sessionModalOpen}
        selectedAgentId={vm.selectedAgentId}
        selectedSessionId={vm.selectedSessionId}
        sessions={vm.filteredSessionsForSelectedAgent}
        sendMode={vm.sendMode}
        sessionMessage={vm.sessionMessage}
        onClose={() => {
          blurActiveElement();
          vm.setSessionModalOpen(false);
        }}
        onChangeSelectedSessionId={vm.setSelectedSessionId}
        onChangeSendMode={vm.setSendMode}
        onChangeMessage={vm.setSessionMessage}
        onSendMessage={vm.sendSessionMessage}
      />

      <ModalLayer
        open={Boolean(pluginModalPipelineId)}
        onClose={() => {
          blurActiveElement();
          setPluginModalPipelineId(null);
        }}
        panelClassName={smallModalPanelClassName}
        ariaLabel={t("modal:pluginConfig")}
      >
        {pluginModalPipelineId ? (
          <PipelinePluginModal
            pipelineId={pluginModalPipelineId}
            pluginState={vm.getPipelinePlugins(pluginModalPipelineId)}
            onClose={() => {
              blurActiveElement();
              setPluginModalPipelineId(null);
            }}
            onSave={(plugin) => {
              void vm.savePipelinePlugins(pluginModalPipelineId, plugin);
            }}
          />
        ) : null}
      </ModalLayer>

      <ModalLayer
        open={workflowJsonModalOpen}
        onClose={() => {
          blurActiveElement();
          setWorkflowJsonModalOpen(false);
        }}
        panelClassName={workflowModalPanelClassName}
        ariaLabel={t("modal:editWorkflowJson")}
      >
          <div className={panelHeaderClassName}>
            <h2>Workflow JSON ({vm.activePipelineTitle || vm.activePipelineId || "-"})</h2>
            <button
              className={drawerCloseClassName}
              type="button"
              onClick={() => {
                blurActiveElement();
                setWorkflowJsonModalOpen(false);
              }}
              aria-label={t("modal:close")}
            >
              <CloseIcon />
            </button>
          </div>
          <p className={`${modalSublineClassName} ${monoClassName}`}>{vm.workflow ? `nodes=${vm.workflow.nodes.length}` : "-"}</p>
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>{t("modal:workflowJsonLabel")}</label>
            <textarea
              className={controlTextAreaMonoClassName}
              rows={18}
              value={vm.workflowJsonDraft}
              onChange={(event) => vm.setWorkflowJsonDraft(event.target.value)}
              placeholder="workflow json"
            />
          </div>
          <div className={actionRowClassName}>
            <button className={actionButtonClassName} type="button" onClick={() => void vm.saveWorkflowJsonDraft()} disabled={vm.isSavingWorkflowJson}>
              {vm.isSavingWorkflowJson ? t("modal:saving") : t("modal:action.saveWorkflow")}
            </button>
          </div>
      </ModalLayer>

      <ModalLayer
        open={dispatchBoardOpen}
        onClose={() => {
          blurActiveElement();
          setDispatchBoardOpen(false);
        }}
        panelClassName="overflow-auto border border-[var(--line)] bg-[linear-gradient(180deg,var(--panel)_0%,var(--panel-2)_100%)] p-0 max-h-[88vh] w-[min(760px,94vw)]"
        ariaLabel={t("modal:schedulerManagement")}
      >
        <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-[var(--line)]">
          <h2 className="text-sm font-semibold text-[var(--text)]">{t("modal:schedulerManagement")}</h2>
          <button
            className={drawerCloseClassName}
            type="button"
            onClick={() => {
              blurActiveElement();
              setDispatchBoardOpen(false);
            }}
            aria-label={t("modal:close")}
          >
            <CloseIcon />
          </button>
        </div>
        <PipelineDispatchBoard
          pipelines={vm.pipelineList.map((p) => ({ id: p.id, title: p.title }))}
        />
      </ModalLayer>
    </div>
  );
}
