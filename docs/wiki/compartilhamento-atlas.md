# Compartilhamento com Usuários

Concessão nominal de acesso a um atlas gravada em `atlas_shares`, gerida por quem tem `manage`. As rotas e o enum se leem no código; esta página cobre o que ele não conta.

## `owner` não é uma linha da tabela

O `CHECK` de `atlas_shares` só aceita `read|comment|write|manage`; `owner` é sintetizado de `atlas.owner_id` em `resolvePermission()` (`backend/src/middleware/permissions.js`). Essa ausência é o contrato congelado do qual quase toda armadilha abaixo deriva. Consequência imediata: **remover o dono devolve 404**, porque `DELETE ... RETURNING` não acha linha e vira `NotFoundError('Share')` (`backend/src/modules/sharing/sharing.service.js`).

**Remover o dono é 404, não no-op.** O comentário de `backend/src/modules/sharing/sharing.routes.js` afirmava "a no-op on them" e foi corrigido em 2026-07-25. A diferença importa para quem escreve cliente: no-op se trata como sucesso, 404 não.

Enviar `permission: 'owner'` no corpo é **400 e não 403**, porque quem barra é o Joi (`backend/src/modules/sharing/sharing.schemas.js`), não o gate de permissão. Ver [[permissoes-atlas]], [[atlas-modelo-de-dados]] e [[erros-api]].

## Compartilhar não é privilégio do dono

Todas as rotas exigem `manage`, não `owner`. Um co-Gestor pode conceder até `manage`, ou seja, **criar outros co-Gestores e remover quem o promoveu**. Não há proteção contra auto-rebaixamento nem contra remoção mútua entre gestores; foi aceito assim porque a posse real só muda pela rota de transferência (owner-only), que é o único degrau irreversível. Ver [[atlas-modelo-de-dados]].

O JSDoc de `frontend/src/js/modals/sharing.modal.js` afirmava, em dois lugares, que "the backend also enforces owner-only on every mutation". O gate real é `manage`, e os dois foram corrigidos em 2026-07-25. O custo do engano era concreto: um chamador que confiasse naquele JSDoc esconderia o botão justamente do co-Gestor, que é para quem o compartilhamento existe.

## Armadilhas de comportamento

**`POST /users` é upsert, não create.** `ON CONFLICT (atlas_id, user_id) DO UPDATE SET permission` (`backend/src/modules/sharing/sharing.queries.js`). Reenviar o `POST` para quem já é membro **altera** a permissão e ainda responde 201. Não existe 409, então um duplo clique pode rebaixar silenciosamente um editor para leitor. O modal se protege no cliente (`frontend/src/js/modals/sharing.modal.js`); o servidor não. Não confie nessa guarda ao escrever outro cliente.

**`added_by` e `added_at` descrevem a concessão original, nunca a atual.** O upsert só atualiza `permission` (`ON CONFLICT ... DO UPDATE SET permission`, `backend/src/modules/sharing/sharing.queries.js`), o `PUT` também não os toca, e a tabela não tem `updated_at` (`backend/src/database/migrations/003_atlas.sql`). Depois que um co-Gestor promove ou rebaixa alguém concedido por outro, o `addedBy` que o `GET` devolve aponta para a pessoa errada. Quem mudou o nível existe, mas só no log de auditoria (`PERMISSION_GRANT` / `PERMISSION_REVOKE` / `SHARING_CHANGE`, emitidos em `backend/src/modules/sharing/sharing.service.js`), nunca na linha da tabela. Não construa tela de governança sobre `addedBy`; ver [[auditoria]].

**`POST` valida o usuário, `PUT` não.** `addUserShare` checa `is_active = true` antes de inserir (`backend/src/modules/sharing/sharing.service.js`); `updateUserShare` opera direto na tabela. Desativar um usuário não apaga os shares dele, apenas impede novas concessões.

**`manage` fica acima de `write`.** Um gate escrito como `permission === 'write' || permission === 'owner'` exclui o co-Gestor sem erro visível. Sempre compare por nível (`PERMISSION_LEVELS`, `backend/src/middleware/permissions.js`). Ver [[permissoes-atlas]].

**Admin global nunca consulta shares.** `requireAtlasPermission` curto-circuita para `'owner'` quando `req.user.role === 'admin'` (`backend/src/middleware/permissions.js`), antes da consulta a `atlas_shares`; `backend/src/modules/collab/collab.gateway.js` repete o curto-circuito no WebSocket. Um admin não aparece na lista de membros e não é afetado por nenhuma alteração de share. Ver [[gestao-usuarios]].

**Visitante de link público pula a busca de share** porque o `userId` do token não é UUID (`backend/src/middleware/permissions.js`). Ver [[link-publico]].

## Leitura e escrita falam dialetos diferentes

`GET /sharing` devolve camelCase (`shares[]` montado por `json_build_object` em SQL, o resto mapeado em `backend/src/modules/sharing/sharing.service.js`). `POST` e `PUT` devolvem a linha crua da tabela (`RETURNING *`), em snake_case: `atlas_id`, `user_id`, `added_at`.

Por isso **não reaproveite o objeto do `POST` para atualizar a lista em memória**: releia o `GET`, que é o que o modal faz (`frontend/src/js/modals/sharing.modal.js`). O `json_agg ... FILTER (WHERE s.id IS NOT NULL)` existe para devolver `[]` e não `[null]` quando não há shares; preserve o `FILTER` ao mexer na query.

## Re-gate ao vivo: cobre promoção, não remoção

Toda mutação faz `broadcastToRoom(..., 'sharing_updated')`. Em `user_added` e `user_updated` o broadcast carrega `role: toFrontendRole(permission)` justamente para o par conectado se re-gatear sem reconectar (`backend/src/modules/sharing/sharing.controller.js`, `backend/src/utils/roles.js`).

**A sala não é a audiência.** Os três frames que NOMEIAM um membro (`user_added`, `user_updated`, `user_removed`) só são entregues a sockets de nível `manage` ou acima, mais os sockets do próprio usuário afetado (`minPermission`/`alsoUserIds` em `backend/src/modules/collab/collab.rooms.js`). É o mesmo dado que `GET /atlas/:id/sharing` gateia em `manage`, e até 2026-07-25 ele ia para a sala inteira: Visualizador, Comentarista, Editor e até o visitante anônimo de link público liam por WebSocket o UUID e o nível de cada membro que o REST lhes negava com 403. A exceção do afetado é o que faz o re-gate acima continuar funcionando para quem está abaixo de `manage`, e é por isso que `{ skipReadOnly: true }` não serve aqui: além de calar o par promovido, ele continuaria entregando a `comment` e a `write`. Os dois frames `public_*` seguem abertos à sala porque não carregam identidade nenhuma.

**Buraco conhecido, e é maior que uma ação.** O controller emite `sharing_updated` com **cinco** `action` distintas (`public_enabled`, `public_disabled`, `user_added`, `user_updated`, `user_removed`, `backend/src/modules/sharing/sharing.controller.js`) e o único consumidor de todo o frontend descarta tudo que não seja `user_added`/`user_updated` **do próprio `userId`** (`frontend/src/js/store/sync/sync-engine.js`). Duas consequências:

- Quem for removido **continua com a UI de edição**, porque nada no cliente reage ao próprio despejo. A segurança fica com o servidor; a UI é cortesia.
- Publicar ou despublicar não atualiza par nenhum. Como `enablePublicSharing` **rotaciona** o link ([[link-publico]]), um segundo co-Gestor com o modal aberto fica olhando para um link já morto até reabrir o modal.

Quem corta não é o reconnect: `reconcileAuthorization` roda em toda batida de heartbeat (~30s, `backend/src/modules/collab/collab.gateway.js`), rechama a mesma `resolvePermission` e, sem permissão sobrando, fecha o socket com `ws.close(4003, 'access revoked')` (`backend/src/modules/collab/collab.gateway.js`). O caso em que a UI de edição realmente sobrevive é o **atlas público**: ali a resolução cai para `read` em vez de `null`, então o socket é só rebaixado (`backend/src/modules/collab/collab.gateway.js`) e o usuário segue editando na tela até o próximo push tomar 403. Ver [[canal-collab-websocket]] e [[sintese-eixos-de-permissao]].

> Até 2026-07-25 esta seção afirmava o oposto, que a permissão do WS "é resolvida uma vez, na conexão, não a cada frame, então a remoção só morde na próxima sessão". A citação que a sustentava resolvia, e era a resolução do handshake; a conclusão tirada dela é que era falsa, porque a mesma função é rechamada pelo sweep. Quatro páginas irmãs já descreviam o comportamento certo ([[permissoes-atlas]], [[sintese-eixos-de-permissao]], [[link-publico]], [[atlas-modelo-de-dados]]): a lição é que citação verdadeira não valida a frase que a acompanha.

## Busca de usuários: custos escondidos

`GET /api/v1/users/search` exige apenas autenticação, **sem escopo de atlas** (`backend/src/modules/users/users.routes.js`). Três consequências que não se veem na rota:

- É `LIKE '%termo%'` sobre quatro colunas, **sem índice funcional e sem paginação**. Não há offset nem `total`/`hasMore`: o 21º resultado é inalcançável e "20 resultados" é indistinguível de "20 de muitos". Refine o termo, é a única saída.
- É superfície de **enumeração de pessoal** para qualquer usuário logado, inclusive fora da própria OM. Ver [[hardening-borda-api]].
- Casar posto e OM é **intencional**, para achar "Cap" ou "CIGEx" (`backend/src/modules/users/users.queries.js`). Como o `LEFT JOIN` é permissivo, um usuário sem posto ou sem OM volta com esses campos em `null`: renderize com fallback, não assuma string. Ver [[organizacoes-om]].

Ao escolher alguém na busca, o modal concede `read` por decisão explícita: "a permissão padrão abaixa, nunca eleva" (`frontend/src/js/modals/sharing.modal.js`). Preserve isso.

## Efeito na listagem de atlas

`LIST_USER_ATLAS` devolve `user_permission = COALESCE(s.permission, CASE WHEN a.owner_id = $1 THEN 'owner' END)`, e é esse campo que o seletor de projetos usa. A lixeira é deliberadamente diferente: `LIST_DELETED_USER_ATLAS` fixa `'owner'` e filtra por `owner_id` (`backend/src/modules/atlas/atlas.queries.js`), ou seja, **um membro compartilhado nunca vê nem restaura um atlas na lixeira**, mesmo com `manage`. Ver [[api-rest-atlas]].

Compartilhamento não altera dados sincronizados: o share só governa o gate. As operações seguem o caminho normal ([[fila-operacoes-outbound]], [[modelo-conflito-lww]]).
