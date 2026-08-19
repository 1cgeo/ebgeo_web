# Gazetteer de Nomes Geográficos (schema ng)

Subsistema read-only sobre PostGIS no schema isolado `ng`, alimentado por carga externa (FME), com autorização embutida no SQL e três contratos de resposta congelados. Código em `backend/src/modules/nomes/`.

## Por que está fora do sync

Nenhuma rota de escrita, nenhum `version`, nenhuma operação, nenhum broadcast. O dado entra por job FME direto no banco; a API só lê. Quem procurar aqui um caminho de edição de topônimo não vai achar, e isso é por projeto: ver [[sintese-modulos-fora-do-sync]] e [[sintese-rest-vs-sync]].

Corolário operacional: não há push de invalidação. Trocou de usuário ou mudou permissão de zona, refaça as consultas.

## Contratos congelados

Duas das três rotas fogem do envelope padrão da API, e isso está marcado no código (`backend/src/modules/nomes/nomes.controller.js`):

- `/busca` devolve **array nu** de até 5 itens.
- `/catalogo3d` devolve envelope próprio `{ total, page, nr_records, data }`.
- `/feicoes` responde **200 sempre**: o objeto do prédio **ou** `{ message: 'Nenhuma edificação encontrada...' }`. Não é 404, não é array vazio. O cliente distingue os dois casos pela presença de `id`.

Não envolva nada disso em `{ data }` para "padronizar": quebra o frontend. Ver [[sintese-contratos-congelados]]; para o envelope do resto da API, [[erros-api]] e [[api-rest-atlas]].

## A armadilha nº 1: a busca roda anônima mesmo logado

`/busca` **não** usa o middleware `auth`; `/feicoes` e `/catalogo3d` usam (`backend/src/modules/nomes/nomes.routes.js`). Isso é deliberado, para o caminho anônimo funcionar: o `flexibleAuth` global popula `req.user` quando há credencial e o controller passa o id adiante; sem credencial vai `null` e o filtro embutido no SQL devolve só o público. Ver [[auth-flexivel]] e [[autenticacao-jwt]].

O que morde: os dois call sites do cliente web fazem `fetch` **sem header `Authorization`** (`frontend/src/js/search/search-bar.search-providers.js`, `frontend/src/js/search/feature-search.control.js`). Ou seja, mesmo com usuário logado, a busca de topônimos hoje enxerga apenas `access_level = 'public'`. Se alguém reclamar que "não acho o nome privado da minha zona", a causa é essa, não o SQL.

**O visitante de link público também é anônimo aqui, e por um caminho que não se adivinha.** O `sub` dele é `public-<uuid>`, deliberadamente fora do formato UUID ([[link-publico]]), e toda query do gazetteer faz cast do id para `::uuid`. Um token de visitante legítimo chegava ao Postgres, estourava `22P02` e transformava a rota anônima-capaz num 400, enquanto **nenhuma** credencial devolvia 200 normalmente. Por isso `principalUserId` normaliza qualquer `sub` não-UUID para `null` (`backend/src/modules/nomes/nomes.controller.js`), que é exatamente o que o filtro embutido já pressupõe.

Nenhum código do web consome hoje `/feicoes` nem `/catalogo3d`. São capacidades servidas para outros consumidores 3D.

A URL da busca não é mais configurável: deriva da base da API (`frontend/src/js/search/gazetteer-url.js`), para funcionar em dev (proxy `/api` do Vite), produção (mesma origem) e E2E. O antigo `SEARCH_API_URL` tinha default apontando para um serviço que nunca existiu, e como os dois call sites toleram erro, a busca falhava **em silêncio**. Ver [[config-runtime-urls-relativas]].

## Ranking: a soma ponderada foi substituída

Até 2026-07-26 a ordenação era uma **soma de 7 critérios com pesos somando 1.00**, herdada verbatim do serviço de origem, e esta página a descrevia como congelada. Não é mais: hoje são **três chaves lexicográficas** (relevância em faixa, degrau de categoria, combinação de importância e proximidade), mais um desempate por trigrama cru que existe só por determinismo. A troca foi medida contra um conjunto dourado de 584 casos (aprovação 81,5% → 92,6%), e o racional completo, inclusive por que a soma não podia funcionar, está no cabeçalho de `backend/src/modules/nomes/nomes.queries.js`. Critério a critério em [[ranking-busca-toponimos]].

O que reter aqui, porque atravessa arquivos:

- **`score` continua saindo e continua em [0,1]:** é contrato congelado do frontend. Como a ordem agora é lexicográfica e não um escalar, o `score` é a **tupla codificada** numa base que preserva a ordem. Quem consome lê um número decrescente como antes, mas não o interprete mais como "quão parecido".
- **O corte acontece antes da ordenação.** A CTE `candidatos` pré-filtra por similaridade trigram e corta em `LIMIT 500`. Um nome pertinho do usuário, mas com similaridade textual medíocre, pode nunca chegar à ordenação se houver 500 candidatos textualmente melhores.
- **O pré-filtro usa o operador `%`, nunca a chamada `similarity(...) > 0.25`.** Só o operador alcança o índice GIN; a chamada de função é opaca ao planner e força Seq Scan sobre a tabela inteira. E o limiar de 0.25 vem de um `SET LOCAL pg_trgm.similarity_threshold` no serviço, **não** do default da extensão, que é 0.3: trocar o predicado sem fixar o limiar muda o comportamento da busca em silêncio.
- **Sem `zoom`, o platô é 10 km e a escala 300 km.** O `zoom` é opcional e afia só o espaço (ambos encolhem com `2^(10-zoom)`). **Nenhum dos dois call sites do web envia `zoom`**, então o caminho real é sempre o dos defaults. O antigo `zoom_factor`, que neutralizava o peso por tipo em zoom alto, foi **removido** por contradizer frontalmente a chave de categoria.
- **`lat`/`lon` são limitados no Joi por causa do PostGIS**, não por preciosismo: as queries fazem cast para `::geography`, que estoura 500 com coordenada fora de faixa; a borda converte em 422 (`backend/src/modules/nomes/nomes.schemas.js`). Ver [[sintese-contrato-erros-http]]. Do lado do cliente, `map.getCenter()` devolve longitude não normalizada e passa de ±180 depois do antimeridiano, por isso ambos os call sites aplicam `wrapLongitude`/`clampLatitude` antes do fetch.

## Armadilha de SRID

`ng.nomes_geograficos` é `POINT, 4674` (SIRGAS 2000) e `ng.edificacoes` é `POLYGON, 4326` (`backend/src/database/migrations/006_ng.sql`). A diferença é deliberada e coberta por teste (`backend/tests/integration/nomes.test.js`). Por isso `/busca` constrói o ponto em 4674 e `/feicoes` em 4326, e o filtro de zona de `/feicoes` precisa de `ST_Transform(uz.geom, 4326)`, já que as zonas são 4674.

Ao mexer em qualquer query aqui, confira o SRID antes de copiar-colar de uma rota para a outra.

## Autorização embutida no SQL

As três rotas embutem a autorização no `WHERE`, não numa camada de aplicação: linha privada não chega ao Node para ser filtrada. É defesa em profundidade, e é o motivo de o filtro estar replicado em cada query. Corolário para o cliente: não filtre registros privados no frontend, eles não chegam. Ver [[zonas-acesso-geografico]], [[sintese-eixos-de-permissao]] e [[hardening-borda-api]].

Três escolhas que valem o byte:

- **Admin é reconferido no banco**, com `EXISTS (SELECT 1 FROM users WHERE id = $N AND role = 'admin')`, e não pela claim do JWT. Um token antigo com `role` desatualizado não vira acesso indevido aqui. Ver [[permissoes-atlas]].
- **Liveness de conta e de organização também são parte do filtro de acesso, não gentileza.** `flexibleAuth` só reconcilia contra o banco nos últimos 5 minutos de vida do token, então entre uma desativação e essa janela a conta desligada ainda carrega um JWT válido. As rotas irmãs a recusam de imediato pelo `auth` estrito; `/busca` continuava servindo nome **privado**, contradizendo o próprio cabeçalho do arquivo. Ver [[organizacoes-om]] e [[gestao-usuarios]].
- **`ng.fn_user_zone_geoms(NULL)` devolve vazio por construção**, então o caminho anônimo degrada para "só público" mesmo se alguém remover o guard da aplicação.

Assimetria proposital: `catalogo_3d` tem permissão linha a linha (direta ou por grupo), mas **nenhum ramo espacial de zona**. Um comentário em `backend/src/modules/nomes/nomes.queries.js` deixa o gancho para adicioná-lo sem reescrever a query.

**A armadilha mais cara do módulo saiu com o catálogo que a carregava.** O predicado de acesso do catálogo 3D deste schema estava **duplicado verbatim** entre a consulta de listagem e a de contagem, mudando só o placeholder do id de usuário, e o comentário nomeava uma função SQL (`fn_user_can_see_model`) que nunca foi escrita: editar um sem o outro fazia a paginação divergir da listagem, e os dois rodavam em paralelo, então a divergência não aparecia como erro. Em 2026-08-19 o catálogo inteiro saiu deste schema ([[catalogo-3d]]) e as duas consultas foram removidas. O que fica de lição é o desenho que [[acesso-a-recurso-privado]] adotou por causa dela: predicado de acesso nasce como FUNÇÃO SQL, para que não exista uma segunda cópia da regra.

Metadados e distribuição dos assets estão fora daqui: a descoberta é a tabela de catálogo ([[resources-catalogo]]) e os bytes saem por [[assets3d-distribuicao]]. Este schema JÁ TEVE um catálogo de modelo 3D próprio, com permissão por modelo, e ele saiu em 2026-08-19 ([[catalogo-3d]]). `/api/v1/assets3d` serve o binário público sem auth (imutável, Range/ETag) e o privado passa pelo gate do recurso; ver [[sintese-cache-http-imutavel]].

## Log sem valores, por decisão

Todas as três rotas passam por `nomesAccessLog`, que loga `userId`, `ip`, `path` e apenas as **chaves** da query string, nunca os valores (`backend/src/middleware/nomes-access-log.js`). Num gazetteer militar, o termo buscado e a coordenada clicada são sensíveis e não devem parar num agregador de logs. Auditoria a nível de valor, se um dia for exigida, é assunto da trilha de auditoria: ver [[auditoria]].

## O passo pós-carga que ninguém pode esquecer

A carga é externa (FME), fora da API. Depois de **cada** carga de nomes é obrigatório rodar:

```sql
SELECT ng.refresh_busca();
```

**Nenhum trigger calcula `cluster_id`**: `ng.refresh_busca` é a única fonte desse campo (`backend/src/database/migrations/006_ng.sql`, via `ng.recomputar_clusters()`). Esquecer o passo não gera erro: degrada em silêncio. Ver [[deploy-backend]].

E degrada no sentido **contrário** ao que se espera. A dedup da busca é `SELECT DISTINCT ON (nome, tipo, cluster_id)`, e `DISTINCT ON` no PostgreSQL trata NULLs como iguais. Com `cluster_id` NULL em toda a tabela, todas as ocorrências de um mesmo `nome`+`tipo` colapsam em **uma única linha** (a mais próxima), inclusive homônimos legítimos a centenas de quilômetros. O sintoma é resultado **faltando**, não duplicado.

A outra metade do racional original, a de que o passo seria obrigatório porque "`COPY` não dispara trigger `BEFORE INSERT`", **é falsa** e foi medida contra o PostgreSQL desta instalação: `COPY` dispara trigger de linha `BEFORE INSERT`; o que ele não dispara são `RULES`. Não remova a chamada com base na queda dessa metade: a metade `cluster_id` continua incondicionalmente verdadeira e sozinha já torna o passo obrigatório.

## Histórico

- **2026-07-26.** A ordenação da busca deixou de ser soma ponderada de 7 critérios e passou a três chaves lexicográficas, calibradas contra conjunto dourado. O `score` de saída permanece congelado em [0,1].
- **2026-07-24.** O comentário de `004_ng.sql` que justificava o re-fire de trigger com "COPY bypasses BEFORE INSERT triggers" foi corrigido no próprio arquivo, apesar de a migração ser forward-only: só o comentário mudou, nenhum DDL. Vale registrar o precedente, porque a regra "migração aplicada não se edita" costuma ser lida como absoluta e aqui a exceção é deliberada (comentário não executa, e comentário errado dentro de migração é a forma de doc que mais engana, já que é o lugar onde um agente mais confia).
