# Import de atlas offline (POST /atlas/import)

Endpoint que sobe um atlas inteiro criado no IndexedDB para a conta do usuário em uma transação atômica, preservando os UUIDs locais e respeitando a ordem de inserção que garante a integridade referencial.

## Por que este endpoint existe

O app roda local antes de qualquer login (ver [[modos-operacao]] e [[dominio-local-vs-remoto]]). O store local é um workspace único, name-keyed, sem noção de atlas nomeado ([[store-origin-local-remoto]]). Quando o usuário decide "subir para o servidor", não dá para reproduzir esse estado como uma sequência de operações de sync: seriam milhares de envelopes ([[envelope-operacao]]) e nenhuma garantia de atomicidade. Daí um endpoint REST de bulk, fora do caminho de sync ([[sintese-rest-vs-sync]]).

O import é a **única** rota REST que escreve entidades de mapa/feição/camada em massa. Depois dele, toda mutação volta a viajar como operação ([[sync-lww-operacoes]]).

## Contrato

`POST /api/v1/atlas/import`, `Authorization: Bearer <accessToken>` ([[autenticacao-jwt]]).

Registrada em `atlas.routes.js:22` com **apenas** `auth` + `validate(importSchema)`. Não há `requireAtlasPermission`, e nem poderia haver: o atlas ainda não existe. O dono é `req.user.id` (`atlas.controller.js:64-67`), que também responde **201** com `{ data: { ...atlas, summary } }`. Sobre papéis do atlas criado, ver [[permissoes-atlas]] e [[compartilhamento-atlas]].

Corpo: `{ atlas: { name, description, settings }, maps: [...], briefings: [...] }` (`atlas.schemas.js:183-191`).

O `mapSchema` (`atlas.schemas.js:137-161`) aceita bem mais do que "centro e zoom": `notes_title`, `notes_description`, `analysis_layers`, `catalog_layers`, `locked`, `grid_style` e `temporal_config`, além dos arrays aninhados `features`, `layers`, `groups`, `groupFeatures`, `cesium3dData`, `streetview360Data`. O `temporal_config` foi adicionado explicitamente para que o [[modulo-temporal]] sobreviva ao round-trip local → servidor (comentário em `atlas.schemas.js:151-152`). Ou seja: o payload de import cobre o mesmo conjunto que o [[formato-ebgeo-roundtrip]], e não um subconjunto.

## Ordem de inserção e integridade referencial

`importAtlas` (`atlas.service.js:551-767`) roda inteiro dentro de `tx()`. A ordem é:

1. `INSERT INTO atlas` (linha 556)
2. por mapa: `maps` → `layers` (2.1, linha 613) → `groups` (2.2, linha 632) → `features` (2.3, linha 650) → `group_features` (2.4, linha 667) → `cesium3d_data` (2.5) → `streetview360_data` (2.6)
3. `UPDATE atlas SET map_order` com os ids dos mapas na ordem recebida (linha 711)
4. `briefings` → `slides` (linha 715+)

**Armadilha:** o Joi só valida *formato* UUID de `layer_id`, `map_id`, `parent_id`, `group_id`, `feature_id` (permitindo `null`). Ele **não** confere se esses ids existem no próprio payload. A integridade vem da ordem acima mais as FKs do PostgreSQL. Uma referência inválida vira erro de FK e derruba a transação inteira, não uma linha. `group_features` usa `ON CONFLICT DO NOTHING` (linha 671) e é a única inserção tolerante.

`summary` conta cada categoria inserida e volta na resposta: use isso para conferir perdas em vez de confiar no que você acha que mandou.

## IDs: preservados pelo servidor, remapeados pelo cliente

O servidor insere com o id que recebe (`INSERT INTO maps (id, ...)`, `INSERT INTO features (id, ...)`). Nesse sentido "IDs preservados" é verdade. Mas o payload que chega já passou por um remapeamento no cliente.

`buildServerImportPayload` (`import_export/local-atlas-to-server.js:265`) é puro e síncrono, e faz dois trabalhos que ninguém deve refazer à mão:

- **UUID-remapping.** `makeIdMapper` (linha 52-63) mantém ids que já são UUID e atribui um UUID novo, memoizado, para qualquer id que não seja. Isso é obrigatório porque **mapas locais são keyed por nome** (`mapNameToId`, linhas 279-282, gera um UUID por nome) e a camada padrão de cada mapa tem o id literal `'default'`. Como `'default'` colide entre mapas, o mapper de camada é **por mapa** (linha 288), não global.
- **Achatamento** das coleções keyed por objeto (`cesium3d.cameraPositions`, `streetview360.orientations`) nos arrays tipados `cesium3dData` / `streetview360Data` (linhas 189-220), com `data_type` em `camera_position | marker | measurement | viewshed` e `orientation | marker`. Ver [[catalogo-3d]] e [[streetview-360]].

> [!CONTRADICAO 2026-07-18] `docs/guias/08-offline-import.md` §3.3 diz "IDs preservados: UUIDs gerados no IndexedDB são mantidos no servidor". O código em `src/js/import_export/local-atlas-to-server.js:52-63,279-282` gera UUIDs **novos** para todo id não-UUID, incluindo o id de todos os mapas (locais são name-keyed) e a camada `'default'`. Só ids que já eram UUID (feições, briefings, slides) sobrevivem intactos.

Consequência prática: **`mapNameToId` do retorno é a única fonte para resolver referências por nome**. Slides referenciam mapa por nome ou por id, e a linha 341 faz `mapNameToId[s.mapId] || (isValidUUID(s.mapId) ? s.mapId : null)`.

## Feições descartadas silenciosamente

`buildFeatures` (linha 93-128) deriva o `feature_type` de `properties.source`, caindo em `BUCKET_TO_SOURCE` como fallback. Feição sem `geometry` ou com tipo fora de `VALID_FEATURE_TYPES` é **descartada** e apenas incrementa `stats.droppedFeatures`. O bucket `coordenadas` (leituras efêmeras de azimute/coordenada) não tem tipo no servidor e por isso está deliberadamente ausente do mapa, ou seja, some no import por design.

A lista de 20 tipos do cliente (linhas 22-28) é um espelho manual de `VALID_FEATURE_TYPES` no backend (`atlas.schemas.js:73-83`), que por sua vez espelha o CHECK `features.valid_feature_type` em `002_atlas.sql`. **São três cópias que precisam mudar juntas.** Adicionar um tipo de feição sem tocar nas três faz a feição ser descartada no cliente ou o import inteiro tomar 400 ([[erros-api]]).

## Imagens: a ordem real inverte o que o guia descreve

Imagens são binários e não vão no payload. O orquestrador `saveLocalAtlasToServer` (`import_export/save-local-atlas.service.js:91-119`) faz:

1. `exportService.buildExportDataObject(mapsToExport)`
2. `buildServerImportPayload(exportData, { name, description })` **sem** `imageIdMap`
3. `apiClient.importAtlas(payload)` (as referências de imagem ainda são os ids locais)
4. `uploadImagesInChunks` em lotes de 50, **preservando os ids locais**

O truque está no backend: `bulkUploadImages` (`images.service.js:187-213`) usa `INSERT_IMAGE_WITH_ID` na primeira ocorrência de cada `localId`, ou seja, o id local **vira** o id de servidor. Por isso não existe fase de rewrite pós-import. Detalhes do endpoint em [[imagens-atlas]] e [[upload-imagens-seguranca]].

> [!CONTRADICAO 2026-07-18] `docs/guias/08-offline-import.md` §4.4/§4.5 descreve importar, subir imagens, receber um `mapping` e então **enviar operações de UPDATE** para reescrever `properties.imageId`. O código em `src/js/import_export/save-local-atlas.service.js:100-105` não emite nenhuma operação de update: as imagens são inseridas com o próprio `localId` como PK (`ebgeo_backend/src/modules/images/images.service.js:190-213`), então as refs já importadas continuam válidas. O caminho de duas passadas com `meta.imageIdMap` existe em `local-atlas-to-server.js:270-275` mas **não é usado** por este fluxo.

Pontos que mordem no upload de imagens:

- **`localId` duplicado no mesmo lote**: a segunda ocorrência não pode reusar a PK, recebe um id novo e o `mapping` colapsa em last-wins (`images.service.js:187-192`). A ref da feição correspondente fica pendurada.
- **PK global de `images`** (`002_atlas.sql:310`). Salvar o *mesmo* atlas local no servidor **duas vezes** colide na segunda: o INSERT falha, cai no `catch` e a imagem entra em `failed`. O atlas é criado assim mesmo, com refs quebradas.
- O mesmo raciocínio vale, pior, para **feições**: `features.id` também é `UUID PRIMARY KEY` global (`002_atlas.sql:164-165`) e feições que já eram UUID são preservadas. Um segundo import do mesmo store local colide na PK e **derruba a transação inteira**. Import não é idempotente, ao contrário do sync ([[idempotencia-e-convergence-guard]]).
- **SVG não é aceito** (vetor de XSS armazenado). `collectImageUploads` filtra por `ALLOWED_MIME` = png/jpeg/webp (`save-local-atlas.service.js:19,51-54`) e reporta como `skipped`, então ícones customizados em SVG são perdidos sem erro.
- O backend ainda valida **magic bytes** e exige `detected.mime === image.mimeType` (`images.service.js:174-181`). Declarar mime errado a partir de `blob.type` reprova a imagem.
- O blob só é escrito em disco **depois** do INSERT, para não deixar arquivo órfão quando a PK colide (`images.service.js:215-217`).

## Depois do import: virar o store

O import não conecta nada. Quem faz a troca é `account.control.js:_handleSaveLocalToServer` (linhas 552-596), nesta ordem, que não é negociável:

1. `syncEngine.disconnect()` defensivo se houver socket aberto
2. `saveLocalAtlasToServer` (lê o store local, **tem que vir antes do wipe**)
3. `_applyAtlasSharing(result.atlasId, sharing)`
4. `clearAllDataStore()` → `markStoreRemote(result.atlasId)` → `syncEngine.connect(atlasId, { initialPull: true })` ([[snapshot-e-pull-incremental]], [[sessao-boot-e-ciclo-de-vida]])
5. `activateAtlasInitialMap()` + `switchMap(false)` + `startAutoFlush()` ([[fila-operacoes-outbound]], [[websocket-collab]])

Inverter 2 e 4 apaga os dados antes de subi-los. O toast final usa `stats` e soma `imageStats.skipped + failed` para avisar "N imagem(ns) não enviada(s)", que é a única sinalização de perda parcial que o usuário recebe.

Sobre o atlas resultante e seu ciclo de vida, ver [[atlas]], [[atlas-modelo-de-dados]], [[api-rest-atlas]] e [[atlas-settings]].

## Fontes

- `docs/guias/08-offline-import.md`: cenário, contrato do endpoint, tabela de características do import, fluxo de bulk upload de imagens e transição offline → online (com duas divergências marcadas acima).
- `ebgeo_backend/src/modules/atlas/atlas.routes.js:22`, `atlas.controller.js:64-67`: registro da rota (só `auth`), owner = usuário autenticado, 201.
- `ebgeo_backend/src/modules/atlas/atlas.schemas.js:73-191`: `importSchema`, os 20 `VALID_FEATURE_TYPES`, campos aceitos por mapa (incluindo `grid_style`/`temporal_config`), validação apenas de formato UUID nas referências.
- `ebgeo_backend/src/modules/atlas/atlas.service.js:551-767`: transação única, ordem de inserção, `map_order`, `summary`.
- `ebgeo_backend/src/modules/images/images.service.js:118-236` e `images.schemas.js:9-17`, `images.routes.js:66`: bulk upload, preservação do `localId` como PK, limite de 50, magic bytes, tratamento de duplicata e falha parcial.
- `ebgeo_backend/src/database/migrations/002_atlas.sql:164,309`: PKs globais de `features` e `images` (base do problema de re-import).
- `ebgeo_web/src/js/import_export/local-atlas-to-server.js`: remapeamento de UUID, mapper de camada por mapa, achatamento 3D/360, descarte de feições, `mapNameToId`.
- `ebgeo_web/src/js/import_export/save-local-atlas.service.js:91-119`: ordem real import → upload de blobs, chunk de 50, filtro de MIME, `imageStats`.
- `ebgeo_web/src/js/account/account.control.js:552-596`: sequência de troca do store local pelo atlas remoto após o import.
