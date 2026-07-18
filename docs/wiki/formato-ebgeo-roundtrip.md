# Formato .ebgeo e fidelidade de round-trip

O `.ebgeo` é o contêiner portável do trabalho local e a ponte entre os dois mundos, sujeito a duas invariantes: tudo que entra nele precisa ter caminho de sincronização (P9) e o ciclo .ebgeo → servidor → .ebgeo, mesmo feito por outro usuário, deve ser sem perda (P11).

## Por que o formato existe

No modelo local só existe **um** espaço de trabalho no IndexedDB (P12). "Vários projetos" localmente não são vários atlas nomeados, são vários arquivos `.ebgeo` exportados e importados. O conceito de atlas nomeado é capacidade do servidor (ver [[atlas-modelo-de-dados]] e [[dominio-local-vs-remoto]]). Consequências práticas:

- O `.ebgeo` é a única forma durável de guardar trabalho na máquina.
- Dado de atlas remoto é **efêmero** no cliente (limpo em logout/desconexão, ver [[dominio-local-vs-remoto]]). Regra de ouro: baixe o `.ebgeo` antes de sair se quiser a cópia local.
- "Salvar projeto" enquanto conectado exporta o **estado remoto atual** como `.ebgeo`. É a forma suportada de tirar uma foto de um atlas do servidor.

## Formato do arquivo (físico)

Um `.ebgeo` é um ZIP mascarado por XOR, com cabeçalho mágico:

- `zip.generateAsync` (DEFLATE nível 9) → `xorData(bytes, 0xAA)` → prefixo ASCII `EBGXOR` (`import_export/export-import.service.js:245`, `:522-525`).
- A importação detecta o prefixo e desfaz o XOR; sem o prefixo o arquivo é tratado como ZIP puro (`export-import.service.js:566-575`). O XOR é **máscara, não criptografia**, não trate como proteção.
- Conteúdo: `data.json` (todo o projeto) + `images/<id>.<ext>`, com a extensão derivada do MIME do blob (`png`/`jpg`/`webp`/`svg`).

Versionamento: `data.version` é obrigatório; `ATLAS_SCHEMA_VERSION = '2.2'` (`store/atlas/atlas.entity.js:12`) e `MIN_SCHEMA_VERSION = '1.3'` (`store/repository.utils.js:12`). Arquivo mais antigo que o mínimo ou mais novo que a versão da app é rejeitado; v1.x é migrado em memória antes da validação (`export-import.service.js:587-603`).

Armadilha: na importação não-aditiva, o `clearAllDataStore()` só roda **depois** de parsear e validar (`export-import.service.js:606-612`). Não mova esse clear para cima, um arquivo corrompido apagaria o projeto do usuário.

## O que entra no `data.json`

Montado por `buildExportDataObject` (`export-import.service.js:343-390`), com o mesmo conteúdo que `handleExport` grava no ZIP:

- Topo: `version`, `currentMap`, `mapOrder`, `customIcons`, `briefings`.
- Por mapa (`maps[nome]`): `baseLayer`, `features` (buckets por tipo), `catalogLayers`, `zoom`/`center_lat`/`center_long`/`bearing`/`pitch`, `analysisLayers`.
- Coleções por mapa, montadas em `_exportOptionalMapData` (`:1096-1140`): `colorUsage`, `mapNotes`, `groups`, `layers`, `cesium3d`, `streetview360`, `temporal` (ver [[modulo-temporal]]), `gridStyle`, `comments` (ver [[comentario-espacial]]).

Três detalhes que já causaram perda silenciosa:

1. **Grupos** vêm de `getMapGroups` como objeto simples indexado por id, não como `Map`. Um check antigo por `.size` era sempre falso e derrubava **todos** os grupos de **todo** `.ebgeo`. O check correto é por contagem de chaves (`:1103-1107`).
2. **Temporal** é exportado sempre que **qualquer** campo difere do default, não só quando `ativo` é true, senão um mapa configurado em modo relativo mas desligado perde `origem`/`modo`/`unidade`/limites (`:1113-1119`).
3. Cada getter opcional tem `try/catch` individual: uma falha não aborta o export, mas **silenciosamente omite** a chave. Ao adicionar um dado novo, isso significa que o bug aparece como perda, não como erro.

Coordenadas são arredondadas para 6 casas decimais, cerca de 1 m (`roundCoordinates`, `:180-190`). Isso é perda intencional e aceita pelo P11.

## Chave por nome, não por id

O `.ebgeo` é **keyed por nome de mapa**. No store remoto os mapas são keyed por UUID; o export continua funcionando porque `getAllMapNamesStore` resolve UUID → nome pelo `map-resolver`. Ao mexer no exportador, nunca assuma que a chave do repositório é a chave do arquivo.

## Regra P9: cobertura de sync ⊇ cobertura de `.ebgeo`

O conjunto de dados sincronizados deve ser **superconjunto** do que entra no `.ebgeo`. Se um dado novo é persistido e exportado mas não tem tipo de entidade correspondente em [[tipos-entidade-sync]], é bug de cobertura, não feature futura. Ao adicionar um dado persistido, cubra os dois caminhos na mesma mudança:

1. export/import `.ebgeo`,
2. operação outbound ([[fila-operacoes-outbound]], [[envelope-operacao]]),
3. apply inbound ([[aplicacao-operacoes-remotas]]) **e** o snapshot ([[snapshot-e-pull-incremental]]).

## Regra P11: round-trip sem perda, inclusive entre usuários

Fluxo canônico de verificação: A exporta seu `.ebgeo`, sobe o atlas ("Salvar no servidor"), compartilha com B ([[compartilhamento-atlas]]), B abre do servidor e exporta. Os dois arquivos devem ser equivalentes em conteúdo. Isso exige três elos corretos:

1. **Transform local→servidor** (`import_export/local-atlas-to-server.js`), puro e síncrono.
2. **Servidor** armazena e devolve fielmente no snapshot ([[api-rest-atlas]], [[atlas-modelo-de-dados]]).
3. **`applyRemoteSnapshot`** reconstrói **todos** os campos nas *side-stores* locais (`store/sync/remote-operation-handler.js:1150-1225`).

Diferenças aceitas e intencionais: ids internos remapeados para UUID (notadamente a camada `default`), o id do atlas (novo no servidor) e o arredondamento de coordenadas. Todo o resto deve bater. O teste vivo é `tests/e2e-ui/browser-p11-roundtrip.spec.js`, que compara `features`, `grid`, `temporal` e `baseLayer` mapa a mapa entre A e B.

### Elo 1: o transform (`local-atlas-to-server.js`)

Dois trabalhos principais: **remapear ids para UUID** e **achatar coleções indexadas por chave em arrays tipados**.

- `makeIdMapper` (`:56-66`) mantém UUIDs válidos e memoiza um UUID novo para ids não-UUID, então o mesmo id local sempre vira o mesmo UUID (referências de grupo seguem consistentes).
- O mapper de camada é **por mapa** (`:283`): o literal `'default'` colide entre mapas e precisa de um UUID distinto em cada um.
- Feições cujo tipo não está em `VALID_FEATURE_TYPES` são **descartadas** e contadas em `stats.droppedFeatures` (`:100-106`). O bucket `coordenadas` (leituras efêmeras de azimute) é omitido de propósito.
- `properties.id` e `properties.layerId` são reescritos para os valores do servidor, para a feição ficar consistente lida pela coluna ou pelas properties.
- Feição de imagem: `properties.id` **é** o id do blob. Ícone customizado é referenciado como `markerSymbol = 'custom:<iconId>'` e também é reescrito (`:110-113`). Ver [[imagens-atlas]].
- `colorUsage`, `customIcons` e `mapOrder` viajam em `atlas.settings` (`:330-338`), ver [[atlas-settings]].

### Elo 3: o snapshot precisa gravar nas side-stores

`layers`, `cesium3d`, `streetview360`, `groups` e `comments` chegam **inline** no mapa do snapshot, mas todo leitor (exportador, layer manager, overlay de comentários) lê das **side-stores dedicadas**. Os handlers incrementais gravavam nelas, o caminho de snapshot não gravava: o resultado era um atlas puxado que re-exportava sem camadas/3D/360 (perda silenciosa). Hoje `applyRemoteSnapshot` persiste cada uma explicitamente (`remote-operation-handler.js:1176-1210`), incluindo a normalização de `comments` de array para `{ [id]: comment }`.

Armadilha simétrica: emitir o evento de ciclo de vida **não** persiste nada. Nenhum assinante de `GROUP_*`/`LAYER_*` grava no repositório. Todo caminho inbound precisa escrever antes de emitir.

## Local → servidor: ordem das fases

`saveLocalAtlasToServer` (`import_export/save-local-atlas.service.js:88-118`):

1. `buildExportDataObject` (o mesmo `.ebgeo`, em memória),
2. `buildServerImportPayload`,
3. `POST /atlas/import` **preservando os ids de entidade do cliente**,
4. upload dos blobs em lotes de ≤50 **preservando o id** (`INSERT_IMAGE_WITH_ID`), então as refs importadas no passo 3 continuam válidas sem reescrita.

O serviço **não** conecta nem troca o store. Quem chama faz `clearAllDataStore` + `markStoreRemote` + `connect` depois (ver [[sessao-boot-e-ciclo-de-vida]]).

> [!CONTRADICAO 2026-07-18] O JSDoc de `local-atlas-to-server.js:252` descreve um uso em **duas passadas** (chamar sem `imageIdMap`, subir as imagens, chamar de novo com o mapping). O chamador real em `save-local-atlas.service.js:96-105` faz **uma passada só** e resolve o problema pelo lado oposto, subindo os blobs com o id do cliente preservado. O suporte a `meta.imageIdMap` continua no código, mas nenhum caminho de produção o usa.

## Lacunas conhecidas de P9/P11

- **Comentários espaciais não sobem no "Salvar no servidor".** `data.comments` é exportado e importado no `.ebgeo` (`export-import.service.js:1125`, `:693`, `:731`) e volta do snapshot, mas `buildServerImportPayload` não emite nenhum campo de comentário: o payload de mapa em `local-atlas-to-server.js:298-318` não tem `comments`. Comentários criados **offline** e depois enviados via "Salvar no servidor" se perdem. Comentários criados **ao vivo** sincronizam normal, pela via de operação.

> [!CONTRADICAO 2026-07-18] guia *visao-e-principios* (absorvido):390-391` afirma que o comentário espacial "entra no `.ebgeo` (P9) e faz round-trip (P11)". O round-trip só fecha pela via de operação ao vivo. Pelo caminho em lote local→servidor, `src/js/import_export/local-atlas-to-server.js:298-318` não inclui comentários e eles somem.

- **Ícones customizados SVG não sobem.** `ALLOWED_MIME` em `save-local-atlas.service.js:19` aceita só png/jpeg/webp; o exportador do `.ebgeo` aceita `image/svg+xml` (`export-import.service.js:228-243`). SVGs entram em `imageStats.skipped` e o `markerSymbol` fica apontando para um id sem blob no servidor.
- **Coleta de imagens no ZIP é ampla:** `handleExport` adiciona `feature.properties.id` de **toda** feição ao conjunto `usedImages` (`:437-443`), não só das feições de imagem. Ids sem blob apenas falham no `getImage` e são ignorados, mas não leia esse conjunto como "lista de imagens".

## Importar `.ebgeo` para dentro de um projeto

Modo **não-aditivo** substitui tudo (limpa o store, restaura `currentMap`, `mapOrder`, base layer). Modo **aditivo** desconflita nomes de mapa com sufixo `_1`, `_2`, regenera ids de feição e de camada mantendo `'default'` como `'default'`, e é limitado a 100 mapas no total (`export-import.service.js:640-694`).

> [!CONTRADICAO 2026-07-18] guia *acoes-interface-multiusuario* (absorvido):26` diz que ao importar `.ebgeo` sobre um projeto conectado "o servidor deve resolver IDs duplicados, gerar novos UUIDs se necessário". No código, a regeneração de ids é inteiramente **do cliente**, em `src/js/import_export/export-import.service.js:648-655` (`IDUtils.regenerateMapIds` com o `layerIdMapping` montado antes). O servidor não desconflita nada; a propagação aos pares acontece porque `addMap`/`addFeature` enfileiram operações normalmente.

## Checklist ao adicionar um dado persistido novo

1. Entrou no `.ebgeo`? Adicione em `_exportOptionalMapData` **e** no importador (aditivo e não-aditivo).
2. Tem tipo de entidade e op? Caso contrário, P9 quebrado.
3. O `applyRemoteSnapshot` grava na side-store que o exportador lê? Caso contrário, P11 quebra só no segundo usuário, o modo mais caro de descobrir.
4. Precisa de UUID? Adicione ao transform local→servidor, incluindo referências cruzadas.
5. Cubra com o e2e de round-trip, não só com unit test de transform.

Ver também [[atlas-import-offline]], [[sintese-decisoes-arquiteturais]] e [[modos-operacao]].

## Fontes
- guia *visao-e-principios* (absorvido): P9, P11 e P12 na íntegra, diferenças aceitáveis do round-trip, ordem das fases de "Salvar atlas local no servidor", regra de ouro do dado remoto efêmero, comentário espacial e P9/P11.
- guia *ui-ux-ebgeo* (absorvido): posição do `.ebgeo` entre os formatos de import/export e o `store-origin` como marcador local↔remoto.
- guia *acoes-interface-multiusuario* (absorvido): classificação das ações Abrir / Importar projeto / Salvar projeto e a expectativa (não cumprida) de desconflito de ids no servidor.
- `src/js/import_export/export-import.service.js`: formato físico (ZIP + XOR + `EBGXOR`), versionamento, conteúdo do `data.json`, exportação opcional por mapa, importação aditiva e não-aditiva.
- `src/js/import_export/local-atlas-to-server.js`: transform para o payload de bulk import, remapeamento de UUID, achatamento de 3D/360, ausência de comentários.
- `src/js/import_export/save-local-atlas.service.js`: ordenação import→upload, allowlist de MIME, chunking de imagens.
- `src/js/store/sync/remote-operation-handler.js`: `applyRemoteSnapshot` e a persistência nas side-stores (camadas, grupos, 3D, 360, comentários, `atlas.settings`).
- `tests/e2e-ui/browser-p11-roundtrip.spec.js`: o que o round-trip A→servidor→B realmente compara.
