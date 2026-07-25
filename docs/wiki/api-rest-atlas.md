# API REST de Atlas (/api/v1/atlas)

Superfície REST do [[atlas-modelo-de-dados]]: só metadados de atlas, permissão e posse. Conteúdo (mapas, feições, camadas, grupos, briefings, slides) não tem rota de escrita e viaja como operação de sync, ver [[sintese-rest-vs-sync]] e [[envelope-operacao]].

Rotas e permissão mínima leem-se direto em `backend/src/modules/atlas/atlas.routes.js` (53 linhas, comentadas); o cliente é `frontend/src/js/store/sync/api-client.js`. Esta página só registra o que o código não conta.

Uma regra de manutenção que a leitura casual não protege: rota literal nova sob `/atlas` precisa ser declarada **acima** de `/:atlasId`, senão Express a captura como parâmetro (foi por isso que `/trash` e `/public/:link` estão onde estão).

## A hierarquia de permissão é numérica, e isso derruba gates ingênuos

`read(1) < comment(2) < write(3) < manage(4) < owner(5)` (`backend/src/middleware/permissions.js:12-18`). O ponto que quebra implementação: **`manage` está ACIMA de `write`**. Qualquer gate escrito por igualdade (`perm === 'write' || perm === 'owner'`) exclui o co-Gestor em silêncio. Compare por nível. Ver [[permissoes-atlas]].

> **Nota histórica.** O próprio frontend cai nessa armadilha: `frontend/src/js/modals/project-picker.modal.js:369-370` faz `perm === 'owner' || perm === 'write'`, então o co-Gestor não vê "Renomear" no card embora o backend aceite o `PUT` dele (`backend/src/modules/atlas/atlas.routes.js:27`). O guia *ui-ux-ebgeo* (absorvido) §2 descreve a ação como "gated por papel (renomear = Editor+)", que é a intenção, não o efeito.

Outras duas saídas não óbvias de `resolvePermission` (`backend/src/middleware/permissions.js:30-48`, `:82-92`):

- **Admin global tem bypass em toda rota que passa por `requireAtlasPermission`**, resolvido como `owner` antes de consultar shares. Não é bypass total, e a diferença importa numa auditoria de acesso: lixeira e restore checam a posse **dentro da query**, nunca pelo middleware, então o admin não enxerga nem restaura atlas alheio na lixeira (ver a seção de restore). Ver [[gestao-usuarios]] e [[auditoria]].
- **Token público pula o lookup de share** porque seu `sub` é `public-<uuid>`, que não casa o `UUID_RE`. A permissão cai por `is_public → read`. Mudar o formato desse `sub` para um UUID válido reintroduziria o lookup e mudaria o resultado.

Armadilha de diagnóstico: **atlas inexistente ou soft-deletado retorna 404; atlas existente sem acesso retorna 403** (`backend/src/middleware/permissions.js:73-74` e `:111-112`). Não trate 404 como "sem permissão", nem o contrário. Códigos em [[erros-api]] e [[sintese-contrato-erros-http]].

O middleware deposita `req.atlasOwnerId` separado de `req.user.id`, e `transferOwnership` rebaixa o primeiro (`backend/src/modules/atlas/atlas.controller.js:76-78`). Não é redundância: um admin global pode estar agindo sobre atlas alheio, e usar `req.user.id` rebaixaria o admin em vez do dono.

## PUT: `name` vazio é 422, e a doc afirmava o oposto

> Até 2026-07-25 esta seção afirmava, em negrito, uma "assimetria perigosa": que `name: ""` virava `null`, o `COALESCE` preservava o nome antigo e a API respondia 200 sem mudar nada. **Nunca foi verdade neste repositório.** A rota valida na borda (`backend/src/modules/atlas/atlas.routes.js:27`) e `updateAtlasSchema.name` é `Joi.string().max(255)` (`backend/src/modules/atlas/atlas.schemas.js:9-13`) desde que o backend entrou aqui (`e30622c`, 2026-07-18); `Joi.string()` **rejeita string vazia por default**, e `err.isJoi` vira 422 no `errorHandler` (`backend/src/middleware/error-handler.js:28-39`). O `data.name || null` do service é defensivo e inalcançável para `""`. A doc enganava em dobro: negava o 422 que acontece e mandava o cliente tratar um no-op silencioso que não existe.

O `COALESCE` também deixou de valer para `description`: desde `1d23ac9` (2026-07-19) a query usa flag de "campo enviado" (`description = CASE WHEN $5 THEN $3 ELSE description END`, `backend/src/modules/atlas/atlas.queries.js:48-57`), então `null` e `""` **apagam** e só a ausência preserva. Quem ainda passa por `COALESCE` é `map_order`, que por essa rota só pode ser substituído, nunca esvaziado. E esse `map_order` é a coluna de UUIDs, não a chave `mapOrder` de nomes que o sync escreve em `settings`: os dois existem ao mesmo tempo, ver [[sintese-rest-vs-sync]].

## PATCH /settings: o merge é RASO

`settings = settings || $2::jsonb` (`backend/src/modules/atlas/atlas.queries.js:69-76`). O operador `||` do JSONB mescla **apenas o primeiro nível**: enviar `{ "features": { "map_3d": false } }` substitui o objeto `features` inteiro e zera as demais flags.

> **Nota histórica.** O guia *02-atlas-basico* (absorvido):291-300 mostra exatamente esse payload parcial e afirma "PATCH permite atualização parcial - apenas os campos enviados serão alterados". O código faz merge raso (`backend/src/modules/atlas/atlas.queries.js:71`).

O frontend contorna enviando sempre o bloco completo (`frontend/src/js/modals/atlas-settings.modal.js:348-350`). **Todo cliente novo deve fazer o mesmo**: ler o settings atual, mesclar em memória, mandar o objeto inteiro.

Duas convenções que o schema não explicita: **lista de disponibilidade vazia significa "sem restrição"**, não "nada permitido" (`backend/src/database/migrations/002_atlas.sql:19-36`); e a validação Joi rejeita `min_zoom > max_zoom` e `default_basemap` fora de `basemaps` (`backend/src/modules/atlas/atlas.schemas.js:19-48`). Forma completa em [[atlas-settings]].

> **Nota histórica.** O guia *02-atlas-basico* (absorvido):110-113 lista só três flags de `features` (`map_3d`, `panoramic_images`, `terrain_3d`); schema e default incluem também `data_layers` e `analysis_layers`.

## DELETE, restore e por que o restore não é gateado

`DELETE` é soft e **não tem cascade**: mapas, feições e briefings permanecem no banco. O controller fecha a sala com `atlas_deleted`, derrubando os pares conectados ([[canal-collab-websocket]]).

`POST /:atlasId/restore` não passa por `requireAtlasPermission` porque o middleware só enxerga atlas com `deleted_at IS NULL` e gatearia tudo em 404. A posse é checada atomicamente pelo escopo da query `RESTORE_ATLAS` (`backend/src/modules/atlas/atlas.queries.js`); zero linhas vira 404. **Não replique esse padrão em rota de atlas vivo**: sem o filtro de `deleted_at`, o mesmo desenho vira ausência de gate.

O efeito colateral que ninguém pede: como a posse mora na query, o curto-circuito de admin global do middleware **não alcança** nem esta rota nem `GET /atlas/trash`, que filtra por `owner_id` da mesma forma (`LIST_DELETED_USER_ATLAS`, `backend/src/modules/atlas/atlas.queries.js`). Um admin recebe 404 no atlas alheio da lixeira. Suporte poder restaurar atlas de terceiro é requisito ausente, não bug de implementação.

## Clone e duplicate: a coluna nova que ninguém lembra de copiar

Esta seção afirmou até 2026-07-25 que clone e duplicate perdiam `grid_style` e `temporal_config`. Era verdade, e deixou de ser em `d15b330` (2026-07-24): os três caminhos de cópia montam a linha de `maps` pelo mesmo helper (`mapRow`, `backend/src/modules/atlas/atlas.service.js:544-565`). O que sobrevive da lição é a regra de manutenção: **coluna nova em `maps` precisa entrar no `mapRow`**, senão a perda volta, sem erro, exatamente como antes. O sintoma aparece longe da causa, ao abrir a cópia, e nada no INSERT acusa.

O clone tampouco copia `is_public`/`public_link`, shares ou histórico de operações, e isso é deliberado: cópia nasce privada e sem herdar audiência. Ver [[clone-atlas]].

## Compartilhamento: `manage`, não `owner`

Todas as rotas de `/sharing` exigem `manage` (`backend/src/modules/sharing/sharing.routes.js:15-20`), e o enum concedível é `read|comment|write|manage`. **`owner` não é concedível** (`backend/src/modules/sharing/sharing.schemas.js:6`): posse vem de `atlas.owner_id` e só muda pela rota de transferência. É o contrato que impede escalada de privilégio por um co-Gestor.

- `POST /sharing/users` é **upsert** (`backend/src/modules/sharing/sharing.queries.js:26-31`): reenviar para usuário já compartilhado altera a permissão e responde **201**, não 200 nem 409.
- Remover o dono responde **404 `Share`**, nunca 204: o dono não tem linha em `atlas_shares`, o `DELETE ... RETURNING` não casa nada e o service levanta `NotFoundError` (`backend/src/modules/sharing/sharing.service.js`). Não é no-op silencioso; o comentário da própria rota que afirma o contrário está registrado em [[compartilhamento-atlas]].
- Toda mutação faz broadcast `sharing_updated` com o `role` já traduzido para o vocabulário do front (`backend/src/modules/sharing/sharing.controller.js:38`, `:57`), para o par re-gatear a UI ao vivo sem reconectar. Ver [[sintese-capacidades-por-papel]] e [[presenca-colaborativa]].

> **Nota histórica.** O guia *07-compartilhamento* (absorvido):32-53 documenta `GET /sharing` sem a chave `owner`; `backend/src/modules/sharing/sharing.service.js:15-19` a inclui.

## Transferência de posse exige membro ATIVO

A query junta `atlas_shares` com `users.is_active = true` (`backend/src/modules/atlas/atlas.service.js:511-519`). O motivo é evitar entregar atlas a conta desativada, que não poderia mais deletá-lo nem transferi-lo, deixando o projeto órfão. Na mesma transação o ex-dono é rebaixado a `manage`, não removido: transferência nunca deve custar acesso a quem transferiu.

## Merge de mapas: a exceção que o pull incremental não vê

`POST /:atlasId/maps/:mapId/merge` (`src/modules/maps/`) é exceção estrutural à regra "conteúdo só muda por sync". Move sub-entidades numa transação; os mapas de origem **não são deletados**, apenas esvaziados.

O merge move linhas em massa, então nenhuma op por entidade descreve o que aconteceu. A saída foi gravar, **na mesma transação**, uma op MARCADORA de tipo `map_merge` (`backend/src/modules/maps/maps.service.js:13`, `:118`): ela avança `atlas.current_version` pelo trigger existente (`backend/src/database/migrations/003_sync.sql:54-69`) e o par que a recebe resolve tomando snapshot (`STRUCTURAL_RESYNC_OPS`, `frontend/src/js/store/sync/sync-engine.js:67`), a mesma resolução que o broadcast `maps_merged` já dispara ao vivo. Ver [[snapshot-e-pull-incremental]].

O porquê disso vale mais que o mecanismo, e esta página afirmou o contrário até 2026-07-25 ("não passa pela tabela `operations` [...] pull incremental jamais o enxerga", verdade até `1d23ac9`, 2026-07-19): sem a op marcadora o merge existia só como broadcast efêmero, que alcança quem está conectado naquele instante. O par que estivesse offline reconectava com `sync_request {lastVersion: N}`, e como nada fora escrito o `N` ainda era o `current_version`, o pull tomava o ramo incremental e respondia `{operations: []}`. O par concluía que estava em dia e seguia mostrando as feições sob o mapa ANTIGO, indefinidamente, até um F5. O replay vinha vazio por construção.

Contrato congelado: as tabelas filhas vêm de uma whitelist literal (`MAP_CHILD_TABLES`, `backend/src/modules/maps/maps.service.js:21-28`), nunca de input. **Adicionar tabela filha nova ao schema exige acrescentá-la ali**, senão o conteúdo dela fica órfão no mapa de origem após o merge, sem erro.

Isso já disparou e continua disparado: `comments` é escopada por mapa (`map_id UUID NOT NULL`, `backend/src/database/migrations/002_atlas.sql:220-243`) e o snapshot a entrega agrupada por mapa (`backend/src/modules/sync/sync.service.js:794`), mas não está na whitelist. Mesclar move as feições e deixa as threads de [[comentario-espacial]] ancoradas no mapa de origem, descoladas do que anotavam, sem erro e sem contagem em `moved`. O teste que cobre o merge itera a mesma lista literal de seis tabelas (`backend/tests/integration/maps-briefings-gaps.test.js:83`) em vez de derivá-la do schema, então passa verde com ou sem o defeito: é cobertura vazia para este caso.

O merge move a **tabela** `catalog_layers` e ignora a **coluna legada** `maps.catalog_layers`, que continua sendo o modo dual descrito em [[tipos-entidade-sync]]. Cliente que usa a forma de array perde as camadas de catálogo ao mesclar, e `moved.catalog_layers` reporta zero sem sinalizar nada.

**Não é desfazível.** A op marcadora grava só o agregado (`{ destMapId, sourceMapIds, moved }`), nunca a origem linha a linha; não há `createAudit` em `backend/src/modules/maps/`; e o undo do cliente é local e só cobre op de sync. Não existe caminho de reverter, nem à mão pelo banco. Confirme na UI antes de chamar.

Efeito de terceira ordem, que não se lê em nenhum dos três lugares sozinho: `trg_mark_slides_broken` (`backend/src/database/migrations/002_atlas.sql:378-396`) marca `is_broken` quando o mapa referenciado é **soft-deletado**, e o merge esvazia sem deletar. O slide que aponta para a origem segue `is_broken = FALSE` e passa a apresentar um mapa vazio: a detecção de slide quebrado é cega justamente para o único caminho que produz mapa vazio sem deleção.

Nada disso é exercitado pelo produto hoje: **nenhum cliente web chama estas rotas**. `frontend/src/js/store/sync/api-client.js` não tem método de merge, de `GET /maps` nem de `GET /briefings`, e os únicos chamadores são os testes de integração do backend. O handler de `maps_merged` existe (`frontend/src/js/store/sync/ws-client.js:354`), mas o gesto que o dispara não, então não conclua desta seção que o ramo `serverResync` já está sendo exercitado por merge em produção.

Origem fora do atlas devolve **404**, não 403: guarda anti-IDOR que evita vazar existência.

## Contratos de resposta que surpreendem

- As rotas de atlas devolvem **snake_case cru do Postgres** (`SELECT a.*`); o sub-router de sharing devolve camelCase na leitura e snake_case cru na escrita. **Não compartilhe desserializador**, nem entre as duas famílias nem entre o `GET` e o `POST` de sharing; a assimetria interna está explicada em [[compartilhamento-atlas]].
- `owner_nome`/`owner_username`/`user_permission` existem só na listagem e na lixeira, **não** no `GET /atlas/:atlasId` (`backend/src/modules/atlas/atlas.queries.js:14-26` vs `:9-12`). UI que depende deles quebra ao navegar de lista para detalhe.
- `GET /atlas` casa apenas `owner_id = $1 OR s.user_id = $1`: **um atlas público ao qual você não foi convidado nunca aparece aqui**, mesmo sendo legível. Ele só chega por [[link-publico]].
- O array `maps` do `GET /atlas/:atlasId` vem `ORDER BY created_at`, **não** na ordem de `map_order` (`backend/src/modules/atlas/atlas.queries.js:95-100`). Ordenar é responsabilidade do cliente.
- Slide tem shape diferente por superfície, e é o mesmo caso do `map_order` acima. Pelo snapshot cada slide ganha `order` derivado do canônico `briefings.slide_order`, mais `temporalCursor` e o bloco `sync`; pelo REST vem `SELECT *` cru em `ORDER BY created_at` (`backend/src/modules/briefings/briefings.queries.js:15-19`), sem nenhum dos três e fora da ordem de apresentação.

## Envelope, erro e refresh

Sucesso é sempre `{ data }`; 204 vem sem corpo (o cliente precisa tolerar, `frontend/src/js/store/sync/api-client.js:225`). O desembrulho tem um passe-livre para contratos "nus" (arrays e o objeto de config, sem chave `data`) em `_unwrap` (`frontend/src/js/store/sync/api-client.js:255-261`): se um endpoint novo devolver array, ele passa direto, o que é intencional mas fácil de quebrar ao "padronizar".

`_request` faz **um** refresh transparente em 401 e repete a chamada uma única vez (`_retry: false` na segunda, `frontend/src/js/store/sync/api-client.js:228-241`). Não há segunda tentativa: falha de refresh sobe como erro. Ver [[refresh-token-rotacao]] e [[autenticacao-jwt]].

## Acesso público

`GET /atlas/public/:link` é a única rota da família sem `auth`, protegida por `publicLinkLimiter` **porque o link é enumerável** (16 bytes hex, `backend/src/modules/atlas/atlas.service.js:453-455`). A busca exige `is_public = true AND deleted_at IS NULL`, logo desativar o link invalida o acesso na hora, sem propagação.

O `publicToken` devolvido é JWT de **1 hora sem refresh**, válido para REST e WebSocket. Sessão pública longa exige reobter o token pelo mesmo endpoint; não há caminho de renovação. Ver [[link-publico]] e [[hardening-borda-api]].

## Import de atlas local

`POST /atlas/import` **preserva os UUIDs de entidade enviados pelo cliente**, enquanto o atlas ganha id novo do servidor (`backend/src/modules/atlas/atlas.service.js:551`). É o que torna o round-trip local↔servidor idempotente do lado das entidades, ver [[dominio-local-vs-remoto]] e [[formato-ebgeo-roundtrip]].

Acoplamento a vigiar: o enum de `feature_type` do schema (`backend/src/modules/atlas/atlas.schemas.js:73-83`) precisa acompanhar o do frontend **e** o CHECK do banco. Os três divergem em silêncio até um import falhar. Ver [[atlas-import-offline]].

## REST com efeito colaborativo

"REST só de metadados" não significa "REST sem efeito em tempo real": `PUT`, `DELETE`, `PATCH /settings`, `transfer`, `duplicate` e todo `/sharing/*` empurram mensagem para a sala do WebSocket (`backend/src/modules/atlas/atlas.controller.js`, `backend/src/modules/sharing/sharing.controller.js`). Quem raciocina sobre convergência precisa olhar os dois canais. Ver [[sintese-rest-vs-websocket]] e [[canal-collab-websocket]].

## Atlas Drive (project-picker)

O seletor de projetos (`frontend/src/js/modals/project-picker.modal.js`, classe `AtlasDrive`) é a única superfície que consome quase toda esta família. Três decisões que não se leem no código:

- Apesar de virar tela cheia, **preserva deliberadamente o contrato antigo do modal** (nome do arquivo, export `showProjectPickerModal`, testids, API `onPick`/`onCreate`) para não quebrar os specs e2e existentes. Os `data-testid` `project-picker-*` são **contrato de teste**: renomear qualquer um quebra e2e.
- As abas são filtros client-side sobre a **mesma** resposta de `GET /atlas` (exceto a Lixeira, com endpoint próprio e carga lazy). Três dos cinco filtros dependem de `user_permission`, que só existe em `LIST_USER_ATLAS`, daí a aba "Públicos" mostrar apenas atlas públicos aos quais você já tem acesso, nunca os demais.
- **Não há thumbnail nem snapshot do mapa** nos cards; a identidade visual é faixa colorida determinística do nome. Decisão de escopo, ver [[sintese-decisoes-arquiteturais]].

Quando o Drive abre no boot e o destino de dado remoto órfão: [[sessao-boot-e-ciclo-de-vida]].

## Fontes

Guias absorvidos *02-atlas-basico* e *07-compartilhamento* (origem das contradições acima). Código: `backend/src/modules/{atlas,sharing,maps}/`, `backend/src/middleware/permissions.js`, `backend/src/database/migrations/002_atlas.sql`; `frontend/src/js/store/sync/api-client.js` e `src/js/modals/{atlas-settings,project-picker}.modal.js`.
