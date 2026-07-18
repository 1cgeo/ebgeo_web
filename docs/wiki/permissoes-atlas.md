# Permissões e Papéis por Atlas

Dois vocabulários convivem, tiers de acesso do backend (`read < comment < write < manage < owner`) e papéis de identidade do frontend, com gate de rota, checagem fina por operação e um `permission-guard` que só se aplica a atlas remoto conectado.

## Os dois vocabulários

**Tier de permissão do atlas** (backend, modelo de acesso persistido): `read < comment < write < manage < owner`. Vive em `atlas_shares.permission ∈ {read, comment, write, manage}`; `owner` **nunca** aparece nessa tabela, é sintetizado de `atlas.owner_id` (docs/arquitetura-sync.md:290). É o que a rota REST e o upgrade do WebSocket resolvem.

**Papéis de identidade** (frontend, `session-context.js:29-36`): `owner, admin, manager, editor, commenter, viewer`. Cada um mapeia para um conjunto fixo de capacidades em `ROLE_PERMISSIONS` (`session-context.js:60-85`):

| Papel (token) | canEdit | canDelete | canComment | canManageUsers | canLockMaps |
|---|:-:|:-:|:-:|:-:|:-:|
| `owner` / `admin` / `manager` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `editor` | ✓ | ✓ | ✓ | — | — |
| `commenter` | — | — | ✓ | — | — |
| `viewer` | — | — | — | — | — |

A tradução tier → papel é do backend (`utils/roles.js#toFrontendRole`) e chega no payload `connected` do WebSocket; o cliente apenas o aplica (`sync-engine.js:189-196`). Detalhe do eixo de acesso em [[permissao-vs-papel]] e [[sintese-eixos-de-permissao]]; matriz de capacidades consolidada em [[sintese-capacidades-por-papel]].

> [!CONTRADICAO 2026-07-18] docs/visao-e-principios.md:353 diz que o admin global tem token de frontend `sysadmin`; o código não tem esse valor em lugar nenhum, `UserRole.ADMIN = 'admin'` (`session-context.js:31`) e o bit global é lido de `_globalRole` por `isAdmin()` (`session-context.js:162-164`).

## Terceiro eixo: papel global da conta

`users.role ∈ {user, admin}` é **independente** do tier por atlas. No login, `sync-engine.js:122-129` faz:

- `role: user.org_role || 'viewer'` (papel por organização, valores `owner|admin|editor|viewer`, docs/arquitetura-sync.md:287)
- `globalRole: user.role || 'user'`

`globalRole` é preservado quando `setSession` é chamado sem ele (`session-context.js:247-249`), justamente para que o `connect` por atlas não apague o bit de admin. **Armadilha:** `sessionContext.role` logo após o login é o `org_role`, não o papel do atlas. Ele só vira o papel real do atlas depois do `connected` do WebSocket. Ver [[organizacoes-om]] e [[gestao-usuarios]].

## Onde cada gate acontece

São três camadas independentes, e nenhuma substitui a outra.

1. **Gate de rota (backend).** `requireAtlasPermission(level)` resolve em cascata: dono ou admin global → `owner`; senão `atlas_shares.permission`; senão `atlas.is_public` → `read`; senão 403. Atlas inexistente/deletado → 404 (docs/guias/02-atlas-basico.md:382-388). O push de sync exige **`comment`**, não `write`, para que Comentaristas consigam chegar; o pull exige `read` (docs/arquitetura-sync.md:324). Ver [[api-rest-atlas]] e [[erros-api]].
2. **Checagem fina por operação (backend).** `assertOperationAllowed(op, permission)` roda por op dentro da transação de push (docs/arquitetura-sync.md:193): um tier `comment` só escreve comentário espacial; `write`/`manage`/`owner` escrevem qualquer entidade; **delete de mapa e lock/unlock são exclusivos do `owner`** (docs/guias/05-sync-crdt.md:507-509). É por isso que o gate de rota permissivo (`comment`) não vaza escrita: quem barra é essa segunda checagem. Ver [[envelope-operacao]] e [[tabela-operations]].
3. **Gate de papel no cliente (`permission-guard.js`).** Puramente UX/antecipação, o servidor é a garantia real.

## `permission-guard.js`: só vale para atlas remoto conectado

```javascript
if (sessionContext.isOffline() || !isRemoteStoreSync()) {
    return { allowed: true };
}
```
(`store/sync/permission-guard.js:70-72`)

Essa é a linha mais importante do arquivo. O papel **não** gateia o store local, mesmo logado. Sem ela, um usuário autenticado cujo `org_role` é `viewer` não conseguiria desenhar no próprio espaço local. O discriminante é o marcador de origem do store (`isRemoteStoreSync()`, `store-origin.js`), não namespacing por atlas, ver [[store-origin-local-remoto]] e [[dominio-local-vs-remoto]].

`GuardAction` (`permission-guard.js:18-58`) mapeia ~25 ações CRUD para 5 capacidades. Pontos que costumam surpreender:

- `CREATE_COMMENT`/`UPDATE_COMMENT`/`DELETE_COMMENT` → `COMMENT`, capacidade grossa. A regra fina "autor ou Editor+" para editar/apagar um comentário específico vive nas operações de comentário e no backend, não aqui (`permission-guard.js:38-41`). Ver [[comentario-espacial]].
- `LOCK_MAP` → `LOCK_MAPS`, capacidade que só `owner`/`manager`/`admin` têm. Um `editor` **não** trava mapa.
- `CLEAR_ALL_DATA` → `DELETE`, ou seja, um Comentarista não limpa o store remoto.

O guard falha **suave**: as store ops chamam `checkPermission`, e ao negar emitem `STORE_OPERATION_BLOCKED` e retornam (por exemplo `map.operations.js:852-856`), em vez de lançar. `assertPermission` (lança `PermissionError`) existe mas não tem call site em `src/js` fora do barrel `sync/index.js:131`.

## Efeitos de papel na UI

- **Modo seguro (view-only).** `ui/view-mode.controller.js:44-46` deriva "posso editar" do **mesmo** `checkPermission('UPDATE_FEATURE')` que as store ops usam, e liga a classe `is-view-only` no `<body>` (CSS esconde as toolbars de desenho/militar/análise). Quem pode editar ainda pode entrar no modo voluntariamente (Shift+E); para quem não pode, o toggle é no-op com toast (`view-mode.controller.js:66-70`). O toggle voluntário é descartado ao mudar de atlas/sessão (`view-mode.controller.js:53-56`).
- **Comentários exigem autor.** `store/comment.operations.js:33-37` bloqueia antes do guard se `!sessionContext.isAuthenticated()`. Um visitante de link público é ONLINE mas `isAuthenticated()` é `false` (`session-context.js:197`), logo nunca comenta. Além disso, o Visualizador **não recebe** comentários do servidor, é filtro de transmissão no snapshot e no broadcast, não esconde-UI (docs/visao-e-principios.md:383-385).
- **Broadcast de seleção é editor-gated.** `presence/presence-bridge.js:169` usa `checkPermission('CREATE_FEATURE')`, espelhando o gate do servidor em `handleSelection`. Cursor e cursor temporal são ungated. Ver [[presenca-colaborativa]] e [[presenca-tempo-real]].
- **Menu da conta.** Compartilhar e Configurar aparecem para `owner|manager|admin` **e** com atlas conectado; Excluir projeto só para `owner|admin` (`account/account.control.js:411-417`, `:433-439`, `:443-452`). São afordâncias, o backend reenforça `manage`/`owner` em toda mutação.

## Sessão de visitante (link público)

`setVisitorSession()` (`session-context.js:264-273`) põe a sessão em ONLINE + `viewer` + `_isVisitor = true`, sem `userId`. `connectPublic` (`sync-engine.js:207-232`) faz o mesmo wiring do `connect` porém com `disableOperationLogging()`: um visitante **nunca** enfileira ops, senão elas órfãs ficariam na fila e seriam empurradas para o atlas errado num login posterior. Ver [[link-publico]] e [[fila-operacoes-outbound]].

## Mudança de papel ao vivo

`updateRole(role)` (`session-context.js:297-302`) troca papel e capacidades **preservando identidade**, ao contrário de `setSession`, que zeraria `userId`/`username`. É o caminho de `atlas_owner_changed` e de um rebaixamento (write→read) engatarem o modo seguro sem reconectar. O heartbeat do WebSocket também re-reconcilia a autorização periodicamente (docs/arquitetura-sync.md:324, 440). Ver [[websocket-collab]] e [[canal-collab-websocket]].

## Armadilhas

- **`manage` está ACIMA de `write`.** Um gate escrito como `permission === 'write' || permission === 'owner'` exclui o co-Gestor silenciosamente (docs/guias/02-atlas-basico.md:409-411). O próprio snippet de frontend em docs/guias/02-atlas-basico.md:420 comete esse erro; não copie.
- **Dois "admin" diferentes.** `sessionContext.isAdmin()` lê `_globalRole`; já `account.control.js` e `map-lock.controller.js` comparam `sessionContext.role === 'admin'`, que é o papel por atlas/org. São checagens distintas e podem discordar.
- **Trava de mapa logado no store local.** `map-lock.controller.js:71-76` (`canToggleLock`) só libera se `sessionContext.isOffline()`, sem consultar `isRemoteStoreSync()` como faz `isReadOnly()` (`:86-90`). Um usuário logado como `editor` trabalhando no store **local** recebe "Apenas o dono pode bloquear o mapa" no próprio mapa local.
  > [!CONTRADICAO 2026-07-18] docs/visao-e-principios.md:342-343 afirma que o modelo de papéis "só incide sobre um atlas remoto conectado, o store local é sempre editável (P1)"; o código em src/js/locking/map-lock.controller.js:71-76 gateia por papel assim que a sessão é ONLINE, mesmo com o store local. (A store op subjacente, `map.operations.js:852`, respeita P1 corretamente.)
- **`setSession` sem `username` apaga o avatar.** Por isso `sync-engine.js:192-194` repassa `sessionContext.username` ao aplicar o papel do `connected`.
- **Papel default do convite é sempre o menor.** `DEFAULT_GRANT_PERMISSION = 'read'` (`modals/sharing.modal.js:51`), e um valor não reconhecido cai para `'read'` em vez de escalar (`account.control.js:533-536`). "A permissão padrão abaixa, nunca eleva."
- **Offline = permissões plenas.** `clearSession()` volta a OFFLINE com `FULL_PERMISSIONS` (`session-context.js:286`). Não confunda "sem papel" com "sem acesso".
- **Clonar atlas exige só `read`**, mas o clone torna quem clonou o `owner` da cópia (docs/guias/02-atlas-basico.md:365, [[clone-atlas]]).

## Relação com o resto do sync

O papel não participa da resolução de conflito, que é LWW por ordem de chegada no servidor ([[modelo-conflito-lww]], [[sync-lww-operacoes]]). Papel decide **se** a op entra; a ordem de chegada decide **quem vence**. O overlay `atlas.settings` (disponibilidade de 3D/360/basemap) é um eixo separado, restritivo por interseção e revertido ao desconectar ([[atlas-settings]]). Compartilhamento e transferência de posse em [[compartilhamento-atlas]]; escopo do atlas em [[atlas]]; ciclo de sessão/boot em [[sessao-boot-e-ciclo-de-vida]] e [[autenticacao-jwt]].

## Fontes

- `docs/arquitetura-sync.md`: §9.1 (dois vocabulários), §9.4 (gate só para atlas remoto), §9.5 (`requireAtlasPermission`, push exige `comment`), §10 (gate de seleção na presença), tabela `atlas_shares`.
- `docs/guias/02-atlas-basico.md`: hierarquia, resolução em waterfall (owner → shares → público → 403/404), matriz de permissões por ação, nota de que `manage > write`.
- `docs/guias/05-sync-crdt.md`: permissão da rota de push (`comment`) e o refinamento por op via `assertOperationAllowed`.
- `docs/guias/07-compartilhamento.md`: níveis concedíveis, `manage` para gerenciar sharing, `owner` não concedível.
- `docs/visao-e-principios.md`: §11 tabela papel → origem backend, matriz de capacidades, filtro de transmissão de comentário ao Visualizador, link público.
- `docs/ui-ux-ebgeo.md`: modo seguro automático, "a permissão padrão abaixa nunca eleva", mudança de papel ao vivo sem reconectar.
- `docs/guias/00-visao-geral.md`: hierarquia por atlas vs eixo organizacional (`org_role`).
- `docs/acoes-interface-multiusuario.md`: nível mínimo esperado por ação de UI (editor para import/mover feição, owner para lock e delete de mapa).
- Código: `src/js/store/sync/permission-guard.js`, `src/js/store/sync/session-context.js`, `src/js/store/sync/sync-engine.js`, `src/js/ui/view-mode.controller.js`, `src/js/locking/map-lock.controller.js`, `src/js/store/comment.operations.js`, `src/js/store/map.operations.js`, `src/js/presence/presence-bridge.js`, `src/js/account/account.control.js`, `src/js/modals/sharing.modal.js`.
