# Administração do Log de Operações de Sync

Endpoints admin por atlas que expõem estatísticas do log de operações (minVersion, currentVersion, totalOperations) e permitem cleanup por dias ou versão, elevando `min_version` e forçando snapshot completo nos clientes atrasados.

## Para que existe

A tabela `operations` ([[tabela-operations]]) cresce indefinidamente: todo push de [[envelope-operacao]] vira uma linha durável, e é dela que sai o pull incremental de [[snapshot-e-pull-incremental]]. Sem poda, o histórico de um atlas antigo vira o maior objeto do banco. O cleanup troca histórico por espaço: operações antigas somem e o atlas passa a atender clientes atrasados com snapshot completo em vez de replay.

Consequência direta: **cleanup é irreversível e degrada o custo de reconexão** dos clientes que ficaram offline por muito tempo. Não é uma otimização gratuita.

## Rotas e gate de permissão

Montadas sob o router de atlas (`src/modules/atlas/atlas.routes.js:49`, `router.use('/:atlasId/sync', syncRoutes)`):

| Método | Rota | Gate |
|---|---|---|
| GET | `/api/v1/atlas/:atlasId/sync/admin/stats` | `auth` + `requireAdmin` |
| POST | `/api/v1/atlas/:atlasId/sync/admin/cleanup` | `auth` + `requireAdmin` + `validate(cleanupSchema)` |

Declaradas em `src/modules/sync/sync.routes.js:13-14`.

**Armadilha 1, o gate é papel global, não papel no atlas.** `requireAdmin` (`src/middleware/require-admin.js`) só olha `req.user.role !== 'admin'`; não há `requireAtlasPermission`. Portanto o dono de um atlas que não seja admin da plataforma **não** consegue limpar o próprio log, e um admin global consegue limpar qualquer atlas sem ser membro dele. Isso é um eixo de permissão distinto do de [[permissoes-atlas]] e de [[permissao-vs-papel]]. Sem credencial o middleware devolve 401, com credencial não-admin devolve 403 (contrato em [[erros-api]]).

**Armadilha 2, a ordem das rotas é carregada.** `/admin/stats` e `/admin/cleanup` precisam vir antes de `GET /:version` (comentário explícito em `sync.routes.js:12`). Se `GET /:version` capturasse `admin`, o controller faria `parseInt('admin', 10) || 0` (`sync.controller.js:44`), ou seja `sinceVersion = 0`, e devolveria um snapshot inteiro em vez de 404.

## GET /admin/stats

`getCleanupStats` (`src/modules/sync/sync.service.js:859-877`) dispara três consultas em paralelo e devolve:

```json
{ "data": { "atlasId": "...", "minVersion": 100, "currentVersion": 500,
            "oldestOperationVersion": 100, "totalOperations": 400 } }
```

- `minVersion` / `currentVersion` vêm de `GET_ATLAS_SYNC_INFO`, que filtra `deleted_at IS NULL` (`sync.queries.js:28-32`). Atlas soft-deletado, portanto, não tem stats.
- `oldestOperationVersion` é `MIN(server_version)` da tabela e pode ser `null` quando o log está vazio (`sync.service.js:874`).
- O controller converte `null` do service em 404 `NotFoundError('Atlas')` em vez de responder 200 com `data: null` (`sync.controller.js:50-59`).

Leitura útil: `oldestOperationVersion - minVersion` mede quanto histórico ainda existe abaixo do corte, e `currentVersion - oldestOperationVersion` mede a janela de replay disponível.

## POST /admin/cleanup

Corpo validado por `cleanupSchema` (`src/modules/sync/sync.schemas.js:52-55`):

```js
keepFromVersion: Joi.number().integer().min(0),
keepDays:        Joi.number().integer().min(1).max(365).default(7),
// .or('keepFromVersion', 'keepDays')
```

Resposta: `{ "data": { "deletedCount": 150, "newMinVersion": 250 } }`.

`cleanupOldOperations` (`sync.service.js:816-855`) roda tudo dentro de `tx()` e decide o corte assim:

1. Se `keepFromVersion` foi informado, `deleteBeforeVersion = keepFromVersion` (nenhum clamp).
2. Senão, calcula `cutoffDate = hoje - keepDays` e busca `MIN(server_version)` das operações com `created_at >= cutoff`. Se nada for mais novo que o corte, retorna `{ deletedCount: 0, newMinVersion: 0 }` **sem tocar em `min_version`** (`sync.service.js:833-838`), ou seja, um atlas parado há meses não é zerado por engano.
3. Se `deleteBeforeVersion <= 0`, retorna zerado, também sem escrever.
4. Executa `DELETE FROM operations WHERE atlas_id = $1 AND server_version < $2` (`sync.queries.js:111-115`) e em seguida `UPDATE atlas SET min_version = $2` (`sync.queries.js:117-121`).

Note a assimetria de fronteiras: o delete é `<` e o `min_version` recebe exatamente `deleteBeforeVersion`, logo `min_version` é a versão da operação mais antiga **sobrevivente**.

**Armadilha 3, `keepFromVersion: 0` é silenciosamente ignorado.** O controller faz `keepFromVersion ? parseInt(keepFromVersion, 10) : undefined` (`sync.controller.js:65`). O zero é falsy, então o caminho por dias assume com `keepDays` (que o Joi sempre preenche com 7 por causa do `.default(7)`). O schema aceita `min(0)`, mas o controller nunca repassa 0. Na prática isso é inofensivo, porque o service trataria 0 como no-op de qualquer jeito, mas quem depurar o "por que meu corte 0 virou 7 dias" perde tempo aqui.

**Armadilha 4, `keepFromVersion` tem precedência e não é limitado por `currentVersion`.** Enviar os dois campos faz `keepDays` ser ignorado. E nada impede `keepFromVersion` maior que a `currentVersion` do atlas: o log é esvaziado e `min_version` passa a ficar **acima** da versão corrente, o que condena todo cliente a receber snapshot em cada pull até que novas operações elevem `current_version`. Consulte `/admin/stats` antes e escolha um valor entre `oldestOperationVersion` e `currentVersion`.

## Efeito no pull e no WebSocket

`pullOperations` (`sync.service.js:770-800`) é o único consumidor real de `min_version`:

- `sinceVersion === 0 || sinceVersion < minVersion` → snapshot completo (`isSnapshot: true`), já filtrado por tier (viewer não recebe [[comentario-espacial]]).
- Caso contrário → incremental via `server_version > $2` (`sync.queries.js:15-19`). Um cliente exatamente em `sinceVersion === minVersion` **ainda pega incremental**, não snapshot.

Isso vale igualmente para o replay do canal de tempo real: `sync_request` no [[canal-collab-websocket]] chama o mesmo `pullOperations` (`src/modules/collab/collab.handlers.js:259`). Ou seja, um cleanup agressivo também transforma reconexões de [[websocket-collab]] em downloads de snapshot inteiro, inclusive as reconexões causadas por queda de rede. O cliente aplica isso via `applyRemoteSnapshot` ([[aplicacao-operacoes-remotas]]), que substitui estado local, e não via merge incremental de [[sync-lww-operacoes]].

Operações locais ainda na [[fila-operacoes-outbound]] do cliente não são perdidas pelo cleanup, elas são enviadas depois e recebem versões novas; a garantia de não duplicar continua sendo a de [[idempotencia-e-convergence-guard]], que não depende do histórico podado.

## Operação recomendada

- Rode `/admin/stats` antes e depois; guarde `deletedCount` e `newMinVersion`.
- Prefira `keepDays` (7 a 30) a `keepFromVersion`: o caminho por dias é auto-limitado pelas operações existentes, o caminho por versão não tem rede de segurança.
- Dimensione `keepDays` pela maior janela offline plausível do time. Abaixo dela, todo retorno de campo vira snapshot.
- Cron periódico é o padrão sugerido pelo guia; não há agendador embutido no backend, é operação externa ([[deploy-backend]]).

## Superfície de UI

Não há chamada a `sync/admin/stats` nem a `sync/admin/cleanup` no cliente web (`src/js/store/sync/api-client.js` e o restante de `src/` não referenciam essas rotas). O checklist do guia lista "botão de cleanup com confirmação" como item **a implementar**, não como funcionalidade existente. Hoje isso é operação por HTTP direto ou ferramenta administrativa externa; ver [[gestao-usuarios]] e [[auditoria]] para o que de fato existe no painel.

## Fontes

- `docs/guias/09-admin.md` (Parte 4, linhas 563-641): endpoints, forma do JSON de request/response, semântica dos campos de stats, impacto do cleanup e recomendação de cron; checklist de UI ainda pendente.
- `ebgeo_backend/src/modules/sync/sync.routes.js:12-14`: montagem das rotas admin e a razão da ordem antes de `/:version`.
- `ebgeo_backend/src/modules/sync/sync.controller.js:49-70`: 404 para atlas inexistente, coerção de `keepFromVersion`/`keepDays`.
- `ebgeo_backend/src/modules/sync/sync.service.js:770-877`: regra de snapshot por `min_version`, algoritmo do cleanup, no-ops e cálculo de stats.
- `ebgeo_backend/src/modules/sync/sync.queries.js:15-19,28-32,111-127`: fronteiras `>` / `<` das consultas e update de `min_version`.
- `ebgeo_backend/src/modules/sync/sync.schemas.js:52-55`: validação Joi do corpo do cleanup.
- `ebgeo_backend/src/middleware/require-admin.js`: gate por papel global (401 sem credencial, 403 sem admin).
- `ebgeo_backend/src/modules/collab/collab.handlers.js:259`: `sync_request` reutiliza `pullOperations`, logo herda o efeito do cleanup.
- `ebgeo_backend/src/database/migrations/002_atlas.sql:45`: coluna `min_version BIGINT NOT NULL DEFAULT 0`.
