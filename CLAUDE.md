# CLAUDE.md — EBGeo Backend

API REST + WebSocket (Node 20, ES Modules) do app de mapeamento geoespacial militar EBGeo:
auth JWT, persistência PostgreSQL/PostGIS, colaboração em tempo real e sync offline-first.

**Constraint fundamental:** o backend é **aditivo** — a app deve funcionar idêntica para usuário
**não autenticado**. Nenhuma mudança pode quebrar o caminho anônimo nem os contratos congelados do
frontend.

> Referência completa (rotas, env, migrações, permissões, protocolo WS, convenções detalhadas) está
> no **[README.md](README.md)**. Guias de integração por subsistema em **[docs/implementado/](docs/implementado/)**
> (série numerada `00`–`16` + `99-pendencias-e-desvios`). Deploy em
> **[docs/deploy/deploy.md](docs/deploy/deploy.md)**. Este arquivo é o contrato de comportamento —
> mantenha-o curto.

## Stack & layout

`Express 4` · `pg-promise` (SQL direto, sem ORM) · `ws` · `jsonwebtoken`+`bcrypt` · `joi` · `pino` ·
`better-sqlite3` (BLOBs 3D/360).

- `src/index.js` boot (HTTP + WS + `validateEnvVariables()` fail-fast) · `src/app.js` factory `createApp()` (testável)
- `src/config.js` env · `src/database/` (`query`/`tx`, `migrate.js`, `migrations/`) · `src/middleware/` · `src/utils/`
- `src/modules/<nome>/` — `auth users atlas maps briefings resources sharing images sync collab config nomes zones streetview360`

## Comandos

```bash
npm run dev            # node --watch
npm run db:migrate     # aplica migrações | npm run db:seed
npm test               # cria DB ebgeo_test → migra → roda → dropa (unit+integration+ws, 738 casos)
npm run test:unit | test:integration | test:ws   # subconjuntos
npm run test:keep-db   # mantém o DB p/ debug
npm run lint           # eslint (rode antes de finalizar) | npm run format
```

- `npm test` é hermético (cria/dropa `ebgeo_test`). **PostGIS** é extensão *untrusted*: o runner
  pré-cria as extensões via `SUPERUSER_DATABASE_URL` (default `postgres:postgres@localhost`) — sem um
  superusuário acessível os testes que usam `ng`/`sv360` falham.
- Testes batem no `app` exportado via **supertest** (não sobem servidor); WS em `tests/ws/`.

## Decisões de arquitetura — NÃO violar (e o porquê)

- **Escrita de entidades colaborativas é SÓ via sync** (`POST /atlas/:id/sync` ou WS `operation`).
  `maps`/`briefings` têm **apenas GET**. **Não crie rotas REST de escrita** para feature/group/layer/
  map/briefing/slide/cesium3d/streetview360 — elas viajam como operações CRDT.
- **Conflito = LWW por ordem de chegada** (NÃO por timestamp); idempotência por `op_id`
  (`ON CONFLICT DO NOTHING`). O módulo `src/crdt` (LWW-por-timestamp) foi **removido** — não religar
  sem requisito de produto.
- **Geometria do atlas é JSONB** (schema `public`, mesmo formato do IndexedDB). **PostGIS vive só nos
  schemas `ng`** (nomes/edificações/catálogo 3D) **e `sv360`**. **Nunca** adicione PostGIS ao schema
  do atlas (decisão: filtro espacial do atlas seria bbox em JS, não `ST_Intersects`).
- **Controle de acesso embutido na query SQL** (`ng`/`sv360`): o dado privado não vaza nem com bug de
  app. Toda query com filtro de acesso **exige um teste negativo** (usuário sem permissão não vê).
- **Soft-delete sempre** (`deleted_at`, ou `is_active` p/ usuários; tombstone p/ fotos 360). **Nunca**
  faça hard-DELETE de entidade principal. `atlas.owner_id`/`images.uploaded_by`/`atlas_shares.added_by`
  são FK **sem `ON DELETE`** → reatribua (`?transferTo`) antes de qualquer hard-delete de usuário.
- **Contratos congelados do frontend** — mudar o *shape* exige teste de contrato e alinhamento:
  `GET /api/config` (config.js), `GET /nomes/busca` (array nu), metadado de foto `sv360` (câmera plana,
  `previewThumbnail` relativo), envelope de operação de sync, e o snapshot (estrutura idêntica ao IndexedDB).
- **Identidade = JWT de emissor único**: `sub`, `role ∈ {user,admin}` (global), `organization_id`,
  `org_role ∈ {owner,editor,viewer,admin}` + aliases `org`/`login`. Tokens legados degradam
  (`org_role→viewer`, `organization_id→null`). `flexibleAuth` é global e **não-bloqueante** (Bearer/cookie/
  `x-api-key`, preserva anônimo); rotas de escrita usam o middleware `auth` **estrito** (401 sem token).
- **`sv360` está FORA do sync/CRDT/WS** do atlas: BLOBs WebP em SQLite por projeto (`{slug}.db`, worker
  pool + ETag O(1) + semáforo), erros em envelope **plano** `{ error }` (não `{error:{code,message}}`),
  `db_filename` **derivado no servidor** (`${orgId}__{slug}.db`), ingestão swap-then-commit. Detalhes em
  [docs/implementado/16-streetview-360.md](docs/implementado/16-streetview-360.md).

## Convenções de código

- **Um arquivo por responsabilidade** no módulo (referência: `src/modules/atlas/`):
  `.routes.js` (só rotas, ordem `[auth, requireAtlasPermission, validate, ctrl]`) · `.controller.js`
  (HTTP, sempre `asyncHandler`, lê `req`, escreve `res.json({ data })`/`201`/`204`) · `.service.js`
  (toda a lógica) · `.queries.js` (SQL `UPPER_SNAKE`, `$1..$n`) · `.schemas.js` (Joi) · `index.js` (re-export).
- **Validação Joi na borda** (`validate({ body })` na rota), nunca no controller. Toda rota de escrita valida.
- **Erros**: lance subclasses de `AppError` (`NotFoundError`404 · `ForbiddenError`403 ·
  `UnauthorizedError`401 · `ConflictError`409 · `ValidationError`422 · `BadRequestError`400); o
  `errorHandler` (último em `app.js`) mapeia e mascara stack em prod. Sem try/catch por rota (`asyncHandler`).
- **DB**: `query()` retorna `{ rows }`; `one/any/none` e os `t.*` retornam **direto**. Multi-query
  atômica via `tx(async t => …)` — **passe o `t`** às chamadas internas (inclusive `createAudit(req, p, t)`).
- **SQL 100% parametrizado**; `SET` dinâmico só a partir de **whitelist de colunas**, nunca de input.
- **Mutação colaborativa faz broadcast WS** após a escrita e antes do `res` (`atlas_updated`,
  `operations`, etc.).

## Migrações

`src/database/migrations/NNN_*.sql`, ordem alfabética, tracking em `_migrations`, **forward-only**,
**aditivas** (`ADD COLUMN DEFAULT`/`CREATE TABLE/INDEX`). Use o **próximo número livre** (head = `018`).
`gen_random_uuid()` para PKs (não `uuid_generate_v4`). Migração que mexe em PostGIS precisa de superusuário.

## Segurança (baseline)

SQL parametrizado · rate limit em `/auth/{login,refresh,register}` e `/atlas/public/:link` · bcrypt
custo 12 + login timing-safe + rotação/detecção-de-reuso de refresh · `jwt.verify` **só HS256** · upload
allowlist `png/jpeg/webp` + magic-bytes (**sem SVG**), download como `attachment` · helmet CSP/HSTS ·
self-registration gateada por `ALLOW_SELF_REGISTRATION` (off em prod).

## Antes de finalizar

`npm run lint` limpo e `npm test` verde (unit+integration+ws). Toda mudança de schema/sync precisa de
teste de regressão; todo filtro de acesso precisa de teste com usuário **sem** permissão. Atualize o
`README.md`/doc as-built relevante se o comportamento documentado mudou.
