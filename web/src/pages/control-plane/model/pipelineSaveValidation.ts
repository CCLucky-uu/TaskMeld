import type { WorkflowDefinition } from "../../../entities/pipeline";

// ====== L1: Data Integrity (save-time) ======

export type SaveValidationResult = { ok: true } | { ok: false; message: string };

/**
 * L1 validation — only data integrity checks that prevent corrupt JSON.
 * Does NOT check graph structure (DAG, routing, group completeness).
 */
export const validateWorkflowForSave = (workflow: WorkflowDefinition): SaveValidationResult => {
  if (workflow.version !== "3.0") {
    return { ok: false, message: `Workflow version must be "3.0", got "${String(workflow.version)}". Re-save the workflow to migrate to the current version.` };
  }
  if (!Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges) || !Array.isArray(workflow.groups)) {
    return { ok: false, message: "Workflow structure is malformed: nodes, edges, and groups must all be arrays. The workflow JSON may be corrupted." };
  }
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  if (nodeIds.size !== workflow.nodes.length) {
    return { ok: false, message: `Duplicate node IDs detected. Each node must have a unique ID. Remove or rename the duplicate node.` };
  }
  const groupIds = new Set(workflow.groups.map((group) => group.id));
  if (groupIds.size !== workflow.groups.length) {
    return { ok: false, message: `Duplicate parallel group IDs detected. Each group must have a unique ID. Remove or rename the duplicate group.` };
  }
  const entityIds = new Set<string>([...nodeIds, ...groupIds]);
  const edgeSeen = new Set<string>();
  for (const edge of workflow.edges) {
    if (!entityIds.has(edge.from) || !entityIds.has(edge.to)) {
      return { ok: false, message: `Edge ${edge.from} -> ${edge.to} references a node or group that does not exist. Fix the edge endpoints or create the missing entity first.` };
    }
    if (edge.from === edge.to) {
      return { ok: false, message: `Self-loop detected on ${edge.from}: a node cannot depend on itself. Remove this edge.` };
    }
    const key = `${edge.from}|${edge.to}|${edge.when ?? ""}`;
    if (edgeSeen.has(key)) return { ok: false, message: `Duplicate edge: ${edge.from} -> ${edge.to}. Each connection between two entities must be unique.` };
    edgeSeen.add(key);
  }
  const explicitGroupById = new Map(workflow.groups.map((group) => [group.id, group]));
  for (const group of workflow.groups) {
    for (const memberId of group.members) {
      if (!nodeIds.has(memberId)) {
        return { ok: false, message: `Parallel group "${group.id}" lists member "${memberId}" which does not exist as a node. Remove this member or create the node first.` };
      }
    }
  }
  for (const node of workflow.nodes) {
    const groupId = (node.parallelGroupId ?? "").trim();
    if (!groupId) continue;
    const group = explicitGroupById.get(groupId);
    if (!group) {
      return { ok: false, message: `Node "${node.id}" declares it belongs to parallel group "${groupId}", but that group does not exist. Remove the parallelGroupId or create the group.` };
    }
    if (!group.members.includes(node.id)) {
      return { ok: false, message: `Node "${node.id}" declares it belongs to parallel group "${groupId}", but the group's member list does not include it. Add "${node.id}" to the group's members, or clear the node's parallelGroupId.` };
    }
  }
  return { ok: true };
};

// ====== L1 + L2 + L3: Full validation (run-time) ======

export type RunValidationResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Full validation before run — L1 data integrity + L2 graph structure + L3 runtime semantics.
 * Every error message explains: what is wrong, why it matters, and how to fix it.
 */
export const validateWorkflowForRun = (workflow: WorkflowDefinition): RunValidationResult => {
  const errors: string[] = [];

  // L1
  const l1 = validateWorkflowForSave(workflow);
  if (!l1.ok) errors.push(l1.message);

  // L2: Graph structure
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  const groupIds = new Set(workflow.groups.map((group) => group.id));
  const entityIds = new Set<string>([...nodeIds, ...groupIds]);

  // DAG cycle detection
  const indegreeByEntity = new Map<string, number>([...entityIds].map((id) => [id, 0]));
  const outgoingBySource = new Map<string, string[]>();
  for (const id of entityIds) outgoingBySource.set(id, []);
  for (const edge of workflow.edges) {
    indegreeByEntity.set(edge.to, (indegreeByEntity.get(edge.to) ?? 0) + 1);
    outgoingBySource.set(edge.from, [...(outgoingBySource.get(edge.from) ?? []), edge.to]);
  }
  const queue = [...[...entityIds].filter((id) => (indegreeByEntity.get(id) ?? 0) === 0)];
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited++;
    for (const next of outgoingBySource.get(current) ?? []) {
      const nextDegree = (indegreeByEntity.get(next) ?? 0) - 1;
      indegreeByEntity.set(next, nextDegree);
      if (nextDegree === 0) queue.push(next);
    }
  }
  if (visited !== entityIds.size) {
    errors.push("Dependency cycle detected: one or more nodes form a circular dependency chain. The pipeline cannot execute because it is impossible to determine execution order. Break the cycle by removing one of the edges in the loop.");
  }

  // Group minimum members
  for (const group of workflow.groups) {
    if (!Array.isArray(group.members) || group.members.length < 2) {
      errors.push(`Parallel group "${group.id}" has ${group.members?.length ?? 0} member(s), but a parallel group requires at least 2 nodes to run concurrently. Add more nodes to the group, or remove the group if parallel execution is not needed.`);
    }
  }

  // Routing constraints
  for (const node of workflow.nodes) {
    if (node.routePolicy) {
      const { allowed } = node.routePolicy;
      if (allowed.length < 2 || allowed.length > 5) {
        errors.push(`Node "${node.id}" declares ${allowed.length} route(s), but a routing node must have between 2 and 5 routes (including "yes" and "no"). Adjust the route list.`);
      }
      if (!allowed.includes("yes") || !allowed.includes("no")) {
        errors.push(`Node "${node.id}" is a routing node but is missing the required "yes" and/or "no" routes. Every routing node must include both "yes" (mainline) and "no" (default branch) in its allowed routes.`);
      }
    }
  }

  // L3: Output config validation
  const output = workflow.output ?? { mode: "mainline_last" as const, nodeId: null };
  if (workflow.nodes.length > 0) {
    if (output.mode === "explicit") {
      if (!output.nodeId) {
        errors.push("Output mode is set to \"explicit\" but no nodeId is specified. Set output.nodeId to the ID of the node whose result should be the pipeline's final output.");
      } else {
        const outputNode = workflow.nodes.find((n) => n.id === output.nodeId);
        if (!outputNode) {
          errors.push(`Output node "${output.nodeId}" does not exist in the workflow. Change output.nodeId to an existing node, or create the node first.`);
        } else if (!outputNode.enabled) {
          errors.push(`Output node "${output.nodeId}" is disabled. A disabled node cannot produce output. Enable the node, or change output.nodeId to an enabled node.`);
        } else if (outputNode.lane !== "main") {
          errors.push(`Output node "${output.nodeId}" is a branch node, but only mainline nodes can be pipeline outputs. Change the node's lane to "main", or select a different output node.`);
        }
      }
    } else {
      // mode === "mainline_last" — auto-derive unique mainline sink
      const mainlineNodes = workflow.nodes.filter((n) => n.enabled && n.lane === "main");
      if (mainlineNodes.length === 0) {
        errors.push("No enabled mainline nodes exist. The pipeline needs at least one enabled mainline node to produce output. Enable an existing node or change a branch node's lane to \"main\".");
      } else {
        // Find sink nodes: mainline nodes that no other mainline node depends on
        const mainlineIds = new Set(mainlineNodes.map((n) => n.id));
        const hasDownstreamMainline = new Set<string>();
        for (const edge of workflow.edges) {
          if (edge.when !== null) continue;
          if (mainlineIds.has(edge.from) && mainlineIds.has(edge.to)) {
            hasDownstreamMainline.add(edge.from);
          }
        }
        const sinkNodes = mainlineNodes.filter((n) => !hasDownstreamMainline.has(n.id));
        if (sinkNodes.length === 0) {
          errors.push("Cannot determine the pipeline's output node: all mainline nodes are part of a dependency chain with no clear endpoint. Ensure at least one mainline node is not depended on by other mainline nodes (i.e., it is the final step).");
        } else if (sinkNodes.length > 1) {
          const sinkIds = sinkNodes.map((n) => `"${n.id}"`).join(", ");
          errors.push(
            `Multiple mainline nodes have no downstream dependencies: ${sinkIds}. The system cannot determine which one produces the final output. Add a dependency edge between them (e.g. make one depend on the other) so only one node is the pipeline's last step.`,
          );
        }
      }
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
};
