"use client";

import { useSearchParams } from "next/navigation";

/**
 * Grant viewing (spec doc 04): `?viewAs=<ownerUserId>` switches read views to
 * the sharing athlete's data. Server-side the Viewer enforces the grant; this
 * hook just threads the param into API calls. Write actions stay on the
 * logged-in user's own data and are hidden by consumers when viewAs is set.
 */
export function useViewAs(): { viewAs: string | null; qs: (base: string) => string } {
  const params = useSearchParams();
  const viewAs = params.get("viewAs");
  return {
    viewAs,
    qs: (base: string) =>
      viewAs ? `${base}${base.includes("?") ? "&" : "?"}viewAs=${encodeURIComponent(viewAs)}` : base,
  };
}
