# Idempotência por op_id e Convergence Guard

Dois mecanismos independentes: `UNIQUE(atlas_id, op_id)` no servidor mata a *duplicação* por reenvio; o adiamento de ops remotas sobre entidade com edição local não-ackada mata a *divergência* na janela otimista. Nenhum dos dois é merge (ver [[sintese-nao-e-crdt]]).

O código é denso em comentários de projeto: `src/js/store/sync/remote-operation-handler.js:84-125` e `backend/src/modules/sync/sync.service.js:634-650` explicam o mecanismo melhor do que qualquer paráfrase. Esta página registra só o que não está lá.

## Contrato congelado

- **`op_id` nunca pode ser opcional.** O índice é único, mas a coluna é nullable (`backend/src/database/migrations/003_sync.sql:39`) e em Postgres `NULL` não colide. A única barreira é `id: Joi.string().required()` (`backend/src/modules/sync/sync.schemas.js:14`), em outro repositório. Relaxar essa linha não quebra teste nenhum: a idempotência simplesmente some, silenciosa, e cada reenvio insere de novo.
- **A guarda falha em aberto.** `shouldApplyVersion` devolve `true` quando `serverVersion == null` (`src/js/store/sync/remote-operation-handler.js:129`), por causa do modo sem backend. Qualquer caminho novo que esqueça de carimbar a versão desliga a guarda sem erro.
- **A comparação é `>=`, não `>`** (`:131`), enquanto `markAppliedVersion` grava com `>` (`:138`). Versões iguais reaplicam. É seguro só porque o write é substituição em bloco; não introduza um apply incremental nesses tipos.
- **Idempotência é do log, não do efeito, e é por atlas.** Impede reaplicar a *mesma* op. Duas ops distintas na mesma entidade continuam LWW por chegada, com granularidade de feição inteira ([[modelo-conflito-lww]]). Como a chave inclui `atlas_id`, ela não transplanta para um clone ([[clone-atlas]]) nem existe no import offline ([[atlas-import-offline]]).

## O invariante que atravessa três arquivos

O contador de edição pendente é incrementado em `src/js/store/sync/operation-dispatcher.js:147`, decrementado em `src/js/store/sync/sync-engine.js:77` (via ack HTTP) e varrido em `src/js/store/sync/sync-engine.js:296-306`. Nenhum arquivo mostra o laço inteiro.

**Não confie no par mark/resolve.** A simetria vaza por compactação de fila, ops em lote, ack sem versão ou lote envenenado, e uma contagem vazada adia ops remotas *para sempre* naquela entidade (divergência silenciosa, sem log). Quem conserta é `reconcilePendingLocalEdits`, que reconcilia contra a fila de operações como fonte de verdade e roda tanto no sucesso quanto na falha do flush. Ao mexer na guarda, o teste de aceitação é esse caminho, não o par feliz.

**Existem dois pontos de aplicação.** `drainPendingFeatureOps` (`:59-82`) contorna `applyRemoteOperation` e repete a guarda de versão à mão. Alterar a guarda em um lugar só a deixa meia-aplicada para feições cujo mapa chegou atrasado.

## Armadilhas

- **Só o ack HTTP semeia a versão do autor.** O autor descarta o próprio eco do WS (`src/js/store/sync/ws-client.js:396-397`), então sem a semeadura ele nunca saberia a ordem de chegada da própria op (racional completo em [[sintese-rest-vs-websocket]]). `src/js/store/sync/ws-client.js:292-311` emite `ack`/`ack_batch` e **nenhum consumidor os assina**: uma busca por assinantes volta vazia. Migrar o push para o WebSocket quebra a guarda sem um único erro visível.
- **Estado in-memory e por aba.** F5 zera tudo; a reconciliação real vem do snapshot ([[snapshot-e-pull-incremental]]).
- **`idempotent: true` não é erro.** Trate igual a `false` no dequeue da [[fila-operacoes-outbound]] (ver [[ack-idempotencia]]).
- **Custo escondido:** `pg_advisory_xact_lock` serializa **todos** os pushes de um mesmo atlas (`backend/src/modules/sync/sync.service.js:650-653`). É o preço de tornar `server_version` um cursor de pull confiável, e é um teto de escrita por atlas, não por instância.

## Contradições

> [!CONTRADICAO] `BRIEFING` substitui em bloco e **não** está guardado.
> O comentário de `CONVERGENCE_GUARDED` (`src/js/store/sync/remote-operation-handler.js:110-113`) justifica o conjunto como "os tipos cujo UPDATE substitui em bloco". Mas `applyRemoteBriefingOp` faz `saveBriefing(briefingId, data)` com o objeto inteiro, incluindo o array de slides, e `BRIEFING` está fora do conjunto ([[tipos-entidade-sync]]). Como o slide isolado é no-op inbound e converge pelo briefing pai, dois usuários editando slides do mesmo briefing não têm proteção LWW nenhuma: o último a chegar leva o array inteiro. Ou o racional do comentário está incompleto, ou falta `BRIEFING` no conjunto.

> [!CONTRADICAO] A op bufferizada perde as chaves de junção do [[syncledger]].
> `applyRemoteFeatureOp` é declarada com 5 parâmetros (`:389`) e chamada com 7 (`:68`, `:282`), passando `opId` e `traceId` que a função ignora. Pior: ela bufferiza só `{opType, featureId, data, serverVersion}` (`:397`), enquanto `drainPendingFeatureOps` lê `op.opId` e `op.traceId` (`:68`, `:72-77`). Os spans `apply.persist` do replay saem com `opId` indefinido, ou seja, o elo full-chain se rompe exatamente no caso que o buffer existe para cobrir.

Cobertura: `tests/integration/remote-operation-handler.test.js:1160`.

## Relacionados

[[envelope-operacao]], [[modelo-conflito-lww]], [[fila-operacoes-outbound]], [[aplicacao-operacoes-remotas]], [[tabela-operations]], [[ack-idempotencia]], [[snapshot-e-pull-incremental]], [[sintese-nao-e-crdt]], [[sintese-rest-vs-websocket]], [[permissoes-atlas]], [[client-id-estavel]], [[canal-collab-websocket]], [[tipos-entidade-sync]], [[syncledger]].
