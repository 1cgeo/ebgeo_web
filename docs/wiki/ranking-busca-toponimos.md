# Ranking da busca de topônimos (7 critérios)

O score de `/nomes/busca` é a soma ponderada e congelada de 7 critérios (exato, prefixo, contém, trigram, precisão por comprimento, tipo ajustado por zoom, proximidade com decaimento) sobre candidatos pré-filtrados por trigram e deduplicados por cluster.

## Onde o ranking vive

Tudo acontece em **uma única query SQL**, `BUSCA`, em `src/modules/nomes/nomes.queries.js:9-52` (backend `ebgeo_backend`). Não há reordenação em JavaScript: o service só repassa as linhas (`nomes.service.js:6-9`) e o controller devolve o **array nu**, sem envelope `{ data }` (`nomes.controller.js:7-11`). Ver [[gazetteer-nomes-geograficos]] para o módulo inteiro e [[sintese-contratos-congelados]] para a regra de não envelopar.

O comentário no topo do arquivo é explícito: SQL portado **verbatim** do `servico_nomes_geograficos`, pesos somam 1.00 e são congelados (`nomes.queries.js:2-3`). Mexer em um peso muda a ordem que o frontend já consome, então só com teste de regressão contra dados reais.

## O pipeline em 3 estágios

1. **CTE `q`** (`nomes.queries.js:10-14`) calcula dois escalares derivados do `zoom`:
   - `decay_dist = 50000 * 2^(10 - zoom)` metros (sem `zoom`: 50000).
   - `zoom_factor = clamp((zoom - 4) / 14, 0, 1)` (sem `zoom`: 0).
2. **CTE `candidatos`** (`:15-29`) faz o pré-filtro `similarity(f_unaccent(nome), term) > 0.25`, aplica o filtro de acesso embutido no SQL, ordena por `sim DESC, dist ASC` e corta em `LIMIT 500`.
3. **CTE `dedup`** (`:30-36`) faz `DISTINCT ON (nome, tipo, cluster_id) ... ORDER BY nome, tipo, cluster_id, dist ASC`, ou seja, uma linha por feição real, ficando a ocorrência mais próxima do centro do mapa.
4. **SELECT final** (`:38-51`) soma os 7 termos e faz `ORDER BY score DESC LIMIT 5`.

O corte importante: **o score dos 7 critérios só roda depois do top-500**. Se um resultado ótimo por proximidade cair fora dos 500 candidatos ordenados por `sim DESC, dist ASC`, ele nunca chega a ser pontuado. Em termos genéricos e muito frequentes (`"rio"`, `"santa"`), o top-500 é o gargalo real da qualidade, não os pesos.

## Os 7 termos, literais

| # | Critério | Expressão (`nomes.queries.js:40-47`) | Peso |
|---|----------|--------------------------------------|------|
| 1 | Exato | `lower(nome_clean) = lower(term)` | 0.20 |
| 2 | Prefixo | `nome_clean LIKE term \|\| '%'` | 0.10 |
| 3 | Contém | `nome_clean LIKE '%' \|\| term \|\| '%'` | 0.15 |
| 4 | Trigram | `sim` (similaridade contínua 0..1) | 0.10 |
| 5 | Precisão por comprimento | `1 - abs(len(term) - len(nome)) / GREATEST(len(term), len(nome), 1)` | 0.15 |
| 6 | Tipo ajustado por zoom | `COALESCE(tipo_peso, 0.1) * (1 - zoom_factor) + 0.5 * zoom_factor` | 0.10 |
| 7 | Proximidade | `1 / (1 + dist / decay_dist)` | 0.20 |

Pontos que costumam ser lidos errado:

- **Os critérios 1, 2 e 3 são cumulativos, não excludentes.** Um match exato dispara os três (0.20 + 0.10 + 0.15 = 0.45), mais `sim = 1.0` (0.10) e precisão 1.0 (0.15). Piso de 0.70 antes de tipo e proximidade. É por isso que o exato praticamente sempre vence, mesmo distante.
- **Critério 5 é simétrico**, penaliza nome mais curto que o termo tanto quanto mais longo. Na prática o termo é sempre prefixo curto, então funciona como "penaliza nome comprido".
- **Critério 7 nunca zera.** É uma hipérbole: `dist = decay_dist` vale 0.5 do peso (0.10), `dist = 9 * decay_dist` ainda vale 0.02. Distância nunca elimina, só desempata.
- **`f_unaccent` é aplicado dos dois lados** (`:11` e `:17`), acento no termo ou no dado é irrelevante. O wrapper existe porque o `unaccent` nativo é só `STABLE`, logo não indexável (`004_ng.sql:20-23`).

## O que `zoom` faz de verdade

`zoom` é opcional (`nomes.schemas.js:11`, inteiro 1..20, fora disso 422). Ele controla dois eixos independentes:

- **Raio de relevância** (critério 7): zoom 10 = 50 km, zoom 16 ≈ 781 m, zoom 4 = 3.200 km. Zoom alto encolhe o raio, então "perto vence" mesmo para feições irrelevantes.
- **Neutralização do tipo** (critério 6): `zoom_factor` vai de 0 (zoom ≤ 4) a 1 (zoom ≥ 18). Com `zoom_factor = 1`, o termo vira `0.5 * 0.10 = 0.05` fixo para todo mundo, ou seja, o tipo deixa de diferenciar. Com `zoom_factor = 0`, o tipo entra com força **máxima** (`tipo_peso` puro, de 0.1 a 1.0).

> [!CONTRADICAO 2026-07-18] guia *13-nomes-geograficos* (absorvido):115` diz que, sem `zoom`, o backend "desliga o ajuste por tipo". O código faz o oposto: sem `zoom`, `zoom_factor = 0` (`nomes.queries.js:13`) e o critério 6 usa `tipo_peso` integral (`nomes.queries.js:46`), que é a configuração de **máxima** diferenciação por tipo. O que fica desligado é o *ajuste por zoom* sobre o tipo, não o tipo.

`tipo_peso` não vem do FME, é derivado do texto de `tipo` por uma hierarquia EDGV em trigger (`004_ng.sql:107-136`): cidade 1.0, vila/povoado 0.9, rio/lago/represa 0.85, serra/morro/ilha/pico/ponta/praia 0.8, descendo até religioso/cemitério 0.15 e `ELSE 0.1`.

## Armadilha operacional: `refresh_busca()`

`cluster_id` e `tipo_peso` são preenchidos por trigger `BEFORE INSERT`, e a carga em massa do FME usa `COPY`, que **não dispara** esses triggers. Depois de cada carga é obrigatório rodar `SELECT ng.refresh_busca()` (`004_ng.sql:165-170`), que força `UPDATE ... SET tipo = tipo` (re-dispara `tipo_peso`) e chama `ng.recomputar_clusters()` (DBSCAN com `eps := 0.045` graus, `minpoints := 1`, particionado por `nome, tipo` — `004_ng.sql:153-161`).

Esquecer esse passo **degrada a busca em silêncio, sem erro**: `tipo_peso` nulo cai no `COALESCE(..., 0.1)` (todo mundo com o peso de tipo mínimo) e `cluster_id` nulo quebra a dedup, porque `DISTINCT ON (nome, tipo, cluster_id)` com `NULL` distinto por linha volta a devolver duplicatas de folhas vizinhas. Ver [[deploy-backend]].

## Armadilhas de integração no frontend

- **A rota é anônima.** `/busca` não tem `auth` estrito (`nomes.routes.js:15`); o `flexibleAuth` global popula `req.user` se houver credencial, e o `$5 userId` nulo faz o SQL devolver só `access_level = 'public'`. Não existe 401 aqui. Ver [[auth-flexivel]] e [[zonas-acesso-geografico]].
- **O frontend não envia `zoom`.** `search-bar.search-providers.js:279` monta a URL só com `q`, `lat` e `lon`. Na prática, hoje, toda busca do EBGeo Web roda com `decay_dist = 50 km` fixo e `zoom_factor = 0`, independentemente do zoom do mapa. Quem quiser o comportamento "perto vence em zoom alto" precisa passar a incluir o parâmetro.
- **A barra dispara com 2 caracteres, o backend exige 3.** `search-bar.component.js:168` só ignora `value.length < 2`, mas `buscaSchema` exige `min(3)` (`nomes.schemas.js:8`). O 422 vira `throw` em `search-bar.search-providers.js:283-285`, capturado como `console.warn` em `search-bar.component.js:266-271`. Resultado: toda busca de 2 letras é uma requisição inútil que falha em silêncio. Ver [[erros-api]].
- **`lat`/`lon` são validados em ±90/±180** (`nomes.schemas.js:9-10`) porque o cast `::geography` estouraria em 500. Por isso o frontend faz `clampLatitude`/`wrapLongitude` antes de montar a URL (`search-bar.search-providers.js:275-277`): `map.getCenter()` devolve longitude não normalizada e, passado o antimeridiano, ela excede 180.
- **A URL é derivada da base da API** (`src/js/search/gazetteer-url.js:25`), não de um `config.search.apiUrl`. O default antigo apontava para um serviço que nunca existiu e a busca falhava calada. Ver [[config-runtime-urls-relativas]].
- **`%` e `_` no termo são metacaracteres de `LIKE`** nos critérios 2 e 3. A query é parametrizada (sem risco de injeção), mas um `q` com `%` casa como curinga e infla os critérios 2/3. Não há escape.

## Nota de desempenho

Existe um índice GIN trigram sobre `ng.f_unaccent(nome)` (`004_ng.sql:43-44`), mas o pré-filtro é escrito como `similarity(...) > 0.25` (`nomes.queries.js:21`), forma que o planner **não** casa com o índice (só o operador `%`, governado por `pg_trgm.similarity_threshold`, o usa). Trocar a forma mudaria o conjunto de candidatos e, portanto, o ranking, então isso é parte do contrato congelado: não "otimize" para `%` sem regressão.

Este módulo é read-only e vive fora do sync do atlas: sem `version`, sem operação, sem broadcast. Ver [[sintese-modulos-fora-do-sync]] e [[catalogo-3d]].

## Fontes
- guia *13-nomes-geograficos* (absorvido): contrato do endpoint, tabela dos 7 critérios e pesos, dedup por cluster, nota operacional do `refresh_busca()`, contrato de array nu.
- `ebgeo_backend/src/modules/nomes/nomes.queries.js`: SQL real do ranking (CTEs `q`/`candidatos`/`dedup`, top-500, expressões dos 7 termos).
- `ebgeo_backend/src/modules/nomes/nomes.schemas.js` e `nomes.routes.js`: validação (3..200, zoom 1..20, ±90/±180) e ausência de `auth` estrito em `/busca`.
- `ebgeo_backend/src/modules/nomes/nomes.service.js` e `nomes.controller.js`: repasse sem reordenação e resposta sem envelope.
- `ebgeo_backend/src/database/migrations/004_ng.sql`: `f_unaccent`, índices, hierarquia `tipo_peso`, DBSCAN de clusters, `refresh_busca()`.
- `ebgeo_web/src/js/search/search-bar.search-providers.js`, `search-bar.component.js`, `gazetteer-url.js`: como o frontend chama (sem `zoom`, gatilho em 2 chars, clamp de coordenadas, URL derivada da base da API).
