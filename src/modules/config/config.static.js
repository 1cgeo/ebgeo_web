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
