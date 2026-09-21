# Auditoria do sistema temporal (2026-09-21)

Pedida pelo dono por ser um módulo pouco usado em campo. Seis frentes de leitura em paralelo (modelo e render; controlador e barra; store, sync e presença; edição por feição; 3D, 360, briefing e PDF; importação, exportação e documentação), cada uma obrigada a dar arquivo, linha e cenário concreto. **Nada foi corrigido: este documento é o diagnóstico.** Ele sai do repositório quando os achados virarem conserto com teste, que é onde a lição passa a morar.

**Como ler a coluna de estado.** CONFERIDO quer dizer que o achado foi refeito por um segundo caminho depois do relatório da frente: leitura própria do trecho, ou execução em node. RELATADO quer dizer que só a frente o afirma, com o grau de confiança que ela declarou. Nenhum achado foi medido em navegador nesta auditoria; uma tentativa de reproduzir o E3 falhou no preparo e não conta como medição.

Os códigos são os das frentes (M modelo, C controlador, S store, E edição, V visualizadores, I importação, D documentação). Achado que duas frentes acharam por caminhos diferentes aparece uma vez, com os dois códigos.

## 1. Perda e corrupção de dado

| código | o que acontece | onde | estado |
|---|---|---|---|
| S1 (= I4) | **Renomear um mapa apaga a configuração temporal dele** (janela, unidade, modo relativo, Dia D). A config é guardada pelo NOME do mapa, e a rotina de renomear transfere cores, notas, grade, 3D e 360 e não transfere o temporal; o espelho em memória também não é re-chaveado. Em atlas local a perda é definitiva; em atlas de servidor, salvar a engrenagem depois do rename regrava os padrões para todos. O registro antigo fica órfão no disco. Um comentário do mesmo arquivo afirma que o rename já transfere os laterais. | `frontend/src/js/store/repositories/local.repository.js` (corpo de renameMap), `frontend/src/js/store/store-state-manager.js` (renameMapInMemory) | CONFERIDO |
| M4 (= I1) | **Data brasileira lida como americana.** O leitor de datas cai no parse do motor: 05/11/2024 vira 11 de maio, e 25/12/2024 vira nulo. Numa mesma coluna de CSV, as linhas com dia até 12 entram com dia e mês trocados e as demais entram sem tempo nenhum, sem aviso. Vale para CSV, GeoJSON e KML. | `frontend/src/js/temporal/temporal.utils.js` (toEpoch) | CONFERIDO (node) |
| E1 | **Converter ponto em símbolo militar ou em medida de coordenação descarta janela de validade e trajetória.** O construtor copia uma lista fixa de propriedades; a conversão LINEAR preserva as duas datas por nome. O ponto de origem é removido no mesmo lote. São justamente os três tipos que suportam trajetória. | `frontend/src/js/tool_manager/helpers/feature-header.helpers.js` | CONFERIDO |
| E2 | **Nenhuma edição de trajetória é desfazível, e Limpar não pergunta nada.** Arrastar, inserir, remover e limpar gravam pela escrita de propriedade, que não registra desfazer. Só o arrasto do PRIMEIRO ponto-chave segue por outro caminho e é desfazível, de modo que o mesmo gesto tem duas regras. | `frontend/src/js/store/feature.operations.js` (updateFeatureProperty), `frontend/src/js/temporal/temporal-attributes-section.js` | CONFERIDO |
| S3 (= I7) | **Clonar ou importar um atlas perde o instante congelado de todos os slides**, e enviar um atlas local ao servidor também. A coluna do cursor do slide não está na lista de colunas copiadas, embora o interruptor do slide viaje, então o slide chega com o temporal ligado e sem instante. O arquivo `.ebgeo` preserva, então a mesma ação ganha ou perde conforme a porta. | `backend/src/modules/atlas/atlas.service.js`, `frontend/src/js/import_export/local-atlas-to-server.js` | CONFERIDO (backend) |
| S4 | **Duplicar um mapa não copia a configuração temporal.** A cópia nasce com os padrões e as feições copiadas mantêm as datas. | `frontend/src/js/map/map.manager.js` (copyMap) | CONFERIDO |
| I3 | **Ponto-chave de trajetória sem coordenada vira latitude e longitude zero.** A coerção numérica transforma nulo e texto vazio em zero, que passa na validação. A feição móvel atravessa o Atlântico na reprodução. O repositório já consertou esta mesma classe do lado da EXPORTAÇÃO. | `frontend/src/js/temporal/temporal-import.js` (sanitizeImportedTrajectory) | CONFERIDO |
| I2 | **Não há teto de plausibilidade no instante importado.** O GDH que o próprio produto escreve (010800MAR24) é lido como o ano 10800, e epoch em segundos vira janeiro de 1970. Com a janela do mapa em automático, uma célula assim estica a régua por milênios e as feições reais colapsam num pixel. | `frontend/src/js/temporal/temporal.utils.js` | CONFERIDO (node) |
| I5 | Célula temporal ilegível no CSV some duas vezes: não vira janela e não sobra como atributo, porque a coluna é reservada. O aviso de importação só conta coordenadas. | `frontend/src/js/import_export/csv/csv-to-geojson.js`, `frontend/src/js/import_export/csv/csv-config-panel.js` | RELATADO (confirmado por leitura) |
| I6 | A exportação KMZ descarta janela e trajetória sem nota de degradação, enquanto a importação KML lê tempo. | `frontend/src/js/import_export/kmz/kmz-feature-mapper.js` | RELATADO (varredura da pasta) |
| M5 | Data sem hora entra como meia-noite UTC e é exibida no dia anterior (2024-01-01 aparece como 31/12/2023). As duas grafias do mesmo instante pretendido ficam a três horas uma da outra. | `frontend/src/js/temporal/temporal.utils.js` | CONFERIDO (node) |

## 2. Trava, papel e apresentação: escrita que passa por onde não devia

| código | o que acontece | onde | estado |
|---|---|---|---|
| C2 | **A configuração temporal é gravável com o mapa TRAVADO.** A escrita pergunta só pelo papel; nenhum ponto do arquivo consulta a trava. O servidor também não cobre, porque a op tem o próprio mapa como alvo e o mapa não está na lista de alvos travavéis. Um Editor troca unidade e janela de um mapa que o dono travou. A página de wiki do módulo descreve este ponto errado nas duas direções (D1). | `frontend/src/js/store/temporal.operations.js` (writeMapTemporalConfig), `backend/src/modules/sync/sync.service.js` | CONFERIDO |
| S2 | **Reagendar num mapa travado não move feição nenhuma e desloca o Dia D e a janela para todos.** O deslocamento das feições é recusado, o retorno é ignorado e a nova origem é gravada na linha seguinte, incondicionalmente. Todo rótulo D+N passa a mentir pelo delta, e o aviso na tela diz que a escrita foi recusada. Reagendar também são DOIS lotes lógicos, não um. | `frontend/src/js/temporal/temporal-settings.modal.js` | CONFERIDO |
| V1 | **A barra temporal escapa do palco limpo da apresentação.** Ela não está no vocabulário de controles do slide nem nas regras que escondem controles ao apresentar. Num slide com temporal ligado a plateia arrasta o cursor, toca a reprodução e, pela engrenagem, chega ao Reagendar, que não tem desfazer. | `frontend/src/js/briefing/slide-controls.js`, `frontend/src/css/briefing/briefing-presentation.css` | CONFERIDO (ausência nas duas listas; o clique na engrenagem não foi testado) |
| V4 | O painel de marcador 3D e 360 oferece os campos de validade temporal editáveis a um Leitor e com o mapa travado. O valor digitado fica no campo depois de a escrita ser recusada. O painel 2D não constrói a seção nesses casos. | `frontend/src/js/3d_models_viewer_tool/components/marker-panel-3d.js`, `frontend/src/js/street_view_tool/components/marker-panel-360.js` | RELATADO |
| S10 | A engrenagem da barra não tem gate: o Leitor abre o modal e salva no vácuo, porque a recusa devolve nulo sem lançar e o modal fecha como se tivesse salvo. | `frontend/src/js/temporal/temporal-controller.js`, `frontend/src/js/temporal/temporal-settings.modal.js` | RELATADO |
| S6 | O servidor aceita qualquer valor na configuração temporal (unidade inventada, fim antes do início, tipos errados). A regra de validação casa um nome de campo aninhado que o cliente nunca envia: ele manda os seis campos soltos. | `backend/src/modules/sync/free-field.schemas.js` | RELATADO |
| S8 | O visitante de link público ainda transmite o estado temporal dele, e o servidor o retém e o entrega a quem entra depois. Ficou fora do corte do cursor feito em 2026-09-20. | `backend/src/modules/collab/collab.handlers.js` (handleTemporal), `frontend/src/js/presence/presence-bridge.js` | RELATADO |
| E12 | A caixa de GDH automático usa a propriedade disabled no modo relativo, que é estado reversível: o motivo nunca chega a quem tenta, e no toque o title não existe. E o gate é só de tela: uma feição que já tinha o GDH automático continua derivando GDH absoluto com o mapa em modo relativo. | `frontend/src/js/temporal/temporal-attributes-section.js` | RELATADO |

## 3. O mesmo instante, respostas diferentes

| código | o que acontece | onde | estado |
|---|---|---|---|
| M1 (= V6) | **O mapa 2D e as outras três superfícies decidem visibilidade por regras diferentes.** O filtro do mapa mostra a feição quando a janela dela TOCA a célula de meia unidade do cursor; o 3D, o 360 e a legenda do PDF testam só o instante. Com unidade HORA e cursor às 10:00, uma feição que começa às 10:20 aparece no mapa, some no 3D e no 360, e o PDF a imprime na folha e não a conta na legenda. Com unidade SEMANA a divergência chega a três dias e meio. | `frontend/src/js/temporal/temporal-controller.js` (janela do filtro), `frontend/src/js/layers/visibility-filter.js`, `frontend/src/js/temporal/temporal-model.js` | CONFERIDO |
| M6 (= E6 = I9) | **Fim anterior ao início não é validado em lugar nenhum** (painel, CSV, GeoJSON). A feição some para sempre do 3D, do 360 e da legenda do PDF, e pode continuar desenhada no mapa. Na config do MAPA a mesma inversão é consertada em silêncio na leitura (C4); na feição não há conserto nem aviso. | `frontend/src/js/temporal/temporal-attributes-section.js`, `frontend/src/js/temporal/temporal-import.js` | RELATADO (confirmado por execução em duas frentes) |
| M3 | O modo de revelar ocultas escurece feições que NÃO estão escondidas, porque monta o teste com o cursor cru e não com a célula do filtro. Como a expressão carrega o cursor, ela muda a cada quadro e repinta as camadas de feição inteiras por quadro de reprodução. | `frontend/src/js/temporal/temporal-render.service.js` | RELATADO |
| V7 | Revelar ocultas não alcança os marcadores 3D e 360 nem a legenda do PDF: o controlador não publica leitor desse modo. | `frontend/src/js/temporal/temporal-controller.js` | RELATADO |
| V3 | **Slide 3D ou 360 nunca fixa um instante**, embora o interruptor do slide valha para os três modos: a captura zera o cursor nos dois ramos não 2D. O conjunto de marcadores de um slide 3D depende do slide que veio antes. | `frontend/src/js/briefing/editor/briefing-editor.control.js`, `frontend/src/js/briefing/presentation/transition.service.js` | CONFERIDO (as duas atribuições nulas) |
| V9 | A captura do slide lê "o temporal está ligado" de duas fontes que divergem por uma volta assíncrona: o slide pode nascer com o temporal ligado e sem instante. | `frontend/src/js/briefing/editor/briefing-editor.control.js`, `frontend/src/js/briefing/screen-view.js` | RELATADO |
| V10 | Na transição entre slides de mapas diferentes o cursor é aparado contra os limites do mapa ANTERIOR e depois contra os do novo, e o slide apresenta o início da linha do tempo em vez do instante escolhido. | `frontend/src/js/temporal/temporal-controller.js`, `frontend/src/js/briefing/presentation/transition.service.js` | RELATADO (plausível; frequência não medida) |
| E7 | Mover a mesma feição com trajetória tem duas semânticas: no computador só o primeiro ponto-chave acompanha e a rota se deforma; no celular e no colar com deslocamento a rota inteira acompanha. | `frontend/src/js/temporal/trajectory-anchor.js`, `frontend/src/js/phone/phone-move-geometry.js`, `frontend/src/js/tool_manager/clipboard-offset.js` | RELATADO |
| E4 | Trocar no painel o instante de um ponto-chave para antes do primeiro muda quem é a âncora sem mover a geometria; a próxima interação no mapa teleporta a feição para a posição do ponto reordenado. | `frontend/src/js/temporal/temporal-attributes-section.js`, `frontend/src/js/temporal/trajectory-tool/trajectory-edit-control.js` | RELATADO |
| V11 | No editor de briefing, a caixa do interruptor é montada contra o mapa DO SLIDE e o efeito dela é aplicado ao mapa CORRENTE. | `frontend/src/js/briefing/editor/briefing-editor.control.js` | RELATADO (plausível) |

## 4. Estado que sobra, corrida e custo

| código | o que acontece | onde | estado |
|---|---|---|---|
| C1 | Os limites do último mapa com temporal ligado nunca são zerados. Ao trocar para um mapa com temporal desligado, a âncora de uma trajetória nova nasce numa data do OUTRO mapa, e a seção de validade mistura a config de um com os limites do outro. | `frontend/src/js/temporal/temporal-controller.js` | RELATADO (confirmado por leitura) |
| C3 | **Um limite configurado sozinho é descartado.** Com só o início preenchido e sem feição temporal, a resolução devolve nulo e o controlador inventa uma janela de 24 passos a partir de agora, recalculada a cada troca de visibilidade de camada: os rótulos da régua andam sozinhos. | `frontend/src/js/temporal/temporal.utils.js`, `frontend/src/js/temporal/temporal-controller.js` | CONFERIDO (node) |
| C4 | No modo absoluto, fim anterior ao início é gravado e sincronizado; a leitura conserta em silêncio e a régua mostra uma hora, enquanto o modal segue mostrando as datas invertidas. O modo relativo valida. | `frontend/src/js/temporal/temporal-settings.modal.js` | CONFERIDO (node) |
| M2 | **Sair de revelar ocultas apaga em silêncio as opacidades de camada ajustadas enquanto o modo estava ligado.** Dois módulos escrevem as mesmas propriedades de tinta e cada um guarda a "original" num cache próprio; o segundo tira o retrato já com o escurecimento por cima. O cache do modo também nunca é zerado, então depois de trocar o mapa base ele restaura uma expressão do estilo anterior. | `frontend/src/js/temporal/temporal-render.service.js`, `frontend/src/js/layers/layer-opacity-applier.js` | RELATADO (leitura dos dois módulos; gesto não executado) |
| S5 | Um snapshot no meio da sessão zera a config temporal em memória e nada avisa a tela, ao contrário da trava, que é reposta e anunciada no mesmo ponto. | `frontend/src/js/store/sync/remote-operation-handler.js` | RELATADO |
| S9 (= V2) | O instante temporal de um colega nunca sai da lista de online: nada é enviado quando ele desliga o temporal ou troca de mapa, e a lista não filtra por mapa. | `frontend/src/js/presence/presence-bridge.js`, `frontend/src/js/presence/online-users.control.js` | RELATADO |
| V5 | Sair da apresentação devolve o mapa base e o interruptor, e não devolve o cursor nem a reprodução: a pessoa volta presa no instante do último slide. | `frontend/src/js/briefing/presentation/transition.service.js` | RELATADO |
| E9 | Com o temporal desligado, marcar direção automática num símbolo reabre o portão da derivação e assa na imagem uma seta calculada com o cursor velho, porque o cursor não volta a não numérico no ramo desligado, ao contrário do que o comentário promete. | `frontend/src/js/temporal/temporal-derivation.service.js`, `frontend/src/js/temporal/temporal-controller.js` | RELATADO |
| E8 | Apagar o Início de um símbolo com GDH automático deixa o GDH antigo impresso no símbolo e gravado. | `frontend/src/js/temporal/temporal-attributes-section.js`, `frontend/src/js/store/feature.operations.js` | RELATADO |
| C11 | A sincronização do controlador chama a aplicação do estado FORA do guarda de concorrência e zera o cache de trajetória antes dos awaits, enquanto um quadro em voo ainda escreve na mesma fonte. | `frontend/src/js/temporal/temporal-controller.js` | RELATADO (plausível) |
| M7 | Toda mudança de camada paga três leituras completas de fonte mesmo com o temporal desligado, que é o caso da maioria dos mapas. | `frontend/src/js/temporal/temporal-controller.js`, `frontend/src/js/temporal/temporal-render.service.js` | RELATADO (custo não medido) |
| S12 | Op temporal que chega antes do mapa é gravada sob o identificador, que ninguém lê, e vira lixo que nenhuma exclusão alcança. | `frontend/src/js/store/sync/remote-operation-handler.js` | RELATADO (plausível) |
| C12 | Esc durante um Reagendar demorado fecha o modal, e o fim da operação lança por referência nula; com a confirmação aberta, Esc fecha os dois. | `frontend/src/js/temporal/temporal-settings.modal.js` | RELATADO |
| M8 | A interpolação de trajetória atravessa o globo no antimeridiano. Não alcançável em operação no Brasil. | `frontend/src/js/temporal/temporal-model.js` | RELATADO (node) |
| M11 | Data anterior ao ano 1000 quebra o campo de edição. | `frontend/src/js/temporal/temporal.utils.js` | RELATADO (node) |

## 5. Uso, toque e o que a tela não diz

| código | o que acontece | onde | estado |
|---|---|---|---|
| E5 | **No toque, o editor de trajetória só REMOVE ponto-chave.** Mover e inserir dependem de eventos de mouse, que não chegam de um dedo; é a mesma migração para ponteiro que as ferramentas de desenho já fizeram. | `frontend/src/js/temporal/trajectory-tool/trajectory-edit-control.js` | RELATADO |
| E3 | Clicar no ponto médio para inserir um ponto-chave grava o ponto e, no mesmo gesto, desseleciona a feição e fecha o painel, porque o clique não anda o bastante para cair na regra de fim de arrasto de 2026-09-20. | `frontend/src/js/tool_manager/selection_manager.js`, `frontend/src/js/temporal/trajectory-tool/trajectory-edit-control.js` | RELATADO (plausível; a tentativa de reproduzir falhou no preparo) |
| C5 | A velocidade é em unidades por segundo real. Um exercício de três dias com unidade Minuto leva mais de sete minutos no máximo; um de quatro semanas com unidade Semana termina em dois quadros. | `frontend/src/js/temporal/temporal-controller.js`, `frontend/src/js/temporal/temporal.constants.js` | RELATADO (aritmética) |
| C10 | A barra some atrás do 3D e do 360 enquanto a reprodução continua filtrando os marcadores: não há como pausar, ver o instante nem mover o cursor sem fechar o visualizador. | `frontend/src/css/temporal.css`, `frontend/src/css/panels-3d.css`, `frontend/src/css/panels-360.css` | RELATADO |
| V8 | **O PDF exportado com o temporal ligado não diz em lugar nenhum qual instante retrata.** Numa carta, é recorte de dado sem declaração. | `frontend/src/js/import_export/pdf-cartographic-elements.js` | RELATADO |
| C7 | O arraste do cursor não trata cancelamento de ponteiro nem filtra botão: no toque, um gesto cancelado deixa qualquer movimento da página arrastando o cursor até recarregar. | `frontend/src/js/temporal/temporal-timeline-bar.js` | RELATADO (plausível para o toque) |
| C8 | A régua se declara slider sem mínimo e máximo, só aceita as setas, e o clique não lhe dá foco, então as setas que o tutorial ensina só funcionam chegando por Tab. | `frontend/src/js/temporal/temporal-timeline-bar.js` | RELATADO |
| E11 | Os campos de data do painel usam mínimo e máximo para "destacar" a janela, e o efeito é RESTRINGIR o calendário à extensão das feições existentes. | `frontend/src/js/temporal/temporal-attributes-section.js` | RELATADO |
| M10 | O instante final da reprodução esconde feições que o quadro anterior mostrava. | `frontend/src/js/temporal/temporal-controller.js` | RELATADO |
| I8 | A lista de propriedades de sistema conhece 8 dos 26 nomes de coluna temporal que a importação reconhece: as mesmas colunas viram janela E continuam como atributo do usuário. | `frontend/src/js/user_data/user_data_manager.js` | RELATADO |
| C9 | A barra publica a própria altura numa variável que não tem consumidor nenhum. | `frontend/src/js/temporal/temporal-timeline-bar.js` | RELATADO (varredura) |

## 6. Testes que passam sem prender

| código | o que o verde não prova | onde |
|---|---|---|
| C6 | Três dos quatro casos da única suíte de interface do temporal afirmam só o rótulo do próprio botão: reprodução que não avança, velocidade que não chega ao controlador e revelar que não revela passariam verdes. | `frontend/tests/e2e-ui/temporal-local.spec.js` |
| E10 | Dois casos que se anunciam como edição de trajetória e derivação de GDH não executam esse código, e o formato de GDH que afirmam não é o que o produto produz. | `frontend/tests/e2e-ui/browser-temporal-advanced.spec.js` |
| S7 | O único guarda e2e da coluna temporal congela como contrato valores que nenhum cliente produz (datas em texto, modo inexistente). Consertar S6 o reprovaria. | `frontend/tests/e2e/temporal-mapconfig.e2e.test.js` |
| M9 | A propriedade da interpolação só exige cair na caixa envolvente, o que aprova o trajeto errado do antimeridiano; o teste do filtro afirma só a forma da expressão; nenhum teste põe as duas regras de visibilidade na mesma asserção, que é o que manteve M1 e M6 invisíveis. | `frontend/tests/unit/temporal-model.test.js`, `frontend/tests/unit/visibility-temporal-filter.test.js` |
| I10 | O teste de importação compara datas contra o mesmo parse que está sob teste, só exercita não numérico nas coordenadas, e não cobre chaves concorrentes, cuja precedência hoje é a ordem de inserção do objeto. | `frontend/tests/unit/temporal-import.test.js` |
| S11 | O teste da migração para 2.2 nunca executa a migração. A migração está correta; falta o vermelho que a prenderia. | `frontend/tests/unit/temporal-migration.test.js` |

## 7. Documentação contra código

| código | divergência | onde |
|---|---|---|
| D1 | A seção de permissão da página do módulo está errada nas duas pontas: diz que a escrita da config não tem guarda (tem, de papel) e que a proteção contra mapa travado é um botão desabilitado (ele nunca é desabilitado desde 2026-09-20). O buraco real, que ela não nomeia, é o C2. | `docs/wiki/modulo-temporal.md` |
| D2 | O tutorial não documenta nada da importação temporal: a seção de colunas de tempo do CSV, o KML com tempo, e sobretudo que um GPX ou KML cronometrado deixa de ser linha e vira PONTO MÓVEL. | `frontend/public/docs/README.md` |
| D3 | O tutorial lista a engrenagem como cinco campos fixos; dois só existem no modo Relativo e dois mudam de rótulo. | `frontend/public/docs/README.md` |
| D4 | O tutorial não menciona que Salvar Posição do slide guarda o instante da linha do tempo (só em slide 2D) nem que ele é reposto ao apresentar. | `frontend/public/docs/README.md` |
| E9 (parte) | O tutorial promete direção e velocidade automáticas também para medida de coordenação; o código só lhe oferece o GDH automático. | `frontend/public/docs/README.md` |

## 8. O que foi conferido e está são

Quantização, aparo e conversão cursor-fração; ticks da régua, inclusive faixa degenerada; busca binária da trajetória nas bordas, com instante duplicado devolvendo zero em vez de infinito; rótulos D+N sem "D-0" espúrio; derivação de direção e velocidade de fato só imagem, sem escrita em fonte nem store; escrita de propriedade passando por gate e por transação; liberação de inscrição do painel nos três hospedeiros; reprodução em aba de fundo e depois de pausa longa, parada no fim e rebobinagem; destruição do controlador; ouvintes do 3D e do 360 sem duplicata nem órfão; convergência das quatro superfícies em "tudo visível" com o temporal desligado; a imagem do PDF refletindo filtro e trajetória nos dois motores; o slide com interruptor nulo herdando o salvo do mapa; a migração para 2.2 recebendo o escopo e idempotente; o `.ebgeo` e o envio de atlas local levando a config por mapa, inclusive no import aditivo, que não sobrescreve a config do destino; a exclusão de mapa removendo a chave temporal com a guarda de homônimo certa; a troca de atlas zerando a vista fixada; e o anúncio temporal na entrada do mapa, de 2026-09-21, que nenhum consumidor recebe mal.

## 9. Ordem sugerida de ataque

1. **Perda de dado por gesto comum:** S1, E1, S4, E2. Renomear, converter e duplicar são gestos de todo dia.
2. **Importação que corrompe calada:** M4, M5, I2, I3, I5, com M6 no mesmo passo, porque todas moram no mesmo leitor de datas e no mesmo caminho de import.
3. **Trava e apresentação:** C2 e S2 juntos (o mesmo gate que falta), depois V1 e V4.
4. **Uma regra de visibilidade só:** M1, e atrás dela M3, V7 e V8.
5. **Briefing:** S3, V3, V5, V9, V10.
6. **Estado que sobra:** C1, C3, C4, M2, S5, S9.
7. **Toque e uso:** E5, E3, C5, C10, C7, C8.
8. **Testes e documentação**, no commit de cada conserto: o teste que não prendia vira o repro do bug que deixou passar.
