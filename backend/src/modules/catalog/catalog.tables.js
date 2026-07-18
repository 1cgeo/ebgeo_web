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
