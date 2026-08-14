# Módulo temporal (linha do tempo)

Dimensão de tempo por mapa: a config é estado compartilhado com LWW, o cursor e a reprodução são estritamente locais por usuário, e as lentes de exibição nunca movem os tempos das feições.

## A tripartição que não pode se misturar

Três categorias com donos diferentes, e confundi-las é o erro estrutural do módulo:

1. **Dado canônico, por feição, viaja no sync:** `temporalInicio`/`temporalFim` (ausente = permanente) e `trajetoria`.
2. **Config por mapa, compartilhada, LWW:** `DEFAULT_TEMPORAL_CONFIG` (`frontend/src/js/temporal/temporal.constants.js`). `modo`, `unidade` e `origem` são **lentes de exibição**: mudá-las só re-rotula a régua.
3. **Estado local por usuário, nunca persistido nem sincronizado:** cursor, `playing`, velocidade e modo revelar vivem apenas em campos do controller (`frontend/src/js/temporal/temporal-controller.js`). São análogos a pan/zoom.

A única forma de mover tempos de feição é a ação explícita "Reagendar". Se você se pegar escrevendo `temporalInicio` ao trocar `unidade` ou `origem`, está errado.

## Sync da config: o UUID é obrigatório

A config é gravada localmente sob `temporal_<nomeDoMapa>`, mas a op de sync é uma *map setting* cujo `entityId` é o **UUID do mapa**. `createMapSettingLogger` descarta silenciosamente qualquer op com `mapId` não-UUID (`frontend/src/js/store/sync/operation-dispatcher.js`), porque um `mapId` inválido faz o backend derrubar o **lote inteiro** do flush. Por isso `setMapTemporalConfig` resolve o id pelo `mapManager` antes de logar (`frontend/src/js/store/temporal.operations.js`); logar o nome fazia toda a sincronização temporal sumir sem nenhum erro visível.

Consequência de projeto, e é o comportamento correto: o mapa local `Principal`, chaveado por nome (ver [[dominio-local-vs-remoto]]), **nunca** propaga config temporal.

No inbound, o handler resolve UUID → nome antes de gravar, porque o armazenamento local é chaveado por nome, e **persiste** antes de emitir (ramo `MAP_TEMPORAL` de `frontend/src/js/store/sync/remote-operation-handler.js`). Emitir sem persistir faria o par "piscar" a mudança e voltar atrás no próximo boot: mesma classe de bug do layer. Ver [[aplicacao-operacoes-remotas]], [[snapshot-e-pull-incremental]], [[tipos-entidade-sync]] e [[envelope-operacao]].

Conflito é LWW por ordem de chegada, e a granularidade é o **objeto de config inteiro**, não por campo: dois usuários trocando `unidade` e `inicio` ao mesmo tempo perdem um dos patches por completo. Ver [[modelo-conflito-lww]].

> [!CONTRADICAO 2026-08-14] Esta seção descreve a config como estado compartilhado que chega ao par, e o E2E de round-trip P11 (`frontend/tests/e2e-ui/browser-p11-roundtrip.spec.js`, a comparação de temporal por mapa) reprova: o que A liga pelo relógio da aba Mapas não aparece no atlas que B abre do servidor. O spec foi deixado **vermelho de propósito**, com a expectativa intacta, porque o comportamento antigo é que é o defeito; o lado do servidor foi conferido elo a elo e está correto. A causa no cliente ainda não foi localizada, então quem for consertar começa medindo se a op sai da fila (ver [[syncledger]]) antes de suspeitar do inbound.

## O instante do outro é awareness, não comando

O cursor viaja como presença, não como dado. O payload leva o cursor **e** um rótulo curto já formatado (ex.: "D+3"), justamente para o par renderizar sem conhecer a config temporal do remetente (`frontend/src/js/presence/presence-bridge.js`). Regra prática: nunca reagir a uma mensagem `temporal` de presença movendo o próprio cursor. Ver [[presenca-colaborativa]].

## Custos escondidos do render

- **Nunca use o cursor cru no filtro de visibilidade.** Rebuild de filtro é caro, então a janela é quantizada ao sub-passo da unidade antes de ir para o filtro; `TEMPORAL_RENDER_SUBSTEPS` é o botão desse trade-off (`frontend/src/js/temporal/temporal.constants.js`). Trocar a janela quantizada pelo cursor cru "para ficar preciso" reconstrói filtro em todo rAF.
- **Nunca persista direção/velocidade derivadas.** `autoDirection`/`autoSpeed` regeneram só o PNG do símbolo. O motivo não é apenas preservar o valor autoral: escrever na fonte GeoJSON correria contra a passada de geometria por frame que desloca o símbolo na trajetória. Já `autoDtg` é o oposto, deriva valores canônicos persistidos e viaja como `FEATURE_MODIFIED` (`frontend/src/js/store/feature.operations.js`).
- Rotação do símbolo permanece 100% manual, nunca dirigida pela trajetória.
- Modo revelar suprime a cláusula de ocultamento (`frontend/src/js/layers/visibility-filter.js`) e apenas esmaece, para que feições fora da janela continuem editáveis. É visualização local, não altera dado nenhum.

## Reagendar

Move o Dia D mantendo os offsets D+N. Ação confirmada e **não desfazível**.

**Não existe endpoint de reagendamento em lote.** `shiftMapTemporalTimes` (`frontend/src/js/store/feature.operations.js`) faz tudo no cliente e emite **uma op `feature` UPDATE por feição afetada**; a atomicidade é só a do `runTransaction` local (um único persist). Quem esperar uma operação atômica no servidor com broadcast em lote está desenhando contra algo que não existe.

Implicações a comunicar ao usuário: um par editando a mesma feição durante o reagendamento pode ganhar o LWW e ficar com a janela antiga; e reagendar mapa grande enfileira N ops. Ver [[fila-operacoes-outbound]].

## Permissão: a guarda é só visual

`shiftMapTemporalTimes` passa por `guardWrite`, mas `setMapTemporalConfig` e `toggleMapTemporal` **não têm guarda de escrita nem de bloqueio de mapa**. A proteção contra mapa bloqueado é apenas o botão `disabled` no card (`frontend/src/js/sidebar/tabs/maps.tab.js`): qualquer outro caminho de chamada (script, atalho, código novo) contorna a restrição. Ver [[permissoes-atlas]].

## Acoplamentos que atravessam arquivos

- **Viewers 3D/360** filtram marcadores pelo cursor. Por isso o controller emite `TEMPORAL_CURSOR_CHANGED` logo após resolver o cursor no sync (`frontend/src/js/temporal/temporal-controller.js`): sem isso, ao habilitar o temporal eles filtrariam com cursor `NaN`, já que `MAP_TEMPORAL_CHANGED` dispara antes.
- **Briefing:** `setCursor` tolera ser chamado antes de os bounds existirem (slide restaura o cursor antes do sync async terminar) e guarda o valor para o próximo sync. A reprodução é parada ao entrar em apresentação, para o cursor não derivar entre slides. Ver [[modos-operacao]].
- **Importação:** dados temporais viajam como propriedades comuns, sem evento dedicado. `decimateTrajectory` descarta detalhe abaixo da resolução da régua, cujo passo mais fino é um minuto (`frontend/src/js/temporal/temporal-model.js`). Ver [[formato-ebgeo-roundtrip]].
- **Observabilidade:** `TEMPORAL_CURSOR_CHANGED` é evento por frame e é explicitamente ignorado pelo tap do ledger (`frontend/src/js/store/sync/diag/bus-tap.js`). Ver [[syncledger]].

**A lista autoritativa da config é `DEFAULT_TEMPORAL_CONFIG`, e são seis campos.** O JSDoc de `frontend/src/js/store/temporal.operations.js` já descreveu quatro, omitindo `modo` e `origem`, que são justamente os dois que confundem: os dois são lente de EXIBIÇÃO e nunca mutam o tempo da feição.
