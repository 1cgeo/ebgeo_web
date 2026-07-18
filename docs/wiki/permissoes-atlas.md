# Permissões e Papéis por Atlas

Dois vocabulários ortogonais convivem, o tier `permission` por atlas do backend (`read < comment < write < manage < owner`), que é quem realmente autoriza escrita, e o `role` de identidade do frontend (`owner/admin/manager/editor/commenter/viewer`), que apenas rotula e alimenta as flags de UI; somem-se a eles um terceiro eixo, o papel global da conta.

## Os dois vocabulários

**Tier de permissão do atlas** (backend, modelo de acesso persistido). Níveis numéricos em `src/middleware/permissions.js:12-18`:

```
read (1) < comment (2) < write (3) < manage (4) < owner (5)
```

Vive em `atlas_shares.permission ∈ {read, comment, write, manage}`; `owner` **nunca** aparece nessa tabela, é sintetizado de `atlas.owner_id` (`permissions.js:29-47`, comentário em `src/utils/roles.js:4-5`; guia *arquitetura-sync* (absorvido):290). É o que a rota REST e o upgrade do WebSocket resolvem.

**Papéis de identidade** (frontend, `session-context.js:29-36`): `owner, admin, manager, editor, commenter, viewer`. Cada um mapeia para um conjunto fixo de capacidades em `ROLE_PERMISSIONS` (`session-context.js:60-85`):

| Papel (token) | canEdit | canDelete | canComment | canManageUsers | canLockMaps |
|---|:-:|:-:|:-:|:-:|:-:|
| `owner` / `admin` / `manager` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `editor` | ✓ | ✓ | ✓ | — | — |
| `commenter` | — | — | ✓ | — | — |
| `viewer` | — | — | — | — | — |

Regra prática: **`permission` decide, `role` rotula.** O eixo `role` existe porque a UI precisa de rótulos que misturam duas dimensões que o backend guarda separadas, a permissão naquele atlas e o papel global do usuário. Um admin global não tem linha em `atlas_shares`, mas precisa ver "Admin do sistema" e ganhar acesso total. Não invente um terceiro vocabulário nem mapeie um no outro fora de `toFrontendRole`. Matriz consolidada em [[sintese-capacidades-por-papel]] e [[sintese-eixos-de-permissao]].

### A derivação de `role`

Única fonte, `src/utils/roles.js:12-19`, entregue no payload `connected` do WebSocket; o cliente apenas o aplica (`sync-engine.js:189-198`):

| Entrada | `role` emitido |
|---|---|
| `globalRole === 'admin'` (curto-circuito, antes de tudo) | `admin` |
| `permission = owner` | `owner` |
| `permission = manage` | `manager` |
| `permission = write` | `editor` |
| `permission = comment` | `commenter` |
| `permission = read`, público, ou nenhum | `viewer` |

A função é total e fail-closed: qualquer entrada não reconhecida cai em `viewer`. Bom padrão, mas um `permission` novo e desconhecido vira `viewer` silenciosamente em vez de estourar.

O frontend **não guarda `connected.permission`**: lê apenas `payload.role` e o injeta em `sessionContext.setSession({ role })` (`sync-engine.js:192-198`); daí `ROLE_PERMISSIONS` deriva as flags booleanas que o `permission-guard.js` consulta.

> **Nota histórica.** guia *04-websocket-collab* (absorvido):126-128` diz "Para autorizar escrita no cliente, cheque `permission !== 'read'` (não o `role`)"; o cliente real ignora `permission` por completo e gateia por `role` (`sync-engine.js:192-198` + `session-context.js:60-85`).

Os dois caminhos concordam no caso comum (`viewer` ⇒ `canEdit: false`), e o gate por `role` é até mais fino, porque distingue `commenter` e separa `editor` de `manager`/`owner` em `canManageUsers`/`canLockMaps`, espelhando `assertOperationAllowed`. Ainda assim, para um cliente novo, o campo congelado e canônico é `permission`; `role` é aditivo e pode divergir se alguém alterar `toFrontendRole` sem atualizar as duas pontas.

> **Nota histórica.** guia *visao-e-principios* (absorvido):353 diz que o admin global tem token de frontend `sysadmin`; o código não tem esse valor em lugar nenhum, `UserRole.ADMIN = 'admin'` (`session-context.js:31`) e o bit global é lido de `_globalRole` por `isAdmin()` (`session-context.js:162-164`).

## Terceiro eixo: papel global da conta

`users.role ∈ {user, admin}` é **independente** do tier por atlas. No login, `sync-engine.js:122-129` faz:

- `role: user.org_role || 'viewer'` (papel por organização, valores `owner|admin|editor|viewer`, guia *arquitetura-sync* (absorvido):287)
- `globalRole: user.role || 'user'`

`globalRole` é preservado quando `setSession` é chamado sem ele (`session-context.js:247-249`), justamente para que o `connect` por atlas não apague o bit de admin. `isAdmin()` gateia o painel administrativo ([[gestao-usuarios]]), não o direito de editar o atlas. **Armadilha:** `sessionContext.role` logo após o login é o `org_role`, não o papel do atlas; ele só vira o papel real do atlas depois do `connected` do WebSocket. Ver [[organizacoes-om]].

## Onde cada gate acontece

São camadas independentes, e nenhuma substitui a outra.

1. **Gate de rota / handshake (backend).** `requireAtlasPermission(level)` resolve em cascata (`resolvePermission`, `permissions.js:29-47`): dono ou admin global → `owner`; senão `atlas_shares.permission`; senão `atlas.is_public` → `read`; senão 403. Atlas inexistente/deletado → 404 (guia *02-atlas-basico* (absorvido):382-388). No WebSocket, sem permissão de leitura o upgrade é rejeitado com `403` (`collab.gateway.js:52-107`). O push de sync exige **`comment`**, não `write`, para que Comentaristas consigam chegar; o pull exige `read` (guia *arquitetura-sync* (absorvido):324). Ver [[api-rest-atlas]] e [[erros-api]].
2. **Gate grosso por handler (backend, collab).** `handleOperation` recusa `permission === 'read'` com `error`/`FORBIDDEN` (`collab.handlers.js:115-121`); `handleSelection` ignora `read` **e** `comment` (`collab.handlers.js:83-85`), então comentarista não emite seleção para os peers.
3. **Checagem fina por operação (backend).** `assertOperationAllowed(op, permission)` (`sync.service.js:600-620`) roda dentro do loop de `pushOperations` (`sync.service.js:660`), valendo igual para push via WS e via REST (guia *arquitetura-sync* (absorvido):193): `read` nunca escreve; um tier `comment` só escreve ops de `target === 'comment'`; `write`/`manage`/`owner` escrevem qualquer entidade; **delete de mapa e o `update` que mexe em `locked` são exclusivos do `owner`** (guia *05-sync-crdt* (absorvido):507-509). É por isso que o gate de rota permissivo (`comment`) não vaza escrita: quem barra é essa checagem. Ver [[envelope-operacao]] e [[tabela-operations]].
4. **Gate de papel no cliente (`permission-guard.js`).** Puramente UX/antecipação, o servidor é a garantia real.

Na saída, o broadcast também respeita o eixo: `broadcastOperations` **nunca entrega ops de `comment` a conexões `read`**, e divide um lote misto para que o cliente `read` ainda receba as ops não-comentário (`collab.rooms.js:83-115`).

## Revalidação em socket vivo

`permission` é resolvido no handshake, mas um socket vive horas. `reconcileAuthorization` roda a cada tick de heartbeat (`collab.gateway.js:115-140`, guia *arquitetura-sync* (absorvido):324, 440): share revogado, atlas despublicado ou organização desativada fecham o socket com `4003` (close limpo, o peer some na hora em vez de ficar `away`); um rebaixamento (`write`→`read`) apenas atualiza `ws.permission`, e a próxima escrita é recusada pelos handlers. Não existe frame de "sua permissão mudou" no eixo `permission`; quem avisa a UI é o `sharing_updated`, no eixo `role`.

No cliente, `updateRole(role)` (`session-context.js:297-302`) troca papel e capacidades **preservando identidade**, ao contrário de `setSession`, que zeraria `userId`/`username`. É o caminho de `atlas_owner_changed` e de um rebaixamento engatarem o modo seguro sem reconectar. Ver [[canal-collab-websocket]] e [[canal-collab-websocket]].

## `permission-guard.js`: só vale para atlas remoto conectado

```javascript
if (sessionContext.isOffline() || !isRemoteStoreSync()) {
    return { allowed: true };
}
```
(`store/sync/permission-guard.js:70-72`)

Essa é a linha mais importante do arquivo. O papel **não** gateia o store local, mesmo logado. Sem ela, um usuário autenticado cujo `org_role` é `viewer` não conseguiria desenhar no próprio espaço local. O discriminante é o marcador de origem do store (`isRemoteStoreSync()`, `store-origin.js`), não namespacing por atlas, ver [[dominio-local-vs-remoto]], [[dominio-local-vs-remoto]] e [[modos-operacao]].

`GuardAction` (`permission-guard.js:18-58`) mapeia ~25 ações CRUD para 5 capacidades. Pontos que costumam surpreender:

- `CREATE_COMMENT`/`UPDATE_COMMENT`/`DELETE_COMMENT` → `COMMENT`, capacidade grossa. A regra fina "autor ou Editor+" para editar/apagar um comentário específico vive nas operações de comentário e no backend, não aqui (`permission-guard.js:38-41`). Ver [[comentario-espacial]].
- `LOCK_MAP` → `LOCK_MAPS`, capacidade que só `owner`/`manager`/`admin` têm. Um `editor` **não** trava mapa.
- `CLEAR_ALL_DATA` → `DELETE`, ou seja, um Comentarista não limpa o store remoto.

O guard falha **suave**: as store ops chamam `checkPermission`, e ao negar emitem `STORE_OPERATION_BLOCKED` e retornam (por exemplo `map.operations.js:852-856`), em vez de lançar. `assertPermission` (lança `PermissionError`) existe mas não tem call site em `src/js` fora do barrel `sync/index.js:131`.

## Efeitos de papel na UI

- **Modo seguro (view-only).** `ui/view-mode.controller.js:44-46` deriva "posso editar" do **mesmo** `checkPermission('UPDATE_FEATURE')` que as store ops usam, e liga a classe `is-view-only` no `<body>` (CSS esconde as toolbars de desenho/militar/análise). Quem pode editar ainda pode entrar no modo voluntariamente (Shift+E); para quem não pode, o toggle é no-op com toast (`view-mode.controller.js:66-70`). O toggle voluntário é descartado ao mudar de atlas/sessão (`view-mode.controller.js:53-56`).
- **Comentários exigem autor.** `store/comment.operations.js:33-37` bloqueia antes do guard se `!sessionContext.isAuthenticated()`. Um visitante de link público é ONLINE mas `isAuthenticated()` é `false` (`session-context.js:197`), logo nunca comenta. Além disso, o Visualizador **não recebe** comentários do servidor: é filtro de transmissão no snapshot e no broadcast, não esconde-UI (guia *visao-e-principios* (absorvido):383-385).
- **Broadcast de seleção é editor-gated.** `presence/presence-bridge.js:169` usa `checkPermission('CREATE_FEATURE')`, espelhando o gate do servidor em `handleSelection`. Cursor e cursor temporal são ungated. Ver [[presenca-colaborativa]] e [[presenca-colaborativa]].
- **Menu da conta.** Compartilhar e Configurar aparecem para `owner|manager|admin` **e** com atlas conectado; Excluir projeto só para `owner|admin` (`account/account.control.js:411-417`, `:433-439`, `:443-452`). São afordâncias, o backend reenforça `manage`/`owner` em toda mutação.

## Sessão de visitante (link público)

`setVisitorSession()` (`session-context.js:264-273`) põe a sessão em ONLINE + `viewer` + `_isVisitor = true`, sem `userId`. `connectPublic` (`sync-engine.js:207-232`) faz o mesmo wiring do `connect` porém com `disableOperationLogging()`: um visitante **nunca** enfileira ops, senão elas ficariam órfãs na fila e seriam empurradas para o atlas errado num login posterior.

Do lado do servidor, o token público resolve para `permission = 'read'` e valida que foi emitido para aquele mesmo atlas (`collab.gateway.js:53-67`); `userId` tem forma `public-<uuid>`, não passa no `UUID_RE`, e por isso a busca de share é pulada no REST (`permissions.js:91-100`). Resultado: `role = 'viewer'`, sem sessão persistida. Ver [[link-publico]] e [[fila-operacoes-outbound]].

## Armadilhas

- **`manage` está ACIMA de `write`, mas `manage` não é `owner`.** Um gate escrito como `permission === 'write' || permission === 'owner'` exclui o co-Gestor silenciosamente (guia *02-atlas-basico* (absorvido):409-411); o próprio snippet de frontend em guia *02-atlas-basico* (absorvido):420 comete esse erro, não copie. Por outro lado, o Co-Gestor compartilha e configura o atlas ([[atlas-settings]]) mas não apaga nem trava mapa. `manage` é também o nível para o qual o ex-dono é rebaixado numa transferência de propriedade (`atlas.service.js:537-538`).
- **Admin global nunca chega com permissão baixa.** A linha "admin global com qualquer permissão" é teórica: tanto o gateway WS (`collab.gateway.js:83-85`) quanto o middleware REST (`permissions.js:80-87`) curto-circuitam admin global para `permission = 'owner'` antes de qualquer consulta a shares. No `connected` um admin recebe sempre `permission: "owner"` e `role: "admin"`. Não escreva código que dependa de ver `permission: "read"` junto com `role: "admin"`.
- **`sharing_updated` deriva role sem o papel global.** `sharing.controller.js:38,57` chama `toFrontendRole(req.body.permission)` **sem o segundo argumento**; se um admin global tivesse um share explícito de `read` e aplicasse esse `role`, ele se auto-rebaixaria. O cliente cobre isso ignorando o frame quando `sessionContext.isAdmin()` (`sync-engine.js:466-471`) e filtrando por `msg.userId === meu userId`. A proteção é do lado do cliente, não do servidor: qualquer novo consumidor precisa repetir as duas guardas.
- **Dois "admin" diferentes.** `sessionContext.isAdmin()` lê `_globalRole`; já `account.control.js` e `map-lock.controller.js` comparam `sessionContext.role === 'admin'`, que é o papel por atlas/org. São checagens distintas e podem discordar.
- **Trava de mapa logado no store local.** `map-lock.controller.js:71-76` (`canToggleLock`) só libera se `sessionContext.isOffline()`, sem consultar `isRemoteStoreSync()` como faz `isReadOnly()` (`:86-90`). Um usuário logado como `editor` trabalhando no store **local** recebe "Apenas o dono pode bloquear o mapa" no próprio mapa local.
  > [!CONTRADICAO 2026-07-18] guia *visao-e-principios* (absorvido):342-343 afirma que o modelo de papéis "só incide sobre um atlas remoto conectado, o store local é sempre editável (P1)"; o código em src/js/locking/map-lock.controller.js:71-76 gateia por papel assim que a sessão é ONLINE, mesmo com o store local. (A store op subjacente, `map.operations.js:852`, respeita P1 corretamente.)
- **`setSession` sem `username` apaga o avatar.** Por isso `sync-engine.js:192-194` repassa `sessionContext.username` ao aplicar o papel do `connected`.
- **Papel default do convite é sempre o menor.** `DEFAULT_GRANT_PERMISSION = 'read'` (`modals/sharing.modal.js:51`), e um valor não reconhecido cai para `'read'` em vez de escalar (`account.control.js:533-536`). "A permissão padrão abaixa, nunca eleva."
- **Offline = permissões plenas.** `clearSession()` volta a OFFLINE com `FULL_PERMISSIONS` (`session-context.js:286`). Não confunda "sem papel" com "sem acesso".
- **Clonar atlas exige só `read`**, mas o clone torna quem clonou o `owner` da cópia (guia *02-atlas-basico* (absorvido):365, [[clone-atlas]]).

## Checklist para não errar

- Autorizou escrita? Use `permission` (ou, no cliente, as flags derivadas do `role`), nunca uma string comparada à mão.
- Precisa de "dono"? `permission === 'owner'`. `manage` não serve.
- Precisa de "admin do sistema"? Só `globalRole === 'admin'` / `isAdmin()`; `role === 'admin'` no `connected` é o mesmo sinal, mas não o infira de `permission`.
- Adicionou um nível de permissão? Atualize `PERMISSION_LEVELS`, `toFrontendRole`, `assertOperationAllowed`, `UserRole` e `ROLE_PERMISSIONS`. Esquecer qualquer um degrada silenciosamente para `viewer`.

## Relação com o resto do sync

O papel não participa da resolução de conflito, que é LWW por ordem de chegada no servidor ([[modelo-conflito-lww]], [[modelo-conflito-lww]]). Papel decide **se** a op entra; a ordem de chegada decide **quem vence**. O overlay `atlas.settings` (disponibilidade de 3D/360/basemap) é um eixo separado, restritivo por interseção e revertido ao desconectar ([[atlas-settings]]). Compartilhamento e transferência de posse em [[compartilhamento-atlas]]; escopo do atlas em [[atlas-modelo-de-dados]]; ciclo de sessão/boot em [[sessao-boot-e-ciclo-de-vida]], [[autenticacao-jwt]] e [[jwt-emissor-unico]].


## Razões de bloqueio e o toast correspondente

## Razões de bloqueio e o toast correspondente

O guard falha suave e emite `STORE_OPERATION_BLOCKED` com um campo `reason`. Quem traduz isso para o usuário é `src/js/store/store-error-listener.js:53-72`, e a distinção importa: "mapa travado" e "papel insuficiente" são causas diferentes e antes mostravam a mesma mensagem.

| `reason` | Origem | Toast exibido |
|---|---|---|
| `map_locked` | mapa corrente travado (`store/feature.operations.js:141`) | "Mapa bloqueado. Desbloqueie para editar." |
| `target_map_locked` | mover feições para um mapa de destino travado (`feature.operations.js:713`) | idem |
| qualquer outro valor | string de capacidade vinda do `permission-guard` | "Acesso somente leitura, você não pode editar este projeto." |

O conjunto literal é `LOCK_REASONS = new Set(['map_locked', 'target_map_locked'])` (`store-error-listener.js:23`). **Toda razão fora dele cai no ramo de papel insuficiente**, então uma razão nova de trava precisa ser adicionada ao set, senão o usuário lê "somente leitura" em um mapa que só está travado.

Parâmetros de exibição:

- debounce de **3000 ms**, contado **por tipo** (`lock` e `denied` têm timestamps separados), justamente para que um toast de trava não engula o de somente-leitura que chegou logo depois (`store-error-listener.js:16`, `:24`, `:60-62`);
- duração do toast: 2500 ms, canal único `store-blocked` (evita empilhamento em falha em lote);
- os outros dois eventos de erro do store usam canais próprios: persistência mostra "Erro ao salvar dados..." por 5000 ms, e a fila de sync só avisa a partir de **3 falhas consecutivas** (`store-error-listener.js:32-50`). Ver [[fila-operacoes-outbound]].

O mesmo texto de somente-leitura aparece quando alguém sem permissão tenta o toggle voluntário de modo seguro (`src/js/ui/view-mode.controller.js:68`), mantendo a mensagem consistente entre as duas superfícies.

## Fontes

- guia *arquitetura-sync* (absorvido): §9.1 (dois vocabulários), §9.4 (gate só para atlas remoto), §9.5 (`requireAtlasPermission`, push exige `comment`), §10 (gate de seleção na presença), tabela `atlas_shares`.
- guia *02-atlas-basico* (absorvido): hierarquia, resolução em waterfall (owner → shares → público → 403/404), matriz de permissões por ação, nota de que `manage > write`.
- guia *04-websocket-collab* (absorvido): contrato do `connected` (campos `permission` e `role`), tabela de derivação, códigos de rejeição do upgrade, "contrato congelado" e a recomendação (divergente) de gatear o cliente por `permission`.
- guia *05-sync-crdt* (absorvido): permissão da rota de push (`comment`) e o refinamento por op via `assertOperationAllowed`.
- guia *07-compartilhamento* (absorvido): níveis concedíveis, `manage` para gerenciar sharing, `owner` não concedível.
- guia *visao-e-principios* (absorvido): §11 tabela papel → origem backend, matriz de capacidades, filtro de transmissão de comentário ao Visualizador, link público.
- guia *ui-ux-ebgeo* (absorvido): modo seguro automático, "a permissão padrão abaixa nunca eleva", mudança de papel ao vivo sem reconectar.
- guia *00-visao-geral* (absorvido): hierarquia por atlas vs eixo organizacional (`org_role`).
- guia *acoes-interface-multiusuario* (absorvido): nível mínimo esperado por ação de UI (editor para import/mover feição, owner para lock e delete de mapa).
- Backend: `src/utils/roles.js` (`toFrontendRole` + curto-circuito de admin global), `src/middleware/permissions.js` (`PERMISSION_LEVELS`, `resolvePermission`, bypass de admin, pulo de share para token público), `src/modules/collab/collab.gateway.js` (handshake, `connected`, `reconcileAuthorization`, close `4003`), `collab.handlers.js` e `collab.rooms.js` (gates de `read`/`comment`, visibilidade de ops de comentário), `src/modules/sync/sync.service.js` (`assertOperationAllowed`), `src/modules/sharing/sharing.controller.js`, `src/modules/atlas/atlas.service.js`.
- Frontend: `src/js/store/sync/permission-guard.js`, `session-context.js`, `sync-engine.js`, `src/js/ui/view-mode.controller.js`, `src/js/locking/map-lock.controller.js`, `src/js/store/comment.operations.js`, `src/js/store/map.operations.js`, `src/js/presence/presence-bridge.js`, `src/js/account/account.control.js`, `src/js/modals/sharing.modal.js`.
