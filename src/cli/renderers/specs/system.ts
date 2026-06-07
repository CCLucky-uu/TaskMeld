import type { RenderSpecMap } from "../engine/types"

import { asArray, pickText, readRecord } from "../engine/utils"

export const systemRenderSpecs: RenderSpecMap = {
  "system.snapshot": {
    kind: "detail",
    title: "System Snapshot",
    sections: [
      {
        title: "Summary",
        kind: "key-value",
        rows: (data) => {
          const snapshot = readRecord(data)
          const pipelines = asArray(snapshot.pipelines)
          return [
            { field: "Generated At", value: pickText(snapshot.generatedAt) },
            { field: "Pipeline Count", value: pipelines.length },
          ]
        },
      },
      {
        title: "Pipelines",
        kind: "table",
        columns: [
          { title: "ID", render: (r) => r.id ?? r.pipelineId ?? "-" },
          { title: "Title", render: (r) => r.title ?? r.name ?? "-" },
        ],
        rows: (data) => {
          const snapshot = readRecord(data)
          return asArray(snapshot.pipelines)
        },
      },
    ],
  },
}
