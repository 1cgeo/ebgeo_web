# Upload e Download Seguro de Imagens

Regras e armadilhas do módulo de imagens: por que SVG não volta, por que várias validações do service são código morto, e por que `201` no lote não significa sucesso.

Contexto funcional em [[imagens-atlas]]; as demais bordas endurecidas em [[hardening-borda-api]].

## A decisão que não se reabre: sem SVG, sempre attachment

Imagem de usuário é conteúdo hostil. SVG (ou HTML renomeado para `.png`) servido `inline` executa script na origem da API. A resposta foi allowlist sem SVG, checagem de magic bytes e `Content-Disposition: attachment` incondicional (`backend/src/modules/images/images.service.js:12-14`, `backend/src/modules/images/images.controller.js:16-18`).

A alternativa rejeitada foi sanitizar SVG. Reintroduzir o tipo só porque o `<input type="file">` aceitaria é reabrir o vetor: o comentário no código marca que SVG só volta **com** sanitização explícita.

O aceite de conteúdo é triplo (`backend/src/modules/images/images.service.js:46` e `:175`): detectar algo, estar na allowlist **e** ser igual ao declarado. A terceira cláusula rejeita um PNG legítimo declarado como `image/webp`, e é proposital: o par (declarado, real) vai para o banco e para o `Content-Type` do download. Deixá-los divergir reabre a confusão de tipo.

## A allowlist vive em quatro arquivos que precisam concordar

`image/png`, `image/jpeg`, `image/webp`, repetido em `backend/src/modules/images/images.routes.js:38` (multer), `backend/src/modules/images/images.schemas.js:12` (Joi do lote), `backend/src/modules/images/images.service.js:14` e no `CHECK` da tabela (`backend/src/database/migrations/002_atlas.sql:313-315`).

Nenhum deles importa dos outros. Ampliar a lista na app sem tocar a migração não dá 400: estoura constraint e vira **500**. Reduzir na migração sem tocar a app dá o mesmo. Trate os quatro como uma edição atômica.

## Validações do service que são código morto pela rota HTTP

Cross-file, e não visível lendo `backend/src/modules/images/images.service.js` isoladamente:

- A checagem de tamanho (`backend/src/modules/images/images.service.js:38-41`, `File too large. Maximum size: 10MB`) é **inalcançável** via multipart: o `limits.fileSize` do multer corta antes (`backend/src/modules/images/images.routes.js:35`). O texto que o cliente vê vem do wrapper `uploadSingleImage` (`backend/src/modules/images/images.routes.js:51-62`), que traduz `MulterError` em 400 — sem ele, `LIMIT_FILE_SIZE` cairia no 500 genérico, porque `MulterError` não tem `statusCode`.
- A mensagem longa de tipo inválido (`backend/src/modules/images/images.service.js:35`) também é morta: o `fileFilter` responde antes, com o texto curto `Invalid file type`.

Ao testar mensagem de erro, teste contra a rota, não contra o service. Ao mudar limite ou allowlist, mude nos dois lugares mesmo sabendo que um deles não executa: eles são a guarda para chamadas diretas ao service.

**Armadilha de limpeza**: no caminho single o multer **já gravou** o arquivo em disco quando o service valida. Daí o `unlink(file.path).catch(() => {})` em `backend/src/modules/images/images.service.js:47` antes do throw. Qualquer validação nova pós-multer precisa repetir esse unlink, senão cada rejeito deixa lixo órfão no volume de imagens.

## [!CONTRADICAO] Um SVG no lote não gera falha parcial: derruba o lote inteiro

A documentação anterior mostrava `failed[]` com `"Invalid file type: image/svg+xml"`, sugerindo que MIME fora da allowlist vira falha por item. É falso: `validate({ body: bulkUploadSchema })` roda antes do controller (`backend/src/modules/images/images.routes.js:66`) e o Joi exige o MIME na allowlist (`backend/src/modules/images/images.schemas.js:12`). Um único item ruim aborta tudo, com **422 `VALIDATION_ERROR`**, não 400 (`middleware/error-handler.js:18,28-31`). O ramo `Invalid file type: <mime>` em `backend/src/modules/images/images.service.js:142` é inalcançável por HTTP.

Consequência: filtre o MIME **no cliente** antes de montar o lote. Um item ruim não custa um item, custa a requisição inteira. Contrato de erros em [[erros-api]] e [[sintese-contrato-erros-http]].

## O lote responde 201 mesmo com itens rejeitados

`bulkUploadImages` empurra motivos para `failed[]` sem abortar (`backend/src/modules/images/images.service.js:123-236`) e o controller devolve **201** (`backend/src/modules/images/images.controller.js:54`). **Código 2xx não é sucesso aqui.** O cliente precisa ler `failed[]`: um `localId` ausente de `mapping` é uma referência de feição apontando para blob inexistente no servidor.

Duas ciladas ao consumir:

- As strings de `failed[].error` são texto cru do service, **sem** `code`, e duas interpolam valores. Ramifique por prefixo, nunca por igualdade com a mensagem inteira.
- Lote e single têm shapes **assimétricos**: o lote devolve camelCase reduzido (`serverId`, `size`), o single devolve a linha inteira em snake_case (`mime_type`, `size_bytes`). Um parser único para os dois caminhos erra.

Relevante para [[atlas-import-offline]]: a primeira ocorrência de um `localId` é inserida **preservando o id** (`INSERT_IMAGE_WITH_ID`, `backend/src/modules/images/images.service.js:202`), para que a referência do blob na feição sobreviva ao import sem reescrita. Duplicata do mesmo `localId` no lote não pode reusar a PK, ganha id novo e o `mapping` colapsa last-wins. O `writeFile` vem **depois** do INSERT (`backend/src/modules/images/images.service.js:217`) justamente para que um INSERT que falhe não deixe arquivo órfão.

## Download: por que `<img src=URL>` nunca vai funcionar

A rota é autenticada e serve `attachment`. O token vive em memória no cliente, não em cookie que uma tag `<img>` enviaria. O caminho correto é `fetchImageBlob` (`src/js/store/sync/api-client.js:916`): `GET` com `Authorization: Bearer`, `res.blob()`, e o chamador cria um `blob:` URL. `imageUrl()` (`src/js/store/sync/api-client.js:895`) existe só para montar a URL, não para colar em `src`.

O cache é `private, max-age=31536000, immutable` (`backend/src/modules/images/images.controller.js:20`), então **não há cache-busting por query string**: imagem não muda depois de enviada e deletar é hard-delete (`backend/src/modules/images/images.service.js:97-111`). Ver [[sintese-cache-http-imutavel]].

`toPublicImage` (`backend/src/modules/images/images.service.js:22-27`) remove `storage_path`. Não é cosmético: é caminho absoluto de filesystem e vaza o layout do deploy para qualquer leitor do atlas, incluindo visualizador de [[link-publico]]. **Toda query nova que retorne linhas de `images` precisa passar por essa função** — `getImageById` devolve a linha crua de propósito, para uso interno, e não pode virar resposta.

## Custo escondido e notas de integração

- O parser JSON global é 10 MB; o lote ganha um parser dedicado de 50 MB escolhido **no despacho** (`backend/src/app.js:59-66`), porque um segundo `express.json` seria no-op depois que `req.body` existe. Sem essa ordem, o limite por imagem documentado seria inalcançável dentro de um lote. Máximo de 50 itens (`backend/src/modules/images/images.schemas.js:17`): o cliente precisa fatiar.
- `src/js/store/sync/image-sync.js` é best-effort: erro vira `null` e o chamador degrada para id local ou "sem imagem", nunca lança. Isso é o que preserva o modo offline (ver [[dominio-local-vs-remoto]] e [[modos-operacao]]).
- Imagens **não** viajam pelo canal de operações: REST puro, só a referência (`photoId` / `markerSymbol`) sincroniza com a feição. Ver [[sintese-rest-vs-sync]] e [[api-rest-atlas]].
- Permissão de atlas: `write` para POST/DELETE, `read` para GET. Ver [[permissoes-atlas]] e [[atlas-modelo-de-dados]].
