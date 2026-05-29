import type { PipelineRegistry } from "../app/pipeline-registry";
import { createAgentService, type AgentService } from "./agent-service";
import { createArtifactService, type ArtifactService } from "./artifact-service";
import { createPipelineService, type PipelineService } from "./pipeline-service";
import { createSchedulerService, type SchedulerService } from "./scheduler-service";
import { createSessionService, type SessionService } from "./session-service";
import { createSystemService, type SystemService } from "./system-service";

export type ReadonlyServices = {
  system: SystemService;
  pipeline: PipelineService;
  agent: AgentService;
  session: SessionService;
  artifact: ArtifactService;
};

export type WritableServices = {
  pipeline: Pick<PipelineService, "startPipeline" | "getPipelineExecutionStatus" | "stopPipeline" | "runPipeline" | "retryNode" | "getOutput" | "listOutputs" | "listLinks" | "getQueue">;
  session: Pick<SessionService, "sendMessage" | "sendMessageAndWaitForReply">;
  scheduler: SchedulerService;
};

export type AppServices = {
  readonly: ReadonlyServices;
  writable: WritableServices;
};

type InternalServices = {
  system: SystemService;
  pipeline: PipelineService;
  agent: AgentService;
  session: SessionService;
  artifact: ArtifactService;
  scheduler: SchedulerService;
};

const createAllServices = (app: PipelineRegistry): InternalServices => ({
  system: createSystemService(app),
  pipeline: createPipelineService(app),
  agent: createAgentService(app),
  session: createSessionService(app),
  artifact: createArtifactService(app),
  scheduler: createSchedulerService(app),
});

export const createReadonlyServices = (app: PipelineRegistry): ReadonlyServices => {
  const services = createAllServices(app);
  return {
    // 统一工厂用于主线集成，CLI 入口只需传入 registry 即可拿到全部只读 service。
    system: services.system,
    pipeline: services.pipeline,
    agent: services.agent,
    session: services.session,
    artifact: services.artifact,
  };
};

export const createAppServices = (app: PipelineRegistry): AppServices => {
  const services = createAllServices(app);
  return {
    readonly: {
      system: services.system,
      pipeline: services.pipeline,
      agent: services.agent,
      session: services.session,
      artifact: services.artifact,
    },
    writable: {
      pipeline: {
        startPipeline: services.pipeline.startPipeline,
        getPipelineExecutionStatus: services.pipeline.getPipelineExecutionStatus,
        stopPipeline: services.pipeline.stopPipeline,
        runPipeline: services.pipeline.runPipeline,
        retryNode: services.pipeline.retryNode,
        getOutput: services.pipeline.getOutput,
        listOutputs: services.pipeline.listOutputs,
        listLinks: services.pipeline.listLinks,
        getQueue: services.pipeline.getQueue,
      },
      session: {
        sendMessage: services.session.sendMessage,
        sendMessageAndWaitForReply: services.session.sendMessageAndWaitForReply,
      },
      scheduler: services.scheduler,
    },
  };
};
