# Lote lógico: o gesto como unidade de aplicação

Operações que compartilham um `batchId` e chegam no MESMO push são aplicadas ou recusadas inteiras, num savepoint só; o servidor não sabe quantos membros o gesto tem, e é por isso que o recorte do envio é parte do contrato, e não uma otimização do cliente.

O caminho de servidor está em `backend/src/modules/sync/sync.service.js` (`agruparPorLote`, `LOTE_MAX_OPS`) e o de cliente em `frontend/src/js/store/sync/sync-engine.js` e `frontend/src/js/store/sync/gesture-batch.js`. Esta página guarda o porquê, o teto medido e as três armadilhas que atravessam os dois pacotes.

## O que era o desfecho normal antes

Cada op corria num savepoint próprio. Criar um grupo com três membros era uma op de grupo mais três de membresia, e um membro recusado deixava o grupo criado, os irmãos aplicados e a resposta em 200: **aplicação parcial de um comando composto era o desfecho normal**, sem nada no banco dizendo quais linhas tinham nascido juntas. O campo `batchId` já viajava desde a fábrica do cliente e morria na validação, absorvido pelo `.unknown(true)` do schema de push.

A alternativa recusada foi a do texto do dono: preparação durável no servidor, com ativação ao fim. Ela é mais forte e é cara, porque exige estado preparado com ciclo de vida próprio, para um problema que o savepoint resolve no tamanho de lote que o produto produz. Ela fica para importação grande, fora do lançamento. Decisão D4, registrada em [`decisions-2026.md`](../decisions/decisions-2026.md).

## O teto é medido, e não protege contra custo

`LOTE_MAX_OPS` vale 200, e o lote acima dele é recusado inteiro, com motivo, antes de qualquer escrita. Medido pelo caminho HTTP real, mediana de três rodadas, criando feição de geometria mínima: lote de 25 em 68 ms (2,74 ms por op), de 100 em 230 ms (2,30) e de 200 em 446 ms (2,23); no regime individual os mesmos N custam 56, 263 e 497 ms.

Ou seja, **o custo por op é plano e o savepoint único sai mais barato que N savepoints**. O teto não existe para conter custo: ele limita o tempo de posse do lock de push do atlas, e 0,45 s deixa uma ordem de grandeza de folga dentro do `lock_timeout` de 5 s daquele lock (ver [[modelo-conflito-lww]]). Quem for mexer no número mexe nessa folga, não em desempenho.

Acima do teto **a recusa é LOCAL**, sem viagem: a resposta do servidor seria a mesma em toda rodada seguinte, para sempre, e o lote não pode ser partido para caber.

## O recorte do envio é parte do contrato

O servidor recebe um array e agrupa o que vê; ele **não recebe um total**, então não tem como saber que faltou membro. Um push que cortasse um gesto ao meio entregaria meio gesto com cara de gesto inteiro, e o savepoint o aplicaria inteiro por definição.

Por isso `FLUSH_BATCH_SIZE` (25) deixou de ser uma fatia e virou um ORÇAMENTO: `peek` toma corridas consecutivas de mesmo `batchId` inteiras enquanto couberem, e o PRIMEIRO lote vai inteiro mesmo quando sozinho passa do orçamento. Três consequências:

- **`peek(1)` devolve o menor pedaço INDIVISÍVEL**, que dentro de um gesto é o gesto. O modo de isolamento passou a exigir que ainda não esteja isolando para encolher; sem essa guarda o laço gira para sempre (medido: o worker do vitest morre por tempo).
- **Um membro preparado ou com problema segura o lote inteiro**, irmãs já em buffer inclusive. É o caso da feição de imagem esperando o blob dela enquanto as irmãs já estão materializadas.
- **`countByState` aplica as mesmas duas regras**, porque um censo que discorde do carregador promete trabalho que o flush se recusa a enviar, e a luz de sync fica prometendo envio que não acontece.

Na recusa, **o problema durável é gravado em TODOS os membros**, com `batchId` e `batchFailedOperationId` nomeando a culpada, inclusive nos que o recibo deixou de nomear, e `acknowledgedOperationIds` nunca desenfileira membro de lote recusado, mesmo acked como aplicado. Nada sai do disco em nenhum desses caminhos, então o reenvio reusa os mesmos envelopes e segue idempotente por `op_id`.

## O que os contratos de ponta a ponta prendem, e o que fica fora deles

`frontend/tests/e2e/lote-logico.e2e.test.js` mede o SERVIDOR pelo HTTP real, com envelopes da fábrica do cliente, e `frontend/tests/e2e/lote-recusado-fila.e2e.test.js` mede o que a FILA faz com o recibo que volta, dirigindo o motor e a fila de verdade. Três coisas que a leitura deles não entrega:

- **A posição da culpada é uma medição, e são três.** Falha no primeiro membro mede o rollback de um savepoint que ainda não escreveu nada; no intermediário e no último, o desfazimento de irmãs que já escreveram. Um servidor que apenas PARASSE no primeiro erro, sem desfazer, passaria no caso do primeiro membro. Cada caso leva um controle dentro dele: o mesmo gesto sem a culpada aplica inteiro, senão "nada aplicou" não distingue atomicidade de recusa geral.
- **`count()` da fila NÃO é o tamanho dela**, e ler assim faz um teste de "nada foi desenfileirado" passar verde por outro motivo: ele responde o que o flush pode enviar AGORA, então vale zero depois da recusa, com os envelopes intactos. Quem responde o que está guardado é `getAll()`; o total é a soma dos três baldes de `countByState()`.
- **Um irmão ACKED COMO APLICADO dentro de um lote recusado não é produzível contra o servidor de verdade**, porque ele responde todos os membros com o mesmo status. A guarda de `acknowledgedOperationIds` que o segura é medida com recibo montado à mão, em `frontend/tests/unit/sync-ack-por-operacao.test.js`. Controle negativo medido: sem a filtragem por lote recusado, o irmão sai da fila e o gesto fica meio enfileirado; e sem o salto do carregador sobre a op com problema, o flush não termina mais (os dois casos de fila estouram em 30 s), que é o laço em vazio que o problema durável evita.

## O gesto é uma identidade AMBIENTE, e isso tem preço declarado

Uma transação já era um lote, porque `createBatchOperations` cunha um `batchId` por transação: colar, duplicar e importar sempre foram um gesto só. Converter uma feição, transferir uma camada e desfazer **não cabem numa transação**, e não por descuido: as folhas tomam a trava do documento cada uma na sua chave, e aquela fila é FIFO sem reentrância, de modo que envolvê-las numa transação só travaria a interface para sempre (ver [[diario-write-ahead]]).

`withGestureBatch` (`frontend/src/js/store/sync/gesture-batch.js`, folha) abre uma identidade de gesto, e toda transação que se complete dentro dela carimba aquele `batchId`, com o `batchIndex` CONTINUANDO de onde a anterior parou, porque o servidor lê pai antes de filho por esse índice. É a mesma forma de `startBatchUndo`, que já agrupa exatamente estes gestos para o Ctrl+Z e já atravessa `await` do mesmo jeito.

Duas propriedades que só se leem no cabeçalho daquele módulo. Enquanto o gesto está **ABERTO a fila não entrega nenhum membro dele**, senão o disparo de 1,5 s caindo entre duas transações mandaria a primeira metade sozinha. E **uma transação de outra origem que se complete na mesma janela ENTRA no lote**: é o preço da forma ambiente, aceito porque o lote é atômico e um passageiro a mais é aplicado ou recusado junto, nunca perdido.

## As quatro exceções REST deixam marcador, e cada uma viaja pelo nome dela

Merge, duplicação de mapa, clone e import de atlas não passam pelo protocolo incremental (ver [[sintese-rest-vs-sync]]). Só o merge deixava rastro no log; agora as quatro gravam o seu por `recordStructuralMarker` (`backend/src/modules/sync/structural-marker.js`), na mesma transação do ato, e o marcador da duplicação nomeia no payload as camadas que `ensureMapLayers` cria fora do log. Sem isso o par que estava offline recebia um replay VAZIO e concluía que estava em dia.

**O tipo publicado é o nome do ato desde 2026-09-13.** As quatro viajavam como `map_merge`, porque o cliente conhecia uma palavra só e tipo desconhecido é IGNORADO em silêncio pelo roteador de entrada (avisa uma vez, avança o cursor e segue), o que traria metade do defeito de volta. A restrição era "não publique antes de o cliente atualizado estar em campo", e ela caiu pela decisão D6: a linha `integracao_backend` nunca foi implantada e a primeira implantação é instalação nova, então não existe cliente anterior a proteger. Decisão registrada em [`decisions-2026.md`](../decisions/decisions-2026.md).

O vocabulário virou contrato de fio, com espelho dos dois lados: `STRUCTURAL_MARKER` no backend e `STRUCTURAL_RESYNC_OPS` num módulo FOLHA do cliente (`frontend/src/js/store/sync/structural-markers.js`). A lista saiu de dentro do `sync-engine.js` por uma razão só, e ela é a mesma do `sync-trace`: o espelho só se verifica se os dois lados carregarem no MESMO processo, e o `sync-engine.js` arrasta a store inteira. Quem cobra é `frontend/tests/unit/marcador-estrutural-espelha-backend.test.js`, e a ponta a ponta é `frontend/tests/e2e/marcador-estrutural.e2e.test.js`.

Três armadilhas medidas ao fechar isto:

- **As DUAS colunas continuam separadas, e a simetria de hoje não as funde.** `entity_type` é o que o log guarda e `client_entity_type` é o que o fio publica; elas coincidem agora porque o nome honesto é publicável, não porque sejam a mesma decisão (o 3D/360 usa a mesma separação para traduzir tipo genérico em específico).
- **O marcador do MERGE não passa por `recordStructuralMarker`**: ele ainda faz o próprio INSERT em `maps.service.js`, com a sentinela `server-merge` (os outros três levam `server-<ato>`) e SEM o campo `kind` no payload que os outros três carregam. Um teste que assuma `data.kind` nos quatro falha só no merge.
- **Clone e import não se leem pela porta HTTP.** O marcador deles é a PRIMEIRA linha do log do atlas novo, e um pull HTTP a partir da versão 0 significa "não tenho nada, mande o snapshot". A leitura que alcança essa linha é o `sync_request` do socket com `haveSnapshot: true`, que é o outro sentido do zero (ver `pullOperations`). Quem medir por HTTP mede o snapshot e chama de replay.

## Ver também

[[fila-operacoes-outbound]], [[diario-write-ahead]], [[modelo-conflito-lww]], [[ack-idempotencia]], [[tabela-operations]], [[sintese-rest-vs-sync]].
