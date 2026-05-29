import { retryPipelineNode } from "../../../entities/pipeline";

export function useNodeRetryFeature() {
  const retryNode = async (pipelineId: string, nodeId?: string) => {
    if (!nodeId) return;
    await retryPipelineNode(pipelineId, nodeId);
  };

  return {
    retryNode,
  };
}
