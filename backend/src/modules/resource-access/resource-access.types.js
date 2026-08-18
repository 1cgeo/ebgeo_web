// Path: src/modules/resource-access/resource-access.types.js
// O vocabulário dos QUATRO tipos de recurso que carregam marca de acesso, e a
// barreira que os separa do SQL.
//
// Este arquivo é o análogo de `catalog.tables.js` e existe pela MESMA razão: o
// nome da tabela vai INTERPOLADO na consulta (pg não liga nome de tabela como
// parâmetro), então ele nunca pode vir do request sem passar por uma whitelist.
// A diferença é que aqui o vocabulário é o do DOMÍNIO (`tileset`,
// `sv360_project`), não o da tabela, porque é ele que viaja no `CHECK` de
// `resource_grants.resource_type`, na URL das rotas e no payload do cliente.
//
// As três tabelas de catálogo e `sv360.projects` NÃO são intercambiáveis: só as
// três primeiras respondem ao `listCatalog` genérico, e o 360 tem chave UUID
// contra o slug textual das outras. `tableOf` devolve null para o 360 de
// propósito, para que um chamador que o trate como catálogo quebre alto em vez
// de montar um SQL sem sentido.

/** Os quatro tipos, na mesma ordem do CHECK da migração 017. */
export const RESOURCE_TYPES = Object.freeze([
  'tileset',
  'data_layer',
  'analysis_layer',
  'sv360_project',
]);

/** Tipo de domínio -> tabela de catálogo. `sv360_project` não é catálogo. */
const TABLE_BY_TYPE = Object.freeze({
  tileset: 'tilesets',
  data_layer: 'data_layers',
  analysis_layer: 'analysis_layers',
  sv360_project: null,
});

/**
 * Tabela de catálogo -> tipo de domínio. A INVERSA de TABLE_BY_TYPE, e só para as
 * três que participam do eixo.
 *
 * `basemaps` e `streetview_markers` estão AUSENTES de propósito: elas carregam a
 * coluna `access_level` por paridade de schema e nunca a consultam, então o
 * controller as trata como "sem eixo de acesso" e cai no ramo público-por-padrão.
 * Um `undefined` aqui é a resposta correta, não um buraco.
 */
export const TYPE_BY_TABLE = Object.freeze({
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

/** Tipo de domínio -> chave do payload aditivo servido ao cliente. */
export const PAYLOAD_KEY_BY_TYPE = Object.freeze({
  tileset: 'tilesets',
  data_layer: 'dataLayers',
  analysis_layer: 'analysisLayers',
  sv360_project: 'views360',
});

/**
 * Whitelist de tipo. Lança quando o valor não é um dos quatro — o retorno é
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
 * SÓ sabem falar com as três tabelas de catálogo.
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
