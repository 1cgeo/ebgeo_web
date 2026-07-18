# Resolução de Conflitos: LWW por Ordem de Chegada

O vencedor de edições concorrentes é a operação com maior `serverVersion` (ordem de chegada ao Postgres), nunca o timestamp de parede nem o relógio Lamport, com granularidade de feição inteira.

## A regra em uma frase

Toda operação recebe, no `INSERT` do backend, um `server_version := nextval('atlas_version_seq')`. Essa é a **única** ordem canônica do sistema. Quem chegar por último ao Postgres vence, ponto. O servidor aplica cada UPDATE incondicionalmente (`version += 1`, `updated_at = NOW()`), sem comparar nada do cliente.

Três campos do [[envelope-operacao]] existem mas **não** decidem conflito:

| Campo | Para que serve de fato |
|---|---|
| `timestamp` (`Date.now()`) | display e log; relógios de máquinas diferentes não são comparáveis |
| `lamportTimestamp` | avança `max(local, remoto)+1` a cada apply remoto; gravado e ecoado, decorativo para o conflito |
| `clientId` | dedupe do próprio eco WS e presença; ver [[client-id-estavel]] |

O `serverVersion` **não é campo do cliente**: ele não existe no envelope enviado, só volta no ack, no broadcast e no pull. Ver [[tabela-operations]] e [[ack-idempotencia]].

## Por que não é CRDT

Não há merge conflict-free descentralizado. O servidor central define a ordem total (modelo *server-authoritative*, à la Figma). O módulo `src/crdt` do backend (resolver/merger por timestamp+clientId) foi removido por ser código morto: o caminho real de escrita (`applyOperation`) nunca lê `client_timestamp`. Detalhe em [[sintese-nao-e-crdt]] e [[sync-lww-operacoes]].

## Granularidade: feição inteira

O LWW é por **entidade**, não por propriedade. Se A muda a cor e B move a geometria da mesma feição ao mesmo tempo, o perdedor perde a mudança **inteira**, não só o campo em conflito. Isso é aceitável porque feições são objetos pequenos e edição concorrente na mesma feição é rara, mas é uma decisão explícita, não um acidente.

No servidor, `update` faz merge raso de objetos aninhados (`properties` é mesclado e a coluna JSONB é sobrescrita com o resultado), mas isso é merge do *payload daquela op*, não reconciliação entre autores.

## Onde o cliente aplica a regra

`src/js/store/sync/remote-operation-handler.js` mantém um `Map` `lastAppliedVersion` por `entityId` (`remote-operation-handler.js:92`) e um guard:

```javascript
// remote-operation-handler.js:128
function shouldApplyVersion(entityKey, serverVersion) {
    if (serverVersion == null) return true;
    const prev = lastAppliedVersion.get(entityKey);
    return prev == null || serverVersion >= prev;
}
```

O guard só roda para os tipos em `CONVERGENCE_GUARDED` (`remote-operation-handler.js:115`): `feature`, `layer`, `group`, `marker3d`, `measurement3d`, `viewshed3d`, `cameraPosition3d`, `orientation360`, `marker360`. São exatamente os tipos cujo UPDATE faz *blind replace* no store local. A checagem é aplicada genericamente em `applyRemoteOperation` (`remote-operation-handler.js:265-272`), então cada handler de entidade permanece ignorante dela. Ver [[aplicacao-operacoes-remotas]] e [[idempotencia-e-convergence-guard]].

## O problema do autor: ele filtra o próprio eco

O autor empurra por HTTP (`POST /atlas/:id/sync`) e recebe o broadcast do próprio op de volta pelo WebSocket, que o `ws-client` descarta por `op.clientId === this._clientId` (`ws-client.js:397`). Consequência: **o autor nunca aprenderia, pelo WS, qual foi o `serverVersion` da própria operação**, e o op mais antigo de um peer poderia sobrescrever o valor (correto) do autor.

A correção é `recordPushAcks` em `sync-engine.js:60-80`: ao ler a resposta do push, o autor semeia sua própria versão aplicada:

```javascript
// sync-engine.js:65,76
const sv = r.currentVersion ?? r.serverVersion ?? resp.serverVersion;
if (sv != null && op.entityId && CONVERGENCE_GUARDED.has(op.entityType)) {
    recordLocalAppliedVersion(op.entityId, sv);
}
```

## A janela sem ack: convergence guard

Entre o gesto local e o ack, a edição do autor existe **sem `serverVersion`**. Aplicar uma op remota nessa janela pode sobrescrever uma edição local possivelmente mais nova. A solução é adiar, não aplicar:

1. No outbound, `operation-dispatcher.js:147` chama `markLocalEditPending(entityId)` para todo tipo guardado, incrementando um contador de edições não-ackadas.
2. No inbound, se o contador for `> 0`, a op remota vai para `deferredRemoteOps` (cap 200 por entidade) e retorna sem aplicar (`remote-operation-handler.js:266-269`).
3. Quando o ack chega, `resolveLocalEdit(entityId, serverVersion)` (`remote-operation-handler.js:173`) semeia a versão, decrementa o contador e, se zerou, **replaya** as ops adiadas pelo guard de versão. A feição converge para `max(serverVersion)` independentemente da ordem de entrega.
4. `reconcilePendingLocalEdits(remainingEntityIds)` (`remote-operation-handler.js:203`) roda após todo flush, comparando o contador com a fila real (fonte da verdade) e curando contadores vazados por compaction, ops em lote ou ack sem versão. Sem isso, um contador vazado **deferiria para sempre** as ops remotas daquela entidade, produzindo divergência silenciosa.

## Idempotência é o que torna o LWW seguro

`UNIQUE (atlas_id, op_id)` + `INSERT ... ON CONFLICT DO NOTHING`: reenviar a mesma op não cria segunda linha, não reaplica o efeito, e retorna ack `{ idempotent: true }` com a `serverVersion` originalmente registrada. Por isso reenviar a fila inteira após reconexão nunca duplica feições, e o dequeue trata `idempotent: true` e `false` do mesmo jeito. Ver [[ack-idempotencia]] e [[fila-operacoes-outbound]].

## Armadilhas

- **Nunca ordene por `timestamp` nem por `lamport`.** É a armadilha central: os dois campos estão no envelope, parecem ordenáveis, e não são. O invariante I3 do [[syncledger]] falha explicitamente se a ordenação derivar deles.
- **O guard é `>=`, não `>`** (`remote-operation-handler.js:131`). Versões iguais reaplicam. Como `atlas_version_seq` é sequência, isso só ocorre em replay/snapshot, e reaplicar é idempotente no efeito. Não "conserte" para `>` sem entender o replay de ops adiadas.
- **`serverVersion == null` desliga o guard** (`remote-operation-handler.js:129`). Ops sem carimbo (legado, testes sem backend) sempre aplicam. Não confie no guard em cenário sem servidor.
- **DELETE limpa a entrada** de `lastAppliedVersion` (`remote-operation-handler.js:347`) para que um re-create com o mesmo id comece do zero. Isso significa que um op antigo chegando *depois* do delete pode ressuscitar a entidade no cliente; o servidor mantém `deleted_at` e a próxima leitura de snapshot corrige.
- **`lastAppliedVersion` é memória de processo.** F5 zera o mapa. A reconciliação real após reload vem do snapshot / pull incremental, não do guard. Ver [[snapshot-e-pull-incremental]].
- **Tipos fora de `CONVERGENCE_GUARDED` não têm guard nenhum no cliente**: `map`, `briefing`, `slide`, `comment`, `catalogLayer`, `setting` e os subtipos de mapa aplicam na ordem de entrega. Para eles o "último a chegar" é literalmente o último pacote WS processado. A ordem do servidor ainda vale para o estado persistido, e o snapshot é o desempate.
- **`atlas_version_seq` é global**, compartilhada por todos os atlas. `server_version` é monotônico dentro de um atlas mas **não contíguo**. Use para ordenar, nunca para contar nem para calcular "quantas ops perdi".
- **Feição antes do mapa:** ops de feature que chegam antes do mapa são bufferizadas, e a versão **não** é registrada (`featureApplied === false`, `remote-operation-handler.js:346`), senão uma op legítima posterior seria descartada pelo guard.
- **Lock:** o servidor só barra escrita em **mapa** travado (`ConflictError('Map is locked')`); locks de camada, grupo e feição são *advisory* no cliente. Ver [[permissoes-atlas]].

## Mutações que fogem do log de operações

`atlas_updated`, `map_duplicated` e `maps_merged` alteram dados no servidor **fora** da tabela `operations`, portanto não têm `serverVersion` comparável. O cliente reage a esses sinais WS fazendo **re-pull de snapshot** (`serverResync`), não apply de op. Ver [[canal-collab-websocket]].

## Contradições com a documentação

> [!CONTRADICAO 2026-07-18] `docs/guias/05-sync-crdt.md` §10 e §16 apresentam um cliente que "aplica o que o servidor mandou" com `applyRemote()` retornando `true` sempre e um `applyRemoteOperation` sem checagem de versão; o código em `src/js/store/sync/remote-operation-handler.js:128,265-272` **descarta** ops com `serverVersion` menor que a última aplicada e **adia** ops sobre entidades com edição local não-ackada. Copiar o pseudocódigo do guia produz divergência em edição concorrente.

> [!CONTRADICAO 2026-07-18] `docs/guias/05-sync-crdt.md` §16 diz para o cliente ignorar ops cujo `clientId` seja o próprio, "responsabilidade do cliente"; isso está correto, mas o guia não menciona que o autor precisa então semear a própria versão pelo ack, feito em `src/js/store/sync/sync-engine.js:76`. Sem esse passo, o filtro de eco sozinho quebra o LWW do lado do autor.

## Fontes

- `docs/guias/05-sync-crdt.md`: regra LWW por chegada, remoção do módulo `src/crdt`, idempotência por `op_id`, formato de ack (`results`/`acks`/`serverVersion`), merge raso de `changes`, e os pseudocódigos divergentes das seções 10 e 16.
- `docs/arquitetura-sync.md`: §3 (papel de `serverVersion`/`lamport`/`clientId` no envelope), §8.1 (coluna `server_version`, `atlas_version_seq` global e não contígua), §11 (LWW + convergence guard + serialização de apply), §12.4 (invariante I3), §13 (comportamentos por design).
- `src/js/store/sync/remote-operation-handler.js`: `lastAppliedVersion` (:92), `CONVERGENCE_GUARDED` (:115), `shouldApplyVersion` (:128), `markLocalEditPending` (:147), `resolveLocalEdit` (:173), `reconcilePendingLocalEdits` (:203), guard em `applyRemoteOperation` (:265-272), limpeza no DELETE (:347).
- `src/js/store/sync/sync-engine.js`: `recordPushAcks` (:60-80) semeando a versão do próprio autor.
- `src/js/store/sync/operation-dispatcher.js`: `markLocalEditPending` no enqueue (:147).
- `src/js/store/sync/ws-client.js`: filtro de self-echo por `clientId` (:397) e cursor `_lastVersion` (:391-393).
