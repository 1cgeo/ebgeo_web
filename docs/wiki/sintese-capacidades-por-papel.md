# Síntese: capacidades por papel

Onde os gates de papel enganam: `manage` fica acima de `write` e some de listas literais, o push é gateado em `comment` e não em `write`, a tabela de capacidades do cliente é mais permissiva que o backend, e o papel só vale para atlas remoto conectado.

A grade de quem pode o quê se lê direto: `grep -n requireAtlasPermission` nas rotas e, para o filtro por operação, `assertOperationAllowed` com `operationDenialReason` ao lado (`backend/src/modules/sync/sync.service.js`). Esta página só cobre o que essa leitura não entrega.

## Dois vocabulários, e só um serve para gatear UI

O backend decide com **permissão** (`read | comment | write | manage`, mais `owner` sintetizado de `atlas.owner_id`); o frontend raciocina com **papel** (`viewer | commenter | editor | manager | owner | admin`). O payload `connected` carrega **os dois** campos, lado a lado no `ws.send` do handshake (`backend/src/modules/collab/collab.gateway.js`): `permission` é o campo congelado do backend, `role` é a tradução por `toFrontendRole`.

Gateie UI por `role`. Gatear por `permission` é o bug clássico, porque `manage` é **mais alto** que `write` e não bate em nenhum item de uma lista como `['write','owner']`, excluindo o co-Gestor em silêncio. O guia *02-atlas-basico* (absorvido) sugeria exatamente `['write','owner'].includes(msg.permission)` e amarrava settings e compartilhar a `isOwner`, o que é duplamente errado: compartilhamento e settings são `manage`, não owner-only (`backend/src/modules/sharing/sharing.routes.js`, `backend/src/modules/atlas/atlas.routes.js`). O cliente real acerta (`frontend/src/js/account/account.control.js`). Regra: hierarquia numérica ou `>=`, nunca igualdade em lista. Ver [[permissoes-atlas]] e [[sintese-eixos-de-permissao]].

## A armadilha do push gateado em `comment`

A rota de push exige `comment`, não `write` (`backend/src/modules/sync/sync.routes.js`). Quem gatear o cliente em `write` para todo push quebra o Comentarista silenciosamente. O filtro fino é por operação: `permission === 'comment' && op.target !== 'comment'` lança `ForbiddenError` (`assertOperationAllowed`, `backend/src/modules/sync/sync.service.js`). Ou seja, o Comentarista **passa pela rota** e é barrado por op. Não confunda "não pode push" com "não pode falar". Ver [[comentario-espacial]] e [[fila-operacoes-outbound]].

Assimetria irmã, na presença: **broadcast da própria seleção é editor-and-above**. Visualizador e Comentarista **recebem** seleção de terceiros e nunca emitem a sua (`handleSelection`, `backend/src/modules/collab/collab.handlers.js`). Cursor e estado temporal ficam ungated de propósito, então "recebe presença" não implica "emite presença". Ver [[presenca-colaborativa]].

Dentro do comentário há um segundo gate, de **autoria**, invisível fora do SQL: update e delete só passam com `($isEditor OR author_id = $userId)` (`applyCommentOp`, `backend/src/modules/sync/sync.service.js`). O delete de raiz cascateia para as respostas **independentemente do autor delas**: apagar a thread apaga a thread.

## Divergências cliente/backend que produzem 403 tardio

A tabela `ROLE_PERMISSIONS` (`frontend/src/js/store/sync/session-context.js`) não espelha o backend. Duas folgas conhecidas:

1. **`canLockMaps` do `manager` é folgado demais.** `manager` compartilha `FULL_PERMISSIONS`, logo `canLockMaps: true`, mas o backend só aceita lock do `owner` (`operationDenialReason`, `backend/src/modules/sync/sync.service.js`). Quem realmente decide na UI é `LOCK_CAPABLE_ROLES = [OWNER, ADMIN]` (`frontend/src/js/locking/map-lock.controller.js`). **Não use `canLockMaps` como fonte de verdade.**
2. **`editor` tem `canDelete: true`**, e `DELETE_MAP → canDelete` (`frontend/src/js/store/sync/permission-guard.js`). Apagar mapa é `manage` para cima no servidor, então um Editor enfileira o delete localmente e ele volta **recusado por política**, não com 403 do lote: a op é ackada como rejeitada e o cliente a descarta da fila. O desenho é deliberado, e a alternativa foi rejeitada por causa real: lançar dali rolava a transação inteira, o cliente só re-enfileira em resposta não-2xx, e um único delete recusado congelava a sincronização daquele usuário para sempre. Ver [[fila-operacoes-outbound]] e [[erros-api]].

Travar mapa tem efeito colateral que não aparece no gate de papel: com o mapa travado, ops sobre `feature/group/layer/cesium3d/streetview360/catalog_layer/group_feature` levam `ConflictError` "Map is locked" (`LOCKABLE_CHILD_TARGETS`, `backend/src/modules/sync/sync.service.js`), **independente de papel**; só o dono destrava. Ver [[modelo-conflito-lww]] e [[tipos-entidade-sync]].

## O gate só existe para atlas remoto conectado

`checkPermission` retorna `{ allowed: true }` quando offline **ou** quando o store não é remoto (`frontend/src/js/store/sync/permission-guard.js`). Estar logado como `viewer` não impede desenhar no store local, senão o usuário não conseguiria trabalhar no próprio workspace. Ver [[dominio-local-vs-remoto]] e [[modos-operacao]].

Corolário fácil de esquecer: **clonar exige apenas `read`** (`backend/src/modules/atlas/atlas.routes.js`). Qualquer Visualizador leva uma cópia da qual se torna dono. É decisão de produto, não descuido. Ver [[clone-atlas]].

## Quando o papel é fixado, re-fixado e revogado

O papel que a sessão recebe no login é o `org_role` do usuário (`frontend/src/js/store/sync/session-context.js`), não o do atlas e **não** o papel global do backend, que viaja à parte em `_globalRole`. A confusão de nome é do cliente e vale conhecer: `org_role` não autoriza nada no servidor desde 2026-08-17 ([[sintese-eixos-de-permissao]]), aqui ele é só o default de UI até o `connected` chegar. O papel por atlas só se resolve no `connect`, e ali há uma antecipação deliberada: se o `ownerId` do snapshot bate com o `userId`, o papel sobe para `owner` **antes** do handshake WS (`frontend/src/js/store/sync/sync-engine.js`), para que os botões de Gestor apareçam já no F5 sem esperar o socket. O `connected` confirma depois via `payload.role`.

Transferência de posse ao vivo não exige reconexão: `atlas_owner_changed` chama `updateRole('manager')` no ex-dono. Use `updateRole`, nunca `setSession`, para trocar papel de sessão viva: `updateRole` preserva `userId`/`username` (`frontend/src/js/store/sync/session-context.js`), `setSession` os substitui.

Revogação também não espera reconexão: o gateway **re-resolve a permissão a cada heartbeat** e reescreve `ws.permission` quando ela mudou (`reconcileAuthorization`, `backend/src/modules/collab/collab.gateway.js`). O socket vive horas; sem isso um usuário rebaixado continuaria escrevendo até cair a conexão. Ver [[canal-collab-websocket]] e [[sessao-boot-e-ciclo-de-vida]].

## Acesso público: portador de `read`, não papel novo

O link público não cria papel, cria portador de `read` (`backend/src/modules/atlas/atlas.routes.js`), com `publicToken` de 1 hora. Duas sutilezas que atravessam arquivos:

- O lookup de share é **pulado quando o `userId` não é UUID** (guarda `UUID_RE`, `backend/src/middleware/permissions.js`), que é o caso do `sub` do visitante; a resolução cai para `is_public → read`. Um visitante nunca herda share de ninguém, por construção.
- `connectPublic` chama `disableOperationLogging()`, e um `connect` autenticado posterior **precisa reabilitar explicitamente** (`enableOperationLogging()`, `frontend/src/js/store/sync/sync-engine.js`). Sem isso o usuário logado depois de visitar um link público editaria sem enfileirar nada.

No cliente, `setVisitorSession()` (`frontend/src/js/store/sync/session-context.js`) deixa `isAuthenticated()` em `false` (sem menu de conta) mas ONLINE com papel `viewer`, então o guard bloqueia a edição. Ver [[link-publico]] e [[auth-flexivel]].

Admin global curto-circuita tudo: vira `admin` na tradução (`toFrontendRole`, `backend/src/utils/roles.js`) e recebe `req.atlasPermission = 'owner'` em qualquer atlas (`backend/src/middleware/permissions.js`). Ver [[sync-admin-operacoes]] e [[gestao-usuarios]].
