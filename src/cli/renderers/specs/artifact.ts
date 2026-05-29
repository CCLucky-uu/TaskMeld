import type { RenderSpecMap } from "../engine/types";

export const artifactRenderSpecs: RenderSpecMap = {
  "artifact.list": {
    kind: "list",
    title: "Artifact List",
    emptyText: "(none)",
    columns: [
      {
        title: "Artifact ID",
        render: (row) => row.id ?? row.artifactId ?? "-",
      },
      {
        title: "Pipeline ID",
        render: (row) => row.pipelineId ?? "-",
      },
      {
        title: "Node ID",
        render: (row) => row.nodeId ?? "-",
      },
      {
        title: "Type",
        render: (row) => row.type ?? "-",
      },
      {
        title: "Created At",
        render: (row) => row.createdAt ?? "-",
      },
    ],
  },
};
