import { FormEvent, useState } from "react";
import { sendSessionMessage as sendSessionMessageReq, SendMode, SessionItem } from "../../../entities/session";
import { ApiError } from "../../../shared/api/client";

type UseSessionSendFeatureArgs = {
  reload: () => Promise<void>;
};

export function useSessionSendFeature({ reload }: UseSessionSendFeatureArgs) {
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [sessionMessage, setSessionMessage] = useState("");
  const [sendMode, setSendMode] = useState<SendMode>("auto");
  const [lastSendInfo, setLastSendInfo] = useState<string>("");

  const ensureDefaultSession = (sessions: SessionItem[]) => {
    if (sessions.length === 0) return;
    setSelectedSessionId((prev) => prev || sessions[0].id);
  };

  const isSessionForAgent = (sessionId: string, agentId: string) => {
    const sid = sessionId.trim();
    const aid = agentId.trim();
    if (!sid || !aid) return false;
    return sid === aid || sid.startsWith(`agent:${aid}:`);
  };

  const selectPreferredSessionForAgent = (agentId: string, sessions: SessionItem[]) => {
    const preferred =
      sessions.find((session) => session.id === `agent:${agentId}:main`) ??
      sessions.find((session) => isSessionForAgent(session.id, agentId));
    if (preferred) {
      setSelectedSessionId(preferred.id);
      return;
    }
    setSelectedSessionId(`agent:${agentId}:main`);
  };

  const sendSessionMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSessionId || !sessionMessage.trim()) return;

    try {
      const ok = await sendSessionMessageReq({
        sessionId: selectedSessionId,
        message: sessionMessage,
        mode: sendMode,
      });
      const modelText = ok?.model ? `${ok.modelProvider ? `${ok.modelProvider}/` : ""}${ok.model}` : "-";
      setLastSendInfo(
        `发送成功\nmethod: ${ok?.usedMethod ?? "-"}\nmodel: ${modelText}\nparams: ${JSON.stringify(ok?.usedParams ?? {}, null, 2)}`,
      );
      setSessionMessage("");
      await reload();
    } catch (error) {
      if (error instanceof ApiError) {
        const err = error.body as { error?: string; attempts?: string[] } | null;
        const detail = err?.attempts?.slice(0, 3).join("\n") ?? err?.error ?? `HTTP ${error.status}`;
        setLastSendInfo(`发送失败\n${detail}`);
        alert(`发送失败:\n${detail}`);
        return;
      }
      const fallback = error instanceof Error ? error.message : "unknown error";
      setLastSendInfo(`发送失败\n${fallback}`);
      alert(`发送失败:\n${fallback}`);
    }
  };

  return {
    selectedSessionId,
    setSelectedSessionId,
    sessionMessage,
    setSessionMessage,
    sendMode,
    setSendMode,
    lastSendInfo,
    ensureDefaultSession,
    selectPreferredSessionForAgent,
    sendSessionMessage,
  };
}
