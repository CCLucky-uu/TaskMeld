import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { createSession as createSessionReq } from "../../../entities/session";
import { ApiError } from "../../../shared/ws-client";

type UseSessionCreateFeatureArgs = {
  reload: () => Promise<void>;
};

export function useSessionCreateFeature({ reload }: UseSessionCreateFeatureArgs) {
  const { t } = useTranslation("session");
  const [sessionCreatePayload, setSessionCreatePayload] = useState("{}");

  const createSession = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const body = JSON.parse(sessionCreatePayload) as Record<string, unknown>;
      await createSessionReq(body);
      await reload();
    } catch (error) {
      if (error instanceof ApiError) {
        alert(t("createSessionFailed", { status: error.status }));
        return;
      }
      alert(t("invalidJson"));
    }
  };

  return {
    sessionCreatePayload,
    setSessionCreatePayload,
    createSession,
  };
}
