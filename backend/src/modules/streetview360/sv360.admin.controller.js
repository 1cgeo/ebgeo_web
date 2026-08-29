// Path: src/modules/streetview360/sv360.admin.controller.js
// HTTP layer for the StreetView 360 ADMIN / INGESTION routes (Fase 9, stage 3a).
//
// Every handler is reached only AFTER the STRICT `auth` middleware (401 if no
// credential). Ownership lives in the SERVICE, not here: `canWriteProject`
// (sv360.write.service.js) admits the global admin and the PRODUCER of the owning
// OM (`producer_org_id`). This line said `om_data_admin`, a role axis dropped with
// its column in 2026-08-20. Responses follow the FROZEN flat 360 contract: bare JSON (NOT wrapped
// in {data}); errors bubble to the router-level sv360ErrorHandler ({ error }).
//
// The upload reads the multer.fields() result (req.files.{manifest,imagesDb,
// thumbnail}[0].path — disk storage, the images.db is multi-GB and streamed to a
// tmp path, never in memory). The controller ALWAYS cleans the multer tmp files
// in a finally: on success the images.db tmp was already copied by the swap, so
// removing the leftover tmp is safe; on failure all tmp files are removed.
import { existsSync, rmSync } from 'node:fs';
import { asyncHandler } from '../../utils/async-handler.js';
import { createAudit } from '../../utils/audit.js';
import { principalUserId } from '../../utils/principal.js';
import * as asvc from './sv360.admin.service.js';
import * as videoStore from '../catalog-video/catalog-video.store.js';
import { BadRequestError } from '../../utils/errors.js';

// Best-effort removal of a multer tmp file (never throws).
function cleanTmp(p) {
  if (p && existsSync(p)) {
    try {
      rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * POST /sv360/admin/projects/upload — ingest a bundle (manifest.json + images.db
 * + optional {slug}_tiles.db + optional thumbnail.webp) via multipart. 201 with the
 * project summary.
 * Ownership + merge tx + atomic {slug}.db swap happen in the service/ingest.
 */
export const uploadProject = asyncHandler(async (req, res) => {
  const files = req.files || {};
  const manifestPath = files.manifest?.[0]?.path;
  const imagesDbPath = files.imagesDb?.[0]?.path;
  // OPCIONAL, e obrigatório na prática para acervo só-tiles: sem ele
  // `validateImagesDb` recusa o bundle, porque não sobraria fonte de pixel nenhuma.
  const tilesDbPath = files.tilesDb?.[0]?.path;
  const thumbnailPath = files.thumbnail?.[0]?.path;

  try {
    if (!manifestPath) throw new BadRequestError('manifest field is required');
    if (!imagesDbPath) throw new BadRequestError('imagesDb field is required');

    // O `orgId` SAI DO ENVELOPE E NÃO ENTRA NA RESPOSTA: o corpo do 201 é contrato
    // congelado do 360 (envelope plano, sem `{data}`), e a OM está aqui só para a
    // trilha — sem ela o produtor não veria a própria ingestão na tela de auditoria,
    // que é o evento de NASCIMENTO do recurso dele.
    const { orgId, ...result } = await asvc.uploadBundle(req.user, {
      manifestPath,
      imagesDbPath,
      tilesDbPath,
      thumbnailPath,
    });
    // A TRILHA FICA AQUI, FORA DO INGEST, e é decisão e não descuido: a transação do
    // ingest vive dentro de `ingestBundle`, cujo desenho é swap-ENTÃO-commit (o
    // arquivo é trocado no PASSO 1 e o Postgres só fecha no PASSO 2). Enfiar a
    // auditoria lá dentro obrigaria a arrastar `req` por três camadas para ganhar
    // atomicidade sobre um efeito que já não é atômico — o `.db` no disco não volta
    // com o rollback. Aqui a linha só nasce depois de o ingest ter resolvido.
    //
    // Tudo o que ela precisa já vem do retorno, então não há segunda consulta.
    await createAudit(req, {
      action: 'SV360_INGEST',
      actorId: principalUserId(req.user),
      targetType: 'SV360_PROJECT',
      targetId: result.projectId,
      targetName: result.slug,
      targetOrgId: orgId,
      details: {
        slug: result.slug,
        dbFilename: result.dbFilename,
        photoCount: result.photoCount,
        source: 'upload',
        hasThumbnail: Boolean(thumbnailPath),
      },
    });
    res.status(201).json(result);
  } finally {
    // manifest + thumbnail tmp are always disposable; the images.db tmp was
    // copied by the swap on success and should be removed on failure too.
    cleanTmp(manifestPath);
    cleanTmp(thumbnailPath);
    cleanTmp(imagesDbPath);
    cleanTmp(tilesDbPath);
  }
});

/**
 * PATCH /sv360/admin/projects/:slug/status — { status: 'enabled'|'disabled' }.
 * 200 with the updated project.
 */
export const updateProjectStatus = asyncHandler(async (req, res) => {
  const project = await asvc.setStatus(req.params.slug, req.body.status, req.user, {
    orgId: req.query.orgId,
    orgSlug: req.query.orgSlug,
  }, req);
  res.json(project);
});

/**
 * PATCH /sv360/admin/projects/:slug — metadado editável do projeto: nome, descrição,
 * palavra-chave, local, data de captura, centro (lon/lat) e vídeo de prévia. 200 com a linha
 * atualizada, no mesmo envelope plano das irmãs. Atualização parcial: só o que o corpo traz muda.
 */
export const updateProjectMetadata = asyncHandler(async (req, res) => {
  const project = await asvc.updateProjectMetadata(req.params.slug, req.body, req.user, {
    orgId: req.query.orgId,
    orgSlug: req.query.orgSlug,
  }, req);
  res.json(project);
});

/**
 * PATCH /sv360/admin/projects/:slug/owner-org — transfere a OM dona (só-admin). Troca de
 * coluna, sem tocar o disco. 200 com a linha atualizada.
 */
export const transferProjectOwner = asyncHandler(async (req, res) => {
  const project = await asvc.transferProjectOwner(req.params.slug, req.body.owner_org_id, req.user, {
    orgId: req.query.orgId,
    orgSlug: req.query.orgSlug,
  }, req);
  res.json(project);
});

/**
 * POST /sv360/admin/projects/:slug/preview-video — ENVIA o vídeo de prévia (multipart, campo
 * `video`). Salva o arquivo, grava a URL na coluna e apaga o vídeo hospedado anterior. 200.
 */
export const uploadPreviewVideo = asyncHandler(async (req, res) => {
  const tmp = req.files?.video?.[0]?.path ?? req.file?.path;
  if (!tmp) throw new BadRequestError('Envie um vídeo no campo "video".');
  let url;
  try {
    url = await videoStore.saveVideo(tmp);
  } finally {
    cleanTmp(tmp);
  }
  try {
    const { row, oldUrl } = await asvc.setProjectVideoUrl(req.params.slug, url, req.user, {
      orgId: req.query.orgId, orgSlug: req.query.orgSlug,
    }, req);
    videoStore.deleteVideoByUrl(oldUrl);
    res.json(row);
  } catch (err) {
    videoStore.deleteVideoByUrl(url);
    throw err;
  }
});

/**
 * DELETE /sv360/admin/projects/:slug/preview-video — remove o vídeo (coluna + arquivo). 200.
 */
export const removePreviewVideo = asyncHandler(async (req, res) => {
  const { row, oldUrl } = await asvc.setProjectVideoUrl(req.params.slug, null, req.user, {
    orgId: req.query.orgId, orgSlug: req.query.orgSlug,
  }, req);
  videoStore.deleteVideoByUrl(oldUrl);
  res.json(row);
});

/**
 * POST /sv360/admin/projects/:slug/thumbnail — substitui a thumbnail (multipart, campo
 * `thumbnail`). 200 com a linha. O tmp do multer é sempre limpo aqui.
 */
export const replaceThumbnail = asyncHandler(async (req, res) => {
  const thumbnailPath = req.files?.thumbnail?.[0]?.path ?? req.file?.path;
  if (!thumbnailPath) throw new BadRequestError('Envie uma imagem no campo "thumbnail".');
  try {
    const project = await asvc.replaceThumbnail(req.params.slug, thumbnailPath, req.user, {
      orgId: req.query.orgId,
      orgSlug: req.query.orgSlug,
    }, req);
    res.json(project);
  } finally {
    cleanTmp(thumbnailPath);
  }
});

/**
 * DELETE /sv360/admin/projects/:slug — HARD-delete the project (CASCADE photos ->
 * targets) + remove the {slug}.db from disk (after a blobPool evict). 204.
 */
export const deleteProject = asyncHandler(async (req, res) => {
  await asvc.deleteProject(req.params.slug, req.user, {
    orgId: req.query.orgId,
    orgSlug: req.query.orgSlug,
  }, req);
  res.status(204).end();
});

/**
 * GET /sv360/admin/projects — list the caller's OM projects INCLUDING disabled
 * (a global admin sees all OMs, optionally filtered by ?orgId). 200 with array.
 */
export const listProjects = asyncHandler(async (req, res) => {
  const projects = await asvc.listProjects(req.user, { orgId: req.query.orgId });
  res.json(projects);
});
