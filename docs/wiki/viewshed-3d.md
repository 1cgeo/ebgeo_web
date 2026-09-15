# Viewshed 3D

O inventário do que a análise de visibilidade 3D FAZ, escrito para que ela possa ser reescrita: o contrato com o chamador, as decisões de desenho que parecem cosméticas e não são, e as armadilhas que só a medição entrega.

Esta página é o passo 2 da decisão D15 de 2026-09-15 ([`../decisions/decisions-2026.md`](../decisions/decisions-2026.md)): reescrever `frontend/public/vendors/cesium/cesium-viewshed.js` como código da casa. Ela descreve **o que** a peça faz, nunca **como** o vendor faz, porque o "como" é justamente o que vai mudar. A declaração de segurança daquele arquivo e o aceite da troca vivem em [`../seguranca/cesium-viewshed-reescrita-aceite.md`](../seguranca/cesium-viewshed-reescrita-aceite.md).

## O que a peça é, em uma frase

Um objeto por setor de visão que, dado um observador, um alvo, uma abertura horizontal, uma abertura vertical e um alcance, **tinge a cena inteira** de verde onde o observador enxerga e de vermelho onde não enxerga, e desenha o tronco da visão em fio de arame.

A tintura não é geometria: é um **pós-processamento de tela cheia**. Ele lê a cor e a profundidade do quadro já renderizado, reconstrói a posição de cada pixel, e decide a cor consultando um mapa de sombras cuja câmera está no olho do observador. Quem consome é [`frontend/src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js`](../../frontend/src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js), dentro do visualizador Cesium de modelos 3D.

## O contrato com o chamador, que é o que não pode mudar

Dois modos de construção, e o chamador usa os dois:

- **Dirigido**: recebe `cameraPosition` e `viewPosition` prontos e se desenha na hora. É o caminho de `createCesiumViewsheds`, usado no boot do visualizador e a cada edição de parâmetro.
- **Interativo**: recebe só os parâmetros, prende um manipulador de mouse, e se completa em dois cliques (o primeiro fixa o observador, o segundo o alvo). Entre os dois cliques, mover o mouse atualiza a distância corrente. Ao completar, chama a função de retorno.

**A opção de retorno se escreve `calback`, com um L.** O erro de digitação é do vendor e virou contrato: `activateViewshedTool` a passa com essa grafia. Quem reescrever e corrigir a ortografia sem tocar no chamador entrega um modo interativo que nunca completa, sem erro em lugar nenhum.

**Os campos que o chamador LÊ de volta** depois do clique interativo são `cameraPosition`, `viewPosition`, `heading`, `pitch`, `horizontalAngle`, `verticalAngle` e `distance`. Os três últimos são lidos com `|| DEFAULT_VIEWSHED_PARAMS.x`, então devolver `0` num deles cai no padrão em vez de no valor pedido. O chamador também carimba uma propriedade própria (`_wasSaved`) no objeto, então ou a classe aceita propriedade arbitrária, ou o chamador muda no mesmo commit.

**O ciclo de vida**: `destroy()` precisa ser chamável mais de uma vez sem derrubar a tela (o chamador já envolve em `try`), e `isDestroyed()` precisa existir. Os dois são hoje INJETADOS de fora, por `patchPrimitiveLifecycle` em [`frontend/src/js/3d_models_viewer_tool/services/cesium-compat.js`](../../frontend/src/js/3d_models_viewer_tool/services/cesium-compat.js), porque o vendor não os tem e o Cesium 1.138 passou a chamar `isDestroyed()` em toda primitiva adicionada. Uma classe que os implemente de verdade faz esse remendo sair, e é essa saída que mede o ganho.

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

Os testes de abertura (4 e 5) usam `>` e não `>=`, então **o pixel exatamente na costura passa nos dois sub-viewsheds vizinhos e recebe a mistura duas vezes**, o que aparece como uma faixa saturada. Um setor acima de 150 graus é dividido em dois ou três pela ferramenta (`computeSubViewshedCount`), e é ela que compensa, reduzindo a abertura de render de cada pedaço em 1,5 grau.

Quem reescrever o shader com `>=` transforma essa compensação em uma FRESTA visível. Qualquer das duas escolhas serve, desde que o valor de `renderAngle` mude no mesmo commit e a escolha fique escrita.

### O ramo que não escreve cor

Há um caminho, dentro do ramo de pixel oculto, que retorna **sem atribuir cor nenhuma**: quando a profundidade do pixel em espaço de sombra está a menos de 0,01 do plano próximo. Não é um acidente inofensivo, é comportamento indefinido de fragmento, e uma reescrita que escreva a cor original nesse ponto está corrigindo um defeito, não reproduzindo o desenho. Vale declarar a escolha.

## Duas propriedades do motor que só a medição entrega

Ambas foram medidas em 2026-09-15 nesta árvore, com o spec de pixel, e estão no cabeçalho dele ([`../../frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js`](../../frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js)):

- **O GLOBO NUNCA É TINGIDO, e as primitivas sobre ele são.** Com o terreno servindo de chão, o leque não pinta um pixel, em distância nenhuma, enquanto um bloco a quarenta metros recebe verde na face e vermelho no topo. A ferramenta vive dentro do visualizador de modelos, onde o chão é um tileset, e tileset é tingido como qualquer primitiva; mas quem for medir sobre o globo vai medir o caso que o produto não usa e concluir que o motor não funciona.
- **Só quem CASTA entra na conta.** Uma primitiva nasce `ShadowMode.DISABLED` (um `Cesium3DTileset` nasce `ENABLED`), e uma primitiva que não casta é invisível para o mapa de sombras: a cena inteira sai verde. Isso vale para quem monta cena de teste, e vale para quem um dia oferecer "ignorar esta camada na análise".

## O que NÃO precisa ser reproduzido

Metade do arquivo do vendor é um sensor retangular genérico com pintura Phong, plano de varredura animado, superfícies laterais e de domo, cor de interseção com o elipsoide e material configurável. **O viewshed usa uma fatia estreita disso**: o fio de arame, com raio e dois meios ângulos. Superfícies desligadas, varredura desligada, sem interseção com o elipsoide. Nenhum outro consumidor existe em `frontend/src/`; só o remendo de ciclo de vida em `cesium-compat.js` menciona a classe pelo nome.

Ou seja, a reescrita do tronco é um tronco de pirâmide em fio de arame, e não um sensor.

## Como saber se a reescrita reproduziu o desenho

A prova é visual, e ela existe desde 2026-09-15: [`../../frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js`](../../frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js), com a referência versionada ao lado. Ele mede em quatro camadas (pixels diferentes da referência, proporção de verde, proporção de vermelho, presença do fio de arame) mais o painel do produto. Antes dele, os únicos testes que citavam viewshed mediam a ENTIDADE viajando pelo sync, e nenhum construía o objeto.

Uma reescrita que deixe o spec verde reproduziu o desenho no caso de 120 graus. O que ele **não** cobre, e o aceite cobra à parte, é a costura entre sub-viewsheds acima de 150 graus: ali a leitura é de imagem, procurando faixa saturada e fresta.

## Ver também

- [[acervo-3d-convertido]] - o acervo que serve os modelos sobre os quais esta análise roda.
- [[inventario-de-vendors]] - o estado declarado do arquivo que esta reescrita substitui.
