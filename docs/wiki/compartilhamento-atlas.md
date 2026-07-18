# Compartilhamento com Usuários

Concessão nominal de acesso a um atlas gravada em `atlas_shares`, gerida por quem tem `manage`. As rotas e o enum se leem no código; esta página cobre o que ele não conta.

## `owner` não é uma linha da tabela

O `CHECK` de `atlas_shares` só aceita `read|comment|write|manage`; `owner` é sintetizado de `atlas.owner_id` em `resolvePermission()` (`src/middleware/permissions.js:30-48`). Essa ausência é o contrato congelado do qual quase toda armadilha abaixo deriva. Consequência imediata: **remover o dono devolve 404**, porque `DELETE ... RETURNING` não acha linha e vira `NotFoundError('Share')` (`backend/src/modules/sharing/sharing.service.js:51-57`).

> [!CONTRADICAO] O comentário em `backend/src/modules/sharing/sharing.routes.js:11-14` afirma que remover o dono é "a no-op on them". Não é: é 404. O comentário mente sobre o service que ele mesmo monta.

Enviar `permission: 'owner'` no corpo é **400 e não 403**, porque quem barra é o Joi (`backend/src/modules/sharing/sharing.schemas.js:6`), não o gate de permissão. Ver [[permissoes-atlas]], [[atlas-modelo-de-dados]] e [[erros-api]].

## Compartilhar não é privilégio do dono

Todas as rotas exigem `manage`, não `owner`. Um co-Gestor pode conceder até `manage`, ou seja, **criar outros co-Gestores e remover quem o promoveu**. Não há proteção contra auto-rebaixamento nem contra remoção mútua entre gestores; foi aceito assim porque a posse real só muda pela rota de transferência (owner-only), que é o único degrau irreversível. Ver [[atlas-modelo-de-dados]].

> [!CONTRADICAO] O JSDoc do modal (`src/js/modals/sharing.modal.js:15-16` e `735-736`) afirma que "the backend also enforces owner-only on every mutation". O gate real é `manage` (`backend/src/modules/sharing/sharing.routes.js:15-20`). Não use esse JSDoc para decidir quando oferecer o botão.

## Armadilhas de comportamento

**`POST /users` é upsert, não create.** `ON CONFLICT (atlas_id, user_id) DO UPDATE SET permission` (`backend/src/modules/sharing/sharing.queries.js:29`). Reenviar o `POST` para quem já é membro **altera** a permissão e ainda responde 201. Não existe 409, então um duplo clique pode rebaixar silenciosamente um editor para leitor. O modal se protege no cliente (`src/js/modals/sharing.modal.js:699-700`); o servidor não. Não confie nessa guarda ao escrever outro cliente.

**`POST` valida o usuário, `PUT` não.** `addUserShare` checa `is_active = true` antes de inserir (`backend/src/modules/sharing/sharing.service.js:33-37`); `updateUserShare` opera direto na tabela. Desativar um usuário não apaga os shares dele, apenas impede novas concessões.

**`manage` fica acima de `write`.** Um gate escrito como `permission === 'write' || permission === 'owner'` exclui o co-Gestor sem erro visível. Sempre compare por nível (`PERMISSION_LEVELS`, `backend/src/middleware/permissions.js:12-18`). Ver [[permissoes-atlas]].

**Admin global nunca consulta shares.** `requireAtlasPermission` curto-circuita para `'owner'` quando `req.user.role === 'admin'` (`backend/src/middleware/permissions.js:82-87`), antes da consulta a `atlas_shares`; `backend/src/modules/collab/collab.gateway.js:82-85` repete o curto-circuito no WebSocket. Um admin não aparece na lista de membros e não é afetado por nenhuma alteração de share. Ver [[gestao-usuarios]].

**Visitante de link público pula a busca de share** porque o `userId` do token não é UUID (`backend/src/middleware/permissions.js:90-100`). Ver [[link-publico]].

## Leitura e escrita falam dialetos diferentes

`GET /sharing` devolve camelCase (`shares[]` montado por `json_build_object` em SQL, o resto mapeado em `backend/src/modules/sharing/sharing.service.js:12-21`). `POST` e `PUT` devolvem a linha crua da tabela (`RETURNING *`), em snake_case: `atlas_id`, `user_id`, `added_at`.

Por isso **não reaproveite o objeto do `POST` para atualizar a lista em memória**: releia o `GET`, que é o que o modal faz (`src/js/modals/sharing.modal.js:176-183`). O `json_agg ... FILTER (WHERE s.id IS NOT NULL)` existe para devolver `[]` e não `[null]` quando não há shares; preserve o `FILTER` ao mexer na query.

## Re-gate ao vivo: cobre promoção, não remoção

Toda mutação faz `broadcastToRoom(..., 'sharing_updated')`. Em `user_added` e `user_updated` o broadcast carrega `role: toFrontendRole(permission)` justamente para o par conectado se re-gatear sem reconectar (`backend/src/modules/sharing/sharing.controller.js`, `src/utils/roles.js`).

**Buraco conhecido:** `user_removed` não traz `role` e não é tratado em lugar nenhum do frontend (`src/js/store/sync/sync-engine.js:465-472` só reage a `user_added`/`user_updated`). Quem for removido **continua com a UI de edição** até o próximo reconnect ou até um 403. A permissão do WebSocket também é resolvida uma vez, na conexão (`backend/src/modules/collab/collab.gateway.js:86-100`), não a cada frame, então a remoção só morde de fato na próxima sessão ou no próximo push. A segurança fica com o servidor; a UI é cortesia. Ver [[canal-collab-websocket]] e [[sintese-eixos-de-permissao]].

## Busca de usuários: custos escondidos

`GET /api/v1/users/search` exige apenas autenticação, **sem escopo de atlas** (`backend/src/modules/users/users.routes.js:16`). Três consequências que não se veem na rota:

- É `LIKE '%termo%'` sobre quatro colunas, **sem índice funcional e sem paginação**. Não há offset nem `total`/`hasMore`: o 21º resultado é inalcançável e "20 resultados" é indistinguível de "20 de muitos". Refine o termo, é a única saída.
- É superfície de **enumeração de pessoal** para qualquer usuário logado, inclusive fora da própria OM. Ver [[hardening-borda-api]].
- Casar posto e OM é **intencional**, para achar "Cap" ou "CIGEx" (`backend/src/modules/users/users.queries.js:56-59`). Como o `LEFT JOIN` é permissivo, um usuário sem posto ou sem OM volta com esses campos em `null`: renderize com fallback, não assuma string. Ver [[organizacoes-om]].

Ao escolher alguém na busca, o modal concede `read` por decisão explícita: "a permissão padrão abaixa, nunca eleva" (`src/js/modals/sharing.modal.js:47-51`). Preserve isso.

## Efeito na listagem de atlas

`LIST_USER_ATLAS` devolve `user_permission = COALESCE(s.permission, CASE WHEN a.owner_id = $1 THEN 'owner' END)`, e é esse campo que o seletor de projetos usa. A lixeira é deliberadamente diferente: `LIST_DELETED_USER_ATLAS` fixa `'owner'` e filtra por `owner_id` (`backend/src/modules/atlas/atlas.queries.js:49-56`), ou seja, **um membro compartilhado nunca vê nem restaura um atlas na lixeira**, mesmo com `manage`. Ver [[api-rest-atlas]].

Compartilhamento não altera dados sincronizados: o share só governa o gate. As operações seguem o caminho normal ([[fila-operacoes-outbound]], [[modelo-conflito-lww]]).
