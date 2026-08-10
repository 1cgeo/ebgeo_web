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

# Operational scripts. `npm run sv360:import` is declared in package.json and is
# the documented way to re-import the 360 acervo, so it has to exist INSIDE the
# image: without this COPY the script resolved to nothing and the run died with
# ERR_MODULE_NOT_FOUND before touching the database.
#
# Only sv360-import.js is copied, ON PURPOSE. The other four scripts/ files are
# development or test tooling (dev-db.js, test-db.js, run-tests.js) or an import
# with no npm script and no production caller (assets3d-import.js); `run-tests.js`
# and `test-db.js` DROP and recreate a database, which is not something a runtime
# image should be able to do by accident. sv360-import.js pulls only from ../src
# (config, database, streetview360/{merge,floors}, utils/sqlite-blob-pool) plus
# `better-sqlite3`, all of which are already in this stage.
COPY scripts/sv360-import.js ./scripts/

# Image storage dir (mount a volume here in production)
RUN mkdir -p /app/data/images && chown -R ebgeo:ebgeo /app/data

USER ebgeo
EXPOSE 3000

# Simple healthcheck against the HTTP health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
