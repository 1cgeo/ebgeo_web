// Path: src/modules/resource-access/resource-access.queries.js
// SQL nomeado do módulo de acesso a recurso. O PREDICADO de acesso não mora aqui:
// ele mora nas três funções da migração 017, e estas consultas as CHAMAM. Uma
// definição só, que é a dívida que o schema `ng` já paga por não ter feito assim.

/**
 * Marca um recurso de CATÁLOGO como público ou privado.
 * O nome da tabela é INTERPOLADO pelo chamador a partir de `assertCatalogTableOf`,
 * nunca do request.
 *   $1 = accessLevel, $2 = id
 * @param {string} table - Já validado.
 * @returns {string}
 */
export const setCatalogAccessLevel = (table) => `
  UPDATE ${table} SET access_level = $1, updated_at = NOW()
   WHERE id = $2 AND active = true
   RETURNING id, name, access_level
`;

/** Idem para o 360, cuja chave é UUID. $1 = accessLevel, $2 = id. */
export const SET_360_ACCESS_LEVEL = `
  UPDATE sv360.projects SET access_level = $1, updated_at = NOW()
   WHERE id = $2::uuid
   RETURNING id::text AS id, name, access_level
`;

/** O nível de acesso de um recurso de catálogo (para o gate pontual). $1 = id. */
export const getCatalogAccessLevel = (table) => `
  SELECT id, access_level FROM ${table} WHERE id = $1 AND active = true
`;

/** Idem para o 360. $1 = id (uuid textual). */
export const GET_360_ACCESS_LEVEL = `
  SELECT id::text AS id, access_level FROM sv360.projects WHERE id = $1::uuid
`;

/** O predicado escalar, para checagem PONTUAL. $1..$5 como fn_can_see_resource. */
export const CAN_SEE_RESOURCE = `
  SELECT fn_can_see_resource($1::uuid, $2::uuid, $3::text, $4::text, $5::text) AS ok
`;

// --- o payload aditivo -----------------------------------------------------

/**
 * Os recursos PRIVADOS de um tipo de catálogo que este principal enxerga.
 *
 * Semi-join contra `fn_granted_resource_ids`, nunca `fn_can_see_resource` por
 * linha: uma consulta em vez de uma por linha (R8). O nome da tabela é
 * INTERPOLADO pelo chamador a partir de `assertCatalogTableOf`, nunca do request.
 *
 * `access_level = 'private'` não é otimização, é o contrato do endpoint: o que
 * ele devolve é o DELTA sobre o `/api/config` público, e o cliente SOMA. Trazer
 * o público aqui duplicaria cada item no baseline do cliente.
 *   $1 = userId (uuid|null), $2 = atlasId (uuid|null), $3 = resource type (text)
 * @param {string} table - Já validado por assertCatalogTableOf.
 * @returns {string}
 */
export const listVisiblePrivate = (table) => `
  SELECT t.id, t.name, t.description, t.config, t.sort_order
    FROM ${table} t
   WHERE t.active = true
     AND t.access_level = 'private'
     AND ( fn_has_global_data_access($1::uuid)
           OR t.id IN (SELECT resource_id FROM fn_granted_resource_ids($1::uuid, $2::uuid, $3::text)) )
   ORDER BY t.sort_order, t.name
`;

/**
 * Projetos 360 privados visíveis. Separado das três de catálogo porque
 * `sv360.projects` tem chave UUID, coluna `status` e `organization_id`, e nenhum
 * `active`/`sort_order`.
 *
 * O ramo da OM dona é preservado (D6): privacidade restringe quem está de FORA,
 * e `status = 'disabled'` continua sendo o eixo de ocultação, inclusive para quem
 * tem concessão.
 *   $1 = userId, $2 = atlasId, $3 = orgId do chamador
 */
export const LIST_VISIBLE_PRIVATE_360 = `
  SELECT id::text AS id, slug, name, center_lat, center_long, entry_photo_id,
         photo_count, status, capture_date
    FROM sv360.projects
   WHERE access_level = 'private'
     AND ( fn_has_global_data_access($1::uuid)
           OR organization_id = $3::uuid
           OR ( status = 'enabled'
                AND id::text IN (SELECT resource_id
                                   FROM fn_granted_resource_ids($1::uuid, $2::uuid, 'sv360_project')) ) )
   ORDER BY name
`;

// --- concessões ------------------------------------------------------------

/**
 * As concessões VIVAS de um recurso, com quem recebeu e quem concedeu (a tela
 * "quem tem acesso"). $1 = resource_type, $2 = resource_id
 */
export const LIST_GRANTS_FOR_RESOURCE = `
  SELECT g.id, g.resource_type, g.resource_id, g.grant_level, g.parent_grant_id, g.created_at,
         g.grantee_id, gu.username AS grantee_username, gu.nome AS grantee_nome,
         g.granted_by, bu.username AS granted_by_username, bu.nome AS granted_by_nome
    FROM resource_grants g
    JOIN users gu ON gu.id = g.grantee_id
    LEFT JOIN users bu ON bu.id = g.granted_by
   WHERE g.revoked_at IS NULL
     AND g.resource_type = $1 AND g.resource_id = $2
   ORDER BY g.created_at
`;

/**
 * A(s) concessão(ões) VIVA(S) de um ator sobre um recurso, do nível mais alto
 * para o mais baixo. É a fonte do `parent_grant_id` de uma concessão nova e do
 * gate `requireResourceShare`.
 *
 * D3: pode devolver mais de uma linha, de propósito — a estrutura é um DAG. O
 * chamador escolhe a de maior nível, e é isso que faz `view_share` em QUALQUER
 * concessão viva bastar para compartilhar adiante.
 *   $1 = grantee_id, $2 = resource_type, $3 = resource_id
 */
export const LIVE_GRANTS_OF_ACTOR = `
  SELECT id, grant_level
    FROM resource_grants
   WHERE revoked_at IS NULL
     AND grantee_id = $1::uuid AND resource_type = $2 AND resource_id = $3
   ORDER BY (grant_level = 'view_share') DESC, created_at
`;

/**
 * A concessão VIVA que ESTE ator já deu a ESTE beneficiário sobre este recurso.
 *
 * Existe para recusar a segunda concessão IDÊNTICA (mesmo concedente, mesmo
 * beneficiário) sem ferir D3: o que D3 protege é a concessão de OUTRO concedente,
 * que carrega informação (dois caminhos independentes de acesso, e revogar um não
 * derruba o outro). Duas linhas do MESMO concedente não carregam nada, e a
 * segunda só cria uma subárvore irmã que a revogação da primeira não alcança —
 * ou seja, um jeito silencioso de tornar a própria revogação incompleta.
 *   $1 = granted_by, $2 = grantee_id, $3 = resource_type, $4 = resource_id
 */
export const LIVE_GRANT_FROM_ACTOR_TO_GRANTEE = `
  SELECT id, grant_level FROM resource_grants
   WHERE revoked_at IS NULL
     AND granted_by = $1::uuid AND grantee_id = $2::uuid
     AND resource_type = $3 AND resource_id = $4
   LIMIT 1
`;

/** Um usuário ATIVO por id (o beneficiário precisa existir antes do INSERT). $1 = id. */
export const GET_ACTIVE_USER = `
  SELECT id, username, nome FROM users WHERE id = $1::uuid AND is_active = true
`;

/** Insere uma concessão. $1..$6 = tipo, recurso, beneficiário, nível, concedente, pai. */
export const INSERT_GRANT = `
  INSERT INTO resource_grants
    (resource_type, resource_id, grantee_id, grant_level, granted_by, parent_grant_id)
  VALUES ($1, $2, $3::uuid, $4, $5::uuid, $6::uuid)
  RETURNING id, resource_type, resource_id, grantee_id, grant_level, granted_by, parent_grant_id, created_at
`;

/** Uma concessão por id, viva ou não (para o gate de revogação). $1 = id. */
export const GET_GRANT = `
  SELECT id, resource_type, resource_id, grantee_id, grant_level, granted_by, parent_grant_id, revoked_at
    FROM resource_grants WHERE id = $1::uuid
`;

/**
 * Revoga a concessão $1 e TODA a subárvore que dela deriva, num statement.
 *
 * `revoked_at IS NULL` nos DOIS braços, e cada um por uma razão diferente: no
 * âncora ele torna a operação idempotente (revogar duas vezes não reescreve a
 * data, e a data da PRIMEIRA revogação é a que vale para auditoria); no braço
 * recursivo ele impede que a poda atravesse uma concessão JÁ revogada — sem ele,
 * um neto pendurado num filho revogado seria alcançado por uma poda que já não
 * deveria chegar até lá.
 *
 * O teto de profundidade é fail-safe contra ciclo. Hoje o ciclo é impossível por
 * construção (o pai é fixado no INSERT, só pode apontar para linha já existente,
 * e nenhuma rota expõe UPDATE de `parent_grant_id`), mas `UNION ALL` sem teto
 * transforma um ciclo introduzido por SQL manual em laço infinito, e a diferença
 * entre travar o banco e devolver resultado parcial é esta linha. NÃO troque para
 * `UNION` "por segurança": ele deduplica por linha inteira, não impede o ciclo,
 * só o disfarça — e como cada linha carrega `depth`, ele nem deduplicaria.
 *
 * O RETURNING é o produto, não um detalhe: a poda precisa devolver a lista dos
 * afetados para o serviço auditar uma linha por concessão derrubada. Um DELETE em
 * cascata devolveria só a raiz, e "por que Fulano perdeu acesso" ficaria sem
 * resposta.
 *   $1 = grant id, $2 = revoked_by
 */
export const REVOKE_GRANT_SUBTREE = `
WITH RECURSIVE subtree AS (
    SELECT g.id, 1 AS depth
      FROM resource_grants g
     WHERE g.id = $1::uuid AND g.revoked_at IS NULL
    UNION ALL
    SELECT c.id, s.depth + 1
      FROM resource_grants c
      JOIN subtree s ON c.parent_grant_id = s.id
     WHERE c.revoked_at IS NULL AND s.depth < 32
)
UPDATE resource_grants g
   SET revoked_at = NOW(), revoked_by = $2::uuid
  FROM subtree s
 WHERE g.id = s.id
RETURNING g.id, g.grantee_id, g.resource_type, g.resource_id, g.parent_grant_id
`;

// --- empréstimo por atlas --------------------------------------------------

/** O que este atlas empresta (vivos). $1 = atlas_id. */
export const LIST_ATLAS_RESOURCES = `
  SELECT ar.id, ar.resource_type, ar.resource_id, ar.added_by, ar.added_at,
         u.username AS added_by_username
    FROM atlas_resources ar
    LEFT JOIN users u ON u.id = ar.added_by
   WHERE ar.atlas_id = $1::uuid AND ar.removed_at IS NULL
   ORDER BY ar.resource_type, ar.added_at
`;

/**
 * Anexa um recurso ao atlas.
 *
 * `uq_atlas_resources_live` faz a segunda tentativa VIVA colidir; o
 * `ON CONFLICT DO NOTHING` a transforma num retorno vazio em vez de um 500, e o
 * chamador distingue os dois casos por ele. Repare que o índice é PARCIAL
 * (`WHERE removed_at IS NULL`), então reanexar depois de remover volta a passar —
 * sem isso um empréstimo removido ocuparia a vaga para sempre, que é o beco sem
 * saída de catalog-soft-delete-resurrect.
 *   $1 = atlas_id, $2 = type, $3 = resource_id, $4 = added_by
 */
export const ATTACH_ATLAS_RESOURCE = `
  INSERT INTO atlas_resources (atlas_id, resource_type, resource_id, added_by)
  VALUES ($1::uuid, $2, $3, $4::uuid)
  ON CONFLICT DO NOTHING
  RETURNING id, atlas_id, resource_type, resource_id, added_at
`;

/** Remove (soft) o empréstimo. $1 = atlas_id, $2 = type, $3 = resource_id, $4 = removed_by. */
export const DETACH_ATLAS_RESOURCE = `
  UPDATE atlas_resources
     SET removed_at = NOW(), removed_by = $4::uuid
   WHERE atlas_id = $1::uuid AND resource_type = $2 AND resource_id = $3 AND removed_at IS NULL
   RETURNING id, resource_type, resource_id
`;

// --- higiene ---------------------------------------------------------------

/**
 * Apaga concessões e empréstimos de um recurso (R6).
 *
 * Existe para o ÚNICO hard-delete do sistema, e aqui o DELETE é FÍSICO de
 * propósito: a linha alvo deixou de existir, então a concessão não referencia mais
 * nada e guardá-la só polui a tela "quem tem acesso" com um id que nenhuma
 * listagem devolve. Precisa rodar na transação de quem apaga, senão a concessão
 * sobrevive a um rollback.
 *   $1 = resource_type, $2 = resource_id
 */
export const PURGE_GRANTS_OF_RESOURCE = `
  DELETE FROM resource_grants WHERE resource_type = $1 AND resource_id = $2
`;
export const PURGE_ATLAS_LINKS_OF_RESOURCE = `
  DELETE FROM atlas_resources WHERE resource_type = $1 AND resource_id = $2
`;
