// Path: js/config.js

// ===== MAPSIG SYSTEM CONFIGURATION =====

const config = {
  // ===== APPLICATION SETTINGS =====
  app: {
    title: "EBGeo",        // Título exibido na interface
    subtitle: "",          // Subtítulo da aplicação #DEPRECATED
    tutorialUrl: './docs/doc.html'  // URL do tutorial (abre em nova janela)
  },

  features: {
    map_3d: true,                 // Habilita/desabilita visualizador 3D
    imagens_panoramicas: true,    // Habilita/desabilita street view control
    vector_info: false,           // Habilita/desabilita vector info control
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
    enabled: true, // Feature flag global
    layers: [
      {
        id: 'trafficability',
        name: 'Trafegabilidade',
        description: 'Análise de trafegabilidade do terreno baseada em tipo de solo, declividade e cobertura vegetal',
        thumbnail: null,
        bounds: [-44.50, -22.50, -44.40, -22.40],
        defaultVisibility: false,
        opacity: 0.7,
        source: {
          type: 'raster',
          url: 'http://localhost/trafficability/{z}/{x}/{y}',
          tileSize: 256
        },
        paint: {
          'raster-color': [
            'case',
            ['==', ['raster-value'], 0], 'rgba(0,0,0,0)',
            ['==', ['raster-value'], 1], 'rgba(255,255,0,0.6)',
            ['==', ['raster-value'], 2], 'rgba(255,0,0,0.6)',
            'rgba(0,0,0,0)'
          ],
          'raster-opacity': 1.0
        }
      },
      {
        id: 'slope_analysis',
        name: 'Análise de Declive',
        description: 'Mapa de declividade do terreno classificado em faixas de grau',
        thumbnail: null,
        bounds: [-44.50, -22.50, -44.40, -22.40],
        defaultVisibility: false,
        opacity: 0.6,
        source: {
          type: 'raster',
          url: 'http://localhost/slope/{z}/{x}/{y}',
          tileSize: 256
        },
        paint: {
          'raster-color': [
            'interpolate',
            ['linear'],
            ['raster-value'],
            0, 'rgba(0,255,0,0.5)',
            30, 'rgba(255,255,0,0.6)',
            60, 'rgba(255,0,0,0.7)'
          ],
          'raster-opacity': 1.0
        }
      },
      {
        id: 'flood_risk',
        name: 'Risco de Inundação',
        description: 'Áreas com risco de inundação baseado em modelo hidrológico',
        thumbnail: null,
        bounds: [-44.52, -22.48, -44.42, -22.42],
        defaultVisibility: false,
        opacity: 0.65,
        source: {
          type: 'raster',
          url: 'http://localhost/flood_risk/{z}/{x}/{y}',
          tileSize: 256
        },
        paint: {
          'raster-color': [
            'interpolate',
            ['linear'],
            ['raster-value'],
            0, 'rgba(0,0,255,0.2)',
            50, 'rgba(0,0,255,0.5)',
            100, 'rgba(0,0,128,0.8)'
          ],
          'raster-opacity': 1.0
        }
      }
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
    globe_projection:true,

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
      enabled: true,
      name: 'Sombreamento do Relevo',                // Display name for catalog
      description: 'Visualização de relevo sombreado baseada em modelo digital de elevação',    // Description for catalog
      thumbnail: null,                               // Optional thumbnail URL for catalog
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
      url: "/3d/PCL/tileset.json",
      heightOffset: 35,
      id: "PCL",
      name: "Posto de Comando Logístico",
      description: "Modelo 3D do Posto de Comando Logístico capturado por drone",
      data_captura: "15/03/2024",
      previewVideo: "/3d/videos/preview.webm",
      previewThumbnail: "/3d/videos/thumbnail.jpg",
      locate: {
        lon: -44.47332385414955,
        lat: -22.43976556982974,
        height: 1000
      }
    },
    {
      url: "/3d/quartel/tileset.json",
      heightOffset: 20,
      id: "quartel_general",
      name: "Quartel General",
      description: "Modelo 3D do Quartel General - Edifício principal e anexos",
      data_captura: "22/04/2024",
      previewVideo: null,
      previewThumbnail: "/3d/thumbnails/quartel.jpg",
      locate: {
        lon: -44.46125,
        lat: -22.44512,
        height: 800
      }
    },
    {
      url: "/3d/ponte/tileset.json",
      heightOffset: 5,
      id: "ponte_rio",
      name: "Ponte Estratégica Rio Paraíba",
      description: "Modelo 3D da ponte sobre o Rio Paraíba - Ponto de passagem crítico",
      data_captura: "08/05/2024",
      previewVideo: "/3d/videos/ponte_preview.webm",
      previewThumbnail: "/3d/thumbnails/ponte.jpg",
      locate: {
        lon: -44.48901,
        lat: -22.42188,
        height: 500
      }
    },
    {
      url: "/3d/deposito/tileset.json",
      heightOffset: 15,
      id: "deposito_municao",
      name: "Depósito de Suprimentos",
      description: "Modelo 3D do depósito central de suprimentos classe I e III",
      data_captura: "30/05/2024",
      previewVideo: null,
      previewThumbnail: "/3d/thumbnails/deposito.jpg",
      locate: {
        lon: -44.45678,
        lat: -22.45123,
        height: 600
      }
    }
  ],

  // ===== STREETVIEW MARKERS =====
  // Markers for specific panoramic photo locations
  // These markers appear on the map when the streetview tool is activated
  streetViewMarkers: [
    {
      id: "obs-norte-01",
      name: "Observatório Norte - Ponto Alto",
      description: "Vista panorâmica 360° do ponto de observação norte com visada para o vale",
      data_captura: "10/01/2025",
      locate: {
        lon: -44.47332,
        lat: -22.43976
      },
      previewThumbnail: "/street_view/thumbnails/obs-norte-01.jpg",
      photoName: "IMG_0001"
    },
    {
      id: "cruzamento-principal",
      name: "Cruzamento Principal - Eixo de Progressão",
      description: "Panorâmica do cruzamento principal na área de operações",
      data_captura: "12/01/2025",
      locate: {
        lon: -44.46850,
        lat: -22.44200
      },
      previewThumbnail: "/street_view/thumbnails/cruzamento.jpg",
      photoName: "IMG_0015"
    },
    {
      id: "entrada-quartel",
      name: "Entrada do Quartel",
      description: "Vista 360° da entrada principal do aquartelamento",
      data_captura: "15/01/2025",
      locate: {
        lon: -44.46125,
        lat: -22.44512
      },
      previewThumbnail: "/street_view/thumbnails/entrada-quartel.jpg",
      photoName: "IMG_0022"
    },
    {
      id: "ponte-acesso",
      name: "Ponte de Acesso - Margem Sul",
      description: "Panorâmica da ponte de acesso vista da margem sul do rio",
      data_captura: "18/01/2025",
      locate: {
        lon: -44.48950,
        lat: -22.42150
      },
      previewThumbnail: "/street_view/thumbnails/ponte-sul.jpg",
      photoName: "IMG_0030"
    },
    {
      id: "posto-vigilancia-leste",
      name: "Posto de Vigilância Leste",
      description: "Vista panorâmica do posto de vigilância setor leste",
      data_captura: "20/01/2025",
      locate: {
        lon: -44.45200,
        lat: -22.44800
      },
      previewThumbnail: "/street_view/thumbnails/posto-leste.jpg",
      photoName: "IMG_0045"
    },
    {
      id: "area-treinamento",
      name: "Área de Treinamento - Campo Aberto",
      description: "Panorâmica 360° da área de treinamento em campo aberto",
      data_captura: "25/01/2025",
      locate: {
        lon: -44.47800,
        lat: -22.45500
      },
      previewThumbnail: "/street_view/thumbnails/treinamento.jpg",
      photoName: "IMG_0058"
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
 * Check if any streetview markers are configured
 * @returns {boolean} True if streetview markers exist
 */
config.hasStreetViewMarkers = () => config.streetViewMarkers && config.streetViewMarkers.length > 0;

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
