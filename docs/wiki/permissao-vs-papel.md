# permission vs role: dois eixos de autorização

O backend mantém dois vocabulários ortogonais, `permission` por-atlas (`owner`/`manage`/`write`/`comment`/`read`), que autoriza escrita, e `role` de UI (`owner`/`admin`/`manager`/`editor`/`commenter`/`viewer`), derivado de `permission` mais o papel global do JWT.

## Por que dois eixos

O eixo de autorização real é o **`permission` por-atlas**: é ele que o servidor consulta para decidir se uma operação entra no log. O eixo `role` existe porque a UI precisa de rótulos que misturem duas dimensões que o backend guarda separadas: a permissão naquele atlas e o papel **global** do usuário no sistema (`user` ou `admin`, vindo do JWT, ver [[autenticacao-jwt]] e [[jwt-emissor-unico]]). Um admin global não tem linha em `atlas_shares`, mas precisa ver "Admin do sistema" na interface e ganhar acesso total.

Regra prática: **`permission` decide, `role` rotula**. Não invente um terceiro vocabulário nem tente mapear um no outro fora de `toFrontendRole`.

## A hierarquia de `permission`

`src/middleware/permissions.js:12-18` define os níveis numéricos:

```
read (1) < comment (2) < write (3) < manage (4) < owner (5)
```

`owner` não é um share armazenado: é **sintetizado** de `atlas.owner_id` (`permissions.js:29-47`, comentário em `src/utils/roles.js:4-5`). A tabela `atlas_shares` só guarda `read`/`comment`/`write`/`manage`. Detalhe do modelo em [[permissoes-atlas]] e [[compartilhamento-atlas]].

Ordem de resolução em `resolvePermission` (`permissions.js:29-47`): dono → share → atlas público (`read`) → `null` (403).

## A derivação de `role`

Única fonte, `src/utils/roles.js:12-19`:

| Entrada | `role` emitido |
|---|---|
| `globalRole === 'admin'` (curto-circuito, antes de tudo) | `admin` |
| `permission = owner` | `owner` |
| `permission = manage` | `manager` |
| `permission = write` | `editor` |
| `permission = comment` | `commenter` |
| `permission = read`, público, ou nenhum | `viewer` |

A função é total: qualquer entrada não reconhecida cai em `viewer` (fail-closed). Bom padrão, mas significa que um `permission` novo e desconhecido silenciosamente vira `viewer` em vez de estourar.

### Armadilha: admin global nunca chega com permissão baixa

A linha "admin global com qualquer permissão" da tabela é teórica no canal collab. Tanto o gateway WS (`src/modules/collab/collab.gateway.js:83-85`) quanto o middleware REST (`src/middleware/permissions.js:80-87`) já **curto-circuitam admin global para `permission = 'owner'`** antes de qualquer consulta a shares. Ou seja, no `connected` um admin recebe sempre `permission: "owner"` e `role: "admin"`. Não escreva código que dependa de ver `permission: "read"` junto com `role: "admin"`.

### Armadilha: `sharing_updated` deriva role sem o papel global

`src/modules/sharing/sharing.controller.js:38,57` chama `toFrontendRole(req.body.permission)` **sem o segundo argumento**. O broadcast carrega, portanto, o papel derivado só da permissão por-atlas. Se um admin global tiver um share explícito de `read` e aplicasse esse `role`, ele se auto-rebaixaria. O cliente cobre isso ignorando o frame quando `sessionContext.isAdmin()` (`src/js/store/sync/sync-engine.js:466-471`), e o frame também é filtrado por `msg.userId === meu userId`. A proteção é do lado do cliente, não do servidor: qualquer novo consumidor desse broadcast precisa repetir as duas guardas.

## Onde o `permission` é aplicado de verdade

O `connected` entrega ambos os campos (ver [[canal-collab-websocket]] e [[websocket-collab]]), mas a autorização acontece no servidor, em três camadas:

1. **Handshake**: sem permissão de leitura, o upgrade é rejeitado com `403` (`collab.gateway.js:52-107`). Ver [[erros-api]].
2. **Gate grosso por handler**: `handleOperation` recusa `permission === 'read'` com `error`/`FORBIDDEN` (`src/modules/collab/collab.handlers.js:115-121`); `handleSelection` ignora `read` **e** `comment` (`collab.handlers.js:83-85`), então comentarista não emite seleção para os peers ([[presenca-colaborativa]]).
3. **Gate fino por operação**: `assertOperationAllowed(op, permission)` em `src/modules/sync/sync.service.js:600-620`, chamado dentro do loop de `pushOperations` (`sync.service.js:660`), portanto vale igual para o push via WS e via REST. Regras: `read` nunca escreve; `comment` só escreve ops de `target === 'comment'` ([[comentario-espacial]]); `map` `delete` exige `owner`; `map` `update` que mexe em `locked` exige `owner`. Tudo o mais passa para `write`/`manage`/`owner`. Ver [[envelope-operacao]].

Consequência importante: **`manage` não é `owner`**. Co-Gestor compartilha e configura o atlas ([[atlas-settings]]), mas não apaga mapa nem trava mapa. `manage` é também o nível para o qual o ex-dono é rebaixado numa transferência de propriedade (`src/modules/atlas/atlas.service.js:537-538`).

Na saída, o broadcast também respeita o eixo: `broadcastOperations` **nunca entrega ops de `comment` a conexões `read`**, e divide um lote misto para que o cliente `read` ainda receba as ops não-comentário (`src/modules/collab/collab.rooms.js:83-115`).

## Revalidação em socket vivo

`permission` é resolvido no handshake, mas um socket vive horas. `reconcileAuthorization` roda a cada tick de heartbeat (`collab.gateway.js:115-140`): share revogado, atlas despublicado ou organização desativada fecham o socket com `4003` (close limpo, o peer some na hora em vez de ficar `away`); um rebaixamento (`write`→`read`) apenas atualiza `ws.permission`, e a próxima escrita é recusada pelos handlers. Não existe frame de "sua permissão mudou" no eixo `permission`; quem avisa a UI é o `sharing_updated` no eixo `role`.

## O que o cliente EBGeo Web realmente faz

O frontend **não guarda `connected.permission`**. Ele lê apenas `payload.role` e o injeta em `sessionContext.setSession({ role })` (`src/js/store/sync/sync-engine.js:192-198`); a tabela `ROLE_PERMISSIONS` (`src/js/store/sync/session-context.js:59-84`) então deriva as flags booleanas (`canEdit`, `canDelete`, `canComment`, `canManageUsers`, `canLockMaps`) que o `permission-guard.js` consulta.

> [!CONTRADICAO 2026-07-18] `docs/guias/04-websocket-collab.md:126-128` diz "Para autorizar escrita no cliente, cheque `permission !== 'read'` (não o `role`)"; o cliente real ignora `permission` por completo e gateia por `role` (`src/js/store/sync/sync-engine.js:192-198` + `src/js/store/sync/session-context.js:59-84`, tabela `ROLE_PERMISSIONS`).

Os dois caminhos concordam no caso comum (`viewer` ⇒ `canEdit: false`), e o gate por `role` é até mais fino, porque distingue `commenter` (`canComment: true`, resto `false`) e separa `editor` de `manager`/`owner` em `canManageUsers`/`canLockMaps`, espelhando `assertOperationAllowed`. Ainda assim, para um cliente novo, o campo congelado e canônico é `permission`; `role` é aditivo e pode divergir se alguém alterar `toFrontendRole` sem atualizar as duas pontas.

Dois pontos que costumam confundir na `session-context.js`:

- `role` (por-atlas) e `globalRole` (`user`/`admin`) são campos **distintos**. `setSession` sem `globalRole` **preserva** o valor anterior, justamente para que o re-set de papel por-atlas no `connect` não apague o bit de admin estabelecido no login (`session-context.js:232-256`). `isAdmin()` gateia o painel administrativo ([[gestao-usuarios]]), não o direito de editar o atlas.
- Offline/anônimo recebe `FULL_PERMISSIONS`: o gate de papel só vale para um atlas remoto conectado, o store local é sempre editável (ver [[store-origin-local-remoto]] e [[modos-operacao]]).

## Visitante público

O token público ([[link-publico]]) resolve para `permission = 'read'` e valida que foi emitido para aquele mesmo atlas (`collab.gateway.js:53-67`); `userId` tem forma `public-<uuid>`, não passa no `UUID_RE`, e por isso a busca de share é pulada no REST (`permissions.js:91-100`). Resultado: `role = 'viewer'`, sem sessão persistida.

## Checklist para não errar

- Autorizou escrita? Use `permission` (ou, no cliente, as flags derivadas do `role`), nunca uma string comparada à mão.
- Precisa de "dono"? `permission === 'owner'`. `manage` não serve.
- Precisa de "admin do sistema"? Só `globalRole === 'admin'` / `isAdmin()`; `role === 'admin'` no `connected` é o mesmo sinal, mas não o infira de `permission`.
- Adicionou um nível de permissão? Atualize `PERMISSION_LEVELS`, `toFrontendRole`, `assertOperationAllowed`, `UserRole` e `ROLE_PERMISSIONS`. Esquecer qualquer um degrada silenciosamente para `viewer`.

Ver também [[sintese-eixos-de-permissao]] e [[sintese-capacidades-por-papel]].

## Fontes
- `docs/guias/04-websocket-collab.md`: contrato do `connected` (campos `permission` e `role`), tabela de derivação, códigos de rejeição do upgrade, nota de "contrato congelado" e a recomendação (divergente) de gatear o cliente por `permission`.
- `ebgeo_backend/src/utils/roles.js`: implementação única de `toFrontendRole` e o curto-circuito de admin global.
- `ebgeo_backend/src/middleware/permissions.js`: hierarquia numérica `read<comment<write<manage<owner`, `resolvePermission`, bypass de admin global e pulo de share para token público.
- `ebgeo_backend/src/modules/collab/collab.gateway.js`: resolução de permissão no handshake, admin global → `owner`, emissão do `connected` e `reconcileAuthorization` no heartbeat (close `4003`).
- `ebgeo_backend/src/modules/collab/collab.handlers.js` e `collab.rooms.js`: gates de `read`/`comment` em operação e seleção; regra de visibilidade de ops de comentário no broadcast.
- `ebgeo_backend/src/modules/sync/sync.service.js`: `assertOperationAllowed` (comentarista só comenta; delete e lock de mapa são owner-only) aplicado dentro de `pushOperations`.
- `ebgeo_backend/src/modules/sharing/sharing.controller.js`: broadcast `sharing_updated` derivando `role` sem o papel global.
- `ebgeo_backend/src/modules/atlas/atlas.service.js`: ex-dono rebaixado a `manage` na transferência de propriedade.
- `ebgeo_web/src/js/store/sync/session-context.js` e `sync-engine.js`: vocabulário `UserRole`, tabela `ROLE_PERMISSIONS`, consumo de `payload.role` no `connect`, preservação de `globalRole` e guardas do handler de `sharing_updated`.
