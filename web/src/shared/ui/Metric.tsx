type MetricProps = {
  label: string;
  value: string;
  tone?: string;
};

export function Metric({ label, value, tone = "" }: MetricProps) {
  return (
    <div className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap border border-[var(--line)] bg-[rgba(15,23,29,0.55)] px-2 py-[5px]">
      <span className="inline text-xs text-[var(--muted)]">{label}</span>
      <strong className={tone === "live" ? "text-xs leading-none text-[var(--live)]" : "text-xs leading-none"}>{value}</strong>
    </div>
  );
}
