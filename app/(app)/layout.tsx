import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppNav } from "@/components/shared/AppNav";
import { ViewAsBanner } from "@/components/shared/ViewAsBanner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4">
      <AppNav userName={session.user.name} />
      <Suspense>
        <ViewAsBanner />
      </Suspense>
      <main className="flex-1 py-6">{children}</main>
    </div>
  );
}
