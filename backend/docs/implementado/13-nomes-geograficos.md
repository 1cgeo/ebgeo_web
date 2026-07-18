# 13 - Nomes Geográficos (Gazetteer)

Este documento cobre o subsistema de **referência geográfica** (gazetteer) do backend: busca de
topônimos, clique em edificação 3D e catálogo de modelos 3D. É um módulo **read-only** (a carga de
dados é externa, via job FME) construído sobre PostGIS no schema isolado `ng`.

---

## Visão Geral

O gazetteer entrega ao frontend três capacidades:

- **`GET /api/v1/nomes/busca`** — autocomplete de topônimos com ranking de 7 critérios (até 5
  resultados, deduplicados por cluster).
- **`GET /api/v1/nomes/feicoes`** — identifica a edificação 3D sob um clique (lat/lon + altitude),
  com desempate por altitude.
- **`GET /api/v1/nomes/catalogo3d`** — lista paginada de modelos 3D com full-text em português.

Pontos importantes para quem integra:

- **Não há rotas de escrita.** O dado é carregado por um job externo (FME). O usuário nunca edita
  nomes pela API.
- **Sem CRDT / sem WebSocket.** Este módulo é totalmente separado do sync do atlas (docs
  [03](./03-sync-inicial.md) e [04](./04-websocket-collab.md)). Não há `version`, snapshot nem
  broadcast.
- **Contratos de resposta congelados.** `/busca` responde um **array nu** (sem o envelope `{ data }`
  usado no resto da API) e `/catalogo3d` responde um envelope próprio `{ total, page, nr_records, data }`.
- **Acesso filtrado por usuário.** O que cada usuário enxerga depende de zonas/permissões — o filtro
  é embutido no SQL (defesa em profundidade). Ver doc [15](./15-acesso-geografico.md) para o detalhe;
  aqui basta saber que registros privados só aparecem para quem tem direito.

> **Autenticação.** `/feicoes` e `/catalogo3d` exigem `Authorization: Bearer <accessToken>` (`auth`
> estrito) — sem token, `401`. Já `/busca` é o caminho do campo de busca do mapa
> (o cliente deriva a rota da base da API — não há mais `config.search.apiUrl`) e **NÃO** usa `auth` estrito: funciona anônimo (o `flexibleAuth` global
> popula `req.user` se houver credencial; sem ela, o filtro de acesso embutido no SQL — `$5 userId`
> nulo — devolve apenas registros públicos).

---

## 1. Busca de Topônimos

Autocomplete de nomes geográficos. Use para um campo de pesquisa no mapa (o usuário digita, você
consulta e exibe até 5 sugestões já ranqueadas).

### Endpoint

`GET /api/v1/nomes/busca`

### Headers

`Authorization: Bearer <accessToken>` (**opcional** — esta rota aceita o caminho anônimo; sem token,
só registros públicos)

### Query params

| Param | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `q` | string (3–200) | sim | Termo de busca. Acento é ignorado (`f_unaccent`). |
| `lat` | number | sim | Latitude do centro do mapa (para o critério de proximidade). |
| `lon` | number | sim | Longitude do centro do mapa. |
| `zoom` | int (1–20) | não | Zoom atual do mapa. Ajusta o decaimento por distância e o peso por tipo. |

### Request

```
GET /api/v1/nomes/busca?q=morro&lat=-15.78&lon=-47.92&zoom=12
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Response (200)

> **Contrato congelado**: a resposta é um **array nu** (NÃO use `{ data }`). Cada item tem
> exatamente os campos `tipo`, `nome`, `municipio`, `estado`, `longitude`, `latitude`, `score`. O
> conjunto `{tipo, nome, municipio, estado, longitude, latitude}` é o contrato estável já consumido
> pelo frontend; `score` é auxiliar (ordenação). No máximo 5 itens, já ordenados por `score` desc.

```json
[
  {
    "nome": "Morro do Cruzeiro",
    "tipo": "morro",
    "municipio": "Ouro Preto",
    "estado": "MG",
    "longitude": -43.5031,
    "latitude": -20.3855,
    "score": 0.873
  },
  {
    "nome": "Morro Redondo",
    "tipo": "morro",
    "municipio": "Pelotas",
    "estado": "RS",
    "longitude": -52.4567,
    "latitude": -31.5912,
    "score": 0.641
  }
]
```

### Como funciona o ranking (alto nível)

O `score` final é a soma ponderada de **7 critérios** (os pesos somam **1.00**):

| # | Critério | Peso | O que premia |
|---|----------|------|--------------|
| 1 | Match exato | 0.20 | Nome igual ao termo (sem acento). |
| 2 | Prefixo | 0.10 | Nome começa com o termo. |
| 3 | Contém | 0.15 | Nome contém o termo. |
| 4 | Similaridade trigram | 0.10 | Proximidade fuzzy (tolera erros de digitação). |
| 5 | Precisão por comprimento | 0.15 | Penaliza nomes muito mais longos que o termo. |
| 6 | Tipo ajustado por zoom | 0.10 | Em zoom baixo, prioriza feições "importantes" (cidade > escola); em zoom alto, neutraliza. |
| 7 | Proximidade com decaimento | 0.20 | Premia quem está perto do centro do mapa. |

- **Decaimento por zoom:** o raio de relevância é `50000 * 2^(10 - zoom)` metros — zoom 10 ≈ 50 km
  (padrão), zoom 16 ≈ 780 m, zoom 4 ≈ 3.200 km. Sem `zoom`, o backend usa 50 km e desliga o ajuste
  por tipo. Em zoom alto, "perto vence" mesmo que seja uma feição pequena.
- **Deduplicação:** o mesmo topônimo registrado várias vezes (em folhas vizinhas) é agrupado por
  cluster — a busca retorna **uma linha por feição real** (a mais próxima do clique).

> **Para o frontend:** sempre envie `lat`/`lon` (e idealmente `zoom`) refletindo o estado atual do
> mapa. Sem isso, a proximidade fica neutra e os resultados ficam menos úteis. O `score` não precisa
> ser exibido — sirva para confiar na ordem dos itens.

### Fluxo

```
Frontend (campo de busca)            Backend
   |                                    |
   [usuário digita "morro"]             |
   |-- GET /nomes/busca?q=morro --------|
   |   &lat=-15.78&lon=-47.92&zoom=12   |
   |   Authorization: Bearer token      |
   |                                    |  [trgm pre-filtro > 0.25]
   |                                    |  [filtro de acesso embutido no SQL]
   |                                    |  [score 7 criterios + dedup]
   |<-- 200 [ {nome,tipo,...,score} ] --|
   |                                    |
   [exibe ate 5 sugestoes]              |
```

### SQL de referência (contrato congelado)

> **Contrato congelado / não alterar pesos.** O bloco de score abaixo foi portado **verbatim** do
> serviço de origem; os pesos somam 1.00 e são fixos. Qualquer alteração muda a ordenação que o
> frontend já espera — só com teste de regressão contra dados reais. A única extensão por-design é o
> **filtro de acesso** embutido na CTE `candidatos` (ramo `access_level = 'public' OR ...`), descrito
> no doc [15](./15-acesso-geografico.md).

```sql
-- $1 = termo (q), $2 = lat, $3 = lon, $4 = zoom (int, nullable), $5 = userId (uuid|null)
WITH q AS (
  SELECT ng.f_unaccent($1) AS term,
    CASE WHEN $4::int IS NOT NULL THEN 50000.0 * power(2, 10 - $4::int) ELSE 50000.0 END AS decay_dist,
    CASE WHEN $4::int IS NOT NULL THEN GREATEST(0.0, LEAST(($4::int - 4.0)/14.0, 1.0)) ELSE 0.0 END AS zoom_factor
),
candidatos AS (
  SELECT n.nome, n.tipo, n.municipio, n.estado, n.geom, n.tipo_peso, n.cluster_id,
    ng.f_unaccent(n.nome) AS nome_clean,
    similarity(ng.f_unaccent(n.nome), q.term) AS sim,
    ST_Distance(n.geom::geography, ST_SetSRID(ST_MakePoint($3, $2), 4674)::geography) AS dist
  FROM ng.nomes_geograficos n, q
  WHERE similarity(ng.f_unaccent(n.nome), q.term) > 0.25       -- pre-filtro trgm
    AND ( n.access_level = 'public'                            -- filtro de acesso (defesa em profundidade)
          OR ($5::uuid IS NOT NULL AND (
                EXISTS (SELECT 1 FROM users WHERE id = $5 AND role = 'admin')
                OR EXISTS (SELECT 1 FROM ng.fn_user_zone_geoms($5) uz WHERE ST_Contains(uz.geom, n.geom))
          )) )
  ORDER BY sim DESC, dist ASC
  LIMIT 500                                                    -- top-500 candidatos
),
dedup AS (
  SELECT DISTINCT ON (nome, tipo, cluster_id)
    nome, tipo, municipio, estado, sim, dist, tipo_peso, nome_clean,
    ST_X(geom) AS longitude, ST_Y(geom) AS latitude
  FROM candidatos
  ORDER BY nome, tipo, cluster_id, dist ASC                    -- uma linha por feicao real
),
q_ref AS (SELECT term, decay_dist, zoom_factor FROM q)
SELECT d.nome, d.tipo, d.municipio, d.estado, d.longitude, d.latitude,
  (
      CASE WHEN lower(d.nome_clean) = lower(q_ref.term)              THEN 1.0 ELSE 0.0 END * 0.20  -- 1 exato
    + CASE WHEN lower(d.nome_clean) LIKE lower(q_ref.term)||'%'      THEN 1.0 ELSE 0.0 END * 0.10  -- 2 prefixo
    + CASE WHEN lower(d.nome_clean) LIKE '%'||lower(q_ref.term)||'%' THEN 1.0 ELSE 0.0 END * 0.15  -- 3 contem
    + d.sim * 0.10                                                                                 -- 4 similaridade trgm
    + (1.0 - abs(length(q_ref.term) - length(d.nome_clean))::float
            / GREATEST(length(q_ref.term), length(d.nome_clean), 1)) * 0.15                        -- 5 precisao (comprimento)
    + (COALESCE(d.tipo_peso,0.1) * (1.0 - q_ref.zoom_factor) + 0.5 * q_ref.zoom_factor) * 0.10     -- 6 tipo ajustado por zoom
    + (1.0 / (1.0 + d.dist / q_ref.decay_dist)) * 0.20                                             -- 7 proximidade c/ decaimento
  ) AS score
FROM dedup d, q_ref
ORDER BY score DESC
LIMIT 5;
```

### Tratamento de erros

> Esta rota **não** usa `auth` estrito (aceita o caminho anônimo), então não há `401` por token
> ausente. Sem credencial, o filtro embutido no SQL devolve apenas registros públicos.

| Código | Quando | Corpo |
|--------|--------|-------|
| `422` | `q` ausente ou < 3 chars; `lat`/`lon` ausentes; `zoom` fora de 1–20 | `{ "error": { "code": "VALIDATION_ERROR", "message": "Validation failed", "details": [...] } }` |

```javascript
async function buscarTopo(q, { lat, lon, zoom }) {
  const params = new URLSearchParams({ q, lat, lon });
  if (zoom != null) params.set('zoom', String(zoom));

  const res = await fetch(`/api/v1/nomes/busca?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (res.status === 422) return [];      // termo curto demais, etc.
  if (!res.ok) throw new Error('busca falhou');

  return res.json(); // ARRAY nu de ate 5 itens (sem { data })
}
```

---

## 2. Clique em Edificação 3D

Dado um clique no modelo 3D (uma coordenada + altitude), identifica a edificação correspondente.
Usado para mostrar atributos do prédio que o usuário clicou na cena 3D.

### Endpoint

`GET /api/v1/nomes/feicoes`

### Headers

`Authorization: Bearer <accessToken>`

### Query params

| Param | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `lat` | number | sim | Latitude do clique. |
| `lon` | number | sim | Longitude do clique. |
| `z` | number | sim | Altitude do clique (usada para desempatar entre prédios sobrepostos). |

### Request

```
GET /api/v1/nomes/feicoes?lat=-22.9068&lon=-43.1729&z=15
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Response (200) — edificação encontrada

```json
{
  "id": "a3f1c8e0-1234-4abc-9def-0123456789ab",
  "nome": "Edifício Central",
  "municipio": "Rio de Janeiro",
  "estado": "RJ",
  "tipo": "edificacao",
  "altitude_base": 0,
  "altitude_topo": 42,
  "z_distance": 0,
  "xy_distance": 1.27
}
```

| Campo | Descrição |
|-------|-----------|
| `z_distance` | `0` se `z` está dentro da faixa `[altitude_base, altitude_topo]`; caso contrário a distância vertical até a faixa. Usado para desempatar prédios empilhados. |
| `xy_distance` | Distância horizontal (em metros) do clique à geometria, dentro do raio de 3 m. |

### Response (200) — nada encontrado

> **Contrato congelado**: quando não há edificação a até **3 metros** do clique, o backend responde
> **200** com um objeto `{ message }` (NÃO um array, NÃO `404`).

```json
{ "message": "Nenhuma edificação encontrada nas proximidades." }
```

### Como funciona

- Busca a edificação a no máximo **3 m** do clique (`ST_DWithin`, em metros via `geography`).
- Desempata por **altitude** primeiro (`z_distance` asc), depois por distância horizontal
  (`xy_distance` asc), retornando **uma** edificação (`LIMIT 1`).
- O filtro de acesso é embutido no SQL: edificações privadas só aparecem para admin ou para quem tem
  zona cobrindo a geometria (ver [15](./15-acesso-geografico.md)).

> **Para o frontend:** sempre cheque se a resposta tem `id` (achou) ou `message` (não achou) antes de
> renderizar. Ambos chegam como **200**.

### Tratamento de erros

| Código | Quando |
|--------|--------|
| `401` | Sem token / token inválido. |
| `422` | `lat`, `lon` ou `z` ausentes/não numéricos. |

```javascript
async function feicaoNoClique(lat, lon, z) {
  const params = new URLSearchParams({ lat, lon, z });
  const res = await fetch(`/api/v1/nomes/feicoes?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error('feicoes falhou');

  const result = await res.json();
  if (result.message) return null;   // nada encontrado (200 com { message })
  return result;                     // { id, nome, ..., z_distance, xy_distance }
}
```

---

## 3. Catálogo 3D (Full-text)

Lista paginada de modelos 3D (Tiles 3D, Modelos 3D, Nuvem de Pontos) com busca full-text em
português. Usado para o painel/galeria de modelos disponíveis.

### Endpoint

`GET /api/v1/nomes/catalogo3d`

### Headers

`Authorization: Bearer <accessToken>`

### Query params

| Param | Tipo | Obrigatório | Default | Descrição |
|-------|------|-------------|---------|-----------|
| `q` | string (≤ 200) | não | — | Termo full-text (`plainto_tsquery('portuguese', q)`). Vazio/ausente lista tudo. |
| `page` | int ≥ 1 | não | `1` | Página (1-based). |
| `nr_records` | int 1–100 | não | `10` | Itens por página. |

### Request

```
GET /api/v1/nomes/catalogo3d?q=igreja&page=1&nr_records=10
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Response (200)

> **Contrato congelado**: a resposta usa um envelope próprio `{ total, page, nr_records, data }` —
> NÃO o `{ data }` padrão da API. `total` é a contagem **respeitando o mesmo filtro de acesso** que o
> `data` (a paginação não mente sobre o que o usuário pode ver).

```json
{
  "total": 23,
  "page": 1,
  "nr_records": 10,
  "data": [
    {
      "id": "11111111-2222-3333-4444-555555555555",
      "name": "Igreja Matriz",
      "description": "Modelo 3D da igreja matriz histórica",
      "thumbnail": "https://.../igreja-matriz.png",
      "url": "https://.../tiles/igreja-matriz/tileset.json",
      "lon": -43.1822,
      "lat": -22.9133,
      "height": 12.5,
      "heading": 90,
      "pitch": 0,
      "roll": 0,
      "type": "Tiles 3D",
      "heightoffset": 0,
      "maximumscreenspaceerror": 16,
      "data_criacao": "2024-08-10T13:45:00.000Z",
      "municipio": "Rio de Janeiro",
      "estado": "RJ",
      "palavras_chave": ["igreja", "histórico", "patrimônio"],
      "style": {},
      "rank": 0
    }
  ]
}
```

| Campo do item | Descrição |
|---------------|-----------|
| `type` | `"Tiles 3D"`, `"Modelos 3D"` ou `"Nuvem de Pontos"`. |
| `url` | Endereço do recurso 3D (ex.: `tileset.json`). Pode ser servido pelos assets 3D do backend. |
| `lon/lat/height/heading/pitch/roll/heightoffset/maximumscreenspaceerror` | Posicionamento/render do modelo na cena. |
| `palavras_chave` | Array de strings (entra no full-text com peso alto). |
| `style` | JSONB livre (pode ser `{}`). |
| `rank` | Relevância do full-text (`ts_rank`). `0` quando a busca é feita sem `q`. |

### Como funciona

- Com `q`, filtra por `search_vector @@ plainto_tsquery('portuguese', q)` e ordena por
  `ts_rank(...) DESC, data_criacao DESC`. Sem `q`, lista tudo ordenado por `data_criacao DESC`.
- O `SELECT` paginado e o `COUNT` rodam em paralelo, **com o mesmo predicado de acesso** — um modelo
  privado só aparece (e só é contado) para admin ou para quem tem permissão direta/por-grupo sobre
  aquele modelo (ver [15](./15-acesso-geografico.md)).

> **Para o frontend:** o `page` é **1-based** na API. Se a sua UI usa página 0-based, some 1 antes de
> enviar. Use `total` + `nr_records` para calcular o número de páginas.

### Tratamento de erros

| Código | Quando |
|--------|--------|
| `401` | Sem token / token inválido. |
| `422` | `page` < 1, `nr_records` fora de 1–100, ou `q` > 200 chars. |

```javascript
async function listarCatalogo3d({ q = '', page = 1, nr_records = 10 } = {}) {
  const params = new URLSearchParams({ page, nr_records });
  if (q) params.set('q', q);

  const res = await fetch(`/api/v1/nomes/catalogo3d?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error('catalogo3d falhou');

  const { total, page: p, nr_records: n, data } = await res.json();
  const totalPaginas = Math.ceil(total / n);
  return { itens: data, total, page: p, nr_records: n, totalPaginas };
}
```

---

## 4. Acesso Filtrado (resumo)

As três rotas embutem a autorização **no próprio SQL** (defesa em profundidade — o dado não vaza nem
com bug na camada de aplicação):

- `nomes_geograficos` e `edificacoes` têm `access_level` (`public`/`private`). Um privado só aparece
  para **admin**, ou quando sua geometria está **dentro de uma zona** do usuário.
- `catalogo_3d` tem `access_level` por modelo; um privado só aparece para **admin** ou para quem tem
  **permissão direta/por-grupo** sobre o modelo.
- Usuário sem zonas/permissões enxerga apenas o conteúdo **público** — sem regressão (o default é
  `public`).

O detalhe (zonas, permissões de modelo, CRUD de zonas) está no doc
[15 - Acesso Geográfico](./15-acesso-geografico.md).

---

## 5. Nota Operacional — Carga de Dados (FME)

A carga de dados é externa (job FME) e **não** passa pela API. Depois de **cada carga** de nomes, é
**obrigatório** rodar:

```sql
SELECT ng.refresh_busca();
```

Essa função recalcula os pesos por tipo (`tipo_peso`) e os clusters de deduplicação (DBSCAN). A carga
em massa (`COPY`) **não dispara** os triggers que preenchem esses campos — esquecer este passo deixa
`cluster_id`/`tipo_peso` nulos e **degrada a busca silenciosamente, sem erro** (ranking ruim,
duplicatas no resultado). Detalhes de operação no [guia de deploy](../deploy/deploy.md).

---

## Checklist de Implementação

- [ ] Campo de busca chamando `/nomes/busca` com `q`, `lat`, `lon` e (idealmente) `zoom` do mapa
- [ ] Tratar a resposta de `/busca` como **array nu** (sem `{ data }`)
- [ ] Exibir até 5 sugestões na ordem retornada (não reordenar)
- [ ] Clique 3D chamando `/nomes/feicoes` com `lat`, `lon`, `z`
- [ ] Distinguir `{ id, ... }` (achou) de `{ message }` (não achou) — ambos chegam como **200**
- [ ] Galeria/painel 3D consumindo `/nomes/catalogo3d` com paginação 1-based
- [ ] Usar `total` + `nr_records` para o controle de páginas
- [ ] Tratar `401` (re-login/refresh) em `/feicoes` e `/catalogo3d` (`/busca` é anônimo) e `422` (validação) nas três rotas
- [ ] Não assumir que todos os registros são visíveis — o acesso é filtrado por usuário

---

## Próximo Documento

[14 - Catálogo 3D e Assets](./14-catalogo3d-assets.md) - Metadados de modelos 3D e distribuição de tilesets/b3dm/glb
</content>
</invoke>
