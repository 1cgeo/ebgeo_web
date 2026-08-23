# Ranking da busca de topônimos (três chaves)

`/nomes/busca` ordena por **três chaves lexicográficas**, não por soma ponderada: relevância em faixa, depois categoria, depois a combinação de importância e proximidade. Quem decide a qualidade do resultado, porém, continua sendo o corte de 500 candidatos que roda **antes** de qualquer pontuação.

Para o módulo inteiro (contrato de resposta, ausência de eixo de acesso, `refresh_busca()`), ver [[gazetteer-nomes-geograficos]]. Esta página é só o ranking.

## A doutrina, e por que ela não cabe numa soma

**Vence a feição de maior importância mais próxima do local, com a importância sendo CATEGÓRICA e não de entidade.** Cidade é muito importante e vem primeiro independente da distância; não existe ranking entre cidades. Abaixo desse degrau vale a combinação de proximidade e importância. É a tríade que o Google documenta para resultado local: relevância, distância, proeminência.

O ponto que decidiu a forma: **numa soma, e também num produto, distância suficiente sempre compra a diferença de categoria**, porque as duas moram na mesma unidade. Não existe peso que torne "cidade" incomparável; só torna caro. Uma chave lexicográfica não se compra.

Isso foi medido, não argumentado. Contra um conjunto dourado de 584 casos em 13 famílias ([[calibracao-busca-toponimos]]), na família que pergunta se uma Cidade do mesmo nome a ~330 km aparece no topo:

| forma | aprovação nessa família |
|---|---|
| soma de 7 critérios, pesos originais | 85,7% |
| a mesma soma, recalibrada por otimizador | 85,7% |
| produto multiplicativo com decaimento gaussiano | 47,6% |
| **três chaves lexicográficas** | **100,0%** |

O modelo multiplicativo é o padrão da indústria (o `function_score` do Elasticsearch, que é como o Pelias faz) e **piora** esse caso: decaimento gaussiano a 330 km esmaga tudo antes de a categoria votar. Agregado sobre o conjunto inteiro: 81,5% da soma vigente contra 92,6% das três chaves.

## As três chaves

Implementadas em `backend/src/modules/nomes/nomes.queries.js`, CTE `pontuado`.

**1. Relevância, em faixa de largura 0.15.** E o detalhe que mais move o resultado: **containment conta como casamento pleno**. Digitar "Altamira" com o mapa em cima de "Altamira do Paraná" é prefixo legítimo, não erro de digitação, mas a similaridade de trigramas pune a diferença de comprimento (1,00 contra ~0,53) e joga os dois em faixas diferentes, onde a categoria nunca chega a votar. Só essa mudança levou a família de colisão de substring de 14% para 77%.

**2. Categoria.** `tipo_peso >= 1.0`, ou seja, só `Cidade`. Baixar o degrau para 0.9 (incluindo Vila e Povoado) mede 90,6%, pior que os 92,6%.

**3. Combinação**, dentro do degrau e abaixo dele: `importância^0.3` vezes um decaimento gaussiano com **platô**. Dentro do platô (10 km) a distância não penaliza nada e quem decide é a importância; `power(0.5, (excedente/escala)²)` é a gaussiana do Elasticsearch escrita direto, valendo exatamente 0.5 quando o excedente iguala a escala (300 km).

O expoente 0.3 não é enfeite: com expoente 1 a multiplicação por `tipo_peso = 0.1` divide por dez quem está no piso, que é 29% do acervo, e a família de feições no piso desabava de 92% para 43%. É o equivalente ao `modifier: log1p`/`sqrt` do `field_value_factor` do Elasticsearch.

**4. Desempate por trigrama cru.** Não melhora ranking nenhum (medido: zero efeito no conjunto dourado). Existe por **determinismo**: sem uma última chave, dois candidatos idênticos nas três primeiras ordenam pelo que o plano devolver, e plano muda com volume. É o mesmo motivo do `c.id DESC` na consulta do catálogo 3D que este schema teve até 2026-08-19.

## O campo `score` sobreviveu, e como

`score` é contrato congelado do frontend ([[sintese-contratos-congelados]]). A ordem virou lexicográfica, mas o campo continua sendo **um número em [0,1]**: a tupla é codificada numa base que preserva a ordem (faixa vale 4, e tudo abaixo dela soma no máximo 3; tier vale 2, e a combinação no máximo 1). Assim `ORDER BY score DESC` **é** a ordem das chaves, e quem consome lê um número decrescente como antes.

O normalizador é derivado da própria largura de faixa, não é literal. Mudar `faixa_casamento` sem recalcular o teto quebraria a dominância em silêncio, e o sintoma seria ordem errada, não erro.

## O que ficou pelo caminho, e por quê

- **Casamento exato e prefixo como bônus separados.** Eram os dois maiores pesos da soma antiga e o otimizador os zerou em toda rodada independente. Pior: **remover o bônus de exato MELHORAVA** a aprovação. O mecanismo é o mesmo do containment: numa consulta truncada ou com erro, o bônus dispara para o que é literalmente igual ao que se digitou, que por definição não é o que se quis dizer.
- **Precisão por comprimento.** Redundante com o trigrama, que já penaliza divergência de tamanho. Ablação: 1,7 ponto.
- **Proeminência de entidade** (população, pagerank). O Nominatim usa pagerank da Wikipédia e o Pelias usa população, mas aqui a importância é categórica **por decisão**: cidade é importante como classe, e não é preciso distinguir uma cidade de outra. Isso dispensou importar dados do IBGE. O preço está registrado abaixo.

## A armadilha central: o score não decide quem entra

A CTE `candidatos` (`backend/src/modules/nomes/nomes.queries.js`) pré-filtra por similaridade ≥ 0.25, ordena por `sim DESC, dist ASC` e corta em `LIMIT 500`. Os critérios só pontuam o que sobreviveu.

Duas consequências que não se leem em nenhum arquivo isoladamente:

- **`dist` decide o corte, não só o desempate.** `similarity()` devolve razões de contagens de trigramas, então empates são frequentes, não raros. Na faixa marginal de similaridade (a que fica na borda dos 500), quem entra é escolhido por proximidade. O parâmetro `lat`/`lon` já está agindo antes do critério 7.
- **A dedup vem depois do corte e não repõe orçamento.** `DISTINCT ON (nome, tipo, cluster_id)` roda sobre os 500. Um termo genérico ("rio", "santa") queima o orçamento em quase-duplicatas e pode chegar ao score com pouquíssimas linhas distintas. É aqui que a busca fica ruim em termos comuns, não nos pesos.

## As consequências que se paga, medidas

- **`%` e `_` no termo são metacaracteres de `LIKE`** na chave 1. A query é parametrizada (sem injeção), mas um `q` contendo `%` casa como curinga e faz o containment disparar para tudo. Não há escape, em lugar nenhum do caminho.
- **Entre duas cidades, a mais próxima vence, mesmo que o nome só case exatamente com a distante.** Buscando "curitiba" de Porto Alegre, "Curitibanos" (310 km) vem antes de "Curitiba" (542 km): as duas são `Cidade`, logo mesma categoria, e aí só a distância separa. É o preço direto de a importância ser categórica; distinguir as duas exigiria proeminência de entidade.
- **Precisão do nome deixou de discriminar dentro da faixa.** "Serra" e "Serra do Mar" no mesmo ponto e mesmo tipo empatam nas três chaves e a ordem sai do desempate por trigrama. As famílias de nome exato e de prefixo caem ~2 pontos por causa disso, e foi o preço aceito para a colisão de substring subir 63.

## `zoom`: sobrou um eixo só

`zoom` continua opcional (`backend/src/modules/nomes/nomes.schemas.js`) e agora afia **só o espaço**: platô e escala encolhem com `2^(10-zoom)`, saindo de 10 km / 300 km no zoom 10.

O antigo `zoom_factor`, que neutralizava `tipo_peso` em zoom alto (todo tipo virava 0.5), foi **removido**: ele contradiz a chave 2 frontalmente, porque zerar a diferença de categoria é exatamente o que a doutrina proíbe. O teste que assertava a neutralização foi reescrito para assertar o oposto, e é hoje um dos guardas da doutrina (`backend/tests/integration/nomes-busca-ranking.test.js`).

**O frontend não envia `zoom`** (`frontend/src/js/search/search-bar.search-providers.js` monta a URL só com `q`, `lat` e `lon`), então o caminho real é sempre o dos defaults.

> **Armadilha do zoom alto, achada rodando contra o acervo real.** O Postgres **lança erro** em underflow de float em vez de saturar em zero. Com zoom 16 a escala cai para ~4,7 km, um candidato a 300 km dá expoente 4096, e `power(0.5, 4096)` derrubava a requisição inteira com `22003 float_underflow_error`. Daí o `LEAST(..., 700)` no expoente. Nenhum teste de unidade pegaria: exige zoom alto **e** candidato distante ao mesmo tempo.

`tipo_peso` não vem do FME: é derivado do texto livre de `tipo` numa hierarquia EDGV em trigger (`backend/src/database/migrations/006_ng.sql`), com `ELSE 0.1`. Tipo novo que não case com nenhum padrão cai silenciosamente no piso e some do topo do ranking.

O casamento é por **palavra** (`~ '\m…\M'`), e essa fronteira é o conserto de um defeito medido. A versão anterior da baseline (`backend/src/database/migrations/006_ng.sql`) casava **substring** (`LIKE '%rio%'`), que acha "rio" dentro de cemité**rio**, aviá**rio**, aterro sanitá**rio**, supe**rio**r, reservató**rio** e ferroviá**rio**: no acervo real de 2026-07-23, **658 linhas** ranqueadas como hidrografia (0.85, o terceiro maior peso) sem ser, e o ramo errado disparava **antes** do ramo certo, então também roubava o peso correto. Aparecia no produto: o top-5 de "brasilia" trazia `Granja Progresso de Brasília | Agro - Aviário` com peso de rio.

A armadilha simétrica mora do outro lado e quase entrou junto: `com` como abreviação de "comércio" casa a preposição de `(com fluxo)`, que o vocabulário usa às pencas, e transformaria `Laguna (com fluxo)` em comércio. Por isso o ramo lista só `comercio|comerc`. Antes de acrescentar abreviação nova aqui, rode contra o acervo: **nada nesta função falha alto**, o erro só aparece como ordem estranha no dropdown.

## Custo escondido: o operador e o limiar são um par

> **Nota histórica.** Esta seção afirmava que o índice GIN trigram (`backend/src/database/migrations/006_ng.sql`) **não** era usado, que o scan era sequencial, e que trocar `similarity(...) > 0.25` pelo operador `%` estava **proibido** por mudar o conjunto de candidatos. A troca foi feita em 2026-07-24. O que a destravou foi notar que o limiar é fixável: `SET LOCAL pg_trgm.similarity_threshold = 0.25` (`backend/src/modules/nomes/nomes.service.js`) preserva exatamente o corte de antes, então o ranking congelado não se mexeu.

Fica o contrato que a troca criou: **operador e `SET LOCAL` andam juntos.** O default da extensão é 0.3, então remover o `SET LOCAL`, ou tirar a busca da transação que o carrega (`SET LOCAL` morre com ela), aperta a busca em silêncio e descarta os candidatos entre 0.25 e 0.3. O sintoma é resultado faltando, não erro, e nenhum teste o pega.

Detalhe do mesmo nó que parece cosmético e não é: o termo no predicado vem do **parâmetro**, não de `q.term`. Como a CTE `q` é referenciada mais de uma vez, o Postgres a materializa e `q.term` deixa de ser constante para o planner, que volta ao Seq Scan mesmo com o operador certo. "Uniformizar" para `q.term` desfaz a otimização sem alterar um único resultado, ou seja, sem nenhum sintoma além da conta de CPU.

Isso importa além da latência porque `/busca` é a única rota anônima do backend: o custo por requisição é pago por qualquer um, e o teto que sobra é o balde por endereço descrito em [[hardening-borda-api]].

`f_unaccent` é aplicado dos dois lados da comparação, então acento no termo ou no dado é irrelevante. O wrapper existe porque o `unaccent` nativo é `STABLE`, logo não indexável (`backend/src/database/migrations/006_ng.sql`), e é ele que o índice GIN cobre.

## Integração: a busca de 2 letras que falha calada

A barra dispara com 2 caracteres (só ignora `value.length < 2`, `frontend/src/js/search/search-bar.component.js`), o backend exige 3 (`backend/src/modules/nomes/nomes.schemas.js`). O 422 vira `throw` no provider e morre como `console.warn` no componente. Toda busca de 2 letras é uma requisição inútil que falha em silêncio. Ver [[erros-api]] e [[auth-flexivel]].

Módulo read-only, fora do sync do atlas: sem `version`, sem operação, sem broadcast. Ver [[sintese-modulos-fora-do-sync]] e [[deploy-backend]].

## Fontes

Os guardas da doutrina são `backend/tests/integration/nomes-busca-doutrina.test.js` (posição esperada por família) e `backend/tests/integration/nomes-tipo-peso.test.js` (os tipos do acervo real amarrados peso a peso): quem mexer nas chaves quebra estes dois primeiro. O conjunto dourado, a ablação e como se chegou a cada número estão em [[calibracao-busca-toponimos]].
