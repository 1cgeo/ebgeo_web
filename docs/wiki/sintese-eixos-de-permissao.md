# Síntese: os três eixos ortogonais de permissão

Quadro comparativo entre o role global (user/admin), o org_role org-scoped (owner/admin/editor/viewer) e a permissão por-atlas (owner/manage/write/read/comment), mostrando quem decide o quê em cada rota.

## Os três eixos, em uma tabela

| Eixo | Valores | Onde é armazenado | O que ele realmente decide no código |
|------|---------|-------------------|--------------------------------------|
| `role` (global) | `user`, `admin` | coluna `users.role`, claim `role` do JWT | Rotas administrativas (`requireAdmin`) e **bypass total** para nível `owner` em qualquer atlas |
| `org_role` (org-scoped) | `owner`, `admin`, `editor`, `viewer` | coluna `users.org_role`, claim `org_role` | **Somente** o módulo 360 (escrita/calibração de projetos da própria OM). Nada mais. |
| `permission` (por-atlas) | `owner`, `manage`, `write`, `comment`, `read` | `atlas.owner_id` + `atlas_shares.permission` + `atlas.is_public` | Praticamente todo o resto: atlas, mapas, briefings, imagens, sharing, sync e WebSocket |

São ortogonais de verdade: um `role: user` com `org_role: viewer` pode ser `owner` de um atlas, e um `org_role: admin` não ganha nada num atlas alheio. Ver [[permissao-vs-papel]] e [[permissoes-atlas]].

## Eixo 1: role global

Duas rotas de decisão o consomem:

- `requireAdmin` (`src/middleware/require-admin.js:8-19`): sem `req.user` retorna **401** (`UNAUTHORIZED`), com usuário não-admin retorna **403** (`FORBIDDEN`). Essa distinção é deliberada, autenticação ausente não é o mesmo que autorização negada. Ver [[sintese-contrato-erros-http]].
- `requireAtlasPermission` (`src/middleware/permissions.js:82-87`): se `req.user.role === 'admin'`, a middleware **curto-circuita** e injeta `req.atlasPermission = 'owner'`, sem sequer consultar `atlas_shares`. O mesmo acontece no handshake do WebSocket (`src/modules/collab/collab.gateway.js:83-85`).

**Armadilha:** o admin global é `owner` de todo atlas, inclusive para `DELETE /atlas/:id` e para lock/unlock de mapa (`assertOperationAllowed`, `sync.service.js:611-618`). Não existe modo "admin só leitura". Ao construir UI administrativa, assuma que o admin vê e escreve tudo.

**Armadilha 2:** o `role` do JWT **não é a autoridade final**. Na rota estrita, `auth` reconcilia com o banco vivo e sobrescreve `req.user.role = live.role` (`src/middleware/auth.js:108`), justamente para que um admin rebaixado não continue admin durante os até 15 minutos de validade do access token. `org_role` e `organization_id` **não** são reconciliados (comentário em `auth.js:104-107`), então uma mudança de OM ou de org_role fica valendo até o token expirar. Ver [[autenticacao-jwt]] e [[refresh-token-rotacao]].

## Eixo 2: org_role (o eixo que quase não gate nada)

O claim existe, é emitido no login (`src/modules/auth/auth.service.js:33`) e degrada para `viewer` em tokens legados (`src/middleware/auth.js:39`). Mas o único consumidor de autorização é o módulo 360:

```js
// src/modules/streetview360/sv360.write.service.js:32-37
export function canWriteProject(user, project) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!user.organization_id || user.organization_id !== project.organization_id) return false;
  return ['owner', 'admin', 'editor'].includes(user.org_role);
}
```

Ou seja: mesma OM + `org_role` de escrita, ou admin global. O mesmo predicado é replicado no gate de rota em `sv360.routes.js:269`. Ver [[streetview-360]] e [[organizacoes-om]].

**Armadilha crítica:** a tabela `atlas` **não tem coluna `organization_id`**. `organization_id` só existe em `users` (`src/database/migrations/001_core.sql:96`) e em `sv360.projects` (`005_sv360.sql:16`). Consequência prática: **a OM não isola atlas**. Um usuário de outra OM que receba um share tem acesso pleno ao nível compartilhado, e nenhuma listagem de atlas filtra por org. Não desenhe telas assumindo tenancy de atlas por OM.

> [!CONTRADICAO 2026-07-18] `docs/guias/12-multiorg-identidade-auditoria.md:291` descreve `org_role` como "Capacidade de escrita dentro da OM (espelha o `UserRole` do frontend)", o que sugere um gate de escrita geral. No código o `org_role` só é consultado em `src/modules/streetview360/sv360.write.service.js:36` e `sv360.routes.js:269`; nenhuma rota de atlas, mapa, sync, imagem ou sharing o lê.

## Eixo 3: permissão por-atlas

É a hierarquia real de colaboração, com 5 níveis ordenados (`src/middleware/permissions.js:12-18`):

```js
const PERMISSION_LEVELS = { read: 1, comment: 2, write: 3, manage: 4, owner: 5 };
```

A resolução é uma função pura testável, `resolvePermission({ userId, ownerId, share, isPublic })` (`permissions.js:30-48`), com precedência: **dono do atlas** > **share explícito** > **público (read)** > `null` (403 `Access denied`).

| Nível | Papel de UI (`toFrontendRole`) | Capacidade |
|-------|-------------------------------|------------|
| `owner` | `owner` | tudo, incluindo deletar atlas, transferir, deletar mapa e lock/unlock |
| `manage` | `manager` | compartilhar, settings do atlas, limpar trace |
| `write` | `editor` | escrever qualquer entidade via sync, upload de imagem, duplicar/merge de mapa |
| `comment` | `commenter` | ver o atlas e escrever **apenas** comentários espaciais |
| `read` | `viewer` | somente leitura, e nem enxerga os comentários |

O mapeamento para o vocabulário do frontend está em `src/utils/roles.js:12-19`, e note a primeira linha: `if (globalRole === 'admin') return 'admin'`, ou seja, o eixo global sobrescreve o eixo por-atlas na hora de rotular a UI. Ver [[sintese-capacidades-por-papel]].

> [!CONTRADICAO 2026-07-18] `docs/guias/12-multiorg-identidade-auditoria.md:293` diz que a permissão por-atlas é `owner` / `write` / `read` (três níveis). O código tem cinco: `read < comment < write < manage < owner` (`src/middleware/permissions.js:12-18`), e `manage` e `comment` são usados em rotas reais (`sharing.routes.js:15-20`, `sync.routes.js:19`).

## Qual eixo decide cada rota

| Rota | Gate | Eixo |
|------|------|------|
| `POST/PUT/DELETE /organizations`, `GET /audit`, `POST/PUT/DELETE /resources`, `/users` (admin) | `requireAdmin` | global |
| `GET /atlas/:id`, `/maps`, `/briefings`, `GET /images`, `GET /sync/:version`, `POST /atlas/:id/clone` | `requireAtlasPermission('read')` | por-atlas |
| `POST /atlas/:id/sync` (push) | `requireAtlasPermission('comment')` | por-atlas |
| `PUT /atlas/:id`, `POST /images`, `POST /maps/:mapId/duplicate`, `/merge` | `requireAtlasPermission('write')` | por-atlas |
| `PATCH /atlas/:id/settings`, todo `/sharing/*` | `requireAtlasPermission('manage')` | por-atlas |
| `DELETE /atlas/:id`, `POST /atlas/:id/transfer` | `requireAtlasPermission('owner')` | por-atlas |
| `GET /atlas/:id/sync/admin/stats`, `/cleanup` | `requireAdmin` | global |
| escritas do módulo 360 | `canWriteProject` | org_role |

Fontes: `atlas.routes.js:26-44`, `sharing.routes.js:15-20`, `sync.routes.js:19-20`, `images.routes.js:64-68`, `maps.routes.js:13-17`, `briefings.routes.js:11-12`, `debug.routes.js:45-55`. Ver [[api-rest-atlas]], [[compartilhamento-atlas]], [[atlas-settings]], [[imagens-atlas]] e [[sync-admin-operacoes]].

## O gate de duas camadas do sync

O push de operações é o único lugar onde o gate de rota **não basta**. A rota exige apenas `comment` (`sync.routes.js:19`) para que o Comentarista consiga alcançá-la, e a segunda camada acontece por operação, dentro de `assertOperationAllowed` (`sync.service.js:600-620`):

- `read` lançando qualquer operação: `ForbiddenError` (defensivo, a rota já bloqueou).
- `comment` com `op.target !== 'comment'`: `ForbiddenError('Comentaristas só podem criar ou editar comentários')`.
- `map` + `delete` com permissão diferente de `owner`: bloqueado.
- `map` + `update` mexendo em `locked` com permissão diferente de `owner`: bloqueado.

Há ainda um terceiro filtro, de **visibilidade**: leitores `read` não recebem comentários nem no snapshot (`sync.service.js:454-494`) nem no pull incremental (`sync.service.js:794-798`). Ver [[comentario-espacial]] e [[snapshot-e-pull-incremental]].

**Armadilha:** um Comentarista só pode editar ou apagar o **próprio** comentário; editor e acima agem sobre qualquer um. Esse gate de autoria fica no SQL, não em `assertOperationAllowed` (`sync.service.js:1223-1272`).

## O mesmo modelo no WebSocket

O handshake resolve a permissão com uma cópia da mesma lógica (`collab.gateway.js:52-108`) e a congela em `ws.permission`, devolvendo no `connected` tanto `permission` (campo congelado) quanto `role` derivado por `toFrontendRole` (`collab.gateway.js:343-350`).

Dois detalhes que costumam morder:

1. **A permissão é re-resolvida a cada heartbeat** (`collab.gateway.js:110-138`). Um share revogado, um atlas despublicado ou uma org desativada fecham o socket com código 4003; um rebaixamento (write para read) apenas atualiza `ws.permission` e a próxima escrita é rejeitada. Não trate a permissão do handshake como imutável pela vida da sessão.
2. **Os handlers repetem o gate**: `collab.handlers.js:83` bloqueia `read` e `comment` juntos numa via, `:115` e `:166` bloqueiam só `read` em outras, e o broadcast filtra clientes `read` (`collab.rooms.js:66`, `:105`). Ver [[canal-collab-websocket]] e [[websocket-collab]].

Um token público (link compartilhado) recebe `sub` no formato `public-<uuid>`, que **não** é UUID puro. Isso é usado como sinal em dois lugares: `permissions.js:92` pula a consulta de shares, e `auth.js:80` pula a reconciliação com o banco (não existe linha em `users` para reconciliar). Ver [[link-publico]].

## O que o frontend faz com isso

O frontend colapsa tudo num único vocabulário `UserRole` (`src/js/store/sync/session-context.js:29`) alimentado pelo `role` do `connected`, e guarda o bit de admin global separado (`_globalRole`, `session-context.js:103` e `:163`), preservado entre re-sets de papel por atlas.

O gate local é permissivo por desenho:

```js
// src/js/store/sync/permission-guard.js:71-73
if (sessionContext.isOffline() || !isRemoteStoreSync()) {
    return { allowed: true };
}
```

Ou seja, **o gate de papel só vale para um atlas remoto conectado**; o workspace local é sempre editável, mesmo logado como viewer. Ver [[store-origin-local-remoto]], [[dominio-local-vs-remoto]] e [[modos-operacao]].

## Regras práticas para não errar

- Nunca derive capacidade de edição de atlas a partir de `org_role`. Use a `permission` que veio no `connected` do WebSocket ou no `req.atlasPermission` do backend.
- Nunca assuma isolamento de atlas por OM. Não existe.
- Ao adicionar rota nova de atlas, escolha o nível **mais baixo** que a operação exige e, se houver sub-operações mais sensíveis, coloque o gate fino na service (padrão `assertOperationAllowed`), não na rota.
- Sem credencial em rota estrita é 401; credencial válida sem nível suficiente é 403 (`Insufficient permissions`) ou 403 (`Access denied`) quando não há nível nenhum. Ver [[erros-api]].
- A trilha de auditoria hoje grava apenas um subconjunto das ações do CHECK; não conte com `PERMISSION_GRANT`/`SHARING_CHANGE` em todo fluxo de permissão. Ver [[auditoria]].
- Credencial pode chegar por `x-api-key`, cookie `token` ou Bearer, nessa ordem de precedência, e o middleware global nunca bloqueia. Quem barra é a rota. Ver [[auth-flexivel]], [[api-keys]] e [[hardening-borda-api]].

## Fontes

- `docs/guias/12-multiorg-identidade-auditoria.md`: definição dos claims `organization_id`/`org_role`, aliases congelados `org`/`login`, fallback de tokens legados, auth flexível, rotação de API key e auditoria; a tabela "dois eixos ortogonais" e a lista de níveis por-atlas foram corrigidas contra o código.
- `docs/guias/09-admin.md`: roles `user`/`admin`, rotas administrativas de usuários e resources, administração de sync e a tabela de referência rota/permissão.
- `docs/guias/01-autenticacao.md`: payload do JWT, ciclo de login/refresh/logout e o fato de que todo novo usuário nasce `role: user`.
- `ebgeo_backend/src/middleware/permissions.js`: `PERMISSION_LEVELS`, `resolvePermission`, bypass de admin global, tratamento de sub não-UUID.
- `ebgeo_backend/src/middleware/auth.js` e `require-admin.js`: reconciliação do role global com o banco, isenção de principals públicos, contrato 401 vs 403.
- `ebgeo_backend/src/utils/roles.js`: mapeamento permissão + role global para o vocabulário de UI.
- `ebgeo_backend/src/modules/sync/{sync.routes.js,sync.service.js}`: gate de rota em `comment` e gate por operação em `assertOperationAllowed`, filtro de visibilidade de comentários.
- `ebgeo_backend/src/modules/collab/{collab.gateway.js,collab.handlers.js,collab.rooms.js}`: resolução de permissão no handshake, re-reconciliação por heartbeat, gates e filtros de broadcast.
- `ebgeo_backend/src/modules/streetview360/{sv360.write.service.js,sv360.routes.js}`: o único consumidor real de `org_role`.
- `ebgeo_backend/src/database/migrations/{001_core.sql,005_sv360.sql}`: onde `organization_id` existe (users, sv360.projects) e onde não existe (atlas).
- `ebgeo_web/src/js/store/sync/{permission-guard.js,session-context.js}`: gate permissivo para o store local e o vocabulário `UserRole` do frontend.
