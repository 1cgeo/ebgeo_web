# Síntese: limites conhecidos da colaboração

Reunião dos limites atuais do sistema colaborativo, salas por atlas e não por mapa, ausência de replay de mensagens, estado efêmero em instância única e locks que só são impostos no nível de mapa (camada, grupo e feição são advisory).

## 1. A sala é por atlas, nunca por mapa

O registro de salas é literalmente `atlasId -> Set<WebSocket>` (`backend/src/modules/collab/collab.rooms.js:6`). Não existe sub-canal por mapa. Consequências práticas:

- Cursor, seleção e presença temporal de um usuário que está em outro mapa chegam a todo mundo. O **frontend** é quem filtra: `remote-cursors.layer.js:119-129` só renderiza cursores do `mapId` ativo (`presenceStore.getCursors(mapId)`), e um `mapId` ausente resulta em zero cursores.
- Operações são fan-out para a sala inteira via `broadcastToRoom` / `broadcastOperations` (`collab.rooms.js:56`, `:84`), independentemente do mapa. Um atlas com muitos mapas paga banda de todos eles em cada aba conectada.
- O emissor é excluído por identidade de socket (`client === excludeWs`). O push por REST (`POST /atlas/:id/sync`) **não tem socket para excluir**, então o próprio cliente recebe o eco e precisa descartá-lo pelo `clientId` (`src/js/store/sync/ws-client.js:397-403`). Ver [[client-id-estavel]] e [[canal-collab-websocket]].

> [!CONTRADICAO 2026-07-18] guia *04-websocket-collab* (absorvido) §10 diz que "Operações CRDT são sempre broadcast para todos (necessário para consistência)". O código não faz isso para comentários espaciais: `collab.rooms.js:105-114` divide o lote e envia só as ops não-comentário a clientes `permission === 'read'`, e `collab.handlers.js:145-149` passa `skipReadOnly` para op única de comentário. Um visualizador, por design, **não converge** em comentários. Ver [[comentario-espacial]] e [[permissoes-atlas]].

## 2. Sem replay: reconexão é pull, não buffer

Não há fila de mensagens por cliente desconectado. O que se perde durante a queda só volta por `sync_request`. O cliente pede a cauda ao reentrar: `ws-client.js:422-427` chama `requestSync(this._lastVersion)` apenas quando o estado anterior era `RECONNECTING`. O servidor responde snapshot completo (se `lastVersion == 0` ou abaixo de `min_version`) ou ops incrementais (`sync.service.js:797-816`). Ver [[snapshot-e-pull-incremental]].

Armadilha real: **`serverVersion` vem de uma sequência global compartilhada entre atlas**, então é monotônica mas não contígua por atlas. Um "buraco" na numeração é uma op de outro atlas, não uma op perdida (`ws-client.js:385-394`). Detectar gap por não-contiguidade já causou tempestade de `sync_request` e foi removido. Ou seja: **não existe detecção de perda de op no meio da sessão**, só recuperação na reconexão.

## 3. Estado efêmero vive na memória de uma instância

Salas, presença, cursores e timers de `away` são estruturas em memória do processo: `rooms` (`collab.rooms.js:6`) e `awayTimers` (`collab.gateway.js:34`, populado em `:522-530`). Não há Redis nem pub/sub no backend. Escalar horizontalmente exige sticky-session no balanceador, ou perde-se presença e broadcast entre instâncias (dois usuários no mesmo atlas em processos diferentes simplesmente não se veem). O estado durável está no Postgres ([[tabela-operations]]); o efêmero morre com o processo. Ver [[deploy-backend]] e [[presenca-colaborativa]].

A janela de graça `away` é `WS_AWAY_GRACE_MS` (default 120000 ms, `backend/src/config.js:97-103`) e o timer é `unref()`ado, então não segura o shutdown: um restart do backend derruba todos os `away` pendentes sem emitir `user_left`. Ver [[presenca-colaborativa]].

## 4. Locks: só o mapa é imposto pelo servidor

O único lock com enforcement server-side é o do **mapa**:

- `LOCKABLE_CHILD_TARGETS` = `feature, group, layer, cesium3d, streetview360, catalog_layer, group_feature` (`sync.service.js:586-588`). Antes de aplicar uma op desse conjunto, o servidor consulta `maps.locked` e lança `ConflictError` (`sync.service.js:1306-1313`), que é HTTP **409** (`backend/src/utils/errors.js:30-33`).
- Virar o `locked` e deletar o mapa são exclusivos do owner (`sync.service.js:614-619`), 403 para `write`.

Duas lacunas importantes:

- **`comment` não está em `LOCKABLE_CHILD_TARGETS`.** Comentários espaciais continuam sendo escritos em um mapa travado. Isso é coerente com o papel de Comentarista, mas surpreende quem espera "mapa travado = nada muda".
- **`layers.locked`, `groups.locked` e `properties.bloqueado` da feição são apenas colunas/propriedades sincronizadas.** O servidor as persiste (`sync.service.js:1463-1472`, `:1446-1455`) e nunca as consulta como gate. O respeito é 100% do cliente: os controles de desenho testam `!feature.properties?.bloqueado` para decidir se aceitam edição (por exemplo `src/js/draw_tools/point_tool/add_point_control.js:416`, `polygon_tool/add_polygon_control.js:190`), e `src/js/store/layer.operations.js:98,155,201,245` bloqueia localmente por mapa travado. Um cliente modificado, ou um cliente com bug, escreve por cima de camada/feição "bloqueada" e o servidor aceita. Trate lock fino como **convenção de UI**, não como garantia. Ver [[modelo-conflito-lww]] e [[sintese-nao-e-crdt]].

## 5. Backpressure: presença é descartável, socket lento é morto

Limite não documentado no guia, mas presente no código (`collab.rooms.js:13-15,68-69,104`):

- Frames coalescíveis (`cursor`, `temporal`, `selection`) são **descartados** para um socket com mais de 1 MiB de buffer não drenado. O descarte se auto-cura porque o próximo frame supera o anterior.
- Ops duráveis **nunca** são descartadas. Um socket acima de 8 MiB de buffer é `terminate()`ado, para que reconecte e recupere via `sync_request`. Um drop silencioso divergiria o peer.

Logo: em rede ruim, presença degrada de forma invisível e a conexão pode ser cortada de propósito. Isso interage com [[qualidade-conexao-adaptativa]], que reduz a taxa de saída antes de chegar nesse ponto.

## 6. O lote é atômico: uma op recusada trava a fila inteira

`pushOperations` roda tudo dentro de uma transação com advisory lock por atlas (`sync.service.js:653-672`) e **não** tem try/catch por operação: qualquer `ConflictError` (mapa travado) ou `ForbiddenError` no meio do laço (`:672-760`) faz rollback do lote todo.

Do lado do cliente, `sync-engine.js:262-289` faz `peek` de um lote, e só chama `operationQueue.dequeue(opIds)` **depois** de um push bem-sucedido; um lote rejeitado não é removido e o próximo flush re-peeka os mesmos ops. Isso é correto para erro transitório e é um **poison batch** para erro permanente: se um op da fila mira um mapa que foi travado por outro usuário, a fila outbound para de avançar até o mapa ser destravado ou a fila ser limpa. Ver [[fila-operacoes-outbound]] e [[fila-operacoes-outbound]].

Armadilha correlata no ack: `results[].success` é **hardcoded `true`** (`sync.service.js:770-776`). Não existe sinal de falha por operação, só o `idempotent` (que indica reenvio já registrado). Falha aparece como erro do lote inteiro, nunca como `success: false`.

> [!CONTRADICAO 2026-07-18] guia *04-websocket-collab* (absorvido) §3.4 descreve `result.success` como um resultado por operação ("`true` quando a op foi registrada"), sugerindo que pode vir `false`. O código em `backend/src/modules/sync/sync.service.js:772` sempre emite `success: true`; um erro aborta a transação e nenhum ack é produzido. Não escreva lógica de dequeue que dependa de `success: false`. Ver [[ack-idempotencia]] e [[idempotencia-e-convergence-guard]].

Também há um limite de concorrência: pushes do mesmo atlas são serializados por `pg_advisory_xact_lock` com `lock_timeout` de 5s; ao estourar, o cliente recebe 503 retentável (`sync.service.js:654-670`).

## 7. Permissão fica cacheada no socket

O socket resolve a permissão no handshake e vive por horas. A reconciliação com o banco (revogação de share, downgrade, atlas despublicado, organização desativada) acontece no sweep de heartbeat (`collab.gateway.js:173-182`, `reconcileAuthorization`), a cada `WS_HEARTBEAT_INTERVAL_MS` (default 30000 ms). Ou seja: **a janela de staleness de autorização é de até ~30 s**. Um usuário revogado pode escrever nesse intervalo. Ver [[permissoes-atlas]] e [[sintese-eixos-de-permissao]].

O mesmo sweep é o mecanismo de morte por inatividade: sem pong desde o ciclo anterior, `terminate()` (close 1006), que vira `away`, não `user_left`.

## 8. "Offline" não significa "sem servidor"

O modo anônimo é local para **dados** (IndexedDB, [[dominio-local-vs-remoto]]), não para **boot**. O frontend é fail-fast em `GET /api/config`: sem backend alcançável ele mostra a tela "EBGeo indisponível" e não roda (`src/js/index.js:63-65`), porque o servidor é a fonte única de config e catálogo ([[config-dinamico]], [[config-runtime-urls-relativas]]). O checklist de `08-offline-import.md` registra "Funcionamento completo sem backend" explicitamente como fora de escopo.

O caminho suportado continua sendo: acumular local, logar, subir o atlas via `POST /atlas/import` (`src/js/store/sync/api-client.js:617-618`), depois enviar imagens em bulk e corrigir os `imageId` por operação de update. Ver [[atlas-import-offline]], [[imagens-atlas]] e [[modos-operacao]].

## 9. O que usar quando algo não converge

Antes de suspeitar de perda de mensagem, colete os spans correlacionados por `op.id`: o backend registra `server.inserted`, `server.applied` (com `rowsAffected`, o guard de "ackado mas sem efeito") e `server.broadcast` (com `sent`, `recipients`, `skippedSelf`, `skippedClosed`, `skippedReadOnly`, em `collab.rooms.js:121-135`). Na maioria dos casos o "sumiço" é filtro de comentário para viewer, eco próprio descartado ou lote travado, não perda de rede. Ver [[syncledger]] e [[aplicacao-operacoes-remotas]].

## Fontes

- guia *04-websocket-collab* (absorvido): §10 (limitações declaradas: sala por atlas, sem replay, single-instance, lock de mapa imposto vs camada/grupo/feição advisory), §3.4/§3.5 (contrato de `ack`/`ack_batch` e `result`), §4 (semântica away vs remove, `WS_AWAY_GRACE_MS`), §8 (filtro de cursor por `mapId` no cliente), §9 (recuperação por `sync_request`).
- guia *08-offline-import* (absorvido): Parte 1 (três modos de operação e a nota "sem login ≠ sem servidor"), Parte 2 (fila de operações pendentes e fluxo de reconexão), Parte 3 e 4 (import de atlas local e bulk upload de imagens), checklist final (funcionamento sem backend declarado fora de escopo).
- Código verificado: `backend/src/modules/collab/collab.rooms.js`, `collab.gateway.js`, `collab.handlers.js`, `backend/src/modules/sync/sync.service.js`, `backend/src/utils/errors.js`, `backend/src/config.js`, `src/js/store/sync/ws-client.js`, `sync-engine.js`, `api-client.js`, `src/js/index.js`, `src/js/presence/remote-cursors.layer.js`, `src/js/store/layer.operations.js`, `src/js/draw_tools/*/add_*_control.js`.
