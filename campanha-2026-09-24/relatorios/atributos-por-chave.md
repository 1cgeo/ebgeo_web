# Atributos por chave (hunt/atributos)

Início: 2026-09-24 08:52. Worktree `C:\Users\diniz\ebgeo_hunt\navegadores`, branch `hunt/atributos` a partir de `origin/integracao_backend` (06f9569e).
Obs.: o primeiro `git switch -c` criou o branch e atualizou índice e árvore, mas não moveu o HEAD; conferido que índice e árvore batiam 100% com 06f9569e (0 diferença), e o `git switch hunt/atributos` completou sem tocar em nada. `hunt/navegadores` intacto em 5315da1e.

## Diagnóstico
(em curso)

### Onde moram os atributos
- Atributos personalizados: `feature.properties.attributes`, um objeto chave → string (`user_data/user_data_manager.js`: `setAttribute`, `removeAttribute`, `renameAttribute`, todos por `_updateFeature` → `updateFeature(..., { transform })` sob a trava do documento). A tabela de atributos lê e escreve o mesmo objeto (`attribute_table/services/table-data.service.js`). Colunas reservadas (`nome`, `descricao`, etc.) são chaves próprias de `properties`.

### Como a op de UPDATE de feição carrega a mudança (cliente)
- Protocolo 2, patch por CAMINHO (`store/sync/feature-patch.js`, `featureMutationContract`): `geometry` é uma unidade e **cada chave de `properties` é uma unidade**, "incluindo arrays e objetos aninhados". Logo `properties.attributes` inteiro é UMA unidade: excluir "x" e mudar "y" viajam os dois como `{op:'set', path:['properties','attributes'], value:{...objeto inteiro...}}`. A op declara `baseVersion` (o `confirmedVersion` local) e, encadeada, `baseOperationId`.

### Como o servidor aplica
- NÃO é LWW nem merge raso de jsonb: `backend/src/modules/sync/feature-conflicts.js`, `prepareFeatureMutation`, é base-e-revisão por caminho. Lê a fronteira durável por unidade (`readFieldFrontier`, `sync_entity_fields`), e um caminho escrito depois da base declarada é DISPUTADO: a op inteira é recusada com `RAZAO_CAMPOS_DISPUTADOS` ("Os mesmos campos foram alterados no servidor."). Sem disputa, funde o patch sobre a linha viva (`set` substitui a chave, `remove` apaga) e publica a feição CANÔNICA inteira (log, broadcast e `canonicalOperation` do recibo).
- `validPatchEntry` só aceita caminho `['geometry']` ou `['properties', chave]` (comprimento 2). O Joi (`sync.schemas.js`) já aceita até 8 segmentos.

### Como o cliente aplica a op remota
- `remote-operation-handler.js`: FEATURE está em `CONVERGENCE_GUARDED`. Com edição local pendente da mesma feição, a op remota é ADIADA; no recibo, `resolveLocalEdit(s)` aplica a `canonicalOperation` do servidor (o documento fundido) e repassa as adiadas pelo guarda de versão (a mais velha cai). Ou seja, o recebedor substitui a feição inteira pelo canônico, e o canônico é o que o servidor fundiu. Com o servidor fundindo por chave, o autor e o par convergem para a fusão sem mudança no aplicador de entrada.

### Onde a mudança do outro se perde
1. A exclui "x" e B muda "y" a partir da mesma base: as duas ops disputam a MESMA unidade `["properties","attributes"]`. A que chega depois é RECUSADA como conflito (não sobrescreve), vira problema durável e segura as operações seguintes da mesma feição. A edição de B não chega ao servidor nem ao colega.
2. Na tela de pendências, "Reaplicar" cria uma op nova com o conteúdo local da tentativa (o objeto `attributes` INTEIRO de B, com "x" ainda dentro) e a base do recibo de conflito: aceita, ela ressuscita "x" e desfaz a exclusão de A. Esse é o "a última sobrescreve a lista inteira".
3. Mesmo para duas chaves DIFERENTES alteradas (x contra y), o desfecho é o mesmo, porque a unidade é o objeto.

### Divergência com a descrição da tarefa (avisada ao coordenador)
- "Disputa na MESMA chave vale LWW por chegada, como no resto": no código, o resto das propriedades de feição NÃO é LWW; mesma chave a partir da mesma base é RECUSADA (conflito), e o LWW por chegada só vale para ops SEM base declarada (protocolo antigo). O conserto torna a unidade a CHAVE do atributo e mantém a regra da casa para a mesma chave (conflito), que é a mesma de `nome`, `descricao` e qualquer outra propriedade.

## Conserto (em curso, NÃO commitado)
- Servidor, `backend/src/modules/sync/feature-conflicts.js`: `validPatchEntry` aceita `['properties','attributes',chave]` (recusa `__proto__`, `constructor`, `prototype`; o nome vazio já é 422 no Joi); `writtenAt` lê a fronteira com a sobreposição chave x bolsa (a chave é disputada por escrita posterior da chave OU da bolsa; a bolsa, por ela mesma OU por qualquer chave); fusão na bolsa viva (`ownAttributeBag`), sem criar bolsa numa exclusão; bolsa + chave dela no mesmo patch é recusado. Os outros caminhos leem a fronteira exatamente como antes.
- Cliente, `frontend/src/js/store/sync/feature-patch.js`: `featureMutationContract` manda uma entrada por chave de atributo (`remove` explícito), bolsa ausente lida como vazia; a bolsa inteira (formato antigo) só quando ela some, não é objeto, ou tem chave que o servidor recusaria.
- Cliente, `frontend/src/js/store/feature.operations.js`: `keepLaterEdits` (desfazer/refazer) lê a bolsa por chave (`keepLaterAttributeEdits`).
- "Reaplicar" das pendências: sem mudança de código; o patch da op nova é recalculado pela fábrica, então já sai por chave (repro próprio em `pendencias-acoes.test.js`).
- Tabela de atributos (célula, adicionar e remover coluna) e importação: sem mudança de código; passam por `userDataManager` -> `updateFeature` -> contrato. Cobertos pelos testes abaixo.
- Docs: entrada nova em `docs/decisions/decisions-2026.md` + linha em `DECISIONS.md`; parágrafo "Na feição, a unidade é o CAMINHO do patch" + linha de Histórico em `docs/wiki/modelo-conflito-lww.md`.

## Provas já medidas
- Contrato (vitest contra o backend real) `frontend/tests/e2e/atributos-por-chave.e2e.test.js`, 8 casos: 8/8 verde com o conserto; revertido o conserto (3 arquivos), 5 vermelhos (excluir x vs y; x vs y; op por chave; mesma chave; importação .ebgeo pelo servidor) e 3 verdes (os dois do formato antigo e o `__proto__`, que já valiam antes).
- Backend `backend/tests/integration/atributos-por-chave.repro.test.js`, 10 casos: 10/10 verde; servidor revertido, 6 vermelhos.
- Unit `frontend/tests/unit/atributos-por-chave.test.js` (10) + `pendencias-acoes.test.js` (caso novo "reaplicar ... não ressuscita"): verdes; revertido, 6 vermelhos (inclui o de reaplicar).
- Playwright `frontend/tests/e2e-ui/atributos-por-chave.repro.spec.js`, 3 casos (aba: excluir x vs y; aba: x vs y; TABELA: remover coluna x vs célula y), duas browsers, B sem rede: 3/3 verde no Chromium com o conserto; revertido, 3/3 vermelho ("o servidor não guardou as duas mudanças").
- Lint dos arquivos tocados (eslint): verde.

## PRÓXIMO PASSO (estado exato em 2026-09-24 09:33, pausa pedida pelo coordenador)
- HEAD: 06f9569e (branch `hunt/atributos`). NADA commitado desta tarefa.
- Arquivos não commitados: `backend/src/modules/sync/feature-conflicts.js`, `frontend/src/js/store/sync/feature-patch.js`, `frontend/src/js/store/feature.operations.js`, `frontend/tests/integration/pendencias-acoes.test.js`, `docs/decisions/decisions-2026.md`, `docs/decisions/DECISIONS.md`, `docs/wiki/modelo-conflito-lww.md`; novos: `backend/tests/integration/atributos-por-chave.repro.test.js`, `frontend/tests/e2e/atributos-por-chave.e2e.test.js`, `frontend/tests/unit/atributos-por-chave.test.js`, `frontend/tests/e2e-ui/atributos-por-chave.repro.spec.js`.
- Cópias do conserto (para controle negativo): scratchpad `fix-atributos/*.fixed`.
- Em execução no fundo quando pausou (os logs ficam no scratchpad): specs vizinhos no Chromium (`viz-chromium.log`: atributos-por-chave, attribute-table, browser-collab-atributo-recusado, browser-collab-crdt-conflict, browser-collab-renomear-atributo, browser-feature-attributes, cobertura-aba-atributos, cobertura-atributos-colaboracao, cobertura-atributos-travessia, cobertura-exportar-tabela-csv, cobertura-tabela-centenas, desfazer-preserva-edicao-do-par, tabela-de-atributos-* (3), trava-de-camada-e-grupo-pela-arvore-e-tabela) e o backend inteiro (`backend-full.log`, TEST_DB_NAME=ebgeo_test_nav).
- FALTA PROVAR / FAZER:
  1. `docs-integridade` REPROVA "todo símbolo citado entre crases existe": algum trecho entre crases que acrescentei na decisão ou na wiki (suspeitos: `['properties','attributes',chave]`, `op: 'remove'`, `['properties','attributes']`) não é símbolo do código. Rodar `npx vitest run tests/unit/docs-integridade.test.js` (de `frontend/`), ler a lista e trocar por prosa.
  2. Ler o resultado de `viz-chromium.log` e `backend-full.log` (piso de cobertura incluso).
  3. Rodar os mesmos vizinhos no Firefox: `npx playwright test $(cat /tmp/vizinhos.txt) --project=firefox --retries=0 --workers=1` (de `frontend/`, com EBGEO_UI_E2E_APP_PORT=4337 EBGEO_UI_E2E_BACKEND_PORT=3927 DB_USER=postgres DB_PASSWORD=postgres).
  4. Frontend inteiro: `EBGEO_SEM_PESO_CONSTRUIDO=1 npm test --prefix frontend`; lint dos dois pacotes (`npm run lint --prefix frontend`, `npm run lint --prefix backend`).
  5. Commit ÚNICO por caminho, índice vazio (`git diff --cached` vazio antes), mensagem `fix(sync): custom attributes converge per key ...`, avisar o coordenador.
- Opcional, se houver tempo: spec de navegador de desfazer de atributo com o colega mexendo em outra chave (hoje coberto só no unitário de `keepLaterEdits`).

### Resultado que chegou depois da pausa (09:50), SEM trabalho novo
- Vizinhos no Chromium (`viz-chromium.log`, --retries=0): **45 verdes, 1 vermelho**. O vermelho é `cobertura-atributos-colaboracao.spec.js:118` ("A exclui uma chave enquanto B, com o envio represado, muda OUTRA: a de A vale e a de B fica para revisão"). Esse caso da frente de camadas AFIRMA O DEFEITO: ele espera que chaves diferentes virem disputa guardada para revisão (o comentário dele cita "caminho de profundidade 2" em `validPatchEntry`). Com o conserto as duas mudanças ficam e não há problema na fila, então o caso reprova por construção. PRÓXIMO PASSO nº 0: reescrevê-lo para a regra nova (servidor `{ cota: '20' }`, os dois clientes iguais, fila de B sem problema) e manter nele a disputa só para a MESMA chave, dizendo no commit por que mudou.
- Backend inteiro (`backend-full.log`): ainda rodando quando esta linha foi escrita.
- Backend inteiro com o conserto (`backend-full.log`, TEST_DB_NAME=ebgeo_test_nav): **5700/5700 verdes**, 0 cancelados, piso de cobertura verde (statements 98,36%, branches 90,09%, functions 96,97%), EXIT 0. Item 2 do PRÓXIMO PASSO fica feito para o backend; falta o `lint` do backend.

## Retomada (12:12)
- Commit local temporário + `git rebase origin/integracao_backend` (14a32949), sem stash; conflito só nos dois arquivos de decisão (append dos dois lados, mantidos os dois); o commit temporário foi desfeito com `reset --mixed` e o índice ficou vazio.
- `cobertura-atributos-colaboracao.spec.js`: o caso que afirmava o defeito virou "A exclui uma chave enquanto B, com o envio represado, muda OUTRA: as duas valem" (servidor, os dois clientes, fila de B sem problema) e ganhou o irmão "A e B mudam a MESMA chave: a de A vale e a de B fica para revisão" (a disputa que continua).
- Crases que não são símbolo (o caminho do patch e a remoção explícita) trocadas por prosa na decisão e na wiki; `docs-integridade` verde.
- Depois do rebase e com o conserto: frontend inteiro 917 arquivos / 16202 casos verdes (`EBGEO_SEM_PESO_CONSTRUIDO=1`); backend inteiro 5701/5701 verdes, piso de cobertura verde; lint dos dois pacotes verde; contrato (6 arquivos: atributos-por-chave, attribute-custom, undo-redo, concurrent-update-converge, lww-arrival, edicao-encadeada-por-entidade) 18/18.
- Vizinhos no Chromium (18 arquivos, inclui os dois novos do upstream `cobertura-atributos-aba-aberta-colega` e `cobertura-tabela-colunas`): **52/52 verdes**, --retries=0. Firefox rodando.
- Firefox, os mesmos 18 arquivos: **51 verdes + 1 pulado por desenho** (caso "Chromium:" de `tabela-de-atributos-sobrevive-ao-f5`), --retries=0.
- Controle negativo do caso reescrito de `cobertura-atributos-colaboracao`: com o conserto revertido, "muda OUTRA: as duas valem" fica vermelho ("o servidor não guardou as duas mudanças") e "a MESMA chave" continua verde (é a regra que não mudou).

## COMMIT: 788d0d37 `fix(sync): custom attributes of a feature converge per key (owner's decision)` (sobre 14a32949, índice vazio antes, 12 caminhos). Worktree limpa.

### Linha proposta para o livro-razão
- 2026-09-24: o pedido de "atributos por chave" descrevia o modelo atual como "LWW por chegada, como no resto"; o código é base e revisão por caminho, com a mesma chave recusada. O diagnóstico foi lido antes de mudar e a divergência foi levada ao coordenador; codificado em `backend/tests/integration/atributos-por-chave.repro.test.js` (a mesma chave continua conflito).

## Seguimentos da revisão (13:07-14:xx), hunt/atributos rebaseado sobre origin/integracao_backend cf1e4f97
(0167b7d3 é o 788d0d37 reaplicado; conflito só nos dois arquivos de decisão, append mantido dos dois lados.)
1. 5c931bae fix(sync): bolsa inteira encadeada não apaga a chave de um colega. Na bolsa inteira as chaves da fronteira são lidas contra a base DECLARADA, excluída a versão da antecessora imediata (`resolveObservedBase` devolve `predecessorVersion`). Repro backend + controle (a própria chave do autor não disputa); revertido: repro vermelho, controle verde.
2. 583f3678 fix(undo): desfazer o primeiro atributo desfaz. `preserveUserData` pulado quando há `revertFrom`. Repro pelo caminho real (ação gravada pelo próprio `updateFeature` + a chamada exata do motor) em `tests/store/feature-operations.test.js` e spec de navegador `desfazer-atributo.repro.spec.js` (botões da barra, Chromium e Firefox verdes); revertido: os dois vermelhos. Vizinhos de desfazer no Chromium 10/10.
3. ad9cff0d test(sync): espelho de `ATTRIBUTES`/`UNSAFE_ATTRIBUTE_KEYS` (exportados dos dois módulos), no molde do sync-trace-espelha-backend; controle negativo: deriva no servidor 3 vermelhos, no cliente 1 vermelho.
4. 5bfeaf87 fix(sync): só `__proto__` é recusado, nos dois lados; "constructor"/"prototype" são chaves próprias. Repros backend, contrato e unitário vermelhos antes, verdes depois. Inclui o nit (linha em branco no e2e).
Verificação depois da última escrita: backend 5704/5704 (piso verde), frontend 16214 verdes, contrato 274/274 (72 arquivos), lint dos dois verde.
