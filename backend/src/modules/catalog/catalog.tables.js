// Path: src/modules/catalog/catalog.tables.js
// The dedicated catalog tables (one per resource type). Whitelist — used to guard the table name
// before it is interpolated into SQL (pg cannot bind a table name as a parameter).

export const CATALOG_TABLES = Object.freeze([
  'basemaps',
  'data_layers',
  'analysis_layers',
  'tilesets',
  'streetview_markers',
]);

export function assertTable(table) {
  if (!CATALOG_TABLES.includes(table)) {
    throw new Error(`Unknown catalog table: ${table}`);
  }
  return table;
}

/**
 * Tabela de catálogo -> tipo aceito por `fn_can_produce_resource`. AS CINCO.
 *
 * DELIBERADAMENTE DISTINTO de `RESOURCE_TYPES` (resource-access.types.js), que tem
 * QUATRO valores e é o vocabulário do `CHECK` de `resource_grants.resource_type`.
 * Os dois eixos não coincidem e conflatá-los é o erro que faz `POST /basemaps`
 * responder 500: `basemaps` e `streetview_markers` não recebem concessão
 * individual, mas TÊM OM produtora (`owner_org_id` nas cinco, por paridade de
 * schema) e portanto participam do eixo de PRODUÇÃO.
 */
export const PRODUCTION_TYPE_BY_TABLE = Object.freeze({
  basemaps: 'basemap',
  data_layers: 'data_layer',
  analysis_layers: 'analysis_layer',
  tilesets: 'tileset',
  streetview_markers: 'streetview_marker',
});

/**
 * O tipo de produção de uma tabela de catálogo, validado.
 *
 * Existe pela MESMA razão de `assertTable`: o valor vai para
 * `fn_can_produce_resource`, cujo `CASE` levanta para tipo fora da whitelist. O
 * nome nunca vem do request — vem da tabela com que o router foi fabricado.
 * @param {string} table
 * @returns {string}
 * @throws {Error} Para tabela fora da whitelist.
 */
export function assertProductionTypeOf(table) {
  const tipo = PRODUCTION_TYPE_BY_TABLE[assertTable(table)];
  if (!tipo) {
    throw new Error(`Catalog table without production type: ${table}`);
  }
  return tipo;
}

/**
 * Tabela de catálogo -> `audit_trail.target_type`. AS CINCO, e um TERCEIRO
 * vocabulário: nem o das tabelas, nem o do `CHECK` de `resource_grants`.
 *
 * Mora AQUI, ao lado da whitelist que já mapeia tabela para tipo de produção, e não
 * num objeto solto no controller: os três mapas envelhecem juntos, e uma tabela nova
 * que apareça em um e não nos outros é o defeito que separá-los produz.
 *
 * Os valores são os declarados no `CHECK` de `audit_trail.target_type` pela migração
 * 020; um valor fora dele levanta 23514 no INSERT da trilha, o que derrubaria a
 * escrita inteira quando a auditoria é transacional.
 */
export const AUDIT_TARGET_TYPE_BY_TABLE = Object.freeze({
  basemaps: 'BASEMAP',
  data_layers: 'DATA_LAYER',
  analysis_layers: 'ANALYSIS_LAYER',
  tilesets: 'TILESET',
  streetview_markers: 'STREETVIEW_MARKER',
});

/**
 * O `target_type` de auditoria de uma tabela de catálogo, validado.
 * @param {string} table
 * @returns {string}
 * @throws {Error} Para tabela fora da whitelist ou sem alvo declarado.
 */
export function assertAuditTargetTypeOf(table) {
  const alvo = AUDIT_TARGET_TYPE_BY_TABLE[assertTable(table)];
  if (!alvo) {
    throw new Error(`Catalog table without audit target type: ${table}`);
  }
  return alvo;
}
