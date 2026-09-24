# Relatório: frente backend-sync (caça noturna 2026-09-23)

Worktree `C:\Users\diniz\ebgeo_hunt\backend-sync`, branch `hunt/backend-sync`, base `5379fc3e`.
Quinze commits, um por defeito, por ajuste pedido na revisão ou por prova.

## Bugs corrigidos

| # | SHA | Severidade | Resumo |
|---|---|---|---|
| 1 | 9586c931 | perda aparente de dado | a cópia de atlas ("Copiar no servidor") e a duplicação de mapa deixavam as feições invisíveis |
| 2 | f79cf3a4 | quebra funcional | um 413 no push congelava a fila para sempre |
| 3 | 4d0c9ca4 | perda de op no par (só pela API) | marcador REST fora do lock do log |
| 4 | 21eb67df | divergência silenciosa | resposta do `sync_request` chegava depois de op mais nova |
| 5 | 22e4d4ed | revisão de 2 | 413: frase pt-BR e recorte pela metade |
| 6 | 736abbe0 | revisão de 1 | retrato serve a camada pela coluna (repara cópias antigas) |
| 7 | 57f0cfcb | desempenho (aprovado) | cauda longa ou pesada vira retrato |
| 8 | bb8b6172 | integridade entre usuários | exclusão de comentário alheio por Comentarista era difundida |
| 9 | 7a499d2f | revisão de 5 | a frase do 413 não afirma a origem |
| 10 | 195bcb14 | revisão de 3 | a duplicação só toma o lock para a linha do atlas; lock do merge preso por teste |
| 11 | ddbd2cd8 | segurança | escrita e leitura do log pelo socket reconferem autorização |
| 12 | 4728f3bd | segurança | token de visitante do link VELHO voltava a ler depois de republicar |
| 13 | 105c7ee8 | teste | censo da permissão por atlas reclassificado para o sítio novo de bb8b6172 |
| 14 | 6b81b34e | revisão 4A de 7 | pelo socket, cauda acima do teto vira aviso de re-puxar pelo HTTP, nunca quadro de retrato |
| 15 | 9ebab7dd | prova de 14 | Playwright em enlace de 40 kbps: o par volta atrás de 600 ops e converge sem laço |

### 1. 9586c931: cópia e duplicação realinham `properties.layerId`
- **Sintoma**: no atlas criado por "Copiar no servidor" (e no mapa duplicado pela API), as feições existem no servidor mas somem do mapa. O filtro de visibilidade do cliente é `['in', coalesce(layerId,'default'), camadasVisiveis]`, e a aba de feições e ocultar/travar camada também leem a propriedade.
- **Causa**: `cloneMapSubEntities` (`backend/src/modules/atlas/atlas.service.js`) remapeava a coluna `features.layer_id` e copiava `properties` como estava. O retrato (`transformFeaturesToFrontend`) servia `properties.layerId` direto do JSONB, com o id da camada do atlas de ORIGEM. O import já realinhava (`propriedadesRealinhadas`).
- **Teste**: `backend/tests/integration/copia-realinha-camada-da-feicao.repro.test.js`. Os casos de clone e duplicação estavam vermelhos antes e passam depois.

### 2. f79cf3a4 (+ 22e4d4ed, 7a499d2f): 413 no push
- **Sintoma**: um lote cujo corpo passa de 10 MB (import de vetor detalhado, viewshed grande, colar) voltava 413 para sempre. A fila inteira da pessoa parava atrás dele e o aviso culpava a conexão.
- **Causa**: `PERMANENT_PUSH_REJECTIONS` (`frontend/src/js/store/sync/sync-engine.js`) só tinha 400 e 422.
- **Conserto**:
  - o 413 entra no conjunto;
  - pela SOMA, o recorte cai pela metade até caber. 25 ops que cabem 6 por corpo vão em [25, 12, 6, 6, 6, 6, 1];
  - um pedaço indivisível (op ou lote) vira pendência com `CORPO_GRANDE_DEMAIS`: "Esta alteração é grande demais para o servidor aceitar de uma vez e ficou nas pendências. Se veio de uma importação, divida o arquivo em partes menores.";
  - o recorte volta ao cheio depois.
- **Testes**:
  - `frontend/tests/integration/sync-engine.test.js`: quatro casos de 413;
  - `frontend/tests/unit/api-client-error-contract.test.js`: 413 com corpo HTML do nginx e 413 JSON chegam com status 413;
  - `backend/tests/integration/sync-corpo-grande-413.test.js`: socket HTTP real, 11/13/20/40 MB, 413 JSON.
- **Controle negativo**: com o corte pela metade desligado, os quatro casos de 413 reprovam.

### 3. 4d0c9ca4 (+ 195bcb14): lock do log nas exceções REST
- **Sintoma**: só pela API, porque o cliente não chama duplicate nem merge. Um par que puxa entre dois commits guarda o cursor do marcador e nunca recebe a op de um push concorrente. Além disso, `current_version` anda para trás.
- **Causa**: duplicação e merge gravavam o marcador sem o advisory lock por atlas. A duplicação ainda segurava a linha do atlas (UPDATE de `map_order`) ANTES do marcador.
- **Conserto**: `backend/src/modules/sync/atlas-log-lock.js` (`lockAtlasLog`) é a definição única, usada pelo push, pela duplicação e pelo merge.
  - A duplicação toma o lock logo antes do UPDATE de `map_order`, não no topo. No topo, ela fazia todo push esperar a cópia e voltar 503.
  - O merge toma o lock no início.
- **Testes**:
  - `backend/tests/integration/marcador-rest-ordem-de-commit.repro.test.js`: gatilhos de teste forçam a intercalação. Antes: "a op do push (v2) ficou abaixo do cursor 3";
  - `backend/tests/integration/trava-do-log-nas-excecoes-rest.test.js`: prende a posição do lock na duplicação e a presença dele no merge.
- **Controles negativos**: cada lock foi movido ou removido, e o vermelho voltou (push esperou 5 s e falhou; o marcador ficou abaixo do cursor).

### 4. 21eb67df: a resposta do `sync_request` chega antes de op mais nova
- **Sintoma**: o par que reconecta enquanto um colega edita fica com o valor antigo até o próximo retrato. Vale para renomear mapa, membresia de grupo, comentário, slide e camada de catálogo, que o cliente aplica sem guarda de versão.
- **Causa**: `handleSyncRequest` lia as ops, fazia mais uma leitura e só então enviava. Uma op comitada nessa janela e difundida era aplicada ANTES da resposta, e a resposta sobrescrevia com a op anterior.
- **Conserto**: `holdOperationFrames`/`releaseOperationFrames` em `backend/src/modules/collab/collab.send.js`. Os quadros de op daquele socket esperam a resposta sair e depois são liberados, sem as ops que a resposta já cobre.
- **Testes**:
  - `backend/tests/ws/sync-request-ordem-dos-quadros.repro.test.js`: `db.query` embrulhado pausa a segunda leitura. Antes: quadros "operations, sync_response" e nome aplicado "Nome 1" contra "Nome 2" no servidor;
  - `backend/tests/unit/quadros-de-op-retidos-no-sync-request.test.js`: prende o filtro da liberação.
- **Controle negativo**: sem o hold, o vermelho volta.

### 6. 736abbe0: o retrato serve a camada pela coluna
- **O que muda**: `properties.layerId` passa a vir de `layer_id` quando a coluna não é nula (a mesma regra de `canonicalFeature`). Isso repara as cópias feitas antes de 9586c931.
- **Por que é seguro**: conferi que todo caminho de escrita do produto mantém coluna e propriedade juntas:
  - create por `deriveFeatureColumns`;
  - patch v2 por `prepareFeatureMutation`;
  - `resolveDefaultFeatureLayer` e `ensureMapLayers`;
  - mover e transferir;
  - merge (move ids intactos);
  - o cliente nunca manda `layer_id` num payload de feição.
- **Clone**: passou a seguir a regra do import (só reescreve a propriedade que espelhava a coluna), com um caso de divergência na origem.
- **Controles negativos**: sem a derivação no retrato, reprovam o caso de divergência e o de cópia antiga; com o remapeamento por valor de volta, reprova o de divergência.

### 7. 57f0cfcb: cauda acima de 500 ops ou de 2 MiB guardados vira retrato
- **Medida**: 300 edições de UM polígono de 300 vértices dão uma cauda de 7,5 MB contra um retrato de 14 KB (527x). Cada op de feição carrega a feição inteira duas vezes, e o cliente aplica a cauda uma op por vez.
- **Conserto**: `pullOperations` mede a cauda antes de lê-la, com `MEASURE_OPERATIONS_TAIL` (no máximo 501 linhas, `pg_column_size` sem detoast).
- **Teste do backend**: `backend/tests/integration/cauda-longa-vira-retrato.test.js`.
- **Teste do cliente**: `frontend/tests/integration/cauda-longa-vira-retrato.repro.test.js`, com transporte WS real, IndexedDB real e um espelho do servidor com o teto. Nos DOIS caminhos (REST no connect, WS no meio da sessão):
  - a edição pendente sobrevive na fila e na projeção;
  - a geração nova é criada e a anterior mantida;
  - o cursor durável vai para 900;
  - a edição sobe no flush.
  - Controle do instrumento: sem a reprojeção, a edição some.
- **Teste existente alterado**: `backend/tests/integration/sync-version-cursor.test.js` mudou o padrão do `pg_stat_activity`, porque a primeira leitura do log agora é a medida. O comportamento é o mesmo.

### 8. bb8b6172: exclusão de comentário alheio por Comentarista
- **Sintoma**: o delete não apagava nada no banco, mas entrava no log, voltava `applied` e era DIFUNDIDO. Todo par escondia um comentário que continuava vivo no servidor.
- **Conserto**: `commentEditDenialReason` (`sync.service.js`) recusa também o delete alheio abaixo de `write`.
- **Teste**: `backend/tests/ws/comentario-exclusao-alheia-recusada.repro.test.js`. Antes: status `applied`, op no log. Depois: `rejected`, sem log e sem quadro para o par.

### 11. ddbd2cd8: quadros de socket que escrevem ou leem o log reconferem autorização
- **Sintoma**: com a conta desativada (ou a OM desativada, papel rebaixado, sessões cortadas) e o socket aberto, o `operation` era ACKED e APLICADO (medido) e o `sync_request` respondia. Isso durava até a varredura de heartbeat (~30 s). O REST já recusava na hora.
- **Conserto**: `handleMessage` (`collab.gateway.js`) roda `reconcileAuthorization` antes de `operation`, `operations` e `sync_request`. Quem perdeu autorização é fechado com 4003.
- **Teste**: `backend/tests/ws/escrita-ws-reconfere-autorizacao.repro.test.js`. `tests/ws` inteiro: 308 verdes.

### 12. Link público republicado não revive o token do link velho
- **Sintoma**: o dono despublica porque o link vazou e republica (link novo) para quem deve ver. Todo token de visitante emitido pelo link vazado na última hora (TTL de 1 h) voltava a LER o atlas (REST e socket) sem ninguém abrir o link novo.
- **Causa**: o token carregava só o atlas, e as portas perguntavam só "o atlas é público?".
- **Conserto**:
  - o token leva `pl`, a impressão (SHA-256, 16 hex) do link de origem (`backend/src/utils/public-link-fingerprint.js`);
  - `requireAtlasPermission` (toda porta HTTP, com os assets 3D e 360) e o gateway (handshake e reconciliação) comparam com o link ATUAL;
  - a chave do memo de assets 3D inclui a impressão.
- **Custo**: token emitido antes do deploy (sem `pl`) é recusado, e o visitante recarrega. A primeira implantação é instalação nova.
- **Teste**: `backend/tests/integration/link-publico-republicado-nao-revive-token.repro.test.js` (REST e socket). Controles negativos: sem cada comparação, o caso correspondente reprova.
- **Teste existente alterado**: `tests/ws/collab-reauthz.test.js` passou a montar o socket de visitante com a impressão, como o gateway monta.
- **Constituição**: a cláusula 5.4 ("O link é revogável") continua vigente; proponho acrescentar este teste ao "Preso por".

### 14. 6b81b34e: pelo socket, cauda acima do teto pede resync pelo HTTP
- **Sintoma** (revisão 4A com f14f143e): no enlace lento, o retrato que 57f0cfcb mandava PELO SOCKET era um quadro sem compressão do atlas inteiro. Ele dura mais que a tolerância do heartbeat, a reconexão pede do mesmo cursor e recebe o mesmo quadro, em laço.
- **Conserto**: `pullOperations` ganhou `longTail` ('snapshot', o REST; 'resync', o socket). `handleSyncRequest` responde uma cauda acima do teto com o quadro que o cliente já lê como "re-puxe pelo HTTP" (`atlas_updated` -> `serverResync` -> `resync()`, comprimido e com prazo por silêncio) e descarta os quadros retidos.
- **Testes**:
  - `backend/tests/ws/sync-request-cauda-longa-pede-http.test.js`;
  - `frontend/tests/integration/cauda-longa-vira-retrato.repro.test.js`, caso WS: aviso, re-puxada do zero pelo HTTP, edição pendente preservada e enviada.
- **Controle negativo**: sem `longTail: 'resync'`, o socket manda o `sync_response` com o retrato.
- **Prova no navegador** (9ebab7dd): `frontend/tests/e2e-ui/cauda-longa-em-link-lento.repro.spec.js`. Dois navegadores; o socket de B passa por um enlace de 5000 B/s (`routeWebSocket`). B cai, A empurra 600 linhas e B volta.
  - Com o conserto: 4 de 4 verdes em série. Um socket novo, nenhum corte de heartbeat, as 600 feições em B.
  - Controle negativo (sem `longTail: 'resync'`): o retrato atravessa o socket, o heartbeat corta aos 86 s e aos 137 s, abre 3 sockets novos e B não converge em 150 s (vermelho).

## Confirmados e NÃO corrigidos
- **Recepção ao vivo até a varredura (≤ 30 s)** para conta ou OM desativada e papel global rebaixado: o socket continua RECEBENDO broadcasts. As escritas e o `sync_request` agora recusam na hora (11). É desenho declarado (`backend/CLAUDE.md`, lifecycle).
- **`DELETE /atlas/:id/images/:imageId`** (`write`) apaga FISICAMENTE o blob, inclusive o de feição em mapa travado. Não passa pela trava e não é reversível. O cliente não chama. É decisão de produto (remover a rota ou exigir soft-delete).
- **Cada op de feição leva a feição canônica duas vezes** (`data` e `changes`, `pushOperations` depois de `finishFeatureMutation`). Isso dobra a banda do broadcast e do log. Mudar mexe no contrato do fio.
- **Update de camada, grupo, 3D ou 360 filtra por `map_id = op.mapId`**: depois de um merge REST, uma op enfileirada com o mapa antigo volta `applied` sem efeito. É API-only (o cliente não chama merge).

## Suspeitas não confirmadas
- **Nomes de mapa duplicados** por criação concorrente (dois usuários geram o mesmo "Novo Mapa N"). O cliente chaveia trava e temporal por NOME, e o servidor não tem UNIQUE. Não reproduzi (exige dois navegadores). Seria decisão de produto (sufixar ou recusar no servidor).
- **Restauração de banco**: o `setLastVersion` do `ws-client` só sobe, então um cliente com cursor acima do `current_version` restaurado pula ops. É cenário de operação e não foi medido.
- **Retrato HTTP de `resync()`** com op viva atrasada chegando depois dele (tipos sem guarda). Exige difusão atrasada; é raro e não foi forçado.
- **Sondados e descartados** na frente de permissões:
  - OM desativada com o socket aberto: o op é recusado e o socket fecha com 4003, por ddbd2cd8;
  - lote misto com mapa travado: a feição no livre mais a no travado, e o grupo no livre com membro do travado, são recusados inteiros;
  - renomear o mapa travado dentro do lote: recusado junto com a feição do lote;
  - Comentarista, Leitor e visitante mandando op de feição: já presos por `comments.test.js` e `collab-role-tiers`/`collab-commenter-authz`.

## Verificação
- **Backend, rodada inteira #1**: 5654/5654, mas o piso de cobertura reprovou. Era o instrumento: o denominador 60023/1385 diferia (o coordenador confirmou que o HEAD passa).
- **Backend, rodada #2**: 5661/5663. As duas falhas eram o instrumento de `sync-version-cursor`, já corrigido em 57f0cfcb. A cobertura passou o piso (97,51% das linhas).
- **Backend, rodada #3** (HEAD `ddbd2cd8`): 5675/5676. O vermelho era o censo da permissão por atlas, corrigido em 105c7ee8. A cobertura passou o piso (97,93% das linhas, 93,56% das funções).
- **Backend, rodada #4**: interrompida por mim para trocar de frente, sem resultado.
- **Backend, rodada #5** (HEAD `9ebab7dd`): 5679/5680. O único vermelho é `cross-cutting-gaps.test.js` ("re-enabling restores it"), que afirmava o comportamento que 4728f3bd fechou; o coordenador já o corrigiu na integração (86fde147), e este branch não tem o conserto. A cobertura passou o piso (98,36% das linhas, 96,96% das funções).
- **Frontend vitest** (HEAD `9ebab7dd`): 15759 verdes. O único vermelho é `teto-de-peso-da-pagina-do-mapa`, porque falta `dist/` na worktree; não mexi.
- **Contrato e2e do frontend** (vitest contra backend real): 70 arquivos, 261 casos, 0 pulos. Verde três vezes; a última no HEAD `4728f3bd`.
- **Playwright** (`--retries=0 --workers=1`, portas 4338/3928): `browser-collab-reconnect`, `browser-collab-rename-remoto`, `browser-collab-lock` e `browser-collab-feature-mutations` deram 9/9 verdes; com `browser-collab-permissions` no lugar do lock, 10/10.

## Linhas propostas para o livro-razão
- 2026-09-23 `premissa-inventada` [copia-camada-da-feicao] A cópia de atlas remapeava a coluna `layer_id` e copiava `properties.layerId` com o id da origem, e o retrato servia a propriedade; o cliente filtra por ela, então toda cópia abria com as feições invisíveis. O import já realinhava, a cópia não; e nenhum teste de clone olhava a propriedade. Codificado em `backend/tests/integration/copia-realinha-camada-da-feicao.repro.test.js` e na derivação da camada pela coluna em `transformFeaturesToFrontend`.
- 2026-09-23 `verificacao-fantasma` [413-transitorio] O flush tratava 413 como falha de rede: a fila parava atrás do lote grande e o aviso culpava a conexão. Codificado em `PERMANENT_PUSH_REJECTIONS` com o recorte pela metade, e em `frontend/tests/integration/sync-engine.test.js` e `backend/tests/integration/sync-corpo-grande-413.test.js`.
- 2026-09-23 `premissa-inventada` [lock-do-log-so-no-push] O cursor do pull incremental dependia de ordem de versão = ordem de commit, garantida só no push; os marcadores REST escreviam no mesmo log sem o lock. Codificado em `lockAtlasLog` (`backend/src/modules/sync/atlas-log-lock.js`) e em `backend/tests/integration/marcador-rest-ordem-de-commit.repro.test.js` e `backend/tests/integration/trava-do-log-nas-excecoes-rest.test.js`.
- 2026-09-23 `premissa-inventada` [resposta-depois-da-op] A resposta do `sync_request` saía depois de uma leitura extra, e um quadro de op mais novo chegava antes dela; o cliente aplica em ordem de chegada. Codificado em `holdOperationFrames` e em `backend/tests/ws/sync-request-ordem-dos-quadros.repro.test.js`.
- 2026-09-23 `verificacao-fantasma` [recusa-que-difunde] O gate de autoria do comentário recusava a edição alheia e deixava passar a exclusão alheia, que o SQL não aplicava mas o servidor difundia como aplicada. Codificado em `commentEditDenialReason` e em `backend/tests/ws/comentario-exclusao-alheia-recusada.repro.test.js`.
- 2026-09-23 `premissa-inventada` [socket-com-permissao-velha] A escrita pelo socket usava a permissão do handshake; desativar conta ou OM só alcançava o socket na varredura. Codificado em `authorizationStillHolds` (`collab.gateway.js`) e em `backend/tests/ws/escrita-ws-reconfere-autorizacao.repro.test.js`.
- 2026-09-23 `premissa-inventada` [link-republicado] O token de visitante carregava só o atlas, e as portas perguntavam só se o atlas era público; republicar (link novo) devolvia a leitura aos tokens do link vazado. Codificado em `publicLinkFingerprint` e em `backend/tests/integration/link-publico-republicado-nao-revive-token.repro.test.js`.
- 2026-09-24 `premissa-inventada` [retrato-pelo-socket] O teto da cauda trocou cauda por retrato nas DUAS portas, e a do socket manda quadro sem compressão que, em enlace lento, dura mais que o heartbeat: laço de reconexão sobre o mesmo cursor. Só a revisão cruzada com a frente de rede viu. Codificado em `longTail` (`pullOperations`), em `backend/tests/ws/sync-request-cauda-longa-pede-http.test.js` e em `frontend/tests/e2e-ui/cauda-longa-em-link-lento.repro.spec.js`.
- 2026-09-23 `verificacao-fantasma` [controle-negativo-com-precedencia] Um controle negativo feito com `false && A || B` deixou o ramo B ligado e "passou", fazendo o controle parecer medir o que não media. Precedência de operador em sed de controle negativo: desligue o ramo inteiro (`if (false)`).

## Parágrafos de doc propostos
- **`docs/wiki/snapshot-e-pull-incremental.md`**: "Desde 2026-09-23 a cauda tem teto. Acima de `PULL_TAIL_MAX_OPS` (500) ops ou de `PULL_TAIL_MAX_STORED_BYTES` (2 MiB guardados), `pullOperations` responde o retrato. A medida é uma consulta limitada ao teto mais um (`MEASURE_OPERATIONS_TAIL`), então decidir nunca lê a cauda longa. Os dois caminhos do cliente tratam `isSnapshot`, e a edição pendente sobrevive pela reprojeção de `applyRemoteSnapshot`."
- **`docs/wiki/canal-collab-websocket.md`**: "Os quadros de op endereçados a um socket esperam a resposta do `sync_request` dele sair (`holdOperationFrames`) e depois são liberados sem as ops que a resposta cobre. Os quadros que escrevem ou leem o log (`operation`, `operations`, `sync_request`) reconferem a autorização antes de agir; presença continua na varredura."
- **`backend/CLAUDE.md`, exceções REST**: "Duplicação e merge tomam `lockAtlasLog` antes de tocar na linha do atlas e no marcador; clone e import não, porque escrevem num atlas que ninguém mais vê até o commit."
- **As 6 páginas que dizem {400, 422}**: com o coordenador.

## Cobertura desta frente
- **Coberto**:
  - push, lote e recibos;
  - pull e retrato;
  - ordem de versão e commit;
  - broadcast e `sync_request`;
  - clone, duplicação, merge e import (atomicidade e ids);
  - permissões com socket vivo (revogar, rebaixar, desativar, Comentarista, Leitor e visitante);
  - trava de mapa em lote.
- **Fora**:
  - `entity-conflicts.js` a fundo;
  - `catalog_layer`;
  - 360 e 3D;
  - Playwright de colaboração além dos 4 specs;
  - Firefox.
