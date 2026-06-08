import type { SkillDef, SkillInvocation } from "../types"

export class SkillRegistry {
  private skills = new Map<string, SkillDef>()

  register(skill: SkillDef): void {
    this.skills.set(skill.name, skill)
  }

  get(name: string): SkillDef | undefined {
    return this.skills.get(name)
  }

  list(): Array<Pick<SkillDef, "name" | "description" | "invocation">> {
    return Array.from(this.skills.values()).map((s) => ({
      name: s.name,
      description: s.description,
      invocation: s.invocation,
    }))
  }

  getByInvocation(invocation: SkillInvocation): SkillDef[] {
    return Array.from(this.skills.values()).filter((s) => s.invocation === invocation)
  }

  getAlwaysActive(): SkillDef[] {
    return this.getByInvocation("always")
  }

  get size(): number {
    return this.skills.size
  }
}

// ── Built-in Skills ──

export const BUILTIN_SKILLS: SkillDef[] = [
  {
    name: "core-behavior",
    description: "Core behavior guidelines",
    invocation: "always",
    content: `## Behavior Guidelines
- When uncertain, ask the user. Never guess or fabricate data.
- Confirm with the user before destructive operations (e.g., deletion).
- When a tool call fails, analyze the cause before retrying. Do not give up immediately.
- Be concise. Avoid redundancy.
- Reply in English.`,
  },
  {
    name: "pipeline-management",
    description: "Recommended workflow for creating and managing pipelines",
    invocation: "auto",
    content: `## Pipeline Management Workflow
When the user wants to create or modify a pipeline:
1. Start with pipeline_list to review existing pipelines and avoid duplicates.
2. If modifying, use pipeline_get to inspect the current definition first.
3. After creation/modification, confirm the result.
4. If a run is needed, use pipeline_run to start it.

Notes:
- Pipeline names should be concise and descriptive.
- Confirm the user's requirements before creation. Do not assume the node structure.`,
  },
  {
    name: "failure-diagnosis",
    description: "Analyze pipeline run failures and provide fix suggestions",
    invocation: "auto",
    content: `## Failure Diagnosis Workflow
When a pipeline run fails:
1. Use pipeline_status to check the overall run state.
2. Use pipeline_diagnose for an initial analysis.
3. If deeper investigation is needed:
   - Use session_history to review the agent conversation history for that node.
   - Use artifact_get to read the output artifacts from that node.
4. Synthesize the information to provide:
   - Root cause of the failure.
   - Scope of impact.
   - Suggested fix.

Do not guess the failure cause. Base your analysis on actual data.`,
  },
]

export function createSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry()
  for (const skill of BUILTIN_SKILLS) {
    registry.register(skill)
  }
  return registry
}
