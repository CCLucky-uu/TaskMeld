export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// 默认使用同源相对路径，便于本地与公网统一走 /api 反向代理。
const DEFAULT_API_BASE = "";

export const API_BASE = import.meta.env.VITE_API_BASE ?? DEFAULT_API_BASE;
export const WS_BASE = API_BASE.replace(/^http/i, "ws");

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    throw new ApiError(`request_failed:${path}`, res.status, body);
  }
  return body as T;
}
