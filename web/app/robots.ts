import type { MetadataRoute } from "next";
import { getConfig } from "@/lib/config";

// Per request: the image is built without AUTH_MODE or the site URL, so a build-time robots.txt
// would name localhost and could not tell a cloud instance from a local one.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const cfg = getConfig();
  // A none-mode instance is one person's local tool: nothing on it is for a search engine.
  if (cfg.authMode === "none") return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // "/api/" with its slash: a bare "/api" prefix would also block /api-reference.
      disallow: ["/api/", "/app", "/he/app", "/invite", "/he/invite", "/no-access", "/he/no-access"],
    },
    sitemap: `${cfg.siteUrl}/sitemap.xml`,
  };
}
