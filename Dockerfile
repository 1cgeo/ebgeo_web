# syntax=docker/dockerfile:1
# EBGeo Backend — multi-stage build (Node 20 LTS, ES Modules)
# Uses debian-slim (not alpine) to avoid musl issues with the native `bcrypt` module.

# ---- deps: install production dependencies only ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Non-root user for runtime
RUN groupadd --system --gid 1001 ebgeo \
  && useradd --system --uid 1001 --gid ebgeo ebgeo

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src

# Image storage dir (mount a volume here in production)
RUN mkdir -p /app/data/images && chown -R ebgeo:ebgeo /app/data

USER ebgeo
EXPOSE 3000

# Simple healthcheck against the HTTP health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
