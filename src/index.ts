import "dotenv/config";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGatewayClient } from "./gateway";
import { createAppContext } from "./app/create-app-context";
import { resolveGatewayConfig } from "./app/user-config";
import { createApiHandler } from "./server/http-handler";
import { createWsBroker } from "./transport/ws-broker";
import { createWsRequestHandler } from "./transport/ws-handler";
import { registerAllWsMethods } from "./transport/ws-methods/register-all";
import { resolveTaskMeldDataPath } from "./app/data-dir";
import { createPipelineService } from "./services/pipeline-service";
import { createSchedulerService } from "./services/scheduler-service";
import { createRunLogService } from "./logs/run-log-service";

export { createGatewayClient };

const serverRuntimeIdentity = {
  serverId: randomUUID(),
  startedAt: new Date().toISOString(),
};

const getServerRuntimeDir = (): string => {
  const override = process.env.TASKMELD_SERVER_RUNTIME_DIR?.trim();
  if (override) return override;
  return resolveTaskMeldDataPath("server");
};

const getServerRuntimeMetadataPath = (): string => join(getServerRuntimeDir(), "runtime.json");

const writeServerRuntimeMetadata = async (port: number): Promise<void> => {
  const metadataPath = getServerRuntimeMetadataPath();
  await mkdir(getServerRuntimeDir(), { recursive: true });
  await writeFile(metadataPath, JSON.stringify({
    serverId: serverRuntimeIdentity.serverId,
    pid: process.pid,
    port,
    endpoint: `http://127.0.0.1:${port}`,
    startedAt: serverRuntimeIdentity.startedAt,
  }, null, 2));
};

const removeServerRuntimeMetadata = async (): Promise<void> => {
  await rm(getServerRuntimeMetadataPath(), { force: true });
};

if (require.main === module) {
  (async () => {
  const gatewayConfig = await resolveGatewayConfig();
  const appContext = createAppContext({
    gatewayUrl: gatewayConfig.url ?? undefined,
    gatewayToken: gatewayConfig.token ?? undefined,
  });
  const app = appContext.app;

  appContext.gateway.setHandlers({
    onStatus: (_status) => {
      // silence intermediate status transitions
    },
    onError: (error) => {
      console.error("gateway-error", error);
    },
  });

  // Create shared services (used by both HTTP routes and WS handler)
  const pipelineService = createPipelineService(app);
  const schedulerService = createSchedulerService(app);
  const runLogService = createRunLogService({
    rootDir: resolveTaskMeldDataPath("logs", "runs"),
  });

  const wsHandler = createWsRequestHandler(app, {
    pipelineService,
    schedulerService,
    runLogService,
    client: app.gateway.client,
    getLatestStatus: app.gateway.getLatestStatus,
    getLatestHello: app.gateway.getLatestHello,
    getLastFrame: app.gateway.getLastFrame,
    getTimeline: app.runtime.getCombinedTimeline,
    pickArray: app.gateway.pickArray,
    refreshSessionsFromGateway: app.gateway.refreshSessionsFromGateway,
    getSessionCache: app.gateway.getSessionCache,
  });
  registerAllWsMethods(wsHandler.registry);

  const apiServer = createServer(
    createApiHandler({
      apiPort: appContext.api.port,
      webOrigin: appContext.api.webOrigin,
      app,
      serverRuntimeIdentity: {
        serverId: serverRuntimeIdentity.serverId,
        pid: process.pid,
        port: appContext.api.port,
        endpoint: `http://127.0.0.1:${appContext.api.port}`,
        startedAt: serverRuntimeIdentity.startedAt,
      },
    }),
  );

  const wsBroker = createWsBroker({
    server: apiServer,
    path: "/api/ws",
    getBootstrapPayload: app.getBootstrapPayload,
    handleRequest: wsHandler.handleMessage,
  });
  app.runtime.setBroadcast(wsBroker.broadcast);

  void appContext.initialize();

  apiServer.listen(appContext.api.port, appContext.api.host, () => {
    void writeServerRuntimeMetadata(appContext.api.port).catch((error) => {
      console.error("server-runtime-metadata-write-failed", error);
    });
    console.log(`api-server-ready v${process.env.npm_package_version ?? "?.?.?"}  http://${appContext.api.host}:${appContext.api.port}`);
  });

  if (appContext.gateway.url && appContext.gateway.token) {
    appContext.gateway.connect()
      .then((hello) => {
        const sv = (hello as any)?.server;
        console.log(`gateway-ready  server=${sv?.version ?? "?"}  conn=${sv?.connId ?? "?"}  proto=v${(hello as any)?.protocol ?? "?"}`);
        console.log(`taskmeld v${process.env.npm_package_version ?? "?.?.?"}  running, Ctrl+C to stop`);
      })
      .catch((error) => {
        console.error("gateway-connect-failed", error);
        console.log(`taskmeld v${process.env.npm_package_version ?? "?.?.?"}  running (gateway disconnected), Ctrl+C to stop`);
        process.exitCode = 1;
      });
  } else {
    console.warn("gateway-connect-skipped missing OPENCLAW_GATEWAY_URL or OPENCLAW_GATEWAY_TOKEN");
    console.log(`taskmeld v${process.env.npm_package_version ?? "?.?.?"}  running (no gateway), Ctrl+C to stop`);
  }

  let shutdownStarted = false;
  const shutdown = () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    wsBroker.close();
    appContext.dispose();
    void removeServerRuntimeMetadata().catch(() => {});
  };

  process.on("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });
  process.on("exit", () => {
    shutdown();
  });
  })().catch((error) => {
    console.error("app-context-create-failed", error);
    process.exit(1);
  });
}
