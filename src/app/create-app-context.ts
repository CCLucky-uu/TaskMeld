import {
  createGatewayClient,
  type GatewayClient,
  type GatewayConnectionInfo,
  type GatewayFrame,
  type HelloOkPayload,
} from "../gateway";
import { createPipelineRegistry, type PipelineRegistry } from "./pipeline-registry";
import { resolveAppContextConfig, type ResolveAppContextConfigOptions, type ResolvedAppContextConfig } from "./app-context-env";
import { createAppServices, type AppServices } from "../services";

type GatewayEventHandlers = {
  onStatus: (status: GatewayConnectionInfo) => void;
  onFrame: (frame: GatewayFrame) => void;
  onError: (error: unknown) => void;
};

type GatewayCredentials = {
  url: string;
  token: string;
};

export type CreateAppContextOptions = ResolveAppContextConfigOptions & {
  env?: NodeJS.ProcessEnv;
  gatewayUrl?: string;
  gatewayToken?: string;
  gatewayScopes?: string[];
  onGatewayStatus?: (status: GatewayConnectionInfo) => void;
  onGatewayFrame?: (frame: GatewayFrame) => void;
  onGatewayError?: (error: unknown) => void;
};

export type AppContext = {
  config: ResolvedAppContextConfig;
  app: PipelineRegistry;
  services: {
    readonly: AppServices["readonly"];
    writable: AppServices["writable"];
  };
  api: {
    port: number;
    host: string;
    webOrigin: string;
  };
  gateway: {
    url: string | null;
    token: string | null;
    scopes: string[];
    client: GatewayClient;
    setHandlers: (next: Partial<GatewayEventHandlers>) => void;
    getHandlers: () => GatewayEventHandlers;
    connect: () => Promise<HelloOkPayload>;
  };
  initialize: () => Promise<void>;
  dispose: () => void;
};

const normalizeRequiredEnvString = (value: string | undefined, key: string): string => {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`missing_required_env:${key}`);
  }
  return normalized;
};

const normalizeOptionalEnvString = (value: string | undefined): string | null => {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
};

const resolveGatewayCredentials = (
  options: Pick<CreateAppContextOptions, "gatewayUrl" | "gatewayToken">,
  env: NodeJS.ProcessEnv,
): GatewayCredentials => ({
  url: normalizeRequiredEnvString(options.gatewayUrl ?? env.OPENCLAW_GATEWAY_URL, "OPENCLAW_GATEWAY_URL"),
  token: normalizeRequiredEnvString(options.gatewayToken ?? env.OPENCLAW_GATEWAY_TOKEN, "OPENCLAW_GATEWAY_TOKEN"),
});

export const createAppContext = (options: CreateAppContextOptions = {}): AppContext => {
  const env = options.env ?? process.env;
  const config = resolveAppContextConfig({ ...options, env });
  const gatewayUrl = normalizeOptionalEnvString(options.gatewayUrl ?? env.OPENCLAW_GATEWAY_URL);
  const gatewayToken = normalizeOptionalEnvString(options.gatewayToken ?? env.OPENCLAW_GATEWAY_TOKEN);

  const gatewayHandlers: GatewayEventHandlers = {
    onStatus: options.onGatewayStatus ?? (() => {}),
    onFrame: options.onGatewayFrame ?? (() => {}),
    onError: options.onGatewayError ?? (() => {}),
  };

  let appRef: PipelineRegistry | null = null;
  let clientRef: GatewayClient | null = null;
  const ensureGatewayClient = (): GatewayClient => {
    if (clientRef) return clientRef;

    // dev/server processes allow HTTP/WS to start even before gateway is configured/ready,
    // deferring credential validation to when connect/sendReq actually fires, to support both local debugging and gateway-required commands.
    const credentials = resolveGatewayCredentials(options, env);
    clientRef = createGatewayClient({
      gatewayUrl: credentials.url,
      token: credentials.token,
      scopes: config.gatewayScopes,
      onStatus: (status) => {
        gatewayHandlers.onStatus(status);
        appRef?.onGatewayStatus(status);
      },
      onFrame: (frame) => {
        gatewayHandlers.onFrame(frame);
        appRef?.onGatewayFrame(frame);
      },
      onRawFrame: (rawFrame) => {
        appRef?.onGatewayRawFrame(rawFrame);
      },
      onError: (error) => {
        gatewayHandlers.onError(error);
        appRef?.onGatewayError(error);
      },
    });
    return clientRef;
  };
  const client: GatewayClient = {
    connect: () => ensureGatewayClient().connect(),
    close: () => {
      clientRef?.close();
    },
    sendReq: (method, params, opts) => ensureGatewayClient().sendReq(method, params, opts),
    onEvent: (handler) => ensureGatewayClient().onEvent(handler),
    getStatus: () => clientRef?.getStatus() ?? {
      status: "idle",
      lastError: null,
      lastHelloAt: null,
      protocol: null,
      scopes: [...config.gatewayScopes],
    },
    getSocket: () => clientRef?.getSocket() ?? null,
  };

  const app = createPipelineRegistry({
    client,
    webOrigin: config.webOrigin,
    defaultItemKeys: config.defaultItemKeys,
  });
  appRef = app;
  const appServices = createAppServices(app);

  // After the gateway handshake succeeds, feed the hello payload back into the registry so runtime context stays complete.
  const connect = async (): Promise<HelloOkPayload> => {
    const hello = await client.connect();
    app.onGatewayReady(hello);

    // Detect and persist workspace root from gateway config so agent creation
    // can construct absolute workspace paths. Priority: env → .env / config.json → auto-detect.
    // Verified config.get structure (OpenClaw 2026.5.28):
    //   parsed.agents.defaults.workspace → /home/user/.openclaw/workspace
    try {
      const { resolveWorkspaceRoot } = await import("./user-config.js");
      const existingRoot = await resolveWorkspaceRoot();
      if (!existingRoot) {
        const config = await client.sendReq("config.get");
        const data = (config ?? {}) as Record<string, unknown>;
        const parsed = (data.parsed ?? data) as Record<string, unknown>;
        const agents = (parsed.agents ?? {}) as Record<string, unknown>;
        const defaults = (agents.defaults ?? {}) as Record<string, unknown>;
        const defaultWs = typeof defaults.workspace === "string" ? defaults.workspace.trim() : "";
        if (defaultWs) {
          const root = defaultWs.replace(/[\\/]workspace[\\/]?$/, "");
          if (root) {
            const { isTaskMeldDevRuntime } = await import("./data-dir.js");
            if (isTaskMeldDevRuntime()) {
              // Dev: write to project root .env (so dotenv loads it on next restart) + set in-memory (this session)
              const { join } = await import("node:path");
              const envPath = join(process.cwd(), ".env");
              const { appendFile, mkdir } = await import("node:fs/promises");
              const { dirname } = await import("node:path");
              await mkdir(dirname(envPath), { recursive: true });
              await appendFile(envPath, `\nOPENCLAW_WORKSPACE_ROOT=${root}\n`, "utf8");
              process.env.OPENCLAW_WORKSPACE_ROOT = root;
            } else {
              // Prod: write to ~/.taskmeld/config.json
              const { writeUserConfig } = await import("./user-config.js");
              await writeUserConfig({ workspaceRoot: root });
            }
          }
        }
      }
    } catch {
      // Non-critical — agent creation will fall back to relative path.
    }

    return hello;
  };

  return {
    config,
    app,
    services: {
      readonly: appServices.readonly,
      writable: appServices.writable,
    },
    api: {
      port: config.apiPort,
      host: config.apiHost,
      webOrigin: config.webOrigin,
    },
    gateway: {
      url: gatewayUrl,
      token: gatewayToken,
      scopes: config.gatewayScopes,
      client,
      setHandlers: (next) => {
        if (next.onStatus) gatewayHandlers.onStatus = next.onStatus;
        if (next.onFrame) gatewayHandlers.onFrame = next.onFrame;
        if (next.onError) gatewayHandlers.onError = next.onError;
      },
      getHandlers: () => ({ ...gatewayHandlers }),
      connect,
    },
    initialize: () => app.initialize(),
    dispose: () => {
      client.close();
      app.dispose();
    },
  };
};
