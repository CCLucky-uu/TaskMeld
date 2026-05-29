import type { RenderIR } from "./types";
import type { CliError } from "../../errors";
import { extractListRows } from "./utils";

type JsonErrorEnvelope = {
  ok: false;
  command?: string;
  error: {
    code: string;
    message: string;
    details: unknown;
  };
  meta: {
    ts: string;
  };
};
const camelKey = (title: string): string => {
  const cleaned = title.replace(/[^a-zA-Z0-9\s]/g, "");
  const words = cleaned.split(/\s+/);
  const first = (words[0] ?? "").toLowerCase();
  const rest = words.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return [first, ...rest].join("");
};

export const irToData = (ir: RenderIR): unknown => {
  if (ir.kind === "text") return ir.content;

  if (ir.kind === "list") {
    return extractListRows(ir);
  }

  // kind: "detail"
  const result: Record<string, unknown> = {};
  for (const section of ir.sections) {
    const key = camelKey(section.title);
    if (section.kind === "key-value") {
      const obj: Record<string, unknown> = {};
      for (const row of section.rows) {
        obj[row.field] = row.value;
      }
      result[key] = obj;
    } else if (section.kind === "table") {
      result[key] = extractListRows(section);
    }
    // custom sections are markdown-only, skip in JSON
  }
  return result;
};

type JsonSuccessEnvelope = {
  ok: true;
  command?: string;
  data: unknown;
  meta: {
    ts: string;
  };
};

export const formatJson = (ir: RenderIR, envelope: boolean, command?: string): string => {
  const data = irToData(ir);
  if (!envelope) return JSON.stringify(data);
  const output: JsonSuccessEnvelope = {
    ok: true,
    ...(command ? { command } : {}),
    data,
    meta: {
      ts: new Date().toISOString(),
    },
  };
  return JSON.stringify(output);
};

export const renderJsonError = (command: string | undefined, error: CliError): string => {
  const payload: JsonErrorEnvelope = {
    ok: false,
    ...(command ? { command } : {}),
    error: {
      code: error.code,
      message: error.message,
      details: error.details ?? null,
    },
    meta: {
      ts: new Date().toISOString(),
    },
  };
  return JSON.stringify(payload);
};
