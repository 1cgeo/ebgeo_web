# `ebgeo_360`: analise e plano de integracao

Data: 2026-06-14
Companheiro de `AVALIACAO-REAPROVEITAMENTO.md`, `IDEIAS-EBGEO-WEB-2.md` e
`SERVICO-NOMES-GEOGRAFICOS.md`.

O `ebgeo_360` (org `1cgeo`) e o microsservico que distribui panoramas 360 (street view militar).
Ja e multi-org, endurecido e em producao. **Recomendacao central: mante-lo como microsservico
separado atras de um gateway, unificando apenas o JWT; NAO mover os 41 GB de BLOB para o Postgres.**
Este documento mapeia o que ele faz, o contrato que o `ebgeo_web` consome (nao pode quebrar), as
ideias de engenharia que valem carregar, e o custo/risco de uma eventual absorcao.

## 0. Resumo e volume real

Fastify 5 + better-sqlite3 + Sharp (Sharp so na migracao), Node 22, container limitado a 512 MB.
Volume medido no banco real:
- **22 projetos** (todos enabled, todos em `org-legacy`), **1 OM**, **0 usuarios** (nenhum seed
  rodado: o multi-org esta implementado e migrado, mas em producao ainda roda como operador unico).
- **72.098 fotos**, **461.453 targets** (145.664 originais + 315.789 espaciais gerados).
- **~41 GB** somados nos 22 `{slug}.db`. Maiores: `alegrete.db` 8,6 GB, `santana_livramento.db`
  8,4 GB, `uruguaiana.db` 5,7 GB, `aman.db` 3,4 GB. `index.db` = 208 MB. Cobertura: RS, SC, PR, RJ,
  MG, RR.

Isto confirma o desenho: 41 GB de imagem fora do banco de metadados, que cabe folgado em RAM.

---

## 1. Modelo de dados em dois bancos (deliberado)

**`index.db` (central, SEM blobs)** (`src/db/schema.sql`):
- `organizations` (id, `slug` UNIQUE, name) = tenant (OM).
- `users` (id, `organization_id` FK nullable [NULL = system_admin global], login UNIQUE,
  password_hash, role).
- `projects` (id, organization_id FK, slug, name, center_lat/lon, entry_photo_id, photo_count,
  `db_filename`, `status` DEFAULT 'enabled'). Unicidade: **`UNIQUE(organization_id, slug)`** (slug e
  unico por OM, nao global).
- `photos` (id TEXT PK = UUID v5, project_id FK, original_name, display_name, sequence_number,
  lat/lon/ele, heading, camera_height, mesh_rotation_x/y/z, distance_scale, marker_scale,
  floor_level, `full_size_bytes`, `preview_size_bytes`, calibration_reviewed). `UNIQUE(project_id,
  sequence_number)`. Os `*_size_bytes` sao a chave do ETag O(1).
- `photos_rtree` VIRTUAL TABLE `rtree(...)` + `photos_rowid` (ponte INTEGER autoincrement <-> UUID,
  porque o R-tree exige rowid inteiro). Indice espacial.
- `targets` (grafo: source_id, target_id, distance_m, bearing_deg, is_next, is_original,
  override_bearing/distance/height, hidden; PK source+target).
- `deleted_photos` (soft-delete: photo_id PK, deleted_at).

**`{slug}.db` (por projeto, SO BLOBs)** (`src/db/project-schema.sql`): uma tabela
`images(photo_id TEXT PK, full_webp BLOB, preview_webp BLOB)`.

**Tuning** (`src/db/connection.js`): index.db WAL, synchronous NORMAL, cache 64 MB. `{slug}.db` lido
**readonly**, query_only, cache 32 MB, **mmap 256 MB** (le BLOB via memory-map, reduz syscalls).
`{slug}.db` criado com **page_size 65536** (64 KB, otimiza BLOB grande). Conexoes singleton, abertura
lazy por projeto. (Nota: o `index.db` real esta com page_size 4096 default, coerente: pagina grande
beneficia BLOB, nao metadados estreitos.)

**UUID v5 deterministico** (`src/utils/uuid.js`, SHA-1 sobre namespace + name via `node:crypto`, sem
dep externa): `uuidv5("{orgSlug}/{slug}/{originalName}")`. Torna re-upload **idempotente** e
estabiliza deeplinks/cache. (O `EXPANDING.md` ainda diz "v4", doc desatualizada; o codigo gera v5.)

---

## 2. Servir BLOB com performance (calibrado para 512 MB)

Rota `GET /api/v1/photos/:uuid/image?quality=full|preview` (`src/routes/photos.js`), cuidada linha a
linha. E o padrao mais valioso de engenharia do repo:

- **ETag O(1) SEM ler o BLOB** (`computeImageETag`): `"{uuid}-{quality}-{sizeBytes}"`, com sizeBytes
  vindo de `full_size_bytes`/`preview_size_bytes` (ja no index.db). Imagem imutavel pos-ingestao, logo
  (uuid + quality + tamanho) identifica o conteudo unicamente.
- **Short-circuit do 304 ANTES do BLOB e ANTES do semaforo**: `If-None-Match` casando responde 304 +
  headers sem carregar imagem e sem ocupar vaga. Cache-hit O(1).
- **Cache-Control immutable**: `public, max-age=31536000, immutable`.
- **Semaforo `MAX_INFLIGHT_IMAGE_REQUESTS = 8`** (hardcoded em `photos.js`, nao e env) com fila:
  limita a 8 buffers WebP multi-MB vivos ao mesmo tempo para nao estourar o RSS sob 512 MB. A vaga e
  adquirida so no caminho 200/206 (apos o 304) e liberada uma vez no `close`/`error` (`releaseOnce`).
- **Range 206**: parse de `bytes=start-end` (intervalo unico, inclusive sufixo `-N`); 206 com
  `Content-Range`, 416 com `Content-Range: bytes */len`, 200 inteiro sem Range. `Accept-Ranges: bytes`
  em 200/206/304.
- **Compressao nao recomprime WebP**: `@fastify/compress` restringe a `text/*` e JSON.

Limitacao honesta: o BLOB e carregado como **Buffer inteiro no heap** (`getImageBlob` faz
`SELECT full_webp` e devolve Buffer; o `Readable.from(payload)` e stream do buffer ja materializado),
nao streaming incremental do SQLite. Range economiza transferencia, nao memoria de leitura. O semaforo
e justamente o que segura isso sob o teto de RAM.

---

## 3. Multi-org e auth

- `organizations` (OM) + `users` com dois papeis (`src/auth/authz.js`): `system_admin` (org NULL,
  global) e `om_data_admin` (preso a sua OM).
- **Namespacing** `{org_slug}_{project_slug}` feito no merge (`src/ingest/merge.js`). O studio local
  exporta slug "bare"; o hub namespaceia na ingestao.
- **status enabled/disabled**: catalogo publico filtra `status='enabled'`; desabilitado some do
  consumo mas a OM dona continua editando.
- **Posse**: `canWriteProject` (system_admin passa; senao `user.org === project.organization_id`),
  `canReadProject` (enabled publico; disabled so para quem escreve), `requireWrite` lanca 404/403.
  Leituras usam `tryAuthenticate` (auth opcional).
- **Auth**: `@fastify/jwt` (`config.jwtSecret`, 12h, payload `{sub, org, role, login}`). Senha
  **scrypt** (`src/auth/password.js`, formato `scrypt$N$r$p$salt$hash`, `timingSafeEqual`) com
  **dummy-hash anti-timing** (roda scrypt mesmo sem usuario). Rate-limit no login (10/min). Seed de
  system_admin via env `SEED_ADMIN_LOGIN/PASSWORD`. Anti-lockout: nao remove o ultimo system_admin.

---

## 4. Ingest / export / pmtiles

- **Upload** `POST /api/v1/admin/projects/upload` (multipart, bodyLimit 2 GB): `saveRequestFiles()`
  **streama o .db para disco** (nao materializa em memoria). Campos `manifest` (JSON), `imagesDb`
  (.db), `thumbnail` (opcional). `validateManifest` rejeita NaN/Infinity, lat/lon fora de faixa,
  campos NOT NULL ausentes, targets que referenciam foto fora do manifest.
- **Swap atomico com .bak**: copia novo .db para `dest.tmp` no mesmo volume -> fecha conexoes ->
  renomeia `dest`->`dest.bak`, `dest.tmp`->`dest` -> merge transacional dos metadados -> descarta o
  .bak no sucesso; rollback (restaura .bak) em falha. Thumbnail e cosmetico (sua falha nao desfaz).
- **Merge transacional** (`mergeProject`): se `(orgId, centralSlug)` ja existe, `purgeProjectRows`
  apaga o projeto inteiro (politica "ultimo upload manda") preservando status/created_at. Guard de
  colisao: se algum id de foto do manifest pertencer a OUTRA OM, 409 em vez de estourar PK.
- **Export do studio** (`src/ingest/export.js`): le index.db local, monta `manifest.json` + copia
  `images.db` + `thumbnail.webp`. **Modelo offline-first**: cada OM gera SQLite e sobe bundle.
- **generate-pmtiles** (`scripts/generate-pmtiles.js`): NDJSON (memoria O(1)) + tippecanoe (local ou
  Docker) -> `fotos.pmtiles`. O caminho primario hoje e o GeoJSON ao vivo `GET /api/v1/tiles/
  fotos.geojson` (substituiu o Martin).

---

## 5. Migracoes em runtime + shutdown

Migracoes idempotentes no startup (`getIndexDb`): `ADD COLUMN` condicionado a `pragma table_info`;
rebuild de tabela **fora da transacao** para trocar `UNIQUE(slug)` -> `UNIQUE(organization_id, slug)`
(SQLite nao altera constraint por ALTER), com `foreign_keys=OFF` ao redor e restauracao no `finally`;
backfill de projetos orfaos para `org-legacy`. Backup `_backup/*.pre-multiorg.bak` antes da migracao
estrutural (disciplina operacional). Graceful shutdown (`src/server.js`): idempotente,
`SHUTDOWN_TIMEOUT_MS=10000`, fecha index + todos os project DBs, trata SIGINT/SIGTERM/uncaught.

---

## 6. Contrato de API (resumo) e o que o ebgeo_web consome (NAO QUEBRAR)

Base `/api/v1`, healthcheck `/health` fora do prefixo. Envelope de erro uniforme `{ "error": "..." }`
(500 nunca vaza detalhe). Endpoints principais:

**Leitura publica**: `GET /projects`, `/projects/:slug`, `/thumbnails/:slug.webp`, `/photos/:uuid`
(metadados), `/photos/:uuid/image?quality=full|preview` (Range/ETag/immutable), `/photos/by-name/
:nome`, `/tiles/fotos.geojson`, `/pmtiles/fotos.pmtiles`.
**Escrita/calibracao (auth)**: PUT calibration/height/rotation-x/z/distance-scale/marker-scale/
reviewed; targets override/visibility/criar/deletar; DELETE photo (soft); batch-calibration; nearby;
metadata/position.
**Admin (auth + OM)**: upload, delete projeto, status enabled/disabled, listar projetos da OM; gestao
de OM/usuarios (system_admin).
**Auth**: `POST /auth/login` (rate-limit 10/min, `{token, user}`), `GET /auth/me`, `POST /auth/logout`.

Shape do metadado de foto (consumido pelo viewer Three.js):
```json
{ "camera": { "id","img","display_name","lon","lat","ele","heading","height",
              "mesh_rotation_y","mesh_rotation_x","mesh_rotation_z",
              "distance_scale","marker_scale","floor_level","calibration_reviewed" },
  "projectSlug": "...", "captureDate": "...",
  "targets": [ { "id","img","lon","lat","ele","display_name","icon":"next",
                 "next","is_original","distance","bearing",
                 "override_bearing","override_distance","override_height" } ] }
```

**Pontos sensiveis a quebra (manter estaveis):**
1. Campos **planos** em `camera` (nao aninhar em `position`/`orientation`); nomes exatos
   `mesh_rotation_y/x/z`, `distance_scale`, `marker_scale`, `floor_level`, `calibration_reviewed`.
2. `previewThumbnail` **relativo sem `/api/v1`** (o cliente concatena com `serviceUrl`).
3. Em targets: `bearing`/`distance` (nao `bearing_deg`/`distance_m`, que sao o shape interno do
   banco), `override_*` numero ou null, `next`/`is_original` booleanos, `icon: "next"`.
4. Faixas de validacao de calibracao (mudar uma faixa rejeita valores antes aceitos).
5. ETag de imagem `"{uuid}-{quality}-{sizeBytes}"` e o contrato 206/416/304 com `Accept-Ranges`/
   `Content-Range`.
6. Envelope de erro `{ "error": "..." }` e os codigos (401/403/404/409/416).

O viewer Three.js depende da ordem de rotacao Euler **ZXY** e do modelo de chao plano (`ele` nao e
usado para projecao, so informativo; overrides projetam no plano de chao).

---

## 7. Plano de integracao: separado atras de gateway, unificar so o JWT

**Manter o `ebgeo_360` como servico autonomo** (Fastify + SQLite + Sharp) atras do gateway, e NAO
absorver no monolito Postgres. Razoes concretas:

- **41 GB de WebP imutavel servidos com mmap + Range + immutable do SQLite readonly.** Mover para
  `bytea`/Large Object no Postgres so adiciona overhead (TOAST, WAL inchado, vacuum, replicacao de
  41 GB) sem ganho: BLOB imutavel servido por chave nao precisa de transacao relacional, junção nem
  consulta. SQLite com page 64 KB + mmap e mais rapido e mais barato em RAM que o mesmo no Postgres.
- **Acoplamento de dominio fraco**: o 360 so precisa saber "quem e o usuario e a que OM pertence".
  Isso e exatamente o JWT.
- **Unificar so o JWT**: emitir o token num provedor unico (a camada de identidade do backend unico)
  e o 360 apenas **verificar** com a mesma chave/claims. Ele ja usa `@fastify/jwt` com payload
  `{sub, org, role, login}`; basta alinhar `JWT_SECRET` e mapear `org` = organization_id, `role` em
  {system_admin, om_data_admin}, e mapear as OMs. **Zero mudanca de schema do 360.**
- **Gateway** (NGINX) roteia `/api/v1/photos`, `/projects`, `/tiles`, `/pmtiles`, `/admin`,
  `/calibration` para o container do 360 (porta 8081) e repassa o header Authorization. CORS ja e
  configuravel. O `ebgeo_web` aponta `streetView360.serviceUrl` para a URL atras do gateway.

Resumo: peca movel a menos quem manda mover BLOB. O 360 fica como esta, ganha SSO via JWT
compartilhado, e o catalogo (metadados leves) pode no futuro ser espelhado pelo backend unico se
houver necessidade de busca cruzada. Documentar no docker-compose a dualidade de backup (pg_dump do
nucleo vs copia de arquivo `.db` por missao via rsync).

---

## 8. Ideias de engenharia a carregar (mesmo mantendo separado)

1. **Separar metadados de BLOB em dois bancos** com tuning distinto (metadados em pagina pequena +
   cache em RAM; BLOB em pagina 64 KB + mmap + readonly). 208 MB de metadados governam 41 GB.
2. **ETag O(1) sem ler o conteudo**, derivado de tamanho persistido + immutable + 304 short-circuit
   antes de qualquer I/O pesado. Reaproveitavel em qualquer servidor de artefato imutavel (cartas,
   GeoTIFF, PDF, modelos 3D).
3. **Semaforo de concorrencia por endpoint de memoria** (`MAX_INFLIGHT`) como protecao explicita de
   RSS sob teto fixo, mais legivel que tuning de GC.
4. **UUID v5 deterministico namespaceado por tenant** como base de idempotencia de ingestao e de
   deeplink estavel (so `node:crypto`).
5. **Bundle + swap atomico .tmp/.bak + merge transacional** como protocolo de ingestao offline-first:
   cada produtor gera SQLite pronto e sobe; o hub so reconcilia. Encaixa no fluxo de campo do CGEO.
6. **Dummy-hash anti-timing no login** (detalhe de seguranca barato e padrao) e anti-lockout (nao
   remover o ultimo system_admin).
7. **Migracao idempotente no startup** com rebuild de constraint controlado (FK off + finally) e
   backup antes de migracao estrutural.

---

## 9. Se um dia for absorvido: esforco e riscos

- **Metadados** mapeiam quase 1:1 para Postgres/PostGIS: `organizations/users/projects/photos/targets/
  deleted_photos` viram tabelas; `photos_rtree`/`photos_rowid` somem (PostGIS usa `geometry(Point,
  4326)` + GiST). O grafo de 461 mil targets importa em minutos via COPY. Esforco moderado.
- **BLOBs**: NAO mover para o Postgres em nenhum cenario previsivel. Se absorver os metadados, deixar
  os BLOBs como arquivos/object storage (S3/MinIO) ou nos proprios SQLite, com o Postgres guardando
  so o ponteiro.
- **Riscos da absorcao**: (a) reescrever o caminho quente (ETag O(1) + mmap + semaforo e especifico de
  "Buffer do SQLite"; em `bytea` perde-se o mmap e e facil regredir em latencia/RSS); (b)
  better-sqlite3 e sincrono, `pg` e async, toda a camada `queries.js` muda de assinatura; (c) o swap
  atomico de arquivo nao existe em Postgres (re-upload vira transacao grande DELETE+INSERT com
  bloat); (d) R-tree -> GiST exige reescrever `nearbyPhotos`; (e) juntar o working set no mesmo
  processo provavelmente exige subir o limite de 512 MB; (f) perda do modelo offline-first/studio se
  o bundle for abandonado.

Veredito: absorver os metadados e viavel e de esforco moderado se um dia houver busca cruzada; os
BLOBs no Postgres nao compensam nunca. O caminho de menor risco e maior retorno e o da Secao 7: 360
separado, JWT unificado, BLOB onde esta.
