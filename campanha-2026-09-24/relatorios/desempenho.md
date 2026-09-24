# Caça noturna: desempenho (hunt/desempenho)

Status: ciclo concluído (21:48 a 00:40; retomado 02:34 a 02:50 depois do limite de sessão). Carga da máquina durante as medidas: 26 a 38
processos node (outros 8 agentes); números absolutos são ordem de grandeza, e as comparações antes e
depois foram intercaladas na mesma rodada.

Commits no branch `hunt/desempenho`, em ordem:

| SHA | o quê |
|---|---|
| 93c2d27b | perf(sync): fila de saída lê chaves por faixa, não varre o banco |
| 73d567ed | perf(collab): gate e espaçamento da reconstrução das fontes na rajada remota (integrado como 4786cd8f) |
| 4551b0fa | perf(collab): o par aplica um quadro de criações remotas com UMA escrita do documento do mapa (integrado) |
| b3a92952 | fix(collab): vigia de 5 s no gate de render e teto de 2 s no espaçamento (achado da revisão em 4786cd8f) |
| 7e927b4d | perf(sync): a cauda de reconexão (`sync_response`) passa pelo caminho do quadro |
| d71c4c95 | fix(collab): rodada de render superada repinta, e o unwire limpa timer e vigia (achado da revisão 4A em 5d913a4c) |
| b0cc9f86 | PROPOSAL (owner decision B6.1): partir o MESMO VERBO sobre feições independentes acima de LOTE_MAX_OPS (criações, atualizações, exclusões, e desfazer/refazer uniformes). NÃO integrar sem o dono. Último commit (substitui 1c5d5899). |

## Bugs corrigidos

### 1. A fila de saída varria o banco inteiro a cada ciclo de envio (93c2d27b)
- Severidade: desempenho, custo PERMANENTE (sessão inteira) depois de qualquer importação grande.
- Sintoma: num atlas remoto em que se criou muita coisa, todo tique de 1,5 s do auto-flush custava
  O(feições já escritas) mesmo com a fila VAZIA; drenar uma fila grande era quadrático.
- Causa: `countByState`, `peek` (`_getOrderedKeys`) e `dequeue` em
  `frontend/src/js/store/sync/operation-queue.js` usavam `store.keys()` (cursor sobre o banco
  inteiro). O banco guarda `FEATURE_LATEST` para sempre (um por feição, de propósito) mais
  identidade e cabeça por op.
- Medido (Chromium, `OperationQueue` real, laço peek(25)+dequeue até esvaziar, sem rede):
  2000 ops 9,0 s -> 1,9 s; 8000 ops 75,3 s -> 9,4 s (antes: 4x ops, 8x tempo);
  tique ocioso com 8001 chaves de metadado 40 ms -> 0,3 ms.
- Conserto: `listKeysWithPrefix` (um `IDBKeyRange` + `getAllKeys` por prefixo, pela conexão nativa
  compartilhada; volta à listagem filtrada fora do IndexedDB e em qualquer falha).
- Teste: `frontend/tests/integration/fila-nao-varre-metadado.repro.test.js` (zero `keys()` e zero
  cursores no ciclo, com as respostas conferidas). Controle negativo: 2 casos reprovam sem o conserto.

### 2. A rajada remota reconstruía todas as fontes do mapa quase por operação (73d567ed + b3a92952)
- Severidade: desempenho (convergência lenta do par, CPU dobrada).
- Causa: `wireRemoteFeatureRender` (`frontend/src/js/layers/remote-feature-render.js`) com debounce
  fixo de 80 ms e sem guarda de "em curso": cada op remota num mapa grande leva mais de 80 ms, então
  havia uma reconstrução completa (`setupMapFeatures`: leitura do documento + `setData` de tudo +
  LAYERS_CHANGED) a cada ~2 ops, podendo sobrepor.
- Medido (par B recebe 300 criações num mapa de 3000 pontos, 3 rodadas intercaladas):
  reconstruções 161/220/176 -> 45/52/50; convergência 35,9/44,7/33,4 s -> 24,5/18,7/16,0 s.
- A 1a versão (73d567ed) tinha defeito de correção achado na revisão do coordenador: gate liberado
  só no `finally`, sem prazo (um refresh pendurado na rede congelava o desenho de TODA edição remota
  até F5), e espaçamento `2 x último` sem teto aplicado a todo agendamento. Corrigido em b3a92952:
  vigia de 5 s abre a porta (liberação por id de execução, o término tardio não abre a porta da
  seguinte); espaçamento só no caminho de arrasto, igual à duração do refresh que acabou, teto 2 s;
  evento isolado sempre 80 ms. A mesma 1a versão fez `browser-collab-transferencia-origem-cheia`
  "trava REAL" reprovar 2/10 no piso do instrumento (que só enxerga a fonte depois de um `setData`
  inteiro); com b3a92952: 8/8 + 3/3. A revisão 4A achou mais um: a rodada superada pelo vigia, ao
  terminar tarde, fazia `setData` com a lista lida antes de travar (uma feição apagada pelo colega
  reaparecia até o próximo evento remoto), e o `unwire` deixava timer e vigia armados. Corrigido em
  d71c4c95: a rodada superada que termina chama `schedule()`; o `unwire` cancela os dois.
- Testes: `frontend/tests/unit/remote-feature-render.test.js` (contam timers, sem relógio: sem
  sobreposição, arrasto, vigia, término tardio, teto). Controles negativos: contra 73d567ed 4
  reprovam; sem a liberação do vigia 2; sem o teto 1.

### 3. O par aplicava a rajada do colega com UMA escrita do documento do mapa por op (4551b0fa)
- Severidade: desempenho grave em mapa grande (interface com long tasks, minutos para convergir).
- Causa: toda op remota de feição é read-modify-write do documento INTEIRO do mapa
  (`applyRemoteFeatureOpLocked`), e o `ws-client` aplicava o quadro do servidor op a op: O(K x N).
- Medido: por op, 22 ms com mapa de ~250 feições, 88 ms com ~2500, 217 ms com ~5250.
  300 criações sobre 3000 pontos: 16-24 s -> 1,4/2,4 s. 500 sobre 5000: 108,7 s com 21 s de long
  tasks -> 2,4 s, zero long tasks.
- Conserto: `applyRemoteOperations(frame)` mantém o contrato de uma op (ordem, para no primeiro
  `false`, erro sobe) e grava juntas as CRIAÇÕES consecutivas do mesmo mapa (`applyRemoteCreateRun`):
  um `getMap`, um `saveMap`, depois por membro a versão, `FEATURE_CREATED`, o span `apply.persist`,
  `REMOTE_OPERATION_APPLIED` e as conclusões adiadas. Qualquer membro que precise de ramo especial
  (edição local pendente, versão mais velha, mapa que não chegou, eco do autor, mudança de mapa)
  devolve a corrida inteira ao caminho de uma op ANTES de gravar. `ws-client` entrega o quadro a um
  manipulador `operationBatch`; o gateway mantém o portão offline e o relógio de Lamport.
- Testes: `frontend/tests/integration/rajada-remota-um-documento.repro.test.js` (25 criações = 1
  leitura + 1 escrita; contrato por op; os cinco recuos; falha de gravação sobe) e dois casos em
  `frontend/tests/integration/ws-client.test.js`. Controle negativo: sem a corrida 2 reprovam; sem o
  manipulador de quadro os 2 do ws-client. 18/19 casos de colaboração no navegador verdes (o 19o é o
  do item 2, já tratado).
- Nota do coordenador já aplicada na integração (9f399f7e): `replaceDerivedOutput` dentro do laço.

## B6.1: gestos comuns acima de 200 num atlas remoto (tabela para o dono)

Medido em 2026-09-24 no Chromium, atlas de servidor, 300 feições (pontos) semeadas no Postgres e
abertas pelo cliente, spec temporária dirigindo as mesmas funções de store que a interface chama.
"Lotes" é a contagem de `batchId` na fila logo depois do gesto. Sem = HEAD antes da proposta;
Com = b0cc9f86.

| gesto | como vira operação | sem a proposta | com a proposta |
|---|---|---|---|
| Importar arquivo / colar 300 / saída de processamento (`addFeatures`) | 1 transação, 300 criações, 1 lote | 0 no Postgres; fica SÓ neste computador; 300 pendências; aviso "Esta ação gerou mais de 200 alterações..." | lotes 200+100; 300 no Postgres; sem pendência (import de 450 também chega ao par) |
| Mover 300 para outra camada (`moveFeaturesToLayer`) | 1 transação, 300 atualizações (+ a criação da camada) | 0 no Postgres; 300 pendências; o retrato de recuperação DESFAZ o mover na tela; mesmo aviso | lotes 200+100; 300 no Postgres e 300 na camada nova, local e par (prova com 250) |
| Selecionar tudo + excluir 300 (`deleteSelectedFeatures`) | 1 transação POR feição (um Ctrl+Z) | chega: ~275-300 lotes de 1, 0 vivas no servidor | igual |
| Desfazer a exclusão de 300 | 1 gesto (`withGestureBatch`), 300 criações num lote | 0 no Postgres; 300 pendências; o retrato desfaz o desfazer (local 0); aviso | lotes 200+100; 300 vivas de novo no servidor |
| Estilo/cor em massa de 300 (`updateSelectedFeatures`) | 1 transação por feição | chega (300 no servidor) | igual |
| Desfazer o estilo em massa | 1 gesto, 300 atualizações num lote | servidor continua com a cor nova; 300 pendências; o retrato reverte o desfazer; aviso | lotes 200+100; a cor antiga volta no servidor, no local e no par (prova com 300) |
| Tabela de atributos: remover uma coluna de 300 (`_handleRemoveColumn`) | 1 transação por feição | chega (~275 lotes de 1) | igual |
| Tabela de atributos: editar célula | 1 op por célula editada | não chega perto do teto (não há "preencher coluna" em massa na tabela) | igual |
| Transferir camada com 300 para outro mapa (mover) | gesto COMPOSTO, 301 ops num lote | 301 pendências; nada muda no servidor; toast FALSO "Verifique o espaço disponível no navegador" + o de 200 | igual (composto fica atômico, fora do recorte) |
| Reagendar (`rescheduleMapTemporal`) | 1 transação por mapa | não produziu op na medida (a config temporal semeada não se qualificou); INCONCLUSIVO | não medido |

O que a tabela diz ao dono: sem a proposta, o que QUEBRA acima de 200 são as ações de UMA transação
(importar, colar, processar, mover para camada) e os DESFAZER de qualquer gesto em massa; as ações de
uma feição por vez (excluir seleção, estilo em massa, editar a tabela) já chegam. O desfecho é pior
que uma recusa: no mover e nos desfazer, o retrato de recuperação reverte a tela e a pessoa vê a
ação "desacontecer" com uma pendência; no importar, os dados ficam só naquele computador.

Suspeita vista ao medir, FORA da minha frente (não investigada, por ordem do coordenador): transferir
uma camada de 100 feições para um mapa criado por `addMap` um instante antes devolveu
`target_write_incomplete` com o toast de espaço em disco, enquanto o servidor aplicou o mover (100 no
destino, 0 na origem). Pode ser artefato de chamar `addMap` e transferir em seguida; os specs de
transferência pela interface passam.

## Bugs confirmados e não corrigidos

- **B6.1: importar/colar/processar mais de 200 feições num atlas remoto nunca sobe.** Um `batchId`
  por transação e o servidor recusa lote acima de 200; o cliente recusa localmente e tudo vira
  pendência. Decisão do dono (aberta desde 2026-09-19). PROPOSTA pronta em b0cc9f86 (último commit; ver a tabela acima),
  com repro no navegador (450 pontos: Postgres 0 sem, 450 com; o par recebe 450), contrato e2e da
  parte recusada contra o servidor real (mapa travado entre a parte 1 e a 2: aviso "parte 2 de 3 ...
  200 de 450 já chegaram"), e controles negativos. Preço declarado: o import deixa de ser atômico
  no servidor. Vermelho conhecido e NÃO levantado (regra do coordenador): teto-de-peso, fonte total
  11721 kB > 11710 kB no HEAD (em d71c4c95, sem a proposta, o teto passa).
- (CORRIGIDO em 7e927b4d) O replay de reconexão (`sync_response`) aplicava op a op; agora vai por
  `applyRemoteOperations`. Teste de rota em `sync-engine.test.js`, controle negativo reprova.
- **Atualizações e exclusões remotas em rajada continuam O(K x N)**: só as criações consecutivas são
  agrupadas. Um colega que recolore 300 feições num mapa de 3000 paga ~300 leituras e escritas do
  documento no par (o item 2 impede a reconstrução por op, não a escrita).
- **A mesma classe B6.1 vale para ATUALIZAÇÕES em lote, e a proposta NÃO as cobre** (recorte
  aceito pelo coordenador: só criações). Lido no código: `moveFeaturesToLayer` ("Mover para camada")
  e `shiftMapTemporalTimes` ("Reagendar"), em `frontend/src/js/store/feature.operations.js`, gravam
  N UPDATEs numa `runTransaction` só, então com mais de 200 feições o lote é recusado localmente:
  a mudança fica só neste computador e vira pendência. A tabela de fan-out de
  `docs/wiki/fila-operacoes-outbound.md` lista ainda "ocultar/bloquear em lote" e "adicionar/deletar
  coluna" com uma op por feição (não conferi se são uma transação). Estender
  `isIndependentCreateSet` para "operações de feição de ENTIDADES DISTINTAS, fora de gesto" cobriria
  todas; é decisão do dono junto com B6.1. MEDIDO no navegador para o mover (spec temporária, apagada): 250
  feições semeadas por SQL num atlas remoto, `moveFeaturesToLayer` para uma camada nova: censo da fila
  `problemas: 250`, 0 no Postgres com a camada nova, e o retrato de recuperação desfaz o gesto local.
- **A cauda de reconexão não tem teto e o WebSocket não comprime** (servidor). `pullOperations`
  (`backend/src/modules/sync/sync.service.js`, `GET_OPERATIONS_SINCE_VERSION`) devolve TODA a cauda
  desde o cursor, sem LIMIT, e a poda (`cleanupOldOperations`) só roda pela rota de administrador:
  quem reabre um atlas depois de semanas recebe a cauda inteira num quadro `sync_response`; e o
  `WebSocketServer` (`collab.gateway.js`) nasce sem `perMessageDeflate`, então esse quadro (e o
  retrato quando ele vai pelo socket) viaja sem compressão, enquanto o HTTP usa `compression`.
  Proposta (não implementada, mexe no servidor e na capacidade medida): responder retrato quando
  `currentVersion - sinceVersion` passar de um limiar, e `perMessageDeflate` com `threshold`
  (só quadros grandes). Não medido.

## Suspeitas não confirmadas / não medidas

- `countByState` ainda lê TODOS os envelopes a cada tique quando a fila tem trabalho NÃO enviável
  (problemas). Com 5000 pendências (o caso B6.1 hoje), cada tique lê 5000 envelopes. Não medido; a
  proposta B6.1 remove a principal fonte.
- Lado servidor (cenário 6): só leitura. O pull incremental usa `idx_operations_atlas_version`
  (atlas_id, server_version); o retrato já é um pacote de nove coleções num round-trip e o custo
  quadrático de grupos foi consertado em 2026-09-22. EXPLAIN ANALYZE e broadcast para 10 não medidos.
- **Descartadas por medida (Chromium, 2026-09-23):** vazamento na troca de MAPA (45 trocas entre 3
  mapas de um atlas remoto: ouvintes do barramento 158 -> 158, ouvintes do MapLibre 44 -> 44, camadas
  90 -> 90, fontes 76 -> 76, DOM 1661 -> 1661; ~129 ms por troca) e na troca de ATLAS (16 trocas
  remoto -> remoto por `switchAtlas`: barramento 158 -> 158, MapLibre 44 -> 44, intervalos vivos
  8 -> 8, sockets abertos 1 -> 1, DOM 1655 -> 1655; ~834 ms por troca). Specs temporárias, apagadas.
- Tabela de atributos: não virtualizada e re-renderiza inteira a cada atualização (linear, sem
  laço quadrático achado em `table-data.service.js`/`attribute-table.control.js`); mesma classe da
  lista de feições cuja virtualização o dono recusou. Não medido com 10 mil.
- A aba de feições com dezenas de milhares (não virtualizada) já está medida e a virtualização foi
  recusada pelo dono em 2026-09-23; não refiz.

## Linhas propostas para o livro-razão

- 2026-09-23 | verificacao-fantasma (custo escondido) | A fila de saída varria o banco inteiro por
  tique e por push (`store.keys()` alcança o metadado que o recibo deixa para sempre): 40 ms por
  tique ocioso depois de 8000 feições e drenagem quadrática. Codificado em
  `frontend/tests/integration/fila-nao-varre-metadado.repro.test.js` (zero cursores no ciclo).
- 2026-09-23 | desempenho | O par aplicava a rajada remota op a op, cada op relendo e regravando o
  documento inteiro do mapa (500 criações em mapa de 5000: 109 s). Codificado em
  `frontend/tests/integration/rajada-remota-um-documento.repro.test.js` (1 leitura + 1 escrita por
  quadro).
- 2026-09-23 | teste-que-nao-prende / correção de gate | O gate single-flight do render remoto nasceu
  sem prazo (refresh pendurado na rede congelava o desenho até F5), achado na revisão e não pela
  suíte. Codificado nos casos "vigia" e "término tardio" de
  `frontend/tests/unit/remote-feature-render.test.js`. Lição: todo gate single-flight sobre trabalho
  que toca a rede nasce com vigia.

## Parágrafo de doc proposto (docs/wiki/desempenho-do-mapa-2d.md, seção nova "A rajada remota")

"A rajada de operações de um colega custava duas vezes o documento do mapa. Toda op remota de feição
é leitura e regravação do documento INTEIRO (`applyRemoteFeatureOpLocked`), e o render remoto
(`wireRemoteFeatureRender`) reconstruía todas as fontes a cada ~2 ops. Desde 2026-09-23 o par aplica
o quadro do servidor de uma vez (`applyRemoteOperations`: criações consecutivas do mesmo mapa numa
escrita só; o resto pelo caminho de uma op) e o render tem single-flight com vigia de 5 s e espera de
arrasto com teto de 2 s. Medido: 500 criações num mapa de 5000 pontos, de 109 s para 2,4 s. O que
continua O(K x N): atualizações e exclusões em rajada, e o replay de reconexão (`sync_response`), que
ainda aplica op a op."

## O que cobri e o que ficou de fora

Coberto: cenários 2 (rajada remota) e 3 (fila/flush) medidos no navegador, com consertos; B6.1
(cenário 3 com mais de 200) como proposta. Fora: cenário 1 (atlas de 20 mapas, retrato na rede, troca
de mapa, exportar), 4 (tabela de atributos, seleção por caixa, painel de camadas), 5 (sessão longa:
há `release-long-session.scenario.js`), 6 (servidor).

## Ciclo extra (03:45 a 04:05): cenários 1 e 4

Antes: `hunt/desempenho-proposta` guarda b0cc9f86 (a PROPOSTA B6.1); `hunt/desempenho` foi posto em
`hunt/integra` (0b34457d). Máquina compartilhada, Chromium, atlas de servidor, pontos semeados no
Postgres.

### Corrigido: a seleção por caixa mandava um quadro de presença por feição (fa766de0)
- Causa: `presence-bridge.js` assinava `broadcastSelection2D` em `selection.features`, que muda UMA
  vez por feição na seleção por caixa, e cada quadro leva a seleção INTEIRA: K quadros, O(K²) bytes,
  serializados na thread principal e retransmitidos pelo servidor à sala.
- Medido (5000 pontos, corpo de `executeRectangleSelection` sobre K): K=1000: 1000 quadros e 48 MB
  -> 3 quadros e 0,15 MB; K=2000: 2000 e 195 MB -> 9 e 1 MB; K=4000: 4000 e 782 MB, 11,5 s -> 42 e
  11,7 MB, 4,3 s.
- Conserto: o `scheduleCoalesced` que o cursor já usa (ponta + um arrasto por janela de 100 ms).
- Teste: dois casos em `frontend/tests/integration/presence-bridge.test.js` (1000 mudanças = ponta +
  UM arrasto com as 1000; parar a presença cancela o arrasto). Controle negativo: os dois reprovam.

### Medido e não corrigido
- Seleção por caixa continua superlinear depois do conserto: 1000 em 0,3 s, 2000 em 1,0 s, 4000 em
  4,3 s. Causa lida no código: `getCompleteFeatureFromSource` chama `mapSource.getData()` POR feição,
  e com a fonte em modo `updateable` o MapLibre devolve `Array.from(...)` da coleção inteira a cada
  chamada, mais um `.find` O(N): O(K x N); e `addToSelection`/`isFeatureSelected` são O(K) por
  feição. Proposta: ler a fonte uma vez por gesto de caixa e um `addManyToSelection`. Fora do perfil
  de uso declarado (poucas centenas por mapa: 500 levam 0,2 s).
- Tabela de atributos com 5000 linhas: abre em 0,6 a 1,2 s e cria ~100 mil nós DOM (20 por linha), linear;
  mesma classe da lista não virtualizada que o dono recusou virtualizar.
- Atlas de 20 mapas x 3000 pontos (60 mil): abrir (com login pela interface) 6,8 s; retrato 24,3 MB
  descomprimido (o HTTP comprime), pull em 0,66 s; trocar de mapa 88 a 113 ms; montar o documento do
  `.ebgeo` 0,4 s, 23,8 MB de JSON; heap 322 MB. Com 20 x 2000: 7,1 s, 15,8 MB, trocas de 68 a 161 ms.
  Nada quadrático; nenhum conserto.

## hunt/b61 (B6.1 aprovado pelo dono, 2026-09-24)

- b3d22b33 (parte 1, integrada como 9e6ccb57): porte da proposta, decisão registrada, tetos medidos.
- Parte 2 (em andamento, ver PRÓXIMO PASSO): TODO lote acima de 200 (transação ou gesto,
  compostos inclusive) parte em blocos de até 200 encadeados por `dependsOn` (primeira op de cada
  bloco depende da última do anterior); a fila já segura dependente de op com problema e o envio já
  é um push por vez, então bloco recusado segura os seguintes. Mais: recibos de um push reparados
  juntos (`resolveLocalEdits`), eco do autor e mudança de mapa entram na corrida de criações.
- Medido ANTES da parte 2 (só com a parte 1): importar 5000 drenava a ~4,5 ops/s no autor (2400 de
  5000 no Postgres depois de 9 min); com recibos em lote, ~6 ops/s (3600 em 10 min). Perfil de
  importar 1000 (36 s): 552 leituras do documento do mapa em `applyRemoteFeatureOpLocked` (o eco
  do próprio autor, ADIADO pela edição local pendente e depois reaplicado uma op por vez em
  `replayDeferred`), 141 leituras em `getCatalogLayers` e 141 em `getCurrentMapFeatures`
  (disparadas por evento durante a drenagem).

## hunt/b61: commits (atualizado 08:45)

| SHA | o quê |
|---|---|
| b3d22b33 | parte 1: porte do B6.1 (mesmo verbo sobre feições independentes), decisão e tetos (integrado 9e6ccb57) |
| ec7de7fc | parte 2: TODO lote acima de 200 em blocos encadeados por dependsOn, compostos inclusive; recibos em lote (integrado 59f1268f) |
| db1ca9c5 | perf: ecos adiados do autor reaplicados juntos; recuo aplica UMA op e remede a corrida (importar 1000 no autor: 36-73 s -> 12,3 s) |
| deda010f | revisão 1: dependsOn em TODA op da parte seguinte (aceitar o servidor não solta a parte retida) |
| c364b122 | revisão 2: duas partes nunca no mesmo push (reserva antes do enqueue; não empacota dependente) |
| 1f960de5 | revisão 3: corrida de mudanças leva a saída derivada da origem |
| 12e98e79 | revisão 4: lote de reparos que para recua para um a um |
| 47338031 | revisão 5: a frase da recusa só segue o elo de parte |

## B6.1 em escala: gesto -> antes -> depois -> tempo (2026-09-24, Chromium, dois navegadores + Postgres + F5)

Máquina compartilhada (40 a 66 processos node): tempos são ordem de grandeza. "Local" é o gesto na
tela do autor; "servidor" é do gesto até o Postgres ter tudo; "par" é o atraso do colega depois do
servidor; "long task" é a soma de long tasks no colega durante a etapa. Coluna A = antes do B6.1
(c777d8c5, medido com 300); B = depois de db1ca9c5 (lotes encadeados, sem as corridas de
update/delete); C = depois de 8137348b (topo do hunt/b61 antes das operações de store em lote).

| gesto | A: antes do B6.1 | B: servidor / par long task | C: local / servidor / par long task | F5 no par |
|---|---|---|---|---|
| importar 5000 | 0 no servidor, só no computador (medido com 300) | 57 s / 0,4 s | 10,6 s / 85 s / 0,9 s | ok |
| colar 1000 (cópias) | 0 no servidor (medido com 300) | 8,1 s / 0,05 s | 1,4 s / 19,6 s / 0,3 s | ok |
| mover 1000 para outra camada | 0 no servidor, retrato reverte a tela | 156 s / 36,8 s | 1,5 s / 12,4 s / 0,7 s | - |
| excluir 1000 (1000 transações) | chegava | local 46,5 s, 51 s / 31 s | 19 s / 4,3 s / 2,7 s | - |
| desfazer a exclusão de 1000 | 0 no servidor, retrato reverte | 3,1 s / 0,2 s | 26 s / 4,2 s / 0,5 s | - |
| refazer a exclusão de 1000 | 0 no servidor | 50 s / 35 s | 41 s / 2,8 s / 0,06 s | ok |
| estilo em massa 1000 (1000 transações) | chegava | local 108 s, 134 s / 60 s | 28,6 s / 5,0 s / 4,1 s | - |
| desfazer o estilo de 1000 | 0 no servidor, retrato reverte | 126 s / 53 s | 16 s / 5,1 s / 0,4 s | ok |
| agrupar 500 | recusado inteiro | 6,1 s / 0 | 0,8 s / 4,2 s / 0 | - |
| copiar camada de 1000 para outro mapa | recusado inteiro (301 pendências) | 18,4 s / 0,06 s | 1,0 s / 12,2 s / - | - |
| mover camada de 1000 para outro mapa | recusado inteiro | 15,2 s / 0,6 s | 1,5 s / 11,1 s / - | - (origem 0) |

Nenhum colega travou em C (maior quadro no par entre 17 e 183 ms). O que sobra é o tempo LOCAL dos
gestos de uma transação por feição (excluir, estilo, desfazer e refazer: 16 a 41 s para 1000),
porque cada `removeFeature`/`updateFeature` relê e regrava o documento inteiro: próximo passo,
operações de store em lote.

## hunt/b61-lote: o gesto LOCAL em lote (commit 2ebba72b, 12h20)

Branch `hunt/b61-lote` (de hunt/integra 28d4fbef), commit **2ebba72b**
`perf(store): a mass delete, restyle, undo or redo reads and writes the map document once`.
A integração espera a decisão do dono sobre o preço (abaixo).

O que entrou:
- `removeFeatures(refs)` e `updateFeatures(items)` em `frontend/src/js/store/feature.operations.js`:
  uma leitura e uma escrita do documento, UMA transação write-ahead, partes de 200 do B6.1. Por
  feição, como o caminho singular: saída derivada sai com a entrada, grupos pela sobreposição da
  transação (documento de grupos gravado uma vez), cores, uma entrada de desfazer, e a op com a feição
  guardada como `previousData`. Portão por posto e trava de mapa perguntado uma vez; trava de feição,
  camada e grupo continua em `deleteSelectedFeatures`. Acréscimo: gravar uma ENTRADA de análise
  re-deriva a saída no mesmo documento. Eventos: o caminho local singular não emite evento de feição
  (o autor repinta pelo controle); o `previousFeature` do par vem da corrida remota, intocada.
- Desfazer/refazer em massa (`store-state-manager.js`): corridas de entradas semelhantes numa chamada
  plural; `addMultiple` também; executor sem as plurais cai no laço antigo.
- Os 20 controles chamam a operação plural uma vez depois do laço (excluir, salvar, atualizar).

Verificado depois da última escrita: lint da raiz verde; `npm test --prefix frontend` 16176 verdes e
1 vermelho (teto de peso, 806 contra 805, IGUAL com os fontes do HEAD); `test:e2e` 265/265;
estilo de polygon 3/3 em série; Playwright de 25 arquivos 74/79 (os 5: "camada travada", já
ajustado na integração em 78a971d3; a corrida do teste no refazer do ciclo local, 6/52 nos meus fontes
e 5/36 no HEAD, pré-existente: o clique de refazer chega enquanto `runUndoRedo` ainda está em
`switchMap` do desfazer; e o polygon, que passou 3/3 em série). Testes novos: contagem no node
(1000 exclusões e 1000 estilos = 1 leitura, 1 escrita, 1 transação; o laço singular no mesmo arquivo
custa 1000 de cada; reverter reprova 11 de 12), desfazer em massa (reverter reprova 6 de 9), censo dos
controles (reverter o ponto acusa os três métodos).

### Coluna D (2026-09-24 ~12h, Chromium, dois navegadores + Postgres + F5, 1000 pontos)

Pelos funis reais: excluir por `selectionManager.deleteSelectedFeatures`; estilo pelo `saveFeatures`
do ponto dentro do coletor de desfazer (o "Salvar" do painel); desfazer e refazer pela store.

| gesto | C: local (antes) | D: local / servidor / par | par: maior quadro / long task |
|---|---|---|---|
| excluir 1000 | 19 s | 1,5 s / 8,2 s / 0 s | 317 ms / 0,5 s |
| desfazer a exclusão | 26 s | 1,2 s / 12,1 s / 0,2 s | 50 ms / 0 |
| refazer a exclusão | 41 s | 1,7 s / 9,1 s / 0 s | 50 ms / 0,06 s |
| estilo em massa 1000 | 28,6 s | 0,5 s / 7,1 s / 0,1 s | 50 ms / 0 |
| desfazer o estilo | 16 s | 1,0 s / 7,1 s / 0,1 s | 50 ms / 0 |
| refazer o estilo | (não medido) | 1,0 s / 8,1 s / 0,1 s | 50 ms / 0,05 s |

F5 no par ok nos dois casos. O contador de leituras e escritas do documento DENTRO do navegador
leu 0/0 em todas as etapas, o que é impossível: ele embrulhou uma instância do repositório que a
store não usa. Não conta como medida; a contagem que vale é a do teste no node.

### O preço, medido: 1000 estilos com 1 feição apagada pelo colega no meio

Entrelaçamento determinístico: o primeiro envio de A fica SEGURO na rede até a exclusão de B estar no
Postgres, então o lote de A leva um UPDATE sobre um túmulo.

- Servidor: 400 com o estilo, **599 vivas SEM o estilo** (mais a apagada). As partes 1 e 2 entraram;
  a parte 3 (onde estava a vítima) foi recusada inteira; as partes 4 e 5 nem saíram (pushes vistos:
  200, 200, 200).
- Tela do autor: 999 feições, 400 com o estilo (o retrato de recuperação desfez as 599 recusadas,
  então a tela diz a verdade do servidor).
- Avisos: "O item foi excluido no servidor." e "O servidor recusou a parte 3 de 5 desta ação. 400 de
  1000 alterações já chegaram; as outras 600 estão nas pendências para revisão."
- Pendências (600): contadores **1 Conflito, 199 Recusa do servidor, 400 Aguardando outra**. Captura
  lida em `scratchpad\pendencias-conflito.png`.
- **ACHADO no painel (defeito de texto, não corrigido):** as 199 irmãs da parte recusada aparecem uma
  por uma como "Feição «P595» … O item foi excluido no servidor.", o que é FALSO para elas: só a P500
  foi apagada. O servidor devolve todas as ops do lote com o MESMO `reason` e nomeia a culpada em
  `batchFailedOperationId` (`sync.service.js`, `recusarLoteInteiro`), e o cliente guarda o motivo
  da culpada em cada irmã (`sync-engine.js`, o laço "E O LOTE INTEIRO VIRA PROBLEMA"). O painel mostra
  esse motivo como se fosse de cada feição. Conserto proposto: a linha de uma irmã (problema cujo
  `batchFailedOperationId` não é o próprio id) diz que foi recusada JUNTO com a feição culpada,
  nomeando-a, e a de "Aceitar o servidor" se agrupa pela culpada. Com partes de até 200, uma culpada
  vira 199 frases falsas. Não mexi porque o desenho depende da decisão do dono sobre o preço.
- No caminho antigo (uma transação por feição) a mesma interferência custava UMA feição recusada.

## hunt/b61-lote: os dois commits seguintes (13h20)

| SHA | o quê |
|---|---|
| 2ebba72b | perf(store): removeFeatures/updateFeatures, uma leitura e uma escrita do documento (acima) |
| 32733551 | fix(pendencias): a irmã de uma parte recusada diz que foi recusada JUNTO, nomeando a culpada; "Aceitar o servidor" decide o grupo inteiro; o resumo diz quantas por causa de uma |
| ace22854 | fix(sync): decisão do dono (refina o B6.1): UPDATE e DELETE de feições distintas de excluir e estilizar em massa (e do desfazer e refazer deles) saem independentes; registrada em decisions-2026.md e no índice |

### 32733551: o motivo falso nas Pendências
- Antes: 199 linhas "Feição «P595» ... O item foi excluido no servidor." sobre feições que ninguém
  apagou; "Aceitar o servidor" numa delas levava só ela.
- Depois (navegador, imagem lida): contadores "1 Conflito, 199 Recusada junto, 400 Aguardando
  outra"; resumo "199 alterações foram recusadas só por irem junto com 1 que o servidor não aceitou,
  e 400 estão paradas atrás delas. O que você decidir sobre ela vale para o grupo inteiro."; cada
  irmã diz "Recusada junto com outra alteração desta ação: Feição «P500», no mapa «Mapa Tático»."; a
  parada nomeia a feição da frente em vez do id da operação; um clique em "Aceitar o servidor" numa
  irmã perguntou "Descartar 600 alterações" e deixou a fila em 0 pendentes e 0 problemas.
- Repro com a fila de verdade: `frontend/tests/integration/pendencias-recusada-junto.repro.test.js`
  (6 casos, os 6 reprovam com os módulos de linha e de ação do HEAD).

### ace22854: um conflito custa uma feição (decisão do dono)
- 1000 estilos com 1 feição apagada pelo colega no meio (navegador, dois navegadores + Postgres):
  **999 com estilo no servidor e na tela do autor, 1 conflito, Pendências (1)** (antes: 400 com
  estilo, 599 sem). O envio saiu 40 pedidos de 25.
- Contrato contra o servidor real (caso 5 de `lote-partido-parte-recusada.e2e.test.js`): 250
  estilos, 1 apagada antes do envio, 249 chegam, 1 problema; sem a marca, 0 chegam.
- Importar acima de 200 continua em partes encadeadas (node: 450 = 200 + 200 + 50 com elo; e2e
  caso 1; Playwright `importar-mais-de-200-no-servidor` verde). A marca é ignorada dentro de gesto,
  então conversão, divisão, fusão de setas, transferência e desfazer composto continuam inteiros.
- Coluna D refeita com a decisão (local / servidor / par):

| gesto | C: local (antes) | D2: local / servidor / par |
|---|---|---|
| excluir 1000 | 19 s | 1,4 s / 10,2 s / 0 s |
| desfazer a exclusão | 26 s | 0,9 s / 6,1 s / 0,2 s |
| refazer a exclusão | 41 s | 0,8 s / 9,1 s / 0 s |
| estilo em massa 1000 | 28,6 s | 1,1 s / 26,5 s / 0 s |
| desfazer o estilo | 16 s | 0,9 s / 27,4 s / 0 s |
| refazer o estilo | - | 0,9 s / 18,2 s / 0 s |

  O preço declarado: o estilo em massa sai 25 operações por pedido, como antes do lote, e o
  servidor recebe as 1000 em ~20 a 27 s em vez de 7 s. O gesto local continua em ~1 s, e o colega
  não trava (maior quadro 67 ms no estilo, 567 ms na exclusão).
- Verificado depois da última escrita: lint da raiz verde; frontend 16191 verdes e 1 vermelho (teto
  de peso, 806 contra 805, igual no HEAD); `test:e2e` 266/266; Playwright 48/49 (o vermelho é
  "camada travada", já ajustado na integração em 78a971d3).

## PRÓXIMO PASSO (se eu for cortado)

1. Worktree `C:\Users\diniz\ebgeo_hunt\desempenho`, branch `hunt/b61-lote`, topo ace22854, árvore
   limpa. Três commits prontos para integrar: 2ebba72b, 32733551, ace22854 (nessa ordem).
2. Aberto e não medido: acelerar o envio das operações independentes (hoje 25 por pedido). Seria
   empacotar várias independentes num pedido sem torná-las um lote, o que o servidor já aceita
   (ops sem `batchId` são aplicadas uma a uma); é o `FLUSH_BATCH_SIZE` e o `peek`, não o contrato.
3. A spec de escala está em
   `C:\Users\diniz\AppData\Local\Temp\claude\C--Users-diniz-OneDrive-Desktop-Desenvolvimento-ebgeo-web\b9aadc2d-f0b0-4f0d-bc1c-3c19c79a3a48\scratchpad\zz-escala-lote-local.tmp.spec.js`
   (copiar para `frontend/tests/e2e-ui/`, portas 4336/3926, apagar depois).
