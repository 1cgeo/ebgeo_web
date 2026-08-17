# Primeira pessoa 3D (Gaussian Splatting)

Percorrer um ambiente interno capturado por *Gaussian Splatting*, a pé, em primeira
pessoa, com colisão por voxel, marcadores explicativos e trena. É o porte para o
EBGeo Web do protótipo `museu-gs`, que digitalizou a Sala Histórica General Malan
do 1º CGEO.

O que o módulo NÃO é: um visualizador de nuvem de pontos georreferenciada. O
ambiente é **local, em metros**, com origem própria. Nada do que acontece dentro do
viewer é persistido — os marcadores são conteúdo curado, de leitura, que vem da
pasta da cena.

## Como se abre

Quatro portas, todas para a mesma função `openFirstPersonViewer(sceneId, options)`:

| porta | onde | o que acontece |
| --- | --- | --- |
| Catálogo | chip "Catálogo" → filtro "Modelos 3D" | o card da cena abre o viewer direto; o item carrega `viewer: 'firstPerson'` |
| Pino roxo no mapa | camada `3d-models-markers` do controle de modelos 3D | clique abre o popup de prévia; o botão diz **"Entrar na cena"** (o tileset diz "Visualizar em 3D") |
| Busca | barra de busca global e busca de feições | o resultado aparece como **"Cena 3D:"**, não "Modelo 3D:" |
| Link compartilhado | `#view=fp&scene=<id>&x=…&y=…&z=…&yaw=…&pitch=…` | abre a cena já na pose gravada |

O pino da cena é **roxo `#7B52D3`**, para separá-lo dos dois que já existiam: verde
`#508D4E` para o tileset 3D (Cesium) e laranja `#ff6b00` para o 360. O pino da cena
não recebe *badge* de contagem — não há feição para contar (veja
"O que ficou de fora do MVP").

O botão de compartilhar dentro do viewer lê a pose atual, monta a URL acima e copia
para a área de transferência.

## A seção `firstPerson3d` do `config.js`

Fica entre `tilesets` e `streetView360`. Ligada por `enabled`, com uma lista de
cenas. `hasFirstPersonScenes()` (em `config.helpers.js`) é a verdade única sobre
"esta instância tem cena?" — o catálogo, a busca e o mapa perguntam a ela.

```js
firstPerson3d: {
  enabled: true,
  scenes: [
    {
      id: "museu-1cgeo",
      name: "Museu do 1º CGEO",
      description: "Sala histórica do 1º Centro de Geoinformação",
      keywords: ["museu", "sala histórica"],
      basePath: "/3d/primeira-pessoa/museu-1cgeo",
      data_captura: "04/08/2026",
      local: "Porto Alegre, RS",
      locate: { lon: -51.2, lat: -30.03 },
      poseInicial: { x: 3.82, y: 0.55, z: 1.42, yaw: 0, pitch: 0 },
      velocidade: 2.4,
      fov: 60
    }
  ]
},
```

| campo | obrigatório | uso |
| --- | --- | --- |
| `id` | **sim** | endereça a cena: deep link, catálogo, `openFirstPersonViewer` |
| `basePath` | **sim** | pasta da cena; TODA URL sai daqui |
| `name` | recomendado | rótulo no card do catálogo, no popup do pino e na busca |
| `description` | não | texto do card; entra na busca do catálogo |
| `keywords` | não | termos extras para a busca (array de strings) |
| `data_captura` | não | `DD/MM/AAAA`; é o que ordena o catálogo por data |
| `local` | não | "Porto Alegre, RS"; entra na busca |
| `locate` | não | `{ lon, lat }` — onde o pino roxo cai no 2D. Sem isso, a cena existe no catálogo e na busca, mas não no mapa |
| `poseInicial` | não | `{ x, y, z, yaw, pitch }` em metros/radianos do referencial da cena. Onde o visitante nasce, e para onde um deep link malformado volta |
| `velocidade` | não | m/s; vai para `WalkMode.moveSpeed`. Padrão 2,4 |
| `fov` | não | graus. Padrão 60 |

Cena **sem `id` ou sem `basePath` é descartada** por `getFirstPersonScenes()`: não é
endereçável nem resolvível, e passar adiante só adiaria a falha para dentro do
viewer. Os defaults de `poseInicial`/`velocidade`/`fov` não são aplicados no
service — ele devolve a cena crua e o viewer aplica `FP_DEFAULTS`.

### Sobrescrever URL, a exceção

Cada asset pode ser apontado à mão, mas isso é exceção, não caminho feliz:
`splatUrl`, `voxelMetaUrl`, `voxelBinUrl`, `markersUrl`, `itemsBaseUrl`,
`previewVideo`, `previewThumbnail`. `basePath` continua obrigatório mesmo assim,
porque a `foto` do marcador se resolve contra ele.

Absolutos passam intactos (`http:`, `https:`, `data:`, `blob:`, `//host`, `/raiz`);
`./` inicial é removido antes de juntar. O `basePath` é normalizado uma vez, dentro
do service, nunca no ponto de uso.

## Layout padrão da pasta da cena

Todo o resto o `scene-config.service.js` deriva do `basePath`:

```
<basePath>/
├── cena.sog                   # o modelo comprimido
├── voxel/
│   ├── voxel-meta.json        # limites da grade e cabeçalho do octree
│   └── voxel.bin              # octree de colisão
├── marcadores.json            # o conteúdo curado
├── itens/                     # as fotos dos cards
│   ├── item_001.jpg
│   └── …
└── preview/
    ├── preview.webm           # prévia em vídeo do popup do pino e do card
    └── thumbnail.jpg          # capa do card
```

| campo resolvido | default derivado |
| --- | --- |
| `splatUrl` | `<basePath>/cena.sog` |
| `voxelMetaUrl` | `<basePath>/voxel/voxel-meta.json` |
| `voxelBinUrl` | `<basePath>/voxel/voxel.bin` |
| `markersUrl` | `<basePath>/marcadores.json` |
| `itemsBaseUrl` | `<basePath>/itens` |
| `previewVideo` | `<basePath>/preview/preview.webm` |
| `previewThumbnail` | `<basePath>/preview/thumbnail.jpg` |

**O campo `foto` do marcador é relativo ao `basePath`, não ao `itens/`.** Ou seja, o
valor típico já vem escrito `"itens/item_001.jpg"`. `itemsBaseUrl` fica exposto para
quem quiser montar caminho por conta própria, mas `resolveMarkerPhotoUrl(scene, foto)`
junta ao `basePath`. Foto ausente ou vazia devolve `null`, e o card simplesmente não
mostra imagem.

Os assets **não vivem no repositório**. A pasta da cena é publicada pelo mesmo
servidor de conteúdo estático que serve os tilesets; o `basePath` do `config.js` é a
única coisa que o EBGeo sabe sobre onde ela está.

## O `marcadores.json`

Um array de objetos. É o arquivo que se edita para mudar os textos — nada disso
passa pelo store nem pelo IndexedDB.

| campo | uso |
| --- | --- |
| `id` | identifica o marcador e controla qual ficha está aberta. Ausente, o módulo gera um UUID — mas então o marcador não é endereçável de fora |
| `titulo` | nome do item; aparece no rótulo flutuante e no título da ficha |
| `item` | número da ficha do acervo; vira a etiqueta "item N do acervo" |
| `texto` | descrição geral, copiada da ficha |
| `detalhes` | fabricante, data, número de série |
| `foto` | caminho relativo ao `basePath`, tipicamente `itens/item_NNN.jpg` |
| `fonte` | de onde veio a informação |
| `x` `y` `z` | ponto no mundo da cena, em metros |

Marcador com `x`/`y`/`z` não finito é descartado na carga, com aviso no console.
`titulo`, `item`, `detalhes`, `foto` e `fonte` são todos opcionais: os campos vazios
somem da ficha em vez de aparecerem em branco.

Exemplo:

```json
[
  {
    "id": "estereoscopio-sge",
    "titulo": "Estereoscópio “SGE”",
    "item": 1,
    "texto": "Instrumento que permite a observação simultânea…",
    "detalhes": "Fabricante Wild Heerbrugg, 1958",
    "foto": "itens/item_001.jpg",
    "fonte": "Ficha 1 do catálogo da Sala Histórica General Malan",
    "x": -2.85,
    "y": -0.07,
    "z": -1.25
  }
]
```

Para achar as coordenadas de um item novo, o protótipo tinha a ferramenta de
anotações (`M`), que lançava um raio contra o octree e baixava o JSON já no formato
acima. **Essa ferramenta não foi portada** — veja a última seção. Enquanto ela não
existir aqui, as coordenadas saem do protótipo ou do console (`queryRay` do objeto de
colisão).

Para extrair a foto de uma ficha ODT: o ODT é um ZIP, e a maior imagem dentro de
`Pictures/` é a foto do item.

## Gerar os assets

Três passos com o `splat-transform`. O modelo original sai do laser/fotogrametria em
**Z para cima**, e o modo de caminhada **exige Y para cima**.

```bash
npx splat-transform pipeline-01-rotate.json              # Z para cima -> Y para cima (17 s)
npx splat-transform pipeline-02-voxel.json               # gera voxel/ na GPU (3,4 s)
npx splat-transform create m4_yup.ply cena.sog           # comprime (42 s)
```

**A rotação vem ANTES da voxelização, e isso não é detalhe de gosto.** Sem ela o
splat e a colisão ficam em referenciais diferentes: você vê a sala e bate no nada — o
sintoma é caminhar atravessando a parede que está desenhada na sua frente, ou parar no
meio do vão. É a armadilha mais cara do pipeline, porque nada falha: os dois arquivos
carregam, o viewer abre, e só o corpo discorda dos olhos.

O passo 2 exige GPU. Confira com `npx splat-transform list:gpu`.

Os três JSON de pipeline:

`pipeline-01-rotate.json` — lê o `.ply` cru, aplica a matriz e escreve o `_yup.ply`,
que é a entrada da voxelização e do `create`:

```json
{
  "version": 1,
  "tasks": [
    { "id": "0", "type": "Read",   "config": { "inputs": ["m4.ply"], "output": "cache0" } },
    { "id": "1", "type": "Modify", "config": { "input": "cache0", "output": "cache0",
                                               "modifyPaths": ["modify-zup-to-yup.json"] } },
    { "id": "2", "type": "Write",  "config": { "input": "cache0", "output": "m4_yup.ply" } }
  ]
}
```

`modify-zup-to-yup.json` — a rotação em si:

```json
{
  "isRowMatrix": true,
  "transform": [1, 0, 0, 0,  0, 0, 1, 0,  0, -1, 0, 0,  0, 0, 0, 1],
  "deletedIndices": [],
  "indicesTransform": []
}
```

`pipeline-02-voxel.json` — a colisão. `box` recorta o volume útil; ajuste-a por cena,
senão o octree cobre o vazio ao redor da captura:

```json
{
  "version": 1,
  "tasks": [
    { "id": "0", "type": "Read",  "config": { "inputs": ["m4_yup.ply"], "output": "cache0" } },
    { "id": "1", "type": "Voxel", "config": {
        "input": "cache0", "output": "voxel",
        "voxelResolution": 0.05, "opacityCutoff": 0.1,
        "backend": "gpu", "collisionMesh": "smooth",
        "box": { "minCorner": [-6, -2, -6], "maxCorner": [13, 5, 8] } } }
  ]
}
```

Notas medidas no protótipo:

- **Voxel de 5 cm** é a precisão de tudo que encosta no octree: a caminhada, o raio do
  marcador e a trena. A trena serve para a dimensão de um móvel ou de um vão, não para
  a cota de uma peça.
- **O piso ficou com 91,6% de cobertura.** Nos 8,4% restantes dá para cair pelo chão. A
  opção `floorFill` do voxelizador tapa esses buracos; use-a e reconfira andando pelas
  bordas.
- O voxelizador também emite `collision.glb` (a malha de colisão, ~532 mil triângulos).
  **O EBGeo não carrega esse arquivo** — ele existia só para inspeção visual no
  protótipo. Não o publique na pasta da cena.
- Conferência de escala, com a cena carregada, no console:

  ```js
  const e = camera.matrixWorld.elements;
  const chao = colisao.queryRay(e[12], e[13], e[14], 0, -1, 0, 5);
  e[13] - chao.y;   // tem de dar 1,400 m (0,2 de folga + 1,2 de olho)
  ```

  Na sala histórica o pé-direito medido assim deu 2,65 m.

## Atalhos

Todos vivem na modal de atalhos do EBGeo — o viewer **não tem botão de ajuda**.

| tecla | ação |
| --- | --- |
| `W` `A` `S` `D` ou setas | andar |
| `espaço` | pular |
| `shift` ou `C` | agachar (abaixa o olho 60 cm) |
| `T` | trena (medição) |
| `L` | rótulos dos itens |
| `Backspace` | desfazer o último ponto, ou a última medição |
| `Delete` | limpar a medição |
| `Esc` | fecha a ficha aberta → fecha a medição em andamento → desliga a trena |

### A trena

Ela se usa **igual à medição de distância do mapa 2D**, e isso não é coincidência: é
o mesmo gesto e o mesmo card.

| gesto | efeito |
| --- | --- |
| clique esquerdo | crava um vértice. Quantos quiser, **sem tecla nenhuma junto** |
| clique direito | fecha a medição |
| clique duplo | fecha a medição, descartando o vértice que o próprio primeiro clique cravou |
| clique depois de fechada | começa uma medição nova, apagando a anterior |
| `Backspace` | desfaz o último vértice enquanto a medição está aberta |

Ao fechar, sobe o **card de resultados** no painel da aplicação — o mesmo
`createDistanceResultsPanel` que a medição 2D usa, com o total, a lista de segmentos e
o seletor de unidade. Trocar a unidade no card **redesenha as pílulas na cena**. O card
não tem "Salvar como feição", porque nada dentro deste viewer persiste; "Limpar"
desliga a trena.

O protótipo fazia diferente: exigia `shift` para manter a polilinha aberta, fechava a
medição no segundo clique simples e empilhava todas as medições feitas na tela. Foi
trocado porque era uma segunda gramática para o mesmo verbo.

**A trena é `T` e não `D`** porque `D` é "andar para a direita".

Duas armadilhas de teclado que só aparecem no navegador, herdadas do protótipo:

- **`Ctrl` não serve para agachar.** `Ctrl+W` fecha a aba do Chrome, e nenhum
  `preventDefault` da página cancela isso. Ficaram `shift` e `C`. Cuidado do Windows:
  cinco TOQUES seguidos no shift abrem as Teclas de Aderência; segurar, que é o gesto
  do agachar, não abre.
- **Não há tela cheia, e por isso não há teclado inteiro.** O protótipo tinha um `F`
  que entrava em tela cheia e chamava a Keyboard Lock API — a única via que entrega
  `Ctrl+W` e companhia para a página. Ele foi removido do MVP. A consequência é que
  `Ctrl+W` continua fechando a aba durante a caminhada, e não há o que fazer sem
  reintroduzir a tela cheia.

### Olhar e clicar

Girar a vista é **arrastar**, com o botão esquerdo. **Quem separa girar de clicar é o
ARRASTO, não o botão** — clique curto, de menos de 5 pixels, vai para o marcador e
para a trena. O cursor fica sempre visível sobre a cena.

Clicar num rótulo abre a ficha do item; clicar na cena limpa fecha a ficha aberta.

### O modo imersivo, e por que ele voltou

**Existe um modo de ponteiro preso, e ele é opcional.** O protótipo tinha um que ligava
sozinho: o clique capturava o ponteiro, o olhar passava a seguir o mouse sem botão
nenhum e uma mira substituía o cursor. Aquele foi removido, e a razão continua de pé:
o visitante precisa do cursor para os rótulos, para a trena, para a barra de
ferramentas e para o painel lateral, e um modo que se descobre por acidente e do qual
se sai por acidente é pior do que não ter modo nenhum.

O que voltou em 2026-08-17 não é aquele. **A diferença inteira é que este é
deliberado**, e cada peça responde a uma metade daquela objeção:

| peça | responde a |
| --- | --- |
| botão próprio na barra (o alvo), e nenhuma outra entrada | "se descobre por acidente" |
| aviso fixo no topo, dizendo o modo e nomeando as saídas | "se sai por acidente" |
| mira no centro, com o clique resolvido por `markers.pickAtCenter` | "precisa do cursor para os rótulos" |
| a trena desliga ao entrar | "precisa do cursor para a trena" |

Sai-se com **ESC**, com o **botão direito**, ou clicando num rótulo que cobre outros.

O ESC é do navegador, não deste código: ele solta o ponteiro sozinho e, no Chrome, nem
entrega esse `keydown` para a página. O botão direito pode ser a segunda saída
justamente porque a trena — a outra dona daquele botão — está desligada dentro do modo.

**O botão direito é tratado no `mousedown`, e não no `contextmenu`.** Medido: o Chrome
não dispara `contextmenu` nenhum enquanto o ponteiro está preso, porque suprime o menu
abaixo da página. Um handler esperando ali nunca roda. A consequência de tratar no
`mousedown` é que soltar a trava devolve o cursor na posição que ele tinha ANTES dela
(em geral o botão da barra por onde se entrou), e o menu que o Chrome dispara depois cai
sobre a barra, que é irmã do container e não filha. Por isso a saída arma uma janela de
200 ms e um handler no documento engole esse menu — endereçado por TEMPO, porque o alvo
é justamente o que não se pode prever.

**Mirar numa pilha sai do modo.** Um rótulo com "+N" abre a lista daquela pilha, e lista
é linha para clicar: com o ponteiro preso não há cursor para clicar nenhuma. Então esse
clique devolve o cursor junto com a lista. Escolher entre itens é tarefa de cursor, e o
botão da barra repõe o modo num clique.

**O que o ponteiro preso custa, e não é negociável:** enquanto ele está preso o
navegador esconde o cursor e entrega TODO evento de mouse ao elemento travado. Nada na
tela é clicável, o aviso do topo incluído. Ele é botão de verdade e desliga o modo, mas
só alcança o clique depois que o ponteiro se solta — o que acontece sozinho ao trocar
de aba ou perder o foco. Dentro do modo, quem serve são o ESC e o botão direito, que é
o que o próprio aviso diz.

**O sinal do mouse é outro dentro do modo, de propósito.** Fora dele, girar é arrastar,
e arrasto move o conteúdo sob a mão que o segura (a mesma regra do mapa 2D e do 360).
Preso, não há mão segurando nada: o mouse É a cabeça, e a vista vai na direção do
movimento. `walk-mode.js` inverte os dois eixos junto, porque virar um só deixa as duas
metades do mesmo gesto discordando.

O **botão direito não gira nada**, e isso é deliberado: ele é só de fechar a medição,
como no mapa 2D. O protótipo girava com os dois, mas um botão que gira a câmera e
também encerra a medição transforma todo arrasto com ele numa aposta sobre se a trena
percebeu o movimento. Por isso o `contextmenu` do viewer nem testa arrasto: qualquer
soltar do botão direito sobre a cena quer dizer "fecha a medição".

Dentro do **modo imersivo** aquele mesmo botão significa "sair do modo", e as duas
leituras não colidem porque não coexistem: entrar no modo desliga a trena.

A caminhada anda a 2,4 m/s. O padrão do `walk-demo` do motor, 7 m/s, é uma corrida de
25 km/h que passa reto pelas vitrines.

## Opções de motor fixadas, e por quê

Três decisões vêm medidas do protótipo e entraram como padrão aqui. As medidas foram
feitas a 1920x1080, com ruído de 2% entre repetições, e **só valem com ponto de
sincronismo com a GPU** — `rAF` + `readPixels` de 1 pixel. Três instrumentos anteriores
mentiram, cada um de um jeito: `rAF` com vsync media o monitor (tudo dava 59,9 fps),
`rAF` com aba oculta media o estrangulamento do Chromium, e `rAF` sem vsync media o
laço de JavaScript (1000 fps para 1,25 milhão de gaussianos).

| opção | efeito medido | por que é padrão |
| --- | --- | --- |
| contexto **sem MSAA e sem `preserveDrawingBuffer`** | 10,8 ms → 6,8 ms, **1,59x** | e a comparação de pixels crus entre as duas configurações deu **0,00% de pixels diferentes**, com diferença média de 0,04 de 255 — o mesmo ruído entre duas rodadas iguais. Ganho sem custo medido |
| `raster.detailCullingThreshold = 0` | desenha o gaussiano sub-pixel, que o padrão descartava | qualidade acima de desempenho, por decisão de 2026-08-13 |
| `sort.highPrecisionEnabled = true` | ordem de profundidade exata | idem; junto com o item acima custa **10%** de quadro (7,2 ms contra 7,1 ms — dentro do ruído) |

**Ressalva honesta sobre a ordenação em precisão alta:** comparação de quadro PARADO
não enxerga erro de ordem. O erro de ordem aparece como troca de camada ao GIRAR. O que
a medida garante é o custo baixo, não o ganho. Ela está ligada por julgamento, não por
evidência.

O que foi testado e **descartado**:

| botão | o que aconteceu |
| --- | --- |
| meia resolução (`pr=0.5`) | 2,12x mais rápido — mas é troca de qualidade, e a decisão foi qualidade. Não há botão de resolução aqui |
| supersampling (`pr` 1,5 e 2) | 0,00% de pixels alterados e a energia de borda CAI (65k → 58k → 54k). Custou 3x o quadro para uma imagem levemente mais macia. **Supersampling não serve a splat gaussiano**: ele combate serrilha de aresta dura, e gaussiana não tem aresta — já é suave por construção |
| harmônicos de grau 1 ou 0, corte de detalhe, culling de tronco, sort a 15 Hz | 10,8 a 11,1 ms, tudo dentro do ruído. Os botões que a leitura do código apontava como suspeitos não devolveram um quadro sequer, e cobram cor por direção de vista |
| `raster.maxStdDev` | o `set` aceita e a leitura devolve o padrão 2,8284: o motor ignora |
| `SplatPackType.Raw` | reprova na carga: "RawSplatData is not supported create splat" |
| LOD por blocos | 1,40x mais rápido, mas com um quarto dos gaussianos. Fora do padrão, e fora do MVP |
| botões de desempenho por parâmetro de URL | eram andaime de medição do protótipo. Não foram portados |

O custo é de **preenchimento de tela**, proporcional aos pixels. Numa máquina fraca ou
em tela muito grande, o gargalo volta — e a medida terá de ser refeita nessa máquina,
não herdada desta.

## Arquivos do módulo

| arquivo | o que é |
| --- | --- |
| `src/js/first_person_3d_tool/index.js` | barrel; só wrappers `async` com `import()` — o viewer nunca entra estático |
| `src/js/first_person_3d_tool/first_person_viewer.js` | monta a cena, carrega splat e octree, liga o laço de quadro. **Lazy** |
| `src/js/first_person_3d_tool/scene-config.service.js` | lê o `config.js`, deriva as URLs do `basePath`, carrega marcadores e colisão |
| `src/js/first_person_3d_tool/walk/voxel-collision.js` | o octree: `queryRay`, `queryCapsule`. Módulo **puro**, sem DOM e sem o motor — é o único testável em node |
| `src/js/first_person_3d_tool/walk/walk-mode.js` | física da caminhada, olhar (arrasto e preso), teclas de movimento |
| `src/js/first_person_3d_tool/walk/pointer-lock.js` | a Pointer Lock API e as quatro armadilhas dela: assíncrona, recusável, revogada pelo navegador, e com carência para repetir |
| `src/js/first_person_3d_tool/walk/constants.js` | `FP_DEFAULTS` e as constantes numéricas do porte |
| `src/js/first_person_3d_tool/components/markers-layer-fp.js` | rótulos projetados sobre o canvas, com oclusão por raio |
| `src/js/first_person_3d_tool/components/marker-panel-fp.js` | o CONTEÚDO da ficha do item. Não é um painel: o clique no rótulo emite `MARKER_FP_CLICKED` e o `sidebar.control.js` monta este conteúdo no painel de feição da aplicação — o mesmo que abre no 2D, no Cesium e no 360, na mesma posição e com a mesma moldura. Somente leitura: marcador de cena é conteúdo curado da pasta, não feição editável |
| `src/js/first_person_3d_tool/tools/measurement_tool_fp.js` | a trena: raio contra o octree, linhas em SVG, pílula em HTML. Uma medição por vez, com a mesma gramática de cliques da medição 2D; o card de resultados é o compartilhado de `measurement_tool/` |
| `src/js/first_person_3d_tool/tools/share_tool_fp.js` | monta e copia o link da pose atual |
| `src/js/first_person_3d_tool/services/keyboard-service-fp.js` | dono da tabela de teclas e da cascata do `Esc`; desliga os atalhos globais enquanto o viewer está aberto e os religa ao fechar. O viewer entrega verbos e não pergunta nada sobre teclas |
| `src/css/first-person-3d.css` | o bloco `fp3d` inteiro |
| `tests/unit/fp-voxel-collision.test.js` | 39 testes sobre o octree |

Diferença estrutural em relação ao protótipo: lá era uma página de uso único, que
nunca fechava e portanto nunca limpava nada. Aqui o viewer **abre e fecha muitas vezes
na mesma sessão**, então todo `listener` de `document`/`window` e todo temporizador
passa por `@utils/event-cleanup.js` e morre num `destroy()`.

## O que ficou de fora do MVP

Isto é escopo cortado de propósito, não pendência esquecida. Cada item vem com o que
custaria trazê-lo.

### 1. Briefing apontando para uma cena de primeira pessoa

Hoje um slide de modo `VIEWER_3D` carrega `slide.modelId`, e esse id é validado contra
`config.tilesets` em **quatro pontos**:

| arquivo | linha | o que faz |
| --- | --- | --- |
| `src/js/briefing/editor/briefing-editor.control.js` | 571 | `config.tilesets?.some(t => t.id === slide.modelId)` — desenha o aviso de "Modelo 3D indisponível" no card do slide |
| `src/js/briefing/editor/briefing-editor.control.js` | 750 | mesma expressão — bloqueia a pré-visualização do slide |
| `src/js/briefing/editor/briefing-editor.control.js` | 1022 | mesma expressão — trava a entrada no modo 3D do editor |
| `src/js/briefing/editor/briefing-editor.control.js` | 1375 | `config.tilesets?.find(t => t.id === tilesetId)` — resolve o nome e a pose ao gravar o slide |
| `src/js/briefing/validation/reference-validator.js` | 362-375 | `_getAvailableModels()` monta o `Set` a partir de `config.tilesets`… |
| `src/js/briefing/validation/reference-validator.js` | 271 | …e `availableModels.has(slide.modelId)` reprova o `.ebgeo` importado |

Custaria: estender essas verificações para consultar também `getFirstPersonScenes()`
(ou introduzir um `SlideMode.VIEWER_FP` com validação própria — a escolha entre as
duas é a decisão de projeto), e estender
`src/js/briefing/presentation/transition.service.js`, que hoje chama
`open3DViewer(slide.modelId)` em cinco pontos (linhas 480, 559, 566, 634 e 852) e
guarda `this._currentModelId` para decidir se o viewer precisa ser recarregado entre
slides. A transição entre um slide de mapa e um slide de cena não existe hoje em
nenhuma forma.

### 2. A cena na aba Feições

`src/js/features_tab/models3d-section.component.js` lista, por tileset, os marcadores,
medições, viewsheds e posições de câmera gravadas: `groupFeaturesByTileset()` (linha
111) agrupa por `feature.tilesetId`, e `config?.tilesets || []` (linhas 75 e 485)
resolve o nome de exibição.

A cena não entra ali por um motivo simples: **não há feição para listar**. Uma seção
vazia com o nome da cena não informaria nada. Este item exige o item 3 antes.

### 3. Persistir feições capturadas dentro do ambiente

Marcador do usuário, medição salva, anotação. O protótipo tinha anotações, guardadas no
IndexedDB do próprio navegador — `anotacoes.ts` **não foi portado**, e de propósito:
aquilo era armazenamento local sem sincronização, invisível para qualquer outro
usuário, apagado ao limpar os dados do site. Aqui há um store de verdade, e a feição
precisa entrar nele direito. Custaria:

- **Operações de store novas**, seguindo o padrão *persistence-first* de
  `.claude/skills/store-op/SKILL.md`: a persistência roda primeiro, e o efeito colateral
  (rastreamento de cor, log, fila de sincronização) só depois que o IndexedDB confirma.
- **Um sistema de coordenadas para ancorar a feição — e esta é a decisão difícil.** O
  ambiente é local, em metros, com origem arbitrária no ponto onde a captura começou.
  Todo o resto do EBGeo é geográfico: `lng`/`lat`, camadas MapLibre, `.ebgeo` que viaja
  entre instalações. Amarrar metros locais a lat/lon exige uma transformação por cena
  (origem georreferenciada + azimute do eixo, no mínimo), definida por quem capturou, e
  guardada em algum lugar — provavelmente na própria cena do `config.js`, ao lado do
  `locate`. Sem isso a feição não pode aparecer no 2D, não entra no `.ebgeo` de forma
  útil e não conversa com nenhuma outra ferramenta. Guardar a feição em metros locais é
  possível, mas cria uma segunda classe de feição, que não é o que o resto do sistema
  espera.
- **Badge de contagem no pino roxo.** As camadas `badgeCircleLayer` e `badgeTextLayer`
  de `src/js/3d_models_viewer_tool/add_3d_models_viewer_control.js` hoje carregam
  `['==', ['get', 'kind'], 'tileset']` no filtro, exatamente para que a cena não
  desenhe um badge de zero. Tirar esse filtro é a parte trivial; o que falta é o número
  para pôr dentro dele.

### 4. Minimapa dentro do viewer

O 360 tem: `src/js/street_view_tool/street-view-mini-map-style.js` mais
`src/js/street_view_tool/navigation/minimap-sync.js`, um MapLibre pequeno no canto que
segue a posição e o azimute do observador.

A cena não tem, e pelo mesmo motivo do item 3: a posição dentro do ambiente é local, em
metros. Para desenhar o ponto no minimapa é preciso saber onde esse metro cai no mundo.
Com a transformação do item 3 resolvida, o minimapa vira trabalho de interface; sem
ela, não há o que sincronizar.

### Também fora

- **LOD por blocos** e os botões de desempenho por parâmetro de URL — andaime de
  medição do protótipo.
- **`collision.glb`** e a tecla `V` que alternava entre o splat e a malha de colisão —
  depuração.
- **Screenshot e salvar câmera** dentro do viewer.
- **Viewshed** dentro do viewer.

## Dependência nova

O motor é o **`@manycore/aholo-viewer`** (licença MIT, Manycore Technology). É a única
dependência nova deste módulo.

```bash
npm install @manycore/aholo-viewer
```

O `@manycore/aholo-splat-transform` é ferramenta de linha de comando do pipeline de
assets, não do aplicativo — instale-o só na máquina que gera as cenas, e por
`npx splat-transform`.
