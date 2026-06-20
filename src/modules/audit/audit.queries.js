// Path: src/modules/audit/audit.queries.js

export const INSERT_AUDIT = `
  INSERT INTO audit_trail
    (action, actor_id, target_type, target_id, target_name, details, ip, user_agent)
  VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
`;

// Admin query with optional filters + pagination.
export const LIST_AUDIT = `
  SELECT id, action, actor_id, target_type, target_id, target_name, details, ip, user_agent, created_at
  FROM audit_trail
  WHERE ($1::text IS NULL OR action = $1)
    AND ($2::uuid IS NULL OR actor_id = $2)
    AND ($3::text IS NULL OR target_type = $3)
  ORDER BY created_at DESC
  LIMIT $4 OFFSET $5
`;

export const COUNT_AUDIT = `
  SELECT COUNT(*)::int AS total
  FROM audit_trail
  WHERE ($1::text IS NULL OR action = $1)
    AND ($2::uuid IS NULL OR actor_id = $2)
    AND ($3::text IS NULL OR target_type = $3)
`;
