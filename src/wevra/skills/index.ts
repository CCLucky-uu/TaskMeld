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
    description: "Pipeline Design Protocol — structured workflow for creating reliable pipelines",
    invocation: "auto",
    content: `## Pipeline Design Protocol

When the user wants to CREATE a new pipeline or ADD nodes to an existing one, follow these phases IN ORDER.
Do NOT skip phases. Do NOT create nodes until Phase 2 is confirmed by the user.

### Phase 1: Goal Discovery
Use the ask_user tool to gather requirements. Ask these questions (skip if already answered):
1. What is the goal of this pipeline? What is the final deliverable?
2. What is the input? (data format, content type — text, file, API data)
3. What is the expected output? (text report, structured data, file, decision)
4. Are there natural processing phases? (e.g. analyze → generate → validate → deliver)
5. Is there a quality gate? (review, testing, approval step)

If the user provides a requirements document, read it first, then summarize your understanding and confirm with the user.

NEVER proceed to Phase 2 if the goal is unclear.

### Phase 2: Architecture Proposal
Output a pipeline design blueprint BEFORE creating anything. Present it to the user for confirmation.

Blueprint format:
\`\`\`
Pipeline: [name]
Goal: [one sentence]

Nodes:
  n1: [name] — role: [planner/coder/tester/reviewer/operator]
     What: [what this node does in one sentence]
     Input: [what data this node needs and where it comes from]
     Output (artifact.content): [type identifier] — [structure description]
  n2: ...

Dependencies (DAG edges):
  n1 → n2  (n2 needs n1's output)
  n1,n2 → n3  (n3 needs both n1 and n2)

Data Flow:
  n1 output is a short JSON object → injected directly into n2's prompt
  n2 output is a large report → saved as .md file, artifact.content holds file path + summary
\`\`\`

Ask the user to confirm or adjust. Do NOT proceed until confirmed.

### Phase 3: Agent Assignment
Before binding agents, call agent_list to see available agents. Present the binding plan:
\`\`\`
n1: agent-abc (role: planner, existing agent)
n2: agent-xyz (role: coder, existing agent)
n3: agent-abc (role: reviewer, existing agent, separate session to avoid context bleed)
\`\`\`

If no suitable agent exists for a node, describe the required role and ask the user whether to:
- Use an existing agent with a different role
- Create a new agent (the user must do this outside Wevra)

### Phase 4: Node Output Format (ResultEnvelope)
When writing each node's instruction, you MUST tell the executing Agent the expected output format.

Every node execution produces a ResultEnvelope:
\`\`\`json
{
  "version": "2.0",
  "runId": "<system-provided>",
  "nodeId": "<system-provided>",
  "requestId": "<system-provided>",
  "sessionId": "<system-provided>",
  "status": "success" | "failed",
  "artifacts": [{
    "type": "<must match outputSpec.type>",
    "schemaVersion": <must match outputSpec.schemaVersion>,
    "name": "primary",
    "content": <any JSON value — this is the actual deliverable>,
    "meta": {}
  }],
  "logs": [],
  "error": null
}
\`\`\`

When writing a node instruction, include:
- WHAT to do (the specific task)
- WHAT upstream data is available (the system auto-injects it, but describe the expected structure)
- WHAT output structure to produce in artifact.content (give an example if non-trivial)
- For routing nodes: artifact.content MUST be an array where each entry has a "route" field matching allowed routes

### Phase 5: Incremental Build
Execute in order, presenting progress:
1. pipeline_create → confirm result
2. For each node: pipeline_node add (with dependsOn) → confirm
3. pipeline_validate → fix any errors before proceeding
4. Present final overview to user → ask if ready to run

NEVER skip pipeline_validate. NEVER run the pipeline without user approval.

---

## Artifact Content Strategy

### Short structured data (< 1KB)
Write directly into artifact.content as JSON. Downstream nodes consume it automatically via prompt injection.

Example:
\`\`\`json
{ "summary": "Analysis complete", "score": 85, "issues": ["typo in line 3"] }
\`\`\`

### Long text or large data (> 1KB)
Instruct the Agent to save the content to a file in its workspace, then put ONLY a reference in artifact.content:
\`\`\`json
{ "filePath": "/workspace/report.md", "format": "markdown", "lineCount": 350, "summary": "Full analysis report covering 12 modules" }
\`\`\`
The downstream node's instruction must include: "Read the file at the path provided in the upstream artifact to get the full content."

### Binary files (images, videos, PDFs)
Same as large data — save to file, reference in artifact.content:
\`\`\`json
{ "filePath": "/workspace/diagram.png", "format": "png", "description": "Architecture diagram showing 5 microservices" }
\`\`\`

### Routing node output
artifact.content must be an array with a "route" field per entry:
\`\`\`json
[
  { "item": "task-001", "route": "yes", "reason": "meets criteria" },
  { "item": "task-002", "route": "no", "reason": "incomplete data" }
]
\`\`\`

---

## Red Lines — NEVER DO THESE

### Requirements
- NEVER assume user intent. Always ask and confirm before designing.
- NEVER skip the goal confirmation step. If unclear, use ask_user to clarify.
- NEVER pre-decide node count before understanding the problem.
- NEVER proceed to the next phase if the user hasn't confirmed the current phase.

### Architecture
- NEVER create nodes or edges before the user confirms the architecture blueprint.
- NEVER create a node with a vague instruction like "complete the task" or "do the work".
- NEVER mix execution and verification in the same node. The reviewer must be a separate node.
- NEVER create a node with no input source (except the pipeline entry node).
- NEVER create a node whose output nobody consumes (except the pipeline final node).
- NEVER add unnecessary dependencies. If node D only needs C's output, dependsOn = [C], not [A, B, C].
- NEVER omit necessary dependencies. If node D needs both A and C, dependsOn = [A, C].
- NEVER exceed 10 nodes in a single pipeline. If more steps are needed, suggest splitting into linked pipelines.

### Agent Binding
- NEVER invent agent IDs. Always call agent_list first and use real IDs.
- NEVER assign the same agent as both coder and reviewer in the same pipeline chain.
- NEVER write instructions that assume tools the agent doesn't have.
- NEVER give empty or generic instructions. Every instruction must be specific and actionable.

### Artifacts
- NEVER put content larger than 10KB into artifact.content directly. Use file path references.
- NEVER omit outputSpec (type + schemaVersion) on any node.
- NEVER leave artifact.content format ambiguous. Always describe the expected structure in the instruction.
- NEVER forget the "route" field in routing node artifact.content arrays.

### Execution
- NEVER skip pipeline_validate after creating all nodes.
- NEVER run pipeline_run without explicit user approval.
- NEVER delete existing pipelines without user request.
- NEVER batch-create all nodes without showing the design to the user first.

---

## Anti-Patterns

BAD: Creating a pipeline with 4 generic nodes (analyze, execute, review, deliver) without understanding the actual task.
GOOD: Asking what the pipeline should accomplish, then designing nodes that match the real workflow.

BAD: Writing instruction "Analyze the upstream data and produce a report."
GOOD: Writing instruction "Analyze the upstream code review data (provided as JSON array of file findings). Produce a markdown report with: 1) Executive summary, 2) Critical issues list, 3) Recommended fixes. Output artifact.content as { "filePath": "...", "summary": "..." }."

BAD: Setting dependsOn = [n1, n2, n3] for a node that only reads n3's output.
GOOD: Setting dependsOn = [n3] — only declare actual data dependencies.

BAD: Using the same agent for the "code generation" and "code review" nodes.
GOOD: Using one agent for generation (coder role) and a different agent for review (reviewer role).

BAD: Creating all nodes at once then asking "is this correct?"
GOOD: Showing the architecture blueprint first, getting confirmation, then creating nodes one by one with validation.`,
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
