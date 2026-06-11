import type { SkillDef } from "../types"
import type { MemoryEntry } from "../types"

const pad = (n: number) => String(n).padStart(2, "0")
const formatLocalTime = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

interface GlobalPromptContext {
  memories: MemoryEntry[]
  alwaysSkills: SkillDef[]
  skillIndex: Array<{ name: string; description: string }>
  pipelines: Array<{ id: string; name: string; description?: string }>
  scope?: ConversationScope
}

import type { ConversationScope } from "../conversation"

interface PipelinePromptContext {
  memories: MemoryEntry[]
  alwaysSkills: SkillDef[]
  skillIndex: Array<{ name: string; description: string }>
  pipelineId: string
  pipelineName: string
  pipelineDescription: string
  nodes: Array<{ id: string; name: string; description: string }>
}

export function buildGlobalPrompt(ctx: GlobalPromptContext): string {
  const sections: string[] = []

  sections.push(`## Identity

You are Wevra, the agent of TaskMeld.

## Concepts

- Pipeline — A DAG of nodes executed sequentially or in parallel.
- Blueprint — A JSON design doc that previews a pipeline as a DAG. Not a real pipeline until blueprints_apply converts it.
- Agent — The LLM-backed executor for a node. One agent per node at a time. Parallel nodes must use different agents.
- Session — The conversation an agent runs to execute a node.

## Rules

1. Before creating any pipeline resource, get user confirmation on the design.
2. Before calling pipeline_run, get explicit user command. NEVER auto-run.
3. Before pipeline_run, run pipeline_validate. It must pass.
4. New pipelines use new agents by default. Don't reuse agents from other pipelines unless the user insists.
5. Nodes with identical deps and no edge between them are parallel. They must use different agents.
6. Coder and reviewer in the same chain must be different agents.
7. Follow loaded skills exactly. If a skill says "wait," wait.
8. Never fabricate IDs. Use list/get tools to discover them.

## Anti-Patterns

- NEVER call pipeline_run without explicit user command and passing validation.
- NEVER assign the same agent to parallel nodes.
- NEVER directly modify pipeline nodes without deriving a blueprint first — unless the user names a specific node and explicitly says what to change.
- NEVER exceed 10 nodes unless the user asks for more.
- NEVER create a node with a vague instruction.`)

  sections.push(`## Environment
- Session started at: ${formatLocalTime()}`)

  if (ctx.memories.length > 0) {
    const memoryLines = ctx.memories.map((m) => `- ${m.content} (importance: ${m.importance})`).join("\n")
    sections.push(`## Global Memory\n${memoryLines}`)
  }

  if (ctx.skillIndex.length > 0) {
    const indexLines = ctx.skillIndex.map((s) => `- ${s.name}: ${s.description}`).join("\n")
    sections.push(
      `## Available Skills\n${indexLines}\n\nUse the skill_load tool to load full skill content when needed.`,
    )
  }

  return sections.join("\n\n")
}

export function buildPipelinePrompt(ctx: PipelinePromptContext): string {
  const sections: string[] = []

  sections.push(`## Identity
You are Wevra, the agent of TaskMeld assigned to pipeline "${ctx.pipelineName}" (${ctx.pipelineId}).

## Pipeline Context
- ID: ${ctx.pipelineId}
- Name: ${ctx.pipelineName}
- Description: ${ctx.pipelineDescription}
- Nodes:
${ctx.nodes.map((n) => `  - ${n.id} "${n.name}": ${n.description}`).join("\n")}`)

  sections.push(`## Environment
- Session started at: ${formatLocalTime()}`)

  if (ctx.memories.length > 0) {
    const memoryLines = ctx.memories.map((m) => `- ${m.content} (importance: ${m.importance})`).join("\n")
    sections.push(`## Pipeline Memory\n${memoryLines}`)
  }

  if (ctx.skillIndex.length > 0) {
    const indexLines = ctx.skillIndex.map((s) => `- ${s.name}: ${s.description}`).join("\n")
    sections.push(
      `## Available Skills\n${indexLines}\n\nUse the skill_load tool to load full skill content when needed.`,
    )
  }

  return sections.join("\n\n")
}
