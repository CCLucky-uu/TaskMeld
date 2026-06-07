import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { wsRequest } from "../../../shared/ws-client";
import type { WevraConfigResponse, WevraModelProvider, WevraModelInfo } from "../../../entities/wevra";
import { CloseIcon, PlusIcon } from "../../../shared/ui";

type ModelConfigModalProps = {
  open: boolean;
  onClose: () => void;
  onConfigUpdate: (config: WevraConfigResponse) => void;
};

type ModelEntry = { id: string; name: string };

type ProviderTemplate = {
  id: string;
  name: string;
  baseUrl: string;
  models: ModelEntry[];
};

const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    models: [
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com",
    models: [
      { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
      { id: "gpt-5.4", name: "GPT-5.4" },
      { id: "gpt-5.5", name: "GPT-5.5" },
    ],
  },
  {
    id: "xiaomi",
    name: "Xiaomi MiMo",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    models: [
      { id: "mimo-v2.5", name: "MiMo V2.5" },
      { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro" },
      { id: "mimo-v2-flash", name: "MiMo V2 Flash" },
      { id: "mimo-v2-pro", name: "MiMo V2 Pro" },
      { id: "mimo-v2-omni", name: "MiMo V2 Omni" },
    ],
  },
];

const inputCls =
  "block w-full min-w-0 border border-[#29414f] bg-[rgba(18,31,38,0.9)] px-2 py-1.5 text-sm text-(--text) outline-none focus-visible:border-[#3b5868] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--live)] focus-visible:outline-offset-1";
const labelCls = "block text-xs text-(--muted) mb-1";

export function ModelConfigModal({ open, onClose, onConfigUpdate }: ModelConfigModalProps) {
  const [config, setConfig] = useState<WevraConfigResponse | null>(null);
  const [tab, setTab] = useState<"providers" | "add">("providers");
  const [selectedTemplate, setSelectedTemplate] = useState<ProviderTemplate | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [editing, setEditing] = useState<WevraModelProvider | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [editKey, setEditKey] = useState("");
  const [loading, setLoading] = useState(false);

  const resetForm = useCallback(() => {
    setSelectedTemplate(null);
    setBaseUrl("");
    setApiKey("");
    setModels([]);
    setEditing(null);
    setEditUrl("");
    setEditKey("");
  }, []);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const cfg = (await wsRequest("wevra.config.get", {})) as WevraConfigResponse;
        if (cfg?.providers) setConfig(cfg);
      } catch { /* */ }
    })();
  }, [open]);

  if (!open) return null;

  const handleTemplateSelect = (t: ProviderTemplate) => {
    setSelectedTemplate(t);
    setBaseUrl(t.baseUrl);
    setModels([...t.models]);
  };

  const addModel = () => {
    setModels((prev) => [...prev, { id: "", name: "" }]);
  };

  const removeModel = (idx: number) => {
    setModels((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateModel = (idx: number, field: "id" | "name", value: string) => {
    setModels((prev) => prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m)));
  };

  const handleAdd = async () => {
    if (!selectedTemplate || !baseUrl.trim() || !apiKey.trim()) return;
    const validModels = models.filter((m) => m.id.trim());
    if (validModels.length === 0) return;
    setLoading(true);
    try {
      const cfg = (await wsRequest("wevra.models.add-provider", {
        providerId: selectedTemplate.id,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        models: validModels.map((m) => ({ id: m.id.trim(), name: (m.name || m.id).trim() })),
      })) as WevraConfigResponse;
      if (cfg?.providers) {
        onConfigUpdate(cfg);
        resetForm();
        setTab("providers");
      }
    } catch { /* */ }
    setLoading(false);
  };

  const handleUpdate = async () => {
    if (!editing) return;
    setLoading(true);
    try {
      const params: Record<string, string> = { providerId: editing.id };
      if (editUrl.trim()) params.baseUrl = editUrl.trim();
      if (editKey.trim()) params.apiKey = editKey.trim();
      const cfg = (await wsRequest("wevra.models.update-provider", params)) as WevraConfigResponse;
      if (cfg?.providers) {
        onConfigUpdate(cfg);
        resetForm();
      }
    } catch { /* */ }
    setLoading(false);
  };

  const handleDelete = async (pid: string) => {
    setLoading(true);
    try {
      const cfg = (await wsRequest("wevra.models.remove-provider", { providerId: pid })) as WevraConfigResponse;
      if (cfg?.providers) onConfigUpdate(cfg);
    } catch { /* */ }
    setLoading(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative z-10 w-[480px] max-w-[94vw] max-h-[80vh] overflow-auto border border-(--line) bg-[var(--bg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-(--line)">
          <div className="flex gap-3">
            <button
              type="button"
              className="text-xs pb-1 bg-transparent border-none cursor-pointer"
              style={tab === "providers" ? { color: "var(--live)", borderBottom: "2px solid var(--live)" } : { color: "var(--muted)" }}
              onClick={() => { setTab("providers"); resetForm(); }}
            >
              Providers
            </button>
            <button
              type="button"
              className="text-xs pb-1 bg-transparent border-none cursor-pointer"
              style={tab === "add" ? { color: "var(--live)", borderBottom: "2px solid var(--live)" } : { color: "var(--muted)" }}
              onClick={() => { setTab("add"); resetForm(); }}
            >
              Add Provider
            </button>
          </div>
          <button
            type="button"
            className="h-6 w-6 inline-flex items-center justify-center rounded p-0 text-(--muted) hover:text-(--text) bg-transparent border-none cursor-pointer"
            onClick={onClose}
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="p-4">
          {!config ? (
            <p className="text-xs text-(--muted) text-center py-8">Loading...</p>
          ) : (
            <>
              {tab === "providers" && (
                <div className="space-y-3">
                  {config.providers.map((p) => (
                    <div key={p.id} className="border border-(--line) rounded px-3 py-2">
                      {editing?.id === p.id ? (
                        <div className="space-y-2">
                          <div>
                            <label className={labelCls}>Base URL</label>
                            <input className={inputCls} value={editUrl} onChange={(e) => setEditUrl(e.target.value)} placeholder={p.baseUrl} />
                          </div>
                          <div>
                            <label className={labelCls}>API Key</label>
                            <input type="password" className={inputCls} value={editKey} onChange={(e) => setEditKey(e.target.value)} placeholder="Enter new key" />
                          </div>
                          <div className="flex gap-2 justify-end">
                            <button type="button" className="px-2.5 py-1 text-xs rounded border border-(--line) bg-transparent text-(--muted) hover:text-(--text) cursor-pointer" onClick={resetForm}>Cancel</button>
                            <button type="button" className="px-2.5 py-1 text-xs rounded border border-(--live) bg-transparent text-(--live) hover:bg-[rgba(50,215,186,0.1)] cursor-pointer" onClick={handleUpdate} disabled={loading}>Save</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm text-(--text) font-medium">{p.name}</div>
                            <div className="text-xs text-(--muted) mt-0.5">
                              {p.baseUrl} · {p.modelCount} model{p.modelCount !== 1 ? "s" : ""} · API Key: {p.hasApiKey ? "configured" : "not set"}
                              {p.readonly && " · readonly"}
                            </div>
                          </div>
                          {!p.readonly && (
                            <div className="flex gap-1.5">
                              <button type="button" className="px-2 py-1 text-xs rounded border border-(--line) bg-transparent text-(--muted) hover:text-(--text) cursor-pointer" onClick={() => { setEditing(p); setEditUrl(p.baseUrl); setEditKey(""); }}>Edit</button>
                              <button type="button" className="px-2 py-1 text-xs rounded border border-[rgba(255,107,107,0.3)] bg-transparent text-[#ff6b6b] hover:bg-[rgba(255,107,107,0.08)] cursor-pointer" onClick={() => handleDelete(p.id)}>Delete</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {config.providers.length === 0 && (
                    <p className="text-xs text-(--muted) text-center py-4">No providers configured</p>
                  )}
                </div>
              )}

              {tab === "add" && (
                <div className="space-y-3">
                  <div>
                    <label className={labelCls}>Provider</label>
                    <div className="flex flex-wrap gap-1.5">
                      {PROVIDER_TEMPLATES.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className={`px-2.5 py-1 text-xs rounded border cursor-pointer transition-colors ${
                            selectedTemplate?.id === t.id
                              ? "border-(--live) bg-[rgba(50,215,186,0.12)] text-(--live)"
                              : "border-(--line) bg-transparent text-(--muted) hover:text-(--text) hover:border-[rgba(142,163,179,0.3)]"
                          }`}
                          onClick={() => handleTemplateSelect(t)}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedTemplate && (
                    <>
                      <div>
                        <label className={labelCls}>Base URL</label>
                        <input className={inputCls} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                      </div>
                      <div>
                        <label className={labelCls}>API Key</label>
                        <input type="password" className={inputCls} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className={labelCls + " mb-0"}>Models</label>
                          <button
                            type="button"
                            className="inline-flex items-center gap-0.5 text-xs text-(--live) bg-transparent border-none cursor-pointer hover:underline"
                            onClick={addModel}
                          >
                            <PlusIcon size={12} /> Add
                          </button>
                        </div>
                        <div className="space-y-1.5">
                          {models.map((m, idx) => (
                            <div key={idx} className="flex items-center gap-1.5">
                              <input
                                className={inputCls + " flex-1"}
                                value={m.id}
                                onChange={(e) => updateModel(idx, "id", e.target.value)}
                                placeholder="model-id"
                              />
                              <input
                                className={inputCls + " flex-1"}
                                value={m.name}
                                onChange={(e) => updateModel(idx, "name", e.target.value)}
                                placeholder="Display name"
                              />
                              <button
                                type="button"
                                className="h-[30px] w-[30px] shrink-0 inline-flex items-center justify-center text-[#ff6b6b] hover:text-[#ff4444] bg-transparent border-none cursor-pointer text-sm"
                                onClick={() => removeModel(idx)}
                              >
                                x
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="w-full px-3 py-1.5 text-sm rounded border border-(--live) bg-[rgba(50,215,186,0.12)] text-(--live) hover:bg-[rgba(50,215,186,0.2)] cursor-pointer disabled:opacity-50"
                        onClick={handleAdd}
                        disabled={loading || !apiKey.trim() || models.filter((m) => m.id.trim()).length === 0}
                      >
                        {loading ? "Adding..." : "Add Provider"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
