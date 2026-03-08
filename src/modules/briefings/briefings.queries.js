// Path: src/modules/briefings/briefings.queries.js

export const INSERT_BRIEFING = `
  INSERT INTO briefings (atlas_id, name, description, settings)
  VALUES ($1, $2, $3, $4::jsonb)
  RETURNING *
`;

export const FIND_BRIEFING_BY_ID = `
  SELECT * FROM briefings
  WHERE id = $1 AND atlas_id = $2 AND deleted_at IS NULL
`;

export const LIST_BRIEFINGS_BY_ATLAS = `
  SELECT * FROM briefings
  WHERE atlas_id = $1 AND deleted_at IS NULL
  ORDER BY created_at
`;

export const UPDATE_BRIEFING = `
  UPDATE briefings
  SET name = COALESCE($3, name),
      description = COALESCE($4, description),
      settings = COALESCE($5, settings),
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND atlas_id = $2 AND deleted_at IS NULL
  RETURNING *
`;

export const SOFT_DELETE_BRIEFING = `
  UPDATE briefings
  SET deleted_at = NOW(),
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND atlas_id = $2 AND deleted_at IS NULL
  RETURNING id
`;

export const INSERT_SLIDE = `
  INSERT INTO slides (briefing_id, title, content, mode, map_id, model_id, photo_id, position, orientation)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
  RETURNING *
`;

export const LIST_SLIDES_BY_BRIEFING = `
  SELECT * FROM slides
  WHERE briefing_id = $1 AND deleted_at IS NULL
  ORDER BY created_at
`;

export const UPDATE_SLIDE = `
  UPDATE slides
  SET title = COALESCE($3, title),
      content = COALESCE($4, content),
      mode = COALESCE($5, mode),
      map_id = COALESCE($6, map_id),
      model_id = COALESCE($7, model_id),
      photo_id = COALESCE($8, photo_id),
      position = COALESCE($9, position),
      orientation = COALESCE($10, orientation),
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND briefing_id = $2 AND deleted_at IS NULL
  RETURNING *
`;

export const SOFT_DELETE_SLIDE = `
  UPDATE slides
  SET deleted_at = NOW(),
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND briefing_id = $2 AND deleted_at IS NULL
  RETURNING id
`;

export const UPDATE_SLIDE_ORDER = `
  UPDATE briefings
  SET slide_order = $2,
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND deleted_at IS NULL
  RETURNING *
`;

export const ADD_SLIDE_TO_ORDER = `
  UPDATE briefings
  SET slide_order = array_append(slide_order, $2::uuid),
      updated_at = NOW()
  WHERE id = $1
`;

export const REMOVE_SLIDE_FROM_ORDER = `
  UPDATE briefings
  SET slide_order = array_remove(slide_order, $2::uuid),
      updated_at = NOW()
  WHERE id = $1
`;
