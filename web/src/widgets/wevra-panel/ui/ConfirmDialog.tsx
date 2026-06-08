interface ConfirmDialogProps {
  open: boolean;
  toolName: string;
  toolArgs: Record<string, unknown>;
  onDecision: (decision: "allow" | "deny" | "always-allow") => void;
}

export function ConfirmDialog({ open, toolName, toolArgs, onDecision }: ConfirmDialogProps) {
  if (!open) return null;

  const isDestructive = toolName.includes("delete");

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => onDecision("deny")}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative z-10 w-[420px] max-w-[94vw] rounded-lg border border-[var(--line)] bg-[var(--bg)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">{isDestructive ? "🛑" : "⚠️"}</span>
          <h3 className="text-sm font-semibold text-[var(--text)]">Wevra wants to execute</h3>
        </div>

        <div className="mb-3 space-y-2 text-xs">
          <div className="flex gap-2">
            <span className="shrink-0 text-[var(--muted)]">Tool:</span>
            <span className={`font-mono ${isDestructive ? "text-[var(--bad)]" : "text-[var(--live)]"}`}>
              {toolName}
            </span>
          </div>
          <div className="flex gap-2">
            <span className="shrink-0 text-[var(--muted)]">Arguments:</span>
            <pre className="m-0 max-h-[120px] overflow-auto whitespace-pre-wrap break-all font-mono text-[var(--text)]">
              {JSON.stringify(toolArgs, null, 2)}
            </pre>
          </div>
          {isDestructive && (
            <p className="text-[var(--bad)] font-semibold">This action is destructive and cannot be undone.</p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button
            className="px-3 py-1.5 text-xs rounded border border-[var(--line)] bg-transparent text-[var(--muted)] hover:border-[var(--bad)] hover:text-[var(--bad)] transition-colors"
            onClick={() => onDecision("deny")}
          >
            Deny
          </button>
          <button
            className="px-3 py-1.5 text-xs rounded border border-[var(--live)] bg-transparent text-[var(--live)] hover:bg-[rgba(50,215,186,0.1)] transition-colors"
            onClick={() => onDecision("allow")}
          >
            Allow once
          </button>
          <button
            className="px-3 py-1.5 text-xs rounded border border-[var(--live)] bg-[rgba(50,215,186,0.12)] text-[var(--live)] hover:bg-[rgba(50,215,186,0.2)] transition-colors"
            onClick={() => onDecision("always-allow")}
          >
            Always allow
          </button>
        </div>
      </div>
    </div>
  );
}
