import { z } from "zod";
import { NextResponse } from "next/server";
import { resolveViewer } from "@/lib/authz/viewer";
import { withApi, ok } from "@/lib/api/respond";
import * as profilesRepo from "@/lib/db/repos/profiles";
import { SUPPORTED_LOCALES } from "@/i18n/request";

const patchSchema = z
  .object({
    displayName: z.string().min(1).max(80).nullable(),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    sex: z.enum(["male", "female", "other"]).nullable(),
    maxHr: z.number().int().min(80).max(250).nullable(),
    timezone: z.string().min(1).max(60),
    locale: z.enum(SUPPORTED_LOCALES),
    unitSystem: z.enum(["metric", "imperial"]),
    primaryProvider: z.string().min(1).max(40).nullable(),
  })
  .partial();

export const GET = withApi(async () => {
  const viewer = await resolveViewer();
  const profile = await profilesRepo.getProfile(viewer);
  return ok({ profile });
});

export const PATCH = withApi(async (req) => {
  const viewer = await resolveViewer();
  const patch = patchSchema.parse(await req.json());
  const profile = await profilesRepo.updateProfile(viewer, patch);
  const res = NextResponse.json({ profile });
  if (patch.locale) {
    // Keep the i18n cookie in sync with the profile locale.
    res.cookies.set("locale", patch.locale, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  return res;
});
