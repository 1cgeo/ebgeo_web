# Fase 9 — Absorver o `ebgeo_360` no backend (serviço + metadados; BLOBs em SQLite)

> **⚠️ Esta fase REVERTE a decisão D3** de `00-visao-geral.md` (que recomendava manter o 360 separado
> atrás do gateway). Por **decisão explícita do produto**, o **serviço** e os **metadados** do
> `ebgeo_360` passam para dentro do `ebgeo_backend`; **apenas os BLOBs WebP permanecem em SQLite**
> (modelo `{slug}.db` do ebgeo360, lidos via `better-sqlite3`). A Fase 7 (gateway) deixa de rotear o
> 360 para um upstream externo: o 360 vira um módulo do monólito.
>
> **Depende de:** fase-3 (PostGIS — `photos.geom` substitui o R-tree), fase-5 (identidade única:
> `organizations`/`users`/JWT emissor único), fase-0 (padrão ETag O(1)/304/Range, hardening).
> **Esforço:** **Alto** (ETL de ~41 GB + porte de serviço + contrato congelado). **Risco:** **Alto** —
> acopla o caminho quente de imagem (BLOB no heap) ao processo de colaboração. Ler §3.D9.4 e §5 com atenção.

---

## 1. Objetivo & contexto

O `ebgeo_360` é hoje um microsserviço Fastify 5 + better-sqlite3 + Sharp (container 512 MB) que serve
panoramas 360 (street view militar). Volume real: **22 projetos, 72.098 fotos, 461.453 targets,
~41 GB** em 22 `{slug}.db`; `index.db` = 208 MB; multi-org migrado mas operado como operador único
(1 OM `org-legacy`, 0 usuários).

**O que muda nesta fase:**

| Componente | Antes (microsserviço) | Depois (no `ebgeo_backend`) |
|------------|----------------------|------------------------------|
| **Metadados** (`index.db`: organizations, users, projects, photos, targets, deleted_photos) | SQLite central | **PostgreSQL**, schema `sv360` (PostGIS para `photos.geom`). `organizations`/`users` **unificados** com os da fase-5. |
| **Serviço** (rotas read/escrita/calibração/admin, ingestão, tiles) | Fastify (`:8081`) | **Módulo Express** `src/modules/streetview360`, sob `/api/v1/sv360` |
| **Auth** (`@fastify/jwt`, login próprio) | emissor próprio | **emissor único** da fase-5 (JWT com aliases `org`/`login` da fase-7) + `flexibleAuth` (read = auth opcional) |
| **BLOBs WebP** (full/preview por foto) | `{slug}.db` (SQLite, readonly, mmap) | **continua em `{slug}.db`** num diretório do backend, lido via `better-sqlite3` |
| **R-tree** espacial | `photos_rtree` (SQLite) | **GiST** em `sv360.photos.geom` (PostGIS) |

**Por que esta forma e não outra (resumo da análise `EBGEO-360.md`):**
- **BLOBs NÃO vão para o Postgres em cenário nenhum.** 41 GB imutáveis servidos por chave não precisam
  de transação/junção; em `bytea`/Large Object só somam TOAST, WAL inchado, `VACUUM` e replicação de
  41 GB, perdendo para SQLite `page_size 65536` + `mmap`.
- **Metadados mapeiam quase 1:1 para Postgres/PostGIS** (`organizations/users/projects/photos/targets/
  deleted_photos`; o grafo de 461 mil targets importa em minutos via COPY). Absorver os metadados é de
  esforço moderado e habilita busca cruzada + identidade única + um deploy só.

**Contrato congelado (o `ebgeo_web` já consome — NÃO quebrar):** ver §4 e o apêndice "Contrato 360"
em `99-referencia.md`. Campos planos em `camera`, `previewThumbnail` relativo, `bearing`/`distance`
(não `_deg`/`_m`), ETag `"{uuid}-{quality}-{sizeBytes}"`, 206/416/304, envelope de erro `{error:"..."}`,
ordem Euler **ZXY** e modelo de chão plano.

---

## 2. Pré-requisitos / dependências

| Pré-requisito | Origem | Por quê |
|---------------|--------|---------|
| PostGIS + schema isolado (padrão `ng`) | **fase-3** | `sv360.photos.geom GEOMETRY(POINT,4326)` + GiST substitui o R-tree do SQLite; `nearby` usa `ST_DWithin`. |
| `organizations` + `users` + JWT emissor único (`org`/`login`) | **fase-5/7** | Identidade unificada: o 360 deixa de ter usuários/orgs próprios; `projects.organization_id` → `public.organizations(id)`. |
| `flexibleAuth` (auth opcional não-bloqueante) | **fase-5** | O 360 usa `tryAuthenticate` (leitura pública, escrita autenticada) — `flexibleAuth` já é exatamente isso. |
| Padrão ETag O(1)/304/Range/immutable | **fase-0/4** | Reusar a lógica de `assets3d.controller`/`images.controller`, **com a ressalva do semáforo** (§3.D9.4). |
| **`better-sqlite3`** (já instalada) | — | Ler os `{slug}.db` (BLOBs). É **síncrono** — ver risco de event loop em §5. **Já em uso e validada** no store SQLite de assets 3D (`src/modules/nomes/assets3d.store.js`), que é a **implementação de referência** do padrão BLOB-em-SQLite + ETag O(1) + semáforo desta fase. |
| Acesso ao `ebgeo_360` `origin` | externo | Porte fiel das queries/validações/ingestão. A análise deste plano é o mapa; o **código exato** vem do repo `1cgeo/ebgeo_360`. |

---

## 3. Decisões de arquitetura

- **D9.1 — Schema `sv360` isolado** no Postgres (como `ng`). Não misturar com o domínio colaborativo
  (atlas/JSONB) nem com o gazetteer (`ng`). `organizations`/`users` permanecem em `public` (fase-5).
- **D9.2 — Identidade unificada (recomendado).** Reusar `public.organizations` e `public.users`.
  `sv360.projects.organization_id` → `public.organizations(id)`. Mapear papéis: `role=admin` global →
  capacidade `system_admin`; `org_role ∈ {owner,editor,admin}` na OM → capacidade de escrita
  (`om_data_admin`); demais → leitura. Como o 360 tem **0 usuários** hoje, o risco de migração de
  usuários é nulo; só há o backfill de `org-legacy` → UUID de `organizations`.
- **D9.3 — BLOBs em `{slug}.db` (SQLite), fora do Postgres.** Diretório `SV360_DB_DIR`. Conexão
  `better-sqlite3` **readonly**, `query_only`, `mmap 256MB`, cache 32MB; abertura **lazy** por projeto,
  **singleton** por `db_filename`. `page_size 65536` preservado nos arquivos existentes.
- **D9.4 — Servir BLOB: mesmo padrão ETag, MAS manter o semáforo.**
  - **ETag O(1) sem ler o BLOB:** `"{uuid}-{quality}-{sizeBytes}"`, com `sizeBytes` vindo de
    `sv360.photos.full_size_bytes`/`preview_size_bytes` (no Postgres). Imagem imutável pós-ingestão.
  - **304 short-circuit ANTES de tocar o SQLite** (e antes do semáforo): `If-None-Match` casando →
    304 + headers, **sem** `SELECT` do BLOB e sem ocupar vaga.
  - `Cache-Control: public, max-age=31536000, immutable`; `Accept-Ranges: bytes`; Range 206/416.
  - **⚠️ MANTER `MAX_INFLIGHT_IMAGE_REQUESTS = 8`** (semáforo com fila): diferente dos `assets3d`
    (stream do filesystem), aqui o BLOB é **materializado como Buffer no heap** (`better-sqlite3` não faz
    stream incremental de BLOB). O semáforo segura o RSS sob carga. Range economiza **transferência**,
    não memória de leitura.
- **D9.5 — Envelope de erro `{error:"..."}` para as rotas do 360** (contrato congelado, ≠ do
  `{error:{code,message}}` do backend). Implementar um **error-handler de router** no módulo `sv360`
  que traduz `AppError` → `{ error: message }` antes do handler global. Os controllers usam
  `asyncHandler` normalmente; o formato muda só na borda do módulo.
- **D9.6 — UUID v5 determinístico namespaceado por tenant** preservado para idempotência de ingestão e
  deeplink estável: `uuidv5("{orgSlug}/{projectSlug}/{originalName}")` via `node:crypto` (sem dep). É a
  chave de `photos.id` (TEXT) e de `images.photo_id` no `{slug}.db`.
- **D9.7 — Ingestão offline-first preservada.** O studio continua exportando bundle (`manifest.json` +
  `images.db` + `thumbnail.webp`); o backend reconcilia: valida manifest, faz **swap atômico**
  `.tmp/.bak` do `{slug}.db` no FS e **merge transacional** dos metadados no Postgres (política "último
  upload manda" por `(orgId, slug)`, guard de colisão de id de outra OM → 409).
- **D9.8 — Isolamento do caminho quente: WORKER-THREAD POOL (decidido e JÁ IMPLEMENTADO).** Servir o
  BLOB do SQLite **síncrono** bloquearia o event loop do processo que roda atlas/sync/WS. A solução
  adotada é um **pool de worker threads** genérico — `src/utils/sqlite-blob-pool.js` +
  `src/utils/sqlite-blob-worker.js` — que abre conexões readonly por `dbPath` (cacheadas) e roda o
  `SELECT <blob>` fora do loop principal, transferindo o `ArrayBuffer` de volta (zero-copy). **Esta fase
  REUSA esse pool**: a leitura de `full_webp`/`preview_webp` do `{slug}.db` vira
  `blobPool.read(dbFile, 'SELECT full_webp FROM images WHERE photo_id = ?', [uuid])`. Metadado/ETag O(1)
  (de `*_size_bytes` no Postgres) fica na thread principal → **304 sem ida ao worker**. O **semáforo**
  `MAX_INFLIGHT` permanece como teto de buffers vivos no heap. (O store SQLite de assets 3D da Fase 4 já
  usa esse pool — implementação de referência.)

---

## 4. Contrato congelado (referência — preservar verbatim)

### 4.1 Rotas (mantidas; mudam só de prefixo para `/api/v1/sv360`)

**Leitura pública** (auth opcional): `GET /projects`, `/projects/:slug`, `/thumbnails/:slug.webp`,
`/photos/:uuid` (metadados), `/photos/:uuid/image?quality=full|preview` (Range/ETag/immutable),
`/photos/by-name/:nome`, `/tiles/fotos.geojson`, `/pmtiles/fotos.pmtiles` (opcional).
**Escrita/calibração** (auth + posse): `PUT` calibration / height / rotation-x / rotation-z /
distance-scale / marker-scale / reviewed; targets override / visibility / criar / deletar;
`DELETE` photo (soft); batch-calibration; nearby; metadata/position.
**Admin** (auth + OM): upload (bundle), delete projeto, status enabled/disabled, listar projetos da OM.
**Auth:** **REMOVIDO do módulo** — usa o `/api/v1/auth` unificado da fase-5 (token único com `org`/`login`).

> **Mount + config:** montar o router em `app.use('/api/v1/sv360', sv360Routes)`. O `GET /api/config`
> (fase-2) deve setar `streetView360.serviceUrl = <backend>/api/v1/sv360`. `previewThumbnail` permanece
> **relativo sem `/api/v1/sv360`** (o cliente concatena com `serviceUrl`), preservando o contrato.

### 4.2 Shape do metadado de foto (consumido pelo viewer Three.js — NÃO aninhar/renomear)

```json
{ "camera": { "id","img","display_name","lon","lat","ele","heading","height",
              "mesh_rotation_y","mesh_rotation_x","mesh_rotation_z",
              "distance_scale","marker_scale","floor_level","calibration_reviewed" },
  "projectSlug": "...", "captureDate": "...",
  "targets": [ { "id","img","lon","lat","ele","display_name","icon":"next",
                 "next","is_original","distance","bearing",
                 "override_bearing","override_distance","override_height" } ] }
```

**Pontos sensíveis a quebra:** campos **planos** em `camera` (nomes exatos `mesh_rotation_y/x/z`,
`distance_scale`, `marker_scale`, `floor_level`, `calibration_reviewed`); `targets` com
`bearing`/`distance` (**não** `bearing_deg`/`distance_m`, que são o shape interno do banco),
`override_*` número-ou-null, `next`/`is_original` booleanos, `icon:"next"`; ETag
`"{uuid}-{quality}-{sizeBytes}"`; 206/416/304 com `Accept-Ranges`/`Content-Range`; envelope de erro
`{error:"..."}`; faixas de validação de calibração; ordem Euler **ZXY** e projeção em chão plano (`ele`
informativo, não usado na projeção).

### 4.3 Mapeamento de schema `index.db` (SQLite) → `sv360` (Postgres)

| `index.db` | `sv360` (Postgres) | Notas |
|------------|---------------------|-------|
| `organizations(id,slug,name)` | **`public.organizations`** (fase-5) | unificado; backfill `org-legacy` → UUID por `slug`. |
| `users(...)` | **`public.users`** (fase-5) | unificado; 0 usuários hoje → mapear papéis, não migrar dados. |
| `projects(id,organization_id,slug,name,center_lat/lon,entry_photo_id,photo_count,db_filename,status)` | `sv360.projects` | `organization_id` FK → `public.organizations(id)`; `UNIQUE(organization_id, slug)`; `status` CHECK(enabled/disabled). |
| `photos(id TEXT PK,project_id,original_name,display_name,sequence_number,lat/lon/ele,heading,camera_height,mesh_rotation_x/y/z,distance_scale,marker_scale,floor_level,full_size_bytes,preview_size_bytes,calibration_reviewed)` | `sv360.photos` | `id TEXT PK` (UUID v5 string); **`geom GEOMETRY(POINT,4326)`** preenchido de `lon/lat` + GiST; `UNIQUE(project_id, sequence_number)`; `*_size_bytes` são a chave do ETag O(1). |
| `photos_rtree` + `photos_rowid` | — | **descartados** (GiST em `geom` substitui). |
| `targets(source_id,target_id,distance_m,bearing_deg,is_next,is_original,override_*,hidden; PK src+tgt)` | `sv360.targets` | PK composta; o JSON expõe `bearing`/`distance` (não `_deg`/`_m`). |
| `deleted_photos(photo_id PK, deleted_at)` | `sv360.deleted_photos` | soft-delete/tombstone. |
| `{slug}.db` `images(photo_id PK, full_webp BLOB, preview_webp BLOB)` | **permanece SQLite** | lido via `better-sqlite3`. |

---

## 5. Tarefas

> Migração head atual = `017_geographic_access.sql`. As migrações desta fase começam em `018_`.
> Seguem o template de TAREFA + DoD de `_padroes.md §10`.

### Tarefa 1 — Migração do schema `sv360` (metadados + PostGIS)
Criar `018_sv360_schema.sql`: schema `sv360`; `projects` (FK → `public.organizations`,
`UNIQUE(organization_id, slug)`, `status` CHECK); `photos` (`id TEXT PK`, FK `project_id`,
`geom GEOMETRY(POINT,4326)`, GiST, `UNIQUE(project_id, sequence_number)`, `*_size_bytes`, campos de
calibração planos); `targets` (PK composta `source_id,target_id`); `deleted_photos`. `gen_random_uuid()`
não se aplica a `photos.id` (é UUID v5 do cliente). Índices: GiST(geom), btree(project_id), btree por
`sequence_number`. **Critérios:** SRID 4326 validado; FK de org; `npm test` sem regressão. **Teste:**
`tests/integration/sv360-schema.test.js`.

### Tarefa 2 — ETL: importar `index.db` + copiar `{slug}.db`
Script `scripts/sv360-import.js` (idempotente, por projeto, com verificação por tamanho e rollback):
abre o `index.db` (better-sqlite3 readonly), faz **COPY/INSERT** dos metadados para `sv360.*`
(preenchendo `geom` de `lon/lat`), e **copia** cada `{slug}.db` para `SV360_DB_DIR` (verificando
`full_size_bytes` somados vs. tamanho do arquivo). Backfill `org-legacy` → UUID de `organizations`
(criar a OM na fase-5 se faltar). **Critérios:** contagem de fotos/targets bate; reexecução não
duplica; um projeto corrompido não aborta os demais. **Teste:** fixtures pequenas (1 projeto, 2 fotos,
um `images.db` de teste) — validar contagem e `geom`.

### Tarefa 3 — Camada de acesso ao BLOB SQLite + isolamento do caminho quente
`src/modules/streetview360/sv360.blobstore.js`: abre `{SV360_DB_DIR}/{db_filename}` (better-sqlite3
readonly/mmap/query_only, singleton lazy por arquivo); `getImageBlob(dbFile, photoId, quality)` →
Buffer. **Implementar a mitigação D9.8** (recomendado: worker-thread pool para o `SELECT`). Semáforo
`MAX_INFLIGHT=8` (fila) adquirido só no caminho 200/206 (após o 304), liberado uma vez no `close`/`error`.
**Critérios:** leitura readonly; semáforo limita buffers vivos; `EXPLAIN`/medição de RSS documentada.

### Tarefa 4 — Módulo `streetview360`: rotas de leitura + servir imagem
`routes/controller/service/queries/schemas/index` + `sv360-error.js` (envelope `{error:"..."}`).
Read endpoints (§4.1) montados com `flexibleAuth` (auth opcional). `GET /photos/:uuid/image`: ETag O(1)
de `*_size_bytes` (Postgres) → **304 antes do SQLite** → semáforo → Range 206/416 → Buffer.
`/photos/:uuid` monta o shape §4.2 **exato** (campos planos, targets `bearing`/`distance`). `nearby` via
`ST_DWithin(geom::geography, ..., raio)`. **Critérios:** contrato §4.2 byte-compatível; ETag/304/206/416
corretos. **Teste:** `tests/integration/sv360-contract.test.js` (shape + ETag + 304 + Range + envelope).

### Tarefa 5 — Escrita/calibração (auth + posse)
PUT calibration/height/rotation/scale/reviewed; targets override/visibility/criar/deletar; DELETE photo
(soft → `deleted_photos`); batch-calibration. Posse: `canWriteProject` (`role=admin` global passa; senão
`user.org === project.organization_id` e `org_role` de escrita). **Faixas de validação de calibração
preservadas** (mudar uma faixa rejeita valores antes aceitos). **Critérios:** não-dono → 403/404; faixas
preservadas; soft-delete via tombstone. **Teste:** `tests/integration/sv360-write.test.js` (posse +
faixas + caso negativo).

### Tarefa 6 — Admin: ingestão (bundle), status, delete projeto
`POST /admin/projects/upload` (multipart, `bodyLimit` alto; **streama o `.db` para disco**, não
materializa); `validateManifest` (rejeita NaN/Infinity, lat/lon fora de faixa, NOT NULL ausente, target
referenciando foto fora do manifest); **swap atômico** `.tmp/.bak` do `{slug}.db`; **merge transacional**
no Postgres (`purgeProjectRows` "último upload manda" preservando `status`/`created_at`; guard de
colisão de id de outra OM → 409). Status enabled/disabled; delete projeto. **Critérios:** swap atômico
com rollback do `.bak` em falha; merge transacional; 409 em colisão cross-OM. **Teste:**
`tests/integration/sv360-ingest.test.js` (upload de bundle de teste; reupload "último manda";
manifest inválido → 4xx).

### Tarefa 7 — Tiles GeoJSON + (opcional) PMTiles
`GET /tiles/fotos.geojson` ao vivo (do Postgres, NDJSON/streaming O(1)). PMTiles opcional (tippecanoe
fora do processo Node). **Critérios:** GeoJSON com as fotos visíveis (respeitando `status`/posse).

### Tarefa 8 — Montagem, config, gateway e docs
Montar `/api/v1/sv360`; `config.sv360 = { dbDir, maxInflight }`; `SV360_SERVICE_URL` do `GET /api/config`
aponta para `<backend>/api/v1/sv360`. **Atualizar a fase-7:** o NGINX deixa de rotear `/api/360` para o
upstream externo (o 360 agora é interno). Atualizar `CLAUDE.md` (novo módulo, schema `sv360`, dep
`better-sqlite3`, `SV360_DB_DIR`) e `docs/deploy/gateway-360.md`. **Critérios:** frontend resolve as
rotas sem mudança de código (só `serviceUrl`).

---

## 6. Riscos & cuidados

| Risco | Mitigação |
|-------|-----------|
| **better-sqlite3 é síncrono → bloqueia o event loop** do processo que roda atlas/sync/WS (contensão/latência) | D9.8: **worker-thread pool** para o `SELECT` de BLOB (recomendado) ou processo separado; semáforo `MAX_INFLIGHT`; medir latência sob carga. |
| **BLOB materializado no heap → RSS** (o backend não é mais limitado a 512 MB, mas o caminho quente é o mesmo) | Semáforo de 8 buffers vivos; 304 antes do `SELECT`; revisar limite de RAM do container do backend. |
| **ETL dos ~41 GB** (cópia de arquivo) | Script idempotente, **por projeto**, verificação por tamanho, rollback; rodar projeto a projeto; não materializar `.db` em memória. |
| **Quebrar o contrato do viewer Three.js** | Teste de contrato §4.2 (campos planos, `bearing`/`distance`, ETag, 206/416/304, envelope `{error:...}`). Ordem Euler ZXY e chão plano preservados (lógica do cliente, não muda). |
| **Auth: 360 tinha login próprio** | Removido; usa o emissor único (fase-5/7, claims `org`/`login`). O **frontend** deve passar a usar `/api/v1/auth` e enviar o JWT nas rotas de escrita — **coordenação com o `ebgeo_web`** (leitura pública via `flexibleAuth` não muda). |
| **SRID/geom** | `lon/lat` → `GEOMETRY(POINT,4326)`; `nearby` via `::geography` (metros reais). |
| **Modelo offline-first do studio** | Preservar o protocolo de bundle (manifest + `images.db` + thumbnail) e o swap atômico — as OMs continuam gerando SQLite e subindo. |
| **`dummy-hash` anti-timing / anti-lockout** | Já coberto pela fase-0 no login unificado. |

---

## 7. Definition of Done

- [ ] Schema `sv360` (projects/photos[geom+GiST]/targets/deleted_photos) com FK de org; ETL importou
      metadados + copiou `{slug}.db` com verificação por tamanho (idempotente).
- [ ] BLOBs servidos do SQLite com **ETag O(1)** (`*_size_bytes` do Postgres), **304 antes do SQLite**,
      Range 206/416, `immutable`, **semáforo** ativo; caminho quente isolado (worker/processo) com latência medida.
- [ ] Shape de `/photos/:uuid` byte-compatível com §4.2; envelope `{error:"..."}` nas rotas do 360.
- [ ] Escrita/calibração com posse (`canWriteProject`) e faixas de validação preservadas; soft-delete via tombstone.
- [ ] Ingestão (bundle) com swap atômico `.tmp/.bak` + merge transacional + guard cross-OM (409).
- [ ] Auth unificado (emissor único; sem `/auth` no módulo); `flexibleAuth` para leitura.
- [ ] `GET /api/config` aponta `streetView360.serviceUrl` para `/api/v1/sv360`; Fase 7 atualizada (NGINX
      não roteia mais o 360 externo).
- [ ] `CLAUDE.md`/`docs/deploy` atualizados; testes (`sv360-schema/contract/write/ingest`) verdes,
      incluindo casos negativos (posse, manifest inválido, 304/416).

---

## 8. O que NÃO muda

- **BLOBs no Postgres:** nunca. Permanecem em `{slug}.db` (SQLite).
- **Schema do `images.db`** (`photo_id, full_webp, preview_webp`): inalterado — o backend só lê.
- **Protocolo do studio** (export de bundle offline-first): preservado.
- **Domínio colaborativo** (atlas/JSONB/sync/`ng`): intocado; `sv360` é schema isolado.
