// Path: src/modules/atlas/import-attempt.service.js
import crypto from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { tx, query } from '../../database/index.js';
import config from '../../config.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors.js';
import { importAtlas } from './atlas.service.js';
import { assertImportMapCeiling } from './atlas-quota.js';
import { importImageIds } from './import-image-refs.js';
import { createAudit } from '../../utils/audit.js';

const MAX_DRAFT_BYTES = 256 * 1024 * 1024;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const publicAttempt = row => ({ id: row.id, imageIds: row.image_ids, result: row.result });

async function owned(t, userId, id, lock = true) {
  const row = await t.oneOrNone(`SELECT * FROM atlas_import_attempts WHERE id = $1 AND user_id = $2 ${lock ? 'FOR UPDATE' : ''}`, [id, userId]);
  if (!row) throw new NotFoundError('Preparação da importação não encontrada.');
  if (!row.result && new Date(row.expires_at).getTime() <= Date.now()) throw new ConflictError('A preparação expirou. Importe novamente o arquivo original.');
  return row;
}

/**
 * DECLARED-MISSING IMAGES (2026-09-21). Until then every original the payload cites had to be in
 * the manifest, so ONE image whose file no longer exists anywhere (a feature kept, its blob lost
 * years ago) made the whole atlas impossible to publish, forever, with no way out on the client.
 * The client may now DECLARE the originals it does not have, after asking the person. The
 * declaration is checked three ways so it cannot become a loophole: every cited original is in
 * exactly one of the two lists, the lists do not overlap, and nothing is declared missing that
 * the payload does not cite. Nothing is stored: at commit the set is DERIVED again (cited minus
 * manifest), which is what the audit entry records.
 */
function assertImageManifest(payload, imageIds, missingImageIds) {
  const supplied = new Set(imageIds);
  const missing = new Set(missingImageIds);
  const cited = importImageIds(payload);
  if ([...missing].some(id => supplied.has(id))) throw new BadRequestError('Uma imagem foi declarada ao mesmo tempo como enviada e como ausente.');
  if ([...missing].some(id => !cited.has(id))) throw new BadRequestError('Foi declarada ausente uma imagem que o atlas não cita.');
  if ([...cited].some(id => !supplied.has(id) && !missing.has(id))) throw new BadRequestError('O manifesto não contém todas as imagens originais do atlas.');
}

export async function beginImport(userId, { id, sourceKey, payload, imageIds, missingImageIds = [] }) {
  assertImportMapCeiling(payload.maps);
  assertImageManifest(payload, imageIds, missingImageIds);
  return tx(async t => {
    // Serialize the per-account staging quota and concurrent repeats of begin.
    await t.any("SELECT pg_advisory_xact_lock(hashtextextended('import:' || $1, 0))", [userId]);
    await t.none('DELETE FROM atlas_import_attempts WHERE user_id = $1 AND result IS NULL AND expires_at < NOW()', [userId]);
    const previous = await t.oneOrNone('SELECT * FROM atlas_import_attempts WHERE id = $1', [id]);
    if (previous) {
      if (previous.user_id !== userId) throw new NotFoundError('Preparação da importação não encontrada.');
      if (previous.source_key !== sourceKey) throw new ConflictError('Esta tentativa pertence a outro conteúdo.');
      return publicAttempt(previous);
    }
    const { count } = await t.one('SELECT COUNT(*)::int AS count FROM atlas_import_attempts WHERE user_id = $1 AND result IS NULL', [userId]);
    if (count >= 3) throw new ConflictError('Há três importações em preparação. Retome ou descarte uma delas antes de iniciar outra.');
    const row = await t.one('INSERT INTO atlas_import_attempts (id, user_id, source_key, payload, image_ids) VALUES ($1,$2,$3,$4::jsonb,$5::uuid[]) RETURNING *',
      [id, userId, sourceKey, JSON.stringify(payload), imageIds]);
    return publicAttempt(row);
  });
}

export async function readImport(userId, id) {
  // Wait for an in-flight commit before deciding that a preparation expired.
  return tx(async t => publicAttempt(await owned(t, userId, id)));
}

export async function discardImport(userId, id) {
  return tx(async t => {
    const row = await owned(t, userId, id);
    if (row.result) throw new ConflictError('A importação já foi publicada. O atlas foi preservado.');
    await t.none('DELETE FROM atlas_import_attempts WHERE id = $1 AND user_id = $2', [id, userId]);
  });
}

export async function stageImportImages(userId, id, images) {
  return tx(async t => {
    const attempt = await owned(t, userId, id);
    if (attempt.result) return publicAttempt(attempt);
    const expected = new Set(attempt.image_ids);
    for (const image of images) {
      if (!expected.has(image.localId)) throw new BadRequestError('Imagem não declarada nesta importação.');
      const raw = image.data.includes(',') ? image.data.slice(image.data.indexOf(',') + 1) : image.data;
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new BadRequestError('Imagem com base64 inválido.');
      const bytes = Buffer.from(raw, 'base64');
      if (!bytes.length || bytes.length > config.images.maxSizeMb * 1024 * 1024) throw new BadRequestError('Imagem vazia ou acima do limite permitido.');
      const type = await fileTypeFromBuffer(bytes);
      if (!type || !EXT[type.mime] || type.mime !== image.mimeType) throw new BadRequestError('O conteúdo da imagem não corresponde ao tipo informado.');
      const contentHash = hash(bytes);
      const previous = await t.oneOrNone('SELECT content_hash FROM atlas_import_images WHERE attempt_id = $1 AND id = $2', [id, image.localId]);
      if (previous) {
        if (previous.content_hash !== contentHash) throw new ConflictError('A imagem desta tentativa tem outro conteúdo.');
        continue;
      }
      const { total } = await t.one('SELECT COALESCE(SUM(octet_length(bytes)), 0)::bigint AS total FROM atlas_import_images WHERE attempt_id = $1', [id]);
      if (Number(total) + bytes.length > MAX_DRAFT_BYTES) throw new BadRequestError('As imagens desta importação excedem 256 MiB. Divida o acervo em arquivos menores.');
      await t.none('INSERT INTO atlas_import_images (attempt_id,id,filename,mime_type,content_hash,bytes) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, image.localId, image.filename, image.mimeType, contentHash, bytes]);
    }
    return publicAttempt(attempt);
  });
}

/** All files are complete before atlas, image descriptors and receipt commit together. */
export async function commitImport(userId, id, { openFile = open, auditRequest = null } = {}) {
  const files = [];
  try {
    return await tx(async t => {
      const attempt = await owned(t, userId, id);
      if (attempt.result) return { atlas: attempt.result, reused: true };
      const images = await t.any('SELECT * FROM atlas_import_images WHERE attempt_id = $1 ORDER BY id', [id]);
      if (images.length !== attempt.image_ids.length) throw new ConflictError('Ainda faltam imagens. Nenhum atlas foi publicado.');
      const occupied = await t.any('SELECT id FROM images WHERE id=ANY($1::uuid[]) UNION SELECT id FROM features WHERE id=ANY($1::uuid[])', [attempt.image_ids]);
      if (occupied.length) throw new ConflictError('Um identificador de imagem já está em uso. Nenhum atlas foi publicado.');
      // Cited minus manifest: the originals the client declared missing at begin (derived, not stored).
      const manifest = new Set(attempt.image_ids);
      const missingImages = [...importImageIds(attempt.payload)].filter(imageId => !manifest.has(imageId)).length;
      const atlas = await importAtlas(userId, attempt.payload, { transaction: work => work(t) });
      const directory = join(config.images.dir, atlas.id);
      await mkdir(directory, { recursive: true });
      for (const image of images) {
        if (hash(image.bytes) !== image.content_hash) throw new ConflictError('A imagem preparada não passou na verificação.');
        const path = join(directory, `${crypto.randomUUID()}.${EXT[image.mime_type]}`);
        files.push(path);
        const handle = await openFile(path, 'wx');
        try { await handle.writeFile(image.bytes); await handle.sync(); } finally { await handle.close(); }
        if (hash(await readFile(path)) !== image.content_hash) throw new Error('A imagem gravada não passou na verificação.');
        await t.none('INSERT INTO images (id,atlas_id,filename,mime_type,size_bytes,storage_path,uploaded_by,content_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [image.id, atlas.id, image.filename, image.mime_type, image.bytes.length, path, userId, image.content_hash]);
      }
      if (process.platform !== 'win32') {
        const handle = await open(directory, 'r');
        try { await handle.sync(); } finally { await handle.close(); }
      }
      await t.none("UPDATE atlas_import_attempts SET result=$2::jsonb, payload=NULL, expires_at=NOW()+INTERVAL '7 days' WHERE id=$1", [id, JSON.stringify(atlas)]);
      await t.none('DELETE FROM atlas_import_images WHERE attempt_id=$1', [id]);
      await createAudit(auditRequest, { action: 'ATLAS_CREATE', actorId: userId, targetType: 'ATLAS',
        targetId: atlas.id, targetName: atlas.name, details: { via: 'import', summary: atlas.summary ?? null, missingImages } }, t);
      return { atlas, reused: false };
    });
  } catch (error) {
    // A COMMIT response can be lost too. Never delete files unless the database confirms
    // they are unreferenced; when the database is unavailable, keep them for recovery.
    if (files.length) {
      try {
        const { rows } = await query('SELECT storage_path FROM images WHERE storage_path = ANY($1::text[])', [files]);
        const committed = new Set(rows.map(row => row.storage_path));
        await Promise.all(files.filter(path => !committed.has(path)).map(path => unlink(path).catch(() => {})));
      } catch { /* Preserve potentially committed files. */ }
    }
    throw error;
  }
}
