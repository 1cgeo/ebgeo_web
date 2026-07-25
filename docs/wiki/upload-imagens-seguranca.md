# Upload e Download Seguro de Imagens

Regras e armadilhas do módulo de imagens: por que SVG não volta, por que várias validações do service são código morto, e por que `201` no lote não significa sucesso.

Contexto funcional em [[imagens-atlas]]; as demais bordas endurecidas em [[hardening-borda-api]].

## A decisão que não se reabre: sem SVG, sempre attachment

Imagem de usuário é conteúdo hostil. SVG (ou HTML renomeado para `.png`) servido `inline` executa script na origem da API. A resposta foi allowlist sem SVG, checagem de magic bytes e `Content-Disposition: attachment` incondicional (`backend/src/modules/images/images.service.js:12-14`, `backend/src/modules/images/images.controller.js:32`).

A alternativa rejeitada foi sanitizar SVG. Reintroduzir o tipo só porque o `<input type="file">` aceitaria é reabrir o vetor: o comentário no código marca que SVG só volta **com** sanitização explícita.

O aceite de conteúdo é triplo (`backend/src/modules/images/images.service.js:46` e `:186`): detectar algo, estar na allowlist **e** ser igual ao declarado. A terceira cláusula rejeita um PNG legítimo declarado como `image/webp`, e é proposital: o par (declarado, real) vai para o banco e para o `Content-Type` do download. Deixá-los divergir reabre a confusão de tipo.

## A allowlist vive em quatro arquivos que precisam concordar

`image/png`, `image/jpeg`, `image/webp`, repetido em `backend/src/modules/images/images.routes.js:54` (multer), `backend/src/modules/images/images.schemas.js:24` (Joi do lote), `backend/src/modules/images/images.service.js:14` e no `CHECK` da tabela (`backend/src/database/migrations/002_atlas.sql:313-315`).

Nenhum deles importa dos outros. Ampliar a lista na app sem tocar a migração não dá 400: estoura constraint e vira **500**. Reduzir na migração sem tocar a app dá o mesmo. Trate os quatro como uma edição atômica.

## Validações do service que são código morto pela rota HTTP

Cross-file, e não visível lendo `backend/src/modules/images/images.service.js` isoladamente:

- A checagem de tamanho (`backend/src/modules/images/images.service.js:38-41`, `File too large. Maximum size: <N>MB`) é **inalcançável** via multipart: o `limits.fileSize` do multer corta antes (`backend/src/modules/images/images.routes.js:51`). O texto que o cliente vê vem do wrapper `uploadSingleImage` (`backend/src/modules/images/images.routes.js:75-86`), que traduz `MulterError` em 400; sem ele, `LIMIT_FILE_SIZE` cairia no 500 genérico, porque `MulterError` não tem `statusCode`. O `N` das duas mensagens é `MAX_IMAGE_SIZE_MB` (default 10), não uma constante: não case teste nem cliente com o literal.
- A mensagem longa de tipo inválido (`backend/src/modules/images/images.service.js:35`) também é morta: o `fileFilter` responde antes, com o texto curto `Invalid file type`.
- No lote, `Invalid base64 data` **nunca é emitido**. O `try/catch` em volta do decode (`bulkUploadImages`, `backend/src/modules/images/images.service.js`) supõe que `Buffer.from(str, 'base64')` lance com lixo, e ele não lança: base64 corrompido devolve um buffer de lixo, sem exceção, e o Joi já garante que `data` é string (`backend/src/modules/images/images.schemas.js:25`), então o único argumento que faria o decode lançar não chega ao service. Consequência para quem consome `failed[]`: base64 inválido sai como `Content does not match declared type` (a checagem de magic bytes, `:186`), nunca como erro de decode. Ramificar pela string documentada de decode é ramificar por um ramo morto.

Ao testar mensagem de erro, teste contra a rota, não contra o service. Ao mudar limite ou allowlist, mude nos dois lugares mesmo sabendo que um deles não executa: eles são a guarda para chamadas diretas ao service.

**Armadilha de limpeza**: no caminho single o multer **já gravou** o arquivo em disco quando o service valida. Daí o `unlink(file.path).catch(() => {})` em `backend/src/modules/images/images.service.js:47` antes do throw. Qualquer validação nova pós-multer precisa repetir esse unlink, senão cada rejeito deixa lixo órfão no volume de imagens.

## Um SVG no lote não gera falha parcial: derruba o lote inteiro

MIME fora da allowlist **não** vira falha por item: `validate({ body: bulkUploadSchema })` roda antes do controller (`backend/src/modules/images/images.routes.js:90`) e o Joi exige o MIME na allowlist (`backend/src/modules/images/images.schemas.js:24`). Um único item ruim aborta tudo, com **422 `VALIDATION_ERROR`**, não 400 (`backend/src/middleware/error-handler.js:18,28-31`). O ramo `Invalid file type: <mime>` em `backend/src/modules/images/images.service.js:155` é inalcançável por HTTP.

Consequência: filtre o MIME **no cliente** antes de montar o lote. Um item ruim não custa um item, custa a requisição inteira. Contrato de erros em [[erros-api]] e [[sintese-contrato-erros-http]].

## O lote responde 201 mesmo com itens rejeitados

`bulkUploadImages` empurra motivos para `failed[]` sem abortar (`backend/src/modules/images/images.service.js:133-243`) e o controller devolve **201** (`backend/src/modules/images/images.controller.js:71`). **Código 2xx não é sucesso aqui.** O cliente precisa ler `failed[]`: um `localId` ausente de `mapping` é uma referência de feição apontando para blob inexistente no servidor.

Duas ciladas ao consumir:

- As strings de `failed[].error` são texto cru do service, **sem** `code`, e duas interpolam valores. Ramifique por prefixo, nunca por igualdade com a mensagem inteira.
- Lote e single têm shapes **assimétricos**: o lote devolve camelCase reduzido (`serverId`, `size`), o single devolve a linha inteira em snake_case (`mime_type`, `size_bytes`). Um parser único para os dois caminhos erra.

Relevante para [[atlas-import-offline]]: a primeira ocorrência de um `localId` é inserida **preservando o id** (`INSERT_IMAGE_WITH_ID`, `backend/src/modules/images/images.service.js:212`), para que a referência do blob na feição sobreviva ao import sem reescrita. Duplicata do mesmo `localId` no lote não pode reusar a PK, ganha id novo e o `mapping` colapsa last-wins. O `writeFile` vem **depois** do INSERT (`backend/src/modules/images/images.service.js:227`) justamente para que um INSERT que falhe não deixe arquivo órfão.

Essa ordem fecha um órfão e abre o inverso, que ninguém procura: se o `writeFile` falhar, a linha **já está commitada**, o item vai para `failed[]` e a linha **permanece no banco**. Ela aparece em `listImages` e dá 404 no download, porque `getImageFile` faz `stat` no caminho antes de servir (`backend/src/modules/images/images.service.js:89-104`). Portanto `failed[]` **não** significa "nada foi escrito", e a heurística de reconciliação certa é o 404 no download, não a ausência em `mapping`, que não distingue os dois estados. Não há limpeza automática dessas linhas.

## Download: por que `<img src=URL>` nunca vai funcionar

A rota é autenticada e serve `attachment`. O token vive em memória no cliente, não em cookie que uma tag `<img>` enviaria. O caminho correto é `fetchImageBlob` (`frontend/src/js/store/sync/api-client.js:923`): `GET` com `Authorization: Bearer`, `res.blob()`, e o chamador cria um `blob:` URL. `imageUrl()` (`frontend/src/js/store/sync/api-client.js:902`) existe só para montar a URL, não para colar em `src`.

O cache é `private, max-age=31536000, immutable` (`backend/src/modules/images/images.controller.js:37`), então **não há cache-busting por query string**: imagem não muda depois de enviada e deletar é hard-delete (`backend/src/modules/images/images.service.js:107-121`). O `immutable` promete mais do que a rota entrega, e o furo está em [[imagens-atlas]]: o delete é físico, devolve a PK ao pool, e re-importar com o mesmo `localId` recria a MESMA URL com bytes novos. Ver [[sintese-cache-http-imutavel]].

`toPublicImage` (`backend/src/modules/images/images.service.js:22-27`) remove `storage_path`. Não é cosmético: é caminho absoluto de filesystem e vaza o layout do deploy para qualquer leitor do atlas, incluindo visualizador de [[link-publico]]. **Toda query nova que retorne linhas de `images` precisa passar por essa função**: `getImageById` devolve a linha crua de propósito, para uso interno, e não pode virar resposta.

## Custo escondido e notas de integração

- O parser JSON global é 10 MB **literal**; o do lote é `MAX_BULK_UPLOAD_MB` (default 50 MB) e o limite por imagem é `MAX_IMAGE_SIZE_MB` (default 10 MB), os dois lidos de env (`backend/src/config.js:75-86`). Só o primeiro é constante de código: um deploy que ajuste qualquer das duas variáveis torna qualquer número decorado aqui errado em silêncio. O parser do lote é escolhido **no despacho** (`backend/src/app.js:92-98`), porque um segundo `express.json` seria no-op depois que `req.body` existe, e ele exige um `req.user` já verificado, então token expirado cai no parser de 10 MB e um lote grande responde 413 em vez de 401. Máximo de 50 itens (`backend/src/modules/images/images.schemas.js:29`): o cliente precisa fatiar.
- **Não há rate limit nem quota em lugar nenhum deste módulo.** O router só tem `auth` + `requireAtlasPermission` (`backend/src/modules/images/images.routes.js:88-92`) e a config só conhece limite por requisição (`backend/src/config.js:75-86`); não existe teto por atlas, por organização nem por usuário, e o rate limit de borda cobre só `/auth/*` e o link público ([[hardening-borda-api]]). O único teto é 50 itens x `MAX_IMAGE_SIZE_MB` **por requisição**, em requisições ilimitadas, gravando direto no volume `IMAGES_DIR`, e a única limpeza é hard-delete imagem a imagem. É limite operacional conhecido, não bug: quem dimensiona disco precisa contar por membro com `write`, não por atlas.
- `frontend/src/js/store/sync/image-sync.js` é best-effort: erro vira `null` e o chamador degrada para id local ou "sem imagem", nunca lança. Isso é o que preserva o modo offline (ver [[dominio-local-vs-remoto]] e [[modos-operacao]]).
- Imagens **não** viajam pelo canal de operações: REST puro, só a referência (`photoId` / `markerSymbol`) sincroniza com a feição. Ver [[sintese-rest-vs-sync]] e [[api-rest-atlas]].
- Permissão de atlas: `write` para POST/DELETE, `read` para GET. Ver [[permissoes-atlas]] e [[atlas-modelo-de-dados]].

## Histórico

- **2026-07-25.** A seção do SVG no lote vinha marcada como contradição pendente desde 2026-07-18. Não era: a documentação de origem que ela desmentia (um `failed[]` com `"Invalid file type: image/svg+xml"`, sugerindo falha por item) foi absorvida e não existe mais, o que o [[wiki-schema]] classifica como supersessão temporal. O conteúdo estava certo e ficou; só o marcador saiu, que é o que devolve ao `CONTRADICAO` o significado de "pendente".
