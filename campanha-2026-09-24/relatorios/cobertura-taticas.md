# Cobertura: ferramentas táticas, de análise, medição e seleção

Worktree `C:\Users\diniz\ebgeo_hunt\producao`, branch `hunt/cob-taticas` (a partir do `integracao_backend` `c777d8c5`). Portas padrão (4321/3912). Atualizado 09:55 (PAUSA pedida pelo coordenador).

Legenda: **UI** cliques reais; **EV** `page.evaluate` com import do store; **1u/2u** um ou dois usuários; **L** atlas local; **S** atlas de servidor. "LACUNA" = nenhum spec de navegador afirma a etapa (conferido abrindo os specs, não pelo nome). `sp/` = `frontend/tests/e2e-ui/`.

## Commits no `hunt/cob-taticas` (todos verificados: lint + vitest + spec verde + controle negativo nos `fix`; desde `0d0cf58d` o vitest dá 16059/16060, com o único vermelho no `teto-de-peso` (a), deixado assim pela regra)

| Commit | Tipo | O quê | Prova |
|---|---|---|---|
| `7a958d37` | fix(kmz) | Viewshed saía no KMZ como polígonos brancos opacos (sem `<PolyStyle>`; o KML preenche de branco) | `frontend/tests/unit/kmz-viewshed-preenchido.repro.test.js`; controle negativo das duas metades |
| `f599dde1` | fix(pdf) | Declinação magnética não entrava na legenda do PDF (buraco declarado no censo do registro; censo atualizado) | `sp/pdf-legenda-declinacao.repro.spec.js` (texto do canvas; controle "Pontos (1)"); controle negativo |
| `08e64c0e` | fix(selection) | "Selecionar" (retângulo) selecionava feições de CAMADA TRAVADA e Delete as apagava em lote (perda de dado protegido) | `sp/selecao-retangulo-camada-travada.repro.spec.js` (controle: camada destravada seleciona 2); antes {2 selecionadas, 0 restantes}, depois {0, 2} |
| `3546c7c5` | test(military) | Cobertura das 4 ferramentas de símbolo, 2u S, criar→raster do colega (SHA-256)→Tamanho→atributo→arrastar→Ctrl+Z→F5 nos dois→excluir | `sp/cobertura-simbolos-taticos.spec.js` 4/4 |
| `0823916a` | fix(layers) | Área salva pela régua (`measure:true` em polígono) fazia `restoreMeasurements` lançar no boot e as visadas com "Mostrar Medição" perdiam o rótulo no F5 | `sp/medicao-salva-e-rotulo-da-visada.repro.spec.js` (controle sem a área: rótulo volta); controle negativo |
| `9c783465` | test(analysis) | Viewshed 2u S: Raio, Abertura, Opacidade, excluir, Ctrl+Z da exclusão, saída do colega coerente com `deriveAnalysisOutput` | `sp/cobertura-viewshed.spec.js` 3/3 em série |
| `0f457f0a` + `1e471c05` | fix(measurement) | Linha salva pela régua só ganhava o rótulo de comprimento depois do F5 (comentário encurtado depois para caber no teto de fonte) | `sp/medicao-salva-mostra-rotulo.repro.spec.js` (controle: o rótulo existe depois do F5) |
| `0d0cf58d` | fix(measurement) | Leitor via "Salvar como feição" (o posto não escondia o comando; só a trava) | `sp/medicao-salvar-por-papel.repro.spec.js` (controle: o dono vê). **Deixa `teto-de-peso` (a) vermelho: 11931 kB contra 11930**, números intocados pela regra |
| `e6342e47` | test(analysis) | Visada 2u S: Altura do Alvo, Amostragem, excluir, Ctrl+Z e Ctrl+Y da exclusão, saída do colega coerente | `sp/cobertura-visada.spec.js` 3/3 |
| `56eeae47` | test(temporal) | Janela temporal pelo painel (Início e Fim) 2u S, colega, F5 nos dois, Fim apagado some nos três lugares | `sp/cobertura-janela-temporal.spec.js` 3/3 |
| `6535d5b2` | test(measurement) | Réguas contra a geodésia (m/km/NM/ft, área+perímetro+ha, ângulo °/mil/gon), Limpar, e Salvar como feição 2u S com F5 nos dois e exclusão pelo colega | `sp/cobertura-medicao.spec.js` 4/4 |
| `4aaf5b13` | test(military) | Ctrl+C/Ctrl+V pela UI das 4 ferramentas de símbolo, 2u S: id novo no Postgres, o colega desenha para o id NOVO o mesmo raster (SHA-256), também depois do F5 dele | `sp/cobertura-colar-simbolos.spec.js` 4/4 |
| `602003ce` | test(kmz) | KMZ pela porta real (aba Exportar) dos 4 símbolos: `<Placemark>` com o nome, `<Icon><href>` para um PNG que existe no zip, assinatura PNG, largura > 8 | `sp/cobertura-kmz-simbolos.spec.js` 1/1 |
| `91e218de` | test(selection) | Retângulo pelos dois cantos sobre ponto+linha+símbolo, Delete com confirmação chega ao Postgres e ao colega, UM Ctrl+Z traz os três nos três lugares | `sp/cobertura-selecao-retangulo.spec.js` 1/1 |
| `5e7d33b8` | test(military) | SIDC trocado pelo campo do modal "Configurar Símbolo" (amigo 03 para hostil 06), 2u S: raster do autor muda, o do colega fica igual (SHA-256), F5 nos dois | `sp/cobertura-sidc-colega.spec.js` 1/1 |
| `639c66dd` | test(temporal) | Trajetória pelo editor ("Adicionar no mapa", dois cliques, Concluir), 2u S: igual no Postgres e no colega, F5 nos dois | `sp/cobertura-trajetoria-colega.spec.js` caso 1 |
| `50190d23` | test(temporal) | Arrastar o símbolo com rota leva a rota INTEIRA (E7) ao Postgres e ao colega; o ponto de descida evita a alça da âncora, com controle do instrumento | `sp/cobertura-trajetoria-colega.spec.js` caso 2; 4/4 em série (os dois casos); controle negativo (sem `translateKeypoints` o caso reprova no kp 1) |
| `5dddd955` | fix(move) | Arrastar uma feição selecionada ANTES da edição do colega devolvia a edição (o ponto-chave que ele removeu, o nome que ele trocou): o arrasto grava a feição inteira a partir da cópia da seleção. Dois caminhos: `move_handler.js` (todas as ferramentas) e o ramo de âncora de `_persist` (`trajectory-edit-control.js`). Conserto: o arrasto relê a store antes de calcular (`rebaseOnStored`, `pending-edit.helpers.js`), e o ramo de âncora grava por `updateFeature({ transform })` sob a trava do documento, com o diff da rota | `sp/trajetoria-arrasto-copia-velha.repro.spec.js` 3/3 Chromium e 3/3 Firefox; controles negativos (sem o rebase: casos 1 e 3 vermelhos; ramo de âncora antigo: caso 2 vermelho); unit `pending-edit-helpers` 19/19; regressão de arrasto 49/50 (o vermelho é o flake de Declinação abaixo). Teto de peso (a): 11937 kB contra 11930, deixado vermelho |

## Matriz

### Símbolo Militar / Medida de Coordenação / Símbolo de Engenharia / Declinação Magnética

| Etapa | Militar | Coordenação | Engenharia | Declinação |
|---|---|---|---|---|
| a criar (UI) | `drawing-persistence:29` 1u L; `cobertura-simbolos-taticos` 2u S | `drawing-persistence:21`; cobertura | `engineering-symbol-lifecycle:12`; `-collaboration:29`; cobertura | `drawing-persistence:22`; cobertura |
| b campos próprios | parcial: Designação (`symbol-selector-undo:14`), GDH auto (`browser-temporal-advanced:223`); SIDC pelo campo do modal 2u S: `cobertura-sidc-colega`; dimensão/escalão/modificadores/cor/engajamento pelos seletores: LACUNA | parcial: Identificação; tipo/FT/escalão/cor/GDH/número: LACUNA | Classe da ponte; outros símbolos/variante/cor: LACUNA | quadro "Diagrama de Nortes": LACUNA |
| c estilo (Tamanho) | coberto `cobertura-simbolos-taticos` 2u S | idem | idem | idem |
| d atributos | coberto idem | idem | idem | idem |
| e mover (arrasto) | coberto idem | idem | idem | idem |
| f duplicar/colar | Ctrl+C/Ctrl+V UI 2u S, raster do colega: `cobertura-colar-simbolos` | idem (antes só `colar-registra-imagem-por-feicao:149` 1u L EV) | idem | idem |
| g excluir | coberto idem | idem | idem | idem |
| h desfazer | modal (`symbol-selector-undo`); arrasto: coberto idem | idem | idem | idem |
| i colega vê raster | coberto idem (SHA-256) | idem | idem | idem |
| j F5 nos dois | coberto idem | idem | idem | idem |
| k atlas local | `drawing-persistence`, `drawing-delayed-other-map-switch` | idem | lifecycle | idem |
| l KMZ / PDF | KMZ: `cobertura-kmz-simbolos` (Placemark + PNG); PDF: LACUNA | KMZ idem; PDF LACUNA | KMZ idem; PDF LACUNA | KMZ idem; PDF legenda: fix `f599dde1` |

### Linha de Visada e Visibilidade (terreno sintético `sp/helpers/analise-terreno.js`)

| Etapa | LOS | Viewshed |
|---|---|---|
| a criar | `analise-processada-round-trip:531` 1u; `browser-collab-analise-derivada:138` 2u | `analise-processada:606`; `derivada:158` |
| b parâmetros | Altura do Observador (`browser-collab-analise-edicao:32`); Altura do Alvo, Amostragem: `cobertura-visada` | Altura do Observador (`edicao:49`); Raio, Abertura: `cobertura-viewshed`; Altura do Alvo: LACUNA |
| c estilo | Largura (`browser-collab-analise-painel-aberto:25`); "Mostrar Medição" + F5: `medicao-salva-e-rotulo-da-visada` 1u; Opacidade, Perfil: LACUNA | Opacidade: `cobertura-viewshed` |
| d atributos | LACUNA | LACUNA |
| e mover | alça do alvo (`desfazer:119`); alça do observador: LACUNA | alças: LACUNA |
| f colar | fora por desenho (`copiable:false`), sem spec da recusa | idem |
| g excluir | `derivada:223` 2u; `cobertura-visada` | `cobertura-viewshed` |
| h desfazer | `desfazer:157`; Ctrl+Z e Ctrl+Y da exclusão: `cobertura-visada` | Ctrl+Z da exclusão: `cobertura-viewshed` |
| i colega vê | `derivada:175` | `derivada:178` |
| j F5 nos dois | `derivada:202` | `derivada:208` |
| k atlas local | `analise-processada:658` | idem |
| l KMZ / PDF | LACUNA e2e | KMZ: fix `7a958d37` (vitest); PDF LACUNA |

### Temporal / trajetória

| Etapa | Cobertura |
|---|---|
| criar trajetória | `browser-temporal-advanced:153` 1u UI |
| janela da feição | Início e Fim pelo painel, 2u S, F5 nos dois, Fim apagado: `cobertura-janela-temporal`; D+N, tempo do ponto-chave, "Limpar": LACUNA |
| config do mapa | `temporal-engrenagem-copia-velha.repro:52` 2u |
| criar pelo editor 2u S | `cobertura-trajetoria-colega` caso 1 (Postgres, colega, F5 nos dois) |
| mover trajetória | remover vértice (`browser-collab-trajetoria-mapa.repro:47`); mover a feição com a rota (E7) 2u S: `cobertura-trajetoria-colega` caso 2; arrastar vértice, inserir pelo ponto médio: LACUNA |
| colega vê | config e ponto-chave: cobertos; janela editada no painel: `cobertura-janela-temporal`; rota criada pelo editor e rota arrastada: `cobertura-trajetoria-colega` |
| F5 | janela da feição: `cobertura-janela-temporal`; trajetória: `cobertura-trajetoria-colega` caso 1 |
| reprodução / cursor | `temporal-local` 1u |
| reagendar, desfazer, colar | LACUNA e2e |

### Réguas

| Etapa | Distância | Área | Ângulo |
|---|---|---|---|
| medir e VALOR | `cobertura-medicao` (geodésia) | idem (área+perímetro) | idem (°, mil, gon) |
| unidades | coberto (m, km, NM, ft) | coberto (ha) | n/a (três simultâneas) |
| Limpar | coberto | LACUNA | LACUNA |
| Escape / X / menos de 2 vértices | LACUNA | LACUNA | LACUNA |
| Salvar: papel | Leitor não vê o botão: `medicao-salvar-por-papel` (fix `0d0cf58d`) | idem (mesmo conserto) | n/a |
| Salvar: rótulo | nasce com o rótulo: `medicao-salva-mostra-rotulo` (fix `0f457f0a`) | polígono não tem rótulo de medida (por desenho) | n/a |
| Salvar como feição | `measurement-duplicate-save`, `-delayed-save` 1u L; `cobertura-medicao` 2u S (nome, cor, measure, servidor, colega, F5 nos dois, exclusão pelo colega) | 1u L; 2u: LACUNA | n/a |
| feição salva: estilo/atributos/mover/colar/desfazer/KMZ/PDF | LACUNA (proxies de linha genérica) | LACUNA | n/a |

### Informações da Carta

Só ativação/cursor/Escape (`toolbar-cursors:12`). Clique que abre o painel EDGV (exige estilo publicado com camadas `edgv_`), menu de várias camadas, servidor ausente (silencioso), `features.vector_info=false`: LACUNA.

### Selecionar (retângulo)

Dois cliques de canto e camada travada: `selecao-retangulo-camada-travada` (1u L). Três tipos (ponto, linha, símbolo), Delete, colega e UM Ctrl+Z: `cobertura-selecao-retangulo` (2u S). Os demais tipos, as outras ações (mover, estilo em lote), grupo travado, mapa travado: LACUNA.

## Suspeitas do código ainda não provadas

- DESCARTADA: "Azimute e Distância fica fora da caixa" (as feições guardam `properties.source` = 'point'/'line'/'polygon', e `featureType` = 'azimuth_distance'; a caixa as pega como linha/ponto/polígono).
- A feição salva pela régua não fica selecionada (cosmético, não provado).
- `deleteSelectedFeatures` não reconfere a trava (defesa em profundidade; o retângulo já foi consertado).
- Informações da Carta com servidor de tiles ausente: silêncio total.
- ABERTO, flake no MEU spec: `sp/cobertura-simbolos-taticos.spec.js` caso Declinação Magnética reprova cerca de 1 em 3 ("Ctrl+Z nao desfez o arrasto" ou "o arrasto nao moveu a feicao"), medido 2/6 no HEAD sem o conserto `5dddd955` e 1/5 com ele. As outras três ferramentas do mesmo arquivo passam. Pode ser defeito real do arrasto ou do desfazer da declinação; não investigado ainda.
- Conferido e NÃO é lacuna: o "Descartar" do painel já relê a store (`discardTargets`, `tool_manager/helpers/discard-targets.helpers.js`), e `updateSelectedFeatures` só é chamado pelo arrasto; no controle de símbolo militar não sobrou outra escrita da feição inteira a partir da seleção.
- OBSERVAÇÃO DE UX (não é defeito de código, é pergunta ao dono; o dono APROVOU o conserto em 2026-09-24, em obra): com um símbolo com rota selecionado, a alça 0 da rota fica EXATAMENTE no centro do símbolo, que é onde a pessoa pega para arrastar. Descer ali move só a partida (kp 0) e a feição vai junto, deformando a rota, que é o gesto declarado de `trajectory-edit-control.js`; arrastar por qualquer outro ponto do ícone leva a rota inteira (E7). Os dois gestos são legítimos e ficam separados por poucos pixels. A primeira versão do caso 2 caiu nesta armadilha e leu a deformação como regressão do E7; o que separou os dois foi instrumentar `updateFeatureForMove` (não foi chamado) e ver `updateFeatures` receber a rota já deformada, vinda do editor.

## PRÓXIMO PASSO (exato, para retomar)

1. `cd C:\Users\diniz\ebgeo_hunt\producao` ; `hunt/cob-taticas` com HEAD `5dddd955`. Portas 4321/3912 livres (nenhum processo meu vivo).
2. NÃO COMMITADO, não verificado: `frontend/tests/e2e-ui/alca-da-partida-anel.repro.spec.js` (repro do pedido de UX do dono: pegar o CORPO do símbolo move a rota inteira, e a partida continua editável). Estado: o spec ainda não chega ao gesto, porque a espera "o editor desenhou as alças" conta 1 alça de vértice em vez de 3 (`queryRenderedFeatures` na camada `trajectory-edit-vertex-layer`, depois de semear a rota pela store, F5 e `selectFeatureUI`). Primeiro passo: descobrir por que só 1 (rota fora da tela no zoom 14? a seleção pegou a feição antes de a rota chegar à fonte?), talvez trocando a espera pela contagem de `trajectory-edit-handles` via `getSource().getData()`.
3. Depois, o conserto escolhido (ainda NÃO escrito no código): a alça da partida vira um ANEL. Na camada de vértice, para `index` 0: `circle-radius` 16, preenchimento transparente (`circle-opacity` 0), traço verde de 4 px, rótulo "1" deslocado para cima do anel, em verde com halo branco. Em `_queryHandle` (e no menu de contexto), o vértice 0 NÃO conta quando o ponteiro está a menos de ~12 px do centro, e o miolo fica com o corpo da feição (o arrasto do `move_handler`, rota inteira). No arrasto do anel, compensar o deslocamento da pegada (só para o índice 0), para a partida não saltar 18 px até o ponteiro. Motivo da escolha, para o relatório: esconder a alça tira da pessoa a edição da partida, que não tem outra porta (o painel não edita posição); deslocá-la separa a alça do ponto que ela representa; o anel mantém a alça onde a partida está, à vista, e libera o centro para o corpo. É a opção de menos código (três expressões de pintura, um filtro de distância e a compensação).
4. Provas que faltam: o repro vermelho antes do conserto (caso 1, pegar pelo centro, move só a partida) e verde depois; o caso 2 (o anel move só a partida, sem salto) verde; controle negativo (tirar o filtro do miolo deixa o caso 1 vermelho); Chromium e Firefox (`--project=firefox`); captura do Playwright com o anel desenhado, com a imagem LIDA, e o spec temporário apagado; unit da função pura de distância; e ATUALIZAR dois specs que hoje evitam a alça no centro: `sp/cobertura-trajetoria-colega.spec.js` caso 2 (passa a pegar pelo centro) e `sp/trajetoria-arrasto-copia-velha.repro.spec.js` caso 2 (passa a pegar o anel a 18 px).
5. Depois disso: investigar o flake de Declinação (item ABERTO acima) em série, `npx playwright test cobertura-simbolos-taticos -g Declina --repeat-each=8 --retries=0 --workers=1`.
6. Rodar sempre de `frontend/`: `npx playwright test <spec> --retries=0 --workers=1`; antes de commitar `npx eslint <arquivos> --max-warnings 0` e `npm test` em comando separado (`teto-de-peso` (a) vermelho em 11937 contra 11930, esperado; `docs-integridade`, `espera-do-playwright`, `tab-lock-refutacao`, `ws-client` e `tela-de-recuperacao` oscilam sob carga e passam sozinhos).

## Linhas propostas para o livro-razão / docs

- 2026-09-24 `premissa-inventada` [cob-taticas] "Salvar como feição" da régua perguntava só pela trava do mapa, e um Leitor via o comando. Codificado em `sp/medicao-salvar-por-papel.repro.spec.js`.
- 2026-09-24 `teste-que-nao-prende` [cob-taticas] A linha salva pela régua nascia sem o rótulo de comprimento e só o ganhava no F5; os dois specs de Salvar só contavam feições. Codificado em `sp/medicao-salva-mostra-rotulo.repro.spec.js`.

- 2026-09-24 `teste-que-nao-prende` [cob-taticas] O KMZ exportava o viewshed como mancha branca opaca: `processed_visibility` caía no padrão LINHA. Codificado em `frontend/tests/unit/kmz-viewshed-preenchido.repro.test.js`.
- 2026-09-24 `premissa-inventada` [cob-taticas] O retângulo de seleção perguntava só por `bloqueado` e ignorava a trava da camada que o clique respeita; Delete apagava a camada travada. Codificado em `sp/selecao-retangulo-camada-travada.repro.spec.js`.
- 2026-09-24 `teste-que-nao-prende` [cob-taticas] `restoreMeasurements` chamava um método que o controle de polígono não tem; a área salva pela régua apagava os rótulos das visadas no F5. Codificado em `sp/medicao-salva-e-rotulo-da-visada.repro.spec.js`.
- (doc `.claude/rules/architecture.md` §Registro de tipo de feição) O item "a declinação magnética some da legenda do PDF, em duas entradas" deixou de valer com `f599dde1`; o censo `tests/unit/registro-tipos-cobertura.test.js` já diz isso.
- 2026-09-24 `verificacao-fantasma` [cob-taticas] Um caso de arrasto de símbolo com rota desceu no centro do ícone, que é a alça 0 do editor de trajetória, mediu a deformação do OUTRO gesto (mover a partida) e a leu como regressão do E7. Codificado no controle do instrumento de `sp/cobertura-trajetoria-colega.spec.js` (alças desenhadas, ponto sobre o símbolo, nenhuma alça sob o ponto).
- 2026-09-24 `premissa-inventada` [cob-taticas] O arrasto gravava a feição inteira a partir da cópia da seleção e devolvia a edição do colega feita enquanto ela estava selecionada; os consertos da mesma classe (painel e editor da rota) não alcançavam o arrasto nem o ramo de âncora. Codificado em `sp/trajetoria-arrasto-copia-velha.repro.spec.js`.
