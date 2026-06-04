import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { wsRequest, onWsEvent } from "../../../shared/ws-client";
import type { WevraStreamPayload, WevraChatMessage } from "../../../entities/wevra";
import { restoreMessages, type RawMessage, type ConvMeta } from "../model/history-restore";
import { DebugPanel } from "./DebugPanel";
import { debugBus } from "../lib/debug-bus";
import { CloseIcon, MarkdownViewer } from "../../../shared/ui";
import { panelHeaderClassName } from "../../../shared/ui/panelClasses";
import {
  controlTextAreaMonoClassName, drawerCloseClassName,
  modalFrameBaseClassName, modalFrameClosedClassName, modalFrameOpenClassName,
  modalMaskBaseClassName, modalMaskClosedClassName, modalMaskOpenClassName,
  modalPanelBaseClassName,
} from "../../../shared/ui/surfaceClassNames";

let msgCounter = 0;
const newId = () => `wmsg-${++msgCounter}-${Date.now().toString(36)}`;

const mono = "font-[JetBrains_Mono,monospace]";
const sendBtn = "cursor-pointer border border-[var(--live-25)] bg-transparent px-[10px] py-2 font-semibold text-[var(--live)] hover:bg-[rgba(50,215,186,0.1)]";
const navBtn = "w-full px-1.5 py-1 text-left text-xs truncate transition-colors appearance-none border-none outline-none cursor-pointer font-[inherit]";
const activeBg = "bg-[rgba(50,215,186,0.12)] text-(--live) shadow-[inset_3px_0_0_0_var(--live)]";
const inactiveBg = "bg-transparent text-(--muted) hover:bg-[rgba(142,163,179,0.08)] hover:text-(--text)";
const sectionTitle = "px-1.5 py-1 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider";

function ConvBtn({c, isActive, editingId, editTitle, onSelect, onDoubleClick, onRenameSubmit, onEditTitleChange, onEditCancel}: {
  c: ConvMeta; isActive: boolean; editingId: string | null; editTitle: string;
  onSelect: (id: string) => void; onDoubleClick: (id: string, title: string) => void;
  onRenameSubmit: () => void; onEditTitleChange: (title: string) => void; onEditCancel: () => void;
}) {
  return editingId === c.id ? (
    <input autoFocus className="w-full border border-[var(--live)] bg-(--panel) px-1.5 py-1 text-xs text-(--text) outline-none"
      value={editTitle} onBlur={onRenameSubmit} onKeyDown={e => {if(e.key==='Enter')onRenameSubmit();if(e.key==='Escape')onEditCancel();}}
      onChange={e => onEditTitleChange(e.target.value)} />
  ) : (
    <button type="button" className={`${navBtn} ${isActive ? activeBg : inactiveBg}`}
      onClick={() => onSelect(c.id)} onDoubleClick={() => onDoubleClick(c.id, c.title)} title={c.title}>
      {c.title}
    </button>
  );
}

export function WevraChatPanel({ open: extOpen, onClose: extClose }: { open?: boolean; onClose?: () => void } = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = extOpen ?? internalOpen;
  const close = () => { if (extOpen !== undefined) { extClose?.(); } else { setInternalOpen(false); } };

  const [msgs, dispatch] = useReducer(msgReducer, []);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [convId, setConvId] = useState<string>("");
  const [showDebug, setShowDebug] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [thinkCollapsed, setThinkCollapsed] = useState<Record<string, boolean>>({});
  const [toolCollapsed, setToolCollapsed] = useState<Record<string, boolean>>({});
  const [convs, setConvs] = useState<ConvMeta[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const thinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamConvRef = useRef<string>("");

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs]);

  // 加载列表 + 恢复最后活跃
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const list = await wsRequest("wevra.conversations.list", {}) as { conversations?: ConvMeta[] };
        const all = list?.conversations ?? [];
        setConvs(all);
        const fresh = all.filter(c => !c.archived).sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
        const pick = fresh[0] ?? all[0];
        if (pick) { setActiveId(pick.id); await loadConv(pick.id); }
      } catch { /* */ }
    })();
  }, [open]);

  const loadConv = useCallback(async (id: string) => {
    try {
      const r = await wsRequest("wevra.conversations.view", { conversationId: id }) as { messages?: RawMessage[] };
      dispatch({ type: 'reset', msgs: restoreMessages(r?.messages ?? []) });
      setConvId(id);
    } catch { dispatch({ type: 'reset', msgs: [] }); }
  }, []);

  // WS
  useEffect(() => {
    if (!open) return;
    const unsub = onWsEvent((ev: { type: string; method?: string; payload?: unknown }) => {
      if (ev.type !== "event") return;
      if (ev.method === "wevra.debug") { debugBus.emit(ev.payload as any); return; }
      if (ev.method !== "wevra.stream") return;
      const p = ev.payload as WevraStreamPayload | undefined;
      if (!p || p.sessionId !== streamConvRef.current) return;
      handleStream(p);
    });
    return unsub;
  }, [open, activeId]);

  const handleStream = useCallback((p: WevraStreamPayload) => {
    if (p.stream === "thinking") {
      if (p.phase === "start") {
        setStreaming(true);
        if (thinkTimer.current) clearTimeout(thinkTimer.current);
        thinkTimer.current = setTimeout(() => { setStreaming(false); thinkTimer.current = null; }, 30000);
        const id = newId();
        setThinkCollapsed(prev => ({ ...prev, [id]: false }));
        dispatch({ type: 'append', msg: { id, role:"thinking", content:"", timestamp:Date.now(), isStreaming:true } });
      } else if (p.phase === "delta" && p.content) {
        dispatch({ type: 'appendContentToLast', content: p.content! });
      } else if (p.phase === "end") {
        dispatch({ type: 'patchLast', patch: { isStreaming: false } });
      }
    } else if (p.stream === "assistant") {
      if (p.phase === "start") {
        if (thinkTimer.current) { clearTimeout(thinkTimer.current); thinkTimer.current = null; }
        setStreaming(false);
        dispatch({ type: 'append', msg: { id:newId(), role:"assistant", content:"", timestamp:Date.now(), isStreaming:true } });
      } else if (p.phase === "delta" && p.content) {
        dispatch({ type: 'appendContentToLast', content: p.content! });
      } else if (p.phase === "end") {
        setStreaming(false);
        streamConvRef.current = "";
        dispatch({ type: 'patchLast', patch: { isStreaming: false } });
      }
    } else if (p.stream === "tool") {
      if (p.phase === "start" && p.toolCall) {
        const tc = p.toolCall;
        const id = newId();
        setToolCollapsed(prev => ({ ...prev, [id]: false }));
        const args = JSON.stringify(tc.arguments, null, 2);
        dispatch({ type: 'append', msg: { id, role:"tool", content:args, timestamp:Date.now(), toolName:tc.name, toolCallId: tc.id, isStreaming:true, toolArgs:args as any } });
      } else if (p.phase === "delta" && p.toolResult) {
        dispatch({ type: 'patchByToolCallId', toolCallId: p.toolResult.toolCallId, patch: { content: p.toolResult!.output, isError: p.toolResult!.isError, isStreaming: false } });
      }
    }
  }, []);

  const send = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || streaming || !activeId) return;
    dispatch({ type: 'append', msg: { id:newId(), role:"user", content:text, timestamp:Date.now() } });
    setInput("");
    streamConvRef.current = activeId;
    wsRequest("wevra.chat", { message:text, conversationId:activeId }).catch((err:Error) => {
      streamConvRef.current = "";
      dispatch({ type: 'append', msg: { id:newId(), role:"assistant", content:`Error: ${err.message}`, timestamp:Date.now(), isError:true } });
    });
  }, [input, streaming, activeId]);

  const keyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault(); formRef.current?.requestSubmit();
  }, []);

  const newConv = useCallback(async () => {
    try {
      const r = await wsRequest("wevra.conversations.new", {}) as { conversation?: ConvMeta };
      if (r?.conversation) {
        setConvs(prev => [r.conversation!, ...prev]);
        setActiveId(r.conversation.id); dispatch({ type: 'reset', msgs: [] }); setConvId(r.conversation.id);
      }
    } catch { /* */ }
  }, []);

  const selectConv = useCallback(async (id: string) => { setActiveId(id); await loadConv(id); }, [loadConv]);
  const dblClick = useCallback((id: string, t: string) => { setEditingId(id); setEditTitle(t); }, []);
  const renameDone = useCallback(async () => {
    if (!editingId) return;
    await wsRequest("wevra.conversations.rename", { conversationId: editingId, title: editTitle });
    setConvs(prev => prev.map(c => c.id === editingId ? {...c, title:editTitle} : c));
    setEditingId(null);
  }, [editingId, editTitle]);

  // 分组
  const globalConvs = convs.filter(c => (c.scope ?? 'global') === 'global');
  const pipelineConvs = convs.filter(c => (c.scope ?? 'global') !== 'global');
  const sort = (list: ConvMeta[]) => {
    const fresh = list.filter(c => !c.archived).sort((a,b) => (b.lastActiveAt??0)-(a.lastActiveAt??0));
    const arch = list.filter(c => c.archived).sort((a,b) => (b.lastActiveAt??0)-(a.lastActiveAt??0)).slice(0,5);
    return {fresh, arch};
  };
  const {fresh:gFresh, arch:gArch} = sort(globalConvs);
  const pipeNames = [...new Set(pipelineConvs.map(c => (c.scope??'').replace('pipeline:','')))];
  const pipeGroups = pipeNames.map(name => ({name, ...sort(pipelineConvs.filter(c => c.scope===`pipeline:${name}`))}));

  return (
    <>
      {!open && (
        <button onClick={() => setInternalOpen(true)}
          className="fixed bottom-6 right-6 z-[var(--z-modal)] w-14 h-14 rounded-full bg-(--live) text-white shadow-lg hover:opacity-90" title="Wevra">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      <div className={`${modalMaskBaseClassName} ${open?modalMaskOpenClassName:modalMaskClosedClassName}`} onClick={close} aria-hidden={!open} />
      <aside className={`${modalFrameBaseClassName} ${open?modalFrameOpenClassName:modalFrameClosedClassName}`} aria-hidden={!open} onClick={close}>
        <div className={`${modalPanelBaseClassName} grid ${fullscreen ? "h-screen max-h-none w-screen rounded-none" : "h-[min(88vh,calc(100vh-24px))] max-h-[88vh] w-[min(1100px,98vw)]"} grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0 max-[760px]:h-screen max-[760px]:max-h-screen max-[760px]:w-screen`} onClick={e => e.stopPropagation()}>
          <div className={`${panelHeaderClassName} px-3 pt-3`}>
            <h2>Wevra</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowDebug(v => !v)} className="text-[10px] font-mono px-2 py-1 rounded border border-(--line) bg-(--panel) text-(--muted) hover:text-(--live) hover:border-(--live)">{showDebug ? "✕ DEBUG" : "DEBUG"}</button>
              <button onClick={() => setFullscreen(v => !v)}
                className="text-[10px] font-mono px-2 py-1 rounded border border-(--line) bg-(--panel) text-(--muted) hover:text-(--live) hover:border-(--live)"
                title={fullscreen ? "退出全屏" : "全屏"}>
                {fullscreen ? "⊠" : "⛶"}
              </button>
              <button className={drawerCloseClassName} type="button" onClick={close} title="关闭"><CloseIcon /></button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 border-t border-[var(--line)] overflow-hidden bg-[rgba(15,23,29,0.45)]">
            {/* 侧边栏 */}
            <nav className="w-[200px] shrink-0 grid min-h-0 content-start gap-0.5 overflow-hidden overflow-y-auto border-r border-[var(--line)] bg-transparent p-0 max-[760px]:max-h-[42vh] max-[760px]:border-r-0 max-[760px]:border-b">
              <div className="flex items-center justify-between py-1">
                <div className={sectionTitle}>Global</div>
                <button type="button" className="appearance-none border-none outline-none bg-transparent cursor-pointer p-0 text-[var(--muted)] hover:text-[var(--live)] transition-colors" onClick={newConv} title="新建对话">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                </button>
              </div>
              {gFresh.map(c => <ConvBtn key={c.id} c={c} isActive={c.id === activeId} editingId={editingId} editTitle={editTitle} onSelect={selectConv} onDoubleClick={dblClick} onRenameSubmit={renameDone} onEditTitleChange={setEditTitle} onEditCancel={() => setEditingId(null)} />)}
              {gArch.length > 0 && <><div className={`${sectionTitle} pt-2`}>历史</div>{gArch.map(c => <ConvBtn key={c.id} c={c} isActive={c.id === activeId} editingId={editingId} editTitle={editTitle} onSelect={selectConv} onDoubleClick={dblClick} onRenameSubmit={renameDone} onEditTitleChange={setEditTitle} onEditCancel={() => setEditingId(null)} />)}</>}
              {pipeGroups.map(({name, fresh, arch}) => (
                <div key={name}>
                  <div className={`${sectionTitle} pt-3`}>{name}</div>
                  {fresh.map(c => <ConvBtn key={c.id} c={c} isActive={c.id === activeId} editingId={editingId} editTitle={editTitle} onSelect={selectConv} onDoubleClick={dblClick} onRenameSubmit={renameDone} onEditTitleChange={setEditTitle} onEditCancel={() => setEditingId(null)} />)}
                  {arch.length > 0 && <><div className={`${sectionTitle}`}>历史</div>{arch.map(c => <ConvBtn key={c.id} c={c} isActive={c.id === activeId} editingId={editingId} editTitle={editTitle} onSelect={selectConv} onDoubleClick={dblClick} onRenameSubmit={renameDone} onEditTitleChange={setEditTitle} onEditCancel={() => setEditingId(null)} />)}</>}
                </div>
              ))}
            </nav>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div ref={scrollRef} className="h-full min-h-0 overflow-auto overflow-x-hidden px-3 pb-8 pt-[10px]">
                  <div className="grid gap-[10px]">
                    {msgs.length === 0 && <div className="text-center text-[var(--muted)] py-12"><p className="text-lg font-medium">Wevra</p><p className="text-sm mt-1">TaskMeld 内置 AI 助手</p></div>}
                    {msgs.map(m => <Bubble key={m.id} message={m} isThinking={!!(streaming && m.isStreaming && m.role==="thinking")}
                      thinkCollapsed={thinkCollapsed[m.id]??true} toolCollapsed={toolCollapsed[m.id]??true}
                      onToggleThink={() => setThinkCollapsed(prev => ({...prev, [m.id]:!prev[m.id]}))}
                      onToggleTool={() => setToolCollapsed(prev => ({...prev, [m.id]:!prev[m.id]}))} />)}
                  </div>
                </div>
                <form ref={formRef} onSubmit={send}>
                  <div className="min-w-0 px-3 pb-3 pt-2">
                    <div className="relative w-full min-w-0 overflow-hidden">
                      <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={keyDown} rows={3}
                        placeholder="输入消息..." className={`${controlTextAreaMonoClassName} block min-h-[86px] max-h-[220px] resize-none pb-8 pr-11`} disabled={streaming} />
                      <button className={`${sendBtn} absolute right-[10px] bottom-[10px] m-0 inline-flex h-7 w-7 min-w-7 items-center justify-center p-0`} type="submit" disabled={!input.trim() || streaming}>
                        <span className="sr-only">发送</span>
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M4 12h12m0 0-4-4m4 4-4 4M4 5v6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                    </div>
                  </div>
                </form>
              </div>
              {showDebug && <DebugPanel onClose={() => setShowDebug(false)} />}
          </div>
        </div>
      </aside>
    </>
  );
}

// ── 气泡组件 ──

function Bubble({message:m, isThinking, thinkCollapsed, toolCollapsed, onToggleThink, onToggleTool}: {
  message: WevraChatMessage; isThinking: boolean; thinkCollapsed: boolean; toolCollapsed: boolean;
  onToggleThink: () => void; onToggleTool: () => void;
}) {
  if (m.role === "user") return <UserBubble message={m} />;
  if (m.role === "thinking") return <ThinkBubble message={m} isThinking={isThinking} collapsed={thinkCollapsed} onToggle={onToggleThink} />;
  if (m.role === "tool") return <ToolBubble message={m} collapsed={toolCollapsed} onToggle={onToggleTool} />;
  return <AsstBubble message={m} />;
}

function UserBubble({message:m}:{message:WevraChatMessage}) {
  return <article className="justify-self-end border-[rgba(50,215,186,0.15)] bg-[rgba(50,215,186,0.08)] min-w-0 max-w-full w-[min(92%,780px)] border px-[10px] py-2">
    <header className={`${mono} mb-1.5 flex items-center justify-between gap-[10px] text-xs text-[var(--muted)]`}><span>user</span><span>{ts(m.timestamp)}</span></header>
    <p className="m-0 whitespace-pre-wrap break-words text-[13px] leading-[1.45] text-[var(--text)]">{m.content}</p>
  </article>;
}
function ThinkBubble({message:m, isThinking, collapsed, onToggle}:{message:WevraChatMessage; isThinking:boolean; collapsed:boolean; onToggle:()=>void}) {
  if (!m.content && !isThinking) return null;
  return <article className={`${collapsed?"w-fit min-w-[180px] max-w-[min(72%,640px)]":"w-[min(92%,780px)]"} max-w-full min-w-0 justify-self-start border border-[rgba(142,163,179,0.14)] bg-[rgba(255,255,255,0.01)]`}>
    <button className="flex w-full items-center justify-between gap-[10px] border-0 border-b border-[rgba(142,163,179,0.12)] bg-transparent px-[10px] py-2 text-left text-xs text-[#93a6b5] hover:bg-[rgba(142,163,179,0.04)]" type="button" onClick={onToggle}>
      <span>💭 {isThinking?"思考中...":"思考过程"}</span><Chevron rotated={!collapsed} />
    </button>
    {!collapsed && m.content && <div className={`${mono} max-h-[220px] overflow-auto bg-[rgba(7,12,16,0.5)] px-[10px] py-2 text-[12.5px] leading-[1.45] whitespace-pre-wrap break-words text-[#b4c3cf]`}>{m.content}</div>}
  </article>;
}
function ToolBubble({message:m, collapsed, onToggle}:{message:WevraChatMessage; collapsed:boolean; onToggle:()=>void}) {
  return <article className={`${collapsed?"w-fit min-w-[180px] max-w-[min(72%,640px)]":"w-[min(92%,780px)]"} max-w-full min-w-0 justify-self-start border border-[rgba(142,163,179,0.14)] bg-[rgba(255,255,255,0.01)]`}>
    <button className="flex w-full items-center justify-between gap-[10px] border-0 border-b border-[rgba(142,163,179,0.12)] bg-transparent px-[10px] py-2 text-left text-xs text-[#93a6b5] hover:bg-[rgba(142,163,179,0.04)]" type="button" onClick={onToggle}>
      <span>tool {m.toolName}</span><Chevron rotated={!collapsed} />
    </button>
    {!collapsed && <>
      {m.toolArgs && <div className={`${mono} max-h-[220px] overflow-auto border-b border-[rgba(142,163,179,0.12)] bg-[rgba(7,12,16,0.5)] px-[10px] py-2 text-[12.5px] leading-[1.45] whitespace-pre-wrap break-words text-[#d1dbe3]`}>{m.toolArgs}</div>}
      {m.content && <div className={`${mono} max-h-[260px] overflow-auto bg-[rgba(7,12,16,0.5)] px-[10px] py-2`}><p className={`m-0 whitespace-pre-wrap break-words text-[12.5px] leading-[1.45] ${m.isError?"text-[var(--bad)]":"text-[#b4c3cf]"}`}>{m.content||"..."}</p></div>}
    </>}
  </article>;
}
function AsstBubble({message:m}:{message:WevraChatMessage}) {
  return <article className="justify-self-start border-[var(--line)] min-w-0 max-w-full w-[min(92%,780px)] border bg-[#0f171d] px-[10px] py-2">
    <header className={`${mono} mb-1.5 flex items-center justify-between gap-[10px] text-xs text-[var(--muted)]`}><span>assistant</span><span>{ts(m.timestamp)}</span></header>
    {m.content ? <div className="min-w-0 max-w-full overflow-hidden"><MarkdownViewer content={m.content} /></div> : m.isStreaming ? <p className="m-0 whitespace-pre-wrap break-words text-[13px] leading-[1.45] text-[var(--text)]"><span className="ml-0.5 inline-block h-[1em] w-[6px] animate-pulse align-[-0.12em] bg-[var(--live)]" aria-hidden="true" /></p> : null}
  </article>;
}
function Chevron({rotated}:{rotated:boolean}) {
  return <span className="inline-flex items-center justify-center leading-none text-[#7890a1]" aria-hidden="true"><svg viewBox="0 0 12 12" width="12" height="12" focusable="false" className={rotated?"rotate-90":""}><path d="M4 2.5L7.5 6L4 9.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg></span>;
}
function ts(t: number) { return new Date(t).toLocaleString(undefined, {hour12:false}); }

// ── 消息列表 reducer（避免每次 delta 都展开整个数组）──

type MsgAction =
  | { type: 'append'; msg: WevraChatMessage }
  | { type: 'patchLast'; patch: Partial<WevraChatMessage> }
  | { type: 'patchByToolCallId'; toolCallId: string | undefined; patch: Partial<WevraChatMessage> }
  | { type: 'appendContentToLast'; content: string }
  | { type: 'reset'; msgs: WevraChatMessage[] }

function msgReducer(state: WevraChatMessage[], action: MsgAction): WevraChatMessage[] {
  switch (action.type) {
    case 'append':
      return [...state, action.msg];
    case 'patchLast': {
      if (state.length === 0) return state;
      const last = state[state.length - 1];
      return [...state.slice(0, -1), { ...last, ...action.patch }];
    }
    case 'patchByToolCallId': {
      if (!action.toolCallId) {
        // fallback to patchLast if no toolCallId
        if (state.length === 0) return state;
        const last = state[state.length - 1];
        return [...state.slice(0, -1), { ...last, ...action.patch }];
      }
      const idx = state.findIndex(m => m.toolCallId === action.toolCallId);
      if (idx < 0) return state;
      const updated = { ...state[idx], ...action.patch };
      return [...state.slice(0, idx), updated, ...state.slice(idx + 1)];
    }
    case 'appendContentToLast': {
      if (state.length === 0) return state;
      const last = state[state.length - 1];
      return [...state.slice(0, -1), { ...last, content: last.content + action.content }];
    }
    case 'reset':
      return action.msgs;
    default:
      return state;
  }
}
