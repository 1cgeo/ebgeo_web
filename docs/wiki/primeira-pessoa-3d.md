# Cena de primeira pessoa 3D (Gaussian Splatting)

Percorrer a pé um ambiente interno capturado por Gaussian Splatting, com colisão por voxel, marcadores curados e trena, dentro do EBGeo. O módulo é `frontend/src/js/first_person_3d_tool/`; esta página guarda o que a leitura dele não entrega: as decisões medidas, os instrumentos que mentiram na medição, e as armadilhas cujo sintoma é sucesso plausível.

Vizinhas: [[catalogo-3d]] (a outra descoberta 3D, que o cliente nunca usou e que saiu do sistema), [[assets3d-distribuicao]] (por onde os bytes saem), [[peso-do-pacote-web]] (o que prende biblioteca no payload), [[streetview-360]] (o viewer irmão, e o precedente que esta cena segue).

## A cena é uma linha de `tilesets`, e a escolha compra três coisas de graça

Uma cena é **uma linha da tabela do catálogo `tilesets` carregando `viewer: 'firstPerson'` dentro do `config` JSONB**. `listTilesets()` (`backend/src/modules/config/config.service.js`) espalha esse `config` sobre `id` e `name`, então `basePath` e `poseInicial` viajam até o cliente sem schema novo, sem migração e sem chave nova no `/api/config` ([[config-dinamico]], [[resources-catalogo]]). O cadastro é o Painel do Administrador, aba Catálogo, ou `backend/scripts/fp-scene-register.js`, que é o mesmo POST com os campos medidos já preenchidos.

A alternativa natural, uma seção própria de config (o nome que se cogitou foi firstPerson3d, sem crase porque ele não existe em lugar nenhum do código) ou uma tabela de catálogo nova, foi rejeitada porque **as três portas que já existem só enxergam `config.tilesets`**:

- `intersectAvailability` (`frontend/src/js/store/sync/atlas-settings.service.js`) recorta `tilesets` pelo allowlist `available_3d_models`, então a restrição por atlas passa a valer para a cena sem uma linha de código ([[atlas-settings]]);
- `hasTilesets()` (`frontend/src/js/config.helpers.js`) é o que habilita o botão "Modelos 3D" (`frontend/src/js/bottom-controls/bottom-controls.control.js`). Numa seção separada o botão nasceria desabilitado num catálogo sem tileset, e o pino nunca desenharia, com o operador procurando defeito nos assets;
- o gate `config.features?.map_3d` do catálogo (`frontend/src/js/catalog/catalog.service.js`) passa a cobrir a cena, que é o que o Gestor espera do interruptor "Mapa 3D".

Fora de `config.tilesets`, a cena ficaria fora dos três em silêncio, que é exatamente a lista fechada que a constituição proíbe.

**A armadilha de premissa aqui é sutil e vale registrar, porque a versão original desta decisão errou nela.** Dizer "uma seção escrita em `frontend/src/js/config.js` seria apagada no boot" é mecanicamente falso: `deepMergeInto` (`frontend/src/js/store/sync/runtime-config.js`) preserva chave ausente no payload do servidor. A restrição continua valendo por razões melhores, e são estas: o `fileoverview` do próprio `config.js` proíbe dado de deploy ali; não haveria caminho de administração sem rebuild; e no dia em que o backend emitir a chave, o valor do cliente é substituído sem aviso. **Apostar na ausência de uma chave não é contrato.**

Não há seed e não haverá. A migração `015_remove_seeded_tileset.sql` já decidiu que o catálogo é ponto de configuração e não lugar de conteúdo de exemplo, e uma cena semeada faria toda instalação nova prometer 28,6 MB que ela não tem, com o sintoma silencioso de sempre: o pino aparece, o clique dá 404, e o viewer volta ao 2D sem dizer nada.

## Um caminho só, sete endereços derivados

A cena é declarada por um `basePath` e `resolveSceneAssets` (`frontend/src/js/first_person_3d_tool/scene-config.service.js`) deriva os sete endereços de dentro. `SCENE_LAYOUT` é o único lugar do repositório que conhece o layout da pasta.

```
<basePath>/
  cena.sog                 o modelo comprimido
  voxel/voxel-meta.json    cabeçalho do octree de colisão
  voxel/voxel.bin          o octree
  marcadores.json          o conteúdo curado
  itens/                   as fotos das fichas
  preview/                 thumbnail e clipe do card do catálogo
```

Sete endereços declarados seriam sete chances de errar um, e o erro não seria barulhento. **A pior forma disso continua possível e nenhum guarda a pega:** sem o par de voxel, `loadSceneCollision` devolve `null`, a cena abre bonita e sem colisão, e o visitante atravessa parede com o console limpo. Se um dia houver e2e da cena, ele tem de asserir que uma caminhada **para** na parede, nunca que o viewer abriu.

### `ABSOLUTE_URL_RE` é allowlist, não detector de URL absoluta

Aqui a documentação de origem afirmava o contrário e estava errada. A frase "absolutos passam intactos, inclusive `data:` e `blob:`" **é falsa**: `ABSOLUTE_URL_RE` casa apenas `https?:`, `//host` e `/raiz`. Qualquer outra coisa, incluindo `data:`, `blob:` e `javascript:`, cai no ramo relativo de `joinScenePath` e é **concatenada ao `basePath`**, virando um caminho que não resolve, em vez de ser honrada.

A escolha é deliberada e o motivo está no ponto de uso: o campo `foto` de um marcador vem de um arquivo que um operador larga numa pasta, e termina em `img.src` por `resolveMarkerPhotoUrl`. Uma gramática genérica de esquema aceitaria qualquer coisa daquele arquivo. Nada disso executa num `<img>` hoje, então a allowlist fecha uma porta e não um buraco, mas a porta leva a qualquer consumidor futuro de um caminho de cena resolvido.

Duas consequências práticas: o `foto` do marcador é relativo à **pasta da cena**, não à raiz do site (com barra na frente o navegador procura na raiz e a foto some); e o `basePath` precisa ser **absoluto desde a raiz do site**, porque `assets3dBaseUrl`, o campo que resolveria um caminho relativo, é publicado pelo backend e tem zero leitores no frontend ([[config-runtime-urls-relativas]] descreve o contrato; [[catalogo-3d]] registra que o cliente não o consome).

## As opções de motor, e os três instrumentos que mentiram

As medições estão em `createSceneViewer` e `applyEngineQualityDefaults` (`frontend/src/js/first_person_3d_tool/first_person_viewer.js`), a 1920x1080, com ruído de 2% entre repetições. O que o código não pode contar é **como quase não foram medições**:

- `requestAnimationFrame` com vsync mede o monitor: tudo dava 59,9 fps;
- `requestAnimationFrame` com a aba oculta mede o estrangulamento do Chromium;
- `requestAnimationFrame` sem vsync mede o laço de JavaScript: 1000 fps para 1,25 milhão de gaussianos.

Só há número quando existe **ponto de sincronismo com a GPU** (leitura de um pixel de volta). Antes disso, três aparelhos diferentes devolveram três respostas confiantes e erradas. Quem for remedir numa máquina fraca ou em tela grande (o custo é de preenchimento de tela, proporcional aos pixels) refaz a medida com esse ponto, não herda esta.

O que ficou ligado: contexto sem MSAA e sem `preserveDrawingBuffer` (10,8 ms para 6,8 ms, 1,59x, com 0,00% de pixels diferentes na comparação crua, ou seja, ganho sem custo); `detailCullingThreshold` zerado; e ordenação em precisão alta.

> [!DEBATE 2026-08-14] A ordenação em precisão alta está ligada por **julgamento, não por evidência**. Comparação de quadro parado não enxerga erro de ordem: o defeito aparece como troca de camada ao GIRAR. O que a medida estabelece é o custo (10% de quadro, 7,2 ms contra 7,1 ms, dentro do ruído), nunca o ganho. Fica ligada porque num acervo de instrumentos pequenos a troca de camada é visível e o custo é baixo, e fica registrado que a evidência não fecha.

O que foi testado e descartado, com o motivo que não se deduz:

- **supersampling não serve a splat gaussiano.** 0,00% de pixels alterados, energia de borda caindo, 3x o custo de quadro. Ele combate serrilha de aresta dura, e gaussiana não tem aresta: já é suave por construção. É a otimização de qualidade que parece óbvia e não tem alvo;
- meia resolução dá 2,12x, e é troca de qualidade. A decisão foi qualidade, então não há botão de resolução;
- harmônicos de grau baixo, corte de detalhe, culling de tronco e sort a 15 Hz ficaram todos dentro do ruído. Os botões que a leitura do código apontava como suspeitos não devolveram um quadro sequer, e cobram cor por direção de vista;
- o formato de empacotamento cru reprova na carga ("RawSplatData is not supported create splat"). Está anotado em `loadSplat` para ninguém tentar de novo.

## A armadilha do pipeline: a rotação vem antes da voxelização

O modelo sai do laser ou da fotogrametria com Z para cima e o modo de caminhada exige Y para cima. Se a voxelização rodar antes da rotação, **o splat e a colisão ficam em referenciais diferentes: você vê a sala e bate no nada**. O sintoma é atravessar a parede desenhada na sua frente, ou parar no meio do vão.

É a armadilha mais cara do pipeline porque **nada falha**: os dois arquivos carregam, o viewer abre, e só o corpo discorda dos olhos. A geração dos assets é ferramenta externa (`splat-transform`), fora deste repositório e fora de qualquer guarda daqui, o que é justamente o que torna a ordem perdível.

Duas notas de escala do mesmo pipeline: o voxel de 5 cm é a precisão de tudo que encosta no octree (caminhada, raio do marcador, trena), então a trena serve para a dimensão de um móvel ou de um vão, não para a cota de uma peça. E a opção de preenchimento de piso do voxelizador (floorFill, nome da ferramenta externa, sem correspondente neste código) existe porque a cobertura medida do chão foi de 91,6%: nos 8,4% restantes dá para cair pelo chão.

## Gramática de entrada: três recusas deliberadas

O protótipo fazia diferente nos três casos, e cada troca tem motivo.

**Não existe modo de ponteiro preso.** O protótipo capturava o ponteiro no clique e substituía o cursor por uma mira, no estilo de jogo em primeira pessoa. Aqui girar é sempre arrastar, e quem separa girar de clicar é o **arrasto**, não o botão: clique curto vai para o marcador e para a trena. O visitante precisa do cursor o tempo todo (rótulos, trena, barra de ferramentas, painel lateral), e ponteiro preso é um modo que se descobre por acidente e do qual se sai por acidente. A cascata do `Escape` em `frontend/src/js/first_person_3d_tool/services/keyboard-service-fp.js` não tem passo de soltar ponteiro, e isso é ausência de propósito.

**A trena é `T` e não `D`**, porque `D` anda para a direita. Pelo mesmo tipo de razão, `Ctrl` não agacha: `Ctrl+W` fecha a aba do Chrome e nenhum `preventDefault` da página cancela isso. `CROUCH_KEYS` (`frontend/src/js/first_person_3d_tool/walk/constants.js`) ficou com Shift e C. O teclado inteiro só chega à página em tela cheia, pela Keyboard Lock API, e não há tela cheia no MVP, então `Ctrl+W` continua sendo do navegador.

**O botão direito não gira nada.** Ele só fecha a medição, como no mapa 2D. Um botão que gira a câmera e também encerra a medição transforma todo arrasto com ele numa aposta sobre se a trena percebeu o movimento, então o `contextmenu` do viewer nem testa arrasto.

A trena inteira (`frontend/src/js/first_person_3d_tool/tools/measurement_tool_fp.js`) segue a gramática da medição 2D e reusa `createDistanceResultsPanel`, o mesmo card. O protótipo exigia Shift para manter a polilinha aberta e empilhava medições: era uma segunda gramática para o mesmo verbo.

O mesmo princípio governa a ficha do item: `createMarkerPanelFpContent` monta **conteúdo**, não painel, e o painel é o de feição da aplicação, alcançado por `MARKER_FP_CLICKED`, na mesma posição e moldura do 2D, do Cesium e do 360.

## O link compartilhado achou um defeito de boot que existia havia meses

`shouldRouteToProjects` (`frontend/src/js/deep-link/route-decision.js`) manda um visitante com sessão numa URL nua para `atlas.html` por `window.location.replace`, que **não carrega fragmento**. Um link `#view=` aberto por quem estava logado caía em "Seus projetos" e o payload do link evaporava, sem log e sem retentativa.

O defeito valia para `#view=3d` e `#view=360` desde sempre e ninguém viu, porque nenhuma das duas superfícies tinha "compartilhar" como ferramenta de primeira classe. Na cena o link **é** o produto (é uma das três ferramentas de dentro), e o defeito ficou intolerável na primeira semana. A correção decide por `parseDeepLink()` em vez de "o hash não está vazio", para que os três viewers e o roteador leiam a mesma gramática: hash que não nomeia viewer não é razão para pular o seletor.

A regra saiu de `frontend/src/js/index.js` para arquivo próprio pelo motivo que importa: `index.js` chama `initApp()` no import, então nada dentro dele é alcançável por teste. Regra que já errou uma vez mora onde um guarda chega ([[sessao-boot-e-ciclo-de-vida]] é dona da ordem de boot).

## Peso: quatro módulos fixados em `core` e um aviso de build aceito

O motor pesa cerca de 1,9 MB minificado e vive no grupo lazy `first-person-3d` (`frontend/vite.config.js`). Quatro módulos do mesmo diretório são fixados em `core` **porque são import estático de quem já é eager**: `frontend/src/js/first_person_3d_tool/scene-config.service.js` é alcançado pelo controle de modelos 3D, pelo catálogo e pela busca; `frontend/src/js/first_person_3d_tool/walk/voxel-collision.js` e `frontend/src/js/first_person_3d_tool/walk/constants.js` vêm atrás dele; e `frontend/src/js/first_person_3d_tool/services/keyboard-service-fp.js` é importado por `map_sig.js`, exatamente como o serviço de teclado do 3D. No chunk lazy, os quatro criariam o par circular que produz o TDZ "Cannot access X before initialization" em runtime.

Duas coisas medidas que corrigem intuições:

- **casar a pasta inteira NÃO vaza o motor para o payload eager desta árvore.** Com `entriesAware` o grupo é subdividido, e o barrel sai como subchunk próprio de ~20 kB enquanto o motor fica lazy (2486,2 kB contra 2485,3 kB de eager em `index.html`). A afirmação contrária vale para build de entrada única, não para esta. Os subcaminhos explícitos ficam mesmo assim, para declarar o que pertence ali em vez de depender de uma heurística de subdivisão desfazer um casamento errado;
- **o nome do chunk é rótulo do grupo, não do conteúdo.** Conferir carregamento tardio pelo nome do arquivo não prova nada aqui; a asserção real é pelo sourcemap, e é que nenhum chunk eager de `index.html` contém o motor.

O `npm run build` **passa a emitir o aviso de tamanho** para este chunk, contra um `chunkSizeWarningLimit` de 1200. Metade do volume é WASM em base64 dentro do motor (zstd, Draco, transcoder Basis), que não minifica nem se divide. Subir o limite desligaria o alarme para todo chunk presente e futuro, então o aviso fica, e o comentário do `vite.config.js` é o registro do porquê. Se o build "limpo" for usado como sinal, este aviso é a exceção conhecida ([[peso-do-pacote-web]] cobre o resto).

## A dependência traz duas bibliotecas fora do alcance do `npm audit`

O motor é `@manycore/aholo-viewer` (MIT), **pinado em versão exata** em `frontend/package.json`, não por acento circunflexo: o pacote publicou quinze versões em 75 dias e quebrou API em três minors seguidos. É o mesmo tratamento que `dompurify` e `quill` já recebem aqui.

Ele **não** traz uma segunda cópia do Three.js (o núcleo é motor próprio; os nomes com forma de API do Three.js são coincidência de superfície), e `frontend/src/vendor/three/` continua servindo só o 360 e a calibração.

**O que ele traz, e é o risco a registrar: `semver` e `fflate` vêm VENDORIZADAS dentro do bundle publicado.** Elas não aparecem como dependências transitivas, então um CVE em qualquer das duas **nos deixa verdes no `npm audit` com o código vulnerável embarcado**. Não há guarda para isso neste repositório; a única reação disponível é acompanhar as duas à mão e subir a versão do motor quando ele reempacotar.

## Cobertura: o que tem teste e o que não pode ter

Testável em node, e testado: o octree (`frontend/tests/unit/fp-voxel-collision.test.js`, com fast-check), a partição por `viewer` mais a derivação de assets (`frontend/tests/unit/fp-scene-config.test.js`) e a gramática do link (`frontend/tests/unit/deep-link-fp.test.js`).

Sem cobertura automatizada, e é honesto dizer em vez de fingir: o viewer, a caminhada, a projeção dos rótulos e a trena. Nada do módulo cruza o backend por operação de sync, então o e2e de contrato não prova nada dele. **E uma captura de UI contra o backend descartável do e2e produziria imagem verde vazia**, porque aquele backend não tem a linha do `tilesets`, `hasFirstPersonScenes()` devolve `false` e toda a UI nova nasce escondida. Captura de cena só vale contra o stack de dev com a cena cadastrada.

No backend, a mudança é `CONTENT_TYPES` (`backend/src/modules/nomes/assets3d.service.js`), com espelho em `backend/scripts/assets3d-import.js` que precisa andar junto. Duas entradas ali são explicitamente octet-stream (o modelo e o octree, que não têm tipo registrado e só são lidos como ArrayBuffer) e duas mudam comportamento de verdade: uma foto servida como octet-stream só renderiza porque o navegador fareja um `<img>`, e um `<video>` não fareja, então o clipe de prévia do catálogo se recusaria a tocar.

## O que ficou de fora, e o que custaria

Escopo cortado de propósito. O item que decide os outros três:

**Não há sistema de coordenadas ligando a cena ao mundo.** O ambiente é local, em metros, com origem no ponto onde a captura começou, e todo o resto do EBGeo é geográfico. Enquanto não existir uma transformação por cena (origem georreferenciada mais azimute do eixo, no mínimo, definida por quem capturou e guardada junto com a cena), três coisas não se fazem:

- **persistir feição capturada dentro do ambiente.** Guardar em metros locais é possível e cria uma segunda classe de feição, que não aparece no 2D, não entra no `.ebgeo` de forma útil e não conversa com nenhuma outra ferramenta ([[formato-ebgeo-roundtrip]]). O protótipo tinha anotações em IndexedDB puro, invisíveis para qualquer outro usuário: não foram portadas de propósito;
- **listar a cena na aba Feições**, que agrupa por tileset e aqui não teria o que listar;
- **minimapa dentro do viewer**, como o 360 tem: para desenhar o ponto é preciso saber onde aquele metro cai no mundo.

O pino roxo também não recebe badge de contagem, e as camadas de badge carregam filtro por tipo de marcador exatamente para não desenhar um zero. Tirar o filtro é trivial; o que falta é o número.

Fora ainda: briefing apontando para uma cena (o modo de slide 3D valida `slide.modelId` contra `config.tilesets` em seis pontos entre o editor e o validador de referências, e a transição entre um slide de mapa e um slide de cena não existe em nenhuma forma), tela cheia, LOD por blocos e a malha de colisão de depuração.

## Divergências conhecidas do pacote de dados

Duas, medidas contra o código em 2026-08-14, e as duas são silenciosas:

- os campos `detalhes` e `fonte` existem no arquivo de marcadores e **não são exibidos**: `createMarkerPanelFpContent` (`frontend/src/js/first_person_3d_tool/components/marker-panel-fp.js`) monta identificação, foto e descrição, e nada mais. Estão preservados no dado para uso futuro;
- a pasta de prévia do pacote atual está vazia, então a capa e o clipe dão 404 e o card do catálogo cai no desenho genérico. Não quebra nada, e resolve-se largando os dois arquivos com os nomes exatos, sem tocar em código.

