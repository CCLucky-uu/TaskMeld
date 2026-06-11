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
    name: "pipeline-create",
    description: "New pipeline creation — 4-phase protocol from requirements to deployment",
    invocation: "auto",
    content: `## Pipeline Creation Protocol

This is the ONLY workflow for CREATING NEW pipelines. Follow phases IN ORDER.
Each phase requires EXPLICIT user confirmation before proceeding. NEVER skip a phase.

─────────────────────────────────────────────
Phase 1 — Requirement Alignment
─────────────────────────────────────────────
Goal: Understand what the user wants before proposing anything.

- ALWAYS start with ask_user. Never assume.
- Minimum questions:
  1. What should the pipeline accomplish? What is the final deliverable?
  2. What is the input? (format, source, data type)
  3. What is the expected output? (format, content, quality bar)
  4. Are there natural processing phases?
  5. Is there a quality gate? (review, testing, approval)
- Summarize your understanding. Confirm with the user.
- Gate: user explicitly agrees with the requirements summary.
- If anything is unclear, ask more. DO NOT proceed to Phase 2.

─────────────────────────────────────────────
Phase 2 — Blueprint Design & Review
─────────────────────────────────────────────
Goal: Show a visual DAG design. User reviews and edits before any real resource is created.

- Use blueprints_generate to create a complete blueprint JSON.
  Include ALL nodes with id, name, role, type, instruction, deps.
  Router nodes must have routes (at least "yes" and "no").
- The system renders it as a DAG diagram for the user to inspect.
- User may request edits → use blueprints_update. Batch multiple changes.
- agentId can be left empty in this phase.
- Gate: user explicitly confirms the blueprint structure is correct.
- DO NOT create real pipeline nodes yet.

─────────────────────────────────────────────
Phase 3 — Agent Assignment
─────────────────────────────────────────────
Goal: Bind a real agent to every task node.

- Default strategy: recommend creating a NEW set of agents for this pipeline.
  Do NOT reuse agents from other pipelines unless the user insists.
  New pipelines with fresh agents avoid cross-pipeline interference.
- Run agent_list to see existing agents. Present the user with:
  * Option A: Create new agents (recommended) — describe what roles are needed.
  * Option B: Reuse existing agents — only if the user prefers this.
- For each "task" node: use blueprints_update (updateNode) to set agentId.
- Rules:
  * Nodes that run in PARALLEL MUST NOT share the same agent.
    Parallel = nodes with the same set of deps and no dependency between them.
    Sharing an agent across parallel nodes causes session conflicts.
  * Coder and reviewer for the same output chain must be DIFFERENT agents.
  * Router nodes do NOT need agentId.
  * If no suitable agent exists, tell the user what role is missing.
- Gate: user confirms the agent assignment plan.

─────────────────────────────────────────────
Phase 4 — Pipeline Creation
─────────────────────────────────────────────
Goal: Create the real pipeline only after all confirmations.

- Use blueprints_apply to convert the blueprint into a real pipeline.
  This will FAIL if any task node is missing agentId — fix before calling.
- After creation, present the result. DO NOT auto-run.
- If using non-blueprint tools: pipeline_create → pipeline_node (per node) → pipeline_validate.

─────────────────────────────────────────────
Pipeline Execution Rules (after Phase 4)
─────────────────────────────────────────────
1. NEVER call pipeline_run without explicit user command ("run", "execute", "start").
2. pipeline_validate MUST pass (valid: true) before any run. Fix issues and re-validate.
3. Do not suggest running. Do not bundle run with creation. Running is a user decision.

─────────────────────────────────────────────
Red Lines — NEVER
─────────────────────────────────────────────
- NEVER skip user confirmation between phases.
- NEVER create pipeline nodes before Phase 2 blueprint is confirmed.
- NEVER reuse agents from other pipelines for a new pipeline — recommend fresh agents.
- NEVER assign the same agent to parallel nodes within the same pipeline.
- NEVER assign the same agent as coder + reviewer in the same chain.
- NEVER write vague instructions (e.g. "do the work"). Be specific and actionable.
- NEVER skip pipeline_validate.
- NEVER run without explicit user approval.`,
  },
  {
    name: "pipeline-maintenance",
    description: "Maintain existing pipelines — inspect, modify, diagnose, run, delete",
    invocation: "auto",
    content: `## Pipeline Maintenance

For pipelines that ALREADY EXIST. Do NOT use pipeline-create protocol for maintenance.

─────────────────────────────────────────────
View & Inspect
─────────────────────────────────────────────
- pipeline_list — Overview of all pipelines.
- pipeline_get — Full details (nodes, edges, agents).
- pipeline_status — Runtime state, recent runs, live status.
- blueprints_from_pipeline — Visualize an existing pipeline as a DAG diagram.

─────────────────────────────────────────────
Diagnose Failures
─────────────────────────────────────────────
When a pipeline run fails:
1. pipeline_status → confirm the failure.
2. pipeline_diagnose → initial automated analysis.
3. If deeper investigation needed:
   - session_history → review agent conversation for the failed node.
   - artifact_get → read the node's output artifacts.
4. Summarize root cause, impact, and suggested fix.
5. For structural issues, use blueprints_from_pipeline to visualize the DAG.

Base analysis on actual data. Do not guess.

─────────────────────────────────────────────
Modify an Existing Pipeline
─────────────────────────────────────────────

Default workflow — ALWAYS use this unless the exception applies:

1. blueprints_from_pipeline → derive current state as a DAG blueprint.
2. blueprints_update → make changes. The user sees the DAG update.
3. User confirms → blueprints_apply to write back.
4. pipeline_validate after apply.

Why: blueprint editing gives the user visual DAG feedback. Direct node changes bypass the DAG and hide the structural impact from the user.

Exception — direct edit is allowed ONLY when ALL of these are true:
- The user explicitly names the target node ID.
- The user explicitly states what to change (e.g. "rename node X to Y", "change node A's instruction to ...").
- The change is a SINGLE node, not structural (no deps/edges/routes change).

When the exception applies, use pipeline_node (update) directly, then pipeline_validate.

Rules:
- NEVER modify a pipeline that is currently running.
- NEVER change agent assignment on nodes that have active sessions.
- When adding parallel nodes, NEVER assign them the same agent.
- ALWAYS run pipeline_validate after modifications.
- Confirm with user before structural changes.

─────────────────────────────────────────────
Run a Pipeline
─────────────────────────────────────────────
1. User MUST explicitly ask ("run", "execute", "start").
2. pipeline_validate MUST pass (valid: true) before running.
3. Use pipeline_run to start.
4. Use pipeline_stop to stop if needed.

CRITICAL:
- NEVER auto-run after creation or modification.
- NEVER suggest running — wait for the user's command.
- NEVER skip validation before running.

─────────────────────────────────────────────
Delete a Pipeline
─────────────────────────────────────────────
- Confirm with user before deletion. Destructive, irreversible.
- Use pipeline_delete.
- Also cleans up associated blueprint files.`,
  },
]

export function createSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry()
  for (const skill of BUILTIN_SKILLS) {
    registry.register(skill)
  }
  return registry
}
