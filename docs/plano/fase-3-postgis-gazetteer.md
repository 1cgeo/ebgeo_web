# Fase 3 — PostGIS + Gazetteer: busca de nomes geográficos

> **✅ STATUS: IMPLEMENTADA.** Migração `011_postgis_ng.sql` (PostGIS + schema `ng` + 3 tabelas +
> `f_unaccent` + triggers `tipo_peso`/`search_vector` + `recomputar_clusters`/`refresh_busca`). Módulo
> `src/modules/nomes` (`/busca` 7 critérios VERBATIM, `/feicoes` ST_DWithin, `/catalogo3d` full-text) sob
> auth de leitura + `nomes-access-log`. Contratos congelados (`/busca` array nu, `/catalogo3d` envelope
> próprio). PostGIS é untrusted → `run-tests.js` pré-cria via superusuário (`SUPERUSER_DATABASE_URL`);
> em prod/CI a imagem `postgis/postgis` habilita em `template1`. Suite verde (604 casos).
> Tarefa 7 (rewrite NGINX) = fase-7. PDF Python/GDAL = descartado (não entra no Node).
> **Depende de:** fase-0 (hardening). **Esforço:** Alto. **Pode rodar em paralelo** com fase-1, fase-2, fase-5.
> **Leia antes:** [`_padroes.md`](_padroes.md) e [`00-visao-geral.md`](00-visao-geral.md).

---

## 1. Objetivo e contexto

Habilitar **PostGIS** no banco do backend e absorver o serviço `servico_nomes_geograficos`
(`1cgeo/servico_nomes_geograficos`, **`origin/main`**) como um **módulo read-only** do backend único,
no schema isolado **`ng`**, coexistindo com o JSONB do atlas.

Três capacidades entram (todas read-only, sob auth de leitura):

1. **Busca de topônimos** (`GET /api/v1/nomes/busca`): autocomplete com ranking de **7 critérios**,
   dado termo + centro (lat/lon) + zoom.
2. **Clique em feição 3D** (`GET /api/v1/nomes/feicoes`): dado (lat, lon, z), identifica a edificação
   clicada (desempate por altitude).
3. **Catálogo 3D** (`GET /api/v1/nomes/catalogo3d`): lista paginada com full-text PT-BR dos modelos/tiles 3D.

**Princípio central:** nomes geográficos são **dado de referência read-only**. O usuário nunca edita
nomes pelo app; a carga é externa (job FME). Logo: **sem CRDT, sem versão por feição, sem geometria
JSONB, sem broadcast WS.** Este módulo vive totalmente fora do mundo colaborativo/JSONB do atlas.

### Proveniência — CRÍTICO

Portar **sempre de `origin/main`**, nunca do working tree local do clone. O HEAD local
(`74d4a95`) está 2 commits atrás e contém a busca **antiga de 2 critérios**. O material correto
(busca de 7 critérios, `unaccent`, `cluster_id`, `tipo_peso`) está em `origin/main` (commits
`010cbb0 melhoria busca de nomes` + `5bc5a5c fix peso`). O `src_python/` (PDF Flask/GDAL) foi
**removido** no origin. O `criterio_busca.md` está **desatualizado** (descreve 6 critérios) — o
código manda. **Todo o SQL/contrato necessário está embutido verbatim neste documento** (seções 4 e
nas tarefas), então um agente não precisa do repositório original para implementar.

---

## 2. Pré-requisitos e dependências

- **fase-0 concluída.** Especificamente: `validateEnvVariables()` fail-fast no boot, helmet/CORS,
  rate limit, e o middleware de `auth` endurecido. Este módulo reusa o `auth` existente.
- **PostGIS disponível no servidor PostgreSQL** (extensão instalada no SO/imagem). Em Docker, usar
  imagem `postgis/postgis:16-3.4` (ou superior) no lugar de `postgres:16` — registrar isto no
  `docker-compose`/CI da fase-0 ou aqui (Tarefa 1). Sem o binário PostGIS instalado,
  `CREATE EXTENSION postgis` falha.
- Nenhuma dependência de fase-1/2/5. **A fase-4 (catálogo 3D + assets) depende desta fase** — ela
  estende `ng.catalogo_3d` e passa a servir os binários; aqui só criamos a tabela e a rota de leitura.
- **A fase-6 (acesso geográfico) depende desta fase** — adiciona controle de acesso por zona
  (`ST_Contains`) sobre `ng.nomes_geograficos`. Aqui a busca é liberada a qualquer autenticado.

**Baseline de código verificado (fonte de verdade):**

- `src/database/migrations/001_core.sql:7` cria **apenas** `pgcrypto`. Nenhuma migração cria PostGIS,
  schema `ng`, nem as tabelas de nomes.
- `002_atlas.sql:150-152` declara explicitamente *"No PostGIS dependency"*; `features.geometry` é
  **JSONB** (`002_atlas.sql:162`). PostGIS é **aditivo** — não exige converter o atlas; as extensões
  são independentes e coexistem no mesmo banco em schemas separados.
- `pg-promise` é 100% compatível com PostGIS **sem troca de driver**.
- Migração head atual = `005_client_id_text.sql`. As migrações desta fase começam em **`006_`**
  (mas ver a ordem global de migração em `_padroes.md` §7 — coordene a numeração com as outras fases
  ao mesclar; aqui usamos `006_`/`007_` como placeholders, renumere se outra fase já ocupou o slot).
- `src/database/migrate.js` roda cada arquivo `.sql` em uma transação, em ordem alfabética, com
  tracking em `_migrations`. Runner é aditivo e idempotente a nível de tracking.

---

## 3. Decisões de arquitetura aplicáveis

| # | Decisão | Aplicação nesta fase |
|---|---------|----------------------|
| **Schemas isolados** (`00` §3) | JSONB (atlas) vs PostGIS (`ng`) não se misturam | Tudo cai no schema `ng`. Nenhuma FK entre `ng.*` e tabelas do atlas. |
| **Aditivo** (`00` §5) | Nenhuma fase quebra o caminho anônimo nem o contrato do frontend | Adicionar PostGIS não toca o atlas. O contrato de busca do `ebgeo_web` é **congelado** (§5). |
| **`gen_random_uuid()`** (`_padroes` §7) | Padronizar PK UUID via pgcrypto | Trocar qualquer `uuid_generate_v4()`/`uuid-ossp` do origin por `gen_random_uuid()`. **Não** criar a extensão `uuid-ossp`. |
| **SRID explícito** (`_padroes` §7) | `GEOMETRY(POINT,4674)` para nomes; distâncias via `::geography` | **SRID misto** mantido e documentado: nomes = **4674** (SIRGAS 2000); edificações/clique = **4326**. Não unificar — o dado de origem é assim. |
| **Sem GRANTs hardcoded** | O serviço original dava `GRANT ... TO user_nomes_geograficos` | **Remover** os GRANTs. O backend conecta com seu próprio role (via `DATABASE_URL`), dono do schema. |
| **Auth de leitura** | Serviço original não tinha auth | Tudo sob o middleware `auth` (qualquer autenticado lê). Log de acesso por IP para auditoria (Tarefa 6). |
| **Read-only / sem broadcast** | Não é estado colaborativo | Controllers **não** fazem broadcast WS. Não há rota de escrita pela API (carga via FME). |

### Decisão aberta — coluna gerada vs índice funcional para o `f_unaccent`

O `origin/main` usa um **índice funcional** `GIN(ng.f_unaccent(nome) gin_trgm_ops)` com o wrapper
`f_unaccent` IMMUTABLE. O `IDEIAS-EBGEO-WEB-2.md` (item 6) sugere a alternativa de uma **coluna
gerada** `nome_unaccent TEXT GENERATED ALWAYS AS (ng.f_unaccent(lower(nome))) STORED` + GIN sobre ela.

- **Ramo A (recomendado): índice funcional** — fiel ao `origin/main`, **a query da busca usa
  `ng.f_unaccent(n.nome)` diretamente** (verbatim, seção 4), então o índice funcional casa
  exatamente com a expressão da query. Zero risco de divergência com a query portada. **Adote este.**
- **Ramo B: coluna gerada** — economiza recomputar `f_unaccent` em runtime e dá um índice mais
  estável, mas **exigiria reescrever a query** para usar a coluna em vez da expressão, divergindo do
  verbatim. Só faça se houver problema de performance medido. Fora de escopo desta fase.

### Decisão aberta — endpoint PDF (Python+GDAL)

`POST /api/export-georeferenced-pdf` (Flask + GDAL + Pillow). **Já removido no `origin/main`**;
nem existe rota no `index.js` Node do serviço. **Recomendação: NÃO absorver no Node** (GDAL não roda
de forma sã em Node). Se a feature for requisito de produto, conteinerizar como **microsserviço Flask
separado** atrás do gateway sob `/api/pdf/` (com `debug=False` e CORS fechado) — escopo da fase-7,
não desta. Caso contrário, **descartar**. Esta fase não traz GDAL para o backend.

---

## 4. Material de referência embutido (verbatim — preserve)

> Estes artefatos são a **fonte de verdade** das Tarefas 2–5. Copie-os verbatim para os arquivos SQL
> / `.queries.js`. Não reescreva a lógica.

### 4.1 Wrapper `f_unaccent` (IMMUTABLE, indexável)

O `unaccent` nativo é só `STABLE`, não indexa diretamente. O wrapper força `IMMUTABLE`:

```sql
CREATE OR REPLACE FUNCTION ng.f_unaccent(text)
RETURNS text AS $$ SELECT public.unaccent('public.unaccent', $1) $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;
```

### 4.2 Busca de 7 critérios (a joia da coroa — VERBATIM)

Placeholders: `$1` = termo (`q`), `$2` = lat, `$3` = lon, `$4` = zoom (int, nullable).

```sql
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
  WHERE similarity(ng.f_unaccent(n.nome), q.term) > 0.25      -- pre-filtro trgm
  ORDER BY sim DESC, dist ASC
  LIMIT 500                                                   -- top-500 candidatos
),
dedup AS (
  SELECT DISTINCT ON (nome, tipo, cluster_id)
    nome, tipo, municipio, estado, sim, dist, tipo_peso, nome_clean,
    ST_X(geom) AS longitude, ST_Y(geom) AS latitude
  FROM candidatos
  ORDER BY nome, tipo, cluster_id, dist ASC                  -- mantem o mais proximo do cluster
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

**Os 7 critérios (somam 1.00):**

| # | Critério | Peso |
|---|----------|------|
| 1 | Match exato (`nome_clean = term`, sem acento) | 0.20 |
| 2 | Prefixo (`LIKE term%`) | 0.10 |
| 3 | Contém (`LIKE %term%`) | 0.15 |
| 4 | Similaridade trgm | 0.10 |
| 5 | Precisão por comprimento | 0.15 |
| 6 | Tipo ajustado por zoom | 0.10 |
| 7 | Proximidade com decaimento | 0.20 |

- **Decaimento por zoom:** `decay_dist = 50000 * 2^(10 - zoom)` metros. Zoom 10 = 50 km (padrão);
  zoom 4 (país) ~3.200 km; zoom 16 (bairro) ~780 m. Sem zoom: 50 km e `zoom_factor = 0`.
- **`zoom_factor` = `clamp((zoom-4)/14, 0, 1)`.** Em zoom alto neutraliza o `tipo_peso` (todos
  convergem para 0.5): o mais próximo vence, capital ou escola.
- **Dedup:** `DISTINCT ON (nome, tipo, cluster_id)` por `dist ASC` → uma linha por feição real.
- **LIMIT:** 500 candidatos → 5 finais.

### 4.3 `/feicoes` (clique 3D em edificação — VERBATIM, com a forma `ST_DWithin` do origin)

Placeholders: `$1` = lon, `$2` = lat, `$3` = z (altitude do clique).

```sql
SELECT e.id, e.nome, e.municipio, e.estado, e.tipo, e.altitude_base, e.altitude_topo,
  CASE
    WHEN $3 BETWEEN e.altitude_base AND e.altitude_topo THEN 0
    WHEN $3 < e.altitude_base THEN e.altitude_base - $3
    ELSE $3 - e.altitude_topo
  END AS z_distance,
  ST_Distance(e.geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS xy_distance
FROM ng.edificacoes e
WHERE ST_DWithin(e.geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 3)
ORDER BY z_distance ASC, xy_distance ASC
LIMIT 1;
```

- Acha a edificação a até **3 m** do clique cuja faixa de altitude melhor contém o `z`.
- `z_distance` = 0 se `z` ∈ `[altitude_base, altitude_topo]`, senão distância vertical à faixa.
- Retorna `{ id, nome, municipio, estado, tipo, altitude_base, altitude_topo, z_distance, xy_distance }`
  ou, se nada encontrado, `{ message: "Nenhuma edificação encontrada nas proximidades." }`.

### 4.4 `/catalogo3d` (full-text + paginação — VERBATIM)

Params: `q` (opcional), `page` (default 1), `nr_records` (1–100, default 10).
**`COUNT(*)` e `SELECT` em paralelo** (duas queries). `offset = (page - 1) * nr_records`.

```sql
-- COM termo de busca ($1 = q, $2 = nr_records, $3 = offset):
SELECT id, name, description, thumbnail, url, lon, lat, height, heading, pitch, roll,
       type, heightoffset, maximumscreenspaceerror, data_criacao, municipio, estado,
       palavras_chave, style
FROM ng.catalogo_3d
WHERE search_vector @@ plainto_tsquery('portuguese', $1)
ORDER BY ts_rank(search_vector, plainto_tsquery('portuguese', $1)) DESC, data_criacao DESC
LIMIT $2 OFFSET $3;

-- COUNT com termo ($1 = q):
SELECT COUNT(*)::int AS total FROM ng.catalogo_3d
WHERE search_vector @@ plainto_tsquery('portuguese', $1);

-- SEM termo ($1 = nr_records, $2 = offset):
SELECT id, name, description, thumbnail, url, lon, lat, height, heading, pitch, roll,
       type, heightoffset, maximumscreenspaceerror, data_criacao, municipio, estado,
       palavras_chave, style
FROM ng.catalogo_3d
ORDER BY data_criacao DESC
LIMIT $1 OFFSET $2;

-- COUNT sem termo:
SELECT COUNT(*)::int AS total FROM ng.catalogo_3d;
```

**Resposta (contrato):**

```json
{ "total": N, "page": P, "nr_records": K, "data": [ {
  "id","name","description","thumbnail","url","lon","lat","height","heading","pitch","roll",
  "type","heightoffset","maximumscreenspaceerror","data_criacao","municipio","estado",
  "palavras_chave","style" } ] }
```

### 4.5 `ng.recomputar_clusters()` (DBSCAN — VERBATIM)

```sql
WITH clusters AS (
  SELECT id, ST_ClusterDBSCAN(geom, eps := 0.045, minpoints := 1)
    OVER (PARTITION BY nome, tipo) AS cid
  FROM ng.nomes_geograficos
)
UPDATE ng.nomes_geograficos n SET cluster_id = c.cid FROM clusters c WHERE n.id = c.id;
```

DBSCAN com `eps := 0.045` (~5 km em graus) e `minpoints := 1`, particionado por `(nome, tipo)`:
agrupa ocorrências do mesmo topônimo próximas (mesma feição real registrada em folhas vizinhas).

### 4.6 Hierarquia de `tipo_peso` (trigger `ng.calcular_tipo_peso`)

Mapeia o `tipo` textual num peso 0.1–1.0 (`BEFORE INSERT OR UPDATE OF tipo`):

| Faixa | Tipos | Peso |
|-------|-------|------|
| Cidade | Cidade | 1.0 |
| Localidade | vila, povoado | 0.9 |
| Hidrografia maior | rio, lago, represa | 0.85 |
| Relevo/orla | serra, morro, ilha, pico, ponta, praia | 0.8 |
| Nome local | Nome local | 0.75 |
| Vias | estrada, rodovia | 0.7 |
| Hidrografia menor | arroio, canal, cachoeira | 0.6 |
| Áreas protegidas | UC (unidade de conservação), terra indígena | 0.55 |
| Agro | Agro | 0.5 |
| Infra transporte | ponte, porto, Rod (rodoviária), Aero (aeroporto) | 0.4 |
| Serviços públicos | saúde, ensino, segurança, admin | 0.35 |
| Energia | energia | 0.3 |
| Econômico | comércio, indústria, lazer | 0.25 |
| Utilidades | saneamento, comunicação, duto | 0.2 |
| Religioso | religioso, cemitério | 0.15 |
| **Default** | qualquer outro | 0.1 |

> A implementação do mapeamento é uma série de `CASE`/`WHEN ... ILIKE` sobre `NEW.tipo` que retorna o
> peso e atribui `NEW.tipo_peso`. Como os rótulos exatos de `tipo` vêm do EDGV (FME), use `ILIKE`/
> casamento por substring tolerante a acento (via `ng.f_unaccent`) e mantenha o `ELSE 0.1` final.

### 4.7 Contrato de busca CONGELADO (o `ebgeo_web` já consome — NÃO quebrar)

```
GET /busca?q=<termo>&lat=<lat>&lon=<lon>[&zoom=<1..20>]
-> array de até 5: [ { "tipo","nome","municipio","estado","longitude","latitude" } ]
```

No `origin/main` cada item também traz `score`; o conjunto base
`{tipo, nome, municipio, estado, longitude, latitude}` é **estável e obrigatório**. No backend o path
passa a ser `GET /api/v1/nomes/busca` (mesmos query params, mesmo shape de item). O NGINX faz rewrite
de `/busca` → `/api/v1/nomes/busca` durante a transição (ver Tarefa 7 / fase-7).

---

## 5. Tarefas

### Tarefa 1: Migração de extensões + schema `ng` + tabelas

**Objetivo:** consolidar `er/nomes_geograficos.sql` + `er/migration_busca_v2.sql` do `origin/main` em
uma única migração aditiva, na ordem correta de dependência, criando PostGIS, o schema `ng`, as 3
tabelas, `f_unaccent`, triggers e índices. Remover GRANTs hardcoded. Padronizar `gen_random_uuid()`.

**Arquivos afetados:**
- `src/database/migrations/006_postgis_ng.sql` (criar)

**Padrão de código:** `_padroes.md` §7 (migração estrutural: extensões + schema novo são de alto
risco, exigem ordem). Espelha o padrão de `001_core.sql:7` para `CREATE EXTENSION`.

**Implementação (ordem obrigatória dentro do arquivo):**

```sql
-- Path: src/database/migrations/006_postgis_ng.sql
-- PostGIS gazetteer (schema ng) — read-only reference data, isolated from atlas JSONB.

-- 1) Extensoes (idempotentes). pgcrypto ja existe (001); reafirmar e barato.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
-- NAO criar uuid-ossp: usamos gen_random_uuid() (pgcrypto), padrao do projeto.

-- 2) Schema
CREATE SCHEMA IF NOT EXISTS ng;

-- 3) Wrapper IMMUTABLE para indexar sem acento (unaccent nativo e so STABLE)
CREATE OR REPLACE FUNCTION ng.f_unaccent(text)
RETURNS text AS $$ SELECT public.unaccent('public.unaccent', $1) $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

-- 4) Tabela nomes_geograficos (SRID 4674 - SIRGAS 2000)
CREATE TABLE ng.nomes_geograficos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       VARCHAR(255) NOT NULL,
  municipio  VARCHAR(255),
  estado     VARCHAR(255),
  tipo       VARCHAR(255),
  cluster_id INTEGER,
  tipo_peso  FLOAT DEFAULT 0.1,
  geom       GEOMETRY(POINT, 4674) NOT NULL
);
CREATE INDEX idx_ng_geom          ON ng.nomes_geograficos USING GIST (geom);
CREATE INDEX idx_ng_nome_unaccent_trgm
  ON ng.nomes_geograficos USING GIN (ng.f_unaccent(nome) gin_trgm_ops);   -- indice FUNCIONAL
CREATE INDEX idx_ng_tipo          ON ng.nomes_geograficos (tipo);
CREATE INDEX idx_ng_cluster       ON ng.nomes_geograficos (nome, tipo, cluster_id);  -- serve o dedup
CREATE INDEX idx_ng_tipo_peso     ON ng.nomes_geograficos (tipo_peso DESC);

-- 5) Tabela edificacoes (SRID 4326 - intencionalmente diferente de nomes)
CREATE TABLE ng.edificacoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          VARCHAR(255),
  municipio     VARCHAR(255),
  estado        VARCHAR(255),
  tipo          VARCHAR(255),
  altitude_base NUMERIC,
  altitude_topo NUMERIC,
  geom          GEOMETRY(POLYGON, 4326) NOT NULL,
  CHECK (altitude_base <= altitude_topo)
);
CREATE INDEX idx_edif_geom ON ng.edificacoes USING GIST (geom);
CREATE INDEX idx_edif_alt  ON ng.edificacoes (altitude_base, altitude_topo);

-- 6) Tabela catalogo_3d (full-text PT-BR)
CREATE TABLE ng.catalogo_3d (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     VARCHAR(255) NOT NULL,
  description              TEXT,
  municipio                VARCHAR(255),
  estado                   VARCHAR(255),
  thumbnail                VARCHAR(1024),
  palavras_chave           TEXT[],
  url                      VARCHAR(1024),
  lon                      NUMERIC,
  lat                      NUMERIC,
  height                   NUMERIC,
  heading                  NUMERIC,
  pitch                    NUMERIC,
  roll                     NUMERIC,
  type                     VARCHAR(50) CHECK (type IN ('Tiles 3D','Modelos 3D','Nuvem de Pontos')),
  heightoffset             NUMERIC,
  maximumscreenspaceerror  NUMERIC,
  data_criacao             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_vector            TSVECTOR,
  style                    JSONB
);
CREATE INDEX idx_cat3d_search   ON ng.catalogo_3d USING GIN (search_vector);
CREATE INDEX idx_cat3d_criacao  ON ng.catalogo_3d (data_criacao DESC);
CREATE INDEX idx_cat3d_type     ON ng.catalogo_3d (type);
```

(continua na Tarefa 2 e Tarefa 3 com triggers e a função de refresh — pode ser tudo o mesmo arquivo
`006`, ou dividido. **Recomendação: tudo em `006_postgis_ng.sql`** para garantir ordem; as tarefas
2/3 abaixo descrevem o conteúdo restante do mesmo arquivo.)

**Critérios de aceitação:**
- [ ] `npm run db:migrate` aplica `006` sem erro num banco com PostGIS instalado.
- [ ] `\dx` lista `postgis`, `pg_trgm`, `unaccent`, `pgcrypto`. `uuid-ossp` **não** é criada.
- [ ] Schema `ng` existe com as 3 tabelas e todos os índices acima; todos os PKs default `gen_random_uuid()`.
- [ ] Nenhum `GRANT ... TO user_nomes_geograficos` no arquivo.
- [ ] O atlas/JSONB continua intacto — a suite existente (`npm test`) passa sem regressão.

**Testes:**
- `tests/integration/nomes-schema.test.js`: após migrar, consultar `information_schema`/`pg_extension`
  para afirmar a existência de `ng.nomes_geograficos`/`ng.edificacoes`/`ng.catalogo_3d`, dos índices,
  e da função `ng.f_unaccent`. Verificar SRID via `Find_SRID('ng','nomes_geograficos','geom') = 4674`
  e `... 'edificacoes' = 4326`.

**Dependências:** PostGIS instalado no servidor de teste/CI (ver §2).

---

### Tarefa 2: Triggers de `tipo_peso` e de `search_vector`

**Objetivo:** criar a trigger `ng.calcular_tipo_peso` (preenche `tipo_peso` na carga) e a trigger de
manutenção do `search_vector` do catálogo 3D.

**Arquivos afetados:**
- `src/database/migrations/006_postgis_ng.sql` (continuação do mesmo arquivo)

**Padrão de código:** segue o padrão de triggers de `002_atlas.sql` (ex.: trigger
`mark_slides_broken_on_map_delete`) e `003_sync.sql` (`update_atlas_current_version`).

**Implementação:**

```sql
-- 7) Trigger de tipo_peso (hierarquia EDGV - ver tabela §4.6)
CREATE OR REPLACE FUNCTION ng.calcular_tipo_peso() RETURNS TRIGGER AS $$
DECLARE t TEXT := ng.f_unaccent(lower(COALESCE(NEW.tipo, '')));
BEGIN
  NEW.tipo_peso := CASE
    WHEN t LIKE '%cidade%'                                              THEN 1.0
    WHEN t LIKE '%vila%'    OR t LIKE '%povoado%'                       THEN 0.9
    WHEN t LIKE '%rio%'     OR t LIKE '%lago%'   OR t LIKE '%represa%'  THEN 0.85
    WHEN t LIKE '%serra%'   OR t LIKE '%morro%'  OR t LIKE '%ilha%'
      OR t LIKE '%pico%'    OR t LIKE '%ponta%'  OR t LIKE '%praia%'    THEN 0.8
    WHEN t LIKE '%nome local%'                                          THEN 0.75
    WHEN t LIKE '%estrada%' OR t LIKE '%rodovia%'                       THEN 0.7
    WHEN t LIKE '%arroio%'  OR t LIKE '%canal%'  OR t LIKE '%cachoeira%' THEN 0.6
    WHEN t LIKE '%unidade de conservacao%' OR t LIKE '%terra indigena%' THEN 0.55
    WHEN t LIKE '%agro%'                                                THEN 0.5
    WHEN t LIKE '%ponte%'   OR t LIKE '%porto%'  OR t LIKE '%rodoviaria%'
      OR t LIKE '%aeroporto%'                                           THEN 0.4
    WHEN t LIKE '%saude%'   OR t LIKE '%ensino%' OR t LIKE '%seguranca%'
      OR t LIKE '%admin%'                                               THEN 0.35
    WHEN t LIKE '%energia%'                                             THEN 0.3
    WHEN t LIKE '%comercio%' OR t LIKE '%industria%' OR t LIKE '%lazer%' THEN 0.25
    WHEN t LIKE '%saneamento%' OR t LIKE '%comunicacao%' OR t LIKE '%duto%' THEN 0.2
    WHEN t LIKE '%religioso%' OR t LIKE '%cemiterio%'                   THEN 0.15
    ELSE 0.1
  END;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_calcular_tipo_peso
  BEFORE INSERT OR UPDATE OF tipo ON ng.nomes_geograficos
  FOR EACH ROW EXECUTE FUNCTION ng.calcular_tipo_peso();

-- 8) Trigger de search_vector do catalogo 3D (pesos: name A, descricao/keywords B, mun/estado C)
CREATE OR REPLACE FUNCTION ng.catalogo_3d_search_update() RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
      setweight(to_tsvector('portuguese', COALESCE(NEW.name, '')), 'A')
   || setweight(to_tsvector('portuguese', COALESCE(NEW.description, '')), 'B')
   || setweight(to_tsvector('portuguese', COALESCE(array_to_string(NEW.palavras_chave, ' '), '')), 'B')
   || setweight(to_tsvector('portuguese', COALESCE(NEW.municipio, '') || ' ' || COALESCE(NEW.estado, '')), 'C');
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_catalogo_3d_search
  BEFORE INSERT OR UPDATE ON ng.catalogo_3d
  FOR EACH ROW EXECUTE FUNCTION ng.catalogo_3d_search_update();
```

> Os pesos do `search_vector`: `name` A, `description` B, `palavras_chave` B, `municipio`+`estado` C
> (conforme o origin). Trigger `BEFORE INSERT OR UPDATE` mantém o vetor sempre coerente sem carga manual.

**Critérios de aceitação:**
- [ ] Inserir uma linha em `ng.nomes_geograficos` com `tipo='Cidade'` resulta em `tipo_peso = 1.0`;
      com um `tipo` desconhecido, `tipo_peso = 0.1`.
- [ ] Inserir/atualizar em `ng.catalogo_3d` preenche `search_vector` (não nulo) automaticamente.
- [ ] `UPDATE ... SET tipo = '...'` redispara o cálculo de peso.

**Testes:**
- `tests/integration/nomes-triggers.test.js`: inserir linhas variadas e afirmar `tipo_peso` por faixa;
  afirmar que `search_vector @@ plainto_tsquery('portuguese', 'termo')` casa após insert.

**Dependências:** Tarefa 1.

---

### Tarefa 3: Função `ng.refresh_busca()` (passo pós-carga obrigatório)

**Objetivo:** encapsular o recálculo pós-carga (DBSCAN de `cluster_id` + garantir `tipo_peso`) numa
única função idempotente, **obrigatória após cada carga FME**. Esquecer este passo deixa `cluster_id`
nulo e a busca degrada **silenciosamente** (o dedup vira no-op, ranking piora) sem erro.

**Arquivos afetados:**
- `src/database/migrations/006_postgis_ng.sql` (continuação)

**Implementação:**

```sql
-- 9) recomputar_clusters: DBSCAN por (nome, tipo), eps ~5km, minpoints 1
CREATE OR REPLACE FUNCTION ng.recomputar_clusters() RETURNS void AS $$
  WITH clusters AS (
    SELECT id, ST_ClusterDBSCAN(geom, eps := 0.045, minpoints := 1)
      OVER (PARTITION BY nome, tipo) AS cid
    FROM ng.nomes_geograficos
  )
  UPDATE ng.nomes_geograficos n SET cluster_id = c.cid FROM clusters c WHERE n.id = c.id;
$$ LANGUAGE sql;

-- 10) refresh_busca: passo OBRIGATORIO pos-carga FME
--     Recalcula clusters E reforca tipo_peso (caso a carga tenha entrado por COPY,
--     que NAO dispara triggers BEFORE INSERT).
CREATE OR REPLACE FUNCTION ng.refresh_busca() RETURNS void AS $$
BEGIN
  -- tipo_peso: re-trigger via UPDATE no-op da coluna tipo (COPY bypassa a trigger)
  UPDATE ng.nomes_geograficos SET tipo = tipo;
  -- clusters
  PERFORM ng.recomputar_clusters();
END; $$ LANGUAGE plpgsql;
```

> **Nota sobre `COPY`:** a carga FME pode usar `COPY` (bulk), que **não dispara triggers
> `BEFORE INSERT`** em algumas configurações. Por isso `refresh_busca()` faz um `UPDATE ... SET
> tipo = tipo` que re-aciona a trigger `trg_calcular_tipo_peso` (que escuta `UPDATE OF tipo`),
> garantindo `tipo_peso` mesmo após `COPY`. Se a carga usa `INSERT` linha-a-linha, o `tipo_peso` já
> entra pela trigger e este UPDATE é redundante mas inofensivo.

**Documentação do procedimento de carga (registrar em `CLAUDE.md` ou doc de operação):**

```
-- Procedimento de carga de nomes geograficos (operador / job FME):
-- 1. FME escreve ng.nomes_geograficos (geom 4674).
-- 2. OBRIGATORIO ao final:  SELECT ng.refresh_busca();
--    (sem isso, cluster_id fica nulo e a busca degrada silenciosamente)
```

**Critérios de aceitação:**
- [ ] `SELECT ng.refresh_busca();` roda sem erro e, após uma carga de teste, todas as linhas têm
      `cluster_id` não-nulo e `tipo_peso` coerente.
- [ ] É idempotente: rodar duas vezes seguidas produz o mesmo estado.

**Testes:**
- `tests/integration/nomes-refresh.test.js`: inserir N pontos do mesmo `(nome,tipo)` perto e longe,
  rodar `ng.refresh_busca()`, afirmar que pontos próximos compartilham `cluster_id` e distantes não;
  afirmar `cluster_id IS NOT NULL` para todas as linhas.

**Dependências:** Tarefa 1, Tarefa 2.

---

### Tarefa 4: Módulo `src/modules/nomes` — estrutura, queries e schemas

**Objetivo:** criar o módulo seguindo o template canônico (`_padroes.md` §1), com as queries verbatim
(§4.2–§4.4) e validação Joi de todas as rotas.

**Arquivos afetados:**
- `src/modules/nomes/index.js` (criar)
- `src/modules/nomes/nomes.routes.js` (criar)
- `src/modules/nomes/nomes.controller.js` (criar)
- `src/modules/nomes/nomes.service.js` (criar)
- `src/modules/nomes/nomes.queries.js` (criar)
- `src/modules/nomes/nomes.schemas.js` (criar)

**Padrão de código:** módulo `src/modules/resources/` é o template mais próximo (read-only +
admin-write); aqui é só read-only. Controllers usam `asyncHandler` (`_padroes.md` §2). Service usa
`{ query }` de `../../database/index.js` (`query()` retorna `{ rows }`). Joi via `validate()` na rota
(`_padroes.md` §3).

**Implementação:**

`nomes.queries.js` — três constantes UPPER_SNAKE com o SQL verbatim das seções §4.2, §4.3, §4.4:
```javascript
// Path: src/modules/nomes/nomes.queries.js
export const BUSCA = `/* SQL verbatim de §4.2 (7 criterios) */`;
export const FEICOES = `/* SQL verbatim de §4.3 (ST_DWithin) */`;
export const CATALOGO_COM_Q   = `/* §4.4 SELECT com search_vector */`;
export const CATALOGO_COUNT_Q = `/* §4.4 COUNT com search_vector */`;
export const CATALOGO_SEM_Q   = `/* §4.4 SELECT sem termo */`;
export const CATALOGO_COUNT   = `/* §4.4 COUNT sem termo */`;
```

`nomes.schemas.js` — Joi, validando os params exatos do contrato:
```javascript
// Path: src/modules/nomes/nomes.schemas.js
import Joi from 'joi';

export const buscaSchema = Joi.object({
  q:    Joi.string().min(3).max(200).required(),
  lat:  Joi.number().required(),
  lon:  Joi.number().required(),
  zoom: Joi.number().integer().min(1).max(20).optional(),
});

export const feicoesSchema = Joi.object({
  lat: Joi.number().required(),
  lon: Joi.number().required(),
  z:   Joi.number().required(),
});

export const catalogoSchema = Joi.object({
  q:          Joi.string().max(200).allow('').optional(),
  page:       Joi.number().integer().min(1).default(1),
  nr_records: Joi.number().integer().min(1).max(100).default(10),
});
```

`nomes.service.js`:
```javascript
// Path: src/modules/nomes/nomes.service.js
import { query } from '../../database/index.js';
import * as Q from './nomes.queries.js';

export async function busca({ q, lat, lon, zoom }) {
  const { rows } = await query(Q.BUSCA, [q, lat, lon, zoom ?? null]);
  return rows; // [{ nome, tipo, municipio, estado, longitude, latitude, score }]
}

export async function feicoes({ lat, lon, z }) {
  const { rows } = await query(Q.FEICOES, [lon, lat, z]); // ordem $1=lon, $2=lat, $3=z
  return rows[0] ?? null;
}

export async function catalogo3d({ q, page, nr_records }) {
  const offset = (page - 1) * nr_records;
  if (q) {
    const [{ rows: data }, { rows: cnt }] = await Promise.all([
      query(Q.CATALOGO_COM_Q,   [q, nr_records, offset]),
      query(Q.CATALOGO_COUNT_Q, [q]),
    ]);
    return { total: cnt[0].total, page, nr_records, data };
  }
  const [{ rows: data }, { rows: cnt }] = await Promise.all([
    query(Q.CATALOGO_SEM_Q, [nr_records, offset]),
    query(Q.CATALOGO_COUNT, []),
  ]);
  return { total: cnt[0].total, page, nr_records, data };
}
```

`nomes.controller.js` — note os shapes de resposta divergentes (ver §5 de cuidados):
```javascript
// Path: src/modules/nomes/nomes.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as nomesService from './nomes.service.js';

// CONTRATO CONGELADO: /busca responde o ARRAY direto (nao { data: [...] })
export const busca = asyncHandler(async (req, res) => {
  const result = await nomesService.busca(req.query);
  res.json(result);
});

export const feicoes = asyncHandler(async (req, res) => {
  const result = await nomesService.feicoes(req.query);
  res.json(result ?? { message: 'Nenhuma edificação encontrada nas proximidades.' });
});

// /catalogo3d responde { total, page, nr_records, data } (envelope proprio, nao { data })
export const catalogo3d = asyncHandler(async (req, res) => {
  const result = await nomesService.catalogo3d(req.query);
  res.json(result);
});
```

`nomes.routes.js`:
```javascript
// Path: src/modules/nomes/nomes.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { nomesAccessLog } from '../../middleware/nomes-access-log.js'; // Tarefa 6
import * as ctrl from './nomes.controller.js';
import * as schemas from './nomes.schemas.js';

const router = Router();

router.get('/busca',      auth, nomesAccessLog, validate({ query: schemas.buscaSchema }),    ctrl.busca);
router.get('/feicoes',    auth, nomesAccessLog, validate({ query: schemas.feicoesSchema }),  ctrl.feicoes);
router.get('/catalogo3d', auth, nomesAccessLog, validate({ query: schemas.catalogoSchema }), ctrl.catalogo3d);

export { router as nomesRoutes };
```

`index.js`:
```javascript
// Path: src/modules/nomes/index.js
export { nomesRoutes } from './nomes.routes.js';
export * as nomesService from './nomes.service.js';
```

> **CUIDADO com os contratos de resposta divergentes:** o restante do backend usa o envelope
> `{ data: ... }` (`_padroes.md` §2), MAS `/busca` é um **contrato congelado** que o `ebgeo_web` já
> consome como **array nu** (§4.7), e `/catalogo3d` usa o envelope próprio `{ total, page,
> nr_records, data }`. **NÃO** envolva esses dois em `{ data }` — quebraria o frontend. Documente a
> exceção nos arquivos.

**Critérios de aceitação:**
- [ ] Módulo segue o template (`.routes/.controller/.service/.queries/.schemas/index`).
- [ ] As queries em `.queries.js` são **byte-idênticas** ao SQL verbatim de §4.2–§4.4.
- [ ] Validação Joi rejeita `q` < 3 chars (busca), `lat`/`lon`/`z` não-float, `zoom` fora de 1–20,
      `nr_records` fora de 1–100 → 422 `VALIDATION_ERROR`.
- [ ] `/busca` responde array nu; `/catalogo3d` responde `{ total, page, nr_records, data }`.
- [ ] SQL 100% parametrizado (sem concatenação de input).

**Testes:**
- `tests/integration/nomes-busca.test.js`: seed de pontos reais conhecidos → afirmar ordem por score,
  match exato no topo, dedup por cluster (não retorna duplicatas da mesma feição), efeito do `zoom`
  (proximidade pesa mais em zoom alto), `LIMIT 5`. **Caso negativo:** sem auth → 401; `q` curto → 422.
- `tests/integration/nomes-feicoes.test.js`: edificação dentro do raio de 3 m e com `z` na faixa →
  `z_distance = 0`; clique fora de 3 m → `{ message: ... }`.
- `tests/integration/nomes-catalogo.test.js`: paginação (`total`/`page`/`nr_records`), full-text com
  e sem `q`, ordenação por `ts_rank`/`data_criacao`.

**Dependências:** Tarefa 1, Tarefa 2 (search_vector), Tarefa 6 (middleware de log — pode ser stub no-op
inicialmente e completado na Tarefa 6).

---

### Tarefa 5: Montar as rotas em `app.js`

**Objetivo:** expor o módulo sob `/api/v1/nomes`.

**Arquivos afetados:**
- `src/app.js` (modificar — import + `app.use`)

**Padrão de código:** `src/app.js:38-41` (padrão de montagem `app.use('/api/v1/<modulo>', ...Routes)`).

**Implementação:**
```javascript
// src/app.js — junto aos demais imports de módulo
import { nomesRoutes } from './modules/nomes/index.js';
// ...
app.use('/api/v1/nomes', nomesRoutes);   // sob o middleware auth interno do modulo
```

**Critérios de aceitação:**
- [ ] `GET /api/v1/nomes/busca?...` autenticado responde 200; sem token → 401.
- [ ] As rotas finais são `/api/v1/nomes/busca`, `/api/v1/nomes/feicoes`, `/api/v1/nomes/catalogo3d`.

**Testes:** cobertos pelos testes da Tarefa 4 (que batem no `app` exportado via supertest).

**Dependências:** Tarefa 4.

---

### Tarefa 6: Log de acesso por IP (auditoria) + middleware

**Objetivo:** registrar cada acesso de busca/feicoes/catalogo3d com IP e usuário, para auditoria
(substitui o `api-access.log` do serviço original; aqui usa o logger Pino estruturado).

**Arquivos afetados:**
- `src/middleware/nomes-access-log.js` (criar)

**Padrão de código:** logger estruturado Pino (ver `src/utils/logger.js` e o `request-logger`
existente). Não criar arquivo de log à parte — emitir log estruturado com categoria.

**Implementação:**
```javascript
// Path: src/middleware/nomes-access-log.js
import { logger } from '../utils/logger.js';

export function nomesAccessLog(req, _res, next) {
  logger.info({
    category: 'nomes_access',
    userId: req.user?.id ?? null,
    ip: req.ip,                       // requer app.set('trust proxy', ...) atras do NGINX
    path: req.path,
    query: req.query,
  }, 'nomes access');
  next();
}
```

> **Atrás do NGINX:** para `req.ip` refletir o cliente real (não o proxy), o `app.js` precisa de
> `app.set('trust proxy', 1)` (ou a config equivalente da fase-0/fase-7). Se ainda não existe,
> adicione na fase-7 (gateway) — aqui o log já registra o que `req.ip` fornecer.

**Critérios de aceitação:**
- [ ] Cada chamada às 3 rotas emite um log `category: 'nomes_access'` com `userId`, `ip`, `path`.
- [ ] O middleware não quebra a requisição (sempre chama `next()`).

**Testes:**
- `tests/integration/nomes-access-log.test.js` (opcional/leve): afirmar que o middleware é montado e
  não altera a resposta. (Asserção de log é frágil; basta garantir não-regressão.)

**Dependências:** nenhuma (pode ser feita antes da Tarefa 4; a rota já o referencia).

---

### Tarefa 7: Transição de rotas (NGINX rewrite) — documentação

**Objetivo:** garantir que os consumidores antigos (`/busca` nu, porta 3000/3001 do microsserviço)
migrem para `/api/v1/nomes/busca` sem quebra.

**Arquivos afetados:**
- Documentação de deploy (NGINX) — **não é código do backend**. A implementação NGINX vive na fase-7
  (gateway). Aqui apenas especificamos o contrato de rewrite.

**Especificação do rewrite (para o gateway, fase-7):**
```nginx
# Transicao: paths nus antigos -> namespace do backend
location = /busca       { rewrite ^ /api/v1/nomes/busca      last; }
location = /feicoes     { rewrite ^ /api/v1/nomes/feicoes    last; }
location = /catalogo3d  { rewrite ^ /api/v1/nomes/catalogo3d last; }
# (preservando query string, que o NGINX repassa por padrao)
```

**Cuidado de transição:** o serviço antigo **não tinha auth**; o backend **exige** token. Mapear os
consumidores (o `ebgeo_web` deve passar a enviar o JWT no header) **antes** de cortar o serviço
antigo. Coordene com a fase-7.

**Critérios de aceitação:**
- [ ] Documento de deploy lista o mapeamento de paths e o requisito de JWT.

**Dependências:** Tarefa 5. Implementação NGINX = fase-7.

---

## 6. Riscos e cuidados

| Risco | Mitigação |
|-------|-----------|
| **Portar do working tree errado** (HEAD local = busca de 2 critérios) | Todo o SQL correto está embutido verbatim neste doc (§4). Use-o, não o clone. Se consultar o repo, use `git show origin/main:...`. |
| **Esquecer `ng.refresh_busca()` pós-carga** → busca degrada **silenciosamente** (cluster_id/tipo_peso nulos, sem erro) | Tarefa 3 encapsula numa função única; documentar como passo OBRIGATÓRIO do job FME. Teste de regressão afirma `cluster_id IS NOT NULL`. |
| **PostGIS não instalado no servidor/CI** → `CREATE EXTENSION postgis` falha | Imagem `postgis/postgis:16-3.4` no Docker/CI (coordenar com fase-0). Documentar o pré-requisito. |
| **SRID misto** (nomes 4674, edificações/clique 4326) | **Intencional** — o dado de origem é assim. Manter e documentar. Não cast cego entre SRIDs. Validar a unidade do `z` do `/feicoes` contra o dado real (tolerância de 3 m). |
| **`unaccent` STABLE não indexa** | Usar o wrapper `ng.f_unaccent` IMMUTABLE (§4.1) e o índice **funcional** que casa a expressão da query verbatim (Ramo A da decisão aberta). |
| **Vazar nomes / portar para o backend errado** (risco citado em AVALIACAO) | Este é o **backend único** correto. Nomes ficam em schema `ng` isolado, read-only, sob auth. Não misturar com JSONB/CRDT. A fase-6 adiciona controle de acesso por zona — até lá, **toda leitura exige autenticação** (não anônimo). |
| **Quebrar o contrato de `/busca`** (frontend espera array nu, não `{ data }`) | Controller responde array direto; teste de contrato afirma o shape `{tipo,nome,municipio,estado,longitude,latitude(,score)}`. Idem `/catalogo3d` com envelope próprio. |
| **GDAL no Node** | Não trazer. PDF fica como microsserviço Flask separado (fase-7) ou é descartado. |
| **GRANTs hardcoded** para `user_nomes_geograficos` | Removidos da migração; backend usa seu próprio role via `DATABASE_URL`. |
| **`COPY` não dispara trigger de tipo_peso** | `ng.refresh_busca()` faz `UPDATE ... SET tipo = tipo` para re-acionar a trigger (Tarefa 3). |

---

## 7. Definition of Done da fase

Além do DoD universal de `_padroes.md` §10:

- [ ] Migração `006_postgis_ng.sql` aplica limpa num banco com PostGIS; `npm test` (atlas/JSONB) sem regressão.
- [ ] Extensões `postgis`, `pg_trgm`, `unaccent`, `pgcrypto` criadas; **sem** `uuid-ossp`; PKs com `gen_random_uuid()`.
- [ ] Schema `ng` com `nomes_geograficos` (4674), `edificacoes` (4326), `catalogo_3d`, todos os índices,
      `f_unaccent`, triggers de `tipo_peso` e `search_vector`, e `ng.refresh_busca()`.
- [ ] Módulo `src/modules/nomes` completo e montado sob `/api/v1/nomes`, sob auth de leitura.
- [ ] As 3 queries são byte-idênticas ao verbatim (§4.2–§4.4); SQL 100% parametrizado.
- [ ] Contrato congelado de `/busca` (array nu) e `/catalogo3d` (envelope próprio) preservado e testado.
- [ ] Validação Joi em todas as 3 rotas (caso negativo coberto: 401 sem auth, 422 input inválido).
- [ ] Testes de regressão da busca contra dados reais (ordem por score, dedup por cluster, efeito do zoom).
- [ ] Log de acesso por IP/usuário emitido (`category: 'nomes_access'`).
- [ ] Procedimento de carga FME + `ng.refresh_busca()` obrigatório documentado (`CLAUDE.md`/doc de operação).
- [ ] `CLAUDE.md` atualizado: novo módulo `nomes`, novas extensões/schema `ng`, migração `006`,
      nota de que `criterio_busca.md` (origin) está desatualizado e o código (7 critérios) manda.
