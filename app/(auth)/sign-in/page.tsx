"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { signIn } from "@/lib/auth-client";

export default function SignInPage() {
  const t = useTranslations("auth");
  const tApp = useTranslations("app");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await signIn.email({ email, password });
    setPending(false);
    if (error) {
      setError(t("error"));
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">{tApp("name")}</h1>
          <p className="mt-1 text-sm text-zinc-400">{tApp("tagline")}</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm text-zinc-300">{t("email")}</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-zinc-300">{t("password")}</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </label>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
          >
            {t("signIn")}
          </button>
        </form>
        <p className="text-center text-sm text-zinc-400">
          {t("noAccount")}{" "}
          <Link href="/sign-up" className="text-emerald-400 hover:underline">
            {t("signUp")}
          </Link>
        </p>
      </div>
    </main>
  );
}
