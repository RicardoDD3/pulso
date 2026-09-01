"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { GRANT_SCOPES, type GrantScope } from "@/lib/authz/scopes";

type GrantRow = {
  id: string;
  ownerId: string;
  granteeId: string;
  ownerName: string | null;
  scopes: string[];
  status: string;
};

export function AccountSettings() {
  const t = useTranslations("account");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [given, setGiven] = useState<GrantRow[]>([]);
  const [received, setReceived] = useState<GrantRow[]>([]);
  const [shareEmail, setShareEmail] = useState("");
  const [shareScopes, setShareScopes] = useState<GrantScope[]>(["health", "workouts"]);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/grants");
    if (res.ok) {
      const json = await res.json();
      setGiven(json.given);
      setReceived(json.received);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function share(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/settings/grants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: shareEmail, scopes: shareScopes }),
    });
    setMessage(res.ok ? t("shareCreated") : t("shareFailed"));
    if (res.ok) setShareEmail("");
    await load();
  }

  async function grantAction(id: string, action: "accept" | "revoke") {
    await fetch(`/api/settings/grants/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    await load();
  }

  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm(t("deleteConfirmDialog"))) return;
    const res = await fetch("/api/settings/delete-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmEmail }),
    });
    if (res.ok) {
      router.push("/sign-up");
      router.refresh();
    } else {
      setMessage(t("deleteFailed"));
    }
  }

  const sectionClass = "space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-5";

  return (
    <div className="max-w-lg space-y-6">
      {/* Sharing */}
      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-300">{t("sharingTitle")}</h2>
        <form onSubmit={share} className="space-y-2">
          <input
            type="email"
            required
            placeholder={t("coachEmail")}
            value={shareEmail}
            onChange={(e) => setShareEmail(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
          />
          <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
            {GRANT_SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={shareScopes.includes(scope)}
                  onChange={(e) =>
                    setShareScopes((prev) =>
                      e.target.checked ? [...prev, scope] : prev.filter((s) => s !== scope),
                    )
                  }
                />
                {scope}
              </label>
            ))}
          </div>
          <button
            type="submit"
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-500"
          >
            {t("share")}
          </button>
        </form>
        {given.length > 0 ? (
          <ul className="space-y-1 text-sm text-zinc-400">
            {given.map((g) => (
              <li key={g.id} className="flex items-center justify-between">
                <span>
                  → {g.granteeId.slice(0, 8)}… · {g.scopes.join(", ")} · {g.status}
                </span>
                {g.status !== "revoked" ? (
                  <button
                    onClick={() => grantAction(g.id, "revoke")}
                    className="text-xs text-red-400 hover:underline"
                  >
                    {t("revoke")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {received.length > 0 ? (
          <>
            <h3 className="text-xs font-semibold text-zinc-400">{t("receivedTitle")}</h3>
            <ul className="space-y-1 text-sm text-zinc-400">
              {received.map((g) => (
                <li key={g.id} className="flex items-center justify-between">
                  <span>
                    {g.ownerName ?? g.ownerId.slice(0, 8)} · {g.scopes.join(", ")} · {g.status}
                  </span>
                  <span className="flex gap-2">
                    {g.status === "pending" ? (
                      <button
                        onClick={() => grantAction(g.id, "accept")}
                        className="text-xs text-emerald-400 hover:underline"
                      >
                        {t("accept")}
                      </button>
                    ) : (
                      <a
                        href={`/dashboard?viewAs=${g.ownerId}`}
                        className="text-xs text-emerald-400 hover:underline"
                      >
                        {t("view")}
                      </a>
                    )}
                    <button
                      onClick={() => grantAction(g.id, "revoke")}
                      className="text-xs text-red-400 hover:underline"
                    >
                      {t("revoke")}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {/* Export */}
      <section className={sectionClass}>
        <h2 className="text-sm font-semibold text-zinc-300">{t("exportTitle")}</h2>
        <p className="text-xs text-zinc-500">{t("exportHint")}</p>
        <a
          href="/api/settings/export"
          className="inline-block rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
        >
          {t("exportButton")}
        </a>
      </section>

      {/* Danger zone */}
      <section className="space-y-3 rounded-xl border border-red-900/60 bg-red-950/20 p-5">
        <h2 className="text-sm font-semibold text-red-300">{t("deleteTitle")}</h2>
        <p className="text-xs text-zinc-400">{t("deleteHint")}</p>
        <form onSubmit={deleteAccount} className="flex gap-2">
          <input
            type="email"
            required
            placeholder={t("typeYourEmail")}
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold hover:bg-red-600"
          >
            {tCommon("delete")}
          </button>
        </form>
      </section>

      {message ? <p className="text-sm text-zinc-400">{message}</p> : null}
    </div>
  );
}
