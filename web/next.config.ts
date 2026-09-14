import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { LEGACY_REDIRECTS } from "./lib/redirects";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // Next buffers the request body so middleware can clone it, 10 MB by default: a 12 MB
  // scan reached /api/v1/extract truncated. 32 MB matches Caddy's cap over the 30 MB limit.
  experimental: { middlewareClientMaxBodySize: "32mb" },
  async redirects() { return LEGACY_REDIRECTS; },
};
export default withNextIntl(nextConfig);
