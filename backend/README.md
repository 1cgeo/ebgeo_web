# EBGeo Backend

API REST + WebSocket (Node 20, ES Modules) do app de mapeamento geoespacial militar **EBGeo**.
Adiciona ao frontend local-first: autenticação JWT, persistência PostgreSQL/PostGIS, colaboração em
tempo real e sincronização offline-first.

> **Constraint fundamental:** o backend é **aditivo** — a aplicação funciona idêntica para usuário
> **não autenticado** (offline, IndexedDB local). Nenhuma mudança pode quebrar o caminho anônimo nem
> os contratos congelados do frontend.

Este README é a **referência completa** do backend (rotas, env, migrações, permissões, protocolo WS,
convenções de engenharia). Contexto curto para agentes está em **[CLAUDE.md](CLAUDE.md)**; deploy em
**[../docs/wiki/deploy-backend.md](../docs/wiki/deploy-backend.md)**.

---

## Estrutura da Documentação

Toda a documentação vive em **`../docs/guias/`** (mais o deploy em `docs/deploy/`), como uma
**série numerada de guias de integração** frontend-backend. Comece pelo
00 - Visão Geral (arquitetura + índice) e abra o guia do
subsistema que vai integrar. As convenções de engenharia ficam na seção
[Convenções de Engenharia](#convenções-de-engenharia) deste README; o deploy em
[../docs/wiki/deploy-backend.md](../docs/wiki/deploy-backend.md).


---

## Visão Geral

```
  ebgeo_web (SPA local-first, IndexedDB)
        │  REST (metadados, sharing, imagens) · Sync API (ops CRDT) · WebSocket (colaboração)
        ▼
  Backend único — Express + pg-promise + ws (JS puro)
   auth · users/organizations · atlas/maps/features · layers/groups · briefings/slides
   sync (LWW + log) · collab (WebSocket) · resources/images · config (GET /api/config)
   nomes (gazetteer) · catalogo3d + assets3d · zones (acesso geográfico) · sv360 (StreetView 360)
        ▼
  PostgreSQL + PostGIS (UM banco, schemas isolados)
   public/atlas:  JSONB   (atlas, maps, features.geometry, operations)
   ng:            PostGIS  (nomes_geograficos, edificacoes, catalogo_3d, zonas)
   sv360:         PostGIS  (projects, photos[geom], targets) + {slug}.db (BLOBs WebP)
```

| Tipo de Dado | API |
|--------------|-----|
| Atlas metadata, compartilhamento, imagens | REST |
| Features, layers, groups, maps, briefings, slides, 3D, 360 | **Sync / WebSocket** (escrita só via sync) |
| Nomes geográficos, catálogo 3D, panoramas 360 | REST read-only (PostGIS) |

### Modos de operação
1. **Anônimo** — sem login, dados locais no IndexedDB. O servidor precisa estar alcançável no boot (o frontend é fail-fast em `GET /api/config`).
2. **Autenticado** — login, sync com servidor, colaboração.
3. **Público** — link público, somente leitura, token temporário (1h).

### Stack & estrutura

`Express 4` · `pg-promise` (SQL direto, sem ORM) · `ws` · `jsonwebtoken`+`bcrypt` · `joi` · `pino` ·
`better-sqlite3` (BLOBs 3D/360). Node 20 LTS, ES Modules.

```
src/
├── index.js            # boot (HTTP + WS + validateEnvVariables fail-fast)
├── app.js              # factory createApp() (testável por supertest)
├── config.js           # config via .env + validateEnvVariables()
├── database/           # index.js (query/tx), migrate.js, migrations/
├── middleware/         # auth, flexible-auth, permissions, validate, error-handler, require-admin, ...
├── modules/<nome>/     # auth users atlas maps briefings resources sharing images sync
│                       # collab config nomes zones streetview360
└── utils/              # errors, logger, async-handler, audit, environment, sqlite-blob-pool
```

---

## Comandos

```bash
npm run dev              # node --watch
npm run db:migrate       # aplica migrações
npm run db:seed          # dados de teste
npm test                 # cria DB ebgeo_test → migra → roda (unit+integration+ws) → dropa
npm run test:unit | test:integration | test:ws
npm run test:keep-db     # mantém o DB após os testes (debug)
npm run lint             # eslint  ·  npm run format  (prettier)
```

`npm test` é hermético (cria/dropa `ebgeo_test`). **PostGIS** é extensão *untrusted*: o runner
pré-cria as extensões via `SUPERUSER_DATABASE_URL` (default `postgres:postgres@localhost`). Variáveis
opcionais do banco de teste: `TEST_DB_NAME` (`ebgeo_test`), `DB_USER` (`ebgeo`), `DB_PASSWORD`
(`ebgeo_secret`), `DB_HOST` (`localhost`), `DB_PORT` (`5432`).

> **Máquinas sem o role `ebgeo`** (Postgres local só com o superusuário `postgres:postgres`):
> rode com override de credenciais —
> `DB_USER=postgres DB_PASSWORD=postgres npm test`. Para um subconjunto, chame o runner direto
> com um glob: `DB_USER=postgres DB_PASSWORD=postgres node scripts/run-tests.js "tests/**/*<glob>*.test.js"`
> (aceita `--keep-db` para preservar o `ebgeo_test` entre rodadas de debug).

### Credenciais de teste (após `npm run db:seed`)

| Usuário | Senha | Role |
|---------|-------|------|
| `admin` | `admin123` | admin |
| `cap.silva` | `test123` | user |

---

## Convenções de Engenharia

Padrões verificados no código (referência: `src/modules/atlas/`). Todo código novo segue isto.

### Template de módulo (um arquivo por responsabilidade)

| Arquivo | Responsabilidade |
|---------|------------------|
| `<nome>.routes.js` | **Só** rotas. Ordem dos middlewares `[auth, requireAtlasPermission(...), validate({...}), ctrl.X]`. Export nomeado. |
| `<nome>.controller.js` | Camada HTTP. Cada handler é `asyncHandler(async (req, res) => …)`; lê `req`, chama o service, escreve `res.json({ data })` / `201` / `204`. Mutação colaborativa **broadcasta WS** após a escrita, antes do `res`. |
| `<nome>.service.js` | **Toda** a lógica de negócio. Importa `{ query, tx }` e `* as Q`. Lança erros de domínio. |
| `<nome>.queries.js` | Constantes SQL `UPPER_SNAKE` com `$1,$2`. Sem lógica. |
| `<nome>.schemas.js` | Schemas Joi (`createAtlasSchema`…), `.custom()` para regras cross-field. |
| `index.js` | Re-export (`export { atlasRoutes } …; export * as atlasService …`). |

### Camada de erro
`src/utils/errors.js` — `AppError` + subclasses: `NotFoundError` 404 · `ForbiddenError` 403 ·
`UnauthorizedError` 401 · `ConflictError` 409 · `ValidationError` 422 (com `details`) · `BadRequestError` 400.
- `asyncHandler(fn)` envolve handler e faz `.catch(next)`. **Sempre use** — zero try/catch por rota.
- `errorHandler` (último em `app.js`): Joi → 422 com `details`; `AppError` → `statusCode`/`code`;
  desconhecido → 500 mascarado (stack só fora de prod).

### Validação
`validate.js` itera `body`/`params`/`query` com `{ abortEarly:false, stripUnknown:true }` e **reatribui
o valor coergido** a `req[source]`. Valide **na borda** (middleware na rota), nunca no controller. Toda
rota de escrita tem `validate({ body })`.

### Transações
`tx(async (t) => { … })` (pg-promise, commit/rollback automáticos). **Atenção aos dois retornos:**
`query()` devolve `{ rows, rowCount }`; `one`/`oneOrNone`/`many`/`any`/`none` e os `t.*` devolvem
**direto** (sem `.rows`). Dentro de `tx`, use `t.none`/`t.one`/`t.any` e **passe o `t`** às chamadas
internas (inclusive `createAudit(req, params, t)` — auditoria participa da transação do negócio).

### Config & boot
`config.js` usa `required(key)` (fail-fast) e `optional(key, fallback)`, `Object.freeze` aninhado,
getters `isDev`/`isProd`/`isTest`. `validateEnvVariables()` (chamado em `index.js`) agrupa erros
(DATABASE_URL, JWT_SECRET ≥ 32 chars em prod, PORT, CORS_ORIGIN) e aborta cedo. `app.js` exporta
`createApp()`; ordem global: `helmet` → `cors` → `compression` → `express.json` → `requestLogger` →
health/config → rotas → `errorHandler`. **Rotas públicas montam ANTES do auth** (ex.: `GET /api/config`,
`/atlas/public/:link`).

### Migrações
`src/database/migrations/NNN_*.sql`, ordem alfabética, tracking em `_migrations` (cada arquivo numa
`tx`), **forward-only** (sem rollback). **Aditivas** (`ADD COLUMN DEFAULT`, `CREATE TABLE/INDEX`). Use o
**próximo número livre**. `gen_random_uuid()` para PKs (não `uuid_generate_v4`). `CHECK` em todo enum
textual; soft-delete via `deleted_at`/`is_active`; índices parciais para a fatia quente. Migração que
mexe em PostGIS exige superusuário.

### Segurança (baseline)
SQL 100% parametrizado (`$n`); `SET` dinâmico só de **whitelist de colunas**, nunca de input. Rate
limit nas rotas de credencial e no link público. Upload sem SVG (XSS) + magic-bytes; download como
`attachment`. `jwt.verify(..., { algorithms:['HS256'] })`; bcrypt custo 12; refresh só como hash com
rotação + detecção de reuso; login timing-safe. helmet CSP/HSTS em prod; CORS por origin. Detalhes em
[Segurança (hardening)](#segurança-hardening).

### Testes
3 categorias em `tests/` (`unit`/`integration`/`ws`). Runner `scripts/run-tests.js` cria/migra/dropa o
DB. Bata no `app` exportado via **supertest** (não suba servidor). **Toda mudança de schema/sync precisa
de teste de regressão; toda query com filtro de acesso precisa de teste com usuário SEM permissão**
(não vazar dados).

### Definition of Done
- [ ] Segue o template de módulo e a convenção de nomes.
- [ ] Rota de escrita tem `validate()` Joi; erros usam `AppError`/`asyncHandler`.
- [ ] Multi-query atômica via `tx()`; SQL 100% parametrizado.
- [ ] Migração aditiva, numerada; filtros de acesso com teste negativo.
- [ ] Mutação colaborativa faz broadcast WS; contratos congelados intactos.
- [ ] `npm run lint` limpo e `npm test` verde; docs atualizados se o comportamento mudou.

---

## Banco de Dados & Migrações

- Geometria do atlas em **JSONB** (mesmo formato do IndexedDB). **Sem PostGIS no schema do atlas.**
- Soft-delete (`deleted_at`) em entidades principais; `version` por entidade (CRDT, +1 a cada update).
- Idempotência de operações: `operations.op_id` + `UNIQUE (atlas_id, op_id)`, push com `ON CONFLICT DO NOTHING`.

> **Baseline consolidado:** os 19 migrations incrementais originais foram unificados em **5 arquivos por
> domínio** (sem app em produção, o histórico incremental foi colapsado num baseline limpo, aditivo e
> forward-only). Equivalência verificada por diff de schema + suíte completa.

| Migração | Descrição |
|----------|-----------|
| 001_core | `pgcrypto`; `organizations` (+ org default); `users` (campos militares BR + `organization_id` FK + `org_role` + `api_key` + CHECK em `role`); `refresh_tokens`; `api_key_history`; `audit_trail` (CHECK fechado de action/target) |
| 002_atlas | atlas, atlas_shares, maps (com `locked`/`grid_style`/`temporal_config`), layers, groups, features (18 tipos), group_features, `catalog_layers` (por-camada), cesium3d_data, streetview360_data, images (MIME png/jpeg/webp, sem svg), briefings, slides |
| 003_sync | operations (log CRDT, `client_id` TEXT, `op_id` + `UNIQUE (atlas_id, op_id)`), active_sessions, resources + seed (`config` no shape de `GET /api/v1/config`) |
| 004_ng | **PostGIS** + schema `ng` (nomes 4674, edificacoes 4326, catalogo_3d), `f_unaccent`, triggers, `ng.refresh_busca()`; `access_level` em nomes/edificações/catalogo_3d; `model_permissions`/`model_group_permissions` + `ng.user_groups`; `ng.groups` + `geographic_access_zones` (4674) + zone permissions + `ng.fn_user_zone_geoms` |
| 005_sv360 | schema **`sv360`**: `projects` (FK org, UNIQUE org+slug, status), `photos` (id TEXT UUID v5, PK global, `geom` 4326 via trigger), `targets`, `deleted_photos` (tombstone) |

> **Carga de nomes (FME):** após cada carga, rodar `SELECT ng.refresh_busca();` (DBSCAN + `tipo_peso`) —
> sem isso `cluster_id`/`tipo_peso` ficam nulos e a busca degrada silenciosamente.

---

## Variáveis de Ambiente

| Variável | Default | Descrição |
|----------|---------|-----------|
| `PORT` | 3000 | Porta do servidor |
| `NODE_ENV` | development | Ambiente |
| `LOG_LEVEL` | info | Nível Pino |
| `DATABASE_URL` | *required* | Conexão PostgreSQL |
| `DATABASE_POOL_MIN` / `_MAX` | 2 / 10 | Pool pg-promise |
| `JWT_SECRET` | *required* | Segredo JWT (≥ 32 chars em prod) |
| `JWT_ACCESS_EXPIRY` / `_REFRESH_EXPIRY` | 15m / 7d | Validade dos tokens |
| `CORS_ORIGIN` | http://localhost:8080 | Origem CORS (não wildcard) |
| `IMAGES_DIR` / `MAX_IMAGE_SIZE_MB` | ./data/images / 10 | Imagens |
| `MAX_BULK_UPLOAD_MB` | 50 | Limite de corpo dedicado do `POST /images/bulk` (lote base64; > limite global de JSON) |
| `WS_HEARTBEAT_INTERVAL_MS` / `_TIMEOUT_MS` | 30000 / 5000 | Heartbeat WebSocket |
| `WS_AWAY_GRACE_MS` | 120000 | Janela `away`→`remove` na queda; reconexão c/ mesmo `clientId` cancela |
| `ASSETS_3D_DIR` / `ASSETS_3D_SQLITE` | ./data/assets3d / ./data/assets3d.sqlite | Store de assets 3D (FS + SQLite) |
| `ASSETS_3D_BASE_URL` | /api/v1/assets3d | Exposto em `GET /api/config` como `assets3dBaseUrl` |
| `ASSETS_3D_MAX_INFLIGHT` | 8 | Semáforo de buffers SQLite vivos no heap |
| `SV360_DB_DIR` | ./data/sv360 | SQLite por projeto `{slug}.db` (BLOBs WebP) |
| `SV360_TMP_DIR` | ./data/sv360-tmp | Tmp do multer (**mesmo volume** que `SV360_DB_DIR` p/ rename atômico) |
| `SV360_MAX_INFLIGHT` / `SV360_MAX_UPLOAD_BYTES` | 8 / 2 GiB | Semáforo / limite do multipart de ingestão |
| `ALLOW_SELF_REGISTRATION` | prod:false, dev/test:true | Habilita `POST /auth/register` |
| `RATE_LIMIT_AUTH_WINDOW_MS` / `_MAX` | 900000 / 10 | Rate limit `/auth/{login,refresh,register}` (IP+username) |
| `RATE_LIMIT_PUBLIC_WINDOW_MS` / `_MAX` | 60000 / 30 | Rate limit `/atlas/public/:link` (por IP) |
| `EBGEO_TRACE` | *(ausente)* | SyncLedger: liga o ring de trace + monta `GET/DELETE /api/v1/debug/trace`. `=1` (ou `NODE_ENV=test`); **nunca em prod** |

URLs de serviço/tiles do `GET /api/config` (basemaps, busca, terrain, 360) também vêm de env — ver
[`.env.example`](.env.example) e 10-config.

---

## Sistema de Permissões

Hierarquia por atlas — **cinco níveis** (`PERMISSION_LEVELS` em `middleware/permissions.js`):

```
read (1) < comment (2) < write (3) < manage (4) < owner (5)
```

Resolução (waterfall):

```
1. userId === atlas.owner_id → owner        (sintetizado, NÃO é um share)
2. atlas_shares.permission    → read | comment | write | manage
3. atlas.is_public            → read
4. nenhum                     → 403 Forbidden
```

| Nível | Papel (UI) | Pode |
|-------|-----------|------|
| `owner` | Dono | tudo, incluindo transferir posse e deletar o atlas |
| `manage` | co-Gestor | editar + **compartilhar e configurar** o atlas (concede até `manage`; `owner` não é concedível) |
| `write` | Editor | criar/editar/remover feições, camadas, mapas |
| `comment` | Comentarista | ver o atlas e agir **somente** sobre comentários espaciais |
| `read` | Visualizador | somente leitura |

> `owner` é derivado de `atlas.owner_id` e nunca aparece em `atlas_shares` — o CHECK da coluna é
> `('read','comment','write','manage')`. Ao escrever qualquer gate, use a **hierarquia** (ou
> `requireAtlasPermission`), nunca uma lista fechada como `permission === 'write' || 'owner'`: isso
> exclui silenciosamente o `manage`, que está *acima* de `write`.

**Papel no frontend:** o evento WS `connected` traz `role` já mapeado por `toFrontendRole`
(`utils/roles.js`): `admin`→`admin`, `owner`→`owner`, `manage`→`manager`, `write`→`editor`,
`comment`→`commenter`, `read`→`viewer`.

**Roles globais:** `user` (cria atlas, acessa recursos) · `admin` (gerencia usuários e recursos do
sistema). **Identidade org-scoped (Fase 5):** JWT carrega `organization_id` + `org_role ∈
{owner,editor,viewer,admin}` (emissor único). `flexibleAuth` é global e **não-bloqueante** (Bearer/cookie
`token`/`x-api-key`, preserva anônimo); rotas estritas usam `auth`, que reconcilia `is_active`/`role`
com o banco a cada request (uma conta desativada ou um admin rebaixado perde acesso na hora).

**Legenda das tabelas:** *User* = autenticado · *Admin* = role `admin` ·
*Read/Comment/Write/Manage/Owner* = permissão por atlas.

**Deleção de usuários:** desativados (`is_active=false`), nunca removidos. Se possui atlas, transferir
posse via `?transferTo=<userId>` antes (FKs `owner_id`/`uploaded_by`/`added_by` não têm `ON DELETE`).

---

## Formato de Resposta

```json
{ "data": { ... } }                                    // sucesso
{ "error": { "code": "NOT_FOUND", "message": "..." } } // erro
```
Exceções: rotas `sv360` respondem **nuas** (objeto/array) e usam envelope de erro **plano** `{ "error": "..." }`;
`GET /nomes/busca` responde **array nu** (contrato congelado).

---

## Rotas da API

### Health & Config
| Método | Rota | Auth |
|--------|------|------|
| GET | `/api/v1/health` (readiness com `SELECT 1`, 503 se DB cair) | Não |
| GET | `/api/v1/config` (+ alias `/api/config`) — config dinâmico do frontend | Não |

### Auth
| Método | Rota | Auth |
|--------|------|------|
| POST | `/api/v1/auth/register` (gateado por `ALLOW_SELF_REGISTRATION`; 404 se off) | Não |
| POST | `/api/v1/auth/login` · `/api/v1/auth/refresh` | Não |
| POST | `/api/v1/auth/logout` · GET `/api/v1/auth/me` | User |

### Users
| Método | Rota | Permissão |
|--------|------|-----------|
| GET/PUT | `/api/v1/users/me` · PUT `/api/v1/users/me/password` · GET `/api/v1/users/search` | User |
| GET/POST | `/api/v1/users` · GET/PUT/DELETE `/api/v1/users/:userId` | Admin |
| POST | `/api/v1/users/:userId/reset-password` · `/api/v1/users/:userId/reactivate` | Admin |

### Atlas
| Método | Rota | Permissão |
|--------|------|-----------|
| GET/POST | `/api/v1/atlas` · POST `/api/v1/atlas/import` | User |
| GET | `/api/v1/atlas/public/:link` (atlas público + token WS) | Não |
| GET/PUT/DELETE | `/api/v1/atlas/:atlasId` | Read / Write / Owner |
| GET/PATCH | `/api/v1/atlas/:atlasId/settings` · POST `/api/v1/atlas/:atlasId/clone` | Read·Owner / Read |

### Maps (read-only; escrita via sync)
| Método | Rota | Permissão |
|--------|------|-----------|
| GET | `/api/v1/atlas/:atlasId/maps` · `/maps/:mapId` | Read |
| POST | `/maps/:mapId/duplicate` · `/maps/:mapId/merge` (move sub-entidades, atômico) | Write |

### Briefings (read-only) · Sharing · Images
| Método | Rota | Permissão |
|--------|------|-----------|
| GET | `/api/v1/atlas/:atlasId/briefings` · `/briefings/:briefingId` | Read |
| GET/POST/PUT/DELETE | `/api/v1/atlas/:atlasId/sharing[...]` (public link + users) | Manage |
| GET/POST/DELETE | `/api/v1/atlas/:atlasId/images[...]` (+ `/images/bulk` base64, até 50) | Read / Write |

### Sync (CRDT)
| Método | Rota | Permissão |
|--------|------|-----------|
| POST | `/api/v1/atlas/:atlasId/sync` (push de operações) | Comment¹ |
| GET | `/api/v1/atlas/:atlasId/sync/:version` (snapshot ou ops incrementais) | Read |
| GET/POST | `/api/v1/atlas/:atlasId/sync/admin/stats` · `/sync/admin/cleanup` | Admin |

> ¹ O gate da **rota** é `comment` (não `write`) apenas para que um Comentarista alcance o handler;
> `assertOperationAllowed()` então impõe, op a op, que `comment` só escreve comentários espaciais.
> `read` é barrado já na rota. Além disso: delete de mapa e flip de `locked` exigem `owner` (403), e
> um mapa `locked=true` recusa (409) qualquer mutação de entidade-filha.

### Debug / SyncLedger (test/dev — só com o tracer ligado)
| Método | Rota | Auth |
|--------|------|------|
| GET | `/api/v1/debug/trace?atlasId=&opId=&traceId=` (spans do ring de sync do atlas) | User |
| DELETE | `/api/v1/debug/trace?atlasId=` (limpa o ring; tudo se omitido) | User |

> Montado **apenas** quando `EBGEO_TRACE=1` ou `NODE_ENV=test` (`isTraceEnabled()` em `utils/sync-trace.js`); ausente em produção.

### Multi-org / Identidade / Auditoria
| Método | Rota | Permissão |
|--------|------|-----------|
| GET | `/api/v1/organizations` · `/organizations/:id` | User |
| POST/PUT/DELETE | `/api/v1/organizations[...]` (auditado) | Admin |
| POST | `/api/v1/users/me/api-key/rotate` · `/users/:userId/api-key/rotate` | User / Admin |
| GET | `/api/v1/audit` (filtros action/actor/target) | Admin |

### Nomes Geográficos (Gazetteer — PostGIS, read-only) · Zonas
| Método | Rota | Permissão |
|--------|------|-----------|
| GET | `/api/v1/nomes/busca` (7 critérios; **array nu** congelado) | User |
| GET | `/api/v1/nomes/feicoes` (clique 3D em edificação) · `/nomes/catalogo3d` (full-text, filtro de acesso no SQL) | User |
| GET | `/api/v1/assets3d/*` (assets 3D imutáveis; ETag O(1)/304/Range; SQLite-first, FS fallback) | Não |
| GET/POST | `/api/v1/zones` · GET/PUT/DELETE `/api/v1/zones/:id` (CRUD + `ST_IsValid`) | Admin |
| GET/PUT | `/api/v1/zones/:id/permissions` (replace-set transacional + audit diff) | Admin |

### Resources (admin)
| Método | Rota | Permissão |
|--------|------|-----------|
| GET | `/api/v1/resources` · `/resources/:id` | User |
| POST/PUT/DELETE | `/api/v1/resources[...]` | Admin |

### StreetView 360 (`sv360`)
Respostas **nuas**, erro **plano** `{error}`. Leitura via `flexibleAuth` (projeto `enabled` é público;
`disabled` só admin/org-dona, senão 404). Escrita via `auth` estrito + posse no service (escada 404→403).
Detalhes e internals (ingestão swap-then-commit, `db_filename` derivado, MVT) em
16 - StreetView 360.

| Método | Rota | Auth |
|--------|------|------|
| GET | `/api/v1/sv360/tiles/:z/:x/:y.pbf` (vector tile MVT: camadas `fotos` + `fotos_linha`) | Opcional |
| GET | `/api/v1/sv360/tiles/fotos.geojson` · `/thumbnails/:slug.webp` | Opcional |
| GET | `/api/v1/sv360/projects` · `/projects/:slug` | Opcional |
| GET | `/api/v1/sv360/photos/by-name/:nome` · `/photos/:uuid` (shape congelado) | Opcional |
| GET | `/api/v1/sv360/photos/:uuid/image?quality=full\|preview` (ETag O(1)/304/Range/semáforo) | Opcional |
| PUT | `/api/v1/sv360/photos/:uuid/calibration` (+ aliases granulares height/rotation-x/z/distance-scale/marker-scale/reviewed) | Escrita (posse) |
| PUT/POST/DELETE | `/photos/:uuid/targets[...]` (override/visibility/criar/deletar link) | Escrita (posse) |
| DELETE | `/api/v1/sv360/photos/:uuid` (soft-delete tombstone) · POST `/photos/batch-calibration` | Escrita (posse) |
| POST | `/api/v1/sv360/admin/projects/upload` (ingestão de bundle) | Admin OM |
| GET/PATCH/DELETE | `/api/v1/sv360/admin/projects[...]` (listar incl. disabled / status / hard-delete) | Admin OM |

---

## Modelo de Sync / CRDT

Todas as entidades colaborativas são gerenciadas **exclusivamente via sync** — não há rotas REST de
escrita separadas.

- **Resolução de conflito:** Last-Writer-Wins **por ordem de chegada** ao servidor (NÃO por timestamp).
  Idempotência por `op_id` do cliente. Delete (soft) vence updates subsequentes na ordem de chegada.
  *(O módulo `src/crdt` LWW-por-timestamp foi removido.)*
- **Sistema híbrido (pull):** `versão == 0` ou `< min_version` → **snapshot** materializado; senão →
  **operações incrementais**. Resposta inclui `isSnapshot`.
- **Entidades:** `feature` (18 tipos), `group` (hierárquico via `parent_id`), `layer`, `map`, `briefing`,
  `slide`, `group_feature`, `cesium3d` (marker/measurement/viewshed/camera_position), `streetview360`
  (orientation/marker).
- **Sub-entidades de mapa (via sync):** `mapPosition`, `baseLayer`, `mapNotes`, `gridStyle`
  (`maps.grid_style`), `mapTemporal` (`maps.temporal_config`, gated), `catalogLayer` (tabela
  `catalog_layers` por-camada; dual-mode com a coluna legada `maps.catalog_layers`).

### Envelope de operação (aceita ambos os vocabulários)

```javascript
{ id: UUID, entityType /* ou target */, operationType /* ou type */,
  entityId /* ou targetId */, mapId, data /* ou changes p/ update */, timestamp, clientId }
```
Mapeamentos automáticos: `marker3d/measurement3d/viewshed3d/cameraPosition3d ↔ cesium3d`,
`orientation360/marker360 ↔ streetview360`. Campo de mapa: `center_long` (não `center_lng`).

### Snapshot
Estrutura idêntica ao IndexedDB do frontend: `{ atlas, maps:[{ …, features:{points,lines,…},
cesium3d:{cameraPositions,markers,measurements,viewsheds}, streetview360:{orientations,markers},
layers, groups, sync }], briefings, currentVersion }`. `SyncMetadata` em cada entidade.

---

## WebSocket (Colaboração)

- **Autenticado:** `ws://host/api/v1/collab?atlasId=X&token=JWT&clientId=<estável>`
- **Público (read-only, 1h):** `…&token=PUBLIC_TOKEN` (de `GET /atlas/public/:link`)

`clientId` é validado (`^[a-zA-Z0-9_-]{8,64}$`); ausente/malformado → gerado. É chave de
presença/idempotência, **não** credencial (autorização vem do JWT).

| Mensagem | Descrição |
|----------|-----------|
| `ping`/`pong` | Heartbeat |
| `cursor`, `selection` | Presença |
| `operation`/`operations` | Ops CRDT → `ack`/`ack_batch` com `results[]` (`{success, operationId, idempotent, currentVersion}`) + broadcast aos peers |
| `connection-quality` → `adaptive-settings` | Monitor de qualidade adaptativo |
| `sync_request`/`sync_response` | Sync via WS (snapshot ou ops) |
| `user_joined`/`user_left` · `user_away`/`user_back` | Presença. Queda de rede (close `1006`/`terminate`) → `away` por `WS_AWAY_GRACE_MS`; reconexão c/ mesmo `clientId` cancela e emite `user_back`; close limpo ou `leave` (in) → `user_left` imediato. `getRoomUsers` carrega `status: online\|away` |
| `connected` | `permission` (owner/manage/write/comment/read) **e** `role` (admin/owner/manager/editor/commenter/viewer); `sessionId = clientId` |
| `atlas_updated`/`atlas_deleted`/`atlas_settings_updated`/`sharing_updated`/`maps_merged` | Broadcast de mutações REST |
| `briefing_edit_start`/`end` → `..._started`/`..._ended` | Awareness de briefing |

> **Escala:** o estado efêmero (salas/presença/cursores) vive em memória numa **única instância**
> (`collab.rooms.js`). Multi-instância exige Redis pub/sub (Fase 8 Tarefa 6, adiada) ou sticky-session no LB.

---

## Distribuição de binários 3D / 360

Binários pesados ficam **fora do Postgres** (que guarda só metadados/ponteiro). Mesmo padrão nos dois:
ETag O(1) (sem ler o BLOB) → **304 antes de qualquer I/O** → Range 206/416 → semáforo no caminho SQLite.

- **Assets 3D** (`tileset.json`/`.b3dm`/`.glb`/`.pnts`/`.terrain`): **dual-mode** — store SQLite
  (`better-sqlite3`, BLOB em worker pool) primeiro, **filesystem como fallback**. Metadados em
  `ng.catalogo_3d`. Carga: `node scripts/assets3d-import.js <dir>`.
- **StreetView 360** (`sv360`): BLOBs WebP num **SQLite por projeto** `{slug}.db` (`db_filename`
  derivado `${orgId}__{slug}.db`). Ingestão de bundle é **swap-then-commit** (commit do Postgres é o
  ponto atômico). Ver 16 - StreetView 360.

---

## Segurança (hardening)

- **Rate limiting** (`express-rate-limit`) em `/auth/{login,refresh,register}` (chave IP+username) e
  `/atlas/public/:link` (por IP). Pulado em teste (a menos de `RATE_LIMIT_FORCE=1`).
- **Login timing-safe**: bcrypt sempre roda (hash dummy quando o usuário não existe); mensagem genérica.
- **Refresh tokens**: rotação + detecção de reuso (revoga a família); revogados na troca/reset de senha
  e na desativação do usuário.
- **JWT**: `jwt.verify(..., { algorithms:['HS256'] })` no REST e no gateway WS.
- **Upload de imagem**: allowlist `png/jpeg/webp` (**sem SVG**) + magic-bytes (multipart e base64);
  download como `attachment` com `ETag`/`immutable`/`Range`.
- **`POST /sync`**: validação Joi (máx. 500 ops) no REST e no WS.
- **helmet** CSP/HSTS (HSTS só em prod); handler 404 padronizado; health com `SELECT 1`.
- **Auditoria** (`audit_trail`, banco, consultável, transacional via `createAudit(req, params, t)`) é
  distinta do logging operacional.

---

## Gaps Conhecidos

Cruzando as ~313 ações da interface (`acoes-interface-multiusuario.md`) com o backend.
**~95% das funcionalidades multiusuário estão implementadas.** Nenhum defeito conhecido em aberto —
a varredura sistemática de 2026-07 (segurança + correção, 5 frentes) teve **todos** os achados
corrigidos com teste de regressão; ver o histórico em `git log`.

### Resolvidos
| Gap | Solução |
|-----|---------|
| Atlas delete notifica WS · mutações REST com broadcast | `closeRoom()`/`atlas_deleted` (4001); `atlas_updated`/`settings`/`sharing`/`operations`/`map_duplicated` |
| Mover feição entre mapas · duplicar mapa · map reorder · awareness de briefing | `map_id` em `UPDATE_FIELDS`; `/maps/:id/duplicate`; `atlas_updated` (map_order); `briefing_edit_*` |
| `gridStyle` · `catalogLayer` por-camada · config temporal · merge de mapas | ✅ Fase 1 (baseline `002_atlas`; `POST /maps/:id/merge`) |
| Idempotência de sync · presença `away`/`remove` + `clientId` | ✅ Fase 0/8 (`op_id` UNIQUE; `user_away`/`user_back`) |
| **Lock de MAPA imposto no servidor** | `assertOperationAllowed()`: mapa `locked=true` recusa (409) mutação de entidade-filha; delete/flip de `locked` exigem `owner` (403) |
| **Autorização reconciliada com o banco a cada request** | `getLiveAuthState()` no `auth` estrito: conta desativada → 401, org inativa → 403, `role` global vindo do banco |
| **Ordem de versão do sync** | `pg_advisory_xact_lock` por atlas no push: a ordem de `server_version` passa a coincidir com a ordem de commit (antes, um pull incremental podia pular uma op comitada) |

### Abertos (por design / sob demanda)
| Prioridade | Gap | Status |
|-----------|-----|--------|
| P3 | Sub-canais WS por mapa | Pendente (otimização de tráfego). Hoje as salas são **por atlas**: cursor/seleção/ops chegam a todos os conectados — o frontend filtra por `mapId`. |
| P3 | Viewport loading no atlas | Pendente (atlas é JSONB sem PostGIS; sob demanda de performance) |
| P2 | **Escala single-instance** | Salas/presença/cursores vivem em memória numa instância (`collab.rooms.js`). Em multi-instância, use **sticky-session** no LB até haver Redis pub/sub. Ver [deploy-backend](../docs/wiki/deploy-backend.md). |
| P2 | **Superfície de admin de acesso 3D/grupos** | As tabelas (`ng.model_permissions`, `ng.groups`, `ng.user_groups`) existem e o filtro de leitura já as honra, mas **não há rota CRUD**: conceder acesso a modelo privado ou gerir membresia é tarefa de seed/DBA hoje. |
| P2 | **Auditoria parcial dos fluxos destrutivos** | Em `audit_trail` hoje: `ORG_*`, `USER_DELETE`, `API_KEY_ROTATE`, `PERMISSION_GRANT`. **Ausentes** (apesar de estarem no CHECK): `LOGIN`/`LOGOUT`, `USER_CREATE`/`USER_UPDATE`/`PASSWORD_RESET`/`ROLE_CHANGE`, `ATLAS_DELETE`, `SHARING_CHANGE`. Infra pronta — basta chamar `createAudit`. |
| P3 | **URLs de serviço sem fail-fast** | `validateEnvVariables()` valida `DATABASE_URL`/`JWT_SECRET`/`PORT`/`CORS_ORIGIN`, 20 knobs numéricos e as durações JWT — mas **não** alerta se `SV360_SERVICE_URL`/`MAP3D_TERRAIN_URL` ficarem no default `localhost` em produção. Confira manualmente via `GET /api/config`. |
| P3 | **Índice GIN parcial de FTS sobre públicos** | `idx_catalogo3d_public_fts` não existe. Há o GIN completo `idx_cat3d_search` (`search_vector`) e o parcial de id `idx_catalogo_3d_public`. Criar só se o volume do catálogo público exigir. |
| N/A | Undo/Redo; dados temporais por feição | Frontend / OK (viajam em `properties` JSONB) |

### Comportamentos que parecem defeito, mas são intencionais

| Comportamento | Por quê |
|---------------|---------|
| **LWW é por ordem de chegada ao servidor, não por timestamp** | `applyOperation` aplica todo UPDATE incondicionalmente; o `client_timestamp` viaja e é devolvido, mas **não** decide o vencedor. Idempotência é por `op_id`. Não é um CRDT de verdade — o servidor define a ordem total. |
| **Escrita do módulo `sv360` não emite broadcast WS** | O 360 está **fora** do sync/CRDT do atlas. Após uma escrita, recarregue `GET /sv360/photos/:uuid` — não espere evento em tempo real. |
| **O remetente HTTP não é excluído do broadcast** | Não há socket no contexto HTTP. Mitigado no cliente: ops com `clientId` próprio são descartadas. |
| **Lock de camada/grupo/feição individual continua advisory** | Só o lock de **MAPA** é imposto no servidor. O frontend ainda reflete os demais localmente. |
| **DELETE de projeto sv360 é hard-delete** | Não há tombstone de projeto; o "soft" equivalente é `PATCH .../status` com `disabled`. |
| **Janela de crash entre swap e commit na ingestão 360** | Ingestões concorrentes do mesmo `(orgId, slug)` são serializadas por advisory lock, mas um crash entre o swap do `{slug}.db` e o commit deixa arquivo-novo + metadados-velhos. Benigno: fotos já anunciadas seguem servíveis; reingerir resolve. |
| **Calibração 360 valida tipo/finitude, sem faixas** | Colunas `DOUBLE PRECISION`/`INTEGER` sem CHECK; o contrato congelado não documenta min/max. `NaN`/`Infinity`/string → 422; qualquer número finito passa. |
| **Sem CI no GitHub** | Descartado por opção — rode `npm run lint` e `npm test` localmente. |

**Lifecycle de socket é client-driven:** `auth.logout` revoga só o refresh token — **não** fecha sockets de
`collab` nem limpa presença; um socket só cai no fechamento pelo cliente (`leave`/close) ou quando o sweep de
heartbeat reconcilia **autorização** (share revogado / atlas despublicado / org desativada — **não** a
revogação do refresh token). **Um socket por `atlasId`** (sem "switch" no servidor): trocar de atlas exige
nova conexão + fechar a anterior pelo cliente. `flexibleAuth` faz sliding renewal do cookie `token` (<5 min p/ expirar).
