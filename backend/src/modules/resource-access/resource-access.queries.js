// Path: src/modules/resource-access/resource-access.queries.js
// SQL nomeado do módulo de acesso a recurso. O PREDICADO de acesso não mora aqui:
// ele mora nas funções SQL de `008_acesso_a_recurso.sql`, e estas consultas as CHAMAM. Uma
// definição só, que é a dívida que o schema `ng` já paga por não ter feito assim.
// O do 360 é composto e vem de `sv360.queries.js` pelo mesmo motivo.
import { sv360AccessPredicate } from '../streetview360/sv360.queries.js';
import { catalogAuthorizationPredicate } from '../catalog/catalog.queries.js';

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
 * The PRIVATE resources of one catalog type that this principal can see.
 *
 * Semi-join against `fn_granted_resource_ids`, never `fn_can_see_resource` per row: one
 * query instead of one per row (R8). The table name is INTERPOLATED by the caller from
 * `assertCatalogTableOf`, never from the request.
 *
 * THE THREE AUTHORISATION ARMS come from `catalogAuthorizationPredicate`
 * (`catalog/catalog.queries.js`) since F11, and are no longer written here: the same
 * composition already existed in `catalog.service.js` and was about to get a third copy in
 * the snapshot rehydration. What THIS query still decides is the absence of the `public`
 * term, right below.
 *
 * `access_level = 'private'` is not an optimisation, it is the endpoint's contract: what it
 * returns is the DELTA over the public `/api/config`, and the client ADDS it. Bringing the
 * public rows in here would duplicate every item in the client's baseline.
 *
 * THE PRODUCTION ARM BELONGS HERE FOR THE SAME REASON IT BELONGS IN `catalog.service.js`, and
 * its absence was an inconsistency between two READ paths over the same data: a producer saw
 * their own private layer in `GET /api/v1/analysis-layers` (which already had the arm) and did
 * NOT see it here — so it existed in the panel that edits it and was missing from the additive
 * payload the map boots with, with no error anywhere. It is the exact mirror of what the
 * comment on `LIST_VISIBLE_PRIVATE_360` (just below) describes as already fixed for the 360.
 *
 * `$3` FEEDS BOTH PREDICATES on purpose: for the FOUR catalog tables the vocabulary of
 * `resource_grants.resource_type` and that of `fn_can_produce_resource` coincide word for word
 * (`basemap`, `tileset`, `data_layer`, `analysis_layer`). Should they ever diverge, this
 * parameter has to split in two — and the coincidence is written here so the divergence does
 * not go unnoticed. It is not guaranteed by construction: they are two maps in different files
 * (`PRODUCTION_TYPE_BY_TABLE` and `TYPE_BY_TABLE`), and `catalog-tabelas-paridade.test.js` is
 * what compares them.
 *   $1 = userId (uuid|null), $2 = atlasId (uuid|null), $3 = resource type (text)
 * @param {string} table - Already validated by assertCatalogTableOf.
 * @returns {string}
 */
export const listVisiblePrivate = (table) => `
  SELECT t.id, t.name, t.description, t.config, t.sort_order
    FROM ${table} t
   WHERE t.active = true
     AND t.access_level = 'private'
     AND ${catalogAuthorizationPredicate({
    alias: 't',
    userParam: '$1::uuid',
    produceTypeExpr: '$3::text',
    atlasParam: '$2::uuid',
    grantTypeExpr: '$3::text',
  })}
   ORDER BY t.sort_order, t.name
`;

/**
 * Projetos 360 privados visíveis. Separado das quatro de catálogo porque
 * `sv360.projects` tem chave UUID, coluna `status` e `organization_id`, e nenhum
 * `active`/`sort_order`.
 *
 * O PREDICADO É O MESMO DO MÓDULO 360, importado e não copiado. Enquanto ele morava
 * aqui escrito à mão, corrigir um lado e esquecer o outro dava um produtor que via o
 * projeto em `/sv360/projects` e não via em `/resource-access/visible`, com as duas
 * suítes verdes. O ramo da OM dona virou o de PRODUÇÃO (a OM deixou de ser
 * auto-declarada), e `status = 'disabled'` continua sendo o eixo de ocultação,
 * inclusive para quem tem concessão.
 *   $1 = userId, $2 = atlasId
 */
export const LIST_VISIBLE_PRIVATE_360 = `
  SELECT id::text AS id, slug, name, center_lat, center_long, entry_photo_id,
         photo_count, status, capture_date
    FROM sv360.projects
   WHERE access_level = 'private'
     AND ${sv360AccessPredicate(1, 2)}
   ORDER BY name
`;

/**
 * Os recursos que ESTE ator pode repassar adiante: aqueles em que ele tem uma
 * concessão VIVA de nível `view_share`.
 *
 * Existe para a INTERFACE, e é a razão de ele viajar no payload aditivo em vez de
 * ser perguntado por recurso. O cartão do catálogo precisa decidir se mostra a
 * ação "Compartilhar" ANTES de qualquer clique, e as duas alternativas eram
 * piores: uma chamada por cartão (dezenas de requisições ao abrir o catálogo), ou
 * oferecer o botão a todo mundo e deixar o 403 explicar depois — que é oferecer um
 * formulário que responde 403, exatamente o que o modal de configuração do atlas
 * já recusa fazer por escrito.
 *
 * NÃO cobre o papel global: quem é administrador ou credenciado concede de RAIZ, sem
 * concessão nenhuma, e o cliente já sabe disso por `hasGlobalDataAccess()`. Somar
 * o papel aqui seria uma segunda definição da mesma regra.
 *   $1 = grantee_id
 */
// O BRAÇO DE GRUPO ENTROU AQUI JUNTO COM O DE `LIVE_GRANTS_OF_ACTOR`, e os dois
// precisam concordar: esta consulta decide se a interface OFERECE o botão
// "Compartilhar", e aquela decide se o servidor ACEITA a escrita. Enquanto só a
// segunda conhecesse grupo, quem recebeu `view_share` através de um grupo teria
// permissão de repassar e nenhum botão para isso — uma capacidade sem porta, que na
// tela é indistinguível de não ter a permissão.
export const LIST_SHAREABLE_OF_ACTOR = `
  SELECT DISTINCT resource_type, resource_id
    FROM resource_grants
   WHERE revoked_at IS NULL
     AND expires_at > NOW()
     AND grant_level = 'view_share'
     AND ( grantee_id = $1::uuid
        OR grantee_group_id IN (SELECT group_id FROM fn_user_group_ids($1::uuid)) )
`;

// --- concessões ------------------------------------------------------------

/**
 * As concessões VIVAS de um recurso, com quem recebeu e quem concedeu (a tela
 * "quem tem acesso"). $1 = resource_type, $2 = resource_id
 *
 * AS DUAS JUNÇÕES DE BENEFICIÁRIO SÃO `LEFT`, E A DE USUÁRIO PRECISOU MUDAR. Ela era
 * `JOIN users gu ON gu.id = g.grantee_id`, um INNER, e numa concessão a grupo o
 * `grantee_id` é NULL por CHECK: a linha inteira sumia da resposta. O sintoma seria o
 * pior possível para uma tela de permissão — conceder a um grupo devolveria 201, e a
 * lista "quem tem acesso" continuaria sem mostrar ninguém, sem erro em lugar nenhum.
 *
 * O GRUPO APAGADO SAI DA LISTA, e é por isso que o filtro está no WHERE e não só na
 * junção. `fn_user_group_ids` exige `deleted_at IS NULL`, então a concessão a um grupo
 * apagado não entrega acesso a ninguém; mantê-la aqui faria a tela chamada "quem tem
 * acesso" listar quem não tem. Não há o que fazer com a linha de qualquer forma: ela
 * já não concede, e revogá-la não mudaria nada.
 */
export const LIST_GRANTS_FOR_RESOURCE = `
  SELECT g.id, g.resource_type, g.resource_id, g.grant_level, g.parent_grant_id, g.created_at,
         g.expires_at,
         g.grantee_id, gu.username AS grantee_username, gu.nome AS grantee_nome,
         g.grantee_group_id, gg.name AS grantee_group_name,
         (SELECT COUNT(*) FROM access_group_members m WHERE m.group_id = g.grantee_group_id)::int
           AS grantee_group_member_count,
         g.granted_by, bu.username AS granted_by_username, bu.nome AS granted_by_nome
    FROM resource_grants g
    LEFT JOIN users gu ON gu.id = g.grantee_id
    LEFT JOIN access_groups gg ON gg.id = g.grantee_group_id
    LEFT JOIN users bu ON bu.id = g.granted_by
   WHERE g.revoked_at IS NULL
     AND g.expires_at > NOW()
     AND g.resource_type = $1 AND g.resource_id = $2
     AND (g.grantee_group_id IS NULL OR gg.deleted_at IS NULL)
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
 *
 * "VIVA" PASSOU A INCLUIR O PRAZO. Sem `expires_at > NOW()` aqui, quem já não VÊ o
 * recurso (o predicado de leitura mora em `fn_granted_resource_ids`, que conhece o
 * prazo) continuaria podendo REPASSÁ-LO: o gate `requireResourceShare` se alimenta
 * desta consulta, e a concessão nova nasceria pendurada num pai morto.
 *
 * `expires_at` viaja no SELECT porque o INSERT do filho o usa como TETO.
 *
 * O BRAÇO DE GRUPO ENTROU EM 2026-08-19, e sem ele a concessão a grupo seria de
 * segunda classe: quem recebe `view_share` ATRAVÉS de um grupo veria o recurso (o
 * predicado de leitura, `fn_granted_resource_ids`, sempre teve o braço de grupo) e
 * não conseguiria repassá-lo, porque o gate `requireResourceShare` se alimenta desta
 * consulta e ela só olhava `grantee_id`. Os dois níveis significariam a mesma coisa
 * para o membro de grupo, que é justamente a distinção que a fase F3 existe para
 * manter.
 *
 * `fn_user_group_ids` já exige grupo VIVO (`deleted_at IS NULL`), então apagar o
 * grupo tira o repasse na mesma leitura em que tira a visão — não há aqui uma segunda
 * cópia da regra de "grupo apagado não concede".
 *
 * `grantee_group_id` viaja no SELECT porque o serviço precisa dele para recusar o
 * caso degenerado: conceder AO MESMO grupo de onde a própria autoridade veio.
 *   $1 = grantee_id (o ator), $2 = resource_type, $3 = resource_id
 */
export const LIVE_GRANTS_OF_ACTOR = `
  SELECT id, grant_level, expires_at, grantee_id, grantee_group_id
    FROM resource_grants
   WHERE revoked_at IS NULL
     AND expires_at > NOW()
     AND resource_type = $2 AND resource_id = $3
     AND ( grantee_id = $1::uuid
        OR grantee_group_id IN (SELECT group_id FROM fn_user_group_ids($1::uuid)) )
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
 *
 * O PRAZO ENTRA AQUI PARA QUE A RENOVAÇÃO SEJA POSSÍVEL. Uma concessão EXPIRADA
 * continua com `revoked_at IS NULL`, então sem `expires_at > NOW()` o concedente
 * levaria 409 "já recebeu acesso de você" sobre um acesso que não existe mais — um
 * beco sem saída da mesma classe do id de catálogo soft-deletado.
 *   $1 = granted_by, $2 = grantee_id, $3 = resource_type, $4 = resource_id
 */
export const LIVE_GRANT_FROM_ACTOR_TO_GRANTEE = `
  SELECT id, grant_level FROM resource_grants
   WHERE revoked_at IS NULL
     AND expires_at > NOW()
     AND granted_by = $1::uuid AND grantee_id = $2::uuid
     AND resource_type = $3 AND resource_id = $4
   LIMIT 1
`;

/**
 * O IRMÃO DE GRUPO da consulta acima, e ele precisa ser uma consulta SEPARADA em vez
 * de um `COALESCE` sobre as duas colunas: `grantee_id` e `grantee_group_id` são
 * ALTERNATIVOS por CHECK, então numa linha de grupo o `grantee_id` é NULL, e
 * `grantee_id = $2` com $2 nulo é NULL — nunca verdadeiro. Uma consulta única
 * parametrizada pelos dois devolveria zero linha sempre, e o efeito seria a duplicata
 * passar: o 409 sumiria em silêncio, que é o pior formato deste defeito.
 *   $1 = granted_by, $2 = grantee_group_id, $3 = resource_type, $4 = resource_id
 */
export const LIVE_GRANT_FROM_ACTOR_TO_GROUP = `
  SELECT id, grant_level FROM resource_grants
   WHERE revoked_at IS NULL
     AND expires_at > NOW()
     AND granted_by = $1::uuid AND grantee_group_id = $2::uuid
     AND resource_type = $3 AND resource_id = $4
   LIMIT 1
`;

/** Um usuário ATIVO por id (o beneficiário precisa existir antes do INSERT). $1 = id. */
export const GET_ACTIVE_USER = `
  SELECT id, username, nome FROM users WHERE id = $1::uuid AND is_active = true
`;

/**
 * Um grupo VIVO por id (o beneficiário-coletivo precisa existir antes do INSERT).
 *
 * `deleted_at IS NULL` e não só o id: a FK aceitaria um grupo apagado, e a concessão
 * nasceria morta — `fn_user_group_ids` exige grupo vivo, então ela não devolveria
 * linha para ninguém e a tela mostraria um acesso concedido que não existe.
 *   $1 = id
 */
export const GET_LIVE_GROUP = `
  SELECT id, name FROM access_groups WHERE id = $1::uuid AND deleted_at IS NULL
`;

/**
 * Insere uma concessão.
 *
 * O PRAZO É CALCULADO AQUI, NO MESMO STATEMENT DA ESCRITA, e não no JS. Três tetos
 * incidem sobre ele e o `LEAST` os aplica todos de uma vez:
 *   - o pedido do concedente (`$7`), ou um ano quando ele não pediu nada;
 *   - o TETO DA CASA (um ano), que o CHECK da tabela também cobra — calculá-lo com
 *     o `NOW()` do banco é o que impede um relógio de cliente adiantado de virar
 *     23514 (`Value violates a constraint`) em vez de uma data válida;
 *   - o prazo do PAI (`$8`, nulo na concessão de raiz), porque filho nunca pode
 *     sobreviver a quem o autorizou. `'infinity'` é o neutro do LEAST para a raiz.
 * `GREATEST` não aparece: o piso (`expires_at > created_at`) é cobrado na borda.
 *
 * O BENEFICIÁRIO SÃO DOIS PARÂMETROS E EXATAMENTE UM DELES É NÃO-NULO, o que o
 * `CHECK (num_nonnulls(grantee_id, grantee_group_id) = 1)` cobra. A borda (o `xor` do
 * Joi) recusa antes, para que o pedido malformado volte como 422 com nome de campo em
 * vez do 23514 genérico em que o CHECK se traduz — mas o CHECK continua sendo quem
 * garante, porque INSERT cru existe (os testes de função escrevem direto na tabela).
 *   $1..$4 = tipo, recurso, beneficiário-pessoa, nível
 *   $5, $6 = concedente, pai
 *   $7 = prazo pedido (timestamptz|null), $8 = prazo do pai (timestamptz|null)
 *   $9 = beneficiário-grupo
 */
export const INSERT_GRANT = `
  INSERT INTO resource_grants
    (resource_type, resource_id, grantee_id, grant_level, granted_by, parent_grant_id, expires_at,
     grantee_group_id)
  VALUES ($1, $2, $3::uuid, $4, $5::uuid, $6::uuid,
          LEAST(
            COALESCE($7::timestamptz, NOW() + INTERVAL '1 year'),
            NOW() + INTERVAL '1 year',
            COALESCE($8::timestamptz, 'infinity'::timestamptz)
          ),
          $9::uuid)
  RETURNING id, resource_type, resource_id, grantee_id, grantee_group_id, grant_level, granted_by,
            parent_grant_id, created_at, expires_at
`;

/** Uma concessão por id, viva ou não (para o gate de revogação). $1 = id. */
export const GET_GRANT = `
  SELECT id, resource_type, resource_id, grantee_id, grantee_group_id, grant_level, granted_by,
         parent_grant_id, revoked_at
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
RETURNING g.id, g.grantee_id, g.grantee_group_id, g.resource_type, g.resource_id, g.parent_grant_id
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
 * QUEM EMPRESTA ESTE RECURSO AGORA — o endereço das salas que uma revogação pode
 * ter esvaziado.
 *
 * Não é uma consulta de acesso e não decide conteúdo: devolve só ids de sala, e o
 * frame que sai delas não carrega recurso nenhum. Os dois filtros de vivacidade são
 * o que a torna endereço e não histórico: o empréstimo desfeito (`removed_at`) e o
 * atlas na lixeira (`deleted_at`) já não emprestam nada, e acordar as salas deles
 * seria avisar sobre um vínculo que não existe.
 *   $1 = tipo, $2 = id do recurso
 */
export const ATLASES_LENDING_RESOURCE = `
  SELECT DISTINCT ar.atlas_id
    FROM atlas_resources ar
    JOIN atlas a ON a.id = ar.atlas_id AND a.deleted_at IS NULL
   WHERE ar.removed_at IS NULL
     AND ar.resource_type = $1
     AND ar.resource_id = $2
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
// AS DUAS PURGAS TÊM `RETURNING`, e não é conveniência: é o ÚNICO instante em que
// estas linhas ainda existem. Elas são hard-delete (o resto do sistema é soft), então
// depois do COMMIT não há de onde reconstruir quem tinha acesso ao recurso que
// sumiu. Sem o RETURNING, `PERMISSION_PURGE` seria uma linha dizendo "apaguei
// alguma coisa".
//
// O RETURNING traz TAMBÉM as linhas já mortas (`revoked_at`/`removed_at` não nulos):
// o DELETE não filtra, e a trilha precisa contar o que de fato saiu da tabela, não o
// que estava vivo. O estado de cada uma viaja no detalhe.
export const PURGE_GRANTS_OF_RESOURCE = `
  DELETE FROM resource_grants WHERE resource_type = $1 AND resource_id = $2
  RETURNING id, grantee_id, grantee_group_id, granted_by, grant_level, parent_grant_id, revoked_at, expires_at
`;
export const PURGE_ATLAS_LINKS_OF_RESOURCE = `
  DELETE FROM atlas_resources WHERE resource_type = $1 AND resource_id = $2
  RETURNING id, atlas_id, added_by, removed_at
`;
