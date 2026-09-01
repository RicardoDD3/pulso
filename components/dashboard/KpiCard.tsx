export function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
      <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-zinc-500">{sub}</p> : null}
    </div>
  );
}
