# Síntese: quando usar REST e quando usar WebSocket

Quadro de decisão entre os dois canais do sync: o que precisa durar vai por HTTP, o que precisa ser rápido e é descartável vai por WebSocket. A exceção é o inbound de operações, durável mas entregue por WS, porque quem persistiu foi o servidor.

## Onde a intuição erra

| Você provavelmente supõe | O que o código faz |
|---|---|
| Edição sai em tempo real pelo socket | O cliente **nunca** envia operação por WS. Todo outbound é `POST /atlas/:id/sync` (`src/js/store/sync/sync-flush.js:65` gate → `src/js/store/sync/sync-engine.js:272`) |
| `WsClient.sendOperation` é o caminho quente | Existe (`src/js/store/sync/ws-client.js:161`, `src/js/store/sync/ws-client.js:170`) e **não tem nenhum chamador em `src/js`**, só testes. É superfície de protocolo, não caminho |
| O ack que importa é o frame `ack` do WS | O ack canônico do autor é a resposta HTTP do push (`src/js/store/sync/sync-engine.js:284-285`) |
| Um socket caído perde ops | Replay é sempre por versão (`requestSync(lastVersion)`, `src/js/store/sync/ws-client.js:425-427`), nunca por buffer de mensagens por cliente |

> **Nota histórica.** O guia *05-sync-crdt* (absorvido) §5 diz "em tempo real, prefira o canal WebSocket; o push HTTP é o caminho de recuperação", e a implementação de referência de *04-websocket-collab* §7 envia ops por `sendOperation`. O cliente real faz o inverso. Se você seguir esses guias, escreve um segundo caminho de outbound que ninguém está pronto para conciliar.

Consequência aceita: a latência de propagação tem piso do intervalo de flush (mitigado pelo flush oportunista por evento, `src/js/store/sync/sync-flush.js:103-107`).

## A armadilha do ack HTTP

`recordPushAcks` (`src/js/store/sync/sync-engine.js:60-80`) parece instrumentação do [[syncledger]], e não é só isso: ele **semeia a `serverVersion` da própria op do autor** via `recordLocalAppliedVersion`. Isso é obrigatório porque o autor descarta o próprio eco que volta pelo WS (`src/js/store/sync/ws-client.js:397`). Sem a semeadura o autor nunca aprende a ordem de chegada da própria op, e uma op concorrente mais antiga de um peer a sobrescreve. Ver [[idempotencia-e-convergence-guard]] e [[modelo-conflito-lww]].

Portanto: mover o outbound para o WS exige mover essa semeadura para o handler de `ack`/`ack_batch` (`src/js/store/sync/ws-client.js:292-313`), senão o convergence guard quebra em silêncio, sem erro nem log.

## Três invariantes do transporte que não são opcionais

- **Self-echo é filtrado no cliente**, não no servidor: o broadcast do push HTTP não tem socket do emissor para excluir, então o filtro é `op.clientId === this._clientId` (`src/js/store/sync/ws-client.js:397`). Por isso o singleton nasce com `getClientId()` (`src/js/store/sync/ws-client.js:573`); sem clientId o autor reaplicava cada op própria. Ver [[client-id-estavel]].
- **Applies são serializados** num `_applyChain` (`src/js/store/sync/ws-client.js:409`) porque o handler faz read-modify-write assíncrono do registro do mapa no IndexedDB. Handler que não devolva a promise volta a rodar concorrente e perde tudo menos um apply.
- **`serverVersion` vem de sequência global, não por atlas** (`src/js/store/sync/ws-client.js:386-394`). Buraco não é op perdida. Tratar buraco como gap já gerou tempestade de `sync_request`. Serve para **ordenar**, nunca para contar ou detectar perda.

## Sinais WS que obrigam uma chamada REST em seguida

`atlas_updated`, `map_duplicated` e `maps_merged` mutam dados **fora** do log de operações, então o peer nunca recebe as entidades como ops e um pull incremental não as veria. Os três colapsam num único sinal `serverResync` (`src/js/store/sync/ws-client.js:352-359`) que dispara re-pull de snapshot completo com guarda contra execuções sobrepostas (`src/js/store/sync/sync-engine.js:332-347`). Ver [[clone-atlas]] e [[snapshot-e-pull-incremental]].

Dois handlers têm gate de `isOnline()` que parece redundante e não é: `sync_response` (`src/js/store/sync/sync-engine.js:412`) e `atlas_settings_updated` (`src/js/store/sync/sync-engine.js:476-482`). Um frame atrasado que chegue na janela disconnect→limpeza repersistiria dados remotos num store em teardown, ou recapturaria o config já restaurado como nova baseline restritiva. Ver [[dominio-local-vs-remoto]] e [[atlas-settings]].

## Custos e limites escondidos

- **Push e pull são propositalmente sem timeout**; só o boot usa `BOOT_TIMEOUT_MS` (`src/js/store/sync/api-client.js:42-48`). Abortar push arriscaria reenvio duplicado (seguro por idempotência, mas ruidoso); abortar snapshot grande quebraria o boot em rede lenta.
- **401 tem refresh único e retry no REST** (`src/js/store/sync/api-client.js:233`); o WS não tem esse caminho. O token vai na query do handshake e a autorização é reconciliada por heartbeat, então revogação de share **fecha o socket** em vez de renegociar.
- **Backpressure só descarta presença**: acima de 1 MiB bufferizado, frames `cursor`/`selection`/`temporal` são dropados (`src/js/store/sync/ws-client.js:36-38`, `src/js/store/sync/ws-client.js:524`), nunca ops nem controle. É correto porque o frame seguinte de presença supera o anterior. Ver [[presenca-colaborativa]] e [[qualidade-conexao-adaptativa]].
- **`_sendRaw` retorna `false` em vez de lançar** com socket fechado (`src/js/store/sync/ws-client.js:521`). Presença pode ignorar; qualquer chamador durável teria que reenfileirar sozinho. Mais um motivo para o durável viver no HTTP.

## Contrato congelado: o que nunca troca de canal

- **Blob de imagem fica em REST próprio**, fora do envelope de operação (`src/js/store/sync/image-sync.js`). Dentro de op estouraria o limite de 500 ops por push e incharia o log. Ver [[imagens-atlas]].
- **Presença nunca vira operação**: não persiste, não entra no log, não tem `serverVersion`.
- **Escrita de entidade nunca vira rota REST própria**: é sync-only. Ver [[sintese-rest-vs-sync]] e [[tipos-entidade-sync]].
- **Atlas, sharing, settings e config nunca viram operação**: REST puro. Ver [[api-rest-atlas]] e [[config-runtime-urls-relativas]].
- Os envelopes de erro divergem por canal e vão continuar divergindo (REST aninha em `error`, WS é plano); falha de upgrade acontece antes do socket abrir e vira HTTP. Ver [[erros-api]] e [[sintese-contrato-erros-http]].

## Por que dois canais, e não um

Só REST perderia o tempo real: polling de sala custaria caro e presença ficaria inviável. Só WS perderia a durabilidade: sem resposta HTTP transacional, o dequeue da fila dependeria de um ack que se perde junto com o socket, e o pull por versão exigiria um protocolo de replay próprio. A divisão coloca a **verdade** no HTTP (transação única, ack por op, versão) e a **notificação** no WS.

## Páginas comparadas

[[canal-collab-websocket]], [[api-rest-atlas]], [[fila-operacoes-outbound]], [[envelope-operacao]], [[ack-idempotencia]], [[aplicacao-operacoes-remotas]], [[sessao-boot-e-ciclo-de-vida]], [[compartilhamento-atlas]], [[permissoes-atlas]], [[sintese-nao-e-crdt]], [[sintese-limites-collab]], [[modos-operacao]].
