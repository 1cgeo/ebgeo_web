# Comandos compostos e desfazer/refazer

Status: a metade do SERVIDOR fechou em 2026-09-13 (bloco B6, decisão D4); a do cliente e as provas de falha parcial de desfazer/refazer seguem pendentes. Prioridade: bloqueia lançamento. Depende de [persistência](02-persistencia.md) e [conflitos](03-conflitos.md).

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

## O que segue aberto

1. **O envio ainda corta dentro do lote.** O servidor define o lote como as ops daquele `batchId`
   que chegaram no MESMO push, porque a fábrica do cliente carimba `batchId` e `batchIndex` e não um
   total, de modo que ele não tem como saber se faltou membro. Enquanto o recorte do envio for por
   FIFO cego, um gesto maior que o recorte chega como dois lotes lógicos, cada um atômico em si, e o
   gesto continua podendo ser aplicado pela metade. O recorte precisa respeitar a fronteira do lote,
   ou o lote viaja num push próprio.
2. **Nem todo gesto do cliente é um lote.** Conversão de feição, transferência de camada e agrupar
   precisam emitir um único lote com o mesmo `batchId`, na ordem que o servidor exige (pai antes de
   filho, que ele lê por `batchIndex`).
3. **O cliente reconhece UMA palavra de marcador.** O conjunto que dispara o resync tem um elemento,
   e é por isso que os quatro marcadores são publicados com aquela palavra, embora o log guarde o
   nome honesto de cada ato. Quando o cliente aprender os três nomes novos, o tipo publicado vira o
   nome honesto, num commit dos dois pacotes.
4. **Desfazer e refazer continuam sem as provas de falha parcial**, que são as do aceite abaixo:
   falhar no primeiro, no intermediário e no último elemento; falhar depois do commit e antes do
   ACK; repetir o comando depois de um F5; mapa e camada bloqueados, destino excluído, permissão
   alterada e edição concorrente antes do desfazer.
5. **Conjunto grande continua fora.** Preparação durável com ativação no fim é para importação
   grande e ficou fora do lançamento por decisão registrada; o que existe hoje é a recusa com motivo
   acima do teto.

## Aceite

Injetar falha no primeiro, no intermediário e no último elemento; falhar após commit antes do ACK; repetir o comando após F5. Testar mapa/camada bloqueados, destino excluído, permissão alterada e edição concorrente antes do undo. Exigir conjunto inteiro confirmado ou estado explicitamente recuperável, sem duplicação, recursos inacessíveis ou referência órfã. Conservar os contratos já aprovados e acrescentar provas de falha parcial, não repetir somente o fluxo normal.
