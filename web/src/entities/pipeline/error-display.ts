import i18n from "../../shared/i18n";
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

  // Structured protocol validation / send-link errors are all "structured errors".
  if (
    raw.includes("contract_violation:") ||
    raw.includes("openclaw_send_failed:") ||
    raw.includes("request_id_mismatch") ||
    raw.includes("result_envelope_missing")
  ) {
    return {
      kind: "structured",
      label: i18n.t("overview:structured"),
      code: "structured_contract_or_transport",
      message: raw.replace(/^Error:\s*/i, ""),
      raw,
    };
  }

  const parsed = safeJsonParse(raw);
  if (isRecord(parsed)) {
    const code = typeof parsed.code === "string" ? parsed.code.trim() : "";
    const message = typeof parsed.message === "string" ? parsed.message.trim() : "";

    // The backend writes envelope.error as-is into lastError for nodes with status=failed.
    // These JSON errors are displayed as "node return errors" to distinguish them from structured-link issues.
    if (code || message) {
      return {
        kind: "node_return",
        label: i18n.t("overview:nodeReturn"),
        code: code || "node_error",
        message: message || code || raw,
        raw,
      };
    }
  }

  return {
    kind: "unknown",
    label: i18n.t("common:common.error"),
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
