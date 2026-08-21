# Clone de Atlas

`POST /atlas/:atlasId/clone` duplica o conteúdo de um atlas sob nova posse, copiando **estado** e deliberadamente descartando **história**, permissões e imagens.

O mesmo rótulo, "Fazer uma cópia", aparece nos dois tipos de cartão da tela de atlas e chama DUAS máquinas sem nada em comum: no atlas de servidor é esta rota; no atlas local é uma cópia banco a banco entre dois namespaces de IndexedDB (`copyAtlasDatabases`, [[namespace-por-atlas]]), que não descarta nada, preserva os ids e nem toca na rede. As perdas descritas nesta página (imagens, comentários, ordem de mapas) são do clone de SERVIDOR e não valem para a cópia local.

## A decisão que define a operação: gate `read`

O clone exige permissão mínima **`read`** (`backend/src/modules/atlas/atlas.routes.js`), enquanto duplicar um mapa *dentro* do atlas exige `write` (`backend/src/modules/atlas/atlas.routes.js`). Não é descuido: duplicar dentro do atlas é escrita no atlas alheio; clonar é escrita num atlas novo, seu. A consequência é forte e precisa ser entendida antes de compartilhar qualquer coisa: **quem consegue ler um atlas pode forkar o conteúdo inteiro e virar `owner` da cópia** (`cloneAtlas`, `backend/src/modules/atlas/atlas.controller.js`, usa `req.user.id`, não o dono original). Não trate clone como operação privilegiada; ver [[permissoes-atlas]].

O portador de [[link-publico]] chega até o gate (o `sub` `public-<uuid>` passa pelo `auth` estrito e `requireAtlasPermission('read')` resolve `read` por `is_public`), e **desde 2026-08-21 ele para num gate e não num acidente de tipo**. Até então a rota falhava uma linha depois, ao inserir `owner_id = 'public-<uuid>'` numa coluna `UUID NOT NULL REFERENCES users(id)`: 22P02, que o `errorHandler` traduzia num erro sem relação aparente com o assunto. Era limite acidental, e o dia em que o visitante ganhasse identidade real de usuário a barreira sumiria sem ninguém ter decidido derrubá-la. Hoje quem recusa é `requireAccountPrincipal` (`backend/src/middleware/auth.js`), com 403 e mensagem: a cópia no servidor precisa de um dono.

A ordem na rota é contrato: o gate de conta vem **depois** de `requireAtlasPermission`, para que um atlas inexistente continue respondendo 404 antes de o servidor revelar que a ação exige conta. E o portador do mesmo link que está **logado** continua clonando, que é a decisão do dono: ele tem linha em `users`.

Não copiar `atlas_shares` é o outro lado do mesmo raciocínio: permissão é do container, não do conteúdo. Se shares viessem junto, um leitor clonaria, viraria `owner` e o atlas novo ainda exporia os mesmos membros da origem. Vale igualmente para o alvo COLETIVO que a tabela ganhou em 2026-08-21: o clone não herda grupo nenhum, e essa é a resposta certa pelo mesmo motivo, com uma agravante -- um grupo herdado continuaria crescendo pela mão do dono dele, dentro de um atlas que agora é de outra pessoa. Ver [[compartilhamento-atlas]].

## A cópia perde o que o novo dono não vê

Desde 2026-08-21 o clone é **podado por destinatário**: toda referência a recurso de catálogo que o novo dono não enxerga sai da cópia, decidida numa única chamada a `fn_can_see_resource` para o atlas inteiro. O detalhe, as duas regras e o motivo de o atlas em foco da classificação ser NULO estão em [[sair-do-servidor]].

O que importa saber aqui é a assimetria: **um recurso privado a que o clonador tem concessão própria SOBREVIVE**, e é isso que separa esta poda da do `.ebgeo`, onde todo privado sai. O clone fica no servidor, onde o predicado continua valendo a cada leitura.

## Estado, não história

Nada de `operations`, `version`, `created_at`/`updated_at` atravessa. Idempotência por `op_id` e ordem de chegada ([[modelo-conflito-lww]], [[idempotencia-e-convergence-guard]]) são propriedades do atlas de origem e não fazem sentido transplantadas: o clone é um atlas novo para efeito de sync, e o primeiro peer que conectar recebe um [[snapshot-e-pull-incremental]] limpo. Ver [[tabela-operations]].

Efeito colateral desejável: como toda leitura filtra `deleted_at IS NULL`, o clone é também uma **compactação**: tombstones do soft-delete não passam ([[atlas-modelo-de-dados]]).

Também ficam de fora, por omissão e não por decisão explícita: `is_public`/`public_link` (o clone de um atlas público nasce privado, o que é o comportamento seguro) e `comments`. **As threads de comentário espacial somem sem aviso**, e nem a documentação de origem listava essa exclusão. Quem clona um atlas de revisão encontra os pins vazios ([[comentario-espacial]]).

## Armadilhas

**Imagens viram referência morta, não "arquivo faltando".** As features clonadas mantêm em `properties` os IDs de imagem da origem, mas nenhuma linha de `images` é criada para o clone, e o download é escopado por atlas (`FIND_IMAGE_BY_ID` = `WHERE id = $1 AND atlas_id = $2`, `backend/src/modules/images/images.queries.js`). Logo `GET /atlas/<cloneId>/images/<imageIdOriginal>` responde **404** (`backend/src/modules/images/images.service.js`), sempre. "As referências são mantidas mas os arquivos não são duplicados" descreve o fato e sugere a conclusão errada: a referência mantida é irresolvível, não meramente pesada. Ver [[imagens-atlas]].

**Referências órfãs degradam para `NULL` em silêncio.** Feature cujo `layer_id` não esteja no mapeamento sai do clone **sem layer** (`backend/src/modules/atlas/atlas.service.js`); slide cujo `map_id` não esteja no mapeamento sai **sem mapa** (`backend/src/modules/atlas/atlas.service.js`). Em vez de violar a FK, o clone perde o vínculo sem erro nem log. Se o clone "perdeu" organização de layers, é aqui.

**Ordem de mapas e slides não é preservada.** Os `SELECT` de `maps` (`backend/src/modules/atlas/atlas.service.js`) e de `slides` (`backend/src/modules/atlas/atlas.service.js`) não têm `ORDER BY`. O `map_order`/`slide_order` do clone é remontado na ordem de retorno do Postgres, que não é garantida e **ignora o `map_order`/`slide_order` da origem**. Um atlas reordenado manualmente pode sair embaralhado. Correção: ordenar pela posição no array de ordem da origem antes de inserir, não adicionar `ORDER BY created_at`.

**Ninguém é notificado.** `duplicateMap` faz broadcast de `map_duplicated` (`backend/src/modules/atlas/atlas.controller.js`); o clone não emite nada, porque o atlas destino ainda não existia e portanto não tem sala em [[canal-collab-websocket]]. Clientes só veem o clone ao recarregar a lista.

**Custo: transação única com INSERT linha a linha.** Todo o clone é um loop de inserts unitários dentro de uma `tx()`. Em atlas grande isso segura conexão e locks por bastante tempo, sem modo assíncrono nem progresso; o cliente fica bloqueado esperando o 201.

## Acoplamento com `duplicateMap`

`cloneMapSubEntities()` (`backend/src/modules/atlas/atlas.service.js`) é compartilhada pelos dois caminhos. Qualquer correção no remapeamento de IDs, na ordem obrigatória (layers → groups → features → group_features → 3D/360) ou nas duas passadas de `parent_id` de grupos afeta **os dois**, e os dois têm gates de permissão diferentes. Teste ambos.

## Onde isso encaixa

Clone é uma das poucas escritas de conteúdo colaborativo feitas por **REST**, e não pelo pipeline de operações ([[sintese-rest-vs-sync]]). A exceção se justifica porque cria entidades num atlas que ainda não tem peers conectados: não há conflito a resolver nem [[envelope-operacao]] a emitir. Para copiar conteúdo entre atlas **já vivos** o caminho não é clone, é exportar/importar ([[atlas-import-offline]], [[formato-ebgeo-roundtrip]]). Usar clone ali criaria um atlas paralelo em vez de mesclar.

Erros seguem [[erros-api]]. Ver também [[atlas-settings]] (o JSONB de settings viaja quase inteiro: as seis listas de recurso de catálogo dentro dele também são podadas por destinatário, e é a única parte que muda) e [[api-rest-atlas]].
