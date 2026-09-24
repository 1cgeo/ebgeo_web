# Proposta: dados meteorológicos da matriz do PITCIC

**Status: fase 1 implementada em 2026-09-23; o resto continua proposta.** O que foi entregue, e o que a entrega mediu diferente do texto abaixo, está em [meteorologia do PITCIC](docs/wiki/meteorologia-pitcic.md) e no registro de decisão do dia. A fase 1 entrou com visibilidade, nebulosidade e pressão, que vêm na mesma consulta; ficaram para depois o gradiente (D4) e o regime de clima. Três correções da entrega: a altitude do ponto NÃO é enviada (D11 e A14 abaixo estão superados); o cabeçalho `Origin` sai sempre, porque o CORS o exige; e a bandeira nasce LIGADA, por decisão do dono, o que torna a consulta à fonte pública o padrão de toda implantação (D1 decidido nesse sentido).

Escrita em 2026-09-23 contra o commit `a3e9b27f` e reescrita no mesmo dia, quando o dono escolheu que a consulta sai do NAVEGADOR, direto para a fonte (arranjo C2, §6). Complementa a proposta de dados solares e lunares, que cobre duas das nove linhas da matriz e foi implementada em 2026-09-23 no branch `luminosidade-pitcic`. Por decisão do dono no mesmo dia, luminosidade e meteorologia têm entradas e telas separadas; esta tela copia o desenho daquela e reaproveita as definições dela (ponto, dia D, dia civil em P).

Origem: análise do EB70-MC-10.336 pedida pelo Chefe da DGEO em 2026-09-23. A primeira leitura deixou estas linhas fora do escopo porque "o sistema não tem previsão do tempo"; a pergunta seguinte foi se não daria para buscá-la numa fonte online. Dá, e esta proposta diz a que preço.

> **Divergência declarada.** Este é um documento de trabalho na raiz. Ao ser aceito, o conteúdo perene migra para `docs/wiki/`, a decisão ganha entrada em `docs/decisions/decisions-2026.md`, e este arquivo sai junto com a linha que o declara em `frontend/tests/unit/docs-integridade.test.js`.
>
> **Este arquivo é vigiado por aquele teste**: todo caminho entre crases precisa existir, e todo símbolo entre crases (camelCase, SCREAMING_SNAKE ou `fn_`) precisa existir no código. Por isso o que ainda não existe (os módulos novos, a variável de ambiente, a bandeira de configuração) aparece em prosa ou dentro de bloco de código, nunca entre crases. A pasta do painel de luminosidade é citada sem arquivo, porque ela pode mudar de forma no commit que a entrega.

## 1. O que se propõe

Preencher, numa tela própria, as linhas da "Matriz das condições meteorológicas" que dependem de previsão do tempo, para um ponto e para os dias D, D+1 e D+2, com os rótulos do Quadro 4-5 e as mesmas definições de dia que a tela de luminosidade usa. O navegador busca a série horária de um modelo numérico de previsão direto na fonte, agrega por dia e desenha o quadro; o backend não busca nada, e só diz ao cliente se o recurso está ligado e qual é o endereço da fonte. O quadro diz sempre de qual fonte, de qual modelo e de qual rodada o dado saiu.

Entra também uma linha que o manual pede e que nenhuma tabela pronta traz: o gradiente de temperatura (inversão, neutralidade ou lapse), que o item 4.3.3.3.5 a amarra ao emprego de fumígenos e de agentes QBRN e que se calcula a partir da temperatura em duas alturas.

Fica de fora a metade de baixo do Quadro 4-5, a tabela de efeitos por tropa, aeronave, sensor e fogos, já que o manual não dá limiar nenhum para ela e o preenchimento é julgamento de estado-maior.

**Luminosidade e meteorologia são telas separadas, cada uma com a sua entrada** (dono, 2026-09-23). A separação acompanha a diferença de natureza entre as duas: a luz é cálculo local, sem rede, enquanto a previsão depende de uma fonte externa e de uma bandeira do administrador, e numa tela só a falha de uma apareceria na outra. O preço é que o produto doutrinário é UMA tabela, o Quadro 4-5, e nenhuma das duas telas o mostra inteiro (D9).

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

O Quadro 4-5 é "Previsão de tempo para 3 dias", com uma coluna por dia e valores diários: máximo e mínimo, total, direção dominante. Cada célula desta proposta é a AGREGAÇÃO de uma série horária sobre o dia civil de Brasília (P), o mesmo dia que a tela de luminosidade usa.

| Linha do Quadro 4-5 | O que o exemplo mostra | Agregação proposta sobre o dia civil em P | Observação |
|---|---|---|---|
| Previsão de tempo | ícone e texto ("chuvas esparsas", "parcialmente nublado", "chuva forte") | o código de tempo WMO mais severo do período diurno, traduzido para frase curta | a fonte F1 devolve o código, conferido em 2026-09-23 (D8) |
| Precipitação | "1 mm", "0 mm", "12 mm" | soma diária em mm, mais a maior probabilidade horária | 0 mm é valor, e não ausência (A5) |
| Temperatura | "Max: 36° C", "Min: 21° C" | máximo e mínimo horários | |
| Ventos | "Direção: N-NW", "Velocidade: 1,4 m/s", "Altura: (teto)" | direção por média VETORIAL em 16 rumos, velocidade média em m/s, rajada máxima | o teto fica vazio, com motivo: a fonte que o traz (F3) não cabe no navegador (§4) |
| Umidade | "Max: 42%", "Min: 21%" | máximo e mínimo horários | |
| Visibilidade | "Neblina máxima diurna", "Névoa diurna média", "Neblina grossa" | menor visibilidade horária em metros, com o horário em que ocorre | a linha mais fraca de todas (A10) |

Duas linhas estão no item 3.2.7 e não aparecem no exemplo do Quadro 4-5: nebulosidade (com cobertura de nuvens) e pressão atmosférica. A proposta é entrarem como linhas auxiliares, recolhidas por padrão (D6).

A linha derivada é o gradiente:

| Linha nova | Grandeza | Regra | Observação |
|---|---|---|---|
| Gradiente de temperatura | diferença entre a temperatura a 80 m e a 2 m, por hora | inversão se positiva acima do limiar, lapse se negativa abaixo dele, neutralidade entre os dois | o manual não dá número para "pequena ou nula" (D4); a célula mostra o período de inversão do dia, que é o que decide fumígeno |

## 4. As fontes

| Código | Fonte | Cobre | Limite verificado em 2026-09-23 | Cabe em C2 |
|---|---|---|---|---|
| F1 | Open-Meteo, API pública | temperatura a 2 m e a 80, 120 e 180 m, umidade, nebulosidade total e por camada, precipitação e probabilidade, visibilidade, vento a 10 m e rajada, pressão, CAPE, código de tempo WMO; até 16 dias, por hora | uso gratuito só não comercial, e os exemplos dos termos são pesquisa em instituição pública e conteúdo educacional; teto de 10.000 chamadas por dia, 5.000 por hora e 600 por minuto; dados em CC BY 4.0 | sim: responde `access-control-allow-origin: *`, e aceita vento em m/s, fuso e altitude do ponto como parâmetros (medido com uma coordenada qualquer) |
| F2 | Open-Meteo em servidor nosso | o mesmo que F1, com a mesma interface | código em AGPL-3.0, com Docker; no modo padrão ele lê sob demanda da distribuição pública da Open-Meteo na AWS S3 e guarda em cache local; o modo alternativo baixa os modelos inteiros, direto dos serviços nacionais; o guia pede ao menos 100 GB de disco | sim, trocando só o endereço da fonte na configuração |
| F3 | REDEMET, do DECEA | METAR, TAF, aviso de aeródromo, SIGMET, radar, satélite; o meteograma decodifica METAR e TAF | só aeródromos, por código ICAO; exige cadastro e chave, passada na query como `api_key` | não: a chave iria para o navegador de cada usuário; volta só se uma rota do backend for aceita |
| F4 | INMET | previsão por município no portal; séries de estação no BDMEP | não foi achada API de previsão documentada | não |
| F5 | Open-Meteo, API histórica | ERA5 a 0,25° desde 1940 e ERA5-Land a 0,1° desde 1950, com cinco dias de atraso; IFS a 9 km desde 2017 | os mesmos termos de F1 | sim: responde `access-control-allow-origin: *` |

A estrutura meteorológica da Aviação do Exército, que o item 1.2.9 cita, não foi pesquisada nesta revisão. Um canal institucional que exija credencial esbarra no mesmo impedimento de F3.

## 5. Dois regimes: previsão e clima

Previsão acaba entre 7 e 16 dias, conforme o modelo. O planejamento, porém, frequentemente trabalha um dia D mais distante, e a Fig 4-9 já separa as duas coisas: "Definição do Clima" antes de "Definição da Evolução das Condições Meteorológicas".

Cada coluna do quadro, portanto, declara o seu regime:

- **Previsão**, quando o dia está dentro do horizonte da rodada: os valores da §3, com modelo e rodada.
- **Clima**, quando está fora: normais do período tiradas de F5 (médias de máxima e mínima, frequência de dia com chuva, vento predominante), com a palavra "clima" escrita na célula.

Como D, D+1 e D+2 são consecutivos, uma mesma tabela pode ter uma coluna em cada regime, e é isso que torna a declaração por coluna obrigatória. O dia D é hoje ou a data escolhida na tela, sem vínculo com a linha do tempo do mapa, igual à luminosidade.

## 6. Quem chama a fonte, e o que isso expõe

Três arranjos foram comparados em 2026-09-23, e o dono escolheu C2:

| Código | Quem chama a fonte | Quem precisa de internet |
|---|---|---|
| C1 | o backend do EBGeo | o servidor do 1º CGEO |
| **C2 (escolhido)** | **o navegador do usuário, direto** | **cada computador cliente, pelo proxy da EBnet** |
| C3 | backend ou navegador, chamando um Open-Meteo nosso dentro da rede | só a máquina desse Open-Meteo |

C2 dispensa módulo de busca no backend e dispensa saída de rede no servidor, que hoje não faz nenhuma chamada HTTP externa (a busca por `fetch(`, `https.get` e `axios` em `backend/src` volta vazia em `a3e9b27f`). E C2 não fecha a porta de C3: como o endereço da fonte vem da configuração, apontar os navegadores para um Open-Meteo interno é troca de URL, e não de código.

**O custo de C2 é de sigilo.** Cada consulta sai de uma estação de trabalho diferente e diz à fonte uma região de interesse e uma data. O código já trata a coordenada como sensível: o log de acesso do gazetteer (`backend/src/middleware/nomes-access-log.js`) grava quais filtros foram usados e nunca os valores, porque "for a military gazetteer the raw search terms and click coordinates are sensitive". E a decisão de telemetria de 2026-09-01 recusou serviços de terceiros pelo mesmo motivo (`docs/wiki/observabilidade.md`).

O que a tela controla, e o que não controla:

| Sai do navegador | Por quê |
|---|---|
| a coordenada ARREDONDADA ao passo da grade (D11) | a previsão não tem resolução maior que a grade do modelo, então a casa decimal a mais só serviria para expor o ponto |
| o endereço público de saída da EBnet e o agente do navegador | inevitável em qualquer chamada; o endereço identifica a rede do Exército, igual identificaria o do servidor em C1 |
| a janela de dias pedida | inevitável |

| Não sai, por construção | Como |
|---|---|
| o token da sessão | a chamada não usa o cliente HTTP da aplicação (`apiClient`), que carimba credencial (A13) |
| cookie | `credentials: 'omit'` |
| o endereço da página do EBGeo, que pode conter o id do atlas | `referrerPolicy: 'no-referrer'` (A1) |
| a coordenada exata | arredondamento antes de montar a URL |

As opções de exposição, da menor para a maior:

| Código | Arranjo | O que sai | Cabe em C2 |
|---|---|---|---|
| M1 | F2 com os modelos baixados inteiros | nada por consulta | sim, pelo endereço da fonte |
| M2 | F3 isolada | o interesse num aeródromo | não |
| M3 | F2 no modo padrão | quais blocos da distribuição foram lidos, que é região grosseira | sim, pelo endereço da fonte |
| M4 | F1 com coordenada arredondada | a célula de 10 a 25 km, a uma empresa estrangeira; o padrão das consultas ao longo dos dias continua revelando a área de interesse | sim, e é o ponto de partida |

C2 começa em M4 e pode descer a M1 sem mudar código, no dia em que existir uma máquina com Open-Meteo e saída para baixar os modelos. A aceitação de M4 enquanto isso é decisão do Chefe (D1).

## 7. Onde o código mora

**Frontend, que concentra quase tudo.** Três peças novas numa pasta de meteorologia, cada uma com uma responsabilidade:

- **o adaptador**: monta a URL com a coordenada arredondada e chama `fetch` com `credentials: 'omit'`, `referrerPolicy: 'no-referrer'` e nenhum cabeçalho próprio, recebe o transporte injetado para ser testável sem rede, e guarda a resposta num cache em MEMÓRIA pela célula e pela rodada;
- **a agregação**: função pura, testável em node, que transforma a série horária nas células da §3;
- **a tela**: entrada e desenho abaixo.

A entrada e a tela seguem o desenho que a luminosidade entregou:

- o item "Meteorologia neste ponto" no menu de contexto do mapa, logo abaixo de "Luminosidade neste ponto" (as duas agem sobre o ponto clicado), que some quando a bandeira está desligada;
- o mesmo cartão sob a barra de busca, que no celular vira folha inferior de três alturas, com o mesmo pino efêmero no ponto;
- o dia D é hoje ou a data escolhida na tela;
- "Salvar tabela", um CSV com as mesmas regras do da luminosidade (vírgula, BOM, `escapeCsvCell`, latitude e longitude numéricas), e sem elemento no PDF;
- carga sob demanda por `carregarSobDemanda`, com a porta nova no censo (`frontend/tests/unit/carga-sob-demanda-portas.test.js`);
- a atribuição que a CC BY 4.0 exige, na tela e no CSV.

As definições comuns (dia civil em P, rótulos D, D+1 e D+2, aviso de computador fora de UTC−3) moram hoje no módulo de hora de Brasília da pasta da luminosidade (`frontend/src/js/utilities/luminosidade/`). Elas saem para um lugar comum no primeiro commit da meteorologia (D10).

Os estados, cada um com frase curta e ação (regra de aviso da constituição):

- bandeira desligada: o item do menu não é desenhado, e a tela de luminosidade não muda em nada;
- a fonte não respondeu: as linhas mostram "Previsão indisponível", nunca zero, com "Verifique sua conexão e tente de novo" e o botão "Tentar de novo"; a tela não afirma causa, porque falha de rede, bloqueio do proxy e recusa de CORS chegam iguais ao navegador (A6);
- dia fora do horizonte: a coluna muda para clima e diz isso;
- carregando: a tela abre na hora com o ponto, os dias e as linhas vazias, e os números chegam depois.

**Backend, que só configura.** Nenhuma rota nova e nenhuma chamada de saída. O que muda:

- a bandeira em `features`, editável na aba Sistema pelo `configOverridesSchema` (`backend/src/modules/config/config.admin.schemas.js`), como as bandeiras que já estão lá;
- o endereço da fonte no `GET /api/config`, montado por `buildAppConfig` ao lado do endereço do servidor de tiles, lido de uma variável de ambiente com nome a decidir, por exemplo:

```
METEO_FONTE_URL=https://api.open-meteo.com
```

- o evento de uso da tela, no mesmo commit e no molde que a luminosidade seguiu no `5933a7c2`: o evento em `frontend/src/js/session/eventos-de-uso.js`; em `backend/src/modules/uso/eventos-de-uso.js`, o evento em `EVENTOS_DE_USO` e a entrada dele em `PROPS_PERMITIDAS`; uma migração que redeclara o CHECK inteiro, com a linha dela em `EXCECOES_DESTRUTIVAS` (`backend/tests/unit/migrations-higiene.test.js`), porque o DROP CONSTRAINT é lido como destrutivo; e a linha da migração na tabela de `backend/src/database/migrations/README.md` (A12). O teste de catálogo do backend acha sozinho a última migração que redeclara o CHECK.

O `GET /api/config` continua igual para todo chamador: a bandeira e o endereço são da implantação, e não da pessoa.

**Implantação.** Se o nginx de produção publicar política de segurança de conteúdo, o host da fonte entra na lista de conexões permitidas. O repositório não tem essa política, e a de produção não está aqui.

**Ordem de trabalho.** A meteorologia toca os mesmos arquivos que o branch da luminosidade tocou (o menu de contexto e o CSS dele, os dois catálogos de eventos de uso, a migração que alarga o CHECK de eventos, o teto de peso da página do mapa e o censo das portas de carga). A luminosidade foi commitada no `5933a7c2`, e a meteorologia parte dele.

## 8. O que NÃO fazer

- **Nada de calco gravado de meteorologia.** O item 4.3.3.2.3 manda evitar calco específico porque o elemento muda rápido. É tela que se recalcula, e não feição que envelhece.
- **Nada de chamada pelo cliente HTTP da aplicação.** Ele carimba o token da sessão, e a fonte aceitaria o cabeçalho (A13).
- **Nada de coordenada em disco nem em canal da casa.** O cache fica em memória; o evento de uso não leva o ponto; o relato de erro não leva a URL da consulta (A1).
- **Nada de efeitos automáticos.** A metade de baixo do Quadro 4-5 continua julgamento, e uma cor verde calculada por limiar inventado seria lida como avaliação de estado-maior.
- **Nada de precipitação de D+2 apresentada como fato.** A célula leva a probabilidade e o carimbo da rodada ao lado do valor.

## 9. As armadilhas

| Código | Armadilha | Como se previne |
|---|---|---|
| A1 | **Coordenada vazando por canal da casa.** O Referer levaria à fonte o endereço do EBGeo, que pode conter o id do atlas; o relato de erro do `fetch` pode carregar a URL com a coordenada para a telemetria; o evento de uso pode ganhar a coordenada como propriedade | `referrerPolicy: 'no-referrer'`; o erro é relatado por `relatarErro` sem a URL; `registrarUso` só com evento e propriedade do catálogo, sem ponto |
| A2 | **Dia UTC no lugar do dia civil.** A série vem em UTC, e agregar pelo dia UTC desloca três horas: a máxima de D pode sair da tarde de D e a chuva da noite trocar de coluna | agregar pelo dia civil em P, com a mesma função de data da luminosidade; pedir a série em UTC em vez de pedir o fuso de São Paulo à fonte, que mudaria sozinho se o horário de verão voltasse |
| A3 | **Unidade do vento.** A fonte devolve km/h por padrão, e o Quadro 4-5 escreve m/s | pedir m/s explicitamente (conferido: a resposta declara `m/s`) e prender num teste |
| A4 | **Média aritmética de direção.** A média de 350° e 10° dá 180°, o rumo oposto | média vetorial ponderada pela velocidade, com teste na virada do norte |
| A5 | **Zero no lugar de ausência.** "0 mm" é previsão de tempo seco; "sem dado" é outra coisa | ausência é nulo com motivo, e a célula nula nunca imprime zero, como na tela de luz |
| A6 | **Três falhas com a mesma cara.** Sem internet no cliente, bloqueio do proxy da EBnet e recusa de CORS chegam ao `fetch` como o mesmo erro de rede, sem detalhe | a frase não afirma causa; a fase 0 mede a saída numa estação real antes de haver tela |
| A7 | **Cache sem rodada na chave.** A previsão velha sairia com carimbo novo | rodada na chave e no carimbo da tela |
| A8 | **Cota dividida.** O teto de F1 é por endereço de origem, e atrás do NAT da EBnet muitos clientes, inclusive de outros sistemas, podem sair pelo mesmo endereço | uma chamada por abertura com todas as variáveis, cache por célula na sessão; o problema some com F2 |
| A9 | **Horizonte.** Pedir dia além da previsão devolve série vazia ou erro | o adaptador decide o regime antes de chamar, e a coluna diz "clima" |
| A10 | **Neblina de vale e de costa.** Modelo de 10 a 25 km não resolve a neblina que o item 4.3.3.3.5 b aponta como a mais frequente, e a visibilidade prevista por modelo é a variável menos confiável da tabela | a célula diz a resolução do modelo |
| A11 | **Gradiente fora da faixa que importa.** A temperatura a 80 m vem do modelo, e não de medição; uma inversão rasa, de poucas dezenas de metros, pode sair atenuada | a linha diz "estimado pelo modelo" e nunca substitui a medição da equipe QBRN |
| A12 | **Evento de uso registrado pela metade.** Três formas, e cada uma perde mais que a própria contagem: CHECK redeclarado sem o evento da luminosidade faz o banco recusar a telemetria daquela tela; evento sem entrada em `PROPS_PERMITIDAS` faz o backend recusar o lote inteiro com 422, levando as outras contagens do lote; e código implantado antes de `npm run db:migrate` falha no CHECK do mesmo jeito | redeclarar com todos os eventos vigentes (o teste de catálogo lê a última migração que redeclara o CHECK e acusa a omissão); a entrada nas duas listas do catálogo do backend; a migração aplicada antes de subir o código em qualquer ambiente, produção inclusive |
| A13 | **Token para terceiro, sem erro nenhum.** A política de CORS da fonte lista `authorization` entre os cabeçalhos aceitos (medido em 2026-09-23), então uma chamada feita pelo `apiClient` levaria o token e responderia 200 | `fetch` puro, sem cabeçalho próprio; teste que falha se a chamada levar qualquer cabeçalho de credencial |
| A14 | **O arredondamento move a altitude.** A fonte corrige a temperatura pela altitude do ponto pedido, então o ponto arredondado pode cair noutra cota | mandar a altitude do ponto clicado, lida do MDE por `getTerrainElevation` (`frontend/src/js/terrain/terrain-elevation.js`), que é um número sem posição (D11); sem terreno 3D ligado ela devolve 0 e não se manda |

## 10. Como isso se prova

- **Agregação, em node, contra respostas gravadas.** Os casos obrigatórios: dia que cruza a meia-noite UTC, direção virando o norte, zero contra nulo, coluna fora do horizonte.
- **Adaptador, em node, com transporte injetado.** A URL não traz mais casas decimais que o passo da grade; a chamada sai com `credentials: 'omit'`, `referrerPolicy: 'no-referrer'` e sem cabeçalho de credencial. Controle negativo: passar a chamada pelo cliente da aplicação e confirmar que o teste reprova.
- **Caminho independente.** A fonte também entrega máximos, mínimos e somas diárias no fuso pedido. A soma que o módulo calcula a partir da série horária precisa bater com a diária da própria fonte pedida no fuso de Brasília; divergência acusa A2 ou A3 sem ninguém precisar ler código.
- **Controle negativo de A2.** Trocar o dia civil em P pelo dia UTC e confirmar que o teste reprova.
- **Nenhum teste toca a rede.** O Playwright intercepta o host da fonte com `page.route` e responde com a gravação; a captura lê a imagem, também com `--project=firefox`, já que metade dos usuários usa Firefox.

## 11. Fases de entrega

| Fase | Conteúdo | Código |
|---|---|---|
| 0 | Numa estação real da EBnet, confirmar que o navegador alcança o host da fonte e se o nginx de produção publica política de segurança de conteúdo; aceite de M4 pelo Chefe (D1) e leitura jurídica dos termos de F1 (D12) | nenhum |
| 1 | Sobre o commit da luminosidade (`5933a7c2`): bandeira e endereço da fonte no `/api/config`, evento de uso com a migração dele; adaptador, agregação, item de menu e tela com temperatura, precipitação, vento e umidade, e "Salvar tabela". Implantação: `npm run db:migrate` antes de subir o código | frontend e configuração do backend |
| 2 | Visibilidade, nebulosidade, pressão e gradiente; regime de clima fora do horizonte, por F5 | frontend |
| 3 | Descer de M4 a M1: um Open-Meteo interno com os modelos baixados, e a troca do endereço na configuração | nenhum; é infraestrutura |
| 4 | Opcional: ventos predominantes numa sobreposição que se recalcula (4.3.3.3.5 d), sem feição gravada | frontend |

## 12. O que fica em aberto

Decisões para o Chefe, na ordem em que bloqueiam:

| Código | Decisão | Recomendação | Bloqueia |
|---|---|---|---|
| D1 | Aceitar M4 (API pública, coordenada arredondada) até existir o Open-Meteo interno | aceitar só com D12 resolvida, e com a fase 3 no plano | fase 1 |
| D2 | Coordenada em POST ou GET na rota do backend | superada: em C2 não há rota | nada |
| D3 | Rota anônima ou só com sessão | superada: em C2 não há rota, e a tela vale para quem a bandeira alcançar | nada |
| D4 | Limiar da neutralidade no gradiente | tirar o número do manual de fumígenos ou QBRN do Exército antes de escrever a linha; sem essa fonte, ela não entra | fase 2 |
| D5 | Direção do vento no dia: média vetorial, ou direção na hora de maior velocidade | média vetorial, com a rajada máxima e a hora dela ao lado | fase 1 |
| D6 | Nebulosidade e pressão como linhas próprias | auxiliares, recolhidas por padrão | fase 2 |
| D7 | O cabeçalho do exemplo diz "Válido até 0700 de D-1"; o quadro gerado diria a rodada e a próxima atualização | rodada e próxima atualização, em P | fase 1 |
| D8 | A linha "Previsão de tempo" com ícone e texto | texto pelo código WMO, que a fonte devolve; ícone só se couber no cartão | fase 2 |
| D9 | O Quadro 4-5 é uma tabela só, e as duas telas mostram metades dela | na fase 1 cada tela salva a sua metade; um CSV com a matriz inteira (luz e tempo, mesmo ponto e mesmos dias) se decide quando as duas existirem | nada |
| D10 | Onde moram as definições comuns (dia civil em P, rótulos das colunas, aviso de fuso) | sair da pasta da luminosidade para um lugar comum no primeiro commit da meteorologia, em vez de uma tela importar da outra; o módulo continua folha de zero imports e `frontend/tests/unit/luminosidade-hora-brasilia.test.js` vai junto (condições da sessão da luminosidade, sem objeção dela) | fase 1 |
| D11 | Passo do arredondamento, e se a altitude do ponto vai junto | o passo da grade do modelo fixado na chamada; a altitude vai, porque corrige a temperatura e não carrega posição | fase 1 |
| D12 | Uso operacional do Exército cabe no "não comercial" dos termos de F1 | leitura jurídica antes da fase 1; se não couber, a saída é a assinatura comercial ou antecipar a fase 3 | fase 1 |

Fora do escopo, e registrado para não voltar como surpresa:

- A tabela de efeitos do Quadro 4-5 continua julgamento de estado-maior.
- Teto de nuvens e conferência com aeródromo (F3): exigem chave, e a chave no navegador vaza. Voltam só se uma rota do backend for aceita, o que desfaz parte de C2.
- O calco de neblina do item 4.3.4.1.2 pede dimensão e localização da neblina; modelo global não entrega isso com resolução útil.

O item mais caro desta proposta é o de sigilo, e ele não fica menor por estar na última linha: até a fase 3, cada estação de trabalho que abrir a tela manda a uma empresa estrangeira uma célula da área de interesse e uma data, e o que foi enviado não se recolhe. A fase 0 decide se isso sequer funciona, porque ninguém mediu ainda se uma estação da EBnet alcança o host da fonte.

## Fontes externas

- Open-Meteo, termos de uso: https://open-meteo.com/en/terms
- Open-Meteo, documentação da API de previsão: https://open-meteo.com/en/docs
- Open-Meteo, API histórica: https://open-meteo.com/en/docs/historical-weather-api
- Open-Meteo, código e auto-hospedagem: https://github.com/open-meteo/open-meteo
- Open-Meteo, guia de auto-hospedagem: https://github.com/open-meteo/open-meteo/blob/main/docs/getting-started.md
- API-REDEMET, visão geral: https://ajuda.decea.mil.br/base-de-conhecimento/api-redemet-o-que-e/
- API-REDEMET, TAF: https://ajuda.decea.mil.br/base-de-conhecimento/api-redemet-mensagem-taf/
- INMET, previsão: https://previsao.inmet.gov.br/
- INMET, BDMEP: https://bdmep.inmet.gov.br/

Os cabeçalhos de CORS de F1 e de F5 e os parâmetros de unidade, fuso, altitude, temperatura a 80 m e código de tempo foram medidos em 2026-09-23 por requisição direta às duas APIs, com uma coordenada sem relação com o Brasil.
