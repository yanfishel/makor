import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/seo";
import en from "@/messages/en.json";

/** The web app manifest: install name, colours (the dark --background) and the PNG icons from `scripts/brand-icons.mjs`. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: en.meta.description,
    start_url: "/app",
    display: "standalone",
    background_color: "#091123",
    theme_color: "#091123",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
