import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveTaskMeldDataPath } from "../../app/data-dir";
import { defaultTemplateNodes, defaultWorkflowDefinition } from "./defaults";
import { mergeTemplateNodesIntoWorkflow, workflowToTemplateNodes } from "./template-mapper";
import { readWorkflowDefinitionFromRawDetailed } from "./normalize";
import { validateWorkflowDefinition, validateWorkflowOutputConfig } from "./validate";
export { validateWorkflowDefinition, validateWorkflowOutputConfig } from "./validate";
import type { WorkflowDefinitionRuntime } from "../types/workflow";
import type {
  PipelineTemplateNode,
  WorkflowPersistedV3,
  WorkflowStorageOptions,
} from "../types/workflow";

const TEMPLATE_FILE = resolveTaskMeldDataPath("pipeline-template.json");

export const loadWorkflowDefinition = (): WorkflowDefinitionRuntime => {
  return loadWorkflowDefinitionWithStorage({});
};

export const loadWorkflowDefinitionWithStorage = (options: WorkflowStorageOptions): WorkflowDefinitionRuntime => {
  const workflowFilePath = options.workflowFilePath ?? TEMPLATE_FILE;
  if (!existsSync(workflowFilePath)) {
    return defaultWorkflowDefinition();
  }
  try {
    const raw = readFileSync(workflowFilePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const readResult = readWorkflowDefinitionFromRawDetailed(parsed);
    if (readResult.ok) return readResult.workflow;
    const error = new Error("invalid_persisted_workflow_definition");
    (error as Error & { detail?: string }).detail = readResult.detail;
    throw error;
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_persisted_workflow_definition") {
      throw error;
    }
    const wrapped = new Error("invalid_persisted_workflow_definition");
    (wrapped as Error & { detail?: string }).detail = "Failed to parse workflow file, please check JSON format";
    throw wrapped;
  }
};

export const saveWorkflowDefinition = (workflow: WorkflowDefinitionRuntime) => {
  saveWorkflowDefinitionWithStorage(workflow, {});
};

export const saveWorkflowDefinitionWithStorage = (
  workflow: WorkflowDefinitionRuntime,
  options: WorkflowStorageOptions,
) => {
  const validation = validateWorkflowDefinition(workflow);
  if (!validation.ok) {
    const error = new Error(validation.error);
    (error as Error & { detail?: string }).detail = validation.detail;
    throw error;
  }
  const outputValidation = validateWorkflowOutputConfig(workflow);
  if (!outputValidation.ok) {
    const error = new Error(outputValidation.error);
    (error as Error & { detail?: string }).detail = outputValidation.detail;
    throw error;
  }
  const workflowFilePath = options.workflowFilePath ?? TEMPLATE_FILE;
  mkdirSync(dirname(workflowFilePath), { recursive: true });
  const persisted: WorkflowPersistedV3 = {
    ...workflow,
    version: "3.0",
    edges: workflow.edges.map((edge) =>
      edge.when === null
        ? { from: edge.from, to: edge.to, kind: "dependency" as const }
        : { from: edge.from, to: edge.to, kind: "route" as const, route: edge.when },
    ),
  };
  writeFileSync(workflowFilePath, JSON.stringify(persisted, null, 2), "utf8");
};

export const loadPipelineTemplate = (): PipelineTemplateNode[] => {
  return loadPipelineTemplateWithStorage({});
};

export const loadPipelineTemplateWithStorage = (options: WorkflowStorageOptions): PipelineTemplateNode[] => {
  const workflow = loadWorkflowDefinitionWithStorage(options);
  const legacy = workflowToTemplateNodes(workflow);
  return legacy;
};

export const savePipelineTemplate = (nodes: PipelineTemplateNode[]) => {
  savePipelineTemplateWithStorage(nodes, {});
};

export const savePipelineTemplateWithStorage = (
  nodes: PipelineTemplateNode[],
  options: WorkflowStorageOptions,
) => {
  const current = loadWorkflowDefinitionWithStorage(options);
  const merged = mergeTemplateNodesIntoWorkflow(current, nodes);
  saveWorkflowDefinitionWithStorage(merged, options);
};
