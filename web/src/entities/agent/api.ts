import { AgentCoreFileContent, AgentCoreFileItem, AgentItem } from "./types";
import { requestJson } from "../../shared/api/client";
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
  const data = await requestJson<AgentListResponse>("/api/agents");
  return mapAgents(data.items);
}

export async function fetchAgentCoreFiles(agentId: string): Promise<AgentCoreFileItem[]> {
  const data = await requestJson<AgentFilesListResponse>(`/api/agents/${encodeURIComponent(agentId)}/files`);
  const listSource = (() => {
    if (Array.isArray(data.items) && data.items.length > 0) return data.items;
    const rawObj = (data.raw ?? {}) as Record<string, unknown>;
    if (Array.isArray(rawObj.files)) return rawObj.files;
    if (Array.isArray(data.items)) return data.items;
    return [] as unknown[];
  })();

  return listSource
    .map((item) => {
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
      } satisfies AgentCoreFileItem;
    })
    .filter((item): item is AgentCoreFileItem => Boolean(item));
}

export async function fetchAgentCoreFileContent(agentId: string, name: string): Promise<AgentCoreFileContent> {
  const data = await requestJson<AgentFileGetResponse>(
    `/api/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(name)}`,
  );
  const itemObj = (data.item ?? {}) as Record<string, unknown>;
  const nestedFileObj = (itemObj.file ?? null) as Record<string, unknown> | null;
  const obj = (nestedFileObj ?? itemObj) as Record<string, unknown>;
  const resolvedName = String(obj.name ?? obj.fileName ?? name).trim() || name;
  const contentRaw = obj.content ?? obj.text ?? obj.body ?? obj.value ?? "";
  const content =
    typeof contentRaw === "string"
      ? contentRaw
      : contentRaw === null || contentRaw === undefined
      ? ""
      : JSON.stringify(contentRaw, null, 2);
  return { name: resolvedName, content };
}

export async function setAgentCoreFileContent(params: {
  agentId: string;
  name: string;
  content: string;
}): Promise<AgentCoreFileContent> {
  const data = await requestJson<AgentFileGetResponse>(
    `/api/agents/${encodeURIComponent(params.agentId)}/files/${encodeURIComponent(params.name)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: params.content }),
    },
  );
  const itemObj = (data.item ?? {}) as Record<string, unknown>;
  const nestedFileObj = (itemObj.file ?? null) as Record<string, unknown> | null;
  const obj = (nestedFileObj ?? itemObj) as Record<string, unknown>;
  const resolvedName = String(obj.name ?? obj.fileName ?? params.name).trim() || params.name;
  const contentRaw = obj.content ?? obj.text ?? obj.body ?? obj.value ?? params.content;
  const content =
    typeof contentRaw === "string"
      ? contentRaw
      : contentRaw === null || contentRaw === undefined
        ? ""
        : JSON.stringify(contentRaw, null, 2);
  return { name: resolvedName, content };
}
