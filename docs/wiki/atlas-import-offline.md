# Import de atlas offline (POST /atlas/import)

Rota REST de bulk que sobe um store local inteiro como um novo atlas em uma transação única, com IDs remapeados no cliente e preservados pelo servidor **quando estão livres**, e que **não é idempotente**: reenviar funciona, e o que nasce é outro atlas.

## Por que existe uma rota REST aqui

O app roda local antes de qualquer login ([[modos-operacao]], [[dominio-local-vs-remoto]]). Subir esse estado como sequência de operações de sync foi rejeitado por dois motivos: seriam milhares de envelopes ([[envelope-operacao]]) e não haveria atomicidade (um atlas meio criado é pior que nenhum). Daí a exceção ao [[sintese-rest-vs-sync]]: esta é a **única** rota REST que escreve entidades de mapa/feição/camada em massa. Depois dela toda mutação volta a viajar como operação ([[modelo-conflito-lww]]).

A rota tem só `auth` + `validate` (`backend/src/modules/atlas/atlas.routes.js`), sem `requireAtlasPermission`, e não poderia ter: o atlas ainda não existe. Dono é o chamador ([[permissoes-atlas]], [[compartilhamento-atlas]], [[autenticacao-jwt]]).

`temporal_config` e `grid_style` estão no `mapSchema` (`backend/src/modules/atlas/atlas.schemas.js`) por decisão explícita: o payload de import cobre o **mesmo** conjunto do [[formato-ebgeo-roundtrip]], não um subconjunto, para o [[modulo-temporal]] sobreviver ao round-trip local para servidor.

## O Joi valida formato, não referência

Este é o ponto em que o schema convida a errar. `layer_id`, `map_id`, `parent_id`, `group_id` e `feature_id` são validados apenas como **formato UUID**. O Joi nunca confere se o alvo existe no próprio payload. A integridade referencial vem inteira de duas outras coisas: a ordem de inserção dentro de `tx()` (layers antes de features, groups antes de group_features; `backend/src/modules/atlas/atlas.service.js`) e as FKs do PostgreSQL.

Consequência: uma referência inválida **não** perde uma linha, ela derruba a transação inteira e o atlas não nasce. A única inserção tolerante é `group_features`, com `ON CONFLICT DO NOTHING` (`backend/src/modules/atlas/atlas.service.js`).

E é justamente aí que a perda fica invisível: o `summary` da resposta tem oito contadores e `groupFeatures` **não** é um deles. Vínculos feição para grupo somem sem aparecer em contador nenhum. Conferir perda pelo `summary` só funciona para as oito categorias contadas.

## IDs: preservados pelo servidor quando livres, reescritos pelo cliente

O servidor insere com o id que recebe **se ele estiver livre**, e cunha um id novo se estiver ocupado (`cunharIdsOcupados`, `backend/src/modules/atlas/atlas.service.js`). Só que o payload que chega já foi remapeado por `buildServerImportPayload` (`frontend/src/js/import_export/local-atlas-to-server.js`), e é aí que mora a confusão.

- **Mapas locais são name-keyed** e ganham UUID novo (`frontend/src/js/import_export/local-atlas-to-server.js`). Por isso `mapNameToId` do retorno é a **única** fonte para resolver referência por nome (slides referenciam mapa por nome ou por id; `frontend/src/js/import_export/local-atlas-to-server.js`).
- **O mapper de camada é por mapa, não global** (`frontend/src/js/import_export/local-atlas-to-server.js`). Motivo não óbvio: a camada padrão tem o id literal `'default'` em todo mapa, então um mapper global fundiria as camadas padrão de todos os mapas em uma só.

"IDs preservados" vale só do lado do servidor, e é fácil ler demais na frase: o cliente gera UUID **novo** para todo id não-UUID (`frontend/src/js/import_export/local-atlas-to-server.js`), incluindo o id de todos os mapas e a camada `'default'`. Só ids que já eram UUID (feições, briefings, slides) atravessam intactos, e ainda assim apenas se estiverem livres no servidor: a seção seguinte é o que acontece quando não estão.

## Reenviar cria OUTRO atlas, e a colisão de PK é resolvida no servidor (2026-08-25)

`features.id`, `layers.id`, `groups.id`, `briefings.id`, `slides.id`, `maps.id` e as duas tabelas de 3D/360 são `UUID PRIMARY KEY` **global**, não escopadas por atlas (`backend/src/database/migrations/003_atlas.sql`), e o que já era UUID atravessa o cliente intacto. Salvar o **mesmo** store local no servidor duas vezes disputava, portanto, as mesmas chaves.

Até 2026-08-25 isso derrubava a transação inteira: 23505, e o usuário lia "Resource already exists". Não era defeito da lixeira, que foi onde ele apareceu: **medido** que o id vindo de atlas VIVO recusava igual, e que dois usuários enviando cópias do mesmo `.ebgeo` colidiam entre si. A regra agora é **preserva quando o id está livre, cunha um id novo quando está ocupado**, e ela mora no servidor porque só ele sabe o que está livre. `deleted_at` não entra no filtro de propósito: linha na lixeira continua ocupando a chave, e a cláusula 7.4 da `CONSTITUICAO.md` exige a lixeira restaurável com conteúdo.

Isso **não** torna a rota idempotente: não há `op_id` nem convergence guard aqui ([[idempotencia-e-convergence-guard]]). Reenviar agora dá certo, e o que ele produz é um atlas NOVO, com entidades novas, ao lado do anterior. Retry cego duplica o acervo em vez de falhar, que é a troca aceita.

A recusa que sobra é outra e é do ARQUIVO: id repetido dentro do próprio payload é 400 com frase em português ("O arquivo repete o id de ..."), porque duas linhas disputando a mesma identidade não têm desfecho certo. Preso por `backend/tests/integration/import-id-ja-usado.repro.test.js` e por `atlas-gaps.test.js` (que também cobra que o import recusado não commita nada).

`images.id` é global pelo mesmo motivo (`backend/src/database/migrations/003_atlas.sql`), e ali o conserto do servidor não alcança: o blob sobe DEPOIS do import, então recunhá-lo lá deixaria pendurada a referência já gravada na feição. Ver a seção de imagens abaixo.

## O teto que impede a operação inteira: 10 MB de corpo

O import cai no parser JSON global, `express.json({ limit: '10mb' })` (`backend/src/app.js`); só `/images/bulk` ganha um parser próprio com limite maior. Como a rota é transação única, sem chunking e sem retry que reaproveite o que já subiu, esse teto é o teto prático de "Enviar ao servidor": acima dele o atlas recebe 413 `PAYLOAD_TOO_LARGE` e **não tem caminho nenhum** para o servidor. É a única perda desta página que não é parcial. A saída é reduzir o atlas local ou dividi-lo em atlas menores, não repetir o envio.

## Feições que somem em silêncio

`buildFeatures` (`frontend/src/js/import_export/local-atlas-to-server.js`) descarta a feição sem `geometry` ou com tipo fora da allowlist, apenas incrementando `stats.droppedFeatures`. O bucket `coordenadas` (leituras efêmeras de azimute e coordenada) não tem tipo no servidor e some **por design**.

**O silêncio do título acabou em 2026-09-19, e só nas três portas.** O descarte continua acontecendo dentro de `buildFeatures`, mas `stats.droppedFeatures` diferente de zero passou a RECUSAR o envio inteiro, antes de qualquer escrita de rede, nas três portas que criam atlas de servidor a partir de um acervo local. O contador deixou de ser um número sem consumidor de interface e virou a condição de uma frase que diz que nenhum atlas foi criado. O que segue abaixo continua valendo inteiro para as outras três cópias da lista de tipos, e a última delas continua sendo a pior.

A lista de 20 tipos existe em **quatro cópias manuais** que precisam mudar juntas. Esta página contou três até 2026-08-16, e a que faltava é justamente a de dano mais silencioso. As quatro, com o que cada omissão custa:

- `frontend/src/js/import_export/local-atlas-to-server.js` (o cliente): a feição é descartada **antes da rede** e incrementa `droppedFeatures`. Até 2026-09-19 esse contador não tinha consumidor de interface e o usuário via um import bem-sucedido; hoje ele recusa o envio nas três portas, e a perda silenciosa que sobra é a de quem chama `buildFeatures` por outro caminho.
- `VALID_FEATURE_TYPES` no Joi (`backend/src/modules/atlas/atlas.schemas.js`): o import inteiro toma 400 e o atlas não nasce ([[erros-api]]). É a falha barulhenta, e por isso a benigna.
- o CHECK `features.valid_feature_type` (`backend/src/database/migrations/003_atlas.sql`): a escrita é recusada pelo próprio banco.
- `typeToCollection` e o esqueleto de `transformFeaturesToFrontend` (`backend/src/modules/sync/sync.service.js`): **a pior das quatro**. A linha é gravada, o servidor confirma, e ela **nunca aparece em snapshot nenhum**. Invisível para todo cliente, para sempre, sem erro em lugar algum. Um atlas importado com um tipo fora deste mapa sobe inteiro e volta sem aquelas feições.

A paridade das quatro é asserida por `frontend/tests/unit/tipos-feicao-paridade-pacotes.test.js`, que é um teste do **frontend lendo fonte do backend**: mudança backend-only reprova na perna do frontend, de propósito. A constraint VIVA, que nenhuma leitura de texto alcança, é conferida por `backend/tests/integration/tipos-feicao-constraint-viva.test.js`. O guarda mais antigo, `backend/tests/unit/snapshot-tipos-vs-check.test.js`, amarra duas das quatro.

Nada disso **previne** a divergência: um tipo novo continua custando quatro edições manuais, nada deriva uma lista da outra através da fronteira dos pacotes, e a ordem de implantação continua sem guarda mecânico ([[deploy-backend]]).

## Dois produtores para o mesmo payload (2026-08-05)

`POST /atlas/import` tem agora **duas** origens no cliente, e a diferença entre elas é de onde vêm os blobs:

- **"Enviar ao servidor"** (`import_export/save-local-atlas.service.js`) lê o store local: `buildExportDataObject` monta o `.ebgeo` em memória e `getImage(id)` traz cada blob do IndexedDB.
- **"Importar .ebgeo"** na página de projetos (`projects/import-ebgeo.service.js`) lê um ARQUIVO: descompacta o ZIP, usa o `data.json` direto e tira os blobs das entradas `images/<id>.<ext>`. **Não toca no store**, e é por isso que existe: a rota antiga para subir um `.ebgeo` era abri-lo no mapa e então salvar, o que destruía o workspace local só para o arquivo passar por ele.

O que os dois compartilham (`buildServerImportPayload` + `atlas-image-upload.js`) foi extraído justamente para não virar duas implementações. A armadilha específica do caminho por arquivo: **JSZip devolve Blob com `type` vazio**, e o uploader trata tipo vazio como PNG, e um JPEG subiria anunciando-se PNG e um SVG passaria pela allowlist que existe para recusá-lo. A extensão da entrada do ZIP é a única informação de tipo que existe ali, então o blob é recarimbado com ela antes de subir.

O nome do atlas vem do **nome do arquivo** (`atlasNameFromFilename`): o formato `.ebgeo` não tem campo de nome de atlas: ele nomeia MAPAS, e é anterior aos atlas de servidor.

## A ordem INVERTEU em 2026-09-19: prepara tudo, publica uma vez

`POST /atlas/import` continua existindo e continua sendo transação única, mas as três portas do produto não o chamam mais quando o acervo cita imagem original: elas registram uma tentativa, mandam os bytes para uma área privada da conta e só então confirmam (`commitImport`, `backend/src/modules/atlas/import-attempt.service.js`). O atlas aparece na listagem depois de atlas, entidades, descritores, recibo e trilha terem commitado juntos.

O que isso aposenta, e é a parte que engana quem ler a versão anterior desta página: **não existe mais o desfecho "atlas criado, imagens faltando"**. A etapa `'images'` de `sendFailureNotice` (`frontend/src/js/projects/local-atlas-notices.js`) ficou inalcançável por estas portas e o `imageStats` delas sempre traz `failed` zerado. A rota de LOTE sobrevive para outro assunto: a figura colada, por `frontend/src/js/store/sync/blob-upload-queue.js`.

**A rota antiga recusa payload com imagem, e o discriminante é a função de transação recebida**, não a rota nem uma bandeira: `importAtlas` lança quando `importImageIds` acha referência e a transação é a padrão. A frase manda atualizar a página porque o alvo é a aba aberta antes da implantação.

**Nada parcial sobe.** `stats.droppedFeatures`, original ausente e imagem fora da allowlist recusam o envio inteiro nas três portas, antes de qualquer escrita de rede. É o inverso do regime anterior, em que cada perda virava um número num toast.

**O ícone personalizado em SVG foi a exceção que essa regra criou, e ele é CONVERTIDO em vez de recusado.** Ele caía em `skipped` por `buildImageUploads` (`frontend/src/js/import_export/atlas-image-upload.js`), de modo que um atlas com um deles não tinha caminho nenhum para o servidor enquanto o ícone estivesse lá. Desde 2026-09-19 a preparação rasteriza o SVG para PNG no navegador (`rasterizeSvgToPng`, `frontend/src/js/import_export/svg-to-png.js`) e o envia como PNG sob o MESMO id, que é o que mantém válida a referência `markerSymbol` já gravada na feição. A allowlist do servidor NÃO mudou, e não vai mudar: ela é png/jpeg/webp por causa do XSS armazenado. O registro local também não muda, então o disco de quem enviou continua com o vetor. O que continua recusando o envio inteiro é o SVG que não decodifica, agora com motivo em `skippedReasons`. Guardas: `frontend/tests/unit/icone-svg-rasteriza-no-envio.test.js` e o caso "ícone personalizado em SVG" de `frontend/tests/e2e-ui/browser-save-local-to-server.spec.js`.

## A identidade da imagem ainda é escolhida pelo cliente

O truque está no backend: `bulkUploadImages` usa `INSERT_IMAGE_WITH_ID` na primeira ocorrência de cada `localId` (`backend/src/modules/images/images.service.js`), ou seja, o id que o cliente manda **vira** o id de servidor. É isso que dispensa uma fase de rewrite: as refs já montadas continuam válidas, e nenhuma operação de UPDATE é emitida para reescrever `properties.imageId`.

O id que o cliente manda, porém, **não é mais o id local**. Desde 2026-08-25 `frontend/src/js/import_export/save-local-atlas.service.js` roda `buildServerImportPayload` **duas vezes**: a primeira só descobre quais blobs o atlas cita, e a segunda recebe um `meta.imageIdMap` com um UUID novo por blob, que reescreve de uma vez as quatro superfícies de referência (id de feição de imagem, `markerSymbol` de ícone próprio, `images[]` de 3D/360 e `settings.customIcons`). A leitura cara do IndexedDB continua sendo uma só.

A razão da assimetria com o resto do atlas: `images.id` é global igual, mas o blob sobe DEPOIS do import, então um id recunhado pelo servidor deixaria pendurada a referência já gravada. Cunhar antes de montar o payload resolve por construção, e nada precisa voltar do servidor. Preso por `frontend/tests/unit/enviar-blob-com-id-novo.test.js`, que mede a CONCORDÂNCIA entre o id do payload e o do upload, não só que o id mudou.

**A porta irmã faz o mesmo desde 2026-08-25**: `frontend/src/js/projects/send-local-to-server.service.js` (envio pelo cartão da lista) subia blob numa passada só, e um reenvio com imagem por ali entrava com a imagem sumida, sem erro. As duas portas são leitores diferentes do mesmo formato, então a regra vale nas duas ou não vale. Ver [[imagens-atlas]] e [[upload-imagens-seguranca]].

Onde isso morde:

- **`localId` duplicado no mesmo lote**: a segunda ocorrência não pode reusar a PK, recebe id novo e o `mapping` colapsa em last-wins (`backend/src/modules/images/images.service.js`). A ref da feição correspondente fica pendurada.
- **SVG não sobe como SVG, e desde 2026-09-19 sobe como PNG**: `ALLOWED_IMAGE_MIME` é png/jpeg/webp (`frontend/src/js/import_export/atlas-image-upload.js`), porque SVG é vetor de XSS armazenado (o CHECK do banco também o recusa). O ícone customizado em SVG já foi perdido em silêncio (o atlas subia sem ele) e já bloqueou o atlas inteiro (quando `skipped` virou recusa); hoje `buildImageUploads` o rasteriza para PNG sob o mesmo id e ele atravessa. Só o SVG que não decodifica continua em `skipped`, e aí a recusa do envio inteiro continua valendo.
- **Magic bytes têm que bater com o mime declarado** (`backend/src/modules/images/images.service.js`). Confiar cegamente em `blob.type` reprova a imagem.
- O blob só vai para disco **depois** do INSERT (`backend/src/modules/images/images.service.js`), deliberadamente, para que a colisão de PK global acima não deixe arquivo órfão.

## Depois do import: a ordem que não é negociável

O import não conecta nada. A troca do store acontece em `frontend/src/js/account/account.control.js`: `saveLocalAtlasToServer` (que **lê** o store local) tem que rodar **antes** de `clearAllDataStore`, `markStoreRemote` e `connect` ([[snapshot-e-pull-incremental]], [[sessao-boot-e-ciclo-de-vida]], [[fila-operacoes-outbound]], [[canal-collab-websocket]]). Inverter apaga os dados antes de subi-los, e o import lê o store: sem a fonte não há o que subir, e reenviar depois já não tem de onde.

Entre o upload e o wipe entram duas linhas que não são cerimônia: a reivindicação do tab lock sob o id do atlas NOVO e `activateRemoteAtlas`. Sem a segunda, tudo abaixo rodava contra o slot LOCAL: o wipe esvaziava o atlas do próprio usuário (não o novo) e o pull do `connect` escrevia o snapshot do SERVIDOR nos bancos locais, fora do registro remoto, onde nenhum expurgo de logout o encontra. A ordem também compra uma segunda coisa: o upload de imagens é best-effort, e a versão que apagava o original local descartava a fonte das imagens que acabaram de falhar. **A adoção do namespace no sentido local→remoto foi rejeitada**, por isso o caminho é COPIAR: ver [[namespace-por-atlas]].

**O toast de perda parcial deixou de ter o que somar.** Ele somava `imageStats.skipped + failed` e era a única sinalização de perda que o usuário recebia; desde 2026-09-19 `skipped` e `droppedFeatures` recusam o envio ANTES da rede e `failed` sempre chega zerado por estas portas, então o que sobra ali é um contador que não conta nada. O que continua sem sinalização própria são os vínculos de grupo.

## Contrato congelado

- Os arrays aninhados de mapa (`features`, `layers`, `groups`, `groupFeatures`, `cesium3dData`, `streetview360Data`) são **camelCase dentro de um payload snake_case**. É inconsistente e é contrato: renomear quebra cliente antigo.
- O `SELECT` de retorno projeta oito colunas fixas (`backend/src/modules/atlas/atlas.service.js`), sem `owner_id` nem timestamps de update. `current_version` é o valor que o cliente guarda como `lastVersion` antes de abrir o socket ([[snapshot-e-pull-incremental]]).

Ver também [[atlas-modelo-de-dados]], [[atlas-settings]], [[api-rest-atlas]], [[resources-catalogo]] e [[streetview-360]].
