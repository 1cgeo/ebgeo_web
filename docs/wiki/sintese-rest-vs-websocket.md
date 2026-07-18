# Síntese: quando usar REST e quando usar WebSocket

Quadro de decisão entre os dois canais complementares do sync, push/pull HTTP como caminho de recuperação e fonte de ack confiável, WebSocket como transporte de tempo real e de sinais que exigem re-pull.

## O quadro de decisão em uma tabela

| Preciso de... | Canal | Onde |
|---|---|---|
| Enviar mutação de entidade (feature/layer/map/group/briefing/slide/3D/360/catalogLayer) | **REST** `POST /atlas/:id/sync` | `sync-engine.js:272` |
| Carregar o atlas ao abrir (estado completo) | **REST** `GET /atlas/:id/sync/0` (snapshot) | `sync-engine.js:157` |
| Recuperar o que perdi depois de ficar offline | **REST** `GET /atlas/:id/sync/:version` (incremental) | `sync-engine.js:314` |
| Recuperar o que perdi durante uma queda curta de socket | **WS** `sync_request{lastVersion}` | `ws-client.js:426` |
| Receber a mutação de um peer, agora | **WS** `operation`/`operations` | `ws-client.js:286` |
| Cursor, seleção, cursor temporal, roster, away/back | **WS** apenas (efêmero, nunca persiste) | `ws-client.js:321` |
| Saber que alguém clonou/mesclou mapa ou renomeou o atlas | **WS** sinal, seguido de **REST** re-pull de snapshot | `ws-client.js:352`, `sync-engine.js:493` |
| Blob de imagem | **REST** dedicado (`/atlas/:id/images`) | `image-sync.js` |
| Login, refresh, CRUD de atlas, sharing, settings, config | **REST** | `api-client.js` |

Regra mental: **o que precisa durar vai por HTTP; o que precisa ser rápido e é descartável vai por WebSocket**. A única exceção é o inbound de operações, que é durável mas chega por WS, porque quem já persistiu foi o servidor.

## O que o código realmente faz no outbound (e onde a prosa erra)

O cliente **nunca** envia operações pelo WebSocket. Todo outbound é HTTP:

```
gesto → runTransaction → logXxxOperation → operationQueue (IndexedDB)
      → sync-flush (timer 1,5s + eventos, só se ONLINE)
      → syncEngine.flush() → apiClient.pushOperations (lotes de 100)
```

`startAutoFlush` roda um `setInterval` de 1500 ms (`sync-flush.js:126`), com gate `connectionState.isOnline()` e gate de fila não vazia (`sync-flush.js:65-68`), mais um flush oportunista por evento de ciclo de vida (`sync-flush.js:28-45`). O lote sai com `FLUSH_BATCH_SIZE = 100` (`sync-engine.js:50`) e só é removido da fila **depois** do 200 (`sync-engine.js:284-285`); um lote rejeitado permanece enfileirado e é retentado.

`WsClient.sendOperation`/`sendOperations` existem (`ws-client.js:161`, `ws-client.js:170`) mas **não têm nenhum chamador em `src/js`**, apenas testes. São superfície de protocolo mantida por compatibilidade, não caminho quente.

> [!CONTRADICAO 2026-07-18] `docs/guias/05-sync-crdt.md` §5 diz "Em tempo real, prefira o canal WebSocket; o push HTTP é o caminho de recuperação"; o cliente real faz o inverso: o push HTTP é o caminho **normal** (`sync-flush.js:130` → `sync-engine.js:272`) e o WS não é usado para outbound de operações (`ws-client.js:161` sem chamador). O mesmo vale para a implementação de referência de `docs/guias/04-websocket-collab.md` §7, que envia ops por `sendOperation`.

Consequência prática: a latência de propagação de uma edição tem um piso do intervalo de flush (mitigado pelo flush por evento), e o **ack canônico do autor é a resposta HTTP**, não a mensagem `ack` do WS. Ver [[envelope-operacao]], [[fila-operacoes-outbound]] e [[ack-idempotencia]].

## Por que o ack HTTP importa mais do que parece

`recordPushAcks` (`sync-engine.js:60-79`) não só registra spans do [[syncledger]]: ele **semeia a `serverVersion` da própria operação do autor** em `recordLocalAppliedVersion`, para os tipos sob convergence guard. Isso é obrigatório porque o autor **descarta o próprio eco** que volta pelo WS (`ws-client.js:397`). Sem essa semeadura, o autor nunca saberia a ordem de chegada da própria op e uma op concorrente mais antiga de um peer poderia sobrescrever o valor correto. Detalhe do mecanismo em [[idempotencia-e-convergence-guard]] e [[modelo-conflito-lww]].

Armadilha: se você mover o outbound para o WS, precisa mover essa semeadura para o handler de `ack`/`ack_batch` (`ws-client.js:292-313`), ou quebra o guard silenciosamente.

## Inbound: WS é o gatilho, não a autoridade

O peer recebe a op por WS, mas a autoridade continua sendo o `serverVersion` carimbado pelo servidor. O caminho é `ws-client._applyInboundOps` → `sync-gateway.applyRemoteOperation` (early-return se offline, `sync-gateway.js:39`) → `remote-operation-handler`. Ver [[aplicacao-operacoes-remotas]].

Três detalhes do transporte que não são opcionais:

- **Self-echo**: o broadcast do push HTTP não consegue excluir o autor (ele não tem socket do lado do emissor HTTP), então o filtro por `op.clientId === this._clientId` é do cliente (`ws-client.js:397`). O singleton `wsClient` é construído com `getClientId()` justamente por isso (`ws-client.js:573`); sem o `clientId` o autor reaplicaria as próprias ops. Ver [[client-id-estavel]].
- **Serialização de apply**: cada apply é encadeado num `_applyChain` (`ws-client.js:409`), porque o handler faz read-modify-write assíncrono do registro do mapa no IndexedDB; applies concorrentes se sobrescrevem e perdem tudo menos um.
- **`serverVersion` não é contíguo por atlas**: vem de uma sequência global compartilhada (`ws-client.js:386-390`). Buracos não são ops perdidas. Tratar buraco como gap gerou tempestade de `sync_request`. Use apenas para **ordenar**, nunca para contar ou detectar perda.

## Sinais WS que exigem uma chamada REST em seguida

Nem tudo que muda no servidor passa pelo log de operações. `atlas_updated`, `map_duplicated` e `maps_merged` mutam dados **fora** do log; o peer não recebe as entidades como ops. O cliente trata os três como um único sinal `serverResync` (`ws-client.js:352-359`) e responde com **re-pull de snapshot completo** via REST, `pullSync(atlasId, 0)` (`sync-engine.js:493` → `sync-engine.js:336`), guardado contra execuções sobrepostas. Contexto em [[clone-atlas]] e [[snapshot-e-pull-incremental]].

Outros sinais WS com efeito colateral REST/local, todos ligados em `sync-engine._wireOnce`:

- `atlas_settings_updated` → reaplica o overlay de restrições por atlas (`sync-engine.js:475`), com gate de `isOnline()` para não recapturar o config já restaurado após um disconnect. Ver [[atlas-settings]].
- `sharing_updated` → re-gate do papel local sem reconectar, só para o usuário afetado (`sync-engine.js:463`). Ver [[compartilhamento-atlas]] e [[permissoes-atlas]].
- `atlas_deleted` → `disconnect()` para o auto-reconnect não perseguir sala morta (`sync-engine.js:427`).
- `sync_response` → aplicado apenas se ainda online (`sync-engine.js:411`), senão um snapshot atrasado repersiste dados remotos num store em teardown. Ver [[store-origin-local-remoto]].

## Recuperação: dois caminhos, escolhidos pela duração da falha

- **Socket caiu, sessão viva**: reconnect com backoff 1s→30s (`ws-client.js:462-476`) e, ao reabrir, `requestSync(lastVersion)` **pelo WS** (`ws-client.js:425-427`). Não há replay de mensagens bufferizadas por cliente; o replay é sempre por versão.
- **App fechou / F5 / relogin**: o boot refaz o caminho REST completo, `pullSync(atlasId, 0)` no `connect`. Ver [[sessao-boot-e-ciclo-de-vida]].

O corte snapshot vs incremental é do servidor: `version == 0` ou `version < min_version` devolve snapshot, senão ops incrementais. Um cleanup administrativo sobe `min_version` e força snapshot para clientes atrasados. Ver [[snapshot-e-pull-incremental]] e [[fila-operacoes-pendentes]].

## Timeouts, backpressure e outras armadilhas de transporte

- **Push e pull são propositalmente sem timeout**; só as chamadas de boot (`getMe`, `getConfig`) usam `BOOT_TIMEOUT_MS = 8000` (`api-client.js:49`, `api-client.js:369`, `api-client.js:379`). Abortar um push por timeout arriscaria reenvio duplicado, seguro por idempotência mas ruidoso; abortar um snapshot grande quebraria o boot em rede lenta.
- **401 no REST dispara um refresh único e repete a chamada** (`api-client.js:233`). O WS não tem esse caminho: o token vai na query do handshake e a autorização é reconciliada a cada heartbeat do servidor, então uma revogação de share fecha o socket.
- **Backpressure só descarta presença**: se `bufferedAmount` passa de 1 MiB, frames `cursor`/`selection`/`temporal` são dropados (`ws-client.js:36-38`, `ws-client.js:524`), nunca ops nem frames de controle. É correto porque o frame seguinte de presença supera o anterior. Ver [[presenca-tempo-real]] e [[qualidade-conexao-adaptativa]].
- **`_sendRaw` retorna `false` em vez de lançar quando o socket não está aberto** (`ws-client.js:521`). Quem chama presença pode ignorar; quem chamasse operação teria que reenfileirar, mais um motivo para o outbound durável viver no HTTP.
- **Heartbeat do cliente é 25s** (`ws-client.js:31`), abaixo da varredura de 30s do servidor, e um ping sem pong fecha o socket com código 4000 (`ws-client.js:486-488`).

## O que nunca deve trocar de canal

- **Imagens** ficam em REST próprio, com o blob fora do envelope de operação; a feature só referencia o id (`image-sync.js`). Enfiar blob em op estouraria o limite de 500 ops por push e o log de operações. Ver [[imagens-atlas]].
- **Presença nunca vira operação**: não persiste, não entra no log, não tem `serverVersion`. Ver [[presenca-colaborativa]] e [[presenca-away-vs-saida]].
- **Escrita de entidade nunca vira rota REST própria**: não existe rota REST de escrita para feature/map/layer/group/briefing/slide, tudo é sync-only. Ver [[sintese-rest-vs-sync]] e [[tipos-entidade-sync]].
- **Atlas, sharing, settings e config nunca viram operação**: são REST puro. Ver [[api-rest-atlas]] e [[config-runtime-urls-relativas]].

## Formatos de erro divergem entre os canais

REST usa envelope `{ error: { code, message } }`; o WS usa mensagem plana `{ type: 'error', code, message }`. Códigos WS: `FORBIDDEN`, `VALIDATION_ERROR`, `OPERATION_FAILED`, `SYNC_FAILED`. Falha de upgrade acontece **antes** do socket abrir e vira HTTP 400/401/403. Ver [[erros-api]] e [[sintese-contrato-erros-http]].

## Por que dois canais, e não um

Um só canal falharia nos dois extremos. Só REST perderia o tempo real (polling de sala custaria caro e a presença ficaria inviável). Só WS perderia a durabilidade: sem resposta HTTP transacional, o dequeue da fila dependeria de um ack que se perde junto com o socket, e o pull por versão precisaria de um protocolo de replay próprio. A divisão atual coloca a **verdade** no HTTP (transação única no servidor, ack por op, versão) e a **notificação** no WS. Ver [[websocket-collab]], [[canal-collab-websocket]], [[sintese-nao-e-crdt]], [[sintese-limites-collab]] e [[modos-operacao]].

## Fontes

- `docs/guias/05-sync-crdt.md`: push/pull HTTP (endpoints, limite de 500 ops, `results[]`/`acks[]`, transação única), idempotência por `op_id`, LWW por chegada, merge de mapas e broadcast `maps_merged`, endpoints admin de cleanup e efeito no `min_version`.
- `docs/arquitetura-sync.md`: seção 4 (os dois canais e a tabela de endpoints/mensagens), fluxos outbound/inbound, `serverVersion` como chave de ordenação, convergence guard, comportamentos por design (§13).
- `docs/guias/03-sync-inicial.md`: fluxo de abertura de atlas (pull 0 depois WS), corte snapshot vs incremental e a comparação entre os dois modos.
- `docs/guias/04-websocket-collab.md`: protocolo `/api/v1/collab` (tipos de mensagem, `connected`, `ack`/`ack_batch`, `sync_request`), away vs saída, qualidade adaptativa, mutações REST broadcast, limitações (sala por atlas, sem replay, single-instance).
- `docs/guias/06-presenca-imagens.md`: presença como canal efêmero e imagens em REST separado (endpoints, limite de 10 MB, SVG recusado).
- `docs/guias/08-offline-import.md`: modos anônimo/autenticado/público, fluxo de reconexão (pull depois push) e gestão da fila pendente.
- Código: `src/js/store/sync/{sync-flush,sync-engine,ws-client,sync-gateway,api-client,image-sync}.js` (o outbound HTTP-only, os gates, os timeouts e o backpressure vieram daqui, não da prosa).
