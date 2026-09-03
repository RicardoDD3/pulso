import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // standalone is for the self-hosted Docker image; on Vercel let the platform
  // handle the build output (VERCEL=1 is set during Vercel builds).
  output: process.env.VERCEL ? undefined : "standalone",
  // ESM-only package; transpiling lets jest (via next/jest) load it in tests.
  transpilePackages: ["@garmin/fitsdk"],
};

export default withNextIntl(nextConfig);
