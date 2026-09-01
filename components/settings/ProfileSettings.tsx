"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type Profile = {
  displayName: string | null;
  birthDate: string | null;
  sex: string | null;
  maxHr: number | null;
  timezone: string;
  locale: string;
  unitSystem: string;
};

export function ProfileSettings() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fetch("/api/settings/profile")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((json) => setProfile(json.profile))
      .catch(() => setError(true));
  }, []);

  if (error) return <p className="text-sm text-red-400">{tCommon("error")}</p>;
  if (!profile) return <p className="text-sm text-zinc-400">{tCommon("loading")}</p>;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setPending(true);
    setSaved(false);
    const res = await fetch("/api/settings/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: profile.displayName || null,
        birthDate: profile.birthDate || null,
        sex: profile.sex || null,
        maxHr: profile.maxHr ?? null,
        timezone: profile.timezone,
        locale: profile.locale,
        unitSystem: profile.unitSystem,
      }),
    });
    setPending(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else {
      setError(true);
    }
  }

  const inputClass =
    "w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm outline-none focus:border-emerald-500";

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <form onSubmit={save} className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="text-sm font-semibold text-zinc-300">{t("profile")}</h2>
        <label className="block">
          <span className="mb-0.5 block text-xs text-zinc-500">{t("displayName")}</span>
          <input
            value={profile.displayName ?? ""}
            onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
            className={inputClass}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-0.5 block text-xs text-zinc-500">{t("birthDate")}</span>
            <input
              type="date"
              value={profile.birthDate ?? ""}
              onChange={(e) => setProfile({ ...profile, birthDate: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs text-zinc-500">{t("sex")}</span>
            <select
              value={profile.sex ?? ""}
              onChange={(e) => setProfile({ ...profile, sex: e.target.value || null })}
              className={inputClass}
            >
              <option value="">—</option>
              <option value="male">M</option>
              <option value="female">F</option>
              <option value="other">X</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-0.5 block text-xs text-zinc-500">{t("maxHr")}</span>
          <input
            inputMode="numeric"
            value={profile.maxHr ?? ""}
            onChange={(e) =>
              setProfile({ ...profile, maxHr: e.target.value ? Number(e.target.value) : null })
            }
            className={inputClass}
          />
          <span className="mt-0.5 block text-[11px] text-zinc-600">{t("maxHrHint")}</span>
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="mb-0.5 block text-xs text-zinc-500">{t("timezone")}</span>
            <input
              value={profile.timezone}
              onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
              className={inputClass}
              list="tz-common"
            />
            <datalist id="tz-common">
              <option value="UTC" />
              <option value="America/Mexico_City" />
              <option value="America/New_York" />
              <option value="Europe/Madrid" />
            </datalist>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs text-zinc-500">{t("locale")}</span>
            <select
              value={profile.locale}
              onChange={(e) => setProfile({ ...profile, locale: e.target.value })}
              className={inputClass}
            >
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs text-zinc-500">{t("unitSystem")}</span>
            <select
              value={profile.unitSystem}
              onChange={(e) => setProfile({ ...profile, unitSystem: e.target.value })}
              className={inputClass}
            >
              <option value="metric">{t("metric")}</option>
              <option value="imperial">{t("imperial")}</option>
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
          >
            {t("save")}
          </button>
          {saved ? <span className="text-sm text-emerald-400">{t("saved")}</span> : null}
        </div>
      </form>
    </div>
  );
}
