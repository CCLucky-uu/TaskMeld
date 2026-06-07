import type { WorkflowDefinitionRuntime, WorkflowValidationResult } from "../types/workflow"

export const validateWorkflowDataIntegrity = (workflow: WorkflowDefinitionRuntime): WorkflowValidationResult => {
  if (workflow.version !== "3.0") {
    return {
      ok: false,
      error: "invalid_workflow_definition",
      detail: `Workflow version must be "3.0", got "${workflow.version}". Re-save the workflow to migrate to the current version.`,
    }
  }

  if (!Array.isArray(workflow.nodes)) {
    return {
      ok: false,
      error: "invalid_workflow_definition",
      detail: "workflow.nodes is not an array. The workflow JSON may be corrupted.",
    }
  }
  if (!Array.isArray(workflow.edges)) {
    return {
      ok: false,
      error: "invalid_workflow_definition",
      detail: "workflow.edges is not an array. The workflow JSON may be corrupted.",
    }
  }
  if (!Array.isArray(workflow.groups)) {
    return {
      ok: false,
      error: "invalid_workflow_definition",
      detail: "workflow.groups is not an array. The workflow JSON may be corrupted.",
    }
  }

  const nodeIds = new Set(workflow.nodes.map((node) => node.id))
  if (nodeIds.size !== workflow.nodes.length) {
    return {
      ok: false,
      error: "invalid_workflow_definition",
      detail: "Duplicate node IDs detected. Each node must have a unique ID. Remove or rename the duplicate.",
    }
  }

  const groupIds = new Set(workflow.groups.map((group) => group.id))
  if (groupIds.size !== workflow.groups.length) {
    return {
      ok: false,
      error: "invalid_workflow_definition",
      detail: "Duplicate parallel group IDs detected. Each group must have a unique ID.",
    }
  }

  const entityIds = new Set<string>([...nodeIds, ...groupIds])

  const edgeDedupe = new Set<string>()
  for (const edge of workflow.edges) {
    if (!entityIds.has(edge.from) || !entityIds.has(edge.to)) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Edge ${edge.from} -> ${edge.to} references a node or group that does not exist. Fix the edge endpoints or create the missing entity first.`,
      }
    }
    if (edge.from === edge.to) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Self-loop detected on ${edge.from}: a node cannot depend on itself. Remove this edge.`,
      }
    }
    const key = `${edge.from}|${edge.when ?? ""}|${edge.to}`
    if (edgeDedupe.has(key)) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Duplicate edge: ${edge.from} -> ${edge.to}. Each connection between two entities must be unique.`,
      }
    }
    edgeDedupe.add(key)
  }

  for (const group of workflow.groups) {
    for (const member of group.members) {
      if (!nodeIds.has(member)) {
        return {
          ok: false,
          error: "invalid_workflow_definition",
          detail: `Parallel group "${group.id}" lists member "${member}" which does not exist as a node. Remove this member or create the node first.`,
        }
      }
    }
  }

  const groupById = new Map(workflow.groups.map((group) => [group.id, group]))
  for (const node of workflow.nodes) {
    const groupId = node.parallelGroupId?.trim()
    if (!groupId) continue
    const group = groupById.get(groupId)
    if (!group) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Node "${node.id}" declares it belongs to parallel group "${groupId}", but that group does not exist. Remove the parallelGroupId or create the group.`,
      }
    }
    if (!group.members.includes(node.id)) {
      return {
        ok: false,
        error: "invalid_workflow_definition",
        detail: `Node "${node.id}" declares it belongs to parallel group "${groupId}", but the group's member list does not include it. Add "${node.id}" to the group's members, or clear the node's parallelGroupId.`,
      }
    }
  }

  for (const group of workflow.groups) {
    if (group.joinPolicy !== "all") {
      return {
        ok: false,
        error: "join_policy_not_supported",
        detail: `Parallel group "${group.id}" uses joinPolicy "${group.joinPolicy}", which is not implemented. Change joinPolicy to "all" — all members must complete before the group proceeds.`,
      }
    }
  }

  return { ok: true }
}
