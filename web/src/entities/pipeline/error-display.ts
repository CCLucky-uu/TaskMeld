import type { PipelineNode } from "./types";

export type PipelineErrorKind = "structured" | "node_return" | "unknown";

export type ParsedPipelineError = {
  kind: PipelineErrorKind;
  label: string;
  code: string;
  message: string;
  raw: string;
};

const safeJsonParse = (value: string): unknown | null => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parsePipelineError = (rawError: string | null | undefined): ParsedPipelineError | null => {
  const raw = String(rawError ?? "").trim();
  if (!raw) return null;

  // 结构化协议校验/发送链路错误都属于“结构化错误”。
  if (
    raw.includes("contract_violation:") ||
    raw.includes("openclaw_send_failed:") ||
    raw.includes("request_id_mismatch") ||
    raw.includes("result_envelope_missing")
  ) {
    return {
      kind: "structured",
      label: "结构化错误",
      code: "structured_contract_or_transport",
      message: raw.replace(/^Error:\s*/i, ""),
      raw,
    };
  }

  const parsed = safeJsonParse(raw);
  if (isRecord(parsed)) {
    const code = typeof parsed.code === "string" ? parsed.code.trim() : "";
    const message = typeof parsed.message === "string" ? parsed.message.trim() : "";

    // 后端对节点 status=failed 会把 envelope.error 原样写入 lastError。
    // 这类 JSON 错误按“节点返回错误”展示，便于和结构化链路问题区分。
    if (code || message) {
      return {
        kind: "node_return",
        label: "节点返回错误",
        code: code || "node_error",
        message: message || code || raw,
        raw,
      };
    }
  }

  return {
    kind: "unknown",
    label: "未知错误",
    code: "unknown_error",
    message: raw.replace(/^Error:\s*/i, ""),
    raw,
  };
};

export const isStructuredErrorNode = (node: PipelineNode): boolean => {
  if (node.status !== "failed") return false;
  const parsed = parsePipelineError(node.lastError);
  if (!parsed) return false;
  return parsed.kind === "structured" || parsed.kind === "unknown";
};

export const isNodeReturnErrorNode = (node: PipelineNode): boolean => {
  if (node.status !== "failed") return false;
  const parsed = parsePipelineError(node.lastError);
  return parsed?.kind === "node_return";
};
