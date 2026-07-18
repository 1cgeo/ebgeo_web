# Deploy do backend único

Um processo Node 20 (HTTP + WebSocket no mesmo servidor) atrás de NGINX, com PostgreSQL/PostGIS em três schemas, stores binários fora do banco (imagens, assets 3D, ~41 GB de 360 em SQLite) e migrações forward-only rodadas como passo separado do CMD.

## Topologia: um processo, um upstream

`src/index.js:13-16` cria o servidor HTTP com `createServer(app)` e anexa o handler de upgrade do WebSocket **no mesmo servidor** (`attachWebSocket(server)`). Consequências práticas:

- Não existe porta nem processo separado para o WS. O NGINX tem **um único upstream** (`backend:3000`).
- Não dá para escalar o WS independentemente do HTTP. O estado de salas/presença é um `Map` em memória por processo, sem backplane, então 2+ réplicas quebram o broadcast cross-instância (ver [[canal-collab-websocket]] e [[presenca-colaborativa]]). Em produção: **uma instância** (scaling vertical), ou sticky sessions + pub/sub antes de horizontalizar.
- Os caminhos quentes de BLOB 3D/360 dividem event loop, heap e CPU com atlas/sync/WS.

O módulo 360 foi absorvido (`/api/v1/sv360`), não há upstream `:8081` (ver [[streetview-360]]).

## Banco: um cluster, três schemas

- `public`: atlas/maps/features (geometria em JSONB), users, organizations, refresh tokens, auditoria, log de operações (ver [[tabela-operations]], [[atlas-modelo-de-dados]]).
- `ng`: gazetteer PostGIS, edificações, catálogo 3D, zonas de acesso ([[gazetteer-nomes-geograficos]], [[catalogo-3d]], [[zonas-acesso-geografico]]).
- `sv360`: metadados do 360. Os binários WebP **não** ficam no Postgres.

PostGIS nunca entra no schema do atlas: a decisão é JSONB no `public` e PostGIS isolado em `ng`/`sv360`.

## Migrações: forward-only, passo separado, advisory lock

Runner: `node src/database/migrate.js` (`npm run db:migrate`). Lê `src/database/migrations/*.sql` em ordem alfabética, rastreia por **nome de arquivo** em `_migrations` e aplica cada arquivo pendente dentro de uma transação junto com o `INSERT` de tracking (`src/database/migrate.js:66-82`).

Pontos que evitam estrago:

- **Nunca renomeie/renumere** migração aplicada: o tracking é por nome, renomear reaplica o DDL.
- Baseline em 5 arquivos (`001_core`, `002_atlas`, `003_sync`, `004_ng`, `005_sv360`); nova correção é sempre um **novo** número.
- **Advisory lock database-wide** (`SELECT pg_advisory_lock(0x4d494752)`, `migrate.js:18,51`) serializa runners concorrentes. Sem ele, dois containers subindo juntos aplicavam o mesmo DDL duas vezes antes de o `UNIQUE(name)` falhar. Rolling deploy é seguro, mas o perdedor **espera**, não falha.
- **PostGIS é untrusted**: `004_ng.sql:12` faz `CREATE EXTENSION IF NOT EXISTS postgis`, que exige superusuário. Como a 004 roda incondicionalmente, PostGIS é pré-requisito de **qualquer** deploy, mesmo um deploy só de atlas. Resolva antes de migrar: imagem `postgis/postgis` (habilita no `template1`), ou DBA pré-criando a extensão em managed DB.
- O `CMD` da imagem (`Dockerfile:34`) **só inicia o servidor**. Em produção fora do compose, rode a migração como init-container/job/hook antes do app. O `docker-compose.yml:38` faz `sh -c "node src/database/migrate.js && node src/index.js"`, então o compose engana quem espera o mesmo comportamento na imagem.
- Pós-carga em massa de topônimos: `SELECT ng.refresh_busca();` (`004_ng.sql:165`) é **obrigatório e manual**. `COPY` bypassa o trigger `BEFORE INSERT`, e sem o refresh a busca degrada em silêncio, sem erro (ver [[ranking-busca-toponimos]]).
- `npm run db:seed` cria usuários de teste. Nunca em produção.

## Imagem

`Dockerfile:6` usa `node:20-bookworm-slim` (debian, não alpine) de propósito: `bcrypt` e `better-sqlite3` publicam prebuilds **glibc/x64**, e o Dockerfile não instala toolchain. Em ARM, air-gapped ou sem prebuild, o `npm ci` tenta compilar e falha por falta de gcc/python/make; nesse caso adicione `build-essential` + `python3` ao estágio `deps`.

Runtime roda como usuário de sistema `ebgeo` **uid/gid 1001** (`Dockerfile:17-27`), e só `/app/data/images` é pré-criado com `chown` (`Dockerfile:25`). Os diretórios de assets 3D e 360 são criados em runtime pelo app, então o volume precisa ser montado em `/app/data` (ou em cada subdiretório) e ser gravável por 1001, senão a escrita falha com `EACCES`.

`HEALTHCHECK` (`Dockerfile:31-32`) bate em `/api/v1/health`, que executa `SELECT 1` (`src/app.js:78-87`). É **readiness real**: se o Postgres cai, o container fica unhealthy mesmo com o processo vivo. Use como readiness probe, e não martele com intervalo curto porque cada probe toca o pool.

> [!CONTRADICAO 2026-07-18] docs/deploy.md §2 diz `engines.node >=20.0.0`; `backend/package.json` declara `"node": ">=20.19.0"`.

## Variáveis de ambiente e boot fail-fast

`validateEnvVariables()` é chamada em `src/index.js:11`, **antes** de qualquer conexão, e **não** em `app.js` (para a suíte de testes poder importar o app via supertest). Ela acumula todos os erros e lança um único `Configuração inválida:` (`config.js:290-292`).

O que ela realmente valida (`src/config.js:216-292`):

- `DATABASE_URL` presente; `JWT_SECRET` presente e **>= 32 chars só em produção**.
- `PORT` entre 1 e 65535.
- `CORS_ORIGIN` **obrigatória em produção** (`config.js:239-243`) e sempre validada como URL.
- **Faixas numéricas** de ~17 knobs (`NUMERIC_ENV_RULES`, `config.js:189-207`, checadas em `config.js:261-274`). Isso existe porque `parseInt` falha em silêncio: `MAX_BULK_UPLOAD_MB=abc` virava `limit: 'NaNmb'` (sem limite de body) e `WS_HEARTBEAT_INTERVAL_MS=abc` virava `setInterval(NaN)`, quase 1ms, uma tempestade de queries.
- **Gramática das expirações** de JWT: `^\d+[smhd]$` (`config.js:280-288`). `1w` é a armadilha clássica, o parser retornaria 0 e todo refresh token nasceria expirado.

Armadilha do `optional()` (`config.js:9-11`): é `process.env[key] || fallback`, então **string vazia cai no fallback do código**. Não existe caminho por env vazia para "desabilitar" uma URL cujo default é não-vazio.

> [!CONTRADICAO 2026-07-18] docs/deploy.md §4 afirma que só `DATABASE_URL` e `JWT_SECRET` são realmente obrigatórias e que o default de `CORS_ORIGIN` é `http://localhost:8080`; o código em `backend/src/config.js:63` usa default `http://localhost:3000` (a origem do frontend/Vite) e `backend/src/config.js:239-243` torna `CORS_ORIGIN` obrigatória quando `NODE_ENV=production`.

`NODE_ENV=production` é o interruptor único de segurança: liga HSTS 180 dias (`app.js:46`), cookies `Secure`/`SameSite=strict`, exige `JWT_SECRET` >= 32, desliga self-registration por default (`config.js:31-35`) e libera o `DATABASE_POOL_MAX` integral. `COOKIE_SECRET` e `USE_HTTPS` não existem no código, configurá-las é no-op. TLS termina no NGINX.

## Config servido em runtime

`GET /api/v1/config` (alias `/api/config`) é público e montado antes das rotas autenticadas (`app.js:89-91`). O frontend é **fail-fast** nele: sem esse endpoint o app não sobe, não há fallback estático. Detalhe em [[config-dinamico]] e [[config-runtime-urls-relativas]].

Defaults de URL são placeholders DEV-only (OSM, Google, BDGEx, demotiles) e não funcionam em rede isolada. Dois defaults foram deliberadamente trocados para valores "vazio ou relativo", que é o comportamento correto de quem não configurou:

- `MAP3D_TERRAIN_URL` default `''` (`config.js:157`): vazio faz o `config.service` publicar `enabled: false` (elipsoide plano) em vez de pedir ao Cesium um provider inalcançável.
- `SV360_SERVICE_URL` default `/api/v1/sv360` (`config.js:171`), relativo, porque o 360 é módulo deste mesmo backend.

> [!CONTRADICAO 2026-07-18] docs/deploy.md §4 e docs/guias/10-config.md §6 listam `MAP3D_TERRAIN_URL` com default `http://localhost/terrain/tilesets/terrain` e `SV360_SERVICE_URL` com default `http://localhost:3000/api/v1/sv360`; `backend/src/config.js:157` usa `''` e `backend/src/config.js:171` usa `/api/v1/sv360`.

> [!CONTRADICAO 2026-07-18] docs/guias/10-config.md §3 e docs/deploy.md descrevem o catálogo (basemaps, camadas, tilesets) vindo de uma **tabela única `resources`**; no código não existe tabela `resources`: cada tipo tem sua própria tabela (`basemaps`, `data_layers`, `analysis_layers`, `tilesets`, `streetview_markers`, criadas em `backend/src/database/migrations/003_sync.sql:101` e whitelisted em `backend/src/modules/catalog/catalog.tables.js:5-11`), lidas via `catalogService.listCatalog(...)` em `backend/src/modules/config/config.service.js:64-134`. Ver [[resources-catalogo]].

## Stores binários e volumes

Tudo que é binário fica **fora** do Postgres, que guarda só metadados e ponteiro:

| Caminho | Conteúdo | Env |
|---|---|---|
| `/app/data/images` | uploads de imagem do atlas ([[imagens-atlas]]) | `IMAGES_DIR` |
| `/app/data/assets3d.sqlite` | BLOBs 3D, servido **primeiro** ([[assets3d-distribuicao]]) | `ASSETS_3D_SQLITE` |
| `/app/data/assets3d` | fallback FS dos binários 3D (stream, sem semáforo) | `ASSETS_3D_DIR` |
| `/app/data/sv360/{orgId}__{slug}.db` | WebP do 360, ~41 GB reais, + thumbnails `.webp` | `SV360_DB_DIR` |
| `/app/data/sv360-tmp` | staging do upload multipart | `SV360_TMP_DIR` |

Armadilhas que custam dados:

- **`SV360_TMP_DIR` e `SV360_DB_DIR` no MESMO volume.** O multer streama o `images.db` multi-GB para o tmp e depois faz `rename`. Em filesystems diferentes o rename vira cópia cross-device e o swap **perde a atomicidade** (ver [[ingestao-projetos-360]]).
- O `docker-compose.yml:35-42` só persiste `ebgeo_pgdata` e `ebgeo_images`. `assets3d*` e `sv360*` são **efêmeros** nesse stack e somem no recreate. Adicione volumes antes de produção.
- O `db_filename` do 360 é **derivado no servidor** de `(orgId, slug)`. Restaurar arquivos com o nome legado `{slug}.db` quebra o serving mesmo com o Postgres íntegro.

**Controle de RSS:** `better-sqlite3` materializa o BLOB inteiro como `Buffer` no heap, sem stream incremental. O `SELECT` do BLOB roda num pool de worker threads (`SQLITE_BLOB_WORKERS`, default `min(4, cpus-1)`, `src/utils/sqlite-blob-pool.js:150`) e o ETag O(1) com 304 acontece **antes** de qualquer leitura de BLOB ([[sintese-cache-http-imutavel]]). Os semáforos `ASSETS_3D_MAX_INFLIGHT` e `SV360_MAX_INFLIGHT` (default 8) são o controle direto de memória: subi-los em container apertado estoura o heap.

## NGINX

Um `location /` para o upstream, com quatro itens não negociáveis:

1. `proxy_set_header Authorization $http_authorization` (o `flexibleAuth` lê o Bearer, ver [[autenticacao-jwt]]).
2. `proxy_http_version 1.1` + `Upgrade` + `Connection "upgrade"`, senão o WS não conecta. O handler de upgrade valida o pathname e responde **404** para qualquer caminho diferente de `/api/v1/collab`, e exige `atlasId` e `token` na query (400 se faltar). Ver [[websocket-collab]].
3. `client_max_body_size` casando com `SV360_MAX_UPLOAD_BYTES` (default 2 GiB). Descasar dá 413 no NGINX antes de o backend ver o corpo. O body **JSON** do app é limitado a 10 MB (`app.js:59`), exceto `/images/bulk`, que usa parser dedicado de `MAX_BULK_UPLOAD_MB` (`app.js:60-66`).
4. Cache de borda diferenciado: tiles MVT do 360 são `max-age=60` (mudam a cada ingestão), imagens/assets/thumbnails são imutáveis com `max-age=31536000`. Não recomprima binários imutáveis nem quebre `Range` no proxy.

`trust proxy` **não** é configurado no código. Atrás do NGINX, `req.ip` é o IP do proxy, o que degrada a parte IP da chave do rate limiter e agrupa todo o tráfego do link público sob um único IP ([[hardening-borda-api]], [[link-publico]]).

## Segurança operacional

Baseline em [[hardening-borda-api]] e [[upload-imagens-seguranca]]; do ponto de vista de deploy o que importa:

- Rate limiting é **in-memory por instância** (`express-rate-limit`). Com réplicas o limite não é global, multiplica pelo número de réplicas. Mais uma razão para uma instância só.
- `jwt.verify` com allowlist `['HS256']` (`config.js:53`), REST e gateway WS.
- Self-registration gateada: `POST /auth/register` responde 404 em produção por default; liberar exige `ALLOW_SELF_REGISTRATION=true` explícito.
- `EBGEO_TRACE` liga o [[syncledger]] e monta `/api/v1/debug/trace`. É test/dev, **deixe ausente em produção**.
- O `JWT_SECRET` do compose é placeholder de dev. Trocar em produção não é opcional (o boot falha se tiver menos de 32 chars).

## Shutdown

`SIGTERM`/`SIGINT` disparam `shutdown()` (`src/index.js:37-63`): fecha **primeiro** os sockets de collab (`closeAllSockets()`), depois `server.close()`, depois `blobPool.closeAll()`, `pgp.end()` e `process.exit(0)`. Há um force-exit de 10s (`SHUTDOWN_TIMEOUT_MS`, `index.js:25,42-45`), com `unref()` para o próprio timer não segurar o processo.

A ordem é o ponto: os sockets de colaboração são long-lived por design, então `server.close()` (que espera toda conexão terminar) nunca chamava o callback enquanto houvesse um aberto, e `blobPool.closeAll()`/`pgp.end()` eram pulados. No Windows isso deixava handles SQLite abertos e quebrava o start seguinte.

> [!CONTRADICAO 2026-07-18] docs/deploy.md §9 afirma "Sem force-exit/timeout: conexões em voo (ex.: WebSocket persistentes) podem segurar o `server.close()` até o SIGKILL" e descreve a ordem `server.close()` → `blobPool.closeAll()` → `pgp.end()`; `backend/src/index.js:42-54` implementa force-exit de 10s e fecha os sockets **antes** do `server.close()`.

## Backup e restore

Duas fontes precisam ficar consistentes entre si: o Postgres (metadados, incluindo `db_filename` e os `*_size_bytes` que ancoram o ETag O(1)) e os arquivos binários. Backup de um só deixa o outro órfão.

1. `pg_dump` cobre os 3 schemas num dump só.
2. rsync de `SV360_DB_DIR` (com os thumbnails no mesmo diretório), `ASSETS_3D_SQLITE`/`ASSETS_3D_DIR` e `IMAGES_DIR`.

No restore: habilitar PostGIS **antes** de aplicar `ng`; garantir que cada `db_filename` anunciado pelo Postgres exista no disco no formato `{orgId}__{slug}.db`; rodar `SELECT ng.refresh_busca();` se recarregou nomes em massa; reconstruir o SQLite 3D com `node scripts/assets3d-import.js <dir>` se necessário.

## Carga de dados

Ambos os importadores são invocação direta de `node`, sem npm script (`backend/scripts/`):

- `node scripts/assets3d-import.js <sourceDir>`: grava a árvore inteira no SQLite numa única transação, upsert por `rel_path`, offline e idempotente. Metadados de descoberta ficam em `ng.catalogo_3d`, não nos arquivos.
- `node scripts/sv360-import.js <index.db> [src] [dest]`: ETL do legado para o schema `sv360`, um `tx()` por projeto, projeto corrompido vai para `skipped[]` sem abortar o resto. **Exit code 2 significa import parcial**, tratar como alerta e não como sucesso. `orgSlug` inexistente e não-legado dá 409, crie a OM antes ([[organizacoes-om]]).

## Fontes

- `docs/deploy.md`: topologia de deploy, tabela completa de env vars, ordem de migração, mapa de volumes, config NGINX, backup/restore, tabela de troubleshooting.
- `docs/guias/00-visao-geral.md`: papel do backend único, isolamento por schema, decisões D1-D5 (360 absorvido, JS puro, admin em projeto separado), modos anônimo/autenticado/público ([[modos-operacao]]).
- `docs/guias/10-config.md`: contrato congelado das 12 chaves de topo do `/api/config`, origem de cada chave, env vars de URL.
- `backend/src/index.js`, `backend/src/app.js`, `backend/src/config.js`, `backend/src/database/migrate.js`, `backend/Dockerfile`, `backend/docker-compose.yml`, `backend/package.json`, `backend/src/database/migrations/*.sql`, `backend/src/modules/catalog/catalog.tables.js`, `backend/src/utils/sqlite-blob-pool.js`: comportamento real de boot, validação, migração, catálogo e shutdown (base das contradições marcadas acima).
