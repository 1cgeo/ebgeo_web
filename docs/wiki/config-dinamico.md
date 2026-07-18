# Config dinâmico (GET /api/config)

Endpoint público que substitui o `config.js` estático, montando em runtime um payload de 12 chaves de topo (contrato congelado) a partir da tabela `resources`, de variáveis de ambiente e de defaults estáticos de UI, sem fallback local e sem rebuild do frontend.

## O que é, e por que o boot depende dele

O `src/js/config.js` do frontend não é mais config: é um **shell de shape** (`src/js/config.js:22-60`) com catálogo vazio e um piso estrutural mínimo em `map2d`/`map3d` (só as chaves que `map_sig.js`/`map_3d.js` leem sem guarda, como o spread de `sourceTileLodParams` e `viewer`). Todo o dado de deploy vem do servidor.

No boot, `applyRuntimeConfig` busca `GET /config` e faz **deep-merge in place** dentro desse objeto (`src/js/store/sync/runtime-config.js:62-73`), antes de qualquer leitura. O binding `config` é importado em toda a app e nunca é substituído, só mutado: por isso o merge é in place e por isso os overlays posteriores também mutam o mesmo objeto.

O boot é **fail-fast**: 3 tentativas com 1s de intervalo e, se nenhuma aplicar, tela "EBGeo indisponível" e `return` (`src/js/index.js:73-86`). Não existe config estático de reserva. Isso é a exceção única ao princípio offline-first: o servidor é pré-requisito para o app *subir*, não para operar (ver [[dominio-local-vs-remoto]] e [[sessao-boot-e-ciclo-de-vida]]).

Armadilha: `applyRuntimeConfig` em si é fail-safe (retorna `{ applied: false, error }` e não lança). Quem transforma a falha em morte do boot é o `index.js`. Se você chamar `applyRuntimeConfig` de outro lugar e ignorar `applied`, a app segue com o shell vazio (catálogo vazio, nenhum basemap) sem erro visível.

## Rota, auth e cache

- `GET /api/v1/config` e o alias de compatibilidade `GET /api/config` usam o **mesmo router** (`backend/src/app.js:90-91`), montado **antes** das rotas autenticadas.
- Sem auth (`backend/src/modules/config/config.routes.js:13`). O cliente chama com `auth: false` (`src/js/store/sync/api-client.js:378-380`).
- Resposta em envelope `{ data }` (`config.controller.js:10`) com `Cache-Control: no-cache` (`config.controller.js:9`), para que edições de catálogo/override propaguem na requisição seguinte. Não há push por WebSocket para config: é pull sob demanda (contraste com [[canal-collab-websocket]]).
- Erros seguem o padrão de [[erros-api]]; na prática, falha aqui significa banco fora, e isso derruba o boot do frontend inteiro.

## As quatro fontes do payload

`getAppConfig()` (`config.service.js:158-237`) monta o payload nesta ordem de precedência (a última vence):

1. **Estáticos de UI** (`config.static.js`): `APP`, `FEATURES`, `MAP2D_BASE`, `MAP3D_BOUNDS`, `MAP3D_VIEWER` e os builders de style MapLibre.
2. **Env** (`config.appConfig`, `backend/src/config.js:139-178`): URLs de tiles, terreno, imagery 3D, base de assets 3D e serviço 360.
3. **Tabelas de catálogo** (via `catalogService.listCatalog`): basemaps, camadas de análise, camadas de dados, tilesets, além de `ranks`/`organizations` para os selects de cadastro.
4. **Overrides de admin** (`config_settings`, chave `app_config`): `deepMerge(payload, overrides)` na última linha (`config.service.js:236`). O admin vence sobre estático e env.

> **Nota histórica.** guia *10-config* (absorvido) §"O payload é montado a partir de três fontes" lista apenas resources + env + estáticos; o código em `backend/src/modules/config/config.service.js:236` aplica ainda uma **quarta** camada, os overrides de admin persistidos em `config_settings` (`config.queries.js:4-17`), que vence todas as outras.

> **Nota histórica.** guia *10-config* (absorvido) §3 diz que basemaps/analysisLayers/dataLayers/tilesets vêm de uma **única tabela `resources`** (categorias) editada por `/api/v1/resources`; o código usa **uma tabela por tipo** (`backend/src/modules/catalog/catalog.tables.js:5-11`: `basemaps`, `data_layers`, `analysis_layers`, `tilesets`, `streetview_markers`) e **uma rota CRUD por tipo** (`backend/src/app.js:102-106`: `/api/v1/basemaps`, `/api/v1/data-layers`, `/api/v1/analysis-layers`, `/api/v1/tilesets`, `/api/v1/streetview-markers`). Não existe rota `/api/v1/resources`. Ver [[resources-catalogo]].

## As chaves emitidas (e as duas que a doc não lista)

Emitidas por `config.service.js:170-233`: `app`, `features`, `services`, `search`, `assets3dBaseUrl`, `basemaps`, `analysisLayers`, `dataLayers`, `map2d`, `map3d`, `tilesets`, `postos`, `organizacoesMilitares`, `streetView360`, `basemapStyles`.

> **Nota histórica.** guia *10-config* (absorvido) §"Contrato congelado" enumera 12 chaves de topo + `assets3dBaseUrl`; o código em `config.service.js:216-218` emite também `postos` e `organizacoesMilitares` (listas controladas de posto/graduação e OM, lidas de `ranks`/`organizations`), publicadas no endpoint **público** justamente para o formulário anônimo de cadastro popular seus selects antes do login. Ver [[gestao-usuarios]] e [[organizacoes-om]].

Tipos que não podem ser trocados (contrato congelado, ver [[sintese-contratos-congelados]]):

- **`basemaps` é OBJETO chaveado por id** (`config.service.js:63-70`), porque o frontend faz `config.basemaps[id]`. O `style` eventualmente gravado no `config` do recurso é **removido** dos metadados e emitido separado em `basemapStyles`.
- **`tilesets`, `analysisLayers.layers`, `dataLayers.layers` são ARRAYS** de `{ id, name, ...config }`.
- `analysisLayers`/`dataLayers` são `{ enabled, layers[] }`, sempre com `enabled: true` na montagem base (`config.service.js:188-189`); quem os desliga depois é o overlay por atlas.

`features.self_registration` é derivada de `config.security.allowSelfRegistration` (`config.service.js:174`) e existe só para o cliente decidir se mostra "Criar conta" (a rota `/auth/register` só é montada quando ligada). Ver [[autenticacao-jwt]].

## Regras não óbvias da montagem

**`search` é objeto vazio.** `search: {}` (`config.service.js:182`). A chave permanece por causa do shape congelado, mas não carrega mais `apiUrl`: o gazetteer **é este backend** (`GET /nomes/busca`) e o cliente deriva a rota da própria base da API. O antigo `SEARCH_API_URL` apontava por default para um `:3001` inexistente, o fetch dava connection-refused e a busca falhava em silêncio. Liga/desliga continua em `features.apisearch`. Ver [[gazetteer-nomes-geograficos]].

> **Nota histórica.** guia *10-config* (absorvido) §2 (tabela de chaves) diz que `search` vem de env e carrega `apiUrl`; o código em `config.service.js:176-182` emite `search: {}` deliberadamente, e `config.admin.schemas.js:43` mantém `search` só como objeto aberto para não quebrar payloads antigos. Atenção: `tests/e2e/config-contract.e2e.test.js:53-57` ainda afirma `cfg.search.apiUrl` como string não vazia, ou seja, essa asserção do contrato e2e está obsoleta em relação ao serviço.

**Camada de análise sem `bounds` é descartada.** `listAnalysisLayers` filtra qualquer camada cujo `bounds` não seja array de 4 posições (`config.service.js:93-95`). O motivo está no comentário do próprio código: uma camada semeada com `config: {}` (o placeholder `hillshade`) quebrava o boot do app no zoom-to-layer. Se uma camada "sumiu" do catálogo, o suspeito número um é `bounds` incompleto, não `active = false`.

**`terrainSource`/`hillshadeSource` têm duas formas incompatíveis.** `rasterDemSource` (`config.service.js:116-126`) decide pela presença de `{z}` na URL: sem `{z}` emite TileJSON (`{ url }`), com `{z}` emite template (`{ tiles: [url], minzoom?, maxzoom? }`). O frontend repassa isso **verbatim** para `map.addSource()`, e o MapLibre não intercambia as duas formas. `TERRAIN_MINZOOM`/`TERRAIN_MAXZOOM`/`HILLSHADE_*` só têm efeito na forma template. Sem URL, a fonte sai `undefined`.

**Terreno 3D só liga se houver URL.** `map3d.providers.terrain.enabled = Boolean(C.map3dTerrainUrl)` (`config.service.js:208`) e `MAP3D_TERRAIN_URL` tem default **vazio** (`backend/src/config.js:157`). Sem terreno, o Cesium usa o elipsoide plano em vez de tentar (e falhar) um provider inexistente.

> **Nota histórica.** guia *10-config* (absorvido) §6 e `docs/deploy.md` §appConfig documentam `MAP3D_TERRAIN_URL` com default `http://localhost/terrain/tilesets/terrain` e `SV360_SERVICE_URL` com default `http://localhost:3000/api/v1/sv360`; o código em `backend/src/config.js:157` usa default **vazio** para o terreno 3D (e publica `enabled: false`) e `backend/src/config.js:171` usa o default **relativo** `/api/v1/sv360`. Ver [[config-runtime-urls-relativas]].

**`basemapStyles`: env-injection é o default, o recurso é o override.** `listBasemapStyles` (`config.service.js:77-84`) começa dos 5 styles montados por `S.buildBasemapStyles(C)` (`config.static.js:124-132`: `carta-topografica`, `osm`, `bdgex`, `imagens`, `carta-ortoimagem`) e só substitui um id quando o recurso daquele basemap tem `config.style`. Ou seja, um style editado no admin **congela** aquele basemap contra a injeção por env: trocar `OSM_TILE_URL` não afeta mais quem tem style próprio salvo.

**`streetView360` é fonte vetorial MVT.** As duas sources (`pointsSource`/`linesSource`) apontam para o **mesmo** template `${serviceUrl}/tiles/{z}/{x}/{y}.pbf`; o frontend escolhe a camada por `pointsSourceLayer: 'fotos'` / `linesSourceLayer: 'fotos_linha'` (`config.service.js:225-231`). `{z}/{x}/{y}` são literais do MapLibre, não env. GeoJSON-como-fonte e PMTiles foram descontinuados. Ver [[streetview-360]].

**`assets3dBaseUrl`** é a base contra a qual o frontend resolve os `url` relativos do catálogo 3D (o catálogo guarda só caminho relativo). Ver [[catalogo-3d]] e [[assets3d-distribuicao]].

## Overrides de admin (`/config/admin`)

Rotas em `config.routes.js:16-18`, todas `auth + requireAdmin`:

- `GET /config/admin` devolve `{ effective, overrides }` (efetivo já mesclado + documento de override cru, para pré-preencher o editor).
- `PUT /config/admin` valida um **parcial** e o mescla no documento armazenado (`updateConfigOverrides`, `config.service.js:44-53`), então salvar uma seção nunca apaga as outras.
- `DELETE /config/admin` é a válvula de reversão: apaga o documento inteiro e a config volta a estático + env.

O schema (`config.admin.schemas.js:12-48`) aceita só as seções `app`, `features`, `map2d`, `map3d`, `services`, `search`, `streetView360`, `analysisLayers`, `dataLayers`, `assets3dBaseUrl`; cada seção é `.unknown(true)` (para o modo "Avançado (JSON)"), mas **chaves de topo desconhecidas são rejeitadas**, de propósito: basemaps/tilesets/camadas têm CRUD próprio de catálogo e não podem entrar por aqui. Há ainda a validação cruzada `map2d.minZoom <= map2d.maxZoom`.

Armadilha operacional: como o override é deep-merge server-side e vence env, uma URL errada gravada no override **não é corrigida** mudando a variável de ambiente. Só `DELETE /config/admin` (ou um novo `PUT` com o valor certo) resolve. Mudanças aqui são auditáveis via [[auditoria]].

## Overlay por atlas (restringe, nunca habilita)

Ao conectar num atlas remoto, `applyAtlasSettings` (`src/js/store/sync/atlas-settings.service.js:100-125`) sobrepõe o `atlas.settings` no mesmo objeto `config`. A regra é **interseção**: capacidade do deploy ∩ permissão do atlas (`intersectAvailability`, linhas 73-93). Nenhuma configuração de atlas consegue **ligar** o que o deploy desligou.

Pontos que causam bug se ignorados:

- Um baseline do nível-deploy é capturado no primeiro apply e restaurado por `revertAtlasSettings()` ao desconectar (linhas 144-167). O apply é idempotente (recomputa do baseline, nunca acumula).
- Arrays (`dataLayers.layers`, `analysisLayers.layers`, `tilesets`) são substituídos **in place** (`replaceArrayInPlace`, linha 134) para preservar a referência que o catálogo capturou.
- Consequência direta: o modal de configuração do atlas **não pode** ler `config.dataLayers.layers` (já filtrado). Tem que usar `getDeployDataLayers()`/`getDeployAnalysisLayers()`/`getDeployTilesets()` (linhas 176-191), senão o Gestor não consegue reabilitar uma camada que ele mesmo restringiu.
- Allowlist vazia ou ausente significa "sem restrição", não "nada permitido" (`filterLayers`, linha 57).
- O 360 vive fora do `config` (cache de preflight do sv360), então a allowlist é lida direto por `getAtlas360Allowlist()`.
- Mapeamento de nome que não bate: backend `features.panoramic_images` → frontend `config.features.imagens_panoramicas` (linha 83).

Detalhe do modelo em [[atlas-settings]]; quem pode configurar, em [[permissoes-atlas]].

## Variáveis de ambiente

Todas opcionais, com defaults **DEV-only** (OSM, Google Satellite, demotiles do MapLibre, BDGEx público). Em rede militar isolada nada disso resolve, e o boot **não avisa**: os defaults são intencionais para dev. Lista canônica em `backend/src/config.js:139-178` e em [[deploy-backend]]:

`TILE_SERVER_URL`, `TERRAIN_URL`, `HILLSHADE_URL`, `TERRAIN_MINZOOM`/`TERRAIN_MAXZOOM`, `HILLSHADE_MINZOOM`/`HILLSHADE_MAXZOOM`, `MAP3D_IMAGERY_URL`, `MAP3D_TERRAIN_URL`, `SV360_SERVICE_URL`, `OSM_TILE_URL`, `MAPLIBRE_GLYPHS_URL`, `IMAGENS_TILE_URL`, `ORTOIMAGEM_TILE_URL`, `BDGEX_WMS_URL`, `ASSETS_3D_BASE_URL`.

## Divergência residual da doc sobre fallback

> **Nota histórica.** guia *10-config* (absorvido) (diagrama da §"Visão Geral" e o parágrafo seguinte, "Se o backend estiver indisponível, o frontend mantém o `config.js` local como fallback") afirma que existe fallback local; o código em `src/js/index.js:83-86` mostra a tela "EBGeo indisponível" e aborta o boot, e `src/js/config.js:22-60` é um shell sem dado de deploy. A §7 do próprio guia já diz "NÃO há fallback", ou seja, a contradição é interna ao documento e o comportamento correto é o fail-fast.

## Checklist para não errar

- Mudou o *shape* do payload? É contrato congelado: alinhe frontend + teste de contrato (`tests/e2e/config-contract.e2e.test.js`) antes.
- Precisa de dado novo editável em runtime? Vai para a tabela de catálogo do tipo, não para `config.static.js` (que exige redeploy do backend).
- Precisa mudar uma URL de deploy? Env, não código, e não override de admin (o override é mais forte e mascara a env).
- Adicionou camada de análise? Garanta `bounds` de 4 posições ou ela é silenciosamente descartada.
- Nunca leia `config` antes do merge de boot: fora da ordem, você lê o shell vazio.


## Exemplo de resposta (contrato congelado)

## Exemplo de resposta (contrato congelado)

O endpoint responde sempre em envelope `{ data }` — o cliente lê `(await res.json()).data`, nunca a raiz. Este é o payload de referência para validar mudanças contra `tests/e2e/config-contract.e2e.test.js` (valores abaixo são os defaults DEV-only; `basemapStyles` está resumido, cada entrada é um style MapLibre completo):

```json
{
  "data": {
    "app": { "title": "EBGeo", "tutorialUrl": "./docs/doc.html" },
    "features": {
      "map_3d": true,
      "imagens_panoramicas": true,
      "apisearch": false,
      "grid": false
    },
    "services": { "tileServerUrl": "" },
    "search": {},
    "assets3dBaseUrl": "/api/v1/assets3d",
    "basemaps": {
      "carta-topografica": { "name": "Topográfica", "enabled": true, "image": "./images/layers/carta-topografica-thumb.png", "priority": 1 },
      "carta-ortoimagem": { "name": "Ortoimagem", "enabled": true, "image": "./images/layers/carta-ortoimagem-thumb.png", "priority": 2 },
      "bdgex": { "name": "BDGEx", "enabled": true, "image": "./images/layers/bdgex-thumb.png", "priority": 3 },
      "osm": { "name": "OSM", "enabled": false, "priority": 4 },
      "imagens": { "name": "Imagens", "enabled": false, "priority": 5 }
    },
    "analysisLayers": {
      "enabled": true,
      "layers": [{ "id": "hillshade", "name": "Sombreamento do Relevo" }]
    },
    "dataLayers": { "enabled": true, "layers": [] },
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
      "terrainSource": { "type": "raster-dem", "url": "https://demotiles.maplibre.org/terrain-tiles/tiles.json", "tileSize": 256 },
      "hillshadeSource": { "type": "raster-dem", "url": "https://demotiles.maplibre.org/terrain-tiles/tiles.json", "tileSize": 256 }
    },
    "map3d": {
      "bounds": { "west": -58.1, "south": -33.8, "east": -48.0, "north": -22.5 },
      "viewer": {
        "infoBox": false, "vrButton": false, "geocoder": false, "homeButton": false,
        "sceneModePicker": false, "baseLayerPicker": false, "navigationHelpButton": true,
        "animation": false, "timeline": false, "fullscreenButton": false
      },
      "providers": {
        "imagery": {
          "enabled": true, "type": "UrlTemplate",
          "url": "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "options": { "maximumLevel": 18, "minimumLevel": 0, "tileWidth": 256, "tileHeight": 256 }
        },
        "terrain": {
          "enabled": true, "type": "Cesium",
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
      "serviceUrl": "/api/v1/sv360",
      "pointsSource": { "type": "vector", "tiles": ["/api/v1/sv360/tiles/{z}/{x}/{y}.pbf"] },
      "pointsSourceLayer": "fotos",
      "linesSource": { "type": "vector", "tiles": ["/api/v1/sv360/tiles/{z}/{x}/{y}.pbf"] },
      "linesSourceLayer": "fotos_linha"
    },
    "basemapStyles": {
      "carta-topografica": { "version": 8, "glyphs": "...", "sources": {}, "layers": [] },
      "osm": { "version": 8, "glyphs": "...", "sources": {}, "layers": [] },
      "bdgex": { "version": 8, "glyphs": "...", "sources": {}, "layers": [] },
      "imagens": { "version": 8, "glyphs": "...", "sources": {}, "layers": [] },
      "carta-ortoimagem": { "version": 8, "glyphs": "...", "sources": {}, "layers": [] }
    }
  }
}
```

Lembre que o payload real também traz `postos` e `organizacoesMilitares` (ver seção anterior), ausentes do exemplo histórico da doc.

Request de referência — sem corpo, sem query, sem header obrigatório:

```http
GET /api/v1/config HTTP/1.1
Host: ebgeo.example.mil.br
```


## Mapa env → chave do payload

## Mapa env → chave do payload

A lista de nomes acima não diz **onde** cada variável cai no payload. Este é o mapeamento usado por quem configura um deploy:

| Variável | Chave no payload | Default |
|----------|------------------|---------|
| `TILE_SERVER_URL` | `services.tileServerUrl` | `""` |
| `TERRAIN_URL` | `map2d.terrainSource.url` | demotiles MapLibre |
| `HILLSHADE_URL` | `map2d.hillshadeSource.url` | demotiles MapLibre |
| `TERRAIN_MINZOOM` / `TERRAIN_MAXZOOM` | `map2d.terrainSource.minzoom`/`maxzoom` | — (só na forma template, ver acima) |
| `HILLSHADE_MINZOOM` / `HILLSHADE_MAXZOOM` | `map2d.hillshadeSource.minzoom`/`maxzoom` | — (só na forma template) |
| `MAP3D_IMAGERY_URL` | `map3d.providers.imagery.url` | OSM público |
| `MAP3D_TERRAIN_URL` | `map3d.providers.terrain.url` (+ `enabled`) | vazio no código; a doc antiga dizia `http://localhost/terrain/tilesets/terrain` |
| `SV360_SERVICE_URL` | `streetView360.serviceUrl` **e** o template de `pointsSource`/`linesSource` | `/api/v1/sv360` (relativo) |
| `OSM_TILE_URL` | tiles dos styles `carta-topografica` e `osm` | OSM público |
| `BDGEX_WMS_URL` | tiles do style `bdgex` | BDGEx WMS público |
| `IMAGENS_TILE_URL` | tiles do style `imagens` | Google tiles |
| `ORTOIMAGEM_TILE_URL` | tiles do style `carta-ortoimagem` | BDGEx ortoimagem WMS |
| `MAPLIBRE_GLYPHS_URL` | `glyphs` de **todos** os styles | demotiles MapLibre |
| `ASSETS_3D_BASE_URL` | `assets3dBaseUrl` | `/api/v1/assets3d` |

Duas leituras que evitam erro de deploy:

- `SV360_SERVICE_URL` alimenta **duas** coisas ao mesmo tempo (a base do serviço e o template `${serviceUrl}/tiles/{z}/{x}/{y}.pbf`); não existe env separada para os tiles.
- Um `config.style` gravado no catálogo **congela** aquele basemap contra `OSM_TILE_URL`/`BDGEX_WMS_URL`/etc., e um override de admin em `/config/admin` vence a env inteira. Trocar a variável não corrige nenhum dos dois casos.


## basemapStyles: qual env alimenta qual id

## basemapStyles: qual env alimenta qual id

São exatamente **5 styles**, indexados pelo id do basemap, cada um com sua fonte de tiles injetada por ambiente:

| id | Fonte de tiles (env) |
|----|----------------------|
| `carta-topografica` | `OSM_TILE_URL` |
| `osm` | `OSM_TILE_URL` |
| `bdgex` | `BDGEX_WMS_URL` |
| `imagens` | `IMAGENS_TILE_URL` |
| `carta-ortoimagem` | `ORTOIMAGEM_TILE_URL` |

O `glyphs` de todos vem de `MAPLIBRE_GLYPHS_URL`. Forma de um style emitido (exemplo `osm`):

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

Contexto histórico que explica por que isso mora no backend: no `config.js` antigo as URLs reais de tiles **não** estavam no `config.js` — moravam em módulos separados de `baselayers/*.js`. O endpoint as absorveu em `basemapStyles` para servir 100% da config num só lugar.

## Fontes

- guia *10-config* (absorvido): contrato congelado das chaves de topo, tipo objeto vs array de `basemaps`/`tilesets`, mapeamento de env → chave, semântica MVT do `streetView360`, tratamento de erro e ausência de fallback (§7). Divergências de fonte de dados (`resources`), `search.apiUrl`, defaults de `MAP3D_TERRAIN_URL`/`SV360_SERVICE_URL` e do fallback no diagrama estão marcadas acima.
- guia *visao-e-principios* (absorvido): o bootstrap de config como exceção única e deliberada ao offline-first; boot fail-fast em 3 tentativas; config por atlas como overlay restritivo revertido ao desconectar.
- guia *ui-ux-ebgeo* (absorvido): backend como fonte única do config na aba de configuração global (editor JSON como modo Avançado), `config.features.idle_timeout_minutes`, e a cadeia atlas-settings → filtra config → catálogo.
- `docs/deploy.md`: tabela de env do `appConfig` servida por `GET /api/v1/config`, `ASSETS_3D_BASE_URL`, e o alerta de que os defaults são placeholders DEV-only.
- Código (autoridade sobre a prosa): `backend/src/modules/config/{config.service,config.controller,config.routes,config.static,config.queries,config.admin.schemas}.js`, `backend/src/modules/catalog/{catalog.tables,catalog.service,catalog.routes}.js`, `backend/src/{app,config}.js`, `src/js/{index,config}.js`, `src/js/store/sync/{runtime-config,api-client,atlas-settings.service}.js`, `tests/e2e/config-contract.e2e.test.js`.
