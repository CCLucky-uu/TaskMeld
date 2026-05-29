import { GatewayStatus } from "./types";
import { requestJson } from "../../shared/api/client";

type GatewayStatusResponse = {
  status: GatewayStatus;
  hello?: { server?: { version?: string } };
};

export async function fetchGatewayStatus() {
  const data = await requestJson<GatewayStatusResponse>("/api/gateway/status");
  return {
    status: data.status,
    serverVersion: data.hello?.server?.version ?? "-",
  };
}
