# Monitor adaptativo de qualidade de conexão

O servidor classifica o RTT que o cliente reporta e devolve, só na mudança de banda, recomendações de transporte que **ele mesmo nunca aplica nem verifica**. Funcionalidade de servidor pronta, sem consumidor no frontend.

Lógica em `backend/src/modules/collab/collab.quality.js`; estado e emissão em `backend/src/modules/collab/collab.handlers.js:214`; roteamento no dispatch do [[canal-collab-websocket]] (`backend/src/modules/collab/collab.gateway.js:447`).

## O ponto principal: nada disso está ligado

O laço não fecha em nenhum dos dois extremos do cliente:

- `src/js/store/sync/ws-client.js:340` traduz `adaptive-settings` no evento local `adaptiveSettings`, e **nenhum módulo se inscreve** (não há outra ocorrência em `src/`).
- O cliente **nunca envia** `connection-quality`. Não há emissor, e o heartbeat (`src/js/store/sync/ws-client.js:484-492`) só alterna o flag `_pongPending` sem carimbar timestamp, logo o RTT sequer é calculado.
- O flush é fixo em 1500 ms (`src/js/store/sync/sync-flush.js:126`), que por coincidência é o valor da banda `poor`. Na prática o app roda permanentemente na cadência de link ruim.

Isso é pendência conhecida, não regressão. Ao ligar: carimbe o `ping` e meça no `pong` dentro do laço de heartbeat existente, e **reinicie** o auto-flush com o novo intervalo em vez de criar um segundo timer (`startAutoFlush` é idempotente e ignora a chamada se já houver timer, então um `startAutoFlush` novo sem `stop` antes é silenciosamente descartado).

## Por que o cliente precisa suavizar o RTT

`classifyConnectionQuality` é uma escada de limiares crua: sem histerese, sem média móvel, sem debounce temporal. O único freio contra spam é a comparação com a banda anterior (`backend/src/modules/collab/collab.handlers.js:218`). Um RTT oscilando em torno de 100 ms ou de 300 ms troca de banda a cada amostra e gera um `adaptive-settings` a cada troca. **Suavize no cliente** (mediana das últimas N amostras) antes de reportar, senão o "só na mudança" não protege nada.

Corolário: não deduza a banda no cliente a partir dos limiares. Reporte o RTT bruto suavizado e obedeça à resposta, para que os limiares possam mudar no servidor sem quebrar cliente.

## Contrato: os três settings são recomendação, não política

O servidor não aplica nenhum dos três nem verifica se o cliente obedeceu.

- `batchIntervalMs`: cadência sugerida para drenar a [[fila-operacoes-outbound]]. Ignorar não quebra nada: o servidor aceita operações na cadência que vier e responde `ack` normalmente ([[ack-idempotencia]]).
- `geometryPrecision`: casas decimais **apenas para o transporte de saída** (5 casas ≈ 1,1 m, 4 ≈ 11 m). Nunca trunque antes de persistir localmente nem antes de montar o [[envelope-operacao]]: o envelope vira registro canônico e a perda propaga para os peers via [[modelo-conflito-lww]], sem volta.
- `viewportOnly`: filtragem 100% do cliente. Não muda nada no servidor: o broadcast continua por atlas inteiro, nem por mapa nem por bbox ([[sintese-limites-collab]]).

## Armadilhas

- **O estado é do socket, não do usuário nem do atlas.** `ws.qualityClass`/`ws.rttMs` moram na instância do `WebSocket`. Duas abas do mesmo usuário, com [[client-id-estavel]] distintos, têm bandas independentes; nada é persistido nem entra em [[auditoria]]. Reconexão zera tudo, o que é desejável (a rede provavelmente mudou), mas implica que o cliente **não deve** guardar settings entre conexões sem revalidar.
- **`rttMs` inválido é engolido em silêncio.** Não-finito ou negativo faz `return` sem `error` de volta. Um cliente com bug de medição fica preso na banda antiga sem receber sinal nenhum. Se a banda parou de mudar, verifique primeiro se você está mandando `NaN`.
- **O servidor nunca mede RTT.** O heartbeat do servidor (`WS_HEARTBEAT_INTERVAL_MS`) mata conexão morta, não mede latência. A medição é responsabilidade exclusiva do cliente.
- **A mensagem é unicast**, ao contrário de cursor e seleção da [[presenca-colaborativa]]. Ausência de `adaptive-settings` significa "banda inalterada", que é o caso comum, e não erro.
- **`critical` não é motivo para derrubar o socket.** Reconexão e recuperação são assunto de [[snapshot-e-pull-incremental]] e do backoff em [[canal-collab-websocket]].
- **`truncateCoords` parece dead code e não é.** Sem call site em `backend/src/`, coberta só por `backend/tests/unit/collab-quality.test.js` e marcada como preservação deliberada em `backend/src/modules/collab/collab.quality.js:44-48`. Uma limpeza automática (`npm run knip`) vai querer apagá-la.
- Se for instrumentar, o span de transporte já existe no [[syncledger]]; qualidade de conexão não gera span próprio hoje.

## Nota histórica

Documentação anterior afirmava que "o servidor armazena a geometria em precisão cheia enquanto o cliente comprime a saída". **Nenhum lado trunca hoje**: `truncateCoords` não tem chamador e o frontend não implementa truncamento algum. A precisão cheia é preservada por omissão, não por decisão de código.
