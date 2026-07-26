# Calibração da busca de topônimos

Como se decide, com evidência, a forma e os números do ranking de `/nomes/busca`. O algoritmo em si está em [[ranking-busca-toponimos]]; esta página é o método que o produziu, e o que fazer antes de mexer nele.

Ferramentas em `dev/`: `gerar-golden-busca.mjs` (gera o conjunto), `tune-busca.mjs` (avalia, ablação, busca de pesos), `busca-golden.json` (o conjunto, versionado).

## Peso não vira assert

Qualquer peso cravado num `assert` faz toda recalibração nascer vermelha. O que a suíte prende é **posição**, no modelo do `fuzzy-tester` do Pelias: cada caso declara em que posição o esperado tem de estar. Os números saem de um relatório, não de uma expectativa. Os guardas vivem em `backend/tests/integration/nomes-busca-doutrina.test.js`, e nenhum deles cita uma constante da fórmula: trocar 0.3 por 0.35 no expoente da importância não pode ficar vermelho; apagar a chave de categoria tem que ficar.

## A armadilha que definiu o desenho: conjunto dourado vácuo

A primeira versão do conjunto era 300 cidades consultadas pelo nome exato. Recall@1 de 100%, e **zerar cinco dos sete critérios mantinha os 100%**. Um conjunto assim passa verde com a fórmula quase toda desligada, ou seja, não prova nada sobre ela.

A causa é estrutural: num casamento exato os critérios de nome disparam **juntos**, então cada um é testemunha do que os outros já provaram. Daí a regra: **cada família existe para tensionar um critério específico**, e a ablação é o meta-teste que verifica se isso está acontecendo.

## A ablação é meta-teste do conjunto, não só do algoritmo

`tune-busca.mjs --ablacao` zera um critério por vez e mede a queda. Critério cujo Δ é ~0 **não está sendo exercido**: ou é redundante, ou a família que deveria tensioná-lo está morta ou faltando.

Foi assim que se descobriu que o maior peso da soma antiga (casamento exato, 0.20) era **líquido negativo**: removê-lo *melhorava* a aprovação em 5,7 pontos.

## Verdade objetiva contra política

Um caso gerado a partir de uma linha e que espera aquela linha de volta tem verdade **circular**: assume que a linha sorteada é a que o usuário queria. Para nome único é inofensivo; para homônimo é a própria pergunta em disputa. Por isso o conjunto separa:

| campo | significado |
|---|---|
| `espera.alvo` | verdade objetiva: exatamente esta coordenada |
| `espera.criterio` | política declarada (`max_dist_km`, `tipo_in`) |
| `espera.ausente` | o que não pode aparecer no top-5 |
| `espera.topo` | posição máxima aceitável |

Nas famílias de política, a doutrina é aplicada **na geração**, sobre o conjunto de candidatos, e congelada como coordenada. Avaliá-la em tempo de execução usando `tipo_peso` tornaria o conjunto tautológico em relação ao critério que se quer calibrar: o otimizador "descobriria" que basta maximizar o peso de tipo, e teria descoberto apenas a própria pergunta. O detector de tautologia é a ablação: se zerar `tipo` colapsasse tudo, o conjunto estaria respondendo a si mesmo.

## O truque que torna a busca de pesos viável

O caro de avaliar uma configuração (varredura de trigramas, `ST_Distance`, `DISTINCT ON`) **não depende dos pesos**. Toda a geração de candidatos é peso-independente: o operador `%`, o corte de 500 por `sim DESC, dist ASC` e a escolha do representante do cluster por `dist ASC` não olham peso nenhum.

Então a matriz de atributos é **exata**, não uma aproximação, e se materializa uma vez (~30 s para 584 casos). Depois, pontuar um vetor vira produto escalar: milhares de configurações em segundos, contra ~30 s cada.

`--buscar` faz amostragem de Dirichlet no simplex mais descida por coordenadas, com holdout 70/30. Ganho que aparece no treino e some no teste é ruído.

## Desacordo é pergunta, não veredito

Três vezes durante a calibração o conjunto discordou do algoritmo, e nas três **quem estava errado era o conjunto**:

- a família de homônimos tinha consultas como `"13036162"`, porque o acervo guarda identificadores de origem na coluna `nome` e eles são repetidos, logo entravam como homônimos com prioridade;
- a política era aplicada sobre todos os candidatos em vez de "entre os que casam", e em 28 de 60 casos o alvo resolvido nem era o nome consultado;
- um caso negativo cobrava que buscar "cemitério" não trouxesse `Rio` no top-5, como proxy da regressão da migração 009. Mau proxy: o acervo tem rios legitimamente chamados "Rio do Cemitério", então o caso reprovava a resposta certa, e reprovava justo os modelos que ordenavam melhor.

E uma quarta vez do outro lado: quando o degrau de categoria entrou, a família de homônimos caiu, e a inspeção mostrou que em 9 das 20 falhas o primeiro colocado era uma Cidade do mesmo nome logo fora do raio de 60 km. O ranking acertava; a expectativa é que estava velha, congelada numa leitura anterior da doutrina.

O mesmo vale para os testes de integração: o controle negativo (apagar a chave e confirmar o vermelho) revelou que o primeiro teste de categoria passava **com e sem** a chave, porque a 40 km a combinação contínua já favorecia a Cidade sozinha. O par que discrimina é o concorrente de maior peso abaixo do degrau (Vila) a curta distância contra a Cidade longe o bastante para o contínuo inverter.

## O que os números valem, e o que não valem

Tudo foi medido sobre o acervo de 2026-07-23: 52.420 topônimos depois da desduplicação, **73% em RS/PR/SC**, sem São Paulo, Rio de Janeiro, Recife ou Brasília como cidade. Calibrar aqui otimiza para *este* acervo. Se o deploy carregar um gazetteer nacional, os números morrem e a calibração se refaz.

O arnês sobrevive; é ele o ativo, não o vetor de constantes.

O conjunto também é sintético: gerado do próprio acervo, mede "achar o lugar que eu nomeei", não "achar o que o operador quis dizer". A fonte natural de casos reais seriam logs de consulta, e o `nomesAccessLog` **deliberadamente não registra os valores da query** (num gazetteer militar o termo buscado e a coordenada clicada são o dado sensível). Não é decisão a reverter para tunar busca, então o sinal do mundo real tem de vir de casos curados à mão, com as famílias automáticas servindo de andaime.

## Fontes
- `dev/README.md`: uso das três ferramentas, modelos de ordenação e a armadilha do `--truncate`.
- `dev/gerar-golden-busca.mjs`: as 13 famílias e por que cada uma existe.
- `dev/tune-busca.mjs`: matriz de atributos, ablação, busca no simplex, comparação de modelos.
- `backend/tests/integration/nomes-busca-doutrina.test.js`: os guardas de posição.
- [[ranking-busca-toponimos]]: o algoritmo resultante.
