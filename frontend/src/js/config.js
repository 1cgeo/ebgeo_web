// Path: js/config.js

/**
 * Runtime config SHELL — carries NO deploy data.
 *
 * The deploy ALWAYS ships a backend and `GET /api/config` is the SINGLE source of truth:
 * `applyRuntimeConfig` (store/sync/runtime-config.js) deep-merges the server payload INTO this
 * object at boot, BEFORE anything reads it. Boot is FAIL-FAST — without the backend the app shows
 * the "EBGeo indisponível" screen and never runs (see index.js). `config.helpers.js` attaches its
 * helper methods onto this same object after the merge.
 *
 * This file only declares the SHAPE the server hydrates. Do NOT add deploy data here — configure
 * it in the backend (`GET /api/config` ← the `resources` table + `config.static.js`).
 *
 * STRUCTURAL FAIL-SAFE DEFAULTS (NOT deploy data): `map2d` and `map3d` below carry a minimal
 * floor for ONLY the map-init-critical keys that map_sig.js / map_3d.js read WITHOUT guards
 * (e.g. the `...config.map3d.viewer` spread throws on `undefined`). These are generic,
 * non-deploy values; a partial `/api/config` deep-merges OVER them so a missing key no longer
 * crashes boot. The deploy CATALOG (basemaps, tilesets, dataLayers/analysisLayers) is
 * intentionally left empty: it comes from the backend.
 */
const config = {
  app: {},
  features: {},
  services: {},
  search: {},
  basemaps: {},
  analysisLayers: { enabled: true, layers: [] },
  dataLayers: { enabled: true, layers: [] },
  // Structural fail-safe floor — only the keys map_sig.js reads unguarded at map creation.
  //
  // OS DOIS ZOOMS SÃO O PAR FIXO DA APLICAÇÃO, [2, 21], e batem com `MAP2D_BASE` do servidor
  // porque desde 2026-08-31 eles não são configuráveis por ninguém. Antes o piso dizia 1 e 18
  // enquanto o servidor dizia 1 e 17.9, e as duas cópias discordavam: um boot que caísse neste
  // piso (payload sem `map2d`) desenhava um mapa com limite diferente do de todo mundo.
  //
  // Quem aperta a faixa é o MAPA BASE, em `base-layer.control.js`, lendo
  // `config.basemaps[id].minzoom`/`maxzoom`. Este objeto é só o chão de onde a câmera parte.
  map2d: {
    minZoom: 2,
    maxZoom: 21,
    maxPitch: 60,
    globe_projection: true,
    // NÍVEL DE DETALHE DOS TILES COM A CÂMERA INCLINADA, e o piso aqui é `null` porque o
    // servido passou a ser `null` (decisão do dono, 2026-09-04; `MAP2D_BASE` em
    // `backend/src/modules/config/config.static.js`). É o par que as duas cópias têm de
    // declarar igual, pelo mesmo motivo dos dois zooms acima: um boot que caísse neste piso
    // desenharia um mapa com LOD diferente do de todo mundo.
    //
    // `null` significa "mantém o padrão do MapLibre", que é `(9.314, 3)` e é o mais leve.
    // Quem lê isto é `applyTileLodParams` (`map/tile-lod.js`), que valida antes de aplicar e
    // NÃO espalha o valor, então esta chave deixou de ser das que map_sig.js lê sem guarda.
    sourceTileLodParams: null,
  },
  // Structural fail-safe floor — `bounds` (map_3d.js Cesium extent) + `viewer` (spread into the
  // Cesium Viewer constructor). Boolean UI flags mirror the Cesium viewer options map_3d reads.
  map3d: {
    bounds: { west: -74.0, south: -34.0, east: -34.0, north: 6.0 },
    viewer: {
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
    },
    // Floor so config.helpers.js reads of providers.imagery/.terrain don't throw before the
    // backend merge supplies the real providers; disabled = generic safe default.
    providers: {
      imagery: { enabled: false },
      terrain: { enabled: false },
    },
  },
  tilesets: [],
  streetView360: {},
};

export default config;
