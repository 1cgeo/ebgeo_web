# Frente: peso (payload ansioso de index.html)

Worktree `C:\Users\diniz\ebgeo_hunt\peso`, branch `hunt/peso`. Dois commits: `cf15ca89`, `0d2f40f3`.

## Régua

`payloadDe` de `frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js` (todo `.js` referenciado
por `src=`/`href=` em `dist/index.html`, fora `/vendors/`; soma as passadas moderna E legacy).
Atribuição por módulo: bytes gerados de cada chunk atribuídos à fonte pelo `mappings` do `.js.map`.
Teto 4170 kB = até 4270591 bytes (a régua arredonda).

## Série medida (build fresco em cada commit, mesma régua)

| commit | arquivos | bytes | kB | delta (B) | o que entrou (bytes construídos, passada moderna salvo indicação) |
|---|---|---|---|---|---|
| b0a199bc | 77 | 4218979 | 4120 | | linha de base (o commit dizia 4218590) |
| 1c3c19c9 (66a0f53f) | 78 | 4220996 | 4122 | +2017 | migração que se conserta: `migration-recovery-phrases.js` +2147, `transicao-resiliente.js` +1322 (novo) |
| 60cffae3 | 81 | 4246394 | 4147 | +25398 | lote do dono: `vista-da-pessoa*` +4110, `carga-sob-demanda*` +4002, presença +5400 (M+L), `tile-expiry-guard.js` +1307; modal de recurso partido (+22843 núcleo, −22294 entrada = +549); resto <1 kB cada |
| e753a0ae | 81 | 4250535 | 4151 | +4141 | símbolos de engenharia: registro/estilos/toolbar, nada >600 B; o grupo militar continua fora do boot |
| b4ac6076 (+0e106bc9) | 82 | 4259432 | 4160 | +8897 | `feature-creation-context.js` +1391, export opcional +1400, `ebgeo-missing-images.js` +620, +2947 de CSS pela legacy |
| 8e5865d9 | 83 | 4267413 | 4167 | +7981 | `session/ambiente-do-navegador.js` +7870 (deliberado: o capturador de erro o lê síncrono) |
| d4dd1475 | 84 | 4269197 | 4169 | +1784 | telemetria de uso |
| cd6498d2 | 84 | 4269738 | 4170 | +541 | mapa base inicial. ÚLTIMO VERDE, a 853 bytes do teto |
| e848a09e | 84 | 4271643 | 4172 | +1905 | recuperado: `legacy-cleanup.js` +1013, `abrir-recuperado.js` (novo). PRIMEIRO VERMELHO |
| a3e9b27f | 84 | 4271647 | 4172 | +4 | |
| 5933a7c2 | 84 | 4285690 | 4185 | +14043 | luminosidade: `luminosidade-phrases.js` +4069, menu +1203, +7588 de CSS pela legacy |
| 5379fc3e | 84 | 4292069 | 4191 | +6379 | meteorologia: `meteorologia-phrases.js` +3555, CSS |

Total +73090 bytes. Nenhum módulo de `src/` do payload está fora do grafo ESTÁTICO a partir de
`src/js/index.js` (conferido pelos `sources` dos mapas contra o caminhador): nenhum chunk lazy vaza
por regra de `codeSplitting`. O crescimento é todo de import estático, quase todo legítimo.

## Achado de instrumento (não corrigido, decisão do coordenador)

`main-legacy-*.js` (640 kB) é 522 kB de CSS (a folha inteira do mapa, byte a byte o `main-*.css`,
embutida como string pela passada legacy) mais 117 kB de JS. Então todo CSS que entra em
`style.css` cresce a metade (b) uma vez, por essa porta: cerca de 13 kB dos +73 kB são CSS
(`painel-de-ponto.css` sozinho, +7,6 kB). E o navegador moderno NÃO baixa `main-legacy` nem
`polyfills-legacy` (718 kB juntos, `nomodule`/`data-src`), então "o que a pessoa de fato paga"
está superestimado nessa medida para o navegador moderno. A régua continua útil como guarda; a
prosa dela é que promete mais do que mede.

## Consertos

1. `cf15ca89` perf(map): o texto dos dois painéis de ponto sai do boot; o menu fica só com os
   rótulos. −8000 bytes (4191 → 4184 kB).
2. `0d2f40f3` perf(map): o modal de compartilhar recurso sai do boot, pela porta
   `catalog/resource-share-launcher.js`. −39508 bytes (4184 → 4145 kB). Pré-existente (não
   nasceu no intervalo), mesma classe dos três diálogos de `b0a199bc`.

Depois dos dois: 82 arquivos, 4244561 bytes, 4145 kB, 25 kB abaixo do teto, que NÃO subiu.
Outras páginas no mesmo build: atlas 682/700, admin 826/830 (apertado, pré-existente),
calibracao 2002/2020, tutorial 499/535.

---

# Segundo ciclo (23h em diante)

## Prova do 0d2f40f3 no navegador

`e01a4fd9` test(e2e): `frontend/tests/e2e-ui/catalogo-compartilhar-sob-demanda.spec.js`, Chromium + backend real:
(1) o modal NÃO é buscado no boot, é buscado no clique do `catalog-card-share`, abre, e conceder a
um grupo chega ao servidor (POST .../grants < 300, linha do grupo na lista); (2) com o módulo
abortado na rede, aparece o aviso não modal com "Recarregar" (opacidade > 0,9), nenhum modal abre,
o catálogo continua aberto. 6/6 em série (`--repeat-each=3 --retries=0`). Controle negativo com o
`catalog.modal.js` pré-0d2f40f3: os dois casos reprovam. Capturas lidas.

## Frente importar/exportar: bugs corrigidos

1. **`3cbb9a80` fix(import): Windows-1252 / ISO-8859-1 perdiam todo acento para U+FFFD.**
   Perda de dado. CSV salvo pelo Excel pt-BR, DBF brasileiro sem `.cpg`, KML/GPX com
   `encoding="ISO-8859-1"`: todo acento virava "�" em chave e valor de atributo e na descrição,
   irreversível depois de salvo. Causa: todos os leitores decodificavam como UTF-8
   (`file.text()` em `import.tab.js`, `readAsText` em `import.control.js`, JSZip `'string'`, e o
   `shpjs` sem `.cpg`). Conserto: folha nova `import_export/texto-de-arquivo.js` (BOM decide; XML
   declarado decide; senão UTF-8 se válido, Windows-1252 se não); DBF sem `.cpg` e não-UTF-8 ganha
   `.cpg` antes do `shpjs` (`_completarCpgDosDbf`). Prova: `importar-arquivo-codificacao-e-camadas.spec.js`
   (controle UTF-8 com BOM verde). Controle negativo: os 3 casos de codificação reprovam.
   Unitário: `texto-de-arquivo-importado.test.js` (limite conhecido pinado: byte-líder Latin-1
   seguido de byte 0x80-0xBF é UTF-8 válido).
2. **`f75f6d14` fix(import): ZIP com vários shapefiles importava só o primeiro.** Perda de dado
   (um tema inteiro, com toast verde). Causa: `readShapefile` fazia `result[0]`. Conserto: todos
   importados, uma camada por shapefile (`_importarLido`). Controle negativo: "Expected 3, Received 2".
3. **`5e638b79` fix(import): o nome do arquivo e as colunas reservadas sobrevivem** (decisão
   aprovada pelo coordenador). Perda de dado: `<name>` de todo Placemark KML e as colunas
   NOME/NAME/ID/TYPE/SOURCE/TEXT/SIZE/COLOR/LAYER/STATE... de SHP/GeoJSON/CSV sumiam; a feição
   nascia "Ponto #N". Causa: `extractAttributesFromImport` (`user_data_manager.js`) pulava
   SYSTEM_PROPERTIES case-insensitive (I8). Conserto: primeiro nome não vazio vira `nome`
   ("Ponto #N" é reserva); chave reservada não consumida vira `<chave>_importado` (sufixo numérico
   na colisão, nunca sobrescreve). Teste existente mudado de propósito (afirmava o descarte).
   Prova: `importar-nome-e-chaves-reservadas.spec.js` (KML e SHP). Controle negativo: "Expected
   Base Alfa, Received Ponto #1".
4. **`6d71dda0` fix(kmz): nosso KMZ volta campo a campo; KML de terceiro sem lixo de estilo.**
   Corrupção/perda de dado. Medido: toda descrição voltava "[object Object]" (CDATA vira objeto no
   togeojson); todo ponto ganhava 5 atributos-lixo (styleUrl, icon, icon-scale...); nenhum estilo
   voltava. Conserto: `.value` do CDATA; `descricao`/`nome` (ExtendedData nosso) vencem
   `description`/`name`; balão gerado marcado `data-ebgeo="balao"` e ignorado na volta; estilo
   próprio viaja em `ebgeo_estilo` (JSON) e é restaurado só nas chaves que a ferramenta declara;
   chaves de estilo do togeojson descartadas salvo as declaradas no ExtendedData. Folha nova
   `import_export/estilo-importado.js`. Prova: `kmz-ida-e-volta-campo-a-campo.spec.js`. Controle
   negativo: 2/2 vermelhos. Os três specs de import juntos: 9/9.

`teto-de-peso-da-pagina-do-mapa.test.js` fica VERMELHO só por orçamento (regra do coordenador):
import_export 18 ansiosos contra 16 (as duas folhas novas), grafo completo 797 contra 795.

## Confirmados e NÃO corrigidos

- "Simular linhas tracejadas" (ligado por padrão) corta a linha tracejada em traços; o KMZ
  reimportado vira dezenas de feições (156 para 3). Proposta: com `ebgeo_estilo`, escrever também a
  geometria original e a importação preferi-la. Decisão de formato.
- `observations` (array) de linha/polígono não viaja no KMZ. Não medido na tela.
- Estilo de KML de terceiros (stroke/fill) não é aplicado aos campos nativos: não havia caminho de
  estilo na importação (nem GeoJSON simplestyle), então só é descartado. Proposta ao dono: mapear
  stroke/stroke-width/stroke-opacity/fill/fill-opacity para lineColor/lineWidth/opacity/fillColor
  quando não houver `ebgeo_estilo`.

## Suspeitas não confirmadas

- KMZ com vários `.kml` internos pega o primeiro por ordem do zip, não `doc.kml`. Não medido.
- `tab-lock-refutacao.test.js` 3.5 reprovou uma vez na suíte cheia sob carga, 3/3 isolado.

## Livro-razão (propostas)

- `2026-09-23 | importar | todo leitor de arquivo importado decodificava como UTF-8; CSV do Excel, DBF sem .cpg e KML ISO-8859-1 perdiam os acentos para U+FFFD | texto-de-arquivo.js + importar-arquivo-codificacao-e-camadas.spec.js`
- `2026-09-23 | importar | ZIP com vários shapefiles importava só o primeiro, com toast verde | caso "ZIP com DOIS shapefiles"`
- `2026-09-23 | teste-que-nao-prende | "drops system properties" PRENDIA a perda do nome e de ID/TYPE/NOME | user-data-atributos-de-importacao.test.js + importar-nome-e-chaves-reservadas.spec.js`
- `2026-09-23 | kmz | a ida e volta do nosso KMZ nunca tinha sido medida: "[object Object]", lixo de estilo, estilo perdido | kmz-ida-e-volta-campo-a-campo.spec.js`

## Depois da revisão do coordenador (00h)

- `1ef0095d` fix(import): shapefiles de um ZIP compartilham a numeração "Ponto #N" (o 2º recomeçava
  em #1; contadores lidos do mapa antes do despachante esvaziar). Controle negativo: #1,#2,#1.
- `904ab241` test(e2e): `importar-em-atlas-remoto-par-recebe.spec.js`, dois navegadores, atlas de
  servidor: KML ISO-8859-1 (nome, CDATA, ID, Style) e ZIP com dois shapefiles chegam ao par com o
  mesmo id, nome, descrição, atributos e camada. 1/1.
- `10c485ac` fix(import): regressões de `texto-de-arquivo.js` apontadas na revisão: (a) XML com
  `encoding="utf-16"` e bytes de 8 bits virava CJK; (b) ISO-8859-1 declarado com bytes UTF-8 saía
  "SÃ£o"; (c) UM byte inválido virava o arquivo inteiro (e o DBF via `dbfPrecisaDeCpg`) em 1252.
  Regra nova: BOM; senão UTF-8 quando as sequências multibyte válidas superam os bytes inválidos
  (`contarSequenciasUtf8`/`pareceUtf8`); senão a codificação de 1 byte declarada (nunca UTF-16) ou
  Windows-1252. Teste mal nomeado corrigido. Controle negativo: os 4 casos REGRESSION reprovam.
- `17feca87` fix(import): leitor de ZIP camada a camada (`_lerShapefileZip`): `.json` de metadados
  não derruba mais o shapefile (antes da revisão importava 0 de 1); `.cpg` passado ao `shp()` sem
  regerar o ZIP (medido: 190 ms e +53 MB de cópia para um DBF de 48 MB); `.prj` ilegível recusa
  nomeando a camada; falha na 2ª camada diz o que entrou. Controle negativo: 0 de 1 importado;
  mensagem parcial ausente.
- `e0c6f96c` fix(catalog): duplo clique no "Compartilhar" do cartão abria dois modais empilhados.
  Repro determinístico (módulo segurado na rede): "Expected 1, Received 2" antes; 6/6 depois. O
  cabeçalho do spec deixou de citar hash do branch.

Flakes vistos só na suíte cheia sob carga, verdes isolados: `docs-integridade` (símbolo),
`idb-decisao4-medicao`, `tab-lock-refutacao` 3.5.
- `c6d0cc1a` fix(polygon): polígono importado com buraco perdia o buraco ao ser colado, arrastado ou
  editado (toda regeneração a partir de `baseCoordinates`, que só guarda o anel externo). Perda de
  dado sincronizada. `AddPolygonGeometry.comAneisInternos` leva os anéis internos (transladados
  pelo mesmo deslocamento) nos seis sítios. Prova: `poligono-importado-com-buraco.spec.js`
  (Ctrl+C/Ctrl+V e arraste pelo mouse); controle negativo: "Expected 2, Received 1" nos dois.

## Não medido / fora

- KMZ de símbolo militar, medida de coordenação e texto voltam como ponto genérico (o KML não tem
  esses tipos); o estilo JSON só restaura as chaves que a ferramenta de ponto declara.
- KMZ com vários `.kml` internos (pega o primeiro por ordem do zip): suspeita, não medida.
- GeoPackage: o produto não importa nem exporta (não há leitor).

---

# Terceiro ciclo: matriz de papéis na interface (02h-03h)

Método: sonda temporária (apagada) dirigindo, em atlas de servidor com dono + par, cada papel
(Leitor, Comentarista, Editor) e o visitante de link público pelos gestos reais (barra, abas
Camadas/Mapas/Briefings/Importar, painel de feição, Delete, Ctrl+Z/Y, Ctrl+C/V, menus de contexto,
arrastar, soltar arquivo), lendo o censo da fila (`countByState`) e as feições da store antes e
depois. PIOR CASO (op enfileirada que o servidor recusa): NENHUM encontrado; fila 0/0/0 em todos os
papéis e no visitante depois de todos os gestos; o Delete/Ctrl+Z/Ctrl+V/soltar do Leitor, do
Comentarista e do visitante param na store com "Seu nível neste atlas não permite editar.".

## Corrigidos

- `242b3ff9` fix(maps-tab): "Novo mapa" aparecia para Leitor e Comentarista (e visitante). Duas
  causas, as duas necessárias: `_updateActionsVisibility` rodava ANTES de o botão existir (o
  primeiro passe está em `_createActionsGrid`) e só voltava com evento de sessão/conexão; e
  `.sidebar-section-header-btn { display: flex }` vence o atributo `hidden`. Spec
  `matriz-de-papeis-aba-mapas.spec.js` (read e comment; dono como controle positivo) afirma
  VISIBILIDADE. Vermelho antes; controles: só CSS → visível; só JS → visível.
- `38ba5069` fix(maps-tab): "Importar" (aditivo) num atlas de servidor abria o seletor de arquivo e
  só recusava depois do arquivo escolhido. Recusa agora no clique, com a mesma frase
  (`ExportImportService.recusarImportAditivoNoServidor`). Controle negativo: vermelho.

## Observações (não corrigidas)

- A tabela de atributos some para o Leitor E para todos no mapa travado (`.map-locked
  .table-toggle { display:none }`), embora a tabela tenha modo somente-leitura
  (`readOnly: semEdicaoSync()`) que assim fica inalcançável pelo botão. Decisão de produto.
- Comentário: o UPDATE do servidor nunca atualiza as colunas `lng`/`lat` (só o `data`); o retrato
  lê do `data`, então a posição movida sobrevive. Colunas ficam velhas para quem as ler direto.
- Sonda do Editor inconclusiva em dois pontos (o Delete com o painel aberto não excluiu; o menu de
  contexto não abriu com a feição selecionada): provável interação do instrumento, não medido.

## Livro-razão (proposta)

- `2026-09-24 | posto | "Novo mapa" gateado por `hidden` que nunca chegava à tela (passe antes do botão existir, e display:flex vencendo [hidden]) | matriz-de-papeis-aba-mapas.spec.js afirma visibilidade, não atributo`

## Tarefa curta: toast de disco na transferência de camada (03h)

- `d629432c` fix(transfer): o ramo `target_write_incomplete` de `transferLayerToMap` emitia
  `STORE_PERSIST_ERROR`, cujo ouvinte diz "Verifique o espaço disponível no navegador" (causa que o
  código não conhece: falha de IndexedDB LANÇA e é o outro ramo). Agora relata à telemetria
  (`causa: target_write_incomplete`) e a frase da transferência deixou de afirmar "Nada saiu da
  origem" (falso num atlas de servidor, onde as intenções já gravadas movem a camada).
  Teste que prendia o defeito mudado; vermelho antes, verde depois.
- (2) NÃO reproduziu: addMap + mover 100 feições na hora, atlas de servidor: sucesso, 100
  movidas, sem toast de disco (300: sucesso + só o aviso de B6.1). Spec
  `transferir-para-mapa-recem-criado.spec.js` fica como guarda. Provável artefato do teste da
  frente de desempenho (feições semeadas de outro jeito).
