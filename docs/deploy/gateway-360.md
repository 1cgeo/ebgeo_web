# Gateway NGINX + integração `ebgeo_360` (Fase 7)

> O `ebgeo_360` permanece um **microsserviço autônomo** (Fastify + better-sqlite3, 41 GB de WebP
> servidos com mmap/Range/immutable). **Não** se move o BLOB para o Postgres. Unifica-se **apenas o
> JWT**: o backend único (este repo) é o **emissor único**; o 360 só **verifica** com o mesmo
> `JWT_SECRET` (HS256). Decisão D3 em `docs/plano/00-visao-geral.md`.

## Contrato de payload do JWT (emissor único)

O token emitido por `POST /api/v1/auth/login` (`issueAccessToken`) carrega:

```json
{
  "sub": "<user uuid>",
  "username": "<login>",  "login": "<login>",
  "nome": "...", "posto": "...",
  "role": "user|admin",                  // global
  "organization_id": "<org uuid|null>", "org": "<org uuid|null>",
  "org_role": "owner|editor|viewer|admin"
}
```

- O **backend único** lê `organization_id`/`username`/`role`/`org_role`.
- O **ebgeo_360** lê `sub`/`org`/`login` diretamente (aliases acima) e **mapeia** `role`:
  `admin → system_admin`, `user (com escrita na OM) → om_data_admin`, demais → leitura.
- Alinhamento de `org`: gravar em `projects.organization_id` (SQLite do 360) o **UUID** da tabela
  `organizations` deste backend (mapeado por `slug`) — backfill único de `org-legacy` → UUID real.
  Zero mudança de schema do 360.

## NGINX (reverse proxy + repasse do Authorization)

```nginx
upstream ebgeo_backend { server backend:3000; }
upstream ebgeo_360     { server ebgeo_360:8081; }

server {
  listen 80;

  # Transição: paths nus antigos do gazetteer -> namespace do backend
  location = /busca       { rewrite ^ /api/v1/nomes/busca      last; }
  location = /feicoes     { rewrite ^ /api/v1/nomes/feicoes    last; }
  location = /catalogo3d  { rewrite ^ /api/v1/nomes/catalogo3d last; }

  # ebgeo_360 (prefixado sob /api/360 -> reescrito para /api/v1 no upstream,
  # evitando colisão de /auth e /projects com o backend único)
  location /api/360/ {
    rewrite ^/api/360/(.*)$ /api/v1/$1 break;
    proxy_pass http://ebgeo_360;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;   # repassa o JWT sem reescrever
    proxy_set_header X-Real-IP $remote_addr;
  }

  # Backend único (tudo o mais)
  location / {
    proxy_pass http://ebgeo_backend;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_http_version 1.1;                 # WebSocket /api/v1/collab
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

> **Contrato do 360 a NÃO QUEBRAR** (preservado em `docs/plano/99-referencia.md`): campos planos em
> `camera` (`mesh_rotation_y/x/z`, `distance_scale`, `marker_scale`, `floor_level`,
> `calibration_reviewed`); `previewThumbnail` relativo sem `/api/v1`; targets com `bearing`/`distance`
> (não `_deg`/`_m`); ETag `"{uuid}-{quality}-{sizeBytes}"`; 206/416/304 com `Accept-Ranges`/
> `Content-Range`; envelope de erro `{ "error": "..." }` (diferente do `{error:{code,message}}` deste
> backend — **o gateway não pode reescrever o corpo**).

## `streetView360.serviceUrl` no `GET /api/config`

A fase-2 (`config.appConfig.sv360ServiceUrl`, env `SV360_SERVICE_URL`) deve apontar para a URL do
360 **atrás do gateway** (ex.: `https://<gateway>/api/360`). `previewThumbnail` é relativo sem
`/api/v1`, então `serviceUrl` é a base do 360 atrás do gateway.

## Backup (dualidade)

- Backend único: `pg_dump` do PostgreSQL (schemas atlas[JSONB] + ng[PostGIS]).
- ebgeo_360: cópia de arquivo `.db` por missão (rsync dos `{slug}.db`), modelo offline-first.

## Padrões de engenharia do 360 já carregados para este backend

- **ETag O(1) + 304 + Range + immutable** para artefato imutável → aplicado no download de imagem
  (Fase 0) e no servir de assets 3D (Fase 4, `src/modules/nomes/assets3d.*`).
- **Dummy-hash anti-timing no login** → Fase 0 (`auth.service.js`).
