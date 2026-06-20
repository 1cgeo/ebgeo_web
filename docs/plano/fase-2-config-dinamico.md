# Fase 2 — Config dinâmico: `GET /api/config` substituindo o `config.js` do frontend

> **✅ STATUS: IMPLEMENTADA.** Endpoint público `GET /api/v1/config` (+ alias `/api/config`) servindo
> as 12 chaves de topo (shape congelado) — `basemaps`/`analysisLayers`/`dataLayers`/`tilesets` da
> tabela `resources` (migração `010_config_resources.sql`), URLs de serviço/tiles por env
> (`config.appConfig`), defaults estáticos de UI em `config.static.js`, e `basemapStyles` (5 styles
> MapLibre com URLs injetáveis por env). Módulo `src/modules/config/`. Suite verde (597 casos).
> Pendente (fronteira): o frontend ler `fetch('/api/config')` no boot; ler o style exato de
> `carta_ortoimagem.js` do `ebgeo_web` (usei um WMS de ortoimagem por env como placeholder).
> **Depende de:** fase-0 (hardening). **Esforço:** Médio (3–5 dias).
> **Leia antes:** `_padroes.md` (template de módulo, migração, segurança, DoD) e
> `00-visao-geral.md` (arquitetura-alvo, princípios transversais).
> **Baseline de código:** branch `main`, migração head = `005_client_id_text.sql` → próxima = `006_`.

---

## 1. Objetivo & contexto

Hoje o frontend (`ebgeo_web`) carrega sua configuração **estaticamente** de
`ebgeo_web/src/js/config.js` (419 linhas, importado em build) e os *styles* reais dos basemaps de
`ebgeo_web/src/js/baselayers/*.js`. Isso significa que **qualquer mudança de servidor (trocar OSM/BDGEx
público por servidor interno da DGEO, mudar a URL da busca, do tile server, do 360) exige rebuild do
frontend** — inaceitável para deploy em rede militar com servidores internos.

Esta fase constrói um endpoint **público** `GET /api/config` no backend que serve um JSON com
**EXATAMENTE o mesmo shape** do `config.js` atual. O frontend passa a buscar a config em runtime no
boot, sem rebuild. O contrato (shape) é **congelado** (princípio transversal §4 de `00-visao-geral.md`):
não se pode quebrar os dezenas de call-sites nem o `config.helpers.js` que consomem essas chaves.

**Estratégia de três faixas** (decidida; ver Decisões §3):

1. **Dados** (tabela): blocos que são listas/dicionários de conteúdo — `basemaps`, `analysisLayers`,
   `dataLayers`, `tilesets`. Vêm de tabelas (estendendo `resources` ou nova `app_config`).
2. **URLs de ambiente** (env de deployment): `search.apiUrl`, `services.tileServerUrl`,
   `streetView360.serviceUrl`/`pointsSource`/`linesSource`, `map2d.terrainSource`/`hillshadeSource`,
   `map3d.providers.terrain.url`/`imagery.url`. Injetadas por variável de ambiente — nunca hardcoded.
3. **Preferências de UI** (estáticas no payload): `app`, `features`, `map2d` (bounds/zoom/pitch),
   `map3d.viewer`, etc. Permanecem como defaults estáticos no servidor (com override por env opcional).

**Pegadinha crítica (preserveVerbatim):** as URLs reais dos tiles dos basemaps **NÃO estão** no
`config.js`. Elas estão em `ebgeo_web/src/js/baselayers/*.js` (5 módulos, cada um um objeto de *style*
MapLibre com URLs hardcoded de OSM / demotiles / BDGEx WMS / Google). Para o endpoint servir 100% da
config (e permitir trocar esses servidores por internos), esses *styles* precisam ser **absorvidos** no
payload — em um novo bloco `basemapStyles` (ver Tarefa 3). O bootstrap do frontend deverá ler o style
do payload em vez de importar `baselayers/*.js` (trabalho do frontend; aqui só provemos o contrato).

> **Observação de fronteira:** adaptar o boot do frontend para `fetch('/api/config')` é **trabalho do
> frontend**, fora desta fase. O backend só provê o endpoint, o shape congelado e os novos campos.

---

## 2. Pré-requisitos / dependências de outras fases

- **fase-0 concluída.** Esta fase reusa: `validateEnvVariables()` fail-fast no boot (a config injeta
  URLs por env — a ausência de uma URL obrigatória em prod deve falhar cedo, não silenciosamente);
  `helmet` CSP (o endpoint é público); rate-limit aplicável a rotas públicas se desejado. Sem fase-0,
  as URLs de ambiente entram sem validação de boot.
- **Nada de PostGIS, multi-org ou sync.** Esta fase é independente das fases 1/3/5 e pode correr em
  paralelo a elas após a fase-0 (ver Mapa de Fases em `00-visao-geral.md` §6).

---

## 3. Decisões de arquitetura aplicáveis

| Decisão | Recomendação | Ramos |
|--------|--------------|-------|
| **D-cfg-1: Onde guardar os dados (basemaps/layers/tilesets)?** | **Recomendado: estender a tabela `resources` existente** (003_sync.sql:81-96) — ela já tem `category CHECK(basemap/analysis_layer/data_layer/tileset/streetview_marker)`, `config JSONB`, `active`, `sort_order` e seed de 7 recursos. É o modelo mais próximo e já testado. | **(a)** Estender `resources`: adicionar o que falta no `config` JSONB de cada linha; o config endpoint lê de `resources` agrupando por `category`. Mínimo de migração. **(b)** Nova tabela `app_config(key TEXT PK, value JSONB, updated_at)`: guarda blocos inteiros do config por chave (`'basemaps'`, `'map2d'`, ...). Mais flexível para blocos de UI, mas duplica o que `resources` já modela para basemaps/layers/tilesets. **Decisão final:** usar `resources` para os **dados em lista** (Tarefa 2) e, **se** algum bloco de UI precisar ser editável sem deploy, criar `app_config` só para esses blocos (Tarefa 6, opcional). |
| **D-cfg-2: `basemapStyles` no payload ou só referência?** | **Recomendado: incluir o style MapLibre completo no payload** (faixa 1, dados em tabela), porque o frontend precisa do objeto de style para `addSource`/`addLayer`. Guardar o style em `resources.config.style` (JSONB) de cada basemap. As URLs internas dos tiles entram via env-substituição na montagem (placeholders tipo `${OSM_TILE_URL}`). | **(a)** Style completo no payload (recomendado): self-contained, frontend só lê. **(b)** Só `styleUrl` apontando para outro endpoint: mais requisições, sem ganho aqui. |
| **D-cfg-3: Endpoint versionado `/api/v1/config` ou `/api/config`?** | **Recomendado: `/api/v1/config`** para alinhar ao resto da API (todas as rotas vivem sob `/api/v1`, app.js:35-41). O `00-visao-geral.md` e a spec citam `/api/config`; aceitar **ambos** montando um alias é trivial e evita quebra. | Montar `app.get('/api/v1/config', ...)` e `app.get('/api/config', ...)` apontando para o mesmo handler. |
| **D-cfg-4: Público sem auth?** | **Sim, público** (faceta exigida: a app funciona idêntica para usuário não autenticado — `00-visao-geral.md` §5.1). A config não contém segredo; só URLs e preferências. Monta-se **antes** do middleware de auth, espelhando `GET /api/v1/health` (app.js:35). | Se algum campo for sensível no futuro, separar em `/config` público + `/config/admin` autenticado. Fora de escopo. |

**Nota de segurança:** o payload **não pode** vazar segredo (token de tile server privado, chave de
API). URLs de serviço são endereços de rede internos — aceitáveis num app de rede militar fechada, mas
**nunca** embuta credenciais embutidas em URL. Se um tile server exigir token, o frontend o obtém via
fluxo autenticado, não pela config pública.

---

## 4. Contrato congelado — shape do `config.js` (preserveVerbatim)

O endpoint **DEVE** retornar um JSON com estas chaves de topo, no mesmo formato que o frontend já
consome. Fonte: `ebgeo_web/src/js/config.js` (419 linhas). Reproduzido aqui porque os docs-fonte serão
apagados. **Não renomear, não remover, não aninhar diferente.** Campos comentados no original são
exemplos/documentação e não precisam estar no payload.

```jsonc
{
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
    "tileServerUrl": ""                       // env: TILE_SERVER_URL (ex: 'http://10.0.0.5:7800')
  },
  "search": {
    "apiUrl": "http://localhost:3001/busca"   // env: SEARCH_API_URL
  },
  "basemaps": {                               // DADOS (tabela resources, category='basemap')
    "carta-topografica": { "enabled": true,  "name": "Topográfica", "image": "./images/layers/carta-topografica-thumb.png", "priority": 1 },
    "carta-ortoimagem":  { "enabled": true,  "name": "Ortoimagem",  "image": "./images/layers/carta-ortoimagem-thumb.png",  "priority": 2 },
    "bdgex":             { "enabled": true,  "name": "BDGEx",       "image": "./images/layers/bdgex-thumb.png",             "priority": 3 },
    "osm":               { "enabled": false, "name": "OSM",         "priority": 4 },
    "imagens":           { "enabled": false, "name": "Imagens",     "priority": 5 }
  },
  "analysisLayers": {                         // DADOS (tabela, category='analysis_layer')
    "enabled": true,
    "layers": []
  },
  "dataLayers": {                             // DADOS (tabela, category='data_layer')
    "enabled": true,
    "layers": []
  },
  "map2d": {                                  // UI estático + terrain/hillshade por env
    "bounds": [[-58.1, -33.4], [-48.7, -27.1]],
    "minZoom": 1,
    "maxZoom": 17.9,
    "maxPitch": 65,
    "globe_projection": true,
    "sourceTileLodParams": [5, 6.0],
    "terrainSource":  { "type": "raster-dem", "url": "https://demotiles.maplibre.org/terrain-tiles/tiles.json", "tileSize": 256 },  // env: TERRAIN_URL
    "hillshadeSource": { "type": "raster-dem", "url": "https://demotiles.maplibre.org/terrain-tiles/tiles.json", "tileSize": 256 }, // env: HILLSHADE_URL
    "hillshade": {
      "enabled": false,
      "name": "Sombreamento do Relevo",
      "description": "Visualização de relevo sombreado baseada em modelo digital de elevação",
      "thumbnail": null,
      "layer": {
        "id": "hillshade", "type": "hillshade", "source": "hillshadeSource",
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
    }
  },
  "map3d": {                                  // UI estático + providers por env
    "bounds": { "west": -58.1, "south": -33.8, "east": -48.0, "north": -22.5 },
    "viewer": {
      "infoBox": false, "vrButton": false, "geocoder": false, "homeButton": false,
      "sceneModePicker": false, "baseLayerPicker": false, "navigationHelpButton": true,
      "animation": false, "timeline": false, "fullscreenButton": false
    },
    "providers": {
      "imagery": {
        "enabled": true, "type": "UrlTemplate",
        "url": "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",     // env: MAP3D_IMAGERY_URL
        "options": { "maximumLevel": 18, "minimumLevel": 0, "tileWidth": 256, "tileHeight": 256 }
      },
      "terrain": {
        "enabled": true, "type": "Cesium",
        "url": "http://localhost/terrain/tilesets/terrain",            // env: MAP3D_TERRAIN_URL
        "options": { "requestVertexNormals": true }
      }
    }
  },
  "tilesets": [                               // DADOS (tabela resources, category='tileset')
    {
      "url": "/3d/PCL/tileset.json", "heightOffset": 35, "id": "PCL",
      "name": "Posto de Comando Logístico",
      "description": "Modelo 3D do Posto de Comando Logístico capturado por drone",
      "keywords": ["PCL", "posto comando", "logística", "drone"],
      "data_captura": "15/03/2024", "local": "Resende, RJ",
      "previewVideo": "/3d/videos/preview.webm", "previewThumbnail": "/3d/videos/thumbnail.jpg",
      "locate": { "lon": -44.47332385414955, "lat": -22.43976556982974, "height": 1000 }
    }
    // entradas 'glb' usam: type:'glb', position, rotation, scale, maximumScale
  ],
  "streetView360": {                          // env: SV360_*
    "serviceUrl": "http://localhost:8081/api/v1",                      // env: SV360_SERVICE_URL
    "pointsSource":      { "type": "vector", "url": "http://localhost:3000/fotos" },        // env: SV360_POINTS_URL
    "pointsSourceLayer": "fotos",
    "linesSource":       { "type": "vector", "url": "http://localhost:3000/fotos_linha" },  // env: SV360_LINES_URL
    "linesSourceLayer":  "fotos_linha"
  }
}
```

### 4.1 Styles de basemap a absorver (preserveVerbatim — `ebgeo_web/src/js/baselayers/*.js`)

Cada basemap tem um *style* MapLibre próprio com URLs **hardcoded** que NÃO aparecem no `config.js`.
Estes são os 5 módulos atuais. O endpoint deve servir o equivalente em um bloco novo `basemapStyles`
(ver Tarefa 3), com as URLs substituíveis por env (placeholders entre `${...}`):

```jsonc
// carta_topografica.js  → usa OSM raster
{ "version": 8, "glyphs": "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  "sources": { "osm": { "type":"raster", "tiles":["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"], "tileSize":256, "attribution":"&copy; OpenStreetMap Contributors", "maxzoom":19 } },
  "layers": [ { "id":"osm", "type":"raster", "source":"osm" } ] }

// osm_layer.js  (idêntico ao acima, salvo id)
// imagens_layer.js  → Google satellite (mt1/mt2/mt3.google.com/vt/lyrs=s&x={x}&y={y}&z={z}), maxzoom 20
// bdgex_layer.js  → BDGEx WMS:
//   https://bdgex.eb.mil.br/mapcache?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=ctmmultiescalas_mercator&TILED=true&WIDTH=256&HEIGHT=256&SRS=EPSG%3A3857&STYLES=&BBOX={bbox-epsg-3857}
// carta_ortoimagem.js  → (ler o arquivo no momento da implementação para o style exato)
```

> **Substituição em produção militar:** os placeholders públicos (OSM, demotiles glyphs, Google,
> BDGEx público) DEVEM poder ser trocados por servidores internos da DGEO via env. Ex.:
> `OSM_TILE_URL`, `MAPLIBRE_GLYPHS_URL`, `IMAGENS_TILE_URL`, `BDGEX_WMS_URL`, `ORTOIMAGEM_TILE_URL`.

---

## 5. Fatos verificados do código atual (findingsDigest)

- **NÃO existe** rota `/api/config` nem `/config` (grep por `api/config`, `'/config'`,
  `router.get('/config')` → 0 matches em `src`). Toda referência a "config" em `src` é import do
  `config.js` de env estático.
- `app.js:34-41` monta apenas `GET /api/v1/health` (público, sem auth) + `/api/v1/{auth,users,atlas,resources}`.
  O `/health` é o **padrão de rota pública** a espelhar: `app.get(...)` direto, antes das rotas com auth.
- `src/config.js` é `Object.freeze` aninhado, com helpers `required(key)` / `optional(key, fallback)`.
- Tabela `resources` (003_sync.sql:81-96): `id VARCHAR(100) PK`, `category VARCHAR(50) CHECK(...)`,
  `name`, `description`, `config JSONB DEFAULT '{}'`, `active BOOLEAN DEFAULT true`, `sort_order INTEGER`,
  `created_at`, `updated_at`. Seed de 7 recursos (003_sync.sql:99-106). Índices `category` e parcial
  `category WHERE active = true`.
- **PORÉM** `resources.routes.js:12-18` exige `auth` em todas as rotas (`GET /`, `GET /:id`) → **não é
  público**. Logo a rota de config será **nova e dedicada**, pública, não reaproveita o router de resources.
- `resources.service.js` é o modelo de service a seguir (queries nomeadas, `oneOrNone`/`one`/`query`).
- Migração head atual = `005_client_id_text.sql`; runner é **aditivo e forward-only**; basta criar
  `006_*.sql` (`_padroes.md` §7).

---

## 6. Tarefas

### Tarefa 1: Criar módulo `config` com endpoint público `GET /api/v1/config`

**Objetivo:** expor um endpoint público que monta e retorna o JSON com o shape congelado do §4,
combinando defaults estáticos de UI + URLs de env + dados de tabela. Entregar o esqueleto do módulo e
o caminho público; o conteúdo de dados/styles vem nas Tarefas 2–4.

**Arquivos afetados:**
- `src/modules/config/config.routes.js` (criar)
- `src/modules/config/config.controller.js` (criar)
- `src/modules/config/config.service.js` (criar)
- `src/modules/config/config.queries.js` (criar)
- `src/modules/config/config.static.js` (criar) — defaults estáticos de UI (faixa 3)
- `src/modules/config/index.js` (criar)
- `src/app.js` (modificar) — montar a rota **antes** das rotas com auth
- `src/config.js` (modificar) — adicionar bloco `appConfig` com as URLs por env (faixa 2)

**Padrão de código:** template canônico de módulo (`_padroes.md` §1); rota pública espelhando
`GET /api/v1/health` (`_padroes.md` §6, app.js:35); `asyncHandler` + `res.json({ data })` (§2).

**Implementação:**
1. Em `src/config.js`, adicionar um sub-objeto `appConfig` (congelado) lendo as URLs de env com
   `optional(...)` (fail-fast em prod via `validateEnvVariables()` da fase-0 para as obrigatórias):
   ```javascript
   // src/config.js — dentro do Object.freeze({...})
   appConfig: Object.freeze({
     tileServerUrl:  optional('TILE_SERVER_URL', ''),
     searchApiUrl:   optional('SEARCH_API_URL', 'http://localhost:3001/busca'),
     terrainUrl:     optional('TERRAIN_URL', 'https://demotiles.maplibre.org/terrain-tiles/tiles.json'),
     hillshadeUrl:   optional('HILLSHADE_URL', 'https://demotiles.maplibre.org/terrain-tiles/tiles.json'),
     map3dImageryUrl:optional('MAP3D_IMAGERY_URL', 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'),
     map3dTerrainUrl:optional('MAP3D_TERRAIN_URL', 'http://localhost/terrain/tilesets/terrain'),
     sv360ServiceUrl:optional('SV360_SERVICE_URL', 'http://localhost:8081/api/v1'),
     sv360PointsUrl: optional('SV360_POINTS_URL', 'http://localhost:3000/fotos'),
     sv360LinesUrl:  optional('SV360_LINES_URL', 'http://localhost:3000/fotos_linha'),
     // baselayer tile URLs (Tarefa 3):
     osmTileUrl:     optional('OSM_TILE_URL', 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'),
     glyphsUrl:      optional('MAPLIBRE_GLYPHS_URL', 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'),
     imagensTileUrl: optional('IMAGENS_TILE_URL', 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'),
     bdgexWmsUrl:    optional('BDGEX_WMS_URL', 'https://bdgex.eb.mil.br/mapcache?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=ctmmultiescalas_mercator&TILED=true&WIDTH=256&HEIGHT=256&SRS=EPSG%3A3857&STYLES=&BBOX={bbox-epsg-3857}'),
   }),
   ```
2. `config.static.js` exporta os blocos estáticos de UI (faixa 3): `APP`, `FEATURES`, `MAP2D_BASE`
   (bounds/zoom/pitch/globe/hillshade-paint), `MAP3D_VIEWER`, `MAP3D_BOUNDS`. Copiar valores verbatim
   do §4.
3. `config.service.js` → `export async function getAppConfig()` monta o objeto final:
   ```javascript
   // src/modules/config/config.service.js
   import config from '../../config.js';
   import * as S from './config.static.js';
   import { listBasemaps, listAnalysisLayers, listDataLayers, listTilesets, listBasemapStyles }
     from './config.data.service.js'; // Tarefas 2-3
   const C = config.appConfig;

   export async function getAppConfig() {
     return {
       app: S.APP,
       features: S.FEATURES,
       services: { tileServerUrl: C.tileServerUrl },
       search:   { apiUrl: C.searchApiUrl },
       basemaps: await listBasemaps(),
       analysisLayers: { enabled: true, layers: await listAnalysisLayers() },
       dataLayers:     { enabled: true, layers: await listDataLayers() },
       map2d: {
         ...S.MAP2D_BASE,
         terrainSource:   { type: 'raster-dem', url: C.terrainUrl,   tileSize: 256 },
         hillshadeSource: { type: 'raster-dem', url: C.hillshadeUrl, tileSize: 256 },
       },
       map3d: {
         bounds: S.MAP3D_BOUNDS,
         viewer: S.MAP3D_VIEWER,
         providers: {
           imagery: { enabled: true, type: 'UrlTemplate', url: C.map3dImageryUrl,
                      options: { maximumLevel: 18, minimumLevel: 0, tileWidth: 256, tileHeight: 256 } },
           terrain: { enabled: true, type: 'Cesium', url: C.map3dTerrainUrl,
                      options: { requestVertexNormals: true } },
         },
       },
       tilesets: await listTilesets(),
       streetView360: {
         serviceUrl: C.sv360ServiceUrl,
         pointsSource: { type: 'vector', url: C.sv360PointsUrl }, pointsSourceLayer: 'fotos',
         linesSource:  { type: 'vector', url: C.sv360LinesUrl },  linesSourceLayer: 'fotos_linha',
       },
       basemapStyles: await listBasemapStyles(), // Tarefa 3
     };
   }
   ```
4. `config.controller.js`:
   ```javascript
   import { asyncHandler } from '../../utils/async-handler.js';
   import * as configService from './config.service.js';
   export const getConfig = asyncHandler(async (req, res) => {
     const data = await configService.getAppConfig();
     res.json({ data });
   });
   ```
   > **Decisão de envelope:** o frontend espera o objeto de config **direto** (era `export default
   > config`). Confirmar com o frontend se ele lê `resp.data` ou o corpo todo. Recomendado seguir o
   > padrão do repo `{ data }` (`_padroes.md` §2) e o bootstrap do frontend faz `(await r.json()).data`.
   > Se o frontend exigir o objeto raiz, retornar `res.json(data)` neste endpoint específico e
   > **documentar a exceção**. Alinhar antes de congelar.
5. `config.routes.js` cria `const router = Router(); router.get('/', ctrl.getConfig); export { router as configRoutes };`
6. `app.js`: importar `{ configRoutes }` e montar **antes** das rotas autenticadas, junto ao health:
   ```javascript
   // app.js — após GET /api/v1/health (público), antes das rotas com auth
   app.use('/api/v1/config', configRoutes);
   app.use('/api/config', configRoutes); // alias de compatibilidade (D-cfg-3)
   ```

**Critérios de aceitação:**
- [ ] `GET /api/v1/config` responde **200 sem Authorization** (público).
- [ ] O JSON retornado contém **todas** as 11 chaves de topo do §4 (`app`, `features`, `services`,
      `search`, `basemaps`, `analysisLayers`, `dataLayers`, `map2d`, `map3d`, `tilesets`, `streetView360`)
      + `basemapStyles`.
- [ ] As URLs (`search.apiUrl`, `services.tileServerUrl`, `streetView360.serviceUrl`,
      `map2d.terrainSource.url`, `map3d.providers.terrain.url`) refletem as env vars quando setadas.
- [ ] Caminho anônimo do resto da app não é afetado (rota nova, não substitui nada).

**Testes:**
- `tests/integration/config.test.js`: GET sem token → 200; valida presença das 11+1 chaves; com
  `SEARCH_API_URL` setada no env de teste, `search.apiUrl` reflete o valor; shape de `map3d.providers`
  e `streetView360` batem com o §4.

**Dependências:** nenhuma (esqueleto). As Tarefas 2–4 preenchem `config.data.service.js`.

---

### Tarefa 2: Servir `basemaps`/`analysisLayers`/`dataLayers`/`tilesets` da tabela `resources`

**Objetivo:** mover os blocos de **dados** do payload para a tabela `resources` (003_sync.sql:81-96),
de modo que sejam editáveis sem rebuild do frontend, mantendo o shape exato do §4.

**Arquivos afetados:**
- `src/modules/config/config.data.service.js` (criar)
- `src/modules/config/config.queries.js` (modificar)
- `src/database/migrations/006_config_resources.sql` (criar) — backfill do `config` JSONB dos
  basemaps/tilesets seed com os campos de UI (image/priority/enabled/url/heightOffset/locate/...)

**Padrão de código:** queries nomeadas (`_padroes.md` §1); service lê de `resources` agrupando por
`category`; migração aditiva e parametrizada (`_padroes.md` §7); `gen_random_uuid()` não se aplica
(PK textual de `resources`).

**Implementação:**
1. `006_config_resources.sql`: para cada basemap/tileset seed, popular `config` JSONB com os campos que
   o §4 exige. Aditivo (`UPDATE ... SET config = ...`), idempotente (re-roda sem efeito colateral além
   de reescrever o mesmo JSON). Ex.:
   ```sql
   -- 006_config_resources.sql  (aditivo: só popula config JSONB; runner roda em tx — _padroes.md §7)
   UPDATE resources SET config = jsonb_build_object(
     'enabled', true, 'image', './images/layers/carta-topografica-thumb.png', 'priority', 1
   ) WHERE id = 'carta-topografica';
   UPDATE resources SET config = jsonb_build_object('enabled', true, 'image', './images/layers/carta-ortoimagem-thumb.png', 'priority', 2) WHERE id = 'carta-ortoimagem';
   UPDATE resources SET config = jsonb_build_object('enabled', true, 'image', './images/layers/bdgex-thumb.png', 'priority', 3) WHERE id = 'bdgex';
   UPDATE resources SET config = jsonb_build_object('enabled', false, 'priority', 4) WHERE id = 'osm';
   UPDATE resources SET config = jsonb_build_object('enabled', false, 'priority', 5) WHERE id = 'imagens';

   -- tileset PCL: campos do §4 (url/heightOffset/locate/keywords/...)
   UPDATE resources SET config = jsonb_build_object(
     'url', '/3d/PCL/tileset.json', 'heightOffset', 35,
     'description', 'Modelo 3D do Posto de Comando Logístico capturado por drone',
     'keywords', jsonb_build_array('PCL','posto comando','logística','drone'),
     'data_captura', '15/03/2024', 'local', 'Resende, RJ',
     'previewVideo', '/3d/videos/preview.webm', 'previewThumbnail', '/3d/videos/thumbnail.jpg',
     'locate', jsonb_build_object('lon', -44.47332385414955, 'lat', -22.43976556982974, 'height', 1000)
   ) WHERE id = 'PCL';
   ```
2. `config.queries.js` — queries por categoria, só ativas, ordenadas por `sort_order`:
   ```javascript
   export const LIST_BY_CATEGORY =
     `SELECT id, name, config FROM resources WHERE category = $1 AND active = true ORDER BY sort_order`;
   ```
3. `config.data.service.js`:
   - `listBasemaps()` → constrói o **dicionário** `{ [id]: { enabled, name, image, priority } }` a partir
     das linhas `category='basemap'` (basemaps é objeto, não array — ver §4). `name` vem da coluna
     `name`; o resto do `config` JSONB.
   - `listAnalysisLayers()` / `listDataLayers()` → **arrays** de objetos `config` (com `id`/`name`
     mesclados). Hoje os arrays estão vazios no §4; o seed pode não ter linhas — retornar `[]`.
   - `listTilesets()` → **array** mesclando `{ id, name, ...config }` das linhas `category='tileset'`.
   ```javascript
   import { query } from '../../database/index.js';
   import * as Q from './config.queries.js';
   export async function listBasemaps() {
     const { rows } = await query(Q.LIST_BY_CATEGORY, ['basemap']);
     return Object.fromEntries(rows.map(r => [r.id, { name: r.name, ...r.config }]));
   }
   export async function listTilesets() {
     const { rows } = await query(Q.LIST_BY_CATEGORY, ['tileset']);
     return rows.map(r => ({ id: r.id, name: r.name, ...r.config }));
   }
   // analysisLayers / dataLayers idem (arrays)
   ```

**Critérios de aceitação:**
- [ ] `basemaps` no payload é um **objeto** chaveado por id (não array), com `enabled/name/image/priority`,
      idêntico ao §4 para os 5 seeds.
- [ ] `tilesets` é um **array**; o item `PCL` traz `url/heightOffset/id/name/keywords/locate/...`.
- [ ] Adicionar uma linha em `resources` (category basemap) aparece no payload sem mudança de código.
- [ ] Migração 006 é idempotente (rodar duas vezes não quebra).

**Testes:**
- `tests/integration/config.test.js`: payload `basemaps['carta-topografica']` == `{ enabled:true, name:'Topográfica', image:'...', priority:1 }`; `tilesets` contém item `id==='PCL'` com `heightOffset===35`.

**Dependências:** Tarefa 1.

---

### Tarefa 3: Absorver os styles de baselayers em `basemapStyles`

**Objetivo:** servir, no payload, o objeto de *style* MapLibre de cada basemap (hoje hardcoded em
`ebgeo_web/src/js/baselayers/*.js`), com as URLs de tile substituíveis por env. É o passo que permite
**trocar OSM/BDGEx público/Google por servidores internos da DGEO** sem rebuild.

**Arquivos afetados:**
- `src/modules/config/config.data.service.js` (modificar) — `listBasemapStyles()`
- `src/modules/config/config.queries.js` (modificar) — ler `config.style` dos basemaps, se optar por tabela
- (Decisão D-cfg-2) **Recomendado:** guardar o style em `resources.config.style` (JSONB) via migração
  `006_config_resources.sql` (estender a Tarefa 2). Alternativa: manter os styles como template estático
  em `config.static.js` e só injetar URLs por env.

**Padrão de código:** `_padroes.md` §1; substituição de placeholder de URL por env (sem concatenar input
do usuário — são valores de env confiáveis).

**Implementação:**
1. Para cada basemap, definir o style com **placeholders** que a montagem substitui por
   `config.appConfig.*`. Recomendado guardar em `resources.config.style` com `${VAR}` literais e fazer
   um `String.replaceAll` controlado por **whitelist** de chaves conhecidas (nunca eval). Ex. de
   template (em `config.static.js` ou em `config` JSONB):
   ```javascript
   // exemplo: style do basemap 'osm' / 'carta-topografica'
   const osmStyle = (C) => ({
     version: 8, glyphs: C.glyphsUrl,
     sources: { osm: { type: 'raster', tiles: [C.osmTileUrl], tileSize: 256,
                       attribution: '&copy; OpenStreetMap Contributors', maxzoom: 19 } },
     layers: [ { id: 'osm', type: 'raster', source: 'osm' } ],
   });
   const bdgexStyle = (C) => ({
     version: 8, glyphs: C.glyphsUrl,
     sources: { bdgex: { type: 'raster', tiles: [C.bdgexWmsUrl], tileSize: 256,
                         attribution: 'BDGEx - Exército Brasileiro', maxzoom: 18 } },
     layers: [ { id: 'bdgex', type: 'raster', source: 'bdgex' } ],
   });
   const imagensStyle = (C) => ({ /* Google satellite mt1/mt2/mt3 → C.imagensTileUrl, maxzoom 20 */ });
   ```
2. `listBasemapStyles()` retorna `{ 'carta-topografica': osmStyle(C), 'osm': osmStyle(C),
   'bdgex': bdgexStyle(C), 'imagens': imagensStyle(C), 'carta-ortoimagem': ortoStyle(C) }`.
   **Ler `ebgeo_web/src/js/baselayers/carta_ortoimagem.js` na implementação** para o style exato do
   ortoimagem (não reproduzido aqui).
3. Documentar no `.env.example` todas as `*_TILE_URL`/`*_WMS_URL`/`GLYPHS_URL` com os defaults
   públicos e a nota de substituição por servidor interno.

**Critérios de aceitação:**
- [ ] `basemapStyles` contém os 5 ids, cada um um style MapLibre válido (`version: 8`, `sources`, `layers`).
- [ ] As URLs de tile/glyphs vêm de env (alterar `OSM_TILE_URL` muda o `sources.osm.tiles[0]` no payload).
- [ ] Nenhum placeholder `${...}` literal sobra no payload final (substituição completa).
- [ ] BDGEx WMS preserva a query string exata do §4.1 (LAYERS=ctmmultiescalas_mercator, BBOX={bbox-epsg-3857}).

**Testes:**
- `tests/integration/config.test.js`: com `OSM_TILE_URL='http://interno/osm/{z}/{x}/{y}.png'`,
  `basemapStyles['osm'].sources.osm.tiles[0]` == esse valor; `basemapStyles['bdgex'].layers[0].id === 'bdgex'`.

**Dependências:** Tarefa 1 (e Tarefa 2 se guardar style na tabela).

---

### Tarefa 4: URLs de ambiente, `.env.example` e validação de boot

**Objetivo:** garantir que toda URL de servidor é injetável por env, documentada, e que as obrigatórias
em produção falham cedo (integração com `validateEnvVariables()` da fase-0).

**Arquivos afetados:**
- `.env.example` (modificar) — adicionar todas as `*_URL` com defaults e comentários
- `src/config.js` (modificar) — bloco `appConfig` (feito na Tarefa 1); marcar como obrigatórias em prod
  as que não podem usar default público (ex.: `SEARCH_API_URL`, `SV360_SERVICE_URL`, terrain interno)
- `docs/implementado/10-config.md` ou novo `docs/implementado/12-config-endpoint.md` (criar/atualizar)

**Padrão de código:** `_padroes.md` §5 (config fail-fast agrupado por contexto).

**Implementação:**
1. Listar em `.env.example`, agrupadas, todas as vars do §4/§4.1 com defaults públicos comentados como
   "DEV ONLY — trocar por servidor interno em prod".
2. Estender `validateEnvVariables()` (fase-0): em `NODE_ENV=production`, exigir que as URLs de serviço
   essenciais não sejam o default público localhost/demotiles (ou ao menos avisar com log de warning).
   Recomendado: **erro** para `SEARCH_API_URL`/`SV360_SERVICE_URL`/`MAP3D_TERRAIN_URL` ainda apontando
   para `localhost` em prod; **warning** para tile URLs públicas (podem ser intencionais offline).
3. Atualizar `CLAUDE.md` (tabela de config) e a tabela de rotas para incluir `GET /api/v1/config`.

**Critérios de aceitação:**
- [ ] `.env.example` documenta todas as `*_URL` novas.
- [ ] Em prod, faltar/usar default localhost em var obrigatória falha (ou loga warning) no boot.
- [ ] `CLAUDE.md` lista o novo endpoint público e as novas env vars.

**Testes:**
- `tests/unit/config-env.test.js` (se houver suite de config): `appConfig.searchApiUrl` reflete env;
  defaults aplicados quando ausente.

**Dependências:** Tarefa 1; fase-0 (`validateEnvVariables`).

---

### Tarefa 5 (opcional/recomendada): Endpoints de administração da config (consumidos pela UI de admin)

**Objetivo:** permitir que um admin edite basemaps/layers/tilesets sem deploy. **A UI de admin é um
projeto FRONTEND SEPARADO** (`00-visao-geral.md` D5; ver spec em `99-referencia.md`). Aqui só provemos
os endpoints **autenticados** que ela consome. A leitura pública (`GET /api/v1/config`) permanece intacta.

**Arquivos afetados:**
- Reusar o módulo `resources` existente (`resources.routes.js` já tem `POST/PUT/DELETE` admin-only,
  resources.routes.js:16-18). Para a config, **basta** que a UI de admin use os endpoints de `resources`
  já existentes (`/api/v1/resources`) para CRUD de basemap/analysis_layer/data_layer/tileset.
- Opcional: `src/modules/config/` ganha `config.admin.*` só se um bloco de UI (ex.: `app`, `features`)
  precisar ser editável → aí entra a tabela `app_config(key TEXT PK, value JSONB, updated_at)` (D-cfg-1b).

**Padrão de código:** `_padroes.md` §1 (admin-only via `requireAdmin`, validação Joi).

**Implementação:**
1. **Recomendado:** não criar endpoints novos de admin nesta fase — a UI de admin edita basemaps/layers/
   tilesets via `resources` CRUD existente; o `GET /api/v1/config` reflete as mudanças automaticamente
   (pois lê de `resources`). Documentar para a equipe da UI quais campos do `config` JSONB cada categoria
   espera (mapeamento §4).
2. **Se** blocos de UI (app/features/map2d) precisarem ser editáveis: migração `007_app_config.sql`
   (`CREATE TABLE app_config(key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`),
   service que faz merge `app_config` sobre os defaults estáticos, e `PATCH /api/v1/config/admin/:key`
   admin-only. Fora do mínimo desta fase.

**Critérios de aceitação:**
- [ ] Editar uma linha de `resources` (basemap) via `PUT /api/v1/resources/:id` reflete no
      `GET /api/v1/config` na requisição seguinte.
- [ ] `GET /api/v1/config` permanece público (não exige auth) mesmo com os endpoints de admin existindo.

**Testes:**
- `tests/integration/config.test.js`: admin faz `PUT /resources/osm` setando `config.enabled=true`;
  `GET /config` passa a refletir `basemaps.osm.enabled === true`. Caso negativo: não-admin recebe 403 no PUT.

**Dependências:** Tarefa 2; módulo `resources` (existente).

---

## 7. Riscos & cuidados

- **Contrato congelado.** Qualquer renomeação/remoção de chave quebra o frontend. Antes de mergear,
  rodar um **teste de contrato** comparando o payload com o shape do §4 (chave a chave). Alinhar com a
  equipe do frontend o **envelope** (`{ data }` vs objeto raiz — ver Tarefa 1.4) antes de congelar.
- **Vazamento de segredo.** O endpoint é público: jamais incluir token/credencial. Revisar cada campo.
- **`basemaps` é objeto, não array.** Erro comum: retornar array. O frontend indexa por id (§4).
- **Styles em `baselayers/*.js` desatualizados.** Ler os 5 arquivos no momento da implementação
  (`carta_ortoimagem.js` não foi reproduzido aqui) — a fonte de verdade é o código do `ebgeo_web`.
- **Substituição de placeholder por env.** Fazer só com whitelist de chaves; nunca interpolar input de
  usuário em URL (`_padroes.md` §8). As env vars são confiáveis; ainda assim, validar formato de URL.
- **Cache.** Considerar `Cache-Control` curto no endpoint (a config muda raramente). Não cachear
  agressivo se admin puder editar via `resources` em runtime (Tarefa 5) — senão a edição demora a
  propagar. Recomendado `Cache-Control: no-cache` ou TTL pequeno.
- **Migração 006 idempotente.** `UPDATE ... SET config = ...` é idempotente; não usar `INSERT` sem
  `ON CONFLICT` para não quebrar em re-run (o runner pula migração já aplicada, mas mantenha idempotente).
- **Aditivo.** Não tocar no caminho anônimo nem nas rotas existentes; só adicionar a rota pública nova.

---

## 8. Definition of Done da fase

Além do DoD universal (`_padroes.md` §10):

- [ ] `GET /api/v1/config` (e alias `/api/config`) responde **200 público** com as 11 chaves de topo do
      §4 + `basemapStyles`, no shape exato (teste de contrato passa).
- [ ] `basemaps`, `analysisLayers`, `dataLayers`, `tilesets` vêm de `resources` (editáveis sem rebuild).
- [ ] `basemapStyles` serve os 5 styles MapLibre com URLs injetadas por env (OSM/BDGEx/Google/glyphs
      substituíveis por servidor interno).
- [ ] URLs de ambiente (`search`, `services.tileServerUrl`, `streetView360.*`, `map2d.terrainSource`,
      `map3d.providers.*`) injetadas por env; defaults públicos documentados em `.env.example` com nota
      de substituição em produção militar.
- [ ] Migração `006_config_resources.sql` aditiva, idempotente, aplicada via runner.
- [ ] `tests/integration/config.test.js` cobre: público sem token, shape completo, reflexo de env,
      reflexo de edição em `resources`, e caso negativo (não-admin não edita `resources`).
- [ ] `CLAUDE.md` e docs atualizados com o novo endpoint, as novas env vars e o mapeamento
      `resources.config` ↔ shape do config.
- [ ] Caminho anônimo e contrato do frontend preservados (nenhuma rota existente alterada).
