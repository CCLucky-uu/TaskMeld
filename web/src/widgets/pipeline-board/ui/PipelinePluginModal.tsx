import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkflowPlugins, WorkflowPluginInstance } from "../../../entities/pipeline";
import { CloseIcon } from "../../../shared/ui";
import { actionRowClassName, panelHeaderClassName } from "../../../shared/ui/panelClasses";
import {
  controlInputElevatedMonoClassName,
  drawerCloseClassName,
  modalSublineClassName,
} from "../../../shared/ui/surfaceClassNames";
type PipelinePluginModalProps = {
  pipelineId: string;
  pluginState: WorkflowPlugins;
  onClose: () => void;
  onSave: (plugin: WorkflowPlugins) => void;
};

const monoClassName = "font-[JetBrains_Mono,monospace]";
const toggleClassName = "h-4 w-4 rounded-none border border-(--line) bg-[#0f171d] text-(--live) accent-(--live)";
const fieldClassName = "min-w-0";
const fieldLabelClassName = "mb-1.5 block text-xs text-(--muted)";
const actionButtonClassName =
  "mt-0 cursor-pointer border border-(--live-25) bg-transparent px-2 py-2 font-semibold text-(--live) hover:bg-[rgba(50,215,186,0.1)]";

// Helper: get or create a plugin instance from the array
function getPlugin(plugins: WorkflowPlugins, pluginId: string): WorkflowPluginInstance {
  return plugins.find((p) => p.pluginId === pluginId) ?? { pluginId, enabled: false, config: {} };
}

// Helper: update a plugin instance in the array
function updatePlugin(
  plugins: WorkflowPlugins,
  pluginId: string,
  updates: Partial<WorkflowPluginInstance>,
): WorkflowPlugins {
  const idx = plugins.findIndex((p) => p.pluginId === pluginId);
  const existing = idx >= 0 ? plugins[idx]! : { pluginId, enabled: false, config: {} };
  const updated = { ...existing, ...updates };
  if (idx >= 0) {
    const next = [...plugins];
    next[idx] = updated;
    return next;
  }
  return [...plugins, updated];
}

// Helper: update plugin config
function updatePluginConfig(
  plugins: WorkflowPlugins,
  pluginId: string,
  configUpdates: Record<string, unknown>,
): WorkflowPlugins {
  const existing = getPlugin(plugins, pluginId);
  return updatePlugin(plugins, pluginId, { config: { ...existing.config, ...configUpdates } });
}

export function PipelinePluginModal({ pipelineId, pluginState, onClose, onSave }: PipelinePluginModalProps) {
  const { t } = useTranslation(["pipeline", "modal"]);
  const [draft, setDraft] = useState<WorkflowPlugins>(pluginState);

  const remoteBatch = getPlugin(draft, "remote-batch");
  const scheduler = getPlugin(draft, "scheduler");

  return (
    <div>
      <div className={panelHeaderClassName}>
        <h2>{t("pluginConfigTitle", { pipelineId })}</h2>
        <button className={drawerCloseClassName} type="button" onClick={onClose} aria-label={t("modal:close")}>
          <CloseIcon />
        </button>
      </div>
      <p className={`${modalSublineClassName} ${monoClassName}`}>{t("pluginSharedNote")}</p>
      <label className="flex items-center justify-between gap-3 border-y border-(--line) bg-transparent p-3 text-sm text-(--text)">
        <div className="grid gap-1">
          <strong>{t("remoteBatchPlugin")}</strong>
          <span className={`${monoClassName} text-xs text-(--muted)`}>
            {t("remoteBatchPluginHint", { pipelineId })}
          </span>
        </div>
        <input
          className={toggleClassName}
          type="checkbox"
          checked={remoteBatch.enabled}
          onChange={(event) =>
            setDraft((current) => updatePlugin(current, "remote-batch", { enabled: event.target.checked }))
          }
        />
      </label>
      {remoteBatch.enabled ? (
        <div className="grid gap-3 border-b border-(--line) bg-transparent p-3">
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>{t("remoteUrl")}</label>
            <input
              className={controlInputElevatedMonoClassName}
              value={String(remoteBatch.config.url ?? "")}
              onChange={(event) =>
                setDraft((current) => updatePluginConfig(current, "remote-batch", { url: event.target.value }))
              }
              placeholder="http://host/path"
              spellCheck={false}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 max-[760px]:grid-cols-1">
            <div className={fieldClassName}>
              <label className={fieldLabelClassName}>{t("batchSize")}</label>
              <input
                className={controlInputElevatedMonoClassName}
                value={String(remoteBatch.config.batchSize ?? 5)}
                onChange={(event) =>
                  setDraft((current) =>
                    updatePluginConfig(current, "remote-batch", {
                      batchSize: Math.max(1, Math.trunc(Number(event.target.value) || 1)),
                    }),
                  )
                }
                placeholder="5"
                inputMode="numeric"
              />
            </div>
            <div className={fieldClassName}>
              <label className={fieldLabelClassName}>{t("startBatch")}</label>
              <input
                className={controlInputElevatedMonoClassName}
                value={String(remoteBatch.config.startBatch ?? 1)}
                onChange={(event) =>
                  setDraft((current) =>
                    updatePluginConfig(current, "remote-batch", {
                      startBatch: Math.max(1, Math.trunc(Number(event.target.value) || 1)),
                    }),
                  )
                }
                placeholder="1"
                inputMode="numeric"
              />
            </div>
          </div>
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>{t("sourceField")}</label>
            <input
              className={controlInputElevatedMonoClassName}
              value={String(remoteBatch.config.sourceField ?? "list30")}
              onChange={(event) =>
                setDraft((current) => updatePluginConfig(current, "remote-batch", { sourceField: event.target.value }))
              }
              placeholder={t("sourceFieldPlaceholder")}
              spellCheck={false}
            />
            <small className={`${monoClassName} mt-1.5 block text-xs text-(--muted)`}>{t("sourceFieldHint")}</small>
          </div>
        </div>
      ) : null}
      <label className="mt-3 flex items-center justify-between gap-3 border-y border-(--line) bg-transparent p-3 text-sm text-(--text)">
        <div className="grid gap-1">
          <strong>{t("schedulerPlugin")}</strong>
          <span className={`${monoClassName} text-xs text-(--muted)`}>{t("schedulerPluginHint")}</span>
        </div>
        <input
          className={toggleClassName}
          type="checkbox"
          checked={scheduler.enabled}
          onChange={(event) =>
            setDraft((current) => updatePlugin(current, "scheduler", { enabled: event.target.checked }))
          }
        />
      </label>
      <div className={actionRowClassName}>
        <button className={actionButtonClassName} type="button" onClick={onClose}>
          {t("modal:cancel")}
        </button>
        <button className={actionButtonClassName} type="button" onClick={() => onSave(draft)}>
          {t("modal:save")}
        </button>
      </div>
    </div>
  );
}
