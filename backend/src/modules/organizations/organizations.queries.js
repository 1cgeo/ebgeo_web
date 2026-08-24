// Path: src/modules/organizations/organizations.queries.js

export const LIST_ORGANIZATIONS = `
  SELECT id, nome, slug, sigla, is_active, created_at, updated_at
  FROM organizations
  ORDER BY nome
`;

export const FIND_ORGANIZATION = `
  SELECT id, nome, slug, sigla, is_active, created_at, updated_at
  FROM organizations WHERE id = $1
`;

export const CHECK_SLUG = `SELECT id FROM organizations WHERE slug = $1`;

export const INSERT_ORGANIZATION = `
  INSERT INTO organizations (nome, slug, sigla)
  VALUES ($1, $2, $3)
  RETURNING id, nome, slug, sigla, is_active, created_at, updated_at
`;

// Nullable text columns use a "provided" FLAG (see UPDATE_USER_PROFILE, which solved
// this first and documents why: "COALESCE alone could never clear to NULL"). COALESCE
// collapses the two meanings of null — "field absent from the PATCH" and "clear this
// field" — into one, so the API accepted null (the Joi schemas say .allow(null, ''))
// and silently kept the old value, answering 200 with the un-cleared row. The client
// then confirms a deletion that never happened.
export const UPDATE_ORGANIZATION = `
  UPDATE organizations
  SET nome = COALESCE($2, nome),
      sigla = CASE WHEN $5 THEN $3 ELSE sigla END,
      is_active = COALESCE($4, is_active),
      updated_at = NOW()
  WHERE id = $1
  RETURNING id, nome, slug, sigla, is_active, created_at, updated_at
`;

export const DEACTIVATE_ORGANIZATION = `
  UPDATE organizations SET is_active = false, updated_at = NOW()
  WHERE id = $1 RETURNING id
`;

// AS TRÊS CONTAGENS QUE A CONFIRMAÇÃO DE DESATIVAÇÃO PRECISA, numa consulta só.
//
// Desativar uma OM não apaga nada e mesmo assim é a escrita de maior alcance do painel:
// `LIVE_AUTH_STATE` (`utils/org-status.js`) devolve `org_is_active: false` para TODA conta
// LOTADA nela, e o middleware `auth` estrito recusa a requisição ANTES de adotar o papel.
// Quem aperta o botão não vê nenhum desses efeitos; a tela precisa poder dizer o tamanho
// deles antes da pergunta.
//
// OS TRÊS NÚMEROS SÃO DE EIXOS DIFERENTES E NÃO SE SOMAM. `organization_id` é LOTAÇÃO (não
// autoriza nada, mas é ELA que a desativação bloqueia); `producer_org_id` é o escopo de
// PRODUÇÃO (é ele que `fn_can_produce_resource` consulta, e um produtor pode ter as duas
// colunas apontando para OMs diferentes); e o terceiro é o acervo que a OM MANTÉM, que
// sobrevive à desativação e simplesmente fica sem mantenedor vivo.
//
// `sv360.projects` entra pela coluna `organization_id`, não por `owner_org_id`: naquela
// tabela a OM produtora JÁ É `organization_id` (o projeto chega por bundle sob uma OM), e
// procurar `owner_org_id` ali devolve erro de coluna inexistente, não zero.
//
// AS CONTAGENS DE CONTA FILTRAM `is_active`, as de acervo não: conta inativa já não é
// bloqueada por nada (ela já está bloqueada), enquanto linha de catálogo desativada
// continua sendo acervo da OM.
//
// COUNT devolve bigint, e o driver entrega bigint como STRING. Quem consumir estes campos
// sem `Number()` compara texto com número e acerta por acidente até o primeiro `> 9`.
export const ORGANIZATION_DEACTIVATION_IMPACT = `
  SELECT
    (SELECT COUNT(*) FROM users WHERE organization_id = $1 AND is_active = true) AS active_members,
    (SELECT COUNT(*) FROM users WHERE producer_org_id = $1 AND is_active = true) AS active_producers,
      (SELECT COUNT(*) FROM basemaps        WHERE owner_org_id    = $1)
    + (SELECT COUNT(*) FROM data_layers     WHERE owner_org_id    = $1)
    + (SELECT COUNT(*) FROM analysis_layers WHERE owner_org_id    = $1)
    + (SELECT COUNT(*) FROM tilesets        WHERE owner_org_id    = $1)
    + (SELECT COUNT(*) FROM sv360.projects  WHERE organization_id = $1) AS catalog_items
`;
