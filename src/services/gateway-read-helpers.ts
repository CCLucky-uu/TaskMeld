import type { PipelineRegistry } from "../app/pipeline-registry";

export const ensureGatewayReadyForReadonly = async (app: PipelineRegistry): Promise<void> => {
  if (app.gateway.client.getStatus().status === "ready") return;
  // When a read-only command hits a gateway method, the link must be established first, otherwise sendReq would fail immediately.
  await app.gateway.client.connect();
};
