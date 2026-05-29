import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { OutputSpec } from "../template";
import { detectFenceLanguage, toPromptContentText } from "./parser";
import { isRecord } from "../../utils/guards";
import {
  type DependencyArtifactInput,
  type ExternalPipelineArtifactInput,
  type ContractViolationCode,
} from "./contract";
import type { PipelineOutput } from "../types/pipeline-output";

const MAINLINE_ROUTE_VALUE = "yes";

type ArtifactManifestLike = {
  type: string;
  schemaVersion: number;
  name: string;
  path: string;
  hash: string;
  createdAt: string;
};

type NodeRunForDependency = {
  id: string;
  title: string;
  executor: {
    agentId: string;
  };
  dependsOn: string[];
  artifacts: ArtifactManifestLike[];
};

type RunForDependency = {
  nodes: NodeRunForDependency[];
  itemRuns?: Array<{
    nodeId: string;
    itemKey: string;
    route: string | null;
    artifacts: ArtifactManifestLike[];
  }>;
  groups?: Array<{
    id: string;
    title: string;
    artifacts: ArtifactManifestLike[];
  }>;
  groupItemRuns?: Array<{
    groupId: string;
    itemKey: string;
    artifacts: ArtifactManifestLike[];
  }>;
};

export const buildDependencyArtifactInputs = async (
  run: RunForDependency,
  node: NodeRunForDependency,
  itemKey?: string,
  dependencyIds?: string[],
): Promise<DependencyArtifactInput[]> => {
  const inputs: DependencyArtifactInput[] = [];
  const effectiveDependencyIds = dependencyIds?.length ? dependencyIds : node.dependsOn;
  for (const depId of effectiveDependencyIds) {
    const depNode = run.nodes.find((n) => n.id === depId);
    const depGroup = run.groups?.find((g) => g.id === depId);
    const depItem = itemKey ? run.itemRuns?.find((item) => item.nodeId === depId && item.itemKey === itemKey) : null;
    const depGroupItem = itemKey ? run.groupItemRuns?.find((item) => item.groupId === depId && item.itemKey === itemKey) : null;
    const depSource = depNode
      ? {
          id: depNode.id,
          title: depNode.title,
          agentId: depNode.executor.agentId,
          artifacts: depItem?.artifacts?.length ? depItem.artifacts : depNode.artifacts,
          route: depItem?.route ?? null,
        }
      : depGroup
        ? {
            id: depGroup.id,
            title: depGroup.title,
            agentId: depGroup.id,
            artifacts: depGroupItem?.artifacts?.length ? depGroupItem.artifacts : depGroup.artifacts,
            route: null,
          }
        : null;
    if (!depSource || depSource.artifacts.length === 0) continue;

    const loaded = await Promise.all(
      depSource.artifacts.map(async (manifest): Promise<DependencyArtifactInput | null> => {
        try {
          const raw = await readFile(manifest.path, "utf8");
          const parsed = JSON.parse(raw) as unknown;
          const obj = isRecord(parsed) ? parsed : null;
          const artifact = obj && isRecord(obj.artifact) ? obj.artifact : null;
          const rawContent = artifact ? (artifact.content as unknown) : raw;
          const content =
            depSource.route &&
            Array.isArray(rawContent) &&
            rawContent.some((entry) => isRecord(entry) && typeof entry.route === "string")
              ? rawContent.filter(
                  (entry) => isRecord(entry) && typeof entry.route === "string" && entry.route.trim() === depSource.route,
                )
              : rawContent;
          const meta = isRecord(artifact?.meta) ? artifact.meta : undefined;
          return {
            sourceNodeId: depSource.id,
            sourceNodeTitle: depSource.title,
            sourceAgentId: depSource.agentId,
            type: manifest.type,
            schemaVersion: manifest.schemaVersion,
            name: manifest.name,
            path: manifest.path,
            hash: manifest.hash,
            createdAt: manifest.createdAt,
            content: toPromptContentText(content),
            meta,
          };
        } catch {
          return {
            sourceNodeId: depSource.id,
            sourceNodeTitle: depSource.title,
            sourceAgentId: depSource.agentId,
            type: manifest.type,
            schemaVersion: manifest.schemaVersion,
            name: manifest.name,
            path: manifest.path,
            hash: manifest.hash,
            createdAt: manifest.createdAt,
            content: "[artifact_read_failed]",
          };
        }
      }),
    );
    for (const item of loaded) {
      if (item) inputs.push(item);
    }
  }
  return inputs;
};

export const createNodeExecutionPrompt = (ctx: {
  runId: string;
  nodeId: string;
  nodeTitle: string;
  requestId: string;
  sessionId: string;
  dependencies: string[];
  dependencyArtifacts: DependencyArtifactInput[];
  externalPipelineArtifact?: ExternalPipelineArtifactInput | null;
  outputSpec: OutputSpec;
  instruction: string;
  allowReject: boolean;
  maxRejectCount: number;
  rejectFeedbacks: string[];
  allowedRoutes: string[];
  routeTargets: Array<{ route: string; targetNodeId: string; targetNodeTitle: string; targetAgentId: string; lane: string }>;
}): string => {
  const spec = ctx.outputSpec;
  const isRouteNode = ctx.allowedRoutes.length > 0;
  const groupedDependencies = (() => {
    const grouped = new Map<
      string,
      { sourceNodeId: string; sourceNodeTitle: string; sourceAgentId: string; contents: string[] }
    >();
    for (const artifact of ctx.dependencyArtifacts) {
      const key = `${artifact.sourceNodeId}|${artifact.sourceAgentId}`;
      const current = grouped.get(key);
      if (current) {
        current.contents.push(artifact.content);
        continue;
      }
      grouped.set(key, {
        sourceNodeId: artifact.sourceNodeId,
        sourceNodeTitle: artifact.sourceNodeTitle,
        sourceAgentId: artifact.sourceAgentId,
        contents: [artifact.content],
      });
    }
    return Array.from(grouped.values());
  })();
  const lines = [
    "# 流水线节点执行指令",
    "",
    "## 输出要求",
    "- 只能返回一个合法 JSON 对象（ResultEnvelope）。",
    "- 不要输出任何额外解释、前后缀、Markdown 之外的文本。",
    "- `status=success` 时，`artifacts` 必须至少 1 条。",
    "- `artifacts[].content` 支持任意 JSON 值（例如：`\"text\"`、`{\"k\":\"v\"}`、`[{\"k\":\"v1\"},{\"k\":\"v2\"}]`）。",
    ...(isRouteNode ? ["- 分流节点的 `artifacts[0].content` 必须是数组，数组内每个对象都要包含 `route` 字段。"] : []),
    "",
    "## ResultEnvelope 固定字段",
    `- version: \`2.0\``,
    `- runId: \`${ctx.runId}\``,
    `- nodeId: \`${ctx.nodeId}\``,
    `- requestId: \`${ctx.requestId}\``,
    `- sessionId: \`${ctx.sessionId}\``,
    "- status: `success | failed`",
    "- artifacts: `array`",
    "",
    "## 节点上下文",
    `- 当前节点: \`${ctx.nodeId}\`（${ctx.nodeTitle}）`,
    `- 依赖节点: ${ctx.dependencies.length > 0 ? ctx.dependencies.map((id) => `\`${id}\``).join(", ") : "`none`"}`,
  ];
  lines.push(
    "",
    "## 产物规格",
    `- type: \`${spec.type}\``,
    `- schemaVersion: \`${spec.schemaVersion}\``,
  );
  // 仅在节点明确开启分流时，才注入分流相关说明，避免无配置时污染提示词。
  if (ctx.allowedRoutes.length > 0) {
    lines.push(
      "",
      "## 分流规则",
      `- 允许的 route 仅能是: ${ctx.allowedRoutes.map((route) => `\`${route}\``).join(", ")}`,
      `- \`${MAINLINE_ROUTE_VALUE}\` 表示继续主线，不需要配置分流目标。`,
      "- `artifacts[0].content` 必须输出为数组。",
      "- 数组中的每个对象都必须包含 `route` 字段。",
      "- 每个对象的 `route` 必须命中上述取值。",
      "- 系统会按 `content[*].route` 自动分组、汇总并推送到对应分支。",
    );
    if (ctx.routeTargets.length > 0) {
      lines.push("- 当前配置的 route 目标如下:");
      for (const target of ctx.routeTargets) {
        lines.push(`  - \`${target.route}\` -> \`${target.targetNodeId}\` (${target.targetNodeTitle}, agent:${target.targetAgentId}, lane:${target.lane})`);
      }
    }
  }
  // 仅在节点明确开启打回且存在上游依赖时，才注入打回相关说明，避免无配置时污染提示词。
  if (ctx.allowReject && ctx.dependencies.length > 0) {
    lines.push(
      "",
      "## 打回配置",
      `- allowReject: \`${ctx.allowReject ? "true" : "false"}\``,
      `- maxRejectCount: \`${ctx.maxRejectCount}\``,
      "",
      "### 打回规则",
      "- 仅当上游内容不符合你的校验规范时，才允许打回。",
      "- 打回时必须返回 `status=failed`，且 `error.code=upstream_reject`。",
      "- 如需指定目标上游，可提供 `error.targets=[\"nodeId\"]`。",
      "- 不提供 `targets` 时，系统默认打回上一个直接上游节点。",
      "",
      "```json",
      "{\"code\":\"upstream_reject\",\"message\":\"打回原因\"}",
      "```",
    );
  }
  if (isRouteNode) {
    lines.push(
      "",
      "## 分流节点 JSON 示例",
      "```json",
      JSON.stringify(
        {
          version: "2.0",
          runId: "__RUN_ID__",
          nodeId: "__NODE_ID__",
          requestId: "__REQUEST_ID__",
          sessionId: "__SESSION_ID__",
          status: "success",
          artifacts: [
            {
              type: "__TYPE__",
              schemaVersion: 1,
              name: "primary",
              content: [
                { label: "A", route: "yes", value: "..." },
                { label: "B", route: "holo", value: "..." },
                { label: "C", route: "no", value: "..." },
              ],
              meta: {},
            },
          ],
          control: {
            sleepUntil: null,
            retryFromNodeId: null,
          },
          logs: [],
          error: null,
        },
        null,
        2,
      ),
      "```",
    );
  } else {
    lines.push(
      "",
      "## JSON 输出示例",
      "```json",
      JSON.stringify(
        {
          version: "2.0",
          runId: "__RUN_ID__",
          nodeId: "__NODE_ID__",
          requestId: "__REQUEST_ID__",
          sessionId: "__SESSION_ID__",
          status: "success",
          artifacts: [
            {
              type: "__TYPE__",
              schemaVersion: 1,
              name: "primary",
              content: "artifact content",
              meta: {},
            },
          ],
          control: {
            sleepUntil: null,
            retryFromNodeId: null,
          },
          logs: [],
          error: null,
        },
        null,
        2,
      ),
      "```",
    );
  }
  lines.push("");
  // External pipeline upstream artifact — injected before internal dependency artifacts
  if (ctx.externalPipelineArtifact) {
    const artifact = ctx.externalPipelineArtifact;
    const fence = detectFenceLanguage(artifact.content);
    lines.push(
      "## 外部流水线上游产物",
      "",
      `来源: 流水线 ${artifact.sourcePipelineId} 的最终输出`,
      "",
      "内容:",
      `\`\`\`${fence}`,
      artifact.content,
      "```",
    );
  }
  if (groupedDependencies.length > 0) {
    lines.push("## 上游输输出结构：");
    for (const dep of groupedDependencies) {
      const merged = dep.contents.join("\n");
      const fence = detectFenceLanguage(merged);
      lines.push(
        `### 节点 \`${dep.sourceNodeId}\`（${dep.sourceNodeTitle}）- agent \`${dep.sourceAgentId}\``,
        `\`\`\`${fence}`,
        merged,
        "```",
      );
    }
    lines.push("");
  }
  // 节点目标是执行 prompt 的核心约束，不能因为存在打回反馈或分流说明而被覆盖掉。
  // 这里固定保留“节点目标”段，再额外追加反馈，避免分流节点提示词缺少主任务目标。
  lines.push("## 节点目标", ctx.instruction || "请按节点职责完成任务");
  if (ctx.rejectFeedbacks.length > 0) {
    lines.push("", "## 下游打回反馈（请优先修正）");
    for (const item of ctx.rejectFeedbacks) {
      lines.push(`- ${item}`);
    }
  }
  return lines.join("\n");
};

export const createNodeCorrectionPrompt = (
  ctx: {
    runId: string;
    nodeId: string;
    nodeTitle: string;
    requestId: string;
    sessionId: string;
    dependencies: string[];
    dependencyArtifacts: DependencyArtifactInput[];
    externalPipelineArtifact?: ExternalPipelineArtifactInput | null;
    outputSpec: OutputSpec;
    instruction: string;
    allowReject: boolean;
    maxRejectCount: number;
    rejectFeedbacks: string[];
    allowedRoutes?: string[];
  },
  lastViolation: ContractViolationCode,
): string =>
  [
    `结构校验未通过，错误码: ${lastViolation}`,
    "请严格基于本次请求的固定字段重发完整 ResultEnvelope，不要沿用旧请求的顶层字段。",
    `固定字段必须为: version="2.0", runId="${ctx.runId}", nodeId="${ctx.nodeId}", requestId="${ctx.requestId}", sessionId="${ctx.sessionId}"`,
    `产物规格必须为: type="${ctx.outputSpec.type}", schemaVersion=${ctx.outputSpec.schemaVersion}`,
    ctx.allowedRoutes && ctx.allowedRoutes.length > 0
      ? `这是分流节点。允许的 route 只有: ${ctx.allowedRoutes.map((route) => `"${route}"`).join(", ")}。请把 route 写进 artifacts[0].content 的每个对象里。`
      : ctx.externalPipelineArtifact
        ? `本次请求包含来自流水线 ${ctx.externalPipelineArtifact.sourcePipelineId} 的外部上游产物。请继续基于该上游产物修正。`
        : "请按当前结构输出结果。",
    "请先把完整 ResultEnvelope 保存为当前工作目录下的 result.json，然后自行运行下面的校验命令，确认 JSON valid 后再继续：",
    "```bash",
    "cat result.json | python3 -m json.tool > /dev/null && echo \"JSON valid\" || echo \"JSON invalid\"",
    "```",
    "如果校验结果不是 JSON valid，请继续修正 result.json，直到通过为止。",
    "必须输出完整 JSON 对象，不要只输出 artifacts 片段。",
    "只输出修正后的合法 JSON ResultEnvelope，不要输出任何解释。",
  ].join("\n");

export const buildExternalPipelineArtifactInput = async (
  output: PipelineOutput,
): Promise<ExternalPipelineArtifactInput | null> => {
  try {
    const { absolutePath } = output.artifactRef;
    // Verify path is within artifact directory (basic path traversal check)
    const normalizedPath = resolve(absolutePath);
    if (!normalizedPath) return null;

    const raw = await readFile(normalizedPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const obj = isRecord(parsed) ? parsed : null;
    if (!obj) return null;

    const artifact = isRecord(obj.artifact) ? obj.artifact : null;
    if (!artifact) return null;

    // Verify hash
    const fileHash = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
    if (fileHash !== output.artifactRef.hash) return null;

    const content = toPromptContentText(artifact.content);
    const meta = isRecord(artifact.meta) ? artifact.meta : undefined;

    return {
      sourceKind: "pipeline_output",
      sourcePipelineId: output.pipelineId,
      sourceRunId: output.runId,
      sourceBatchRunId: output.batchRunId,
      sourceOutputId: output.outputId,
      sourceOutputNodeId: output.outputNodeId,
      sourceArtifactId: output.artifactId,
      sourceArtifactHash: output.artifactRef.hash,
      type: output.artifactRef.type,
      schemaVersion: output.artifactRef.schemaVersion,
      name: output.artifactRef.name,
      path: normalizedPath,
      createdAt: output.producedAt,
      content,
      meta,
    };
  } catch {
    return null;
  }
};
