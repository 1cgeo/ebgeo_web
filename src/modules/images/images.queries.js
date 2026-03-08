// Path: src/modules/images/images.queries.js

export const INSERT_IMAGE = `
  INSERT INTO images (atlas_id, filename, mime_type, size_bytes, storage_path, uploaded_by)
  VALUES ($1, $2, $3, $4, $5, $6)
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
