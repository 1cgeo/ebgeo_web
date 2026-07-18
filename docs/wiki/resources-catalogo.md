# Resources (catálogo global de camadas e assets)

Registros globais versionados por categoria (basemap, analysis_layer, data_layer, tileset, streetview_marker) com um campo config livre por categoria, legíveis por qualquer autenticado e escritos apenas por admin.

## O que é o catálogo

O catálogo guarda a configuração **global do sistema** (não pertence a nenhum atlas): quais mapas base existem, quais camadas de análise e de dados estão disponíveis, quais tilesets 3D estão publicados. É a fonte que alimenta o `GET /api/v1/config` servido a todo cliente no boot (ver [[config-dinamico]]).

Distinção que mais confunde: o catálogo diz **o que existe no servidor**; o [[atlas-settings]] diz **o que aquele atlas pode usar** (subconjunto). Um item removido do catálogo some para todos; um item fora de `available_data_layers` some só naquele atlas.

## Uma tabela por tipo, não uma tabela `resources`

O modelo implementado **não** é uma tabela genérica `resources` com coluna `category`. São cinco tabelas dedicadas, com forma idêntica, declaradas em `src/database/migrations/003_sync.sql:101-115`:

| Tabela | Rota REST | Consumidor |
|---|---|---|
| `basemaps` | `/api/v1/basemaps` | `config.basemaps` + `config.basemapStyles` |
| `data_layers` | `/api/v1/data-layers` | `config.dataLayers` |
| `analysis_layers` | `/api/v1/analysis-layers` | `config.analysisLayers` |
| `tilesets` | `/api/v1/tilesets` | `config.tilesets` ([[catalogo-3d]]) |
| `streetview_markers` | `/api/v1/streetview-markers` | nenhum (ver Armadilhas) |

O whitelist vive em `src/modules/catalog/catalog.tables.js:5-11` e existe por um motivo de segurança concreto: o nome da tabela é **interpolado em SQL** (o driver `pg` não sabe fazer bind de identificador), então `assertTable()` em `catalog.tables.js:13-18` é a única barreira contra injeção via nome de tabela. Nunca chame o service com um `table` vindo de request. Hoje o `table` vem sempre fixo do mount em `src/app.js:102-106`, não do usuário. Mantenha assim (ver [[hardening-borda-api]]).

O router é uma fábrica: `makeCatalogRouter(table)` em `src/modules/catalog/catalog.routes.js:14-23` monta o mesmo CRUD para cada tipo, e os controllers são curried por tabela (`catalog.controller.js:6-25`). Adicionar um sexto tipo é: criar a tabela `LIKE basemaps INCLUDING ALL`, incluir no whitelist, montar a rota.

## Esquema da linha

Todas as cinco tabelas têm exatamente estas colunas (`003_sync.sql:101-110`):

```
id          VARCHAR(100) PRIMARY KEY   -- slug textual escolhido pelo admin, não UUID
name        VARCHAR(255) NOT NULL
description TEXT
config      JSONB NOT NULL DEFAULT '{}'
active      BOOLEAN NOT NULL DEFAULT true
sort_order  INTEGER NOT NULL DEFAULT 0
created_at / updated_at TIMESTAMPTZ
```

`id` é textual e fornecido pelo cliente (`carta-topografica`, `PCL`, `osm`), não gerado. Colisão retorna 409 `ConflictError` (`catalog.service.js:43-44`). Isso é intencional: o `id` é a chave que o frontend usa para indexar basemaps e para referenciar em `atlas.settings.available_*`, então trocar o id quebra referências existentes. Não há rota de rename de id; renomear é criar novo + reapontar settings.

`config` é um JSONB **livre por categoria**. O Joi valida apenas que é um objeto (`catalog.schemas.js:8`), nada do conteúdo. O contrato real de cada categoria é o shape que o `config.service.js` espalha na resposta de `/api/v1/config`, que é um [[sintese-contratos-congelados]] com o frontend.

## Permissões

Leitura exige apenas autenticação; escrita exige `role = admin` (`catalog.routes.js:16-21`). É papel **global** de usuário, não permissão de atlas: um `owner` de atlas sem `role=admin` não edita catálogo. Ver [[permissoes-atlas]] e [[gestao-usuarios]]. A autenticação é o JWT padrão ([[autenticacao-jwt]]).

## Soft delete e a assimetria do `active`

`DELETE` **não apaga a linha**: faz `active = false` (`catalog.service.js:84-89`) e responde 204. Isso preserva o histórico e evita quebrar FKs implícitas em `atlas.settings`.

A consequência importante é que o filtro `active = true` está em três lugares e a ausência dele em um deles já foi bug:

- `listCatalog` filtra (`catalog.service.js:27`).
- `getCatalogItem` filtra (`catalog.service.js:36`). Sem isso, um item soft-deletado continuava legível por id direto: sumia de toda listagem mas seguia sendo servido.
- `updateCatalogItem` filtra no `WHERE` (`catalog.service.js:70`). Sem isso, um item deletado podia ser editado de volta à visibilidade.

Não existe rota de "reativar". Ressuscitar um item soft-deletado hoje é operação de banco. Se você precisar disso, é uma rota nova, não um `PUT`.

Armadilha no `UPDATE`: todos os campos usam `COALESCE($n, coluna)`, então **`null` significa "não mexa"**, e não "limpe". Para `description`, passar `''` limpa de fato; um NULL literal é inalcançável pela API. Essa assimetria null-vs-vazio é comportamento deliberado, fixado por teste (`catalog.service.js:56-62`, teste `res-02` em `tests/integration/images-gaps.test.js`). Não "conserte" trocando o COALESCE sem alterar o teste.

## Validação de estilo MapLibre

Um `config.style` em qualquer categoria passa por `validateMapLibreStyle` antes de persistir, no create e no update (`catalog.service.js:15-22, 45, 55`); inválido vira 400 (ver [[erros-api]]). O validador (`src/utils/maplibre-style-validate.js`) checa o mínimo estrutural: `version === 8`, `sources` objeto, `layers` array.

O motivo é operacional, não estético: `config.style` de um basemap é servido **verbatim** em `config.basemapStyles` para todo cliente, inclusive anônimo. Um style malformado gravado no catálogo quebra o mapa base de todo mundo no próximo boot. O validador do backend espelha o do cliente em `ebgeo_web/src/js/utilities/maplibre-style-validate.js`; se um mudar, mude o outro.

## Como o catálogo vira `/api/v1/config`

`src/modules/config/config.service.js` lê as tabelas via `catalogService.listCatalog` e reformata:

- `listBasemaps` (`config.service.js:63-70`) devolve um **objeto indexado por id**, não array, porque o frontend indexa por id. E **remove `style` do metadata**.
- `listBasemapStyles` (`config.service.js:77-85`) parte dos builders estáticos (URLs injetadas por ENV) e deixa `config.style` **sobrescrever** por id. Ou seja: sem style no catálogo, vale o default com ENV; com style, o admin ganha. Esse desenho preserva a injeção de URL relativa do deploy ([[config-runtime-urls-relativas]]).
- `listAnalysisLayers` (`config.service.js:86-96`) **filtra fora** qualquer camada sem `bounds` array de 4 elementos. Isso é uma trava de contrato: o frontend faz zoom-to-layer com `bounds`, e uma camada seedada incompleta (o `hillshade` do seed tem `config = '{}'`) já quebrou o boot da aplicação. Consequência prática: você cria um `analysis_layer` pela API, ele volta 201, aparece em `GET /analysis-layers`, e **não aparece em `/config`**. Não é bug, é o filtro. Confira o `bounds`.
- `listDataLayers` e `listTilesets` (`config.service.js:98-107`) fazem spread simples de `{ id, name, ...config }`.

`GET /api/v1/config` responde com `Cache-Control: no-cache` (`config.controller.js:9`), então uma edição de catálogo aparece no próximo boot de cliente sem invalidação manual. Isso é o oposto do regime dos assets binários ([[sintese-cache-http-imutavel]]).

## Metadata, não bytes

O CRUD do catálogo mexe **só no registro**. Os bytes (tileset 3D, bundle 360, mídia) são publicados fora de banda e servidos por outra rota ([[assets3d-distribuicao]]). Criar um `tileset` com `config.url` apontando para um caminho que não existe produz um item que aparece na UI e falha ao abrir. Publique o asset primeiro.

## Armadilhas

- **`streetview_markers` está órfão.** A tabela existe e a rota `/api/v1/streetview-markers` está montada (`app.js:106`), mas nenhum consumidor lê essa tabela: o `config.service.js` não a inclui, e o módulo 360 real usa o schema próprio `sv360.*` (`sv360.admin.queries.js`, `sv360.queries.js`). Ver [[streetview-360]] e [[ingestao-projetos-360]]. Escrever ali não tem efeito visível hoje.
- **Escritas de catálogo não são auditadas.** `createAudit` é chamado por `users`, `organizations` e `zones`, e por nenhum arquivo de `modules/catalog/`. Uma troca de basemap global por admin não deixa rastro em [[auditoria]]. Se isso importar no seu deploy, é trabalho a fazer, não algo que já existe.
- **Catálogo não passa pelo sync.** Não há operação de catálogo no pipeline colaborativo; é REST puro e global, fora do escopo de [[sintese-rest-vs-sync]] e de [[sync-admin-operacoes]]. Um admin editando o catálogo não gera evento para clientes conectados: quem já está com o app aberto continua com o config do boot dele.
- **`sort_order` empata por nome.** `ORDER BY sort_order, name` (`catalog.service.js:27`). Deixar tudo em 0 vira ordem alfabética.

## Divergências com a documentação

> **Nota histórica.** guia *09-admin* (absorvido) §3.2-3.6 documenta uma API genérica `GET/POST/PUT/DELETE /api/v1/resources` com filtro `?category=basemap` e um campo `category` em cada registro. Essa rota **não existe** no código: `grep "v1/resources"` em `src/` não retorna nada, e o mount real são cinco rotas por tipo em `src/app.js:102-106`, sobre cinco tabelas dedicadas (`src/database/migrations/003_sync.sql:101-115`). Não há coluna `category` em lugar nenhum. O cliente já acompanha o modelo novo e traduz a categoria antiga para a rota nova em `ebgeo_web/src/js/store/sync/api-client.js:419-425`.

> **Nota histórica.** guia *09-admin* (absorvido) §3.2 afirma que "o campo `active` não é incluído na resposta de listagem". O código inclui: `COLS` em `src/modules/catalog/catalog.service.js:9` lista `active` explicitamente e é usado tanto no `listCatalog` quanto no `getCatalogItem`. A parte correta da nota é que a listagem só devolve linhas com `active = true`.

> **Nota histórica.** guia *09-admin* (absorvido) §3.6 descreve o DELETE apenas como "204 No Content", sem dizer que é soft delete. O código faz `UPDATE ... SET active = false` (`src/modules/catalog/catalog.service.js:86`), a linha permanece no banco e não há rota para reverter.

## Relacionados

- [[config-dinamico]], [[config-runtime-urls-relativas]]: como o catálogo chega ao cliente.
- [[atlas-settings]]: recorte por atlas sobre o catálogo global.
- [[catalogo-3d]], [[assets3d-distribuicao]], [[streetview-360]]: consumidores dos tipos `tileset` e 360.
- [[gestao-usuarios]], [[permissoes-atlas]], [[organizacoes-om]]: o papel `admin` que destrava a escrita.
- [[api-rest-atlas]], [[erros-api]]: convenções REST e formato de erro.


## Shape do `config` por categoria

## Shape do `config` por categoria

O Joi valida apenas que `config` é um objeto (`catalog.schemas.js:8`), então o contrato real de cada categoria é o que o consumidor espera. O seed de `003_sync.sql:130-175` é a referência canônica do shape (está "já no shape de `GET /api/v1/config`", como diz o comentário do próprio DDL).

### `basemaps` — metadado do seletor, não a fonte de tiles

```json
{
  "id": "carta-topografica",
  "name": "Topográfica",
  "sort_order": 1,
  "config": {
    "enabled": true,
    "image": "./images/layers/carta-topografica-thumb.png",
    "priority": 1
  }
}
```

| Campo | Uso |
|---|---|
| `enabled` | liga/desliga no seletor de mapa base |
| `image` | thumbnail do seletor (caminho relativo ao frontend) |
| `priority` | ordem de exibição no seletor (distinta de `sort_order`, que ordena a listagem REST) |
| `style` | opcional; style MapLibre completo que **sobrescreve** o builder estático em `config.basemapStyles` (validado por `validateMapLibreStyle`) |

A URL de tiles **não** vive aqui no caso default: ela vem dos builders com URLs injetadas por ENV (`config.service.js:77-85`). Só um `config.style` explícito muda a fonte.

### `analysis_layers` — precisa de `source` + `bounds`

```json
{
  "id": "declividade",
  "name": "Declividade",
  "config": {
    "description": "Mapa de declividade do terreno",
    "source": { "type": "raster-dem", "url": "http://host/tiles/dem/{z}/{x}/{y}.png" },
    "bounds": [-45, -23, -44, -22],
    "paint": { "raster-opacity": 0.7 }
  }
}
```

`bounds` é array de **4 números** ([oeste, sul, leste, norte]) e é obrigatório na prática: sem ele a camada é filtrada fora de `/api/v1/config` (`config.service.js:86-96`), mesmo devolvendo 201 na criação. O `hillshade` do seed nasce com `config = '{}'` justamente por ser tratado à parte pelo cliente.

### `data_layers` — vetorial com `sourceLayer` e faixa de zoom

```json
{
  "id": "rodovias-federais",
  "name": "Rodovias Federais",
  "config": {
    "description": "Malha rodoviária federal",
    "source": { "type": "vector", "url": "http://host/tiles/rodovias" },
    "sourceLayer": "rodovias",
    "minzoom": 4,
    "maxzoom": 18,
    "style": { "border": { "color": "#E74C3C", "width": 2, "opacity": 1 } }
  }
}
```

### `tilesets` — 3D, com metadado de ficha e ponto de voo

```json
{
  "id": "PCL",
  "name": "Posto de Comando Logístico",
  "config": {
    "url": "/3d/PCL/tileset.json",
    "heightOffset": 35,
    "description": "Modelo 3D capturado por drone",
    "keywords": ["PCL", "posto comando", "drone"],
    "data_captura": "15/03/2024",
    "local": "Resende, RJ",
    "previewVideo": "/3d/videos/preview.webm",
    "previewThumbnail": "/3d/videos/thumbnail.jpg",
    "locate": { "lon": -44.4733, "lat": -22.4397, "height": 1000 }
  }
}
```

`url` aponta para o asset publicado fora de banda ([[assets3d-distribuicao]]); `locate` é o alvo do "voar até" e `heightOffset` corrige a altitude do modelo. Ver [[catalogo-3d]].

### `streetview_markers`

Sem shape de contrato: nenhum consumidor lê essa tabela hoje (ver Armadilhas).

> **Nota histórica.** guia *09-admin* (absorvido) §3.7 exemplifica `config` de basemap com `{ url, attribution, maxZoom, minZoom }` e de analysis_layer com um array `legend` de faixas coloridas. Nenhuma dessas chaves aparece no seed real (`src/database/migrations/003_sync.sql:130-175`) nem é lida por `src/modules/config/config.service.js:61-107`; basemap usa `enabled`/`image`/`priority` (+`style` opcional) e analysis_layer usa `source`/`bounds`/`paint`. O exemplo de `tileset` do guia é o mais próximo do real, mas `maximumScreenSpaceError` também não consta do seed.


## Mídia do catálogo pelo painel admin: chaves, limites e o que fica fora de banda

## Mídia do catálogo pelo painel admin: chaves, limites e o que fica fora de banda

O catálogo guarda metadado, não bytes, com **uma exceção deliberada**: a miniatura, que o painel admin embute no próprio `config` como data URL base64 (`src/js/admin/catalog-tab.js:251`, `:382-386`). O motivo é que o backend não serve estático público e `deploy/` é protegido (ver [[sintese-decisoes-arquiteturais]]). Consequência direta: a miniatura pesa no payload de `GET /api/config` de **todo** boot, inclusive anônimo ([[config-dinamico]]).

### Onde a miniatura é gravada, por categoria

A chave dentro de `config` muda por categoria, espelhando os shapes reais do deploy (`catalog-tab.js:21-27`):

| Categoria (UI) | Tipo de recurso | Chave da miniatura |
|---|---|---|
| 3D (modelos) | `tileset` | `previewThumbnail` |
| Dados | `data_layer` | `thumbnail` |
| Análises | `analysis_layer` | `thumbnail` |
| Basemaps | `basemap` | `image` |
| 360 | `sv360` | nenhuma (rotas admin do 360, ver [[ingestao-projetos-360]]) |

### Limites numéricos do upload

| Limite | Valor | Fonte |
|---|---|---|
| Tipos aceitos no seletor | `image/png`, `image/jpeg`, `image/webp` | `catalog-tab.js:276` |
| Dimensão máxima após downscale | 420 px | `catalog-tab.js:287` |
| Qualidade / formato de saída | 0.82, sempre `image/webp` | `catalog-tab.js:287` |
| Teto do data URL final | **256 KB** (`256 * 1024`) | `catalog-tab.js:31` |
| Tamanho típico resultante | ~10 a 40 KB | `catalog-tab.js:29-30` |

WebP é escolha consciente: preserva transparência, que JPEG achataria em preto. O teto de 256 KB existe porque `compressImage` pode **silenciosamente devolver o original** quando o decode falha; sem o teto, um PNG grande entraria inteiro no `/api/config`. Estourando o teto, o upload é recusado com "Imagem muito grande mesmo após reduzir" e nada é gravado (`catalog-tab.js:288-292`).

### Semântica de gravação dos campos de mídia

Ao salvar (`catalog-tab.js:379-391`):

- miniatura nova escolhida **vence** o JSON digitado;
- "Remover" faz `delete config[chave]`;
- campo intocado preserva o valor que já estava no JSON;
- **vídeo de preview é exclusivo de `tileset`** e fica fora de banda: é só uma URL em `config.previewVideo`, nunca upload. Campo esvaziado faz `delete`, então remover não é no-op (`catalog-tab.js:322-326`, `:387-390`).

Como o catálogo não passa pelo sync, quem já está com o app aberto continua com o config do boot dele; a mídia nova só aparece no próximo carregamento.

## Fontes

- guia *09-admin* (absorvido): categorias de resource, semântica de permissão (leitura autenticada / escrita admin), exemplos de `config` por categoria, tabela geral de rotas. Contradito quanto à forma da API (`/resources` genérica com `category`), ao `active` na listagem e à natureza do delete.
- `ebgeo_backend/src/modules/catalog/catalog.tables.js`: whitelist das cinco tabelas e o `assertTable` que guarda a interpolação SQL.
- `ebgeo_backend/src/modules/catalog/catalog.service.js`: CRUD real, filtro `active`, soft delete, semântica do COALESCE, validação de style.
- `ebgeo_backend/src/modules/catalog/catalog.routes.js` e `catalog.controller.js`: fábrica de router por tabela e gate `auth` / `requireAdmin`.
- `ebgeo_backend/src/modules/catalog/catalog.schemas.js`: shape aceito no create/update (`config` como objeto livre).
- `ebgeo_backend/src/app.js:102-106`: mount real das rotas por tipo, prova de que `/api/v1/resources` não existe.
- `ebgeo_backend/src/database/migrations/003_sync.sql:95-175`: DDL das tabelas, comentário justificando o desenho por tipo, e o seed de basemaps/analysis/data/tilesets.
- `ebgeo_backend/src/modules/config/config.service.js:61-107`: transformação catálogo -> payload de `/api/v1/config`, incluindo o filtro de `bounds` e a sobreposição de `basemapStyles`.
- `ebgeo_backend/src/utils/maplibre-style-validate.js`: regras de validação do style e o motivo (servido verbatim).
- `ebgeo_web/src/js/store/sync/api-client.js:407-465`: mapeamento categoria -> endpoint no cliente, confirmando o modelo por tipo.
