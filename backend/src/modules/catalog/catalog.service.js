// Path: src/modules/catalog/catalog.service.js
// Generic CRUD over the per-type catalog tables (basemaps / data_layers / analysis_layers /
// tilesets). The `table` arg is whitelisted (assertTable) before interpolation.
//
// Every write here drops the memoized GET /api/config payload (config.cache.js). All four
// tables feed that payload, so the invalidation is never wasted. It used to cover a fifth,
// `streetview_markers`, which fed nothing and was invalidated anyway; that table was dropped
// for having had no consumer at all, and `005_catalogo.sql` does not recreate it.
import { query, oneOrNone, one } from '../../database/index.js';
import { NotFoundError, ConflictError, BadRequestError } from '../../utils/errors.js';
import { validateMapLibreStyle } from '../../utils/maplibre-style-validate.js';
import { invalidateAppConfigCache } from '../config/config.cache.js';
import { assertTable, assertProductionTypeOf, CATALOG_TABLES } from './catalog.tables.js';

/** A única tabela cujo `config.style` é um documento MapLibre inteiro. Ver `assertValidStyle`. */
const BASEMAP_TABLE = 'basemaps';
import { catalogAuthorizationPredicate } from './catalog.queries.js';
// A CONTAGEM DE REFERÊNCIAS ATRAVESSA O MÓDULO, e o import diz de onde vem a autoridade: a
// consulta e a declaração de cobertura moram ao lado da IRMÃ dela (`COLLECT_ATLAS_RESOURCE_REFS`),
// no módulo `atlas`, porque as duas materializam o MESMO registro de superfícies e uma superfície
// nova precisa entrar nas duas no mesmo commit. Uma terceira cópia aqui seria a que fica para trás.
import { COUNT_ATLAS_REFS_TO_RESOURCE, REF_COUNT_SURFACES } from '../atlas/atlas.queries.js';
import { RESOURCE_REF_SURFACES, REF_ACTION } from '../atlas/resource-reference.registry.js';
import { TYPE_BY_TABLE } from '../resource-access/resource-access.types.js';
import { catalogLayerReference } from './catalog-layer.ref.js';

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

// As mesmas oito colunas, QUALIFICADAS. O UPDATE do de-para ganhou um `FROM (…) antes`
// cujas colunas repetem quatro dos nomes de COLS, e uma referência nua a `name` num
// RETURNING com duas origens é ambígua (o Postgres levanta 42702, não escolhe). Derivada
// de COLS em vez de escrita de novo: uma nona coluna acrescentada lá aparece aqui sem que
// ninguém precise lembrar deste ponto.
const COLS_T = COLS.split(', ').map((c) => `t.${c}`).join(', ');

/**
 * As QUATRO colunas que `PUT /:id` escreve — e as únicas que o de-para da trilha compara.
 *
 * A lista existe em UM lugar e os DOIS lados do de-para são projetados por ela, porque a
 * assimetria é o defeito fácil: o lado "antes" nasce da subconsulta (quatro colunas) e o
 * lado "depois" seria a linha inteira (oito), então `id`, `active`, `created_at` e
 * `updated_at` apareceriam como "campo que mudou de vazio para alguma coisa" em TODA
 * edição — quatro linhas de ruído por evento, classificadas como nome-só, para sempre, numa
 * tabela que não se edita.
 */
const CAMPOS_EDITAVEIS = Object.freeze(['name', 'description', 'config', 'sort_order']);

/** A projeção de uma linha (ou de um objeto de valores anteriores) nas quatro editáveis. */
function projetarEditaveis(linha) {
  return Object.fromEntries(CAMPOS_EDITAVEIS.map((c) => [c, linha?.[c] ?? null]));
}

/**
 * The resource-visibility predicate, as a WHERE fragment.
 *
 * IT CLOSES BY DEFAULT, and that is the property that matters: with no principal, only the
 * public rows. The list of `listCatalog` callers keeps growing and the likely oversight is
 * "I did not pass the principal" — which here degrades to LESS data, never to a leak. The
 * opposite shape (open by default, optional filter) is the one that turns an oversight into
 * an incident.
 *
 * Semi-join (`IN (SELECT ...)`), never `fn_can_see_resource` per row: one query instead of
 * one per row (R8). The COMPOSITION of the three arms moved out of here into
 * `catalog.queries.js` when the snapshot rehydration (F11) needed it; what this function
 * still decides is the `public` term and the NUMBERING of the parameters.
 *
 * THE PRODUCTION ARM BELONGS HERE, and not out of aesthetic symmetry: without it a producer
 * got a 404 on the GET of their own private layer and success on the PUT, which is the same
 * row existing for writing and not existing for reading. All FOUR catalog tables have BOTH
 * arms: `basemaps` gained a grant type and stopped arriving here with a null
 * `resourceType`. The caller's `??` is still there because `visibleTo` is built from a map,
 * and a map that loses an entry must degrade to less data, never to a leak.
 *
 * @param {{userId: string|null, atlasId: string|null, resourceType: string|null}|null} visibleTo
 * @param {number} base - Index of the last parameter already used.
 * @param {string} tipoProducao - This table's type on the production axis.
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
 *
 * SÓ PARA `basemaps`, e o recorte É a correção: a palavra `style` tem DOIS significados no
 * catálogo. No mapa base ela é um documento MapLibre INTEIRO, servido verbatim no `GET /config`,
 * e um documento malformado ali trava o mapa de todo mundo. Numa camada de dados ela é um
 * RECORTE de pintura (`fill` / `border` / `label`), que por construção não tem `version`, nem
 * `sources`, nem `layers`, e portanto reprova naquele validador SEMPRE.
 *
 * Enquanto esta função rodava para as quatro tabelas, o template padrão de camada de dados do
 * painel (que já nasce com um `style.border`) era recusado com 400, ou seja, registrar camada de
 * dados pela tela era impossível, e a mensagem cobrava `version: 8` de uma coisa que nunca teve.
 * O cliente já fazia o recorte certo e escrevia o porquê em comentário
 * (`frontend/src/js/admin/catalog-tab.js`, onde a validação de estilo inteiro é gateada por
 * categoria); quem validava demais era o servidor. Preso por
 * `backend/tests/integration/catalogo-estilo-de-camada.repro.test.js`, que cobra os DOIS
 * sentidos: o recorte passa em camada de dados, e o estilo quebrado continua reprovando em mapa
 * base.
 */
function assertValidStyle(table, config) {
  if (table !== BASEMAP_TABLE) return;
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
    `SELECT ${COLS_COM_ACESSO} FROM ${t} t WHERE t.active = true ${pred.sql} ORDER BY t.created_at, t.name`,
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
  assertValidStyle(t, data.config);

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
 * `owner_org_id` NUNCA entra no SET: produtor não transfere linha nenhuma. Ele SAI no
 * `RETURNING`, e volta no ENVELOPE em vez de na linha, pelo mesmo motivo de
 * `createCatalogItem`: a trilha precisa da OM dona para o eixo de auditoria por OM, e
 * `COLS` está amarrada em oito colunas por `catalog-tabelas-paridade.test.js` — esticar
 * a constante mudaria o corpo da resposta desta rota.
 *
 * OS VALORES ANTERIORES VIAJAM NO MESMO STATEMENT, e é o que torna possível gravar um
 * de-para (`utils/audit-diff.js`) em vez de só os nomes dos campos tocados. Eles vêm de
 * um `FROM (SELECT … FOR UPDATE) antes`, e o `FOR UPDATE` é a metade que importa: sem
 * ele a subconsulta enxerga o snapshot do início do statement enquanto o UPDATE relê a
 * linha, e em `READ COMMITTED` uma escrita concorrente faria `antes` divergir do que foi
 * de fato sobrescrito — um de-para que registra um "de" que nunca existiu é pior que
 * nenhum. Com o lock, a linha é travada antes do UPDATE e as duas leituras são a mesma.
 *
 * @param {string} table
 * @param {string} id
 * @param {Object} data
 * @param {AtorDeProducao} actor
 * @returns {Promise<{row: Object, antes: Object, depois: Object, ownerOrgId: string|null}>}
 */
export async function updateCatalogItem(table, id, data, actor) {
  const t = assertTable(table);
  const tipo = assertProductionTypeOf(t);
  assertValidStyle(t, data.config);
  // L12 — only the soft-delete filter is added here: a deleted item must not be
  // editable back into visibility through this route.
  //
  // The `description` COALESCE is left ALONE on purpose. The scan flagged it as
  // "impossible to clear", but that is not quite right: passing `''` does clear
  // it, and only a literal SQL NULL is unreachable. The null-vs-empty asymmetry
  // is deliberate as-built behaviour, pinned by `images-gaps.test.js` res-02.
  const row = await oneOrNone(
    `UPDATE ${t} AS t SET
       name = COALESCE($2, t.name),
       description = COALESCE($3, t.description),
       config = COALESCE($4::jsonb, t.config),
       sort_order = COALESCE($5, t.sort_order),
       updated_at = NOW()
     FROM (SELECT id, name, description, config, sort_order
             FROM ${t} WHERE id = $1 FOR UPDATE) antes
     WHERE t.id = antes.id AND t.active = true
       AND fn_can_produce_resource($6::uuid, $7::text, t.id)
     RETURNING ${COLS_T}, t.owner_org_id,
               antes.name AS antes_name, antes.description AS antes_description,
               antes.config AS antes_config, antes.sort_order AS antes_sort_order`,
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
  const {
    owner_org_id: ownerOrgId,
    antes_name: antesName,
    antes_description: antesDescription,
    antes_config: antesConfig,
    antes_sort_order: antesSortOrder,
    ...publico
  } = row;
  // OS DOIS LADOS DO DE-PARA SAEM DA MESMA PROJEÇÃO (ver `CAMPOS_EDITAVEIS`), e o
  // chamador recebe os dois prontos em vez de montar um deles: entregar `antes` projetado
  // e deixar o `depois` para quem chamar é o convite a comparar quatro campos contra oito.
  return {
    row: publico,
    antes: projetarEditaveis({
      name: antesName,
      description: antesDescription,
      config: antesConfig,
      sort_order: antesSortOrder,
    }),
    depois: projetarEditaveis(publico),
    ownerOrgId: ownerOrgId ?? null,
  };
}

/**
 * Grava (ou remove, com `url === null`) a URL do VÍDEO DE PRÉVIA de um item de catálogo.
 *
 * É rota própria porque o vídeo agora é ENVIADO (arquivo hospedado, `catalog-video.store`), não
 * uma URL colada: o controller salva o arquivo, chama isto com a URL servida, e depois apaga o
 * arquivo ANTIGO (que sai aqui no envelope como `oldUrl`). O gate é o mesmo `fn_can_produce_resource`
 * das outras escritas, no `WHERE`.
 *
 * O MAPA BASE NÃO TEM VÍDEO (cláusula 2.4): a superfície dele é o seletor de camada, sem cartão,
 * e o schema de update já recusa `config.previewVideo` para ele. Esta rota reafirma com 400, para
 * o `jsonb_set` não contornar aquela regra.
 *
 * @param {string} table
 * @param {string} id
 * @param {string|null} url - a URL servida do vídeo, ou null para remover
 * @param {AtorDeProducao} actor
 * @returns {Promise<{row: Object, ownerOrgId: string|null, oldUrl: string|null}>}
 */
export async function setCatalogPreviewVideo(table, id, url, actor) {
  const t = assertTable(table);
  if (t === 'basemaps') throw new BadRequestError('Mapa base não tem vídeo de prévia.');
  const tipo = assertProductionTypeOf(t);
  const row = await oneOrNone(
    `UPDATE ${t} AS t SET
       config = CASE WHEN $2::text IS NULL
                     THEN t.config - 'previewVideo'
                     ELSE jsonb_set(t.config, '{previewVideo}', to_jsonb($2::text)) END,
       updated_at = NOW()
     FROM (SELECT id, config FROM ${t} WHERE id = $1 FOR UPDATE) antes
     WHERE t.id = antes.id AND t.active = true
       AND fn_can_produce_resource($3::uuid, $4::text, t.id)
     RETURNING ${COLS_T}, t.owner_org_id, antes.config AS antes_config`,
    [id, url, actor?.id ?? null, tipo],
  );
  if (!row) throw new NotFoundError('Catalog item');
  invalidateAppConfigCache();
  const { owner_org_id: ownerOrgId, antes_config: antesConfig, ...publico } = row;
  return { row: publico, ownerOrgId: ownerOrgId ?? null, oldUrl: antesConfig?.previewVideo ?? null };
}

/**
 * Transfere a OM DONA de um item de catálogo (a única escrita que toca `owner_org_id`).
 *
 * ELA É SEPARADA DO UPDATE DE PROPÓSITO, e a razão é a mesma da visibilidade: as três
 * escritas comuns NUNCA leem `owner_org_id` do corpo, e `papel-produtor-catalogo.test.js`
 * afirma isso. Um seletor de OM no PUT teria de fazer o SET só para o administrador dentro
 * da consulta que também grava nome e config, misturando dois eixos numa query. Aqui o
 * gate é da ROTA (`requireAdmin`), então esta função NÃO carrega gate de produção no
 * `WHERE`: quem chega passou por administrador, e administrador transfere qualquer linha.
 *
 * `ownerOrgId` NULL É LEGÍTIMO: devolve a linha ao acervo INSTITUCIONAL. Uma OM que não
 * exista ou esteja inativa é 400, e não uma violação de FK crua (23503 vira 500 na borda).
 *
 * O `FROM (… FOR UPDATE) antes` trava a linha e captura a OM ANTERIOR no mesmo statement,
 * pelo mesmo motivo do UPDATE: a trilha registra de-para (`fromOrgId` -> `toOrgId`) e um
 * "de" que nunca existiu é pior que nenhum.
 *
 * @param {string} table
 * @param {string} id
 * @param {string|null} ownerOrgId - A nova OM dona, ou null para institucional.
 * @returns {Promise<{row: Object, fromOrgId: string|null, toOrgId: string|null}>}
 */
export async function transferCatalogItemOwner(table, id, ownerOrgId) {
  const t = assertTable(table);
  if (ownerOrgId) {
    const org = await oneOrNone(
      'SELECT id FROM organizations WHERE id = $1 AND is_active = true',
      [ownerOrgId],
    );
    if (!org) throw new BadRequestError('OM dona inválida ou inativa.');
  }
  const row = await oneOrNone(
    `UPDATE ${t} AS t SET owner_org_id = $2, updated_at = NOW()
     FROM (SELECT id, owner_org_id FROM ${t} WHERE id = $1 FOR UPDATE) antes
     WHERE t.id = antes.id AND t.active = true
     RETURNING ${COLS_T}, t.owner_org_id, antes.owner_org_id AS antes_owner_org_id`,
    [id, ownerOrgId ?? null],
  );
  if (!row) throw new NotFoundError('Catalog item');
  invalidateAppConfigCache();
  const { owner_org_id: toOrgId, antes_owner_org_id: fromOrgId, ...publico } = row;
  return { row: publico, fromOrgId: fromOrgId ?? null, toOrgId: toOrgId ?? null };
}

/**
 * Soft-deletes (active = false) a catalog item, com o gate de produção no `WHERE`
 * pela mesma razão do UPDATE.
 *
 * DEVOLVE A LINHA (id + nome + OM dona) em vez de `true`: o `target_name` da trilha é a
 * única coisa que ainda diz o que era aquele id depois que ele sumiu das listagens, e um
 * booleano não carrega nome nenhum. A OM entrou pelo eixo de auditoria por OM, e não
 * aparece em resposta nenhuma — a rota responde 204.
 * @param {string} table
 * @param {string} id
 * @param {AtorDeProducao} actor
 * @returns {Promise<{id: string, name: string, owner_org_id: string|null}>}
 */
export async function deleteCatalogItem(table, id, actor) {
  const t = assertTable(table);
  const tipo = assertProductionTypeOf(t);
  const row = await oneOrNone(
    `UPDATE ${t} SET active = false, updated_at = NOW()
      WHERE id = $1 AND fn_can_produce_resource($2::uuid, $3::text, $1)
      RETURNING id, name, owner_org_id`,
    [id, actor?.id ?? null, tipo],
  );
  if (!row) throw new NotFoundError('Catalog item');
  invalidateAppConfigCache();
  return row;
}

// ============================================================================
// QUANTOS ATLAS REFERENCIAM UM RECURSO
//
// A rota nasce por decisão do dono (2026-08-24) para fechar o achado A6: excluir um item de
// catálogo é `active = false` e NÃO consulta referência nenhuma, e a confirmação da tela
// (`frontend/src/js/admin/catalog-delete-phrases.js`) declara por extenso que não traz o número
// porque ele "exigiria uma rota nova". A rota é esta.
//
// O CABEÇALHO DAQUELA TELA CONTINUA CERTO NUMA COISA, e ela não deve ser apagada quando o número
// aparecer: o número é contado ANTES do clique, e entre a leitura e a confirmação ele pode mudar.
// Ele descreve o estado do acervo no instante da pergunta, nunca uma garantia sobre o efeito.
// ============================================================================

/**
 * `origem` da consulta -> as entradas do registro que aquela perna cobre, invertido.
 *
 * Montado UMA vez, no load, e é aqui que a materialização é confrontada com o inventário: para
 * cada uma das quatro tabelas de catálogo, TODA superfície que o registro declara precisa ter
 * perna. Sem perna, a contagem simplesmente ignora aquela superfície e devolve um número menor
 * que o verdadeiro, com a resposta bem-formada — o defeito mais caro que uma confirmação de
 * exclusão pode ter, porque ele empurra para o lado do "pode apagar".
 *
 * O CONFRONTO LEVANTA NO LOAD DO MÓDULO, e não no pedido, de propósito: a condição é estática
 * (duas listas congeladas), então ela é sempre verdadeira ou sempre falsa. Levantar aqui faz o
 * backend recusar subir na primeira execução depois do descuido, em dev e em teste, muito antes
 * de existir chance de servir um número errado.
 */
const ORIGEM_POR_REGISTRO = new Map(
  REF_COUNT_SURFACES.flatMap((s) => s.registro.map((r) => [r, s.origem])),
);

/**
 * As `origem` que se aplicam a um tipo, DERIVADAS DO REGISTRO.
 *
 * A lista por tipo não é escrita à mão em lugar nenhum: quem sabe que
 * `settings.available_3d_models` é de `tileset` é `RESOURCE_REF_SURFACES`. Uma segunda cópia
 * dessa correspondência é o que faz a resposta oferecer, para um mapa base, chaves de superfície
 * de modelo 3D eternamente zeradas.
 *
 * @param {string} type - Um de `RESOURCE_TYPES`.
 * @returns {string[]}
 */
function origensDoTipo(type) {
  const out = [];
  for (const sup of RESOURCE_REF_SURFACES) {
    if (sup.acao === REF_ACTION.NAO_REFERENCIA) continue;
    if (!sup.tipos.includes(type)) continue;
    const origem = ORIGEM_POR_REGISTRO.get(sup.id);
    if (origem === undefined) {
      throw new Error(
        `Superfície de referência sem perna em COUNT_ATLAS_REFS_TO_RESOURCE: ${sup.id}`,
      );
    }
    if (!out.includes(origem)) out.push(origem);
  }
  return out;
}

// O confronto acima roda AGORA, no load, para as quatro tabelas de catálogo.
for (const tabela of CATALOG_TABLES) origensDoTipo(TYPE_BY_TABLE[tabela]);

/**
 * Quantos atlas VIVOS citam este item de catálogo, no total e por superfície.
 *
 * O GATE É O MESMO DE `deleteCatalogItem`, e a simetria é o desenho: o número existe para a
 * confirmação da exclusão, então quem pode contar é exatamente quem pode excluir. A linha de
 * outra OM devolve 404 pelo mesmo motivo da leitura — precisa ser indistinguível de uma que não
 * existe, senão a rota vira oráculo de existência sobre o acervo alheio.
 *
 * A RESOLUÇÃO DA CAMADA DE CATÁLOGO É EM JS, e não é preferência: o prefixo e as duas formas
 * legadas têm UMA definição (`catalogLayerReference`), e o SQL desta consulta só ESTREITA. Contar
 * no banco daria um número maior que o verdadeiro — um `analysis-mapa` casaria o sufixo de um
 * recurso chamado `mapa` sem ser referência a ele.
 *
 * O QUE O NÚMERO NÃO É, e a frase da tela precisa respeitar: ele conta quem CITA o id, não quem
 * EXIBE o recurso. As cinco allowlists de `atlas.settings` tratam lista vazia como "sem
 * restrição", então um atlas que não cita pode estar exibindo. Ver o cabeçalho de
 * `COUNT_ATLAS_REFS_TO_RESOURCE`.
 *
 * @param {string} table - Uma de CATALOG_TABLES.
 * @param {string} id
 * @param {AtorDeProducao} actor
 * @returns {Promise<{resourceId: string, resourceType: string, atlasCount: number,
 *   bySurface: Object<string, number>}>}
 */
export async function countAtlasReferences(table, id, actor) {
  const t = assertTable(table);
  const tipoProducao = assertProductionTypeOf(t);
  const tipoRecurso = TYPE_BY_TABLE[t];

  const alvo = await oneOrNone(
    `SELECT id FROM ${t}
      WHERE id = $1 AND active = true AND fn_can_produce_resource($2::uuid, $3::text, $1)`,
    [id, actor?.id ?? null, tipoProducao],
  );
  if (!alvo) throw new NotFoundError('Catalog item');

  const { rows } = await query(COUNT_ATLAS_REFS_TO_RESOURCE, [id, tipoRecurso]);

  // Um Set POR SUPERFÍCIE, e não um contador: a consulta devolve uma linha por (superfície,
  // atlas, camada), então dois mapas do mesmo atlas com o mesmo mapa base contariam duas vezes.
  // As chaves nascem TODAS presentes, com zero, porque chave ausente e chave zerada são
  // indistinguíveis para quem consome e só uma delas é verdade.
  const porSuperficie = new Map(origensDoTipo(tipoRecurso).map((o) => [o, new Set()]));
  const todos = new Set();

  for (const linha of rows) {
    if (linha.origem === 'mapa.catalogLayers') {
      const ref = catalogLayerReference(linha.layer_data ?? {}, linha.layer_id);
      if (!ref || ref.resourceType !== tipoRecurso || ref.resourceId !== id) continue;
    }
    porSuperficie.get(linha.origem)?.add(linha.atlas_id);
    todos.add(linha.atlas_id);
  }

  return {
    resourceId: alvo.id,
    resourceType: tipoRecurso,
    atlasCount: todos.size,
    bySurface: Object.fromEntries([...porSuperficie].map(([o, s]) => [o, s.size])),
  };
}
