# Auditoria A — o que ainda estamos devendo

Escrita contra o CÓDIGO, não contra o plano nem contra o relatório da fase. Tudo que está aqui
foi medido nesta sessão; onde não deu para medir, está dito que não deu.

**Linha de base reconfirmada agora, 5 rodadas em série:** `3992 passando | 2 expected fail | 4 todo (3998)`,
5/5 idênticas. `src/` limpo antes e depois de cada mutação (`git diff --stat` conferido).

---

## Aviso de método: a árvore de trabalho é COMPARTILHADA com outro agente

Durante esta auditoria, `git diff` pegou pelo menos quatro mutações vivas em `src/` que não são
minhas e que sumiram sozinhas minutos depois:

- `frontend/src/js/store/atlas-namespace.js:510`, `perAtlas: true` → `false` (a fila física desligada);
- `frontend/src/js/store/local-atlas.api.js` (+14/-1);
- `frontend/src/js/store/migration/migration.service.js` (+2);
- `frontend/src/js/index.js` (+10).

Consequências práticas, e elas contaminam qualquer número desta fase:

1. **Uma medição minha foi envenenada e eu a retiro.** Com a mutação do `perAtlas` viva eu li a
   suíte inteira verde (3992) e quase registrei "a fila física não tem controle negativo". Refiz
   sozinho, com janela curta e `git diff` antes e depois: a mutação derruba **12 casos em 2 arquivos**.
   A conclusão anterior era falsa por contaminação, não por lógica.
2. **Três das minhas mutações (M1, M2, M6) rodaram enquanto `migration.service.js` estava mutado
   pelo outro agente**, então `tests/integration/migracao-22-para-23-fixture-real.test.js` aparece
   vermelho nas três e **não é atribuível a mim**. Descontei nas contagens abaixo.
3. **A "linha de base medida agora" do enunciado (3992/2/4, 16 rodadas) pode ter sido medida com
   uma mutação viva.** Ela bate com a minha, então provavelmente não; mas "bate" não é "foi
   medida limpa". Enquanto duas sessões escreverem na mesma árvore, nenhum número de nenhuma das
   duas é auditável sem um `git diff` colado ao lado.

---

## DEVENDO

### D1. O aviso TEARDOWN é enviado por UM dos dois caminhos que significam "a sessão acabou"

`announceRemoteTeardown` (`frontend/src/js/account/account.control.js:221`) tem **exatamente uma
chamada** em todo o `src/`: `frontend/src/js/account/account.control.js:1144`, dentro do ramo
`else` de `_handleLogout`.

O outro caminho que roda a MESMA varredura destrutiva é a guarda de boot,
`frontend/src/js/store/store.js:244` (`enforceLocalStoreWhenLoggedOut` → `discardRemoteAtlasNamespaces`),
e ela **não avisa ninguém**. O comentário de `frontend/src/js/store/store.js:183-186` diz, com
todas as letras, que os dois são os dois lugares que significam "a sessão acabou"; o aviso só
existe em um deles.

Onde isso morde: no ramo `forced` (`frontend/src/js/store/remote-atlas.api.js:432-437`), em que o
prazo de 24 h expirou e o namespace é destruído **com a montagem viva**. Aí a aba vizinha é
destruída sem nenhum aviso, que é precisamente o buraco que o protocolo TEARDOWN existe para
fechar. Custo para fechar: uma linha em `store.js:244` (o mesmo `await announceRemoteTeardown()`
antes da varredura), mais o teste.

### D2. `degraded` continua sem leitor (furo #6 do backlog), e agora custa mais

`grep -rn degraded frontend/src/js` fora de `tab-lock.js` devolve **um JSDoc**
(`frontend/src/js/account/account.control.js:218`) e o módulo de KML, que é outra coisa. Sem
`BroadcastChannel` e sem `localStorage` o lock desliga e **concede**, e o único sinal é um
`console.warn` (asserido em `frontend/tests/unit/tab-lock-refutacao.test.js:420-434`).

Isto era tolerável enquanto qualquer par remoto colidia. Depois de E7 o lock é a **única** coisa
que impede duas abas de abrir o mesmo atlas, e é `granted` que autoriza `clearAllDataStore()`.
Um lock degradado agora concede a duas abas do mesmo atlas, e ninguém vê.

### D3. Não há prova de navegador para o requisito

Está dito no próprio commit (`c27cc930`) e eu confirmo: `frontend/tests/e2e-ui/browser-multi-tab-namespace.spec.js`
(686 linhas) e `frontend/tests/e2e-ui/browser-multi-tab-teardown-queue.spec.js` (521 linhas)
existem e **nunca rodaram**. Duas abas num teste de node são dois grafos de módulos no mesmo
processo: o próprio expurgo (`frontend/src/js/store/remote-atlas.api.js:365`) solta a **própria**
montagem antes de perguntar, então num processo só é impossível modelar "a vizinha segura" sem
sair do módulo e pegar o `navigator.locks` na mão (foi o que fiz na sonda B abaixo). Um dos dois
specs já tem flake medido de 1 em 6 por timeout (`frontend/tests/TESTING-BACKLOG.md:112`).

---

## MEIO FEITO

### M1. O resgate parou de mentir, mas não parou de perder o dado

`it.fails` de `frontend/tests/unit/multiaba-invariantes.test.js:883`. **Promovido a `it` e medido:**
ele falha por `AssertionError: expected null to deeply equal { atlas: X }` na ÚLTIMA asserção
(a do dado), nunca por import ou setup. É defeito real e aberto.

O que a fase entregou (`frontend/src/js/account/account.control.js:153-167`): a falha não marca
mais LOCAL, devolve `false`, e o toast passou a dizer a verdade
(`frontend/src/js/account/account.control.js:1124-1129`). O que **não** entregou: o namespace
continua reivindicado pelo registro REMOTO, então a próxima carga deslogada o destrói. O usuário
lê "NÃO foi possível guardar... Não feche esta aba" e o trabalho depende de ele obedecer a um
toast. A alegação da fase é "resgate que falha alto"; ela é sobre o AVISO, e o enunciado a lista
junto das que preservam dado.

Falta: um destino de última instância para o trabalho não resgatado (exportar `.ebgeo` para
download, ou um slot local de emergência que não dependa da mesma escrita de registro que acabou
de falhar).

### M2. O `it.fails` do import ficou mal ancorado: E3 fechou e ele não se mexeu

`frontend/tests/unit/multiaba-invariantes.test.js:1003`, "o projeto importado sobrevive à próxima
carga deslogada". **Promovido e medido:** falha com `expected [] to not deeply equal []` — o
sentinela não está em banco nenhum. Ele diz "FECHA EM: E3", e E3 fechou.

Por que ele não ficou vermelho: o cenário é construído à mão por
`importarComAtlasDeServidorAberto` (`frontend/tests/unit/multiaba-invariantes.test.js:940-952`),
que **não chama o import de verdade** — escreve no escopo ativo depois de um `clearAllAtlasStores`
+ `markStoreLocal`. E3 mudou o CHAMADOR (`_prepareNonAdditiveTarget`,
`frontend/src/js/import_export/export-import.service.js:751-779`), não o expurgo. O caso assere
uma propriedade do expurgo que continua verdadeira e que **nenhuma correção de E3 poderia
derrubar**: ele nunca vai forçar a própria promoção.

Medido pelo outro lado: mutar `_prepareNonAdditiveTarget` de volta para o wipe no lugar
(`if (!isRemoteStoreSync())` → `if (true)`) derruba
`frontend/tests/integration/import-ebgeo-atlas-local.test.js` e **não toca** neste `it.fails`.
Ou seja, o guarda de E3 é aquele outro arquivo; este aqui é um `it.fails` órfão do seu próprio
plano. Ação: reescrevê-lo chamando `_prepareNonAdditiveTarget`, ou apagá-lo e deixar o guarda
onde ele de fato está.

### M3. O backlog dos furos do tab-lock afirma o mundo antigo em uma linha

`frontend/tests/TESTING-BACKLOG.md:95`, furo #5: *"A fila de saída é **global**, não por atlas"*.
Isso está fechado. Medido: `perAtlas: true` → `false` em
`frontend/src/js/store/atlas-namespace.js:510` derruba **12 casos** em
`tests/unit/operation-queue-namespace.test.js` e `tests/integration/operation-queue-lifecycle.test.js`.
A linha 95 é a única do backlog que descreve o mundo pré-fase, e é a que mais engana: ela está
numa tabela intitulada "furos ABERTOS". Os furos #1 a #4 conferi contra o código e continuam
abertos de verdade (ver abaixo).

---

## FEITO, NÃO PROVADO

Cada linha: a mutação que apliquei, e quantos casos a suíte inteira perdeu com ela. Baseline
3992/2/4. Onde a contagem inclui `migracao-22-para-23-fixture-real.test.js`, ela está contaminada
pelo outro agente e eu marco.

| alegação | mutação aplicada | casos vermelhos | veredito |
|---|---|---|---|
| fila FÍSICA por atlas | `atlas-namespace.js:510` `perAtlas:true→false` | **12** (2 arquivos) | provado |
| varredura remota existe | `remote-atlas.api.js:363` `entries.length === 0` → `>= 0` (no-op) | **41** (6 arquivos) | provado |
| retenção remoto×remoto REMOVIDA de `keysCollide` | `tab-lock.js:586` volta a reter | **14**, dos quais 6 são contaminação; atribuíveis: `tab-lock.test.js`, `tab-lock-refutacao.test.js`, `tab-lock-atlas-integration.test.js` | provado |
| expurgo POUPA o namespace montado | `remote-atlas.api.js:425` `if (result.spared)` → `if (false && …)` | **13**, 6 contaminados | provado |
| prazo de 24 h no spare | `remote-atlas.api.js:426` `overdue` → sempre false | **10** (4 arquivos) | provado |
| aviso TEARDOWN (emissor) | remove `announceRemoteTeardown()` de `account.control.js:1144` | **7** (5 arquivos) | provado |
| freio do RECEPTOR | `applyTeardownFreeze` devolve `false` de cara | **3** (1 arquivo) | provado, estreito |
| resgate falha alto | `account.control.js:166` `return false` → `return true` | **5** (3 arquivos) | provado |
| import cria atlas local | `export-import.service.js:752` `if (!isRemoteStoreSync())` → `if (true)` | **11**, 6 contaminados → ~5 em `import-ebgeo-atlas-local.test.js` | provado |
| ponteiro de montagem por ABA | `store-origin.js:303` devolve só o `fallback` | **6** (5 arquivos) | provado |
| migração com escopo como ARGUMENTO | `migration.service.js:101` ignora o argumento e usa `legacyScope()` | **6** (1 arquivo) | provado |
| varredura chamada POR NOME no logout | remove `discardRemoteAtlasNamespaces()` de `account.control.js` | **2** (2 arquivos) | fraco, ver abaixo |
| wipe com alvo explícito (`clearQueue` desacoplado de `markLocal`) | `store.js:379` `clearQueue = markLocal` → `= true` | **1** (1 arquivo) | fraco |
| expurgo poupa o slot ADOTADO | `remote-atlas.api.js:411` `if (claimed.has(...))` → `if (false && …)` | **2** (2 arquivos) | fraco |
| registro com UMA CHAVE POR SLOT | `local-atlas.api.js:156` passa a apagar as outras chaves antes de escrever | **1** | **não provado** |

### A alegação sem controle: "uma chave por slot nos dois lados"

A mutação que simula o array único (a escrita de um slot destrói a entrada dos outros) derruba
**um único caso**, e por acidente: `frontend/tests/unit/multiaba-invariantes.test.js:902`
("o registro em memória nunca afirma um slot que não chegou ao disco"), que compara memória com
disco e só nota porque a contagem passa a divergir. **Nenhum teste assere a propriedade que a
mudança existe para dar**, que é: *duas abas cujas sessões morrem juntas resgatam ao mesmo tempo e
as DUAS entradas sobrevivem*. É exatamente o cenário citado em
`frontend/src/js/store/local-atlas.api.js:174-181` como a razão de ser da mudança.

**A mutação que faltaria (e o teste que ela cobraria):** dois `adoptRemoteAtlasAsLocal` (ou dois
`createLocalAtlas`) **intercalados** — ler o registro nos dois, escrever nos dois — e asserir que
`readLocalAtlasRegistry()` devolve os DOIS `dbSuffix`. Com uma chave por slot passa; com o array
único (a mutação acima) reprova. Hoje esse teste não existe, então "uma chave por slot" é prosa
com um teste vizinho que a tangencia.

Nota do mesmo tipo, mais fraca, para os três "fraco" da tabela: `clearQueue` desacoplado tem um
guarda só (`operation-queue-wipe-de-entrada.test.js`), e "poupa o slot adotado" tem dois casos que
morrem juntos. São controles reais, mas de um fio só.

### Os quatro `it.todo`: conferidos contra o código, e os quatro são honestos

`frontend/tests/unit/tab-lock-refutacao.test.js:164, 398, 406, 418`. Não converti (um `it.todo`
não tem corpo para converter); conferi cada um no código:

- **#1 (`granted` por ausência de prova)** — `acquire` continua concedendo antes do settle, e é
  ele que autoriza o wipe em `frontend/src/js/account/open-atlas.service.js:323`. Aberto.
- **#2 (sem fencing)** — `_evaluate`/`_livePeers` inalterados. Aberto.
- **#3 (bfcache)** — `frontend/src/js/utilities/tab-lock.js:811-812` ainda é
  `const leave = () => this._postLeave();` em `pagehide`, sem olhar `event.persisted`, e um
  `grep pageshow` no arquivo devolve **zero**. Aberto, exatamente como descrito.
- **#4 (quem cedeu não reassume)** — `frontend/src/js/utilities/tab-lock.js:1290` ainda é
  `if (!blocker && this._blocked && !this._yielded && !this._frozen)`. Aberto.

E os quatro **pesam mais** depois de E7: eram "o pior caso são duas abas remotas, que colidem de
qualquer jeito"; agora duas abas do mesmo atlas dependem só desse protocolo.

---

## PERDA DE DADO

Três cenários. Os dois primeiros eu **construí e medi** com sondas temporárias
(`tests/unit/_auditoria-a-temp.test.js` e `_auditoria-b-temp.test.js`), cada uma com controle
negativo que passa; as duas sondas **foram apagadas** depois de lidas.

### P1. Resgate seguido de reabrir o MESMO projeto: perde o resgate E fura a invariante dura

Gestos: (1) a sessão cai com trabalho pendente no atlas X → o resgate adota o namespace como
projeto local "Trabalho recuperado"; (2) o usuário entra de novo e **abre o projeto X do
servidor** — que é o gesto que o próprio toast sugere.

`openRemoteAtlas` (`frontend/src/js/account/open-atlas.service.js:317`) chama
`activateRemoteAtlas(X)` (linha 375) e **em seguida** `clearAllDataStore({ markLocal: false })`
(linha 387). Como o slot resgatado tem sufixo `remote-X`, o escopo ativo é o do próprio resgate:
o wipe de entrada cai sobre ele. Nada em `registerRemoteAtlas`
(`frontend/src/js/store/remote-atlas.api.js:189-209`) pergunta se um slot LOCAL já reivindica
aquele sufixo.

**Medido (a):** o trabalho resgatado vira `null` depois do wipe, e o slot local **continua
listado** em "Seus projetos" — o usuário abre "Trabalho recuperado" e encontra um projeto vazio.

**Medido (b), e é o pior:** a partir daí o namespace está reivindicado pelos DOIS registros. No
logout seguinte, `purgeOneRemoteAtlas` (`frontend/src/js/store/remote-atlas.api.js:411-416`) vê
`claimed.has(dbSuffix)`, classifica como `adopted`, remove só a chave remota e **preserva os
dados**. Resultado medido: `relatorio.adopted === [X]`, `relatorio.atlases === []`, e o
`snapshot-do-servidor` continua legível depois do expurgo. Isso viola a invariante escrita em
`frontend/src/js/store/remote-atlas.api.js:17-18` ("no data belonging to a server atlas survives a
logout"), **para sempre** e para todo boot seguinte, porque a entrada local nunca é removida
sozinha.

Controle negativo da sonda (passa): sem o resgate, o mesmo dado é destruído (`databaseState → absent`).

Conserto mínimo: `registerRemoteAtlas` (ou `openRemoteAtlas`) consultar
`describeRemoteNamespaceClaim(atlasId)` — que já existe,
`frontend/src/js/store/atlas-namespace.js:463` — e recusar/renomear quando a resposta for
`'local'`.

### P2. Obedecer ao aviso TEARDOWN é o que destrói a aba vizinha

Gestos: aba A no atlas X, aba B no atlas Y, mesmo usuário, B com uma feição desenhada e ainda não
enviada. O usuário clica "Sair" na aba A.

`applyTeardownFreeze` (`frontend/src/js/store/sync/tab-lock-sync-brake.js:217-234`) faz
`await releaseMountLock(scope)` na linha 228. A montagem era **exatamente** o que poupava B do
expurgo (`frontend/src/js/store/remote-atlas.api.js:423-431`). Ao obedecer, B troca "poupada" por
"destruída".

**Medido, com controle:**

| | `spared` | dado de B | fila de B (`ebgeo__remote-Y`) |
|---|---|---|---|
| CONTROLE: B segura a montagem | `[Y]` | sobrevive | banco existe |
| B solta a montagem (o que o freio faz) | `[]`, e `atlases: [Y]` | `null` | `absent` |

A fila vai junto porque `OPERATION_QUEUE` é `perAtlas: true`
(`frontend/src/js/store/atlas-namespace.js:510`) e `dropAtlasDatabases` varre todo `perAtlas`.
Ou seja: o logout de UMA aba apaga a fila de saída de OUTRA — que é o defeito nomeado no commit
como corrigido ("a aba A trocar de projeto destruía as operações pendentes da aba B"), reaberto
por outra porta. B não tem resgate: `preserveUnsyncedWorkAsLocal` só roda na aba que desloga.

O aviso continua sendo um ganho (antes B escrevia num namespace já condenado e recriava bancos
fora do registro). O que falta é o passo seguinte: B deveria **drenar ou adotar** antes de soltar,
não só congelar. `applyTeardownFreeze` é o lugar, e ele já é `async` e já devolve um booleano que
o emissor espera.

### P3. Resgate que falha (o `it.fails` de M1)

Já descrito. Sequência: sessão cai involuntariamente + a escrita do registro falha (cota, IDB) →
o trabalho fica num namespace ainda reivindicado pelo registro remoto → a próxima carga deslogada
o apaga. Medido pela promoção do `it.fails`.

### Caminhos que eu percorri e NÃO produziram perda

- **Fila da aba A destruída pela troca de projeto da aba B**: fechado de verdade. Com a fila
  física, `unmountCurrentAtlas` de um escopo não alcança o banco do outro (12 casos vermelhos sob
  a mutação).
- **`saveLocalToServer` do slot resgatado**: as ops antigas ficam encalhadas em
  `ebgeo__remote-X` e **não** são enviadas ao atlas novo, então o `foreignAtlasDenialReason` do
  backend nunca as recusa. Encalhe, não perda (o conteúdo sobe inteiro pela rota REST).
- **Visitante de link público**: o wipe deixou de consultar a sessão; a varredura por nome não é
  alcançada pelo caminho anônimo.

---

## COERÊNCIA ENTRE OS DOIS PACOTES

Conferido e **coerente**, com uma ressalva de contrato que já está escrita no lugar certo.

- `atlasId` e `scopeSuffix` são carimbados na fábrica
  (`frontend/src/js/store/sync/operation-factory.js:432, 463`) e declarados no schema do backend
  (`backend/src/modules/sync/sync.schemas.js`, bloco novo do commit).
- Eles **não são persistidos**, e o backend diz isso por extenso no próprio schema: o INSERT usa o
  atlas da ROTA e uma lista fixa de colunas, então os campos sobrevivem à validação, viajam no
  rebroadcast e **não voltam no pull**. Existe teste backend para isso:
  `backend/tests/integration/sync-carimbo-de-atlas.test.js:133` ("os campos atravessam a validação
  mas NÃO são persistidos").
- O único uso servidor é `foreignAtlasDenialReason` (recusa por operação, 200 + `rejected`, nunca
  400 de lote), com os três casos cobertos no mesmo arquivo (linhas 69, 80, 91, 124).
- No cliente, **ninguém lê esses campos numa op RECEBIDA**: `grep` por `.scopeSuffix` / `op.atlasId`
  em `frontend/src/js` devolve só a fila (`operation-queue.js:121, 431`) e a migração da fila
  (`operation-queue-migration.js:106`). Nenhuma guarda de cliente foi construída sobre a presença
  deles no inbound, que é o erro que o comentário do schema antecipa.

Não rodei a perna backend nem a e2e (precisam de PostgreSQL + PostGIS); a leitura acima é de
código e de teste, não de execução.

---

## O QUE EU VERIFIQUEI, COM NÚMEROS

- **Suíte frontend**: 5 rodadas em série limpas, 5/5 em `3992 | 2 expected fail | 4 todo (3998)`.
- **Inventário de `it.todo` / `it.skip` / `it.fails` fora do Playwright**: 2 `it.fails`
  (`multiaba-invariantes.test.js:883` e `:1003`) e 4 `it.todo`
  (`tab-lock-refutacao.test.js:164, 398, 406, 418`). Os `describe.skipIf` de `tests/e2e/**` são o
  portão de ambiente do banco, não cobertura vazia. Bate com o `2 expected fail | 4 todo` do sumário.
- **Os dois `it.fails` promovidos a `it` e executados**: os dois falham por `AssertionError` na
  asserção final, nenhum por import/setup. Revertidos pelo caminho inverso (Edit de volta),
  `git diff --stat` limpo.
- **15 mutações de controle negativo aplicadas e revertidas**, cada uma com a suíte inteira
  (tabela acima). Uma delas — "uma chave por slot" — derruba 1 caso e por acidente.
- **2 sondas de cenário** escritas, executadas, lidas e **apagadas**; cada uma com um controle
  negativo que passa (P1: sem resgate o dado morre; P2: com a montagem viva o dado sobrevive).
- **Buscas negativas**: `pageshow` em `tab-lock.js` → 0; leitor de `degraded` fora do lock → 0;
  leitor de `atlasId`/`scopeSuffix` no inbound → 0; `GlobalKey.LOCAL_ATLASES` fora dos caminhos de
  migração → 0 (nenhum teste afirma o registro em array como mundo corrente).

## O que eu NÃO cobri

- Playwright (proibido nesta passada): D3 continua sendo a maior dívida de prova.
- Backend e e2e de contrato executados (sem banco no ar).
- `tests/e2e-ui/helpers/two-tabs.js` (755 linhas) lido só por amostragem.
- Contenção real de `versionchange` entre abas de verdade, que é onde `blocked` deixa de ser
  hipótese.
