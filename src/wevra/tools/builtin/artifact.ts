import type { Tool } from "../../types"
import type { ArtifactService } from "../../../services/artifact-service"

export function createArtifactTools(artifact?: ArtifactService): Tool[] {
  return [
    {
      name: "artifact_list",
      description: "List artifacts produced by a pipeline run. Artifacts are structured outputs from each node.",
      parameters: {
        type: "object",
        properties: {
          pipelineId: { type: "string", description: "The pipeline ID" },
          runId: { type: "string", description: "Optional specific run ID" },
          limit: { type: "number", description: "Max results, default 20", default: 20 },
        },
        required: ["pipelineId"],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute(args) {
        if (!artifact) return { output: "Artifact service not available.", isError: true }
        const { pipelineId, runId, limit } = args as { pipelineId: string; runId?: string; limit?: number }
        try {
          const result = await artifact.listArtifacts({
            pipelineIds: [pipelineId],
            runId: runId ?? undefined,
            limit: limit ?? 20,
          })
          if (result.items.length === 0)
            return { output: `No artifacts found for pipeline "${pipelineId}".`, isError: false }
          return {
            output: JSON.stringify(
              {
                total: result.items.length,
                nextCursor: result.nextCursor,
                items: result.items.map((a) => ({
                  artifactId: a.artifactId,
                  nodeId: a.nodeId,
                  status: a.status,
                  fileName: a.fileName,
                  sizeBytes: a.sizeBytes,
                  updatedAt: a.updatedAt,
                })),
              },
              null,
              2,
            ),
            isError: false,
          }
        } catch (err) {
          return {
            output: `Failed to list artifacts: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
      },
    },
    {
      name: "artifact_get",
      description: "Read the content of a specific artifact by its relative path.",
      parameters: {
        type: "object",
        properties: {
          pipelineId: { type: "string", description: "The pipeline ID" },
          relativePath: { type: "string", description: "The artifact relative path (from artifact_list)" },
        },
        required: ["pipelineId", "relativePath"],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute(args) {
        if (!artifact) return { output: "Artifact service not available.", isError: true }
        const { pipelineId, relativePath } = args as { pipelineId: string; relativePath: string }
        try {
          const result = await artifact.getArtifactContent({ pipelineId, relativePath })
          if (!result) return { output: `Artifact not found: ${relativePath}`, isError: true }

          const content = result.content
          // Try to extract the most useful representation
          let display: unknown
          if (content && typeof content === "object" && "content" in content) {
            display = (content as any).content
          } else if (content && typeof content === "object" && "parsed" in content && (content as any).parsed) {
            display = (content as any).parsed
          } else {
            display = content
          }

          const text = typeof display === "string" ? display : JSON.stringify(display, null, 2)
          return {
            output: text.length > 15000 ? text.slice(0, 15000) + "\n\n[... truncated]" : text,
            isError: false,
          }
        } catch (err) {
          return {
            output: `Failed to read artifact: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
      },
    },
  ]
}
