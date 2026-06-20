# Fase 0 — Hardening, correção de bugs e DevOps

> **✅ STATUS: IMPLEMENTADA** (todas as 13 tarefas). Suite em 632 casos, verde via `npm test`.
> Migração aplicada: `006_operations_idempotency.sql`. Decisão D2 (modelo de conflito) registrada e
> documentada em `CLAUDE.md` (LWW-por-chegada + idempotência por `op_id`; `src/crdt` permanece código
> morto até a Fase 1 decidir plugá-lo ou removê-lo). DevOps: Dockerfile/compose usam `postgis/postgis:16`
> (superset do plano original, necessário para as Fases 3+). **CI do GitHub removido por opção do usuário**
> (Tarefa 13 entregou Docker/lint/format; o `ci.yml` foi descartado). Testes novos: `auth-hardening`,
> `rate-limit`, `sync-validation`, `images-hardening`, `health`, `unit/config`, `ws/collab-validation`.
> **Esforço:** Médio.
> **Depende de:** nada.
> **Leia antes:** [`_padroes.md`](_padroes.md) e [`00-visao-geral.md`](00-visao-geral.md).

---

## 1. Objetivo e contexto

Esta fase **endurece a postura de segurança**, **corrige os bugs concretos verificados** e
**estabelece a infraestrutura de DevOps** (CI, Docker, lint, health real, cache de imagem). Nada
aqui depende de decisões de produto (modelo de conflito, multi-org, PostGIS) — é trabalho de base
que precisa estar pronto antes de qualquer outra fase, porque:

1. O backend roda em **rede militar interna** e hoje expõe rotas não autenticadas sem rate limit,
   aceita upload de SVG servido inline (XSS armazenado), tem um **timing oracle** no login, nunca
   revoga refresh tokens na troca de senha, e não valida o corpo do `POST /sync`.
2. Há **bugs concretos** já verificados no código (broadcast com `result.applied` sempre indefinido,
   `storagePath`/`mkdir` mortos, `deleteUser` não transacional, sessão de visitante público que
   quebra FK silenciosamente, operações sem idempotência).
3. **Não há nenhuma infraestrutura de DevOps**: sem Dockerfile, docker-compose, workflow de CI,
   ESLint/Prettier. O health-check é raso (`res.json({status:'ok'})` sem tocar o banco).

**Princípio aditivo (do `00-visao-geral.md` §5):** nada aqui pode quebrar o caminho anônimo nem o
contrato com o frontend existente (snapshot, formato de operação de sync, config). As mudanças de
segurança são endurecimentos de borda; o comportamento de sucesso permanece idêntico.

---

## 2. Pré-requisitos e dependências

- **De outras fases:** nenhuma. Esta é a fase raiz.
- **Coordenação com fase-1 (idempotência) — esta fase é a fonte canônica do schema:** a Tarefa 11
  (idempotência `UNIQUE` no log de `operations`) cria a coluna `op_id TEXT`, o backfill
  `op_id = id::text`, o índice **total** `UNIQUE (atlas_id, op_id)` (migração `006`), o
  `INSERT_OPERATION` com `ON CONFLICT (atlas_id, op_id) DO NOTHING RETURNING *` e a query
  `GET_OPERATION_BY_OP_ID`. A **fase-1 Tarefa 2 apenas CONSOME** esse schema (sem nova migração e
  sem coluna nova) e detalha a semântica de ack/retry idempotente. **Não** existe `client_operation_id`
  nem índice parcial — essa era uma especificação concorrente, descartada em favor do `op_id` desta
  fase. A migração head após esta fase é `006_operations_idempotency.sql`; as migrações novas da
  fase-1 começam em `007_`.
- **Migração head atual:** `005_client_id_text.sql`. Próximas migrações desta fase: `006_*`,
  `007_*` (ver Tarefa 11 e _padroes §7 para a ordem recomendada do bloco estrutural).
- **Dependências npm a adicionar:** `express-rate-limit`, `file-type`, `cookie-parser` (se adotar a
  ordem de middleware alvo), `pino-http` (opcional). DevDeps: `eslint`, `prettier`,
  `eslint-config-prettier`, `eslint-plugin-import` (opcional).

---

## 3. Decisões de arquitetura aplicáveis

| # | Decisão | Recomendação |
|---|---------|--------------|
| A0.1 | **Self-registration em rede militar** | **Gatear por feature flag** `ALLOW_SELF_REGISTRATION` (default `false` em prod). Ramo A: flag desliga a rota `POST /auth/register` (404/403). Ramo B: só admin cria usuários (já existe `POST /users`). Recomendado: flag desligada + admin cria. Mantém a rota no código para ambientes de teste/dev. |
| A0.2 | **Contrato de broadcast do `/sync`** (bug 2.4 #1) | **Broadcast explícito de `req.body.operations`** (mais simples, não muda a assinatura do service) E **excluir o sender** do broadcast REST. Ramo alternativo: fazer `pushOperations` retornar `applied`. Recomendado: broadcast do input normalizado + excluir sender (alinha com o comportamento do WS, que já exclui via `excludeWs`). |
| A0.3 | **Política de SVG** | **Remover `image/svg+xml`** da allowlist de upload (mais seguro; SVG é vetor de XSS armazenado e o frontend não depende dele para feições). Ramo alternativo: sanitizar com DOMPurify+jsdom no upload. Recomendado: remover. Se o produto exigir SVG depois, reintroduzir com sanitização explícita. |
| A0.4 | **Range em download de imagem** | Imagens são pequenas (≤ `MAX_IMAGE_SIZE_MB`, default 10MB). **Migrar para `res.sendFile`** com `{ etag, lastModified, acceptRanges, maxAge }` — resolve ETag, 304, Range e cache de uma vez, em vez de `pipe(res)` manual. Ramo alternativo: manter `createReadStream` e adicionar headers à mão. Recomendado: `res.sendFile`. |
| A0.5 | **Health liveness vs readiness** | Recomendado: `GET /api/v1/health` faz `SELECT 1` e retorna 503 em falha (readiness real). Opcional: separar `/health` (liveness, sem DB) de `/health/ready` (readiness, com DB) para o orquestrador. |

---

## 4. Tarefas

> Todas as tarefas seguem o template de `_padroes.md §10` e a DoD universal. Caminhos são reais e
> verificados (`file:line`).

---

### Tarefa 1: Rate limiting nas rotas não autenticadas

**Objetivo:** Limitar tentativas em `/auth/login`, `/auth/refresh`, `/auth/register` e
`/atlas/public/:link` para mitigar brute-force e abuso. Lockout opcional por username.

**Arquivos afetados:**
- `package.json` (adicionar `express-rate-limit`)
- `src/middleware/rate-limit.js` (criar)
- `src/modules/auth/auth.routes.js` (modificar — verificado: hoje sem rate limit, `auth.routes.js:10-12`)
- `src/modules/atlas/atlas.routes.js` (modificar — verificado: rota pública sem rate limit)
- `src/config.js` (adicionar bloco `rateLimit`)

**Padrão de código:** middleware reutilizável (mesma família de `src/middleware/*`). Montar na rota
ANTES do `validate`/`ctrl` (a rota é a borda — _padroes §1).

**Implementação:**
1. `npm i express-rate-limit`.
2. Criar `src/middleware/rate-limit.js` com fábricas nomeadas:
   ```javascript
   // src/middleware/rate-limit.js
   import rateLimit from 'express-rate-limit';
   import config from '../config.js';

   const handler = (req, res) => {
     res.status(429).json({
       error: { code: 'TOO_MANY_REQUESTS', message: 'Muitas tentativas. Tente novamente mais tarde.' },
     });
   };

   // Estrito para credenciais. keyGenerator combina IP + username p/ lockout por conta.
   export const authLimiter = rateLimit({
     windowMs: config.rateLimit.authWindowMs,   // ex.: 15 * 60 * 1000
     max: config.rateLimit.authMax,             // ex.: 10
     standardHeaders: true,
     legacyHeaders: false,
     handler,
     keyGenerator: (req) => `${req.ip}:${(req.body?.username || '').toLowerCase()}`,
     skip: () => config.isTest,                 // não estrangular a suite de testes
   });

   // Mais frouxo para link público (sem corpo). Apenas por IP.
   export const publicLinkLimiter = rateLimit({
     windowMs: config.rateLimit.publicWindowMs, // ex.: 60 * 1000
     max: config.rateLimit.publicMax,           // ex.: 30
     standardHeaders: true,
     legacyHeaders: false,
     handler,
     skip: () => config.isTest,
   });
   ```
3. Aplicar em `auth.routes.js`:
   ```javascript
   router.post('/register', authLimiter, validate({ body: schemas.registerSchema }), ctrl.register);
   router.post('/login',    authLimiter, validate({ body: schemas.loginSchema }),    ctrl.login);
   router.post('/refresh',  authLimiter, validate({ body: schemas.refreshSchema }),  ctrl.refresh);
   ```
4. Aplicar `publicLinkLimiter` na rota `GET /api/v1/atlas/public/:link` em `atlas.routes.js`.
5. Acrescentar ao `config.js` um bloco `rateLimit: Object.freeze({ authWindowMs, authMax, publicWindowMs, publicMax })` lendo via `optional(...)`.

**Critérios de aceitação:**
- [ ] Exceder o limite de login retorna `429 TOO_MANY_REQUESTS` no formato de erro padrão (`_padroes §2`).
- [ ] `skip` em `isTest` mantém a suite verde (limites altos/desligados em teste).
- [ ] Caminho de sucesso (login válido dentro do limite) inalterado.

**Testes:**
- `tests/integration/rate-limit.test.js`: disparar N+1 logins inválidos e asserir 429 no último
  (rodar com `skip` desativado via env de teste ou limite baixo dedicado).

**Dependências:** nenhuma.

---

### Tarefa 2: Login timing-safe + revogação de tokens na troca/reset de senha

**Objetivo:** Eliminar o timing oracle do login (dummy bcrypt quando o usuário não existe), usar
mensagem genérica, e revogar todos os refresh tokens do usuário em `updatePassword`,
`resetPassword` e `deleteUser` usando o `REVOKE_ALL_USER_TOKENS` que já existe mas tem **0 usos**.

**Arquivos afetados:**
- `src/modules/auth/auth.service.js` (modificar — verificado: `login` lança em `:64-66` ANTES do `bcrypt.compare` em `:75` = timing oracle)
- `src/modules/users/users.service.js` (modificar — `updatePassword:43-64`, `resetPassword:162-177`, `deleteUser:185-222`)
- `src/modules/users/users.queries.js` ou importar de `auth.queries.js` (`REVOKE_ALL_USER_TOKENS` existe em `auth.queries.js:35`)

**Padrão de código:** dummy-hash anti-timing (preservado verbatim em §5 abaixo). Mensagem genérica
`UnauthorizedError('Invalid credentials')` para usuário inexistente E senha errada.

**Implementação:**
1. No topo de `auth.service.js`, computar um hash dummy estável uma vez:
   ```javascript
   // Hash bcrypt de uma senha fixa, custo 12. Usado p/ gastar o mesmo tempo
   // de CPU quando o usuário NÃO existe, eliminando o timing oracle.
   const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO9999999999999999999999999999999';
   // (gerar com bcrypt.hashSync('dummy-password', 12) e fixar a constante)
   ```
2. Reescrever `login` para SEMPRE rodar `bcrypt.compare`:
   ```javascript
   export async function login(username, password) {
     const { rows } = await query(Q.FIND_USER_BY_USERNAME, [username]);
     const user = rows[0];

     // Sempre roda bcrypt: contra o hash real ou contra o dummy. Sem short-circuit.
     const hashToCompare = user ? user.password_hash : DUMMY_HASH;
     const isValid = await bcrypt.compare(password, hashToCompare);

     if (!user || !isValid) {
       logger.warn({ username }, 'Failed login attempt');
       throw new UnauthorizedError('Invalid credentials');
     }
     if (!user.is_active) {
       throw new UnauthorizedError('Account is deactivated');
     }
     // ... resto inalterado (UPDATE_LAST_LOGIN, gerar tokens) ...
   }
   ```
3. Em `users.service.js`, após cada mudança de credencial, revogar tokens:
   - `updatePassword`: após `UPDATE_USER_PASSWORD`, `await query(REVOKE_ALL_USER_TOKENS, [userId])`.
   - `resetPassword`: idem após `RESET_USER_PASSWORD`.
   - `deleteUser`: revogar dentro da transação (ver Tarefa 9).
4. Reexportar `REVOKE_ALL_USER_TOKENS` de `auth.queries.js` ou duplicar em `users.queries.js`.

**Critérios de aceitação:**
- [ ] Login com username inexistente e com senha errada retornam a MESMA mensagem (`Invalid credentials`) e tempos comparáveis (bcrypt roda nos dois casos).
- [ ] Após troca/reset de senha, os refresh tokens antigos do usuário ficam revogados (`refresh()` com token antigo → 401).
- [ ] `deleteUser` revoga tokens do desativado.

**Testes:**
- `tests/integration/auth.test.js`: caso usuário inexistente → 401 genérico; caso senha errada → 401 genérico.
- `tests/integration/users-admin.test.js` / `auth.test.js`: trocar senha, então usar refresh antigo → 401.

**Dependências:** Tarefa 9 (deleteUser transacional) compartilha a revogação.

---

### Tarefa 3: Detecção de reuso de refresh token (revogar família)

**Objetivo:** Detectar quando um refresh token **já revogado** é reapresentado (sinal de roubo) e
revogar toda a família de tokens do usuário, forçando re-login.

**Arquivos afetados:**
- `src/modules/auth/auth.service.js` (modificar — `refresh:109-146`; hoje em `:115-117` apenas "não acha" o token revogado e retorna 401, sem reagir ao reuso)
- `src/modules/auth/auth.queries.js` (adicionar query que busca token incluindo revogados)

**Padrão de código:** rotação de refresh com detecção de reuso. O `FIND_REFRESH_TOKEN` atual
(`auth.queries.js:25-29`) filtra `revoked_at IS NULL`, então um token revogado simplesmente "não
existe". Precisamos distinguir "nunca existiu" de "existiu e foi revogado".

**Implementação:**
1. Adicionar query:
   ```javascript
   export const FIND_REFRESH_TOKEN_ANY = `
     SELECT id, user_id, expires_at, revoked_at
     FROM refresh_tokens
     WHERE token_hash = $1
   `;
   ```
2. Em `refresh`, antes da lógica normal:
   ```javascript
   const { rows } = await query(Q.FIND_REFRESH_TOKEN_ANY, [hash]);
   if (rows.length === 0) {
     throw new UnauthorizedError('Invalid refresh token');
   }
   const stored = rows[0];
   if (stored.revoked_at) {
     // Reuso de token revogado → possível roubo. Revoga toda a família.
     logger.warn({ userId: stored.user_id }, 'Refresh token reuse detected');
     await query(Q.REVOKE_ALL_USER_TOKENS, [stored.user_id]);
     throw new UnauthorizedError('Invalid refresh token');
   }
   // ... checar expiry, rotacionar (revogar atual + emitir novo) ...
   ```

**Critérios de aceitação:**
- [ ] Reapresentar um refresh token já rotacionado/revogado → 401 E todos os tokens do usuário ficam revogados.
- [ ] Fluxo normal de rotação (token válido → novo par) inalterado.

**Testes:**
- `tests/integration/auth.test.js`: rotacionar uma vez (obtém T2), reapresentar T1 → 401; depois T2 também falha (família revogada).

**Dependências:** Tarefa 2 (usa `REVOKE_ALL_USER_TOKENS`).

---

### Tarefa 4: Validação Joi do corpo de `POST /sync` (REST) e dos handlers WS

**Objetivo:** O `POST /atlas/:atlasId/sync` hoje **não tem `validate`** (verificado:
`sync.routes.js:17`; `sync.controller.js:9` passa `req.body.operations` cru). Criar `pushSchema`
com limite de tamanho do array e validar também `handleOperation`/`handleOperations` no WS.

**Arquivos afetados:**
- `src/modules/sync/sync.schemas.js` (modificar — hoje só `cleanupSchema`)
- `src/modules/sync/sync.routes.js` (modificar — adicionar `validate({ body: schemas.pushSchema })`)
- `src/modules/collab/collab.handlers.js` (modificar — `handleOperation:48`, `handleOperations:92`)

**Padrão de código:** _padroes §3 (validar na borda). O schema deve aceitar AMBOS os formatos de
campo (frontend `entityType/operationType/entityId` e legacy `target/type/targetId`) porque o
service normaliza ambos (`normalizeOperation`, `sync.service.js:448`). NÃO quebrar o contrato.

**Implementação:**
1. Definir `operationSchema` e `pushSchema`:
   ```javascript
   // sync.schemas.js
   import Joi from 'joi';

   const MAX_OPS_PER_PUSH = 500; // alinhar com fase-1 (batch+ack)

   const operationSchema = Joi.object({
     id: Joi.string().required(),
     // aceita os dois vocabulários; pelo menos um de cada par
     entityType: Joi.string(),
     target: Joi.string(),
     operationType: Joi.string().valid('create', 'update', 'delete'),
     type: Joi.string().valid('create', 'update', 'delete'),
     entityId: Joi.string(),
     targetId: Joi.string(),
     mapId: Joi.string().allow(null),
     data: Joi.object().allow(null),
     changes: Joi.object().allow(null),
     timestamp: Joi.number(),
     clientId: Joi.string(),
   })
     .or('entityType', 'target')
     .or('operationType', 'type')
     .or('entityId', 'targetId')
     .unknown(true); // tolerante a campos extras (properties temporais viajam em data)

   export const pushSchema = Joi.object({
     operations: Joi.array().items(operationSchema).min(1).max(MAX_OPS_PER_PUSH).required(),
   });
   ```
2. Rota: `router.post('/', auth, requireAtlasPermission('write'), validate({ body: schemas.pushSchema }), ctrl.pushOperations);`
3. Nos handlers WS, validar antes de `pushOperations` (o WS não passa por `validate` middleware):
   ```javascript
   import { pushSchema } from '../sync/sync.schemas.js';
   // handleOperations:
   const { error } = pushSchema.validate({ operations: data.ops });
   if (error) {
     ws.send(JSON.stringify({ type: 'error', code: 'VALIDATION_ERROR', message: error.message }));
     return;
   }
   // handleOperation: validar { operations: [data.op] }
   ```

**Critérios de aceitação:**
- [ ] `POST /sync` com `operations` ausente/vazio/maior que `MAX_OPS_PER_PUSH` → 422 `VALIDATION_ERROR`.
- [ ] Operações no formato frontend E no formato legacy continuam aceitas (contrato congelado).
- [ ] WS `operations`/`operation` com payload inválido → mensagem `error VALIDATION_ERROR`, sem derrubar a conexão.

**Testes:**
- `tests/integration/sync.test.js`: push sem `operations` → 422; push com 501 ops → 422; push válido frontend-format → 200 (regressão de `sync-frontend-format.test.js`).
- `tests/ws/collab.test.js`: enviar `operations` malformado → recebe `error`.

**Dependências:** coordenar `MAX_OPS_PER_PUSH` com fase-1.

---

### Tarefa 5: Política de upload — magic bytes, sem SVG inline, download como attachment

**Objetivo:** Remover `image/svg+xml` da allowlist (ou sanitizar), validar **magic bytes** com
`file-type` contra o `mimeType` declarado em `uploadImage` (multipart) E `bulkUploadImages`
(base64), e servir downloads com `Content-Disposition: attachment`.

**Arquivos afetados:**
- `package.json` (adicionar `file-type`)
- `src/modules/images/images.service.js` (modificar — `ALLOWED_MIME_TYPES:12`, `uploadImage:14`, `bulkUploadImages:100`)
- `src/modules/images/images.controller.js` (modificar — `getImage:10-19`, hoje `Content-Disposition: inline`, `images.controller.js:17`)

**Padrão de código:** _padroes §8 (validação de upload). `file-type` lê os magic bytes do buffer/arquivo.

**Implementação:**
1. `npm i file-type`. Remover `'image/svg+xml'` de `ALLOWED_MIME_TYPES` (decisão A0.3):
   ```javascript
   const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
   ```
2. Em `uploadImage`, após checar mimetype declarado e tamanho, ler magic bytes do arquivo no disco
   (multer salva em `file.path`):
   ```javascript
   import { fileTypeFromFile, fileTypeFromBuffer } from 'file-type';
   // ...
   const detected = await fileTypeFromFile(file.path);
   if (!detected || !ALLOWED_MIME_TYPES.includes(detected.mime) || detected.mime !== file.mimetype) {
     await unlink(file.path).catch(() => {}); // remove o arquivo rejeitado
     throw new BadRequestError('File content does not match declared type');
   }
   ```
3. Em `bulkUploadImages`, após decodificar o `buffer`:
   ```javascript
   const detected = await fileTypeFromBuffer(buffer);
   if (!detected || !ALLOWED_MIME_TYPES.includes(detected.mime) || detected.mime !== image.mimeType) {
     results.failed.push({ localId: image.localId, error: 'Content does not match declared type' });
     continue;
   }
   ```
4. No `getImage` do controller, trocar `inline` por `attachment`:
   ```javascript
   res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
   ```

**Critérios de aceitação:**
- [ ] Upload de SVG → 400 (tipo não permitido).
- [ ] Upload de arquivo cujo conteúdo não bate com o `mimeType` declarado (ex.: HTML renomeado para `.png`) → 400 e arquivo removido do disco.
- [ ] Download serve com `Content-Disposition: attachment`.
- [ ] PNG/JPEG/WebP legítimos continuam funcionando.

**Testes:**
- `tests/integration/images.test.js`: upload PNG válido → 201; upload SVG → 400; upload de buffer text/plain rotulado `image/png` → 400; bulk com uma imagem boa + uma falsa → `uploaded` e `failed` corretos.

**Dependências:** nenhuma.

---

### Tarefa 6: Config endurecido — `validateEnvVariables()` + `jwt.verify` com algorithm allowlist

**Objetivo:** Fail-fast no boot com validação agrupada por contexto (`JWT_SECRET >= 32` em prod,
portas válidas, origins válidas) e travar o algoritmo do JWT em `HS256`.

**Arquivos afetados:**
- `src/config.js` (modificar — hoje `JWT_SECRET` só `required`, `config.js:25`)
- `src/middleware/auth.js` (modificar — `jwt.verify` sem `algorithms`, `auth.js:25`)
- `src/modules/collab/collab.gateway.js` (modificar — `jwt.verify` sem `algorithms`, `collab.gateway.js:93`)
- `src/modules/auth/auth.service.js` (opcional — fixar `algorithm: 'HS256'` no `jwt.sign`)

**Padrão de código:** `validateEnvVariables()` agrupado, acumulando erros (preservado verbatim em §5).

**Implementação:**
1. Adicionar ao `config.js` uma função que roda no carregamento (ou em `index.js` no boot):
   ```javascript
   export function validateEnvVariables() {
     const errors = [];
     // Database
     if (!process.env.DATABASE_URL) errors.push('DATABASE_URL é obrigatório');
     // Authentication / Security
     const secret = process.env.JWT_SECRET || '';
     if (!secret) errors.push('JWT_SECRET é obrigatório');
     else if (config.isProd && secret.length < 32) errors.push('JWT_SECRET deve ter >= 32 caracteres em produção');
     // Server
     const port = parseInt(process.env.PORT || '3000', 10);
     if (Number.isNaN(port) || port < 1 || port > 65535) errors.push('PORT deve estar entre 1 e 65535');
     // CORS
     try { if (process.env.CORS_ORIGIN) new URL(process.env.CORS_ORIGIN); }
     catch { errors.push('CORS_ORIGIN deve ser uma URL válida'); }
     if (errors.length > 0) {
       throw new Error('Configuração inválida:\n  - ' + errors.join('\n  - '));
     }
   }
   ```
2. Chamar `validateEnvVariables()` em `src/index.js` ANTES de `createServer` (boot ruidoso).
   Manter `required()` em `config.js` para dev/test, mas a validação agrupada é a porta de produção.
3. Travar algoritmo no `jwt.verify` (auth middleware E gateway):
   ```javascript
   const payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
   ```

**Critérios de aceitação:**
- [ ] Boot em `NODE_ENV=production` com `JWT_SECRET` curto → processo aborta com mensagem clara antes de aceitar conexões.
- [ ] Token assinado com algoritmo diferente de HS256 (ex.: `none`/`RS256`) → 401.
- [ ] Em test/dev, comportamento atual preservado.

**Testes:**
- `tests/integration/auth.test.js`: token forjado com `alg:none` → 401.
- `tests/unit/config.test.js` (novo): `validateEnvVariables()` acumula múltiplos erros.

**Dependências:** nenhuma.

---

### Tarefa 7: helmet com CSP/HSTS explícitos + ordem de middleware + gatear self-registration

**Objetivo:** Substituir `helmet()` default (`app.js:24`) por configuração explícita de CSP/HSTS,
adotar a ordem de middleware alvo e gatear a rota de auto-cadastro.

**Arquivos afetados:**
- `src/app.js` (modificar — `helmet()` em `:24`, rotas em `:38-41`)
- `src/config.js` (adicionar `security.allowSelfRegistration`)
- `src/modules/auth/auth.routes.js` (modificar — condicionar `/register`)

**Padrão de código:** ordem de middleware alvo (preservada verbatim em §5). Manter `/api/v1` desde
o início (já é o prefixo atual).

**Implementação:**
1. Configurar helmet com HSTS e CSP restritiva (API só serve JSON + imagens):
   ```javascript
   app.use(helmet({
     contentSecurityPolicy: {
       directives: {
         defaultSrc: ["'none'"],
         imgSrc: ["'self'", 'data:'],
         connectSrc: ["'self'"],
         frameAncestors: ["'none'"],
       },
     },
     hsts: config.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
     crossOriginResourcePolicy: { policy: 'same-site' },
   }));
   ```
2. Reordenar middleware para a ordem alvo (§5): `helmet → cors → cookieParser → compression →
   rateLimiter(global, opcional) → express.json({limit:'10mb'}) → requestLogger → rotas públicas
   (/auth ANTES do auth global) → rotas autenticadas → health → 404 → errorHandler`. O backend já
   monta auth por-rota (não há "auth global"), então o ajuste principal é inserir `cookieParser`
   (se usado), o limiter global opcional, e um **handler 404** antes do `errorHandler`.
3. Gatear self-registration (decisão A0.1):
   ```javascript
   // auth.routes.js
   if (config.security.allowSelfRegistration) {
     router.post('/register', authLimiter, validate({ body: schemas.registerSchema }), ctrl.register);
   }
   ```
   Com `ALLOW_SELF_REGISTRATION=false` (default em prod), a rota não existe → 404.

**Critérios de aceitação:**
- [ ] Respostas trazem headers `Content-Security-Policy` e (em prod) `Strict-Transport-Security`.
- [ ] Com a flag desligada, `POST /auth/register` → 404; com ligada → comportamento atual.
- [ ] Rota inexistente → 404 no formato de erro padrão (handler 404), não cai no helmet/cors apenas.

**Testes:**
- `tests/integration/auth.test.js`: register com flag off → 404; com flag on → 201.
- `tests/integration/app.test.js` (novo ou existente): GET de rota inexistente → 404 `NOT_FOUND`.

**Dependências:** Tarefa 1 (limiter).

---

### Tarefa 8: Aplicar poolMin/poolMax na conexão pg-promise

**Objetivo:** Os valores `poolMin`/`poolMax` são lidos (`config.js:20-21`) mas **nunca passados** ao
pg-promise (`database/index.js:16` passa só `connectionString` → `max` default 10, `min` ignorado).

**Arquivos afetados:**
- `src/database/index.js` (modificar — `:16`)

**Padrão de código:** pg-promise aceita um objeto de conexão com `max`/`min` (libpq pool).

**Implementação:**
```javascript
// database/index.js
const db = pgp({
  connectionString: config.db.connectionString,
  max: config.db.poolMax,
  min: config.db.poolMin,
});
```

**Critérios de aceitação:**
- [ ] O pool respeita `DATABASE_POOL_MAX`/`DATABASE_POOL_MIN` (verificável via log/`pgp` ou teste de carga leve).
- [ ] Conexão e suite de testes continuam funcionando.

**Testes:**
- Não requer teste de integração dedicado; coberto por toda a suite (qualquer regressão de conexão falha cedo).

**Dependências:** nenhuma.

---

### Tarefa 9: Bugs concretos da §2.4

**Objetivo:** Corrigir os 5 bugs verificados (excluindo idempotência, que vai na Tarefa 11).

**Arquivos afetados:**
- `src/modules/sync/sync.controller.js` (bug #1 — `:15-19`)
- `src/modules/images/images.service.js` (bug #2 — `uploadImage:31-43`)
- `src/modules/users/users.service.js` (bug #3 — `deleteUser:185-222`)
- `src/modules/collab/collab.gateway.js` + `src/modules/collab/collab.service.js` (bug #5 — `createSession`)

> **Material preservado verbatim — lista de bugs §2.4 a corrigir:**
> 1. `sync.controller` broadcast usa `result.applied` (sempre `undefined`) — o service retorna
>    `{ acks, serverVersion }` (`sync.service.js:478`), então cai sempre no fallback `req.body.operations`.
> 2. `images.service.uploadImage` calcula `storagePath` + `mkdir` mortos (`:31-34`) mas o `INSERT`
>    grava `file.path` (`:41`) — coincide por design do multer; o código morto confunde.
> 3. `users.service.deleteUser` não é transacional: transfer (`:207`) + soft-delete (`:215`) em 2
>    queries separadas — se a segunda falhar, atlas já foi transferido.
> 4. `INSERT_OPERATION` sem idempotência (reenvio duplica/reaplica) — **Tarefa 11**.
> 5. Sessão de visitante público quebra `INSERT` em `active_sessions` (FK para `users`), engolido
>    por try/catch (`collab.service.js:39-45`, fire-and-forget) — spam de erro de FK.

**Implementação:**

**Bug #1 (broadcast):** decisão A0.2 — broadcastar `req.body.operations` explicitamente e excluir o sender.
O broadcast REST atual (`broadcastToRoom(atlasId, msg)`) não exclui ninguém porque o sender não tem
um `ws` no contexto HTTP. Manter assim, mas remover a ilusão de `result.applied`:
```javascript
// sync.controller.js
export const pushOperations = asyncHandler(async (req, res) => {
  const result = await syncService.pushOperations(req.atlasId, req.body.operations, req.user.id);
  // result = { acks, serverVersion }. Broadcast do input normalizado p/ peers WS.
  broadcastToRoom(req.atlasId, {
    type: 'operations',
    userId: req.user.id,
    ops: req.body.operations,
  });
  res.json({ data: result });
});
```
> Nota: excluir o próprio remetente HTTP não é possível via `excludeWs` (ele não tem socket). Os
> clientes devem ignorar ops cujo `clientId` é o seu próprio — contrato a confirmar na fase-1/fase-8.

**Bug #2 (código morto):** remover `ext`/`uniqueId`/`storagePath`/`mkdir` de `uploadImage`
(`:29-34`). O `INSERT` grava `file.path` do multer; o cálculo de `storagePath` é morto. Atenção: a
Tarefa 5 já adicionou `await unlink(file.path)` no caminho de rejeição — manter o `import` de `unlink`.

**Bug #3 (deleteUser transacional):** envolver pre-checks + transfer + soft-delete + revogação de
tokens (Tarefa 2) em `tx()`:
```javascript
export async function deleteUser(userId, adminId, transferToUserId = null) {
  if (userId === adminId) throw new ForbiddenError('Cannot deactivate your own account');
  const user = await getUserById(userId); // pre-check fora da tx (leitura)
  return tx(async (t) => {
    const atlasCount = await t.one(Q.COUNT_USER_ATLAS, [userId]);
    const count = parseInt(atlasCount.count, 10);
    if (count > 0) {
      if (!transferToUserId) {
        throw new ConflictError(`User has ${count} atlas(es). Provide transferTo parameter...`);
      }
      const target = await t.oneOrNone(Q.FIND_USER_BY_ID_ADMIN, [transferToUserId]);
      if (!target) throw new NotFoundError('User');
      if (!target.is_active) throw new ForbiddenError('Cannot transfer atlas to an inactive user');
      await t.none(Q.TRANSFER_ATLAS_OWNERSHIP, [userId, transferToUserId]);
    }
    const deleted = await t.oneOrNone(Q.SOFT_DELETE_USER, [userId]);
    if (!deleted) throw new NotFoundError('User');
    await t.none(Q.REVOKE_ALL_USER_TOKENS, [userId]); // Tarefa 2
    return { success: true, atlasTransferred: count > 0 ? count : 0 };
  });
}
```
> Atenção (_padroes §4): dentro de `tx`, use `t.one/t.none/t.oneOrNone` (retorno direto, sem `.rows`).

**Bug #5 (sessão de visitante):** pular `createSession` quando a conexão é pública. Em
`collab.gateway.js:164` (`onConnection`):
```javascript
if (!ws.isPublic) {
  collabService.createSession(user.id, atlasId, clientId);
}
```
Idem em `onClose` (`:259`): só `deleteSession` se `!ws.isPublic`. Isso para o spam de erro de FK
(o `sub` público é `public-<uuid>`, não existe em `users`).

**Critérios de aceitação:**
- [ ] Após `POST /sync`, peers WS recebem `operations` com `ops = req.body.operations` (não `undefined`).
- [ ] `uploadImage` não tem mais `storagePath`/`mkdir` mortos; upload continua gravando em `file.path`.
- [ ] `deleteUser` com transfer: se o soft-delete falhar, o transfer reverte (atômico). Tokens revogados.
- [ ] Conexão WS de visitante público não tenta `INSERT` em `active_sessions` (sem erro logado).

**Testes:**
- `tests/integration/sync.test.js` / `tests/ws/collab-broadcasts.test.js`: push REST → peer recebe `ops` não-vazio.
- `tests/integration/users-admin.test.js`: deleteUser com transfer válido → atlas transferido + usuário inativo; alvo inativo → 403 e nada muda.
- `tests/ws/collab.test.js`: conectar com token público → sem erro de sessão; conexão prossegue.

**Dependências:** Tarefa 2 (revogação em deleteUser).

---

### Tarefa 10: Health-check real com `SELECT 1`

**Objetivo:** O health atual (`app.js:35`) retorna `{status:'ok'}` sem tocar o DB. Fazer
`db.one('SELECT 1')` e retornar 503 em falha.

**Arquivos afetados:**
- `src/app.js` (modificar — `:35`)

**Padrão de código:** _padroes §6 (health montado antes das rotas autenticadas). Decisão A0.5.

**Implementação:**
```javascript
// app.js — substituir o health raso
import { one } from './database/index.js';

app.get('/api/v1/health', async (req, res) => {
  try {
    await one('SELECT 1 AS ok');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable' } });
  }
});
```
Opcional (A0.5): adicionar `GET /api/v1/health/live` (sem DB, sempre 200) e renomear o acima para
`/health/ready`, mantendo `/health` como alias de readiness por compat.

**Critérios de aceitação:**
- [ ] `/api/v1/health` com DB up → 200 `{status:'ok'}`.
- [ ] `/api/v1/health` com DB down → 503.

**Testes:**
- `tests/integration/health.test.js` (novo): 200 com DB up. (O caso 503 é difícil de simular sem mock; cobrir via revisão.)

**Dependências:** nenhuma.

---

### Tarefa 11: Idempotência `UNIQUE` no log de `operations` (coordenar com fase-1)

**Objetivo:** Persistir o `op.id` do cliente e adicionar `UNIQUE (atlas_id, op_id)` para que reenvio
da mesma operação não duplique/reaplique. Hoje a PK de `operations` é `gen_random_uuid()` do
servidor e o `INSERT_OPERATION` (`sync.queries.js:3-7`) **não insere `op.id`**.

**Arquivos afetados:**
- `src/database/migrations/006_operations_idempotency.sql` (criar)
- `src/modules/sync/sync.queries.js` (modificar — `INSERT_OPERATION`)
- `src/modules/sync/sync.service.js` (modificar — `pushOperations:451`, passar `op.id`; tratar conflito)

**Padrão de código:** _padroes §7 (migração aditiva, numerada, `gen_random_uuid()` para PKs). A
semântica completa de retry/ack pertence à fase-1; esta fase cria a coluna e o índice e faz o
`INSERT` ser idempotente via `ON CONFLICT DO NOTHING`.

**Implementação:**
1. Migração `006_operations_idempotency.sql`:
   ```sql
   -- 006_operations_idempotency.sql
   -- Idempotência: o id da operação vem do cliente (op.id). Reenvio não duplica.
   ALTER TABLE operations ADD COLUMN IF NOT EXISTS op_id TEXT;

   -- Backfill defensivo p/ linhas pré-existentes (usa a PK como op_id estável).
   UPDATE operations SET op_id = id::text WHERE op_id IS NULL;

   -- Unicidade por atlas. A mesma op reenviada colide e é ignorada no push.
   CREATE UNIQUE INDEX IF NOT EXISTS operations_atlas_op_id_uniq
     ON operations (atlas_id, op_id);
   ```
2. `INSERT_OPERATION` passa a inserir `op_id` e usar `ON CONFLICT`:
   ```sql
   INSERT INTO operations
     (atlas_id, op_type, entity_type, entity_id, map_id, changes, data, client_timestamp, client_id, user_id, op_id)
   VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)
   ON CONFLICT (atlas_id, op_id) DO NOTHING
   RETURNING *
   ```
3. Em `pushOperations` (`sync.service.js:451`), passar `rawOp.id` como `$11`. Tratar o caso em que
   `ON CONFLICT DO NOTHING` retorna 0 linhas (op já aplicada):
   ```javascript
   const inserted = await t.oneOrNone(Q.INSERT_OPERATION, [/* ...10 params... */, rawOp.id]);
   if (!inserted) {
     // Op já aplicada (idempotente). Ack com a versão já registrada, NÃO reaplicar.
     const prev = await t.one(Q.GET_OPERATION_BY_OP_ID, [atlasId, rawOp.id]); // nova query
     acks.push({ opId: rawOp.id, serverVersion: prev.server_version, duplicate: true });
     continue; // pula applyOperation
   }
   acks.push({ opId: rawOp.id, serverVersion: inserted.server_version });
   await applyOperation(t, atlasId, op);
   ```
4. Adicionar `GET_OPERATION_BY_OP_ID` em `sync.queries.js`.

**Critérios de aceitação:**
- [ ] Reenviar o mesmo array de operações (mesmos `op.id`) duas vezes não cria linhas duplicadas em `operations` nem reaplica o efeito.
- [ ] O segundo push retorna acks com a versão original (`duplicate: true`), sem erro.
- [ ] Migração `006` aplica limpa em DB existente (com backfill) e novo.

**Testes:**
- `tests/integration/sync.test.js`: push de N ops → push idêntico de novo → `COUNT` de operations inalterado; estado da entidade inalterado.

**Dependências:** **fonte canônica do schema de idempotência.** A fase-1 Tarefa 2 **consome** este
schema (coluna `op_id`, índice total, `GET_OPERATION_BY_OP_ID`) **sem criar nova migração nem coluna**
— ela só detalha o contrato de ack/retry idempotente. Não há `client_operation_id` nem índice parcial.

---

### Tarefa 12: Cache no download de imagem (ETag + Cache-Control + Range)

**Objetivo:** Servir downloads de imagem com `ETag` (uuid imutável), `Cache-Control` (`private,
immutable`), `Accept-Ranges` e tratamento de `Range`. Decisão A0.4: migrar para `res.sendFile`.

**Arquivos afetados:**
- `src/modules/images/images.controller.js` (modificar — `getImage:10-19`)
- `src/modules/images/images.service.js` (modificar — `getImageStream:58-72` → retornar caminho/metadados em vez de stream)

**Padrão de código:** ETag O(1) sem ler conteúdo, para artefato imutável (preservado verbatim em §5).
A imagem tem `id` UUID imutável e `storage_path` no disco.

**Implementação:**
1. Mudar `getImageStream` para `getImageFile`, retornando `{ path, mimeType, filename, id }` sem
   abrir stream (e mantendo o `stat` de existência → `NotFoundError('Image file')`).
2. Controller usa `res.sendFile` (Express trata ETag/Range/304/Last-Modified):
   ```javascript
   export const getImage = asyncHandler(async (req, res, next) => {
     const { path, mimeType, filename } = await imagesService.getImageFile(req.atlasId, req.params.imageId);
     res.setHeader('Content-Type', mimeType);
     res.setHeader('Content-Disposition', `attachment; filename="${filename}"`); // Tarefa 5
     res.sendFile(path, {
       acceptRanges: true,
       lastModified: true,
       etag: true,
       maxAge: '1y',
       immutable: true,
       headers: { 'Cache-Control': 'private, max-age=31536000, immutable' },
     }, (err) => { if (err) next(err); });
   });
   ```
   > `res.sendFile` exige caminho absoluto OU `{ root }`. Garantir `path.resolve(storage_path)`.
3. Alternativa (se preferir manter stream): derivar ETag O(1) de `id` + `size_bytes` persistidos,
   `res.setHeader('ETag', ...)`, checar `If-None-Match` → 304 ANTES de abrir o stream, e tratar
   `req.headers.range` manualmente. Recomendado: `res.sendFile`.

**Critérios de aceitação:**
- [ ] Download retorna `ETag`, `Cache-Control: ... immutable`, `Accept-Ranges: bytes`.
- [ ] Re-request com `If-None-Match` correspondente → 304.
- [ ] Request com `Range` → 206 com `Content-Range`.
- [ ] Imagem inexistente → 404 (preservado).

**Testes:**
- `tests/integration/images.test.js`: GET imagem → headers de cache presentes; segundo GET com `If-None-Match` → 304; GET com `Range: bytes=0-9` → 206.

**Dependências:** Tarefa 5 (Content-Disposition attachment).

---

### Tarefa 13: DevOps — CI, Docker, lint/format

**Objetivo:** Criar workflow de CI (matrix node 20 + postgres service), Dockerfile multi-stage,
docker-compose, `.dockerignore`, ESLint flat config ESM + Prettier e scripts `lint`/`format`.
Verificado: **nenhum desses artefatos existe** (todos os matches estavam em `node_modules`).

**Arquivos afetados (todos criar):**
- `.github/workflows/ci.yml`
- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- `eslint.config.js` (flat config ESM)
- `.prettierrc.json`
- `package.json` (adicionar scripts `lint`/`format` e devDeps)

**Implementação:**

**`.github/workflows/ci.yml`:**
```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20]
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: ebgeo
          POSTGRES_PASSWORD: ebgeo_secret
          POSTGRES_DB: postgres
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U ebgeo"
          --health-interval 10s --health-timeout 5s --health-retries 5
    env:
      DB_HOST: localhost
      DB_PORT: 5432
      DB_USER: ebgeo
      DB_PASSWORD: ebgeo_secret
      JWT_SECRET: test-secret-com-pelo-menos-32-caracteres!!
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ matrix.node }}', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm test
```
> O runner `scripts/run-tests.js` já cria/migra/dropa o DB `ebgeo_test` (verificado `:121-165`),
> usando `DB_USER/DB_PASSWORD/DB_HOST/DB_PORT`. O service container só precisa estar de pé.

**`Dockerfile` (multi-stage, node:20-slim):**
```dockerfile
# build deps
FROM node:20-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# runtime
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p ./data/images && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
```

**`docker-compose.yml` (app + postgres:16 + volume de imagens):**
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: ebgeo
      POSTGRES_PASSWORD: ebgeo_secret
      POSTGRES_DB: ebgeo
    volumes: ['pgdata:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD', 'pg_isready', '-U', 'ebgeo']
      interval: 10s
      timeout: 5s
      retries: 5
  app:
    build: .
    depends_on:
      postgres: { condition: service_healthy }
    environment:
      DATABASE_URL: postgres://ebgeo:ebgeo_secret@postgres:5432/ebgeo
      JWT_SECRET: troque-por-um-segredo-de-32-bytes-ou-mais
      NODE_ENV: production
    ports: ['3000:3000']
    volumes: ['images:/app/data/images']
volumes:
  pgdata:
  images:
```

**`.dockerignore`:** `node_modules`, `data`, `.git`, `*.md` (exceto necessário), `coverage`, `.env*`.

**`eslint.config.js` (flat config ESM):**
```javascript
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
export default [
  js.configs.recommended,
  prettier,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { process: 'readonly', console: 'readonly' } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_|^(req|res|next)$' }] },
  },
  { ignores: ['node_modules', 'data', 'coverage'] },
];
```

**`package.json` scripts e devDeps:**
```json
"scripts": {
  "lint": "eslint src tests",
  "lint:fix": "eslint src tests --fix",
  "format": "prettier --write \"**/*.{js,json,md}\""
},
"devDependencies": {
  "@eslint/js": "^9.0.0",
  "eslint": "^9.0.0",
  "eslint-config-prettier": "^9.1.0",
  "prettier": "^3.2.0",
  "supertest": "^6.3.3"
}
```

**Critérios de aceitação:**
- [ ] `npm run lint` roda limpo (corrigir violações reais; código morto removido nas Tarefas 5/9 ajuda).
- [ ] `npm test` passa no CI com o postgres service.
- [ ] `docker compose up` sobe app + postgres; `/api/v1/health` responde 200.
- [ ] `Dockerfile` builda sem dev-deps no runtime.

**Testes:**
- O próprio CI é o teste (matrix node 20 + suite completa). Lint deve estar verde.

**Dependências:** nenhuma (mas o lint cobre o código das outras tarefas — rodar por último).

---

## 5. Material preservado verbatim

> Este conteúdo veio de documentos-fonte que serão apagados. Mantido aqui literal para implementação.

### 5.1 Lista de bugs concretos §2.4 a corrigir
1. `sync.controller` broadcast `result.applied` (sempre `undefined`) vs service retorna `{acks, serverVersion}`.
2. `images.service.uploadImage` calcula `storagePath` + `mkdir` mas o `INSERT` grava `file.path`.
3. `users.service.deleteUser` não transacional (transfer + soft-delete em 2 queries).
4. `INSERT_OPERATION` sem idempotência (reenvio duplica/reaplica).
5. Sessão de visitante público quebra `INSERT` em `active_sessions` (FK para `users`), engolido por try/catch.

### 5.2 Ordem de middleware alvo (do `ebgeo_web_2_backend`, item 12)
```
helmet
  -> cors
  -> cookieParser
  -> compression
  -> rateLimiter (global)
  -> express.json({ limit: '10mb' })
  -> requestLogger
  -> sanitizeInputs            (ver anti-padrão: NÃO apagar aspas/ponto-e-vírgula de strings)
  -> rotas públicas (/auth ANTES do auth global)
  -> authenticateRequest
  -> demais rotas
  -> GET /health (SELECT 1, 503 se DB cair)
  -> 404 handler
  -> errorHandler (último)
```
Adotar `/api/v1` desde o início.

### 5.3 `validateEnvVariables()` agrupado por contexto
Agrupar por (Database, Authentication, Security, RateLimit, Logging), **acumulando erros** (não
falhar no primeiro). `JWT_SECRET >= 32` chars; portas `1-65535`; `ALLOWED_ORIGINS` URLs válidas.
Falha cedo e ruidosa no boot.

### 5.4 Dummy-hash anti-timing no login (do `ebgeo_360 §3` e `ebgeo_web_2_backend` item 27)
Rodar bcrypt/scrypt **mesmo sem usuário**; erro genérico `'Credenciais inválidas'` para usuário
inexistente E senha errada; `logSecurity('Failed login attempt')`.

### 5.5 ETag O(1) sem ler conteúdo (do `ebgeo_360 §2`)
Para artefato **imutável**, ETag derivado de tamanho persistido + `Cache-Control: immutable` +
short-circuit do `304` ANTES de qualquer I/O pesado. Aplicável ao download de imagem (uuid imutável).

### 5.6 Anti-padrões a NÃO copiar
- **NÃO** copiar sanitização "blunt" que apaga `' " ;` de strings — corrompe conteúdo legítimo.
  Confiar em query parametrizada (já 100% no backend) para SQLi e sanitizar só na saída.

---

## 6. Riscos e cuidados

- **Rate limit estrangulando testes/CI:** sempre `skip: () => config.isTest`. O runner usa
  `NODE_ENV=test`. Sem isso, a suite de auth quebra com 429.
- **`file-type` é ESM puro:** importar via `import { fileTypeFromBuffer }`. Compatível com o projeto
  (já é `"type": "module"`).
- **Remoção de SVG pode quebrar dados existentes:** se houver SVGs já armazenados, o download
  continua funcionando (só o upload novo é bloqueado). Confirmar com o frontend antes de remover.
- **Migração `006` com backfill:** o `UPDATE operations SET op_id = id::text` precisa rodar antes do
  índice `UNIQUE`. Já está na ordem correta no SQL. Em DBs grandes, considerar `CREATE INDEX
  CONCURRENTLY` fora de transação — mas o runner roda cada migração em `tx` (não suporta
  CONCURRENTLY). Para o volume atual (rede interna) o índice em transação é aceitável.
- **`ON CONFLICT DO NOTHING` + `RETURNING`:** quando há conflito, `RETURNING` não retorna linha →
  `oneOrNone` devolve `null`. O código de dedup (Tarefa 11) DEPENDE disso. Não trocar por `t.one`.
- **`res.sendFile` exige caminho absoluto:** usar `path.resolve`. Caminhos relativos lançam erro.
- **Ordem de middleware:** inserir o handler 404 ANTES do `errorHandler` (último). Não montar o 404
  antes das rotas, senão engole tudo.
- **`validateEnvVariables` no boot:** chamar em `index.js`, não em `app.js` (o `app.js` é importado
  pela suite de testes via supertest; falhar no import quebraria os testes que setam env depois).
- **Contratos congelados:** a Tarefa 4 (Joi no sync) NÃO pode rejeitar o formato frontend nem o
  legacy. Cobrir ambos no schema (`.or(...)`) e em teste de regressão.

---

## 7. Definition of Done da fase

A fase-0 está concluída quando, além da DoD universal de cada tarefa (`_padroes §10`):

- [ ] **Segurança:** rate limit ativo nas 4 rotas; login timing-safe; tokens revogados em
      troca/reset/delete de senha; reuso de refresh detectado; `jwt.verify` travado em HS256;
      helmet com CSP/HSTS; self-registration gateado; upload sem SVG + magic bytes validados;
      download como `attachment`.
- [ ] **Bugs §2.4:** broadcast corrigido; código morto de upload removido; `deleteUser`
      transacional; sessão de visitante público não quebra FK; idempotência por `op_id`.
- [ ] **Config/infra:** `poolMin/poolMax` aplicados; `validateEnvVariables()` fail-fast no boot;
      health com `SELECT 1` + 503.
- [ ] **DevOps:** `ci.yml` verde (node 20 + postgres service); `Dockerfile`/`docker-compose.yml`/
      `.dockerignore` funcionais; `npm run lint` limpo; scripts `lint`/`format` presentes.
- [ ] **Não-regressão:** toda a suite (`npm test`) passa; caminho anônimo e contratos de frontend
      (snapshot, formato de op, config) preservados; casos negativos cobertos.
- [ ] **Docs:** `CLAUDE.md` atualizado onde o comportamento documentado mudou (allowlist de imagem
      sem SVG; rate limit; health real; self-registration gateado; idempotência de operations).
- [ ] **Migração:** `006_operations_idempotency.sql` aplicada e idempotente a nível de tracking.
