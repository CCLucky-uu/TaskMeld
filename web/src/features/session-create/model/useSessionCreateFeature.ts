import { FormEvent, useState } from "react";
import { createSession as createSessionReq } from "../../../entities/session";
import { ApiError } from "../../../shared/api/client";

type UseSessionCreateFeatureArgs = {
  reload: () => Promise<void>;
};

export function useSessionCreateFeature({ reload }: UseSessionCreateFeatureArgs) {
  const [sessionCreatePayload, setSessionCreatePayload] = useState("{}");

  const createSession = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const body = JSON.parse(sessionCreatePayload) as Record<string, unknown>;
      await createSessionReq(body);
      await reload();
    } catch (error) {
      if (error instanceof ApiError) {
        alert(`新建会话失败: HTTP ${error.status}`);
        return;
      }
      alert("新建会话 JSON 格式不正确");
    }
  };

  return {
    sessionCreatePayload,
    setSessionCreatePayload,
    createSession,
  };
}
