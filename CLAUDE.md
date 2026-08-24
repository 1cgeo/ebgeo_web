# EBGeo: constituição

GIS web do Exército Brasileiro. Monorepo de dois pacotes simétricos: **web** em [`frontend/`](frontend/) (Vanilla JS, Vite, MapLibre + Cesium + Three.js, IndexedDB) e **backend** em [`backend/`](backend/) (Express + PostgreSQL/PostGIS + `ws`), com [`backend/CLAUDE.md`](backend/CLAUDE.md) próprio. A raiz só orquestra: os scripts dela delegam com `--prefix`, e cada pacote tem seu `package.json`, seu `node_modules` e seu `.gitignore`.

Este arquivo carrega **método, armadilha e convenção que diverge do default**. O que se deriva lendo o código não mora aqui: detalhe de arquitetura em [`.claude/rules/`](.claude/rules/), o porquê das decisões em [`docs/wiki/index.md`](docs/wiki/index.md), o registro DATADO de cada uma em [`docs/decisions/`](docs/decisions/) (`docs/decisions/decisions-2026.md` é o diário do ano corrente, e é ele que as regras citam quando dizem "decisão registrada"; `docs/decisions/DECISIONS.md` é o índice), fatos duráveis em [`docs/MEMORY.md`](docs/MEMORY.md), princípios integrais em [`docs/doutrina.md`](docs/doutrina.md).

**DOIS arquivos se chamam "constituição", e não são o mesmo documento.** Este, que se intitula assim, é o **método**: como se trabalha, como se verifica, o que não se mexe. [`CONSTITUICAO.md`](CONSTITUICAO.md), na raiz ao lado dele, é o **estatuto do produto**: as cláusulas sobre quem pode o quê (papéis, escopo de produção, concessão, poda, princípio de acesso), escritas em 2026-08-20 a partir do texto do dono e conferidas cláusula a cláusula contra o código. A autoridade dele é maior que a do código no domínio dele, e isso está declarado lá: onde as duas divergem, o texto é a especificação e o código é que muda. Consulte-o **antes** de escrever qualquer gate, papel ou regra de acesso, e mude o estado da cláusula (vigente / em obra / pendente) no mesmo commit em que o código muda. Ele é vigiado por [`frontend/tests/unit/docs-integridade.test.js`](frontend/tests/unit/docs-integridade.test.js) (caminho, link e símbolo) e por [`frontend/tests/unit/constituicao-estado-das-clausulas.test.js`](frontend/tests/unit/constituicao-estado-das-clausulas.test.js) (a lista do que ainda não é vigente). Nenhum dos dois verifica que uma cláusula seja VERDADE.

## Os seis princípios (condensados)

1. **Competência só compõe se for codificada, nunca lembrada.** O que não virou teste, regra ou learning considera-se perdido.
2. **O laço se alimenta da realidade, nunca de si mesmo.** Em software a realidade tem três vozes: o **código** (não a prosa que o descreve, inclusive esta), o **teste** (não a intenção de quem o escreveu) e o **comportamento observado** (não o `exit 0`).
3. **Plasticidade na periferia, rigidez no núcleo.** Contrato congelado e invariante de dados não se mexem sem decisão registrada; o resto é livre.
4. **Confiança é gradiente, ganho por tarefa e revogável.** Dry-run antes de mutar; pare no irreversível. Esclarecimento de escopo **não é** autorização.
5. **Melhoria se descobre por seleção, não se decreta.** Controle negativo: reverta o fix e confirme que o teste falha.
6. **O direito de desaprender é tão sagrado quanto o de aprender.** Podar regra morta e página dormente é manutenção, não perda.

## Verificação: a lição que mais custou

`verificacao-fantasma` é a classe mais recorrente do [`docs/livro-razao.md`](docs/livro-razao.md), com o dobro da segunda colocada, e junto com `teste-que-nao-prende` tem sempre a mesma raiz: **uma checagem que não checa**. As formas já pagas (esta linha já trouxe uma contagem, que envelhecia a cada evento novo):

- **Verificação que chega depois da ação não é verificação.** Rodar lint na mesma linha de comando do `git commit` faz a saída aparecer depois do commit já ter passado. Comando separado, antes.
- **Conferir um subconjunto e tratar como o conjunto.** `grep` em dois arquivos da raiz deu por completa uma busca que tinha alvos em `backend/`. Onde existe teste que varre tudo, não confira à mão.
- **Cobertura vazia passa verde.** Teste cuja regra não casa com nada reporta sucesso sem verificar nada. Pergunte sempre *o que este verde estaria provando se o código estivesse errado*.
- **O verificador também quebra, e quebra calado.** Quatro episódios: hooks que liam variável inexistente, script de manutenção ancorado num separador que nem sempre existe, `git rev-parse` que ecoa no stdout ao falhar (fazendo `|| echo AUSENTE` capturar as duas saídas), e uma espera cujo predicado casou o **anúncio** da etapa (`> npm run test:e2e`, a linha que o npm imprime ao começar) em vez do fim dela, declarando pronto no meio. Nenhum deu erro; os quatro deram resposta errada com cara de resposta. Duas regras daí: quando a checagem é você que escreveu, confirme por um **caminho independente** daquele que produziu o resultado; e para esperar um processo, ancore no **código de saída**, nunca em texto de log, porque todo log anuncia o que vai fazer antes de fazer.
- **Verificação alcança o commit, não a última edição que você lembra.** Rodar a suíte e depois mexer mais uma vez deixa a última mudança sem verificação nenhuma, e ela é a que tem mais chance de estar errada, porque foi a menos pensada. A regra prática: a suíte que vale é a que rodou **depois** da última escrita.
- **Uma medição de algo probabilístico não é medição.** Corrida, flake e qualquer coisa dependente de tempo passam numa fração das execuções: um verde único é indistinguível do determinístico e não prova nada. Meça **em série** e relate a taxa (um fix de corrida do 360 deu verde na primeira rodada e continuava quebrado para o usuário: 3/8 antes, 20/20 depois). E prefira tornar a interleaving perdedora **determinística** num teste: estatística de browser não converge, teste com o evento disparando no instante errado converge.
- **O instrumento pode estar medindo outra cópia do sujeito.** Sonda que faz `import()` no dev server recebe outra instância do módulo quando o Vite serve o arquivo recém-editado com `?t=` de HMR, então o estado lido não é o do app. Meça por sinais que não dependem de identidade de módulo (rede, DOM, pixel) ou confirme que instrumento e app compartilham a instância.

Não chancele a própria saída: rodar o teste não é a mudança funcionar; escrever a doc não é a doc estar certa.

## Não negociável

- **Verificação de lógica é `npm run lint` + `npm test` na RAIZ**, em dois comandos separados, antes do commit. O `npm test` da raiz encadeia três camadas (frontend hermético, backend, e2e de contrato), então **exige PostgreSQL + PostGIS com superusuário**. Sem banco o backend reprova e o `&&` corta antes do e2e. Se o e2e CHEGAR a rodar e o backend não subir, todos os specs se auto-pulam, e quem reprova é [`frontend/tests/e2e/_backend-required.e2e.test.js`](frontend/tests/e2e/_backend-required.e2e.test.js), o único spec da camada SEM gate (o par no Playwright é [`frontend/tests/e2e-ui/_backend-required.spec.js`](frontend/tests/e2e-ui/_backend-required.spec.js), e os dois são vigiados por [`frontend/tests/unit/guarda-de-e2e-nao-pula.test.js`](frontend/tests/unit/guarda-de-e2e-nao-pula.test.js), porque guarda que some não deixa rastro). Esta linha mandou "conferir a contagem de skips" por meses DEPOIS de os guardas existirem, e o custo foi medido: duas sessões diferentes leram a prosa, concluíram que não havia guarda e foram implementar um. A única fresta que sobra é o opt-out explícito `EBGEO_E2E_ALLOW_SKIP=1`, que nenhum script define. A propriedade "script da raiz alcança os dois pacotes" é asserida por [`frontend/tests/unit/scripts-da-raiz.test.js`](frontend/tests/unit/scripts-da-raiz.test.js), porque essa mesma correção recorreu três vezes: prosa não segurava.
- **UI não se valida por preview nem por browser interativo.** O laço aprovado é uma captura do Playwright dirigindo app e backend reais e depois **ler a imagem** produzida; apague o spec temporário. O Playwright fica FORA do `npm test` e é a única camada que exercita a UI.
- **Trate como frágil, sem hook para segurar:** `deploy/` (roda contra produção), `.env`, lockfile e `frontend/public/vendors/`. O bloqueio automático foi removido em 2026-07-18 a pedido; agora é julgamento, então confirme antes de escrever nesses caminhos.
- **Trabalhe no branch atual.** `main` é outra linha do produto; não sincronize sem pedir.
- **Login é opcional; servidor não é.** O app roda anônimo, mas o boot é fail-fast em `GET /api/config`; sem backend alcançável, tela "EBGeo indisponível". `frontend/src/js/config.js` é só o *shape* que o servidor hidrata; **não há fallback estático**. Anônimo ≠ offline.
- **Permissão tem DOIS eixos ortogonais, e eles compartilham exatamente UMA palavra: `admin`.** O eixo **POR ATLAS** tem CINCO níveis e **é** uma escada: `read < comment < write < manage < owner` (Leitor, Comentarista, Editor, Gestor, Dono). Sempre gate pela hierarquia: no cliente por `checkPermission(GuardAction.X)`, no servidor por `requireAtlasPermission`. Lista fechada tipo `perm === 'write' || perm === 'owner'` exclui o `manage` em silêncio e já causou bug real, duas vezes, nos dois pacotes. Operação de store que escreve em atlas remoto sem consultar o guard enfileira trabalho que morre do outro lado, sem erro para o usuário.

  O eixo **GLOBAL** tem QUATRO valores e **NÃO é uma escada**: `user`, `producer`, `credenciado`, `admin` (Usuário, Produtor, Credenciado, Administrador). Nenhum contém o outro, então comparar papel global por ordem é erro de leitura, e o risco aqui é o INVERSO do de cima: um `role !== 'user'` num gate de administração promove o credenciado em silêncio. Produtor MANTÉM o que a OM dele produziu (escopo em `users.producer_org_id`, que só administrador concede), e desde 2026-08-20 isso inclui marcar público/privado e conceder de raiz o que ele produz; Credenciado LÊ todo recurso privado e concede/revoga no eixo de RECURSO, e **não** administra grupo de acesso (a decisão de 2026-08-19 que lhe dava essa escrita foi SUPERADA em 2026-08-20: grupo virou entidade de usuário, com dono, e a autoridade sobre ele é posse). Nenhum dos dois é administrador do sistema. `users.organization_id` é **lotação**, auto-declarada no cadastro, e **não autoriza nada**: quem amarra papel e escopo de produção é o CHECK `users_producer_scope_check`, e todo ramo que lia lotação passou a ler `producer_org_id` (repro em [`backend/tests/integration/auto-cadastro-om-nao-autoriza.repro.test.js`](backend/tests/integration/auto-cadastro-om-nao-autoriza.repro.test.js)). Cite a migração pelo SÍMBOLO, nunca pelo número: o schema foi rebaselinado e a numeração antiga já morreu duas vezes ([`backend/tests/unit/citacao-de-migracao.test.js`](backend/tests/unit/citacao-de-migracao.test.js) reprova número solto).

  **A palavra compartilhada é `admin`, e ela é a ponte entre os eixos.** O `admin` GLOBAL faz curto-circuito para o topo da escada por atlas (`toFrontendRole`, `backend/src/utils/roles.js`): resolve como papel máximo em qualquer atlas, sem share nenhum. `producer` e `credenciado` **não** fazem isso, caem na escada como conta comum, e "completar" aquele curto-circuito com eles é o erro que o `fileoverview` daquele arquivo existe para impedir. Ou seja, a mesma string significa coisas diferentes nos dois eixos, e só uma delas atravessa.

  **Os DOIS eixos têm rede, desde 2026-08-23, e a frase anterior desta linha dizia o contrário.** O eixo GLOBAL é varrido por `backend/tests/unit/papel-global-censo.test.js`, que reprova o sítio não classificado; o eixo POR ATLAS ganhou censo nos dois pacotes (`frontend/tests/unit/permissao-de-atlas-censo.test.js` e `backend/tests/unit/permissao-de-atlas-censo.test.js`), e o que eles proíbem é MECÂNICO: uma linha que cite dois ou mais valores distintos do vocabulário do eixo ligados por `||`, `&&`, literal de array ou `.includes(` é acusada, e só `frontend/src/js/projects/permission-levels.js` pode escrever uma. A forma pega nos dois sentidos, e é por isso que ela é a proibição certa: a lista do topo (`owner || manager || admin`) exclui em silêncio quem nascer no meio, e a do fundo (`viewer || commenter`) falha ABERTO para o papel que o servidor inventar depois deste build. A primeira passada achou SEIS violações vivas no cliente. **Duas ressalvas que o verde não conta:** o `admin` fica fora do gatilho da varredura, porque é a palavra que os dois eixos compartilham e varrê-la arrastaria todo sítio de papel global (ela entra na contagem de tokens, então `role === 'owner' || role === 'admin'` continua sendo acusado); e o servidor tem UMA lista fechada viva declarada no censo, em `handleSelection` (`backend/src/modules/collab/collab.handlers.js`), presa por contagem exata, de modo que consertá-la também reprova e obriga a passar pelo cabeçalho.
- **Escrita INCREMENTAL de entidade colaborativa é só via sync.** Não crie rota REST de escrita para feature/map/layer/group/briefing/slide/3D/360. Quatro exceções estruturais já existem e são deliberadas (merge de mapas, import de atlas, duplicação de mapa, clone de atlas): são operações de entidade INTEIRA, cujo efeito não se expressa como sequência de ops. Esta linha disse "três" e omitiu o clone por tempo suficiente para a contagem virar premissa, e a correção foi feita primeiro em [`backend/CLAUDE.md`](backend/CLAUDE.md): a cópia daqui sobreviveu porque `docs-integridade` valida caminho e símbolo, nunca aritmética. Detalhe e armadilhas em [`backend/CLAUDE.md`](backend/CLAUDE.md).
- **Mudança que cruza os dois pacotes** (envelope de sync, `/api/config`, permissões, contrato congelado) é verificada **dos dois lados no mesmo commit**. O E2E sobe o backend real e é o guarda dessa fronteira.

## Comandos

Os scripts estão em `package.json`; os que não se adivinham:

```bash
npm run dev           # stack completo: backend :8080 + Vite :3000 (dev:web sobe só o Vite,
                      #   que sozinho não boota: fail-fast em GET /api/config)
npm test              # raiz: test:frontend + test:backend + test:e2e (contrato, vitest contra
                      #   o backend real). Os dois últimos criam e dropam banco.
npm run test:e2e:ui   # Playwright com o backend REAL de backend/; fora do npm test
npm run build         # compila para dist/ ;  npm run deploy publica (symlink swap)
npm run knip          # dead-code
```

Arquivos `.js`/`.css` editados passam por lint automático (hook PostToolUse), e a saída aparece depois de cada escrita.

## Convenções que divergem do default

- **Imports por alias em código novo** (não há regra de lint, e cerca de um décimo dos arquivos de `frontend/src/js/` ainda usa `../../`: migrá-los é decisão pendente, não dívida silenciosa): `@/`, `@js/`, `@store/`, `@utils/`, `@tools/`, `@toolbar/`, `@modals/`, `@sidebar/`, `@layers/`, `@catalog/`, `@ui/`, `@events/`, `@state/`, `@css/`. A maioria das pastas de módulo expõe um barrel `index.js`, e é por ele que o import de PASTA resolve, mas isso **não é universal**: as quatro pastas criadas de 2026-07-18 em diante (`calibration/`, `deep-link/`, `projects/`, `session/`) não têm barrel nenhum, e nelas se importa o arquivo direto. Confira se a pasta tem `index.js` antes de importá-la; a regra escrita como universal induz a `@js/projects`, que não resolve. Duas delas são o corpo de `calibracao.html` e de `atlas.html`, onde o barrel é ativamente indesejado, porque é ele que arrasta a store para uma página que boota sem ela.
- **Idioma:** string de UI em pt-BR com acento correto; comentário e JSDoc em inglês; propriedade de feição em português (`nome`, `descricao`, `visivel`, `bloqueado`).
- **Comentário de caminho na linha 1** de todo arquivo JS, relativo ao `src/` do pacote: `// Path: js/draw_tools/point_tool/add_point_control.js`. Nunca remova.
- **Sem estilo inline em JS.** Classes BEM em arquivo CSS; exceção só para valor computado em runtime (cor vinda do JS, posição calculada).
- **Afordância que a pessoa não alcança: o POSTO some, o ESTADO recusa o clique.** Bloqueio por papel é permanente e o comando não se desenha; bloqueio reversível (mapa travado, atlas local, offline) desenha o comando e recusa o clique NOMEANDO o estado, porque o clique é como o motivo chega. Nunca a propriedade `disabled` no segundo caso: botão desabilitado não dispara clique. A frase da recusa deriva da CAPACIDADE negada (`denialNotice`, `frontend/src/js/store/denial-phrases.js`), nunca do papel. Detalhe e os modelos a copiar em [`.claude/rules/architecture.md`](.claude/rules/architecture.md) §UI Architecture.
- **XSS:** nunca `innerHTML` com dado de usuário. Use `textContent` ou `createElement`; `escapeHtml` de `@utils/html-escape.js` ao interpolar (ele escapa aspas, então vale dentro de atributo). HTML rico não se escapa, se sanitiza: conteúdo Quill de briefing passa por `sanitizeQuillHtml` (`@utils/quill-helpers.js`) em TODO ponto que o renderiza, e o slide chega por sync, escrito por outro usuário. Ícone SVG estático é ok.
- **Limpeza de recurso** via `@utils/event-cleanup.js`. Todo `map.on()` do MapLibre pareado com `map.off()` no `onRemove()`; handler do Cesium com `.destroy()`; timer sempre limpo.
- **Utilitários obrigatórios:** `deepClone()` (não `JSON.parse(JSON.stringify())`), `showToast()` (não `alert()`), `generateUUID()` para todo id, constantes `EventTypes.XXX` (nunca string literal de evento).
- **CSS** em `frontend/src/css/` com os custom properties de `design-tokens.css`. Anime com `transform: translateX()`, nunca `left` (evita layout thrashing).
- **Sem em-dash na prosa** de documentação; vírgula, parênteses ou frase separada.

## Padrões estruturais

**O app tem QUATRO páginas, não uma:** `index.html` (mapa), `atlas.html` (seletor de atlas), `admin.html` (Administração) e `calibracao.html` (calibração 360, gateada por `isAdmin()` **ou** `isProducer()`, porque calibrar é manter o que a OM produziu). As três que não são o mapa bootam sem `@store` e sem `initServices()`, e importar delas o barrel `@utils` ou `@modals` arrasta a store inteira de volta pelo caminho transitivo. As três participam do tab-lock, e é por isso que `frontend/src/js/utilities/tab-lock.js` se importa **direto**, nunca pelo barrel. Projetos e Administração compartilham a barra superior via `createAppBar` (`ui/app-bar.js`), porque `AccountControl` é `IControl` e só existe dentro de um mapa. Detalhe e medições em [`.claude/rules/architecture.md`](.claude/rules/architecture.md) §Páginas e chunks.

**Ferramenta de desenho = 3 arquivos:** `add_*_control.js` (IControl do MapLibre) + `add_*_geometry.js` (geometria pura, testável em node) + `*_attributes_panel.js`. Use a skill `new-tool`.

**Transação do store é persistence-first**: efeito colateral só roda depois que o IndexedDB confirma. Se a persistência lança, nada mais acontece:

```javascript
await runTransaction(async (tx) => {
    tx.deferSync(() => updateColorTracking(feature));   // UI
    tx.deferAsync(() => logFeatureOperation(...));       // log / fila de sync
    return async () => { await repo.set(key, data); };   // persistência: roda PRIMEIRO
});
```

Ordem: persistência → deferSync → deferAsync. Detalhe na skill `store-op`.

**Erro de store, três casos:** argumento inválido (bug do chamador) → `throw new Error`; falha esperada (mapa bloqueado) → `return` + emitir `STORE_OPERATION_BLOCKED`; risco de perda de dado (IndexedDB) → `throw` + emitir `STORE_PERSIST_ERROR`.

**Serviços:** `initServices()` antes de qualquer componente; depois `getEventBus()` / `getStateManager()` / `getLayerManager()`.

## Documentação

A wiki em [`docs/wiki/`](docs/wiki/index.md) **é** a documentação, e vale um critério só: **o código já é a evidência**. Antes de escrever um parágrafo, pergunte se um engenheiro competente chegaria nele sozinho lendo o código. Se sim, não escreva. Entra o porquê e a alternativa rejeitada, a armadilha, o contrato congelado, o não-óbvio que atravessa arquivos. Regras de manutenção em [`docs/wiki/wiki-schema.md`](docs/wiki/wiki-schema.md).

Documentação desatualizada é **pior que ausente**: engana ativamente, e engana em dobro um agente, que a trata como verdade. Por isso ela é verificada por teste ([`frontend/tests/unit/docs-integridade.test.js`](frontend/tests/unit/docs-integridade.test.js)) e não por disciplina: todo caminho citado e todo wikilink precisam resolver, e todo símbolo entre crases precisa existir no código (comentário não conta como existência). Daí a regra tipográfica: crase promete código que existe, e proposta se escreve em prosa, sem crase.

Ao corrigir um desvio, registre uma linha no [`docs/livro-razao.md`](docs/livro-razao.md) dizendo **onde a lição foi codificada**. Correção que recorre significa que a guia não pegou: mude a abordagem, não re-anote.
