# Resolução de Conflitos: LWW por Ordem de Chegada

Toda mutação vira uma operação enfileirada localmente que o servidor ordena por `serverVersion` (ordem de chegada ao Postgres), nunca por timestamp de parede nem pelo relógio Lamport, resolvendo conflitos por last-write-wins com granularidade de feição inteira e idempotência por `op_id`.

## A regra em uma frase

Toda operação recebe, no `INSERT` do backend, um `server_version := nextval('atlas_version_seq')`. Essa é a **única** ordem canônica do sistema. Quem chegar por último ao Postgres vence, ponto. O servidor aplica cada UPDATE incondicionalmente (`version += 1`, `updated_at = NOW()`), sem comparar nada do cliente.

Três campos do [[envelope-operacao]] existem mas **não** decidem conflito:

| Campo | Para que serve de fato |
|---|---|
| `timestamp` (`Date.now()`) | display e log; relógios de máquinas diferentes não são comparáveis |
| `lamportTimestamp` | avança em `advanceLamportClock` (`operation-factory.js:85`), `max(local, remoto)+1` a cada apply remoto; gravado e ecoado, decorativo para o conflito |
| `clientId` | dedupe do próprio eco WS e presença; ver [[client-id-estavel]] |

O `serverVersion` **não é campo do cliente**: ele não existe no envelope enviado, só volta no ack, no broadcast e no pull. Ver [[tabela-operations]] e [[ack-idempotencia]].

## O caminho de uma mutação

1. **Escrita local primeiro.** A mutação passa por `runTransaction` (persistência no IndexedDB antes de qualquer efeito colateral). O log de sync roda no `deferAsync`, então quando a operação é criada o dado já é durável localmente.
2. **Log da operação.** `logFeatureOperation`/`logLayerOperation`/... (`operation-dispatcher.js:278`+) chamam `logOperation`, que cria o envelope via `createOperation` (`operation-factory.js:140`) e o enfileira.
3. **Fila outbound.** `operationQueue.enqueue` grava no store IndexedDB dedicado `ebgeo/operation_queue`, com chave `op_{timestamp}_{id}` para ordenação lexicográfica cronológica (`operation-queue.js:26,84`). Ver [[fila-operacoes-outbound]] e [[fila-operacoes-outbound]].
4. **Flush.** `sync-flush.js` roda a cada 1500 ms e também por evento de mudança, com in-flight guard, e só transmite se `connectionState.isOnline()` (`sync-flush.js:65,126`). `SyncEngine.flush()` empurra lotes de até 100 ops via `apiClient.pushOperations` e só faz `dequeue` depois do aceite do servidor (`sync-engine.js:51,262-291`).
5. **Servidor ordena e aplica.** `pushOperations` (backend `sync.service.js:630`) insere no log e aplica na tabela da entidade.
6. **Broadcast e apply remoto.** Os pares recebem pelo [[canal-collab-websocket]] e aplicam via [[aplicacao-operacoes-remotas]].

A lista de `entityType` está em [[tipos-entidade-sync]].

## O envelope, na prática

`createOperation` produz `{ id, entityType, operationType, entityId, mapId, data, previousData, timestamp, lamportTimestamp, clientId, traceId }` (`operation-factory.js:151-163`). Pontos que costumam confundir:

- **`id` é o `op_id`**, gerado por `generateUUID()` no cliente. É a chave de idempotência no servidor e a chave de correlação do [[syncledger]].
- **`clientId` é estável e persistido** em `localStorage` sob `ebgeo_client_id` (`operation-factory.js:41-51`). É ele que faz o filtro de self-echo no WebSocket (`ws-client.js:397`).
- **`data` carrega o payload inteiro**, mesmo em `update`. O frontend nunca emite `changes`; o backend faz o fallback `changes = data` quando o tipo é `update` (`sync.service.js:216-219`).
- **`previousData`** existe para undo local e não é usado pelo servidor. Undo/redo nunca sincroniza.

## Granularidade: feição inteira

O LWW é por **entidade**, não por propriedade. Se A muda a cor e B move a geometria da mesma feição ao mesmo tempo, o perdedor perde a mudança **inteira**, não só o campo em conflito. Isso é aceitável porque feições são objetos pequenos e edição concorrente na mesma feição é rara, mas é uma decisão explícita, não um acidente.

No servidor, `update` faz merge raso de objetos aninhados (`properties` é mesclado e a coluna JSONB é sobrescrita com o resultado), mas isso é merge do *payload daquela op*, não reconciliação entre autores.

## Por que não é CRDT

Não há merge conflict-free descentralizado. O servidor central define a ordem total (modelo *server-authoritative*, à la Figma). O módulo `src/crdt` do backend (resolver/merger por timestamp+clientId) foi removido por ser código morto: o caminho real de escrita (`applyOperation`) nunca lê `client_timestamp`. Detalhe em [[sintese-nao-e-crdt]].

## Compactação e purga da fila

`_compactEntityOps` (`operation-queue.js:324-350`) roda quando a fila passa de `MAX_QUEUE_SIZE = 10000` e agrupa por `entityType:entityId`:

- CREATE seguido de DELETE, remove as duas (a entidade nunca precisou existir no servidor).
- CREATE seguido de UPDATEs, funde num único CREATE com o `data` mais recente.
- UPDATEs seguidos de DELETE, mantém só o DELETE.
- Vários UPDATEs, mantém só o último.

Além disso há auto-purga de operações com mais de 7 dias, a cada 6 horas (`operation-queue.js:360,381`). **Armadilha:** a compactação quebra a simetria 1-para-1 entre op enfileirada e ack, e é por isso que existe o `reconcilePendingLocalEdits`.

## Guardas pré-flush (o "poison pill")

Um único op inválido faz o **lote inteiro** falhar no `pushOperations` e trava toda a sincronização. Por isso o dispatcher descarta antes de enfileirar:

- **`mapId` de contexto que não é UUID** (`operation-dispatcher.js:133`). O mapa local padrão `Principal` é chaveado por nome, então ops desenhadas nele nunca vazam para um atlas do servidor, e o Postgres nunca recebe um `22P02`. Este é o mecanismo real de anti-vazamento entre [[dominio-local-vs-remoto]] e [[dominio-local-vs-remoto]].
- **`setting` com `entityId` que não é UUID nem o sentinela `'atlas'`** (`operation-dispatcher.js:120`). Chaves locais como `lastActiveMap` são estado de view por cliente e jamais podem subir.
- **Logger de map-setting** (`mapPosition`, `baseLayer`, `mapNotes`, `gridStyle`, `mapTemporal`): descarta quando `mapId` não é UUID (`operation-dispatcher.js:266`).

Cada descarte grava um span `preflush.drop` com o motivo, então "editei e nada sincronizou" tem causa nomeada em vez de sumiço silencioso.

## Ordenação no servidor: o advisory lock

`pushOperations` abre uma transação e **toma um advisory lock por atlas antes do primeiro INSERT** (`sync.service.js:656-670`):

- `server_version` vem de `nextval('atlas_version_seq')` no INSERT, mas a visibilidade só acontece no COMMIT. Sem o lock, duas pushes concorrentes podem commitar fora de ordem: um puller vê a v101, guarda `lastVersion=101`, e a v100 que commitou depois nunca mais é devolvida pelo pull incremental (`WHERE server_version > $lastVersion`). Operação perdida para sempre.
- O lock é transaction-scoped (solta no COMMIT/ROLLBACK) e por atlas, então atlas distintos continuam paralelos.
- Há `SET LOCAL lock_timeout = '5s'` **antes** da espera: a conexão do pool fica retida enquanto bloqueia, e com `poolMax=10` dez pushes concorrentes no mesmo atlas esgotariam o pool inteiro, derrubando até `/health` e `/auth/login`. O timeout converte contenção em um 503 retentável.

Logo, `server_version` é simultaneamente o **cursor do pull incremental** ([[snapshot-e-pull-incremental]]) e a **verdade da ordenação LWW**.

## Idempotência é o que torna o LWW seguro

`UNIQUE (atlas_id, op_id)` + `INSERT ... ON CONFLICT (atlas_id, op_id) DO NOTHING` (`sync.queries.js:6`). Quando não insere nada, o servidor busca a operação anterior e responde `{ opId, serverVersion, idempotent: true, entityId }` **sem reaplicar o efeito** (`sync.service.js:700-722`), com a `serverVersion` originalmente registrada. Por isso reenviar a fila inteira após reconexão nunca duplica feições, e o dequeue trata `idempotent: true` e `false` do mesmo jeito. Ver [[ack-idempotencia]].

Detalhe fácil de errar: ops de nível atlas chegam com o sentinela `'atlas'` como `entityId`, mas `operations.entity_id` é `UUID NOT NULL`. O servidor grava essas contra o **id do próprio atlas** (`sync.service.js:689`) e devolve no ack o `entity_id` **como gravado** (`sync.service.js:734`), para que o par receba o mesmo `entityId` tanto ao vivo quanto via pull incremental.

## Onde o cliente aplica a regra

`remote-operation-handler.js` mantém um `Map` `lastAppliedVersion` por `entityId` (`:92`) e um guard:

```javascript
// remote-operation-handler.js:128
function shouldApplyVersion(entityKey, serverVersion) {
    if (serverVersion == null) return true;
    const prev = lastAppliedVersion.get(entityKey);
    return prev == null || serverVersion >= prev;
}
```

O guard só roda para os tipos em `CONVERGENCE_GUARDED` (`:115-125`): `feature`, `layer`, `group`, `marker3d`, `measurement3d`, `viewshed3d`, `cameraPosition3d`, `orientation360`, `marker360`. São exatamente os tipos cujo UPDATE faz *blind replace* no store local. A checagem é aplicada genericamente em `applyRemoteOperation` (`:265-272`), então cada handler de entidade permanece ignorante dela. Ver [[idempotencia-e-convergence-guard]].

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
2. No inbound, se o contador for `> 0`, a op remota vai para `deferredRemoteOps` (cap 200 por entidade) e retorna sem aplicar (`remote-operation-handler.js:266-272`).
3. Quando o ack chega, `resolveLocalEdit(entityId, serverVersion)` (`:173`, exposto também como alias `recordLocalAppliedVersion`, `:224`) semeia a versão, decrementa o contador e, se zerou, **replaya** as ops adiadas pelo guard de versão. A feição converge para `max(serverVersion)` independentemente da ordem de entrega.
4. `reconcilePendingLocalEdits(remainingEntityIds)` (`:203`) roda após **todo** flush, inclusive no caminho de erro, via `_reconcileConvergenceGuard` (`sync-engine.js:281,289,298`), comparando o contador com a fila real (fonte da verdade) e curando contadores vazados por compaction, ops em lote ou ack sem versão. Sem isso, um contador vazado **deferiria para sempre** as ops remotas daquela entidade, produzindo divergência silenciosa.

Caso irmão: um `feature/create` pode chegar antes do `map/create` do mapa que o contém (A cria um mapa e desenha nele em seguida). O handler **bufferiza por `mapId`** (teto de 1000) e reaplica quando o mapa chega, passando os ops reproduzidos pelo mesmo version guard (`:42-82`). Descartar ali seria perda de dado silenciosa no par.

## Delete vence update

O soft-delete marca `deleted_at`; o `buildUpdateQuery` de feature/layer/group **não** filtra `deleted_at IS NULL` (`sync.service.js:1063-1083`), mas também não limpa `deleted_at`. Resultado: um UPDATE que chega depois de um DELETE altera colunas de uma linha já morta e não a ressuscita, e o snapshot continua não a devolvendo. O delete de um layer também faz cascade nos features do layer, na mesma transação (`sync.service.js:1645`).

## Escrita colaborativa é só por sync

Não existe rota REST de escrita para feature, layer, group, map, briefing, slide, cesium3d ou streetview360. `maps` e `briefings` têm apenas GET. Toda mutação viaja como operação, seja por `POST /atlas/:id/sync` seja por mensagem `operation` no WebSocket. Ver [[sintese-rest-vs-sync]] e [[sintese-rest-vs-websocket]]. O gate de papel por atlas é aplicado em `assertOperationAllowed` antes do INSERT (`sync.service.js:677`); ver [[permissoes-atlas]] e [[permissoes-atlas]].

## Mutações que fogem do log de operações

`atlas_updated`, `map_duplicated` e `maps_merged` alteram dados no servidor **fora** da tabela `operations`, portanto não têm `serverVersion` comparável. O cliente reage a esses sinais WS fazendo **re-pull de snapshot** (`serverResync`), não apply de op.

## Armadilhas

- **Nunca ordene por `timestamp` nem por `lamport`.** É a armadilha central: os dois campos estão no envelope, parecem ordenáveis, e não são. O invariante I3 do [[syncledger]] falha explicitamente se a ordenação derivar deles.
- **O guard é `>=`, não `>`** (`remote-operation-handler.js:131`). Versões iguais reaplicam. Como `atlas_version_seq` é sequência, isso só ocorre em replay/snapshot, e reaplicar é idempotente no efeito. Não "conserte" para `>` sem entender o replay de ops adiadas.
- **`serverVersion == null` desliga o guard** (`:129`). Ops sem carimbo (legado, testes sem backend) sempre aplicam. Não confie no guard em cenário sem servidor.
- **DELETE limpa a entrada** de `lastAppliedVersion` (`:347`) para que um re-create com o mesmo id comece do zero. Isso significa que um op antigo chegando *depois* do delete pode ressuscitar a entidade no cliente; o servidor mantém `deleted_at` e a próxima leitura de snapshot corrige.
- **`lastAppliedVersion` é memória de processo.** F5 zera o mapa. A reconciliação real após reload vem do snapshot / pull incremental, não do guard.
- **Tipos fora de `CONVERGENCE_GUARDED` não têm guard nenhum no cliente**: `map`, `briefing`, `slide`, `comment`, `catalogLayer`, `setting` e os subtipos de mapa aplicam na ordem de entrega. Para eles o "último a chegar" é literalmente o último pacote WS processado. A ordem do servidor ainda vale para o estado persistido, e o snapshot é o desempate. **Ao adicionar um `entityType` que substitui em bloco, inclua-o em `CONVERGENCE_GUARDED`.**
- **Não confie em merge por propriedade.** Se um novo campo precisa sobreviver a edição concorrente, ou ele entra no mesmo payload, ou vira entidade própria (foi assim que resposta de comentário virou entidade separada, ver [[comentario-espacial]]).
- **Nunca deixe um op com `mapId` ou `entityId` não-UUID chegar ao flush.** Um `22P02` derruba o lote inteiro e trava a sincronização de todos os tipos, não só do op ruim.
- **O ack é a única fonte da ordem servidor para o autor.** Descartar a resposta de `pushOperations` (como já foi feito historicamente) quebra a convergência de forma silenciosa e só aparece em teste de dois usuários.
- **`atlas_version_seq` é global**, compartilhada por todos os atlas. `server_version` é monotônico dentro de um atlas mas **não contíguo**. Use para ordenar, nunca para contar nem para calcular "quantas ops perdi".
- **Feição antes do mapa:** ops de feature bufferizadas **não** registram a versão (`featureApplied === false`, `:346`), senão uma op legítima posterior seria descartada pelo guard.
- **Deslogado, a fila continua acumulando** até a purga de 7 dias. Ao desconectar/deslogar, `disconnect`/`logoutAndDisconnect` desligam o log e zeram o atlas, ver [[sessao-boot-e-ciclo-de-vida]].
- **Ao adicionar campo persistido, cubra os dois caminhos** (`.ebgeo` e sync). Cobertura de sync tem que ser superconjunto do `.ebgeo`, ver [[atlas-modelo-de-dados]] e [[formato-ebgeo-roundtrip]].
- **Lock:** o servidor só barra escrita em **mapa** travado (`ConflictError('Map is locked')`); locks de camada, grupo e feição são *advisory* no cliente.

## Contradições com a documentação

> [!CONTRADICAO 2026-07-18] guia *05-sync-crdt* (absorvido) §10 e §16 apresentam um cliente que "aplica o que o servidor mandou" com `applyRemote()` retornando `true` sempre e um `applyRemoteOperation` sem checagem de versão; o código em `src/js/store/sync/remote-operation-handler.js:128,265-272` **descarta** ops com `serverVersion` menor que a última aplicada e **adia** ops sobre entidades com edição local não-ackada. Copiar o pseudocódigo do guia produz divergência em edição concorrente.

> [!CONTRADICAO 2026-07-18] guia *05-sync-crdt* (absorvido) §16 diz para o cliente ignorar ops cujo `clientId` seja o próprio, "responsabilidade do cliente"; isso está correto, mas o guia não menciona que o autor precisa então semear a própria versão pelo ack, feito em `src/js/store/sync/sync-engine.js:76`. Sem esse passo, o filtro de eco sozinho quebra o LWW do lado do autor.

> [!CONTRADICAO 2026-07-18] guia *acoes-interface-multiusuario* (absorvido):638` diz "resolução de conflito é last-write-wins com timestamp do servidor". O código resolve por **ordem de chegada**: `server_version` sai de `nextval('atlas_version_seq')` sob advisory lock por atlas (`backend/src/modules/sync/sync.service.js:636-661`) e o cliente compara `serverVersion` em `shouldApplyVersion`. Nenhum timestamp participa da decisão. O topo do mesmo documento (linha 6) e guia *00-visao-geral* (absorvido):86` estão corretos.

> [!CONTRADICAO 2026-07-18] guia *00-visao-geral* (absorvido):18,109` e as migrações `003_sync.sql` chamam o mecanismo de "CRDT". Não é: o servidor define ordem total e resolve por LWW, sem merge comutativo. O nome sobrevive apenas em rotas, tabelas e títulos de guia. guia *ui-ux-ebgeo* (absorvido):161` já registra a correção.

> [!CONTRADICAO 2026-07-18] guia *visao-e-principios* (absorvido) §P1 diz que "o log de operações e o flush são gated por conexão". Só o **flush** é gated. O log é ligado incondicionalmente no boot (`src/js/store/services.js:81`, `enableOperationLogging()`) e só é desligado em conexão de visitante público anônimo (`sync-engine.js:227`) e no logout (`sync-engine.js:375`). Deslogado, as ops continuam entrando na fila local; o que impede vazamento é o descarte por `mapId` não-UUID mais a auto-purga de 7 dias.

## Relacionados

[[idempotencia-e-convergence-guard]], [[envelope-operacao]], [[fila-operacoes-outbound]], [[aplicacao-operacoes-remotas]], [[snapshot-e-pull-incremental]], [[canal-collab-websocket]], [[canal-collab-websocket]], [[presenca-colaborativa]], [[syncledger]], [[modos-operacao]], [[atlas-modelo-de-dados]], [[sintese-limites-collab]], [[sintese-decisoes-arquiteturais]].

## Fontes

- guia *05-sync-crdt* (absorvido): regra LWW por chegada, remoção do módulo `src/crdt`, idempotência por `op_id`, formato de ack (`results`/`acks`/`serverVersion`), merge raso de `changes`, e os pseudocódigos divergentes das seções 10 e 16.
- guia *arquitetura-sync* (absorvido): §3 (papel de `serverVersion`/`lamport`/`clientId` no envelope), §8.1 (coluna `server_version`, `atlas_version_seq` global e não contígua), §11 (LWW + convergence guard + serialização de apply), §12.4 (invariante I3), §13 (comportamentos por design).
- guia *visao-e-principios* (absorvido): P6 (offline-first, fila que drena), P8 (undo local), P10 (LWW sem locks), §6 (isolamento por atlas, chaveamento UUID vs nome), §7 (mecanismos de resiliência); contradição do P1 sobre o gating do log.
- guia *00-visao-geral* (absorvido): decisão D2 (LWW por ordem de chegada, delete vence updates subsequentes) e o uso residual do nome "CRDT".
- guia *acoes-interface-multiusuario* (absorvido) e guia *ui-ux-ebgeo* (absorvido): ausência de locks, enquadramento "server-authoritative LWW", respostas de comentário como entidades próprias.
- `src/js/store/sync/remote-operation-handler.js`: buffer por `mapId` (:42-82), `lastAppliedVersion` (:92), `CONVERGENCE_GUARDED` (:115-125), `shouldApplyVersion` (:128), `markAppliedVersion` (:135), `markLocalEditPending` (:147), `resolveLocalEdit` (:173), `reconcilePendingLocalEdits` (:203), guard em `applyRemoteOperation` (:265-272), limpeza no DELETE (:347).
- `src/js/store/sync/sync-engine.js`: `recordPushAcks` (:60-80), flush em lote e dequeue pós-aceite (:262-291), `_reconcileConvergenceGuard` (:281,289,298).
- `src/js/store/sync/operation-dispatcher.js` (guardas pré-flush :120,133,266; `markLocalEditPending` :147), `operation-factory.js` (envelope e `clientId`), `operation-queue.js` (fila, compactação, purga), `sync-flush.js` (gating por conexão), `ws-client.js` (self-echo :397, cursor `_lastVersion` :391-393), `src/js/store/services.js:81`.
- `backend/src/modules/sync/sync.service.js` e `sync.queries.js`: advisory lock por atlas, `server_version`, `ON CONFLICT (atlas_id, op_id)`, fallback `changes = data`, sentinela `'atlas'`, guardas IDOR e cascade de delete de layer.
- `backend/CLAUDE.md`: contrato "escrita colaborativa é só via sync", remoção do módulo `src/crdt`, hierarquia de permissão por atlas.
