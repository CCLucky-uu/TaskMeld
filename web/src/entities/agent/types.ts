export type AgentItem = {
  id: string;
  name: string;
  role: string;
  workspace: string;
  online: boolean;
  lastActiveAt: string | null;
  lastActiveAtMs: number | null;
};

export type AgentCoreFileItem = {
  name: string;
  size: number | null;
  updatedAt: string | null;
};

export type AgentCoreFileContent = {
  name: string;
  content: string;
};
