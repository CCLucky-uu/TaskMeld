import type { PipelineRegistry } from "../app/pipeline-registry";

export const ensureGatewayReadyForReadonly = async (app: PipelineRegistry): Promise<void> => {
  if (app.gateway.client.getStatus().status === "ready") return;
  // 只读命令一旦命中网关方法，也必须先建好链路，否则 sendReq 会直接失败。
  await app.gateway.client.connect();
};
