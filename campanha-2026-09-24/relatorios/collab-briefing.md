# Relatório: collab-briefing (caça noturna, 2026-09-23 21:48 a 2026-09-24 00:40)

Worktree: C:\Users\diniz\ebgeo_hunt\collab-briefing, branch hunt/collab-briefing. Portas 4334/3924/3934; bancos ebgeo_e2e_brief e ebgeo_test_brief.

## Commits (em ordem, sobre 5379fc3e)

| SHA | O quê |
|---|---|
| f94efdcd | fix(briefing): editor aberto grava a cópia velha e apaga o trabalho do colega |
| 1ecfce4f | fix(undo): Ctrl+Z desfaz o que o colega mudou depois |
| e1413de4 | fix(sync): envelope de briefing do par apaga a edição de slide que o servidor guardou |
| d67636e4 | fix(briefing): campo com foco mostra o valor do colega (revisão 11 e 12) |
| 5386d0d0 | test(briefing): store em node para applyBriefingEdits/appendSlides (revisão 13) |
| a50e6483 | fix(collab): nota salva pelo colega abria o painel de notas na tela de todos |
| 7b520625 | fix(sync): ajuste de mapa recebido do par fazia a próxima edição dele virar conflito |
| 5d972e54 | test(briefing): prende a perda de título de uma pessoa depois de excluir outro slide |
| 13f730d3 | fix(briefing): texto rico do colega sem passar pela colagem (revisão, crítico) |
| 1d2ce40d | fix(briefing): lista com marcadores deixa de voltar numerada |

Detalhe de cada um (causa, prova, controle negativo) está no corpo do commit.

## Bugs corrigidos

1. **Perda de dado.** O editor de briefing aberto apagava o slide que o colega CRIOU e revertia o título que o colega EDITOU. Basta mexer em qualquer coisa (até o nome) depois da edição do colega. Causa: `_save` gravava `this._briefing.slides` lido na abertura; `writeBriefing` derivava SLIDE DELETE/UPDATE pela diferença. Conserto: mescla de 3 vias (`diffBriefingEdits`, `rebaseBriefingEdits`, `applyBriefingEdits`, `appendSlides`). Repro: `briefing-editor-copia-velha.repro.spec.js`, 2/2 vermelhos antes e 2/2 verdes depois; o controle negativo reprova.
2. **Perda de dado.** O Ctrl+Z de A revertia o campo que B mudou depois (o nome volta em A, B e Postgres). Conserto: `updateFeature({revertFrom})` + `keepLaterEdits`. Repro: `desfazer-preserva-edicao-do-par.repro.spec.js`. Controle negativo: vermelho.
3. **Divergência cliente x servidor até F5 (perda via exportar/salvar local).** Slides diferentes editados ao mesmo tempo: o envelope do par apagava a edição do outro nos clientes. Conserto: `mergeEnvelopeSlides`, SLIDE aplicado por slide e SLIDE entra em CONVERGENCE_GUARDED. Repro determinístico (POST retido): `briefing-slides-concorrentes.repro.spec.js`, 3/3 em série.
4. **Quebra funcional/perda da edição de A.** A próxima edição do mesmo ajuste de mapa (notas, grade, posição, mapa base, temporal) depois de receber a do par era recusada como conflito. Conserto: `forgetConfirmedMapRevision`. Repro: `notas-do-colega-recusada.repro.spec.js`.
5. **Quebra funcional/UX.** A nota salva por B abria o painel de notas na tela de todos (MAP_NOTES_REQUESTED). Conserto: `EventTypes.MAP_NOTES_CHANGED` e refresh só onde o painel já está aberto. Repro: `notas-do-colega-abre-painel.repro.spec.js`.
6. **Revisão 11: perda do valor do colega por widget velho.** Repro `briefing-editor-campo-com-foco.repro.spec.js`: 2/2 vermelhos antes e verdes depois.
7. **Revisão crítica: ciclo entre editores pela colagem (clipboard.convert).** Roubava o foco, apagava o trecho selecionado e fazia a versão do slide andar sozinha (3 para 8 em 8 s). Conserto: `replaceQuillContentSilently` (innerHTML + `update('silent')` + `history.clear()`, cursor por `transformPosition`), mais uma guarda de render concorrente em `_renderSlideEditor`. Repro: `briefing-editor-figura-do-colega.repro.spec.js`.
8. **Formatação perdida.** Lista com marcadores voltava numerada no editor reaberto e na apresentação. DOMPurify tirava `data-list`, e só listar o atributo NÃO bastava: foi preciso também `ADD_URI_SAFE_ATTR`, mais a regra CSS na apresentação. Repro: `briefing-lista-com-marcadores.repro.spec.js`, com os dois controles negativos.
9. **Perda local de uma pessoa (medida depois).** O título digitado depois de excluir outro slide não era salvo; foi corrigido pelo item 1 e está preso em `briefing-editor-titulo-apos-excluir.repro.spec.js`.

## 2º ciclo (02:16 a 02:35): "Duplicar" mapa em atlas de servidor, CORRIGIDO (969ea1a7)

- Perda de dado: a cópia ficava sem feições no Postgres (vazia após F5), com feições órfãs de camada em A e B.
- Conserto (opção a): em atlas remoto, copyMap faz flush, chama POST /atlas/:id/maps/:mapId/duplicate com { name } e resync (o autor recebe como o par). Atlas local mantém a composição. Offline: recusa "Sem conexão com o servidor. Duplicar um mapa precisa dela; tente de novo quando ela voltar." (também quando a requisição falha por rede antes do socket perceber).
- Backend: a rota aceita body opcional { name } (Joi trim 1..255, 422 se inválido). Motivo: sem ele o servidor nomeia "X (cópia)" e o segundo duplicado colide com o primeiro, e o cliente resolve mapa por NOME. Mudança aditiva de API.
- Prova: duplicar-mapa-no-servidor.repro.spec.js (2 navegadores + Postgres + F5 nos dois + caso offline). Controle negativo (map.manager revertido): 2/2 vermelhos. Com o conserto: 2/2 verdes COM o backend de cb922c83 e 5b2c1acb (já no hunt/integra) aplicado na árvore; no meu branch sozinho as asserções "feição aponta para camada da cópia" ficam vermelhas porque dependem desses dois commits integrados (clone realinha properties.layerId; retrato serve a camada pela coluna).
- Backend: duplicar-mapa-com-nome.test.js; suítes de clone/duplicação verdes. Frontend: vitest 879/879, duplicate-map e2e de contrato, browser-map-dup-snapshot, browser-duplicate-combine verdes.
- Os arquivos collab-briefing-*.js nesta pasta (repro antigo e opção b) ficaram obsoletos.

## 3º ciclo (02:30 a 03:05): comentários espaciais

- **261f05ef, quebra funcional/perda da moderação.** A atualização de comentário enviava a cópia INTEIRA de quem mandou. (1) O autor edita o texto enquanto um Editor resolve: a edição levava status 'open' e REABRIA a conversa no servidor e em todos, sem aviso. (2) O Editor resolve com cópia mais velha que o texto do autor: o portão de moderação do servidor recusava ("Somente o autor pode editar o comentário.") porque o texto da cópia não batia. Conserto: `commentUpdatePayload` manda só o que o gesto decidiu (edição sem status não leva status; moderação leva só {id, status, updatedAt}); `applyRemoteCommentOp` mescla o update sobre a cópia; o arrasto do pino manda só {id, lng, lat}. Sem mudança no servidor. Repro: comentario-edicao-depois-do-par.repro.spec.js (4 casos; os 2 concorrentes vermelhos antes, verdes depois, controle negativo vermelho; os 2 sequenciais verdes antes e depois, o que DESCARTA a hipótese de base velha para comentário). Unit: merge em remote-operation-handler.test.js.
- **d87556d4, perda do texto digitado.** B escrevendo resposta e A exclui a conversa: o cartão de B fechava e o texto sumia sem aviso. Conserto: com texto digitado o cartão fica, avisa uma vez (AVISO_CONVERSA_EXCLUIDA) e o envio recusa mantendo o texto. Repro: comentario-rascunho-thread-excluida.repro.spec.js (antes {avisou:false, cartao:0, rascunho:null}; depois verde).
- **e54fbaa5, cobertura de papel.** Comentarista comenta, responde, não vê Resolver/Excluir no alheio, resolve o próprio. Verde de primeira (não havia defeito).
- Arrasto de pino com cópia velha: o overlay recarrega a cópia a cada evento, então a janela é pequena; e desde 261f05ef o arrasto só manda posição, fechando o caminho. Não medido com repro próprio.
- Achado lateral (não é defeito do produto): comentário criado pela store sem authorId (como faz o preparo de comment-draft-collaboration) não pode ser resolvido por Editor, porque o servidor compara o authorId nulo do payload com a coluna. A composição real sempre passa o autor.

## 4º ciclo (03:13 a 03:32), rebase sobre hunt/integra 7d07937c

- **2eba5577, perda da edição do colega.** A engrenagem temporal gravava a config INTEIRA lida ao abrir; a unidade que B salvou com a engrenagem de A aberta voltava a antiga no Salvar de A (servidor e todos). Conserto: rebase sobre a config atual (`pendenteSobreAAtual`) e escrita só do que difere (`patchSoDoQueMudou`). Repro temporal-engrenagem-copia-velha.repro.spec.js: vermelho com o modal revertido, verde com o conserto. Unit novo; dois casos de temporal-settings-modal-fechamento.test.js afirmavam a escrita inteira sem mudança e passaram a trocar a unidade antes.
- **93dc69cb, quebra funcional.** O sanitize tirava `target`/`rel` dos links e `width`/`height` das figuras (valor conferido contra a regex de URI). Na apresentação, clicar num link do slide LEVAVA A ABA DO EBGEO EMBORA. Conserto: os quatro em ADD_URI_SAFE_ATTR. Repro briefing-link-e-figura-no-sanitize.repro.spec.js (antes: target null, a aba do app foi para o link; depois: nova aba, app no lugar). Sobre o tamanho da figura: o editor não tem gesto de redimensionar; width/height só chegam por HTML colado com figura remota; agora sobrevivem.
- Vermelho não relacionado na base integrada: referencias-de-recurso-censo acusa store/migration/legacy-transition.js (baseLayer, catalogLayers).

## Revisão final (04:15 a 04:23), rebase sobre hunt/integra 9ada8c04

- **75f50451, segurança (revisão de dc4c3b5a).** `target`/`rel` em ADD_URI_SAFE_ATTR deixavam os valores livres (rel="opener" anula o noopener implícito: tabnabbing reverso; target="_top" navega o app). Saíram; um hook afterSanitizeAttributes, posto só durante a chamada e removido no finally, força target="_blank" rel="noopener noreferrer" em todo <a href>. Prova: caso novo em briefing-link-e-figura-no-sanitize.repro.spec.js (ataques neutralizados; ponta a ponta com o conteúdo vindo do par: nova aba, window.opener nulo, app no mapa). Controle negativo: vermelho com a config de dc4c3b5a.
- **76c5cc67, baixo.** `_busy` antes da releitura no Salvar da engrenagem: Enter duplo salvava duas vezes e Escape fechava durante a gravação. Unit novo em temporal-settings-modal-fechamento.test.js, vermelho com o modal anterior.

## Suspeitas não confirmadas / descartadas

- Base velha herdada do payload do autor (briefing): medido, B não herda `confirmedVersion` (base null), então descartada para briefing. Grupo e comentário não foram medidos.
- Modal temporal (engrenagem) salva a config inteira lida na abertura: LWW de modal curto, não perseguido.
- Arrasto de pino de comentário com cópia velha: janela pequena, não perseguido.
- Trade-off do bug 4: sem base, uma edição realmente concorrente do mesmo ajuste passa por ordem de chegada em vez de ser recusada. É a mesma regra que `mergeRemoteMapUpdate` já usa; carimbar a revisão exata exigiria o servidor mandar a versão da entidade no broadcast.
- Flakes de carga, todos verdes isolados: tab-lock-refutacao 3.5, docs-integridade, o censo de login programático e idb-decisao4-medicao.
- Imagens do texto rico perdem width/height no sanitize (o valor "800" não casa `ALLOWED_URI_REGEXP`). Visto na sonda, não medido na tela.

## Linhas propostas para o livro-razão

- 2026-09-23 | perda-de-dado | editor de briefing gravava a cópia lida na abertura e apagava slide/título do colega | codificado em `diffBriefingEdits`/`applyBriefingEdits` (store/briefing.operations.js) + briefing-editor-copia-velha.repro.spec.js
- 2026-09-23 | perda-de-dado | Ctrl+Z regravava a feição inteira de antes, revertendo a edição posterior do par | `keepLaterEdits` + desfazer-preserva-edicao-do-par.repro.spec.js
- 2026-09-23 | divergência | envelope de briefing substituía a lista de slides do par em bloco; SLIDE era no-op inbound | `mergeEnvelopeSlides` + SLIDE em CONVERGENCE_GUARDED + briefing-slides-concorrentes.repro.spec.js
- 2026-09-23 | conflito-fantasma | ajuste de mapa do par não apagava a revisão confirmada; a próxima edição era recusada | `forgetConfirmedMapRevision` + notas-do-colega-recusada.repro.spec.js
- 2026-09-23 | evento-errado | inbound de notas emitia o PEDIDO de abrir o painel | `MAP_NOTES_CHANGED` + notas-do-colega-abre-painel.repro.spec.js
- 2026-09-23 | verificacao-fantasma (revisão) | conteúdo guardado passado por `clipboard.convert` rodava os matchers de colagem e criava ciclo entre editores | `replaceQuillContentSilently` + briefing-editor-figura-do-colega.repro.spec.js
- 2026-09-23 | formatação | DOMPurify com ALLOW_DATA_ATTR false confere o VALOR do atributo listado contra a regex de URI | `ADD_URI_SAFE_ATTR` + briefing-lista-com-marcadores.repro.spec.js

## Parágrafos de doc propostos (architecture.md §Sync ou wiki de briefing)

- **O briefing converge por slide, e o envelope decide só nome e ordem (2026-09-23).** O servidor guarda cada slide numa linha. O par aplicava o envelope do briefing em bloco, e o envelope carrega a lista inteira de quem o mandou, montada antes de saber do colega. Desde esta data `mergeEnvelopeSlides` mantém o conteúdo local, a ordem vem do envelope, slide só do envelope não entra (quem o cria é a op dele) e slide só local fica por último (a regra do servidor). A op SLIDE é aplicada por slide e é guardada por LWW como qualquer entidade.
- **O editor de briefing nunca grava a própria cópia.** Ele guarda uma base (o documento do store com que a memória foi reconciliada) e grava só o patch do que a pessoa mudou (`applyBriefingEdits`, por slide e por campo, settings por chave). A reconciliação é in-place, porque o formulário fecha sobre o OBJETO do slide. Conteúdo guardado nunca passa por `clipboard.convert`, que roda os matchers de colagem.
- **Ajuste de mapa recebido do par apaga a revisão confirmada do mapa**, como a op de mapa já fazia. O preço declarado: uma edição realmente concorrente do mesmo ajuste passa por ordem de chegada.

## Cobertura

Coberto: briefings (editor, slides concorrentes, texto rico, figura, lista), desfazer com par, notas de mapa, ajustes de mapa, duplicar mapa (achado). Fora: grupos aninhados, transferência de camada (já tem specs), trajetórias/reagendar, apresentar enquanto o outro edita, Firefox (nada rodou em Firefox).
