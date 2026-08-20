// Path: src/modules/audit/audit.queries.js

export const INSERT_AUDIT = `
  INSERT INTO audit_trail
    (action, actor_id, target_type, target_id, target_name, details, ip, user_agent)
  VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
`;

// Admin query with optional filters + pagination.
//
// O FILTRO POR `target_id` ($4) É O PAGAMENTO DE `audit_trail.target_id` SER TEXT
// (`002_auditoria.sql`), e sem ele a coluna larga seria só uma coluna que ninguém
// consegue interrogar. Enquanto ela foi UUID, metade dos alvos (o slug de catálogo, a
// chave `app_config`) nem cabia nela, então "tudo que já foi feito com o tileset X" não
// era uma pergunta formulável; agora é, e ela entra pelo mesmo `idx_audit_target`
// que o par (target_type, target_id) já indexava.
export const LIST_AUDIT = `
  SELECT id, action, actor_id, target_type, target_id, target_name, details, ip, user_agent, created_at
  FROM audit_trail
  WHERE ($1::text IS NULL OR action = $1)
    AND ($2::uuid IS NULL OR actor_id = $2)
    AND ($3::text IS NULL OR target_type = $3)
    AND ($4::text IS NULL OR target_id = $4)
  ORDER BY created_at DESC
  LIMIT $5 OFFSET $6
`;

export const COUNT_AUDIT = `
  SELECT COUNT(*)::int AS total
  FROM audit_trail
  WHERE ($1::text IS NULL OR action = $1)
    AND ($2::uuid IS NULL OR actor_id = $2)
    AND ($3::text IS NULL OR target_type = $3)
    AND ($4::text IS NULL OR target_id = $4)
`;
