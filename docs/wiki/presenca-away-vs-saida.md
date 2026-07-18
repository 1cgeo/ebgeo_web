# away vs saída: janela de graça na presença

Queda anormal (close 1006) marca o usuário como `away` e agenda remoção após `WS_AWAY_GRACE_MS` (2 min), enquanto `leave` ou close limpo removem na hora, e reconectar com o mesmo `clientId` dentro da graça cancela o timer e emite `user_back`.

## O problema que isso resolve

Sem a janela de graça, qualquer microqueda de rede faria o usuário "piscar" para fora da lista de presença dos peers e voltar segundos depois. A presença passa a distinguir dois casos que antes eram o mesmo evento de `close`:

- **Saída intencional** (fechou o atlas, deslogou, encerrou a aba): remoção imediata, `user_left`.
- **Queda anormal** (rede caiu, heartbeat matou o socket): estado intermediário `away`, o usuário continua na sala e na lista, remoção só se a graça expirar.

Ver [[presenca-tempo-real]] para o resto do modelo de presença (cursores, seleção, roster) e [[canal-collab-websocket]] para o transporte.

## A regra exata no servidor

O discriminador é o close code, com um flag de override:

```js
const networkDrop = code === ABNORMAL_CLOSE && ws.intentionalLeave !== true;
```
(`collab.gateway.js:469`; `ABNORMAL_CLOSE = 1006` em `collab.gateway.js:25`)

| Evento | Close code | Efeito |
|---|---|---|
| Queda de rede / `terminate()` do heartbeat | `1006` | `ws.away = true`, `user_away`, timer de remoção agendado (`collab.gateway.js:485-497`) |
| Mensagem `leave` | servidor faz `ws.close(1000,'leave')` após setar `ws.intentionalLeave = true` (`collab.gateway.js:418-423`) | remoção imediata, `user_left` |
| `close()` limpo do cliente (`1000`/`1001`/`1005`) | qualquer ≠ `1006` | remoção imediata |
| `atlas_deleted` | `4001` | remoção imediata (sala fechada) |
| Shutdown do servidor | `1001` (`collab.gateway.js:183`) | remoção imediata, sem enxurrada de `away` |

O `intentionalLeave` existe porque um `leave` pode ser seguido de um `1006` real (o cliente derruba o socket antes do close frame chegar). O flag garante que a intenção declarada vença o código de fechamento.

## O caminho `away`

1. `onClose` marca `ws.away = true` e **mantém o socket morto dentro da sala** (não chama `leaveRoom`). É por isso que o usuário continua aparecendo em `usersOnline`: `getRoomUsers` deriva `status: client.away ? 'away' : 'online'` (`collab.rooms.js:185`).
2. `broadcastUserAway(atlasId, userId, clientId)` emite `{ type:'user_away', userId, clientId }` (`collab.service.js:78-86`).
3. Um `setTimeout(awayGraceMs)` é agendado em `awayTimers`, um `Map` em memória chaveado por `` `${atlasId}::${clientId}` `` (`collab.gateway.js:34`, `collab.gateway.js:494-497`). O timer leva `unref()`, então não segura o processo Node vivo no shutdown.
4. Se expirar, `removeConnection(ws)` sai da sala, apaga a linha de sessão e (condicionalmente) emite `user_left`.

## O caminho `user_back`

No handshake, antes de qualquer outra coisa, `onConnection` procura um timer pendente para `(atlasId, clientId)`:

```js
const pending = awayTimers.get(awayKey(atlasId, clientId));
if (pending) {
  clearTimeout(pending.timer);
  awayTimers.delete(awayKey(atlasId, clientId));
  leaveRoom(atlasId, pending.ws);          // descarta o socket morto
  collabService.broadcastUserBack(atlasId, user.id, clientId);
}
```
(`collab.gateway.js:306-313`)

O `leaveRoom(pending.ws)` é o que evita presença duplicada: sem ele a sala teria o socket morto `away` **e** o socket novo do mesmo usuário.

## Por que o `clientId` estável é obrigatório aqui

A chave do timer é `atlasId::clientId`. Reconectar com um `clientId` diferente **não encontra o timer**, e o resultado é o pior dos mundos: o fantasma `away` fica na lista por 2 minutos inteiros *e* o socket novo entra como uma segunda sessão. O servidor gera um `crypto.randomUUID()` quando o `clientId` está ausente ou malformado (`collab.gateway.js:305`), então a conexão funciona, mas a continuidade de presença morre silenciosamente.

O frontend persiste o id em `localStorage` sob `ebgeo_client_id` (`store/sync/operation-factory.js:41-49`) e o singleton do socket é construído com ele: `export const wsClient = new WsClient({ clientId: getClientId() })` (`store/sync/ws-client.js:573`). Detalhes e o regex aceito (`^[a-zA-Z0-9_-]{8,64}$`) em [[client-id-estavel]]. O mesmo id serve à idempotência de operações ([[ack-idempotencia]]).

## O que o cliente EBGeo faz

- `WsClient.disconnect()` manda `{type:'leave'}` e fecha com `1000` (`store/sync/ws-client.js:131-132`), ou seja, saída deliberada nunca vira `away`.
- Um F5 ou fechar aba normalmente produz close limpo do navegador (`1001`/`1000`), então também remove na hora. `away` é para queda de rede de verdade e para o `terminate()` do heartbeat.
- Os frames `user_away`/`user_back` são roteados em `presence/presence-bridge.js:104-108` para `presenceStore.userAway/userBack`, que apenas alternam `user.away` e reemitem `PRESENCE_CHANGED` (`presence/presence-store.js:507-518`). A UI deve esmaecer, não remover.

## Armadilhas

**1. `user_away`/`user_back` são os únicos frames de presença que carregam `clientId`.** `user_joined`, `user_left`, `cursor`, `selection` e o snapshot `connected.usersOnline` só têm `userId`/`id` (`collab.handlers.js:43-48`, `collab.service.js:54-63`, `collab.rooms.js:170-186`). O `resolveKey` do store prefere `clientId` quando presente (`presence/presence-store.js:52-55`), então uma entrada criada por `user_joined` fica sob a chave `userId` enquanto o `user_away` chega com chave `clientId`: `_setAway` não acha o usuário e retorna sem efeito (`presence/presence-store.js:512-515`). Ao mexer nessa área, normalize a chave antes de comparar, não presuma que away e join caem no mesmo bucket.

**2. `user_left` não é incondicional.** `removeConnection` varre a sala e **só** emite `user_left` se não sobrar nenhum outro socket com o mesmo `userId` (`collab.gateway.js:454-465`). Como `user_left` é chaveado só por `userId`, emitir sempre derrubaria da UI dos peers um usuário ainda online por outra aba. Consequência prática: com duas abas abertas, fechar uma não gera evento nenhum para os peers.

**3. O socket `away` continua na sala.** Ele participa de `getRoomUsers` e é alvo de `broadcastToRoom` (com o socket já fechado, o envio é descartado). Não assuma que "estar na sala" implica socket vivo.

**4. Estado efêmero é single-instance.** `awayTimers` vive na memória de um processo. Sem sticky-session no balanceador, o socket reconectado pode cair em outra instância, que não conhece o timer: o peer some depois de 2 min pela instância antiga e aparece duplicado pela nova. É o mesmo limite de escala descrito em [[sintese-limites-collab]].

**5. Heartbeat gera `away`, não `left`.** `heartbeatSweep` chama `ws.terminate()` em quem não deu sinal desde a varredura anterior (`collab.gateway.js:155-158`), e `terminate()` produz `1006`. Um cliente que simplesmente para de mandar `ping` (aba em background com timer estrangulado, por exemplo) entra em `away` a cada ciclo de `WS_HEARTBEAT_INTERVAL_MS` (default 30 s, `src/config.js:84`).

## Configuração

`WS_AWAY_GRACE_MS`, default `120000` (`src/config.js:89`), validado no intervalo `0..86400000` (`src/config.js:168`). Com `0` o comportamento vira remoção praticamente imediata, mas ainda passa por `user_away` seguido de `user_left`. O gateway expõe `setAwayGraceMs(ms)` (`collab.gateway.js:39-41`) como hook de teste/ops para encurtar a janela sem reiniciar, e `heartbeatSweep(wss)` é exportado para os testes dispararem a varredura de forma determinística em vez de esperar 30 s.

## Recuperação depois do `user_back`

Voltar da graça restaura a presença, não os dados. Não há replay de mensagens perdidas: depois do `connected`, o cliente precisa mandar `sync_request` com o `lastVersion` conhecido e reenviar a fila offline, tratando `result.idempotent: true` como sucesso. Ver [[snapshot-e-pull-incremental]], [[fila-operacoes-pendentes]] e [[idempotencia-e-convergence-guard]].

## Fontes
- `docs/guias/04-websocket-collab.md`: §1 (clientId estável e handshake), §2 (`usersOnline[].status`), §3.7 (frames `user_away`/`user_back`/`user_left`), §4 (tabela away vs remove, janela de graça, diagrama), §10 (limites single-instance).
- `ebgeo_backend/src/modules/collab/collab.gateway.js`: `ABNORMAL_CLOSE`, `awayTimers`, `setAwayGraceMs`, `onConnection` (cancelamento + `user_back`), `onClose` (discriminação `networkDrop`), `removeConnection` (guarda de múltiplos sockets), `heartbeatSweep`, `closeAllSockets`, handler de `leave`.
- `ebgeo_backend/src/modules/collab/collab.service.js`: `broadcastUserAway`/`broadcastUserBack`/`broadcastUserLeft` e o shape dos frames.
- `ebgeo_backend/src/modules/collab/collab.rooms.js`: `getRoomUsers` derivando `status: online|away` e a ausência de `clientId` no snapshot.
- `ebgeo_backend/src/modules/collab/collab.handlers.js`: `handleCursor`/`handleSelection` (broadcast só com `userId`).
- `ebgeo_backend/src/config.js`: `WS_AWAY_GRACE_MS` (default e faixa) e `WS_HEARTBEAT_INTERVAL_MS`.
- `src/js/store/sync/ws-client.js`: `disconnect()` enviando `leave` + close `1000`; singleton com `clientId`.
- `src/js/store/sync/operation-factory.js`: persistência de `ebgeo_client_id`.
- `src/js/presence/presence-bridge.js` e `presence-store.js`: roteamento de `user_away`/`user_back` e `_setAway`/`resolveKey`.
