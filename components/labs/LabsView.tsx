"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { labCategoryLabel } from "@/lib/labs/categories";

type SessionRow = {
  session: {
    id: string;
    sampleDate: string | null;
    labName: string | null;
    status: string;
    createdAt: string;
  };
  resultCount: number;
  flagCount: number;
};

type Result = {
  id: string;
  category: string;
  testName: string;
  testNameNormalized: string | null;
  valueNum: number | null;
  valueText: string | null;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  isFlagged: boolean;
};

export function LabsView({ extractionEnabled }: { extractionEnabled: boolean }) {
  const t = useTranslations("labs");
  const tCommon = useTranslations("common");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/labs/sessions");
    if (res.ok) setSessions((await res.json()).sessions);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!active) {
      setResults([]);
      return;
    }
    fetch(`/api/labs/sessions/${active}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((json) => setResults(json.results))
      .catch(() => setError(tCommon("error")));
  }, [active, tCommon]);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/labs/upload", { method: "POST", body: form });
    setUploading(false);
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setError(json?.error?.message ?? tCommon("error"));
      return;
    }
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm(t("confirmDelete"))) return;
    await fetch(`/api/labs/sessions/${id}`, { method: "DELETE" });
    if (active === id) setActive(null);
    await load();
  }

  async function retry(id: string) {
    await fetch(`/api/labs/sessions/${id}/retry`, { method: "POST" });
    await load();
  }

  const grouped = new Map<string, Result[]>();
  for (const r of results) {
    if (onlyFlagged && !r.isFlagged) continue;
    const list = grouped.get(r.category) ?? [];
    list.push(r);
    grouped.set(r.category, list);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
          <button
            disabled={!extractionEnabled || uploading}
            onClick={() => fileRef.current?.click()}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-40"
          >
            {uploading ? tCommon("loading") : t("uploadPdf")}
          </button>
        </div>
      </div>

      {!extractionEnabled ? (
        <p className="rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-400">
          {t("disabledHint")}
        </p>
      ) : null}

      {/* Mandatory AI-extraction disclaimer (spec doc 07) */}
      <p className="rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-xs text-amber-300">
        {t("aiDisclaimer")}
      </p>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="w-full space-y-2 lg:w-72 lg:shrink-0">
          {sessions.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("emptyState")}</p>
          ) : null}
          {sessions.map(({ session, resultCount, flagCount }) => (
            <div
              key={session.id}
              className={`rounded-xl border p-3 ${
                active === session.id ? "border-emerald-700 bg-zinc-900" : "border-zinc-800 bg-zinc-900/60"
              }`}
            >
              <button onClick={() => setActive(session.id)} className="block w-full text-left">
                <span className="text-sm font-semibold">
                  {session.sampleDate ?? session.createdAt.slice(0, 10)}
                </span>
                <span className="ml-2 text-xs text-zinc-500">{session.labName}</span>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {session.status === "completed"
                    ? `${resultCount} ${t("results")} · ${flagCount} ${t("flags")}`
                    : session.status}
                </p>
              </button>
              <div className="mt-1.5 flex gap-3 text-xs">
                {session.status === "failed" ? (
                  <button onClick={() => retry(session.id)} className="text-emerald-400 hover:underline">
                    {t("retry")}
                  </button>
                ) : null}
                <a href={`/api/labs/sessions/${session.id}/pdf`} className="text-zinc-500 hover:underline">
                  PDF
                </a>
                <button onClick={() => remove(session.id)} className="text-red-500 hover:underline">
                  {tCommon("delete")}
                </button>
              </div>
            </div>
          ))}
        </aside>

        <section className="min-w-0 flex-1">
          {active && results.length > 0 ? (
            <div className="space-y-5">
              <label className="flex items-center gap-2 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  checked={onlyFlagged}
                  onChange={(e) => setOnlyFlagged(e.target.checked)}
                />
                {t("onlyFlagged")}
              </label>
              {[...grouped.entries()].map(([category, rows]) => (
                <div key={category}>
                  <h2 className="mb-2 text-sm font-semibold text-zinc-300">
                    {labCategoryLabel(category)}
                  </h2>
                  <div className="overflow-x-auto rounded-xl border border-zinc-800">
                    <table className="w-full text-sm">
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.id} className="border-b border-zinc-800/60 last:border-0">
                            <td className="px-3 py-2">{r.testName}</td>
                            <td
                              className={`px-3 py-2 text-right font-semibold tabular-nums ${
                                r.isFlagged ? "text-amber-400" : ""
                              }`}
                            >
                              {r.valueNum ?? r.valueText ?? "—"} {r.unit ?? ""}
                              {r.isFlagged ? " ⚠" : ""}
                            </td>
                            <td className="px-3 py-2 text-right text-xs text-zinc-500 tabular-nums">
                              {r.refText ??
                                (r.refLow != null || r.refHigh != null
                                  ? `${r.refLow ?? ""} – ${r.refHigh ?? ""}`
                                  : "")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">{t("selectSession")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
