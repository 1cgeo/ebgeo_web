// Path: src/modules/images/images.queries.js

export const INSERT_IMAGE = `
  INSERT INTO images (atlas_id, filename, mime_type, size_bytes, storage_path, uploaded_by)
  VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING *
`;

// Bulk import preserves the client-provided id ($1) as the image id, so feature refs (an image
// feature's blob id IS its feature id) stay valid with no post-import rewrite. A collision on the
// global PK (e.g. re-saving the same local atlas) throws unique_violation, which the caller treats
// as a per-image failure (the feature still imports; only that blob is skipped server-side).
export const INSERT_IMAGE_WITH_ID = `
  INSERT INTO images (id, atlas_id, filename, mime_type, size_bytes, storage_path, uploaded_by)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING *
`;

export const FIND_IMAGE_BY_ID = `
  SELECT * FROM images WHERE id = $1 AND atlas_id = $2
`;

export const DELETE_IMAGE = `
  DELETE FROM images WHERE id = $1 AND atlas_id = $2 RETURNING storage_path
`;

export const LIST_IMAGES_BY_ATLAS = `
  SELECT * FROM images WHERE atlas_id = $1 ORDER BY created_at DESC
`;
