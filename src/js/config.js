// Path: js/config.js

// ===== MAPSIG SYSTEM CONFIGURATION =====

const config = {
  // ===== APPLICATION SETTINGS =====
  app: {
    title: "EBGeo",        // Título exibido na interface
    subtitle: ""            // Subtítulo da aplicação
  },

  features: {
    map_3d: true,                 // Habilita/desabilita visualizador 3D
    imagens_panoramicas: true,    // Habilita/desabilita street view control
    vector_info: true,           // Habilita/desabilita vector info control
    grid: false,               // Habilita/desabilita grid
    frame: false,               // Habilita/desabilita moldura
  },

  url_paths: {
    url: 'IP:PORT', // endereço da aplicação. Colocar porta se necessário
    prefix_name: '' // nome da aplicação na url, como aman, arandu, etc. Deixar vazio para testes locais
  },

  // ===== SEARCH SETTINGS =====
  search: {
    apiUrl: "http://localhost:3000/busca"  // URL da API de busca de features
  },

  // ===== BASEMAP CONFIGURATION =====
  basemaps: {
    'carta-topografica': {
      enabled: true,
      name: 'Topográfica',
      icon: './images/dsg_symbol.svg',
      priority: 1
    },
    'carta-ortoimagem': {
      enabled: true,
      name: 'Ortoimagem',
      icon: './images/dsg_symbol.svg',
      priority: 2
    },
    'bdgex': {
      enabled: false,
      name: 'BDGEx',
      icon: './images/dsg_symbol.svg',
      priority: 3
    },
    'osm': {
      enabled: false,
      name: 'OSM',
      icon: '🌐',
      priority: 4
    },
    'imagens': {
      enabled: false,
      name: 'Imagens',
      icon: '🌐',
      priority: 5
    }
  },

  // ===== ANALYSIS LAYERS =====
  analysisLayers: {
    enabled: false, // Feature flag global
    layers: [
      // {
      //   id: 'trafficability',
      //   name: 'Trafegabilidade',
      //   description: 'Análise de trafegabilidade do terreno',
      //   bounds: [-44.47, -22.46, -44.44, -22.44], // [west, south, east, north]
      //   defaultVisibility: false,
      //   opacity: 0.7,
      //   source: {
      //     type: 'raster',
      //     url: 'http://localhost/trafficability/{z}/{x}/{y}',
      //     tileSize: 256
      //   },
      //   paint: {
      //     'raster-color': [
      //       'case',
      //       ['==', ['raster-value'], 0], 'rgba(0,0,0,0)',      // transparente
      //       ['==', ['raster-value'], 1], 'rgba(255,255,0,0.6)', // amarelo
      //       ['==', ['raster-value'], 2], 'rgba(255,0,0,0.6)',   // vermelho
      //       'rgba(0,0,0,0)' // fallback transparente
      //     ],
      //     'raster-opacity': 1.0 // controlado via opacity da layer config
      //   }
      // }
      // Futuras layers: slope analysis, flood risk, etc.
      // {
      //   id: 'slope_analysis',
      //   name: 'Análise de Declive',
      //   description: 'Mapa de declividade do terreno',
      //   bounds: [-44.47, -22.46, -44.44, -22.44], // [west, south, east, north]
      //   defaultVisibility: false,
      //   opacity: 0.6,
      //   source: {
      //     type: 'raster',
      //     url: 'http://localhost/slope/{z}/{x}/{y}',
      //     tileSize: 256
      //   },
      //   paint: {
      //     'raster-color': [
      //       'interpolate',
      //       ['linear'],
      //       ['raster-value'],
      //       0, 'rgba(0,255,0,0.5)',    // verde para baixa declividade
      //       30, 'rgba(255,255,0,0.6)',  // amarelo para média
      //       60, 'rgba(255,0,0,0.7)'     // vermelho para alta
      //     ],
      //     'raster-opacity': 1.0
      //   }
      // }
    ]
  },

  // ===== CONFIGURAÇÕES DO MAPA 2D =====
  map2d: {
    bounds: [
      [-58.1,-33.4], // [longitude_min, latitude_min]
      [-48.7,-27.1] // [longitude_max, latitude_max]
    ],
    minZoom: 1,              // Zoom mínimo permitido
    maxZoom: 17.9,           // Zoom máximo permitido
    maxPitch: 65,            // Inclinação máxima da câmera (0-60 graus)

    // Modo Globo
    globe_projection:false,

    // Configurações avançadas de carregamento de tiles
    sourceTileLodParams: [5, 6.0],  // [threshold, factor] para otimização de tiles

    // Limites geográficos opcionais (descomente para ativar)
    // maxBounds: [
    //   [-45.82515, -22.69950],  // [lng_min, lat_min] - sudoeste
    //   [-43.92333, -21.30216]   // [lng_max, lat_max] - nordeste
    // ],

    // ===== CONFIGURAÇÃO DO TERRAIN SOURCE =====
    // Source usado para consultas de elevação e terreno 3D
    terrainSource: {
      type: "raster-dem",                                    // Tipo: sempre "raster-dem"
      url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json",             // URL dos tiles de elevação
      tileSize: 256,
      // minzoom: 10,                                          // Zoom mínimo do terrain
      // maxzoom: 10                                           // Zoom máximo do terrain
      // Nota: Para URLs externas use: "https://example.com/terrain/{z}/{x}/{y}.png"
    },

    // ----- Hillshade Source -----
    hillshadeSource: {
      type: "raster-dem",                                    // Tipo: sempre "raster-dem"
      url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json",             // URL dos tiles de elevação
      tileSize: 256,
      // minzoom: 10,                                          // Zoom mínimo do hillshade
      // maxzoom: 10                                           // Zoom máximo do hillshade
    },

    // ----- 3D Terrain Toggle -----
    terrain: {
      source: 'terrainSource',                              // Nome do source a usar
      exaggeration: 1.5                                       // Multiplicador da elevação (1.0 = normal)
    },

    // ----- Hillshade Layer -----
    hillshade: {
      enabled: false,
      layer: {
        id: 'hillshade',                                    // ID da camada (não alterar)
        type: 'hillshade',                                  // Tipo da camada (não alterar)
        source: 'hillshadeSource',                          // Source a usar (não alterar)
        // minzoom: 10,                                        // Zoom mínimo da camada
        // maxzoom: 10,                                        // Zoom máximo da camada

        // Propriedades visuais do hillshade
        paint: {
          'hillshade-method': 'standard',                   // Método: 'standard' ou 'texture'
          'hillshade-illumination-direction': 315,          // Direção da luz (0-360 graus)
          'hillshade-shadow-color': 'rgba(0, 0, 0, 0.5)',              // Cor das sombras (hex)
          'hillshade-highlight-color': 'rgba(255, 255, 255, 0.5)',           // Cor dos realces (hex)
          'hillshade-accent-color': 'rgba(0, 0, 0, 0.5)',              // Cor dos acentos (hex)
          'hillshade-exaggeration': 0.5                     // Intensidade do relevo (0.0-1.0)
          // Dica: 0.2 = sutil, 0.5 = moderado, 0.8 = intenso
        },
        layout: {
          'visibility': 'visible'
        }
      },
    },

    // ----- Street View Sources -----
    streetViewPointsSource: {
      type: 'vector',
      url: 'http://IP:PORT/fotos'
    },
    streetViewPointsSourceLayer: 'fotos',

    streetViewLinesSource: {
      type: 'vector',
      url: 'http://IP:PORT/fotos_linha'
    },
    streetViewLinesSourceLayer: 'fotos_linha',
  },

  // ===== 3D MAP CONFIGURATION (CESIUM) =====
  map3d: {
    // Bounds define a visao inicial padrao do Cesium antes de navegar para um tileset
    bounds: {
      west: -58.1,      // Longitude oeste
      south: -33.8,     // Latitude sul
      east: -48.0,      // Longitude leste
      north: -22.5      // Latitude norte
    },

    // ----- Viewer UI Settings -----
    viewer: {
      infoBox: false,             // Caixa de informações
      vrButton: false,            // Botão de realidade virtual
      geocoder: false,            // Barra de busca
      homeButton: false,          // Botão home
      sceneModePicker: false,     // Seletor de modo de cena
      baseLayerPicker: false,     // Seletor de camada base
      navigationHelpButton: true, // Botão de ajuda de navegação
      animation: false,           // Controles de animação
      timeline: false,            // Linha do tempo
      fullscreenButton: false,    // Botão tela cheia
      // shadows: false,              // Desativa completamente as sombras
    },

    // ----- Data Providers -----
    providers: {
      imagery: {
        enabled: true,          // true = usa imagery local | false = desabilita
        type: 'UrlTemplate',    // Tipos: 'UrlTemplate', 'WMS', 'SingleTile'
        url: "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        options: {
          maximumLevel: 18,     // Nível máximo de zoom
          minimumLevel: 0,      // Nível mínimo de zoom
          tileWidth: 256,       // Largura dos tiles
          tileHeight: 256,      // Altura dos tiles
        }
      },
      terrain: {
        enabled: true,          // true = usa terrain local | false = usa ellipsoid (plano)
        type: 'Cesium',         // Tipos: 'Cesium' (quantized-mesh), 'Ellipsoid' (plano)
        url: 'http://localhost/terrain/tilesets/terrain',
        options: {
          requestVertexNormals: true,  // Solicita normais de vértices para melhor iluminação
        }
      }
    }
  },

  // ===== 3D TILESETS =====
  tilesets: [
    {
      url: "/3d/PCL/tileset.json",                     // Caminho para o tileset
      heightOffset: 35,                                // Offset de altura em metros
      id: "PCL",                                       // ID único do tileset
      name: "PCL",                                     // Nome para exibição
      data_captura: "15/03/2024",                      // Data de captura do modelo (DD/MM/AAAA)
      previewVideo: "/3d/videos/preview.webm",         // Vídeo de preview
      previewThumbnail: "/3d/videos/thumbnail.jpg",    // Fallback thumbnail
      locate: {
        lon: -44.47332385414955,                       // Longitude para localizar
        lat: -22.43976556982974,                       // Latitude para localizar
        height: 1000                                   // Altura da câmera
      }
    }
  ]
};

// ===== HELPER FUNCTIONS =====

/**
 * Check if any tilesets are configured
 * @returns {boolean} True if tilesets exist
 */
config.hasTilesets = () => config.tilesets && config.tilesets.length > 0;

/**
 * Validate basemaps configuration - ensures at least one basemap is enabled
 */
config.validateBasemapsConfig = () => {
  const enabled = Object.values(config.basemaps).filter(b => b.enabled);
  if (enabled.length === 0) {
    console.warn('All basemaps disabled! Enabling carta-topografica as fallback');
    config.basemaps['carta-topografica'].enabled = true;
  }
};

/**
 * Get enabled basemaps sorted by priority
 * @returns {Array} Array of [id, config] tuples sorted by priority
 */
config.getEnabledBasemaps = () => {
  return Object.entries(config.basemaps)
    .filter(([_id, basemapConfig]) => basemapConfig.enabled)
    .sort(([,a], [,b]) => a.priority - b.priority);
};

/**
 * Determine CSS layout class based on basemap count
 * @param {number} count - Number of enabled basemaps
 * @returns {string} CSS class name for grid layout
 */
config.getBasemapLayoutClass = (count) => {
  switch(count) {
    case 1: return 'base-layer-grid-1x1';
    case 2: return 'base-layer-grid-1x2';
    case 3: return 'base-layer-grid-2x1-center';
    case 4: return 'base-layer-grid-2x2';
    case 5: return 'base-layer-grid-2x2-center';
    default: return 'base-layer-grid-2x2';
  }
};

/**
 * Get valid basemap fallback when current selection is unavailable
 * @param {string|null} currentBasemap - Currently selected basemap ID
 * @returns {string} Valid basemap ID
 */
config.getValidBasemapFallback = (currentBasemap = null) => {
  const enabled = config.getEnabledBasemaps();
  if (enabled.length === 0) return 'carta-topografica';

  if (currentBasemap && config.basemaps[currentBasemap]?.enabled) {
    return currentBasemap;
  }

  return enabled[0][0];
};

/**
 * Create imagery provider configuration object
 * @returns {Object|boolean} Provider config or false if disabled
 */
config.createImageryProvider = () => {
  const imageryConfig = config.map3d.providers.imagery;
  if (!imageryConfig.enabled) return false;

  switch (imageryConfig.type) {
    case 'UrlTemplate':
      return {
        provider: 'UrlTemplateImageryProvider',
        url: imageryConfig.url,
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

/**
 * Create terrain provider configuration object
 * @returns {Object} Provider config (defaults to ellipsoid if disabled)
 */
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
        requestVertexNormals: terrainConfig.options.requestVertexNormals || false
      };
    case 'Ellipsoid':
      return { provider: 'EllipsoidTerrainProvider' };
    default:
      return { provider: 'EllipsoidTerrainProvider' };
  }
};

export default config;