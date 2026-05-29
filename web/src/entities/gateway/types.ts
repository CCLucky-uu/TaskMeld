export type GatewayStatus = {
  status: string;
  protocol: number | null;
  scopes: string[];
  lastError: string | null;
};
