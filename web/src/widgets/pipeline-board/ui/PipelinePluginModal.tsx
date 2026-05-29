import { useState } from "react";
import { WorkflowPlugins } from "../../../entities/pipeline";
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
const toggleClassName =
  "h-4 w-4 rounded-none border border-(--line) bg-[#0f171d] text-(--live) accent-(--live)";
const fieldClassName = "min-w-0";
const fieldLabelClassName = "mb-1.5 block text-xs text-(--muted)";
const actionButtonClassName =
  "mt-0 cursor-pointer border border-(--live-25) bg-transparent px-2 py-2 font-semibold text-(--live) hover:bg-[rgba(50,215,186,0.1)]";

export function PipelinePluginModal({
  pipelineId,
  pluginState,
  onClose,
  onSave,
}: PipelinePluginModalProps) {
  const [draft, setDraft] = useState<WorkflowPlugins>(pluginState);

  return (
    <div>
      <div className={panelHeaderClassName}>
        <h2>插件配置（DAG-{pipelineId}）</h2>
        <button
          className={drawerCloseClassName}
          type="button"
          onClick={onClose}
          aria-label="关闭"
        >
          <CloseIcon />
        </button>
      </div>
      <p className={`${modalSublineClassName} ${monoClassName}`}>
        所有流水线共享同一套插件能力；这里仅配置当前流水线要不要打开对应插件。
      </p>
      <label className="flex items-center justify-between gap-3 border-y border-(--line) bg-transparent p-3 text-sm text-(--text)">
        <div className="grid gap-1">
          <strong>远程关键词池批跑</strong>
          <span className={`${monoClassName} text-xs text-(--muted)`}>启用后会在 DAG-{pipelineId} 卡片中显示该插件面板。</span>
        </div>
        <input
          className={toggleClassName}
          type="checkbox"
          checked={draft.remoteBatch.enabled}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              remoteBatch: {
                ...current.remoteBatch,
                enabled: event.target.checked,
              },
            }))}
        />
      </label>
      {draft.remoteBatch.enabled ? (
        <div className="grid gap-3 border-b border-(--line) bg-transparent p-3">
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>远程关键词池地址</label>
            <input
              className={controlInputElevatedMonoClassName}
              value={draft.remoteBatch.url}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  remoteBatch: {
                    ...current.remoteBatch,
                    url: event.target.value,
                  },
                }))}
              placeholder="http://host/path"
              spellCheck={false}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 max-[760px]:grid-cols-1">
            <div className={fieldClassName}>
              <label className={fieldLabelClassName}>每批可跑个数</label>
              <input
                className={controlInputElevatedMonoClassName}
                value={String(draft.remoteBatch.batchSize)}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    remoteBatch: {
                      ...current.remoteBatch,
                      batchSize: Math.max(1, Math.trunc(Number(event.target.value) || 1)),
                    },
                  }))}
                placeholder="5"
                inputMode="numeric"
              />
            </div>
            <div className={fieldClassName}>
              <label className={fieldLabelClassName}>默认起始批次</label>
              <input
                className={controlInputElevatedMonoClassName}
                value={String(draft.remoteBatch.startBatch)}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    remoteBatch: {
                      ...current.remoteBatch,
                      startBatch: Math.max(1, Math.trunc(Number(event.target.value) || 1)),
                    },
                  }))}
                placeholder="1"
                inputMode="numeric"
              />
            </div>
          </div>
          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>跑哪个字段</label>
            <input
              className={controlInputElevatedMonoClassName}
              value={draft.remoteBatch.sourceField}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  remoteBatch: {
                    ...current.remoteBatch,
                    sourceField: event.target.value,
                  },
                }))}
              placeholder="例如 list30 或 data.list30"
              spellCheck={false}
            />
            <small className={`${monoClassName} mt-1.5 block text-xs text-(--muted)`}>
              支持点路径；取不到时后端会退回默认字段探测。
            </small>
          </div>
        </div>
      ) : null}
      <label className="mt-3 flex items-center justify-between gap-3 border-y border-(--line) bg-transparent p-3 text-sm text-(--text)">
        <div className="grid gap-1">
          <strong>调度器</strong>
          <span className={`${monoClassName} text-xs text-(--muted)`}>启用后显示调度器卡片，并允许自动/手动调度。</span>
        </div>
        <input
          className={toggleClassName}
          type="checkbox"
          checked={draft.scheduler.enabled}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              scheduler: {
                enabled: event.target.checked,
              },
            }))}
        />
      </label>
      <div className={`${actionRowClassName} mt-3`}>
        <button
          className={actionButtonClassName}
          type="button"
          onClick={() => onSave(draft)}
        >
          保存插件配置
        </button>
      </div>
    </div>
  );
}
