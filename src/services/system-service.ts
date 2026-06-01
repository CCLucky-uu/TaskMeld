import type { PipelineRegistry } from "../app/pipeline-registry";

export type SystemSnapshot = {
  generatedAt: string;
  gateway: {
    status: unknown;
    hello: unknown;
    lastFrame: unknown;
  };
  pipelines: Array<{
    id: string;
    title: string;
  }>;
  bootstrap: ReturnType<PipelineRegistry["getBootstrapPayload"]>;
};

export type SystemService = {
  getSnapshot: () => SystemSnapshot;
};

export const createSystemService = (app: PipelineRegistry): SystemService => {
  const getSnapshot = (): SystemSnapshot => {
    // Reuse the registry's aggregated bootstrap result so the CLI sees the same system snapshot as existing frontends.
    const bootstrap = app.getBootstrapPayload();
    return {
      generatedAt: new Date().toISOString(),
      gateway: {
        status: app.gateway.getLatestStatus() ?? app.gateway.client.getStatus(),
        hello: app.gateway.getLatestHello(),
        lastFrame: app.gateway.getLastFrame(),
      },
      pipelines: app.listPipelines().map((definition) => ({
        id: definition.id,
        title: definition.title,
      })),
      bootstrap,
    };
  };

  return {
    getSnapshot,
  };
};

