# syntax=docker/dockerfile:1
# EBGeo Backend — multi-stage build (Node 22 LTS, ES Modules)
# Uses debian-slim (not alpine) to avoid musl issues with the native `bcrypt` module.
#
# NODE 22, NOT 20, AND THE REASON IS NOT "NEWER IS BETTER". On 2026-08-29 this file
# stopped building at all: `npm ci` fell through to `node-gyp rebuild` for
# better-sqlite3 and died with `gyp ERR! find Python`, because the slim image ships
# no Python and no C++ toolchain. The root cause is upstream, not here:
# better-sqlite3 12.10.0 DROPPED its prebuilt binaries for Node 20 (end of life),
# and this package is on 12.11.1. On Node 20 there is nothing to download, so the
# install compiles; on Node 22 the prebuild exists and `npm ci --omit=dev` finishes
# in about 3 seconds with no toolchain at all (measured, both ways, on this file).
#
# The two alternatives were weighed and rejected: installing python3/make/g++ pays a
# compile on every build for a binary that already exists upstream, and pinning
# better-sqlite3 to 12.9.0 freezes a dependency to keep a runtime that is already
# EOL. Both `package.json` files declare `node >=20.19.0`, which Node 22 satisfies.
# The sibling `ebgeo_360`, which is deployed by Docker on the same server, is on
# node:22 for the same dependency.

# ---- deps: install production dependencies only ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Non-root user for runtime
RUN groupadd --system --gid 1001 ebgeo \
  && useradd --system --uid 1001 --gid ebgeo ebgeo

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src

# Operational scripts. Every `sv360:*` script declared in package.json is a
# documented way to operate the 360 acervo, so each has to exist INSIDE the
# image: without this COPY the script resolved to nothing and the run died with
# ERR_MODULE_NOT_FOUND before touching the database.
#
# The list is EXPLICIT rather than `COPY scripts ./scripts`, on purpose. The
# remaining scripts/ files are development or test tooling (dev-db.js, test-db.js,
# run-tests.js) or an import with no npm script and no production caller
# (assets3d-import.js); `run-tests.js` and `test-db.js` DROP and recreate a
# database, which is not something a runtime image should be able to do by
# accident. Keep this list in step with the `sv360:*` scripts in package.json:
# adding one there without adding it here reproduces the very defect above.
#
# sv360-survey-clock.js carries no npm script of its own; it is the shared
# constant table (per-project timezone, source clock skew) that the two ETLs
# import in opposite directions, so it travels with them.
COPY scripts/sv360-import.js \
     scripts/sv360-import-captured-at.js \
     scripts/sv360-derive-runs.js \
     scripts/sv360-survey-clock.js \
     ./scripts/

# Image storage dir (mount a volume here in production)
RUN mkdir -p /app/data/images && chown -R ebgeo:ebgeo /app/data

USER ebgeo
EXPOSE 3000

# Simple healthcheck against the HTTP health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
