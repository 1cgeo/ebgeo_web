> **Nota histórica.** guia *04-websocket-collab* (absorvido):411` diz que "o servidor armazena a geometria em precisão cheia" enquanto o cliente comprime a saída, mas nenhum lado trunca hoje: `truncateCoords` (`backend/src/modules/collab/collab.quality.js:50`) não tem call site em `backend/src/` (o próprio comentário do arquivo declara isso e pede que não seja removido), e o frontend não implementa truncamento algum. A precisão cheia é preservada por omissão, não por decisão de código.

# Monitor adaptativo de qualidade de conexão

O cliente reporta RTT via `connection-quality` e o servidor, só na mudança de banda (`excellent`/`good`/`poor`/`critical`), responde `adaptive-settings` com `batchIntervalMs`, `geometryPrecision` e `viewportOnly` recomendados para o transporte.

## Onde isso vive

Três arquivos, nada mais:

- `backend/src/modules/collab/collab.quality.js` — lógica pura: `classifyConnectionQuality(rttMs)`, `adaptiveSettingsFor(quality)`, `truncateCoords(value, precision)`.
- `backend/src/modules/collab/collab.handlers.js:214` — `handleConnectionQuality(ws, data)`, o único ponto que guarda estado.
- `backend/src/modules/collab/collab.gateway.js:447` — o `case 'connection-quality'` no dispatch de mensagens do [[canal-collab-websocket]].

Do lado do cliente, `src/js/store/sync/ws-client.js:340` apenas reencaminha a mensagem como evento local `adaptiveSettings`. Ver [[canal-collab-websocket]] para o protocolo completo.

## Classificação

`classifyConnectionQuality` (`collab.quality.js:12`) é uma escada de limiares, sem histerese e sem média móvel:

| Banda | RTT (ms) | `batchIntervalMs` | `geometryPrecision` | `viewportOnly` |
|---|---|---|---|---|
| `excellent` | < 100 | 250 | 7 | `false` |
| `good` | < 300 | 500 | 7 | `false` |
| `poor` | < 800 | 1500 | 5 | `true` |
| `critical` | >= 800 | 3000 | 4 | `false`? não: `true` |

`adaptiveSettingsFor` (`collab.quality.js:22`) tem um `default` que devolve os valores de `good` para qualquer string desconhecida. Como o único chamador passa a saída de `classifyConnectionQuality`, esse ramo é inalcançável na prática, mas existe como rede de segurança se alguém passar a banda vinda do cliente.

Consequência de não haver histerese: um RTT oscilando em torno de 100 ms ou de 300 ms alterna de banda a cada amostra e o servidor responde `adaptive-settings` a cada alternância. O filtro anti-spam é só a comparação com a banda anterior, não um debounce temporal. **Suavize o RTT no cliente** (média/mediana das últimas N amostras) antes de reportar, senão o "só na mudança" não protege nada.

## Estado e emissão

```javascript
// collab.handlers.js:214
const rtt = Number(data.rttMs);
if (!Number.isFinite(rtt) || rtt < 0) return;
const quality = classifyConnectionQuality(rtt);
if (quality === ws.qualityClass) return; // only emit on change
ws.qualityClass = quality;
ws.rttMs = rtt;
ws.send(JSON.stringify({ type: 'adaptive-settings', quality, ...adaptiveSettingsFor(quality) }));
```

Pontos que costumam pegar quem integra:

- **O estado é do socket, não do usuário nem do atlas.** `ws.qualityClass` e `ws.rttMs` moram na instância do `WebSocket` (`collab.handlers.js:221-222`). Dois clientes do mesmo usuário, ou duas abas com [[client-id-estavel]] distintos, têm bandas independentes. Nada é persistido: não há coluna em banco nem entrada em [[auditoria]].
- **A primeira amostra válida sempre emite.** `ws.qualityClass` começa `undefined`, então nunca bate com a banda calculada. É assim que o cliente recebe o baseline sem precisar de handshake extra.
- **Reconexão zera tudo.** O socket novo é outro objeto, logo a próxima amostra reemite. Isso é desejável (a rede provavelmente mudou), mas significa que o cliente **não deve** guardar os settings entre conexões sem revalidar.
- **`rttMs` inválido é engolido em silêncio.** Não-finito ou negativo faz `return` sem `error` de volta. Um cliente com bug de medição fica preso na banda antiga e não recebe sinal nenhum. Se o RTT parou de mudar de banda, verifique primeiro se você está mandando `NaN`.
- **O servidor nunca mede RTT.** O heartbeat do servidor (`WS_HEARTBEAT_INTERVAL_MS`) serve para matar conexão morta, não para latência. A medição é responsabilidade exclusiva do cliente, tipicamente cronometrando `ping` -> `pong`.
- **A mensagem é unicast.** Vai só para o socket que reportou, não entra em broadcast de sala, ao contrário de cursor/seleção da [[presenca-colaborativa]].

## Os três settings, e o que eles realmente significam

- `batchIntervalMs` — de quanto em quanto tempo o cliente deveria drenar a [[fila-operacoes-outbound]]. É recomendação: o servidor aceita operações na cadência que o cliente mandar e responde `ack` normalmente (ver [[ack-idempotencia]]). Ignorar não quebra nada, só desperdiça banda em link ruim.
- `geometryPrecision` — casas decimais de coordenada sugeridas **apenas para o transporte de saída**. 5 casas equivalem a cerca de 1,1 m, 4 casas a cerca de 11 m. Nunca trunque antes de persistir localmente nem antes de montar o [[envelope-operacao]] que vai virar registro canônico: a perda seria permanente e propagaria para os peers via [[modelo-conflito-lww]], sem volta.
- `viewportOnly` — sugestão de restringir o que o cliente processa/desenha à viewport atual. Não altera nada no servidor: o broadcast continua sendo por atlas inteiro, não por mapa nem por bbox (ver [[sintese-limites-collab]]). A filtragem é 100% do cliente.

Ou seja: **nenhum dos três é aplicado pelo servidor**. São recomendações, e o servidor não verifica se o cliente obedeceu.

## Estado da implementação no frontend

Hoje o EBGeo Web recebe mas não usa:

- `src/js/store/sync/ws-client.js:340` traduz `adaptive-settings` no evento `adaptiveSettings`, e **nenhum módulo se inscreve nesse evento** (nenhuma outra ocorrência de `adaptiveSettings` em `src/`).
- O cliente **nunca envia** `connection-quality`: não há emissor em `src/`, e o heartbeat (`ws-client.js:484-492`) só alterna o flag `_pongPending`, sem carimbar timestamp, portanto o RTT sequer é calculado.
- O intervalo de flush é fixo em 1500 ms (`src/js/store/sync/sync-flush.js:126`, `intervalMs = 1500`), o que por coincidência é o valor de `poor`. Ligar o loop adaptativo significaria repassar `batchIntervalMs` para `startAutoFlush`.

O checklist do guia (`04-websocket-collab.md:764`) lista isso como item a fazer no cliente, então não é regressão: é funcionalidade de servidor pronta esperando consumidor. Ao implementar, mexa no laço de heartbeat (carimbar o `ping`, medir no `pong`) e reinicie o auto-flush com o novo intervalo, sem duplicar timers.

## Armadilhas ao ligar isso

1. Não deduza a banda no cliente a partir da tabela. Reporte o RTT e obedeça à resposta: os limiares podem mudar no servidor sem quebrar cliente.
2. Não trate ausência de `adaptive-settings` como erro. Silêncio significa "banda inalterada", que é o caso comum.
3. Não amarre reconexão de socket a mudança de banda. `critical` não é motivo para derrubar a conexão; a máquina de estados de conexão e o `sync_request` de recuperação são assunto de [[snapshot-e-pull-incremental]] e do backoff descrito em [[canal-collab-websocket]].
4. Se for instrumentar, o span de transporte já existe no [[syncledger]]; a qualidade de conexão não gera span próprio hoje.
5. `truncateCoords` é transport-only e não tem call site em `backend/src/`. Está coberto por `backend/tests/unit/collab-quality.test.js` e marcado explicitamente como "não é dead code, não remova" (`collab.quality.js:44-48`). Um `npm run knip` ou limpeza automática vai querer apagá-la.

## Fontes

- guia *04-websocket-collab* (absorvido): §3.8 (protocolo `connection-quality`/`adaptive-settings`, tabela de bandas, notas de integração), tabela de tipos de mensagem (linhas 150 e 158), esqueleto de cliente (`reportQuality`, `onAdaptiveSettings`) e checklist de integração (linha 764).
- `backend/src/modules/collab/collab.quality.js`: limiares de classificação, settings por banda, ramo `default`, e `truncateCoords` com a nota de preservação deliberada.
- `backend/src/modules/collab/collab.handlers.js:214-228`: validação de `rttMs`, estado por socket (`ws.qualityClass`, `ws.rttMs`), emissão unicast só na transição.
- `backend/src/modules/collab/collab.gateway.js:447`: roteamento da mensagem no dispatch.
- `src/js/store/sync/ws-client.js:340` e `src/js/store/sync/sync-flush.js:126`: estado atual do consumo no frontend (reemissão sem assinante, intervalo de flush fixo).
