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
  // A FAIXA DA APLICAÇÃO É FIXA, e desde 2026-08-31 ela NÃO é configurável (decisão do dono).
  // `config.admin.schemas.js` recusa as duas chaves com 422 nomeado, em vez de deixá-las cair
  // em `config_settings`, que é deep-merge SOBRE este documento, e portanto derrubaria o valor
  // fixo em silêncio. O único nível de zoom que um administrador ou um produtor ajusta é o do
  // MAPA BASE (`basemaps.config.minzoom`/`maxzoom`), que aperta dentro desta faixa e nunca a
  // afrouxa. Zoom de ATLAS não existe: existiu como contrato reservado e foi removido junto.
  //
  // O TETO ERA 17.9 e virou 21. O 17.9 estava ABAIXO do `maxzoom` de toda fonte de mapa base
  // (18 a 20), então era ele que segurava as cinco, e nenhuma chegava ao próprio limite. Subir
  // para 21 só é honesto porque as cinco linhas semeadas passaram a declarar a faixa delas
  // (`005_catalogo.sql`); sem isso, a mudança entregaria overzoom borrado em todas.
  minZoom: 2,
  maxZoom: 21,
  maxPitch: 65,
  globe_projection: true,
  // NÍVEL DE DETALHE DOS TILES COM A CÂMERA INCLINADA,
  // `[maxZoomLevelsOnScreen, tileCountMaxMinRatio]`, e `null` desde 2026-09-04, por decisão
  // do dono. `null` NÃO é omissão: significa "mantém o padrão do MapLibre", que é
  // `(9.314, 3)` e é o mais leve dos três valores já servidos aqui.
  //
  // O QUE FOI MEDIDO. O primeiro número diz quão depressa o zoom dos tiles cai rumo ao
  // horizonte, e quanto menor, mais tiles. Modelado com a inclinação de 60 graus que o botão
  // de terreno impõe, o par `[1, 10.0]` de um deploy pedia cerca de doze vezes os tiles do
  // padrão, e `[5, 6.0]` cerca de quatro. Na medida em Chromium, `[1, 10.0]` retinha oito
  // vezes os tiles raster do padrão e o dobro dos de terreno. Ninguém pediu mais detalhe no
  // horizonte, e o custo aparece justamente onde a máquina é fraca.
  //
  // O parâmetro também não alcança a fonte do DEM: o mesmo `calculateTileZoom` escolhe os
  // tiles internos de render-to-texture do terreno (issue #7699 do MapLibre, aberta).
  //
  // Quem lê isto no cliente é `applyTileLodParams` (`frontend/src/js/map/tile-lod.js`), que
  // valida antes de aplicar e reaplica depois de cada troca de mapa base; um primeiro valor
  // abaixo de 2 é recusado lá com aviso, e aqui em 422, por `config.admin.schemas.js`.
  sourceTileLodParams: null,
  // A BASE PREFERIDA ENQUANTO O TERRENO 3D ESTÁ LIGADO (2026-09-05). Recebe o id de uma
  // entrada do catálogo de mapas base, e `null` DESLIGA o mecanismo: sem a chave, o terreno
  // não toca na camada base, que é o que o produto faz desde sempre.
  //
  // POR QUE EXISTE. Medido em 2026-09-04 (`docs/wiki/desempenho-do-mapa-2d.md`, que aponta o
  // relatório com o número de cada causa): com o terreno ligado, uma base RASTER custa de
  // metade a um terço do quadro de uma VETORIAL (1 pilha de render-to-texture contra 2 ou 11)
  // e segura 60 fps parado na CPU quatro vezes mais lenta (19 ms contra 34 ms).
  //
  // POR QUE O PADRÃO É NULO. A base raster que compensa não vive em nenhuma das duas linhas
  // do produto: ela é gerada por implantação. Quem tem o mbtiles aponta a chave pelo painel
  // de administração, que é onde dado de implantação mora; quem não tem não paga nada.
  //
  // O QUE ELA COBRA. A base raster traz os rótulos gravados na imagem e cobre só o recorte
  // gerado; fora dele o mapa fica BRANCO, e é para isso que serve a chave de baixo.
  //
  // A troca NÃO é gravada como escolha do usuário nem enfileira op de sync (sai pelo mesmo
  // caminho do link compartilhado), e cede a ele: quem trocar de base com o terreno ligado
  // não tem a escolha desfeita ao desligar.
  terrainPreferredBasemap: null,
  // Cobertura da base acima, `[oeste, sul, leste, norte]` em graus. Com o centro da vista
  // FORA dela a troca não acontece, e o mapa fica onde estava. `null` vale como cobertura
  // global, que é o que todo mapa base deste catálogo tem hoje.
  //
  // Caixa que cruza o antimeridiano (oeste > leste) NÃO é tratada em lugar nenhum do produto,
  // e por isso morre em 422 na borda (`config.admin.schemas.js`) em vez de ser gravada: o
  // cliente a recusaria inteira e o mecanismo ficaria desligado em silêncio, com o painel
  // mostrando o valor salvo.
  terrainPreferredBasemapBounds: null,
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

/**
 * O que o visualizador 360 tem de configurável e não vem de env.
 *
 * Hoje é um campo só: qual MAPA BASE o mini-mapa desenha. A faixa de zoom dele NÃO mora aqui,
 * de propósito, e essa é a decisão (do dono, 2026-08-31): ela vem da linha de catálogo do mapa
 * base escolhido, que é o único lugar do produto onde zoom se configura. Um segundo par de
 * `minZoom`/`maxZoom` aqui seria um terceiro nível de zoom, e o produto acabou de reduzir três
 * a um.
 */
export const STREETVIEW360_BASE = {
  miniMapBasemap: 'osm',
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
 * A CAIXA DE COBERTURA (`bounds`) ENTRA POR UMA FORMA E NÃO PELA OUTRA, e a diferença é de
 * requisições: a forma TileJSON traz os `bounds` do próprio servidor, e a de TEMPLATE não traz
 * nada, então o MapLibre pede tile de DEM para toda posição da tela, tenha o modelo cobertura
 * ali ou não, e cada furo custa uma requisição mais um evento de erro. Não há env para isso
 * hoje, de propósito: quem serve por template serve por Martin, e o caminho barato é trocar a
 * URL de `{z}/{x}/{y}` pela `tiles.json` da mesma fonte. O `bounds` continua podendo entrar
 * pelo override do administrador, que é o que o editor "Avançado (JSON)" edita em
 * `map2d.terrainSource`.
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
