# Fase multi-aba (agosto de 2026): o plano, como executado

> **Este documento e o REGISTRO DA FASE, nao uma proposta viva.** Ele foi escrito como plano,
> executado entre 2026-08-15 e 2026-08-16, e mora aqui porque o codigo o CITA: as sete decisoes
> de desenho, os degraus (E0 a E7) e os defeitos numerados (D1 a D5) sao o vocabulario que
> `frontend/tests/e2e-ui/browser-multi-tab-*.spec.js`, `frontend/tests/unit/multiaba-invariantes.test.js`
> e `frontend/tests/e2e-ui/helpers/two-tabs.js` usam para dizer o que estao provando. Apagar o
> documento deixaria nove citacoes penduradas.
>
> **O que decidiu esta fase esta condensado em [`decisions-2026.md`](decisions-2026.md)**, nas
> entradas de 2026-08-15 (namespace por atlas; fila por atlas). Onde os dois divergirem, vale a
> entrada de decisao, e acima dela o codigo. O que sobra aqui e a alternativa rejeitada por
> extenso, a ordem de execucao e as medicoes, que nao cabem numa entrada de log.
>
> Ele viveu no proprio pacote do frontend, como _PLANO-multiaba.md, ate 2026-08-16, junto de tres relatorios de sessao
> (_AUDITORIA-FINAL.md, _E0-relatorio.md e _ESTADO-DA-FASE.md) que foram apagados no mesmo
> commit: o que eles tinham de durável ja estava em `frontend/tests/TESTING-BACKLOG.md` (os
> furos abertos, com escopo declarado) e no [`livro-razao.md`](../livro-razao.md).

> **Revisado em 2026-08-15 após decisão do dono.** Duas mudanças, ambas registradas no corpo:
> não existe hipótese de revert do deploy (§4), e a fila vai para banco separado NESTE ciclo,
> o que reordena as etapas e absorve E8 (§D5, §2, §E2B). O veredito abaixo é o da síntese
> original e segue valendo.

**Veredito: o plano P1–P6 foi SUBSTITUÍDO.** Ele está ordenado por camada, apoia a decisão mais destrutiva do store num relógio que o próprio código já declara não confiável, e duas das seis peças introduzem perda de dado nova (P1b apaga a fila do atlas que está sendo aberto; P2 faz `purgeReachedAtlas` esvaziar o slot local). O desenho da peça P0 é melhor nos dois pontos que decidem, e a refutação de corrida o corrobora por caminho independente. O plano abaixo é reescrito em torno dele. As três decisões do dono continuam sendo o requisito; o que muda é o mecanismo.

---

## 1. As sete decisões de desenho (com a alternativa rejeitada nomeada)

### D1 — Montagem é um Web Lock, não um roster nem um lease
**Adotado:** ao ativar um escopo, a aba toma `navigator.locks.request('ebgeo-atlas:'+dbSuffix, {mode:'shared'})` com promessa que só resolve no desmonte. Destruir um namespace exige o mesmo nome em `{mode:'exclusive', ifAvailable:true}`; se não vier, alguém tem montado, pula-se e a entrada do registro sobrevive para o próximo boot.

**Rejeitados:** (a) roster do tab-lock (P2 v1) e (b) lease persistido em `ebgeo_global` (P2 v2).

**Por quê, com evidência.** Os dois são relógio, e o código tem duas janelas em que o relógio mente por construção: entre `activateBootAtlasScope` (`store.js:243`, dentro de `initializeWithLastActiveMap`) e `initTabLock` (`index.js:205`) corre um `Promise.race` de até 15 s (`index.js:191`), maior que qualquer TTL de três batidas (`tab-lock.js:325-328`); e o `pagehide` posta RELEASE sem checar `persisted` (`tab-lock.js:308`, `:712`), então a aba em bfcache é declarada morta viva. Some a isso o modo degradado, em que o roster fica permanentemente vazio (`tab-lock.js:699-705`), e o fato de o expurgo de boot rodar antes de o tab-lock existir. O Web Lock não tem nenhum desses: é fato do navegador, é liberado pela morte da aba e não pelo silêncio dela, e a aba congelada MANTÉM o lock, que é exatamente o caso que o lease erra.

**Verificado, não suposto** (node v24.13.1, o runtime da suíte): `navigator.locks` existe; com um `shared` segurado, `exclusive ifAvailable` devolve `false`; em outro nome devolve `true`; depois de soltar, `true`. Ou seja, o mecanismo se prova com o primitivo DE VERDADE num teste unitário, enquanto o lease só se prova contra um simulador. O precedente de caminho degradado já existe e já foi aceito na casa (`api-client.js:385-396`).

**O que o Web Lock NÃO é, e fica escrito:** não é fencing. Ele diz "alguém vivo tem montado", não impede que o dono continue escrevendo depois de perder a corrida. Por isso D3 (aviso de desmontagem + freio) continua necessário. E em contexto não seguro (HTTP puro) o lock não existe: nesse caso o expurgo volta ao comportamento atual (destrói), o que é a escolha correta porque o invariante duro vence a conveniência.

### D2 — Registro único de atlas; `store-origin.js` é APAGADO, não demovido
**Adotado:** um `atlas-registry.js` com uma chave por slot (`local_atlas:<id>` / `remote_atlas:<id>` fundidos num só formato `{id, name, dbSuffix, remoteId|null}`), sem espelho autoritativo em memória.

**Rejeitado:** P4 como escrito ("a origem deixa de ser fonte paralela"). Módulo que existe é chamado: os chamadores de `isRemoteStoreSync`/`markStoreRemote` (`store.js:206`, `open-atlas.service.js:333`, `account.control.js:825`) continuariam podendo escrever uma verdade que discorda do registro. A justificativa de circularidade (`store-origin.js:21-25`) morre quando o registro decide o escopo, e `getGlobalStore()` já resolve sem escopo nenhum (`atlas-namespace.js:435-437`).

**Também rejeitado:** o `GlobalKey.CURRENT_SCOPE` que a peça P0 propôs. Sob o requisito 3, "que atlas esta aba monta" é pergunta POR ABA e não pode ter resposta global: com um ponteiro global, a aba A dá F5 e monta o atlas da aba B (`local-atlas.api.js:278-281` já faz isso hoje via marcador). Resolução de montagem, em ordem: `?atlas=` na URL → ponteiro em `sessionStorage` carimbado com `tabId` → dica global de "último usado", lida só quando as duas primeiras não respondem.

**Uma chave por slot é obrigatório, não estético.** O registro local hoje é um array sob uma chave, com espelho carregado uma vez (`local-atlas.api.js:97-98`, `:136-143`, `:380-382`). Duas abas cujo refresh token é revogado juntos resgatam ao mesmo tempo e a segunda apaga o resgate da primeira, deixando um namespace que nenhum expurgo enxerga. O próprio registro remoto já documenta essa razão (`remote-atlas.api.js:23-29`) e o local a ignora. Sem isto, P5 pode devolver "falhei" corretamente e ainda assim perder o trabalho.

### D3 — O portão é dono do wipe, e o wipe recebe alvo explícito
**Adotado:** `clearAllAtlasStores(scope)`, `unmountCurrentAtlas(scope)`, `clearAllDataStore(scope, token)` — três assinaturas, não 800 call-sites. `activateScope` (`atlas-namespace.js:485`) vira interno; o único export que monta é `mountAtlas(entry)`. O portão executa a desconexão dentro de si (`stopAutoFlush` → `syncEngine.disconnect` → confirmar fora de ONLINE → ativar destino → wipe mirado), porque o chamador esquece: `store.js` inteiro não tem uma referência a `syncEngine`, e é por isso que o import `.ebgeo` empurra o arquivo para o projeto do servidor.

**Rejeitado:** P3 como disciplina de chamada com guarda por varredura de fonte. Enquanto `clearAllDataStore` for export do barrel (`store.js:277`, importado por cinco arquivos) e a mira for feita por ORDEM DE INSTRUÇÕES (`open-atlas.service.js:374` antes de `:383`, dito em comentário), o portão reabre no próximo import e nenhum teste vê.

### D4 — `saveLocalToServer` COPIA, nunca adota o namespace
**Rejeitado:** adoção local→remoto. Não é só impossível (o sufixo é recalculado a partir do id em `remote-atlas.api.js:105` e `:180`), é ativamente destrutiva: `clearAtlasDatabases` chama `getStoreFor().clear()`, que CRIA o banco inexistente (`atlas-namespace.js:550-557`), então o expurgo fabrica dez bancos vazios, relata `cleared`, empurra o id em `report.atlases`, e `purgeReachedAtlas` devolve `true` fazendo o guarda PULAR o wipe do atlas realmente montado. Um expurgo que fabrica o que diz destruir é um verificador que mente.

### D5 — A fila é FÍSICA por atlas, e as suas pré-condições passam à frente na ordem

**Decidido pelo dono em 2026-08-15, revertendo o adiamento que a síntese propunha:** a fila
vira `OPERATION_QUEUE.perAtlas = true` (`atlas-namespace.js:268`) NESTE ciclo. A razão dada é
de produto, não de engenharia: o produto não foi lançado, está em débito de estrutura, e a
arquitetura fecha antes do lançamento. Mexer nisso depois é custo que não se quer pagar duas
vezes.

A consequência é de ORDEM, não de escopo: os cinco contras abaixo são pré-condições, e cada um
é apagado por uma etapa que já existe no plano por outro motivo. Elas deixam de ser
paralelizáveis e passam a bloquear a fila. Nada é adiado; a fila é que se move para depois delas.

O carimbo de identidade continua (cada op carrega `dbSuffix` e o `atlasId` de servidor), mas
muda de papel: com o banco separado, o isolamento é a estrutura, e o carimbo vira defesa em
profundidade, lido pelo backend e pelo resgate. O filtro do `peek` deixa de ser a linha de
defesa e passa a ser asserção.

**Um ganho que só aparece com o banco separado, e que a análise anterior não tinha visto:**
`adoptRemoteAtlasAsLocal` move zero bytes e preserva o sufixo, então a fila do atlas resgatado
é adotada JUNTO com o dado, de graça. Hoje a fila é global e o resgate não a leva, isto é, o
usuário recupera as feições e perde o registro do que não subiu. Com a fila dentro do
namespace, esse registro sobrevive e pode drenar se o mesmo atlas for reconectado.

**As cinco pré-condições, com a etapa que as resolve:**
1. `listAtlasStores` filtra por `perAtlas` (`atlas-namespace.js:474-478`) e `clearAllAtlasStores` é derivado dela (`repository.js:331-338`). O wipe que `openRemoteAtlas` roda em `:383`, três linhas depois de `activateRemoteAtlas` em `:374`, passaria a destruir a fila DO ATLAS QUE ESTÁ SENDO ABERTO, antes do `connect` que a drenaria. A fila que P1 preservou na saída morre na volta, calada.
2. `enableOperationLogging()` é incondicional no boot (`services.js:81`), então passariam a existir até 10 filas locais que nenhuma rota pode empurrar.
3. A migração dessas ops é inalcançável: `detectMigrationNeeded` abre `ebgeo_app_settings`/`ebgeo_atlas` por nome FIXO no load do módulo (`migration.service.js:17-18`) e roda uma vez por boot (`repository.js:258`), contra o slot legado, que pode não ser o montado.
4. O `_index` é estado de módulo preso ao escopo anterior (`operation-queue.js:64`, `:82-93`), e `dequeue` conta remoção pelo índice enquanto `peek` lê do disco (`:150-173`).

5. Hoje `unmountCurrentAtlas` (`store.js:138-143`) faz `clearAllAtlasStores()` E `operationQueue.clear()`, e o segundo apaga a fila INTEIRA, de todos os atlas. Com duas abas, a aba A trocando de projeto destrói as operações pendentes da aba B, e o que se perde é o payload da entidade (`data` em `createOperation`), isto é, a feição que o usuário desenhou e ainda não subiu. Este é o defeito mais grave do grupo B e o único alcançável pelo gesto mais comum do produto.

**Mapa pré-condição → etapa que a resolve:**

| pré-condição | resolvida por |
|---|---|
| (1) o wipe de entrada não pode incluir a fila do atlas que abre | E1 (wipe com alvo) + E3 (portão dono do wipe) |
| (2) atlas local não pode gerar op órfã | D6, dentro de E2B |
| (3) a migração precisa alcançar cada slot | E5 (migração por slot) |
| (4) `_index` preso ao escopo anterior | E2B, e é o único que exige conserto próprio |
| (5) `operationQueue.clear()` total | E1 (alvo explícito), e some por construção com o banco separado |

### D6 — Corte de `enableOperationLogging` fora de conexão
Movido de `services.js:81` para o `connect` (`sync-engine.js:224` já o chama). Atlas local não gera op: `saveLocalToServer` não usa ops, faz upload do store inteiro, e o resgate só lê a fila com atlas remoto montado. Isso elimina a categoria inteira de "op órfã de contexto não-UUID" que hoje é filtrada na saída (`operation-dispatcher.js:133-139`).

### D7 — A verificação é instrumento, e o instrumento entra primeiro
`environment: 'node'` (`vitest.config.js:29`), sem `fake-indexeddb`, `typeof indexedDB === 'undefined'`: nenhum teste do repositório executa uma linha de IndexedDB. `grep -rn indexedDB tests/e2e-ui/` devolve ZERO. `context.newPage()` para uma segunda aba não aparece uma vez: as 16 ocorrências de `browser.newContext()` são PERFIS, não abas. O requisito 3 tem cobertura zero em todas as camadas. Nada disso pode ser consertado depois: sem instrumento não há portão.

---

## 2. Ordem de execução

**Reordenada em 2026-08-15 pela decisão da fila física.** A fila deixou de ser uma etapa
paralela e barata e passou a ser a ÚLTIMA das etapas de estrutura, porque suas cinco
pré-condições vivem em E1, E3 e E5. Em troca, ela entra completa e não volta a ser tocada.

```
E0 (instrumento) ──> E1 (wipe com alvo) ──> E3 (portão único) ──> E4 (registro único)
                            │                                            │
                            └──> E2 (Web Lock + expurgo) ────────┐       ├──> E5 (migração por slot)
                                                                  │       └──> E6 (resgate falha alto)
                                                                  │                    │
                                        E2B (fila física + carimbo) <─────────────────┘
                                                                  │
                                                                  └──> E7 (remover a espera)
```

Paralelizável de verdade: **E2** (Web Lock, mexe em `remote-atlas.api.js` + `tab-lock.js`) com
**E3/E4** (portão e registro), depois de E1. **E5** e **E6** entre si, depois de E4. O resto é
serial por dependência real, e E2B é agora o penúltimo passo, não o primeiro.

E8 foi ABSORVIDA por E2B: não existe mais uma etapa opcional de "mover os bytes depois".

---

### E0 — Instrumento (nenhuma linha de `src/`)

**Faz:**
1. `fake-indexeddb` nas devDependencies e ligado no setup do vitest para os testes de namespace. É a única forma de `blocked`, `versionchange` e a recriação silenciosa pelo localforage saírem do campo da suposição.
2. Re-medir a Decisão 4 (`atlas-namespace.js:121-142`, "21 de 21 pendentes") com o localforage real segurando o banco. O `localforage` instala `db.onversionchange = e => e.target.close()` (`node_modules/localforage/dist/localforage.js:653-659`) e reconecta e recria a transacao logo em seguida (localforage, linhas 808-820), o que contradiz a medição citada. **Resultado e data vão para o `@fileoverview`; se a válvula não disparar, a Decisão 4 é reescrita como não medida e nada no plano pode depender de `blocked`.**
3. Dividir o ATAQUE 1b: hoje ele morre na primeira linha (`_refutacao-fiacao.test.js:146`, o `keysCollide`), então a carga útil (`:152-163`, a varredura de uma aba apagando o namespace vivo da outra) NUNCA foi executada. O furo que motiva metade do plano é hipótese derivada de leitura, não reprodução. A asserção do predicado sai para o arquivo do predicado; o ataque roda com duas ativações diretas.
4. Substituir o ATAQUE 1a (`:93-101`): medi que, quebrando a âncora final, o corpo recortado passa de 4407 para 19315 caracteres e as quatro asserções continuam verdes. É verificador que quebra calado. Trocar por asserção de efeito (`getStore(MAPS).__dbName` + `listRemoteAtlases()`).
5. Corrigir a tautologia do ATAQUE 4 (`:366-367`: a MESMA expressão dos dois lados, que nenhuma implementação pode reprovar).
6. Harness de DUAS PÁGINAS NO MESMO CONTEXTO (`ctx.newPage()` duas vezes), lendo o endereço por `page.evaluate(() => indexedDB.databases())`, com `retries: 0` para esses specs (`playwright.config.js:34` tem `retries: 1`, que reporta corrida real de duas abas como flaky, isto é, verde).
7. Acrescentar a `browser-save-local-to-server.spec.js` a leitura de `indexedDB.databases()` depois do save. Esta spec é VERDE hoje com o furo aberto, porque só assere fatos do servidor (`:74-75`, `:88-94`, `:114`).

**Arquivos:** ~8 (`package.json`, `vitest.config.js`, `playwright.config.js`, `tests/setup*`, `_refutacao-fiacao.test.js`, `browser-save-local-to-server.spec.js`, 2 helpers novos).

**Portão:** a spec nova de duas abas, com o código de HOJE, tem que ficar VERMELHA no caso A1 (aba em X e aba em Y simultâneas) e VERDE no controle negativo A2 (duas abas no mesmo atlas, a segunda bloqueada). **O que a faria vermelha indevidamente:** se A2 passar por o predicado ter virado sempre-falso em vez de por bloqueio real, o portão não vale. Por isso A2 assere o overlay de bloqueio, não só a ausência de dado. E o item 7 tem que ficar VERMELHO hoje, senão a asserção não está olhando onde o dado caiu.

---

### E1 — P0-mínimo: a varredura sai do wipe, e o wipe ganha alvo

**Faz:**
- Remover `store.js:280-282` (a condicional `!isAuthenticated → discardRemoteAtlasNamespaces()`). A varredura passa a ser chamada explicitamente em dois lugares que significam "a sessão acabou": o guarda de boot (`store.js:204`) e `_handleLogout` (`account.control.js:1009`). Isso sozinho mata o furo do visitante de link público, em que `index.js:375` registra o namespace e `:376` o destrói três linhas depois.
- `clearAllDataStore` deixa de emitir `markStoreLocal()` (`store.js:297`). Quem monta um atlas declara a origem; quem esvazia, não. Hoje esse marcador GLOBAL é escrito pelo import `.ebgeo`, pelo "Limpar TODOS os dados" e por `_handleRemoteAtlasDeleted`, isto é, uma aba anuncia para a instalação inteira um fato que só vale para ela, e abre uma janela em que o marcador diz LOCAL enquanto a aba tem `remote-<X>` ativo.
- Em compensação, toda saída de atlas passa a terminar ativando explicitamente o slot de destino. Sem isso, remover a varredura remove também a única reativação de escopo que existia (dentro de `discardRemoteAtlasNamespaces`, `store.js:164-169`), e o furo do "Mapa local" com sessão viva (marcador LOCAL sobre escopo `remote-X`) fica pior.
- As três assinaturas com alvo explícito: `clearAllAtlasStores(scope)`, `unmountCurrentAtlas(scope)`, `clearAllDataStore(scope)`.
- `clearAtlasDatabases` recusa criar banco inexistente antes do `clear()` (`atlas-namespace.js:550-557`).

**Arquivos:** ~6 (`store.js`, `repository.js`, `atlas-namespace.js`, `account.control.js`, `index.js`, `open-atlas.service.js`).

**Portão:** caso 1c da sonda promovido a permanente, com asserção ABSOLUTA nos dois sentidos: depois do fluxo de link público anônimo, `ebgeo_maps__remote-<X>` contém o mapa público E `ebgeo_maps` NÃO contém. Mais o teste novo do "Mapa local" com sessão viva e origem REMOTE: escrever uma feição e asserir por nome absoluto que ela está no slot local. **O que a faria vermelha:** reverter a remoção de `store.js:280-282` (controle negativo obrigatório antes de fechar a etapa). Se o teste continuar verde com a linha revertida, ele não está medindo o que diz.

---

### E2 — Web Lock de montagem, expurgo que poupa, `spared` no relatório

**Faz:**
- Lock compartilhado tomado dentro da ativação de escopo, liberado no desmonte.
- `destroyRemoteAtlas` só destrói com `exclusive ifAvailable` concedido; sem ele, pula e a entrada do registro sobrevive (precedente já existente para o delete bloqueado, `remote-atlas.api.js:190-200`).
- `spared: string[]` no `RemotePurgeReport` (`remote-atlas.api.js:69-80`) e incluído em `purgeReachedAtlas` (`:274-281`). **Sem isto, E2 cria uma perda nova:** um namespace poupado não entra em `atlases` nem em `adopted`, o predicado responde `false`, e `store.js:209-210` roda `unmountCurrentAtlas()` sobre a ponte legada, ou seja, esvazia o slot local #1 do usuário, no boot, sem erro.
- **Poupar tem PRAZO.** Registrar `sparedAt` e, passado o prazo (ou após N boots), destruir mesmo com montagem viva, avisando o dono. O motivo é o invariante duro: o único coletor é gateado por sessão (`store.js:201-203`), e `restoreSessionFromStorage` (`index.js:132`) re-autentica em todo boot enquanto o refresh token durar. Sem prazo, poupar não adia o resíduo, ele o torna permanente.
- **Aviso de desmontagem como mensagem NOVA**, endereçada por CONJUNTO DE ENDEREÇOS (a lista de `dbSuffix` prestes a ser destruída), casada contra o `dbSuffix` do escopo ativo do receptor, e nunca por `keysCollide`: `_handleTakeover` sai cedo em `!keysCollide` (`tab-lock.js:992`) e depois de E7 duas abas em atlas remotos diferentes deixam de colidir, que é exatamente o par que o expurgo de logout atinge. O `v` do protocolo (`tab-lock.js:322`) sobe. O receptor PARA de escrever (freio de `tab-lock-sync-brake.js`) antes de o emissor esvaziar; sem isso a escrita seguinte da irmã RECRIA os dez bancos, agora fora do registro.
- ~~O logout NÃO poupa depois do aviso confirmado. Sem sessão não existe aba legítima segurando dado de servidor, com uma exceção: o visitante de link público, que é anônimo por definição e é protegido pelo lock, não pelo gate de sessão.~~

  **SUPERADA EM 2026-08-15, e a premissa venceu por uma mudança feita em OUTRO lugar.** Quando esta
  linha foi escrita a fila de saída era GLOBAL, então o namespace destruído depois do aviso continha
  apenas dado de SERVIDOR, que o próximo login refaz: a perda era recuperável e a decisão, correta.
  **E2B tornou a fila FÍSICA por atlas**, e a partir daí a mesma destruição leva junto operação
  pendente, que não existe em lugar nenhum senão ali. Nada obrigou esta conclusão a ser revisitada
  quando a premissa dela caiu, e ela sobreviveu por inércia até uma auditoria por mutação medir a
  perda: com a montagem viva o expurgo relata `spared` e o dado sobrevive; depois de a aba avisada
  soltar o lock, `atlases`, dado nulo, fila ausente. Ou seja, o logout de uma aba apagava a fila de
  saída de outra, pela porta que o aviso abriu para protegê-la.

  **O que vale agora:** a aba avisada PARA de escrever e NÃO solta a montagem. O aviso é informação;
  soltar o lock seria entrega, e conflatar os dois era o defeito. O expurgo pede o exclusivo, é
  recusado, e reporta `spared` com `sparedAt` carimbado, de modo que a retenção é limitada por
  `SPARE_GRACE_MS` (24 h) e não por nada. A troca é explícita: soltar perde operação não enviada,
  irreversível e sem gesto do usuário; manter deixa dado de servidor legível enquanto aquela aba
  viver, com prazo. **Perda limitada por prazo vence perda limitada por nada.**

  Uma exceção sobrevive e é testada: sem `navigator.locks` (HTTP puro) poupar é impossível por
  construção, e ali o freio volta a soltar e limpar o escopo, senão a escrita seguinte recriaria os
  bancos fora do registro.

  A lição de processo, que é a mais cara: **uma decisão não é revisitada quando a premissa dela
  muda, porque nada aponta de uma para a outra.** Foi preciso uma auditoria adversarial para
  encontrá-la, e ela estava escrita aqui, em tantas palavras, o tempo todo.

**Arquivos:** ~6 (`atlas-namespace.js`, `remote-atlas.api.js`, `store.js`, `tab-lock.js`, `tab-lock-sync-brake.js`, `account.control.js`).

**Portão:** três casos com fake-indexeddb e sentinela semeada nos dez bancos, lidos por nome ABSOLUTO, com asserção POSITIVA antes do expurgo (a falta desse "antes" é o defeito de `_refutacao-fiacao.test.js:154` e `:326`): (1) lock segurado → sentinela viva, entrada intacta, `report.spared` contém X; (2) lock livre → sentinela morta, entrada removida, `report.atlases` contém X; (3) **controle negativo, prazo vencido com lock segurado → sentinela morta**. Mais o terceiro braço de `purgeReachedAtlas` com asserção absoluta sobre a sentinela do banco legado. **O que faria vermelho:** o caso (2) reprova um expurgo que virou no-op; sem ele, (1) sozinho não distingue "poupou" de "não varreu". Reescrever `remote-atlas-api.test.js:198`, que hoje afirma "apaga TUDO", no mesmo commit — nunca aditivamente.

---

### E2B — Fila FÍSICA por atlas, com carimbo de identidade (depois de E1, E3, E5)

**Absorve a antiga E8.** A fila passa a `perAtlas: true` e o carimbo entra junto, no mesmo
ciclo. Ordem interna obrigatória: o descritor só vira `perAtlas` DEPOIS que o wipe de entrada
mira (E1/E3) e que a migração alcança cada slot (E5). Inverter isso é o cenário em que
`openRemoteAtlas` destrói a fila do atlas que está abrindo.

**Faz, além do que segue abaixo:**
- `OPERATION_QUEUE.perAtlas = true` (`atlas-namespace.js:268`), com o banco passando a
  `ebgeo__<sufixo>` e o object store `operation_queue` preservado (é o único descritor com
  `storeName` não-nulo, e isso não muda).
- A fila é EXCLUÍDA do wipe de entrada e INCLUÍDA no expurgo de destruição. Como
  `clearAllAtlasStores` deriva de `listAtlasStores()` filtrado por `perAtlas`
  (`atlas-namespace.js:474-478`), a exclusão é explícita e tem teste próprio.
- `operationQueue.clear()` (`store.js:142`) deixa de ser total: ou recebe alvo, ou sai daqui e
  passa a ser consequência do wipe mirado.
- `startAutoPurge` (`services.js:82`) sai do boot ou passa a exigir escopo, porque a fila
  deixa de ser alcançável antes de `initLocalAtlases()`.
- Migração das ops pendentes hoje em `ebgeo`: elas pertencem ao atlas montado no momento da
  atualização, e a regra é essa. O que não se resolver por essa regra é preservado, nunca
  descartado em silêncio.
- Política escrita para "fila de atlas que não existe mais": oferecer download antes de
  destruir, sob gesto do usuário.

**E o que segue valendo do desenho por identidade:**
- `createOperation` / `createBatchOperations` (`operation-factory.js:381-405`, `:413-433`) carimbam `scopeSuffix` (endereço, chave de armazenamento) e `atlasId` de SERVIDOR. Os dois divergem no slot adotado, e a regra é: kind REMOTE → `scope.atlasId`; kind LOCAL → `remoteAtlasIdFromDbSuffix(scope.dbSuffix) ?? null` (`atlas-namespace.js:367-373`). Carimbar no dispatcher em vez da fábrica está errado: os dois caminhos de retry (`operation-dispatcher.js:167`, `:228`) recriam a op 2 s depois e podem carimbar outro atlas.
- Só 8 consumidores mudam; os 67 call-sites de `log*Operation` em 15 arquivos NÃO mudam.
- `peek` filtra pelo escopo ativo. Isso mata o bug observável do grupo B: hoje as chaves `remote:X` e `local:slot1` não colidem, `peek` lê do DISCO e o flush de uma aba empurra as ops da outra.
- `_index` chaveado pelo escopo (ou a fila deixa de ser singleton, `operation-queue.js:424`); `dequeue` resolve a chave do DISCO, não do índice.
- `sync-engine.js:398` para de desenfileirar o lote inteiro ignorando o `rejected` por operação.
- 404/410 vira classe de rejeição TERMINAL distinta de `PERMANENT_PUSH_REJECTIONS` (`sync-engine.js:65`), que hoje trava a fila em silêncio quando o atlas sumiu.
- `enableOperationLogging()` sai de `services.js:81` (D6).
- Backend: declarar `atlasId`/`scopeSuffix` explicitamente no `operationSchema` (`backend/src/modules/sync/sync.schemas.js:13-46`), como o `traceId` já foi declarado por não se confiar no `.unknown(true)`. Verificado empiricamente que o campo hoje atravessa a validação intacto mas NÃO é persistido (o INSERT usa o atlas da rota, `sync.queries.js:3-8`), então ele volta no rebroadcast e não volta no pull: nunca construir guarda de cliente sobre ele. Recusa por operação no servidor (`ack rejected`, nunca 400 de lote) como cinto e suspensório, só depois do filtro do cliente.

**Arquivos:** ~10 no frontend + 3 no backend. **Mudança que cruza os dois pacotes: verificar dos dois lados no mesmo commit.**

**Portão:** teste com dois escopos: enfileirar em A, ativar B, exigir `count() === 0` e `getAll() === []`. Hoje `operation-queue-namespace.test.js:88-100` assere exatamente o CONTRÁRIO (uma instância, dois escopos, `getAll` devolve as duas ops) — os quatro casos de `:78-124` são invertidos ou apagados no mesmo commit. Mais o e2e de contrato provando que uma op com `atlasId` divergente volta como `rejected` e NÃO é desenfileirada.

---

### E3 — Portão único, com desconexão dentro

**Faz:**
- `mountAtlas(entry)` / `unmountAtlas()` como únicos exports que montam; `activateScope` interno ao módulo.
- Roteadas pelo portão as seis entradas destrutivas, não duas: `openRemoteAtlas` (`open-atlas.service.js:316-408`), `openPublicAtlasFromUrl` (`index.js:351-389`), `saveLocalToServer` (`account.control.js:711-778`), `_handleRemoteAtlasDeleted` (`:820-839`), os dois wipes de boot (`index.js:244-253`, `:455-467`), o import `.ebgeo` (`export-import.service.js:508-510`), o "Limpar Tudo" (`maps.tab.js:1076`) e `MapManager.clearAllData` (`map.manager.js:423-439`, sem chamador — candidato a remoção).
- `saveLocalToServer` ganha `activateRemoteAtlas` ENTRE o claim (`:745`) e o wipe (`:757`), e para de esvaziar o slot local. Efeito colateral valioso: hoje o wipe destrói o original local logo depois de um upload de imagens que é best-effort (`imageStats.skipped`/`failed` informados numa frase de toast).
- Import `.ebgeo` não-aditivo cria um atlas LOCAL novo (opção a), espelhando o que `projetos.html` já faz um nível acima (`projects-page.js:135-149`), com degradação para recusa no cap de 10 (mensagem pt-BR já existe, `local-atlas.api.js:61-78`). O import ADITIVO é recusado com atlas remoto montado. Isso dá os primeiros chamadores a `createLocalAtlas`/`setCurrentLocalAtlas`, hoje API morta.
- **`seedAtlasRecord` (`local-atlas.api.js:228-231`) passa a carimbar `SETTINGS.schemaVersion`.** Sem isso, o primeiro chamador de `createLocalAtlas` arma uma mina: `checkAndCleanLegacyData` (`repository.js:94-109`) lê `schemaVersion` falsy no slot novo e apaga o projeto importado no F5 seguinte.
- Antes de `activateRemoteAtlas`, `openRemoteAtlas` consulta o registro por sufixo alvo: se o namespace é reivindicado por um atlas local (slot adotado pelo resgate), PARAR e perguntar, nunca esvaziar calado. `findBlockingPeer` (`tab-lock.js:523-531`) nunca varre a própria aba, então uma aba sozinha destrói o próprio resgate hoje.

**Arquivos:** ~12.

**Portão, em duas metades, e a estrutural sozinha não vale.**
Estrutural (`frontend/tests/unit/portao-de-montagem.test.js`): varredura de TODO `src/js/**` mirando `activateScope`, com remoção de comentários provada por fixture inline (1 chamada comentada + 1 real → 1 acerto), controle positivo por símbolo, `files.length` absoluto, allowlist ESTRITA nos dois sentidos, e asserção de ORDEM dentro do portão com cada marco asserido como encontrado antes de comparar índices.
Comportamental: dirigir CADA entrada com fake-indexeddb e asserir os três fatos (nome do banco, entrada no registro, endereço da chave do lock), mais um caso que zera o escopo e assere que o banco resultante NÃO é `ebgeo_maps` (a ponte `ensureAtlasScope`, `local.repository.js:68-72`, faz "activate esquecido" cair silenciosamente ali, e é por isso que o furo do `saveLocalToServer` sobreviveu à revisão).
**Controle negativo obrigatório:** reverter o `activateRemoteAtlas` do `saveLocalToServer` e confirmar que a metade comportamental fica vermelha. A estrutural sozinha não prova que o portão faz a coisa certa.

---

### E4 — Registro único, `store-origin.js` apagado, ponteiro de montagem por aba

**Faz:** o de D2. `isRemoteStoreSync()` continua síncrono, servido por espelho em memória invalidado pela montagem, isto é, cache derivado e nunca fonte. Leitura one-shot do marcador antigo dentro da migração, para instalações 2.2. Somem: `locallyClaimedSuffixes` (a checagem cruzada entre dois registros), o campo `adoptedFrom` do tab-lock, e o parse de identidade a partir do nome do banco.

**A janela é agora.** `main` está em 2.2 SEM namespace nenhum e o branch 2.3 não foi lançado: hoje o usuário real faz UMA migração; depois de lançar 2.3 ele faz duas, e a segunda tem que unificar justamente os registros híbridos com sufixo `remote-<id>` criados pelo resgate, que são os mais difíceis.

**Arquivos:** ~14 (o registro novo, os dois antigos removidos, `atlas-namespace.js`, `store.js`, `open-atlas.service.js`, `account.control.js`, `tab-lock.js`, `index.js`, uma migração, mais testes).

**Portão:** teste de duas abas resgatando ao mesmo tempo (a interleaving determinística, dois registros de módulos sobre um armazenamento falso compartilhado): as DUAS entradas sobrevivem no disco. Hoje esse teste fica vermelho por construção do array-sob-uma-chave, e é o controle negativo. Mais um teste que exige que `?atlas=` e o `sessionStorage` por aba vençam a dica global: aba A em X, aba B em Y, F5 na A, A volta em X.

---

### E5 — Migração por SLOT, e a falha de migração para de ser engolida

**Faz:**
- `detectMigrationNeeded(scope)` usando `getStoreFor(SETTINGS|ATLAS, scope)` em vez dos dois `createInstance` fixos (`migration.service.js:17-18`), e `safelyMigrate` iterando os slots do registro mais o escopo remoto montado. Hoje a detecção é single-slot, ancorada em nomes fixos, e roda uma vez por boot (`repository.js:258`) contra o slot LEGADO, que pode não ser o montado. Isso é literalmente o defeito que a Decisão 2 da fábrica diz ter evitado (`atlas-namespace.js:90-93`): o marcador do slot legado É o marcador global.
- Os quatro degraus antigos continuam ancorados nos nomes fixos SÓ para o slot legado (allowlist, como `repository-namespace.test.js` já concede às quatro migrações).
- `initializeRepository` (`repository.js:298-302`) separa o catch em dois: falha de MIGRAÇÃO propaga e o boot mostra a tela de indisponibilidade com a mensagem pt-BR que já existe (`migration.service.js:109-111`); todo o resto continua engolido. Hoje o usuário vê um "Principal" em branco e nenhuma mensagem, e o comentário de `v1-to-v2.migration.js:26` já registra isso como fato conhecido desde sempre.
- Toda mudança de forma sobe `ATLAS_SCHEMA_VERSION` (`frontend/src/js/store/atlas/atlas.entity.js`) no MESMO commit. O plano original não menciona isso em nenhuma das seis fases, e sem ele `detectMigrationNeeded` devolve `needed:false` e a migração não roda, sem erro.

**Arquivos:** ~7.

**Portão:** semear um slot #2 com dado sentinela em versão anterior, rodar o boot, exigir a sentinela em forma nova. Hoje esse teste fica VERDE sem nada acontecer, porque `needed` já é `false` — logo o portão é: **ele tem que ficar vermelho antes da correção**. Mais: injetar rejeição no `setItem` de `schemaVersion` e exigir que `initializeWithLastActiveMap()` REJEITE em vez de resolver com "Principal". E reescrever `store-schema-migration-v2.3.test.js:457-471`, que chama `safelyMigrate()` isolado com registro vazio, uma ordem que o app nunca executa: o guarda de nome que ele defende é código morto no caminho real.

---

### E6 — Resgate falha alto (paralelo a E5)

**Faz:**
- `setStoreOrigin`/equivalente grava o espelho de memória DEPOIS do `setItem` resolver, nunca antes (`store-origin.js:161-164`). Um marcador de memória que discorda do disco é fonte de verdade fantasma, e é o que faz `isRemoteStoreSync()` mentir LOCAL enquanto o disco diz REMOTE.
- `_entries.push`/`_currentId` depois do `persistRegistry` resolver (`local-atlas.api.js:380-382`) — resolvido de graça por E4 (uma chave por slot).
- Sucesso do resgate só por READ-BACK do disco, antes de qualquer marcação e antes do toast. `preserveUnsyncedWorkAsLocal` devolve booleano; o toast depende dele (`account.control.js:1002-1007` é incondicional hoje).
- Falha vira modal bloqueante com "Baixar .ebgeo agora" (gesto do usuário, senão o download é descartado), nunca toast, e a mensagem para de dizer "Falha ao sair da conta" para um erro que é sobre o trabalho.
- Veto de emergência FORA do IndexedDB (localStorage) e COM PRAZO (data + N boots). Fora, porque um veto no mesmo banco tem o mesmo modo de falha que ele existe para cobrir. Com prazo, porque um veto permanente converte a perda no rompimento do invariante duro, e esse dilema tem que ser adjudicado, não nomeado.

**Arquivos:** ~5.

**Portão:** `describe.each` sobre os QUATRO sítios de throw (`loadRegistry`, os dois `setItem`, o `removeItem` da chave remota), cada caso asserindo a sentinela nos dez bancos DEPOIS de `purgeAllRemoteAtlases`, qual toast foi chamado, e a igualdade entre memória e disco. **Antes de tocar em código, reescrever `resgate-trabalho-nao-sincronizado.repro.test.js:247-253`**, que hoje só afirma que o logout não trava, o que é indistinguível do caso em que o trabalho foi inteiramente destruído. Ele deve ficar VERMELHO no estado atual; se ficar verde, a injeção não atinge o sítio de falha e o caso é cobertura vazia.

---

### E7 — Remover a espera de `keysCollide`

**Faz:** apagar `tab-lock.js:497` (`if (a?.kind === REMOTE && b?.kind === REMOTE) return true`). Só aqui, e só depois de E1–E4, porque os quatro motivos listados no comentário `tab-lock.js:476-496` são exatamente E1 (expurgo como efeito colateral), E2 (expurgo cego), E2B (fila) e E3/E4 (marcador e portão).

**Arquivos:** ~3.

**Portão:** a spec de duas páginas no mesmo contexto, `retries: 0`, quatro casos, relatada **em série (N/N), nunca uma rodada**: A1 duas abas em atlas distintos com os dois conjuntos de dez bancos e sem vazamento cruzado; A2 duas abas no mesmo atlas com a segunda BLOQUEADA (sem esse controle negativo, "as duas passaram" é indistinguível de um predicado que virou sempre-falso, que é literalmente a mudança desta etapa); A3 A desloga enquanto B segura Y, os bancos de Y sobrevivem e B ainda escreve, e depois do logout de B nada sobra; A4 visitante público não polui `ebgeo_maps`. Mais um caso unitário que use o `defaultCreateTransport` REAL com o BroadcastChannel do node (verificado: existe e funciona) — os sete sítios de teste de tab-lock injetam um hub em processo, então o transporte real nunca foi exercitado uma vez.

---

### E8 — ABSORVIDA por E2B (2026-08-15)

Não existe mais. A fila física entra dentro de E2B, no mesmo ciclo, por decisão do dono: a
arquitetura fecha antes do lançamento e não se volta a mexer nela. O portão que era desta
etapa migra para E2B e continua valendo:

**Portão:** enfileirar 3 ops em X, sair para Y, voltar para X, exigir `count() === 3` DEPOIS do
wipe e ANTES do connect. **Controle negativo:** remover a exclusão da fila do wipe de entrada e
confirmar vermelho. Mais o caso de duas abas: enfileirar em X pela aba A, trocar de projeto na
aba B, e exigir que as ops de A sobrevivam. Esse último fica VERMELHO hoje
(`store.js:142` apaga a fila inteira) e é o controle que prova que o banco separado corrigiu o
defeito, e não que o teste parou de olhar.

---

## 3. O que fica DE FORA, e por quê

1. **Cifrar o namespace remoto.** Troca perda de dado por corrupção de dado. A chave teria que sobreviver ao F5 (`index.js:421-438` restaura sessão de tokens em localStorage), logo mora ao lado do refresh token; não fecha o grupo C (no furo do `saveLocalToServer` o dado cai num namespace LOCAL, legível); e cria um modo de falha sem recuperação. Registrado com o motivo porque a ideia volta.
2. **SharedWorker/ServiceWorker como escritor único.** Worker dedicado é por aba e não coordena nada. SharedWorker não existe no Chrome para Android, e `vite.config.js` tem um chunk `phone-ui`, isto é, alvo móvel declarado: seria a coordenação escrita duas vezes, que é a origem da classe de bug que se quer eliminar. Web Locks entrega a parte que importa e já está no repositório.
3. **Adoção de namespace local→remoto** (D4).
4. **UI de troca de atlas local.** `createLocalAtlas`/`setCurrentLocalAtlas` ganham chamador só pelo import `.ebgeo` (E3). Nenhum seletor novo. Enquanto não houver troca de atlas local, a inferência de dono das ops pendentes por marcador continua sólida; no dia em que houver, a fila já estará endereçada por escopo (E2B), que é argumento a favor de E2B, não contra.
5. **Reescrever o tab-lock.** Os seis furos da seção 10 (`tab-lock.js:301-307`) continuam abertos e continuam documentados. E2 não os herda porque não usa o roster para decidir destruição.
6. **Playwright dentro do `npm test`.** Continua fora, como sempre.

## 4. As duas perguntas, AMBAS RESPONDIDAS em 2026-08-15

**Resposta 1 (downgrade): não existe a hipótese de reverter o deploy.** O coletor mínimo em
`main` sai do plano, e o invariante duro deixa de ser condicional ao deploy. A análise abaixo
fica como registro do raciocínio, não como pendência.

**Resposta 2 (fila física): sim, banco separado, neste ciclo.** Ver D5 e E2B. A etapa opcional
E8 foi absorvida.

O texto original das duas perguntas segue abaixo, preservado porque a segunda metade da
primeira (o que acontece com os bancos remotos no disco) continua sendo um fato do desenho.

---


1. **Downgrade.** `main` É produção, e `git ls-tree -r main` não tem `atlas-namespace.js`, `remote-atlas.api.js`, `local-atlas.api.js` nem `store-origin.js`. Depois de um revert, os bancos `ebgeo_*__remote-<X>` ficam no disco com snapshot completo e editável e **não existe mais uma linha de código capaz de listá-los**: o único coletor foi embora com o deploy. Os bytes do slot #1 sobrevivem e `main` não re-migra (2.3 > 2.2), então o dado local está seguro; o resíduo de servidor é imortal. Duas saídas, e a decisão tem que ficar escrita: (i) cherry-pick para `main` de um coletor mínimo e sem dependências (varre `ebgeo_global` por chaves de registro e apaga os bancos derivados) ANTES de 2.3 chegar a qualquer usuário, o que exige autorização explícita para tocar `main`; ou (ii) aceitar o resíduo e registrar que o invariante duro é condicional ao deploy. **Não lançar 2.3 e 2.4 no mesmo salto sem essa decisão**, porque o resíduo cresce a cada fase.
2. **Fila física.** D5/E8: o requisito 2 é atendido em identidade imediatamente e em layout de banco talvez nunca. Se o dono quer o banco separado como propriedade em si, E8 deixa de ser opcional e entra depois de E5.

## 5. O que a suíte afirma HOJE e tem que sair (nunca aditivamente)

No commit em que cada etapa entra, o caso antigo sai. Três pares em conflito direto, todos verdes agora, que fariam a correção parecer regressão: `remote-atlas-api.test.js:198` (o expurgo cego codificado como esperado, sai em E2); `operation-queue-namespace.test.js:78-124` (as quatro propriedades da fila global, saem em E2B); `resgate-trabalho-nao-sincronizado.repro.test.js:247-253` (sai em E6). E `_refutacao-fiacao.test.js:93-101` e `:366-367` não são promovidos: um sobrevive à própria âncora quebrar (medido), o outro é uma tautologia.