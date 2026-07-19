// Path: src/modules/config/config.service.js
// Assembles the runtime app config (frozen config.js shape) from three sources:
//  - data (tables): basemaps/analysisLayers/dataLayers/tilesets from their dedicated catalog tables
//  - env URLs: service/tile/terrain URLs from config.appConfig
//  - static UI: app/features/map2d/map3d defaults from config.static
import config from '../../config.js';
import { ValidationError } from '../../utils/errors.js';
import { query } from '../../database/index.js';
import { catalogService } from '../catalog/index.js';
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
 * Enforces cross-field invariants on the EFFECTIVE config, which is what the app receives.
 *
 * Joi validates the PARTIAL body at the route, and `map2d`'s min<=max check only fires when both
 * keys are in the same payload. Neither the merge nor the static base is in scope there, so two
 * gaps stayed open: the invariant could be split across successive saves, and — the reachable one
 * — a lone `{"map2d":{"minZoom":20}}` conflicts with the STATIC `MAP2D_BASE.maxZoom` (17.9) that
 * `getAppConfig` layers underneath. Validating the merged OVERRIDES alone would not catch that,
 * because the overrides document has no maxZoom at all; only the effective document does.
 *
 * It matters because the failure is total and silent: the frontend hands both values straight to
 * the MapLibre constructor, which throws, and boot is fail-fast on GET /api/config with no static
 * fallback. The app stops loading for everyone, anonymous included, while the admin sees a 200.
 * The admin panel produces exactly this payload through normal use, since it sends only the field
 * that changed.
 *
 * @param {Object} merged - The full override document about to be persisted.
 * @throws {ValidationError} When the resulting effective config would be inconsistent.
 */
function assertEffectiveInvariants(merged) {
  const map2d = { ...S.MAP2D_BASE, ...(merged.map2d || {}) };
  if (map2d.minZoom != null && map2d.maxZoom != null && map2d.minZoom > map2d.maxZoom) {
    throw new ValidationError(
      `map2d.minZoom (${map2d.minZoom}) não pode ser maior que map2d.maxZoom (${map2d.maxZoom}). `
      + 'Considerando os valores em vigor, não apenas os enviados nesta requisição.'
    );
  }
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
  assertEffectiveInvariants(merged);
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
  const rows = await catalogService.listCatalog('basemaps');
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
  const rows = await catalogService.listCatalog('basemaps');
  const out = { ...S.buildBasemapStyles(C) };
  for (const r of rows) {
    if (r.config?.style) out[r.id] = r.config.style;
  }
  return out;
}

export async function listAnalysisLayers() {
  const rows = await catalogService.listCatalog('analysis_layers');
  // The frozen frontend contract requires every analysis layer to carry a valid
  // `bounds` [west, south, east, north] (the frontend zooms-to-layer with it). A
  // seeded layer with an incomplete config (e.g. the placeholder `hillshade` with
  // `{}`) is non-functional and previously broke app boot — never serve an analysis
  // layer that lacks valid bounds, so /api/config can't emit contract-breaking data.
  return rows
    .map((r) => ({ id: r.id, name: r.name, ...r.config }))
    .filter((layer) => Array.isArray(layer.bounds) && layer.bounds.length === 4);
}

/**
 * Monta uma fonte `raster-dem` no shape que o MapLibre espera — e o frontend a
 * repassa VERBATIM para `map.addSource()`.
 *
 * O MapLibre aceita duas formas e elas NÃO são intercambiáveis:
 *  - TileJSON:  { url: 'https://…/tiles.json' }
 *  - template:  { tiles: ['https://…/{z}/{x}/{y}'], minzoom, maxzoom }
 *
 * Antes só a primeira era emitida, então um deploy cujo terreno é servido por
 * template (o caso real: `/cms/martin/fathom_terrain/{z}/{x}/{y}`) não tinha como
 * ser expresso via env — a URL ia parar em `url:` e o MapLibre não a resolvia.
 * A presença de `{z}` distingue as duas.
 *
 * @param {string} url
 * @param {number|undefined} minzoom
 * @param {number|undefined} maxzoom
 * @returns {Object|undefined} fonte raster-dem, ou undefined se não houver URL.
 */
function rasterDemSource(url, minzoom, maxzoom) {
  if (!url) return undefined;
  if (!url.includes('{z}')) return { type: 'raster-dem', url, tileSize: 256 };
  return {
    type: 'raster-dem',
    tiles: [url],
    tileSize: 256,
    ...(Number.isFinite(minzoom) ? { minzoom } : {}),
    ...(Number.isFinite(maxzoom) ? { maxzoom } : {}),
  };
}

export async function listDataLayers() {
  const rows = await catalogService.listCatalog('data_layers');
  return rows.map((r) => ({ id: r.id, name: r.name, ...r.config }));
}

export async function listTilesets() {
  const rows = await catalogService.listCatalog('tilesets');
  return rows.map((r) => ({ id: r.id, name: r.name, ...r.config }));
}

// Personnel domains served to the PUBLIC config so the anonymous signup form can populate its
// dropdowns before login. Postos come from the `ranks` table, OMs from the `organizations` table;
// the option VALUE is the row id (users store rank_id / organization_id FKs).
export async function listPostos() {
  const { rows } = await query(
    'SELECT id, nome, nome_abrev, sort_order FROM ranks WHERE is_active = true ORDER BY sort_order, nome',
  );
  return rows.map((r) => ({ id: r.id, name: r.nome, abrev: r.nome_abrev ?? null, sort_order: r.sort_order }));
}

export async function listOrganizacoesMilitares() {
  const { rows } = await query(
    'SELECT id, nome, sigla FROM organizations WHERE is_active = true ORDER BY nome',
  );
  return rows.map((r) => ({ id: r.id, name: r.nome, sigla: r.sigla ?? null }));
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
    // A chave `search` faz parte do SHAPE CONGELADO e permanece — mas VAZIA: não
    // carrega mais `apiUrl`. O gazetteer É este backend (GET /nomes/busca) e o
    // cliente resolve a rota a partir da própria base da API. Havia um
    // SEARCH_API_URL cujo default apontava para um :3001 que nunca existiu: o
    // fetch dava connection-refused e a busca silenciosamente nunca retornava
    // nada. Ligar/desligar continua sendo `features.apisearch`.
    search: {},
    // Fase 4 (Tarefa 6): base URL the frontend resolves relative 3D asset `url`s
    // against (tileset.json/.glb/.terrain). Env-configurable so deployments can
    // point at an internal host; the catalog stores only relative paths.
    assets3dBaseUrl: config.assets3d.baseUrl,
    basemaps,
    analysisLayers: { enabled: true, layers: analysisLayers },
    dataLayers: { enabled: true, layers: dataLayers },
    map2d: {
      ...S.MAP2D_BASE,
      terrainSource: rasterDemSource(C.terrainUrl, C.terrainMinzoom, C.terrainMaxzoom),
      hillshadeSource: rasterDemSource(C.hillshadeUrl, C.hillshadeMinzoom, C.hillshadeMaxzoom),
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
          // Só habilita quando há URL configurada — sem terreno o Cesium usa o
          // elipsoide plano, em vez de tentar (e falhar) um provider inexistente.
          enabled: Boolean(C.map3dTerrainUrl),
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
