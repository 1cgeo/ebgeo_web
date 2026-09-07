# Formato .ebgeo e fidelidade de round-trip

O `.ebgeo` é o contêiner portável do trabalho local, sujeito a duas invariantes: tudo que entra nele precisa ter caminho de sincronização (P9) e o ciclo .ebgeo → servidor → .ebgeo, mesmo feito por outro usuário, deve ser sem perda (P11).

## Por que o formato existe

Localmente "vários projetos" eram vários arquivos `.ebgeo`, e deixaram de ser: isto era o não-objetivo P12 e virou um fato de produto sem ser mais uma decisão, com N atlas locais nomeados desde 2026-08-15 ([[namespace-por-atlas]]) e uma tela que os lista, cria, abre, copia e exclui desde 2026-08-16 (`atlas.html`). Esta linha dizia que **nenhuma tela troca de atlas local** e que o slot anterior ficava sem caminho de volta; valeu por um dia. O que sobra do parágrafo é o que não mudou: o arquivo continua sendo o único jeito de levar o trabalho para OUTRA máquina (ver [[atlas-modelo-de-dados]], [[dominio-local-vs-remoto]]).

**Importar com um atlas de servidor aberto SAI daquele atlas.** O import não-aditivo escreveria no escopo ATIVO, e com namespace por atlas isso é `ebgeo_*__remote-<id>`: o projeto importado nasceria dentro do namespace que o próximo logout destrói, e sumiria sem erro (antes do namespace ele caía no banco legado e sobrevivia). Então o import cria um atlas LOCAL novo e troca para ele (`switchToNewLocalAtlas`, `frontend/src/js/account/open-atlas.service.js`), avisando o usuário em pt-BR de que o projeto do servidor foi fechado e continua intacto. Duas consequências que só se veem cruzando arquivos: **criar vem primeiro** porque é o único passo recusável (teto de 10 atlas locais) e o único não destrutivo, então bater no teto custa zero ao usuário, com o socket ainda de pé; e o import **aditivo** continua recusado dentro de um atlas de servidor, porque "somar" ali significaria criar mapas, camadas e feições no projeto do servidor, o que exige permissão de escrita e uma rodada de sync por entidade. Ver [[namespace-por-atlas]].

A regra de ouro operacional continua: dado de atlas remoto é efêmero no cliente, então **baixe o `.ebgeo` antes de desconectar**. "Salvar projeto" enquanto conectado exporta o estado remoto atual, e é a forma suportada de tirar uma foto de um atlas do servidor.

O XOR sobre o ZIP (prefixo `EBGXOR`) é **máscara, não criptografia**. Não trate como proteção nem construa nada em cima disso.

## Contratos que não podem quebrar

- **A chave do arquivo é o nome do mapa; a chave do repositório remoto é UUID.** O export só funciona porque `getAllMapNamesStore` resolve UUID → nome. Ao mexer no exportador, nunca assuma que a chave do store é a chave do arquivo.
- **Validar antes de destruir.** No import não-aditivo o `clearAllDataStore()` roda **depois** de parsear o ZIP e validar a versão contra `MIN_SCHEMA_VERSION`/`ATLAS_SCHEMA_VERSION` (`frontend/src/js/import_export/export-import.service.js`). Subir esse clear faria um arquivo corrompido apagar o projeto do usuário.
- **Validar antes de CRIAR, e por isso o portão é função pura.** O leitor do arquivo e o veredito de versão moram em `frontend/src/js/import_export/ebgeo-file-gate.js` (`readEbgeoArchive` abre o ZIP mascarado e devolve o `data.json`; `importVersionRefusal` devolve a frase de recusa ou `null`), um módulo folha que não alcança nem o barril `@store` nem modal nenhum. O serviço de import passou a ler por ele, e quem precisava dele de verdade é o boot: "Abrir arquivo .ebgeo" em `atlas.html` deixa os bytes no banco global e o mapa os consome (`frontend/src/js/deep-link/pending-import.js`), e ali o atlas local era criado ANTES de alguém olhar o arquivo. Toda recusa (arquivo de uma build mais nova, ZIP corrompido, `data.json` ausente) deixava para trás um atlas vazio com o nome do arquivo e gastava uma das dez vagas, com o usuário dentro dele; dez tentativas travavam a criação de atlas. O predicado não mudou de forma, mudou de lugar: **parsear, julgar, e só então criar**. O preço declarado é o arquivo aberto duas vezes nesse caminho, pago numa escolha explícita do usuário.
- **Ids são desconflitados pelo cliente, não pelo servidor.** O import aditivo resolve colisão de nome de mapa, monta o `layerIdMapping` e chama `regenerateMapIds` **antes** de gravar (`frontend/src/js/import_export/export-import.service.js`). O servidor não resolve nada; a propagação aos pares só acontece porque `addMap`/`addFeature` enfileiram operações normalmente.
- **`'default'` é um id de camada que colide entre mapas.** Ele é mapeado para si mesmo dentro de cada mapa, e o mapper de camada do transform local→servidor é por mapa, de propósito (`frontend/src/js/import_export/local-atlas-to-server.js`). Um mapper global fundiria as camadas default de todos os mapas em uma só.
- **`idMapping` (feição antiga → nova) não é descartável.** Os grupos do mapa ainda referenciam os ids ANTIGOS das feições e importariam vazios sem ele.

## As três armadilhas de perda silenciosa

O padrão comum: no export/import, o erro não aparece como erro, aparece como **dado que sumiu**.

1. **Todo getter opcional tem `try/catch` individual.** Uma falha não aborta o export, apenas **omite a chave**. Ao adicionar um dado novo, um bug seu chega ao usuário como perda, não como stack trace.
2. **Checagem de "vazio" com a estrutura errada.** `getMapGroups` devolve objeto simples, não `Map`; um check antigo por `.size` era sempre falso e derrubava **todos** os grupos de **todo** `.ebgeo`.
3. **Exportar só o que está "ativo" perde configuração.** O temporal é exportado quando **qualquer** campo difere de `DEFAULT_TEMPORAL_CONFIG`, não quando `ativo` é true (`frontend/src/js/import_export/export-import.service.js`), senão um mapa em modo relativo mas desligado perde `origem`/`modo`/`unidade`/limites. Ver [[modulo-temporal]].

Perda **aceita** e intencional: coordenadas arredondadas a 6 casas (cerca de 1 m), ids internos remapeados para UUID e o id novo do atlas. Todo o resto tem que bater.

## Emitir evento não é persistir

Camadas, grupos, 3D, 360 e comentários chegam **inline** no mapa do snapshot, mas todo leitor (exportador, layer manager, overlay) lê de **side-stores dedicadas**. Os handlers incrementais gravavam nelas; o caminho de snapshot não gravava, e o resultado era um atlas puxado que re-exportava sem camadas/3D/360. Hoje `applyRemoteSnapshot` persiste cada uma explicitamente (`frontend/src/js/store/sync/remote-operation-handler.js`).

A armadilha simétrica é permanente: **nenhum assinante de `GROUP_*`/`LAYER_*` grava no repositório**. Todo caminho inbound precisa escrever antes de emitir. Ver [[aplicacao-operacoes-remotas]], [[snapshot-e-pull-incremental]].

Esse é também o motivo de P11 ser verificado com **dois usuários** (`frontend/tests/e2e-ui/browser-p11-roundtrip.spec.js`): a falha desse tipo é invisível para quem exportou, e só aparece no segundo usuário, o modo mais caro de descobrir.

## Lacunas conhecidas de P9/P11

- **Comentários offline se perdem no "Enviar ao servidor".** Entram e voltam no `.ebgeo` e voltam do snapshot, mas o payload de mapa que o transform monta (`frontend/src/js/import_export/local-atlas-to-server.js`) não tem campo de comentário. Comentário criado **ao vivo** sincroniza normal, pela via de operação; comentário criado offline e enviado em lote some. Ver [[comentario-espacial]].
- **Ícone customizado SVG não sobe, e agora ele é contado como recusa DECLARADA.** O exportador do `.ebgeo` aceita `image/svg+xml`, a allowlist do upload não (`ALLOWED_IMAGE_MIME`, `frontend/src/js/import_export/atlas-image-upload.js`). Antes, um SVG sem `type` virava `image/png` e o servidor o derrubava por conteúdo; desde 2026-09-07 o faro o reconhece e ele entra em `skipped`, que é o que ele sempre foi. O `markerSymbol` continua apontando para um id sem blob no servidor. Ver [[imagens-atlas]].
- **O conjunto `usedImages` do ZIP é amplo**, não uma lista de imagens: entra o `properties.id` de **toda** feição (`frontend/src/js/import_export/export-import.service.js`). Ids sem blob apenas falham no `getImage` e são ignorados. Não leia esse conjunto como inventário.
- Import aditivo tem teto de **100 mapas no total**, o que surpreende quem faz merge repetido.
- **O tipo da imagem vem da EXTENSÃO do nome no ZIP, e as duas metades do round-trip são uma coisa só.** `getBlobExtension` escolhe a extensão na saída e `MIME_BY_EXTENSION` devolve o MIME na entrada (`frontend/src/js/import_export/export-import.service.js`); mexer numa sem a outra faz o JPEG voltar chamado `.png`, que é como o defeito de 2026-09-07 nasceu (130 de 131 blobs com `type` vazio, e 4 de 4 JPEG recusados pelo servidor por "Content does not match declared type"). A subida ainda fareja a ASSINATURA dos bytes quando o blob não traz tipo (`sniffImageMime`, `atlas-image-upload.js`), para o blob que veio de outra fonte.
- **O alvo do slide 3D/360 é ID DE RECURSO, não UUID.** `slides.model_id` e `slides.photo_id` são `VARCHAR(100)`, e o produto os nomeia por slug de tileset (`museu-1cgeo`) e por nome de arquivo da foto 360 (`FOTO_0001.jpg`). O transform local para servidor manda a string com o teto da coluna (`slideResourceRef`, `frontend/src/js/import_export/local-atlas-to-server.js`) e o Joi de import a aceita com `.max(100)`. Exigir UUID ali gravava NULO em todo alvo real, com o slide abrindo no modo certo apontando para nada.
- **O BALDE decide o tipo da feição no envio, não `properties.source`.** O resultado de uma análise mora em `processed_los`/`processed_visibility` carregando `source: 'los'`/`'visibility'`, então ler o `source` primeiro subia RESULTADO como DEFINIÇÃO. Balde conhecido vence; balde desconhecido (`coordenadas`) continua caindo no `source` e sendo descartado por ele. Ver [[tipos-entidade-sync]].
- **A Linha de Barreiras da 2.2 já não some na leitura nem no envio pela página de atlas; some no `.ebgeo` mandado DIRETO ao servidor.** A ferramenta que a outra linha teve na 2.2 gravava no balde `barrier_lines`, e a 2.3 dela a generalizou na Linha de Coordenação sem mover nada: as feições atravessavam o disco e o `.ebgeo` sem serem desenhadas nem contadas. Desde 2026-09-07 `ensureCoordinationLines` (`frontend/src/js/store/repository.utils.js`) as ADOTA nos caminhos de leitura (IndexedDB, snapshot, `.ebgeo` importado e o leitor do envio, `buildLocalAtlasExportData`), carimbando `source: 'coordination_line'`, o código MD33 `290199` e `baseCoordinates` recuperado da geometria. O caminho que continua descartando é `frontend/src/js/projects/import-ebgeo.service.js` (o `.ebgeo` mandado direto para o servidor), que entrega os baldes CRUS a `buildFeatures` (`local-atlas-to-server.js`), onde o que não está em `VALID_FEATURE_TYPES` vira `droppedFeatures`.

**O `meta.imageIdMap` não tem chamador.** Ele sobrou de um desenho antigo, em duas passadas, que o JSDoc de `local-atlas-to-server.js` ainda descrevia. O caminho de produção é uma passada só: `frontend/src/js/import_export/save-local-atlas.service.js` sobe os blobs preservando o id do cliente. Procurar por ele para entender o fluxo leva a um mapeamento que ninguém preenche.

## O nome do mapa, no envio de um atlas local ao servidor

`ebgeo_maps` é chaveado pelo NOME num atlas local anônimo e pelo UUID num atlas sincronizado, e o documento carrega `data.name` nos dois. Os dois campos podem discordar, e discordam em toda instalação vinda da linha anterior do produto: ela grava a chave certa e `data.name = "Novo Mapa"` em todo mapa criado, porque a guarda dela nunca dispara sobre um `getEmptyMapData()` que já devolve esse nome. A regra do envio (`frontend/src/js/projects/send-local-to-server.service.js`), desde 2026-09-07:

- chave que NÃO é um identificador gerado (`isValidId`, que cobre o UUID v4 e o id legado `<epoch>-<aleatório>`) VENCE o campo, porque ali a chave é o nome;
- chave que é identificador cede ao campo, que é o caso do atlas sincronizado;
- dois registros que resolvam para o mesmo nome RECUSAM o envio, antes de qualquer pedido de rede, com erro nomeado que lista os nomes e as chaves.

O nome é a chave primária do documento de exportação (`maps`, `layers`, `groups` e as outras sete seções são indexadas por ele), então dois registros no mesmo nome são um mapa perdido. Antes de 2026-09-07 o campo vencia sempre, e o acervo herdado subia com 2 mapas de 14 e 33 feições de 805, com aviso de sucesso.

A coleção de feições atravessa `ensureCoordinationLines` na leitura, como os outros três caminhos de entrada de um mapa. Sem isso, o balde `barrier_lines` da 2.2 chega ao mapeador do servidor sem nome que ele reconheça, e o que ele faz com o desconhecido é DESCARTAR: no mapa a Linha de Barreiras apenas não desenhava, no envio ela não chegava.

A frase que a tela diz depois do envio conta nove seções (mapas e feições sempre, camadas, grupos, briefings, slides, itens 3D, itens 360 e imagens citadas quando existem) e lê a resposta do servidor, `summary.prunedResourceRefs`, `summary.mapsImported` e `summary.featuresImported`. Ela compara quatro pares de números e só anuncia SUCESSO, navegando para o atlas novo, quando nada se perdeu; qualquer perda vira aviso que fica na tela. O denominador do primeiro par vem de `frontend/src/js/store/atlas-contents.js`, que é um leitor independente do disco, e não do documento de exportação: quando os dois saem do mesmo lugar eles concordam mesmo quando o lugar está errado.

## Checklist ao adicionar um dado persistido novo

A cobertura de sync tem que ser **superconjunto** da cobertura do `.ebgeo`. Se um dado é persistido e exportado mas não tem tipo de entidade em [[tipos-entidade-sync]], é bug de cobertura, não feature futura.

1. Entrou no `.ebgeo`? Adicione no exportador **e** nos dois importadores (aditivo e não-aditivo).
2. Tem operação outbound ([[fila-operacoes-outbound]], [[envelope-operacao]]) e apply inbound ([[aplicacao-operacoes-remotas]]) **e** snapshot ([[snapshot-e-pull-incremental]])? Senão, P9 quebrado.
3. O `applyRemoteSnapshot` grava na side-store que o exportador lê? Senão, P11 quebra só no segundo usuário.
4. Precisa de UUID? Adicione ao transform local→servidor, incluindo referências cruzadas. Id de ENTIDADE é UUID; id de RECURSO de catálogo (tileset, foto 360) não é: confira a coluna antes de exigir `isValidUUID` no transform (o alvo do slide 3D/360 ficou NULO por essa exigência até 2026-09-07).
5. Cubra com o e2e de round-trip, não só com unit test do transform.

Ver também [[atlas-import-offline]], [[api-rest-atlas]], [[compartilhamento-atlas]], [[sintese-decisoes-arquiteturais]] e [[modos-operacao]].
