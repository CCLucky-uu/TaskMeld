import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("pipeline");
  return (
    <div className="mb-3 grid p-3 pt-0 gap-2 border-b border-(--line) bg-transparent">
      {/* Remote batch panel is a separate component so every pipeline card doesn't duplicate the same form/status layout. */}
      <div className={`${monoClassName} text-xs text-(--muted)`}>{title}</div>
      <code className="block max-h-30 overflow-auto whitespace-pre-wrap wrap-break-word border border-(--line) bg-[#0f171d] p-2.5 text-xs">
        {statusText}
      </code>
      <div className="grid grid-cols-[180px_minmax(0,1fr)] items-end gap-2.5 max-[760px]:grid-cols-1">
        <input
          className={`${controlInputElevatedMonoClassName} min-w-0 text-[13px]`}
          value={startBatch}
          onChange={(event) => onChangeStartBatch(event.target.value)}
          placeholder={t("startBatchPlaceholder")}
          inputMode="numeric"
          disabled={isOperating}
        />
        <div aria-hidden="true" />
      </div>
    </div>
  );
}
