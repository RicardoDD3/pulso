import { NextResponse } from "next/server";
import packageJson from "@/package.json";

export const dynamic = "force-dynamic";

/** GET — app version (public; used by the UI footer and support reports). */
export async function GET() {
  return NextResponse.json({ name: "pulso", version: packageJson.version });
}
