# Vista da pessoa e vista salva do mapa

O mapa base e o interruptor da linha do tempo que cada pessoa vê são estado de VISTA dela, como a câmera; o que viaja é a vista SALVA do mapa (câmera, base e interruptor), gravada por um gesto só, e a vista de cada slide de briefing.

Decisão do dono em 2026-09-20, registrada em [`../decisions/decisions-2026.md`](../decisions/decisions-2026.md). O mecanismo se lê em `frontend/src/js/baselayers/base-layer.control.js`, `frontend/src/js/store/temporal.operations.js`, `frontend/src/js/store/map-view.operations.js` e `frontend/src/js/briefing/slide-view.js`. Esta página guarda o que nenhum dos quatro diz sozinho.

## O que era, e por que custava

Escolher mapa base e ligar a linha do tempo eram ESCRITAS no documento do mapa, com op de sync (`baseLayer` e `mapTemporal`). Três consequências, todas medidas ou lidas no código antes do corte:

- **O gosto de uma pessoa repintava a tela das outras.** Desde 2026-09-16 o par aplicava na própria tela o estilo recebido; antes disso a troca só chegava num F5, e foi o conserto daquele dia que tornou o incômodo visível.
- **Leitor e mapa travado não escolhiam nada.** O seletor de base foi escondido dos dois em 2026-09-17 justamente porque a escolha morria no guarda, e o botão temporal ficava desabilitado sob trava.
- **Abrir um mapa podia REGRAVAR a base dele.** `switchMap` saneava a base que o catálogo de quem entra não oferece e persistia o fallback. Um Editor sem concessão a uma base privada abria o mapa e, sem clicar em nada, trocava a base para o atlas inteiro. Repro em `frontend/tests/integration/mapa-base-e-vista-da-pessoa.repro.test.js`.

## A divisão

| estado | dono | viaja quando |
|---|---|---|
| feições, camadas, janela temporal (`inicio`, `fim`), lentes (`modo`, `unidade`, `origem`) | atlas | a cada edição |
| vista salva: câmera, base, interruptor temporal | mapa | só no gesto de salvar posição, num lote só |
| vista do slide: câmera, base, interruptor, cursor | slide | na captura e na edição do slide |
| base na tela, interruptor na tela, play, velocidade, revelar ocultas, cursor | pessoa, em memória | nunca |

A regra de entrada é a da câmera: **entrar num mapa COM vista salva aplica as três coisas; sem vista salva, o que está na tela fica.** A exceção é a primeira pintura depois de um boot ou de um wipe da store, que lê a base do documento porque ainda não há tela a manter. Um F5 devolve a pessoa à vista salva: a escolha pessoal mora em memória, de propósito, porque persisti-la criaria uma disputa de precedência com a base salva que a regra de entrada já resolve.

## As armadilhas que o código não anuncia

- **O `ativo` tem DOIS valores, e o payload tem de levar o SALVO.** O servidor regrava `temporal_config` com as chaves que a op traz (`normalizeMapChanges`, `backend/src/modules/sync/sync.service.js`), então tirar `ativo` do payload apagaria o valor salvo. `setMapTemporalConfig` descarta `ativo` do patch que recebe e mescla sobre o documento, que carrega o salvo; quem escreve o salvo é só `setMapTemporalSaved`. Um caminho que mandasse o `ativo` da TELA devolveria a propagação inteira sem nenhum teste de unidade acusar, e é por isso que o caso existe por nome em `frontend/tests/integration/temporal-interruptor-e-vista.test.js` (editar a janela com a tela ligada e o salvo desligado).
- **A vista é FIXADA na entrada do mapa**, por `setCurrentMap` (`frontend/src/js/store/store-state-manager.js`). Sem entrada em `memoryStore.temporalView` os leitores respondem o valor salvo, então um colega salvando a vista DELE ligaria a linha do tempo de todo mundo que está no mapa e nunca tocou no interruptor. O valor que chega depois vale na PRÓXIMA entrada, como a câmera salva.
- **Salvar a vista é COMPOSTA e fica fora de toda trava de documento.** Câmera e base moram no documento do mapa, o interruptor num documento lateral, e a fila de `frontend/src/js/store/document-lock.js` é FIFO sem reentrância. O que une as três folhas é `withGestureBatch`: um `batchId` só, que o servidor aplica ou recusa inteiro. Folha cujo valor não mudou não é chamada, porque uma op que regrava o valor armazenado reivindica uma unidade de disputa por nada.
- **A base do slide é referência de CATÁLOGO, e pode ser privada.** Ela entrou no registro de referências dos dois pacotes (`briefing.slide.baseLayer`), no gate de escrita do sync (`RESOURCE_REF_EXTRACTORS`, `backend/src/modules/sync/resource-ref.extractors.js`) e nas duas podas ([[sair-do-servidor]]). A ação é voltar a NULO, que não é buraco: é "herda a base salva com o mapa", o estado em que todo slide nasce e o que mantém todo slide anterior a 2026-09-20 apresentando como antes.
- **O slide NASCE lendo a tela do autor, e são TRÊS sítios de nascimento**: o primeiro slide de um briefing novo (`frontend/src/js/sidebar/tabs/briefings.tab.js`), o "adicionar slide" e a captura de posição do editor. Os três passam por `slideViewFromScreen` (`frontend/src/js/briefing/screen-view.js`). Slide que nasce nulo herda a vista salva do mapa, e selecioná-lo repinta a tela do AUTOR com uma base que ele não escolheu; foi uma captura de tela do editor que achou o segundo sítio, porque nenhuma suíte o exercitava.
- **Base que o espectador não desenha cai para a SALVA do mapa, nunca para a primeira oferecida.** `getValidBasemapFallback` responde "a primeira habilitada", que é o fallback certo para um id desconhecido e o errado para um slide: o espectador sem concessão veria uma base que nem o autor nem o mapa escolheram.
- **O palco da apresentação é LIMPO, e o slide escolhe o que volta.** Os controles da lista `SLIDE_CONTROLS` (seletor de base, modelos 3D, imagens 360, terreno, coordenadas, utilitários, busca e o grupo de navegação, que é UMA caixa para zoom, tela cheia e bússola) ficam escondidos ao apresentar e só voltam com a caixa do slide marcada; a conta, o selo com o nome do atlas, o selo de sincronia, a lista de quem está online e o "compartilhar esta vista" somem sempre (os dois do meio só existem com sessão num atlas de servidor, então quem conferir o palco por captura anônima não os vê nem quando estão errados). A lista é FECHADA e espelhada (`SLIDE_CONTROLS` no cliente, `SLIDE_CONTROL_KEYS` no servidor, comparadas por `frontend/tests/unit/controles-do-slide.test.js`): o campo viaja como JSONB, e o servidor descarta chave de fora, então controle acrescentado de um lado só some na entrada, sem erro. Quem esconde é CSS sob classes do `body` (`frontend/src/css/briefing/briefing-presentation.css`), porque o controlador de perfis de visibilidade não tem elemento nenhum registrado. O EDITOR não é afetado.
- **A apresentação devolve a tela.** `resetTo2D` (`frontend/src/js/briefing/presentation/transition.service.js`), que o apresentador, o editor e o PDF de briefing chamam na saída, repõe a base e os interruptores que a pessoa tinha antes do primeiro slide.
- **A troca automática não conta como uso.** `MAP_TEMPORAL_CHANGED` sai carimbado `automatico` quando ninguém clicou (vista salva aplicada, slide), e a telemetria de uso (`frontend/src/js/session/uso-do-barramento.js`) conta só o gesto.

## O que ficou de fora, declarado

- **A fila de saída é append-only**, então ops `baseLayer` e `mapTemporal` de builds antigos ainda chegam. O servidor continua aceitando os dois subtipos, e o par que as recebe grava o documento e não mexe na tela.
- **O clone e o import não levam o cursor temporal do slide** (o `ColumnSet` de `slides` em `backend/src/modules/atlas/atlas.service.js` nunca o listou). É anterior a esta decisão e não foi tocado por ela.
- **As lentes continuam sincronizadas.** Um colega trocando absoluto por relativo ainda muda a régua alheia; o dono decidiu manter toda a CONFIG compartilhada e tornar pessoal só o que é gesto de reprodução.

## Páginas relacionadas

[[modulo-temporal]], [[aplicacao-operacoes-remotas]], [[sessao-boot-e-ciclo-de-vida]], [[sair-do-servidor]], [[diario-write-ahead]].
