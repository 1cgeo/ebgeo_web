# Ranking da busca de topônimos (7 critérios)

O score de `/nomes/busca` é uma soma ponderada congelada de 7 critérios (`backend/src/modules/nomes/nomes.queries.js:40-47`), mas quem decide a qualidade do resultado é o corte de 500 candidatos que roda **antes** do score, não os pesos.

Para o módulo inteiro (rotas, auth assimétrica, `refresh_busca()`), ver [[gazetteer-nomes-geograficos]]. Esta página é só o ranking.

## Por que os pesos são intocáveis

SQL portado verbatim do `servico_nomes_geograficos`, pesos somando 1.00, congelados por decisão explícita (`backend/src/modules/nomes/nomes.queries.js:2-3`). Não há reordenação em JavaScript: o service repassa as linhas e o controller devolve o array nu. Mexer em um peso muda a ordem que o frontend já consome, e não existe teste de ordenação contra dados reais que pegue a regressão. Ver [[sintese-contratos-congelados]].

## A armadilha central: o score não decide quem entra

`candidatos` pré-filtra por `similarity(...) > 0.25`, ordena por `sim DESC, dist ASC` e corta em `LIMIT 500` (`backend/src/modules/nomes/nomes.queries.js:21`, `:27-28`). Os 7 critérios só pontuam o que sobreviveu.

Três consequências que não se leem em nenhum arquivo isoladamente:

- **`dist` decide o corte, não só o desempate.** `similarity()` devolve razões de contagens de trigramas, então empates são frequentes, não raros. Na faixa marginal de similaridade (a que fica na borda dos 500), quem entra é escolhido por proximidade. O parâmetro `lat`/`lon` já está agindo antes do critério 7.
- **A dedup vem depois do corte e não repõe orçamento.** `DISTINCT ON (nome, tipo, cluster_id)` roda sobre os 500 (`backend/src/modules/nomes/nomes.queries.js:31`). Um termo genérico ("rio", "santa") queima o orçamento em quase-duplicatas e pode chegar ao score com pouquíssimas linhas distintas. É aqui que a busca fica ruim em termos comuns, não nos pesos.
- **Usuários diferentes veem rankings diferentes para o mesmo termo.** O filtro de acesso está dentro do `WHERE` de `candidatos` (`backend/src/modules/nomes/nomes.queries.js:22-26`), logo antes do `LIMIT 500`. Para um admin, linhas privadas competem pelas 500 vagas e podem expulsar públicas que o anônimo veria. Não é bug, é consequência de embutir autorização na query. Ver [[zonas-acesso-geografico]].

## O que se lê errado nos 7 critérios

- **Os critérios 1, 2 e 3 são cumulativos, não excludentes** (`backend/src/modules/nomes/nomes.queries.js:40-42`). Um match exato dispara os três (0.20 + 0.10 + 0.15), mais `sim = 1.0` (0.10) e precisão de comprimento 1.0 (0.15): piso de **0.70** antes de tipo e proximidade. Por isso o exato praticamente sempre vence, por mais distante que esteja. Quem tentar "dar mais peso ao exato" está mexendo em três termos, não em um.
- **A precisão por comprimento é simétrica** (`backend/src/modules/nomes/nomes.queries.js:44-45`): penaliza nome mais curto que o termo tanto quanto mais longo. Como na prática o termo é sempre um prefixo curto, ela opera de fato como "penaliza nome comprido", que não é o que a fórmula diz.
- **A proximidade nunca zera** (`backend/src/modules/nomes/nomes.queries.js:47`). É hipérbole: a `decay_dist` vale metade do peso, a `9 * decay_dist` ainda vale 0.02. Distância nunca elimina ninguém, só desempata.
- **`%` e `_` no termo são metacaracteres de `LIKE`** nos critérios 2 e 3. A query é parametrizada (sem injeção), mas um `q` contendo `%` casa como curinga e infla os dois critérios. Não há escape, em lugar nenhum do caminho.

## `zoom`: dois eixos, e nenhum deles ligado hoje

`zoom` é opcional (`backend/src/modules/nomes/nomes.schemas.js:11`) e controla dois eixos independentes (`backend/src/modules/nomes/nomes.queries.js:12-13`): o raio de relevância da proximidade (`decay_dist`, 50 km no zoom 10, ~780 m no zoom 16) e a neutralização do peso por tipo (`zoom_factor`, 0 no zoom ≤ 4, 1 no zoom ≥ 18).

**O frontend não envia `zoom`** (`src/js/search/search-bar.search-providers.js:279` monta a URL só com `q`, `lat` e `lon`). Toda busca do EBGeo Web roda com raio fixo de 50 km e `zoom_factor = 0`, independentemente do zoom do mapa. A máquina de zoom existe, é testável e está desligada por omissão do chamador.

> **Nota histórica.** O guia *13-nomes-geograficos* (absorvido) diz que, sem `zoom`, o backend "desliga o ajuste por tipo". O código faz o oposto: `zoom_factor = 0` (`backend/src/modules/nomes/nomes.queries.js:13`) faz o critério 6 usar `tipo_peso` integral (`backend/src/modules/nomes/nomes.queries.js:46`), que é a configuração de diferenciação **máxima** por tipo. O que fica desligado é o ajuste por zoom sobre o tipo, não o tipo. Consequência: ligar `zoom` hoje **reduziria** a influência do tipo em zoom alto, ao contrário do que a leitura ingênua sugere.

`tipo_peso` não vem do FME: é derivado do texto livre de `tipo` por `LIKE '%...%'` numa hierarquia EDGV em trigger (`backend/src/database/migrations/004_ng.sql:107-136`), com `ELSE 0.1`. Tipo novo que não case com nenhum padrão cai silenciosamente no piso e some do topo do ranking.

## Custo escondido: o índice trigram não é usado

Existe um índice GIN sobre `ng.f_unaccent(nome)` (`backend/src/database/migrations/004_ng.sql:43-44`), mas o pré-filtro é escrito como `similarity(...) > 0.25` (`backend/src/modules/nomes/nomes.queries.js:21`), forma que o planner **não** casa com o índice; só o operador `%`, governado por `pg_trgm.similarity_threshold`, o usa. O scan é sequencial.

A troca é tentadora e está proibida: `%` usa um limiar de sessão em vez do 0.25 literal, mudaria o conjunto de candidatos e, por consequência, o ranking inteiro. Faz parte do contrato congelado. Não "otimize" para `%` sem regressão contra dados reais.

`f_unaccent` é aplicado dos dois lados (`backend/src/modules/nomes/nomes.queries.js:11`, `:17`), então acento no termo ou no dado é irrelevante. O wrapper existe só porque o `unaccent` nativo é `STABLE`, logo não indexável (`backend/src/database/migrations/004_ng.sql:21-23`), ironia dado o parágrafo acima.

## Integração: a busca de 2 letras que falha calada

A barra dispara com 2 caracteres (`src/js/search/search-bar.component.js:168` só ignora `value.length < 2`), o backend exige 3 (`backend/src/modules/nomes/nomes.schemas.js:8`). O 422 vira `throw` em `src/js/search/search-bar.search-providers.js:283-285` e morre como `console.warn` em `src/js/search/search-bar.component.js:266-271`. Toda busca de 2 letras é uma requisição inútil que falha em silêncio. Ver [[erros-api]] e [[auth-flexivel]].

Módulo read-only, fora do sync do atlas: sem `version`, sem operação, sem broadcast. Ver [[sintese-modulos-fora-do-sync]] e [[deploy-backend]].

## Fontes
- `ebgeo_backend/src/modules/nomes/nomes.queries.js`: SQL do ranking, corte de 500, filtro de acesso pré-corte.
- `ebgeo_backend/src/database/migrations/004_ng.sql`: `f_unaccent`, índice GIN trigram, hierarquia `tipo_peso`.
- `ebgeo_web/src/js/search/search-bar.search-providers.js`, `src/js/search/search-bar.component.js`: ausência de `zoom`, gatilho em 2 chars.
- guia *13-nomes-geograficos* (absorvido): pesos e contrato do endpoint; divergência sobre `zoom` registrada acima.
