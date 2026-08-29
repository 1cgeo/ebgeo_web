// Path: src/modules/resource-access/resource-access.service.js
// Lógica do acesso a recurso privado. O PREDICADO não mora aqui: ele mora nas funções
// SQL de `008_acesso_a_recurso.sql` (`fn_can_see_resource`, `fn_can_produce_resource`,
// `fn_granted_resource_ids` e as de apoio). É o que permite dizer "o dado não vaza nem
// com bug de app" — um erro nesta camada não abre nada que o SQL feche.

import { query, one, oneOrNone, tx } from '../../database/index.js';
import { NotFoundError, ForbiddenError, ConflictError } from '../../utils/errors.js';
import { createAudit } from '../../utils/audit.js';
import { invalidateAppConfigCache } from '../config/config.cache.js';
import * as Q from './resource-access.queries.js';
import {
  RESOURCE_TYPES, PAYLOAD_KEY_BY_TYPE, RESOURCE_ORIGIN, assertResourceType, tableOf,
  assertCatalogTableOf, assertAuditTargetTypeOfResource,
} from './resource-access.types.js';
// A CHAVE DE JUNÇÃO vem do registro de superfícies, e não é escrita duas vezes: quem
// consome este `Map` (o clone e o import) monta a mesma chave com a mesma função. Duas
// implementações do separador seriam duas tabelas que nunca casam, e o sintoma seria a
// poda apagar TUDO — o `Map` respondendo `undefined` para toda consulta.
import { resourceRefKey } from '../atlas/resource-reference.registry.js';
// O AVISO AO VIVO É IRMÃO DESTE ARQUIVO, e não parte dele: ver o cabeçalho de
// `resource-access.notify.js`. O import é só de ida (notify importa este módulo, este
// módulo importa só a função de aviso), e é assim que os cinco podadores compartilham
// UMA definição de aviso sem ciclo e sem serviço puxando controller.
// `atlasesLendingResource` vem junto porque este arquivo passou a CONTÁ-la (ver
// `countAtlasesLendingResource`), e não só a reexportá-la: um `export { x } from` reexporta
// sem criar ligação local, então usá-la aqui exige o import de verdade.
import { atlasesLendingResource, avisarAtlasQueEmprestam } from './resource-access.notify.js';

/**
 * Marca um recurso como público ou privado.
 *
 * O GATE É DUPLO E EM CAMADAS DIFERENTES, desde 2026-08-20. `requireResourceMaintainer`
 * recusa cedo quem não mantém acervo nenhum (403); QUAL linha é dele é decidido pelo
 * `WHERE` da própria escrita, que carrega `fn_can_produce_resource`. O
 * `if (!updated) throw new NotFoundError('Resource')` que já existia passa a cobrir
 * DUAS causas — "não existe" e "não é da sua OM" — e elas são indistinguíveis de
 * propósito: um 403 na segunda confirmaria a existência do que o 404 esconde.
 *
 * `invalidateAppConfigCache()` roda DEPOIS do commit, nunca dentro (R3). Invalidar
 * dentro da transação reabre a janela na forma de cache: um GET concorrente
 * caindo ali reconstruiria o memo a partir da linha ANTIGA e o re-cacharia,
 * exatamente a janela que a transação acabou de fechar. É a lição de
 * `config-admin-lost-update.repro.test.js`.
 *
 * @param {{type: string, resourceId: string, accessLevel: 'public'|'private', actor: object, req: object}} params
 * @returns {Promise<{id: string, name: string, access_level: string}>}
 */
export async function setResourceVisibility({ type, resourceId, accessLevel, actor, req }) {
  const t = assertResourceType(type);
  const table = tableOf(t);
  const actorId = actor?.id ?? null;

  const row = await tx(async (trx) => {
    const updated = table
      ? await trx.oneOrNone(Q.setCatalogAccessLevel(table), [accessLevel, resourceId, actorId, t])
      : await trx.oneOrNone(Q.SET_360_ACCESS_LEVEL, [accessLevel, resourceId, actorId]);
    if (!updated) throw new NotFoundError('Resource');
    // O ALVO É COLUNA DE PRIMEIRA CLASSE, e esta é a linha que motivou a mudança de
    // schema. Até ela, as duas restrições do schema de auditoria (002_auditoria.sql)
    // empurravam tipo e id para dentro de `details` — o CHECK de `target_type` não
    // tinha valor para "camada de dados" ('MODEL' seria mentira para três dos quatro
    // tipos) e `target_id` era UUID enquanto o id de catálogo é um SLUG TEXTUAL
    // (gravá-lo ali levantava 22P02, que a borda devolvia como HTTP 400, numa rota
    // sem relação aparente com auditoria). A consequência era que `idx_audit_target`
    // não respondia "tudo que já foi feito com este recurso" e 'SYSTEM' virava
    // depósito de alvo que não coube. As duas caíram; 'SYSTEM' volta a significar
    // sistema.
    await createAudit(req, {
      action: 'SHARING_CHANGE',
      actorId: actor.id,
      targetType: assertAuditTargetTypeOfResource(t),
      targetId: resourceId,
      targetName: updated.name,
      // A OM DONA vem do próprio `RETURNING` da escrita, e não de uma leitura à parte:
      // é a mesma linha que acabou de mudar, no mesmo instante. Ela NÃO sai no corpo
      // HTTP — a desestruturação abaixo a tira antes do `return`, para que o shape da
      // resposta fique idêntico ao de antes.
      targetOrgId: updated.owner_org_id ?? null,
      details: { resourceType: t, accessLevel },
    }, trx);
    return updated;
  });

  invalidateAppConfigCache();
  // `owner_org_id` NÃO sai no corpo: ele entrou no `RETURNING` para a trilha, e o
  // contrato desta rota é `{ id, name, access_level }`. A projeção é explícita (e não
  // um rest-spread que descarta) para que uma coluna acrescentada ao `RETURNING`
  // amanhã não vaze por omissão.
  return { id: row.id, name: row.name, access_level: row.access_level };
}

// --- o payload aditivo -----------------------------------------------------

/**
 * Os recursos PRIVADOS que este principal enxerga, por tipo.
 *
 * ADITIVO é a palavra que define o desenho. `GET /api/config` continua servindo o
 * documento PÚBLICO, igual para todo chamador e memoizado como UM só; o que a
 * pessoa ganha por papel global, concessão ou empréstimo chega por aqui e o
 * cliente SOMA. Filtrar o `/api/config` por usuário destruiria aquele memo (ele
 * passaria a ser por conjunto de visibilidade, que é ilimitado) no único endpoint
 * cuja falha impede o produto de subir.
 *
 * Repare que o payload devolve SÓ o privado: ele é o delta, não o conjunto.
 *
 * `shareable` é o único campo que NÃO é recurso: é a lista de pares
 * (tipo, id) que este ator pode repassar adiante, para a interface decidir se
 * mostra a ação "Compartilhar" sem uma chamada por cartão. Ele viaja fora dos
 * cinco grupos de propósito — somá-lo dentro dos itens mudaria o shape que
 * `mergeGrantedIntoBaseline` despeja nos arrays do `config`.
 *
 * @param {Object} params
 * A OM DO CHAMADOR NÃO É MAIS PARÂMETRO. Ela era auto-declarada no auto-cadastro e
 * mesmo assim abria o privado daquela OM; o eixo continua existindo, resolvido no
 * SQL pelo escopo de PRODUÇÃO, que só um administrador concede.
 *
 * `origins` É A PROCEDÊNCIA de cada id, e ela fecha um defeito de TELA: o cliente
 * desenhava um selo único ("só quem recebeu acesso enxerga este item") para TRÊS
 * procedências, e a frase é falsa para duas delas. O que a tela precisa saber é qual
 * delas SOME quando a pessoa troca de atlas, e só o empréstimo some. Ver
 * {@link origemDeAcesso} para a precedência e o porquê dela.
 *
 * `expirations` É O IRMÃO DE `origins`, e nasceu pelo mesmo defeito visto do outro lado:
 * a procedência diz POR QUE a pessoa enxerga, e o prazo diz ATÉ QUANDO. Ele é um mapa
 * separado, com as mesmas cinco chaves, pela mesma razão estrutural que manteve as colunas
 * de procedência fora do item — o cliente despeja os itens deste payload dentro dos arrays
 * de `config`, e um campo a mais dentro do item muda o shape que os consumidores daquele
 * documento leem. Ele é ESPARSO onde `origins` é completo: só o id que tem prazo aparece,
 * porque a maioria dos ids não tem nenhum e um mapa cheio de `null` só diria isso de novo,
 * com bytes. Ver {@link prazoDeAcesso} para quando a entrada existe.
 *
 * @param {string|null} params.userId - null para o visitante de link público (R4).
 * @param {string|null} params.atlasId - O atlas em foco (empresta), ou null.
 * @returns {Promise<{basemaps: Array, tilesets: Array, dataLayers: Array, analysisLayers: Array, views360: Array, shareable: Object, origins: Object, expirations: Object}>}
 */
export async function listVisiblePrivateResources({ userId, atlasId }) {
  const catalogTypes = RESOURCE_TYPES.filter((t) => tableOf(t) !== null);
  // O SHAPE É ESTÁVEL POR CONSTRUÇÃO: as cinco chaves nascem aqui, vazias, e são
  // preenchidas depois. O cliente nunca deve precisar distinguir "sem procedência" de
  // "o servidor não respondeu essa parte", e uma chave ausente é exatamente essa
  // ambiguidade — é a mesma razão pela qual `shareable` nasce completo.
  const origins = Object.fromEntries(RESOURCE_TYPES.map((t) => [PAYLOAD_KEY_BY_TYPE[t], {}]));
  const expirations = Object.fromEntries(RESOURCE_TYPES.map((t) => [PAYLOAD_KEY_BY_TYPE[t], {}]));

  const catalogRows = await Promise.all(catalogTypes.map(async (type) => {
    const table = assertCatalogTableOf(type);
    const chave = PAYLOAD_KEY_BY_TYPE[type];
    const { rows } = await query(Q.listVisiblePrivate(table), [userId, atlasId, type]);
    for (const r of rows) {
      const origem = origemDeAcesso(r);
      origins[chave][r.id] = origem;
      const prazo = prazoDeAcesso(r, origem);
      if (prazo !== null) expirations[chave][r.id] = prazo;
    }
    // A MESMA REPROJEÇÃO DE `config.service.js` (`{ id, name, ...config }`), e não
    // a linha crua: o cliente soma isto dentro dos mesmos arrays de `config`, e um
    // item com shape diferente dos vizinhos quebra o consumidor no ponto de USO,
    // longe daqui. Ela é também o que mantém as três colunas de procedência FORA do
    // item: elas viajam na linha e saem por `origins`, nunca dentro do recurso.
    return [chave, rows.map((r) => ({ id: r.id, name: r.name, ...(r.config || {}) }))];
  }));

  const { rows: rows360 } = await query(Q.LIST_VISIBLE_PRIVATE_360, [userId, atlasId]);
  const chave360 = PAYLOAD_KEY_BY_TYPE.sv360_project;
  for (const r of rows360) {
    const origem = origemDeAcesso(r);
    origins[chave360][r.id] = origem;
    const prazo = prazoDeAcesso(r, origem);
    if (prazo !== null) expirations[chave360][r.id] = prazo;
  }

  return {
    ...Object.fromEntries(catalogRows),
    // A PROJEÇÃO DO 360 PASSOU A SER EXPLÍCITA, e a mudança é obrigatória, não estética:
    // até aqui a linha saía CRUA, então as três colunas de procedência apareceriam
    // dentro de cada item de `views360` — uma mudança de shape num payload que o cliente
    // despeja em arrays de configuração. A lista de campos é a mesma que o SELECT já
    // servia antes das colunas novas.
    [chave360]: rows360.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      center_lat: r.center_lat,
      center_long: r.center_long,
      entry_photo_id: r.entry_photo_id,
      photo_count: r.photo_count,
      status: r.status,
      capture_date: r.capture_date,
    })),
    shareable: await listShareableOfActor(userId),
    origins,
    expirations,
  };
}

/**
 * O PRAZO que a tela pode afirmar para uma linha do payload aditivo, ou `null`.
 *
 * SÓ A PROCEDÊNCIA `concessao` TEM PRAZO A DIZER, e a regra é a mesma precedência de
 * {@link origemDeAcesso} reusada, não uma segunda:
 *
 *   - `papel` (papel global ou PRODUÇÃO) não vence nunca. É fato de quem a pessoa é, e a
 *     coluna de prazo pode até vir preenchida (o administrador que também recebeu uma
 *     concessão), mas o vencimento dela não lhe tira nada — anunciá-lo seria prometer um
 *     sumiço que não vai acontecer, na tela em que a pessoa mais confia no prazo;
 *   - `concessao` é o caso em que o acesso REPOUSA nas concessões, e é o único em que o
 *     `MAX(expires_at)` que a consulta trouxe é, de fato, o instante da perda;
 *   - `emprestimo` chega aqui por eliminação e com a coluna NULA por construção (se
 *     houvesse concessão viva, a procedência não seria empréstimo). O `null` explícito é
 *     o que mantém a função verdadeira mesmo que um braço novo mude isso: empréstimo não
 *     tem relógio próprio (`atlas_resources` não tem coluna de prazo, de propósito).
 *
 * O CANTO QUE ESTA FUNÇÃO ACEITA ERRAR, e ele é herdado de `origins`: quem tem concessão
 * viva E está num atlas que empresta o mesmo recurso é rotulado `concessao`, então o chip
 * vai anunciar um sumiço que, enquanto ela ficar NESTE atlas, não acontece. O erro é na
 * direção do ALARME FALSO (a concessão realmente está vencendo, e renová-la é a ação
 * certa), não na da promessa falsa, e fabricar um quarto estado para cobri-lo custaria um
 * braço a mais no predicado para uma frase que ninguém pediu.
 *
 * ISO E NÃO `Date`: o valor atravessa `res.json` e vira string de qualquer jeito, mas
 * convertê-lo AQUI é o que torna o shape do payload uma decisão deste módulo em vez de um
 * detalhe do driver — e é o que permite testar esta função sem um banco no ar.
 *
 * @param {{concessao_expira_em: (Date|string|null)}} row - A linha da consulta.
 * @param {string} origem - Saída de {@link origemDeAcesso}.
 * @returns {string|null} ISO 8601, ou `null` quando não há prazo a afirmar.
 */
export function prazoDeAcesso(row, origem) {
  if (origem !== RESOURCE_ORIGIN.CONCESSAO) return null;
  const bruto = row?.concessao_expira_em ?? null;
  if (bruto === null) return null;
  const data = bruto instanceof Date ? bruto : new Date(bruto);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

/**
 * A PROCEDÊNCIA de uma linha do payload aditivo, por PRECEDÊNCIA sobre as três colunas
 * booleanas que a consulta trouxe.
 *
 * A ORDEM É `papel > concessao > emprestimo`, E ELA É SEMÂNTICA. As três não são
 * exclusivas: a mesma pessoa pode ter concessão própria E estar num atlas que empresta o
 * mesmo recurso. A tela usa este valor para dizer o que acontece ao TROCAR DE ATLAS, e
 * só o empréstimo some sozinho nessa troca — chamar de `emprestimo` quem também tem
 * concessão mentiria justamente na propriedade que a tela vai afirmar. O mesmo vale um
 * degrau acima: papel global e produção são fatos de QUEM A PESSOA É e não vencem com o
 * atlas nem com o prazo de ninguém.
 *
 * `emprestimo` É POR ELIMINAÇÃO, e é isso que o mantém correto sem uma segunda regra: a
 * linha só está no resultado porque o predicado a deixou entrar, e o predicado tem
 * exatamente quatro braços (papel, produção, concessão, empréstimo). Falsas as três
 * primeiras colunas, sobrou uma. Uma quinta forma de enxergar recurso privado que
 * apareça no predicado sem coluna aqui vira `emprestimo` em silêncio — é o único modo de
 * falha desta função, e é por isso que o braço novo precisa nascer com coluna em
 * `originColumns`.
 *
 * @param {{por_papel_global: boolean, por_producao: boolean, por_concessao: boolean}} row
 * @returns {'papel'|'concessao'|'emprestimo'}
 */
export function origemDeAcesso(row) {
  if (row.por_papel_global === true || row.por_producao === true) return RESOURCE_ORIGIN.PAPEL;
  if (row.por_concessao === true) return RESOURCE_ORIGIN.CONCESSAO;
  return RESOURCE_ORIGIN.EMPRESTIMO;
}

/**
 * Os pares (tipo, id) que este ator pode REPASSAR, agrupados pela mesma chave de
 * payload dos recursos.
 *
 * O visitante de link público não tem linha em `users` e chega aqui com `userId`
 * nulo; devolver os grupos VAZIOS (e não omitir a chave) mantém o shape estável,
 * de modo que o cliente nunca precise distinguir "não pode repassar nada" de
 * "o servidor não respondeu essa parte".
 *
 * @param {string|null} userId
 * @returns {Promise<{basemaps: string[], tilesets: string[], dataLayers: string[], analysisLayers: string[], views360: string[]}>}
 */
async function listShareableOfActor(userId) {
  const vazio = Object.fromEntries(RESOURCE_TYPES.map((t) => [PAYLOAD_KEY_BY_TYPE[t], []]));
  if (!userId) return vazio;

  const { rows } = await query(Q.LIST_SHAREABLE_OF_ACTOR, [userId]);
  for (const r of rows) {
    const chave = PAYLOAD_KEY_BY_TYPE[r.resource_type];
    // Um `resource_type` fora dos cinco é impossível pelo CHECK da tabela, mas
    // um `undefined` como chave viraria um grupo fantasma no payload em vez de um
    // erro — descartar é a degradação certa aqui.
    if (chave) vazio[chave].push(r.resource_id);
  }
  return vazio;
}

/**
 * OS FATOS DE UM RECURSO numa leitura só: nível de acesso e OM dona.
 *
 * Era `accessLevelOf`, que devolvia só o nível. A OM entrou porque as quatro escritas
 * de trilha deste módulo (visibilidade, conceder, podar, purgar) passaram a carimbá-la,
 * e ler o dono numa segunda consulta seria a mesma pergunta feita duas vezes — com duas
 * respostas possíveis quando um administrador transfere `owner_org_id` no meio.
 *
 * Recurso inexistente (ou inativo) devolve `accessLevel: null`, que é como todos os
 * chamadores já liam a ausência.
 *
 * `exec` existe para o caminho da PURGA, que roda dentro da transação de quem apaga o
 * recurso: ali a leitura precisa enxergar o mesmo snapshot da escrita, e a linha está
 * prestes a deixar de existir (hard-delete do 360).
 *
 * @param {string} type
 * @param {string} resourceId
 * @param {{oneOrNone: Function}|null} [exec] - Transação a que aderir, ou nulo.
 * @returns {Promise<{accessLevel: string|null, ownerOrgId: string|null}>}
 */
async function fatosDoRecurso(type, resourceId, exec = null) {
  const table = tableOf(assertResourceType(type));
  const sql = table ? Q.getCatalogAccessLevel(table) : Q.GET_360_ACCESS_LEVEL;
  const row = exec
    ? await exec.oneOrNone(sql, [resourceId])
    : await oneOrNone(sql, [resourceId]);
  return {
    accessLevel: row ? row.access_level : null,
    ownerOrgId: row ? (row.owner_org_id ?? null) : null,
  };
}

/**
 * O gate PONTUAL: este principal enxerga este recurso? Wrapper de
 * `fn_can_see_resource`, que é COMPOSTA das outras duas — não há aqui uma segunda
 * cópia da regra.
 *
 * Recurso inexistente devolve `false`, não erro: quem chama isto está decidindo se
 * mostra ou esconde, e "não existe" e "não pode ver" precisam ser a mesma resposta
 * para não virarem um oráculo de existência.
 *
 * @returns {Promise<boolean>}
 */
export async function canSeeResource({ userId, atlasId = null, type, resourceId }) {
  const { accessLevel: level } = await fatosDoRecurso(type, resourceId);
  if (level === null) return false;
  const row = await one(Q.CAN_SEE_RESOURCE, [userId, atlasId, assertResourceType(type), resourceId, level]);
  return row.ok === true;
}

// --- concessões ------------------------------------------------------------

/** As concessões vivas do ator sobre um recurso, maior nível primeiro (D3). */
export async function liveGrantsOfActor(actorId, type, resourceId) {
  if (!actorId) return [];
  const { rows } = await query(Q.LIVE_GRANTS_OF_ACTOR, [actorId, assertResourceType(type), resourceId]);
  return rows;
}

/** As concessões vivas de um recurso, com beneficiário e concedente. */
export async function listGrantsForResource(type, resourceId) {
  const { rows } = await query(Q.LIST_GRANTS_FOR_RESOURCE, [assertResourceType(type), resourceId]);
  return rows;
}

// --- o inventário por ATOR --------------------------------------------------

/**
 * O QUE ESTE ATOR CONCEDEU, no shape do cliente.
 *
 * `granteeKind` É O DISCRIMINANTE, e ele existe porque o beneficiário é uma pessoa OU um
 * grupo (o `num_nonnulls` da tabela), nunca os dois. `granteeId` carrega o id DO QUE O
 * `granteeKind` disser: colapsar as duas colunas numa só sem o rótulo obrigaria toda
 * leitura a consultar uma segunda coluna para saber o que aquele UUID significa, e um
 * filtro por pessoa passaria a casar grupo por coincidência de id — é a mesma razão pela
 * qual a trilha de `grantResource` mantém os dois campos separados.
 *
 * @param {string} actorId
 * @returns {Promise<Array<{id: string, resourceType: string, resourceId: string,
 *   resourceName: string, granteeKind: 'user'|'group', granteeId: string,
 *   granteeName: string, level: string, expiresAt: Date, createdAt: Date}>>}
 */
export async function listGrantsIssuedByActor(actorId) {
  const { rows } = await query(Q.LIST_GRANTS_ISSUED_BY_ACTOR, [actorId]);
  return rows.map((r) => {
    const paraGrupo = r.grantee_group_id !== null;
    return {
      id: r.id,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      resourceName: r.resource_name,
      granteeKind: paraGrupo ? 'group' : 'user',
      granteeId: paraGrupo ? r.grantee_group_id : r.grantee_id,
      granteeName: paraGrupo ? r.grantee_group_name : r.grantee_nome,
      level: r.grant_level,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    };
  });
}

/**
 * O QUE ESTE ATOR RECEBEU, no shape do cliente, PELOS DOIS CAMINHOS.
 *
 * `viaGroup` é `null` na concessão direta e nomeia o coletivo quando o acesso chegou por
 * ele. Sem esse campo a pessoa não teria como saber que sair do grupo (ou o dono apagá-lo)
 * derruba aquele acesso sem que ninguém revogue nada — a delegação seria a única parte do
 * mecanismo invisível para quem depende dela.
 *
 * @param {string} actorId
 * @returns {Promise<Array<{id: string, resourceType: string, resourceId: string,
 *   resourceName: string, grantorId: string|null, grantorName: string|null, level: string,
 *   expiresAt: Date, createdAt: Date, viaGroup: {id: string, name: string}|null}>>}
 */
export async function listGrantsReceivedByActor(actorId) {
  const { rows } = await query(Q.LIST_GRANTS_RECEIVED_BY_ACTOR, [actorId]);
  return rows.map((r) => ({
    id: r.id,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    resourceName: r.resource_name,
    grantorId: r.grantor_id,
    grantorName: r.grantor_nome ?? null,
    level: r.grant_level,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    viaGroup: r.via_group_id ? { id: r.via_group_id, name: r.via_group_name } : null,
  }));
}

/**
 * ESTENDE o prazo de uma concessão viva e devolve o prazo EFETIVO.
 *
 * A RESPOSTA É O EFETIVO, NUNCA O PEDIDO, e é o ponto da rota: o pedido de 180 dias que o
 * teto do pai corta em 20 precisa voltar como 20, senão a tela afirma um prazo que o banco
 * não guardou e a pessoa descobre o corte quando o acesso cair.
 *
 * QUEM DECIDE O CORTE É O `LEAST` DENTRO DO UPDATE, e não este JavaScript. Ele mistura
 * três tetos (pedido, orçamento da linha, prazo do pai) e um deles depende de outra linha
 * do banco; calcular aqui exigiria ler o pai antes e deixaria uma janela entre a leitura e
 * a escrita. Ver o docblock de `EXTEND_GRANT`, inclusive para por que o teto da casa NÃO é
 * o mesmo literal do INSERT.
 *
 * AS DUAS RECUSAS ANTES DA ESCRITA, e nenhuma delas usa o relógio do PROCESSO:
 *   - concessão REVOGADA não se estende (seria desfazer uma revogação por uma rota de
 *     prazo). `revoked_at` é coluna, comparação sem relógio;
 *   - prazo que não passa do atual é recusado, e a comparação é entre dois instantes
 *     ABSOLUTOS (o `expires_at` que o banco acabou de devolver e a data pedida). Encurtar
 *     seria a operação perigosa: ela deixaria toda a subárvore vencendo DEPOIS do pai, e
 *     manter a invariante exigiria descer o aparo — que é a escrita que o repai da poda já
 *     paga e que esta rota não vai pagar de novo.
 *
 * A VIDA POR PRAZO É DECIDIDA PELO BANCO, no `WHERE` da própria escrita: zero linha com
 * `revoked_at` nulo só pode ser vencimento, pelo relógio de quem guarda o dado.
 *
 * @param {{grantId: string, expiresAt: string, actor: object, req: object}} params
 * @returns {Promise<{expiresAt: Date}>}
 */
export async function extendGrant({ grantId, expiresAt, actor, req }) {
  const pedido = new Date(expiresAt);

  const row = await tx(async (trx) => {
    const alvo = await trx.oneOrNone(Q.GET_GRANT, [grantId]);
    if (!alvo) throw new NotFoundError('Grant');
    if (alvo.revoked_at !== null) {
      throw new ConflictError('Esta concessão já foi revogada e não pode ser estendida.');
    }
    if (pedido.getTime() <= new Date(alvo.expires_at).getTime()) {
      throw new ConflictError('O novo prazo precisa ser posterior ao prazo atual da concessão.');
    }

    const atualizada = await trx.oneOrNone(Q.EXTEND_GRANT, [grantId, pedido.toISOString()]);
    if (!atualizada) {
      throw new ConflictError('Esta concessão já venceu; conceda o acesso novamente.');
    }

    const t = assertResourceType(atualizada.resource_type);
    const fatos = await fatosDoRecurso(t, atualizada.resource_id, trx);
    // `SHARING_CHANGE` E NÃO UMA AÇÃO PRÓPRIA, pelo mesmo raciocínio já registrado no
    // censo de auditoria para o metadado do 360: uma ação nova custaria alargar o CHECK
    // de `audit_trail.action` (DROP/ADD CONSTRAINT mais uma linha em EXCECOES_DESTRUTIVAS)
    // para dizer o que a ação existente já diz com verdade. `PERMISSION_GRANT` seria a
    // escolha ERRADA por outro motivo: ela conta concessões, e uma extensão não cria
    // nenhuma — quem contasse a ação para saber quantos acessos foram dados passaria a
    // contar a mais. O de-para dos dois prazos mora em `details`, que é onde a pergunta
    // "até quando aquele acesso valia" se responde.
    await createAudit(req, {
      action: 'SHARING_CHANGE',
      actorId: actor.id,
      targetType: assertAuditTargetTypeOfResource(t),
      targetId: atualizada.resource_id,
      targetOrgId: fatos.ownerOrgId,
      details: {
        resourceType: t,
        grantId: atualizada.id,
        grantLevel: atualizada.grant_level,
        granteeId: atualizada.grantee_id,
        granteeGroupId: atualizada.grantee_group_id,
        // O PEDIDO E O EFETIVO, os dois, e a diferença entre eles É a informação: ela é o
        // registro de que um teto incidiu, e sem ela a trilha não distingue "pediu 20
        // dias" de "pediu 180 e levou 20".
        expiresAtPedido: pedido.toISOString(),
        expiresAtAnterior: alvo.expires_at,
        expiresAt: atualizada.expires_at,
      },
    }, trx);
    return atualizada;
  });

  return { expiresAt: row.expires_at };
}

/**
 * Concede acesso a um recurso, pendurando a concessão nova na do ATOR.
 *
 * `parent_grant_id` é o que faz a árvore existir, e é fixado AQUI, no INSERT. ESTA
 * DEIXOU DE SER A ÚNICA ESCRITA DELE em 2026-08-21: a preservação de alcançabilidade
 * (`REVOKE_SUBTREE_PRESERVING_REACH`) re-pendura um filho resgatado em outro pai. O
 * argumento antigo de aciclicidade era "nenhuma rota expõe UPDATE dele", e ele CAIU —
 * não vale repeti-lo. O argumento que o substitui está por extenso no docblock daquela
 * consulta, decisão (2), e em uma frase é: o pai novo é escolhido FORA do alcance da
 * poda, e todo descendente vivo do nó re-pendurado está DENTRO dele, logo o pai novo não
 * é descendente e a aresta nova não fecha ciclo. Quem escrever a TERCEIRA escrita desta
 * coluna precisa refazer essa prova; sem ela, o teto de 32 da travessia vira a única
 * barreira entre um ciclo e um resultado parcial.
 *
 * Quem tem papel global concede de RAIZ (`parent_grant_id = NULL`): a concessão
 * dele não deriva de ninguém, então não há de quem pendurar — e é por isso que
 * revogar a concessão de um administrador não pode ser feito derrubando "o pai".
 *
 * O PRODUTOR CONCEDE DE RAIZ PELA MESMA RAZÃO, e não por analogia: ele enxerga o
 * recurso por PRODUÇÃO (`fn_can_see_resource` tem o ramo desde a baseline de acesso),
 * não por concessão, então não existe `view_share` de onde derivar. Sem este ramo ele
 * passaria pelo gate e morreria no `ForbiddenError` de baixo, com outra mensagem e a
 * mesma recusa. A consequência aceita está registrada: a concessão-raiz dele
 * SOBREVIVE à perda do escopo de produção, até o prazo, porque o predicado de leitura
 * confere a vida do BENEFICIÁRIO e nunca a do concedente — a raiz de um administrador
 * rebaixado sempre sobreviveu igual. O EMPRÉSTIMO por atlas não tem essa assimetria,
 * porque o braço D4 é reavaliado a cada leitura.
 *
 * O gate de nível é reafirmado aqui e não só no middleware, de propósito: o
 * middleware protege a ROTA, esta função protege a REGRA. Quem tem `view` não
 * concede nada; quem tem `view_share` concede `view` ou `view_share`.
 *
 * O PRAZO DO PAI VIAJA JUNTO PARA O INSERT, que é onde ele vira teto. Comparar as
 * duas datas aqui e recusar seria pior de duas maneiras: a comparação usaria o
 * relógio do processo (e o CHECK usa o do banco), e recusar transforma um pedido
 * razoável ("um ano") em erro quando o pai vence antes — o certo é entregar o que
 * dá para entregar e dizer, na resposta e na auditoria, até quando vale.
 */
export async function grantResource({
  type, resourceId, granteeId = null, granteeGroupId = null, grantLevel,
  expiresAt = null, actor, hasGlobalAccess, producesResource = false, req,
}) {
  const t = assertResourceType(type);
  // O `xor` do Joi já garante que exatamente um chegou, e o CHECK da tabela garante de
  // novo. Esta linha existe para o chamador INTERNO (teste, script), que não passa pela
  // borda HTTP e caso contrário produziria um 23514 sem relação aparente com a causa.
  if ((granteeId === null) === (granteeGroupId === null)) {
    throw new Error('grantResource: informe granteeId OU granteeGroupId, nunca os dois');
  }
  const paraGrupo = granteeGroupId !== null;

  const fatos = await fatosDoRecurso(t, resourceId);
  if (fatos.accessLevel === null) throw new NotFoundError('Resource');

  // O BENEFICIÁRIO PRECISA EXISTIR E ESTAR VIVO nos dois ramos, e "vivo" quer dizer
  // coisas diferentes: pessoa ATIVA (`is_active`) e grupo NÃO APAGADO (`deleted_at`).
  // Os dois predicados são os mesmos que a resolução usa, então uma concessão aceita
  // aqui é uma concessão que o predicado de leitura vai honrar — sem isto ela nasceria
  // morta, com 201 na resposta e acesso nenhum na prática.
  //
  // NO RAMO COLETIVO A PERGUNTA É MAIOR desde 2026-08-20: o grupo precisa ser
  // ENDEREÇÁVEL por este ator (`fn_can_administer_group`), porque conceder a um
  // coletivo que outra pessoa compõe delega a ela o poder de acrescentar beneficiários
  // ao seu recurso. O 404 é o mesmo para "não existe" e para "não é seu", pela escada
  // da casa.
  const grantee = paraGrupo
    ? await oneOrNone(Q.GET_ADDRESSABLE_LIVE_GROUP, [granteeGroupId, actor.id])
    : await oneOrNone(Q.GET_ACTIVE_USER, [granteeId]);
  if (!grantee) throw new NotFoundError(paraGrupo ? 'Access group' : 'User');
  if (!paraGrupo && granteeId === actor.id) {
    throw new ConflictError('Não é possível conceder acesso a si mesmo.');
  }

  // QUEM CONCEDE DE RAIZ, e a lista tem DOIS titulares desde 2026-08-20. O papel global
  // é fato do ATOR; a produção é fato do PAR (ator, recurso), calculado pelo gate com o
  // MESMO `:type/:id` que esta função usa. Os dois têm a mesma consequência estrutural:
  // não há concessão de onde derivar, então `parent_grant_id` fica NULL e revogar essa
  // linha não é derrubar um pai — é o caso que `revokeGrant` já cobre.
  const raiz = hasGlobalAccess === true || producesResource === true;

  let parentGrantId = null;
  let parentExpiresAt = null;
  if (!raiz) {
    const mine = await liveGrantsOfActor(actor.id, t, resourceId);
    const sharer = mine.find((g) => g.grant_level === 'view_share');
    if (!sharer) {
      throw new ForbiddenError('É preciso ter acesso com permissão de compartilhar para conceder este recurso.');
    }
    // O CASO DEGENERADO: conceder AO MESMO grupo de onde a própria autoridade veio.
    // Ele é o análogo coletivo de "conceder a si mesmo" e não é pego pela checagem de
    // duplicata (que compara `granted_by`, e o pai foi concedido por OUTRA pessoa). A
    // linha nasceria pendurada na irmã, cairia junto com ela na poda e não daria a
    // ninguém um acesso que o grupo já não tivesse — ou seja, custo sem efeito, e mais
    // uma aresta na árvore que a tela de revogação tem de explicar.
    if (paraGrupo && String(sharer.grantee_group_id ?? '') === String(granteeGroupId)) {
      throw new ConflictError('Este grupo já é a origem do seu próprio acesso a este recurso.');
    }
    parentGrantId = sharer.id;
    parentExpiresAt = sharer.expires_at ?? null;
  }

  const jaDei = paraGrupo
    ? await oneOrNone(Q.LIVE_GRANT_FROM_ACTOR_TO_GROUP, [actor.id, granteeGroupId, t, resourceId])
    : await oneOrNone(Q.LIVE_GRANT_FROM_ACTOR_TO_GRANTEE, [actor.id, granteeId, t, resourceId]);
  if (jaDei) {
    throw new ConflictError(paraGrupo
      ? 'Este grupo já recebeu acesso a este recurso de você.'
      : 'Este usuário já recebeu acesso a este recurso de você.');
  }

  return tx(async (trx) => {
    const row = await trx.one(Q.INSERT_GRANT, [
      t, resourceId, granteeId, grantLevel, actor.id, parentGrantId,
      expiresAt ?? null, parentExpiresAt, granteeGroupId,
    ]);
    await createAudit(req, {
      // O ALVO É O RECURSO, não o beneficiário, e a escolha é deliberada: o que
      // mudou foi o ACESSO A ESTA COISA, e é por ela que se investiga ("quem mexeu
      // no acesso deste tileset?"), pelo mesmo `idx_audit_target` que a auditoria de
      // zona já usa (`ZONE` + zoneId). O beneficiário desce para `details` com o
      // nome junto, para que a linha continue legível sem um JOIN.
      //
      // A escolha é a MESMA em `revokeGrant`: os dois lados de um par
      // conceder/revogar precisam apontar para o mesmo alvo, senão a história de um
      // acesso se parte em duas listas que não se cruzam.
      action: 'PERMISSION_GRANT',
      actorId: actor.id,
      targetType: assertAuditTargetTypeOfResource(t),
      targetId: resourceId,
      // A OM DONA DO RECURSO, resolvida no passo que já checou a existência dele. É o
      // que põe conceder/revogar dentro do eixo da OM: sem ela, o produtor não veria
      // quem deu acesso ao acervo que ele mantém, que é a pergunta mais provável.
      targetOrgId: fatos.ownerOrgId,
      // `expiresAt` é o prazo EFETIVO (já podado pelo teto da casa e pelo do pai),
      // não o pedido: a auditoria da expiração acontece na CONCESSÃO, porque não há
      // varredura que aplique a expiração depois — a morte mora no predicado, e sem
      // esta linha nada no registro diria até quando aquele acesso valeu.
      //
      // O BENEFICIÁRIO COLETIVO OCUPA CAMPOS PRÓPRIOS, e não os mesmos com outro
      // significado: `granteeId` continua sendo pessoa e `granteeGroupId` é grupo, os
      // dois presentes e um deles nulo, exatamente como as colunas. Reusar um campo só
      // ("granteeId, que às vezes é um grupo") obrigaria toda leitura da trilha a
      // consultar uma segunda coluna para saber o que aquele UUID significa, e um filtro
      // por pessoa passaria a casar grupos por coincidência de id.
      details: {
        resourceType: t, grantLevel, grantId: row.id, parentGrantId,
        granteeId,
        granteeUsername: paraGrupo ? null : grantee.username,
        granteeGroupId,
        granteeGroupName: paraGrupo ? grantee.name : null,
        expiresAt: row.expires_at,
      },
    }, trx);
    return row;
  });
}

/**
 * PODA N RAÍZES: revoga o que perdeu TODA autorização, REPAI-A quem ainda tem outra, e
 * APARA o prazo de quem herdou um teto mais curto.
 *
 * ESTE É O ÚNICO PONTO EM QUE A SEMÂNTICA DE QUEDA É DECIDIDA, e é por isso que ele
 * aceita N raízes em vez de uma. Cinco chamadores diferentes precisam da mesma regra hoje: a
 * revogação de uma concessão, a EXCLUSÃO de um grupo (que derruba as concessões feitas
 * àquele coletivo), a SAÍDA de um membro (que derruba o que ele alimentou através do
 * grupo), a DESATIVAÇÃO de uma conta (D8(b): a autoridade morre com quem a exercia, origem
 * `USER_DELETE`) e o REBAIXAMENTO de papel ou perda de escopo de produção, que mata o
 * fundamento em vez de quem o exercia (origem `USER_DEMOTION`). A lista viva sai de um grep
 * pelo nome da função, nunca desta prosa: ela já disse quatro depois de o quinto existir. Um
 * `WITH RECURSIVE` escrito dentro de qualquer um desses módulos seria a segunda
 * definição da regra, e a segunda é a que envelhece.
 *
 * OS LOCKS SÃO TOMADOS TODOS, ORDENADOS E UMA VEZ CADA, ANTES DE QUALQUER ESCRITA. A
 * exclusão de um grupo e a desativação de uma conta podam raízes de RECURSOS DIFERENTES
 * na mesma transação, logo N locks consultivos; duas dessas operações concorrentes que
 * tomassem o mesmo par de recursos em ordens opostas se travariam mutuamente. Ordenar
 * pela chave `tipo:recurso` dá uma ordem total, e tomar tudo antes de escrever é o que
 * torna o deadlock impossível em vez de improvável. Quem produz as raízes já ordena
 * (`ORDER BY resource_type, resource_id, id` nas três consultas que as devolvem); esta
 * função NÃO confia nisso e reordena, porque a ordem correta é a das CHAVES DE LOCK e um
 * chamador novo pode passar uma lista qualquer.
 *
 * O LOCK EXISTE POR CAUSA DO RESGATE, não da revogação. Antes dele, duas podas
 * concorrentes só se ignoravam; agora uma pode escolher como pai novo uma concessão que
 * a outra está derrubando no snapshot dela. Detalhe em `LOCK_RESOURCE_GRANTS`.
 *
 * A RAIZ PRECISA CHEGAR COM `resource_type` E `resource_id`, e não como id nu: a chave do
 * lock é o par, e resolvê-lo aqui exigiria uma leitura por raiz DEPOIS de a transação já
 * ter começado a escrever — que é exatamente a ordem que o parágrafo acima proíbe. As
 * três consultas de raiz do sistema já devolvem o par no mesmo SELECT.
 *
 * TRÊS LISTAS, TRÊS SIGNIFICADOS, e a auditoria os separa: `revoked` perdeu acesso,
 * `reparented` MANTEVE o acesso por outro caminho, `trimmed` manteve mas com prazo menor.
 * Reusar `PERMISSION_REVOKE` para os dois últimos tornaria a trilha uma afirmação falsa.
 *
 * POR QUE EXISTE LINHA DE TRILHA PARA QUEM NÃO PERDEU NADA: a pergunta que a poda tem de
 * responder deixou de ser só "por que Fulano perdeu acesso" e passou a ser também "por
 * que Fulano MANTEVE". Sem a linha, um acesso que sobrevive a uma revogação fica
 * indistinguível, no registro, de um acesso que a revogação nunca alcançou.
 *
 * `origem` DIZ POR QUE A PODA ACONTECEU, e ela é o que separa uma revogação deliberada de
 * um efeito colateral da exclusão de um grupo ou da desativação de uma conta. Sem ela, a
 * trilha registraria o dono de um grupo revogando concessões que ele nunca concedeu, e
 * nada explicaria a autoridade dele para isso. Ela vale para as TRÊS classes.
 *
 * `resgatarRaiz` SEPARA OS QUATRO CHAMADORES EM DOIS GRUPOS, e é a única diferença de
 * semântica entre eles. Em três (revogar, apagar grupo, desativar conta) a raiz é
 * PRECISAMENTE o que se mandou derrubar, e ela cai sempre — sem isso, revogar a concessão
 * de quem tem outro caminho vivo seria um no-op com 200 na resposta. No quarto (tirar um
 * membro do grupo) não se mandou derrubar concessão nenhuma: caiu um CAMINHO, e as raízes
 * são os REPASSES DO MEMBRO, que ninguém pediu para revogar. Para eles a raiz entra no
 * resgate como qualquer descendente entraria, e a decisão (1) de
 * `REVOKE_SUBTREE_PRESERVING_REACH` traz o argumento por extenso, com a alternativa
 * recusada. O default é `false` porque o caso comum é a revogação deliberada.
 *
 * A BANDEIRA NÃO ATRAVESSA A FILA. Uma raiz REENFILEIRADA pela `fronteira` é um
 * descendente cuja cadeia de justificativa já caiu, e acima do teto de 32 o desenho é
 * fail-closed de propósito, então ela volta com `false`. Na prática a combinação nem
 * ocorre (raiz resgatada deixa `podados` vazio, e sem `podados` não há fronteira), mas
 * carimbar explicitamente é o que impede a propriedade de depender dessa coincidência.
 *
 * @param {{raizes: Array<{id: string, resource_type: string, resource_id: string}>,
 *          actor: object, req: object, trx?: object|null, origem?: string|null,
 *          resgatarRaiz?: boolean}} params
 * @returns {Promise<{revoked: Array, reparented: Array, trimmed: Array}>}
 */
export async function podarPorRaizes({
  raizes, actor, req, trx = null, origem = null, resgatarRaiz = false,
}) {
  if (raizes.length === 0) return { revoked: [], reparented: [], trimmed: [] };
  for (const r of raizes) {
    if (!r?.id || !r?.resource_type || !r?.resource_id) {
      throw new Error('podarPorRaizes: cada raiz precisa de { id, resource_type, resource_id }');
    }
  }

  // As chaves de lock, ordenadas e sem repetição. `Map` e não `Set` porque o par
  // precisa sobreviver à deduplicação para virar os dois parâmetros da consulta.
  const chaves = new Map();
  for (const r of raizes) {
    chaves.set(`${r.resource_type}:${r.resource_id}`, [r.resource_type, r.resource_id]);
  }
  const ordenadas = [...chaves.keys()].sort().map((k) => chaves.get(k));

  // A OM DONA DE CADA RECURSO PODADO, resolvida UMA VEZ por recurso e não por linha:
  // uma poda de exclusão de grupo derruba dezenas de concessões espalhadas por poucos
  // recursos, e a OM é fato do RECURSO. O cache vive só nesta chamada, então ele não
  // pode servir um dono transferido no meio.
  const omPorRecurso = new Map();
  const omDe = async (t, tipo, id) => {
    const chave = `${tipo}:${id}`;
    if (!omPorRecurso.has(chave)) {
      omPorRecurso.set(chave, (await fatosDoRecurso(tipo, id, t)).ownerOrgId);
    }
    return omPorRecurso.get(chave);
  };

  const corpo = async (t) => {
    for (const [tipo, id] of ordenadas) await t.one(Q.LOCK_RESOURCE_GRANTS, [tipo, id]);

    const revoked = [];
    const reparented = [];
    const trimmed = [];

    // FILA, E NÃO LAÇO SIMPLES, porque a poda trunca em 32 níveis (a CTE `fronteira` em
    // `REVOKE_SUBTREE_PRESERVING_REACH`). Até 2026-08-21 o que passava do teto ficava
    // VIVO pendurado num pai revogado, e como o predicado de leitura nunca sobe a cadeia
    // de `parent_grant_id`, aquela pessoa mantinha o acesso depois de a raiz inteira ter
    // caído: fail-OPEN numa operação de revogação. Agora a consulta devolve a fronteira e
    // ela volta como raiz nova, até a fila esvaziar.
    //
    // O `rootGrantId` DA TRILHA CONTINUA SENDO A RAIZ ORIGINAL em todas as voltas. Quem
    // pergunta "por que Fulano perdeu acesso" precisa da revogação que alguém PEDIU, não
    // do elo intermediário que esta fila fabricou; carimbar o elo tornaria a trilha uma
    // resposta tecnicamente verdadeira e inútil.
    //
    // NÃO PRECISA DE LOCK NOVO: filho e pai são concessões do MESMO recurso (o pai vem de
    // `LIVE_GRANTS_OF_ACTOR`, que filtra por `resource_type`/`resource_id`), então a
    // chave de lock de uma raiz reenfileirada já está entre as tomadas lá em cima.
    const fila = raizes.map((r) => ({ ...r, rootId: r.id, resgatavel: resgatarRaiz === true }));

    // Backstop, não a razão de terminar. A terminação vem de duas propriedades: toda raiz
    // reenfileirada é ela mesma revogada na volta que a processa (a âncora está sempre em
    // `podados`), e um nó revogado nunca reaparece como fronteira, porque os dois braços
    // que o alcançariam cobram `revoked_at IS NULL` e enxergam a escrita da volta anterior
    // na mesma transação. Logo `reenfileiradas <= revoked.length`, e o conjunto é finito.
    // O teto existe para que um defeito futuro apareça como erro em vez de laço infinito
    // segurando os locks consultivos da transação.
    const MAX_REENFILEIRADAS = 100000;
    let reenfileiradas = 0;

    while (fila.length > 0) {
      const raiz = fila.shift();
      const linhas = await t.any(
        Q.REVOKE_SUBTREE_PRESERVING_REACH, [raiz.id, actor.id, raiz.resgatavel === true]
      );
      for (const l of linhas) {
        if (l.acao === 'frontier') {
          reenfileiradas += 1;
          if (reenfileiradas > MAX_REENFILEIRADAS) {
            throw new Error(
              `podarPorRaizes: a fronteira não convergiu em ${MAX_REENFILEIRADAS} reenfileiramentos`
            );
          }
          fila.push({
            id: l.id,
            resource_type: l.resource_type,
            resource_id: l.resource_id,
            rootId: raiz.rootId,
            // NUNCA `raiz.resgatavel`: ver o docblock. A fronteira é descendente de uma
            // cadeia que já caiu, e acima do teto o desenho é fail-closed.
            resgatavel: false,
          });
          continue;
        }
        const alvo = {
          targetType: assertAuditTargetTypeOfResource(l.resource_type),
          targetId: l.resource_id,
          targetOrgId: await omDe(t, l.resource_type, l.resource_id),
        };
        if (l.acao === 'revoked') {
          await createAudit(req, {
            // O RECURSO É O ALVO, igual ao `PERMISSION_GRANT` — ver a nota lá. UMA LINHA
            // POR CONCESSÃO DERRUBADA continua valendo: aqui cada linha é sobre uma
            // PESSOA (ou um COLETIVO) que perdeu acesso, e é o que responde "por que
            // Fulano perdeu acesso" quando ele caiu por poda da subárvore e não por
            // revogação direta.
            action: 'PERMISSION_REVOKE',
            actorId: actor.id,
            ...alvo,
            details: {
              resourceType: l.resource_type,
              granteeId: l.grantee_id,
              granteeGroupId: l.grantee_group_id,
              grantId: l.id,
              parentGrantId: l.pai_antigo,
              rootGrantId: raiz.rootId,
              ...(origem ? { origem } : {}),
            },
          }, t);
          revoked.push(l);
        } else {
          const repai = l.acao === 'reparented';
          await createAudit(req, {
            action: 'PERMISSION_REPARENT',
            actorId: actor.id,
            ...alvo,
            details: {
              // `kind` DISCRIMINA OS DOIS EFEITOS de uma ação só: o nó que trocou de pai
              // e o descendente dele que só herdou um teto de prazo menor. Ver o BLOCO E
              // de `002_auditoria.sql` para o porquê de não serem duas ações.
              kind: repai ? 'reparent' : 'prazo_herdado',
              resourceType: l.resource_type,
              granteeId: l.grantee_id,
              granteeGroupId: l.grantee_group_id,
              grantId: l.id,
              parentGrantIdAnterior: l.pai_antigo,
              parentGrantId: repai ? l.novo_pai : l.pai_antigo,
              expiresAtAnterior: l.prazo_antigo,
              expiresAt: l.prazo_novo,
              rootGrantId: raiz.rootId,
              ...(origem ? { origem } : {}),
            },
          }, t);
          (repai ? reparented : trimmed).push(l);
        }
      }
    }
    return { revoked, reparented, trimmed };
  };

  return trx ? corpo(trx) : tx(corpo);
}

/**
 * D8(b): DESATIVAR UMA CONTA DERRUBA O QUE ELA CONCEDEU.
 *
 * A autoridade morre com quem a exercia. Até 2026-08-21 desativar quem concedeu não
 * propagava para o que ele concedeu, e o motivo era estrutural: a cascata derruba filhos
 * quando o PAI é revogado, e a concessão de quem tem papel global (ou de quem produz) é
 * RAIZ, sem pai — não havia por onde propagar.
 *
 * ESTE É O LADO DA ESCRITA DE UM PAR, e a divisão de trabalho importa. O lado do
 * PREDICADO (`fn_granted_resource_ids`, D8(b)) esconde imediatamente a linha cujo
 * concedente morreu, alcança a desativação de ORGANIZAÇÃO — que não passa por aqui — e é
 * REVERSÍVEL: reativar devolve o acesso. Este lado é o que alcança DESCENDENTE e o único
 * que dispara o repai; em compensação ele é DEFINITIVO, porque `revoked_at` não se
 * desfaz. Reativar uma conta NÃO ressuscita o que ela concedeu, e essa consequência foi
 * aceita de olhos abertos: não há transferência automática de autoridade, e quem
 * desativar uma conta que concedeu muito deve reconceder antes.
 *
 * ROda na TRANSAÇÃO de quem desativa (`trx` obrigatório): se a desativação der rollback,
 * a poda tem de voltar junto, senão a conta continua ativa e o acesso que ela concedeu
 * desapareceu.
 *
 * O CONJUNTO DE RAÍZES É LIDO ANTES DOS LOCKS, e isso é estrutural: as chaves de lock
 * DERIVAM das raízes, então não há como travar antes de saber o que travar. A janela é
 * estreita e o que sobra dela é benigno hoje, mas escreva-a em vez de supor: uma
 * concessão criada por esta pessoa entre a leitura das raízes e o commit escapa da poda.
 * Ela NÃO entrega acesso (o predicado de leitura a esconde, porque `granted_by` já está
 * morto) e o beneficiário dela NÃO consegue repassá-la adiante (desde 2026-08-21
 * `LIVE_GRANTS_OF_ACTOR` cobra o mesmo termo), então o resíduo é uma linha viva e inerte,
 * com a mesma semântica reversível da desativação de OM. Fechá-la de vez exigiria um lock
 * sobre o USUÁRIO, tomado também no caminho de `grantResource`, e isso põe um lock num
 * caminho quente para cobrir uma janela de milissegundos: não foi feito.
 *
 * O AVISO AO VIVO NÃO SAI DAQUI, e não é esquecimento: esta função roda DENTRO da transação
 * de quem desativa, e um frame emitido antes do commit manda o receptor re-pedir o payload
 * de um estado que ainda não existe — ele leria o velho e não receberia um segundo aviso.
 * Quem chama (`deleteUser`) avisa com o `revoked` devolvido aqui, depois do commit.
 *
 * @param {{userId: string, actor: object, req: object, trx: object}} params
 * @returns {Promise<{revoked: Array, reparented: Array, trimmed: Array}>}
 */
export async function podarConcessoesDeQuemFoiDesativado({ userId, actor, req, trx }) {
  const raizes = await trx.any(Q.LIVE_GRANT_IDS_BY_GRANTER, [userId]);
  return podarPorRaizes({ raizes, actor, req, trx, origem: 'USER_DELETE' });
}

/**
 * Revoga uma concessão, podando o que perdeu toda autorização e preservando o resto.
 *
 * Invólucro de UMA raiz sobre {@link podarPorRaizes}. Revogar duas vezes devolve as três
 * listas vazias em vez de erro: `revoked_at IS NULL` no âncora da CTE torna a operação
 * idempotente, e a data da PRIMEIRA revogação é a que vale.
 *
 * O `GET_GRANT` roda DENTRO da transação, e não antes dela: o lock consultivo é por
 * (tipo, recurso) e precisa do par que só esta leitura conhece, e tomar o lock numa
 * transação diferente da que escreve não serializa coisa nenhuma.
 *
 * O AVISO AO VIVO SUBIU DO CONTROLLER PARA CÁ (2026-08-24), e a mudança é o que torna a
 * regra dizível numa frase só: quem ABRE a transação avisa DEPOIS do commit dela. Enquanto
 * o aviso morava no controller, essa frase não podia valer para os outros quatro podadores,
 * porque nenhum deles passa por um controller de resource-access.
 *
 * @returns {Promise<{revoked: Array, reparented: Array, trimmed: Array}>}
 */
export async function revokeGrant({ grantId, actor, req }) {
  const podada = await tx(async (trx) => {
    const alvo = await trx.oneOrNone(Q.GET_GRANT, [grantId]);
    if (!alvo) throw new NotFoundError('Grant');
    return podarPorRaizes({ raizes: [alvo], actor, req, trx });
  });
  await avisarAtlasQueEmprestam(podada);
  return podada;
}

// --- empréstimo por atlas --------------------------------------------------

/**
 * O que este atlas empresta (vivos), com o nome legível e o nível de acesso de cada um.
 *
 * O item é `{ id, resource_type, resource_id, added_by, added_at, added_by_username,
 * name, access_level }`. Os dois últimos nasceram para a cláusula 6.6: ao ativar o link
 * público, a tela NOMEIA os privados que o atlas empresta, porque o empréstimo ao
 * visitante foi mantido e quem resolve é o consentimento informado.
 *
 * `name` e `access_level` são NULOS no empréstimo órfão (a linha de catálogo não existe
 * mais), e o órfão continua na lista: ver o JSDoc de `LIST_ATLAS_RESOURCES`. Quem
 * consome precisa tratar o nulo, e o tratamento certo é dizer que não dá para nomear
 * aquele vínculo — nunca escondê-lo.
 *
 * @returns {Promise<Array>}
 */
export async function listAtlasResources(atlasId) {
  const { rows } = await query(Q.LIST_ATLAS_RESOURCES, [atlasId]);
  return rows;
}

/**
 * A pergunta inversa de {@link listAtlasResources}: que atlas emprestam este recurso.
 *
 * MORA EM `resource-access.notify.js` e é reexportada daqui. Ela existe para ENDEREÇAR
 * SALA, que é o assunto daquele módulo, e ele precisa ser a FOLHA (este arquivo o importa
 * para avisar depois de podar). Definí-la aqui e importá-la lá fecharia um ciclo entre os
 * dois; copiá-la seria a segunda definição da mesma consulta. A reexportação é o que
 * mantém o caminho de import de quem já a usa.
 */
export { atlasesLendingResource };

/**
 * QUANTOS atlas emprestam este recurso agora. A mesma pergunta acima, CONTADA.
 *
 * POR QUE ELA EXISTE, e o defeito que fecha é de TELA. A lista "quem tem acesso"
 * (`GET /:type/:id/grants`) lê `resource_grants` e só, enquanto o predicado entrega o
 * recurso também a quem abre um atlas que o empresta — inclusive ao visitante de link
 * público, que não tem conta para aparecer em lista nenhuma. A tela avisava disso, e
 * avisava QUALITATIVAMENTE, porque a informação existia só como endereço de sala de WS,
 * sem gate: um número inventado ali seria pior que a frase sem número. Com a rota, quem
 * decide revogar sabe se o outro caminho está aberto em UM atlas ou em quinze.
 *
 * CONTA A LISTA, E NÃO UM `COUNT(*)` PRÓPRIO. Um segundo SQL sobre `atlas_resources`
 * teria de repetir os dois filtros de vivacidade (`removed_at`, `deleted_at` do atlas) e
 * poderia divergir daquele — e a divergência seria a pior possível para esta tela: um
 * número que discorda de quem o aviso ao vivo acorda. O conjunto é pequeno por construção
 * (atlas que emprestam UM recurso), então materializá-lo custa o mesmo que contá-lo.
 *
 * A ROTA DEVOLVE SÓ O NÚMERO, e os ids morrem aqui dentro: quais atlas emprestam é fato
 * sobre projetos de terceiros, e quem pode compartilhar um recurso não herda por isso o
 * direito de enumerar os atlas alheios que o usam.
 *
 * @param {string} type - Tipo de recurso já validado pela borda.
 * @param {string} resourceId
 * @returns {Promise<number>}
 */
export async function countAtlasesLendingResource(type, resourceId) {
  return (await atlasesLendingResource(assertResourceType(type), resourceId)).length;
}

/**
 * Anexa um recurso ao atlas: ele passa a EMPRESTAR acesso, no escopo dele.
 *
 * O GATE É DUPLO e os dois lados são necessários: `manage` no atlas (quem pode
 * configurá-lo) E ver o recurso (para que um co-Gestor não empreste por adivinhação
 * de id um recurso que ele mesmo não pode abrir). O segundo mora no middleware
 * `assertCanSeeResource`, porque é ele que responde 404 — e 404, não 403, para que
 * um recurso invisível seja indistinguível de um inexistente.
 *
 * O que SUSTENTA o empréstimo depois de criado é outra condição, e é de propósito
 * que ela não seja esta: D4 diz que ele vive enquanto o DONO do atlas vir o
 * recurso, e essa checagem mora dentro de `fn_granted_resource_ids`, avaliada a
 * cada leitura. Aqui só se valida quem anexa.
 */
export async function attachAtlasResource({ atlasId, type, resourceId, actor, req }) {
  const t = assertResourceType(type);
  if ((await fatosDoRecurso(t, resourceId)).accessLevel === null) throw new NotFoundError('Resource');

  return tx(async (trx) => {
    const row = await trx.oneOrNone(Q.ATTACH_ATLAS_RESOURCE, [atlasId, t, resourceId, actor.id]);
    if (!row) throw new ConflictError('Este recurso já está emprestado por este atlas.');
    await createAudit(req, {
      action: 'SHARING_CHANGE',
      actorId: actor.id,
      targetType: 'ATLAS',
      targetId: atlasId,
      details: { attached: { resourceType: t, resourceId } },
    }, trx);
    return row;
  });
}

/**
 * Desfaz o empréstimo (soft). Não exige ver o recurso: quem tem `manage` no atlas
 * precisa poder RETIRAR o que outro Gestor anexou, inclusive um recurso que ele
 * mesmo não enxerga — exigir visibilidade aqui deixaria o empréstimo preso.
 */
export async function detachAtlasResource({ atlasId, type, resourceId, actor, req }) {
  const t = assertResourceType(type);
  return tx(async (trx) => {
    const row = await trx.oneOrNone(Q.DETACH_ATLAS_RESOURCE, [atlasId, t, resourceId, actor.id]);
    if (!row) throw new NotFoundError('Atlas resource');
    await createAudit(req, {
      action: 'SHARING_CHANGE',
      actorId: actor.id,
      targetType: 'ATLAS',
      targetId: atlasId,
      details: { detached: { resourceType: t, resourceId } },
    }, trx);
    return row;
  });
}

/**
 * Apaga concessões e empréstimos de um recurso, NA TRANSAÇÃO DO CHAMADOR (R6).
 *
 * Existe para o único hard-delete do sistema, `DELETE /sv360/admin/projects/:slug`
 * — o plano de origem dizia `sv360.write.service.js` e estava errado; quem apaga é
 * `deleteProject` em `sv360.admin.service.js`. Recebe o `trx` porque uma limpeza
 * fora da transação sobrevive ao rollback do projeto.
 *
 * ESTA FUNÇÃO FICOU SEM CHAMADOR NENHUM POR UMA FASE INTEIRA, enquanto o comentário
 * que introduziu `resource_grants` afirmava por escrito que `deleteProject` a chamava na mesma
 * transação. Não chamava: apagar um projeto 360 deixava `resource_grants` e
 * `atlas_resources` apontando para um UUID que não existia mais. A ligação foi
 * feita em `deleteProject`, e é ela que dá sentido à trilha abaixo.
 *
 * UMA LINHA POR CONCESSÃO E UMA POR EMPRÉSTIMO, e não uma linha com contagens: este
 * é o ÚNICO hard-delete do sistema, então depois do COMMIT não existe mais nada de
 * onde reconstruir quem tinha acesso ao recurso apagado. Uma linha por vínculo é a
 * última fotografia possível — a mesma razão de `revokeGrant` emitir por concessão
 * podada, e aqui o argumento é mais forte, porque lá a linha sobrevive com
 * `revoked_at`.
 *
 * ANTES do DELETE do recurso e DENTRO da transação do chamador: fora dela, uma
 * ingestão que falhasse depois deixaria a trilha afirmando uma destruição que o
 * rollback desfez.
 *
 * @param {object} trx - A transação de quem está apagando.
 * @param {string} type - Tipo de recurso (whitelist).
 * @param {string} resourceId
 * @param {string|null} [actorId] - Quem disparou a exclusão do recurso.
 * @param {object} [req] - Express req, para ip/user-agent.
 * @returns {Promise<{grants: number, atlasLinks: number}>}
 */
export async function purgeResourceLinks(trx, type, resourceId, actorId = null, req = null) {
  const t = assertResourceType(type);
  const alvo = assertAuditTargetTypeOfResource(t);
  // A OM DONA É LIDA ANTES DA DESTRUIÇÃO E DENTRO DA MESMA TRANSAÇÃO, e é aqui que a
  // coluna denormalizada se paga: o único hard-delete do sistema apaga a linha do
  // projeto logo em seguida, então depois do commit não existe mais de onde tirá-la.
  // Uma junta na leitura devolveria NULL exatamente para o evento que mais importa.
  const { ownerOrgId } = await fatosDoRecurso(t, resourceId, trx);
  const grants = await trx.any(Q.PURGE_GRANTS_OF_RESOURCE, [t, resourceId]);
  const links = await trx.any(Q.PURGE_ATLAS_LINKS_OF_RESOURCE, [t, resourceId]);

  if (actorId) {
    for (const g of grants) {
      await createAudit(req, {
        action: 'PERMISSION_PURGE',
        actorId,
        targetType: alvo,
        targetId: resourceId,
        targetOrgId: ownerOrgId,
        details: {
          kind: 'grant',
          resourceType: t,
          grantId: g.id,
          granteeId: g.grantee_id,
          granteeGroupId: g.grantee_group_id,
          grantedBy: g.granted_by,
          grantLevel: g.grant_level,
          parentGrantId: g.parent_grant_id,
          // `wasLive` separa a concessão que ainda valia da que já estava revogada
          // ou vencida: só a primeira significa que alguém perdeu acesso agora.
          wasLive: g.revoked_at === null,
        },
      }, trx);
    }
    for (const l of links) {
      await createAudit(req, {
        action: 'PERMISSION_PURGE',
        actorId,
        targetType: alvo,
        targetId: resourceId,
        targetOrgId: ownerOrgId,
        details: {
          kind: 'atlas_link',
          resourceType: t,
          atlasResourceId: l.id,
          atlasId: l.atlas_id,
          addedBy: l.added_by,
          wasLive: l.removed_at === null,
        },
      }, trx);
    }
  }

  return { grants: grants.length, atlasLinks: links.length };
}

// --- classificação em LOTE (poda de clone e de import) ----------------------

/**
 * Este destinatário enxerga cada uma destas referências?
 *
 * A ENTRADA É UMA LISTA DE PARES `(type, resourceId)` e a saída é um `Map` da mesma
 * chave para booleano. Uma ida ao banco para a classificação e, no máximo, uma segunda
 * para traduzir referências 360 — nunca uma por referência: o custo do clone precisa
 * continuar independente do tamanho do atlas (`atlas-clone-import-n1.repro.test.js`).
 *
 * O 360 TEM DUAS ETAPAS porque a referência guardada não é o id do projeto: é o nome da
 * foto (ou o slug, ou o nome do projeto, ou o id da foto de entrada). `RESOLVE_SV360_REFS`
 * traduz o que conseguir; o que não traduzir nunca chega ao predicado e sai como NÃO
 * visível, sem uma segunda consulta e sem virar oráculo de existência.
 *
 * ACEITA O CONTEXTO DE TRANSAÇÃO de propósito: classificar fora da transação e escrever
 * dentro deixa uma janela entre as duas: uma concessão revogada no meio produziria uma
 * cópia com o recurso que a revogação acabou de tirar.
 *
 * @param {Object} params
 * @param {string|null} params.userId - O DESTINATÁRIO (novo dono / importador).
 * @param {Array<{type: string, resourceId: string}>} params.refs
 * @param {Object} [params.t] - Contexto de transação; `null` usa o pool.
 * @returns {Promise<Map<string, boolean>>} Chave `resourceRefKey(type, resourceId)`.
 */
export async function classifyResourceRefs({ userId, refs, t = null }) {
  const visiveis = new Map();
  const distintos = new Map();
  for (const ref of refs || []) {
    if (!ref || typeof ref.resourceId !== 'string' || ref.resourceId === '') continue;
    distintos.set(resourceRefKey(assertResourceType(ref.type), ref.resourceId), ref);
  }
  if (distintos.size === 0) return visiveis;

  const executar = t
    ? (sql, params) => t.any(sql, params)
    : async (sql, params) => (await query(sql, params)).rows;

  // Etapa 1: nome de foto / slug / nome de projeto -> id do projeto.
  const refs360 = [...distintos.values()].filter((r) => r.type === 'sv360_project');
  const projetoDe = new Map();
  if (refs360.length > 0) {
    const linhas = await executar(
      Q.RESOLVE_SV360_REFS, [refs360.map((r) => r.resourceId), userId ?? null]
    );
    for (const linha of linhas) projetoDe.set(linha.ref, linha.project_id);
  }

  // Etapa 2: o predicado, uma linha por referência. As 360 não resolvidas ficam de fora
  // da consulta e o `Map` já as devolve como ausentes, que o chamador lê como não visível.
  const tipos = [];
  const ids = [];
  // UM alvo pode ser a traducao de VARIAS referencias (duas fotos do mesmo projeto 360),
  // entao o valor e uma LISTA de chaves de origem. Com um valor escalar, so a ultima
  // referencia recebia veredito e as anteriores caiam no fecha-fechado do fim: um projeto
  // 360 publico perdia todas as fotos menos uma, silenciosamente.
  const origemDe = new Map();
  for (const [chave, ref] of distintos) {
    const alvo = ref.type === 'sv360_project' ? projetoDe.get(ref.resourceId) : ref.resourceId;
    if (!alvo) { visiveis.set(chave, false); continue; }
    const alvoChave = resourceRefKey(ref.type, alvo);
    if (!origemDe.has(alvoChave)) {
      origemDe.set(alvoChave, []);
      tipos.push(ref.type);
      ids.push(alvo);
    }
    origemDe.get(alvoChave).push(chave);
  }

  if (tipos.length > 0) {
    const linhas = await executar(Q.CLASSIFY_RESOURCE_REFS, [userId ?? null, tipos, ids]);
    for (const linha of linhas) {
      for (const chave of origemDe.get(resourceRefKey(linha.tipo, linha.rid)) ?? []) {
        visiveis.set(chave, linha.ok === true);
      }
    }
  }

  // O que a consulta não respondeu (não deveria acontecer) fecha FECHADO.
  for (const chave of distintos.keys()) {
    if (!visiveis.has(chave)) visiveis.set(chave, false);
  }
  return visiveis;
}
