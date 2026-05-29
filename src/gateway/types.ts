export type GatewayReqFrame = {
  type: "req";
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

export type GatewayResFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

export type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: number;
};

export type GatewayFrame = GatewayReqFrame | GatewayResFrame | GatewayEventFrame;

export type HelloOkPayload = {
  type?: string;
  protocol?: number;
  policy?: {
    tickIntervalMs?: number;
  };
  auth?: {
    deviceToken?: string;
    role?: string;
    scopes?: string[];
  };
  [key: string]: unknown;
};

export type GatewayConnectParams = {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: string;
    version: string;
    platform: string;
    mode: string;
    instanceId: string;
  };
  role: "operator";
  scopes: string[];
  caps: string[];
  commands: string[];
  permissions: Record<string, boolean>;
  auth: { token: string };
  locale: string;
  userAgent: string;
  device: {
    id: string;
    publicKey: string;
    signature: string;
    signedAt: number;
    nonce?: string;
  };
};