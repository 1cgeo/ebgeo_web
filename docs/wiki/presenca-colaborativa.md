# Presença Colaborativa

Camada efêmera em memória que propaga roster, cursores, seleções (2D/3D/360) e awareness de briefing entre pares de uma sala de atlas. Esta página cobre só o que não se lê no código: as convenções que o próprio JSDoc descreve errado, as armadilhas que atravessam cliente e servidor, e os limites operacionais.

**O instante da linha do tempo saiu da presença em 2026-09-21**, por decisão do dono registrada em `docs/decisions/decisions-2026.md` (entrada de 2026-09-21). Havia um quadro próprio que carregava cursor, rótulo e reprodução de cada pessoa, era retido no socket, retransmitido à sala e devolvido no retrato de quem entrava depois, e a lista de quem está online escrevia "em D+3". A presença diz se a pessoa está no mapa ou não; a linha do tempo é visualização de cada um, como já eram o ligar e desligar, a reprodução e a velocidade desde 2026-09-20 ([[vista-da-pessoa-e-vista-salva]]). A remoção foi feita nos dois pacotes, e a volta é barrada por varredura estrutural em `frontend/tests/unit/presenca-temporal-nao-volta.test.js` e `backend/tests/unit/presenca-temporal-nao-volta.test.js`, mais o efeito ponta a ponta em `backend/tests/ws/presenca-temporal-removida.test.js`. A fila de saída é append-only, então um cliente antigo ainda manda o quadro: ele cai no ramo de tipo desconhecido do gateway, sem erro ao remetente e sem retransmissão.

Mapa dos arquivos: `src/js/presence/` (bridge, store, overlays, cores) e `backend/src/modules/collab/`. Os cabeçalhos JSDoc de `frontend/src/js/presence/presence-bridge.js` e `frontend/src/js/presence/presence-store.js` já listam frames inbound/outbound e eventos emitidos; não repetimos aqui.

## Por que presença é requisito, não enfeite

O modelo é **sem locks**: edição simultânea livre, conflito resolvido por [[modelo-conflito-lww]]. Sem presença, dois usuários mexem na mesma feição às cegas e o LWW vira perda de trabalho inexplicada. Presença é o que substitui o lock: o usuário evita a colisão porque **vê** o outro chegando. Por isso o indicador de briefing é advisory e nunca virou lock, e por isso derrubar presença por economia de tráfego é uma decisão de produto, não de infra.

Nada dela passa pela fila de operações, pelo IndexedDB ou pelo Postgres. Não vira linha em [[tabela-operations]], não entra na [[fila-operacoes-outbound]], não participa do LWW. Não confunda com [[envelope-operacao]] (persistido, idempotente) nem com [[comentario-espacial]] (entidade sincronizada de verdade). Só existe em atlas remoto conectado ([[atlas-modelo-de-dados]]); no modo local/anônimo o bridge fica montado e inerte ([[dominio-local-vs-remoto]], [[modos-operacao]]).

**Descartável por construção, e isso é deliberado.** `sendCursorFrame` faz `if (!wsClient.isConnected()) return;` (`frontend/src/js/presence/presence-bridge.js`) e nunca enfileira: misturar presença com a fila offline faria o usuário reviver cursores de dez minutos atrás no reconnect. No servidor, `cursor`/`selection` estão em `COALESCABLE_TYPES` e são **descartados** quando `bufferedAmount` passa do teto de drop, enquanto o mesmo laço termina (`terminate()`) o socket afogado por operações duráveis para forçar reconnect e replay (`broadcastToRoom`, `backend/src/modules/collab/collab.rooms.js`). Perder um cursor é invisível; perder uma operação é divergência.

## O invariante: TODO frame de presença carrega `clientId`

`resolveKey()` prefere `clientId` e cai para `userId` (`frontend/src/js/presence/presence-store.js`), então **quem decide a chave é o frame, não o store**. É por isso que carimbar o `clientId` no emissor não é preferência de estilo: é o que impede que a mesma pessoa exista sob duas chaves. Os dois grupos precisam carregá-lo, e hoje carregam:

- **Roster:** snapshot `connected` (`getRoomUsers`, `backend/src/modules/collab/collab.rooms.js`) e os frames `user_joined` / `user_left` / `user_away` / `user_back` (`backend/src/modules/collab/collab.service.js`). No `user_joined` o `clientId` precisa estar **aninhado** dentro de `user`, porque o bridge desembrulha `msg.user`.
- **Awareness:** `cursor` e `selection` (`handleCursor` e `handleSelection` em `backend/src/modules/collab/collab.handlers.js`). O cursor **sai agrupado** desde 2026-08-28, num frame `cursors` cujo lote é `{ clientId, userId, position, mapId }` por cliente (`enfileirarCursor`, `backend/src/modules/collab/collab.rooms.js`): o invariante continua valendo porque a chave do agrupamento É o `clientId`, e agrupar por `userId` faria uma aba apagar a outra. Ver [[canal-collab-websocket]].

**O que acontece quando um dos dois grupos esquece.** `setCursor`/`setSelection` **criam** a entrada quando a chave não existe (`?? normalizeUser(msg)`, `frontend/src/js/presence/presence-store.js`), então o mesmo par vira **duas entradas**: uma com nome e sem cursor (chaveada pelo `clientId`, vinda do roster) e outra sem nome e com cursor (chaveada pelo `userId`, vinda do primeiro movimento de mouse). O contador do roster mostra 2 para um par (`getOthers` não deduplica, `frontend/src/js/presence/online-users.control.js`) e o rótulo do cursor remoto cai para o UUID cru.

Isto não é hipotético: **aconteceu duas vezes, nas duas metades opostas.** Até `a358a6e` (2026-07-24), `user_away`/`user_back` eram os únicos a carregar `clientId`, o roster inteiro ficava sob `userId`, `_setAway` não achava a chave e retornava sem efeito, então o badge `ausente` nunca aparecia. Aquela correção uniformizou o roster e **não** os frames de awareness, e a assimetria migrou de lado, produzindo a entrada dupla acima. Fechado em 2026-07-25, com regressão em `backend/tests/ws/collab-awareness-clientid.repro.test.js`, cujo último caso afirma diretamente que a chave do roster e a do awareness são a MESMA, para que corrigir um caminho e esquecer o outro reprove.

A lição, que sobreviveu às duas: **uniformize a chave no emissor**, porque o consumidor não tem como reconciliar duas identidades depois. O store não pode se defender sozinho: um frame sem `clientId` é genuinamente inatribuível a uma aba, e casar por `userId` grudaria o cursor de uma aba na outra.

E repare por que a suíte não pegou nenhuma das duas vezes: `presence-store.test.js` injetava `clientId` dentro do payload de `setCursor`, um campo que o backend não emitia. A fixture era mais generosa que o formato de fio, então cada lado passava sozinho e o par estava quebrado. É o ponto cego que a auditoria de testes de backend de 2026-07 nomeou como o quinto: a fronteira entre os dois pacotes afirmada em comentário, testada de cada lado e nunca exercitada em par.

O que a divisão de chave **não** quebrava, e é útil saber por quê:

- **A cor continua estável.** `getPresenceColor` é hash djb2 sobre paleta fixa de 14 slots (`frontend/src/js/presence/presence-colors.js`), e as três superfícies alimentam o hash com `userId` primeiro (`frontend/src/js/presence/online-users.control.js`, `frontend/src/js/presence/remote-selections.layer.js`) ou com a chave da própria entrada de cursor, que já é o `userId` (`frontend/src/js/presence/remote-cursors.layer.js`). Avatar, cursor e caixa de seleção do mesmo par batem entre superfícies e entre máquinas sem coordenação com o servidor. Passar a chavear a cor por `clientId` trocaria a cor da pessoa no meio da sessão.
- **A exclusão do self continua correta**, porque é feita pelos **dois** ids: o roster exclui por `sessionContext.userId` (`frontend/src/js/presence/online-users.control.js`) e o overlay de cursor por ambos, com o motivo escrito no código (`frontend/src/js/presence/remote-cursors.layer.js`). Trocar para só `clientId` faz o usuário ver o próprio cursor.

Duas abas do mesmo navegador **compartilham o `clientId`** (ele vem do `localStorage`, ver [[client-id-estavel]]), então continuam colapsando numa entrada. Do lado do servidor são sockets distintos, e a guarda de `user_left` compara o PAR `(userId, clientId)` (`backend/src/modules/collab/collab.gateway.js`, em `removeConnection`); ver [[canal-collab-websocket]] para os dois sentidos em que essa escolha importa. Até 2026-07-25 ela comparava só o `clientId`, e a diferença aparece exatamente onde o `clientId` deixa de identificar uma pessoa: duas CONTAS no mesmo perfil de navegador mandam o mesmo valor, e o socket vivo da segunda calava o `user_left` da primeira, que ficava no roster alheio para sempre.

Não acredite no JSDoc de `frontend/src/js/presence/presence-store.js` ("keyed by clientId … a single user may have several browser tabs / clients"): nenhuma das duas metades vale, pelos dois motivos acima.

## Contrato congelado: `mapId` de presença é NOME de mapa

Não há sub-canal por mapa no servidor; toda mensagem vai para a sala inteira e **filtrar é do cliente**. O bridge carimba `getCurrentMapNameSync()` na saída (`frontend/src/js/presence/presence-bridge.js`) e os overlays resolvem o mapa ativo com a mesma função. As duas pontas precisam usar a mesma. Se alguém "corrigir" um lado para UUID, o filtro nunca casa e **nenhum cursor remoto renderiza, sem erro no console**. Contexto do dualismo nome/UUID em [[dominio-local-vs-remoto]].

O campo não é UUID e não precisa ser: o backend o trata como **opaco**, só reencaminha, então o contrato real é "chave de mapa acordada entre os clientes". Ler o UUID como obrigatório é o caminho mais curto para a "correção" que quebra o filtro.

Corolário: `getCursors()` sem argumento devolve cursores de **todos** os mapas, por isso o overlay recusa renderizar quando o mapa ativo é `null` (`frontend/src/js/presence/remote-cursors.layer.js`).

Mapa ativo pega carona no cursor porque o backend **não tem handler `map_active`**: uma troca de mapa manda um cursor sem posição carregando só o novo `mapId` (`frontend/src/js/presence/presence-bridge.js`). Quem for adicionar um sinal de "mapa atual" precisa saber que já existe esse canal implícito.

## O cursor tem superfície desde 2026-09-16, e a POSIÇÃO muda de forma junto

O cursor era só do mapa 2D, enquanto a seleção já vivia nas três superfícies. Hoje ele carrega `surface` e a mesma chave de escopo da seleção (`mapId` no 2D, `tilesetId` no 3D, `photoName` no 360), e o que muda de verdade é a POSIÇÃO: `{lng,lat}` no mapa, `{heading,pitch}` dentro de um panorama, `{lng,lat,alt}` dentro da cena 3D.

**Pixel não viaja, e é essa a razão de existir a conversão.** Cada par olha o panorama de um yaw/pitch/FOV próprio e a cena 3D de uma câmera própria, então a coordenada de tela de um significa outra direção na tela do outro: o cursor apareceria plausível e apontando o lugar errado, que é pior que não aparecer. O 360 manda a direção na esfera (`screenToSpherical`, `frontend/src/js/street_view_tool/navigation/projector.js`) e o 3D manda o ponto picado sobre o modelo (`scene.pickPosition`), e cada receptor reprojeta com a câmera dele.

Quatro consequências que não se adivinham:

- **Cada superfície tem a régua dela no servidor** (`Joi.when('surface')`, `backend/src/modules/collab/collab.schemas.js`). A tentação é declarar um objeto permissivo com os cinco campos opcionais; isso aceitaria calado um cursor 2D sem `lng`, e como `validatePresenceFrame` usa `stripUnknown`, campo não declarado é APAGADO em silêncio em vez de recusado.
- **O socket retém `cursorContext` junto com a posição** e `getRoomUsers` o publica, espelhando o `selectionContext`. Sem ele o late-joiner desenha o cursor de um panorama sobre o mapa, porque todo quadro de cursor também carrega `mapId` (o canal implícito de mapa ativo acima).
- **A janela de throttle é UMA para as três**, e o valor pendente é o QUADRO inteiro, nunca só a posição: o envio atrasado do fim da janela precisa saber de que superfície era o quadro, ou o quadro de uma sai rotulado como o da outra no instante exato da troca.
- **O 360 desenha sob demanda**, então o consumidor chama `requestRender()` ao receber presença (`updateRemoteCursors360`, `frontend/src/js/street_view_tool/street_view_viewer.js`); sem isso o colega só aparece quando o operador local mexe na própria vista. No 3D o laço é contínuo e a entidade aparece no quadro seguinte, mas a troca de tileset faz `entities.removeAll()` por fora do módulo, e por isso existe `resetRemoteCursors3D`.

## O escopo do cursor e da seleção é recortado por destinatário (2026-09-22)

De 2026-09-16 até esta data o `tilesetId` e o `photoName` do cursor e da seleção iam à sala inteira, o visitante anônimo de link público incluído, e a POSIÇÃO de um cursor 3D é pior que o id: é uma coordenada geográfica sobre o modelo, que situa no mapa um recurso privado. O dono autorizou o conserto no mesmo dia do achado, e a regra é a do visualizador aberto (seção seguinte), num módulo só para os três quadros (`backend/src/modules/collab/collab.recorte.js`): o servidor resolve o escopo no catálogo, escopo PÚBLICO vai inteiro a todos, escopo PRIVADO vai inteiro só a quem `fn_can_see_resource` libera no escopo do atlas da sala (o empréstimo conta), e o resto recebe o quadro REDIGIDO.

**Redigir, e não descartar, é a decisão do desenho do ponteiro.** O cursor redigido chega com a superfície e o mapa e sem o escopo e a posição (`redigirCursor`), e a seleção redigida chega VAZIA na mesma superfície (`redigirSelecao`). Descartar o quadro seria pior para a tela: quem não enxerga o modelo continuaria com o último ponteiro 2D do colega congelado no mapa, porque nada lhe diria que ele saiu dali, e com o destaque de seleção antigo aceso. O redigido limpa os dois e diz só o que o contexto de visualizador já diz ("no visualizador 3D", no mapa M).

Três coisas que se leem errado:

- **Identificador que não resolve é privado para TODOS**, o credenciado inclusive. Mandar o desconhecido em claro e esconder o privado conhecido faria da redação um oráculo de existência (duas contas, uma chuta ids e a outra lê quais voltam escondidos); é o mesmo "linha ausente recusa" do gate de escrita do sync. Por isso um teste que use um nome inventado de modelo e espere vê-lo chegar ao par mede a redação, e os casos antigos passaram a semear recurso público.
- **O custo continua o do lote de cursor.** Sem escopo privado no tique, a sala recebe UMA serialização, como desde 2026-08-28; com escopo privado, os destinatários são agrupados pela assinatura do que podem ver e cada grupo recebe uma serialização (na prática duas classes). A pergunta ao banco tem o memo de 30 s, então ela acontece uma vez por recurso por sala a cada 30 s, não a cada quadro. As descargas passaram a ser em série, porque uma que espere o banco não pode entregar o lote velho depois do novo, e o lote confere, na hora de sair, que o remetente ainda está na sala, o que fecha o fantasma da seção "Saída" também para a descarga que atravessou uma espera.
- **O retrato de entrada leva o escopo privado redigido** (posição nula, escopo nulo, seleção vazia), e quem pode lê-lo recebe cursor e seleção inteiros num quadro à parte, pelo mesmo complemento do visualizador (`enviarContextosAoRecemChegado`).

O visitante segue a regra vigente: o cursor dele sai sem posição; como destinatário, ele recebe o público e o que o atlas empresta. Guarda: `backend/tests/ws/presenca-escopo-recortado.repro.test.js`.

## O visualizador aberto: a lista diz em qual modelo, cena ou foto o colega está (2026-09-22)

Pedido do dono: a lista de quem está online dizia no máximo o MAPA, e com o 3D, a cena caminhável e o 360 abertos por cima do mapa isso não dizia onde a pessoa estava. O quadro `viewer_context` carrega a superfície (`3d`, `fp`, `360`, ou `2d` quando os visualizadores fecham) e o IDENTIFICADOR do recurso (`tilesetId` do modelo ou da cena, `photoName` da foto), e a linha da lista escreve "no 3D: Museu", "na cena 3D: Galeria" ou "no 360°: Quartel, foto IMG_7" (`viewerLabel`, `frontend/src/js/presence/viewer-label.js`). A ponte o manda nos eventos de ciclo de vida que os três visualizadores já emitiam, sem tocar em nenhum deles, com a cena por cima do 360 e o 360 por cima do 3D, e o repete a cada socket novo, porque o servidor nasce sem contexto.

**O nome é resolvido NO SERVIDOR e entregue POR DESTINATÁRIO, e essa é a decisão inteira.** Uma sala não é uma plateia: cada membro enxerga uma parte diferente do catálogo (concessão própria, papel global, o empréstimo do atlas), e um colega que abre um modelo privado a que tem concessão publicaria o nome dele à sala toda se ele viajasse junto. Então o remetente manda só o identificador; `collab.viewer.js` (`backend/src/modules/collab/`, com a regra e os memos em `collab.recorte.js`, compartilhados com o cursor e a seleção) busca nome e nível no catálogo e pergunta a `fn_can_see_resource`, no escopo do atlas da sala (o empréstimo conta), quem pode lê-lo. Público vai inteiro a todos numa serialização só; privado vai com nome a quem enxerga e com `recurso: null` ao resto, que lê "no visualizador 3D" e nunca vê o id. O retrato de entrada (`getRoomUsers`) é o mesmo para todo recém-chegado e é montado sem ir ao banco, então ele leva só a projeção que todos podem ler, e o privado chega a quem pode lê-lo num quadro à parte, depois da mesma pergunta (`enviarContextosAoRecemChegado`). Alternativa recusada: resolver o nome no cliente a partir do catálogo de quem lê. Ela esconde o nome da TELA de quem não enxerga o recurso, mas deixa o id privado no fio, que é o que a cláusula de acesso proíbe.

Três coisas que se leem errado:

- **O remetente não é gateado.** Quem manda um id que não pode ver não recebe nada de volta (o quadro vai aos outros), e os outros recebem o que o predicado DELES permite. Um id que não resolve viaja como superfície sem recurso.
- **A resposta tem memo de 30 s por (pessoa, atlas, recurso)**, o mesmo teto do memo de autorização dos assets, porque caminhar num projeto 360 troca de foto a cada poucos segundos. Quem perde o acesso continua lendo aquele nome por até 30 s, que é a latência que a cláusula 10.3 da constituição já aceita.
- **O visitante de link público não é acompanhado**, pela mesma decisão que prendeu o cursor dele: o contexto dele não viaja nem fica retido (o servidor o descarta, e a ponte nem manda). Como destinatário ele é julgado com principal nulo, então lê o público e o que o atlas empresta.

Guardas: `backend/tests/ws/presenca-contexto-do-visualizador.test.js` (os pares negativo e positivo por destinatário, o empréstimo, o retrato e o complemento, o 360, o visitante), `frontend/tests/integration/presence-store.test.js` e `frontend/tests/integration/presence-bridge.test.js` (caso V). Os censos do servidor classificam o quadro novo, os dois envios por destinatário e as duas consultas de resolução.

## Saída: quem sai não volta à lista (2026-09-22)

Relato do dono: "ainda diz que tem usuário presente mesmo que depois de sair". A lista do mapa tinha QUATRO elos, cada um com conserto próprio:

- **O cursor que chega depois do `user_left`** (o fantasma permanente): ver [[canal-collab-websocket]] §"O cursor sai em LOTE". O servidor descarta o quadro pendente de quem sai, e o armazém recusa por 30 s quadro de percepção (cursor, seleção, mapa, briefing, visualizador) de chave que acabou de sair, a lápide de `userLeft`, que some no `user_joined` de quem recarrega e no retrato novo. A criação de entrada por quadro de chave DESCONHECIDA continua, e é deliberado: só a chave que SAIU é recusada.
- **As cenas 3D e 360 só repintam nos eventos de cursor e de seleção**, nunca em `PRESENCE_CHANGED`, então a saída deixava o ponteiro do colega pendurado dentro do modelo ou do panorama até outra pessoa se mexer. `userLeft`, `clear` e `setInitial` emitem também os eventos das superfícies que perderam alguém.
- **O socket zumbi de quem reconectou** anunciava `user_away` de quem estava online: ver [[canal-collab-websocket]] §"away vs saída".
- **A conexão PRÓPRIA que cai congelava a lista**: sem socket nada a corrige, e com a reconexão falhando (token vencido num notebook que dormiu, servidor fora) quem saiu nesse meio-tempo ficava listado indefinidamente. A ponte esvazia a lista quando a própria conexão sai de ONLINE, e o `connected` seguinte a repovoa a partir da sala do servidor.

O que NÃO mudou, de propósito: a queda de rede de um colega continua virando `away` por `WS_AWAY_GRACE_MS` antes de sair, e a aba em segundo plano continua presente (o pong de protocolo, §"Away vs saída" abaixo). A contagem do painel do administrador é outra superfície, com o próprio conserto, em [[presenca-administrativa]].

## Seleção: a única presença com gate de papel

O cursor é ungated de propósito (decisão de produto anotada no cabeçalho de `handleCursor`, `backend/src/modules/collab/collab.handlers.js`). Seleção é editor-gated **dos dois lados**: cliente (`canBroadcastSelection`, `frontend/src/js/presence/presence-bridge.js`) e servidor (`handleSelection`, `backend/src/modules/collab/collab.handlers.js`). O cliente evita tráfego inútil; o servidor é a autoridade, para cliente adulterado não furar o gate. Comentarista e Visualizador recebem seleções mas nunca transmitem. Ver [[permissoes-atlas]] e [[sintese-capacidades-por-papel]]. Como o gate mapeia para a capacidade EDIT, é permissivo no store local e restritivo só em atlas remoto conectado.

**Não replique este gate de presença como gate de escrita.** Esta linha mandava conferir `permission !== 'read'` para autorizar escrita, o que era exato até `1d23ac9` (2026-07-19) e deixou de ser quando o nível `comment` chegou ao servidor: escrita é decidida por `assertOperationAllowed` (`backend/src/modules/sync/sync.service.js`), onde o Comentarista só pode escrever `target: 'comment'`. Presença e escrita têm gates com formatos diferentes de propósito, e o de escrita é hierárquico. Detalhe e consequência em [[canal-collab-websocket]].

Detalhes que evitam bug:

- O escopo por superfície (`mapId`/`tilesetId`/`photoName`) não é decoração: sem ele a seleção dentro de um modelo 3D vazaria para outro modelo ([[resources-catalogo]], [[streetview-360]]).
- **A geometria nunca trafega.** O overlay resolve os ids na fonte **local** e reconstrói a caixa com o mesmo `createSelectionBox` do highlight local. Só funciona porque o atlas é compartilhado; um par que ainda não recebeu a operação de criação não desenha nada.
- **O "acompanha o arraste" não vem de presença.** A caixa segue porque o overlay re-renderiza em `LAYERS_CHANGED`, ou seja, quando a **operação** de movimento do par altera a geometria local. Presença mostra *quem*; [[envelope-operacao]] traz o *quê*. Arraste travado é suspeita de fluxo de operações, não de presença.
- `featureMeta` viaja junto porque os ids sozinhos não carregam o tipo de ferramenta, e o peer precisa montar o destaque sem consultar o store.
- **A linha do tempo não é consciência.** Existiu aqui um rótulo já formatado ("D+3") que viajava por um quadro próprio, com coalescência obrigatória porque o evento de cursor da régua dispara por rAF. Ele saiu em 2026-09-21 (ver o topo desta página). Não reponha o envio "porque o barramento já tem o evento": o evento continua existindo para o 3D, o 360 e a derivação de símbolo ([[modulo-temporal]]); o que saiu foi a ponte entre ele e a rede.

## Away vs saída: a graça depende de um id que pode ser gerado em silêncio

O discriminador é o close code, com override: `code === 1006 && ws.intentionalLeave !== true` (`onClose`, `backend/src/modules/collab/collab.gateway.js`). O `intentionalLeave` existe porque um `leave` pode ser seguido de um `1006` real (o cliente derruba o socket antes do close frame chegar): **a intenção declarada vence o código de fechamento**.

No caminho away, `onClose` **mantém o socket morto dentro da sala** (não chama `leaveRoom`), e é isso que faz o usuário continuar aparecendo com `status: 'away'`. O timer de remoção vive em `awayTimers`, chaveado por `` `${atlasId}::${userId}::${clientId}` `` (`backend/src/modules/collab/collab.gateway.js`, função `awayKey`). Na volta, `onConnection` cancela o timer e faz `leaveRoom` do socket morto **antes** de tudo; sem isso a sala teria os dois e a presença duplicaria.

**O `userId` entrou na chave em 2026-07-25**, e a razão é a mesma que faz o `clientId` ser insuficiente na guarda de `user_left`: ele identifica um perfil de navegador, não uma pessoa. Chaveado só por `` `${atlasId}::${clientId}` ``, o slot suspenso do primeiro usuário era **herdado** pelo segundo que abrisse socket no mesmo perfil dentro da graça. O socket novo cancelava a remoção do primeiro, tirava o socket morto dele da sala sem anunciar `user_left` (então nada mais anunciaria: o timer já não existia) e emitia `user_back` com o id de quem nunca esteve ausente. Hoje o slot pertence ao par `(userId, clientId)`; quando outro usuário toma o `clientId`, o slot antigo é **encerrado na hora**, com o `user_left` que os pares esperam. Regressão em `backend/tests/ws/collab-away-slot-identity.repro.test.js`.

**Por isso o `clientId` estável é obrigatório aqui.** O servidor gera `crypto.randomUUID()` quando o `clientId` falta ou é malformado: a conexão funciona e a continuidade de presença morre **em silêncio**, no pior formato possível (o fantasma away fica os 2 minutos *e* o socket novo entra como segunda sessão). Detalhes do id em [[client-id-estavel]], mesmo id que serve à [[ack-idempotencia]].

Duas consequências não óbvias do heartbeat: como ele derruba com `terminate()` (que produz 1006), heartbeat gera **away, não left**. E o mesmo tick re-reconcilia a autorização contra o banco, então um downgrade de compartilhamento tem staleness limitado a um heartbeat ([[compartilhamento-atlas]]).

**A aba em segundo plano NÃO entra mais em away a cada ciclo, e esta linha prometia o contrário até 2026-08-28.** Ela entrava, e de forma determinística: o navegador estrangula o temporizador da página para um ping por minuto contra uma varredura de 30 s, e numa sala de 200 cada volta de aba esquecida virava rotatividade de presença para as outras 199. A vivacidade passou a ser provada por qualquer frame que chega e pelo ping do PROTOCOLO, que a pilha de rede do navegador responde sozinha. Detalhe e a medição em [[canal-collab-websocket]] §"Vivacidade". Esta linha registrava como pendência que a **remoção total** de um membro conectado não o desconectava, e isso nunca foi verdade nesta árvore: `reconcileAuthorization` já fechava com `4003` o socket cuja permissão resolve para nada quando a página foi escrita (`backend/src/modules/collab/collab.gateway.js`, presente desde `e30622c`). Como `4003` é close limpo, o par some na hora, sem passar pela graça `away`. Em atlas público a resolução cai para `read` e o socket é apenas rebaixado.

Voltar da graça restaura a **presença, não os dados**: não há replay de frames perdidos nem de operações. O cliente precisa mandar `sync_request` com o `lastVersion` e reenviar a fila offline ([[snapshot-e-pull-incremental]], [[idempotencia-e-convergence-guard]]).

## Teardown: `wsClient.on()` guarda um handler por evento

`stopPresence()` desregistra sobrescrevendo os seis eventos WS com no-ops, porque `wsClient.on()` **substitui** o handler em vez de acumular. O corolário atinge quem nunca leu presença: **dois assinantes do mesmo evento WS não coexistem**: registrar outro handler para `'cursor'` derruba o da presença sem aviso. Todo `on()` novo no bridge precisa do par em `stopPresence()`.

Não existe chamada de `stopPresence` fora do módulo: o bridge vive enquanto o mapa vive. Quem limpa o roster no logout é `frontend/src/js/account/account.control.js` com `presenceStore.clear()`, depois de `logoutAndDisconnect()` ([[sessao-boot-e-ciclo-de-vida]]).

Regra dura complementar: **overlays nunca mutam presença**, só leem e reconciliam. E o store guarda a figura completa, inclusive você; quem exclui self é a UI.

## O que não existe

**O cursor remoto não tem timer de inatividade.** O overlay não esconde nada por tempo: o marcador some quando o peer sai da sala, troca de mapa ou some do store. É a expectativa que mais volta, porque quase todo produto de colaboração desvanece o cursor parado, e aqui a ausência é o desenho.

Também não existem, por design: replay de frames de presença perdidos, lock a partir do indicador de briefing, e escala multi-instância.

**A presença NÃO TEM TABELA, e a ausência é decisão registrada (2026-08-23).** Esta seção descreveu, até 2026-07-25, uma `active_sessions` write-only, escrita a cada connect e apagada a cada disconnect. Os dois escritores saíram naquela data porque nenhum `SELECT` jamais existiu em `backend/src`: a escrita não comprava nada e ainda PARECIA um rastro durável de sessão, sendo incapaz de ser um (chamadas fire-and-forget que podiam commitar fora de ordem, nenhum reaper, e todo restart orfanando as linhas vivas em silêncio). A tabela ficou mais um ano por um argumento que deixou de valer, "migração é forward-only e aditiva", e a consolidação em baselines o suspendeu: num schema escrito no estado final, CRIAR a tabela é que passou a ser o ato deliberado. Ela saiu da `004_sync.sql`, que agora explica a ausência no lugar em que ela morava.

**Desde 2026-09-22 existe uma LEITURA, e ela não é sessão:** o contexto de visualizador pergunta ao catálogo o nome do modelo ou do projeto 360 aberto e pergunta a `fn_can_see_resource` quem pode lê-lo (§"O visualizador aberto" acima). As duas são SELECT; a presença continua sem escrever nada.

**Como isso é verificado hoje**, sem depender de tabela nenhuma: `backend/tests/ws/collab-presenca-sem-banco.test.js` instala um contador sobre o pool e exige que um ciclo de socket (connect, close limpo, queda anormal, e a corrida connect→close) não emita nenhum `INSERT`, `UPDATE` ou `DELETE`. Ele tem caso de discriminação, porque uma lista vazia de escritas passa verde tanto quando ninguém escreve quanto quando o contador cegou.

**Se a presença durável voltar**, ela começa pelo LEITOR, nunca pelo INSERT, e vem com reaper e heartbeat no mesmo commit. Hoje ela não resolveria problema: o deploy é de uma instância só ([[deploy-backend]]), e "quem está online" se responde lendo o `Map` da sala.

Não construa "quem está online" a partir dela: a verdade é, e sempre foi, o `Map` em memória de `backend/src/modules/collab/collab.rooms.js`. O mesmo vale para as colunas de presença (`cursor_position`, `current_map_id`, `selected_features`) e para o índice `idx_sessions_heartbeat`, que nunca tiveram escritor de verdade. Ressuscitar isso começa pelo **leitor**, não pelo INSERT: coluna viva pela metade engana mais que coluna ausente. Ver [[canal-collab-websocket]] e [[link-publico]].

Existe classificação adaptativa de qualidade (`backend/src/modules/collab/collab.quality.js`) e o cliente reemite a resposta como `adaptiveSettings` (`frontend/src/js/store/sync/ws-client.js`), mas **nenhum módulo do frontend assina esse evento hoje**: o gancho existe, o consumidor não ([[qualidade-conexao-adaptativa]]).

## O segundo leitor das salas: o cartão de projeto

Desde 2026-08-16 o `Map` em memória tem um consumidor fora do WebSocket. `GET /atlas/presence` (`backend/src/modules/atlas/atlas.service.js`) lê `getRoomUsers` para dizer quantas pessoas estão dentro de cada projeto na tela "Seus atlas", e ela **pergunta de novo a cada 20 s** em vez de assinar coisa alguma, porque o socket é por atlas: presença ao vivo numa grade de vinte projetos seria vinte conexões abertas por uma página que não entrou em nenhum deles.

Duas diferenças em relação ao roster do mapa, e as duas são de propósito. O cartão **deduplica por pessoa**, enquanto o roster é por aba: aqui a chave por `clientId` que o resto desta página defende produziria "2 no mapa" para alguém com duas abas, que é um número verdadeiro respondendo à pergunta errada. E `away` conta como presente, porque a carência existe justamente para o par que caiu e vai voltar. O limite de instância única desta seção seguinte vale igual: dois processos, dois `Map`, e o cartão reporta só a metade que atendeu o pedido. Ver [[api-rest-atlas]].

## Limite operacional: uma instância

Quantas pessoas cabem nessa instância está medido em [[capacidade-de-uma-instancia]], e o resumo é que o eixo que quebra é o TAMANHO DA SALA, não a quantidade de gente: duzentas pessoas numa sala é o limite operacional de hoje, e dois mil sockets em salas pequenas nem encontraram teto.

Salas, presença e `awayTimers` são `Map` em memória por processo, sem Redis nem pub/sub. Com duas réplicas, `broadcastToRoom` alcança só os clientes daquela instância e a presença fica partida; sem sticky session, um socket reconectado pode cair em outra instância que não conhece o timer, e o peer some depois de 2 min pela instância antiga e aparece duplicado pela nova. Caminho de menor risco: **uma instância, escala vertical**; alternativa é sticky sessions mais backplane. O WS vive no mesmo processo HTTP, então não dá para escalar WS separado. No NGINX, sem `proxy_http_version 1.1` mais `Upgrade`/`Connection "upgrade"` e sem rotear exatamente `/api/v1/collab`, a presença simplesmente não existe. Ver [[deploy-backend]] e [[sintese-limites-collab]].

## Depuração

Presença não gera span nenhum. `TraceStage.PRESENCE` existe só na declaração (`frontend/src/js/store/sync/diag/trace-stages.js`), sem um único emissor: o tap de barramento do [[syncledger]] grava apenas `RENDER_SOURCE` e `REMOTE_APPLIED` (`frontend/src/js/store/sync/diag/bus-tap.js`). Esperar por essa etapa num teste trava até o timeout. Para "o peer não aparece", cheque nesta ordem: socket conectado ([[canal-collab-websocket]]), snapshot `connected` recebido, **chave resolvida** (o bug do `user_joined` com descritor aninhado, que fazia `resolveKey` não achar identidade e descartar o join em silêncio) e só então a UI. Ao adicionar um frame novo, decida onde fica o descritor e teste o roteamento.

Nunca use presença como fonte de verdade: ela é descartável por construção, e quem move estado real é [[aplicacao-operacoes-remotas]].
