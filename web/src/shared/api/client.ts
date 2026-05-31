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

export const API_BASE = import.meta.env.VITE_API_BASE ?? "";
export const WS_BASE = API_BASE.replace(/^http/i, "ws");

