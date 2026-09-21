# Diário write-ahead: a intenção antes da entidade

A intenção de sincronizar é gravada em disco ANTES da entidade que ela descreve, e não depois; a ordem inteira de `runTransaction` mudou por causa disso, e o padrão antigo (logar dentro de `tx.deferAsync`) produz hoje uma edição que existe só neste computador.

O caminho se lê em `frontend/src/js/store/store-transaction.js`, e os modelos de uso são `frontend/src/js/store/briefing.operations.js` e `frontend/src/js/store/catalog.operations.js`. Esta página guarda o que nenhum dos três diz sozinho: por que a ordem é essa, quais travas ela obriga a respeitar, o que ficou de fora de propósito, e as três formas de errar que já custaram dado aqui.

## O problema que a ordem antiga não resolvia

O contrato anterior era *persistence-first*: grava a entidade, e só depois roda o efeito colateral, `logXxxOperation` incluído. Ele protege contra o inverso (uma op que descreve uma edição que não aconteceu), e deixa aberto o caso que importa mais num produto offline-first: a entidade grava, o processo morre antes do efeito, e a edição fica no IndexedDB local sem nada que a leve ao servidor. Ela não é uma pendência, porque nada a registra; não é um conflito, porque ninguém a disputa; e o único sintoma é a divergência aparecendo semanas depois, quando outro cliente sobrescreve o que este acha que salvou.

O diário inverte a aposta: **a intenção duplicada é recuperável e a intenção perdida não é.** Uma op gravada cuja entidade não chegou a existir é uma linha a mais na fila, idempotente por `op_id` do lado do servidor; uma entidade gravada sem op é trabalho invisível.

## A ordem, que é contrato

`runTransaction` executa, nesta ordem exata:

1. **barreira entre abas** (`enterCoordinatedWrite`), perguntada antes de qualquer preparo e nunca aguardada. Ver [[coordenacao-entre-abas]];
2. **a pausa por aba** (`beginStoreWrite`), que pode recusar durante uma recuperação local;
3. **o `workFn`**, onde o chamador lê, prepara e declara as intenções por `tx.recordOperation`, devolvendo a função de persistência sem chamá-la;
4. **o diário** (`writeIntents`, que chama `persistOperationIntents`), que grava os envelopes PREPARADOS e devolve a função de materialização;
5. **a entidade**, executando a função devolvida pelo `workFn`;
6. **a marca de materialização**, numa transação de IndexedDB única, que é o que libera aquelas ops para o envio;
7. **`deferSync`** (memória e eventos) e depois **`deferAsync`**.

Três consequências que não se adivinham. A função de persistência é **devolvida e não chamada**, e é isso que permite ao diário rodar entre o preparo e a gravação: quem grava dentro do `workFn` desfaz o mecanismo inteiro sem que nada fique vermelho. O escopo é reconferido três vezes contra `getActiveScope()`, porque uma troca de atlas durante um `await` mandaria a gravação para o namespace errado. E a intenção nasce **preparada**: até a marca do passo 6, `peek` não a entrega ao envio, de modo que uma falha no passo 5 deixa uma intenção recuperável em vez de uma op que descreve uma entidade que não existe.

## As travas, e a inversão silenciosa

A fila de `frontend/src/js/store/document-lock.js` é FIFO **e sem reentrância**. Duas regras saem daí, e as duas já foram descobertas errando:

- **Uma transação aninhada dentro do `workFn` de outra COMMITA PRIMEIRO.** O sintoma não é a interface pendurada (nenhum módulo de repositório, de transação ou de fila chama `withDocumentLock`), é a inversão: o filho grava e o pai ainda pode falhar. Por isso `removeFeatureFromAllGroups` (`frontend/src/js/store/feature.operations.js`) **recebe** a transação do pai, registra durante o preparo e DEVOLVE a gravação do documento de grupos para o pai encadear, em vez de abrir a sua. N remoções na mesma transação compõem por uma sobreposição (`pendingGroupEdits`), sem a qual excluir uma camada inteira gravaria o grupo que perdeu só a última feição.
- **A trava certa nem sempre é a do mapa.** Camadas usam `withSideDocument`, não `withMapDocument`, porque dois chamadores criam camada de dentro de uma seção do documento do mesmo mapa (o composto de mover feições e a fusão de mapas), e pedir `map:<id>` segurando `layers:<id>` fecha um ciclo com a ordem que já existe. Pela mesma razão a remoção local das feições de uma camada continua numa seção separada e ANTES: a falha entre as duas deixa uma camada VAZIA, nunca uma feição órfã.

## O que fica de fora, e por quê

Não é lacuna, é recorte, e confundir os dois faz alguém "consertar" o que está certo:

- **`setActiveLayer`** é estado de visão por cliente, sem op, e continua síncrono e represado em outra chave.
- **`importMapGroups`**, `setCesium3dDataForImport` e `setStreetview360DataForImport` substituem o documento inteiro a partir de um arquivo e não emitem op nenhuma.
- **O upload e o blob local do ícone personalizado** rodam FORA da transação, com compensação manual no `catch`: eles não são reversíveis pelo diário, então só o miolo entra. Ver [[imagens-atlas]].
- **Três efeitos de `removeMap` ficam awaitados DEPOIS da transação**, e não em `tx.deferAsync`: memória, grupos e `setCurrentMap`, porque o retorno nomeia o mapa corrente novo e um efeito deferido é disparado sem espera, de modo que a tela recarregaria apontando para um mapa que ainda não é o corrente.

**E a janela que o diário não alcança é anterior a ele.** O autosave do editor de briefing segura a edição em memória por 1,5 s antes de chamar a store, então o que se perde ali nunca chegou a ser uma intenção. `_flushAutosave` (`frontend/src/js/briefing/editor/briefing-editor.control.js`) passou a descarregar em `beforeunload`, `pagehide`, queda de conexão e troca de sessão, com dois limites declarados: o flush do fechamento é DISPARADO e não aguardado, porque `beforeunload` não espera promessa; e não existe gancho PRÉ-troca de atlas, então o ouvinte tenta no primeiro sinal disponível e, tarde demais, é recusado por um guarda de escopo, em vez de gravar o briefing de um atlas dentro de outro.

## As armadilhas medidas

- **Um `catch` que só loga é o silêncio que este trabalho existe para fechar.** As cinco entradas de grupo saíam de um `setTimeout(0)` cujo `catch` apenas escrevia no console; o `try/catch` em volta de `addEntityImage` devolvia `null` numa falha de quota; e o `try/catch` da aparência do atlas engolia tudo, de modo que o modal dizia "Configurações salvas." depois de uma quota. Nos três, a correção foi deixar `runTransaction` ser o único a relatar, por `STORE_PERSIST_ERROR`.
- **O escopo remoto com o registro desligado grava a entidade e nenhuma op.** `persistOperationIntents` abria com um `return` mudo e devolvia `undefined`, que a transação não distinguia de sucesso. Hoje ele lança `OperationIntentRefusedError` em escopo REMOTO (a transação vira rollback mais `STORE_PERSIST_ERROR`) e não muda nada em escopo local, onde não há fila de envio e um aviso por edição seria ruído. Quem fechou a janela em si foi `disconnect`, que passou a desligar o registro como `logoutAndDisconnect` já fazia: sem isso o estado do registro entre `activateRemoteAtlas` e `connect` era o que tivesse sobrado da conexão anterior.
- **O documento VAZIO do fallback de compatibilidade não pode ser gravado de volta.** Ele é a resposta para mapa ausente, e regravá-lo cunha um mapa fantasma com id que o servidor nunca emitiu. O guarda dos ajustes de mapa é `refusesMissingRemoteMap` (`frontend/src/js/store/map.operations.js`), que nasceu no catálogo como uma asserção que ESTOURAVA e desde 2026-09-21 recusa com voz (`map_missing`) e devolve uma persistência vazia, de DENTRO da transação. A classe inteira (toda escrita de conteúdo) passa pela porta de `frontend/src/js/store/mapa-inexistente.js`, e a pergunta de existência nunca mora fora da transação: leitura de disco fora dela fica fora do carimbo de escopo.
- **Uma contagem agregada não prova um fato de estado.** Quando `count()` passou a responder só o enviável, três asserções que a usavam para provar que a intenção tinha sido PREPARADA passaram a ler zero, sobre código correto. Quem responde essa pergunta é `countByState`. Ver [[fila-operacoes-outbound]].

## Ver também

[[fila-operacoes-outbound]] para o que acontece com o envelope depois de materializado; [[lote-logico-de-gesto]] para quando várias transações formam um gesto só; [[pendencias-de-sincronizacao]] para o que a pessoa vê quando uma intenção não sai; [[modelo-conflito-lww]] para o que o servidor faz com ela.
