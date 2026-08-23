# API REST de Atlas (/api/v1/atlas)

Superfície REST do [[atlas-modelo-de-dados]]: só metadados de atlas, permissão e posse. Conteúdo (mapas, feições, camadas, grupos, briefings, slides) não tem rota de escrita e viaja como operação de sync, ver [[sintese-rest-vs-sync]] e [[envelope-operacao]].

Rotas e permissão mínima leem-se direto em `backend/src/modules/atlas/atlas.routes.js` (comentado linha a linha); o cliente é `frontend/src/js/store/sync/api-client.js`.

Regra de manutenção que a leitura casual não protege: rota literal nova sob `/atlas` precisa ser declarada **acima** de `/:atlasId`, senão Express a captura como parâmetro (foi por isso que `/trash` e `/public/:link` estão onde estão).

## A hierarquia de permissão é numérica, e isso derruba gates ingênuos

`read(1) < comment(2) < write(3) < manage(4) < owner(5)` (`backend/src/middleware/permissions.js`). O ponto que quebra implementação: **`manage` está ACIMA de `write`**. Qualquer gate escrito por igualdade (`perm === 'write' || perm === 'owner'`) exclui o co-Gestor em silêncio. Compare por nível. Ver [[permissoes-atlas]].

O próprio frontend caiu nessa armadilha: o card do seletor de projetos escondia "Renomear" do co-Gestor embora o backend aceitasse o `PUT` dele. Já corrigido, com o porquê comentado no ponto de uso (`_openCardMenu`, `frontend/src/js/projects/atlas-drive.js`).

Outras duas saídas não óbvias de `resolvePermission` (`backend/src/middleware/permissions.js`):

- **Admin global tem bypass em toda rota que passa por `requireAtlasPermission`**, resolvido como `owner` antes de consultar shares. Não é bypass total, e a diferença importa numa auditoria de acesso: lixeira e restore checam a posse **dentro da query**, nunca pelo middleware. O alcance do admin ali é um ramo escrito à mão no serviço, não o curto-circuito do middleware. Ver [[gestao-usuarios]] e [[auditoria]].
- **Token público pula o lookup de share** porque seu `sub` é `public-<uuid>`, que não casa o `UUID_RE`. A permissão cai por `is_public → read`. Mudar o formato desse `sub` para um UUID válido reintroduziria o lookup e mudaria o resultado.

Armadilha de diagnóstico: **atlas inexistente ou soft-deletado retorna 404; atlas existente sem acesso retorna 403** (`requireAtlasPermission`, `backend/src/middleware/permissions.js`). Não trate 404 como "sem permissão", nem o contrário. Códigos em [[erros-api]] e [[sintese-contrato-erros-http]].

O middleware deposita `req.atlasOwnerId` separado de `req.user.id`, e `transferOwnership` rebaixa o primeiro (`backend/src/modules/atlas/atlas.controller.js`). Não é redundância: um admin global pode estar agindo sobre atlas alheio, e usar `req.user.id` rebaixaria o admin em vez do dono.

## PUT: o `COALESCE` já não preserva `description`

Desde `1d23ac9` (2026-07-19) a query usa flag de "campo enviado" (`description = CASE WHEN $5 THEN $3 ELSE description END`, `backend/src/modules/atlas/atlas.queries.js`), então `null` e `""` **apagam** e só a ausência preserva. Quem ainda passa por `COALESCE` é `map_order`, que por essa rota só pode ser substituído, nunca esvaziado. E esse `map_order` é a coluna de UUIDs, não a chave `mapOrder` de nomes que o sync escreve em `settings`: os dois existem ao mesmo tempo, ver [[sintese-rest-vs-sync]].

`name: ""` é **422**, não um no-op silencioso: `Joi.string()` rejeita string vazia por default e `err.isJoi` vira 422 no `errorHandler`. O `data.name || null` do service é defensivo e inalcançável para `""`.

## PATCH /settings: o merge é RASO

`settings = settings || $2::jsonb` (`backend/src/modules/atlas/atlas.queries.js`). O operador `||` do JSONB mescla **apenas o primeiro nível**: enviar `{ "features": { "map_3d": false } }` substitui o objeto `features` inteiro e zera as demais flags.

O frontend contorna enviando sempre o bloco completo (`frontend/src/js/modals/atlas-settings.modal.js`). **Todo cliente novo deve fazer o mesmo**: ler o settings atual, mesclar em memória, mandar o objeto inteiro.

Duas convenções que o schema não explicita: **lista de disponibilidade vazia significa "sem restrição"**, não "nada permitido" (`backend/src/database/migrations/003_atlas.sql`); e a validação Joi rejeita `min_zoom > max_zoom` e `default_basemap` fora de `basemaps` (`backend/src/modules/atlas/atlas.schemas.js`). Forma completa em [[atlas-settings]].

## DELETE, restore e por que o restore não é gateado

`DELETE` é soft e **não tem cascade**: mapas, feições e briefings permanecem no banco. O controller fecha a sala com `atlas_deleted`, derrubando os pares conectados ([[canal-collab-websocket]]).

`POST /:atlasId/restore` não passa por `requireAtlasPermission` porque o middleware só enxerga atlas com `deleted_at IS NULL` e gatearia tudo em 404. A posse é checada atomicamente pelo escopo da query `RESTORE_ATLAS` (`backend/src/modules/atlas/atlas.queries.js`); zero linhas vira 404. **Não replique esse padrão em rota de atlas vivo**: sem o filtro de `deleted_at`, o mesmo desenho vira ausência de gate.

Como a posse mora na query, o curto-circuito de admin global do middleware **não alcança** nem esta rota nem `GET /atlas/trash`. Até 2026-07-25 isso significava que ninguém além do dono restaurava; o dono do produto decidiu o contrário quando ficou claro que o par lixeira + desativação prendia o atlas para sempre (ver [[gestao-usuarios]]).

A armadilha está na FORMA da concessão, e ela é o que se leva daqui: o alcance do admin é um **segundo statement** (`RESTORE_ATLAS_ADMIN`, `LIST_ALL_DELETED_ATLAS`) escolhido por um `if` explícito no serviço, e **não** um parâmetro anulável no `RESTORE_ATLAS` original. A alternativa óbvia (`($2 IS NULL OR owner_id = $2)`) transformaria a única guarda anti-IDOR da rota em algo que se desliga passando `null` de um controller, e o escopo dessa query já foi afrouxado por engano uma vez. Todo teste do caminho de admin vem pareado com um de não-admin sem posse (`backend/tests/integration/atlas-trash-admin-restore.test.js`), porque um teste que só prova "admin restaura" fica verde também contra uma query sem escopo nenhum.

## Clone e duplicate: a coluna nova que ninguém lembra de copiar

São **dois** sítios, não um, e essa é a armadilha da seção. Clone e `duplicateMap` montam a linha de `maps` pelo mesmo helper (`mapRow`, `backend/src/modules/atlas/atlas.service.js`) desde `d15b330` (2026-07-24), quando `grid_style` e `temporal_config` deixaram de se perder; o **import** monta o objeto inline no próprio `insertMany` (mesmo arquivo), e o JSDoc do helper diz isso por extenso ("The import path already carries them"). A regra de manutenção, então, é dupla: **coluna nova em `maps` precisa entrar no `mapRow` E na lista do import**. Escrita como "o helper único" ela manda conferir metade, e o import perde a coluna em silêncio. O sintoma aparece longe da causa, ao abrir a cópia, e nada no INSERT acusa.

O clone tampouco copia `is_public`/`public_link`, shares ou histórico de operações, e isso é deliberado: cópia nasce privada e sem herdar audiência. Ver [[clone-atlas]].

## Compartilhamento: `manage`, não `owner`

Todas as rotas de `/sharing` exigem `manage` (`backend/src/modules/sharing/sharing.routes.js`), e o enum concedível é `read|comment|write|manage`. **`owner` não é concedível** (`backend/src/modules/sharing/sharing.schemas.js`): posse vem de `atlas.owner_id` e só muda pela rota de transferência. É o contrato que impede escalada de privilégio por um co-Gestor.

- `POST /sharing/users` é **upsert** (`backend/src/modules/sharing/sharing.queries.js`): reenviar para usuário já compartilhado altera a permissão e responde **201**, não 200 nem 409.
- Remover o dono responde **404 `Share`**, nunca 204: o dono não tem linha em `atlas_shares`, o `DELETE ... RETURNING` não casa nada e o service levanta `NotFoundError` (`backend/src/modules/sharing/sharing.service.js`). Não é no-op silencioso; ver [[compartilhamento-atlas]].
- Toda mutação faz broadcast `sharing_updated` com o `role` já traduzido para o vocabulário do front (`backend/src/modules/sharing/sharing.controller.js`), para o par re-gatear a UI ao vivo sem reconectar. Ver [[sintese-capacidades-por-papel]] e [[presenca-colaborativa]].
- **Existe um trio irmão para GRUPO** (`POST /sharing/groups`, `PUT` e `DELETE /sharing/groups/:groupId`), com o mesmo gate `manage` no atlas e um SEGUNDO gate sobre o grupo: conceder exige que o chamador o administre, e a recusa é **404**, nunca 403. Remover não exige. Só as DUAS que trazem o id no caminho validam `:groupId` na borda (**422** com `details`), porque no `POST` o id viaja no corpo e o que se valida é o `body` (`backend/src/modules/sharing/sharing.routes.js`). Nas rotas de usuário não há validação de parâmetro nenhuma: um `:userId` malformado vira 22P02 traduzido em 400 (`backend/tests/integration/sharing-params-validation.test.js`). Detalhe em [[compartilhamento-atlas]].

## Transferência de posse exige membro ATIVO

A query junta `atlas_shares` com `users.is_active = true` (`backend/src/modules/atlas/atlas.service.js`). O motivo é evitar entregar atlas a conta desativada, que não poderia mais deletá-lo nem transferi-lo, deixando o projeto órfão. Na mesma transação o ex-dono é rebaixado a `manage`, não removido: transferência nunca deve custar acesso a quem transferiu.

O `UPDATE` da posse é escopado por `owner_id = <o dono que autorizou o chamador>` e checa `rowCount`; quem perder recebe **409**. Isso não é zelo genérico: duas pessoas podem estar legitimamente autorizadas contra o MESMO dono ao mesmo tempo (o próprio dono e um admin global, que o middleware resolve como `owner`), e sem o escopo as duas respondiam 200. O primeiro destinatário ficava sem posse (sobrescrita pela segunda transferência) **e** sem share (a linha dele já tinha sido apagada por redundante), em silêncio. Comparar o dono lido no início da transação **não** resolve: sob READ COMMITTED as duas leem o dono antigo antes de qualquer escrita, e é a reavaliação do `WHERE` depois do lock de linha que decide. Prova no nível do serviço em `backend/tests/integration/atlas-transfer-ownership-race.test.js` (nunca por duas requisições HTTP, que o supertest serializa).

## Merge de mapas: a exceção que o pull incremental não vê

`POST /:atlasId/maps/:mapId/merge` é exceção estrutural à regra "conteúdo só muda por sync". Move sub-entidades numa transação; os mapas de origem **não são deletados**, apenas esvaziados.

O merge move linhas em massa, então nenhuma op por entidade descreve o que aconteceu. A saída foi gravar, **na mesma transação**, uma op MARCADORA de tipo `map_merge` (`backend/src/modules/maps/maps.service.js`): ela avança `atlas.current_version` pelo trigger existente (`backend/src/database/migrations/004_sync.sql`) e o par que a recebe resolve tomando snapshot (`STRUCTURAL_RESYNC_OPS`, `frontend/src/js/store/sync/sync-engine.js`).

O porquê vale mais que o mecanismo: sem a op marcadora o merge existia só como broadcast efêmero, que alcança quem está conectado naquele instante. O par offline reconectava com `sync_request {lastVersion: N}`, e como nada fora escrito o `N` ainda era o `current_version`, o pull tomava o ramo incremental e respondia `{operations: []}`. O par concluía que estava em dia e seguia mostrando as feições sob o mapa ANTIGO, indefinidamente, até um F5. O replay vinha vazio por construção. Ver [[snapshot-e-pull-incremental]].

Contrato congelado: as tabelas filhas vêm de uma whitelist literal (`MAP_CHILD_TABLES`, `backend/src/modules/maps/maps.service.js`), nunca de input. **Tabela filha nova no schema exige acrescentá-la ali**, senão o conteúdo dela fica órfão no mapa de origem após o merge, sem erro.

Isso já disparou uma vez, com `comments`: escopada por mapa e entregue pelo snapshot agrupada por mapa, mas fora da whitelist, então mesclar movia as feições e deixava as threads de [[comentario-espacial]] ancoradas no mapa de origem, descoladas do que anotavam. Corrigido em 2026-07-25. O que sobra de lição não é o item, é o guarda: o teste do merge iterava a mesma lista literal em vez de derivá-la do schema, então passava verde com ou sem o defeito. Quem prende hoje é `backend/tests/integration/maps-merge-orphans.test.js`, que fixa o CONJUNTO de chaves de `moved`: editar a whitelist reprova ali, o que força a decisão a ser deliberada.

Segunda armadilha da mesma família, e mais escondida: duas linhas de `cesium3d_data` (`camera_position`) ou de `streetview360_data` (`orientation`) que compartilhem sua chave lógica **não podem coexistir vivas no destino**, porque o snapshot as indexa por esse valor e uma sobrescreve a outra na montagem. Mover em massa criava exatamente esse par: o preset de câmera sumia depois do merge e podia voltar sozinho muito depois, quando a ordem física das linhas mudasse. Hoje `KEYED_SINGLETONS` (mesmo arquivo) resolve o choque por soft-delete ANTES de mover e reporta em `deduped`. **`data_type` novo cuja identidade no snapshot seja um valor, e não o id da linha, precisa entrar nessa lista**; os demais vão para arrays por id e deduplicá-los apagaria dado do usuário.

O merge move a tabela `catalog_layers`, que desde 2026-08-18 é o único lugar onde uma camada de catálogo mora (a coluna legada `maps.catalog_layers` foi apagada; ver [[tipos-entidade-sync]]). Antes disso o merge ignorava a coluna, e um cliente que usasse a forma de array perdia as camadas ao mesclar em silêncio.

**Não é desfazível.** A op marcadora grava só o agregado, nunca a origem linha a linha; não há `createAudit` em `backend/src/modules/maps/`; e o undo do cliente é local e só cobre op de sync. Não existe caminho de reverter, nem à mão pelo banco.

Efeito de terceira ordem, que não se lê em nenhum dos três lugares sozinho: `trg_mark_slides_broken` (`backend/src/database/migrations/003_atlas.sql`) marca `is_broken` quando o mapa referenciado é **soft-deletado**, e o merge esvazia sem deletar. O slide que aponta para a origem segue `is_broken = FALSE` e passa a apresentar um mapa vazio: a detecção de slide quebrado é cega justamente para o único caminho que produz mapa vazio sem deleção.

Nada disso é exercitado pelo produto hoje: **nenhum cliente web chama estas rotas**. `api-client.js` não tem método de merge, e os únicos chamadores são os testes de integração do backend. O handler de `maps_merged` existe (`frontend/src/js/store/sync/ws-client.js`), mas o gesto que o dispara não, então não conclua desta seção que o ramo `serverResync` já está sendo exercitado por merge em produção.

Origem fora do atlas devolve **404**, não 403: guarda anti-IDOR que evita vazar existência.

## Contratos de resposta que surpreendem

- As rotas de atlas devolvem **snake_case cru do Postgres** (`SELECT a.*`); o sub-router de sharing devolve camelCase na leitura e snake_case cru na escrita. **Não compartilhe desserializador**, nem entre as duas famílias nem entre o `GET` e o `POST` de sharing; a assimetria interna está explicada em [[compartilhamento-atlas]].
- `owner_nome`/`owner_username`/`user_permission` existem só na listagem e na lixeira, **não** no `GET /atlas/:atlasId` (`LIST_USER_ATLAS`/`LIST_DELETED_USER_ATLAS` vs `FIND_ATLAS_BY_ID`, `backend/src/modules/atlas/atlas.queries.js`). UI que depende deles quebra ao navegar de lista para detalhe.
- `GET /atlas` casa apenas posse mais o que `fn_user_atlas_shares` devolve (`LIST_USER_ATLAS`, `backend/src/modules/atlas/atlas.queries.js`): **um atlas público ao qual você não foi convidado nunca aparece aqui**, mesmo sendo legível. Ele só chega por [[link-publico]]. O share não se lê por JOIN cru na tabela, e o comentário da query registra por quê: o cru enxergava só a linha de pessoa e escondia quem alcança o atlas por grupo, dando à listagem menos acesso que o gate ([[grupo-de-acesso]]).
- O array `maps` do `GET /atlas/:atlasId` vem `ORDER BY created_at`, **não** na ordem de `map_order` (`backend/src/modules/atlas/atlas.queries.js`). Ordenar é responsabilidade do cliente.
- Slide tem shape diferente por superfície, e é o mesmo caso do `map_order` acima. Pelo snapshot cada slide ganha `order` derivado do canônico `briefings.slide_order`, mais `temporalCursor` e o bloco `sync`; pelo REST vem `SELECT *` cru em `ORDER BY created_at` (`backend/src/modules/briefings/briefings.queries.js`), sem nenhum dos três e fora da ordem de apresentação.

## Envelope, erro e refresh

Sucesso é sempre `{ data }`; 204 vem sem corpo (o cliente precisa tolerar). O desembrulho tem um passe-livre para contratos "nus" (arrays e objetos sem chave `data`, como `/nomes/busca` e `/sv360/**`) em `_unwrap` (`frontend/src/js/store/sync/api-client.js`): se um endpoint novo devolver array, ele passa direto, o que é intencional e fácil de quebrar ao "padronizar". `GET /api/config` responde `{ data }` como as demais ([[sintese-contratos-congelados]]).

`_request` faz **um** refresh transparente em 401 e repete a chamada uma única vez (`_retry: false` na segunda, `frontend/src/js/store/sync/api-client.js`). Não há segunda tentativa: falha de refresh sobe como erro. Ver [[refresh-token-rotacao]] e [[autenticacao-jwt]].

## Acesso público

`GET /atlas/public/:link` é a única rota da família sem `auth`, protegida por `publicLinkLimiter` **porque o link é enumerável** (16 bytes hex, `backend/src/modules/atlas/atlas.service.js`). A busca exige `is_public = true AND deleted_at IS NULL`, logo desativar o link invalida o acesso na hora, sem propagação.

O `publicToken` devolvido é JWT de **1 hora sem refresh**, válido para REST e WebSocket. Sessão pública longa exige reobter o token pelo mesmo endpoint; não há caminho de renovação. Ver [[link-publico]] e [[hardening-borda-api]].

## Import de atlas local

`POST /atlas/import` **preserva os UUIDs de entidade enviados pelo cliente**, enquanto o atlas ganha id novo do servidor (`backend/src/modules/atlas/atlas.service.js`). É o que torna o round-trip local↔servidor idempotente do lado das entidades, ver [[dominio-local-vs-remoto]] e [[formato-ebgeo-roundtrip]].

Acoplamento a vigiar: o enum de `feature_type` do schema (`backend/src/modules/atlas/atlas.schemas.js`) precisa acompanhar o do frontend **e** o CHECK do banco. Os três divergem em silêncio até um import falhar. Ver [[atlas-import-offline]].

## REST com efeito colaborativo

"REST só de metadados" não significa "REST sem efeito em tempo real": `PUT`, `DELETE`, `PATCH /settings`, `transfer`, `duplicate` e todo `/sharing/*` empurram mensagem para a sala do WebSocket. Quem raciocina sobre convergência precisa olhar os dois canais. Ver [[sintese-rest-vs-websocket]] e [[canal-collab-websocket]].

## Atlas Drive (project-picker)

O seletor de projetos (`frontend/src/js/projects/atlas-drive.js`, classe `AtlasDrive`) é a única superfície que consome quase toda esta família. Três decisões que não se leem no código:

- Em 2026-08-05 deixou de ser modal e virou o **corpo de `atlas.html`** (entry `frontend/src/js/projects/projects-page.js`). Os `data-testid` `project-picker-*`, incluindo o raiz `project-picker-modal`, cujo nome ficou mentindo de propósito, foram **preservados verbatim**: são contrato de teste, e renomear qualquer um quebra e2e. Sumiram na mudança o botão de fechar e o Esc-para-fechar (página não fecha). O componente **não toca no store nem no sync engine**: abrir é navegar para `./?atlas=<uuid>` e deixar o roteador de boot do mapa fazer o resto. O que ele NÃO faz mais é perguntar sobre trabalho local: desde o namespace por atlas o wipe de entrada cai no namespace que está sendo aberto, e o aviso que dizia o contrário saiu em 2026-08-16 ([[sessao-boot-e-ciclo-de-vida]]).
- As abas são filtros client-side sobre a **mesma** resposta de `GET /atlas` (exceto a Lixeira, com endpoint próprio e carga lazy). Dois dos cinco filtros dependem de `user_permission` (`_visible`, `frontend/src/js/projects/atlas-drive.js`), que só existe em `LIST_USER_ATLAS`; a aba "Públicos" filtra por `is_public` e mesmo assim mostra apenas atlas públicos aos quais você já tem acesso, porque quem recorta é a RESPOSTA de `GET /atlas`, não o filtro de tela.
- **A identidade visual do cartão é a faixa colorida com as iniciais**, cor determinística do nome, e desde 2026-08-16 uma **capa** enviada pelo usuário toma o lugar dela quando existe. Continua não havendo snapshot automático do mapa, e essa metade da recusa de 2026-07-25 é que segue valendo: snapshot apodrece sozinho, imagem escolhida por alguém não. Ver a seção seguinte e [[sintese-decisoes-arquiteturais]].

Quando o Drive abre no boot e o destino de dado remoto órfão: [[sessao-boot-e-ciclo-de-vida]].

## O que o cartão de projeto mostra além do nome

Três fatos chegam por rotas que **não existem para o resto do app** e cujo desenho só se entende junto (`backend/src/modules/atlas/atlas.routes.js`, consumidas por `frontend/src/js/projects/atlas-drive.js`):

- `GET /atlas/overview`: participantes, contagem e capas de todos os atlas que o chamador alcança, num pedido só.
- `GET /atlas/presence`: só quem está conectado agora, para a atualização periódica.
- `PUT` / `DELETE /atlas/:id/cover`: a capa, gate `write`.

**Por que não crescer o `GET /atlas`.** A listagem simples é chamada por quatro superfícies do cliente (controle de conta, aba Mapas, nome do atlas e esta tela), e três delas só querem id e nome. Agregar participante ali faria toda troca de mapa pagar dois subselects por atlas, e a capa viajaria por acidente em `SELECT a.*`. Daí também a capa morar em `atlas_covers`, tabela à parte.

**As duas rotas de listagem não passam por `requireAtlasPermission`**, e não é esquecimento: elas não falam de UM atlas, então o middleware não tem sujeito. O escopo (dono ou compartilhado com o chamador) mora **dentro da consulta**, que é onde ele não escapa. Um filtro perdido ali não dá erro, devolve os projetos alheios com cara de resposta certa, e é por isso que `backend/tests/integration/atlas-cartao-projeto.test.js` grava uma capa antes de afirmar que o estranho não a recebe: sem o dado no lugar, o caso passaria verde provando nada.

**A lista de participantes é mais frouxa que `GET /sharing`**, que exige `manage`. Qualquer nível vê com quem divide o projeto, porque é o que o mapa já mostra no primeiro instante de colaboração; o que ela não devolve é username, e-mail ou o nível de acesso alheio. É decisão de produto, não descuido, e o caso que a fixa está nomeado naquele arquivo.

**Presença é POLL, e por uma razão estrutural:** o socket de colaboração é por atlas ([[canal-collab-websocket]]), então presença ao vivo numa grade de vinte projetos seria vinte conexões abertas por uma página que não entrou em nenhum deles. A fonte é o registro de salas em memória (`getRoomUsers`), o que traz dois limites: a resposta é **por processo**, e conta a PESSOA, não o socket, senão duas abas de alguém virariam "2 no mapa". Ver [[presenca-colaborativa]].

**A capa é `BYTEA` no banco e data URI no fio.** O cliente reduz a imagem antes de subir (`frontend/src/js/projects/cover-image.js`); o servidor decodifica na borda e casa o **número mágico** com o mime declarado, porque o mime é texto que o cliente escolhe e a allowlist (png/jpeg/webp, sem svg) valeria zero sem essa conferência. Volta como data URI, e não por uma rota de imagem, porque a tela autentica por cabeçalho `Bearer` e `<img src>` não manda cabeçalho.

## Histórico

- 2026-08-23: a seção de clone/duplicate dizia que "os TRÊS caminhos de cópia" montavam a linha de `maps` pelo mesmo helper, e fazia disso a regra de manutenção. São dois: o import monta a linha inline. Escrita assim, a regra mandava conferir metade dos sítios.
- 2026-08-23: o item de `GET /atlas` citava o literal `owner_id = $1 OR s.user_id = $1`. O share deixou de ser lido por JOIN cru quando o grupo virou alvo de `atlas_shares` (2026-08-21); a conclusão sobre atlas público não convidado não mudou.
