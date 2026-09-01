import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export const SUPPORTED_LOCALES = ["en", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Locale resolution: the `locale` cookie (synced from profiles.locale on
 * login/settings change) → default `en`. English is the source of truth;
 * Spanish is the first complete additional locale (spec doc 14).
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const raw = store.get("locale")?.value;
  const locale: Locale = SUPPORTED_LOCALES.includes(raw as Locale) ? (raw as Locale) : "en";
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
