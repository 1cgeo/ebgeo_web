# Caça noturna: collab-ferramentas

Worktree `C:\Users\diniz\ebgeo_hunt\collab-ferramentas`, branch `hunt/collab-ferramentas`.
Início: 2026-09-23 21:48. Última atualização: 2026-09-24 04:26 (correções da revisão final).

Commits (em ordem): `2b05ce0c`, `346aa855`, `70f09062` (CÓPIA por cherry-pick de `1aeb1e6c`, NÃO integrar),
`13020fa7`, `c3ebab86`, `95c7474e`, `4c3ddbc3`, `0b73673d` (CÓPIA de `e1413de4` = `b7c38108`, NÃO integrar), `587b75e6`,
`6e50b429`, `8678088d`.

## Bugs corrigidos

### 1. Saída da Linha de Visada e do Viewshed nunca chega ao servidor (`2b05ce0c`, integrado como `5378da27`)

- **Severidade:** quebra funcional com perda de dado visível.
- **Sintoma:** num atlas de servidor, o par nunca vê a visada/viewshed do colega; o autor fica com "Recusas: 2"
  para sempre e perde o desenho verde/vermelho (o resync da recusa já o apaga, antes de qualquer F5).
- **Causa raiz:** a saída (`processed_los`/`processed_visibility`) nasce com id `<uuidDaEntrada>-visible` /
  `-obstructed` (`generateProcessedFeatures`), que não é UUID; o servidor recusa. A camada da entrada é pintada com
  opacidade zero, então a saída é o único desenho visível. Todos os testes de sync semeavam processed_* com UUID.
- **Conserto (decisão do coordenador):** saída DERIVADA por cliente, nunca viaja. Folha `store/analysis-output.js`,
  lista única `DERIVED_OUTPUT_BUCKET_OF` no registro de tipos, carimbo `storage` em toda op de feição, descarte por
  TIPO no despachante, derivação/cascata no caminho de entrada e no retrato, envio de atlas local sem as saídas.
- **Prende:** `browser-collab-analise-derivada.repro.spec.js`, `saida-de-analise-derivada.test.js`,
  `saida-de-analise-nao-viaja.test.js`. Controle negativo vermelho. 5/6 em série (o vermelho foi leitura única, ver S1).
- **Colateral achado depois da integração:** `applyRemoteCreateRun` (de `e52411ed`, outra frente) gravava a rajada de
  creates sem derivar; o coordenador consertou na integração (`9f399f7e`).

### 2. Editar uma visada/viewshed num atlas de servidor não sincroniza (`346aa855`, integrado como `4baf7b46`)

- **Severidade:** perda de dado (a edição some no próximo retrato do próprio autor; o par nunca a vê).
- **Causa raiz:** `batchUpdateAnalysisFeatures` (`store/feature.operations.js`), por onde passam recálculo por
  parâmetro, arraste de ponta, "Salvar" do painel e reaplicação, gravava o disco sem `tx.recordOperation`.
- **Conserto:** FEATURE UPDATE da entrada (storage: mainType) na mesma transação write-ahead, só se a entrada mudou,
  depois de `preserveUserData`/`preserveSyncMetadata`.
- **Prende:** `browser-collab-analise-edicao.repro.spec.js` (altura do observador na aba Parâmetros, visada e viewshed:
  Postgres, par, F5). 3/3 em série. Controle negativo vermelho (servidor 1.5 contra 50).

### 3. Desfazer reinsere a saída guardada, incoerente com a feição (`13020fa7`)

- **Severidade:** quebra funcional (análise desenhada no lugar errado na tela do autor, até F5).
- **Causa raiz:** `_executeUndoAction`/`_executeRedoAction` (`store/store-state-manager.js`) reinseriam as metades
  guardadas na entrada de desfazer; com `keepLaterEdits` (1aeb1e6c) a entrada pode manter a geometria do colega.
  Quando o desfazer não muda nada na entrada, não sai op e nenhum recibo re-deriva: permanente.
- **Conserto:** store op `rederiveAnalysisOutput` chamada depois de restaurar a entrada nos três tipos
  (updateWithProcessed, removeWithProcessed, moveBetweenMaps); `batchUpdateAnalysisFeatures` não grava mais entrada de
  desfazer vazia (o campo numérico commita no debounce E no blur, e o Ctrl+Z seguinte anunciava "desfeita" sem efeito).
- **Prende:** `browser-collab-analise-desfazer.repro.spec.js`. Controle negativo vermelho. `undo-redo.test.js`
  atualizado (afirmava a forma velha).

### 4. Recusas eternas de saída de análise deixadas por cliente antigo (`95c7474e`)

- **Severidade:** cosmético/operacional (contador de recusas vermelho para sempre, pendências sem decisão possível).
- **Conserto:** `isDerivedOutputOperation` (por tipo: id de metade E source de entrada) +
  `OperationQueue.discardDerivedOutputOperations` via `dequeue`, uma vez por sessão (connect e antes do flush).
- **Prende:** `saida-de-analise-nao-viaja.test.js` (caso de cliente antigo), controle negativo vermelho.

### 5. Recibo de briefing/slide perde a revisão confirmada (`587b75e6`, tarefa da revisão da integração)

- **Severidade:** quebra funcional (a 2a edição seguida de um slide, de um nome de briefing ou o 2o slide acrescentado
  é recusada como "campos disputados", vira problema durável e bloqueia o slide e, pelo batchId, o lote inteiro).
- **Causa raiz:** `applyRemoteBriefingOp` e `applyLocalSlideIntent` (`store/sync/remote-operation-handler.js`) gravavam o
  payload da op do autor por cima do carimbo que `confirmEntityVersion` acabara de escrever (no reparo do recibo), e
  gravavam a base do colega como revisão confirmada daqui (op de par).
- **Conserto:** a regra de `inboundSideEntity` (reparo do autor mantém o carimbo do disco; op de par sem base).
- **Prende:** `recibo-briefing-slide-base-confirmada.repro.test.js` (4 casos, os 4 vermelhos antes; controle negativo por
  metade). Playwright de briefing 11/11.

### 6. "Salvar" do painel da visada desfaz a edição do colega (`6e50b429`)

- **Severidade:** perda de dado (o trabalho do colega some no Postgres e nos dois clientes).
- **Sintoma:** A abre o painel da visada, B a renomeia, A muda a largura e salva: o nome volta ao antigo em todo lugar.
- **Causa raiz:** `saveFeatures` de `add_los_control.js` e `add_visibility_control.js` espalhava a cópia INTEIRA do
  painel (tirada na abertura) sobre a feição da fonte, enquanto as ferramentas de desenho aplicam só o que a pessoa
  mexeu (`mergePendingEdits`). Alcançável desde `346aa855` (a edição da visada passou a viajar).
- **Conserto:** `mergePendingEdits` nos dois controles, e a saída derivada do resultado.
- **Prende:** `browser-collab-analise-painel-aberto.repro.spec.js`. Vermelho antes, verde depois, controle negativo vermelho.

### 7. "Descartar" no painel desfaz o que o colega mudou enquanto ele estava aberto (`8678088d`)

- **Severidade:** perda de dado (18 ferramentas; o trabalho do colega some no Postgres e nos dois clientes).
- **Sintoma:** A abre o painel de uma linha, B a renomeia, A clica "Descartar" (mexendo ou não em algo): o nome de B
  volta ao antigo em todo lugar.
- **Causa raiz:** todo `discardChangeFeatures` copia o retrato de abertura por cima e GRAVA a feição inteira
  (`updateFeatures(..., save = true)`); a op sai com base atualizada e o servidor aceita.
- **Conserto:** uma vez, nos dois chamadores (`tool_manager/helpers/buttons.helpers.js` e
  `sidebar/panels/feature-panel-content.js`): o mapa entregue à ferramenta é `discardTargets` (novo
  `tool_manager/helpers/discard-targets.helpers.js`), o retrato com `keepLaterEdits(guardada, cópiaDoPainel, retrato)`.
- **Prende:** `browser-collab-descartar-painel.repro.spec.js` (o nome de B fica E a espessura prévia de A volta, no
  servidor, no store e na fonte). Vermelho antes, controle negativo vermelho.
- **Teto de peso:** `teto-de-peso-da-pagina-do-mapa` "grafo COMPLETO" vermelho SÓ por orçamento, 796 contra 795 (o
  helper novo), deixado vermelho pela regra do coordenador.

### Complementos

- `c3ebab86` test: envio de atlas local com visada (Postgres só `los`, par vê as metades, apagar tira do par).
  Controle negativo vermelho.
- `4c3ddbc3` refactor: `getProcessedType` lê a lista única; cores só em `ANALYSIS_OUTPUT_COLORS`.

## Segundo ciclo (depois do rebase em hunt/integra)

Commits: `ea0b647a`, `4b5672c6`, `9a5ccc79`, `612bab2c`.

### 8. Cortar linha / combinar ou separar setas / cortar limite não é atômico no servidor (`ea0b647a`)

- **Severidade:** perda de integridade (duplicação: original + metades sobrepostas no Postgres e nos dois clientes).
- **Causa raiz:** `splitLineAtPoint`, `boundary-split.js`, `mergeArrows`/`splitArrows` gravavam apagar e criar em transações
  separadas (um `batchId` cada); recusado o DELETE do original ("alterado antes da exclusão"), as metades entravam assim mesmo.
- **Conserto:** `withGestureBatch` nos quatro gestos, como a conversão linear.
- **Prende:** `browser-collab-corte-atomico.repro.spec.js` (A pausa o envio, corta; B renomeia; A solta). Antes: Postgres com
  "Nome do B" + "Linha #1 (1)" + "(2)". Depois: só o original renomeado, e os dois clientes convergem. Controle negativo vermelho.

### 9. Gravar atributo desfaz edição do colega feita entre a leitura e a trava (`4b5672c6`, era a suspeita S3)

- **Severidade:** perda de dado (janela de uma leitura de IndexedDB).
- **Causa raiz:** `userDataManager._updateFeature` lia o documento FORA da trava e entregava a feição inteira a `updateFeature`.
- **Conserto:** `updateFeature(..., { transform })` aplica a mudança sob a trava ao clone da feição guardada NAQUELE instante.
- **Prende:** `tests/store/atributo-le-o-documento-sob-a-trava.repro.test.js` (interleaving determinística). Controle negativo vermelho.
  Sem repro de dois navegadores: a janela é de uma leitura, o navegador só mediria a chance.

### 10. Renomear atributo customizado leva o valor que a aba desenhou, não o atual (`9a5ccc79`)

- **Severidade:** perda de dado (valor do colega some no Postgres e nos dois clientes).
- **Causa raiz:** a aba Atributos não redesenha com edição remota e passa a `renameAttribute` o valor desenhado.
- **Conserto:** `renameAttribute` leva o valor GUARDADO da chave antiga (sob a trava); o desenhado é só o fallback.
- **Prende:** `browser-collab-renomear-atributo.repro.spec.js` (antes Postgres `{altura: "1"}`, depois `{altura: "7"}`). Controle negativo vermelho.

### 11. Editor de estilo de camada de catálogo grava a cópia inteira e apaga o ajuste do colega (`612bab2c`)

- **Severidade:** perda de dado (estilo de camada de catálogo).
- **Causa raiz:** `LayerStylePanel` persistia a cópia de `styleOverrides` tirada ao abrir.
- **Conserto:** o painel registra os pares (subcamada, propriedade) que mexeu e passa a `updateCatalogLayer` uma FUNÇÃO avaliada
  sob a trava sobre o estilo guardado; "Restaurar padrão" limpa antes. `updateCatalogLayer` aceita a forma de função.
- **Prende:** `estilo-de-camada-nao-apaga-o-colega.repro.test.js` + caso da forma de função na store real. Controle negativo
  vermelho. Sem dois navegadores: o backend de teste não serve camada de dados/análise com descritor de estilo.
  `layer-style-persist-scope.test.js` atualizado (afirmava a forma de objeto).

## Ciclo extra (processamento, símbolos, trajetória)

Commits: `375b084e`, `5d96eebc`.

### 12. Remover/editar ponto da trajetória pelo PAINEL devolve o ponto que o colega removeu (`375b084e`)

- **Severidade:** perda de dado (a edição do colega na trajetória some no Postgres e nos dois clientes).
- **Causa raiz:** `createTrajectorySection` (`temporal/temporal-attributes-section.js`) edita em lugar o array da feição que o
  painel recebeu ao abrir (não redesenhado por op remota) e grava o array inteiro.
- **Conserto:** cada gesto entrega a EDIÇÃO (trocar instante / remover, casados por valor; "Limpar" = vazio) e `persist` a aplica
  por `updateFeature({ transform })` sobre a trajetória guardada, sob a trava, copiando o resultado de volta para o array.
- **Prende:** `browser-collab-trajetoria-painel.repro.spec.js` (antes Postgres [âncora, terceiro]; depois [âncora]). Controle
  negativo vermelho. `painel-temporal-recusa-janela-e-ancora.test.js`: o mock do livro-razão registra também a escrita nova.

### 13. O mesmo pelo EDITOR DO MAPA (botão direito, arraste, inserção) (`5d96eebc`)

- **Causa raiz:** `TrajectoryEditControl._persist` gravava o array compartilhado inteiro.
- **Conserto:** linha de base (ao mostrar e depois de cada escrita; `refreshDisplay` a repõe depois de uma escrita do painel); o
  gesto grava o que saiu e o que entrou desde a base, por valor, sob a trava. Continuam gravando inteiro, de propósito: o ramo da
  âncora (move a geometria na mesma escrita) e o cancelamento do modo de acréscimo (repõe o instantâneo, sem desfazer).
- **Prende:** `browser-collab-trajetoria-mapa.repro.spec.js`. Controle negativo vermelho. `editor-de-trajetoria-gestos.repro.test.js`:
  mock atualizado.
- **Ressalva de semeadura:** as duas specs põem a âncora EXATAMENTE na posição gravada do ponto; o clique do desenho não cai
  exatamente na coordenada pedida, e uma âncora fora da casa leva o editor ao ramo da âncora.

### Correções pedidas pela revisão final

- `26ed2fa8` (REGRESSÃO de `5d96eebc`/`9ada8c04`, corrompia dado): a linha de base do editor de trajetória só andava no `.then`
  da gravação; dois gestos antes de a 1a terminar gravavam as duas posições (dois pontos-chave no mesmo instante). Base agora
  síncrona + contador de sequência para adotar o resultado. Prova: dois casos node com store FIFO com portão em
  `editor-de-trajetoria-gestos.repro.test.js` (vermelhos antes: 4 e 5 pontos), controle negativo vermelho.
- `4608f59a` (baixo, `0b34457d`): o editor de estilo reaplicava para sempre o que já tinha salvo (salvar vermelho, colega azul,
  eu mudo espessura -> vermelho de volta). Esquece o que a gravação bem-sucedida levou; o reset zera por geração. Também
  troca um caractere NUL literal que `612bab2c` gravou no arquivo (o git passou a tratar o fonte como BINÁRIO) pelo escape.
- `dbc19594` (baixo, `30380266`): escrita de atributo recusada (mapa travado) não emitia mais evento e a aba ficava com o
  campo aberto; `setAttribute` devolve se gravou e a aba se redesenha do guardado. Prova: `browser-collab-atributo-recusado.repro.spec.js`
  (dois navegadores), controle negativo vermelho.
- Observação: `git ls-files --eol` ainda marca como binário (`-text`), fora das minhas mudanças,
  `frontend/src/js/features_tab/index.js` e `backend/src/modules/models3d/models3d.scene.js`; vale conferir se há NUL ali também.

### Lidos sem achado no ciclo extra

- Processamento (buffer, envoltória, Voronoi): a saída vai por `createLayerForImport` + `addFeatures` (lê a entrada da store a
  cada execução, cria camada nova); `browser-collab-processing` já cobre a chegada ao par. Não há cópia velha nem saída que
  não viaja.
- Símbolo militar e de engenharia (e medida de coordenação): o painel grava por `saveFeatures` com `mergePendingEdits` e o
  "Descartar" já passa por `discardTargets` (`8678088d`); a regeneração do raster no par é coberta por
  `browser-collab-symbol-snapshot-regen` e `browser-collab-point-icon-update`.
- Mover a feição não traduz a trajetória (pontos-chave absolutos), então geometria e trajetória são unidades independentes no
  servidor e as duas edições concorrentes sobrevivem.

### Hipóteses descartadas no segundo ciclo

- Arrastar vértice de linha com a feição selecionada NÃO desfaz o nome dado pelo colega depois da seleção (spec escrito,
  passou sem conserto, apagado).
- "Editar coordenadas" do painel de um ponto aberto antes do nome do colega NÃO desfaz o nome (spec escrito, passou sem
  conserto, apagado): a cópia da seleção é atualizada pela op remota; só a aba Atributos fica velha.
- Nome e descrição pelo cabeçalho do painel (`feature-identification.js`) leem com `getFeatureById` fora da trava, a mesma
  janela estreita do item 9; não consertado (a forma do conserto é a mesma: `updateFeature(..., { transform })`).
- Tabela de atributos: não tem edição em massa, exclusão de linha nem remoção de coluna; a célula de nome/descrição usa
  `updateFeatureProperty` (lê sob a trava) e a de atributo usa `setAttribute` (consertado em `4b5672c6`).
- Estilo de camada do USUÁRIO: não há editor na interface (a coluna `layers.style` não tem escritor de tela).

### Observação de UX (não corrigida)

- A aba Atributos do painel NÃO redesenha quando o colega muda um valor: mostra o valor velho até reabrir. Depois de
  `9a5ccc79` isso não perde dado, mas engana.

## Suspeitas não confirmadas

- **S3:** CONFIRMADA e corrigida no segundo ciclo (item 9, `4b5672c6`).
- **S5:** CONFIRMADA e corrigida no segundo ciclo (item 8, `ea0b647a`).
- **S4 (desenho, não defeito):** a unidade de disputa do servidor é a propriedade de topo, e `attributes` é UMA
  propriedade: dois usuários mudando atributos customizados DIFERENTES da mesma feição ao mesmo tempo disputam, e o
  segundo recebe "campos disputados" (vai para as pendências, não se perde). Mudar exigiria patch por caminho mais fundo,
  que é contrato.

- **S1:** depois do F5 nos dois clientes, uma leitura única do par devolveu `processed_visibility` vazio logo depois de
  um poll tê-lo visto (1 em 6 rodadas). Causa não isolada; hipótese: troca do documento do mapa corrente quando o
  retrato novo é ativado depois de o boot já ter lido a geração antiga (leitura transitória vazia).
- **S2:** a PRIMEIRA mudança de Altura do Observador no painel do viewshed, logo depois de editar a visada, não dispara
  recálculo nenhum (nem modal, nem op) em 3 de 3 rodadas com Tab e 1 de 5 com Enter; a segunda tentativa funciona.
  Sintoma de painel (possivelmente o painel é reconstruído por evento remoto entre o preenchimento e o commit do campo).
  O spec de edição tenta o gesto duas vezes, declarado.
- Vitest inteiro sob carga da máquina: `docs-integridade` (40 s), `fila-contagem-por-estado` e
  `espera-do-playwright-nao-aguarda-promessa` reprovaram numa rodada cheia e passaram sozinhos e na rodada seguinte.

## Linhas propostas para o livro-razão

- 2026-09-23 | teste-que-nao-prende | Toda a camada de sync semeava `processed_*` com UUID, e a ferramenta real cunha
  `<entrada>-visible`: o servidor recusava toda saída de análise num atlas de servidor e a suíte ficava verde.
  Codificado em `browser-collab-analise-derivada.repro.spec.js` (ferramenta real, dois navegadores) e na decisão de
  derivar a saída por cliente (`store/analysis-output.js`).
- 2026-09-23 | verificacao-fantasma | O primeiro repro de "edição de visada não sincroniza" renomeava pelo painel e
  passou verde SEM o conserto: o nome vai por outro caminho, que já loga. Codificado no cabeçalho de
  `browser-collab-analise-edicao.repro.spec.js` (o gesto é o recálculo por parâmetro).
- 2026-09-23 | verificacao-fantasma | O primeiro repro do desfazer passou verde no código velho porque o recibo da op
  do próprio desfazer re-derivava a saída um segundo depois. Codificado em `browser-collab-analise-desfazer.repro.spec.js`
  (o colega refaz todos os campos, o desfazer não gera op).

## Parágrafo proposto para docs/decisions/decisions-2026.md

**2026-09-23: a saída das análises de terreno é derivada por cada cliente e nunca viaja.** A Linha de Visada e o
Viewshed gravam uma ENTRADA (`los`, `visibility`) e uma SAÍDA (`processed_los`, `processed_visibility`, as metades
verde e vermelha, que são o único desenho visível). A saída nascia com id `<entrada>-visible`/`-obstructed`, que o
servidor recusa (`features.id` é UUID): num atlas de servidor o par nunca via a análise e o autor a perdia no resync.
Alternativas recusadas: (a) cunhar UUID determinístico para a saída, que quebraria a relação por prefixo usada em toda
a ferramenta e nos atlas locais existentes e ainda exigiria que o servidor cascateasse a exclusão; (b) aceitar id
não-UUID no servidor, que exige migração de `features.id`. Escolhido: a saída é função pura da entrada
(`deriveAnalysisOutput`, `frontend/src/js/store/analysis-output.js`), usada pela ferramenta do autor, pelo caminho de
entrada e pelo retrato do par, e pelo desfazer/refazer; a escrita dela é descartada pelo despachante por TIPO (lista
única `DERIVED_OUTPUT_BUCKET_OF`), nunca por formato de id; linhas legadas de saída no servidor são descartadas no
retrato; o envio de atlas local não sobe a saída; as ops de saída que um cliente antigo deixou na fila são removidas
uma vez por sessão. Precedentes: contagem de cores (2026-09-21) e raster regenerado de símbolo.

## Parágrafo proposto para docs/wiki (sync / análise)

A edição de uma visada ou viewshed (recálculo, arraste de ponta, "Salvar" do painel) passa por
`batchUpdateAnalysisFeatures`, e é ela que registra a op da ENTRADA; a saída nunca tem op. Quem escrever um caminho
novo de edição de análise grava a entrada por ela (ou por `updateFeature`) e deixa a saída para a derivação.

## Cobertura

Coberto: visada e viewshed num atlas de servidor (criação, edição por parâmetro, arraste de ponta, desfazer com
colega, exclusão, F5, envio de atlas local, rajada remota via coordenador); Salvar e Descartar do painel com o
colega editando a mesma feição; recibo de briefing/slide (tarefa da revisão). Lido sem prova: tabela de atributos
(edição por célula passa por `updateFeatureProperty`/`setAttribute`, sem edição em massa nem exclusão de linha na
tabela), `userDataManager` (S3), gestos compostos (S5). Não coberto: estilos campo a campo por ferramenta, medições
"Salvar como feição", combinação de grupos, colar entre usuários.
