export const DEFAULT_API_PORT = 3100;
export const DEFAULT_API_HOST = "0.0.0.0";
export const DEFAULT_WEB_ORIGIN = "*";
export const DEFAULT_GATEWAY_SCOPES: string[] = ["operator.read", "operator.write", "operator.admin"];
export const DEFAULT_ITEM_KEYS = ["global"];

export type ResolvedAppContextConfig = {
  apiPort: number;
  apiHost: string;
  webOrigin: string;
  defaultItemKeys: string[];
  gatewayScopes: string[];
};

export type ResolveAppContextConfigOptions = {
  env?: NodeJS.ProcessEnv;
  apiPort?: number;
  apiHost?: string;
  webOrigin?: string;
  defaultItemKeys?: string[];
  gatewayScopes?: string[];
};

const parseCsvUnique = (raw: string): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw.split(",")) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

const resolveGatewayScopes = (options: ResolveAppContextConfigOptions): string[] => {
  if (options.gatewayScopes && options.gatewayScopes.length > 0) {
    return [...new Set(options.gatewayScopes.map((scope) => scope.trim()).filter(Boolean))];
  }
  const env = options.env ?? process.env;
  const parsed = parseCsvUnique(String(env.OPENCLAW_GATEWAY_SCOPES ?? ""));
  return parsed.length > 0 ? parsed : DEFAULT_GATEWAY_SCOPES;
};

const resolveDefaultItemKeys = (options: ResolveAppContextConfigOptions): string[] => {
  if (options.defaultItemKeys && options.defaultItemKeys.length > 0) {
    return [...new Set(options.defaultItemKeys.map((item) => item.trim()).filter(Boolean))];
  }
  const env = options.env ?? process.env;
  const parsed = parseCsvUnique(String(env.OPENCLAW_PIPELINE_ITEMS ?? ""));
  return parsed.length > 0 ? parsed : DEFAULT_ITEM_KEYS;
};

export const resolveAppContextConfig = (options: ResolveAppContextConfigOptions = {}): ResolvedAppContextConfig => {
  const env = options.env ?? process.env;
  const apiPortRaw = options.apiPort ?? Number(env.API_PORT ?? DEFAULT_API_PORT);
  const apiPort = Number.isFinite(apiPortRaw) && apiPortRaw > 0 ? Math.trunc(apiPortRaw) : DEFAULT_API_PORT;
  const apiHost = options.apiHost?.trim() || env.API_HOST?.trim() || DEFAULT_API_HOST;
  const webOrigin = options.webOrigin?.trim() || env.WEB_ORIGIN?.trim() || DEFAULT_WEB_ORIGIN;

  return {
    apiPort,
    apiHost,
    webOrigin,
    defaultItemKeys: resolveDefaultItemKeys(options),
    gatewayScopes: resolveGatewayScopes(options),
  };
};
