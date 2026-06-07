import { useTranslation } from "react-i18next";
import i18next from "i18next";
import type { StoredArtifactContent, StoredArtifactItem } from "../../../entities/artifact";

type ArtifactPreviewPaneProps = {
  item: StoredArtifactItem | undefined;
  content: StoredArtifactContent | null;
  loadingKey: string;
  contentError: string;
};

const monoClassName = "font-[JetBrains_Mono,monospace]";

const toPreviewText = (content: StoredArtifactContent | null): string => {
  if (!content) return "";
  // envelope content: show contents[] + logs[]
  const contentObj = content.content as Record<string, unknown> | null;
  if (contentObj && (Array.isArray(contentObj.contents) || Array.isArray(contentObj.logs))) {
    const parts: string[] = [];
    if (Array.isArray(contentObj.contents) && contentObj.contents.length > 0) {
      parts.push(i18next.t("artifact:contentLabel"));
      for (const c of contentObj.contents) {
        parts.push(typeof c === "string" ? c : JSON.stringify(c, null, 2));
      }
    }
    if (Array.isArray(contentObj.logs) && contentObj.logs.length > 0) {
      parts.push(i18next.t("artifact:logLabel"));
      for (const log of contentObj.logs) {
        parts.push(typeof log === "string" ? log : JSON.stringify(log));
      }
    }
    if (parts.length > 0) return parts.join("\n\n");
  }
  if (typeof content.content === "string") return content.content;
  try {
    return JSON.stringify(content.content, null, 2);
  } catch {
    return content.rawText;
  }
};

export function ArtifactPreviewPane({ item, content, loadingKey, contentError }: ArtifactPreviewPaneProps) {
  const { t } = useTranslation("artifact");
  const key = item ? `${item.pipelineId}:${item.relativePath}` : "";
  const isLoading = !!item && loadingKey === key;
  const previewText = toPreviewText(content);
  return (
    <section className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] border border-(--line) bg-[rgba(12,21,27,0.85)]">
      <div className="border-b border-(--line) px-2 py-1.5 text-xs text-(--muted)">{t("artifactDetail")}</div>
      <div className="grid gap-1 border-b border-(--line) px-2 py-2 text-xs text-(--muted)">
        <div className={monoClassName}>pipeline: {item?.pipelineId ?? "-"}</div>
        <div className={monoClassName}>runId: {item?.runId ?? "-"}</div>
        <div className={monoClassName}>status: {item?.status ?? "-"}</div>
        <div className={monoClassName}>nodeId: {item?.nodeId ?? "-"}</div>
        <div className={monoClassName}>
          size: {item?.sizeBytes != null ? `${(item.sizeBytes / 1024).toFixed(1)} KB` : "-"}
        </div>
        <div className={monoClassName}>path: {item?.relativePath ?? "-"}</div>
      </div>
      <div className="min-h-0 overflow-auto p-2">
        {!item ? <p className={`${monoClassName} m-0 text-xs text-(--muted)`}>{t("selectFile")}</p> : null}
        {item && isLoading ? (
          <p className={`${monoClassName} m-0 text-xs text-(--muted)`}>{t("contentLoading")}</p>
        ) : null}
        {item && !isLoading && contentError ? (
          <p className={`${monoClassName} m-0 text-xs text-(--bad)`}>
            {t("contentLoadFailed", { error: contentError })}
          </p>
        ) : null}
        {item && !isLoading ? (
          <code className="block min-h-full whitespace-pre-wrap break-words border border-[rgba(142,163,179,0.18)] bg-[rgba(6,12,16,0.86)] p-2 text-xs text-(--text)">
            {previewText || t("contentEmpty")}
          </code>
        ) : null}
      </div>
    </section>
  );
}
