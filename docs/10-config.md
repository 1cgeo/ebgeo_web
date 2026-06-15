# Configuração da Aplicação (`config.js`) — Cobertura pelo Backend

Este documento mapeia o arquivo de configuração global do frontend
(`ebgeo_web/src/js/config.js`) contra o que o **EBGeo Backend** já oferece, e
descreve o que falta para que o backend possa **servir essa configuração de
forma centralizada** — permitindo que um administrador configure basemaps,
camadas, tilesets e parâmetros do mapa sem editar um arquivo `.js` e fazer
redeploy do frontend.

> **Análoga a [`acoes-interface-multiusuario.md`](../../ebgeo_web/docs/acoes-interface-multiusuario.md):**
> assim como aquele documento cruza as **ações da interface** com o sistema
> multiusuário, este cruza a **configuração estática** com o backend.

---

## Constraint Fundamental

> A aplicação DEVE funcionar identicamente para usuários **não autenticados**.
> O backend é aditivo.

Isso tem uma consequência direta para a substituição do `config.js`:

- A configuração precisa estar disponível **sem autenticação** (modo offline /
  público), ou o frontend mantém o `config.js` local como **fallback**.
- Hoje `GET /api/v1/resources` exige `Auth: Sim` (permissão `User`) — ou seja,
  **não serve** o caso não autenticado. Ver [Gaps](#gaps-e-proposta-de-implementação).

O modelo recomendado é **híbrido**:
1. Frontend embarca um `config.js` mínimo (defaults de deploy).
2. Se houver backend, faz *merge* da configuração remota por cima dos defaults.

---

## Legenda de Status

- ✅ **Coberto** — Já existe suporte no backend (tabela `resources`).
- 🟡 **Parcial** — Há estrutura, mas falta schema/seed/endpoint para cobrir 100%.
- 🔴 **Gap** — Não há suporte; requer nova categoria, endpoint ou tabela.
- 🟢 **Local** — Faz sentido permanecer no frontend (config de build/deploy).

---

## Onde o backend já encaixa: tabela `resources`

A tabela `resources` (migração `003_sync.sql`) é o ponto de extensão natural
para o catálogo do `config.js`:

```sql
CREATE TABLE resources (
  id          VARCHAR(100) PRIMARY KEY,
  category    VARCHAR(50) NOT NULL,   -- ver enum abaixo
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  config      JSONB DEFAULT '{}',     -- payload livre (urls, paint, options...)
  active      BOOLEAN DEFAULT true,   -- ↔ `enabled` do config.js
  sort_order  INTEGER DEFAULT 0,      -- ↔ `priority` do config.js
  created_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ
);
```

**Categorias válidas (CHECK):**
`basemap`, `analysis_layer`, `data_layer`, `tileset`, `streetview_marker`

**Seed atual (003_sync.sql):** 5 basemaps, 1 `analysis_layer` (hillshade),
1 `tileset` (PCL). **Atenção:** o seed grava apenas `id`, `category`, `name` e
`sort_order` — o campo `config` (JSONB) fica **vazio**, então URLs, `paint`,
`options` etc. ainda **não** estão persistidos.

| `config.js` (frontend) | Campo em `resources` |
|------------------------|----------------------|
| `enabled`              | `active`             |
| `name`                 | `name`               |
| `priority`             | `sort_order`         |
| `image` / `description`| `description` ou `config` |
| restante (url, source, style, paint, options, locate, ...) | `config` (JSONB) |

---

## Análise Seção a Seção do `config.js`

### 1. `app` — Identidade da aplicação

| Chave | O que é | Backend hoje | Status |
|-------|---------|--------------|--------|
| `app.title` | Título exibido na interface ("EBGeo") | — | 🔴 Gap (config global) |
| `app.tutorialUrl` | URL do tutorial (`./docs/doc.html`) | — | 🟢 Local (asset do deploy) |

### 2. `features` — Feature flags

| Chave | O que é | Backend hoje | Status |
|-------|---------|--------------|--------|
| `features.map_3d` | Habilita visualizador 3D | — | 🔴 Gap (config global) |
| `features.imagens_panoramicas` | Habilita Street View 360 | — | 🔴 Gap (config global) |
| `features.apisearch` | Habilita busca via API externa | — | 🔴 Gap (config global) |
| `features.grid` | Habilita grid | — | 🔴 Gap (config global) |

> Feature flags são **globais por deployment**. Não cabem em `resources`
> (que é catálogo de itens) — pedem um endpoint/registro de **config global**.

### 3. `services` e `search` — URLs de serviços externos

| Chave | O que é | Backend hoje | Status |
|-------|---------|--------------|--------|
| `services.tileServerUrl` | Servidor de tiles vetoriais | — | 🟢 Local / 🔴 Gap (config global) |
| `search.apiUrl` | API de busca de feições | — | 🟢 Local / 🔴 Gap (config global) |

> URLs de infraestrutura geralmente variam por **ambiente** (dev/prod), então o
> mais robusto é mantê-las como config de deploy do frontend. Se forem servidas
> pelo backend, devem entrar no registro de config global.

### 4. `basemaps` — Camadas base ✅

| Chave | O que é | Backend hoje | Status |
|-------|---------|--------------|--------|
| `basemaps.<id>.enabled` | Liga/desliga basemap | `resources.active` | ✅ Coberto |
| `basemaps.<id>.name` | Nome exibido | `resources.name` | ✅ Coberto |
| `basemaps.<id>.priority` | Ordem | `resources.sort_order` | ✅ Coberto |
| `basemaps.<id>.image` | Thumbnail | `resources.config.image` | 🟡 Parcial (não no seed) |

> `category = 'basemap'`. Os 5 basemaps já estão no seed. **Divergência a
> corrigir:** o seed insere `osm` e `imagens` como `active = true` (default),
> mas o `config.js` os tem com `enabled: false`.

### 5. `analysisLayers` — Camadas de análise raster 🟡

| Chave | O que é | Backend hoje | Status |
|-------|---------|--------------|--------|
| `analysisLayers.enabled` | Feature flag global da seção | — | 🔴 Gap (config global) |
| `analysisLayers.layers[]` | DEM, declive, etc. (id, source, bounds, paint, legend) | `category = 'analysis_layer'` | 🟡 Parcial |

> A categoria existe e o `hillshade` está no seed (porém em `map2d`, não nesta
> lista — ver §8). O payload completo (`source`, `bounds`, `paint`, `legend`)
> precisa ir para `resources.config`. A lista vem vazia por padrão no `config.js`.

### 6. `dataLayers` — Camadas de dados vetoriais (molduras, etc.) 🟡

| Chave | O que é | Backend hoje | Status |
|-------|---------|--------------|--------|
| `dataLayers.enabled` | Feature flag global da seção | — | 🔴 Gap (config global) |
| `dataLayers.layers[]` | Vetoriais do catálogo "Dados" (source, sourceLayer, style.fill/border/label, labelSource, legend) | `category = 'data_layer'` | 🟡 Parcial |

> Categoria existe, **sem seed**. Toda a estrutura (incluindo expressões
> MapLibre em `style`) cabe em `resources.config` (JSONB). Lista vazia por padrão.

### 7. `map2d` — Configuração do mapa 2D 🔴/🟡

| Chave | O que é | Backend hoje | Status |
|-------|---------|--------------|--------|
| `map2d.bounds` | Extensão geográfica inicial | — | 🔴 Gap (config global) |
| `map2d.minZoom` / `maxZoom` / `maxPitch` | Limites de navegação | — | 🔴 Gap (config global) |
| `map2d.globe_projection` | Modo globo | — | 🔴 Gap (config global) |
| `map2d.sourceTileLodParams` | Otimização de tiles | — | 🔴 Gap (config global) |
| `map2d.maxBounds` | Limites geográficos (opcional) | — | 🔴 Gap (config global) |
| `map2d.terrainSource` | Source de elevação/terreno | — | 🔴 Gap (config global) |
| `map2d.hillshadeSource` | Source de sombreamento | — | 🔴 Gap (config global) |
| `map2d.hillshade` | Camada de sombreamento (enabled, paint, layout) | `analysis_layer` (`hillshade` no seed) | 🟡 Parcial |

> Os defaults do mapa 2D são **config global** (não catálogo). Apenas a *camada*
> `hillshade` se encaixa em `resources` (`analysis_layer`); os `*Source` e os
> limites de viewport precisam do registro de config global.

### 8. `map3d` — Configuração do Cesium 🔴

| Chave | O que é | Backend hoje | Status |
|-------|---------|--------------|--------|
| `map3d.bounds` | Visão inicial do Cesium | — | 🔴 Gap (config global) |
| `map3d.viewer` | UI do viewer (infoBox, geocoder, timeline, ...) | — | 🔴 Gap (config global) |
| `map3d.providers.imagery` | Provedor de imagery | — | 🔴 Gap (config global) |
| `map3d.providers.terrain` | Provedor de terreno | — | 🔴 Gap (config global) |

> Toda a seção `map3d` é **config global** do viewer 3D. Não cabe em `resources`.

### 9. `tilesets` — Modelos 3D (3D Tiles e GLB) ✅

| Chave | O que é | Backend hoje | Status |
|-------|---------|--------------|--------|
| `tilesets[].id` / `name` / `description` | Identificação | `resources.id/name/description` | ✅ Coberto |
| `tilesets[].url` / `heightOffset` / `locate` | 3D Tiles | `resources.config` | 🟡 Parcial (não no seed) |
| `tilesets[].type = 'glb'` + `position`/`rotation`/`scale`/`maximumScale` | Modelos GLB | `resources.config` | 🟡 Parcial (sem seed GLB) |
| `keywords`, `data_captura`, `local`, `previewVideo`, `previewThumbnail` | Metadados | `resources.config` | 🟡 Parcial |

> `category = 'tileset'`. `PCL` (3D Tiles) está no seed; o GLB de exemplo
> (`hangar-01`) **não**. Todo o payload específico vai para `resources.config`.

### 10. `streetView360` — Serviço de panoramas 🔴

| Chave | O que é | Backend hoje | Status |
|-------|---------|--------------|--------|
| `streetView360.serviceUrl` | API de panoramas (UUID + loading progressivo) | — | 🟢 Local / 🔴 Gap (config global) |
| `streetView360.pointsSource` / `pointsSourceLayer` | PMTiles de pontos | — | 🔴 Gap (config global) |
| `streetView360.linesSource` / `linesSourceLayer` | PMTiles de linhas | — | 🔴 Gap (config global) |

> A categoria `streetview_marker` existe em `resources`, mas se refere a
> **marcadores** (dado de usuário, sincronizado via entidade `streetview360`),
> **não** a esta config de serviço. Esta seção é **config global** de serviço.

---

## Resumo de Cobertura

| Seção `config.js` | Natureza | Mecanismo no backend | Status |
|-------------------|----------|----------------------|--------|
| `app` | Global | Config global (gap) | 🔴 |
| `features` | Global | Config global (gap) | 🔴 |
| `services` / `search` | Ambiente | Local ou config global | 🟢/🔴 |
| `basemaps` | Catálogo | `resources` (`basemap`) | ✅ |
| `analysisLayers` | Catálogo | `resources` (`analysis_layer`) | 🟡 |
| `dataLayers` | Catálogo | `resources` (`data_layer`) | 🟡 |
| `map2d` | Global (+ hillshade catálogo) | Config global + `resources` | 🔴/🟡 |
| `map3d` | Global | Config global (gap) | 🔴 |
| `tilesets` | Catálogo | `resources` (`tileset`) | ✅ |
| `streetView360` | Ambiente/serviço | Local ou config global | 🔴 |

**Conclusão:** o backend já cobre o **catálogo** (basemaps, camadas, tilesets)
via `resources`, mas falta (a) **popular o `config` JSONB** desses recursos e
(b) um mecanismo para a **configuração global** da aplicação (feature flags,
defaults de mapa 2D/3D, viewer Cesium, URLs de serviço).

---

## Gaps e Proposta de Implementação

### Gap 1 — Acesso não autenticado

`GET /api/v1/resources` e o novo endpoint de config precisam de uma variante
**pública** (sem JWT) para honrar a constraint de funcionamento offline/anônimo.
Opções: rota pública dedicada, ou o frontend usa `config.js` local como fallback
e só faz *merge* da config remota quando autenticado.

### Gap 2 — Popular `resources.config`

O seed atual grava apenas `id`/`name`/`sort_order`. É preciso uma migração (ou
seed) que preencha `config` (JSONB) com URLs, `source`, `paint`, `options`,
`locate`, etc., para cada basemap/tileset/camada — e alinhar `active` com o
`enabled` do `config.js` (corrigir `osm`/`imagens`).

### Gap 3 — Registro de Configuração Global

Criar um lugar para a config **não-catálogo**. Duas abordagens:

- **A) Nova categoria `app_config`** em `resources` (reaproveita tabela/CRUD):
  cada bloco (`app`, `features`, `map2d`, `map3d`, ...) vira uma linha com o
  payload em `config`. Exige relaxar o `CHECK` da coluna `category`.
- **B) Tabela/endpoint dedicado** `GET /api/v1/config`: retorna o objeto de
  config global montado (mais próximo do formato que o frontend consome).

### Gap 4 — Escopo: global vs por-atlas

Decidir se a config é **global do servidor** (um EBGeo = um conjunto de basemaps/
tilesets) ou **sobrescrevível por atlas**. O `config.js` é hoje global; manter
global é o caminho mais simples e compatível.

### Esboço de endpoint sugerido

```http
GET /api/v1/config            # público; monta o objeto estilo config.js
GET /api/v1/resources?category=basemap   # catálogo (já existe; tornar público)
```

Resposta de `GET /config` reconstruída a partir de `resources` + config global:

```jsonc
{
  "app":      { "title": "EBGeo" },
  "features": { "map_3d": true, "imagens_panoramicas": true, ... },
  "basemaps": { /* derivado de resources category=basemap */ },
  "tilesets": [ /* derivado de resources category=tileset */ ],
  "map2d":    { /* config global */ },
  "map3d":    { /* config global */ }
}
```

---

## Checklist de Implementação

- [ ] Tornar o catálogo (`/resources` e/ou `/config`) acessível **sem auth**
- [ ] Migração para popular `resources.config` (basemaps, tilesets, camadas)
- [ ] Alinhar `active` ↔ `enabled` (corrigir `osm`/`imagens` no seed)
- [ ] Definir mecanismo de **config global** (categoria `app_config` ou `/config`)
- [ ] Endpoint `GET /api/v1/config` montando o objeto no formato do frontend
- [ ] Frontend: *merge* da config remota sobre o `config.js` local (fallback)
- [ ] Admin UI / CRUD para basemaps, tilesets e camadas (já há `POST/PUT/DELETE /resources`)
- [ ] Decidir escopo: global do servidor vs sobrescrita por atlas
</content>
</invoke>
