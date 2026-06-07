import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PipelineNode } from "../../../entities/pipeline";
import { InlineSelect, PlusIcon } from "../../../shared/ui";
import {
  detailPanelClassName,
  detailPanelHeadClassName,
  detailPanelStatusClassName,
  detailPanelTitleClassName,
} from "./detailPanelClasses";
import {
  controlInputClassName,
  controlInputMonoClassName,
  controlTextAreaMonoClassName,
} from "../../../shared/ui/surfaceClassNames";

const kvHeadClassName = "mb-1.5 flex items-center justify-between gap-2";
const depPickerClassName = "relative min-w-0";
const depInlineValueClassName = `${controlInputMonoClassName} cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap transition-[border-color,background-color,color] hover:border-[#2a3c4b] hover:bg-[rgba(142,163,179,0.08)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--live)] focus-visible:outline-offset-1`;
const depInlineValueOpenClassName = "border-[#3b5868] bg-[rgba(24,39,47,0.92)]";
const depDropdownClassName =
  "absolute inset-x-0 top-[calc(100%+4px)] z-[4] grid max-h-[180px] overflow-y-auto overflow-x-hidden border border-[#29414f] bg-[rgba(18,31,38,0.98)] px-0 py-0 text-[var(--text)] shadow-none";
const depOptionClassName =
  "grid min-w-0 cursor-pointer grid-cols-[10px_minmax(0,1fr)] items-center gap-x-3 px-2 py-1.5 text-xs leading-[1.2] text-[var(--text)] transition-[background-color,color] hover:bg-[rgba(22,36,44,0.9)]";
const depOptionCheckedClassName = "bg-[rgba(50,215,186,0.12)]";
const depCheckboxClassName =
  "m-0 h-[10px] w-[10px] cursor-pointer appearance-none border border-[var(--line)] bg-transparent transition-[border-color,background-color] hover:border-[#2a3c4b] checked:border-[var(--live)] checked:bg-[var(--live)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--live)] focus-visible:outline-offset-1";
const depEmptyClassName = "mx-2 my-1.5 text-xs text-[var(--muted)]";
const routeEditorClassName = "grid gap-2 overflow-hidden border border-[#29414f] bg-[rgba(18,31,38,0.9)] p-[10px]";
const routeSwitchRowClassName = "mb-1.5 flex min-w-0 items-center justify-between gap-2";
const routeChipListClassName = "flex min-h-8 flex-wrap content-start gap-2";
const routeChipClassName =
  "inline-flex items-center gap-2 border border-[#29414f] bg-[rgba(24,39,47,0.92)] px-2 py-1 whitespace-nowrap";
const routeChipRemoveClassName =
  "cursor-pointer border-0 bg-transparent p-0 leading-none text-[var(--muted)] hover:text-[var(--bad)]";
const routeEditorRowClassName =
  "grid items-stretch gap-2 border-t border-[rgba(142,163,179,0.12)] pt-2 grid-cols-[minmax(0,1fr)_auto]";
const routeTargetItemClassName = "grid gap-1.5 border border-[#29414f] bg-[rgba(24,39,47,0.72)] p-2";
const routeSwitchClassName =
  "relative h-6 w-[54px] shrink-0 cursor-pointer border border-[#29414f] bg-[rgba(24,39,47,0.92)] p-0 transition-[background-color,border-color] disabled:cursor-not-allowed disabled:opacity-50";
const routeSwitchOnClassName = "border-[var(--live-25)] bg-[rgba(50,215,186,0.14)]";
const routeSwitchThumbClassName =
  "absolute top-1/2 flex h-5 w-[24px] -translate-y-1/2 items-center justify-center border border-[var(--line)] bg-[rgba(18,31,38,0.98)] text-center text-[10px] leading-[20px] font-semibold text-[var(--muted)] transition-[left,right,color,border-color,background-color]";
const routeSwitchThumbOffClassName = "left-[2px] right-auto";
const routeSwitchThumbOnClassName =
  "right-[2px] left-auto border-[var(--live-25)] bg-[rgba(50,215,186,0.22)] text-[var(--live)]";
const MAINLINE_ROUTE_VALUE = "yes";
const DEFAULT_BRANCH_ROUTE_VALUE = "no";
const adapterGridFieldClassName =
  "grid min-w-0 items-center gap-x-2 gap-y-0 grid-cols-[40px_minmax(0,1fr)] max-[760px]:grid-cols-1 max-[760px]:gap-y-1.5";
const adapterInstructionFieldClassName = "grid min-w-0 gap-1.5";
const monoClassName = "font-[JetBrains_Mono,monospace]";
const fieldClassName = "min-w-0";
const fieldLabelClassName = "mb-1.5 block text-xs text-[var(--muted)]";
const fieldCodeClassName =
  "block overflow-wrap-anywhere text-xs whitespace-pre-line break-words border border-[#29414f] bg-[rgba(18,31,38,0.9)] p-[10px] overflow-wrap-anywhere whitespace-pre-line break-words border border-[#29414f] bg-[rgba(18,31,38,0.9)] p-[10px]";
const statusTagBaseClassName = "inline-flex w-fit items-center rounded-none px-2 py-[2px] text-xs uppercase";
const statusTagToneClassName = {
  good: "bg-[rgba(50,215,186,0.15)] text-[var(--live)]",
  live: "bg-[rgba(50,215,186,0.15)] text-[var(--live)]",
  warn: "bg-[rgba(255,184,77,0.16)] text-[var(--warn)]",
  bad: "bg-[rgba(255,107,107,0.16)] text-[var(--bad)]",
  muted: "bg-[rgba(142,163,179,0.2)] text-[#a5b9c8]",
} as const;
const actionButtonClassName =
  "mt-0 cursor-pointer border border-[var(--live-25)] bg-transparent px-[10px] py-2 font-semibold text-[var(--live)] hover:bg-[rgba(50,215,186,0.1)]";

type NodeDetailPanelProps = {
  selectedNode?: PipelineNode;
  selectedWorkflowNode?: {
    lane?: "main" | "branch";
    routePolicy?: { allowed: string[] } | null;
  } | null;
  agentOptions: string[];
  dependencyOptions: Array<{ id: string; title: string }>;
  routeTargetOptions: Array<{ id: string; title: string }>;
  draftTitle: string;
  draftAgentId: string;
  draftExecutorSessionId: string;
  draftInstruction: string;
  draftDependsOn: string[];
  draftAllowReject: boolean;
  draftMaxRejectCount: number;
  draftWorkflowLane: "main" | "branch";
  draftWorkflowRouteAllowed: string;
  draftWorkflowRouteTargets: Record<string, string>;
  isSaving: boolean;
  hasPipelineExecution: boolean;
  onChangeDraftTitle: (v: string) => void;
  onChangeDraftAgentId: (v: string) => void;
  onChangeDraftExecutorSessionId: (v: string) => void;
  onChangeDraftInstruction: (v: string) => void;
  sessionOptions: Array<{ id: string; title: string }>;
  onChangeDraftDependsOn: (v: string[]) => void;
  onChangeDraftAllowReject: (v: boolean) => void;
  onChangeDraftMaxRejectCount: (v: number) => void;
  onChangeDraftWorkflowLane: (v: "main" | "branch") => void;
  onChangeDraftWorkflowRouteAllowed: (v: string) => void;
  onChangeDraftWorkflowRouteTarget: (route: string, targetNodeId: string) => void;
  onRetry: () => void;
  statusTone: Record<string, string>;
  statusLabel: Record<string, string>;
};

export function NodeDetailPanel({
  selectedNode,
  selectedWorkflowNode,
  agentOptions,
  dependencyOptions,
  routeTargetOptions,
  draftTitle,
  draftAgentId,
  draftExecutorSessionId,
  draftInstruction,
  draftDependsOn,
  draftAllowReject,
  draftMaxRejectCount,
  draftWorkflowLane,
  draftWorkflowRouteAllowed,
  draftWorkflowRouteTargets,
  isSaving,
  hasPipelineExecution,
  onChangeDraftTitle,
  onChangeDraftAgentId,
  onChangeDraftExecutorSessionId,
  onChangeDraftInstruction,
  sessionOptions,
  onChangeDraftDependsOn,
  onChangeDraftAllowReject,
  onChangeDraftMaxRejectCount,
  onChangeDraftWorkflowLane,
  onChangeDraftWorkflowRouteAllowed,
  onChangeDraftWorkflowRouteTarget,
  onRetry,
  statusTone,
  statusLabel,
}: NodeDetailPanelProps) {
  const { t } = useTranslation("node-detail");
  const [depEditorOpen, setDepEditorOpen] = useState(false);
  const depEditorRef = useRef<HTMLDivElement | null>(null);
  const rawRouteOptions = Array.from(
    new Set(
      draftWorkflowRouteAllowed
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
  const routeOptions =
    rawRouteOptions.length > 0
      ? Array.from(new Set([MAINLINE_ROUTE_VALUE, DEFAULT_BRANCH_ROUTE_VALUE, ...rawRouteOptions])).slice(0, 5)
      : [];
  const routeTargetOptionsForEdit = routeOptions.filter((route) => route !== MAINLINE_ROUTE_VALUE);
  const [routeDraft, setRouteDraft] = useState("");

  useEffect(() => {
    if (!depEditorOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (depEditorRef.current && !depEditorRef.current.contains(event.target as Node)) {
        setDepEditorOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [depEditorOpen]);

  useEffect(() => {
    setDepEditorOpen(false);
  }, [selectedNode?.id]);

  useEffect(() => {
    setRouteDraft("");
  }, [selectedNode?.id]);

  const toggleDependsOn = (nodeId: string, checked: boolean) => {
    if (!nodeId) return;
    const next = checked
      ? Array.from(new Set([...draftDependsOn, nodeId]))
      : draftDependsOn.filter((id) => id !== nodeId);
    onChangeDraftDependsOn(next);
  };

  const displayStatus =
    selectedNode && !hasPipelineExecution && (selectedNode.status === "queued" || selectedNode.status === "blocked")
      ? "ready"
      : (selectedNode?.status ?? "queued");

  const commitRouteOptions = (routes: string[]) => {
    const custom = routes
      .map((item) => item.trim())
      .filter((item) => item && item !== MAINLINE_ROUTE_VALUE && item !== DEFAULT_BRANCH_ROUTE_VALUE);
    const normalized =
      custom.length > 0 || routes.includes(DEFAULT_BRANCH_ROUTE_VALUE)
        ? Array.from(new Set([MAINLINE_ROUTE_VALUE, DEFAULT_BRANCH_ROUTE_VALUE, ...custom])).slice(0, 5)
        : [];
    onChangeDraftWorkflowRouteAllowed(normalized.join(","));
  };

  const addRouteOption = () => {
    const nextRoute = routeDraft.trim();
    if (
      !nextRoute ||
      nextRoute === MAINLINE_ROUTE_VALUE ||
      nextRoute === DEFAULT_BRANCH_ROUTE_VALUE ||
      routeOptions.includes(nextRoute) ||
      routeOptions.length >= 5
    )
      return;
    commitRouteOptions([...routeOptions, nextRoute]);
    setRouteDraft("");
  };

  const removeRouteOption = (route: string) => {
    if (route === MAINLINE_ROUTE_VALUE || route === DEFAULT_BRANCH_ROUTE_VALUE) return;
    commitRouteOptions(routeOptions.filter((item) => item !== route));
    onChangeDraftWorkflowRouteTarget(route, "");
  };

  const enableRouting = () => {
    commitRouteOptions([DEFAULT_BRANCH_ROUTE_VALUE]);
  };

  const disableRouting = () => {
    for (const route of routeOptions) {
      onChangeDraftWorkflowRouteTarget(route, "");
    }
    commitRouteOptions([]);
  };

  return (
    <aside className={detailPanelClassName}>
      <div className={detailPanelHeadClassName}>
        <h2 className={detailPanelTitleClassName}>{t("nodeDetail")}</h2>
        <div className={detailPanelStatusClassName}>
          {isSaving ? (
            <span className={`${statusTagBaseClassName} ${statusTagToneClassName.live}`}>{t("saving")}</span>
          ) : null}
          <span
            className={`${statusTagBaseClassName} ${statusTagToneClassName[(statusTone[displayStatus] ?? "muted") as keyof typeof statusTagToneClassName]}`}
          >
            {selectedNode ? statusLabel[displayStatus] : "-"}
          </span>
        </div>
      </div>
      <div className={fieldClassName}>
        <label className={fieldLabelClassName}>{t("nodeTitle")}</label>
        <input
          className={controlInputClassName}
          value={draftTitle}
          onChange={(e) => onChangeDraftTitle(e.target.value)}
          disabled={!selectedNode}
        />
      </div>
      <div className={adapterGridFieldClassName}>
        <label className="block text-xs text-(--muted)">Agent</label>
        <InlineSelect
          value={draftAgentId}
          options={(agentOptions.length ? agentOptions : [draftAgentId || "-"]).map((agentId) => ({
            value: agentId,
            label: agentId,
          }))}
          onChange={onChangeDraftAgentId}
          onClose={() => {}}
          triggerClassName={controlInputClassName}
          disabled={!selectedNode}
          ariaLabel="Agent"
        />
      </div>
      <div className={adapterGridFieldClassName}>
        <label className="block text-xs text-(--muted)">{t("session")}</label>
        <InlineSelect
          value={draftExecutorSessionId}
          options={(sessionOptions.length
            ? sessionOptions
            : [{ id: draftExecutorSessionId || "-", title: draftExecutorSessionId || "-" }]
          ).map((session) => ({
            value: session.id,
            label: session.id,
          }))}
          onChange={onChangeDraftExecutorSessionId}
          triggerClassName={controlInputClassName}
          disabled={!selectedNode}
          ariaLabel={t("session")}
        />
      </div>
      <div className={adapterInstructionFieldClassName}>
        <label className="block text-xs text-(--muted)">{t("agentInstruction")}</label>
        <textarea
          className={controlTextAreaMonoClassName}
          value={draftInstruction}
          onChange={(e) => onChangeDraftInstruction(e.target.value)}
          disabled={!selectedNode}
          rows={5}
        />
      </div>
      <div className={fieldClassName}>
        <label className={fieldLabelClassName}>{t("lane")}</label>
        <InlineSelect
          value={draftWorkflowLane}
          options={[
            { value: "main", label: "main" },
            { value: "branch", label: "branch" },
          ]}
          onChange={(next) => onChangeDraftWorkflowLane(next === "branch" ? "branch" : "main")}
          triggerClassName={controlInputClassName}
          disabled={!selectedNode}
          ariaLabel={t("lane")}
        />
      </div>
      <div className={fieldClassName}>
        <div className={routeSwitchRowClassName}>
          <label className="block text-xs text-[var(--muted)]">{t("routeAllowed")}</label>
          <button
            type="button"
            className={`${routeSwitchClassName} ${routeOptions.length > 0 ? routeSwitchOnClassName : ""}`}
            onClick={routeOptions.length > 0 ? disableRouting : enableRouting}
            disabled={!selectedNode}
            aria-pressed={routeOptions.length > 0}
            aria-label={t("toggleRoute")}
            title={t("toggleRoute")}
          >
            <span
              className={`${routeSwitchThumbClassName} ${routeOptions.length > 0 ? routeSwitchThumbOnClassName : routeSwitchThumbOffClassName}`}
            >
              {routeOptions.length > 0 ? t("routeOn") : t("routeOff")}
            </span>
          </button>
        </div>
        {routeOptions.length > 0 ? (
          <div className={routeEditorClassName}>
            <div className={routeChipListClassName}>
              {routeOptions.length ? (
                routeOptions.map((route) => (
                  <span key={route} className={`${routeChipClassName} ${monoClassName}`}>
                    <span>{route}</span>
                    <button
                      type="button"
                      className={routeChipRemoveClassName}
                      onClick={() => removeRouteOption(route)}
                      disabled={!selectedNode || route === MAINLINE_ROUTE_VALUE || route === DEFAULT_BRANCH_ROUTE_VALUE}
                      aria-label={t("deleteRoute", { route })}
                    >
                      x
                    </button>
                  </span>
                ))
              ) : (
                <span className={`${monoClassName} text-xs text-(--muted)`}>{t("noRoute")}</span>
              )}
            </div>
            <div className={routeEditorRowClassName}>
              <input
                className={`${controlInputMonoClassName} min-h-9 box-border`}
                value={routeDraft}
                onChange={(e) => setRouteDraft(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  addRouteOption();
                }}
                disabled={!selectedNode || routeOptions.length >= 5}
                placeholder={t("routePlaceholder")}
              />
              <button
                type="button"
                className={`${actionButtonClassName} inline-grid h-9 w-9 min-w-9 place-items-center self-stretch p-0`}
                onClick={addRouteOption}
                disabled={
                  !selectedNode ||
                  !routeDraft.trim() ||
                  routeDraft.trim() === MAINLINE_ROUTE_VALUE ||
                  routeDraft.trim() === DEFAULT_BRANCH_ROUTE_VALUE ||
                  routeOptions.length >= 5
                }
                aria-label={t("addRoute")}
                title={t("addRoute")}
              >
                <PlusIcon />
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {routeTargetOptionsForEdit.length > 0 ? (
        <div className={fieldClassName}>
          <label className={fieldLabelClassName}>{t("routeTargets")}</label>
          {routeTargetOptionsForEdit.map((route) => (
            <div key={route} className={routeTargetItemClassName}>
              <label className="mb-0 text-(--text)">{route}</label>
              <InlineSelect
                value={draftWorkflowRouteTargets[route] ?? ""}
                options={[
                  { value: "", label: t("notConfigured") },
                  ...routeTargetOptions.map((node) => ({
                    value: node.id,
                    label: `${node.id} - ${node.title}`,
                  })),
                ]}
                onChange={(next) => onChangeDraftWorkflowRouteTarget(route, next)}
                triggerClassName={controlInputClassName}
                disabled={!selectedNode}
                ariaLabel={t("selectRouteTarget", { route })}
              />
            </div>
          ))}
        </div>
      ) : null}
      <div className={fieldClassName}>
        <div className={kvHeadClassName}>
          <label className="block text-xs text-(--muted)">{t("dependsOn")}</label>
        </div>
        <div className={depPickerClassName} ref={depEditorRef}>
          <div
            className={`${controlInputClassName} ${depEditorOpen ? depInlineValueOpenClassName : ""}`}
            title={draftDependsOn.join(",")}
            role="button"
            tabIndex={selectedNode ? 0 : -1}
            onClick={() => {
              if (!selectedNode) return;
              setDepEditorOpen((prev) => !prev);
            }}
            onKeyDown={(event) => {
              if (!selectedNode) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setDepEditorOpen((prev) => !prev);
              }
            }}
            aria-label={t("editDepends")}
          >
            {draftDependsOn.length ? draftDependsOn.join(",") : "-"}
          </div>
          {depEditorOpen ? (
            <div className={depDropdownClassName}>
              {dependencyOptions.length ? (
                dependencyOptions.map((node) => (
                  <label
                    key={node.id}
                    className={`${depOptionClassName} ${draftDependsOn.includes(node.id) ? depOptionCheckedClassName : ""}`}
                  >
                    <input
                      type="checkbox"
                      className={depCheckboxClassName}
                      checked={draftDependsOn.includes(node.id)}
                      onChange={(event) => toggleDependsOn(node.id, event.target.checked)}
                    />
                    <span
                      className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                      title={`${node.id} - ${node.title}`}
                    >
                      {node.id} - {node.title}
                    </span>
                  </label>
                ))
              ) : (
                <p className={depEmptyClassName}>{t("noDepends")}</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div className={fieldClassName}>
        <label className={fieldLabelClassName}>{t("allowReject")}</label>
        <InlineSelect
          value={draftAllowReject ? "yes" : "no"}
          options={[
            { value: "no", label: t("rejectNo") },
            { value: "yes", label: t("rejectYes") },
          ]}
          onChange={(next) => onChangeDraftAllowReject(next === "yes")}
          triggerClassName={controlInputClassName}
          disabled={!selectedNode}
          ariaLabel={t("selectReject")}
        />
      </div>
      {draftAllowReject ? (
        <div className={fieldClassName}>
          <label className={fieldLabelClassName}>{t("maxRejectCount")}</label>
          <input
            className={controlInputClassName}
            type="number"
            min={0}
            max={10}
            step={1}
            value={Number.isFinite(draftMaxRejectCount) ? draftMaxRejectCount : 0}
            onChange={(e) => onChangeDraftMaxRejectCount(Number(e.target.value))}
            disabled={!selectedNode}
          />
        </div>
      ) : null}
      <div className={fieldClassName}>
        <label className={fieldLabelClassName}>{t("artifacts")}</label>
        <code className={fieldCodeClassName}>
          {selectedNode && selectedNode.artifacts.length
            ? selectedNode.artifacts
                .map((artifact) => `${artifact.type}@v${artifact.schemaVersion} ${artifact.path} (${artifact.hash})`)
                .join("\n")
            : "-"}
        </code>
      </div>
      <button className={actionButtonClassName} onClick={onRetry}>
        {t("retryNode")}
      </button>
    </aside>
  );
}
