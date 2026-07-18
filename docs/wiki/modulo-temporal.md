# Módulo temporal (linha do tempo)

Dimensão de tempo por mapa: feições ganham janela de validade e trajetórias de keypoints, a configuração (`ativo`, modo, unidade, limites, origem) é estado compartilhado com LWW, mas cursor, reprodução e modo revelar são estritamente locais por usuário, e as lentes de exibição nunca movem os tempos das feições.

## O que é dado e o que é lente

Duas categorias que nunca devem se misturar:

**Dado canônico (viaja no sync, por feição):**
- `temporalInicio` / `temporalFim` (epoch ms absoluto). Ausente = feição permanente, visível em qualquer instante (`temporal-model.js:21-29`).
- `trajetoria`: lista de keypoints `{t, lng, lat}` em epoch ms, só para `point`, `military_symbol` e `coordination_measure` (`temporal.constants.js:59`).
- Flags de vínculo automático: `autoDirection`, `autoSpeed`, `autoDtg`.

**Config por mapa (compartilhada, LWW):** `{ ativo, unidade, inicio, fim, modo, origem }`, default em `temporal.constants.js:49-56`. `modo` (`absoluto` vs `relativo` D+N), `unidade` (MINUTO/HORA/DIA/SEMANA) e `origem` (epoch do "D") são **lentes de exibição**: mudar qualquer uma delas só re-rotula a régua, não toca em nenhum timestamp de feição (`temporal-settings.modal.js:13-17,144-145`).

**Estado local por usuário (nunca persistido, nunca sincronizado como dado):** cursor, `playing`, velocidade e modo revelar vivem só em campos do controller (`temporal-controller.js:55-67`). São análogos a pan/zoom.

A única forma de mover tempos de feição é a ação explícita "Reagendar" (ver abaixo). Se você se pegar escrevendo `temporalInicio` ao trocar `unidade` ou `origem`, está errado.

## Persistência e sincronização da config

A config é gravada no appStore sob a chave `temporal_<nomeDoMapa>`, espelhando o padrão do bloqueio de mapa, e espelhada em `memoryStore.temporalConfigs` para leitura síncrona em hot path (`temporal.operations.js:40-57`). `getMapTemporalConfigSync` / `isMapTemporalEnabledSync` são as APIs para render, filtros e viewers 3D/360; `getMapTemporalConfig` (async) é para UI.

`setMapTemporalConfig` (`temporal.operations.js:86-110`) faz, nesta ordem: persiste, atualiza o cache, emite `MAP_TEMPORAL_CHANGED` (só quando `ativo` muda) e `TEMPORAL_CONFIG_CHANGED` (sempre), e por fim registra a operação de sync.

Armadilha central, já causou bug real: a op é do tipo `mapTemporal` (`operation-types.js:28`) e é uma *map setting*, cujo `entityId` é o **UUID do mapa**, não o nome. O logger `createMapSettingLogger` descarta silenciosamente qualquer op cujo `mapId` não seja UUID (`operation-dispatcher.js:260-274`), porque um `mapId` não-UUID faz o backend rejeitar e derrubar o batch inteiro do flush. Por isso `setMapTemporalConfig` chama `mapManager.getMapId(target)` (`temporal.operations.js:107`); logar o nome fazia toda a sincronização temporal sumir sem erro. Consequência de projeto: o mapa local `Principal` (chaveado por nome, ver [[store-origin-local-remoto]]) nunca propaga config temporal, o que é correto.

Na aplicação remota, o handler resolve UUID → nome antes de gravar, exatamente porque o armazenamento local é chaveado por nome (`remote-operation-handler.js:903-918`); ele **persiste** em `temporal_<nome>` e só então emite os eventos, senão o par recebia o evento sem adotar a config. O snapshot de conexão faz o mesmo caminho (`remote-operation-handler.js:1115-1117`), então a config temporal sobrevive ao boot/reconexão. Ver [[aplicacao-operacoes-remotas]], [[snapshot-e-pull-incremental]], [[tipos-entidade-sync]] e [[envelope-operacao]].

Conflito é LWW por ordem de chegada no servidor, granularidade = objeto de config inteiro (não por campo). Dois usuários trocando `unidade` e `inicio` ao mesmo tempo: um dos dois patches é perdido inteiro. Ver [[modelo-conflito-lww]] e [[sync-lww-operacoes]].

## Presença: o instante do outro é awareness, não estado

O cursor não é sincronizado como dado; é transmitido como presença. `TEMPORAL_CURSOR_CHANGED` (emitido por frame durante a reprodução) alimenta um broadcast coalescido a 80 ms (`presence-bridge.js:63-64,374-379`) via mensagem WS `temporal`, que é um tipo coalescível junto com `cursor` e `selection` (`ws-client.js:36,203-210`). O payload leva o cursor **e** um rótulo curto já formatado (ex.: "D+3"), justamente para o par renderizar sem conhecer a config temporal do remetente (`presence-bridge.js:268-285`). A lista de online exibe "em D+3" (`online-users.control.js:54-56,75-83`). Detalhes em [[presenca-tempo-real]] e [[presenca-colaborativa]].

Regra prática: nunca reagir a uma mensagem `temporal` de presença movendo o próprio cursor. Ela é rótulo, não comando.

## Render: filtro quantizado + geometria interpolada

O `applyTemporalState` faz duas coisas distintas com custos distintos:

1. **Mostrar/ocultar** entra como uma cláusula nos filtros MapLibre (`visibility-filter.js:63-83`): a feição passa quando `[temporalInicio, temporalFim]` intersecta a janela ativa, com `coalesce` para sentinelas (`MIN_TS`/`MAX_TS`), o que faz feições sem tempo serem sempre visíveis. Rebuild de filtro é caro, então a janela é **quantizada** ao sub-passo da unidade antes de ir para o filtro (`temporal-controller.js:282-291`); `TEMPORAL_RENDER_SUBSTEPS = 2` significa duas reconstruções por unidade a velocidade 1 (`temporal.constants.js:90-99`). Não troque a janela quantizada pelo cursor cru "para ficar preciso": isso reconstrói filtro em todo rAF.
2. **Movimento** usa o cursor contínuo cru, interpolando a trajetória e sobrescrevendo apenas a geometria exibida na fonte GeoJSON; a posição de autoria fica guardada em `_temporalHome` para ser restaurada ao desligar o temporal (`temporal-render.service.js:1-12`). A aplicação é idempotente por cursor.

O apply é coalescido com guarda de in-flight (`temporal-controller.js:61-64`): frames durante um apply pendente só marcam `_applyPending`, não empilham applies concorrentes. Caches de trajetória precisam de `resetTrajectoryCache()` ao ressincronizar.

**Modo revelar** (olho) suprime a cláusula de ocultamento (`visibility-filter.js:82-83`) e aplica uma opacidade reduzida (`REVEAL_DIM = 0.4`) para que feições fora da janela continuem editáveis (`temporal-render.service.js:26-27`). É estado de visualização local; não altera dado nenhum. O sweep de paint tem guarda de hot path: se revelar está desligado e nada está esmaecido, ele retorna cedo.

**Limites da régua:** `inicio`/`fim` nulos na config caem para o extent calculado das feições, e um intervalo degenerado vira `inicio + 1 unidade` (`temporal.utils.js:309-325`). Ou seja, `inicio: null` não é bug, é "automático".

## Derivação automática: imagem-only vs canônico

Distinção que custa caro se errada:

- `autoDirection` e `autoSpeed` (símbolo militar): a flag persiste e sincroniza, mas o valor derivado é **exibição local**. O serviço regenera apenas o PNG do símbolo (`generateSymbolBlob` + `loadImageToMap`) e nunca escreve na fonte GeoJSON nem no store (`temporal-derivation.service.js:10-20`). O motivo é duplo: preservar os valores autorais e, sobretudo, não competir com a passada de geometria por frame que desloca o símbolo na trajetória. Throttle vem de quantizar o rumo em 5 graus mais uma guarda de in-flight.
- `autoDtg` é diferente: deriva valores **canônicos e persistidos** a partir da janela (`dateTimeGroup` no símbolo; `gdhIni`/`gdhFim` na medida de coordenação), via `rederiveAutoDtg` (`feature.operations.js:633-641`), e portanto viaja como `FEATURE_MODIFIED`.
- Rotação do símbolo permanece 100% manual, nunca é dirigida pela trajetória.

## Reagendar (shift em massa)

Ação deliberada, confirmada e **não desfazível**: move o Dia D para outra data real mantendo os offsets D+N. `shiftMapTemporalTimes(mapName, deltaMs)` (`feature.operations.js:654-698`) percorre todas as feições do mapa, soma o delta em `temporalInicio`, `temporalFim` e em cada `t` de trajetória, re-deriva o DTG/GDH automático, e persiste tudo em **uma** transação (um único persist). O fluxo completo no modal (`temporal-settings.modal.js:366-402`) é: `shiftFeatureTimes(delta)` (store + fontes vivas, via `shiftSourcesTemporal`), depois `setMapTemporalConfig` com `origem`, `inicio` e `fim` deslocados, o que dispara uma única re-sincronização autoritativa do controller (`temporal-controller.js:144-156`).

> [!CONTRADICAO 2026-07-18] `docs/acoes-interface-multiusuario.md` §29 item 12 diz que o reagendamento é uma "operação atômica no servidor + broadcast em batch"; o código faz tudo no cliente: `feature.operations.js:687-693` emite **uma op `feature` UPDATE por feição afetada** dentro do `deferAsync` da transação local. Não existe endpoint de reagendamento em lote, e a atomicidade é só a do `runTransaction` local (um persist). Para os pares, isso chega como N operações independentes sujeitas a LWW individual, ver [[fila-operacoes-outbound]].

Implicações que precisam ser ditas ao usuário: um par editando a mesma feição durante o reagendamento pode ganhar o LWW e ficar com a janela antiga; e um reagendamento em mapa grande enfileira N ops.

## Permissão e bloqueio

`shiftMapTemporalTimes` passa por `guardWrite(GuardAction.UPDATE_FEATURE, ...)` e retorna 0 se bloqueado (`feature.operations.js:657`). Já `setMapTemporalConfig` e `toggleMapTemporal` **não têm guarda de escrita nem de bloqueio de mapa**: a proteção contra mapa bloqueado é só de UI, o botão fica `disabled` no card do mapa (`maps.tab.js:490-497`). Quem chamar a operação por outro caminho (script, atalho, código novo) contorna a restrição. Ver [[permissoes-atlas]] e [[permissao-vs-papel]].

## Interações com o resto do app

- **Viewers 3D e 360** filtram seus marcadores pelo cursor usando `isMapTemporalEnabledSync` (`marker_tool_3d.js:64`, `street_view_viewer.js:1009`). Por isso o controller emite `TEMPORAL_CURSOR_CHANGED` logo após resolver o cursor no `_syncForActiveMap`: sem isso, ao habilitar o temporal esses viewers filtrariam com cursor indefinido (`temporal-controller.js:248-252`).
- **Briefing:** o slide guarda `temporalCursor` (`briefing-editor.control.js:1168-1172`) e a apresentação restaura via `setCursor` (`transition.service.js:418-420`). `setCursor` tolera ser chamado antes dos bounds existirem, guardando o valor para o próximo sync (`temporal-controller.js:162-168`). A reprodução é parada ao entrar em apresentação, para o cursor não derivar entre slides. Ver [[modos-operacao]].
- **Importação e round-trip:** dados temporais viajam como propriedades comuns da feição, cobertos pelos `FEATURE_CREATED` em lote da aba Importar e pelo `.ebgeo`, sem evento dedicado. Tracks com tempo (KML/KMZ/GPX) viram pontos móveis, com `decimateTrajectory` descartando detalhe abaixo da resolução da régua, cujo passo mais fino é um minuto (`temporal-model.js:172-183`). Ver [[formato-ebgeo-roundtrip]].
- **Observabilidade:** `TEMPORAL_CURSOR_CHANGED` é evento por frame e é explicitamente ignorado pelo tap do ledger (`bus-tap.js:11`). Ver [[syncledger]].

## Armadilhas resumidas

1. Logar a op de config com o nome do mapa em vez do UUID: descarte silencioso no pré-flush.
2. Aplicar op remota emitindo evento sem persistir: o par "pisca" a mudança e volta atrás no próximo boot.
3. Usar o cursor cru no filtro de visibilidade: rebuild por frame.
4. Persistir direção/velocidade derivadas: corrompe o valor autoral e corre contra a passada de geometria.
5. Tratar `origem`/`modo`/`unidade` como se movessem feições: só "Reagendar" move.
6. Confiar no bloqueio de mapa para proteger a config temporal: a guarda é apenas visual.
7. O JSDoc de `temporal.operations.js:9,25` ainda descreve a config como `{ativo, unidade, inicio, fim}`, sem `modo` e `origem`; o formato real é o de `DEFAULT_TEMPORAL_CONFIG` (`temporal.constants.js:49-56`).

## Fontes
- `docs/acoes-interface-multiusuario.md` (§29 e tabela de resolução de conflitos): matriz das 20 ações temporais com classificação local vs compartilhada, princípio "config compartilhada / cursor local", awareness do instante temporal, e a descrição do reagendamento que diverge do código.
- `docs/ui-ux-ebgeo.md` (linhas 204-205): posicionamento do módulo `temporal/` como dimensão temporal por mapa dentro da arquitetura de UI.
- Código (autoritativo): `src/js/temporal/temporal.constants.js`, `temporal-controller.js`, `temporal-render.service.js`, `temporal-model.js`, `temporal-derivation.service.js`, `temporal-settings.modal.js`, `temporal.utils.js`; `src/js/store/temporal.operations.js`, `feature.operations.js`; `src/js/store/sync/{operation-dispatcher,operation-types,remote-operation-handler,ws-client}.js`; `src/js/presence/{presence-bridge,online-users.control}.js`; `src/js/layers/visibility-filter.js`; `src/js/sidebar/tabs/maps.tab.js`; `src/js/briefing/`.
