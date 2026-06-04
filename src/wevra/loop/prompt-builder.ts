import type { SkillDef } from '../types'
import type { MemoryEntry } from '../types'

interface GlobalPromptContext {
  memories: MemoryEntry[]
  alwaysSkills: SkillDef[]
  skillIndex: Array<{ name: string; description: string }>
  pipelines: Array<{ id: string; name: string; description?: string }>
  scope?: ConversationScope
}

import type { ConversationScope } from '../conversation'

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

  // Identity
  sections.push(`## Identity
你是 Wevra，TaskMeld 内置的 AI 助手。你帮助用户管理 pipeline、agent 和工作流。使用中文回复。`)

  // 全局记忆
  if (ctx.memories.length > 0) {
    const memoryLines = ctx.memories.map(m =>
      `- ${m.content} (重要性: ${m.importance})`,
    ).join('\n')
    sections.push(`## Global Memory\n${memoryLines}`)
  }

  // Pipeline 摘要列表
  if (ctx.pipelines.length > 0) {
    const pipelineLines = ctx.pipelines.map(p =>
      `- ${p.id}: "${p.name}"${p.description ? ` — ${p.description}` : ''}`,
    ).join('\n')
    sections.push(`## Pipelines\n${pipelineLines}`)
  }

  // Skills（always-active 的完整内容）
  for (const skill of ctx.alwaysSkills) {
    sections.push(`## ${skill.name}\n${skill.content}`)
  }

  // Skill 索引（Layer 1）
  if (ctx.skillIndex.length > 0) {
    const indexLines = ctx.skillIndex.map(s =>
      `- ${s.name}: ${s.description}`,
    ).join('\n')
    sections.push(`## Available Skills\n${indexLines}\n\n使用 skill.load 工具加载完整 Skill 内容。`)
  }

  // Constraints
  sections.push(`## Constraints
- 不确定时问用户，不要猜测
- 破坏性操作前先确认
- 工具调用失败时先分析原因再重试`)

  return sections.join('\n\n')
}

export function buildPipelinePrompt(ctx: PipelinePromptContext): string {
  const sections: string[] = []

  // Identity
  sections.push(`## Identity
你是 Wevra，当前处于流水线 "${ctx.pipelineName}" (${ctx.pipelineId}) 的专属会话中。
你只能操作该流水线。操作其他流水线需要用户确认。使用中文回复。`)

  // 流水线记忆
  if (ctx.memories.length > 0) {
    const memoryLines = ctx.memories.map(m =>
      `- ${m.content} (重要性: ${m.importance})`,
    ).join('\n')
    sections.push(`## Pipeline Memory\n${memoryLines}`)
  }

  // 流水线节点详情
  const nodeLines = ctx.nodes.map(n =>
    `- ${n.id} "${n.name}": ${n.description}`,
  ).join('\n')
  sections.push(`## Pipeline Context
Pipeline: "${ctx.pipelineName}"
Description: ${ctx.pipelineDescription}
Nodes:
${nodeLines}`)

  // Skills
  for (const skill of ctx.alwaysSkills) {
    sections.push(`## ${skill.name}\n${skill.content}`)
  }

  if (ctx.skillIndex.length > 0) {
    const indexLines = ctx.skillIndex.map(s =>
      `- ${s.name}: ${s.description}`,
    ).join('\n')
    sections.push(`## Available Skills\n${indexLines}\n\n使用 skill.load 工具加载完整 Skill 内容。`)
  }

  // Permissions
  sections.push(`## Permissions
当前会话仅可操作 pipeline "${ctx.pipelineId}"。
操作其他 pipeline 需要用户确认。
不可访问全局记忆或其他流水线记忆。`)

  // Constraints
  sections.push(`## Constraints
- 不确定时问用户，不要猜测
- 破坏性操作前先确认
- 工具调用失败时先分析原因再重试`)

  return sections.join('\n\n')
}
