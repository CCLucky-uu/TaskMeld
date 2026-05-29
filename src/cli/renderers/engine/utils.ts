import type { TableColumn } from "./types";
import { isRecord } from "../../../utils/guards";

export const pickText = (value: unknown): string => {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value || "-";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

export const asArray = (value: unknown): unknown[] => {
  return Array.isArray(value) ? value : [];
};

export const readRecord = (value: unknown): Record<string, unknown> => {
  return isRecord(value) ? value : {};
};

export const extractListRows = (ir: { columns: TableColumn[]; rows: Record<string, unknown>[] }): Record<string, unknown>[] => {
  return ir.rows.map((row) => {
    const entry: Record<string, unknown> = {};
    for (const col of ir.columns) {
      entry[col.title] = col.render(row);
    }
    return entry;
  });
};
