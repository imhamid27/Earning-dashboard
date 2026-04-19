# ============================================================================
# India Earnings Tracker — production Dockerfile
# ----------------------------------------------------------------------------
# Multi-stage build that emits a ~150 MB runtime image:
#   1. deps    — installs node_modules from package-lock
#   2. builder — runs `next build` with `output: "standalone"`
#   3. runner  — copies just the standalone bundle + static assets
#
# Coolify deployment:
#   - Build pack: Dockerfile
#   - Port:       3000
#   - Env vars:   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#                 SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_DEFAULT_QUARTER
# ============================================================================

# ---------- 1. deps ---------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

# ---------- 2. builder ------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `NEXT_PUBLIC_*` vars are baked into the client bundle at build time. Coolify
# injects these via --build-arg at build time.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_DEFAULT_QUARTER
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_DEFAULT_QUARTER=$NEXT_PUBLIC_DEFAULT_QUARTER
RUN npm run build

# ---------- 3. runner -------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Non-root user for runtime safety.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# `output: "standalone"` produces:
#   .next/standalone/      — minimal server bundle + package.json + node_modules
#   .next/static/          — static assets (must be copied separately)
#   public/                — public assets (must be copied separately)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public           ./public

USER nextjs
EXPOSE 3000

# The standalone output creates a top-level `server.js` that boots Next.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/quarters || exit 1
CMD ["node", "server.js"]
