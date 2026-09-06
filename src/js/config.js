// Path: js/config.js

// ===== MAPSIG SYSTEM CONFIGURATION =====

// Base PUBLICA da API do servico de imagens panoramicas (ebgeo_360). Um lugar
// so a trocar por ambiente: metadado, imagem, tile de ponto e tracado saem
// todos daqui.
//
// INCLUI O /api/v1 DE PROPOSITO. Em producao o servico e publicado num prefixo
// que OCUPA o lugar dele: o proxy recebe `/ebgeo_360/...` e repassa
// `/api/v1/...`, entao la o valor e '/ebgeo_360'. Com o /api/v1 espalhado pelas
// URLs de baixo, trocar de ambiente exigiria editar cada uma, e basta esquecer
// uma para o sintoma virar 404 numa camada so.
//
// PODE SER RELATIVA ('/ebgeo_360'), porque a linha de baixo a torna absoluta
// contra a origem da pagina. Absoluta ela TEM de ficar, e a razao nao e estilo:
// o MapLibre pede o tile de dentro de um worker que ele cria de um blob
// (`setWorkerUrl(URL.createObjectURL(new Blob([...])))` no bundle). La dentro a
// base e a URL `blob:`, contra a qual nao se resolve caminho relativo, e o
// pedido morre em "Failed to construct 'Request': Failed to parse URL from
// /ebgeo_360/...". Foto, planta e tracado nao passam por isso porque saem da
// thread principal, que tem a base do documento: caminho relativo funcionaria
// para eles e quebraria so o tile, que e o pior modo de falhar.
//
// O PADRAO E PRODUCAO, e o desenvolvimento e que e a excecao. A inversao e
// deliberada. Antes a linha trazia `localhost` fixo, e o valor de producao vivia
// numa edicao a mao que nunca entrou no git: nenhum commit deste arquivo jamais
// teve o prefixo publico, e o `deploy/deploy.sh` chama `vite build` puro, sem
// substituir nada. Bastava alguem construir de um checkout limpo para a EBNET
// inteira receber `http://localhost:8081`, e o 360 morrer sem um erro no
// console. Com o padrao invertido, esquecer a edicao passa a ser inofensivo, e
// so o servidor de desenvolvimento pega a excecao.
//
// `import.meta.env.DEV` e do Vite, e ja e idioma da casa (ver
// src/js/import_export/pdf-export.tab.js). Ele e substituido em tempo de
// construcao, entao o ramo nao usado nem entra no pacote.
const STREETVIEW_360_BASE_BRUTA = import.meta.env.DEV
  ? 'http://localhost:8081/api/v1'
  : '/ebgeo_360';

// `globalThis.location` nao existe sob o vitest, que roda em ambiente node
// (vitest.config.js). Sem a origem, fica o valor cru, que no desenvolvimento ja
// e absoluto.
const STREETVIEW_360_BASE = (globalThis.location?.origin
  ? new URL(STREETVIEW_360_BASE_BRUTA, globalThis.location.origin).toString()
  : STREETVIEW_360_BASE_BRUTA
).replace(/\/+$/, '');

// Base PUBLICA da API do servico de modelos 3D (ebgeo_3d). Mesmo desenho da
// STREETVIEW_360_BASE acima, e pelas mesmas razoes: um lugar so a trocar por
// ambiente, o /api/v1 embutido porque em producao o prefixo do proxy o ocupa, e
// o padrao apontando PRODUCAO para que esquecer a edicao seja inofensivo.
//
// O tileset e a miniatura sao endereados a partir DAQUI, e nunca da URL que o
// servico publica no proprio catalogo. Ele nao enxerga o prefixo sob o qual e
// publicado, entao a URL que ele monta responde 404 do lado de fora. E o mesmo
// defeito que o tile do 360 pagou.
const MODELS_3D_BASE_BRUTA = import.meta.env.DEV
  ? 'http://localhost:8082/api/v1'
  : '/ebgeo_3d';

const MODELS_3D_BASE = (globalThis.location?.origin
  ? new URL(MODELS_3D_BASE_BRUTA, globalThis.location.origin).toString()
  : MODELS_3D_BASE_BRUTA
).replace(/\/+$/, '');

const config = {
  // ===== APPLICATION SETTINGS =====
  app: {
    title: "EBGeo",        // Título exibido na interface
    tutorialUrl: './docs/doc.html',  // URL do tutorial (abre em nova janela)
    // Aviso de servidor secundário. Com `true`, a aplicação abre ao iniciar uma tela
    // avisando que esta instância é o servidor secundário do EBGeo (1° CGEO, Porto
    // Alegre) e recomendando o principal, ebgeo.dsg.eb.mil.br (7° CTA, Brasília).
    // Chave ausente, ou qualquer valor diferente de `true`, vale como false.
    avisoServidorSecundario: false
  },

  features: {
    map_3d: true,                 // Habilita/desabilita visualizador 3D
    imagens_panoramicas: true,    // Habilita/desabilita street view control
    apisearch: false,             // Habilita/desabilita busca via API externa
    grid: false,                  // Habilita/desabilita grid
  },

  // ===== SERVICES =====
  services: {
    tileServerUrl: ''  // URL do servidor de tiles vetoriais (ex: 'http://10.0.0.5:7800')
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
      image: './images/layers/carta-topografica-thumb.webp',  // Imagem opcional para o painel
      priority: 1
    },
    'carta-ortoimagem': {
      enabled: true,
      name: 'Ortoimagem',
      image: './images/layers/carta-ortoimagem-thumb.webp',   // Imagem opcional para o painel
      priority: 2
    },
    'bdgex': {
      enabled: true,
      name: 'BDGEx',
      image: './images/layers/bdgex-thumb.webp',              // Imagem opcional para o painel
      priority: 3
    },
    'osm': {
      enabled: false,
      name: 'OSM',
      // image: './images/layers/osm-thumb.webp',             // Sem imagem - usa fallback
      priority: 4
    },
    'imagens': {
      enabled: false,
      name: 'Imagens',
      // image: './images/layers/imagens-thumb.webp',         // Sem imagem - usa fallback
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
      //     url: 'http://TILE_SERVER/rodovias'
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
      //     url: 'http://TILE_SERVER/limites_municipais'
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
      //     url: 'http://TILE_SERVER/moldura_25k'
      //   },
      //   sourceLayer: 'situacao_25k',
      //   // labelSource é OPCIONAL - se omitido, usa o mesmo source principal
      //   labelSource: {
      //     type: 'vector',
      //     url: 'http://TILE_SERVER/moldura_ponto_25k'
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

    // Nível de detalhe dos tiles com a câmera inclinada:
    // [maxZoomLevelsOnScreen, tileCountMaxMinRatio], aplicado a TODAS as fontes e
    // reaplicado a cada troca de mapa base. `null` mantém o padrão do MapLibre
    // (9.314, 3), que é o mais leve: o zoom dos tiles cai rumo ao horizonte.
    // Um primeiro valor abaixo de 2 DESLIGA essa queda e é recusado (o par
    // [1, 10.0] pedia ~12x os tiles do padrão com inclinação de 60 graus).
    // Valores entre [7, 4] e o padrão dão mais detalhe no horizonte a custo de tiles.
    sourceTileLodParams: null,

    // Base preferida enquanto o terreno 3D está ligado. Recebe o id de uma
    // entrada de `basemaps` (acima), e `null` DESLIGA o mecanismo: sem chave, o
    // terreno não toca na camada base, que é o padrão deste repositório.
    //
    // POR QUE EXISTE. Medido em 2026-09-04 (docs/desempenho-terreno-2026-09-04.md):
    // com o terreno ligado, uma base RASTER custa de metade a um terço do quadro
    // de uma base VETORIAL (1 pilha de RTT contra 2 ou 11) e segura 60 fps parado
    // na CPU quatro vezes mais lenta (19 ms contra 34 ms).
    //
    // POR QUE O PADRÃO É NULO. A base raster que compensa não vive aqui: ela é
    // gerada por implantação, e este repositório não tem nenhuma. Quem tem o
    // mbtiles aponta a chave; quem não tem não paga nada por ela.
    //
    // O QUE ELA COBRA. A base raster traz os rótulos gravados na imagem e cobre
    // só o recorte gerado; fora dele o mapa fica BRANCO, e é para isso que serve
    // a chave de baixo.
    //
    // A troca NÃO é gravada como escolha do usuário (sai pelo mesmo caminho do
    // link compartilhado), e cede a ele: quem trocar de base com o terreno ligado
    // não tem a escolha desfeita ao desligar.
    terrainPreferredBasemap: null,

    // Cobertura da base acima, [oeste, sul, leste, norte] em graus. Com o centro
    // da vista FORA dela a troca não acontece, e o mapa fica onde estava. `null`
    // vale como cobertura global. Caixa que cruza o antimeridiano (oeste > leste)
    // NÃO é tratada, e declará-la assim desliga a troca.
    terrainPreferredBasemapBounds: null,

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
      // bounds: [west, south, east, north],              // Cobertura do DEM. SEM bounds o mapa
      //                                                  // pede tile do mundo inteiro (fonte com
      //                                                  // `tiles:` nao traz bounds do servidor)
      // minzoom: 10,                                          // Zoom mínimo do terrain
      // maxzoom: 10                                           // Zoom máximo do terrain
      // Nota: Para URLs externas use: "https://example.com/terrain/{z}/{x}/{y}.png"
    },

    // ----- Hillshade Source -----
    hillshadeSource: {
      type: "raster-dem",                                    // Tipo: sempre "raster-dem"
      url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json",             // URL dos tiles de elevação
      tileSize: 256,
      // bounds: [west, south, east, north],              // Mesma cobertura do terrainSource
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

  // ===== SERVICO DE MODELOS 3D (ebgeo_3d) =====
  //
  // Um endereco so. O catalogo, a miniatura, o video de previa, o ponto de
  // navegacao e o offset de altura de cada modelo saem daqui, e nao deste
  // arquivo. Ver `models-api.service.js`.
  //
  // Deixe `serviceUrl` vazio para desligar: a feature `map_3d` cai sozinha se
  // nao houver modelo servido nem modelo local declarado abaixo.
  models3d: {
    serviceUrl: MODELS_3D_BASE
  },

  // ===== 3D TILESETS & MODELS =====
  //
  // ESTE ARRAY E PREENCHIDO PELO SERVICO, e nao a mao. O
  // `models-api.service.js` busca `/api/v1/models` do ebgeo_3d na partida e
  // CONCATENA o resultado ao que estiver declarado aqui. Antes cada modelo
  // entrava a mao neste arquivo, com URL, nome, descricao, palavras-chave,
  // ponto de navegacao, offset de altura e miniatura, e o mapa so o enxergava
  // depois de um redeploy do frontend. E o mesmo defeito que o 360 pagou com os
  // PMTiles, e a saida e a mesma.
  //
  // O QUE CONTINUA ENTRANDO AQUI: modelo servido como ARQUIVO ESTATICO, que o
  // ebgeo_3d nao cobre. O caso vivo e o `type: 'glb'`, um modelo pontual solto
  // em `public/3d/models/`. Tileset 3D Tiles de acervo vai para o servico.
  //
  // Types: '3dtiles' (default) e 'glb'.
  //   3D Tiles: url (tileset.json), heightOffset
  //   GLB: url (.glb), position, heightOffset, rotation, scale
  tilesets: [
    // EXEMPLO, e nao modelo publicado. Descomente e troque os valores para
    // servir um GLB solto de `public/3d/models/`. Ele ficou ATIVO por engano
    // ate 2026-08-22, e aparecia no catalogo como "Hangar Principal" apontando
    // um arquivo que nao existe.
    // ===== GLB MODEL EXAMPLE =====
    // {
      // type: 'glb',                              // Required for GLB models
      // id: "hangar-01",
      // name: "Hangar Principal",
      // description: "Modelo 3D do hangar",
      // keywords: ["TGL", "hangar"],           // Optional: extra searchable terms
      // url: "/3d/models/TGL.glb",             // Path to .glb file
      // position: {                                // Where to place the model
        // lon: -44.42332,
        // lat: -22.43976
      // },
      // heightOffset: 10,                           // Meters above ellipsoid
      // rotation: {                                // Rotation in degrees
        // heading: 180,                              // 0-360 compass bearing
        // pitch: 0,                                // -90 to 90
        // roll: 0                                  // -180 to 180
      // },
      // scale: 1.0,                                // Uniform scale factor
      // maximumScale: 20000,                       // Max scale (optional)
      // data_captura: "20/01/2025",
      // local: "Resende, RJ",
      // previewThumbnail: "/3d/models/hangar-thumb.jpg",
      // locate: {                                  // Camera fly-to position
        // lon: -44.42332,
        // lat: -22.43976,
        // height: 500
      // }
    // }
  ],

  // ===== 3D PRIMEIRA PESSOA (GAUSSIAN SPLATTING) =====
  //
  // ESTE ARRAY E PREENCHIDO PELO SERVICO, e nao a mao. O
  // `models-api.service.js` busca `/api/v1/scenes.json` do ebgeo_3d na partida,
  // no MESMO preflight dos modelos, e substitui o que estiver aqui.
  //
  // Cada cena e uma PASTA que a pipeline produz de uma vez, com nomes fixos
  // dentro: o splat (`cena.sog`), o octree de colisao (`voxel/`), as fichas
  // curadas (`marcadores.json`), as fotos delas (`itens/`) e as duas previas.
  // O servico publica UM `basePath`, e o
  // `first_person_3d_tool/scene-config.service.js` deriva os sete enderecos
  // dele. Sao sete chances de errar um, e o erro nao seria barulhento: o splat
  // carrega, o `voxel-meta.json` volta 404, e a cena abre bonita com a colisao
  // desligada, com o visitante atravessando parede.
  //
  // O QUE MUDOU AO SAIR DAQUI. Antes as cenas viviam em `public/3d/`, que esta
  // no .gitignore: num checkout limpo a pasta nao existia, a cena continuava
  // declarada, o pino roxo APARECIA no mapa e so falhava quando alguem clicava
  // para entrar. Agora quem responde pela existencia da cena e o servico que a
  // guarda.
  //
  // Deixe `models3d.serviceUrl` vazio para desligar as duas coisas de uma vez.
  firstPerson3d: {
    enabled: true,
    scenes: []
  },

  // ===== STREETVIEW 360 SETTINGS =====
  //
  // As tres camadas do 360 (pontos, linhas e planta baixa) saem do MESMO
  // servico, o ebgeo_360, que le direto do index.db. Antes os pontos e as linhas
  // vinham de dois arquivos PMTiles servidos pelo Martin, e so a planta vinha da
  // API: o mapa so enxergava uma calibracao nova depois de alguem regerar os
  // tiles e redeployar. Agora ha um endereco so a trocar, e nao ha defasagem.
  streetView360: {
    // API service URL for UUID-based access + progressive loading
    serviceUrl: STREETVIEW_360_BASE,

    // Pontos: tile vetorial gerado sob demanda a partir do indice espacial.
    //
    // `tiles` EM VEZ DE `url`, e nao e questao de gosto. Com `url` o MapLibre
    // busca o TileJSON e usa a URL de tile que vem DENTRO dele, escrita pelo
    // servico. O servico nao tem como escreve-la certo: em producao ele esta
    // publicado num prefixo (`/ebgeo_360/`) que o proxy reescreve para
    // `/api/v1/` antes de repassar, entao o pedido chega la sem qualquer
    // vestigio do prefixo. Esquema e host viajam em cabecalho, o pedaco do
    // caminho nao viaja. O resultado era 404 no tile, que o MapLibre trata como
    // tile vazio: minimapa sem ponto e console limpo.
    //
    // Declarando aqui, o endereco do tile nasce da MESMA base que ja endereca a
    // foto, a planta e os andares, e que so este arquivo conhece. Nenhum
    // endereco nasce no servidor.
    //
    // O PRECO e a faixa de zoom, que o TileJSON declarava e agora se repete
    // aqui. Ela espelha ZOOM_MIN e ZOOM_MAX de src/routes/tiles.js no ebgeo_360:
    // mexeu la, mexa aqui. Fora da faixa o MapLibre sobrepassa o tile de z12, que
    // e o que o minimapa ja fazia ate 17,9.
    pointsSource: {
      type: 'vector',
      tiles: [`${STREETVIEW_360_BASE}/tiles/fotos/{z}/{x}/{y}.pbf`],
      minzoom: 11,
      maxzoom: 12
    },
    pointsSourceLayer: 'fotos',

    // Linhas: GeoJSON unico, e nao tile. O acervo inteiro de tracado sao 3.236
    // feicoes, 0,3 MB comprimido, MENOS que os 712 KB do fotos_linha.pmtiles, e
    // sem a perda de vertice que a simplificacao do tippecanoe impunha.
    linesSource: {
      type: 'geojson',
      data: `${STREETVIEW_360_BASE}/tracks`
    },
    linesSourceLayer: 'fotos_linha',
  }
};

export default config;
