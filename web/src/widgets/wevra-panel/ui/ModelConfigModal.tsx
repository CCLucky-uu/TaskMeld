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
  const [tab, setTab] = useState<"add" | "models">("add");
  const [selectedTemplate, setSelectedTemplate] = useState<ProviderTemplate | null>(() => PROVIDER_TEMPLATES[0]);
  const [baseUrl, setBaseUrl] = useState(() => PROVIDER_TEMPLATES[0].baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ModelEntry[]>(() => [...PROVIDER_TEMPLATES[0].models]);
  const [editing, setEditing] = useState<WevraModelProvider | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [editKey, setEditKey] = useState("");
  const [loading, setLoading] = useState(false);

  const resetForm = useCallback(() => {
    setSelectedTemplate(PROVIDER_TEMPLATES[0]);
    setBaseUrl(PROVIDER_TEMPLATES[0].baseUrl);
    setApiKey("");
    setModels([...PROVIDER_TEMPLATES[0].models]);
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
        setConfig(cfg);
        onConfigUpdate(cfg);
        resetForm();
        setTab("models");
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
        setConfig(cfg);
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
      if (cfg?.providers) {
        setConfig(cfg);
        onConfigUpdate(cfg);
      }
    } catch { /* */ }
    setLoading(false);
  };

  const handleSetDefault = async (m: WevraModelInfo) => {
    const key = `${m.providerId}/${m.modelId}`;
    if (key === config?.default) return;
    try {
      const cfg = (await wsRequest("wevra.models.set-default", {
        providerId: m.providerId,
        modelId: m.modelId,
      })) as WevraConfigResponse;
      if (cfg?.models) {
        setConfig(cfg);
        onConfigUpdate(cfg);
      }
    } catch { /* */ }
  };

  const handleToggleEnabled = async (m: WevraModelInfo) => {
    const isCurrentlyEnabled = m.enabled !== false;
    if (isCurrentlyEnabled) {
      // Disable — blocked if this is the default model
      const key = `${m.providerId}/${m.modelId}`;
      if (key === config?.default) return;
      try {
        const res = (await wsRequest("wevra.models.disable", {
          providerId: m.providerId,
          modelId: m.modelId,
        })) as WevraConfigResponse & { newDefault?: string };
        if (res?.models) {
          setConfig(res);
          onConfigUpdate(res);
        }
      } catch { /* */ }
    } else {
      // Enable
      try {
        const cfg = (await wsRequest("wevra.models.enable", {
          providerId: m.providerId,
          modelId: m.modelId,
        })) as WevraConfigResponse;
        if (cfg?.models) {
          setConfig(cfg);
          onConfigUpdate(cfg);
        }
      } catch { /* */ }
    }
  };

  // Group models by provider
  const providerGroups = config
    ? (() => {
        const groups = new Map<string, { provider: WevraModelProvider | undefined; models: WevraModelInfo[] }>();
        for (const m of config.models) {
          let g = groups.get(m.providerId);
          if (!g) {
            g = { provider: config.providers.find((p) => p.id === m.providerId), models: [] };
            groups.set(m.providerId, g);
          }
          g.models.push(m);
        }
        return groups;
      })()
    : new Map<string, { provider: WevraModelProvider | undefined; models: WevraModelInfo[] }>();

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
              style={tab === "add" ? { color: "var(--live)", borderBottom: "2px solid var(--live)" } : { color: "var(--muted)" }}
              onClick={() => { setTab("add"); resetForm(); }}
            >
              Add Provider
            </button>
            <button
              type="button"
              className="text-xs pb-1 bg-transparent border-none cursor-pointer"
              style={tab === "models" ? { color: "var(--live)", borderBottom: "2px solid var(--live)" } : { color: "var(--muted)" }}
              onClick={() => { setTab("models"); resetForm(); }}
            >
              Models
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

              {tab === "models" && (
                <div className="space-y-3">
                  {config.providers.filter((p) => p.hasApiKey).length === 0 ? (
                    <p className="text-xs text-(--muted) text-center py-8">No providers configured. Add one first.</p>
                  ) : (
                    Array.from(providerGroups.entries()).map(([pid, group]) => {
                      const prov = group.provider;
                      if (!prov?.hasApiKey) return null;
                      return (
                        <div key={pid}>
                          <div className="text-xs font-semibold text-(--muted) uppercase tracking-wider mb-1.5">
                            {prov.name}
                          </div>
                          <div className="space-y-0.5">
                            {group.models.map((m) => {
                              const key = `${m.providerId}/${m.modelId}`;
                              const isDefault = key === config.default;
                              const isEnabled = m.enabled !== false;
                              return (
                                <div
                                  key={key}
                                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded transition-colors ${
                                    isEnabled ? "hover:bg-[rgba(142,163,179,0.06)]" : "opacity-40"
                                  }`}
                                >
                                  <button
                                    type="button"
                                    className={`shrink-0 w-3.5 h-3.5 rounded-full border-2 cursor-pointer bg-transparent transition-colors ${
                                      isDefault
                                        ? "border-(--live) bg-(--live)"
                                        : "border-[rgba(142,163,179,0.3)] hover:border-(--muted)"
                                    }`}
                                    onClick={() => isEnabled && handleSetDefault(m)}
                                    title={isDefault ? "Default model" : "Set as default"}
                                  />
                                  <span className={`flex-1 text-xs truncate ${isDefault ? "text-(--text)" : "text-(--muted)"}`}>
                                    {m.label?.split("·").pop()?.trim() || m.modelId}
                                  </span>
                                  {isDefault && (
                                    <span className="shrink-0 text-[10px] text-(--live) font-medium">default</span>
                                  )}
                                  {/* Toggle slider */}
                                  <button
                                    type="button"
                                    className={`shrink-0 relative w-7 h-4 rounded-full border-none cursor-pointer transition-colors ${
                                      isEnabled
                                        ? isDefault
                                          ? "bg-[rgba(50,215,186,0.25)] cursor-default"
                                          : "bg-(--live)"
                                        : "bg-[rgba(142,163,179,0.2)]"
                                    }`}
                                    onClick={() => {
                                      if (!isDefault) handleToggleEnabled(m);
                                    }}
                                    title={isDefault ? "Cannot disable default model" : isEnabled ? "Disable" : "Enable"}
                                  >
                                    <span
                                      className={`absolute top-[3px] w-2.5 h-2.5 rounded-full bg-white transition-all duration-200 ${
                                        isEnabled ? "left-[14px]" : "left-[3px]"
                                      }`}
                                    />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  )}

                  {/* Provider management */}
                  {config.providers.filter((p) => !p.readonly).length > 0 && (
                    <div className="border-t border-(--line) pt-3 mt-3">
                      <div className="text-[10px] font-semibold text-(--muted) uppercase tracking-wider mb-2">Provider Settings</div>
                      {config.providers.filter((p) => !p.readonly).map((p) => (
                        <div key={p.id} className="border border-(--line) rounded px-3 py-2 mb-2">
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
                                <div className="text-xs text-(--text)">{p.name}</div>
                                <div className="text-[10px] text-(--muted) mt-0.5">
                                  {p.baseUrl} · {p.modelCount} model{p.modelCount !== 1 ? "s" : ""}
                                </div>
                              </div>
                              <div className="flex gap-1.5">
                                <button type="button" className="px-2 py-1 text-xs rounded border border-(--line) bg-transparent text-(--muted) hover:text-(--text) cursor-pointer" onClick={() => { setEditing(p); setEditUrl(p.baseUrl); setEditKey(""); }}>Edit</button>
                                <button type="button" className="px-2 py-1 text-xs rounded border border-[rgba(255,107,107,0.3)] bg-transparent text-[#ff6b6b] hover:bg-[rgba(255,107,107,0.08)] cursor-pointer" onClick={() => handleDelete(p.id)}>Delete</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
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
