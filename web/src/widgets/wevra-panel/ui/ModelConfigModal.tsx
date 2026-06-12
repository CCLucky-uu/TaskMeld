import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { wsRequest } from "../../../shared/ws-client";
import type {
  WevraConfigResponse,
  WevraModelProvider,
  WevraModelInfo,
  WevraProviderTemplate,
} from "../../../entities/wevra";
import { CloseIcon } from "../../../shared/ui";

type ModelConfigModalProps = {
  open: boolean;
  onClose: () => void;
  onConfigUpdate: (config: WevraConfigResponse) => void;
};

const inputCls =
  "block w-full min-w-0 border border-[#29414f] bg-[rgba(18,31,38,0.9)] px-2 py-1.5 text-sm text-(--text) outline-none focus-visible:border-[#3b5868] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--live)] focus-visible:outline-offset-1";
const labelCls = "block text-xs text-(--muted) mb-1";

export function ModelConfigModal({ open, onClose, onConfigUpdate }: ModelConfigModalProps) {
  const [config, setConfig] = useState<WevraConfigResponse | null>(null);
  const [tab, setTab] = useState<"add" | "models">("add");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [editing, setEditing] = useState<WevraModelProvider | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [editKey, setEditKey] = useState("");
  const [loading, setLoading] = useState(false);

  const templates = config?.templates ?? [];
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? templates[0];

  const resetForm = useCallback(() => {
    if (templates.length > 0) {
      setSelectedTemplateId(templates[0].id);
      setBaseUrl(templates[0].baseUrl);
    }
    setApiKey("");
    setEditing(null);
    setEditUrl("");
    setEditKey("");
  }, [templates]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const cfg = (await wsRequest("wevra.config.get", {})) as WevraConfigResponse;
        if (cfg?.providers) {
          setConfig(cfg);
          if (cfg.templates?.length && !selectedTemplateId) {
            setSelectedTemplateId(cfg.templates[0].id);
            setBaseUrl(cfg.templates[0].baseUrl);
          }
        }
      } catch {
        /* */
      }
    })();
  }, [open]);

  if (!open) return null;

  const handleTemplateSelect = (t: WevraProviderTemplate) => {
    setSelectedTemplateId(t.id);
    setBaseUrl(t.baseUrl);
  };

  const handleAdd = async () => {
    if (!selectedTemplate || !baseUrl.trim() || !apiKey.trim()) return;
    setLoading(true);
    try {
      const cfg = (await wsRequest("wevra.models.add-provider", {
        providerId: selectedTemplate.id,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
      })) as WevraConfigResponse;
      if (cfg?.providers) {
        setConfig(cfg);
        onConfigUpdate(cfg);
        resetForm();
        setTab("models");
      }
    } catch {
      /* */
    }
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
    } catch {
      /* */
    }
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
    } catch {
      /* */
    }
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
    } catch {
      /* */
    }
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
      } catch {
        /* */
      }
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
      } catch {
        /* */
      }
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
              style={
                tab === "add"
                  ? { color: "var(--live)", borderBottom: "2px solid var(--live)" }
                  : { color: "var(--muted)" }
              }
              onClick={() => {
                setTab("add");
                resetForm();
              }}
            >
              Add Provider
            </button>
            <button
              type="button"
              className="text-xs pb-1 bg-transparent border-none cursor-pointer"
              style={
                tab === "models"
                  ? { color: "var(--live)", borderBottom: "2px solid var(--live)" }
                  : { color: "var(--muted)" }
              }
              onClick={() => {
                setTab("models");
                resetForm();
              }}
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
                      {templates.map((t) => (
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
                        <input
                          type="password"
                          className={inputCls}
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder="sk-..."
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Models (inherited from backend)</label>
                        <div className="space-y-1">
                          {selectedTemplate.models.map((m, idx) => (
                            <div key={idx} className="text-xs text-(--muted) px-2 py-0.5">
                              {m.name}
                              <span className="ml-2 text-[10px] opacity-60">
                                {m.contextWindow >= 1_000_000
                                  ? `${(m.contextWindow / 1_000_000).toFixed(0)}M ctx`
                                  : `${(m.contextWindow / 1_000).toFixed(0)}K ctx`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="w-full px-3 py-1.5 text-sm rounded border border-(--live) bg-[rgba(50,215,186,0.12)] text-(--live) hover:bg-[rgba(50,215,186,0.2)] cursor-pointer disabled:opacity-50"
                        onClick={handleAdd}
                        disabled={loading || !apiKey.trim()}
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
                                  <span
                                    className={`flex-1 text-xs truncate ${isDefault ? "text-(--text)" : "text-(--muted)"}`}
                                  >
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
                                    title={
                                      isDefault ? "Cannot disable default model" : isEnabled ? "Disable" : "Enable"
                                    }
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
                      <div className="text-[10px] font-semibold text-(--muted) uppercase tracking-wider mb-2">
                        Provider Settings
                      </div>
                      {config.providers
                        .filter((p) => !p.readonly)
                        .map((p) => (
                          <div key={p.id} className="border border-(--line) rounded px-3 py-2 mb-2">
                            {editing?.id === p.id ? (
                              <div className="space-y-2">
                                <div>
                                  <label className={labelCls}>Base URL</label>
                                  <input
                                    className={inputCls}
                                    value={editUrl}
                                    onChange={(e) => setEditUrl(e.target.value)}
                                    placeholder={p.baseUrl}
                                  />
                                </div>
                                <div>
                                  <label className={labelCls}>API Key</label>
                                  <input
                                    type="password"
                                    className={inputCls}
                                    value={editKey}
                                    onChange={(e) => setEditKey(e.target.value)}
                                    placeholder="Enter new key"
                                  />
                                </div>
                                <div className="flex gap-2 justify-end">
                                  <button
                                    type="button"
                                    className="px-2.5 py-1 text-xs rounded border border-(--line) bg-transparent text-(--muted) hover:text-(--text) cursor-pointer"
                                    onClick={resetForm}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className="px-2.5 py-1 text-xs rounded border border-(--live) bg-transparent text-(--live) hover:bg-[rgba(50,215,186,0.1)] cursor-pointer"
                                    onClick={handleUpdate}
                                    disabled={loading}
                                  >
                                    Save
                                  </button>
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
                                  <button
                                    type="button"
                                    className="px-2 py-1 text-xs rounded border border-(--line) bg-transparent text-(--muted) hover:text-(--text) cursor-pointer"
                                    onClick={() => {
                                      setEditing(p);
                                      setEditUrl(p.baseUrl);
                                      setEditKey("");
                                    }}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="px-2 py-1 text-xs rounded border border-[rgba(255,107,107,0.3)] bg-transparent text-[#ff6b6b] hover:bg-[rgba(255,107,107,0.08)] cursor-pointer"
                                    onClick={() => handleDelete(p.id)}
                                  >
                                    Delete
                                  </button>
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
