# Deploy: backend único (360 ABSORVIDO) + NGINX

> **⚠️ Atualizado na Fase 9 — o `ebgeo_360` foi ABSORVIDO.** O que antes era um microsserviço Fastify
> separado (`:8081`, atrás de um gateway NGINX — decisão D3) agora é o **módulo `src/modules/streetview360`**
> deste backend, montado em **`/api/v1/sv360`**. Os BLOBs WebP continuam em SQLite (`{slug}.db` em
> `SV360_DB_DIR`, lidos via worker pool), mas **não há mais upstream `:8081`**. Ver
> [`docs/plano/fase-9-absorver-360.md`](../plano/fase-9-absorver-360.md). Este documento descreve o deploy
> do **backend único** (já incluindo o 360); a seção histórica do gateway externo ficou obsoleta.

## Identidade (emissor único de JWT)

Há **um** emissor de token: este backend (`POST /api/v1/auth/login`, `issueAccessToken`). Payload:

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

Os aliases `org`/`login` foram mantidos por compatibilidade com o que o 360 lia (`{sub, org, role, login}`),
mas agora o **mesmo processo** valida o token — não há mais "alinhar dois serviços". O módulo `sv360`
resolve a posse pela org/`org_role` (admin global escreve qualquer OM; `org_role ∈ {owner,admin,editor}`
escreve a própria OM; `viewer` só lê). Leitura pública usa `flexibleAuth` (auth opcional).

## NGINX (reverse proxy de UM backend)

Não há mais `upstream ebgeo_360`. Tudo é o backend único:

```nginx
upstream ebgeo_backend { server backend:3000; }

server {
  listen 80;

  # Transição: paths nus antigos -> namespace do backend
  location = /busca       { rewrite ^ /api/v1/nomes/busca      last; }
  location = /feicoes     { rewrite ^ /api/v1/nomes/feicoes    last; }
  location = /catalogo3d  { rewrite ^ /api/v1/nomes/catalogo3d last; }

  # 360 agora é interno em /api/v1/sv360 — sem rota especial, cai no location / abaixo.
  location / {
    proxy_pass http://ebgeo_backend;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_http_version 1.1;                 # WebSocket /api/v1/collab
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    client_max_body_size 2g;                # upload de bundle do 360 (SV360_MAX_UPLOAD_BYTES)
  }
}
```

## `streetView360` no `GET /api/config`

`config.appConfig.sv360ServiceUrl` (env `SV360_SERVICE_URL`) aponta para o **mount interno**
`<backend>/api/v1/sv360` (não mais `:8081`). `previewThumbnail` é relativo (`/thumbnails/{slug}.webp`)
e o cliente o concatena com `serviceUrl`, resolvendo para `…/api/v1/sv360/thumbnails/{slug}.webp`.
`pointsSource` aponta para o GeoJSON ao vivo (`/api/v1/sv360/tiles/fotos.geojson`); a fonte de **linhas**
e uma fonte **vetorial PMTiles** (opcional) são configuráveis por env (`SV360_LINES_URL`, follow-up).

> **Contrato congelado do 360 (preservado pelo módulo `sv360` — ver `99-referencia.md` e a Fase 9):**
> campos planos em `camera` (`mesh_rotation_y/x/z`, `distance_scale`, `marker_scale`, `floor_level`,
> `calibration_reviewed`); `previewThumbnail` relativo; targets com `bearing`/`distance` (não `_deg`/`_m`);
> ETag `"{uuid}-{quality}-{sizeBytes}"`; 206/416/304; **envelope de erro `{ "error": "..." }`** nas rotas
> `sv360` (≠ do `{error:{code,message}}` global — feito por um error-handler de router).

## Backup

- PostgreSQL: `pg_dump` (schemas `atlas`[JSONB] + `ng`[PostGIS] + **`sv360`**[metadados 360]).
- BLOBs 360: os `{slug}.db` em `SV360_DB_DIR` (rsync por missão, modelo offline-first) — **dados do
  backend agora**, não de um serviço separado. Idem `data/assets3d.sqlite` (assets 3D) e `data/images`.

## Padrões de engenharia do 360 carregados para o backend

- **ETag O(1) + 304 + Range + immutable** (artefato imutável) → download de imagem (Fase 0), assets 3D
  (Fase 4) e thumbnails 360 (Fase 9).
- **BLOB-em-SQLite + worker pool + semáforo** → assets 3D (Fase 4) e imagens 360 (Fase 9).
- **Dummy-hash anti-timing no login** → Fase 0 (`auth.service.js`).
