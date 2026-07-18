# Upload e Download Seguro de Imagens

Imagens são aceitas apenas em png/jpeg/webp com validação dupla de MIME declarado e magic bytes, limite de 10 MB por arquivo (50 MB no lote base64 com falha parcial), e servidas sempre como attachment com ETag, Range e cache immutable.

## Por que isso existe

Imagem enviada por usuário é conteúdo hostil por padrão. Dois vetores são fechados aqui:

1. **XSS armazenado**: um SVG (ou HTML renomeado para `.png`) servido `inline` executa script na origem da API. Solução: allowlist sem SVG, checagem de magic bytes e `Content-Disposition: attachment` sempre.
2. **Exaustão de recurso**: upload autenticado é escrita em disco e memória. Solução: limite por arquivo no multer (antes de tocar disco) e limite de corpo dedicado no lote base64.

O comentário em `images.service.js:12-13` deixa a decisão explícita: SVG só volta com sanitização explícita. Não reintroduza o tipo só porque o input do usuário aceitaria.

Contexto funcional do módulo em [[imagens-atlas]]; as demais bordas endurecidas (rate limit, JWT, helmet, health) em [[hardening-borda-api]].

## Allowlist: três camadas que precisam concordar

O tipo aceito é `image/png`, `image/jpeg`, `image/webp` e está declarado em **quatro** lugares independentes. Mudar um sem os outros gera falha silenciosa ou 500:

| Camada | Arquivo | Efeito |
|---|---|---|
| `fileFilter` do multer (single) | `src/modules/images/images.routes.js:38` | rejeita antes de gravar em disco |
| Joi (bulk base64) | `src/modules/images/images.schemas.js:12` | rejeita o request inteiro |
| Service (single + bulk) | `src/modules/images/images.service.js:14` | defesa em profundidade |
| `CHECK` no Postgres | `src/database/migrations/002_atlas.sql:313-315` | último anteparo, vira 500 se violado |

O `CHECK` da tabela `images` já nasce apertado na 002 (a migração 019 originalmente apertava o `CHECK` que aceitava `image/svg+xml`). Um MIME fora da lista que passe pelas camadas de app estoura constraint, não 400.

## Validação de conteúdo (magic bytes)

MIME declarado não é evidência de nada: no multipart vem do cliente, no bulk é um campo JSON. Por isso o conteúdo real é inspecionado com a lib `file-type`:

- single: `fileTypeFromFile(file.path)` em `images.service.js:45`
- bulk: `fileTypeFromBuffer(buffer)` em `images.service.js:174`

A condição de aceite é tripla (`images.service.js:46` e `:175`): precisa detectar algo, o detectado precisa estar na allowlist **e** precisa ser **igual ao declarado**. A terceira cláusula é a que importa: um PNG legítimo declarado como `image/webp` é rejeitado. Isso é proposital, o par (declarado, real) é o que vai para o banco e para o `Content-Type` do download; deixá-los divergir reabre o vetor de confusão de tipo.

**Armadilha de limpeza**: no caminho single o multer **já gravou** o arquivo em disco antes da inspeção. Por isso existe o `unlink(file.path).catch(() => {})` em `images.service.js:47` antes do throw. Qualquer nova validação pós-multer no service precisa repetir esse unlink, senão o rejeito vira lixo órfão no volume de imagens.

## Limites de tamanho e onde cada um dispara

- **Por arquivo**: `MAX_IMAGE_SIZE_MB`, default 10, faixa validada 1 a 1024 (`src/config.js:54`, `src/config.js:160`).
- **Corpo do lote**: `MAX_BULK_UPLOAD_MB`, default 50 (`src/config.js:58`). O parser JSON global é 10 MB; `src/app.js:59-66` seleciona um parser dedicado quando o path termina em `/images/bulk`. O comentário no código explica o porquê da ordem: um segundo `express.json` seria no-op depois que `req.body` já existe, então a escolha tem que acontecer **antes**, no despacho.
- **Batch**: no máximo 50 itens por lote (`images.schemas.js:17`). O cliente precisa fatiar, e o `api-client.js` documenta isso no JSDoc de `bulkUploadImages`.

No single, quem barra é o `limits.fileSize` do multer (`images.routes.js:35`). Um `MulterError` não tem `statusCode`, então cairia no 500 genérico; o wrapper `uploadSingleImage` (`images.routes.js:51-62`) traduz `LIMIT_FILE_SIZE` em `BadRequestError('Image too large (max 10MB)')`. Se você adicionar outros `limits` ao multer, o mesmo wrapper já cobre com `Upload error: <msg>`.

Consequência prática: a checagem de tamanho do service (`images.service.js:38-41`, mensagem `File too large. Maximum size: 10MB`) é **inalcançável pela rota multipart**, porque o multer corta antes. Ela permanece como guarda para chamadas diretas ao service. O mesmo vale para a mensagem longa de tipo inválido em `images.service.js:35`: no multipart o `fileFilter` responde antes, com o texto curto `Invalid file type`.

## Falha parcial no lote (e o limite dela)

`bulkUploadImages` (`images.service.js:123-236`) itera item a item e empurra o motivo para `failed[]` sem abortar os demais: base64 inválido, tamanho, conteúdo divergente, ou o `err.message` de uma exceção inesperada. O retorno é `{ uploaded, failed, mapping }`, e `mapping` (`localId` → `serverId`) é o que o cliente usa para reescrever referências de feição.

> **Nota histórica.** guia *11-seguranca-hardening* (absorvido) (§5.1) mostra um `failed[]` contendo `"Invalid file type: image/svg+xml"`, sugerindo que um MIME fora da allowlist gera falha parcial. No código real, `validate({ body: bulkUploadSchema })` roda antes do controller (`src/modules/images/images.routes.js:66`) e o Joi exige `mimeType` na allowlist (`src/modules/images/images.schemas.js:12`), então um único item com SVG **derruba o lote inteiro**, e com **422 `VALIDATION_ERROR`**, não 400 (`src/middleware/error-handler.js:18,28-31`). O ramo `Invalid file type: <mime>` em `src/modules/images/images.service.js:142` é inalcançável pela rota HTTP.

Implicação de integração: filtre o MIME **no cliente** antes de montar o lote. Um item ruim não custa um item, custa a requisição toda. Contrato de erros em [[erros-api]] e [[sintese-contrato-erros-http]].

Outra sutileza do lote, relevante para [[atlas-import-offline]]: a primeira ocorrência de um `localId` é inserida **preservando o id** (`INSERT_IMAGE_WITH_ID`, `images.service.js:202`), para que a referência do blob na feição continue válida sem reescrita pós-import. Um `localId` duplicado dentro do mesmo lote não pode reusar a PK e ganha id novo, com o `mapping` colapsando em last-wins (`images.service.js:191-213`). E o `writeFile` acontece **depois** do INSERT (`images.service.js:217`), para que um INSERT que falhe (colisão de PK global entre atlas) não deixe arquivo órfão em disco.

## Download: attachment, cache imutável, e o que o storage_path esconde

`getImage` (`src/modules/images/images.controller.js:10-31`) define:

```
Content-Type: <mime_type do banco>
Content-Disposition: attachment; filename="<filename>"
Cache-Control: private, max-age=31536000, immutable
```

e delega a `res.sendFile` com `acceptRanges`, `lastModified` e `etag` ligados, e `cacheControl: false` para não sobrescrever o header privado. É o `sendFile` que produz ETag, 304 condicional e 206/`Content-Range`. Ver [[sintese-cache-http-imutavel]].

**`attachment` significa que `<img src=URL>` não serve.** Além do download forçado, a rota é autenticada (`auth` + `requireAtlasPermission('read')`, `images.routes.js:67`) e o token vive em memória no cliente, não em cookie enviado por tag `<img>`. O caminho correto é o que `api-client.js` implementa: `fetchImageBlob` faz `GET` com `Authorization: Bearer` e devolve `res.blob()`, e o chamador cria um `blob:` URL. `imageUrl()` existe só para montar a URL, não para colar em `src`.

Como o cache é `immutable`, não há cache-busting por query string: imagem não muda depois de enviada, deletar é hard-delete (`images.service.js:97-111`, remove a linha e depois o arquivo, com o unlink em best-effort logado como warn).

`toPublicImage` (`images.service.js:22-27`) remove `storage_path` de tudo que cruza a fronteira da API. Isso não é cosmético: `storage_path` é caminho absoluto de filesystem e vaza o layout do deploy para qualquer leitor do atlas, incluindo visualizador de [[link-publico]]. Qualquer nova query que retorne linhas de `images` precisa passar por essa função.

## Notas para o cliente EBGeo

- O gateway de imagens no frontend é `src/js/store/sync/image-sync.js`, uma seam fina sobre `apiClient` com o `atlasId` injetado pelo sync engine em `setImageSyncAtlas`. Upload e fetch são **best-effort**: erro vira `null` e o chamador degrada para id local ou "sem imagem", nunca lança. Isso preserva o modo offline (ver [[dominio-local-vs-remoto]] e [[modos-operacao]]).
- Upload e download exigem permissão de atlas (`write` para POST/DELETE, `read` para GET), ver [[permissoes-atlas]] e [[atlas-modelo-de-dados]].
- Imagens **não** viajam pelo canal de operações: são REST puro, e só a **referência** (`photoId` / `markerSymbol`) sincroniza como parte da feição. Ver [[sintese-rest-vs-sync]] e [[api-rest-atlas]].
- No `<input type="file">` use `accept="image/png,image/jpeg,image/webp"`. Não elimina a validação do servidor, mas evita a viagem perdida.


## Shape da resposta do lote (`POST /images/bulk`)

## Shape da resposta do lote (`POST /images/bulk`)

O lote responde **200** mesmo com itens rejeitados, e o corpo tem três chaves. Note a assimetria com o upload single: aqui os campos são **camelCase e reduzidos** (`serverId`, `size`), enquanto o single devolve a linha inteira em snake_case via `toPublicImage` (`id`, `atlas_id`, `mime_type`, `size_bytes`). Quem escrever um parser único para os dois caminhos erra.

```json
{
  "data": {
    "uploaded": [
      {
        "localId": "9c1f…",
        "serverId": "9c1f…",
        "filename": "mapa.png",
        "size": 20480
      }
    ],
    "failed": [
      { "localId": "a2b0…", "error": "Content does not match declared type" }
    ],
    "mapping": { "9c1f…": "9c1f…" }
  }
}
```

No caminho feliz `serverId === localId` (preservação de PK, ver seção anterior); só duplicata de `localId` dentro do mesmo lote produz `serverId` novo.

### Strings exatas de `failed[].error`

São textos crus do service (`images.service.js:141-181`, `227-232`), não passam pelo `errorHandler` e **não** têm `code`. Ramifique por prefixo, nunca por igualdade com a mensagem inteira (duas delas interpolam valores).

| `error` | Causa | Alcançável por HTTP? |
|---|---|---|
| `Invalid file type: <mime>` | MIME fora da allowlist | **Não** — o Joi da rota derruba o lote inteiro com `422 VALIDATION_ERROR` antes (ver contradição acima) |
| `Invalid base64 data` | `data` não decodifica | Sim |
| `File too large: <N>MB (max: 10MB)` | `buffer.length > MAX_IMAGE_SIZE_MB` | Sim |
| `Content does not match declared type` | magic bytes divergem do `mimeType` declarado | Sim |
| `<err.message>` ou `Unknown error` | exceção inesperada no item (ex.: colisão de PK global ao re-salvar o mesmo atlas local) | Sim |

Consequência de integração: **`201`/`200` no lote não significa sucesso**. O cliente precisa ler `failed[]` e reconciliar; um item ausente de `mapping` é uma referência de feição que vai apontar para blob inexistente no servidor.

## Fontes

- guia *11-seguranca-hardening* (absorvido) (§5): allowlist sem SVG, validação em duas camadas, mensagens de erro, headers de download, limites `MAX_IMAGE_SIZE_MB`/`MAX_BULK_UPLOAD_MB`, notas de integração.
- `ebgeo_backend/src/modules/images/images.service.js`: allowlist, magic bytes, unlink no rejeito, falha parcial do lote, preservação de `localId`, `toPublicImage`.
- `ebgeo_backend/src/modules/images/images.routes.js`: multer (storage, `limits`, `fileFilter`), wrapper `uploadSingleImage`, guardas de permissão.
- `ebgeo_backend/src/modules/images/images.controller.js`: headers de attachment/cache e `res.sendFile`.
- `ebgeo_backend/src/modules/images/images.schemas.js`: Joi do bulk (allowlist, máx. 50 itens) — base da contradição registrada.
- `ebgeo_backend/src/app.js`, `src/config.js`, `src/middleware/error-handler.js`, `src/database/migrations/002_atlas.sql`: parser dedicado do bulk, defaults/faixas das env vars, mapeamento Joi→422, `CHECK` de `mime_type`.
- `ebgeo_web/src/js/store/sync/api-client.js`, `src/js/store/sync/image-sync.js`: consumo no cliente (multipart, bulk, fetch como blob).
