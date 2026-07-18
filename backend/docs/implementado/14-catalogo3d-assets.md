# 14 - Catálogo 3D e Distribuição de Assets

Este documento cobre como o frontend **descobre** os modelos 3D (tilesets, modelos glTF, nuvens de
pontos) e como **baixa os binários** correspondentes do backend.

---

## Visão Geral

O subsistema 3D tem duas metades, deliberadamente separadas:

1. **Descoberta e posicionamento** — `GET /api/v1/nomes/catalogo3d` (autenticado) devolve os metadados
   de cada modelo: nome, tipo, posição geográfica, parâmetros de renderização do Cesium, `style`
   (`Cesium3DTileStyle`) e a **`url` relativa** do binário. Esta rota é a fonte única de descoberta
   (detalhada em [13 - Nomes Geográficos](./13-nomes-geograficos.md)).
2. **Distribuição do binário** — `GET /api/v1/assets3d/*` (público) serve os arquivos imutáveis
   (`tileset.json`/`.b3dm`/`.glb`/`.gltf`/`.pnts`/`.terrain`) com ETag/304/Range e cache agressivo.

A `url` armazenada no catálogo é **relativa** (ex.: `/aman/tileset.json`). O frontend a resolve contra
o campo **`assets3dBaseUrl`** do `GET /api/config` ([10 - Config](./10-config.md)), o que torna a `url`
portável entre ambientes (dev, homologação, rede interna) sem reescrever os dados.

```
┌──────────────────────────────────────────────────────────────────┐
│  1. GET /api/config            → assets3dBaseUrl ("/api/v1/assets3d")│
│  2. GET /nomes/catalogo3d      → [{ url: "/aman/tileset.json", ...}] │
│  3. tilesetUrl = assets3dBaseUrl + url                               │
│                = "/api/v1/assets3d/aman/tileset.json"               │
│  4. Cesium baixa o tileset e seus .b3dm via GET /assets3d/*         │
└──────────────────────────────────────────────────────────────────┘
```

---

## 1. Descoberta dos modelos

### Endpoint

`GET /api/v1/nomes/catalogo3d`

> A descoberta completa (busca full-text PT-BR, paginação, filtro de acesso por modelo) está
> documentada em [13 - Nomes Geográficos](./13-nomes-geograficos.md). Aqui interessa
> apenas o subconjunto de campos que o cliente 3D consome para montar a cena.

### Request (query)

```
GET /api/v1/nomes/catalogo3d?q=aman&page=1&nr_records=10
Authorization: Bearer <accessToken>
```

| Parâmetro | Tipo | Default | Descrição |
|-----------|------|---------|-----------|
| `q` | string (max 200, opcional) | — | Termo de busca full-text (nome/descrição/palavras-chave/município/estado). Omitir lista tudo |
| `page` | int ≥ 1 | `1` | Página |
| `nr_records` | int 1–100 | `10` | Registros por página |

### Response (200)

> **Contrato congelado**: a resposta usa o envelope `{ total, page, nr_records, data }` — **NÃO** o
> envelope padrão `{ data: ... }`. Cada item de `data[]` carrega exatamente os campos abaixo.

```json
{
  "total": 1,
  "page": 1,
  "nr_records": 10,
  "data": [
    {
      "id": "model-uuid",
      "name": "AMAN - Campus",
      "description": "Modelo 3D do campus da AMAN",
      "thumbnail": "/aman/thumb.png",
      "url": "/aman/tileset.json",
      "lon": -44.45,
      "lat": -22.46,
      "height": 440,
      "heading": 0,
      "pitch": 0,
      "roll": 0,
      "type": "Tiles 3D",
      "heightoffset": 0,
      "maximumscreenspaceerror": 16,
      "data_criacao": "2024-01-15T10:30:00.000Z",
      "municipio": "Resende",
      "estado": "RJ",
      "palavras_chave": ["aman", "campus", "exército"],
      "style": { "pointSize": 3, "color": "color('white')" },
      "rank": 0.6079
    }
  ]
}
```

### Campos relevantes para a cena 3D

| Campo | Uso no frontend |
|-------|-----------------|
| `url` | Caminho **relativo** do binário; resolvido contra `assets3dBaseUrl` |
| `type` | `'Tiles 3D'` \| `'Modelos 3D'` \| `'Nuvem de Pontos'` — decide o loader do Cesium |
| `lon`/`lat`/`height` | Posição de origem do modelo |
| `heading`/`pitch`/`roll` | Orientação (graus) |
| `heightoffset` | Ajuste vertical aplicado após o posicionamento |
| `maximumscreenspaceerror` | LOD do tileset (quanto maior, mais agressivo o decimation) |
| `style` | `Cesium3DTileStyle` (JSONB) — ver seção 4 |
| `thumbnail` | Miniatura (caminho relativo, servido como qualquer outro asset) |

> **Nota:** `style` pode ser `null` quando o modelo não tem estilo associado. `type` é validado no
> banco contra exatamente esses três valores.

---

## 2. Resolução da `url` contra `assets3dBaseUrl`

O catálogo guarda apenas caminhos relativos. A URL final do binário é:

```javascript
// 1. Carregue a config uma vez na inicialização (ver doc 10)
const appConfig = await fetch('/api/config').then((r) => r.json());
const assets3dBaseUrl = appConfig.assets3dBaseUrl; // ex.: "/api/v1/assets3d"

// 2. Para cada modelo do catálogo, resolva a url
function resolveAssetUrl(relativeUrl) {
  // relativeUrl já vem com barra inicial: "/aman/tileset.json"
  return `${assets3dBaseUrl}${relativeUrl}`;
  // → "/api/v1/assets3d/aman/tileset.json"
}
```

`assets3dBaseUrl` é **configurável por ambiente** (env `ASSETS_3D_BASE_URL`, default
`/api/v1/assets3d`). Em produção pode apontar para um host de estáticos interno — o frontend não
precisa de rebuild, basta reler `/api/config`.

> **Contrato congelado**: `url`, `thumbnail` (e demais caminhos de asset) são **relativos**. Não
> assuma o prefixo `/api/v1/assets3d` no cliente — sempre concatene com `assets3dBaseUrl`.

---

## 3. Download dos binários (`/assets3d/*`)

### Endpoint

`GET /api/v1/assets3d/*`

Rota **pública** (sem `Authorization`). A descoberta já é protegida pelo catálogo autenticado; quem
não conhece a `url` não a baixa. O `*` é o caminho relativo do asset (ex.:
`/api/v1/assets3d/aman/tileset.json` → resolve `aman/tileset.json`).

### Headers de resposta (200)

```
Content-Type: application/json            (varia por extensão — ver tabela)
Content-Length: 20480
ETag: "20480-1705312200000"
Cache-Control: public, max-age=31536000, immutable
Accept-Ranges: bytes
```

### Content-Type por extensão

| Extensão | Content-Type |
|----------|--------------|
| `.json` (tileset.json, layer.json) | `application/json` |
| `.glb` | `model/gltf-binary` |
| `.gltf` | `model/gltf+json` |
| `.b3dm` | `application/octet-stream` |
| `.pnts` | `application/octet-stream` |
| `.terrain` (quantized-mesh) | `application/octet-stream` |
| (outras) | `application/octet-stream` |

### Cache e revalidação (ETag / 304)

Os assets são **imutáveis** (`Cache-Control: public, max-age=31536000, immutable`). O navegador (e o
Cesium) cacheiam e geralmente nem revalidam dentro do ano. Se revalidarem, o backend responde 304 sem
reler o arquivo:

```
GET /api/v1/assets3d/aman/tileset.json
If-None-Match: "20480-1705312200000"

→ 304 Not Modified   (sem corpo)
```

O ETag é **O(1)**: no filesystem é derivado de `fs.stat` (`"{size}-{mtimeMs}"`, sem ler o conteúdo);
no store SQLite é uma coluna (sha1 do conteúdo, calculado na carga). Em ambos os casos o 304
curto-circuita **antes** de qualquer leitura pesada.

### Requisições de Range (206 / 416)

A rota suporta `Range` (necessário para Cesium baixar slices de tilesets/terrain grandes):

```
GET /api/v1/assets3d/aman/data.b3dm
Range: bytes=0-1023

→ 206 Partial Content
  Content-Range: bytes 0-1023/524288
  Content-Length: 1024
```

Range inválido (fora dos limites, malformado) retorna **416**:

```
→ 416 Range Not Satisfiable
  Content-Range: bytes */524288
```

Suporta sufixo (`bytes=-500` = últimos 500 bytes) e aberto à direita (`bytes=1024-`).

### Anti-traversal

O caminho é normalizado e validado contra a raiz dos assets (`path.resolve` +
verificação de prefixo). Tentativas de escapar do diretório retornam erro:

```
GET /api/v1/assets3d/../../etc/passwd  → 404
GET /api/v1/assets3d/%2e%2e/secret     → 404

Os segmentos `..` são colapsados contra a raiz dos assets pela normalização (`path.posix.normalize`),
então o alvo permanece dentro da raiz e, como o arquivo não existe, a resposta é **404**. O `403
Forbidden` só ocorreria se o caminho, após a normalização, ainda escapasse da raiz — o que essas
tentativas não fazem.
```

Asset inexistente → **404**.

### Fluxo

```
Cliente (Cesium)                 Backend
   |                                |
   |-- GET /assets3d/aman/tileset.json ->|
   |                                |  [Tenta store SQLite]
   |                                |  [Senão, filesystem]
   |<-- 200 ------------------------|
   |   ETag, immutable, tileset.json|
   |                                |
   [Cesium lê as referências e      |
    baixa cada .b3dm sob demanda]   |
   |                                |
   |-- GET /assets3d/aman/0.b3dm -->|
   |   Range: bytes=0-...           |
   |<-- 206 ------------------------|
```

---

## 4. `style` — `Cesium3DTileStyle`

O campo `style` do catálogo é um JSONB que trafega **verbatim** (o backend não transforma; lê e
devolve o objeto). É especialmente usado por nuvens de pontos (`type: 'Nuvem de Pontos'`) para definir
`pointSize`, `color` (expressões do Cesium), etc.

```json
{
  "pointSize": 3,
  "color": "color('white')"
}
```

Aplicação no Cesium:

```javascript
import { Cesium3DTileStyle } from 'cesium';

const model = catalogModels.find((m) => m.id === modelId);
if (model.style) {
  tileset.style = new Cesium3DTileStyle(model.style);
}
```

> Round-trip íntegro: o JSON enviado na carga do catálogo é o mesmo objeto que sai na resposta
> (mesma garantia que o atlas dá para `geometry`/`properties`).

---

## 5. Notas de integração com o Cesium

```javascript
// Carrega o catálogo e adiciona cada modelo à cena conforme o tipo
async function loadCatalog3D(viewer, accessToken, assets3dBaseUrl) {
  const res = await fetch('/api/v1/nomes/catalogo3d?nr_records=100', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const { data: models } = await res.json();

  for (const m of models) {
    const url = `${assets3dBaseUrl}${m.url}`;

    if (m.type === 'Tiles 3D' || m.type === 'Nuvem de Pontos') {
      const tileset = await Cesium.Cesium3DTileset.fromUrl(url, {
        maximumScreenSpaceError: m.maximumscreenspaceerror ?? 16,
      });
      // Posicionamento por lon/lat/height + heightoffset
      // Orientação por heading/pitch/roll
      if (m.style) tileset.style = new Cesium.Cesium3DTileStyle(m.style);
      viewer.scene.primitives.add(tileset);
    } else if (m.type === 'Modelos 3D') {
      // glTF/glb posicionado por lon/lat/height + orientação
      // viewer.entities.add({ position, model: { uri: url } })
    }
  }
}
```

Pontos de atenção:

- **Sempre concatene `assets3dBaseUrl + m.url`.** Nunca hardcode `/api/v1/assets3d`.
- O Cesium faz muitas requisições `Range` ao binário. A rota suporta — não desabilite `Accept-Ranges`
  em proxies intermediários.
- O cache `immutable` é por **caminho/ETag**. Se um modelo for re-publicado com o **mesmo** caminho,
  o ETag muda (size/mtime no FS; sha1 no SQLite) e o cliente revalida.
- O **terrain** do mapa 3D **não** vem desta rota por padrão — é uma URL configurável
  (`map3d.providers.terrain.url` no `/api/config`, ver [10 - Config](./10-config.md)). A infra de
  `/assets3d` suporta servir `.terrain`/`layer.json` caso um dia se decida hospedá-lo aqui.

---

## 6. Dual-mode de armazenamento (SQLite-first + filesystem)

Transparente para o frontend, mas útil saber: o backend serve cada binário de **duas fontes
possíveis**, tentando nesta ordem:

1. **Store SQLite** (`better-sqlite3`): BLOB com ETag O(1) por coluna; a leitura do BLOB roda num pool
   de worker threads e é limitada por um semáforo (`ASSETS_3D_MAX_INFLIGHT`, default 8) para não
   estourar o heap.
2. **Filesystem** (fallback): stream via `createReadStream` (sem semáforo — o stream não materializa o
   arquivo na memória).

Ambos expõem o **mesmo contrato HTTP** (ETag/304/Range/`immutable`/Content-Type). O cliente não
percebe a diferença. A carga do store SQLite é feita por CLI no servidor (`node
scripts/assets3d-import.js <dir>`).

---

## Tratamento de erros

| Status | Quando | Ação no frontend |
|--------|--------|------------------|
| `200` | Asset servido (inteiro) | Usar normalmente |
| `206` | Asset servido (Range) | Montar o slice (Cesium faz automaticamente) |
| `304` | `If-None-Match` bateu | Usar a cópia em cache |
| `403` | Caminho que escapa da raiz dos assets após a normalização (raro/quase inalcançável) | Bug de montagem de URL — revisar concatenação |
| `404` | Asset inexistente | Catálogo aponta para binário ausente; logar/ocultar o modelo |
| `416` | Range inválido | Refazer a requisição sem `Range` |
| `401` | Apenas no `/catalogo3d` (descoberta) | Renovar token (ver [01 - Autenticação](./01-autenticacao.md)) |

> A rota `/assets3d/*` é pública: **não** retorna 401/403 por falta de token. Um 403 só ocorre se o
> caminho, após a normalização, escapar da raiz dos assets — a maioria das tentativas de traversal
> com `..` é colapsada para dentro da raiz e retorna 404.

---

## Checklist de Implementação

- [ ] Ler `assets3dBaseUrl` do `GET /api/config` na inicialização
- [ ] Listar modelos via `GET /api/v1/nomes/catalogo3d` (autenticado)
- [ ] Resolver `assets3dBaseUrl + m.url` para cada modelo
- [ ] Selecionar o loader do Cesium por `type`
- [ ] Aplicar `lon`/`lat`/`height`/`heightoffset` e `heading`/`pitch`/`roll`
- [ ] Aplicar `style` (`Cesium3DTileStyle`) quando presente
- [ ] Deixar o Cesium fazer as requisições `Range` aos binários
- [ ] Tratar 404 de asset ausente sem quebrar a cena

---

## Documentos Relacionados

- [10 - Config](./10-config.md) - `GET /api/config`, `assets3dBaseUrl` e URLs de terrain por ambiente
- [13 - Nomes Geográficos](./13-nomes-geograficos.md) - Descoberta completa (busca, paginação, filtro de acesso por modelo)
- [../deploy/deploy.md](../deploy/deploy.md) - Stores/volumes de assets 3D, carga de dados e env vars
