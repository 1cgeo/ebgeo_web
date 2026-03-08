// Path: src/modules/briefings/briefings.queries.js
// Read-only queries. All write operations are managed via sync API.

export const FIND_BRIEFING_BY_ID = `
  SELECT * FROM briefings
  WHERE id = $1 AND atlas_id = $2 AND deleted_at IS NULL
`;

export const LIST_BRIEFINGS_BY_ATLAS = `
  SELECT * FROM briefings
  WHERE atlas_id = $1 AND deleted_at IS NULL
  ORDER BY created_at
`;

export const LIST_SLIDES_BY_BRIEFING = `
  SELECT * FROM slides
  WHERE briefing_id = $1 AND deleted_at IS NULL
  ORDER BY created_at
`;
