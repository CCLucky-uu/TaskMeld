import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { AgentCoreFileItem, fetchAgentCoreFileContent, fetchAgentCoreFiles } from "../../../entities/agent";
import { SendMode, SessionItem } from "../../../entities/session";
import { fetchSessionHistory, SessionHistoryItem } from "../../../entities/session";
import { onWsEvent } from "../../../shared/ws-client";
import { dispatchGatewayWsEvent } from "../../../shared/realtime/gateway-events";
import { mergeHistoryEntries } from "../model/merge-history";
import { mergeAssistantText, readAssistantStreamPatch, readToolStreamPatch } from "../model/stream-patches";
import { LiveToolEntry } from "../model/session-modal-types";
import { ChatHistoryPanel } from "./ChatHistoryPanel";
import { CoreFilePanel } from "./CoreFilePanel";
import { CloseIcon, InlineSelect } from "../../../shared/ui";
import { panelHeaderClassName } from "../../../shared/ui/panelClasses";
import {
  controlInputMonoClassName,
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
import { useCoreFileEditor } from "./hooks/useCoreFileEditor";
import { useSessionHistoryScroll } from "./hooks/useSessionHistoryScroll";

type SessionModalProps = {
  open: boolean;
  selectedAgentId: string;
  selectedSessionId: string;
  sessions: SessionItem[];
  sendMode: SendMode;
  sessionMessage: string;
  onClose: () => void;
  onChangeSelectedSessionId: (value: string) => void;
  onChangeSendMode: (value: SendMode) => void;
  onChangeMessage: (value: string) => void;
  onSendMessage: (event: FormEvent) => void;
};

export function SessionModal({
  open,
  selectedAgentId,
  selectedSessionId,
  sessions,
  sendMode,
  sessionMessage,
  onClose,
  onChangeSelectedSessionId,
  onChangeSendMode,
  onChangeMessage,
  onSendMessage,
}: SessionModalProps) {
  const { t } = useTranslation("session");
  const monoClassName = "font-[JetBrains_Mono,monospace]";
  const actionButtonClassName =
    "cursor-pointer border border-[var(--live-25)] bg-transparent px-[10px] py-2 font-semibold text-[var(--live)] hover:bg-[rgba(50,215,186,0.1)]";
  const isDev = import.meta.env.DEV;
  const [activePanel, setActivePanel] = useState<"session" | "files">("session");
  const [coreFiles, setCoreFiles] = useState<AgentCoreFileItem[]>([]);
  const [coreFilesLoading, setCoreFilesLoading] = useState(false);
  const [coreFilesError, setCoreFilesError] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [fileContentLoading, setFileContentLoading] = useState(false);
  const [fileContentError, setFileContentError] = useState("");
  const [history, setHistory] = useState<SessionHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [collapsedToolMap, setCollapsedToolMap] = useState<Record<string, boolean>>({});
  const [collapsedToolOutputMap, setCollapsedToolOutputMap] = useState<Record<string, boolean>>({});
  const [liveAssistantId, setLiveAssistantId] = useState("");
  const [liveTools, setLiveTools] = useState<LiveToolEntry[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [virtualStats, setVirtualStats] = useState({ rendered: 0, total: 0 });
  const sessionFormRef = useRef<HTMLFormElement | null>(null);
  const modalRef = useRef<HTMLElement | null>(null);
  const liveAssistantIdRef = useRef<string>("");
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasSessions = sessions.length > 0;
  const canLoadFiles = open && Boolean(selectedAgentId.trim());
  const historySignature = useMemo(() => history.map((item) => `${item.id}:${item.ts ?? ""}`).join("|"), [history]);
  const {
    showScrollToBottom,
    historyViewportWidth,
    historyViewportHeight,
    historyScrollTop,
    setHistoryScrollerNode,
    handleHistoryScroll,
    markHistoryUserInteracted,
    scrollHistoryToBottom,
    resetHistoryScrollTracking,
  } = useSessionHistoryScroll({
    open,
    activePanel,
    selectedSessionId,
    historySignature,
    liveTools,
    isThinking,
  });

  useEffect(() => {
    if (open) {
      setActivePanel("session");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) return;
    const active = document.activeElement as HTMLElement | null;
    if (!active) return;
    if (modalRef.current?.contains(active)) {
      active.blur();
    }
  }, [open]);

  useEffect(() => {
    if (!open || activePanel !== "session") return;
    resetHistoryScrollTracking();
    if (!selectedSessionId) {
      setHistory([]);
      setHistoryError("");
      return;
    }

    let cancelled = false;
    const loadHistory = async (withLoading = false) => {
      if (withLoading) setHistoryLoading(true);
      try {
        const items = await fetchSessionHistory({ sessionId: selectedSessionId, limit: 200 });
        if (cancelled) return;
        liveAssistantIdRef.current = "";
        setLiveAssistantId("");
        setLiveTools([]);
        setIsThinking(false);
        setHistory(items);
        setHistoryError("");
      } catch (error) {
        if (cancelled) return;
        setHistoryError(error instanceof Error ? error.message : String(error));
      } finally {
        if (cancelled) return;
        if (withLoading) setHistoryLoading(false);
      }
    };

    void loadHistory(true);

    const disconnect = onWsEvent((event) => {
      dispatchGatewayWsEvent(event, {
        gatewayFrame: (frame) => {
          if (!frame || frame.type !== "event") return;
          const streamPatch = readAssistantStreamPatch(frame, selectedSessionId);
          const toolPatch = readToolStreamPatch(frame, selectedSessionId);

          if (toolPatch) {
            setIsThinking(false);
            setLiveTools((prev) => {
              const idx = prev.findIndex((entry) => entry.key === toolPatch.key);
              const appendOutput = (base: string, next: string) => {
                if (!next) return base;
                if (!base) return next;
                if (next.startsWith(base)) return next;
                if (base.endsWith(next)) return base;
                return `${base}\n${next}`;
              };
              if (idx < 0) {
                if (toolPatch.kind === "tool-start") {
                  return [
                    ...prev,
                    {
                      key: toolPatch.key,
                      toolName: toolPatch.toolName,
                      commandText: toolPatch.commandText || "-",
                      outputText: "",
                      ts: toolPatch.ts,
                    },
                  ];
                }
                return [
                  ...prev,
                  {
                    key: toolPatch.key,
                    toolName: toolPatch.toolName,
                    commandText: "-",
                    outputText: toolPatch.outputText,
                    ts: toolPatch.ts,
                  },
                ];
              }
              const next = [...prev];
              const current = next[idx];
              if (toolPatch.kind === "tool-start") {
                next[idx] = {
                  ...current,
                  toolName: toolPatch.toolName || current.toolName,
                  commandText: toolPatch.commandText || current.commandText,
                  ts: toolPatch.ts ?? current.ts,
                };
                return next;
              }
              next[idx] = {
                ...current,
                toolName: toolPatch.toolName || current.toolName,
                outputText: appendOutput(current.outputText, toolPatch.outputText),
                ts: toolPatch.ts ?? current.ts,
              };
              return next;
            });
          }

          if (!streamPatch) return;

          if (streamPatch.kind === "lifecycle-start") {
            liveAssistantIdRef.current = `live-assistant:${selectedSessionId}:${Date.now()}`;
            setLiveAssistantId(liveAssistantIdRef.current);
            return;
          }

          if (streamPatch.kind === "lifecycle-end") {
            liveAssistantIdRef.current = "";
            setLiveAssistantId("");
            setIsThinking(false);
            void loadHistory(false);
            return;
          }

          setIsThinking(false);
          const nowIso = new Date().toISOString();
          setHistory((prev) => {
            const liveId = liveAssistantIdRef.current || `live-assistant:${selectedSessionId}:${Date.now()}`;
            if (!liveAssistantIdRef.current) {
              liveAssistantIdRef.current = liveId;
              setLiveAssistantId(liveId);
            }
            const index = prev.findIndex((item) => item.id === liveId);
            if (index < 0) {
              return [
                ...prev,
                {
                  id: liveId,
                  role: "assistant",
                  text: streamPatch.text,
                  ts: nowIso,
                },
              ];
            }
            const current = prev[index];
            const nextText = mergeAssistantText(current.text, streamPatch.text);
            const next = [...prev];
            next[index] = {
              ...current,
              text: nextText,
              ts: nowIso,
            };
            return next;
          });
        },
      });
    });

    return () => {
      cancelled = true;
      disconnect();
      if (thinkingTimerRef.current) {
        clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
    };
  }, [open, activePanel, selectedSessionId, resetHistoryScrollTracking]);

  useEffect(() => {
    if (!canLoadFiles) return;
    let cancelled = false;
    setCoreFilesLoading(true);
    setCoreFilesError("");
    void fetchAgentCoreFiles(selectedAgentId)
      .then((items) => {
        if (cancelled) return;
        setCoreFiles(items);
      })
      .catch((error) => {
        if (cancelled) return;
        setCoreFilesError(error instanceof Error ? error.message : String(error));
        setCoreFiles([]);
      })
      .finally(() => {
        if (cancelled) return;
        setCoreFilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canLoadFiles, selectedAgentId]);

  useEffect(() => {
    if (coreFiles.length === 0) {
      setSelectedFileName("");
      return;
    }
    const exists = coreFiles.some((file) => file.name === selectedFileName);
    if (!exists) {
      setSelectedFileName(coreFiles[0].name);
    }
  }, [coreFiles, selectedFileName]);

  useEffect(() => {
    if (!canLoadFiles || !selectedFileName) {
      setFileContent("");
      setFileContentError("");
      return;
    }
    let cancelled = false;
    setFileContentLoading(true);
    setFileContentError("");
    void fetchAgentCoreFileContent(selectedAgentId, selectedFileName)
      .then((data) => {
        if (cancelled) return;
        setFileContent(data.content ?? "");
      })
      .catch((error) => {
        if (cancelled) return;
        setFileContent("");
        setFileContentError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (cancelled) return;
        setFileContentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canLoadFiles, selectedAgentId, selectedFileName]);

  const filePaneText = useMemo(() => {
    if (!selectedAgentId) return t("noAgentSelected");
    if (coreFilesLoading) return t("coreFilesLoading");
    if (coreFilesError) return t("coreFilesLoadFailed", { error: coreFilesError });
    if (coreFiles.length === 0) return t("noCoreFiles");
    if (!selectedFileName) return t("selectFile");
    if (fileContentLoading) return t("fileContentLoading");
    if (fileContentError) return t("fileLoadFailed", { error: fileContentError });
    return fileContent || t("fileEmpty");
  }, [
    t,
    selectedAgentId,
    coreFilesLoading,
    coreFilesError,
    coreFiles.length,
    selectedFileName,
    fileContentLoading,
    fileContentError,
    fileContent,
  ]);

  const canEditCurrentFile =
    activePanel === "files" &&
    Boolean(selectedAgentId) &&
    Boolean(selectedFileName) &&
    !fileContentLoading &&
    !fileContentError;

  const onCoreFileSaved = useCallback(
    (content: string) => {
      setFileContent(content);
      setCoreFiles((prev) =>
        prev.map((item) =>
          item.name === selectedFileName
            ? {
                ...item,
                size: content.length,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      );
    },
    [selectedFileName],
  );

  const {
    isEditingFile,
    fileEditDraft,
    setFileEditDraft,
    fileSaveError,
    isSavingFile,
    beginFileEdit,
    cancelFileEdit,
    saveFileEdit,
  } = useCoreFileEditor({
    selectedAgentId,
    selectedFileName,
    fileContent,
    canEditCurrentFile,
    onSaved: onCoreFileSaved,
  });

  const canRenderMarkdown =
    Boolean(selectedAgentId) &&
    !coreFilesLoading &&
    !coreFilesError &&
    coreFiles.length > 0 &&
    Boolean(selectedFileName) &&
    !isEditingFile &&
    !fileContentLoading &&
    !fileContentError;

  const historyStatusText = useMemo(() => {
    if (!selectedSessionId) return t("selectSession");
    if (historyLoading) return t("sessionLoading");
    if (historyError) return t("sessionLoadFailed", { error: historyError });
    if (history.length === 0) return t("noMessages");
    return "";
  }, [t, selectedSessionId, historyLoading, historyError, history.length]);

  const mergedHistory = useMemo(() => mergeHistoryEntries(history), [history]);

  const selectedFileMeta = coreFiles.find((item) => item.name === selectedFileName) ?? null;
  const updatedAtText = selectedFileMeta?.updatedAt
    ? new Date(selectedFileMeta.updatedAt).toLocaleString(undefined, { hour12: false })
    : "-";

  const toggleToolCollapsed = useCallback((key: string) => {
    setCollapsedToolMap((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? true),
    }));
  }, []);

  const toggleToolOutputCollapsed = useCallback((key: string) => {
    setCollapsedToolOutputMap((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? true),
    }));
  }, []);

  const handleVirtualStatsChange = useCallback((stats: { rendered: number; total: number }) => {
    setVirtualStats(stats);
  }, []);

  const handleSessionSubmit = (event: FormEvent) => {
    event.preventDefault();
    const message = sessionMessage.trim();
    if (!selectedSessionId || !message) return;

    setHistory((prev) => [
      ...prev,
      {
        id: `local-user:${selectedSessionId}:${Date.now()}`,
        role: "user",
        text: message,
        ts: new Date().toISOString(),
      },
    ]);
    setIsThinking(true);
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    thinkingTimerRef.current = setTimeout(() => {
      setIsThinking(false);
      thinkingTimerRef.current = null;
    }, 30000);

    onSendMessage(event);
  };

  const handleComposerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    sessionFormRef.current?.requestSubmit();
  }, []);

  return (
    <>
      <div
        className={`${modalMaskBaseClassName} ${open ? modalMaskOpenClassName : modalMaskClosedClassName}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        ref={modalRef}
        className={`${modalFrameBaseClassName} ${open ? modalFrameOpenClassName : modalFrameClosedClassName}`}
        aria-hidden={!open}
        onClick={onClose}
      >
        <div
          className={`${modalPanelBaseClassName} grid h-[min(88vh,calc(100vh-24px))] max-h-[88vh] w-[min(1320px,98vw)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0 max-[760px]:h-screen max-[760px]:max-h-screen max-[760px]:w-screen`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className={`${panelHeaderClassName} px-3 pt-3`}>
            <h2>{t("sessionTools")}</h2>
            <button
              className={drawerCloseClassName}
              type="button"
              onClick={onClose}
              aria-label={t("closeSessionModal")}
              title={t("cancel")}
            >
              <CloseIcon />
            </button>
          </div>
          <div className="m-0 grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] border-t border-[var(--line)] overflow-hidden bg-[rgba(15,23,29,0.45)] max-[760px]:grid-cols-1">
            <nav className="grid min-h-0 content-start gap-2 overflow-hidden border-r border-[var(--line)] bg-transparent p-[10px] max-[760px]:max-h-[42vh] max-[760px]:border-r-0 max-[760px]:border-b">
              <button
                type="button"
                className={`w-full border px-2 py-[7px] text-left transition-[border-color,background-color,color] ${activePanel === "session" ? "border-[var(--live)] bg-[rgba(50,215,186,0.08)] text-[var(--live)]" : "border-[var(--line)] bg-transparent text-[var(--text)] hover:border-[#2a3c4b] hover:bg-[rgba(142,163,179,0.08)]"}`}
                onClick={() => setActivePanel("session")}
              >
                {t("session")}
              </button>
              <div className="mt-1 px-0.5 py-1 text-xs text-[var(--muted)]">{t("coreFiles")}</div>
              <div className="mt-0.5 grid gap-1.5 pt-2">
                {coreFilesLoading ? <p>{t("loading")}</p> : null}
                {!coreFilesLoading && coreFiles.length === 0 ? <p>{t("noFiles")}</p> : null}
                {coreFiles.map((file) => (
                  <button
                    key={file.name}
                    type="button"
                    className={`break-all border px-2 py-1.5 text-left font-[JetBrains_Mono,monospace] text-xs transition-[border-color,background-color,color] ${
                      activePanel === "files" && selectedFileName === file.name ? "active" : ""
                    } ${activePanel === "files" && selectedFileName === file.name ? "border-[var(--live)] bg-[#0f171d] text-[var(--live)]" : "border-[var(--line)] bg-[#0f171d] text-[var(--text)] hover:border-[#2a3c4b] hover:bg-[rgba(142,163,179,0.08)]"}`}
                    onClick={() => {
                      setSelectedFileName(file.name);
                      setActivePanel("files");
                    }}
                  >
                    {file.name}
                  </button>
                ))}
              </div>
            </nav>

            <div className="h-full min-h-0 overflow-hidden bg-transparent px-0 pt-[10px] pb-3">
              {activePanel === "session" ? (
                <form
                  ref={sessionFormRef}
                  onSubmit={handleSessionSubmit}
                  className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]"
                >
                  <div className="px-3 pb-2">
                    <div className="grid gap-[10px] grid-cols-[minmax(0,1fr)_minmax(220px,34%)] max-[760px]:grid-cols-1">
                      <div className="grid gap-1.5">
                        <label className="block text-xs text-[var(--muted)]">{t("sessionId")}</label>
                        <InlineSelect
                          value={selectedSessionId}
                          options={
                            hasSessions
                              ? sessions.map((session) => ({ value: session.id, label: session.id }))
                              : [{ value: "", label: t("noSessions") }]
                          }
                          onChange={onChangeSelectedSessionId}
                          triggerClassName={controlInputMonoClassName}
                          disabled={!hasSessions}
                          ariaLabel={t("sessionId")}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <label className="block text-xs text-[var(--muted)]">{t("sendMode")}</label>
                        <InlineSelect
                          value={sendMode}
                          options={[
                            { value: "auto", label: t("auto") },
                            { value: "chat", label: t("chatOnly") },
                            { value: "sessions", label: t("sessionsOnly") },
                          ]}
                          onChange={(next) => onChangeSendMode(next as SendMode)}
                          triggerClassName={controlInputMonoClassName}
                          ariaLabel={t("sendMode")}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="relative h-full min-h-0 overflow-hidden">
                    {isDev ? (
                      <div
                        className={`${monoClassName} pointer-events-none absolute top-2 right-3 z-[3] border border-[rgba(142,163,179,0.28)] bg-[rgba(7,12,16,0.78)] px-[6px] py-[3px] text-xs leading-[1.2] text-[#9ab1c2]`}
                      >
                        rendered {virtualStats.rendered} / total {virtualStats.total}
                      </div>
                    ) : null}
                    <div
                      className="block h-full min-h-0 overflow-auto overflow-x-hidden px-3 pr-1 pb-8"
                      ref={setHistoryScrollerNode}
                      onScroll={handleHistoryScroll}
                      onWheel={markHistoryUserInteracted}
                      onTouchStart={markHistoryUserInteracted}
                      onPointerDown={markHistoryUserInteracted}
                    >
                      <ChatHistoryPanel
                        historyStatusText={historyStatusText}
                        historyViewportWidth={historyViewportWidth}
                        historyViewportHeight={historyViewportHeight}
                        historyScrollTop={historyScrollTop}
                        mergedHistory={mergedHistory}
                        liveTools={liveTools}
                        isThinking={isThinking}
                        liveAssistantId={liveAssistantId}
                        collapsedToolMap={collapsedToolMap}
                        collapsedToolOutputMap={collapsedToolOutputMap}
                        onToggleToolCollapsed={toggleToolCollapsed}
                        onToggleToolOutputCollapsed={toggleToolOutputCollapsed}
                        onVirtualStatsChange={handleVirtualStatsChange}
                      />
                    </div>
                    {!historyStatusText && showScrollToBottom ? (
                      <button
                        className="absolute bottom-3 left-1/2 z-[2] -translate-x-1/2 cursor-pointer border border-[var(--line)] bg-[rgba(15,23,29,0.92)] px-[10px] py-1 text-xs text-[var(--text)] hover:border-[var(--live)] hover:text-[var(--live)]"
                        type="button"
                        onClick={() => scrollHistoryToBottom("smooth")}
                      >
                        {t("scrollToBottom")}
                      </button>
                    ) : null}
                  </div>

                  <div className="min-w-0 px-3 pt-2">
                    <div className="relative w-full min-w-0 overflow-hidden">
                      <textarea
                        value={sessionMessage}
                        onChange={(e) => onChangeMessage(e.target.value)}
                        onKeyDown={handleComposerKeyDown}
                        rows={3}
                        placeholder={hasSessions ? t("inputPlaceholder") : t("inputPlaceholderNoSession")}
                        className={`${controlTextAreaMonoClassName} block min-h-[86px] max-h-[220px] resize-none pb-8 pr-11`}
                      />
                      <button
                        className={`${actionButtonClassName} absolute right-[10px] bottom-[10px] m-0 inline-flex h-7 w-7 min-w-7 items-center justify-center p-0`}
                        type="submit"
                        disabled={!hasSessions || !selectedSessionId}
                      >
                        <span className="absolute h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 [-webkit-clip-path:inset(50%)] [clip:rect(0,0,0,0)]">
                          {t("sendMessage")}
                        </span>
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                          <path
                            d="M4 12h12m0 0-4-4m4 4-4 4M4 5v6"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <CoreFilePanel
                  selectedAgentId={selectedAgentId}
                  selectedFileName={selectedFileName}
                  updatedAtText={updatedAtText}
                  isEditingFile={isEditingFile}
                  isSavingFile={isSavingFile}
                  fileSaveError={fileSaveError}
                  fileEditDraft={fileEditDraft}
                  onChangeDraft={setFileEditDraft}
                  onBeginEdit={beginFileEdit}
                  onCancelEdit={cancelFileEdit}
                  onSave={() => void saveFileEdit()}
                  canEditCurrentFile={canEditCurrentFile}
                  canRenderMarkdown={canRenderMarkdown}
                  filePaneText={filePaneText}
                />
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
