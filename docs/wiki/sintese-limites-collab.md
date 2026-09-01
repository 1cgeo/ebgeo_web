# Síntese: limites conhecidos da colaboração

Reunião dos limites atuais do sistema colaborativo, salas por atlas e não por mapa, ausência de replay de mensagens, estado efêmero em instância única e locks que só são impostos no nível de mapa (camada, grupo e feição são advisory).

## 1. A sala é por atlas, nunca por mapa

O registro de salas é literalmente `atlasId -> Set<WebSocket>` (`backend/src/modules/collab/collab.rooms.js`). Não existe sub-canal por mapa. Consequências práticas:

- Cursor, seleção e presença temporal de um usuário que está em outro mapa chegam a todo mundo. O **frontend** é quem filtra (`frontend/src/js/presence/remote-cursors.layer.js`), e um `mapId` ausente resulta em zero cursores.
- **O custo disso é quadrático no tamanho da sala, e foi medido.** Sem subcanal, o trabalho de transmissão é `S x f x 12,5 x (S-1)` por segundo, então dobrar a sala quadruplica a escrita em socket. Foi o que fez o limite operacional ser de cinquenta pessoas até 2026-08-28, quando o cursor passou a sair em lote e o limite subiu para duzentas. Números e o que continua aberto em [[capacidade-de-uma-instancia]].
- Operações são fan-out para a sala inteira, independentemente do mapa. Um atlas com muitos mapas paga banda de todos eles em cada aba conectada.
- O emissor é excluído por identidade de socket. O push por REST **não tem socket para excluir**, então o próprio cliente recebe o eco e precisa descartá-lo pelo `clientId`. Ver [[client-id-estavel]] e [[canal-collab-websocket]].

> **Nota histórica.** guia *04-websocket-collab* (absorvido) §10 diz que "Operações CRDT são sempre broadcast para todos (necessário para consistência)". O código não faz isso para comentários espaciais: `broadcastOperations` divide o lote e envia só as ops não-comentário a clientes `read`. Um visualizador, por design, **não converge** em comentários. Ver [[comentario-espacial]] e [[permissoes-atlas]].

## 2. Sem replay: reconexão é pull, não buffer

Não há fila de mensagens por cliente desconectado. O que se perde durante a queda só volta por `sync_request`, que o cliente dispara ao reentrar **apenas** quando o estado anterior era `RECONNECTING` (`frontend/src/js/store/sync/ws-client.js`). Ver [[snapshot-e-pull-incremental]].

Armadilha real: **`serverVersion` vem de uma sequência global compartilhada entre atlas**, então é monotônica mas não contígua por atlas. Um "buraco" na numeração é uma op de outro atlas, não uma op perdida. Detectar gap por não-contiguidade já causou tempestade de `sync_request` e foi removido. Ou seja: **não existe detecção de perda de op no meio da sessão**, só recuperação na reconexão.

## 3. Estado efêmero vive na memória de uma instância

Salas, presença, cursores e timers de `away` são estruturas em memória do processo (`backend/src/modules/collab/collab.rooms.js`, `backend/src/modules/collab/collab.gateway.js`). Não há Redis nem pub/sub. Escalar horizontalmente exige sticky-session no balanceador, ou perde-se presença e broadcast entre instâncias: dois usuários no mesmo atlas em processos diferentes simplesmente não se veem. O estado durável está no Postgres ([[tabela-operations]]); o efêmero morre com o processo. Ver [[deploy-backend]] e [[presenca-colaborativa]].

O timer da janela de graça `away` é `unref()`ado, então não segura o shutdown: um restart do backend derruba todos os `away` pendentes sem emitir `user_left`. Ver [[presenca-colaborativa]].

## 4. Locks: só o mapa é imposto pelo servidor

O único lock com enforcement server-side é o do **mapa**:

- Antes de aplicar uma op de alvo filho (o conjunto `LOCKABLE_CHILD_TARGETS`), o servidor consulta `maps.locked` e **recusa aquela op**, sem derrubar o lote (`lockedMapDenialReason`, `backend/src/modules/sync/sync.service.js`). Op de nível mapa não passa por esse gate, que é justamente o que permite ao dono destravar.
- Deletar mapa exige `manage` ou acima; virar o `locked` é exclusivo do `owner` (`operationDenialReason`). Ambos são recusa por-op, não 403 do lote.
- As duas, e as outras quatro da família, passaram a deixar UMA linha agregada por lote no log do servidor em 2026-09-01 (`refusedOpsLogPayload`). Antes disso a recusa por-op era invisível dos dois lados, que é o que tornava impossível confirmar ou negar um relato de fila congelada.

> **Nota histórica.** Até `aec63f8` (2026-07-24) o mapa travado lançava `ConflictError` de dentro do `tx()` do lote inteiro e respondia **409**. Como o cliente não desenfileira lote recusado, uma op parada na fila offline mirando um mapa que foi travado nesse meio-tempo congelava o sync daquele usuário para TODOS os mapas, indefinidamente, com só um `console.warn`. É o caso que motivou os dois regimes da seção 6.

Duas lacunas importantes:

- **`comment` não está em `LOCKABLE_CHILD_TARGETS`.** Comentários espaciais continuam sendo escritos em um mapa travado. Isso é coerente com o papel de Comentarista, mas surpreende quem espera "mapa travado = nada muda".
- **`layers.locked`, `groups.locked` e o `bloqueado` da feição são apenas colunas e propriedades SINCRONIZADAS, e essa assimetria é propriedade do desenho, não buraco de implementação.** O servidor escreve as três (o UPSERT de `layers` e o de `groups` em `backend/src/modules/sync/sync.service.js` carregam a coluna; o da feição viaja dentro do JSONB de propriedades) e **nunca as lê como gate**. A única coluna de travamento que ele CONSULTA é `maps.locked`, nos dois pontos que a impõem: `lockedMapDenialReason`, para os alvos de `LOCKABLE_CHILD_TARGETS`, e a recusa de mesclar mapa travado em `backend/src/modules/maps/maps.service.js`. O termo `bloqueado` não aparece em nenhum ramo de decisão do backend.

  A consequência é de SEGURANÇA, não de UX: o respeito ao lock fino é 100% do cliente (os controles de desenho testam a propriedade antes de aceitar edição, e `frontend/src/js/store/layer.operations.js` bloqueia localmente por mapa travado), então um cliente modificado, ou com bug, escreve por cima de camada, grupo ou feição "bloqueada" e o servidor aceita e propaga a todos os pares. Não construa nada que dependa de lock fino para proteger dado: para isso o instrumento é o papel por atlas ou o lock de mapa. Ver [[modelo-conflito-lww]] e [[sintese-capacidades-por-papel]].

## 5. Backpressure: presença é descartável, socket lento é morto

Frame de presença é descartado num socket entupido (o próximo supera o anterior, então o descarte se auto-cura); op durável nunca é, e o socket que passa do teto é `terminate()`ado para reconectar e recuperar via `sync_request`, porque um drop silencioso divergiria o peer (`backend/src/modules/collab/collab.rooms.js`).

Consequência operacional: em rede ruim a presença degrada de forma invisível e a conexão pode ser cortada de propósito. Ver [[qualidade-conexao-adaptativa]], que reduz a taxa de saída antes de chegar nesse ponto.

## 6. O lote é atômico, mas a recusa tem dois regimes

O lote inteiro roda numa transação com advisory lock por atlas, e o que decide se a fila do usuário trava é **qual** regime de recusa a op disparou. Os regimes e o defeito que os separou (violação de nível aborta o lote, recusa por operação não) são detalhados em [[tabela-operations]].

O que importa do lado do cliente: `frontend/src/js/store/sync/sync-engine.js` faz `peek` de um lote e só chama `operationQueue.dequeue(opIds)` **depois** de um push bem-sucedido. Um lote rejeitado não é removido e o próximo flush re-peeka os mesmos ops. Isso é correto para erro transitório, e continua sendo poison batch permanente para o único caso que ainda aborta: cliente cujo nível não autoriza aquela escrita.

Por isso `results[].success` **é significativo** desde `1d23ac9` (2026-07-19), com `reason` textual junto, e uma op `success: false` **deve ser retirada da fila**, porque repetir recusa de política nunca vai passar. Antes o campo era literal `true` e esta seção instruía a nunca depender dele; o guia *04-websocket-collab* (absorvido) já o descrevia como por-operação, o que o código só passou a cumprir naquela data. Ver [[ack-idempotencia]], [[fila-operacoes-outbound]] e [[idempotencia-e-convergence-guard]].

Também há um limite de concorrência: pushes do mesmo atlas são serializados por `pg_advisory_xact_lock` com `lock_timeout`; ao estourar, o cliente recebe 503 retentável.

## 7. Permissão fica cacheada no socket

O socket resolve a permissão no handshake e vive por horas; a reconciliação com o banco acontece no sweep de heartbeat, então **a janela de staleness é o intervalo de heartbeat**, e um usuário revogado escreve dentro dela. O mesmo sweep é o mecanismo de morte por inatividade: sem sinal de vida, `terminate()` (close 1006), que vira `away`, não `user_left`. O que conta como sinal de vida mudou em 2026-08-28 e deixou de ser só o ping da aplicação: **qualquer frame que chega**, mais o pong do PROTOCOLO, que a pilha de rede do navegador responde sem passar pelo JavaScript da página. Os dois defeitos que isso conserta (a varredura virando descarte de carga sob saturação, e a aba oculta ceifada por temporizador estrangulado) estão em [[canal-collab-websocket]] §"Vivacidade". Detalhe do gate em [[sintese-eixos-de-permissao]] e [[permissoes-atlas]].

**O fan-out do sweep está limitado, e essa é uma propriedade a preservar, não uma pendência.** Cada reconciliação abre até três queries (`getLiveAuthState`, `backend/src/utils/org-status.js`, mais o SELECT de `atlas` e o de shares dentro de `resolvePermission`), então uma sala grande dispararia N vezes isso contra um pool de dez (`DATABASE_POOL_MAX`, `backend/src/config.js`). Hoje `heartbeatSweep` (`backend/src/modules/collab/collab.gateway.js`) faz `await reconcileAuthorization(ws)` dentro de workers contados por `AUTHZ_SWEEP_CONCURRENCY`, e devolve uma promessa que só assenta quando todas as reconciliações daquele tique terminaram. Se for mexer no sweep, mantenha as duas metades: sem o teto o sweep compete com o tráfego HTTP pelo pool, e sem esperar o fim do tique um sweep ainda drenando quando o seguinte começa dobra a janela de staleness, que é justamente a garantia que ele existe para dar.

O que **sobra** como limite, e é permanente: a janela é o intervalo de heartbeat, e um usuário revogado escreve dentro dela. Reconciliação que falha é contada, não engolida (`AUTHZ_MAX_CONSECUTIVE_FAILURES`), então uma indisponibilidade sustentada do banco alarga essa janela antes de fechar o socket.

## 8. "Offline" não significa "sem servidor"

O modo anônimo é local para **dados** (IndexedDB, [[dominio-local-vs-remoto]]), não para **boot**. O frontend é fail-fast em `GET /api/config`: sem backend alcançável ele mostra a tela "EBGeo indisponível" e não roda (`frontend/src/js/index.js`), porque o servidor é a fonte única de config e catálogo ([[config-dinamico]], [[config-runtime-urls-relativas]]). "Funcionamento completo sem backend" é fora de escopo declarado.

O caminho suportado continua sendo: acumular local, logar, subir o atlas via `POST /atlas/import` (`frontend/src/js/store/sync/api-client.js`), depois enviar imagens em bulk e corrigir os `imageId` por operação de update. Ver [[atlas-import-offline]], [[imagens-atlas]] e [[modos-operacao]].

## 9. O que usar quando algo não converge

Antes de suspeitar de perda de mensagem, colete os spans correlacionados por `op.id`: o span de broadcast conta separadamente os pulos por self-echo, socket fechado e filtro de leitura, e o de apply carrega `rowsAffected`, que é o guard de "ackado mas sem efeito". Na maioria dos casos o "sumiço" é filtro de comentário para viewer, eco próprio descartado ou lote travado, não perda de rede. Ver [[syncledger]] e [[aplicacao-operacoes-remotas]].

## 10. Lateral chaveado por nome pode ser apagado por um homônimo local

Resolvido em 2026-08-14, e a armadilha continua valendo para código novo. A config temporal por mapa não chegava ao convidado, com o P11 vermelho na comparação de temporal (`frontend/tests/e2e-ui/browser-p11-roundtrip.spec.js`). Não era transporte: o servidor entregava `temporal_config` no snapshot e o cliente o gravava. Era a limpeza seguinte. Ao abrir um atlas, `activateAtlasInitialMap` apaga os mapas locais soltos, e o mapa do atlas costuma ter o mesmo nome do mapa local padrão (`Principal`); o `deleteMap` do repositório removia por nome os dois laterais chaveados assim, `temporal_<nome>` e `mapLocked_<nome>`, matando o dado do mapa que sobrevive.

A guarda vive no repositório: remoção por nome só quando nenhum outro registro de mapa responde por aquele nome (`frontend/src/js/store/repositories/local.repository.js`). Detalhe e regressão em [[modulo-temporal]].

Regra que fica: todo estado por mapa chaveado por **nome** é compartilhado por nome, e num store onde mapa remoto é chaveado por UUID e mapa local por nome, dois registros podem responder pelo mesmo nome ao mesmo tempo. Ao criar lateral novo, prefira chavear por id do mapa, como faz `gridStyle_<id>`, que atravessou o bug intacto.

## Páginas comparadas

[[canal-collab-websocket]] · [[presenca-colaborativa]] · [[capacidade-de-uma-instancia]] · [[tabela-operations]] · [[modelo-conflito-lww]] · [[snapshot-e-pull-incremental]] · [[sintese-capacidades-por-papel]] · [[sintese-decisoes-arquiteturais]] · [[sintese-rest-vs-websocket]]
