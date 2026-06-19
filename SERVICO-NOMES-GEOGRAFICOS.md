# `servico_nomes_geograficos`: analise e plano de absorcao

Data: 2026-06-14
Companheiro de `AVALIACAO-REAPROVEITAMENTO.md` e `IDEIAS-EBGEO-WEB-2.md`.

O `servico_nomes_geograficos` (org `1cgeo`, `https://github.com/1cgeo/servico_nomes_geograficos`)
e a **fonte de verdade da busca de toponimos** do EBGeo e o destino a ser absorvido como modulo
PostGIS do backend unico. Este documento mapeia o que ele faz e como porta-lo sem regressao.

## AVISO: o clone local esta atrasado, use `origin/main`

O HEAD local (`74d4a95 esqueleto exportacao pdf python`) esta **2 commits atras** do `origin/main`
e tem a busca ANTIGA (2 criterios). Tudo que importa esta em `origin/main`:
- `010cbb0 melhoria busca de nomes`: reescreve a busca para 7 criterios, adiciona `unaccent`,
  `cluster_id`, `tipo_peso`, e **remove** `src_python/app.py`.
- `5bc5a5c fix peso`: rebalanceia os pesos.

Sempre portar de `origin/main` (`git -C ... show origin/main:src/index.js`), nunca do working tree
local. Atualizar o clone (`git pull`) antes de qualquer trabalho.

| Arquivo | HEAD local | origin/main |
|---|---|---|
| `src/index.js` | busca de 2 criterios (sim 0.7 + dist 0.3) | **busca de 7 criterios com zoom** |
| `er/nomes_geograficos.sql` | sem unaccent/cluster_id/tipo_peso | com tudo |
| `er/migration_busca_v2.sql` | nao existe | existe |
| `er/criterio_busca.md` | nao existe | existe (DESATUALIZADO: descreve 6 criterios) |
| `src_python/` (PDF Flask/GDAL) | existe | removido |

---

## 1. Visao geral e stack

Microsservico HTTP read-only que serve quatro capacidades ao `ebgeo_web` (Cesium):
1. **Busca de toponimos** (`/busca`): autocomplete com ranking, dado termo + centro + zoom.
2. **Clique em feicao 3D** (`/feicoes`): dado (lat, lon, z), identifica a edificacao clicada.
3. **Catalogo 3D** (`/catalogo3d`): lista paginada com full-text dos modelos/tiles 3D.
4. **Export PDF georreferenciado** (`src_python/`): Flask + GDAL **separado**, removido no origin.

Stack: Express 4.19, pg-promise 11.9, express-validator 7.2, cors, dotenv. **Cluster**: master faz
fork de `N = max(min(floor(numCPUs/3), 8), 1)` workers; no origin/main reinicia worker morto
(`cluster.isPrimary`). **Pool por worker**: `MAX_DB_CONNECTIONS` (env, default 80) dividido entre os
workers. Porta 3000 (origin) / 3001 (local). Log de acesso append em `src/api-access.log` (origin
usa `createWriteStream` persistente + shutdown gracioso em SIGTERM/SIGINT com `pgp.end()`).

---

## 2. Schema (`ng`, versao origin/main)

Extensoes: `postgis`, `pg_trgm`, `uuid-ossp`, **`unaccent`**. Schema `ng`.

Wrapper IMMUTABLE para indexar sem acento (o `unaccent` nativo e so STABLE, nao indexa):
```sql
CREATE OR REPLACE FUNCTION ng.f_unaccent(text)
RETURNS text AS $$ SELECT public.unaccent('public.unaccent', $1) $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;
```

**`ng.nomes_geograficos`**: `id uuid PK`, `nome VARCHAR(255)`, `municipio/estado/tipo VARCHAR(255)`,
`cluster_id INTEGER`, `tipo_peso FLOAT DEFAULT 0.1`, `geom GEOMETRY(POINT, 4674)` (SIRGAS 2000).
Indices: `idx_ng_geom` GIST(geom); `idx_ng_nome_unaccent_trgm` **GIN(`ng.f_unaccent(nome)`
gin_trgm_ops)** (indice funcional); `idx_ng_tipo`; `idx_ng_cluster (nome, tipo, cluster_id)` (serve
o dedup); `idx_ng_tipo_peso (tipo_peso DESC)`.

**`ng.edificacoes`**: `id uuid`, `nome/municipio/estado/tipo`, `altitude_base/altitude_topo numeric`,
`geom GEOMETRY(POLYGON, 4326)` (note: SRID 4326, diferente de nomes), `CHECK (altitude_base <=
altitude_topo)`. Indices: GIST(geom), btree(altitude_base, altitude_topo).

**`ng.catalogo_3d`**: `id uuid`, `name`, `description TEXT`, `municipio/estado/thumbnail`,
`palavras_chave TEXT[]`, `url`, `lon/lat/height/heading/pitch/roll NUMERIC`, `type VARCHAR(50)`
('Tiles 3D' | 'Modelos 3D' | 'Nuvem de Pontos'), `heightoffset`, `maximumscreenspaceerror`,
`data_criacao`, `search_vector tsvector`, `style JSONB`. Indices: GIN(search_vector), (data_criacao
DESC), (type).

Funcoes/triggers:
- **`ng.calcular_tipo_peso`** (trigger BEFORE INSERT OR UPDATE OF tipo): mapeia o `tipo` textual num
  peso 0.1 a 1.0. Hierarquia: Cidade 1.0; vila/povoado 0.9; rio/lago/represa 0.85; serra/morro/ilha/
  pico/ponta/praia 0.8; Nome local 0.75; estrada/rodovia 0.7; arroio/canal/cachoeira 0.6; UC/terra
  indigena 0.55; Agro 0.5; ponte/porto/Rod/Aero 0.4; saude/ensino/seguranca/admin 0.35; energia 0.3;
  comercio/industria/lazer 0.25; saneamento/comunicacao/duto 0.2; religioso/cemiterio 0.15; default 0.1.
- **`ng.recomputar_clusters()`** (rodar manualmente apos cada carga):
```sql
WITH clusters AS (
  SELECT id, ST_ClusterDBSCAN(geom, eps := 0.045, minpoints := 1)
    OVER (PARTITION BY nome, tipo) AS cid
  FROM ng.nomes_geograficos
)
UPDATE ng.nomes_geograficos n SET cluster_id = c.cid FROM clusters c WHERE n.id = c.id;
```
DBSCAN com eps ~5 km particionado por (nome, tipo): agrupa ocorrencias do mesmo toponimo proximas
(mesma feicao real registrada varias vezes em folhas vizinhas).
- **`catalogo_3d_search_vector_update`** (trigger): `setweight(name, A) || description B ||
  municipio/estado C || palavras_chave B`.

`er/migration_busca_v2.sql` aplica idempotentemente em banco existente o que o schema novo ja traz
(unaccent, f_unaccent, ADD COLUMN cluster_id/tipo_peso, DBSCAN inline, UPDATE tipo_peso, refaz indices).

---

## 3. A busca de 7 criterios (a joia da coroa)

Validacao: `q` 3 a 200 chars, `lat`/`lon` float obrigatorios, `zoom` int 1 a 20 opcional. SQL:

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

Os 7 criterios (somam 1.00):

| # | Criterio | Peso |
|---|---|---|
| 1 | Match exato (`nome_clean = term`, sem acento) | 0.20 |
| 2 | Prefixo (`LIKE term%`) | 0.10 |
| 3 | Contem (`LIKE %term%`) | 0.15 |
| 4 | Similaridade trgm | 0.10 |
| 5 | Precisao por comprimento | 0.15 |
| 6 | Tipo ajustado por zoom | 0.10 |
| 7 | Proximidade com decaimento | 0.20 |

- **Decaimento por zoom**: `decay_dist = 50000 * 2^(10 - zoom)` metros. Zoom 10 = 50 km (padrao);
  zoom 4 (pais) ~3.200 km (proximidade quase nao diferencia); zoom 16 (bairro) ~780 m (so o muito
  perto pontua). Sem zoom: 50 km e `zoom_factor = 0`.
- **`zoom_factor`** = `clamp((zoom-4)/14, 0, 1)`. Em zoom alto neutraliza o `tipo_peso` (todos
  convergem para 0.5): perto vence, seja capital ou escola.
- **Dedup**: `DISTINCT ON (nome, tipo, cluster_id)` por `dist ASC`: uma linha por feicao real.
- **LIMIT**: 500 candidatos, 5 finais.

ATENCAO: `er/criterio_busca.md` esta DESATUALIZADO (descreve 6 criterios, pesos pre-`fix peso`). O
codigo manda. Ao absorver, corrigir o doc para os 7 criterios acima.

---

## 4. `/feicoes` e `/catalogo3d`

**`/feicoes`** (clique 3D em edificacao). Params `lat`, `lon`, `z`. Acha a edificacao a ate 3 m do
clique cuja faixa de altitude melhor contem o `z`:
```sql
WHERE ST_DWithin(e.geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, 3)
-- z_distance: 0 se z dentro de [altitude_base, altitude_topo], senao distancia vertical a faixa
ORDER BY z_distance ASC, xy_distance ASC LIMIT 1
```
Retorna `{ id, nome, municipio, estado, tipo, altitude_base, altitude_topo, z_distance, xy_distance }`
ou `{ message: "Nenhuma edificacao encontrada..." }`. (origin usa `ST_DWithin`, mais limpo que o
`ST_Buffer + ST_Intersects` do HEAD local.)

**`/catalogo3d`** (full-text + paginacao). Params `q` (opcional), `page` (default 1), `nr_records`
(1 a 100, default 10). Com `q`: `WHERE search_vector @@ plainto_tsquery('portuguese', $1)` ordenado
por `ts_rank(...) DESC, data_criacao DESC`. `COUNT(*)` e `SELECT` em paralelo. Resposta:
```json
{ "total": N, "page": P, "nr_records": K, "data": [ {
  "id","name","description","thumbnail","url","lon","lat","height","heading","pitch","roll",
  "type","heightoffset","maximumscreenspaceerror","data_criacao","municipio","estado",
  "palavras_chave","style" } ] }
```

---

## 5. Contrato que o ebgeo_web JA CONSOME (nao pode quebrar)

```
GET /busca?q=<termo>&lat=<lat>&lon=<lon>[&zoom=<1..20>]
-> array de ate 5: [ { "tipo","nome","municipio","estado","longitude","latitude" } ]
```
No origin cada item tambem traz `score`; o conjunto `{tipo,nome,municipio,estado,longitude,latitude}`
e estavel. Os outros dois endpoints (`/feicoes`, `/catalogo3d`) tem os shapes das secoes 4.

---

## 6. Carga de dados (FME, externo)

`er/converte_nomes.fmw` (e `converte_nomes_3cgeo.fmw`) leem de um **PostGIS EDGV** (Topo 1.4) ~90
feature types `edgv.*` (toponimo fisiografico natural, texto generico, localidade), cruzam com
`insumos.municipio` para municipio/UF, derivam `nome/tipo/municipio/estado` e escrevem
`ng.nomes_geograficos` como multipoint. **Nao** populam `edificacoes` nem `catalogo_3d`. Pos-carga:
rodar `SELECT ng.recomputar_clusters();` (o `tipo_peso` entra pela trigger). `er/insert_teste.sql` e
seed manual de `ng.catalogo_3d` (~40 registros reais de OMs).

---

## 7. `catalogo_3d` e a distribuicao de modelos 3D

`ng.catalogo_3d` **e a fonte de verdade dos metadados de posicionamento e descoberta dos modelos
3D**, mas nao guarda os binarios. Guarda onde/como posicionar (`lon/lat/height`, `heading/pitch/roll`,
`heightoffset`, `maximumscreenspaceerror`, `type`, `style`) e os campos de descoberta (`name`,
`palavras_chave`, `thumbnail`, `search_vector`). O `url` aponta para o artefato servido separadamente,
com caminho relativo (`/aman/tileset.json`, `/estatua/estatua.glb`). Fluxo: Cesium chama
`/catalogo3d` -> recebe lista com `url` + pose -> busca o `tileset.json`/`.glb` e renderiza. Isto se
conecta diretamente com a Secao 3.5 do `AVALIACAO` (distribuicao 3D): este `catalogo_3d` deve ser a
fonte unica, e o `ebgeo_web` deixar de usar o `config.tilesets` hardcoded. Ao absorver, decidir quem
serve os binarios (host de estaticos com as URLs relativas, ou reescrever para absolutas).

---

## 8. O endpoint Python+GDAL de PDF (descartar ou separar)

`src_python/app.py` (Flask + GDAL + Pillow): `POST /api/export-georeferenced-pdf` recebe imagem
base64 + bounds + orientacao e devolve PDF georreferenciado (driver GDAL `PDF`, EPSG 4326, DPI 300).
**So existe no HEAD local; removido do origin/main**, e a rota nem existe no `index.js` Node.
Recomendacao: **nao absorver no Node** (GDAL nao roda em Node de forma sa). Se a feature for
requisito, conteinerizar como microsservico Flask atras do gateway sob `/api/pdf/`; senao, descartar
(o proprio historico ja removeu a rota). Tirar `debug=True` e CORS aberto se mantido.

---

## 9. Plano de absorcao (modulo PostGIS read-only)

Tratar nomes geograficos como **dado de referencia read-only**, em schema PostGIS `ng` proprio,
totalmente fora do mundo CRDT/JSONB do atlas. O usuario nunca edita nomes pelo app; a carga e
externa (FME). Sem CRDT, sem versao por feicao, sem geometria JSONB.

1. **Migracao** (consolidar `nomes_geograficos.sql` + `migration_busca_v2.sql` na ordem certa):
   `CREATE EXTENSION postgis, pg_trgm, unaccent, uuid-ossp`; criar schema `ng` e as 3 tabelas +
   `f_unaccent` + triggers + indices. Remover os `GRANT` hardcoded para `user_nomes_geograficos`
   (usar o role do backend). PostGIS coexiste com o JSONB do atlas (schemas separados).
2. **Modulo** `src/modules/nomes` (routes/controller/queries/schemas) seguindo o padrao do backend.
   Copiar literalmente as queries do `origin/main` (busca de 7 criterios, `/feicoes` com `ST_DWithin`,
   `/catalogo3d`). Sao SQL puro, portam sem traducao.
3. **Rotas com namespace** (`/api/v1/nomes/busca`, `/feicoes`, `/catalogo3d`) para nao colidir e
   permitir rewrite no NGINX dos paths nus antigos (`/busca`) durante a transicao.
4. **Auth**: hoje o servico nao tem nenhuma. No backend, entram sob o middleware de auth (leitura
   liberada a qualquer autenticado; manter log de acesso por IP para auditoria).
5. **Carga**: continua via FME (job externo). Encapsular pos-carga numa funcao `ng.refresh_busca()`
   (DBSCAN + recalculo de tipo_peso) e torna-la passo obrigatorio do job, senao `cluster_id`/
   `tipo_peso` ficam nulos e a busca degrada silenciosamente.

Esforco: **1 a 2 semanas** (medio). O codigo de aplicacao e simples; o trabalho e habilitar PostGIS
na infra, consolidar a migracao, namespacing + atualizar clientes, plugar auth, e uma bateria de
testes de regressao da busca contra dados reais.

---

## 10. Ideias priorizadas a carregar

1. **Busca de 7 criterios + dedup por cluster + decaimento/compressao por zoom** (de `origin/main`).
   O ativo central. Esforco medio (1 query + 1 rota + migracao; o grosso e teste de regressao).
2. **`migration_busca_v2.sql`**: `f_unaccent` IMMUTABLE + GIN trgm, `cluster_id` via DBSCAN,
   `tipo_peso` por hierarquia EDGV. Pre-requisito da ideia 1.
3. **Schema `ng` PostGIS read-only isolado, fora do CRDT/JSONB**, com auth.
4. **Full-text PT-BR do catalogo 3D** (tsvector + pesos + trigger + `ts_rank`) e a rota como indice
   de descoberta dos modelos (fonte de verdade do 3D).
5. **`/feicoes` (clique 3D com desempate por altitude)** na forma `ST_DWithin`.
6. **Padroes operacionais do origin/main**: pool dimensionado, respawn de worker, shutdown gracioso,
   validacao express-validator em todas as rotas.

---

## Cuidados / anti-padroes

- **Proveniencia**: portar de `origin/main`, nunca do working tree local (revertido). Risco no 1.
- **`criterio_busca.md` contradiz o codigo** (6 vs 7 criterios). Sincronizar ao absorver.
- **Esquecer o `refresh_busca()` pos-carga** deixa `cluster_id`/`tipo_peso` nulos e degrada a busca
  sem erro. Tornar obrigatorio no job FME.
- **SRID misto** (nomes 4674, edificacoes/clique 4326): manter e documentar; validar a unidade do
  `z` do `/feicoes` contra o dado real (tolerancia de 3 m).
- **Colisao de rota**: os paths sao nus (`/busca`). Namespacing + rewrite no NGINX, mapeando os
  consumidores antes de renomear.
- **GDAL no Node**: nao trazer; PDF fica separado ou some.
