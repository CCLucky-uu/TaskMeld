import type { Tool } from "../../types"
import type {
  WorkflowDefinitionRuntime,
  WorkflowNode,
  WorkflowEdge,
  ExecutorRole,
} from "../../../pipeline/types/workflow"

// ── Blueprint types ──

export interface BlueprintRoute {
  value: string
  targetNodeId: string
}

export interface BlueprintNode {
  id: string
  name: string
  role: ExecutorRole
  agentId?: string
  instruction: string
  type: "task" | "router"
  deps: string[]
  routes?: BlueprintRoute[]
  lane?: "main" | "branch"
  retryPolicy?: {
    maxAttempts: number
    backoffMs: number
  }
  allowReject?: boolean
  maxRejectCount?: number
}

export interface Blueprint {
  version: "1.0"
  pipelineId?: string
  title: string
  description?: string
  nodes: BlueprintNode[]
}

export interface BlueprintEdge {
  from: string
  to: string
  kind: "dependency" | "route"
  route?: string
}

export interface BlueprintValidationError {
  valid: false
  errors: string[]
}

export interface BlueprintValidationOk {
  valid: true
}

export type BlueprintValidationResult = BlueprintValidationOk | BlueprintValidationError

// ── Edge expansion ──

/** Derive flat edge list from node-native deps + routes. */
export function expandEdges(nodes: BlueprintNode[]): BlueprintEdge[] {
  const edges: BlueprintEdge[] = []
  for (const node of nodes) {
    for (const dep of node.deps) {
      edges.push({ from: dep, to: node.id, kind: "dependency" })
    }
    if (node.routes) {
      for (const r of node.routes) {
        edges.push({ from: node.id, to: r.targetNodeId, kind: "route", route: r.value })
      }
    }
  }
  return edges
}

// ── L1 validation ──

/** Validate basic blueprint integrity: ids, deps, routes, acyclicity. */
export function validateBlueprint(bp: Blueprint): BlueprintValidationResult {
  const errors: string[] = []
  const nodeIds = new Set(bp.nodes.map((n) => n.id))

  if (!bp.title || !bp.title.trim()) {
    errors.push("Blueprint title is required.")
  }
  if (!bp.nodes || bp.nodes.length === 0) {
    errors.push("Blueprint must have at least one node.")
    return { valid: false, errors }
  }

  // Id format and uniqueness
  const seenIds = new Set<string>()
  for (const node of bp.nodes) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(node.id)) {
      errors.push(
        `Node id "${node.id}" is invalid. Use lowercase alphanumeric with hyphens only, must start with a letter or digit.`,
      )
    }
    if (seenIds.has(node.id)) {
      errors.push(`Duplicate node id "${node.id}".`)
    }
    seenIds.add(node.id)

    if (!node.instruction || !node.instruction.trim()) {
      errors.push(`Node "${node.id}" is missing instruction.`)
    }

    // Validate deps reference existing nodes
    for (const dep of node.deps) {
      if (!nodeIds.has(dep)) {
        errors.push(`Node "${node.id}" references non-existent dependency "${dep}".`)
      }
    }

    // Router nodes must have routes
    if (node.type === "router") {
      if (!node.routes || node.routes.length < 2) {
        errors.push(`Router node "${node.id}" must have at least 2 routes.`)
      } else {
        const routeValues = node.routes.map((r) => r.value)
        if (!routeValues.includes("yes")) {
          errors.push(`Router node "${node.id}" must include a "yes" route.`)
        }
        if (!routeValues.includes("no")) {
          errors.push(`Router node "${node.id}" must include a "no" route.`)
        }
        for (const route of node.routes) {
          if (!nodeIds.has(route.targetNodeId)) {
            errors.push(
              `Router node "${node.id}" route "${route.value}" targets non-existent node "${route.targetNodeId}".`,
            )
          }
        }
      }
    }

    // Validate role
    const validRoles: ExecutorRole[] = ["planner", "coder", "tester", "reviewer", "operator"]
    if (!validRoles.includes(node.role)) {
      errors.push(`Node "${node.id}" has invalid role "${node.role}". Must be one of: ${validRoles.join(", ")}.`)
    }
  }

  if (errors.length > 0) return { valid: false, errors }

  // Cycle detection via DFS
  const sorted = topologicalSort(bp.nodes)
  if (!sorted) {
    errors.push("Blueprint contains a cycle (circular dependency).")
    return { valid: false, errors }
  }

  return { valid: true }
}

// ── Topological sort (Kahn''s algorithm) ──

export function topologicalSort(nodes: BlueprintNode[]): BlueprintNode[] | null {
  const inDegree = new Map<string, number>()
  const idToNode = new Map<string, BlueprintNode>()

  for (const node of nodes) {
    inDegree.set(node.id, 0)
    idToNode.set(node.id, node)
  }

  // Pre-build adjacency list: from → to[]
  const edges = expandEdges(nodes)
  const outgoing = new Map<string, string[]>()
  for (const e of edges) {
    const list = outgoing.get(e.from)
    if (list) list.push(e.to)
    else outgoing.set(e.from, [e.to])
  }

  for (const node of nodes) {
    for (const dep of node.deps) {
      inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1)
    }
    if (node.routes) {
      for (const r of node.routes) {
        inDegree.set(r.targetNodeId, (inDegree.get(r.targetNodeId) ?? 0) + 1)
      }
    }
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const sorted: BlueprintNode[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    const node = idToNode.get(id)
    if (node) sorted.push(node)

    for (const toId of outgoing.get(id) ?? []) {
      const newDeg = (inDegree.get(toId) ?? 1) - 1
      inDegree.set(toId, newDeg)
      if (newDeg === 0) queue.push(toId)
    }
  }

  if (sorted.length !== nodes.length) return null
  return sorted
}

// ── Blueprint → WorkflowDefinitionRuntime conversion ──

export function blueprintToWorkflow(bp: Blueprint): WorkflowDefinitionRuntime {
  const sorted = topologicalSort(bp.nodes) ?? bp.nodes
  const edges: WorkflowEdge[] = []

  // Convert deps + routes to workflow edges
  for (const node of sorted) {
    for (const dep of node.deps) {
      edges.push({ from: dep, to: node.id, when: null })
    }
    if (node.routes) {
      for (const route of node.routes) {
        edges.push({ from: node.id, to: route.targetNodeId, when: route.value })
      }
    }
  }

  // Derive pipeline id from title if not present
  const derivedId =
    bp.pipelineId ??
    bp.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")

  const nodes: WorkflowNode[] = sorted.map((n) => ({
    id: n.id,
    name: n.name,
    type: n.type,
    enabled: true,
    isMainline: n.lane !== "branch",
    lane: n.lane ?? "main",
    parallelGroupId: null,
    executor: {
      agentId: n.agentId ?? "",
      role: n.role,
      fallbackAgentId: null,
      sessionId: n.agentId ? `agent:${n.agentId}:main` : null,
    },
    inputMode: "single",
    outputMode: "single",
    dependencyPolicy: "all",
    routePolicy:
      n.type === "router" && n.routes && n.routes.length > 0
        ? { allowed: n.routes.map((r) => r.value) }
        : null,
    retryPolicy: n.retryPolicy ?? { maxAttempts: 2, backoffMs: 0 },
    outputSpec: { type: "structured", schemaVersion: 1 },
    instruction: n.instruction,
    allowReject: n.allowReject ?? false,
    maxRejectCount: n.maxRejectCount ?? 3,
  }))

  return {
    version: "3.0",
    scheduler: {
      enabled: false,
      mode: "manual",
      dispatchBy: "item",
      maxConcurrency: 1,
      loopGuard: { maxGlobalIterations: 100, maxPerItemLoop: 10 },
    },
    plugins: [],
    nodes,
    edges,
    groups: [],
  }
}

// ── WorkflowDefinitionRuntime → Blueprint conversion ──

export function workflowToBlueprint(
  workflow: WorkflowDefinitionRuntime,
  pipelineId?: string,
  title?: string,
  description?: string,
): Blueprint {
  const nodes: BlueprintNode[] = []

  for (const wn of workflow.nodes) {
    // Build deps: find all edges where to === wn.id and when === null
    const deps = workflow.edges
      .filter((e) => e.to === wn.id && e.when === null)
      .map((e) => e.from)

    // Build routes: only for router nodes, find all edges where from === wn.id and when !== null
    const routes =
      wn.type === "router"
        ? workflow.edges
            .filter((e) => e.from === wn.id && e.when !== null)
            .map((e) => ({ value: e.when!, targetNodeId: e.to }))
        : undefined

    nodes.push({
      id: wn.id,
      name: wn.name,
      role: wn.executor.role,
      agentId: wn.executor.agentId || undefined,
      instruction: wn.instruction,
      type: (wn.type === "router" ? "router" : "task") as "task" | "router",
      deps,
      routes,
      lane: wn.lane === "branch" ? "branch" : "main",
      retryPolicy: wn.retryPolicy,
      allowReject: wn.allowReject,
      maxRejectCount: wn.maxRejectCount,
    })
  }

  // Reorder nodes by topological sort
  const sorted = topologicalSort(nodes) ?? nodes

  return {
    version: "1.0",
    pipelineId,
    title: title ?? "(from pipeline)",
    description,
    nodes: sorted,
  }
}

// ── Blueprint patch types ──

type BlueprintUpdateAction =
  | { type: "addNode"; node: BlueprintNode }
  | { type: "removeNode"; nodeId: string }
  | { type: "updateNode"; nodeId: string; changes: Partial<BlueprintNode> }
  | { type: "setDeps"; nodeId: string; deps: string[] }
  | { type: "addDep"; nodeId: string; depId: string }
  | { type: "removeDep"; nodeId: string; depId: string }
  | { type: "setRoutes"; nodeId: string; routes: BlueprintRoute[] }

function applyActions(bp: Blueprint, actions: BlueprintUpdateAction[]): Blueprint {
  const nodes = [...bp.nodes.map((n) => ({ ...n, deps: [...n.deps], routes: n.routes ? [...n.routes] : undefined }))]

  for (const action of actions) {
    switch (action.type) {
      case "addNode": {
        if (nodes.some((n) => n.id === action.node.id)) {
          throw new Error(`Node "${action.node.id}" already exists.`)
        }
        nodes.push({ ...action.node, deps: [...action.node.deps], routes: action.node.routes ? [...action.node.routes] : undefined })
        break
      }
      case "removeNode": {
        const idx = nodes.findIndex((n) => n.id === action.nodeId)
        if (idx < 0) throw new Error(`Node "${action.nodeId}" not found.`)
        nodes.splice(idx, 1)
        // Clean up deps and routes referencing removed node
        for (const node of nodes) {
          node.deps = node.deps.filter((d) => d !== action.nodeId)
          if (node.routes) {
            node.routes = node.routes.filter((r) => r.targetNodeId !== action.nodeId)
          }
        }
        break
      }
      case "updateNode": {
        const node = nodes.find((n) => n.id === action.nodeId)
        if (!node) throw new Error(`Node "${action.nodeId}" not found.`)
        // Never allow changing id or type via update
        const { id: _id, type: _type, ...safeChanges } = action.changes
        Object.assign(node, safeChanges)
        break
      }
      case "setDeps": {
        const node = nodes.find((n) => n.id === action.nodeId)
        if (!node) throw new Error(`Node "${action.nodeId}" not found.`)
        node.deps = [...action.deps]
        break
      }
      case "addDep": {
        const node = nodes.find((n) => n.id === action.nodeId)
        if (!node) throw new Error(`Node "${action.nodeId}" not found.`)
        if (!nodes.some((n) => n.id === action.depId)) throw new Error(`Dependency "${action.depId}" not found.`)
        if (!node.deps.includes(action.depId)) node.deps.push(action.depId)
        break
      }
      case "removeDep": {
        const node = nodes.find((n) => n.id === action.nodeId)
        if (!node) throw new Error(`Node "${action.nodeId}" not found.`)
        node.deps = node.deps.filter((d) => d !== action.depId)
        break
      }
      case "setRoutes": {
        const node = nodes.find((n) => n.id === action.nodeId)
        if (!node) throw new Error(`Node "${action.nodeId}" not found.`)
        if (node.type !== "router") throw new Error(`Node "${action.nodeId}" is not a router node.`)
        node.routes = action.routes.map((r) => ({ ...r }))
        break
      }
    }
  }

  return { ...bp, nodes }
}

// ── Tool factory ──

interface BlueprintStore {
  saveBlueprint(convId: string, bp: unknown): Promise<void>
  loadBlueprint(convId: string): Promise<unknown>
  deleteBlueprint(convId: string): Promise<void>
}

/**
 * Create blueprint tools.
 * Uses BlueprintStore for persistent per-conversation blueprint state
 * and optional pipeline service/app references.
 */
export function createBlueprintTools(
  store: BlueprintStore,
  pipelineService?: any,
  pipelineRegistry?: any,
): Tool[] {
  const getOrThrow = async (convId: string): Promise<Blueprint> => {
    const bp = await store.loadBlueprint(convId)
    if (!bp) throw new Error("No active blueprint. Use blueprints_generate or blueprints_from_pipeline first.")
    return bp as Blueprint
  }

  return [
    // ── blueprints_generate ──
    {
      name: "blueprints_generate",
      description:
        "Generate a pipeline blueprint and render it as a DAG diagram. Use this first when designing a new pipeline. Do NOT call this more than once unless the user asks for a redesign.",
      parameters: {
        type: "object",
        properties: {
          blueprint: {
            type: "object",
            description: "The complete Blueprint object",
            properties: {
              version: { type: "string", enum: ["1.0"] },
              title: { type: "string", description: "Pipeline title" },
              description: { type: "string", description: "Optional description" },
              nodes: {
                type: "array",
                description: "All blueprint nodes in topological order",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    role: { type: "string", enum: ["planner", "coder", "tester", "reviewer", "operator"] },
                    agentId: { type: "string" },
                    instruction: { type: "string" },
                    type: { type: "string", enum: ["task", "router"] },
                    deps: { type: "array", items: { type: "string" } },
                    routes: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          value: { type: "string" },
                          targetNodeId: { type: "string" },
                        },
                        required: ["value", "targetNodeId"],
                      },
                    },
                    lane: { type: "string", enum: ["main", "branch"] },
                    retryPolicy: {
                      type: "object",
                      properties: {
                        maxAttempts: { type: "number" },
                        backoffMs: { type: "number" },
                      },
                    },
                    allowReject: { type: "boolean" },
                    maxRejectCount: { type: "number" },
                  },
                  required: ["id", "name", "role", "instruction", "type", "deps"],
                },
              },
            },
            required: ["version", "title", "nodes"],
          },
        },
        required: ["blueprint"],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: false },
      permission: "auto",
      async execute(args, ctx) {
        const blueprint = (args as any).blueprint as Blueprint
        const validation = validateBlueprint(blueprint)
        if (!validation.valid) {
          return {
            output: JSON.stringify(validation, null, 2),
            isError: true,
          }
        }
        await store.saveBlueprint(ctx.conversationId, blueprint)
        const nodeSummary = blueprint.nodes
          .map((n) => `${n.id} [${n.role}] → deps: [${n.deps.join(", ")}]${n.type === "router" ? ` → routes: ${n.routes?.map((r) => `${r.value}→${r.targetNodeId}`).join(", ")}` : ""}`)
          .join("\n  ")
        return {
          output: `Blueprint "${blueprint.title}" generated with ${blueprint.nodes.length} nodes:\n\n  ${nodeSummary}\n\nDAG rendered. STOP — wait for the user to review and respond.`,
          isError: false,
          attachments: [
            {
              type: "blueprint",
              mimeType: "application/json",
              data: JSON.stringify(blueprint, null, 2),
              name: "blueprint.json",
            },
          ],
        }
      },
    },

    // ── blueprints_update ──
    {
      name: "blueprints_update",
      description: "Edit the current blueprint. Batch multiple changes into one call for atomicity.",
      parameters: {
        type: "object",
        properties: {
          actions: {
            type: "array",
            description: "List of update actions to apply atomically",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["addNode", "removeNode", "updateNode", "setDeps", "addDep", "removeDep", "setRoutes"] },
                nodeId: { type: "string" },
                depId: { type: "string" },
                deps: { type: "array", items: { type: "string" } },
                routes: { type: "array" },
                changes: { type: "object" },
                node: { type: "object" },
              },
              required: ["type"],
            },
          },
        },
        required: ["actions"],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: false, idempotent: false },
      permission: "auto",
      async execute(args, ctx) {
        try {
          const bp = await getOrThrow(ctx.conversationId)
          const actions = (args as any).actions as BlueprintUpdateAction[]
          if (!actions || actions.length === 0) {
            return { output: "No actions provided.", isError: true }
          }
          const updated = applyActions(bp, actions)
          const validation = validateBlueprint(updated)
          if (!validation.valid) {
            return {
              output: JSON.stringify(validation, null, 2),
              isError: true,
            }
          }
          await store.saveBlueprint(ctx.conversationId, updated)
          const summary = actions.map((a) => {
            switch (a.type) {
              case "addNode": return `+ Added node "${a.node.id}"`
              case "removeNode": return `- Removed node "${a.nodeId}"`
              case "updateNode": return `~ Updated node "${a.nodeId}"`
              case "setDeps": return `→ Set deps for "${a.nodeId}": [${a.deps.join(", ")}]`
              case "addDep": return `+ Added dep "${a.depId}" → "${a.nodeId}"`
              case "removeDep": return `- Removed dep "${a.depId}" from "${a.nodeId}"`
              case "setRoutes": return `→ Set routes for "${a.nodeId}"`
            }
          }).join("\n")
          const nodeSummary = updated.nodes
            .map((n) => `${n.id} [${n.role}${n.agentId ? `, agent:${n.agentId}` : ""}] → deps: [${n.deps.join(", ")}]${n.type === "router" ? ` → routes: ${n.routes?.map((r) => `${r.value}→${r.targetNodeId}`).join(", ")}` : ""}`)
            .join("\n  ")
          return {
            output: `${actions.length} action(s) applied:\n${summary}\n\nBlueprint now has ${updated.nodes.length} nodes:\n\n  ${nodeSummary}\n\nDAG re-rendered.`,
            isError: false,
            attachments: [
              {
                type: "blueprint",
                mimeType: "application/json",
                data: JSON.stringify(updated, null, 2),
                name: "blueprint.json",
              },
            ],
          }
        } catch (err) {
          return {
            output: `Blueprint update failed: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
      },
    },

    // ── blueprints_from_pipeline ──
    {
      name: "blueprints_from_pipeline",
      description: "Derive a blueprint from an existing pipeline and render it as a DAG diagram.",
      parameters: {
        type: "object",
        properties: {
          pipelineId: { type: "string", description: "The pipeline ID to derive the blueprint from" },
        },
        required: ["pipelineId"],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute(args, ctx) {
        if (!pipelineService) return { output: "Pipeline service not available.", isError: true }
        const { pipelineId } = args as { pipelineId: string }
        try {
          const detail = pipelineService.getPipeline(pipelineId)
          if (!detail) return { output: `Pipeline "${pipelineId}" not found.`, isError: true }
          const workflow = detail.workflow as WorkflowDefinitionRuntime | undefined
          if (!workflow || !workflow.nodes) {
            return { output: `Pipeline "${pipelineId}" has no workflow definition.`, isError: true }
          }
          const blueprint = workflowToBlueprint(workflow, pipelineId, detail.title ?? pipelineId)
          await store.saveBlueprint(ctx.conversationId, blueprint)
          const nodeSummary = blueprint.nodes
            .map((n) => `${n.id} [${n.role}] → deps: [${n.deps.join(", ")}]${n.type === "router" ? ` → routes: ${n.routes?.map((r) => `${r.value}→${r.targetNodeId}`).join(", ")}` : ""}`)
            .join("\n  ")
          return {
            output: `Blueprint derived from pipeline "${pipelineId}" with ${blueprint.nodes.length} nodes:\n\n  ${nodeSummary}\n\nDAG rendered. STOP — wait for the user to review.`,
            isError: false,
            attachments: [
              {
                type: "blueprint",
                mimeType: "application/json",
                data: JSON.stringify(blueprint, null, 2),
                name: "blueprint.json",
              },
            ],
          }
        } catch (err) {
          return {
            output: `Failed to derive blueprint: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
      },
    },

    // ── blueprints_apply ──
    {
      name: "blueprints_apply",
      description: "Convert the current blueprint into a real pipeline. All task nodes must have agentId assigned. Only call this when the design has been confirmed.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
      permission: "confirm",
      async execute(args, ctx) {
        if (!pipelineRegistry) return { output: "Pipeline registry not available.", isError: true }
        try {
          const bp = await getOrThrow(ctx.conversationId)

          // Reject if any task node is missing agentId
          const missing = bp.nodes
            .filter((n) => n.type === "task" && !n.agentId)
            .map((n) => n.id)
          if (missing.length > 0) {
            return {
              output: `Cannot apply blueprint: ${missing.length} node(s) missing agent assignment: ${missing.join(", ")}.\nUse blueprints_update with updateNode (set agentId) before applying.`,
              isError: true,
            }
          }

          const workflow = blueprintToWorkflow(bp)

          // Derive pipeline id — if blueprint was derived from an existing pipeline,
          // this is an update. If it's a brand new blueprint, this is a create.
          const pipelineId =
            bp.pipelineId ??
            bp.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")

          const isExisting = !!bp.pipelineId

          // Step 1: Create or check existence
          let appliedId = pipelineId
          if (isExisting) {
            const existingRuntime = pipelineRegistry.getPipelineRuntime(appliedId)
            if (!existingRuntime) {
              return { output: `Pipeline "${appliedId}" not found (blueprint references non-existent pipeline).`, isError: true }
            }
          } else {
            try {
              await pipelineRegistry.createPipeline({ id: appliedId, title: bp.title })
            } catch (err: any) {
              const msg = err?.message ?? String(err)
              if (!msg.includes("already exists")) {
                return { output: `Failed to create pipeline "${appliedId}": ${msg}`, isError: true }
              }
              // already exists → treat as update
              appliedId = pipelineId
            }
          }

          // Step 2: Set the complete workflow
          const runtime = pipelineRegistry.getPipelineRuntime(appliedId)
          if (!runtime) {
            return { output: `Pipeline "${appliedId}" runtime not found.`, isError: true }
          }
          await runtime.workflow.setWorkflow(workflow)
          runtime.workflow.reconcileRunWithWorkflowChanges()
          runtime.runtime.emitPipeline()

          return {
            output: JSON.stringify(
              {
                pipelineId: appliedId,
                pipelineTitle: bp.title,
                nodeCount: workflow.nodes.length,
                edgesCreated: workflow.edges.length,
                message: isExisting ? "Pipeline updated from blueprint." : "Pipeline created from blueprint.",
              },
              null,
              2,
            ),
            isError: false,
          }
        } catch (err) {
          return {
            output: `Blueprint apply failed: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
      },
    },
  ]
}
