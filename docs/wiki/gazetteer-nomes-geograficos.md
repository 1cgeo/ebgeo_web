# Gazetteer de Nomes Geográficos (schema ng)

Subsistema read-only sobre PostGIS no schema isolado `ng`, alimentado por carga externa (FME), com uma rota de busca cujo contrato de resposta é congelado. Código em `backend/src/modules/nomes/`.

## Por que está fora do sync

Nenhuma rota de escrita, nenhum `version`, nenhuma operação, nenhum broadcast. O dado entra por job FME direto no banco; a API só lê. Quem procurar aqui um caminho de edição de topônimo não vai achar, e isso é por projeto: ver [[sintese-modulos-fora-do-sync]] e [[sintese-rest-vs-sync]].

## Contrato congelado

A única rota do módulo foge do envelope padrão da API, e isso está marcado no código (`backend/src/modules/nomes/nomes.controller.js`): `/busca` devolve **array nu** de até 5 itens.

Não a envolva em `{ data }` para "padronizar": quebra o frontend. Ver [[sintese-contratos-congelados]]; para o envelope do resto da API, [[erros-api]] e [[api-rest-atlas]].

## A URL da busca não é configurável

Ela deriva da base da API (`frontend/src/js/search/gazetteer-url.js`), para funcionar em dev (proxy `/api` do Vite), produção (mesma origem) e E2E. O antigo `SEARCH_API_URL` tinha default apontando para um serviço que nunca existiu, e como os dois call sites toleram erro, a busca falhava **em silêncio**. Ver [[config-runtime-urls-relativas]].

## Ranking: a soma ponderada foi substituída

Até 2026-07-26 a ordenação era uma **soma de 7 critérios com pesos somando 1.00**, herdada verbatim do serviço de origem, e esta página a descrevia como congelada. Não é mais: hoje são **três chaves lexicográficas** (relevância em faixa, degrau de categoria, combinação de importância e proximidade), mais um desempate por trigrama cru que existe só por determinismo. A troca foi medida contra um conjunto dourado de 584 casos (aprovação 81,5% → 92,6%), e o racional completo, inclusive por que a soma não podia funcionar, está no cabeçalho de `backend/src/modules/nomes/nomes.queries.js`. Critério a critério em [[ranking-busca-toponimos]].

O que reter aqui, porque atravessa arquivos:

- **`score` continua saindo e continua em [0,1]:** é contrato congelado do frontend. Como a ordem agora é lexicográfica e não um escalar, o `score` é a **tupla codificada** numa base que preserva a ordem. Quem consome lê um número decrescente como antes, mas não o interprete mais como "quão parecido".
- **O corte acontece antes da ordenação.** A CTE `candidatos` pré-filtra por similaridade trigram e corta em `LIMIT 500`. Um nome pertinho do usuário, mas com similaridade textual medíocre, pode nunca chegar à ordenação se houver 500 candidatos textualmente melhores.
- **O pré-filtro usa o operador `%`, nunca a chamada `similarity(...) > 0.25`.** Só o operador alcança o índice GIN; a chamada de função é opaca ao planner e força Seq Scan sobre a tabela inteira. E o limiar de 0.25 vem de um `SET LOCAL pg_trgm.similarity_threshold` no serviço, **não** do default da extensão, que é 0.3: trocar o predicado sem fixar o limiar muda o comportamento da busca em silêncio.
- **Sem `zoom`, o platô é 10 km e a escala 300 km.** O `zoom` é opcional e afia só o espaço (ambos encolhem com `2^(10-zoom)`). **Nenhum dos dois call sites do web envia `zoom`**, então o caminho real é sempre o dos defaults. O antigo `zoom_factor`, que neutralizava o peso por tipo em zoom alto, foi **removido** por contradizer frontalmente a chave de categoria.
- **`lat`/`lon` são limitados no Joi por causa do PostGIS**, não por preciosismo: a query faz cast para `::geography`, que estoura 500 com coordenada fora de faixa; a borda converte em 422 (`backend/src/modules/nomes/nomes.schemas.js`). Ver [[sintese-contrato-erros-http]]. Do lado do cliente, `map.getCenter()` devolve longitude não normalizada e passa de ±180 depois do antimeridiano, por isso ambos os call sites aplicam `wrapLongitude`/`clampLatitude` antes do fetch.

## Busca de topônimo não tem restrição de acesso

A ausência de predicado de acesso na consulta é decisão, não esquecimento, e o comentário de `backend/src/modules/nomes/nomes.queries.js` a repete no lugar exato onde alguém "endureceria" de volta. Até 2026-08-19 a busca filtrava por uma marca de privacidade na linha mais concessão espacial por polígono, e o eixo inteiro saiu medido como morto: as rotas de administração daquele eixo nunca tiveram tela, e a tabela de membros de grupo que sustentaria o outro ramo do predicado nunca teve escritor, então aquele ramo jamais devolveu uma linha. Gazetteer é busca de nome, e o dono definiu que ela é aberta.

Defesa em profundidade por predicado no `WHERE` continua sendo o desenho de catálogo e 360 ([[sintese-eixos-de-permissao]], [[hardening-borda-api]]); ela deixou de valer aqui, e a intenção de conceder a um coletivo sobreviveu no schema da aplicação ([[acesso-a-recurso-privado]]).

Metadados e distribuição dos assets 3D estão fora daqui: a descoberta é a tabela de catálogo ([[resources-catalogo]]) e os bytes saem por [[assets3d-distribuicao]]. `/api/v1/assets3d` serve o binário público sem auth (imutável, Range/ETag) e o privado passa pelo gate do recurso; ver [[sintese-cache-http-imutavel]].

## Log sem valores, por decisão

A rota passa por `nomesAccessLog`, que loga `userId`, `ip`, `path` e apenas as **chaves** da query string, nunca os valores (`backend/src/middleware/nomes-access-log.js`). Num gazetteer militar, o termo buscado e a coordenada clicada são sensíveis e não devem parar num agregador de logs. Auditoria a nível de valor, se um dia for exigida, é assunto da trilha de auditoria: ver [[auditoria]].

## O passo pós-carga que ninguém pode esquecer

A carga é externa (FME), fora da API. Depois de **cada** carga de nomes é obrigatório rodar:

```sql
SELECT ng.refresh_busca();
```

**Nenhum trigger calcula `cluster_id`**: `ng.refresh_busca` é a única fonte desse campo (`backend/src/database/migrations/006_ng.sql`, via `ng.recomputar_clusters()`). Esquecer o passo não gera erro: degrada em silêncio. Ver [[deploy-backend]].

E degrada no sentido **contrário** ao que se espera. A dedup da busca é `SELECT DISTINCT ON (nome, tipo, cluster_id)`, e `DISTINCT ON` no PostgreSQL trata NULLs como iguais. Com `cluster_id` NULL em toda a tabela, todas as ocorrências de um mesmo `nome`+`tipo` colapsam em **uma única linha** (a mais próxima), inclusive homônimos legítimos a centenas de quilômetros. O sintoma é resultado **faltando**, não duplicado.

A outra metade do racional original, a de que o passo seria obrigatório porque "`COPY` não dispara trigger `BEFORE INSERT`", **é falsa** e foi medida contra o PostgreSQL desta instalação: `COPY` dispara trigger de linha `BEFORE INSERT`; o que ele não dispara são `RULES`. Não remova a chamada com base na queda dessa metade: a metade `cluster_id` continua incondicionalmente verdadeira e sozinha já torna o passo obrigatório.

## Histórico

- **2026-08-19.** O módulo passou de três rotas a uma: saíram o segundo catálogo 3D e a rota de identify de edificação, com as tabelas que as serviam, mais o eixo de acesso da busca. O porquê está acima e em [[resources-catalogo]].
- **2026-07-26.** A ordenação da busca deixou de ser soma ponderada de 7 critérios e passou a três chaves lexicográficas, calibradas contra conjunto dourado. O `score` de saída permanece congelado em [0,1].
- **2026-07-24.** O comentário de `004_ng.sql` que justificava o re-fire de trigger com "COPY bypasses BEFORE INSERT triggers" foi corrigido no próprio arquivo, apesar de a migração ser forward-only: só o comentário mudou, nenhum DDL. Vale registrar o precedente, porque a regra "migração aplicada não se edita" costuma ser lida como absoluta e aqui a exceção é deliberada (comentário não executa, e comentário errado dentro de migração é a forma de doc que mais engana, já que é o lugar onde um agente mais confia).
