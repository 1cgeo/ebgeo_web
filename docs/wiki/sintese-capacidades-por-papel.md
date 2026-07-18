# Síntese: capacidades por papel

Cruzamento da matriz de permissões com o acesso público mostrando onde cada papel realmente muda de comportamento, `comment` separa comentário espacial de push de operações, `write` habilita broadcast de seleção e upload, `manage` governa compartilhamento e settings, e `owner` concentra travar/deletar mapa, transferir posse e deletar atlas.

## Os dois vocabulários (e por que eles não são o mesmo)

O backend armazena e decide com **permissão por atlas** (`read | comment | write | manage`, mais `owner` sintetizado de `atlas.owner_id`). O frontend raciocina com **papel** (`viewer | commenter | editor | manager | owner | admin`). A tradução é única e vive em `ebgeo_backend/src/utils/roles.js:12`:

| permissão (DB/API) | papel (frontend) |
|---|---|
| `owner` (sintetizado) | `owner` |
| `manage` | `manager` |
| `write` | `editor` |
| `comment` | `commenter` |
| `read`, público, nenhuma | `viewer` |

`globalRole === 'admin'` **curto-circuita tudo** e vira `admin` (`roles.js:13`), e no gate REST um admin global recebe `req.atlasPermission = 'owner'` em qualquer atlas (`middleware/permissions.js:82-87`). Detalhe do eixo em [[permissoes-atlas]] e [[sintese-eixos-de-permissao]].

Hierarquia numérica canônica, `read:1 < comment:2 < write:3 < manage:4 < owner:5` (`middleware/permissions.js:12-18`). Resolução em `resolvePermission` (`permissions.js:30-48`): dono, depois `atlas_shares`, depois `is_public → read`, senão `null` (403). Atlas inexistente ou soft-deletado dá 404.

## Onde cada degrau realmente muda o comportamento

Só quatro degraus alteram capacidade de fato. Vale memorizar por degrau, não por papel:

**`read` → `comment`: destrava o push, mas só de comentário.** A rota de push é gateada em `comment`, não em `write` (`modules/sync/sync.routes.js`, `router.post('/', auth, requireAtlasPermission('comment'), ...)`). O filtro fino é por operação em `assertOperationAllowed` (`modules/sync/sync.service.js:600-620`): `permission === 'comment' && op.target !== 'comment'` lança `ForbiddenError`. Ou seja, um Comentarista **passa pela rota** e é barrado por op. Quem gatear o cliente em `write` para todo push quebra o Comentarista silenciosamente. Ver [[comentario-espacial]] e [[fila-operacoes-outbound]].

Ainda dentro de comentário há um segundo gate, de **autoria**: `isEditor = permission === 'write' || 'manage' || 'owner'` (`sync.service.js:1224`); update e delete de comentário só passam com `($isEditor OR author_id = $userId)` no próprio SQL (`sync.service.js:1256`, `1270`). Um Comentarista edita apenas os próprios; o delete de raiz cascateia para as respostas independentemente do autor delas.

**`comment` → `write`: destrava operações de entidade, upload de imagem e broadcast de seleção.**
- Operações não-comentário passam em `assertOperationAllowed` (`sync.service.js:600-620`).
- Upload/delete de imagem: `requireAtlasPermission('write')` (`modules/images/images.routes.js`); listagem e GET ficam em `read`. Ver [[imagens-atlas]] e [[upload-imagens-seguranca]].
- `PUT /atlas/:atlasId` (nome, descrição, `map_order`) exige `write` (`modules/atlas/atlas.routes.js:27`), assim como `POST /:atlasId/maps/:mapId/duplicate` (`atlas.routes.js:44`).
- **Broadcast da própria seleção** é editor-and-above: `handleSelection` retorna cedo para `read` e `comment` (`modules/collab/collab.handlers.js:83-85`). Visualizador e Comentarista **recebem** seleção de terceiros mas nunca emitem a sua. Cursor e estado temporal ficam ungated de propósito. Ver [[presenca-colaborativa]] e [[presenca-colaborativa]].

**`write` → `manage`: governança do atlas.** Todo o módulo de compartilhamento é `manage`, não owner-only: `GET /sharing`, `POST/DELETE /sharing/public`, `POST /sharing/users`, `PUT|DELETE /sharing/users/:userId` (`modules/sharing/sharing.routes.js:15-20`). E `PATCH /atlas/:atlasId/settings` também é `manage` (`atlas.routes.js:35`), enquanto o `GET` correspondente é `read` (`atlas.routes.js:34`). Ver [[compartilhamento-atlas]], [[link-publico]] e [[atlas-settings]].

**`manage` → `owner`: os quatro atos irreversíveis.**
- `DELETE /atlas/:atlasId` (soft-delete) exige `owner` (`atlas.routes.js:28`).
- `POST /atlas/:atlasId/transfer` exige `owner`; o ex-dono é rebaixado para `manage` (`atlas.routes.js:37-38`).
- **Deletar mapa** e **travar/destravar mapa** são owner-only no nível da operação, não da rota: `sync.service.js:611` (`op.type === 'delete'` em `target === 'map'`) e `sync.service.js:614-618` (update de `map` cujo merge de `changes`/`data` contém `locked !== undefined`). Ver [[modelo-conflito-lww]] e [[tipos-entidade-sync]].

Clonar é o outlier na direção oposta: `POST /:atlasId/clone` exige apenas `read` (`atlas.routes.js:41`), então qualquer Visualizador leva uma cópia da qual se torna dono. Ver [[clone-atlas]].

## A armadilha do `manage` acima do `write`

`manage` é **mais alto** que `write` na hierarquia. Qualquer gate escrito como `permission === 'write' || permission === 'owner'` exclui o co-Gestor em silêncio, porque `manage` não bate em nenhum dos dois. O snippet de exemplo do próprio guia comete isso.

> [!CONTRADICAO 2026-07-18] guia *02-atlas-basico* (absorvido):420-427` sugere no frontend `const canEdit = ['write','owner'].includes(msg.permission)` e amarra settings e botão de compartilhar a `isOwner`. Isso está errado por dois motivos no código real: (a) exclui `manage`, que é justamente quem pode configurar e compartilhar (`sharing.routes.js:15-20`, `atlas.routes.js:35`); (b) o payload `connected` carrega **dois** campos, `permission` (congelado, vocabulário do backend) e `role` (vocabulário do frontend), `collab.gateway.js:344-352`. O cliente real gateia por `role`, não por `permission`, veja `src/js/account/account.control.js:415` e `:451` (`role === 'owner' || 'manager' || 'admin'`).

Contrato do handshake em [[canal-collab-websocket]] e [[canal-collab-websocket]].

## Como o cliente aplica isso

O frontend colapsa permissão em cinco capacidades booleanas por papel, em `src/js/store/sync/session-context.js:60-85`: `canEdit`, `canDelete`, `canComment`, `canManageUsers`, `canLockMaps`. `owner`, `admin` e `manager` compartilham `FULL_PERMISSIONS` (`session-context.js:47-54`); `editor` perde `canManageUsers` e `canLockMaps`; `commenter` fica só com `canComment`; `viewer` com nada.

O gate coarse é `checkPermission` (`src/js/store/sync/permission-guard.js:66-85`), e a regra que mais confunde está em `permission-guard.js:71`:

```js
if (sessionContext.isOffline() || !isRemoteStoreSync()) return { allowed: true };
```

O papel **só** vale para um atlas remoto conectado. Estar logado como `viewer` não impede desenhar no store local, senão o usuário não conseguiria trabalhar no próprio workspace. Ver [[dominio-local-vs-remoto]] e [[dominio-local-vs-remoto]].

Duas divergências de granularidade que valem atenção prática:

1. `GuardAction.LOCK_MAP → canLockMaps` (`permission-guard.js:31`) e `manager` tem `canLockMaps: true` (`session-context.js:63`), mas o backend só aceita lock do `owner` (`sync.service.js:616`). Na prática quem decide na UI é `LOCK_CAPABLE_ROLES = [OWNER, ADMIN]` (`src/js/locking/map-lock.controller.js:39`, usado em `:75`), que bate com o backend. A tabela de capacidades é permissiva demais nesse ponto; não use `canLockMaps` como fonte de verdade.
2. `GuardAction.DELETE_MAP → canDelete` (`permission-guard.js:30`) e `editor` tem `canDelete: true`. Um Editor consegue enfileirar o delete de mapa localmente e só toma 403 no flush (`sync.service.js:611`). Confira o comportamento de fila e retry em [[fila-operacoes-outbound]] e [[erros-api]].

`isReadOnly()` (`map-lock.controller.js:87-89`) trata `viewer` e `commenter` como somente-leitura no mapa remoto: o cadeado aparece travado e não é alternável.

## Acesso público, o sexto caso

O link público não cria um papel novo, cria um portador de `read`. `GET /api/v1/atlas/public/:link` (sem auth, com `publicLinkLimiter`, `atlas.routes.js:23`) devolve o atlas mais um `publicToken`, JWT de 1 hora com `permission: 'read'`, `isPublic: true` e nome "Visitante". Com ele o visitante faz pull, conecta o WebSocket, recebe atualizações em tempo real e vê cursores de terceiros, mas não emite seleção (`collab.handlers.js:83`) nem faz push (`sync.service.js:602`).

No cliente isso é uma sessão distinta e deliberada: `setVisitorSession()` (`src/js/store/sync/session-context.js:264-273`) coloca o modo em ONLINE com papel `viewer` e `_isVisitor = true`, de forma que `isAuthenticated()` continua `false` (não há menu de conta) enquanto o guard bloqueia edição do atlas remoto conectado. O `connectPublic` desabilita o logging de operações, e um `connect` autenticado posterior precisa reabilitá-lo explicitamente (`src/js/store/sync/sync-engine.js`, `enableOperationLogging()` no `connect`). Detalhes em [[link-publico]] e [[auth-flexivel]].

Cuidado com o lookup de share para token público: ele é pulado quando o `userId` não é UUID (`middleware/permissions.js:92`), o que é o caso do `sub` gerado do visitante. A resolução cai então em `is_public → read`.

## Momento em que o papel é fixado (e re-fixado)

O papel do login é o **global** (`org_role`), não o do atlas: `sync-engine.js:126` faz `role: user.org_role || 'viewer'`. O papel por atlas só se resolve no `connect`, em duas etapas:

1. Se o `ownerId` do snapshot bate com o `userId`, o papel sobe para `owner` **antes** do handshake WS, para que os botões de Gestor apareçam já no F5 sem esperar o socket (`sync-engine.js`, bloco `const ownerId = snapshot?.atlas?.sync?.ownerId`).
2. O payload `connected` confirma e resolve os demais papéis (`manager`/`editor`/`commenter`/`viewer`) via `payload.role`.

Transferência de posse ao vivo não exige reconexão: `atlas_owner_changed` chama `sessionContext.updateRole('manager')` no ex-dono (`sync-engine.js:447`), preservando identidade (`updateRole` em `session-context.js:298-302` não zera `userId`/`username`, ao contrário de `setSession`). Ciclo completo em [[sessao-boot-e-ciclo-de-vida]] e [[autenticacao-jwt]].

## Matriz consolidada

| Ação | read | comment | write | manage | owner | fonte |
|---|:--:|:--:|:--:|:--:|:--:|---|
| Ver atlas, pull, conectar WS, ver presença | sim | sim | sim | sim | sim | `atlas.routes.js:26`, `sync.routes.js` |
| Clonar atlas | sim | sim | sim | sim | sim | `atlas.routes.js:41` |
| Comentário espacial (próprio) | não | sim | sim | sim | sim | `sync.service.js:606`, `:1224` |
| Editar/apagar comentário de terceiros | não | não | sim | sim | sim | `sync.service.js:1224` |
| Push de operação não-comentário | não | não | sim | sim | sim | `sync.service.js:606` |
| Broadcast da própria seleção | não | não | sim | sim | sim | `collab.handlers.js:83` |
| Upload de imagem | não | não | sim | sim | sim | `images.routes.js` |
| Atualizar atlas (nome, `map_order`) | não | não | sim | sim | sim | `atlas.routes.js:27` |
| Compartilhar, link público | não | não | não | sim | sim | `sharing.routes.js:15-20` |
| Alterar settings do atlas | não | não | não | sim | sim | `atlas.routes.js:35` |
| Travar/destravar mapa, deletar mapa | não | não | não | não | sim | `sync.service.js:611`, `:616` |
| Transferir posse, deletar atlas | não | não | não | não | sim | `atlas.routes.js:28`, `:38` |

Admin global lê essa tabela inteira como `owner` (`permissions.js:82-87`). Ver [[sync-admin-operacoes]] e [[gestao-usuarios]].

## Regras práticas para não errar

- Gateie por hierarquia numérica ou por `>=`, nunca por igualdade em lista. `['write','owner']` é o bug clássico.
- Nunca use `permission` do handshake para decidir UI: use `role`; os dois campos existem e significam vocabulários diferentes (`collab.gateway.js:344-352`).
- Não trate "não pode push" como "não pode falar": `comment` empurra operações de comentário pela mesma rota de sync.
- Não trate a tabela de capacidades do frontend como espelho do backend: `canLockMaps` do `manager` é folgado demais, o backend exige `owner`.
- Lembre que travar mapa também **bloqueia filhos**: com o mapa travado, ops sobre feature/group/layer/cesium3d/streetview360/catalog_layer/group_feature levam `ConflictError` "Map is locked" (`sync.service.js:586-588` e o guard em `applyOperation`), independente de papel; só o dono destrava.
- O gate de papel só vale para atlas remoto conectado; localmente todo mundo é dono ([[modos-operacao]]).

## Fontes

- guia *02-atlas-basico* (absorvido): hierarquia `owner > manage > write > comment > read`, algoritmo de resolução de permissão, matriz de permissões por ação, aviso sobre `manage` acima de `write`, e o snippet de frontend que contradiz o código.
- guia *07-compartilhamento* (absorvido): rotas de compartilhamento e link público com permissão `manage`, formato e validade do `publicToken` (1h, read-only, "Visitante"), tabela de limitações do acesso público, fluxo completo do usuário público.
- `ebgeo_backend/src/middleware/permissions.js`, `src/utils/roles.js`, `src/modules/{atlas,sharing,sync,images,collab}/…`: gates reais por rota e por operação, curto-circuito do admin global, mapeamento permissão→papel.
- `ebgeo_web/src/js/store/sync/{permission-guard,session-context,sync-engine}.js`, `src/js/locking/map-lock.controller.js`, `src/js/account/account.control.js`: capacidades booleanas do cliente, escopo local vs remoto do gate, visibilidade dos botões de Gestor.
