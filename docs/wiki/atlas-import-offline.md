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

O servidor insere com o id que recebe. Só que o payload que chega já foi remapeado por `buildServerImportPayload` (`frontend/src/js/import_export/local-atlas-to-server.js:265`), e é aí que mora a confusão.

- **Mapas locais são name-keyed** e ganham UUID novo (`frontend/src/js/import_export/local-atlas-to-server.js:279-282`). Por isso `mapNameToId` do retorno é a **única** fonte para resolver referência por nome (slides referenciam mapa por nome ou por id; `frontend/src/js/import_export/local-atlas-to-server.js:341`).
- **O mapper de camada é por mapa, não global** (`frontend/src/js/import_export/local-atlas-to-server.js:288`). Motivo não óbvio: a camada padrão tem o id literal `'default'` em todo mapa, então um mapper global fundiria as camadas padrão de todos os mapas em uma só.

"IDs preservados" vale só do lado do servidor, e é fácil ler demais na frase: o cliente gera UUID **novo** para todo id não-UUID (`frontend/src/js/import_export/local-atlas-to-server.js:52-63`), incluindo o id de todos os mapas e a camada `'default'`. Só ids que já eram UUID (feições, briefings, slides) atravessam intactos.

## Import não é idempotente (ao contrário do sync)

`features.id` é `UUID PRIMARY KEY` **global**, não escopado por atlas (`backend/src/database/migrations/002_atlas.sql:165`), e feições que já eram UUID são preservadas. Salvar o **mesmo** store local no servidor duas vezes colide na PK e derruba a transação inteira. Não há `op_id` nem convergence guard aqui ([[idempotencia-e-convergence-guard]]): reenviar não é seguro e não existe retry cego deste endpoint.

`images.id` tem o mesmo problema (`backend/src/database/migrations/002_atlas.sql:310`), com falha pior porque é **parcial**: o INSERT cai no `catch`, a imagem entra em `failed` e o atlas é criado assim mesmo, com referências quebradas.

## O teto que impede a operação inteira: 10 MB de corpo

O import cai no parser JSON global, `express.json({ limit: '10mb' })` (`backend/src/app.js`); só `/images/bulk` ganha um parser próprio com limite maior. Como a rota é transação única, sem chunking e sem retry seguro, esse teto é o teto prático de "Salvar no servidor": acima dele o atlas recebe 413 `PAYLOAD_TOO_LARGE` e **não tem caminho nenhum** para o servidor. É a única perda desta página que não é parcial. A saída é reduzir o atlas local ou dividi-lo em atlas menores, não repetir o envio.

## Feições que somem em silêncio

`buildFeatures` (`frontend/src/js/import_export/local-atlas-to-server.js:93-128`) descarta sem erro a feição sem `geometry` ou com tipo fora da allowlist, apenas incrementando `stats.droppedFeatures`. O bucket `coordenadas` (leituras efêmeras de azimute e coordenada) não tem tipo no servidor e some **por design**.

A lista de 20 tipos existe em **três cópias manuais** que precisam mudar juntas: `frontend/src/js/import_export/local-atlas-to-server.js:22-28`, `VALID_FEATURE_TYPES` no Joi (`backend/src/modules/atlas/atlas.schemas.js:73-83`) e o CHECK `features.valid_feature_type` em `backend/src/database/migrations/002_atlas.sql`. Adicionar um tipo de feição sem tocar nas três faz a feição ser descartada no cliente, ou o import inteiro tomar 400 ([[erros-api]]).

## Dois produtores para o mesmo payload (2026-08-05)

`POST /atlas/import` tem agora **duas** origens no cliente, e a diferença entre elas é de onde vêm os blobs:

- **"Salvar no servidor"** (`import_export/save-local-atlas.service.js`) lê o store local: `buildExportDataObject` monta o `.ebgeo` em memória e `getImage(id)` traz cada blob do IndexedDB.
- **"Importar .ebgeo"** na página de projetos (`projects/import-ebgeo.service.js`) lê um ARQUIVO: descompacta o ZIP, usa o `data.json` direto e tira os blobs das entradas `images/<id>.<ext>`. **Não toca no store**, e é por isso que existe: a rota antiga para subir um `.ebgeo` era abri-lo no mapa e então salvar, o que destruía o workspace local só para o arquivo passar por ele.

O que os dois compartilham (`buildServerImportPayload` + `atlas-image-upload.js`) foi extraído justamente para não virar duas implementações. A armadilha específica do caminho por arquivo: **JSZip devolve Blob com `type` vazio**, e o uploader trata tipo vazio como PNG, e um JPEG subiria anunciando-se PNG e um SVG passaria pela allowlist que existe para recusá-lo. A extensão da entrada do ZIP é a única informação de tipo que existe ali, então o blob é recarimbado com ela antes de subir.

O nome do atlas vem do **nome do arquivo** (`atlasNameFromFilename`): o formato `.ebgeo` não tem campo de nome de atlas: ele nomeia MAPAS, e é anterior aos atlas de servidor.

## Imagens: importar ANTES de subir os blobs, e por quê

O truque está no backend: `bulkUploadImages` usa `INSERT_IMAGE_WITH_ID` na primeira ocorrência de cada `localId` (`backend/src/modules/images/images.service.js:191-210`), ou seja, o id local **vira** o id de servidor. Por isso o orquestrador (`frontend/src/js/import_export/save-local-atlas.service.js:91-119`) importa **antes** de subir os blobs e não precisa de fase de rewrite: as refs já importadas continuam válidas, e nenhuma operação de UPDATE é emitida para reescrever `properties.imageId`. O caminho de duas passadas com `meta.imageIdMap` existe em `frontend/src/js/import_export/local-atlas-to-server.js:270-275` e **não é usado** por este fluxo; quem o reativar precisa refazer o raciocínio inteiro. Ver [[imagens-atlas]] e [[upload-imagens-seguranca]].

Onde isso morde:

- **`localId` duplicado no mesmo lote**: a segunda ocorrência não pode reusar a PK, recebe id novo e o `mapping` colapsa em last-wins (`backend/src/modules/images/images.service.js:191-210`). A ref da feição correspondente fica pendurada.
- **SVG é perdido sem erro**: `ALLOWED_IMAGE_MIME` é png/jpeg/webp (`frontend/src/js/import_export/atlas-image-upload.js`), porque SVG é vetor de XSS armazenado (o CHECK do banco também o recusa). Ícone customizado em SVG entra como `skipped`.
- **Magic bytes têm que bater com o mime declarado** (`backend/src/modules/images/images.service.js:175`). Confiar cegamente em `blob.type` reprova a imagem.
- O blob só vai para disco **depois** do INSERT (`backend/src/modules/images/images.service.js:217`), deliberadamente, para que a colisão de PK global acima não deixe arquivo órfão.

## Depois do import: a ordem que não é negociável

O import não conecta nada. A troca do store acontece em `frontend/src/js/account/account.control.js:552-596`: `saveLocalAtlasToServer` (que **lê** o store local) tem que rodar **antes** de `clearAllDataStore`, `markStoreRemote` e `connect` ([[snapshot-e-pull-incremental]], [[sessao-boot-e-ciclo-de-vida]], [[fila-operacoes-outbound]], [[canal-collab-websocket]]). Inverter apaga os dados antes de subi-los, e como o import não é repetível não há como refazer.

O toast final soma `imageStats.skipped + failed`. É a **única** sinalização de perda parcial que o usuário recebe, e ela não cobre `droppedFeatures` nem os vínculos de grupo.

## Contrato congelado

- Os arrays aninhados de mapa (`features`, `layers`, `groups`, `groupFeatures`, `cesium3dData`, `streetview360Data`) são **camelCase dentro de um payload snake_case**. É inconsistente e é contrato: renomear quebra cliente antigo.
- O `SELECT` de retorno projeta oito colunas fixas (`backend/src/modules/atlas/atlas.service.js:757`), sem `owner_id` nem timestamps de update. `current_version` é o valor que o cliente guarda como `lastVersion` antes de abrir o socket ([[snapshot-e-pull-incremental]]).

Ver também [[atlas-modelo-de-dados]], [[atlas-settings]], [[api-rest-atlas]], [[catalogo-3d]] e [[streetview-360]].
