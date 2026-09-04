"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const PROVIDERS = [
  "garmin",
  "whoop",
  "oura",
  "polar",
  "suunto",
  "fitbit",
  "strava",
  "ultrahuman",
] as const;

type Connection = {
  provider: string;
  status: string;
  lastSyncedAt: string | null;
};

type SyncRun = {
  id: string;
  kind: string;
  status: string;
  rowsUpserted: number;
  startedAt: string;
  error: string | null;
};

export function WearablesSettings() {
  const t = useTranslations("wearables");
  const tCommon = useTranslations("common");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wearables/connections");
      if (!res.ok) throw new Error();
      const json = await res.json();
      setConnections(json.connections ?? []);
      setSyncRuns(json.syncRuns ?? []);
      setEnabled(Boolean(json.wearablesEnabled));
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(provider: string) {
    setPending(provider);
    try {
      const res = await fetch("/api/wearables/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (res.ok) {
        const { url } = await res.json();
        window.location.href = url;
      }
    } finally {
      setPending(null);
    }
  }

  async function syncNow() {
    setPending("sync");
    await fetch("/api/wearables/sync", { method: "POST" });
    setPending(null);
    await load();
  }

  async function disconnect(provider: string, deleteData: boolean) {
    if (deleteData && !window.confirm(t("confirmDeleteData"))) return;
    await fetch("/api/wearables/connections", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, deleteData }),
    });
    await load();
  }

  if (error) return <p className="text-sm text-red-400">{tCommon("error")}</p>;

  const connected = new Map(connections.map((c) => [c.provider, c]));
  const staleConnection = connections.find(
    (c) =>
      c.status === "connected" &&
      c.lastSyncedAt &&
      Date.now() - Date.parse(c.lastSyncedAt) > 48 * 3600_000,
  );

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      {!enabled ? (
        <div className="space-y-2 rounded-xl border border-amber-800/60 bg-amber-950/30 p-4 text-sm">
          <p className="font-semibold text-amber-300">{t("demoTitle")}</p>
          <p className="text-amber-200/80">{t("demoBody")}</p>
          <a
            href="https://github.com/RicardoDD3/pulso/blob/main/docs/providers.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-amber-300 underline underline-offset-2 hover:text-amber-100"
          >
            {t("demoLink")}
          </a>
        </div>
      ) : null}
      {staleConnection ? (
        <p className="rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-300">
          {t("staleWarning", { provider: staleConnection.provider })}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {PROVIDERS.map((provider) => {
          const conn = connected.get(provider);
          return (
            <div key={provider} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold capitalize">{provider}</span>
                {conn ? (
                  <span className="rounded-full bg-emerald-900/60 px-2 py-0.5 text-xs text-emerald-300">
                    {conn.status}
                  </span>
                ) : null}
              </div>
              {conn?.lastSyncedAt ? (
                <p className="mt-1 text-xs text-zinc-500">
                  {t("lastSync")}: {new Date(conn.lastSyncedAt).toLocaleString()}
                </p>
              ) : null}
              <div className="mt-3 flex gap-2">
                {conn ? (
                  <>
                    <button
                      onClick={() => disconnect(provider, false)}
                      className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs hover:bg-zinc-800"
                    >
                      {t("disconnect")}
                    </button>
                    <button
                      onClick={() => disconnect(provider, true)}
                      className="rounded-md border border-red-900 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950"
                    >
                      {t("deleteData")}
                    </button>
                  </>
                ) : (
                  <button
                    disabled={!enabled || pending === provider}
                    onClick={() => connect(provider)}
                    className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold hover:bg-emerald-500 disabled:opacity-40"
                  >
                    {t("connect")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {connections.length > 0 ? (
        <button
          onClick={syncNow}
          disabled={pending === "sync"}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-40"
        >
          {t("syncNow")}
        </button>
      ) : null}

      {syncRuns.length > 0 ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-zinc-300">{t("recentSyncs")}</h2>
          <ul className="space-y-1 text-xs text-zinc-400">
            {syncRuns.slice(0, 10).map((run) => (
              <li key={run.id} className="tabular-nums">
                {new Date(run.startedAt).toLocaleString()} · {run.kind} ·{" "}
                <span className={run.status === "ok" ? "text-emerald-400" : run.status === "error" ? "text-red-400" : ""}>
                  {run.status}
                </span>{" "}
                · {run.rowsUpserted} rows
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
