# Imagens do atlas (REST + referência por imageId)

Imagens vivem fora do fluxo CRDT: são enviadas por REST em `/atlas/:id/images` (ou `/images/bulk` em base64), retornam um `imageId`, e as features do tipo `image` apenas referenciam esse id em suas properties.

## Por que imagens não passam pelo sync

O canal de operações (ver [[envelope-operacao]] e [[canal-collab-websocket]]) transporta JSON pequeno, ordenado e idempotente. Blob binário de até 10 MB não cabe nesse modelo: inflaria a fila outbound ([[fila-operacoes-outbound]]), a tabela de operações ([[tabela-operations]]) e o replay de [[snapshot-e-pull-incremental]]. A decisão é separar os planos:

- **Bytes** viajam por REST, fora do log de operações, sem versionamento e sem LWW.
- **Referência** (o `imageId`, uma string) viaja dentro de uma operação normal de feature, sujeita a [[modelo-conflito-lww]] como qualquer outra property.

Consequência prática: uma imagem nunca "conflita". O que conflita é a feature que aponta para ela. Ver também [[sintese-rest-vs-sync]] e [[sintese-modulos-fora-do-sync]].

## Endpoints

Montados em `src/modules/images/images.routes.js:64-68` (backend), todos sob `/api/v1/atlas/:atlasId/images`:

| Método | Rota | Permissão exigida |
|---|---|---|
| GET | `/` (listar) | `read` |
| POST | `/` (upload multipart) | `write` |
| POST | `/bulk` (base64, até 50) | `write` |
| GET | `/:imageId` (download) | `read` |
| DELETE | `/:imageId` | `write` |

A permissão vem de `requireAtlasPermission` (hierarquia `read < comment < write < manage < owner`, `src/middleware/permissions.js:13-17`). Portanto **Comentarista não faz upload**, só lê. Ver [[permissoes-atlas]] e [[permissoes-atlas]].

## Contrato de upload individual

`POST /atlas/:id/images` é `multipart/form-data`, campo **`image`** (`images.routes.js:52`). O cliente NÃO deve setar `Content-Type` manualmente: o boundary vem do `FormData` (`src/js/store/sync/api-client.js:857-866`).

Resposta 201: `{ data: { id, atlas_id, filename, mime_type, size_bytes, uploaded_by, created_at } }`.

> [!CONTRADICAO 2026-07-18] guia *06-presenca-imagens* (absorvido) §2.3 mostra `storage_path` na resposta; o código em `src/modules/images/images.service.js:22-27` remove esse campo via `toPublicImage()` antes de cruzar a borda da API (caminho absoluto de disco vaza o layout do deploy, e viewers de atlas público conseguem listar imagens). `listImages` também usa `toPublicImage` (`images.service.js:115`); `getImageById` não usa, mas é uso interno.

### Validação, tipos e limites

- Allowlist: `image/png`, `image/jpeg`, `image/webp`. **SVG é rejeitado com 400** por ser vetor de stored-XSS (`images.service.js:12-14`).
- Duas barreiras de tipo: o `fileFilter` do multer olha o mimetype declarado (`images.routes.js:37-45`) e o service revalida por **magic bytes** do conteúdo real, exigindo `detected.mime === file.mimetype` (`images.service.js:45-49`). Um HTML renomeado para `.png` morre aqui, e o arquivo já gravado é apagado.
- Tamanho: `config.images.maxSizeMb` (default 10 MB). Estouro vira `LIMIT_FILE_SIZE` do multer, convertido explicitamente em 400 (`images.routes.js:51-62`), não 500. Ver [[erros-api]] e [[upload-imagens-seguranca]].

### Download

`GET /:imageId` responde com `Content-Disposition: attachment` (nunca inline, evita XSS renderizado) e `Cache-Control: private, max-age=31536000, immutable` (`images.controller.js:16-27`). `res.sendFile` cuida de ETag, 304 condicional e Range/206. O cache agressivo é seguro porque **o id é imutável**: um upload novo gera um id novo, nunca sobrescreve bytes. Ver [[sintese-cache-http-imutavel]].

Armadilha: o endpoint é autenticado por header `Authorization`, então **não dá para colocar a URL direto num `<img src>`**. O cliente busca o blob e faz `URL.createObjectURL` (`api-client.js:916-923`).

## Como a feature referencia a imagem

> [!CONTRADICAO 2026-07-18] guia *06-presenca-imagens* (absorvido) §2.5/Parte 3 e guia *08-offline-import* (absorvido) §4.2 dizem que a referência fica em `properties.imageId`; o código do frontend grava o id em **`properties.id`** (`src/js/draw_tools/image_tool/add_image_control.js:355`) e o renderer lê de lá (`src/js/layers/layer_setup.js:182`). Não existe `properties.imageId` no código. Quem for consumir a feature no servidor deve olhar `properties.id`.

Na prática, para uma feature `image` **o id da imagem é o id da feature**: `addImageFeature` faz upload, usa `uploaded?.id` como `imageId` e usa esse mesmo valor como `properties.id` (`add_image_control.js:304-308`). Isso é deliberado e é o que permite o import preservar ids (adiante).

Há um segundo consumidor de imagem: os **ícones customizados de ponto**, referenciados como `markerSymbol: "custom:<imageId>"` (`src/js/import_export/local-atlas-to-server.js:116`). O registro de metadados dos ícones vai em `atlas.settings.customIcons` (ver [[atlas-settings]]), os blobs vão pelo endpoint de imagens (`src/js/store/customIcons.operations.js:107-133`).

## Fallback de leitura (o que faz o peer convergir)

O ponto que engenheiro esquece: receber a operação não traz os bytes. O peer recebe uma feature com um id de imagem que ele não tem em IndexedDB. A convergência visual vem de um fallback local-primeiro:

```
getImage(imageId): blob local → se ausente, fetchImageBlob(imageId) no backend → cacheia local
```

`src/js/store/settings.operations.js:224-235` (fotos) e `customIcons.operations.js:154-164` (ícones). O gateway é `src/js/store/sync/image-sync.js`, um seam fino sobre o `apiClient` que **não importa o grafo do store** (evita ciclo de import) e recebe o atlas conectado via `setImageSyncAtlas` injetado pelo sync-engine (`image-sync.js:16-34`).

Duas propriedades desse seam, ambas intencionais:

- **Best-effort:** `uploadImageBlob` e `fetchImageBlob` engolem erro e retornam `null` (`image-sync.js:44-66`). Falha de rede degrada para "sem imagem", nunca lança.
- **Offline vira id local:** se `_atlasId` é `null` (não conectado), o upload retorna `null` e o tool gera um UUID local (`add_image_control.js:305`). A feature funciona local; o blob só existe naquele navegador. Ver [[dominio-local-vs-remoto]] e [[modos-operacao]].

Armadilha: uma feature de imagem criada offline e sincronizada depois carrega um id que **não existe no servidor**. O peer chama `fetchImageBlob`, recebe 404, e mostra nada. Só o caminho de "salvar atlas local no servidor" (abaixo) reconcilia isso.

## Bulk upload e preservação de id no import

`POST /atlas/:id/images/bulk` recebe `{ images: [{ localId, filename, mimeType, data }] }`, com `localId` obrigatoriamente **UUID** e no máximo **50 itens por requisição** (Joi em `src/modules/images/images.schemas.js:9-18`). `data` aceita base64 puro ou data URL (o split de `,` em `images.service.js:153-155`).

O comportamento decisivo está em `images.service.js:190-213`: a **primeira ocorrência de cada `localId` é inserida COM esse id** (`INSERT_IMAGE_WITH_ID`), ou seja, o servidor preserva o id do cliente. Só um `localId` duplicado dentro do mesmo lote recebe id novo gerado, e o `mapping` colapsa last-wins.

> [!CONTRADICAO 2026-07-18] guia *08-offline-import* (absorvido) §4.7 ("IDs locais são substituídos por IDs do servidor") e §4.4 (fase 4 "enviar operação de UPDATE para atualizar `properties.imageId`") descrevem um rewrite pós-import; o backend em `src/modules/images/images.queries.js:13-17` preserva o `localId` como id do servidor, e o orquestrador do frontend `src/js/import_export/save-local-atlas.service.js:103-105` faz o import do atlas ANTES do upload das imagens **exatamente para não precisar de rewrite**. Não existe fase de UPDATE de referência no código.

A ordem correta, em `save-local-atlas.service.js:97-105`:

1. `buildExportDataObject` monta o `.ebgeo` em memória (ver [[formato-ebgeo-roundtrip]]),
2. `buildServerImportPayload` transforma no payload de import e devolve a lista `imageIds`,
3. `importAtlas` cria atlas + entidades, com as refs ainda apontando para os ids locais (ver [[atlas-import-offline]]),
4. bulk upload dos blobs **preservando os ids**, em chunks de 50 (`uploadImagesInChunks`, `save-local-atlas.service.js:72-82`).

Outras armadilhas desse caminho:

- **PK global.** A tabela `images` tem PK global, não composta por atlas. Re-salvar o mesmo atlas local uma segunda vez colide em `unique_violation` no `INSERT_IMAGE_WITH_ID`; o comentário em `images.queries.js:9-11` documenta que isso é tratado como falha do item, não da requisição.
- **Falha parcial é o normal.** O loop de bulk é por item: erro em um vira entrada em `failed` e os demais são gravados (`images.service.js:227-232`). O cliente precisa ler `failed`, não só o status 201.
- **Blob é gravado DEPOIS do INSERT** (`images.service.js:215-217`), para que um INSERT que falhe não deixe arquivo órfão em disco.
- **SVG local é pulado silenciosamente.** `collectImageUploads` filtra pela allowlist e reporta como `skipped` (`save-local-atlas.service.js:51-54`), então um ícone customizado SVG sobrevive local e some para os colaboradores.

## Delete e referências penduradas

`DELETE` responde 204, remove a linha e tenta `unlink` do arquivo; falha no unlink só gera warn (`images.service.js:97-111`). **Não há verificação de features referenciando a imagem.** Feature com id órfão é estado esperado; o renderer degrada para "sem imagem" (o `getImage` retorna `null`). O mesmo vale para a direção inversa: apagar a feature não apaga o blob no servidor.


## Shape da resposta do bulk e catálogo de mensagens de falha

## Shape da resposta do bulk e catálogo de mensagens de falha

### Request

```json
{
  "images": [
    {
      "localId": "local-image-uuid-1",
      "filename": "foto-001.jpg",
      "mimeType": "image/jpeg",
      "data": "data:image/jpeg;base64,/9j/4AAQ..."
    },
    {
      "localId": "local-image-uuid-2",
      "filename": "foto-002.png",
      "mimeType": "image/png",
      "data": "iVBORw0KGgo..."
    }
  ]
}
```

Joi (`images.schemas.js:9-18`): `localId` UUID obrigatório, `filename` ≤ 255 chars, `mimeType` restrito a `image/png | image/jpeg | image/webp`, array de **1 a 50** itens. Fora dessa faixa é 400 na borda, antes de qualquer item ser processado.

### Response 201

```json
{
  "data": {
    "uploaded": [
      {
        "localId": "local-image-uuid-1",
        "serverId": "local-image-uuid-1",
        "filename": "foto-001.jpg",
        "size": 245678
      }
    ],
    "failed": [
      { "localId": "local-image-uuid-2", "error": "File too large: 12MB (max: 10MB)" }
    ],
    "mapping": { "local-image-uuid-1": "local-image-uuid-1" }
  }
}
```

Note que `serverId === localId` no caso normal (preservação de PK descrita acima) — o `mapping` só é uma função não-identidade para `localId` duplicado dentro do lote. O item em `failed` **não** entra em `mapping`.

### Mensagens de `failed.error`

São strings literais produzidas por `images.service.js:140-232`; o cliente que quiser classificar a falha precisa casar por elas, pois não há código de erro estruturado por item:

| `error` | Causa | Reprocessável? |
|---|---|---|
| `Invalid file type: <mime>` | `mimeType` fora da allowlist (chegou aqui só se o Joi foi contornado) | não |
| `Invalid base64 data` | `data` não decodifica | não |
| `File too large: NMB (max: 10MB)` | buffer decodificado maior que `MAX_IMAGE_SIZE_MB` | não sem recomprimir |
| `Content does not match declared type` | magic bytes ausentes, fora da allowlist, ou `detected.mime !== mimeType` | não sem corrigir o `mimeType` |
| `duplicate key value violates unique constraint ...` (mensagem crua do PG) | colisão de PK global — mesmo atlas local salvo duas vezes | não, o id já existe |
| outras | `err.message` cru, ou `Unknown error` | depende |

O tamanho é medido **sobre o buffer decodificado**, não sobre a string base64 (que é ~33% maior), então dimensionar o lote pelo tamanho do JSON subestima o limite do servidor.

**Status HTTP não indica sucesso.** O loop é por item e a requisição responde 201 mesmo com todos os itens em `failed`. Ler apenas o status é o erro clássico de integração aqui.


## Resposta do bulk: shape exato e leitura de `failed[]`

## Resposta do bulk: shape exato e leitura de `failed[]`

`POST /atlas/:id/images/bulk` responde **201** (não 200) mesmo quando parte do lote falha — o status não é indicador de sucesso, o corpo é (`images.controller.js:52`).

```json
{
  "data": {
    "uploaded": [
      { "localId": "local-uuid-1", "serverId": "server-uuid-1", "filename": "foto1.png", "size": 12345 },
      { "localId": "local-uuid-2", "serverId": "server-uuid-2", "filename": "foto2.jpeg", "size": 67890 }
    ],
    "failed": [
      { "localId": "local-uuid-3", "error": "Content does not match declared type" }
    ],
    "mapping": {
      "local-uuid-1": "server-uuid-1",
      "local-uuid-2": "server-uuid-2"
    }
  }
}
```

Três detalhes de contrato que mordem quem escreve o cliente:

- Em `uploaded[]` o campo é **`size`**, não `size_bytes` (vem de `serverImage.size_bytes` renomeado, `images.service.js:222`), e **`serverId`**, não `id`. Não é o mesmo shape de `toPublicImage` usado no upload individual e no `GET /` de listagem.
- `mapping` só contém os itens de `uploaded[]`. Um `localId` que caiu em `failed[]` **não aparece** no mapping — iterar `mapping` para conferir o lote inteiro esconde as falhas.
- Quando `localId` se repete dentro do mesmo lote, ambas as ocorrências entram em `uploaded[]` (com `serverId` diferente na segunda), mas `mapping[localId]` colapsa em last-wins.

### Mensagens de `error` produzidas por item

São strings literais, geradas no loop de `bulkUploadImages` (`images.service.js:140-232`):

| `error` | Causa |
|---|---|
| `Invalid base64 data` | `Buffer.from` estourou ao decodificar `data` |
| `File too large: <N>MB (max: 10MB)` | Buffer decodificado acima de `MAX_IMAGE_SIZE_MB` |
| `Content does not match declared type` | Magic bytes ausentes, fora da allowlist, ou divergentes do `mimeType` declarado |
| `Invalid file type: <mime>` | **Inalcançável pela rota HTTP** — o Joi barra antes com 422 (ver [[upload-imagens-seguranca]]) |
| `<err.message>` ou `Unknown error` | Exceção inesperada, tipicamente `unique_violation` da PK global ao re-salvar o mesmo atlas local |

A última linha é a que aparece na prática em produção: colisão de PK global vira **falha de item**, com o texto do driver Postgres, não erro de requisição.

## Fontes

- guia *06-presenca-imagens* (absorvido): tabela de endpoints, contrato multipart/base64, formato de resposta, limites e tipos aceitos, fluxo upload → operação → fetch pelo peer, referência da feature de imagem.
- guia *08-offline-import* (absorvido): fluxo de import offline com imagens, bulk upload em lotes de 50, mapping `localId → serverId`, considerações de falha/retry.
- `src/modules/images/{routes,controller,service,schemas,queries}.js` (ebgeo_backend): permissões por rota, allowlist e magic-bytes, `toPublicImage`, headers de cache/attachment, preservação de id no bulk, ordem INSERT antes do writeFile.
- `src/middleware/permissions.js` (ebgeo_backend): hierarquia read/comment/write.
- `src/js/store/sync/{image-sync,api-client}.js`: seam best-effort, injeção do atlas conectado, contrato do `uploadImage`/`fetchImageBlob`.
- `src/js/draw_tools/image_tool/add_image_control.js` e `src/js/layers/layer_setup.js`: id da imagem gravado e lido em `properties.id`.
- `src/js/store/{settings,customIcons}.operations.js`: fallback local → backend com cache.
- `src/js/import_export/{save-local-atlas.service,local-atlas-to-server}.js`: ordem import → upload, chunking de 50, filtro de MIME, refs `custom:<id>`.
