import type { WsMethodRegistry } from "./types"
import { registerPipelineWsMethods } from "./pipelines"
import { registerPipelineRuntimeWsMethods } from "./pipeline-runtime"
import { registerPipelineWorkflowWsMethods } from "./pipeline-workflow"
import { registerPipelineBatchWsMethods } from "./pipeline-batch"
import { registerPipelineSchedulerWsMethods } from "./pipeline-scheduler"
import { registerPipelineLinksWsMethods } from "./pipeline-links"
import { registerPipelineQueueWsMethods } from "./pipeline-queue"
import { registerAgentWsMethods } from "./agents"
import { registerSessionWsMethods } from "./sessions"
import { registerArtifactWsMethods } from "./artifacts"
import { registerLogWsMethods } from "./logs"
import { registerGatewayWsMethods } from "./gateway"
import { registerTimelineWsMethods } from "./timeline"
import { registerWevraWsMethods } from "./wevra"

export const registerAllWsMethods = (registry: WsMethodRegistry): void => {
  registerPipelineWsMethods(registry)
  registerPipelineRuntimeWsMethods(registry)
  registerPipelineWorkflowWsMethods(registry)
  registerPipelineBatchWsMethods(registry)
  registerPipelineSchedulerWsMethods(registry)
  registerPipelineLinksWsMethods(registry)
  registerPipelineQueueWsMethods(registry)
  registerAgentWsMethods(registry)
  registerSessionWsMethods(registry)
  registerArtifactWsMethods(registry)
  registerLogWsMethods(registry)
  registerGatewayWsMethods(registry)
  registerTimelineWsMethods(registry)
  registerWevraWsMethods(registry)
}
