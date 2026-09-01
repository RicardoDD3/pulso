import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  // ESM-only package; transpiling lets jest (via next/jest) load it in tests.
  transpilePackages: ["@garmin/fitsdk"],
};

export default withNextIntl(nextConfig);
