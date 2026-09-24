# Frente REDE-WS: presença em link lento (T1) e WebSocket bloqueado (T2)

Worktree `C:\Users\diniz\ebgeo_hunt\rede-ws`, branch `hunt/rede-ws`, base `origin/integracao_backend` 03baaeba.
Portas/bancos: APP 4391, BACKEND 3991, E2E 3993, `ebgeo_e2e_redews`, `ebgeo_test_redews`.

## T1: presença em link lento (IMPLEMENTADA, verificação INCOMPLETA, NÃO commitada)

### Achado que mudou a direção sugerida (medido, sonda em scratchpad)
- Chromium com CDP a 5000 B/s, servidor `ws` oferecendo quadros de 1 KB a 20 KB/s: o `bufferedAmount` do socket no servidor ficou em ZERO a rodada inteira, enquanto os quadros chegavam à página até 14 s atrasados. O limiar de 1 MiB (`BACKPRESSURE_DROP_BYTES`) nunca dispara atrás de link lento real (o mesmo que o relatório `rede.md` dizia do nginx).
- O que enxerga o atraso: um ping de PROTOCOLO mandado depois do quadro só é respondido quando tudo o que veio antes chegou. RTT do ping subiu de 1,1 s a 13,5 s com a fila. Chrome responde o ping na pilha de rede, fora do JS.
- CDP `emulateNetworkConditionsByRule` com `*://host:porta/*` estrangula o WS também; o estrangulamento é AGREGADO entre conexões da página (2 sockets levam o dobro), e entrega ~3,2 KB/s quando configurado em 5000 B/s.
- `routeWebSocket` do Playwright NÃO serve para medir isso: o proxy do Playwright responde o ping na hora.

### Desenho implementado
- `backend/src/modules/collab/collab.fluxo.js` (novo): controle de fluxo de presença POR DESTINATÁRIO. No máximo UM quadro de presença em voo por socket; depois dele sai `ws.ping(marca)` com sequência; até o pong, presença nova é RETIDA (último por remetente; seleção por remetente E superfície; o próprio cursor do destinatário não é retido). Depois do pong, pausa = 3 x (rtt - rttMin), teto 5 s. Op de sync e quadros de controle nunca passam por ali. Marcador expira em 30 s. Todo ping do servidor (o do heartbeat também) leva a sequência, então o pong do heartbeat reabre uma janela cujo pong se perdeu. Válvula `WS_PRESENCE_FLOW=0` (lida viva do ambiente) volta ao caminho antigo.
- `collab.rooms.js`: `broadcastToRoom` manda presença por `entregarPresenca`; buffer acima de 1 MiB fecha a janela (retém, com marcador sozinho) em vez de descartar. `descartarCursorPendente` também esquece o retido do remetente que sai (fantasma do `user_left`).
- `collab.gateway.js`: `ws.ping(proximaMarca(ws))` no heartbeat; `ws.on('pong', (data) => { isAlive; aoPong(ws, data) })`.
- `tests/unit/saidas-de-conteudo-censo.test.js`: três sítios de envio novos classificados (o censo reprovou antes, como devia).

### Provas
- `backend/tests/unit/presenca-fluxo-por-destinatario.test.js` (16 casos, verde), incluindo "OP DE SYNC NUNCA É RETIDA" e "NUNCA É DESCARTADA NEM COALESCIDA, em 200 intercalações sorteadas" (LCG com semente fixa).
  - Controle negativo 1 (rooms.js do HEAD): 11 de 16 vermelhos (os 5 verdes valem nos dois regimes: invariantes de op, heartbeat, expiração, válvula).
  - Controle negativo 2 (sabotagem: `broadcastOperations` via `entregarPresenca`): os DOIS casos de op ficam vermelhos.
- `frontend/tests/e2e-ui/presenca-nao-disputa-com-sync.spec.js` (Chromium, CDP 5000 B/s + 150 ms só no backend, 4 páginas, A/C/D movendo o mouse a 60 Hz, B lento; mede no fio de B por `Network.webSocketFrameReceived`).
  - ANTES (código do HEAD, 1ª rodada): presença 3090 B/s (0,62 do link nominal); edições chegando a B em 1343, 2229, 3447, 4895 ms (crescendo). Parado: 121 a 166 ms.
  - ANTES (válvula `WS_PRESENCE_FLOW=0`): 3070 B/s (0,61); 1001, 1854, 3382, 4319 ms. O spec REPROVA (0,61 > 0,5).
  - DEPOIS, 3 rodadas em série: 1856/1794/1855 B/s (0,36 a 0,37); máximo 635/652/694 ms. C (rápido) recebe na hora nas duas situações.
- Suítes: `tests/ws/**` 310/310 e `tests/unit/collab*` 20/20 verdes com o fluxo ligado; censo 14/14; lint do backend limpo; lint do frontend acusou `Buffer` não importado no spec (corrigido, re-lint NÃO confirmado).

### Não feito na T1 (declarado)
- Lado do cliente ("reduzir a taxa enquanto o flush tem trabalho"): não implementado. Estimativa: o cursor do próprio par lento ocupa ~17% do uplink nominal (5 Hz x ~170 B) durante um push grande.
- Medição de CPU/escritas no banco de 400 da bancada (`tests/bench`): cada quadro de presença agora leva um ping de 2 bytes atrás (dobra as escritas de socket da presença). Não medido.

## Diário

- 2026-09-24: início; T1 implementada e medida; pausa pedida pelo coordenador antes da verificação completa.

## Retomada (2026-09-24 tarde)

- WIP commitado e rebaseado sobre origin 6cb3a719 sem conflito.
- Verificação da T1: lint dos dois pacotes limpo; backend inteiro 5717/5717 com piso; frontend 920/921 (vermelho pré-existente: `testes-tocados.test.js` com shebang CRLF em checkout autocrlf, passa 30/30 com o arquivo em LF); contrato 273/273; specs de presença 7/7 Chromium (PRESENCA_X_SYNC 1778 B/s, máx 718 ms) e 3/3 Firefox. Sonda: Chromium e Firefox ecoam o payload do ping, em ordem.
- COMMIT 0627c0cb perf(presence) (T1) e COMMIT dadaff7c docs (decisão + índice + 3 páginas da wiki).

## PRÓXIMO PASSO

T2 (WebSocket bloqueado) em andamento. Já escritos, sem commit: `frontend/src/js/store/sync/sem-tempo-real.js` (decisões puras), `frontend/tests/unit/sem-tempo-real.test.js`, `frontend/tests/e2e-ui/sem-tempo-real.spec.js` (rascunho). Falta: estado HTTP_ONLY em connection-state, ws-client sem transição em HTTP_ONLY, engine (fallback no connect/connectPublic, papel por HTTP com `user_permission` no GET /atlas/:id, poll com recuo, sonda após queda), consumidores (flush, blobs, image-sync, selo, pendências, duplicar mapa, isMountedAtlas), frase "Sem tempo real", mocks do sync-engine.test, e2e em Chromium e Firefox, controle negativo, decisão e wiki.
