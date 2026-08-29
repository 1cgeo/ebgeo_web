# Decisões de 2026

Entradas integrais. O índice está em [DECISIONS.md](DECISIONS.md).

---

### 2026-07-18: Monorepo, backend integrado por subtree em `backend/`

- **Contexto:** frontend (`1cgeo/ebgeo_web`, público) e backend (`1cgeo/ebgeo_backend`, privado) viviam em repositórios separados, mas o acoplamento era real e já cobrava preço: mudanças cruzavam a fronteira em dois PRs sem atomicidade, e o harness de E2E do frontend fixava o **caminho absoluto** do repositório do backend na máquina de um desenvolvedor, o que tornava 108 specs de Playwright inexecutáveis para qualquer outra pessoa e para qualquer CI.
- **Decisão:** trazer o backend para `backend/` do repositório do frontend via `git subtree add`, preservando os 44 commits. O frontend permanece na raiz. O repositório resultante é público.
- **Alternativas rejeitadas:**
  - *Manter separados e só corrigir o caminho absoluto*: resolveria o E2E, mas não a não-atomicidade das mudanças que cruzam a fronteira, que é o custo recorrente.
  - *Layout `apps/web` + `apps/backend`*: mais limpo, mas mover o frontend faria os 27 branches abertos conflitarem inteiros. Assimetria aceita em troca de zero atrito no trabalho em voo.
  - *Monorepo privado*: descartado após confirmação de que a abertura do backend não é restrição.
- **Consequências:** uma mudança que cruza os dois pacotes cabe num commit e é verificada pelo E2E antes do merge. `git log --follow` não atravessa o enxerto (o histórico mantém os caminhos originais; use `git log --all -- src/...` ou o SHA). O repositório do backend deve ser arquivado, não deletado. Antes da abertura, o histórico foi varrido por segredo: nada de chave, `.env` real ou credencial; o único achado (hostname de produção num fixture) foi trocado por domínio de exemplo.
- **Status:** aceita, **exceto o layout**: "o frontend permanece na raiz" durou horas e foi superado por *2026-07-18: o pacote web vai para `frontend/`*, abaixo.

---

### 2026-07-18: o pacote web vai para `frontend/`

- **Contexto:** a decisão de horas antes manteve o frontend na raiz para não conflitar os 27 branches abertos. Na prática a raiz ficou misturando 12 itens do pacote web com 9 do monorepo, e nada indicava a quem cada arquivo pertencia (`1ab95eb4`).
- **Decisão:** mover o pacote web para `frontend/`, simétrico a `backend/`. Cada pacote autocontido (`package.json`, `node_modules` e `.gitignore` próprios) e a raiz só orquestrando, com `--prefix`.
- **Alternativas rejeitadas:**
  - *npm workspaces*: mudaria como as dependências do backend são instaladas, e a suíte dele exige PostgreSQL + PostGIS com superusuário, que não dava para verificar naquele momento. Mudança não verificável não entra junto com uma que já é grande.
  - *Manter a assimetria*: era a decisão anterior, e o custo que ela evitava (conflito nos branches em voo) já tinha sido pago pela integração do backend.
- **Consequências:** `git log -- frontend/src/...` não enxerga o histórico anterior ao movimento (use `--follow`, ou o caminho antigo). O movimento quebrou três coisas de uma vez, e as três apareceram porque havia guarda: a lista de documentos vigiados do `frontend/tests/unit/docs-integridade.test.js` zerou (pego pelo teste escrito para "a lista esvaziar em silêncio"), o hook de lint procurava o ESLint na raiz e passou a subir do arquivo até o pacote que o configura, e o `deploy/deploy.sh` apontava para um `dist/` que mudou de lugar. Cada quebra confirmou o guarda correspondente.
- **Status:** aceita.

---

### 2026-07-18: Documentação concentrada em `docs/` com camada de memória

- **Contexto:** a documentação tinha duas casas (`docs/` do frontend e `backend/docs/`), resquício dos dois repositórios. E o conhecimento durável do projeto (o porquê das decisões, as armadilhas, os contratos congelados) não tinha lugar: vivia espalhado em prosa que apodrecia. A prova apareceu na própria sessão: um documento que se anunciava como "referência única para integradores" documentava a permissão por atlas com três níveis quando o `CHECK` do banco tem cinco, e foi esse modelo mental que produziu um bug real de autorização.
- **Decisão:** concentrar tudo em `docs/` (guias e deploy, todos depois absorvidos pela wiki) e adotar a organização de memória do vault `chefe_dgeo`, adaptada a software: constituição com seis princípios ([`doutrina.md`](../doutrina.md)), [`docs/MEMORY.md`](../MEMORY.md) com fatos duráveis, wiki semântica em [`wiki/`](../wiki/index.md) com wikilinks, este log de decisões, [`docs/livro-razao.md`](../livro-razao.md) como espelho de correções, e skills com `learnings.md`.
- **Alternativas rejeitadas:**
  - *Links markdown relativos em vez de wikilinks*: a pesquisa mostra que o Claude Code não resolve wikilink nativamente (para o agente é texto que vira grep). Rejeitada por decisão do dono do projeto, que já opera o modelo com wikilinks e o considera comprovado. Mitigação adotada: teste que valida que todo wikilink resolve para uma página existente, devolvendo ao formato a verificabilidade que ele não tem sozinho.
  - *Só reference/explanation do Diátaxis*: descartada junto com a anterior; segue-se o modelo do vault.
- **Consequências:** a documentação passa a ser verificada por teste (`frontend/tests/unit/docs-integridade.test.js`: caminhos citados existem, links resolvem, wikilinks resolvem, `MEMORY.md` cabe no que o Claude Code carrega). Documentação vira algo que o CI checa, em vez de depender de disciplina. Custo: manter a wiki podada é trabalho recorrente, e a retrospectiva é quem paga.
- **Status:** aceita.

---

### 2026-07-25: Cartão de atlas sem miniatura do mapa (descopado)

- **Contexto:** o redesenho do Atlas Drive previa (fase C2) uma miniatura por atlas no cartão, gerada por snapshot do mapa ou enviada pelo usuário. As fases A a D foram concluídas sem ela, e o registro dessa escolha vivia só numa nota de sessão, que é onde uma decisão negativa some.
- **Decisão:** o cartão identifica o atlas por uma **faixa colorida com as iniciais**, com cor estável derivada do nome. Sem snapshot do mapa e sem upload de miniatura de atlas.
- **Alternativas rejeitadas:**
  - *Snapshot do mapa ao fechar o atlas*: obriga a renderizar fora da tela num momento em que o usuário está saindo, e produz miniatura que envelhece sem aviso: o cartão passaria a mostrar um mapa que já não é aquele.
  - *Upload manual de miniatura*: mais infraestrutura (armazenamento, limite, invalidação) para um identificador que a faixa colorida já dá de graça e sem envelhecer.
- **Consequências:** o Drive não tem dependência de imagem por atlas. A miniatura que EXISTE no projeto é outra coisa e continua valendo: é a do **catálogo** (basemaps, modelos 3D e camadas), embutida como data URL no `config` do recurso com teto de 256 KB. Confundir as duas leva a procurar infraestrutura que não existe. Se um dia a miniatura de atlas voltar, ela precisa resolver o envelhecimento, que é o motivo real da recusa.
- **Status:** SUPERADA em 2026-08-16 pela decisão "capa de atlas enviada pelo usuário", abaixo. A metade que **continua valendo** é a que a recusa protegia: nada de snapshot automático do mapa. O resumo operativo (uma linha, na lista de decisões menores) vive em [`../wiki/sintese-decisoes-arquiteturais.md`](../wiki/sintese-decisoes-arquiteturais.md); aqui fica a alternativa rejeitada, que é o que não cabe lá.

---

### 2026-08-15: namespace de IndexedDB por atlas, com expurgo derivado de registro (supera P12)

- **Contexto:** P12 fechou "múltiplos atlas locais nomeados" como não-objetivo deliberado, e a razão registrada era boa: namespacing por atlas seria um refactor pesado da persistência **sem ganho de princípio**, porque a separação local↔remoto já era garantida pelo marcador de origem (`store-origin.js`). O namespacing responderia "onde este dado mora" quando a pergunta que importa é "este dado tem direito de continuar existindo aqui". O dono reabriu a decisão, e um requisito novo tornou P12 obsoleta por um caminho que não é o do multiprojeto local: **duas abas em atlas distintos ao mesmo tempo**. Duas abas exigem dois workspaces montados no mesmo IndexedDB. Com endereço único (`ebgeo_maps` e os outros nove bancos), duas abas em dois atlas de servidor são dois donos do mesmo endereço, e o wipe de entrada de uma apaga o mapa vivo da outra. Isso não é contenção que um lock arbitre: é um endereço com dois donos.
- **Decisão:** cada atlas, LOCAL ou REMOTO, passa a ter seu próprio conjunto de dez bancos, e o namespace vai no **nome do banco**, nunca no nome do object store (`ebgeo_maps__<sufixo>`; `remoteScope` produz `remote-<atlasId>`). Uma fábrica única (`frontend/src/js/store/atlas-namespace.js`) resolve todo acesso contra um escopo ativo, e `STORE_DESCRIPTORS` vira a lista canônica de bancos, da qual os wipes são derivados. Atlas local nomeado passa a existir de fato, com teto de 10 slots (`MAX_LOCAL_ATLASES`), registro em banco global e ponteiro de atlas corrente. A regra de arbitragem entre abas fica uniforme: mesmo atlas colide, atlas distintos não, página sem mapa nunca colide.
- **Alternativas rejeitadas:**
  - *Manter P12 e arbitrar tudo pelo tab-lock (uma aba por vez, remoto contra remoto sempre colidindo)*: foi o estado interino, e recusa o requisito em vez de atendê-lo. O lock passaria a existir para proteger um endereço compartilhado, quando o que o usuário pede é ter dois endereços.
  - *Namespace no nome do OBJECT STORE, dentro de um banco compartilhado*: é upgrade de versão do IndexedDB. Dispara `versionchange` em toda conexão aberta e fica pendente enquanto qualquer aba se recusar a fechar, com `blocked` como único sinal e ninguém escutando (medido: 21 de 21 pendentes até o detentor soltar). Também transformaria a versão do banco em contador monotônico dirigido por ação do usuário. Criar banco com nome NOVO enquanto outra aba segura os irmãos completou 21 de 21, sem um `blocked`, com cerca de 1 ms cada. Logo, "criar um atlas" nunca pode ser upgrade de banco existente.
  - *Descobrir o que apagar perguntando ao navegador (`indexedDB.databases()`)*: não existe em todo engine que o app suporta. Um nome não descoberto deixa um usuário deslogado com cópia persistente e editável de um atlas de servidor, que é exatamente o invariante que P12 protegia de graça.
  - *Perguntar à outra aba pelo canal do tab-lock antes de apagar*: põe o invariante mais forte do store nas mãos do ator menos confiável. Aba congelada ou throttled ou trava o logout ou é presumida ausente, e as duas leituras são chute. Esvaziar não precisa de permissão de ninguém.
  - *Fila de saída por atlas*: o envelope de operação não carrega atlas id, então a fila por atlas gravaria o atlas num lugar que ninguém lê, criaria até dez filas locais que nunca drenam (o flush é gated em conexão), e uma fila chaveada por atlas remoto seria o resíduo editável de servidor que o marcador de origem proíbe. A fila fica global; o preço é que trocar de atlas local limpa a fila, o que já acontece dentro de `clearAllDataStore`.
- **Consequências:** o ponto que o próximo leitor vai duvidar é como o invariante de P12 sobreviveu, então ele vem primeiro.
  - **O invariante nunca foi "um banco só", era "dado remoto não sobrevive ao logout"**, e ele era carregado por um alvo ÚNICO e NOMEÁVEL. Com um nome por atlas o alvo deixa de ser nomeável, então o expurgo deixou de ser lista fixa e passou a ser **derivado de um registro**: `frontend/src/js/store/remote-atlas.api.js` grava uma chave de banco global por namespace **antes da primeira escrita** naquele namespace (`activateRemoteAtlas` registra, depois ativa), e `purgeAllRemoteAtlases` itera o registro. Duas regras de ordenação carregam tudo: registrar antes de escrever (namespace escrito antes de registrado é dado que nenhum expurgo acha) e **uma chave por atlas, nunca um array** (duas abas registrando dois atlas se sobrescreveriam dentro de um read-modify-write, e a entrada perdida é o resíduo inalcançável que o registro existe para impedir).
  - **A destruição é em duas etapas, nesta ordem, e só a primeira é o invariante:** `clearAtlasDatabases` esvazia (não precisa de acesso exclusivo, vale para toda aba no ato, e depois dela nenhum byte do atlas de servidor é legível); `dropAtlasDatabases` apaga as cascas vazias, com prazo, e um delete que outra aba segura volta em `blocked` como dado, mantendo a entrada do registro para o próximo boot sem sessão repetir. Delete bloqueado custa disco, nunca o invariante.
  - **Guardas, porque a derivação também pode ficar vazia e passar verde:** `frontend/tests/unit/wipe-unificado-de-atlas.test.js` semeia um sentinela em cada banco por atlas e exige a ausência dele depois, com os dez nomes escritos em ABSOLUTO (derivar a expectativa da mesma lista que o código deriva passaria verde com lista vazia); `frontend/tests/unit/repository-namespace.test.js` é estrutural e **reprova qualquer chamador novo de `createInstance` fora da fábrica**, com allowlist explícita das quatro migrações antigas, que precisam continuar abrindo os nomes pré-namespace.
  - Migração é de custo zero em bytes: os bancos legados sem sufixo viram o slot local número 1 (`LEGACY_DB_SUFFIX` vazio), e essa adoção só é feita quando a origem persistida é LOCAL, senão fabricaria cópia local permanente de um atlas de servidor.
  - O que se paga: até 10 slots vezes 10 bancos por origem; a regra do tab-lock virou uniforme e o predicado compara **endereço de bancos**, não o par (kind, id); e o resgate de trabalho não sincronizado (`adoptRemoteAtlasAsLocal`) cria o único caso em que um slot local carrega sufixo `remote-<atlasId>`, movendo a reivindicação entre registros e zero bytes entre bancos.
  - **A ordem da fiação foi segurança, não preferência:** ligar o resgate no logout ANTES de ativar escopo remoto, e ativar escopo ANTES de tirar a espera do predicado de colisão. Inverter os dois primeiros apaga trabalho do usuário (o trabalho preservado ficaria num namespace que o expurgo varre); antecipar o último é perda de dado por duas abas caindo no mesmo banco.
  - A wiki ainda descreve o produto anterior em várias páginas (P12 aparece em [`../wiki/sintese-decisoes-arquiteturais.md`](../wiki/sintese-decisoes-arquiteturais.md), [`../wiki/dominio-local-vs-remoto.md`](../wiki/dominio-local-vs-remoto.md), [`../wiki/atlas-modelo-de-dados.md`](../wiki/atlas-modelo-de-dados.md) e [`../wiki/formato-ebgeo-roundtrip.md`](../wiki/formato-ebgeo-roundtrip.md)); a atualização dela corre à parte desta entrada.
- **Status:** aceita, e **supera P12** ("um único workspace local", não-objetivo explícito). A entrada de P12 vive na wiki, não neste log, e não é reescrita: o que muda é o produto, e o registro do que se sabia naquele dia continua valendo como história. A alternativa rejeitada *Fila de saída por atlas* foi revertida no mesmo dia: ver a entrada seguinte, e não planeje a partir do "a fila fica global" acima.

---

### 2026-08-15: a fila de saída vira um banco POR ATLAS (reverte a alternativa rejeitada acima)

- **Contexto:** a entrada anterior rejeitou a fila por atlas com três razões, e a primeira delas era a premissa das outras duas: "o envelope de operação não carrega atlas id, então a fila por atlas gravaria o atlas num lugar que ninguém lê". A premissa morreu no mesmo ciclo, porque o carimbo de origem foi implementado (`createOperation` grava `scopeSuffix`, o endereço do banco em que a op nasceu, e `atlasId`, o atlas de SERVIDOR). Sem ela sobrava uma tabela mutável compartilhada por todas as abas, com o isolamento dependendo de um filtro reaplicado em cada leitura. O dono reabriu a decisão por razão de produto, não de engenharia: o produto não foi lançado, está em débito de estrutura, e a arquitetura fecha antes do lançamento, porque mexer nisso depois custa duas vezes.
- **Decisão:** o descritor `OPERATION_QUEUE` passa a `perAtlas: true` e `atlasData: false` (`frontend/src/js/store/atlas-namespace.js`). O atlas X escreve em `ebgeo__<sufixo de X>` e nunca abre o banco de Y, então não enxerga, não drena e não apaga a fila dele. O sufixo legado mantém o nome `ebgeo`, de modo que a instalação comum move zero bytes. O carimbo continua e troca de papel: a separação vira estrutura e o filtro (`operationBelongsToScope`) vira asserção sobre ela, mais a identidade que o servidor lê.
- **Alternativas rejeitadas:**
  - *Manter a fila global com filtro lógico por leitura*: era o estado interino e funcionava. **Filtro é regra que um chamador futuro esquece; banco separado é fato do navegador.** O custo do esquecimento não é um bug visível, é uma op empurrada para o servidor do atlas errado.
  - *Adiar para depois do lançamento* (era uma etapa opcional do plano): cada versão publicada acrescenta uma geração de ops sem carimbo, e a migração precisa decidir de quem elas são. Hoje há uma geração só, roteada uma vez por `migratePendingOperationsToScopedQueues`.
- **Consequências:**
  - **O defeito que isto fecha é o gesto mais comum do produto:** `unmountCurrentAtlas` esvaziava a fila INTEIRA, de todos os atlas, então a aba A trocando de projeto destruía a feição que a aba B tinha desenhado e ainda não subira. Esvaziar a fila passou a ser decisão explícita do chamador (`clearQueue`, em `clearAllDataStore`).
  - **A fila é o único banco por atlas que NÃO é dado do atlas**, e isso separa duas listas que pareciam uma só: o wipe de ENTRADA não a alcança (`openRemoteAtlas` monta o namespace do atlas que abre e esvazia três linhas depois, então incluí-la destruiria o pendente de quem está abrindo, segundos antes do `connect` que o drenaria), e a destruição de namespace alcança (op carrega payload de entidade, e fila de pé depois do logout é dado de servidor legível, que é o invariante da entrada anterior).
  - **O resgate leva a fila junto de graça:** `adoptRemoteAtlasAsLocal` move a reivindicação e zero bytes, então o usuário deixa de recuperar as feições e perder o registro do que não subiu.
  - **O que se paga, e é permanente:** `purgeOldOperations` (7 dias) só alcança a fila do atlas MONTADO, porque enumerar as outras exigiria perguntar ao navegador quais bancos existem, que é justamente o que este desenho não pode fazer. Op velha de atlas desmontado espera a próxima montagem ou morre com o banco dele.
  - **Op sem carimbo é legível de QUALQUER escopo**, de propósito: recusá-la abandonaria trabalho real que ninguém consegue reendereçar.
  - Muda os dois pacotes: o backend declara `atlasId` e `scopeSuffix` no `operationSchema` (como já fizera com `traceId`, por não confiar no `.unknown(true)`) e ganha recusa POR OPERAÇÃO da op que declara pertencer a outro atlas (`foreignAtlasDenialReason`, `backend/src/modules/sync/sync.service.js`). Os dois campos **não são persistidos**: o INSERT usa o atlas da rota, então eles voltam no rebroadcast e não voltam no pull, e nenhuma guarda de cliente pode ser construída sobre a presença deles numa op RECEBIDA.
  - **A ordem foi obrigatória, não preferência:** o wipe com alvo explícito e a migração por slot precisaram entrar ANTES, senão a abertura de um atlas destruiria a fila dele e a migração não alcançaria os slots novos.
- **Status:** aceita. Supera a alternativa *Fila de saída por atlas* da entrada de 2026-08-15 acima, e só ela: o resto daquela entrada continua valendo.

---

### 2026-08-16: um registro único de tipo de feição, e a recusa do modelo de source por camada

- **Contexto:** acrescentar uma ferramenta de desenho custa hoje três arquivos de ferramenta (cerca de 89% das linhas, que é trabalho real) mais um imposto de cerca de 45 linhas espalhadas por dez arquivos, cada uma numa lista fechada diferente, e **nenhuma delas falha alto quando é esquecida**. O imposto também não é pago à vista: rastreando a ferramenta mais recente (o setor, 2026-02-08), três dessas listas só souberam que ela existia entre oito e treze dias depois, com o commit da ferramenta parecendo completo o tempo inteiro. As listas já divergiram: existiam três constantes chamadas `FEATURE_SOURCES` com conteúdos diferentes, e o comentário que declarava `SOURCE_TYPES` canônico descrevia um símbolo que **não era exportado**, com um único leitor. Não havia símbolo importável que significasse "todos os tipos". A pergunta veio de um estudo comparativo do GeoLibre pedido pelo dono: o modelo de dados mais simples daquele projeto valeria aqui?
- **Decisão:** criar `frontend/src/js/store/feature-type.registry.js`, uma linha por tipo, com campos de identidade (`type`, `storage`), apresentação (`label`, `icon`, nulos quando o tipo nunca é nomeado na interface) e capacidade (`selectable`, `copiable`, `imageResource`, `selectionBox`). O arquivo tem **zero imports** e fica **fora dos dois barrels** do store, e as duas propriedades são asseridas por teste, não confiadas à leitura: são elas que o mantêm carregável em node puro e que impedem que uma lista periférica arraste a store ao querer só a lista de tipos. As seis constantes de tipo de `frontend/src/js/store/store.constants.js` passam a ser DERIVADAS dele, mantendo nome, forma e ordem de chave, então nenhum consumidor mudou. **Só o núcleo:** as demais listas não foram migradas; elas foram **censadas**, com motivo escrito uma a uma, por `frontend/tests/unit/registro-tipos-cobertura.test.js`.
- **Alternativas rejeitadas:**
  - *Copiar o modelo do GeoLibre (uma source por camada, estilo por camada)*: é o que motivou o estudo, e é a alternativa que precisa constar aqui, porque quem ler daqui a um ano vai perguntar por que não se foi por ali. Foi medido: exigiria reescrever **todos** os controles de desenho, o dispatcher de operações e o filtro de visibilidade, e ainda assim perderia o que o produto precisa, que é **estilo autoral por feição** no calco militar. O modelo deles compra simplicidade vendendo a camada de operações: sem ela não há fila offline, e a edição feita com o socket caído se perde em silêncio. O custo por classe de sincronização que se paga aqui é exatamente o que compra a correção do sync; ele não é para reduzir, é para tornar verificável.
  - *Uma lista plana de vinte strings*: seria a forma barata e é uma regressão observável. As duas saídas de processamento (`processed_los`, `processed_visibility`) não têm nome nem ícone de propósito, e uma lista plana as empurraria para a aba de feições, para a legenda do PDF e para a seleção por caixa, batizadas de "Feição". Daí os campos de apresentação nulos e o `selectable` separado.
  - *Um campo único de capacidade*: a matriz mostrou que `SELECTION_BOX_TYPES` (`frontend/src/js/utilities/feature_navigation_utils.js`) e `IMAGE_RESOURCE_FEATURE_TYPES` divergem em dois tipos, em direções opostas (o texto tem caixa de seleção e não tem imagem; a medida de coordenação tem imagem e não tem caixa). Um flag só estaria errado para os dois.
  - *Pasta própria com barrel*: o barrel é justamente o perigo. O barrel do store puxa a store inteira, e a página sem mapa que quisesse só a lista de tipos pagaria o grafo todo.
  - *Derivar a lista do backend em tempo de build*: são pacotes separados e nada cruza a fronteira em tempo de build. Essa fronteira se guarda por teste de paridade, que já existe (`frontend/tests/unit/tipos-feicao-paridade-pacotes.test.js`), e o guarda detecta a divergência, nunca a previne.
  - *Migrar as dez listas periféricas agora*: migração não impede classe nenhuma que o censo já não impeça, e custaria três mudanças de saída observável (legenda do PDF, saída do KMZ, aba de feições), mais um teste de equivalência que enquanto vive reprova correção legítima por comparar com o passado, mais uma allowlist usada como barra de progresso, que é um estado indistinguível de allowlist esquecida. Cada lista migra no commit do **bug que ela causa**, com repro próprio.
  - *Regra de lint em vez de teste*: as regras do frontend só rodam sobre `src/`, e o desvio aqui é invisível no arquivo que o comete. Quem acrescenta um tipo não vê, ali, a lista de outro arquivo.
- **Consequências:**
  - **O que passa a falhar alto:** acrescentar uma linha ao registro e não tocar em mais nada deixa vermelhas, **de uma vez e numa mensagem só**, as nove listas que se declaram completas, cada uma nomeando o tipo de que nunca ouviu falar. Antes, essa mesma mudança passava verde no `npm test` inteiro. Foi medido, com uma linha falsa acrescentada e revertida.
  - **O censo é derivado do versionamento, não de alvos escritos à mão** (`git ls-files` sobre `frontend/src/js/`), porque "conferir um subconjunto e tratar como o conjunto" é a classe mais repetida de [`../livro-razao.md`](../livro-razao.md). Todo arquivo versionado que cite cinco ou mais nomes do vocabulário precisa estar no censo, derivando ou declarado.
  - **O censo registra buracos que ninguém tinha escrito.** Cinco entradas declaram lista que parece esquecimento e não decisão: a declinação magnética ausente do PDF (nas duas metades), o setor e a declinação ausentes dos rótulos de "agrupar por tipo", do chip de ferramenta ativa e (a declinação) dos ícones do celular. Nenhum deles é corrigido aqui, de propósito. O que muda é que passam a estar escritos em vez de serem descobertos por um usuário.
  - **O que NÃO muda:** o vocabulário continua quádruplo (tipo, chave de armazenamento, id de ferramenta e nome da classe do control), `frontend/src/js/map_sig.js` continua com três registries, a ordem das chamadas de `frontend/src/js/layers/layer_setup.js` continua sendo o z-order escrito à mão, e o backend continua exigindo quatro edições manuais por tipo novo. O custo cai; não vai a zero.
  - **O preço do desenho do guarda:** a checagem de completude é por PRESENÇA do nome no texto do arquivo, não por extrator ancorado por arquivo. Nove regexes seriam nove maneiras de parar de extrair em silêncio, e este repositório já pagou por extrator que virou "as listas divergiram" quando a verdade era "a âncora quebrou". Em troca, um nome citado só num comentário conta como presente.
- **Status:** aceita. Não supera decisão anterior nenhuma.

---

### 2026-08-16: capa de atlas enviada pelo usuário (supera a recusa de 2026-07-25)

- **Contexto:** a recusa de 2026-07-25 tratou "miniatura" como uma coisa só e mediu as duas pelo mesmo critério, o envelhecimento. Isso vale para o snapshot automático do mapa, que apodrece sozinho, e **não** vale para uma imagem que uma pessoa escolheu: ela envelhece quando quem a escolheu quiser. O dono reabriu pedindo mais informação no cartão de projeto, e o argumento de custo ("infraestrutura para o que a faixa colorida já dá de graça") também mudou de valor: o cartão passou a carregar participantes e presença, então a faixa deixou de ser o único identificador e virou o fundo de tudo isso.
- **Decisão:** o atlas ganha uma **capa opcional**, enviada pela tela de projetos (`PUT /atlas/:id/cover`, gate `write`, o mesmo de renomear). Os bytes vivem em `atlas_covers` (tabela à parte, `BYTEA`), e o cliente reduz a imagem antes de subir (`frontend/src/js/projects/cover-image.js`, teto de 120 kB por capa contra 512 kB de guarda no servidor). Sem capa, a faixa colorida com iniciais continua sendo a identidade, sem mudança nenhuma. **Continua descartado o snapshot automático do mapa**, pela razão original, que ninguém contestou.
- **Alternativas rejeitadas:**
  - *Coluna em `atlas`*: quatro superfícies do cliente chamam `listAtlas()` e três delas só querem id e nome; `SELECT a.*` faria a imagem viajar em toda troca de mapa. Tabela à parte é o que mantém a listagem do tamanho que era.
  - *Guardar a data URI como `TEXT`*: 33% maior e, pior, guarda sem conferir. Em `BYTEA` o serviço decodifica na borda e casa o número mágico com o mime declarado, que é a mesma allowlist do upload de imagem (png/jpeg/webp, sem svg); sem isso `image/webp` é um rótulo que qualquer cliente digita sobre qualquer coisa.
  - *Rota de imagem por atlas (`GET /atlas/:id/cover` servindo bytes)*: a tela autentica por cabeçalho `Bearer` e `<img src>` não manda cabeçalho, então cada cartão precisaria de um `fetch` para object URL. As capas voltam como data URI num pedido só.
- **Consequências:** existe agora infraestrutura de imagem POR ATLAS, que não existia (a do catálogo é outra coisa, e continua sendo). O `GET /atlas/overview` que carrega as capas carrega também participantes e presença, e é a única rota da família cujo escopo mora **dentro da consulta** em vez de vir de `requireAtlasPermission`, porque ela não fala de um atlas. Quem mexer nela precisa manter o predicado de escopo, coberto por `backend/tests/integration/atlas-cartao-projeto.test.js`.
- **Status:** aceita. Supera a metade "sem upload de miniatura" da decisão de 2026-07-25.

---

### 2026-08-16: recursos privados do catálogo, concessão em árvore e empréstimo por atlas (D1 a D6, PROVISÓRIAS)

- **Contexto:** os quatro tipos de recurso do catálogo (modelo 3D, camada de dados, camada de análise, panorama 360) vivem hoje em **três regimes de acesso incompatíveis**, e três deles não têm controle nenhum: `tilesets`, `data_layers` e `analysis_layers` são servidos por `GET /api/config` filtrados só por `active = true`. Esse endpoint é público e memoizado como **um** documento porque `buildAppConfig` ([`../../backend/src/modules/config/config.service.js`](../../backend/src/modules/config/config.service.js)) não lê `req`, usuário nem atlas, e o JSDoc dele declara o invariante. Só o 360 já carrega o predicado dentro do SQL. O dono pediu: um perfil global novo entre `user` e `admin` com acesso a todo privado; marca público/privado por recurso; concessão em dois níveis (ver / ver-e-compartilhar) por quem tem acesso; revogação que derruba a subárvore; e um atlas que **empresta** seus recursos privados a quem o abrir. As seis decisões abaixo estavam em aberto no plano e foram tomadas **na ausência do dono**, cada uma pelo caminho mais reversível, não pelo mais rápido.
- **Decisão:** implementar em fases sobre [`../../backend/src/database/migrations/008_acesso_a_recurso.sql`](../../backend/src/database/migrations/008_acesso_a_recurso.sql) (coluna `access_level` nas **cinco** tabelas de catálogo mais `sv360.projects`, tabelas `resource_grants` e `atlas_resources`, e **três funções SQL** que são a única definição do predicado). O `/api/config` **não passa a variar por chamador**: ele continua sendo o documento público, e o que a pessoa ganha por concessão chega por um segundo endpoint autenticado, somado **aditivamente** no mesmo singleton de configuração do cliente. As seis escolhas:
  - **D1, ordem entre empréstimo (amplia) e as allowlists por atlas (restringe): somar primeiro, intersectar depois.** O cliente monta público ∪ concedido ∪ emprestado e só então `applyAtlasSettings` intersecta as allowlists sobre esse baseline.
  - **D2, revogação: poda recursiva com `revoked_at` (soft), não `ON DELETE CASCADE`.** O CASCADE fica declarado na aresta `parent_grant_id` como rede para um expurgo físico futuro, e é **inerte** por construção, porque revogar nunca apaga linha.
  - **D3, várias concessões vivas por pessoa (DAG), sem índice único.** Revogar derruba exatamente a subárvore daquela concessão; o que outro concedente deu continua de pé.
  - **D4, o empréstimo vive enquanto o DONO do atlas vir o recurso.** Anexar exige que quem anexa veja o recurso; manter exige que o dono veja.
  - **D5, o papel novo chama `curator` no banco e no JWT, "Curador" na interface.**
  - **D6, 360 privado continua visível para a OM dona.** Privacidade restringe quem está de fora; `status = 'disabled'` segue sendo o eixo de ocultação, inclusive da OM.
- **Alternativas rejeitadas:**
  - *Filtrar `GET /api/config` por usuário*: é a premissa recusada que dá forma a todo o resto. O memo passaria a ser por **conjunto de visibilidade**, que é ilimitado, no único endpoint cuja falha impede o produto de subir (boot fail-fast, sem fallback estático). Um endpoint aditivo separado custa uma chamada e preserva a propriedade.
  - *Reusar as allowlists de `atlas.settings` para o empréstimo*: **semânticas opostas na mesma estrutura**: ali lista vazia significa "sem restrição" (contrato congelado de `intersectAvailability`, [`../../frontend/src/js/store/sync/atlas-settings.service.js`](../../frontend/src/js/store/sync/atlas-settings.service.js)), aqui precisaria significar "não empresta nada". Daí a tabela `atlas_resources` separada.
  - *D1 invertida (intersectar e depois somar)*: faria o recurso emprestado **escapar** da restrição que o Gestor configurou no mesmo atlas. O preço da escolha feita, que precisa ir para a interface: um atlas que restringe a lista de modelos 3D tem de incluir ali os modelos que ele mesmo empresta, senão eles somem.
  - *D2 com CASCADE como mecanismo de revogação*: a casa não faz hard-delete de entidade principal, então o `DELETE` nunca aconteceria e o CASCADE **nunca dispararia**: seria um mecanismo que parece existir e não roda, que é a classe de defeito mais cara deste repositório. Além disso o CASCADE **apaga a resposta** ("quem perdeu acesso quando, e por quê" é a pergunta de auditoria) e devolve só a raiz, enquanto a poda devolve a lista dos afetados, que é o que o serviço audita.
  - *D3 com um só concedente vivo por pessoa*: exigiria um índice único parcial e um 409 na segunda concessão. **Recusada por reversibilidade:** acrescentar o índice depois é possível (deduplicando antes); tê-lo agora faz o sistema **recusar** concessões que nunca ficam registradas, e essa informação não volta. E a semântica seria errada: a revogação de A desfaria uma decisão de C.
  - *D4 validando só no momento de anexar*: deixa empréstimo vivo depois que quem o criou perdeu acesso, e exigiria varredura periódica. A condição escolhida é **estável** (o dono é uma coluna, não uma cadeia) e faz a revogação propagar sozinha.
  - *D5 sem tocar em `users.role`* (um marcador em tabela à parte, sem DDL destrutiva) é estritamente mais reversível e foi **considerada e recusada**: o dono pediu um perfil entre `user` e `admin`, que é o eixo de papel, e um segundo eixo paralelo criaria duas respostas para "o que este usuário é".
  - *Row-level security do Postgres*: exigiria papel de banco por usuário ou `SET LOCAL` por request, e o pool aqui é compartilhado. As funções `STABLE` entregam a mesma propriedade sem trocar o modelo de conexão.
- **Consequências:**
  - **Todas as seis são PROVISÓRIAS, aguardando o dono**, e três custam migração destrutiva para desfazer: D3 (índice único), D5 (o `CHECK` de `users.role`) e, em menor grau, D2 (a aresta com CASCADE). D1, D4 e D6 vivem em corpo de função SQL ou em código de cliente e se desfazem com um `CREATE OR REPLACE` ou uma edição.
  - **O predicado nasce como função SQL, uma definição só**, e a de cima é composta das duas de baixo. Isso paga por antecipação a dívida que o schema `ng` já carrega: lá o predicado estava duplicado **verbatim** entre `CATALOGO_SELECT` e `CATALOGO_COUNT`, e o comentário daquele arquivo nomeia uma função de visibilidade de modelo que nunca chegou a existir.
  - **O papel é resolvido no BANCO, nunca recebido do JWT.** `flexibleAuth` é global, não-bloqueante e **não reconcilia** contra o banco, e é justamente ele que serve `/api/config` e as leituras do 360: um curador rebaixado carregaria o papel antigo por até 15 minutos. Resolver no SQL elimina a janela por construção, e é o padrão que [`../../backend/src/modules/nomes/nomes.queries.js`](../../backend/src/modules/nomes/nomes.queries.js) já usa.
  - **A coluna vai nas CINCO tabelas de catálogo, não nas três em uso.** Elas nasceram de `LIKE basemaps INCLUDING ALL` e [`../../backend/tests/integration/catalog-tabelas-paridade.test.js`](../../backend/tests/integration/catalog-tabelas-paridade.test.js) exige conjuntos idênticos de coluna; acrescentar só onde se lê reprova aquele teste. `basemaps` e `streetview_markers` ganham a coluna e nunca a consultam.
  - **ERRATA (F9, migração 021): a frase acima estava errada na segunda metade, e são QUATRO tabelas agora.** Duas correções, e a primeira é a que importa: `basemaps.access_level` SEMPRE foi consultada. `listCatalog('basemaps')` sem principal (os dois sítios que montam o `/api/config`) aplica `access_level = 'public'` desde a própria 017, e a rota crua aplica também o ramo de produção. O que `basemaps` não tinha era tipo de CONCESSÃO, e sem ele o filtro só sabia FECHAR: marcar um basemap como privado o escondia de todo mundo, sem caminho de volta para quem tem direito. A 021 alarga os dois `CHECK` de `resource_type` (`resource_grants` e `atlas_resources`) e faz `basemap` o quinto tipo, cuja superfície é o seletor de camada base. A segunda correção é aritmética: `streetview_markers` foi apagada na mesma migração, por nunca ter tido consumidor nenhum (nem no `/api/config`, nem no frontend, nem em seed), e o nome dela colidia com o de um arquivo VIVO do frontend que é a camada de marcadores do 360.
  - **O único índice único do desenho é o do empréstimo**, e a assimetria com as concessões é deliberada: emprestar duas vezes o mesmo recurso no mesmo atlas não carrega informação, enquanto duas concessões vivas carregam dois concedentes distintos. Ele leva `WHERE removed_at IS NULL` porque sem isso um empréstimo removido ocuparia a vaga para sempre, que é o beco sem saída de [`../../backend/tests/integration/catalog-soft-delete-resurrect.repro.test.js`](../../backend/tests/integration/catalog-soft-delete-resurrect.repro.test.js).
  - **O risco do papel novo é INVERSO ao usual, e por isso ganhou censo.** O padrão "lista fechada de papel" já causou dois bugs reais nos dois pacotes por EXCLUIR o nível de cima; aqui o perigo é alguém escrever `if (role !== 'user')` num gate de administração e dar poder de admin ao curador em silêncio. [`../../backend/tests/unit/papel-global-censo.test.js`](../../backend/tests/unit/papel-global-censo.test.js) classifica cada sítio em poder, dado ou eixo de organização, e reprova sítio novo não classificado.
  - **O que este desenho NÃO entrega, e precisa estar dito:** privado esconde o **metadado**, não os **bytes**. A rota de asset 3D é pública por decisão pinada em teste, então quem souber a URL baixa o `tileset.json` de um modelo marcado privado. Confidencialidade real de asset é projeto próprio e conflita com o regime de cache `immutable` de que o streaming por LOD depende. O 360 não tem esse problema.
  - **D3 ganhou um recorte na implementação (F3), e ele NÃO é o índice único recusado:** a segunda concessão *do mesmo concedente* para *o mesmo beneficiário* sobre *o mesmo recurso* responde 409. O que D3 protege é a concessão de **outro** concedente, que carrega informação (dois caminhos independentes de acesso, e revogar um não derruba o outro); duas linhas do mesmo concedente não carregam nada, e a segunda só criaria uma subárvore irmã que a revogação da primeira não alcança, ou seja, um jeito silencioso de tornar a própria revogação incompleta. A recusa original continua de pé: não há índice único, e o par (concedente, beneficiário) segue livre para se repetir com concedentes distintos.
  - **O gate de compartilhar existe em DUAS camadas, e a segunda precisou de teste próprio.** O middleware protege a rota e o serviço reafirma a regra; o controle negativo mediu que afrouxar a checagem *dentro* de `grantResource` deixava a suíte inteira verde, porque o middleware barrava antes. Um guarda que nada mede é um guarda que ninguém percebe quebrar, então `resource-grants-escalonamento.test.js` passou a chamar o serviço direto.
  - **Revogação vale no próximo pedido do payload aditivo**, ou seja, na próxima troca de atlas ou F5, e não há push em socket vivo. Janela conhecida e aceita.
  - **Continuam existindo DOIS sistemas de permissão para "modelo 3D"** (o catálogo `ng` com suas tabelas de permissão, completo no schema e sem nenhuma API que escreva nele, com o frontend usando o outro catálogo). Este trabalho cria o segundo e **aumenta** a divergência; o sintoma futuro é um administrador conceder acesso na tela errada. Convergir é decisão de produto (os vocabulários de tipo divergem) e fica registrada como pendente, não resolvida aqui. **ERRATA (2026-08-23): já não existem dois.** A decisão de 2026-08-19 removeu o catálogo `ng.catalogo_3d` inteiro, com as tabelas de permissão dele, e o cabeçalho de `backend/src/database/migrations/006_ng.sql` registra a ausência por extenso. O sintoma previsto aqui (administrador conceder na tela errada) deixou de ser possível por falta da segunda tela.
  - **O empréstimo por atlas NÃO alcança as rotas de leitura do 360, e a omissão é deliberada (errata do plano, achada em F6).** O plano manda passar o atlas em foco naquelas consultas. Elas são servidas por `flexibleAuth`, não têm gate de atlas nenhum, e as respostas de tile e de GeoJSON são marcadas como cacheáveis PUBLICAMENTE para o chamador anônimo: honrar um `atlasId` vindo da query entregaria os panoramas emprestados a quem soubesse o UUID do atlas, e ainda os deixaria num cache compartilhado. Hoje o 360 privado chega por papel global e por concessão pessoal; o empréstimo chega aos outros três tipos. Ligar o eixo exige trazer junto a autorização de atlas e rever o escopo de cache das duas rotas, e um caso em [`../../backend/tests/integration/sv360-privado.test.js`](../../backend/tests/integration/sv360-privado.test.js) fixa o comportamento seguro para que ligá-lo sem isso fique vermelho. **Decisão do dono pendente.**
  - **ERRATA (F9): a decisão do dono saiu, o eixo foi LIGADO, e as duas condições vieram junto.** `?atlasId=` passou a valer nas sete leituras de PROJETO do 360 (listagem, slug, as quatro derivadas, `review-stats`, MVT e o GeoJSON legado). (a) O UUID não autoriza: a ordem por rota é `validate` (Joi recusa não-UUID com 422) → `liftOptionalAtlasId` → `requireAtlasScopeWhenPresent`, que roda o `requireAtlasPermission('read')` de verdade quando há atlas (dono, share, `is_public` e o confinamento do visitante de link público ao atlas do próprio token). Atlas inalcançável PROPAGA o 404 do gate; degradar para escopo nulo foi recusado por tornar falha de autorização indistinguível de "este atlas não empresta nada". (b) O escopo de cache aprendeu o empréstimo: `respostaEscopada` soma `req.user` **e** `req.atlasId`, porque um atlas `is_public` dá `read` a chamador ANÔNIMO e sem o segundo termo uma resposta anônima com panorama emprestado sairia `public`; o MVT ganhou `ETag` derivado do **corpo** (hash), que incorpora o conjunto de visibilidade por construção, e as rotas JSON ganharam `private, no-cache` quando a resposta dependeu de quem pediu. O caso de `sv360-privado.test.js` continua de pé com significado novo (um UUID de atlas inalcançável não abre nada), e o par positivo/negativo mora em [`../../backend/tests/integration/sv360-emprestimo-http.test.js`](../../backend/tests/integration/sv360-emprestimo-http.test.js). **AS ROTAS DE FOTO FICARAM DE FORA** (`/photos/:uuid`, `/photos/by-name/:nome`, `/photos/nearest`, `/photos/:uuid/nearby`, `/photos/:uuid/image`): as consultas delas não carregam `sv360AccessPredicate` nenhum, então dar-lhes um `atlasId` seria fiar um parâmetro num predicado que não existe. Isso é o registro de um BURACO, não de uma escolha confortável: ver a errata seguinte.
  - **ERRATA (F9): a frase "o eixo de privacidade do 360 vive SÓ no SQL" descreve CINCO consultas, e o módulo tem NOVE.** `LIST_PROJECTS`, `GET_PROJECT_BY_SLUG`, `TILES_PHOTOS`, `MVT_TILE` e `REVIEW_STATS_ALL_PROJECTS` carregam `sv360AccessPredicate`. `GET_PHOTO_BY_ID`, `GET_PHOTO_BY_NAME`, `GET_PHOTO_SIZES` e `NEARBY_PHOTOS` **não carregam nenhum**, e quem decide por elas é `isProjectReadable`, que por documentação própria cobre só o eixo de `status`. Consequência lida no código: um projeto `enabled + private` entrega metadado, imagem e vizinhança a quem souber o uuid ou o `original_name`, e `/photos/nearest` o entrega **por coordenada**, sem saber nada. O que a F9 corrigiu ali foi só o ESCOPO DE CACHE (a imagem e a miniatura de um projeto `enabled + private` saíam `public, immutable` por um ano; hoje saem `private` + `Vary`), o que não é o gate. Fechar o gate é trabalho próprio, com repro próprio.
  - **ERRATA (F9): `requireGrantRevoker` estreitou para o CREDENCIADO.** O gate consultava `fn_has_global_data_access` antes de olhar `granted_by`, e aquela função inclui o credenciado, ou seja, o papel definido como "lê todo recurso privado e não escreve nada" derrubava a concessão de terceiros, com a subárvore junto. Passa a ser: **administrador** revoga qualquer linha (papel resolvido no BANCO, numa consulta só com a linha da concessão), qualquer outro ator revoga onde `granted_by` é ele. CONCEDER não muda: `requireResourceShare` continua consultando o papel global, e o buraco conhecido de `papel-credenciado.test.js` segue de pé pela metade que sobrou.
  - **O eixo de privacidade do 360 vive SÓ no SQL.** `isProjectReadable` continua síncrona e cobre apenas `status`; decidir privacidade no JavaScript exigiria consultar concessão e empréstimo a cada chamada nos caminhos mais quentes do módulo (foto, thumbnail, tile) e criaria uma segunda definição da regra, que é a dívida que o schema `ng` ainda paga.
  - **ERRATA (F9, tela): a superfície do basemap é o SELETOR DE CAMADA BASE, e ligá-la custou TRÊS peças, não uma.** Somar o basemap concedido em `config.basemaps` (feito com a 021) o faz aparecer na lista e nada mais. (a) O controle conhecia só os cinco estilos embutidos de `frontend/src/js/baselayers/`, montados numa tabela no CONSTRUTOR: a camada concedida chega DEPOIS do boot e o clique nela caía silenciosamente noutra. A resolução virou por demanda ([`../../frontend/src/js/baselayers/basemap-style.js`](../../frontend/src/js/baselayers/basemap-style.js)), com o embutido ganhando do publicado, porque preferir a cópia de `config.basemapStyles` para os cinco repontaria as camadas de todo deploy, de carona numa mudança sobre recurso privado. (b) A lista é remontada no `ATLAS_SETTINGS_CHANGED`, e o login por gesto passou a emitir esse mesmo evento: sem ele o recurso concedido só aparecia no F5 seguinte. (c) O botão **Compartilhar** do basemap mora no seletor, e não no painel de Administração, porque `admin.html` boota sem a store e o modal de concessão arrasta o motor de sync; sem ele um basemap privado não teria tela nenhuma que concedesse acesso a ele, que é a metade que a 021 abriu do lado do servidor. O caminho inteiro (Administração → seletor → estilo aplicado → modal) é dirigido pela interface real em [`../../frontend/tests/e2e-ui/browser-basemap-privado.spec.js`](../../frontend/tests/e2e-ui/browser-basemap-privado.spec.js).
  - **ERRATA (F9): o cache do cliente não atravessa escopo, e a guarda é CHAVE comparada na leitura, não limpeza chamada no disconnect.** A lista de projetos do 360 é decidida por (quem pergunta, qual atlas está em foco) e era um cache de módulo que sobrevivia aos dois: aquecida dentro de um atlas que empresta, `getCachedProjects()` continuava servindo o emprestado à busca, ao briefing, ao catálogo e à camada de marcadores 2D fora dele. O carimbo do escopo mora num módulo FOLHA ([`../../frontend/src/js/store/sync/resource-scope.js`](../../frontend/src/js/store/sync/resource-scope.js), zero imports, porque quem o lê é um chunk lazy), é escrito por `refreshVisibleResources` ANTES da chamada e zerado por `clearVisibleResources`. A alternativa (pendurar uma função de limpeza no disconnect, ao lado de `revertGrantedResources`) foi recusada por só alcançar o cache que alguém lembrou de registrar: o carimbo comparado na leitura falha FECHADO para o próximo cache de módulo que alguém escrever. Controle negativo medido em [`../../frontend/tests/unit/cache-projetos-escopo.test.js`](../../frontend/tests/unit/cache-projetos-escopo.test.js): tirar a guarda da leitura síncrona deixa 4 casos vermelhos, tirá-la de `fetchProjects` deixa 1, e os conjuntos são disjuntos.
  - **ERRATA (F9, censo): as QUATRO consultas de foto ganharam o predicado, e a errata acima deixa de valer.** `GET_PHOTO_BY_ID`, `GET_PHOTO_BY_NAME`, `GET_PHOTO_SIZES` e `NEARBY_PHOTOS` passaram a carregar `sv360AccessPredicate`, e as cinco rotas de foto (`/photos/:uuid`, `/photos/by-name/:nome`, `/photos/nearest`, `/photos/:uuid/nearby`, `/photos/:uuid/image`) ganharam a mesma tripa das irmas (`validate` com `atlasId` declarado, `liftOptionalAtlasId`, `requireAtlasScopeWhenPresent`). O eixo de privacidade do 360 cobre agora NOVE de nove consultas, e o comentario de `isProjectReadable` que afirmava isso deixou de mentir. Duas consequencias que valem escrever: o predicado entra no WHERE de `GET_PHOTO_BY_NAME` e nao no desempate, entao um `original_name` que colide entre um projeto privado e um publico entrega o PUBLICO ao anonimo; e `rebuildPhotoShape` (a releitura que monta a resposta de uma ESCRITA de calibracao) passou a receber o principal, porque rele-la sem ele devolveria zero linha e a escrita responderia 404 depois de gravar. Par positivo/negativo em [`../../backend/tests/integration/sv360-foto-privada.test.js`](../../backend/tests/integration/sv360-foto-privada.test.js).
  - **ERRATA (F9, censo): `?atlasId=` nao era gateado em `GET /resource-access/visible` nem na listagem crua de catalogo, e agora e.** `fn_granted_resource_ids` casa `ar.atlas_id` e NAO pergunta se o chamador participa daquele atlas, entao saber o UUID (que viaja em toda URL de compartilhamento) entregava tudo o que aquele atlas empresta. O JSDoc de `requireAtlasScopeWhenPresent` ja dizia isso por extenso; o middleware simplesmente nao tinha sido aplicado a essas rotas. As duas passaram a rodar `validate` (422 na borda) → `liftOptionalAtlasId` → `auth` → `requireAtlasScopeWhenPresent`, e atlas inalcancavel PROPAGA 404, pela mesma escolha ja registrada para o 360. DOIS testes existentes mudaram de expectativa por causa disso, e a mudanca e a correcao: `resource-grants-prazo.test.js` afirmava que um ESTRANHO com o UUID recebia o emprestimo pelo payload aditivo (o ator virou membro do atlas, que e o cenario que D4 descreve), e `atlas-emprestimo-recurso.test.js` esperava 200-sem-o-recurso para um atlas na LIXEIRA, que hoje e 404 do gate. Par positivo/negativo em [`../../backend/tests/integration/catalogo-cru-concessao.test.js`](../../backend/tests/integration/catalogo-cru-concessao.test.js).
  - **ERRATA (F9, censo): o buraco acima foi achado por um CONTROLE NEGATIVO QUE NAO FICOU VERMELHO, e o metodo vale mais que o achado.** Desligar o ramo `fn_granted_resource_ids` de `accessPredicate` (`catalog.service.js`) e rodar a suite inteira deixava ZERO casos vermelhos: o braco que faz um recurso privado CONCEDIDO aparecer em `GET /api/v1/tilesets` nao tinha um unico teste, porque as suites vizinhas mediam o eixo pelo payload aditivo e pelo `/api/config` e nunca pela rota crua. Um controle negativo que fica verde nao e boa noticia: e a medida de um buraco. Depois do trabalho a mesma reversao derruba oito casos. O censo de superficies ([`../../backend/tests/unit/superficies-de-recurso-censo.test.js`](../../backend/tests/unit/superficies-de-recurso-censo.test.js) e o irmao de cliente em [`../../frontend/tests/unit/superficies-de-recurso-censo.test.js`](../../frontend/tests/unit/superficies-de-recurso-censo.test.js)) existe para que a proxima superficie nasca CLASSIFICADA em vez de nascer descoberta: ele varre `git ls-files`, exige classe e predicado de cada consulta, gate de cada rota de leitura e escopo de cada cabecalho de cache, e prova que reprova apontando a propria varredura para uma fixture nao classificada.
  - **ERRATA (F9, revisao adversarial): ANEXAR um recurso a um atlas passou a exigir autoridade de REPASSE, e o buraco era de ESCALONAMENTO, nao de leitura.** `POST /atlas/:atlasId/resources` gateava por `manage` no atlas mais `assertCanSeeResource`, e `fn_can_see_resource` NAO distingue nivel de concessao: quem tinha so `view` (o nivel cuja definicao e "ve e NAO repassa") emprestava o recurso ao atlas dele, e a distincao `view`/`view_share` que `requireResourceShare` guarda para RECONCEDER era contornada por fora. Somado ao `manage` que publica o atlas e ao `read` que um atlas `is_public` da a chamador ANONIMO, `GET /api/v1/sv360/projects?atlasId=<publico>` entregava o projeto privado emprestado SEM credencial nenhuma. A correcao e na porta de ENTRADA: `requireResourceRelay` (`backend/src/middleware/resource-access.js`) exige papel global de dado, PRODUCAO daquele recurso (`fn_can_produce_resource`, a mesma funcao que gateia a escrita de catalogo) ou concessao viva `view_share`, compondo os mesmos objetos de `requireResourceShare` em vez de redefinir a regra. A porta de SAIDA nao muda: o `read` de `requireAtlasScopeWhenPresent` continua igual, porque o visitante de link publico herdar o emprestimo e R4, e o que a torna defensavel e a cadeia comecar em quem podia repassar. O caso ANONIMO EM ATLAS `is_public` esta agora nomeado por extenso no JSDoc do gate, como consequencia aceita. A ordem `assertCanSeeResource` -> `requireResourceRelay` e contrato (404 do que nao se ve ANTES do 403 do que nao se repassa, senao o 403 confirma a existencia). `requireResourceShare` NAO ganhou o ramo de producao, e a assimetria esta escrita: quem passa por la vai CONCEDER, e `grantResource` precisa de um `parent_grant_id` que so existe para papel global ou `view_share`. Par positivo/negativo em [`../../backend/tests/integration/atlas-emprestimo-repasse-autorizado.test.js`](../../backend/tests/integration/atlas-emprestimo-repasse-autorizado.test.js); controle negativo medido: tirar o gate deixa 5 dos 8 casos vermelhos.
  - **ERRATA (F9, revisao adversarial): duas superficies escopadas nao emitiam `Cache-Control`, e a peca do 360 virou uma so para as tres.** As quatro listagens de catalogo (`GET /` e `GET /:id` de cada tabela) e `GET /resource-access/visible` (o payload ADITIVO, o corpo mais sensivel do sistema, por definicao o delta privado do chamador) respondiam sem cabecalho nenhum, o que autoriza um cache COMPARTILHADO a guardar por heuristica corpos que passaram a variar por concessao e por emprestimo. A isencao do RFC 9111 para `Authorization` nao vale aqui: `flexibleAuth` e global e le tambem o cookie `token`, entao requisicao autenticada chega sem aquele cabecalho. `marcarEscopoJson` e `respostaEscopada` sairam de `sv360.controller.js` para [`../../backend/src/utils/cache-scope.js`](../../backend/src/utils/cache-scope.js) e servem as tres superficies; uma terceira copia da regra e como este defeito volta. O censo de cache seguiu a peca (a entrada mudou de arquivo, nao de classe). Controle negativo medido: tirar as duas chamadas deixa 1 caso vermelho.
  - **ERRATA (F8): o dono decidiu as seis, e duas mudaram.** D1, D2, D3 e D4 foram **confirmadas como estão** e deixam de ser provisórias. D5 mudou de nome: o papel chama `credenciado` no banco e no JWT, "Credenciado" na interface, e a razão não é estética. `curator`/"Curador" soa a CARGO, e cargo convida ao `if (role !== 'user')` que promoveria o papel em silêncio num gate de administração, que é exatamente o risco invertido que o censo de papel existe para pegar; "credenciado" vem da doutrina de credencial de segurança, diz ACESSO em vez de posto, e não colide com nenhuma palavra do eixo por atlas, onde "Gestor" (`manage`) já mora. A troca coube na própria 018 porque nenhum banco fora deste branch a tinha aplicado (ver a entrada de 2026-08-17 sobre reescrever um degrau ainda não publicado). D6 foi **SUBSTITUÍDA**: "a OM dona continua vendo seu 360 privado" continua verdadeira como frase, mas a premissa que a sustentava caiu, porque o eixo de OM que decidia isso era `users.organization_id`, **auto-declarado** no auto-cadastro. Quem vê hoje é a OM **produtora** (`users.producer_org_id`, concedido só por administrador), e a decisão que vale é a de 2026-08-17 abaixo.
- **Status:** as seis foram **decididas pelo dono em 2026-08-17**: D1 a D4 aceitas como escritas, D5 aceita com o nome trocado para `credenciado`, D6 superada pela entrada "o escopo de produção é uma COLUNA" de 2026-08-17. Não supera decisão anterior nenhuma.

---

### 2026-08-17: o escopo de produção é uma COLUNA em `users`, não uma tabela de vínculos (supera D6)

- **Contexto:** `users.organization_id` era **auto-declarado** e **autorizava**. `POST /auth/register` aceita a OM vinda do corpo, validando existência e liveness da organização e nunca pertencimento (a lista de OMs vem do `GET /api/config` anônimo, para preencher o próprio seletor da tela), e conta sem e-mail nasce ativa na hora. Somados, escolher a OM alheia num seletor entregava todo projeto 360 oculto (`status = 'disabled'`) e privado daquela OM. Não era bug: era o comportamento projetado, sobre a premissa errada de que a lotação é atestada por alguém. O plano previa uma tabela de vínculos de produção, e as três respostas do dono a esvaziaram: um CGEO só por pessoa, todos os tipos de recurso daquela OM, sem prazo.
- **Decisão:** o eixo de OM continua autorizando, mas passa a ser **concedido em vez de declarado**. Nasce `users.producer_org_id` (migração 019), escrita só por administrador, com `CHECK` **bicondicional** contra o papel (crachá existe se, e somente se, o papel é `producer`), de modo que crachá sem escopo e escopo sem crachá sejam estados impossíveis no banco. Os recursos ganham OM produtora (`owner_org_id` nas tabelas de catálogo; `sv360.projects.organization_id` já era essa coluna), e `fn_can_produce_resource` é a definição única de quem escreve o quê. `users.organization_id` sobrevive como **lotação e exibição**, sem poder nenhum.
- **Alternativas rejeitadas:**
  - *A tabela de vínculos do plano (usuário, OM, tipos alcançados, prazo)*: é a alternativa que precisa constar por extenso, porque era o desenho de partida. As três colunas que justificariam uma tabela morreram nas três respostas do dono: com um CGEO só, todos os tipos e sem prazo, sobra uma tabela cuja única forma legal é **uma linha viva por usuário**, isto é, uma coluna se fingindo de tabela. O preço seria um `JOIN` em todo predicado de acesso (que roda dentro das consultas mais quentes do 360) e, pior, um estado representável que o produto não admite: duas linhas vivas para a mesma pessoa. A tabela volta a fazer sentido no dia em que uma das três respostas mudar, e o caminho de volta é aditivo.
  - *Manter `organization_id` autorizando e só endurecer o cadastro* (exigir e-mail, exigir aprovação): trata o sintoma e deixa a coluna significando duas coisas ao mesmo tempo, onde a pessoa está lotada e o que ela pode ler. Qualquer caminho futuro de auto-declaração (importação em massa, SSO, convite) reabre o buraco inteiro, e quem escrever esse caminho não teria como saber.
  - *Papel `producer` sem escopo, produzindo tudo*: degenera num segundo administrador com outro nome, e o eixo de OM (que é o que a organização tem de real) sumiria da autorização.
  - *Deixar o escopo viver no JWT*: `flexibleAuth` não reconcilia contra o banco, então um produtor transferido carregaria o escopo antigo por até 15 minutos. A claim existe e é aditiva, mas **nenhum ramo de autorização a lê**: ela alimenta o INSERT de `owner_org_id` e o pré-filtro de upload, e a garantia fica no SQL.
- **Consequências:** o bicondicional obriga papel e escopo a viajarem juntos em toda escrita de usuário, e transferir um produtor de OM **sem** mudar o papel é um evento que não tem `ROLE_CHANGE` para carregá-lo, daí `PRODUCER_SCOPE_CHANGE` ser ação própria na trilha. A escalação estava **documentada por escrito num teste que a afirmava como comportamento correto**, e o conserto foi inverter aquele teste, não escrever um novo ao lado. Repro em [`../../backend/tests/integration/auto-cadastro-om-nao-autoriza.repro.test.js`](../../backend/tests/integration/auto-cadastro-om-nao-autoriza.repro.test.js), que falha contra o código antigo por afirmar 404 onde ele respondia 200 com o projeto oculto no corpo, e cujo passo positivo (o MESMO usuário, promovido a produtor daquela MESMA OM, volta a ver e a escrever) existe para que o negativo não passe verde com fixture quebrada.
  - **ERRATA (2026-08-20): a frase "conta sem e-mail nasce ativa na hora" do Contexto deixou de valer, e a alternativa recusada foi PARCIALMENTE aplicada, de forma aditiva, não em lugar desta decisão.** `email` virou obrigatório no `registerSchema`, então a conta auto-cadastrada nasce PENDENTE e só quem controla a caixa declarada chega a usá-la; a rota ganhou um segundo limitador, por ENDEREÇO (`registerLimiter`), porque a chave `${ip}:${username}` do `authLimiter` é escolhida pelo chamador num cadastro; e o boot em produção recusa subir com auto-cadastro ligado sem `SMTP_HOST` e `APP_BASE_URL`. Nada disso reabilita `organization_id` a autorizar: a razão pela qual aquela alternativa foi recusada continua de pé por inteiro (endurecer o cadastro não conserta uma coluna que significa duas coisas), e o que mudou é só que endurecê-lo passou a valer POR SI. A metade que o Contexto descreve e que **continua aberta** é a auto-declaração de OM, sem aprovação de ninguém. A APROVAÇÃO POR ADMINISTRADOR segue não implementada. Caso que prende: [`../../backend/tests/integration/auto-cadastro-exige-email.test.js`](../../backend/tests/integration/auto-cadastro-exige-email.test.js).
- **Status:** aceita. **Supera D6** da entrada de 2026-08-16: "a OM dona continua vendo seu 360 privado" continua verdadeira como frase, mas a coluna que decidia quem é a OM dona deixou de ser a auto-declarada.

---

### 2026-08-17: o prazo da concessão morre no PREDICADO, nunca em varredura

- **Contexto:** a fase F3 entregou concessão em árvore sem prazo, e concessão sem prazo é permanente por omissão: ninguém revoga o que ninguém lembra que existe. O dono pediu prazo obrigatório, com teto de um ano.
- **Decisão:** `resource_grants.expires_at` é obrigatória, com teto de um ano cobrado na borda, e **toda** consulta de concessão viva carrega `expires_at > NOW()` ao lado de `revoked_at IS NULL`. Concessão filha nunca vive além da mãe: o INSERT aplica um `LEAST` dos três tetos (o prazo pedido, o da concessão-mãe e o teto de um ano).
- **Alternativas rejeitadas:**
  - *Um sweeper periódico que carimba `revoked_at` no que venceu*: é a forma intuitiva e é exatamente a classe de defeito que mais custou a este repositório, um **verificador que quebra calado**. Job parado, cron não instalado, container que não sobe: o acesso vencido continua valendo e nada fica vermelho, porque o sistema em nenhum momento pergunta se o sweeper rodou. O predicado não tem estado a manter, não tem operação, e vale no primeiro pedido depois do vencimento.
  - *Prazo opcional, com nulo significando "para sempre"*: a omissão viraria o caminho comum (é o valor que um formulário devolve quando ninguém pensa no assunto), e o produto voltaria ao estado anterior por default, com uma coluna que promete controle e não exerce nenhum.
  - *Trigger no banco*: mesma família do sweeper, com o agravante de rodar na escrita e portanto não alcançar as linhas já gravadas.
  - *Expirar por leitura preguiçosa* (marcar a linha vencida na primeira consulta que a encontrasse): transformaria toda leitura numa escrita, dentro dos caminhos mais quentes, para materializar um campo que o predicado já sabe calcular.
- **Consequências:** "viva" passou a significar duas condições em cinco consultas, e a que mais importa não é a de leitura: sem `expires_at > NOW()` na consulta que resolve a **concessão-mãe**, quem já não vê o recurso continuaria podendo concedê-lo a terceiros. O custo permanente é uma comparação por linha; o custo evitado é um processo.
- **Status:** aceita.

---

### 2026-08-17: a trilha de auditoria é completa e vive FORA do atlas

- **Contexto:** `audit_trail` existia desde a 001 e cobria pouco. Escritas inteiras nunca deixaram rastro (CRUD de catálogo, `config_settings`, ingestão e exclusão de projeto 360, criação de atlas), e o alvo do log estava sendo **empurrado para dentro de `details`** porque o `CHECK` de `target_type` não conhecia os tipos de recurso e `target_id` era UUID enquanto id de catálogo é slug. Pior, três ações estavam **declaradas no `CHECK` desde o primeiro dia sem nenhum emissor** (`LOGIN`, `LOGOUT`, `ATLAS_DELETE`): quem filtrasse a trilha por `ATLAS_DELETE` recebia lista vazia e concluía que ninguém apagou atlas.
- **Decisão:** a 020 alarga o vocabulário (catorze ações novas, sete tipos de alvo novos), troca `target_id` de UUID para TEXT e devolve o alvo à condição de coluna de primeira classe, com `'SYSTEM'` voltando a significar sistema. A trilha continua sendo tabela **global do backend**, fora do sync do atlas, fora do namespace por atlas e fora de qualquer operação colaborativa.
- **Alternativas rejeitadas:**
  - *Manter o alvo dentro de `details`, evitando a DDL destrutiva*: era o estado, e o preço estava escrito no próprio serviço. `idx_audit_target` deixa de responder à única pergunta que a coluna existe para responder ("tudo que já foi feito com este recurso"), e `'SYSTEM'` permanece como depósito do alvo que não coube. O custo da escolha feita é honesto e está pago: três linhas de DDL destrutiva, cada uma declarada em `EXCECOES_DESTRUTIVAS` no mesmo commit.
  - *Auditar por operação de sync, dentro do atlas*: auditoria que mora dentro do objeto auditado morre com ele, e apagar o atlas apagaria a prova de que ele foi apagado. Além disso, os atos que mais importam neste eixo (papel global, escopo de produção, catálogo, `config_settings`, concessão de recurso) não pertencem a atlas nenhum, e forçá-los a um seria inventar um dono para poder registrá-los.
  - *Uma segunda tabela só para o eixo de recurso*: duas trilhas significam duas respostas para "o que aconteceu com isto", e a consulta que interessa (a linha do tempo de um recurso, ou de um usuário) viraria um `UNION` que alguém esquece de atualizar.
  - *Auditar calibração foto a foto*: deixado de fora de propósito, por ser alta frequência e por a foto já carregar `updated_at`.
- **Consequências:** o censo de auditoria ([`../../backend/tests/unit/auditoria-censo.test.js`](../../backend/tests/unit/auditoria-censo.test.js)) passa a cobrar emissor para toda ação declarada, com piso decrescente de buracos conhecidos, porque **ação sem emissor é um verde que não verifica nada**. Um buraco permanece de propósito e está nomeado: `'STREETVIEW_MARKER'` fica no `CHECK` depois de a tabela morrer (tirá-lo seria uma quarta linha de DDL destrutiva para não ganhar nada, e linhas de trilha já gravadas podem carregar o valor).
- **Status:** aceita.

---

### 2026-08-18: `streetview_markers` sai do sistema, sem depreciação

- **Contexto:** a tabela nasceu de um `LIKE basemaps INCLUDING ALL` na 003 e nunca teve consumidor: não alimenta `GET /api/config`, nenhum código do frontend chama a rota dela e o seed não a popula. As únicas escritas que existiram foram de teste. Ao mesmo tempo ela recebia, por paridade de schema, tudo o que este trabalho acrescentou às irmãs (marca de privacidade na 017, OM produtora e índice parcial na 019), ou seja, permissão construída sobre dado que ninguém lê.
- **Decisão:** remover por inteiro na 021, tabela e rota, sem depreciação, deixando o modelo em **quatro** tabelas de catálogo (`basemaps`, `data_layers`, `analysis_layers`, `tilesets`) e **cinco** tipos de recurso concedível (as quatro mais o projeto 360).
- **Alternativas rejeitadas:**
  - *Depreciar com prazo*: depreciação existe para dar tempo a um consumidor, e não há consumidor nenhum. O que a depreciação manteria vivo é justamente o custo real da tabela, que não é o disco: é a **ambiguidade de nome**. Existe um arquivo homônimo no frontend, [`../../frontend/src/js/street_view_tool/streetview_markers.js`](../../frontend/src/js/street_view_tool/streetview_markers.js), que é a camada VIVA de marcadores do 360 no mapa 2D e lê de `sv360.projects`. Dois nomes iguais para objetos opostos, e um deles tinha de sair.
  - *Renomear a tabela em vez de apagá-la*: o nome certo já pertence ao arquivo vivo, e renomear preservaria uma tabela sem leitor sob um nome novo, que é a mesma dívida com outra etiqueta.
  - *Dar-lhe o eixo de privacidade completo, por simetria*: simetria de schema é a razão de ela ter recebido as colunas até aqui, e é boa enquanto custa uma linha de DDL. Deixou de ser boa quando passou a exigir tipo de concessão, superfície de compartilhamento e classificação no censo.
- **Consequências:** o que a 019 lhe acrescentou morre junto, e isso é o alvo deixando de existir, não regressão daquela migração; as 017, 019 e 020 **não** foram editadas, porque forward-only vale a partir do momento em que a migração sai do branch. A armadilha de execução é séria e vale para quem repetir o gesto: **uma varredura por NOME apaga a camada viva do 360, e a suíte pode nem ficar vermelha, porque é UI**. Quem executar precisa distinguir os dois objetos por CAMINHO, e a verificação aceita aqui foi tripla e independente (diff vazio do arquivo do frontend, comparação byte a byte contra `HEAD`, e captura do Playwright lendo a fonte viva do MapLibre, com controle negativo).
- **Status:** aceita.

---

### 2026-08-18: o empréstimo por atlas alcança o 360, e o UUID do atlas não é senha

- **Contexto:** a F5 fez um atlas emprestar seus recursos privados a quem o abrisse, e a F6 registrou por errata que o eixo **não** alcançava as rotas de leitura do 360, com razão de segurança: aquelas rotas são servidas por `flexibleAuth`, não tinham gate de atlas nenhum, e marcavam tile e GeoJSON como cacheáveis publicamente para o chamador anônimo. Honrar um `atlasId` vindo da query, do jeito que o plano mandava, entregaria os panoramas emprestados a quem soubesse o UUID do atlas, e ainda os deixaria num cache compartilhado. A decisão do dono saiu: o empréstimo vale para os cinco tipos.
- **Decisão:** ligar o eixo trazendo junto as duas condições que a recusa anterior exigia. (a) **O UUID não autoriza**: a ordem por rota é `validate` (Joi recusa não-UUID com 422), `liftOptionalAtlasId` e `requireAtlasScopeWhenPresent`, que compõe o `requireAtlasPermission('read')` de verdade quando há atlas, e atlas inalcançável **propaga o 404** do gate. (b) **O cache aprendeu o empréstimo**: o escopo da resposta soma quem pediu **e** qual atlas estava em foco, o MVT passou a levar `ETag` derivado do hash do **corpo**, e as rotas JSON respondem `private, no-cache` quando a resposta dependeu de quem pediu.
- **Alternativas rejeitadas:**
  - *Honrar o `atlasId` sem gate, como o plano escrevia*: o UUID do atlas viaja em toda URL de compartilhamento e em todo endereço de tela. Tratá-lo como autorização faz "quem souber o UUID vê" virar o modelo de segurança do sistema, e o pior é que ele vira isso **em silêncio**, porque a rota continua parecendo correta.
  - *Degradar para escopo nulo quando o atlas é inalcançável* (responder 200 sem os emprestados, em vez de 404): parece mais gentil e é pior, porque torna falha de autorização indistinguível de "este atlas não empresta nada". Quem depura fica sem sinal, e quem sonda ganha um oráculo barato.
  - *`ETag` derivado de versão ou de `updated_at`*: não incorpora o **conjunto de visibilidade**, então um 304 confirmaria conteúdo através de escopos diferentes, que é o mesmo vazamento pela porta dos fundos. O hash do corpo incorpora o conjunto por construção e não custa consulta extra.
  - *Autorizar na porta de SAÍDA, endurecendo o `read`*: recusada porque o `read` de saída é decisão registrada (o visitante de link público herda o que o atlas empresta) e mexer nele quebraria aquele fluxo. O gate ficou na porta de ENTRADA, exigindo autoridade de REPASSE para anexar o recurso ao atlas, e a consequência extrema (chamador anônimo num atlas público alcança o emprestado) está nomeada por extenso no JSDoc do gate, em vez de existir sem estar escrita.
  - *Manter o eixo desligado e viver com a assimetria*: era o estado, e deixava o 360, que é o tipo com mais superfícies do sistema, fora justamente do mecanismo que o produto usa para compartilhar trabalho.
- **Consequências:** as rotas de FOTO ficaram de fora na primeira passada, por não carregarem predicado de acesso nenhum (fiar um parâmetro num predicado inexistente não é gate), e entraram logo depois, junto com o predicado; as duas erratas estão na entrada de 2026-08-16. O bbox entrou na CTE do MVT no mesmo trabalho, e a medição é o argumento: com acervo real de 29 projetos e 99.040 fotos, oito execuções em série por tile, o p50 caiu de 166,5 para 5,0 ms em z14, de 320,6 para 27,2 ms num z11 de 697 kB e de 296,7 para 4,8 ms num tile vazio, com o `EXPLAIN` mostrando o Seq Scan de 99.040 linhas dando lugar ao índice GiST. O custo que segurava a fase não existia: com o empréstimo ligado, no pior caso o predicado roda 29 vezes, não 99.040.
- **Status:** aceita. **Supera a errata da F6** que registrava a omissão como deliberada.

---

### 2026-08-18: concessão expira, escopo de produção não (assimetria deliberada)

- **Contexto:** o sistema passou a ter dois mecanismos que dão acesso a recurso privado sem ser papel global: a **concessão** entre pessoas (`resource_grants`) e o **escopo de produção** (`users.producer_org_id`). O primeiro ganhou prazo obrigatório de no máximo um ano; o segundo não tem prazo nenhum. A assimetria parece descuido e precisa estar escrita como escolha.
- **Decisão:** concessão carrega prazo obrigatório e morre sozinha; escopo de produção não tem relógio e só sai por ato explícito de administrador, auditado como `PRODUCER_SCOPE_CHANGE`.
- **Alternativas rejeitadas:**
  - *Dar prazo ao escopo de produção, por simetria*: ser o produtor de uma OM é função permanente daquela OM, não favor entre pessoas. Um prazo transformaria manutenção de acervo em renovação periódica, e o modo de falha seria silencioso e caro: no dia em que vence, o acervo daquele CGEO fica **órfão**, sem ninguém para corrigir ou republicar, e o sintoma aparece como "o catálogo parou de ser atualizado", longe da causa.
  - *Tirar o prazo da concessão, por simetria na outra direção*: a concessão é ato entre pessoas sobre um recurso específico, e o risco dela é o oposto, acesso que **sobra** porque ninguém lembra de revogar. É exatamente o que este trabalho existe para fechar.
- **Consequências:** o critério que decide os dois casos, e que serve para o próximo mecanismo de acesso que alguém acrescentar: **prazo protege contra o que se esquece de revogar**. Concessão se esquece (é individual, invisível para terceiros e nasce de um gesto pontual). Escopo de produção não se esquece: ele aparece na tela de Administração, é uma coluna por usuário, tem evento próprio na trilha, e o bicondicional com o papel o mantém visível no mesmo lugar em que se lê "o que este usuário é".
- **Status:** aceita.

---

### 2026-08-18: os bytes do 3D seguem o RECURSO, e a rota continua sem consultar o banco

- **Contexto:** `/api/v1/assets3d/*` era `router.get('/*', serveAsset)` sem um middleware sequer, e a wiki dizia a verdade em voz alta: a proteção era "quem não conhece a URL não baixa". Com tileset PRIVADO isso é segurança por obscuridade, e a URL não é segredo: ela viaja no payload aditivo de `/resource-access/visible` e quem a recebe legitimamente pode repassar o caminho. Ao mesmo tempo a rota é pública por DUAS razões que valem de verdade para o modelo público: o anônimo precisa vê-lo, e `public, immutable` é o que torna o streaming por LOD viável.
- **Decisão:** um caminho só, com o regime decidido POR REQUISIÇÃO a partir de um índice em memória que mapeia caminho servido para linha de catálogo. Público continua 200 sem credencial e `public, immutable`, byte por byte; privado passa pelo gate e volta `private` e imutável com `Vary`, ou 404. O índice é invalidado por `invalidateAppConfigCache()`, que toda escrita de catálogo já chamava. O gate compõe `requireAtlasPermission('read')` (para o `?atlasId=`) e `fn_can_see_resource` (para o recurso), sem uma segunda cópia de regra nenhuma, e a decisão é memoizada por par (chamador, recurso).
- **Alternativas rejeitadas:**
  - *Consultar o banco por requisição*: medido, um `SELECT 1` quente custa 0,056 ms de p50, ou ~4% de um 200 pequeno, então o argumento "seria caro" é fraco e vale trocá-lo pelo verdadeiro. `fn_can_see_resource` não é `SELECT 1` (compõe três funções), o pool é de dez conexões, e esta é hoje a única rota de leitura do backend que **não toca Postgres nenhum**: ligá-la ao pool põe a fan-out de LOD do Cesium disputando slots com o sync, com o socket de colaboração e com o `/api/config`, cuja falha impede o boot.
  - *Um conjunto de IDS em memória, em vez de PREFIXOS de caminho*: o que chega na requisição é `req.params[0]`, e não existe função caminho -> id em lugar nenhum do armazenamento (a tabela do SQLite é `assets(rel_path, ...)` e o disco é uma árvore). Id só serviria mudando a forma da rota, o que invalidaria toda URL já gravada em catálogo.
  - *Rota separada para o privado*: duplicaria ETag, Range, 304, semáforo e os dois backends de armazenamento, e a URL já gravada no catálogo continuaria apontando para a rota aberta.
  - *URL assinada ou token de curta duração*: move o problema para um ciclo de vida de credencial novo, com todo o custo de rotação, e não resolve o caso que mais importa (o visitante anônimo de link público, que não tem credencial nenhuma).
  - *Filtrar o índice por `active = true`*: apagar um tileset privado passaria a PUBLICAR os bytes dele, porque a linha sumiria do índice e o caminho viraria "não reivindicado". O índice ignora `active` de propósito; quem decide o acesso de uma linha apagada é o predicado, adiante.
- **Consequências e o que fica aberto:** a classe `publico-fixo` do censo de cache ficou VAZIA, e o piso `>= 1` que a cobrava foi trocado pela afirmação específica que ele aproximava (nenhuma decisão de cache do `/assets3d` pode ser fixa); o mesmo aconteceu com o piso `>= 2` das rotas públicas do censo, hoje uma igualdade nomeando o `GET /api/config` como a única. Continuam FORA do alcance desta rota, e nomeados no `fileoverview` de `assets3d-regime.js`: prefixo de catálogo servido por nginx ou pelo Vite (a URL canônica `/3d/...` não passa por aqui) e o segundo catálogo de modelos 3D, `ng.catalogo_3d`, que tem eixo de acesso próprio e nenhum chamador no frontend. Medição em série, 60 amostras por caso, antes e depois: o 200 público de 4 kB ficou em 1,17 ms contra 1,26 antes, o 304 público em 0,47 contra 0,64, e o custo do gate aparece só no privado (0,53 ms de 304 contra 0,47 do público). Negação anônima custa 0,21 ms.
- **ERRATA (2026-08-19): o segundo dos dois casos fora do alcance da rota deixou de existir.** O catálogo 3D duplicado do schema do gazetteer saiu inteiro (a entrada de 2026-08-19 sobre o acesso geográfico por zonas, adiante), então o que continua fora do alcance é só o prefixo servido por nginx ou pelo Vite. O `fileoverview` de [`../../backend/src/modules/nomes/assets3d-regime.js`](../../backend/src/modules/nomes/assets3d-regime.js) foi reescrito na mesma passada e hoje nomeia três limites do índice, nenhum deles aquele: o prefixo servido por outro processo, a linha de catálogo cujo caminho fica na RAIZ da árvore (que casaria toda requisição, e por isso é descartada nas duas direções) e o caminho que nenhuma linha reivindica, que é público de propósito.
- **O TETO DESTA LINHA DE TRABALHO, e ele vale para a alternativa recusada tanto quanto para a decisão tomada** (parágrafo resgatado em 2026-08-19 de um documento de trabalho da raiz, sobre superfícies de acesso e rotas públicas, que era o único lugar onde ele estava escrito e que foi apagado na mesma passada; sem crase de propósito, porque o arquivo não existe mais e crase promete caminho que resolve): **nenhum dos dois desenhos entrega confidencialidade contra quem já teve acesso legítimo.** Na URL assinada, a URL é repassável enquanto vale; no regime por recurso, o byte é baixável por quem passou pelo gate, e nada impede que ele o redistribua. O que o eixo inteiro entrega é CONTROLE DE ACESSO, que responde "quem pode buscar", e não confidencialidade, que responderia "quem pode ler o que buscou". Confidencialidade de verdade é criptografia em repouso com chave por destinatário: é outro projeto, muda o formato de distribuição, e brigaria com o `immutable` de que o streaming por LOD depende. Quem pedir "proteger de verdade o modelo sigiloso" está pedindo esse outro projeto, e a resposta honesta é dizer isso em vez de apertar mais este.
- **Status:** aceita.

---

### 2026-08-18: o cookie de sessão NÃO é emitido no login, e a Parte B não o emitiu

- **Contexto:** a especificação desta fase dizia, como premissa, "o cookie já está lá: `flexibleAuth` é global e lê o cookie `token`, e o navegador o envia sozinho em requisição same-origin". A metade da leitura é verdade; a da escrita não. Existe **um** `res.cookie(` em todo `backend/src/`, dentro do ramo de sessão deslizante de `flexible-auth.js`, que só dispara quando faltam menos de 5 minutos para o token expirar **numa requisição que já trouxe credencial válida**. O login devolve os tokens só no corpo JSON, e o frontend os guarda no `localStorage` e os manda como `Authorization`. Ou seja, na janela normal de uso não existe cookie nenhum para o navegador mandar, e um gate apoiado nele negaria o modelo privado ao próprio dono, e de forma INTERMITENTE: porque o cookie surge por acaso nos últimos 5 minutos de vida de cada token.
- **Decisão:** não emitir o cookie no login nesta fase. O que autoriza uma requisição de asset são os dois braços que o cliente controla: `?atlasId=` (que atravessa qualquer requisição, inclusive as que o navegador faz sozinho) e `Authorization: Bearer` onde o cliente monta a requisição (o `Resource` do Cesium, que propaga `headers` e `queryParameters` aos filhos derivados, e o `fetch` da cena de primeira pessoa).
- **Alternativas rejeitadas:**
  - *Emitir o cookie no login*: é a solução COMPLETA, e é a única que alcança o endereço que o navegador busca sozinho (imagem, vídeo, loader de terceiro). Foi recusada por escopo e por risco: mexe no eixo de autenticação, e amplia a autenticação por cookie de uma janela incidental de 5 minutos para toda requisição de toda sessão, incluindo as de escrita, onde o que separa isso de CSRF é o `sameSite`. É decisão do dono, não efeito colateral de fechar uma rota de assets.
  - *Token na query da URL do tileset*: propaga pelo `Resource` do Cesium e resolveria o caso, ao custo de pôr credencial em endereço de imagem, que acaba em log de servidor e em `Referer`.
- **Consequências:** fica um caso ABERTO e nomeado, e ele é de funcionalidade e não de vazamento (falha fechada, com 404): o endereço que o navegador busca sozinho só alcança um recurso PRIVADO quando há um atlas em foco que o empresta. Na prática, a foto de marcador e o clipe de preview de uma cena de primeira pessoa privada não carregam para quem a vê por papel global ou concessão pessoal sem atlas aberto. Está escrito no `fileoverview` de `frontend/src/js/store/sync/assets3d-request.js` e na página [[assets3d-distribuicao]].
- **Status:** aceita, com o caso aberto nomeado.

---

### 2026-08-18: a coluna legada `maps.catalog_layers` SAI, e a definição é podada na saída do log

- **Contexto:** a F11 tirou a desnormalização da camada de catálogo (a linha guarda referência mais estado por atlas; a definição é reidratada na leitura pelo predicado do chamador), mas a reidratação mora dentro de `getAtlasSnapshot`, e a definição continuava escapando por **dois** caminhos que não passam por lá. O primeiro é a coluna legada `maps.catalog_layers`, servida crua por `GET /atlas/:id/maps`, `GET /atlas/:id/maps/:mapId` (as duas `SELECT *`, gateadas em `read`) e `POST /atlas/:id/maps/:mapId/duplicate`, que devolve a linha do mapa novo. O segundo é o ramo INCREMENTAL do pull: `INSERT_OPERATION` grava a carga do cliente verbatim, então toda camada acrescentada por cliente pré-F11 está no log com `config.source.url`, e `GET /atlas/:id/sync/1` devolve o log inteiro para quem tem `read`. Nos dois o teto é o mesmo: visitante ANÔNIMO de link público em atlas `is_public`.
- **Decisão:** (a) a coluna legada é APAGADA (migração 022), depois de materializar cada item do array na tabela dedicada `catalog_layers` com a linha viva vencendo por id; as três consultas passam a listar colunas explicitamente. (b) a definição é PODADA na saída do log, num ponto por caminho: `toFrontendOperation` para o pull incremental e `broadcastOperations` para os dois relays (HTTP e WS). (c) a resolução da referência no servidor passa a ler os TRÊS carregadores que o cliente já lia (prefixo do id, `originalId`, `config.id`) e a PRESERVAR a referência ao podar, que era a metade que faltava para fechar a linha pré-prefixo. (d) o predicado que decide podar é a CLAIM (`type` é `analysis_layer` ou `data_layer`), não o endereço: uma entrada que o servidor não sabe endereçar guarda a mesma cópia.
- **Alternativas rejeitadas:**
  - *Filtrar a resposta das três rotas em vez de apagar a coluna*: protege as rotas que alguém lembrou. A coluna continuaria de pé, servida pela próxima consulta que alguém escrevesse sobre `maps` (a de `duplicate` já era a que ninguém tinha listado), e a mesma definição teria TRÊS superfícies de reidratação para manter em acordo. É a mesma escolha que a F11 fez e pelo mesmo motivo.
  - *Migração que reescreve o JSONB já gravado no log (higiene)*: recusada por ora. Depois da poda nenhuma rota entrega aqueles bytes; o log é append-only por desenho e sustenta `min_version` e a idempotência por `op_id`; e um `UPDATE ... SET data = data - 'config'` sobre JSONB de tamanho arbitrário reescreve a tupla inteira, infla a tabela e, com um predicado errado, corrompe o replay de ops que nada têm com catálogo. Existe alternativa mais barata e reversível para a mesma preocupação: `POST /sync/admin/cleanup` já apaga log antigo e sobe `min_version`, o que força snapshot para quem estiver atrás. Se o dono quiser mesmo assim, a forma segura é uma migração SEPARADA, depois desta verde, com `WHERE entity_type = 'catalog_layer' AND (data ? 'config' OR ...)`.
  - *Manter o ramo de array escrevendo a coluna, ou removê-lo*: o ramo passou a materializar cada item como LINHA da tabela, e faz upsert sem nunca remover. A escrita na coluna era um REPLACE de array inteiro, inofensivo enquanto nada lia a coluna; a mesma semântica contra a tabela canônica transformaria uma op com `catalog_layers: []` num apagamento de todas as camadas do mapa. Nenhum cliente vivo emite essa forma, então a compatibilidade não vale uma capacidade destrutiva nova.
  - *Reidratar também no pull incremental*: a op é payload de cliente, não entidade materializada; reidratar ali daria uma terceira superfície de reidratação para manter em acordo. O cliente resolve a definição do `/api/config` dele, que já é filtrado pelo mesmo predicado.
- **Consequências:** a chave `catalog_layers` do payload de `POST /atlas/import` continua aceita (contrato congelado com `local-atlas-to-server.js`) e é materializada direto na tabela: nenhum cliente muda. Um cliente da versão ANTERIOR que ainda não recarregou recebe, do log e do relay, a referência sem a definição: o documento local dele não é reescrito, então a camada que ele já tinha continua desenhando, e a que outro usuário acrescentar enquanto ele estiver aberto chega sem URL e não renderiza até o reload. É a degradação escolhida; a alternativa é servir a URL de recurso privado a quem tem `read`. Fica registrado, e NÃO corrigido nesta fase, um defeito vizinho achado no levantamento: `sync.controller.js` recarimba o broadcast com `inserted.entity_id`, que para camada de catálogo é o id do ATLAS, então o par recebe a op com o id errado (UPDATE vira PUSH duplicado, DELETE não remove); o caminho WS não recarimba e está certo. Toda a suíte usa `generateUUID()` como id de camada, que é por que isso nunca ficou vermelho.
- **Status:** aceita.

---

### 2026-08-23: `active_sessions` não é recriada, e a presença fica em memória por decisão

- **Contexto:** a tabela nasceu como vocabulário de presença e nunca teve leitor. Os dois escritores (`createSession`/`deleteSession`) saíram em 2026-07-25, e o que a manteve depois disso foi a regra forward-only: derrubá-la seria DDL destrutiva. A consolidação de 2026-08-19 suspendeu esse argumento, porque as baselines nascem no estado final: a partir dela, **criar** a tabela é que passou a ser o ato deliberado.
- **Medição desta instalação, antes de decidir:** zero `INSERT`, `UPDATE`, `DELETE` e `SELECT` em `backend/src` (as três ocorrências do nome eram comentários explicando a ausência); no banco de desenvolvimento, `n_tup_ins = 0` e os quatro índices com `idx_scan = 0`. A presença viva é o `Map` por processo de `collab.rooms.js`, o que casa com um deploy de UMA instância.
- **Decisão:** não recriar. A tabela e os dois índices saem de `004_sync.sql`, que passa a explicar a ausência no lugar em que ela morava.
- **O que substitui os testes que a vigiavam:** eles contavam linhas de uma tabela para provar que nada as escrevia, o que media UMA tabela: uma escrita de presença que fosse parar em outro lugar passaria verde. `backend/tests/ws/collab-presenca-sem-banco.test.js` mede a propriedade direto, com contador de pool: um ciclo de socket não emite escrita nenhuma. Ele traz caso de discriminação, porque lista vazia de escritas é o mesmo verde de um contador cego.
- **Alternativa recusada:** ressuscitar com leitor. Ela não resolveria problema hoje (uma instância só; "quem está online" se responde lendo o `Map`) e traria de volta o que matou a primeira tentativa: heartbeat persistido, reaper e escrita no caminho quente do socket. Se voltar, começa pelo LEITOR, e com os três no mesmo commit.
- **Custo aceito:** um banco que já aplicou a `004` mantém a tabela órfã. Ela é inofensiva (sem escritor, sem leitor) e some na próxima recriação; não há produção.
- **Status:** aceita e aplicada.

---

### 2026-08-19: as 22 migrações viram 8 baselines por domínio, e o histórico de evolução passa a viver só no git

- **Contexto:** 22 arquivos, 2762 linhas, das quais cerca de 1550 são comentário. O schema chegou ao estado atual por evolução, e o preço aparece na leitura: dez pares cria/desfaz atravessam os arquivos (o id da camada de catálogo nasce UUID e vira TEXT; o CHECK de ação da trilha nasce com 15 valores, vai a 18 e termina em 32; o papel global nasce com dois valores e termina com quatro; um tileset é semeado num arquivo e apagado em outro; uma tabela nasce por cópia e é derrubada treze arquivos depois; uma coluna de mapa nasce e é apagada). Ninguém diz qual é o estado final sem reconstruí-lo mentalmente, e quem lê o arquivo de atlas conclui, corretamente para aquele arquivo e erradamente para o banco, que `maps.catalog_layers` existe. Duas condições tornam o esmagamento possível agora: não há deploy oficial (nenhum banco fora de desenvolvimento rodou estas migrações, e o dono autorizou explicitamente esmagar o histórico), e a convenção da casa já diz que forward-only vale a partir do momento em que a migração sai daqui. Há um agravante que vira critério: **este é o SEGUNDO esmagamento**. O primeiro unificou 19 incrementais em 5 baselines, e os cabeçalhos de hoje ainda enumeram os números de origem daquela época, números que agora COLIDEM com os números vivos (o cabeçalho do arquivo do gazetteer cita uma "017" que não é a 017 de hoje). Um esmagamento que documenta sua origem por número produz, na geração seguinte, uma citação que resolve para o arquivo errado.
- **Decisão:** oito arquivos, agrupados por DOMÍNIO e ordenados por DEPENDÊNCIA, com nome que diz o domínio: identidade, auditoria, atlas, sync, catálogo, gazetteer (schema `ng`), 360 (schema `sv360`) e acesso a recurso. O estado final do schema é idêntico ao que as 22 produzem hoje, menos o catálogo 3D duplicado do `ng`, que é decisão irmã desta fase e sai junto. Nenhum `ALTER` desfaz coisa criada no mesmo lote: todo CHECK, todo tipo e toda coluna nascem na forma FINAL, e por construção o conjunto não tem uma única DDL destrutiva, o que deixa a lista `EXCECOES_DESTRUTIVAS` vazia. Nenhum cabeçalho enumera números de origem: quem quiser a história usa o git. Os arquivos são baseline e não ponto de evolução, então o primeiro deles recusa, com mensagem própria, um banco que já rodou o conjunto antigo.
- **Alternativas rejeitadas:**
  - *Manter o histórico incremental, que é o default e tem argumento real.* Migração aplicada é registro histórico, e a regra da casa é explícita: nunca renumere, renomeie ou reordene uma migração já aplicada. A regra vale enquanto existir um banco que passou por elas, e não existe nenhum. Contra ela pesa um custo diário e crescente: o estado final não está escrito em lugar nenhum, está distribuído em pares cria/desfaz, e cada leitor o reconstrói de novo, com o agravante de que um agente que lê o arquivo certo chega à conclusão errada. E o histórico não se perde ao esmagar: ele continua no git, com data, autor e mensagem, que é onde história pertence. O que se perde é a capacidade de reproduzir o schema por degraus, e isso só serve para migrar um banco existente, que é exatamente o que não há.
  - *Esmagar em um arquivo único.* Cerca de 900 linhas de DDL mais mil de prosa num arquivo só, e, pior, apaga a única fronteira que o repositório usa mecanicamente: a separação por arquivo é o que permite afirmar que o domínio do atlas continua JSONB puro, sem PostGIS. O invariante existe hoje como um teste que lê arquivos por nome; sem arquivos separados ele deixa de ser verificável por leitura.
  - *Esmagar por cronologia,* uma baseline com tudo que existia antes das fases de permissão e outra com elas. Foi o critério do primeiro esmagamento e é o que produziu os cabeçalhos que enumeram números mortos. Cronologia não é coesão: a coluna de nível de acesso pertence à tabela que a carrega, não a um arquivo chamado "fase 8", e a próxima fase de permissão voltaria a espalhar colunas por um arquivo novo.
  - *Preservar os números 001 a 005 para poupar as 66 citações de migração que a documentação carrega.* Recusada por medição: nenhuma dessas citações traz número de linha, então o guarda de documentação acusa as 66 de uma vez e o conserto é mecânico e verificado. Manter o número, ao contrário, deixaria 14 citações apontando para um arquivo cujo conteúdo mudou (o catálogo sai do arquivo de sync), e isso não fica vermelho nunca. Trocar um vermelho alto e mecânico por um erro calado é o inverso do que esta casa faz. A mesma medição obriga uma contrapartida: existem 40 citações de migração em comentário de `.js`, sem guarda nenhum, e uma delas já está podre desde o primeiro esmagamento, apontando para um arquivo que nunca existiu com aquele nome. Renomear sem fechar essa classe seria criar 40 mentiras silenciosas, então a consolidação traz o guarda que faltava.
  - *Deixar a auditoria dentro do arquivo de identidade,* como a proposta de partida pedia. Recusada pela evidência de churn: dois dos 22 arquivos existem SÓ para alargar o vocabulário da trilha, e esse vocabulário é a união dos vocabulários de todos os domínios. A trilha não muda junto com usuário; muda junto com a funcionalidade que emite o evento. Como a tabela não tem FK nenhuma (o autor é deliberadamente sem FK, para o log sobreviver ao apagamento do usuário), a posição do arquivo é livre e o critério pode ser puramente de coesão.
- **Consequências:**
  - **Um banco existente precisa ser recriado, e o erro não pode ser enigmático.** O runner casa por NOME de arquivo, sem checksum, então um banco com as 22 linhas antigas não reconhece nenhum arquivo novo, tenta aplicar todos e estoura no primeiro `CREATE TABLE` com "relation already exists", mensagem que não diz o que aconteceu. Por isso o primeiro arquivo levanta explicitamente quando a tabela de rastreio carrega um dos NOMES do conjunto antigo, com o comando de conserto no texto (o alvo `recreate` de `backend/scripts/dev-db.js`). O predicado é por nome e não por "há alguma linha" de propósito: dizer QUAL nome foi reconhecido é o que transforma a mensagem em diagnóstico, e o caso de um lote novo parcialmente aplicado não é o mesmo problema (ali o runner pula o que já consta e segue). Essa é a única DDL não declarativa do conjunto, e ela é um verificador, então tem sonda própria: um teste cria banco descartável, semeia uma linha no rastreio e exige a mensagem.
  - **O histórico de evolução do schema deixa de ser legível nos arquivos.** O git sobre o diretório de migrações continua respondendo quando cada coluna nasceu e por quê; o arquivo não responde mais. É o custo aceito.
  - **Forward-only volta a valer a partir do arquivo 009.** O esmagamento é ato único autorizado pela ausência de produção, não licença permanente.
  - **A prosa preservada é maior que o DDL, e é o resultado certo.** O critério de corte é um só: comentário que explica o ESTADO sobrevive, comentário que explica a TRANSIÇÃO morre junto com a transição que descrevia.
  - **Nomeia-se uma classe de risco nova, que é o modo de falha próprio deste exercício: prosa que explica uma AUSÊNCIA perde a âncora quando o DDL que a produzia some.** Cinco ausências ficam sem evidência no schema esmagado, e cada uma passa a depender de um comentário escrito de propósito: a tabela de tilesets nasce vazia (o par semear/apagar desaparece, e sem aviso alguém repõe o item semeado); o catálogo tem quatro tabelas e não cinco (a tabela derrubada nunca é criada); o mapa não tem coluna de camadas de catálogo (o `DROP COLUMN` desaparece); o papel global tem quatro valores e não é escada (o alargamento desaparece); e a tabela de sessões ativas continua sem escritor. Esta última muda de argumento, e a mudança é o próprio ponto: "migração é forward-only e aditiva" deixa de existir como justificativa, e recriar a tabela vira escolha deliberada, registrada, em vez de inércia herdada.
  - **A lista de exceções destrutivas fica vazia, e lista vazia comparada com varredura vazia é verde que não verifica.** O teste passa a ter controle negativo próprio: os padrões destrutivos são rodados contra uma fixture que os contém, e cada um tem de ser detectado, antes de a varredura sobre os arquivos reais afirmar zero. Na mesma passada o invariante do PostGIS é invertido de allowlist para denylist (hoje três nomes de arquivo são checados; passa a ser todo arquivo que não seja um dos dois espaciais), o que fecha um buraco existente: um arquivo novo com PostGIS no domínio do atlas passaria hoje.
  - **A equivalência é provada, não afirmada.** Dois bancos, um migrado pelo caminho antigo e outro pelo novo, comparados em consultas de catálogo do Postgres (colunas, constraints, índices, funções, gatilhos, sequências, alvo de estatística, comentários, extensões, ordem posicional de coluna e hash do dado semeado). O critério de aceitação é falsificável em duas linhas: o lado novo não pode ACRESCENTAR nada, e tudo que ele remove tem de nomear uma das três tabelas do catálogo 3D duplicado. A comparação também é um verificador, então ela é sondada antes de valer, com diferenças conhecidas injetadas de propósito no lado novo.
  - **ERRATA MEDIDA, escrita no dia da execução: o critério "não acrescenta nada" foi FALSIFICADO, em duas classes, e as duas são melhorias.** O diff final tem 23 linhas de acréscimo e 86 de remoção. As remoções fecham como previsto (todas nomeiam o catálogo 3D duplicado, exceto as duas classes abaixo). Os acréscimos são:
    - **21 constraints de NOT NULL que MUDARAM DE NOME.** As três tabelas de catálogo que nasciam clonadas herdavam da primeira o nome auto-gerado das constraints, então o banco antigo tem literalmente uma constraint chamada como se fosse da tabela de camadas de base **dentro** da tabela de tilesets. Escrever as quatro por extenso dá a cada uma o nome da própria tabela. Mesma coluna, mesma semântica, nome deixa de mentir. Nada no repositório referencia esses nomes.
    - **2 definições de função que diferem SÓ no texto do comentário** interno, porque `pg_get_functiondef` devolve o corpo inteiro, comentário incluído, e a prosa daquelas duas foi reescrita para deixar de citar números de migração que não existem mais. Afirmar "é só comentário" seria chancelar a própria saída, então o harness ganhou uma **décima segunda seção**: o mesmo corpo de função com os comentários `--` removidos e o espaço normalizado. Essa seção tem ZERO acréscimos e uma única remoção (a função de gatilho do catálogo 3D), o que prova que o texto EXECUTÁVEL de toda função sobrevivente é idêntico, incluindo as quatro do eixo de acesso e a de peso de tipo do gazetteer, que precisavam sair na versão FINAL e não na primeira.
    O que a errata ensina, e vale além desta fase: um critério de diff vazio sobre `pg_get_functiondef` mede prosa junto com código, então ou a prosa é congelada (e a consolidação perde metade do seu propósito), ou a comparação ganha uma segunda leitura que separa as duas coisas. A segunda é a certa, e ela é barata.
- **Status:** aceita.

---

### 2026-08-19: o acesso geográfico por zonas sai inteiro, a busca de topônimo deixa de ter eixo de acesso, e conceder a um COLETIVO renasce no schema da aplicação

- **Contexto:** o schema do gazetteer carregava um segundo sistema de autorização, completo no DDL e paralelo ao eixo de recurso privado: zonas-polígono, concessão de zona por usuário e por grupo, um resolvedor espacial único, sete rotas de administração sob perfil de administrador, uma marca de privacidade por linha na tabela de topônimos com índice parcial próprio, uma tabela de edificações com a rota que a servia, e um catálogo de modelos 3D com mais duas tabelas de permissão. Três medições decidiram, e a terceira é a que fecha. **Nenhuma tela consumia**: as sete rotas respondiam, e o Painel do Administrador nunca teve aba de zonas, então o subsistema era alcançável só por chamada direta à API. **A metade que o tornaria útil nunca existiu**: as tabelas de grupo e de membros daquele schema não tinham UM escritor no repositório inteiro, nem rota nem tela, enquanto a escrita de permissão de zona por grupo funcionava de verdade, ou seja, dava para conceder uma zona a um grupo em que ninguém podia estar, e aquele ramo do predicado nunca devolveu uma linha. **E o dado que ele protegia deixou de ser privado**: por decisão de produto do dono, busca de topônimo não tem restrição de acesso.
- **Decisão:** remover o subsistema inteiro no mesmo trabalho do esmagamento das migrações, sem depreciação e sem período de convivência: as três tabelas de zona, o resolvedor espacial, o módulo de rotas, a tabela de edificações com a sua rota, a marca de privacidade da tabela de topônimos com o seu índice parcial, o predicado de acesso da consulta de busca (que perdeu junto o parâmetro de usuário), o segundo catálogo 3D com as suas duas tabelas de permissão, e as três ações de zona mais o alvo de zona do vocabulário da trilha de auditoria, porque ação declarada sem emissor lê como "isto é auditado" e não é. A ideia que sobrevive muda de lugar e ganha a metade que lhe faltava: `access_groups`, `access_group_members`, `resource_grants.grantee_group_id` e `fn_user_group_ids` nascem no schema da APLICAÇÃO (`backend/src/database/migrations/008_acesso_a_recurso.sql`), com FK de verdade para `users`, e o acervo do catálogo continua carregável porque o ramo de modelos 3D de `dev/import-gazetteer.mjs` foi repontado para `public.tilesets`. Na mesma passada nasce `fn_principal_vivo`, porque o ramo de concessão nunca checou conta ativa enquanto o de papel global sempre checou.
- **Alternativas rejeitadas:**
  - *Dar tela às sete rotas e escrever o cadastro de grupo que faltava*, isto é, terminar o subsistema em vez de removê-lo. É a leitura otimista da medição 1, e ela morre na medição 3: sem topônimo privado, a zona não protege nada. Terminar o mecanismo entregaria uma tela de administração cujo efeito observável seria zero.
  - *Manter a marca de privacidade da linha e remover só as zonas*, deixando "privado" visível a administrador. Recusada porque o eixo ficaria com um ramo só e nenhuma superfície de concessão: uma marca que só o ETL escreve e que nenhum ato de usuário consegue afrouxar não é controle de acesso, é dado escondido por acidente de carga.
  - *Escrever a metade que faltava dentro do próprio schema do gazetteer.* Aquele schema é dado de REFERÊNCIA carregado por ETL externo e declara explicitamente não participar da integridade referencial da aplicação (os identificadores de usuário de lá são UUID sem FK, de propósito). Um grupo que concede acesso quer o oposto: quer FK, quer cascata e quer morrer junto com o usuário que o compõe.
  - *Chamar as tabelas novas de grupos, sem qualificador.* O nome já existe no schema da aplicação e é outra coisa (os grupos de FEIÇÃO dentro de um mapa). Duas coisas com o mesmo nome no mesmo schema é o defeito que este repositório acabou de pagar em `streetview_markers`, onde uma tabela morta e um arquivo vivo do 360 dividiam o nome e uma varredura por nome teria derrubado o lado vivo.
  - *Deixar a página de wiki do subsistema como nota histórica*, que era o mais barato, porque uma dúzia de páginas apontava para ela. **Recusada pelo dono**: página que descreve o que não existe é lixo na documentação, e o argumento "fica porque há links" é o inverso do critério (o link é que sai). O porquê migra para cá, que é o registro datado e que não envelhece; a wiki fica com o sistema que existe.
- **Consequências:**
  - **Este registro passa a ser o único lugar onde a razão da remoção está escrita por extenso**, e é para isso que ele existe. Quem for reintroduzir restrição de leitura no gazetteer precisa saber que o eixo anterior foi medido como morto, não abandonado por esquecimento. O eixo vivo de acesso a recurso é outro, tem página própria, e o predicado dele nasce como função SQL exatamente para não repetir o do catálogo 3D que saiu aqui, duplicado verbatim entre listagem e contagem.
  - **Conceder a um coletivo passa a existir de verdade, e com isso nasce uma lista fechada em potencial**: `resource_grants` tem `CHECK (num_nonnulls(grantee_id, grantee_group_id) = 1)`, então gate ou tela que assuma beneficiário-pessoa ignora a concessão coletiva em silêncio. É o mesmo modo de falha que a constituição descreve para o nível de permissão por atlas, na forma nova.
  - **PostGIS continua pré-requisito de qualquer deploy** (`backend/src/database/migrations/006_ng.sql` cria a extensão incondicionalmente): o gazetteer continua espacial, o que saiu foi a autorização espacial.
  - **Resíduo conhecido no dia, nomeado para não ser lido como intenção:** o controller do gazetteer ainda calcula um identificador de usuário e o passa ao service, que o descarta no destructuring. É código morto com aparência de eixo vivo, e a limpeza dele não foi feita aqui.
  - **A documentação pagou o preço em um lote:** catorze wikilinks em onze páginas apontavam para a página removida, e a prosa em volta descrevia o subsistema, não apenas o citava. Nenhuma das três classes do guarda (`frontend/tests/unit/docs-integridade.test.js`) alcança a maior parte disso: caminho e símbolo só cobrem o que está entre crases na forma que a regex reconhece, e afirmação falsa não tem guarda nenhum. O verde do guarda não foi, e não podia ser, o critério de pronto.
- **Status:** aceita.

---

### 2026-08-19: administrar grupo de acesso é papel global de DADO (administrador ou credenciado), e listar grupo não é administrar

- **Contexto:** o grupo de acesso existia inteiro no schema desde a baseline de acesso a recurso (tabelas, coluna de beneficiário coletivo em `resource_grants`, índice e `fn_user_group_ids`) e nenhuma linha de JavaScript o tocava, então aquele ramo do predicado nunca devolveu uma linha em produção, exatamente como o mecanismo de grupo do `ng` que a mesma baseline removeu. Ao escrever a superfície que faltava, a única pergunta em aberto era a autoridade, e ela estava registrada como não tomada. A confusão a evitar tinha nome: **administrar o grupo e conceder a ele são perguntas diferentes**. Conceder já passa por `requireResourceShare`, que aceita papel global, escopo de produção ou concessão viva com `view_share`, e não pergunta papel global de ninguém.
- **Decisão:** administra grupo quem tem papel global de DADO, isto é administrador **ou** credenciado, por um gate novo (`requireGlobalDataAccess`, `backend/src/middleware/resource-access.js`) que resolve `fn_has_global_data_access` no banco. Ele cobre as seis rotas de escrita e a lista de MEMBROS; a listagem de grupos fica com `auth` sozinho. É a primeira escrita que o papel `credenciado` ganha, e o argumento é de alcance: ele já lê todo recurso privado, então compor um grupo não lhe abre nada sobre dado, e o que um grupo muda é a quem **ele** repassa, o que continua passando por `requireResourceShare`.
- **Alternativas rejeitadas:**
  - *`requireAdmin`, a escolha óbvia e a que o documento de passagem sugeria.* Recusada pelo dono. O credenciado já enxerga tudo, então a restrição não protegeria dado nenhum; ela só concentraria numa pessoa a composição de vocabulário organizacional, e mecanismo cuja porta depende do administrador é mecanismo que ninguém usa. O ramo do predicado continuaria morto na prática, que é precisamente o defeito que este trabalho existe para fechar.
  - *Abrir a administração a quem tem `view_share` em algum recurso*, unificando os dois gates pelo lado permissivo. Recusada por escopo: `view_share` é autoridade sobre UM recurso, e compor grupo é autoridade sobre quem vê o quê no sistema inteiro. Seria escalada por composição, e a pessoa nem precisaria do recurso de destino para exercê-la.
  - *Fechar a listagem no mesmo gate da escrita, por simetria.* Recusada porque quebra o produto do outro lado: quem tem `view_share` num recurso e não é administrador nem credenciado concede a grupo legitimamente, e sem poder listar não tem como escolher um. O ramo de grupo voltaria a ser inalcançável pela interface, com o mesmo sintoma de antes e uma causa nova.
  - *Criar um papel global novo para a capacidade.* Recusada porque o eixo global tem quatro valores que **não** formam escada, e cada valor novo multiplica os sítios que o censo de papel global tem de classificar. A capacidade cabe inteira num papel existente cuja definição já a implica.
  - *Comparar o papel em JavaScript (`req.user.role`).* Recusada duas vezes pelo mesmo motivo que fez o predicado nascer em SQL: o token vive até 15 minutos e `flexibleAuth` não reconcilia, então um credenciado rebaixado carregaria o papel antigo por essa janela; e uma comparação de dois valores seria a lista fechada de papel que o censo do backend existe para impedir.
- **Consequências:**
  - **A definição de `credenciado` muda, e a frase "lê todo recurso privado e não escreve nada" deixa de valer.** A distinção que ela existia para manter continua de pé por outro caminho: ele não é administrador do sistema, e usuários, organizações, catálogo e configuração seguem fora do alcance dele. As duas cópias da frase (constituição do backend e wiki) foram corrigidas no mesmo commit.
  - **O gate novo é o único deste eixo que não pergunta por um recurso**, e é isso que o torna usável onde não há recurso na URL. Quem escrever administração nova sem recurso deve reusá-lo em vez de recompor a mesma leitura.
  - **A lista de membros fica do lado fechado**, e a listagem de grupos do lado aberto. O critério é o tipo de dado: nome de grupo é vocabulário e serve ao seletor; quem está dentro é roster de pessoas. Se um dia o nome do grupo virar informação sensível, o conserto é no seletor, não no gate, sob pena de reabrir o buraco acima.
  - **A trilha de auditoria ganha cinco ações e um alvo próprio** (`ACCESS_GROUP`, que não reusa o `GROUP` do grupo de feição de um mapa), alargando os dois CHECK na primeira migração forward-only depois da consolidação. Alargar CHECK em Postgres não tem forma aditiva, então `EXCECOES_DESTRUTIVAS` volta a ter linhas, duas, poucas horas depois de a consolidação a ter esvaziado.
  - **Revogar o papel de um credenciado não desfaz os grupos que ele criou.** A autoria fica registrada e o grupo continua de pé, concedendo o que concedia; quem quiser desfazer apaga o grupo, que é um ato próprio e auditado. Não há varredura que reconsidere grupos por mudança de papel do autor, pela mesma razão que não há sweeper de expiração.
- **Status:** aceita.

---

### 2026-08-20: o grupo de acesso vira entidade de USUÁRIO, com dono, e o produtor ganha visibilidade e concessão de raiz

- **Contexto:** duas frentes que se encostam na mesma leitura, e por isso uma decisão só. (a) Administrar grupo era papel global de DADO desde 2026-08-19 (administrador **ou** credenciado, por `requireGlobalDataAccess`), e a lista de grupos era global; com o compartilhamento de atlas passando a valer por grupo, aquele desenho abria um encadeamento curto: quem manda em grupo distribui acesso a atlas que não é dele. (b) O produtor mantinha o acervo da OM e não decidia o que dele era público (`requireAdmin` na rota de visibilidade), não podia conceder acesso ao que ele mesmo produz (o serviço exigia um `view_share` de onde derivar) e, pior, ANEXAVA um recurso da própria OM a um atlas dele e o empréstimo **não resolvia para ninguém**: o braço D4 de `fn_granted_resource_ids` perguntava por papel global e por concessão do dono, e nunca se o dono PRODUZ o recurso. Os três gates do anexo passavam, o 201 era honesto, e a leitura seguinte vinha vazia, sem erro em lugar nenhum.
- **Decisão:**
  - **Grupo é coisa de usuário.** Qualquer sessão autenticada cria um; quem cria é o DONO (`access_groups.owner_id`, coluna nova, retroalimentada de `created_by`); administra o dono vivo ou o administrador do sistema, por `fn_can_administer_group`. A listagem é recortada por posse, e a recusa é **404 uniforme**, nunca 403. Uma segunda leitura aberta (`GET /participating`) mostra a quem participa o nome do grupo e o do DONO, sem roster.
  - **Isso SUPERA a decisão de 2026-08-19**, que fica registrada e não reescrita. O credenciado mantém o eixo de RECURSO inteiro (lê todo privado sem concessão, concede de raiz nos dois níveis, revoga o que ele deu) e perde exatamente um item: autoridade sobre grupo alheio.
  - **Apagar o grupo e tirar um membro PODAM.** As concessões feitas ao coletivo, e a subárvore que os membros alimentaram através dele, caem pela rotina única `podarPorRaizes`. A saída de um membro segue a aresta `parent_grant_id`, e não "tudo o que ele concedeu": o repasse feito por autoridade PESSOAL continua de pé.
  - **A autoridade morre com quem a exercia, no eixo de grupo:** `fn_user_group_ids` passa a exigir `fn_principal_vivo` do DONO do grupo, simétrico ao que o braço D4 já faz com o dono do atlas.
  - **O produtor entra no eixo de recurso pelos três verbos:** marca público/privado (`requireResourceMaintainer` mais `fn_can_produce_resource` no `WHERE` da escrita), concede de RAIZ o que produz, e o braço D4 passa a reconhecer a produção do dono do atlas, o que faz o empréstimo resolver de fato.
- **Alternativas rejeitadas:**
  - *Manter a administração de grupo no papel global e mitigar o encadeamento no eixo de atlas.* Recusada pelo dono: a cerca teria de existir em dois lugares e valer para os dois, e a que sobra é sempre a que ninguém escreveu.
  - *Recortar só a LISTAGEM por posse, deixando o `POST /grants` aceitar qualquer id de grupo.* Recusada porque é obscuridade e não autorização: o id viaja no corpo, e quem o tenha visto antes continua concedendo. A mesma função entra no `WHERE` de `GET_ADDRESSABLE_LIVE_GROUP`.
  - *Responder 403 para grupo alheio.* Recusada: com a listagem recortada, o 403 conta que aquele id existe. É a escada que `assertCanSeeResource` já segue.
  - *Promover `created_by` a dono em vez de criar coluna.* Recusada: quem criou é história e quem manda é autoridade, e fundir as duas impede qualquer transferência futura sem falsificar o registro de criação.
  - *Hard delete do grupo.* Recusada porque `resource_grants.grantee_group_id` referencia `access_groups(id)` sem `ON DELETE`: só passaria destruindo as concessões (a resposta de auditoria que a própria decisão manda preservar) ou anulando a coluna (que apaga QUAL grupo).
  - *Exigir que um administrador conceda ao produtor acesso ao que a OM dele produziu.* Recusada: inverte a relação e cria uma concessão que precisaria ser renovada todo ano para o mantenedor continuar enxergando o próprio acervo.
  - *Fazer o produtor derivar a concessão de um `view_share` fictício.* Recusada: `parent_grant_id` é escrito num lugar só, e um pai inventado tornaria a poda da subárvore incoerente. Produção é raiz pela mesma razão estrutural que papel global é.
- **Consequências:**
  - **`requireGlobalDataAccess` deixa de existir.** Ele ficou sem chamador quando as seis rotas do módulo trocaram de gate, e gate de autorização órfão é a pior forma de código morto: o próximo a lê-lo conclui que o credenciado ainda administra grupo. A entrada de 2026-08-19 continua citando o nome, e por isso ele entra em `SIMBOLO_INEXISTENTE_DE_PROPOSITO` (`frontend/tests/unit/docs-integridade.test.js`), porque apagar o nome do registro histórico falsificaria o registro.
  - **A unicidade de nome de grupo passa a ser POR DONO.** O índice novo é estritamente mais fraco que o global anterior, então a troca não pode falhar por dado pré-existente. Dois grupos SEM dono podem repetir o nome, porque NULL não colide com NULL: são os órfãos do backfill, e eles não concedem nada.
  - **O dono passa a revogar concessões que ele não concedeu** (as que um administrador deu ao grupo dele, e as que os membros repassaram a partir dele). É mais largo do que `requireGrantRevoker` permite em geral, e é o que a cadeia de autoridade implica; daí o campo de origem nos detalhes de cada `PERMISSION_REVOKE` da poda.
  - **A concessão-raiz do produtor sobrevive à perda do escopo de produção**, até o prazo, porque o predicado de leitura confere a vida do BENEFICIÁRIO e nunca a do concedente. Não é defeito novo (a raiz de um administrador rebaixado sobrevive igual), mas o comportamento passa a valer para mais um papel. O EMPRÉSTIMO por atlas não tem a assimetria: D4 é reavaliado a cada leitura.
  - **O produtor pode tornar PÚBLICO o que era privado na OM dele**, inclusive um recurso sobre o qual outra pessoa concedeu acesso. É a mesma autoridade que o administrador já tinha, agora com escopo de OM. Assimetria (privatizar sim, publicar não) seria decisão própria e não se deduz do código.
  - **`fn_produced_private_resource_ids` diverge de propósito de `fn_can_produce_resource` para o ADMINISTRADOR** (zero linhas contra true), e só lista o PRIVADO. Quem reusar a função nova como "o que este ator mantém" recebe resposta errada para admin; daí o nome longo e o caso de teste que AFIRMA a divergência.
  - **`resource-grants-prazo.test.js` foi re-ancorado em `pg_get_functiondef`, e isso é o fix, não higiene.** Ele contava as ocorrências de prazo lendo o TEXTO do arquivo 008; com a 011 substituindo a função por `CREATE OR REPLACE`, aquele texto passou a descrever uma definição morta: reverter o termo de produção deixava o teste VERDE e o empréstimo do produtor quebrado. Verificação-fantasma de manual.
- **Status:** aceita.

### 2026-08-20: o eixo de papel dentro da organização (`users.org_role`) sai do código inteiro

- **Contexto:** a coluna nasceu com um desenho em que existia hierarquia DENTRO da OM (dono, administrador, editor, leitor). O único gate que já a leu foi a escrita de projeto 360, e ele migrou para o escopo de produção na fase F6, pelo motivo que condena o eixo todo: a lotação (`users.organization_id`) é AUTO-DECLARADA no auto-cadastro, então um crachá dentro de uma organização escolhida pelo próprio interessado nunca poderia autorizar. O que restou não decidia nada no servidor, e por isso a página de modelo de dados recomendava "sai depois, não nesta fase".
- **Decisão do dono (D7):** remover **totalmente**, e não "manter como descritivo". Sai a coluna, sai a claim do token, saem as consultas, sai o campo do formulário de usuário e sai a semente do papel por atlas no cliente.
- **O que tornou a remoção urgente, e não cosmética:** a função única de hidratação de sessão do cliente (`sessionUserInfoFromMe`, compartilhada pelos CINCO sítios que criam sessão) fazia `role: user.org_role || UserRole.VIEWER`. Os dois eixos escrevem os dois valores mais altos com as MESMAS palavras (`owner`, `admin`), então o crachá de OM virava, sem conversão nenhuma, o papel POR ATLAS: quem tivesse `org_role = 'admin'` abria o app desenhado como Administrador de atlas (barra de ferramentas inteira, apagar mapa, gerir usuários) tendo papel global `user` e nenhuma permissão em atlas nenhum. O servidor recusava cada uma dessas ações, então o custo era **afordância que mente**, não brecha. Depois da remoção a hidratação começa em LEITOR, e quem abre o eixo é o servidor, no payload de `connect`.
- **Alternativas rejeitadas:**
  - *Manter a coluna como campo descritivo e só parar de semear o papel do cliente com ela.* Recusada pelo dono, e a razão é a mesma que a página de modelo de dados já registrava: enquanto existir uma coluna com nome de papel, alguém vai gatear por ela. O conserto de um sítio não impede o próximo.
  - *Converter `org_role` num papel por atlas de verdade na hidratação (um de-para).* Recusada: seria dar significado de autorização a um campo cuja origem é auto-declarada, que é exatamente o defeito que a migração 019 já corrigiu para a lotação.
  - *Apagar a coluna da baseline de identidade em vez de derrubá-la numa migração.* Recusada: bancos de desenvolvimento já rodaram a baseline, e forward-only vale a partir do momento em que a migração sai daqui. O `DROP COLUMN` é explícito, com linha em `EXCECOES_DESTRUTIVAS`.
  - *Recusar com 422 o corpo que ainda mande o campo.* Recusada: o `stripUnknown: true` da borda descarta em silêncio, e uma aba em cache continua salvando o resto do formulário. Recusar transformaria um campo morto numa falha de gravação.
- **Consequências:**
  - **A claim para de ser emitida, mas o token legado continua chegando com ela.** A regra escrita nos dois mapeadores é ignorar o desconhecido: não há campo em `req.user` para onde ela vá. E a condição de reconciliação da sessão deslizante **perdeu o disjunto `org_role !== undefined`**, o que não é limpeza: com ele de pé, um token legado que trouxesse apenas a claim morta entraria no ramo e faria a LOTAÇÃO ser promovida do banco, o oposto exato do que auth-05 prende. O caso está escrito em `backend/tests/integration/flexible-auth-precedence.test.js`.
  - **A classe `ORG` do censo de papel global morreu com o eixo** (`backend/tests/unit/papel-global-censo.test.js`): oferecer uma classe que nenhuma linha pode habitar convida a classificar um sítio do papel GLOBAL como se fosse de outro eixo, que é o erro de leitura que aquele arquivo existe para impedir. O piso de sítios varridos caiu de 20 para 18, medido.
  - **O arquivo de teste `org-role-writable.test.js` foi apagado** de `backend/tests/integration/`. Ele provava que um administrador conseguia escrever a coluna e que o valor chegava ao JWT; o negativo que ele carregava de brinde (quem não é administrador não edita usuário) já vive em `backend/tests/integration/users-admin.test.js`. (Citado pelo nome-base de propósito: o guarda de caminho de `docs-integridade` exige que todo caminho em crase resolva, e foi ele quem pegou a primeira redação desta linha.)
  - **A citação em crase de `org_role` nas páginas de wiki NÃO reprova em `docs-integridade`**, e vale dizer por quê para ninguém contar com essa guarda: a regra de símbolo só reconhece camelCase, SCREAMING_SNAKE e `fn_*`; nome de coluna em snake_case minúsculo é ponto cego declarado do próprio arquivo. Quem envelhece essas páginas é leitura, não teste. Como consequência lateral, o token `org_role` continua no índice de símbolos porque as duas migrações o citam em código (a que cria e a que apaga).
- **Status:** aceita.

### 2026-08-21: produzir exige a OM PRODUTORA viva, e o rebaixamento de quem concedeu continua não propagando

- **Contexto:** revisão adversarial da onda de 2026-08-20, com as duas conclusões medidas contra um PostgreSQL real, não lidas. As duas tratam da mesma pergunta ("a autoridade morre com quem a exercia?") em dois eixos diferentes, e só uma delas foi fechada agora.
- **Decisão (1), aplicada:** `fn_can_produce_resource` e `fn_produced_private_resource_ids` passam a exigir que a OM apontada por `users.producer_org_id` esteja ATIVA. As duas conferiam a conta e a OM de LOTAÇÃO (`users.organization_id`), e nunca a produtora; como as duas colunas podem apontar para organizações diferentes, desativar a OM produtora deixava o acervo privado dela sendo mantido, marcado público/privado e listado como repassável.
- **Por que agora, e não numa arrumação:** a onda de 2026-08-20 plugou o eixo de produção em três superfícies que ele não tinha (o braço de empréstimo por atlas, o campo `shareable` da listagem e o gate de manutenção). A primeira delas é lida por VISITANTE ANÔNIMO de link público, medido. Espalhar o predicado sem fechar o furo transformava uma leitura do próprio mantenedor numa leitura de qualquer um. Desativar OM é kill-switch declarado em [`../wiki/organizacoes-om.md`](../wiki/organizacoes-om.md), e a assimetria não estava escrita em lugar nenhum: era o ramo que ninguém tinha perguntado.
- **Alternativa rejeitada:** registrar a assimetria por escrito e abrir item próprio. Recusada porque o único lugar onde ela aparecia era o título de um teste que diz "morre com a conta e com a OM de lotação", nomeando a metade que funciona sem dizer que a outra não é conferida. Documentar um furo cuja tela é anônima é escolher a data de quando ele será explorado.
- **Onde a checagem entra, e o detalhe que decide:** DEPOIS do early return de papel, e não no `SELECT` inicial. Um administrador não tem `producer_org_id`, então uma checagem posta no `SELECT` o trancaria fora do gate de manutenção do catálogo inteiro, em silêncio. Há caso próprio para isso.
- **Decisão (2), NÃO aplicada e registrada:** a concessão de RAIZ continua sobrevivendo ao REBAIXAMENTO de quem a concedeu (produtor que perde o escopo, administrador que vira usuário comum). O que muda é que o fato passou a ser MEDIDO, no último caso de `backend/tests/integration/produtor-concede-de-raiz.test.js`, em vez de narrado num comentário.
- **E a parte que ninguém tinha escrito:** D8(b), da onda seguinte, foi especificado como "uma concessão de raiz vive enquanto `fn_principal_vivo(g.granted_by)`". Aquela função pergunta se a CONTA está viva, não se a AUTORIDADE está, e rebaixar não desativa ninguém. Logo D8(b), como está, NÃO fecha este caso, e o plano dá a impressão contrária. Quem implementá-la decide entre exigir a autoridade da raiz no braço de concessão (`fn_has_global_data_access(g.granted_by) OR fn_can_produce_resource(g.granted_by, ...)`, que é custo de leitura) e declarar que rebaixamento nunca propaga. Nos dois caminhos o teste já existe: num, ele é invertido; no outro, ele vira a asserção da decisão.
- **O contraste é o argumento:** o empréstimo por atlas é reavaliado a cada leitura e CAI no mesmo rebaixamento (medido em `backend/tests/integration/emprestimo-do-produtor-resolve.test.js`). Os dois eixos ficam hoje com regras opostas sobre o mesmo ato, e a onda de 2026-08-20 multiplicou a população de quem concede de raiz: todo produtor de toda OM, cujo escopo muda por transferência.
- **Status:** (1) aceita e aplicada; (2) **SUPERADA no mesmo dia** pela entrada de 2026-08-21 "as pendências da constituição são pagas", que fez o rebaixamento derrubar o que a pessoa concedeu, pela forma simples. O código está em `fundamentoDeRaizPerdido` mais `podarPorRaizes` (`backend/src/modules/users/users.service.js`, origem `USER_DEMOTION`), na mesma transação do UPDATE de papel. O item (2) ficou escrito como aberto até 2026-08-23, e o título desta entrada continua afirmando o contrário do produto: leia-o como história, não como estado.

### 2026-08-21: o compartilhamento de atlas ganha o eixo de GRUPO, e ele chega a `manage`

- **Contexto:** `atlas_shares` era nominal desde a primeira versão: uma linha por pessoa. O grupo de acesso, que já decidia recurso privado, virou entidade de usuário com dono na onda anterior, e a pergunta que sobrou foi se ele também poderia decidir acesso a atlas. O caminho de menor risco (teto em `write` para grupo) foi apresentado ao dono como alternativa.
- **Decisão do dono (D2):** os QUATRO níveis concedíveis (`read`, `comment`, `write`, `manage`) valem para grupo, como já valem para pessoa. `owner` continua fora, e não por escolha de aplicação: o CHECK de `atlas_shares.permission` nunca aceitou o valor.
- **As duas mitigações são obrigatórias e entram no MESMO commit**, porque são elas que tiram a amplificação de autoridade da invisibilidade: (i) só se compartilha com grupo PRÓPRIO, pelo predicado de posse da onda anterior (`assertCanAdministerGroup`), com erro 404; (ii) a lista de quem tem acesso ao atlas NOMEIA O DONO do grupo, para o gestor ver de quem é a composição que está aceitando.
- **O risco que elas endereçam, dito por extenso:** quem administra a composição de um grupo passa a distribuir co-Gestão de um atlas que não é dele, só acrescentando gente ao grupo, sem linha nova em `atlas_shares`, sem passar por gate nenhum e sem aparecer em lugar algum. As duas mitigações não removem a delegação; elas a tornam visível e limitam quem pode iniciá-la.
- **Alternativas rejeitadas:**
  - *Tabela irmã (`atlas_group_shares`) em vez de coluna.* Recusada: os leitores de `atlas_shares` que decidem acesso ganhariam cada um um JOIN e um UNION próprios, e "quem alcança este atlas" passaria a ter duas respostas que precisam concordar. `permission`, `added_by` e `added_at` são idênticos nos dois alvos, então a tabela irmã seria a mesma tabela com outro nome. O padrão de `num_nonnulls` já existia em `resource_grants`.
  - *Teto em `write` para grupo.* Recusada pelo dono, com as mitigações como contrapartida. Ela pode ser aplicada depois sem migração, com um ramo no schema e um caso de teste.
  - *Resolver a precedência em JavaScript, num quarto ramo de `resolvePermission`.* Recusada: a mesma aritmética teria de ser reescrita em SQL para as três listagens de atlas, e seriam duas cópias da precedência, que é o defeito de escada duplicada que esta casa já pagou duas vezes. `fn_user_atlas_shares` deixa `resolvePermission` com os mesmos três ramos e muda só o SIGNIFICADO do argumento `share`.
  - *Uma frame `sharing_updated` única, carregando o nível do GRUPO.* Recusada e substituída por duas frames, uma de composição e uma por membro conectado com o nível EFETIVO. `sync-engine.js` aplica `msg.role` cru, então a frame única rebaixaria no cliente quem tem share direto maior: a barra de ferramentas some sem motivo e volta no F5, que é a forma mais cara de defeito de UI.
  - *Expor o grupo como uma entidade no cartão de "Seus atlas", em vez de expandi-lo em pessoas.* Recusada porque faria o próprio membro não se ver na lista de participantes do atlas de que ele participa.
- **Consequências:**
  - **A precedência é o MÁXIMO, e a escolha tem uma prova de uma linha:** acrescentar um caminho nunca rebaixa ninguém, porque máximo é monótono sob inclusão de conjunto e o caso antigo (só o direto) é o conjunto de um elemento. O teste de 4x4 pares afirma a igualdade com o maior E as duas desigualdades separadas, porque a igualdade sozinha ficaria verde para uma implementação que devolvesse sempre `manage`.
  - **A morte do share por grupo apagado é por RESOLUÇÃO, nunca por escrita.** A exclusão de grupo é soft e não dispara o `ON DELETE CASCADE`; quem para de entregar acesso é `fn_user_group_ids`, a mesma função que decide recurso privado e que já exige dono vivo. Preço declarado: a linha fica inerte em `atlas_shares` para sempre, e um caso de teste conta que ela continua lá: se algum lote acrescentar um DELETE naquele caminho, a duplicação de mecanismo aparece em vermelho em vez de passar despercebida.
  - **O gate do WebSocket entrou no mesmo commit, e não podia não entrar.** `reconcileAuthorization` rechama a resolução a cada heartbeat: um ramo de grupo que valesse só no handshake daria acesso que morre em ~30 s, com o sintoma (queda sem explicação) longe da causa.
  - **A checagem de posse é no ATO, não contínua**, e ela cobra o SENTIDO da mudança, não a rota: o `POST` sempre, o `PUT` só quando SOBE o nível, e nem o `DELETE` nem o `PUT` que rebaixa cobram coisa alguma além de `manage` no atlas. A assimetria tem precedente em `requireGrantRevoker`: tirar acesso nunca pode ser mais difícil que dar, senão um grupo compartilhado por quem depois perdeu a posse ficaria preso ao atlas para sempre. (A primeira escrita gateava o `PUT` nos dois sentidos, e com isso aplicava a regra ao contrário: apagar o vínculo alheio era permitido e rebaixá-lo não, deixando ao gestor do atlas só a ação mais destrutiva. Corrigido na revisão adversarial da mesma onda.)
  - **A transferência de posse continua exigindo share DIRETO**, agora dito por extenso no `WHERE`. Posse é nominal por construção, e a mensagem de recusa vai soar errada para quem alcança o atlas por grupo: se incomodar, o conserto é a frase, não a regra.
  - **`EXCECOES_DESTRUTIVAS` não ganha entrada por causa deste bloco**, e isso não é sorte: o `UNIQUE (atlas_id, user_id)` herdado continua valendo porque NULL não colide com NULL (NULLS DISTINCT), medido nesta instalação antes de escrito e pinado por um caso de teste que fica vermelho se a premissa deixar de valer.
  - **Nasce um censo estrutural** (`backend/tests/unit/atlas-shares-eixo-de-grupo-censo.test.js`) com duas varreduras independentes: uma cobra classificação de toda menção à tabela, com contagem exata dos dois lados, e a outra acusa a FORMA proibida (ler `permission` de `atlas_shares` num SELECT) esteja ela declarada ou não. Sem ele, esta onda consertaria cinco sítios e não consertaria a classe.
  - **A lista de participantes do ATLAS atravessa a decisão D6, e a travessia é deliberada.** D6 fecha o *roster do grupo*: quem está dentro dele só é visível a quem o administra. `fn_atlas_member_ids` expande o grupo em pessoas, então um atlas cujo ÚNICO share seja um grupo passa a mostrar, a qualquer participante (`GET /atlas/overview` é `auth`-only), um conjunto que coincide com aquele roster. Aceito, com o recorte escrito: a lista não diz de que grupo cada pessoa veio, não revela que grupos existem, e só é servida a quem já compartilha aquele atlas, porque participar do mesmo atlas já é fato mútuo, e sempre foi. A alternativa (não expandir) foi recusada acima por um motivo maior: faria o próprio membro não se ver na lista de participantes do atlas de que participa.
  - **As duas funções da migração carregam o MESMO par de predicados de grupo** (vivo E de dono vivo). `fn_atlas_member_ids` nasceu filtrando só `deleted_at IS NULL` e discordava de `fn_user_atlas_shares` exatamente no caso do dono desativado: o cartão contava e NOMEAVA quem o gate recusava com 404. Duas portas para o mesmo fato só valem se fecharem juntas, e a que ficou aberta era a que divulgava nome de quem não é membro.
  - **A frame do eixo de PESSOA também passou a anunciar o nível EFETIVO.** O risco 5.3 tinha uma metade espelhada que a onda não viu: enquanto `updateUserShare`/`removeUserShare` anunciavam `req.body.permission`, tirar o share direto de quem também alcança por grupo respondia 204 dizendo `user_removed` sobre alguém que continuava co-Gestor. `effectiveRolesFor` ganhou junto o ramo de atlas PÚBLICO, que faltava, e continua sem o atalho de papel global, de propósito, porque o cliente ignora toda frame de compartilhamento para um administrador.
- **Status:** aceita e aplicada.

### 2026-08-21: revogar deixa de derrubar quem ainda tem outro caminho, e a autoridade passa a morrer com quem a exercia

- **Contexto:** a poda seguia a aresta `parent_grant_id` e derrubava a subárvore inteira, sem perguntar se o concedente de cada descendente ainda tinha autoridade. Como `grantResource` pendura o filho no `view_share` mais ANTIGO do concedente (`LIVE_GRANTS_OF_ACTOR` ordena por `created_at`), revogar aquele caminho derrubava um acesso que continuava legitimamente autorizado por outro. E, do outro lado, desativar quem concedeu não propagava para nada: a concessão de quem tem papel global (ou de quem produz) é RAIZ, sem pai, então a cascata não tinha por onde descer.
- **Decisão do dono (D3):** vale a regra "se B não caiu, D não deve cair". Ao podar, um descendente cujo concedente ainda tenha `view_share` vivo sobre aquele recurso, fora do alcance da poda, é REPAI-ADO nesse outro pai em vez de revogado.
- **Decisão do dono (D8b):** a autoridade morre com quem a exercia. Desativar quem concedeu derruba o que ele concedeu, sem transferência automática de autoridade.
- **Bloqueio de entrada, cumprido antes de escrever produção:** medir contra um PostgreSQL real se a CTE proposta é aceita, porque a recusa mudaria o desenho inteiro e a prova de disjunção. Medido no 18.1 migrado, com o statement completo e dado real: **aceito**, com o resultado exatamente projetado. `hashtextextended` (o lock consultivo) também está disponível.
- **Alternativas rejeitadas:**
  - *Recusar o repai quando o pai novo vence antes, em vez de aparar o prazo do filho.* Recusada: ela faz D cair no caso exato em que B não caiu, que é o contrário da decisão. O precedente já estava escrito em `grantResource`: entregar o que dá para entregar e dizer, na resposta e na auditoria, até quando vale. O preço aceito é que o aparo desce pela subárvore e encurta acesso de terceiros que não participaram da revogação, e a trilha é o único lugar onde isso aparece.
  - *Resgatar também quando o único pai alternativo está DENTRO da poda.* Recusada: um resgate cujo pai é ele mesmo resgatado é um ponto fixo, e ponto fixo em CTE é laço. Degrada para revogar, que era o comportamento anterior.
  - *Manter o resgate quando a travessia é truncada pelo teto de 32.* Recusada: a prova de aciclicidade depende de `alcance` conter TODOS os descendentes, e uma travessia truncada não contém. `teto.truncado` desliga o resgate inteiro, fail-closed. Existe, portanto, um cenário em que "B não caiu" e mesmo assim "D cai", e ele é deliberado, não um defeito a reportar.
  - *Reusar `PERMISSION_GRANT` ou `SHARING_CHANGE` para auditar o repai.* Recusadas: a primeira faria "quem deu acesso a Fulano" devolver um ato que ninguém praticou; a segunda já significa um fato sobre o RECURSO, e este é um fato sobre uma ARESTA. Nasce `PERMISSION_REPARENT`, com `details.kind` discriminando o repai do aparo de prazo: uma ação para dois efeitos, porque separá-los partiria a história de uma poda em duas listas que não se cruzam.
  - *Implementar D8(b) SÓ como predicado, do jeito que a decisão está escrita.* Recusada depois de medida: o predicado não cascateia (a resolução lê a própria linha e nunca o pai), então ele mata o degrau de cima e deixa o neto de pé, e nada seria repai-ado.
  - *Implementar D8(b) SÓ como poda na desativação.* Recusada pelo motivo simétrico: ela não alcança a desativação de ORGANIZAÇÃO, que não passa por rota de usuário nenhuma.
  - *Restringir a poda da desativação às concessões de RAIZ, como a decisão diz.* Recusada: raiz não é a única forma de a autoridade sobreviver ao concedente, e a restrição fecharia o caso do administrador deixando aberto o do usuário comum, que é o mesmo buraco com outro sujeito. A poda alcança tudo o que a pessoa concedeu.
- **Consequências:**
  - **A resposta da rota tem TRÊS listas** (`revoked`, `reparented`, `trimmed`), aditivas: ler só a primeira continua correto, e a contagem dela passou a ser a verdadeira. O aviso ao vivo e o broadcast de sala usam só `revoked`, porque quem foi resgatado não perdeu nada e acordar a sala por ele é ruído.
  - **A trilha responde uma pergunta nova:** deixou de ser só "por que Fulano perdeu acesso" e passou a ser também "por que Fulano MANTEVE". Sem a linha, um acesso que sobrevive a uma revogação é indistinguível, no registro, de um acesso que a revogação nunca alcançou.
  - **Esta é a primeira escrita de `parent_grant_id` fora do INSERT**, e o argumento de aciclicidade que morava no código ("nenhuma rota expõe UPDATE dele") caiu com ela. O substituto está escrito nos dois lugares que importam: o pai novo é escolhido FORA do alcance da poda, e todo descendente vivo do nó re-pendurado está DENTRO dele. Quem escrever a terceira escrita daquela coluna precisa refazer a prova.
  - **Nasce um lock consultivo por (tipo, recurso)**, e a janela que ele fecha foi CRIADA por esta onda: duas revogações concorrentes podiam resgatar um nó para um pai que a outra está derrubando no snapshot dela, e como a resolução nunca olha o pai, esse filho continuaria ENTREGANDO acesso. Os locks são tomados ordenados e uma vez cada, antes de qualquer escrita, porque a exclusão de grupo e a desativação de conta podam raízes de recursos DIFERENTES na mesma transação.
  - **A disjunção dos três conjuntos escritos é a propriedade que sustenta o statement**, e o Postgres não a protege: duas CTEs modificadoras tocando a mesma linha não levantam erro, dão resultado imprevisível. A guarda é aritmética (exatamente uma linha de trilha por concessão tocada, somando as três listas), e o controle negativo (remover o `NOT EXISTS` do braço recursivo) foi executado.
  - **A expectativa da exclusão de grupo ganhou uma segunda metade:** o repasse que nasceu pendurado na concessão coletiva sobrevive repai-ado na pessoal, quando o membro tem `view_share` próprio vivo sobre o mesmo recurso. Os quatro casos anteriores daquele arquivo continuaram válidos sem edição, porque neles o repasse do membro com dupla autoridade já nascia na concessão pessoal.
  - **Os dois lados de D8(b) são distinguíveis pelo `revoked_at`**, e é assim que o teste os separa: desativar a OM ESCONDE sem revogar (e reativar devolve, que é o que `USER_REACTIVATE` promete); desativar a CONTA revoga, alcança descendente, dispara o repai, e não volta.
  - **Reativar uma conta não ressuscita o que ela concedeu.** Consequência aceita de olhos abertos: quem for desativar uma conta que concedeu muito deve reconceder antes.
  - **O aviso pré-clique do cliente superestima, por construção.** `fallenGrants` só consegue prever o resgate no eixo PESSOAL: a listagem não carrega a composição dos grupos nem o estado das contas. A direção do erro (avisar que N caem quando caem N-1) é a decisão, porque avisar a mais custa menos que avisar a menos, e o toast de sucesso corrige o número com a contagem verdadeira das três listas.
- **Status:** aceita e aplicada.

### 2026-08-21: a trilha ganha o eixo de OM, gravado na escrita, e a leitura deixa de ser só-admin

- **Contexto:** `audit_trail` respondia "o que aconteceu no sistema" só para o administrador global. Quem mantém o acervo de uma OM (o produtor, desde 2026-08-20 dono da visibilidade e da concessão de raiz do que produz) não tinha como investigar o próprio acervo, e a trilha não sabia dizer de que OM era o recurso alvo de cada linha.
- **Decisão 1: a OM do alvo é COLUNA, gravada pelo emissor, e ela é a OM DA ÉPOCA.** Quando um recurso troca de OM, a história antiga NÃO acompanha: a linha guarda quem respondia pelo recurso quando o ato aconteceu, do mesmo jeito que `target_name` guarda o nome de então.
- **Decisão 2: `GET /api/v1/audit` passa a ter dois ramos**, administrador (irrestrito) e produtor (recortado na própria OM), e o recorte é imposto no SERVIDOR, nunca lido da query string.
- **Alternativas rejeitadas:**
  - *Resolver a OM na LEITURA, por junta com `owner_org_id`.* Recusada por três razões independentes, e a segunda é decisiva. (a) Ela reatribui a história passada à OM ATUAL, isto é, muda retroativamente quem respondeu pelo ato, o produtor que mantinha o recurso perde de vista o que ele próprio fez. (b) O hard-delete de projeto 360 é o único do sistema e escreve a trilha DEPOIS do DELETE, na mesma transação: a junta devolveria nulo exatamente para o evento que mais importa auditar. (c) Custo: um UNION de cinco tabelas em toda listagem, com `target_id` TEXT casando ora slug ora UUID.
  - *Um gatilho no banco em vez do carimbo no emissor.* Recusada pela mesma razão (b): no instante do gatilho a linha do projeto ainda existe, mas ele resolveria a OM ATUAL, e não a da época, e para o `SV360_DELETE` nem isso, porque o alvo desaparece na mesma transação.
  - *Gatear a leitura por `fn_has_global_data_access`.* Recusada: aquele é o predicado do eixo de DADO e inclui o CREDENCIADO, que lê todo recurso privado e não administra nada. Ler acervo e ler o registro de atos sobre contas, atlas, configuração e permissões são poderes diferentes, e é a mesma confusão que a fase F9 já pagou uma vez em `requireGrantRevoker`.
  - *Deixar o produtor mandar `targetOrgId` e confiar nele.* Recusada por definição: seria transformar autorização em parâmetro do cliente. O campo existe e só ESTREITA, e só para quem administra.
  - *Não fazer backfill, deixando a história anterior sem OM.* Recusada com o custo declarado: o produtor abriria a tela nova e veria lista vazia, indistinguível de "nada aconteceu", a classe de defeito que o censo de auditoria existe para impedir. O backfill entra, atribui a história antiga à OM ATUAL do recurso (a única aproximação do desenho), e a TELA declara a ressalva ao usuário.
- **Consequências:**
  - **`target_org_id` nulo tem DOIS significados que o dado não distingue:** alvo sem OM dona (conta, atlas, configuração) e acervo INSTITUCIONAL. O filtro por OM não alcança nenhum dos dois, o que é o comportamento certo, entregá-los a todo produtor daria a cada OM a história das outras.
  - **Nasce um censo estrutural** (`backend/tests/unit/auditoria-om-do-alvo-censo.test.js`) com duas varreduras independentes, porque o modo de falha é o mais silencioso possível: um emissor que esqueça o carimbo produz linha com a coluna nula, e o produtor daquela OM simplesmente não vê o evento, sem erro em lugar nenhum.
  - **Três buracos do censo de auditoria fecharam no mesmo commit** (auto-edição de perfil, troca de senha pelo titular e o overlay de disponibilidade do atlas) e o TETO desceu de 7 para 4, porque um teto que fica no número antigo depois de os buracos caírem é folga para três lacunas novas. Os quatro que ficam exigem vocabulário novo no CHECK de `action`.
  - **A resposta passou a variar por chamador**, então ela marca escopo de cache. Sem isso um cache compartilhado pode repor a trilha do administrador para o produtor, e a isenção do RFC 9111 para `Authorization` não cobre a requisição autenticada por cookie.
  - **A tela nasce com o anti-dump como requisito, não como acabamento:** sete dias por padrão, agrupamento por dia, uma FRASE por linha e o `details` atrás de um botão. Ação sem tradução mostra o PRÓPRIO CÓDIGO, nunca "Desconhecido": um rótulo genérico esconderia a ação nova, e quem cobra a tradução lê o vocabulário da MIGRAÇÃO vigente, não do mapa que testa.
  - **O credenciado não recebe a aba**, pela mesma razão que o gate lhe dá 403. Oferecê-la seria a pior forma de dizer não.
  - **A liveness do gate repete uma checagem que o `auth` já faz**, e por HTTP os dois caminhos devolvem códigos diferentes (conta desativada dá 401, no `auth`; OM de lotação desativada dá 403, no gate). Medido, escrito no caso, e o middleware ganhou um teste que o chama SOZINHO, senão apagar os termos dele deixaria tudo verde.
  - **A liveness tem TRÊS termos, e o terceiro entrou na revisão** (2026-08-21, mesmo dia): conta, OM de LOTAÇÃO e OM PRODUTORA, espelhando `fn_can_produce_resource`, que ganhou o termo da produtora nesta mesma onda. Com só os dois primeiros, desativar a OM produtora tirava o direito de MANTER o acervo e deixava a LEITURA da trilha daquela OM aberta: um kill-switch que fecha a escrita e não a leitura. O termo carrega o disjunto `role = 'admin'`, sem o qual o administrador (que não tem OM produtora) seria derrubado pelo próprio predicado. O que impediu de ver antes foi a FIXTURE: ela usava a mesma OM como lotação e produção do produtor, então desativá-la derrubava os dois termos juntos e o 403 não dizia qual agira.
  - **Uma divergência prevista NÃO existe, e a medição está escrita para não ser "consertada":** administrador com lotação desativada perde `GET /audit` **e também** `GET /users`, porque a reconciliação ao vivo do `auth` barra membro de OM desativada antes de qualquer gate. O termo de lotação no gate é segunda linha de defesa, não uma regra que só ele aplica.
  - **O censo estrutural NÃO prende o VALOR do carimbo, e ele diz isso**, mas a declaração honesta não substitui o teste que ela aponta. Medido na revisão: anular `targetOrgId` nos três emissores de PERMISSION_* deixava a suíte inteira verde. `backend/tests/integration/auditoria-permissoes-tem-om.test.js` e o caso de `PERMISSION_PURGE` em `auditoria-sv360-delete-tem-om.test.js` fecham isso, com o ator escolhido de propósito SEM OM produtora, para que carimbar a OM de quem concede (em vez da do recurso) saia nulo e reprove.
  - **O backfill é exercitado contra dado plantado**, e não só compilado: as migrações rodam sempre em banco recém-criado, então o `UPDATE` alcançava zero linhas em toda rodada. (arquivo removido em 2026-08-22) extrai o statement DO ARQUIVO da migração e mede as duas formas de `target_id` (slug de catálogo e UUID de 360), as duas ausências deliberadas (alvo sem OM dona, recurso já destruído) e a idempotência. **Errata:** o arquivo saiu quando a migracao do backfill foi absorvida pela baseline `backend/src/database/migrations/002_auditoria.sql`. Num banco novo nao ha historia para retroagir, entao o backfill deixou de existir e a medicao dele perdeu o sujeito.
- **Status:** aceita e aplicada. Fora deste escopo, e explicitamente adiado: o vídeo de prévia e o de-para de valores em `details` (a segunda metade do mesmo lote).

---

### 2026-08-21: o `details` da trilha carrega um de-para SELETIVO, e o vídeo de prévia vale para quatro tipos

- **Contexto:** a segunda metade do lote de auditoria, explicitamente adiada na entrada acima. Duas coisas ficaram por fazer e são independentes uma da outra, exceto por compartilharem o módulo que nasce aqui.

  A primeira: `CATALOG_UPDATE` gravava só os NOMES dos campos tocados, por decisão escrita, com um motivo que continua válido: `config` carrega URL de serviço (às vezes com credencial na query string), `previewThumbnail` é um data URL de até 256 kB, a trilha é lida por qualquer administrador e por qualquer produtor da OM dona, e **a trilha não se edita**. Só que "Fulano alterou `config`" não distingue trocar a opacidade de apontar a camada para outro servidor, e não responde de jeito nenhum à pergunta mais frequente de uma investigação: *mudou e depois voltou ao que era?*

  A segunda: o vídeo de prévia existia só para `tileset`, e tinha UM leitor no produto inteiro (o popup do marcador 3D, que só abre com o modelo já carregado no mapa).

- **Decisão:**

  1. **De-para em TRÊS regimes, por lista fechada de caminhos** (`backend/src/utils/audit-diff.js`): VALOR literal para campos pequenos e não-endereçáveis; IMPRESSÃO (HMAC-SHA256 truncado em 12 hex, mais o tamanho em bytes) para tudo que é endereço ou mídia; NOME-SÓ para qualquer chave que ninguém classificou. O terceiro regime é o DEFAULT, e é exatamente a garantia antiga preservada como piso. Teto duro de 4 kB que degrada a linha INTEIRA para nome-só, marcando `truncado`.
  2. **O vídeo de prévia passa a valer para QUATRO tipos** (3D, camada de dados, camada de análise e projeto 360) e ganha superfície de leitura no mesmo commit: o botão "Prévia" do cartão do catálogo. O 360 recebe coluna (`sv360.projects.preview_video`) e rota própria, porque é a única das cinco tabelas sem `config` JSONB.

- **Alternativas rejeitadas:**
  - *Gravar o valor inteiro e confiar no gate de leitura da trilha*: a trilha não se edita e a população que a lê acabou de crescer (todo produtor de toda OM). Um segredo que entre ali entra para sempre, para um público que ninguém escolheu.
  - *Hash sem chave em vez de HMAC*: transformaria a trilha em oráculo de confirmação, porque quem a lê testa um palpite de URL contra o digest e confirma. Com chave de servidor, confirmar exige a chave.
  - *Env própria para a chave de impressão*: troca "nunca ausente" por "passo de implantação", e o modo de falha é silencioso: um deploy sem a variável sobe com chave vazia e toda impressão vira a impressão do vazio, sem erro em lugar nenhum. A chave é derivada do segredo de JWT com separação de domínio, que o boot já EXIGE.
  - *Substituir `details.fields` pelo de-para*: um teste vivo já lia aquele campo. O de-para é ADITIVO.
  - *Estender o vídeo aos CINCO tipos, incluindo o basemap*: era o default do plano, e foi recusado. O basemap é o único que não aparece como cartão de catálogo, porque a superfície dele é o seletor de camada base, uma lista compacta sem lugar para uma afordância de mídia. Campo de escrita sem superfície de leitura é afordância que mente. `config` é livre, então reabrir a categoria um dia não custa migração; o que custa é a superfície de leitura, e é ela que decide.
  - *Uma ação nova de trilha para a rota de metadado do 360*: `CATALOG_UPDATE` já é o vocabulário do catálogo, e o projeto 360 é um dos cinco tipos de recurso dele. Ação nova exigiria alargar o CHECK de `audit_trail.action`, o que arrasta DROP/ADD CONSTRAINT e uma linha em `EXCECOES_DESTRUTIVAS` para dizer a mesma coisa com outro nome.

- **Consequências:**
  - **A direção do erro na classificação é deliberada:** classificar de menos custa informação, classificar de mais custa um vazamento permanente. Por isso o default é nome-só e por isso um campo do regime VALOR **cai** para impressão quando o valor passa de 200 caracteres, porque "campo pequeno" é expectativa, não garantia (`description` é `Joi.string()` sem teto).
  - **A chave de impressão não pode sair em resposta nenhuma**, e nenhum endpoint pode aceitar um valor do chamador e devolver a impressão dele. Isso é guardado estruturalmente: um caso varre `src/` e exige que `auditFingerprintKey` seja citado em exatamente dois arquivos.
  - **O controle negativo do de-para procura a substring do segredo no JSON INTEIRO da linha de trilha**, não no campo onde se esperaria encontrá-la. Medido: apagar a filtragem por allowlist derruba os dois casos de trilha e deixa a borda e o alcance dos quatro tipos verdes.
  - **A comparação é por valor CANÔNICO** (chaves ordenadas em toda profundidade), e não por identidade de objeto nem por `JSON.stringify` cru: o painel reenvia o `config` inteiro a cada gravação, e sem isso toda gravação fabricaria um de-para de dez campos idênticos.
  - **O `UPDATE` do catálogo passou a trazer os valores anteriores no MESMO statement**, por um `FROM (SELECT … FOR UPDATE) antes`. O `FOR UPDATE` é a metade que importa: sem ele a subconsulta lê o snapshot do início do statement enquanto o UPDATE relê a linha, e em `READ COMMITTED` uma escrita concorrente faria o "de" divergir do que foi sobrescrito. Uma revisão do plano tinha apontado exatamente isso, com a prosa afirmando que a janela estava fechada quando não estava.
  - **Os dois lados do de-para saem da MESMA projeção** (`CAMPOS_EDITAVEIS`, `backend/src/modules/catalog/catalog.service.js`), e essa linha existe por um defeito real desta onda: o lado "antes" vinha da subconsulta (quatro colunas) e o lado "depois" era a linha inteira do `RETURNING` (oito), então `id`, `active`, `created_at` e `updated_at` entravam como campo mudado em toda edição. O guarda que o pegou é a asserção ABSOLUTA sobre `outros` (`deepEqual([])`); as versões com `toContain` passavam verdes com o balde cheio.
  - **A rota nova do 360 nasce com um campo só, e isso é a decisão e não a limitação:** alargá-la sem revisar o gate a transforma na rota genérica de edição de projeto, que não existe: `slug`, `organization_id` e `db_filename` são derivados no servidor, e é isso que impede um manifesto de apontar para o store de outra OM.
  - **Buraco declarado:** o `preview_video` de um projeto 360 PRIVADO fica fora do índice de regime de `assets3d` (`backend/src/modules/nomes/assets3d-regime.js`), que cobre só as quatro tabelas de catálogo. O vídeo de um 3D, de uma camada de dados ou de uma camada de análise privada é gateado por ali; o do 360 não. Nenhum dos dois é gateado quando o deploy serve o prefixo `/3d/` por nginx, que é o buraco maior e mais antigo, já declarado naquele arquivo.

- **REVISÃO ADVERSARIAL (mesmo dia, duas lentes), e o que ela mudou no desenho:**
  - **O `<video src>` da prévia passou a carregar o carimbo de escopo do atlas** (`enderecoDaPrevia`, `frontend/src/js/catalog/components/preview-video.modal.js`). Sem ele a decisão 2 se contradizia no caso que as ondas 4a/4b inteiras endereçam: um recurso PRIVADO alcançado por empréstimo ganhava o botão "Prévia" e respondia 404, porque requisição que o navegador faz sozinho não carrega `Authorization` e o `?atlasId=` é a única autorização que atravessa um `<video>`. Junto, o cartão da cena indoor deixou de mandar o override CRU para a tela: o gate continua sendo a chave explícita, mas o VALOR passa por `resolveSceneAssets`, como o popup do marcador 3D sempre fez.
  - **A recusa de `data:` virou `/^(?!\s*data:)/i` com `.trim()`, nos dois schemas.** Medido contra o Joi real: `DATA:` e ` data:` passavam, e as duas formas viram data URL de verdade num `<video src>`. A justificativa escrita também estava errada, falando num data URL de dez megabytes que o `max(2048)` já barrava com ou sem a regra.
  - **O Escape da prévia saiu em fase de CAPTURA.** `ModalBase` registra o dele no mesmo `document` e antes, então uma tecla fechava o catálogo inteiro por baixo.
  - **`details.fields` deixa de ser desenhado na gaveta QUANDO há de-para**, porque ali ele é o mesmo conjunto dito duas vezes. Numa linha antiga, sem de-para, ele continua sendo a única informação de campo que existe, e sobrevive.
  - **Quatro guardas foram trocados por guardas que discriminam**, e os quatro passavam verde sob mutação medida: um `it` que era só `assert.ok(true)`; o caso de rótulos, cujo predicado era tautológico por causa do fallback de `rotuloDeCampo`; a ausência de teste negativo na rota `PATCH /admin/projects/:slug`; e a coluna nova em `LIST_PROJECTS`, que é a consulta que monta o cartão do 360 e não tinha nenhuma asserção (o teste exercitava só o `GET` por slug).
  - **Não mudou:** o comprimento em bytes continua na entrada de impressão, agora declarado por extenso como o único metadado que o regime 2 divulga.

- **Status:** aceita e aplicada, com a revisão adversarial acima incorporada. Fecha o lote de auditoria por OM.
### 2026-08-20: a panorâmica 360 passa a ser servida em pirâmide de tiles, e o manifesto de ingestão deixa de exigir tamanho de blob

- **Contexto:** o `ebgeo_360` rodou `aposentar-full.js` sobre 29 projetos e APAGOU as colunas `full_webp` e `preview_webp` dos bancos de imagem, liberando 64,6 GB; o que sobrou de pixel são 120,7 GB de pirâmide de tiles. A tabela `images` continua existindo, só com `photo_id`, e a rota de imagem daquele lado responde 404 de propósito. Isso atinge os dois consumidores de formas diferentes, e a diferença é a razão de esta decisão existir: o `ebgeo_web` da linha `main` é um MONOLITO que fala com o serviço do `ebgeo_360` direto, então bastou portar o cliente (cinco commits, fechados no merge `31eedcd1`); este branch INTERNALIZOU o 360 dentro de `backend/` (schema `sv360`, bundle importado por upload), então o cliente sozinho seria ramo morto: `tentarTiles` responderia 404 sempre. Pior: o `validateImagesDb` do ingest daqui casava byte a byte com `full_size_bytes`/`preview_size_bytes`, e `manifestSchema` os declarava `.required()`, então **todo acervo novo era recusado na borda Joi**, antes de qualquer leitura de arquivo.
- **Decisão:** o backend passa a servir a pirâmide, e a exigência de pixel na ingestão é TROCADA em vez de afrouxada. Em concreto: migração `012_sv360_piramide.sql` cria `sv360.photo_pyramids` (só metadado); os bytes ficam em `{orgId}__{slug}_tiles.db`, um SEGUNDO arquivo SQLite por projeto, lido pelo mesmo `blobPool`; nascem `GET /photos/:uuid/tiles.json` e `GET /photos/:uuid/tiles/:level/:x/:y`, com o MESMO `sv360AccessPredicate` da imagem; `full_size_bytes`/`preview_size_bytes` viram opcionais com default 0; e `validateImagesDb`, ao ver `images` sem as colunas de blob, exige o arquivo de tiles com pirâmide cobrindo TODA FOTO VIVA do manifesto.
- **Alternativas rejeitadas:**
  - *Guardar os bytes do tile no Postgres*, junto do metadado, unificando o armazenamento. Recusada por tamanho e por coerência: são 120,7 GB nos 29 projetos, contra os 64,7 GB de imagem que saíram, e o cabeçalho da baseline `007_sv360.sql` já declara a fronteira ("binários WebP vivem em SQLite por projeto, NÃO aqui"). Trocar essa fronteira seria uma decisão própria, com custo próprio.
  - *Apenas afrouxar `validateImagesDb`, aceitando `images` sem blob e seguindo em frente.* Recusada porque abre a porta para um projeto entrar sem NENHUMA fonte de pixel, e a falha aparece longe da causa, como a única panorâmica que nunca pinta. A origem já tinha resolvido isso do lado dela (o script que apagou os blobs PULA quem não tem pirâmide completa, conferida por foto viva), e a mesma conferência atravessou para cá.
  - *Conferir a pirâmide por "o arquivo `{slug}_tiles.db` existe".* Recusada pelo mesmo motivo, na forma barata: deixaria entrar projeto com metade das fotos cobertas, e nada ficaria vermelho.
  - *Recalcular a escada pela regra de parada do código, em vez de gravar `max_level` e `razao`.* Recusada com número: na origem, mudar a regra de parada reinterpretou em silêncio **98.854 das 99.035 fotos** já escritas. Dado gravado manda em descritor calculado, e o sintoma da divergência é tile faltando, nunca um erro.
  - *Validar o token de geração (`?v=`) que o descritor publica na URL do tile.* Recusada porque pintaria buraco na tela: no instante da regeração o cliente ainda segura o descritor anterior, e recusar os pedidos em voo troca uma imagem levemente desatualizada por uma imagem furada.
  - *Chamar o módulo novo de `sv360.tiles.queries.js`, por simetria de nome.* Recusada: esse nome JÁ significa outra coisa neste módulo (o MVT da camada de pontos do mapa 2D, em `/tiles/{z}/{x}/{y}.pbf`). Duas coisas com o mesmo nome no mesmo módulo é o defeito que este repositório já pagou em `streetview_markers`. O arquivo novo é `sv360.pyramid.queries.js`, e os dois cabeçalhos dizem qual "tile" cada um significa.
- **Consequências:**
  - **`manifestSchema` é contrato congelado e mudou de forma.** Um manifesto sem os dois campos passa a ser válido, e `0` significa "esta foto não tem blob", nunca "não conferimos". Quem ler esses campos como prova de que o pixel existe está lendo errado desde esta data.
  - **O acervo ficou MISTO, e o fallback não é transitório.** Vinte e nove projetos são só-tiles e o Estádio Serra Dourada continua só-full. Quem ler "o acervo passou a ser só tiles" e podar o ramo do WebP inteiro quebra o Serra Dourada; o caminho antigo tem caso de teste próprio exatamente para isso.
  - **A mesma conta da escada passa a existir nos DOIS pacotes** (`backend/src/modules/streetview360/sv360.escada.js` e `frontend/src/js/street_view_tool/pyramid-math.js`), pela mesma razão que os dois projetores do 360/calibração: os pacotes são independentes. O guarda é `backend/tests/unit/escada-espelha-o-cliente.test.js`, e ele leva asserção ABSOLUTA junto da comparação, porque comparar as duas cópias entre si passaria feliz se as duas estivessem erradas do mesmo jeito.
  - **Duas superfícies de recurso novas**, e o censo dos dois pacotes reprovou até que fossem classificadas com predicado, gate e regime de cache. A contagem coletiva de rotas de leitura do 360 subiu de 15 para 17.
  - **Os regimes de cache do módulo deixam de ser uniformes:** o tile é `immutable` (escada gravada não muda de conteúdo), o descritor é `no-cache` com validador (a escada se regera). Quem copiar `setImmutableHeaders` para o descritor prega a escada velha no navegador por um ano.
  - **O que NÃO foi feito, e é dívida nomeada:** o ETL offline (`backend/scripts/sv360-import.js`) ainda confere tamanho de arquivo contra a soma de `full_size_bytes + preview_size_bytes` do manifesto, então uma importação em lote de acervo podado pode reportar sucesso com os projetos em `skipped[]`. O caminho de UPLOAD está correto; o de linha de comando não foi tocado nesta rodada.
  - **ERRATA (2026-08-21): a dívida foi paga, e ela era MAIOR do que este parágrafo diz.** O ETL também nunca copiava o `{slug}_tiles.db`, então trocar só a guarda instalaria projeto sem fonte de pixel nenhuma. O sintoma descrito aqui também está errado no adjetivo: o CLI não reporta sucesso, ele imprime cada `SKIPPED` em stderr e sai com código 2. Silenciosa é a chamada PROGRAMÁTICA, que resolve com `imported: []`. Ver a entrada de 2026-08-21 adiante.
- **Status:** aceita, com o último bloco superado pela entrada de 2026-08-21.


### 2026-08-21: as pendências da integração main/360 são pagas, e o inventário que as listava é APAGADO

- **Contexto:** o branch `integracao_main_360` carregava na raiz o PENDENCIAS-INTEGRACAO-MAIN-360.md (sem crase de propósito, porque o arquivo não existe mais e crase promete caminho que resolve), dez blocos escritos em 2026-08-20 por um fan-out de 39 agentes. Uma verificação de 2026-08-21, oito frentes lendo o código em vez da prosa, separou as duas metades do documento. O MAPA estava certo: percorridos um a um, os 44 commits de `origin/main` ausentes deste branch dão 34 portados, 5 parciais e 5 não-aplicáveis, e **zero ausentes**; o censo de 33 commits do `ebgeo_360` desde 2026-08-01 não achou nada fora dos dez blocos. O ORÇAMENTO estava errado em **6 dos 10 blocos**, e em duas direções. Para menos: o bloco 1 dava a calibração como 5 arquivos com 2 ausentes, e `pyramid-math.js` e `tile-loader.js` já existiam sob `frontend/src/js/street_view_tool/` desde `2e99102d`, a 1 e a 55 linhas da origem, o que derrubou o porte de cerca de 2445 para 686 linhas em 3 arquivos. Para mais: o bloco 2 pedia trocar a guarda do ETL, e o ETL **nunca copiou o `{slug}_tiles.db`**, então só trocar a guarda instalaria projeto sem fonte de pixel nenhuma. O documento também errava a contagem de si mesmo (diz 11 commits, são 12) e omitia dois defeitos: o `test.fail()` de E3 em `browser-save-local-to-server.spec.js`, e a ausência de `transformRequest`, que em deploy cross-origin faz o usuário logado ver só os 360 públicos na camada 2D.
- **Decisão:** pagar em código tudo o que era código, registrar AQUI o que não é, e **apagar o documento**. Apagar, e não marcar como resolvido, porque nota de pendência descreve o mundo do dia em que foi escrita: o `docs/livro-razao.md` desta casa já registra o caso em que conferir a doc contra o arquivo de pendências da fase CONFIRMOU uma frase falsa com ar de verificação. O guarda `docs-integridade` perde a entrada correspondente na mesma passada.
- **O que foi pago, com o número de cada um:**
  - **ETL (bloco 2).** `sv360-import.js` passou a reusar `validateImagesDb` do ingest em vez de somar `full_size_bytes + preview_size_bytes`, e a transferir o `{slug}_tiles.db` junto. Acervo com blob mantém o piso de bytes; acervo só-tiles exige pirâmide cobrindo toda foto viva. `imported[]` ganhou `tiles:boolean`. O caso que reprova o afrouxamento (pirâmide incompleta continua em `skipped[]`) está preso em teste.
  - **Calibração (bloco 1).** Os três arquivos compõem por tiles reusando o carregador do `street_view_tool` por import. A cadeia nova é `tile-loader.js` mais `three` do vendor, `config.js` e `pyramid-math.js`, os dois últimos folha: `@store` e o barrel `@utils` não entraram, como a regra de página sem mapa exige.
  - **Piso do `vite` (bloco 3a).** `^8.0.0` subiu para `^8.1.2` e `^8.1.0`, com o lock sincronizado em 2 linhas.
  - **Lockfile da raiz (bloco 3b).** Gerado. Os três pacotes reais passam a ter lock, e a prosa dos `.gitignore` deixou de mentir.
  - **Instável do CRDT (bloco 4).** `browser-collab-crdt-conflict.spec.js` deixou de congelar o alvo numa leitura única e passou a reler o servidor dentro do poll, como os casos irmãos já faziam. A asserção absoluta contra o par em disputa ficou, para o poll não degenerar em tautologia.
  - **A2b (bloco 5).** O `test.fail()` saiu, e a remocao esta PROVADA no navegador. A causa nao era a registrada na spec: o atalho de `claimRemoteAtlas` confiava numa chave herdada do boot, e passou a exigir arbitragem ganha.
  - **E3 (bloco 5): a marca velha era insatisfazivel, a nova REPROVA, e o defeito CONTINUA ABERTO.** A marca original media `featureId` no banco local e respondia igual antes e depois do conserto, entao escondia o conserto em vez do defeito. Reescrita para medir a edicao feita com a aba JA VIVA no atlas de servidor, ela reprovou no navegador: essa edicao aparece TAMBEM em `ebgeo_maps` local. Duas execucoes de duas em que o gate avaliou, com backend, banco e portas isolados. A metade de E3 que ENTROU e real (os bancos `ebgeo_*__remote-<atlasId>` existem e o controle positivo passa); a que falta e a escrita ao vivo alcancando o escopo local depois da ativacao. O `test.fail()` foi RESTAURADO, com a medida e a pista escritas na spec.
  - **Guarda de basemap (bloco 6).** Passou a comparar os ids servidos por `buildBasemapStyles` contra os módulos estáticos, e a lista antiga, KNOWN_DUPLICATES (sem crase: o nome foi trocado e não existe mais no código), virou `ACCEPTED_DUPLICATES`: par novo reprova, par já pago passa.
  - **Miniatura (bloco 7a).** `previewThumbnail` só é emitido quando o arquivo existe, e a checagem roda sobre linha que o `sv360AccessPredicate` já entregou.
  - **Guarda da escada (bloco 8).** O trecho de grade tinha TRÊS cópias idênticas, não duas, e a desprotegida era a de `montarEscada`. Virou função única em `pyramid-math.js`. O guarda ganhou `gradeDoNivel` por asserção absoluta.
  - **Empréstimo por atlas nos tiles (não estava no documento).** A entrada de 2026-08-18 diz que o empréstimo alcança o 360, a rota aceita `atlasId`, e o cliente nunca o carimbava: projeto emprestado não aparecia na camada 2D, em deploy nenhum. O cliente passa a carimbar, e a troca de atlas DEMOLE a fonte.
- **Alternativas rejeitadas, uma por frente:**
  - *Dar par a `gradeDoNivel` no frontend, por simetria com `escadaGravada`.* Recusada: o cliente não consome esse predicado (ele lê `cols`/`rows` da escada que já monta), então o par seria uma QUARTA cópia sem consumidor, que derivaria sozinha e que nenhum código de produção reprovaria. É o mesmo erro de classe que a frente estava consertando.
  - *`credentials: 'include'` para autenticar o tile cross-origin.* Recusada com o código na mão: o cookie de sessão sai com `sameSite: 'strict'` (`backend/src/utils/environment.js:35`), e o navegador o retém em requisição cross-site independentemente do que o `fetch` peça. O único deploy que precisa do conserto é exatamente o que o `strict` bloqueia. Ficou Bearer, pelo mesmo `apiClient` que o Cesium já usa no 3D.
  - *Carimbar o `atlasId` no `transformRequest`, por ser um lugar só.* Recusada por medição no bundle vendorizado do MapLibre: os dois caches de tile respondem por `OverscaledTileID.key` (z/x/y/wrap), e a URL transformada não entra em chave nenhuma. Tile buscado sob um atlas seria devolvido sob outro sem pedido, que é o vazamento entre escopos recusado na entrada de 2026-08-18 ao mover o `ETag` para o hash do CORPO.
  - *Trocar a fonte com `setTiles()`.* Recusada pela mesma medição: `setSourceProperty` da fonte VETORIAL chama `load()` sem argumento, o worker cai no ramo de recarga (reloadTile e tileState.getLoaded, sem crase: são símbolos do bundle vendorizado do MapLibre, fora da árvore que este guarda varre) e nunca toca a rede. Trocaria o texto da URL servindo os bytes do atlas anterior. Só `removeSource` derruba o `TileManager` com os dois caches.
  - *Expor uma coluna `hasThumbnail` na listagem.* Recusada: hoje "não existe", "é privado e você não alcança" e "existe sem arquivo" colapsam no MESMO 404, e essa indistinguibilidade é propriedade de segurança. A checagem foi para DEPOIS do gate em vez de virar campo.
  - *Portar o documento TileJSON do `ebgeo_360` (bloco 7b).* Recusada, e o bloco fechado sem código: os commits `fa26146`, `1e66e22` e `d0adc31` do lado B convergem para "o EBGEO NAO LE ESTE DOCUMENTO", e `d0adc31` nomeia o limite (a dedução da base não alcança PREFIXO de proxy). Este branch já está no destino para onde a origem caminhava, porque declara `tiles[]` direto na fonte do MapLibre. Portar seria andar para trás.
  - *Confirmar consequência do teto de 16383 px do WebP (bloco 9).* Fechado sem código, por razão estrutural: este pacote não tem `sharp` nem `generate-tiles.js`, não codifica WebP nenhum. O `LIMITE_CANVAS` daqui é 16384 e GRAMPEIA em vez de rejeitar, e o teto que morde na prática é 4096 em máquina fraca. O risco residual é de razão de aspecto, não de dimensão: 16383 por 8192 não é 2:1, e a matemática de UV do visualizador assume 2:1.
  - *Manter a lista de duplicatas como igualdade exigida.* Recusada: a forma antiga, um `toEqual` contra a lista fechada, deixaria o guarda VERMELHO no dia em que alguém pagasse a dívida, e regressão e conserto ficariam com o mesmo sinal.
- **As três lições do instrumento, que valem mais que os consertos:**
  - **Marca de defeito pode ser insatisfazível, e aí o `test.fail()` esconde o CONSERTO em vez do defeito.** O gate de E3 media `featureId` no banco local, e a resposta é a MESMA antes e depois do conserto: antes porque o wipe esvaziava o slot local e o pull reescrevia tudo dentro dele; depois porque o slot local nunca é esvaziado (metade declarada de E3) e o upload preserva os ids. Quem escrever `test.fail()` deve medir algo que MUDE de valor quando o defeito fechar. **E a licao tem uma segunda metade, paga no mesmo dia:** trocada a marca, foi facil demais concluir que o defeito tinha fechado, porque a ativacao de namespace realmente entrou em `c27cc930`. Leitura de codigo, teste unitario e suites vizinhas concordaram, e o NAVEGADOR discordou. Marcador de defeito de interface so sai depois de o spec dele rodar, nunca por raciocinio sobre o codigo. Rodar a suite inteira nao era necessario: bastou o spec do proprio marcador.
  - **A causa registrada numa suspeita envelhece igual a qualquer outra prosa.** A spec do A2b apontava o replay do open adiado rodando "sem a aba ter recuperado a claim". O thunk replayado começa por `claimRemoteAtlas`. A causa real era o ATALHO daquela função: a chave que ele confiava vinha de `resolveTabMountOrigin`, que cai no marcador de origem da INSTALAÇÃO quando a aba não tem ponteiro próprio, então uma aba nova bootava anunciando o atlas da irmã e o atalho lia isso como direito adquirido, pulando settle, ordem total e testemunha de uma vez.
  - **Nem todo erro fica vermelho: alguns PENDURAM.** No controle negativo do guarda da escada, trocar `Math.ceil` por `Math.floor` em `cols` perde a última coluna parcial, e `tilesVisiveis` calcula `fim - px = 0` com o `while (restante > 0)` nunca terminando. O sinal não é falha, é a suíte travada, e quem depurar isso sem o aviso perde a tarde.
- **O que NÃO foi feito, e é dívida nomeada:**
  - **A cena `museu-1cgeo` continua fora**, porque o ativo de 28,6 MB não está em disco em clone nenhum. O cadastro em si é barato e NÃO precisa da aba Catálogo do Admin: `npm run models3d:importar-cena -- --base-path <caminho>` faz o mesmo trabalho e ainda registra a produção (o roteiro citado aqui, `fp:register`, foi aposentado em 2026-08-23). Os bytes têm de estar no disco ANTES, senão o pino aparece e o clique dá 404.
  - **A suíte `e2e-ui` não tira screenshot de nada**, e nenhum spec dela menciona primeira pessoa. O laço aprovado desta casa (captura Playwright seguida de LEITURA da imagem) não tem infraestrutura nesta pasta, então destravar a verificação visual é construí-la, não só cadastrar a cena.
  - **O porte da calibração não tem teste que o cubra.** `calibracao-espelha-marcador-andar.test.js` passa com 15 casos, mas nenhum toca tile nem pirâmide. A prova pendente é abrir o estúdio e ver o nível subir com o zoom.
  - **As chamadas `fetch()` do módulo do 360** (`fetchProjects`, `fetchPhotoMetadata`, `fetchNearestPhoto`, `fetchProjectFloors`, `validatePhoto`) são `fetch(url)` puro, sem header e sem `credentials`. Em deploy cross-origin elas degradam para anônimo pelo mesmo motivo do worker, e o conserto da camada 2D não as cobre.
  - **`CORS_ORIGIN` do host do 360** precisa listar a origem do frontend num deploy cross-origin, porque o header `Authorization` torna a requisição pré-voada. Se não listar, o tile para de carregar de vez, que é falha barulhenta e não silenciosa.
  - **O `frontend/package-lock.json` tem drift latente** contra o npm 11.6.2: um `npm install --package-lock-only` ali traz 45 linhas junto (`"peer": true` novos e a remoção dos blocos hoisted `@emnapi/core` e `@emnapi/runtime`) e o par resultante FALHA no `npm ci` com `Missing: @emnapi/core@1.11.3 from lock file`. Por isso o piso do `vite` foi sincronizado à mão, nas duas linhas que o próprio npm escreveu no teste de controle. Consertar de verdade pede um `npm install` completo.
  - **A cobertura de pirâmide do ETL confere contra toda linha de `photos`** do `index.db`, e a origem pode manter linha para foto com tumba em `deleted_photos`. Se o acervo real tiver esse caso, o filtro por tumba entra no `buildManifest`. Seguiu-se a semântica do caminho de upload em vez de inventar uma diferença.
  - **`ATLAS_SETTINGS_CHANGED` com `reason: 'atlas_resources'`** (concessão alterada DENTRO do mesmo atlas) não redesenha os tiles do 360, e a camada de marcadores, que é GeoJSON de `fetchProjects()`, também não recarrega na troca de atlas. As duas são obsolescência de frescor, não vazamento de escopo.
  - **`@manycore/aholo-viewer` vendoriza `semver` e `fflate` sem declará-las, e agora isso está MEDIDO.** O inventário apagado dizia isso sem prova, porque quem o escreveu não tinha `node_modules` instalado. Com o pacote em disco: `package.json` do `@manycore/aholo-viewer` declara `dependencies: {}`, e o `dist/index.js.map` tem **47 fontes** vindas de `semver@7.8.5` e de `fflate`, do store pnpm de um pacote externo (`egs-core`). Consequência: um CVE em qualquer das duas deixa o `npm audit` VERDE com o código vulnerável embarcado, e o `npm ls` não mostra nada. Sem guarda hoje. O caminho barato seria um teste que leia esse sourcemap e cobre a lista de pacotes vendorizados, para que a entrada de um terceiro apareça.
  - **As 12 vulnerabilidades do Dependabot são reais e são do branch PADRÃO.** O `git push` de 2026-08-21 devolveu `GitHub found 12 vulnerabilities on 1cgeo/ebgeo_web's default branch (9 high, 3 moderate)`. Não se conferem por aqui: não existe um .github/dependabot.yml na árvore (sem crase: o caminho não resolve, e é esse o ponto), e o número vive no painel do GitHub.
  - **O repositório não tem `.github/` nenhum.** `origin/main` tem um workflows/deploy.yml (sem crase, porque o caminho não resolve nesta árvore); aqui e no `integracao_backend` não existe. A perda não é deste branch, é da internalização em monorepo, e sem `dependabot.yml` a contagem de vulnerabilidades do bloco 10 não se confere localmente.
- **Status:** aceita. Supera o último bloco da entrada de 2026-08-20, que nomeava o ETL como dívida.

### 2026-08-21: as pendências da constituição são pagas, o inventário que as listava é APAGADO, e o estado das cláusulas ganha guarda

- **Contexto:** o PENDENCIAS.md (sem crase de proposito, porque o arquivo nao existe mais e crase promete caminho que resolve), escrito na raiz ao fim da sessão que transformou a constituição em código, listava dez blocos ordenados por risco. A verificação de hoje (nove investigações em paralelo, lendo o código e não a prosa) separou as metades daquele documento, e o saldo repete o padrão da entrada de 2026-08-21 sobre a integração main/360: o MAPA estava quase todo certo, e um dos dez blocos era **premissa falsa**.

- **O item que não existia.** O bloco 7 dizia que o harness de e2e "degrada para `skip`", um verde sem verificação esperando acontecer. O guarda existe desde sempre: `frontend/tests/e2e/_backend-required.e2e.test.js` é o único spec da camada SEM `skipIf`, e reprova exatamente nessa condição, com par no Playwright. Pior: **a mesma premissa já fora inventada e revertida em 2026-08-14**, e está no livro-razão como `premissa-inventada`. A causa não era o agente, era a prosa do `CLAUDE.md`, que mandava "conferir a contagem de skips" numa frase escrita ANTES do guarda e mantida depois. Ela foi reescrita, e os dois guardas ganharam meta-guarda (`frontend/tests/unit/guarda-de-e2e-nao-pula.test.js`), porque guarda sem meta-guarda é guarda cuja ausência não deixa rastro.

- **O achado maior estava FORA da lista.** A `CONSTITUICAO.md` não estava sob `docs-integridade` (mora na raiz, e a varredura cobre `docs/` e `.claude/` mais uma lista escrita à mão), e o commit das cinco ondas virou o estado de UMA cláusula. Quatro auditorias por seção mediram as 55 contra o código: **23 diziam `[em obra]` sobre trabalho entregue, doze com uma frase "Hoje..." afirmando o oposto do código.** Numa especificação, negação absoluta e falsa não é ruído, é instrução. As 23 foram corrigidas, e o documento ganhou duas amarras, das quais só a segunda tem dentes: o arquivo entrou em `ALVOS`, e **toda cláusula vigente passou a citar entre crases o teste que a prende** (48 citações), de modo que apagar ou renomear esse teste fica vermelho apontando para a cláusula. Mais o censo das não-vigentes, com motivo por entrada, em `frontend/tests/unit/constituicao-estado-das-clausulas.test.js`. Saldo: 24 cláusulas abertas viraram 3.

- **As quatro decisões do dono, tomadas hoje:**
  - **O REBAIXAMENTO passa a derrubar o que a pessoa concedeu**, e pela forma SIMPLES: poda-se toda concessão de raiz de quem perdeu papel global de dado ou escopo de produção, sem coluna nova que registre sob qual autoridade cada raiz nasceu. A alternativa (migração aditiva) foi recusada com o argumento de que ela deixaria todo o passado como desconhecido, e portanto não podado, que é a metade que mais importa. Aceita-se derrubar também o que a pessoa poderia manter pelo papel que sobrou: numa revogação, a direção certa de falha é a fechada.
  - **A conta pendente continua cativando o par (nome de usuário, e-mail)**, e isso deixa de ser pendência para virar limite escrito, na cláusula 10.6. O desbloqueio é ato de administrador. Registrada a assimetria que surpreende: o token de verificação caduca em 48 h e a conta que ele ativaria não caduca nunca.
  - **A divergência do grupo converge para MANTER.** O membro com autoridade própria sobre o mesmo recurso mantinha o repasse ao apagar o grupo e perdia ao ser retirado dele, porque em `removeMember` os repasses do membro são as ÂNCORAS da poda e âncora nunca é resgatada. A convergência não removeu aquela regra, que existe para a revogação DELIBERADA: os chamadores passaram a se separar em dois grupos por `resgatarRaiz`, e sair de um grupo é remoção de CAMINHO, não revogação.
  - **As cinco famílias de tela nunca fotografadas vão ao Playwright**, em vez de continuarem registradas como lacuna conhecida. Esta é a ÚNICA das quatro que ainda não foi executada quando esta entrada foi escrita, e está dita aqui em vez de num inventário justamente porque inventário é o que apodrece: são o 360 ingerido, o fluxo de "Salvar como local" inteiro, o risco 5.3 nos dois espelhos (o rebaixamento aparente que some no F5), a gaveta de Auditoria com o de-para, e a prévia de recurso emprestado. A lógica das cinco está coberta; o que falta é a única camada que exercita a UI. **Remedido em 2026-08-23, e continua por fazer:** nos 118 specs de `frontend/tests/e2e-ui/` não há nenhum de auditoria, de prévia de recurso emprestado nem de empréstimo, e o de salvar-como-local segue sendo o caminho inverso. Decisão do dono, ainda **PENDENTE**: esta linha não descreve trabalho agendado, descreve trabalho parado. Medido hoje: `frontend/tests/e2e-ui/` não tem nenhum spec de auditoria nem de empréstimo, e o de salvar-como-local que existe é o caminho INVERSO.

- **Dois defeitos reais fechados de passagem, os dois com controle negativo executado:** o teto de profundidade 32 da poda era fail-OPEN (a consulta agora devolve a `fronteira` e `podarPorRaizes` a reenfileira até esvaziar); e o caminho de SYNC não tinha guarda de referência privada para 3D, 360, slide e mapa base (`resource-ref.extractors.js`, uma entrada por superfície, com censo próprio).

- **Status:** aceita. O inventário é APAGADO pela mesma razão registrada na entrada de 2026-08-21 sobre a integração main/360: documento de trabalho pendente é o que mais depressa perde sincronia, porque descreve o que ainda vai mudar, e conferir código contra ele confirma frase falsa com ar de verificação. O que continua aberto vive onde é verificado: as três cláusulas do censo da constituição, e `docs/wiki/tile-privado.md`, que segue parado por decisão do dono.
---

### 2026-08-22: as três migrações posteriores ao esmagamento voltam para dentro das baselines, e o comentário encolhe um sexto

- **Contexto:** a consolidação de 2026-08-19 deixou oito baselines por domínio, e três migrações forward-only nasceram em cima delas: `009_grupos_de_acesso.sql` (alarga dois CHECK de `audit_trail`), `010_forma_3d.sql` (backfill de `tilesets.config`) e `011_sv360_piramide.sql` (cria `sv360.photo_pyramids`). As três eram desbalanceadas (25, 15 e 26 linhas de SQL contra 71%, 73% e 60% de comentário) e existiam por uma regra que não se aplica a este produto hoje: forward-only vale porque um banco que já aplicou um degrau não o roda de novo, e **não há banco em produção**. Somando tudo, as migrações tinham 2332 linhas, metade comentário, com prosa que recontava a história de como o schema chegou até ali.
- **Decisão:** dobrar as três nas baselines e enxugar o comentário de todas. Os dois CHECK de `audit_trail` nascem largos na 002; a `photo_pyramids` nasce na 007; o backfill da 010 **desaparece** em vez de migrar, porque a 005 não semeia `tilesets` e o UPDATE não teria linha para tocar num banco novo. Resultado: 8 arquivos, 1939 linhas.
- **Alternativas rejeitadas:**
  - *Só enxugar o comentário, mantendo os 11 arquivos.* Risco zero no schema, mas deixaria de pé a assimetria que motivou o pedido: três arquivos que são quase só prosa, e que só existem porque um dia foram degraus.
  - *Um arquivo único com o schema inteiro.* Some a divisão por domínio, que é o que hoje permite ler uma área sem ler as outras.
  - *Manter o backfill da 010 dentro da 005.* Recusada por ser código que nunca roda: a tabela nasce vazia por decisão registrada, então o UPDATE seria uma linha permanentemente sem efeito, do tipo que o leitor seguinte tenta entender.
- **Consequências:**
  - **A equivalência foi PROVADA, não presumida.** Dois bancos foram montados (as migrações antes e depois) e comparados por um dumper de catálogo que separa estrutura de prosa, que é a lição do esmagamento anterior, em que `pg_get_functiondef` misturou as duas e produziu dois falsos positivos. Resultado: 43 tabelas, 404 colunas, 148 constraints, 145 índices, 13 funções, 6 triggers, 2 sequências, IDÊNTICOS. O comparador foi provado antes com três estragos plantados (coluna removida, CHECK alterado, índice a mais), e acusou os três.
  - **Dois guardas perderam o sujeito e foram reescritos, não afrouxados.** A lista `EXCECOES_DESTRUTIVAS` esvaziou por construção (não há mais `DROP` nenhum). E o censo de auditoria exigia o CHECK declarado em MAIS DE UMA migração para exercitar "a última vence": esse piso premiava quem reintroduzisse um degrau, então a regra passou a ser exercitada contra uma fixture SINTÉTICA, e o repositório real só responde "a declaração vigente existe e está no disco".
  - **Um caso do censo de forma 3D mudou de sujeito.** Ele lia o SQL do backfill para pinar "não se adivinha nuvem de pontos"; agora mede `derivarForma3d`, que é o código vivo, com as entradas que uma heurística tentaria capturar.
  - **Banco pré-consolidação continua inalcançável por upgrade.** A guarda no topo da 001 detectava os nomes antigos e explicava o conserto; ela foi REMOVIDA em 2026-08-23, a pedido do dono, junto com a sonda dela. O que resta é o `relation already exists` do primeiro `CREATE TABLE`, e a instrução vive no README. Um banco que aplicou 001..011 tem o mesmo schema e três nomes órfãos em `_migrations`, que o runner ignora; recriar é mais limpo e foi o que se fez em desenvolvimento.
- **Status:** aceita. Supera a parte da entrada de 2026-08-19 que dizia que forward-only voltava a valer a partir da 009: volta a valer a partir da PRÓXIMA migração, e enquanto não houver banco em produção uma baseline pode ser reescrita.

---

### 2026-08-23: `POST /sv360/photos/batch-calibration` fica, como API de roteiro, com prazo de cobrança

- **Contexto:** a revisão do módulo 360 achou a rota viva e sem nenhum cliente. Ela tem controller, schema com teto de 500 itens, serviço com SAVEPOINT por item e uma seção de wiki que instrui o cliente a "tratar `failed` sempre". O frontend chama apenas as duas irmãs, por PROJETO e por FAIXA (`api-client.js`, usadas pelo painel de calibração); a rota por FOTO só aparece em teste e nos censos. Pela doutrina de poda, ela sairia.
- **Decisão:** mantê-la, e cobrar a decisão em **2026-11-23**. Se até lá nenhum roteiro de operação a usar, ela sai com o repro e as duas entradas de censo.
- **Por que ela não saiu junto com os outros doze achados da mesma varredura:** ela é a ÚNICA superfície onde a política de erro por item é exercitada, e o guarda dessa política é um repro de auditoria (`backend/tests/integration/sv360-batch-error-leak.repro.test.js`, achado 109): mensagem de driver não pode vazar em `failed[].error` dentro de uma resposta 200, e `NotFound` não pode virar texto genérico. Removendo a rota, o guarda morre com ela, e a política volta a não ter onde ser medida. As duas irmãs vivas são de outra forma (uma transação só, sem `failed` por item), então o repro não migra: não há para onde.
- **Alternativas rejeitadas:**
  - **Remover a rota e migrar o repro para as irmãs.** Não é migração, é reescrita: o que o repro mede (erro por item dentro de um 200) não existe nas irmãs.
  - **Remover a rota e o repro.** Perde a única medição de uma política de vazamento real, para ganhar a remoção de uma superfície que nada exercita. O saldo é negativo.
  - **Escrever um cliente para ela.** Seria inventar requisito para justificar código, que é o defeito ao contrário.
- **Status:** aceita, com prazo. É a exceção declarada de uma varredura em que os outros doze achados foram corrigidos ou podados.

---

### 2026-08-22: o registro da fase multi-aba sai de `docs/decisions/`, porque o durável dele já vive na wiki

- **Contexto:** `fase-multiaba-2026-08.md` tinha 359 linhas e três camadas misturadas: as sete decisões de desenho (D1 a D7) com a alternativa rejeitada e a evidência medida, o roteiro de execução (E0 a E8) e a lista do que a suíte precisava deixar de afirmar. Nove comentários de teste o citavam pelos identificadores ("E0 item 6", "D4", "a Decisão 1"), e o índice `DECISIONS.md` apontava para ele. Enquanto a fase corria, esse vocabulário era o que dizia a um leitor o que cada spec estava provando.
- **Decisão:** remover o arquivo. O levantamento mostrou que **todo o conteúdo durável já tinha sido absorvido pela wiki**, alternativas rejeitadas incluídas: o Web Lock contra o roster e o lease, o lock que não é fencing, o prazo do perdão e a chave por atlas em vez de array estão em [`../wiki/namespace-por-atlas.md`](../wiki/namespace-por-atlas.md); a regra do dono, a ordem total e o aviso antes de destruir estão em [`../wiki/coordenacao-entre-abas.md`](../wiki/coordenacao-entre-abas.md); a fila por atlas está em [`../wiki/fila-operacoes-outbound.md`](../wiki/fila-operacoes-outbound.md). As nove citações passam a nomear a PROPRIEDADE que cada caso prova e a apontar para a página de wiki.
- **Alternativas rejeitadas:**
  - *Manter como estava.* O que sobrava depois da absorção era vocabulário de fase, e identificador de etapa é a primeira coisa que perde sentido quando a fase acaba: "E0 item 6" não diz nada a quem chega depois, e ainda assim obriga a abrir um arquivo de 359 linhas para descobrir o que o teste mede.
  - *Podar o arquivo mantendo os identificadores.* Preservaria as citações ao custo de manter vivo justamente o que envelheceu. E a poda teria de conservar `D1`…`D7` e `E0`…`E8` inteiros, ou seja, quase tudo.
  - *Promover o arquivo a página de wiki.* Recusada por duplicação: as três páginas que cobrem o assunto já existem e estão mais atualizadas que ele. Uma quarta página com o mesmo conteúdo é a divergência de amanhã.
- **Consequências:**
  - O registro do EVENTO continua onde pertence: as entradas de 2026-08-15 deste arquivo (namespace por atlas, fila por atlas).
  - Some do repositório uma classe de citação que nenhum guarda alcançava: o arquivo usava `arquivo:linha` como evidência (`store.js:243`, `tab-lock.js:325-328`), forma que a convenção proíbe hoje justamente porque apodrece sem deixar rastro.
  - A afirmação "`main` É produção", que o arquivo carregava numa análise de revert, sai junto. Ela já não valia.
- **Status:** aceita.

---

### 2026-08-23: o NÍVEL de cada participante fica visível para todo membro do atlas

- **Contexto:** um diagnóstico mediu a superfície de acesso e achou que "quem tem acesso a este atlas, e com que nível" só era respondível por `GET /api/v1/atlas/:atlasId/sharing`, gateada em `manage`. O cartão de projeto (`GET /api/v1/atlas/overview`, consulta `LIST_USER_ATLAS_MEMBERS`) já listava os participantes para qualquer um dos cinco níveis, com id, nome e posto, mais `member_count`, e deliberadamente SEM o nível. O efeito para um Leitor ou um Editor: ele via com quem divide o projeto e não tinha como saber a quem pedir permissão, nem por que um vizinho apaga o que ele não apaga.
- **Decisão (do dono):** o nível passa a sair no cartão, para todo membro. Cada item de `members` ganha `permission`, e ele é o nível EFETIVO (resolvido por `fn_user_atlas_shares`, o mesmo dos dois gates), não a coluna de `atlas_shares`. O dono sai como `owner`, sintetizado como `resolvePermission` faz, porque ele não tem linha de share.
- **Alternativas rejeitadas** (esta é uma decisão de privacidade, e as duas primeiras são as que se defendem):
  - *Manter como estava, com o nível só em `GET /sharing`.* É a posição conservadora, e o argumento a favor dela é real: nível de acesso alheio é informação de gestão, e foi por isso que aquela rota exige `manage`. O que a derruba é o custo medido do silêncio: a composição do atlas JÁ é visível a todo membro (nome, posto e id, e a presença mostra os conectados no primeiro instante de colaboração), então o que se estava escondendo não era QUEM alcança o projeto, era só o degrau de cada um. Esconder o degrau não protege a identidade de ninguém e deixa a pessoa sem saber a quem se dirigir.
  - *Mostrar só o PRÓPRIO nível, e o dos outros só a partir de `manage`.* Resolve metade do problema (a pessoa descobre o que ela pode) e não resolve a outra (a quem pedir), que é a que gera o pedido de suporte. E cria uma terceira forma de payload para a mesma lista, com dois caminhos de teste para o mesmo cartão.
  - *Mostrar também o CAMINHO (`effectiveVia`, direto ou por grupo), como `GET /sharing` faz.* **Recusada, e esta é a linha da decisão que protege alguém:** dizer "por grupo" a todo membro de leitura revela que aquela pessoa está num coletivo, dedução sobre COMPOSIÇÃO de grupo que as cláusulas 4.5 e 5.3 reservam a quem administra o grupo e a quem tem `manage` no atlas. O nível responde a pergunta que a decisão abriu; o caminho não faz parte dela.
  - *Nomear os GRUPOS como participantes, ao lado das pessoas.* Recusada por medição, e não por princípio: a lista JÁ enxerga o eixo de grupo, porque `fn_atlas_member_ids` expande o coletivo em PESSOAS e deduplica, de modo que ninguém que alcance o atlas fica fora do cartão. Acrescentar o grupo como entidade não corrigiria mentira nenhuma e entregaria a existência (e o nome) de coletivos alheios a quem só tem leitura, que é a mesma dedução sobre composição do item anterior.
- **Consequências:**
  - `username`, e-mail e qualquer identidade de login continuam FORA. O contrato do item é id, nome, posto e nível, e a lista de chaves é asserida em `backend/tests/integration/atlas-cartao-projeto.test.js`, para que a próxima decisão não acrescente um quinto campo de passagem.
  - O corte de dez do `json_agg` e o `member_count` verdadeiro não mudaram, e há caso medindo os dois com doze membros.
  - O nível EFETIVO é o que impede o cartão de mentir: quem tem `read` nominal e `manage` por um coletivo aparece com `manage`. É a mesma correção que `effectivePermission` fez em `GET /sharing`, na tela ao lado, e o controle negativo (trocar a resolução pela coluna) derruba dois casos e deixa os outros três verdes.
  - Preso por `backend/tests/integration/overview-nivel-do-participante.test.js`.
- **Status:** aceita.

---

### 2026-08-23: sair de um atlas e sair de um grupo, por conta própria

- **Contexto:** o mesmo diagnóstico mediu que não havia saída voluntária em lugar nenhum. `DELETE /api/v1/atlas/:atlasId/sharing/users/:userId` exige `manage`, então um Editor não conseguia se retirar de um projeto; e `DELETE /api/v1/access-groups/:groupId/members/:userId` passa por `requireGroupAuthority`, que responde **404 ao próprio membro**, porque ele não administra o grupo. Nos dois casos a pessoa dependia de pedir a quem administra. No caso do grupo isso contradizia de perto a cláusula 4.5, que existe para que um mecanismo capaz de decidir o acesso da pessoa a recurso privado não seja invisível para ela: ela via que participa e não podia sair.
- **Decisão (do dono):** duas rotas novas, `DELETE /api/v1/atlas/:atlasId/sharing/me` e `DELETE /api/v1/access-groups/:groupId/members/me`, gateadas por `auth` e mais nada. A autoridade exercida é sobre si mesmo, e é ela que autoriza a ausência de gate: exigir `manage` (ou posse do grupo) para se retirar é justamente o que prendia a pessoa.
- **Alternativas rejeitadas:**
  - *Afrouxar as rotas existentes, deixando `:userId` igual ao chamador passar sem o gate.* Um `if` dentro de um gate que decide autoridade é a forma mais barata de abrir a rota por engano, e ela some na leitura: quem lê `requireAtlasPermission('manage')` na linha da rota conclui que a rota é de gestor.
  - *Responder 404 para quem não participa, como as rotas irmãs fazem.* Recusada porque devolveria por outra porta o oráculo que o 404 uniforme dos dois módulos existe para negar: um estranho comparando 404 com 200 descobriria quais UUID são atlas ou grupo de verdade. Sair de onde não se está e sair do que não existe respondem a MESMA coisa, 200 com `removed: false`.
  - *Uma ação nova de auditoria, do tipo "saiu por conta própria".* Recusada pelo mesmo argumento já registrado para as duas auto-edições de conta e para o eixo de grupo do compartilhamento: partiria em duas listas que não se cruzam a história de UM acesso, e custaria alargar o CHECK de `audit_trail.action` (em Postgres, `DROP` mais `ADD CONSTRAINT`, uma entrada em `EXCECOES_DESTRUTIVAS` e uma migração). A saída voluntária reusa a ação do ato equivalente por terceiro (`PERMISSION_REVOKE` e `ACCESS_GROUP_MEMBER_REMOVE`) e se distingue por `details.self`, com `actor_id` sendo a própria pessoa.
  - *Deixar o dono sair.* Recusada nos dois eixos, com 409 e mensagem que nomeia o caminho. No atlas ele ficaria órfão (`atlas.owner_id` é FK sem `ON DELETE`, e o empréstimo de recurso é resolvido a partir do dono). No grupo é pior: `fn_can_administer_group` tem dois ramos, posse VIVA e administrador do sistema, e `fn_user_group_ids` exige `fn_principal_vivo(owner)`, então um grupo sem dono deixa de entregar acesso e fica sem quem o administre. 403 seria a resposta errada, porque quem chega ali tem a MAIOR permissão que existe; o que existe é conflito de estado. A recusa não prende ninguém: o dono que por acaso também esteja na composição do próprio grupo continua tirando a própria linha pela rota administrativa, que ele já pode.
- **O que a saída derruba, e o que ela preserva** (medido, não presumido):
  - **Atlas:** apaga UMA linha, a de `atlas_shares`. O que a pessoa alcançava POR AQUELE atlas é o EMPRÉSTIMO de recurso, que não é concessão e não tem linha em `resource_grants`: ele vive dentro de `fn_granted_resource_ids` e cai por PREDICADO, sem varredura, no instante em que o atlas deixa de estar em foco (cláusula 6.2). O que a pessoa tem por CAMINHO PRÓPRIO (papel global, produção, concessão nominal) nunca dependeu do atlas e continua de pé. Por isso NÃO há poda escrita neste caminho: escrever uma seria derrubar o que a saída não devia derrubar.
  - **Grupo:** reusa o corpo de `removeMember` (um só, `retirarMembro`), inclusive o `resgatarRaiz`, de modo que o repasse feito ATRAVÉS do grupo cai e o feito por autoridade própria sobrevive repai-ado (cláusulas 3.6 e 3.7). O segundo eixo do grupo (o acesso a ATLAS por `atlas_shares.group_id`) cai por predicado, como já caía ao apagar o grupo.
  - Nos dois, a sessão de colaboração ao vivo cai pelo MESMO caminho da revogação por terceiro: o sweep de `reconcileAuthorization` (~30 s) reconcilia a autorização e fecha o socket com 4003. Nada novo foi escrito para isso.
- **Consequências:**
  - O atlas responde 200 com `atlasId`, `removed` e `effectivePermission`, e o terceiro campo é load-bearing: quem também alcança por um coletivo NÃO sai (a linha do grupo não é dele para apagar), e sem esse campo a tela anunciaria "você saiu" com o atlas ainda na lista.
  - O grupo responde 200 com `groupId`, `userId`, `removed` e `grantsAffected`.
  - `DELETE /:groupId/members/me` precisa ser declarada ANTES de `/:groupId/members/:userId`, senão Express casa a segunda com `userId = 'me'` e o `validate({ params })` dela responde 422 falando de UUID, um sintoma que não aponta para ordem nenhuma. Há caso medindo isso.
  - O administrador global não é caso especial: ele sai da LINHA de share se tiver uma, e a posse por papel (cláusula 5.5) continua, porque não vem de share. "Sair" de uma autoridade que não é compartilhamento seria outra funcionalidade.
  - Presas por `backend/tests/integration/sair-do-atlas.test.js` e `backend/tests/integration/sair-do-grupo.test.js`.
- **Status:** aceita. O cliente das duas rotas vem na onda seguinte; o que esta entrega é o contrato do servidor.

---

### 2026-08-23: o autor que VENCE a disputa repara o próprio valor no ack, porque nenhuma marca chega a tempo

- **Contexto:** três clientes editaram a cor da MESMA feição, com asserção que lê o Postgres e os três navegadores em laço por 30 s. Resultado medido: `servidor=#00ff00 clientes=#00ff00,#00ff00,#ff0000`. O cliente C escreveu o verde, o servidor gravou o verde de C, e C ficou exibindo o vermelho de A pelos 30 s inteiros. O SyncLedger da mesma rodada: `orphans: 0`, `acked-but-no-effect: 0`, `conflicts: 4`, ou seja, as três edições foram aceitas e um cliente ficou com um valor superado. Taxa medida na fase 3 de `frontend/tests/e2e-ui/browser-collab-three-client-flow.spec.js`, com `--retries=0`: cerca de 17% em 29 rodadas, repartida com outros dois modos de falha.
- **Mecanismo (medido, não suposto):** o guarda de convergência já existia (`markLocalEditPending` → defer → `resolveLocalEdit`), e ele depende de a marca de edição local existir ANTES de a op do par ser aplicada. Ela não existe, por duas razões independentes:
  1. `markLocalEditPending` roda em `logOperation` (`frontend/src/js/store/sync/operation-dispatcher.js`), chamado de `tx.deferAsync`, e `StoreTransaction.commit()` dispara os efeitos assíncronos SEM `await` (`frontend/src/js/store/store-transaction.js`), depois de um `await operationQueue.enqueue`. Entre a persistência do valor local e a marca há pelo menos uma escrita de IndexedDB, FORA do lock do documento de mapa que a edição segurava;
  2. adiantar a marca não fecha a janela, e é isso que decide o desenho: `applyRemoteOperation` LÊ `pendingLocalEditCount` antes de `applyRemoteFeatureOp` tomar o lock do mapa. A op do par passa pelo guarda com o contador em zero, fica esperando o lock que a edição local segura, e escreve DEPOIS dela.
  Aplicada a op do par em qualquer das duas janelas, o autor nunca mais é corrigido: ele filtra o próprio eco no WebSocket (`_isOwnClientId`, `frontend/src/js/store/sync/ws-client.js`), então o valor dele não volta por caminho nenhum. O de-dupe protege contra reaplicar o próprio trabalho e, ao fazê-lo, destrói a única chance de o cliente descobrir que VENCEU.
- **Decisão:** o push ack passa a carregar a OP, e não só o número. `recordLocalAppliedVersion` (`frontend/src/js/store/sync/sync-engine.js`) entrega `op` a `resolveLocalEdit`, que repara: se uma op REMOTA de `serverVersion` ESTRITAMENTE MENOR foi aplicada àquela entidade, a op local acked é reaplicada pelo mesmo caminho de entrada (`applyRemoteOperation`), com os mesmos handlers, locks e eventos de ciclo de vida que um par usaria. A evidência de atropelo mora num mapa novo e SEPARADO, `lastRemoteAppliedVersion`, porque `lastAppliedVersion` também é semeado pelos acks do próprio autor e não distingue as duas origens.
- **Alternativas rejeitadas:**
  - *Guarda de LWW no `applyRemoteOperation` contra uma ordem total observável.* É o que o código JÁ faz, e é justamente o que estava furado: a ordem total existe e é observável (`serverVersion`, carimbado no broadcast por `frontend`/`backend/src/modules/sync/sync.controller.js` a partir de `results[].currentVersion`, mesma sequência `atlas_version_seq` do ack). O furo não é de ordenação, é de ATOMICIDADE: entre a escrita local e o registro da intenção local não há seção crítica, e não há onde pôr uma sem enfiar a marca dentro de cada operação de store das nove entidades guardadas, o que ainda deixaria a janela 2 aberta.
  - *Adiantar `markLocalEditPending` para antes do `await operationQueue.enqueue`.* Fecha a janela 1 e não fecha a 2, e um guarda que fecha metade de uma corrida é indistinguível de um que fecha inteira até o dia em que não é. Foi medido e recusado, não esquecido.
  - *Fazer o servidor confirmar o vencedor por um frame novo, ou parar de filtrar o próprio eco.* Alarga o contrato congelado entre os dois pacotes e desliga o de-dupe que existe por razão própria (o autor reaplicando as próprias ops de volta). O ack já é a confirmação do servidor ao autor: o que faltava era ele carregar o payload.
  - *Reaplicar a op local em TODO ack.* Correto e caro: uma escrita de documento de mapa por op acked, no caminho quente de toda edição.
  - *Religar um CRDT (LWW por timestamp).* Fora de questão por regra da casa e desnecessário: o modelo é LWW por ordem de CHEGADA e a ordem já é observável.
- **Consequências:**
  - O reparo NÃO é isento de trabalho redundante: uma op de par aplicada limpa ANTES de a edição local começar também satisfaz a condição, e o reparo então reescreve o valor que o store já tem. É escrita idempotente, e distingui-la exigiria um carimbo "aplicou remoto desde que esta op nasceu" que a fila não carrega através de um reload. O preço aceito foi uma escrita a mais numa entidade que um par acabou de editar, em troca do guarda falhar FECHADO.
  - Só o ÚLTIMO ack em voo de uma entidade repara, e com os dados dele: um ack intermediário reescreveria por cima de uma edição local mais nova ainda na fila.
  - Quem PERDE não é reparado (op remota de versão maior aplicada), e há caso medindo isso: sem ele o reparo poderia ser incondicional, que é divergência na direção oposta.
  - O caminho de lote (`logBatchOperations`) nunca chamou `markLocalEditPending` e agora está coberto de graça, porque o reparo é dirigido pelo ack e não pela marca.
  - Preso por `frontend/tests/integration/convergencia-autor-vencedor.repro.test.js`, que força a interleaving perdedora em node (a op de A aplicada ENTRE a escrita local e a marca) e falha 100% das vezes contra o código anterior, nos dois casos de reparo.
- **A SEGUNDA METADE, descoberta medindo o próprio conserto:** com o reparo escrito e a spec rodando em série, apareceu a assinatura ESPELHADA, `servidor=#0000ff clientes=#0000ff,#0000ff,#00ff00`, o autor preso no PRÓPRIO valor depois de PERDER. A causa é a mesma falta de atomicidade, agora mordendo o reparo: `applyRemoteOperation` lê `shouldApplyVersion` e só então chama um handler que espera o lock do documento, de modo que duas aplicações passam pela checagem e aterrissam na ordem do LOCK, que é a ordem inversa. `ws-client.js` escondia isso para a op que chega pelo socket, encadeando-as (`_applyChain`), e TRÊS chamadores contornam esse encadeamento: o replay das ops adiadas, o reparo (os dois em `resolveLocalEdit`) e o replay pós-flush de `reconcilePendingLocalEdits`. Daí `serializeGuardedApply`, uma cadeia própria do caminho GUARDADO que torna checar, escrever e registrar um passo só. Ela não substitui o lock do documento: aquele ordena o DOCUMENTO e é por mapa; esta ordena o GUARDA. Ela não alcança `drainPendingFeatureOps`, que aplica por `applyRemoteFeatureOp` direto e carrega a própria checagem de versão.
  A lição de método é que o primeiro repro não pegou esta metade: ele montava a corrida com a marca de edição local de pé, e com ela a op do par é ADIADA em vez de aplicada, então o caso passava verde com e sem a cadeia. Foi o controle negativo, e não a leitura, que denunciou a cobertura vazia. O caso corrigido derruba o valor do autor sobre o do vencedor, com a assinatura de campo byte a byte.
- **Status:** aceita. Mudança só do cliente: o servidor já carimbava a ordem no broadcast e no ack, e nada no contrato de rede mudou.

### 2026-08-24: afordância negada SOME por posto e RECUSA por estado, e o relatório de UX do usuário comum é dissolvido

- **Contexto:** cinco relatórios de UX por papel viviam na raiz do repositório, fora do alcance de
  `frontend/tests/unit/docs-integridade.test.js` (que varre `docs/` e `.claude/`, não a raiz). O do
  usuário comum listava 23 achados abertos. Reconferidos contra a árvore, 21 continuavam intactos;
  **dois estavam errados**, e os dois na mesma direção, a que mais custa: o relatório acusava um
  guarda de não guardar (`frontend/tests/unit/falha-de-requisicao-nao-apaga-credencial.test.js`
  varre com `git ls-files`, não com lista à mão) e dava por aberto um defeito já corrigido em
  `frontend/src/js/calibration/calibracao-page.js`. Um aviso que manda desconfiar da fonte certa
  custa o mesmo que um que manda confiar na errada.
- **As quatro decisões do dono, tomadas nesta data:**
  1. **Afordância que o POSTO não alcança SOME; afordância bloqueada por ESTADO é desenhada e
     recusa o clique nomeando o estado.** A assimetria é o desenho, não inconsistência: antes os
     dois escondiam, e o menu de um Leitor era idêntico ao do dono de um mapa TRAVADO. Nenhum dos
     dois aprendia nada, e um deles só precisava clicar no cadeado.
  2. **A edição atropelada por um colega ganha aviso NOMEANDO o autor**, só quando a op remota toca
     entidade que esta pessoa editou nos últimos segundos. O modelo de conflito não muda.
  3. **O modal de criar atlas passa a oferecer o eixo de GRUPO**, fechando a assimetria com o de
     compartilhamento (cláusula 4.1: grupo serve a recurso e a atlas).
  4. **O documento é dissolvido ao fim**, com o durável migrando para cá, para `.claude/rules/` e
     para `docs/livro-razao.md`.
- **Alternativas rejeitadas, para a regra 1:**
  - *Sempre sumir.* Uniforme e mais fácil de auditar, mas quem perde posto ao vivo vê a tela
    encolher sem saber por quê, e o motivo (que o servidor carrega por extenso) nunca chega.
  - *Sempre desabilitar com o motivo.* Ensina o produto e contraria a recusa já escrita em
    `LocalAtlasSection` (`frontend/src/js/projects/atlas-drive.js`), onde um botão morto foi
    recusado por não explicar nada. Adotá-la exigiria reverter aquela decisão no mesmo commit.
- **Consequências:**
  - A decisão pura do menu por mapa virou módulo próprio, `frontend/src/js/sidebar/tabs/map-menu-actions.js`,
    irmão de `frontend/src/js/sidebar/tabs/atlas-actions.js` e testável em node.
  - A frase de recusa deixou de ser única. `checkPermission`
    (`frontend/src/js/store/sync/permission-guard.js`) passou a devolver `required`, os 25 sítios de
    `STORE_OPERATION_BLOCKED` a carimbá-lo, e `denialNotice`
    (`frontend/src/js/store/denial-phrases.js`) a derivar o texto da CAPACIDADE negada. A sentença
    anterior afirmava acesso somente leitura, o que era falso para todo degrau acima de
    Visualizador.
  - **Um achado NOVO apareceu durante o trabalho:** o Gestor tinha `canLockMaps` no cliente e o
    servidor exige `owner` estrito para tocar `locked` (`operationDenialReason`,
    `backend/src/modules/sync/sync.service.js`). Era latente, porque o único chamador já gateava
    por `serverTreatsAsAtlasOwner`, mas DOIS guardas fixavam a divergência sem justificá-la.
- **Status:** aceita e implementada.

---

### 2026-08-24: as oito decisões do perfil PRODUTOR, e o relatório de UX dele é dissolvido

- **Contexto:** o relatório de UX do perfil produtor, na raiz do repositório, listava 38 achados abertos contra a conta com papel GLOBAL `producer`, dos quais **2 críticos**, e nove perguntas que só o dono decide. A baixa contra `59e9600c` (commit `8a267bd2`) tinha mostrado por que ele era o próximo alvo: os dois críticos sobreviveram a três commits seguidos que passaram ao lado deles, porque a calibração recebeu conserto de CASCA (`calibracao-page.js`) e nada de miolo (`calibration/app.js`), que é onde os dois moram.
- **Decisão:** as nove perguntas foram respondidas pelo dono (uma já estava respondida pelo código) e viraram código no mesmo commit. Em ordem:
  1. **A calibração lista só o que o produtor MANTÉM.** `fetchProjects` troca `/projects` (eixo de LEITURA, recortado por `sv360AccessPredicate`) por `/admin/projects` (eixo de PRODUÇÃO, recortado por `fn_can_produce_resource`).
  2. **A tela de envio de bundle 360 nasce; a ingestão 3D vira frase na cláusula 2.4.** A rota `POST /sv360/admin/projects/upload` já era autenticada, já aceitava o produtor e já impunha a OM dele, e tinha ZERO chamadores no cliente.
  3. **A legenda do eixo Status muda, e o eixo NÃO nasce** para as quatro categorias de `resources`. Só o 360 tem o eixo de verdade.
  4. **Prazo de concessão entra na tela; rebaixamento vira texto.** O servidor já aceitava e honrava `expiresAt`; não há `PATCH` de grant e não vai haver.
  5. **A lotação DE-AUTORIZA, e a constituição passa a dizer isso.** Comportamento inalterado; a contradição entre estatuto e código deixa de existir por escrito.
  6. **Só o chip do mapa é consertado**, e a aba Catálogo nomeia onde se concede. O botão de compartilhar no painel não nasce.
  7. **A tela diz o recorte da trilha**; grupos NÃO passam a carimbar OM.
  8. **O logout não pergunta, mas a volta avisa.**
- **Alternativas rejeitadas, e as duas primeiras são o padrão desta rodada:**
  - *Fazer o eixo Status nascer* (3) e *fazer grupos carimbarem OM* (7): as duas trocariam construção por verdade na direção errada. O eixo Status existe no banco e não tem controle na tela; a cláusula 9.2 fala em recursos produzidos, então a trilha recortada é literal. Nos dois casos o defeito era a tela AFIRMAR o que não existe, e o conserto barato é a tela parar de afirmar.
  - *Uma rota de ingestão 3D* (2): a cláusula 2.4 fala em manter "as linhas de catálogo", então o estatuto não promete ingestão. Fica declarado que os bytes são trabalho de operador com shell no servidor, em vez de continuar sendo um buraco não dito. **Vale registrar o contraste que motivou a pergunta:** os scripts de `backend/scripts/` que fazem essa ingestão hoje não têm gate algum, e `models3d-adotar.js` escreve a própria linha de catálogo, contornando `requireCatalogProducer` por inteiro e podendo carimbar qualquer OM dona.
  - *Um `PATCH` de grant* (4): exigiria decidir o que acontece com a subárvore ao rebaixar (cai? é reparentada?), que é regra nova de cascata. O que faltava de fato era a tela DIZER que rebaixar exige revogar e reconceder.
  - *Perguntar no logout* (8): a perda é reversível (basta entrar de novo), e cobrar um passo por ela contradiz o que já ficara decidido para o perfil `user`.
- **Consequências:**
  - **O conserto proposto para o A4 estava ERRADO, e o CSS da própria página o disse.** O achado mandava montar `createAppBar` em `calibracao.html` como nas outras duas páginas sem mapa. O comentário de layout de `frontend/src/css/calibracao.css` não é estilístico: o canvas do WebGL precisa ter a MESMA razão de aspecto do EBGeo (viewport inteira), e é isso que faz a projeção e a posição dos marcadores serem idênticas às do visualizador 360 do mapa. Uma barra que ocupasse altura teria custado a fidelidade que a página inteira existe para garantir. A barra foi montada em SOBREPOSIÇÃO, que é o padrão já estabelecido ali (painel, minimapa e seletor também sobrepõem).
  - **`isProducer()` passou a exigir a OM produtora VIVA**, e o payload de sessão passou a carregar a vivacidade e o NOME dela (`FIND_USER_BY_ID` ganhou a junção com `producer_org_id`, que antes saía cru). Isso fecha o pior padrão de recusa do produto: painel funcional negando tudo com 404. O gate de rota não barrava (`CATALOG_PRODUCER_ACTOR` resolve o escopo juntando só a OM de LOTAÇÃO), então a recusa vinha do `WHERE` da escrita, e `WHERE` que não casa devolve zero linhas, que viram "não encontrado".
  - **`producer_org_nome` era lido em dois pontos do cliente e NUNCA existiu no servidor.** O ramo esquerdo daquele `||` era morto, e como `config.organizacoesMilitares` só traz OM ativa, a tela caía no UUID cru exatamente no caso da OM desativada. A mesma junção fechou os dois.
  - **O predicado do veredito de poda saiu de `users.service.js` para um módulo folha** (`backend/src/modules/users/producer-scope-verdict.js`). Os dois `@fileoverview` diziam que não havia teste ligando o espelho do cliente ao servidor, com um motivo verdadeiro (o serviço puxa banco e bcrypt) e uma conclusão evitável: o que precisava ficar leve era o PREDICADO, não o serviço. `frontend/tests/unit/escopo-de-producao-espelha-backend.test.js` agora importa os dois e compara as 144 mudanças possíveis. Ele achou, na primeira execução, que os dois lados usam VOCABULÁRIOS diferentes (o cliente tem três motivos, o servidor dois fundamentos), e o mapeamento entre eles passou a ser declarado em vez de viver na cabeça de quem leu os dois arquivos.
- **Status:** aceita e implementada. O relatório foi dissolvido; o durável está aqui, em [`../../CONSTITUICAO.md`](../../CONSTITUICAO.md) (cláusulas 1.4/10.5 e 2.4), em [`../../.claude/rules/architecture.md`](../../.claude/rules/architecture.md) e em [`../livro-razao.md`](../livro-razao.md).

---

### 2026-08-24: as oito decisões do perfil ADMINISTRADOR, e o relatório de UX dele é dissolvido

- **Contexto:** o relatório de UX do administrador do sistema, na raiz, listava 38 achados abertos, dos quais **2 críticos**, e oito perguntas ao dono. Três baixas consecutivas (contra `59e9600c`, `b0e66b77` e a do próprio dia) tinham mostrado por que ele era o alvo: **nenhum dos três lotes anteriores fechou um único achado dele**. O commit do produtor chegou a passar por quatro arquivos de `admin/` e mesmo assim não fechou nada, porque o que ele mudou ali era do eixo vizinho. O painel de administração não encolhe por efeito colateral.
- **Decisão:** as oito perguntas foram respondidas e viraram código no mesmo commit.
  1. **Desativar OM fica reversível na tela E ganha guarda dura.** Rótulo "Desativar", coluna Status, botão Reativar (a rota sempre aceitou `is_active`), confirmação com três contagens novas, e 409 do servidor quando a OM é a lotação de quem pede. O buraco da chave de API fecha junto.
  2. **Desativar conta passa a avisar, relatar e dizer o que não volta.** Zero rota nova: `live_grant_count` já vinha na listagem e `atlasTransferred`/`grantsRevoked`/`grantsReparented` já vinham na resposta.
  3. **As três rotas órfãs ganham porta:** busca de atlas do sistema, revogação de chave de API alheia e tela do expurgo do log.
  4. **O painel é desktop-only, declarado**; a transferência de recurso entre OMs sai do TEXTO em vez de nascer como rota; o filtro por ator da auditoria nasce; a exclusão de item de catálogo ganha contagem de referências.
  5. **O CRUD de postos ganha trilha**, e o teto do censo de auditoria cai de quatro buracos para um.
  6. **A transferência de atlas alcança a lixeira.**
  7. **Os quatro podadores mudos passam a avisar as salas**, como a revogação deliberada já fazia.
  8. **A frase de recorte passa a existir também para o administrador.**
- **Alternativas rejeitadas:**
  - *Fazer nascer a transferência de recurso entre OMs*: o formulário a prometia por escrito e ela não existe em rota nenhuma, nem no catálogo nem no 360. Tirar a promessa custa uma frase; criar a capacidade custa escrita nova, trilha nova e a decisão sobre o que acontece com as concessões originadas pela OM anterior.
  - *Dar responsividade ao painel*: seis abas de tabela com cinco a sete colunas, mais formulário de JSON e trilha paginada. Espremer isso não produz uma tela pior, produz uma tela que mente, porque coluna escondida em painel de administração é dado que a pessoa acha que não existe.
  - *Fazer a reativação restaurar as concessões podadas*: elas são identificáveis (têm `revoked_at` e origem `USER_DELETE`), mas ressuscitá-las exige decidir o que fazer quando a subárvore mudou no meio ou o recurso virou privado depois. Fica dito o que a reativação NÃO devolve, que é o que faltava.
  - *Listar os atlas do sistema*: a enumeração nasce por BUSCA e sob controle explícito. O servidor recusa termo com menos de dois caracteres e escapa `%`/`_` antes do ILIKE, senão um curinga passaria no piso e devolveria o acervo.
- **Consequências, e as quatro primeiras foram achadas medindo, não lendo:**
  - **O alcance do buraco da chave de API era MENOR do que a auditoria dizia.** Três dos quatro caminhos de acesso a recurso privado já chamavam `fn_principal_vivo`, que confere a OM de lotação. O único aberto era o **empréstimo por atlas**, e é por ele que o teste mede: medir por qualquer um dos outros daria verde com e sem o conserto, que é cobertura vazia. **Buraco novo declarado e NÃO fechado:** `atlas_shares` e `requireAtlasPermission` também não checam vivacidade de principal.
  - **Fechar a trilha dos postos alargou a baseline em vez de criar migração**, e é o que `backend/CLAUDE.md` manda enquanto não houver produção ("se o CHECK precisa ser mais largo, ele nasce largo"). A rota do arquivo novo exigiria `DROP CONSTRAINT`, que é DDL destrutiva e obriga uma entrada em `EXCECOES_DESTRUTIVAS` por ocorrência. A mudança quebraria o guarda de rótulos do frontend, que lê o CHECK vigente direto das migrações: os quatro rótulos pt-BR entraram no mesmo commit.
  - **O aviso da poda mudou de camada, e a regra ficou dizível numa frase:** quem ABRE a transação avisa DEPOIS do commit dela. Pôr o aviso dentro do podador o faria rodar um frame antes do commit, mandando o receptor re-pedir o payload do estado velho, sem segundo aviso depois: trocaria catálogo obsoleto por catálogo obsoleto permanente.
  - **Um teste existente caracterizava o defeito A5 e teria virado o vermelho errado.** Ele asseria que o atlas na lixeira FICAVA com a conta desativada, com a palavra "CHARACTERIZATION" no texto. É a forma que uma caracterização toma, e é também a forma que faz um guarda defender o bug: no dia em que alguém consertasse o filtro, o arquivo ficaria vermelho e o conserto pareceria a regressão. Ele passou a medir o oposto, e o ramo do administrador continua exercitado logo em seguida, porque ele é a volta para o que ficou preso ANTES do conserto.
  - **Contar referência de recurso ganhou guarda no load do módulo:** superfície nova no registro sem perna na consulta faz o backend RECUSAR CARREGAR, com o id da superfície na mensagem. É mais forte que um teste, porque não depende de alguém rodar o teste.
- **Status:** aceita e implementada. O relatório foi dissolvido.

### 2026-08-24: as quatro decisões do perfil CREDENCIADO, e o relatório de UX dele é dissolvido

- **Contexto:** o relatório de UX do credenciado, na raiz, listava 18 achados, dos quais 1 crítico, e sete perguntas ao dono. Ele era o alvo restante por uma razão ESTRUTURAL, não acidental, e três baixas consecutivas mediram isso: **em quatro lotes seguidos ele ganhou duas metades de achado BAIXO e nada mais**. As telas dele são o modal de compartilhamento, a árvore de concessões e a aba Grupos, e nenhuma é tela do usuário comum. Ele não herda conserto de ninguém. A baixa contra `34828b9b` fechou o M2 inteiro por efeito colateral (a frase parou de oferecer um caminho inexistente e a cláusula 4.7 foi reescrita no mesmo commit) e metade do M7 e do B3.
- **Decisão:** as quatro perguntas que mudavam materialmente o trabalho foram respondidas e viraram código no mesmo commit.
  1. **O inventário de concessões nasce pelos DOIS lados**, com duas rotas por ator (`grants/issued` e `grants/received`) e uma aba nova. A porta do credenciado deixou de se chamar "Grupos" e virou "Acessos", com duas abas. Fecha A3 e a metade do A2 que ninguém tinha olhado: o produto era mudo do lado de QUEM RECEBEU, que não tinha como sequer perguntar o que tem, nem descobrir quando vence.
  2. **A procedência do acesso passa a viajar no payload.** Um selo "Privado" cobria três origens, e o `title` dele era literalmente falso para o único perfil que vê tudo sem ter recebido nada. Agora são três selos, e só o de EMPRÉSTIMO avisa que é volátil, porque só ele some sozinho ao trocar de atlas. Fecha M1 e paga o filtro por origem do M4.
  3. **O aviso de camada indisponível se estende a análise e basemap**, reusando o mecanismo das camadas de dado. 3D e 360 ficam de fora, declarados: não passam pelo `error` do MapLibre.
  4. **Os dois documentos passam a dizer quem revoga.** `CLAUDE.md` prometia "concede/revoga" e o servidor sempre limitou o credenciado ao que ele mesmo originou. Zero mudança de comportamento; a cláusula 3.5 ganhou o sujeito que lhe faltava.
- **Alternativas rejeitadas:**
  - *Só consertar o `title` do selo, sem tocar no payload*: fecharia a mentira e não distinguiria nada. O que a pessoa precisa saber não é que o recurso é privado, é se ela ainda o terá amanhã, e essa pergunta só a procedência responde.
  - *Notificar por e-mail quem recebeu uma concessão*: o eixo de ATLAS já enfrentou essa escolha e o dono decidiu selo, não e-mail (`frontend/src/js/projects/shared-atlas-badge.js`). A mesma decisão vale aqui, e o inventário por beneficiário é mais forte que a notificação: ele responde também "o que eu tenho hoje", que o e-mail nunca responde.
  - *Estender o aviso de camada também a 3D e 360*: tileset do Cesium e visualizador 360 não passam pelo `error` do MapLibre, então seria mecanismo novo em cada um. Ficam registrados, não esquecidos.
  - *Alargar o servidor para o credenciado revogar qualquer concessão do recurso*: é mudança de produto, não de texto, e desfaria a forma do gate que interessa preservar (o ramo largo pergunta por UM papel, o estreito por AUTORIA, então papel novo entra por `granted_by` sem ninguém editar o arquivo).
- **Consequências, e as três primeiras foram achadas MEDINDO, não lendo:**
  - **Renovar tem um orçamento de UM ANO por linha, contado do NASCIMENTO, e isso é decisão de produto que ficou em aberto.** A instrução dada foi "reuse o `LEAST` do INSERT"; ela é impossível e copiá-la produz erro de constraint. O teto da casa no INSERT é `NOW() + 1 ano`, mas num UPDATE ele tem de ser `created_at + 1 ano`, porque `resource_grants_expires_at_check` ancora as DUAS pontas em `created_at`, e um CHECK ancorado no relógio ficaria falso amanhã e travaria qualquer update naquela linha. Consequência: uma concessão com onze meses de vida só estica por mais um mês. Renovação plena exigiria alargar o CHECK, que é DDL destrutiva; **não foi feito**.
  - **São QUATRO eixos de autorização a recurso privado, não três.** O produtor vê o privado da própria OM sem concessão nenhuma (`fn_can_produce_resource`). Ele foi absorvido dentro de `papel` porque tem a propriedade que a tela usa (é fato de quem a pessoa é, estável à troca de atlas), com o ponto de extensão nomeado no enum caso a tela precise separá-los depois.
  - **O achado M5 vivia em TRÊS buscas de pessoa, e o relatório descrevia uma.** As duas irmãs (`modals/sharing.modal.core.js` e `modals/create-atlas.modal.js`) carregavam o mesmo `results.length ? ... : ''`, que torna INALCANÇÁVEL o "Nenhum usuário encontrado" e faz o `catch` da busca cair na mesma caixa em branco. Elas escaparam de quatro auditorias porque o relatório que achou o defeito foi escrito sobre o eixo de RECURSO, e elas são do eixo de ATLAS.
  - **`LIST_VISIBLE_PRIVATE_360` devolvia a linha CRUA**, então acrescentar as colunas de procedência ao SELECT teria vazado `por_papel_global` e as irmãs para dentro de cada item do payload. A projeção virou lista explícita de campos, com caso que a prende.
  - **O braço de papel global do predicado não tinha vermelho a produzir.** Substituindo `fn_has_global_data_access` por `false`, o administrador continuava verde, porque `fn_can_produce_resource` tem ramo de admin. Só o CREDENCIADO discrimina aquele braço, e ele precisou entrar na fixture para o controle negativo existir.
  - **A queda silenciosa do basemap não chega por evento nenhum.** Quando o basemap pedido não resolve para estilo, `switchLayer` troca para outro e só escreve `console.warn`: nenhum `error`, nenhum tile falho, nada que o painel novo pudesse pegar. Ela passou a acusar, e é o único ponto do produto que pode NOMEAR a camada sem mentir, porque quem pediu ainda está na variável antes da reatribuição.
  - **A escada de prazos deixou de ser um `const` privado do modal.** Com a segunda tela que estende prazo, duas cópias fariam "90 dias" valer coisas diferentes em duas telas do mesmo produto, e só quem comparasse as duas veria.
- **Pendências DECLARADAS, que sobrevivem ao relatório porque ele foi apagado:**
  - **O prazo no CARTÃO do catálogo** (a metade barata do A2) não tem dado: o payload de recursos visíveis não carrega vencimento, e a projeção do 360 virou lista explícita de campos, então ele não chega nem por acidente. Falta um mapa `expirations` ao lado de `origins`. **RESOLVIDO em 2026-08-24, e esta linha estava ERRADA em dois pontos.** Ela pedia o `expires_at` da concessão viva de MENOR prazo: é o oposto do certo. Concessão é disjuntiva (direta e por grupo, de concedentes diferentes), e o acesso sobrevive enquanto QUALQUER uma estiver viva, então o menor anunciaria o sumiço numa data em que o item demonstravelmente continua lá. O custo não seria o susto: seria a pessoa aprender que o chip mente e ignorá-lo no dia em que ele estiver certo. Vale o MAIOR. E acesso por PAPEL não vence nunca, então ali `expirations` é nulo por construção, reusando a precedência de `origins`. O caminho do ponto de pouso também estava errado: é `frontend/src/js/catalog/components/catalog-card.js`.
  - **A CONTAGEM de atlas que emprestam um recurso** (o número do M3) exigia rota nova, e ela nasceu em 2026-08-24 (`GET /:type/:id/lending-atlases`, gate `requireResourceShare`, corpo `{ count }` e nada mais, porque QUAIS atlas usam o recurso é fato sobre projetos de terceiros). **Duas coisas que esta linha e o enunciado que a citou erraram:** são DOIS censos que cobram rota nova, não três, porque `auditoria-censo` varre só verbos de ESCRITA e recusa ativamente uma entrada de GET (medido, não deduzido); e "com auditoria" é inexequível hoje, porque `audit_trail.action` não tem nenhuma ação de LEITURA e reusar uma de escrita gravaria afirmação falsa. A ausência está declarada na rota. O texto original dizia: `atlasesLendingResource` existe, mas é interna, sem gate e sem auditoria, criada só para endereçar sala de WS. A frase da tela ficou completa e QUALITATIVA, e ela assere não conter dígito, justamente para não fabricar aritmética.
  - **A falha do DOCUMENTO do estilo do basemap não foi ligada**, e deliberadamente. A rejeição de `switchLayer` não distingue "o estilo falhou" de "o diff era vazio", e o segundo é rotineiro neste repositório (dois basemaps apontam para objetos idênticos), então ligar o aviso ali acusaria FALSAMENTE a cada troca. Acusação falsa é pior que silêncio: ela ensina a ignorar o painel inteiro.
  - **Produtor e administrador não ganharam a aba Concessões.** Os dois têm a trilha de auditoria, que cobre os atos de concessão DELES; ela não responde o que eles RECEBERAM. A meia-cobertura está escrita no `fileoverview` da aba, em voz alta.
  - **Nada foi verificado em CAPTURA.** Seis agentes escreveram em paralelo, e a camada que exercita UI é o Playwright, que ficou fora deste lote. Tudo aqui é leitura de código, teste em node e as três pernas do `npm test`.
- **Status:** aceita e implementada. O relatório foi dissolvido.

### 2026-08-24: as quatro decisões do perfil DESLOGADO, e o último relatório de UX é dissolvido

- **Contexto:** o quinto e último dos relatórios de UX por perfil, o do visitante anônimo (incluindo
  quem chega por link público de atlas). É o perfil do primeiro acesso e o único que chega por um
  link em vez de por uma escolha. Vinte e um achados em vigor: quatro altos, sete médios, dez
  baixos, nenhum crítico. A baixa mecânica contra `34828b9b` e `71390ffd` (interseção de 107
  arquivos tocados com 41 citados, seis arquivos) não fechou nenhum achado inteiro e encolheu dois:
  A4 passou de uma superfície acusada para três, e B9 perdeu a premissa, porque a frase do catálogo
  vazio já distinguia "filtrado até o vazio" de "vazio de verdade".
- **Decisão, em quatro perguntas ao dono:**
  1. **A tela sem servidor ganha a frase que tranquiliza E a metade local passa a ser alcançável.**
     Em `atlas.html`, o `GET /api/config` falhado deixa de virar a tela de bloqueio: a seção "Neste
     computador" desenha, porque `loadLocalAtlases` nunca tocou a rede. O mapa continua fail-fast.
  2. **A dose de sinal no mapa é faixa no visitante público mais frase no atlas local**, e nada de
     convite ao servidor. Isso responde P5 e RECUSA o achado M1 por decisão de produto: o mapa é o
     produto de quem não entrou, e encher a tela de convite contradiz isso.
  3. **3D e 360 passam a acusar no mesmo painel de camada que não desenha**, apesar de não passarem
     pelo evento de erro do MapLibre. Eram as duas últimas superfícies mudas para quem não tem via
     de diagnóstico nenhuma.
  4. **Este lote é verificado por captura do Playwright**, fechando a lacuna que os quatro lotes
     anteriores declararam.
- **Alternativas recusadas, com o porquê:**
  - *Fazer o mapa abrir atlas local sem servidor.* É a terceira opção da pergunta 1 e desfaria o
    fail-fast, que é decisão declarada. O preço fica NOMEADO na tela ("abrir um deles no mapa só
    volta a funcionar quando o servidor responder") em vez de a pessoa descobrir batendo no bloqueio.
  - *Trocar o gate de `AtlasNameControl` de `isAuthenticated()` para atlas conectado.* Era a
    alternativa barata para A2 e não carrega a SAÍDA, que é a metade que o visitante precisa.
  - *Distinguir 403 de 404 no link público morto.* Já recusada e reafirmada: reconstruiria no
    cliente o oráculo de existência que a cláusula 5.6 fecha no servidor.
  - *Omitir ou desabilitar "Excluir" no último atlas local*, que era a correção que o próprio
    relatório propunha para M10. Ser o único atlas é ESTADO reversível, então o comando continua
    desenhado e o clique recusa nomeando o estado, com `aria-disabled` e nunca `disabled`. O
    relatório propôs contra a constituição, e a constituição venceu. O mesmo vale para o teto de
    dez (B2), cujo comentário de recusa a desabilitar foi preservado intacto.
  - *Fundir num módulo só as duas frases sobre onde o trabalho local mora* (a da aba Mapas e a de
    `atlas.html`). Têm sujeito e ação de fecho diferentes; uma frase única pioraria as duas telas.
- **Consequências medidas, e as que contrariam a intuição:**
  - **O modelo 3D tem DOIS caminhos de falha, e o segundo é o silencioso.** A raiz que rejeita
    propaga até um `catch` e carrega o código HTTP no `RequestErrorEvent` do Cesium; mas a raiz que
    responde 200 com TODOS os filhos `.b3dm` recusados não rejeita nada, não lança nada, e a cena
    fica simplesmente vazia. O único canal é o evento `tileFailed`, cuja mensagem é uma STRING
    (`Request has failed. Status Code: 403`), medida no bundle vendorizado. É exatamente a forma que
    um modelo privado emprestado toma para um visitante de link público.
  - **A acusação de 3D e 360 é retirada quando o recurso é PEDIDO DE NOVO, não quando ele carrega.**
    Uma raiz que carrega não diz nada sobre os filhos, então "abriu" não é prova de que desenhou.
  - **`style.load` deixou de retirar as acusações dessas duas superfícies** (`rebuiltByStyle:
    false`): trocar de basemap não re-pede nenhum dos dois motores, e a fiação ingênua teria feito
    uma troca de basemap apagar um aviso ainda verdadeiro.
  - **O painel é invisível enquanto qualquer dos dois visualizadores está aberto**, porque ele mora
    no container do mapa e os dois escondem esse container. Ele é o que a pessoa lê AO VOLTAR, e é
    por isso que o 360 ganhou também um toast, redigido a partir da mesma função de frase para que
    painel e toast não divirjam.
  - **O rótulo do chunk continua não predizendo o conteúdo.** `model3d-failure.js` caiu num arquivo
    chamado `cesium-integration`, o que parecia arrastar o motor para o payload eager; medido, os
    chunks com esse nome pré-carregados pelo `index.html` somam 75 kB, porque `entriesAware`
    subdivide o grupo e os 4,5 MB do Cesium são VENDORIZADOS, fora do bundle.
  - **Criar, renomear, copiar e excluir atlas local funcionam inteiramente sem backend** (é
    IndexedDB puro), o que é o que torna a decisão 1 barata. Só ABRIR precisa do servidor.
- **O que fica declarado e NÃO foi fechado:**
  - **Existe um sítio destrutivo que reivindica o tab-lock SEM testemunha, e não é o que a
    documentação acusava.** O JSDoc de `acquireTabLock` culpava a abertura de link público, que na
    verdade passa testemunha desde que o quarto sítio foi ligado; quem pede sem ela é
    `AccountControl.saveLocalToServer`, uma linha antes de um wipe. A prosa foi corrigida e o sítio
    vivo, NOMEADO e censado por teste; o furo continua aberto, porque fechá-lo é mudança de
    comportamento num caminho de concorrência e merece repro próprio.
  - **Duas contagens vizinhas do mesmo cabeçalho continuam erradas** (a seção 5 de
    `frontend/src/js/utilities/tab-lock.js` diz "quatro" e enumera outro conjunto, e afirma como
    universal um "todo `clearAllDataStore` é precedido de `acquire`" que tem cinco contraexemplos).
    Mesma classe do B10, lote próprio.
  - **Há um TERCEIRO visualizador com caminho de carga silencioso**, o de primeira pessoa
    (Gaussian splatting), cujo `catch` é um `console.error`. O dono nomeou dois motores; este fica
    declarado, não consertado.
  - **Uma foto 360 que desenha COM BURACOS continua muda.** A falha de um tile isolado é engolida
    dentro de `frontend/src/js/street_view_tool/tile-loader.js`, que é cópia declarada de outro
    repositório com cinco trechos de adaptação; acusar dali criaria um sexto.
  - **A cláusula 10.1 segue pendente.** A mitigação conserta a mentira, nunca o acesso.
- **O que a CAPTURA achou, e teste nenhum acharia:** a faixa nova cobria a linha de chips do
  mapa, e o painel de camada que não desenha disputava a mesma faixa de topo. Cada peça estava
  certa sozinha e as asserções estruturais passavam verdes; o conflito só existe com as três
  montadas na mesma tela. A altura de partida virou `--visitor-banner-top`, variável única de
  onde saem as três regras dependentes, com o motivo da escolha escrito ao lado. A recusa de
  M10 foi confirmada de ponta a ponta: o item é desenhado, fica `aria-disabled`, e o clique
  entrega a frase que nomeia o estado.
- **Status:** aceita e implementada. O relatório foi dissolvido, e com ele a série dos cinco.

### 2026-08-24: o backlog de testes vira 98 defeitos reais, e três formas atravessam o repositório

- **Contexto:** fechadas as pendências dos cinco relatórios de UX, o dono mandou fazer "todo o resto,
  inclusive o `TESTING-BACKLOG.md`". Aquele inventário tinha 28 domínios, cinco concluídos, e
  descrevia por símbolo o risco e os edge cases apurados por leitura. O trabalho foi feito em três
  ondas de agentes com propriedade exclusiva de arquivo: escrever teste medindo o comportamento
  REAL, marcar o defeito sem consertá-lo, e consertar numa onda seguinte com controle negativo.
- **Decisão:** cobrir os 23 domínios abertos, consertar todo defeito achado, e tratar cada linha do
  backlog como HIPÓTESE em vez de achado. Toda tarefa levou uma seção obrigatória "o que contradiz o
  enunciado".
- **O que isso rendeu, e o número é a parte menos interessante:** cerca de 4400 casos novos e **98
  defeitos reais de produto**, todos consertados ou registrados como decisão. O backlog foi refutado
  cerca de **trinta vezes**, e nenhuma das refutações era descuido dele: todas são leituras
  plausíveis do código que não sobreviveram à execução.
- **TRÊS FORMAS atravessaram o repositório, e nenhuma seria achada lendo arquivo por arquivo**,
  porque em cada sítio ela parece decisão local:
  - **`valor || padrao` engolindo o zero legítimo**, em NOVE domínios, com sintomas que não se
    parecem entre si: opacidade 0 desenha opaca, `maxzoom` 0 aparece em todo zoom, exagero de
    terreno 0 devolve 53,33 em vez de terreno plano, `labelCreatedAtZoom` 0 reescreve a âncora de
    toda etiqueta nunca reancorada, `layerId` 0 faz setas de camadas diferentes passarem pelo
    portão de mesma-camada. São 261 ocorrências da forma na árvore, e por isso a saída é CENSO com
    motivo por sítio, nunca varredura cega, que seria churn.
  - **Lookup por `TABELA[chave]` com chave vinda de fora**, em três sítios. O pior devolve `true`,
    grava o estado e EMITE o evento para o nome `'constructor'`.
  - **`if (x < 0) x += 360` devolvendo 360 exato**, em quatro sítios de azimute. A pior consequência
    não é rótulo: em `generateArcCoordinates` o arco desenha a circunferência inteira. Fechado por
    censo de forma (`frontend/tests/unit/azimute-nunca-devolve-360.test.js`), com a única ocorrência
    legítima declarada e medida como mutante equivalente.
- **Os defeitos que saem em papel ou apagam tela**, para registro: o rótulo da folha do PDF imprimia
  `43°11'60"W` (10 de 12 rótulos errados num tile a 1:250.000); o conversor de coordenadas escrevia
  zona UTM **61** no antimeridiano e não conseguia reler o que escrevia; os três placeholders da
  caixa de coordenada apontavam para três lugares diferentes; uma feição malformada apagava a busca
  de um mapa inteiro em silêncio; `calculateLOS` com amostragem não-finita reportava uma montanha de
  5000 m como "tudo visível", que é o modo de falha errado numa ferramenta de análise militar.
- **Alternativas recusadas, com o porquê:**
  - *Consertar as 261 ocorrências de `|| numero`.* A maioria é legítima (0 mapeia para o mesmo
    resultado, ou não é valor de domínio). Censo com motivo escrito, não varredura.
  - *Consertar o antimeridiano do snapping.* Foi escrito, medido e **revertido**: tomar o arco menor
    sempre que `|Δlng| > 180` quebra uma aresta de 200 graus que `queryRenderedFeatures`
    legitimamente devolve em zoom baixo, e os dois casos são indistinguíveis só pelas longitudes. O
    teatro é o Brasil; a troca é ruim. Fica a medição escrita no arquivo.
  - *Consertar funções sem chamador por simetria.* A varredura de chamadores mudou dez decisões:
    `simplifyLine`, o `getBoundingBox` do pincel e o cluster inteiro de `add_occupied_front_geometry`
    não têm chamador. Consertou-se onde não havia irmã viva de que divergir; deixou-se onde havia.
- **A prática que mais rendeu, e ela é de método:** a seção obrigatória "o que contradiz o enunciado"
  pegou cerca de trinta afirmações erradas, minhas e do backlog. A razão é estrutural: quem escreve o
  enunciado carrega as próprias premissas para dentro dele, e um agente que as aceita produz trabalho
  errado com APARÊNCIA de trabalho conferido.
- **Status:** aceita e implementada. O `TESTING-BACKLOG.md` deixa de ser inventário de leitura e
  passa a ser registro do que foi medido.

### 2026-08-25: o antimeridiano do snapping é NÃO-OBJETIVO, e as duas peças do mil-symbol saem para módulos folha

- **Contexto:** os dois itens que sobraram do `TESTING-BACKLOG` depois do lote de 2026-08-24. Um é
  um defeito medido que ninguém vai consertar; o outro é uma extração que estava listada há meses.
- **Decisão 1: o antimeridiano do `interpolateLngLat` (`snapping/snapping.service.js`) NÃO SERÁ
  CONSERTADO, e isso é declarado, não adiado.** O comportamento é real (um segmento de 179 a -179
  gruda em Greenwich, porque o `t` vem da geometria em PIXELS e é aplicado numa diferença crua de
  358 graus), e continua fixado por teste para ser ESTÁVEL, não para cobrar conserto.
  - **Por que fechar em vez de deixar pendente.** O conserto barato foi escrito, medido e revertido:
    tomar o arco menor sempre que `|delta| > 180` quebra um caso que a suíte já prendia, cuja aresta
    (`[-100,9]` a `[100,9]`) tem 200 graus e passa a grudar em -180. `queryRenderedFeatures` devolve
    segmentos legitimamente mais largos que 180 graus em zoom baixo, e os dois casos **não se
    distinguem só pelas longitudes**: distingui-los exige os extremos PROJETADOS, que aquele
    ajudante não recebe. Ou seja, o conserto correto não é uma guarda ali, é **alargar a assinatura
    no chamador**, que já tem os extremos projetados porque os usa para calcular o `t`.
  - **Por que não vale o custo.** O teatro de operações é o Brasil, a uns 130 graus da linha de
    data, então o defeito é inalcançável em uso; o conserto barato é regressão medida; e o conserto
    correto alarga uma interface no caminho quente de um handler de `mousemove` para comprar nada.
  - **A pergunta que um leitor vai fazer, respondida no arquivo:** por que os OUTROS antimeridianos
    desta mesma leva foram consertados (a caixa de `data-layers.manager.js`, o bearing do setor e da
    visibilidade). A diferença não é rigor, é custo: aqueles eram guardas dentro de UMA função,
    este é uma interface.
- **Decisão 2: as duas peças do `mil-symbol` que o backlog pedia saem para módulos folha**, que era
  a única forma de alcançá-las sem browser.
  - **`text-modifiers-mapping.js`** (zero imports) recebe `extractTextModifiers`, que era `function`
    sem `export` dentro de `military_symbol_generator.js`, cujo grafo puxa o carregador do milsymbol
    e a conversão para PNG por canvas. Ela é o ÚLTIMO passo antes de a biblioteca de terceiro
    desenhar, e o que ela tem de não-mecânico virou contrato: os catorze campos diretos, os DOIS
    renomeados (`dateTimeGroup` para `dtg`, `credibility` para `evaluationRating`, o campo combinado
    J+K), e **o filtro que admite ZERO**. Esse último é o ponto: a guarda já era
    `!== null && !== undefined && !== ''` e não `if (value)`, ou seja, uma quantidade de 0 sobrevive.
    Foi a única das dezenas de ocorrências dessa família que já estava certa, e agora está presa
    contra uma "simplificação" futura.
  - **`engagement-bar-codec.js`** (zero imports) recebe o par `encode`/`decode` da barra de
    engajamento, que eram DUAS closures dentro de um construtor de DOM: a codificação num ouvinte de
    `change`, a decodificação pendurada no elemento devolvido. O risco não era nenhuma das metades,
    era elas precisarem ser INVERSAS sem que nada checasse. O round-trip agora é propriedade de
    fast-check sobre o vocabulário real das duas tabelas.
  - **Um defeito achado ao extrair, e consertado:** a decodificação fazia `split('-')` e pegava as
    duas primeiras partes, então um armamento com hífen perdia tudo depois do segundo em silêncio
    (`TGT-A-B` voltava como `TGT` + `A`). O corte passou a ser o PRIMEIRO, e o armamento fica com os
    hífens dele.
  - **Duas ambiguidades ficam declaradas e não guardadas**, porque são do FORMATO e não do código:
    um ESTÁGIO com hífen não sobrevive à volta (o corte é sempre o primeiro), e um valor que comece
    com `R:` é indistinguível do prefixo de designação remota. As duas são inalcançáveis pelos
    catálogos de hoje, o que é o que as torna observação em vez de defeito, e guardá-las exigiria um
    escape que os dados já persistidos não têm.
- **Alternativa recusada:** exportar `extractTextModifiers` do próprio gerador em vez de mover. Não
  resolveria: o teste continuaria carregando o grafo do milsymbol e do canvas para exercitar uma
  função pura.
- **Status:** aceita e implementada. Com isto o `TESTING-BACKLOG` fica sem alvo de Fase 1 aberto.

### 2026-08-25: o id do atlas local sobe preservado quando está livre, e recunhado quando está ocupado

- **Contexto:** o chefe apagou vários atlas, que foram para a lixeira, e depois não conseguiu criar
  de novo: `POST /atlas/import` respondia "Resource already exists". A suspeita dele apontava a
  lixeira. **Medido por API:** o id de feição vindo de atlas NA LIXEIRA recusa, o id vindo de atlas
  VIVO recusa igual, e o id inédito passa. Logo a lixeira é onde o defeito apareceu, não a causa.
- **A causa:** `features.id`, `layers.id`, `groups.id`, `briefings.id`, `slides.id`, `maps.id` e as
  duas tabelas de 3D/360 são chave primária GLOBAL, sem escopo de atlas, e o empacotador do cliente
  (`local-atlas-to-server.js`, `makeIdMapper`) PRESERVA o id local quando ele já é um UUID. Logo o
  reenvio do mesmo atlas local colide SEMPRE, com ou sem lixeira, e dois usuários que enviam cópias
  do mesmo arquivo colidem entre si.
- **Decisão: preserva quando livre, cunha na colisão, e a decisão mora no SERVIDOR**
  (`atlas.service.js`, `cunharIdsOcupados`). Uma consulta cobre as oito superfícies, então o custo
  do import continua constante no número de linhas.
- **Alternativa recusada 1: cunhar id novo para tudo na importação.** Quebraria
  `frontend/tests/e2e-ui/browser-save-local-to-server.spec.js`, cujo guarda VERDE acha no servidor a
  feição desenhada no cliente pelo mesmo id. A preservação é deliberada e tem dependente.
- **Alternativa recusada 2: purgar de verdade o que vai para a lixeira.** Proibida pela cláusula 7.4
  da `CONSTITUICAO.md` (lixeira restaurável COM conteúdo, presa por `atlas-restore-integrity`), e
  ainda por cima não resolveria o caso do atlas VIVO.
- **A exceção, e ela é no CLIENTE: o blob de imagem.** `images.id` também é global, mas o blob sobe
  DEPOIS do import, então um id recunhado lá deixaria pendurada a referência já gravada na feição.
  `save-local-atlas.service.js` cunha o id do blob antes de montar o payload e reescreve as
  referências pelo `imageIdMap` que a função pura já aceitava.
- **Recusa legítima nova, com frase própria em português:** id repetido DENTRO do arquivo é arquivo
  inconsistente, não colisão com o banco, e vira 400 com "O arquivo repete o id de ...".
- **A porta irmã foi fechada no mesmo dia:** `frontend/src/js/projects/send-local-to-server.service.js`
  (envio pelo cartão da lista) subia blob numa passada só, e um reenvio com imagem entrava com a
  imagem sumida, sem erro. As duas portas são leitores diferentes do mesmo formato de disco, e essa
  duplicação já tinha custado outro defeito no mesmo dia (a camada padrão que não subia), então a
  regra vale nas duas ou não vale. O caso que a prendia dizia "sobe a imagem PRESERVANDO o id local",
  premissa que virou o defeito escrito como contrato; ele passou a medir a CONCORDÂNCIA entre o id
  que sobe e o id que o payload cita, que é o que não pode divergir.
- **Status:** aceita e implementada. Cláusula 7.2.1 nova em `CONSTITUICAO.md`. Presa por
  `backend/tests/integration/import-id-ja-usado.repro.test.js` e
  `frontend/tests/unit/enviar-blob-com-id-novo.test.js`.

### 2026-08-27: o link de compartilhamento ganha a quarta superfície, e a PENDENCIA da raiz é dissolvida

- **Contexto:** a pergunta do dono em 2026-08-26 era se os links de 360 e de 3D ainda funcionavam
  depois da integração com o backend, e como fazer um para o mapa principal. Medido em vez de
  deduzido: a mecânica passava (4 de 4 em `frontend/tests/e2e-ui/deep-link.spec.js`), e uma sonda
  temporária de boot ANÔNIMO provou que recurso público chega ao visitante deslogado, com o
  metadado do 360 respondendo 200 e o visualizador abrindo. O escopo real do pedido saiu de uma
  segunda pergunta dele: o alvo é recurso PÚBLICO, então nada disto depende de atlas.
- **Decisão: uma quarta gramática, `#view=base`, e a família inteira vira contrato congelado entre
  VERSÕES.** As regras (chave só aditiva, ausente cai no padrão e nunca no zero, desconhecida se
  ignora calada) e a razão de os vetores serem escritos à mão estão em
  [[sintese-contratos-congelados]]. Feito nos DOIS branches, com os mesmos vetores dourados, porque
  é a duplicação deles que faz a promessa ser verificada em vez de afirmada.
- **A ordem de boot é a diferença entre os dois pacotes**, e ela está em
  [[sessao-boot-e-ciclo-de-vida]]: aqui a vista 2D é adiada até a pintura terminar, no outro branch
  o `switchMap` já roda antes.
- **Defeito irmão consertado de passagem:** os três construtores antigos montavam a URL a partir de
  origem e caminho, então a query morria. Medido com a query presente na entrada. Agora os quatro
  passam pelo mesmo helper.
- **Status:** aceita e implementada. `frontend/tests/unit/deep-link-gramatica.test.js`,
  `frontend/tests/unit/deep-link-construtores.test.js`,
  `frontend/tests/unit/deep-link-vista-compartilhada.test.js` e
  `frontend/tests/unit/deep-link-vista-adiada.test.js`, os três primeiros idênticos aos do outro
  branch. Três controles negativos rodados: devolver a origem+caminho reprova o caso da query,
  renomear a chave `base` no leitor reprova cinco casos, e tirar o despacho do tipo `base` reprova
  cinco do abridor.

**O documento de pendência da raiz foi APAGADO neste commit, e não marcado como resolvido.** Ele
seguiu o precedente do `PENDENCIAS-INTEGRACAO-MAIN-360.md` de 2026-08-21: o durável foi para a wiki,
e o que continua ABERTO fica aqui, porque documento de trabalho pendente é o que mais depressa perde
sincronia e conferir código contra ele confirma frase falsa com ar de verificação. As quatro dívidas
que sobreviveram:

1. **O ESPAÇO DE ID DO 3D, e é o risco.** No outro branch o catálogo vem do serviço ebgeo_3d e o id
   do link é o que aquele serviço publica; aqui ele vem da tabela de tilesets, cuja chave primária é
   texto escolhido no cadastro (`backend/src/database/migrations/005_catalogo.sql`). Nada no
   repositório garante que a carga preservou os ids antigos. Se não preservou, todo link 3D já
   distribuído morre na virada, em silêncio, com a mensagem de modelo não encontrado. Resolve-se com
   uma MEDIDA e não com uma opinião: listar os ids que o serviço publica em produção, listar os da
   tabela, comparar. Se divergirem, o conserto é um mapa de id antigo para id novo consultado quando
   a busca direta falha, e ele precisa nascer junto com o link, nunca depois.
2. **O nome da foto 360 é PROVÁVEL, não medido.** Os dois branches emitem `currentPhotoName`. Falta
   confirmar que o `original_name` do acervo ingerido é igual ao nome de arquivo que a versão
   estática servia. A camada base é o único dos três eixos MEDIDO: as cinco chaves apareceram
   idênticas no config do visitante anônimo.
3. **O escopo de atlas não alcança o deep link.** `handleDeepLink` roda dentro do manipulador de
   `load`, e quem declara o escopo é `refreshVisibleResources`, chamado na conexão do
   `frontend/src/js/store/sync/sync-engine.js`, depois. Medido: com sessão viva e o parâmetro de
   atlas na URL, o pedido do 360 saiu sem ele, então o ramo de empréstimo de
   `backend/src/modules/streetview360/sv360.service.js` morre e o recurso emprestado volta 404. Não
   morde recurso público, que é o caso de hoje; morde no dia em que alguém pedir link de recurso
   privado. Preservar a query nos construtores foi metade do conserto; a outra metade é de ORDEM.
4. **"Abrir link não escreve" está implementado e NÃO tem teste próprio.** Os casos existentes
   afirmam que `applySharedBasemap` foi chamada, e o `skipPersist` mora dentro dela. Falta o caso
   que afirma que a fila de saída não ganhou op de camada base, com o controle negativo de trocar
   por `setBaseLayer`.

### 2026-08-28: o cursor sai em lote por sala, e o limite de sala vai de cinquenta para duzentos

**Decisão.** O servidor deixa de retransmitir cada quadro de cursor e passa a emitir, a cada
`WS_CURSOR_BATCH_MS`, UM lote por sala com a última posição de cada `clientId`. O tipo no fio muda
de `cursor` para `cursors`, e o remetente passa a receber o próprio eco, que o cliente descarta.
**Entra LIGADO**, com 100 ms.

**A compatibilidade não é retroativa, e a escolha foi deliberada.** Cliente antigo contra servidor
novo simplesmente para de ver cursor, sem erro nenhum, que é o modo de falha mais silencioso que
existe. O branch `integracao_backend` não está em produção, e os dois pacotes são versionados
juntos neste repositório: por isso o padrão reflete o comportamento pretendido em vez de esconder a
capacidade atrás de uma variável. `WS_CURSOR_BATCH_MS=0` reverte sem novo deploy de código.

**O custo que ela ataca, medido.** A sala é `atlasId -> Set<WebSocket>` sem subcanal, então cada
quadro virava uma escrita em socket por par: `S x f x 12,5 x (S-1)` por segundo, porque o throttle
do cliente é de 80 ms. A bancada E9 mediu a sala de 200 pedindo 246.302 quadros/s e o servidor
entregando 46.436; a de 400 pedindo 971.086 e entregando os mesmos 46 mil. Acima do teto o servidor
gasta CPU decidindo descartar, e a escrita paga junto.

**O resultado, na mesma bancada, contra a linha de base de 2026-08-27:**

| sala | ackP50 antes | ackP50 depois | CPU antes | CPU depois | derrubados |
|---|---|---|---|---|---|
| 100 | 3.844 ms | **17 ms** | 84,8% | **22,2%** | 0 → 0 |
| 200 | 84.961 ms | **34 ms** | 87,0% | **44,3%** | **147 → 0** |
| 400 | 67.955 ms | 89.344 ms | 90,7% | 83,0% | **371 → 0** |

A sala de 200 saiu de quebrada para saudável, com fator de 2.500 no ack. A de 100 ficou
indistinguível da de 50, que era o critério de aceitação. **O limite operacional de sala sai de
cinquenta para duzentos.**

A previsão bateu: a sala de 400 passou de 971.086 escritas em socket por segundo para cerca de
4.000, ou seja 400 sockets vezes 10 lotes.

**Três escolhas de desenho, e as três seriam fáceis de desfazer por engano:**

1. **O remetente recebe o próprio eco.** O ganho vem de serializar UMA vez por sala; excluir cada
   remetente exigiria um payload por destinatário, que é exatamente o custo a eliminar. Quem
   descarta é o cliente, pelo `clientId`, como já faz com operação
   (ver `client-id-estavel`). Reintroduzir a exclusão evapora o ganho.
2. **A chave do agrupamento é `clientId`, nunca `userId`.** Duas abas da mesma pessoa são duas
   presenças, e o registro da sala é indexado por `clientId`. Agrupar por usuário faria uma aba
   apagar a outra.
3. **O filtro do cliente compara `clientId` EXATO**, e não a metade de instalação que
   `_isOwnClientId` usa para operação. Pela instalação, o cursor da outra aba do mesmo navegador
   sumiria.

**O que ela NÃO resolve.** A sala de 400 continua com ack de 89 s. Ela deixou de ser limitada por
syscall e passou a ser limitada por carga útil: cada lote carrega até 400 posições, serializado uma
vez mas escrito 400 vezes. O próximo teto é outro, e não foi medido.

**Efeito colateral na régua.** Com o agrupamento ligado, a coluna de perda de cursor da bancada
deixaria de medir descarte e passaria a medir coalescência: a fórmula antiga acusou 26,6% de
"perda" na sala de DEZ, que não tem congestionamento nenhum. O denominador passou a descontar o
teto do lote, e a coalescência ganhou coluna própria.

**Reversível sem deploy de código**, pela variável de ambiente, e o caminho antigo tem teste
próprio para que "desligado" não possa estar silenciosamente ligado.

**O que a virada do padrão custou nos testes, e o que ela revelou.** Oito pontos de espera em sete
arquivos afirmavam o formato antigo (`waitForType('cursor')`). Em vez de reescrever cada um para o
formato novo, o ajudante de teste ganhou `waitForCursor()`, que aceita os DOIS regimes: a intenção
daqueles casos nunca foi "chegou um frame do tipo X", e sim "o cursor do par chegou até mim".

E a virada expôs um **verde vazio** em `multiuser-session-e2e`: a asserção
`getMessagesOfType('cursor').length === 0`, comentada como "o remetente nunca vê a própria
presença", continuava passando depois da mudança porque o eco passou a chegar como `cursors`. Ela
aprovava sem verificar. Foi substituída por uma que afirma o contrato NOVO: o remetente recebe o
próprio cursor no lote, e filtra no cliente. `selection` continua excluindo o remetente, e essa
metade ficou guardada à parte.

---

### 2026-08-28: o import não-aditivo descarta os mapas do escopo antes da primeira escrita

- **Contexto:** abrir um `.ebgeo` pela tela de atlas cria um slot local novo, cujo boot semeia um mapa "Principal" em branco por `seedBlankDefaultMap`, chaveado pelo NOME. O import não-aditivo então grava os mapas do arquivo, e `addMap` os chaveia por UUID sempre que o log de operações está ligado, que é o padrão desde `initServices()`. Ficavam DOIS registros chamados "Principal". A lista de mapas de-duplica por nome e desenha um cartão só; `getMap('Principal')` acerta o em branco por lookup DIRETO, antes do resolver. Medido com `_ebgeo_dados_teste/01-completo.ebgeo`: as 18 feições do mapa "Principal" chegavam ao IndexedDB e ficavam fora do alcance da pessoa, nem pelo cartão nem pela busca (`linha de visada`, que só existe naquele mapa, devolvia "Nenhum resultado encontrado"). Sem erro em ponto nenhum. As outras 244 feições, em mapas de nome próprio, chegavam inteiras.
- **Decisão:** `discardMapsForReplacingImport` (`store/map.operations.js`), chamada pelo ramo não-aditivo de `handleImport` ANTES da primeira escrita, apaga por CHAVE de armazenamento todo registro de mapa que sobrou no escopo e limpa o resolver. O chamador guarda o caso vazio: um arquivo sem mapa nenhum não passa por ela, senão o escopo fica sem mapa para abrir.
- **Alternativas rejeitadas:**
  - *Apagar só o homônimo*: fecharia o sombreamento e deixaria o mapa em branco ao lado do projeto sempre que o arquivo não trouxesse um mapa com o nome padrão, que é ruído sem dono na lista.
  - *Fazer `addMap` remover o registro name-keyed de mesmo nome*: mais geral e mais arriscado. Aquele caminho é o mesmo que aplica op de par remoto, onde a colisão por nome tem outro dono (`activateAtlasInitialMap`) e outra regra.
  - *Não semear o mapa em branco no wipe*: o wipe é chamado por caminhos que NÃO importam nada em seguida, e sem mapa o app não tem o que abrir.
- **Consequências:** o slot importado passa a ter uma chave de armazenamento por mapa do arquivo (eram `maps + 1`), e a chave `Principal` não sobrevive ao import. Dois casos de `atlas-local-ebgeo-e-teardown.spec.js` afirmavam as doze chaves como se fossem desenho, com o comentário explicando a de-duplicação: os dois foram corrigidos no mesmo commit. A espera daquele arquivo passou a ancorar no toast de sucesso, que é a última linha do fluxo, porque ancorar no número de chaves de mapa media só a primeira etapa e deixava briefing, ícone e blob correndo contra escritas em voo (flake medido).
- **Guardas:** `frontend/tests/e2e-ui/atlas-local-ebgeo-e-teardown.spec.js` ganhou o caso "cada mapa do arquivo tem UM registro, e a leitura por NOME alcança o do arquivo", que compara a leitura por nome de TODOS os onze mapas com o que o arquivo declara (controle negativo medido: sem o conserto ele reprova nomeando `"Principal": 2`). A ORDEM (descartar antes de escrever) é presa em `frontend/tests/integration/import-ebgeo-atlas-local.test.js`, por `invocationCallOrder`, porque ela não se lê no resultado: rodando depois, o descarte apagaria o projeto que acabou de entrar.
- **O que NÃO foi feito, e por quê:** um atlas importado ANTES deste conserto continua com os dois registros, e o conserto não os repara. Um reparo automático no boot precisaria apagar registro de mapa em todo carregamento, e o gate seguro ("apague o name-keyed vazio quando um UUID-keyed tem o mesmo nome") é código destrutivo num caminho que roda sempre, para um estado que se desfaz reimportando o mesmo arquivo. A saída é reimportar.
- **Status:** aceita.

---

### 2026-08-28: a vivacidade do socket deixa de depender do temporizador da página

**Decisão.** `heartbeatSweep` (`backend/src/modules/collab/collab.gateway.js`) para de exigir o `{type:'ping'}` da aplicação como única prova de vida. Passam a rearmar `isAlive` duas coisas: **qualquer frame que chega** do cliente, e o **pong do PROTOCOLO**, que a varredura passa a solicitar por `ws.ping()`. O ping da aplicação continua existindo e continua rearmando; o que muda é ele ter deixado de ser o único.

**Contexto: dois defeitos opostos, os dois medidos, e nenhum dos dois se anunciava.**

1. **Sob saturação, a varredura era um DESCARTE DE CARGA acidental.** Numa rodada de bancada com mil usuários, 156 sockets caíram na rampa. A primeira explicação escrita foi de fome de pool (`reconcileAuthorization` falharia e fecharia com `4003`), e ela era **deduzida de ler o `catch` sem verificar se algo o alcança**. Três medidas a desmontaram: o pool não tem `connectionTimeoutMillis`, então ele espera em vez de lançar e o `catch` nunca roda; os códigos de fechamento, uma vez instrumentados, saíram **todos `1006`**, que é `terminate()` da varredura; e o laço do driver durante a rampa marcou p99 de 19 ms, ou seja os pings SAÍRAM no horário e quem não os processou a tempo foi o servidor, ocupado com o fan-out de presença. O mecanismo real: um cliente que manda doze quadros de cursor por segundo era, para a varredura, indistinguível de um cliente morto.
2. **A aba oculta era ceifada de forma determinística.** O cliente pinga a cada 25 s e a varredura roda a cada 30 s. Medido com sonda própria no Chrome, aba oculta por 17 minutos e socket aberto: o intervalo é de **25.000 ms exatos** por cerca de 5,6 minutos e depois trava em **60.000 ms**, em seis amostras consecutivas. O socket aberto **não** isenta a página, que era a dúvida do desenho. Com ping de 60 s contra varredura de 30 s o socket morre sempre: a varredura baixa a marca e a seguinte não encontra ping nenhum. Numa sala de 200, cada volta de aba esquecida virava rotatividade de presença para as outras 199.

**Alternativas rejeitadas.**

- *Subir o intervalo da varredura, ou baixar o do cliente.* Remendo dos dois lados. Aceitava que a prova de vida dependesse de um temporizador que o navegador tem o direito de estrangular, e pagava com socket morto ocupando memória e presença fantasma por minutos. Baixar o ping do cliente é **impossível**: o piso do estrangulamento é de um por minuto, e nenhum temporizador de página o vence.
- *Um pool dedicado para a varredura de autorização.* Era a ação planejada para o defeito 1, e a medida mostrou que a premissa dela estava errada. O conserto certo custou uma linha.

**O que a decisão CUSTA, e é a metade que não se lê no código.** A marca deixa de provar que o laço de JavaScript do par roda e passa a provar que a **conexão e o processo do navegador** estão vivos. Isso é o conserto, não uma perda (aba em segundo plano É uma página com o laço estrangulado, e matá-la era o falso positivo), mas quem escrever detecção de cliente travado a partir do heartbeat vai medir outra coisa.

**E o conserto do defeito 1 PIOROU um número, de propósito.** Ao parar de ceifar, o sistema deixou de remover 16% da população sob saturação:

| | antes | depois |
|---|---|---|
| derrubados na rampa | 156 | **0** |
| ackP50 sob saturação | 72 ms | **114.427 ms** |

Ou seja, ele **troca desconexão invisível por latência visível**. O custo medido contra a linha de base é **zero até 50 pessoas por sala**, e na de 100 o ack ia de 3.844 para 6.775 ms: o dano só existe onde o sistema já estava fora do limite, e o agrupamento de cursor da decisão irmã é que o tira de lá. Isoladamente, este conserto **não autorizaria** subir o limite de sala.

**Guardas:** `backend/tests/ws/collab-vivacidade-por-frame.test.js` e `backend/tests/ws/collab-vivacidade-por-protocolo.test.js`.

**Status:** aceita. Capacidade e o que continua aberto em [`../wiki/capacidade-de-uma-instancia.md`](../wiki/capacidade-de-uma-instancia.md).

---

### 2026-08-28: o lote de saída do cliente cai de cem para vinte e cinco, porque cem perdia nos dois eixos

**Decisão.** `FLUSH_BATCH_SIZE` (`frontend/src/js/store/sync/sync-engine.js`) vai de 100 para **25**.

**Contexto.** `pushOperations` serializa a escrita de um atlas por `pg_advisory_xact_lock`, e o serviço custa cerca de **1,26 ms por op**. A fila do enésimo escritor é `escritores x lote x 1,26 ms`, e cruza os 5 s do `lock_timeout` quando o produto passa de ~4.000 ops. Com lote de 100 isso são **40 escritores simultâneos no mesmo atlas**, e o modo de falha é ruim: uma pessoa cola ou importa muita coisa, e **os outros** levam a recusa 503.

**A medida, três rodadas** (bancada E2, `backend/tests/bench/escrita-lote.bench.mjs`):

| lote | ops/s | p50 por envio |
|---|---|---|
| 10 | 818 / 725 / 691 | ~89 ms |
| **25** | **968 / 773 / 752** | ~213 ms |
| 100 | 706 / 677 | ~1.095 ms |

Cem perdia nos DOIS eixos, o que torna a decisão fácil: a mudança melhora vazão E afasta o 503, sem troca. Entre 10 e 25 uma rodada não decidia (18% de diferença cabe dentro da banda de ruído de 20%), e foram precisas três para ver o sinal consistente. **O desempate veio de fora da bancada, e fica declarado como inferência:** 25 gera duas vezes e meia menos mensagens que 10 para o mesmo trabalho.

**O que NÃO muda.** O teto do servidor continua em 500 ops por lote (`backend/src/modules/sync/sync.schemas.js`), e os dois tetos seguem independentes: subir `FLUSH_BATCH_SIZE` acima de 500 faz todo push virar 422. Ver [`../wiki/envelope-operacao.md`](../wiki/envelope-operacao.md).

**Status:** aceita.

---

### 2026-08-29: o administrador transfere a OM dona de um recurso, por rota própria; e a aba Sistema perde dois controles

**Decisão.** Três mudanças no painel de administração, pedidas pelo dono.

1. **Nasce a transferência de OM dona de recurso de catálogo**, que a decisão de 2026-08-24 tinha mandado sair do TEXTO por não haver rota. Agora há: `PATCH /api/v1/<tabela>/:id/owner-org`, gateada por `requireAdmin` (`backend/src/modules/catalog/catalog.routes.js`), com serviço `transferCatalogItemOwner` e controller `transferOwner`. `owner_org_id` continua FORA do corpo das três escritas comuns (`papel-produtor-catalogo.test.js` segue afirmando isso); mover a linha é ato de sistema, em rota e chamada à parte, como a visibilidade. `owner_org_id: null` devolve ao acervo institucional. OM inexistente ou inativa é 400. A aba mostra um `<select>` de OM só para o administrador em modo edição; para o produtor e na criação o campo segue de leitura.

2. **A aba Sistema perde os controles do viewer 3D e o editor "Avançado (JSON)".** Os campos curados cobrem o que o administrador muda, e "Limpar todos os overrides" continua zerando tudo para o padrão do deploy.

3. **O hover do botão de sub-aba ativo deixa de ficar ilegível** (Pessoal e Catálogo): o `:hover` clareava o fundo do botão ativo sem trocar o texto branco. Agora o hover clareia só o botão inativo, e o ativo escurece o verde.

**A pergunta que a decisão de 2026-08-24 deixou aberta, respondida.** As concessões (`resource_grants`) originadas pela OM anterior **não são tocadas** pela transferência. Elas são por RECURSO (`resource_id`, `resource_type`), não por OM, então sobrevivem à mudança de dono e vencem pelo próprio prazo; a revogação continua por AUTORIA (`granted_by`), de modo que quem concedeu ainda revoga o que concedeu. O que muda é a MANUTENÇÃO: `fn_can_produce_resource` passa a casar a OM NOVA, então o produtor da OM anterior deixa de manter e de conceder de raiz aquele recurso, e o produtor da nova OM passa a poder. É o comportamento certo, porque manter segue a posse.

- *Auditoria:* reusa `CATALOG_UPDATE` com `details.transfer = true` e o de-para `fromOrgId`/`toOrgId`, em vez de cunhar uma ação CATALOG_TRANSFER, porque um valor novo no `CHECK` de `audit_trail.action` custaria migração de constraint (destrutiva). `target_org_id` é a OM NOVA.

**Guarda:** `backend/tests/integration/papel-produtor-catalogo.test.js` (caso "a ROTA PRÓPRIA (PATCH /:id/owner-org) transfere, e só o administrador a alcança"): produtor 403, administrador 200 de A para B e de volta ao institucional, OM inválida 400, id inexistente 404.

**Status:** aceita. **Supera** a parte da decisão de 2026-08-24 que mandava a transferência sair do texto.

---

### 2026-08-29 (tarde): auto-cadastro vira toggle de runtime; a "Ordem" do catálogo sai; a config de recurso vira campos

**Decisão.** Três mudanças no painel de administração, pedidas pelo dono.

1. **Auto-cadastro é um TOGGLE de runtime.** A rota `POST /auth/register` deixou de ser montada-ou-não no boot pelo env `ALLOW_SELF_REGISTRATION` e passou a ser sempre montada, gateada por `requireSelfRegistrationEnabled` (`backend/src/modules/auth/register-gate.js`), que lê a config EFETIVA (`features.self_registration`) a cada requisição. O valor parte do env e o override do administrador (na aba Sistema) o inverte, sem redeploy. O botão "Criar conta" já lia a mesma flag, então botão e rota nunca discordam. Desligado por padrão no banco de dev (2026-08-29): só o administrador cria contas até ligar o toggle.

2. **A coluna "Ordem" (`sort_order`) saiu do catálogo.** A listagem ordena por `created_at` (data do insumo), não mais por `sort_order`. O campo e a coluna sumiram da aba; a coluna do banco e o aceite pela API continuam por compatibilidade, apenas sem uso na tela nem na ordenação.

3. **A config de recurso é editada em CAMPOS, não em JSON cru.** O editor geral de configuração em JSON saiu. Cada categoria expõe campos escalares (URL, zoom, opacidade, limites, localização 3D) e CAIXAS JSON dedicadas só para as chaves estruturadas que não reduzem a campo: o `style` MapLibre (mapa base e camada de dados, com expressões `case`/`step`), a `legend`, e a `source` de análise (com `tiles[]`). Chaves sem campo são PRESERVADAS no salvamento, porque o config parte da linha existente.

**O par que fecha a decisão do item 3.** A primeira tentativa reduziu o `style` de camada de dados a três campos (cor/largura/opacidade da borda). O dono apontou o config real (`config.js` do deploy): a borda é `["step", ["length", ...], ...]`, uma expressão MapLibre, não um escalar. Campo teria truncado dado. Por isso a regra: escalar vira campo, estruturado vira caixa JSON. A validação de estilo MapLibre INTEIRO (`validateMapLibreStyle`) roda só no `style` do mapa base; o `style` de camada de dados é um recorte (`fill`/`border`/`label`) e só tem a sintaxe JSON cobrada.

**Também nesta rodada:** os controles do viewer 3D e o editor "Avançado (JSON)" da aba Sistema saíram; o hover do botão de sub-aba ativo (Pessoal e Catálogo) deixou de ficar ilegível.

**Guardas:** `backend/tests/integration/auto-cadastro-toggle-runtime.test.js` (403 desligado, 422 ligado, e o `GET /api/config` espelhando a flag). O catálogo em campos é exercitado pelos specs de navegador (`browser-admin-catalog.spec.js`, `browser-basemap-privado.spec.js`), fora do `npm test`.

**Status:** aceita.

---

### 2026-08-29 (fim): o projeto 360 ganha paridade de edição com o 3D (renomear pela UI)

**Contexto.** O 360 é recurso de catálogo como o 3D, mas a aba só oferecia ações de linha (status, acesso, vídeo, calibrar, excluir) e nenhuma forma de editar o NOME: ele era fixado pelo bundle e não mudava mais pela tela.

**Decisão.** A rota de metadado do 360 (`PATCH /sv360/admin/projects/:slug`, `updateProjectMetadata`) passou a aceitar `name` além de `previewVideo`, e a aba ganhou a ação de linha "Renomear" (`admin-360-rename`). Renomear troca só o `name` de display: `slug`, `db_filename` e os arquivos SQLite (`{orgId}__{slug}`) não mudam, então é seguro.

**A atualização virou PARCIAL, e essa é a metade que morde.** Antes o serviço passava `previewVideo` sempre (null para ausente), o que já bastava com um campo só. Com dois campos, mandar só o nome apagaria o vídeo e vice-versa. O `UPDATE_PROJECT_METADATA` passou a tocar cada coluna só quando o campo foi FORNECIDO (booleanos `$4`/`$6` num `CASE`), e o `updateSv360ProjectMetadata` do cliente monta o corpo por PRESENÇA de chave, nunca por `?? ''`. A string vazia continua removendo o vídeo, porque a chave está presente; o `undefined` é que não viaja.

**O que NÃO entrou, e por quê.** Transferir a OM dona de um projeto 360 (o análogo do que as quatro tabelas de catálogo ganharam) NÃO foi feito: a OM entra no `db_filename` e no `UNIQUE(organization_id, slug)`, então mover de OM exigiria renomear os arquivos SQLite físicos e tratar colisão de slug no destino, que é trabalho de outra ordem. O 360 impõe a OM do produtor no upload e não a transfere.

**Guardas:** `backend/tests/integration/catalogo-video-de-previa.test.js` (caso "o 360 se RENOMEIA pela mesma rota, e a atualização é PARCIAL") e `frontend/tests/unit/video-de-previa-fiacao.test.js` (o corpo do cliente é montado por presença).

**Status:** aceita.

---

### 2026-08-29 (noite): o projeto 360 vira paralelo exato do 3D, com a calibração a mais

**Decisão do dono.** O 360 é recurso de catálogo como o 3D, e a aba passou a tratá-lo igual: botões de linha "Editar", "Tornar privado/público", "Excluir", mais o de "Calibrar" (a única coisa que o 360 tem a mais). O "Editar" abre um formulário (`_render360Form`) paralelo ao do 3D: id (slug), nome, descrição, OM dona, visibilidade, status (Ativo/Inativo), thumbnail e vídeo. As ações que eram soltas na linha (Renomear, Ativar/Desativar, Vídeo) viraram campos do formulário.

**O achado que evitou uma migração destrutiva.** A dificuldade aparente era a OM dona: os arquivos são `{orgId}__{slug}.db`, então transferir de OM PARECIA exigir renomear arquivos no disco. Não exige: as leituras em runtime resolvem o store pela coluna `db_filename` GRAVADA (`resolveDbPath(row.db_filename)`), e `deriveDbFilename(orgId, slug)` só roda no INGEST. A transferência é TROCA DE COLUNA (`organization_id`), sem tocar o disco, exatamente como no 3D (onde transferir não move os bytes do modelo). O prefixo de OM no nome do arquivo fica cosmético depois. Guarda: `sv360-admin-authz.test.js` prova que o `{orgId}__{slug}.db` continua no lugar após a transferência.

**O que entrou no backend:**
- `description` como coluna nova de `sv360.projects` (migração aditiva) + a rota de metadado (`PATCH /admin/projects/:slug`) aceitando `name`, `description` e `previewVideo`, com atualização PARCIAL (cada coluna só muda com o campo fornecido, via booleanos no `UPDATE`).
- `PATCH /admin/projects/:slug/owner-org` (só-admin, `requireAdmin`): transfere a OM por troca de coluna, com 400 para OM inválida e 409 para colisão de slug no destino (o slug é único só por OM).
- `POST /admin/projects/:slug/thumbnail` (multipart): substitui a thumbnail no disco, validando WebP por magic bytes, gate de posse no serviço.

**O que NÃO entrou, e por quê.** O `{slug}.db` de imagens é resíduo (o próprio descritor da pirâmide marca `base: 'image?quality=preview'` como legado e diz que o cliente usa o tile de nível 0; a origem já apagou o `image?quality=full`). Remover o `images.db` do ingest e das rotas é uma limpeza separada e maior, que NÃO bloqueia o paralelo e fica para depois. E o nome dos arquivos por `{orgId}__{slug}` continua: renomear para `{slug}` exigiria migração destrutiva do `UNIQUE(org, slug)` sem ganho de leitura, já que a transferência não depende disso.

**Guardas:** `backend/tests/integration/sv360-admin-authz.test.js` (transferência: produtor 403, admin 200 com arquivo intacto, OM inválida 400, colisão 409; thumbnail: 401 anônimo, 200 com WebP válido, 400 para não-WebP) e `catalogo-video-de-previa.test.js` (metadado parcial: nome e vídeo não se apagam).

**Status:** aceita.

---

### 2026-08-29 (tarde 2): o vídeo de prévia vira ENVIO de arquivo hospedado, e o rótulo do tile server fica claro

**Decisão do dono.** O vídeo de prévia de recurso deixa de ser uma URL externa colada e passa a ser ENVIADO como a thumbnail: arquivo hospedado no backend, servido por rota própria. Vale para os três tipos de catálogo que têm vídeo (tileset, dados, análise) e para o projeto 360. Parâmetros escolhidos: teto de 50 MB por arquivo; só envio (a URL externa já gravada continua sendo servida, mas não dá para colar uma nova).

**Por que em disco, e não embutido no config como a thumbnail.** A thumbnail vira um data URL de dezenas de kB dentro do `config` JSONB, que o `/api/config` memoiza e serve anônimo. Um vídeo tem MB e quebraria esse payload. Então o arquivo vive em `data/catalog-videos` e o config guarda só a URL servida.

**Modelo de acesso: público-por-URL.** O nome do arquivo carrega um token de 16 bytes aleatórios, e a URL só chega a quem VÊ o recurso (config público, ou o payload aditivo do privado). Servir é público (o token é a capacidade, como o link público de atlas), sem um segundo gate por tipo de recurso, que exigiria mapear o arquivo de volta ao recurso. Registrado nos dois censos de superfície (`saidas-de-conteudo-censo` e `superficies-de-recurso-censo`), com o RISCO escrito.

**Backend novo:** módulo `catalog-video` (store com validação por magic bytes MP4/WebM + teto, controller de serviço com Range/ETag/streaming, rota pública `GET /api/v1/catalog-videos/:file`); envio/remoção por rota do recurso (`POST`/`DELETE /:id/preview-video` no catálogo e `/admin/projects/:slug/preview-video` no 360), com limpeza do arquivo antigo na troca e do órfão no hard-delete do 360. Config nova: `CATALOG_VIDEO_DIR`, `CATALOG_VIDEO_BASE_URL`, `CATALOG_VIDEO_MAX_SIZE_MB` (padrão 50), todas opcionais.

**Também nesta rodada:** o rótulo do "Tile server (URL)" na aba Sistema passou a dizer o que ele faz. Ele NÃO é morto: `initGridLayers` (`frontend/src/js/grid/grid-layers.config.js`) monta as fontes de vetor da GRADE UTM como `<esta URL>/grid_<sistema>_<escala>`. Vazio, a grade não resolve as fontes. O rótulo virou "Servidor de tiles da grade UTM (URL)" com uma dica explicando.

**Guardas:** os dois censos de superfície de recurso do backend; a suíte de catálogo e `sv360-admin-authz`. O envio pela UI é exercitado pelos specs de navegador, fora do `npm test`.

**Status:** aceita.

---

### 2026-08-29 (noite 2): o botão "Limpar overrides" sai, e o 360 ganha os campos de cartão do catálogo

**Decisão do dono.** Duas mudanças no painel.

1. **O botão "Limpar todos os overrides" saiu da aba Sistema.** A capacidade no servidor continua (`clearConfigOverrides`), mas a porta na tela some: os campos curados cobrem o que se edita, e o reset em massa era o gesto mais vago e irreversível do painel.

2. **O projeto 360 ganhou os campos de cartão do catálogo, paralelos do 3D:** palavra-chave, local, data de captura, longitude e latitude (o centro do marcador). O achado que motivou: o cartão do catálogo do cliente (`_getPanoramic360`) JÁ LIA `keywords`, `location`, `captureDate` e `center` de um projeto 360, mas o backend só tinha `capture_date`, `center_lat` e `center_long`, e as consultas públicas nem selecionavam os campos de texto. Faltavam duas colunas e o resto era leitura morta.

**O que entrou no backend:**
- Colunas `keywords` (TEXT[]) e `location` (TEXT) em `sv360.projects` (`013_sv360_keywords_local.sql`, aditiva). `keywords` é array porque o cartão itera sobre ela, o mesmo formato do 3D.
- `publicProjectView` passou a emitir `keywords`; `description`/`location`/`captureDate`/`center` já eram chaves da forma congelada (emitidas null), e agora carregam valor. As consultas públicas (`LIST_PROJECTS`, `GET_PROJECT_BY_SLUG`) e as de admin passaram a selecionar `description`, `location`, `keywords`, `capture_date`.
- A rota de metadado (`PATCH /admin/projects/:slug`) aceita `keywords`, `location`, `captureDate`, `centerLat`, `centerLong`, com atualização parcial por campo (cada coluna só muda com o campo fornecido).
- O formulário Editar do 360 ganhou os cinco campos.

**Guarda:** `catalogo-video-de-previa.test.js` (os campos gravam e saem na forma pública, e a atualização é parcial: mudar o local não apaga as palavras-chave).

**Status:** aceita.

---

### 2026-08-29 (noite 3): o 360 do web converge com o ebgeo_360, arquivo por SLUG e colunas inertes podadas

**Contexto.** O `ebgeo_360` (`C:\Users\diniz\OneDrive\Desktop\Desenvolvimento\ebgeo_360`, microsserviço Fastify) é a fonte-da-verdade do 360. O web tinha três divergências herdadas: nome de arquivo com prefixo de OM (`{orgId}__{slug}.db`), slug único por OM em vez de global, e cinco colunas de calibração que o cliente nunca leu e que não existem na origem. A aplicação ainda não está no ar, então dá para mudar tudo sem transição (decisão do dono).

**Decisão, em fases.**

1. **Nome de arquivo por SLUG, sem prefixo de OM (feito).** `deriveDbFilename(slug)` devolve `{slug}.db`, e o tiles é `{slug}_tiles.db`. A isolação entre OMs, que o prefixo garantia, virou o `UNIQUE (slug)` de `sv360.projects` (`007_sv360.sql`): dois projetos com o mesmo slug em qualquer OM são impossíveis, então não há dois arquivos para colidir. A coluna `organization_id` sobrevive como POSSE (gate de escrita, transferência de OM), só saiu do NOME. O upsert de merge passou a recusar (409) o slug que já pertence a outra OM. O ETL (`scripts/sv360-import.js`) e a limpeza de disco (`deleteProject`, que agora apaga também o `{slug}_tiles.db`) seguem o nome novo.

2. **Poda dos cinco campos inertes (feito).** Saíram do schema, do INSERT, das consultas de leitura, do payload e dos schemas de escrita: `camera_height`, `distance_scale`, `marker_scale` (foto) e `override_distance`, `override_height` (alvo). O cliente nunca os lia (o modelo relativo de marcador projeta por azimute e ordem de fila, não por distância/altura). `override_bearing` FICA: é o único da família com leitor vivo (`minimap.js`, só a nulidade). Guarda: `sv360-contract.test.js` afirma que `camera.height`/`distance_scale`/`marker_scale` chegam `undefined`.

3. **Tiles-only (feito).** A `images.db` (`{slug}.db` de blob full/preview) saiu inteira: a rota GET /photos/:uuid/image, getPhotoImage, getPhotoImageMeta, GET_PHOTO_SIZES e blobstore.getImage foram removidos (sem crase de proposito: eles nao existem mais, e crase promete codigo que existe), e o único arquivo de pixel no disco passou a ser o `{slug}_tiles.db`. A ingestão (online e o ETL offline `scripts/sv360-import.js`) instala SÓ o tiles e EXIGE pirâmide cobrindo toda foto viva (`validatePyramidCoverage`), sem instalar `{slug}.db`. As colunas `full_size_bytes`/`preview_size_bytes` FICARAM como metadado dormente (o dono nomeou a images.db, não elas). No frontend, o fallback de imagem inteira (`image?quality=preview|full`) saiu do visualizador do mapa (`street_view_viewer.js`) e do estúdio de calibração (`calibration/viewer.js`, `preview-viewer.js`): toda foto compõe por tiles, e a foto sem pirâmide não tem mais para onde cair. Fix de produção que apareceu no caminho: a cobertura de pirâmide e a leitura de pós-merge passaram a considerar só foto VIVA (`liveManifestPhotoIds`), porque foto tombstonada em `photos[]` não tem pixel e exigi-lo recusava bundle são.

**Verificação:** `npm run lint` + `npm test` do backend verdes (3929 testes), `npm run lint` + `npm test` do frontend verdes (8785 testes). A conferência com o `ebgeo_360` continua sendo o diff de `tile-loader.js` descrito em [`../../.claude/rules/common-tasks.md`](../../.claude/rules/common-tasks.md). A UI do 360 (mapa e estúdio) fica para a verificação por Playwright.

**Status:** as três fases aceitas.

### 2026-08-29 (madrugada): o tile privado ganha gate POR RECURSO, e o empréstimo ao visitante de link público é MANTIDO com consentimento informado

**O ponto de partida.** Os bytes do tile de uma camada privada saíam pelo nginx sem passar
por predicado nenhum: marcar a camada como privada escondia a URL do catálogo e não movia
byte. A cláusula 10.7 tinha posto a chave de API como credencial validada no nginx, e o
`auth_request` resultante respondia sobre a CREDENCIAL e nunca sobre a CAMADA, e qualquer
chave viva alcançava qualquer camada privada, inclusive de outra OM. Isso foi MEDIDO em
`dev/tile-privado/scripts/confere-martin-nginx.sh` antes de virar decisão.

**O que foi feito (fases 1 a 4).** Um índice em memória diz a que linha de catálogo
pertence cada caminho servido sob o prefixo de tiles
(`backend/src/modules/nomes/tile-regime.js`); o gate resolve o caminho por ele e decide os
quatro desfechos; o `location` parou de exigir chave de todo mundo, o que devolveu o
visitante anônimo e o cache de borda do público; e o login passou a emitir o cookie de
sessão, para que o token viaje em pedidos que o navegador faz e que não aceitam cabeçalho
(o tile, o `img.src`, o `<video src>`). O cookie fechou o último defeito da cena indoor.

**A fase 5 (cache da subrequisição) foi RECUSADA por medição**, e é o tipo de recusa que
vale registrar: o gate custa zero mensurável (tile público a +5 µs do piso, tile privado
por cookie exatamente no piso). O que custa é a chave de API, +480 µs por tile, porque
`FIND_USER_BY_API_KEY` é uma consulta ao banco por requisição e não é memoizada. Um cache
compraria atraso de revogação em troca de um ganho que a medição não acha.

**A DECISÃO DE PRODUTO, e o caminho até ela.** Com o gate de pé, sobrou um caso: o
visitante de link público não tem cookie (o token dele é efêmero e mora só em memória, por
contrato do cliente), então uma camada privada EMPRESTADA pelo atlas não desenharia para
ele. A primeira formulação do dono foi que um visitante não deve alcançar recurso privado,
e ela seria uma emenda à cláusula 6.3.

Ela foi retirada pelo próprio dono, com o argumento que a derruba: **o auto-cadastro é
aberto, então "estar logado" não é barreira nenhuma**, e quem quisesse o recurso criaria
uma conta. O eixo certo nunca foi autenticação, é NOMEAÇÃO: um share nominal significa que
alguém com autoridade sobre o atlas escolheu aquela pessoa, e o link público é o único
caminho em que ninguém decidiu quem entra.

Postas as três saídas (manter e avisar; tirar o empréstimo do link público mantendo-o para
os nomeados; acabar com o empréstimo), **o dono escolheu MANTER e resolver por interface**:
com aquele link, o visitante alcança o recurso privado emprestado, mesmo deslogado, e o
que muda é que o DONO passa a saber exatamente o que está expondo no momento de publicar.

**Por que essa escolha é defensável, e é a mesma razão da 6.3:** quem publica um atlas que
empresta um recurso privado está publicando aquele recurso naquele contexto, e a cadeia
começa em alguém com autoridade de repasse. O que faltava não era o predicado, era o
CONSENTIMENTO: um empréstimo é invisível na tela de quem publica o link.

**A cláusula 6.3 continua VIGENTE e ganha uma exigência**, que nasce [em obra]: ao ativar
o link público, a tela precisa nomear os recursos privados que o atlas empresta. Hoje ela
diz apenas "qualquer pessoa com o link pode visualizar este atlas, sem precisar entrar",
que é verdade e é insuficiente.

**O que isso implica de trabalho, e nada disso está feito:**

1. `GET /api/v1/atlas/:atlasId/resources` devolve o empréstimo sem o NOME do recurso e sem
   o `access_level`, e o aviso precisa dos dois para nomear o que expõe.
2. O modal de compartilhamento (`frontend/src/js/modals/sharing.modal.core.js`,
   `_renderPublicSection`) precisa do aviso.
3. O visitante precisa CONSEGUIR ver o que a decisão diz que ele vê: o
   `transformRequest` do mapa só reconhecia URL do 360, então o token efêmero do visitante
   não viajava no tile do servidor de tiles.

**OS TRÊS FORAM FEITOS no mesmo dia**, e o registro fica porque a ordem importou. O
carimbo de credencial virou `credencialDeTile`
(`frontend/src/js/map/credencial-de-tile.js`), que cobre as duas bases e substituiu o do
360, removido junto com o predicado dele; a rota passou a devolver `name` e
`access_level`; e o modal de compartilhamento passou a nomear os privados, com as frases
num módulo folha (`frontend/src/js/modals/link-publico-phrases.js`).

**O ITEM 3 COBROU UM DEFEITO QUE A SUÍTE NÃO PEGOU.** A amarra de CSRF da fase 4 olhava
`req.authVia === 'cookie'`, e o `flexibleAuth` lê o cookie ANTES do Bearer: o cliente
logado manda os dois, então `authVia` era `'cookie'` em toda requisição do app e TODA
escrita de TODO usuário respondia 401. A suíte passava porque cada caso mandava UMA
credencial por vez; quem pegou foi a captura de UI. A correção não mexeu na precedência:
`flexibleAuth` passou a registrar a PRESENÇA do cabeçalho (`req.temBearer`), e é ela que
autoriza a escrita, porque um formulário de outro site não consegue pôr `Authorization`.

**Verificação do que já está pronto:** seis conferências em `dev/tile-privado/scripts/`,
165 casos e zero defeito; backend com lint limpo e `npm test` completo verde (3943 casos,
piso de cobertura em 97,8%); frontend verde (8785 casos). A conferência
`confere-gate-por-recurso.sh` foi escrita ANTES do código e saiu de 12 pendentes para
24 de 24.

**Status:** fases 1 a 4 aceitas; fase 5 recusada por medição; a exigência de consentimento
da 6.3 fica [em obra], com os três itens acima nomeados.

---

### 2026-08-29 (noite 4): o botão "Prévia" sai do cartão do catálogo geral

**Decisão do dono.** O botão "Prévia" do cartão do catálogo geral do ebgeo (o que o usuário vê, `frontend/src/js/catalog/components/catalog-card.js`) SAIU. Escopo explícito: só o botão do cartão, **não** a tela de administração.

**O que FICA:** o envio do vídeo de prévia no painel de administração (`admin/catalog-tab.js` + a rota `PATCH /sv360/admin/projects/:slug` e o `config.previewVideo` das outras famílias), o dado `previewVideo` que `catalog.service.js` carrega, e o modal `catalog/components/preview-video.modal.js`. O dado sobrevive e o administrador ainda o envia; só a afordância de leitura no cartão geral saiu. O botão era o único que abria o modal, então o modal ficou sem chamador em `src`, preservado para um eventual retorno do botão.

**O que saiu do cartão:** o bloco `if (item.previewVideo)` que montava o botão, o import de `abrirPreviaDeVideo` e o ícone `PLAY`, que só ele usava.

**Guarda:** `frontend/tests/unit/video-de-previa-fiacao.test.js` passou a afirmar a AUSÊNCIA do botão no cartão (o cartão não importa mais o modal, não gateia por `previewVideo`, não cria `catalog-card-btn--preview`), mantendo os testes do envio no admin e do dado em `catalog.service.js`.

**Errata das decisões de 2026-08-24 (vídeo de prévia para quatro tipos):** a "superfície de leitura comum, o botão Prévia do cartão" daquelas decisões deixou de existir. O carimbo de escopo de `enderecoDaPrevia` (a razão da decisão de 2026-08-24) segue no modal, válido se o botão voltar.

**Status:** aceita.
