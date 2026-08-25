# TESTING-BACKLOG.md — EBGeo Web (Lógica Pura)

## Como ler este arquivo

É um **levantamento de alvos**, não um retrato da cobertura. O retrato é
`ls frontend/tests/unit`; aqui só mora o que a leitura do código apurou sobre
cada alvo (risco, edge cases, se vale fast-check). Três regras de uso:

- **Confira em disco antes de pegar um item.** Um alvo listado abaixo pode já
  ter suíte: o arquivo é atualizado por lote, não a cada suíte escrita. Esta
  seção já mandou refazer nove suítes prontas por descrever o Lote 1 como
  concluído numa seção e reofertá-lo na seguinte.
- **Todo caminho com barra resolve.** A coluna "Módulo" usa o caminho completo a
  partir da raiz do monorepo, ou o caminho relativo a `frontend/src/js/`; onde ela
  traz só o nome do arquivo (`add_point_geometry.js`), o basename é único sob
  `frontend/src/js/` e se acha com um Glob. Dezenove linhas citavam um caminho
  truncado no meio (o tool sem a pasta de família, o algoritmo sem a pasta
  processing): parecia caminho, não resolvia de raiz nenhuma, e mandava o leitor
  procurar arquivo onde ele não está.
- **Nome de função entre crases existe no código.** Nome de função **sem**
  crases é uma extração proposta que ainda não existe: o nome é sugestão da
  época do levantamento, não um símbolo a procurar por grep.

## Status

**LOTE 2 — CONCLUÍDO em 2026-08-24: os 21 domínios que restavam foram cobertos, e o que este
arquivo é mudou.** Ele nasceu como inventário de defeito SUSPEITADO, apurado por leitura; agora é
registro do que foi MEDIDO. A diferença não é retórica: ao executar, o inventário foi **refutado
cerca de trinta vezes**, e nenhuma das refutações era descuido. Ele mandava procurar símbolo em
arquivo onde ele não existe (duas linhas), chamava de bug um parâmetro com default correto,
afirmava deep-copy onde a cópia é rasa, dizia que uma função não trata antimeridiano quando ela
trata (a irmã é que não), propunha um teste sobre `_niceNumber`, que não existe em lugar nenhum de
`src/`, e tratava como "extrair primeiro" quatro grupos que já eram testáveis sem tocar em `src/`.
As linhas foram corrigidas no lugar. **Trate toda célula abaixo como HIPÓTESE: meça antes de
escrever o teste, e corrigir a linha faz parte de fechar o item.**

Saldo do lote: cerca de 4400 casos novos e **98 defeitos reais de produto**, todos consertados ou
registrados como decisão com a medição. Zero `it.fails` restante na árvore. A decisão e as três
formas que atravessaram o repositório (`valor || padrao` engolindo o zero legítimo em nove
domínios; lookup por `TABELA[chave]` com chave de fora em três sítios; `if (x < 0) x += 360`
devolvendo 360 exato em quatro sítios de azimute) estão em
[`../../docs/decisions/decisions-2026.md`](../../docs/decisions/decisions-2026.md).

**FECHADO EM 2026-08-25: não há mais alvo de Fase 1 aberto.** Os dois últimos, `extractTextModifiers`
e o par encode/decode da barra de engajamento, foram extraídos para módulos folha de zero imports
(`frontend/src/js/military_tools/military_symbol_tool/text-modifiers-mapping.js` e
`frontend/src/js/military_tools/military_symbol_tool/attributes/engagement-bar-codec.js`) e prendidos, o que era a única
forma de alcançá-los sem browser. A extração achou e consertou um defeito: a decodificação fazia
`split('-')` e um armamento com hífen perdia tudo depois do segundo, em silêncio.

**O que continua aberto, e é pouco:** a Fase 2 declarada de vários domínios (canvas, jsdom,
MapLibre, FileReader, JSZip), que exige outro ambiente de teste; e o antimeridiano do
`interpolateLngLat` do snapping, que **NÃO É PENDÊNCIA: é não-objetivo declarado pelo dono em
2026-08-25**. O conserto barato foi escrito, medido e revertido (quebra uma aresta de 200 graus que
`queryRenderedFeatures` devolve legitimamente em zoom baixo), e o conserto correto alargaria uma
interface no caminho quente de um `mousemove` para comprar nada num produto cujo teatro é o Brasil.
Quem for "arrumar" isso vai derrubar um teste que está certo. O motivo está no arquivo e em
[`../../docs/decisions/decisions-2026.md`](../../docs/decisions/decisions-2026.md).

**Lote 1 — CONCLUÍDO** (9 suítes, +491 testes, 10 bugs corrigidos), e por isso
seus alvos **saíram das tabelas abaixo**, com um ponteiro no lugar de cada bloco.
Suítes criadas: `tests/unit/measurement-geometry.test.js`,
`tests/unit/circle-geometry.test.js`, `tests/unit/polygon-geometry.test.js`,
`tests/unit/line-geometry.test.js`, `tests/unit/csv-import.test.js`,
`tests/unit/state-manager.test.js`, `tests/unit/military-symbol-generator.test.js`,
`tests/unit/zoom-correction-helpers.test.js`, `tests/unit/ellipse-geometry.test.js`.

O tamanho da suíte não fica registrado aqui: esta linha já afirmou "1336 testes"
e envelheceu por um fator de mais de dois. Quem quiser o número roda
`npm test` e lê o rodapé do Vitest.

Bugs corrigidos (classe "validate aceita NaN/Infinity" + outros): circle/line/polygon/ellipse `validate`
(rejeitam não-finito), polygon `insertVertexAtIndex` (bounds), `generateArcCoordinates` (numPoints=0→NaN),
csv `_parseNumber` (vírgula), line-split `canSplitLine` (bloqueado string), mil `validateSIDC`.
~25 comportamentos ambíguos foram **fixados por teste mas NÃO alterados** (candidatos a decisão
futura, ex.: `state_manager` escopo `mouse.*` largo, formatadores emitindo `NaN`). Eles estão
marcados nos próprios testes; o relatório separado que esta linha citava não existe mais.

**Correções de 2026-08-24** (brush/text/image/point + label tab), cada uma com a linha da tabela
marcada FEITO: `calculateRotationFromHandle` (rotação negativa, ver a linha em draw-text, que
apontava a metade errada do `if`), `simplifyLine` (âncora no último ponto MANTIDO),
`getBoundingBox` do pincel (quatro spreads → uma varredura), `validate` de brush/text/image/point
(`Number.isFinite`, fechando a mesma classe do Lote 1), `recalcLabelSize` e a cópia inline dentro
de `createLabelZoomHandler` (falsy-zero em `labelCreatedAtZoom` e `labelSize`),
`recalculateSelectionBox` do ponto (`size || 10`), `calculateRotationHandlePosition`
(`mapZoom || createdAtZoom`) e `computeShapeCentroid` (antimeridiano). Repros de comportamento
de produto em `tests/integration/rotacao-de-texto-negativa.repro.test.js`,
`tests/integration/pincel-curva-suave-colapsa.repro.test.js` e
`tests/integration/etiqueta-ancora-zero-sobrescrita.repro.test.js`.

## Sumário Executivo

- **Candidatos brutos coletados:** 375 símbolos em 40 domínios (41 agentes).
- **Após deduplicação e remoção do já-coberto:** **~118 suítes-alvo** únicas.
  - **P1 (risco alto × coupling `pure`/`turf`/`stubbable`):** **52**
  - **P2 (risco médio OU coupling `mixed` que exige extração):** **44**
  - **P3 (baixo/cosmético):** **22**
- **Fase 2 (precisa jsdom/canvas/MapLibre):** ~30 itens listados como "não recomendar agora".
- **Estimativa de esforço P1+P2:** ~96 suítes (≈ 55 S, 33 M, 8 L).

### Padrão de teste (já provado no repo)
`tests/unit/sector-geometry.test.js` é o template: `vi.mock('@tools', () => ({ BaseGeometry: class { constructor(p={}){this.properties=p;} } }))` + dynamic import. Para turf (global via script tag, **não** npm): `globalThis.turf = {...}` em `beforeAll` / `delete` em `afterAll` (ver `tests/unit/azimuth-distance-geometry.test.js`). Ambiente `node`, sem jsdom; `mgrs`/`proj4` são deps npm reais e rodam direto.

### Ordem de execução sugerida

**O "Top 10" que morava aqui era o Lote 1, e o Lote 1 está concluído.** As dez
linhas mandavam começar exatamente pelas nove suítes que a seção Status, vinte
linhas acima, declarava prontas: quem lesse de cima para baixo reescreveria
trabalho feito. Foi removido em 2026-08-14 em vez de reordenado, porque uma
ordem sugerida que não é conferida contra o disco vira armadilha de novo no
próximo lote.

**Ordem para o próximo lote:** pegue de cima para baixo em `## P1`, pulando o que
já tiver suíte em `frontend/tests/unit/`. Os alvos abertos de maior ROI hoje são
`generateQAN` (`frontend/src/js/import_export/qan/qan-export.js`), os algoritmos
de `frontend/src/js/processing/algorithms/` e
`frontend/src/js/draw_tools/rectangle_tool/add_rectangle_geometry.js`.

---

## Furos abertos do tab-lock

Estes NÃO são alvos de cobertura: são defeitos conhecidos do protocolo de arbitragem entre
abas (`frontend/src/js/utilities/tab-lock.js`), levantados por uma passada adversarial e
deixados abertos por decisão de escopo. Moram aqui porque a alternativa era pior: eles já
foram testes verdes que **asseguravam o defeito** (`expect(wipes).toEqual(['a-wipe',
'b-wipe'])` autorizava as duas abas a apagar), de modo que fechar o buraco deixaria a suíte
vermelha e a suíte estaria defendendo o bug.

Cada um tem um `it.todo` correspondente em `frontend/tests/unit/tab-lock-refutacao.test.js`,
com a reprodução escrita por extenso no comentário acima dele. **Ao fechar um destes, promova
o `it.todo` a teste de verdade** (a reprodução vira o caso, com a asserção no comportamento
correto) e apague a entrada daqui.

| # | Furo | Onde | Fecha com |
|---|---|---|---|
| 1 | ~~`granted: true` é concedido por **ausência de prova**, e é ele que autoriza `clearAllDataStore()`.~~ **FECHADO em 2026-08-16.** `acquire` passou a exigir DUAS concordâncias: a ordem total (o canal, que sabe QUEM bloqueia e alimenta o "Usar aqui") e uma **testemunha**, que lê um fato do navegador em vez de esperar mensagem — o lock de montagem COMPARTILHADO que a store toma em todo namespace montado (`atlas-namespace.js`, Decisão 5), contado por `otherClientHoldsLock`. Um Web Lock só é solto pela MORTE do cliente, nunca pelo silêncio, então as três faces (settles sobrepostos, par ocupado por mais que o settle, `STATE` perdido) deixam de produzir concessão. As duas chamadas destrutivas de `open-atlas.service.js` passam a testemunha; sem `navigator.locks` (HTTP puro) ela responde "não sei" e o settle decide, como antes. Provado por mutação: as três faces + os dois sítios de chamada, cada um com controle negativo. O sítio que faltava, o open de link público (`index.js openPublicAtlasFromUrl`), era o QUARTO caminho destrutivo e foi esquecido na primeira passada justamente por não parecer um: ele fechou em seguida, no mesmo dia, e hoje passa `witness: remoteMountWitness(atlas.id)` como os outros dois. | — | — |
| 2 | ~~**Sem fencing:** aba apenas travada é expirada por TTL e retoma o lock sem nunca ter rodado o próprio `onBlocked`.~~ **FECHADO em 2026-08-16.** Duas metades: quem despeja registra a reivindicação expirada e recusa UMA vez a reapresentação dela (`_standingPeers`, recusa consumida no primeiro uso porque um despejo pode estar errado), e quem foi despejado mede o próprio silêncio (`_fenceAfterSilence`) e re-entra na ordem como recém-chegada. Provado por `tests/unit/tab-lock-refutacao.test.js` 4.3, com controle negativo por metade. **Resta aberto o caso sem par**: se a aba que despejou já fechou, ninguém arbitra, e só uma época monotônica PERSISTIDA por atlas resolveria (fora do alcance deste módulo, que não toca store). | — | — |
| 3 | ~~**bfcache:** o `pagehide` não olhava `event.persisted`.~~ **FECHADO em 2026-08-16.** Entrar no cache não posta mais `RELEASE`, e `pageshow` com `persisted` re-anuncia na hora, deixando a cerca de silêncio decidir se a reivindicação sobreviveu à estadia. Provado por `tests/unit/tab-lock-refutacao.test.js` 4.4, **e a prova é de nó**: o runner do Playwright sobe o Chromium com o bfcache DESLIGADO (caso B0 de `tests/e2e-ui/browser-multi-tab-teardown-queue.spec.js`), então não há prova de navegador para esta janela. | — | — |
| 4 | ~~**Uma aba que cedeu nunca reassume.**~~ **FECHADO em 2026-08-16.** `_reclaimYieldedKey` re-adota `_yieldedKey` (com carimbo novo) ao cair para zero par COM STANDING em colisão, o que fecha os dois sintomas; o endereço por colisão do `TAKEOVER` fica, porque endereçar só a bloqueadora entregaria o atlas à segunda da fila. No caminho apareceu um terceiro defeito, corrigido junto: `_handleTakeover` marcava `_yielded` DEPOIS de aguardar a parada, e o `YIELD` de outra detentora chegando nessa janela desbloqueava a aba no meio da entrega. Provado por `tests/unit/tab-lock-refutacao.test.js` 4.5 (três blocos, três controles negativos). | — | — |
| 5 | ~~A fila de saída é **global**, não por atlas.~~ **FECHADO em 2026-08-15 (E2B).** A fila virou `perAtlas: true` (`store/atlas-namespace.js`), a operação carrega o endereço do escopo em que nasceu, e o wipe de ENTRADA a exclui de propósito (senão `openRemoteAtlas` destruiria a fila do atlas que está abrindo, três linhas depois de ativá-lo). Provado por mutação: `perAtlas: false` derruba 37 casos em 9 arquivos. | — | — |
| 6 | ~~Ninguém lê `degraded`.~~ **FECHADO em 2026-08-16.** O consumidor natural nunca apareceu, e esperar por ele deixou o único sinal no console por meses; a solução foi o próprio módulo montar um banner (`_buildDegradedNotice`/`_syncDegradedNotice`), visível só enquanto a aba SEGURA um atlas. Pesa mais depois de E7: com a retenção remoto x remoto removida, o modo degradado é o ÚNICO mecanismo que separa duas abas no MESMO atlas. Preso por `tab-lock-refutacao.test.js` 4.7. | — | — |

---

## Flakes MEDIDOS, com a taxa

Um flake sem taxa é boato. Estes foram medidos em série, e a medição é o que decide se são
tratáveis agora ou se viram ruído tolerado. **Os dois precisam fechar antes de E7**, que é
quando a regra uniforme de colisão é liberada: um caso instável num portão é pior que portão
nenhum, porque a próxima falha REAL é lida como "é o de sempre".

| teste | taxa medida | quando | notas |
|---|---|---|---|
| `tests/unit/multiaba-invariantes.test.js` — "op pendente de OUTRO atlas não transforma X em atlas local permanente" | **2 em 15** rodadas da suíte COMPLETA | 2026-08-15, depois da fila física (P11) | Passa 21/21 rodando o arquivo isolado, e **6 de 6** rodando junto com os cinco arquivos de fila (`operation-queue-*`, `operation-scope-stamp`), o que descarta a interferência mais provável. A mensagem não foi capturada: as tentativas de captura caíram em rodadas verdes. Só aparece sob a suíte inteira, mesma assinatura do flake do `tab-lock-sync-brake`, que acabou sendo relógio e não lógica. **Investigar pelo relógio antes de qualquer outra hipótese.** **NÃO REPRODUZ desde 2026-08-15, medido 16/16 verdes em série** depois de E7 (a retenção remoto x remoto saiu de `keysCollide`) e da fila física por atlas. **Isto NÃO é "corrigido", é "parou de aparecer"**, e a distinção importa: nenhuma causa foi confirmada e nenhum controle negativo foi aplicado, então não existe nada que impeça a volta. As duas leituras possíveis continuam abertas: a causa foi removida de lado por uma daquelas duas etapas (a fila deixou de ser compartilhada entre escopos, e o predicado deixou de bloquear pares que o cenário criava), ou a taxa apenas caiu e ele volta sob carga diferente. Se voltar, comece pelo relógio e capture a mensagem ANTES de qualquer hipótese. |
| `tests/unit/tab-lock-sync-brake.test.js` — "stops a tab that was ALREADY blocked when the brake is installed" | **1 em 14** rodadas da suíte COMPLETA (0 em 5 rodando o arquivo isolado) | 2026-08-15, durante E3 | Só aparece sob a suíte inteira, o que aponta para tempo e não para lógica. Mecanismo provável: `setEffects` (`tab-lock.js:866`) só dispara `_runBlockedEffect()` se `this._blocked` já for true, e o `granted: false` que o teste asseriu antes NÃO é o mesmo instante em que o estado interno vira. É a classe "`granted` não é prova" do furo 1 acima, aparecendo no teste em vez de no app. PRÉ-EXISTENTE: nada de E1/E3 tocou `tab-lock.js`. |
| `tests/e2e-ui/browser-multi-tab-namespace.spec.js` | **1 em 6** execuções, por TIMEOUT | 2026-08-15, durante E0 | `test.fail` não cobre timeout, então a rodada inteira reprova. Registrado por decisão do dono ("registre e siga"). |
| `tests/unit/tab-lock-refutacao.test.js` -- "3.5 CORRIGIDO: no boot o lock ainda nao decidiu" | **1 em 4** rodadas da suite COMPLETA (0 em 6 isolado, 0 em 3 completas consecutivas depois) | 2026-08-24 | TERCEIRO membro da mesma familia dos dois de cima, e a assinatura e identica: so aparece sob a suite inteira, o que aponta para TEMPO e nao para logica. O caso reivindica com `settleMs` e afirma `granted === false`; sob carga o settle expira antes de a irma decidir e o grant sai. **Nao e regressao do lote da testemunha**: medido isolado 6/6 verde no mesmo commit, e o conserto daquele lote nao toca o caminho de settle. Registrado com a taxa em vez de declarado verde, porque um verde posterior nao apaga um vermelho medido. Se for investigar, comece pelo RELOGIO e capture a mensagem antes de qualquer hipotese, como manda a linha dos dois irmaos. |

---

## P1 — Risco Alto × Coupling Pure/Turf (ALTO ROI — COMECE AQUI)

### Domínio: measurement — CONCLUÍDO
Coberto por `tests/unit/measurement-geometry.test.js` (formatadores, `calculateAngle`,
`generateArcCoordinates`). Alvo aberto que sobrou no domínio: `measurement-labels.js`, que é
MapLibre e está na Fase 2.

### Domínio: draw-circle — CONCLUÍDO
Coberto por `tests/unit/circle-geometry.test.js`: `validate` (que passou a rejeitar não-finito),
`generateCircleGeometry`, `getBoundingBox`, `updateFromHandle`, `calculatePreview`,
`normalizeCenter`, `isValidCenter`.

### Domínio: draw-polygon — CONCLUÍDO
Coberto por `tests/unit/polygon-geometry.test.js`, incluindo o bug de bounds em
`insertVertexAtIndex` e o midpoint do último segmento.

### Domínio: draw-line — CONCLUÍDO
Coberto por `tests/unit/line-geometry.test.js`, que absorveu também
`frontend/src/js/draw_tools/line_tool/line-split.js` (`canSplitLine`, cujo tratamento de
`bloqueado` como string foi corrigido) e
`frontend/src/js/draw_tools/line_tool/line_profile.js` (ganho/perda de elevação, faixa,
declividade).

### Domínio: draw-brush — CONCLUÍDO em 2026-08-24 (brush-geometry)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `draw_tools/brush_tool/add_brush_geometry.js` | `simplifyLine` | FEITO 2026-08-24 | <=2 pts identidade; **Reumann-Witkam** (âncora em vizinhos originais, não último mantido)→curva suave colapsa; NaN dropa silenciosamente | linha reta→[first,last]; subsequência; monotônico em tolerância | sim | M |
| idem | `calculatePointLineDistance` | alto | Segmento degenerado lenSq=0; clamp t∈[0,1]; sem wrap antimeridiano | foot perpendicular; param<0→start; >=0 e finito | sim | M |
| idem | `validate` | FEITO 2026-08-24 | ~~Infinity aceito~~ (agora `Number.isFinite`); <2→false; string coords→false | [[0,0],[Inf,1]]→true (flag) | sim | S |
| idem | `getBoundingBox` | FEITO 2026-08-24 | ~~Spread `Math.min(...lngs)` estoura pilha em arrays grandes~~ (varredura única, os QUATRO spreads); sem wrap | stress 200k pts; todo pt dentro do bbox | sim | S |
| idem | `applyOffset` | médio | Inválido→input inalterado; dropa componente z; round-trip | round-trip +d/-d; z perdido | sim | S |

### Domínio: draw-text — CONCLUÍDO em 2026-08-24 (text-geometry)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `draw_tools/text_tool/add_text_geometry.js` | `calculateRotationFromHandle` | ~~alto~~ FEITO 2026-08-24 | ~~Wrap `>=360` roda ANTES de Math.round~~: essa metade do `if` não reproduzia dentro do contrato de `turf.bearing`. O defeito real era o outro ramo: **`bearing - 270` cai em [-450, -90] e UM `+= 360` deixava a saída em [-90, 270]**, ou seja, rotação NEGATIVA no último quadrante e [271, 359] inalcançável | tests/unit/text-geometry.test.js + tests/integration/rotacao-de-texto-negativa.repro.test.js | sim | M |
| idem | `calculateZoomAdjustedSize` | médio | diff=0→base; clamp 255; NaN não protegido; baseSize 0→0 | (16,10,11)→32; clamp 255; NaN→NaN | sim | S |
| `tool_manager/managers/selection-highlight.manager.js` | `calculateExpandedDimensions` | alto | rot=0 early-return exato; 90→swap; 45→(w+h)/√2; ±r simétrico; 360 não early | (10,20,90)≈{20,10}; bbox nunca encolhe | sim | M |

### Domínio: draw-image — CONCLUÍDO em 2026-08-24 (image-geometry)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `draw_tools/image_tool/add_image_geometry.js` | `calculateZoomAdjustedSize` | alto | Clamp 10 (não 255 como text!); 2^-Inf→0; NaN; base>10 clampa mesmo diff 0 | (1,15,16)→2; (1,0,20)→10; <=10 sempre | sim | S |

### Domínio: draw-point — CONCLUÍDO em 2026-08-24 (point-geometry + label-tab-helpers)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `draw_tools/point_tool/add_point_geometry.js` | `calculateSelectionBoxGeometry` | alto | **BUG: callsite `createPointAtCoordinates` passa 4 args (5 esperados)→effectiveZoom=null**; cosLat polos; anel fechado 5 pts | fixar geometria com assinatura 5-arg; anel[0]===anel[4] | sim | M |
| `tool_manager/helpers/label-tab.helpers.js` | `computeShapeCentroid` | FEITO 2026-08-24 | Anel fechado exclui vértice de fechamento; <3→null; ~~antimeridiano errado~~ (longitudes somadas desenroladas); holes ignorados | quadrado fechado→[1,1]; centroid dentro do anel | sim | S |

### Domínio: mil-symbol — CONCLUÍDO em 2026-08-25 (os dois últimos alvos saíram para módulos folha: `text-modifiers-mapping` e `engagement-bar-codec`)
`buildSIDC`, `parseSIDC` (com round-trip), `validateSIDC`, `canParseSIDC` e
`extractViewBoxDimensions` estão cobertos por `tests/unit/military-symbol-generator.test.js`;
a extensão brasileira do SIDC, por `tests/unit/brazilian-sidc.test.js`. As linhas abaixo são
o que sobrou aberto no domínio.

| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `brazilian_svg_postprocessing.js` | `hexToRgb` (+`applyBrazilianModifications`) | alto | **3-dígitos `#fff`→`rgb(255,NaN,NaN)`**; lowercase; sem `#` | `#fff`→NaN (flag bug); 4 cores engagement substituídas | não | M |
| `engagement-bar.section.js` | encode/decode (extrair; nomes sugeridos, ainda não existem) | alto | `'STAGE-WEAPON'`; `R:` prefix; desambiguação stage-vs-weapon; round-trip com valores contendo `<` | extrair pure; round-trip stage×weapon×remote | sim | M |

### Domínio: mil-arrow — CONCLUÍDO em 2026-08-24 (arrow-geometry + arrow-merge)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `military_tools/arrow_tool/add_arrow_geometry.js` | `normalizeBaseCoordinates` | alto | JSON malformado→[]; `'null'`/`'42'`→retorna null/42 (shape ruim); array passa por ref | round-trip; `'42'`→documenta bug | sim | S |
| idem | `removeVertexAtIndex` | alto | <2→null; out-of-range→null; não muta | remove p/ 1 pt→null; input intacto | sim | S |
| idem | `validate` | médio | <2→false; haversine real; fronteira 10m estrito `<`; string normalize | exatamente 10m→documentar | não | S |
| `frontend/src/js/military_tools/arrow_tool/arrow-merge.js` | `extractBranches` | alto | **width=0/false/airmobilePosition=0 (falsy-mas-definido) DEVEM ser copiados**; baseCoordinates deep-copy | width:0 preservado; mutação isolada | não | M |
| idem | `canMergeArrows`/`canSplitArrows` | médio | <2→false; source≠arrow; layerId ausente→'default' bucket; isMerged+branches | 2 arrows sem layerId→mergeable | não | S |
| idem | `_applyWidthFromHandle` (extrair sideSign) | alto | Cross-product esquerda(>0)/direita; colinear `>0` estrito→não inverte | extrair `sideSign(a,b,p)`; esquerda→>0 | sim | M |

### Domínio: mil-boundary — CONCLUÍDO em 2026-08-24 (boundary-geometry-coordenadas-e-echelon)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `military_tools/boundary_tool/add_boundary_geometry.js` | `normalizeBaseCoordinates` | alto | null→null; JSON→array; **all-or-nothing** (1 NaN rejeita tudo, diverge de validate); `'[]'`→[] | round-trip; um NaN→null | sim | S |
| idem | `removeVertexAtIndex` | alto | <0/>=len→null; <2→null; não muta | remove p/ <2→null; imutabilidade | sim | S |
| idem | `getBoundingBox` | médio | Vazio→[0,0,0,0]; all-NaN filtrado; antimeridiano naive | antimeridiano→spans globo (documentar) | sim | S |
| idem | `generateBoundaryGeometry`/`createEchelonSymbol`/`updateFromHandle` | alto | Fallback LineString; **`updateFromHandle` midpoint usa `<=` (vertex usa `<`)→off-by-one**; clamps | stub turf; #linhas=2·X+I, #polys=o; `<=` append | sim/não | M |
| idem | `generateBoundaryTexts` | médio | **`text_distance_ratio===0` cai p/ 0.9** (falsy-zero); rotação seam 0/180 | ratio 0→fallback 0.9 (flag) | não | M |

### Domínio: mil-occupied — CONCLUÍDO em 2026-08-24 (occupied-front-geometry)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `frontend/src/js/military_tools/occupied_front_tool/add_occupied_front_geometry.js` | `createOccupiedFrontGeometry`/`createRay` | alto | 3 pts→MultiLineString 10 segmentos; ratios 60/10/10; turn ±225, head ±150; dist<1→[] | coords.length===10; arm omitido se p2==p1 | sim | M |
| idem | `calculateBearing` (local, distinto de utils) | médio | Norte→0, leste→90; normalizado [0,360); **antimeridiano NÃO tratado** (bug) | norte≈0; sempre [0,360); round-trip destination | sim | S |
| idem | `updateFromHandle`/`calculatePreview` | alto | **p3 NÃO validado por distância** (pode colapsar em p1); **calculatePreview sem allowlist de handleType**; imutabilidade | p3 anyPos sucesso (flag); handleType bogus→geometria | não | M |

### Domínio: mil-coordmeasure — CONCLUÍDO em 2026-08-24 (coordination-measure-* + coordination-points-catalog)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `coordination_measure_generator.js` | `hexToRgb` | alto | `/i`; sem `#`; 3-dígito→null; 8-dígito→null; `#000000`/`#FFFFFF` | `#FFF`→null; `''`→null | sim | S |
| idem | `applyCustomColor` | alto | `'none'` só fill; hex válido fill+stroke (assimétrico); hex inválido→no-op silencioso | none preserva stroke branco; inválido inalterado | não | S |
| idem | `extractDimensions` | alto | Sem viewBox→default {0,0,40,40}; **espaço inicial→token vazio→fallback**; negativos | `" 0 0 40 40"`→default (documenta) | não | M |
| idem | `calculateDynamicViewBox` | alto | Anchor start/end/middle; **valor 0 conta** (≠ ''); MARGIN 5; floor/ceil inteiros | numero===0 expande; ''não | sim | M |
| idem | `validate` | alto | pointCode desconhecido→early; supply/echelon/concentração | ECHELON_16 {}→2 erros | não | M |
| `add_coordination_measure_geometry.js` | `calculateZoomAdjustedSize` | alto | diff=0→base; clamp 10; 2^-n; base 0→0 | (2,10,11)→4; (5,0,20)→10 | sim | S |
| `coordination_points_catalog.js` | invariantes catálogo + `getTextFieldsConfig` | médio | ECHELON_/SUPPLY_ gerados; code===key; svg string | cada code→Array; counts batem | sim | M |

### Domínio: analysis (los + visibility) — CONCLUÍDO em 2026-08-24 (visibility-geometry + los-geometry)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `frontend/src/js/analysis_tools/visibility_tool/add_visibility_geometry.js` | `calculateBearing`/`pointAtBearing` (cópias próprias) | alto | Norte/leste/sul/oeste; [0,360); radius 0→center; cosLat polo; antimeridiano | round-trip bearing/destination; norte=0 | sim | S |
| idem | `validate` | médio | **NaN radius/aperture passam** (comparações NaN false); aperture 1/359 inclusivo | validate([0,0],NaN,60)→true deveria ser false (flag) | não | S |
| idem | `calculateDistanceStep` | alto | Múltiplo de 30 e >=30; radius pequeno→30; aperture guard | result%30===0 sempre | sim | S |
| idem | `updateFromHandle` | alto | radius<10→null; aperture wrap +360 e espelho; clamp [1,359] | aperture clamp extremos; bogus→null | não | M |
| idem | `generateProcessedFeatures` | alto | non-MultiPolygon→[]; **cellData[index] assume alinhamento**→mismatch throw | cellData curto→throw (documentar invariante) | não | M |
| `visibility_tool` | `calculateViewshed` (extrair um classifyRay puro; nome sugerido, ainda não existe) | alto | FOCO: classificação max-angle; barreira terrain-only vs visível terrain+target; primeiro pt sempre visível; `>` estrito | extrair pure; ridge crescente→[v,v,obstruído] | não | M |
| `frontend/src/js/analysis_tools/los_tool/add_los_geometry.js` | `validate` | médio | **Infinity aceito**; len≠2→false; 3D ok | [[Inf,0],[1,1]]→true (flag) | não | S |
| idem | `calculateLOS` (extrair um detectObstruction puro; nome sugerido, ainda não existe) | alto | FOCO: primeiro cruzamento terrain>LOS; sem obstrução→null; `>` estrito; visível+obstruído===total | extrair pure; soma===totalLength (invariante) | sim | M |
| idem | `calculateProfile` (extrair um computeProfileFromElevations puro; nome sugerido, ainda não existe) | alto | FOCO: slope %; primeiro herda segundo; deltaDist=0 guard; interp losElevation | extrair pure; flat→slope 0; endpoints exatos | não | M |

### Domínio: ie-csv — CONCLUÍDO
Os três módulos (`frontend/src/js/import_export/csv/csv-parser.js`,
`frontend/src/js/import_export/csv/csv-coordinate-converter.js` e
`frontend/src/js/import_export/csv/csv-to-geojson.js`) estão cobertos por
`tests/unit/csv-import.test.js`, incluindo `parseCSV`, `parseCSVPreview`,
`detectSeparator`, `autoDetectColumnMapping`, `convertRowToLatLng` nos quatro formatos e
`csvToGeoJSON`. O bug do `_parseNumber` (o `replace(',')` que trocava só a primeira vírgula)
foi corrigido nesse lote. A escrita de CSV fica à parte, em `tests/unit/csv-escape.test.js`.

### Domínio: ie-pdf / ie-ebgeo (cartográfico — extrair privados) — CONCLUÍDO em 2026-08-24 (pdf-mosaico-grade-cartografica + pdf-export-constantes)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `pdf-cartographic-elements.js` | `_formatDMS` (extrair) | alto | **Carry seg=60** (floor min + round sec); 0→'0°N'; hemisférios | seg arredonda a 60 (flag); /^...[NSEW]$/ | sim | M |
| idem | `_findEdgeIntersection` (extrair) | alto | Cruza borda uma vez; sem cruzamento→null; **near-vertical skip**→linha vertical na borda vertical→null; pega mais próximo do meio | y dentro [min,max]; coord borda===edgeVal | sim | M |
| idem | `_clipSegment` Liang-Barsky (extrair) | alto | Dentro→inalterado; fora-sem-cruzar→null; vertical/horizontal; tMin>tMax→null | endpoints clipados dentro do retângulo (property) | sim | M |
| idem | `_niceNumber` (extrair) | alto | **value=0→log10(0)=-Inf→NaN**; snap {1,2,5}·10^k; negativo→NaN | _niceNumber(0)→NaN (flag); 1.5→2, 7→10 | sim | S |
| `pdf-export.tab.js` | `calculateBoundsFromScaleAtCenter` (extrair) | alto | cosLat correção; **lat=90→div-zero→Infinity**; antimeridiano lng>180; usable dentro do paper; simetria | usable strictly inside paper (property); lat0 vs lat60 2× | sim | M |
| `pdf-export.constants.js` | `parseScaleDenom` | médio | `'1:0'`→25000 (silencioso); sem `:`→25000; **`'1:25.000'`→25** (pt-BR ponto); não-string→throw | `'1:0'`→25000 (documenta); `'1:25.000'`→25 (flag) | sim | S |

### Domínio: processing — CONCLUÍDO em 2026-08-24 (processing-registry + processing-buffer + processing-voronoi)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `processing/processing.constants.js` | `extractBaseCoordinates` | alto | null→inalterado; <=1→inalterado; `===` estrito (float quase-igual não strip); **coord len<2→`undefined===undefined`→strip errado** | round-trip strip-of-close; idempotente | sim | S |
| idem | `registerAlgorithm`/`getAlgorithm`/`getAllAlgorithms` | médio | id falsy→throw; dup→throw; Object.freeze; snapshot isolado; **singleton module-level** | dup id→throw; getAll snapshot | não | S |
| `frontend/src/js/processing/algorithms/buffer.algorithm.js` | `executeBuffer` (via getAlgorithm) | alto | **MultiPolygon→fan-out 1 Polygon/poly**; null→skip; anel degenerado→skip; turf throw→continua; structuredClone attrs | stub turf MultiPolygon 2→2 results | não | M |
| `frontend/src/js/processing/algorithms/voronoi.algorithm.js` | `executeVoronoi` | alto | pointsOnly filtra; centroid overwrite props; **alinhamento pointSources[i] vs voronoi reordenado** (cell errada); <2→throw | stub turf; nome 'Alvo'→'Proximidade - Alvo' | não | L |

### Domínio: store-rest — CONCLUÍDO em 2026-08-24 (atlas-entity + migracao-feicao-e-zoom-de-ponto)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `store/migration/v1-to-v2.migration.js` | `migrateFeature` | alto | null→inalterado; id null→não cunha UUID; layerId 'default' literal; resolveId idempotente | mesma id 2×→mesmo UUID; 'default' preservado | sim | S |
| `store/migration/v2-to-v2.1.migration.js` | `migratePointZoomProperties` | médio | **`sizeCreatedAtZoom===0` (falsy) é clobbered p/ 10**; identidade de referência se nada muda | 0→clobber (flag); nada muda→mesma ref | não | S |
| `store/atlas/atlas.entity.js` | `reorderAtlasMaps` | alto | **`[A,A]` passa (len===Set.size + every)→dropa B**; permutação imutável; falta id→throw | dup [A,A]→não throw, dropa B (flag) | sim | S |
| idem | `isValidAtlas`/`addMapToAtlas`/`removeMapFromAtlas`/`getAtlasTerrainExaggeration` | médio | settings null→false; position clamp; `terrainExaggeration===0` preservado (`??`) | exag 0→0; remove lastActive→null | sim | S |

### Domínio: state — CONCLUÍDO
Coberto por `tests/unit/state-manager.test.js`: round-trip de `set`/`get`, `getUnsafe`,
`getShallow`, `_pathMatches`, `batchUpdate`, o throttle de `mouse.*`, a mútua exclusão
sidebar↔painel de feição, os helpers de seleção e de grupo da toolbar, `reset` e a
integração com o EventBus. As linhas de state que estavam repetidas em `## P2` saíram
junto.

### Domínio: mode — CONCLUÍDO em 2026-08-24 (application-mode-manager + ui-visibility-controller)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `mode/application-mode.manager.js` | `enterMode`/`exitMode` | alto | Modo inválido→false sem push; mesmo modo sobrescreve context; stack nested; viewerMode restore | round-trip enter/exit volta ao snapshot inicial | sim | M/S |
| `ui/ui-visibility.controller.js` | `applyProfile` | alto | Perfil desconhecido→false; callbacks só p/ mudanças; restore briefing→NORMAL re-mostra | NORMAL→briefing→NORMAL restaura baseline (property) | sim | M |

### Domínio: ie-vector — CONCLUÍDO em 2026-08-24 (import-control-decomposicao + import-normalize-migracao + export-import-helpers-puros)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes sugeridos | fast-check | Est. |
|---|---|---|---|---|---|---|
| `import_export/import.control.js` | `decomposeMultiGeometry` (via prototype.call) | alto | Multi*→N features; **GeometryCollection com geom null SKIP** (não throw); recursão aninhada; props shallow-clone | GC [Point,null,Line]→2 features; isolamento de props | sim | M |
| `import_export/export-import.service.js` | `isV1Format`/`migrateImportDataToV2`/`normalize...` (exportar) | alto | atlas→false; **NÃO injeta map id** (regressão phantom-map); idempotente; features não-array guard | migrate nunca seta mapData.id; idempotência | não | M |

---

## P2 — Risco Médio OU Coupling `mixed` (extrair primeiro)

### Domínio: draw-* (geometrias restantes) — CONCLUÍDO em 2026-08-24 (rectangle-geometry + circle-create-handles)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes | fast-check | Est. |
|---|---|---|---|---|---|---|
| `add_point_geometry.js` | `applyOffset`/`getBoundingBox`/`normalizeCoordinates` | médio/baixo | Inválido→input inalterado (no-op); JSON `'5'`→null; bbox degenerado | round-trip; `'5'`→null | sim | S |
| `label-tab.helpers.js` | `recalcLabelSize`/`hasLabelChanged` | FEITO 2026-08-24 | Backfill createdAtZoom em ambos features; ~~`===0` falsy backfill~~ (e a cópia inline em `createLabelZoomHandler` passou a delegar); clamp 255 | disabled→base; 0 clobber (flag) | sim/não | S |
| `add_circle_geometry.js` | `createHandles` | baixo | Só o que `tests/unit/circle-geometry.test.js` não pegou | posições dos handles | não | S |
| `add_rectangle_geometry.js` | `calculateDimensionsFromCorners`/`extractCornersFromGeometry` | alto | Antimeridiano center=0 errado; **AABB normaliza retângulo rotacionado** (perde rotação); width na lat central | width<height por cos; rotacionado→AABB | sim | S |
| `add_rectangle_geometry.js` | `rotateAndTranslate`/`calculateDimensionsFromRotatedCorners` (turf) | alto | **Mistura atan2 (leste=0) com turf bearing (norte=0)**; Pitágoras w²+h²=diag² | spy turf.destination; w²+h²≈diag² (property) | sim/não | M |
| `add_rectangle_geometry.js` | `generateRectangleGeometry`/`calculateCornersFromCenterAndDimensions`/`validate` | médio | borderRadius 0→5 pts; cosLat polo div; round-trip haversine vs flat diverge | swap invariante; round-trip ~1% lat baixa | sim | M |
| `add_image_geometry.js` | `calculateSelectionBoxGeometry`/`createSelectionBoxFromDegrees`/`getBoundingBox`/`normalizeCoordinates`/`validate` | alto/médio | **`effectiveZoom!==null` (0 é zoom válido, não falsy)**; padding×2; 0.625 mágico; Infinity aceito | stub uiManager; effectiveZoom=0 usado (regressão) | sim/não | S/M |
| `add_text_geometry.js` | `calculateRotationHandlePosition`/`getBoundingBox`/`moveText`/`normalizeCoordinates`/`validate`/`affectsVisuals` | médio | **`mapZoom||createdAtZoom` (mapZoom=0 cai p/ createdAtZoom)**; 111320 vs METERS_PER_DEGREE; validate==isValidPosition dup | mapZoom=0 cai (flag); validate≡isValidPosition | sim/não | S/M |

**Saíram desta tabela (Lote 1):** a extração de tamanho corrigido por zoom que estava em
`add_point_control.js` virou `frontend/src/js/tool_manager/helpers/zoom-correction.helpers.js`
(`calculateZoomCorrectedValue`, `applyZoomCorrections`, `syncZoomCorrectedProperty`), coberta por
`tests/unit/zoom-correction-helpers.test.js`; as duas linhas de `add_ellipse_geometry.js`
(`validate`, `getBoundingBox`, `calculateRotationBearing`, resize) estão em
`tests/unit/ellipse-geometry.test.js`; e `normalizeCenter`/`isValidCenter` de círculo, em
`tests/unit/circle-geometry.test.js`.

### Domínio: mil-* (restantes) — CONCLUÍDO em 2026-08-24 (military-constants + brazilian-extension-catalog)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes | fast-check | Est. |
|---|---|---|---|---|---|---|
| `military_constants.js` | `isModifier1/2Applicable`/`isEngagementBar...`/`isValidSymbolSet`/`getEchelonData` etc | médio | **allow-by-default p/ código desconhecido** (`!includes`); `isValidSymbolSet` hasOwnProperty vs `__proto__` | 'zz'→true (documenta); `__proto__`→false | não | S |
| `brazilian_extension_catalog.js` | `getCatalogEntry`/`hasSection`/`supportsCommand` etc | médio | extensionNumber 0 vs '0' (String coerção); byStandardIdentity merge; supportsCommand default true | ext 0===String(0); merge SI | não | M |
| `brazilian_svg_postprocessing.js` | `applyBrazilianLabelsToSVG`/`checkCatalogWarnings` | médio | modifier1 '00'→skip; **RegExp-injection em label com metachar**; entityExtension 0 índice real | label metachar→risco; mod2>0 sem seção→warn | não | M |
| `military_symbol_generator.js` | `extractViewBoxDimensions`/`extractTextModifiers` (exportar) | médio | **viewBox double-space→Number('')=0**; `quantity:0` mantido; whitespace `' '` vaza | double-space→{w:0} (flag); 0 mantido | não | S |
| `frontend/src/js/military_tools/arrow_tool/add_arrow_geometry.js` | `removeVertexInBranch`/`_applyHeadLengthFromHandle`/`_applyAirmobileFromHandle` | médio | branchIndex 0 sincroniza top-level; **wrap ângulo ~270 mal-classificado**; **lineLength 0→NaN não sanitizado** | branch 0 espelha; clamp NaN (flag) | sim | M |
| `frontend/src/js/military_tools/boundary_tool/add_boundary_geometry.js` | `validate`/`isValidBoundary`/`generateBoundaryCircles` (o `createLineWithGaps` já tem suíte) | médio/baixo | **3 políticas divergentes** (filter vs every vs all-or-nothing); echelon o→círculos | contraste validate≡isValidBoundary; 'oo'→2 círculos | não | S/M |
| `occupied_front_tool` | `validate`/`normalize...`/`getBoundingBox`/`destination` | médio/baixo | `normalizeBaseCoordinates`→[] vs `normalizeCenter`→null (assimétrico); NaN dist→NaN | assimetria documentada; bbox ordenado | sim | S |
| `coordination_measure_generator.js` | `escapeXml`/`estimateTextWidth`/`hasExternalText` | médio | `&` escapa primeiro; bold 0.7/normal 0.6; numero 0 presente | sem `&lt;`; numero 0→true | sim/não | S |
| `add_coordination_measure_geometry.js` | `getBoundingBox`/`affectsSIDC/TextModifiers/Visuals`/`moveSymbol` | médio/baixo | 111320 sem correção lat; conjuntos disjuntos sidc/visuals | sidc∩visuals=∅; pointCode→affectsSIDC | não | S |

### Domínio: import/export (extrações) — CONCLUÍDO em 2026-08-24 (qan-export + garmin-kmz-grade-mercator + drag-drop-classificacao)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes | fast-check | Est. |
|---|---|---|---|---|---|---|
| `import.control.js` | `getTargetType`/`generateImportName`/`uniquify` (extrair) e um stripClosingVertex extraído (nome sugerido) | médio/baixo | substring case-insensitive; counter mutação; sufixo começa em 2; **strip `===` exato** | 'POLYGON'→polygons; uniquify gap; strip 1e-9→não | sim/não | S |
| `export-import.service.js` | `roundCoordinates`/`optimizeFeature`/`xorData`/`getBlobExtension` | médio | Recursão anéis; 6 decimais; **NaN/Inf passa unrounded**; xor self-inverse | xor(xor(d))===d (property); jpeg→jpg | sim | S |
| `garmin-kmz-export.js` | `lng/latToPixel...`/`pixelToLng/Lat` (extrair mercator) | alto | Round-trip; base 512 (não 256); polo div; antimeridiano lng>180; monotônico | round-trip <1e-6; lat90→não-finito | sim | M |
| `garmin-kmz-export.js` | `_cornersToBox`/`_calculateTileGrid`/`_buildMercatorTileGrid` (stub-map) | alto | Normaliza cantos; MAX_TILES 100/MAX_CANVAS 16384→null; cobertura sem gap; ordem row-major | 4 ordens→mesma box; soma widths===total | sim | M/L |
| `frontend/src/js/import_export/qan/qan-export.js` | `generateQAN` (turf-stub) | alto | Polígono fecha (legs=n vs n-1); **normalização azimuth `<0→+360`**; observations[i]||''; ordem [lat,lng] | stub turf; bearing neg→270; closing leg | sim/não | M |
| `drag-drop.handler.js` | `classifyFile`/`truncateName` (exportar) | baixo/médio | lastIndexOf('.'); **sem ponto→substring(-1) garbage** (bug); double-ext; '.json'→GEO_IMPORT | 'noextension'→INVALID (probe); 'a.kml.txt'→INVALID | não | S |
| `pdf-cartographic-elements.js` | `_utmZone`/`_formatBarLabel`/`_formatScaleText`/`_getGridSpacing` (extrair) | médio/baixo | `_utmZone(-180)→1`,180→60,NaN→NaN; barLabel 0/'1.5 km'; scaleText '1:25.000' pt-BR | -180→1; 1500→'1.5 km'; 25000→'1:25.000' | sim/não | S |
| `pdf-export.tab.js` | `calculateA4PixelSize`/`convertMMToMapUnitsFromScale`/`_getFeatureCoord`/getters | médio/baixo | landscape/portrait swap; pixelRatio=dpi/96; UTM allowed `<` 2.5M estrito; Polygon anel vazio→undefined | dpi linear; UTM 2.5M excluído (fronteira) | sim/não | S/M |

### Domínio: terrain — CONCLUÍDO em 2026-08-24 (terreno-exagero-e-camadas-de-analise + camadas-de-dado-limites-e-estilo)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes | fast-check | Est. |
|---|---|---|---|---|---|---|
| `data-layers.manager.js` | `_calculateBounds` (extrair `calculateBounds(features)`) | alto | Vazio→null (sentinel Infinity); recursão depth arbitrária; [0,0]≠falsy; **NaN→sentinels Infinity persistem**; antimeridiano | extrair pure; todo pt dentro bbox (property); MultiPolygon≡LineString | sim | M |
| `terrain.control.js` | `getTerrainElevation` (stub map) | alto | getTerrain null→0; **`exaggeration||1.5` engole 0**; `||0` confunde null com 0; negativo preservado | stub map; (100-20)/2=40; null query→0 | não | M |
| idem | `setExaggeration`/`initExaggeration`/`terrainConfig` | médio | map null→não throw; init NÃO chama setTerrain; 0 passa sem clamp | init não chama setTerrain; exag 0→0 | não | S |
| `analysis-layers.manager.js` | `_validateLayersConfig` | médio | disabled→skip; len≠4→throw; west>=east→throw; antimeridiano west>east→throw | bounds len 3→throw; antimeridiano→throw (documenta) | não | M |

### Domínio: layers — CONCLUÍDO em 2026-08-24 (camada-nasce-com-tres-carimbos + filtro-de-camada-por-passo + fundo-de-texto-derivado)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes | fast-check | Est. |
|---|---|---|---|---|---|---|
| `layers/visibility-filter.js` | `createLayerVisibilityFilter`/`createHatchLayerFilter` | alto | **null vs [] additionalFilters** (null→ramo curto, []→spread); hatch true→2 sub-filtros/false→1; ordem VISIBLE índice 1 | filtro deep-equal; null→3 elementos | sim/não | S |
| `layers/layer.manager.js` | `isFeatureEffectivelyVisible`/`Locked` | alto | feature null→true; `visivel===false` estrito (0/''não); layer fallback `?? true`; `bloqueado:'true'` string não bloqueia | visivel=0→true (prova estrito); 'true'→não locked | não | M |
| idem | `getLayers`/`_getNextLayerOrder`/`_switchActiveLayerOnDelete`/`getUnlockedLayerIds` | médio | `order||0` ties; **vazio→0 (evita -Infinity)**; switch por ordem-Map não order-field; locked undefined→incluído | vazio→0; switch ignora order (fixar) | sim/não | M |
| `layers/styles/content.layers.js` | `toBackgroundFeatures` (exportar) | médio | showBackground+selectionBox ambos; id+'_bg'; **sem guard p/ properties undefined** | numérico id 5→'5_bg'; ambos requeridos | não | S |

### Domínio: snapping — CONCLUÍDO em 2026-08-24 (snapping-vertice-aresta-e-ctrl)
| Módulo | Símbolo | Risco | Edge cases-chave | Testes | fast-check | Est. |
|---|---|---|---|---|---|---|
| `snapping/snapping.service.js` | `closestPointOnSegment` (extrair) | alto | lenSq=0→t=0 sem NaN; clamp t∈[0,1]; vertical/horizontal | extrair; t∈[0,1] sempre; dist<=dist(a)e dist(b) | sim | M |
| idem | `extractVertices`/`extractSegments` (extrair) | alto | type desconhecido→[]; slice(0,2) strip z; **flat(2) depth**; ring.length-1 bounds | MultiPolygon→4 verts; single-vertex line→0 seg | não | M |
| idem | `interpolateLngLat` (extrair) | médio | t=0/1 endpoints; **sem wrap antimeridiano** (179→-179 dá ~0); linear | linear property; antimeridiano→0 (documenta) | sim | S |
| idem | computeEffectiveEnabled (extrair o XOR; nome sugerido) | médio | global XOR ctrl; tabela-verdade 4 combos | global!==ctrl (tabela) | não | S |
| idem | `_findBestSnap` (extrair) | alto | vertex bonus vence edge; geometry null skip; tolerância; tie primeiro | bonus 4 faz vertex 10px vencer edge 9px | não | L |

### Domínio: catalog/search/coordinates/util/userdata/briefing/store — CONCLUÍDO em 2026-08-24 (dez suites (coordenadas, id-utils, pointer-utils, config-helpers, briefing x2, catalogo, user-data, busca, navegacao))
| Módulo | Símbolo | Risco | Edge cases-chave | Testes | fast-check | Est. |
|---|---|---|---|---|---|---|
| `catalog/catalog.service.js` | `searchItems`/`_normalizeText` | alto/médio | query ''→todos; NFD accent-fold (ç NÃO decompõe); name null→sem throw; só keyword casa | 'analise'→'Análise'; '' →todos; ç sobrevive | sim | S |
| ~~`catalog.service.js` ordenação por data~~ | FEITO: a extração virou `parseCatalogDate`/`sortByDateDesc`/`formatCatalogDate`, cobertos por `tests/unit/catalog-sort.test.js` (DD/MM/YYYY, sem-data ao fim, malformado) | — | — | — | — | — |
| `config.helpers.js` | `getValidBasemapFallback`/`getEnabledBasemaps`/`validateBasemapsConfig` | alto/médio | disabled→fallback prioridade; unknown id→fallback; nenhum→'carta-topografica'; **muta singleton** | save/restore config; all-disabled→carta-topografica | não | M |
| `config.helpers.js` | `getBasemapLayoutClass` | baixo | 1-5→classes; 0/6+/NaN→default | n fora [1,5]→default (property) | sim | S |
| `search/search-bar.search-providers.js` | `featureMatchesQuery`/`getFeatureCenter` (exportar) | alto | props.name não-string→throw; sem accent-fold; **Polygon centroid inclui vértice fechamento** (skew); anel []→[NaN,NaN]; '' query casa tudo | name 123→throw (documenta); square skew | sim | S |
| `search/...` | `searchAPI`, extraindo dele um mapApiResults (nome sugerido) | alto | non-array→[]; **lng 0 incluído** (equador); '' excluído; cap 5; descrição comma-strip | lon 0→incluído (regressão); só estado→sem comma | não | M |
| `coordinate_converter.js` | `getDisplayFormat`/`formatCoordinates` (DMS/MGRS string) | alto/médio | latlong 5-dec+°; DMS 'O'/'L' não 'W'/'E'; **carry seg 60**; MGRS spacing só len 15; throw→fallback | (-22.45,-44.45,dms) lon ' O'; 0,0→'N','L' | sim/não | M |
| `id_utils.js` | `generateUniqueLayerName`/`generateUniqueMapName` | alto | Vazio→base; base presente sem sufixo→'#2'; **gap-fill lowest>=2** não max+1; **regex metachar escapado** | ['X #2','X #4']→'X #3'; 'a.b' literal | sim | M |
| `image_utils.js` | `validateImageFile` | médio | null→msg; size===max inclusivo (`>`); type case-sensitive; size 0 passa | ==max→valid; 'IMAGE/PNG'→invalid | não | S |
| `user_data_manager.js` | `validateAttributeKey` | alto | non-string→false; trim 50 boundary; **reserved casing inconsistente** ('fillColor' vaza, 'outlinecolor' casa); unicode válido | 'a'×50→valid, ×51→false; inconsistência (flag) | sim | M |
| `user_data_manager.js` | `extractAttributesFromImport` (mock sanitizeHtml) | alto | desc keys case-insensitive 1º-vence; system props case-SENSITIVE; **0/false mantidos, null dropado**; `attributes`→`attributes_imported` | {count:0,ok:false,missing:null}→{count:'0',ok:'false'} | não | M |
| `pointer-utils.js` | `getTouchesDistance`/`Angle`/`Midpoint` | médio | <2→0 (dist/angle) / first (midpoint); **len 0 midpoint→throw**; graus não rad; simétrico | (3,4)→5; vertical→90°; <2→0 | sim | S |
| `feature_navigation_utils.js` | `extractAllCoordinates` (extrair) | médio | Point/Line/Polygon/MultiPolygon flatten; [lng,lat,z] mantém; null→[]; strings não-push | Polygon→flatten; MultiPolygon depth-4 | sim | M |
| `briefing.operations.js` | `reorderSlides`/`addSlide` (mock repo) | alto | **position===length→append não splice** (off-by-one); omitidos→append; order 0..n-1 sem gaps; dup id consome 1× | permutação→multiset igual + order [0..n] (property) | sim | M |
| `briefing.operations.js` | `generateUniqueBriefingName` | médio | **gap-scan primeiro-livre não max+1**; sem colisão→base | ['X','X (2)']→'X (1)' (prova gap) | não | S |
| `briefing/validation/reference-validator.js` | `_validateSlide` e um isLegacy360Position extraído (nome sugerido) | alto | 360 \|lat\|>90 legacy; lat===90 não (estrito); **lng 0 não-ausente** (meridiano); modo→severidade (3D ERROR, 2D WARNING) | extrair; lng 0 lat 0→sem NO_POSITION (regressão); modo bogus→INVALID_MODE | não | M |
| `briefing/export/pdf-page-composer.js` | computeCropRect (extrair; nome sugerido) | alto | srcAspect vs target; rounding cropX+cropW<=srcW; aspecto extremo; target 0/NaN | extrair; (3000,1000,1)→cropW 1000; dentro bounds (property) | sim | M |
| `analysis/...selection-highlight` (dup) | (ver draw-text) | — | já listado em P1 draw-text | — | — | — |
| `wmm_calculator.js` | `calculateMagneticDeclination` (mock geomagnetism) | alto | lat/lng ±90/±180 inclusivo; **NaN coord passa guard** (sem isFinite); altitude clamp Math.max(0,-5); arredonda 2dp/1dp | vi.mock geomagnetism; 91→null; NaN→não-null (flag) | não | M |
| `wmm_calculator.js` | `checkWMMValidity`/`dateToDecimalYear`/`roundTo` (exportar) | alto/médio | Fronteiras 2025.0/2030.0; **Invalid Date→valid:true** (NaN); ano bissexto 366; DST skew | extrair; 2025-01-01→true; Invalid Date→true (flag) | sim | S |
| `frontend/src/js/attribute_table/services/table-data.service.js` | `filterFeatures`/`sortFeatures`/`getCellValue` | alto | selectedOnly+vazio→[]; tipos coerce String(); vazios ao fim; natural sort; **0/false não-vazio** | selectedOnly vazio→[]; 'item2'<'item10'; 0 ordena | sim/não | M |
| `features_tab/feature-organizer.service.js` | `flattenAndSortFeatures`/`countTotalFeatures` (mock @store) | médio/baixo | storageType desconhecido filtrado; `?? true` não guarda false; sort pt-BR | visivel false preservado; accent pt-BR sort | sim | S/M |
| `phone/phone-layout.js` | `_getFeatureCentroid` (extrair→geometry-centroid.js) | alto | Point strip z; **Polygon inclui vértice fechamento** (skew); Line floor(len/2); null→null | extrair (dedup c/ search); square skew documentado | não | M |
| `deep-link/deep-link.js` | `parseDeepLink`/`buildShareUrl360/3D` (stub window) | alto/médio | hash vazio→null; param faltando→NaN não 0; round-trip toFixed precision | round-trip build→parse dentro precisão (property) | sim | S/M |
| `mode/application-mode.manager.js` | `setViewerMode`/`reset`/predicados | médio/baixo | inválido→false sem mutação; mesmo→false sem emit; mútua exclusão | exatamente 1 predicado true (invariante) | sim | S |
| `ui-visibility.controller.js` | `register`/`toggleElement`/`defineProfile` | médio | callback faltando→skip; late-join hide; `?? true` default; **defineProfile muta PROFILES global** | toggle 2×→identidade; default true | sim | S/M |
| `frontend/src/js/tool_manager/clipboard_manager.js` | `generateUniqueFeatureName` e um computeOffset extraído (nome sugerido) | alto/médio | '- Cópia N' incremento; **'X - Cópia abc'→double-suffix**; unicode ó; cosLat polo singularidade | 'X - Cópia 5'→'6'; lat0 dx===dy | sim/não | M |
| `frontend/src/js/tool_manager/hatch_pattern_generator.js` | `getConfigFromProperties`/`getCacheKey`/`getPatternId` | médio | **spacing/lineWidth 0 falsy→default 8/2**; case hex →cache-miss; fillColor>hatchColor | spacing:0→8 (flag); '#ff'≠'#FF' keys | sim | S |
| `analysis/...` | `extractCenterFromGeometry`/`generateWedgePolygon`/`generateSectorGeometry` (turf-stub) | médio | **média de vértices ≠ centroid** (double-count fechamento); anel fechado; numArcPoints | empty→null; ring fechado | não | M |

---

## P3 — Baixo / Cosmético

| Módulo | Símbolo | Risco | Nota | Est. |
|---|---|---|---|---|
| `add_point_geometry.js` | `getBoundingBox`/`getCenter`/`validate` | baixo | Guards triviais; dobrar no suite de geometry | S |
| `add_line_geometry.js` | `insertVertexAtIndex`/`isPointTooClose`/`calculateTotalLength`/`createHandles` | baixo/médio | Splice quirks; additividade haversine; contagem handles 2N-1 | S/M |
| `add_brush_geometry.js` | `createLineStringGeometry`/`normalizeCoordinates`/`calculateTotalLength`/`getCenter` | baixo | getCenter retorna `points[0]` (não centroid — documentar) | S |
| `add_text_geometry.js` | `validateText`/`generatePointGeometry` | baixo | trim whitespace; dropa z | S |
| `add_image_geometry.js` | `isValidPosition` (dup de validate) | baixo | Equivalência paramétrica | S |
| `add_occupied_front_geometry.js` | `getBoundingBox`/`calculateCenter`/`updateFeatureForMove` | baixo | center=p1 (não centroid); imutabilidade | S |
| `military_constants.js` | `getMainIcons`/`getModifier1/2`/`getAllSymbolSetCodes` | médio | Invariante: todo code→Array | S |
| `coordination_measure_generator.js` | `generatePointGeometry` | baixo | dropa z; nova array | S |
| `add_coordination_measure_control.js` | resolveActualPointCode (extrair; nome sugerido) | médio | ECHELON fallback duplicado 3× | M |
| `declination_svg_generator.js` | `generateDeclinationSvg` | médio | Threshold 0.1/8 fronteiras; NaN vaza p/ legenda; snapshot determinístico | M |
| `svg-to-png.js` | computeImageFit (extrair; nome sugerido) | médio | Letterbox/pillarbox; dim 0→throw; centragem | M |
| `add_declination_geometry.js` | `calculateSelectionBoxGeometry`/`generate` | baixo | stub uiManager; anel fechado; strip altitude | S |
| `line_profile.js` | `formatLength` | médio | Fronteira 1000m toFixed(2); 999.999→'1000.00 m' quirk | S |
| `los_tool` | `extractCoordinatesFromGeometry`/`generateProcessedFeatures`/`formatDistance` | médio | Multi vs Single; toFixed(2) vs panel toFixed(1) divergência | S |
| `visibility` | `normalizeFeatureProperties`/`normalizeCenter`/`translateGeometry`/`getCachedElevation` | baixo/médio | bearing 0 vs angle legacy; cache key 5-dec colisão; translate dropa z | S/M |
| `store/migration/v1-to-v2.migration.js` | `migrateFeatures` | médio | non-object→as-is; non-array value passthrough | S |
| `streetview360.operations.js` | `filterActiveEntries`/`setStreetview360DataForImport` merge (extrair) | médio | soft-delete excluído; markers regeneram id | S/M |
| `cesium3d.operations.js` | `getNextAutoNumber`/`removeByTileset` (exportar) | médio | vazio→1; max+1 não first-free; regex anchored | M |
| `grid/grid-layers.config.js` | `GRID_LAYERS`/`lineLayerId`/`labelLayerId` (exportar) | médio | latlong label dropa '4326', utm mantém 'utm' (assimetria); 16 IDs/sistema; sem dup | S |
| `coordinate_converter.js` | `getPlaceholderForFormat` | baixo | Self-consistência: placeholder parseável | S |
| `mouse-coordinates.control.js` | formatElevation/shouldShowElevation (extrair; nomes sugeridos) | baixo | Math.round(NaN); gate null+enabled | S |
| `search/feature-search.control.js` | `_filterValidSuggestions`/`_search3DModels` (extrair para módulo puro) | baixo/médio | 3d-model bypass; lon 0 incluído; keywords divergência | S |
| `briefing.operations.js` | `createEmptySlide`/`createEmptyBriefing`/`importBriefings` | baixo | id fresco; settings copy isolada; createdAt===updatedAt | S |
| `briefing/validation/reference-validator.js` | `ValidationResult`/`ValidationError` | baixo/médio | severidade routing; getSummary sem leading comma; slideIndex+1 display | S |
| `briefing/presentation` | `_getTransitionHandler` e um shouldUseInstant extraído (nome sugerido) | médio | 9 pares modo; first-load→instant; forward→animated | S |
| `mode` | `createApplicationModeManager`/`getApplicationModeManager` (singleton) | baixo | vi.resetModules p/ instância fresca | S |

---

## Fase 2 (precisa jsdom / canvas / MapLibre / Cesium) — NÃO recomendar agora

Todos coupling `dom`/`maplibre`/`cesium`/`canvas`; valor de teste como lógica pura é baixo ou exige harness pesado:

- **Controls MapLibre (IControl):** todos `add_*_control.js` (point/line/polygon/circle/ellipse/rectangle/sector/text/image/brush, military, arrow, boundary, occupied_front, coordination_measure, declination, visibility, los) — `map.getSource/setData`, pointer events, RAF, snapping, store I/O.
- **Canvas/Image:** `point-marker-symbols.js`, `military_symbol_generator` PNG pipeline, `svg-to-png.js` (convert*), `hatch_pattern_generator` (createPatternImageData/draw*), `image_utils` (compressImage/createThumbnail/processImageFile), `pdf-cartographic-elements.composeLayout` + todos `_draw*`, `quill-helpers` (DOMParser/DOMPurify), `pdf-page-composer.stripHtmlToPlainText`.
- **DOM builders:** todos `*_attributes_panel.js`, `*.section.js`/`*.modal.js`, sidebar/*, modals/*, toolbar/*, context-menu/*, bottom-controls/*, features_tab/*.component.js, vector_info/*, ui/* (exceto controllers puros), search-bar component, phone views, attribute_table renderers/filters, catalog components, briefing editor/presenter/text-panel.
- **MapLibre source/layer:** `layers/styles/*.layers.js` (definições estáticas + ensureLayer), `measurement-labels.js`, `grid.control.js`, `terrain` toggle/zoom methods, `snapping showIndicator/hideIndicator`, `data/analysis-layers.manager` add/toggle layer methods.
- **Async-IO + store (integração, não unit puro):** import/export `handleImport/handleExport` (JSZip/IndexedDB/GDAL), `processing-runner`, briefing slide-capture/tile-preloader/transition handler bodies, cesium3d/streetview360 CRUD wrappers, store group.operations (delegação guard já-coberta).
  (`tab-lock.js` saiu desta lista: o protocolo de arbitragem entre abas é coberto por
  `frontend/tests/unit/tab-lock.test.js`, com transporte falso injetado. O que segue sem
  cobertura ali é só o overlay, que é DOM.)
- **html-escape.escapeHtml** (document.createElement) — XSS, alto valor mas precisa jsdom.

---

## Pular / Baixo Valor

- **Dados estáticos:** `military_tools/data/*.js`, `coordination_measure_constants.js`, `layer.helpers.js` constantes, `baselayers/*` (estilos/URLs WMS/XYZ hardcoded — sem função montando URL), `carta_ortoimagem.js`. No máximo um smoke-test de integridade estrutural.
- **Wrappers triviais já-cobertos:** `BaseGeometry.calculateDistance`/`calculateMidpoint`/`getCenter`, todos os `calculateDistance`/`calculateBearing` que delegam a `geometry-utils` (haversine já testado), `searchCoordinates` (wrapper de coordinate_converter já-coberto).
- **No-ops intencionais:** `brush.createHandles`/`updateFromHandle` (retornam []/null), delegadores `group.operations`.
- **Predicados de 1 linha:** `needsPerFeatureImage`, `getSymbolIds`, `hasImageResource` pluralização, `generateGeoJSONId` (não-determinístico Date.now+random).
- **Barrels `index.js`** (excluídos de coverage).

---

## Notas Transversais (aplicar em todos os P1/P2)

1. **`x ?? 0` / `x || default` NÃO protegem contra NaN.** Padrão recorrente confirmado em: `calculateZoomCorrectedValue`, `recalcLabelSize`, `add_circle/ellipse/visibility.validate` (NaN/Infinity radius/aperture), `wmm_calculator` (NaN coord), `terrain.exaggeration||1.5` (engole 0), `_niceNumber(0)→NaN`. **Sempre fixar comportamento atual com teste e marcar com flag** para a correção ser deliberada.
2. **Antimeridiano (±180) não tratado** em praticamente todo bbox/midpoint/centroid/applyOffset/interpolateLngLat/calculateBearing local. Documentar como limitação conhecida, não como bug a corrigir no teste.
3. **`===` estrito vs float quase-igual** em `isPolygonClosed`/`extractBaseCoordinates`/snapping — fixar.
4. **fast-check** é ideal para: round-trips (normalize JSON, build/parse SIDC, build/parse deep-link, applyOffset ±d, mercator pixel↔lng), invariantes (bbox containment, anel fechado, batch dedup, perimeter reverso, `_pathMatches` prefix, ganho-perda=Δnet, w²+h²=diag², perfil restore), e monotonicidade (zoom-corrected size, distance step múltiplo de 30).
5. **Extrações recomendadas (refactor barato, alto payoff), em ordem.** Duas já foram
   feitas e servem de modelo: a correção de tamanho por zoom, que estava duplicada quatro
   vezes e virou `frontend/src/js/tool_manager/helpers/zoom-correction.helpers.js`, e a
   ordenação por data do catálogo, que virou `parseCatalogDate`/`sortByDateDesc` em
   `frontend/src/js/catalog/catalog.service.js`. Continuam pendentes (nomes abaixo são
   sugestões, nenhum existe ainda): classifyRay/detectObstruction/computeProfileFromElevations
   (análise militar) · helpers privados pdf-cartográficos (`_formatDMS`/`_clipSegment`/`_findEdgeIntersection`/`_niceNumber`) ·
   mercator garmin · um calculateBounds puro extraído do `_calculateBounds` de
   `frontend/src/js/terrain/data-layers.manager.js` · um módulo geometry-centroid consolidando
   `_getFeatureCentroid` + `getFeatureCenter` duplicados · helpers snapping · encode/decode
   da engagement-bar.

---

## A suíte de Playwright NÃO está verde, e não é desta fase

Medido em 2026-08-16, rodada completa: **242 passaram, 12 falharam, 6 flaky, 1 pulado** (261
casos, 39 min). Onze das doze falham IGUAL no `src/` anterior à fase multi-aba, verificado
restaurando aquele `src/` e rodando os mesmos specs. Ou seja, elas já estavam quebradas e
ninguém sabia: a camada de Playwright fica FORA do `npm test` e é cara demais para rodar por
hábito, então nada as reportava.

**Isto precisa de dono.** Vários descrevem propriedades sérias, não detalhes de UI.

| spec | o que ele afirma |
|---|---|
| `browser-import-batch` | ATOMICIDADE: uma op inválida no lote reverte o push INTEIRO |
| `browser-cascade-atomicity` | exclusão de camada leva as feições dela e poupa as outras |
| `browser-lock-authz` | a trava de mapa bloqueia escrita de terceiro (409) e nega delete (403) |
| `browser-feature-types` | cada um dos 18 tipos cai exatamente no seu bucket do snapshot |
| `browser-analysis-tools` | tipo de análise não suportado é RECUSADO na escrita |
| `browser-context-duplicate-combine-split` | cortar linha cria duas metades; origem ruim é recusada |
| `browser-undo-redo` | ida e volta de create/delete, e idempotência por `op_id` |
| `browser-idle-timeout` (2 casos) | a sessão ociosa avisa e expira |
| `viewer-3d-open` (2 casos) | o visualizador 3D abre e fecha |
| `presence` | os quadros de awareness chegam ao par e aparecem no roster |

O décimo segundo (`browser-logout-clears-map.repro`) é **flaky**, também antes da fase.

**Recomendação de método, aprendida aqui:** rodar a bateria de navegador ao menos por marco, e
não só quando alguém desconfia. Onze regressões acumuladas em silêncio é o custo de uma camada
que ninguém exercita, e a mesma constituição que exige controle negativo em teste de nó não tem
como alcançar o que nunca roda.
