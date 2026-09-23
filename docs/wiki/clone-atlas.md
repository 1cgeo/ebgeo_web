# Clone de Atlas

`POST /atlas/:atlasId/clone` duplica o conteúdo de um atlas sob nova posse, copiando **estado** e deliberadamente descartando **história** e permissões.

O mesmo rótulo, "Fazer uma cópia", aparece nos dois tipos de cartão da tela de atlas e chama duas implementações: no atlas de servidor é esta rota; no atlas local é uma cópia banco a banco entre dois namespaces de IndexedDB (`copyAtlasDatabases`, [[namespace-por-atlas]]), que preserva os ids e nem toca na rede. As regras de posse, visibilidade e remapeamento descritas nesta página são do clone de servidor.

## A decisão que define a operação: gate `read`

O clone exige permissão mínima **`read`** (`backend/src/modules/atlas/atlas.routes.js`), enquanto duplicar um mapa *dentro* do atlas exige `write` (`backend/src/modules/atlas/atlas.routes.js`). Não é descuido: duplicar dentro do atlas é escrita no atlas alheio; clonar é escrita num atlas novo, seu. A consequência é forte e precisa ser entendida antes de compartilhar qualquer coisa: **quem consegue ler um atlas pode forkar o conteúdo inteiro e virar `owner` da cópia** (`cloneAtlas`, `backend/src/modules/atlas/atlas.controller.js`, usa `req.user.id`, não o dono original). Não trate clone como operação privilegiada; ver [[permissoes-atlas]].

O portador de [[link-publico]] chega até o gate (o `sub` `public-<uuid>` passa pelo `auth` estrito e `requireAtlasPermission('read')` resolve `read` por `is_public`), e **desde 2026-08-21 ele para num gate e não num acidente de tipo**. Até então a rota falhava uma linha depois, ao inserir `owner_id = 'public-<uuid>'` numa coluna `UUID NOT NULL REFERENCES users(id)`: 22P02, que o `errorHandler` traduzia num erro sem relação aparente com o assunto. Era limite acidental, e o dia em que o visitante ganhasse identidade real de usuário a barreira sumiria sem ninguém ter decidido derrubá-la. Hoje quem recusa é `requireAccountPrincipal` (`backend/src/middleware/auth.js`), com 403 e mensagem: a cópia no servidor precisa de um dono.

A ordem na rota é contrato: o gate de conta vem **depois** de `requireAtlasPermission`, para que um atlas inexistente continue respondendo 404 antes de o servidor revelar que a ação exige conta. E o portador do mesmo link que está **logado** continua clonando, que é a decisão do dono: ele tem linha em `users`.

Não copiar `atlas_shares` é o outro lado do mesmo raciocínio: permissão é do container, não do conteúdo. Se shares viessem junto, um leitor clonaria, viraria `owner` e o atlas novo ainda exporia os mesmos membros da origem. Vale igualmente para o alvo COLETIVO que a tabela ganhou em 2026-08-21: o clone não herda grupo nenhum, e essa é a resposta certa pelo mesmo motivo, com uma agravante (um grupo herdado continuaria crescendo pela mão do dono dele, dentro de um atlas que agora é de outra pessoa). Ver [[compartilhamento-atlas]].

## A cópia perde o que o novo dono não vê

Desde 2026-08-21 o clone é **podado por destinatário**: toda referência a recurso de catálogo que o novo dono não enxerga sai da cópia, decidida numa única chamada a `fn_can_see_resource` para o atlas inteiro. O detalhe, as duas regras e o motivo de o atlas em foco da classificação ser NULO estão em [[sair-do-servidor]].

O que importa saber aqui é a assimetria: **um recurso privado a que o clonador tem concessão própria SOBREVIVE**, e é isso que separa esta poda da do `.ebgeo`, onde todo privado sai. O clone fica no servidor, onde o predicado continua valendo a cada leitura.

Comentários sobre modelo 3D, primeira pessoa e foto 360 seguem a mesma regra. A raiz e suas respostas saem juntas quando o destinatário não vê o recurso fora do atlas de origem; a contagem em `pruneReport` considera as raízes removidas. Duplicar um mapa dentro do mesmo atlas mantém essas conversas. Prova: `backend/tests/integration/atlas-clone-comentarios-recursos.repro.test.js`.

## Estado, não história

Nada de `operations`, `version`, `created_at`/`updated_at` atravessa. Idempotência por `op_id` e ordem de chegada ([[modelo-conflito-lww]], [[idempotencia-e-convergence-guard]]) são propriedades do atlas de origem e não fazem sentido transplantadas: o clone é um atlas novo para efeito de sync, e o primeiro peer que conectar recebe um [[snapshot-e-pull-incremental]] limpo. Ver [[tabela-operations]].

Efeito colateral desejável: como toda leitura filtra `deleted_at IS NULL`, o clone é também uma **compactação**: tombstones do soft-delete não passam ([[atlas-modelo-de-dados]]).

`is_public`/`public_link` ficam de fora: o clone de um atlas público nasce privado. **Comentários visíveis ao solicitante são preservados**, incluindo respostas, texto, autor e estado de resolução. Os ids, mapas e vínculos entre respostas são remapeados, e a versão de sincronização recomeça em 1. O autor não muda para o novo dono: as regras de autoria continuam valendo ([[comentario-espacial]]).

A visibilidade é a mesma do snapshot: `read` não recebe comentários; `comment` ou superior recebe as threads ativas. O controlador passa a permissão resolvida pelo middleware separadamente do corpo da requisição. A duplicação de mapa exige `write` e preserva seus comentários. Regressão de todos os níveis, incluindo administrador: `backend/tests/integration/atlas-clone-comentarios.repro.test.js`.

## Armadilhas

**Imagem se copia com id NOVO, e a lista de onde o id velho aparece é o contrato.** O clone lê as linhas de `images` da origem, planeja a cópia com ids recém-cunhados (`planImageCopies`, `backend/src/modules/atlas/atlas.service.js`), insere as linhas e copia os blobs. O id não pode ser preservado porque ele é chave primária GLOBAL enquanto a leitura é escopada pelo par (id, atlas) em `FIND_IMAGE_BY_ID` (`backend/src/modules/images/images.queries.js`), e o cliente sempre pergunta pelo atlas ATIVO: um clone carregando o id da origem responderia 404 para sempre, degradando em silêncio para "sem imagem" (`fetchImageBlob` engole o erro). Por isso a poda de referência é enumerada, e enumerada é onde ela se quebra: `rewriteFeatureProperties`, `rewriteItemImages` e `rewriteSettingsIcons` (mesmo arquivo) cobrem `properties`, o `markerSymbol` de ícone customizado, os `images[]` de 3D/360 e os `customIcons` de `settings`. **Superfície nova que guarde id de imagem precisa entrar nessa lista**, senão o clone nasce com uma referência irresolvível e nada acusa. Ver [[imagens-atlas]].

**A feição de imagem ADOTA o id da cópia do blob**, porque o cliente e o snapshot dependem de `feature.id === image.id`; todas as outras feições recebem id fresco. Quem raciocinar sobre o remapeamento assumindo "toda feição ganha id novo" erra exatamente nesse tipo.

**Os blobs são preparados ANTES da publicação**, sem segurar conexão do banco durante a cópia (`withPreparedImageCopies`, `backend/src/modules/atlas/atlas.service.js`). Uma falha de disco recusa a operação sem publicar atlas ou mapa incompleto. Se a transação falhar, os arquivos privados preparados são removidos; a origem permanece intacta. Antes do commit, a lista de imagens da origem é conferida novamente: uma alteração concorrente recusa aquela tentativa para evitar referências sem arquivo preparado. A regressão de disco cheio cobre clone e duplicação em `backend/tests/integration/copia-imagens-publicacao.repro.test.js`. Uma morte abrupta ainda pode deixar arquivos sem referência, mas não imagens publicadas sem bytes.

**Referências órfãs degradam para `NULL` em silêncio.** Feature cujo `layer_id` não esteja no mapeamento sai do clone **sem layer** (`backend/src/modules/atlas/atlas.service.js`); slide cujo `map_id` não esteja no mapeamento sai **sem mapa** (`backend/src/modules/atlas/atlas.service.js`). Em vez de violar a FK, o clone perde o vínculo sem erro nem log. Se o clone "perdeu" organização de layers, é aqui.

**A ordem explícita de mapas e slides é preservada.** `remapCopyOrder` (`backend/src/modules/atlas/atlas.service.js`) traduz `map_order` e cada `slide_order` para os novos ids, remove referências obsoletas ou repetidas e acrescenta os filhos existentes que não estavam no array. A ordem física das linhas retornadas pelo Postgres não substitui a sequência escolhida pela pessoa. Regressão: `backend/tests/integration/atlas-clone-ordem.repro.test.js`.

**Ninguém é notificado.** `duplicateMap` faz broadcast de `map_duplicated` (`backend/src/modules/atlas/atlas.controller.js`); o clone não emite nada, porque o atlas destino ainda não existia e portanto não tem sala em [[canal-collab-websocket]]. Clientes só veem o clone ao recarregar a lista.

**Custo: transação única, sem modo assíncrono nem progresso.** Cada coleção entra num INSERT multi-linha só (`insertMany`, `backend/src/modules/atlas/atlas.service.js`), mas todas elas vivem dentro da mesma `tx()`. Em atlas grande isso segura conexão e locks pelo tempo do clone inteiro, e não há nada a reportar ao usuário no meio: o cliente fica bloqueado esperando o 201. A única parte que escapou da transação foi a cópia dos blobs, pela armadilha acima.

## Acoplamento com `duplicateMap`

`cloneMapSubEntities` (`backend/src/modules/atlas/atlas.service.js`) é compartilhada pelos dois caminhos. Qualquer correção no remapeamento de IDs ou na ordem obrigatória (layers → groups → features → group_features → 3D/360) afeta **os dois**, e os dois têm gates de permissão diferentes. Teste ambos.

O `parent_id` de grupo é resolvido no MESMO statement que insere os grupos, e não por uma segunda passada de UPDATE: os ids novos são cunhados antes da escrita, e a FK só é conferida no fim do statement, então um pai do próprio lote é válido. Quem for otimizar ali não precisa reintroduzir a passada extra.

## Onde isso encaixa

Clone é uma das poucas escritas de conteúdo colaborativo feitas por **REST**, e não pelo pipeline de operações ([[sintese-rest-vs-sync]]). A exceção se justifica porque cria entidades num atlas que ainda não tem peers conectados: não há conflito a resolver nem [[envelope-operacao]] a emitir. Para copiar conteúdo entre atlas **já vivos** o caminho não é clone, é exportar/importar ([[atlas-import-offline]], [[formato-ebgeo-roundtrip]]). Usar clone ali criaria um atlas paralelo em vez de mesclar.

Erros seguem [[erros-api]]. Ver também [[atlas-settings]] (o JSONB de settings viaja quase inteiro: as seis listas de recurso de catálogo dentro dele também são podadas por destinatário, e é a única parte que muda) e [[api-rest-atlas]].

## Histórico

- 2026-09-22: corrigidas a perda da ordem explícita e a omissão de comentários que o solicitante já pode ver. A publicação também passou a depender da preparação bem-sucedida de todos os blobs.
- 2026-08-23: esta página afirmava que o clone descartava IMAGENS, com uma armadilha inteira sobre a referência irresolvível e o 404 permanente do download. Deixou de valer: o clone copia as linhas de `images` e os blobs, e reescreve toda referência de id (ver a armadilha correspondente acima). Continuam descartados `atlas_shares`, `is_public`/`public_link` e o histórico de operações.
- 2026-08-23: a página descrevia dois mecanismos que já não existem, "INSERT linha a linha" (hoje um multi-linha por coleção, via `insertMany`) e "as duas passadas de `parent_id` de grupos" (hoje resolvido no mesmo statement).
