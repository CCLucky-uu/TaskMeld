import { useEffect, useMemo, useRef, useState } from "react";
import { controlInputClassName } from "./surfaceClassNames";

export type InlineSelectOption = {
  value: string;
  label: string;
};

type InlineSelectProps = {
  value: string;
  options: InlineSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  triggerClassName?: string;
  onClose?: () => void;
};

export function InlineSelect({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  triggerClassName = controlInputClassName,
  onClose,
}: InlineSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const emitClose = () => {
    // Defer close callback so parent state updates from onChange can commit first.
    setTimeout(() => {
      onCloseRef.current?.();
    }, 0);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        emitClose();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  const selectedLabel = useMemo(() => {
    const matched = options.find((option) => option.value === value);
    if (matched) return matched.label;
    return options[0]?.label ?? "-";
  }, [options, value]);

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <button
        type="button"
        className={`${triggerClassName} relative block w-full text-left leading-[1.2] outline-none transition-[border-color,background-color,color] ${open ? "border-[#3b5868] bg-[rgba(24,39,47,0.92)]" : "hover:border-[#36505f] hover:bg-[rgba(22,36,44,0.94)]"} disabled:cursor-not-allowed disabled:opacity-55`}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => {
            const next = !prev;
            if (prev && !next) emitClose();
            return next;
          });
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            emitClose();
          }
        }}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        <span className="block min-w-0 overflow-hidden pr-5 text-left text-ellipsis whitespace-nowrap">{selectedLabel}</span>
        <span className={`pointer-events-none absolute top-1/2 right-2 inline-flex -translate-y-1/2 items-center justify-center leading-none ${open ? "text-[#62cfc0]" : "text-[var(--muted)]"}`} aria-hidden="true">
          <svg viewBox="0 0 16 16" width="12" height="12" focusable="false">
            <path
              d="M4 6.5 8 10l4-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-[calc(100%+4px)] z-[8] max-h-[220px] overflow-x-hidden overflow-y-auto border border-[#29414f] bg-[rgba(18,31,38,0.98)] p-0 overscroll-contain shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`block w-full border-0 border-l-2 px-2 py-1.5 text-left text-xs leading-[1.2] font-normal ${option.value === value ? "border-l-[#62cfc0] bg-[rgba(50,215,186,0.12)] text-[#dffaf5]" : "border-l-transparent bg-transparent text-[var(--text)] hover:bg-[rgba(22,36,44,0.9)]"}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                emitClose();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
