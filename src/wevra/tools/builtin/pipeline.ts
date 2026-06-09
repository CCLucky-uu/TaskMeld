import type { Tool } from "../../types"
import type { PipelineService } from "../../../services/pipeline-service"
import type { PipelineRegistry } from "../../../app/pipeline-registry"
import type { PluginRegistry } from "../../../pipeline/plugins/registry"
import { validateWorkflowGraph, validateWorkflowOutputConfig } from "../../../pipeline/workflow/validate"

export function createPipelineTools(
  pipeline?: PipelineService,
  app?: PipelineRegistry | null,
  pluginRegistry?: PluginRegistry | null,
): Tool[] {
  return [
    {
      name: "pipeline_list",
      description:
        "List all pipelines with their basic info (id, name, description, status). Use this to see what pipelines exist before creating or modifying one.",
      parameters: { type: "object", properties: {}, required: [] },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute() {
        if (!pipeline) return { output: "Pipeline service not available.", isError: true }
        const list = pipeline.listPipelines()
        if (list.length === 0) return { output: "No pipelines found.", isError: false }
        return {
          output: JSON.stringify(
            list.map((p) => ({ id: p.id, title: p.title })),
            null,
            2,
          ),
          isError: false,
        }
      },
    },
    {
      name: "pipeline_get",
      description:
        "Get detailed information about a specific pipeline including its nodes and edges. Use the pipeline ID from pipeline_list.",
      parameters: {
        type: "object",
        properties: {
          pipelineId: { type: "string", description: "The pipeline ID" },
        },
        required: ["pipelineId"],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute(args) {
        if (!pipeline) return { output: "Pipeline service not available.", isError: true }
        const { pipelineId } = args as { pipelineId: string }
        const detail = pipeline.getPipeline(pipelineId)
        if (!detail) return { output: `Pipeline "${pipelineId}" not found.`, isError: true }

        const run = detail.run
        const workflow = detail.workflow
        const nodes = workflow?.nodes ?? []
        const edges = workflow?.edges ?? []

        return {
          output: JSON.stringify(
            {
              id: detail.pipelineId,
              title: detail.title,
              runStatus: run?.status ?? "unknown",
              scheduler: detail.scheduler,
              nodes: nodes.map((n: any) => ({
                id: n.id,
                title: n.title ?? n.name ?? n.id,
                type: n.type ?? n.executor ?? "unknown",
                description: n.instruction ?? n.description ?? "",
              })),
              edges: edges.map((e: any) => ({
                from: e.source ?? e.from,
                to: e.target ?? e.to,
              })),
            },
            null,
            2,
          ),
          isError: false,
        }
      },
    },
    {
      name: "pipeline_create",
      description:
        "Create a new pipeline. Provide an ID and optional title. The ID must be alphanumeric with hyphens/underscores.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Pipeline ID (alphanumeric, hyphens, underscores)" },
          title: { type: "string", description: "Pipeline title (optional, defaults to ID)" },
        },
        required: ["id"],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
      permission: "confirm",
      async execute(args) {
        if (!app) return { output: "Pipeline registry not available.", isError: true }
        const { id, title } = args as { id: string; title?: string }
        try {
          const def = await app.createPipeline({ id, title })
          return {
            output: JSON.stringify(
              { id: def.id, title: def.title, message: "Pipeline created successfully." },
              null,
              2,
            ),
            isError: false,
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { output: `Failed to create pipeline: ${msg}`, isError: true }
        }
      },
    },
    {
      name: "pipeline_update",
      description: "Rename an existing pipeline.",
      parameters: {
        type: "object",
        properties: {
          pipelineId: { type: "string", description: "The pipeline ID to rename" },
          title: { type: "string", description: "New title" },
        },
        required: ["pipelineId", "title"],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
      permission: "confirm",
      async execute(args) {
        if (!app) return { output: "Pipeline registry not available.", isError: true }
        const { pipelineId, title } = args as { pipelineId: string; title: string }
        try {
          app.renamePipeline(pipelineId, title)
          return { output: `Pipeline "${pipelineId}" renamed to "${title}".`, isError: false }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { output: `Failed to rename pipeline: ${msg}`, isError: true }
        }
      },
    },
    {
      name: "pipeline_delete",
      description: "Delete a pipeline permanently. Cannot delete the last remaining pipeline or a running pipeline.",
      parameters: {
        type: "object",
        properties: {
          pipelineId: { type: "string", description: "The pipeline ID to delete" },
        },
        required: ["pipelineId"],
      },
      annotations: { readOnly: false, destructive: true, requiresConfirmation: true, idempotent: false },
      permission: "confirm",
      async execute(args) {
        if (!app) return { output: "Pipeline registry not available.", isError: true }
        const { pipelineId } = args as { pipelineId: string }
        try {
          app.deletePipeline(pipelineId)
          return { output: `Pipeline "${pipelineId}" deleted.`, isError: false }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { output: `Failed to delete pipeline: ${msg}`, isError: true }
        }
      },
    },
    {
      name: "pipeline_status",
      description: "Check the current run status of a pipeline (idle, running, completed, failed).",
      parameters: {
        type: "object",
        properties: {
          pipelineId: { type: "string", description: "The pipeline ID" },
        },
        required: ["pipelineId"],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute(args) {
        if (!pipeline) return { output: "Pipeline service not available.", isError: true }
        const { pipelineId } = args as { pipelineId: string }
        const result = pipeline.getPipelineExecutionStatus(pipelineId)
        if (!result.ok) return { output: `Pipeline "${pipelineId}" not found.`, isError: true }
        return { output: JSON.stringify(result, null, 2), isError: false }
      },
    },
    {
      name: "pipeline_diagnose",
      description:
        "Analyze why a pipeline run failed. Examines run logs, error messages, and artifacts to identify the root cause.",
      parameters: {
        type: "object",
        properties: {
          pipelineId: { type: "string", description: "The pipeline ID" },
          runId: { type: "string", description: "Optional specific run ID" },
        },
        required: ["pipelineId"],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute(args) {
        if (!pipeline) return { output: "Pipeline service not available.", isError: true }
        const { pipelineId } = args as { pipelineId: string }
        const detail = pipeline.getPipeline(pipelineId)
        if (!detail) return { output: `Pipeline "${pipelineId}" not found.`, isError: true }

        const run = detail.run
        const nodes = run?.nodes ?? []
        const failedNodes = nodes.filter((n: any) => n.status === "failed")
        const stoppedNodes = nodes.filter((n: any) => n.status === "stopped")

        if (failedNodes.length === 0 && stoppedNodes.length === 0) {
          return {
            output: JSON.stringify(
              {
                pipelineId,
                diagnosis: `Pipeline is "${run?.status ?? "unknown"}". No failed or stopped nodes found.`,
                runStatus: run?.status,
              },
              null,
              2,
            ),
            isError: false,
          }
        }

        const issues = [...failedNodes, ...stoppedNodes].map((n: any) => ({
          nodeId: n.id,
          title: n.title,
          status: n.status,
          lastError: n.lastError ?? null,
          attempt: n.attempt,
          rejectCount: n.rejectCount,
          startedAt: n.startedAt,
          finishedAt: n.finishedAt,
        }))

        return {
          output: JSON.stringify(
            {
              pipelineId,
              runStatus: run?.status,
              runId: run?.id,
              failedNodes: issues.length,
              issues,
            },
            null,
            2,
          ),
          isError: false,
        }
      },
    },
    {
      name: "pipeline_validate",
      description:
        "Validate a pipeline's workflow without running it. Checks graph structure (cycles, edges), routing constraints, parallel group integrity, and output configuration. Returns all issues found so they can be fixed before attempting a run.",
      parameters: {
        type: "object",
        properties: {
          pipelineId: { type: "string", description: "The pipeline ID to validate" },
        },
        required: ["pipelineId"],
      },
      annotations: { readOnly: true, destructive: false, requiresConfirmation: false, idempotent: true },
      permission: "auto",
      async execute(args) {
        if (!app) return { output: "Pipeline registry not available.", isError: true }
        const { pipelineId } = args as { pipelineId: string }
        const runtime = app.getPipelineRuntime(pipelineId)
        if (!runtime) return { output: `Pipeline "${pipelineId}" not found.`, isError: true }
        const workflow = runtime.workflow.getWorkflow()
        if (!workflow) return { output: "Workflow not available.", isError: true }

        const errors: string[] = []

        const graphResult = validateWorkflowGraph(workflow)
        if (!graphResult.ok) errors.push(graphResult.detail ?? graphResult.error)

        const outputResult = validateWorkflowOutputConfig(workflow)
        if (!outputResult.ok) errors.push(outputResult.detail ?? outputResult.error)

        if (errors.length === 0) {
          return {
            output: JSON.stringify(
              { pipelineId, valid: true, nodeCount: workflow.nodes.length, edgeCount: workflow.edges.length },
              null,
              2,
            ),
            isError: false,
          }
        }

        return {
          output: JSON.stringify({ pipelineId, valid: false, errors }, null, 2),
          isError: false,
        }
      },
    },
    {
      name: "pipeline_run",
      description: "Start running a pipeline. The pipeline must have at least one node.",
      parameters: {
        type: "object",
        properties: {
          pipelineId: { type: "string", description: "The pipeline ID to run" },
        },
        required: ["pipelineId"],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
      permission: "confirm",
      async execute(args) {
        if (!pipeline) return { output: "Pipeline service not available.", isError: true }
        const { pipelineId } = args as { pipelineId: string }
        try {
          const result = await pipeline.runPipeline(pipelineId)
          return { output: JSON.stringify(result, null, 2), isError: false }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { output: `Failed to run pipeline: ${msg}`, isError: true }
        }
      },
    },
    {
      name: "pipeline_stop",
      description: "Stop a running pipeline.",
      parameters: {
        type: "object",
        properties: {
          pipelineId: { type: "string", description: "The pipeline ID to stop" },
        },
        required: ["pipelineId"],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
      permission: "confirm",
      async execute(args) {
        if (!pipeline) return { output: "Pipeline service not available.", isError: true }
        const { pipelineId } = args as { pipelineId: string }
        try {
          const result = pipeline.stopPipeline(pipelineId)
          return { output: JSON.stringify(result, null, 2), isError: false }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { output: `Failed to stop pipeline: ${msg}`, isError: true }
        }
      },
    },
  ]
}

export function createPipelinePluginTool(
  app?: PipelineRegistry | null,
  pluginRegistry?: PluginRegistry | null,
): Tool[] {
  return [
    {
      name: "pipeline_plugin",
      description: `Manage pipeline plugins (remote-batch, scheduler, etc.).

Actions:
- list: List all plugins for a pipeline with their status and config
- get: Get a specific plugin's current config
- enable: Enable a plugin
- disable: Disable a plugin
- config: Update plugin config (shallow merge with existing)

Available plugins and their config:
- remote-batch (dataSource): url (string), batchSize (number, default 5), startBatch (number, default 1), sourceField (string, default "list30")
- scheduler (scheduler): no extra config, just enable/disable`,
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "get", "enable", "disable", "config"],
            description: "The action to perform",
          },
          pipelineId: { type: "string", description: "The pipeline ID" },
          pluginId: {
            type: "string",
            description: 'The plugin ID (e.g. "remote-batch", "scheduler"). Required for get/enable/disable/config.',
          },
          config: { type: "object", description: "Plugin config to merge. Only for config action." },
        },
        required: ["action", "pipelineId"],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
      permission: "confirm",
      async execute(args) {
        if (!app) return { output: "Pipeline registry not available.", isError: true }
        const { action, pipelineId, pluginId, config } = args as {
          action: string
          pipelineId: string
          pluginId?: string
          config?: Record<string, unknown>
        }

        const runtime = app.getPipelineRuntime(pipelineId)
        if (!runtime) return { output: `Pipeline "${pipelineId}" not found.`, isError: true }
        const definition = app.getPipelineDefinition(pipelineId)
        if (!definition) return { output: `Pipeline "${pipelineId}" definition not found.`, isError: true }

        const workflow = runtime.workflow.getWorkflow()
        if (!workflow) return { output: "Workflow not available.", isError: true }

        const plugins = Array.isArray(workflow.plugins) ? workflow.plugins : []

        switch (action) {
          case "list": {
            const allRegistered = pluginRegistry?.list() ?? []
            const list = allRegistered.map((meta) => {
              const inst = plugins.find((p) => p.pluginId === meta.id)
              return {
                pluginId: meta.id,
                name: meta.name,
                type: meta.type,
                enabled: inst?.enabled ?? false,
                configured: !!inst,
                config: inst?.config ?? {},
              }
            })
            // Also show any workflow plugins not in registry (custom/unknown)
            for (const inst of plugins) {
              if (!allRegistered.some((r) => r.id === inst.pluginId)) {
                list.push({
                  pluginId: inst.pluginId,
                  name: inst.pluginId,
                  type: "unknown" as any,
                  enabled: inst.enabled,
                  configured: true,
                  config: inst.config,
                })
              }
            }
            if (list.length === 0) return { output: "No plugins available.", isError: false }
            return { output: JSON.stringify(list, null, 2), isError: false }
          }

          case "get": {
            if (!pluginId) return { output: "pluginId is required for get action.", isError: true }
            const inst = plugins.find((p) => p.pluginId === pluginId)
            if (!inst) return { output: `Plugin "${pluginId}" not found in pipeline "${pipelineId}".`, isError: true }
            const meta = pluginRegistry?.get(pluginId)
            return {
              output: JSON.stringify(
                {
                  pluginId: inst.pluginId,
                  name: meta?.name ?? inst.pluginId,
                  type: meta?.type ?? "unknown",
                  enabled: inst.enabled,
                  config: inst.config,
                },
                null,
                2,
              ),
              isError: false,
            }
          }

          case "enable": {
            if (!pluginId) return { output: "pluginId is required for enable action.", isError: true }
            const idx = plugins.findIndex((p) => p.pluginId === pluginId)
            let nextPlugins
            if (idx < 0) {
              // Plugin doesn't exist yet — create it with default config
              const meta = pluginRegistry?.get(pluginId)
              const defaultConfig = meta?.defaultConfig ?? {}
              nextPlugins = [...plugins, { pluginId, enabled: true, config: { ...defaultConfig } }]
            } else {
              nextPlugins = [...plugins]
              nextPlugins[idx] = { ...nextPlugins[idx], enabled: true }
            }
            const nextWorkflow = { ...workflow, plugins: nextPlugins }
            await runtime.workflow.setWorkflow(nextWorkflow)
            runtime.workflow.reconcileRunWithWorkflowChanges()
            runtime.runtime.emitPipeline()
            return { output: `Plugin "${pluginId}" enabled on pipeline "${pipelineId}".`, isError: false }
          }

          case "disable": {
            if (!pluginId) return { output: "pluginId is required for disable action.", isError: true }
            const idx = plugins.findIndex((p) => p.pluginId === pluginId)
            if (idx < 0) return { output: `Plugin "${pluginId}" not found.`, isError: true }
            const nextPlugins = [...plugins]
            nextPlugins[idx] = { ...nextPlugins[idx], enabled: false }

            // Side effect: if disabling remote-batch, cancel active batch run
            if (pluginId === "remote-batch" && runtime.pipeline.getBatchRunState().status === "running") {
              runtime.pipeline.cancelBatchRun()
            }
            // Side effect: if disabling scheduler, also disable scheduler in workflow
            const nextScheduler =
              pluginId === "scheduler" ? { ...workflow.scheduler, enabled: false } : workflow.scheduler

            const nextWorkflow = { ...workflow, plugins: nextPlugins, scheduler: nextScheduler }
            await runtime.workflow.setWorkflow(nextWorkflow)
            runtime.workflow.reconcileRunWithWorkflowChanges()
            runtime.runtime.emitPipeline()
            return { output: `Plugin "${pluginId}" disabled on pipeline "${pipelineId}".`, isError: false }
          }

          case "config": {
            if (!pluginId) return { output: "pluginId is required for config action.", isError: true }
            if (!config || typeof config !== "object")
              return { output: "config object is required for config action.", isError: true }
            const idx = plugins.findIndex((p) => p.pluginId === pluginId)
            let nextPlugins
            if (idx < 0) {
              // Plugin doesn't exist yet — create it with provided config merged with defaults
              const meta = pluginRegistry?.get(pluginId)
              const defaultConfig = meta?.defaultConfig ?? {}
              nextPlugins = [...plugins, { pluginId, enabled: true, config: { ...defaultConfig, ...config } }]
            } else {
              const existing = plugins[idx]
              nextPlugins = [...plugins]
              nextPlugins[idx] = { ...existing, config: { ...existing.config, ...config } }
            }
            const nextWorkflow = { ...workflow, plugins: nextPlugins }
            await runtime.workflow.setWorkflow(nextWorkflow)
            runtime.workflow.reconcileRunWithWorkflowChanges()
            runtime.runtime.emitPipeline()
            const saved = nextPlugins.find((p) => p.pluginId === pluginId)
            return {
              output: `Plugin "${pluginId}" config updated on pipeline "${pipelineId}". Config: ${JSON.stringify(saved?.config)}`,
              isError: false,
            }
          }

          default:
            return {
              output: `Unknown action "${action}". Valid actions: list, get, enable, disable, config.`,
              isError: true,
            }
        }
      },
    },
  ]
}

export function createPipelineNodeTool(app?: PipelineRegistry | null): Tool[] {
  return [
    {
      name: "pipeline_node",
      description: `Manage nodes and edges within a pipeline workflow.

Actions:
- add: Add a NEW node to the pipeline (requires nodeId, instruction, agentId). Only use when creating a node that does not exist yet.
- update: Modify an existing node's properties. Supports: name, instruction, agentId, sessionId, role, enabled, allowReject, maxRejectCount, lane, routePolicy, retryPolicy, dependsOn. Only provided fields are changed; omitted fields are kept.
- delete: Remove a node and all its connected edges. Use sparingly.
- connect: Add a single dependency or route edge between two existing nodes.

CRITICAL RULES:
1. When the user asks to change, fix, reconfigure, or adjust an existing node, ALWAYS use "update". NEVER delete and recreate a node to modify it — this would lose execution history and break downstream references.
2. To change a node's upstream dependencies, use "update" with dependsOn (full replacement of all upstreams). To add a single dependency without replacing others, use "connect" instead.
3. Before adding a node, call agent_list to discover available agents and use their ID for agentId.
4. Normal connect creates a dependency edge. Only use the route parameter when connecting FROM a router node to a specific branch target.

Node types: "task" (default), "router" (for branching with routePolicy)
Executor roles: "planner", "coder", "tester", "reviewer", "operator"

── Node Output Format (ResultEnvelope) ──
Every node, when executed by an Agent, outputs a structured JSON receipt. When writing a node's instruction, you MUST describe the expected artifact.content structure to the executing Agent. The system handles envelope fields (runId, nodeId, requestId, sessionId) automatically.

Standard ResultEnvelope (for reference — do NOT include in instruction):
{
  "version": "2.0",
  "runId": "<system-provided>",
  "nodeId": "<system-provided>",
  "requestId": "<system-provided>",
  "sessionId": "<system-provided>",
  "status": "success" | "failed",
  "artifacts": [{
    "type": "<must match this node's outputSpec.type>",
    "schemaVersion": <must match this node's outputSpec.schemaVersion>,
    "name": "primary",
    "content": <any JSON value — the actual deliverable>,
    "meta": {}
  }],
  "logs": [],
  "error": null
}

Instruction writing rules:
- Tell the Agent WHAT to do (specific task, not vague)
- Tell the Agent WHAT upstream data is available and its expected structure
- Tell the Agent WHAT to put in artifact.content (give an example if non-trivial)
- For large output: instruct Agent to save to file, put { filePath, summary } in artifact.content
- For routing nodes: instruct Agent to output artifact.content as array with "route" field per entry
- outputSpec.type must be a descriptive identifier (e.g. "analysis-report", "code-change", "test-result")`,
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["add", "update", "delete", "connect"],
            description:
              "Action: 'add' (create new node), 'update' (modify existing node — preferred for any change to an existing node), 'delete' (remove node), 'connect' (add single edge)",
          },
          pipelineId: { type: "string", description: "The pipeline ID" },
          nodeId: { type: "string", description: "The node ID (for add/update/delete)" },
          name: { type: "string", description: "Node display name (for add/update)" },
          instruction: {
            type: "string",
            description: "Instruction for the agent executing this node (for add/update)",
          },
          role: {
            type: "string",
            enum: ["planner", "coder", "tester", "reviewer", "operator"],
            description: "Executor role (for add/update)",
          },
          agentId: {
            type: "string",
            description: "Agent ID to execute this node (required). Call agent_list first to see available agents.",
          },
          type: { type: "string", enum: ["task", "router"], description: 'Node type (for add, default "task")' },
          routePolicy: {
            type: "array",
            items: { type: "string" },
            description:
              'Route values for router nodes (for add: e.g. ["yes", "no"]; for update: set to null to remove routing)',
          },
          dependsOn: {
            type: "array",
            items: { type: "string" },
            description:
              "Upstream node IDs. For add: creates dependency edges. For update: replaces all upstream dependencies (full rewrite, not incremental).",
          },
          enabled: { type: "boolean", description: "Enable/disable node (for update)" },
          allowReject: { type: "boolean", description: "Allow agent to reject (for update)" },
          maxRejectCount: { type: "number", description: "Max reject attempts (for update)" },
          sessionId: {
            type: "string",
            description: "Session binding ID (for update, e.g. agent:codex:main). Omit to keep current.",
          },
          lane: {
            type: "string",
            enum: ["main", "branch"],
            description: "Node lane (for update): main = primary execution path, branch = conditional path.",
          },
          retryPolicy: {
            type: "object",
            properties: {
              maxAttempts: { type: "number" },
              backoffMs: { type: "number" },
            },
            description: "Retry policy (for update, partial merge: only provided fields are changed)",
          },
          from: { type: "string", description: "Upstream node ID (for connect)" },
          to: { type: "string", description: "Downstream node ID (for connect)" },
          route: {
            type: "string",
            description:
              'Route value for conditional routing from router nodes (e.g. "yes", "no"). Only use when connecting FROM a router node to a branch. Omit for normal dependency edges.',
          },
        },
        required: ["action", "pipelineId"],
      },
      annotations: { readOnly: false, destructive: false, requiresConfirmation: true, idempotent: false },
      permission: "confirm",
      async execute(args) {
        if (!app) return { output: "Pipeline registry not available.", isError: true }
        const a = args as Record<string, unknown>
        const action = a.action as string
        const pipelineId = a.pipelineId as string

        const runtime = app.getPipelineRuntime(pipelineId)
        if (!runtime) return { output: `Pipeline "${pipelineId}" not found.`, isError: true }
        const definition = app.getPipelineDefinition(pipelineId)
        if (!definition) return { output: `Pipeline definition "${pipelineId}" not found.`, isError: true }
        const workflow = runtime.workflow.getWorkflow()
        if (!workflow) return { output: "Workflow not available.", isError: true }

        switch (action) {
          case "add": {
            const nodeId = a.nodeId as string
            if (!nodeId) return { output: "nodeId is required for add action.", isError: true }
            if (workflow.nodes.some((n) => n.id === nodeId)) {
              return { output: `Node "${nodeId}" already exists.`, isError: true }
            }
            const instruction = a.instruction as string
            if (!instruction) return { output: "instruction is required for add action.", isError: true }
            const agentId = a.agentId as string
            if (!agentId?.trim())
              return {
                output:
                  "agentId is required. Call agent_list first to see available agents, then specify which agent should execute this node.",
                isError: true,
              }

            const dependsOn = a.dependsOn as string[] | undefined
            if (workflow.nodes.length > 0 && (!dependsOn || dependsOn.length === 0)) {
              return {
                output:
                  "dependsOn is required when adding a node to a pipeline that already has nodes. Specify which upstream node(s) this node depends on.",
                isError: true,
              }
            }

            const nodeType = (a.type as string) || "task"
            const routePolicyValues = a.routePolicy as string[] | undefined
            if (nodeType === "router") {
              if (!routePolicyValues || routePolicyValues.length < 2) {
                return {
                  output: 'Router nodes require routePolicy with at least 2 values (e.g. ["yes", "no"]).',
                  isError: true,
                }
              }
              // Ensure "yes" and "no" are always present (validation requirement)
              if (!routePolicyValues.includes("yes")) routePolicyValues.push("yes")
              if (!routePolicyValues.includes("no")) routePolicyValues.push("no")
            }

            const node: any = {
              id: nodeId,
              name: (a.name as string) || nodeId,
              type: nodeType,
              enabled: true,
              isMainline: true,
              lane: "main",
              parallelGroupId: null,
              executor: {
                agentId: agentId.trim(),
                role: (a.role as string) || "coder",
                fallbackAgentId: null,
                sessionId: `agent:${agentId.trim()}:main`,
              },
              inputMode: "single",
              outputMode: "single",
              dependencyPolicy: "all",
              routePolicy: routePolicyValues ? { allowed: routePolicyValues } : null,
              retryPolicy: { maxAttempts: 2, backoffMs: 0 },
              outputSpec: { type: "structured", schemaVersion: 1 },
              instruction,
              allowReject: false,
              maxRejectCount: 3,
            }

            const nextNodes = [...workflow.nodes, node]
            const nextEdges = [...workflow.edges]
            if (dependsOn?.length) {
              for (const depId of dependsOn) {
                if (!workflow.nodes.some((n) => n.id === depId)) {
                  return { output: `Dependency node "${depId}" not found.`, isError: true }
                }
                nextEdges.push({ from: depId, to: nodeId, when: null })
              }
            }

            const nextWorkflow = { ...workflow, nodes: nextNodes, edges: nextEdges }
            await runtime.workflow.setWorkflow(nextWorkflow)
            runtime.workflow.reconcileRunWithWorkflowChanges()
            runtime.runtime.emitPipeline()

            return {
              output: JSON.stringify(
                {
                  message: `Node "${nodeId}" added to pipeline "${pipelineId}".`,
                  node: {
                    id: node.id,
                    name: node.name,
                    type: node.type,
                    role: node.executor.role,
                    instruction: node.instruction,
                  },
                  edgesAdded: dependsOn?.length ?? 0,
                },
                null,
                2,
              ),
              isError: false,
            }
          }

          case "update": {
            const nodeId = a.nodeId as string
            if (!nodeId) return { output: "nodeId is required for update action.", isError: true }
            const idx = workflow.nodes.findIndex((n) => n.id === nodeId)
            if (idx < 0) return { output: `Node "${nodeId}" not found.`, isError: true }

            const existing = workflow.nodes[idx] as any
            const updated = { ...existing }
            const changes: string[] = []

            if (a.name !== undefined) {
              updated.name = a.name
              changes.push("name")
            }
            if (a.instruction !== undefined) {
              updated.instruction = a.instruction
              changes.push("instruction")
            }
            if (a.enabled !== undefined) {
              updated.enabled = a.enabled
              changes.push("enabled")
            }
            if (a.allowReject !== undefined) {
              updated.allowReject = a.allowReject
              changes.push("allowReject")
            }
            if (a.maxRejectCount !== undefined) {
              updated.maxRejectCount = a.maxRejectCount
              changes.push("maxRejectCount")
            }
            if (a.role !== undefined) {
              updated.executor = { ...updated.executor, role: a.role }
              changes.push("role")
            }
            if (a.agentId !== undefined) {
              updated.executor = { ...updated.executor, agentId: a.agentId }
              changes.push("agentId")
            }
            if (a.sessionId !== undefined) {
              updated.executor = { ...updated.executor, sessionId: a.sessionId }
              changes.push("sessionId")
            }
            if (a.lane !== undefined) {
              const lane = a.lane === "branch" ? "branch" : "main"
              updated.lane = lane
              updated.isMainline = lane !== "branch"
              changes.push("lane")
            }
            if (a.routePolicy !== undefined) {
              if (Array.isArray(a.routePolicy) && a.routePolicy.length >= 2) {
                updated.routePolicy = { allowed: a.routePolicy }
              } else if (a.routePolicy === null) {
                updated.routePolicy = null
              }
              changes.push("routePolicy")
            }
            if (a.retryPolicy !== undefined && typeof a.retryPolicy === "object") {
              updated.retryPolicy = { ...updated.retryPolicy, ...a.retryPolicy }
              changes.push("retryPolicy")
            }

            const nextNodes = [...workflow.nodes]
            nextNodes[idx] = updated

            // Rebuild edges if dependsOn changed
            let nextEdges = workflow.edges
            if (Array.isArray(a.dependsOn)) {
              const newDeps = (a.dependsOn as string[]).map((d: string) => d.trim()).filter(Boolean)
              const validIds = new Set(workflow.nodes.map((n) => n.id))
              const invalidDep = newDeps.find((d: string) => !validIds.has(d) || d === nodeId)
              if (invalidDep)
                return { output: `Dependency "${invalidDep}" not found or is self-referencing.`, isError: true }

              // Remove old dependency edges for this node, add new ones
              nextEdges = [
                ...workflow.edges.filter((e) => !(e.to === nodeId && e.when === null)),
                ...newDeps.map((dep: string) => ({ from: dep, to: nodeId, when: null })),
              ]
              changes.push("dependsOn")
            }

            const nextWorkflow = { ...workflow, nodes: nextNodes, edges: nextEdges }
            await runtime.workflow.setWorkflow(nextWorkflow)
            runtime.workflow.reconcileRunWithWorkflowChanges()
            runtime.runtime.emitPipeline()

            return {
              output: JSON.stringify(
                {
                  message: `Node "${nodeId}" updated. Changed: ${changes.join(", ")}.`,
                  node: {
                    id: updated.id,
                    name: updated.name,
                    type: updated.type,
                    enabled: updated.enabled,
                    lane: updated.lane,
                    role: updated.executor.role,
                    agentId: updated.executor.agentId,
                    instruction: updated.instruction,
                    dependsOn: nextEdges.filter((e) => e.to === nodeId && e.when === null).map((e) => e.from),
                  },
                },
                null,
                2,
              ),
              isError: false,
            }
          }

          case "delete": {
            const nodeId = a.nodeId as string
            if (!nodeId) return { output: "nodeId is required for delete action.", isError: true }
            if (!workflow.nodes.some((n) => n.id === nodeId)) {
              return { output: `Node "${nodeId}" not found.`, isError: true }
            }

            const nextNodes = workflow.nodes.filter((n) => n.id !== nodeId)
            const removedEdges = workflow.edges.filter((e) => (e as any).from === nodeId || (e as any).to === nodeId)
            const nextEdges = workflow.edges.filter((e) => (e as any).from !== nodeId && (e as any).to !== nodeId)
            const nextGroups = (workflow.groups ?? [])
              .map((g) => ({
                ...g,
                members: g.members.filter((m) => m !== nodeId),
              }))
              .filter((g) => g.members.length > 0)

            const nextWorkflow = { ...workflow, nodes: nextNodes, edges: nextEdges, groups: nextGroups }
            await runtime.workflow.setWorkflow(nextWorkflow)
            runtime.workflow.reconcileRunWithWorkflowChanges()
            runtime.runtime.emitPipeline()

            return {
              output: JSON.stringify(
                {
                  message: `Node "${nodeId}" deleted from pipeline "${pipelineId}".`,
                  removedEdges: removedEdges.length,
                  remainingNodes: nextNodes.length,
                },
                null,
                2,
              ),
              isError: false,
            }
          }

          case "connect": {
            const from = a.from as string
            const to = a.to as string
            if (!from || !to) return { output: "from and to are required for connect action.", isError: true }
            if (!workflow.nodes.some((n) => n.id === from))
              return { output: `Source node "${from}" not found.`, isError: true }
            if (!workflow.nodes.some((n) => n.id === to))
              return { output: `Target node "${to}" not found.`, isError: true }

            const routeValue = (a.route as string | undefined)?.trim()

            const exists = workflow.edges.some((e) => {
              if (e.from !== from || e.to !== to) return false
              if (routeValue) return e.when === routeValue
              return e.when === null
            })
            if (exists) return { output: `Edge from "${from}" to "${to}" already exists.`, isError: true }

            const edge = routeValue ? { from, to, when: routeValue } : { from, to, when: null }

            const nextWorkflow = { ...workflow, edges: [...workflow.edges, edge] }
            await runtime.workflow.setWorkflow(nextWorkflow)
            runtime.workflow.reconcileRunWithWorkflowChanges()
            runtime.runtime.emitPipeline()

            return {
              output: JSON.stringify(
                {
                  message: `Edge added: ${from} → ${to}${edge.when != null ? ` (route="${edge.when}")` : " (dependency)"}.`,
                  edge,
                },
                null,
                2,
              ),
              isError: false,
            }
          }

          default:
            return { output: `Unknown action "${action}". Valid actions: add, update, delete, connect.`, isError: true }
        }
      },
    },
  ]
}
