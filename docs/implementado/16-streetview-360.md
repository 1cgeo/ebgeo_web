# 16 - StreetView 360 (sv360)

Este documento cobre a integração com o módulo de panoramas 360 (`sv360`), montado em
`/api/v1/sv360`. O módulo entrega ao frontend: a lista de projetos de fotos 360, os metadados de
cada foto (câmera + grafo de navegação), a imagem WebP em duas qualidades, as fontes vetoriais para
o mapa (tiles MVT e GeoJSON), as thumbnails, e — para usuários com permissão — calibração, edição
do grafo e ingestão de bundles.

> **Atenção ao envelope.** Diferente do restante do backend (que responde `{ "data": ... }` e erros
> `{ "error": { "code", "message" } }`), o `sv360` responde **objetos/arrays nus** e erros no
> envelope **plano** `{ "error": "mensagem" }`. Isso é parte do contrato congelado consumido pelo
> viewer Three.js. Trate as respostas deste módulo como um caso à parte do seu cliente HTTP.

---

## Visão Geral

| Aspecto | Comportamento |
|---------|---------------|
| Base | `/api/v1/sv360` |
| Resposta de sucesso | Objeto/array **nu** (NÃO `{data}`) |
| Resposta de erro | `{ "error": "mensagem" }` (NÃO `{error:{code,message}}`) |
| Leitura | Auth **opcional** (`flexibleAuth`): projeto `enabled` é público; `disabled` só admin/OM dona |
| Escrita/calibração | Auth **estrito** (401 sem token) + posse por organização |
| Ingestão/admin | Auth estrito + posse (admin global ou admin de dados da OM) |
| Imagem 360 | WebP imutável, ETag/304/Range; metadados em PostgreSQL, BLOB em SQLite por projeto |

O módulo está **fora** do sistema de sync/CRDT/WebSocket do atlas. Não há broadcast de escritas 360
nem versionamento CRDT das fotos — a calibração é uma escrita REST direta.

---

## 1. Política de Acesso (leitura)

Toda rota de leitura usa **auth opcional**. A regra de visibilidade está embutida no SQL (defesa em
profundidade — o dado não vaza nem com bug na camada de aplicação):

```
Projeto enabled  → público (visível para anônimo)
Projeto disabled → visível apenas para:
                   - admin global (role === 'admin'), ou
                   - membro da organização dona (organization_id casa)
```

Um projeto oculto responde **404** (indistinguível de inexistente), para não vazar a existência.
Fotos com tombstone (soft-delete) são sempre excluídas das leituras.

> Para leitura anônima, simplesmente não envie `Authorization`. Para ver projetos `disabled` da sua
> OM, envie o `Bearer <accessToken>` normal (ver [01 - Autenticação](./01-autenticacao.md)).

---

## 2. Listar Projetos

### Endpoint

`GET /api/v1/sv360/projects`

### Auth

Opcional. Anônimo vê apenas `enabled`.

### Response (200) — array nu

```json
[
  {
    "id": "3f2a...-uuid",
    "slug": "quartel-general",
    "name": "Quartel General",
    "center_lat": -15.79,
    "center_long": -47.88,
    "entry_photo_id": "1d8e...-uuidv5",
    "photo_count": 240,
    "status": "enabled"
  }
]
```

---

## 3. Obter Projeto por Slug

### Endpoint

`GET /api/v1/sv360/projects/:slug`

### Response (200) — objeto nu

```json
{
  "id": "3f2a...-uuid",
  "organization_id": "org-uuid",
  "slug": "quartel-general",
  "name": "Quartel General",
  "center_lat": -15.79,
  "center_long": -47.88,
  "entry_photo_id": "1d8e...-uuidv5",
  "photo_count": 240,
  "db_filename": "org-uuid__quartel-general.db",
  "status": "enabled"
}
```

### Erros

- `404` — projeto inexistente **ou** oculto para o chamador (`{ "error": "Project not found" }`)

---

## 4. Metadados da Foto

Este é o recurso central do viewer: a câmera plana de uma foto + o grafo de navegação (`targets`)
para as fotos vizinhas.

### Endpoint

`GET /api/v1/sv360/photos/:uuid`

- `:uuid` é o id da foto — um **UUID v5** determinístico gerado pelo cliente (validado por formato).

### Endpoint alternativo (por nome de arquivo)

`GET /api/v1/sv360/photos/by-name/:nome`

- Busca pelo `original_name` da foto. Em caso de nome colidindo entre projetos, um projeto `enabled`
  vence o desempate.

### Response (200) — shape congelado, objeto nu

```json
{
  "camera": {
    "id": "1d8e...-uuidv5",
    "img": "IMG_0420.jpg",
    "display_name": "Pátio Norte",
    "lon": -47.881,
    "lat": -15.792,
    "ele": 1012.4,
    "heading": 87.5,
    "height": 1.7,
    "mesh_rotation_y": 0,
    "mesh_rotation_x": 0,
    "mesh_rotation_z": 0,
    "distance_scale": 1,
    "marker_scale": 1,
    "floor_level": 0,
    "calibration_reviewed": false
  },
  "projectSlug": "quartel-general",
  "captureDate": "2025-03-14T13:02:00.000Z",
  "previewThumbnail": "/thumbnails/quartel-general.webp",
  "targets": [
    {
      "id": "9a44...-uuidv5",
      "img": "IMG_0421.jpg",
      "lon": -47.8809,
      "lat": -15.7919,
      "ele": 1012.6,
      "display_name": "Pátio Norte 2",
      "icon": "next",
      "next": true,
      "is_original": true,
      "distance": 8.2,
      "bearing": 92.0,
      "override_bearing": null,
      "override_distance": null,
      "override_height": null
    }
  ]
}
```

> **Contrato congelado**: o shape acima não pode mudar sem quebrar o viewer Three.js. Pontos
> sensíveis:
> - Os campos de `camera` são **planos** (nunca aninhe em `position`/`orientation`); nomes exatos
>   `mesh_rotation_y/x/z`, `distance_scale`, `marker_scale`, `floor_level`, `calibration_reviewed`.
> - Em `targets`, use `bearing`/`distance` (NÃO `bearing_deg`/`distance_m`, que são internos do
>   banco); `override_*` é número ou `null`; `next`/`is_original` são booleanos; `icon` é a constante
>   `"next"`.
> - `previewThumbnail` é **relativo e sem o prefixo `/api/v1`** — o cliente concatena com o
>   `serviceUrl` do `streetView360` (ver §11). Com `serviceUrl = <backend>/api/v1/sv360`, o valor
>   `/thumbnails/quartel-general.webp` resolve para `…/api/v1/sv360/thumbnails/quartel-general.webp`.

### Notas de integração

- O viewer depende da ordem de rotação Euler **ZXY** e de um modelo de **chão plano**: `ele` é
  apenas informativo (não entra na projeção); os overrides projetam no plano do chão.
- `targets` já vem ordenado: `is_next` primeiro, depois o mais próximo. Alvos com `hidden=true` e
  alvos apontando para fotos com tombstone são omitidos.

### Erros

- `404` — foto inexistente, com tombstone, ou cujo projeto está oculto para o chamador.

---

## 5. Imagem da Foto (WebP)

### Endpoint

`GET /api/v1/sv360/photos/:uuid/image?quality=full|preview`

- `quality` opcional, default `full`. Valores válidos: `full`, `preview`.

### Response

Binário WebP (`Content-Type: image/webp`). A imagem é **imutável** após a ingestão.

| Header | Valor |
|--------|-------|
| `ETag` | `"{uuid}-{quality}-{sizeBytes}"` |
| `Cache-Control` | `public, max-age=31536000, immutable` |
| `Accept-Ranges` | `bytes` |

### Comportamento HTTP

- **304 Not Modified**: se `If-None-Match` casar com o ETag, responde 304 **antes** de tocar o
  armazenamento do BLOB (o ETag é derivado do tamanho em Postgres, sem ler a imagem — O(1)).
- **206 Partial Content**: com header `Range: bytes=start-end`, responde 206 + `Content-Range`.
- **416 Range Not Satisfiable**: Range inválido → 416 + `Content-Range: bytes */<len>`.
- **200**: sem Range, corpo inteiro + `Content-Length`.

> **Contrato congelado**: ETag `"{uuid}-{quality}-{sizeBytes}"` e o protocolo **304/206/416** com
> `Accept-Ranges`/`Content-Range` são consumidos pelo viewer. Não recomprima o WebP.

### Notas de integração

- Como a imagem é imutável e cacheável por 1 ano, use `<img>`/fetch com cache do browser
  normalmente; revalidações respondem 304 baratos.
- Use o ETag/Range para streaming progressivo de panoramas grandes se necessário.

### Fluxo

```
Cliente                              Backend
   |                                    |
   |-- GET /photos/:uuid/image -------->|  (lê *_size_bytes no Postgres → ETag O(1))
   |   If-None-Match: "uuid-full-N"     |
   |                                    |
   |<-- 304 (se ETag casa) -------------|  (antes de ler o BLOB)
   |                                    |
   |-- GET /photos/:uuid/image -------->|  (sem If-None-Match)
   |                                    |  (lê o BLOB do {slug}.db em worker thread)
   |<-- 200 image/webp + ETag ----------|
```

---

## 6. Fontes para o Mapa (tiles vetoriais)

A fonte que o frontend consome para desenhar os pontos e as rotas das fotos 360 no mapa é o **vector
tile MVT**. (A `GET /tiles/fotos.geojson` permanece por compatibilidade, mas a config aponta para o
MVT.)

### 6.1 Vector Tiles (MVT)

#### Endpoint

`GET /api/v1/sv360/tiles/:z/:x/:y.pbf`

- `z` em `0..24`; `x`/`y` devem estar dentro da grade `2^z`. Fora disso → **400**.

#### Response

Protobuf MVT (`Content-Type: application/vnd.mapbox-vector-tile`,
`Cache-Control: public, max-age=60`). O tile carrega **duas camadas**:

| Camada | Geometria | Conteúdo | Properties |
|--------|-----------|----------|------------|
| `fotos` | Point | Pontos das fotos legíveis | `id`, `projectSlug`, `img`, `sequence_number` (+ demais) |
| `fotos_linha` | LineString | Trajetória por projeto (fotos em ordem de `sequence_number`) | por projeto |

- A regra de acesso (`enabled` público; `disabled` só admin/OM dona) está embutida no SQL; fotos com
  tombstone são excluídas.
- Um tile sem features na bbox responde **200** com Buffer vazio (MVT vazio é válido).
- `Cache-Control` é **curto** (NÃO `immutable`): os tiles mudam a cada ingestão/toggle/tombstone.

> **Nota:** `fotos_linha` é a **trajetória** (uma LineString por projeto, fotos conectadas por
> `sequence_number`), não o grafo de navegação dirigido — esse já está exposto por-foto no array
> `targets` do metadado.

### 6.2 GeoJSON (compat)

#### Endpoint

`GET /api/v1/sv360/tiles/fotos.geojson`

#### Response (200) — FeatureCollection nu

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [-47.881, -15.792] },
      "properties": {
        "id": "1d8e...-uuidv5",
        "projectSlug": "quartel-general",
        "img": "IMG_0420.jpg",
        "display_name": "Pátio Norte",
        "sequence_number": 1,
        "heading": 87.5,
        "ele": 1012.4
      }
    }
  ]
}
```

Mesma regra de acesso embutida no SQL; tombstoned excluído.

---

## 7. Thumbnail do Projeto

### Endpoint

`GET /api/v1/sv360/thumbnails/:slug.webp`

### Response

WebP da thumbnail do projeto, servido do filesystem com o mesmo contrato de cache da imagem:
`ETag` (derivado de `fs.stat`: tamanho + mtime), `Cache-Control: ...immutable`, `Accept-Ranges`,
suporte a **304/206/416**.

### Erros

- `404` — projeto oculto/inexistente para o chamador, ou arquivo ausente.

> O `:slug` é restrito ao charset `^[a-z0-9-]+$` e passa por `path.basename` (anti-traversal). É este
> o arquivo apontado pelo `previewThumbnail` relativo do metadado (§4).

---

## 8. Escrita / Calibração

Todas as rotas de escrita usam o middleware `auth` **estrito** (401 sem token válido). A posse é
resolvida no service, com a escada **404 → 403**:

```
Não consegue nem LER (projeto oculto/inexistente/foto com tombstone) → 404 (sem vazar)
Consegue ler mas NÃO escrever                                        → 403
```

**Quem pode escrever** (`canWriteProject`):
- admin global (`role === 'admin'`), em qualquer OM; **ou**
- mesma organização com `org_role ∈ {owner, admin, editor}`.

Um `viewer` da mesma org **lê** (estágio 1) mas **não escreve**.

> Toda escrita que retorna uma foto **re-lê** e devolve o **shape congelado** do metadado (§4) —
> fonte única do shape. Respostas continuam **nuas** e erros no envelope **plano** `{error}`.

### 8.1 Calibração agregada

#### Endpoint

`PUT /api/v1/sv360/photos/:uuid/calibration`

#### Request — qualquer subconjunto (mínimo 1 campo)

```json
{
  "heading": 88.0,
  "height": 1.75,
  "mesh_rotation_x": 0,
  "mesh_rotation_y": 0,
  "mesh_rotation_z": 1.2,
  "distance_scale": 1,
  "marker_scale": 1,
  "floor_level": 0,
  "calibration_reviewed": true
}
```

#### Response (200)

O metadado da foto rebuildado (shape congelado da §4).

> **Validação só de tipo/finitude — sem faixas numéricas.** Todo campo numérico é validado como
> número finito (rejeita `NaN`/`Infinity`/string), **sem min/max**. `floor_level` é inteiro;
> `calibration_reviewed` é booleano estrito. Valores como `heading: 400` ou `distance_scale: 0` são
> **aceitos** (o banco aceita; o contrato congelado não documenta faixas, e apertar uma faixa
> rejeitaria valores que o cliente legitimamente envia). Corpo vazio ou campo desconhecido → **422**.

### 8.2 Aliases granulares

Atalhos de um campo só, com o mesmo comportamento da calibração agregada:

| Endpoint | Body | Mapeia para |
|----------|------|-------------|
| `PUT /photos/:uuid/height` | `{ "height": 1.75 }` | `camera_height` |
| `PUT /photos/:uuid/rotation-x` | `{ "mesh_rotation_x": 0 }` | `mesh_rotation_x` |
| `PUT /photos/:uuid/rotation-z` | `{ "mesh_rotation_z": 1.2 }` | `mesh_rotation_z` |
| `PUT /photos/:uuid/distance-scale` | `{ "distance_scale": 1 }` | `distance_scale` |
| `PUT /photos/:uuid/marker-scale` | `{ "marker_scale": 1 }` | `marker_scale` |
| `PUT /photos/:uuid/reviewed` | `{ "calibration_reviewed": true }` | `calibration_reviewed` |

> Não há alias `rotation-y` — `mesh_rotation_y` só é editável pela rota agregada `/calibration`.

### 8.3 Calibração em lote

#### Endpoint

`POST /api/v1/sv360/photos/batch-calibration`

#### Request (máx. 500 itens; cada item: `uuid` + ≥1 campo)

```json
{
  "photos": [
    { "uuid": "1d8e...-uuidv5", "heading": 88.0 },
    { "uuid": "9a44...-uuidv5", "height": 1.7, "calibration_reviewed": true }
  ]
}
```

#### Response (200) — falha parcial por item

```json
{
  "updated": [ { "camera": { "...": "shape congelado" }, "targets": [] } ],
  "failed": [ { "uuid": "bad-uuid", "error": "Photo not found" } ]
}
```

A posse é checada por item; itens válidos são aplicados mesmo que outros falhem.

### 8.4 Grafo de navegação (targets)

| Endpoint | Comportamento |
|----------|---------------|
| `POST /photos/:uuid/targets` | Cria link dirigido. O alvo deve estar **no mesmo projeto** e não ter tombstone. Duplicado → **409**. Responde **201** com o shape do source. |
| `PUT /photos/:uuid/targets/:targetId/override` | Define (número) ou limpa (`null`) `override_bearing`/`override_distance`/`override_height` (≥1 campo). 404 se o link não existe. |
| `PUT /photos/:uuid/targets/:targetId/visibility` | `{ "hidden": true\|false }` — alterna a visibilidade (alvo oculto some do array `targets` na leitura). |
| `DELETE /photos/:uuid/targets/:targetId` | **Hard-delete** do link (único hard-delete do módulo — adjacência é regenerável). **204** idempotente. |

#### Request de criação de link

```json
{
  "target_id": "9a44...-uuidv5",
  "is_next": true,
  "is_original": false,
  "distance_m": 8.2,
  "bearing_deg": 92.0
}
```

> A criação usa os **nomes internos** `distance_m`/`bearing_deg` (é uma escrita de calibração, não a
> leitura). A leitura do metadado (§4) reflete esses valores como `distance`/`bearing`.

### 8.5 Soft-delete da foto

#### Endpoint

`DELETE /api/v1/sv360/photos/:uuid`

- **Soft-delete** via tombstone (idempotente, `ON CONFLICT DO NOTHING`). **Nunca** apaga a linha nem
  o BLOB.
- 1ª chamada → **204**; chamadas seguintes → **404** (a leitura já exclui fotos com tombstone).

### Tratamento de erros (escrita)

| Status | Quando |
|--------|--------|
| `401` | Sem token / token inválido |
| `403` | Pode ler mas não escrever (ex.: `viewer` da OM) |
| `404` | Foto/projeto inexistente, com tombstone, ou oculto; link inexistente no override |
| `409` | Target duplicado / cross-project |
| `422` | Body inválido (tipo errado, vazio, campo desconhecido) |

Todos no envelope plano `{ "error": "..." }`.

---

## 9. Ingestão e Administração (alto nível)

Rotas sob `/api/v1/sv360/admin`, com `auth` estrito e posse por organização (admin global escreve
qualquer OM; admin de dados da OM — `org_role ∈ {owner, admin, editor}` — só a própria OM). Voltadas
ao estúdio de produção/admin, não ao viewer comum.

### 9.1 Ingestão de bundle

#### Endpoint

`POST /api/v1/sv360/admin/projects/upload`

#### Request — `multipart/form-data`

| Campo | Conteúdo |
|-------|----------|
| `manifest` | JSON com o **estado completo** do projeto (metadados de projeto + `photos[]` + `targets[]` + tombstones) |
| `imagesDb` | SQLite `images.db` com os BLOBs WebP |
| `thumbnail` | (opcional) `.webp` da thumbnail do projeto |

#### Response (201) — objeto nu

```json
{
  "projectId": "3f2a...-uuid",
  "slug": "quartel-general",
  "dbFilename": "org-uuid__quartel-general.db",
  "photoCount": 240
}
```

#### Notas

- O manifest é o **estado completo** (não delta): ingestão é "último upload manda" por
  `(organização, slug)`.
- O upload tem um gate de capacidade de escrita **antes** do multer — quem não tem capacidade de
  escrita alguma recebe **403** sem que nenhum byte chegue ao disco.
- Manifest inválido → **4xx** (`422` para schema, `400` para JSON quebrado/campos ausentes).
- Colisão de id de foto com outro projeto (cross-OM ou same-org cross-project) → **409**.

> **Internals (resumo):** o nome do `{slug}.db` é derivado no servidor a partir de `(org, slug)` (o
> valor do manifest é ignorado, isolando OMs que compartilham slug). A consistência banco↔arquivo
> usa swap-do-arquivo-primeiro e o commit do Postgres como ponto atômico. Você não precisa lidar com
> isso no cliente — apenas com o resultado 201 acima.

### 9.2 Listar projetos da OM (incluindo disabled)

`GET /api/v1/sv360/admin/projects` — array nu de projetos. Admin global vê todas as OMs (filtrável
por `?orgId=<uuid>`); admin de OM vê só a sua.

### 9.3 Status (visibilidade pública)

`PATCH /api/v1/sv360/admin/projects/:slug/status`

```json
{ "status": "enabled" }
```

Alterna `enabled`/`disabled`. **200** com o projeto. Admin global pode desambiguar slug colidente
entre OMs via `?orgId=<uuid>` ou `?orgSlug=<slug>`; `?orgId` malformado → **400**.

### 9.4 Hard-delete do projeto

`DELETE /api/v1/sv360/admin/projects/:slug` — **HARD-delete** (CASCADE fotos → targets) + remove o
`{slug}.db` do disco. **204**. (O "soft" equivalente é `PATCH status=disabled`.)

---

## 10. Códigos de Erro (resumo)

Todos no envelope plano `{ "error": "mensagem" }`:

| Código | Significado |
|--------|-------------|
| `400` | Parâmetro de tile fora de faixa, `?orgId` malformado, JSON/manifest ausente |
| `401` | Rota de escrita/admin sem token válido |
| `403` | Sem capacidade/posse de escrita (ex.: `viewer`, cross-org) |
| `404` | Recurso inexistente, com tombstone, ou oculto para o chamador |
| `409` | Target duplicado / colisão de id de foto / slug ambíguo (admin global) |
| `416` | Range inválido em imagem/thumbnail |
| `422` | Body/parâmetro de validação inválido (tipo, vazio, campo desconhecido) |

---

## 11. Configuração no Frontend (`GET /api/config`)

O endpoint público de config (ver [10 - Config](./10-config.md)) expõe o bloco `streetView360`
apontando para a fonte vetorial:

```json
{
  "streetView360": {
    "serviceUrl": "https://<backend>/api/v1/sv360",
    "pointsSource": {
      "type": "vector",
      "tiles": ["https://<backend>/api/v1/sv360/tiles/{z}/{x}/{y}.pbf"]
    },
    "linesSource": {
      "type": "vector",
      "tiles": ["https://<backend>/api/v1/sv360/tiles/{z}/{x}/{y}.pbf"]
    },
    "pointsSourceLayer": "fotos",
    "linesSourceLayer": "fotos_linha"
  }
}
```

> O `serviceUrl` é a base que o cliente concatena com o `previewThumbnail` relativo do metadado (§4)
> e com as demais rotas do módulo.

---

## Checklist de Integração

- [ ] Tratar respostas do `sv360` como **nuas** (objeto/array), não `{data}`
- [ ] Tratar erros do `sv360` como **plano** `{error: "msg"}`, não `{error:{code,message}}`
- [ ] Ler `streetView360` do `/api/config` (serviceUrl + fontes MVT)
- [ ] Consumir a fonte vetorial MVT (`pointsSource`/`linesSource`, camadas `fotos`/`fotos_linha`)
- [ ] Carregar metadado da foto (`/photos/:uuid`) respeitando o shape congelado (câmera plana, ZXY)
- [ ] Resolver `previewThumbnail` concatenando com `serviceUrl`
- [ ] Servir imagem 360 com cache do browser (ETag/304) e Range quando útil
- [ ] (admin/calibração) Enviar `Authorization` e tratar a escada 401/403/404
- [ ] (admin) Upload multipart de bundle e tratar 201/4xx/409

---

## Próximo Documento

[../../README.md](../../README.md) - Índice da documentação
