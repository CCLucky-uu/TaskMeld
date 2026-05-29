import type { RenderSpecMap } from "../engine/types";
import { agentRenderSpecs } from "./agent";
import { artifactRenderSpecs } from "./artifact";
import { initRenderSpecs } from "./init";
import { pipelineRenderSpecs } from "./pipeline";
import { schedulerRenderSpecs } from "./scheduler";
import { serverRenderSpecs } from "./server";
import { systemRenderSpecs } from "./system";

// 按模块聚合输出定义，避免继续把所有结构堆回单一 renderer 文件。
const allSpecs: RenderSpecMap = {
  ...agentRenderSpecs,
  ...artifactRenderSpecs,
  ...initRenderSpecs,
  ...pipelineRenderSpecs,
  ...schedulerRenderSpecs,
  ...serverRenderSpecs,
  ...systemRenderSpecs,
};

if (process.env.NODE_ENV !== "production") {
  const keys = [
    ...Object.keys(agentRenderSpecs),
    ...Object.keys(artifactRenderSpecs),
    ...Object.keys(initRenderSpecs),
    ...Object.keys(pipelineRenderSpecs),
    ...Object.keys(schedulerRenderSpecs),
    ...Object.keys(serverRenderSpecs),
    ...Object.keys(systemRenderSpecs),
  ];
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dupes.length > 0) {
    throw new Error(`Duplicate render spec keys: ${dupes.join(", ")}`);
  }
}

export const commandRenderSpecs = allSpecs;
