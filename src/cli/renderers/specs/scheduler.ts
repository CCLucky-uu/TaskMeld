import type { RenderSpecMap } from "../engine/types";

import { readRecord } from "../engine/utils";

export const schedulerRenderSpecs: RenderSpecMap = {
  "scheduler.toggle": {
    kind: "detail",
    title: "Scheduler Toggle",
    sections: [
      {
        title: "Summary",
        kind: "key-value",
        rows: (data) => {
          const detail = readRecord(data);
          const scheduler = readRecord(detail.scheduler);
          return [
            { field: "OK", value: detail.ok ?? detail.OK },
            { field: "Pipeline ID", value: detail.pipelineId },
            { field: "Enabled", value: scheduler.enabled },
            { field: "Mode", value: scheduler.mode },
          ];
        },
      },
    ],
  },
  "scheduler.mode": {
    kind: "detail",
    title: "Scheduler Mode",
    sections: [
      {
        title: "Summary",
        kind: "key-value",
        rows: (data) => {
          const detail = readRecord(data);
          const scheduler = readRecord(detail.scheduler);
          return [
            { field: "OK", value: detail.ok ?? detail.OK },
            { field: "Pipeline ID", value: detail.pipelineId },
            { field: "Enabled", value: scheduler.enabled },
            { field: "Mode", value: scheduler.mode },
          ];
        },
      },
    ],
  },
};
