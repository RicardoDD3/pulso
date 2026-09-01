"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { signOut } from "@/lib/auth-client";

const LINKS = [
  { href: "/dashboard", key: "dashboard" },
  { href: "/training", key: "training" },
  { href: "/labs", key: "labs" },
  { href: "/coach", key: "coach" },
  { href: "/exercises", key: "exercises" },
  { href: "/settings", key: "settings" },
] as const;

export function AppNav({ userName }: { userName: string }) {
  const t = useTranslations("nav");
  const tApp = useTranslations("app");
  const pathname = usePathname();
  const router = useRouter();

  return (
    <header className="flex items-center justify-between border-b border-zinc-800 py-3">
      <div className="flex items-center gap-6">
        <Link href="/dashboard" className="text-lg font-bold text-emerald-400">
          {tApp("name")}
        </Link>
        <nav className="flex gap-1 overflow-x-auto">
          {LINKS.map(({ href, key }) => (
            <Link
              key={href}
              href={href}
              className={`rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${
                pathname.startsWith(href)
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t(key)}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-zinc-400 sm:inline">{userName}</span>
        <button
          onClick={async () => {
            await signOut();
            router.push("/sign-in");
            router.refresh();
          }}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          {t("signOut")}
        </button>
      </div>
    </header>
  );
}
