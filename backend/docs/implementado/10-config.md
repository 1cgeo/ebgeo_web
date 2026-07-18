# 10 - Config Dinâmico (`GET /api/v1/config`)

Este documento cobre o endpoint **público** que substitui o `config.js` estático do
frontend. Em vez de embarcar URLs de servidores e catálogos de basemaps/tilesets no
build do `ebgeo_web`, o frontend faz um `fetch('/api/config')` no boot e recebe, em
runtime, um JSON com o **mesmo shape** que o antigo `config.js` exportava. Assim o
operador troca servidores (OSM/BDGEx/busca/360/tiles) e edita o catálogo (basemaps,
camadas, tilesets) **sem rebuild do frontend**.

O payload é montado a partir de **três fontes**:

1. **Tabela `resources`** (dados editáveis em runtime) — basemaps, camadas de
   análise, camadas de dados e tilesets.
2. **Variáveis de ambiente** (`config.appConfig`) — URLs de serviços e tiles,
   injetadas por deployment.
3. **Defaults estáticos de UI** (`config.static.js`) — `app`, `features`, `map2d`,
   `map3d` e os styles MapLibre dos basemaps.

> **Contrato congelado**: as **12 chaves de topo** (`app`, `features`, `services`,
> `search`, `basemaps`, `analysisLayers`, `dataLayers`, `map2d`, `map3d`, `tilesets`,
> `streetView360`, `basemapStyles`) + `assets3dBaseUrl` reproduzem o shape exato que o
> `config.helpers.js` do frontend consome. Não renomeie, remova nem aninhe chaves sem
> alinhar com o frontend — qualquer divergência quebra os call-sites existentes.

---

## Visão Geral

```
Cliente (frontend)               Backend
   |                                |
   |  [Boot da aplicação]           |
   |                                |
   |-- GET /api/config ------------>|  (sem auth — funciona anônimo/offline)
   |                                |
   |                                |-- monta payload de 3 fontes:
   |                                |     resources (DB) + env URLs + UI estática
   |                                |
   |<-- 200 -----------------------|
   |   { data: { app, features,     |
   |     basemaps, tilesets,        |
   |     map2d, map3d, ... } }      |
   |                                |
   [Frontend faz merge sobre o      |
    config.js local (fallback)]     |
```

A constraint fundamental do EBGeo — **a aplicação funciona identicamente para
usuários não autenticados** — vale aqui: o endpoint é **público** (montado antes do
middleware de auth) e o payload nunca carrega segredo, só URLs de rede e preferências
de UI. Se o backend estiver indisponível, o frontend mantém o `config.js` local como
fallback.

---

## 1. Obter a configuração

### Endpoint

`GET /api/v1/config`

Alias de compatibilidade: `GET /api/config` (mesmo router, mesma resposta).

- **Auth**: Não (público).
- **Cache**: `Cache-Control: no-cache` — a config muda raramente, mas pode ser
  editada em runtime via `/resources`; sem cache agressivo, as edições propagam na
  requisição seguinte.

### Request

Sem corpo, sem query, sem header obrigatório:

```http
GET /api/v1/config HTTP/1.1
Host: ebgeo.example.mil.br
```

### Response (200)

O envelope segue o padrão do repositório: o objeto de config vem dentro de `data`.
O frontend lê `(await res.json()).data`.

```json
{
  "data": {
    "app": {
      "title": "EBGeo",
      "tutorialUrl": "./docs/doc.html"
    },
    "features": {
      "map_3d": true,
      "imagens_panoramicas": true,
      "apisearch": false,
      "grid": false
    },
    "services": {
      "tileServerUrl": ""
    },
    "search": {
    },
    "assets3dBaseUrl": "/api/v1/assets3d",
    "basemaps": {
      "carta-topografica": {
        "name": "Topográfica",
        "enabled": true,
        "image": "./images/layers/carta-topografica-thumb.png",
        "priority": 1
      },
      "carta-ortoimagem": {
        "name": "Ortoimagem",
        "enabled": true,
        "image": "./images/layers/carta-ortoimagem-thumb.png",
        "priority": 2
      },
      "bdgex": {
        "name": "BDGEx",
        "enabled": true,
        "image": "./images/layers/bdgex-thumb.png",
        "priority": 3
      },
      "osm": { "name": "OSM", "enabled": false, "priority": 4 },
      "imagens": { "name": "Imagens", "enabled": false, "priority": 5 }
    },
    "analysisLayers": {
      "enabled": true,
      "layers": [
        { "id": "hillshade", "name": "Sombreamento do Relevo" }
      ]
    },
    "dataLayers": {
      "enabled": true,
      "layers": []
    },
    "map2d": {
      "bounds": [[-58.1, -33.4], [-48.7, -27.1]],
      "minZoom": 1,
      "maxZoom": 17.9,
      "maxPitch": 65,
      "globe_projection": true,
      "sourceTileLodParams": [5, 6.0],
      "hillshade": {
        "enabled": false,
        "name": "Sombreamento do Relevo",
        "description": "Visualização de relevo sombreado baseada em modelo digital de elevação",
        "thumbnail": null,
        "layer": {
          "id": "hillshade",
          "type": "hillshade",
          "source": "hillshadeSource",
          "paint": {
            "hillshade-method": "standard",
            "hillshade-illumination-direction": 315,
            "hillshade-shadow-color": "rgba(0, 0, 0, 0.5)",
            "hillshade-highlight-color": "rgba(255, 255, 255, 0.5)",
            "hillshade-accent-color": "rgba(0, 0, 0, 0.5)",
            "hillshade-exaggeration": 0.5
          },
          "layout": { "visibility": "visible" }
        }
      },
      "terrainSource": {
        "type": "raster-dem",
        "url": "https://demotiles.maplibre.org/terrain-tiles/tiles.json",
        "tileSize": 256
      },
      "hillshadeSource": {
        "type": "raster-dem",
        "url": "https://demotiles.maplibre.org/terrain-tiles/tiles.json",
        "tileSize": 256
      }
    },
    "map3d": {
      "bounds": { "west": -58.1, "south": -33.8, "east": -48.0, "north": -22.5 },
      "viewer": {
        "infoBox": false,
        "vrButton": false,
        "geocoder": false,
        "homeButton": false,
        "sceneModePicker": false,
        "baseLayerPicker": false,
        "navigationHelpButton": true,
        "animation": false,
        "timeline": false,
        "fullscreenButton": false
      },
      "providers": {
        "imagery": {
          "enabled": true,
          "type": "UrlTemplate",
          "url": "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "options": { "maximumLevel": 18, "minimumLevel": 0, "tileWidth": 256, "tileHeight": 256 }
        },
        "terrain": {
          "enabled": true,
          "type": "Cesium",
          "url": "http://localhost/terrain/tilesets/terrain",
          "options": { "requestVertexNormals": true }
        }
      }
    },
    "tilesets": [
      {
        "id": "PCL",
        "name": "Posto de Comando Logístico",
        "url": "/3d/PCL/tileset.json",
        "heightOffset": 35,
        "description": "Modelo 3D do Posto de Comando Logístico capturado por drone",
        "keywords": ["PCL", "posto comando", "logística", "drone"],
        "data_captura": "15/03/2024",
        "local": "Resende, RJ",
        "previewVideo": "/3d/videos/preview.webm",
        "previewThumbnail": "/3d/videos/thumbnail.jpg",
        "locate": { "lon": -44.47332385414955, "lat": -22.43976556982974, "height": 1000 }
      }
    ],
    "streetView360": {
      "serviceUrl": "http://localhost:3000/api/v1/sv360",
      "pointsSource": {
        "type": "vector",
        "tiles": ["http://localhost:3000/api/v1/sv360/tiles/{z}/{x}/{y}.pbf"]
      },
      "pointsSourceLayer": "fotos",
      "linesSource": {
        "type": "vector",
        "tiles": ["http://localhost:3000/api/v1/sv360/tiles/{z}/{x}/{y}.pbf"]
      },
      "linesSourceLayer": "fotos_linha"
    },
    "basemapStyles": {
      "carta-topografica": { "version": 8, "glyphs": "...", "sources": { "...": {} }, "layers": [] },
      "osm": { "version": 8, "glyphs": "...", "sources": { "...": {} }, "layers": [] },
      "bdgex": { "version": 8, "glyphs": "...", "sources": { "...": {} }, "layers": [] },
      "imagens": { "version": 8, "glyphs": "...", "sources": { "...": {} }, "layers": [] },
      "carta-ortoimagem": { "version": 8, "glyphs": "...", "sources": { "...": {} }, "layers": [] }
    }
  }
}
```

> Os valores de URL acima são os **defaults DEV-only** (placeholders públicos). Em
> produção militar eles são substituídos por servidores internos da DGEO via
> variáveis de ambiente (ver [§5](#5-variáveis-de-ambiente)). O `basemapStyles` está
> resumido no exemplo — cada entrada é um style MapLibre completo (`version: 8`,
> `glyphs`, `sources`, `layers`); o detalhe está em [§4](#4-basemapstyles-styles-maplibre).

---

## 2. As chaves de topo, fonte a fonte

| Chave | Fonte | Tipo | Observação |
|-------|-------|------|------------|
| `app` | estática | objeto | `title`, `tutorialUrl` |
| `features` | estática | objeto | feature flags globais (`map_3d`, `imagens_panoramicas`, `apisearch`, `grid`) |
| `services` | env | objeto | `tileServerUrl` |
| `search` | env | objeto | `apiUrl` (busca de feições) |
| `assets3dBaseUrl` | env | string | base que o frontend resolve contra `url`s 3D relativos |
| `basemaps` | `resources` | **objeto** chaveado por id | catálogo de camadas base |
| `analysisLayers` | `resources` | `{ enabled, layers[] }` | camadas raster de análise |
| `dataLayers` | `resources` | `{ enabled, layers[] }` | camadas vetoriais (molduras etc.) |
| `map2d` | estático + env | objeto | defaults de viewport + `terrain/hillshade` source por env |
| `map3d` | estático + env | objeto | viewer Cesium + `providers.imagery/terrain` por env |
| `tilesets` | `resources` | **array** | modelos 3D (3D Tiles e GLB) |
| `streetView360` | env | objeto | serviço de panoramas + fonte vetorial MVT |
| `basemapStyles` | estática + env | objeto chaveado por id | styles MapLibre dos basemaps |

> **Atenção ao tipo de `basemaps` vs `tilesets`** (contrato congelado): `basemaps`
> é um **objeto** indexado por id (o frontend faz `config.basemaps[id]`), enquanto
> `tilesets` é um **array**. Não troque um pelo outro.

### Notas de integração no frontend

- `assets3dBaseUrl` resolve os `url` relativos do catálogo 3D (ex.: `/3d/PCL/tileset.json`
  vira `${assets3dBaseUrl}/3d/PCL/tileset.json`).
- `streetView360.serviceUrl` é a base que o cliente concatena com os caminhos do
  módulo 360 (imagem, metadados, thumbnails).
- Faça **merge** do payload remoto sobre o `config.js` local: se uma chave faltar
  (deploy antigo), o default local cobre.

---

## 3. Dados editáveis em runtime: a tabela `resources`

`basemaps`, `analysisLayers.layers`, `dataLayers.layers` e `tilesets` vêm da tabela
`resources` (categorias `basemap`, `analysis_layer`, `data_layer`, `tileset`). Cada
linha tem `id`, `name`, `config` (JSONB livre), `active` e `sort_order`. O endpoint só
inclui linhas com `active = true`, ordenadas por `sort_order`, e mescla o JSONB
`config` no objeto de saída. Para `analysisLayers`, `dataLayers` e `tilesets` cada
item é `{ id, name, ...config }`; para `basemaps` o `id` vira a chave do objeto e o
valor é `{ name, ...config }` (sem campo `id`).

Isso significa que **editar a config visível pelo frontend não exige mudança de
código nem redeploy**: basta editar a linha em `resources` (via o CRUD admin de
`/api/v1/resources` — ver [09 - Administração](./09-admin.md)). A próxima chamada a
`GET /config` já reflete a alteração.

**Mapeamento `config.js` ↔ `resources`:**

| Campo no payload | Coluna em `resources` |
|------------------|-----------------------|
| `enabled` (em `config`) | `config.enabled` |
| `name` | `name` |
| `priority` (em `config`) | `config.priority` (e `sort_order` para ordenação) |
| `image`, `url`, `paint`, `locate`, ... | `config` (JSONB) |

> O catálogo de seed traz 5 basemaps (`carta-topografica`, `carta-ortoimagem`,
> `bdgex`, `osm`, `imagens`), 1 analysis layer (`hillshade`) e 1 tileset (`PCL`). Os
> basemaps `osm` e `imagens` vêm com `enabled: false` por padrão.

---

## 4. `basemapStyles` (styles MapLibre)

Cada basemap precisa de um **style MapLibre** completo (`version`, `glyphs`,
`sources`, `layers`) para ser renderizado. Esses styles são montados pelo backend a
partir de templates estáticos, com as URLs de tile/glyphs **injetadas por ambiente** —
assim o servidor de tiles pode ser interno sem mudar o código.

São servidos **5 styles**, indexados pelo id do basemap:

| id | Fonte de tiles (env) |
|----|----------------------|
| `carta-topografica` | `OSM_TILE_URL` |
| `osm` | `OSM_TILE_URL` |
| `bdgex` | `BDGEX_WMS_URL` |
| `imagens` | `IMAGENS_TILE_URL` |
| `carta-ortoimagem` | `ORTOIMAGEM_TILE_URL` |

Exemplo de um style (`osm`):

```json
{
  "version": 8,
  "glyphs": "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  "sources": {
    "osm": {
      "type": "raster",
      "tiles": ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
      "tileSize": 256,
      "attribution": "&copy; OpenStreetMap Contributors",
      "maxzoom": 19
    }
  },
  "layers": [{ "id": "osm", "type": "raster", "source": "osm" }]
}
```

> **Pegadinha histórica**: no `config.js` antigo, as URLs reais dos tiles dos
> basemaps **não** estavam no próprio `config.js` — moravam em módulos separados de
> `baselayers/*.js`. O endpoint as absorve aqui, em `basemapStyles`, para servir 100%
> da config num só lugar. Os placeholders públicos (OSM, Google, BDGEx, demotiles)
> **não vão para produção** — reaponte para os servidores internos via env.

---

## 5. `streetView360` como fonte vetorial (MVT)

O overlay de panoramas 360 é uma **fonte vetorial renderizada pelo próprio backend**
(PostGIS `ST_AsMVT`), servida em `${serviceUrl}/tiles/{z}/{x}/{y}.pbf`. Cada tile
carrega **duas camadas**:

- `fotos` — pontos das fotos (use `pointsSourceLayer: 'fotos'`).
- `fotos_linha` — linhas de trajetória por projeto (use `linesSourceLayer: 'fotos_linha'`).

Ambas as sources (`pointsSource` e `linesSource`) apontam para o **mesmo** template de
tile; o frontend seleciona a camada pelo `*SourceLayer`. Os `{z}/{x}/{y}` são
placeholders literais do MapLibre, **não** variáveis de ambiente.

```json
"streetView360": {
  "serviceUrl": "http://localhost:3000/api/v1/sv360",
  "pointsSource": { "type": "vector", "tiles": ["http://localhost:3000/api/v1/sv360/tiles/{z}/{x}/{y}.pbf"] },
  "pointsSourceLayer": "fotos",
  "linesSource": { "type": "vector", "tiles": ["http://localhost:3000/api/v1/sv360/tiles/{z}/{x}/{y}.pbf"] },
  "linesSourceLayer": "fotos_linha"
}
```

> **Contrato congelado**: a chave de topo é `streetView360`. O sub-shape usa
> `type: 'vector'` + `tiles: [...]` (MVT). GeoJSON-como-fonte e PMTiles foram
> **descontinuados** — só `serviceUrl` é configurável por deploy (a base
> `SV360_SERVICE_URL`). Os tiles MVT são servidos pelo próprio backend sob `serviceUrl`.

---

## 6. Variáveis de ambiente

As URLs do payload são injetadas por ambiente, então um deploy aponta o frontend para
servidores internos **sem rebuild**. Defaults são placeholders DEV-only.

| Variável | Chave no payload | Default (DEV) |
|----------|------------------|---------------|
| `TILE_SERVER_URL` | `services.tileServerUrl` | `""` |
| `TERRAIN_URL` | `map2d.terrainSource.url` | demotiles MapLibre |
| `HILLSHADE_URL` | `map2d.hillshadeSource.url` | demotiles MapLibre |
| `MAP3D_IMAGERY_URL` | `map3d.providers.imagery.url` | OSM público |
| `MAP3D_TERRAIN_URL` | `map3d.providers.terrain.url` | `http://localhost/terrain/tilesets/terrain` |
| `SV360_SERVICE_URL` | `streetView360.serviceUrl` (+ template de tiles) | `http://localhost:3000/api/v1/sv360` |
| `OSM_TILE_URL` | tiles dos styles `carta-topografica`/`osm` | OSM público |
| `BDGEX_WMS_URL` | tiles do style `bdgex` | BDGEx WMS público |
| `IMAGENS_TILE_URL` | tiles do style `imagens` | Google tiles |
| `ORTOIMAGEM_TILE_URL` | tiles do style `carta-ortoimagem` | BDGEx ortoimagem WMS |
| `MAPLIBRE_GLYPHS_URL` | `glyphs` de todos os styles | demotiles MapLibre |
| `ASSETS_3D_BASE_URL` | `assets3dBaseUrl` | `/api/v1/assets3d` |

> O boot **não** falha nem avisa se essas URLs continuarem em `localhost`/placeholder
> público em produção — os defaults são intencionais para dev/offline. Em produção
> militar, defina todas para os servidores internos da DGEO. Lista completa de env de
> deploy em [../deploy/deploy.md](../deploy/deploy.md).

---

## 7. Tratamento de erros

| Situação | Comportamento |
|----------|---------------|
| Sem token / token inválido | **Irrelevante** — o endpoint é público; sempre responde 200 |
| Banco indisponível | 500 (a montagem lê `resources`) — o frontend trata como **falha de boot**: 3 tentativas (1s) e a tela "EBGeo indisponível". **Não há fallback** |
| Edição via `/resources` | Refletida na **próxima** chamada (sem cache); rota de edição exige `admin` |

### Notas de integração no frontend

- **NÃO há fallback.** O `config.js` embarcado é apenas o *shape* que este endpoint hidrata
  (`applyRuntimeConfig` faz deep-merge do payload dentro dele **antes** de qualquer leitura); ele não
  carrega dado de deploy. Se `/api/config` falhar, o boot aborta com a tela "EBGeo indisponível"
  (`src/js/index.js`) — nunca cai num config estático.
- Trate a resposta como `res.data` (envelope `{ data }`), não a raiz.
- Re-busque a config após o operador editar recursos no admin — não há push/WS para
  config; é pull sob demanda.

---

## Referências

- [09 - Administração](./09-admin.md) — CRUD admin da tabela `resources`.
- [../deploy/deploy.md](../deploy/deploy.md) — variáveis de ambiente de deploy (URLs, CORS, NGINX), incl. as `*_URL` da config dinâmica e o módulo 360 absorvido.
- [../../README.md](../../README.md) — índice da documentação.
