import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { LEGACY_REDIRECTS } from "./lib/redirects";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // Next buffers the request body so middleware can clone it, 10 MB by default: a 12 MB
  // scan reached /api/v1/extract truncated. 32 MB matches Caddy's cap over the 30 MB limit.
  // Named for the `proxy` convention middleware was renamed to in Next 16; the old
  // `middlewareClientMaxBodySize` still maps onto it, but setting both is an error.
  experimental: { proxyClientMaxBodySize: "32mb" },
  async redirects() { return LEGACY_REDIRECTS; },
};
export default withNextIntl(nextConfig);
