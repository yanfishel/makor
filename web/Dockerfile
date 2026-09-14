# Next.js standalone image: `next build` traces the server bundle plus the node_modules it
# needs (better-sqlite3's native binary included) into .next/standalone; we run that with
# plain node — never `next start`, which needs the full node_modules tree.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
# better-sqlite3 has no prebuilt binary for this platform/ABI combination and always
# compiles via node-gyp on install; bookworm-slim ships neither Python nor a toolchain.
RUN apt-get update && apt-get install --no-install-recommends -y python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No AUTH_MODE / keys at build time on purpose: every page is dynamic and the middleware
# reads AUTH_MODE per request (Node runtime), so one image serves both modes.
RUN npm run build

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/srv/data
RUN useradd --system --uid 10001 --no-create-home makor && mkdir -p /srv/data && chown makor /srv/data
COPY --from=build --chown=makor:makor /app/.next/standalone ./
COPY --from=build --chown=makor:makor /app/.next/static ./.next/static
# Next's standalone output excludes public/ (it only traces the server bundle).
COPY --from=build --chown=makor:makor /app/public ./public
# Drizzle migrations are read at startup from process.cwd()/drizzle (lib/db/index.ts).
COPY --from=build --chown=makor:makor /app/drizzle ./drizzle
USER makor
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/v1/usage').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
