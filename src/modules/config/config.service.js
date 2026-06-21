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

// basemaps is an OBJECT keyed by id (frontend indexes by id), not an array.
export async function listBasemaps() {
  const { rows } = await query(Q.LIST_BY_CATEGORY, ['basemap']);
  return Object.fromEntries(rows.map((r) => [r.id, { name: r.name, ...r.config }]));
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

/**
 * Builds the full config payload served by GET /api/v1/config.
 */
export async function getAppConfig() {
  const [basemaps, analysisLayers, dataLayers, tilesets] = await Promise.all([
    listBasemaps(),
    listAnalysisLayers(),
    listDataLayers(),
    listTilesets(),
  ]);

  return {
    app: S.APP,
    features: S.FEATURES,
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
    basemapStyles: S.buildBasemapStyles(C),
  };
}
