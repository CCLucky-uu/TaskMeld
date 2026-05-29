import { controlInputElevatedMonoClassName } from "../../../shared/ui/surfaceClassNames";

type RemoteBatchPanelProps = {
  title: string;
  statusText: string;
  startBatch: string;
  isOperating: boolean;
  onChangeStartBatch: (value: string) => void;
};

const monoClassName = "font-[JetBrains_Mono,monospace]";

export function RemoteBatchPanel({
  title,
  statusText,
  startBatch,
  isOperating,
  onChangeStartBatch,
}: RemoteBatchPanelProps) {
  return (
    <div className="mb-3 grid p-3 pt-0 gap-2 border-b border-(--line) bg-transparent">
      {/* 远程批跑单独做成组件，避免每条流水线卡片重复堆叠同一段表单/状态布局。 */}
      <div className={`${monoClassName} text-xs text-(--muted)`}>{title}</div>
      <code className="block max-h-30 overflow-auto whitespace-pre-wrap wrap-break-word border border-(--line) bg-[#0f171d] p-2.5 text-xs">
        {statusText}
      </code>
      <div className="grid grid-cols-[180px_minmax(0,1fr)] items-end gap-2.5 max-[760px]:grid-cols-1">
        <input
          className={`${controlInputElevatedMonoClassName} min-w-0 text-[13px]`}
          value={startBatch}
          onChange={(event) => onChangeStartBatch(event.target.value)}
          placeholder="起始批次"
          inputMode="numeric"
          disabled={isOperating}
        />
        <div aria-hidden="true" />
      </div>
    </div>
  );
}
