// Path: src/modules/images/images.queries.js

// `content_hash` and `attempt_key` were added by 013_imagens_idempotentes.sql. Both are OPTIONAL
// on write (the bulk route and the atlas clone store NULL for the attempt key): the partial index
// `uq_images_atlas_attempt_key` is what forbids two rows with the SAME key in one atlas while
// still allowing many NULLs.
export const INSERT_IMAGE = `
  INSERT INTO images (atlas_id, filename, mime_type, size_bytes, storage_path, uploaded_by,
                      content_hash, attempt_key)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  RETURNING *
`;

// Bulk import preserves the client-provided id ($1) as the image id, so feature refs (an image
// feature's blob id IS its feature id) stay valid with no post-import rewrite. A collision on the
// global PK (e.g. a retry whose response was lost) throws unique_violation; the caller then asks
// FIND_IMAGE_ANY_ATLAS whether the row that holds the id carries the SAME content, which is what
// separates a retry (accepted, same id) from a different blob under a taken id (refused).
export const INSERT_IMAGE_WITH_ID = `
  INSERT INTO images (id, atlas_id, filename, mime_type, size_bytes, storage_path, uploaded_by,
                      content_hash)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  RETURNING *
`;

export const FIND_IMAGE_BY_ID = `
  SELECT * FROM images WHERE id = $1 AND atlas_id = $2
`;

// WITHOUT the atlas filter, on purpose: the PK of `images` is global, so a collision may come from
// another atlas, and only a query that can SEE that row can tell the caller so.
export const FIND_IMAGE_ANY_ATLAS = `
  SELECT * FROM images WHERE id = $1
`;

export const FIND_IMAGE_BY_ATTEMPT_KEY = `
  SELECT * FROM images WHERE atlas_id = $1 AND attempt_key = $2
`;

// Oldest first: with two rows of identical content the stable answer is the one that has been
// referenced longest, so a retry never migrates a reference from under an existing feature.
export const FIND_IMAGE_BY_CONTENT_HASH = `
  SELECT * FROM images
  WHERE atlas_id = $1 AND content_hash = $2
  ORDER BY created_at ASC, id ASC
  LIMIT 1
`;

// Adopts a hash for a row written before 013_imagens_idempotentes.sql (or by the atlas clone,
// which copies bytes and not the hash). Only ever fills a NULL: overwriting a stored hash would
// let a later read of the wrong file rewrite the identity of a row.
export const ADOPT_CONTENT_HASH = `
  UPDATE images SET content_hash = $3
  WHERE id = $1 AND atlas_id = $2 AND content_hash IS NULL
  RETURNING content_hash
`;

export const DELETE_IMAGE = `
  DELETE FROM images WHERE id = $1 AND atlas_id = $2 RETURNING storage_path
`;

export const LIST_IMAGES_BY_ATLAS = `
  SELECT * FROM images WHERE atlas_id = $1 ORDER BY created_at DESC
`;
