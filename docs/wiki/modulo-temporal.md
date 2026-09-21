# Módulo temporal (linha do tempo)

Dimensão de tempo por mapa: a config é estado compartilhado com LWW, o interruptor, o cursor e a reprodução são estritamente locais por usuário, e as lentes de exibição nunca movem os tempos das feições.

## A tripartição que não pode se misturar

Três categorias com donos diferentes, e confundi-las é o erro estrutural do módulo:

1. **Dado canônico, por feição, viaja no sync:** `temporalInicio`/`temporalFim` (ausente = permanente) e `trajetoria`.
2. **Config por mapa, compartilhada, LWW:** `DEFAULT_TEMPORAL_CONFIG` (`frontend/src/js/temporal/temporal.constants.js`). `modo`, `unidade` e `origem` são **lentes de exibição**: mudá-las só re-rotula a régua.
3. **Estado local por usuário, nunca persistido nem sincronizado:** cursor, `playing`, velocidade e modo revelar vivem apenas em campos do controller (`frontend/src/js/temporal/temporal-controller.js`). São análogos a pan/zoom. **Desde 2026-09-20 o LIGA/DESLIGA também mora aqui**, em `memoryStore.temporalView`: o `ativo` que continua dentro da config da categoria 2 deixou de ser o interruptor e passou a ser o valor SALVO com a vista do mapa, escrito só pelo gesto de salvar posição. São dois valores com o mesmo nome de campo, e a armadilha que isso cria (o payload da config tem de levar o salvo, nunca o da tela) está em [[vista-da-pessoa-e-vista-salva]].

A única forma de mover tempos de feição é a ação explícita "Reagendar". Se você se pegar escrevendo `temporalInicio` ao trocar `unidade` ou `origem`, está errado.

## Sync da config: o UUID é obrigatório

A config é gravada localmente sob `temporal_<nomeDoMapa>`, mas a op de sync é uma *map setting* cujo `entityId` é o **UUID do mapa**. `createMapSettingLogger` descarta silenciosamente qualquer op com `mapId` não-UUID (`frontend/src/js/store/sync/operation-dispatcher.js`), porque um `mapId` inválido faz o backend derrubar o **lote inteiro** do flush. Por isso `setMapTemporalConfig` resolve o id pelo `mapManager` antes de logar (`frontend/src/js/store/temporal.operations.js`); logar o nome fazia toda a sincronização temporal sumir sem nenhum erro visível.

Consequência de projeto, e é o comportamento correto: o mapa local `Principal`, chaveado por nome (ver [[dominio-local-vs-remoto]]), **nunca** propaga config temporal.

No inbound, o handler resolve UUID → nome antes de gravar, porque o armazenamento local é chaveado por nome, e **persiste** antes de emitir (ramo `MAP_TEMPORAL` de `frontend/src/js/store/sync/remote-operation-handler.js`). Emitir sem persistir faria o par "piscar" a mudança e voltar atrás no próximo boot: mesma classe de bug do layer. Ver [[aplicacao-operacoes-remotas]], [[snapshot-e-pull-incremental]], [[tipos-entidade-sync]] e [[envelope-operacao]].

Conflito é LWW por ordem de chegada, e a granularidade é o **objeto de config inteiro**, não por campo: dois usuários trocando `unidade` e `inicio` ao mesmo tempo perdem um dos patches por completo. Ver [[modelo-conflito-lww]].

**A armadilha do nome, resolvida em 2026-08-14.** O P11 reprovava exatamente nesta comparação, e a suspeita natural (a op não sai da fila, ou o par não a aplica) estava errada nos dois extremos. O rastro ordenado dentro do navegador mostrou o snapshot **gravando** `temporal_<nome>` e, logo em seguida, `activateAtlasInitialMap` (`frontend/src/js/store/map.operations.js`) apagando o mapa local homônimo `Principal`, cujo `deleteMap` removia sem condição os laterais chaveados por nome, `temporal_<nome>` e `mapLocked_<nome>`. Como esses laterais pertencem a **quem responde por aquele nome**, e não ao registro que estava sendo apagado, a config recém-chegada do atlas morria microssegundos depois de nascer. A grade sobreviveu ao mesmo delete por ser chaveada por id (`gridStyle_<id>`), e foi essa assimetria que apontou a causa. A guarda agora vive em `frontend/src/js/store/repositories/local.repository.js`: a remoção por nome só roda quando nenhum outro registro de mapa ainda carrega aquele nome. Regressão com controle negativo em `frontend/tests/integration/temporal-config-stray-delete.repro.test.js`, 3/3 com a guarda, 2 falham sem ela. Lição que vale para qualquer lateral por nome: o cadeado de mapa corria o mesmo risco e só não aparecia porque `memoryStore.lockedMaps` segura o comportamento na sessão.

## O instante é de cada pessoa, e não viaja

Desde 2026-09-21 (decisão P1 do dono) o cursor da linha do tempo **não viaja**: a presença diz se a pessoa está no mapa ou não, e o instante é visualização de cada um, como já eram o ligar e desligar, a reprodução e a velocidade desde 2026-09-20. Até aquela data o cliente mandava o cursor e um rótulo curto já formatado (ex.: "D+3") num quadro próprio de presença, o servidor o retinha no socket e a lista de online o escrevia sob o nome do colega; o quadro, o tratador, a retenção e o rótulo saíram dos dois pacotes, e dois guardas estruturais (`frontend/tests/unit/presenca-temporal-nao-volta.test.js` e `backend/tests/unit/presenca-temporal-nao-volta.test.js`) reprovam a volta. O que continua no barramento local é `TEMPORAL_CURSOR_CHANGED`, que o 3D, o 360 e a derivação ouvem. Ver [[presenca-colaborativa]].

## Custos escondidos do render

- **Nunca use o cursor cru no filtro de visibilidade.** Rebuild de filtro é caro, então a janela é quantizada ao sub-passo da unidade antes de ir para o filtro; `TEMPORAL_RENDER_SUBSTEPS` é o botão desse trade-off (`frontend/src/js/temporal/temporal.constants.js`). Trocar a janela quantizada pelo cursor cru "para ficar preciso" reconstrói filtro em todo rAF.
- **Nunca persista direção/velocidade derivadas.** `autoDirection`/`autoSpeed` regeneram só o PNG do símbolo. O motivo não é apenas preservar o valor autoral: escrever na fonte GeoJSON correria contra a passada de geometria por frame que desloca o símbolo na trajetória. Já `autoDtg` é o oposto, deriva valores canônicos persistidos e viaja como `FEATURE_MODIFIED` (`frontend/src/js/store/feature.operations.js`).
- Rotação do símbolo permanece 100% manual, nunca dirigida pela trajetória.
- Modo revelar suprime a cláusula de ocultamento (`frontend/src/js/layers/visibility-filter.js`) e apenas esmaece, para que feições fora da janela continuem editáveis. É visualização local, não altera dado nenhum.

## Reagendar

Move o Dia D mantendo os offsets D+N. Ação confirmada e **não desfazível**.

**Não existe endpoint de reagendamento em lote.** `shiftMapTemporalTimes` (`frontend/src/js/store/feature.operations.js`) faz tudo no cliente e emite **uma op `feature` UPDATE por feição afetada**; a atomicidade é só a do `runTransaction` local (um único persist). Quem esperar uma operação atômica no servidor com broadcast em lote está desenhando contra algo que não existe.

**São DUAS metades, e a segunda é condicional à primeira** (corrigido em 2026-09-21). Reagendar desloca as feições E grava o novo Dia D com a janela deslocada. Até aquela data o modal pedia o deslocamento, IGNORAVA o retorno e gravava a origem na linha seguinte: num mapa travado nenhuma feição andava, a origem andava, todo rótulo D+N passava a mentir pelo delta, e o aviso na tela dizia que a escrita tinha sido recusada. A composição virou `rescheduleMapTemporal` (`frontend/src/js/store/temporal.operations.js`), que lê o retorno antes de gravar. Zero feições deslocadas tem DUAS causas e elas decidem o contrário: mapa sem nada cronometrado (a origem anda, porque mover D ali é só trocar a lente) e escrita recusada (a origem não anda). Quem separa as duas é `hadCandidates`, e a decisão é pura, em `frontend/src/js/temporal/temporal-settings.model.js`.

**E as duas metades são UM lote lógico.** Elas não cabem numa transação (o deslocamento toma a trava do documento do mapa e a config toma a do documento lateral, e aquela fila é FIFO sem reentrância), então o que as une é `withGestureBatch`: o servidor aplica ou recusa as duas juntas. Sem isso, o disparo de 1,5 s da fila caindo entre elas manda as ops de feição sozinhas, e o par recebe o exercício deslocado com o Dia D antigo. Ver [[fila-operacoes-outbound]].

Implicações a comunicar ao usuário: um par editando a mesma feição durante o reagendamento pode ganhar o LWW e ficar com a janela antiga; e reagendar mapa grande enfileira N ops. Ver [[fila-operacoes-outbound]].

## Permissão e trava: o gate é do CLIENTE, e é ele que tem de existir

Esta seção afirmou o contrário até 2026-09-21, nas duas pontas: dizia que a escrita da config não tinha guarda nenhuma (tinha, de papel, desde antes) e que a proteção contra mapa travado era um botão `disabled` na aba de mapas, que não existe desde 2026-09-20, quando a casa passou a desenhar o comando bloqueado por ESTADO e recusar o clique nomeando o estado. O buraco real, que ela não nomeava, era a trava faltando no caminho de escrita.

**A regra por categoria segue a tripartição de cima, e as três respostas são diferentes.**

- **Escrita da config (categoria 2):** `writeMapTemporalConfig` (`frontend/src/js/store/temporal.operations.js`), a porta única por onde passam `setMapTemporalConfig` e `setMapTemporalSaved`, pergunta por PAPEL (`checkPermission` com a ação de editar mapa) e, desde 2026-09-21, pela TRAVA. Recusa é falha esperada: emite `STORE_OPERATION_BLOCKED` e devolve `null`, sem lançar. É a mesma forma de `setBaseLayer` e `renameMap`.
- **Deslocamento de feição (categoria 1):** `shiftMapTemporalTimes` (`frontend/src/js/store/feature.operations.js`) passa por `guardWrite`, que já perguntava pelos dois eixos.
- **Interruptor, cursor e reprodução (categoria 3):** `setMapTemporalView` e `toggleMapTemporal` **não perguntam nada, de propósito**. São vista da pessoa, como pan e zoom: não gravam, não enfileiram op, e por isso um Leitor e um mapa travado mantêm a linha do tempo na tela. Ver [[vista-da-pessoa-e-vista-salva]].

**A TRAVA SE PERGUNTA AO DISCO, e a forma síncrona daria a resposta errada.** O gate usa `isMapLocked`, que lê o app setting; `memoryStore.lockedMaps` só é completo em atlas de SERVIDOR, porque em atlas local apenas o mapa corrente chega a entrar nele. Perguntar ao conjunto sobre outro mapa responde "destravado" sobre um mapa travado, calado, e é exatamente a metade do produto onde ninguém procura defeito de trava.

**O SERVIDOR NÃO COBRE ESTA OP, e por isso o cliente é o único ponto de imposição.** `lockedMapDenialReason` (`backend/src/modules/sync/sync.service.js`) recusa escrita em mapa travado só quando o alvo está em `LOCKABLE_CHILD_TARGETS`, e a op `mapTemporal` tem o próprio mapa como alvo, que não está na lista. Um cliente modificado escreve por cima da trava. A mesma frase vale para `baseLayer`, `mapPosition`, `gridStyle` e notas. Ver [[permissoes-atlas]].

## Limites conhecidos, abertos em 2026-09-21

**N1, N2, N3 e N5 foram fechados no mesmo dia** (entrada própria no diário de decisões) e saíram desta lista; a numeração dos que ficam não foi refeita, para o código continuar valendo como referência.

Sobraram da execução da auditoria do módulo (registro em [`../decisions/decisions-2026.md`](../decisions/decisions-2026.md), entrada de 2026-09-21). Nenhum é defeito esquecido: cada um pede decisão de desenho ou de contrato, e por isso ficou escrito em vez de consertado.

- **N3 (o que sobrou dele).** Ajuste do próprio mapa em mapa travado (config temporal, mapa base, posição, grade, notas e o nome) é CONVENÇÃO DE CLIENTE, por decisão do dono: o servidor só tranca os alvos FILHOS do mapa (`LOCKABLE_CHILD_TARGETS`), e um cliente modificado escreve por cima. Todo caminho de escrita do cliente pergunta pela trava AO DISCO, e `frontend/tests/unit/ajuste-de-mapa-pergunta-pela-trava.test.js` reprova o sub-tipo novo que nascer sem a pergunta.
- **N4.** A barra temporal continua invisível dentro do 3D e do 360. O que mudou é que a reprodução pausa ao entrar, em vez de correr escondida.
- **N6.** Epoch em SEGUNDOS continua lido como milissegundos na importação (cai em janeiro de 1970, dentro da faixa plausível). Recusá-lo exigiria um piso acima de 1970, que reprovaria data legítima do século XX.
- **N7.** Os nomes que a importação consome como tempo (início, fim, date, time e afins) ficaram fechados também para atributo criado à mão. É coerente com a importação, e fecha vocabulário plausível para o usuário.
- **N8.** A edição da JANELA de validade no painel segue sem desfazer: ela dispara uma segunda escrita (o GDH derivado) e meio desfazer custa mais que nenhum. A condição para acender está escrita em `frontend/src/js/temporal/temporal-attributes-section.js`.
- **N9.** O cliente aceita localmente uma unidade fora do vocabulário em `setMapTemporalConfig`; o servidor a saneia, e autor e servidor divergem até o próximo retrato. Nenhum caminho de tela produz esse valor.
- **N10.** A posição do selo de instante na folha única do PDF não foi medida em pixel; o texto, o desenho no mosaico, a capa e a fiação estão presos por teste.
- **N12.** `mapResolver.isInitialized` é FALSO num atlas de servidor recém-aberto (medido em 2026-09-21): isso desliga a via rápida de nome para id de `LocalRepository.getMap`, e qualquer estado em que `memoryStore.currentMap` nomeie um mapa cujo registro no disco atenda por outro nome faz a escrita cunhar um mapa FANTASMA, em silêncio, com a op morrendo na fila. Foi o que transformou o rename remoto (N1) em perda de dado. O gatilho conhecido foi removido; a fragilidade continua, e o conserto mora no resolvedor e no repositório local.
- **N11.** O antimeridiano: a interpolação de trajetória caminha em longitude e latitude cruas, então um trecho que cruze os 180 graus dá a volta pelo lado errado. Fora do plano por custo, porque não é alcançável em operação no Brasil; a propriedade de colinearidade de `frontend/tests/unit/temporal-model.test.js` aprova esse trajeto, e o teste diz isso.

## Acoplamentos que atravessam arquivos

- **Viewers 3D/360** filtram marcadores pelo cursor. Por isso o controller emite `TEMPORAL_CURSOR_CHANGED` logo após resolver o cursor no sync (`frontend/src/js/temporal/temporal-controller.js`): sem isso, ao habilitar o temporal eles filtrariam com cursor `NaN`, já que `MAP_TEMPORAL_CHANGED` dispara antes.
- **Briefing:** `setCursor` tolera ser chamado antes de os bounds existirem (slide restaura o cursor antes do sync async terminar) e guarda o valor para o próximo sync. A reprodução é parada ao entrar em apresentação, para o cursor não derivar entre slides. Ver [[modos-operacao]].
- **Importação:** dados temporais viajam como propriedades comuns, sem evento dedicado. `decimateTrajectory` descarta detalhe abaixo da resolução da régua, cujo passo mais fino é um minuto (`frontend/src/js/temporal/temporal-model.js`). Ver [[formato-ebgeo-roundtrip]].
- **Observabilidade:** `TEMPORAL_CURSOR_CHANGED` é evento por frame e é explicitamente ignorado pelo tap do ledger (`frontend/src/js/store/sync/diag/bus-tap.js`). Ver [[syncledger]].

**A lista autoritativa da config é `DEFAULT_TEMPORAL_CONFIG`, e são seis campos.** O JSDoc de `frontend/src/js/store/temporal.operations.js` já descreveu quatro, omitindo `modo` e `origem`, que são justamente os dois que confundem: os dois são lente de EXIBIÇÃO e nunca mutam o tempo da feição.
