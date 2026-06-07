import { useCallback, useState } from "react";
import { createAgent, updateAgent, deleteAgent, resolveDefaultWorkspace } from "../../../entities/agent/service";

// Minimal agent shape needed by the hook to populate edit form fields.
type AgentSummary = {
  id: string;
  name?: string;
  workspace?: string;
};

type UseAgentCrudModalOptions = {
  agents: AgentSummary[];
  refreshAgents: () => void;
};

const blurActiveElement = () => {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
};

export function useAgentCrudModal({ agents, refreshAgents }: UseAgentCrudModalOptions) {
  // --- Create modal state ---
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createWorkspace, setCreateWorkspace] = useState("");
  const [createWorkspacePrefix, setCreateWorkspacePrefix] = useState("");
  const [createError, setCreateError] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  // --- Edit modal state ---
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editWorkspace, setEditWorkspace] = useState("");
  const [editError, setEditError] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  // --- Delete modal state ---
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState("");
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  // --- Create actions ---

  const openCreate = useCallback(() => {
    setCreateName("");
    setCreateWorkspace("Detecting...");
    setCreateWorkspacePrefix("");
    setCreateError("");
    setCreateOpen(true);
    resolveDefaultWorkspace("")
      .then((prefix) => {
        setCreateWorkspacePrefix(prefix);
        setCreateWorkspace(prefix);
      })
      .catch(() => {
        setCreateWorkspace("workspace-");
      });
  }, []);

  const closeCreate = useCallback(() => {
    blurActiveElement();
    setCreateOpen(false);
    setCreateName("");
    setCreateWorkspace("");
    setCreateWorkspacePrefix("");
    setCreateError("");
  }, []);

  const syncWorkspaceFromName = useCallback(
    (name: string) => {
      setCreateName(name);
      if (createWorkspacePrefix && createWorkspace === `${createWorkspacePrefix}${createName}`) {
        setCreateWorkspace(`${createWorkspacePrefix}${name}`);
      }
    },
    [createWorkspacePrefix, createWorkspace, createName],
  );

  const submitCreate = useCallback(async () => {
    if (!createName.trim()) {
      setCreateError("Agent name is required");
      return;
    }
    setCreateLoading(true);
    setCreateError("");
    try {
      await createAgent({
        name: createName.trim(),
        workspace: createWorkspace.trim() || undefined,
      });
      blurActiveElement();
      setCreateOpen(false);
      setCreateName("");
      setCreateWorkspace("");
      setCreateWorkspacePrefix("");
      setCreateError("");
      refreshAgents();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCreateLoading(false);
    }
  }, [createName, createWorkspace, refreshAgents]);

  // --- Edit actions ---

  const openEdit = useCallback(
    (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId);
      setEditId(agentId);
      setEditName(agent?.name ?? "");
      setEditWorkspace(agent?.workspace ?? "");
      setEditError("");
      setEditOpen(true);
    },
    [agents],
  );

  const closeEdit = useCallback(() => {
    blurActiveElement();
    setEditOpen(false);
    setEditError("");
  }, []);

  const submitEdit = useCallback(async () => {
    if (!editName.trim() && !editWorkspace.trim()) {
      setEditError("At least one field must be provided");
      return;
    }
    setEditLoading(true);
    setEditError("");
    try {
      await updateAgent({
        agentId: editId,
        name: editName.trim() || undefined,
        workspace: editWorkspace.trim() || undefined,
      });
      blurActiveElement();
      setEditOpen(false);
      refreshAgents();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setEditLoading(false);
    }
  }, [editId, editName, editWorkspace, refreshAgents]);

  // --- Delete actions ---

  const openDelete = useCallback((agentId: string) => {
    setDeleteId(agentId);
    setDeleteFiles(false);
    setDeleteError("");
    setDeleteOpen(true);
  }, []);

  const closeDelete = useCallback(() => {
    blurActiveElement();
    setDeleteOpen(false);
    setDeleteError("");
  }, []);

  const submitDelete = useCallback(async () => {
    setDeleteLoading(true);
    setDeleteError("");
    try {
      await deleteAgent({ agentId: deleteId, deleteFiles });
      blurActiveElement();
      setDeleteOpen(false);
      refreshAgents();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteId, deleteFiles, refreshAgents]);

  // Returns true if an agent modal was closed; the caller can use this to
  // short-circuit the Escape key handler so other modals don't also close.
  const closeOnEscape = useCallback((): boolean => {
    if (createOpen) {
      closeCreate();
      return true;
    }
    if (editOpen) {
      closeEdit();
      return true;
    }
    if (deleteOpen) {
      closeDelete();
      return true;
    }
    return false;
  }, [createOpen, editOpen, deleteOpen, closeCreate, closeEdit, closeDelete]);

  return {
    create: {
      isOpen: createOpen,
      name: createName,
      workspace: createWorkspace,
      error: createError,
      isLoading: createLoading,
      setWorkspace: setCreateWorkspace,
      syncWorkspaceFromName,
      open: openCreate,
      close: closeCreate,
      submit: submitCreate,
    },
    edit: {
      isOpen: editOpen,
      id: editId,
      name: editName,
      workspace: editWorkspace,
      error: editError,
      isLoading: editLoading,
      setName: setEditName,
      setWorkspace: setEditWorkspace,
      open: openEdit,
      close: closeEdit,
      submit: submitEdit,
    },
    delete: {
      isOpen: deleteOpen,
      id: deleteId,
      files: deleteFiles,
      error: deleteError,
      isLoading: deleteLoading,
      setFiles: setDeleteFiles,
      open: openDelete,
      close: closeDelete,
      submit: submitDelete,
    },
    closeOnEscape,
  };
}
