// Path: src/modules/catalog/catalog.tables.js
// The dedicated catalog tables (one per resource type). Whitelist — used to guard the table name
// before it is interpolated into SQL (pg cannot bind a table name as a parameter).

export const CATALOG_TABLES = Object.freeze([
  'basemaps',
  'data_layers',
  'analysis_layers',
  'tilesets',
]);

export function assertTable(table) {
  if (!CATALOG_TABLES.includes(table)) {
    throw new Error(`Unknown catalog table: ${table}`);
  }
  return table;
}

/**
 * Tabela de catálogo -> tipo aceito por `fn_can_produce_resource`. AS QUATRO.
 *
 * AINDA DISTINTO de `RESOURCE_TYPES` (resource-access.types.js), mesmo depois de
 * `basemap` ter entrado nos dois: aquele vocabulário é o do `CHECK` de
 * `resource_grants.resource_type` e inclui `sv360_project`, que não é tabela de
 * catálogo e não responde ao `listCatalog` genérico. Os dois eixos coincidem hoje
 * nos quatro nomes desta lista e continuam sendo eixos diferentes: produção é "que
 * OM mantém este recurso", concessão é "quem recebeu acesso a ele". Conflatá-los é
 * o erro que fazia `POST /basemaps` responder 500 em vez de 403.
 */
export const PRODUCTION_TYPE_BY_TABLE = Object.freeze({
  basemaps: 'basemap',
  data_layers: 'data_layer',
  analysis_layers: 'analysis_layer',
  tilesets: 'tileset',
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
 * Tabela de catálogo -> `audit_trail.target_type`. AS QUATRO, e um TERCEIRO
 * vocabulário: nem o das tabelas, nem o do `CHECK` de `resource_grants`.
 *
 * Mora AQUI, ao lado da whitelist que já mapeia tabela para tipo de produção, e não
 * num objeto solto no controller: os três mapas envelhecem juntos, e uma tabela nova
 * que apareça em um e não nos outros é o defeito que separá-los produz.
 *
 * Os valores são os declarados no `CHECK` de `audit_trail.target_type` pela migração
 * 020; um valor fora dele levanta 23514 no INSERT da trilha, o que derrubaria a
 * escrita inteira quando a auditoria é transacional. Aquele CHECK ainda declara
 * `STREETVIEW_MARKER`, que perdeu o escritor quando a migração 021 apagou a tabela:
 * virou alvo declarado sem emissor, censado como tal em
 * `tests/unit/auditoria-censo.test.js`.
 */
export const AUDIT_TARGET_TYPE_BY_TABLE = Object.freeze({
  basemaps: 'BASEMAP',
  data_layers: 'DATA_LAYER',
  analysis_layers: 'ANALYSIS_LAYER',
  tilesets: 'TILESET',
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
