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
 * (e.g. the `...config.map2d.sourceTileLodParams` and `...config.map3d.viewer` spreads throw on
 * `undefined`). These are generic, non-deploy values; a partial `/api/config` deep-merges OVER
 * them so a missing key no longer crashes boot. The deploy CATALOG (basemaps, tilesets,
 * dataLayers/analysisLayers) is intentionally left empty — it comes from the backend.
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
  map2d: {
    minZoom: 1,
    maxZoom: 18,
    maxPitch: 60,
    globe_projection: true,
    sourceTileLodParams: [5, 6.0],
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
