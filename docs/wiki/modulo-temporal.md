# Módulo temporal (linha do tempo)

Dimensão de tempo por mapa: a config é estado compartilhado com LWW, o cursor e a reprodução são estritamente locais por usuário, e as lentes de exibição nunca movem os tempos das feições.

## A tripartição que não pode se misturar

Três categorias com donos diferentes, e confundi-las é o erro estrutural do módulo:

1. **Dado canônico, por feição, viaja no sync:** `temporalInicio`/`temporalFim` (ausente = permanente) e `trajetoria`.
2. **Config por mapa, compartilhada, LWW:** `DEFAULT_TEMPORAL_CONFIG` (`frontend/src/js/temporal/temporal.constants.js:49-56`). `modo`, `unidade` e `origem` são **lentes de exibição**: mudá-las só re-rotula a régua.
3. **Estado local por usuário, nunca persistido nem sincronizado:** cursor, `playing`, velocidade e modo revelar vivem apenas em campos do controller (`frontend/src/js/temporal/temporal-controller.js:55-67`). São análogos a pan/zoom.

A única forma de mover tempos de feição é a ação explícita "Reagendar". Se você se pegar escrevendo `temporalInicio` ao trocar `unidade` ou `origem`, está errado.

## Sync da config: o UUID é obrigatório

A config é gravada localmente sob `temporal_<nomeDoMapa>`, mas a op de sync é uma *map setting* cujo `entityId` é o **UUID do mapa**. `createMapSettingLogger` descarta silenciosamente qualquer op com `mapId` não-UUID (`frontend/src/js/store/sync/operation-dispatcher.js:260-274`), porque um `mapId` inválido faz o backend derrubar o **batch inteiro** do flush. Por isso `setMapTemporalConfig` chama `getMapId(target)` (`frontend/src/js/store/temporal.operations.js:107`); logar o nome fazia toda a sincronização temporal sumir sem nenhum erro visível.

Consequência de projeto, e é o comportamento correto: o mapa local `Principal`, chaveado por nome (ver [[dominio-local-vs-remoto]]), **nunca** propaga config temporal.

No inbound, o handler resolve UUID → nome antes de gravar, porque o armazenamento local é chaveado por nome, e **persiste** antes de emitir (`frontend/src/js/store/sync/remote-operation-handler.js:903-918`). Emitir sem persistir faria o par "piscar" a mudança e voltar atrás no próximo boot: mesma classe de bug do layer. Ver [[aplicacao-operacoes-remotas]], [[snapshot-e-pull-incremental]], [[tipos-entidade-sync]] e [[envelope-operacao]].

Conflito é LWW por ordem de chegada, e a granularidade é o **objeto de config inteiro**, não por campo: dois usuários trocando `unidade` e `inicio` ao mesmo tempo perdem um dos patches por completo. Ver [[modelo-conflito-lww]].

## O instante do outro é awareness, não comando

O cursor viaja como presença, não como dado. O payload leva o cursor **e** um rótulo curto já formatado (ex.: "D+3"), justamente para o par renderizar sem conhecer a config temporal do remetente (`frontend/src/js/presence/presence-bridge.js:268-285`). Regra prática: nunca reagir a uma mensagem `temporal` de presença movendo o próprio cursor. Ver [[presenca-colaborativa]].

## Custos escondidos do render

- **Nunca use o cursor cru no filtro de visibilidade.** Rebuild de filtro é caro, então a janela é quantizada ao sub-passo da unidade antes de ir para o filtro; `TEMPORAL_RENDER_SUBSTEPS` é o botão desse trade-off (`frontend/src/js/temporal/temporal.constants.js:90-99`). Trocar a janela quantizada pelo cursor cru "para ficar preciso" reconstrói filtro em todo rAF.
- **Nunca persista direção/velocidade derivadas.** `autoDirection`/`autoSpeed` regeneram só o PNG do símbolo. O motivo não é apenas preservar o valor autoral: escrever na fonte GeoJSON correria contra a passada de geometria por frame que desloca o símbolo na trajetória. Já `autoDtg` é o oposto, deriva valores canônicos persistidos e viaja como `FEATURE_MODIFIED` (`frontend/src/js/store/feature.operations.js:625-641`).
- Rotação do símbolo permanece 100% manual, nunca dirigida pela trajetória.
- Modo revelar suprime a cláusula de ocultamento (`frontend/src/js/layers/visibility-filter.js:82-83`) e apenas esmaece, para que feições fora da janela continuem editáveis. É visualização local, não altera dado nenhum.

## Reagendar

Move o Dia D mantendo os offsets D+N. Ação confirmada e **não desfazível**.

> **Nota histórica.** O guia *acoes-interface-multiusuario* (absorvido) §29 item 12 descrevia o reagendamento como "operação atômica no servidor + broadcast em batch". O código faz tudo no cliente: `frontend/src/js/store/feature.operations.js:687-693` emite **uma op `feature` UPDATE por feição afetada**. Não existe endpoint de reagendamento em lote, e a atomicidade é só a do `runTransaction` local (um único persist).

Implicações a comunicar ao usuário: um par editando a mesma feição durante o reagendamento pode ganhar o LWW e ficar com a janela antiga; e reagendar mapa grande enfileira N ops. Ver [[fila-operacoes-outbound]].

## Permissão: a guarda é só visual

`shiftMapTemporalTimes` passa por `guardWrite` (`frontend/src/js/store/feature.operations.js:657`), mas `setMapTemporalConfig` e `toggleMapTemporal` **não têm guarda de escrita nem de bloqueio de mapa**. A proteção contra mapa bloqueado é apenas o botão `disabled` no card (`frontend/src/js/sidebar/tabs/maps.tab.js:490-497`): qualquer outro caminho de chamada (script, atalho, código novo) contorna a restrição. Ver [[permissoes-atlas]].

## Acoplamentos que atravessam arquivos

- **Viewers 3D/360** filtram marcadores pelo cursor. Por isso o controller emite `TEMPORAL_CURSOR_CHANGED` logo após resolver o cursor no sync (`frontend/src/js/temporal/temporal-controller.js:248-252`): sem isso, ao habilitar o temporal eles filtrariam com cursor `NaN`, já que `MAP_TEMPORAL_CHANGED` dispara antes.
- **Briefing:** `setCursor` tolera ser chamado antes de os bounds existirem (slide restaura o cursor antes do sync async terminar) e guarda o valor para o próximo sync. A reprodução é parada ao entrar em apresentação, para o cursor não derivar entre slides. Ver [[modos-operacao]].
- **Importação:** dados temporais viajam como propriedades comuns, sem evento dedicado. `decimateTrajectory` descarta detalhe abaixo da resolução da régua, cujo passo mais fino é um minuto (`frontend/src/js/temporal/temporal-model.js:172-183`). Ver [[formato-ebgeo-roundtrip]].
- **Observabilidade:** `TEMPORAL_CURSOR_CHANGED` é evento por frame e é explicitamente ignorado pelo tap do ledger (`frontend/src/js/store/sync/diag/bus-tap.js:11`). Ver [[syncledger]].

> [!CONTRADICAO 2026-07-18] O JSDoc de `frontend/src/js/store/temporal.operations.js:9,25` ainda descreve a config como `{ativo, unidade, inicio, fim}`, sem `modo` e `origem`. O formato real é o de `DEFAULT_TEMPORAL_CONFIG` (`frontend/src/js/temporal/temporal.constants.js:49-56`).

## Fontes
- Guia *acoes-interface-multiusuario* (absorvido) §29: matriz das 20 ações temporais com classificação local vs compartilhada, e a descrição do reagendamento que diverge do código.
- Código (autoritativo): `src/js/temporal/`, `frontend/src/js/store/temporal.operations.js`, `frontend/src/js/store/feature.operations.js`, `src/js/store/sync/{operation-dispatcher,remote-operation-handler}.js`, `frontend/src/js/presence/presence-bridge.js`, `frontend/src/js/layers/visibility-filter.js`.
