# API Keys de Usuário

Chave UUID única por usuário para integração máquina-a-máquina, rotacionável atomicamente pelo próprio usuário ou por admin, com a chave antiga arquivada em `api_key_history` na mesma transação e o evento auditado.

## Modelo de dados

A chave viva mora na linha quente de `users`: `api_key UUID UNIQUE` (`src/database/migrations/001_core.sql:101`). Uma chave viva por usuário, sem escopo, sem expiração, sem nome/rótulo. Não existe conceito de "várias chaves por usuário" nem de chave com permissão reduzida: a chave carrega **exatamente** a identidade do usuário, portanto todo o poder dele (ver [[permissoes-atlas]] e [[sintese-eixos-de-permissao]]).

O histórico fica em `api_key_history` (`001_core.sql:154-163`):

| Coluna | Nota |
|---|---|
| `user_id` | FK para `users` |
| `api_key` | a chave revogada, em claro (UUID) |
| `created_at` | **sempre `NULL` na prática** (ver armadilha abaixo) |
| `revoked_at` | `NOW()` no momento da rotação |
| `revoked_by` | quem rotacionou (o próprio usuário ou o admin) |

Constraint `UNIQUE (user_id, api_key)` e índice `idx_api_key_history_user`.

A chave é gravada **em claro** (UUID, não hash) tanto em `users` quanto no histórico. É uma decisão consciente: o lookup de autenticação é uma igualdade indexada por request (`FIND_USER_BY_API_KEY`), e hashear obrigaria a varrer. A consequência operacional é que quem lê o banco lê todas as credenciais M2M, então acesso ao banco é acesso total.

## Como a chave autentica

A chave entra pelo middleware global e não bloqueante `flexibleAuth` (ver [[auth-flexivel]]), em `src/middleware/flexible-auth.js:42-54`, por header ou query:

```
x-api-key: 550e8400-e29b-41d4-a716-446655440000
GET /api/v1/...?api_key=550e8400-...
```

O lookup é `FIND_USER_BY_API_KEY` (`src/modules/users/users.queries.js:203-206`), que exige `u.is_active = true` e faz join com `ranks` e `organizations`. O resultado vira `req.user` via `mapDbUser` e marca `req.authVia = 'api_key'`.

### Precedência: a armadilha número um

`flexible-auth.js:45-54` é curto-circuito duro:

```js
const apiKey = req.get('x-api-key') || req.query?.api_key;
if (apiKey) {
  if (UUID_RE.test(apiKey)) { /* lookup, pode setar req.user */ }
  return next();          // <— retorna SEMPRE
}
```

Ou seja: **se `x-api-key` (ou `?api_key=`) estiver presente, cookie e `Authorization: Bearer` nem são lidos**. Uma chave já rotacionada, ou uma string que não é UUID, deixa a requisição **anônima**, mesmo com um Bearer perfeitamente válido no mesmo request, e as rotas estritas respondem `401`. Sintoma clássico: um cliente que guarda a chave antiga num interceptor global passa a receber 401 em tudo depois da rotação, e o Bearer "que estava lá" não salva. Chave malformada nem consulta o banco (`UUID_RE` barra antes) e é tratada como anônimo, comportamento fixado em `tests/integration/identity.test.js:79-80`.

### `is_active` do usuário sim, org ativa só na rota estrita

O lookup filtra apenas `u.is_active = true`. Ele **não** consulta `organizations.is_active`. Quem pega isso é o middleware estrito `auth` (`src/middleware/auth.js:84-98`): como o principal de API key tem `id` UUID real, ele passa por `getLiveAuthState` e recebe `401 Account is inactive` / `403 Organization is inactive`, além de ter o `role` global reconciliado ao vivo. Consequência prática: em **rotas flexíveis** (que atendem anônimo), uma chave de usuário ativo numa OM desativada continua resolvendo `req.user`. Ver [[organizacoes-om]].

### Sem sliding session, sem refresh

O ramo de API key retorna antes de qualquer lógica de expiração/renovação de cookie. A chave é um credencial **não expirante**: não há TTL, não há rotação automática, não participa de [[refresh-token-rotacao]] nem do ciclo de [[autenticacao-jwt]]. A única forma de invalidar é rotacionar (ou desativar o usuário).

## Rotação

Endpoints (`src/modules/users/users.routes.js:15,26`):

| Método | Rota | Guardas |
|---|---|---|
| POST | `/api/v1/users/me/api-key/rotate` | `auth` (qualquer autenticado, rotaciona a própria) |
| POST | `/api/v1/users/:userId/api-key/rotate` | `auth` + `requireAdmin` + `validate(userIdParamsSchema)` |

Ambos caem no mesmo serviço, mudando só o `userId` alvo (`src/modules/users/users.controller.js:26-29` e `76-79`); `actorId` é sempre `req.user.id`, logo a rotação própria registra o usuário como seu próprio revogador.

### Atomicidade real

`ROTATE_API_KEY` (`src/modules/users/users.queries.js:186-197`) é **um único statement** com CTE:

```sql
WITH old AS (
  INSERT INTO api_key_history (user_id, api_key, created_at, revoked_at, revoked_by)
  SELECT id, api_key, NULL::timestamptz, NOW(), $2
  FROM users WHERE id = $1 AND api_key IS NOT NULL
  RETURNING 1
)
UPDATE users SET api_key = gen_random_uuid(), updated_at = NOW()
WHERE id = $1
RETURNING api_key
```

Dois detalhes que importam:

- A CTE `old` e o `UPDATE` enxergam o **mesmo snapshot**, então o `SELECT` do histórico lê a chave *antiga*, não a nova. É o que garante o arquivamento correto sem passo intermediário.
- O predicado `api_key IS NOT NULL` cobre o primeiro uso: usuário que nunca teve chave arquiva zero linhas e o `UPDATE` gera a primeira. Ou seja, `POST /me/api-key/rotate` é também o endpoint de **criação** da chave, não existe rota separada de "gerar".

**Não há janela com duas chaves válidas.** Como o `UPDATE` é atômico, a chave antiga para de autenticar no mesmo instante em que a nova nasce, verificado em `tests/integration/identity.test.js:69-70` (chave antiga → 401, nova → 200).

### Auditoria na mesma transação

`rotateApiKey` (`src/modules/users/users.service.js:255-269`) envolve query e auditoria em `tx`:

```js
const row = await t.oneOrNone(Q.ROTATE_API_KEY, [userId, actorId]);
if (!row) throw new NotFoundError('User');
await createAudit(req, { action: 'API_KEY_ROTATE', actorId, targetType: 'USER', targetId: userId }, t);
```

O `createAudit` recebe o handle `t`, então o evento `API_KEY_ROTATE` reverte junto se algo falhar. `API_KEY_ROTATE` está na lista fechada do CHECK em `001_core.sql:174`. Ver [[auditoria]].

Note o `oneOrNone` deliberado (não `one`): usuário inexistente casa zero linhas e vira `404` limpo em vez de a `QueryResultError` do pg-promise vazar como `500`.

### Resposta e erros

`200 → { "data": { "apiKey": "<uuid>" } }`. Essa é a **única** vez que a chave nova aparece: não há rota de leitura da chave. Nenhuma query de `users` (perfil, listagem admin, busca) seleciona `api_key`, confirmado por grep no módulo inteiro. Perdeu, rotaciona de novo.

Erros da rota admin, conforme [[erros-api]] e [[sintese-contrato-erros-http]]:

- `401` sem credencial válida.
- `403` autenticado mas não-admin (`requireAdmin`).
- `422` `:userId` não é UUID (Joi → `err.isJoi` → 422 em `src/middleware/error-handler.js:18,28-33`).
- `404` UUID bem formado mas sem usuário correspondente (`NotFoundError('User')`, `users.service.js:264`). O doc 12 lista só 403 e 422 para essa rota; o 404 existe e é intencional.

## Armadilhas

- **`created_at` no histórico é sempre `NULL`.** A CTE insere literalmente `NULL::timestamptz` (`users.queries.js:190`), porque `users` não guarda quando a chave atual foi emitida. Não escreva relatório de "vida útil da chave" em cima dessa coluna: só `revoked_at` é confiável, e a data de emissão de uma chave só é inferível como o `revoked_at` da chave anterior.
- **Desativar usuário não apaga a chave.** `DEACTIVATE`/`REACTIVATE_USER` (`users.queries.js:159-167`) só mexem em `is_active`. A chave continua na linha e volta a autenticar assim que o usuário é reativado. Se a desativação foi por comprometimento, **rotacione explicitamente** além de desativar. Ver [[gestao-usuarios]].
- **A chave na query string vaza em log de proxy.** O backend redige `api_key` dos seus próprios logs (`SENSITIVE_QUERY_KEYS` em `src/utils/redact-url.js:6`, aplicado no error handler), mas isso não alcança nginx, CDN, histórico de shell ou Referer. Prefira sempre o header `x-api-key`; a query existe para clientes que não conseguem setar headers. Ver [[hardening-borda-api]].
- **Chave não é para browser.** Não tem CSRF protection própria (não é cookie, então não é auto-enviada, mas também não expira). Na SPA use `Authorization: Bearer` normalmente.
- **`mapDbUser` descarta campos que a query traz.** `FIND_USER_BY_API_KEY` seleciona `organizacao_militar` e `rank_id`, mas `mapDbUser` (`flexible-auth.js:18-28`) monta `req.user` só com `id/username/nome/posto_graduacao/role/organization_id/org_role`. Se um handler downstream esperar `organizacao_militar` em `req.user`, ele funciona no caminho JWT e quebra no caminho API key.
- **Nenhum rate limit específico na rotação.** As rotas em `users.routes.js:15,26` levam só `auth`/`requireAdmin`. Rotação em loop é barata para o cliente e cresce `api_key_history` sem teto.

## Fontes

- guia *12-multiorg-identidade-auditoria* (absorvido): Parte 3 (ordem de precedência do `flexibleAuth`, sliding session, chave inválida = anônimo) e Parte 4 (contrato dos dois endpoints de rotação, resposta `{ apiKey }` irrecuperável, auditoria `API_KEY_ROTATE`, histórico com `revoked_at`/`revoked_by`); Parte 5 para o shape do evento de auditoria.
- guia *09-admin* (absorvido): tabela de rotas admin, posicionando `/users/me/api-key/rotate` (User) e `/users/:userId/api-key/rotate` (Admin) no inventário de endpoints administrativos.
- Código do `ebgeo_backend` (manda sobre a prosa): `src/middleware/flexible-auth.js`, `src/middleware/auth.js`, `src/modules/users/{users.queries,users.service,users.controller,users.routes}.js`, `src/database/migrations/001_core.sql`, `src/middleware/error-handler.js`, `src/utils/redact-url.js`, `tests/integration/identity.test.js`.
