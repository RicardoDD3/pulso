"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { authClient, useSession } from "@/lib/auth-client";

/** TOTP 2FA management (spec doc 04: health data → higher bar; v1 ships 2FA). */
export function SecuritySettings() {
  const t = useTranslations("security");
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const [password, setPassword] = useState("");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const enabled = Boolean(
    (session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
  );

  async function enable(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    const { data, error } = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (error || !data) {
      setMessage(t("wrongPassword"));
      return;
    }
    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes ?? []);
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) {
      setMessage(t("wrongCode"));
      return;
    }
    setMessage(t("enabled"));
    setTotpUri(null);
    setCode("");
    setPassword("");
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    const { error } = await authClient.twoFactor.disable({ password });
    setPending(false);
    setMessage(error ? t("wrongPassword") : t("disabled"));
    setPassword("");
  }

  const secret = totpUri ? new URL(totpUri).searchParams.get("secret") : null;
  const inputClass =
    "rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm outline-none focus:border-emerald-500";

  return (
    <section className="max-w-lg space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-sm font-semibold text-zinc-300">{t("title")}</h2>
      <p className="text-xs text-zinc-500">{enabled ? t("statusOn") : t("statusOff")}</p>

      {totpUri ? (
        <div className="space-y-3">
          <p className="text-xs text-zinc-400">{t("scanHint")}</p>
          {secret ? (
            <p className="rounded-md bg-zinc-950 p-2 font-mono text-sm break-all select-all">
              {secret}
            </p>
          ) : null}
          <a href={totpUri} className="text-xs text-emerald-400 underline underline-offset-2">
            {t("openInApp")}
          </a>
          {backupCodes.length > 0 ? (
            <div>
              <p className="mb-1 text-xs text-zinc-400">{t("backupCodes")}</p>
              <p className="rounded-md bg-zinc-950 p-2 font-mono text-xs break-all select-all">
                {backupCodes.join("  ")}
              </p>
            </div>
          ) : null}
          <form onSubmit={confirm} className="flex gap-2">
            <input
              inputMode="numeric"
              placeholder={t("codePlaceholder")}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`flex-1 ${inputClass}`}
            />
            <button
              type="submit"
              disabled={pending || code.length < 6}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-40"
            >
              {tCommon("confirm")}
            </button>
          </form>
        </div>
      ) : (
        <form onSubmit={enabled ? disable : enable} className="flex gap-2">
          <input
            type="password"
            required
            placeholder={t("passwordPlaceholder")}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`flex-1 ${inputClass}`}
          />
          <button
            type="submit"
            disabled={pending}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-40 ${
              enabled ? "bg-red-700 hover:bg-red-600" : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {enabled ? t("disable") : t("enable")}
          </button>
        </form>
      )}
      {message ? <p className="text-sm text-zinc-400">{message}</p> : null}

      <div className="border-t border-zinc-800 pt-3">
        <button
          onClick={async () => {
            await authClient.revokeOtherSessions();
            setMessage(t("sessionsRevoked"));
          }}
          className="text-xs text-zinc-400 underline underline-offset-2 hover:text-zinc-200"
        >
          {t("revokeSessions")}
        </button>
      </div>
    </section>
  );
}
