import type { WorkflowDefinition } from "../../../entities/pipeline";

// ====== L1: Data Integrity (save-time) ======

export type SaveValidationResult = { ok: true } | { ok: false; message: string };

/**
 * L1 validation — only data integrity checks that prevent corrupt JSON.
 * Does NOT check graph structure (DAG, routing, group completeness).
 */
export const validateWorkflowForSave = (workflow: WorkflowDefinition): SaveValidationResult => {
  if (workflow.version !== "3.0") {
    return { ok: false, message: `Expected version "3.0", got "${String(workflow.version)}"` };
  }
  if (!Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges) || !Array.isArray(workflow.groups)) {
    return { ok: false, message: "nodes, edges, groups must be arrays" };
  }
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  if (nodeIds.size !== workflow.nodes.length) {
    return { ok: false, message: "Duplicate node IDs detected" };
  }
  const groupIds = new Set(workflow.groups.map((group) => group.id));
  if (groupIds.size !== workflow.groups.length) {
    return { ok: false, message: "Duplicate group IDs detected" };
  }
  const entityIds = new Set<string>([...nodeIds, ...groupIds]);
  const edgeSeen = new Set<string>();
  for (const edge of workflow.edges) {
    if (!entityIds.has(edge.from) || !entityIds.has(edge.to)) {
      return { ok: false, message: `Edge references non-existent entity: ${edge.from} -> ${edge.to}` };
    }
    if (edge.from === edge.to) {
      return { ok: false, message: `Self-loop edge: ${edge.from} -> ${edge.to}` };
    }
    const key = `${edge.from}|${edge.to}|${edge.when ?? ""}`;
    if (edgeSeen.has(key)) return { ok: false, message: `Duplicate edge: ${edge.from} -> ${edge.to}` };
    edgeSeen.add(key);
  }
  const explicitGroupById = new Map(workflow.groups.map((group) => [group.id, group]));
  for (const group of workflow.groups) {
    for (const memberId of group.members) {
      if (!nodeIds.has(memberId)) {
        return { ok: false, message: `Group ${group.id} references non-existent member ${memberId}` };
      }
    }
  }
  for (const node of workflow.nodes) {
    const groupId = (node.parallelGroupId ?? "").trim();
    if (!groupId) continue;
    const group = explicitGroupById.get(groupId);
    if (!group) {
      return { ok: false, message: `Node ${node.id} references non-existent group ${groupId}` };
    }
    if (!group.members.includes(node.id)) {
      return { ok: false, message: `Node ${node.id} is not a member of group ${groupId}` };
    }
  }
  return { ok: true };
};

// ====== L1 + L2 + L3: Full validation (run-time) ======

export type RunValidationResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Full validation before run — L1 data integrity + L2 graph structure + L3 runtime semantics.
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

  // DAG cycle detection via topological sort
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
    errors.push("Workflow contains a cycle (DAG violation)");
  }

  // Group minimum members
  for (const group of workflow.groups) {
    if (!Array.isArray(group.members) || group.members.length < 2) {
      errors.push(`Parallel group ${group.id} must have at least 2 members`);
    }
  }

  // Routing constraints
  for (const node of workflow.nodes) {
    if (node.routePolicy) {
      const { allowed } = node.routePolicy;
      if (allowed.length < 2 || allowed.length > 5) {
        errors.push(`Node ${node.id} has invalid route set size (${allowed.length})`);
      }
      if (!allowed.includes("yes") || !allowed.includes("no")) {
        errors.push(`Node ${node.id} must include "yes" and "no" routes`);
      }
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
};
