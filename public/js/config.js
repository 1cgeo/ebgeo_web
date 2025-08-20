// Path: js\config.js
const config = {
  app: {
    title: "EBGeo Op. Arandu",
    subtitle: "Op. Arandu"
  },

  search: {
    apiUrl: "http://localhost:3000/busca"
  },

  map2d: {
    bounds: [
      [-44.4633992903047, -22.46265178239199],
      [-44.439695820515325, -22.444666254876367]
    ],
    minZoom: 1,
    maxZoom: 17.9,
    maxPitch: 65,
    //maxBounds: [
    //  [-45.82515, -22.69950],
    //  [-43.92333, -21.30216]
    //],
    sourceTileLodParams: [5, 6.0]
  },

  map3d: {
    bounds: {
      west: -44.449656,
      south: -22.455922,
      east: -44.449654,
      north: -22.455920
    },
    initialCamera: {
      longitude: -44.4481491,
      latitude: -22.4546061,
      height: 424.7,
      heading: 164,
      pitch: -2,
      roll: -1
    },
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
    providers: {
      // ===== IMAGERY PROVIDER (Imagens de fundo) =====
      imagery: {
        enabled: true, // true para usar imagery local, false para desabilitar
        type: 'UrlTemplate', // Tipos: 'UrlTemplate', 'WMS', 'SingleTile'
        url: 'http://localhost/raster/data/aman_esa_alta_resolucao_2_data/{z}/{x}/{y}.png',
        options: {
          maximumLevel: 18,
          minimumLevel: 0,
          tileWidth: 256,
          tileHeight: 256,
        }
      },
      // ===== TERRAIN PROVIDER (Terreno 3D) =====
      terrain: {
        enabled: true, // true para usar terrain local, false para usar ellipsoid (plano)
        type: 'Cesium', // Tipos: 'Cesium' (quantized-mesh), 'Ellipsoid' (terreno plano)
        url: 'http://localhost/terrain/tilesets/terrain',
        options: {
          requestVertexNormals: true,
        }
      }
    }
  },

  tilesets: [
    {
      url: "/3d/PCL/tileset.json",
      heightOffset: 35,
      id: "PCL",
      name: "PCL",
      locate: { lon: -44.47332385414955, lat: -22.43976556982974, height: 1000 }
    }
  ]
};

config.hasTilesets = () => config.tilesets && config.tilesets.length > 0;

config.getDefaultTileset = () => config.tilesets.find(t => t.default) || config.tilesets[0];

// Helper para criar imagery provider baseado na configuração
config.createImageryProvider = () => {
  const imageryConfig = config.map3d.providers.imagery;
  if (!imageryConfig.enabled) return false;

  switch (imageryConfig.type) {
    case 'UrlTemplate':
      return {
        provider: 'UrlTemplateImageryProvider',
        url: imageryConfig.url,
        // Configurações essenciais para imagery
        maximumLevel: imageryConfig.options.maximumLevel || 18,
        minimumLevel: imageryConfig.options.minimumLevel || 0,
        tileWidth: imageryConfig.options.tileWidth || 256,
        tileHeight: imageryConfig.options.tileHeight || 256
      };
    case 'WMS':
      return {
        provider: 'WebMapServiceImageryProvider',
        url: imageryConfig.url,
        layers: imageryConfig.options.layers
      };
    case 'SingleTile':
      return {
        provider: 'SingleTileImageryProvider',
        url: imageryConfig.url
      };
    default:
      return false;
  }
};

// Helper para criar terrain provider baseado na configuração
config.createTerrainProvider = () => {
  const terrainConfig = config.map3d.providers.terrain;
  if (!terrainConfig.enabled) {
    return { provider: 'EllipsoidTerrainProvider' };
  }

  switch (terrainConfig.type) {
    case 'Cesium':
      return {
        provider: 'CesiumTerrainProvider',
        url: terrainConfig.url,
        // Apenas options essenciais
        requestVertexNormals: terrainConfig.options.requestVertexNormals || false
      };
    case 'Ellipsoid':
      return { provider: 'EllipsoidTerrainProvider' };
    default:
      return { provider: 'EllipsoidTerrainProvider' };
  }
};

export default config;