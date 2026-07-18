# Síntese: por que o EBGeo não é um CRDT

Apesar do nome do guia, o sistema é server-authoritative com LWW por ordem de chegada, o módulo CRDT por timestamp+clientId foi removido como código morto e o Lamport clock é decorativo.

## O que o sistema realmente é

Um **log de operações server-authoritative**, no modelo Figma: o servidor central define a **ordem total**. O vencedor de um conflito é a operação com maior `serverVersion`, carimbado por `nextval('atlas_version_seq')` no Postgres na hora em que a op chega. Não existe merge conflict-free descentralizado, não existe reconciliação entre réplicas sem servidor, não existe estrutura de dados com propriedade de convergência matemática. Detalhe do reducer em [[modelo-conflito-lww]] e [[modelo-conflito-lww]].

O que sobrou de "CRDT" no repositório é vocabulário: comentários em `src/js/store/sync/sync-engine.js:327`, `ws-client.js:355` e `sync-metadata.js:9` ainda dizem "CRDT op log" / "CRDT-like". É apenas o nome informal do log de ops. O diretório `src/crdt` (resolver/merger por timestamp+clientId) **não existe mais**, foi removido por ser código morto, e o caminho de escrita real nunca comparou `client_timestamp`.

## Os três tokens que NÃO decidem o vencedor

O envelope da operação ([[envelope-operacao]]) carrega três coisas que parecem árbitros de conflito e não são:

| Campo | Onde nasce | Para que serve de verdade |
|---|---|---|
| `timestamp` (parede) | `operation-factory.js:159` (`Date.now()`) | log, ordenação local, exibição. Sujeito a clock skew, nunca comparado no apply |
| `lamportTimestamp` | `operation-factory.js:160` (`++lamportClock`) | causalidade registrada. **Decorativo** para conflito |
| `clientId` | `getClientId()`, ver [[client-id-estavel]] | de-dupe do próprio eco no WS (`ws-client.js:397`) e presença |

O relógio Lamport avança em `max(local, remoto) + 1` a cada apply remoto (`operation-factory.js:85-87`, chamado por `sync-gateway.js:48-49`), é persistido na coluna `lamport_timestamp` e ecoado no pull, mas **nenhum reducer o lê para eleger vencedor**. Isso é uma invariante testável explícita do [[syncledger]] (I3: falha se a ordenação derivar de `timestamp`/`lamport`; I11 exige só a monotonicidade do relógio).

Armadilha prática: ao debugar divergência, ordenar os spans ou as ops por `timestamp`/`lamport` produz uma narrativa plausível e **errada**. Ordene sempre por `serverVersion`.

## Onde o LWW é aplicado no cliente

`remote-operation-handler.js` mantém `lastAppliedVersion` por `entityId` e descarta ops mais antigas:

```js
// remote-operation-handler.js:128-132
function shouldApplyVersion(entityKey, serverVersion) {
    if (serverVersion == null) return true; // sem carimbo (legacy / sem backend) → sem guarda
    const prev = lastAppliedVersion.get(entityKey);
    return prev == null || serverVersion >= prev;
}
```

Duas consequências que costumam surpreender:

- **`serverVersion == null` desliga a guarda** (`remote-operation-handler.js:129`). Ops não carimbadas (caminho legado, fixture de teste, backend ausente) aplicam sempre. Ao escrever teste de convergência, carimbe `serverVersion` ou o teste não testa nada.
- **O guard só vale para tipos guardados.** `CONVERGENCE_GUARDED` (`remote-operation-handler.js:115-125`) cobre feature, layer, group, marker3d, measurement3d, viewshed3d, cameraPosition3d, orientation360, marker360. `map`, `briefing`, `slide`, `comment` e as sub-entidades de mapa passam direto pelo `if (guarded)` em `remote-operation-handler.js:265-273`, sem guarda de versão: para eles vale a ordem de aplicação bruta. Lista completa de tipos em [[tipos-entidade-sync]].

O convergence guard (adiar a op remota enquanto há edição local não-ackada, e replayar no ack via `resolveLocalEdit`, `remote-operation-handler.js:173-191`) **não é merge**: é apenas serialização, para que o vencedor por `serverVersion` seja aplicado por último. Detalhe em [[idempotencia-e-convergence-guard]] e [[aplicacao-operacoes-remotas]].

## Granularidade: a feição inteira, não a propriedade

Um UPDATE substitui em bloco. Duas pessoas editando **propriedades diferentes da mesma feição** ao mesmo tempo não fazem merge: a op de maior `serverVersion` sobrescreve a outra por completo. É exatamente o que um CRDT de verdade evitaria (LWW-Map por campo, ou RGA/Yjs para texto/geometria). Vértices de geometria também são replace total, nunca merge por vértice. Ver [[sintese-limites-collab]].

Idempotência é por `op_id` (`UNIQUE (atlas_id, op_id)` + `ON CONFLICT DO NOTHING`), não por conteúdo. Reenviar a mesma op é seguro, reenviar uma op equivalente com `id` novo não é. Ver [[ack-idempotencia]] e [[tabela-operations]].

## Por que essa escolha

- **Existe um servidor de qualquer jeito** (auth, atlas, permissões, imagens). Se há um ponto central obrigatório, a complexidade de um CRDT paga por uma propriedade (convergência sem coordenação) que o produto não precisa.
- **O offline-first é resolvido por fila, não por merge.** A [[fila-operacoes-outbound]] em IndexedDB, com compactação (CREATE+DELETE remove ambas, CREATE+UPDATEs mescla) e flush gateado por conexão, cobre o caso real (usuário desconecta e volta), sem estrutura de dados especial. A separação local/remoto é o marcador de origem, ver [[dominio-local-vs-remoto]].
- **Simplicidade de auditoria.** `serverVersion` monotônico dá um total order legível: o log de ops é a fonte de verdade e o [[snapshot-e-pull-incremental]] é derivável dele.
- O custo aceito: conflitos concorrentes na mesma feição **perdem trabalho** (o perdedor some), e não há como reconstruir a intenção. Isso é decisão consciente, não bug. Ver [[sintese-decisoes-arquiteturais]].

## Contradições no repositório

> [!CONTRADICAO 2026-07-18] O cabeçalho de `src/js/store/sync/index.js:30-38` afirma "Last-Writer-Wins with Lamport timestamps for ordering", "LWW by lamportTimestamp + version" para propriedades simples e "LWW per field (field-level granularity)" para layers e maps, além de "FUTURE BACKEND INTEGRATION". O código faz LWW por `serverVersion` apenas (`remote-operation-handler.js:128-132`), a granularidade é a entidade inteira (UPDATE blind-replace, `remote-operation-handler.js:111-113`) e o backend já existe e está ligado. Esse bloco de JSDoc é resíduo do módulo CRDT removido.

> [!CONTRADICAO 2026-07-18] `src/js/store/sync/index.js:37` e `sync-metadata.js:20-35` documentam `setServerTimeOffset()` como compensação de clock skew "para resolução de conflito". Como o conflito nunca lê `timestamp`, o offset não influencia nenhuma decisão de vencedor, é metadado de exibição.

O nome do arquivo guia *05-sync-crdt* (absorvido) também é histórico: o próprio documento abre desmentindo o título (linhas 15-30). Ao ler o guia, trate "CRDT" como sinônimo de "log de operações".

## Checklist para não errar

1. Ordenou por `timestamp` ou `lamport` em qualquer lugar? Bug.
2. Espera merge por propriedade em edição concorrente? Não acontece.
3. Teste de convergência sem `serverVersion` no fixture? A guarda está desligada (`shouldApplyVersion` retorna `true`).
4. Adicionou entidade nova que faz UPDATE blind-replace? Inclua em `CONVERGENCE_GUARDED`, senão ela não converge.
5. Reenvio de op: reutilize o mesmo `op.id`, nunca gere um novo.
6. Escrita de entidade colaborativa via REST? Não existe rota, tudo viaja como operação pelo [[canal-collab-websocket]] e pelo push HTTP, ver [[canal-collab-websocket]].

## Fontes

- guia *05-sync-crdt* (absorvido): declaração explícita de LWW por ordem de chegada, remoção do módulo `src/crdt` como código morto, formatos de envelope (frontend e legacy), tipos de entidade, idempotência por `op_id` (seção 12), limite de 500 ops por push.
- guia *arquitetura-sync* (absorvido): "não é um CRDT no sentido estrito" e modelo server-authoritative à la Figma (linha 40), `serverVersion` como verdade do LWW (linhas 62-73, 266-267), seção 11 (convergence guard, buffering, serialização de apply), invariantes I3 e I11 do SyncLedger.
- `src/js/store/sync/remote-operation-handler.js`: `shouldApplyVersion`/`markAppliedVersion` (128-138), `CONVERGENCE_GUARDED` (115-125), aplicação do guard (265-273), `resolveLocalEdit`/`reconcilePendingLocalEdits` (173-220).
- `src/js/store/sync/operation-factory.js`: `advanceLamportClock` (85-87), carimbo do envelope (151-163, 176-190).
- `src/js/store/sync/sync-gateway.js`: avanço do Lamport no apply remoto (48-49).
- `src/js/store/sync/ws-client.js`: de-dupe do próprio eco por `clientId` (397), singleton com `clientId` estável (573).
- `src/js/store/sync/index.js`: cabeçalho JSDoc desatualizado (30-38), origem das duas contradições registradas acima.
