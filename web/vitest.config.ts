import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // tsconfig.json sets "jsx": "preserve" for Next's own SWC-based JSX compilation;
  // Vite 8's oxc transform honors that and leaves JSX untouched unless told otherwise,
  // so server-component .tsx files (e.g. components/landing/Landing.tsx) fail to parse
  // under vitest without this override.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // next-intl ships `.js` in ESM format and imports "next/server" with no extension;
    // Next's package.json has no "exports" map, so Node's native ESM loader (which
    // externalized deps run under) can't resolve it. Inlining routes it through Vite's
    // own resolver instead, which is lenient about extensions.
    server: { deps: { inline: [/next-intl/, /^next$/] } },
  },
  resolve: { alias: { "@": path.resolve(__dirname) } },
});
