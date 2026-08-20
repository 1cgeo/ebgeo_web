# Idempotência por op_id e Convergence Guard

Dois mecanismos independentes: `UNIQUE(atlas_id, op_id)` no servidor mata a *duplicação* por reenvio; o adiamento de ops remotas sobre entidade com edição local não-ackada mata a *divergência* na janela otimista. Nenhum dos dois é merge (ver [[modelo-conflito-lww]]).

O código é denso em comentários de projeto: o bloco que abre `CONVERGENCE_GUARDED` em `frontend/src/js/store/sync/remote-operation-handler.js` e o bloco "P2" de `pushOperations` (`backend/src/modules/sync/sync.service.js`) explicam o mecanismo melhor do que qualquer paráfrase. Esta página registra só o que não está lá.

## Contrato congelado

- **`op_id` nunca pode ser opcional.** O índice é único, mas a coluna é nullable (`backend/src/database/migrations/004_sync.sql`) e em Postgres `NULL` não colide. A única barreira é `id: Joi.string().required()` (`backend/src/modules/sync/sync.schemas.js`), em outro pacote. Relaxar essa linha não quebra teste nenhum: a idempotência simplesmente some, silenciosa, e cada reenvio insere de novo.
- **A guarda falha em aberto.** `shouldApplyVersion` devolve `true` quando `serverVersion == null`, por causa do modo sem backend. Qualquer caminho novo que esqueça de carimbar a versão desliga a guarda sem erro.
- **A comparação é `>=`, não `>`**, enquanto `markAppliedVersion` grava com `>`. Versões iguais reaplicam. É seguro só porque o write é substituição em bloco; não introduza um apply incremental nesses tipos.
- **Idempotência é do log, não do efeito, e é por atlas.** Impede reaplicar a *mesma* op. Duas ops distintas na mesma entidade continuam LWW por chegada, com granularidade de feição inteira ([[modelo-conflito-lww]]). Como a chave inclui `atlas_id`, ela não transplanta para um clone ([[clone-atlas]]) nem existe no import offline ([[atlas-import-offline]]).
- **`CONVERGENCE_GUARDED` é a fonte única das DUAS metades do guarda.** O `operation-dispatcher.js` também gateia por ele para marcar a edição local pendente, então acrescentar um tipo liga o defer e a checagem de versão juntos. Ao criar entidade nova cujo UPDATE substitui em bloco, o conjunto é o único lugar a tocar, e esquecê-lo não gera erro, só divergência.

## O invariante que atravessa três arquivos

O contador de edição pendente é incrementado em `frontend/src/js/store/sync/operation-dispatcher.js`, decrementado via ack HTTP em `recordPushAcks` e varrido em `reconcilePendingLocalEdits` (`frontend/src/js/store/sync/sync-engine.js`). Nenhum arquivo mostra o laço inteiro.

**Não confie no par mark/resolve.** A simetria vaza por compactação de fila, ops em lote, ack sem versão ou lote envenenado, e uma contagem vazada adia ops remotas *para sempre* naquela entidade (divergência silenciosa, sem log). Quem conserta é `reconcilePendingLocalEdits`, que reconcilia contra a fila de operações como fonte de verdade e roda tanto no sucesso quanto na falha do flush. Ao mexer na guarda, o teste de aceitação é esse caminho, não o par feliz.

**Existem dois pontos de aplicação.** `drainPendingFeatureOps` contorna `applyRemoteOperation` e repete a guarda de versão à mão. Alterar a guarda em um lugar só a deixa meia-aplicada para feições cujo mapa chegou atrasado.

## Armadilhas

- **Só o ack HTTP semeia a versão do autor.** O autor descarta o próprio eco do WS, então sem a semeadura ele nunca saberia a ordem de chegada da própria op (racional completo em [[sintese-rest-vs-websocket]]). `frontend/src/js/store/sync/ws-client.js` emite `ack`/`ack_batch` e **nenhum consumidor os assina**: uma busca por assinantes volta vazia. Migrar o push para o WebSocket quebra a guarda sem um único erro visível.
- **A op bufferizada precisa carregar as chaves de junção do [[syncledger]].** `applyRemoteFeatureOp` já foi declarada com 5 parâmetros e chamada com 7: os call sites passavam `opId`/`traceId` e a assinatura os descartava, então o buffer nascia sem eles e o span `apply.persist` do replay saía com a chave indefinida. O elo full-chain se rompia exatamente no caminho bufferizado, que é o mais difícil de diagnosticar sem ele.
- **Estado in-memory e por aba.** F5 zera tudo; a reconciliação real vem do snapshot ([[snapshot-e-pull-incremental]]).
- **`idempotent: true` não é erro.** Trate igual a `false` no dequeue da [[fila-operacoes-outbound]] (ver [[ack-idempotencia]]).
- **Custo escondido:** o `pg_advisory_xact_lock` de `pushOperations` serializa **todos** os pushes de um mesmo atlas. É o preço de tornar `server_version` um cursor de pull confiável, e é um teto de escrita por atlas, não por instância. A espera é limitada a 5 s e o estouro vira 503 retentável, ver [[modelo-conflito-lww]].

Cobertura: `frontend/tests/integration/remote-operation-handler.test.js`.

## Relacionados

[[envelope-operacao]], [[modelo-conflito-lww]], [[fila-operacoes-outbound]], [[aplicacao-operacoes-remotas]], [[tabela-operations]], [[ack-idempotencia]], [[snapshot-e-pull-incremental]], [[sintese-rest-vs-websocket]], [[permissoes-atlas]], [[client-id-estavel]], [[canal-collab-websocket]], [[tipos-entidade-sync]], [[syncledger]].
