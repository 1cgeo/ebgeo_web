# Distribuição de binários 3D (/assets3d)

Rota pública `GET /api/v1/assets3d/*` que serve tilesets, b3dm, glb/gltf, pnts e terrain como arquivos imutáveis, com dual-mode de armazenamento (store SQLite com semáforo de inflight, fallback filesystem por stream) e proteção anti-traversal.

## Papel no sistema: descoberta ≠ distribuição

O subsistema 3D é deliberadamente partido em duas metades:

1. **Descoberta** (autenticada): `GET /api/v1/nomes/catalogo3d` devolve metadados e a `url` **relativa** do binário. Ver [[catalogo-3d]] e [[gazetteer-nomes-geograficos]].
2. **Distribuição** (pública): `GET /api/v1/assets3d/*` entrega o byte stream.

A rota de assets é montada **antes** das rotas autenticadas (`src/app.js:95`) e não tem middleware de auth próprio (`src/modules/nomes/assets3d.routes.js:8` registra apenas `router.get('/*', ctrl.serveAsset)`). O único auth global é o `flexibleAuth` (`src/app.js:68`), que é **não bloqueante**: popula `req.user` quando há credencial e segue adiante. Consequência dura: **`/assets3d/*` nunca retorna 401/403 por falta de token**. O modelo de proteção é "quem não conhece a URL não baixa", com a descoberta gateada por [[autenticacao-jwt]] e [[zonas-acesso-geografico]]. Não é um controle de acesso ao binário. Se um modelo 3D for sigiloso, a URL dele é o segredo, e URL não é segredo bom.

Este módulo fica **fora do sync**: não há operação, nem CRDT, nem fila. Ver [[sintese-modulos-fora-do-sync]] e [[sintese-nao-e-crdt]].

## Resolução da URL (nunca hardcode o prefixo)

O catálogo guarda caminho relativo (`/aman/tileset.json`). A URL final é `assets3dBaseUrl + url`, onde `assets3dBaseUrl` vem do `GET /api/config` (`src/modules/config/config.service.js:150`, alimentado por `config.assets3d.baseUrl`, env `ASSETS_3D_BASE_URL`, default `/api/v1/assets3d`, em `src/config.js:63`). É um campo editável também pelo overlay de admin (`config.admin.schemas.js:46`).

Armadilha: hardcodar `/api/v1/assets3d` no cliente quebra qualquer deploy que aponte os assets para um host estático interno. Ver [[config-runtime-urls-relativas]] e [[config-dinamico]].

## Dual-mode: SQLite primeiro, filesystem depois

`serveAsset` (`src/modules/nomes/assets3d.controller.js:40`) tenta as duas fontes **em ordem**:

**1) Store SQLite** (`assets3d.store.js`). `getAssetMeta(rel)` faz um `SELECT size_bytes, content_type, etag FROM assets WHERE rel_path = ?` (`assets3d.store.js:36`), sem tocar no BLOB. Se houver linha, esse ramo assume a requisição inteira. A conexão de leitura é singleton, lazy, `readonly` + `query_only` + `mmap_size = 256MB` (`assets3d.store.js:22-25`); se o arquivo `.sqlite` não existir, `readDb()` retorna `null` e o pedido cai no filesystem (`assets3d.store.js:20`).

O BLOB só é lido no 200/206, via `blobPool.read` (`assets3d.store.js:47`), que roda o `SELECT data` numa **worker thread** (`src/utils/sqlite-blob-pool.js`) para não bloquear o event loop. Como o Buffer materializa no heap, a leitura é limitada por um **semáforo contador** (`createSemaphore(config.assets3d.maxInflight)`, `assets3d.controller.js:15`; env `ASSETS_3D_MAX_INFLIGHT`, default 8, `src/config.js:66`). A liberação é idempotente e amarrada a `res.on('finish')` **e** `res.on('close')` (`assets3d.controller.js:56-63`), justamente porque o Cesium aborta requisições o tempo todo; sem o `close` o semáforo vazaria slots e a rota travaria após 8 aborts.

**2) Filesystem** (`assets3d.service.js:27`, `resolveAsset`). Sem semáforo, porque a resposta é `createReadStream(...).pipe(res)` (`assets3d.controller.js:97,100`) e nunca materializa o arquivo inteiro na memória. Raiz em `config.assets3d.dir` (env `ASSETS_3D_DIR`, default `./data/assets3d`).

Ambos expõem **o mesmo contrato HTTP**. O cliente não distingue.

Carga do store é offline, por CLI: `node scripts/assets3d-import.js <dir>`, que percorre a árvore, normaliza a chave para posix (`scripts/assets3d-import.js:39`) e faz upsert numa única transação. Ver [[deploy-backend]].

## ETag e 304 (o ponto O(1))

O 304 curto-circuita **antes** de qualquer leitura pesada, nos dois ramos (`assets3d.controller.js:47` e `:87`).

| Fonte | ETag | Custo |
|---|---|---|
| Filesystem | `"{size}-{floor(mtimeMs)}"` derivado do `fs.stat` (`assets3d.service.js:42`) | O(1), nunca lê o arquivo |
| SQLite | coluna `etag` = `"sha1(conteúdo)"` calculado na importação (`assets3d.store.js:69`) | O(1), coluna indexada por `rel_path` |

Cache: `public, max-age=31536000, immutable` + `Accept-Ranges: bytes` (`assets3d.controller.js:14,33-38`). Ver [[sintese-cache-http-imutavel]].

Armadilha operacional: o ETag do filesystem depende de `mtime`. Um `rsync` que preserva mtime mantém o ETag; um `cp` sem `-p` muda o mtime e invalida o cache do mundo inteiro sem que o conteúdo tenha mudado. No store SQLite isso não acontece (sha1 de conteúdo). Republicar o **mesmo caminho** com conteúdo novo funciona nos dois modos, porque o ETag muda e o cliente revalida.

## Range (206 / 416)

`parseRange` (`assets3d.controller.js:18`) aceita exatamente `^bytes=(\d*)-(\d*)$`. Comportamento:

- `bytes=0-1023` → faixa fechada.
- `bytes=1024-` → aberto à direita, `end` clampado em `size-1`.
- `bytes=-500` → sufixo (últimos 500 bytes).
- Faixa fora dos limites, invertida, ou `bytes=-` → `'invalid'` → **416** com `Content-Range: bytes */{size}`.

Duas armadilhas reais:

- **Multi-range não é suportado**. `bytes=0-9,20-29` não casa o regex e vira **416**, não um 200 com o arquivo inteiro. Um proxy que reescreva Range em multipart quebra o carregamento do tileset.
- Não desabilite `Accept-Ranges` em proxies intermediários. O Cesium depende de Range para fatiar tilesets e terrain grandes.

## Anti-traversal: onde a guarda mora de fato

A validação existe **somente no ramo filesystem** (`assets3d.service.js:28-31`):

```js
const target = path.resolve(ROOT, '.' + path.posix.normalize('/' + (relUrl || '')));
if (target !== ROOT && !target.startsWith(ROOT + path.sep)) throw new ForbiddenError(...)
```

Como `path.posix.normalize('/' + rel)` colapsa os `..` contra a raiz, a esmagadora maioria das tentativas (`../../etc/passwd`, `%2e%2e/secret`) termina **dentro** da raiz apontando para um arquivo inexistente, e a resposta é **404**, não 403. O 403 só sobra para o caso residual em que o caminho ainda escapa após a normalização. O teste de integração reflete isso aceitando `403 || 404` (`tests/integration/assets3d.test.js:69-70`).

O ramo SQLite **não normaliza nada**: a busca é por igualdade exata de `rel_path` (chave primária), então traversal é inócuo ali por construção. Mas isso tem dois efeitos práticos:

- Variantes de caminho (`./aman/tileset.json`, `aman//tileset.json`, caminho com `..` colapsável) **erram o índice do SQLite** e caem silenciosamente no filesystem. Se o asset só existe no store, isso vira 404 sem explicação óbvia.
- Se algum dia alguém trocar a busca exata por prefixo/`LIKE`, a guarda anti-traversal precisa ser adicionada ali, porque hoje não existe nesse ramo.

Ver [[hardening-borda-api]].

## Content-Type por extensão

Mapa único em `assets3d.service.js:13-20` (e duplicado no CLI de import, `scripts/assets3d-import.js:11-18`, o que é uma fonte de divergência se alguém adicionar extensão em só um lugar):

| Extensão | Content-Type |
|---|---|
| `.json` (tileset.json, layer.json) | `application/json` |
| `.glb` | `model/gltf-binary` |
| `.gltf` | `model/gltf+json` |
| `.b3dm`, `.pnts`, `.terrain`, demais | `application/octet-stream` |

No ramo SQLite o Content-Type vem da coluna `content_type`, gravada na importação, e não é recalculado no request.

## Códigos de resposta

| Status | Quando | O que o cliente faz |
|---|---|---|
| `200` | Asset servido inteiro | Usar |
| `206` | Range válido | Cesium remonta sozinho |
| `304` | `If-None-Match` bateu | Usar cache |
| `404` | Asset ausente, ou traversal colapsada para dentro da raiz | Ocultar o modelo, logar; catálogo aponta para binário inexistente |
| `416` | Range malformado, fora de faixa ou multi-range | Refazer sem `Range` |
| `403` | Caminho que ainda escapa da raiz após normalização (raro) | Bug de montagem de URL |

Nunca `401`. O `401` só aparece na descoberta (`/nomes/catalogo3d`). Formato de erro em [[erros-api]].

## Notas de integração

- Concatene sempre `assets3dBaseUrl + m.url`.
- `type` do catálogo (`'Tiles 3D'` | `'Modelos 3D'` | `'Nuvem de Pontos'`) decide o loader; `style` (`Cesium3DTileStyle`) trafega verbatim. Detalhe em [[catalogo-3d]].
- O terrain do mapa 3D **não** sai desta rota por padrão: é URL configurável em `map3d.providers.terrain.url` no `/api/config`. A infra de `/assets3d` sabe servir `.terrain`/`layer.json` se um dia se decidir hospedá-lo aqui.
- O padrão de BLOB em SQLite + worker pool + semáforo é o mesmo usado pelo 360 (`SV360_MAX_INFLIGHT`, `src/config.js:72`); ver [[streetview-360]] e [[ingestao-projetos-360]]. Para blobs de usuário (que **são** sincronizados), o caminho é outro: [[imagens-atlas]].
- O contrato "URLs de asset são relativas" é congelado: ver [[sintese-contratos-congelados]] e [[sintese-decisoes-arquiteturais]].


## Trocas HTTP literais (200 / 304 / 206 / 416)

## Trocas HTTP literais (200 / 304 / 206 / 416)

O contrato descrito acima, com os headers exatos que a rota emite:

**200 — asset inteiro**

```http
GET /api/v1/assets3d/aman/tileset.json

→ 200 OK
  Content-Type: application/json
  Content-Length: 20480
  ETag: "20480-1705312200000"
  Cache-Control: public, max-age=31536000, immutable
  Accept-Ranges: bytes
```

O ETag do ramo filesystem é literalmente `"{size}-{floor(mtimeMs)}"`; no ramo SQLite é o sha1 do conteúdo. Em ambos vem entre aspas duplas e a comparação com `If-None-Match` é `===` estrito.

**304 — revalidação**

```http
GET /api/v1/assets3d/aman/tileset.json
If-None-Match: "20480-1705312200000"

→ 304 Not Modified
  (sem corpo)
```

**206 — Range válido**

```http
GET /api/v1/assets3d/aman/data.b3dm
Range: bytes=0-1023

→ 206 Partial Content
  Content-Range: bytes 0-1023/524288
  Content-Length: 1024
  Accept-Ranges: bytes
```

O `Content-Range` do 206 usa a forma `bytes {início}-{fim}/{tamanhoTotal}`, com `fim` **inclusivo** — `bytes=0-1023` devolve 1024 bytes, não 1023.

**416 — Range inválido**

```http
GET /api/v1/assets3d/aman/data.b3dm
Range: bytes=0-9,20-29

→ 416 Range Not Satisfiable
  Content-Range: bytes */524288
  (corpo vazio)
```

O 416 sempre traz `Content-Range: bytes */{tamanho}` e corpo vazio. Cliente que recebe 416 deve refazer **sem** o header `Range`, nunca reinterpretar a faixa.

## Fontes
- guia *14-catalogo3d-assets* (absorvido): contrato HTTP da rota, tabela de Content-Type, fluxo Cesium, resolução via `assets3dBaseUrl`, dual-mode e tabela de erros.
- `src/modules/nomes/assets3d.controller.js`: ordem store→filesystem, semáforo e liberação em finish/close, `parseRange`, headers imutáveis, 304/206/416.
- `src/modules/nomes/assets3d.service.js`: anti-traversal com `path.posix.normalize`, ETag O(1) por `fs.stat`, mapa de Content-Type.
- `src/modules/nomes/assets3d.store.js`: schema `assets`, conexão readonly+mmap, ETag sha1 na carga, leitura de BLOB via worker pool.
- `src/utils/semaphore.js`, `src/utils/sqlite-blob-pool.js`: semântica do semáforo e do pool de worker threads.
- `src/config.js`, `src/app.js`, `src/modules/config/config.service.js`: env vars, ordem de montagem (rota pública antes das autenticadas) e exposição de `assets3dBaseUrl`.
- `scripts/assets3d-import.js`: carga do store SQLite, chave posix, transação única.
- `tests/integration/assets3d.test.js`, `tests/integration/assets3d-sqlite.test.js`: confirmação de 200/304/206/416, `model/gltf-binary` e o comportamento `403 || 404` da traversal.
