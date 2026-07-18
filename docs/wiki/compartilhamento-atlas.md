# Compartilhamento com Usuários

Concessão nominal de acesso a um atlas gravada em `atlas_shares` (`read`/`comment`/`write`/`manage`, nunca `owner`), gerida por quem tem `manage` através das rotas `/sharing/users` e apoiada pela busca de usuários.

## O que é um share

Um share é uma linha em `atlas_shares` que liga um usuário a um atlas com uma permissão. A tabela (`ebgeo_backend/src/database/migrations/002_atlas.sql:59-71`) define:

- `UNIQUE(atlas_id, user_id)`: um usuário tem no máximo uma permissão por atlas.
- `CHECK (permission IN ('read','comment','write','manage'))`: `owner` **não existe** na tabela.
- `ON DELETE CASCADE` em `atlas_id` e `user_id`: apagar o atlas ou o usuário apaga o share.
- `added_by` guarda quem concedeu (referência a `users`, sem cascade).

`owner` é sintetizado de `atlas.owner_id` em `resolvePermission()` (`src/middleware/permissions.js:30-48`), na ordem: dono → share → atlas público (`read`) → `null` (403). Ver [[permissoes-atlas]] e [[atlas-modelo-de-dados]] para a hierarquia completa, e [[link-publico]] para o degrau público.

## Rotas

Montadas em `router.use('/:atlasId/sharing', sharingRoutes)` (`src/modules/atlas/atlas.routes.js:47`). **Todas** exigem `requireAtlasPermission('manage')` (`src/modules/sharing/sharing.routes.js:15-20`):

| Rota | Efeito |
|---|---|
| `GET /api/v1/atlas/:atlasId/sharing` | `{ isPublic, publicLink, owner, shares[] }` |
| `POST /api/v1/atlas/:atlasId/sharing/users` | 201, corpo `{ userId, permission }` |
| `PUT /api/v1/atlas/:atlasId/sharing/users/:userId` | 200, corpo `{ permission }` |
| `DELETE /api/v1/atlas/:atlasId/sharing/users/:userId` | 204 |
| `POST` / `DELETE .../sharing/public` | link público, ver [[link-publico]] |

Os corpos são validados por Joi contra `GRANTABLE_PERMISSIONS = ['read','comment','write','manage']` e `userId` UUID (`src/modules/sharing/sharing.schemas.js:111-120`). Enviar `permission: 'owner'` é 400, não 403. Contrato de erro em [[erros-api]].

**Compartilhar não é privilégio do dono.** `manage` (co-Gestor) basta, e um co-Gestor pode conceder até `manage`, ou seja, pode criar outros co-Gestores e remover quem o promoveu. Não há proteção contra auto-rebaixamento nem contra remoção mútua entre gestores. A posse só muda pela rota de transferência (owner-only); ver [[atlas-modelo-de-dados]].

## Formato de leitura vs formato de escrita

`GET /sharing` devolve **camelCase montado em SQL** (`json_build_object` em `src/modules/sharing/sharing.queries.js:60-81`): `isPublic`, `publicLink`, `owner: { userId, username, nome }`, `shares: [{ userId, username, nome, permission, addedAt }]`. O `json_agg ... FILTER (WHERE s.id IS NOT NULL)` garante `[]` (e não `[null]`) quando não há shares.

`POST` e `PUT` devolvem a **linha crua da tabela** (`RETURNING *`), portanto snake_case: `atlas_id`, `user_id`, `added_at`, `added_by`. Escrita e leitura falam dialetos diferentes na mesma feature; não reaproveite o objeto do `POST` para atualizar a lista em memória, releia o `GET` (é o que o modal faz).

> **Nota histórica.** guia *07-compartilhamento* (absorvido):31-54` mostra o response do `GET /sharing` sem o bloco `owner`; o código em `src/modules/sharing/sharing.service.js:12-21` sempre retorna `owner: { userId, username, nome }`, e o modal depende dele (`src/js/modals/sharing.modal.js:181`) para desenhar a linha "Gestor (dono)" e o botão de transferência.

> **Nota histórica.** guia *07-compartilhamento* (absorvido):586-615` lê o `GET /sharing` como `data.data.is_public`, `data.data.public_link` e `share.user_id`; o código em `src/modules/sharing/sharing.queries.js:60-74` devolve `isPublic`, `publicLink` e `shares[].userId`. O exemplo do guia lê `undefined` em todos esses campos. O mesmo exemplo só oferece `read` e `write` no dropdown, enquanto `src/js/modals/sharing.modal.js:53-58` oferece os quatro níveis (Leitura, Comentário, Edição, Gestão).

## Armadilhas de comportamento

**`POST /users` é upsert, não create.** `INSERT ... ON CONFLICT (atlas_id, user_id) DO UPDATE SET permission = EXCLUDED.permission` (`sharing.queries.js:83-88`). Reenviar o `POST` para alguém que já é membro **altera** a permissão e ainda responde 201. Não existe 409, e um duplo clique pode rebaixar silenciosamente um editor para leitor se o payload trouxer `read`. O modal se protege no cliente (`sharing.modal.js:699-700`), o servidor não.

**`PUT` e `DELETE` são 404 quando não há share.** `UPDATE`/`DELETE ... RETURNING` sem linhas vira `NotFoundError('Share')` (`sharing.service.js:43-57`). Consequência: tentar remover o **dono** dá 404, não sucesso silencioso, porque o dono não tem linha em `atlas_shares`. O comentário em `sharing.routes.js:12-14` chama isso de "no-op on them", o que não corresponde ao service.

**`POST /users` valida o usuário, `PUT` não.** `addUserShare` checa `SELECT id FROM users WHERE id = $1 AND is_active = true` antes de inserir (`sharing.service.js:33-37`); `updateUserShare` opera direto na tabela. Desativar um usuário não apaga o share dele, apenas impede novas concessões.

**`manage` fica acima de `write`.** `PERMISSION_LEVELS = { read:1, comment:2, write:3, manage:4, owner:5 }` (`src/middleware/permissions.js:12-18`). Um gate escrito como `permission === 'write' || permission === 'owner'` exclui o co-Gestor sem erro visível. Sempre compare por nível. Ver [[permissoes-atlas]].

**Admin global ignora shares.** `requireAtlasPermission` faz curto-circuito para `'owner'` quando `req.user.role === 'admin'` (`src/middleware/permissions.js:82-87`), antes mesmo de consultar `atlas_shares`. Um admin gerencia o compartilhamento de qualquer atlas, e no cliente ignora o re-gate ao vivo. Ver [[gestao-usuarios]].

**Token público não consulta shares.** A busca do share é pulada quando o `userId` não é UUID (`src/middleware/permissions.js:90-100`), que é o caso do visitante de [[link-publico]].

## Propagação ao vivo

Toda mutação de compartilhamento faz `broadcastToRoom(atlasId, { type: 'sharing_updated', action, ... })` (`src/modules/sharing/sharing.controller.js:134-189`), com `action` em `public_enabled | public_disabled | user_added | user_updated | user_removed`. Em `user_added` e `user_updated` o broadcast carrega também `role: toFrontendRole(permission)` (`src/utils/roles.js:12-19`, mapa `manage→manager`, `write→editor`, `comment→commenter`, resto `viewer`), justamente para o par conectado se re-gatear sem reconectar.

No cliente, `ws-client.js:360-362` emite `sharingUpdated` e `sync-engine.js:465-472` reage: só o usuário afetado, nunca um admin, e apenas para `user_added`/`user_updated` com `role` presente. `sessionContext.updateRole()` dispara `SESSION_CHANGED`, que a UI consome para entrar no modo seguro num rebaixamento e devolver as barras num aumento. Ver [[canal-collab-websocket]] e [[canal-collab-websocket]].

**Buraco conhecido:** `user_removed` não traz `role` e não é tratado no `sync-engine`. Quem for removido continua com a UI de edição até o próximo reconnect ou até um 403 do backend. A permissão do WebSocket também é resolvida na conexão (`src/modules/collab/collab.gateway.js:86-100`), não a cada frame, então a remoção só morde de fato na próxima sessão ou no próximo push. Segurança fica com o servidor; a UI é só cortesia. Ver [[sintese-eixos-de-permissao]].

## Busca de usuários

`GET /api/v1/users/search?q=<termo>` (`src/modules/users/users.routes.js:16`) exige apenas autenticação, **sem escopo de atlas**. `q` tem mínimo de 2 e máximo de 100 caracteres (`users.schemas.js:22-24`); o service envolve em `%termo%` (`users.service.js:75-79`) e a query casa `username`, `nome`, posto (`ranks.nome`) e OM (`organizations.nome`), filtra `is_active = true`, ordena por `nome` e limita a 20 (`src/modules/users/users.queries.js:48-63`).

Implicações: é um `LIKE` sem índice funcional e sem paginação (não há offset, o 21º resultado é inalcançável, refine o termo); é uma superfície de enumeração de pessoal para qualquer usuário logado, inclusive fora da própria OM; e a busca por posto/OM é intencional, para achar "Cap" ou "CIGEx". Ver [[organizacoes-om]] e [[hardening-borda-api]].

No frontend o campo tem debounce de 300 ms, mínimo de 2 caracteres e um `_searchSeq` monotônico que descarta respostas fora de ordem (`src/js/modals/sharing.modal.js:41-44`, `120-124`).

## Concessão padrão no frontend

Escolher alguém no resultado da busca concede `DEFAULT_GRANT_PERMISSION = 'read'` (`src/js/modals/sharing.modal.js:47-51`). A regra explícita é "a permissão padrão abaixa, nunca eleva": subir para Comentário, Edição ou Gestão é sempre um ato deliberado no dropdown do membro, nunca efeito colateral de convidar. Preserve isso ao mexer no modal.

Cuidado com um comentário desatualizado: o JSDoc do modal (`src/js/modals/sharing.modal.js:15-16` e `735-736`) afirma que "the backend also enforces owner-only on every mutation", enquanto as rotas exigem `manage` (`sharing.routes.js:15-20`). O gate real é `manage`.

## Efeito na listagem de atlas

`LIST_USER_ATLAS` (`src/modules/atlas/atlas.queries.js:14-25`) une atlas próprios e compartilhados com `LEFT JOIN atlas_shares` e devolve `user_permission = COALESCE(s.permission, CASE WHEN a.owner_id = $1 THEN 'owner' END)`. É esse campo que o seletor de projetos usa para saber o que mostrar. A lixeira é diferente: `LIST_DELETED_USER_ATLAS` fixa `'owner'` e filtra por `owner_id`, ou seja, um membro compartilhado nunca vê nem restaura um atlas na lixeira. Ver [[api-rest-atlas]] e [[atlas-modelo-de-dados]].

Compartilhamento não altera dados sincronizados: o share só governa o gate. As operações continuam viajando pelo caminho normal ([[fila-operacoes-outbound]], [[modelo-conflito-lww]]), e o que um membro pode empurrar é decidido em [[permissoes-atlas]].


## Shape da resposta de `GET /users/search`

## Shape da resposta de `GET /users/search`

O service devolve as linhas de `SEARCH_USERS` sem mapeamento (`users.service.js:75-79`), então o corpo é o resultado direto da query (`users.queries.js:48-63`):

```json
{
  "data": [
    {
      "id": "user-uuid",
      "username": "cap.silva",
      "nome": "Capitão Silva",
      "rank_id": "rank-uuid",
      "posto_graduacao": "Cap",
      "organization_id": "org-uuid",
      "organizacao_militar": "CIGEx"
    }
  ]
}
```

| Campo | Tipo | Papel |
|---|---|---|
| `id` | UUID | é o `userId` que vai no `POST /sharing/users` |
| `username`, `nome` | texto | exibição na lista de resultados |
| `rank_id`, `organization_id` | UUID \| `null` | valores gravados em `users` (FKs) |
| `posto_graduacao`, `organizacao_militar` | texto \| `null` | **derivados** por `LEFT JOIN` em `ranks`/`organizations`, só de leitura |

Pontos que economizam depuração:

- Os pares FK/nome andam juntos na leitura, mas **só o UUID é aceito na escrita** de usuário; `posto_graduacao` e `organizacao_militar` não existem como colunas. Ver [[gestao-usuarios]] e [[organizacoes-om]].
- Como o `LEFT JOIN` é permissivo, um usuário sem posto ou sem OM volta com esses quatro campos em `null`, inclusive o par de nomes. Renderize com fallback, não assuma string.
- Não há envelope de paginação: `data` é um array puro, no máximo 20 itens (`LIMIT 20`, sem offset). Não existe `total` nem `hasMore` para distinguir "20 resultados" de "20 de muitos".

> **Nota histórica.** guia *07-compartilhamento* (absorvido) §1.3 mostra o item da busca apenas com `id`, `username`, `nome`, `posto_graduacao` e `organizacao_militar`; a query real (`users.queries.js:48-49`) seleciona também `rank_id` e `organization_id`.

## Fontes

- guia *07-compartilhamento* (absorvido): rotas `/sharing` e `/sharing/users`, permissão `manage`, enum de permissões, `owner` não concedível, busca de usuários, formatos de request/response (com duas divergências de formato registradas acima).
- guia *02-atlas-basico* (absorvido): hierarquia `owner > manage > write > comment > read`, ordem de resolução de permissão, matriz de ações por permissão, alerta sobre gates que esquecem `manage`, campo `user_permission` na listagem de atlas.
- Código verificado: `ebgeo_backend/src/modules/sharing/{routes,controller,service,queries,schemas}.js`, `src/middleware/permissions.js`, `src/utils/roles.js`, `src/modules/users/{routes,service,queries,schemas}.js`, `src/modules/atlas/atlas.queries.js`, `src/database/migrations/002_atlas.sql`, `src/modules/collab/collab.gateway.js`; `ebgeo_web/src/js/modals/sharing.modal.js`, `src/js/store/sync/{ws-client,sync-engine,api-client}.js`.
