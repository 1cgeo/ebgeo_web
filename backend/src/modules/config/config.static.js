// Path: src/modules/config/config.static.js
// Static UI defaults (frozen config.js shape) + MapLibre basemap style
// templates. Tile/glyph URLs are injected from config.appConfig (env), so the
// public payload never hardcodes a server the deployment can't override.

export const APP = {
  title: 'EBGeo',
  tutorialUrl: './docs/doc.html',
};

export const FEATURES = {
  map_3d: true,
  imagens_panoramicas: true,
  apisearch: false,
  grid: false,
  // AS DUAS DA INATIVIDADE, e elas existem porque o CLIENTE JÁ AS LIA. `resolveIdleMs` e
  // `resolveWarnMs` (`frontend/src/js/session/idle-watch.js`) consultavam
  // `features.idle_timeout_minutes` e `features.idle_warning_seconds` desde que o aviso de
  // inatividade nasceu, e nenhuma das duas era emitida: na prática o valor era SEMPRE o padrão do
  // cliente, e a configurabilidade que o código anunciava não existia em lugar nenhum.
  //
  // Publicá-las aqui é o conserto mais barato dos dois possíveis, e é o certo: o outro seria
  // apagar as duas leituras, o que tiraria do administrador um controle sobre quanto tempo uma
  // estação desatendida fica aberta numa sala onde ela desenha ordem de operações. Os valores
  // batem com os padrões do cliente, então NADA muda de comportamento hoje; o que muda é que
  // agora existe um lugar para mexer, e ele é o override de administrador, como todo o resto
  // deste bloco.
  idle_timeout_minutes: 30,
  idle_warning_seconds: 60,
};

export const MAP2D_BASE = {
  bounds: [
    [-58.1, -33.4],
    [-48.7, -27.1],
  ],
  minZoom: 1,
  maxZoom: 17.9,
  maxPitch: 65,
  globe_projection: true,
  sourceTileLodParams: [5, 6.0],
  hillshade: {
    enabled: false,
    name: 'Sombreamento do Relevo',
    description: 'Visualização de relevo sombreado baseada em modelo digital de elevação',
    thumbnail: null,
    layer: {
      id: 'hillshade',
      type: 'hillshade',
      source: 'hillshadeSource',
      paint: {
        'hillshade-method': 'standard',
        'hillshade-illumination-direction': 315,
        'hillshade-shadow-color': 'rgba(0, 0, 0, 0.5)',
        'hillshade-highlight-color': 'rgba(255, 255, 255, 0.5)',
        'hillshade-accent-color': 'rgba(0, 0, 0, 0.5)',
        'hillshade-exaggeration': 0.5,
      },
      layout: { visibility: 'visible' },
    },
  },
};

export const MAP3D_BOUNDS = { west: -58.1, south: -33.8, east: -48.0, north: -22.5 };

export const MAP3D_VIEWER = {
  infoBox: false,
  vrButton: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  baseLayerPicker: false,
  navigationHelpButton: true,
  animation: false,
  timeline: false,
  fullscreenButton: false,
};

// MapLibre style builders. `C` is config.appConfig.
const osmStyle = (C) => ({
  version: 8,
  glyphs: C.glyphsUrl,
  sources: {
    osm: {
      type: 'raster',
      tiles: [C.osmTileUrl],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap Contributors',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
});

const bdgexStyle = (C) => ({
  version: 8,
  glyphs: C.glyphsUrl,
  sources: {
    bdgex: {
      type: 'raster',
      tiles: [C.bdgexWmsUrl],
      tileSize: 256,
      attribution: 'BDGEx - Exército Brasileiro',
      maxzoom: 18,
    },
  },
  layers: [{ id: 'bdgex', type: 'raster', source: 'bdgex' }],
});

const imagensStyle = (C) => ({
  version: 8,
  glyphs: C.glyphsUrl,
  sources: {
    imagens: { type: 'raster', tiles: [C.imagensTileUrl], tileSize: 256, maxzoom: 20 },
  },
  layers: [{ id: 'imagens', type: 'raster', source: 'imagens' }],
});

const ortoStyle = (C) => ({
  version: 8,
  glyphs: C.glyphsUrl,
  sources: {
    ortoimagem: {
      type: 'raster',
      tiles: [C.ortoimagemTileUrl],
      tileSize: 256,
      attribution: 'BDGEx - Exército Brasileiro',
      maxzoom: 18,
    },
  },
  layers: [{ id: 'ortoimagem', type: 'raster', source: 'ortoimagem' }],
});

/**
 * Builds the basemapStyles dictionary from the env-driven config block.
 * @param {object} C - config.appConfig
 */
export function buildBasemapStyles(C) {
  return {
    'carta-topografica': osmStyle(C),
    osm: osmStyle(C),
    bdgex: bdgexStyle(C),
    imagens: imagensStyle(C),
    'carta-ortoimagem': ortoStyle(C),
  };
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
 * Vive aqui, e não em config.service.js, por ser formatação PURA: o service
 * arrasta o pool do Postgres consigo, e a correção acima (um bug real de produção)
 * ficou sem teste de regressão justamente porque a função era privada de um módulo
 * que só se importa com banco de pé.
 *
 * @param {string} url
 * @param {number|undefined} minzoom
 * @param {number|undefined} maxzoom
 * @returns {Object|undefined} fonte raster-dem, ou undefined se não houver URL.
 */
export function rasterDemSource(url, minzoom, maxzoom) {
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
