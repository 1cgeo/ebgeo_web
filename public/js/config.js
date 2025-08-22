// Path: js\config.js
// ===== CONFIGURAÇÃO COMPLETA DO SISTEMA MAPSIG =====
// Este arquivo centraliza todas as configurações do sistema de mapas 2D e 3D

const config = {
  // ===== CONFIGURAÇÕES GERAIS DA APLICAÇÃO =====
  app: {
    title: "EBGeo Exc Cbn Arandu",        // Título exibido na interface
    subtitle: "Exc Cbn Arandu"            // Subtítulo da aplicação
  },

  // ===== CONFIGURAÇÕES DE BUSCA =====
  search: {
    apiUrl: "http://localhost:3000/busca"  // URL da API de busca de features
  },

  export: {
    pdfApiUrl: "http://localhost:3001/api/export-georeferenced-pdf" // URL da API de exportação de PDF georreferenciado
  },

  // ===== CONFIGURAÇÕES DE VISIBILIDADE DE CAMADAS =====
  // Define quais camadas base extras são mostradas (OSM e Imagens)
  showOsmAndImages: false,  // true = mostra OSM e Imagens | false = apenas DSG

  // ===== CONFIGURAÇÕES DO MAPA 2D =====
  map2d: {
    // ----- Configurações Básicas do Mapa -----
    bounds: [
      [-44.4633992903047, -22.46265178239199],   // [longitude_min, latitude_min]
      [-44.439695820515325, -22.444666254876367] // [longitude_max, latitude_max]
    ],
    minZoom: 1,              // Zoom mínimo permitido
    maxZoom: 17.9,           // Zoom máximo permitido
    maxPitch: 65,            // Inclinação máxima da câmera (0-60 graus)
    
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
      //minzoom: 10,                                          // Zoom mínimo do terrain
      //maxzoom: 10                                           // Zoom máximo do terrain
      // Nota: Para URLs externas use: "https://example.com/terrain/{z}/{x}/{y}.png"
    },

    // ===== CONFIGURAÇÃO DO HILLSHADE SOURCE =====
    // Source separado para o efeito visual de relevo (pode ser o mesmo que terrain)
    hillshadeSource: {
      type: "raster-dem",                                    // Tipo: sempre "raster-dem"
      url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json",             // URL dos tiles de elevação
      tileSize: 256,
      //minzoom: 10,                                          // Zoom mínimo do hillshade
      //maxzoom: 10                                           // Zoom máximo do hillshade
    },

    // ===== CONFIGURAÇÃO DO TERRENO 3D =====
    // Controla a visualização 3D do terreno (toggle on/off)
    terrain: {
      source: 'terrainSource',                              // Nome do source a usar
      exaggeration: 1.5                                       // Multiplicador da elevação (1.0 = normal)
    },

    // ===== CONFIGURAÇÃO DO HILLSHADE =====
    // Efeito visual de sombreamento do relevo
    hillshade: {
      enabled: true,                                        // true = ativa hillshade | false = desativa
      
      // Configuração da camada hillshade
      layer: {
        id: 'hillshade',                                    // ID da camada (não alterar)
        type: 'hillshade',                                  // Tipo da camada (não alterar)
        source: 'hillshadeSource',                          // Source a usar (não alterar)
        //minzoom: 10,                                        // Zoom mínimo da camada
        //maxzoom: 10,                                        // Zoom máximo da camada
        
        // Propriedades visuais do hillshade
        paint: {
          'hillshade-method': 'standard',                   // Método: 'standard' ou 'texture'
          'hillshade-illumination-direction': 315,          // Direção da luz (0-360 graus)
          'hillshade-shadow-color': 'rgba(0, 0, 0, 0.5)',              // Cor das sombras (hex)
          'hillshade-highlight-color': 'rgba(255, 255, 255, 0.5)',           // Cor dos realces (hex)
          'hillshade-accent-color': 'rgba(0, 0, 0, 0.5)',              // Cor dos acentos (hex)
          'hillshade-exaggeration': 0.5                     // Intensidade do relevo (0.0-1.0)
          // Dica: 0.2 = sutil, 0.5 = moderado, 0.8 = intenso
        }
      },
      
      // Define quais camadas base mostram o hillshade
      baseLayers: ['carta-topografica']                     // Array com IDs das camadas base
      // Opções: ['carta-topografica', 'carta-ortoimagem', 'osm', 'imagens']
    },
  },

  // ===== CONFIGURAÇÕES DO MAPA 3D (CESIUM) =====
  map3d: {
    // ----- Limites Geográficos 3D -----
    bounds: {
      west: -44.449656,      // Longitude oeste
      south: -22.455922,     // Latitude sul
      east: -44.449654,      // Longitude leste  
      north: -22.455920      // Latitude norte
    },

    // ----- Posição Inicial da Câmera -----
    initialCamera: {
      longitude: -44.4481491,     // Longitude inicial
      latitude: -22.4546061,      // Latitude inicial
      height: 424.7,              // Altura em metros
      heading: 164,               // Direção da câmera (0-360 graus)
      pitch: -2,                  // Inclinação (-90 a 90 graus)
      roll: -1                    // Rotação (-180 a 180 graus)
    },

    // ----- Configurações da Interface 3D -----
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
    },

    // ----- Provedores de Dados 3D -----
    providers: {
      // ===== PROVIDER DE IMAGENS 3D =====
      imagery: {
        enabled: true,          // true = usa imagery local | false = desabilita
        type: 'UrlTemplate',    // Tipos: 'UrlTemplate', 'WMS', 'SingleTile'
        url: 'http://localhost/raster/data/aman_esa_alta_resolucao_2_data/{z}/{x}/{y}.png',
        options: {
          maximumLevel: 18,     // Nível máximo de zoom
          minimumLevel: 0,      // Nível mínimo de zoom
          tileWidth: 256,       // Largura dos tiles
          tileHeight: 256,      // Altura dos tiles
        }
      },

      // ===== PROVIDER DE TERRENO 3D =====
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

  // ===== CONFIGURAÇÃO DE TILESETS 3D =====
  // Modelos 3D para carregar no mapa (3d tiles)
  tilesets: [
    {
      url: "/3d/PCL/tileset.json",                     // Caminho para o tileset
      heightOffset: 35,                                // Offset de altura em metros
      id: "PCL",                                       // ID único do tileset
      name: "PCL",                                     // Nome para exibição
      locate: { 
        lon: -44.47332385414955,                       // Longitude para localizar
        lat: -22.43976556982974,                       // Latitude para localizar
        height: 1000                                   // Altura da câmera
      }
    }
    // Adicione mais tilesets aqui seguindo o mesmo padrão
  ]
};

// ===== FUNÇÕES AUXILIARES =====
// Não modificar essas funções

// Verifica se há tilesets configurados
config.hasTilesets = () => config.tilesets && config.tilesets.length > 0;

// Retorna o tileset padrão (primeiro da lista ou marcado como default)
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