import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { wsRequest, onWsEvent } from "../../../shared/ws-client";
import type { WevraStreamPayload, WevraChatMessage, WevraModelInfo } from "../../../entities/wevra";
import { restoreMessages, type RawMessage, type ConvMeta } from "../model/history-restore";
import { DebugPanel } from "./DebugPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import { ModelConfigModal } from "./ModelConfigModal";
import { debugBus } from "../lib/debug-bus";
import { CloseIcon, MarkdownViewer, PlusIcon } from "../../../shared/ui";
import MessageCircleIcon from "@iconify-react/lucide/message-circle";
import MaximizeIcon from "@iconify-react/lucide/maximize";
import MinimizeIcon from "@iconify-react/lucide/minimize";
import SendIcon from "@iconify-react/lucide/send";
import StopIcon from "@iconify-react/lucide/square";
import BrainIcon from "@iconify-react/lucide/brain";
import WrenchIcon from "@iconify-react/lucide/wrench";
import ChevronRightIcon from "@iconify-react/lucide/chevron-right";
import ArrowDownIcon from "@iconify-react/lucide/arrow-down";
import {
  modalFrameBaseClassName,
  modalFrameClosedClassName,
  modalFrameOpenClassName,
  modalMaskBaseClassName,
  modalMaskClosedClassName,
  modalMaskOpenClassName,
  modalPanelBaseClassName,
} from "../../../shared/ui/surfaceClassNames";

let msgCounter = 0;
const newId = () => `wmsg-${++msgCounter}-${Date.now().toString(36)}`;

const mono = "font-[JetBrains_Mono,monospace]";
const navBtn =
  "w-full px-2.5 py-1 text-left text-xs truncate transition-colors appearance-none border-none outline-none cursor-pointer";
const activeBg = "bg-[rgba(50,215,186,0.12)] text-(--live) shadow-[inset_3px_0_0_0_var(--live)]";
const inactiveBg = "bg-transparent text-(--muted) hover:bg-[rgba(142,163,179,0.08)] hover:text-(--text)";
const sectionTitle = "px-1.5 py-1 text-[10px] font-semibold text-(--muted) uppercase tracking-wider";

// Inject busy animation keyframes once at module level
if (typeof document !== "undefined" && !document.getElementById("wevra-busy-anim")) {
  const style = document.createElement("style");
  style.id = "wevra-busy-anim";
  style.textContent =
    "@keyframes wevra-dot-pulse{0%,100%{background:rgba(142,163,179,0.25);transform:scale(1)}15%{background:rgba(50,215,186,0.7);transform:scale(1.4)}35%{background:rgba(50,215,186,0.7);transform:scale(1.4)}}@keyframes wevra-line-pulse{0%,100%{background:rgba(142,163,179,0.15)}15%{background:rgba(50,215,186,0.5)}35%{background:rgba(50,215,186,0.5)}}";
  document.head.appendChild(style);
}

function ConvBtn({
  c,
  isActive,
  busy,
  editingId,
  editTitle,
  onSelect,
  onDoubleClick,
  onRenameSubmit,
  onEditTitleChange,
  onEditCancel,
  onArchive,
  onDelete,
}: {
  c: ConvMeta;
  isActive: boolean;
  busy: boolean;
  editingId: string | null;
  editTitle: string;
  onSelect: (id: string) => void;
  onDoubleClick: (id: string, title: string) => void;
  onRenameSubmit: () => void;
  onEditTitleChange: (title: string) => void;
  onEditCancel: () => void;
  onArchive?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  if (editingId === c.id) {
    return (
      <input
        autoFocus
        className="w-full border border-(--live) bg-(--panel) px-1.5 py-1 text-xs text-(--text) outline-none"
        value={editTitle}
        onBlur={onRenameSubmit}
        onKeyDown={(e) => {
          if (e.key === "Enter") onRenameSubmit();
          if (e.key === "Escape") onEditCancel();
        }}
        onChange={(e) => onEditTitleChange(e.target.value)}
      />
    );
  }
  return (
    <div className="group relative">
      <button
        type="button"
        className={`${navBtn} ${isActive ? activeBg : inactiveBg} pr-8`}
        onClick={() => onSelect(c.id)}
        onDoubleClick={() => onDoubleClick(c.id, c.title)}
        title={c.title}
      >
        {c.title}
        {busy && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-(--live) animate-pulse align-middle" />}
      </button>
      {c.archived
        ? onDelete && (
            <button
              type="button"
              className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity border-none bg-transparent cursor-pointer p-0.5 text-[#ff6b6b] hover:text-[#ff4444]"
              title="Delete permanently"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
            >
              ✕
            </button>
          )
        : onArchive && (
            <button
              type="button"
              className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity border-none bg-transparent cursor-pointer p-0.5 text-(--muted) hover:text-(--text)"
              title="Archive"
              onClick={(e) => {
                e.stopPropagation();
                onArchive(c.id);
              }}
            >
              ⤓
            </button>
          )}
    </div>
  );
}

export function WevraChatPanel({ open: extOpen, onClose: extClose }: { open?: boolean; onClose?: () => void } = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = extOpen ?? internalOpen;
  const close = () => {
    if (extOpen !== undefined) {
      extClose?.();
    } else {
      setInternalOpen(false);
    }
  };

  const [msgs, dispatch] = useReducer(msgReducer, []);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [execMode, setExecMode] = useState<"plan" | "normal" | "auto">("normal");
  const [thinkingLevels, setThinkingLevels] = useState<string[]>([]);
  const [thinkingLevel, setThinkingLevel] = useState("high");
  const [showThinkingLevels, setShowThinkingLevels] = useState(false);
  const [models, setModels] = useState<WevraModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [busyConvs, setBusyConvs] = useState<Record<string, boolean>>({});
  const scrollBtnRef = useRef<HTMLButtonElement>(null);
  const [thinkCollapsed, setThinkCollapsed] = useState<Record<string, boolean>>({});
  const [toolCollapsed, setToolCollapsed] = useState<Record<string, boolean>>({});
  const [inputExpanded, setInputExpanded] = useState(false);
  const [contextMax, setContextMax] = useState(0);
  const [contextUsed, setContextUsed] = useState(0);
  const [showContextDetail, setShowContextDetail] = useState(false);
  const [convs, setConvs] = useState<ConvMeta[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTool, setConfirmTool] = useState<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>({ id: "", name: "", args: {} });
  const scrollRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const thinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamConvRef = useRef<string>("");
  const globalDefaultRef = useRef<string>("");
  const contextRef = useRef<HTMLDivElement>(null);
  const thinkingLevelRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showContextDetail) return;
    const onDocClick = (e: MouseEvent) => {
      if (contextRef.current && !contextRef.current.contains(e.target as Node)) {
        setShowContextDetail(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showContextDetail]);

  useEffect(() => {
    if (!showThinkingLevels) return;
    const onDocClick = (e: MouseEvent) => {
      if (thinkingLevelRef.current && !thinkingLevelRef.current.contains(e.target as Node)) {
        setShowThinkingLevels(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showThinkingLevels]);

  useEffect(() => {
    if (!showModelDropdown) return;
    const onDocClick = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showModelDropdown]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      if (scrollBtnRef.current) scrollBtnRef.current.style.display = "none";
    }
  }, [msgs]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        if (scrollBtnRef.current) {
          scrollBtnRef.current.style.display = atBottom ? "none" : "";
        }
        ticking = false;
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Load list + restore last active
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const list = (await wsRequest("wevra.conversations.list", {})) as {
          conversations?: ConvMeta[];
        };
        const all = list?.conversations ?? [];
        setConvs(all);
        const fresh = all.filter((c) => !c.archived).sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
        const pick = fresh[0] ?? all[0];
        if (pick) {
          setActiveId(pick.id);
        }
      } catch {
        /* */
      }
      try {
        const modelsRes = (await wsRequest("wevra.models", {})) as {
          models?: WevraModelInfo[];
          default?: string;
          thinkingLevels?: string[];
          thinkingLevel?: string;
        };
        if (modelsRes?.models) setModels(modelsRes.models);
        if (modelsRes?.default) {
          setDefaultModel(modelsRes.default);
          globalDefaultRef.current = modelsRes.default;
        }
        const model =
          modelsRes?.models?.find((m) => `${m.providerId}/${m.modelId}` === modelsRes?.default) ??
          modelsRes?.models?.[0];
        if (model?.contextWindow) setContextMax(model.contextWindow);
        if (modelsRes?.thinkingLevels) setThinkingLevels(modelsRes.thinkingLevels);
        // thinkingLevel is restored per-conversation in loadConv to avoid race condition
        // Auto-open model config when no models are configured
        if (!modelsRes?.models?.length) setConfigModalOpen(true);
      } catch {
        /* */
      }
      try {
        const statusRes = (await wsRequest("wevra.status", {})) as {
          activeConversations?: string[];
        };
        const active = statusRes?.activeConversations;
        if (active?.length) {
          const map: Record<string, boolean> = {};
          for (const id of active) map[id] = true;
          setBusyConvs(map);
        }
      } catch {
        /* */
      }
    })();
  }, [open]);

  const loadConv = useCallback(async (id: string) => {
    try {
      const r = (await wsRequest("wevra.conversations.view", {
        conversationId: id,
      })) as { messages?: RawMessage[]; lastPromptTokens?: number; thinkingLevel?: string; mode?: string; model?: string };
      dispatch({ type: "reset", msgs: restoreMessages(r?.messages ?? []) });
      setContextUsed(r?.lastPromptTokens ?? 0);
      if (r?.mode) setExecMode(r.mode as "plan" | "normal" | "auto");
      if (r?.thinkingLevel) setThinkingLevel(r.thinkingLevel);
      setDefaultModel(r?.model || globalDefaultRef.current || "");
    } catch {
      dispatch({ type: "reset", msgs: [] });
      setContextUsed(0);
    }
  }, []);

  // Clear messages immediately for instant feedback, then load async
  useEffect(() => {
    if (!open || !activeId) return;
    dispatch({ type: "reset", msgs: [] });
    setContextUsed(0);
    loadConv(activeId);
  }, [activeId, open]);

  // WS
  useEffect(() => {
    if (!open) return;
    const unsub = onWsEvent((ev: { type: string; method?: string; payload?: unknown }) => {
      if (ev.type !== "event") return;
      if (ev.method === "wevra.debug") {
        debugBus.emit(ev.payload as any);
        return;
      }
      if (ev.method !== "wevra.stream") return;
      const p = ev.payload as WevraStreamPayload | undefined;
      if (!p) return;
      // Handle status events for ALL conversations (not just the streaming one)
      if (p.stream === "status" && p.sessionId) {
        setBusyConvs((prev) => ({
          ...prev,
          [p.sessionId]: p.phase === "busy",
        }));
        if (p.phase === "idle" && p.sessionId === streamConvRef.current) {
          setStreaming(false);
          streamConvRef.current = "";
        }
        return;
      }
      if (p.sessionId !== streamConvRef.current) return;
      handleStream(p);
    });
    return unsub;
  }, [open, activeId]);

  const handleStream = useCallback((p: WevraStreamPayload) => {
    if (p.stream === "thinking") {
      if (p.phase === "start") {
        setStreaming(true);
        if (thinkTimer.current) clearTimeout(thinkTimer.current);
        thinkTimer.current = setTimeout(() => {
          setStreaming(false);
          thinkTimer.current = null;
        }, 30000);
        const id = newId();
        setThinkCollapsed((prev) => ({ ...prev, [id]: false }));
        dispatch({
          type: "append",
          msg: {
            id,
            role: "thinking",
            content: "",
            timestamp: Date.now(),
            isStreaming: true,
          },
        });
      } else if (p.phase === "delta" && p.content) {
        dispatch({ type: "appendContentToLast", content: p.content! });
      } else if (p.phase === "end") {
        dispatch({ type: "patchLast", patch: { isStreaming: false } });
      }
    } else if (p.stream === "assistant") {
      if (p.phase === "start") {
        if (thinkTimer.current) {
          clearTimeout(thinkTimer.current);
          thinkTimer.current = null;
        }
        setStreaming(false);
        dispatch({
          type: "append",
          msg: {
            id: newId(),
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            isStreaming: true,
          },
        });
      } else if (p.phase === "delta" && p.content) {
        dispatch({ type: "appendContentToLast", content: p.content! });
      } else if (p.phase === "end") {
        setStreaming(false);
        streamConvRef.current = "";
        dispatch({ type: "patchLast", patch: { isStreaming: false } });
      }
    } else if (p.stream === "tool") {
      if (p.phase === "start" && p.toolCall) {
        const tc = p.toolCall;
        const id = newId();
        setToolCollapsed((prev) => ({ ...prev, [id]: false }));
        const args = JSON.stringify(tc.arguments, null, 2);
        dispatch({
          type: "append",
          msg: {
            id,
            role: "tool",
            content: args,
            timestamp: Date.now(),
            toolName: tc.name,
            toolCallId: tc.id,
            isStreaming: true,
            toolArgs: args as any,
          },
        });
      } else if (p.phase === "delta" && p.toolResult) {
        dispatch({
          type: "patchByToolCallId",
          toolCallId: p.toolResult.toolCallId,
          patch: {
            content: p.toolResult!.output,
            isError: p.toolResult!.isError,
            isStreaming: false,
          },
        });
      }
    } else if (p.stream === "confirm") {
      if (p.phase === "confirm_request" && p.toolCall) {
        const tc = p.toolCall;
        setConfirmTool({ id: tc.id, name: tc.name, args: tc.arguments });
        setConfirmOpen(true);
      }
    } else if (p.stream === "meta" && p.usage) {
      setContextUsed(p.usage.promptTokens);
    }
  }, []);

  const handleConfirmDecision = useCallback(
    (decision: "allow" | "deny" | "always-allow") => {
      setConfirmOpen(false);
      wsRequest("wevra.confirm", {
        conversationId: activeId,
        toolCallId: confirmTool.id,
        decision,
      }).catch(() => {});
    },
    [activeId, confirmTool],
  );

  const abort = useCallback(() => {
    if (!activeId) return;
    wsRequest("wevra.chat.abort", { conversationId: activeId }).catch(() => {});
  }, [activeId]);

  const toggleThink = useCallback((id: string) => {
    setThinkCollapsed((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  }, []);

  const toggleTool = useCallback((id: string) => {
    setToolCollapsed((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  }, []);

  const isBusy = !!busyConvs[activeId];

  const ctxRing = useMemo(() => {
    if (contextMax <= 0) return null;
    const pct = Math.min(contextUsed / contextMax, 1);
    const pctDisplay = Math.round(pct * 100);
    const r = 7;
    const circumference = 2 * Math.PI * r;
    const offset = circumference * (1 - pct);
    const strokeColor = pct > 0.95 ? "#ff6b6b" : pct > 0.8 ? "#f5a623" : "#6b8499";
    return { pctDisplay, r, circumference, offset, strokeColor, contextUsed, contextMax };
  }, [contextUsed, contextMax]);

  const send = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const text = input.trim();
      if (!text || isBusy || !activeId) return;
      dispatch({
        type: "append",
        msg: {
          id: newId(),
          role: "user",
          content: text,
          timestamp: Date.now(),
        },
      });
      setInput("");
      streamConvRef.current = activeId;
      const [sendProv, sendMdl] = defaultModel.split("/");
      wsRequest("wevra.chat", {
        message: text,
        conversationId: activeId,
        provider: sendProv,
        model: sendMdl,
      }).catch((err: Error) => {
        streamConvRef.current = "";
        dispatch({
          type: "append",
          msg: {
            id: newId(),
            role: "assistant",
            content: `Error: ${err.message}`,
            timestamp: Date.now(),
            isError: true,
          },
        });
      });
    },
    [input, isBusy, activeId, defaultModel],
  );

  const keyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    formRef.current?.requestSubmit();
  }, []);

  const newConv = useCallback(async () => {
    try {
      const r = (await wsRequest("wevra.conversations.new", {})) as {
        conversation?: ConvMeta;
      };
      if (r?.conversation) {
        setConvs((prev) => [r.conversation!, ...prev]);
        setActiveId(r.conversation.id);
        if (globalDefaultRef.current) setDefaultModel(globalDefaultRef.current);
        dispatch({ type: "reset", msgs: [] });
        setContextUsed(0);
      }
    } catch {
      /* */
    }
  }, []);

  const selectConv = useCallback((id: string) => {
    setActiveId(id);
  }, []);
  const dblClick = useCallback((id: string, t: string) => {
    setEditingId(id);
    setEditTitle(t);
  }, []);
  const renameDone = useCallback(async () => {
    if (!editingId) return;
    await wsRequest("wevra.conversations.rename", {
      conversationId: editingId,
      title: editTitle,
    });
    setConvs((prev) => prev.map((c) => (c.id === editingId ? { ...c, title: editTitle } : c)));
    setEditingId(null);
  }, [editingId, editTitle]);

  const refreshConvs = useCallback(async () => {
    try {
      const list = (await wsRequest("wevra.conversations.list", {})) as {
        conversations?: ConvMeta[];
      };
      setConvs(list?.conversations ?? []);
    } catch {
      /* */
    }
  }, []);

  const archiveConv = useCallback(
    async (id: string) => {
      await wsRequest("wevra.conversations.archive", { conversationId: id }).catch(() => {});
      await refreshConvs();
      if (activeId === id) {
        const fresh = convs.filter((c) => !c.archived && c.id !== id);
        const next = fresh.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0))[0];
        if (next) setActiveId(next.id);
      }
    },
    [activeId, convs, refreshConvs],
  );

  const deleteConv = useCallback(
    async (id: string) => {
      await wsRequest("wevra.conversations.delete", { conversationId: id }).catch(() => {});
      await refreshConvs();
      if (activeId === id) {
        const remaining = convs.filter((c) => c.id !== id);
        const next = remaining.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0))[0];
        if (next) setActiveId(next.id);
      }
    },
    [activeId, convs, refreshConvs],
  );

  // Group by scope
  const globalConvs = convs.filter((c) => (c.scope ?? "global") === "global");
  const pipelineConvs = convs.filter((c) => (c.scope ?? "global") !== "global");
  const sort = (list: ConvMeta[]) => {
    const fresh = list.filter((c) => !c.archived).sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
    const arch = list
      .filter((c) => c.archived)
      .sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0))
      .slice(0, 5);
    return { fresh, arch };
  };
  const { fresh: gFresh, arch: gArch } = sort(globalConvs);
  const pipeNames = [...new Set(pipelineConvs.map((c) => (c.scope ?? "").replace("pipeline:", "")))];
  const pipeGroups = pipeNames.map((name) => ({
    name,
    ...sort(pipelineConvs.filter((c) => c.scope === `pipeline:${name}`)),
  }));

  return (
    <>
      {!open && (
        <button
          onClick={() => setInternalOpen(true)}
          className="fixed bottom-6 right-6 z-(--z-modal) w-14 h-14 rounded-full bg-(--live) text-white shadow-lg hover:opacity-90"
          title="Wevra"
        >
          <MessageCircleIcon width="24" height="24" />
        </button>
      )}

      <div
        className={`${modalMaskBaseClassName} ${open ? modalMaskOpenClassName : modalMaskClosedClassName}`}
        onClick={close}
        aria-hidden={!open}
      />
      <aside
        className={`${modalFrameBaseClassName} ${open ? modalFrameOpenClassName : modalFrameClosedClassName}`}
        aria-hidden={!open}
        onClick={close}
      >
        <div
          className={`${modalPanelBaseClassName} grid ${fullscreen ? "h-screen max-h-none w-screen rounded-none" : "h-[min(88vh,calc(100vh-24px))] max-h-[88vh] w-[min(1100px,98vw)]"} grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0 max-[760px]:h-screen max-[760px]:max-h-screen max-[760px]:w-screen`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-3 pt-2.5 pb-2">
            <span className="text-sm font-medium text-(--text) tracking-wide">Wevra</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowDebug((v) => !v)}
                className={`h-6 px-1.5 text-xs rounded border-none cursor-pointer transition-colors ${showDebug ? "text-(--text) bg-[rgba(142,163,179,0.1)]" : "text-(--muted) bg-transparent hover:text-(--text) hover:bg-[rgba(142,163,179,0.1)]"}`}
              >
                DEBUG
              </button>
              <button
                onClick={() => setFullscreen((v) => !v)}
                className="h-6 w-6 inline-flex items-center justify-center rounded p-0 text-(--muted) hover:text-(--text) hover:bg-[rgba(142,163,179,0.1)] bg-transparent border-none cursor-pointer transition-colors"
                title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {fullscreen ? <MinimizeIcon width="14" height="14" /> : <MaximizeIcon width="14" height="14" />}
              </button>
              <button
                className="h-6 w-6 inline-flex items-center justify-center rounded p-0 text-(--muted) hover:text-(--text) hover:bg-[rgba(142,163,179,0.1)] bg-transparent border-none cursor-pointer transition-colors"
                type="button"
                onClick={close}
                title="Close"
              >
                <CloseIcon size={16} />
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 border-t border-(--line) overflow-hidden bg-[rgba(15,23,29,0.45)]">
            {/* 侧边栏 */}
            <nav className="w-50 shrink-0 grid min-h-0 content-start overflow-hidden overflow-y-auto border-r border-(--line) bg-transparent p-0 max-[760px]:max-h-[42vh] max-[760px]:border-r-0 max-[760px]:border-b">
              <div className="flex items-center justify-between py-1">
                <div className={sectionTitle}>Global</div>
                <button
                  type="button"
                  className="inline-flex items-center justify-center appearance-none border-none outline-none bg-transparent cursor-pointer p-0 text-(--muted) hover:text-(--live) transition-colors"
                  onClick={newConv}
                  title="New conversation"
                >
                  <PlusIcon size={18} />
                </button>
              </div>
              <div className="max-h-35 overflow-y-auto">
                {gFresh.map((c) => (
                  <ConvBtn
                    key={c.id}
                    c={c}
                    isActive={c.id === activeId}
                    busy={!!busyConvs[c.id]}
                    editingId={editingId}
                    editTitle={editTitle}
                    onSelect={selectConv}
                    onDoubleClick={dblClick}
                    onRenameSubmit={renameDone}
                    onEditTitleChange={setEditTitle}
                    onEditCancel={() => setEditingId(null)}
                    onArchive={archiveConv}
                  />
                ))}
              </div>
              {gArch.length > 0 && (
                <>
                  <div className={`${sectionTitle} pt-2`}>History</div>
                  {gArch.map((c) => (
                    <ConvBtn
                      key={c.id}
                      c={c}
                      isActive={c.id === activeId}
                      busy={!!busyConvs[c.id]}
                      editingId={editingId}
                      editTitle={editTitle}
                      onSelect={selectConv}
                      onDoubleClick={dblClick}
                      onRenameSubmit={renameDone}
                      onEditTitleChange={setEditTitle}
                      onEditCancel={() => setEditingId(null)}
                      onDelete={deleteConv}
                    />
                  ))}
                </>
              )}
              {pipeGroups.map(({ name, fresh, arch }) => (
                <div key={name}>
                  <div className={`${sectionTitle} pt-3`}>{name}</div>
                  {fresh.map((c) => (
                    <ConvBtn
                      key={c.id}
                      c={c}
                      isActive={c.id === activeId}
                      busy={!!busyConvs[c.id]}
                      editingId={editingId}
                      editTitle={editTitle}
                      onSelect={selectConv}
                      onDoubleClick={dblClick}
                      onRenameSubmit={renameDone}
                      onEditTitleChange={setEditTitle}
                      onEditCancel={() => setEditingId(null)}
                      onArchive={archiveConv}
                    />
                  ))}
                  {arch.length > 0 && (
                    <>
                      <div className={`${sectionTitle}`}>History</div>
                      {arch.map((c) => (
                        <ConvBtn
                          key={c.id}
                          c={c}
                          isActive={c.id === activeId}
                          busy={!!busyConvs[c.id]}
                          editingId={editingId}
                          editTitle={editTitle}
                          onSelect={selectConv}
                          onDoubleClick={dblClick}
                          onRenameSubmit={renameDone}
                          onEditTitleChange={setEditTitle}
                          onEditCancel={() => setEditingId(null)}
                          onDelete={deleteConv}
                        />
                      ))}
                    </>
                  )}
                </div>
              ))}
            </nav>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="relative flex-1 min-h-0">
                <div ref={scrollRef} className="absolute inset-0 overflow-auto overflow-x-hidden px-3 pb-8 pt-2.5">
                  {msgs.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-(--muted) pointer-events-none">
                      <p className="text-lg font-medium">Wevra</p>
                      <p className="text-sm mt-1">TaskMeld Built-in AI Assistant</p>
                    </div>
                  )}
                  <div className="grid gap-2.5">
                    {msgs.map((m) => (
                      <Bubble
                        key={m.id}
                        message={m}
                        id={m.id}
                        isThinking={!!(streaming && m.isStreaming && m.role === "thinking")}
                        thinkCollapsed={thinkCollapsed[m.id] ?? true}
                        toolCollapsed={toolCollapsed[m.id] ?? true}
                        onToggleThink={toggleThink}
                        onToggleTool={toggleTool}
                      />
                    ))}
                  </div>
                </div>
                <button
                  ref={scrollBtnRef}
                  type="button"
                  className="absolute bottom-2 right-3 z-10 h-6 w-6 rounded border border-(--line) bg-[#141c24] shadow-md inline-flex items-center justify-center p-0 cursor-pointer text-[rgba(142,163,179,0.4)] hover:text-(--muted) hover:border-[rgba(50,215,186,0.3)] transition-colors"
                  style={{ display: "none" }}
                  onClick={() =>
                    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
                  }
                  title="Scroll to bottom"
                >
                  <ArrowDownIcon width="15" height="15" />
                </button>
                {isBusy && (
                  <div className="absolute -bottom-2 left-3 z-10 h-6 w-24 flex items-center gap-0 pointer-events-none">
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((i) => {
                      const isDot = i % 2 === 0;
                      const delay = i * 0.107;
                      return (
                        <span
                          key={i}
                          className={`block shrink-0 ${isDot ? "h-1.5 w-1.5" : "h-0.5 flex-1"}`}
                          style={{
                            animation: `${isDot ? "wevra-dot-pulse" : "wevra-line-pulse"} 1.6s ${delay}s infinite`,
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
              <form ref={formRef} onSubmit={send}>
                <div className="min-w-0 px-3 pb-3 pt-2">
                  <div
                    className={`group relative w-full min-w-0 rounded border bg-[#141c24] transition-[box-shadow,border-color] ${
                      isBusy
                        ? "border-[rgba(50,215,186,0.45)] shadow-[0_0_10px_rgba(50,215,186,0.18)]"
                        : "border-[rgba(34,50,63,0.5)] shadow-[0_0_6px_rgba(50,215,186,0.08)] focus-within:border-[rgba(50,215,186,0.45)] focus-within:shadow-[0_0_10px_rgba(50,215,186,0.18)]"
                    }`}
                  >
                    <button
                      type="button"
                      className="absolute top-0 right-0 z-10 h-3.5 w-3.5 bg-transparent border-none cursor-pointer p-0"
                      onClick={() => setInputExpanded((v) => !v)}
                      title={inputExpanded ? "Collapse" : "Expand"}
                    >
                      <span
                        className={`block w-2 h-2 absolute top-0.5 right-0.5 border-t-2 border-r-2 rounded-tr-sm opacity-40 hover:opacity-80 transition-opacity ${inputExpanded ? "border-(--live)" : "border-(--muted)"}`}
                      />
                    </button>
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={keyDown}
                      rows={inputExpanded ? 10 : 3}
                      placeholder="Type a message..."
                      className={`block w-full resize-none border-0 bg-transparent px-2 py-2 text-sm text-(--text) outline-none placeholder:text-[rgba(142,163,179,0.35)] scrollbar-none [&::-webkit-scrollbar]:hidden ${inputExpanded ? "min-h-40 max-h-[50vh]" : "min-h-16 max-h-55"}`}
                      disabled={streaming}
                    />
                    <div className="flex items-center justify-between px-2 pb-1">
                      <div className="flex items-center">
                        <button
                          type="button"
                          className={`h-6 px-1 text-sm rounded cursor-pointer transition-colors ${
                            execMode === "plan"
                              ? "text-(--live)"
                              : execMode === "auto"
                                ? "text-[#f5a623]"
                                : "text-(--muted)"
                          } hover:bg-[rgba(142,163,179,0.1)] bg-transparent border-none`}
                          onClick={async () => {
                            const modes: Array<"plan" | "normal" | "auto"> = ["plan", "normal", "auto"];
                            const next = modes[(modes.indexOf(execMode) + 1) % 3];
                            setExecMode(next);
                            if (activeId) {
                              await wsRequest("wevra.tool-preferences.set-mode", {
                                conversationId: activeId,
                                mode: next,
                              });
                            }
                          }}
                          title={`Mode: ${execMode} (click to cycle)`}
                        >
                          {execMode}
                        </button>
                        {models.some((m) => m.enabled !== false) ? (
                          <div ref={modelRef} className="relative flex items-center">
                            <span className="mx-1 h-3.5 w-px bg-[rgba(142,163,179,0.2)]" />
                            <button
                              type="button"
                              className="h-6 px-1 text-sm rounded cursor-pointer transition-colors border-none bg-transparent text-(--muted) hover:bg-[rgba(142,163,179,0.1)] truncate max-w-[160px]"
                              onClick={() => setShowModelDropdown((v) => !v)}
                              title={defaultModel || "Select model"}
                            >
                              {defaultModel ? defaultModel.split("/").pop() : "model"}
                            </button>
                            {showModelDropdown && (
                              <div className="absolute bottom-full left-0 mb-2 w-max max-w-[280px] rounded border border-(--line) bg-[#141c24] py-0.5 shadow-lg z-50">
                                {models.filter((m) => m.enabled !== false).map((m) => {
                                  const key = `${m.providerId}/${m.modelId}`;
                                  return (
                                    <button
                                      key={key}
                                      type="button"
                                      className={`block w-full px-3 py-1 text-left text-xs border-none cursor-pointer transition-colors truncate ${
                                        key === defaultModel
                                          ? "bg-[rgba(50,215,186,0.12)] text-(--live)"
                                          : "text-(--muted) bg-transparent hover:bg-[rgba(142,163,179,0.08)] hover:text-(--text)"
                                      }`}
                                      onClick={async () => {
                                        setDefaultModel(key);
                                        if (m.contextWindow) setContextMax(m.contextWindow);
                                        setShowModelDropdown(false);
                                        if (activeId) {
                                          await wsRequest("wevra.models.set-conversation-model", {
                                            conversationId: activeId,
                                            providerId: m.providerId,
                                            modelId: m.modelId,
                                          }).catch(() => {});
                                        }
                                        await wsRequest("wevra.models.set-default", {
                                          providerId: m.providerId,
                                          modelId: m.modelId,
                                        }).catch(() => {});
                                      }}
                                    >
                                      {m.label || m.modelId}
                                    </button>
                                  );
                                })}
                                <div className="border-t border-(--line) my-0.5" />
                                <button
                                  type="button"
                                  className="block w-full px-3 py-1 text-left text-xs border-none cursor-pointer text-(--live) bg-transparent hover:bg-[rgba(50,215,186,0.08)]"
                                  onClick={() => {
                                    setShowModelDropdown(false);
                                    setConfigModalOpen(true);
                                  }}
                                >
                                  + Add model
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center">
                            <span className="mx-1 h-3.5 w-px bg-[rgba(142,163,179,0.2)]" />
                            <button
                              type="button"
                              className="h-6 px-1 text-sm rounded cursor-pointer transition-colors border-none bg-transparent text-(--live) hover:bg-[rgba(50,215,186,0.08)]"
                              onClick={() => setConfigModalOpen(true)}
                              title="Add a model to get started"
                            >
                              + Add model
                            </button>
                          </div>
                        )}
                        {thinkingLevels.length > 0 && (
                          <div ref={thinkingLevelRef} className="relative flex items-center">
                            <span className="mx-1 h-3.5 w-px bg-[rgba(142,163,179,0.2)]" />
                            <button
                              type="button"
                              className={`h-6 px-1 text-sm rounded cursor-pointer transition-colors border-none bg-transparent ${
                                thinkingLevel === "off"
                                  ? "text-[#6b8499]"
                                  : thinkingLevel === "max"
                                    ? "text-(--live)"
                                    : "text-(--muted)"
                              } hover:bg-[rgba(142,163,179,0.1)]`}
                              onClick={() => setShowThinkingLevels((v) => !v)}
                              title={`Thinking: ${thinkingLevel}`}
                            >
                              {thinkingLevel}
                            </button>
                            {showThinkingLevels && (
                              <div className="absolute bottom-full left-0 mb-2 w-max rounded border border-(--line) bg-[#141c24] py-0.5 shadow-lg z-50">
                                {thinkingLevels.map((lv) => (
                                  <button
                                    key={lv}
                                    type="button"
                                    className={`block w-full px-3 py-1 text-left text-xs border-none cursor-pointer transition-colors ${
                                      lv === thinkingLevel
                                        ? "bg-[rgba(50,215,186,0.12)] text-(--live)"
                                        : lv === "off"
                                          ? "text-[#6b8499] bg-transparent hover:bg-[rgba(142,163,179,0.08)]"
                                          : lv === "max"
                                            ? "text-(--text) bg-transparent hover:bg-[rgba(142,163,179,0.08)]"
                                            : "text-(--muted) bg-transparent hover:bg-[rgba(142,163,179,0.08)] hover:text-(--text)"
                                    }`}
                                    onClick={async () => {
                                      setThinkingLevel(lv);
                                      setShowThinkingLevels(false);
                                      if (activeId) {
                                        await wsRequest("wevra.models.set-thinking-level", {
                                          level: lv,
                                          conversationId: activeId,
                                        }).catch(() => {});
                                      }
                                    }}
                                  >
                                    {lv}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {ctxRing && (
                          <div ref={contextRef} className="relative">
                            <button
                              type="button"
                              className="relative border-none bg-transparent cursor-pointer p-0 flex items-center justify-center"
                              onClick={() => setShowContextDetail((v) => !v)}
                              title={`${ctxRing.contextUsed.toLocaleString()} / ${ctxRing.contextMax.toLocaleString()} tokens (${ctxRing.pctDisplay}%)`}
                            >
                              <svg width="22" height="22" viewBox="0 0 22 22" className="block">
                                <circle
                                  cx="11"
                                  cy="11"
                                  r={ctxRing.r}
                                  fill="none"
                                  stroke="rgba(142,163,179,0.15)"
                                  strokeWidth="2"
                                />
                                <circle
                                  cx="11"
                                  cy="11"
                                  r={ctxRing.r}
                                  fill="none"
                                  stroke={ctxRing.strokeColor}
                                  strokeWidth="2"
                                  strokeDasharray={ctxRing.circumference}
                                  strokeDashoffset={ctxRing.offset}
                                  strokeLinecap="round"
                                  transform="rotate(-90 11 11)"
                                  className="transition-[stroke-dashoffset,stroke] duration-300"
                                />
                              </svg>
                            </button>
                            {showContextDetail && (
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max rounded border border-(--line) bg-[#141c24] px-2.5 py-1.5 shadow-lg z-50">
                                <div className="text-[11px] text-(--text) font-medium text-center">
                                  <span className="text-(--muted) font-normal">Already used: </span>
                                  {ctxRing.pctDisplay}%
                                </div>
                                <div className="text-[10px] text-(--muted) text-center mt-0.5 whitespace-nowrap">
                                  {ctxRing.contextUsed >= 1000000
                                    ? `${(ctxRing.contextUsed / 1000000).toFixed(0)}m`
                                    : `${(ctxRing.contextUsed / 1000).toFixed(0)}k`}{" "}
                                  /{" "}
                                  {ctxRing.contextMax >= 1000000
                                    ? `${(ctxRing.contextMax / 1000000).toFixed(0)}m`
                                    : `${(ctxRing.contextMax / 1000).toFixed(0)}k`}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {isBusy ? (
                          <button
                            className="h-6 inline-flex items-center justify-center gap-1 border-none px-2 text-sm rounded cursor-pointer transition-colors text-white bg-[#e05555] hover:bg-[#ff6b6b]"
                            type="button"
                            onClick={abort}
                          >
                            <StopIcon width="12" height="12" />
                            Stop
                          </button>
                        ) : (
                          <button
                            className={`h-6 inline-flex items-center justify-center gap-1 border-none px-2 text-sm transition-colors ${
                              !input.trim()
                                ? "text-[#3a4a58] bg-transparent cursor-default rounded"
                                : "text-white bg-[#3ac5a0] cursor-pointer hover:bg-(--live) rounded"
                            }`}
                            type="submit"
                            disabled={!input.trim()}
                          >
                            <SendIcon width="14" height="14" />
                            Send
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </form>
            </div>
            {showDebug && <DebugPanel onClose={() => setShowDebug(false)} />}
          </div>
        </div>
      </aside>
      <ConfirmDialog
        open={confirmOpen}
        toolName={confirmTool.name}
        toolArgs={confirmTool.args}
        onDecision={handleConfirmDecision}
      />
      <ModelConfigModal
        open={configModalOpen}
        onClose={() => setConfigModalOpen(false)}
        onConfigUpdate={(c) => {
          setModels(c.models);
          if (c.default) {
            setDefaultModel(c.default);
            globalDefaultRef.current = c.default;
          }
          if (c.thinkingLevels) setThinkingLevels(c.thinkingLevels);
          // Auto-save model to active conversation when first configured (conversation has no model yet)
          if (c.default && activeId && !defaultModel) {
            const [p, m] = c.default.split("/");
            if (p && m) {
              wsRequest("wevra.models.set-conversation-model", {
                conversationId: activeId,
                providerId: p,
                modelId: m,
              }).catch(() => {});
            }
          }
        }}
      />
    </>
  );
}

// ── Bubble Components ──

const Bubble = memo(function Bubble({
  message: m,
  id,
  isThinking,
  thinkCollapsed,
  toolCollapsed,
  onToggleThink,
  onToggleTool,
}: {
  message: WevraChatMessage;
  id: string;
  isThinking: boolean;
  thinkCollapsed: boolean;
  toolCollapsed: boolean;
  onToggleThink: (id: string) => void;
  onToggleTool: (id: string) => void;
}) {
  if (m.role === "user") return <UserBubble message={m} />;
  if (m.role === "thinking")
    return (
      <ThinkBubble message={m} isThinking={isThinking} collapsed={thinkCollapsed} onToggle={() => onToggleThink(id)} />
    );
  if (m.role === "tool") return <ToolBubble message={m} collapsed={toolCollapsed} onToggle={() => onToggleTool(id)} />;
  return <AsstBubble message={m} />;
});

function UserBubble({ message: m }: { message: WevraChatMessage }) {
  return (
    <article className="justify-self-end border-[rgba(50,215,186,0.15)] bg-[rgba(50,215,186,0.08)] min-w-0 max-w-full w-[min(92%,780px)] border px-2.5 py-2">
      <header className="mb-1.5 flex items-center justify-between gap-2.5 text-xs text-(--muted)">
        <span>user</span>
        <span>{ts(m.timestamp)}</span>
      </header>
      <p className="m-0 whitespace-pre-wrap wrap-break-word text-[13px] leading-[1.45] text-(--text)">{m.content}</p>
    </article>
  );
}
function ThinkBubble({
  message: m,
  isThinking,
  collapsed,
  onToggle,
}: {
  message: WevraChatMessage;
  isThinking: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (!m.content && !isThinking) return null;
  return (
    <article className="w-[min(92%,780px)] max-w-full min-w-0 justify-self-start">
      <button
        className="flex w-full items-center gap-2.5 bg-transparent px-0 py-1.5 text-left text-xs text-(--muted) hover:text-(--text) cursor-pointer transition-colors"
        type="button"
        onClick={onToggle}
      >
        <span className="inline-flex items-center gap-1">
          <BrainIcon width="14" height="14" /> {isThinking ? "Thinking..." : "Thinking"}
        </span>
      </button>
      {!collapsed && m.content && (
        <div
          className={`${mono} max-h-55 overflow-auto px-0 py-1 text-[12.5px] leading-[1.45] whitespace-pre-wrap wrap-break-word text-(--muted)`}
        >
          {m.content}
        </div>
      )}
    </article>
  );
}
function ToolBubble({
  message: m,
  collapsed,
  onToggle,
}: {
  message: WevraChatMessage;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <article
      className={`${collapsed ? "w-fit min-w-45 max-w-[min(72%,640px)]" : "w-[min(92%,780px)]"} max-w-full min-w-0 justify-self-start border border-[rgba(142,163,179,0.14)] bg-[rgba(255,255,255,0.01)]`}
    >
      <button
        className="flex w-full items-center justify-between gap-2.5 border-0 border-b border-[rgba(142,163,179,0.12)] bg-transparent px-2.5 py-2 text-left text-xs text-[#93a6b5] hover:bg-[rgba(142,163,179,0.04)]"
        type="button"
        onClick={onToggle}
      >
        <span className="inline-flex items-center gap-1">
          <WrenchIcon width="14" height="14" /> tool {m.toolName}
        </span>
        <Chevron rotated={!collapsed} />
      </button>
      {!collapsed && (
        <>
          {m.toolArgs && (
            <div
              className={`${mono} max-h-55 overflow-auto border-b border-[rgba(142,163,179,0.12)] bg-[rgba(7,12,16,0.5)] px-2.5 py-2 text-[12.5px] leading-[1.45] whitespace-pre-wrap wrap-break-word text-[#d1dbe3]`}
            >
              {m.toolArgs}
            </div>
          )}
          {m.content && (
            <div className={`${mono} max-h-65 overflow-auto bg-[rgba(7,12,16,0.5)] px-2.5 py-2`}>
              <p
                className={`m-0 whitespace-pre-wrap wrap-break-word text-[12.5px] leading-[1.45] ${m.isError ? "text-(--bad)" : "text-[#b4c3cf]"}`}
              >
                {m.content || "..."}
              </p>
            </div>
          )}
        </>
      )}
    </article>
  );
}
function AsstBubble({ message: m }: { message: WevraChatMessage }) {
  return (
    <article className="justify-self-start border-(--line) min-w-0 max-w-full w-[min(92%,780px)] border bg-[#0f171d] px-2.5 py-2">
      <header className="mb-1.5 flex items-center justify-between gap-2.5 text-xs text-(--muted)">
        <span>assistant</span>
        <span>{ts(m.timestamp)}</span>
      </header>
      {m.content ? (
        <div className="min-w-0 max-w-full overflow-hidden">
          <MarkdownViewer content={m.content} />
        </div>
      ) : m.isStreaming ? (
        <p className="m-0 whitespace-pre-wrap wrap-break-word text-[13px] leading-[1.45] text-(--text)">
          <span
            className="ml-0.5 inline-block h-[1em] w-1.5 animate-pulse align-[-0.12em] bg-(--live)"
            aria-hidden="true"
          />
        </p>
      ) : null}
    </article>
  );
}
function Chevron({ rotated }: { rotated: boolean }) {
  return (
    <span className="inline-flex items-center justify-center leading-none text-[#7890a1]" aria-hidden="true">
      <ChevronRightIcon width="12" height="12" className={rotated ? "rotate-90" : ""} />
    </span>
  );
}
function ts(t: number) {
  return new Date(t).toLocaleString(undefined, { hour12: false });
}

// ── Message list reducer (avoids spreading the entire array on every delta) ──

type MsgAction =
  | { type: "append"; msg: WevraChatMessage }
  | { type: "patchLast"; patch: Partial<WevraChatMessage> }
  | {
      type: "patchByToolCallId";
      toolCallId: string | undefined;
      patch: Partial<WevraChatMessage>;
    }
  | { type: "appendContentToLast"; content: string }
  | { type: "reset"; msgs: WevraChatMessage[] };

function msgReducer(state: WevraChatMessage[], action: MsgAction): WevraChatMessage[] {
  switch (action.type) {
    case "append":
      return [...state, action.msg];
    case "patchLast": {
      if (state.length === 0) return state;
      const last = state[state.length - 1];
      return [...state.slice(0, -1), { ...last, ...action.patch }];
    }
    case "patchByToolCallId": {
      if (!action.toolCallId) {
        // fallback to patchLast if no toolCallId
        if (state.length === 0) return state;
        const last = state[state.length - 1];
        return [...state.slice(0, -1), { ...last, ...action.patch }];
      }
      const idx = state.findIndex((m) => m.toolCallId === action.toolCallId);
      if (idx < 0) return state;
      const updated = { ...state[idx], ...action.patch };
      return [...state.slice(0, idx), updated, ...state.slice(idx + 1)];
    }
    case "appendContentToLast": {
      if (state.length === 0) return state;
      const last = state[state.length - 1];
      return [...state.slice(0, -1), { ...last, content: last.content + action.content }];
    }
    case "reset":
      return action.msgs;
    default:
      return state;
  }
}
