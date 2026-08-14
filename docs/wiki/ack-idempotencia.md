# Ack de operação e idempotência

O que o ack de push devolve e como o cliente o consome. O mecanismo de dedupe em si (índice único `(atlas_id, op_id)` + `ON CONFLICT DO NOTHING`) está em [[idempotencia-e-convergence-guard]].

## Por que `idempotent: true` conta como sucesso

O cenário que motivou o campo: o servidor grava e commita, a resposta se perde na rede, o cliente reenvia. Se a segunda resposta fosse tratada como qualquer coisa diferente de sucesso, a op ficaria presa na [[fila-operacoes-outbound]] em loop eterno. `idempotent: true` afirma duas coisas ao mesmo tempo: "está gravado" e "não dupliquei o efeito". Trate `true` e `false` de forma idêntica no dequeue; a distinção é diagnóstica.

## Armadilha: `success: false` existe, mas significa "recusado", nunca "tente de novo"

Esta seção já disse o oposto, e a inversão importa (ver `## Histórico`). Há **três** famílias de item recusado por op em `pushOperations` (`backend/src/modules/sync/sync.service.js`), todas com `rejected: true`, uma `reason` em pt-BR destinada ao usuário, e todas deixando o lote **sobreviver**:

- **recusa de política** sobre uma op só (excluir mapa sem `manage`, travar sem ser dono, escrever em mapa bloqueado);
- **violação de dado** (SQLSTATE classe 22/23). Cada op corre num SAVEPOINT, então o rollback alcança só ela. A `reason` é **genérica por segurança**: o texto do driver carrega nome de constraint e de índice, depende do locale, e vai só para o log do servidor;
- **`entityType` que este servidor não sabe aplicar** (`unknownTargetDenialReason`), recusado **antes** do INSERT no log. Até 2026-07-25 essa op era o pior caso possível: gravada no log, acked como **sucesso** e nunca materializada, então o cliente desenfileirava confiante e o dado sumia. O cenário real é skew de deploy, com o frontend estreando um tipo de entidade antes de o backend aprendê-lo.

O que continua sendo tudo-ou-nada é o que pode dar certo na retentativa: violação de nível (`assertOperationAllowed`), `40001`, `55P03`, queda de conexão. Esses abortam a transação e viram erro HTTP, sem `results[]` nenhum, e é assim de propósito: descartar op boa é perda de dado irreversível, e fila travada não é.

A armadilha, então, não é mais a ausência de `false`; é o que fazer com ele:

- **`success: false` nunca deve virar retry.** Reoferecer uma recusa de política não pode dar certo nunca, e foi exatamente isso que congelou filas outbound inteiras enquanto o servidor lançava em vez de recusar por op. Quem trata isso no cliente é `recordPushAcks` (`frontend/src/js/store/sync/sync-engine.js`): faz dequeue e mostra a `reason` num toast, um por motivo distinto.
- **Recusa sem aviso é pior que erro.** A entidade já saiu do store local e o servidor a manteve; sem a `reason` na tela, o próximo snapshot a traz de volta e o usuário vê a própria ação se desfazer minutos depois, sem explicação. Quem consumir o ack por outro caminho precisa reproduzir esse aviso.
- **200 com todos `true` significa "todas gravadas", não "todas tiveram efeito".** O sinal real de efeito é `idempotent === false` somado ao `rowsAffected` do span `SERVER_APPLIED` (invariante I2 do [[syncledger]]).
- **Esse sinal não cobre o conjunto todo, e lido como universal ele mente.** `applyOperation` (`backend/src/modules/sync/sync.service.js`) só mede a escrita nos updates, nos deletes e no create de **feição**; os demais creates escrevem sem pedir contagem de linhas, e o span grava `null`, classificado como `OK`. Um create de camada que inseriu zero linhas, porque a guarda `EXISTS` prendeu o mapa a outro atlas, fica indistinguível de um create real. Para quem monta asserção sobre o ledger: ausência de `NO_EFFECT` prova efeito só nos três casos medidos, e uma espera por `NO_EFFECT` nos outros nunca dispara.

Ver [[erros-api]] e [[permissoes-atlas]].

## O ack não é só observabilidade (e a armadilha que nasce daí)

Ler `recordPushAcks` de relance sugere tracing puro. Não é: o `currentVersion` de cada `result` alimenta `resolveLocalEdit` (`frontend/src/js/store/sync/remote-operation-handler.js`, exposto também pelo alias `recordLocalAppliedVersion`). O autor filtra o próprio eco de WebSocket e por isso **só aprende a ordem de chegada da própria op pelo ack**. `currentVersion` é insumo de LWW, não um número informativo.

A consequência atravessa backend e frontend e não é visível em nenhum dos dois isoladamente:

> No caso idempotente com log purgado, `prev` não existe, `serverVersion` vem `null` e o fallback de `pushOperations` faz `currentVersion` cair para a **versão atual do atlas**. Esse valor é maior que a versão real da op e semeia `lastAppliedVersion` inflado. A partir daí ops legítimas de peers, com serverVersion menor, são descartadas em silêncio pelo guard: divergência sem erro algum.

Ou seja, purgar o log de operações ([[sync-admin-operacoes]]) não só reabre a janela de replay: contamina o cursor de LWW de quem reenviar. Ver [[modelo-conflito-lww]] e [[snapshot-e-pull-incremental]].

## Contrato congelado

- `results[i]` corresponde a `ops[i]` **na ordem enviada**. Reordenar o lote no servidor quebra todo consumidor que casa por índice.
- `acks[]` é alias legado e não é redundante: carrega `entityId` **como gravado**, que `results[]` não expõe. Ops de nível atlas chegam com o sentinela `'atlas'` e são regravadas sob o UUID do próprio atlas, então broadcast ao vivo e pull incremental só concordam por causa desse campo. Ver [[tabela-operations]] e [[atlas-modelo-de-dados]].
- `op.id` é gerado uma vez na criação da op e **nunca** regenerado em retry. Regerar destrói a idempotência e duplica o efeito. Ver [[envelope-operacao]]; para o `clientId`, que é outra coisa, [[client-id-estavel]].

## O caminho WebSocket está implementado e inerte

O outbound do frontend é só REST. `ws-client.js` trata `ack`/`ack_batch` e reemite um evento interno `'ack'` que **não tem assinante**; `sendOperation`/`sendOperations` não têm chamador fora do módulo. O dequeue real usa os ids que o `flush` enviou, e ignora `results`/`acks` para esse fim.

Antes de migrar o outbound para WS: o dequeue por lote deixa de ser válido, porque `ack`/`ack_batch` chegam assíncronos e fora de ordem em relação ao envio, e aí `results[]` passa a ser obrigatório para decidir o que remover da fila. O mesmo vale se algum dia existir um `success: false` **retentável**: o dequeue de hoje o apagaria como trabalho gravado. Ver [[canal-collab-websocket]] e [[sintese-rest-vs-websocket]].

## Histórico

- 2026-07-25: a seção acima dizia que "qualquer erro real (FK, UUID inválido, 22P02) aborta a transação". Deixou de valer no mesmo dia: cada op passou a rodar num SAVEPOINT e a violação de dado virou família de `rejected`. O motivo é o de sempre, 400 genérico que não nomeia a op ofensora somado a cliente que não faz dequeue de não-2xx, ou seja fila parada em silêncio. Como rede de segurança, `flush` encolhe o lote para uma op ao receber 400/422 e descarta a ofensora identificada **por construção**, nunca por um id que o servidor mande.
- 2026-07-25: a mesma seção dizia "`success` nunca é `false`" e "não existe falha parcial dentro de um push". Deixou de valer em duas etapas: `1d23ac9` (2026-07-19) trocou o literal por `a.rejected !== true` e passou a recusar por op o delete de mapa e o lock/unlock; `aec63f8` (2026-07-24) converteu o `ConflictError('Map is locked')` na mesma recusa por op. O motivo dos dois é o mesmo: lançar de dentro do lote congelava a fila outbound do usuário indefinidamente.
