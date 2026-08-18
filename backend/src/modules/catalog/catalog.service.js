// Path: src/modules/catalog/catalog.service.js
// Generic CRUD over the per-type catalog tables (basemaps / data_layers / analysis_layers /
// tilesets). The `table` arg is whitelisted (assertTable) before interpolation.
//
// Every write here drops the memoized GET /api/config payload (config.cache.js). All four
// tables feed that payload, so the invalidation is never wasted. It used to cover a fifth,
// `streetview_markers`, which fed nothing and was invalidated anyway; that table was dropped
// in migration 021 for having had no consumer at all.
import { query, oneOrNone, one } from '../../database/index.js';
import { NotFoundError, ConflictError, BadRequestError } from '../../utils/errors.js';
import { validateMapLibreStyle } from '../../utils/maplibre-style-validate.js';
import { invalidateAppConfigCache } from '../config/config.cache.js';
import { assertTable, assertProductionTypeOf } from './catalog.tables.js';
import { catalogAuthorizationPredicate } from './catalog.queries.js';

const COLS = 'id, name, description, config, active, sort_order, created_at, updated_at';

// `access_level` fica FORA de COLS de propósito, numa segunda constante. A string
// COLS é amarrada ao schema por `catalog-tabelas-paridade.test.js`, que afirma
// literalmente que ela lista OITO colunas; esticá-la reprova aquele teste, e
// afrouxar o teste custaria a guarda que ele dá. Quem precisa do nível de acesso
// pede por aqui.
// `owner_org_id` viaja junto pela mesma porta, e não por simetria: sem ele o painel não
// tem como dizer de QUEM é cada linha, e um produtor não distingue o que mantém do que
// só enxerga. Ler é seguro (a OM dona não é segredo de ninguém que já vê a linha) e
// ESCREVER continua impossível por aqui: nenhuma das três escritas lê a coluna do corpo.
const COLS_COM_ACESSO = `${COLS}, access_level, owner_org_id`;

/**
 * O predicado de visibilidade de recurso, na forma de fragmento de WHERE.
 *
 * FECHA POR PADRÃO, e essa é a propriedade que importa: sem principal, só o
 * público. A lista de chamadores de `listCatalog` cresce, e o esquecimento
 * provável é "não passei o principal" — que aqui degrada para MENOS dado, nunca
 * para vazamento. O contrário (default aberto, filtro opcional) é a forma que
 * transforma um esquecimento em incidente.
 *
 * Semi-join (`IN (SELECT ...)`), nunca `fn_can_see_resource` por linha: é uma
 * consulta em vez de uma por linha (R8). A COMPOSIÇÃO dos três braços saiu daqui
 * para `catalog.queries.js` quando a reidratação do snapshot (F11) precisou dela:
 * o que esta função ainda decide é o termo `public` e a NUMERAÇÃO dos parâmetros.
 *
 * O RAMO DE PRODUÇÃO ENTRA AQUI, e não é simetria estética: sem ele o produtor
 * levava 404 no GET da própria camada privada e sucesso no PUT, que é a mesma linha
 * existindo para a escrita e não existindo para a leitura. Desde a migração 021 as
 * QUATRO tabelas de catálogo têm os DOIS ramos: `basemaps` ganhou tipo de concessão
 * e deixou de chegar aqui com `resourceType` nulo. O `??` do chamador continua
 * existindo porque `visibleTo` é montado a partir de um mapa, e um mapa que perde
 * uma entrada precisa degradar para menos dado, nunca para vazamento.
 *
 * @param {{userId: string|null, atlasId: string|null, resourceType: string|null}|null} visibleTo
 * @param {number} base - Índice do último parâmetro já usado.
 * @param {string} tipoProducao - O tipo desta tabela no eixo de produção.
 * @returns {{sql: string, params: Array}}
 */
function accessPredicate(visibleTo, base, tipoProducao) {
  if (!visibleTo) return { sql: `AND t.access_level = 'public'`, params: [] };
  const params = [visibleTo.userId ?? null, tipoProducao];
  const comConcessao = Boolean(visibleTo.resourceType);
  if (comConcessao) params.push(visibleTo.atlasId ?? null, visibleTo.resourceType);
  const autorizacao = catalogAuthorizationPredicate({
    alias: 't',
    userParam: `$${base + 1}::uuid`,
    produceTypeExpr: `$${base + 2}::text`,
    atlasParam: comConcessao ? `$${base + 3}::uuid` : null,
    grantTypeExpr: comConcessao ? `$${base + 4}::text` : null,
  });
  return { sql: `AND ( t.access_level = 'public'\n                OR ${autorizacao} )`, params };
}

/**
 * Rejects an invalid MapLibre `config.style` (basemap style override) before it is persisted and
 * later served verbatim in the public GET /config basemapStyles.
 */
function assertValidStyle(config) {
  if (config && config.style !== undefined) {
    const result = validateMapLibreStyle(config.style);
    if (!result.ok) {
      throw new BadRequestError(`Invalid MapLibre style: ${result.errors.join(' ')}`);
    }
  }
}

/**
 * Lists active items of a catalog table, filtered by ACCESS LEVEL.
 *
 * Sem `visibleTo`, devolve só o público — é o que `GET /api/config` quer, e é o
 * que mantém aquele payload igual para todo chamador (o memo de documento único
 * depende disso). Com `visibleTo`, soma o que aquele principal enxerga por papel
 * global ou concessão.
 *
 * @param {string} table - One of CATALOG_TABLES.
 * @param {{userId: string|null, atlasId: string|null, resourceType: string}} [visibleTo]
 * @returns {Promise<Array>}
 */
export async function listCatalog(table, visibleTo = null) {
  const t = assertTable(table);
  const pred = accessPredicate(visibleTo, 0, assertProductionTypeOf(t));
  const { rows } = await query(
    `SELECT ${COLS_COM_ACESSO} FROM ${t} t WHERE t.active = true ${pred.sql} ORDER BY t.sort_order, t.name`,
    pred.params,
  );
  return rows;
}

/**
 * One catalog item by id, filtered by ACCESS LEVEL like the listing.
 *
 * O MESMO GATE DA LISTAGEM, e não por simetria estética: `GET /api/v1/tilesets/:id`
 * é `auth` e mais nada, exatamente como a rota de lista, então um recurso privado
 * vazava por aqui pelo id mesmo depois de sumir da listagem. Foi medido em
 * `resource-access-listagem-crua.test.js` antes de ser fechado.
 *
 * 404, não 403: um recurso que o chamador não enxerga precisa ser indistinguível
 * de um que não existe, senão o proprio 403 confirma a existência.
 *
 * @param {string} table
 * @param {string} id
 * @param {{userId: string|null, atlasId: string|null, resourceType: string}} [visibleTo]
 */
export async function getCatalogItem(table, id, visibleTo = null) {
  const t = assertTable(table);
  // L12 — `active = true`, matching listCatalogItems. Without it a soft-deleted
  // item stayed readable by direct id: gone from every listing, yet still served
  // (and still editable, since updateCatalogItem does not filter either).
  const pred = accessPredicate(visibleTo, 1, assertProductionTypeOf(t));
  const row = await oneOrNone(
    `SELECT ${COLS_COM_ACESSO} FROM ${t} t WHERE t.id = $1 AND t.active = true ${pred.sql}`,
    [id, ...pred.params],
  );
  if (!row) throw new NotFoundError('Catalog item');
  return row;
}

// CREATE resurrects a soft-deleted id (L40). The three paths used to disagree about what
// "exists" means: get/update filter `active = true` (404 on a deleted item) while this
// duplicate probe did not (409 on the same id), and the module has no restore route. A
// deleted id was therefore stuck in a state with no way back — it existed for the conflict
// gate and did not exist for everything else — so DELETE /basemaps/osm took the seeded basemap
// off /api/config for everyone until somebody ran a manual UPDATE. That is the opposite of what
// soft-delete is for; the tests even recorded the dead end as a fact of life ("a soft-deleted id
// can never be recreated (permanent 409), so every test must mint its own id").
//
// A LIVE id still conflicts: that guard is what prevents a silent overwrite of a published item.
/**
 * @typedef {Object} AtorDeProducao
 * @property {string|null} id - O principal, já resolvido (`principalUserId`).
 * @property {string|null} producerOrgId - O escopo de produção, lido do BANCO pelo
 *   gate da rota. `null` para administrador (que não produz por OM nenhuma).
 */

/**
 * Cria (ou ressuscita) um item de catálogo.
 *
 * A OM PRODUTORA É FORÇADA, NUNCA LIDA DO CORPO: quem cria com escopo de produção
 * fica dono pela própria OM, e administrador (escopo nulo) cria acervo
 * institucional. Ler `owner_org_id` do request seria deixar o produtor escolher de
 * quem é o que ele acabou de criar.
 *
 * A RESSURREIÇÃO É GATEADA PELA MESMA FUNÇÃO DA ESCRITA, e essa linha é a que falta
 * com mais facilidade: o id de catálogo é um SLUG GLOBAL (PK simples em `id`), então
 * o produtor de uma OM pode digitar o id que outra soft-deletou e, como a
 * ressurreição é overwrite total, sairia dono da linha por sobrescrita. `pode` vem
 * do mesmo `fn_can_produce_resource` que gateia o UPDATE e o DELETE.
 *
 * DEVOLVE UM ENVELOPE, e não a linha nua, porque a auditoria precisa distinguir duas
 * operações diferentes que compartilham a mesma rota: um INSERT e a RESSURREIÇÃO de
 * um id soft-deletado. `CATALOG_CREATE` sem essa distinção descreve mal o segundo
 * caso, que é um overwrite total de uma linha que já existia. `ownerOrgId` viaja
 * junto porque é o que PROVA qual OM o produtor carimbou (`owner_org_id` fica fora
 * de COLS, amarrada em oito colunas por `catalog-tabelas-paridade.test.js`, e
 * esticar o RETURNING mudaria o corpo da resposta).
 *
 * @param {string} table
 * @param {Object} data
 * @param {AtorDeProducao} actor
 * @returns {Promise<{row: Object, resurrected: boolean, ownerOrgId: string|null}>}
 */
export async function createCatalogItem(table, data, actor) {
  const t = assertTable(table);
  const tipo = assertProductionTypeOf(t);
  const existing = await oneOrNone(
    `SELECT id, active, owner_org_id, fn_can_produce_resource($2::uuid, $3::text, id) AS pode
       FROM ${t} WHERE id = $1`,
    [data.id, actor?.id ?? null, tipo],
  );
  if (existing && existing.active) throw new ConflictError('Já existe um item de catálogo com este ID.');
  if (existing && existing.pode !== true) {
    // Mesma mensagem do conflito vivo, de propósito: o id é global, então "está
    // tomado" é tudo o que o chamador pode aprender, e nada sobre de quem ele é.
    throw new ConflictError('Já existe um item de catálogo com este ID.');
  }
  assertValidStyle(data.config);

  const values = [
    data.id,
    data.name,
    data.description || null,
    JSON.stringify(data.config || {}),
    data.sort_order || 0,
    actor?.producerOrgId ?? null,
  ];

  const row = existing
    // Resurrection is a full overwrite, not a merge: the caller sent a complete create
    // payload, so the row must end up exactly as if it had been inserted now.
    //
    // `owner_org_id` fica DE FORA do SET: o produtor da OM dona já passou pelo gate
    // acima, e reescrever a coluna com o escopo dele transformaria a ressurreição
    // feita por um administrador (escopo nulo) numa transferência silenciosa para o
    // acervo institucional. Transferir é ação própria, de administrador.
    ? await one(
      `UPDATE ${t} SET name = $2, description = $3, config = $4::jsonb, sort_order = $5,
                      active = true, updated_at = NOW()
       WHERE id = $1 RETURNING ${COLS}`,
      values.slice(0, 5),
    )
    : await one(
      `INSERT INTO ${t} (id, name, description, config, sort_order, owner_org_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6::uuid) RETURNING ${COLS}`,
      values,
    );

  invalidateAppConfigCache();
  return {
    row,
    resurrected: Boolean(existing),
    ownerOrgId: existing ? (existing.owner_org_id ?? null) : (actor?.producerOrgId ?? null),
  };
}

/**
 * Edita um item de catálogo.
 *
 * O GATE MORA NO `WHERE`, NA MESMA CONSULTA QUE MUTA, e não num middleware que leia
 * o dono antes: entre a leitura e o UPDATE existe janela (um administrador
 * transferindo `owner_org_id`), e uma pergunta feita duas vezes é uma pergunta com
 * duas respostas possíveis. Zero linhas continua virando 404, pela mesma escada de
 * `getCatalogItem`: a linha de outra OM precisa ser indistinguível de uma que não
 * existe.
 *
 * `owner_org_id` NUNCA entra no SET: produtor não transfere linha nenhuma.
 * @param {string} table
 * @param {string} id
 * @param {Object} data
 * @param {AtorDeProducao} actor
 */
export async function updateCatalogItem(table, id, data, actor) {
  const t = assertTable(table);
  const tipo = assertProductionTypeOf(t);
  assertValidStyle(data.config);
  // L12 — only the soft-delete filter is added here: a deleted item must not be
  // editable back into visibility through this route.
  //
  // The `description` COALESCE is left ALONE on purpose. The scan flagged it as
  // "impossible to clear", but that is not quite right: passing `''` does clear
  // it, and only a literal SQL NULL is unreachable. The null-vs-empty asymmetry
  // is deliberate as-built behaviour, pinned by `images-gaps.test.js` res-02.
  const row = await oneOrNone(
    `UPDATE ${t} SET
       name = COALESCE($2, name),
       description = COALESCE($3, description),
       config = COALESCE($4::jsonb, config),
       sort_order = COALESCE($5, sort_order),
       updated_at = NOW()
     WHERE id = $1 AND active = true
       AND fn_can_produce_resource($6::uuid, $7::text, $1)
     RETURNING ${COLS}`,
    [
      id,
      data.name || null,
      data.description !== undefined ? data.description : null,
      data.config ? JSON.stringify(data.config) : null,
      data.sort_order !== undefined ? data.sort_order : null,
      actor?.id ?? null,
      tipo,
    ],
  );
  if (!row) throw new NotFoundError('Catalog item');
  invalidateAppConfigCache();
  return row;
}

/**
 * Soft-deletes (active = false) a catalog item, com o gate de produção no `WHERE`
 * pela mesma razão do UPDATE.
 *
 * DEVOLVE A LINHA (id + nome) em vez de `true`: o `target_name` da trilha é a única
 * coisa que ainda diz o que era aquele id depois que ele sumiu das listagens, e um
 * booleano não carrega nome nenhum.
 * @param {string} table
 * @param {string} id
 * @param {AtorDeProducao} actor
 * @returns {Promise<{id: string, name: string}>}
 */
export async function deleteCatalogItem(table, id, actor) {
  const t = assertTable(table);
  const tipo = assertProductionTypeOf(t);
  const row = await oneOrNone(
    `UPDATE ${t} SET active = false, updated_at = NOW()
      WHERE id = $1 AND fn_can_produce_resource($2::uuid, $3::text, $1)
      RETURNING id, name`,
    [id, actor?.id ?? null, tipo],
  );
  if (!row) throw new NotFoundError('Catalog item');
  invalidateAppConfigCache();
  return row;
}
