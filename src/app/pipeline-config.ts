import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveTaskMeldDataPath } from "./data-dir";

export type PipelineId = string;

export type PipelineDefinition = {
  id: PipelineId;
  title: string;
  workflowFilePath: string;
  runStateFile: string;
  artifactDir: string;
};

export type PipelineDefinitionItem = {
  id: PipelineId;
  title: string;
};

export type PipelineDefinitionsDocument = {
  version: 1;
  defaultPipelineId: PipelineId;
  items: PipelineDefinitionItem[];
};

export const DEFAULT_REMOTE_BATCH_URL = String(
  process.env.OPENCLAW_PIPELINE_POOL_URL ?? "",
).trim();

const PIPELINE_ROOT_DIR = resolveTaskMeldDataPath("pipelines");
const PIPELINE_DEFINITIONS_FILE = join(PIPELINE_ROOT_DIR, "index.json");
const PIPELINE_DELETED_ROOT_DIR = join(PIPELINE_ROOT_DIR, "_deleted");
const DEFAULT_PIPELINE_IDS = ["A", "B"] as const;
const DEFAULT_PIPELINE_ID_FALLBACK = "A";
const PIPELINE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export const createPipelineDefinition = (id: PipelineId, title?: string): PipelineDefinition => {
  const baseDir = join(PIPELINE_ROOT_DIR, id);
  return {
    id,
    title: title?.trim() || `流水线 DAG-${id}`,
    workflowFilePath: join(baseDir, "workflow.json"),
    runStateFile: join(baseDir, "run-state.json"),
    artifactDir: join(baseDir, "artifacts"),
  };
};

const createDefaultDefinitionsDocument = (): PipelineDefinitionsDocument => ({
  version: 1,
  defaultPipelineId: DEFAULT_PIPELINE_ID_FALLBACK,
  items: DEFAULT_PIPELINE_IDS.map((pipelineId) => ({
    id: pipelineId,
    title: `流水线 DAG-${pipelineId}`,
  })),
});

export const isValidPipelineId = (value: unknown): value is PipelineId =>
  typeof value === "string" && PIPELINE_ID_PATTERN.test(value.trim());

const normalizeDefinitionItems = (items: unknown): PipelineDefinitionItem[] => {
  if (!Array.isArray(items)) return [];
  const deduped = new Map<PipelineId, PipelineDefinitionItem>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (!isValidPipelineId(record.id)) continue;
    const id = record.id.trim();
    const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : `流水线 DAG-${id}`;
    deduped.set(id, { id, title });
  }
  return [...deduped.values()];
};

const normalizeDefinitionsDocument = (value: unknown): PipelineDefinitionsDocument => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const normalizedItems = normalizeDefinitionItems(record?.items);
  const items = normalizedItems.length > 0 ? normalizedItems : createDefaultDefinitionsDocument().items;
  const defaultPipelineId =
    typeof record?.defaultPipelineId === "string" && items.some((item) => item.id === record.defaultPipelineId)
      ? record.defaultPipelineId
      : items[0]?.id ?? DEFAULT_PIPELINE_ID_FALLBACK;
  return {
    version: 1,
    defaultPipelineId,
    items,
  };
};

const readDefinitionsDocumentFromDisk = (): PipelineDefinitionsDocument | null => {
  try {
    if (!existsSync(PIPELINE_DEFINITIONS_FILE)) return null;
    const raw = readFileSync(PIPELINE_DEFINITIONS_FILE, "utf8");
    return normalizeDefinitionsDocument(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
};

export const savePipelineDefinitions = (document: PipelineDefinitionsDocument) => {
  const normalizedDocument = normalizeDefinitionsDocument(document);
  mkdirSync(PIPELINE_ROOT_DIR, { recursive: true });
  writeFileSync(PIPELINE_DEFINITIONS_FILE, JSON.stringify(normalizedDocument, null, 2), "utf8");
  return normalizedDocument;
};

export const ensurePipelineDefinitions = (): PipelineDefinitionsDocument => {
  const fromDisk = readDefinitionsDocumentFromDisk();
  if (fromDisk) {
    // 每次启动都按当前约束回写一遍，避免 defaultPipelineId 指向失效项或 title 为空。
    return savePipelineDefinitions(fromDisk);
  }
  return savePipelineDefinitions(createDefaultDefinitionsDocument());
};

export const loadPipelineDefinitions = (): PipelineDefinition[] => {
  const document = ensurePipelineDefinitions();
  return document.items.map((item) => createPipelineDefinition(item.id, item.title));
};

export const loadPipelineDefinitionsDocument = (): PipelineDefinitionsDocument => ensurePipelineDefinitions();

export const getDefaultPipelineId = (): PipelineId => ensurePipelineDefinitions().defaultPipelineId;

export const getPipelineDefinitionsFilePath = () => PIPELINE_DEFINITIONS_FILE;

export const getPipelineRootDir = () => PIPELINE_ROOT_DIR;

export const getDeletedPipelineRootDir = () => PIPELINE_DELETED_ROOT_DIR;
