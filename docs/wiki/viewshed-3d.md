# Viewshed 3D

O inventário do que a análise de visibilidade 3D FAZ, escrito para que ela possa ser reescrita: o contrato com o chamador, as decisões de desenho que parecem cosméticas e não são, e as armadilhas que só a medição entrega.

Esta página nasceu como o passo 2 da decisão D15 de 2026-09-15 ([`../decisions/decisions-2026.md`](../decisions/decisions-2026.md)), o inventário escrito para tornar a reescrita possível. **A reescrita ACONTECEU no mesmo dia**, e o motor é [`../../frontend/src/js/3d_models_viewer_tool/services/viewshed-3d.js`](../../frontend/src/js/3d_models_viewer_tool/services/viewshed-3d.js): o vendor ofuscado foi apagado, e com ele os três remendos de compatibilidade que só existiam para ele. A página segue descrevendo **o que** a peça faz, que é o que sobreviveu à troca; o cabeçalho daquele arquivo é quem conta **como**, e a declaração de segurança do arquivo substituído e o aceite da troca vivem em o aceite da reescrita (seis itens, cumpridos em 2026-09-15 e absorvidos por esta página; o documento foi apagado).

## O que a peça é, em uma frase

Um objeto por setor de visão que, dado um observador, um alvo, uma abertura horizontal, uma abertura vertical e um alcance, **tinge a cena inteira** de verde onde o observador enxerga e de vermelho onde não enxerga, e desenha o tronco da visão em fio de arame.

A tintura não é geometria: é um **pós-processamento de tela cheia**. Ele lê a cor e a profundidade do quadro já renderizado, reconstrói a posição de cada pixel, e decide a cor consultando um mapa de sombras cuja câmera está no olho do observador. Quem consome é [`frontend/src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js`](../../frontend/src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js), dentro do visualizador Cesium de modelos 3D.

## O contrato com o chamador, que é o que não pode mudar

Dois modos de construção, e o chamador usa os dois:

- **Dirigido**: recebe `cameraPosition` e `viewPosition` prontos e se desenha na hora. É o caminho de `createCesiumViewsheds`, usado no boot do visualizador e a cada edição de parâmetro.
- **Interativo**: recebe só os parâmetros, prende um manipulador de mouse, e se completa em dois cliques (o primeiro fixa o observador, o segundo o alvo). Entre os dois cliques, mover o mouse atualiza a distância corrente. Ao completar, chama a função de retorno.

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

### A comparação é ESTRITA, e a compensação de 1,5 grau depende disso

Os testes de abertura (4 e 5) usam `>` e não `>=`, então **o pixel exatamente na costura passa nos dois sub-viewsheds vizinhos e recebe a mistura duas vezes**, o que aparece como uma faixa saturada. Um setor acima de 150 graus é dividido em dois ou três (`subViewshedLayout`), e é o mesmo cálculo que compensa, reduzindo a abertura de render de cada pedaço em `SEAM_NARROWING_DEGREES`. A folga foi **0,1 grau desde a revisão de 2026-09-15** e era 1,5 antes dela; a medição que trocou o número está na seção de revisão, no fim desta página.

Quem reescrever o shader com `>=` transforma essa compensação em uma FRESTA visível. Qualquer das duas escolhas serve, desde que o valor de `renderAngle` mude no mesmo commit e a escolha fique escrita. Desde 2026-09-15 as duas moram uma ao lado da outra: a aritmética saiu para [`../../frontend/src/js/3d_models_viewer_tool/services/viewshed-geometry.js`](../../frontend/src/js/3d_models_viewer_tool/services/viewshed-geometry.js), um folha de zero imports, e o cabeçalho dele diz que `SEAM_NARROWING_DEGREES` e o operador do shader são um par.

**E há um efeito colateral que ninguém pediu, medido só quando a aritmética virou testável:** cada pedaço é estreitado INTEIRO e renderizado centrado no seu deslocamento, ou seja, encolhe meia folga de cada lado. Nas emendas as duas metades somam a folga que o `>` estrito exige, mas nas duas bordas EXTERNAS do setor sobra um recuo de meia folga. Com a folga de hoje um setor de 240 graus desenha 239,8; com a de 1,5 grau que vigorou até 2026-09-15 ele desenhava 237. O desvio é imperceptível e não é regressão (o plugin substituído tinha o mesmo), mas ele existe; quem quiser o setor exato estreita só as bordas internas.

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

**A costura entre sub-viewsheds passou a ser coberta na revisão de 2026-09-15**, e a resposta da leitura de imagem que o aceite pedia é: **fresta, não faixa saturada**. O mesmo arquivo hoje tem um caso de 180 graus que exige DOIS estágios de pós-processamento (sem eles não há corte nenhum) e procura, numa faixa de colunas em volta da emenda, a maior corrida de chão CRU, isto é, chão dentro do setor que nenhum pedaço analisou.

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
| costura entre sub-viewsheds | 155 / 180 / 240 / 320 / 360 | maior corrida de chao cru | 0 px | 6 a 8 px | ver abaixo |

**A costura, que o aceite mandava ler na imagem: e FRESTA, nao faixa saturada.** Com a folga de 1,5 grau, a emenda mostrava uma tira de chao CRU de 6 a 8 pixels nesta cena, ladeada pelos dois fios de arame, bem na direcao de visada. A folga de 0,1 grau fecha a tira sem trazer a faixa de volta, e a faixa existe mesmo: com folga ZERO aparecem 41 pixels de mistura dupla no setor de 320 graus, e nenhum com 0,1.

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

## Ver também

- [[acervo-3d-convertido]] - o acervo que serve os modelos sobre os quais esta análise roda.
- [[inventario-de-vendors]] - o estado declarado do arquivo que esta reescrita substitui.
