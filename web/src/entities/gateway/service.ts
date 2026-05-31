import { GatewayStatus } from "./types";
import { wsRequest } from "../../shared/ws-client";

type GatewayStatusResponse = {
  status: GatewayStatus;
  hello?: { server?: { version?: string } };
};

export async function fetchGatewayStatus() {
  const data = await wsRequest<GatewayStatusResponse>("gateway.status");
  return {
    status: data.status,
    serverVersion: data.hello?.server?.version ?? "-",
  };
}
