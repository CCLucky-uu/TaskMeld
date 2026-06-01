import { AgentCoreFileContent, AgentCoreFileItem, AgentItem } from "./types";
import { wsRequest } from "../../shared/ws-client";
import { mapAgents } from "./mapper";

type AgentListResponse = {
  items?: unknown;
};

type AgentFilesListResponse = {
  items?: unknown;
  raw?: unknown;
};

type AgentFileGetResponse = {
  item?: unknown;
  raw?: unknown;
};

export async function fetchAgents(): Promise<AgentItem[]> {
  const data = await wsRequest<AgentListResponse>("agent.list");
  return mapAgents(data.items);
}

const resolveFileListSource = (data: AgentFilesListResponse): unknown[] => {
  if (Array.isArray(data.items) && data.items.length > 0) return data.items;
  const rawObj = (data.raw ?? {}) as Record<string, unknown>;
  if (Array.isArray(rawObj.files)) return rawObj.files;
  if (Array.isArray(data.items)) return data.items;
  return [] as unknown[];
};

const mapFileListItem = (item: unknown): AgentCoreFileItem | null => {
  const obj = (item ?? {}) as Record<string, unknown>;
  const name = String(obj.name ?? obj.fileName ?? obj.path ?? "").trim();
  if (!name) return null;
  const sizeRaw = obj.size;
  const updatedAtRaw = obj.updatedAt ?? obj.modifiedAt ?? obj.mtime;
  const updatedAtMsRaw = obj.updatedAtMs;
  const updatedAt =
    typeof updatedAtRaw === "string"
      ? updatedAtRaw
      : typeof updatedAtMsRaw === "number" && Number.isFinite(updatedAtMsRaw)
        ? new Date(updatedAtMsRaw).toISOString()
        : null;
  return {
    name,
    size: typeof sizeRaw === "number" && Number.isFinite(sizeRaw) ? sizeRaw : null,
    updatedAt,
  };
};

const extractFileContent = (data: AgentFileGetResponse, defaultName: string): AgentCoreFileContent => {
  const itemObj = (data.item ?? {}) as Record<string, unknown>;
  const nestedFileObj = (itemObj.file ?? null) as Record<string, unknown> | null;
  const obj = (nestedFileObj ?? itemObj) as Record<string, unknown>;
  const resolvedName = String(obj.name ?? obj.fileName ?? defaultName).trim() || defaultName;
  const contentRaw = obj.content ?? obj.text ?? obj.body ?? obj.value ?? "";
  const content =
    typeof contentRaw === "string"
      ? contentRaw
      : contentRaw === null || contentRaw === undefined
        ? ""
        : JSON.stringify(contentRaw, null, 2);
  return { name: resolvedName, content };
};

export async function fetchAgentCoreFiles(agentId: string): Promise<AgentCoreFileItem[]> {
  const data = await wsRequest<AgentFilesListResponse>("agent.files.list", { agentId });
  return resolveFileListSource(data).map(mapFileListItem).filter((item): item is AgentCoreFileItem => Boolean(item));
}

export async function fetchAgentCoreFileContent(agentId: string, name: string): Promise<AgentCoreFileContent> {
  const data = await wsRequest<AgentFileGetResponse>("agent.files.get", { agentId, name });
  return extractFileContent(data, name);
}

export async function setAgentCoreFileContent(params: {
  agentId: string;
  name: string;
  content: string;
}): Promise<AgentCoreFileContent> {
  const data = await wsRequest<AgentFileGetResponse>("agent.files.set", { agentId: params.agentId, name: params.name, content: params.content });
  return extractFileContent(data, params.name);
}

export async function createAgent(params: {
  name: string;
  workspace?: string;
}): Promise<unknown> {
  return wsRequest("agent.create", { name: params.name, workspace: params.workspace });
}

export async function updateAgent(params: {
  agentId: string;
  name?: string;
  workspace?: string;
}): Promise<unknown> {
  return wsRequest("agent.update", { agentId: params.agentId, name: params.name, workspace: params.workspace });
}

export async function deleteAgent(params: {
  agentId: string;
  deleteFiles?: boolean;
}): Promise<unknown> {
  return wsRequest("agent.delete", { agentId: params.agentId, deleteFiles: params.deleteFiles });
}

export async function resolveDefaultWorkspace(name: string): Promise<string> {
  try {
    const data = await wsRequest<{ workspace?: string }>("agent.defaultWorkspace", { name });
    if (typeof data?.workspace === "string" && data.workspace.trim()) {
      return data.workspace.trim();
    }
  } catch {
    // Fall through to default.
  }
  return `workspace-${name}`;
}
