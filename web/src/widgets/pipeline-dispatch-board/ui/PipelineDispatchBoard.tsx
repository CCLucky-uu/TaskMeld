import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchPipelineLinks,
  createPipelineLink,
  updatePipelineLink,
  deletePipelineLink,
  fetchPipelineOutputs,
  fetchPipelineQueue,
  retryPipelineQueueJob,
  cancelPipelineQueueJob,
  drainPipelineQueue,
} from "../../../entities/pipeline/service";
import type {
  PipelineLink,
  PipelineInboundJob,
  PipelineOutput,
  PipelineListItem,
} from "../../../entities/pipeline/types";
import { actionRowClassName, panelHeaderClassName } from "../../../shared/ui/panelClasses";
import {
  controlInputClassName,
  controlSingleLineMonoClassName,
  controlInputMonoClassName,
  drawerCloseClassName,
  modalSublineClassName,
} from "../../../shared/ui/surfaceClassNames";
import CloseIcon from "@iconify-react/lucide/x";
import PlusIcon from "@iconify-react/lucide/plus";
import RefreshCwIcon from "@iconify-react/lucide/refresh-cw";
import Trash2Icon from "@iconify-react/lucide/trash-2";

type Props = {
  pipelines: Array<{ id: string; title: string }>;
};

type Tab = "links" | "queue" | "outputs";

const tabBtnClass = "px-3 py-1.5 text-xs font-semibold border border-[var(--line)] cursor-pointer bg-transparent";
const tabBtnActiveClass = "bg-[var(--live-15)] text-[var(--live)] border-[var(--live-35)]";

const statusTone: Record<string, string> = {
  pending: "warn",
  running: "live",
  success: "good",
  failed: "bad",
  canceled: "muted",
};

export function PipelineDispatchBoard({ pipelines }: Props) {
  const { t } = useTranslation("dispatch");
  const [links, setLinks] = useState<PipelineLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  // Create link form
  const [createOpen, setCreateOpen] = useState(false);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [newOnFailed, setNewOnFailed] = useState<"continue" | "pause">("continue");
  const [newMaxPending, setNewMaxPending] = useState(100);
  const [saving, setSaving] = useState(false);

  // Queue
  const [queuePipeline, setQueuePipeline] = useState("");
  const [queue, setQueue] = useState<PipelineInboundJob[]>([]);
  const [outputs, setOutputs] = useState<PipelineOutput[]>([]);
  const [outputsPipeline, setOutputsPipeline] = useState("");
  const [tab, setTab] = useState<Tab>("links");

  const loadLinks = useCallback(async () => {
    try {
      const items = await fetchPipelineLinks();
      setLinks(items);
    } catch {
      // ignore
    }
    setLoading(false);
  }, []);

  const loadQueue = useCallback(async (pipelineId: string) => {
    if (!pipelineId) return;
    try {
      const items = await fetchPipelineQueue(pipelineId);
      setQueue(items);
    } catch {
      setQueue([]);
    }
  }, []);

  const loadOutputs = useCallback(async (pipelineId: string) => {
    if (!pipelineId) return;
    try {
      const items = await fetchPipelineOutputs(pipelineId);
      setOutputs(items);
    } catch {
      setOutputs([]);
    }
  }, []);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  useEffect(() => {
    if (tab === "queue" && queuePipeline) void loadQueue(queuePipeline);
  }, [tab, queuePipeline, loadQueue]);

  useEffect(() => {
    if (tab === "outputs" && outputsPipeline) void loadOutputs(outputsPipeline);
  }, [tab, outputsPipeline, loadOutputs]);

  const handleCreate = async () => {
    if (!newFrom || !newTo) return;
    setSaving(true);
    setMessage("");
    try {
      const result = await createPipelineLink({
        fromPipelineId: newFrom,
        toPipelineId: newTo,
        onJobFailed: newOnFailed,
        maxPendingJobs: newMaxPending,
      });
      if (result.ok) {
        setCreateOpen(false);
        setNewFrom("");
        setNewTo("");
        await loadLinks();
      } else {
        setMessage(result.error ?? t("createFailed"));
      }
    } catch (err) {
      setMessage(String(err));
    }
    setSaving(false);
  };

  const handleToggle = async (link: PipelineLink) => {
    await updatePipelineLink(link.id, { enabled: !link.enabled });
    await loadLinks();
  };

  const handleDelete = async (linkId: string) => {
    await deletePipelineLink(linkId);
    await loadLinks();
  };

  const handleRetry = async (pipelineId: string, jobId: string) => {
    await retryPipelineQueueJob(pipelineId, jobId);
    await loadQueue(pipelineId);
  };

  const handleCancel = async (pipelineId: string, jobId: string) => {
    await cancelPipelineQueueJob(pipelineId, jobId);
    await loadQueue(pipelineId);
  };

  const handleDrain = async (pipelineId: string) => {
    await drainPipelineQueue(pipelineId);
    await loadQueue(pipelineId);
  };

  if (loading) {
    return <div className="p-4 text-xs text-[var(--muted)]">{t("loading")}</div>;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--line)]">
        <button
          className={`${tabBtnClass} ${tab === "links" ? tabBtnActiveClass : ""}`}
          onClick={() => setTab("links")}
        >
          {t("links")}
        </button>
        <button
          className={`${tabBtnClass} ${tab === "queue" ? tabBtnActiveClass : ""}`}
          onClick={() => setTab("queue")}
        >
          {t("queue")}
        </button>
        <button
          className={`${tabBtnClass} ${tab === "outputs" ? tabBtnActiveClass : ""}`}
          onClick={() => setTab("outputs")}
        >
          {t("outputs")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Links Tab */}
        {tab === "links" && (
          <div className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[var(--text)]">
                {t("linkCount", { count: links.length })}
              </span>
              <button
                className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-[var(--live-25)] text-[var(--live)] cursor-pointer bg-transparent hover:bg-[var(--live-10)]"
                onClick={() => {
                  setCreateOpen(!createOpen);
                  setMessage("");
                  if (!newFrom) setNewFrom(pipelines[0]?.id ?? "");
                  if (!newTo) setNewTo(pipelines[1]?.id ?? pipelines[0]?.id ?? "");
                }}
              >
                <PlusIcon className="w-3 h-3" />
                {t("createLink")}
              </button>
            </div>

            {message && <p className={`${modalSublineClassName} mb-2 text-[var(--bad)]`}>{message}</p>}

            {/* Create form */}
            {createOpen && (
              <div className="mb-3 p-3 border border-[var(--line)] bg-[var(--surface-5)]">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="block mb-1 text-[11px] text-[var(--muted)]">{t("upstreamPipeline")}</label>
                    <select
                      className={controlInputMonoClassName}
                      value={newFrom}
                      onChange={(e) => setNewFrom(e.target.value)}
                    >
                      {pipelines.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id} | {p.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block mb-1 text-[11px] text-[var(--muted)]">{t("downstreamPipeline")}</label>
                    <select
                      className={controlInputMonoClassName}
                      value={newTo}
                      onChange={(e) => setNewTo(e.target.value)}
                    >
                      {pipelines.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id} | {p.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="block mb-1 text-[11px] text-[var(--muted)]">{t("failPolicy")}</label>
                    <select
                      className={controlInputMonoClassName}
                      value={newOnFailed}
                      onChange={(e) => setNewOnFailed(e.target.value as "continue" | "pause")}
                    >
                      <option value="continue">{t("continueOption")}</option>
                      <option value="pause">{t("pauseOption")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block mb-1 text-[11px] text-[var(--muted)]">{t("maxQueue")}</label>
                    <input
                      className={controlSingleLineMonoClassName}
                      type="number"
                      min={1}
                      max={10000}
                      value={newMaxPending}
                      onChange={(e) => setNewMaxPending(Number(e.target.value) || 100)}
                    />
                  </div>
                </div>
                <div className={actionRowClassName}>
                  <button
                    className="px-3 py-1 text-xs border border-[var(--live-25)] bg-transparent text-[var(--live)] cursor-pointer"
                    onClick={handleCreate}
                    disabled={saving || !newFrom || !newTo || newFrom === newTo}
                  >
                    {saving ? t("creating") : t("confirmCreate")}
                  </button>
                  <button
                    className="px-3 py-1 text-xs border border-[var(--line)] bg-transparent text-[var(--muted)] cursor-pointer"
                    onClick={() => setCreateOpen(false)}
                  >
                    {t("cancel")}
                  </button>
                </div>
              </div>
            )}

            {/* Links list */}
            {links.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">{t("noLinks")}</p>
            ) : (
              <div className="space-y-1">
                {links.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center gap-2 p-2 border border-[var(--line)] bg-[var(--surface-3)] text-xs"
                  >
                    <span className="text-[var(--live)] font-mono text-[11px]">{link.id}</span>
                    <span className="font-mono text-[var(--text)]">{link.fromPipelineId}</span>
                    <span className="text-[var(--muted)]">→</span>
                    <span className="font-mono text-[var(--text)]">{link.toPipelineId}</span>
                    {link.inputContract?.requireType && (
                      <span className="text-[var(--muted)] text-[10px]">type:{link.inputContract.requireType}</span>
                    )}
                    <span
                      className={`ml-auto px-1.5 py-0.5 text-[10px] font-semibold ${link.enabled ? "text-[var(--good)]" : "text-[var(--muted)]"}`}
                    >
                      {link.enabled ? t("common:common.enabled") : t("common:common.disabled")}
                    </span>
                    <span className="text-[10px] text-[var(--muted)]">
                      onFailed:{link.onJobFailed} | max:{link.maxPendingJobs}
                    </span>
                    <button
                      className="px-1.5 py-0.5 text-[10px] border border-[var(--line)] bg-transparent text-[var(--text)] cursor-pointer"
                      onClick={() => handleToggle(link)}
                    >
                      {link.enabled ? t("disable") : t("enable")}
                    </button>
                    <button
                      className="px-1.5 py-0.5 text-[10px] border border-[var(--bad-25)] bg-transparent text-[var(--bad)] cursor-pointer"
                      onClick={() => handleDelete(link.id)}
                    >
                      <Trash2Icon className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Queue Tab */}
        {tab === "queue" && (
          <div className="p-3">
            <div className="mb-2">
              <label className="block mb-1 text-[11px] text-[var(--muted)]">{t("selectPipeline")}</label>
              <select
                className={controlInputMonoClassName}
                value={queuePipeline}
                onChange={(e) => setQueuePipeline(e.target.value)}
              >
                <option value="">{t("selectPipelinePlaceholder")}</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} | {p.title}
                  </option>
                ))}
              </select>
            </div>

            {!queuePipeline ? (
              <p className="text-xs text-[var(--muted)]">{t("selectToViewQueue")}</p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] text-[var(--muted)]">
                    {queue.length === 0 ? t("queueEmpty") : t("queueCount", { count: queue.length })}
                  </span>
                  <button
                    className="px-2 py-0.5 text-[10px] border border-[var(--live-25)] bg-transparent text-[var(--live)] cursor-pointer"
                    onClick={() => handleDrain(queuePipeline)}
                  >
                    {t("drainQueue")}
                  </button>
                </div>
                {queue.length > 0 && (
                  <div className="space-y-1">
                    {queue.map((job) => (
                      <div
                        key={job.jobId}
                        className="flex items-center gap-2 p-2 border border-[var(--line)] bg-[var(--surface-3)] text-xs"
                      >
                        <span className="font-mono text-[11px] text-[var(--text)] truncate max-w-[180px]">
                          {job.jobId}
                        </span>
                        <span className="text-[var(--muted)]">←</span>
                        <span className="font-mono text-[var(--text)]">{job.fromPipelineId}</span>
                        <span
                          className={`px-1 py-0.5 text-[10px] font-semibold text-[var(--${statusTone[job.status] ?? "muted"})]`}
                        >
                          {t(`common:status.${job.status}`)}
                        </span>
                        {job.targetRunId && (
                          <span className="text-[10px] text-[var(--muted)]">run:{job.targetRunId}</span>
                        )}
                        <span className="text-[10px] text-[var(--muted)] ml-auto">
                          {new Date(job.createdAt).toLocaleString()}
                        </span>
                        {(job.status === "failed" || job.status === "canceled") && (
                          <button
                            className="px-1.5 py-0.5 text-[10px] border border-[var(--live-25)] bg-transparent text-[var(--live)] cursor-pointer"
                            onClick={() => handleRetry(queuePipeline, job.jobId)}
                          >
                            <RefreshCwIcon className="w-3 h-3" />
                          </button>
                        )}
                        {job.status === "pending" && (
                          <button
                            className="px-1.5 py-0.5 text-[10px] border border-[var(--bad-25)] bg-transparent text-[var(--bad)] cursor-pointer"
                            onClick={() => handleCancel(queuePipeline, job.jobId)}
                          >
                            <CloseIcon className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Outputs Tab */}
        {tab === "outputs" && (
          <div className="p-3">
            <div className="mb-2">
              <label className="block mb-1 text-[11px] text-[var(--muted)]">{t("selectPipeline")}</label>
              <select
                className={controlInputMonoClassName}
                value={outputsPipeline}
                onChange={(e) => setOutputsPipeline(e.target.value)}
              >
                <option value="">{t("selectPipelinePlaceholder")}</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} | {p.title}
                  </option>
                ))}
              </select>
            </div>

            {!outputsPipeline ? (
              <p className="text-xs text-[var(--muted)]">{t("selectToViewOutputs")}</p>
            ) : outputs.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">{t("noOutputs")}</p>
            ) : (
              <div className="space-y-1">
                {outputs.map((output) => (
                  <div
                    key={output.outputId}
                    className="flex items-center gap-2 p-2 border border-[var(--line)] bg-[var(--surface-3)] text-xs"
                  >
                    <span className="font-mono text-[11px] text-[var(--text)]">{output.outputId}</span>
                    <span className="text-[var(--muted)]">node:{output.outputNodeId}</span>
                    <span className="text-[10px] text-[var(--muted)]">type:{output.artifactRef.type}</span>
                    <span className="text-[10px] text-[var(--muted)] ml-auto">
                      {new Date(output.producedAt).toLocaleString()}
                    </span>
                    <span className="text-[10px] text-[var(--muted)]">run:{output.runId}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
