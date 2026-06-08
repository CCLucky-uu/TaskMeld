export type TableColumn = {
  title: string
  render: (row: Record<string, unknown>) => unknown
}

export type ListRenderSpec = {
  kind: "list"
  title: string
  emptyText?: string
  columns: TableColumn[]
}

export type KeyValueSectionSpec = {
  title: string
  kind: "key-value"
  visible?: (data: unknown) => boolean
  rows: (data: unknown) => { field: string; value: unknown }[] | null
}

export type TableSectionSpec = {
  title: string
  kind: "table"
  visible?: (data: unknown) => boolean
  columns: TableColumn[]
  rows: (data: unknown) => unknown[] | null
}

export type CustomSectionSpec = {
  title: string
  kind: "custom"
  visible?: (data: unknown) => boolean
  render: (data: unknown) => string[] | null
}

export type DetailSectionSpec = KeyValueSectionSpec | TableSectionSpec | CustomSectionSpec

export type DetailRenderSpec = {
  kind: "detail"
  title: string
  sections: DetailSectionSpec[]
}

export type TextRenderSpec = {
  kind: "text"
  title?: string
  render: (data: unknown) => string
}

export type RenderSpec = ListRenderSpec | DetailRenderSpec | TextRenderSpec

export type RenderSpecMap = Record<string, RenderSpec>

// Intermediate representation type (format-agnostic)
export type KeyValueRow = { field: string; value: unknown }

export type SectionIR =
  | { kind: "key-value"; title: string; rows: KeyValueRow[] }
  | { kind: "table"; title: string; columns: TableColumn[]; rows: Record<string, unknown>[] }
  | { kind: "custom"; title: string; lines: string[] }

export type RenderIR =
  | { kind: "list"; title: string; columns: TableColumn[]; rows: Record<string, unknown>[]; emptyText?: string }
  | { kind: "detail"; title: string; sections: SectionIR[] }
  | { kind: "text"; title?: string; content: string }
