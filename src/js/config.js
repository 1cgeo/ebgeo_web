// Path: js/config.js

// ===== MAPSIG SYSTEM CONFIGURATION =====

const config = {
  // ===== APPLICATION SETTINGS =====
  app: {
    title: "EBGeo",        // Título exibido na interface
    tutorialUrl: './docs/doc.html'  // URL do tutorial (abre em nova janela)
  },

  features: {
    map_3d: true,                 // Habilita/desabilita visualizador 3D
    imagens_panoramicas: true,    // Habilita/desabilita street view control
    apisearch: false,             // Habilita/desabilita busca via API externa
    grid: false,                  // Habilita/desabilita grid
  },

  url_paths: {
    url: 'IP:PORT', // endereço da aplicação. Colocar porta se necessário
    prefix_name: '' // nome da aplicação na url, como aman, arandu, etc. Deixar vazio para testes locais
  },

  // ===== SEARCH SETTINGS =====
  search: {
    apiUrl: "http://localhost:3001/busca"  // URL da API de busca de features
  },

  // ===== BASEMAP CONFIGURATION =====
  basemaps: {
    'carta-topografica': {
      enabled: true,
      name: 'Topográfica',
      image: './images/layers/carta-topografica-thumb.png',  // Imagem opcional para o painel
      priority: 1
    },
    'carta-ortoimagem': {
      enabled: true,
      name: 'Ortoimagem',
      image: './images/layers/carta-ortoimagem-thumb.png',   // Imagem opcional para o painel
      priority: 2
    },
    'bdgex': {
      enabled: true,
      name: 'BDGEx',
      image: './images/layers/bdgex-thumb.png',              // Imagem opcional para o painel
      priority: 3
    },
    'osm': {
      enabled: false,
      name: 'OSM',
      // image: './images/layers/osm-thumb.png',             // Sem imagem - usa fallback
      priority: 4
    },
    'imagens': {
      enabled: false,
      name: 'Imagens',
      // image: './images/layers/imagens-thumb.png',         // Sem imagem - usa fallback
      priority: 5
    }
  },

  // ===== ANALYSIS LAYERS =====
  // Camadas de análise raster (DEM, declive, etc.)
  // Campos opcionais: legend (para exibir legenda na lista de camadas)
  // Exemplo:
  // {
  //   id: 'slope',
  //   name: 'Declividade',
  //   description: 'Mapa de declividade do terreno',
  //   source: { type: 'raster-dem', url: 'http://...' },
  //   bounds: [-45, -23, -44, -22],  // [west, south, east, north]
  //   paint: { 'raster-opacity': 0.7 },
  //   legend: {
  //     title: 'Classes de Declividade',
  //     items: [
  //       { type: 'polygon', color: '#00ff00', label: '0-5% (Plano)' },
  //       { type: 'polygon', color: '#ffff00', label: '5-15% (Suave)' },
  //       { type: 'polygon', color: '#ff9900', label: '15-30% (Moderado)' },
  //       { type: 'polygon', color: '#ff0000', label: '>30% (Forte)' }
  //     ]
  //   }
  // }
  analysisLayers: {
    enabled: true, // Feature flag global
    layers: [
    ]
  },

  // ===== DATA LAYERS (Molduras, etc.) =====
  // Camadas de dados vetoriais exibidas no catálogo na categoria "Dados"
  // Campos opcionais: labelSource, labelSourceLayer, labelMinzoom, style.fill, style.label, legend
  dataLayers: {
    enabled: true, // Feature flag global
    layers: [
      // ===== EXEMPLO SIMPLES (apenas borda) =====
      // Configuração mínima: apenas source, sourceLayer e border
      // {
      //   id: 'rodovias',
      //   name: 'Rodovias Federais',
      //   description: 'Malha rodoviária federal',
      //   source: {
      //     type: 'vector',
      //     url: 'http://IP:PORT/rodovias'
      //   },
      //   sourceLayer: 'rodovias',
      //   minzoom: 4,
      //   maxzoom: 18,
      //   style: {
      //     border: {
      //       color: '#E74C3C',
      //       width: 2,
      //       opacity: 1
      //     }
      //   },
      //   // legend é OPCIONAL - exibe botão de legenda na lista de camadas
      //   legend: {
      //     title: 'Rodovias',  // Título opcional (usa nome da camada se omitido)
      //     items: [
      //       { type: 'line', color: '#E74C3C', borderWidth: 2, label: 'Rodovia Federal' }
      //     ]
      //   }
      // },

      // ===== EXEMPLO COM RÓTULO (mesmo datasource) =====
      // Borda + rótulo usando o mesmo source (sem labelSource separado)
      // {
      //   id: 'limites_municipais',
      //   name: 'Limites Municipais',
      //   description: 'Divisão político-administrativa municipal',
      //   source: {
      //     type: 'vector',
      //     url: 'http://IP:PORT/limites_municipais'
      //   },
      //   sourceLayer: 'municipios',
      //   minzoom: 4,
      //   maxzoom: 18,
      //   labelMinzoom: 8,  // Rótulos aparecem a partir do zoom 8
      //   style: {
      //     border: {
      //       color: '#666666',
      //       width: 1.5,
      //       opacity: 0.8
      //     },
      //     label: {
      //       textField: ['get', 'nome'],  // Campo com o nome do município
      //       paint: {
      //         'text-color': '#333333',
      //         'text-halo-color': '#ffffff',
      //         'text-halo-width': 1
      //       }
      //     }
      //   }
      // },

      // ===== EXEMPLO COMPLETO (com labelSource separado e legenda) =====
      // Configuração avançada: fill, border, label com source separado
      // {
      //   id: 'moldura_25k',
      //   name: 'Moldura 1:25.000',
      //   description: 'Grade de articulação de cartas na escala 1:25.000',
      //   thumbnail: null,  // Usa thumbnail padrão
      //   source: {
      //     type: 'vector',
      //     url: 'http://IP:PORT/moldura_25k'
      //   },
      //   sourceLayer: 'situacao_25k',
      //   // labelSource é OPCIONAL - se omitido, usa o mesmo source principal
      //   labelSource: {
      //     type: 'vector',
      //     url: 'http://IP:PORT/moldura_ponto_25k'
      //   },
      //   labelSourceLayer: 'situacao_ponto_25k',
      //   minzoom: 5,
      //   maxzoom: 17,
      //   labelMinzoom: 9.8,
      //   style: {
      //     // fill é OPCIONAL
      //     fill: {
      //       color: [
      //         "case",
      //         ["==", ["get", "situacao_topo"], "Concluído"],
      //         "rgba(145,207,96,0.5)",
      //         ["==", ["get", "situacao_topo"], "Múltiplas edições"],
      //         "rgba(102,178,255,0.5)",
      //         "rgba(255, 0, 0, 0)"
      //       ]
      //     },
      //     border: {
      //       color: [
      //         'step', ['length', ['get', 'edicoes_orto']], '#aaaaaaff',
      //         8, 'rgba(145,207,96,1)',
      //         14, 'rgba(102,178,255,1)'
      //       ],
      //       width: [
      //         'step', ['length', ['get', 'edicoes_orto']], 0.5,
      //         8, 5,
      //         14, 5
      //       ]
      //     },
      //     // label é OPCIONAL
      //     label: {
      //       textField: [
      //         "concat",
      //         "MI ", ["get", "identificadorMI"], "\n",
      //         "INOM ", ["get", "identificadorINOM"]
      //       ]
      //     }
      //   },
      //   // ===== LEGENDA =====
      //   // Propriedades do item: type ('point'|'line'|'polygon'), color, borderColor, borderWidth, label, size
      //   legend: {
      //     title: 'Situação da Carta',
      //     items: [
      //       { type: 'polygon', color: 'rgba(145,207,96,0.5)', borderColor: '#91CF60', label: 'Concluído' },
      //       { type: 'polygon', color: 'rgba(102,178,255,0.5)', borderColor: '#66B2FF', label: 'Múltiplas edições' },
      //       { type: 'polygon', color: 'transparent', borderColor: '#aaaaaa', label: 'Não mapeado' }
      //     ]
      //   }
      // }
    ]
  },

  // ===== CONFIGURAÇÕES DO MAPA 2D =====
  map2d: {
    bounds: [
      [-58.1, -33.4], // [longitude_min, latitude_min]
      [-48.7, -27.1] // [longitude_max, latitude_max]
    ],
    minZoom: 1,              // Zoom mínimo permitido
    maxZoom: 17.9,           // Zoom máximo permitido
    maxPitch: 65,            // Inclinação máxima da câmera (0-60 graus)

    // Modo Globo
    globe_projection: true,

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

    // ----- Hillshade Layer -----
    hillshade: {
      enabled: false,
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

  // ===== 3D TILESETS & MODELS =====
  // Supported types: '3dtiles' (default) and 'glb'
  // 3D Tiles entries use: url (tileset.json), heightOffset
  // GLB entries use: url (.glb), position, heightOffset, rotation, scale
  tilesets: [
    {
      url: "/3d/PCL/tileset.json",
      heightOffset: 35,
      id: "PCL",
      name: "Posto de Comando Logístico",
      description: "Modelo 3D do Posto de Comando Logístico capturado por drone",
      data_captura: "15/03/2024",
      local: "Resende, RJ",
      previewVideo: "/3d/videos/preview.webm",
      previewThumbnail: "/3d/videos/thumbnail.jpg",
      // maximumScreenSpaceError: 16,  // Qualidade do modelo (menor = mais detalhado, default: 16)
      locate: {
        lon: -44.47332385414955,
        lat: -22.43976556982974,
        height: 1000
      }
    },
    // ===== GLB MODEL EXAMPLE =====
    {
      type: 'glb',                              // Required for GLB models
      id: "hangar-01",
      name: "Hangar Principal",
      description: "Modelo 3D do hangar",
      url: "/3d/models/TGL.glb",             // Path to .glb file
      position: {                                // Where to place the model
        lon: -44.42332,
        lat: -22.43976
      },
      heightOffset: 10,                           // Meters above ellipsoid
      rotation: {                                // Rotation in degrees
        heading: 180,                              // 0-360 compass bearing
        pitch: 0,                                // -90 to 90
        roll: 0                                  // -180 to 180
      },
      scale: 1.0,                                // Uniform scale factor
      maximumScale: 20000,                       // Max scale (optional)
      data_captura: "20/01/2025",
      local: "Resende, RJ",
      // previewThumbnail: "/3d/models/hangar-thumb.jpg",
      locate: {                                  // Camera fly-to position
        lon: -44.42332,
        lat: -22.43976,
        height: 500
      }
    }
  ],

  // ===== STREETVIEW 360 SETTINGS =====
  streetView360: {
    // API service URL for UUID-based access + progressive loading
    serviceUrl: 'http://localhost:8081/api/v1',

    // PMTiles sources for photo-level navigation (minimap + main map line click)
    pointsSource: {
      type: 'vector',
      url: 'http://localhost:3000/fotos'
    },
    pointsSourceLayer: 'fotos',
    linesSource: {
      type: 'vector',
      url: 'http://localhost:3000/fotos_linha'
    },
    linesSourceLayer: 'fotos_linha',
  }
};

export default config;
