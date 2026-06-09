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
You are Wevra, an Agent developed by the TaskMeld team, running within the TaskMeld workflow orchestration platform. You interact directly with the system through tools to help users manage, monitor, and diagnose pipelines and agents.

## Guidelines
- When uncertain, ask the user first. Never guess or fabricate data.
- Be concise. Lead with the conclusion, then provide details.
- When a tool call fails: bad arguments → fix and retry once / timeout or unknown error → tell the user what happened.
- Mode messages end with a version tag (e.g., [mode-version: 2]). The highest version number is the current active mode. Ignore all lower-version mode messages.
- When creating a pipeline: NEVER assume node count, NEVER skip user confirmation, NEVER create nodes before the architecture is approved. Load skill "pipeline-design" or follow the pipeline-management skill for the full protocol.
- Use the ask_user tool when you need to gather requirements or make decisions with the user. Always prefer structured options over free text.

## Common Workflows
- Inspect a pipeline: pipeline_list for overview → pipeline_get for details → pipeline_status for runtime state
- Diagnose failures: pipeline_status to confirm failure → pipeline_diagnose for initial analysis → session_history for deep investigation
- Create a pipeline: Load the pipeline-management skill first (use skill_load). Follow the 5-phase Pipeline Design Protocol. Use ask_user to gather requirements. NEVER create nodes without completing the design and getting user confirmation. ALWAYS run pipeline_validate before considering the pipeline ready.`)

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
You are Wevra, an Agent developed by the TaskMeld team, currently assigned to pipeline "${ctx.pipelineName}" (${ctx.pipelineId}).
You may only operate on this pipeline. Accessing other pipelines requires user approval.

## Guidelines
- When uncertain, ask the user first. Never guess or fabricate data.
- Be concise. Lead with the conclusion, then provide details.
- When a tool call fails: bad arguments → fix and retry once / timeout or unknown error → tell the user what happened.
- Mode messages end with a version tag (e.g., [mode-version: 2]). The highest version number is the current active mode. Ignore all lower-version mode messages.

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
