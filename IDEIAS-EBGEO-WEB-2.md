# Ideias a minerar das tentativas antigas: `ebgeo_web_2_backend` e `ebgeo_web_2_admin`

Data: 2026-06-14
Companheiro de `AVALIACAO-REAPROVEITAMENTO.md` (que decidiu: o backend unico e o `ebgeo_backend`).

Os dois repositorios `ebgeo_web_2_*` sao tentativas anteriores, **descartadas como destino**, mas
com muito padrao bom. Este documento extrai tudo que vale carregar para o backend novo. Carregar
a **ideia** (o padrao), nao o codigo literal: o `_2_backend` e TypeScript e o `_2_admin` e React,
enquanto o `ebgeo_backend` e JS; o schema deles e diferente. Cada item diz o que e bom e por que.

- `ebgeo_web_2_backend`: TypeScript + Express 4 + pg-promise 11 + PostGIS, schema `ng`, JWT +
  bcrypt + API keys, pino por categoria, Swagger, Jest. Foco: nomes geograficos, catalogo 3D,
  identify, e **controle de acesso geografico granular** que o microsservico original nao tem.
- `ebgeo_web_2_admin`: React 19 + Vite 6 + MUI v6 + TS. Dashboard de admin completo (usuarios,
  grupos, zonas, permissoes de modelos, logs, auditoria, dashboard de saude). E o melhor ponto de
  partida para a UI de admin que o `ebgeo_backend` nao tem.

---

# Parte 1: `ebgeo_web_2_backend`

## 1.1 Modelo de dados e schema (PostGIS)

Tudo num schema dedicado `ng`. PostGIS, **SRID unico 4674 (SIRGAS 2000)** em toda geometria. UUID
como PK em tudo. Extensoes:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;     -- geometria, GIST, ST_*
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- busca fuzzy (similarity, GIN trgm)
CREATE EXTENSION IF NOT EXISTS unaccent;    -- remove acentos
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid()
CREATE SCHEMA IF NOT EXISTS ng;
```

Ponto de atencao: o original mistura `gen_random_uuid()` (pgcrypto) e `uuid_generate_v4()`
(uuid-ossp) sem motivo. No backend novo, **padronizar em `gen_random_uuid()`** (nativo no PG 13+,
dispensa uuid-ossp).

### Padroes de schema que valem carregar (priorizados)

**1. Modelo de acesso unificado: `public OR admin OR direto(usuario) OR via-grupo`.**
Repetido identico em nomes geograficos, modelos 3D e identify. Tres alavancas:
- flag `access_level VARCHAR(20) CHECK (access_level IN ('public','private'))` na propria linha;
- bypass de admin por `role`;
- duas tabelas de juncao por recurso: uma usuario-recurso, uma grupo-recurso.

Cobre acesso publico, individual e organizacional sem schema novo por feature. **Recomendacao:
encapsular o predicado de acesso numa funcao SQL ou view unica**, em vez de copiar o CTE em cada
query (no original ele esta duplicado em 4 lugares, risco de divergencia).

**2. Acesso geografico por conteinencia espacial (`ST_Contains(zona, ponto)`), nao por linha.**
Permissao e desenhada como um poligono; o PostGIS decide quais feicoes caem dentro. Feicao nova
ja herda a regra da zona, sem cadastro linha a linha. Exige GIST na zona e na feicao. E o padrao
mais forte do repo.

```sql
CREATE TABLE ng.geographic_access_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100), description TEXT,
  geom GEOMETRY(POLYGON, 4674) NOT NULL,
  created_by UUID REFERENCES ng.users(id), created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_zones_geom ON ng.geographic_access_zones USING GIST (geom);
-- zone_permissions (zone_id, user_id) e zone_group_permissions (zone_id, group_id),
-- ambas PK composta, FK ON DELETE CASCADE, indices nos dois sentidos.
```

**3. Coluna gerada `STORED` + wrapper IMMUTABLE para busca sem acento.**
`unaccent` puro nao e IMMUTABLE, entao nao indexa direto. O truque:

```sql
CREATE OR REPLACE FUNCTION ng.unaccent_immutable(text)
RETURNS text AS $func$ SELECT public.unaccent($1) $func$
LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- na tabela de nomes:
nome_unaccent TEXT GENERATED ALWAYS AS (ng.unaccent_immutable(lower(nome))) STORED
-- indice:
CREATE INDEX idx_nomes_nome_unaccent ON ng.nomes_geograficos
  USING GIN (nome_unaccent gin_trgm_ops);
```

A normalizacao fica materializada e indexada; `similarity()` usa indice em vez de recalcular
`unaccent` por linha. Busca fuzzy insensivel a acento e caixa sem mexer no app a cada insert.

**4. Full-text PT-BR com pesos via trigger + tsvector materializado.**

```sql
NEW.search_vector :=
  setweight(to_tsvector('portuguese', COALESCE(NEW.name, '')), 'A') ||
  setweight(to_tsvector('portuguese', COALESCE(array_to_string(NEW.palavras_chave, ' '), '')), 'A') ||
  setweight(to_tsvector('portuguese', COALESCE(NEW.description, '')), 'B') ||
  setweight(to_tsvector('portuguese', COALESCE(NEW.municipio, '')), 'C') ||
  setweight(to_tsvector('portuguese', COALESCE(NEW.estado, '')), 'D');
```

Nome e palavras-chave pesam A, descricao B, municipio C, estado D. GIN em `search_vector`, busca
por `plainto_tsquery('portuguese', $1)`, ranking por `ts_rank`. Tira o custo de tsvector do tempo
de query. Otimo para o catalogo 3D.

**5. Score de relevancia composto (texto + espaco).** Combinar `similarity` textual com distancia
geografica num unico `relevance_score` ponderado (no original 0.7 texto / 0.3 distancia, com a
distancia normalizada e cortada). Entrega "o mais parecido e mais perto primeiro".

**6. PK composta nas juncoes N:N, com `ON DELETE CASCADE` e indice nos dois sentidos.**
`(a_id, b_id)` como PK ja garante unicidade do par e indexa um lado; o indice extra no outro lado
cobre as joins reversas (ex.: partir do grupo). CASCADE evita orfaos.

**7. Indices parciais para a fatia quente.** `WHERE access_level = 'public'` (a maioria das linhas
e publica, o parcial fica pequeno) e `WHERE search_vector IS NOT NULL`. Junto disso,
`ALTER COLUMN access_level SET STATISTICS 1000` numa coluna de baixa cardinalidade muito filtrada,
para o planner acertar a estimativa.

**8. Auditoria desacoplada (`audit_trail`) com `action`/`target_type` em CHECK fechado + `details
JSONB` indexado por GIN.**

```sql
CREATE TABLE ng.audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(50) NOT NULL,            -- CHECK numa lista fechada
  actor_id UUID NOT NULL,                 -- SEM FK: sobrevive a delete do usuario
  target_type VARCHAR(20),                -- CHECK ('USER','GROUP','MODEL','ZONE','SYSTEM')
  target_id UUID,
  target_name VARCHAR(255),               -- snapshot do nome no momento do evento
  details JSONB,                          -- payload livre (ex.: before/after)
  ip VARCHAR(45) NOT NULL,                -- cabe IPv6
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- indices: (actor_id), (target_type,target_id), (action), (created_at DESC),
--          composto (created_at DESC, action), e GIN (details)
```

Colunas fixas para o que sempre existe (quem, o que, quando, ip, user_agent) e JSONB para o resto.
`actor_id`/`target_name` sao snapshots sem FK, entao o log sobrevive a delete da entidade.

**9. Soft-state em vez de delete.** `users.is_active BOOLEAN` (desativa, nao deleta, preserva
integridade e auditoria) + historico de API key:

```sql
CREATE TABLE ng.api_key_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ng.users(id),
  api_key UUID NOT NULL,
  created_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, revoked_by UUID REFERENCES ng.users(id),
  UNIQUE (user_id, api_key)
);
```

A key viva fica na linha quente de `users`; ao rotacionar, a antiga vira linha com `revoked_at`.

**10. Convencoes transversais baratas:** UUID PK gerado no banco; `created_by`/`created_at`/
`updated_at` em toda tabela mutavel, com trigger generica de `updated_at`; SRID 4674 explicito no
tipo (`GEOMETRY(POINT,4674)`); distancias e areas sempre via cast `::geography` (metros/m2 reais,
nao graus); `CHECK` em todo enum textual; schema dedicado (`ng`) em vez de `public`.

### Dados militares no usuario
`ng.users` carrega `nome_completo`, `nome_guerra`, `organizacao_militar`, `role CHECK IN
('admin','user')`, alem de `username/email` unicos, `api_key` UUID, `is_active`, `last_login`,
`created_by` (auto-referencia). Bom modelo para a identidade do EBGeo.

## 1.2 Arquitetura e camadas transversais

**11. Estrutura modular por feature com sufixos fixos.** Cada feature e uma pasta com um arquivo
por responsabilidade: `.routes`, `.module` (handlers, a service/controller fundida), `.queries`
(SQL como constantes parametrizadas), `.types`, `.validation` (arrays de express-validator),
`.middleware` (quando especifico). Navegacao previsivel, sem barrel files. Features:
`auth, users, groups, identify, geographic, catalog3d, admin`. Modelo exemplar: `auth`.

**12. `app.ts` separado de `index.ts`.** O `app.ts` so monta o Express e exporta `app` (testavel
por supertest sem subir servidor). O `index.ts` e o entrypoint (cluster, HTTP/HTTPS por ambiente,
graceful shutdown com `db.$pool.end()` e timeout de 30s). Ordem de middleware do `app.ts` (vale
replicar):

```
helmet -> cors -> cookieParser -> compression -> rateLimiter(global)
-> express.json({limit:'10mb'}) -> requestLogger -> sanitizeInputs
-> /api/auth (rotas publicas, ANTES do auth global)
-> authenticateRequest (auth global) -> demais rotas
-> GET /health (faz SELECT 1, 503 se o banco cair)
-> /api-docs (Swagger) -> 404 handler -> errorHandler (por ultimo)
```

Lacuna a corrigir: **nao havia versionamento de API**. Adotar `/api/v1` desde o inicio.

**13. `asyncHandler` + `ApiError` + `errorHandler` central.** `ApiError extends Error` com
`statusCode`, `isOperational`, `details`, e factories estaticas (`badRequest 400`,
`unauthorized 401`, `forbidden 403`, `notFound 404`, `conflict 409`, `unprocessableEntity 422`,
`internal 500`, `serviceUnavailable 503`). `Object.setPrototypeOf` para `instanceof` confiavel
pos-transpile, `toJSON()` que esconde `stack` em producao. `asyncHandler(h) = (...args) =>
Promise.resolve(h(...args)).catch(next)`. Formato de resposta de erro unico
`{ status, message, details? }`. Zero try/catch por rota. (O `ebgeo_backend` ja tem algo
equivalente; este so confirma o padrao e o conjunto de subclasses.)

**14. `validateEnvVariables()` no boot (fail-fast, agrupado por contexto).** Valida por contexto
(Database, Authentication, Security, RateLimit, Logging) acumulando erros. Regras notaveis:
`JWT_SECRET` e `PASSWORD_PEPPER` >= 32 chars; `SSL_KEY_PATH/CERT` obrigatorios em prod;
`ALLOWED_ORIGINS` URLs validas; porta 1-65535. Falha cedo e ruidosamente. Resolve a fraqueza do
`ebgeo_backend` de so checar presenca do segredo.

**15. `EnvironmentManager` singleton.** Centraliza TODA decisao por ambiente: cookie, cors, db
(max conexoes por ambiente, ssl), helmet, useHttps. Getters `isProduction/isDevelopment/isTest`.

**16. Logging por categoria com pino multistream.** Enum `LogCategory` (`AUTH, API, DB, SECURITY,
PERFORMANCE, SYSTEM, ACCESS, ADMIN`), **um arquivo por categoria** (`logs/<categoria>.log`).
Interface estruturada: `logError, logMetric, logAuth, logSecurity (warn), logAccess,
logPerformance`, com envelope rico (`category, requestId, userId, endpoint, duration, statusCode,
ip, userAgent, method`). `requestLogger` marca slow requests (> 1000ms) e falhas 401/403.
**Distincao importante:** logging (operacional, arquivo) e separado de auditoria (trilha de
negocio, banco, consultavel).

**17. Auditoria transacional: `createAudit(req, params, connection?)`.** O 3o parametro opcional
aceita o `t` (ITask) de uma transacao pg-promise ou o `db` global. Assim **a auditoria participa
da transacao do negocio**: se a operacao reverte, o audit reverte junto. `AuditParams`:
`action, actorId, targetType?, targetId?, targetName?, details?`. Grava tambem `req.ip`,
`req.get('user-agent')` e timestamp.

**18. Swagger separado do codigo.** Pasta `docs/` com schemas reutilizaveis (`docs/schemas/*.ts`)
e os endpoints como anotacoes JSDoc `@openapi` em `docs/routes/*.ts`, fora dos handlers (nao
poluem a regra de negocio). `securitySchemes` para `bearerAuth` (JWT) e `apiKeyAuth` (header
`X-API-Key`). Servido em `/api-docs`.

**19. Testes de integracao contra banco real.** Jest + ts-jest (ESM) + supertest, batendo no
`app` exportado. Helpers: `createTestUser(role, isActive)` (insere com bcrypt+pepper, devolve
`{user, token, password}`), agent supertest, `setup.ts` que no `afterAll` faz `TRUNCATE ... ng.*
CASCADE`. Threshold de cobertura 80%. (O `ebgeo_backend` ja tem suite forte; reaproveitar so o
padrao de helper de usuario e teardown.)

## 1.3 Autenticacao, autorizacao e seguranca

**20. Autorizacao embutida na propria query SQL (a melhor ideia do repo).** O filtro de acesso
nao vive em middleware, vive dentro do SQL via CTEs. A busca recebe `userId` (que pode ser NULL
para anonimo) e decide linha a linha. **Defesa em profundidade: o dado nao vaza nem com bug de
codigo na camada de aplicacao.** Padrao canonico (de `catalog3d.queries.ts`):

```sql
WITH user_role AS (
  SELECT EXISTS (SELECT 1 FROM ng.users WHERE id = $4 AND role = 'admin') AS is_admin
),
user_model_permissions AS (
  SELECT DISTINCT model_id FROM (
    SELECT model_id FROM ng.model_permissions WHERE user_id = $4            -- direta
    UNION
    SELECT mgp.model_id FROM ng.model_group_permissions mgp
      JOIN ng.user_groups ug ON mgp.group_id = ug.group_id WHERE ug.user_id = $4  -- via grupo
  ) perms
)
SELECT c.* , CASE WHEN $1 IS NOT NULL
              THEN ts_rank(search_vector, plainto_tsquery('portuguese',$1)) ELSE 0 END AS rank
FROM ng.catalogo_3d c
CROSS JOIN user_role ur
LEFT JOIN user_model_permissions ump ON ump.model_id = c.id
WHERE ( c.access_level = 'public'
        OR ($4::UUID IS NOT NULL AND (ur.is_admin OR ump.model_id IS NOT NULL)) )
  AND ($1::text IS NULL OR search_vector @@ plainto_tsquery('portuguese',$1))
ORDER BY rank DESC, data_carregamento DESC
LIMIT $2 OFFSET $3;
```

**21. Filtro espacial de acesso por zona** (de `SEARCH_GEOGRAPHIC_NAMES`): o ramo de zona usa
`LEFT JOIN user_zones uz ON ST_Contains(uz.geom, n.geom)` e `WHERE ... OR uz.id IS NOT NULL`.
Para anonimo (`$4 IS NULL`), a CTE de zonas retorna vazia e so sobram os `public`. Nao existe
caminho em que um registro privado escape para o SELECT final.

**22. Filtro de acesso e contagem alinhados.** `COUNT_*` repete EXATAMENTE o mesmo predicado de
acesso da busca, entao a paginacao nao mente sobre quantos registros existem (o count nao conta o
que a busca esconde).

**23. Identify 3D pragmatico (prisma vertical).** `FIND_NEAREST_FEATURE`: a feicao herda o acesso
do modelo dono (`JOIN ng.catalogo_3d ON id = model_id`), filtra horizontal por `ST_DWithin
(::geography, 300)` e ordena por distancia vertical ao intervalo `altitude_base/altitude_topo`
(via `CASE`) e depois horizontal. Trata a feicao como prisma vertical, sem `ST_3DDistance`.

**24. Escrita de permissoes transacional com replace-set + auditoria do diff.** Em `db.tx`: valida
existencia dos alvos (`SELECT id ... WHERE id = ANY($1::uuid[]) AND is_active`), `DELETE` total +
`INSERT ... SELECT` (substitui o conjunto), e `createAudit` com estado anterior. Exige admin antes.

**25. Reconciliacao de membros de grupo numa instrucao (CTE diff/EXCEPT).** `UPDATE_GROUP_MEMBERS`
calcula `members_to_remove` (`NOT IN unnest`) e `members_to_add` (`EXCEPT`) e so insere os novos,
em vez de apagar tudo e recriar.

**26. Auth flexivel JWT-ou-APIkey, num middleware global nao-bloqueante.** `authenticateRequest`
le credencial de tres fontes (api_key em query ou header `x-api-key`; token em cookie ou
`Authorization: Bearer`), popula `req.user` ou deixa `undefined` (a rota decide se exige). JWT de
15 min, payload `{userId, username, role}`. **Sliding session:** se faltam < 5 min para expirar,
gera token novo e reescreve o cookie. Cookie `httpOnly`, `secure`+`sameSite` por ambiente.
`authorize(roles[])` e a factory de middleware de papel.

**27. bcrypt + pepper, mensagens anti-enumeracao.** Senha = `bcrypt.hash(password + PASSWORD_PEPPER,
10)` (pepper em env, nao no banco). Login compara com pepper, e devolve erro generico
("Credenciais invalidas") tanto para usuario inexistente quanto senha errada, com
`logSecurity('Failed login attempt')`.

**28. Rotacao de API key atomica em CTE** (move a chave antiga para `api_key_history` com
`revoked_at/by` e grava a nova com `RETURNING`, na mesma query) + **pre-validacao de formato antes
do banco** (regex de UUID na key, GeoJSON Polygon custom no express-validator) para rejeitar lixo
cedo.

**29. Middlewares de seguranca prontos:** helmet com CSP por ambiente (restritiva em prod, frouxa
em dev), HSTS 1 ano, frameguard deny; CORS por `ALLOWED_ORIGINS` com `credentials:true` e
`allowedHeaders` incluindo `X-API-Key`; rate limiting global (express-rate-limit, janela e max por
env); validacao de coordenadas (`sanitizeGeoCoordinates` coage lat/lon e descarta NaN, so em
`/geographic` e `/identify`).

---

# Parte 2: `ebgeo_web_2_admin` (dashboard React)

O `ebgeo_backend` tem endpoints de admin e **nenhuma UI**. Este repo e o ponto de partida.

## 2.1 Infraestrutura e arquitetura do frontend

**30. Separacao `contexts/` (so createContext + tipos) vs `providers/` (logica/reducer) + hook de
acesso com guard.** Os consumidores nunca importam o context direto; usam `useAuth`/`useGlobal`/
`useTheme`, que fazem `useContext` + throw se fora do provider. Tres contexts independentes:
- `AuthContext`: `user, token, loading, isAuthenticated, login(), logout()`.
- `GlobalContext`: UI global via reducer (`pageTitle, showSidebar, loading{global,[key]},
  breadcrumbs[]`).
- `ThemeContext`: `themeMode, toggleTheme()`.

Arvore em `main.tsx`: `ErrorBoundary > AuthProvider > ThemeProvider > GlobalProvider >
SnackbarProvider > LocalizationProvider(dayjs/pt-br) > [CssBaseline, PageLoader, RouterProvider]`.

**31. Instancia axios central + interceptors + `ApiError`/`NetworkErrorCode` (`services/api.ts`).**
Request anexa `Authorization: Bearer <token>`. Response normaliza erros por status: 401 (fora do
login) limpa token e vai para `/login`; 403 -> `/login?error=forbidden`; 429 ->
`/login?error=ratelimit`; 422/400 monta mensagem de validacao; 404/5xx mensagens proprias. Erros
de rede viram codigos (`TIMEOUT/DNS/SSL/NETWORK`). Ate um listener de `securitypolicyviolation`
(CSPError). E a fundacao de dados e seguranca do painel.

**32. Auth admin-only.** `AuthProvider` no mount faz `GET /api/users/me` e **so restaura sessao se
`role === 'admin'`**, senao remove o token. `RequireAuth`/ProtectedRoute com prop `requireAdmin`
(spinner se loading; redireciona para `/login` guardando `state.from`; manda nao-admin para
`/dashboard`) e **timer de inatividade de 30 min** (mousemove/keypress resetam; logout automatico).

**33. Service por entidade** (objeto literal tipado com `list/getDetails/create/update/delete`
sobre a instancia axios central). Exemplo:

```ts
export const usersService = {
  async list(params: ListParams): Promise<UserListResponse> {
    const { data } = await api.get('/api/users', { params }); return data;
  },
  async getDetails(id: string): Promise<UserDetails> { /* GET /api/users/:id */ },
  async create(d: CreateUserDTO): Promise<UserDetails> { /* POST */ },
  async update(id, d: UpdateUserDTO): Promise<UserDetails> { /* PUT */ },
};
```

**34. Tipos por entidade** (`types/<entidade>.ts`): `SortableFields`, `ListParams`, entidade base,
`<Entidade>Details extends Entidade`, `CreateXDTO`, `UpdateXDTO`, `XListResponse {items,total,
page,limit}`, `FilterState`, `FormData`. Type-safe e documentacao implicita.

**35. Hook de feature `use<Feature>`** (`pages/<Feature>/hooks/`): encapsula fetch + paginacao +
filtros (com `useDebounce` de 300ms e **gate de 3 caracteres** na busca) + ordenacao + CRUD.
Converte UI 0-based para API 1-based, mapeia `'all' -> undefined` nos filtros, retorna estado +
handlers prontos. A pagina so orquestra dialogs e snackbars.

**36. `DataTable<T>` generico** (`components/DataDisplay/DataTable.tsx`): o motor de todas as
listagens. Colunas tipadas (`Column<T>: id, label, align, format(value,row), sortable`),
paginacao server-side controlada (5/10/25), ordenacao via `TableSortLabel` (estado no pai),
selecao opcional por checkbox, **loading nao-destrutivo** (`LinearProgress` sobreposto, dados
antigos visiveis), e `EmptyState` automatico. As tabelas de feature so declaram o array de
`columns` com `format` para chips/icones/acoes. Combina direto com respostas `{total,page,limit}`.

**37. Quarteto de pagina:** `index.tsx` (orquestra) + `Table` + `FilterBar` + `Dialog/
DetailsDialog/DeleteDialog` (reusando `ConfirmDialog`). Faz todas as telas parecerem iguais e
baratas de criar.

**38. Roteamento lazy + Suspense + `DashboardLayout` responsivo.** `createBrowserRouter` com
`lazy(() => import(...))` por pagina e `Suspense fallback={<LoadingScreen/>}`. `/login` publico;
tudo sob `/` protegido, dentro do layout (AppBar fixa + Drawer 240px, `permanent` no desktop e
`temporary` no mobile via `useMediaQuery`). Menu como array de objetos (`title, path, icon,
section`).

**39. ThemeProvider dark/light persistido** (`useLocalStorage('themeMode')`), `createTheme`
memoizado, `MuiButton textTransform:none`, paleta centralizada. Toggle na AppBar.

**40. Kit de feedback/layout:** `PageHeader` (breadcrumbs do estado global + titulo + slot
actions), `PageContainer`, `LoadingScreen` (fallback Suspense), `PageLoader` (Backdrop global
ligado a `state.loading.global`), `EmptyState`, `ErrorBoundary` (class component), `SearchField`
(lupa + clear), `FilterBar` (Paper flex-wrap, `sticky?`), `MetricCard` (valor + icone + severity +
trend), `ConfirmDialog`, `DashboardSkeleton` (espelha a geometria final, evita layout shift).

**41. Tooling:** Vite (alias `@`, proxy `/api -> VITE_API_URL`, `manualChunks` por vendor,
compression, Emotion), TS strict, ESLint flat (`consistent-type-imports`), Prettier com
sort-imports. Carregar charts (recharts), mapa (react-leaflet + geojson) e date-pickers (dayjs
pt-br) **so onde sao usados**, em chunks separados.

## 2.2 Telas de admin (especificacao de UX)

Toda a area exige `role: 'admin'`. Para cada tela, o que copiar primeiro.

**Login.** Slider de fundo (`react-slick`, fade, 7 imagens de satelite) + card glassmorphism
(`backdropFilter: blur`). Validacao client-side (username regex, senha 6+). Bloqueia nao-admin com
"Acesso restrito a administradores". Dicionario `errorMessages` mapeando codigos
(TIMEOUT/DNS/SSL/NETWORK/AUTH/CSP/RATE_LIMIT) para mensagens amigaveis; le `?error=` da URL para
explicar sessao expirada. Animacoes `Fade` escalonadas e feedback haptico. Visualmente forte e
quase pronto para reaproveitar. `POST /api/auth/login -> {user, token}`.

**Dashboard de saude.** 4 cards de status (Sistema com cor por `status`, Ambiente, Uptime,
versao Node), 4 cards de servico (Database/FileSystem/Auth/API com status colorido), cards de uso
(usuarios ativos, grupos, requisicoes 24h). Graficos: **PieChart donut** (Recharts) de conexoes
de banco (ativas/ociosas) e de modelos (publicos/privados), mais dois `CircularProgress` de
CPU/memoria. **Polling em background com cadencias distintas** (health 30s, metricas 60s) sem
piscar a tela. `DashboardSkeleton` espelhado. `GET /api/admin/health` e `/metrics`. Oportunidade:
ja existem dados de 24h (errors24h, warnings24h, loadAvg) sem grafico de serie temporal.

**Usuarios.** `DataTable` com colunas username/nome_guerra/nome_completo/OM/email/role(chip)/
isActive(chip)/lastLogin/groupCount, todas ordenaveis. Busca (debounce + 3 chars) + selects Perfil
e Status. Acoes: ver, editar, **toggle ativo/inativo (nao ha delete real)**. `UserDialog` (form
com secoes Basicas/Pessoais/Perfil-e-Grupos com Autocomplete multiple/Senha com toggle de
visibilidade, required so na criacao). `UserDetailsDialog` mostra grupos, acesso a modelos e a
zonas ("via direto"/"via grupo"). Erro 409 -> "Ja existe usuario com este nome/email".

**Grupos.** Tabela name/member_count/model_perms/zone_perms. **Delete real** (diferente de
usuarios). `GroupDialog` com Autocomplete multiple de usuarios ativos. `UPDATE_GROUP_MEMBERS` por
reconciliacao no backend.

**Zonas geograficas.** Tabela name/area_km2 (formatado `1.234,56 km2`)/user_count/group_count.
Geometria via **textarea de GeoJSON** (com `validateGeojson`: JSON.parse + checa Polygon/
MultiPolygon), nao desenho interativo. **Mapa read-only no DetailsDialog** (`react-leaflet`
MapContainer + TileLayer OSM + camada GeoJSON com **auto-fit de bounds** via
`L.geoJSON(geom).getBounds()`). Permissoes (usuarios + grupos) editadas no proprio dialog.
Evolucao natural: adicionar desenho com leaflet-draw sincronizado ao textarea.

**Catalogo 3D (permissoes).** Gerencia so as permissoes dos modelos (nao cria/deleta). Tabela
model_name/type/access_level(chip Publico/Privado)/user_count/group_count. `ModelPermissionsDialog`
com **RadioGroup publico/privado que desabilita os Autocomplete quando publico** + Autocomplete de
usuarios (label `username (email)`) e grupos. E o padrao mais limpo de gestao de acesso, modelo
para unificar zonas/grupos.

**Logs.** Tabela timestamp/nivel(chip colorido)/categoria/mensagem(truncada)/acoes. Filtros: nivel,
categoria, limite (50/100/500/1000). Sem paginacao (volume pelo `limit`). `LogDetailsDialog` mostra
o `details` em `<pre>` com `JSON.stringify(.,null,2)`. Mapeia nivel Pino numerico para cor
(50=error, 40=warning, 30=info). `GET /api/admin/logs`.

**Auditoria.** `DataTable` data/acao(chip colorido)/ator/alvo/IP, paginacao server-side.
**FilterBar mais rico:** busca + **date range com dois DatePicker** (`@mui/x-date-pickers` + dayjs,
`DD/MM/YYYY`, actionBar clear/today/accept) + select de tipo de acao. `AuditDetailsDialog` mostra
o JSON da mudanca com funcao **recursiva chave-valor indentada**. Labels traduzidos
(`auditActionLabels`, `targetTypeLabels`). Cores por substring (DELETE=error, CREATE=success,
UPDATE/CHANGE=warning). Evolucao: diff before/after real com highlight. `GET /api/admin/audit`.

**Perfil.** Dialog (nao pagina) aberto pelo `ProfileButton`. Form com dados + **Switch "Alterar
senha"** que expande (Collapse) a secao de senha. **Politica de senha forte** (8+, minuscula,
maiuscula, numero, especial), mais rigida que a do login. `PUT /api/users/me` (resposta traz novo
token, re-loga) + `PUT /api/users/:id/password`.

---

# Parte 3: Prioridade de mineracao (o que carregar primeiro)

**Tier 1 (carregar quase sem pensar):**
1. **Autorizacao embutida na query SQL** (CTE `public OR admin OR direto OR via-grupo`, e a versao
   espacial por `ST_Contains`). Defesa em profundidade. Encapsular num predicado/funcao unica.
2. **Schema de controle de acesso** (zonas + permissoes de usuario/grupo; permissoes de modelo;
   `access_level` na linha) e as juncoes N:N com PK composta + CASCADE.
3. **Scaffold da UI de admin** (axios central + interceptors, contexts/providers + hook com guard,
   `DataTable<T>` generico, quarteto de pagina, roteamento lazy + DashboardLayout).
4. **`validateEnvVariables()` fail-fast** + `EnvironmentManager` por ambiente.
5. **Auditoria** (`audit_trail` + `createAudit(req, params, t?)` transacional).

**Tier 2 (forte, adaptar):**
6. Busca: coluna gerada `nome_unaccent` + GIN trgm + wrapper `unaccent_immutable`; full-text PT-BR
   com pesos por trigger; score composto texto+espaco; count alinhado ao filtro de acesso.
7. Auth flexivel JWT-ou-APIkey, sliding session, cookie httpOnly; bcrypt + pepper anti-enumeracao;
   rotacao de API key atomica + historico.
8. Dialog de permissoes (radio publico/privado que desabilita os Autocomplete) como padrao unico
   de gestao de acesso.
9. Logging por categoria (pino multistream) + `requestLogger` marcando slow/401/403.
10. Tela de login (slider + glassmorphism + dicionario de erros) e dashboard de saude (cards
    severity + donuts + polling em background).

**Tier 3 (bom ter):**
11. Swagger separado do codigo (`docs/` + JSDoc por feature).
12. Mapa de zona read-only (react-leaflet com auto-fit), evoluindo para desenho com leaflet-draw.
13. Perfil com politica de senha forte; date range picker na auditoria; indices parciais e
    `SET STATISTICS`.

---

# Anti-padroes (o que NAO copiar)

- **Sanitizacao que apaga `'";` de toda string** (inputSanitizer): blunt, desnecessaria (as queries
  ja sao parametrizadas via pg-promise) e corrompe conteudo legitimo. Confiar em query
  parametrizada para SQLi e sanitizar so na saida.
- **`ORDER BY ... $5:raw`** (interpolacao raw da direcao) em `LIST_GROUPS`: a seguranca depende
  100% da whitelist na validacao. Preferir a direcao dentro do `CASE` (como geographic/catalog3d).
- **Ausencia de versionamento de API:** adotar `/api/v1` desde o inicio.
- **Mistura de geradoras de UUID** (`gen_random_uuid` + `uuid_generate_v4`): padronizar em uma.
- **CTE de permissao duplicado em 4 arquivos:** centralizar num predicado/funcao SQL.
- **Token em localStorage no front:** vulneravel a XSS; avaliar cookie httpOnly (que o `_2_backend`
  ja suporta no lado servidor).
- **Sem React Query/SWR no admin:** cada feature reinventa loading/erro; considerar TanStack Query
  para enxugar os hooks `use<Feature>`.
- **Bugs do admin a nao herdar:** Zonas sempre faz POST mesmo em edicao (`updateZonePermissions`
  nunca chamado); N+1 ao abrir dialogs de edicao (um `getDetails` por membro); `ConfirmDialog` sem
  variante destrutiva; API keys no tipo `UserDetails` mas sem UI; Logs em UTC e Auditoria em fuso
  local (unificar).
