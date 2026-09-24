# Luminosidade do PITCIC (dados solares e lunares)

O painel "Luminosidade" calcula no navegador, sem rede, as duas linhas de luz da matriz das condições meteorológicas do EB70-MC-10.336 (ICMN, FCVN, fase lunar, Ini Luar e Fim do luar) para um ponto e para D, D+1 e D+2, em hora de Brasília; esta página guarda as leituras da doutrina que decidem os números, as armadilhas que já erraram horário em silêncio e o que ficou de fora por decisão do dono.

O código mora em `frontend/src/js/utilities/luminosidade/`, e o `fileoverview` de cada arquivo carrega o detalhe. A entrada é o item "Luminosidade neste ponto" do menu de contexto (`frontend/src/js/context-menu/context-menu.control.js`), e o painel não escreve nada: nenhuma feição, nenhuma op de sync, nenhum gate de papel, porque o item 4.3.3.2.3 do manual proíbe calco próprio para meteorologia e porque um cálculo não tem o que conceder nem recusar.

## As três leituras da doutrina (decididas em 2026-09-23)

O manual exibe o Quadro 4-5 preenchido sem definir os campos, e três lacunas mudam o número na tela. O dono aceitou as três recomendações da proposta, e o registro datado está em [`docs/decisions/decisions-2026.md`](../decisions/decisions-2026.md).

- **Primeira e última claridade ficam a −18°**, pela seta da Fig 4-10, e não a −12° do first light do dicionário do Departamento de Defesa norte-americano. A diferença entre os dois horários é de 24 a 39 minutos no território, e é o ângulo escrito no rótulo ("Sol a −18°") que desfaz o mal-entendido de quem estudou pelo manual estrangeiro.
- **A fase lunar é a janela de sete dias CENTRADA na fase principal** (Fig 4-11 e o texto de 4.3.3.3.4 a), com a fronteira no ângulo de fase (45°, 135°, 225° e 315°) e nunca em contagem de dias, porque o ciclo tem 29,53 dias. O exemplo do Quadro 4-5 segue a convenção coloquial, e as duas convenções dão nome diferente a 135 das 365 noites de 2026; o percentual iluminado entra no bloco "fora do PITCIC" justamente para quem lê com a outra convenção na cabeça.
- **Ini Luar e Fim do luar são a passagem da Lua que mais se sobrepõe à noite de D**, e a noite vai do FCVN de D ao ICMN de D+1. Lidos como eventos soltos do dia civil, os dois campos descreveriam Luas diferentes; a leitura por noite é a única que dá sentido a "início" e "fim".

## As armadilhas, cada uma com o número que a mediu

**O dia civil é o de P, nunca o UTC nem o do navegador.** A data é uma string `AAAA-MM-DD` derivada do instante somado ao deslocamento de Brasília (`dataCivilP`, `frontend/src/js/utilities/hora-brasilia.js`), e a constante do fuso existe em um lugar só. O módulo nasceu dentro da pasta da luminosidade e saiu dela quando o painel de meteorologia chegou, para que nenhum dos dois painéis importe o outro; a condição da mudança é ele continuar folha de zero imports. A ferramenta de declinação grava a data UTC de `new Date()` e registra o dia seguinte depois das 21:00; este módulo não repete a forma.

**O dia solar da biblioteca é o do instante que ela recebe.** Passar a meia-noite de Brasília devolveu os horários da VÉSPERA em 365 de 365 dias em Brasília, Boa Vista e Rio Branco, e acertou em 365 de 365 em Recife, porque a fronteira é o meridiano de 45°W. Uma tabela de teste só com cidades do litoral nordestino passaria verde com o defeito. O modelo passa o meio-dia solar médio local do dia D (`instanteDoDiaSolar`, `frontend/src/js/utilities/luminosidade/matriz-pitcic.model.js`), que acerta em qualquer longitude, e não o meio-dia de P que a proposta sugeria, que só acerta a oeste de 135°E.

**O nascer e o ocaso da Lua vêm por dia UTC.** Tomar a data de Brasília como o dia da biblioteca perde todo nascer entre 21:00 e 24:00 P, que cai no dia UTC seguinte; o modelo varre dias UTC inteiros e filtra pela noite de D.

**O minuto é arredondado, e arredondado antes da data.** O USNO e o Almanaque publicam o minuto mais próximo; truncar enviesaria toda célula em meio minuto, e 23:59:40 precisa virar 00:00 com a marca "(+1)" (`celulaHoraria`). Pela mesma razão a sobreposição entre Lua e noite é medida em minutos inteiros (`sobreposicao`): sem isso, uma Lua que nasce 14 segundos antes do ICMN de D+1 (Brasília, noite de 2026-07-12) "iluminava" a noite, e o painel escrevia Ini Luar 05:50h ao lado de ICMN 05:50h.

**Ausência é nula por CAMPO, nunca por dia.** Na Estação Comandante Ferraz, em 2026-12-21, o Sol nasce e se põe e nunca desce 12° abaixo do horizonte; ICMN e FCVN dizem "não ocorre" com o motivo na dica, e o resto do dia existe. Nulo nunca vira `00:00`.

## A referência: o USNO, todo dia de 2026

A proposta afirmava que o USNO não publica os crepúsculos náutico e astronômico. A API de um dia não publica; a tabela ANUAL publica, e é ela que está congelada em `frontend/tests/fixtures/usno-2026/` (sete pontos, cinco tabelas cada, capturadas em 2026-09-23 com o fuso de 3 h a oeste). Com isso ICMN, FCVN e as linhas de −18° passaram a ser conferidos contra uma instituição, e não só contra uma segunda biblioteca.

`frontend/tests/unit/luminosidade-referencia-usno.test.js` compara todos os dias de 2026 com tolerância de um minuto escrita no teste. Nos seis pontos brasileiros foram 25.550 comparações e o pior caso foi 0,57 min, isto é, o próprio arredondamento da referência. Os controles negativos das armadilhas acima estão codificados como casos do mesmo arquivo, e cada um exige que a variante errada reprove, com a contagem.

O que a tabela NÃO garante, e isso fica escrito para não parecer coberto: a Lua em Ferraz (14 de 661 eventos fora de um minuto, todos em passagens rasantes, em que o nascer e o ocaso distam minutos) e o crepúsculo astronômico de lá; o dia de borda de estação em Ferraz, em que a biblioteca, que resolve com a declinação do meio-dia, põe um ICMN um dia antes do USNO; e qualquer ano que não seja 2026.

## A biblioteca e a carga

A suncalc 2.0.2 entrou em versão exata contra a `astronomy-engine` porque as duas empatam dentro do minuto do USNO e a suncalc pesa sete vezes menos com a API já no formato do quadro. A objeção fica registrada: a 2.0 é uma reescrita de 2026, e o manifesto dela não declara licença (o arquivo LICENSE é BSD-2), de modo que uma varredura automática a relata como desconhecida. O adaptador `frontend/src/js/utilities/luminosidade/efemerides.js` é o único leitor dela, e trocar de biblioteca custa esse arquivo e uma rodada da tabela de referência.

O pacote chega só por `import()`, atrás de `carregarLuminosidade` (`frontend/src/js/utilities/luminosidade/carregador.js`), e está na lista `EXTERNOS_SO_DINAMICOS` do teto de peso do mapa. O molde é o do Turf e não o do WMM, que entrou no boot pelo painel de feição sem que nada acusasse. Há um aquecimento ocioso depois que o mapa desenha (`aquecerLuminosidade`), porque o caso em que a ferramenta mais vale é o da fração sem rede, e um pedaço de código buscado só no primeiro uso falha se a rede caiu antes.

## O que ficou de fora por decisão (2026-09-23)

A proposta previa mais três superfícies, e o dono tirou as três ao ver o painel funcionando:

- a faixa de noite, crepúsculos e luar sob a régua da barra temporal, com o ponto lembrado por mapa;
- a caixa "Dados de luminosidade" no PDF, nos dois motores;
- toda ligação com a linha do tempo: o D é hoje ou a data escolhida no painel (`diaDoPainel`, `frontend/src/js/utilities/hora-brasilia.js`), e não existe "Dia D do mapa" nem "Voltar ao Dia D".

"Copiar tabela" virou "Salvar tabela", que baixa um CSV na convenção da tabela de atributos (vírgula, BOM, toda célula por `escapeCsvCell`). O ponto vai como latitude e longitude numéricas, e não no formato decimal do mapa, porque uma coordenada do hemisfério sul começa com "-" e a guarda de fórmula a imprimiria com um apóstrofo na frente (`tabelaCsv`).

## A casca comum com a meteorologia

Desde 2026-09-23 o cartão, a folha do celular, o pino, o seletor de data e o download moram numa casca comum (`frontend/src/js/utilities/painel-de-ponto/painel-de-ponto.js`, estilo em `frontend/src/css/painel-de-ponto.css`), porque o dono separou luminosidade e meteorologia em duas telas com a mesma cara. A troca foi medida por captura antes e depois, em 1440 e 360 px, no Chromium e no Firefox: sete de oito imagens saíram idênticas pixel a pixel, e a oitava diferiu em 41 pixels de antisserrilhado nos cantos de dois botões. A mudança de comportamento é uma só: os dois painéis ocupam o mesmo lugar, e abrir um fecha o outro.

## Ao capturar a tela

No Chromium do harness do Playwright, que desenha por SwiftShader, a captura mostra uma faixa preta sobre o mapa logo acima do cartão (e às vezes o mapa inteiro escuro) sempre que o cartão fica rolável, isto é, com os dois blocos abertos numa tela de 900 px. Não é defeito do cartão: a mesma página no Chromium com a GPU real (`--use-angle=d3d11`, RTX 4070 Ti) e no Firefox mostra o mapa intacto, e a única propriedade que some com a faixa no SwiftShader é tirar a rolagem, que o cartão precisa. Se a foto precisar do mapa atrás do cartão, capture no Firefox ou com a GPU real.

## Ver também

- [[modulo-temporal]], de onde esta tela ficou deliberadamente separada.
- [[peso-do-pacote-web]], o teto que prende o pacote fora do boot.
- [[observabilidade]], onde o evento de uso `luminosidade.aberta` é contado.
- [[meteorologia-pitcic]], a outra metade da mesma matriz.
