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
  return rows.map((r) => ({ id: r.id, name: r.name, ...r.config }));
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
    streetView360: {
      serviceUrl: C.sv360ServiceUrl,
      pointsSource: { type: 'vector', url: C.sv360PointsUrl },
      pointsSourceLayer: 'fotos',
      linesSource: { type: 'vector', url: C.sv360LinesUrl },
      linesSourceLayer: 'fotos_linha',
    },
    basemapStyles: S.buildBasemapStyles(C),
  };
}
