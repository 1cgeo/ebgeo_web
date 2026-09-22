# Viewshed 3D

O inventário do que a análise de visibilidade 3D FAZ, escrito para que ela possa ser reescrita: o contrato com o chamador, as decisões de desenho que parecem cosméticas e não são, e as armadilhas que só a medição entrega.

Esta página nasceu como o passo 2 da decisão D15 de 2026-09-15 ([`../decisions/decisions-2026.md`](../decisions/decisions-2026.md)), o inventário escrito para tornar a reescrita possível. **A reescrita ACONTECEU no mesmo dia**, e o motor é [`../../frontend/src/js/3d_models_viewer_tool/services/viewshed-3d.js`](../../frontend/src/js/3d_models_viewer_tool/services/viewshed-3d.js): o vendor ofuscado foi apagado, e com ele os três remendos de compatibilidade que só existiam para ele. A página segue descrevendo **o que** a peça faz, que é o que sobreviveu à troca; o cabeçalho daquele arquivo é quem conta **como**, e a declaração de segurança do arquivo substituído e o aceite da troca vivem em o aceite da reescrita (seis itens, cumpridos em 2026-09-15 e absorvidos por esta página; o documento foi apagado).

## O que a peça é, em uma frase

Um objeto por setor de visão que, dado um observador, um alvo, uma abertura horizontal, uma abertura vertical e um alcance, **tinge a cena inteira** de verde onde o observador enxerga e de vermelho onde não enxerga, e desenha o tronco da visão em fio de arame.

A tintura não é geometria: é um **pós-processamento de tela cheia**. Ele lê a cor e a profundidade do quadro já renderizado, reconstrói a posição de cada pixel, e decide a cor consultando um mapa de sombras cuja câmera está no olho do observador. Quem consome é [`frontend/src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js`](../../frontend/src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js), dentro do visualizador Cesium de modelos 3D.

## O contrato com o chamador, que é o que não pode mudar

Dois modos de construção, e o chamador usa os dois:

- **Dirigido**: recebe `cameraPosition` e `viewPosition` prontos e se desenha na hora. É o caminho de `createCesiumViewsheds`, usado no boot do visualizador e a cada edição de parâmetro.
- **Interativo**: recebe só os parâmetros, prende um manipulador de mouse, e se completa em dois cliques (o primeiro fixa o observador, o segundo o alvo). Entre os dois cliques, mover o mouse atualiza a distância corrente **e desenha o preview do setor**: a mesma malha que a análise vai desenhar, uma linha de mira até o ponteiro e o alcance escrito ao lado dela, que saem da cena no segundo clique antes de o setor de verdade entrar. Ao completar, chama a função de retorno.

**Esta linha dizia só a primeira metade, e foi assim que o preview se perdeu na reescrita de 2026-09-15.** No vendor ele não era código de preview, era efeito colateral: o manipulador de movimento atribuía a distância por um acessor de escrita que tirava e repunha o sensor retangular, e o inventário registrou a atribuição e não o efeito. A reescrita manteve a atribuição, gravando direto no campo, e o setor parou de acompanhar o ponteiro sem erro nenhum; o dono deu pela falta em 2026-09-22. Duas escolhas do preview que não se adivinham: ele é só malha (sem mapa de sombras e sem pós-processamento, que são o custo inteiro de um viewshed), com o movimento coalescido a uma busca por quadro; e o ápice fica na altura do olho com que a ferramenta reconstrói a análise (`previewEyeHeight`), enquanto o alcance é medido do ponto CLICADO, porque é assim que a análise reconstruída o recebe. A aritmética mora em [`../../frontend/src/js/3d_models_viewer_tool/services/viewshed-preview.js`](../../frontend/src/js/3d_models_viewer_tool/services/viewshed-preview.js), presa por [`../../frontend/tests/unit/viewshed-3d-preview.test.js`](../../frontend/tests/unit/viewshed-3d-preview.test.js); o gesto no navegador, pelos dois casos de preview de [`../../frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js`](../../frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js).

**A opção de retorno se escreve `calback`, com um L.** O erro de digitação é do vendor e virou contrato: `activateViewshedTool` a passa com essa grafia. Quem reescrever e corrigir a ortografia sem tocar no chamador entrega um modo interativo que nunca completa, sem erro em lugar nenhum.

**Os campos que o chamador LÊ de volta** depois do clique interativo são `cameraPosition`, `viewPosition`, `heading`, `pitch`, `horizontalAngle`, `verticalAngle` e `distance`. Os três últimos são lidos com `|| DEFAULT_VIEWSHED_PARAMS.x`, então devolver `0` num deles cai no padrão em vez de no valor pedido. O chamador também carimba uma propriedade própria (`_wasSaved`) no objeto, então ou a classe aceita propriedade arbitrária, ou o chamador muda no mesmo commit.

**O ciclo de vida**: `destroy()` precisa ser chamável mais de uma vez sem derrubar a tela (o chamador já envolve em `try`), e `isDestroyed()` precisa existir. Até 2026-09-15 os dois eram INJETADOS de fora, por um remendo que existia só porque o vendor não os tinha e o Cesium 1.138 passou a chamar `isDestroyed()` em toda primitiva adicionada. A classe da casa os implementa, e o remendo saiu junto com o arquivo que o exigia: é essa saída que mede o ganho. Uma armadilha que a implementação carrega por escrito: ela **não** usa `destroyObject` do Cesium, porque aquele ajudante troca todo método por um que lança, e a segunda chamada a `destroy()` passaria a explodir exatamente onde o contrato pede silêncio.

## As sete coisas que o objeto faz quando se desenha

1. **Calcula a orientação do tronco** a partir do observador e do alvo, como um quaternion.
2. **Monta uma câmera de luz** no observador, olhando para o alvo, com "para cima" igual à normal geocêntrica no observador (não a normal do elipsoide, e não o "para cima" da câmera da cena).
3. **Recalcula a distância** como a distância real entre observador e alvo, arredondada a uma casa decimal, e **sobrescreve com ela o alcance pedido**. Isso é fácil de perder numa reescrita: o alcance que o chamador passou é substituído no modo dirigido também, porque o alvo é justamente o ponto a `distance` metros de distância que `createCesiumViewsheds` calculou.
4. **Cria o mapa de sombras** com essa câmera, fora da iluminação da cena (ele não pode escurecer nada), sem cascatas, sem filtro suave e sem desvio de normal.
5. **Registra um estágio de pós-processamento** com o shader de tintura e as uniformes que ele precisa.
6. **Desenha o tronco de visão** como um sensor retangular preso ao observador, com raio igual ao alcance, meio ângulo horizontal e meio ângulo vertical, superfícies laterais e domo DESLIGADAS: o que fica na tela é só o fio de arame.
7. **Entra na coleção de primitivas da cena**, e é isso que faz o motor chamar seu `update` a cada quadro. A única coisa que esse `update` faz é oferecer o mapa de sombras ao quadro, para que ele seja renderizado.

Trocar os parâmetros depois (abertura horizontal, abertura vertical, alcance) redesenha o tronco, e só ele: a tintura acompanha sozinha, porque as uniformes são lidas por função a cada quadro.

## O shader, contado pelo que ele RECUSA

A ordem das recusas é a especificação, e cada uma delas é uma saída antecipada que devolve a cor original:

1. profundidade de céu (nada foi desenhado ali);
2. pixel fora do tronco do mapa de sombras;
3. pixel a mais de `distance` metros do observador, medido em coordenadas de mundo;
4. pixel cujo **azimute** em relação à direção de visada excede metade da abertura horizontal;
5. pixel cuja **elevação** em relação à mesma direção excede metade da abertura vertical.

Sobrevivendo às cinco, o pixel é comparado com o mapa de sombras por um filtro 3x3, e a regra é **tudo ou nada**: visibilidade 1,0 (as nove amostras concordam que o pixel está visível) pinta de verde; qualquer outra coisa pinta de vermelho. Não há meio-tom, e é por isso que a borda das sombras é dura.

### A comparação é ESTRITA, e desde 2026-09-16 ela é a política inteira da costura

Os testes de abertura (4 e 5) usam `>` e não `>=`, então **o pixel exatamente na costura passa nos dois sub-viewsheds vizinhos e recebe a mistura duas vezes**. Um setor acima de 150 graus é dividido em dois ou três (`subViewshedLayout`), e era o mesmo cálculo que compensava isso, reduzindo a abertura de render de cada pedaço em `SEAM_NARROWING_DEGREES`. **A folga é ZERO desde 2026-09-16**: foi 1,5 grau até 2026-09-15 e 0,1 entre as duas datas. A medição que a zerou está na seção de revisão de 2026-09-16, no fim desta página.

O par continua sendo um par, e o que ele decide é qual dos dois defeitos você prefere no conjunto degenerado (o pixel cujo ângulo calculado cai exatamente na fronteira): com `>` ele é pintado DUAS vezes, com `>=` não é pintado NENHUMA. Os dois são conjuntos de medida zero, mas não se leem igual: uma tinta um pouco mais escura desaparece na imagem, um pixel de chão cru no meio do verde não. É por isso que a escolha é `>` com folga zero, e não `>=` com folga zero. Quem trocar o operador troca o defeito residual de lado e tem de dizer isso no mesmo commit. As duas moram uma ao lado da outra: a aritmética está em [`../../frontend/src/js/3d_models_viewer_tool/services/viewshed-geometry.js`](../../frontend/src/js/3d_models_viewer_tool/services/viewshed-geometry.js), um folha de zero imports, e o cabeçalho da constante carrega a tabela medida.

**E o efeito colateral que ninguém pediu morreu junto com a folga:** cada pedaço era estreitado INTEIRO e renderizado centrado no seu deslocamento, ou seja, encolhia meia folga de cada lado, e nas duas bordas EXTERNAS do setor sobrava um recuo de meia folga. Um setor de 240 graus desenhava 237 com a folga de 1,5 e 239,8 com a de 0,1; hoje ele desenha 240.

### O ramo que não escreve cor

Há um caminho, dentro do ramo de pixel oculto, que retorna **sem atribuir cor nenhuma**: quando a profundidade do pixel em espaço de sombra está a menos de 0,01 do plano próximo. Não é um acidente inofensivo, é comportamento indefinido de fragmento, e uma reescrita que escreva a cor original nesse ponto está corrigindo um defeito, não reproduzindo o desenho. Vale declarar a escolha.

## Duas propriedades do motor que só a medição entrega

Ambas foram medidas em 2026-09-15 nesta árvore, com o spec de pixel, e estão no cabeçalho dele ([`../../frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js`](../../frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js)):

- **O GLOBO NUNCA É TINGIDO, e as primitivas sobre ele são.** Com o terreno servindo de chão, o leque não pinta um pixel, em distância nenhuma, enquanto um bloco a quarenta metros recebe verde na face e vermelho no topo. A ferramenta vive dentro do visualizador de modelos, onde o chão é um tileset, e tileset é tingido como qualquer primitiva; mas quem for medir sobre o globo vai medir o caso que o produto não usa e concluir que o motor não funciona.
- **Só quem CASTA entra na conta.** Uma primitiva nasce `ShadowMode.DISABLED` (um `Cesium3DTileset` nasce `ENABLED`), e uma primitiva que não casta é invisível para o mapa de sombras: a cena inteira sai verde. Isso vale para quem monta cena de teste, e vale para quem um dia oferecer "ignorar esta camada na análise".

## O que NÃO precisa ser reproduzido

Metade do arquivo do vendor era um sensor retangular genérico com pintura Phong, plano de varredura animado, superfícies laterais e de domo, cor de interseção com o elipsoide e material configurável. **O viewshed usava uma fatia estreita disso**: o fio de arame, com raio e dois meios ângulos, com as superfícies e a varredura desligadas. Ele não tinha outro consumidor, e o aceite declarou que não precisava ser portado.

O que a reescrita desenha no lugar é um **setor esférico** em polilinhas, e a escolha da esfera não é estética: o corte do shader é por DISTÂNCIA constante ao observador, então a fronteira distante é uma esfera, e um tronco de pirâmide desenharia um plano que a análise não tem. Duas consequências medidas: a tesselação é mais grossa que a do sensor (9042 pixels de fio de arame contra 13823), e as linhas são **translúcidas de propósito**, porque uma polilinha opaca escreve profundidade e o próprio pós-processamento a pinta de verde ou vermelho, fazendo a anotação mentir sobre o que o observador enxerga.

## Como saber se a reescrita reproduziu o desenho

A prova é visual, e ela existe desde 2026-09-15: [`../../frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js`](../../frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js), com a referência versionada ao lado. Ele mede em quatro camadas (pixels diferentes da referência, proporção de verde, proporção de vermelho, presença do fio de arame) mais o painel do produto. Antes dele, os únicos testes que citavam viewshed mediam a ENTIDADE viajando pelo sync, e nenhum construía o objeto.

**A troca de 2026-09-15 foi medida com ele, e o número que importa é o da CLASSE.** Entre a imagem do vendor e a do motor da casa, 5,307% dos pixels mudaram, mas só 2,651% mudaram de classificação (visível, oculto ou nenhum dos dois): a maior parte do movimento de pixel é o fio de arame trocando de tesselação, e não a análise. Verde e vermelho ficaram em 15,379% e 6,776% do quadro, contra 15,192% e 6,943% do vendor, dentro das mesmas faixas declaradas, que não precisaram mudar.

**A referência foi regerada DE NOVO no mesmo dia, pela revisão, e desta vez as faixas mudaram**, porque o que mudou foi a resposta: verde e vermelho foram para 17,331% e 4,824%, com a área tingida TOTAL praticamente intacta (195072 contra 195248 pixels). Vermelho falso virou verde; o setor não mudou de tamanho. O porquê está na seção seguinte.

**O gesto interativo também passou a ser medido no mesmo arquivo**, e ele é o caso que mais precisava: dois cliques reais no canvas, e a asserção de que o viewshed nasceu na loja com 1,5 m de altura de observador e com a distância RECALCULADA dos dois pontos. É o único teste que prova a grafia de `calback`, e o controle negativo é direto: trocar o nome da opção para a grafia correta, num lado só, reprova com a mensagem que nomeia o suspeito.

**A costura entre sub-viewsheds passou a ser coberta na revisão de 2026-09-15**, e a resposta da leitura de imagem que o aceite pedia é: **fresta, não faixa saturada**. O mesmo arquivo tem um caso de 180 graus que exige DOIS estágios de pós-processamento (sem eles não há corte nenhum) e procura, numa faixa de colunas em volta da emenda, a maior corrida de chão CRU, isto é, chão dentro do setor que nenhum pedaço analisou. **Aquele caso mede num enquadramento LARGO, e por isso ele respondeu "0 px" sobre uma fresta que existia**; desde 2026-09-16 há mais dois casos, com a câmera aproximada e referência própria, e é a seção seguinte que conta o que eles acharam.

**E um quarto caso que não olha pixel nenhum**, porque o defeito que ele prende era invisível na imagem de referência: ele sobe o visualizador numa janela mais alta que larga e cobra as duas aberturas EFETIVAS do tronco do observador. Ver a seção seguinte.

## Revisao de 2026-09-15: parametros, desempenho e comparacao com o vendor

A reescrita foi revista no mesmo dia em que nasceu, em tres eixos: cada parametro exercitado com dois valores e a imagem lida, o desempenho medido, e o codigo lido com olhos de revisor. A comparacao e contra o motor substituido, montado num worktree descartavel em `d53a0d27~1` e dirigido pelo MESMO spec, na mesma cena, no mesmo enquadramento fixo (canvas 1224x720). A coluna "casa" e o estado DEPOIS dos quatro consertos que a revisao produziu.

**Quatro defeitos sairam daqui, e tres deles eram invisiveis para a suite que existia**, porque ela media um unico viewshed de 120 graus numa janela deitada, que e exatamente o recorte onde os quatro nao aparecem.

### Os parametros, um a um

Onde a medida e "verde/vermelho", sao pixels do quadro de 881280. A interface expoe so TRES destes (Campo Horizontal, Distancia e Altura do Observador, em [`../../frontend/src/js/3d_models_viewer_tool/components/viewshed-panel-3d.js`](../../frontend/src/js/3d_models_viewer_tool/components/viewshed-panel-3d.js)); o resto e contrato de construtor, e a coluna do vendor existe para separar conserto de regressao.

| parametro | valores | como se mede | casa | vendor | veredicto |
|---|---|---|---|---|---|
| `horizontalAngle` | 60 / 120 / 150 | largura do tingido, px | 462 / 910 / 1112 | 461 / 907 / 1111 | efeito confirmado, e igual nos dois |
| `horizontalAngle` acima de 150 | 180 / 320 / 360 | estagios de pos-processamento | 2 / 3 / 3 | 2 / 3 / 3 | **quebrado na casa ate esta revisao**: zero estagios, nada desenhado |
| `distance` | 100 / 200 | caixa do tingido | 534x288 / 964x399 | 534x288 / 964x399 | raio dobra |
| `distance` zero | 0 | contagem | cai no padrao de 500 do chamador | idem | o ou-logico de `createCesiumViewsheds` engole o zero |
| `distance` negativa | -186 | caixa do tingido | leque ao SUL, y 594 a 719 | idem | a direcao inverte; inalcancavel pela interface, cujo minimo e 10 |
| `observerHeight` | 1,5 / 10 / 40 | oculto | 42514 / 42298 / 22325 | 61189 / 43302 / 22229 | mais alto oculta menos, nos dois |
| `verticalAngle` | 30 / 90 / 120 | oculto | 40026 / 42514 / 42514 | 58037 / 61189 / 61189 | 90 e 120 dao o MESMO nos dois: abaixo de 1,5 m do observador nao ha chao a mais para cortar |
| `verticalAngle` acima do horizontal | 170 | visivel / oculto | 110155 / 85105 | 113215 / 82087 | degrada nos dois: `observerFovDegrees` leva o tronco a `MAX_FRUSTUM_FOV_DEGREES` e a densidade de texel desaba |
| rumo, pelo alvo | 0 / 90 / 270 graus | faixa de colunas | 381 a 842 / 603 a 1223 / 0 a 620 | identica | o leque gira |
| `visibleAreaColor` e `hiddenAreaColor` | padrao / azul e amarelo | contagem por cor | 153216 azuis e 42418 amarelos | 134278 e 61148 | troca exata, sem sobra na cor antiga |
| `alpha` | 0,2 / 0,9 | pixels de tinta saturada | 2520 / 153216 | 637 / 134278 | confirmado |
| `calback`, com um L | ativar a ferramenta | gesto de dois cliques | completa | completa | contrato mantido |
| `_wasSaved` | carimbo do chamador | aceitacao | aceita a propriedade | aceita | |
| `destroy` duas vezes | segunda chamada | excecao | silencioso | **lanca**, lendo `scene` de indefinido | o contrato pede silencio |
| `destroy`, 10 ciclos | criar e destruir | primitivas na cena | 5, 5, ..., 5 | 7, 8, ..., 16 | o vendor **vazava uma primitiva por ciclo**, para sempre |
| dois viewsheds, apagar um | criar e apagar | estagios | 2, depois 1, depois 0 | 2, 1, 0 | na casa so depois do conserto |
| F5 com viewshed salvo | recarregar | verde antes e depois | 152734 / 152734 | 133883 / 133883 | reconstroi da loja |
| observador DENTRO de um bloco | 10 m num bloco de 22 | verde / oculto | 121510 / 25915 | 120885 / 26220 | ele **enxerga atraves do proprio bloco**, nos dois: a face de tras nao casta |
| viewshed so sobre o globo | sem primitiva nenhuma | verde | 0 | 0 | o globo nunca e tingido, como esta pagina ja dizia |
| costura entre sub-viewsheds | 155 / 180 / 240 / 320 / 360 | maior corrida de chao cru, vista LARGA | 0 px | 6 a 9 px | ver abaixo, e a secao de 2026-09-16 |

**A costura, que o aceite mandava ler na imagem: e FRESTA, nao faixa saturada.** Com a folga de 1,5 grau, a emenda mostrava uma tira de chao CRU de 6 a 9 pixels nesta cena, ladeada pelos dois fios de arame, bem na direcao de visada. A folga de 0,1 grau fechava a tira NESTE ENQUADRAMENTO, e e so isso que esta linha podia dizer: a secao seguinte mostra que ela nao a fechava na tela, e explica por que um "0 px" medido a 0,42 m por pixel nao responde por uma cunha de 0,32 m.

### Desempenho

O instrumento serializa cada quadro (um render seguido da leitura de um pixel, que espera a GPU), entao os numeros NAO sao quadros por segundo do produto: sao a mesma regua aplicada aos dois motores, com a camera girando entre quadros. 150 quadros por linha, depois de 30 de aquecimento.

| medida | casa | vendor | diferenca |
|---|---|---|---|
| construcao, 60 / 120 / 240 / 360 graus (ms, mediana) | 0,6 / 0,5 / 0,6 / 0,6 | 0,4 / 0,4 / 0,4 / 0,4 | sub-milissegundo nos dois |
| do pedido a primeira frame (ms, mediana) | 44,4 / 47,1 / 54,4 / 65,5 | 43,6 / 46,4 / 56,4 / 71,2 | empate, dominado por compilacao de shader |
| quadro sem viewshed (ms, media / p95) | 22,34 / 25,9 | 22,97 / 26,7 | linha de base |
| quadro com 1 viewshed | 31,23 / 34,5 | 31,70 / 35,9 | casa 1,5% mais rapida |
| quadro com 2 | 38,28 / 42,3 | 38,74 / 42,9 | casa 1,2% mais rapida |
| quadro com 4 | 50,57 / 55,2 | 50,35 / 54,1 | casa 0,4% mais lenta |
| custo de `destroy` (ms, mediana) | 0,1 | 0,0 | o do vendor nao removia a si mesmo da cena |
| primitiva vazada por ciclo de vida | 0 | 1 | |
| mapa de sombras | 2048 por 2048, uma passada, textura de profundidade, luz de holofote, sem cascata | identico | **nao e configuravel em nenhum dos dois** |

Ou seja, **nenhuma medida da casa e mais que 20% pior**, e o custo por viewshed ativo e de 6 a 9 ms de quadro nos dois motores, quase tudo no pos-processamento de tela cheia (a diferenca entre zero e um viewshed e maior que entre um e dois). Quem precisar de muitos viewsheds simultaneos ataca isso, e nao o shader: sao N passadas de tela cheia sobre o quadro inteiro, uma por setor, e nada as funde.

### O que a leitura do codigo encontrou, alem dos quatro consertos

- **`update` nao aloca nada** e as uniformes usam rascunhos de modulo, um por eixo. O motivo de serem quatro rascunhos e nao um esta escrito naquele arquivo e nao e estilo.
- **A matriz de sombra e recomposta a cada quadro**, e precisa ser: dois fatores dependem da camera da cena. As uniformes constantes tambem sao funcoes, o que custa uma chamada por quadro cada e nada mais.
- **O `multiply` de `Matrix4` do Cesium copia os dois operandos antes de escrever**, entao os tres produtos encadeados no mesmo rascunho sao seguros. Conferido no fonte instalado.
- **Os acessores de escrita de `horizontalAngle`, `verticalAngle` e `distance` redesenham so a malha**, e nao refazem a camera do observador nem o mapa de sombras. Trocar a abertura por eles deixa o tronco de profundidade parado no valor antigo. Hoje isso e latente, porque `createCesiumViewsheds` sempre reconstroi; vira defeito no dia em que alguem ligar um controle direto a eles.
- **A superficie privada continua em tres pontos**, e o teste que a prende nao mudou.

### O que continua aberto, declarado

- **A abertura vertical acima de 170 graus nao existe**, por `MAX_FRUSTUM_FOV_DEGREES`: um tronco perspectivo degenera perto de 180. Perto do teto, a densidade de texel ja cai o bastante para a resposta piorar, que e a linha de 170 na tabela. Um setor vertical realmente grande precisaria de outra coisa que nao um unico mapa de sombras perspectivo.
- **Um observador dentro de um obstaculo enxerga atraves dele**, porque a face de tras nao casta sombra. E consequencia do estado de render de sombra do Cesium, igual nos dois motores, e para o produto ela e mais util que o contrario: um observador colocado no telhado com deslocamento de altura acaba dentro do predio e mesmo assim responde.
- **O tamanho do mapa de sombras e uma constante**, nao uma opcao. Aumenta-lo e o caminho obvio para a acne residual muito perto do observador, e custa memoria por viewshed vivo.

## Revisao de 2026-09-16: a costura, lida de perto

A revisao anterior deixou escrito que a costura acima de 150 graus **nao tinha prova visual automatizada**. Ela tem agora, e o que a prova achou contradiz a conclusao que aquela linha registrava.

### O que a imagem mostrou, aproximacao por aproximacao

Foram geradas duas vistas para cada uma de oito aberturas (151, 155, 180, 240, 300, 301, 320 e 360), sempre com o setor girado para que a emenda apontasse para o NORTE e a camera olhando o norte, de modo que a costura caisse na coluna central do quadro. A cena e a do spec de pixel mais um muro de 34 m por 6 m e 7 m de altura posto EM CIMA da emenda, a 115 m: sem obstaculo atravessando a costura nao se ve se a sombra atravessa junto.

- **Vista LARGA** (a mesma dos primeiros casos do spec, cerca de 0,42 m por pixel): nenhuma fresta, nenhuma faixa saturada, nenhum degrau de cor. Verde e vermelho sao identicos dos dois lados da emenda, pixel a pixel (64,192,68 dos dois lados no chao, e a mesma cor a 40 px de distancia). O arco de distancia atravessa a costura sem descontinuidade. As oito aberturas deram a mesma coisa: 0 px de chao cru, e 1 px em 360 graus.
- **Vista APROXIMADA** (camera 60 m ao norte do observador, 30 m de altura, 22 graus para baixo, cerca de 0,046 m por pixel): **uma fresta continua de 3 a 4 px em TODAS as oito aberturas.** Ela sobe do pe do observador ate o corte de distancia, atravessa a face do muro e **corta a sombra dele em duas**. Nas duas de dois pedacos a coluna central ficava com ZERO pixels vermelhos dentro da faixa da sombra, enquanto as colunas a 2 px de distancia tinham 131 de 141.

Ou seja: a cunha cega de 0,1 grau nao tinha sumido, tinha ficado **sub-pixel no enquadramento em que foi medida**. A 186 m ela mede 0,32 m, e o pixel daquela vista vale 0,42 m. O numero "0 px" estava certo; a conclusao que se tirou dele, nao. Esta e a forma mais cara de verificacao fantasma que este trabalho ja produziu, porque ela nao era um teste que nao rodava: era um teste que rodava, media a coisa certa e respondia sobre uma escala em que o defeito nao cabia.

### A comparacao com o motor substituido, nas mesmas cenas

Worktree descartavel em `d53a0d27~1`, dirigido pelo mesmo spec, mesma cena, mesmos enquadramentos:

| medida | casa (folga 0,1) | vendor (folga 1,5) |
|---|---|---|
| fresta, vista larga, 180 graus | 0 px | 9 px |
| fresta, vista larga, 240 graus | 0 px | 1 px, e o motivo esta abaixo |
| fresta, vista aproximada, 180 e 240 graus | 4 px | **60 px** |
| verdes na faixa da emenda (vista aproximada) | 45 de 65 | **ZERO** |

O 1 px do vendor em 240 graus e o achado que vale guardar: naquela vista a acne de sombra dele (o vies de 2e-5 que esta arvore corrigiu em 2026-09-15) cobre o chao inteiro de listras vermelhas, e listra vermelha **interrompe a corrida de chao cru**, entao a propria regua media menos fresta onde havia mais defeito. Um defeito mascarando o outro na mesma imagem.

O veredicto e o mesmo para os dois motores, com quinze vezes de diferenca no tamanho: **os dois abrem uma cunha cega na emenda, e a do vendor e grosseira**. Nada no desenho da casa esta errado em relacao ao que foi substituido; o que estava errado era a folga, nos dois.

### O conserto, parte 1: a folga e ZERO

`SEAM_NARROWING_DEGREES` passou a ser zero. Os pedacos vizinhos passam a ENCOSTAR, e o `>` estrito do shader pinta duas vezes o conjunto degenerado, que tem medida zero: no setor de 320 graus sobram 170 pixels de mistura dupla espalhados por tres colunas de 720 linhas, e no de 180, nenhum.

Isso fechou a fresta no CHAO e na SOMBRA, e nao fechou a emenda. O que faltava esta na secao seguinte, e quem o achou foi a leitura das referencias recem-geradas, pixel a pixel, depois de as reguas terem passado verde.

### O conserto, parte 2: os dois pedacos mediam azimute em torno de eixos DIFERENTES

Com a folga em zero, as duas referencias novas ainda traziam **uma fenda de 2 px de largura por 16 px de altura (setor de 180, linhas 347 a 362) e 25 px (setor de 320, linhas 339 a 363)**: exatamente sobre a emenda, na face de CIMA do muro e na borda alta da face frontal, visivel a olho como um traco branco no topo do muro.

**O mecanismo, medido.** O shader mede o azimute do fragmento em torno de um eixo "para cima" que era o da camera de CADA pedaco. `Camera` mantem os tres eixos ortonormais, entao ele INCLINA o "para cima" contra a direcao de cada pedaco, e dois pedacos que olham para direcoes diferentes recebem eixos diferentes: medidos **0,517 grau** entre eles no setor de 180 e **0,611** no de 320, com apenas 0,46 grau de inclinacao da visada (o alvo esta no chao e o olho 1,5 m acima dele, a 186 m). Medir azimute em torno de eixos diferentes faz os dois pedacos discordarem sobre ONDE esta a fronteira, e a discordancia e proporcional a TANGENTE da elevacao do fragmento. E isso que a tabela anterior desta pagina nao previu: ela foi medida so' em pontos do CHAO, e no chao o sinal e o outro.

| elevacao do fragmento (a 115 m) | antes: 180 / 320 | depois: 180 / 320 |
|---|---|---|
| chao, -0,75 grau | -0,006 / -0,007 | -0,0014 / -0,0016 |
| altura do olho, 0 grau | +0,001 / +0,001 | -0,0014 / -0,0016 |
| topo do muro, +2,74 graus | **+0,026 / +0,030** | -0,0014 / -0,0016 |
| +11 m, +5,46 graus | +0,050 / +0,059 | -0,0014 / -0,0016 |
| +20 m, +9,87 graus | +0,091 / +0,107 | -0,0014 / -0,0016 |

Negativo e SOBREPOSICAO, que e o desfecho invisivel; positivo e fresta. O sinal trocava exatamente no horizonte do observador. Os +0,026 grau do topo do muro sao 5,2 cm de mundo a 115 m, cerca de um pixel naquele enquadramento, e a rasterizacao os pinta em duas colunas.

**Nenhuma folga consertaria isso, e e por isso que a resposta nao foi um numero negativo pequeno:** o erro e proporcional a `tan(elevacao)` e uma folga e constante. Fecha-la no topo do muro abriria sobreposicao mensuravel no chao, e um obstaculo mais alto reabriria a fresta de qualquer jeito (a 45 graus de elevacao ela mede meio grau, que a 1 km sao 9 m de chao sem resposta).

**O conserto e medir em torno do MESMO eixo.** A vertical local no observador e a mesma conta para todos os pedacos, entao ela passou a ser guardada antes de o Cesium ortogonalizar e e ela que vai ao shader; e a funcao de angulo passou a projetar TAMBEM o eixo de referencia, sem o que ela devolve `acos(cos(azimute) * cos(inclinacao))` em vez do azimute (o que sozinho ja abria 0,001 grau de fresta com 0,46 grau de inclinacao, e passaria de 9 graus com um observador 40 m acima do alvo a 100 m). Com os dois, a divergencia entre os pedacos ficou CONSTANTE em elevacao e em distancia, na coluna da direita da tabela; o que sobra dela vem de a rotacao dos pedacos ser em torno da normal do ELIPSOIDE enquanto o azimute e medido em torno da GEOCENTRICA, que nesta latitude diferem 0,14 grau: efeito de segunda ordem, 0,0015 grau, 3 mm de chao a 115 m e 1,3 cm a 500 m, sempre com o sinal da sobreposicao.

O custo no desenho foi medido nas tres referencias: 10 pixels de 881280 na de 120 graus (0,001%), 32 na de 180 e 50 na de 320. Os 32 e os 50 sao exatamente 2x16 e 2x25, isto e, a fenda e nada mais.

**O que continua sem regua, declarado:** a MALHA do tronco e desenhada no referencial da camera do observador, enquanto a tinta passou a medir azimute em torno da vertical local. As duas coincidem com visada horizontal e divergem com o QUADRADO da inclinacao (0,002 grau nesta cena, 4 graus para um observador 40 m acima do alvo a 100 m). A tinta e a resposta; a malha e anotacao.

### Como isso se mede hoje

Dois casos novos em [`../../frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js`](../../frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js), um de dois pedacos (180 graus) e um de tres (320; **300 ainda sao dois**, porque `subViewshedLayout` corta em dois ate `MAX_SINGLE_VIEWSHED_ANGLE` vezes dois INCLUSIVE), cada um com referencia versionada propria na vista aproximada. Quatro reguas, e cada uma com o controle negativo executado:

| regua | o que ela ve se a costura estiver errada | controle negativo |
|---|---|---|
| fresta, na coluna da emenda INTEIRA (chao, muro e sombra) | corrida continua de pixels sem tinta, com a linha em que ela esta | eixo de azimute por pedaco reprova com 2 px em y=347 e y=339; folga 0,1 com 4 px; folga 1,5 com 64 px |
| faixa saturada (mediana do canal oposto na emenda contra o mesmo chao a mais de 5 graus) | 31 contra 62, metade | folga -1,5 reprova, mediana 31 |
| sombra continua (vermelho descendo a coluna da emenda) | coluna sem vermelho, ou vermelho interrompido | folga 0,1 deixa a coluna central com 0 de 141 |
| pixel e classe contra referencia | qualquer mudanca de desenho | a referencia e regerada por `EBGEO_VIEWSHED_REFERENCIA=1` |

**Cada regua vem precedida da guarda que a impede de ser vazia**, e uma delas foi paga em vermelho durante esta propria revisao: a regua da sombra, escrita sem contagem por coluna, reportava buraco ZERO justamente no caso em que a fresta tinha comido a coluna inteira, porque uma coluna sem nenhum vermelho nunca abre uma corrida. A guarda tambem nao pode ser sensivel ao defeito que protege: medida no meio da janela varrida, ela caia junto com a fresta e passava a gritar "nao ha tinta" sobre uma imagem cheia de tinta. Ela mede as duas BORDAS da janela.

**E MESMO ASSIM AS REGUAS DEIXARAM PASSAR A FENDA DO MURO, por duas razoes que valem mais que ela.** A primeira e de JANELA: a varredura eram duas faixas, o chao (linhas 470 a 710) e a sombra (190 a 330), e o muro mora nas linhas 339 a 455, ou seja, no vao entre elas. Media-se dos dois lados do defeito sem tocar nele. A segunda e de CLASSIFICADOR: a face de cima do muro sem tinta e (211, 205, 193), e o piso de branco de 190 a chamava de FIO DE ARAME, que e justamente o que a regua trata como anotacao desenhada por cima e usa para ZERAR a corrida de chao cru. Uma fenda de 16 px sobre aquela face era lida como zero. Hoje a varredura e uma faixa unica, do arco de distancia ate a borda de baixo do quadro, e o piso do branco e 235.

## Ver também

- [[acervo-3d-convertido]] - o acervo que serve os modelos sobre os quais esta análise roda.
- [[inventario-de-vendors]] - o estado declarado do arquivo que esta reescrita substitui.
