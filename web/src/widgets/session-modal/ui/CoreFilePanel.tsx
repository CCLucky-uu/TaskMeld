import { useTranslation } from "react-i18next";
import { MarkdownViewer } from "../../../shared/ui";
import { drawerCloseClassName } from "../../../shared/ui/surfaceClassNames";

type CoreFilePanelProps = {
  selectedAgentId: string;
  selectedFileName: string;
  updatedAtText: string;
  isEditingFile: boolean;
  isSavingFile: boolean;
  fileSaveError: string;
  fileEditDraft: string;
  onChangeDraft: (value: string) => void;
  onBeginEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  canEditCurrentFile: boolean;
  canRenderMarkdown: boolean;
  filePaneText: string;
};

const monoClassName = "font-[JetBrains_Mono,monospace]";

export function CoreFilePanel({
  selectedAgentId,
  selectedFileName,
  updatedAtText,
  isEditingFile,
  isSavingFile,
  fileSaveError,
  fileEditDraft,
  onChangeDraft,
  onBeginEdit,
  onCancelEdit,
  onSave,
  canEditCurrentFile,
  canRenderMarkdown,
  filePaneText,
}: CoreFilePanelProps) {
  const { t } = useTranslation("session");
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
      <div className="flex items-center justify-between gap-[10px] bg-transparent px-0 py-[6px] pb-2 text-xs text-[var(--muted)]">
        <div className={`${monoClassName} flex min-w-0 gap-3`}>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            agent: {selectedAgentId || "-"}
          </span>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            file: {selectedFileName || "-"}
          </span>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">updated: {updatedAtText}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!isEditingFile ? (
            <button
              className={`${drawerCloseClassName} h-auto w-auto px-[9px] py-1 text-xs`}
              type="button"
              onClick={onBeginEdit}
              disabled={!canEditCurrentFile}
            >
              {t("edit")}
            </button>
          ) : (
            <>
              <button
                className={`${drawerCloseClassName} h-auto w-auto px-[9px] py-1 text-xs`}
                type="button"
                onClick={onCancelEdit}
                disabled={isSavingFile}
              >
                {t("cancel")}
              </button>
              <button
                className={`${drawerCloseClassName} h-auto w-auto border-[var(--live)] px-[9px] py-1 text-xs text-[var(--live)] hover:bg-[rgba(50,215,186,0.12)]`}
                type="button"
                onClick={onSave}
                disabled={isSavingFile}
              >
                {isSavingFile ? t("saving") : t("save")}
              </button>
            </>
          )}
        </div>
      </div>
      {fileSaveError ? (
        <p className={`${monoClassName} m-0 text-xs text-[var(--bad)]`}>{t("saveFailed", { error: fileSaveError })}</p>
      ) : null}
      <div className={`${isEditingFile ? "overflow-hidden px-3 pt-0" : "overflow-auto px-3 pt-2"} min-h-0`}>
        {isEditingFile ? (
          <textarea
            className={`${monoClassName} block h-full min-h-0 w-full resize-none overflow-auto border border-[var(--line)] bg-[#0f171d] p-[10px] text-[13px] leading-[1.45] text-[var(--text)]`}
            value={fileEditDraft}
            onChange={(event) => onChangeDraft(event.target.value)}
            spellCheck={false}
          />
        ) : canRenderMarkdown ? (
          <MarkdownViewer content={filePaneText} />
        ) : (
          <pre className="m-0 whitespace-pre-wrap break-words p-0 font-[JetBrains_Mono,monospace] text-[13px] leading-[1.45] text-[var(--text)]">
            {filePaneText}
          </pre>
        )}
      </div>
    </div>
  );
}
