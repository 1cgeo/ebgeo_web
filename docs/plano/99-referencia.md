# 99 — Referência: apêndices verbatim a preservar

> **Status:** documento de referência. **Não modifica código.**
> **Público-alvo:** agentes de IA implementando qualquer fase (0–8).
> **Leia `_padroes.md` e `00-visao-geral.md` antes de qualquer fase.**

---

## 1. Objetivo e contexto

Os **6 documentos-fonte** de análise/roadmap (`AVALIACAO-REAPROVEITAMENTO.md`,
`IDEIAS-EBGEO-WEB-2.md`, `SERVICO-NOMES-GEOGRAFICOS.md`, `EBGEO-360.md`,
`PROTOTIPO-COLABORACAO-TEMPO-REAL.md`, `11-gaps-multiusuario.md`) **serão deletados** após a
consolidação deste plano. Este arquivo **preserva verbatim** os artefatos que precisam sobreviver
a essa deleção e que as fases de implementação referenciam como apêndices:

1. **SQL da busca de 7 critérios** + `f_unaccent` + `recomputar_clusters` + hierarquia `tipo_peso`
   + schema `ng` completo (consumido pela **fase-3**).
2. **Schema de controle de acesso geográfico** (`geographic_access_zones`, permissões de
   zona/grupo, `model_permissions`, CTE de autorização canônica, filtro espacial por zona)
   (consumido pela **fase-6**).
3. **Schema `audit_trail` + `createAudit(req, params, t?)` + `api_key_history`** (consumido pela
   **fase-5**).
4. **Contrato da API 360 a não quebrar** (shape do metadado de foto, pontos sensíveis, ETag/Range,
   envelope de erro) (consumido pela **fase-7**).
5. **Shape do `config.js`** (chaves de topo, pegadinha dos baselayers) (consumido pela **fase-2**).
6. **Especificação da UI de admin** (`ebgeo_web_2_admin`): **projeto frontend SEPARADO** — aqui só
   listamos os **endpoints que o backend deve prover** por tela + padrões de scaffold (consumido
   pelas fases que expõem endpoints de admin: principalmente **fase-5/fase-6**).
7. **Anti-padrões a evitar** (consolidado dos 6 docs).

> **Importante (escopo):** A UI de admin é um **projeto frontend React separado** (React 19 + Vite 6
> + MUI v6 + TS, repositório `ebgeo_web_2_admin`). **O backend (`ebgeo_backend`, JS puro) NÃO
> implementa UI.** O backend só precisa **prover os endpoints** listados na seção 7. As telas
> pressupõem o schema de controle de acesso (zonas/permissões) da **fase-6**: só encaixam de fato
> depois que o backend ganhar esse controle. Até lá, o frontend aproveita o scaffold e adapta as
> telas aos endpoints já existentes do `ebgeo_backend` (usuários, reset de senha, resources).

---

## 2. Pré-requisitos / dependências

Este documento **não tem tarefas de implementação próprias** — é puramente referência. Mas o
material aqui embutido é **pré-requisito de leitura** para:

| Material | Fase consumidora | Cross-ref |
|----------|------------------|-----------|
| Schema `ng` + busca de 7 critérios + `recomputar_clusters` + `f_unaccent` + `tipo_peso` | fase-3 (PostGIS + Gazetteer) | seção 3 |
| `geographic_access_zones` + zone/group/model permissions + CTE de autorização + filtro espacial | fase-6 (Acesso geográfico) | seção 4 |
| `audit_trail` + `createAudit(req,params,t?)` + `api_key_history` | fase-5 (Multi-org / identidade) | seção 5 |
| Contrato 360 (shape metadado, ETag/Range, envelope de erro) | fase-7 (Gateway + 360) | seção 6 |
| Shape do `config.js` + pegadinha dos baselayers | fase-2 (Config dinâmico) | seção 7 (config) |
| Spec de endpoints da UI de admin | fase-5/fase-6 | seção 8 |
| Anti-padrões | todas | seção 9 |

---

## 3. Apêndice A — Gazetteer PostGIS (schema `ng` + busca de 7 critérios) — para a fase-3

> **Proveniência (crítico):** todo este material vem de `servico_nomes_geograficos` **`origin/main`**
> (commits `010cbb0 melhoria busca de nomes` + `5bc5a5c fix peso`), **nunca do working tree local**
> (que está 2 commits atrás, com a busca antiga de 2 critérios). Sempre portar de `origin/main`.

### 3.1 Extensões e schema

```sql
CREATE EXTENSION IF NOT EXISTS postgis;     -- geometria, GIST, ST_*
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- busca fuzzy (similarity, GIN trgm)
CREATE EXTENSION IF NOT EXISTS unaccent;    -- remove acentos
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid()
CREATE SCHEMA IF NOT EXISTS ng;
```

> **Padronizar `gen_random_uuid()`** (pgcrypto, nativo PG 13+) para todas as PKs. **NÃO** usar
> `uuid_generate_v4()` (uuid-ossp). O original misturava as duas sem motivo — não copiar essa mistura.

### 3.2 Wrapper IMMUTABLE para indexar sem acento (verbatim)

O `unaccent` nativo é só `STABLE`, não indexa direto. O wrapper torna-o `IMMUTABLE`:

```sql
CREATE OR REPLACE FUNCTION ng.f_unaccent(text)
RETURNS text AS $$ SELECT public.unaccent('public.unaccent', $1) $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;
```

### 3.3 Tabelas do schema `ng` (verbatim das colunas)

**`ng.nomes_geograficos`** (SRID **4674** / SIRGAS 2000):
- `id uuid PK`, `nome VARCHAR(255)`, `municipio/estado/tipo VARCHAR(255)`,
  `cluster_id INTEGER`, `tipo_peso FLOAT DEFAULT 0.1`, `geom GEOMETRY(POINT, 4674)`.
- Índices:
  - `idx_ng_geom` **GIST(geom)**;
  - `idx_ng_nome_unaccent_trgm` **GIN(`ng.f_unaccent(nome)` gin_trgm_ops)** (índice funcional);
  - `idx_ng_tipo`;
  - `idx_ng_cluster (nome, tipo, cluster_id)` (serve o dedup);
  - `idx_ng_tipo_peso (tipo_peso DESC)`.

**`ng.edificacoes`** (SRID **4326** — note: diferente de nomes; SRID misto **documentado**):
- `id uuid`, `nome/municipio/estado/tipo`, `altitude_base/altitude_topo numeric`,
  `geom GEOMETRY(POLYGON, 4326)`, `CHECK (altitude_base <= altitude_topo)`.
- Índices: GIST(geom), btree(altitude_base, altitude_topo).

**`ng.catalogo_3d`** (fonte de verdade dos metadados de modelos 3D — cross-ref fase-4):
- `id uuid`, `name`, `description TEXT`, `municipio/estado/thumbnail`,
  `palavras_chave TEXT[]`, `url`,
  `lon/lat/height/heading/pitch/roll NUMERIC`,
  `type VARCHAR(50)` (`'Tiles 3D'` | `'Modelos 3D'` | `'Nuvem de Pontos'`),
  `heightoffset`, `maximumscreenspaceerror`, `data_criacao`,
  `search_vector tsvector`, `style JSONB`.
- Índices: GIN(search_vector), (data_criacao DESC), (type).

### 3.4 Trigger `tipo_peso` — hierarquia EDGV (verbatim)

`ng.calcular_tipo_peso` (trigger `BEFORE INSERT OR UPDATE OF tipo`) mapeia o `tipo` textual num
peso 0.1 a 1.0. Hierarquia exata:

| Peso | Tipos |
|------|-------|
| 1.0  | Cidade |
| 0.9  | vila / povoado |
| 0.85 | rio / lago / represa |
| 0.8  | serra / morro / ilha / pico / ponta / praia |
| 0.75 | Nome local |
| 0.7  | estrada / rodovia |
| 0.6  | arroio / canal / cachoeira |
| 0.55 | UC / terra indígena |
| 0.5  | Agro |
| 0.4  | ponte / porto / Rod / Aero |
| 0.35 | saúde / ensino / segurança / admin |
| 0.3  | energia |
| 0.25 | comércio / indústria / lazer |
| 0.2  | saneamento / comunicação / duto |
| 0.15 | religioso / cemitério |
| 0.1  | **default** |

### 3.5 `ng.recomputar_clusters()` — rodar APÓS cada carga (verbatim)

DBSCAN com `eps ~5 km` (0.045 graus) particionado por `(nome, tipo)`: agrupa ocorrências do mesmo
topônimo próximas (mesma feição real registrada várias vezes em folhas vizinhas).

```sql
WITH clusters AS (
  SELECT id, ST_ClusterDBSCAN(geom, eps := 0.045, minpoints := 1)
    OVER (PARTITION BY nome, tipo) AS cid
  FROM ng.nomes_geograficos
)
UPDATE ng.nomes_geograficos n SET cluster_id = c.cid FROM clusters c WHERE n.id = c.id;
```

> **Encapsular em `ng.refresh_busca()`** (DBSCAN + recalculo de `tipo_peso`) e torná-la **passo
> obrigatório** do job FME pós-carga. Esquecê-la deixa `cluster_id`/`tipo_peso` nulos e **degrada a
> busca silenciosamente, sem erro**.

### 3.6 Trigger full-text do catálogo 3D (verbatim)

`catalogo_3d_search_vector_update`:
`setweight(name, A) || palavras_chave A || description B || municipio C || estado D`. Forma canônica
(de `IDEIAS-EBGEO-WEB-2.md` §1.1.4):

```sql
NEW.search_vector :=
  setweight(to_tsvector('portuguese', COALESCE(NEW.name, '')), 'A') ||
  setweight(to_tsvector('portuguese', COALESCE(array_to_string(NEW.palavras_chave, ' '), '')), 'A') ||
  setweight(to_tsvector('portuguese', COALESCE(NEW.description, '')), 'B') ||
  setweight(to_tsvector('portuguese', COALESCE(NEW.municipio, '')), 'C') ||
  setweight(to_tsvector('portuguese', COALESCE(NEW.estado, '')), 'D');
```

### 3.7 A busca de 7 critérios — SQL completo (VERBATIM, não alterar pesos)

Validação: `q` 3 a 200 chars; `lat`/`lon` float obrigatórios; `zoom` int 1 a 20 opcional.
Placeholders: `$1`=termo, `$2`=lat, `$3`=lon, `$4`=zoom.

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
      CASE WHEN lower(d.nome_clean) = lower(q_ref.term)             THEN 1.0 ELSE 0.0 END * 0.20  -- 1 exato
    + CASE WHEN lower(d.nome_clean) LIKE lower(q_ref.term)||'%'     THEN 1.0 ELSE 0.0 END * 0.10  -- 2 prefixo
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

Os 7 critérios (somam **1.00**):

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
- **`zoom_factor`** = `clamp((zoom-4)/14, 0, 1)`. Em zoom alto neutraliza o `tipo_peso`
  (todos convergem para 0.5): perto vence, seja capital ou escola.
- **Dedup:** `DISTINCT ON (nome, tipo, cluster_id)` por `dist ASC` — uma linha por feição real.
- **LIMIT:** 500 candidatos, 5 finais.

> O `er/criterio_busca.md` do repositório-fonte está **DESATUALIZADO** (descreve 6 critérios, pesos
> pré-`fix peso`). **O código acima manda.** Ao absorver, corrigir/descartar o doc.

### 3.8 `/feicoes` — clique 3D em edificação (verbatim)

Params `lat`, `lon`, `z` (`$1`=lat, `$2`=lon, `$3`=z). Acha a edificação a até 3 m do clique cuja
faixa de altitude melhor contém o `z`. Usar `ST_DWithin` (forma do `origin/main`, mais limpa que
`ST_Buffer + ST_Intersects`):

```sql
WHERE ST_DWithin(e.geom::geography, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, 3)
-- z_distance: 0 se z dentro de [altitude_base, altitude_topo], senao distancia vertical a faixa
ORDER BY z_distance ASC, xy_distance ASC LIMIT 1
```

Retorna `{ id, nome, municipio, estado, tipo, altitude_base, altitude_topo, z_distance, xy_distance }`
ou `{ message: "Nenhuma edificacao encontrada..." }`.

### 3.9 `/catalogo3d` — full-text + paginação (verbatim)

Params `q` (opcional), `page` (default 1), `nr_records` (1 a 100, default 10). Com `q`:
`WHERE search_vector @@ plainto_tsquery('portuguese', $1)` ordenado por
`ts_rank(...) DESC, data_criacao DESC`. `COUNT(*)` e `SELECT` em paralelo. Resposta:

```json
{ "total": 0, "page": 1, "nr_records": 10, "data": [ {
  "id": "", "name": "", "description": "", "thumbnail": "", "url": "",
  "lon": 0, "lat": 0, "height": 0, "heading": 0, "pitch": 0, "roll": 0,
  "type": "", "heightoffset": 0, "maximumscreenspaceerror": 0, "data_criacao": "",
  "municipio": "", "estado": "", "palavras_chave": [], "style": {} } ] }
```

### 3.10 Contrato `/busca` que o `ebgeo_web` JÁ CONSOME (NÃO QUEBRAR)

```
GET /busca?q=<termo>&lat=<lat>&lon=<lon>[&zoom=<1..20>]
-> array de ate 5: [ { "tipo","nome","municipio","estado","longitude","latitude" } ]
```

No `origin/main` cada item também traz `score`; o conjunto `{tipo,nome,municipio,estado,longitude,
latitude}` é o **contrato estável** congelado. No backend único, montar sob namespace
`/api/v1/nomes/busca`, `/api/v1/nomes/feicoes`, `/api/v1/nomes/catalogo3d` (NGINX faz rewrite dos
paths nus antigos durante a transição). Leitura liberada a qualquer autenticado; manter log de
acesso por IP.

---

## 4. Apêndice B — Controle de acesso geográfico — para a fase-6

> O acesso é desenhado como **polígono**: o PostGIS decide quais feições caem dentro
> (`ST_Contains(zona, ponto)`), não cadastro linha a linha. Feição nova já herda a regra da zona.
> Exige GIST na zona e na feição. **Autorização embutida na própria query SQL** (defesa em
> profundidade: o dado não vaza nem com bug na camada de aplicação).

### 4.1 `geographic_access_zones` + permissões (verbatim)

```sql
CREATE TABLE ng.geographic_access_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100), description TEXT,
  geom GEOMETRY(POLYGON, 4674) NOT NULL,
  created_by UUID REFERENCES ng.users(id), created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_zones_geom ON ng.geographic_access_zones USING GIST (geom);
-- zone_permissions (zone_id, user_id) e zone_group_permissions (zone_id, group_id),
-- ambas PK composta, FK ON DELETE CASCADE, indices nos dois sentidos.
```

Tabelas de junção (padrão N:N transversal, ver `_padroes.md` §7):
- `ng.zone_permissions (zone_id, user_id)` — PK composta `(zone_id, user_id)`, FK
  `ON DELETE CASCADE`, índice no sentido `(user_id)`.
- `ng.zone_group_permissions (zone_id, group_id)` — PK composta, FK `ON DELETE CASCADE`, índice
  `(group_id)`.

### 4.2 Permissões de modelo 3D (mesma estrutura — para fase-4/fase-6)

- `ng.model_permissions (model_id, user_id)` — permissão direta.
- `ng.model_group_permissions (model_id, group_id)` — permissão via grupo.
- `ng.catalogo_3d.access_level VARCHAR(20) CHECK (access_level IN ('public','private'))` na linha.

### 4.3 CTE de autorização CANÔNICA (verbatim — `public OR admin OR direto OR via-grupo`)

Padrão de `catalog3d.queries.ts`. `$4` = `userId` (pode ser `NULL` para anônimo), `$1` = termo de
busca, `$2/$3` = limit/offset. **Centralizar este predicado numa função/view SQL única** — no
original estava duplicado em 4 arquivos (risco de divergência; ver anti-padrões §9).

```sql
WITH user_role AS (
  SELECT EXISTS (SELECT 1 FROM ng.users WHERE id = $4 AND role = 'admin') AS is_admin
),
user_model_permissions AS (
  SELECT DISTINCT model_id FROM (
    SELECT model_id FROM ng.model_permissions WHERE user_id = $4            -- direta
    UNION
    SELECT mgp.model_id FROM ng.model_group_permissions mgp
      JOIN ng.user_groups ug ON mgp.group_id = ug.group_id WHERE ug.user_id = $4  -- via grupo
  ) perms
)
SELECT c.* , CASE WHEN $1 IS NOT NULL
              THEN ts_rank(search_vector, plainto_tsquery('portuguese',$1)) ELSE 0 END AS rank
FROM ng.catalogo_3d c
CROSS JOIN user_role ur
LEFT JOIN user_model_permissions ump ON ump.model_id = c.id
WHERE ( c.access_level = 'public'
        OR ($4::UUID IS NOT NULL AND (ur.is_admin OR ump.model_id IS NOT NULL)) )
  AND ($1::text IS NULL OR search_vector @@ plainto_tsquery('portuguese',$1))
ORDER BY rank DESC, data_carregamento DESC
LIMIT $2 OFFSET $3;
```

### 4.4 Filtro espacial de acesso por zona (verbatim — fundir na busca de nomes)

O ramo de zona usa `LEFT JOIN user_zones uz ON ST_Contains(uz.geom, n.geom)` e
`WHERE ... OR uz.id IS NOT NULL`. Para anônimo (`$4 IS NULL`), a CTE de zonas retorna vazia e só
sobram os `public`. **Não existe caminho em que um registro privado escape para o SELECT final.**

> **Ao re-portar a busca de 7 critérios da fase-3, fundir este WHERE de acesso na CTE `candidatos`,
> ANTES do `LIMIT 500`,** para não vazar nomes privados. A CTE `user_zones` deriva de
> `zone_permissions` (direto) UNION `zone_group_permissions` JOIN `user_groups` (via grupo) para o
> `$4` corrente.

### 4.5 Count alinhado ao filtro de acesso

`COUNT_*` deve repetir **EXATAMENTE** o mesmo predicado de acesso da busca, para a paginação não
mentir sobre quantos registros existem (o count não conta o que a busca esconde).

### 4.6 Identify 3D pragmático (prisma vertical)

`FIND_NEAREST_FEATURE`: a feição herda o acesso do modelo dono (`JOIN ng.catalogo_3d ON id =
model_id`), filtra horizontal por `ST_DWithin(::geography, 300)` e ordena por distância vertical ao
intervalo `altitude_base/altitude_topo` (via `CASE`) e depois horizontal. Trata a feição como
prisma vertical, sem `ST_3DDistance`.

### 4.7 Escrita de permissões transacional (replace-set + auditoria do diff)

Em `tx()`: valida existência dos alvos (`SELECT id ... WHERE id = ANY($1::uuid[]) AND is_active`),
`DELETE` total + `INSERT ... SELECT` (substitui o conjunto), e `createAudit` com estado anterior.
Exige admin antes. **Reconciliação de membros de grupo** (`UPDATE_GROUP_MEMBERS`) calcula
`members_to_remove` (`NOT IN unnest`) e `members_to_add` (`EXCEPT`) e só insere os novos, numa
instrução CTE diff/EXCEPT — em vez de apagar tudo e recriar.

---

## 5. Apêndice C — Auditoria e API keys — para a fase-5

### 5.1 `ng.audit_trail` (verbatim)

Colunas fixas para o que sempre existe (quem, o quê, quando, ip, user_agent) + `details JSONB` para
o resto. `actor_id`/`target_name` são **snapshots SEM FK**, então o log sobrevive a delete da
entidade.

```sql
CREATE TABLE ng.audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(50) NOT NULL,            -- CHECK numa lista fechada
  actor_id UUID NOT NULL,                 -- SEM FK: sobrevive a delete do usuario
  target_type VARCHAR(20),                -- CHECK ('USER','GROUP','MODEL','ZONE','SYSTEM')
  target_id UUID,
  target_name VARCHAR(255),               -- snapshot do nome no momento do evento
  details JSONB,                          -- payload livre (ex.: before/after)
  ip VARCHAR(45) NOT NULL,                -- cabe IPv6
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- indices: (actor_id), (target_type,target_id), (action), (created_at DESC),
--          composto (created_at DESC, action), e GIN (details)
```

### 5.2 `createAudit(req, params, t?)` — helper transacional (contrato)

O 3º parâmetro **opcional** aceita o `t` (ITask de uma transação pg-promise) ou o `db` global. Assim
**a auditoria participa da transação do negócio**: se a operação reverte, o audit reverte junto.

- **`params` (`AuditParams`):** `{ action, actorId, targetType?, targetId?, targetName?, details? }`.
- O helper grava também `req.ip`, `req.get('user-agent')` e timestamp.
- **No padrão JS do repo** (cross-ref `_padroes.md` §4) — assinatura sugerida:

```javascript
// src/utils/audit.js (a criar na fase-5)
import { db } from '../database/index.js';
import * as Q from './audit.queries.js';

export async function createAudit(req, params, t = db) {
  const { action, actorId, targetType, targetId, targetName, details } = params;
  await t.none(Q.INSERT_AUDIT, [
    action, actorId, targetType ?? null, targetId ?? null,
    targetName ?? null, details ? JSON.stringify(details) : null,
    req.ip, req.get('user-agent') ?? null,
  ]);
}

// uso dentro de uma transação de negócio:
await tx(async (t) => {
  await t.none(Q.DELETE_OLD_PERMS, [zoneId]);
  await t.none(Q.INSERT_NEW_PERMS, [zoneId, userIds]);
  await createAudit(req, { action: 'ZONE_PERMISSIONS_UPDATED', actorId: req.user.id,
                           targetType: 'ZONE', targetId: zoneId, details: { before, after } }, t);
});
```

> **Distinção importante:** auditoria (`audit_trail`, trilha de **negócio**, no banco, consultável)
> é separada de **logging** (operacional, em arquivo, por categoria — ver `EnvironmentManager` /
> pino multistream da fase-5).

### 5.3 `ng.api_key_history` (verbatim)

A key viva fica na linha quente de `users`; ao rotacionar, a antiga vira linha com `revoked_at`.

```sql
CREATE TABLE ng.api_key_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ng.users(id),
  api_key UUID NOT NULL,
  created_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, revoked_by UUID REFERENCES ng.users(id),
  UNIQUE (user_id, api_key)
);
```

**Rotação atômica em CTE:** move a chave antiga para `api_key_history` com `revoked_at/by` e grava a
nova com `RETURNING`, na mesma query. **Pré-validar formato** (regex de UUID na key) antes do banco.

### 5.4 Soft-state em vez de delete

`users.is_active BOOLEAN` (desativa, não deleta — preserva integridade e auditoria). Mesma política
do `ebgeo_backend` atual para usuários.

---

## 6. Apêndice D — Contrato da API 360 a NÃO QUEBRAR — para a fase-7

> **Decisão (D3 em `00-visao-geral.md`):** o `ebgeo_360` fica **separado** atrás do gateway.
> Unifica-se **apenas o JWT** (mesmo emissor/segredo; payload `{sub, org, role, login}` alinhado:
> `org` = organization_id, `role ∈ {system_admin, om_data_admin}`). **Zero mudança de schema do
> 360.** O contrato abaixo é o que o `ebgeo_web` (viewer Three.js) JÁ CONSOME.

Base `/api/v1`, healthcheck `/health` fora do prefixo. **Envelope de erro uniforme**
`{ "error": "..." }` (500 nunca vaza detalhe).

### 6.1 Shape do metadado de foto (verbatim — consumido pelo viewer Three.js)

```json
{ "camera": { "id": "", "img": "", "display_name": "", "lon": 0, "lat": 0, "ele": 0,
              "heading": 0, "height": 0,
              "mesh_rotation_y": 0, "mesh_rotation_x": 0, "mesh_rotation_z": 0,
              "distance_scale": 0, "marker_scale": 0, "floor_level": 0, "calibration_reviewed": false },
  "projectSlug": "", "captureDate": "",
  "targets": [ { "id": "", "img": "", "lon": 0, "lat": 0, "ele": 0, "display_name": "",
                 "icon": "next", "next": true, "is_original": true,
                 "distance": 0, "bearing": 0,
                 "override_bearing": null, "override_distance": null, "override_height": null } ] }
```

### 6.2 Pontos sensíveis a quebra (manter ESTÁVEIS — verbatim)

1. Campos **planos** em `camera` (não aninhar em `position`/`orientation`); nomes exatos
   `mesh_rotation_y/x/z`, `distance_scale`, `marker_scale`, `floor_level`, `calibration_reviewed`.
2. `previewThumbnail` **relativo sem `/api/v1`** (o cliente concatena com `serviceUrl`).
3. Em targets: `bearing`/`distance` (NÃO `bearing_deg`/`distance_m`, que são o shape interno do
   banco), `override_*` número ou `null`, `next`/`is_original` booleanos, `icon: "next"`.
4. Faixas de validação de calibração (mudar uma faixa rejeita valores antes aceitos).
5. **ETag de imagem** `"{uuid}-{quality}-{sizeBytes}"` e o contrato **206/416/304** com
   `Accept-Ranges`/`Content-Range`.
6. Envelope de erro `{ "error": "..." }` e os códigos (**401/403/404/409/416**).

O viewer depende da ordem de rotação Euler **ZXY** e do modelo de chão plano (`ele` não é usado
para projeção, só informativo; overrides projetam no plano de chão).

### 6.3 ETag/Range — contrato do endpoint de imagem (verbatim)

`GET /api/v1/photos/:uuid/image?quality=full|preview`:
- **ETag O(1) SEM ler o BLOB**: `"{uuid}-{quality}-{sizeBytes}"` (sizeBytes vem de
  `full_size_bytes`/`preview_size_bytes` no index.db). Imagem imutável pós-ingestão.
- **304 short-circuit ANTES do BLOB**: `If-None-Match` casando responde 304 + headers sem carregar
  imagem.
- **Cache-Control**: `public, max-age=31536000, immutable`.
- **Range 206**: parse `bytes=start-end`; 206 com `Content-Range`; 416 com
  `Content-Range: bytes */len`; 200 inteiro sem Range. `Accept-Ranges: bytes` em 200/206/304.
- Compressão **não** recomprime WebP (`@fastify/compress` restrito a `text/*` e JSON).

### 6.4 Endpoints 360 que o gateway roteia (resumo)

- **Leitura pública:** `GET /projects`, `/projects/:slug`, `/thumbnails/:slug.webp`,
  `/photos/:uuid` (metadados), `/photos/:uuid/image?quality=full|preview`, `/photos/by-name/:nome`,
  `/tiles/fotos.geojson`, `/pmtiles/fotos.pmtiles`.
- **Escrita/calibração (auth):** PUT calibration/height/rotation-x/z/distance-scale/marker-scale/
  reviewed; targets override/visibility/criar/deletar; DELETE photo (soft); batch-calibration;
  nearby; metadata/position.
- **Admin (auth + OM):** upload, delete projeto, status enabled/disabled, listar projetos da OM;
  gestão de OM/usuários (system_admin).
- **Auth:** `POST /auth/login` (rate-limit 10/min, `{token, user}`), `GET /auth/me`,
  `POST /auth/logout`.

O gateway (NGINX) roteia `/api/v1/photos`, `/projects`, `/tiles`, `/pmtiles`, `/admin`,
`/calibration` para o container do 360 (porta 8081) e repassa o header `Authorization`. O
`ebgeo_web` aponta `streetView360.serviceUrl` para a URL atrás do gateway. Documentar no
docker-compose a **dualidade de backup**: `pg_dump` do núcleo vs cópia de arquivo `.db` por missão
via rsync.

---

## 7. Apêndice E — Shape do `config.js` — para a fase-2

### 7.1 Config de runtime do backend (`src/config.js` ATUAL — fato verificado)

`src/config.js:13-47` — objeto `Object.freeze` aninhado, helpers `required(key)` (fail-fast) e
`optional(key, fallback)`, getters `isDev/isProd/isTest`. **Chaves de topo atuais:**

```
port, nodeEnv, logLevel,
db   { connectionString(required DATABASE_URL), poolMin, poolMax },
jwt  { secret(required JWT_SECRET), accessExpiry, refreshExpiry },
cors { origin },
images { dir, maxSizeMb },
ws   { heartbeatIntervalMs, heartbeatTimeoutMs }
```

> A partir da fase-0, adotar `validateEnvVariables()` fail-fast agrupado por contexto (Database,
> Authentication, Security): `JWT_SECRET >= 32 chars` em prod, portas válidas, origins válidas.
> `required()` hoje só cobre `DATABASE_URL` e `JWT_SECRET`.

### 7.2 Shape do `config.js` DO FRONTEND (contrato de `GET /api/config` — fase-2)

> **Atenção:** este é o `config.js` do **`ebgeo_web`** (frontend, ~419 linhas), **não** o
> `src/config.js` do backend. A fase-2 cria `GET /api/config` (rota pública, montada ANTES do auth
> global — ver `_padroes.md` §6) servindo um JSON com **exatamente o mesmo shape** para não quebrar
> os call-sites nem o `config.helpers.js` do frontend.

**Chaves de topo (congeladas):**

```
app, features, services, search, basemaps, analysisLayers, dataLayers,
map2d, map3d, tilesets, streetView360
```

- **Blocos que são DADOS** (vêm de tabelas na fase-2): `tilesets`, `analysisLayers`, `dataLayers`,
  `basemaps`.
- **URLs de ambiente** (injetadas por config de deployment): `search` (apiUrl), `tileServer`,
  `streetView360.serviceUrl`, `terrain`.
- **Preferências de UI**: estáticas no payload (`app`, `features`, `map2d`, `map3d`).

### 7.3 PEGADINHA dos baselayers (crítico para a fase-2)

As **URLs reais dos tiles dos basemaps NÃO estão** no `config.js` — estão em
`ebgeo_web/src/js/baselayers/*.js` (**5 módulos** com OSM / demotiles / BDGEx WMS / Google
hardcoded). Para servir 100% da config, **esses styles também precisam ser absorvidos** no endpoint
`GET /api/config`. Os placeholders atuais (BDGEx público, OSM, Google, demotiles) **não podem ir
para produção militar** — reapontar para os servidores internos da DGEO.

---

## 8. Apêndice F — UI de admin (consumidor downstream): endpoints que o backend deve prover

> **A UI de admin é um projeto FRONTEND React SEPARADO** (`ebgeo_web_2_admin`). **O backend
> `ebgeo_backend` NÃO implementa UI.** Esta seção lista, **por tela**, os **endpoints que o backend
> deve prover** (sob `/api/v1`), e os **padrões de scaffold** do frontend que valem ser carregados
> (apenas como contexto — não são tarefas do backend). Toda a área de admin exige `role: 'admin'`.

### 8.1 Endpoints por tela (CONTRATO que o backend deve prover)

| Tela | Método + Endpoint | Notas |
|------|-------------------|-------|
| **Login** | `POST /api/v1/auth/login` → `{ user, token }` | bloqueia não-admin no frontend ("Acesso restrito") |
| **Dashboard de saúde** | `GET /api/v1/admin/health` | 4 cards de status (Sistema, Ambiente, Uptime, versão Node) + 4 cards de serviço (Database/FileSystem/Auth/API com status colorido). Polling 30s |
| | `GET /api/v1/admin/metrics` | usuários ativos, grupos, requisições 24h, conexões de banco (ativas/ociosas), CPU/memória. Polling 60s |
| **Usuários** | `GET /api/v1/users` | lista paginada (DataTable server-side) |
| | `POST /api/v1/users` | criar |
| | `GET /api/v1/users/:id` | detalhes com grupos / permissões de modelo / zonas ("via direto"/"via grupo") |
| | `PUT /api/v1/users/:id` | atualizar; toggle ativo/inativo (**NÃO há delete real**) — via `is_active` |
| | `POST /api/v1/users/:id/reset-password` | reset de senha pelo admin |
| **Grupos** | `GET/POST /api/v1/groups`, `GET/PUT/DELETE /api/v1/groups/:id` | CRUD; **DELETE real** (diferente de usuários) |
| | (membros) `PUT /api/v1/groups/:id` ou rota dedicada de membros | `UPDATE_GROUP_MEMBERS` por **reconciliação** (diff/EXCEPT) |
| **Zonas** | `GET/POST /api/v1/zones`, `GET/PUT/DELETE /api/v1/zones/:id` | CRUD; `geom` GeoJSON `Polygon`/`MultiPolygon`; `area_km2` formatado |
| | (permissões) rota de permissões de zona (usuários + grupos) | replace-set transacional (ver §4.7) |
| **Catálogo 3D (permissões)** | `GET /api/v1/catalog3d` + rota de permissões do modelo | gerencia **só permissões** (não cria/deleta modelo): `access_level public/private` + usuários + grupos |
| **Logs** | `GET /api/v1/admin/logs` | filtros: nível, categoria, limite (50/100/500/1000); sem paginação |
| **Auditoria** | `GET /api/v1/admin/audit` | **paginação server-side** + date range (dois DatePicker) + tipo de ação |
| **Perfil** | `PUT /api/v1/users/me` | resposta traz **novo token** (re-loga); política de senha forte (8+, minúscula, maiúscula, número, especial) |
| | `PUT /api/v1/users/:id/password` | troca de senha |

> **Já existem hoje no `ebgeo_backend`** (cross-ref `CLAUDE.md`): rotas de usuários (`GET/POST/PUT
> /api/v1/users`, `GET /:id`, reset-password, desativar/reativar), perfil (`GET/PUT /users/me`,
> `PUT /users/me/password`) e resources. **Faltam** (dependem de fases): `groups`, `zones`,
> `catalog3d` permissões (**fase-6**), `admin/health`, `admin/metrics`, `admin/logs`,
> `admin/audit` (**fase-5**). Até essas fases, o frontend adapta as telas aos endpoints existentes.

### 8.2 Resposta de listagem esperada pelo `DataTable<T>` (contrato)

O scaffold espera respostas paginadas no shape `{ items, total, page, limit }` (o `DataTable`
combina direto com `total/page/limit`). A UI converte `page` 0-based → API 1-based e mapeia filtro
`'all'` → `undefined`. **Recomendação:** padronizar as listagens de admin nesse envelope. (Atenção:
o restante do backend usa `{ data: ... }` — para as telas de admin, adotar `{ items, total, page,
limit }` ou documentar o mapeamento no frontend.)

### 8.3 Padrões de scaffold do frontend a copiar (contexto — não é trabalho do backend)

- **axios central + interceptors** (`services/api.ts`): 401 (fora do login) → limpa token e
  `/login`; 403 → `/login?error=forbidden`; 429 → `/login?error=ratelimit`; 422/400 → mensagem de
  validação; erros de rede viram códigos (`TIMEOUT/DNS/SSL/NETWORK`).
- **`contexts/` (só `createContext` + tipos) vs `providers/` (lógica/reducer)** + hook de acesso com
  **guard** (`useAuth`/`useGlobal`/`useTheme` fazem `useContext` + `throw` se fora do provider).
  Três contexts: `AuthContext`, `GlobalContext` (reducer de UI), `ThemeContext`.
- **`AuthProvider` admin-only**: no mount faz `GET /users/me` e **só restaura sessão se
  `role === 'admin'`**, senão remove o token. `RequireAuth`/ProtectedRoute com prop `requireAdmin` +
  **timer de inatividade de 30 min**.
- **Service por entidade** (objeto literal tipado `list/getDetails/create/update/delete` sobre o
  axios central).
- **Tipos por entidade** (`types/<entidade>.ts`): `ListParams`, `<Entidade>Details`, `CreateXDTO`,
  `UpdateXDTO`, `XListResponse {items,total,page,limit}`.
- **Hook `use<Feature>`**: fetch + paginação + filtros (`useDebounce` 300ms + **gate de 3 chars** na
  busca) + ordenação + CRUD; converte UI 0-based → API 1-based; `'all'` → `undefined`.
- **`DataTable<T>` genérico**: colunas tipadas (`Column<T>: id, label, align, format(value,row),
  sortable`), paginação server-side (5/10/25), ordenação, **loading não-destrutivo**
  (`LinearProgress` sobreposto, dados antigos visíveis), `EmptyState`.
- **Quarteto de página**: `index.tsx` (orquestra) + `Table` + `FilterBar` +
  `Dialog/DetailsDialog/DeleteDialog`.
- **Roteamento lazy + Suspense** (`createBrowserRouter` + `lazy()` + `Suspense fallback`) +
  `DashboardLayout` responsivo (AppBar fixa + Drawer 240px) + `ThemeProvider` dark/light persistido.

---

## 9. Apêndice G — Anti-padrões a EVITAR (consolidado dos 6 docs)

> Material **negativo**: padrões que aparecem nas tentativas antigas / nos serviços-fonte e que
> **NÃO devem ser copiados** para o backend. Aplica-se a todas as fases.

### 9.1 SQL e schema

- **Sanitização "blunt" que apaga `'";` de toda string** (`inputSanitizer`): corrompe conteúdo
  legítimo e é desnecessária (queries já são parametrizadas via pg-promise). **Confiar em query
  parametrizada** para SQLi; sanitizar só na saída.
- **`ORDER BY $:raw`** (interpolação raw da direção, ex.: `LIST_GROUPS ... $5:raw`): a segurança
  passa a depender 100% da whitelist. **Preferir a direção dentro de um `CASE`** (como
  geographic/catalog3d fazem).
- **Mistura `gen_random_uuid()` + `uuid_generate_v4()`**: padronizar em **`gen_random_uuid()`**.
- **CTE de permissão duplicado em 4 arquivos**: centralizar num predicado/função/view SQL única.
- **Idempotência check-then-insert sem `UNIQUE`**: corrida (race). Garantir constraint
  `UNIQUE`/`ON CONFLICT` (cross-ref idempotência do log de `operations`, fase-1).
- **Esquecer `ng.refresh_busca()` pós-carga**: `cluster_id`/`tipo_peso` ficam nulos e a busca
  degrada **sem erro**. Tornar obrigatório no job FME.
- **SRID misto não documentado** (nomes `4674`, edificações `4326`): manter e **documentar**.
- **`criterio_busca.md` contradiz o código** (6 vs 7 critérios): o **código manda** — sincronizar/
  descartar o doc ao absorver.
- **Schema único morto/divergente**: não manter schema declarado que diverge do que roda.
- **Batch transacional sem passar o `t` adiante**: causa `t.metodo is not a function`. Sempre
  encadear o `t` da `tx()` nas chamadas internas (inclusive `createAudit(req, params, t)`).

### 9.2 Segurança e API

- **Ausência de versionamento de API**: adotar **`/api/v1`** desde o início.
- **Token em `localStorage`** (frontend): vulnerável a XSS — **preferir cookie `httpOnly`**.

### 9.3 Arquitetura / infra

- **GDAL no Node** (endpoint Python+GDAL de PDF georreferenciado): não trazer para dentro do Node;
  PDF georreferenciado fica como **microsserviço separado** atrás do gateway, ou some.
- **BLOB grande em `bytea`/Postgres** (os 41 GB do 360): nunca compensa — manter em
  arquivo/SQLite, Postgres guarda só o ponteiro (cross-ref fase-7, decisão D3).
- **Estado de tempo real em memória sem Redis**: não escala horizontal. As salas WS hoje vivem só na
  memória do processo (cross-ref fase-8, Redis opcional).

### 9.4 Proveniência (cuidado operacional)

- **Portar o gazetteer do working tree local** em vez de `origin/main`: o local está atrasado (busca
  de 2 critérios). **Sempre portar de `origin/main`** (`git show origin/main:...`).

### 9.5 Bugs do `ebgeo_web_2_admin` a NÃO herdar (frontend)

- **Zonas sempre faz `POST` mesmo em edição** (`updateZonePermissions` nunca chamado).
- **N+1 ao abrir dialogs de edição** (um `getDetails` por membro).
- **`ConfirmDialog` sem variante destrutiva.**
- **API keys no tipo `UserDetails` mas sem UI.**
- **Logs em UTC e Auditoria em fuso local** (unificar).
- Considerar **TanStack Query** para enxugar os hooks `use<Feature>` (cada feature reinventa
  loading/erro).

---

## 10. Riscos e cuidados (referência)

| Risco | Mitigação |
|-------|-----------|
| Re-porte da busca quebrar o filtro de acesso (vazar nomes privados) | Manter o `WHERE` de acesso na CTE `candidatos`, **antes** do `LIMIT 500`; teste com usuário sem permissão (`_padroes.md` §9) |
| Alterar pesos/forma da busca de 7 critérios | Tratar a SQL da §3.7 como **congelada**; mudança exige teste de regressão contra dados reais |
| Quebra de contrato com o frontend (360/busca/config) | Tratar os shapes (§3.10, §6, §7) como **contratos congelados**; teste de contrato |
| Esquecer `ng.refresh_busca()` pós-carga | Tornar passo obrigatório do job FME |
| Auditoria fora da transação do negócio | Sempre passar o `t` para `createAudit(req, params, t)` (§5.2) |
| Misturar JSONB do atlas com PostGIS do `ng` | Schemas isolados; PostGIS é **aditivo**, não converter o atlas |

---

## 11. Definition of Done desta "fase"

Este documento é referência pura — não há código a entregar. Considera-se "feito" quando:

- [ ] Todo o material verbatim dos 6 docs-fonte que precisa sobreviver está embutido aqui (SQL da
      busca de 7 critérios, `f_unaccent`, `recomputar_clusters`, hierarquia `tipo_peso`, schema `ng`;
      schema de acesso geográfico + CTE de autorização + filtro espacial; `audit_trail` +
      `createAudit` + `api_key_history`; contrato 360; shape do `config.js` + pegadinha dos
      baselayers; spec de endpoints da UI de admin; anti-padrões).
- [ ] Cada apêndice cita explicitamente a **fase consumidora** (cross-ref).
- [ ] Está claro que a **UI de admin é um projeto frontend SEPARADO** e que o backend só **provê
      endpoints**.
- [ ] Os 6 documentos-fonte podem ser deletados sem perda de informação load-bearing.
