# Pendências do lançamento do integracao_backend

Escrito em 2026-09-24 à tarde, quando a campanha de caça de bugs e de cobertura foi encerrada por falta de limite. Lista o que ficou para verificar, corrigir ou decidir antes de o integracao_backend substituir o main em produção. Este é um documento de TRABALHO: quando um item fechar, apague a linha dele (o que sobrevive vai para a wiki ou para o diário de decisões), e quando a lista zerar, apague o arquivo.

**Ele foi escrito para ser retomado em OUTRA máquina, por agentes sem o contexto da sessão original.** Tudo o que ele cita está no GitHub (origin), e nada depende de pasta local da máquina original. Os relatórios da campanha moravam no branch hunt/relatorios, que o dono decidiu apagar em 2026-09-25: o que ainda servia deles está neste arquivo.

## 0. Onde está cada coisa (tudo no origin)

### O código não integrado: um branch

| branch | HEAD | o que contém | item |
|---|---|---|---|
| hunt/rede-ws | 12b2c21b | o WebSocket bloqueado em wip (a presença em link lento, item 1.3, saiu em 2026-09-25) | 1.4 |

Commit wip significa NÃO VERIFICADO: é trabalho em curso salvo quando a campanha parou, com a mensagem começando por wip e essas palavras no corpo. Nunca integre um wip sem terminá-lo e verificá-lo.

Outros branches hunt/ que existam na máquina original e não estão no origin não têm nada a integrar: o conteúdo deles já entrou por outro commit, ou foi descartado de propósito.

### Fora do repositório, de propósito

As instruções de nginx para o engenheiro (nginx-srv-arquivos-2026-09-23.txt e nginx-srv-arquivos-ebgeo-envio-2026-09-24.txt) descrevem os servidores de produção e NÃO estão no GitHub, porque este repositório é público. Elas ficaram na pasta Downloads da máquina original e precisam ser levadas à mão. O essencial delas está no passo 6 do item 5 abaixo.

## 0.1 Como retomar numa máquina nova

1. Clone o repositório e traga os branches: git fetch origin.
2. Não trabalhe no diretório principal para retomar uma frente: crie uma worktree por frente, fora do repositório, e instale as dependências dos DOIS pacotes nela (sem junção de node_modules, que já destruiu instalação uma vez):

        git worktree add ../ebgeo_rede-ws -b trabalho/rede-ws origin/hunt/rede-ws
        cd ../ebgeo_rede-ws/frontend && npm ci
        cd ../backend && npm ci

3. Rebase sobre o integracao_backend atual antes de verificar: o origin andou depois que os branches foram cortados, e outra sessão do dono também publica nele.
4. Cada teste que sobe servidor precisa de porta e banco próprios quando há mais de um agente na máquina: EBGEO_UI_E2E_APP_PORT, EBGEO_UI_E2E_BACKEND_PORT, EBGEO_E2E_PORT, EBGEO_E2E_DB_NAME e TEST_DB_NAME. As regras para agentes estão na seção 6, e as variáveis em frontend/tests/e2e-ui/constants.js e frontend/tests/e2e/global-setup.js.
5. Verificação: desde 2026-09-24 cada commit roda npm run test:tocados, que escolhe os testes pelo que mudou. Ele só enxerga commit ainda sem push se o branch tiver upstream (git branch --set-upstream-to=origin/<branch>): sem upstream, ele vê só o que não foi commitado e responde "nada a rodar" (item 3). O vitest precisa de um Node com navigator.locks (24 ou mais novo): no Node 22 cerca de 135 casos reprovam por ambiente. A metade (b) do teto de peso mede o dist/, então rode npm run build antes de acreditar nela. A suíte inteira da raiz (npm run lint e depois npm test, em comandos separados) é obrigatória quando a mudança cruza os pacotes, antes de deploy e antes de levar trabalho ao main. O Playwright fica fora do npm test (npm run test:e2e:ui, de dentro de frontend/).
6. Revisão de código antes de integrar qualquer item do bloco 1: as três rodadas de revisão desta campanha acharam defeitos de perda de dado que as suítes verdes não pegavam.
7. Integrar: cherry-pick ou rebase sobre o integracao_backend, verificação, e push. Faça fetch e rebase logo antes do push e nunca force.
8. Os tetos do teste de peso da página do mapa (frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js) sobem com código novo. Quando subir um, registre no comentário ao lado do número o que foi medido e por quê.

## 1. Trabalho pronto em branches e ainda não integrado

A ordem abaixo é a de prioridade.

### 1.4 Atlas de servidor com o WebSocket bloqueado

- Mesmo branch hunt/rede-ws, no commit wip 12b2c21b, NÃO VERIFICADO. O trabalho começou (estado de conexão novo, sincronização por HTTP, aviso de "sem tempo real").
- Hoje, com um proxy que não repassa o Upgrade, o atlas de servidor não abre de jeito nenhum. Medido em 2026-09-23 (74b426af): com o Upgrade recusado e o HTTP funcionando, a abertura espera o connected e a aba volta a atlas.html com o aviso de código WS_HANDSHAKE_CLOSED. E, mesmo aberto, nada subiria: hasWorkToFlush (sync-flush.js) pergunta isOnline, que é o estado do socket.
- O wip não roda: sync-engine.js chama _abrirTempoReal, _papelPorHttp e _entrarSemTempoReal, que não estão definidos. O que ele já tem: sem-tempo-real.js, folha sem imports com as regras (10 s de espera pelo connected; poll de 3 s que cresce 1,5 vez até 10 s quando volta vazio e dobra até 30 s em falha; 2 falhas até voltar a "reconectando"; sonda 10 s depois de uma queda; papel relido a cada 10 polls; 403, 404 e 410 no poll encerram o acesso pela saída que resgata o trabalho, e 401 só encerra o visitante); o estado HTTP_ONLY em connection-state.js, com canReachServer separado de isOnline; o ws-client que não mexe no estado em HTTP_ONLY; atlasRoleForPermission em permission-levels.js; o unitário e o rascunho de sem-tempo-real.spec.js.
- O que falta: os três métodos do engine (connect e connectPublic, papel por HTTP, poll com recuo, sonda depois de queda); os consumidores que devem perguntar canReachServer (27 sítios em 15 arquivos usam isOnline ou ConnectionStates.ONLINE: flush, fila de blob, image-sync, selo, pendências, duplicar mapa, isMountedAtlas, sync-gateway); a frase "Sem tempo real"; os mocks do sync-engine.test; o e2e com controle negativo; o diário e a wiki.
- O papel por HTTP cruza os pacotes: GET /atlas/:atlasId devolve getAtlasById sem user_permission, e o middleware já tem req.atlasPermission. O poll não pode passar pelos gates de sync-engine.js que descartam o syncResponse quando isOnline é falso. Sem o socket não chegam atlas_settings_updated, sharing_updated, atlas_owner_changed, atlas_resources_updated, map_duplicated, atlas_updated nem o autor da edição sobrescrita; os marcadores das rotas REST estão no log e chegam pelo poll. abertura-sem-tempo-real.repro.spec.js afirma o comportamento de hoje e muda no mesmo commit. Para bloquear o socket em teste, routeWebSocket serve; para medir latência não, porque o proxy do Playwright responde o ping na hora.

## 2. Cobertura que ficou faltando

Os branches de cobertura foram todos integrados em 2026-09-25, e os relatórios das frentes saíram com o branch hunt/relatorios. O que as matrizes deles ainda marcavam como LACUNA está nas linhas abaixo.

- Desenho (cobertura-desenho.md; o branch saiu em 2026-09-25): os specs de alça, abas e menu de contexto entraram, e o Ctrl+V logo depois do Ctrl+C foi corrigido, verificados só no Chromium. Nenhum dos três vermelhos era o que se supunha: dois eram esse Ctrl+V, e o da alça de rotação do texto era o enquadramento do clique na árvore, que a deixava fora da tela (item 4). O refazer do atlas local não reprovou em nenhuma das 16 execuções que chegaram a ele. Continuam fora: imagem (refazer e F5 nos dois), azimute e distância, e o desfazer de uma EDIÇÃO de estilo ou de forma, que nenhum spec cobre. E, na aba Coordenadas, NM/NV e Copiar coordenada; o ✕ de uma repetição de escalão do limite; Preencher com coordenadas.
- Táticas (cobertura-taticas.md; o branch saiu em 2026-09-25): a alça da partida da rota virou anel, e o arrasto da Declinação passou a gravar na store, verificados só no Chromium. O caso Declinação de cobertura-simbolos-taticos caiu de 2 em 8 para 1 em 17; o vermelho que sobra tem outra assinatura (o autor fica com a posição nova, o servidor com a antiga, e há conflito no SyncLedger) e não foi diagnosticado. Continuam LACUNA:
  - nos quatro símbolos, os campos próprios (escalão, modificadores, cor, engajamento; tipo, FT, GDH e número da coordenação; variante da engenharia; Diagrama de Nortes) e o PDF deles;
  - na visada e no viewshed: atributos, alças do observador e do viewshed, Opacidade e Perfil da visada, Altura do Alvo do viewshed, a recusa de colar, e KMZ e PDF pela tela;
  - na trajetória: D+N, tempo do ponto-chave, Limpar, arrastar vértice, inserir pelo ponto médio, reagendar, desfazer e colar;
  - nas réguas: Limpar da área e do ângulo, Escape com menos de dois vértices, a área salva com o colega, e a feição salva pela régua (estilo, atributos, mover, colar, desfazer, KMZ, PDF);
  - Informações da Carta inteira: painel EDGV, várias camadas, e o servidor de tiles ausente, que hoje falha em silêncio;
  - a seleção por retângulo com outros tipos, com mover e estilo em lote, com grupo travado e com mapa travado.
- Briefing e processamento (cobertura-briefing.md; o branch saiu em 2026-09-25): o painel de processamento segue papel e trava, verificado só no Chromium. Faltam B27 (exportar o PDF do briefing: download e número de páginas) e B12 (salvar posição na vista 3D/360, que exige modelo e foto semeados). Também B11 (Salvar Posição na vista 2D, com o valor e o F5; hoje só indireto, por B24) e apresentar enquanto o colega edita.
- Camadas (cobertura-camadas.md; o branch saiu em 2026-09-25): o "Editar" das notas do mapa para Leitor e Comentarista, e o que ficava lá quando a trava chegava, foi corrigido e verificado só no Chromium. Falta cobrir pela interface o painel de camadas (renomear, opacidade, reordenar, excluir, catálogo; o achado de leitura "os handlers do catálogo seguem a intenção e não o resultado" está por provar), os grupos (Adicionar ao Grupo, Combinar, Desagrupar) e a aba Mapas (Puxar outros mapas, limpar posição, renomear por menu, duplicar e excluir local, Limpar tudo). Falta também medir a rajada de ops remotas que redesenha a tabela de atributos do colega uma vez por op. Na tabela: Shift+Tab, destaque no mapa ao passar o mouse, redimensionar coluna e painel, minimizar, e a tabela depois de importar várias camadas. E os atributos atravessando cópia, duplicação e transferência num atlas de servidor (só o local está coberto).
- Imagens (cobertura-imagens.md; o branch saiu em 2026-09-25): a foto grande pela galeria e a foto no link lento ficaram cobertas pela integração das fotos por referência (foto-anexa-por-referencia.spec.js). Falta, pela tela, a recusa de foto acima de 10 MB com a frase (hoje só o unitário image-utils.test.js prende o limite), a recusa de SVG pela galeria (só unitária) e a foto por referência aberta por visitante de link público (nenhum spec).
- Bloqueio (tudo já integrado): falta um spec da seleção por clique e por caixa com as três travas, e do F5 nos dois lados. Falta também a coluna do mapa travado: seleção no mapa, arrasto, vértice, painel, aba Atributos e célula da tabela; excluir por menu e por caixa, colar, mover, converter, cortar e estilo em massa. Hoje só browser-collab-lock, browser-lock-authz e drawing-delayed-map-lock tocam nela, sem conferência caso a caso. O modal de pontos em lote com a camada ativa travada só tem a guarda da store.
- Importação e exportação: faltam desc e ele do waypoint GPX, CSV em GMS, UTM e MGRS num atlas de servidor, as capturas 3D e 360, o PNG de perfil e "Baixar meus dados".
- Navegadores: no Firefox, o modo privado ficou inconclusivo (o Playwright não entrou nele). A volta pelo bfcache não foi medida: o Firefox real tem bfcache ligado, o do Playwright não, e nenhum código ouve pageshow com persisted (atlas.html é a candidata).

## 3. Defeitos e riscos conhecidos, sem conserto

### 3.0 Achados da rodada completa de testes de 2026-09-24 à tarde (sobre ca2f7e87)

A suíte inteira da raiz passou: lint, frontend 16262/16262, backend 5704/5704 (cobertura 98,36%), contrato 274/274. O Playwright principal (911 casos, só Chromium) rodou em três fatias paralelas. Elas foram interrompidas por falta de memória da máquina quando tinham feito 678 casos. Os que falharam foram depois rodados sozinhos, em série, 3 vezes cada, sem nova tentativa:

- No spec transicao-main-fotos, a foto aberta pela galeria no atlas de SERVIDOR logo depois de "Enviar ao servidor" falhou 3 de 9 vezes: em duas a linha da feição não apareceu na árvore de camadas em 60 s, e numa o visualizador mostrou a miniatura (64 px) no lugar da foto (320 px). Os bytes no servidor conferem pelo banco e pela rota de leitura; o que a tela tem de produto ficou sem diagnóstico, e o spec deixou de abrir a foto ali.
- foto-anexa-nas-copias.spec.js, passo "copiar camada": criar um mapa e, na linha seguinte, copiar uma camada para ele falha em cerca de 1 de 10 com "Não foi possível confirmar a camada no mapa de destino" (desfecho target_write_incomplete da transferência de camada). Medido nas duas bases em 2026-09-25: 2 em 30 no integracao_backend e 1 em 10 com as fotos, então não vem delas. Hipótese a conferir: o eco do mapa novo refaz o índice de nomes entre a criação e a cópia, e a gravação no destino não acha o documento pelo nome e recusa em silêncio. Num atlas de servidor, quando isso acontece, o lado local desfaz, as intenções já gravadas sobem e o servidor aplica o mover: divergência até o próximo retrato. transferir-para-mapa-recem-criado.spec.js não reproduziu com addMap mais 100 ou 300 feições.
- browser-collab-permissions.spec.js (linha 253), revogação de compartilhamento: falhou 3 de 3, mas o defeito é do TESTE. Depois da revogação, a página do colega navega para outra tela, e o teste ainda chama clienteNaPagina nela ("Execution context was destroyed"). Confirmar que a navegação é o comportamento desejado e ajustar o spec.
- briefing-figura-leva-bytes.spec.js: passou 3 de 3 sozinho; a falha na fatia foi da carga.
- Depois, uma camada por vez, sobre c65162df. Três fatias paralelas mais a suíte da raiz tinham estourado os 32 GB da máquina original:
  - resto da suíte principal: 292 passaram, 3 falharam, 1 pulado;
  - tablet: 10/10;
  - segurança do atlas: 4/4;
  - sessão longa: 2/2;
  - atlas grande: 4 de 5;
  - verificações de release: 5/5.
- As falhas dessas camadas, rodadas sozinhas 3 vezes cada:
  - visibilidade-compartilhada-no-colega: 3 de 3; a falha anterior foi carga.
  - browser-migracao-2.2.spec.js (linha 421), janela do main aberta: 0 de 3, TESTE DESATUALIZADO. A tela agora diz "Há uma janela antiga do EBGeo aberta. Feche a outra janela do EBGeo neste computador...", e o teste procura as palavras "versão antiga". Confirmar que a mudança de texto foi intencional e atualizar a asserção.
  - desempenho-do-boot-do-mapa.spec.js (linha 304), transições entre atlas: 0 de 3, TETO DESATUALIZADO. São 638 pedidos de script por transição contra o teto de 631; o código novo do dia acrescentou módulos. Remedir junto com os tetos de peso, no passo 3 do item 5.
  - Atlas grande com 10000 pontos num grupo: 2 de 3. A falha foi "Target crashed", a queda conhecida do renderizador do Chromium no harness, descrita nas regras de teste do Playwright, que piora com mapa pesado. Nada aponta para o produto.
- Não rodaram:
  - o cenário de produção em HTTPS, que exige EBGEO_MIGRATION_DATA_DIR apontando para uma pasta com o arquivo 03-completo-2.4.ebgeo;
  - a camada de migração, que exige o mesmo acervo;
  - a "mega", que abre navegador na tela;
  - a suíte no Firefox (npm run test:e2e:firefox), cancelada pelo dono aos 19 de 912 casos, todos passando até ali.

- Figura de slide de briefing mora dentro do HTML do texto. Num link de 40 kbps, três palavras digitadas num slide com figura viraram 8 envios com o HTML inteiro (2,4 MB, cerca de 8 minutos), e em 5 minutos o colega não tinha o texto. Nada se perde, mas o slide fica inutilizável em link lento. Candidato a figura por referência, como as fotos. Medido e NÃO afirmado, por decisão do dono de 2026-09-25: briefing-figura-em-link-lento.spec.js afirma só a chegada da figura, e o comentário dele aponta para este item; quando ele fechar, o apontamento vai para a entrada do diário de decisões. O spec usa Network.emulateNetworkConditionsByRule, que o Chromium 1194 da nuvem não tem: ali ele foi verificado numa cópia que estrangula a página inteira (3 de 3, figura em 88 s), e o arquivo commitado ainda precisa de uma rodada com o Chromium do Playwright instalado (build 1228). Se a regra por origem não pegar, o piso do instrumento o reprova em voz alta.
- cobertura-desenho-estilo.spec.js reprova de forma intermitente, e já reprovava antes dos gestos em massa: 7 de 12 no integracao_backend (eaa4dd14) e 14 de 39 com eles, medidos em 2026-09-25. O valor escolhido pela pessoa sempre chega ao servidor; a divergência está nas propriedades DERIVADAS do zoom (calculatedLineWidth, calculatedSize, selectionBox), que o autor recalcula depois do envio e o servidor guarda da derivação anterior, na quarta casa decimal. Há ainda localizadores que não aparecem e páginas fechadas no meio. Decidir se o derivado deve viajar, e então consertar o produto ou o spec. Na nuvem de 4 núcleos, sozinho, em b3bf07ba: 0 de 39, com e sem a releitura da aba que o spec ganhou naquele dia; a taxa depende da máquina ou da carga, e a decisão continua pendente.
- Teste do backend que falha perto da meia-noite: diag-cli-json.test.js, nos casos da janela e do comando saude (2 de 5710 numa rodada que cruzou 2026-09-25 00:00). A fixture espalha os registros por 15 minutos e os grava por arquivo de dia, então nos primeiros 15 minutos do dia eles caem em dois arquivos. Passa 17 de 17 sozinho. Tornar a fixture independente do relógio.
- Testes do frontend que falham só sob carga e passam sozinhos: tab-lock-refutacao 3.5 (três vezes em 24/09), idb-decisao4-medicao (duas vezes), e a verificação de símbolos por tempo do docs-integridade (duas vezes).
- Dois specs do Firefox ficaram sem classificação: browser-collab-analise-desfazer (linha 119) e envio-do-acervo-herdado (linha 341).
- briefing-vista-do-slide-cobertura.spec.js, caso "base por slide e instante por slide", reprova já em 318d864f (Chromium 1194, 1 de 1): um modal de confirmação intercepta o "Salvar" do editor em fecharEditorUI (linha 165). Não investigado.
- Seis casos do vitest dependem do número de núcleos da máquina: orcamento-de-memoria-do-3d, streetview-tile-canvas-area-zero (2), streetview-tile-custo-maquina (2) e tile-loader-consertos-de-desempenho. Eles afirmam o caso "a máquina não se descreve", mas o Node 24 expõe navigator.hardwareConcurrency, e numa máquina de 4 núcleos o código aperta o orçamento. Reprovam na nuvem de 4 núcleos, em 318d864f também. O teste deve fixar o navigator em vez de ler o da máquina.
- A porta de cópia pode dizer "pendente" onde é "recusado" (lido no código em 2026-09-25, sem medição): lerDivida (espera-do-envio-do-mapa.js) conta os recusados por getProblems, que segue só dependsOn, enquanto countByState e o carregador seguem também o lote envenenado (poisonedBatches). Depois do B6.1 a diferença só sobra para irmã SEM recibo no mesmo batchId. Um repro de integração decide se o caso ainda é alcançável.
- Presença em link lento, o que ficou fora do item 1.3 (integrado em 2026-09-25): o cursor do PRÓPRIO par lento continua subindo durante um envio, estimado em cerca de 17% do uplink nominal e nunca medido. Só vale fazer se um spec de subida lenta mostrar a edição esperando atrás do cursor. O spec presenca-nao-disputa-com-sync usa Network.emulateNetworkConditionsByRule, que o Chromium 1194 da nuvem não tem: ali ele foi verificado numa cópia que estrangula a página inteira (3 de 3; o controle com WS_PRESENCE_FLOW=0 reprovou como devia), e o arquivo commitado ainda precisa de uma rodada com o Chromium do Playwright instalado (build 1228).
- Na nuvem Linux (Node 22.22), quatro arquivos do backend reprovam por ambiente, fora de qualquer mudança: stream-error-crash.repro (caso 416) e erro-preserva-causa (lerPiramides) dependem de como o Windows trata um diretório, e sqlite-blob-pool e sqlite-blob-worker cancelam porque o worker e o temporizador de guarda são unref e o laço esvazia antes da resposta. O catalogo-basemap-sem-video, vermelho na máquina original, passou aqui antes e depois do 1.3.
- Coleta de imagem órfã (integrada em 2026-09-25, sem agendamento, por decisão do dono): ANTES do primeiro npm run diag -- orfas --marcar em produção, medir o gatilho zerar_marca_de_imagem_citada. Enquanto nenhuma imagem está marcada ele custa uma consulta a um índice parcial vazio; depois da primeira marcação quase sempre haverá alguma, e aí toda escrita nas doze tabelas-fonte (operations e features inclusive) lê o texto da linha (cerca de 10 ms por MB) e abre uma subtransação por linha, por causa do bloco EXCEPTION. Um import, um clone ou um push grande numa transação só passa de 64 subtransações, que é onde o Postgres degrada. Se a medição incomodar: tirar o EXCEPTION (a escrita do usuário passaria a falhar junto com o gatilho) ou mover a zerada para fora da transação da escrita. Ficam para depois do lançamento: o agendamento (proposta: marcar semanal e apagar mensal pelo cron do host), um relatório só de leitura dos arquivos em disco sem linha em images, e a coleta local (IndexedDB), só em atlas local montado, sem subida pendente e com a pilha de desfazer vazia.
- O runner do processamento (processing-runner.js) confere só a trava: se o papel ou a trava mudarem durante uma execução já iniciada, a pessoa ainda lê "Falha ao criar camada de saída". Pelo clique isso não se alcança mais, porque o Executar some.
- Documentação que hoje afirma o falso, e engana agente:
  - backend/CLAUDE.md, "A segunda são as DUAS rotas que este cliente não chama": o duplicate tem chamador desde 2026-09-24 (MapManager._duplicateOnServer, frontend/src/js/map/map.manager.js). Falta dizer também que duplicação e merge tomam lockAtlasLog;
  - docs/wiki/namespace-por-atlas.md ("A ORIGEM É A EXCEÇÃO") e o fileoverview de frontend/src/js/store/migration/legacy-cleanup.js citam o botão "Apagar a cópia antiga da versão anterior": dropLegacySource não tem chamador de produção desde 2026-09-22;
  - .claude/rules/ferramentas-e-tipos-de-feicao.md diz "cinco entradas" de buraco no censo de tipos: a declinação entrou na legenda do PDF (f599dde1), e sobram três (agrupar por tipo, chip da ferramenta ativa, ícones do celular);
  - frontend/vite.config.js: o comentário "'hidden' generates maps without exposing them publicly" é falso, porque deploy/deploy.sh copia o dist inteiro;
  - frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js, metade (b), "É o que a pessoa de fato paga": ela soma a passada legacy, que o navegador moderno não baixa (718 kB, 522 deles CSS repetido). Reescrever junto do passo 3 da seção 5;
  - parágrafos de wiki propostos pela campanha e não aplicados: holdOperationFrames e a tolerância escalonada do heartbeat do cliente (canal-collab-websocket); o teto da cauda de 500 ops ou 2 MiB (snapshot-e-pull-incremental; só está no diário); o prazo do push proporcional ao corpo (fila-operacoes-outbound); a rajada remota numa escrita por verbo (desempenho-do-mapa-2d); o briefing que converge por slide e o editor que grava só o patch, sem clipboard.convert (não há página de briefing); o ajuste de mapa do par que apaga a revisão confirmada (modelo-conflito-lww).
- Defeitos confirmados no código, sem conserto:
  - dois fontes com caractere NUL, que o git trata como binário e mostra sem diff: frontend/src/js/features_tab/index.js e backend/src/modules/models3d/models3d.scene.js (git ls-files --eol dá -text). Precedente do conserto: 4608f59a;
  - o cabeçalho do painel lê a feição com getFeatureById fora da trava e grava a feição inteira em commitName e saveDescription (frontend/src/js/sidebar/components/feature-identification.js): a mesma janela de 4b5672c6, e o conserto é updateFeature com transform;
  - o controle da grade (grid.control.js) aplica o formato na tela antes de setGridStyle e ignora a recusa: para Leitor ou mapa travado a grade muda na tela, a store recusa com aviso e o F5 a desfaz;
  - a importação de KMZ pega o PRIMEIRO .kml do zip, não o doc.kml (import.control.js, zip.file com a expressão de .kml antes de doc.kml). Nunca medido;
  - KMZ e Garmin, menores: a visada processada sai com largura 2 em vez de 5; observations não viaja; símbolo, medida e texto voltam como ponto genérico; o Garmin continua dizendo "Cancelar Seleção" depois da recusa "Área muito grande";
  - tabela de atributos com a célula aberta: aceitar "Sair" no diálogo grava 2 de 5 no Chromium, e o painel de feição grava 4 de 4 no mesmo gesto. A diferença não foi achada; está declarada só em tabela-de-atributos-sobrevive-ao-f5;
  - "Enviar ao servidor" manda locked: false fixo (frontend/src/js/import_export/local-atlas-to-server.js): a trava de mapa do atlas local não sobe, e o .ebgeo também não a leva. mapBadgeColors também não sobe;
  - comentário: o UPDATE só grava data, então as colunas lng e lat ficam velhas, e GET_ATLAS_COMMENTS as lê;
  - o catálogo semeado (backend/src/database/migrations/005_catalogo.sql) tem quatro fontes http://localhost/tiles/..., que viram conteúdo misto sob https. Trocar antes do deploy (cabe no passo 6 da seção 5);
  - navegador mínimo decidido (Chrome e Edge 109, Firefox ESR 115), com três problemas: :has() exige Firefox 121 e aparece em 16 regras de 10 arquivos (em sidebar.css as duas regras que escondem .unified-attributes-panel caem inteiras no ESR 115, e ui_manager.js ainda cria painéis com essa classe; não medido); color-mix() exige Chrome 111 (33 usos em admin.css, mais catalog, account, sidebar e attribute-table); e o censo do dist moderno contra APIs acima do piso, a consequência 3 da política, não foi feito;
  - menores: base-layer-selector.constants.js cita images/layers/imagens-thumb.webp, que não existe (404 cosmético); _captureWithHiddenMap (screenshot.control.js) desiste em qualquer error do mapa temporário; a aba do main que abre o tutorial durante a virada pede ./docs/doc.html (404; um redirect do nginx para tutorial.html resolve); base-layer-selector.spec.js, "the key left of 1 cycles basemaps", estava vermelho em c777d8c5 e não foi investigado.
- Suspeitas não fechadas:
  - visada: o viewshed do par foi lido vazio 1 vez em 6 depois de F5 nos dois; e a primeira mudança de Altura do Observador não recalcula (3 de 3 com Tab), o que o ajudante mudarAlturaDoObservador (frontend/tests/e2e-ui/helpers/analise-terreno.js) mascara tentando duas vezes;
  - servidor: nomes de mapa iguais por criação concorrente (o cliente chaveia trava e temporal por nome, e o servidor não tem UNIQUE); restaurar o banco de um backup (setLastVersion só sobe, então um cursor acima do current_version pula ops; importa para o plano de rollback); retrato HTTP de resync com uma op viva atrasada chegando depois dele; update de camada, grupo, 3D e 360 filtra por map_id da op, e depois de um merge REST volta applied sem efeito (só pela API);
  - resgate: a trava de aba não é reconferida depois do modal do resgate; um desenho com gravação pendente durante switchAtlas ao vivo não cai em atlas nenhum (janela de milissegundos, só no vigia de migração).
- Duas lições de método ainda sem guarda, e por isso fora do livro-razão: o docs-integridade lê arquivo NÃO rastreado (FONTES_DE_CODIGO usa readdirSync), e uma sonda solta na worktree de um agente o deixou verde com um símbolo errado; o certo é listar só o rastreado, como os censos que já têm o caso tmp-nao-rastreado. E a linha #! no começo de um script que o vitest importa quebra num checkout CRLF, e já aconteceu duas vezes (scripts/inventario-de-vendors.mjs em 2026-09-13, dev/testes-tocados.mjs em 2026-09-24): falta um censo de #! nesses scripts.
- O npm run test:tocados responde "nada a rodar" quando o branch não tem upstream, mesmo com commits ainda sem push: ele só soma o diff contra o upstream quando existe um. Deveria recusar em voz alta e pedir --desde ou o upstream.
- Duas observações da revisão dos gestos em massa (2026-09-25), menores e sem perda de dado:
  - Na quarentena, "Descartar" numa linha de um grupo recusado junto pergunta pelo grupo inteiro e descarta só aquela linha; e as frases do grupo prometem um "Aceitar o servidor" que a linha de quarentena não tem. Erra para o lado seguro, mas o texto é falso.
  - Num excluir em massa de feições agrupadas recusado inteiro, "Aceitar o servidor" numa feição descarta o grupo da mesma ação, mas não as irmãs da operação de grupo culpada, que ficam nas pendências apontando para uma culpada que já saiu. Nada se perde; custa cliques.
- Duas observações da revisão dos atributos, sem efeito hoje:
  - Uma edição que mude mais de 1000 chaves de atributo de uma vez é recusada; nenhuma tela produz isso.
  - A remoção de chave sobre uma lista de atributos que não é objeto a troca por uma lista vazia.

## 4. Decisões do dono

- Corrigir o custo da figura de slide em link lento (item 3) antes do lançamento, ou depois?
- Três detalhes do anel da partida da rota, implementados como a campanha recomendou: o miolo vale também no toque longo (gêmeo do botão direito); com a feição deslocada pela linha do tempo, o anel fica na partida e o miolo não pega nada; e o "1" acima do anel cai sobre as marcas de escalão no tamanho padrão, legível pelo halo (dá para subir o deslocamento de 2,4 para cerca de 3 em). Recomendação: manter os três.
- O clique na árvore de camadas, a busca e "Zoom para Seleção" enquadram a feição pela caixa, com 80 px de folga, e o quadro deixa alças de edição fora da vista: a alça de rotação de um texto ficou em x = -82 px (zoom 16,66, com o painel aberto cobrindo de 0 a 456 px), e os pontos-chave 2 e 3 da rota de um símbolo passam da borda direita. Para girar, a pessoa precisa afastar o mapa. (a) O quadro inclui as alças da seleção e desconta o painel aberto; (b) a alça de rotação do texto entra na caixa; (c) fica como está. Recomendação da campanha: (a).
- Os quatro testes do backend que dependem da plataforma (item 3): reescrevê-los para falhar igual em Windows e Linux (um alvo que não seja diretório, um guarda de tempo que segure o laço), ou declarar Windows e Node 24 como a plataforma da suíte? Recomendação: reescrever, porque hoje o portão da raiz nunca fica verde numa máquina Linux.
- Desfazer um processamento tira as feições e deixa a camada de saída vazia. (a) fica assim, e a pessoa apaga a camada; (b) o desfazer reverte o gesto inteiro, feições e camada, e o refazer recria os dois com os mesmos ids; (c) o desfazer tira a camada só se ela ficar vazia e tiver nascido daquele processamento. Recomendação da campanha: (b), e conferir antes como a importação se comporta ao desfazer, porque a resposta deveria ser a mesma.
- Slide que chega com as duas grafias (camelCase do cliente e snake_case do servidor): o conserto de 2026-09-24 (0dd03c9b) é só do cliente. O servidor deve preferir a camelCase quando as duas chegam, protegendo cliente antigo com operação na fila? Recomendação da campanha: fazer junto do lançamento se houver cliente antigo com fila viva; senão, descartar.
- Comportamentos de visibilidade que ficaram como estão:
  - a busca acha feição oculta e, ao escolher, abre o painel dela;
  - feição oculta conta nos limites da linha do tempo;
  - excluir a camada ativa quando todas as outras estão travadas destrava uma delas.
- Limitações que o main também tem:
  - a volta de um KMZ perde a figura e as fotos anexas (o .ebgeo é a volta sem perda);
  - o ícone embutido de um KMZ chega como marcador padrão (o produto já tem ícones personalizados onde mapeá-lo).
- A CONSTITUICAO.md não tem cláusula sobre a coleta de imagem órfã, a única rota do produto que apaga bytes de atlas alheio. As cláusulas 5.5 e 9.1 já a cobrem (só o administrador do sistema tem posse em todo atlas), e o código segue isso (requireAdmin, que recusa chave de API; teste em backend/tests/integration/imagens-orfas-portas.test.js). (a) Não escrever nada; (b) uma frase vigente na seção 9: "apagar imagem órfã é ato do administrador do sistema", citando o teste. Recomendação da campanha: (b), para ninguém "abrir" a rota a produtor ou dono de atlas.
- Origem legada no disco: todo usuário migrado carrega o acervo em dobro, porque dropLegacySource ficou sem chamador desde 2026-09-22. Religar o botão, apagar depois de um prazo, ou deixar?
- DELETE /atlas/:id/images/:imageId: com permissão write, apaga o arquivo sem passar pela trava nem pela lixeira (cláusula 7.4), e nenhum cliente chama a rota. Remover, exigir administrador, ou apagar só logicamente? Casa com a frente 1 da seção 6.
- Duplicar mapa no servidor lê a origem sem retrato estável, porque o lock do log só cobre a linha do atlas e o marcador: um colega editando a origem durante a cópia pode deixar feição órfã, e desde 2026-09-24 isso é alcançável pela tela. Segurar o lock durante a cópia (o push espera ou leva 503) ou aceitar? Duplicar também custa dois retratos ao autor.
- Edições feitas depois de uma foto esperam a subida dela (espera em fila por construção, imagens-atlas.md). Medido: foto de 138 KB a 40 kbps, e a linha desenhada em seguida chegou 1 s depois da foto, cerca de 40 s depois do gesto. Deixar passar a op independente da foto foi recusado pelo coordenador da campanha e ficou para o dono.
- KMZ: "Simular linhas tracejadas" vem ligado e corta a linha, e a volta vira dezenas de feições (156 para 3). Gravar a geometria original no ebgeo_estilo? E o estilo de KML de terceiros é descartado: mapear stroke e fill para os campos nativos?
- Sourcemaps: publicar ou tirar os .map no deploy (mexe em deploy/)?
- Depois de um resgate involuntário, a mesma conta, ao reabrir o atlas, só tem "Apagar e abrir" ou "Enviar ao servidor", que duplica. Criar uma saída "enviar as pendências a este atlas"? A op não carrega autor.
- Desfazer e refazer seguidos rápido: o segundo pedido chega enquanto o primeiro ainda redesenha o mapa base e é DESCARTADO em silêncio, por desenho, para o botão e o atalho não desfazerem dois passos juntos. A janela medida foi de 3 a 5 ms num mapa pequeno, e ela cresce com o redesenho num mapa pesado. O pedido deve esperar a vez, dizer que foi ignorado, ou ficar como está?
- Foto anexada recusada pelo servidor: o registro dela nunca sai, e toda saída da conta pergunta por ele, mesmo depois de a foto ter sido apagada da feição. Como a pessoa resolve: um "Descartar" nas pendências, ou o registro some quando a foto sai da entidade? (terceira revisão das fotos, item 5)
- Envio de imagem grande com o token vencido: o backend só usa o parser de 50 MB quando reconhece a sessão, então esse envio leva 413 e a foto vira recusa definitiva, quando antes era tentada de novo. Abrir o parser grande pela presença do cabeçalho de sessão, ou tratar o 413 como transitório no cliente quando o token pode ter vencido? (terceira revisão das fotos, item 4)

## 5. Passos finais antes do deploy

1. Fechar o item 1.4, que o dono decidiu levar ao lançamento. E medir o custo do ping de 2 bytes que agora segue cada quadro de presença: de dentro de backend/, node tests/bench/sala-limite.bench.mjs com WS_PRESENCE_FLOW=1 e com =0, contra a linha de base de 2026-08-27. A bancada mede o custo do ping, não a retenção, porque o cliente ws dela responde ao ping na hora, e o perdaCursorPct pode passar a contar coalescência como perda.
2. Rodar as seis frentes do item 6, na ordem de risco, e integrar o que elas acharem.
3. Remedir e APERTAR os tetos de peso da página do mapa. A fonte ficou com folga larga de propósito durante a campanha.
4. npm run lint e npm test na raiz, em comandos separados.
5. O Playwright inteiro, em fatias paralelas com portas e bancos próprios, com retries desligado ou lendo a contagem de flaky antes de declarar verde.
6. nginx (instruções completas nos arquivos fora do repositório citados no item 0):
   - limite de corpo de 60 MB nos blocos do EBGeo, porque o padrão do nginx é 1 MB e o sync e o import o ultrapassam;
   - cabeçalhos de Upgrade do WebSocket no bloco de produção, na troca;
   - X-Forwarded-For.

   TRUST_PROXY_HOPS precisa bater com o número de proxies do caminho: 3 em produção, 4 no ambiente de teste.
7. METEOROLOGIA_URL: o padrão é a API pública da Open-Meteo, chamada pelo navegador de cada usuário. Se a coordenada não pode sair da rede, aponte para uma Open-Meteo interna em https, ou desligue o painel na aba Sistema.

## 6. Frentes aprovadas e ainda não feitas

APROVADAS pelo dono: são trabalho a fazer antes do lançamento, e não ideias. Elas foram propostas em 2026-09-24 e ficaram paradas só porque o limite de sessão da API não comportava mais agentes naquele momento. Tudo o que a campanha mediu foi com 2 ou 3 pessoas, e estas áreas ficaram só com os testes que já existiam. Cada uma é uma frente no molde da campanha. As regras dadas aos agentes (o brief da campanha, resumido aqui porque o branch que o guardava saiu):

- uma worktree por frente, fora do repositório, com branch próprio a partir do integracao_backend atual; a árvore principal e as worktrees alheias são só leitura;
- proibido: git stash, junção de node_modules, git worktree remove ou prune, push, checkout de outro branch, reset --hard em commit alheio, escrever em deploy/, .env*, lockfile ou public/vendors/, instalar dependência;
- nunca matar processo que você não criou: porta ocupada, pare e relate;
- portas e bancos próprios em todo comando: EBGEO_UI_E2E_APP_PORT e EBGEO_UI_E2E_BACKEND_PORT (Playwright), EBGEO_E2E_PORT e EBGEO_E2E_DB_NAME (contrato), TEST_DB_NAME (backend);
- nada de Playwright inteiro nem npm test da raiz no agente: specs pelo nome, de dentro de frontend/, com --retries=0 --workers=1;
- método: hipótese escrita, repro vermelho antes, conserto mínimo na convenção da casa, controle negativo, taxa em série quando for probabilístico;
- decisão de produto, contrato congelado ou migração: relatar ao coordenador e esperar;
- cobertura: matriz tirada do código, conferindo o que cada spec afirma; toda LACUNA vira spec ou defeito;
- um commit por defeito, com repro e conserto juntos; lint e testes depois da última escrita, em comando separado; não subir número do teto de peso;
- não editar livro-razão, diário, wiki, CLAUDE.md nem .claude/rules em branches paralelos: propor no relatório;
- relatório vivo com o próximo passo; a mensagem final traz corrigidos (severidade, causa, sha, teste, controle), não corrigidos, suspeitas, linhas propostas e o que ficou fora;
- coordenador: no máximo três agentes (a revisão de código conta como um), revisão independente antes de integrar, suíte na integração, e nenhuma sonda solta na árvore na rodada que vale.

A ordem é a de risco:

1. Segurança e acesso. A noite de 23 para 24 achou falhas desta classe sem ninguém procurando, todas já corrigidas:
   - token de link público revogado que voltava a valer;
   - conta desativada que continuava escrevendo;
   - Comentarista apagando comentário alheio;
   - link de slide que abria a aba do EBGeo para outra página.

   Falta revisar três coisas:
   - texto de usuário exibido sem escape em toda superfície (tabela, legenda, PDF, KMZ, busca, briefing);
   - todas as rotas REST, por papel e por recurso, atrás de acesso a atlas ou recurso de outra pessoa;
   - os limitadores de tentativas, e o que um recurso privado do catálogo pode vazar.
2. Administração, compartilhamento e catálogo privado. A página de administração inteira, a lixeira, compartilhar e revogar, grupos de acesso, link público, concessões com prazo, OM e papéis. As regras estão escritas na CONSTITUICAO.md, e nenhuma frente as testou pela tela. Não medidos: excluir definitivo com o colega dentro, clonar no meio das edições, tornar privado com visitante de link, e revogar com o colega sem rede (pela leitura, a fila fica no namespace retido, sem resgate).
3. Carga com muitos usuários. Faltam 20 a 50 pessoas no mesmo atlas desenhando juntas. Medir:
   - processador e memória do servidor;
   - conexões do banco;
   - repasse das edições para todos;
   - se algum navegador trava.

   Os limites de uma instância única estão estimados na wiki, não medidos com colaboração real.

   O que a campanha já mediu em escala, com dois navegadores e Postgres, por duas specs de ferramenta que saíram com o branch hunt/relatorios (não serviam no repositório como estavam: devolviam "TIMEOUT" em vez de reprovar, e o guarda de e2e que não pula as reprovaria). Tempos local / servidor / colega, depois dos gestos em massa: importar 5000, 10,6 s / 85 s / 0,9 s; colar 1000, 1,4 / 19,6 / 0,3; mover 1000 de camada, 1,5 / 12,4 / 0,7; excluir 1000, 1,4 / 10,2 / 0; desfazer e refazer a exclusão, 0,9 / 6,1 e 0,8 / 9,1; estilo em 1000, 1,1 / 26,5; agrupar 500, 0,8 / 4,2; copiar e mover camada de 1000, cerca de 1 / 11 a 12. O maior quadro no colega ficou entre 17 e 183 ms. Para uma régua reutilizável, o molde é um cenário opt-in como release-large-atlas.scenario.js: config próprio declarado em configs-do-playwright-coletam-o-guarda, o _backend-required no testMatch, contagem afirmada no Postgres e no colega, tempos impressos e não afirmados.

   Medido e não corrigido: a seleção por caixa é superlinear (1000 em 0,3 s, 2000 em 1,0 s, 4000 em 4,3 s; getCompleteFeatureFromSource lê a fonte inteira por feição); a tabela de atributos não é virtualizada (5000 linhas, cerca de 100 mil nós, 0,6 a 1,2 s); as ops independentes saem 25 por pedido, e o estilo de 1000 leva 20 a 27 s ao servidor; countByState lê todo envelope a cada tique quando há problemas (não medido); o WebSocket nasce sem perMessageDeflate; cada op de feição leva a feição inteira duas vezes (data e changes); o shpjs está no grafo estático do mapa.
4. 3D, 360 e primeira pessoa. Faltam os visualizadores, os marcadores com foto, a cena caminhável, a colaboração dentro deles, a calibração 360 e o catálogo de modelos. O sync de 360 e de 3D no servidor e o catalog_layer também não foram cobertos.
5. Tablet e celular. O produto tem layouts próprios e specs de tablet que não entram na rodada normal (npm run test:e2e:tablet). Se houver uso em campo, percorrer os fluxos principais com toque.
6. Menores, que caberiam numa frente só:
   - login, cadastro, recuperação de senha, sessão expirando e inatividade;
   - busca de topônimos e de coordenadas;
   - links diretos (?atlas=, #view=3d);
   - luminosidade e meteorologia, que só foram testadas pela sessão que as fez.
