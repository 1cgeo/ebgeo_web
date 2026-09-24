---
paths:
  - "frontend/src/js/street_view_tool/**"
  - "frontend/src/js/calibration/**"
  - "backend/src/modules/streetview360/**"
---

# Street View 360 e calibração

O nome deste arquivo é histórico: ele reunia tarefas de áreas diferentes, e hoje só o 360 mora aqui. O nome ficou porque código, testes e decisões registradas o citam. As outras tarefas estão em [algoritmo-de-processamento.md](algoritmo-de-processamento.md), [migracao-de-esquema.md](migracao-de-esquema.md) e [exportacao-pdf.md](exportacao-pdf.md).

## Street View 360 Navigation

**A projeção não usa distância nem altura.** O marcador recebe do mundo só uma direção:
o alvo é projetado no HORIZONTE da câmera pelo azimute, e a altura acima da linha vem da
posição na fila daquela direção (`elevationDeg(rank)`), não da geometria. A distância só
decide a ORDEM ao longo da direção. Altura de câmera, terreno e escala de distância não
estão apenas sem uso, foram removidos do cliente. O `fileoverview` de `projectOnHorizon` é
onde isso está dito por extenso.

Consequência prática: os campos inertes que o cliente nunca lia (camera_height,
distance_scale e marker_scale na foto; override_distance e override_height no alvo) foram
PODADOS do backend em 2026-08-29, para o web casar com o `ebgeo_360`, que não os tem
(decisão registrada em [`../../docs/decisions/decisions-2026.md`](../../docs/decisions/decisions-2026.md)). Não existem mais colunas, nem chegam no
payload. Procurar por elas para ajustar o alinhamento é perseguir um botão que nunca esteve
ligado em nada. **O único override que sobrou tem leitor, e ele não faz o que o nome
sugere:** `frontend/src/js/calibration/minimap.js` lê `override_bearing` para pintar o alvo
com raio e cor próprios no minimapa do operador. É realce de tela, não entrada da projeção
(o azimute servido é derivado da geometria por `ST_Azimuth`). O que corrige alinhamento é a
rotação de malha da calibração, que nivela a esfera antes de qualquer desenho.

## O par que DIVERGE é `tile-loader.js`, e ele é de outro repositório

Antes de qualquer conferência à mão, saiba onde a dívida está hoje. Ela **não** está nos cinco
arquivos de navegação da seção seguinte: conferidos em 2026-08-23, os cinco estão convergidos com
`ebgeo_360`, e num deles nós estamos à frente. O que diverge é
`frontend/src/js/street_view_tool/tile-loader.js`, cujo original vive em
public/calibration/js/tile-loader.js do ebgeo_360, no repositório vizinho, que **não** foi
aposentado: ele é o microsserviço 360 que este backend consome, e continua commitando.

**O delta esperado é declarado, e é isso que torna o porte barato.** O commit `741a9a4` do
`ebgeo_360` (2026-08-19) diz por extenso que os dois arquivos são cópia com trechos de adaptação
conhecidos. Hoje são SEIS, os três de lá mais três nossos:

1. o comentário de caminho na linha 1;
2. `import * as THREE from '@js/vendor/three.js'` e o `config.js` do monorepo, no lugar do
   `import ... from 'three'` de lá. **Este trecho quase sumiu em 2026-09-14 e não sumiu, e a razão
   é o ponto:** o Three.js deixou de ser o snapshot versionado `src/vendor/` e passou a vir do npm
   em versão exata (`three` 0.164.0), que é o mesmo pacote que o `ebgeo_360` usa. O especificador
   continua diferente porque aqui a biblioteca entra por um PONTO ÚNICO
   (`frontend/src/js/vendor/three.js`), no modelo de `frontend/src/js/map/maplibre.js`, e não por
   `three` nu em cada arquivo. A divergência que sobra é de uma linha e de endereço, não mais de
   VERSÃO: antes o diff dos dois arquivos podia esconder uma diferença de comportamento do three
   por trás de um import que parecia cosmético;
3. a raiz da API por `raizApiPadrao()` lendo `config.streetView360.serviceUrl`, no lugar de
   `raizDaApi(location.pathname)`, mais o carimbo de escopo por `stampAtlasOnUrl` e
   `currentResourceAtlasId` em DOIS pontos (o descritor e cada URL resolvida contra ele);
4. `frontend/src/js/street_view_tool/tile-upload-rects.js`, que é a contabilidade de retângulos da
   subida parcial, lá uma closure dentro do arquivo;
5. `frontend/src/js/street_view_tool/reeval-throttle.js`, que é o estrangulamento da reavaliação,
   lá `agendarReavaliacao` mais duas variáveis do mesmo escopo;
6. a opção `onTileErro` mais as DUAS chamadas dela, uma no ramo `!resposta.ok` e outra no `catch`
   de `baixarTile`, coladas nas duas linhas de `log` que já existiam lá. Autorizada pelo dono em
   2026-08-24, para fechar a última superfície muda: uma foto 360 que desenha COM BURACOS. O
   trecho carrega o FATO cru (`{ chave, status }`, com `status: null` quando resposta não houve) e
   **nenhuma regra de negócio**: quantos buracos valem uma acusação, quem a recebe e com que
   palavra é tudo `createTileHoleWatch` (`frontend/src/js/street_view_tool/photo360-failure.js`),
   ligado em `street_view_viewer.js`. As duas chamadas são guardadas por `if (onTileErro)`, e essa
   guarda é o que mantém a página de calibração viva: ela monta DOIS carregadores sem a opção, e
   lá não há mapa, logo não há painel para acusar. Preso por
   `frontend/tests/unit/foto360-com-buracos-acusa.test.js`, que também exige que esta declaração
   continue aqui, porque um trecho não declarado é lido como conserto perdido na conferência
   seguinte.

**O quarto e o quinto NÃO existem porque `tile-loader.js` seja intestável em node.** Ele é testável, e
SEIS suítes o dirigem lá, com `vi.mock` sobre `@js/vendor/three.js`. A razão é mais estreita e foi
medida revertendo: a guarda da envolvente (`loteParaSubir`) é **invisível** do carregador, porque
ele só expõe o lote que já sobreviveu a ela, e apagá-la deixa
`frontend/tests/unit/tile-loader-consertos-de-desempenho.test.js` inteiro verde. Ela é justamente a
peça cuja primeira versão mediu PIOR que o defeito, então é a que precisa de vermelho ao ser
revertida. Do estrangulamento, a borda de ENTRADA é síncrona e É cobrada pelo carregador real; o
resto (janela, borda de saída, aritmética da espera) precisa de relógio injetado, e falsear
`Date.now` em volta do carregador falsearia junto a fila de pedidos dele.

**Se for mexer no `wrapS` ou em qualquer constante do three, lembre dos SEIS mocks.** Eles são
literais de objeto, não `importOriginal`, então uma propriedade nova do three usada em
`tile-loader.js` derruba as seis suítes com "No X export is defined on the mock". Isso é bom
(fecha vermelho, não verde), mas não se adivinha antes da primeira rodada. Os quatro valores que
eles fixam por NÚMERO (`RepeatWrapping` 1000, `ClampToEdgeWrapping` 1001, `LinearFilter` 1006,
`SRGBColorSpace` `'srgb'`) foram reconferidos contra o pacote npm em 2026-09-14, na troca do
snapshot 164dev por `three@0.164.0`: os quatro são os mesmos, e as seis suítes passaram sem tocar
numa linha de asserção.

**O comando de conferência**, rodado da raiz deste checkout, lê o `ebgeo_360` sem checkout, sem trocar de branch e
sem escrever nada lá (ele é só leitura):

```bash
git -C ../ebgeo_360 show HEAD:public/calibration/js/tile-loader.js > /tmp/tl-360.js
diff --strip-trailing-cr /tmp/tl-360.js frontend/src/js/street_view_tool/tile-loader.js
```

O `ebgeo_360` é IRMÃO deste checkout nas máquinas em uso (o caminho absoluto muda de máquina, e já errou duas vezes quando escrito aqui), por isso o caminho é relativo. O `git -C` dispensa o `cd`, então o comando continua sendo só leitura e não deixa o shell noutro repositório. Conferido em 2026-09-24 com o `ebgeo_360` em `676fcb8`: nenhum commit tocou o `tile-loader.js` de lá desde a conferência registrada abaixo.

O `--strip-trailing-cr` não é opcional: o nosso arquivo é CRLF e o de lá é LF, e sem ele o diff
acusa as 1600 linhas. **Diferença maior que os seis trechos acima é conserto não portado.** Foi
assim que os quatro consertos de cliente do commit `ff01e06` (2026-08-23) chegaram aqui, e é assim
que o próximo lote chega. Os sete consertos restantes daquele commit são de servidor (Fastify,
SQLite, ETag) e **não** transferem: o nosso 360 é servido pelo backend em Express, com ETag
próprio.

**Este arquivo é IMPORTADO pela calibração, não copiado**, e é a única peça do 360 de que isso vale:
`frontend/src/js/calibration/viewer.js` e `frontend/src/js/calibration/preview-viewer.js` fazem
`import { createTileLoader } from '../street_view_tool/tile-loader.js'`. Um conserto aqui chega de
graça às duas montagens do estúdio, ao contrário dos cinco arquivos de navegação da seção seguinte,
que são cópia de verdade. Repare no efeito colateral, que é o que dá peso ao `dispose()`: a página
de calibração monta DOIS carregadores, então toda textura de GPU não descartada vaza em dobro.

Última conferência: 2026-08-29, com o `ebgeo_360` em `5f79c12`. O delta medido é exatamente os
seis trechos acima. Os quatro commits que o 360 ganhou desde `9d0f528` (a conferência anterior)
não tocam em `public/` nem no servidor: são roteiro de ingestão (`scripts/`), e por isso o arquivo
continua convergido sem porte nenhum. Anote a data ao re-conferir, senão esta seção vira um
"confira" sem prazo de validade.

## Os cinco arquivos de navegação, que hoje estão CONVERGIDOS

**O acoplamento que importa agora é interno, e é de PASTA, não de arquivo.**
`frontend/src/js/calibration/` carrega uma cópia da navegação de
`frontend/src/js/street_view_tool/navigation/`, e são CINCO pares, não um projetor:
`projector.js`, `renderer.js`, `constants.js`, `navigator.js` e `hit-tester.js`, com as
mesmas classes (`StreetViewProjector`, `StreetViewRenderer`, `StreetViewHitTester`) e as
mesmas funções exportadas (`pontosDaSeta`, `rotuloDeAndar`, `drawArmillarySphere`,
`rankOpacity`). São da ordem de duas mil linhas de cada lado.

A duplicação é deliberada: a calibração não pode arrastar a store nem o MapLibre do mapa.
O preço é que uma correção feita de um lado não chega ao outro, e o sintoma (o operador
calibra vendo um arranjo, o visualizador desenha outro) aparece longe da causa, com as
duas suítes verdes.

**As duas cópias JÁ divergiram, e parte da divergência é de propósito.** Só a calibração
tem `desenharDescricao`, `elevacaoDeVizinha` (com as constantes `ANDAR_PASSO_DEG` /
`ANDAR_DEGRAUS_MAX` que a alimentam), o módulo `descricao.js` e o cache de frame
`beginFrame`; só o visualizador tem `screenToSpherical` e as constantes de POI e de
etiqueta. Os dois `NAV_CONSTANTS` nem carregam o mesmo conjunto de chaves. Antes de
"sincronizar" um arquivo inteiro, saiba qual metade é decisão.

**O guarda existe e tem nome:** `frontend/tests/unit/calibracao-espelha-marcador-andar.test.js`
importa AS DUAS cópias e exige o mesmo número das duas. Ele também leva asserção
ABSOLUTA em cada bloco, porque comparar sozinho deixaria passar duas cópias erradas do
mesmo jeito. Rode-o ao tocar em qualquer um dos lados.

O que ele PRENDE:

- as SEIS constantes de andar de `NAV_CONSTANTS`, com asserção de PRESENÇA antes da
  igualdade, senão `undefined === undefined` passaria verde com as duas ausentes;

- `elevacaoComAndar` sobre a grade inteira de posto por degrau, mais os degraus que não são
  número (`null`, `undefined`, `NaN`), com números de controle absolutos em graus e em
  pixels, e a folga de meio raio medida contra `angularRadiusDeg(0)`;

- `rotuloDeAndar` com o texto esperado caso a caso, dois algarismos e nível zero inclusive;

- `drawArmillarySphere` chamada por chamada, por um contexto de canvas espião comparado com
  `deepStrictEqual` em sete estados, mais o texto do destino e o recuo da seta em absoluto;

- o arranjo da fila (`layoutDirections`), com posto, raio e altura iguais dos dois lados,
  mais a asserção absoluta de que quem sobe fica acima da linha e quem desce abaixo.

O que ele NÃO alcança: `StreetViewHitTester`, `rankOpacity`, a classe `StreetViewRenderer`
e tudo em `projector.js` que não seja altura de andar. Fora do que está na lista acima, a
conferência ainda é o diff na mão, e ele tem cinco arquivos de cada lado.

O estúdio foi portado para cá, então esta conferência é entre pastas vizinhas, não entre repositórios. Ver [[calibracao-e-grafo-360]] e [[streetview-360]].

O dado do 360 vem do backend (módulo `streetview360`, schema `sv360`), não do repositório
externo.
