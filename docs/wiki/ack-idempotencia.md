# Ack de operação e idempotência

O que o ack de push devolve e como o cliente o consome. O mecanismo de dedupe em si (índice único `(atlas_id, op_id)` + `ON CONFLICT DO NOTHING`) está em [[idempotencia-e-convergence-guard]].

## Por que `idempotent: true` conta como sucesso

O cenário que motivou o campo: o servidor grava e commita, a resposta se perde na rede, o cliente reenvia. Se a segunda resposta fosse tratada como qualquer coisa diferente de sucesso, a op ficaria presa na [[fila-operacoes-outbound]] em loop eterno. `idempotent: true` afirma duas coisas ao mesmo tempo: "está gravado" e "não dupliquei o efeito". Trate `true` e `false` de forma idêntica no dequeue; a distinção é diagnóstica.

## Armadilha: `success: false` existe, mas significa "recusado", nunca "tente de novo"

Esta seção já disse o oposto, e a inversão importa (ver `## Histórico`). A recusa por op em `pushOperations` (`backend/src/modules/sync/sync.service.js`) vem sempre com `rejected: true`, uma `reason` em pt-BR destinada ao usuário, e deixa o lote **sobreviver**. Não a conte por número: ela é uma cadeia de predicados encadeada por `??`, e cada um deles cobre uma classe diferente. Os cinco rodam **antes** do INSERT no log, e só a violação de dado é apanhada depois:

- **endereçamento e alvo**, os dois mais baratos: `foreignAtlasDenialReason` (a op DECLARA ter nascido em outro atlas, cinto e suspensório do namespace por atlas, ver [[dominio-local-vs-remoto]]) e `unknownTargetDenialReason` (`entityType` que este servidor não sabe aplicar). Até 2026-07-25 o segundo era o pior caso possível: gravado no log, acked como **sucesso** e nunca materializado, então o cliente desenfileirava confiante e o dado sumia. O cenário real é skew de deploy, com o frontend estreando um tipo de entidade antes de o backend aprendê-lo;
- **política**: `operationDenialReason` (excluir mapa sem `manage`, travar ou destravar sem ser dono) e `lockedMapDenialReason`, que precisa do banco e por isso vem depois (escrever em mapa bloqueado);
- **visibilidade de recurso**: `unseenResourceDenialReason`, a que nenhuma outra página de sync nomeia. Um `create`/`update` cujo payload REFERE um recurso privado que o autor não enxerga é recusado, para que ninguém plante dentro do atlas uma referência que não consegue abrir. É endurecimento, não a defesa principal, que é do lado da leitura; o predicado é o mesmo SQL de sempre, e a lista de qual chave de qual payload carrega referência é `RESOURCE_REF_EXTRACTORS` (`backend/src/modules/sync/resource-ref.extractors.js`). `delete` fica de fora de propósito: quem PERDEU acesso ainda precisa poder tirar do mapa a camada morta. Ver [[acesso-a-recurso-privado]] e [[sair-do-servidor]];
- **violação de dado** (SQLSTATE classe 22/23), classificada por `integrityRejectionReason` no `catch` do SAVEPOINT, ou seja a única que chega depois da escrita no log. Cada op corre no seu próprio SAVEPOINT, então o rollback alcança só ela. A `reason` é **genérica por segurança**: o texto do driver carrega nome de constraint e de índice, depende do locale, e vai só para o log do servidor.

Desde 2026-09-01 **um lote com recusa deixa rastro no servidor**, uma linha só, agregada por motivo e por alvo (`refusedOpsLogPayload`). Isso não muda nada do que está acima: a resposta continua 200 e o cliente continua recebendo a mesma `reason`. Muda o que se pode responder depois, quando alguém disser que a fila congelou.

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

O outbound do frontend é só REST. `frontend/src/js/store/sync/ws-client.js` trata `ack`/`ack_batch` e reemite um evento interno `'ack'` que **não tem assinante**; `sendOperation`/`sendOperations` não têm chamador fora do módulo. **O que está inerte é esse evento, não a resposta do push:** `acknowledgedOperationIds` (`frontend/src/js/store/sync/sync-engine.js`) lê `results` (ou `acks`, na falta dele), monta o conjunto dos ids que o servidor NOMEOU e devolve a interseção com o lote enviado. O fallback "tudo o que enviei" só entra quando a resposta não identifica operação alguma, que é o contrato antigo por lote. Ver [[fila-operacoes-outbound]].

Antes de migrar o outbound para WS, então, o problema não é estrear `results[]`, que já decide o dequeue: é a **janela** em que ele é interpretado. Hoje pergunta e resposta cabem no mesmo round-trip, e a interseção se resolve contra o lote que acabou de sair. Com `ack`/`ack_batch` assíncronos e fora de ordem, o casamento passa a ser contra o conjunto de ops **em voo**, e o fallback vira armadilha: uma resposta que não identifica op é indistinguível de um ack atrasado de outro lote, e o dequeue por lote inteiro apagaria trabalho que o servidor não confirmou. O mesmo vale se algum dia existir um `success: false` **retentável**: o dequeue de hoje o apagaria como trabalho gravado. Ver [[canal-collab-websocket]] e [[sintese-rest-vs-websocket]].

## Histórico

- 2026-08-23: a seção sobre o caminho WebSocket dizia que "o dequeue real usa os ids que o `flush` enviou, e ignora `results`/`acks` para esse fim". Deixou de valer em 2026-08-15, quando `acknowledgedOperationIds` passou a desenfileirar só o que o servidor NOMEIA. Enquanto durou, esta página e [[fila-operacoes-outbound]] descreviam mecanismos opostos, e o argumento sobre migrar para WS estava construído sobre a premissa velha.
- 2026-08-23: a mesma seção contava "três famílias" de recusa por op, e o mesmo número estava em [[tabela-operations]]. A cadeia tem cinco predicados mais a violação de dado; os que faltavam eram a op nascida em outro atlas e, sobretudo, a recusa por recurso privado invisível ao autor, que nenhuma página de sync nomeava.
- 2026-07-25: a seção acima dizia que "qualquer erro real (FK, UUID inválido, 22P02) aborta a transação". Deixou de valer no mesmo dia: cada op passou a rodar num SAVEPOINT e a violação de dado virou família de `rejected`. O motivo é o de sempre, 400 genérico que não nomeia a op ofensora somado a cliente que não faz dequeue de não-2xx, ou seja fila parada em silêncio. Como rede de segurança, `flush` encolhe o lote para uma op ao receber 400/422 e descarta a ofensora identificada **por construção**, nunca por um id que o servidor mande.
- 2026-07-25: a mesma seção dizia "`success` nunca é `false`" e "não existe falha parcial dentro de um push". Deixou de valer em duas etapas: `1d23ac9` (2026-07-19) trocou o literal por `a.rejected !== true` e passou a recusar por op o delete de mapa e o lock/unlock; `aec63f8` (2026-07-24) converteu o `ConflictError('Map is locked')` na mesma recusa por op. O motivo dos dois é o mesmo: lançar de dentro do lote congelava a fila outbound do usuário indefinidamente.
