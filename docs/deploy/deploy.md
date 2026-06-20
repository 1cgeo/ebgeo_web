# Deploy — EBGeo Backend (backend único)

> Guia operacional de deploy do **backend único** EBGeo: um processo Node 20 (Express + WebSocket)
> que serve REST em `/api/v1/*`, o WebSocket de colaboração no mesmo servidor HTTP, o gazetteer
> PostGIS, o catálogo/assets 3D e o **módulo `sv360` (StreetView 360, absorvido na Fase 9 — sem
> upstream `:8081` separado)**. Cobre build/imagem, env vars, banco/migrações, stores/volumes,
> reverse proxy, segurança, health/shutdown, carga de dados, escala, backup/restore e troubleshooting.

---

## 1. Visão geral da arquitetura de deploy

- **1 processo Node** (`node src/index.js`): HTTP + WebSocket no MESMO servidor (`createServer(app)` +
  handler de `upgrade` anexado em `src/index.js:13-16`). Não há porta/processo separado para o WS.
- **PostgreSQL 16 + PostGIS** — banco único com 3 schemas:
  - `public` — atlas (geometria em JSONB, sem PostGIS), users, organizations, audit_trail, refresh_tokens,
    operations (log CRDT append-only).
  - `ng` — gazetteer PostGIS (`nomes_geograficos` 4674, `edificacoes` 4326, `catalogo_3d`, zonas de acesso).
  - `sv360` — metadados do 360 (projects/photos/targets/deleted_photos). Os **binários WebP NÃO ficam
    no Postgres** — ficam em SQLite por-projeto.
- **Stores binários fora do Postgres:**
  - `data/images` (uploads de imagem do atlas, FS).
  - `data/assets3d.sqlite` (SQLite, servido primeiro) + `data/assets3d` (FS, fallback) — assets 3D.
  - `data/sv360/{orgId}__{slug}.db` (SQLite, BLOBs WebP, ~41 GB no dataset real) + thumbnails
    `{orgId}__{slug}.webp` no mesmo dir + `data/sv360-tmp` (staging de upload).
- **Reverse proxy NGINX** — um único upstream `backend:3000`; termina TLS, faz upgrade de WebSocket e
  limita o body de upload.

```
                         ┌─────────────────────────┐
   cliente  ──HTTPS/WSS──▶│   NGINX (1 upstream)    │  TLS, upgrade WS,
                         │   backend:3000          │  client_max_body_size 2g
                         └───────────┬─────────────┘
                                     │ HTTP/WS (porta 3000)
                         ┌───────────▼─────────────┐
                         │  Backend Node (1 proc)  │
                         │  REST + WS + sv360 +    │
                         │  gazetteer + assets3d   │
                         └───┬──────────┬──────────┘
            ┌────────────────┘          └───────────────┐
   ┌────────▼─────────┐              ┌──────────────────▼──────────────────┐
   │ PostgreSQL 16    │              │ Stores binários (volumes no FS)      │
   │ + PostGIS        │              │  data/images   (imagens atlas)       │
   │  schema public   │              │  data/assets3d.sqlite (+ /assets3d)  │
   │  schema ng       │              │  data/sv360/{org}__{slug}.db (~41GB) │
   │  schema sv360    │              │  data/sv360-tmp (staging, MESMO vol)  │
   └──────────────────┘              └──────────────────────────────────────┘
```

---

## 2. Pré-requisitos

- **Node 20 LTS** (ES Modules). `package.json` declara `"type": "module"` e `engines.node >=20.0.0`.
  Runtimes <20 falham no boot; não há `.nvmrc`. Não rode com transpilers CJS.
- **PostgreSQL 16** com **PostGIS** habilitado. Extensões usadas pelas migrações:
  - `postgis` — **UNTRUSTED**: `CREATE EXTENSION postgis` exige **superusuário** (migração `004_ng`).
  - `pgcrypto`, `pg_trgm`, `unaccent` — **trusted** (criáveis pelo dono do banco; sem problema).
- **Requisito de superusuário para PostGIS** — resolva UMA das opções **ANTES de migrar**:
  1. **Imagem `postgis/postgis`** (recomendado): habilita `postgis` no `template1`, então o banco novo já
     herda a extensão e o role do app (não-superusuário) consegue migrar. É o que o `docker-compose.yml`
     usa (`postgis/postgis:16-3.4`).
  2. **DBA pré-cria** `postgis` no banco com um superusuário (`CREATE EXTENSION postgis;`) — válido para
     managed DBs (RDS/Cloud SQL): habilite a extensão antes de rodar as migrações.
  3. Dar privilégio de **superusuário** ao role do app (não recomendado em prod).
- Espaço em disco para os volumes binários — em especial **~41 GB** para o store do 360 num dataset real.

---

## 3. Build & imagem

### Dockerfile (multi-stage, non-root)

- Base **`node:20-bookworm-slim`** (debian, **NÃO alpine**) — escolha deliberada (`Dockerfile:3`) para
  evitar problemas de **musl** com o módulo nativo `bcrypt`.
- Estágio `deps`: `npm ci --omit=dev` (só dependências de produção; determinístico via `package-lock.json`
  commitado).
- Estágio `runtime`: copia `node_modules` + `src` + `package*.json`; `ENV NODE_ENV=production`;
  cria usuário/grupo de sistema **`ebgeo` (uid/gid 1001)**, faz `chown -R` do `/app/data`, `EXPOSE 3000`,
  `USER ebgeo` e `CMD ["node", "src/index.js"]`. **O CMD só inicia o servidor — NÃO roda migração.**
- `HEALTHCHECK` (interval 30s) faz `fetch` a `http://127.0.0.1:${PORT||3000}/api/v1/health` via `node -e`
  (fetch global do Node 20). O endpoint faz `SELECT 1` → o container fica **unhealthy se o Postgres cair**.

### Dependências nativas (`better-sqlite3`, `bcrypt`)

- Duas dependências nativas (`better-sqlite3` e `bcrypt`). `better-sqlite3` é usada nos stores SQLite de assets 3D e 360; `bcrypt` no hashing de senha.
- O Dockerfile **não instala build tools** (gcc/python/make) — funciona porque ambas publicam
  **prebuilds glibc/x64 para node:20/debian**.
- **Gotcha:** em **ARM**, ambiente **air-gapped** ou com prebuild indisponível, o `npm ci` tenta compilar e
  **falha no slim** por falta de toolchain. Nesses casos, adicione `build-essential` + `python3` ao estágio
  `deps`, ou garanta o prebuild no cache do npm. O prebuild do bcrypt também é glibc — não troque para
  alpine/musl sem testar.

### `.dockerignore`

Exclui `node_modules`, `.git`, `.github`, `.env*`, `data/images`, `coverage`, `tests`, `docs`, `*.md` e
arquivos de IDE/OS. Segredos e testes não vão para a imagem; o build sempre faz `npm ci` limpo (não copia
`node_modules` do host).

### docker-compose (stack local)

- Serviço `db`: `postgis/postgis:16-3.4` (POSTGRES_USER/PASSWORD/DB = `ebgeo`/`ebgeo_secret`/`ebgeo`),
  porta `5432`, volume `ebgeo_pgdata`, healthcheck `pg_isready`.
- Serviço `app`: `build: .`, `depends_on db (service_healthy)`, e
  `command: sh -c "node src/database/migrate.js && node src/index.js"` — **migra ANTES de iniciar**.
  Env inline (DATABASE_URL, JWT_SECRET placeholder, CORS_ORIGIN, IMAGES_DIR=/app/data/images), porta `3000`.
- Volumes nomeados: `ebgeo_pgdata` → `/var/lib/postgresql/data`; `ebgeo_images` → `/app/data/images`.

```bash
docker compose up --build       # sobe db (postgis) + app (migra e inicia)
```

> **Atenção em produção (fora do compose):** o **CMD da imagem só inicia o servidor**. Rode a migração como
> passo separado (init-container / job / hook de deploy) antes de subir o app. Veja §5.
>
> **Atenção (volumes):** o `docker-compose.yml` só persiste `ebgeo_pgdata` e `ebgeo_images`. Os stores
> `data/assets3d*` e `data/sv360*` **NÃO têm volume nomeado** — nesse stack seriam **efêmeros** e sumiriam
> no recreate do container. Adicione volumes para `ASSETS_3D_*` e `SV360_*` antes de produção (§6).
>
> **Atenção (segurança):** o `JWT_SECRET` do compose é um placeholder `change-me-...` de dev. **Troque em
> prod** (≥32 chars, senão o boot falha).

### Pipeline mínimo de deploy (sem Docker)

```bash
npm ci --omit=dev            # dependências de produção (= estágio deps do Dockerfile)
node src/database/migrate.js  # aplica migrações pendentes (= npm run db:migrate)
node src/index.js             # inicia HTTP+WS (= npm start)
```

> **Sem CI no GitHub** (removido por opção; não há `.github/`). Nada roda lint/test/build em PR. Rode
> `npm run lint` e `npm test` localmente (ou via hook de pré-commit) **antes de publicar a imagem** — não há
> rede de segurança no servidor. **Nunca** rode `npm run db:seed` em produção (cria `admin/admin123` e
> `cap.silva/test123`).

---

## 4. Variáveis de ambiente

Apenas **`DATABASE_URL`** e **`JWT_SECRET`** são realmente obrigatórias (`required()` lança no import de
`config.js`). Todas as demais têm default. O boot é **fail-fast**: `validateEnvVariables()` (chamada em
`src/index.js:11`, **não** em `app.js`) acumula TODOS os erros e aborta com `Configuração inválida:` —
valida `DATABASE_URL` presente, `JWT_SECRET` presente e **≥32 chars SÓ em produção**, `PORT` 1–65535,
`CORS_ORIGIN` URL válida (se setada).

### Núcleo

| Variável | Default | Obrig.? | Nota |
|----------|---------|---------|------|
| `DATABASE_URL` | — | **Sim** | `postgresql://user:pass@host:5432/db`. Boot aborta sem ela; usada pela migração, seed e health. |
| `JWT_SECRET` | — | **Sim** | **≥32 chars em produção** (senão o boot falha). Em dev/test, livre. |
| `NODE_ENV` | `development` | Não | **Defina `production` no deploy real** — governa HSTS, cookies seguros, self-registration e pool (ver abaixo). |
| `PORT` | `3000` | Não | Porta HTTP+WS. O upstream do NGINX (`backend:3000`) deve casar. |
| `LOG_LEVEL` | `info` | Não | Nível do Pino. |
| `CORS_ORIGIN` | `http://localhost:8080` | Não | **Uma única origem** (string); validada como URL no boot. `credentials:true` (cookies). Sem suporte a lista. |
| `DATABASE_POOL_MIN` | `2` | Não | Mínimo de conexões pg. |
| `DATABASE_POOL_MAX` | `10` | Não | Máximo de conexões pg por instância. **Fora de produção é limitado a `min(poolMax, 5)`.** Health bate no pool a cada probe. |

### JWT / auth / rate limit

| Variável | Default | Obrig.? | Nota |
|----------|---------|---------|------|
| `JWT_ACCESS_EXPIRY` | `15m` | Não | Validade do access token. |
| `JWT_REFRESH_EXPIRY` | `7d` | Não | Validade do refresh token. |
| `ALLOW_SELF_REGISTRATION` | (prod: off, dev/test: on) | Não | `'true'`/`'false'` força; vazio → habilitado só se `NODE_ENV!=production`. Em prod `POST /auth/register` → 404. |
| `RATE_LIMIT_AUTH_WINDOW_MS` | `900000` | Não | Janela (15 min) de `/auth/login\|refresh\|register`. |
| `RATE_LIMIT_AUTH_MAX` | `10` | Não | Máx. tentativas/janela (chave `IP:username`). |
| `RATE_LIMIT_PUBLIC_WINDOW_MS` | `60000` | Não | Janela (1 min) de `/atlas/public/:link`. |
| `RATE_LIMIT_PUBLIC_MAX` | `30` | Não | Máx. requisições/janela (por IP). |
| `RATE_LIMIT_FORCE` | — | Não | Só relevante em teste (força o limiter mesmo em `NODE_ENV=test`). |

### WebSocket

| Variável | Default | Obrig.? | Nota |
|----------|---------|---------|------|
| `WS_HEARTBEAT_INTERVAL_MS` | `30000` | Não | Intervalo de heartbeat. |
| `WS_HEARTBEAT_TIMEOUT_MS` | `5000` | Não | Timeout de heartbeat. |
| `WS_AWAY_GRACE_MS` | `120000` | Não | Janela de tolerância (ms) antes de remover da presença um usuário derrubado anormalmente (Fase 8 away/remove); reconexão com o mesmo `clientId` cancela a remoção. |

### Imagens / stores binários

| Variável | Default | Obrig.? | Nota |
|----------|---------|---------|------|
| `IMAGES_DIR` | `./data/images` | Não | Dir de uploads de imagem do atlas. Montar volume; gravável por uid 1001. |
| `MAX_IMAGE_SIZE_MB` | `10` | Não | Limite de upload de imagem. |
| `MAX_BULK_UPLOAD_MB` | `50` | Não | Limite de body dedicado do `POST /atlas/:id/images/bulk` (lote base64 de até 50 imagens); maior que o limite JSON global de 10 MB para o limite por-imagem ser alcançável no lote. |
| `ASSETS_3D_DIR` | `./data/assets3d` | Não | Fallback FS dos binários 3D (stream sem semáforo). |
| `ASSETS_3D_BASE_URL` | `/api/v1/assets3d` | Não | Base URL dos assets 3D no `GET /config`. |
| `ASSETS_3D_SQLITE` | `./data/assets3d.sqlite` | Não | Store SQLite (servido primeiro). |
| `ASSETS_3D_MAX_INFLIGHT` | `8` | Não | Semáforo de buffers de BLOB 3D vivos no heap (controla RSS). |
| `SQLITE_BLOB_WORKERS` | `min(4, cpus-1)` | Não | Pool de worker threads que lê BLOBs do SQLite (3D **e** 360) fora do event loop. Não está em `config.js`. |
| `SV360_DB_DIR` | `./data/sv360` | Não | Dir dos `{orgId}__{slug}.db` (~41 GB) + thumbnails `.webp`. |
| `SV360_TMP_DIR` | `./data/sv360-tmp` | Não | **Staging de upload — DEVE estar no MESMO volume que `SV360_DB_DIR`** (rename atômico). |
| `SV360_MAX_INFLIGHT` | `8` | Não | Semáforo de buffers WebP 360 no heap (espelha assets3d). |
| `SV360_MAX_UPLOAD_BYTES` | `2147483648` (2 GiB) | Não | Teto do multipart do bundle 360. **Divergência:** `.env.example` sugere 8 GiB, mas o default efetivo é **2 GiB**. Deve casar com `client_max_body_size` do NGINX. |

### appConfig (servido por `GET /api/v1/config`)

URLs de tiles/serviços injetadas em runtime (frontend lê via `/api/v1/config`, **sem rebuild**). Os defaults
são **placeholders DEV-only** (OSM, Google Satellite, maplibre.org, `localhost`, `bdgex.eb.mil.br`) e **NÃO
funcionam em rede militar isolada** nem entre hosts. Em produção, aponte TODAS para servidores DGEO internos.

| Variável | Default | Nota |
|----------|---------|------|
| `TILE_SERVER_URL` | `` (vazio) | — |
| `SEARCH_API_URL` | `http://localhost:3001/busca` | Substituir por servidor DGEO interno. |
| `TERRAIN_URL` / `HILLSHADE_URL` | maplibre demotiles | DEV-only. |
| `MAP3D_IMAGERY_URL` | OSM | `{z}/{x}/{y}` são placeholders MapLibre (literais). |
| `MAP3D_TERRAIN_URL` | `http://localhost/...` | Quebra entre hosts se não setado. |
| `SV360_SERVICE_URL` | `http://localhost:3000/api/v1/sv360` | Mount interno do 360 (sem `:8081`). Frontend consome MVT em `${SV360_SERVICE_URL}/tiles/{z}/{x}/{y}.pbf`. |
| `OSM_TILE_URL` | OSM | Substituir por servidor interno. |
| `MAPLIBRE_GLYPHS_URL` | maplibre demotiles | `{fontstack}/{range}` são placeholders MapLibre. |
| `IMAGENS_TILE_URL` | Google Satellite | Trocar por servidor interno em rede militar. |
| `ORTOIMAGEM_TILE_URL` / `BDGEX_WMS_URL` | BDGEx (EB) | **Default não-vazio** no código; `.env.example` deixa vazio (divergência). |

> **Gotcha `optional()`:** `optional(key, fallback)` faz `process.env[key] || fallback`. Uma var setada como
> **string vazia** (`''`) **cai no fallback do código** — ex.: `ORTOIMAGEM_TILE_URL=''` no `.env` ainda
> resolve para a URL BDGEx default. Não há caminho via env vazia para "desabilitar".

### Diferenças prod × dev (governadas por `NODE_ENV`)

| Comportamento | `production` | dev/test |
|---------------|--------------|----------|
| HSTS (helmet) | ligado (180 dias, includeSubDomains) | desligado |
| Cookies | `Secure` + `SameSite=strict` | `SameSite=lax` |
| `JWT_SECRET` ≥32 chars | exigido | livre |
| Self-registration | off (default) | on (default) |
| `DATABASE_POOL_MAX` efetivo | valor integral | `min(poolMax, 5)` |

> **`COOKIE_SECRET` e `USE_HTTPS` NÃO existem no código** — configurá-los é **no-op**.
> HTTPS/secure-cookies ligam **exclusivamente** via `NODE_ENV=production` (TLS terminado no NGINX).

> Variáveis **só de teste/scripts** (não lidas pelo runtime): `TEST_DB_NAME`, `DB_USER`, `DB_PASSWORD`,
> `DB_HOST`, `DB_PORT`, `ADMIN_DATABASE_URL`, `SUPERUSER_DATABASE_URL`. Em produção, só `DATABASE_URL` conta.

---

## 5. Banco & migrações

- **Runner:** `node src/database/migrate.js` (alias `npm run db:migrate`). Lê todos os `*.sql` de
  `src/database/migrations/` em **ordem alfabética**, rastreia via tabela `_migrations`, aplica cada arquivo
  ainda não registrado **dentro de uma transação** (junto com o `INSERT` em `_migrations`, mesmo commit).
- **Forward-only, sem rollback, idempotente** — migrações já aplicadas são puladas. Cada arquivo é atômico
  (falha no meio faz rollback dela; as anteriores ficam commitadas). Exige `DATABASE_URL` (lança se ausente).
  Sai com código 1 em falha.
- **Nunca renumere/renomeie/reordene** migrações já aplicadas (o tracking é por NOME de arquivo). Para
  corrigir um defeito, adicione uma **nova** migração no próximo número livre (020…).
- **PostGIS exige superusuário** (§2): a migração `004` faz `CREATE EXTENSION postgis` (untrusted). Garanta a
  extensão disponível ANTES de migrar (imagem `postgis/postgis`, DBA pré-criando, ou role privilegiado).
- **3 schemas:** `public` (atlas/JSONB, sem PostGIS) · `ng` (gazetteer PostGIS, criado em 004) · `sv360`
  (metadados 360, criado em 005). Como a 004 roda **incondicionalmente**, **PostGIS é pré-requisito de
  QUALQUER deploy completo**, mesmo um deploy só do atlas.
- **Baseline por domínio (5 migrations):** `001_core` (identidade/org/auth/auditoria) · `002_atlas`
  (atlas/maps/features/briefings) · `003_sync` (operations/sessions/resources) · `004_ng` (gazetteer
  PostGIS + catálogo/permissões 3D + acesso geográfico) · `005_sv360` (schema sv360). Os 19 migrations
  incrementais originais foram consolidados nesse baseline (forward-only, aditivo).

### Ordem de migração no deploy

- **Compose:** `command: sh -c "node src/database/migrate.js && node src/index.js"` (migra antes do server),
  com `depends_on db (service_healthy)`.
- **Produção fora do compose:** rode `npm run db:migrate` como **passo separado** (init-container / job /
  hook de deploy) **antes** de subir o app — o CMD do Dockerfile só inicia o servidor. Garanta o Postgres
  pronto (healthcheck) antes de migrar.

### Pós-carga de nomes geográficos — OBRIGATÓRIO

Após **qualquer carga em massa** (COPY/FME) em `ng.nomes_geograficos`, rode:

```sql
SELECT ng.refresh_busca();
```

`COPY` **bypassa o trigger `BEFORE INSERT`** que calcula `tipo_peso` e não recalcula `cluster_id` (DBSCAN).
Sem o refresh, `cluster_id` fica nulo, `tipo_peso` fica no default e a **busca degrada silenciosamente, sem
erro**. É um passo **manual** pós-carga — não há trigger que o dispare em COPY.

> O seed (`npm run db:seed`) é **DEV/teste** — cria `admin/admin123` e `cap.silva/test123` (UPSERT que
> reescreve a senha do admin a cada execução). **Nunca em produção.**

---

## 6. Stores & volumes persistentes

| Caminho (container) | Conteúdo | Volume / env |
|---------------------|----------|--------------|
| `/var/lib/postgresql/data` | Postgres (schemas `public` + `ng` + `sv360`) | `ebgeo_pgdata` (compose) |
| `/app/data/images` | Uploads de imagem do atlas (binário no FS; metadados no Postgres) | `ebgeo_images` / `IMAGES_DIR` |
| `/app/data/assets3d.sqlite` | Store SQLite dos binários 3D (servido **primeiro**) | `ASSETS_3D_SQLITE` (**sem volume no compose**) |
| `/app/data/assets3d` | Binários 3D em FS (**fallback** quando ausentes no SQLite) | `ASSETS_3D_DIR` (**sem volume no compose**) |
| `/app/data/sv360/{orgId}__{slug}.db` | BLOBs WebP do 360 (~41 GB, 22 projetos) | `SV360_DB_DIR` (**sem volume no compose**) |
| `/app/data/sv360/{orgId}__{slug}.webp` | Thumbnails 360 (mesmo dir do `.db`) | `SV360_DB_DIR` |
| `/app/data/sv360-tmp` | Staging do upload multipart antes do swap | `SV360_TMP_DIR` (**MESMO volume que `SV360_DB_DIR`**) |

**Pontos críticos:**

- **`SV360_TMP_DIR` e `SV360_DB_DIR` DEVEM estar no mesmo volume/filesystem.** O multer streama o
  `images.db` (multi-GB) para o tmp e depois faz `rename(.tmp → dest)`; em volumes diferentes o rename vira
  **cópia cross-device** e **perde a atomicidade** do swap.
- O `docker-compose.yml` só persiste `ebgeo_pgdata` e `ebgeo_images`. **Adicione volumes para
  `data/assets3d*` e `data/sv360*`** (incl. os ~41 GB do 360) antes de produção — senão são efêmeros.
- O container roda como **uid/gid 1001 (`ebgeo`)**. Volumes montados em `/app/data/*` precisam ser graváveis
  por uid 1001 (ex.: `fsGroup: 1001` no K8s, ou `chown` do host) — senão escrita de imagens/SQLite/ingestão
  falha por `EACCES`.
- O **nome do `.db` do 360 é derivado server-side** de `(orgId, slug)` → `{orgId}__{slug}.db`; o
  `db_filename` do manifest do cliente é **ignorado** (guard anti-overwrite cross-OM). Ao restaurar/migrar,
  os arquivos no disco DEVEM bater com o `db_filename` gravado no Postgres.
- A imagem só pré-cria `/app/data/images`; os diretórios `assets3d`/`sv360`/`sv360-tmp` são criados
  **em runtime** pelo app (`mkdirSync` recursivo) sob `/app/data` (coberto pelo `chown -R` p/ uid 1001).
  Logo o **volume deve ser montado em `/app/data`** (ou em cada subdir) para persistir — não pré-existem na imagem.

**Worker pool & semáforos:** `better-sqlite3` materializa o BLOB como `Buffer` no heap (não faz stream
incremental). O **SELECT do BLOB** roda num **pool de worker threads** (`SQLITE_BLOB_WORKERS`, default
`min(4, cpus-1)`), tirando o read síncrono do event loop; o **ETag O(1) + 304** acontece **antes** de
qualquer leitura de BLOB. Os semáforos `ASSETS_3D_MAX_INFLIGHT`/`SV360_MAX_INFLIGHT` (default 8) limitam os
buffers vivos no heap — é o controle direto de RSS ao servir 3D/360. Subi-los em servidor com pouca RAM pode
estourar o heap. O caminho FS (assets3d) não usa semáforo (stream).

---

## 7. Reverse proxy (NGINX)

Um único upstream `backend:3000`. Termina TLS (o backend fala HTTP puro), faz upgrade de WebSocket e limita
o body do upload do 360.

```nginx
upstream ebgeo_backend { server backend:3000; }   # casar com PORT se sobrescrito

server {
  listen 443 ssl;
  # ... ssl_certificate / ssl_certificate_key ...

  # Transição (opcional): paths nus antigos -> namespace do backend.
  # Necessário só se ainda houver clientes chamando sem /api/v1/nomes.
  location = /busca       { rewrite ^ /api/v1/nomes/busca      last; }
  location = /feicoes     { rewrite ^ /api/v1/nomes/feicoes    last; }
  location = /catalogo3d  { rewrite ^ /api/v1/nomes/catalogo3d last; }

  # 360 é interno em /api/v1/sv360 — sem rota especial, cai no location / abaixo.
  location / {
    proxy_pass http://ebgeo_backend;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;  # OBRIGATÓRIO: flexibleAuth lê Bearer
    proxy_set_header X-Real-IP $remote_addr;

    # WebSocket /api/v1/collab — sem isto o WS não conecta:
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # Upload de bundle do 360 — casar com SV360_MAX_UPLOAD_BYTES:
    client_max_body_size 2g;
  }
}

# Redirecione HTTP->HTTPS num server :80 separado (o HSTS do app só faz efeito sobre HTTPS).
```

**Notas operacionais:**

- **Repassar `Authorization` é obrigatório** — `flexibleAuth` lê o `Bearer`; sem o header, auth por Bearer
  quebra atrás do proxy.
- **WebSocket** exige `proxy_http_version 1.1` + `Upgrade` + `Connection "upgrade"`. O handler de upgrade do
  backend **valida o pathname**: rejeita com `404 Not Found` qualquer caminho diferente de `/api/v1/collab`
  (antes de qualquer outra checagem) e exige os query params `atlasId` e `token` (400 se faltar). Roteie
  `/api/v1/collab` para o backend no proxy.
- **`client_max_body_size`** deve casar com `SV360_MAX_UPLOAD_BYTES` (default 2 GiB). Se subir um, suba o
  outro — senão o NGINX corta com 413 antes do backend. (O body **JSON** do app é limitado a 10mb,
  separado do upload multipart.)
- **`trust proxy` não é configurado** no código: atrás do NGINX, `req.ip` é o IP do proxy. Isso afeta a parte
  IP da chave do rate limiter e faz o limiter por-IP do link público agrupar todos sob o IP do proxy. Avalie
  habilitar `trust proxy` se precisar de IP real.
- **Cache de borda/CDN:** tiles MVT do 360 (`/tiles/*.pbf`) são `Cache-Control: public, max-age=60` (NÃO
  immutable — mudam a cada ingestão); imagens/assets 3D/thumbnails são imutáveis (`max-age=31536000`,
  ETag/Range/304). Configure cache curto nos `.pbf`, longo nas imagens. O app já aplica `compression()` — não
  recomprima binários imutáveis nem quebre requests `Range` no proxy.

---

## 8. Segurança em produção

- **helmet** com CSP rígida (`defaultSrc 'none'`, `imgSrc 'self' data:`, `connectSrc 'self'`,
  `frameAncestors 'none'`) e **HSTS só em produção** (180 dias, includeSubDomains). TLS é terminado no NGINX
  — garanta redirect HTTPS no proxy.
- **CORS** de **origem única** (`CORS_ORIGIN`) com `credentials:true` (envia cookie `token`). `'*'` não
  funciona com credentials; não há suporte a lista de origens.
- **JWT** ≥32 chars em prod; `jwt.verify` com **allowlist `['HS256']`** (rejeita `alg:none`/forja) no REST e
  no gateway WS.
- **Rate limiting** (`express-rate-limit`, **in-memory**) em `/auth/login|refresh|register` (chave
  `IP:username`) e `/atlas/public/:link` (por IP); 429 com `TOO_MANY_REQUESTS`. **Gotcha de escala:** o store
  é por-instância — com múltiplas réplicas o limite NÃO é global (multiplica pelo nº de réplicas).
- **Login timing-safe** (bcrypt sempre roda, hash dummy quando o usuário não existe; mensagem genérica
  `Invalid credentials`). **Refresh tokens** com rotação + detecção de reuso (revoga a família); revogados na
  troca/reset de senha e na desativação do usuário.
- **Self-registration gateada** — `POST /auth/register` → 404 em prod por padrão. Para liberar, defina
  `ALLOW_SELF_REGISTRATION=true` explicitamente.
- **Upload de imagem:** allowlist `png/jpeg/webp` (**SVG removido**, vetor de XSS) + **validação de magic
  bytes** em multipart e base64; download servido como `attachment` com `ETag`/`Cache-Control: immutable`/
  `Range`. **Upload do 360:** gate de capacidade (`requireUploadCapability`) APÓS auth e ANTES do multer —
  um `viewer` leva 403 antes de qualquer byte ao disco (bounds de disk-fill DoS autenticado).
- **`POST /sync`** valida via Joi (máx. 500 ops) no REST e no WS.

### Identidade — emissor único de JWT (preservado da Fase 7)

Há **um** emissor de token: este backend (`POST /api/v1/auth/login`, `issueAccessToken`). Payload:

```json
{
  "sub": "<user uuid>",
  "username": "<login>", "login": "<login>",
  "nome": "...", "posto": "...",
  "role": "user|admin",                                 // global
  "organization_id": "<org uuid|null>", "org": "<org uuid|null>",
  "org_role": "owner|editor|viewer|admin"
}
```

Os aliases `org`/`login` foram mantidos por compatibilidade com o que o 360 lia; agora o **mesmo processo**
valida o token (não há mais "alinhar dois serviços"). O módulo `sv360` resolve a posse pela org/`org_role`
(admin global escreve qualquer OM; `org_role ∈ {owner,admin,editor}` escreve a própria OM; `viewer` só lê).
Leitura pública usa `flexibleAuth` (auth opcional). Tokens legados sem o claim de org ainda validam
(`org_role→viewer`, `organization_id→null`).

---

## 9. Health, probes, logs e shutdown

- **`GET /api/v1/health`** (sem auth) executa `SELECT 1` → `200 {status:'ok'}` se o DB responde, **`503`
  `SERVICE_UNAVAILABLE`** se cair. É um **readiness real** (toca o banco). Use como **readiness probe**;
  toca o pool a cada chamada (default `DATABASE_POOL_MAX=10`), então não martele com intervalo muito curto.
  Para **liveness** puro (só processo vivo), use intervalo mais espaçado ou aceite que `health=503` quando o
  DB cai.
- **Logs:** Pino estruturado (`LOG_LEVEL`, default `info`); request logger pulado em teste.
- **Graceful shutdown** (`SIGTERM`/`SIGINT`): `server.close()` (para de aceitar novas conexões) → fecha o
  pool de worker threads SQLite (`blobPool.closeAll()`) → `pgp.end()` → `process.exit(0)`.
  - **Sem force-exit/timeout:** conexões em voo (ex.: **WebSocket persistentes**) podem segurar o
    `server.close()` até o `SIGKILL` do orquestrador. Defina `terminationGracePeriodSeconds` adequado.

---

## 10. Carga de dados

Ambos os importers são **invocação direta de `node`** (NÃO há npm script) — documente os comandos no runbook.

### Assets 3D

```bash
node scripts/assets3d-import.js <sourceDir>
```

Percorre recursivamente o diretório e grava cada arquivo (`.json/.b3dm/.glb/.gltf/.terrain/.pnts`) no store
SQLite `ASSETS_3D_SQLITE` numa **única transação** (upsert por `rel_path`, ETag sha1, content-type por
extensão). Offline, idempotente, independente do app rodando. Os **metadados de descoberta/posição** ficam
em `ng.catalogo_3d` (Postgres), não nesses arquivos.

### 360 — ETL offline (`index.db` legado → schema `sv360` + `{slug}.db`)

```bash
node scripts/sv360-import.js <index.db> [<dbDirSource>] [<dbDirDest>]
```

Lê o `index.db` legado (better-sqlite3 readonly), mapeia organizations/projects/photos/targets/deleted_photos
para o schema Postgres `sv360` e **copia cada `{slug}.db`** para o destino (default `SV360_DB_DIR`), com
**size-check** (soma de `full_size_bytes`+`preview_size_bytes` ≤ tamanho do `.db`). **Idempotente, um `tx()`
por projeto** — projeto corrompido vai para `skipped[]` **sem abortar os demais**. Reusa o core
`mergeProject`.

- **Exit codes (tratar em automação):** `0` = tudo ok · **`2` = parcial** (≥1 projeto em `skipped[]`,
  ex.: `.db` ausente ou size-check falhou — **disparar alerta, não tratar como sucesso**) · `1` = falha total.
- **Backfill de org:** `orgSlug` ausente/`default`/`org-legacy` → org default fixa
  `00000000-0000-0000-0000-000000000001` (migração `001_core`). Um `orgSlug` não-legado **inexistente** em
  `public.organizations` → `ConflictError` (409). Crie a OM (Fase 5) **antes** do ETL se for usar slug real.

### 360 — upload online de bundle (admin)

```bash
curl -F manifest=@manifest.json -F imagesDb=@images.db -F thumbnail=@thumb.webp \
     -H 'Authorization: Bearer <JWT>' \
     <backend>/api/v1/sv360/admin/projects/upload
```

O `imagesDb` (multi-GB) é **streamado para `SV360_TMP_DIR`** via multer diskStorage (NUNCA em memória);
depois **swap atômico** (`.tmp`/`.bak`/rename) + **merge transacional** ("último upload manda" por
`(org, slug)`). Requer JWT com capacidade de escrita (`role=admin` ou `org_role ∈ {owner,admin,editor}`) —
senão **403 antes de qualquer byte ao disco**. O commit do Postgres é o ponto atômico; falha do merge faz
`rollbackSwap` (restaura `.bak`). Janela residual de crash entre swap e commit é benigna (auto-cura no
próximo upload). **`SV360_MAX_UPLOAD_BYTES` deve casar com `client_max_body_size` do NGINX.**

### Vector tiles MVT do 360

A fonte de mapa do 360 é `GET /api/v1/sv360/tiles/:z/:x/:y.pbf`, renderizada pelo **PostGIS** (`ST_AsMVT`)
com as camadas `fotos` (pontos) e `fotos_linha` (trajetória por projeto). **PMTiles e GeoJSON-como-fonte
estão DESCONTINUADOS** (a rota `/tiles/fotos.geojson` permanece só por compat). **Não provisionar
tippecanoe/PMTiles.** `Cache-Control: public, max-age=60` (curto, muda a cada ingestão).

---

## 11. Escala & limitações

- **WebSocket NÃO escala horizontalmente como está.** O estado de salas/presença é um `Map` **em memória por
  processo** (`collab.rooms.js`) — **sem Redis/pub-sub/backplane**. `broadcastToRoom`/`closeRoom` só alcançam
  clientes conectados **àquela instância**. Rodar 2+ réplicas **quebra o broadcast cross-instância**
  (cursor/seleção/`operations`/`atlas_updated` não chegam a quem está em outra réplica). O **durável**
  (atlas/ops/sync, metadados sv360) está no **Postgres**; só o fan-out em tempo real é por-instância.
- O **WS está acoplado ao mesmo processo HTTP** — não dá para escalar o WS separado do HTTP. Caminho de menor
  risco em produção: **UMA instância do backend** (scaling vertical) para o WS, **ou** introduzir sticky
  sessions + backplane (ex.: Redis pub/sub) **antes** de horizontalizar.
- **Worker pool / RSS:** os caminhos quentes de imagem do 3D/360 rodam no MESMO processo que atlas/sync/WS.
  Dimensione `SQLITE_BLOB_WORKERS` (throughput de BLOB vs. conexões SQLite abertas/mmap) e os semáforos
  `*_MAX_INFLIGHT` (RSS) conforme CPU/RAM do container. Revise o limite de memória do container — ele agora
  carrega os ~41 GB do caminho de 360.

---

## 12. Backup & restore

**Há DUAS fontes que precisam ser consistentes entre si:** o Postgres (metadados, incl. `db_filename` e
`*_size_bytes` que ancoram o ETag O(1)) e os arquivos binários (BLOBs). Backup só de um deixa o outro órfão.

**Ordem de backup:**

1. **PostgreSQL** — `pg_dump <DATABASE_URL>` cobre os 3 schemas (`public` + `ng` + `sv360`) num único dump.
   Tire o dump em ponto consistente com os arquivos (o `db_filename` derivado de `(orgId,slug)` é gravado no
   Postgres). Um snapshot do volume `/var/lib/postgresql/data` também serve, mas exige a mesma versão major no
   restore.
2. **Stores binários** — rsync/cópia de:
   - `SV360_DB_DIR` — os `{orgId}__{slug}.db` (~41 GB) + os `.webp` de thumbnail (mesmo dir). Modelo
     offline-first, por missão.
   - `ASSETS_3D_SQLITE` (`data/assets3d.sqlite`) e/ou `ASSETS_3D_DIR` (o que estiver em uso).
   - `IMAGES_DIR` (`data/images`).

**Restore:**

1. Restaurar o Postgres — **garantir PostGIS habilitado no destino ANTES** de aplicar o schema `ng`
   (extensão untrusted → superusuário ou imagem `postgis/postgis`).
2. Restaurar os arquivos binários. Cada `db_filename` anunciado pelo Postgres **DEVE existir no disco** no
   formato `{orgId}__{slug}.db` (copiar com o nome legado `{slug}.db` sem renomear **quebra o serving**).
   Fotos novas só aparecem se o `.db` correspondente estiver presente.
3. Se restaurou/recarregou o schema `ng` com carga em massa de nomes, rode `SELECT ng.refresh_busca();`.
   Para reconstruir o store SQLite 3D a partir de uma árvore de arquivos: `node scripts/assets3d-import.js <dir>`.

---

## 13. Troubleshooting

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| Migração 011 falha em `CREATE EXTENSION postgis` (`permission denied to create extension`) | `postgis` é **untrusted**; role do app não é superusuário e a imagem não tem postgis no `template1` | Usar imagem `postgis/postgis`, ou DBA pré-criar `CREATE EXTENSION postgis;` com superusuário, ou role privilegiado — **antes** de migrar (§2/§5). |
| Boot aborta com `Configuração inválida:` | `DATABASE_URL`/`JWT_SECRET` ausentes, `JWT_SECRET` <32 chars em prod, `PORT` fora de 1–65535, `CORS_ORIGIN` URL inválida | Corrigir as env vars listadas no erro agrupado (§4). |
| `npm ci` falha compilando `better-sqlite3` (sem gcc/python) | ARM / air-gapped / prebuild glibc indisponível | Adicionar `build-essential`+`python3` ao estágio `deps`, ou prover o prebuild no cache (§3). |
| WebSocket não conecta (handshake falha / 404 / fica em polling) | NGINX sem `proxy_http_version 1.1` + `Upgrade`/`Connection "upgrade"`, faltam `atlasId`/`token` na query, ou o proxy roteia o upgrade para path != `/api/v1/collab` (o backend responde 404) | Ajustar o `location` do proxy (§7); rotear `/api/v1/collab`; o handshake exige `?atlasId=&token=`. |
| Upload do 360 corta com 413 | `client_max_body_size` do NGINX < `SV360_MAX_UPLOAD_BYTES` | Igualar os dois valores (§7). |
| `POST /atlas/import` dá 413 | body **JSON** do Express limitado a **10 MB** (`app.js`); import offline pode exceder | Fatiar o import em lotes menores no cliente, ou subir o limite do `express.json()`. **Obs.:** `/atlas/:id/images/bulk` usa um parser dedicado de `MAX_BULK_UPLOAD_MB` (default 50 MB), não os 10 MB globais. |
| Bundle 360 sobe mas swap não é atômico / arquivos órfãos `.tmp`/`.bak` | `SV360_TMP_DIR` em volume diferente de `SV360_DB_DIR` (rename cross-device) | Pôr ambos no MESMO volume/filesystem (§6). Restos `.tmp`/`.bak` após crash são lixo seguro de remover. |
| Escrita de imagem/SQLite/ingestão falha por `EACCES` | Volume `/app/data/*` não gravável por uid 1001 | `chown` do host para 1001 ou `fsGroup: 1001` no K8s (§6). |
| Busca de topônimos degradada (resultados ruins, sem erro) | `SELECT ng.refresh_busca()` **esquecido** após COPY/FME (cluster_id nulo, tipo_peso default) | Rodar `SELECT ng.refresh_busca();` após cada carga em massa (§5). |
| ETL 360 sai com código 2 e a automação trata como sucesso | Import **parcial** (≥1 projeto em `skipped[]`: `.db` ausente ou size-check falhou) | Tratar exit `2` como atenção; investigar os projetos em `skipped[]` (§10). |
| Fotos do 360 não aparecem após restore | `.db` no disco com nome legado `{slug}.db` (não `{orgId}__{slug}.db`), divergindo do `db_filename` no Postgres | Renomear os arquivos para o formato derivado `{orgId}__{slug}.db` (§6/§12). |
| Container `unhealthy` mas processo vivo | `/api/v1/health` retorna 503 porque o Postgres está indisponível | Health é readiness (toca o DB) — verificar o Postgres, não o app (§9). |
| `fsync` EPERM/ENOTSUP em ingestão (Windows) | `fsync` é best-effort em handle readonly / FS sem suporte; códigos são engolidos | Benigno; a integridade vem do size-check do manifest. Em crash de energia logo após a ingestão, o `.db` pode não estar flushed — reexecutar o upload/ETL (idempotente). |
| `mv`/`rm` manual de um `{slug}.db` dá `EBUSY`/`EPERM` (Windows) | Worker do pool segura handle readonly cacheado | **Não mexer manualmente** num `.db` enquanto o backend serve — parar o serviço ou deletar via API (que evicta o handle antes). |
| Broadcast WS não chega a alguns clientes | 2+ réplicas do backend (estado de sala em memória por-instância, sem backplane) | Rodar 1 instância de WS, ou introduzir sticky sessions + Redis pub/sub (§11). |
| Rate limit "frouxo" com várias réplicas | Store in-memory por-instância (não global) | Esperado; para limite global, store externo (não implementado) (§8). |

---

## Padrões de engenharia carregados para o backend

- **ETag O(1) + 304 + Range + immutable** (artefato imutável) → download de imagem, assets 3D e thumbnails 360.
- **BLOB-em-SQLite + worker pool + semáforo** → assets 3D e imagens 360.
- **Dummy-hash anti-timing no login** (`auth.service.js`).
- **Contrato congelado do 360** (preservado pelo módulo `sv360`): campos planos em `camera`
  (`mesh_rotation_y/x/z`, `distance_scale`, `marker_scale`, `floor_level`, `calibration_reviewed`);
  `previewThumbnail` relativo; targets com `bearing`/`distance`; ETag `"{uuid}-{quality}-{sizeBytes}"`;
  206/416/304; envelope de erro `{ "error": "..." }` nas rotas `sv360` (≠ do `{error:{code,message}}` global).
