# _padroes.md — Padrões e Convenções Compartilhados

> **Leia este arquivo ANTES de qualquer fase.** Todas as fases referenciam estes padrões.
> Baseado na verificação do código atual (branch `main`). Os file:line abaixo são reais e citáveis.

---

## 1. Template canônico de módulo

Cada módulo é um diretório em `src/modules/<nome>/` com **um arquivo por responsabilidade**.
Módulo de referência: `src/modules/atlas/`.

| Arquivo | Responsabilidade | Regras |
|---------|------------------|--------|
| `<nome>.routes.js` | **Só** definição de rotas | Cria `const router = Router()`, monta middlewares na ordem `[auth, requireAtlasPermission(...), validate({...}), ctrl.X]`, exporta nomeado (`export { router as atlasRoutes }`). **Sem lógica.** Sub-routers via `router.use('/:atlasId/sub', subRoutes)`. |
| `<nome>.controller.js` | Camada HTTP | Cada handler é `export const X = asyncHandler(async (req, res) => {...})`. Lê de `req` (`req.user.id`, `req.atlasId`, `req.body`, `req.params`), chama o service, escreve `res.json({ data })` / `res.status(201\|204)`. Handlers de mutação que afetam estado colaborativo fazem **broadcast WS** após a escrita e antes do `res`. |
| `<nome>.service.js` | **Toda** a lógica de negócio | `export async function X(...)`. Importa `{ query, tx } from '../../database/index.js'` e `* as Q from './<nome>.queries.js'`. Lança erros de domínio (`NotFoundError` etc). |
| `<nome>.queries.js` | Constantes SQL nomeadas | UPPER_SNAKE_CASE com placeholders `$1,$2`. **Sem lógica.** |
| `<nome>.schemas.js` | Schemas Joi | Exportados nomeados (`createAtlasSchema` etc.), `.custom()` para regras cross-field. |
| `index.js` | Re-export para imports limpos | `export { atlasRoutes } from './atlas.routes.js'; export * as atlasService from './atlas.service.js';` |

### Exemplo real (controller)
```javascript
// atlas.controller.js:11-14
export const createAtlas = asyncHandler(async (req, res) => {
  const atlas = await atlasService.createAtlas(req.user.id, req.body);
  res.status(201).json({ data: atlas });
});
```

### Exemplo real (mutação com broadcast)
```javascript
// atlas.controller.js — padrão de mutação colaborativa
export const updateAtlas = asyncHandler(async (req, res) => {
  const atlas = await atlasService.updateAtlas(req.atlasId, req.body);
  broadcastToRoom(req.atlasId, { type: 'atlas_updated', atlas });  // após escrita, antes do res
  res.json({ data: atlas });
});
```
Eventos de broadcast existentes: `atlas_updated`, `atlas_deleted` (via `closeRoom`),
`atlas_settings_updated`, `sharing_updated`, `operations`, `map_duplicated`.

### Exemplo real (service)
```javascript
// atlas.service.js
export async function createAtlas(userId, data) {
  const { rows } = await query(Q.INSERT_ATLAS, [data.name, data.description, userId]);
  return rows[0];
}
```

### Convenção de nomes
- Arquivos: `<modulo>.<camada>.js` (kebab para módulos compostos).
- SQL: `INSERT_ATLAS`, `GET_ATLAS_MAPS`, `SOFT_DELETE_USER` (UPPER_SNAKE, verbo + entidade).
- Schemas Joi: `createAtlasSchema`, `pushSchema` (camelCase + sufixo `Schema`).
- Rotas: montar sob `/api/v1/<modulo>` em `app.js`, ou aninhar em `atlas.routes.js` sob
  `/:atlasId` se for recurso de atlas.

---

## 2. Camada de erro

`src/utils/errors.js` — `AppError extends Error` (`message`, `statusCode`, `code`,
`isOperational = true`) + **6 subclasses reais**:

| Subclasse | HTTP | code |
|-----------|------|------|
| `NotFoundError` | 404 | `NOT_FOUND` |
| `ForbiddenError` | 403 | `FORBIDDEN` |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` |
| `ConflictError` | 409 | `CONFLICT` |
| `ValidationError` | 422 | `VALIDATION_ERROR` (com `details`) |
| `BadRequestError` | 400 | `BAD_REQUEST` |

- **`asyncHandler(fn)`** (`utils/async-handler.js`) envolve handler async e faz `.catch(next)`.
  **Sempre use** — zero try/catch por rota.
- **`error-handler`** (registrado por último em `app.js`) distingue:
  (a) Joi (`err.isJoi`) → 422 com `details` `{field,message}`;
  (b) `instanceof AppError` → usa `statusCode`/`code`;
  (c) desconhecido → 500 `INTERNAL_ERROR`, mensagem mascarada.
- **Atenção:** a máscara de mensagem/stack usa `config.isDev` (não `!isProd`). Em `NODE_ENV=test`
  também mascara. Comportamento correto para prod; documentado como intencional.

**Formato de resposta:**
```json
{ "data": { ... } }                                          // sucesso
{ "error": { "code": "NOT_FOUND", "message": "..." } }       // erro
```

---

## 3. Validação Joi via middleware

`src/middleware/validate.js`:
- `VALIDATION_OPTIONS = { abortEarly: false, stripUnknown: true }`.
- Itera `['body','params','query']`, valida cada um presente e **reatribui o valor coergido**
  (`req[source] = value`). Controllers leem de `req.body` já normalizado.
- Em erro, chama `next(error)` (objeto Joi tratado pelo error-handler).

**Regra:** valide **na borda** (middleware na rota), nunca no controller. Toda rota de escrita
DEVE ter `validate({ body: <schema> })`. (Gap conhecido: `POST /sync` não tem — corrigido na fase-0.)

---

## 4. Transações

`src/database/index.js` expõe `tx(callback)` (pg-promise, commit/rollback automáticos):
```javascript
import { tx } from '../../database/index.js';
await tx(async (t) => {
  await t.none(Q.INSERT_SOMETHING, [params]);
  await t.one(Q.GET_SOMETHING, [params]);
});
```
**Regra:** toda operação multi-query que precisa de atomicidade usa `tx()`.

**Atenção a duas convenções de retorno no mesmo módulo de DB:**
- `query()` retorna shape de compat `{ rows, rowCount }`.
- `one`/`oneOrNone`/`many`/`any`/`none` (e os métodos `t.*` dentro de `tx`) retornam **direto** do
  pg-promise (sem `.rows`).

Não misture: dentro de `tx`, use `t.none`/`t.one`/`t.any` (retorno direto).

**Helper de auditoria transacional (a partir da fase-5):** `createAudit(req, params, t?)` aceita o
`t` da transação como 3º parâmetro opcional, para que a auditoria participe da mesma transação do
negócio (se reverte, o audit reverte junto). Ver `99-referencia.md`.

---

## 5. Config

`src/config.js`: helpers `required(key)` (fail-fast: throw se ausente) e `optional(key, fallback)`.
Objeto `Object.freeze` aninhado. Getters `isDev`/`isProd`/`isTest`. `required()` hoje só em
`DATABASE_URL` e `JWT_SECRET`.

**A partir da fase-0**, adotar `validateEnvVariables()` fail-fast agrupado por contexto (Database,
Authentication, Security): `JWT_SECRET >= 32 chars` em prod, portas válidas, origins válidas.
Falhar cedo e ruidosamente no boot.

---

## 6. app.js vs index.js

- **Separados.** `app.js` exporta `createApp()` factory + `export default createApp()` (testável
  por supertest sem subir servidor). `index.js` importa o app, cria `createServer(app)`, acopla WS
  via `attachWebSocket(server)` **no mesmo servidor HTTP**, faz listen, e graceful shutdown
  (SIGTERM/SIGINT fecha server + `pgp.end()`).
- **Ordem de middleware global** (`app.js`): `helmet()` → `cors({origin, credentials:true})` →
  `compression()` → `express.json({limit:'10mb'})` → `requestLogger` (pulado se isTest) →
  `GET /api/v1/health` → rotas montadas → `errorHandler` (último).
- **Rotas públicas (sem auth)** montam-se ANTES do middleware de auth, espelhando o padrão do
  `/health`. Ex.: `GET /api/config` (fase-2) e `/api/v1/atlas/public/:link` são públicas.

---

## 7. Padrão de migração

- Arquivos em `src/database/migrations/`, **numerados** (`001_`...`005_`; próxima = `006_`),
  executados em **ordem alfabética** por filename.
- Tracking via tabela `_migrations` (`name UNIQUE, applied_at`). O runner pula já-aplicadas e roda
  cada arquivo em **uma transação** (`db.tx`). Sem checksum.
- **Forward-only** (sem rollback/down). Não há convenção up/down. Se rollback for requisito futuro,
  adotar `NNN.up.sql`/`NNN.down.sql` — fora de escopo do plano atual.
- **Aditivo vs estrutural:**
  - *Aditivo* (baixo risco): `ADD COLUMN ... DEFAULT`, `CREATE TABLE`, `CREATE INDEX`. Preferir.
  - *Estrutural* (alto risco, requer ordem e backfill): novas extensões (PostGIS), novos schemas
    (`ng`), FKs novas em colunas existentes, mudança de tipo.
- **Ordem recomendada do bloco estrutural** (dependências fortes):
  `006 grid_style` → `007 idempotência operations` → `008 catalog_layers` → `postgis+ng` →
  `organizations + user_groups` → `zones/permissions` → `model_permissions` → `audit_trail/api_keys`.
  (zones dependem de PostGIS; `*_group_permissions` dependem de `user_groups`; `api_key_history`
  depende de `api_keys`.)
- **Os números de migração citados nos arquivos de fase são PLACEHOLDERS, não slots reservados.**
  Como fase-0, fase-1, fase-2, fase-3 e fase-5 correm em paralelo, vários arquivos de fase escrevem
  `006_*.sql` como nome de exemplo. **Esta ordem relativa acima é a única fonte de verdade.** Ao
  implementar, **use sempre o próximo número livre em `src/database/migrations/`** e numere segundo
  esta ordem relativa — **nunca** crie dois arquivos com o mesmo número. Se o número escrito no
  arquivo da sua fase já estiver ocupado (porque outra fase paralela o consumiu), **renumere para o
  próximo livre**; o número absoluto no doc da fase é ilustrativo.
- **Padronizar `gen_random_uuid()`** (pgcrypto, nativo PG 13+) para PKs — não usar `uuid_generate_v4`.

### Convenções transversais de schema (carregar do `ebgeo_web_2_backend`)
- UUID PK gerado no banco; `created_by`/`created_at`/`updated_at` em toda tabela mutável + trigger
  genérica de `updated_at`.
- SRID **4674** explícito no tipo geográfico de nomes (`GEOMETRY(POINT,4674)`); distâncias/áreas via
  cast `::geography` (metros/m² reais, não graus).
- `CHECK` em todo enum textual. Soft-delete via `deleted_at` (entidades de atlas) ou `is_active`
  (usuários). Índices parciais para a fatia quente (`WHERE deleted_at IS NULL`, `WHERE active`).
- Junções N:N: PK composta `(a_id, b_id)` + `ON DELETE CASCADE` + índice no outro sentido.

---

## 8. Baseline de segurança

- **SQL 100% parametrizado** (`$1..$n` via pg-promise). Nunca concatenar input em SQL. Em SQL
  dinâmico (`buildDynamicUpdate`), nomes de coluna vêm de **whitelist**, nunca de input.
- **NÃO** copiar sanitização "blunt" que apaga `'";` de strings — corrompe conteúdo legítimo;
  confiar em query parametrizada para SQLi e sanitizar só na saída.
- **Rate limit** (`express-rate-limit`) em rotas não autenticadas: `/auth/login`, `/auth/refresh`,
  `/auth/register`, `/atlas/public/:link`.
- **Validação de upload:** sem SVG inline (XSS armazenado); validar **magic bytes** contra o
  `mimeType` declarado em multipart E base64. Servir downloads com `Content-Disposition: attachment`.
- **Auth:** `jwt.verify(..., { algorithms: ['HS256'] })`; bcrypt custo 12; refresh token só como
  hash SHA-256 com rotação; login **timing-safe** (dummy bcrypt quando usuário não existe);
  revogar tokens na troca/reset de senha; detectar reuso de refresh.
- **helmet** com CSP/HSTS explícitos em prod; CORS por origin (não wildcard), `credentials:true`.
- **Self-registration** deve ser gateado em rede militar (feature flag ou só admin cria usuários).
- **error-handler** não vaza stack em prod.

---

## 9. Convenções de teste

25+ arquivos em `tests/`, 3 categorias:

| Categoria | Localização | Comando |
|-----------|-------------|---------|
| Unit | `tests/unit/` | `npm run test:unit` |
| Integration | `tests/integration/` | `npm run test:integration` |
| WebSocket | `tests/ws/` | `npm run test:ws` |

- **Runner automatizado** (`scripts/run-tests.js`): cria DB `ebgeo_test` → migra → roda
  `node --test` → dropa DB no `finally` (a menos de `--keep-db`). Usa `NODE_ENV=test`,
  `DATABASE_URL=TEST_DB_URL`, `JWT_SECRET` fixo, `IMAGES_DIR=./data/test-images`.
- Testes de integração novos entram em `tests/integration/` e são cobertos automaticamente por
  `tests/**/*.test.js`.
- **Helper de usuário de teste** (padrão a adotar, do `ebgeo_web_2_backend`):
  `createTestUser(role, isActive)` insere com bcrypt e devolve `{ user, token, password }`.
- **Testes obrigatórios por fase:** toda mudança de schema/sync precisa de teste de regressão; toda
  query com filtro de acesso precisa de teste com usuário **sem** permissão (não vazar dados).
- **Bater no `app` exportado** via supertest (não subir servidor).

---

## 10. Template de TAREFA e Definition of Done

Cada fase descreve seu trabalho como uma lista de tarefas neste formato:

```
### Tarefa N: <título curto e imperativo>

**Objetivo:** <o que esta tarefa entrega, em 1-2 frases>

**Arquivos afetados:**
- `src/modules/<x>/<x>.service.js` (modificar)
- `src/database/migrations/006_<x>.sql` (criar)

**Padrão de código:** <referência a este _padroes.md, seção N; cite file:line de exemplo>

**Implementação:**
1. <passo concreto>
2. <passo concreto>

**Critérios de aceitação:**
- [ ] <comportamento observável e verificável>
- [ ] <contrato preservado / não-regressão>

**Testes:**
- `tests/integration/<x>.test.js`: <casos, incluindo caso negativo>

**Dependências:** <Tarefa M desta fase / fase-K concluída / nenhuma>
```

### Definition of Done (DoD) — checklist universal

Uma tarefa só está concluída quando:

- [ ] Código segue o template canônico de módulo (seção 1) e a convenção de nomes.
- [ ] Toda rota de escrita tem `validate()` com schema Joi (seção 3).
- [ ] Erros usam `AppError`/subclasses + `asyncHandler` (seção 2).
- [ ] Operações multi-query são transacionais via `tx()` (seção 4).
- [ ] Migração nova é aditiva, numerada, idempotente (seção 7).
- [ ] SQL é 100% parametrizado; filtros de acesso têm teste com usuário sem permissão (seção 8/9).
- [ ] Mutações colaborativas fazem broadcast WS (seção 1).
- [ ] Contratos de frontend congelados não foram quebrados (snapshot, config.js, busca, 360).
- [ ] Testes (unit/integration/ws) passam via `npm test`; casos negativos cobertos.
- [ ] `CLAUDE.md`/docs atualizados se o comportamento documentado mudou.
- [ ] Sem código morto novo; nenhum segredo commitado.
