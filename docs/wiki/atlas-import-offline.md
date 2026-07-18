# Import de atlas offline (POST /atlas/import)

Rota REST de bulk que sobe um store local inteiro como um novo atlas em uma transação única, com IDs remapeados no cliente e preservados no servidor, e que **não é idempotente**.

## Por que existe uma rota REST aqui

O app roda local antes de qualquer login ([[modos-operacao]], [[dominio-local-vs-remoto]]). Subir esse estado como sequência de operações de sync foi rejeitado por dois motivos: seriam milhares de envelopes ([[envelope-operacao]]) e não haveria atomicidade (um atlas meio criado é pior que nenhum). Daí a exceção ao [[sintese-rest-vs-sync]]: esta é a **única** rota REST que escreve entidades de mapa/feição/camada em massa. Depois dela toda mutação volta a viajar como operação ([[modelo-conflito-lww]]).

A rota tem só `auth` + `validate` (`backend/src/modules/atlas/atlas.routes.js:22`), sem `requireAtlasPermission`, e não poderia ter: o atlas ainda não existe. Dono é o chamador ([[permissoes-atlas]], [[compartilhamento-atlas]], [[autenticacao-jwt]]).

`temporal_config` e `grid_style` estão no `mapSchema` (`backend/src/modules/atlas/atlas.schemas.js:151-152`) por decisão explícita: o payload de import cobre o **mesmo** conjunto do [[formato-ebgeo-roundtrip]], não um subconjunto, para o [[modulo-temporal]] sobreviver ao round-trip local para servidor.

## O Joi valida formato, não referência

Este é o ponto em que o schema convida a errar. `layer_id`, `map_id`, `parent_id`, `group_id` e `feature_id` são validados apenas como **formato UUID**. O Joi nunca confere se o alvo existe no próprio payload. A integridade referencial vem inteira de duas outras coisas: a ordem de inserção dentro de `tx()` (layers antes de features, groups antes de group_features; `backend/src/modules/atlas/atlas.service.js:551-767`) e as FKs do PostgreSQL.

Consequência: uma referência inválida **não** perde uma linha, ela derruba a transação inteira e o atlas não nasce. A única inserção tolerante é `group_features`, com `ON CONFLICT DO NOTHING` (`backend/src/modules/atlas/atlas.service.js:671`).

E é justamente aí que a perda fica invisível: o `summary` da resposta tem oito contadores e `groupFeatures` **não** é um deles. Vínculos feição para grupo somem sem aparecer em contador nenhum. Conferir perda pelo `summary` só funciona para as oito categorias contadas.

## IDs: preservados pelo servidor, reescritos pelo cliente

O servidor insere com o id que recebe. Só que o payload que chega já foi remapeado por `buildServerImportPayload` (`src/js/import_export/local-atlas-to-server.js:265`), e é aí que mora a confusão.

- **Mapas locais são name-keyed** e ganham UUID novo (`src/js/import_export/local-atlas-to-server.js:279-282`). Por isso `mapNameToId` do retorno é a **única** fonte para resolver referência por nome (slides referenciam mapa por nome ou por id; `src/js/import_export/local-atlas-to-server.js:341`).
- **O mapper de camada é por mapa, não global** (`src/js/import_export/local-atlas-to-server.js:288`). Motivo não óbvio: a camada padrão tem o id literal `'default'` em todo mapa, então um mapper global fundiria as camadas padrão de todos os mapas em uma só.

> **Nota histórica.** guia *08-offline-import* (absorvido) §3.3 diz "IDs preservados: UUIDs gerados no IndexedDB são mantidos no servidor". O código em `src/js/import_export/local-atlas-to-server.js:52-63,279-282` gera UUIDs **novos** para todo id não-UUID, incluindo o id de todos os mapas (locais são name-keyed) e a camada `'default'`. Só ids que já eram UUID (feições, briefings, slides) sobrevivem intactos.

## Import não é idempotente (ao contrário do sync)

`features.id` é `UUID PRIMARY KEY` **global**, não escopado por atlas (`backend/src/database/migrations/002_atlas.sql:165`), e feições que já eram UUID são preservadas. Salvar o **mesmo** store local no servidor duas vezes colide na PK e derruba a transação inteira. Não há `op_id` nem convergence guard aqui ([[idempotencia-e-convergence-guard]]): reenviar não é seguro e não existe retry cego deste endpoint.

`images.id` tem o mesmo problema (`backend/src/database/migrations/002_atlas.sql:310`), com falha pior porque é **parcial**: o INSERT cai no `catch`, a imagem entra em `failed` e o atlas é criado assim mesmo, com referências quebradas.

## Feições que somem em silêncio

`buildFeatures` (`src/js/import_export/local-atlas-to-server.js:93-128`) descarta sem erro a feição sem `geometry` ou com tipo fora da allowlist, apenas incrementando `stats.droppedFeatures`. O bucket `coordenadas` (leituras efêmeras de azimute e coordenada) não tem tipo no servidor e some **por design**.

A lista de 20 tipos existe em **três cópias manuais** que precisam mudar juntas: `src/js/import_export/local-atlas-to-server.js:22-28`, `VALID_FEATURE_TYPES` no Joi (`backend/src/modules/atlas/atlas.schemas.js:73-83`) e o CHECK `features.valid_feature_type` em `backend/src/database/migrations/002_atlas.sql`. Adicionar um tipo de feição sem tocar nas três faz a feição ser descartada no cliente, ou o import inteiro tomar 400 ([[erros-api]]).

## Imagens: a ordem real inverte o que o guia descreve

O truque está no backend: `bulkUploadImages` usa `INSERT_IMAGE_WITH_ID` na primeira ocorrência de cada `localId` (`backend/src/modules/images/images.service.js:191-210`), ou seja, o id local **vira** o id de servidor. Por isso o orquestrador (`src/js/import_export/save-local-atlas.service.js:91-119`) pode importar **antes** de subir os blobs e não precisa de fase de rewrite. Ver [[imagens-atlas]] e [[upload-imagens-seguranca]].

> **Nota histórica.** guia *08-offline-import* (absorvido) §4.4/§4.5 descreve importar, subir imagens, receber um `mapping` e então **enviar operações de UPDATE** para reescrever `properties.imageId`. O código em `src/js/import_export/save-local-atlas.service.js:100-105` não emite nenhuma operação de update: as imagens são inseridas com o próprio `localId` como PK, então as refs já importadas continuam válidas. O caminho de duas passadas com `meta.imageIdMap` existe em `src/js/import_export/local-atlas-to-server.js:270-275` mas **não é usado** por este fluxo.

Onde isso morde:

- **`localId` duplicado no mesmo lote**: a segunda ocorrência não pode reusar a PK, recebe id novo e o `mapping` colapsa em last-wins (`backend/src/modules/images/images.service.js:191-210`). A ref da feição correspondente fica pendurada.
- **SVG é perdido sem erro**: `ALLOWED_MIME` é png/jpeg/webp (`src/js/import_export/save-local-atlas.service.js:19,51-54`), porque SVG é vetor de XSS armazenado (o CHECK do banco também o recusa). Ícone customizado em SVG entra como `skipped`.
- **Magic bytes têm que bater com o mime declarado** (`backend/src/modules/images/images.service.js:175`). Confiar cegamente em `blob.type` reprova a imagem.
- O blob só vai para disco **depois** do INSERT (`backend/src/modules/images/images.service.js:217`), deliberadamente, para que a colisão de PK global acima não deixe arquivo órfão.

## Depois do import: a ordem que não é negociável

O import não conecta nada. A troca do store acontece em `src/js/account/account.control.js:552-596`: `saveLocalAtlasToServer` (que **lê** o store local) tem que rodar **antes** de `clearAllDataStore`, `markStoreRemote` e `connect` ([[snapshot-e-pull-incremental]], [[sessao-boot-e-ciclo-de-vida]], [[fila-operacoes-outbound]], [[canal-collab-websocket]]). Inverter apaga os dados antes de subi-los, e como o import não é repetível não há como refazer.

O toast final soma `imageStats.skipped + failed`. É a **única** sinalização de perda parcial que o usuário recebe, e ela não cobre `droppedFeatures` nem os vínculos de grupo.

## Contrato congelado

- Os arrays aninhados de mapa (`features`, `layers`, `groups`, `groupFeatures`, `cesium3dData`, `streetview360Data`) são **camelCase dentro de um payload snake_case**. É inconsistente e é contrato: renomear quebra cliente antigo.
- O `SELECT` de retorno projeta oito colunas fixas (`backend/src/modules/atlas/atlas.service.js:757`), sem `owner_id` nem timestamps de update. `current_version` é o valor que o cliente guarda como `lastVersion` antes de abrir o socket ([[snapshot-e-pull-incremental]]).

Ver também [[atlas-modelo-de-dados]], [[atlas-settings]], [[api-rest-atlas]], [[catalogo-3d]] e [[streetview-360]].

## Fontes

- guia *08-offline-import* (absorvido): cenário, contrato, bulk upload de imagens e transição offline para online (duas divergências marcadas acima).
- `backend/src/modules/atlas/atlas.service.js:551-767`: transação única, ordem de inserção, `map_order`, `summary`.
- `backend/src/modules/atlas/atlas.schemas.js:73-191`: `importSchema`, os 20 tipos, validação só de formato UUID nas referências.
- `backend/src/modules/images/images.service.js:118-236`: preservação do `localId` como PK, duplicata no lote, magic bytes, escrita pós-INSERT.
- `backend/src/database/migrations/002_atlas.sql:165,310`: PKs globais de `features` e `images`, base da não idempotência.
- `src/js/import_export/local-atlas-to-server.js`: remapeamento de UUID, mapper de camada por mapa, descarte de feições, `mapNameToId`.
- `src/js/import_export/save-local-atlas.service.js:91-119`: ordem import para upload, chunk de 50, filtro de MIME.
- `src/js/account/account.control.js:552-596`: sequência de troca do store local pelo atlas remoto.
