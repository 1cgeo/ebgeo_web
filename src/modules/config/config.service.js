// Path: src/modules/config/config.service.js
// Assembles the runtime app config (frozen config.js shape) from three sources:
//  - data (tables): basemaps/analysisLayers/dataLayers/tilesets from `resources`
//  - env URLs: service/tile/terrain URLs from config.appConfig
//  - static UI: app/features/map2d/map3d defaults from config.static
import config from '../../config.js';
import { query } from '../../database/index.js';
import * as Q from './config.queries.js';
import * as S from './config.static.js';

const C = config.appConfig;

/** The single config_settings row that holds the admin override document. */
const OVERRIDES_KEY = 'app_config';

/**
 * Deep-merges `override` onto `base` (override wins; plain objects merge recursively; arrays and
 * scalars replace). Pure — does not mutate its inputs.
 */
function deepMerge(base, override) {
  if (override === null || typeof override !== 'object' || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(override)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v;
  }
  return out;
}

/** Reads the admin config override document (partial config; {} when unset). */
export async function getConfigOverrides() {
  const { rows } = await query(Q.GET_CONFIG_OVERRIDES, [OVERRIDES_KEY]);
  return rows[0]?.value ?? {};
}

/**
 * Merges a partial override into the stored override document (so a partial save never wipes
 * untouched sections) and persists it. Returns the merged document.
 * @param {Object} partial - Validated partial config.
 * @param {string|null} userId
 */
export async function updateConfigOverrides(partial, userId) {
  const current = await getConfigOverrides();
  const merged = deepMerge(current, partial);
  const { rows } = await query(Q.UPSERT_CONFIG_OVERRIDES, [
    OVERRIDES_KEY,
    JSON.stringify(merged),
    userId ?? null,
  ]);
  return rows[0].value;
}

/** Clears ALL config overrides (the revert valve — config reverts to STATIC/ENV on next boot). */
export async function clearConfigOverrides() {
  await query(Q.CLEAR_CONFIG_OVERRIDES, [OVERRIDES_KEY]);
  return {};
}

// basemaps is an OBJECT keyed by id (frontend indexes by id), not an array. The MapLibre `style`
// (if an admin set one) is emitted SEPARATELY as basemapStyles — stripped from the metadata here.
export async function listBasemaps() {
  const { rows } = await query(Q.LIST_BY_CATEGORY, ['basemap']);
  return Object.fromEntries(rows.map((r) => {
    const meta = { ...(r.config || {}) };
    delete meta.style;
    return [r.id, { name: r.name, ...meta }];
  }));
}

/**
 * Builds the MapLibre `basemapStyles` map. The STATIC builders (ENV-injected tile/glyph URLs) are
 * the default; a basemap resource's `config.style` OVERRIDES it (admin-edited via the catalog). This
 * keeps the ENV-injection default intact while allowing a per-basemap style override.
 */
export async function listBasemapStyles() {
  const { rows } = await query(Q.LIST_BY_CATEGORY, ['basemap']);
  const out = { ...S.buildBasemapStyles(C) };
  for (const r of rows) {
    if (r.config?.style) out[r.id] = r.config.style;
  }
  return out;
}

export async function listAnalysisLayers() {
  const { rows } = await query(Q.LIST_BY_CATEGORY, ['analysis_layer']);
  // The frozen frontend contract requires every analysis layer to carry a valid
  // `bounds` [west, south, east, north] (the frontend zooms-to-layer with it). A
  // seeded layer with an incomplete config (e.g. the placeholder `hillshade` with
  // `{}`) is non-functional and previously broke app boot — never serve an analysis
  // layer that lacks valid bounds, so /api/config can't emit contract-breaking data.
  return rows
    .map((r) => ({ id: r.id, name: r.name, ...r.config }))
    .filter((layer) => Array.isArray(layer.bounds) && layer.bounds.length === 4);
}

export async function listDataLayers() {
  const { rows } = await query(Q.LIST_BY_CATEGORY, ['data_layer']);
  return rows.map((r) => ({ id: r.id, name: r.name, ...r.config }));
}

export async function listTilesets() {
  const { rows } = await query(Q.LIST_BY_CATEGORY, ['tileset']);
  return rows.map((r) => ({ id: r.id, name: r.name, ...r.config }));
}

// Personnel domains (admin-managed controlled lists) served to the PUBLIC config so the
// anonymous signup form can populate its dropdowns before login. `abrev` (postos only)
// lives in config.abrev.
export async function listPostos() {
  const { rows } = await query(Q.LIST_BY_CATEGORY, ['posto']);
  return rows.map((r) => ({ id: r.id, name: r.name, abrev: r.config?.abrev ?? null, sort_order: r.sort_order }));
}

export async function listOrganizacoesMilitares() {
  const { rows } = await query(Q.LIST_BY_CATEGORY, ['organizacao_militar']);
  return rows.map((r) => ({ id: r.id, name: r.name, sort_order: r.sort_order }));
}

/**
 * Builds the full config payload served by GET /api/v1/config.
 */
export async function getAppConfig() {
  const [basemaps, basemapStyles, analysisLayers, dataLayers, tilesets, postos, organizacoesMilitares, overrides] = await Promise.all([
    listBasemaps(),
    listBasemapStyles(),
    listAnalysisLayers(),
    listDataLayers(),
    listTilesets(),
    listPostos(),
    listOrganizacoesMilitares(),
    getConfigOverrides(),
  ]);

  const payload = {
    app: S.APP,
    // self_registration tells the client whether to show the "Criar conta" affordance — the
    // /auth/register route is only mounted when allowSelfRegistration is on (off in prod).
    features: { ...S.FEATURES, self_registration: config.security.allowSelfRegistration },
    services: { tileServerUrl: C.tileServerUrl },
    search: { apiUrl: C.searchApiUrl },
    // Fase 4 (Tarefa 6): base URL the frontend resolves relative 3D asset `url`s
    // against (tileset.json/.glb/.terrain). Env-configurable so deployments can
    // point at an internal host; the catalog stores only relative paths.
    assets3dBaseUrl: config.assets3d.baseUrl,
    basemaps,
    analysisLayers: { enabled: true, layers: analysisLayers },
    dataLayers: { enabled: true, layers: dataLayers },
    map2d: {
      ...S.MAP2D_BASE,
      terrainSource: { type: 'raster-dem', url: C.terrainUrl, tileSize: 256 },
      hillshadeSource: { type: 'raster-dem', url: C.hillshadeUrl, tileSize: 256 },
    },
    map3d: {
      bounds: S.MAP3D_BOUNDS,
      viewer: S.MAP3D_VIEWER,
      providers: {
        imagery: {
          enabled: true,
          type: 'UrlTemplate',
          url: C.map3dImageryUrl,
          options: { maximumLevel: 18, minimumLevel: 0, tileWidth: 256, tileHeight: 256 },
        },
        terrain: {
          enabled: true,
          type: 'Cesium',
          url: C.map3dTerrainUrl,
          options: { requestVertexNormals: true },
        },
      },
    },
    tilesets,
    // Admin-managed personnel domains (controlled lists) for the signup/account forms.
    postos,
    organizacoesMilitares,
    // Fase 9 (Tarefa 7): the 360 overlay is a server-rendered VECTOR source (PostGIS
    // ST_AsMVT) served by THIS backend at {serviceUrl}/tiles/{z}/{x}/{y}.pbf. One
    // tile carries two layers: 'fotos' (points) and 'fotos_linha' (per-project
    // trajectory lines). {z}/{x}/{y} are MapLibre placeholders (literals). GeoJSON-
    // as-source and PMTiles are discontinued. Both sources point at the SAME tile
    // template; the frontend selects the layer via pointsSourceLayer/linesSourceLayer.
    streetView360: {
      serviceUrl: C.sv360ServiceUrl,
      pointsSource: { type: 'vector', tiles: [`${C.sv360ServiceUrl}/tiles/{z}/{x}/{y}.pbf`] },
      pointsSourceLayer: 'fotos',
      linesSource: { type: 'vector', tiles: [`${C.sv360ServiceUrl}/tiles/{z}/{x}/{y}.pbf`] },
      linesSourceLayer: 'fotos_linha',
    },
    basemapStyles,
  };

  // Admin overrides (app/features/map2d/map3d/service URLs) win over the STATIC/ENV assembly.
  return deepMerge(payload, overrides);
}
