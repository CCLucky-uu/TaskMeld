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

    // dev/server 进程允许先在“网关未配置/未就绪”状态下启动 HTTP/WS，
    // 真正触发 connect/sendReq 时再校验凭据，才能兼容本地调试与需要网关的命令两类路径。
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

  // 网关握手成功后需要把 hello 回灌到 registry，保证运行态上下文完整。
  const connect = async (): Promise<HelloOkPayload> => {
    const hello = await client.connect();
    app.onGatewayReady(hello);
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
