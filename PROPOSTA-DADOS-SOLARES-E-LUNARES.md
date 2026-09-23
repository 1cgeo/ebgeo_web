# Proposta: dados solares e lunares

**Status: proposta, não implementação.** Escrita em 2026-08-14 contra o commit `ac4ba36f` e revisada em 2026-09-23 contra o commit `0a691138`, desta vez contra o texto integral do EB70-MC-10.336 (capítulos I a VII e anexo) e contra o código que a proposta cita como âncora. Duas decisões de escopo do Chefe da DGEO continuam valendo: a Lua entra na primeira entrega, e o horário é o de Brasília.

Origem: análise de sete sistemas externos pedida pelo Chefe. Das quinze lições levantadas, esta é a única autorizada por ora. A ideia veio do plugin QGIS ClimaPlots, que calcula astronomia solar localmente. O ClimaPlots é GPL-2.0, então serve como método, e o código se escreve do zero.

> **Divergência declarada.** O commit `55e98fbd` deixou a raiz com dois arquivos de propósito, e hoje ela tem quatro, este incluído. Ao ser aceito, o conteúdo perene migra para `docs/wiki/`, a decisão ganha entrada em `docs/decisions/decisions-2026.md`, e este arquivo sai junto com a linha que o declara em `frontend/tests/unit/docs-integridade.test.js`.
>
> **Este arquivo é vigiado por aquele teste**: todo caminho entre crases precisa existir, e todo símbolo entre crases (camelCase, SCREAMING_SNAKE ou `fn_`) precisa existir no código. Por isso o que ainda não existe (arquivos novos, a constante do fuso, as funções da biblioteca) aparece em prosa ou dentro de bloco de código, nunca entre crases.

## 0. O que mudou nesta revisão

A versão de 2026-08-14 estava certa no rumo e errada em sete pontos verificáveis, e faltava a ela a metade de interface inteira.

| Código | Mudança | Evidência |
|---|---|---|
| R1 | "Primeira claridade" e "última claridade" ganharam definição: Sol a 18 graus abaixo do horizonte, e não a 12 | seta da Fig 4-10, lida na imagem da página 4-32 |
| R2 | A fase lunar passou a ser janela de sete dias CENTRADA no instante da fase, e a divergência com o exemplo do Quadro 4-5 ficou registrada | Fig 4-11; 135 de 365 noites de 2026 mudam de nome conforme a convenção |
| R3 | "Ini Luar" e "Fim do luar" passaram a ser o nascer e o ocaso da passagem da Lua que cobre a NOITE de D, e não dois eventos soltos do dia civil | Quadro 4-5: "Ini Luar 18:00h" antes de "FCVN 18:07h" e "Fim do luar 08:25h" na manhã seguinte |
| R4 | A hora de Brasília ganhou a letra do fuso, P, que o próprio manual usa | Quadro An-6: "D+1/0000P" |
| R5 | A tabela de bibliotecas foi refeita com medição, e a recomendação trocou de lado | `suncalc` 2.0 saiu em 2026-06-18; as duas candidatas erram no máximo 0,53 min contra o USNO em 94 comparações |
| R6 | Duas armadilhas de dia civil foram medidas e ganharam número | nascer da Lua errado em 61 de 365 dias de 2026 pelo dia UTC; horários do Sol da véspera em 365 de 365 dias a oeste de 45°W |
| R7 | O molde `geomagnetic/` foi corrigido: ele serve de forma, e não de modelo de carga, porque carrega no boot | `geomagnetism` está em `EXTERNOS_ANSIOSOS` |
| R8 | A "coluna D que já existe" foi rebaixada ao que existe de fato: um instante de âncora, com rótulo que depende da unidade do mapa | `DEFAULT_TEMPORAL_CONFIG`, `TEMPORAL_UNITS` |
| R9 | O PDF tem dois motores, e o elemento marginal entra nos dois | `composeLayout` e a capa do mosaico |
| R10 | Seção de UI e UX escrita do zero (§8), com estados, celular, acessibilidade e as três superfícies | esta revisão |

Correções menores: o Quadro 4-5 é "(exemplo)" e se chama "Tabela de efeitos das condições climáticas", enquanto o produto doutrinário tem nome no Quadro 2-1, "Matriz das condições meteorológicas"; o nascer da Lua é a borda SUPERIOR do disco no horizonte, e não o centro; e o texto perdeu a primeira pessoa do singular.

## 1. O que se propõe

Um módulo que responde, para um ponto e um dia D, quando há luz, e que entrega essa resposta nas duas linhas que o PITCIC reserva a ela na matriz das condições meteorológicas, "Dados solares" e "Dados lunares", para D, D+1 e D+2. O cálculo roda no navegador, sem rede e sem servidor, e a tela usa os rótulos que o manual usa.

O resto da matriz (precipitação, temperatura, ventos, umidade, visibilidade e a tabela de efeitos por tipo de tropa) fica de fora, pois depende de previsão do tempo ou de julgamento de estado-maior, e o sistema não tem nenhum dos dois.

## 2. A fonte doutrinária

**EB70-MC-10.336, Processo de Integração Terreno, Condições Meteorológicas, Inimigo e Considerações Civis (PITCIC), 2023.** Lido na fonte, com as figuras e os quadros lidos na imagem da página, já que o texto extraído do PDF não os contém.

| Item | Página | O que fixa |
|---|---|---|
| 2.2.4.2 | 2-4 | a etapa 2 da 2ª fase é o "estudo dos aspectos gerais do terreno e das condições meteorológicas" |
| 2.3.4.1 e | 2-6 | a célula de inteligência deve "monitorar e difundir previsões contínuas sobre as condições meteorológicas, determinando as suas influências nas operações correntes e planejadas" |
| Quadro 2-1 | 2-11 | um dos produtos da 2ª fase é a "Matriz das condições meteorológicas" |
| 3.2.7 | 3-2 | os nove elementos meteorológicos; os dois primeiros são "a) crepúsculos" e "b) fases da lua"; o termo "implica em previsões para apoiar as operações futuras" |
| 4.1.3 | 4-1 | "O emprego de um Sistema de Informações Geográficas (SIG) será muito útil na confecção dos diversos calcos", e os produtos "podem ser impressos em vários tamanhos ou difundidos digitalmente" |
| 4.3.3.2.3 | 4-30 | as restrições meteorológicas vão no calco de restrição ao movimento, "evitando-se a confecção de calcos específicos" (ver §10) |
| 4.3.3.3.2 | 4-31 | "Os elementos meteorológicos que mais influenciam as operações militares são o crepúsculo, as fases da lua, as condições atmosféricas e outros." |
| 4.3.3.3.3 a | 4-31 | os três crepúsculos e o valor militar de cada um; o náutico limita a visibilidade "a um máximo de 400 metros" |
| 4.3.3.3.3 b | 4-31 | os horários "dependem da localização geográfica (latitude e longitude) e variam ao longo do ano" |
| 4.3.3.3.3 c | 4-31 | a baixa luminosidade favorece a ofensiva (concentração, manobra, surpresa) e prejudica a defensiva (vigilância, reconhecimento, coordenação) |
| Fig 4-10 | 4-32 | as faixas de 0, 6, 12 e 18 graus, e as setas de PRIMEIRA e ÚLTIMA CLARIDADE na linha de 18 graus |
| 4.3.3.3.4 a | 4-32 | as fases "divididas conforme período de sete dias", com visibilidade mínima na nova e máxima na cheia |
| 4.3.3.3.4 b | 4-32 | "a luminosidade deve ser analisada em função do nascer e do pôr do sol e das fases da lua" |
| 4.3.3.3.4 c | 4-32 | a visibilidade é afetada também por "precipitações, nebulosidade, ventos etc." |
| Fig 4-11 | 4-32 | as 28 posições da Lua em quatro grupos de sete, com o nascer e o ocaso de cada dia |
| Quadro 4-5 | 4-35 | o exemplo preenchido, de onde saem os rótulos (§4.1) |
| 4.6.4.1 b | 4-51 | o efeito na visibilidade é "a influência da lua, de nevoeiros etc., sobre as operações militares, determinando o período e a atividade a ser ou não realizada" |
| 7.2.1.1 | 7-3 | na condução, cabe à inteligência "atualizar a matriz de considerações meteorológicas" |
| Quadro An-6 | An-9 | o tempo se escreve com dia relativo e letra de fuso: "D+1/0000P" |

O manual chama o mesmo produto de três nomes (matriz das condições meteorológicas, matriz de considerações meteorológicas, tabela de efeitos das condições climáticas). A tela usa o do Quadro 2-1, que é o da lista oficial de produtos da fase.

## 3. Três leituras que o manual deixa abertas

O manual exibe o produto sem defini-lo campo a campo. Três lacunas mudam o número que aparece na tela, e cada uma precisa de decisão do Chefe antes da fase 1 (§13).

### L1. Primeira e última claridade: 18 graus, e não 12

A Fig 4-10 põe "Civil" entre as linhas de 0 e 6 graus, "Náutico" entre 6 e 12 e "Astronômico" entre 12 e 18, e as duas setas de PRIMEIRA CLARIDADE e ÚLTIMA CLARIDADE apontam para a linha de 18 graus. Pela figura, portanto, a primeira claridade é o início do crepúsculo matutino astronômico, com o Sol a 18 graus abaixo do horizonte.

O dicionário militar do Departamento de Defesa dos EUA define first light de outro jeito, como o início do crepúsculo náutico matutino, com o Sol a 12 graus abaixo. A tradução literal de first light é primeira claridade, e um oficial que estudou por manual norte-americano vai esperar 12 graus onde a figura brasileira desenha 18. A diferença entre os dois horários foi de 24 a 39 minutos, medida entre 5°N e 33°S ao longo de 2026 (em Brasília, em 2026-09-24, 04:48h contra 05:13h).

**Recomendação:** seguir a Fig 4-10, que é a doutrina nacional, e escrever o ângulo ao lado do rótulo ("Primeira claridade, Sol a −18°"), porque é o ângulo escrito que desfaz o mal-entendido e não o nome.

### L2. Fase lunar: janela centrada, contra o exemplo do Quadro 4-5

A Fig 4-11 desenha 28 posições da Lua em quatro grupos de sete, e cada grupo é centrado no instante da fase principal: o grupo LUA NOVA vai do nascer às 03:24 ao nascer às 08:33, com 06:00 no meio, e o grupo LUA CHEIA vai de 15:24 a 20:33, com 18:00 no meio. Pela figura, "cheia" é a semana que começa três dias e meio antes da lua cheia e termina três dias e meio depois, e o mesmo vale para as outras três.

O exemplo do Quadro 4-5 contradiz a figura, pois escreve "Fase lunar: minguante" ao lado de "Ini Luar: 18:00h", e um nascer às 18:00 é exatamente o centro do grupo LUA CHEIA da Fig 4-11. O exemplo segue a convenção coloquial, em que crescente é tudo o que vai da nova à cheia e minguante é tudo o que vai da cheia à nova.

A diferença não é de borda. Medido com `suncalc` 2.0.2 para Brasília, às 21:00 P de cada dia de 2026, e tomando a convenção coloquial como nova e cheia só no dia do instante (um dia para cada lado) e crescente ou minguante no resto, o nome muda entre as duas convenções em **135 de 365 noites (37%)**. Na noite de 2026-09-24, com a Lua 97% iluminada e a um dia e meio da cheia, a Fig 4-11 diz "cheia" e o calendário diz "crescente".

**Recomendação:** seguir o texto de 4.3.3.3.4 a e a Fig 4-11, que são a norma, e tratar o Quadro 4-5 como o que ele declara ser, um exemplo. Como o ciclo sinódico tem 29,53 dias, cada janela tem 7,38 dias e não sete, e a fronteira fica no ângulo de fase (45°, 135°, 225° e 315°), nunca em contagem de dias. A iluminação percentual entra ao lado, marcada como cálculo auxiliar (§4.3), e é ela que desfaz a ambiguidade para quem lê com a outra convenção na cabeça: as janelas da figura correspondem a 0% a 15% (nova), 15% a 85% (crescente e minguante) e 85% a 100% (cheia).

### L3. "Ini Luar" e "Fim do luar" pertencem à noite, e não ao dia civil

No Quadro 4-5, a coluna D traz "FCVN: 18:07h", "Ini Luar: 18:00h" e "Fim do luar: 08:25h". Lidos como eventos do dia civil D, o ocaso das 08:25 aconteceu de manhã e pertence à Lua que nasceu na véspera, e o par descreve duas Luas diferentes; lidos como início e fim do luar da noite de D, eles descrevem uma passagem só, que nasce às 18:00 e se põe às 08:25 do dia seguinte. Os números do exemplo servem às duas leituras, porém só a segunda dá sentido às palavras "início" e "fim".

O mesmo quadro mostra que o luar não é recortado pelo crepúsculo, já que o Ini Luar das 18:00 vem antes do FCVN das 18:07. O campo é o nascer astronômico, mesmo que caia de dia.

**Recomendação:** a noite de D vai do FCVN de D ao ICMN de D+1; "Ini Luar" e "Fim do luar" são o nascer e o ocaso da passagem da Lua que mais se sobrepõe a essa noite, e o horário que cai no dia seguinte leva a marca "(+1)". Quando nenhuma passagem toca a noite, os dois campos dizem "sem luar". Medido para Porto Alegre em 2026: 37 de 365 noites ficam sem luar, e nenhuma tem duas passagens, de modo que a regra de desempate por sobreposição existe por completude e não gera estado de tela.

## 4. Os campos

### 4.1 As duas linhas do Quadro 4-5

Rótulos copiados como estão, sem nomenclatura inventada.

| Linha | Rótulo | O que é | Definição | Campo da biblioteca (§6) |
|---|---|---|---|---|
| Dados solares | ICMN | Início do Crepúsculo Matutino Náutico | centro do Sol a 12° abaixo do horizonte, subindo | nauticalDawn |
| Dados solares | FCVN | Fim do Crepúsculo Vespertino Náutico | centro do Sol a 12° abaixo do horizonte, descendo | nauticalDusk |
| Dados lunares | Fase lunar | nova, crescente, cheia ou minguante | janela centrada (L2), avaliada no meio da noite de D | phase de getMoonIllumination |
| Dados lunares | Ini Luar | nascer da Lua da noite de D (L3) | borda superior do disco no horizonte, com refração e paralaxe | rise de getMoonTimes |
| Dados lunares | Fim do luar | ocaso da mesma passagem (L3) | idem, descendo | set de getMoonTimes |

O 12° do ICMN deixou de ser "leitura nossa da Fig 4-10", como dizia a versão anterior: é a definição astronômica padrão de crepúsculo náutico, e a figura a confirma. O que continua sendo leitura está em L1 a L3.

Formato do valor, como no Quadro 4-5: `06:09h`. Colunas `D`, `D+1` e `D+2`, pois o quadro é uma "Previsão de tempo para 3 dias".

### 4.2 O detalhe da Fig 4-10

Entra como bloco recolhível, porque 4.3.3.3.4 b manda analisar nascer e pôr do Sol e porque a Fig 4-10 nomeia os extremos. Em ordem cronológica, que é a ordem da figura:

| Rótulo | Ângulo do Sol | Campo da biblioteca |
|---|---|---|
| Primeira claridade | −18°, subindo (L1) | nightEnd |
| ICMN | −12°, subindo | nauticalDawn |
| Início do crepúsculo civil | −6°, subindo | dawn |
| Nascer do Sol | borda superior no horizonte, −0,833° com refração | sunrise |
| Pôr do Sol | idem, descendo | sunset |
| Fim do crepúsculo civil | −6°, descendo | dusk |
| FCVN | −12°, descendo | nauticalDusk |
| Última claridade | −18°, descendo (L1) | night |

Cada crepúsculo leva, em dica de tela, a frase de 4.3.3.3.3 a sobre ele ("proporciona luminosidade suficiente para a realização dos movimentos terrestres [...] visibilidade limitada a um máximo de 400 metros"), porque é essa frase que transforma um horário em decisão.

### 4.3 Cálculo auxiliar, fora do PITCIC

O manual trata a Lua por fase nomeada e não por percentual. Entram, marcados como cálculo nosso e fora da tabela doutrinária:

- iluminação da Lua no meio da noite de D, em percentual inteiro, com a tendência (↑ crescendo, ↓ minguando);
- nada mais na fase 1. O azimute do nascer e do pôr (Sol no olho de quem ataca para leste ao amanhecer) é candidato de fase 3, como traço efêmero no mapa, e só entra se o Chefe pedir.

Regra geral, mantida: campo doutrinário e campo calculado não se misturam na mesma tabela sem marcação.

### 4.4 O modelo, em uma frase por conceito

- **Dia D**: data civil em P (§5), nunca data UTC nem data do navegador.
- **Dados solares de D**: os eventos do Sol do dia civil D.
- **Noite de D**: do FCVN de D ao ICMN de D+1.
- **Dados lunares de D**: a fase no meio da noite de D, e a passagem da Lua que mais se sobrepõe a ela.
- **Ausência**: evento que não ocorre é nulo, e nulo nunca vira `00:00`.

## 5. Fuso, formato e o dia civil

**Horário de Brasília, não Zulu.** Decisão do Chefe, e o manual escreve assim: o Quadro An-6 traz "D+1/0000P", com a letra P, que na convenção militar de fusos é UTC−3.

- Brasília é UTC−3 fixo. Não há horário de verão desde o Decreto 9.772/2019, e o governo descartou a volta para a temporada 2026/2027.
- O deslocamento vira **constante nomeada**, a primeira do código: não existe hoje nenhuma constante de Brasília em `frontend/src/js/`, nem letra de fuso P, nem o deslocamento de −180 minutos escrito em lugar algum.
- O rótulo do fuso aparece UMA vez, no cabeçalho do painel, e não em cada célula: "Hora de Brasília (P, UTC−3)". Horário sem etiqueta de fuso é a tela que mente, pois parece certo e manda a tropa fora de hora.
- O valor segue o Quadro 4-5, `06:09h`. O manual usa também `0700` no cabeçalho do mesmo quadro e `0000P` no anexo; a matriz fica com o formato da própria matriz.
- Horário que cai no dia seguinte ao da coluna leva "(+1)", que o exemplo do manual não traz e cuja falta é exatamente o que torna o exemplo ambíguo (L3).
- **Brasília é a REFERÊNCIA, e não a hora legal do ponto.** Em Manaus (UTC−4, Q) ou Rio Branco (UTC−5, R) a hora legal difere, e o painel não tenta adivinhar o fuso da área de operações.
- Internamente tudo se calcula e se guarda em UTC, e a conversão acontece só na formatação.

**O resto do produto não fala em P, e isso cria um atrito que a tela precisa resolver.** Os rótulos da barra temporal (`formatRelative`, `formatInstant` e os ticks de `frontend/src/js/temporal/temporal-timeline-bar.js`) usam a hora LOCAL do navegador, sem etiqueta, e o único formatador de GDH, `formatDTG`, trabalha em UTC. Num computador configurado para Manaus, a barra marca 04:13 onde o painel marca 05:13h, e os dois estão certos. Quando o deslocamento do navegador na data consultada for diferente de −180 minutos, o painel mostra uma linha: "Este computador está em UTC−4. Os horários deste painel estão em Brasília." Uniformizar o fuso do produto inteiro é outra decisão, e fica em aberto (§13, D5).

**A armadilha do dia civil já mordeu este código.** A ferramenta de declinação grava `calculationDate` como a data UTC de `new Date()` (`frontend/src/js/military_tools/declination_tool/add_declination_control.js`), então depois das 21:00 em Brasília a feição registra a data de amanhã. O módulo novo não pode repetir a forma.

## 6. A biblioteca: decide a medida, não a preferência

A tabela da versão anterior envelheceu em um ponto que inverte a conclusão: a `suncalc` ganhou em 2026-06-18 uma reescrita de precisão (2.0.0), e a 2.0.2 saiu em 2026-09-02. As duas candidatas foram medidas em 2026-09-23, num ambiente descartável fora do repositório.

| | `suncalc` 2.0.2 | `astronomy-engine` 2.1.19 |
|---|---|---|
| Licença | BSD-2-Clause no arquivo LICENSE, porém SEM o campo de licença no manifesto do pacote | MIT, no arquivo e no manifesto |
| Último lançamento | 2026-09-02 (três versões em três meses) | 2023-12-14 |
| Peso do que o quadro usa, minificado e com tree-shaking | 7,3 kB | 57,9 kB |
| Idem, gzip | 3,5 kB | 25,5 kB |
| Maior erro contra o USNO, nascer e ocaso do Sol, crepúsculo civil, nascer e ocaso da Lua (94 comparações) | 0,53 min | 0,51 min |
| Crepúsculo náutico, uma contra a outra (32 comparações) | até 0,04 min | idem |
| Ajuste à API do quadro | as oito linhas da §4.2 prontas; fase, fração, tendência e ângulo do limbo | tudo por busca de altitude, que é mais código nosso |

As 94 comparações vieram de 16 casos (Porto Alegre, Brasília, Manaus e Boa Vista, a 2°49'N, nos dois solstícios e nos dois equinócios de 2026) e seis eventos, menos os dois ocasos da Lua que não ocorrem no dia civil. O USNO publica em minuto inteiro, então um erro de 0,5 min é o próprio arredondamento da referência, e as duas bibliotecas acertam tudo o que a referência consegue medir.

**Recomendação: `suncalc` 2.0.2, fixada em versão exata.** A precisão empatou dentro da resolução da referência, e o peso é sete vezes menor, com a API já no formato do quadro.

A objeção mais forte fica escrita: a 2.0 é uma reescrita de três meses, com três lançamentos no período, enquanto a `astronomy-engine` é estável há quase três anos, e o manifesto sem licença faz qualquer varredura automática de licença reportar o pacote como desconhecido. Duas coisas pagam esse risco. A versão fica exata, e a troca de versão só passa se a tabela de referência (§12) continuar verde; e o adaptador (§7) é o único arquivo que conhece a biblioteca, de modo que trocar para a `astronomy-engine` custa um arquivo e uma rodada de teste.

## 7. Onde o código mora

### 7.1 A forma

```
frontend/src/js/vendor/suncalc.js           ponto único do pacote, como o turf.js ao lado
frontend/src/js/utilities/luminosidade/
  index.js                                  porta pública, poucos nomes
  efemerides.js                             adaptador: o único arquivo que chama o vendor
  matriz-pitcic.model.js                    folha pura: dia D, noite de D, janela de fase, passagem da Lua
  hora-brasilia.js                          folha pura: a constante do fuso, o formato 06:09h, a marca (+1)
  luminosidade.panel.js                     o painel (§8)
```

A pasta muda de "solar" para "luminosidade" porque o conteúdo é Sol e Lua e porque "luminosidade" é a palavra de 4.3.3.3.4 b. As duas folhas puras (sem import nenhum da biblioteca) são o que o teste dirige em node, no mesmo padrão das folhas do módulo temporal.

Convenções da casa que valem aqui: comentário de caminho na linha 1, JSDoc em inglês, string de UI em pt-BR com acento, import por alias, sem estilo inline, `escapeHtml` ou `textContent` em tudo o que vier de fora.

### 7.2 O molde `geomagnetic/` serve de forma, e não de carga

A versão anterior tomou `frontend/src/js/utilities/geomagnetic/` como molde, e ele serve pela metade. A metade que serve é a forma: cálculo inteiro no navegador, poucos nomes públicos, três consumidores. A metade que não serve é a carga, já que o WMM entra no BOOT do mapa: `map_sig.js` importa a barra lateral, que chega a `frontend/src/js/sidebar/panels/feature-panel-content.js`, que importa `frontend/src/js/utilities/geomagnetic/wmm_calculator.js`, e o `geomagnetism` está na lista `EXTERNOS_ANSIOSOS` de `frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js`. O barril `index.js` daquela pasta, aliás, não tem nenhum importador.

O modelo de carga certo é o do Turf: pacote npm em versão exata, ponto único em `frontend/src/js/vendor/`, carregador próprio no molde de `frontend/src/js/utilities/turf-loader.js`, e toda porta de entrada por `carregarSobDemanda`.

### 7.3 A carga, com as quatro travas

1. O pacote entra na lista `EXTERNOS_SO_DINAMICOS` do teste de teto de peso, que então reprova qualquer import estático dele, venha de onde vier.
2. A porta nova entra no censo de `frontend/tests/unit/carga-sob-demanda-portas.test.js`.
3. O PDF chama o módulo por import dinâmico no momento de exportar, porque `frontend/src/js/import_export/pdf-export.tab.js` e `frontend/src/js/import_export/pdf-cartographic-elements.js` são estáticos a partir de `frontend/src/js/map_sig.js`: um import estático ali devolveria o pacote ao boot sem nada mudar na tela, que foi exatamente o caminho do WMM.
4. **Aquecimento ocioso depois do boot.** O cenário em que esta ferramenta mais vale é o da tropa sem rede, e um chunk carregado só no primeiro uso falha se a rede caiu antes dele. O carregador é chamado uma vez em tempo ocioso depois que o mapa sobe, e o custo é baixar cerca de 3,5 kB (mais o código nosso) fora do caminho crítico em toda abertura do mapa. A alternativa, pôr o módulo no grafo ansioso, custaria parse no boot e brigaria com a trava 1.

A dependência nova escreve no lockfile, que a constituição manda tratar como frágil e confirmar antes (§13, D4).

## 8. UI e UX

### 8.1 Quem usa, e para quê

| Código | Quem | Momento | O que precisa |
|---|---|---|---|
| P1 | oficial de inteligência e sua célula | 2ª fase, etapa 2, montando a matriz das condições meteorológicas para operações futuras | os cinco campos do Quadro 4-5 para um ponto e três dias, prontos para colar no documento |
| P2 | comandante e estado-maior | leitura do produto (PDF, apresentação) | o quadro legível, com o ponto e o fuso escritos |
| P3 | fração no terreno, em tablet ou celular | "quando escurece hoje aqui, e vai ter Lua?" | uma resposta de relance, sem rede |

As tarefas, na ordem em que doem: J1 saber quando começa e termina a claridade útil (ICMN e FCVN); J2 saber como estará a Lua nas noites D a D+2; J3 escolher o período da atividade (4.6.4.1 b); J4 levar o resultado ao documento.

### 8.2 Princípios

| Código | Princípio | Por quê |
|---|---|---|
| U1 | Rótulo da doutrina como está, com a sigla expandida em dica de tela e em `abbr` | o oficial reconhece o quadro do manual; quem não é de estado-maior não fica com "ICMN" sem tradução |
| U2 | O ponto e o fuso sempre à vista, no cabeçalho | todo número do painel depende dos dois, e o que não está escrito será presumido |
| U3 | Nulo diz "não ocorre" ou "sem luar", com o motivo na dica | `00:00` é horário válido e errado, e traço mudo se lê como erro de tela |
| U4 | Campo doutrinário e cálculo auxiliar em blocos separados, o auxiliar rotulado "fora do PITCIC" | a matriz vai para documento oficial, e um percentual misturado vira campo doutrinário por contágio |
| U5 | Nenhum gate de papel e nenhuma recusa de estado | o painel só calcula e não escreve nada: Leitor, visitante de link público, atlas local e mapa travado veem o mesmo painel. A constituição do produto não é tocada, pois nada se concede nem se nega |
| U6 | O painel não escreve no mapa | trocar o D no painel não muda a configuração temporal do mapa, que é escrita com op de sync, trava e papel |
| U7 | A ressalva do horizonte é rodapé visível, e não dica | ela é condição de validade do número, e o próprio manual a faz (4.3.3.3.4 c) |

### 8.3 A entrada

**Menu de contexto do mapa**, item "Luminosidade neste ponto", logo acima de "Copiar Coordenadas" em `frontend/src/js/context-menu/context-menu.control.js`. É o vizinho natural: aquele item já lê o ponto clicado e o formato de coordenada corrente (`getCurrentFormat`), e o menu já abre por toque longo de 500 ms em tela de toque. O item existe sempre, em todo papel e todo estado (U5).

O menu de contexto é pouco descobrível, e isso é o custo desta escolha. Duas medidas compensam sem pôr botão novo na barra: uma entrada no tutorial (`frontend/public/docs/README.md`), e o item com ícone próprio no menu. Um botão na barra de ferramentas fica recusado na fase 1, pois a consulta acontece algumas vezes por ciclo de planejamento e a barra é espaço permanente, disputado por ferramentas de uso contínuo. Um evento de uso na abertura do painel (`registrarUso`, com o valor novo entrando nos três vocabulários espelhados no mesmo commit) dirá se a entrada é achada, e é esse número, e não a opinião, que traz o botão de volta à mesa.

### 8.4 O painel

Valores reais, calculados com `suncalc` 2.0.2 para o QG do Exército, em Brasília, com D = 2026-09-24:

```
┌─ Luminosidade ────────────────────────────────────────────── ✕ ┐
│ 15°46'48"S 47°55'45"W                        ◀  24/09/2026  ▶   │
│ D escolhido no painel · Hora de Brasília (P, UTC−3)             │
├───────────────┬───────────────┬───────────────┬─────────────────┤
│               │ D             │ D+1           │ D+2             │
│               │ qui 24/09     │ sex 25/09     │ sáb 26/09       │
├ Dados solares ┼───────────────┼───────────────┼─────────────────┤
│ ICMN          │ 05:13h        │ 05:12h        │ 05:11h          │
│ FCVN          │ 18:54h        │ 18:54h        │ 18:54h          │
├ Dados lunares ┼───────────────┼───────────────┼─────────────────┤
│ Fase lunar    │ cheia         │ cheia         │ cheia           │
│ Ini Luar      │ 16:28h        │ 17:20h        │ 18:12h          │
│ Fim do luar   │ 05:03h (+1)   │ 05:40h (+1)   │ 06:19h (+1)     │
├───────────────┴───────────────┴───────────────┴─────────────────┤
│ ▸ Crepúsculos e claridade (Fig 4-10)                            │
│ ▸ Cálculo auxiliar, fora do PITCIC                              │
├─────────────────────────────────────────────────────────────────┤
│ Horizonte teórico ao nível do mar. Relevo, nuvens e chuva não   │
│ entram no cálculo (PITCIC 4.3.3.3.4 c).       [ Copiar tabela ] │
└─────────────────────────────────────────────────────────────────┘
```

Os dois blocos abertos:

```
▾ Crepúsculos e claridade (Fig 4-10)       D         D+1       D+2
  Primeira claridade (Sol a −18°)        04:48h    04:47h    04:46h
  ICMN (−12°)                            05:13h    05:12h    05:11h
  Início do crepúsculo civil (−6°)       05:38h    05:37h    05:36h
  Nascer do Sol                          05:59h    05:58h    05:58h
  Pôr do Sol                             18:07h    18:07h    18:08h
  Fim do crepúsculo civil (−6°)          18:29h    18:29h    18:29h
  FCVN (−12°)                            18:54h    18:54h    18:54h
  Última claridade (Sol a −18°)          19:19h    19:19h    19:19h

▾ Cálculo auxiliar, fora do PITCIC
  Iluminação da Lua, meio da noite       97% ↑     100% ↑    100% ↓
```

Anatomia e comportamento:

- **Pino no mapa** enquanto o painel está aberto, numa fonte efêmera que não é feição, não vai para o store e sai com o painel. Sem ele, o painel mostra números de um ponto que a pessoa perdeu de vista ao mover o mapa.
- **Coordenada no formato corrente** do mapa, por `formatCoordinates` (`frontend/src/js/utilities/coordinate_converter.js`), para o painel falar o mesmo formato que o resto da tela.
- **Posição**: cartão fixo sobre o mapa, que se reposiciona por `UI_LAYOUT_CHANGED` e fica fora da exclusão mútua entre barra lateral e painel de feição, porque não compete com nenhum dos dois pelo mesmo espaço de trabalho.
- **Trocar o ponto**: abrir o menu em outro lugar e escolher o item de novo substitui o ponto. Arrastar o pino fica fora da fase 1.
- **Fechar**: ✕ ou Esc, com o foco devolvido ao mapa.
- **Linha no cabeçalho**: "D escolhido no painel", "D = Dia D do mapa" ou "D = hoje", conforme a origem (§8.6).

### 8.5 Estados

| Código | Estado | Exemplo real | O que a tela mostra |
|---|---|---|---|
| E1 | normal | Brasília, 2026-09-24 | a matriz |
| E2 | evento do Sol não ocorre, com o resto ocorrendo | Estação Antártica Comandante Ferraz (62°05'S), 2026-12-21: o Sol nasce e se põe, porém nunca desce 12° abaixo do horizonte | ICMN e FCVN: "não ocorre"; dica: "O Sol não desce 12° abaixo do horizonte nesta data." |
| E3 | noite sem luar | 37 de 365 noites em Porto Alegre, 2026 | Ini Luar e Fim do luar: "sem luar"; dica: "A Lua fica abaixo do horizonte durante toda a noite." |
| E4 | horário no dia seguinte | Fim do luar de quase toda noite de cheia | "05:03h (+1)", lido pelo leitor de tela como "do dia seguinte" |
| E5 | navegador fora de P | computador em Manaus | linha no cabeçalho: "Este computador está em UTC−4. Os horários deste painel estão em Brasília." |
| E6 | módulo não chegou | rede caiu antes do aquecimento (§7.3) | o aviso padrão de `carregarSobDemanda`, com "Recarregar" |
| E7 | cálculo | 1,1 ms por matriz de três dias, medido em node | nenhum indicador de progresso; a espera possível é a do chunk, coberta por E6 |

Os textos seguem a regra de aviso da casa (título com o que aconteceu, corpo que diz o que fazer) e passam pelo censo de `frontend/tests/unit/avisos-de-tela-estilo.test.js` quando forem argumento de toast.

### 8.6 O dia D

A origem do D segue esta ordem, e a linha do cabeçalho diz qual venceu:

1. **Dia D do mapa**, quando o mapa tem linha do tempo em modo relativo: a data civil em P do instante que `getTimeContext` devolve, que é o mesmo que a barra usa para rotular, inclusive no recuo para o início do intervalo quando a âncora é nula.
2. **Hoje**, a data civil em P do relógio da máquina.

A pessoa pode mudar o D pelas setas ◀ ▶ e pelo campo de data, e isso muda só o painel (U6). O botão "Voltar ao Dia D" aparece quando o D do painel diverge do D do mapa.

A versão anterior dizia que "a coluna D já existe no código", e existe menos do que isso. O que existe é `origem` em `DEFAULT_TEMPORAL_CONFIG`, um INSTANTE com hora e não uma data, e o rótulo relativo conta na unidade do mapa (`TEMPORAL_UNITS`: minuto, hora, dia ou semana, com hora como padrão). Num mapa em horas, a barra escreve "H+24" onde a matriz escreve "D+1", e as duas estão certas, porque a matriz conta dias civis por definição doutrinária.

### 8.7 Celular e tablet

No celular (`PHONE_QUERY`, em `frontend/src/js/utilities/tablet-mode.js`), o painel vira folha inferior, no padrão de `frontend/src/js/phone/phone-bottom-sheet.js`, em três alturas:

```
espiada  ┃ Luminosidade · qui 24/09 (D)
         ┃ ICMN 05:13h · FCVN 18:54h
         ┃ Lua cheia · luar 16:28h a 05:03h (+1)
meia     ┃ a matriz de três colunas
inteira  ┃ a matriz, a Fig 4-10 e o cálculo auxiliar
```

A espiada responde a pergunta de P3 sem abrir nada. A matriz de três colunas precisa caber em 360 px, e a conta (rótulos a cerca de 90 px, três colunas de 85 px, fonte de 13 px) só vira fato na captura nessa largura (§12). Fica a confirmar, na fase 1, que o menu de contexto abre no layout de celular; se ele não abrir lá, a entrada no celular precisa de outro caminho, e isso volta ao Chefe antes de virar código.

### 8.8 Acessibilidade

- Tabela semântica, com `caption`, cabeçalhos de linha e de coluna com escopo, para o leitor de tela anunciar "ICMN, D mais 1, 05:12".
- Sigla em `abbr` com a expansão, e "(+1)" com texto oculto "do dia seguinte".
- Nenhuma informação só por cor, o que vale em dobro para a faixa da barra (§8.10).
- Contraste pelos tokens de `frontend/src/css/design-tokens.css`.
- Esc fecha, e o foco volta ao mapa.

**Sem desenho da Lua na fase 1**, e a razão é de hemisfério e não de estética: o lado iluminado da Lua crescente é o direito para quem está no hemisfério norte e o esquerdo para quem está no sul, e perto do equador ela deita. O Brasil cruza o equador (Boa Vista está a 2°49'N), então um ícone único estaria errado para uma parte do território. A palavra e o percentual bastam; um ícone, se vier, é orientado pelo ângulo do limbo iluminado no ponto, que a biblioteca fornece.

### 8.9 Copiar

"Copiar tabela" põe na área de transferência a matriz em texto separado por tabulação, que cola como tabela no editor de texto e na planilha, com o ponto, o fuso e a ressalva dentro do próprio texto:

```
Dados de luminosidade (PITCIC, Quadro 4-5)
Ponto	15°46'48"S 47°55'45"W
Hora	Brasília (P, UTC−3)
	D 24/09/2026	D+1 25/09/2026	D+2 26/09/2026
ICMN	05:13h	05:12h	05:11h
FCVN	18:54h	18:54h	18:54h
Fase lunar	cheia	cheia	cheia
Ini Luar	16:28h	17:20h	18:12h
Fim do luar	05:03h (+1)	05:40h (+1)	06:19h (+1)
Horizonte teórico ao nível do mar; relevo, nuvens e chuva não entram no cálculo.
```

É o J4 de P1, e é o que tira a pessoa do hábito de redigitar números, que é onde o erro de transcrição entra.

### 8.10 A faixa na barra temporal (fase 3)

A barra (`frontend/src/js/temporal/temporal-timeline-bar.js`) ganha uma camada de fundo sob a trilha, com o dia pintado por classe de altitude do Sol e uma linha fina para os intervalos de Lua acima do horizonte:

```
 24/09                          25/09                          26/09
 ██▓▒░                  ░▒▓████████▓▒░                  ░▒▓████████
          dia                             dia
 ━━ luar ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ luar ━━━━━━━━━━━━━━━━━
      ▲ cursor
 Faixas para 15°46'48"S 47°55'45"W · trocar ponto
```

Legenda: █ noite (Sol abaixo de −18°), ▓ crepúsculo astronômico, ▒ náutico, ░ civil, fundo claro dia.

Cinco regras, cada uma contra um defeito previsível:

1. **As faixas dependem de um ponto, e a barra é do mapa inteiro.** O ponto de referência é escolhido no painel ("Usar este ponto na linha do tempo") e escrito sob a barra. Recalcular pelo centro do mapa faria a faixa escorregar a cada arrasto.
2. **O ponto é vista da pessoa**, lembrado neste computador por atlas e por mapa por `frontend/src/js/store/vista-da-pessoa.js`, e não viaja, pela mesma razão que o mapa base e o liga-desliga temporal não viajam (`docs/wiki/vista-da-pessoa-e-vista-salva.md`). Fazer a faixa viajar exigiria op de sync, papel e trava, e fica para outra decisão.
3. **Posição pelo instante absoluto**, na mesma conversão de fração que os ticks usam, e nunca pela hora do rótulo: a faixa fica certa em qualquer fuso de navegador, e só os rótulos da barra ficam na hora local (§5).
4. **Cálculo por intervalo, fora do quadro de animação.** A reprodução roda a cada `requestAnimationFrame`; a faixa se calcula uma vez por mudança de intervalo ou de ponto e se desenha como fundo estático.
5. **Nível de detalhe**: com o intervalo acima de algumas semanas, a faixa se reduz a dia e noite, e a dica de tela sobre a faixa sempre diz o texto ("Crepúsculo náutico, 05:13h a 05:38h").

### 8.11 O elemento marginal do PDF (fase 3)

Uma caixa "Dados de luminosidade" entra na lista de Elementos Cartográficos de `frontend/src/js/import_export/pdf-export.tab.js`, ao lado de Título, Legenda, Barra de escala, Seta norte e das duas grades:

```
┌ Dados de luminosidade (PITCIC, Quadro 4-5) ─────────────┐
│ Ponto: 15°46'48"S 47°55'45"W · Hora de Brasília (P)     │
│              D 24/09    D+1 25/09   D+2 26/09           │
│ ICMN         05:13h     05:12h      05:11h              │
│ FCVN         18:54h     18:54h      18:54h              │
│ Fase lunar   cheia      cheia       cheia               │
│ Ini Luar     16:28h     17:20h      18:12h              │
│ Fim do luar  05:03h+1   05:40h+1    06:19h+1            │
│ Horizonte teórico, sem relevo nem nuvens.               │
└─────────────────────────────────────────────────────────┘
```

- **Ponto**: o centro da área exportada, escrito na caixa. **D**: o dia do "Instante retratado" quando a linha do tempo está ligada, pela mesma fonte que `temporalStampText` usa, e a data da exportação quando não está.
- **O texto é montado por uma função pura**, no molde de `temporalStampText`, e desenhado pelos DOIS motores: na folha única, como elemento marginal de `composeLayout`; no mosaico, só na capa (`frontend/src/js/import_export/pdf-mosaic-pages.js`), porque repetido em cada folha ele daria N cópias do mesmo quadro.
- **A carga é dinâmica no clique de Exportar** (§7.3, trava 3).

### 8.12 O que a tela não faz

- Não cria feição, camada nem calco (§10).
- Não usa relevo: o nascer atrás da crista é outro problema, e usaria o motor de visibilidade que já existe.
- Não interpreta: a tabela de efeitos por tipo de tropa do Quadro 4-5 (verde, amarelo, vermelho) é julgamento de estado-maior.
- Não sincroniza nada entre usuários.

## 9. Fases de entrega

| Fase | Entrega | Critério de aceite |
|---|---|---|
| 0 | Sem tela: vendor, adaptador, as duas folhas puras, a tabela de referência | decisões D1 a D4 tomadas; tabela de referência verde; os três controles negativos (§12) vermelhos; `npm run lint` e `npm test` na raiz |
| 1 | Painel pelo menu de contexto, pino, copiar, folha inferior no celular, entrada no tutorial | capturas de desktop e de 360 px lidas; teto de peso verde com o pacote na lista dinâmica; censo de portas verde; `npm run knip` sem órfão |
| 2 | D amarrado ao Dia D do mapa, aviso de fuso do navegador, "Voltar ao Dia D" | captura com mapa em modo relativo, unidade hora e unidade dia |
| 3 | Faixa na barra temporal e elemento marginal do PDF nos dois motores | captura da barra em dois fusos de navegador; PDF de folha única e de mosaico abertos e lidos |

Ao fechar a fase 1, a página da wiki nasce e este arquivo começa a encolher.

## 10. O que NÃO fazer

**A doutrina proíbe a solução óbvia.** Item 4.3.3.2.3: as restrições meteorológicas "podem ser lançadas diretamente no calco de restrição ao movimento, ou em outro calco do terreno, evitando-se a confecção de calcos específicos, já que, em um período relativamente curto, um elemento meteorológico pode sofrer variações".

Logo, nada de camada de calco só para luminosidade. Painel, faixa e elemento marginal, que se recalculam, e não feição gravada que envelhece.

Isso casa com a regra da casa: nenhuma rota REST de escrita e nenhum alvo novo de sync em fase nenhuma desta proposta.

## 11. As armadilhas

| Código | Armadilha | Como se previne |
|---|---|---|
| A1 | **Sinal da longitude.** Oeste é negativo, e trocar o sinal desloca o horário em horas com resultado plausível | tabela de referência com controle negativo (§12) |
| A2 | **O dia da Lua é o dia UTC.** A função de nascer e ocaso da Lua da `suncalc` trabalha sobre o dia civil UTC. Chamada com a data de Brasília, ela devolve o nascer errado em 61 de 365 dias de 2026, sempre que a Lua nasce entre 21:00 e 24:00 P | o modelo busca os eventos de D−1 a D+2 e filtra pela noite de D em P |
| A3 | **O dia do Sol é o dia solar.** A função de horários do Sol devolve o dia solar médio que CONTÉM o instante passado, e a meia-noite de Brasília cai antes da meia-noite solar em todo ponto a oeste de 45°W, fronteira que não se moveu em nenhum dia de 2026. Passada a meia-noite P, a função devolveu os horários da VÉSPERA em 365 de 365 dias em Brasília, Boa Vista e Rio Branco, e acertou em 365 de 365 em Recife e Salvador: um teste só com cidades do litoral nordestino passaria verde com o defeito | o modelo passa o meio-dia de D em P; a tabela tem pontos dos dois lados de 45°W |
| A4 | **O fenômeno pode não ocorrer, e às vezes só em parte.** Em Ferraz, em 2026-12-21, o Sol nasce e se põe, e o ICMN não existe | nulo por campo, e nunca por dia inteiro; a tela escreve "não ocorre" (E2) |
| A5 | **O horizonte é teórico.** Nível do mar com refração padrão; o Sol atrás da crista não está modelado | rodapé visível (U7) |
| A6 | **O nome da fase depende da convenção**, e 37% das noites mudam de nome | janela centrada da Fig 4-11 mais o percentual auxiliar (L2) |
| A7 | **"Fim do luar" sem marca de dia** se lê como a manhã do próprio D | "(+1)" em toda célula que cruza a meia-noite (E4) |
| A8 | **Desenho da Lua por hemisfério** | sem ícone na fase 1 (§8.8) |
| A9 | **UTC−3 pode deixar de ser fixo**, e o navegador pode estar em outro fuso | constante nomeada; aviso E5 |
| A10 | **Import estático pelo PDF ou pelo painel de feição** devolve o pacote ao boot, como aconteceu com o WMM | trava 1 e trava 3 da §7.3 |
| A11 | **Chunk não baixado quando a rede cai** | aquecimento ocioso (§7.3, trava 4) |

## 12. Como isso se prova

Sem tabela de referência não há entrega.

**As fontes**, com o que cada uma alcança, medido em 2026-09-23:

- **USNO**, pela API pública de um dia (aa.usno.navy.mil): respondeu os 16 casos da §6 e publica nascer, ocaso e crepúsculo civil do Sol, nascer e ocaso da Lua, fase e fração iluminada, em minuto inteiro. **Não** publica crepúsculo náutico nem astronômico.
- **Observatório Nacional**: o Anuário Interativo, que publica nascer, ocaso e os três crepúsculos por coordenada ao nível do mar, recusou a conexão por HTTPS e não respondeu por HTTP desta máquina em 2026-09-23; a página de ferramentas do ON respondeu, porém descreve nascer, passagem meridiana, ocaso e fases, e não menciona crepúsculo náutico. É a fonte nacional, a que a tropa consultaria.
- **Almanaque Náutico (DN5) da DHN**, anual, que tabula nascer e ocaso do Sol e da Lua e a hora dos crepúsculos por latitude. É a segunda fonte nacional, e é da Marinha, que usa o crepúsculo náutico por ofício.
- O ICMN, o FCVN e a claridade de −18° precisam de uma das duas antes da fase 1.
- Até a fonte nacional entrar, o crepúsculo náutico tem só a concordância entre duas implementações independentes (0,04 min em 32 comparações), que é evidência mais fraca, pois duas bibliotecas podem errar juntas.

**A tabela**:

- Os 16 casos da §6 viram arquivo de dados congelado no repositório, capturado uma vez, porque a suíte roda sem rede e precisa dar a mesma resposta sempre.
- Mais os casos de borda: Ferraz em 2026-12-21 (E2), uma noite sem luar (E3), uma Lua que nasce entre 21:00 e 24:00 P (A2), Recife e Rio Branco no mesmo dia (A3), e as três fronteiras de fase em torno de uma cheia (L2).
- **Tolerância de 1 minuto, escrita no teste**, e não em comentário: a referência arredonda ao minuto, e o maior erro medido foi 0,53 min.

**Os controles negativos, obrigatórios**, cada um com o vermelho visto antes do aceite:

1. inverter o sinal da longitude (A1);
2. passar a meia-noite de Brasília em vez do meio-dia ao cálculo do Sol (A3);
3. deslocar as janelas de fase em um oitavo de ciclo (L2).

Verde que continua verde com o código quebrado não prova nada.

**Verificação de lógica:** `npm run lint` e depois `npm test`, na raiz, em dois comandos separados.

**UI:** captura do Playwright dirigindo app e backend reais, lida na imagem, em 1440 px e em 360 px de largura, com o toast esperado pela opacidade computada e o texto do painel impresso no stdout como caminho independente da imagem; o spec temporário se apaga depois. A ferramenta é acionada uma vez, na tela, antes de se dizer que está pronta.

## 13. O que fica em aberto

Decisões para o Chefe, na ordem em que bloqueiam:

| Código | Decisão | Recomendação | Bloqueia |
|---|---|---|---|
| D1 | Primeira e última claridade a −18° (Fig 4-10) ou a −12° (first light do DoD) | −18°, com o ângulo escrito no rótulo (L1) | fase 0 |
| D2 | Fase lunar pela janela centrada da Fig 4-11 ou pela convenção do exemplo do Quadro 4-5 | Fig 4-11, com o percentual auxiliar (L2) | fase 0 |
| D3 | "Ini Luar" e "Fim do luar" como a passagem que cobre a noite de D | sim (L3) | fase 0 |
| D4 | Dependência nova, `suncalc` 2.0.2 em versão exata, que escreve no lockfile | aceitar (§6) | fase 0 |
| D5 | Fuso do produto: a barra temporal fala a hora do navegador e o GDH fala UTC, enquanto este painel fala P | tratar em decisão própria; esta proposta só avisa a divergência (E5) | nada |
| D6 | Seletor de fuso no painel (Z, Q, R) | não na primeira entrega | nada |
| D7 | Carimbar o quadro no slide de apresentação, que já guarda o instante (`captureSlideTemporal`) | depois da fase 3 | nada |

Fora do escopo, e registrado para não voltar como surpresa:

- As outras sete linhas da matriz (temperatura, umidade, nebulosidade, precipitação, cobertura de nuvens, vento e pressão) exigem previsão do tempo, que o sistema não tem.
- A tabela de efeitos do Quadro 4-5, com as faixas de impacto por tipo de tropa e de sensor, é julgamento de estado-maior, e não cálculo.
- A precisão fora de 2026 não foi medida. A biblioteca segue as fórmulas de Meeus e deve se manter dentro do minuto por décadas, porém a tabela de referência só prova o ano que ela contém.
- O item mais caro desta proposta é a fonte nacional: sem o crepúsculo náutico do ON ou da Marinha, os dois campos que dão nome à linha "Dados solares" chegam à tela verificados só contra outra biblioteca.
