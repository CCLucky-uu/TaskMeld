import type { RenderSpec, RenderIR, SectionIR, TableColumn } from "./types";
import { pickText, asArray, readRecord } from "./utils";

export const escapeCell = (value: unknown): string => {
  return pickText(value).replace(/\|/g, "\\|");
};

const renderTable = (headers: string[], rows: string[][]): string[] => {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  ];
  for (const row of rows) {
    lines.push(`| ${row.join(" | ")} |`);
  }
  return lines;
};

const renderListIr = (ir: { title: string; columns: TableColumn[]; rows: Record<string, unknown>[]; emptyText?: string }): string => {
  const lines = [`# ${ir.title}`, ""];
  if (ir.rows.length === 0) {
    lines.push(ir.emptyText ?? "(none)");
    return lines.join("\n");
  }
  const headers = ir.columns.map((c) => c.title);
  const stringRows = ir.rows.map((row) => ir.columns.map((c) => escapeCell(c.render(row))));
  return [...lines, ...renderTable(headers, stringRows)].join("\n");
};

export const extractIr = (spec: RenderSpec, data: unknown): RenderIR => {
  if (spec.kind === "text") {
    return { kind: "text", title: spec.title, content: spec.render(data) };
  }
  if (spec.kind === "list") {
    const rows = (asArray(data) as Array<Record<string, unknown>>).map((row) => readRecord(row));
    return { kind: "list", title: spec.title, columns: spec.columns, rows, emptyText: spec.emptyText };
  }
  // kind: "detail"
  const sections: SectionIR[] = [];
  for (const section of spec.sections) {
    if (section.visible && !section.visible(data)) continue;
    if (section.kind === "key-value") {
      const rows = section.rows(data);
      if (!rows || rows.length === 0) continue;
      sections.push({ kind: "key-value", title: section.title, rows });
    } else if (section.kind === "table") {
      const rows = section.rows(data);
      if (!rows || rows.length === 0) continue;
      const recordRows = (rows as any[]).map((r) => readRecord(r)) as Record<string, unknown>[];
      sections.push({ kind: "table", title: section.title, columns: section.columns, rows: recordRows });
    } else {
      // kind: "custom"
      const lines = section.render(data);
      if (!lines || lines.length === 0) continue;
      sections.push({ kind: "custom", title: section.title, lines });
    }
  }
  return { kind: "detail", title: spec.title, sections };
};

export const formatMarkdown = (ir: RenderIR): string => {
  if (ir.kind === "text") {
    return ir.content;
  }
  if (ir.kind === "list") {
    return renderListIr(ir);
  }
  // kind: "detail"
  const lines = [`# ${ir.title}`];
  for (const section of ir.sections) {
    lines.push("", `## ${section.title}`, "");
    if (section.kind === "key-value") {
      lines.push("| Field | Value |", "| --- | --- |");
      for (const row of section.rows) {
        lines.push(`| ${escapeCell(row.field)} | ${escapeCell(row.value)} |`);
      }
    } else if (section.kind === "table") {
      const headers = section.columns.map((c) => c.title);
      const stringRows = section.rows.map((row) => section.columns.map((c) => escapeCell(c.render(row))));
      lines.push(...renderTable(headers, stringRows));
    } else {
      // custom: 直接拼入
      lines.push(...section.lines);
    }
  }
  return lines.join("\n");
};

