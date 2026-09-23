# Proposta: dados meteorológicos da matriz do PITCIC

**Status: proposta, não implementação.** Escrita em 2026-09-23 contra o commit `a3e9b27f`. Complementa a proposta de dados solares e lunares, que cobre duas das nove linhas da matriz e foi implementada em 2026-09-23 no branch `luminosidade-pitcic`, ainda sem commit nesta data. Por decisão do dono no mesmo dia, luminosidade e meteorologia têm entradas e telas separadas; esta tela copia o desenho daquela e reaproveita as definições dela (ponto, dia D, dia civil em P).

Origem: análise do EB70-MC-10.336 pedida pelo Chefe da DGEO em 2026-09-23. A primeira leitura deixou estas linhas fora do escopo porque "o sistema não tem previsão do tempo"; a pergunta seguinte foi se não daria para buscá-la numa fonte online. Dá, e esta proposta diz a que preço.

> **Divergência declarada.** Este é um documento de trabalho na raiz. Ao ser aceito, o conteúdo perene migra para `docs/wiki/`, a decisão ganha entrada em `docs/decisions/decisions-2026.md`, e este arquivo sai junto com a linha que o declara em `frontend/tests/unit/docs-integridade.test.js`.
>
> **Este arquivo é vigiado por aquele teste**: todo caminho entre crases precisa existir, e todo símbolo entre crases (camelCase, SCREAMING_SNAKE ou `fn_`) precisa existir no código. Por isso o que ainda não existe (o módulo novo, as variáveis de ambiente, a bandeira de configuração) aparece em prosa ou dentro de bloco de código, nunca entre crases. A pasta do painel de luminosidade é citada sem arquivo, porque ela ainda não está no git e pode mudar de forma antes de entrar.

## 1. O que se propõe

Preencher, numa tela própria, as linhas da "Matriz das condições meteorológicas" que dependem de previsão do tempo, para um ponto e para os dias D, D+1 e D+2, com os rótulos do Quadro 4-5 e as mesmas definições de dia que a tela de luminosidade usa. O dado vem de um modelo numérico de previsão, buscado pelo backend e nunca pelo navegador, e o quadro diz sempre de qual fonte, de qual modelo e de qual rodada ele saiu.

Entra também uma linha que o manual pede e que nenhuma tabela pronta traz: o gradiente de temperatura (inversão, neutralidade ou lapse), que o item 4.3.3.3.5 a amarra ao emprego de fumígenos e de agentes QBRN e que se calcula a partir da temperatura em duas alturas.

Fica de fora a metade de baixo do Quadro 4-5, a tabela de efeitos por tropa, aeronave, sensor e fogos, já que o manual não dá limiar nenhum para ela e o preenchimento é julgamento de estado-maior.

**Luminosidade e meteorologia são telas separadas, cada uma com a sua entrada** (dono, 2026-09-23). A separação acompanha a diferença de natureza entre as duas: a luz é cálculo local, sem rede e sem servidor, enquanto a previsão depende do backend, de uma fonte externa e de uma bandeira do administrador, e numa tela só a falha de uma apareceria na outra. O preço é que o produto doutrinário é UMA tabela, o Quadro 4-5, e nenhuma das duas telas o mostra inteiro (D9).

## 2. A fonte doutrinária

**EB70-MC-10.336, Processo de Integração Terreno, Condições Meteorológicas, Inimigo e Considerações Civis (PITCIC), 2023.** O Quadro 4-5 e a Fig 4-9 foram lidos na imagem da página, pois o texto extraído do PDF não os contém.

| Item | Página | O que fixa |
|---|---|---|
| 1.2.9 | 1-2 | as células de inteligência devem contar com especialistas em meteorologia e se valer do assessoramento "das condições meteorológicas da Aviação do Exército" |
| 2.3.4.1 e | 2-6 | a célula de inteligência deve "monitorar e difundir previsões contínuas sobre as condições meteorológicas" |
| 2.3.7.4 | 2-8 | a célula de fogos avalia o impacto das condições meteorológicas sobre os sistemas de apoio de fogo do inimigo |
| 3.2.6 | 3-2 | o clima é padrão de longo prazo, "mais previsível do que as condições meteorológicas", e mais adequado ao nível operacional |
| 3.2.7 | 3-2 | os nove elementos: crepúsculos, fases da lua, temperatura, umidade, nebulosidade, precipitações, cobertura de nuvens, vento e pressão atmosférica; o termo "implica em previsões para apoiar as operações futuras" |
| 4.3.3.2.1 e 4.3.3.2.2 | 4-30 | primeiro a base climática, depois a atualização "com base nas previsões meteorológicas a curto, médio e longo prazo" |
| 4.3.3.2.3 | 4-30 | as restrições vão para o calco de restrição ao movimento, "evitando-se a confecção de calcos específicos", porque o elemento muda em pouco tempo |
| Fig 4-9 | 4-31 | a sequência Banco de Dados, Definição do Clima, Definição da Evolução das Condições Meteorológicas, Integração Terreno e Condições Meteorológicas |
| 4.3.3.3.5 a | 4-33 | temperatura, pressão e umidade afetam vetores lançados pela atmosfera; o gradiente tem três situações, inversão (a temperatura aumenta com a altitude), neutralidade (variação "pequena ou nula") e lapse (a temperatura diminui) |
| 4.3.3.3.5 b | 4-33 | nebulosidade, teto e neblina; nas zonas costeiras e nos vales a neblina matinal "é muito frequente" |
| 4.3.3.3.5 c | 4-33 | precipitações afetam solo, observação, pessoal e equipamento; descargas elétricas afetam depósitos, linhas e espectro |
| 4.3.3.3.5 d | 4-34 | direção e velocidade do vento decidem fumígenos, QBRN e operações aeromóveis; os ventos predominantes podem ir a um calco específico "conforme a necessidade" |
| Quadro 4-5 | 4-35 | o exemplo preenchido, de onde saem os rótulos (§3) |
| 4.3.4.1.2 | 4-35 | a neblina vai ao calco com dimensão, localização, horas de duração e visibilidade em metros |
| 4.6.4.1 | 4-50 | os efeitos a concluir: transitabilidade, visibilidade, fumígenos (vento mais gradiente), pessoal e material, emprego de meios |
| 7.2.1.1 | 7-3 | na condução, a inteligência deve "atualizar a matriz de considerações meteorológicas" |
| Quadro 7-2 | 7-6 | "Ensolarado" visualizado contra "Chuvoso" atual obriga a atualizar o calco de restrição e a matriz |

## 3. As linhas e de onde cada uma vem

O Quadro 4-5 é "Previsão de tempo para 3 dias", com uma coluna por dia e valores diários: máximo e mínimo, total, direção dominante. Cada célula desta proposta é a AGREGAÇÃO de uma série horária sobre o dia civil de Brasília (P), o mesmo dia que o painel de luminosidade usa.

| Linha do Quadro 4-5 | O que o exemplo mostra | Agregação proposta sobre o dia civil em P | Observação |
|---|---|---|---|
| Previsão de tempo | ícone e texto ("chuvas esparsas", "parcialmente nublado", "chuva forte") | o código de tempo mais severo do período diurno, traduzido para frase curta | depende do código de tempo da fonte (D8) |
| Precipitação | "1 mm", "0 mm", "12 mm" | soma diária em mm, mais a maior probabilidade horária | 0 mm é valor, e não ausência (A5) |
| Temperatura | "Max: 36° C", "Min: 21° C" | máximo e mínimo horários | |
| Ventos | "Direção: N-NW", "Velocidade: 1,4 m/s", "Altura: (teto)" | direção por média VETORIAL em 16 rumos, velocidade média em m/s, rajada máxima | teto não confirmado nas fontes F1 e F2; F3 o traz para aeródromo (D5) |
| Umidade | "Max: 42%", "Min: 21%" | máximo e mínimo horários | |
| Visibilidade | "Neblina máxima diurna", "Névoa diurna média", "Neblina grossa" | menor visibilidade horária em metros, com o horário em que ocorre | a linha mais fraca de todas (A10) |

Duas linhas estão no item 3.2.7 e não aparecem no exemplo do Quadro 4-5: nebulosidade (com cobertura de nuvens) e pressão atmosférica. A proposta é entrarem como linhas auxiliares, recolhidas por padrão (D6).

A linha derivada é o gradiente:

| Linha nova | Grandeza | Regra | Observação |
|---|---|---|---|
| Gradiente de temperatura | diferença entre a temperatura a 80 m e a 2 m, por hora | inversão se positiva acima do limiar, lapse se negativa abaixo dele, neutralidade entre os dois | o manual não dá número para "pequena ou nula" (D4); a célula mostra o período de inversão do dia, que é o que decide fumígeno |

## 4. As fontes

| Código | Fonte | Cobre | Limite verificado em 2026-09-23 |
|---|---|---|---|
| F1 | Open-Meteo, API pública | temperatura a 2 m e a 80, 120 e 180 m, umidade, nebulosidade total e por camada, precipitação e probabilidade, visibilidade, vento a 10 m e rajada, pressão, CAPE; até 16 dias, por hora | uso gratuito só não comercial, e os exemplos dos termos são pesquisa em instituição pública e conteúdo educacional; teto de 10.000 chamadas por dia, 5.000 por hora e 600 por minuto; dados em CC BY 4.0 |
| F2 | Open-Meteo em servidor nosso | o mesmo que F1 | código em AGPL-3.0, com Docker; no modo padrão ele lê sob demanda da distribuição pública da Open-Meteo na AWS S3 e guarda em cache local; o modo alternativo baixa os modelos inteiros, direto dos serviços nacionais; o guia pede ao menos 100 GB de disco para instalação pequena |
| F3 | REDEMET, do DECEA | METAR, TAF, aviso de aeródromo, SIGMET, radar, satélite; o meteograma decodifica METAR e TAF | só aeródromos, por código ICAO; exige cadastro e chave; o TAF cobre horas, e não três dias |
| F4 | INMET | previsão por município no portal; séries de estação no BDMEP | não foi achada API de previsão documentada; o BDMEP serve ao clima |
| F5 | Open-Meteo, API histórica | ERA5 a 0,25° desde 1940 e ERA5-Land a 0,1° desde 1950, com cinco dias de atraso; IFS a 9 km desde 2017 | serve ao regime de clima (§5), com os mesmos termos de F1 |

A estrutura meteorológica da Aviação do Exército, que o item 1.2.9 cita, não foi pesquisada nesta revisão. Se existir canal institucional dela ou da Força Aérea além de F3, ele passa na frente de F1 e F2 pelo critério de sigilo (§6).

## 5. Dois regimes: previsão e clima

Previsão acaba entre 7 e 16 dias, conforme o modelo. O planejamento, porém, frequentemente trabalha um dia D mais distante, e a Fig 4-9 já separa as duas coisas: "Definição do Clima" antes de "Definição da Evolução das Condições Meteorológicas".

Cada coluna do quadro, portanto, declara o seu regime:

- **Previsão**, quando o dia está dentro do horizonte da rodada: os valores da §3, com modelo e rodada.
- **Clima**, quando está fora: normais do período tiradas de F5 ou do BDMEP (médias de máxima e mínima, frequência de dia com chuva, vento predominante), com a palavra "clima" escrita na célula.

Como D, D+1 e D+2 são consecutivos, uma mesma tabela pode ter uma coluna em cada regime, e é isso que torna a declaração por coluna obrigatória.

## 6. Sigilo

**Cada consulta por ponto diz a quem responde onde o Exército está planejando, e para quando.** Esta é a restrição que decide a fonte, e não a qualidade do dado.

O código já reconhece a classe. O log de acesso do gazetteer (`backend/src/middleware/nomes-access-log.js`) grava quais filtros foram usados e nunca os valores, porque "for a military gazetteer the raw search terms and click coordinates are sensitive". E a decisão de telemetria de 2026-09-01 recusou três serviços de terceiros pelo mesmo motivo de rede fechada e dado sensível (`docs/wiki/observabilidade.md`).

As opções, da que menos expõe para a que mais expõe:

| Código | Arranjo | O que sai do servidor |
|---|---|---|
| M1 | F2 com os modelos baixados inteiros | nada por consulta; só o download diário da região, igual para qualquer ponto |
| M2 | F3 isolada | o interesse num aeródromo, para um órgão da Força Aérea |
| M3 | F2 no modo padrão | quais blocos da distribuição foram lidos, que é região grosseira, e não ponto; o tamanho do bloco precisa ser medido antes de contar como proteção |
| M4 | F1 com a coordenada arredondada à grade do modelo | a célula de 10 a 25 km, para uma empresa estrangeira; o padrão de consultas ao longo dos dias continua revelando a área de interesse |

A recomendação é M1, com F3 como conferência nos aeródromos. M4 só serve de piloto, e só se a leitura jurídica dos termos de F1 permitir.

## 7. Onde o código mora

**Backend.** Um módulo novo em `backend/src/modules/`, de nome meteorologia, com três partes:

- um adaptador por fonte, que traduz a resposta para uma série horária comum com unidade fixa;
- um cache em memória, com chave pela célula da grade do MODELO e pela rodada, porque a instância é única e a série de uma célula é a mesma para todo mundo;
- uma rota só de leitura. Ela não escreve entidade colaborativa, então não esbarra na regra de escrita só por sync.

A rota deve ser POST com as coordenadas no corpo, e não GET com elas na query (D2). O registrador de requisições (`backend/src/middleware/request-logger.js`) grava a URL original, e `redactUrl` (`backend/src/utils/redact-url.js`) só mascara as chaves de `SENSITIVE_QUERY_KEYS`, que são credenciais: uma query com latitude e longitude cairia inteira no log diário que `npm run diag` lê.

A disponibilidade entra como bandeira em `features`, editável na aba Sistema pelo `configOverridesSchema` (`backend/src/modules/config/config.admin.schemas.js`), como as bandeiras que já estão lá. O `GET /api/config` continua igual para todo chamador, e só a bandeira viaja nele. A fonte e a chave da REDEMET ficam no ambiente, com nomes a decidir, por exemplo:

```
METEO_FONTE=open-meteo-local
METEO_BASE_URL=http://open-meteo:8080
REDEMET_API_KEY=
```

Se a rota for anônima (D3), ela leva limitador próprio antes da validação, como as rotas anônimas de telemetria (`backend/src/middleware/rate-limit.js`).

**Frontend.** Uma entrada e uma tela próprias, separadas da luminosidade (§1), no mesmo desenho que a luminosidade entregou:

- a entrada é o item "Meteorologia neste ponto" no menu de contexto do mapa, logo abaixo de "Luminosidade neste ponto" (as duas agem sobre o ponto clicado), e some quando a bandeira está desligada;
- a tela é o mesmo cartão sob a barra de busca, que no celular vira folha inferior de três alturas, com o mesmo pino efêmero no ponto;
- o dia D é hoje ou a data escolhida na tela, sem vínculo com a linha do tempo do mapa, que o dono tirou da luminosidade;
- a saída é "Salvar tabela", um CSV com as mesmas regras do da luminosidade (vírgula, BOM, `escapeCsvCell`, latitude e longitude numéricas); não há elemento no PDF, que o dono também tirou da luminosidade;
- a tela carrega sob demanda por `carregarSobDemanda` e entra no censo das portas (`frontend/tests/unit/carga-sob-demanda-portas.test.js`), como o painel de luminosidade.

As definições comuns (dia civil em P, rótulos D, D+1 e D+2, aviso de computador fora de UTC−3) moram hoje no módulo de hora de Brasília da pasta da luminosidade (`frontend/src/js/utilities/luminosidade/`). Importá-las de lá faria uma tela depender da outra, e por isso a recomendação é movê-las para um lugar comum no primeiro commit da meteorologia (D10). A agregação da §3 é função pura, testável em node, e o adaptador de rede fica separado dela. A atribuição que a CC BY 4.0 exige vai para a tela e para o CSV.

**Ordem de trabalho.** A meteorologia toca os mesmos arquivos que o branch da luminosidade tocou (o menu de contexto e o CSS dele, os dois catálogos de eventos de uso, a migração que alarga o CHECK de eventos, o teto de peso da página do mapa e o censo das portas de carga). Ela começa depois que a luminosidade estiver commitada.

Os estados, cada um com frase curta e ação (regra de aviso da constituição):

- bandeira desligada: o item do menu não é desenhado, porque o recurso não existe naquela implantação, e a tela de luminosidade não muda em nada;
- servidor sem saída para a fonte: a tela abre, e as linhas mostram "Previsão indisponível", nunca zero, com "Tentar de novo";
- dia fora do horizonte: a coluna muda para clima e diz isso;
- carregando: a tela abre na hora com o ponto, os dias e as linhas vazias, e os números chegam depois.

A tela tem evento de uso próprio, que entra nos três lugares no mesmo commit: `frontend/src/js/session/eventos-de-uso.js`, `backend/src/modules/uso/eventos-de-uso.js` e uma migração que alarga o CHECK, como a da luminosidade fez.

## 8. O que NÃO fazer

- **Nada de calco gravado de meteorologia.** O item 4.3.3.2.3 manda evitar calco específico porque o elemento muda rápido, e a proposta solar já seguiu essa regra. É painel que se recalcula, e não feição que envelhece.
- **Nada de chamada do navegador direto à fonte.** Ela expõe o endereço de quem consulta e o ponto consultado, pula o cache e o limitador e esbarra no proxy da EBnet.
- **Nada de efeitos automáticos.** A metade de baixo do Quadro 4-5 continua julgamento, e uma cor verde calculada por limiar inventado seria lida como avaliação de estado-maior.
- **Nada de precipitação de D+2 apresentada como fato.** A célula leva a probabilidade e o carimbo da rodada ao lado do valor.

## 9. As armadilhas

| Código | Armadilha | Como se previne |
|---|---|---|
| A1 | **Coordenada no log.** GET com latitude e longitude grava a área de interesse no log diário | POST com corpo (D2), e um teste de rota que lê a linha do log e exige a ausência dos números |
| A2 | **Dia UTC no lugar do dia civil.** O modelo entrega hora em UTC, e agregar pelo dia UTC desloca três horas: a máxima de D pode sair da tarde de D e a chuva da noite trocar de coluna | agregar pelo dia civil em P, com a mesma função de data do painel de luminosidade; controle negativo agregando por UTC |
| A3 | **Unidade do vento.** A fonte F1 devolve km/h por padrão, e o Quadro 4-5 escreve m/s | pedir a unidade explicitamente e prender num teste com valor conhecido |
| A4 | **Média aritmética de direção.** A média de 350° e 10° dá 180°, o rumo oposto | média vetorial ponderada pela velocidade, com teste na virada do norte |
| A5 | **Zero no lugar de ausência.** "0 mm" é previsão de tempo seco; "sem dado" é outra coisa | ausência é nulo com motivo, e a célula nula nunca imprime zero, como no painel de luz |
| A6 | **Proxy de saída.** O `fetch` do Node ignora as variáveis de proxy sem a bandeira que as liga, e essa bandeira só existe do Node 22.21 e do 24.0 em diante; o `backend/package.json` aceita Node 20.19 | conferir a versão do Node em produção na fase 0; a falha sem proxy chega como tempo esgotado, que se lê como fonte fora do ar |
| A7 | **Cache sem rodada na chave.** A previsão velha sairia com carimbo novo | rodada na chave e no carimbo da tela |
| A8 | **Cota de F1.** Painel anônimo sem cache nem limitador esgota 10.000 chamadas num dia de exercício | cache por célula e limitador antes da validação; o problema some com F2 |
| A9 | **Horizonte.** Pedir dia além da previsão devolve série vazia ou erro | o adaptador decide o regime antes de chamar, e a coluna diz "clima" |
| A10 | **Neblina de vale e de costa.** Modelo de 10 a 25 km não resolve a neblina que o item 4.3.3.3.5 b aponta como a mais frequente, e a visibilidade prevista por modelo é a variável menos confiável da tabela | a célula diz a resolução do modelo; com F3, o METAR do aeródromo mais próximo serve de conferência |
| A11 | **Gradiente fora da faixa que importa.** A temperatura a 80 m vem do modelo, e não de medição; uma inversão rasa, de poucas dezenas de metros, pode sair atenuada | a linha diz "estimado pelo modelo" e nunca substitui a medição da equipe QBRN |
| A12 | **CHECK redeclarado pela metade.** A migração do evento de uso da meteorologia redeclara o CHECK inteiro, e um CHECK escrito sem o evento da luminosidade faria o banco recusar a telemetria daquela tela | redeclarar com todos os eventos vigentes; o teste de catálogo do backend lê o CHECK da última migração que o redeclara, então ele acusa a omissão |

A primeira chamada HTTP de saída do backend nasce com este módulo: a busca por `fetch(`, `https.get` e `axios` em `backend/src` volta vazia em `a3e9b27f`. Tempo esgotado, falha de proxy e recusa da fonte precisam de categoria própria no log para que o diagnóstico os conte.

## 10. Como isso se prova

- **Agregação, em node, contra respostas gravadas.** Os casos obrigatórios: dia que cruza a meia-noite UTC, direção virando o norte, zero contra nulo, coluna fora do horizonte, célula de grade na borda.
- **Caminho independente.** A fonte F1 também entrega máximos, mínimos e somas diárias com fuso escolhido. A soma que o módulo calcula a partir da série horária precisa bater com a diária da própria fonte pedida no fuso de Brasília; divergência acusa A2 ou A3 sem ninguém precisar ler código.
- **Controle negativo.** Trocar o dia civil em P pelo dia UTC e confirmar que o teste de A2 reprova.
- **Rota.** A linha do log não contém as coordenadas; a bandeira desligada recusa; a fonte fora do ar vira resposta com o bloco declarado indisponível, e não com série zerada.
- **Nenhum teste toca a rede.** O adaptador recebe o transporte injetado, e o e2e de contrato sobe o backend apontado para uma fonte falsa local.
- **Interface.** Captura do Playwright lendo a imagem, também com `--project=firefox`, já que metade dos usuários usa Firefox.

## 11. Fases de entrega

| Fase | Conteúdo | Código |
|---|---|---|
| 0 | Saber se o servidor alcança a internet e por qual proxy; versão do Node em produção; decisão de sigilo (D1); leitura jurídica dos termos, se F1 | nenhum |
| 1 | Depois do commit da luminosidade: módulo do backend com uma fonte, cache e rota; item de menu e tela de meteorologia com temperatura, precipitação, vento e umidade, e "Salvar tabela" | backend e frontend |
| 2 | Visibilidade, nebulosidade, pressão e gradiente; regime de clima fora do horizonte | backend e frontend |
| 3 | F3 como conferência no aeródromo mais próximo, com teto e TAF | backend e frontend |
| 4 | Opcional: ventos predominantes numa sobreposição que se recalcula (4.3.3.3.5 d), sem feição gravada | frontend |

## 12. O que fica em aberto

Decisões para o Chefe, na ordem em que bloqueiam:

| Código | Decisão | Recomendação | Bloqueia |
|---|---|---|---|
| D1 | Fonte e grau de exposição (§6) | M1: Open-Meteo em servidor nosso, com modelos baixados inteiros, e REDEMET como conferência | fase 1 |
| D2 | Coordenadas no corpo de um POST, ou GET com as chaves de coordenada acrescentadas à máscara do log | POST, porque a máscara protege só o log desta aplicação, enquanto o nginx da frente, no formato padrão, grava a linha de requisição com a query e não grava o corpo | fase 1 |
| D3 | Rota anônima, como o painel de luminosidade, ou só com sessão | anônima com limitador, se D1 for M1; com sessão, se for M4, por causa da cota | fase 1 |
| D4 | Limiar da neutralidade no gradiente | tirar o número do manual de fumígenos ou QBRN do Exército antes de escrever a linha; sem essa fonte, ela não entra | fase 2 |
| D5 | Direção do vento no dia: média vetorial, ou direção na hora de maior velocidade | média vetorial, com a rajada máxima e a hora dela ao lado | fase 1 |
| D6 | Nebulosidade e pressão como linhas próprias | auxiliares, recolhidas por padrão | fase 2 |
| D7 | O cabeçalho do exemplo diz "Válido até 0700 de D-1"; o quadro gerado diria a rodada e a próxima atualização | rodada e próxima atualização, em P | fase 1 |
| D8 | A linha "Previsão de tempo" com ícone e texto | só depois de confirmar o código de tempo da fonte escolhida | fase 2 |
| D9 | O Quadro 4-5 é uma tabela só, e as duas telas mostram metades dela | na fase 1 cada tela salva a sua metade; um CSV com a matriz inteira (luz e tempo, mesmo ponto e mesmos dias) se decide quando as duas existirem | nada |
| D10 | Onde moram as definições comuns (dia civil em P, rótulos das colunas, aviso de fuso) | sair da pasta da luminosidade para um lugar comum no primeiro commit da meteorologia, em vez de uma tela importar da outra; o módulo continua folha de zero imports e `frontend/tests/unit/luminosidade-hora-brasilia.test.js` vai junto (condições da sessão da luminosidade, sem objeção dela) | fase 1 |

Fora do escopo, e registrado para não voltar como surpresa:

- A tabela de efeitos do Quadro 4-5 continua julgamento de estado-maior.
- Teto de nuvens fora de aeródromo: as variáveis confirmadas de F1 não trazem altura de base de nuvem, e só F3 a traz.
- O calco de neblina do item 4.3.4.1.2 pede dimensão e localização da neblina; modelo global não entrega isso com resolução útil.

O item mais caro desta proposta é a fase 0. Ninguém registrou se o servidor do 1º CGEO tem saída para a internet (`docs/wiki/deploy-backend.md` mede só o caminho de entrada, do navegador pela EBnet), e sem saída nenhuma das fontes chega ao quadro. A decisão de sigilo vem logo atrás, e ela não se desfaz: coordenada enviada a terceiro fica com o terceiro.

## Fontes externas

- Open-Meteo, termos de uso: https://open-meteo.com/en/terms
- Open-Meteo, documentação da API de previsão: https://open-meteo.com/en/docs
- Open-Meteo, API histórica: https://open-meteo.com/en/docs/historical-weather-api
- Open-Meteo, código e auto-hospedagem: https://github.com/open-meteo/open-meteo
- Open-Meteo, guia de auto-hospedagem: https://github.com/open-meteo/open-meteo/blob/main/docs/getting-started.md
- API-REDEMET, visão geral: https://ajuda.decea.mil.br/base-de-conhecimento/api-redemet-o-que-e/
- API-REDEMET, TAF: https://ajuda.decea.mil.br/base-de-conhecimento/api-redemet-mensagem-taf/
- API-REDEMET, meteograma: https://ajuda.decea.mil.br/base-de-conhecimento/api-redemet-mensagem-meteograma/
- INMET, previsão: https://previsao.inmet.gov.br/
- INMET, BDMEP: https://bdmep.inmet.gov.br/
- Node.js, proxy por variável de ambiente: https://nodejs.org/learn/http/enterprise-network-configuration
