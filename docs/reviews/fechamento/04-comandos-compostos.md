# Comandos compostos e desfazer/refazer

Status: as duas metades fecharam em 2026-09-13 (bloco B6, decisão D4), o servidor primeiro e o cliente em seguida, com as provas de falha parcial de desfazer e refazer. Segue aberto, por decisão registrada, só o conjunto GRANDE (preparação durável com ativação no fim). Prioridade: bloqueia lançamento. Depende de [persistência](02-persistencia.md) e [conflitos](03-conflitos.md).

## Problema e alcance

Os contratos normais de conversão, movimento e desfazer/refazer já foram corrigidos e aprovados. Isso não prova atomicidade quando a conexão cai ou o servidor falha no meio de um conjunto. O diário de um briefing com slides também não torna uma importação inteira atômica no servidor.

Inventariar `frontend/src/js/store/layer-transfer.operations.js`, `frontend/src/js/store/feature.operations.js`, `frontend/src/js/store/map.operations.js`, `frontend/src/js/import_export/export-import.service.js` e `frontend/src/js/tool_manager/group_manager.js`. No servidor: `backend/src/modules/sync/sync.service.js`, `backend/src/modules/maps/maps.service.js` e `backend/src/modules/atlas/atlas.service.js`.

## Correção

1. Classificar conversão, transferência de camada inteira, movimentações, agrupar/desagrupar, importação, cópia, duplicação, clone e merge. Registrar quais já usam transação real e quais emitem operações independentes. Abranger inversões de undo/redo e todos os documentos auxiliares de mapa.
2. Para conjuntos limitados, persistir o comando completo no diário local. Validar e gravar entidades, versões, recibo e resultado canônico na mesma transação PostgreSQL, incluindo permissão e bloqueio de todos os destinos.
3. Para conjuntos grandes, preparar dados duravelmente e ativar o resultado ao final, com estado retomável e identidade estável. Medir limites de tamanho/tempo; definir cancelamento. Não apresentar conjunto parcial como concluído.
4. Fazer undo/redo como novo comando contra o estado confirmado. Não restaurar um documento antigo inteiro sobre trabalho de outros usuários.
5. Conferir a compatibilidade das quatro exceções REST com o [documento 01](01-compatibilidade.md), sem criar novos atalhos de escrita incremental.

## O que fechou no servidor, em 2026-09-13

**O lote lógico por `batchId` passou a ser a unidade de aplicação** (commit "sync: um lote lógico
por batchId aplica ou recusa inteiro, num savepoint só"). O push continua sendo UMA transação;
dentro dele, uma op sem `batchId` corre num savepoint próprio, como sempre correu, e as ops que
compartilham um `batchId` correm num savepoint só. Recusa, conflito ou violação de integridade de
qualquer uma rola o gesto inteiro para trás e devolve todas com o mesmo motivo, o mesmo `batchId` e
o `batchFailedOperationId` da culpada. Até aqui, um membro recusado deixava o grupo criado e os
irmãos aplicados, com resposta 200: a aplicação parcial de um comando composto era o desfecho
normal (F9). Quem agrupa é `agruparPorLote`, e quem guarda o gesto é a coluna de lote de
`operations`, criada por `backend/src/database/migrations/014_lote_logico.sql` e ecoada no replay
incremental e no recibo.

**O limite é medido, não escolhido.** `LOTE_MAX_OPS` vale 200, e lote acima dele é recusado inteiro,
com motivo em pt-BR, antes de escrever qualquer coisa. Medido pelo caminho HTTP real, mediana de
três rodadas, com criação de feição de geometria mínima: lote de 25 em 68 ms (2,74 ms por op), de
100 em 230 ms (2,30), de 200 em 446 ms (2,23); no regime individual os mesmos N custam 56, 263 e
497 ms. O custo por op é plano e o savepoint único sai mais barato que N savepoints, então o teto
não protege contra custo: ele limita o tempo de posse do lock de push do atlas, e 0,45 s deixa uma
ordem de grandeza de folga dentro do tempo limite de 5 s daquele lock.

**As quatro exceções REST deixam marcador no log** (commit "exceções REST: duplicação, clone e
import deixam marcador no log e anunciam as camadas"). Só o merge deixava. Agora `duplicateMap`,
`cloneAtlas` e `importAtlas` gravam o seu por `recordStructuralMarker`
(`backend/src/modules/sync/structural-marker.js`), na mesma transação do ato: o par que estava
offline recebe a mudança no pull INCREMENTAL, em vez de um replay vazio que o fazia concluir que
estava em dia, e o atlas clonado ou importado deixou de nascer na versão zero com todo o conteúdo
dentro. O marcador da duplicação nomeia no payload as camadas que `ensureMapLayers` cria fora do
log, que era a metade muda do mesmo buraco.

Provas, com contagem: `backend/tests/integration/lote-logico-atomico.repro.test.js` (9 casos),
`backend/tests/integration/excecoes-rest-marcador.repro.test.js` (4) e
`backend/tests/integration/sync-batch-atomicity.test.js` (3, um deles novo, que prende a fronteira:
sem `batchId`, a recusa continua alcançando só a op ofensora). Os dois arquivos novos declaram no
cabeçalho o controle negativo executado e o vermelho que ele produziu.

## O que fechou no cliente, em 2026-09-13

**O recorte do envio passou a respeitar a fronteira do lote** (commit "envio: o recorte do push
respeita a fronteira do lote, e lote recusado vira problema em todas as ops"). O argumento de
`peek` deixou de ser uma fatia e virou um ORÇAMENTO de lotes inteiros: corridas consecutivas de
mesmo `batchId` são tomadas inteiras enquanto couberem, e o PRIMEIRO lote é tomado inteiro mesmo
quando sozinho passa do orçamento, porque um gesto maior que o recorte viaja num push próprio em
vez de ser partido. Duas regras de fechamento andam junto, e as duas impedem meio gesto no fio: um
membro ainda preparado segura o lote inteiro (a feição de imagem que espera o blob dela enquanto
as irmãs já estão materializadas), e um membro com problema guardado leva o lote inteiro para os
problemas, irmãs já em buffer inclusive. O censo (`countByState`) ganhou as mesmas duas regras,
porque censo que discorda do carregador promete trabalho que o flush se recusa a enviar.

**Acima de `LOTE_MAX_OPS` a recusa é local**, sem viagem, com problema durável em todas as ops e
frase em pt-BR: o lote não pode ser partido para caber, então a resposta do servidor seria a mesma
em toda rodada seguinte, para sempre. **A recusa de um lote grava problema em TODOS os membros**,
com `batchId` e `batchFailedOperationId`, inclusive nos que o recibo deixou de nomear, e
`acknowledgedOperationIds` nunca desenfileira membro de lote recusado, mesmo acked como aplicado.
O modo de isolamento passou a exigir que ainda não esteja isolando para encolher, porque `peek(1)`
agora devolve o menor pedaço INDIVISÍVEL, que dentro de um gesto é o gesto: sem a guarda, o laço
girava para sempre (medido, o worker do vitest morre por tempo). Nada é removido do disco em
nenhum desses caminhos, então o reenvio reusa os mesmos envelopes e segue idempotente pelo
`op_id`.

**Os três gestos compostos passaram a emitir um lote lógico só** (commit "gestos compostos:
conversão, transferência e colagem emitem um lote lógico só"), por um módulo folha novo,
`frontend/src/js/store/sync/gesture-batch.js`. Eles não cabem em uma transação, e não por
descuido: as folhas tomam a trava do documento cada uma na sua chave e aquela fila é FIFO sem
reentrância, então uma transação só travaria a interface para sempre. `withGestureBatch` abre uma
identidade de gesto e toda transação que se complete dentro dela carimba aquele `batchId`, com o
`batchIndex` continuando de onde a anterior parou. A forma é a do `startBatchUndo`, que já agrupa
exatamente estes gestos para o Ctrl+Z e já atravessa await do mesmo jeito, e o custo dela (uma
transação de outra origem completando na mesma janela entra no lote) está escrito no cabeçalho do
módulo. A segunda metade é o que torna a promessa verdadeira em vez de provável: enquanto o gesto
está ABERTO a fila não entrega nenhum membro dele, porque o disparo de 1,5 s caindo entre duas
transações mandaria a primeira metade sozinha e ela chegaria ao servidor com cara de gesto
inteiro. Colar e duplicar já eram um lote (`addFeatures` grava as N feições num `runTransaction`
só); isso agora está preso em vez de suposto.

**Desfazer e refazer são um comando novo contra o estado confirmado, e agora um lote só** (commit
"desfazer e refazer: novo comando contra o estado confirmado, com prova de falha parcial"), com as
provas de falha parcial que o aceite pede: recusa no primeiro, no intermediário e no último
elemento tem o mesmo desfecho (nada desenfileirado, N problemas duráveis, a culpada nomeada);
resposta perdida depois do commit não é recusa (os envelopes ficam com os mesmos ids e o reenvio é
idempotente); e o F5 no meio do caminho não perde nem duplica (as intenções são duráveis e uma
sessão nova lê os mesmos ids e o mesmo `batchId`, e a intenção não materializada continua não
sendo enviável). O contrato de sempre não mudou: refazer uma exclusão continua carregando
`featureIntent`, que é o que a liga à exclusão confirmada em vez de correr contra ela.

**O cliente aprendeu os quatro marcadores** (`map_merge`, `map_duplicate`, `atlas_clone`,
`atlas_import`). O servidor continua publicando os quatro como `map_merge`, de propósito; as três
entradas novas ficam inertes até ele passar a publicar o nome honesto, num commit dos dois
pacotes.

Provas, com contagem: `frontend/tests/integration/fila-recorte-por-lote.test.js` (7 casos),
`frontend/tests/integration/gesto-composto-um-lote.test.js` (9),
`frontend/tests/integration/desfazer-falha-parcial.test.js` (9),
`frontend/tests/unit/gestos-compostos-fiacao.test.js` (6), mais 9 casos novos em
`frontend/tests/integration/sync-engine.test.js`, 5 em `frontend/tests/store/undo-redo.test.js`, 1
em `frontend/tests/store/layer-transfer.test.js` e 1 em
`frontend/tests/store/feature-operations.test.js`. Cada commit declara na mensagem os controles
negativos executados e o vermelho que cada um produziu.

## O que segue aberto

1. **Conjunto grande continua fora.** Preparação durável com ativação no fim é para importação
   grande e ficou fora do lançamento por decisão registrada; o que existe hoje é a recusa com motivo
   acima do teto, agora dos dois lados (o cliente nem viaja).
2. **O tipo publicado dos três marcadores novos.** O cliente já os reconhece, então o servidor pode
   trocar `map_merge` pelo nome honesto de cada ato; é um commit dos dois pacotes, e ele não pode
   ser feito antes de o cliente atualizado estar em campo.
3. **Os contratos de ponta a ponta** (`frontend/tests/e2e/`) e o Playwright ficaram para o
   coordenador: o lote lógico atravessa os dois pacotes, e a prova dessa fronteira é a camada que
   sobe o backend real.
4. **Os cenários de aceite que dependem de estado do servidor** (mapa e camada bloqueados, destino
   excluído, permissão alterada e edição concorrente antes do desfazer) continuam sem prova do lado
   do cliente, porque o que decide os quatro é o gate do servidor e o cliente só observa o recibo.

## Aceite

Injetar falha no primeiro, no intermediário e no último elemento; falhar após commit antes do ACK; repetir o comando após F5. Testar mapa/camada bloqueados, destino excluído, permissão alterada e edição concorrente antes do undo. Exigir conjunto inteiro confirmado ou estado explicitamente recuperável, sem duplicação, recursos inacessíveis ou referência órfã. Conservar os contratos já aprovados e acrescentar provas de falha parcial, não repetir somente o fluxo normal.
