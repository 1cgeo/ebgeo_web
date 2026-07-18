# Síntese: por que o EBGeo não é um CRDT

O sistema é server-authoritative com LWW por ordem de chegada; o vocabulário "CRDT" que sobrou no repositório é resíduo de um módulo removido e engana quem confia nele.

## A decisão, e a alternativa rejeitada

CRDT foi tentado e descartado: o diretório `src/crdt` (resolver/merger por `timestamp`+`clientId`) existiu e foi removido como código morto, porque o caminho real de escrita nunca chegou a comparar `client_timestamp`. O que ficou é o modelo Figma: servidor central define ordem total por `serverVersion`.

O racional que o código apaga por construção:

- **Já existe um servidor obrigatório** (auth, atlas, permissões, imagens). Havendo ponto central de qualquer forma, o CRDT cobraria a complexidade de convergência-sem-coordenação, uma propriedade que o produto não usa.
- **Offline-first é resolvido por fila, não por merge.** A [[fila-operacoes-outbound]] com compactação e flush gateado por conexão cobre o caso real (desconectar e voltar) sem estrutura de dados especial. Ver [[dominio-local-vs-remoto]].
- **Custo aceito conscientemente:** conflito na mesma feição **perde trabalho**, o perdedor some e a intenção não é reconstruível. Não é bug. Ver [[sintese-decisoes-arquiteturais]] e [[modelo-conflito-lww]].

## As armadilhas do guard de convergência

O reducer e os três campos-isca do envelope (`timestamp`, `lamportTimestamp`, `clientId`, nenhum decide vencedor) estão em [[modelo-conflito-lww]] e [[envelope-operacao]]. O que **não** se lê seguindo as chamadas:

- **`serverVersion == null` desliga a guarda inteira** (`src/js/store/sync/remote-operation-handler.js:128-132` retorna `true` sem carimbo). Fixture de teste sem `serverVersion` faz o teste de convergência não testar nada, e ele passa verde.
- **A guarda é parcial, e a lista é opt-in.** `CONVERGENCE_GUARDED` (`src/js/store/sync/remote-operation-handler.js:115-125`) cobre feature, layer, group e as entidades 3D/360. `map`, `briefing`, `slide` e `comment` passam direto pelo `if (guarded)` (`src/js/store/sync/remote-operation-handler.js:265-272`): para eles vale a ordem bruta de chegada do apply. Entidade nova que faz UPDATE blind-replace e não entra no Set **não converge**, e nada acusa. Tipos em [[tipos-entidade-sync]].
- **O autor só aprende a própria ordem pelo ack.** Ele filtra o próprio eco no WS por `clientId` (`src/js/store/sync/ws-client.js:397`), então `lastAppliedVersion` da entidade que ele editou é semeada exclusivamente por `resolveLocalEdit` no push ack (`src/js/store/sync/remote-operation-handler.js:173-192`). Quebrar o consumo do ack não dá erro visível: o autor simplesmente passa a aceitar ops antigas de peers.
- **Contagem de edição pendente vaza, e vazar significa divergência silenciosa.** O incremento vem do dispatcher e o decremento do flush; compactação de fila, ops em lote e ack sem versão quebram a simetria, e um contador preso em >0 deferiria as ops remotas daquela entidade **para sempre**. É exatamente por isso que existe o reconcile contra a fila após cada flush (`src/js/store/sync/remote-operation-handler.js:203-221`), e é por isso que ele não é opcional. Ver [[idempotencia-e-convergence-guard]] e [[aplicacao-operacoes-remotas]].

O deferir-e-replayar **não é merge**: é serialização, para que o vencedor por `serverVersion` seja aplicado por último.

## Contrato congelado

- **Ordene sempre por `serverVersion`.** Ao debugar divergência, ordenar spans ou ops por `timestamp`/`lamport` produz narrativa plausível e errada. O invariante I3 do [[syncledger]] falha de propósito se alguma ordenação derivar deles (I11 exige só monotonicidade do relógio).
- **Granularidade é a feição inteira, nunca a propriedade.** Duas pessoas em campos diferentes da mesma feição não fazem merge; geometria é replace total, jamais merge por vértice. Ver [[sintese-limites-collab]].
- **Idempotência é por `op_id`, não por conteúdo.** Reenviar a mesma op é seguro; reenviar op equivalente com `id` novo duplica. Ver [[ack-idempotencia]] e [[tabela-operations]].
- **Escrita de entidade colaborativa não tem rota REST.** Tudo viaja como operação, ver [[canal-collab-websocket]] e [[sintese-rest-vs-sync]].

## Contradições no repositório

> [!CONTRADICAO 2026-07-18] O cabeçalho de `src/js/store/sync/index.js:30-41` afirma "LWW by lamportTimestamp + version" para propriedades simples, "LWW per field (field-level granularity)" para layers e maps, e "FUTURE BACKEND INTEGRATION". O código faz LWW por `serverVersion` apenas (`src/js/store/sync/remote-operation-handler.js:128-132`), a granularidade é a entidade inteira, e o backend já existe e está ligado. Resíduo do módulo CRDT removido.

> [!CONTRADICAO 2026-07-18] `src/js/store/sync/index.js:37` e `src/js/store/sync/sync-metadata.js:18-35` documentam `setServerTimeOffset()` como compensação de clock skew para resolução de conflito. Como o conflito nunca lê `timestamp`, o offset não influencia decisão de vencedor alguma; e nenhum call site o invoca fora do próprio barrel, então na prática ele é zero permanente.

Os comentários remanescentes com "CRDT op log" (`src/js/store/sync/sync-engine.js:327`, `src/js/store/sync/ws-client.js:355`, `src/js/store/sync/sync-metadata.js:9`) são apenas nome informal do log de ops. O guia absorvido *05-sync-crdt* carrega o mesmo resíduo no título e se desmente no próprio corpo.

## Páginas comparadas

[[modelo-conflito-lww]], [[idempotencia-e-convergence-guard]], [[aplicacao-operacoes-remotas]], [[envelope-operacao]], [[sintese-limites-collab]], [[sintese-decisoes-arquiteturais]].
