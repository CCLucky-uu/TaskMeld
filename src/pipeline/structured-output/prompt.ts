import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { join, resolve } from "node:path"
import type { OutputSpec } from "../template"
import { detectFenceLanguage, toPromptContentText } from "./parser"
import { isRecord } from "../../utils/guards"
import {
  type DependencyArtifactInput,
  type ExternalPipelineArtifactInput,
  type ContractViolationCode,
} from "./contract"
import type { PipelineOutput } from "../types/pipeline-output"

const MAINLINE_ROUTE_VALUE = "yes"

type ArtifactManifestLike = {
  type: string
  schemaVersion: number
  name: string
  path: string
  hash: string
  createdAt: string
}

type NodeRunForDependency = {
  id: string
  title: string
  executor: {
    agentId: string
  }
  dependsOn: string[]
  artifacts: ArtifactManifestLike[]
}

type RunForDependency = {
  nodes: NodeRunForDependency[]
  itemRuns?: Array<{
    nodeId: string
    itemKey: string
    route: string | null
    artifacts: ArtifactManifestLike[]
  }>
  groups?: Array<{
    id: string
    title: string
    artifacts: ArtifactManifestLike[]
  }>
  groupItemRuns?: Array<{
    groupId: string
    itemKey: string
    artifacts: ArtifactManifestLike[]
  }>
}

export const buildDependencyArtifactInputs = async (
  run: RunForDependency,
  node: NodeRunForDependency,
  itemKey?: string,
  dependencyIds?: string[],
): Promise<DependencyArtifactInput[]> => {
  const inputs: DependencyArtifactInput[] = []
  const effectiveDependencyIds = dependencyIds?.length ? dependencyIds : node.dependsOn
  for (const depId of effectiveDependencyIds) {
    const depNode = run.nodes.find((n) => n.id === depId)
    const depGroup = run.groups?.find((g) => g.id === depId)
    const depItem = itemKey ? run.itemRuns?.find((item) => item.nodeId === depId && item.itemKey === itemKey) : null
    const depGroupItem = itemKey
      ? run.groupItemRuns?.find((item) => item.groupId === depId && item.itemKey === itemKey)
      : null
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
        : null
    if (!depSource || depSource.artifacts.length === 0) continue

    const loaded = await Promise.all(
      depSource.artifacts.map(async (manifest): Promise<DependencyArtifactInput | null> => {
        try {
          const raw = await readFile(manifest.path, "utf8")
          const parsed = JSON.parse(raw) as unknown
          const obj = isRecord(parsed) ? parsed : null
          const artifact = obj && isRecord(obj.artifact) ? obj.artifact : null
          const rawContent = artifact ? (artifact.content as unknown) : raw
          const content =
            depSource.route &&
            Array.isArray(rawContent) &&
            rawContent.some((entry) => isRecord(entry) && typeof entry.route === "string")
              ? rawContent.filter(
                  (entry) =>
                    isRecord(entry) && typeof entry.route === "string" && entry.route.trim() === depSource.route,
                )
              : rawContent
          const meta = isRecord(artifact?.meta) ? artifact.meta : undefined
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
          }
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
          }
        }
      }),
    )
    for (const item of loaded) {
      if (item) inputs.push(item)
    }
  }
  return inputs
}

export const createNodeExecutionPrompt = (ctx: {
  runId: string
  nodeId: string
  nodeTitle: string
  requestId: string
  sessionId: string
  dependencies: string[]
  dependencyArtifacts: DependencyArtifactInput[]
  externalPipelineArtifact?: ExternalPipelineArtifactInput | null
  outputSpec: OutputSpec
  instruction: string
  allowReject: boolean
  maxRejectCount: number
  rejectFeedbacks: string[]
  allowedRoutes: string[]
  routeTargets: Array<{
    route: string
    targetNodeId: string
    targetNodeTitle: string
    targetAgentId: string
    lane: string
  }>
}): string => {
  const spec = ctx.outputSpec
  const isRouteNode = ctx.allowedRoutes.length > 0
  const groupedDependencies = (() => {
    const grouped = new Map<
      string,
      { sourceNodeId: string; sourceNodeTitle: string; sourceAgentId: string; contents: string[] }
    >()
    for (const artifact of ctx.dependencyArtifacts) {
      const key = `${artifact.sourceNodeId}|${artifact.sourceAgentId}`
      const current = grouped.get(key)
      if (current) {
        current.contents.push(artifact.content)
        continue
      }
      grouped.set(key, {
        sourceNodeId: artifact.sourceNodeId,
        sourceNodeTitle: artifact.sourceNodeTitle,
        sourceAgentId: artifact.sourceAgentId,
        contents: [artifact.content],
      })
    }
    return Array.from(grouped.values())
  })()
  const lines = [
    "# Pipeline Node Execution Instructions",
    "",
    "## Output Requirements",
    "- Return only a valid JSON object (ResultEnvelope).",
    "- Do not output any extra explanations, prefixes, suffixes, or text outside of Markdown.",
    "- When `status=success`, `artifacts` must contain at least 1 item.",
    '- `artifacts[].content` accepts any JSON value (e.g., `"text"`, `{"k":"v"}`, `[{"k":"v1"},{"k":"v2"}]`).',
    ...(isRouteNode
      ? [
          "- For routing nodes, `artifacts[0].content` must be an array, and each object in the array must include a `route` field.",
        ]
      : []),
    "",
    "## ResultEnvelope Fixed Fields",
    `- version: \`2.0\``,
    `- runId: \`${ctx.runId}\``,
    `- nodeId: \`${ctx.nodeId}\``,
    `- requestId: \`${ctx.requestId}\``,
    `- sessionId: \`${ctx.sessionId}\``,
    "- status: `success | failed`",
    "- artifacts: `array`",
    "",
    "## Node Context",
    `- Current node: \`${ctx.nodeId}\` (${ctx.nodeTitle})`,
    `- Dependencies: ${ctx.dependencies.length > 0 ? ctx.dependencies.map((id) => `\`${id}\``).join(", ") : "`none`"}`,
  ]
  lines.push("", "## Artifact Specification", `- type: \`${spec.type}\``, `- schemaVersion: \`${spec.schemaVersion}\``)
  // Only inject routing instructions when the node explicitly enables routing, to avoid polluting the prompt when no routing is configured.
  if (ctx.allowedRoutes.length > 0) {
    lines.push(
      "",
      "## Routing Rules",
      `- Allowed routes are: ${ctx.allowedRoutes.map((route) => `\`${route}\``).join(", ")}`,
      `- \`${MAINLINE_ROUTE_VALUE}\` indicates continuing on the mainline; no routing target configuration needed.`,
      "- `artifacts[0].content` must be an array.",
      "- Each object in the array must include a `route` field.",
      "- Each object's `route` must match one of the allowed values above.",
      "- The system will automatically group and dispatch items by `content[*].route` to the corresponding branches.",
    )
    if (ctx.routeTargets.length > 0) {
      lines.push("- The configured route targets are:")
      for (const target of ctx.routeTargets) {
        lines.push(
          `  - \`${target.route}\` -> \`${target.targetNodeId}\` (${target.targetNodeTitle}, agent:${target.targetAgentId}, lane:${target.lane})`,
        )
      }
    }
  }
  // Only inject rejection instructions when the node explicitly enables rejection and has upstream dependencies, to avoid polluting the prompt when no rejection is configured.
  if (ctx.allowReject && ctx.dependencies.length > 0) {
    lines.push(
      "",
      "## Rejection Configuration",
      `- allowReject: \`${ctx.allowReject ? "true" : "false"}\``,
      `- maxRejectCount: \`${ctx.maxRejectCount}\``,
      "",
      "### Rejection Rules",
      "- Rejection is only allowed when upstream content does not meet your validation criteria.",
      "- When rejecting, you must return `status=failed` with `error.code=upstream_reject`.",
      '- To specify target upstream nodes, provide `error.targets=["nodeId"]`.',
      "- When `targets` is not provided, the system defaults to rejecting the most recent direct upstream node.",
      "",
      "```json",
      '{"code":"upstream_reject","message":"rejection reason"}',
      "```",
    )
  }
  if (isRouteNode) {
    lines.push(
      "",
      "## Routing Node JSON Example",
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
    )
  } else {
    lines.push(
      "",
      "## JSON Output Example",
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
    )
  }
  lines.push("")
  // External pipeline upstream artifact — injected before internal dependency artifacts
  if (ctx.externalPipelineArtifact) {
    const artifact = ctx.externalPipelineArtifact
    const fence = detectFenceLanguage(artifact.content)
    lines.push(
      "## External Pipeline Upstream Artifacts",
      "",
      `Source: final output of pipeline ${artifact.sourcePipelineId}`,
      "",
      "Content:",
      `\`\`\`${fence}`,
      artifact.content,
      "```",
    )
  }
  if (groupedDependencies.length > 0) {
    lines.push("## Upstream Output Structure:")
    for (const dep of groupedDependencies) {
      const merged = dep.contents.join("\n")
      const fence = detectFenceLanguage(merged)
      lines.push(
        `### Node \`${dep.sourceNodeId}\` (${dep.sourceNodeTitle}) - agent \`${dep.sourceAgentId}\``,
        `\`\`\`${fence}`,
        merged,
        "```",
      )
    }
    lines.push("")
  }
  // The node objective is the core constraint of the execution prompt and must not be overwritten by rejection feedback or routing instructions.
  // Always keep the "Node Objective" section here, then append feedback separately, to avoid routing-node prompts missing the main task objective.
  lines.push("## Node Objective", ctx.instruction || "Complete the task according to the node's responsibilities")
  if (ctx.rejectFeedbacks.length > 0) {
    lines.push("", "## Downstream Rejection Feedback (please prioritize fixes)")
    for (const item of ctx.rejectFeedbacks) {
      lines.push(`- ${item}`)
    }
  }
  return lines.join("\n")
}

export const createNodeCorrectionPrompt = (
  ctx: {
    runId: string
    nodeId: string
    nodeTitle: string
    requestId: string
    sessionId: string
    dependencies: string[]
    dependencyArtifacts: DependencyArtifactInput[]
    externalPipelineArtifact?: ExternalPipelineArtifactInput | null
    outputSpec: OutputSpec
    instruction: string
    allowReject: boolean
    maxRejectCount: number
    rejectFeedbacks: string[]
    allowedRoutes?: string[]
  },
  lastViolation: ContractViolationCode,
): string =>
  [
    `Structural validation failed, error code: ${lastViolation}`,
    "Resend a complete ResultEnvelope strictly based on the fixed fields of this request. Do not reuse top-level fields from previous requests.",
    `Fixed fields must be: version="2.0", runId="${ctx.runId}", nodeId="${ctx.nodeId}", requestId="${ctx.requestId}", sessionId="${ctx.sessionId}"`,
    `Artifact specification must be: type="${ctx.outputSpec.type}", schemaVersion=${ctx.outputSpec.schemaVersion}`,
    ctx.allowedRoutes && ctx.allowedRoutes.length > 0
      ? `This is a routing node. The only allowed routes are: ${ctx.allowedRoutes.map((route) => `"${route}"`).join(", ")}. Include the route field in each object within artifacts[0].content.`
      : ctx.externalPipelineArtifact
        ? `This request contains an external upstream artifact from pipeline ${ctx.externalPipelineArtifact.sourcePipelineId}. Continue corrections based on this upstream artifact.`
        : "Output the result in the current structure.",
    "First save the complete ResultEnvelope as result.json in the current working directory, then run the following validation command and confirm JSON valid before continuing:",
    "```bash",
    'cat result.json | python3 -m json.tool > /dev/null && echo "JSON valid" || echo "JSON invalid"',
    "```",
    "If the validation result is not JSON valid, continue fixing result.json until it passes.",
    "You must output the complete JSON object, not just the artifacts fragment.",
    "Output only the corrected valid JSON ResultEnvelope. Do not output any explanations.",
  ].join("\n")

export const buildExternalPipelineArtifactInput = async (
  output: PipelineOutput,
): Promise<ExternalPipelineArtifactInput | null> => {
  try {
    const { absolutePath } = output.artifactRef
    // Normalize path to resolve relative segments (e.g. '..', '.')
    const normalizedPath = resolve(absolutePath)
    if (!normalizedPath) return null

    const raw = await readFile(normalizedPath, "utf8")
    const parsed = JSON.parse(raw) as unknown
    const obj = isRecord(parsed) ? parsed : null
    if (!obj) return null

    const artifact = isRecord(obj.artifact) ? obj.artifact : null
    if (!artifact) return null

    // Verify hash
    const fileHash = `sha256:${createHash("sha256").update(raw).digest("hex")}`
    if (fileHash !== output.artifactRef.hash) return null

    const content = toPromptContentText(artifact.content)
    const meta = isRecord(artifact.meta) ? artifact.meta : undefined

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
    }
  } catch {
    return null
  }
}
