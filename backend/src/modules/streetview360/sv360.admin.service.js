// Path: src/modules/streetview360/sv360.admin.service.js
// ADMIN / INGESTION business logic for the StreetView 360 module (Fase 9, stage
// 3a). Builds on stages 1-2 WITHOUT changing them. OWNERSHIP IS ENFORCED HERE
// (not in middleware), mirroring sv360.write.service.js:
//   - global admin (user.role === 'admin') may write ANY OM;
//   - an "om_data_admin" (org_role ∈ {owner, admin, editor} on the OWNING org)
//     may write only its OWN organization. A same-org viewer → 403.
//
// The merge/purge/collision semantics live ONCE in sv360.merge.js (reused by the
// ETL); this service resolves the target org + ownership, then hands off to
// ingestBundle (which owns the tx + atomic {slug}.db swap). list/status/delete
// are thin Postgres lifecycle ops; delete also removes the {slug}.db AFTER a
// blobPool evict (Windows file-handle release).
import { readFileSync, existsSync, rmSync, copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { query } from '../../database/index.js';
import * as AQ from './sv360.admin.queries.js';
import { canWriteProject } from './sv360.write.service.js';
import { resolveDbPath, ingestBundle, validateManifest } from './sv360.ingest.js';
import { resolveOrgIdBySlug } from './sv360.merge.js';
import { blobPool } from '../../utils/sqlite-blob-pool.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../utils/errors.js';

// Surgically evict a cached readonly handle (falls back to closeAll if the pool
// does not expose evict yet — see sv360.ingest.js INTEGRATOR NOTE).
async function evictDbPath(dbPath) {
  if (typeof blobPool.evict === 'function') await blobPool.evict(dbPath);
  else await blobPool.closeAll();
}

// resolveOrgIdBySlug expects a pg-promise task-like with .oneOrNone returning a
// row|null. The module-level query() returns { rows } instead, so this thin
// adapter bridges it for the (no-tx) org-resolution path used during upload.
const queryTask = {
  oneOrNone: async (sql, values) => {
    const { rows } = await query(sql, values);
    return rows[0] ?? null;
  },
};

// Org-write predicate WITHOUT a concrete project row (for the create/list paths,
// where the project may not exist yet): a global admin, or a member of THIS org
// with org_role ∈ {owner, admin, editor}. Reuses canWriteProject by passing a
// synthetic { organization_id } so the single ownership rule is not duplicated.
function canWriteOrg(user, orgId) {
  return canWriteProject(user, { organization_id: orgId });
}

/**
 * Resolves the TARGET organization_id for an upload and enforces ownership:
 *   - a global admin may target any OM (the manifest's orgSlug, or the default
 *     org when absent);
 *   - an om_data_admin is FORCED to its own organization_id; a manifest.orgSlug
 *     that resolves to a DIFFERENT org → 403.
 * The slug resolution reuses the shared resolveOrgIdBySlug (default/legacy →
 * fixed default org id), run on the plain query helper (no tx needed here).
 * @param {Object} user - req.user ({ role, organization_id, org_role })
 * @param {Object} manifest - validated manifest ({ project: { orgSlug } })
 * @returns {Promise<string>} the resolved+authorized organization_id
 * @throws {ForbiddenError} when the caller may not write the target OM
 */
async function resolveUploadOrgId(user, manifest) {
  if (!user) throw new ForbiddenError();
  const orgSlug = manifest.project?.orgSlug ?? null;

  if (user.role === 'admin') {
    // Global admin: honor the manifest's orgSlug (or default org if absent).
    return resolveOrgIdBySlug(queryTask, orgSlug);
  }

  // om_data_admin: must be a writer in their own org, and the manifest must not
  // target a different org.
  if (!user.organization_id || !canWriteOrg(user, user.organization_id)) {
    throw new ForbiddenError();
  }
  if (orgSlug) {
    const resolved = await resolveOrgIdBySlug(queryTask, orgSlug);
    if (resolved !== user.organization_id) {
      throw new ForbiddenError('Cannot upload to a different organization');
    }
  }
  return user.organization_id;
}

/**
 * Loads a project by slug WITHIN the caller's authorization scope and enforces
 * write ownership. An om_data_admin resolves it inside its OWN org only. A global
 * admin resolves it across OMs — but slug is only UNIQUE per org, so if the SAME
 * slug exists in ≥2 orgs the lookup is AMBIGUOUS: FIX-5 returns 409 asking the
 * caller to disambiguate via ?orgId (uuid) or ?orgSlug, instead of silently acting
 * on an arbitrary `ORDER BY created_at LIMIT 1` match (which could be the wrong OM).
 * @param {string} slug
 * @param {Object} user
 * @param {Object} [opts]
 * @param {string} [opts.orgId]   - optional org uuid to disambiguate (global admin)
 * @param {string} [opts.orgSlug] - optional org slug to disambiguate (global admin)
 * @returns {Promise<Object>} the project row (org-scoped)
 * @throws {NotFoundError} 404 if no such project in scope
 * @throws {ConflictError} 409 if the global-admin slug is ambiguous (multi-OM)
 * @throws {ForbiddenError} 403 if found but not writable
 */
async function loadWritableProject(slug, user, opts = {}) {
  if (!user) throw new ForbiddenError();

  let project;
  if (user.role === 'admin') {
    // Optional disambiguation: resolve an explicit org (uuid or slug) first.
    let orgId = opts.orgId ?? null;
    if (!orgId && opts.orgSlug) {
      orgId = await resolveOrgIdBySlug(queryTask, opts.orgSlug);
    }

    if (orgId) {
      const { rows } = await query(AQ.GET_PROJECT_FOR_ADMIN, [orgId, slug]);
      project = rows[0];
    } else {
      // No explicit org: locate by slug across OMs. Detect ambiguity (≥2 orgs
      // own this slug) and refuse to guess.
      const { rows } = await query(
        `SELECT id, organization_id, slug, name, center_lat, center_long,
                entry_photo_id, photo_count, db_filename, status, created_at, updated_at
           FROM sv360.projects WHERE slug = $1 ORDER BY created_at`,
        [slug]
      );
      if (rows.length > 1) {
        throw new ConflictError(
          `Ambiguous slug '${slug}' exists in ${rows.length} organizations; ` +
            `specify the organization via ?orgId or ?orgSlug`
        );
      }
      project = rows[0];
    }
  } else {
    if (!user.organization_id) throw new ForbiddenError();
    const { rows } = await query(AQ.GET_PROJECT_FOR_ADMIN, [user.organization_id, slug]);
    project = rows[0];
  }

  if (!project) throw new NotFoundError('Project');
  if (!canWriteProject(user, project)) throw new ForbiddenError();
  return project;
}

// --- public API ------------------------------------------------------------

/**
 * Lists projects for the admin view INCLUDING disabled. A global admin sees every
 * OM (optionally filtered by orgId); an om_data_admin is scoped to its own org.
 * @param {Object} user - req.user
 * @param {Object} [opts]
 * @param {string} [opts.orgId] - optional ?orgId filter (global admin only)
 * @returns {Promise<Object[]>} project rows
 */
export async function listProjects(user, { orgId } = {}) {
  if (!user) throw new ForbiddenError();
  const isAdmin = user.role === 'admin';
  if (!isAdmin && !user.organization_id) throw new ForbiddenError();
  const { rows } = await query(AQ.LIST_PROJECTS_ADMIN, [
    isAdmin,
    user.organization_id ?? null,
    isAdmin ? (orgId ?? null) : null,
  ]);
  return rows;
}

/**
 * Toggles a project's public visibility (enabled|disabled). Ownership enforced.
 * @param {string} slug
 * @param {'enabled'|'disabled'} status
 * @param {Object} user
 * @returns {Promise<Object>} the updated project row
 */
export async function setStatus(slug, status, user, opts = {}) {
  const project = await loadWritableProject(slug, user, opts);
  const { rows } = await query(AQ.UPDATE_PROJECT_STATUS, [
    project.organization_id,
    slug,
    status,
  ]);
  return rows[0];
}

/**
 * HARD-deletes a project (CASCADE clears photos -> targets) and removes its
 * {slug}.db from disk AFTER evicting any cached worker handle (Windows). The DB
 * row is deleted first; the file removal is best-effort (logged on failure, but
 * the request still succeeds since the authoritative metadata is gone).
 * @param {string} slug
 * @param {Object} user
 * @returns {Promise<void>}
 */
export async function deleteProject(slug, user, opts = {}) {
  const project = await loadWritableProject(slug, user, opts);
  const { rows } = await query(AQ.DELETE_PROJECT, [project.organization_id, slug]);
  const deleted = rows[0];
  if (!deleted) throw new NotFoundError('Project');

  // Remove the {slug}.db after releasing any cached readonly handle.
  const dbPath = resolveDbPath(deleted.db_filename);
  await evictDbPath(dbPath);
  if (existsSync(dbPath)) {
    rmSync(dbPath, { force: true });
  }
  // Best-effort cleanup of stray .tmp/.bak siblings + the org-keyed thumbnail.
  for (const sibling of [dbPath + '.tmp', dbPath + '.bak', dbPath.replace(/\.db$/i, '.webp')]) {
    if (existsSync(sibling)) {
      try {
        rmSync(sibling, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Ingests a multipart bundle (manifest.json + images.db + optional thumbnail).
 * Parses + validates the manifest, resolves+authorizes the target org (ownership
 * HERE), then hands off to ingestBundle. The order there is swap-THEN-commit: the
 * atomic {orgId}__{slug}.db swap is PASSO 1 and the Postgres merge tx is PASSO 2
 * (ver o cabeçalho de `ingestBundle` em `sv360.ingest.js`), which is why the
 * ingestion lock is advisory and not transaction-scoped — a tx-scoped lock would
 * be taken too late to protect the file. A espera pelo lock é limitada
 * (`lock_timeout`), então uma ingestão concorrente do mesmo (org, slug) pode
 * devolver 503 retentável em vez de reter a conexão do pool. Persists the
 * optional thumbnail to disk (the serving route is
 * stage 3b). Does NOT clean the multer tmp files — the controller owns that.
 *
 * @param {Object} user - req.user
 * @param {Object} files - resolved multer files:
 *   { manifestPath: string, imagesDbPath: string, thumbnailPath?: string }
 * @returns {Promise<{projectId:string, slug:string, dbFilename:string, photoCount:number}>}
 * @throws {ForbiddenError} 403 when the caller may not write the target OM
 * @throws {BadRequestError} 400 on a missing manifest/images.db
 * @throws {ValidationError} 422 on an invalid manifest
 * @throws {ConflictError} 409 on a cross-OM photo-id collision (from mergeProject)
 */
export async function uploadBundle(user, files = {}) {
  const { manifestPath, imagesDbPath, thumbnailPath } = files;
  if (!manifestPath) throw new BadRequestError('manifest.json is required');
  if (!imagesDbPath) throw new BadRequestError('images.db is required');

  // Parse + validate the manifest up front (so the org/ownership resolution sees
  // a clean orgSlug and the controller gets a 422 before any heavy work).
  let raw;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new BadRequestError('manifest.json is not valid JSON');
  }
  const manifest = validateManifest(raw);

  // Ownership: resolve + authorize the target organization_id (admin vs om).
  const orgId = await resolveUploadOrgId(user, manifest);

  // Ingest (validateImagesDb size-check -> atomic swap -> merge tx; see above).
  const result = await ingestBundle({
    manifest,
    dbTmpPath: imagesDbPath,
    orgId,
    source: 'upload',
  });

  // Persist the optional thumbnail to disk under SV360_DB_DIR, ORG-KEYED exactly
  // like the {orgId}__{slug}.db BLOB store (result.dbFilename) — NEVER slug-only,
  // or two orgs sharing a slug would overwrite/leak each other's thumbnail. The
  // GET /thumbnails route resolves the same org-keyed name from the project row.
  if (thumbnailPath && existsSync(thumbnailPath)) {
    try {
      const thumbDest = resolveDbPath(result.dbFilename.replace(/\.db$/i, '.webp'));
      mkdirSync(path.dirname(thumbDest), { recursive: true });
      copyFileSync(thumbnailPath, thumbDest);
    } catch (err) {
      // A thumbnail failure must not fail the ingestion (the project is live).
      void err;
    }
  }

  return result;
}
