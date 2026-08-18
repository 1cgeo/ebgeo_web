// Path: src/modules/resource-access/resource-access.types.js
// O vocabulário dos CINCO tipos de recurso que carregam marca de acesso, e a
// barreira que os separa do SQL.
//
// Este arquivo é o análogo de `catalog.tables.js` e existe pela MESMA razão: o
// nome da tabela vai INTERPOLADO na consulta (pg não liga nome de tabela como
// parâmetro), então ele nunca pode vir do request sem passar por uma whitelist.
// A diferença é que aqui o vocabulário é o do DOMÍNIO (`tileset`,
// `sv360_project`), não o da tabela, porque é ele que viaja no `CHECK` de
// `resource_grants.resource_type`, na URL das rotas e no payload do cliente.
//
// As quatro tabelas de catálogo e `sv360.projects` NÃO são intercambiáveis: só as
// quatro primeiras respondem ao `listCatalog` genérico, e o 360 tem chave UUID
// contra o slug textual das outras. `tableOf` devolve null para o 360 de
// propósito, para que um chamador que o trate como catálogo quebre alto em vez
// de montar um SQL sem sentido.

/**
 * Os cinco tipos, na ordem do CHECK vigente (017, alargado pela 021).
 *
 * `basemap` entrou na 021. A camada de base já tinha `access_level` desde a 017 e
 * o filtro público-por-padrão de `catalog.service.js` já a fechava; o que faltava
 * era o outro sentido — sem tipo de concessão, nem concessão pessoal nem
 * empréstimo por atlas conseguiam DEVOLVER um basemap privado a quem tem direito.
 * Era meia regra: fechava e não abria.
 */
export const RESOURCE_TYPES = Object.freeze([
  'basemap',
  'tileset',
  'data_layer',
  'analysis_layer',
  'sv360_project',
]);

/** Tipo de domínio -> tabela de catálogo. `sv360_project` não é catálogo. */
const TABLE_BY_TYPE = Object.freeze({
  basemap: 'basemaps',
  tileset: 'tilesets',
  data_layer: 'data_layers',
  analysis_layer: 'analysis_layers',
  sv360_project: null,
});

/**
 * Tabela de catálogo -> tipo de domínio. A INVERSA de TABLE_BY_TYPE, e agora para
 * AS QUATRO tabelas de catálogo.
 *
 * Esta prosa dizia, até a 021, que `basemaps` carregava `access_level` "por
 * paridade de schema e nunca a consultava". Era falso nos dois sentidos:
 * `listCatalog('basemaps')` sem `visibleTo` (os dois sítios de `/api/config`) já
 * aplicava `access_level = 'public'`, e a rota crua já aplicava o ramo de
 * produção. O que de fato faltava era a ENTRADA AQUI, sem a qual `resourceType`
 * chegava nulo ao predicado e o ramo de `fn_granted_resource_ids` era o único que
 * não era montado.
 */
export const TYPE_BY_TABLE = Object.freeze({
  basemaps: 'basemap',
  tilesets: 'tileset',
  data_layers: 'data_layer',
  analysis_layers: 'analysis_layer',
});

/**
 * Tipo de domínio -> `audit_trail.target_type` (migração 020).
 *
 * ANTES DA 020 ESTE MAPA NÃO PODIA EXISTIR: o CHECK de `target_type` só conhecia
 * USER/GROUP/MODEL/ZONE/SYSTEM/ATLAS/ORG, e é por isso que a auditoria de
 * visibilidade e de concessão gravava 'SYSTEM' com o recurso escondido em `details`
 * — o que deixava `idx_audit_target` mudo para a pergunta "o que já foi feito com
 * este recurso". Com o CHECK alargado e `target_id` em TEXT (o id de catálogo é
 * slug), o alvo volta a ser coluna.
 *
 * Um valor fora do CHECK levanta 23514 no INSERT da trilha; como a auditoria de
 * concessão é TRANSACIONAL, isso derrubaria a concessão junto. Por isso a whitelist.
 */
export const AUDIT_TARGET_TYPE_BY_TYPE = Object.freeze({
  basemap: 'BASEMAP',
  tileset: 'TILESET',
  data_layer: 'DATA_LAYER',
  analysis_layer: 'ANALYSIS_LAYER',
  sv360_project: 'SV360_PROJECT',
});

/**
 * O `target_type` de auditoria de um tipo de recurso, validado.
 * @param {string} type
 * @returns {string}
 * @throws {Error} Quando o tipo está fora da whitelist.
 */
export function assertAuditTargetTypeOfResource(type) {
  const alvo = AUDIT_TARGET_TYPE_BY_TYPE[assertResourceType(type)];
  if (!alvo) {
    throw new Error(`Resource type without audit target type: ${type}`);
  }
  return alvo;
}

/**
 * Tipo de domínio -> chave do payload aditivo servido ao cliente.
 *
 * A chave `basemaps` do payload aditivo é um ARRAY, e a homônima de `/api/config`
 * é um OBJETO indexado por id. Não é descuido: o payload aditivo é uma lista de
 * itens por grupo (é assim que `tilesets`/`dataLayers`/`analysisLayers` já viajam)
 * e quem reprojeta para a forma do `config` é o cliente, em
 * `atlas-settings.service.js`.
 */
export const PAYLOAD_KEY_BY_TYPE = Object.freeze({
  basemap: 'basemaps',
  tileset: 'tilesets',
  data_layer: 'dataLayers',
  analysis_layer: 'analysisLayers',
  sv360_project: 'views360',
});

/**
 * Whitelist de tipo. Lança quando o valor não é um dos cinco — o retorno é
 * usado para escolher nome de tabela, então um `includes` esquecido aqui é
 * injeção de SQL, não um 400 feio.
 * @param {string} type
 * @returns {string} O próprio tipo, validado.
 * @throws {Error} Quando o tipo está fora da whitelist.
 */
export function assertResourceType(type) {
  if (!RESOURCE_TYPES.includes(type)) {
    throw new Error(`Unknown resource type: ${type}`);
  }
  return type;
}

/**
 * A tabela de CATÁLOGO de um tipo, já validada, ou null para `sv360_project`.
 * @param {string} type
 * @returns {string|null}
 */
export function tableOf(type) {
  return TABLE_BY_TYPE[assertResourceType(type)];
}

/**
 * A tabela de catálogo de um tipo, exigindo que ela exista. Use nos caminhos que
 * SÓ sabem falar com as quatro tabelas de catálogo.
 * @param {string} type
 * @returns {string}
 * @throws {Error} Para `sv360_project`, que não é catálogo.
 */
export function assertCatalogTableOf(type) {
  const table = tableOf(type);
  if (!table) {
    throw new Error(`Resource type ${type} is not a catalog table`);
  }
  return table;
}
