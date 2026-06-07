import type { WorkflowDefinitionRuntime, WorkflowValidationResult } from "../types/workflow"

export const validateWorkflowDataIntegrity = (workflow: WorkflowDefinitionRuntime): WorkflowValidationResult => {
  // 1. Version check
  if (workflow.version !== "3.0") {
    return {
      ok: false,
      error: "invalid_workflow_definition",
      detail: `Expected version "3.0", got "${workflow.version}"`,
    }
  }

  // 2. Array type checks
  if (!Array.isArray(workflow.nodes)) {
    return { ok: false, error: "invalid_workflow_definition", detail: "workflow.nodes is not an array" }
  }
  if (!Array.isArray(workflow.edges)) {
    return { ok: false, error: "invalid_workflow_definition", detail: "workflow.edges is not an array" }
  }
  if (!Array.isArray(workflow.groups)) {
    return { ok: false, error: "invalid_workflow_definition", detail: "workflow.groups is not an array" }
  }

  // 3. No duplicate node IDs
  const nodeIds = new Set(workflow.nodes.map((node) => node.id))
  if (nodeIds.size !== workflow.nodes.length) {
    return { ok: false, error: "invalid_workflow_definition", detail: "workflow.nodes contains duplicate IDs" }
  }

  // 4. No duplicate group IDs
  const groupIds = new Set(workflow.groups.map((group) => group.id))
  if (groupIds.size !== workflow.groups.length) {
    return { ok: false, error: "invalid_workflow_definition", detail: "workflow.groups contains duplicate IDs" }
  }

  const entityIds = new Set<string>([...nodeIds, ...groupIds])

  // 5. All edge from/to reference existing nodeIds or groupIds
  // 6. No self-loop edges
  // 7. No duplicate edges
  const edgeDedupe = new Set<string>()
  for (const edge of workflow.edges) {
    if (!entityIds.has(edge.from) || !entityIds.has(edge.to)) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Edge references non-existent entity: ${edge.from} -> ${edge.to}`,
      }
    }
    if (edge.from === edge.to) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Self-loop edge detected: ${edge.from} -> ${edge.to}`,
      }
    }
    const key = `${edge.from}|${edge.when ?? ""}|${edge.to}`
    if (edgeDedupe.has(key)) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Duplicate edge detected: ${edge.from} -> ${edge.to}`,
      }
    }
    edgeDedupe.add(key)
  }

  // 8. All group members reference existing nodeIds
  for (const group of workflow.groups) {
    for (const member of group.members) {
      if (!nodeIds.has(member)) {
        return {
          ok: false,
          error: "invalid_workflow_definition",
          detail: `Parallel group ${group.id} references non-existent member ${member}`,
        }
      }
    }
  }

  // 9. All node parallelGroupId reference existing groups, and the node is in that group's members
  const groupById = new Map(workflow.groups.map((group) => [group.id, group]))
  for (const node of workflow.nodes) {
    const groupId = node.parallelGroupId?.trim()
    if (!groupId) continue
    const group = groupById.get(groupId)
    if (!group) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Node ${node.id} references non-existent parallel group ${groupId}`,
      }
    }
    if (!group.members.includes(node.id)) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Node ${node.id} is not a member of its declared parallel group ${groupId}`,
      }
    }
  }

  // 10. joinPolicy is "all"
  for (const group of workflow.groups) {
    if (group.joinPolicy !== "all") {
      return {
        ok: false,
        error: "join_policy_not_supported",
        detail: `Parallel group ${group.id} has unsupported joinPolicy "${group.joinPolicy}", only "all" is currently supported`,
      }
    }
  }

  return { ok: true }
}
