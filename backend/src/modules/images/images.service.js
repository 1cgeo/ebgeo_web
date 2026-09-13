// Path: src/modules/images/images.service.js
import { mkdir, unlink, writeFile, stat, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import crypto from 'crypto';
import { fileTypeFromFile, fileTypeFromBuffer } from 'file-type';
import { query } from '../../database/index.js';
import { NotFoundError, BadRequestError } from '../../utils/errors.js';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { safeErrorMessage } from '../../utils/safe-error-message.js';
import * as Q from './images.queries.js';

// SVG removed: it is a stored-XSS vector when served, and the frontend does
// not rely on it for features. Reintroduce only with explicit sanitization.
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Extension for the SERVER-generated blob name of the /bulk path, derived from the
// mime type — NOT from the client's `filename`.
//
// `filename.split('.').pop()` used to build this path component, so `'a.png/x'`
// produced `<atlasDir>/<uuid>.png/x`, whose parent directory does not exist, and the
// write failed with ENOENT. (Not traversal: the `split('.')` consumes the dots of
// `..`; the outcome is ENOENT / ENAMETOOLONG.) The multer path already had
// `safeExtension` in images.routes.js, which walks the same ground from the other
// side — it sanitizes the client string. Here the string is not needed at all: the
// mime type is already constrained by ALLOWED_MIME_TYPES above AND cross-checked
// against the decoded bytes by `fileTypeFromBuffer`, so deriving from it leaves ZERO
// client-controlled bytes in the path, which is strictly stronger than sanitizing.
// It is also exactly what the real client sends (`EXT_BY_MIME` in the frontend's
// save-local-atlas.service.js builds `filename` from the same table).
const EXT_BY_MIME = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
});

/**
 * Strips server-internal columns from an image row before it crosses the API
 * boundary. `storage_path` is an absolute filesystem path (leaks the deployment
 * layout) and must never reach a client — including read-level / public-atlas
 * viewers who can list an atlas's images.
 */
function toPublicImage(row) {
  if (!row) return row;
  // eslint-disable-next-line no-unused-vars
  const { storage_path, ...pub } = row;
  return pub;
}

/**
 * The content identity of an image: lowercase sha256 hex of its exact bytes.
 *
 * ONE function for the two doors, because the two doors must agree: the single route hashes a file
 * multer already wrote, the bulk route hashes the buffer it decoded from base64, and a retry that
 * arrives through the other door has to produce the SAME string or the dedupe silently stops
 * deduping. The CHECK in 013_imagens_idempotentes.sql pins the shape (64 lowercase hex chars).
 * @param {Buffer} buffer - The exact bytes that will be (or already were) stored.
 * @returns {string} 64 lowercase hex characters.
 */
export function hashImageContent(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * The stored hash of a row, ADOPTING one from disk when the column is still NULL.
 *
 * A NULL hash is not a defect and not a legacy leftover only: the atlas clone copies the bytes and
 * mints new rows without a hash, so the state is reachable on a fresh install. Refusing a retry
 * over a NULL would turn "I cannot tell" into "different content", which is the wrong answer on a
 * row whose file is right there to read.
 *
 * It returns null, never throws, when the file is unreadable: at that point the row points at
 * nothing and the caller must fall back to refusing, which is what it already did.
 * @param {Object} row - An `images` row (needs `id`, `atlas_id`, `content_hash`, `storage_path`).
 * @returns {Promise<string|null>} The hash, or null when it cannot be established.
 */
async function resolveContentHash(row) {
  if (typeof row?.content_hash === 'string' && row.content_hash.length === 64) {
    return row.content_hash;
  }
  if (!row?.storage_path) return null;
  let hash;
  try {
    hash = hashImageContent(await readFile(resolve(row.storage_path)));
  } catch (err) {
    logger.warn({ imageId: row.id, error: err.message }, 'Could not hash a stored image to adopt its content identity');
    return null;
  }
  try {
    await query(Q.ADOPT_CONTENT_HASH, [row.id, row.atlas_id, hash]);
  } catch (err) {
    // The adoption is a cache, not the answer: losing it costs one re-read on the next retry.
    logger.warn({ imageId: row.id, error: err.message }, 'Could not persist an adopted image content hash');
  }
  return hash;
}

/**
 * True when a pg error is the unique violation of an index we deliberately lean on.
 * @param {*} err
 * @returns {boolean}
 */
function isUniqueViolation(err) {
  return err?.code === '23505';
}

export async function uploadImage(atlasId, file, userId, attemptKey = null) {
  if (!file) {
    throw new BadRequestError('No file uploaded');
  }

  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throw new BadRequestError(`Invalid file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`);
  }

  const maxBytes = config.images.maxSizeMb * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new BadRequestError(`File too large. Maximum size: ${config.images.maxSizeMb}MB`);
  }

  // Validate the actual file CONTENT (magic bytes) against the declared type.
  // Defends against e.g. an HTML/SVG payload renamed to .png.
  const detected = await fileTypeFromFile(file.path);
  if (!detected || !ALLOWED_MIME_TYPES.includes(detected.mime) || detected.mime !== file.mimetype) {
    await unlink(file.path).catch(() => {});
    throw new BadRequestError('File content does not match declared type');
  }

  // THE BYTES ARE ALREADY ON DISK when this runs (multer wrote them), so every early return
  // below has to take that file with it. The hash is read from the same file, never from the
  // client's declared size. It is STORED and never queried on this route (see below): what reads
  // it back is the /bulk route, comparing the content held under an id the client chose.
  let contentHash;
  try {
    contentHash = hashImageContent(await readFile(file.path));
  } catch (err) {
    await unlink(file.path).catch(() => {});
    throw err;
  }

  // THE ATTEMPT KEY IS THE ONLY DEDUPLICATION OF THIS ROUTE, and the narrowing is a decision of
  // the owner (D7, 2026-09-13). The client mints the key before the first byte leaves, so the same
  // key means the same attempt no matter what the bytes look like; that is an identity of the
  // INTENTION, and it is the only one this route can act on.
  //
  // CONTENT IS NOT AN IDENTITY HERE, and this route used to treat it as one: without a key it gave
  // back the existing row of equal hash in the atlas. Two things follow from that which the owner
  // refused. Identical bytes sent under a NEW name came back carrying the OLD name, so the route
  // answered a question the caller did not ask; and two features ended up sharing one row, which
  // this module's PHYSICAL delete (DELETE_IMAGE) would turn into loss for whichever feature did
  // not ask for it. The price accepted instead is a duplicate: a keyless re-send of the same bytes
  // writes a second row and a second blob, which costs disk and nothing else.
  if (attemptKey) {
    const { rows: byKey } = await query(Q.FIND_IMAGE_BY_ATTEMPT_KEY, [atlasId, attemptKey]);
    if (byKey.length > 0) {
      await unlink(file.path).catch(() => {});
      return { image: toPublicImage(byKey[0]), reused: true };
    }
  }

  // multer already wrote the file to `file.path`; persist exactly that path.
  // Any failure from here on must take the blob with it: the file exists BEFORE
  // this handler runs, so an INSERT that throws (a constraint, a dead pool) would
  // otherwise leave bytes on disk that no row points at and nothing ever collects.
  // The /bulk path avoids the problem by writing the blob after the INSERT.
  let rows;
  try {
    ({ rows } = await query(Q.INSERT_IMAGE, [
      atlasId,
      file.originalname,
      file.mimetype,
      file.size,
      file.path,
      userId,
      contentHash,
      attemptKey,
    ]));
  } catch (err) {
    await unlink(file.path).catch(() => {});
    // TWO REQUESTS WITH THE SAME KEY CAN RACE, and the SELECT above cannot see a row that has not
    // committed yet. The partial unique index decides the race, and the loser reads the winner's
    // row instead of reporting an error for an upload that DID land.
    if (attemptKey && isUniqueViolation(err)) {
      const { rows: byKey } = await query(Q.FIND_IMAGE_BY_ATTEMPT_KEY, [atlasId, attemptKey]);
      if (byKey.length > 0) return { image: toPublicImage(byKey[0]), reused: true };
    }
    throw err;
  }

  return { image: toPublicImage(rows[0]), reused: false };
}

export async function getImageById(atlasId, imageId) {
  const { rows } = await query(Q.FIND_IMAGE_BY_ID, [imageId, atlasId]);

  if (rows.length === 0) {
    throw new NotFoundError('Image');
  }

  return rows[0];
}

/**
 * Resolves an image to an absolute file path + metadata for download.
 * Returns the path (not a stream) so the controller can use res.sendFile,
 * which handles ETag, conditional 304, Range/206 and caching.
 */
export async function getImageFile(atlasId, imageId) {
  const image = await getImageById(atlasId, imageId);

  const absolutePath = resolve(image.storage_path);
  try {
    await stat(absolutePath);
  } catch {
    throw new NotFoundError('Image file');
  }

  return {
    id: image.id,
    path: absolutePath,
    mimeType: image.mime_type,
    filename: image.filename,
  };
}

export async function deleteImage(atlasId, imageId) {
  const { rows } = await query(Q.DELETE_IMAGE, [imageId, atlasId]);

  if (rows.length === 0) {
    throw new NotFoundError('Image');
  }

  try {
    await unlink(rows[0].storage_path);
  } catch (err) {
    logger.warn({ path: rows[0].storage_path, error: err.message }, 'Failed to delete image file');
  }

  return true;
}

export async function listImages(atlasId) {
  const { rows } = await query(Q.LIST_IMAGES_BY_ATLAS, [atlasId]);
  return rows.map(toPublicImage);
}

/**
 * Uploads multiple images from base64 data.
 * Used for bulk import from offline/IndexedDB storage.
 * Returns a mapping of localId -> serverId for each image.
 */
export async function bulkUploadImages(atlasId, images, userId) {
  const results = {
    uploaded: [],
    failed: [],
    mapping: {},
  };

  const atlasDir = join(config.images.dir, atlasId);
  await mkdir(atlasDir, { recursive: true });

  const maxBytes = config.images.maxSizeMb * 1024 * 1024;

  // localIds already inserted in THIS batch. The first occurrence preserves the localId as the
  // server id (P11 ref validity); a duplicate localId within the same batch can't reuse the PK,
  // so it gets a fresh server id and the mapping collapses last-wins to the latest.
  const seenLocalIds = new Set();

  for (const image of images) {
    // Declared OUTSIDE the try so the catch can undo a committed INSERT (see below) and, for
    // `hashOfItem`, so the catch can ask whether a PK violation is this very item arriving twice.
    let insertedId = null;
    let claimedLocalId = false;
    let hashOfItem = null;

    try {
      if (!ALLOWED_MIME_TYPES.includes(image.mimeType)) {
        results.failed.push({
          localId: image.localId,
          error: `Invalid file type: ${image.mimeType}`,
        });
        continue;
      }

      // Decode base64 data (strip data URL prefix if present)
      let buffer;
      try {
        const base64Data = image.data.includes(',')
          ? image.data.split(',')[1]
          : image.data;
        buffer = Buffer.from(base64Data, 'base64');
      } catch {
        results.failed.push({
          localId: image.localId,
          error: 'Invalid base64 data',
        });
        continue;
      }

      if (buffer.length > maxBytes) {
        results.failed.push({
          localId: image.localId,
          error: `File too large: ${Math.round(buffer.length / 1024 / 1024)}MB (max: ${config.images.maxSizeMb}MB)`,
        });
        continue;
      }

      // Validate decoded content (magic bytes) against the declared mime type.
      const detected = await fileTypeFromBuffer(buffer);
      if (!detected || !ALLOWED_MIME_TYPES.includes(detected.mime) || detected.mime !== image.mimeType) {
        results.failed.push({
          localId: image.localId,
          error: 'Content does not match declared type',
        });
        continue;
      }

      const ext = EXT_BY_MIME[image.mimeType];
      const uniqueId = crypto.randomUUID();
      const storagePath = join(atlasDir, `${uniqueId}.${ext}`);
      hashOfItem = hashImageContent(buffer);

      // A RETRY OF THIS EXACT ITEM IS NOT A FAILURE, and calling it one was the defect. The bulk
      // route preserves `localId` as the primary key, so a retry whose first answer was lost hits
      // the PK and used to come back as `failed` for a blob the server already holds — the client
      // then either gave up on a picture that was there or rewrote a reference that was valid.
      //
      // The question that separates the two cases is the CONTENT, never the id: the same id with
      // the same bytes is the same upload arriving twice, while the same id with other bytes is a
      // collision that must stay refused, because accepting it would silently replace the blob a
      // feature elsewhere already points at.
      const existingUnderId = seenLocalIds.has(image.localId)
        ? null
        : (await query(Q.FIND_IMAGE_ANY_ATLAS, [image.localId])).rows[0] ?? null;
      if (existingUnderId) {
        if (existingUnderId.atlas_id !== atlasId) {
          results.failed.push({
            localId: image.localId,
            error: 'Este id de imagem já pertence a outro atlas.',
          });
          continue;
        }
        const storedHash = await resolveContentHash(existingUnderId);
        if (storedHash === hashOfItem) {
          seenLocalIds.add(image.localId);
          results.uploaded.push({
            localId: image.localId,
            serverId: existingUnderId.id,
            filename: existingUnderId.filename,
            size: existingUnderId.size_bytes,
            reused: true,
          });
          results.mapping[image.localId] = existingUnderId.id;
          continue;
        }
        results.failed.push({
          localId: image.localId,
          error: storedHash === null
            ? 'Este id de imagem já existe e o conteúdo dele não pôde ser conferido.'
            : 'Este id de imagem já existe com outro conteúdo.',
        });
        continue;
      }

      // First occurrence of this localId preserves it as the server id (so an image-feature's blob
      // ref — which equals its feature id — stays valid with no post-import rewrite). A duplicate
      // localId WITHIN the same batch can't reuse the PK, so it gets a fresh generated server id.
      let serverImage;
      if (seenLocalIds.has(image.localId)) {
        const { rows } = await query(Q.INSERT_IMAGE, [
          atlasId,
          image.filename,
          image.mimeType,
          buffer.length,
          storagePath,
          userId,
          hashOfItem,
          null,
        ]);
        serverImage = rows[0];
      } else {
        const { rows } = await query(Q.INSERT_IMAGE_WITH_ID, [
          image.localId,
          atlasId,
          image.filename,
          image.mimeType,
          buffer.length,
          storagePath,
          userId,
          hashOfItem,
        ]);
        serverImage = rows[0];
        seenLocalIds.add(image.localId);
        claimedLocalId = true;
      }
      insertedId = serverImage.id;

      // Write the blob AFTER the row inserts, so a failed INSERT (e.g. a cross-atlas global-PK
      // collision when re-saving the same local atlas) never leaves an orphan file on disk.
      // The row is COMMITTED at this point (`query()` is autocommit), so the reverse leak is
      // now the catch's job — see the compensating DELETE there.
      await writeFile(storagePath, buffer);

      results.uploaded.push({
        localId: image.localId,
        serverId: serverImage.id,
        filename: serverImage.filename,
        size: serverImage.size_bytes,
      });
      results.mapping[image.localId] = serverImage.id;

    } catch (err) {
      logger.warn({ err, atlasId, localId: image.localId }, 'Bulk image item failed');

      // COMPENSATE a committed row whose blob never made it to disk.
      //
      // Reaching here with `insertedId` set means the INSERT committed and
      // `writeFile` threw (ENOSPC, EACCES, a full disk). Without this DELETE the row
      // survives: `listImages` returns it and `GET /images/:id` answers a permanent
      // 404 'Image file' — the API publishing a state its OWN response called
      // `failed`. Compensation, not soft-delete: the row was never visible to any
      // client and the module hard-deletes images anyway (DELETE_IMAGE).
      //
      // Chosen over wrapping INSERT+writeFile in `tx()`, for two reasons.
      // (a) `tx()` holds a pooled connection across a multi-MB disk write for EVERY
      //     item — up to 50 per request — paying a hot-path cost on every success to
      //     fix a rare failure. This codebase has already been bitten by holding a
      //     connection while waiting (the `lock_timeout` argument in sync.service.js:
      //     retention under contention becomes pool exhaustion).
      // (b) `tx()` does not even make it atomic: the file is written BEFORE COMMIT,
      //     so a COMMIT failure leaves an orphan FILE — exactly the leak the current
      //     ordering was written to prevent. It swaps one leak for another.
      // The cost accepted here is a short window in which a concurrent GET can see
      // the phantom row, and the fact that a failing DELETE lands us back on today's
      // behaviour — no worse, and now logged.
      if (insertedId) {
        try {
          await query(Q.DELETE_IMAGE, [insertedId, atlasId]);
          // The localId no longer holds its PK, so a later duplicate in this same
          // batch must be allowed to claim it again (that is what `seenLocalIds`
          // means). Leaving it in would silently downgrade the retry to a fresh
          // server id and break the ref-validity guarantee of the WITH_ID path.
          if (claimedLocalId) seenLocalIds.delete(image.localId);
        } catch (cleanupErr) {
          logger.error(
            { err: cleanupErr, atlasId, imageId: insertedId },
            'Failed to remove orphan image row after blob write failure'
          );
        }
      }

      // THE SAME RETRY, ARRIVING AS A RACE instead of as a second request: the SELECT before the
      // INSERT cannot see a row that has not committed yet, so two concurrent batches carrying the
      // same item leave one of them here with the PK violation. It asks the same question that
      // branch asks — same id, same bytes? — so the loser of the race reports what the winner
      // wrote instead of calling a stored blob `failed`.
      if (!insertedId && isUniqueViolation(err)) {
        const { rows: colidida } = await query(Q.FIND_IMAGE_ANY_ATLAS, [image.localId]);
        const row = colidida[0];
        if (row && row.atlas_id === atlasId && await resolveContentHash(row) === hashOfItem) {
          seenLocalIds.add(image.localId);
          results.uploaded.push({
            localId: image.localId,
            serverId: row.id,
            filename: row.filename,
            size: row.size_bytes,
            reused: true,
          });
          results.mapping[image.localId] = row.id;
          continue;
        }
      }

      // NEVER `err.message`: for a pg error that is the driver's text (constraint
      // name, e.g. `images_pkey` on the global-PK collision) and for an fs error it
      // is the ABSOLUTE server path. This array ships inside a 201, so the
      // errorHandler — which refuses to forward exactly that text — never runs.
      results.failed.push({
        localId: image.localId,
        error: safeErrorMessage(err, 'Unknown error'),
      });
    }
  }

  return results;
}
