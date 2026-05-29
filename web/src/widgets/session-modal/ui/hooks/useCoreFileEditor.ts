import { useCallback, useEffect, useState } from "react";
import { setAgentCoreFileContent } from "../../../../entities/agent";

type UseCoreFileEditorParams = {
  selectedAgentId: string;
  selectedFileName: string;
  fileContent: string;
  canEditCurrentFile: boolean;
  onSaved: (content: string) => void;
};

export const useCoreFileEditor = ({
  selectedAgentId,
  selectedFileName,
  fileContent,
  canEditCurrentFile,
  onSaved,
}: UseCoreFileEditorParams) => {
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [fileEditDraft, setFileEditDraft] = useState("");
  const [fileSaveError, setFileSaveError] = useState("");
  const [isSavingFile, setIsSavingFile] = useState(false);

  useEffect(() => {
    setIsEditingFile(false);
    setFileEditDraft("");
    setFileSaveError("");
    setIsSavingFile(false);
  }, [selectedAgentId, selectedFileName]);

  const beginFileEdit = useCallback(() => {
    if (!canEditCurrentFile) return;
    setFileSaveError("");
    setFileEditDraft(fileContent);
    setIsEditingFile(true);
  }, [canEditCurrentFile, fileContent]);

  const cancelFileEdit = useCallback(() => {
    setFileSaveError("");
    setFileEditDraft(fileContent);
    setIsEditingFile(false);
  }, [fileContent]);

  const saveFileEdit = useCallback(async () => {
    if (!selectedAgentId || !selectedFileName) return;
    setIsSavingFile(true);
    setFileSaveError("");
    try {
      const saved = await setAgentCoreFileContent({
        agentId: selectedAgentId,
        name: selectedFileName,
        content: fileEditDraft,
      });
      onSaved(saved.content);
      setIsEditingFile(false);
    } catch (error) {
      setFileSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingFile(false);
    }
  }, [selectedAgentId, selectedFileName, fileEditDraft, onSaved]);

  return {
    isEditingFile,
    fileEditDraft,
    setFileEditDraft,
    fileSaveError,
    isSavingFile,
    beginFileEdit,
    cancelFileEdit,
    saveFileEdit,
  };
};
