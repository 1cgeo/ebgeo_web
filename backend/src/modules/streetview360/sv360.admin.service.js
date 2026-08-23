// Path: src/modules/streetview360/sv360.admin.service.js
// ADMIN / INGESTION business logic for the StreetView 360 module (Fase 9, stage
// 3a). Builds on stages 1-2 WITHOUT changing them. OWNERSHIP IS ENFORCED HERE
// (not in middleware), mirroring sv360.write.service.js:
//   - global admin (user.role === 'admin') may write ANY OM;
//   - a PRODUCER (users.producer_org_id) may write only the OM it produces for.
//     Lotação (users.organization_id) não autoriza mais nada aqui.
//
// The merge/purge/collision semantics live ONCE in sv360.merge.js (reused by the
// ETL); this service resolves the target org + ownership, then hands off to
// ingestBundle (which owns the tx + atomic {slug}.db swap). list/status/delete
// are thin Postgres lifecycle ops; delete also removes the {slug}.db AFTER a
// blobPool evict (Windows file-handle release).
import { readFileSync, existsSync, rmSync, copyFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileTypeFromFile } from 'file-type';
import { query, tx } from '../../database/index.js';
import logger from '../../utils/logger.js';
import * as AQ from './sv360.admin.queries.js';
import { canWriteProject } from './sv360.write.service.js';
import { resolveDbPath, ingestBundle, validateManifest } from './sv360.ingest.js';
import { resolveOrgIdBySlug } from './sv360.merge.js';
import { blobPool } from '../../utils/sqlite-blob-pool.js';
import { principalUserId } from '../../utils/principal.js';
import { createAudit } from '../../utils/audit.js';
import { diffAuditavel } from '../../utils/audit-diff.js';
import { purgeResourceLinks } from '../resource-access/resource-access.service.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../utils/errors.js';

// Runs `fn` (the file removal) with the pool holding NO handle on dbPath for the
// WHOLE section — evicting alone leaves a window in which a concurrent read
// reopens the file and the rm fails EBUSY on Windows (achado 59/61). Falls back to
// closeAll + fn only if the pool singleton is stubbed without withEvicted.
async function withDbPathEvicted(dbPath, fn) {
  if (typeof blobPool.withEvicted === 'function') return blobPool.withEvicted(dbPath, fn);
  await blobPool.closeAll();
  return fn();
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

// Hard cap for the OPTIONAL bundle thumbnail, checked HERE and not in multer.
// `limits.fileSize` is shared by the three upload fields, and the images.db that rides
// along is legitimately multi-GB, so the multer limit cannot bound a small preview
// image: until this constant existed the thumbnail inherited SV360_MAX_UPLOAD_BYTES
// (2 GiB by default) and was copied to its permanent, org-keyed destination with
// `copyFileSync` and no inspection at all. 5 MiB is ~50x the largest preview the 360
// studio produces and still four orders of magnitude below the old ceiling.
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;

/**
 * Validates the optional bundle thumbnail BEFORE anything is written: real WebP by
 * MAGIC BYTES, and under {@link MAX_THUMBNAIL_BYTES}.
 *
 * The declared mime is not evidence: `ALLOWED_FIELD_MIME.thumbnail` accepts
 * `application/octet-stream` (deliberately — a genuine .webp mislabeled by the client
 * must still upload), so the only thing that can distinguish an image from an arbitrary
 * blob is its content. That mattered because the file lands at a PERMANENT, org-keyed
 * path and `GET /sv360/thumbnails/:slug.webp` serves it back with
 * `Content-Type: image/webp` — the upload route was the one place in the codebase where
 * bytes became a served image without the `fileTypeFrom*` check every other upload path
 * applies (`images.service.js`).
 *
 * Refusing here, before `ingestBundle`, is what makes the refusal cheap: nothing has been
 * swapped or committed yet, so the caller gets a clean 400 and no half-done state. This
 * does NOT contradict the rule that "a thumbnail failure must not fail the ingestion" —
 * that rule is about an I/O failure while copying AFTER the project is already live, which
 * is still swallowed (with a log line) below.
 *
 * @param {string} thumbnailPath - multer tmp path
 * @throws {BadRequestError} when the file is too large or is not a WebP
 */
async function assertValidThumbnail(thumbnailPath) {
  const { size } = statSync(thumbnailPath);
  if (size > MAX_THUMBNAIL_BYTES) {
    throw new BadRequestError(
      `thumbnail exceeds ${MAX_THUMBNAIL_BYTES} bytes (got ${size})`
    );
  }
  const detected = await fileTypeFromFile(thumbnailPath);
  if (!detected || detected.mime !== 'image/webp') {
    throw new BadRequestError(
      `thumbnail must be a WebP image (detected: ${detected?.mime ?? 'unknown'})`
    );
  }
}

// Org-write predicate WITHOUT a concrete project row (for the create/list paths,
// where the project may not exist yet): a global admin, or the PRODUCER of THIS
// org. Reuses canWriteProject by passing a synthetic { organization_id } so the
// single ownership rule is not duplicated.
function canWriteOrg(user, orgId) {
  return canWriteProject(user, { organization_id: orgId });
}

/**
 * Resolves the TARGET organization_id for an upload and enforces ownership:
 *   - a global admin may target any OM (the manifest's orgSlug, or the default
 *     org when absent);
 *   - a PRODUCER is FORCED to its own producer_org_id; a manifest.orgSlug that
 *     resolves to a DIFFERENT org → 403. É a mesma regra do catálogo: quem produz
 *     não escolhe de quem é o que produziu.
 * The slug resolution reuses the shared resolveOrgIdBySlug (default/legacy →
 * fixed default org id), run on the plain query helper (no tx needed here).
 * @param {Object} user - req.user ({ role, producer_org_id })
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

  // Produtor: escreve no PRÓPRIO escopo de produção, e o manifesto não pode apontar
  // para outro.
  if (!user.producer_org_id || !canWriteOrg(user, user.producer_org_id)) {
    throw new ForbiddenError();
  }
  if (orgSlug) {
    const resolved = await resolveOrgIdBySlug(queryTask, orgSlug);
    if (resolved !== user.producer_org_id) {
      throw new ForbiddenError('Cannot upload to a different organization');
    }
  }
  return user.producer_org_id;
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
                entry_photo_id, photo_count, db_filename, status, preview_video,
                created_at, updated_at
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
    if (!user.producer_org_id) throw new ForbiddenError();
    const { rows } = await query(AQ.GET_PROJECT_FOR_ADMIN, [user.producer_org_id, slug]);
    project = rows[0];
  }

  if (!project) throw new NotFoundError('Project');
  if (!canWriteProject(user, project)) throw new ForbiddenError();
  return project;
}

// --- public API ------------------------------------------------------------

/**
 * Lists projects for the admin view INCLUDING disabled. A global admin sees every
 * OM (optionally filtered by orgId); a producer is scoped to the OM it produces for.
 *
 * QUEM RECORTA AS LINHAS É O SQL (`fn_can_produce_resource`), não este JS: o
 * booleano `isAdmin` que ia para a consulta era a forma que abria por engano (um
 * TRUE curto-circuita a disjunção inteira). Ele sobrevive aqui só para decidir se o
 * filtro OPCIONAL `?orgId` é honrado e para recusar cedo quem não administra nem
 * produz — que é uma recusa de ROTA, não o filtro do dado.
 * @param {Object} user - req.user
 * @param {Object} [opts]
 * @param {string} [opts.orgId] - optional ?orgId filter (global admin only)
 * @returns {Promise<Object[]>} project rows
 */
export async function listProjects(user, { orgId } = {}) {
  if (!user) throw new ForbiddenError();
  const isAdmin = user.role === 'admin';
  if (!isAdmin && !user.producer_org_id) throw new ForbiddenError();
  const { rows } = await query(AQ.LIST_PROJECTS_ADMIN, [
    principalUserId(user),
    isAdmin ? (orgId ?? null) : null,
  ]);
  return rows;
}

/**
 * Toggles a project's public visibility (enabled|disabled). Ownership enforced.
 *
 * AUDITADO NO NÍVEL DO PROJETO porque `status` É UM EIXO DE ACESSO: `disabled` é a
 * OCULTAÇÃO (quem vê o projeto), distinta de `access_level='private'`, que é a
 * PRIVACIDADE (quem pode abri-lo). Alternar isso muda o público de um acervo inteiro
 * e não deixava rastro nenhum.
 *
 * `from` vem da linha lida por `loadWritableProject`, não de uma segunda consulta:
 * mudança de nível só é auditável se disser DE ONDE veio.
 *
 * @param {string} slug
 * @param {'enabled'|'disabled'} status
 * @param {Object} user
 * @param {Object} [opts]
 * @param {Object} [req] - Express req, para ip/user-agent da trilha.
 * @returns {Promise<Object>} the updated project row
 */
export async function setStatus(slug, status, user, opts = {}, req = null) {
  const project = await loadWritableProject(slug, user, opts);
  const { rows } = await query(AQ.UPDATE_PROJECT_STATUS, [
    project.organization_id,
    slug,
    status,
  ]);
  await createAudit(req, {
    action: 'SV360_STATUS_CHANGE',
    actorId: principalUserId(user),
    targetType: 'SV360_PROJECT',
    targetId: project.id,
    targetName: project.name ?? slug,
    targetOrgId: project.organization_id,
    details: { slug, orgId: project.organization_id, from: project.status, to: status },
  });
  return rows[0];
}

/**
 * Grava o METADADO editável do projeto — hoje só o vídeo de prévia. Ownership pelo
 * mesmo `loadWritableProject` das outras rotas administrativas.
 *
 * POR QUE UMA ROTA DE METADADO, E NÃO UM CAMPO NO BUNDLE: o vídeo é escolhido depois
 * da ingestão, por quem mantém o acervo, e re-enviar um bundle de vários gigabytes para
 * trocar uma URL não é uma operação que exista. As quatro tabelas de catálogo resolvem
 * isso pelo `config` JSONB; `sv360.projects` não tem `config`, então precisa de porta.
 *
 * ELA NASCE COM UM CAMPO SÓ, E ISSO É DELIBERADO. Alargá-la depois sem revisar o gate a
 * transforma na rota genérica de edição de projeto, que hoje NÃO existe — `slug`,
 * `organization_id` e `db_filename` são derivados no servidor de propósito, e um PATCH
 * que os aceitasse desfaria a garantia de que um manifesto não aponta o store de outra
 * OM. Campo novo aqui é decisão, não acréscimo.
 *
 * A AÇÃO DA TRILHA É `CATALOG_UPDATE`, reusada e não inventada: o projeto 360 é um dos
 * cinco tipos de recurso do catálogo, e uma ação própria exigiria alargar o CHECK de
 * `audit_trail.action`, o que arrasta DROP/ADD CONSTRAINT e uma linha em
 * `EXCECOES_DESTRUTIVAS` para descrever a mesma coisa com outro nome.
 *
 * O DE-PARA VEM DE `utils/audit-diff.js`, e a URL entra como IMPRESSÃO, nunca literal:
 * é endereço, e endereço de serviço pode carregar credencial na query string.
 *
 * @param {string} slug
 * @param {{previewVideo?: string|null}} data - Corpo já validado pelo Joi da rota.
 * @param {Object} user
 * @param {Object} [opts] - `orgId`/`orgSlug` para desambiguar slug cross-OM (admin).
 * @param {Object} [req] - Express req, para ip/user-agent da trilha.
 * @returns {Promise<Object>} a linha atualizada
 */
export async function updateProjectMetadata(slug, data, user, opts = {}, req = null) {
  const project = await loadWritableProject(slug, user, opts);
  // A string vazia é como o painel diz "remova o vídeo"; a coluna guarda NULL, que é o
  // mesmo estado de quem nunca teve vídeo. Duas representações para "sem vídeo" fariam a
  // forma pública devolver `''` num caso e `null` no outro, e o cartão teria de conhecer
  // as duas.
  const previewVideo = data.previewVideo ? String(data.previewVideo) : null;
  const { rows } = await query(AQ.UPDATE_PROJECT_METADATA, [
    project.organization_id,
    slug,
    previewVideo,
  ]);
  const antes = { config: { previewVideo: project.preview_video ?? null } };
  const depois = { config: { previewVideo } };
  await createAudit(req, {
    action: 'CATALOG_UPDATE',
    actorId: principalUserId(user),
    targetType: 'SV360_PROJECT',
    targetId: project.id,
    targetName: project.name ?? slug,
    targetOrgId: project.organization_id,
    details: {
      table: 'sv360.projects',
      fields: Object.keys(data || {}),
      ...diffAuditavel(antes, depois),
    },
  });
  return rows[0];
}

/**
 * HARD-deletes a project (CASCADE clears photos -> targets) and removes its
 * {slug}.db from disk AFTER evicting any cached worker handle (Windows). The DB
 * row is deleted first; the file removal is best-effort (logged on failure, but
 * the request still succeeds since the authoritative metadata is gone).
 *
 * The tombstones of the project's photos are purged in the SAME transaction and
 * BEFORE the CASCADE (achado 53): sv360.deleted_photos has no FK, so they would
 * otherwise outlive their photos and, since every read query filters by
 * NOT EXISTS(deleted_photos), the next re-upload of the same bundle would answer
 * 201 with the full photoCount while serving 404 for the resurrected photos.
 *
 * OS VÍNCULOS DE ACESSO SÃO PURGADOS NA MESMA TRANSAÇÃO E ANTES DO DELETE, e essa
 * chamada FALTAVA. `resource_grants` e `atlas_resources` referenciam o projeto por
 * `resource_id` TEXT, sem FK, então nada os levava junto: apagar um projeto deixava
 * concessões e empréstimos apontando para um UUID que não existe mais. O comentário
 * que introduziu `resource_grants` afirmava por escrito que esta limpeza acontecia
 * aqui — não
 * acontecia, e doc que descreve um mecanismo ausente engana em dobro.
 *
 * A ordem (purga antes do DELETE_PROJECT) e a transação única são o que impede os
 * dois estados intermediários: vínculo órfão se a purga viesse depois e falhasse, e
 * trilha de destruição sem destruição se ela vivesse fora da transação.
 *
 * @param {string} slug
 * @param {Object} user
 * @param {Object} [opts]
 * @param {Object} [req] - Express req, para ip/user-agent da trilha.
 * @returns {Promise<void>}
 */
export async function deleteProject(slug, user, opts = {}, req = null) {
  const project = await loadWritableProject(slug, user, opts);
  const actorId = principalUserId(user);
  const deleted = await tx(async (t) => {
    await t.none(AQ.PURGE_TOMBSTONES_BY_PROJECT, [project.id]);
    const purged = await purgeResourceLinks(t, 'sv360_project', project.id, actorId, req);
    const row = await t.oneOrNone(AQ.DELETE_PROJECT, [project.organization_id, slug]);
    if (row) {
      await createAudit(req, {
        action: 'SV360_DELETE',
        actorId,
        targetType: 'SV360_PROJECT',
        targetId: project.id,
        targetName: project.name ?? slug,
        // A OM VAI NA COLUNA, e não só em `details`, e este é o caso que decidiu o
        // desenho inteiro: a linha nasce DEPOIS do DELETE, na mesma transação, então
        // resolver a OM na leitura (por junta ou por gatilho) devolveria NULL para a
        // única destruição irreversível do sistema. O emissor a tem em mãos.
        targetOrgId: project.organization_id,
        // HARD-delete: é o único do sistema, e dizê-lo é o que impede a leitura de
        // que existe uma lixeira de onde recuperar. As contagens de vínculo purgado
        // ficam aqui também, para que a linha do projeto conte a história inteira
        // sem depender de agregar as linhas de PERMISSION_PURGE.
        details: {
          slug, orgId: project.organization_id, hard: true,
          photoCount: project.photo_count ?? null,
          purgedGrants: purged.grants, purgedAtlasLinks: purged.atlasLinks,
        },
      }, t);
    }
    return row;
  });
  if (!deleted) throw new NotFoundError('Project');

  // Remove the {slug}.db inside the pool's swap window: evicting alone leaves a gap
  // in which a concurrent read reopens the handle and the rm fails EBUSY (Windows).
  const dbPath = resolveDbPath(deleted.db_filename);
  await withDbPathEvicted(dbPath, () => {
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
  });
}

/**
 * Ingests a multipart bundle (manifest.json + images.db + optional {slug}_tiles.db
 * + optional thumbnail).
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
 *   { manifestPath: string, imagesDbPath: string, tilesDbPath?: string,
 *     thumbnailPath?: string }
 * @returns {Promise<{projectId:string, slug:string, dbFilename:string, photoCount:number}>}
 * @throws {ForbiddenError} 403 when the caller may not write the target OM
 * @throws {BadRequestError} 400 on a missing manifest/images.db
 * @throws {ValidationError} 422 on an invalid manifest
 * @throws {ConflictError} 409 on a cross-OM photo-id collision (from mergeProject)
 */
export async function uploadBundle(user, files = {}) {
  const { manifestPath, imagesDbPath, tilesDbPath, thumbnailPath } = files;
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

  // Thumbnail: magic bytes + own size cap, BEFORE any state change (see
  // assertValidThumbnail). A bad thumbnail is a 400 on a request that has changed
  // nothing yet, not a junk file served as image/webp forever.
  if (thumbnailPath && existsSync(thumbnailPath)) {
    await assertValidThumbnail(thumbnailPath);
  }

  // Ownership: resolve + authorize the target organization_id (admin vs om).
  const orgId = await resolveUploadOrgId(user, manifest);

  // Ingest (validateImagesDb size-check -> atomic swap -> merge tx; see above).
  const result = await ingestBundle({
    manifest,
    dbTmpPath: imagesDbPath,
    // O SEGUNDO ARQUIVO DO PROJETO. Ele é opcional no formato COM blob e obrigatório
    // no só-tiles, e quem cobra a diferença é `validateImagesDb`, lendo a FORMA do
    // arquivo — nunca uma bandeira do chamador.
    tilesTmpPath: tilesDbPath ?? null,
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
      // A thumbnail failure must not fail the ingestion (the project is live by now —
      // the swap and the merge tx are both done). But `void err` made the copy the only
      // I/O in the module that could fail with NO trace anywhere: the upload answered
      // 201 and the project simply had no thumbnail, with nothing to look at. The
      // CONTENT of the file was already validated above, so anything reaching here is a
      // disk/permission problem the operator needs to see.
      logger.warn(
        { err, dbFilename: result.dbFilename, slug: result.slug },
        'sv360: falha ao persistir o thumbnail do bundle (ingestão mantida)'
      );
    }
  }

  // O `orgId` VIAJA NO ENVELOPE, e o controller o desestrutura FORA da resposta: ele
  // existe para a trilha (o produtor precisa ver a própria ingestão) e o corpo do 201 é
  // contrato congelado do 360, que não ganha campo por causa de auditoria.
  return { ...result, orgId };
}
