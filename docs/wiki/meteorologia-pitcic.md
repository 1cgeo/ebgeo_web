# Meteorologia do PITCIC (previsão da matriz)

O painel "Meteorologia" mostra, para um ponto e para D, D+1 e D+2, as linhas de previsão da matriz das condições meteorológicas do EB70-MC-10.336 (Quadro 4-5): previsão de tempo, precipitação, temperatura, ventos, umidade e visibilidade, mais nebulosidade e pressão num bloco recolhido. Esta página guarda o que não se lê no código: por que é o navegador que consulta a fonte, o que sai dele e o que não sai, qual modelo e por quê, e as regras de agregação que foram medidas contra a própria fonte.

O código mora em `frontend/src/js/utilities/meteorologia/`, e o `fileoverview` de cada arquivo carrega o detalhe. A entrada é o item "Meteorologia neste ponto" do menu de contexto, logo abaixo de "Luminosidade neste ponto" (`frontend/src/js/context-menu/context-menu.control.js`). O painel não escreve nada: nenhuma feição, nenhuma op de sync, nenhum calco, porque o item 4.3.3.2.3 do manual manda evitar calco próprio para elemento meteorológico, que muda em pouco tempo.

## Quem consulta a fonte é o navegador

Por decisão do dono em 2026-09-23 (arranjo C2 da proposta), a consulta sai do navegador de quem abre o painel, direto para uma API Open-Meteo, e o backend não faz chamada de saída nenhuma. O backend só publica duas coisas no `GET /api/config`: a bandeira `features.meteorologia` e a raiz da fonte em `services.meteorologiaUrl` (variável `METEOROLOGIA_URL`, padrão a API pública), as duas sobrescritas pelo administrador na aba Sistema.

**A bandeira nasce ligada, por decisão do dono, e o preço é de sigilo.** Cada consulta diz à fonte uma região de interesse e uma data, e o que foi enviado não se recolhe; com a fonte pública, que é o padrão, isso sai da rede. A primeira versão desta entrega nascia desligada, e o dono inverteu o padrão no mesmo dia, ao ver o painel. O administrador desliga na aba Sistema, e com a bandeira desligada o item do menu nem é desenhado (`meteorologiaDisponivel`, `frontend/src/js/utilities/meteorologia/carregador.js`), e uma raiz vazia tem o mesmo efeito. Apontar a raiz para um Open-Meteo instalado na rede é o que tira a consulta da mão de terceiros, e é troca de configuração, não de código.

**O que sai do navegador, medido em Chromium e Firefox por captura em 2026-09-23:** o ponto arredondado a 0,1° (cerca de 11 km), a janela de datas, o agente do navegador, o cabeçalho `Origin`, que o CORS exige e que diz à fonte o endereço do EBGeo (não o do atlas), e o endereço de saída da rede. Nenhum dos dois últimos some com opção de `fetch`, porque o modo `no-cors` devolve resposta opaca; o que os tira da mão de terceiros é a fonte instalada na rede. **O que não sai:** cabeçalho de autorização, cookie e Referer. As opções da chamada estão em `OPCOES_DA_REQUISICAO` (`frontend/src/js/utilities/meteorologia/fonte-meteorologica.js`), sem chave `headers`, com `credentials: 'omit'`, `referrerPolicy: 'no-referrer'` e `cache: 'no-store'`.

Duas armadilhas desse desenho, e as duas falhariam caladas:

- **O cliente HTTP da aplicação carimba o token, e a fonte aceitaria.** A política de CORS da Open-Meteo lista `authorization` entre os cabeçalhos aceitos, então uma chamada feita por `apiClient` levaria a credencial e responderia 200. A chamada é `fetch` puro, e `opcoesSemCredencial` é o predicado que o teste cobra em toda chamada e que ele prova recusar as opções do cliente da aplicação.
- **A coordenada não pode chegar a log nenhum.** Mensagem de console viaja como migalha com o relato de erro, então `FalhaDaFonte` nunca carrega a URL, e o evento de uso `meteorologia.aberta` não tem qualificador. Pela mesma razão o menu só oferece o painel com raiz http(s) completa (`raizDaFonteValida`): uma raiz sem esquema faria o `fetch` resolver contra a própria origem do EBGeo, e a coordenada cairia no log de acesso do nosso proxy.
- **Toda chamada tem tempo limite, e a rodada e a previsão partem juntas** (`TEMPO_LIMITE_PREVISAO_MS`, `TEMPO_LIMITE_RODADA_MS`). Numa rede que descarta pacote em vez de recusar, sem prazo o painel ficaria em "Consultando" até o tempo limite do TCP do sistema, e em série a espera dobraria. O teste que prende o paralelismo mede ORDEM (a previsão parte com a rodada pendente), e não relógio: um limite de tempo passaria também em série sempre que a previsão respondesse rápido.

## O modelo é fixo: GFS

A chamada pede `models=gfs_seamless`. Entre os quatro globais sondados em 2026-09-23 com uma coordenada fora do Brasil, foi o único que entregou as onze variáveis do painel nos 16 dias: o ECMWF IFS não traz visibilidade nem temperatura a 80 m, e o ICON para no dia 8. Fixar o modelo também deixa o carimbo honesto, porque o painel nomeia um modelo e uma rodada; a mistura "best match" escolhida pela fonte não permitiria isso. A rodada vem do arquivo de metadados do modelo na própria fonte (`montarUrlDaRodada`), que não recebe coordenada nenhuma; se ela falhar, o painel mostra a previsão e diz "rodada não informada".

A altitude do ponto **não** é enviada, o que desfaz a recomendação original da proposta (A14). A fonte corrige a temperatura pela altitude do ponto pedido com o modelo de terreno dela, então o número vale para a célula arredondada, e o carimbo imprime a altitude de referência que a resposta traz. Mandar a altitude lida do nosso MDE exigiria distinguir o zero de tile não carregado do zero do nível do mar, que o leitor de terreno não distingue.

## As regras de agregação, conferidas contra a fonte

Cada célula agrega a série horária sobre o dia civil de Brasília, com a mesma `hora-brasilia.js` da luminosidade (`frontend/src/js/utilities/hora-brasilia.js`). A série vem em UTC e o corte do dia é feito aqui: pedir à fonte o fuso de São Paulo mudaria sozinho se o horário de verão voltasse, e P é fixo.

O teste de caminho independente usa a mesma rodada pedida duas vezes, uma como série horária em UTC e outra como os agregados diários da própria fonte no fuso de Brasília (`frontend/tests/fixtures/open-meteo-2026/`). Máxima, mínima, soma, probabilidade, código de tempo, rajada, umidade, nebulosidade, pressão e visibilidade batem exatos ou no arredondamento da fonte. A direção do vento é a média vetorial **ponderada pela velocidade**, e ela bate com a direção dominante da fonte em até 1°. A média vetorial sem peso errou 28° no primeiro dia gravado, porque as horas de calmaria, com direção qualquer, pesam tanto quanto as de vento.

Chuva e rajada são valores da HORA ANTERIOR ao carimbo, então o dia de P cobre, fisicamente, das 23:00 da véspera às 23:00; é a mesma convenção dos agregados diários da própria fonte, e é por isso que o caminho independente fecha.

Os controles negativos foram rodados revertendo cada regra: cortar o dia em UTC derruba 9 casos, tirar o peso da direção derruba 5 e trocar `credentials: 'omit'` por `include` derruba 2.

**Ausência é nulo com motivo, e nunca zero.** "0 mm" é previsão de tempo seco; um campo só é calculado quando a fonte deu as 24 horas dele, senão a célula diz "sem dado". A coluna fora do alcance da previsão diz "sem previsão": o alcance vai de 90 dias atrás até 14 dias de P à frente da data UTC de hoje, porque a fonte responde 16 dias UTC e o último dia de P inteiro dentro deles é o 14º.

## A tela

O cartão, a folha do celular, o pino, o seletor de data e o download são a casca comum dos dois painéis de ponto (`frontend/src/js/utilities/painel-de-ponto/painel-de-ponto.js`), criada quando o dono separou luminosidade e meteorologia em telas distintas. **Um painel por mapa de cada vez:** os dois ocupam o mesmo lugar sob a barra de busca, e abrir um fecha o outro; por isso também o pino é um só, com id literal (`painel-ponto-pino`), que é o que deixa o censo de escrita crua (`frontend/tests/unit/despachante-sem-escrita-crua.test.js`) provar que o `setData` dele não escreve fonte do despachante. Enquanto a previsão viaja, a caixa de estado mostra um anel girando ao lado de "Consultando a previsão…", parado para quem pediu movimento reduzido.

A resposta da fonte é uma ida e volta de rede, e a pessoa pode trocar o dia ou o ponto enquanto ela viaja. Cada pedido leva um número, e resposta que chega depois de um pedido mais novo, ou com o painel fechado, é descartada. Na falha da fonte o painel mostra só o aviso "Previsão indisponível", com "Tentar de novo", e nenhuma tabela: uma tabela de "…" embaixo diria "ainda chegando" ao lado de um aviso que diz que não vai chegar.

No celular de 360 px as células da meteorologia quebram linha, e só elas: levam unidade e frase, enquanto as da luminosidade são horários curtos, e sem a quebra a coluna D+2 saía cortada (medido por captura). No Firefox, "E-SE 2,0 m/s" ainda quebra dentro de "m/s" nessa largura.

## O que falta e o que ficou de fora

- **O gradiente de temperatura** (inversão, neutralidade ou lapse, item 4.3.3.3.5 a) espera o limiar de "neutralidade" vir de um manual de fumígenos ou QBRN (decisão D4 da proposta).
- **O regime de clima** para dias fora do alcance da previsão ainda não existe: a coluna só diz "sem previsão".
- **O teto de nuvens** não vem do GFS, e a fonte que o traz (REDEMET) exige chave, que no navegador vazaria.
- **A visibilidade do GFS tem teto de cerca de 24 km**, e a célula diz "24 km ou mais". Modelo global de cerca de 13 km também não resolve neblina de vale e de costa, e o rodapé do painel diz isso.
- **A tabela de efeitos** do Quadro 4-5 continua julgamento de estado-maior.

## Ver também

- [[luminosidade-pitcic]], a outra metade da mesma matriz, com a mesma casca.
- [[observabilidade]], onde o evento de uso `meteorologia.aberta` é contado.
- [[peso-do-pacote-web]], o teto que mantém o módulo fora do boot.
