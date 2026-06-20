# Fase 5 — Multi-org, identidade única e auditoria

> **✅ STATUS: IMPLEMENTADA** (T1 organizations + módulo; T2 `organization_id` FK + backfill; T3 claim de
> org + `org_role` no JWT [emissor único, tokens legados OK]; T4 CHECK em `role`; T5 `api_key` +
> `api_key_history` + rotação atômica; T6 `flexibleAuth` global não-bloqueante [Bearer/cookie/x-api-key] +
> `authorize()` + `auth` aceita `req.user` pré-populado; T7 `audit_trail` + `createAudit(req,params,t?)`
> transacional + `GET /api/v1/audit` [auditado: ORG_*, API_KEY_ROTATE, USER_DELETE]; T8 `EnvironmentManager`).
> Migrações `012`–`015`. Suite verde (620 casos). **Deferido:** T9 (logging multistream por categoria —
> nicety operacional) e auditoria de TODOS os fluxos destrutivos (ATLAS_DELETE/SHARING_CHANGE) — infra
> pronta, basta chamar `createAudit` nos demais controllers.
> **Depende de:** `fase-0` (hardening, `validateEnvVariables`, auth timing-safe, revogação de token).
> **Esforço:** Alto.
> **Pode correr em paralelo com:** fase-1, fase-2, fase-3 (todas só dependem da fase-0).
> **Leia antes:** [`_padroes.md`](_padroes.md) e [`00-visao-geral.md`](00-visao-geral.md). Apêndices
> verbatim em [`99-referencia.md`](99-referencia.md).

---

## 1. Objetivo & contexto

Hoje o backend **não tem conceito de organização/tenant**. `users.organizacao_militar` é um
`VARCHAR(255)` de **texto livre, sem FK** (`src/database/migrations/001_core.sql:21`). O JWT carrega
apenas `{sub, username, nome, posto, role}` com `role ∈ {user, admin}` **global** (sem CHECK na
coluna: `001_core.sql:16`). Não há `audit_trail`, `api_keys`/`api_key_history` nem `user_groups` em
nenhuma das 5 migrações. O único rastro de "auditoria" é o log CRDT (`operations.created_at/user_id`)
e `users.last_login_at`. A autenticação é só JWT + `refresh_tokens` (`001_core.sql:36-43`).

Esta fase entrega a **camada de identidade e tenant** sobre a qual a fase-6 (acesso geográfico) e a
fase-7 (gateway + 360) se apoiam:

1. **Entidade `organizations` de primeira classe** — criada **ANTES de ativar multiusuário**,
   mesmo que comece com uma org default. (Risco registrado em `00-visao-geral.md`: introduzir
   multi-org depois do atlas em produção custa muito mais.)
2. **Migração `organizacao_militar` texto → FK** `organization_id` (nullable, backfill por nome),
   mantendo a coluna texto durante a transição.
3. **Papéis org-scoped + claim de org no JWT** — payload comum `{sub, role, organization_id}` com
   **emissor único** compartilhado pelos três consumidores (web, nomes, 360). O `ebgeo_360` **já**
   tem multi-org (`organizations` + `organization_id` + papéis `system_admin`/`om_data_admin`) e
   JWT `{sub, org, role, login}` — é a base de referência (ver `99-referencia.md`).
4. **Auth flexível JWT-ou-APIkey** — middleware global não-bloqueante; a rota decide se exige.
   Sliding session (renova token < 5min para expirar). Cookie httpOnly/secure/sameSite por ambiente.
5. **`api_key_history`** — rotação atômica em CTE.
6. **Auditoria transacional** — tabela `audit_trail` + helper `createAudit(req, params, t?)` que
   participa da transação do negócio.
7. **Logging por categoria** (pino multistream) — operacional, em arquivo; distinto da auditoria
   (negócio, no banco, consultável).
8. **`EnvironmentManager` singleton** — centraliza decisões por ambiente (cookie, cors, db max,
   helmet, useHttps).
9. **CHECK em `users.role`** + documentar `atlas.owner_id` sem `ON DELETE` (reatribuir antes de
   hard-delete).

**Restrição aditiva (vale para toda a fase):** nada pode quebrar o caminho anônimo nem o contrato
do frontend. `organization_id` entra **nullable**; o JWT ganha um claim novo sem remover os
existentes; a auth flexível é não-bloqueante por padrão.

---

## 2. Pré-requisitos / dependências

| Dependência | Por quê |
|-------------|---------|
| **fase-0 concluída** | `validateEnvVariables()` fail-fast (a fase-5 estende com `COOKIE_SECRET`, `USE_HTTPS` etc.); auth timing-safe e `REVOKE_ALL_USER_TOKENS` já existem (`auth.queries.js:35`); helmet/CORS/poolMax endurecidos — o `EnvironmentManager` desta fase passa a ser a **fonte única** dessas decisões. |
| **Migração head = `005_client_id_text.sql`** | Próximas migrações desta fase são `006`+ (mas ver nota de ordenação abaixo — a fase-1 também reivindica `006`–`008`). |

> **Nota de ordenação de migração (coordenação entre fases).** `_padroes.md §7` recomenda a ordem
> `006 grid_style → 007 idempotência → 008 catalog_layers → postgis+ng → organizations+user_groups
> → zones/permissions → model_permissions → audit_trail/api_keys`. Como as fases correm em paralelo,
> **não fixe números absolutos por adivinhação**: ao implementar, use o **próximo número livre** em
> `src/database/migrations/` no momento da implementação e mantenha a **ordem relativa** (organizations
> antes de user_groups; api_keys antes de api_key_history; audit_trail por último deste bloco). Os
> nomes de arquivo neste doc usam `NNN_` como placeholder — substitua pelo próximo livre.

---

## 3. Decisões de arquitetura aplicáveis

- **Multi-org precede multiusuário.** Mesmo com uma única org default, a tabela e a FK entram agora.
- **Identidade única, emissor único.** Um só `JWT_SECRET`/algoritmo (`HS256`), um só formato de
  payload. Os três consumidores confiam no mesmo segredo e claims. O backend passa a **emitir
  `organization_id` no JWT** (hoje não emite). Ver o mapeamento de papéis abaixo.
- **Vocabulário de papéis (decisão registrada).** O backend mantém `role` **global** em
  `{user, admin}` com CHECK, mas **adiciona** o papel org-scoped. Recomendação: introduzir uma
  coluna/claim `org_role ∈ {owner, admin, editor, viewer}` por organização (espelha o
  `UserRole` do frontend `session-context.js`) **sem** quebrar o `role` global atual. A permissão
  **por-atlas** (`owner/write/read`, resolvida em `src/middleware/permissions.js`) continua
  ortogonal. Mapeamento de compat já documentado no `CLAUDE.md`: `owner→owner`, `write→editor`,
  `read→viewer`, `admin global→admin`.
  - *Ramo A (recomendado):* `org_role` é coluna em `users` (1 user → 1 org → 1 papel org).
    Simples, cobre o caso militar (um usuário pertence a uma OM).
  - *Ramo B:* tabela `user_organizations(user_id, org_id, org_role)` N:N. Mais flexível, mas o
    JWT teria de carregar a org "ativa". **Adiar** até haver requisito de usuário multi-org.
- **Auth flexível não-bloqueante.** O middleware global **popula `req.user` ou deixa `undefined`** —
  **a rota decide** se exige (via `auth` estrito ou `requireAdmin`/`requireOrgRole`). Isso preserva
  o caminho anônimo e não muda o comportamento das rotas que já usam `auth`.
- **Auditoria ≠ logging.** **Auditoria** = evento de negócio, no banco (`audit_trail`), consultável,
  transacional. **Logging** = operacional, em arquivo, por categoria. Não confundir: uma ação
  destrutiva gera **ambos**.
- **`EnvironmentManager` é a fonte única** das decisões por ambiente. `config.js` continua sendo o
  leitor de `.env`; o `EnvironmentManager` deriva **decisões** (cookie flags, cors, helmet, useHttps,
  db max) a partir de `config.isProd/isDev/isTest`.
- **Padronizar `gen_random_uuid()`** (pgcrypto, já em uso — `001_core.sql:7`) em todo schema novo.
  **Não** introduzir `uuid_generate_v4`. **Não** copiar a sanitização "blunt" do `_2` (ver
  anti-padrões em `99-referencia.md`).

---

## 4. Tarefas

### Tarefa 1: Criar entidade `organizations` + org default

**Objetivo:** Tabela `organizations` de primeira classe, semeada com uma organização default, para
servir de destino da FK de `users` e de tenant do JWT.

**Arquivos afetados:**
- `src/database/migrations/NNN_organizations.sql` (criar)
- `src/modules/organizations/organizations.queries.js` (criar)
- `src/modules/organizations/organizations.service.js` (criar)
- `src/modules/organizations/organizations.controller.js` (criar)
- `src/modules/organizations/organizations.routes.js` (criar)
- `src/modules/organizations/organizations.schemas.js` (criar)
- `src/modules/organizations/index.js` (criar)
- `src/app.js` (montar `/api/v1/organizations`)

**Padrão de código:** template canônico de módulo (`_padroes.md §1`, ref. `src/modules/atlas/`);
migração aditiva (`_padroes.md §7`).

**Implementação:**
1. Migração:
   ```sql
   -- Path: src/database/migrations/NNN_organizations.sql
   -- Multi-org: first-class organizations entity (precedes multiuser activation)
   CREATE TABLE organizations (
       id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       nome        VARCHAR(255) NOT NULL,
       slug        VARCHAR(100) UNIQUE NOT NULL,   -- url-safe, estável
       sigla       VARCHAR(50),                    -- ex.: sigla da OM
       is_active   BOOLEAN NOT NULL DEFAULT TRUE,
       created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   CREATE UNIQUE INDEX idx_organizations_slug ON organizations(slug);

   -- Org default determinística (id fixo p/ idempotência de backfill e testes)
   INSERT INTO organizations (id, nome, slug, sigla)
   VALUES ('00000000-0000-0000-0000-000000000001', 'Organização Padrão', 'default', 'DEFAULT')
   ON CONFLICT (slug) DO NOTHING;
   ```
2. Módulo `organizations` com CRUD mínimo: `GET /api/v1/organizations` (lista, auth),
   `GET /:id` (auth), `POST` / `PUT /:id` / `DELETE /:id` (apenas admin global — soft-delete via
   `is_active=false`). Use `requireAdmin` nas rotas de escrita.
3. Schemas Joi: `createOrganizationSchema` (`nome` required, `slug` required pattern
   `/^[a-z0-9-]+$/`, `sigla` opcional), `updateOrganizationSchema`.
4. Re-export em `index.js`; montar em `app.js` na seção de rotas autenticadas.

**Critérios de aceitação:**
- [ ] Migração cria `organizations` e semeia a org `slug='default'` de forma idempotente.
- [ ] `GET /api/v1/organizations` retorna a org default após migração.
- [ ] Criar org com `slug` duplicado → 409 `CONFLICT`.
- [ ] Rotas de escrita exigem admin global (403 para `user`).

**Testes:**
- `tests/integration/organizations.test.js`: lista contém default; create/update/soft-delete por
  admin; create com slug inválido → 422; create por `user` → 403; slug duplicado → 409.

**Dependências:** nenhuma (primeira tarefa da fase).

---

### Tarefa 2: Migrar `users.organizacao_militar` → FK `organization_id`

**Objetivo:** Adicionar `users.organization_id UUID REFERENCES organizations(id)` (nullable),
backfill por nome a partir do texto livre, mantendo a coluna texto durante a transição.

**Arquivos afetados:**
- `src/database/migrations/NNN_user_organization_fk.sql` (criar — deve rodar **após** a de orgs)
- `src/modules/auth/auth.queries.js` (incluir `organization_id` nos SELECT/INSERT)
- `src/modules/users/users.queries.js` (incluir `organization_id`)

**Padrão de código:** migração estrutural (FK em coluna existente) — `_padroes.md §7` ("Estrutural").

**Implementação:**
1. Migração:
   ```sql
   -- Path: src/database/migrations/NNN_user_organization_fk.sql
   -- Migra organizacao_militar (texto livre) -> FK organization_id (nullable, transição)
   ALTER TABLE users
       ADD COLUMN organization_id UUID REFERENCES organizations(id);

   -- Backfill: casa nome textual existente com organizations.nome (case-insensitive).
   -- Texto não casado fica NULL e é atribuído à org default no passo seguinte.
   UPDATE users u
   SET organization_id = o.id
   FROM organizations o
   WHERE u.organization_id IS NULL
     AND u.organizacao_militar IS NOT NULL
     AND LOWER(TRIM(u.organizacao_militar)) = LOWER(TRIM(o.nome));

   -- Restante (texto livre não casado ou NULL) -> org default
   UPDATE users
   SET organization_id = '00000000-0000-0000-0000-000000000001'
   WHERE organization_id IS NULL;

   CREATE INDEX idx_users_organization ON users(organization_id);
   -- NÃO dropar organizacao_militar agora: coluna texto mantida durante a transição.
   -- Tornar NOT NULL é opcional e fica para migração futura, após validação em produção.
   ```
2. Atualizar `auth.queries.js`: `FIND_USER_BY_USERNAME`, `FIND_USER_BY_ID`, `INSERT_USER` passam a
   selecionar/gravar `organization_id`. `INSERT_USER` ganha `organization_id` como parâmetro (default
   = org default quando não informado no register).
3. Atualizar `users.queries.js` análogo (`INSERT_USER_ADMIN`, `UPDATE_USER_ADMIN`, SELECTs admin).

**Critérios de aceitação:**
- [ ] Após migração, **todo** usuário tem `organization_id` não-nulo (default cobre os não casados).
- [ ] `organizacao_militar` continua presente e legível (transição).
- [ ] Login e perfil retornam `organization_id`.
- [ ] FK rejeita `organization_id` inexistente.

**Testes:**
- `tests/integration/users-admin.test.js` (estender): admin cria usuário com `organization_id`
  válido; com id inexistente → erro; perfil expõe `organization_id`.
- Teste de migração/backfill: seed usuário com `organizacao_militar` que casa uma org → recebe a FK
  correta; texto livre não casado → org default.

**Dependências:** Tarefa 1.

---

### Tarefa 3: Claim de org no JWT + papel org-scoped (emissor único)

**Objetivo:** Emitir `organization_id` (e `org_role`) no JWT, padronizar o payload como emissor
único compartilhável (web/nomes/360), sem quebrar os claims atuais.

**Arquivos afetados:**
- `src/modules/auth/auth.service.js` (`generateAccessToken`, `login`, `refresh`)
- `src/middleware/auth.js` (`verifyAndMapUser` mapeia `organization_id`/`org_role`)
- `src/database/migrations/NNN_user_org_role.sql` (criar — coluna `org_role`, Ramo A)

**Padrão de código:** `auth.service.js:34-46` (`generateAccessToken`), `auth.js:23-39`
(`verifyAndMapUser`).

**Implementação:**
1. Migração (Ramo A recomendado): coluna `org_role` em `users`:
   ```sql
   -- Path: src/database/migrations/NNN_user_org_role.sql
   ALTER TABLE users
       ADD COLUMN org_role VARCHAR(20) NOT NULL DEFAULT 'viewer'
       CHECK (org_role IN ('owner','admin','editor','viewer'));
   ```
2. `generateAccessToken(user)` passa a incluir `organization_id` e `org_role`:
   ```javascript
   // auth.service.js — payload de emissor único
   function generateAccessToken(user) {
     return jwt.sign(
       {
         sub: user.id,
         username: user.username,
         nome: user.nome,
         posto: user.posto_graduacao,
         role: user.role || 'user',                 // global {user,admin} (mantido)
         organization_id: user.organization_id,     // NOVO: claim de org (tenant)
         org_role: user.org_role || 'viewer',       // NOVO: papel org-scoped
       },
       config.jwt.secret,
       { expiresIn: config.jwt.accessExpiry }
     );
   }
   ```
3. `verifyAndMapUser(token)` mapeia os novos claims para `req.user`:
   ```javascript
   // auth.js — adicionar ao objeto retornado
   organization_id: payload.organization_id ?? null,
   org_role: payload.org_role || 'viewer',
   ```
4. `login`/`refresh` já carregam o user do banco; garantir que `FIND_USER_BY_USERNAME`/`_BY_ID`
   selecionem `organization_id` e `org_role` (Tarefa 2 já cobre `organization_id`; adicionar
   `org_role`). `login` retorna `organization_id`/`org_role` no objeto `user` da resposta.
5. **Compat de verificação (`HS256`):** garantir `jwt.verify(token, secret, { algorithms: ['HS256'] })`
   (baseline de segurança da fase-0). Documentar o contrato de payload em `99-referencia.md` para o
   gateway/360 (fase-7).

**Critérios de aceitação:**
- [ ] Token emitido contém `organization_id` e `org_role` além dos claims atuais.
- [ ] `req.user` expõe `organization_id` e `org_role` em rotas autenticadas.
- [ ] Tokens **antigos** sem o claim ainda validam (`org_role` cai para `'viewer'`,
      `organization_id` cai para `null`) — não-regressão.
- [ ] `org_role` fora do enum é rejeitado pelo CHECK no banco.

**Testes:**
- `tests/integration/auth.test.js` (estender): decodificar token de `login` e checar
  `organization_id`/`org_role`; `GET /auth/me` reflete a org; token legado (gerado sem o claim) ainda
  passa em rota autenticada.

**Dependências:** Tarefa 2 (coluna `organization_id` no banco).

---

### Tarefa 4: CHECK em `users.role` + documentar `atlas.owner_id`

**Objetivo:** Restringir `users.role` ao vocabulário válido (hoje aceita qualquer string) e
documentar o bloqueio de hard-delete por `atlas.owner_id` sem `ON DELETE`.

**Arquivos afetados:**
- `src/database/migrations/NNN_role_check.sql` (criar)
- `CLAUDE.md` (nota sobre reatribuir `owner_id` antes de hard-delete)

**Padrão de código:** `_padroes.md §7` ("CHECK em todo enum textual").

**Implementação:**
1. Migração:
   ```sql
   -- Path: src/database/migrations/NNN_role_check.sql
   -- Normaliza valores fora do vocabulário antes de aplicar o CHECK
   UPDATE users SET role = 'user'
   WHERE role IS NULL OR role NOT IN ('user','admin');

   ALTER TABLE users
       ADD CONSTRAINT users_role_check CHECK (role IN ('user','admin'));
   ```
2. Documentar em `CLAUDE.md` (e referenciar em `99-referencia.md`): `atlas.owner_id` é
   `REFERENCES users(id)` **sem `ON DELETE`** (`002_atlas.sql:11`). Usuários **nunca** são
   hard-deletados (só `is_active=false`), mas se algum dia forem, **a FK bloqueia** o delete enquanto
   houver atlas. Política: **reatribuir `owner_id`** (já existe `TRANSFER_ATLAS_OWNERSHIP` em
   `users.queries.js:114` + `?transferTo`) antes de qualquer hard-delete. O mesmo vale para
   `images.uploaded_by` e `atlas_shares.added_by` (também `REFERENCES users(id)` sem cascade).

**Critérios de aceitação:**
- [ ] Inserir/atualizar usuário com `role` fora de `{user,admin}` → erro do banco.
- [ ] Migração normaliza qualquer linha legada antes do CHECK (não falha o boot).
- [ ] `CLAUDE.md` documenta a política de reatribuição de `owner_id`.

**Testes:**
- `tests/integration/users-admin.test.js` (estender): admin tentar setar `role='superuser'` → erro;
  `role='admin'` ok.

**Dependências:** nenhuma (independente das demais; pode ir cedo).

---

### Tarefa 5: `api_keys` + `api_key_history` (rotação atômica)

**Objetivo:** Suporte a API key por usuário (linha quente em `users` ou tabela `api_keys`) com
histórico de rotação atômico via CTE.

**Arquivos afetados:**
- `src/database/migrations/NNN_api_keys.sql` (criar)
- `src/modules/users/users.queries.js` (queries de rotação)
- `src/modules/users/users.service.js` (`rotateApiKey`)
- `src/modules/users/users.controller.js` + `users.routes.js` (`POST /users/me/api-key/rotate`)

**Padrão de código:** rotação atômica em **uma** transação (`_padroes.md §4`, `tx()` com `t.one`).

**Implementação:**
1. Migração — chave viva na linha quente de `users` + histórico:
   ```sql
   -- Path: src/database/migrations/NNN_api_keys.sql
   ALTER TABLE users ADD COLUMN api_key UUID UNIQUE;       -- chave viva (nullable)

   CREATE TABLE api_key_history (
       id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id     UUID NOT NULL REFERENCES users(id),
       api_key     UUID NOT NULL,
       created_at  TIMESTAMPTZ,
       revoked_at  TIMESTAMPTZ,
       revoked_by  UUID REFERENCES users(id),
       UNIQUE (user_id, api_key)
   );
   CREATE INDEX idx_api_key_history_user ON api_key_history(user_id);
   ```
   > Nota: o material verbatim do `_2` usa schema `ng.` e `REFERENCES ng.users`; **aqui** o schema é
   > `public` (sem prefixo). Padronize sem prefixo, conforme as 5 migrações atuais.
2. Rotação atômica em CTE (move a antiga para histórico, grava a nova com `RETURNING`):
   ```javascript
   // users.queries.js
   export const ROTATE_API_KEY = `
     WITH old AS (
       INSERT INTO api_key_history (user_id, api_key, created_at, revoked_at, revoked_by)
       SELECT id, api_key, created_at, NOW(), $2
       FROM users
       WHERE id = $1 AND api_key IS NOT NULL
       RETURNING 1
     )
     UPDATE users
     SET api_key = gen_random_uuid(), updated_at = NOW()
     WHERE id = $1
     RETURNING api_key
   `;
   ```
   ```javascript
   // users.service.js
   export async function rotateApiKey(userId, actorId) {
     return tx(async (t) => {
       const { api_key } = await t.one(Q.ROTATE_API_KEY, [userId, actorId]);
       // auditoria participa da MESMA transação (ver Tarefa 7)
       await createAudit({ ip: null }, {
         action: 'API_KEY_ROTATE', actorId, targetType: 'USER', targetId: userId,
       }, t);
       return { apiKey: api_key };
     });
   }
   ```
3. Rota `POST /api/v1/users/me/api-key/rotate` (auth) → controller chama
   `rotateApiKey(req.user.id, req.user.id)`. Admin rotacionar a chave de outro usuário:
   `POST /api/v1/users/:userId/api-key/rotate` (`requireAdmin`).

**Critérios de aceitação:**
- [ ] Rotacionar gera nova `users.api_key` e move a antiga para `api_key_history` com
      `revoked_at`/`revoked_by` — **na mesma transação** (sem janela de chave dupla viva).
- [ ] Primeira rotação (sem chave prévia) só gera a nova, sem linha de histórico.
- [ ] Chave antiga deixa de autenticar (ver Tarefa 6).

**Testes:**
- `tests/integration/api-keys.test.js`: rotacionar duas vezes → histórico tem 1 linha após 2ª;
  chave antiga não autentica; admin rotaciona chave de terceiro.

**Dependências:** Tarefa 7 (`createAudit`) se a auditoria for incluída na transação (recomendado);
caso a Tarefa 7 ainda não esteja pronta, implementar a rotação sem o `createAudit` e adicioná-lo
depois.

---

### Tarefa 6: Middleware de auth flexível JWT-ou-APIkey + sliding session

**Objetivo:** Middleware global não-bloqueante que lê credencial de 3 fontes (api_key em query/header
`x-api-key`; token em cookie/`Authorization: Bearer`), popula `req.user` ou deixa `undefined`, e
renova o token quando perto de expirar (sliding session). Cookie httpOnly/secure/sameSite por
ambiente.

**Arquivos afetados:**
- `src/middleware/flexible-auth.js` (criar)
- `src/middleware/index.js` (re-export)
- `src/app.js` (montar global, **após** CORS e antes das rotas)
- `src/modules/users/users.queries.js` (`FIND_USER_BY_API_KEY`)
- `src/middleware/require-admin.js` / novo `require-org-role.js` (factory `authorize(roles[])`)

**Padrão de código:** `optional-auth.js` (não-bloqueante, `req.user=null`) e `auth.js`
(extração + verificação). A fonte única de flags de cookie é o `EnvironmentManager` (Tarefa 8).

**Implementação:**
1. `flexibleAuth` lê, nesta ordem: `x-api-key` header → `api_key` query → cookie `token` →
   `Authorization: Bearer`. **Não lança** se nada bater (deixa `req.user = undefined` e segue):
   ```javascript
   // src/middleware/flexible-auth.js
   import { verifyAndMapUser } from './auth.js';
   import { query } from '../database/index.js';
   import * as UQ from '../modules/users/users.queries.js';
   import { issueAccessToken, msUntilExpiry } from '../modules/auth/auth.service.js';
   import { env } from '../utils/environment.js';

   const SLIDING_THRESHOLD_MS = 5 * 60 * 1000; // renova se < 5min p/ expirar

   export async function flexibleAuth(req, res, next) {
     try {
       const apiKey = req.get('x-api-key') || req.query.api_key;
       if (apiKey) {
         const { rows } = await query(UQ.FIND_USER_BY_API_KEY, [apiKey]);
         if (rows[0]) { req.user = mapDbUser(rows[0]); req.authVia = 'api_key'; }
         return next();
       }
       const token = req.cookies?.token || extractBearer(req);
       if (!token) return next();               // anônimo — rota decide
       const { user, payload } = safeVerify(token);
       if (!user) return next();
       req.user = user; req.authVia = 'jwt';
       // sliding session: renova e reescreve cookie se perto de expirar
       if (msUntilExpiry(payload) < SLIDING_THRESHOLD_MS) {
         const fresh = issueAccessToken(user);
         res.cookie('token', fresh, env.cookieOptions());
       }
       return next();
     } catch { return next(); }                 // nunca bloqueia
   }
   ```
   - `FIND_USER_BY_API_KEY` seleciona o user ativo por `users.api_key = $1`, incluindo
     `organization_id`, `org_role`, `role`.
   - `safeVerify` envolve `verifyAndMapUser` em try/catch retornando `{user:null}` em erro.
   - `extractBearer`/`mapDbUser` reaproveitam `auth.js`.
2. **Fatores de emissor único:** extrair de `auth.service.js` os helpers `issueAccessToken(user)` (=
   `generateAccessToken` exportado) e `msUntilExpiry(payload)` (= `payload.exp*1000 - Date.now()`).
3. **A rota decide:** rotas que exigem login continuam usando `auth` (estrito, 401 se ausente).
   `flexibleAuth` é montado **global** para popular `req.user` quando houver credencial, sem mudar o
   comportamento das rotas estritas. Adicionar factory `authorize(roles[])`:
   ```javascript
   // src/middleware/require-org-role.js
   export function authorize(...roles) {
     return (req, res, next) => {
       if (!req.user) return next(new UnauthorizedError('Authentication required'));
       if (!roles.includes(req.user.org_role) && req.user.role !== 'admin')
         return next(new ForbiddenError('Insufficient role'));
       next();
     };
   }
   ```
4. **Cookie por ambiente** via `env.cookieOptions()` (Tarefa 8): `httpOnly: true`,
   `secure: env.useHttps`, `sameSite: env.isProduction ? 'strict' : 'lax'`. Requer
   `cookie-parser` montado em `app.js` antes do `flexibleAuth`.
5. **Não copiar** token em localStorage nem sanitização blunt (anti-padrões `99-referencia.md`).

**Critérios de aceitação:**
- [ ] Requisição com `x-api-key` válida popula `req.user` (sem Bearer).
- [ ] Requisição sem credencial passa por `flexibleAuth` sem erro e `req.user` fica `undefined`
      (caminho anônimo preservado).
- [ ] Token a < 5min de expirar é renovado e o novo cookie é reescrito (sliding session).
- [ ] Rotas estritas (`auth`) continuam retornando 401 sem credencial.
- [ ] Cookie emitido tem `httpOnly`; `secure`/`sameSite` variam por ambiente.

**Testes:**
- `tests/integration/flexible-auth.test.js`: api_key via header e via query; ausência de credencial
  → rota anônima ok; token quase-expirado → header `Set-Cookie` presente; `authorize('editor')`
  barra `viewer` (403) e deixa `admin` passar.

**Dependências:** Tarefa 3 (claims no token), Tarefa 5 (`api_key`), Tarefa 8 (`env.cookieOptions`).

---

### Tarefa 7: `audit_trail` + helper `createAudit` transacional

**Objetivo:** Tabela de auditoria de negócio (consultável) e helper `createAudit(req, params, t?)`
que participa da transação do negócio (reverte junto).

**Arquivos afetados:**
- `src/database/migrations/NNN_audit_trail.sql` (criar — **por último** deste bloco)
- `src/utils/audit.js` (criar — `createAudit`)
- `src/modules/audit/audit.queries.js` + `audit.service.js` + `audit.controller.js` +
  `audit.routes.js` (criar — consulta admin)
- `src/app.js` (montar `/api/v1/audit`, admin)

**Padrão de código:** transação `tx()` com 3º param opcional (`_padroes.md §4`, nota do helper
transacional).

**Implementação:**
1. Migração (verbatim do material preservado, schema `public`):
   ```sql
   -- Path: src/database/migrations/NNN_audit_trail.sql
   CREATE TABLE audit_trail (
       id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       action      VARCHAR(50) NOT NULL
                   CHECK (action IN (
                     'LOGIN','LOGOUT','USER_CREATE','USER_UPDATE','USER_DELETE',
                     'PASSWORD_RESET','API_KEY_ROTATE','ROLE_CHANGE',
                     'ORG_CREATE','ORG_UPDATE','ORG_DELETE',
                     'ATLAS_DELETE','SHARING_CHANGE','PERMISSION_GRANT','PERMISSION_REVOKE'
                   )),
       actor_id    UUID NOT NULL,                 -- SEM FK: sobrevive a delete do usuário
       target_type VARCHAR(20) CHECK (target_type IN ('USER','GROUP','MODEL','ZONE','SYSTEM','ATLAS','ORG')),
       target_id   UUID,
       target_name VARCHAR(255),                  -- snapshot do nome no evento
       details     JSONB,                         -- payload livre (before/after)
       ip          VARCHAR(45) NOT NULL,          -- cabe IPv6
       user_agent  TEXT,
       created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   CREATE INDEX idx_audit_actor       ON audit_trail(actor_id);
   CREATE INDEX idx_audit_target      ON audit_trail(target_type, target_id);
   CREATE INDEX idx_audit_action      ON audit_trail(action);
   CREATE INDEX idx_audit_created     ON audit_trail(created_at DESC);
   CREATE INDEX idx_audit_created_act ON audit_trail(created_at DESC, action);
   CREATE INDEX idx_audit_details_gin ON audit_trail USING GIN (details);
   ```
   > A lista de `action`/`target_type` no CHECK é **fechada** — estenda-a conscientemente ao
   > auditar uma ação nova (e atualize o teste). `actor_id` é deliberadamente **sem FK**.
2. Helper transacional:
   ```javascript
   // src/utils/audit.js
   import { query as dbQuery } from '../database/index.js';
   import * as Q from '../modules/audit/audit.queries.js';

   /**
    * Grava um evento de auditoria de negócio.
    * @param req       Express req (lê ip e user-agent). Pode ser objeto parcial { ip, get }.
    * @param params    { action, actorId, targetType?, targetId?, targetName?, details? }
    * @param t         (opcional) ITask de uma tx pg-promise → audit participa da mesma transação.
    */
   export async function createAudit(req, params, t) {
     const exec = t ? t.none.bind(t) : (sql, args) => dbQuery(sql, args).then(() => {});
     const ip = req?.ip || null;
     const userAgent = req?.get ? req.get('user-agent') : null;
     await exec(Q.INSERT_AUDIT, [
       params.action, params.actorId, params.targetType ?? null, params.targetId ?? null,
       params.targetName ?? null, params.details ?? null, ip, userAgent,
     ]);
   }
   ```
   ```javascript
   // audit.queries.js
   export const INSERT_AUDIT = `
     INSERT INTO audit_trail
       (action, actor_id, target_type, target_id, target_name, details, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
   `;
   ```
   > Nota: `ip` é `NOT NULL` no schema. Quando `req.ip` for nulo (chamada interna sem request, ex.:
   > rotação por job), passar `'0.0.0.0'` no service ou tornar o param `COALESCE($7,'0.0.0.0')`.
   > **Recomendação:** o service que tem `req` deve passá-lo; chamadas internas usam `'system'`/`'0.0.0.0'`.
3. Uso transacional (exemplo real — desativar usuário no fluxo admin, em `users.service.js`):
   ```javascript
   await tx(async (t) => {
     await t.one(Q.SOFT_DELETE_USER, [userId]);
     await createAudit(req, {
       action: 'USER_DELETE', actorId: req.user.id, targetType: 'USER',
       targetId: userId, targetName: user.nome, details: { reason },
     }, t);                                   // 3º param: mesma transação
   });
   ```
4. Consulta admin: `GET /api/v1/audit` (filtros `action`, `actor_id`, `target_type`, intervalo de
   data; paginado) — `auth` + `requireAdmin`. **Sempre teste com usuário sem permissão**
   (`_padroes.md §9`).
5. Auditar, no mínimo: `LOGIN`/`LOGOUT` (auth.service), `USER_CREATE/UPDATE/DELETE` e
   `PASSWORD_RESET`/`ROLE_CHANGE` (users admin), `ORG_*` (organizations), `ATLAS_DELETE` e
   `SHARING_CHANGE` (atlas/sharing), `API_KEY_ROTATE` (Tarefa 5).

**Critérios de aceitação:**
- [ ] `createAudit(req, params, t)` grava na **mesma** transação; rollback do negócio reverte o audit.
- [ ] `createAudit(req, params)` sem `t` grava de forma autônoma.
- [ ] `action`/`target_type` fora do CHECK são rejeitados pelo banco.
- [ ] `GET /api/v1/audit` lista/filtra; `user` não-admin → 403.
- [ ] Ações destrutivas (delete de usuário, delete de atlas) geram linha de auditoria.

**Testes:**
- `tests/integration/audit.test.js`: delete de usuário em tx com erro forçado **não** deixa linha de
  audit (rollback conjunto); delete bem-sucedido deixa exatamente 1 linha com `target_name` snapshot;
  consulta admin filtra por `action`; consulta por `user` → 403.

**Dependências:** Tarefa 1 (org para auditar `ORG_*`); usada pela Tarefa 5 e por fluxos da Tarefa 4.

---

### Tarefa 8: `EnvironmentManager` singleton

**Objetivo:** Centralizar em um singleton as decisões por ambiente (cookie, cors, db max, helmet,
useHttps) hoje espalhadas, com getters `isProduction/isDevelopment/isTest`.

**Arquivos afetados:**
- `src/utils/environment.js` (criar — singleton `env`)
- `src/config.js` (`validateEnvVariables` ganha `COOKIE_SECRET`, `USE_HTTPS`)
- `src/app.js` (consumir `env` para cookie/cors/helmet)

**Padrão de código:** `config.js` (leitor de `.env`, getters `isDev/isProd/isTest`). O
`EnvironmentManager` **deriva decisões** a partir do `config`, não relê `.env` por conta própria.

**Implementação:**
```javascript
// src/utils/environment.js
import config from '../config.js';

class EnvironmentManager {
  get isProduction()  { return config.isProd; }
  get isDevelopment() { return config.isDev; }
  get isTest()        { return config.isTest; }
  get useHttps()      { return config.isProd; } // ou flag USE_HTTPS dedicada

  cookieOptions() {
    return {
      httpOnly: true,
      secure: this.useHttps,
      sameSite: this.isProduction ? 'strict' : 'lax',
      maxAge: 15 * 60 * 1000, // alinhado ao access token (15m)
    };
  }
  corsOptions()  { return { origin: config.cors.origin, credentials: true }; }
  dbPoolMax()    { return this.isProduction ? config.db.poolMax : Math.min(config.db.poolMax, 5); }
  helmetOptions(){ return this.isProduction ? { /* CSP/HSTS explícitos */ } : {}; }
}

export const env = new EnvironmentManager();
```
- `app.js` passa a usar `env.corsOptions()`, `env.helmetOptions()`; o `flexibleAuth` usa
  `env.cookieOptions()`. **Não duplicar** essas decisões em outros arquivos.
- `validateEnvVariables()` (fase-0) ganha `COOKIE_SECRET` (>= 32 chars em prod) e, opcionalmente,
  `USE_HTTPS`.

**Critérios de aceitação:**
- [ ] `env` é a **única** fonte de cookie/cors/helmet/poolMax/useHttps.
- [ ] Em `NODE_ENV=production`, `cookieOptions().secure === true` e `sameSite === 'strict'`.
- [ ] Em dev/test, `secure === false`.
- [ ] Boot falha cedo se `COOKIE_SECRET` ausente em prod (via `validateEnvVariables`).

**Testes:**
- `tests/unit/environment.test.js`: alternar `NODE_ENV` e checar `cookieOptions`/`useHttps`/`dbPoolMax`.

**Dependências:** fase-0 (`validateEnvVariables`). Consumida pela Tarefa 6.

---

### Tarefa 9: Logging por categoria (pino multistream)

**Objetivo:** Logging operacional por categoria (um arquivo por categoria), distinto da auditoria de
negócio. `requestLogger` marca requisições lentas (> 1000ms) e 401/403.

**Arquivos afetados:**
- `src/utils/logger.js` (estender com multistream + `LogCategory`)
- `src/middleware/request-logger.js` (marcar slow/401/403)

**Padrão de código:** `logger.js` (pino atual), `request-logger.js:7-28` (mede `duration`,
`statusCode`, `userId`).

**Implementação:**
1. `enum LogCategory` e funções tipadas:
   ```javascript
   // src/utils/logger.js — esboço
   export const LogCategory = Object.freeze({
     AUTH: 'AUTH', API: 'API', DB: 'DB', SECURITY: 'SECURITY',
     PERFORMANCE: 'PERFORMANCE', SYSTEM: 'SYSTEM', ACCESS: 'ACCESS', ADMIN: 'ADMIN',
   });
   // multistream: um arquivo por categoria (ex.: logs/auth.log) em prod;
   // pino-pretty em dev; silent em test (preservar config.isTest).
   export function logAuth(meta)        { /* category: AUTH  */ }
   export function logSecurity(meta)    { /* category: SECURITY, level warn */ }
   export function logAccess(meta)      { /* category: ACCESS */ }
   export function logPerformance(meta) { /* category: PERFORMANCE */ }
   export function logError(err, meta)  { /* category conforme contexto */ }
   export function logMetric(meta)      { /* category: PERFORMANCE */ }
   ```
   Envelope comum: `{ category, requestId, userId, endpoint, duration, statusCode, ip, userAgent, method }`.
2. `requestLogger`: além do log atual, **marcar**:
   - `duration > 1000` → `logPerformance({ slow: true, ... })` (categoria PERFORMANCE).
   - `statusCode === 401 || statusCode === 403` → `logSecurity({ ... })` (categoria SECURITY, warn).
   Manter o comportamento de pular em `isTest` e não quebrar o formato atual.
3. **Distinção explícita** (documentar no topo de `logger.js`): logging = operacional, arquivo,
   volátil; auditoria (`audit_trail`) = negócio, banco, consultável, transacional. Não logar segredo
   nem token; não usar logging como auditoria de negócio.

**Critérios de aceitação:**
- [ ] `LogCategory` exporta os 8 valores; cada categoria escreve no seu stream/arquivo em prod.
- [ ] Requisição > 1000ms é marcada como slow (PERFORMANCE).
- [ ] 401/403 geram entrada SECURITY (warn).
- [ ] Em `NODE_ENV=test` o logger permanece `silent` (não polui o runner).

**Testes:**
- `tests/unit/logger.test.js`: `LogCategory` completo; `requestLogger` (mock `res`) emite slow e
  security nos limiares; silencioso em test.

**Dependências:** nenhuma (independente; pode ir cedo).

---

## 5. Riscos & cuidados

- **Multi-org depois de produção é caro.** Por isso `organizations`/`organization_id` entram **antes**
  de ativar multiusuário (fase-8), mesmo com org default. Não adiar a Tarefa 1/2.
- **Backfill por nome é frágil.** O texto livre `organizacao_militar` pode não casar nenhuma org —
  por isso o fallback para a org default. **Não** dropar a coluna texto nesta fase; só após validação
  em produção. Tornar `organization_id` NOT NULL é opcional e fica para migração futura.
- **`atlas.owner_id` sem `ON DELETE`** bloqueia hard-delete de usuário com atlas. Política:
  reatribuir antes (já há `TRANSFER_ATLAS_OWNERSHIP`). Idem `images.uploaded_by`,
  `atlas_shares.added_by`.
- **CHECK em `role` pode falhar no boot** se houver lixo legado — a migração **normaliza antes** de
  aplicar o constraint.
- **Tokens legados** (emitidos antes do claim de org) precisam continuar válidos — `org_role` cai
  para `'viewer'`, `organization_id` para `null`. Não invalidar a base instalada.
- **Auth flexível não pode bloquear o caminho anônimo.** `flexibleAuth` é não-bloqueante por
  contrato; só rotas estritas (`auth`) retornam 401.
- **Sliding session reescreve cookie** — garantir `cookie-parser` montado e `Set-Cookie` só quando
  realmente renovar (evitar reescrever a cada request).
- **`audit_trail.ip` é NOT NULL** — chamadas internas sem `req` devem passar `'0.0.0.0'`/`'system'`.
- **CHECK fechado de `action`/`target_type`** — auditar ação nova exige estender o CHECK numa
  migração e o teste; senão o INSERT falha em produção.
- **Não copiar anti-padrões do `ebgeo_web_2`** (`99-referencia.md`): sanitização blunt, mistura
  `uuid_generate_v4`, CTE de permissão duplicado, token em localStorage, `ORDER BY $n:raw`.
- **Ordem de migração** entre fases paralelas — usar o próximo número livre e preservar a ordem
  relativa (orgs → user_org_fk → api_keys → audit_trail).

---

## 6. Definition of Done da fase

Além do DoD universal de `_padroes.md §10`, esta fase está concluída quando:

- [ ] `organizations` existe, semeada com `slug='default'`; módulo com CRUD + testes.
- [ ] `users.organization_id` (FK nullable) existe e está backfilled (todo usuário com org não-nula);
      `organizacao_militar` preservada.
- [ ] JWT emite `organization_id` e `org_role`; `req.user` os expõe; tokens legados ainda validam.
- [ ] `users.role` tem CHECK `IN ('user','admin')`; política de `owner_id` documentada no `CLAUDE.md`.
- [ ] `api_key` viva em `users` + `api_key_history`; rotação atômica em CTE, sem janela de chave dupla.
- [ ] `flexibleAuth` global não-bloqueante (3 fontes), sliding session < 5min, cookie por ambiente;
      caminho anônimo e rotas estritas intactos; factory `authorize(roles[])`.
- [ ] `audit_trail` + `createAudit(req, params, t?)` transacional; ações destrutivas auditadas;
      `GET /api/v1/audit` (admin) com teste de usuário sem permissão.
- [ ] `EnvironmentManager` é a fonte única de cookie/cors/helmet/poolMax/useHttps.
- [ ] Logging por categoria (`LogCategory` × 8) com slow > 1000ms e 401/403 marcados; silent em test.
- [ ] Contrato de payload JWT documentado em `99-referencia.md` para a fase-7 (gateway/360).
- [ ] `npm test` verde (unit + integration + ws), casos negativos cobertos.
- [ ] `CLAUDE.md` atualizado (organizations, claim de org, política de `owner_id`, distinção
      logging × auditoria).
```
