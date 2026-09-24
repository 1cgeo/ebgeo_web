# Caça noturna: frente REDE (sync multiusuário, queda e lentidão)

Worktree `C:\Users\diniz\ebgeo_hunt\rede`, branch `hunt/rede`. Primeiro ciclo: 21:48 a 23:25 (2026-09-23).

O que os quatro defeitos têm em comum: o endurecimento de 2026-09-12 (f8e109ea) trouxe prazos, e o heartbeat já existia, todos pensados para LAN e nenhum proporcional ao volume trafegado. No link de 40 kbps (5000 B/s) do enunciado, 30 s sobem cerca de 150 KB, 180 s descem cerca de 900 KB, e 25 a 50 s de heartbeat descem de 125 a 250 KB. Acima disso tudo entrava num laço sem fim: nada se perdia no servidor, mas o sistema nunca convergia.

## Bugs corrigidos (commits no `hunt/rede`)

### 1. Push em link lento nunca sobe um lote grande e segura a fila inteira. `92a4319c` (+ `c3ba6ff0`)
- Severidade: quebra funcional com risco de perda (o trabalho fica preso só neste computador, sem prazo).
- Sintoma: num link de 40 kbps, depois de um gesto grande (importação, trilha longa, polígono detalhado), NENHUMA edição seguinte da pessoa chega ao servidor; o aviso diz que é a conexão.
- Causa: `pushOperations` (`frontend/src/js/store/sync/api-client.js`) com `timeoutMs: 30000` FIXO sobre o pedido inteiro; o corpo é cortado no meio do envio a cada tentativa e a fila reenvia a mesma cabeça.
- Conserto: `uploadDeadlineMs(bytes)` = 30 s + tempo de subida a 2000 B/s (16 kbps, 2,5x abaixo da especificação). O mesmo prazo vale no `lookupOperationReceipts`. `c3ba6ff0` (pedido da revisão): o corpo é serializado UMA vez e enviado como `serializedBody`, e o tamanho é contado por `utf8ByteLength`, sem cópia.
- Prova: `frontend/tests/e2e-ui/push-em-link-lento.repro.spec.js` (Chromium, CDP a 5000 B/s só na origem do backend). Vermelho: lote de 324 KB, tentativas a 0,9, 32,4, 66,9 e 102,9 s, todas cortadas, a linha nunca chega ao servidor e a edição pequena feita depois também não. Verde: 200 aos 67,6 s e a pequena em seguida. Controle negativo: com o api-client revertido o spec volta vermelho, com o mesmo padrão. Unitários em `frontend/tests/integration/sync-http-deadline.test.js`.

### 2. Par em downlink lento nunca recebe um quadro grande e entra em laço de reconexão. `4362a336`
- Severidade: quebra funcional (divergência permanente daquele par; nada se perde no servidor).
- Sintoma: quem está no link lento volta de uma queda (ou um colega importa algo grande) e nunca mais recebe as edições; o selo pisca de reconexão a cada ~51 s, para sempre.
- Causa: `_startHeartbeat` (`frontend/src/js/store/sync/ws-client.js`) fechava o socket na 2ª batida com `pong` pendente. O navegador só entrega a mensagem quando o quadro inteiro chega, e o `pong` do servidor viaja ATRÁS do quadro grande; a reconexão pede `sync_request` do MESMO cursor e recebe o MESMO quadro.
- Conserto: tolerância escalonada. Cada fechamento por heartbeat dobra o número de batidas que o próximo socket espera (teto de 16, ou 400 s); um `pong` dentro da própria batida volta a tolerância a 1; um `connect()` novo recomeça estrito. Durante a espera o ping continua subindo a cada batida, porque o servidor ceifa em 30 s um socket que não manda nada (`heartbeatSweep`). Link morto continua sendo fechado.
- Prova: `frontend/tests/e2e-ui/ws-quadro-grande-em-link-lento.repro.spec.js` (quadros servidor->cliente entregues em ordem a 5000 B/s por `routeWebSocket`). Vermelho (ws-client do pai): 5 sockets em 240 s, "heartbeat timeout" a cada ~51 s, e o `sync_response` de 324 KB nunca é entregue. Verde: 2 sockets, 1 corte, quadro entregue aos 117,5 s. Versão determinística em `frontend/tests/integration/ws-heartbeat-quadro-grande.repro.test.js`: 3 de 4 casos vermelhos sem o conserto (o 4º, o limite de link morto, fica verde nos dois lados de propósito).

### 3. Lote acima de 10 MB (413) segura a fila para sempre com aviso falso. `86a84f46`
- Severidade: quebra funcional com risco de perda (independe de rede lenta).
- Sintoma: depois de uma importação grande, nada mais sincroniza; o aviso diz "serão enviadas quando a conexão voltar", o que nunca acontece.
- Causa: o teto do corpo JSON é 10 MB (`backend/src/app.js`) e o servidor responde 413; `PERMANENT_PUSH_REJECTIONS` (`frontend/src/js/store/sync/sync-engine.js`) tinha só 400 e 422, então o 413 caía no ramo genérico, tratado como transitório.
- Conserto: 413 entra na lista. O flush isola até o pedaço indivisível, que vira problema durável com a frase `CORPO_GRANDE_DEMAIS`; nada é descartado e o resto da fila anda.
- Prova: `frontend/tests/e2e-ui/lote-acima-do-teto-do-servidor.repro.spec.js` (backend real, limite real, sem interceptação). Vermelho: seis pushes de ~13 MB em 60 s, todos 413, e a edição pequena nunca chega ao servidor. Verde: um 413, depois um push de 1,1 KB com 200, e a linha grande guardada como problema. Unitário em `frontend/tests/integration/sync-engine.test.js`.

### 4. Atlas grande não abre em link lento: o retrato era cortado aos 180 s com os bytes ainda chegando. `77a16cb3`
- Severidade: quebra funcional (quem entra num atlas com alguns MB pelo link lento nunca consegue abrir).
- Causa: `pullSync` com `timeoutMs: 180000` sobre o pedido INTEIRO, corpo incluído (o comentário do próprio arquivo ainda prometia "sem prazo, P6").
- Conserto: `_request` ganha `deadlineCountsSilence`, e `_parseBody` lê o corpo em stream, com cada pedaço rearmando os 180 s. O primeiro byte continua com 180 s (o servidor monta o retrato antes de responder), e um corpo que para de chegar continua sendo cortado.
- Prova: `frontend/tests/e2e-ui/retrato-em-link-lento.repro.spec.js` (cliente novo, CDP a 5000 B/s nas rotas de atlas, 130 trilhas, 5,37 MB descomprimidos). Vermelho (api-client do pai): 200, mas com o corpo cortado aos 184 s; a abertura nunca conclui e nenhuma das 130 feições aparece em 420 s. Verde: corpo completo aos 198,9 s e as 130 feições na tela. Unitários: um corpo ainda chegando aos 399 s não é cortado; um corpo que para depois de 5 pedaços é cortado 180 s depois do último.

Verificação antes de cada commit: `npm run lint --prefix frontend` e `npm test --prefix frontend` inteiros, depois da última escrita (877 arquivos verdes; com `EBGEO_SEM_PESO_CONSTRUIDO=1` porque a worktree não tem `dist/`). Nenhum commit toca o backend.

## Confirmado e NÃO corrigido

- **Presença satura o link de 40 kbps.** Medido com spec temporário, já apagado: com 2 colegas mexendo o mouse, o par recebe 3541 B/s de quadros `cursors` (89 quadros de ~525 B em 13,2 s), 70% de 5000 B/s; com 3 colegas passa de 100%. O servidor só descarta quadro coalescível com `bufferedAmount` acima de 1 MiB (`BACKPRESSURE_DROP_BYTES`, `backend/src/modules/collab/collab.rooms.js`), e atrás de um nginx no mesmo host o buffer de loopback absorve MBs antes de o `bufferedAmount` do Node subir: na prática o descarte não age. Consequência: ops e `pong` entram na fila atrás dos cursores (latência de minutos; com o conserto 2, reconexões periódicas em vez de laço). Não corrigi porque o conserto é de política de presença (teto de taxa de cursor por socket, ou ligar o monitor adaptativo `connection-quality`, que existe no servidor e não tem consumidor), e isso é decisão de produto.
- **Uma foto em link lento segura TODAS as edições seguintes.** A op da feição de imagem nasce preparada até o blob subir, e `_loadOperations` (`operation-queue.js`) para no primeiro preparado (`break`): é cabeça de fila global. Uma foto de 1 MB a 40 kbps segura o sync da pessoa por ~200 s. É a ordenação global escolhida de propósito, e não mexi. Registro também que `uploadImage` não tem prazo nenhum (fetch cru).
- **Flush depende do WebSocket.** `hasWorkToFlush` exige `connectionState.isOnline()`, que é o estado do WS: um proxy que bloqueie o upgrade (comum em rede corporativa e militar) deixa a fila HTTP parada mesmo com o HTTP funcionando. O selo diz "sem conexão", então não mente, mas nada sobe. É decisão de desenho; fica o relato.

## Pedido da revisão: abortar push em voo quando a conexão cai (avaliado, não implementado)

Não implementei, por três razões, medidas ou lidas no código: (a) perda real de rede já derruba o fetch no navegador (numa mudança de interface vem ERR_NETWORK_CHANGED; num caminho quebrado, o TCP desiste em cerca de 1 min de retransmissão); (b) queda do WS NÃO é evidência de que o HTTP morreu, e com o conserto 2 o WS cai justamente durante congestionamento, então abortar o upload nesse instante recriaria o laço que o conserto 1 tirou; (c) atrás do nginx, backend pendurado vira 504 em `proxy_read_timeout` (60 s por padrão), e cliente que para de enviar vira 408 em `client_body_timeout`; o "até 88 min" só existe se o próprio nginx pendurar. Se o coordenador quiser um teto mesmo assim, o lugar é um `Math.min` em `uploadDeadlineMs` (por exemplo, 40 min ainda comporta 10 MB a 40 kbps).

## Suspeitas descartadas (com medição)

- 502 intermitente (hipótese 9): spec com 30% dos pedidos de sync respondidos com 502 (15% antes de chegar ao backend, 15% DEPOIS de aplicado), dois usuários desenhando e B recolorindo a mesma linha 5 vezes. Resultado: filas vazias, zero problemas, servidor igual aos discos locais, zero op duplicada e a cor final certa. Foi uma rodada só; a edição anterior cujo recibo se perdeu é encadeada por `baseOperationId`. O spec não foi commitado (não é bug).
- `/api/config` no prazo de boot de 8 s: 8958 B, ou 3192 B comprimidos, no ambiente de teste; cabe em 40 kbps. Em produção pode ser maior; não medi.
- Conflito offline x online na mesma feição (hipótese 1): o servidor recusa pela base observada e a recusa vira problema durável no painel; delete sobre base velha também é recusado (`RAZAO_ALTERADO_ANTES_DA_EXCLUSAO`). Só lido; está coberto por specs existentes.

## Linhas propostas para o livro-razão

- 2026-09-23 | prazo de LAN aplicado a rede lenta | o push com prazo fixo de 30 s nunca subia lote acima de ~150 KB a 40 kbps e segurava a fila | codificado em `uploadDeadlineMs` + `frontend/tests/e2e-ui/push-em-link-lento.repro.spec.js`
- 2026-09-23 | heartbeat que não distingue congestionamento de morte | o `pong` atrás de um quadro grande fazia o par em link lento reconectar em laço para sempre | codificado em `_startHeartbeat` (tolerância escalonada) + `frontend/tests/integration/ws-heartbeat-quadro-grande.repro.test.js`
- 2026-09-23 | recusa permanente classificada como rede | o 413 (corpo acima de 10 MB) segurava a fila com o aviso "quando a conexão voltar" | codificado em `PERMANENT_PUSH_REJECTIONS` + `frontend/tests/e2e-ui/lote-acima-do-teto-do-servidor.repro.spec.js`
- 2026-09-23 | prazo total sobre download com progresso observável | retrato acima de ~900 KB comprimidos nunca abria a 40 kbps | codificado em `deadlineCountsSilence` + `frontend/tests/e2e-ui/retrato-em-link-lento.repro.spec.js`
- 2026-09-24 | peso da edição medido pelo patch e não pelo corpo | o envelope de feição leva `data` e `previousData` inteiros ao lado do patch v2, então renomear uma feição com foto inline de 212 KB empurrava 432 KB embora o servidor só aplique o patch | codificado em `fotosSemBytes` (`store/photo-attach.js`) + `frontend/tests/e2e-ui/foto-inline-convertida-na-edicao.spec.js`, que mede o CORPO do push
- 2026-09-24 | manifesto de imagem que cita o que viaja inline | cliente e servidor citavam o id de toda foto de 3D/360, inclusive a inline, e o envio perguntava por uma figura "ausente" que estava dentro do item | codificado em `importImageIds` + `frontend/tests/unit/fotos-anexas-na-fronteira-do-servidor.test.js`, que compara os dois lados no mesmo processo

## Docs propostas (o coordenador aplica)
- `.claude/rules/architecture.md` §Data Model (ou página nova da wiki sobre fotos anexas): "A foto anexa (feição, marcador 3D, marcador 360) é blob com referência desde 2026-09-24: o item guarda `{ id, name, type, size, thumbnail, addedAt }` e os bytes moram no armazém de imagens do atlas e na tabela `images` do servidor. A forma antiga (inline, `data`) é LIDA para sempre e convertida só na fronteira (as três portas de envio) e na próxima edição em atlas de servidor (`converterFotosInline`, id NOVO, porque um clone mantém o mesmo id inline e `images.id` é global). O blob de foto nunca é apagado por remover a foto ou a feição: a coleta por alcançabilidade é a fase 2e."

- `docs/wiki/snapshot-e-pull-incremental.md`, bullet "**`pullSync` não tem timeout**": está falso desde f8e109ea. Trocar por: "`pullSync` tem prazo de 180 s que mede SILÊNCIO, não duração (`deadlineCountsSilence`, desde 2026-09-23): cada pedaço do corpo rearma o prazo. O prazo total antigo cortava a 40 kbps todo retrato acima de ~900 KB comprimidos."
- `docs/wiki/fila-operacoes-outbound.md` (ou onde morar o envio): "O push tem prazo proporcional ao corpo (`uploadDeadlineMs`: 30 s + subida a 2000 B/s). `fetch` não expõe progresso de upload, então não existe prazo de silêncio na subida. 413 é recusa permanente, como 400 e 422."
- `docs/wiki/canal-collab-websocket.md`: "O heartbeat do cliente escalona: cada fechamento por `pong` atrasado dobra a tolerância do próximo socket (até 16 batidas), porque o `pong` viaja atrás de qualquer quadro grande na mesma conexão; durante a espera o ping continua subindo, para o `heartbeatSweep` do servidor não ceifar o download."
- `docs/wiki/qualidade-conexao-adaptativa.md`: acrescentar a medição da presença (2 colegas = 3,5 KB/s = 70% de 40 kbps) como argumento para ligar o monitor.

## Cobertura

Coberto: push grande em link lento; downlink lento com quadro grande (ao vivo e na réplica); lote acima do teto; abertura de atlas grande em link lento; 502 intermitente, inclusive aplicado com resposta perdida; banda da presença.

Não coberto neste ciclo: token vencendo durante offline longo (hipótese 5, só lida); aba fechada offline e reaberta horas depois (hipótese 6, coberta por specs existentes, não medida por mim); tempestade de reconexões curtas (hipótese 4, coberta pelo chaos spec existente); Firefox (as provas via CDP rodam só no Chromium; a de `routeWebSocket` e a do 413 rodariam no Firefox, mas não rodei).

## Nota do coordenador (23:20)

O `86a84f46` (413) duplicou o conserto da frente backend-sync, que já estava integrado. Da minha versão ficou só o spec de navegador `lote-acima-do-teto-do-servidor.repro.spec.js`. Não mexo mais no 413. Antes de consertar sync ou fila, confiro `git -C C:/Users/diniz/ebgeo_hunt/integra log --oneline 5379fc3e..`, e não subo número do teto de peso.

# 2º ciclo (a partir de 23:17)

- 23:18: `hunt/rede` rebaseado sobre `hunt/integra` (5d913a4c). Os quatro commits já integrados foram pulados por equivalência de patch, e o 86a84f46 (413) foi pulado de propósito. Base nova: integra.
- Ordem aprovada: 1) taxa de cursor na origem; 2) prazo no `uploadImage`; 3) medir o que a tela diz com o upgrade do WS bloqueado e o HTTP funcionando; 4) token vencendo durante offline longo, aba reaberta com fila, e Firefox.
- 23:29 COMMIT 01f93218 perf(presence): cursor a 5 Hz na origem (`CURSOR_THROTTLE_MS` 80 -> 200 ms). Mesmo harness (60 Hz de mouse dentro da página, fio do socket do par medido por routeWebSocket): ANTES 2 colegas 3408 B/s (6,5 itens/s/colega), 3 colegas 5639 B/s (7,3); DEPOIS 2 colegas 2518 B/s, 3 colegas 3710 B/s (4,8 itens/s/colega). presence-live-cursors e browser-sharing-presence verdes. Guardas: `presenca-cabe-no-link-lento.spec.js` (<= 5,5 e >= 3 itens/s/colega) e caso determinístico em `presence-bridge.test.js` (vermelho com 80). NÃO basta para 3+ colegas a 40 kbps (74%); próximo passo é adaptativo e depende de decisão.
- 23:40 COMMIT ceefb44e fix(sync): subida de imagem pendurada. `bulkUploadImages` sem prazo nenhum + a ferramenta de imagem espera a subida ANTES de gravar a feição: pedido sem resposta = figura que nunca aparece (vermelho: gesto pendente após 90 s). E a retomada só rodava em connect/volta a ONLINE: com o socket de pé a op preparada segurava a fila. Conserto: prazo proporcional (mesmo helper) + retomada agendada enquanto a conexão está de pé (15/30/60/120/300 s), sob o MESMO id. Verde: corte a ~31 s, retomada aos 47 s, feição e bytes no servidor com o mesmo id, linha seguinte atravessa a cadeia, par vê a imagem. browser-collab-imagem-retomada (3 casos) verde.
- 23:52 COMMIT 74b426af fix(boot): upgrade do WS recusado com HTTP funcionando. MEDIDO: o atlas de servidor NÃO ABRE (a abertura espera o `connected`), a aba volta para atlas.html?aviso=abertura-falhou e a tela dizia "Verifique sua conexão e tente de novo" com a lista do servidor acabada de carregar. Frase corrigida (código WS_HANDSHAKE_CLOSED -> aviso `abertura-sem-tempo-real`): "o servidor respondeu, mas a conexão em tempo real não abriu. Tente de novo; se continuar, avise o administrador."
- Base (hunt/integra 5d913a4c) tem dois vermelhos pré-existentes, confirmados com as minhas mudanças revertidas: teto-de-peso "o grafo COMPLETO" e cauda-longa-vira-retrato "REST, no connect a partir do cursor durável". docs-integridade estoura o tempo sob carga numa rodada (passa isolado).
- 00:05 COMMIT 9f130bfa test(e2e): offline longo com token vencido (1 refresh 200, 1 push 200, fila vazia, sessão mantida, sem op duplicada) e aba fechada offline com fila e reaberta depois (replay na ordem, uma vez só). VERDE em Chromium e Firefox: não é defeito, é cobertura nova.
- 00:07 FIREFOX: 7 de 7 verdes (abertura-sem-tempo-real, lote-acima-do-teto, offline-longo x2, presenca-cabe-no-link-lento 4,95 e 4,89 itens/s/colega, subida-de-imagem-pendurada, ws-quadro-grande: 2 sockets, quadro entregue aos 125,7 s). As provas via CDP (push e retrato em link lento) só rodam no Chromium.
- 00:12 MEDIDO (para o dono, não implementado): foto de 138 KB a 40 kbps. A ferramenta de imagem espera a subida INTEIRA antes de gravar a feição (`add_image_control.js`): a figura só aparece para quem a inseriu 38,7 s depois do gesto, sem indicador nenhum (a pessoa tende a inserir de novo). A linha desenhada logo depois chegou ao servidor 1 s depois da figura (41,4 s): a retenção de cabeça de fila durou o tempo da subida. Conserto possível: a ferramenta registra a pendência (await) e grava a feição sem esperar a transferência; a op já espera o blob pela marca de preparo, e isso fecha também a "lacuna declarada" da recusa na primeira tentativa (`blob-upload-queue.js`). Muda a ordem do gesto: pede decisão.
- 02:40 COMMIT 12abab25 fix(image), aprovado pelo coordenador com 5 condições. A figura aparece na hora (494 a 546 ms, antes 38,7 s); registro e retenção gravados com await ANTES do save; recusa definitiva vira problema durável com aviso que nomeia a figura ("A figura "Imagem #1" não foi enviada ao servidor e aparece só para você. Ela está nas pendências para revisão."), e a lacuna declarada do blob-upload-queue.js fica fechada (id recusado espelhado, `blobUploadRefusal`, e o despachante faz nascer como problema a op que chega depois da recusa); F5 no meio da subida retoma sob o mesmo id e o par recebe; excluir e desfazer durante a subida: create e delete aplicados nessa ordem, sem op órfã, sem problema, sem figura viva; o par nunca recebe a feição antes dos bytes (banco amostrado durante toda a subida). Controle negativo: 5 de 5 vermelhos com os 5 arquivos de origem do pai; 5 de 5 verdes depois, e as specs de imagem vizinhas 20 de 20.
- 059c7d6f: o censo de login programático acusou a cópia vencida do token no spec de offline longo; declarada com motivo.
- Medido e sem defeito: recibo atrasado da 1ª edição chegando depois da 2ª edição da mesma feição (hipótese 3), 5 de 5 rodadas com o servidor, o autor e o par na 2ª cor e sem problema. Spec temporário apagado.

## Pendências para o dono (medidas, NÃO implementadas)

- Presença a 5 Hz ainda ocupa 74% de um link de 40 kbps com 3 colegas movendo o mouse (3710 B/s). O próximo passo é adaptativo (o monitor `connection-quality` do servidor existe e não tem consumidor, e o cliente não mede RTT) ou um teto por destinatário no servidor; as duas opções são decisão de produto.
- Com o WebSocket bloqueado e o HTTP funcionando, o atlas de servidor não abre de jeito nenhum (a abertura espera o `connected`), e o flush exige o socket ONLINE. Hoje a tela diz a verdade (74b426af). Abrir e enviar sem tempo real é decisão de produto.
- Foto em link lento: a retenção de cabeça de fila faz as edições feitas depois da foto esperarem a subida (a linha chegou 1 s depois da foto de 138 KB). Pular a op preparada independente foi recusado pelo coordenador e vai para o dono.

## Revisão (03:15), COMMIT 5e339732 (sobre hunt/integra c2ad35cc)

- (1) Uma transferência por id na fila de blob: `_emVoo` (tentar e o lote de enfileirarBlobs). A retomada pula id em voo e RELÊ o registro depois da espera, então uma duplicata não grava mais PENDENTE por cima de CONFIRMADO. Teste de duas tentativas concorrentes em `blob-upload-queue.test.js`: vermelho sem as conferências (duas transferências), verde com elas.
- (2) Save recusado descarta o envio: `registrarEnvioDeImagem` só registra e devolve `enviar()`/`descartar()`. A ferramenta envia depois do save e descarta o registro no save falso (`descartarBlobRegistrado`). O registro continua antes do save, então a op continua nascendo retida. Guarda de ordem na fonte (`ferramenta-de-imagem-envia-depois-de-gravar.test.js`, vermelho no pai) e teste do descarte.
- Navegador, sem edição de fonte durante a rodada: 9 de 9 (figura-aparece-na-hora 5, subida pendurada, imagem-retomada 3); figura em 484 ms.

## Revisão final (04:27), COMMIT dac7624c (sobre hunt/integra 9ada8c04)

- A janela entre `registrarBlob` e `enviar()`/`descartar()` (o tempo do `creation.save`) ficou fechada. O id fica reservado (`_reservados`) desde antes de o registro ser gravado, e a retomada o pula. Quando `tentar` acha o id em voo, o resultado diz `emVoo: true` e o `image-sync` não mostra aviso. O `assentar` não recria um registro descartado enquanto a tentativa estava no fio.
- Quatro casos node da janela em `blob-upload-queue.test.js`. Controle negativo: 4 de 4 vermelhos com o arquivo do pai. Suíte do frontend inteira verde (901). No navegador, 9 de 9 (figura na hora 5, subida pendurada, imagem-retomada 3), sem edição de fonte durante a rodada.

## Fotos anexas (06:10), branch hunt/fotos a partir de integracao_backend c777d8c5

- FASE 1, COMMIT c7561c98: `processImageFile` reduz toda foto a no máximo 1600 px com qualidade 0,8 (JPEG, ou WebP quando há transparência real) e guarda como veio a foto já pequena. Foto de câmera de 4,96 MB: antes 710 KB a 2048 px e push de 1,43 MB; depois 228 KB a 1600 px e push de 463 KB. PNG transparente deixou de virar JPEG opaco. Foto acima de 600 KB depois da redução entra com aviso que a nomeia. Controle negativo: 3 de 4 casos vermelhos com o código do pai. teto-de-peso fica vermelho por 5 kB (11935 contra 11930), deixado para a re-medição conjunta.
- FASE 2: desenho em `relatorios/fotos-estrutural.md`, esperando ok. Não implementada.
- FASE 2a, COMMIT 611c9f36 (integrado como e7e914a8): leitura dupla. Galeria da feição, painel 3D, painel 360, download e KMZ leem a foto inline (`data`) ou por referência (blob no armazém de imagens do atlas, com queda para o servidor). Folhas `user_data/photo-refs.js` (zero imports) e `user_data/photo-source.js`.
- FASE 2b, COMMIT 1ec827ae: escrita nova nos três pontos (feição, marcador/medida/visada 3D, marcador 360) por `store/photo-attach.js` (`prepararFotoAnexa`): bytes no armazém e subida REGISTRADA na fila durável antes do save; `confirmar()` depois do save; `descartar()` se o save não aconteceu. O item guarda `{ id, name, type, size, thumbnail, addedAt }`, sem `data`. Edição de feição com foto: op de 5,2 KB contra 1,43 MB antes da fase 1. NÃO INTEGRAR SOZINHA: sem a 2c, "Enviar ao servidor", clone e import atômico perdem foto nova.
- FASE 2c, COMMIT 2b5b4386 (fronteira): as três portas de envio ("Salvar no servidor", "Enviar ao servidor", "Importar .ebgeo") convertem a foto inline em blob com referência (os bytes voltam em `inlineImages` e sobem com o resto), e citam a foto de feição, que antes ficava para trás. O `importImageIds` do servidor cita foto de feição e nunca foto inline. O clone reescreve `properties.images[].id` (antes a foto da cópia apontava para o atlas de origem e dava 404). O import aditivo conta a foto de feição ausente e deixa de contar a inline de 3D. "Salvar no servidor" passou a esvaziar a área de cópia na troca ao vivo. Prova: unitário de contrato (o conjunto que o cliente sobe é o que o servidor cita, lido no mesmo processo), repro do backend, e2e contra o backend real (importação e clone abrem as duas fotos), cada um com controle negativo. Backend 5690/5690, frontend 904/907 (os 3 vermelhos: dois de carga que passam sozinhos e o teto-de-peso, que já era 804 na 1ec827ae).
- FASE 2c, COMMIT d58e37a3 (rede de segurança): a próxima edição de uma feição, de um marcador 3D ou de um marcador 360 de atlas de SERVIDOR com foto inline converte a foto (id novo, subida registrada antes, confirmada depois) e tira os bytes também do lado ANTERIOR do envelope, que viaja inteiro. Medido no navegador: renomear uma feição com foto inline de 212 KB empurrava 432 KB; agora empurra 36 KB, e o colega abre a foto. Os specs de foto das fases 1, 2a, 2b e 2c: 14/14 em série, sem retry.
- Achado de passagem, anterior à 2b e fechado pela 2c: marcador 3D/360 com foto INLINE num atlas local fazia o envio ao servidor perguntar por uma imagem "ausente" que viajava dentro do item.

## Revisão das fotos (2b, 2c e a rede de segurança), um commit por item, no hunt/fotos

A integração tirou os três commits por duas perdas críticas; os sete itens do revisor estão corrigidos, cada um com repro vermelho antes e controle negativo.

- **Item 2, 58d53580 (crítico).** Um erro depois do diário (a persistência, a cerca, a troca de escopo) apagava os bytes e a pendência de uma foto que a intenção reenviada ia citar. Agora o erro mantém e envia, e só a recusa limpa descarta, no mesmo atlas em que gravou.
- **Item 1, 4dc0158f (crítico).** A op que cita uma foto com blob pendente nasce preparada e só sai quando todas as fotos citadas confirmam (`operacaoEsperaBlob`, no despachante e no retrato). A foto recusada libera a op. O censo de saída e o do resgate contam as subidas pendentes, e as subidas passam a ir ao fio uma por vez (`emSerie`). Medido no navegador, com o código do pai: 40 kbps, renomear uma feição com foto inline de 1400 px, 45 s; o servidor já citava a foto sem a linha de `images`. Com o conserto, "Sair" pergunta e o servidor nunca cita a foto sem os bytes (amostrado a cada 150 ms, F5 no meio incluído).
- **Item 3, d7f916e8.** O tipo da foto é o dos bytes (`mimeDosBytes`), em `blobDeDataUrl`, na conversão, em `processImageFile` e em `buildImageUploads`. Um PNG anexado como `.jpg` chega ao servidor como PNG; antes, era recusado de vez, e num envio de atlas recusava o atlas inteiro.
- **Item 4, 37d5c267.** Uma cota estourada durante a conversão não derruba a edição: ela sai como antes, inline, sem nada registrado pela metade.
- **Item 5, 18f86b2d.** Os bytes e a pendência da foto são gravados dentro da transação da entidade: a conversão da feição e as três portas da 2b, estas por `gravar()` do preparo e pela opção nova `antesDaIntencao` de `updateFeature`. Uma escrita recusada pela pausa da aba não deixa foto gravada.
- **Item 7, 575a1b95.** Na fronteira, a foto inline é decodificada antes de a decisão ser tomada: a que não decodifica fica inline, e o que é citado e o que é convertido não podem discordar. `inlineImages` leva o Blob.
- **Item 6, 0dce99b9 (teste).** Clone com a foto ainda subindo: resolvido pelo item 1 e medido. Clonado pela rota real com a foto retida a 40 kbps, o clone não cita foto sem linha. Seguem como estão a foto recusada e a figura declarada ausente num envio, cuja origem já não tem os bytes.
- **Guardas da frente de imagens**, com cherry-pick de 8bbe5ceb e 16521c76 (ef133ee1 e 0e385487), mais o helper de que eles dependem (5c3affe5): 3 de 3 cada, em série, --retries=0, 0 flaky.

- **Verificação final da revisão:** as specs de foto das fases, 48/48 em série (3x cada), --retries=0, 0 flaky. No "link lento", o amostrador não viu nenhuma vez o servidor citar a foto sem a linha de `images` (violacoes=0 nas três rodadas); no caso do "Sair", o diálogo perguntou nas três. Frontend 910/911: o vermelho é o teto-de-peso, 804 contra 801, que já era 804 antes destes commits. O coordenador reintegrou os 10 commits.

## Segunda revisão das fotos (8 defeitos), no hunt/fotos, um commit por item

O revisor novo confirmou os 7 itens da primeira revisão e achou 8 defeitos, dois deles com perda de foto. Os oito e as convenções estão FEITOS. Lista para a nova revisão, em ordem: 73fc2be2, b2349f0d, de5923c3, 68220221, a2c21c42, d1e08a26, 8caaed5b, dc0cebab, 52b9d982, dc2be0e7.

- **Item 1, 73fc2be2 (alto, perda).** A foto CONVERTIDA recusada vira problema nas ops que a citam, e o servidor mantém o inline. Só é definitiva a falha por item que o servidor chama de validação: o backend marca `permanent` em `bulkUploadImages`, e disco cheio ou erro de banco ficam pendentes. Os censos de saída e de resgate contam a foto ANEXADA recusada.
- **Item 6, b2349f0d (baixo).** Na retomada, a pendência sem bytes aplica os mesmos três casos da recusa.
- **Item 8, de5923c3 (baixo).** A recusa da requisição inteira (400/403/404/413/415/422) é definitiva por item, com o status. Com 400, 413 e 422 o lote é dividido até isolar o item.
- **Item 7, 68220221 (baixo).** A cópia de blob sai fora de `emSerie` e não espera a foto que está subindo.
- **Item 5, a2c21c42.** Quando `gravar` não consegue registrar o envio com um atlas de servidor conectado, ele apaga os bytes que acabou de gravar e lança antes do diário. As três portas avisam com uma frase própria.
- **Item 2, d1e08a26 (médio-alto, perda silenciosa).**
  - O que foi feito:
    - A folha nova `store/fotos-para-copia.js` (`baixarFotosQueFaltam`) baixa as fotos por referência que faltam no armazém, com um prazo só para tudo, e devolve as que não vieram, com nome.
    - "Salvar como local" baixa as fotos antes do diálogo, com um toast enquanto baixa, e o diálogo NOMEIA cada foto que fica só com a miniatura.
    - O resgate baixa antes de adotar, no atlas montado e nos outros. A saída voluntária do mapa adianta o download para antes do logout, e o resgate reaproveita esse mesmo download.
    - A perda aparece no toast do mapa, no código de chegada `-resgatado-sem-fotos` e em `?fotos=<n>` nas páginas sem mapa.
  - Prova: e2e `foto-anexa-copia-fora-do-servidor.spec.js`, 4 casos, com controle negativo.
- **Item 3, 8caaed5b + dc0cebab (médio).**
  - O que foi feito:
    - `tipoDePng` repete regra por regra o percurso do detector do servidor. `mimeDosBytes` e `mimeDoBlob` passam a dizer `image/apng`.
    - A porta de anexar recodifica um APNG, e a foto inline APNG fica inline.
    - A figura que só existe como blob sobe achatada num PNG parado, sob o mesmo id. O coordenador aceitou: o mapa já desenhava um quadro só.
    - A cópia LOCAL fica com o APNG original (medido), e o `.ebgeo` de atlas local também o leva (conferido pelo código: a exportação não passa por `buildImageUploads`).
  - Provas: e2e de contrato contra o servidor real (corpus de 12 arquivos), unitário pelas três portas e Playwright `foto-apng.repro.spec.js`.
- **Item 4, 52b9d982 (médio-baixo).**
  - O que foi feito:
    - A feição só converte quando a edição mexe nas FOTOS.
    - O lado anterior de toda edição de feição viaja sem os bytes inline, e o patch compara as fotos sem os bytes.
    - 3D e 360 continuam convertendo em qualquer escrita, porque são disputados como documento inteiro.
  - CUSTO, aceito pelo coordenador:
    - Uma edição sem relação leva os bytes da foto inline UMA vez, no lado novo. Com a conversão em qualquer edição eram zero; antes da 2c eram duas. O lado novo fica inteiro porque a reprojeção de intenção pendente grava `op.data` como a entidade.
    - O acervo inline converge para blob mais devagar.
  - Prova: caso com dois colegas em `foto-inline-convertida-na-edicao.spec.js`. Com o código revertido, o B recebe a disputa sobre `["properties","images"]`.
- **Convenções, dc2be0e7.**
  - `avisoDeFotoRecusada` nomeia a FOTO e diz o desfecho do tipo dela (anexada: os colegas veem a miniatura; convertida: a edição foi para as pendências).
  - `fotoSemBytes` substitui as desestruturações.
  - Corrigida a indentação do 360.
  - Teto do `compartilhar-sem-a-store` subiu de 32 para 33, por decisão do coordenador.
  - Achado no caminho: dois specs forjavam a recusa por item sem `permanent` e reprovariam desde o item 1. Agora carregam o contrato.

Verificação no HEAD dc2be0e7, depois da última escrita:
- Backend INTEIRO (`npm test`, TEST_DB_NAME=ebgeo_test_rede): 5692/5692, cobertura acima do piso (statements 98,36%, branches 90,07%). Lint do backend limpo.
- Frontend: vitest 16174 passaram e 1 falhou, o teto-de-peso do mapa (806 contra 801), que a integração remede. Lint do frontend limpo.
- Playwright, 3 rodadas em série com --retries=0, dez arquivos: os dois guardas (foto-anexa-nas-copias = ef133ee1 e imagem-colar-aqui-e-duplicar = 0e385487, que são o 8bbe5ceb e o 16521c76 da integração) e as specs de foto (envio-com-fotos-anexas, figura-aparece-na-hora-em-link-lento, foto-anexa-comprimida, foto-anexa-copia-fora-do-servidor, foto-anexa-por-referencia, foto-apng, foto-inline-convertida-na-edicao, foto-por-referencia-leitura). Deu 31/31 em cada rodada, 93/93, sem flaky e sem pulo.

PRÓXIMO PASSO: aguardar a nova revisão. Depois dela vem a transição main→integração (seção seguinte). Na worktree, sem commit, só `frontend/tests/e2e-ui/transicao-main-fotos.spec.js`. Nenhum servidor meu está de pé.

## Transição main→integração (pendente, depois da revisão)

**Segunda rodada (1 aprovado, 3 reprovados)**, e nenhum reprovado é ainda perda de foto provada:

1. **Atlas local (abrir, editar, exportar, reimportar).** A travessia e a edição passaram, com as onze fotos e os bytes do main. A exportação parou em `page.waitForEvent('download')` (120 s), em `exportarPelaTela`. Hipótese a conferir primeiro: um diálogo antes do download (a pergunta de figura ausente do exportador, ou outra) que o spec não responde. É o mesmo fluxo de `nomes-de-mapa-round-trip.spec.js`, que não tem foto. Próximo passo: capturar toasts e diálogos ali, como já faz `observarAvisos`.
2. **"Enviar ao servidor".** O envio TERMINOU. A frase: "foi enviado ao servidor (14 mapas, 793 feições, … 25 imagens citadas). Subiram só 793 feições de 805 … O servidor descartou 1 posição de câmera 3D, 2 marcadores 3D, 1 medição 3D, 1 bacia de visada 3D, 1 orientação 360 e 2 marcadores 360, porque o modelo 3D ou o projeto 360 usado não está no catálogo dele". Com aviso, a página não navega, e o `waitForURL` do spec esperava navegação: defeito do INSTRUMENTO. Falta ler o `atlasId` pela lista "No servidor" e conferir as fotos no servidor. Duas perguntas abertas:
   - (a) As 12 feições a menos: é a poda do catálogo ou outra coisa? O arquivo tem 805, e o relatório de envio do acervo herdado mediu 805 subindo sem catálogo, então conferir.
   - (b) O arquivo usa OUTROS recursos além de `museu-1cgeo` e `FOTO_0001.jpg` (os que o spec semeia). Semear todos os que o arquivo cita, para que a poda não esconda a foto de marcador.
3. **`.ebgeo` do main importado direto no servidor, exportado de lá e reaberto.** Na importação chegaram as nove fotos de feição e as de marcador que sobreviveram. No arquivo exportado do servidor faltou só "Foto do marcador 360". Hipótese: o marcador 360 que carrega a foto foi PODADO por recurso fora do catálogo, pelo mesmo motivo do item 2b, e não é perda de foto. Conferir no banco se o marcador existe no atlas importado antes de chamar de defeito.

**Ordem ao retomar.** Semear todos os recursos 3D/360 do arquivo, capturar o diálogo da exportação local, trocar o `waitForURL` do envio pela leitura da lista, e rodar de novo. Só então separar poda declarada de perda. Se aparecer perda de foto, repro com controle negativo e commit por item.
