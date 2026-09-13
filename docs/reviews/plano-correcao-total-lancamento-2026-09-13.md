# Plano de correção total para lançamento

Data: 2026-09-13. Base: `8309b289`, branch `integracao_backend`, árvore limpa. Status: plano, sem uma linha de código aplicada. Ele sucede o [handoff](../../handoff.md) de 2026-09-12 e os [dez documentos de fechamento](fechamento/README.md), sem substituí-los: cada bloco abaixo aponta para o documento de fechamento que ele executa e acrescenta o que a auditoria de 2026-09-13 encontrou fora deles.

**O candidato continua sem liberação.** A auditoria reproduziu a suíte do handoff e confirmou os oito commits de 2026-09-12 contra o Git; o que ela acrescentou são vinte e seis achados que nenhum dos dez documentos conhece, e dois deles (F1 e F8) apagam ou ressuscitam dado no servidor por gesto comum da interface.

## 1. O que foi verificado antes deste plano

A suíte completa da raiz, o lint e a leitura dos oito commits de código foram refeitos em 2026-09-13 sobre o HEAD acima.

| verificação | resultado |
| --- | --- |
| `npm run lint` na raiz | código 0 |
| `npm test` na raiz | código 0 |
| frontend (vitest) | 12.247 de 12.247 casos, 642 arquivos |
| backend (c8) | 5.054 de 5.054 casos, statements 98,27% |
| contratos e2e | 201 de 201 casos, 57 arquivos |

Os números reproduzem o checkpoint de catálogo registrado em [execução do fechamento](execucao-fechamento-lancamento.md). Cada afirmação de código dos documentos de correção foi confrontada com o HEAD; nenhum arquivo citado deixou de existir e nenhum commit contradisse o documento que o descreve. O que segue são os buracos que a suíte verde não cobre.

Fora do escopo verificado: nenhum spec Playwright foi executado, `npm audit` não foi consultado, e a rede interna e o servidor de produção seguem inalcançáveis (origem já em HTTPS, segundo o dono).

## 2. Catálogo de achados

Cada achado tem um código que os blocos da seção 3 citam. Severidade: **S1** apaga ou corrompe dado sem aviso; **S2** perde trabalho ou engana o usuário sobre o estado; **S3** documentação ou instrumento que engana quem retoma; **S4** higiene.

| código | severidade | achado | evidência |
| --- | --- | --- | --- |
| F1 | S1 | Limpar a posição salva de um mapa em atlas remoto faz o servidor gravar `deleted_at` no mapa inteiro. O cliente emite `mapPosition` DELETE com o id do mapa; o ramo de exclusão do servidor ignora o subtipo e cai em `buildSoftDeleteQuery` para o alvo `map`. Editor recebe recusa de "excluir mapa", o que congela a fila. | Sondado por teste temporário de backend em 2026-09-13: resposta `applied`, linha do mapa com `deleted_at`, snapshot seguinte sem mapas. `frontend/src/js/store/map.operations.js` (`clearMapPosition`), `backend/src/modules/sync/sync.service.js` (caso delete de `applyOperation`). |
| F2 | S3 | A transição de schema documentada cobre uma coluna; a baseline `backend/src/database/migrations/004_sync.sql` ganhou quatro objetos depois da consolidação (duas colunas e duas tabelas), e o migrador rastreia por nome sem checksum, pulando baseline já aplicada. Como a linha de integração nunca foi implantada (confirmado pelo dono em 2026-09-13), não há banco de produção a migrar: o risco é só de banco de desenvolvimento antigo, que se recria, e de prosa que manda fazer uma transição que não basta. | `git diff fa0f0218 HEAD -- backend/src/database/migrations/`; `backend/src/database/migrate.js`; o SQL em [execução do fechamento](execucao-fechamento-lancamento.md) é o único no repositório. |
| F3 | S2 | A fila em quarentena de protocolo antigo é apagada pelo logout confirmado, porque a fila é por atlas e o descarte destrói o namespace. `count()` conta a quarentena como pendente, e `getIssues` não tem consumidor de interface. | `frontend/src/js/store/sync/legacy-queue.js`, `frontend/src/js/store/sync/operation-queue.js`, `frontend/src/js/store/remote-atlas.api.js`. |
| F4 | S2 | Uma op recusada pelo servidor vira problema durável que bloqueia a entidade, some da projeção no próximo resync e nunca reaparece; `hasWorkToFlush` a conta como trabalho, então o flush roda a cada 1,5 s para sempre com `pushed: 0` e telemetria de sucesso. | `frontend/src/js/store/sync/sync-flush.js`, `frontend/src/js/store/sync/operation-queue.js`. |
| F5 | S2 | Não há pausa entre abas no logout: o coordenador de escrita é um `WeakMap` de módulo. O fence de época em `localStorage` barra a escrita da irmã depois do descarte, então o risco é de contagem otimista no diálogo, não de corrupção. Porém o descarte confirmado chama `destroyRemoteAtlas` direto, pulando a poupança por lock de montagem, e nada confirma que a irmã congelou antes da destruição. | `frontend/src/js/store/write-coordinator.js`, `frontend/src/js/session/confirm-logout.js`, `frontend/src/js/store/remote-atlas.api.js` (`purgeOneRemoteAtlas`). |
| F6 | S2 | Upload de imagem sem fila de retry no cliente e sem idempotência no servidor: retry na rota única duplica linha e arquivo; retry na rota bulk colide na chave primária e devolve `failed` para um upload já aceito; dois chamadores caem para id local e um comentário promete reconciliação que não existe. | `frontend/src/js/store/sync/image-sync.js`, `frontend/src/js/store/customIcons.operations.js`, `backend/src/modules/images/images.service.js`. |
| F7 | S2 | Depois de logout e novo login, o escopo remoto fica montado com o logging desligado durante a negociação e o pull; uma edição nessa janela persiste a entidade e `persistOperationIntents` devolve `undefined` sem sinal. O filtro de id não UUID descarta do mesmo modo. `disconnect` não desliga o logging. | `frontend/src/js/store/sync/operation-dispatcher.js`, `frontend/src/js/store/sync/sync-engine.js`. |
| F8 | S1 | Só feição tem base e revisão (gate literal por alvo). A forma array de `catalog_layer` faz `deleted_at = NULL` incondicional no upsert; `cesium3d` e `streetview360` não têm guarda de túmulo; o update de `map` não filtra `deleted_at`. | `backend/src/modules/sync/sync.service.js`, `backend/src/modules/sync/feature-conflicts.js`. |
| F9 | S2 | Nenhum comando composto do cliente é atômico e o servidor não sabe que existe um comando: `batchId` e `dependsOn` não têm leitor no backend, cada op roda em savepoint próprio (aplicação parcial com resposta 200 é o desfecho normal), e `FLUSH_BATCH_SIZE` de 25 parte um comando entre transações. | `backend/src/modules/sync/sync.service.js` (`pushOperations`), `frontend/src/js/store/sync/sync-engine.js`. |
| F10 | S2 | As quatro exceções REST (merge, import, duplicação, clone) não passam pelo protocolo, não geram recibo e, desde a camada padrão no servidor, criam entidade sincronizável fora do log; a duplicação não deixa marcador em `operations`, então o par offline nunca converge até um snapshot completo. | `backend/src/modules/atlas/atlas.service.js`, `backend/src/modules/maps/maps.service.js`. |
| F11 | S2 | Cada conexão faz pull do zero e cunha uma geração nova de nove bancos; `known` só cresce e nada poda antes do logout. O cursor durável é escrito e quase não é lido. Uma geração preparada que falhou por quota fica em disco e realimenta a próxima falha. | `frontend/src/js/store/sync/remote-operation-handler.js` (`applyRemoteSnapshot`), `frontend/src/js/store/namespace-generation.js`, `frontend/src/js/store/atlas-namespace.js`. |
| F12 | S2 | Ponteiro de geração e época de descarte moram em `localStorage`; o dado mora em IndexedDB. Limpar só o primeiro torna o acervo inalcançável e reabre para escrita um namespace descartado. Sem `localStorage`, o fence degrada aberto. As chaves de época nunca são apagadas. | `frontend/src/js/store/namespace-generation.js`, `frontend/src/js/store/remote-write-fence.js`. |
| F13 | S2 | `entityType` desconhecido no cliente devolve `false` e isso fecha o socket; `map_meta` e `atlas_meta` são alvos que o servidor aceita e rebroadcasta sem ramo no cliente. Um servidor mais novo põe o cliente em laço fechar e reconectar. | `frontend/src/js/store/sync/remote-operation-handler.js` (`applyRemoteOperationInner`), `frontend/src/js/store/sync/ws-client.js`. |
| F14 | S2 | O indicador de sincronização lê três sinais (origem, conexão, contagem da fila) e fica verde com fila zero e conexão, ignorando conflito, recusa, upload pendente e replay em curso. | `frontend/src/js/account/sync-phrases.js` (`SYNC_WORK_STATE`), `frontend/src/js/account/sync-status.control.js`. |
| F15 | S2 | Quatro operações de 3D e 360 carimbam a op com o mapa corrente em vez do mapa alvo; com nome de mapa explícito a op vai para o mapa errado. `clearMapPosition` não tem gate de permissão e consulta a trava do mapa corrente enquanto aceita outro mapa. | `frontend/src/js/store/cesium3d.operations.js`, `frontend/src/js/store/streetview360.operations.js`, `frontend/src/js/store/map.operations.js`. |
| F16 | S2 | Metadados do diário nunca são podados (chaves de id, estado, problema e ponteiro por feição sobrevivem ao dequeue), e reenfileirar um id já confirmado é ignorado em silêncio. | `frontend/src/js/store/sync/queue-journal.js`, `frontend/src/js/store/sync/operation-queue.js`. |
| F17 | S2 | O portão de migração legada roda só no mapa e no seletor de atlas; `admin.html` e `calibracao.html` chamam `purgeAllRemoteAtlases` sem classificar a origem. Destinos abandonados da transição e atlas de recuperação ficam em disco sem tela que os liste. | `frontend/src/js/ui/migration-recovery.js`, `frontend/src/js/store/migration/legacy-transition.js`, `frontend/src/js/admin/admin-page.js`. |
| F18 | S2 | O autosave do editor de briefing segura a edição 1,5 s em memória antes de chamar a store; a janela de perda saiu da gravação e foi para o debounce. Camadas seguem memória, disco 300 ms depois e log sem espera. | `frontend/src/js/briefing/editor/briefing-editor.control.js`, `frontend/src/js/layers/layer.manager.js`. |
| F19 | S3 | `.claude/rules/architecture.md` descreve a compactação da fila com marca d'água e símbolos que o commit `f8e109ea` apagou; o guarda citado hoje afirma o contrário. `.claude/rules/common-tasks.md` cita schema 2.3 e um degrau de migração que não existe; a versão é 3.0. Os dois arquivos são carregados como instrução em toda sessão. | `frontend/src/js/store/sync/operation-queue.js`, `frontend/src/js/store/atlas/atlas.entity.js` (`ATLAS_SCHEMA_VERSION`). |
| F20 | S3 | Cinco documentos repetem a transição aditiva incompleta de F2. `backend/src/database/migrations/README.md` diz 11 bases e há 12; a décima segunda não passou pela equivalência de catálogos. `docs/wiki/deploy-backend.md` cita `node:20` e o Dockerfile usa `node:22`. | `backend/Dockerfile`, `backend/src/database/migrations/012_camadas_remotas.sql`. |
| F21 | S3 | Quatro dos oito commits têm corpo de mensagem vazio; para os documentos 03, 05, 08 e 09 das correções todo número vive só em prosa. "Nove execuções em três repetições" não se lê nos specs nomeados, que têm um caso cada. | `git log --format=%b` sobre `fa0f0218`, `e70ccf3c`, `d2f6c516`, `d0c99dea`. |
| F22 | S3 | O inventário de dependências cobre seis vendors e deixa fora `frontend/src/vendor/three/` inteiro (snapshot de desenvolvimento) e um segundo WASM do GDAL; milsymbol declara 3.0.3 no banner e 3.0.2 no objeto; a imagem Docker não tem digest. | [inventário](dependencias-lancamento-inventario.json). |
| F23 | S3 | A sonda de disponibilidade não está agendada e não alimenta o painel; o leitor de pendências de presença só é instalado em duas das quatro páginas, então o próprio painel do administrador se conta como "verificação indisponível". | `backend/scripts/sonda-disponibilidade.js`, `frontend/src/js/session/pendencias-monitoramento.js`. |
| F24 | S3 | Comentário grande em `backend/src/modules/sync/sync.service.js` descreve o move de feição como LWW por chegada e cita compactação de fila; três afirmações falsas desde `e70ccf3c`. Código morto no ramo da op envenenada de `frontend/src/js/store/sync/sync-engine.js`. | leitura do HEAD. |
| F25 | S4 | Doze sítios passam literal em vez de `EntityType` ou `OperationType` a `recordOperation` e ao log de trava; nenhuma regra de lint os pega. O id de sessão deixou de sobreviver ao F5 sem que a mudança de semântica esteja declarada. | `frontend/src/js/store/settings.operations.js`, `frontend/src/js/store/feature.operations.js`, `frontend/src/js/session/sessao-id.js`. |
| F26 | S4 | O cenário de dados externos e o de segurança de atlas só rodam por configs dedicadas sem script npm; ler `test:e2e:ui` verde como cobertura da migração é leitura errada. | `frontend/playwright.migration-data.config.js`, `frontend/playwright.atlas-safety.config.js`. |

## 3. Blocos de trabalho

A ordem abaixo é a ordem de execução. Ela difere da ordem do handoff em um ponto: três blocos curtos vêm antes do documento 02 de persistência, porque tornar durável uma op que hoje apaga o mapa seria tornar a perda garantida.

Cada bloco fecha com: lint e teste completos da raiz em comandos separados, rodados depois da última escrita; controle negativo com a fonte restaurada; documento de fechamento correspondente atualizado no mesmo commit, com commit, testes e limites; e, quando a interface muda, captura Playwright inspecionada. As estimativas são dias de trabalho de uma pessoa e valem como ordem de grandeza, não como prazo.

### B0. Instruções e documentos que enganam quem retoma

Fecha F19, F20, F24, F25 e a parte documental de F21. Estimativa: 1 dia. Sem dependência.

1. Reescrever em `.claude/rules/architecture.md` o parágrafo da fila: a fila é diário append-only sem compactação, expiração ou purga desde `f8e109ea`; chave sequencial; marcas de preparo; bloqueio por problema. Apagar as citações aos símbolos mortos e à medição dos 12000 creates, ou movê-la para `docs/decisions/decisions-2026.md` como histórico.
2. Corrigir em `.claude/rules/common-tasks.md` a lista de degraus de migração e a versão de schema (3.0, degrau `frontend/src/js/store/migration/v2.x-to-v3.0.migration.js`).
3. Retirar a transição aditiva dos cinco documentos que a repetem e trocá-la pela regra de B2 (a primeira implantação é instalação nova; banco de desenvolvimento anterior à baseline se recria, sem transição): [handoff](../../handoff.md), [execução do fechamento](execucao-fechamento-lancamento.md), [índice de fechamento](fechamento/README.md), [liberação interna](fechamento/10-liberacao-interna.md), [catálogo](correcoes-2026-09-12/09-catalogo.md).
4. Corrigir `backend/src/database/migrations/README.md` (12 bases, e a nota de que a décima segunda é só dado e não entrou na equivalência) e `docs/wiki/deploy-backend.md` (imagem `node:22`, terceira consolidação em 2026-09-12).
5. Reescrever o comentário de move em `backend/src/modules/sync/sync.service.js` e remover o ramo morto de `frontend/src/js/store/sync/sync-engine.js`; atualizar o JSDoc e o título do caso de `frontend/tests/unit/sync-ack-por-operacao.test.js`, que descrevem o contrato antigo.
6. Trocar os doze literais por `EntityType` e `OperationType`, e acrescentar um censo estrutural que reprove literal nos argumentos de `recordOperation`, no molde de `frontend/tests/unit/permissao-de-atlas-censo.test.js`.
7. Reverter o id de sessão para `sessionStorage` e declarar o comportamento no cabeçalho de `frontend/src/js/session/sessao-id.js` (D5).

Aceite: `frontend/tests/unit/docs-integridade.test.js` verde sem isenção nova; o censo de literais reprova ao reintroduzir um; a rodada de `npm run diag -- resumo --json` continua lendo.

### B1. Op que apaga o mapa e ops com mapa errado

Fecha F1 e F15. Executa a parte "posição e mapa-base" de [persistência](fechamento/02-persistencia.md) na sua metade destrutiva. Estimativa: 1 a 2 dias. Depende de B0 só pelos literais.

1. Servidor primeiro: no caso delete de `applyOperation`, recusar por operação qualquer exclusão cujo alvo seja `map` com subtipo presente (posição, mapa-base, notas, grade, temporal), com motivo nomeado, em vez de cair em `buildSoftDeleteQuery`. Teste de backend que envia o envelope exato de `clearMapPosition` como Dono e afirma `deleted_at` nulo e resposta recusada; controle negativo restaurando o ramo antigo.
2. Cliente: trocar em `clearMapPosition` o DELETE por UPDATE com as cinco colunas de posição nulas, que é o conjunto de `MAP_SUBTYPE_FIELDS` para posição; remover a condição pelo id da posição, que deixava o caso legado sem op; acrescentar o gate de permissão que os dois irmãos têm; trocar a consulta síncrona de trava do mapa corrente pela assíncrona do mapa alvo nas três funções que aceitam nome de mapa.
3. Varredura: confirmar por grep que nenhum outro produtor emite DELETE de subtipo de mapa; o repro `frontend/tests/integration/temporal-config-stray-delete.repro.test.js` é da mesma família e serve de modelo.
4. 3D e 360: trocar `getCurrentMapId` por `getMapId` do mapa alvo nos quatro sítios de `frontend/src/js/store/cesium3d.operations.js` e `frontend/src/js/store/streetview360.operations.js`, com teste que passa nome de mapa que não é o corrente e afirma o `mapId` da op.
5. Contrato: caso em `frontend/tests/e2e` que salva posição, limpa, e afirma que o snapshot seguinte ainda traz o mapa.

Aceite: os dois lados no mesmo commit; a sonda descrita em F1 vira teste permanente; documento 02 atualizado com o achado e o commit.

### B2. Schema: baseline consolidada até a implantação, congelada depois

Fecha F2 e a metade de F20 que é de banco. Executa [liberação interna](fechamento/10-liberacao-interna.md) item 2. Estimativa: 1 dia. Sem dependência. Decisão D6 registrada abaixo.

1. Declarar em `backend/src/database/migrations/README.md` e em `docs/decisions/decisions-2026.md` que a baseline consolidada permanece editável enquanto a linha não for implantada, que a primeira implantação do backend é instalação nova, e que banco de desenvolvimento aplicado antes de uma edição de baseline se recria (o README já manda usar banco novo). Sem script de transição, porque não há banco a transitar.
2. Guarda de drift, ligado desde já: `backend/src/database/migrate.js` grava checksum do conteúdo de cada arquivo em `_migrations` na aplicação e recusa, com nome e hash, arquivo já aplicado cujo conteúdo mudou. Em desenvolvimento a recusa se resolve recriando o banco; depois da implantação ela é o congelamento de D6 em código. Teste em `backend/tests/integration/migrations-tracking-vs-disco.test.js`.
3. Congelamento: no commit que fixar o SHA candidato, registrar os doze hashes como referência e, a partir dali, toda mudança de schema entra por arquivo numerado novo.
4. Corrigir a contagem (12 bases) e a nota sobre `backend/src/database/migrations/012_camadas_remotas.sql`, que é só dado e, numa instalação nova, não tem linha para regularizar.

Aceite: editar uma baseline com banco já aplicado faz `migrate.js` recusar nomeando arquivo e hash; instalação nova a partir das doze bases sobe e aceita push v2 com recibo; controle negativo sem o checksum aceita a edição em silêncio.

### B3. Fila, quarentena e a janela do dispatcher

Fecha F3, F4, F7, F13, F16 e a parte de fila de F5. Executa [compatibilidade](fechamento/01-compatibilidade.md) itens 2 e 4 e prepara [conflitos](fechamento/03-conflitos.md) item 5. Estimativa: 3 a 4 dias. Depende de B0.

1. Contagem honesta: `count()` passa a devolver pendentes, problemas e preparadas em separado; `hasWorkToFlush` só considera pendentes enviáveis; a luz e o aviso de saída passam a receber os três números (o consumo na luz é do bloco B9).
2. Quarentena sobrevive ao logout: antes de `requestRemoteAtlasDiscard` destruir o namespace, exportar as ops com problema para um registro global por atlas (ou recusar o descarte enquanto houver problema sem decisão, conforme D2). Teste que confirma o logout com uma op em quarentena e afirma que ela continua legível depois.
3. Janela do dispatcher: `persistOperationIntents` com logging desligado em escopo remoto passa a emitir `STORE_OPERATION_BLOCKED` e a recusar a transação em vez de devolver `undefined`; o filtro de id não UUID volta a registrar `PREFLUSH_DROP`; `disconnect` desliga o logging como `logoutAndDisconnect` já faz.
4. Alvo desconhecido: `applyRemoteOperationInner` devolve um valor distinto de falha para tipo que o cliente não conhece, registra o fato e não fecha o socket; teste que injeta `map_meta` e afirma que a conexão continua e o cursor não avança por cima dele.
5. Poda do diário: `dequeue` apaga as chaves de id, estado e problema da op confirmada e mantém só o ponteiro por feição; reenfileirar id já confirmado deixa de ser silencioso (lança ou registra). Teste em `frontend/tests/integration/queue-journal-atomic.test.js`.
6. Tela mínima de pendências: uma lista, no controle de estado de sync, que consome `getIssues` e oferece exportar e descartar por decisão explícita; aceitar o servidor remove a tentativa. A conciliação visual de geometria fica para o bloco B5.

Aceite: com uma op recusada e nada mais na fila, o flush não roda em laço e a luz não fica verde; F5, outra aba e logout confirmado não apagam a pendência sem decisão; controle negativo restaurando `count()` antigo reprova.

### B4. Persistência write-ahead dos demais produtores

Fecha F18 e executa [persistência](fechamento/02-persistencia.md) inteiro. Estimativa: 6 a 9 dias. Depende de B1 e B3.

O padrão está pronto em `frontend/src/js/store/briefing.operations.js` e `frontend/src/js/store/catalog.operations.js`: trava do documento, leitura e preparo completos, `recordOperation` dentro de `runTransaction`, função de persistência devolvida e não chamada, marcas liberadas por `materializeJournal` numa transação. Os modelos de teste são `frontend/tests/integration/catalog-write-ahead.test.js` e `frontend/tests/integration/briefing-write-ahead.test.js`. Ordem, do menor risco e maior perda evitada para o maior:

1. Folhas já sob trava, no mesmo arquivo do catálogo: `setBaseLayer` e `updateMapPosition` (e `clearMapPosition`, já corrigida em B1).
2. 360 e 3D: a atualização de marcador 360 (que já loga com espera e usa o mapa alvo), depois orientação, marcador 3D e sua remoção, com o conserto de mapa de B1 já feito.
3. Grupos folha: propriedade de grupo e desagrupar.
4. Chaves de atlas: ordem de mapas, cores de badge e aparência do atlas, quase idênticas entre si; atenção ao `try/catch` que engole tudo na aparência.
5. Camadas: propriedade e criação, usando o precedente de `frontend/src/js/store/layer-transfer.operations.js`; a escrita passa a ser pelo repositório dentro da transação e não pelo `DebouncedPersist`; reordenação em seguida; camada ativa fica sem diário por ser estado de visão.
6. Criar grupo, com uma op de grupo antes das ops de membro na mesma transação; lotes de 3D e 360 por tileset e por foto; ícone customizado; renomear mapa.
7. Alto risco: excluir camada com a cascata de feições; remoção de feição de todos os grupos (que precisa receber a transação do pai em vez de abrir a sua); combinar grupos; criar e remover mapa, com os documentos auxiliares como efeitos.
8. Trava do mapa por último: o caminho vivo de `map` update sobrescreve o registro do mapa no par (defeito registrado em `.claude/rules/architecture.md` e ainda aberto), então tornar a op durável antes de consertar a aplicação entrega durabilidade a algo que o par aplica errado. Consertar os dois no mesmo bloco, com `frontend/tests/e2e-ui/browser-collab-lock.spec.js` passando pelo controlador e não pela op crua.
9. Debounce do editor de briefing: descarregar o autosave em fechamento de aba, perda de conexão e troca de atlas; o gesto de flush já existe no controle do editor.

Aceite por família: falhar antes e depois do diário, na gravação da entidade e na marca de materialização; reabrir e comparar conteúdo, referências e ids; concorrência na mesma entidade; troca de escopo durante await; nenhuma asserção de disco substituída por mock de logging. O censo de literais de B0 reprova qualquer função migrada que nasça com string solta.

### B5. Conflitos por entidade e resolução persistente

Fecha F8 e executa [conflitos](fechamento/03-conflitos.md). Estimativa: 6 a 9 dias. Depende de B3 e B4.

1. Fechar os quatro buracos de túmulo antes de qualquer revisão nova: cláusula `WHERE deleted_at IS NOT NULL` na forma array de `catalog_layer`; guarda de túmulo em `cesium3d` e `streetview360`; filtro de `deleted_at` no update de `map`. Um teste por entidade que exclui, reenvia create ou update antigo e afirma que a linha continua excluída.
2. Definir a unidade de disputa por entidade (campos independentes, geometria inteira, ordem, hierarquia, membros, slides, referências) e estender `prepareFeatureMutation` para uma função por alvo, com base observada, patch e fronteira por campo na mesma tabela; o gate literal por alvo desaparece.
3. Recibos já são universais; o que muda é o conteúdo: versão de entidade e operação canônica para toda entidade.
4. Cliente: `confirmedVersion` preservado nas demais entidades como já é na feição; conflito volta como estado distinto de recusa e de dependência bloqueada.
5. Painel de resolução sobre a tela mínima de B3: item, motivo, dependentes, conteúdo local, estado atual permitido; aceitar servidor, reaplicar como nova op com nova base, comparação visual de geometria.

Aceite: dois e três clientes editando campos distintos, o mesmo campo, geometria, ordem e membros; edição contra exclusão; nova edição remota durante resolução; permissão revogada; repetir após F5 e entre abas; controle negativo por entidade.

### B6. Comandos compostos e as quatro exceções REST

Fecha F9 e F10 e executa [comandos compostos](fechamento/04-comandos-compostos.md) e [compatibilidade](fechamento/01-compatibilidade.md) item 1. Estimativa: 5 a 7 dias. Depende de B4 e B5. Exige a decisão D4.

1. Servidor lê `batchId`: um lote lógico declarado pelo cliente aplica ou recusa inteiro, dentro de um savepoint por lote em vez de por op; `FLUSH_BATCH_SIZE` deixa de cortar dentro de um lote (o recorte respeita a fronteira do `batchId`, ou o lote viaja num push próprio).
2. Cliente: conversão de feição, transferência de camada e agrupar passam a emitir um único lote com o mesmo `batchId`, na ordem que o servidor exige (grupo antes de membro).
3. Undo e redo continuam como novos comandos contra o estado confirmado, que é o contrato já aprovado; acrescentar os testes de falha parcial que faltam (falhar no primeiro, no meio e no último; após commit antes do ack; repetir após F5).
4. Exceções REST: merge já deixa marcador; duplicação, clone e import passam a gravar um marcador em `operations` e a fazer broadcast das camadas que `ensureMapLayers` criou, para que o par offline convirja e a consulta de recibos tenha o que comprovar. Cada exceção ganha teste HTTP e de serviço.
5. Definir e medir limites de tamanho e tempo por lote; conjunto grande vai por preparação durável e ativação no fim, sem apresentar parcial como concluído.

Aceite: injetar falha no primeiro, intermediário e último elemento; nenhuma aplicação parcial acked como sucesso; par offline recebe mapa duplicado sem snapshot completo.

### B7. Abas, logout, gerações e migração da main

Fecha F5, F11, F12, F17 e executa [abas e recuperação](fechamento/05-abas-e-recuperacao.md). Estimativa: 4 a 6 dias. Depende de B3. Exige a decisão D3.

1. Barreira entre abas: substituir a pausa por aba por Web Lock de escopo remoto que toda escrita consulta (o freio de teardown já existe em `frontend/src/js/store/sync/tab-lock-sync-brake.js`); o diálogo de logout só conta depois de todas as abas ativas responderem ou do prazo estourar, e o prazo estourado continua sendo "quantidade desconhecida".
2. Descarte confirmado: `purgeOneRemoteAtlas` volta a passar pela poupança por lock de montagem, ou confirma o congelamento das irmãs pelo relatório de `announceTabLockTeardown` antes de chamar `destroyRemoteAtlas`. Teste de duas abas: uma edita durante o diálogo da outra.
3. Gerações: podar as gerações que não são a ativa depois de ativar a nova, com uma anterior de reserva; limpar a geração preparada que falhou; ler o cursor durável no boot em vez de puxar do zero a cada conexão. Teste de quota na ativação, que o aceite do documento 05 pede e não existe.
4. Ponteiro e época em IndexedDB global (ou espelhados nele, com o `localStorage` como cache): ausência de `localStorage` não pode degradar o fence para aberto; chaves de época e de geração apagadas junto com o namespace.
5. Portão de migração nas quatro páginas; as três sem mapa deixam de chamar `purgeAllRemoteAtlases` cru; tela que lista destinos abandonados e atlas de recuperação, com poda.
6. Origem: D1 está decidida (HTTPS mantido). Fica em B11 a medição de contexto seguro e de Web Locks na origem interna real.

Aceite: duas abas editam durante o diálogo; aba suspensa retorna após descarte e novo login; resposta antiga chega após troca; logout cancelado; quota impede ativação de snapshot; conteúdo dos atlas locais, do remoto anterior e do destino validado; corridas repetidas em série com taxa relatada.

### B8. Uploads duráveis

Fecha F6 e executa [uploads](fechamento/06-uploads.md). Estimativa: 3 a 5 dias. Depende de B3 e B7.

1. Servidor: chave de idempotência por tentativa e hash de conteúdo em imagens; retry com a mesma chave devolve o recurso existente com 200, nas duas rotas; a bulk deixa de devolver `failed` para colisão de chave primária com conteúdo igual.
2. Cliente: fila durável de blobs por atlas, registrada antes de anunciar retomada, com identidade estável de tentativa; os dois chamadores que caem para id local passam a registrar pendência; remover o comentário que promete reconciliação até ela existir.
3. Vincular a op ao recurso obrigatório: a op de feição de imagem só é enviável quando o blob tem recurso confirmado, pelo mesmo mecanismo de marca de preparo da fila.
4. Logout confirmado descarta pendências de upload do escopo sem excluir recursos confirmados.

Aceite: falhar antes e depois do blob local, no meio da transferência e após gravação remota sem resposta; reabrir e ver o mesmo recurso, sem duplicata, em outro cliente; quota, arquivo inválido, limite de tamanho, revogação e logout durante callback.

### B9. Indicadores e administração

Fecha F14 e F23 e executa [indicadores e administração](fechamento/07-indicadores-e-administracao.md). Estimativa: 2 a 3 dias. Depende de B3, B7 e B8.

1. `SYNC_WORK_STATE` ganha os estados que o documento 07 lista (recuperando, conflito, recusa, upload pendente) e o verde passa a exigir cursor aplicado, zero problemas e zero uploads pendentes; o replay já conectado deixa de ser verde durante a aplicação.
2. Reusar `configurarPendenciasDePresenca` no crachá do mapa em vez de um terceiro leitor; instalar o leitor nas quatro páginas.
3. Agendar a sonda de disponibilidade (script npm mais entrada no roteiro de instalação) e fazer o painel ler o JSONL dela, ou remover a sonda e declarar por quê.
4. Normalizar o payload de presença para camelCase e trocar a chamada ao método privado do cliente HTTP por método público.

Aceite: fila vazia com conflito ou upload mantém estado pendente; snapshot não aplicado não fica verde; duas abas, visitante, logout, expiração e perda de telemetria produzem contagens coerentes; captura Playwright inspecionada.

### B10. Segurança e dependências

Fecha F22 e executa [segurança](fechamento/08-seguranca.md). Estimativa: 2 a 3 dias. Inventário pode começar já; conclusão só sobre o candidato final.

1. Completar o inventário com `frontend/src/vendor/three/`, a árvore Cesium, o segundo WASM do GDAL e o Dockerfile com digest fixo; resolver a versão real de milsymbol pela fonte e pelo hash; registrar Turf e o wrapper do GDAL como sem versão determinável ou substituí-los por cópia com manifesto.
2. Consultar avisos oficiais datados sobre o SHA candidato; classificar por exposição real; nada de correção forçada.
3. Revisar autorização das quatro exceções REST depois de B6 (elas criam entidade fora do log), acesso a uploads, recibos e sockets após revogação.

Aceite: nenhuma vulnerabilidade crítica ou alta aplicável sem correção ou mitigação demonstrada; instalação limpa reproduzível; decisão e responsável para o risco restante.

### B11. Homologação final e migração da main

Executa [homologação e migração](fechamento/09-homologacao-e-migracao.md). Fecha F26 e a parte de evidência de F21. Depende de B1 a B10. Estimativa: 4 a 6 dias de ensaio.

1. Scripts npm para os dois cenários que só rodam por config dedicada (dados externos e segurança de atlas), com `EBGEO_MIGRATION_DATA_DIR` apontando para cópia; o runbook deixa de depender de invocação manual.
2. Matriz do documento 09 executada célula a célula, com SHAs, entrada, falha injetada, esperado e observado, log e captura; corridas em série com taxa; `retries: 0` onde a corrida é o sujeito.
3. Ensaio main para candidato na mesma origem completa, com os dados de `_ebgeo_dados_teste` em cópia, meses sem acesso simulados, aba antiga aberta, interrupção entre etapas. Antes dele, na origem interna real e em HTTPS, registrar `isSecureContext` e a presença de `navigator.locks` (D1).
4. Rodada final: lint e teste da raiz em comandos separados depois da última mudança de lógica, build antes das suítes que inspecionam `dist`, Playwright real com contagem de `flaky` lida antes de declarar verde.
5. Registrar cada resultado com corpo de commit (F21): números de suíte no commit, não só na prosa.

### B12. Liberação interna e retorno

Executa [liberação interna](fechamento/10-liberacao-interna.md). Depende de B11 e de responsável na rede interna.

1. Roteiro concreto: SHAs do conjunto compatível, artefatos, ordem frontend, backend e schema, pré-condições, duração medida no ensaio de B11, responsável; `deploy/deploy.sh` cobre só o symlink do web e continua fora de qualquer edição sem confirmação.
2. Instalação nova do backend a partir das doze baselines (não há banco anterior nesta linha); o congelamento de D6 passa a valer a partir desse SHA.
3. Backup e restauração ensaiados em ambiente separado, incluindo imagens e recursos 3D e 360.
4. Retorno definido antes de abrir escrita; piloto com amostra dimensionada pela matriz; interrupção por perda, duplicação, divergência ou acesso indevido.

## 4. Ordem, dependências e tamanho

| bloco | fecha | executa | depende de | estimativa (dias) |
| --- | --- | --- | --- | --- |
| B0 | F19, F20, F24, F25, F21 (doc) | higiene | nada | 1 |
| B1 | F1, F15 | 02 (metade destrutiva) | B0 | 1 a 2 |
| B2 | F2, F20 (banco) | 10 item 2 | nada | 1 |
| B3 | F3, F4, F7, F13, F16 | 01 itens 2 e 4; 03 item 5 | B0 | 3 a 4 |
| B4 | F18 | 02 inteiro | B1, B3 | 6 a 9 |
| B5 | F8 | 03 | B3, B4 | 6 a 9 |
| B6 | F9, F10 | 04; 01 item 1 | B4, B5, D4 | 5 a 7 |
| B7 | F5, F11, F12, F17 | 05 | B3, D3 | 4 a 6 |
| B8 | F6 | 06 | B3, B7 | 3 a 5 |
| B9 | F14, F23 | 07 | B3, B7, B8 | 2 a 3 |
| B10 | F22 | 08 | inventário já; fecho após B9 | 2 a 3 |
| B11 | F26, F21 (evidência) | 09 | B1 a B10 | 4 a 6 |
| B12 | | 10 | B11 e rede interna | fora do alcance local |

Soma das estimativas: 38 a 56 dias de uma pessoa, sem contar B12. B0, B1 e B2 são independentes entre si e cabem na primeira semana; B10 pode correr em paralelo desde o início até a parte de inventário.

## 5. Decisões do dono (todas tomadas em 2026-09-13)

- **D1. Origem da rede interna. DECIDIDA em 2026-09-13.** O dono informou que a produção já é servida em HTTPS e que protocolo e domínio se mantêm; logo a origem não muda, os bancos IndexedDB da main continuam visíveis ao candidato e a API de Web Locks existe. O que resta é medição, não decisão: em B11, na origem interna real, confirmar em uma linha de console que `isSecureContext` é verdadeiro e que `navigator.locks` existe, porque certificado interno inválido aceito à força pode negar o contexto seguro em algum navegador. Sem essa medição a migração da main não tem evidência na origem efetiva.
- **D2. Quarentena e logout. DECIDIDA em 2026-09-13: preservar.** Antes de destruir o namespace, a quarentena (ops de protocolo antigo ou recusadas) vai para um registro global por atlas, legível na tela de pendências de B3, e o aviso de saída passa a contar e nomear essas ops.
- **D3. Política de gerações. DECIDIDA em 2026-09-13: ativa mais uma anterior.** Poda idempotente na ativação da nova; geração preparada que falhou é apagada na hora.
- **D4. Modelo de atomicidade de comando composto. DECIDIDA em 2026-09-13: lote lógico por `batchId`.** O servidor aplica ou recusa o lote inteiro num único savepoint; o envio nunca corta dentro de um lote; lote acima de um limite medido (começar em 25 operações) é recusado com motivo. Preparação durável com ativação no fim fica para importação grande, fora do lançamento.
- **D5. Identidade de sessão após F5. DECIDIDA em 2026-09-13: reverter para `sessionStorage`**, com o comportamento declarado no cabeçalho de `frontend/src/js/session/sessao-id.js`, porque a correlação de erro por sessão é o instrumento de diagnóstico e quebrava a cada recarga.
- **D6. Baseline congelada. DECIDIDA em 2026-09-13, com ressalva do dono:** a linha de integração nunca foi implantada, então a baseline consolidada fica editável até o SHA candidato e a primeira implantação é instalação nova. O checksum entra já (recusa em desenvolvimento se resolve recriando o banco) e o congelamento passa a valer no SHA implantado; daí em diante, só migração numerada nova.

## 6. Regras de verificação por bloco

1. Lint e teste completos da raiz em comandos separados, depois da última escrita do bloco. A raiz encadeia frontend, backend sob c8 e contratos; exige PostgreSQL e não pode concorrer com outra rodada de backend nem com medição de cobertura (banco por `TEST_DB_NAME` se precisar isolar).
2. Controle negativo para cada guarda novo: reverter o fix, ver o vermelho, restaurar a fonte byte a byte.
3. Mudança que cruza os dois pacotes vai nos dois lados no mesmo commit, com caso de contrato em `frontend/tests/e2e`.
4. Interface só se valida por captura Playwright dirigindo app e backend reais, lida como imagem, com o spec temporário apagado; rodar de dentro de `frontend/`; ler a contagem de `flaky` antes de declarar verde.
5. Corrida se mede em série com taxa relatada; caso que mede corrida desliga o retry em si mesmo.
6. Cada bloco atualiza o documento de fechamento correspondente com commit, testes, resultado observável e limites, e registra a lição em `docs/livro-razao.md` quando corrigir um desvio recorrente.
7. Número de suíte vai no corpo do commit, não só na prosa (F21).

## 7. O que este plano não cobre

Não cobre a auditoria do frontend que a memória do projeto registra como inteira por fazer, nem o acervo 3D ainda não migrado. Não verifica a rede interna, o proxy, o WebSocket através dele, TLS, quotas reais de disco de navegador nem o comportamento em navegador que não seja Chromium, que é o único motor exercitado pelos ensaios existentes. Os números da seção 4 são estimativas de uma leitura; a primeira semana de execução é a medida que os corrige.
