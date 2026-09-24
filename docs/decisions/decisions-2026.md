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
  - *Trocar a fonte com `setTiles()`.* Recusada pela mesma medição: setSourceProperty da fonte VETORIAL chamava load() sem argumento, o worker caía no ramo de recarga (reloadTile e tileState.getLoaded; os quatro sem crase, porque são símbolos do bundle do MapLibre, fora da árvore que este guarda varre) e nunca tocava a rede. Trocaria o texto da URL servindo os bytes do atlas anterior. Só `removeSource` derruba o `TileManager` com os dois caches. **Remedido em 2026-09-04, na subida para o MapLibre 6.7.0: essa metade da razão INVERTEU**: lá setSourceProperty chama load(true) também na vetorial, o tile recarrega como expired e o pedido de fato refaz a rede. A recusa continua de pé pela OUTRA metade, que é a que decide: os dois caches respondem por `OverscaledTileID.key`, então um tile do atlas anterior JÁ EM CACHE seria servido sem pedido nenhum. `frontend/tests/unit/tiles-360-escopo-de-atlas.test.js` guarda as duas medidas, agora contra a fonte publicada do pacote.
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
   afirmam que `applySharedBasemap` foi chamada, e a bandeira de não persistir morava dentro dela
   (ela saiu em 2026-09-20, quando nenhum caminho do controle passou a gravar). Falta o caso
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
- **Decisão:** uma função de descarte dos mapas do escopo (chamava-se discardMapsForReplacingImport, em `store/map.operations.js`; APAGADA em 2026-09-21, por ter ficado sem chamador quando a substituição de atlas por import virou atômica em `replaceAtlasFromImport`), chamada pelo ramo não-aditivo de `handleImport` ANTES da primeira escrita, apaga por CHAVE de armazenamento todo registro de mapa que sobrou no escopo e limpa o resolver. O chamador guarda o caso vazio: um arquivo sem mapa nenhum não passa por ela, senão o escopo fica sem mapa para abrir.
- **Alternativas rejeitadas:**
  - *Apagar só o homônimo*: fecharia o sombreamento e deixaria o mapa em branco ao lado do projeto sempre que o arquivo não trouxesse um mapa com o nome padrão, que é ruído sem dono na lista.
  - *Fazer `addMap` remover o registro name-keyed de mesmo nome*: mais geral e mais arriscado. Aquele caminho é o mesmo que aplica op de par remoto, onde a colisão por nome tem outro dono (`activateAtlasInitialMap`) e outra regra.
  - *Não semear o mapa em branco no wipe*: o wipe é chamado por caminhos que NÃO importam nada em seguida, e sem mapa o app não tem o que abrir.
- **Consequências:** o slot importado passa a ter uma chave de armazenamento por mapa do arquivo (eram `maps + 1`), e a chave `Principal` não sobrevive ao import. Dois casos de `atlas-local-ebgeo-e-teardown.spec.js` afirmavam as doze chaves como se fossem desenho, com o comentário explicando a de-duplicação: os dois foram corrigidos no mesmo commit. A espera daquele arquivo passou a ancorar no toast de sucesso, que é a última linha do fluxo, porque ancorar no número de chaves de mapa media só a primeira etapa e deixava briefing, ícone e blob correndo contra escritas em voo (flake medido).
- **Guardas:** `frontend/tests/integration/lote-partido.repro.test.js` (o recorte, o elo, os gestos, a recusa que segura e o espelho do teto contra o backend), `frontend/tests/e2e/lote-partido-parte-recusada.e2e.test.js` (servidor real: importação com a segunda parte recusada, grupo recusado sem membro nenhum enviado, grupo partido com 199 membros, e o servidor ignorando `dependsOn`) e `frontend/tests/e2e-ui/importar-mais-de-200-no-servidor.repro.spec.js` (navegador, Postgres e par).
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
- Colunas `keywords` (TEXT[]) e `location` (TEXT) em `sv360.projects` (`007_sv360.sql`, aditiva). `keywords` é array porque o cartão itera sobre ela, o mesmo formato do 3D.
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

---

### 2026-08-30: a troca de atlas volta a NAVEGAR, e o modal de troca ao vivo sai

**Decisão do dono**, literal: "não gosto desse modal do seu atlas, quero que vá para página /atlas em vez de usar aquele modal". O clique em "Seus atlas" (menu do avatar e a grade de ações da aba Mapas, que delega para ele) volta a levar para `atlas.html`, como fazia até 2026-08-26.

**O que saiu:** o modal inteiro (o arquivo atlas-switch.modal.js de `frontend/src/js/modals/`, a folha atlas-switch.css e o `@import` dela em `frontend/src/css/style.css`), mais o teste que só existia para ele (o porta-de-troca-de-atlas.test.js de `frontend/tests/unit/`). Nada mais o importava: a única porta era `_openAtlasSwitchDoor`, dentro de `openProjectPicker`, e ela foi removida junto com o parâmetro `navigate`, que existia só para forçar o caminho antigo e passou a ser o único caminho.

**O que FICA, e é a distinção inteira:** `switchAtlas` (`frontend/src/js/account/open-atlas.service.js`) continua de pé, com os testes dela, exercitada pelo gancho sem interface `__ebgeoSwitchAtlas` que `frontend/src/js/index.js` instala. O que a decisão alcança é a INTERFACE, não a capacidade. O comentário daquele gancho dizia que a porta visível "é uma decisão de produto separada, e ela está com o dono": a decisão foi tomada, e no sentido de não haver porta.

**Consequência para a bancada.** `frontend/tests/e2e-ui/troca-viva-de-atlas-medida.spec.js` dirigia o modal desde 2026-08-26 e voltou ao gancho, perdendo a série que cronometrava abrir a porta. O cabeçalho dela passou a DECLARAR a limitação em voz alta: o que ela mede é que a função é mais barata que a recarga, e não que alguém colha essa economia pela tela, porque nenhum gesto do produto aciona `switchAtlas`. Sem essa frase, o número voltaria a ser lido como ganho entregue, que é exatamente o erro que a correção de 2026-08-26 existia para consertar.

**Status:** aceita.

---

### 2026-08-31: o zoom mínimo e máximo passa a ser do mapa base, e o da aplicação vira fixo

**Origem.** Observação do dono: o nível de zoom mínimo e máximo deveria ser por mapa base, e não uma régua geral da aplicação. A análise achou o desenho real, que era pior do que a pergunta supunha: existiam TRÊS níveis declarados e UM ligado.

**O ESTADO ANTERIOR, medido antes de propor qualquer coisa.** A aplicação valia `[1, 17.9]` e era o único nível que chegava ao MapLibre (`map_sig.js`, no construtor), editável pelo painel. O ATLAS tinha `settings.min_zoom`/`max_zoom`: validados com regra de ordenação, persistidos, clonados, cobertos por cinco arquivos de teste, e lidos por nenhum consumidor de comportamento do frontend. E o MAPA BASE não tinha nível nenhum: o que existia era o `maxzoom` da FONTE de cada estilo (BDGEx 18, osm e topográfica 19, imagens 20), que não trava a câmera, porque o MapLibre faz overzoom e escala o último tile.

**A medida que decidiu o desenho:** o teto de 17.9 estava ABAIXO do `maxzoom` de toda fonte, então era ele que segurava as cinco camadas, e nenhuma alcançava o próprio limite. O caso que motivou a pergunta, um mapa base que legitimamente só serve até certo zoom, não tinha como ser expresso em lugar nenhum.

**A DECISÃO, do dono.** Dois níveis, e só um configurável:

- A APLICAÇÃO é fixa em `[2, 21]`, e não é configurável por ninguém. Os campos saíram do painel e o schema de override recusa as duas chaves.
- O MAPA BASE aperta dentro dela, por `config.minzoom`/`config.maxzoom` da linha de catálogo, entre 2 e 21. Editam o administrador e o produtor da OM dona da linha.
- O ATLAS não tem zoom. Removido do DEFAULT da baseline, do schema e dos testes.

**O SEED NÃO É OPCIONAL, e essa é a parte que a decisão sozinha não entrega.** Subir o teto de 17.9 para 21 sem declarar a faixa das cinco linhas semeadas entregaria, no mesmo dia, overzoom borrado em todo mapa base, porque o que os segurava era o teto global. Por isso `005_catalogo.sql` passa a declarar: topográfica 19, ortoimagem 18, BDGEx 18, osm 19, imagens 20, piso 2 nas cinco. Cada `maxzoom` é o da FONTE do estilo daquela camada; o 18 da ortoimagem é decisão do dono, e não leitura de fonte, porque o módulo do cliente ainda é a URL de demonstração do MapLibre.

**A RECUSA TEM DE SER NOMEADA, e apagar a chave do schema não bastava.** `map2d` é `.unknown(true)`: uma chave apenas retirada passaria como desconhecida, seria gravada em `config_settings` e voltaria a vencer o valor fixo no deep-merge. Daí `Joi.any().forbidden()`, o mesmo gesto que a cláusula 2.4 já usava para o vídeo de prévia do mapa base. E porque borda de entrada não alcança linha JÁ gravada, `podarZoomDeAplicacao` roda também na LEITURA de `getAppConfig`: um documento escrito antes desta mudança não derruba o valor fixo, e cicatriza no salvamento seguinte. Preso por `backend/tests/integration/config-effective-invariant.repro.test.js`, cujo insumo degenerado é escrito DIRETO no banco, porque a API já não consegue produzi-lo.

**A ORDEM DE ESCRITA ERA A METADE NÃO ÓBVIA, e foi medida no bundle em uso, não deduzida da documentação.** No 5.18 vendorizado, que era `frontend/public/vendors/maplibre-gl.js` até ser apagado em 2026-09-04 (hoje a biblioteca vem do npm, e as mesmas guardas estão em `node_modules/maplibre-gl/src/ui/map.ts`): `Map.setMinZoom(e)` só age se `e <= transform.maxZoom` e `Map.setMaxZoom(e)` só age se `e >= transform.minZoom`; fora disso as duas LEVANTAM, e as duas comparações são inclusivas (faixa degenerada `[2, 2]` passa). A ordem ingênua estoura ao sair de um mapa base de teto BAIXO para um de piso ALTO, que é troca corriqueira. A faixa passou a se escrever em TRÊS chamadas, baixando primeiro o piso ao chão da aplicação, o que torna as três válidas em qualquer ordem de troca sem um ramo condicional. `frontend/tests/unit/basemap-faixa-de-zoom.test.js` dirige um mapa falso que impõe essas guardas literais, e traz o CONTROLE NEGATIVO: o mesmo insumo, na ordem ingênua, levanta.

**A ARMADILHA DO BOOT.** A aplicação da faixa roda FORA do `if (this.currentLayer !== layer)` de `switchLayer`. O getter de `currentLayer` devolve `carta-topografica` quando não há estado e o mapa NASCE com esse estilo (`map_sig.js`), então no boot mais comum o bloco inteiro é pulado, e uma implementação dentro dele nunca aplicaria a faixa do mapa base inicial.

**O MINI-MAPA DO 360 ENTROU JUNTO**, por decisão do dono na mesma sessão. Ele carregava um estilo OSM escrito à mão em `street-view-mini-map-style.js`, com URL de tile e de glifo próprias, fora do catálogo: num deploy sem saída para a internet o mapa principal vinha do tile server interno e o mini-mapa ficava em branco, sem erro e sem lugar onde o administrador consertasse. Passa a escolher um MAPA BASE do catálogo (`streetView360.miniMapBasemap`, com seletor próprio no painel), e SÓ o mapa base: a faixa de zoom vem da linha daquele mapa base, porque um par próprio aqui seria o terceiro nível de zoom que esta decisão acabou de eliminar. Consequência registrada: o `minZoom: 11` que o mini-mapa tinha escrito à mão SAI, então um mapa base de piso 2 deixa o mini-mapa afastar até 2. O `maxZoom: 17.9` que morava na mesma linha era cópia do teto antigo da aplicação, e teria ficado órfã.

**A PERMISSÃO NÃO É NOVA, e conferi antes de escrever uma linha de gate.** `fn_can_produce_resource` (`008_acesso_a_recurso.sql`) devolve `v_owner_org IS NOT NULL AND v_owner_org = v_scope`, com administrador saindo `true` antes. É exatamente a regra pedida. A consequência que surpreende: as cinco linhas semeadas são institucionais (`owner_org_id` NULL), então nenhum produtor ajusta o zoom delas, e na prática o zoom dos cinco é do administrador.

**Baseline reescrita, e não migração nova**, pelo que `backend/CLAUDE.md` autoriza enquanto nenhum banco fora do branch a aplicou. Banco de desenvolvimento migrado antes não é alcançável por upgrade: `node scripts/dev-db.js recreate`.

**Raio de explosão.** O maior é o teto subindo de 17.9 para 21, que muda o zoom máximo de toda tela do produto; ele é contido pelo seed das cinco linhas, e o que sobra é o mapa base novo criado sem declarar faixa, que vale a faixa inteira por omissão. O segundo é o mini-mapa do 360, que passa a depender do catálogo: sem mapa base que resolva, o estilo local antigo continua sendo o último recurso, porque `setStyle(undefined)` deixaria o mini-mapa em branco sem erro nenhum.

**Status:** aceita.

### 2026-08-31: o visualizador 3D deixa de vazar por abertura, e o laço de render para quando ele fecha

**Origem.** Pergunta do dono: se há vazamento de memória no mapa, no 360 ou no 3D. A resposta veio de bancada, e não de leitura de código: uma sonda de recurso vivo (listener, contexto WebGL, objeto de GPU, `ImageBitmap`, timer) mais a memória privada do processo separada por tipo, contra dado real (`serra_dourada` em 3D Tiles, `museu-1cgeo` em primeira pessoa, o projeto `museu_cms` com 76 panorâmicas).

**A RÉGUA SE PROVOU ANTES DE JULGAR, e reprovou a si mesma duas vezes.** As duas correções viraram código, porque as duas produzem número grande e coerente:

- `Runtime.getHeapUsage` mede o heap do V8, e `ArrayBuffer` mora FORA dele: a sonda deixou passar 4 MB por ciclo de um vazador deliberado. Por isso a bancada passou a medir também a memória privada do processo, que é a única que enxerga tile, textura no lado da CPU e buffer de compositor.
- A contagem BRUTA de listener acusava +14 por ciclo no 3D, onde o `Memory.getDOMCounters` do próprio Chrome contava +1. Listener em elemento descartado morre com o elemento, e quem estava errado era a sonda. Corrigida por `WeakRef` mais `isConnected`, as duas medidas passaram a bater, e é essa concordância que autoriza usar a nossa.

**O QUE NÃO VAZA, e foi medido, não presumido.** O 360: 35 panorâmicas de 5120x2560 navegadas em sequência, memória entre 716 e 740 MB sem tendência, contagem de textura fixa em 74, nenhum listener novo. A primeira pessoa: 10 ciclos de abrir e fechar com a cena provada carregada, memória caindo de 950 para 842 MB. O mapa 2D acumula 1 listener de `abort` por alternância de camada, registrado DENTRO da própria biblioteca (à época `frontend/public/vendors/maplibre-gl.js`, apagado em 2026-09-04 quando o MapLibre passou a vir do npm), sem nenhum quadro de app na pilha e sem crescimento de memória: fica em observação, sem remendo em biblioteca de terceiro.

**OS TRÊS CONSERTOS NO 3D**, todos em `frontend/src/js/3d_models_viewer_tool/map_3d.js`, cada um com a medida que o motivou e a que o fechou:

1. **O listener por abertura.** `initActiveToolChip3D` pendurava uma função anônima no `#active-tool-chip-3d-close` a cada abertura, e aquele botão nunca sai do documento: +1 listener vivo por ciclo, sem patamar em catorze ciclos. Passou a guardar a referência e removê-la antes de adicionar, que é o que o laço vizinho dos `.button-tool-3d` já fazia. Depois: contagem travada em 289 nos catorze ciclos.

2. **O tileset refeito à toa.** Reabrir o MESMO modelo destruía o `Cesium3DTileset` e montava outro idêntico, cada um nascendo com `cacheBytes` de 1 GB. Custo medido: 8,8 MB por ciclo no processo RENDERIZADOR, sem patamar em doze ciclos, com o processo de GPU parado em 526 MB e as contas do próprio Cesium (geometria, texturas, memória do tileset) imóveis. Não era objeto esquecido, e a prova é que uma referência fraca mostrava UM único tileset vivo o tempo todo: era decodificação refeita. `loadSingleTileset` passou a reaproveitar o tileset quando o id não mudou e ele continua vivo. Não se pula o que depende do MAPA e não do modelo: câmera salva, marcadores, medições e bacias seguem sendo restaurados. Depois: memória plana em 951 MB por doze ciclos, com o renderizador 90 MB abaixo do patamar anterior.

3. **O laço que sobrevivia ao fechamento.** `pauseRendering` ligava o `requestRenderMode`, que corta o desenho e não o laço: o app pedia 60 quadros por segundo com o 3D FECHADO, contra 5 por segundo com ele ABERTO e parado. Fechar custava mais que deixar aberto. `useDefaultRenderLoop` passou a desligar no pause e a religar no resume, incondicionalmente e ANTES de qualquer retorno antecipado, porque um caminho de reabertura que caísse no `return` devolveria a cena sem quem a desenhasse. Depois: 0 quadro por segundo com o visualizador fechado.

**A guarda.** `frontend/tests/e2e-ui/vazamento-viewers.spec.js`, com a sonda em `frontend/tests/e2e-ui/helpers/sonda-vazamento.js`. Dois testes, e a ordem é o método: §30.1 exercita um vazador deliberado (20 listeners, 30 texturas, 1 contexto WebGL e 1 timer por chamada) e EXIGE que a régua o reprove; só então §30.2 deixa a régua julgar o app. O spec nasceu vermelho no defeito real (`<button>:click +4` em 4 ciclos, que é o +1 por ciclo da bancada) e ficou verde com o conserto: esse par é o controle negativo.

**DUAS ARMADILHAS QUE A GUARDA INCORPOROU**, porque as duas produziram verde falso durante a construção dela:

- Sem linha em `a3d.models`, a rota do asset responde 404 "3D model not found", o visualizador volta para o 2D e o teste passa sem ter aberto modelo nenhum. Um tileset tem DUAS metades em tabelas diferentes, e semear só o catálogo é semear metade. Daí `seedModelo3d` em `frontend/tests/e2e-ui/helpers/catalog-seed.js`, e a segunda escrita PELA ROTA depois do `INSERT`, para derrubar o memo do índice de modelos, que só se invalida em escrita de catálogo.
- Sem `.button-tool-3d` no documento, `registerToolEventListeners` retorna antes de registrar qualquer coisa, e o teste ficaria verde COM o defeito presente. O ciclo passou a devolver essa contagem, e ela é asserida a cada ciclo medido.

**A estabilidade da guarda foi MEDIDA EM SÉRIE, e não numa rodada.** Com o teto de 30 s para o Cesium subir, §30.2 se pulou por "limite de ambiente" em 1 de 3 rodadas, com a máquina carregada logo depois da suíte de backend. Pulo por lentidão é a pior das três saídas, porque não reprova nem verifica. Teto em 60 s: 5 de 5 rodadas verdes.

**Raio de explosão.** O de maior alcance é o reaproveitamento do tileset, porque muda o que acontece ao reabrir o mesmo modelo: nada é rebaixado, mas a cena volta a partir do estado que ficou. Conferido por captura de tela em três aberturas seguidas (o modelo desenha igual na terceira) e pelo caminho de risco, que é a TROCA: com um segundo modelo registrado para o teste, trocar continua criando um tileset novo, destruindo o anterior e deixando exatamente um vivo e um na cena. O desligamento do laço tem o modo de falha "tela parada sem erro no console", e o teste dele é a captura depois da reabertura, não o número.

**Status:** aceita.

### 2026-09-01: o índice de regime vencido ganha teto de idade, e passado ele o 3D fecha inteiro

**O problema.** Os índices de regime de acesso (`tile-regime.js` e `assets3d-regime.js`) caem para o
último índice bom quando a reconstrução falha, e seguem servindo. Isso é resiliência deliberada: uma
piscada de banco não derruba o mapa. Mas o índice velho responde "este recurso é público" sem ter como
confirmar, e a invalidação preserva o último bom de propósito, então um recurso recém-marcado PRIVADO
continuava a ser entregue como `public, immutable` **enquanto o banco estivesse fora**, sem limite, e
sem uma linha em lugar nenhum até 2026-09-01.

**A decisão.** Teto por `REGIME_STALE_MAX_MS` (cinco minutos por padrão, faixa validada). Passado ele, a
resposta que ENTREGA bytes deixa de ser dada e o gate responde 503. O ramo privado não é alcançado:
ele pergunta ao banco, não ao índice.

**A assimetria entre os dois índices, que é o ponto desta entrada.** No índice de tiles, caminho não
reivindicado já é 401, então o teto derruba só a afirmação pública. No de 3D, o não reivindicado é
PÚBLICO e é servido (está declarado no cabeçalho daquele arquivo), então ali as afirmações sem lastro
são DUAS, e o teto cobre as duas: **passado o teto, `/api/v1/assets3d` fecha para o acervo inteiro**,
público e não catalogado inclusive. Isso é decisão, não efeito colateral, e está asserido em teste para
não ser lido como defeito por quem passar depois.

**A alternativa recusada** (alcance estreito, uma linha: gatear só a linha pública do catálogo e deixar
o não reivindicado passar). Ela reabre exatamente o caso que motivou o teto, porque uma linha privada
criada pouco antes da queda tem caminho que o índice velho não reivindica, e seria servida. Três
argumentos fecharam a favor do amplo:

1. **Assimetria dos erros.** Fechar amplo falha alto e reversível (503 por minutos, volta com o banco).
   Estreitar falha silencioso e irreversível: bytes privados entregues com `public, immutable`, retidos
   em cache por um ano depois de o incidente ter passado.
2. **O estreito compra pouco.** Ele preserva a entrega de 3D público durante uma queda MAIOR que cinco
   minutos, janela em que o memo do `/api/config` já pode ter expirado e o boot do mapa é fail-fast
   nele: beneficia principalmente quem já estava com a página aberta.
3. **O conservador com knob mantém as duas opções alcançáveis em runtime; o estreito assa a permissiva
   no código.** Se o fechamento amplo doer, sobe-se a variável, sem tocar em código nem publicar imagem.
   O caminho inverso exigiria mudança de código.

**O que fica declarado como custo.** O knob é UM para os dois índices, então subi-lo para ganhar
disponibilidade de 3D afrouxa também o de tiles, que é onde o risco de vazamento é mais concreto. Dois
knobs não foram construídos porque seria especular sobre um caso que ainda não aconteceu; as linhas de
transição agora carregam a idade real do índice, que é o dado com que essa escolha se refaz.

**De passagem, um defeito de terceiro que a implementação encontrou:** `tile-access.js` NUNCA respondeu
503 quando o índice não existia. Ele fazia `next` com o erro cru do driver, que não é `AppError` e não
está no mapa do `errorHandler`, então o desfecho real era 500, enquanto o comentário logo acima prometia
503 e a wiki repetia a promessa. Os dois casos agora são 503 de verdade.

**Status:** aceita.

---

### 2026-09-01: Ctrl inclina, Shift rotaciona, e a pinça no tablet volta a ser só zoom

- **Contexto:** o gesto de câmera por mouse era UM só: Ctrl e arrastar movia bearing e pitch ao mesmo
  tempo. Ninguém arrasta uma linha perfeitamente vertical, então quem inclinava girava junto e lia isso
  como imprecisão do próprio trackpad. No toque o defeito era outro e maior: o app tinha um manipulador
  de arraste de dois dedos PRÓPRIO, que engatava no primeiro pixel e somava com o `touchPitch` do
  MapLibre (que engata com 2 px de movimento vertical paralelo e depois TRAVA zoom e rotação pelo resto
  do gesto). No tablet isso se lê como uma pinça que inclina em vez de dar zoom. E uma pinça rápida
  ainda terminava como toque de dois dedos, abrindo o menu de multisseleção, porque
  `createTwoFingerTapHandler` cancelava o toque só pelo deslocamento do PONTO MÉDIO, que numa pinça
  simétrica não anda um pixel.
- **Decisão:** separar os eixos por modificador, num modelo puro
  (`frontend/src/js/map/drag-rotate.model.js`, zero imports, testável em node): Ctrl (ou Cmd, no macOS)
  inclina, Shift rotaciona, Ctrl+Shift faz os dois, com limiar de 3 px (`DRAG_THRESHOLD_PX`) para
  preservar o Shift+clique da multisseleção. No toque, o manipulador de dois dedos do app SAI e o gesto
  inteiro passa a ser do MapLibre, com `touchPitch: false`; o toque de dois dedos passa a ser cancelado
  também por variação de ABERTURA, usando o `getTouchesDistance` que o handler já gravava e nunca lia.
  `boxZoom`, `dragRotate`, `doubleClickZoom` e `touchPitch` viram opções do construtor em `createMap`,
  e não chamadas no `load`, porque desligar no `load` deixava uma janela em que os quatro estavam vivos.
- **Alternativas rejeitadas:**
  - *Manter o gesto único e só baixar a sensibilidade do eixo indesejado*: o defeito é de EIXO, não de
    escala. Um giro pequeno continua sendo um giro que a pessoa não pediu, e a sensibilidade menor
    piora justamente o eixo que ela quer.
  - *Usar a opção pitchWithRotate do MapLibre* (nome do vendor, escrito sem crase porque não existe
    neste repositório): ela desacopla os dois eixos dentro do dragRotate NATIVO, que é do botão
    direito, e aqui o botão direito é do menu de contexto e do encerramento de desenho. Além disso o
    MapLibre não remapeia esse gesto para Shift, então adotá-la exigiria o manipulador próprio de
    qualquer jeito.
  - *Desligar também a rotação por toque*: recusada por ora. O MapLibre só a engata passada uma torção
    real (de 10 a 19 graus, conforme a abertura dos dedos), que é a mesma barra do Google Maps. A linha
    de saída (uma chamada de disableRotation sobre o touchZoomRotate do mapa, os dois nomes do vendor)
    fica escrita em `createMap` para o dia em que o tablet reclamar, e ela preserva o zoom.
- **Consequências:** o `MoveHandler` passa a ignorar mousedown com Ctrl/Meta/Shift, senão a feição se
  move enquanto o mapa gira e o `_endDrag` dele religa o `dragPan` no meio da rotação. O `dragPan` só é
  religado ao fim do gesto se estava ligado no mousedown (`_dragPanWasEnabled`), porque há 15 sítios
  que o desligam e um `enable()` incondicional devolvia o pan a uma ferramenta de desenho ativa. O
  canvas do mapa 2D fixa `touch-action: none` no CSS, ancorado em `#map-sig`: o vendor tira as classes
  que dirigem esse valor sempre que alguém chama `dragPan.disable()`, e perdê-las no meio do gesto faz
  o NAVEGADOR cancelar a pinça. O clique sintético do fim do arraste passa a ser engolido, porque o
  suppressClick do MapLibre (nome do vendor) só cobre os gestos que os handlers dele dirigiram, e o
  nosso chegava em `map.on('click')`, onde o `SelectionManager` desmarca a seleção em terreno vazio e o
  `CommentOverlay` planta um alfinete. Fica DECLARADO, e não consertado, que o cursor remoto de outro
  usuário salta durante a rotação: `presence-bridge.js` publica posição por mousemove e não sabe que a
  câmera está girando.
- **Status:** aceita.

---

### 2026-09-01: "Colar Aqui" ancora no CENTRO da caixa envolvente, e o Ctrl+V perde o gate de trava

- **Contexto:** o menu de contexto do mapa ganhou copiar e colar, e as duas metades da decisão
  nasceram do mesmo diagnóstico. O menu montava o bloco de seleção olhando `hasSelected` e a trava
  do mapa, e permissão NENHUMA: um Leitor num atlas de servidor recebia "Duplicar Seleção", que é
  `copy()` seguido de `paste()`, que chega em `addFeatures`, cujo `guardWrite` recusa devolvendo
  `undefined` em silêncio. Ninguém lia esse retorno, então a colagem seguia até `updateMapSources`,
  `autoSelectPastedFeatures` e um toast de SUCESSO, ao lado do toast de recusa que
  `store-error-listener.js` já estava mostrando. No F5 as feições sumiam. Do outro lado, `paste()`
  abria com uma recusa MUDA para o mapa travado, e o Ctrl+V tinha um segundo gate de trava na frente
  dela: os dois juntos faziam a tecla não fazer nada e não dizer nada.
- **Decisão:** (a) a âncora da colagem é o CENTRO DA CAIXA ENVOLVENTE do conjunto copiado, levado ao
  ponto do clique, com o delta de longitude MÍNIMO (`pasteAnchor` e `offsetToTarget`, em
  `frontend/src/js/tool_manager/clipboard-offset.js`); (b) `paste()` passa a recusar ANTES do
  trabalho e a devolver contagem, com o posto dito por `denialNotice` e a trava emitida como
  `STORE_OPERATION_BLOCKED`; (c) o gate de trava do Ctrl+V é REMOVIDO, deixando `paste()` como dono
  único da recusa; (d) quem decide o que o menu desenha é uma tabela pura,
  `frontend/src/js/context-menu/clipboard-menu-actions.js`, e "Duplicar Seleção" entra nela.
- **Alternativas rejeitadas:**
  - *Ancorar no CENTROIDE do conjunto*: derivaria para a parte com mais vértices, que num conjunto
    copiado é acidente de autoria, e custaria uma dependência de turf num módulo que hoje é puro.
  - *Ancorar na PRIMEIRA feição copiada*: barato e imprevisível. Copiar cinco feições e colar leva o
    conjunto para um lugar que depende da ordem de seleção, que a pessoa não vê.
  - *Manter o gate de trava no Ctrl+V e só fazer `paste()` falar*: deixaria duas fontes de verdade
    para a mesma recusa, e é o desenho que produziu o silêncio original.
  - *Dizer a frase da trava dentro de `paste()`*: escreveria uma quarta cópia de uma sentença que já
    existe, num módulo de `core`, que teria de importar a camada que fala.
  - *Recusar a colagem em CAMADA travada*: fora de escopo, e declarado. `guardWrite` não consulta
    `layers.locked` e o servidor também não, então recusar só no menu deixaria o menu mais estrito
    que o Ctrl+V para o mesmo gesto.
- **Consequências:** o clipboard passa a ser esvaziado na troca de atlas (ele vive no `StateManager`,
  em memória, e sobrevivia ao `clearAllDataStore`; colar num atlas novo levava
  `buildLayerMappingForMove` a ler as camadas de um mapa não carregado, leitura que falha ABERTO e
  chega a fabricar camada). `copy()` virou assíncrona para garantir a ferramenta antes de filtrar,
  porque com a carga tardia uma feição de tipo nunca carregado era descartada com um aviso de
  console e a pessoa lia "Nenhuma feição válida para copiar". `trajetoria` e `_temporalHome` passam
  a viajar com a geometria, em UM lugar (`translatePositionProperties`), e o segundo é o que falhava
  calado: `cleanFeature` reescreve a geometria de um Point A PARTIR do `_temporalHome` na entrada do
  repositório, então copiar durante o playback colava a cópia por cima da original com o toast de
  sucesso por cima. Fica DECLARADO, e não consertado, que colar uma feição de IMAGEM num atlas de
  servidor duplica o blob só localmente: `duplicateImageResource` grava no IndexedDB e nunca chama
  `uploadImageBlob`, então o colaborador recebe a feição e um quadro vazio.
- **Status:** aceita.

---

### 2026-09-01: o modelo de zoom da divisa mora em `tool_manager/helpers/`, e a vista salva passa na frente do desenho

- **Contexto:** a divisa ganhou o mesmo interruptor de zoom do simbolo militar (`createdAtZoom` mais `zoomCorrectionEnabled`), e a conta dele precisa ser lida em DOIS pontos que rodam sem clique nenhum: `setupBoundaryLayers` (`frontend/src/js/layers/styles/tactical.layers.js`), quando o mapa redesenha o que ja estava salvo, e `correctZoomInvariantFeatures` (`frontend/src/js/import_export/export-utils.js`), quando um PDF e produzido. Os dois sao core. A ferramenta de divisa, porem, e TARDIA desde a onda de carga sob demanda, e `frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js` fixa a pasta `military_tools` em EXATAMENTE zero modulos ansiosos. Escrever o modelo ao lado da ferramenta, como o branch de referencia fez, traria os 47 modulos daquela pasta de volta para o payload do boot.
- **Decisao:** (a) o modelo puro vive em `frontend/src/js/tool_manager/helpers/boundary-zoom.model.js`, vizinho de `zoom-correction.helpers.js` e no chunk `core` por regra ja existente do `vite.config.js`, que nao foi tocado; (b) a tabela de ferramentas ganha uma coluna nova, `zoomModelo`, para a ferramenta cuja correcao nao cabe na tripla `size`/`calculatedSize` do simbolo, e o stand-in do boot responde com os NUMEROS de forma sincrona enquanto pede a ferramenta em segundo plano; (c) em `switchMap` (`frontend/src/js/baselayers/base-layer.control.js`), `applyMapSavedPosition` passa a rodar ANTES de `setupMapFeatures`.
- **Alternativas rejeitadas:**
  - *Modelo em `military_tools/boundary_tool/`, como no branch de referencia*: a referencia nao tem carga tardia de ferramenta nem orcamento de peso por pasta, entao la a aresta e gratis e aqui custa a pasta inteira. Implementacao de referencia responde "como se escreve", nunca "o que este branch precisa".
  - *Levantar a linha de `military_tools` no orcamento*: o orcamento reprova nos DOIS sentidos de proposito, e subir o teto para caber uma folha de zero imports gastaria o guarda inteiro por 300 linhas de aritmetica.
  - *O stand-in regenerar tambem a GEOMETRIA no boot*: a geometria le Turf em todo passo, e o stand-in existe justamente para nao baixar nem a ferramenta nem os 619 kB do Turf sem clique. Ele devolve os numeros e deixa a forma para a primeira passada de zoom depois que o modulo sobe.
  - *Deixar `setupMapFeatures` antes da vista salva*: era a ordem anterior, e ela e a razao de o desenho nascer ancorado no zoom inicial do mapa e so ser corrigido pelo evento de zoom seguinte, que num `jumpTo` pode cair no mesmo quadro do restore dos dependentes.
- **Consequencias:** a inversao de `switchMap` alcanca TODA ferramenta que reancora no setup das camadas (ponto, pincel, etiqueta, simbolo militar, divisa), nao so a divisa, e por isso e decisao e nao detalhe: o que mudou foi o zoom em que aquela passada roda. `applySharedBasemap` fica como estava, porque o link carrega a propria camera e aplicar a posicao salva a sobrescreveria. A quarta ferramenta que precisar de uma conta propria de zoom acrescenta uma coluna, nao um caso especial no stand-in.
- **Adendo do mesmo dia, visto na captura do Playwright e nao em suite nenhuma:** com o texto pinado ao norte, os dois rotulos de uma divisa DIAGONAL se cruzavam sobre a linha (LESTE e OESTE ilegiveis), porque a caixa de cada rotulo passou a se estender leste-oeste enquanto o deslocamento continua perpendicular a linha. A saida e `computeTextAnchor` (`frontend/src/js/tool_manager/helpers/boundary-zoom.model.js`): o rotulo pinado ao norte pendura pela BORDA que encara a linha (as oito ancoras do MapLibre, escolhidas pelo oitante da direcao linha para rotulo, e `text-anchor` e dirigido por dado na camada), e o rotulo colado a linha continua centrado. Cada caixa fica inteira no proprio semiplano, sem mexer no ponto de colocacao nem no handle de distancia. A alternativa de aumentar o deslocamento foi recusada porque a distancia certa depende da largura do texto, que so o renderizador conhece.
- **Status:** aceita.

---

### 2026-09-01: converter feicao linear e um CREATE novo mais um DELETE antigo, e o menu esconde por POSTO e recusa por ESTADO

- **Contexto:** havia DUAS conversoes, `convertLineToArrow` e `convertLineToBoundary`, escritas a mao dentro do arquivo do menu de feicao. As duas saiam de linha e mais nada (a volta nao existia, nem a travessia entre seta e limite), e as duas carregavam a mesma familia de defeitos medidos: nenhum gate (`addFeature` recusa devolvendo `undefined` para um Leitor e para um mapa travado, e ninguem lia esse retorno, entao a tela ganhava a nova feicao, perdia a antiga e no F5 o inverso), `||` no lugar de `??` (uma opacidade de 0 virava a do padrao, um `layerId` de 0 ou vazio virava a camada implicita), copia rasa do eixo e das instancias de simbolo do limite, e artefato orfao na tela (a etiqueta de medicao da linha e os circulos e rotulos do limite, chaveados por `parent`, que so os controles deles sabem apagar).
- **Decisao:** (a) os SEIS sentidos entre `line`, `arrow` e `boundary` passam a existir, decididos por `linearConversionActions` num modulo puro, `frontend/src/js/tool_manager/helpers/linear-conversion.model.js`, e executados por `convertLinearFeature` em `frontend/src/js/tool_manager/helpers/linear-conversion.helpers.js`; (b) a afordancia segue a assimetria de 2026-08-24: POSTO some (o comando nao e desenhado) e ESTADO desenha com `aria-disabled` mais `title` e recusa o CLIQUE nomeando o estado, nunca a propriedade `disabled`; (c) o gate de posto pede AS DUAS capacidades de `LINEAR_CONVERSION_CAPABILITIES`, porque converter e um CREATE mais um DELETE e as duas resolvem para flags diferentes; (d) a perda de GRUPO e aceita e ANUNCIADA no mesmo toast do sucesso, em vez de consertada.
- **Alternativas rejeitadas:**
  - *Uma unica operacao de sync de "conversao"*: exigiria alvo novo no servidor para um efeito que o par ja reconstroi a partir do par CREATE mais DELETE. O e2e de contrato (`frontend/tests/e2e/feature-convert.e2e.test.js`) e o de integracao (`backend/tests/integration/sync-conversao-de-feicao.test.js`) medem que o par viaja num push so, com dois acks, e que o mapa travado recusa AS DUAS metades: e a recusa PARCIAL que produziria duplicacao silenciosa, e ela nao acontece porque `feature` esta entre os alvos filhos do cadeado.
  - *Recolocar a feicao no grupo da antiga*: nao existe operacao de store que ACRESCENTE feicao a grupo existente, e `removeFeature` chama `removeFeatureFromAllGroups`. Inventar a operacao aqui seria mudanca de sync dentro de uma mudanca de UI.
  - *Gatear so por `CREATE_FEATURE`*: ofereceria a quem edita e nao apaga uma travessia que morre na metade, deixando as DUAS feicoes vivas e uma op recusada congelando a fila de saida.
  - *Esconder o comando na seta COMBINADA*: e estado reversivel, e o desfaz ("Separar Setas") esta a duas linhas no MESMO menu. Esconder ensinaria menos que recusar nomeando.
  - *Copiar as propriedades da origem e filtrar as que nao servem*: e a forma que deixa `isMerged` e os ramos numa feicao que nao e mais seta. O bloco nasce dos padroes do DESTINO mais uma lista explicita de preservados, e `DROPPED_BY_SOURCE` fica como DECLARACAO cobrada por teste nos seis sentidos.
- **Consequencias:** `canSplitArrows` passou a derivar de `isMergedArrow`, tirando a terceira copia daquele predicado (`canMergeArrows` NAO foi tocado: ele tem espelho proprio em `military_tools/arrow_tool/arrow-merge.js`, com guarda que compara os dois corpos). A limpeza do artefato de origem reusa o que cada controle ja tem (`deleteFeatures` do limite, que roda na fila serial dele e filtra as duas fontes derivadas por `parent`; `removeFeatureMeasurement` da linha), em vez de refazer o filtro aqui e competir com aquela fila. Converter para limite grava a ancora de zoom e chama `computeBoundaryZoomSizes` DEPOIS do bloco inteiro, senao os quatro derivados do padrao ficam por cima dos reais. `lineWidth` e grampeado na faixa do painel do DESTINO (`LINE_WIDTH_RANGE`: a linha vai a 15, seta e limite param em 10), porque escrever 14 numa seta produz um cursor que mostra um valor que ele mesmo nao reproduz. O controle de destino e carregado por `ensureControl` antes de qualquer coisa, porque seta e limite sao ferramentas tardias e converter e justamente o gesto que alcanca um tipo sem clicar no botao dele. O lote de desfazer ganhou duas saidas (`discardBatchUndo` no fracasso), e `attributes` passou a atravessar a conversao, o que as duas antigas nao faziam. As conversoes de PONTO ficaram FORA desta mudanca e seguem sem gate: divida declarada, nao simetria.
- **Status:** aceita.


---

### 2026-09-02: a lista de buckets que carregam imagem por feição é DERIVADA, e vale para colar e para o F5

- **Contexto:** copiar e colar uma medida de coordenação ou uma declinação magnética colava a feição sem o símbolo; o traço só aparecia depois de um F5. A cadeia é toda legítima até o último passo. As famílias com blob desenham um raster registrado no MapLibre sob o `properties.id` DA FEIÇÃO, porque o estilo resolve por `'icon-image': ['get', 'id']` (`frontend/src/js/layers/styles/symbol.layers.js`), e não há fallback: id sem imagem registrada desenha nada. `paste()` cunha um id novo por feição e duplica o blob sob esse id, decidindo por `hasImageResource`, que é DERIVADA do registro de tipos e portanto já cobria os quatro. Quem não cobria era `loadPastedImages` (`frontend/src/js/tool_manager/clipboard_manager.js`), que varria uma lista FECHADA escrita à mão, anterior aos dois tipos, com os plurais digitados. O gêmeo dessa varredura, `setImages` (`frontend/src/js/layers/layer_setup.js`), era outra lista fechada escrita à mão, e estava COMPLETA: é por isso que o F5 consertava, e é por isso que ninguém percebeu a divergência. Nada emitia erro, e nada emitia evento: `FEATURE_CREATED` só sai pelo caminho remoto, então a colagem local nunca passa por `setupMapFeatures`.
- **Decisão:** (a) a lista nasce de `IMAGE_RESOURCE_STORAGE_TYPES` (`frontend/src/js/store/store.constants.js`), a visão PLURAL de `IMAGE_RESOURCE_FEATURE_TYPES` obtida por `getStorageTypeFromSource`, derivação de segunda ordem declarada como tal ao lado da função, para não contradizer a contagem das seis constantes de uma passada; (b) a varredura vira UMA, `collectImageResourceFeatures` (`frontend/src/js/layers/feature-images.js`), com a irmã `collectImageResourceIds` para quem só precisa do id; (c) os DOIS caminhos passam a ler dela, e nenhum dos dois volta a escrever um plural.
- **Alternativas rejeitadas:**
  - *Acrescentar os dois tipos que faltavam na lista de colar e manter as duas listas à mão*: conserta este bug e deixa o mecanismo que o produziu de pé. As duas listas divergiram exatamente uma vez, em silêncio, e a próxima família com blob teria a mesma chance de entrar em uma só. Uma lista duplicada só espera a próxima ferramenta para ficar errada.
  - *Escrever a lista plural à mão numa constante nova, em vez de derivá-la*: os plurais são irregulares (`boundary` vira `boundarys`), então uma lista escrita é uma aposta de grafia por linha nova, e a grafia errada não dá erro: o bucket simplesmente não casa.
  - *Enfileirar o upload do blob para os tipos regeneráveis, tratando a ausência como falta de sync*: recusada porque não é o defeito. O blob de símbolo militar, medida de coordenação e declinação NUNCA sobe ao servidor, por desenho: ele é reconstrutível a partir das propriedades sincronizadas, e o par o regenera pelo registrador em `frontend/src/js/layers/image-regen-registry.js`. Subi-lo trocaria um bug local por tráfego permanente e por uma segunda fonte de verdade para um pixel derivado.
  - *Emitir `FEATURE_CREATED` na colagem local para cair no `setupMapFeatures`*: remontaria camadas, terreno e catálogo inteiros a cada Ctrl+V, e mudaria o significado de um evento que hoje é do caminho remoto, para consertar quatro linhas de varredura.
- **Consequências:** uma família nova com `imageResource` no registro passa a ser registrada pelos dois caminhos no mesmo commit, sem ninguém tocar em nenhum dos dois arquivos. `setImages` ficou tolerante a bucket ausente nos quatro (antes `features.images` e `features.military_symbols` eram lidos sem guarda e os outros dois com `|| []`), e feição sem `properties.id` sai da varredura em vez de chegar como `undefined` ao `map.addImage`. Fica DE FORA, e continua declarado no cabeçalho de `frontend/src/js/tool_manager/clipboard_manager.js`, o outro defeito da mesma vizinhança: colar uma feição de IMAGEM num atlas de servidor duplica o blob só localmente, porque `IDUtils.duplicateImageResource` grava no IndexedDB e nunca chama `uploadImageBlob`. Aquele é o tipo cujo blob É de servidor, e por isso ele não se resolve por derivação nenhuma.
- **Status:** aceita.

---

### 2026-09-02: a importação de formato externo perde o teto de 1000 geometrias, e a preparação passa a mostrar progresso

- **Contexto:** havia DOIS tetos gêmeos na entrada de dado externo, e nenhum dos dois nasceu de medição. O de `importGeoJSON` (`frontend/src/js/import_export/import.control.js`), que serve GeoJSON, Shapefile, KML, KMZ, GPX e CSV, e o do conversor de CSV (`frontend/src/js/import_export/csv/csv-to-geojson.js`), numa constante privada de nome MAX_FEATURES. O `git log` conta a origem: o valor era 100 em 2025-08 e subiu para 1000 em `ddc516e1` (2026-01-22), num commit cuja mensagem inteira é "bug fix". Não há número medido em lugar nenhum que justifique 1000, e o teto recusava o arquivo INTEIRO com uma frase de limite, que é a pior forma de recusa: a pessoa não tem o que fazer com ela. O dono pediu que saíssem.
- **Decisão:** (a) os dois tetos saem, e o que sobra em cada ponto é a guarda de vazio, que continua sendo erro legítimo (`Nenhuma geometria válida encontrada para importar` e a irmã do CSV); (b) o laço de preparação por feição de `importGeoJSON` passa a rodar sob o indicador de progresso que já existia, com texto e barra atualizados a cada passo e o event loop cedido junto, e `_hideProgressIndicator` num `finally`; (c) o passo é ADAPTATIVO, `prepareProgressStep`, exportado do próprio `import.control.js` e testado como função pura: cerca de vinte atualizações por importação, nunca mais grosso que `PREPARE_PROGRESS_STEP` (100) e nunca mais fino que uma feição; (d) a persistência continua sendo UM lote (`saveAndUpdateMap` chama `addFeatures` uma vez), e isso é o inverso de um esquecimento.
- **Alternativas rejeitadas:**
  - *Fatiar também a persistência*: cada fatia reescreveria o documento do mapa inteiro (`updateMapDataCompat` grava o documento, não o delta), então N fatias custam N reescritas de um documento que cresce a cada fatia. O laço de preparação é o único passo por feição, e é o que trava a interface: uma linha calcula perfil de elevação com dezenas de chamadas de turf.
  - *Passo fixo de 100*: deixaria a barra pregada em 0% em toda importação abaixo de 100 geometrias, que são a maioria. O teto de 100 sobrevive como limite superior do passo adaptativo, para que uma importação enorme não pague um repaint mais um macrotask a cada poucas feições.
  - *Baixar o teto para um número medido, em vez de removê-lo*: seria trocar um número sem origem por outro, e o pedido do dono é sobre a recusa, não sobre o valor.
  - *Módulo folha próprio para `prepareProgressStep`*: `import.control.js` está no grafo ansioso da página do mapa, e `frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js` fixa a pasta `import_export` em exatamente 14 módulos ansiosos, orçamento fechado nos dois sentidos. Uma folha de zero imports gastaria um slot daquele orçamento por quatro linhas de aritmética. A função fica no arquivo, exportada.
  - *Registrar telemetria de uso com a contagem importada*: `registrarUso` só aceita valor do catálogo de eventos, e o catálogo é espelhado em três folhas mais um CHECK no banco. Evento novo é mudança que cruza os dois pacotes, e não cabe dentro desta.
- **Consequências:** o custo real de uma importação grande não é mais a preparação, é o SYNC, e ele é conhecido e não foi consertado aqui. Em atlas de servidor, `addFeatures` enfileira uma op de CREATE POR FEIÇÃO (o `deferAsync` da transação), então 5000 geometrias viram 5000 ops. A saída usa `FLUSH_BATCH_SIZE` de 25 contra um `MAX_OPS_PER_PUSH` de 500 no servidor, ou seja, 200 pushes para aquele lote, ao custo de cerca de 1,26 ms por op documentado em [`../wiki/capacidade-de-uma-instancia.md`](../wiki/capacidade-de-uma-instancia.md), com o agravante de que a fila do enésimo escritor cruza o `lock_timeout` e os OUTROS levam recusa. E acima de `MAX_QUEUE_SIZE` (10000) a compactação da fila não ajuda: ela funde CREATE com UPDATE e cancela CREATE com DELETE, e uma importação é CREATE puro, que não comprime nada, enquanto cada enfileiramento relê a fila inteira, o que é um degrau quadrático. Isto fica DECLARADO, não consertado: quem importar dezenas de milhares de feições num atlas de servidor vai sentir, e o lugar de consertar é a fila, não o teto que saiu. Os tetos que NÃO mudaram: 50 MB de tamanho de arquivo e os 30 s de leitura, ambos em `FILE_LIMITS`. O indicador de progresso é slot único (`_progressElement`), e nenhum dos três chamadores de `importGeoJSON` chega com um de pé: o de leitura é removido em `reader.onloadend`, antes de `processFile` resolver, e o caminho do CSV nunca abre um, porque lê por `file.text()`.
- **Fechamento dos dois custos declarados, no mesmo dia:** os dois números que este verbete deixou por escrito foram medidos e fechados na entrada "a importação para de calcular perfil de elevação, e a compactação da fila ganha marca d'água", mais abaixo neste arquivo. O perfil de elevação por linha, citado aqui como a razão de o laço de preparação ser o passo caro, simplesmente não é mais calculado na importação: `shouldComputeProfileOnImport` faz o ramo `lines` perguntar pelo interruptor `profile` antes de chamar `calculateProfile`, como todo outro sítio de linha já perguntava, e a linha importada nasce com o interruptor desligado. O degrau quadrático da fila acima de `MAX_QUEUE_SIZE`, declarado aqui como "o lugar de consertar é a fila", virou uma marca d'água em `_growAndMaybeCompact`: acima do teto a compactação passa a rodar uma vez por degrau de 1000 operações, e não uma vez por operação. O terceiro custo deste parágrafo, a op de CREATE por feição contra `FLUSH_BATCH_SIZE` de 25, continua aberto e agora é o gargalo isolado.
- **Status:** aceita.

---

### 2026-09-02: a área da medição 3D sai em metros e quilômetros quadrados, sem hectares, e a exibição deriva do VALOR

- **Contexto:** a formatação de área do visualizador 3D vivia numa função privada de `frontend/src/js/3d_models_viewer_tool/tools/measurement_tool_3d.js`, com três faixas (m², ha, km²), e o dono pediu que a faixa de hectares saísse. Trocar só a função não bastaria, e a razão é o que separa este caso do mesmo pedido no branch de referência: a medição 3D grava o texto formatado ao lado do valor numérico E é entidade de sync (`measurement3d`, roteada para o alvo `cesium3d` em `backend/src/modules/sync/sync.service.js`). Ou seja, aquela string VIAJA ao par. Um cliente novo que confiasse nela leria hectares em toda medição antiga e em toda op vinda de um cliente antigo, para sempre.
- **Decisão:** (a) as duas formatadoras viram um módulo puro de ZERO imports, `frontend/src/js/3d_models_viewer_tool/measurement-format-3d.js`, com `formatDistance3D` movida verbatim e `formatArea3D` sem o ramo de hectares; (b) nasce ali `formatMeasurementResult3D`, que DERIVA o texto do valor numérico quando ele existe e é finito, e só cai na string gravada quando não há valor de onde derivar; (c) a ferramenta (rótulos do Cesium) e o painel (`frontend/src/js/3d_models_viewer_tool/components/measurement-panel-3d.js`) passam a exibir por ela, e `finalizeMeasurement` continua gravando `formatted`, porque o campo é contrato de sync e apagá-lo quebraria o par antigo; (d) o módulo mora na RAIZ de `3d_models_viewer_tool/`, fora de `tools/` e de `services/`, e o nome evita a substring do nome da pasta de medição 2D, porque as duas coisas são regras de chunk do `vite.config.js` em sentidos opostos.
- **Alternativas rejeitadas:**
  - *Trocar só a função privada e deixar a exibição ler `formatted`*: é a forma que parece pronta e que deixa hectares vivos em todo registro salvo e em toda op recebida. O sync é o que torna essa alternativa pior aqui do que numa base de dado só local.
  - *Migrar os registros salvos, reescrevendo `formatted`*: exigiria op de escrita de entidade para um efeito que a derivação entrega de graça, e não alcançaria o par de build antigo, que continuaria mandando "ha".
  - *Deixar de gravar `formatted`*: o campo é lido pelo par e por qualquer consumidor antigo do snapshot; removê-lo é mudança de contrato para economizar uma string.
  - *Alinhar a medição 2D*: ela tem seletor de unidade próprio, com hectare entre as opções que a pessoa escolhe. O pedido é sobre o 3D, que não pergunta nada.
  - *Guardar entrada não finita*: as privadas não guardavam, e mudar isso junto misturaria duas decisões. `NaN` continua saindo como `NaN m²` e negativo cai no ramo de metros, os dois asseridos.
- **Consequências:** o texto exibido pode DIVERGIR do texto gravado, e isso é o desenho, não um defeito: o valor numérico é o canônico e a string é histórico. Duas casas decimais nos dois ramos, como antes; a fronteira de área é 1e6 m² e a de distância 1000 m. A borda que muda de comportamento é 10000 m², que era `1.00 ha` e passa a ser `10000.00 m²`. O teste de propriedade precisou de um gerador LIMITADO à janela antiga de hectares: medido em onze rodadas, o `fc.double` sem limite reprovou o ramo de hectares reposto em UMA delas e passou verde nas outras dez, enquanto o gerador limitado reprovou em cinco de cinco. Um verde probabilístico ali seria exatamente a cobertura vazia que a constituição descreve. Onde o módulo cai no bundle foi MEDIDO, não suposto, e está no `fileoverview` dele.
- **Status:** aceita.


---

### 2026-09-02: continuar uma feição linear é um UPDATE da MESMA feição, e a alça anda presa à alça de vértice

- **Contexto:** linha, seta e linha de limite só cresciam por vértice inserido no meio; prolongar uma delas exigia desenhar outra feição e conviver com duas. O pedido do dono foi uma alça clicável na primeira e na última ponta que reabra a própria ferramenta continuando a MESMA feição. Duas propriedades do repositório decidiram o desenho, e nenhuma das duas se adivinha: `updateFeature` (`frontend/src/js/store/feature.operations.js`) devolve `undefined` em TODOS os desfechos, o de sucesso inclusive, porque `guardWrite` recusa por posto ou por trava, emite `STORE_OPERATION_BLOCKED` e simplesmente retorna; e as alças de VÉRTICE das três ferramentas nascem sem gate de posto, de modo que um Leitor as recebe e a store recusa o arrasto em silêncio.
- **Decisão:** (a) a decisão pura mora em `frontend/src/js/tool_manager/helpers/line-extension.model.js` (zero DOM, zero store, node-testável) e o impuro em `frontend/src/js/tool_manager/helpers/line-extension.helpers.js`; os três controles só fiam. (b) AFORDÂNCIA, o POSTO SOME: `extensionDenialReason` pergunta PRIMEIRO por `checkPermission(GuardAction.UPDATE_FEATURE)`, então quem não pode editar não recebe alça nenhuma, e a frase, quando algum caminho precisa dela, vem de `denialNotice(perm.required)`, keyed pela capacidade e nunca pelo papel. (c) O ESTADO NÃO ganha superfície nova: a alça acompanha a alça de vértice, ligada em `createEditHandles`, que `selectFeature` não chama com o mapa travado e que feição bloqueada nunca alcança; o que o estado ganha é a RECONSULTA do mesmo predicado no clique, porque o par pode travar o mapa com a alça já na tela, e aí a recusa nomeia o estado. (d) ORDEM DAS ESCRITAS em `finishExtending`, nos três controles: gate antes de qualquer escrita, depois `updateFeature`, depois RELEITURA por `getFeatureById`, e só um eixo relido que case com o pedido (`storedSpineMatches`) autoriza tocar a fonte do MapLibre; no limite, só então `updateDependentFeatures`. (e) continuar pela ponta INICIAL prepende os pontos em ordem invertida de clique, o que mantém a cabeça da seta na última coordenada.
- **Alternativas rejeitadas:**
  - *Uma op de sync nova para "estender"*: continuar reescreve `baseCoordinates` da MESMA feição, com o mesmo id, que é exatamente o que o `UPDATE` de feição já expressa. Op nova custaria vocabulário nos dois pacotes, contrato de envelope e um segundo caminho de aplicação remota, para um efeito que o existente entrega inteiro.
  - *Desenhar a alça com `aria-disabled` para quem não pode continuar*: a regra da casa manda desenhar e recusar o clique só quando o bloqueio é REVERSÍVEL e a pessoa pode ser quem o reverte. Aqui os dois estados reversíveis (mapa travado, feição bloqueada) já impedem a alça de VÉRTICE de existir, então a alça de continuação seria a única superfície acionável de uma tela que o produto escolheu deixar inerte; e o bloqueio por posto é permanente enquanto o papel for o que é. Inventar um comando morto ali transformaria a ponta da linha num catálogo do que a pessoa não é.
  - *`saveFeatureChanges` no lugar de `updateFeature`*: o ajudante dos três controles engole o próprio erro num `catch`, então uma falha de persistência chegaria à releitura vestida de recusa, e a distinção entre "a store recusou" e "a escrita quebrou" desapareceria justamente onde ela decide o que a tela mostra.
  - *Pintar a fonte antes da store, como fazem os outros caminhos de edição destes três arquivos*: é o que obriga a republicar a feição original num `catch`, e essa republicação só cobre o desfecho que LANÇA. Uma recusa por posto ou por trava não lança, então a tela ficaria mostrando uma continuação que nada persistiu até o próximo F5, que é o fantasma que a conversão linear já pagou uma vez.
  - *Ler o retorno de `updateFeature`*: não existe retorno para ler. A lição "leia o retorno" do lote da conversão vale para `addFeature`, que DEVOLVE a feição criada, e não transfere para o update; foi por isso que a releitura precisou virar o portão.
- **Consequências:** a alça herda o ciclo de vida da alça de vértice, então todo caminho que mexe num vértice (arraste, mover, inserir, remover, mudar propriedade) a redesenha, e toda desseleção a recolhe; `hideExtensionHandles` é idempotente e chaveado por mapa num `WeakMap`, porque o mapa oculto do mosaico de PDF coexiste com o principal. O botão engole `click`, `mousedown`, `pointerdown` e `touchstart`, senão um toque arrastaria a feição inteira e largaria um vértice fantasma, e o clique é adiado um quadro, senão ele próprio alcançaria o ouvinte de mapa que a troca de ferramenta acabou de instalar e viraria o primeiro vértice. Esc e troca de ferramenta cancelam sem gravar nada por construção: `deactivate` esquece a sessão, e nada foi escrito antes de concluir. A seta COMBINADA é recusada pelo predicado COMPARTILHADO `isMergedArrow`, o mesmo da conversão, e não pela chave `isMerged` sozinha: a primeira versão usou a chave e foi corrigida na revisão do mesmo dia, porque `isMerged` já apareceu verdadeiro SEM os ramos (uma separação interrompida), e nesse estado a feição é uma seta comum com um sinalizador mentiroso, que desenha por `baseCoordinates`, continua sem problema e não tem "Separar Setas" oferecido para limpar a chave. Recusar ali tiraria a alça sem uma palavra e sem saída, que é o desfecho oposto ao que a recusa existe para dar. O peso ansioso da página do mapa subiu 23 kB (os dois folhas, que o controle de linha importa estaticamente porque `createEditHandles` liga a alça de forma síncrona), e a banda de `frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js` foi RECENTRADA no mesmo commit: ela já estava a seis kB do teto por deriva anterior, isto é, sem folga para arquivo novo nenhum, e nesse estado ela reprovava o próximo arquivo em vez da próxima pasta.
- **Status:** aceita.

---

### 2026-09-02: mover ou copiar uma camada inteira para outro mapa, e a transferência é COMPOSTA

- **Contexto:** o pedido do dono foi tirar uma camada do mapa corrente e pô-la em outro mapa do mesmo atlas, com as feições dentro, em duas variantes (mover e copiar). Três propriedades da store decidiram o desenho, e nenhuma se adivinha lendo o código vizinho. (1) `memoryStore` é hidratado UM MAPA POR VEZ, e o caminho de LEITURA de camada passa por um ajudante de ESCRITA, então ler as camadas de um mapa nunca visitado FABRICA uma lista com só a camada padrão: escrever o destino por ali persistiria essa lista por cima das camadas reais, sem erro em lugar nenhum. (2) A fila de `frontend/src/js/store/document-lock.js` é FIFO e sem reentrância, e `addFeatures` e `deleteLayerFeatures` já tomam a trava do documento: uma operação composta que a tomasse esperaria por si mesma para sempre. (3) A trava de OUTRO mapa não se lê pelo cache de memória, porque em atlas LOCAL só o mapa corrente entra nele; a pergunta certa é `isMapLocked`, que lê o disco.
- **Decisão:** (a) a aritmética de forma nasce num módulo puro, `frontend/src/js/store/layer-transfer.model.js` (`buildTargetLayerName`, `partitionTransferableFeatures`, `remapFeatureForTransfer`, `buildTargetLayerRecord`), com uma única importação, que é folha; (b) `transferLayerToMap` (`frontend/src/js/store/layer-transfer.operations.js`) orquestra e NÃO toma a trava do documento, entrando na lista de compostos declarada no cabeçalho de `frontend/src/js/store/document-lock.js`; (c) as camadas do destino são lidas por `getLayersCompat` e escritas por `setLayersCompat`, e a memória só é espelhada SE aquele mapa já estiver hidratado; (d) a ordem é DESTINO PRIMEIRO, com leitura de volta por caminho independente, e só então a origem é esvaziada, com rollback do registro (e dos blobs duplicados localmente) se o destino não aceitar tudo; (e) a op de camada é logada com o mapId resolvido por `mapResolver`, nunca com o nome; (f) o menu do cabeçalho da camada nasce de um modelo puro de zero imports, `frontend/src/js/features_tab/layer-menu-actions.js`, com a assimetria da casa: POSTO esconde, ESTADO desenha e recusa o clique nomeando o estado; (g) o destino se escolhe num modal, `frontend/src/js/modals/layer-transfer.modal.js`, que lista o mapa travado com selo e recusa o clique nele.
- **Alternativas rejeitadas:**
  - *Escrever a camada do destino pelo LayerManager (`createLayerForImport`)*: é o caminho curto e o que produz o pior defeito desta família. Ele escreve pela memória, e a memória de um mapa nunca visitado é fabricada na hora com só a camada padrão, então a persistência seguinte apaga as camadas reais de um mapa que ninguém abriu. O duplo de teste em `frontend/tests/store/layer-transfer.test.js` faz aquele método LANÇAR, para que a alternativa não volte em silêncio.
  - *Envolver a operação inteira em `withMapDocument`*: parece o mais seguro e é o único desfecho que trava a interface para sempre. A fila não tem reentrância, e a composta espera pelas duas folhas que ela mesma chama.
  - *Ler a trava do destino no cache de memória de mapas travados*: barato e errado fora de atlas de servidor. Aquele conjunto só é completo quando o snapshot o preenche; em atlas local ele tem no máximo o mapa corrente, e a pergunta é sempre sobre OUTRO mapa. O caso de teste que mede isso deixa o conjunto vazio de propósito e mesmo assim exige a recusa.
  - *Mover as feições de análise junto, apagando-as na origem*: as saídas processadas delas ficam para trás junto com o pai, e o mecanismo que as segura não é o que a intuição sugere: os baldes delas SÃO varridos por `getAllStorageTypes`, e o que as pega é herdarem o `source` do pai, porque `generateProcessedFeatures` as cunha espalhando as propriedades dele. Levar o pai sem elas o deixaria desenhado pela metade no destino e órfãs na origem. Pior: o passo que esvazia a origem varre TODO balde por id de camada, de modo que um move que "pulasse" a análise a destruiria na origem enquanto o aviso na tela dizia que ela tinha ficado. Por isso as duas variantes divergem: copiar pula e diz quantas, mover é RECUSADO enquanto elas existirem.
  - *Inventar uma op de sync para a saída da feição do grupo de origem*: não existe op incremental de participação em grupo neste build, e uma op fabricada seria recusada pelo servidor, congelando a fila de saída inteira, que é o defeito caro desta família.
  - *Emitir op de DELETE de feição para a origem no modo mover*: seria a forma óbvia de fazer o par ver a feição sair, e ela apagaria a linha que acabou de se mudar. Mover mantém o id, e quem move a linha no servidor é o próprio `feature create` carimbado com o mapa de destino; com LWW por ordem de chegada, um delete do mesmo id chegando depois soft-deleta o que foi movido.
  - *Importar o carregador de blobs estaticamente*: `frontend/src/js/import_export/atlas-image-upload.js` pertence a um grupo de chunk lazy, e uma aresta estática do store para lá o puxaria para o payload ansioso da página do mapa. Ele é alcançado por `import()` dentro do único ramo que precisa dele.
- **Consequências:** copiar num atlas de SERVIDOR sobe os blobs novos por `buildImageUploads` mais `uploadImagesInChunks` ANTES de gravar as feições, porque `storeImage` não sobe nada e o flush de saída parte a cada 1,5 s: sem isso o par recebia a feição e a imagem apontava para um id que o servidor nunca viu. Mover não sobe nada, porque os ids não mudam, e por isso `deleteLayerFeatures` ganhou `releaseImages`: liberar os blobs ali deixaria as feições recém-movidas apontando para o nada. DUAS CONSEQUÊNCIAS FICAM DECLARADAS E NÃO CONSERTADAS. A primeira: a saída da feição movida dos GRUPOS do mapa de origem não sincroniza, então o par continua listando a feição dentro do grupo antigo até o próximo snapshot. A segunda era da mesma família e FOI CONSERTADA no mesmo lote, depois de a medição mostrar que ela não era do move: como `deleteLayerFeatures` não loga op por feição, quem apaga as feições no servidor é a cascata do delete de camada (`backend/src/modules/sync/sync.service.js`, o bloco "2.2 cascade"), e o cliente que RECEBIA aquele delete só filtrava a lista de camadas. Ou seja, o par ficava com as feições de TODA camada excluída, não só das movidas, e a tela ainda as escondia, porque o filtro de visibilidade lista camadas e a camada tinha sumido: divergência invisível. O espelho entrou em `cascadeRemoteLayerDelete` (`frontend/src/js/store/sync/remote-operation-handler.js`), com o mesmo escopo do servidor (camada E mapa) e idempotente, emitindo um `FEATURE_DELETED` por feição. Consertar do lado do AUTOR, emitindo `feature delete` junto do delete da camada, seria pior: mover uma camada mantém o id da feição e a move por um `feature create` carimbado com o mapa de destino, então com LWW por ordem de chegada aquele delete apagaria exatamente o que acabou de se mudar. Guarda: `frontend/tests/integration/cascata-de-camada-no-par.repro.test.js`. De passagem, um defeito antigo foi consertado: `deleteLayerFeatures` entregava o tipo PLURAL a `removeFeatureFromAllGroups`, que indexa pelo SINGULAR, e a limpeza não casava com nada, deixando referência órfã em todo grupo (repro em `frontend/tests/integration/deleta-camada-limpa-grupo-pelo-singular.repro.test.js`). Os quatro arquivos novos entram no grafo ANSIOSO da página do mapa (o barril do store puxa a operação, o modelo vem atrás dela, o menu vem da aba de feições e o modal vem do barril de modais) e somam cerca de 50 kB de fonte, medidos: a banda de `frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js` foi recentrada por outro lote do mesmo dia, por outra razão, e esta contribuição cabe dentro dela sem novo ajuste.
- **Adendo de 2026-09-02, a DÍVIDA DO GRUPO foi fechada, e a alternativa rejeitada acima estava factualmente errada:** este verbete deixou declarado que "a saída da feição movida dos GRUPOS do mapa de origem não sincroniza", e rejeitou consertá-la dizendo que "não existe op incremental de participação em grupo neste build, e uma op fabricada seria recusada pelo servidor". A segunda metade dessa frase é falsa, e conferi-la custou uma leitura do servidor: o alvo `group_feature` existe em `TARGET_TABLE_MAP` desde sempre, aplica `INSERT ... ON CONFLICT DO NOTHING` no create e um DELETE escopado ao atlas no delete (`backend/src/modules/sync/sync.service.js`), e `frontend/tests/e2e/group-ops.e2e.test.js` já o exercitava com envelope montado à mão. O que não existia era o lado do CLIENTE. A correção está na entrada de 2026-09-02 sobre a saída de uma feição do grupo, abaixo, e ela alcança esta transferência sem tocar em `frontend/src/js/store/layer-transfer.operations.js`: quem loga é `removeFeatureFromAllGroups`, que a transferência já chama.
- **Adendo do SERVIDOR, do mesmo dia:** a metade de servidor desta decisão estava ASSUMIDA e não medida, e o e2e de contrato a refutou. O upsert de create de feição (`backend/src/modules/sync/sync.service.js`) guardava o `DO UPDATE` só pela lápide (`WHERE features.deleted_at IS NOT NULL`), de modo que `map_id` NUNCA mudava por op: um create de um id VIVO carimbado com outro mapa escrevia zero linhas e voltava acked como sucesso, e o destino vinha vazio no snapshot. A regra nova é que um create que chega para uma linha VIVA com `map_id` DIFERENTE, em mapa do MESMO atlas, é um MOVER, e o último a chegar vence, como em todo o resto do modelo LWW por ordem de chegada: o `SET` ganhou `map_id` e o `WHERE` ganhou um segundo disjunto por `IS DISTINCT FROM`. Três propriedades continuam valendo, e são elas que tornam o disjunto barato: o replay no MESMO mapa segue inerte (a linha viva não muda, que é o guard antigo por inteiro), quem barra o mapa de OUTRO atlas continua sendo o `INSERT ... SELECT ... WHERE EXISTS` e não esta cláusula (sem linha materializada não há conflito a resolver, então nada se move), e a regra é de FEIÇÃO só, porque grupo, camada, 3D e 360 também carregam `map_id` e hoje não mudam de mapa. O CUSTO é o simétrico do que este verbete já aceita para o delete: um create ATRASADO de um cliente que ainda tinha a feição no mapa antigo a traz de volta, e o que estreita a janela é a compactação de CREATE+UPDATE na fila de saída, não uma garantia. E há uma consequência que cai de graça e é justamente o que faz o passo 3 da transferência funcionar: a cascata de exclusão de camada mira `layer_id` E `map_id`, e a linha movida trocou os dois, então apagar a camada de ORIGEM não a alcança; pelo mesmo motivo um delete de feição escopado à origem vira no-op na linha que já se mudou. Guardas: `backend/tests/integration/sync-feicao-muda-de-mapa.test.js` (cinco casos, três dos quais reprovam com o `WHERE` antigo) e `frontend/tests/e2e/layer-transfer.e2e.test.js`, que mede o lote inteiro contra o servidor real.
- **Status:** aceita.

---

### 2026-09-02: o blob COLADO sobe pela porta bulk, e quem NÃO sobe é quem o par regenera

- **Contexto:** o cabeçalho de `frontend/src/js/tool_manager/clipboard_manager.js` declarava o buraco havia semanas: colar uma feição de IMAGEM num atlas de SERVIDOR duplicava o blob só no IndexedDB. `duplicateImageResource` é `getImage` mais `storeImage`, as duas locais, e não existe op incremental de imagem no vocabulário de sync, então a op da feição viajava sozinha. No par, `getImage` errava o cache local, caía no backend, tomava 404, e o carregador instalava o PLACEHOLDER DE ERRO: feição presente, moldura vazia, e nenhuma linha de erro dos dois lados. Vale igual para "Colar Aqui" e "Duplicar Seleção", que passam pelo mesmo `paste()`. A metade de servidor já existia e já estava em uso pela transferência de camada, que resolvera o MESMO problema em 2026-09-02 com um ajudante privado de vinte e nove linhas.
- **Decisão:** (a) aquele ajudante privado vira módulo da store, `frontend/src/js/store/upload-copied-blobs.js`, exportando `uploadCopiedBlobsIfRemote`; (b) ele recebe IDS, não blobs, e o portão de atlas remoto fica DENTRO dele, antes das leituras, de modo que em atlas local a chamada custa zero leitura de IndexedDB e nenhum chamador repete a pergunta `isRemoteStoreSync`; (c) `paste()` (`frontend/src/js/tool_manager/clipboard_manager.js`) o chama depois de duplicar os blobs e ANTES de `addFeatures`, com os ids das feições que carregam blob E não têm regenerador; (d) quem separa as duas famílias é `getImageRegenerator` (`frontend/src/js/layers/image-regen-registry.js`), consultado por tipo, e nunca uma lista fechada nova; (e) `frontend/src/js/store/layer-transfer.operations.js` passa a usar o mesmo ajudante, sem mudança de comportamento (as 42 asserções daquele arquivo continuam verdes).
- **Alternativas rejeitadas:**
  - *Uma lista fechada de tipos que sobem, escrita no ajudante*: seria a QUARTA cópia de uma lista de tipos de imagem neste repositório, e a terceira já ficou dois tipos atrás da irmã e desenhou vazio até um F5 (a decisão de hoje mais cedo sobre `collectImageResourceFeatures`). O registro de regeneração já é a pergunta certa, é povoado de forma ANSIOSA por `initToolRegistry` no boot do mapa, e responde por tipo.
  - *Subir também o raster de símbolo militar, medida de coordenação e declinação*: seria peso morto em toda colagem daquelas três famílias, e faria o 404 delas, que é o caminho NORMAL do desenho, parecer defeito. O par as regenera das propriedades sincronizadas, e é por isso que o blob delas nunca subiu.
  - *Uma op de sync nova para o blob*: op carrega documento, não bytes; o envelope teria de crescer nos dois pacotes e a fila de saída passaria a transportar megabytes, com compactação que não comprime nada. A rota bulk já existe e já preserva o `localId` como id, que é a propriedade sem a qual a feição colada apontaria para outro id.
  - *`uploadImageBlob` (`frontend/src/js/store/sync/image-sync.js`), que é a porta de UMA imagem*: ela cunha o id no servidor e devolve outro, então a feição colada teria de ser reescrita em volta da resposta. A porta bulk é a única que aceita id escolhido pelo cliente.
  - *Receber blobs em vez de ids*: obrigaria cada chamador a ler o IndexedDB ANTES do portão, ou seja, a pagar a leitura em atlas local, ou a repetir o `isRemoteStoreSync` do lado de fora, que é exatamente a pergunta que já divergiu entre dois pontos deste produto.
  - *Abortar a colagem quando a subida falha*: a assimetria é deliberada e é a mesma da transferência de camada. Uma subida falha custa uma figura; abortar custa o gesto inteiro, com os ids já cunhados e os blobs já duplicados.
  - *Exportar o ajudante pelo barril do store*: ele não é operação de store (não abre transação, não persiste, não emite evento), e o barril é o que arrasta a store para páginas sem mapa. Os dois chamadores o importam por arquivo.
- **Consequências:** a subida é BEST-EFFORT e não lança nunca: falha de rede, recusa do servidor por item e mime fora da lista (um ícone SVG, por exemplo, que `buildImageUploads` separa) deixam a colagem acontecer e custam a figura, com aviso no console nomeando o gesto. O ajudante devolve `{ uploaded, failed, skipped }`, e os dois chamadores hoje descartam o retorno: ele existe para quem quiser dizer algo na tela, e não há tela dizendo nada ainda. O CUSTO DE MEDIÇÃO que este lote pagou vale registro, porque ele inverte a intuição: no par, `map.hasImage(idNovo)` responde VERDADEIRO nos dois desfechos, porque o 404 instala o placeholder de erro sob o mesmo id, então uma asserção nele fecharia verde sobre o defeito. O sinal que discrimina é o BLOB, porque `hasImage` da store lê só o cache local e `getImage` cai no servidor: o par nunca teve aqueles bytes por outra via. É essa a diferença entre este spec e o modelo de que ele saiu (`frontend/tests/e2e-ui/browser-collab-symbol-snapshot-regen.spec.js`), onde o blob local era decisivo por regeneração e aqui é decisivo por transporte. Guardas: `frontend/tests/integration/colar-imagem-sobe-ao-servidor.repro.test.js` (onze casos, quatro dos quais reprovam contra o `paste()` anterior, medido) e `frontend/tests/e2e-ui/browser-collab-colar-imagem.spec.js` (duas browsers reais, com dois controles: a imagem original resolve no par e um id inventado não).
- **Status:** aceita.

---

### 2026-09-02: a importação para de calcular perfil de elevação, e a chave da fila ganha sequência e marca d'água

- **Contexto:** os DOIS custos que a decisão de hoje mais cedo ("a importação de formato externo perde o teto de 1000 geometrias") declarou como consequência não consertada, medidos. O PRIMEIRO: `prepareFeatureForImportAsync` (`frontend/src/js/import_export/import.control.js`) chamava `calculateProfile` para toda feição de linha, sem condição nenhuma, enquanto as propriedades padrão do controle de linha nascem `profile: false`. Ninguém podia ler aquele perfil: `showProfilePanel` (`frontend/src/js/tool_manager/managers/profile-panel.manager.js`) exige `profileData` E `profile`, e o único gesto que liga `profile` (`frontend/src/js/draw_tools/line_tool/line_attributes_panel.js`) passa por `updateFeaturesProperty`, que RECALCULA o perfil a partir de `baseCoordinates` naquele instante. Todos os outros sítios de linha já perguntavam pelo interruptor antes de calcular (`recalculateMovedLineFeatures`, os dois editores de vértice, a continuação de linha e `frontend/src/js/draw_tools/line_tool/line-split.js`); a importação era o único que não perguntava. O SEGUNDO: `MAX_QUEUE_SIZE` (10000, em `frontend/src/js/store/sync/operation-queue.js`) é um NÍVEL e não um gatilho, e `_growAndMaybeCompact` chamava `_compact()` a cada `enqueue` enquanto a fila estivesse acima dele. A compactação só remove operação que outra da MESMA entidade supera, e uma importação de N feições são N CREATEs de N entidades distintas: a primeira compactação acima do teto não libera nada, a fila continua acima, e cada operação seguinte paga uma leitura completa da fila.
- **Decisão:** (a) nasce `shouldComputeProfileOnImport`, função pura exportada do próprio `import.control.js`, e o ramo `lines` da preparação só calcula o perfil quando ela responde verdadeiro; (a2) o MESMO gate entra em `createFeature` (`frontend/src/js/draw_tools/line_tool/add_line_control.js`), o desenho de uma linha nova, que era o último sítio do produto a calcular perfil sem perguntar. Ali o gate é o interruptor da própria feição (`if (properties.profile)`), a forma que os outros cinco sítios daquele arquivo já usam, e NÃO o predicado da importação: o nome dele é sobre a importação, e importá-lo arrastaria o grafo do importador (JSZip, shpjs, togeojson) para dentro da ferramenta de linha; (b) `shouldComputeProfileOnImport` LÊ o interruptor em vez de responder um `false` constante, para que um controle de linha cujos padrões um dia tragam `profile: true` volte a ganhar perfil na importação sem ninguém precisar lembrar deste arquivo; (c) `operation-queue.js` ganha `COMPACTION_STEP` (um décimo do teto, 1000) e o campo `_compactionWatermark`: depois de uma compactação que deixou a fila ACIMA do teto, a próxima só é tentada quando a fila crescer um degrau além do tamanho medido; (d) a marca é largada assim que a fila é sabida no teto ou abaixo dele, e é largada também na troca de escopo e em `clear()`; (e) `_compact` deixa de zerar `_totalKeys` no fim e passa a gravar o tamanho EXATO que ficou em disco, por `_noteCompaction`, porque zerar obrigava um segundo `keys()` por operação, que é a outra metade do quadrático; (f) a chave da fila passa de `op_{timestamp}_{id}` para `op_{timestamp}_{sequencia}_{id}`, com `SEQ_WIDTH` de 12 dígitos e `lamportTimestamp` como sequência, e `operationIdFromKey` passa a ler as DUAS formas.
- **Alternativas rejeitadas:**
  - *Calcular o perfil da importação num worker, ou em lotes*: o trabalho continuaria sendo feito e continuaria sendo descartado. O gasto certo para um resultado que ninguém lê é zero.
  - *Apagar `profileData` do bloco de propriedades da linha importada*: a chave já vale `null` pelos padrões do controle, e `showProfilePanel` exige o valor VERDADEIRO das duas chaves, então ausência e `null` são a mesma coisa para todo consumidor. Mexer no shape trocaria uma economia real por um risco de forma.
  - *Fazer a importação calcular o perfil só para as linhas que o arquivo de origem trouxer com o interruptor ligado*: nenhum formato de entrada (GeoJSON, Shapefile, KML, KMZ, GPX, CSV) carrega esse conceito, e as propriedades importadas vão todas para `attributes`, nunca para as chaves de sistema.
  - *Subir `MAX_QUEUE_SIZE`*: adiaria o degrau em vez de removê-lo, e o teto tem outra função (é o ponto em que a fila passa a ser varrida), que um número maior enfraquece.
  - *Compactar CREATE puro fundindo entidades distintas*: não existe fusão possível ali. Cada CREATE descreve uma entidade que o servidor ainda não viu.
  - *Desempatar por `lamportTimestamp` na LEITURA, ordenando o array depois de carregar*: obrigaria toda leitura a carregar o envelope antes de saber a ordem, e `_getOrderedKeys` existe justamente para decidir ordem sem ler valor nenhum (a compactação e o `peek` dependem disso).
  - *Chave sequencial própria, contada pela fila*: seria um segundo relógio a persistir e a re-ancorar depois de um recarregamento. O `lamportTimestamp` já é `++lamportClock` nas duas fábricas, já é estritamente crescente por cliente e já viaja no envelope.
  - *`lastIndexOf` para separar a sequência do id*: é a forma curta e é exatamente o defeito que `operationIdFromKey` já corrigiu uma vez. O id é OPACO, pode conter `_`, e cortar pelo último separador o truncava, deixando a operação impossível de dequeuar depois de um recarregamento. O parse novo lê a cabeça de forma fixa, da esquerda, e mantém o id intacto.
  - *Migrar as chaves antigas para a forma nova na atualização*: reescreveria a fila inteira por um ganho de ordenação que só valeria dentro de um milissegundo já vencido. As duas formas convivem, e o recarregamento que troca o build garante que elas nunca dividem o mesmo milissegundo.
  - *Compactar em intervalo de tempo, e não por crescimento*: um temporizador roda quando ninguém está enfileirando (custo sem benefício) e não roda na rajada, que é exatamente quando a fila cresce.
  - *Marca d'água igual ao teto (compactar a cada teto cheio de trabalho novo)*: um degrau de 10000 deixaria um par CREATE+UPDATE esperando dez mil operações para fundir, o que muda o tamanho da fila que o flush enfrenta. Um décimo mantém cerca de dez varreduras por teto de trabalho novo.
- **Consequências:** MEDIDO, com um arquivo sintético de 2000 linhas de 5 vértices e o laço de preparação cronometrado sete vezes em série: a mediana caiu de 110 ms para 68 ms, com 52 mil chamadas de `turf.along`, 104 mil consultas de terreno e 3,2 MB de JSON de `profileData` indo a zero. O duplo de terreno do banco de medição é praticamente grátis; no navegador a consulta é uma leitura de DEM, então o ganho real é maior que o medido, e os 3,2 MB deixam de ser gravados no IndexedDB e de viajar pelo sync. Na fila, com 12000 CREATEs de entidades distintas enfileirados um a um: `_compact` caiu de 2000 chamadas para 2, as listagens de chave de 4000 para 3, as leituras de envelope de 22.001.000 para 21.002, e o tempo de 12,9 s para 51 ms. A marca ADIA e não cancela: um par CREATE+UPDATE pendente funde na compactação do degrau seguinte, o que fica asserido. A CHAVE, que é o achado mais grave dos três e não é de desempenho: `_getOrderedKeys` ordena texto, `peek` entrega essa ordem a `pushOperations` e o servidor aplica o array na ordem em que ele chega. `createGroup` (`frontend/src/js/tool_manager/group_manager.js`) chama `logGroupOperation` e um `logGroupFeatureOperation` por membro sem `await`, no MESMO tick, então `createOperation` carimba o mesmo `Date.now()` nas quatro; com a chave antiga o desempate era o UUID ALEATÓRIO. Como o insert de membro no servidor é gateado por um EXISTS sobre a tabela de grupos, um `group_feature` que chegasse antes do seu `group` escrevia zero linhas e voltava acked como SUCESSO: agrupando três feições, cerca de três vezes em quatro pelo menos um membro se perdia, sem erro em lugar nenhum. A sequência fecha isso por construção. O que NÃO mudou: o teto, a semântica de `_compactEntityOps`, a barra de progresso da importação e o lote único de persistência. E o custo que a decisão anterior declarou e que continua aberto: uma importação grande em atlas de servidor ainda enfileira uma op por feição, e o gargalo agora é o flush, não a fila. Guardas: `frontend/tests/unit/importacao-nao-calcula-perfil.test.js` (com controle positivo: padrões `profile: true` voltam a calcular), `frontend/tests/integration/perfil-sob-demanda-ao-ligar.test.js` (o outro lado, que sem esta metade deixaria o verde compatível com um produto em que ligar o interruptor não faz nada) e `frontend/tests/unit/fila-compacta-com-marca-dagua.test.js`. Guarda da chave: `frontend/tests/unit/fila-ordem-de-criacao.test.js`, com controle negativo DETERMINÍSTICO (uuids forçados em ordem decrescente, o pior caso exato) ao lado das 20 repetições com o gerador real, mais três casos de compatibilidade com a forma anterior. Controles negativos medidos: revertida a chave para a forma antiga, 4 dos 7 casos daquele arquivo ficam vermelhos, um deles nomeando o defeito ("um membro passou na frente do grupo"); revertido o predicado da importação, 9 casos ficam vermelhos; revertido só o `if` do sítio de chamada, 1; removido o recálculo sob demanda de `updateFeaturesProperty`, 2; revertido o gate de `createFeature`, 1; removida a comparação da marca, o espião conta 2000 compactações em vez de 2. O gate de `createFeature` economiza 26 `turf.along` e 26 consultas de terreno POR LINHA DESENHADA, que é um gesto e não um lote: entrou porque a assimetria era o que restava (cinco sítios perguntavam, um não), e a prova dela é o caso que capta a feição no despachante com 26 pontos de perfil e o interruptor desligado.
- **Status:** aceita.

---

### 2026-09-02: a saída de uma feição do grupo é uma op de `group_feature`, e a lista dentro de um `group` update é descartada em silêncio

- **Contexto:** `removeFeatureFromAllGroups` (`frontend/src/js/tool_manager/group_manager.js`) tirava a feição de `group.features`, tocava o metadado de sync e soft-deletava o grupo que ficasse com um membro ou menos, e não logava operação NENHUMA, enquanto as quatro irmãs dela no mesmo arquivo (`createGroup`, `combineGroups`, `ungroupFeatures`, `updateGroupProperty`) logam. Ela tem cinco chamadores fora do arquivo: as três exclusões de feição de `frontend/src/js/store/feature.operations.js`, a fachada de `frontend/src/js/store/group.operations.js` e, por dentro dessas, o mover para outro mapa e a transferência de camada. O par e o servidor ficavam com a referência à feição que já tinha saído, sem erro em lugar nenhum.
- **A verificação que decidiu o desenho, e ela desmontou a saída óbvia:** o servidor NÃO tem coluna de membros em `groups`. `UPDATE_FIELDS.group` (`backend/src/modules/sync/sync.service.js`) são `name`, `visible`, `locked`, `style` e `parent_id`, e o INSERT de `groups` também não lê `data.features`. A membresia mora na tabela de junção `group_features`, escrita só pelas ops de alvo `group_feature`, e é dela que `getAtlasSnapshot` remonta `group.features`. Ou seja, um `group` update carregando a lista nova é aplicado com a lista DESCARTADA, sem recusa e sem aviso. E o cliente esconde exatamente esse desfecho: `applyRemoteGroupOp` (`frontend/src/js/store/sync/remote-operation-handler.js`) troca o documento de grupo INTEIRO, então esse desenho errado convergiria dois pares ao vivo e um teste de duas browsers fecharia verde sobre um servidor guardando a membresia velha, que volta no próximo snapshot ou F5.
- **Decisão:** (a) o vocabulário do cliente ganha `EntityType.GROUP_FEATURE` (`frontend/src/js/store/sync/operation-types.js`) e um logger dedicado, `logGroupFeatureOperation` (`frontend/src/js/store/sync/operation-dispatcher.js`), cujo payload é `{ group_id, feature_id, feature_type }`; (b) `removeFeatureFromAllGroups` loga UMA op de `group_feature` delete por grupo afetado, e, quando o grupo cai a um membro ou menos, TAMBÉM o `group` delete que espelha o soft-delete que ela já fazia local; (c) a membresia passa a NASCER como op também, em `createGroup` e `combineGroups`, depois da op do grupo; (d) o entityId da op de membresia é um UUID DESCARTÁVEL por op; (e) o par ganha `applyRemoteGroupFeatureOp`, que edita a lista de membros em separado em vez de substituir o documento; (f) a função passa a ser estritamente idempotente: grupo que não continha a feição é pulado inteiro.
- **Por que o entityId é descartável, e as duas metades são obrigatórias:** `operations.entity_id` é coluna UUID (`backend/src/database/migrations/004_sync.sql`), o que descarta uma chave composta de grupo mais feição; e a compactação da fila agrupa por `scopeSuffix`, `entityType` e `entityId` juntos, mantendo UMA op por grupo (`frontend/src/js/store/sync/operation-queue.js`), de modo que reusar o id do GRUPO colapsaria várias mudanças de membresia do mesmo grupo numa só e descartaria as demais, exatamente o defeito que `frontend/tests/unit/compactacao-id-nao-unico.test.js` cataloga. Um id por op mantém todas.
- **Alternativas rejeitadas:**
  - *Logar um `group` UPDATE com a lista nova*: é a leitura natural do arquivo, porque `updateGroupProperty` loga assim e a lista está bem ali no documento. O servidor descarta a lista, e o pior é que o defeito fica INVISÍVEL do lado que se costuma medir. Isso não é conjectura: `frontend/tests/e2e/grupo-perde-membro.e2e.test.js` tem um caso dedicado que empurra esse update contra o servidor real, afirma que o `name` de fato mudou (para descartar a hipótese de que o update não chegou) e que a membresia NÃO se moveu.
  - *Corrigir o servidor para ler `data.features` num `group` update*: seria substituir a lista de membros a cada update de grupo, isto é, trocar um delete de junção por um delete-e-reinsere disparado por qualquer renomeação ou troca de visibilidade, e transformar uma op de granularidade um em uma de granularidade N, com LWW por ordem de chegada decidindo a lista inteira em vez de um membro. Também mudaria o contrato para o cliente antigo, que manda a lista em toda op de grupo.
  - *Não logar o `group` delete quando o grupo se dissolve, deixando o par derivar a dissolução da lista vazia*: o par não deriva nada, e a regra de dissolução mora só no cliente que apagou. O grupo ficaria vivo do outro lado com um membro.
  - *Manter a coleta de lixo antiga de grupo degenerado*: o código anterior soft-deletava TODO grupo ativo com um membro ou menos a cada chamada, relacionada ou não. Isso era inerte enquanto nada era logado; assim que o soft-delete virou op, teria passado a dissolver no PAR um grupo que o gesto não tocou. O `continue` por nada ter mudado é o que impede isso, e é a única mudança de comportamento LOCAL desta entrada.
  - *Pôr `GROUP_FEATURE` em `CONVERGENCE_GUARDED`*: o guarda é chaveado por `entityId`, e aqui cada op tem o seu, então a checagem de versão nunca casaria e `lastAppliedVersion` cresceria sem limite, uma entrada por op recebida. Registrado em `frontend/tests/unit/convergence-guarded-decisao-por-tipo.test.js`, que reprova qualquer `EntityType` sem decisão escrita.
- **Consequências:** a mudança é de UM pacote só. O servidor não mudou uma linha, e isso foi conferido contra o backend real antes de escrever qualquer código. Um atlas que já rodava tem `group_features` VAZIO para todo grupo criado ao vivo (só a importação de atlas local, por `frontend/src/js/import_export/local-atlas-to-server.js`, escrevia aquelas linhas), então a op de delete é um no-op sobre esses grupos até que eles sejam recriados; é por isso que a metade de CREATE entrou junto, sem a qual a correção seria provadamente inerte no caso dominante. `frontend/tests/e2e-ui/browser-group-ops.spec.js` afirmava no cabeçalho que `group_feature` era uma junção só de servidor, sem `EntityType` no cliente, o que deixou de valer; o cabeçalho foi corrigido no mesmo commit, com o motivo pelo qual aquele arquivo continua montando o envelope à mão (ele empurra um id de feição FANTASMA, que nenhum caminho de cliente produz). Guardas: `frontend/tests/store/grupo-perde-membro-loga-op.test.js` (onze casos; controle negativo medido, o corte do log derruba cinco e o corte da idempotência derruba quatro, e são conjuntos diferentes), `frontend/tests/e2e/grupo-perde-membro.e2e.test.js` (quatro casos contra o backend real, um deles a prova de que a linha de junção foi APAGADA e não só escondida pelo filtro de órfão do snapshot: recriar a feição com o mesmo id não a traz de volta ao grupo) e `frontend/tests/e2e-ui/browser-collab-grupo-perde-membro.spec.js` (duas browsers, escrito e não executado neste lote).
- **Status:** aceita.

---

### 2026-09-02: feição sem referência de zoom vale fator 1, e nenhum NaN sai da correção de zoom

- **Contexto:** `calculateZoomCorrectedValue` (`frontend/src/js/tool_manager/helpers/zoom-correction.helpers.js`) fazia `currentZoom - properties.createdAtZoom` e `Math.min(base * scaleFactor, config.maxValue ?? Infinity)`. Uma feição sem `createdAtZoom` produzia `NaN` em toda a cadeia, porque nenhum `??` guarda NaN e `Math.min(NaN, 10)` também é NaN. Isso não é hipotético: um `.ebgeo` do dono traz as imagens com as dimensões sob `largura` e `altura`, que nenhuma linha do produto lê, e sem `createdAtZoom` nenhum. O valor derivado é lido direto por `icon-size` (`frontend/src/js/layers/styles/content.layers.js` usa um `['get', 'calculatedSize']` sem `coalesce`) e entra na geometria da caixa de seleção, e NaN ali não levanta exceção em lugar nenhum: ele viaja para dentro de código nativo. Medido no `main` com aquele arquivo, em 6 rodadas de 6: selecionar a imagem pela aba de feições (o clique dá zoom até ela), apertar Esc e trocar de mapa no zoom alto TRAVA o thread principal da página, e o depurador não consegue pausar, o que aponta para chamada nativa (canvas ou readPixels com dimensão NaN ou gigante) e não para JS em laço. Nada é lançado e nada aparece no console.
- **A parte que estava ESCRITA e apontava para o lado errado:** a suíte já cobria os oito desfechos não finitos desta função, num bloco intitulado "DOCUMENTED current behavior", cada caso afirmando que o retorno é NaN e citando `frontend/tests/TESTING-BACKLOG.md`, cujo item 1 lista `calculateZoomCorrectedValue` como caso confirmado de "`x ?? 0` não protege contra NaN" e manda "fixar comportamento atual com teste e marcar com flag para a correção ser deliberada". O verde daquele bloco era, portanto, a prova de que o defeito continuava lá. A mesma pergunta já tinha resposta OPOSTA a dois arquivos de distância: `boundary-zoom.model.js` trata ausência de âncora como "sem referência de zoom", devolve fator 1 e diz por extenso, no `fileoverview`, que não reusa `calculateZoomCorrectedValue` porque ela propaga NaN.
- **Decisão:** (a) sem `createdAtZoom` finito não há referência de zoom, e sem referência o fator é 1, ou seja, o valor-base sai intacto, que é exatamente o que aquelas feições faziam antes de a correção existir; (b) a mesma regra vale para `currentZoom` não finito e para fator que estoure ou colapse a zero; (c) valor-base não finito não tem o que corrigir e devolve `config.fallbackValue`, um campo NOVO da config; (d) `maxValue` não finito é ignorado em vez de envenenar o resultado; (e) a ferramenta de imagem passa a declarar `fallbackValue`, porque o `icon-size` dela não tem padrão próprio a que cair, e as três configs literais que ela repetia viram uma só (`ZOOM_CORRECTION_CONFIG`, em `frontend/src/js/draw_tools/image_tool/add_image_control.js`), consumida também por `updateAllImageSizes`, que carregava a segunda cópia da aritmética; (f) a dimensão em pixels da imagem é coagida no FUNIL por onde ela entra no desenho, `calculateSelectionBoxGeometry` (`frontend/src/js/draw_tools/image_tool/add_image_geometry.js`), com `createSelectionBoxFromDegrees` como última linha de defesa; (g) `resizeImage` passa a ler `naturalWidth` e `naturalHeight` antes dos atributos de layout, e a feição nasce com `width` e `height` já coagidos.
- **A divergência deliberada em relação à divisa:** `hasZoomReference` de `boundary-zoom.model.js` recusa também `createdAtZoom === 0`, porque zero é a sentinela de "nunca ancorado" do controle de divisa. Aqui a guarda testa só finitude. Várias ferramentas carimbam `createdAtZoom: 0` no `DEFAULT_PROPERTIES` e o sobrescrevem no ponto de criação, e uma feição legitimamente ancorada no zoom 0 é indistinguível dessas, então recusar o zero mudaria em silêncio o tamanho de toda ferramenta que usa este helper. O defeito é o não finito; o zero mantém o comportamento de hoje, e isso está dito no `fileoverview` da função e asserido nos dois testes.
- **Alternativas rejeitadas:**
  - *Coagir o NaN no consumidor, pondo um `case` de comparação consigo mesmo na expressão de `icon-size`*: NaN é o único valor diferente de si próprio, então dá para pegá-lo numa expressão do MapLibre, mas `coalesce` NÃO o pega (ele só olha nulo). Seria uma expressão obscura em cada camada que lê tamanho derivado, e continuaria deixando NaN na caixa de seleção, no `.ebgeo` exportado e no envelope de sync. O produtor é um; os consumidores são muitos.
  - *Reusar `computeBoundaryZoomSizes` para todas as ferramentas*: ele carrega a escada de limites, os padrões e o fator recíproco do escalão da divisa, que não existem nas outras. Unificar custaria mais do que a guarda.
  - *Devolver 1 quando o valor-base não é finito, em vez de um fallback declarado*: 1 é um tamanho plausível para imagem e absurdo para largura de linha ou corpo de texto, que usam o mesmo helper. Quem sabe o padrão é o chamador, e quem não declarar recebe `undefined`, que o MapLibre lê como ausente e resolve pelo padrão da própria propriedade de layout.
  - *Lançar quando a feição chega sem `createdAtZoom`*: o caminho roda no setup das camadas, de forma síncrona, para toda feição do mapa. Uma exceção ali derruba o desenho inteiro por causa de um dado antigo, que é pior do que desenhá-lo no tamanho que ele tinha antes.
  - *Migrar o dado antigo, carimbando `createdAtZoom` na importação*: não há zoom certo para carimbar (o arquivo não diz em que zoom a imagem foi posta), e qualquer palpite muda o tamanho da imagem na tela. Além disso a guarda continuaria necessária para o dado que já está no IndexedDB de quem importou antes.
  - *Manter o bloco de testes que fixava o NaN, acrescentando os novos ao lado*: seriam duas suítes afirmando comportamentos opostos, e a antiga é a que o `npm test` já rodava. Ela foi reescrita para afirmar a guarda, com o motivo e a data no cabeçalho do bloco.
- **Consequências:** OITO casos da suíte existente mudaram de veredito, e essa é a mudança de contrato desta entrada: `currentZoom` infinito devolvia `Infinity` e agora devolve a base, `-Infinity` devolvia 0 e agora devolve a base, `maxValue` NaN devolvia NaN e agora é ignorado, e correção desligada com base NaN devolvia NaN e agora cai no fallback. Nenhum desses desfechos era alcançável com dado válido. O que NÃO mudou, e está preso com números absolutos: o caso normal (dobra por nível de zoom acima da âncora, teto de 10 na imagem, zoom 0 como âncora legítima, correção desligada devolvendo a base crua). A coerção da caixa de seleção trata os eixos de forma INDEPENDENTE, porque uma guarda compartilhada faria um eixo poluído levar o eixo sadio junto, e ela testa só finitude no passo em graus, porque extensão zero (cinco vértices no centro) e negativa (anel invertido) são formas documentadas e inofensivas. Guardas: `frontend/tests/unit/zoom-correction-sem-referencia.repro.test.js` (21 casos, com fast-check sobre toda âncora inútil) e `frontend/tests/e2e-ui/imagem-sem-referencia-de-zoom.spec.js`, escrito e NÃO executado neste lote, que dirige o gesto real e afirma que a página responde. CONTROLE NEGATIVO medido: restauradas as duas linhas antigas do helper, 24 casos ficam vermelhos entre o repro e a suíte do helper (62 no total), e a coerção do funil, revertida, derruba os casos de dimensão ausente de `frontend/tests/unit/image-geometry.test.js`. A HIPÓTESE de que o NaN é a raiz do congelamento continua SUSTENTADA e não provada: o travamento é nativo e o depurador não entra, então o spec afirma a vivacidade da página, que reprova mesmo que a causa seja outra.
- **Adendo de 2026-09-02, o controle negativo do spec de tela NARROU a hipótese, e ela continua não provada.** Com as duas linhas antigas de volta no helper, `frontend/tests/e2e-ui/imagem-sem-referencia-de-zoom.spec.js` reprova 3 rodadas de 3, então ele é guarda de verdade; mas ele reprova pelo TAMANHO DERIVADO, nunca por vivacidade: as quatro checagens de página viva passaram nas três rodadas revertidas e o gesto inteiro terminou. Ou seja, **aquele spec não reproduz o congelamento**, que foi medido com o arquivo real do dono, e um verde ali se lê como "o tamanho derivado é número real num navegador real", não como "a página não trava". O valor observado corrigiu um ponto da hipótese: é `{"naStore":1,"naFonte":1,"achou":true,"tamanhoDesenhado":null}`, ou seja **NULL, não NaN**. A feição chega à fonte do MapLibre por um round trip de JSON, e `JSON.stringify(NaN)` é `null`, então a FONTE LAVA o NaN e o `icon-size` recebe valor ausente e cai no padrão dele. O que quer que alcance código nativo ainda com NaN dentro, portanto, não é esse caminho: o candidato que sobra é o polígono da caixa de seleção, cujas coordenadas são geometria e não propriedade. Isso estreita onde uma investigação futura deve olhar, e é o tipo de coisa que só o controle negativo conta, porque a asserção foi escrita esperando NaN e leria "não finito" nos dois casos.
- **Status:** aceita.

---

### 2026-09-03: o aviso de servidor secundário nasce LIGADO e vem do servidor, e o tipo de feição novo entra editando a baseline

- **Contexto:** o porte do lote que entrou no `main` em 2026-09-03 trouxe duas coisas que o lote anterior não tinha trazido, e as duas atravessam a fronteira dos pacotes. A primeira é a ferramenta Linha de Coordenação, um tipo de feição NOVO (`coordination_line`), e o servidor enumera `feature_type` em quatro cópias, então desta vez o backend entra; o commit anterior tinha MEDIDO que não entrava, e a medida continua certa, porque lá só viajavam propriedades dentro do JSONB. A segunda é a tela que recomenda o servidor principal: a instância do 1º CGEO (Porto Alegre) é o servidor SECUNDÁRIO do EBGeo, e o recomendado é `ebgeo.dsg.eb.mil.br`, no 7º CTA em Brasília, com mais disponibilidade e fora dos problemas de energia e de rede daqui. No `main` essa chave mora no config.js VERSIONADO do cliente; neste ramo o config.js do cliente é só o FORMATO e não tem fallback estático, então ela não tinha onde morar.
- **Decisão (o tipo novo):** `coordination_line` entra nas quatro cópias da lista (o CHECK `valid_feature_type`, o `VALID_FEATURE_TYPES` do Joi de importação, o `typeToCollection` do snapshot e o balde `coordination_lines`), e o CHECK é acrescentado **editando a baseline de atlas, sem migração nova**. Isso é autorização explícita do chefe para esta fase, e cabe na regra que o repositório já tinha adotado ao rebaselinar: enquanto o backend não está em produção, o schema é código, não histórico. As propriedades da ferramenta (`symbol_code`, os tamanhos, a âncora de zoom) não alargam nada, porque `features.properties` é JSONB em regime SCRUBBED de chaves abertas.
- **Decisão (o aviso):** `GET /api/config` passa a servir `app.avisoServidorSecundario` (booleano) e `app.urlServidorPrincipal` (string), hidratadas por duas variáveis de ambiente, `AVISO_SERVIDOR_SECUNDARIO` e `URL_SERVIDOR_PRINCIPAL`. O **padrão é LIGADO**, espelhando a decisão do chefe no `main` de que o checkout nasce com o aviso e é o servidor PRINCIPAL que o desliga na implantação dele. O parse é `resolveAvisoServidorSecundario` (`backend/src/config.js`), irmão de `resolveAllowSelfRegistration`: só o literal `true` liga, ausente e vazio valem o padrão, e qualquer outra coisa desliga.
- **Alternativas recusadas:**
  - *Hidratar a tela só no frontend, com uma constante no config.js do cliente, como no `main`.* É a alternativa óbvia e é a errada aqui: naquele ramo o config.js é dado VERSIONADO e o pacote se constrói por servidor, então a constante É o mecanismo de implantação; neste ramo ela seria um valor de build para responder uma pergunta de DEPLOY, e o mesmo pacote serve as duas instalações. Também partiria a regra que o ramo já paga inteira, a de que dado de implantação vem de `/api/config`.
  - *Padrão DESLIGADO, ligando por env no secundário.* Falha na direção pior: uma instalação que ninguém configurou é, na prática, o secundário, e o desfecho de esquecer a variável seria deixar as pessoas exatamente onde a recomendação existe para tirá-las. Ligado por padrão erra para o lado barulhento, que é o lado em que alguém percebe.
  - *Coerção por veracidade no parse do env.* `Boolean('false')` é `true`, e com o padrão ligado o defeito seria invisível em todo teste que não usasse um valor fora do par: só o servidor principal encontraria a tela, em produção. Daí o caso que discrimina ser `'sim'`, e não `'true'`.
  - *Uma migração nova só para alargar o CHECK.* Ela existiria para preservar um histórico que este ramo declaradamente não preserva, e produziria um arquivo a mais para o próximo esmagamento apagar.
- **Consequências:** um banco de desenvolvimento JÁ CRIADO não recebe a baseline editada, porque a migração consta como aplicada; ele precisa do `ALTER TABLE ... DROP CONSTRAINT valid_feature_type` seguido do `ADD CONSTRAINT` com a lista nova, ou de um `db:test:reset`. As duas variáveis são lidas no BOOT, então trocá-las com o processo de pé não muda o payload nem derrubando o memo de `/api/config`, e isso está pinado em teste porque é o passo de implantação que falha calado. O par também é declarado em `config.admin.schemas.js`, o que não cria a capacidade (a seção `app` já era aberta) e sim dá borda a ela: um `"sim"` digitado no editor avançado morre em 422 em vez de virar string num documento que o cliente lê por `=== true`. Guardas: `backend/tests/unit/aviso-servidor-secundario.test.js` (o parse e a fiação até `config.appConfig`), `backend/tests/integration/config-aviso-servidor-secundario.test.js` (o payload, o memo, o override e a armadilha do boot), mais os casos novos de `backend/tests/integration/features-all-types.test.js` e `backend/tests/integration/sync-advanced.test.js`. CONTROLES NEGATIVOS medidos: sem o tipo no CHECK, o caso do snapshot reprova com a coleção nula e o de sync com zero linhas gravadas; com o bloco `app` de volta ao estático, 7 dos 8 casos de configuração reprovam (o oitavo é justamente o que afirma que o bloco foi ESTENDIDO e não substituído, e ele deve continuar verde); com o parse trocado por coerção, 6 dos 10 casos do arquivo de parse reprovam, `'sim'` entre eles.
- **Status:** superada em 2026-09-04 na metade do padrão (o aviso nasce desligado; o restante, chaves e hidratação, continua).

---

### 2026-09-03: a versão de esquema FICA em 2.3, e o balde novo se garante na LEITURA

- **Contexto:** o porte da ferramenta Linha de Coordenação traz um balde de feições novo, `coordination_lines`. No `main` ele custou um degrau de esquema: a v2.3 de lá existe só para dar essa coleção a todo mapa gravado. Aqui a v2.3 já está ocupada, e por outra coisa: ela é o registro de atlas locais ("Meu Atlas"), de nível de INSTALAÇÃO, e ramifica por escopo. A colisão põe a pergunta na mesa: gasta-se a v2.4 para repetir o degrau do `main`, ou não? A falha que o degrau existe para impedir é MUDA, e por isso ela não pode simplesmente ser ignorada: um mapa sem o balde não dá erro, não loga e não avisa, porque `setupCoordinationLineLayers` monta a fonte a partir dessa coleção e toda escrita da ferramenta passa por um `getSource(...)?.setData`, cujo encadeamento opcional engole a ausência. O sintoma é a ferramenta ativar, aceitar clique e não desenhar nada.
- **Decisão:** `ATLAS_SCHEMA_VERSION` fica em '2.3', não há migração nova, e a forma passa a ser normalizada em TEMPO DE LEITURA, nos TRÊS caminhos por onde um mapa entra no repositório, todos chamando a mesma função pura `ensureCoordinationLines` (`frontend/src/js/store/repository.utils.js`, folha de zero imports, ao lado de `MIN_SCHEMA_VERSION`). Os três: o normalizador do `.ebgeo` importado (`frontend/src/js/import_export/import-normalize.js`), o snapshot do servidor (`frontend/src/js/store/sync/remote-operation-handler.js`, no reshape que precede a gravação) e a leitura do documento no IndexedDB (`frontend/src/js/store/repositories/local.repository.js`, em `getMap` e em `getMapById`). A função devolve null quando nada muda, o que é o que impede a leitura de virar escrita. A tolerância do setup de camadas ao balde ausente fica de pé como DEFESA, porque ele também roda sobre dado que nunca passou pelos três (um objeto de mapa recém montado, um fixture de teste).
- **Alternativas recusadas:**
  - *A v2.4, repetindo o degrau do `main`.* Foi a proposta inicial e o chefe a recusou: o ramo está em desenvolvimento, sem dado de usuário a preservar, e uma versão de esquema existe para marcar um ponto no HISTÓRICO. Gastar uma numa mudança de forma que a leitura normaliza sozinha compra nada e cobra um arquivo de migração, um elo na cadeia e um número que a próxima conferência tem de explicar.
  - *Só a tolerância no setup de camadas, sem normalizar na leitura.* Trata o sintoma e não a causa, que foi exatamente o erro que o `main` cometeu e corrigiu no commit seguinte: com o balde ausente sobrevivendo na store, todo consumidor que enumere coleções (a aba de feições, a exportação, a subida ao servidor) continua vendo um mapa incompleto, e cada um deles precisaria da própria guarda.
  - *Normalizar na ESCRITA, dando o balde a todo mapa no próximo salvamento.* Chegaria tarde: o desenho acontece no boot, antes de qualquer escrita, e um mapa aberto só para leitura nunca passaria por lá.
- **Consequências:** um `.ebgeo` exportado daqui continua dizendo 2.3 e agora traz o balde, e o `main` em 2.3 o lê sem conflito, porque a coleção a mais é ignorada por quem não a conhece; um `.ebgeo` do `main` em 2.3 chega aqui já com o balde, e a função é idempotente, então ele atravessa intacto. A leitura NÃO reescreve o disco, de propósito: uma leitura que gravasse de volta seria uma migração disfarçada e marcaria todo documento como sujo para o sync, sobre uma mudança que ninguém autorou. O preço é a normalização rodar a cada leitura, e ela é uma checagem de `Array.isArray` sobre uma chave. Guardas: `frontend/tests/unit/coordination-line-balde.test.js` (a função pura, o caminho do arquivo e o do snapshot) e `frontend/tests/unit/coordination-line-leitura-local.test.js` (o caminho do IndexedDB, sobre o repositório de verdade, mais a asserção de que o disco continua sem o balde), com `frontend/tests/unit/coordination-line-camadas.test.js` guardando a defesa. CONTROLES NEGATIVOS medidos: neutralizadas as três chamadas, seis casos ficam vermelhos, dois em cada caminho; reposta a guarda antiga no setup de camadas, três dos seis casos daquele arquivo caem, entre eles o do mapa que nunca teve o balde.
- **Status:** aceita.

---

### 2026-09-03: a Linha de Coordenação entra pela mesa de ferramentas TARDIAS, e o modelo de zoom mora nos helpers

- **Contexto:** o `main` registrou a ferramenta nova em `map_sig.js`, em cinco sítios, e deixou o modelo de zoom dentro da pasta da ferramenta, forçando-o ao chunk `core` por uma regra de bundler. Nenhuma das duas coisas existe mais aqui: a onda de carga tardia de 2026-08-25 mudou os quatro registros de `map_sig.js` para a tabela de `frontend/src/js/tool_manager/tool-registry.js`, e o modelo de zoom do limite já tinha se mudado para `frontend/src/js/tool_manager/helpers/boundary-zoom.model.js` pelo mesmo motivo que o da linha nova precisa: `frontend/src/js/layers/styles/tactical.layers.js` lê a expressão de largura para pintar a camada, e um modelo parado na pasta da ferramenta desenha uma aresta estática de `core` para o chunk `military-tools`.
- **Decisão:** a ferramenta entra como TARDIA, com uma entrada em `FERRAMENTAS` e nada em `map_sig.js`, e declara `withCoordinationLineZoomSizes` como modelo de zoom, para o stand-in responder à correção SÍNCRONA que o setup de camadas faz no boot (só os números; a geometria, que lê Turf, chega na primeira passada de zoom depois que o módulo sobe). O modelo vai para `frontend/src/js/tool_manager/helpers/coordination-line-zoom.model.js`, ao lado do irmão do limite. O controle escreve a fonte SÓ pelo despachante de diff (`frontend/src/js/layers/geojson-dispatcher.js`), como todo controle deste ramo, e a fila serial do `main` fica de pé para serializar as LEITURAS que precedem cada escrita.
- **Alternativas recusadas:**
  - *Registrar em `map_sig.js`, como no `main`.* Poria 124 kB de fonte no payload ansioso do mapa por uma ferramenta que só precisa existir quando alguém a aciona, desfazendo a decisão de 2026-08-25 para um caso.
  - *Deixar o modelo de zoom na pasta da ferramenta e ajustar o bundler.* Este ramo agrupa por `codeSplitting.groups`, e a correção certa aqui é a posição do arquivo, não uma regra de bundler que a próxima leitura teria de decifrar.
  - *Escrita crua na fonte, como o `main` faz.* A varredura de `frontend/tests/unit/despachante-sem-escrita-crua.test.js` a absolveria, porque o id resolve para literal e a fonte não estaria no inventário; ainda assim ela perderia dado, porque os escritores genéricos por tipo de armazenamento (aba de feições, área de transferência, importação, menu de contexto) despacham a mesma fonte por variável, e uma escrita crua emitida com um diff na fila faz o diff sumir sem erro.
- **Consequências:** o botão da barra nasce SEM atalho de teclado, porque as letras vizinhas já estão tomadas, e `frontend/src/js/toolbar/components/tool-button.js` deixou de escrever "undefined" no título e no crachá quando a ferramenta não tem tecla, conserto que veio junto do `main` e vale para toda ferramenta futura. A conversão linear cresceu para QUATRO tipos e doze sentidos: o teste que fixava "os SEIS sentidos" e "DOIS itens" passou a derivar de `LINEAR_SOURCES` (`n * (n - 1)`), pelo mesmo motivo que o da migração temporal deixou de repetir a versão. O grafo COMPLETO da página do mapa cresceu 124 kB com os cinco arquivos novos e ESTOUROU o teto medido de `frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js` (10740 kB contra 10600), que pede remedida com data. A banda FOI recentrada na integração do dia (2026-09-03), depois de os cinco lotes assentarem: 638 módulos e 10740 kB no grafo completo (piso 9880, teto 11600) e 470 módulos e 6468 kB no ansioso, que ficou dentro da banda dele. Piso e teto sobem juntos, então o caminhador quebrado continua acusando.
- **Status:** aceita.

### 2026-09-03: dois cliques rápidos são dois vértices, e o Núcleo no KMZ desenha pelo código do escalão

- **Contexto:** a captura de tela de Playwright que fechou o porte do dia (o laço que a constituição manda para UI) mostrou a Linha de Coordenação ativa, aceitando cliques e sem desenhar nada, o sintoma que o `main` já havia perseguido por outra causa. A sonda no navegador achou o mecanismo: a Linha de Limite e a Linha de Coordenação seguram cada clique esquerdo num temporizador de 250 ms (o que separa clique de duplo clique), e um segundo clique dentro dessa janela cancelava o temporizador e re-armava com as coordenadas novas, isto é, DESCARTAVA o vértice pendente, sem erro. O clique direito que finaliza fazia o mesmo. Medido em Chromium real: 100 ms entre cliques, um vértice; 400 ms, dois. O defeito é herdado do `main` e anterior a este porte. Na mesma passada, a revisão do lote achou que o Núcleo nasce com `pointCode: 'ECHELON'`, código de TELA que o catálogo não tem: o controle resolve `echelonCode` antes de desenhar em quatro caminhos, e o quinto, a regeneração de imagem do exportador de KMZ, entregava as propriedades cruas ao gerador, que lançava, e o Placemark saía sem ícone, com um `console.warn` como único rastro.
- **Decisão:** o vértice pendente é GRAVADO quando chega um clique distinto dele ou o clique direito, e só um clique repetido no mesmo lugar continua re-armando o temporizador (`_commitPendingClick` nos dois controles). A resolução do código desenhável vira função pura do catálogo (`resolveDrawablePointCode`, em `frontend/src/js/military_tools/coordination_measure_tool/coordination_points_catalog.js`) e o KMZ passa a chamá-la. As duas provas moram no navegador, porque a suíte em `node` não alcança nem o clique nem o temporizador: `frontend/tests/e2e-ui/vertices-em-cliques-rapidos.spec.js` (100 ms entre cliques, duas ferramentas, com e sem clique direito), `frontend/tests/e2e-ui/corte-da-divisa-pelo-menu.spec.js` (o gesto inteiro do corte) e `frontend/tests/e2e-ui/secondary-server-notice.spec.js` (o aviso, ligado por remendo de `GET /api/config` a caminho do navegador). O KMZ tem régua em `node` (`frontend/tests/unit/kmz-nucleo-codigo-desenhavel.test.js`).
- **Alternativas recusadas:**
  - *Encurtar o temporizador.* Trocaria o limiar da perda, não a perda; quem clica a 4 vértices por segundo continuaria perdendo.
  - *Tirar o temporizador.* Ele existe para o duplo clique não virar dois vértices no mesmo lugar, e essa parte estava certa.
  - *Resolver o `echelonCode` só no KMZ.* Seria a quinta cópia da mesma regra; a função pura no catálogo é o lugar de onde o controle também deve passar a ler, quando for tocado de novo.
- **Consequências:** os dois harnesses de e2e sobem o backend com `AVISO_SERVIDOR_SECUNDARIO=false`, senão a sobreposição do aviso sentaria sobre o primeiro clique de todo spec de navegador. O `main` carrega os mesmos dois defeitos (temporizador e razão de pixels na conversão Ponto para Medida) e não foi tocado por este lote. A suíte de Playwright inteira foi rodada depois destas mudanças, e o resultado está na mensagem do commit.
- **Status:** aceita.

---

### 2026-09-04: o aviso de servidor secundário nasce DESLIGADO, e o administrador liga pela aba Sistema

- **Contexto:** a decisão de 2026-09-03 (entrada acima) fez o aviso de servidor secundário nascer LIGADO, espelhando a decisão do chefe no `main`, com o argumento de que uma instalação que ninguém configurou é na prática o secundário e de que errar para o lado barulhento é errar para o lado em que alguém percebe. Um dia de convívio mostrou a conta que esse argumento não pagava. O padrão ligado obriga TODA implantação e TODO desenvolvedor a desligar: o `.env.example` já nascia com a chave escrita, e as duas bancadas de e2e subiam o servidor descartável com `AVISO_SERVIDOR_SECUNDARIO=false` por um motivo que não tinha nada a ver com o que elas medem, só para uma sobreposição que captura todo `keydown` não sentar em cima do primeiro clique de cada spec de navegador. Uma tela que todo mundo precisa apagar tem o padrão errado. O chefe decidiu a inversão em 2026-09-04, e junto com ela decidiu quem passa a acender: o administrador, pela tela, sem reiniciar o servidor.
- **Decisão:** `resolveAvisoServidorSecundario` (`backend/src/config.js`) devolve `false` para ausente, vazio e qualquer valor que não seja o literal `true`, e o corpo dele encolhe para uma comparação só, porque a assimetria entre ausente e presente existia só para sustentar o padrão ligado. Quem acende no dia a dia é a aba **Sistema** do painel de administração (`frontend/src/js/admin/config-tab.js`), com a seção "Aviso de servidor secundário": uma caixa de marcação ligada a `app.avisoServidorSecundario` e um campo de texto ligado a `app.urlServidorPrincipal`, ambos no `appDiff` que a aba já enviava, então só o que MUDOU viaja no `PUT /config/admin`. O override vence sobre o env na fusão de `config.service.js` e a escrita derruba o memo, então o aviso vale no CARREGAMENTO seguinte da página, sem reiniciar o processo. A variável de ambiente FICA, para a implantação que não tem administrador para clicar e para quem quer a tela desde o primeiro boot.
- **Alternativas recusadas:**
  - *Manter o padrão ligado e desligar por `.env` local em cada máquina.* É o estado que estava valendo, e é o que a inversão veio corrigir: transfere para toda instalação e todo checkout um passo de configuração que só o servidor secundário precisa, e o preço aparece justamente onde ninguém procura, nas bancadas de e2e, que carregavam a linha por um motivo alheio ao que medem. Também deixa o modo de falha na direção pior para desenvolvimento: quem esquece o `.env` trabalha o dia inteiro com uma sobreposição na frente do mapa.
  - *Um endpoint próprio para o aviso, em vez do override de `app` que já existe.* Criaria uma segunda porta de escrita para uma configuração que já tem uma, com a própria validação, a própria trilha e a própria invalidação de memo, e a invalidação é exatamente a coisa que se esquece de pendurar numa porta nova (a razão está escrita em `config.cache.js`: invalidação alcançável só por quem lembra dela é a que fica velha). O override já é transacional, já trava a linha `app_config`, já grava `CONFIG_UPDATE` na trilha e já declara as duas chaves no Joi desde a véspera.
  - *Deixar o campo do painel LIMPAR a URL para vazio.* `urlServidorPrincipal` é `Joi.string().uri()` sem `.allow('')` no servidor, então um vazio reprovaria em 422 o salvamento INTEIRO da aba, e não só aquele campo. O campo segue a regra do título: só uma mudança não-vazia é enviada. Limpar o endereço não se faz da tela, e o efeito que alguém buscaria com isso (a tela sem o botão) se obtém desligando o aviso.
- **Consequências:** o `.env.example` passa a trazer `AVISO_SERVIDOR_SECUNDARIO=false` com o comentário dos dois caminhos, e `docs/wiki/deploy-backend.md` perdeu a frase "a única chave de implantação cujo default é LIGADO", que virou o contrário. A linha `AVISO_SERVIDOR_SECUNDARIO: 'false'` saiu dos DOIS harnesses (`frontend/tests/e2e-ui/backend.js` e `frontend/tests/e2e/global-setup.js`): ela tinha ficado verdadeira por acidente, e um ajuste que fica verdadeiro por acidente é o que a próxima leitura interpreta como norma. O campo do painel valida `http`/`https` no cliente ANTES de enviar, com o mesmo par de esquemas de `urlDoServidorPrincipal`, porque o `.uri()` do Joi aceita coisas que o leitor do cliente descarta em silêncio, e o desfecho seria um 200 com um aviso sem saída. Guardas: os casos invertidos de `backend/tests/unit/aviso-servidor-secundario.test.js` e `backend/tests/integration/config-aviso-servidor-secundario.test.js` (que ganhou o par ligar/desligar, o salvamento das duas chaves juntas e a sobrevivência do override ao memo), mais o spec novo `frontend/tests/e2e-ui/admin-aviso-servidor-secundario.spec.js`, que dirige o gesto do administrador em Chromium real e abre o mapa nos dois estados. O irmão `frontend/tests/e2e-ui/secondary-server-notice.spec.js` continua ligando a tela por remendo da resposta, de propósito: ele prova o aviso sem depender do painel. O spec novo grava no BANCO da bancada, ao contrário do irmão, então ele restaura DESLIGADO num `finally` e AFIRMA a restauração por HTTP cru; sem isso, o Playwright deste pacote roda em série e a sobreposição cairia sobre todo spec seguinte. CONTROLES NEGATIVOS medidos: com o parse revertido ao padrão ligado, 3 dos 12 casos do arquivo de parse e 4 dos 11 da integração reprovam ("Expected values to be strictly equal: true !== false"); com a linha do `appDiff` da caixa de marcação removida do painel, o spec novo reprova na leitura de `GET /api/config` depois de salvar. O terceiro controle está descrito e não foi rodado: removida a restauração do `finally`, o override fica `true` no banco da bancada e todo spec de navegador que rodar depois encontra a sobreposição capturando o primeiro clique.
- **Status:** aceita. Supera a metade do PADRÃO da decisão de 2026-09-03; o resto dela (as duas chaves, a hidratação por `/api/config`, o parse estrito, a declaração no Joi) continua valendo.

### 2026-09-04: o porte de desempenho da `main` entra por lotes, e o despachante de diff manda no desenho

- **Contexto:** a `main` acumulou nove commits de desempenho e ferramentas entre 2026-09-03 e 2026-09-04 (correção de zoom na GPU, terreno sem consulta em dobro, troca de base preservando o app, camada de fonte vazia escondida, MapLibre 6.7.0, utilitário de preview nas ferramentas, linha de coordenação com catálogo novo e largura na GPU, bancada). O contrato deste ramo diverge no ponto central: as 16 fontes GeoJSON principais escrevem por `updateData` pelo despachante de diff (`frontend/src/js/layers/geojson-dispatcher.js`), e o desenho da `main` de ler a coleção por referência (`readGeoJSONSourceData`), mutar e devolver por `setData` não vale nelas, porque `serialize` reconstrói a coleção e um `setData` cru descarta o lote pendente.
- **Decisão:** o porte entra por lotes de arquivos disjuntos (ferramentas, base, bancada, linha de coordenação, zoom, terreno), um agente por lote sobre a mesma árvore, e cada lote só é commitado depois de amostragem do revisor com controle negativo reproduzido (arquivo alvo revertido, testes do lote reprovando, restaurado, verdes). No desenho: o tamanho visual que depende do zoom é expressão na camada (`zoomScaledExpression`), o passe de `zoomend` escreve pelo despachante, e `readGeoJSONSourceData` fica como LEITURA, com o cabeçalho dizendo em que fonte ele vale. A régua é `zoom-pass-events.test.js` (o quadro não chama `getData`) mais a bancada de ferramentas contando `setData` e `updateData` por fonte por gesto.
- **Alternativas recusadas:**
  - *Cherry-pick dos nove commits.* Os caminhos diferem (`src/` contra `frontend/src/`), a escrita de feição é por operação de sync, o config vem do servidor e a ferramenta entra tardia; um cherry-pick pousaria o `setData` cru da `main` sobre as fontes migradas e perderia dado.
  - *Portar a leitura por referência e mutar a coleção nas fontes migradas.* Medido no bundle: numa fonte "updateable" `serialize` devolve uma coleção nova a cada chamada, então a mutação não gruda.
  - *Portar o rearme da compactação da fila de sync.* O destino já tinha marca d'água própria (`COMPACTION_STEP`), à frente da `main`.
- **Consequências:** `getData` por quadro de gesto de zoom cai de 15 controles para zero; escritas na fonte por gesto de zoom caem de 40 para 1 na linha de coordenação (30 linhas), de 90 para 1 no pincel e de 91 para 1 no limite; a troca de base deixa de remontar 74 fontes e 87 camadas; o mapa parado com terreno cai de 19,9 ms, 16 pilhas e 1805 draw calls para 1,7 ms, 1 pilha e 21. Página [[desempenho-do-mapa-2d]].
- **Status:** aceita.

### 2026-09-04: o LOD de tiles servido passa a `null`, e o painel de administração valida o par

- **Contexto:** `sourceTileLodParams` era servido estático como `[5, 6.0]` (`backend/src/modules/config/config.static.js`) e aplicado uma vez em `map_sig.js`, antes do primeiro `setStyle`, que troca todas as fontes: o parâmetro só alcançava a primeira base, e o bloco `map2d` do admin é `.unknown(true)`, então o editor avançado gravava a chave sem checagem nenhuma. A `main` mediu que um primeiro valor abaixo de 2 DESLIGA o nível de detalhe (o par de produção dela, `[1, 10.0]`, pedia cerca de 12 vezes os tiles do padrão a 60 graus de inclinação).
- **Decisão:** do chefe, em 2026-09-04: o padrão servido passa a `null`, que mantém o padrão do MapLibre (o mais leve). O cliente valida por `normalizeTileLodParams` (recusa primeiro valor abaixo de 2 ou segundo abaixo de 1, com aviso) e reaplica por `applyTileLodParams` depois de cada `setStyle`; o schema do admin (`backend/src/modules/config/config.admin.schemas.js`) declara a chave espelhando a validação do cliente, e a declaração não passa a descartar as chaves irmãs.
- **Alternativas recusadas:**
  - *Manter `[5, 6.0]` servido.* Passa na validação, mas pede cerca de quatro vezes os tiles do padrão com a câmera inclinada, e ninguém tinha medido isso quando o valor entrou.
  - *Validar só no cliente.* O admin é a porta viva de configuração deste ramo; sem a borda no Joi um `[1, 10]` salvo no editor avançado chegaria a todo navegador.
- **Consequências:** `frontend/src/js/config.js` declara `null`; teste de unidade e de rota no backend (`backend/tests/unit/config-lod-de-tiles.test.js`); com um par válido plantado, 70 de 70 fontes o recebem antes e depois da troca de base.
- **Status:** aceita.

### 2026-09-04: o MapLibre 6.7.0 entra pelo npm num ponto único, e o vendorizado 5.18 sai

- **Contexto:** a `main` migrou para o 6.7.0 pelo npm (`caf9385e`) e o porte de desempenho do dia trouxe consertos medidos na 5.18 (o pool de 30 texturas do terreno, o `raster-dem` preso em `reloading` ao trocar a projeção). Este ramo carregava o 5.18 por `<script>` em DUAS páginas (mapa e calibração), com `optimizeDeps.exclude`, e o despachante de diff (`frontend/src/js/layers/geojson-dispatcher.js`) tinha a premissa medida na 5.18 de que `updateData` consecutivo perde dado. `frontend/public/vendors/` e o lockfile são caminhos frágeis do repo, e o chefe autorizou tocá-los em 2026-09-04.
- **Decisão:** a biblioteca entra pelo npm em `frontend/src/js/map/maplibre.js`, ponto único que importa o namespace (a 6.x não tem `export default`), chama `setWorkerUrl` com o worker importado por `?worker&url` (sem isso o Vite resolve o worker em `.vite/deps` e o mapa sobe sem tile) e mantém o global para os 26 arquivos que o usam. As duas páginas entram pelo grafo, os nove construtores ganham `zoomLevelsToOverscale: undefined`, o vendor é apagado e o teto de peso é recentrado com a medida do dia. Os contornos medidos na 5.18 FICAM com o cabeçalho dizendo o que a 6.7 muda: `setProjectionKeepingHillshade` (o `reloading` preso não reproduz na 6.7, medido com pior caso construído) e o despachante (a perda em `updateData` consecutivo PIOROU: 1 de 10 aplicadas contra 2 de 10 na 5.18, e 10 de 10 num lote).
- **Alternativas recusadas:**
  - *Ficar na 5.18 vendorizada e carregar shim de compatibilidade em cada porte.* Toda medida futura da `main` viria de outra versão, e o pool de texturas e o `reloading` preso continuariam.
  - *Grupo de chunk próprio para a biblioteca.* Escrito, medido em três builds e desfeito: `dist/` byte a byte idêntico e o nome do chunk composto, regra inerte.
  - *Apagar o contorno da projeção porque a 6.7 não reproduz o defeito.* Contorno medido não se apaga sem medir; ele é API pública e dois quadros, e o cabeçalho registra a medida nas duas versões.
- **Consequências:** `frontend/package-lock.json` ganha 223 linhas (22 pacotes da árvore do MapLibre e dois `@emnapi/*` dev/optional refrescados); os tetos de `index.html` e `calibracao.html` sobem de 3000 para 4150 e de 1100 para 1980 kB, com `atlas` e `admin` idênticas como prova; o worker separado (620 kB) fica fora da conta e declarado; draw calls com terreno caem cerca de 30% e os stamps de pool vão a zero; a régua `maplibre-construtores-regua.test.js` proíbe que página ou módulo volte a apontar o vendor. Página [[peso-do-pacote-web]].
- **Status:** aceita.

### 2026-09-05: o MapLibre se lê pelo ponto único, e a régua que prende isso é de escopo

- **Contexto:** com o 6.7.0 pelo npm (decisão de 2026-09-04) o ponto único `frontend/src/js/map/maplibre.js` ainda gravava `window.maplibregl` para 20 módulos que liam o global (29 sítios; nove outros só citam em JSDoc, e `terrain/terrain-elevation.js` lia `globalThis.maplibregl?.LngLat`, forma que escapa ao `grep` por `maplibregl.`).
- **Decisão:** todo módulo de `frontend/src` que usa a biblioteca importa `maplibregl` do ponto único; o global fica gravado só para quem está fora do bundle (a bancada, os `page.evaluate` do Playwright e a calibração por spec), e o cabeçalho do ponto único diz isso. A régua é uma regra de ESLint da casa (`eslint-rules/no-maplibre-global.js`), de ESCOPO e não de texto: acusa a referência ao identificador que não resolve para ligação local e as formas `window`, `globalThis` e `self`, com exceção só para o ponto único por caminho.
- **Alternativas recusadas:**
  - *`no-restricted-globals`.* Não alcança `window.maplibregl` nem `globalThis.maplibregl?.`, que era justamente a forma fora do grep.
  - *Manter o global como contrato dos módulos.* Duas rotas para a mesma instância convidam a uma segunda cópia da biblioteca (medido no navegador: `mod.maplibregl === window.maplibregl`, 85 nomes, uma instância), e o import é o que o bundler vê.
- **Consequências:** 39 arquivos; `terrain-elevation.js` ganhou de brinde um conserto real, a longitude além do antimeridiano que lia 0 m calado porque o objeto montado à mão não normalizava (`wrap()` do `LngLat` de verdade, com caso de teste); cinco testes trocam a costura do dublê por `vi.mock`; a régua vista reprovar os 20 arquivos reais, quatro formas construídas e um `window.maplibregl` reintroduzido. Páginas sem mapa idênticas kB a kB no build.
- **Status:** aceita.

### 2026-09-05: a caixa de seleção acompanha o quadro de zoom de verdade, com cache; o `zoomend` fica para o chefe

- **Contexto:** o relatório da `main` e o lote de zoom deixaram escrito que a `selection-highlight` e as seleções remotas "seguem por quadro em JavaScript". Medido num gesto de 1,5 nível em 1,5 s: 92 eventos `zoom`, 92 chamadas do handler, e só 2 passadas locais e 1 render remoto, os dois depois do gesto. Os dois debounces cancelavam e reagendavam o próprio quadro: o MapLibre pede o quadro seguinte antes de emitir o `zoom` daquele quadro, a entrada dele vem na frente na lista e o handler mata a própria callback (183 cancelamentos de rAF por gesto contra 1 sem o defeito). A caixa só se atualizava quando o gesto parava.
- **Decisão:** agendar uma vez em vez de cancelar e reagendar; separar a resolução do alvo (assíncrona, lê a fonte) da montagem da caixa (síncrona), reaproveitar a lista resolvida pelo quadro e invalidá-la pelos eventos que já existiam; guarda de escrita por referência na local e por conteúdo na remota. Medido com 1, 10 e 50 feições: passadas 2 para 47, escritas 2 para 3 (local) e 1 para 0 (remota), resoluções de fonte por gesto na remota de 50 para zero, JS por gesto até 10,7 ms com 50 feições, cadência p95 16,8 ms intacta. O lado da caixa em pixels ficou 2,828 com e sem o conserto para os seis controles que guardam `properties.selectionBox`; o que muda por quadro é a margem em pixels das treze ferramentas sem caixa guardada.
- **Alternativas recusadas:**
  - *Caixa como expressão de estilo.* Ela é feição de fonte própria, lida por painel, exportação e cabeçalho.
  - *Tirar a quantização de 0,5 nível.* 23 vezes mais montagens de caixa com cadência idêntica; a quantização deriva até 19% de tamanho na tela e fica.
- **Consequências:** `selection-highlight-passe-de-zoom` (8 casos, 4 vermelhos no estado anterior) e `remote-selections-passe-de-zoom` (6, 3 vermelhos); os dois gerentes e a camada de cursores remotos importam o ponto único do MapLibre. Fica para o chefe: `zoomend` em vez de por quadro (compra a margem certa nas treze ferramentas ao custo de até 10,7 ms de JS por gesto), e a assimetria entre o cache quantizado local e a remota que remonta do zero.
- **Status:** aceita, com a pendência de `zoomend` declarada.

### 2026-09-05: o teste do índice de auditoria afirma o caminho por `target_id`, porque o Postgres 18 escolhe o composto por skip scan

- **Contexto:** `audit-indice-target-id.test.js` reprovava nesta máquina no caso com OFFSET 100, exigindo `idx_audit_target_id` no plano. No PostgreSQL 18.1 o planejador escolhe `idx_audit_target` (o composto antigo) com `Index Cond: (target_id = ...)` e `Index Searches: 2`, custo 426 contra 522: é o skip scan da 18, que com uma coluna líder de cardinalidade 1 responde a pergunta em duas buscas. Em buffers os dois caminhos empatam (306 contra 304, medido com o composto derrubado numa transação).
- **Decisão:** o caso paginado afirma o CAMINHO (índice com `target_id` na condição, nunca `idx_audit_created` filtrando nem varredura), e a página 1 continua exigindo o índice novo e o plano sem Sort, que é o ganho que ele existe para dar. A premissa do arquivo ("condição só na segunda coluna custa o índice inteiro") vale até a 17 e está datada no comentário.
- **Alternativas recusadas:**
  - *Fixar a versão do Postgres do teste ou pular na 18.* Esconderia o que a 18 mudou de verdade, e a máquina de desenvolvimento é 18.
  - *Apagar o índice novo porque o composto serve.* Serve para a busca; o ganho ordenado da página 1 (sem Sort) só o novo dá.
- **Consequências:** 4 de 4 verdes; o backend fecha em 4.979 nesta máquina.
- **Status:** aceita.

### 2026-09-05: o menu da engrenagem acompanha a rolagem do próprio painel em vez de fechar

- **Contexto:** o spec `browser-collab-conversao-linear` reprovava em cerca de metade das rodadas isoladas, e a hipótese herdada (a cascata de reconstruções do painel descartando o menu) estava errada: a sonda que registrou a pilha da remoção e os eventos entre o clique e o sumiço mostrou o menu anexado ao `body` e removido 1 a 11 ms depois por `dropdownScrollHandler`, sem reconstrução nenhuma (`renderId` igual). O `scroll` vinha de `.feature-panel-content`: o foco que o clique dá ao botão rola o contêiner para trazê-lo à vista, e o ouvinte global de `scroll`, registrado no documento em fase de captura, via qualquer rolagem de qualquer elemento.
- **Decisão:** rolagem de um elemento que CONTÉM o botão ativo reposiciona o menu (`positionFeatureDropdown`), porque o menu é filho do `body` posicionado pelo `getBoundingClientRect()` do botão; rolagem da página, do mapa ou de outra lista continua fechando. A decisão é pura em `tool_manager/helpers/dropdown-scroll.model.js`, provada em node com objetos falsos, e o comportamento no navegador pelo spec (3 rodadas isoladas, 12 de 12).
- **Alternativas recusadas:**
  - *Só o spec esperar mais.* O menu sumia para o usuário, não para o teste: a régua acusava um defeito de produto.
  - *Abrir o menu no quadro seguinte ao clique, depois da rolagem do foco.* Esconde a causa e depende da ordem entre foco, rolagem e quadro, que não está prometida.
- **Consequências:** o mesmo ouvinte ganha o comportamento "acompanha ou fecha" para qualquer painel rolável que venha a segurar a engrenagem. A saída da conta ganhou, na mesma sessão, o conserto de `eraRemoto` lido antes do teardown (sem decisão de desenho: era corrida, e está no livro-razão e na régua de ordem).
- **Status:** aceita.

### 2026-09-06: o bitmap vencido se regenera na CARGA, e o carimbo dele é escrita local sem op

- **Contexto:** o lote de bitmaps recortados trocou o LAYOUT do PNG de símbolo militar e de medida de coordenação: a versão 1 desenhava centrado num quadrado, com faixas transparentes dos dois lados, e a 2 recorta no desenho e pode trazer `iconOffset`. Feição salva antes disso guarda o PNG velho no IndexedDB e os números velhos nas propriedades, e `setImages` (`frontend/src/js/layers/layer_setup.js`) só regenerava quando o blob LOCAL faltava: quem tem o blob desenha a v1 para sempre. Não é cosmético, porque a caixa de seleção e o hit-test do clique SÃO o retângulo do bitmap, então a feição antiga responde ao clique sobre faixa transparente, e nas duas conversões de ponto (para símbolo e para medida) o desencontro chega como tamanho errado. O `main` pagou isso com um degrau de esquema, a v2.4, que varre os quatro handles de armazenamento e reassa cada bitmap; aqui a versão de esquema está congelada em 2.3 pela decisão de 2026-09-03, e uma migração não alcançaria o caso que importa de qualquer jeito, porque `migrateActiveSlot` só roda em slot LOCAL e o atlas de servidor chega por snapshot.
- **Decisão:** o degrau de esquema não existe, e o conserto é o próprio caminho de desenho, em duas metades. (1) `setImages` pergunta `needsBitmapRebuild` (`frontend/src/js/layers/bitmap-version.js`) antes de aceitar o blob do disco, e regenera também quando o carimbo está vencido. A pergunta mora ali, e não em `military_tools/`, porque `layer_setup.js` é ansioso e a página do mapa orça ZERO módulos daquela pasta no grafo ansioso (`frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js`); `isStaleBitmapFeature` (`frontend/src/js/military_tools/symbol-bitmap.regenerate.js`) passou a delegar para a mesma função, para não existirem duas respostas livres para divergir. (2) Depois de reassar, `stampRegeneratedBitmap` (`frontend/src/js/military_tools/bitmap-stamp.js`) faz a feição em mãos, a fonte viva e o documento guardado descreverem o bitmap novo: a feição por `applyGeneratedBitmap`, a fonte por `generatedBitmapPatch` pelo despachante de diff, e a store por `stampGeneratedBitmap` (`frontend/src/js/store/feature.operations.js`), que é o caminho SILENCIOSO, com a mesma forma que `applyRemoteFeatureOpLocked` (`frontend/src/js/store/sync/remote-operation-handler.js`) usa para pousar a op de um par: trava do documento, leitura pelo repositório, mutação, gravação pelo repositório. Sem `logFeatureOperation`, sem `touchUpdatedTimestamp`, sem evento, sem `runTransaction` (que cunharia um id de rastro, registrando no ledger um gesto de usuário que não houve) e sem `guardWrite`. A justificativa é uma só: o blob é cache POR CLIENTE por desenho, nunca sobe, e as propriedades derivadas apenas o descrevem; nada foi autorado e nada é enviado. Os dois controles de símbolo chamam a mesma função no `_regenerateRemote`, que é por onde passam tanto a carga do mapa quanto a op de par (`_subscribeRemoteImageRegen`): a op de um par v1, sem `iconOffset`, desenha exata, e a de um par v2 chega como patch que não muda nada.
- **Alternativas recusadas:**
  - *A v2.4 do `main`, com os quatro `localforage.createInstance`.* Duas recusas independentes, e a segunda basta sozinha. A primeira é de forma: `localforage.createInstance` fora de `frontend/src/js/store/atlas-namespace.js` é proibido aqui, com guarda estrutural (`frontend/tests/unit/repository-namespace.test.js`). A segunda é de alcance: a migração roda no slot local montado, e o atlas de SERVIDOR nunca passa por ela, então ela gastaria uma versão de esquema, um arquivo, um elo da cadeia e um número para a próxima conferência explicar, deixando de fora exatamente o caso multiusuário.
  - *Um normalizador PURO na leitura, nos três caminhos, como o balde de linhas de coordenação de 2026-09-03.* Aquela forma funciona porque a correção é um `Array.isArray` sobre uma chave. Esta não é pura: para saber `width`, `height` e `iconOffset` do bitmap novo é preciso ASSAR o bitmap, o que quer dizer canvas, milsymbol e o catálogo de pontos dentro de uma leitura de repositório, que roda em `getMap` a cada leitura de mapa e na aplicação de cada snapshot.
  - *Carimbar de verdade, por op de sync.* Uma op UPDATE por feição antiga, emitida na abertura do atlas, sem ninguém ter tocado em nada: por LWW todo par receberia uma escrita que pessoa nenhuma fez, e o par que ainda não regenerou receberia números de um bitmap que ele não tem. Além disso um Leitor não pode emitir op nenhuma, e é justamente ele que mais abre atlas alheio.
  - *Patchear só a fonte e deixar a store em paz.* Foi considerada porque é a opção mais barata, e ela perde: a caixa tracejada e o painel leem a cópia da STORE, então a feição de núcleo antigo continuaria com a caixa deslocada do desenho até uma edição autorada carimbá-la.
- **Consequências:** a regeneração passou a ter duas causas (blob ausente e carimbo vencido) e só os DOIS tipos carimbados respondem pela segunda, porque a declinação magnética também desenha PNG do cliente e também tem regenerador, mas o gerador dela devolve blob pelado e nunca carimba: lê-la como vencida regeneraria toda declinação em toda carga, para sempre. Em atlas de SERVIDOR o snapshot seguinte pode sobrescrever o carimbo local, e então a regeneração recorre uma vez por sessão, até uma edição autorada carimbar de vez; é o preço aceito de não gastar versão de esquema, e ele custa um PNG por feição antiga na abertura. A importação de `.ebgeo` não precisa de gancho: os PNGs do arquivo são v1 e a feição chega sem carimbo, então a carga regenera. Um caso novo, pequeno e declarado: com o blob no disco e o gerador falhando, o que se carrega é o bitmap VELHO, porque uma regeneração que não vingou deixa de pé um bitmap do símbolo, e o layout antigo ganha do ícone de erro; `addErrorImageIfNeeded` ficou reservado ao caso em que não há blob nenhum, e a carga seguinte da página tenta regenerar de novo. Guardas: `frontend/tests/unit/bitmap-vencido-regenera-na-carga.test.js` (12 casos, três vermelhos com o `layer_setup.js` revertido, e o caso da declinação, que é o que separa a regra certa da parecida), `frontend/tests/unit/carimbo-de-bitmap-sem-op.test.js` (9 casos, três vermelhos quando o carimbo vira edição autorada) e `frontend/tests/unit/carimbo-de-bitmap-na-fonte.test.js` (7 casos, três vermelhos sem o `patch` do despachante), com `frontend/tests/unit/despachante-sem-escrita-crua.test.js` e `frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js` de pé como guardas da branch.
- **Status:** aceita.

### 2026-09-06: a medida de coordenação deixa de guardar o próprio PNG em base64, e o marcador de ponto entra no hit-test exato

- **Contexto:** duas metades, portadas da `main` (`fa913ded` e `6fc801b2`) no mesmo lote, porque as duas mexem no que a feição de símbolo guarda e no que o clique nela decide. (1) Toda medida de coordenação gravava `properties.imageUrl`, uma cópia em base64 do PNG que ela acabara de desenhar: seis sítios de escrita, nenhum leitor. Na `main` isso custava o IndexedDB e todo `.ebgeo`; NESTA linha custa mais, porque as propriedades da feição são o corpo JSONB de toda operação de sync e da linha em `features`, então a base64 viajava dentro de cada envelope e de cada linha do banco. O `FileReader` que a produzia rodava a cada regeneração, inclusive nas coalescidas por quadro durante um arrasto de controle, e o único consumidor de data URL é a prévia do modal de escolha do ponto. (2) `point-marker-layer` é uma camada de símbolo como as quatro de imagem, com a mesma caixa de colisão que infla até 2x entre zooms inteiros, e ela NÃO era reconstruída em `frontend/src/js/tool_manager/helpers/hit-test.model.js`: a linha dela era não decisiva, então clicar num marcador dentro de um polígono abria o menu de escolha em vez de selecionar o marcador. O motivo registrado no módulo era que a especificação do marcador diverge em todos os campos (`sizeCreatedAtZoom` com padrão 0, `sizeZoomCorrectionEnabled`, um `divideBy`), e uma regra com a forma das outras calcularia um retângulo errado.
- **Decisão:** (1) Os seis sítios saem, `generate()` devolve o mesmo formato de `generateSymbolBlob` e a codificação vira `blobToDataUrl` (`frontend/src/js/utilities/blob-to-data-url.js`), chamado nos três pontos do modal que de fato precisam de uma URL para um `<img src>`; o mesmo utilitário absorveu o leitor duplicado que morava em `frontend/src/js/utilities/image_utils.js`. `applyGeneratedBitmap` APAGA a chave e `generatedBitmapPatch` a põe em `unsetProps` (`frontend/src/js/layers/bitmap-version.js`), de modo que a feição em mãos, o documento guardado e a FONTE VIVA a perdem juntos: sem migração, a feição antiga perde a chave na próxima regeneração ou edição. (2) As regras de tamanho do hit-test ficam genéricas (`sizeProp`, `anchorProp`, `anchorDefault`, `enabledProp`, `divideBy` e `tolerant`), a regra do marcador replica a expressão da camada (base `size` com padrão 10 sobre `sizeCreatedAtZoom` com âncora 0, teto 500, dividido por `POINT_IMAGE_HALF_SIZE`, que é 24) e o marcador entra em `EXACT_ICON_LAYER_IDS`, o que o torna decisivo. Ele é a única camada com `tolerant`: um ícone de 20 px que substitui um PONTO é alvo fino como uma linha e ganha a folga do clique, enquanto as quatro camadas de desenho são acertadas exatas. Texto e rótulos seguem não decisivos.
- **Alternativas recusadas:**
  - *Manter `imageUrl` por compatibilidade.* Varrido nos dois pacotes, sobra o que não é esta propriedade: o `imageUrl()` do cliente de API, que monta a URL da ROTA de imagem, e a lista de chaves de sistema de `frontend/src/js/user_data/user_data_manager.js`, que a mantém justamente para uma chave legada nunca ser oferecida como atributo do usuário. Guardar chave que ninguém lê aqui não é inércia barata: é uma cópia inteira do bitmap em cada envelope de sync e em cada linha JSONB.
  - *Migrar a chave embora com um degrau de esquema.* Mesma recusa da entrada acima, e pelas mesmas duas razões: a versão de esquema está congelada em 2.3 pela decisão de 2026-09-03, e a migração só roda em slot LOCAL, então o atlas de servidor, que é o caso em que a base64 mais pesa, ficaria de fora. Apagar na próxima regeneração é grátis e alcança os dois.
  - *Apagar só da feição e deixar a fonte viva com a chave.* Foi considerada porque `applyGeneratedBitmap` sozinho parece bastar, e ela perde: os controles LEEM a coleção de volta (`getData`) para medir a caixa de seleção, então a chave mantida na fonte voltaria ao documento guardado na escrita seguinte.
  - *Deixar o marcador não decisivo e resolver a ambiguidade no menu.* É o estado anterior, e o menu era o custo: o gesto mais comum do desenho de pontos (clicar no próprio marcador) pedia um segundo clique sempre que houvesse área embaixo.
  - *Dar ao marcador a regra das quatro camadas de imagem.* Recusada por medida, e é a razão de os campos virarem nomes: a expressão do marcador lê OUTRAS propriedades e divide o valor inteiro depois do teto, então a regra copiada erraria o retângulo em vez de não ter nenhum. A régua é um teste de propriedade que compara a réplica com a expressão COMPILADA da camada.
- **Consequências:** o `FileReader` sai do caminho de desenho e fica só na prévia; a feição de medida deixa de carregar uma cópia de si mesma para o IndexedDB, para o `.ebgeo`, para a fila de operações e para o banco; a chave legada sai por `unsetProps` também da fonte viva, que é o que impede o retorno dela pela leitura. No clique, o marcador de ponto passa a ser acertado pelo retângulo DESENHADO mais a folga, e passa a decidir a prioridade de classe. Guardas: `frontend/tests/unit/blob-para-data-url.test.js` (3 casos, novo), `frontend/tests/unit/bitmap-recorte-do-simbolo.test.js` (20 para 27 casos: o do `applyGeneratedBitmap` mais a varredura de fonte que prende os cinco sítios do controle, que é acoplado ao MapLibre e não carrega em `node`), os dois casos novos de `frontend/tests/unit/conversao-ponto-medida-razao-de-pixel.test.js`, o caso da fonte em `frontend/tests/unit/carimbo-de-bitmap-na-fonte.test.js` (7 para 8), e `frontend/tests/unit/hit-test.model.test.js` (103 para 120 casos) com `frontend/tests/unit/feature-hit-test.helpers.test.js` (62 para 73), de pé junto com `frontend/tests/unit/despachante-sem-escrita-crua.test.js` e `frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js`. O censo de tipos de feição ganhou a entrada de `frontend/src/js/tool_manager/helpers/hit-test.model.js`, que faltava desde o lote A e deixava `frontend/tests/unit/registro-tipos-cobertura.test.js` vermelho na ponta da branch: as duas listas dele são as EXCEÇÕES à classe padrão do clique, e a entrada diz que elas não devem ficar completas.
- **Status:** aceita.

### 2026-09-07: os três diálogos de perda nomeiam o que apagam, e o import julga o arquivo antes de gastar uma vaga

- **Contexto:** a auditoria de atlas locais da transição mediu três pontos em que a tela não dizia o que o botão faz. (1) Excluir um atlas local derruba os bancos dele por `dropAtlasDatabases`, e no slot de sufixo VAZIO isso são os onze bancos sem sufixo, o acervo inteiro de uma instalação vinda da linha anterior do produto; a confirmação era `Os mapas, feições e imagens deste atlas serão apagados deste navegador. Não há como desfazer.`, a MESMA frase para esse atlas e para um em branco criado há um minuto, e o slot adotado se chama "Meu Atlas", que é também o nome de fábrica. (2) Arrastar um `.ebgeo` para o mapa e escolher "Substituir Atual" chama `clearAllDataStore()` no escopo montado, e o modal eram duas frases (`Importar Atlas` / `Como deseja importar este atlas?`) com dois botões, sem "Cancelar" (só clicar fora), sem marca destrutiva e sem nomear o atlas nem a perda; o vizinho que faz MENOS, o "Limpar tudo" da aba Mapas, já nomeava o atlas e marcava a perda item a item. (3) No boot que consome o `.ebgeo` deixado por "Abrir arquivo .ebgeo" (`frontend/src/js/deep-link/pending-import.js`), o atlas local era criado ANTES de o importador abrir o arquivo, então toda recusa (versão acima do teto, ZIP corrompido, `data.json` ausente) deixava um atlas vazio com o nome do arquivo, o usuário dentro dele, e uma das dez vagas gasta; dez tentativas travam a criação de atlas.
- **Decisão:** as contagens do escopo de um atlas passam a ser legíveis SEM montar, por `countAtlasContents` (`frontend/src/js/store/atlas-contents.js`, que só chama `iterate` e `keys` com o escopo passado explicitamente, como `frontend/src/js/projects/send-local-to-server.service.js` já fazia), e a renderização delas em pt-BR é uma só, `atlasContentsLines`, consumida pelos dois diálogos. (1) `deleteConfirmMessage` (`frontend/src/js/projects/local-atlas-notices.js`) recebe nome e contagem e passa a dizer `Isso apaga TODO o conteúdo do atlas "X" deste navegador e NÃO pode ser desfeito:` com uma linha por seção existente e a garantia de que os outros atlas ficam; atlas vazio e contagem DESCONHECIDA (leitura que falhou) continuam com a frase curta de sempre, porque não saber quanto há nunca autoriza afirmar quanto há. (2) O modal artesanal do arrastar sai inteiro e a pergunta passa a ser `showChoice` (`frontend/src/js/modals/confirm.modal.js`), com "Cancelar" (inerte), "Adicionar ao Atual" (primária) e "Substituir Atual" (destrutiva), nessa ordem; o texto é `importModeDialog`, puro e exportado de `frontend/src/js/import_export/drag-drop.handler.js`, e ele tem DOIS ramos, porque num atlas de SERVIDOR o mesmo botão não apaga nada (o import abre um atlas local novo e deixa o do servidor intacto) e anunciar destruição ali seria falso alarme. (3) O portão de versão e o leitor do arquivo saem para `frontend/src/js/import_export/ebgeo-file-gate.js` (`readEbgeoArchive`, `importVersionRefusal`, `isV1Format`, `xorMask`), com o predicado inalterado e os dois tetos lidos das constantes; o serviço de import passa a ler por ele, e `pending-import.js` parseia e julga ANTES de chamar o criador de atlas.
- **Alternativas recusadas:**
  - *Deixar o `.ebgeo` ser julgado pelo importador, como antes, e apagar o atlas órfão depois.* O próprio cabeçalho de `pending-import.js` já registrava por que não: com duas abas, quem recusa não é quem é dono do slot, e a exclusão anuncia um teardown que congela a aba dona. Impedir o órfão de nascer é mais barato que limpá-lo.
  - *Duplicar o leitor do `.ebgeo` no boot para não carregar o serviço.* É a cópia que não pode existir: o boot e o serviço discordariam sobre o que é importável. O módulo folha resolve os dois, e o custo aceito é o arquivo aberto duas vezes nesse caminho.
  - *Manter o modal próprio do arrastar e só acrescentar um botão "Cancelar".* Ele seria a segunda cópia de tudo o que `showChoice` já decide (variante destrutiva, foco no botão inerte, Enter deliberadamente morto no modo de N ações, dispensa que resolve `null`), e foi justamente a cópia que nasceu sem "Cancelar".
  - *Uma frase única para o arrastar, sem o ramo de servidor.* Diria "apaga TODO o conteúdo" onde nada é apagado. Tela que mente sobre destruição gasta a confiança que a frase existe para comprar.
  - *Contar o conteúdo montando o slot.* `atlas.html` boota sem store de propósito, e o cartão que se exclui quase nunca é o slot montado.
- **Consequências:** duas leituras rasas de IndexedDB entram no caminho dos dois diálogos (uma passada em `ebgeo_maps` e as CHAVES de `ebgeo_images`), e `atlas-contents.js` é um segundo leitor do formato de disco, com o mesmo preço declarado do vizinho de `projects/`: um mapa que mude a forma de `features` muda um número, nunca um byte. O CSS `.import-mode-modal` (`frontend/src/css/import-export.css`) ficou sem produtor e é poda pendente. Guardas: `frontend/tests/unit/exclusao-de-atlas-local-nomeia-a-perda.test.js` (22 casos, 8 vermelhos no estado anterior, com o controle do atlas vazio que reprova número na frase), `frontend/tests/unit/substituir-atual-nomeia-a-perda.test.js` (16 casos, 16 vermelhos antes, com o controle do atlas de servidor) e `frontend/tests/unit/import-recusado-nao-gasta-vaga.test.js` (10 casos, 6 vermelhos antes, contando `listLocalAtlases()` antes e depois com o criador de atlas de verdade e arquivos `.ebgeo` de verdade, mais o controle positivo do arquivo bom). Dois testes tiveram a verdade antiga REESCRITA com a razão: a asserção de fiação de `frontend/tests/unit/seus-atlas-sem-servidor.test.js` e a entrega opaca de `frontend/tests/unit/pending-import-consumo.test.js`, que agora precisa ser um arquivo de verdade porque o consumidor passou a lê-lo. Os dois diálogos foram fotografados no navegador (Playwright dirigindo app e backend reais) e as fotos lidas.

  Três acabamentos da mesma família entraram em 2026-09-07, depois que a bancada mediu o DEPOIS no navegador e achou mais três lugares em que a tela cala. O menu da conta passa a nomear o atlas LOCAL montado, lendo o registro de slots como o cabeçalho do mapa já lia, e sem selo de permissão, porque o eixo de permissão é do servidor; antes o rótulo sumia por falta de `syncEngine.atlasId`, e o nome que o usuário deu ao acervo só aparecia em "Seus atlas". `readEbgeoArchive` (`frontend/src/js/import_export/ebgeo-file-gate.js`) traduz a falha de ABERTURA do arquivo para uma frase da casa, com o nome do arquivo e o erro original em `cause`, no lugar do `Can't find end of central directory` do JSZip, que chegava ao usuário em inglês e com link para a documentação da biblioteca; o `data.json` ausente e o JSON inválido ficam como estavam, e o segundo por decisão, porque ali o arquivo abriu e a posição do caractere é a pista. E o expurgo LEGÍTIMO do marcador REMOTE, o ramo pré-namespace que apaga os bancos sem sufixo, passa a escrever uma linha de `console.info` com o atlas do marcador e quantas chaves de mapas e de imagens apagou, contadas ANTES de esvaziar: a única linha que existia conta o que SOBROU, e "1 mapa(s)" é o que o suporte lia depois de 14 irem embora. Guardas: `frontend/tests/unit/nome-do-atlas-local-no-menu-da-conta.test.js` (8 casos, novo, 3 vermelhos antes, com o controle do atlas de servidor e o da instalação sem registro), `frontend/tests/unit/recusa-de-arquivo-corrompido-fala-portugues.test.js` (10 casos, novo, 6 vermelhos antes, sobre dois insumos degenerados e quatro controles) e o caso pré-namespace de `frontend/tests/integration/marcador-remote-orfao-no-boot-deslogado.test.js`, que passou a exigir 14 mapas e 149 imagens na linha, vermelho contra o código anterior e vermelho também com a contagem feita DEPOIS do expurgo, que é a variante que devolveria zero sem errar em nada visível.
- **Status:** aceita.

### 2026-09-07: o esquema desta linha vai para 3.0, e o degrau decide o ramo pelo REGISTRO GLOBAL, nunca pelo número

- **Contexto:** o número 2.3 significava DUAS coisas em disco. Na outra linha do produto ele criou o balde `coordination_lines` (2026-09-03) e nesta ele registrou o primeiro atlas local nomeado (2026-08-14); depois a outra linha seguiu para 2.4, número que esta nunca teve. Como `detectMigrationNeeded` compara NÚMERO (`compareVersions(currentVersion, ATLAS_SCHEMA_VERSION) >= 0`), um repositório carimbado 2.3 ou 2.4 por ela respondia "já está na versão corrente" aqui, e a cadeia inteira, inclusive a adoção dos bancos sem sufixo como slot #1, não corria: sem erro, sem log, e justamente para o usuário que atravessava. O mesmo número fechava o portão do `.ebgeo`: com o teto em 2.3 todo arquivo exportado pela outra linha desde 2026-09-06 era recusado inteiro, medido em 805 feições, e o MESMO arquivo com o campo `version` reescrito para "2.3" entrava sem perder nada. Uma auditoria em navegador real mediu ainda que a travessia não escrevia uma única linha de console: o suporte não tinha como confirmar que a adoção acontecera.
- **Decisão:** `ATLAS_SCHEMA_VERSION` passa a `'3.0'`, acima de todo número que a outra linha pode produzir, e o degrau que era `v2.2-to-v2.3` vira `frontend/src/js/store/migration/v2.x-to-v3.0.migration.js` com `TARGET_VERSION = '3.0'`, encadeado por `compareVersions(currentVersion, '3.0') < 0`. O RAMO do degrau não se decide pelo número nem pelo conteúdo, e sim por um fato de forma: existe no banco global uma entrada de atlas local com `dbSuffix` vazio? Escopo com sufixo só carimba (é o caminho de `migrateActiveSlot`); escopo legado JÁ reivindicado é instalação desta linha e só carimba; escopo legado não reivindicado veio da outra linha, em qualquer número, e recebe a adoção completa mais o descarte da fila legada. A pergunta só tem resposta ANTES de `initLocalAtlases`, porque o bootstrap dele escreve exatamente a entrada procurada, então `activateBootAtlasScope` a faz primeiro e guarda a resposta em `frontend/src/js/store/migration/boot-legacy-adoption.js`, na mesma forma de `bootTabMountPointer`; sem boot que tenha observado, o degrau lê o registro por conta própria, que é a resposta certa para quem não teve boot. Três consertos vêm junto. (1) O NOME do atlas do usuário: `activateBootAtlasScope` passa `bootstrapName` lido do registro de atlas, de modo que o slot nasce com o nome certo em vez de ser batizado "Meu Atlas" e reparado depois, `stampVersion` deixa de reescrever `name` (era o alinhamento na direção que apagava o nome), e o degrau RENOMEIA a entrada do registro de slots a partir do record quando os dois discordam, que é o estado deixado por quem já atravessou. (2) A entrada "1.7": a versão efetiva de um escopo passa a ser a do REGISTRO DE ATLAS quando o settings declara um v1 e o registro declara 2.x, e `migrateToV2` recusa correr sobre registro 2.x, as duas metades da mesma regra. (3) O boot escreve UMA linha nomeando o ramo, a procedência dos bancos, o que foi adotado, descartado ou só carimbado, e a contagem de mapas do escopo. `MIN_SCHEMA_VERSION` e `MIN_MIGRATABLE_VERSION` FICAM em '1.3', com teste próprio.
- **Alternativas recusadas:**
  - *Manter 2.3 e detectar por forma, sem subir número.* Consertaria a adoção e não consertaria o portão do `.ebgeo`, que é o único caminho de salvação se a aplicação nova não for servida na MESMA origem da antiga: o teto continuaria em 2.3 e o arquivo 2.4 continuaria recusado.
  - *2.4 ou 2.5.* Mantém as duas linhas compartilhando um espaço de numeração que já colidiu uma vez, e 2.4 colidiria de imediato com um número que a outra linha já gravou em disco.
  - *Trocar só a constante.* Medido: com a constante em 3.0 e o degrau parado em 2.3, um banco em 2.4 pede migração, NENHUM degrau corre, `safelyMigrate` devolve sucesso e loga "Migration completed successfully", e o boot seguinte pede tudo de novo, para sempre. O caminho que RODA também não alcança 3.0, porque `TARGET_VERSION` era o literal `'2.3'`. É por isso que a régua obrigatória é a CONVERGÊNCIA: dois boots, e o segundo sem pedir nada.
  - *Discriminar por conteúdo (`coordination_lines` ou `bitmapVersion`).* Nenhum dos dois separa o que precisa ser separado: o balde não distingue 2.2 de 2.3 num atlas sem mapa, e `bitmapVersion` não distingue 2.3 de 2.4 num atlas sem símbolo nem medida. Os dois respondem "antigo" para o atlas vazio, que é o que uma instalação nova produz.
  - *Aceitar em silêncio um `.ebgeo` de versão acima da corrente.* A regra "acima da corrente é recusado" fica: ela é simétrica nas duas linhas e protege o gesto destrutivo que vem logo depois dela, porque o import não aditivo limpa o projeto do usuário. O que muda é só o teto.
  - *Reparar o nome do atlas apenas dentro do degrau.* Um reparo que precisa correr em todo boot é um defeito sendo recriado em todo boot: o `bootstrapEntry` chegava primeiro e cravava "Meu Atlas". O reparo fica para quem já atravessou; a prevenção é o `bootstrapName`.
- **Consequências:** a contrapartida, dita em voz alta: depois desta subida um `.ebgeo` exportado aqui (3.0) é RECUSADO pela outra linha (teto 2.4), com mensagem e sem destruir nada. O arquivo passa a ser via de mão única a partir da travessia. Na entrada vinda da outra linha o degrau ESVAZIA a fila legada de operações (`ebgeo`/`operation_queue` no escopo sem sufixo), e o número vai para o log: são operações que aquela linha enfileirou sem ter servidor de destino (446 numa sessão medida de 805 feições), sem carimbo de atlas, que o roteamento levaria inteiras para a fila de um atlas de SERVIDOR no primeiro boot logado. Essa guarda tem uma irmã no mesmo passe, e as duas se completam: `addressForUnstamped` (`frontend/src/js/store/sync/operation-queue-migration.js`) passou a NUNCA endereçar operação sem carimbo para escopo remoto (kind REMOTE ou sufixo `remote-<id>`, inclusive o slot local adotado de um remoto), deixando-a no endereço legado, que é a fila do slot local #1; a régua é `frontend/tests/unit/fila-legada-nunca-vai-para-atlas-de-servidor.test.js`, com 3 de 5 casos vermelhos no estado anterior. O degrau apaga o que veio da outra linha; o endereçamento segura o que nascer sem carimbo depois. Guardas: `frontend/tests/integration/degrau-3.0-entradas-da-transicao.test.js` (23 casos, novo: as quatro entradas bootadas DUAS vezes pela sequência real, o banco misturado, o nome nas duas casas, a entrada 1.7 com os 805 ids e os 146 blobs alcançáveis, a fila e a linha do boot), `frontend/tests/store/pisos-de-migracao.test.js` (5, novo), `frontend/tests/store/teto-do-portao-de-versao.test.js` (6, novo) e `frontend/tests/store/store-schema-migration-v3.0.test.js` (24, renomeado de `-v2.3`). Seis réguas foram vistas REPROVANDO contra o código anterior antes do conserto, com os números: carimbo parado em 2.4, nenhuma migração pedida nos dois boots, nome virando "Meu Atlas", entrada 1.7 com 0 de 805 ids sobreviventes e 146 blobs alcançáveis virando 0, fila intacta e portão recusando 2.4. Um caso vizinho (`boot-escopo-de-atlas.test.js`) estourou o limite de 5 s do vitest uma vez em dez execuções da pasta por causa do custo de abrir a fixture de 1,2 MB vinte vezes; o arquivo novo passou a guardar o arquivo já aberto, e depois disso foram 6 de 6.
- **Status:** aceita.

### 2026-09-07: o marcador REMOTE órfão não expurga bancos sem sufixo que um slot local já reivindica

- **Contexto:** medido em navegador real em 2026-09-07, sobre um acervo 2.4 da outra linha do produto já transicionado. Com `{kind:'remote', atlasId:X}` gravado no banco global e X fora de todo registro, `enforceLocalStoreWhenLoggedOut` (`frontend/src/js/store/store.js`) chamava `unmountCurrentAtlas`, porque `purgeReachedAtlas` responde false para um atlas que registro nenhum conhece. Nesse ponto do boot nada está montado, então o escopo que a ponte do repositório resolve é o LEGADO: **639 de 647 registros apagados, 805 feições viram 0, 14 mapas viram 1 vazio, zero linha de console e nada na tela**. Ao final o marcador volta sozinho para LOCAL, então nem o rastro fica. O estado de disco é o que um logout interrompido deixa (a aba morre entre a varredura e o `markStoreLocal`, uma linha depois), e é também o que um marcador gravado por engano deixa. A auditoria anterior tinha registrado o caso como risco residual assumido; a medida mostrou que ele é a maior perda de toda a bancada.
- **Decisão:** o segundo expurgo ganha uma segunda condição de parada, e ela pergunta pelos BANCOS que o expurgo vai esvaziar em vez de perguntar pelo atlas que o marcador nomeia: ele NÃO roda quando o sufixo vazio está reivindicado por uma entrada LOCAL do registro global (`readLocalAtlasRegistry` com `dbSuffix` vazio). Nesse caso o marcador é normalizado para LOCAL pelo `markStoreLocal` que já estava ali, e o boot escreve UMA linha de `console.info` dizendo que um marcador REMOTE órfão foi ignorado, e nomeando o slot dono dos bancos. O predicado é estreito de propósito, e é verdadeiro por CONSTRUÇÃO, conferido na fonte: uma entrada de `dbSuffix` vazio só nasce de `bootstrapEntry` (`frontend/src/js/store/local-atlas.api.js`), cujo `adoptLegacy` é `isRemoteOrigin` negado, ou do degrau 3.0 (`frontend/src/js/store/migration/v2.x-to-v3.0.migration.js`), que passa `adoptLegacyDatabases` DEPOIS de `discardRemoteResidue`; `createLocalAtlas` usa o id do slot como sufixo e `adoptRemoteAtlasAsLocal` usa o do namespace remoto, então nenhum dos dois a produz; e `markStoreRemote` (`frontend/src/js/store/store-origin.js`) recusa declarar REMOTE sem que a aba tenha MONTADO o namespace daquele atlas, o que fecha o único caminho que escreveria o marcador com os bancos sem sufixo montados. Logo o sufixo vazio reivindicado é dado local, e resíduo de servidor só pode viver em namespace com sufixo, que a varredura de `discardRemoteAtlasNamespaces` já tratou.
- **Alternativas recusadas:**
  - *Resolver na leitura do marcador, em `reconcileWithRegistry` (`frontend/src/js/store/store-origin.js`).* É onde o instinto manda, e o comentário de lá já registra que a variante "existe algum registro local" foi TENTADA e derrubou 2 casos da fixture 2.2: naquele caminho o marcador é lido DUAS vezes por boot (no boot e dentro da migração), o bootstrap acontece entre as duas leituras, e a mesma instalação responde diferente nas duas. No guarda a pergunta é feita UMA vez.
  - *Perguntar depois de `activateBootAtlasScope`, onde o registro já está carregado.* Recusada por MEDIDA, e o controle ficou na suíte: com a ordem invertida, a instalação pré-namespace passa a responder "reivindicado" também, porque `initLocalAtlases` acabou de escrever a entrada que a pergunta procura, e o expurgo que existe justamente para ela nunca mais roda (805 feições de servidor sobrevivendo onde deviam ser destruídas).
  - *Perguntar "existe algum atlas local" em vez de "quem reivindica o sufixo vazio".* Um slot COM sufixo não diz nada sobre os bancos que o expurgo vai esvaziar, e a pergunta larga aprovaria uma instalação pré-namespace que já tivesse um segundo slot criado.
  - *Perguntar "existe dado local nos bancos sem sufixo".* É a variante por CONTEÚDO, e ela reprova pelo motivo de sempre nesta branch: um atlas de servidor recém-aberto também tem conteúdo, e um slot local vazio não tem.
  - *Avisar o usuário em vez de mudar o comportamento.* Aviso depois de 639 registros apagados não é aviso, é obituário. A linha de console entra para o suporte, nunca no lugar da guarda.
- **Consequências:** o boot deslogado passa a ler o registro local uma vez a mais (uma varredura de chaves do banco global, antes de qualquer escopo estar ativo). Um registro global ILEGÍVEL continua levando ao expurgo, de propósito: deixar um erro de leitura poupar os bancos sem sufixo faria de um banco global corrompido o caminho pelo qual resíduo de servidor sobrevive a um logout. O caso pré-namespace, que é o que mais importa, continua sendo expurgado inteiro. Guardas: `frontend/tests/integration/marcador-remote-orfao-no-boot-deslogado.test.js` (11 casos, novo; 3 vermelhos contra o código anterior, a saber PERDIDOS igual a 0 lido cru por nome absoluto de banco sobre a fixture de produção de 14 mapas e 805 feições, a linha de console, e o marcador REMOTE sem `atlasId`), mais um caso novo em `frontend/tests/store/store-origin.test.js` que prende a divisão de trabalho (o slot de sufixo vazio NÃO derruba o marcador na leitura, porque essa decisão é do boot). Dois controles negativos foram medidos depois do conserto, um de cada vez: com o predicado respondendo "reivindicado" sempre, o controle pré-namespace reprova; com a pergunta feita depois de `activateBootAtlasScope`, ele reprova com 805 feições sobrevivendo onde deviam ser 0.
- **Status:** aceita.

### 2026-09-07: o tipo da imagem vem da EXTENSÃO no `.ebgeo`, e o alvo do slide 3D/360 é ID DE RECURSO, nunca UUID

- **Contexto:** medidos no navegador em 2026-09-07, os dois no gesto da virada (exportar da linha
  anterior, abrir o `.ebgeo` na integracao, enviar ao servidor). O blob restaurado por
  `zip.file(nome).async('blob')` nasce com `type` vazio, e 130 de 131 blobs do slot importado
  estavam assim no dump. Daí saíam duas perdas independentes: na subida, `blob.type ||
  'image/png'` declarava PNG sobre bytes JPEG e `images.service.js` recusava por "Content does
  not match declared type" (4 de 4 JPEG do fixture perdidos, X vermelho no lugar da foto); na
  reexportação, `getBlobExtension` caía no `default` e a foto saía com nome `.png` e bytes JPEG,
  perdendo o tipo de vez a cada round-trip. No mesmo envio, `local-atlas-to-server.js` gravava
  `model_id`/`photo_id` só quando o valor era UUID, e o produto identifica tileset por slug
  (`museu-1cgeo`) e foto 360 por nome de arquivo (`FOTO_0001.jpg`): 1 slide `3d` e 1 slide `360`
  chegavam ao servidor com o alvo NULO, inclusive com o catálogo cadastrado.
- **Decisão:** (a) `loadImagesFromZip` monta o blob a partir do `arraybuffer` com o MIME da
  EXTENSÃO do nome no zip, por uma tabela de módulo que é a INVERSA declarada de
  `getBlobExtension` (as duas metades do round-trip passam a ser uma coisa só, e mudar uma sem a
  outra é como este defeito nasceu); (b) `buildImageUploads` fareja a ASSINATURA dos bytes (PNG
  `89 50 4E 47`, JPEG `FF D8 FF`, WebP `RIFF....WEBP`, SVG por texto) quando o blob não traz
  tipo, e nomeia o arquivo pelo tipo decidido, com o `blob.type` declarado continuando a vencer;
  (c) o alvo do slide passa a ser STRING com o teto da coluna, no cliente
  (`slideResourceRef`, até 100 caracteres, nulo acima disso) e no Joi de import
  (`Joi.string().max(100)`). A coluna NÃO muda: ela é `VARCHAR(100)` desde `003_atlas.sql`, e o
  podador (`atlas-resource-prune.js`) sempre leu os dois campos com `String(...)`. O Joi era o
  único portão do servidor que recusava a forma real.
- **Alternativas recusadas:**
  - *Farejar os bytes e não tocar no leitor do zip.* Consertaria a subida e deixaria o
    round-trip do arquivo quebrado, que é a outra metade do mesmo defeito: o `.ebgeo` continuaria
    saindo com JPEG chamado `.png`. E deixaria o tipo vazio no disco, onde qualquer consumidor
    futuro do blob o encontra.
  - *Derivar a extensão do nome só na exportação.* Não alcança o blob que já está no disco sem
    tipo, e é justamente o que o produto tem depois de um import.
  - *Aceitar `image/png` como declaração e deixar o servidor sondar.* O servidor JÁ sonda, e é
    ele que recusa. A declaração mentirosa é o que produz a recusa.
  - *Trocar a coluna do slide por `uuid` e recusar o slug.* Inverteria o sujeito: o slug é o
    nome do recurso no produto, e o UUID é que seria a exceção. Além disso quebraria todo atlas
    de servidor já gravado.
  - *Truncar o alvo maior que 100 caracteres em vez de anular.* Um truncamento aponta para OUTRO
    recurso, ou para nenhum, e as duas coisas são piores do que o campo vazio que o podador já
    sabe rebaixar.
- **Consequências:** o `.ebgeo` volta a ser round-trip fiel para JPEG e WebP, e o envio ao
  servidor deixa de perder foto. Um efeito de segunda ordem, medido: com nada mais caindo em
  `skipped`/`failed`, o ramo de sucesso do envio VOLTA A NAVEGAR para o atlas de servidor, que
  é o desfecho para o qual ele foi desenhado e que o fixture com JPEG nunca alcançava. O
  farejador é um custo de leitura de 32 bytes por blob sem tipo, e não roda para blob que já tem
  MIME (a foto colada no navegador, o caminho comum). Guardas:
  `frontend/tests/unit/mime-da-imagem-do-ebgeo.test.js` (8 casos, 5 vermelhos antes),
  `frontend/tests/unit/alvo-do-slide-3d-e-360.test.js` (5 casos, 2 vermelhos antes) e
  `backend/tests/unit/alvo-do-slide-aceita-slug.test.js` (6 casos, 3 vermelhos antes, com o par
  100/101 caracteres separando "tem teto" de "não tem"). Medido de ponta a ponta no navegador
  com o `03-completo-2.4.ebgeo`: imagens no servidor 10 -> 14, slides com modelo 3D 0 -> 1,
  slides com foto 360 0 -> 1, e no slot local 149 blobs com tipo contra 130 sem.
- **Status:** aceita.

### 2026-09-07: o BALDE decide o tipo da feição no envio, e um lote de imagens que cai não leva os seguintes

- **Contexto:** dois achados do mesmo envio, medidos em 2026-09-07. `buildFeatures`
  (`local-atlas-to-server.js`) derivava o tipo do servidor de `props.source ||
  BUCKET_TO_SOURCE[bucket]`, e o resultado de uma análise mora nos baldes `processed_los`/
  `processed_visibility` carregando `properties.source = 'los'`/`'visibility'`: um atlas com
  `los 3, processed_los 6, visibility 3, processed_visibility 6` chegava ao servidor como
  `los 9, visibility 9` com os dois baldes processados vazios, e voltava assim para o navegador.
  Doze feições de 805 trocavam RESULTADO de visada por DEFINIÇÃO de visada. Em separado,
  `uploadImagesInChunks` (`atlas-image-upload.js`) mandava os lotes de 50 sem `try/catch`, então
  a queda de rede no lote k propagava e abortava o laço, deixando os lotes anteriores gravados no
  servidor, os seguintes nunca tentados, e a tela com o texto cru do `fetch`.
- **Decisão:** (a) o BALDE decide quando ele é conhecido (`BUCKET_TO_SOURCE[bucket] ||
  props.source`), porque o balde é onde a store guarda a feição e `feature-type.registry.js` é
  explícito em dizer que os dois pares de análise são quatro linhas distintas, entrada do
  operador contra saída do algoritmo. Balde DESCONHECIDO continua caindo no `source`, o que
  preserva exatamente o descarte do `coordenadas` (leitura efêmera de azimute, que não tem tipo
  de servidor). Nada mudou no servidor: `processed_los` e `processed_visibility` são aceitos
  pelo CHECK `valid_feature_type`, pelo `VALID_FEATURE_TYPES` do Joi e pelo `typeToCollection`
  do snapshot, conferidos na fonte antes da edição. (b) `uploadImagesInChunks` captura POR LOTE,
  registra cada imagem do lote caído em `failed` na mesma forma que o servidor produz
  (`{localId, error}`), segue para o próximo lote, e devolve `transportErrors` com a contagem de
  lotes sem resposta, que é o que separa "o servidor recusou estas imagens" de "a rede caiu".
- **Alternativas recusadas:**
  - *Preservar o balde só para os dois pares de análise, por nome.* Trataria o sintoma e deixaria
    a precedência errada de pé para o próximo par que nascer com `source` diferente do balde.
  - *Fazer o balde decidir SEMPRE, inclusive para balde desconhecido.* Mudaria em silêncio o que
    o `coordenadas` faz hoje, que é cair no `source` e ser descartado por ele. O caso está preso
    em teste justamente para que a inversão não o arrastasse junto.
  - *Reescrever `properties.source` do resultado para `processed_los`.* Muda dado do usuário para
    consertar um transporte, e quebraria o desenho no cliente, que lê o `source`.
  - *Deixar o lote cair e refazer o envio inteiro.* O import já respondeu 201 e o atlas existe no
    servidor; refazer produz um segundo atlas completo (é o B3-7), que é pior do que um atlas com
    a lista das imagens que faltaram.
- **Consequências:** o resultado de análise volta a chegar e a voltar no balde dele, e um envio
  com rede instável passa a entregar tudo o que a rede permitiu, com a lista do que ficou. O
  campo `transportErrors` é aditivo: os quatro chamadores desestruturam só `failed` e não
  quebram. Guardas: `frontend/tests/unit/balde-de-analise-processada-no-envio.test.js` (5 casos,
  3 vermelhos antes) e `frontend/tests/unit/subida-de-imagens-por-lotes-resiliente.test.js` (4
  casos, 4 vermelhos antes, com o segundo de três lotes caindo). O
  `tipos-feicao-paridade-pacotes.test.js` foi REESCRITO com a razão, e não apagado: os dois casos
  comportamentais dele fixavam a precedência antiga empilhando os vinte e um tipos no balde
  `points`, e passam a montar o arranjo verdadeiro lendo o `BUCKET_TO_SOURCE` do texto do
  cliente, o que faz da tabela de baldes uma QUINTA cópia vigiada, com FLOOR e controle positivo
  próprios. Medido no navegador: `3/6/3/6` no servidor, contra `9/9/0/0` antes. O lote partido no
  meio (mais de 50 imagens) continua provado só em unidade, porque o fixture cabe num lote só.
- **Status:** aceita.

### 2026-09-07: o boot não apaga acervo sob erro, a adoção concorrente desempata pelo menor id, e o registro ganha espelho e persistência

- **Contexto:** a revisão adversarial do boot e da migração (B4) mediu nove achados sobre o HEAD `c1a3b3e4`, com 13 réguas vermelhas em vitest. Os dois caros são de PERDA. (1) `checkAndCleanLegacyData` (`frontend/src/js/store/repository.js`) respondia a um erro de LEITURA de `schemaVersion` chamando `clearLegacyStores()`, que esvazia cinco bancos e carimba a versão corrente: medido sobre um acervo de 14 mapas e 149 imagens com a primeira leitura rejeitando `InvalidStateError`, restava `{maps: 0, images: 0, layers: 0, groups: 0}`, e o `ebgeo_atlas`, que não está na lista dos cinco, sobrevivia descrevendo 14 mapas que já não existiam, o que faz o boot seguinte parecer normal. O mesmo predicado tratava carimbo AUSENTE como prova de idade. E a limpeza parcial (um `clear()` que rejeita) fazia `runLegacyMigrations(null)` gravar `SCHEMA_VERSION`, o literal LEGADO '1.7', ou seja, o próprio boot fabricava a "entrada 1.7" que a decisão do esquema 3.0 nomeia como a mais cara da outra linha. (2) `bootstrapEntry` (`frontend/src/js/store/local-atlas.api.js`) cria a entrada de `dbSuffix` vazio quando o registro global está vazio, e entre o `keys()` que responde "vazio" e o `setItem` que reivindica não há arbitragem nenhuma; DUAS páginas chegam ali, o mapa (`store.js`) e `atlas.html` (`projects-page.js`), o que no dia da implantação é o cenário ordinário de quem recarrega as duas abas. Encenado de forma determinística: dois slots com `dbSuffix: ''`, e como `deleteLocalAtlas` só recusa o ÚLTIMO slot, excluir qualquer um dos dois derrubava os bancos sem sufixo, com os 14 mapas indo embora e o cartão sobrevivente apontando para bancos destruídos. Vinham junto: o descarte da fila legada desarmado para quem abre "Seus atlas" antes do mapa (446 operações medidas ficando no disco), o espelho em memória escrito antes do disco, a varredura de `discardRemoteResidue` abortando na primeira falha, o `continue` que sumia com um slot de valor ilegível, e o `catch` de `initializeRepository` devolvendo um mapa que o acervo não tem. Duas propostas sem teste fecharam o conjunto: nenhuma das duas linhas do produto pedia armazenamento persistente (`grep` por `navigator.storage`, `persist(`, `persisted()` e `estimate()` devolvia zero nas duas), e perder só o `ebgeo_global` deixava 251 registros de um segundo atlas local inalcançáveis por expurgo e por tela.
- **Decisão:** (1) UM ERRO DE LEITURA NÃO É VEREDITO SOBRE O DADO: a leitura que falha devolve "não sei", a limpeza por carimbo ausente ou antigo só corre sobre escopo SEM dado (`medirEscopo`, uma passada de `keys()` nos quatro bancos que a limpeza esvaziaria, e uma leitura que falha responde "tem dado"), e a cadeia legada só roda sobre um carimbo confiável, o que tira do caminho a escrita do '1.7'. O escopo com carimbo abaixo de `MIN_SCHEMA_VERSION` e COM dado é PRESERVADO, com um `console.error` que nomeia o carimbo, o número de chaves e o fato de nada ter sido apagado: a população dele é anterior a 2026 e quase nula, e não destruir vem antes de migrar. O `catch` do boot escolhe um mapa que EXISTE (o `lastActiveMap` se estiver entre as chaves, senão a primeira) e só cai no mapa padrão quando não há mapa nenhum. (2) A adoção concorrente resolve-se por ORDEM TOTAL e não por recuo: entre entradas com o mesmo `dbSuffix` vence a de menor `id`, comparado como string; quem tem o maior recua e adota a vencedora, e a vencedora poda a duplicada. Podar não destrói dado porque as duas chaves nomeiam o mesmo `dbSuffix`, isto é, os mesmos dez bancos. (3) `deleteLocalAtlas` relê o registro DO DISCO antes de destruir e, achando outro dono do mesmo `dbSuffix`, remove só a entrada e devolve `keptDatabases: 'db_suffix_compartilhado'`; a releitura vem antes do aviso de teardown, que serve para mandar a aba irmã parar de escrever. (4) A entrada do registro ganha `adoptedLegacy`, e o degrau 3.0 trata "reivindicado por um bootstrap que adotou, sobre bancos que este degrau ainda não carimbou" como devendo o descarte da fila; `discardRemoteResidue` passa a `Promise.allSettled`. (5) O registro ganha um ESPELHO em `localStorage` (`ebgeo_local_atlas_mirror`, com id, nome, sufixo e datas), escrito pelos dois escritores do registro, sempre depois do disco e sempre em `try/catch`; no boot, com o registro VAZIO, as entradas de sufixo NÃO vazio voltam ao registro antes de qualquer bootstrap, com uma linha de console. (6) O boot pede `navigator.storage.persist()` por um módulo folha novo (`frontend/src/js/store/storage-persistence.js`, zero imports), depois de `persisted()` e em `try/catch`, chamado em `index.js` depois do `GET /api/config` e antes do store, com o desfecho ('sim', 'nao' ou 'indisponivel') na linha de boot do atlas.
- **Alternativas recusadas:**
  - *Cada página RECUAR ao ver uma rival, que foi a primeira forma do conserto.* É simétrica, e a simetria é o defeito: duas páginas que se leem recuam juntas e a instalação fica sem dono dos bancos que acabou de reivindicar. Medido contra a régua: com o recuo simétrico o sobrevivente é o de MAIOR id nas duas ordens de leitura, e qual deles sobrevive depende de quem leu por último.
  - *Arbitrar a corrida com `navigator.locks`.* Em contexto não seguro (HTTP puro) a API não existe, e é justamente a implantação que esta transição atravessa (`atlas-namespace.js`, Decisão 5). Uma arbitragem que some no ambiente de destino não é arbitragem.
  - *Decidir o descarte da fila pelo CARIMBO do escopo legado (abaixo de 3.0 veio da outra linha).* É uma linha e não precisa de marca nova, mas descartaria também a fila de uma instalação DESTA linha em 2.3, onde `addressForUnstamped` acabou de decidir PARAR operação sem carimbo naquele endereço de propósito. Trocar uma guarda pela outra não é conserto, e o teste que prende isso é o da entrada sem a marca.
  - *Apagar o escopo velho demais para migrar quando ele tem dado, com aviso.* Aviso depois do apagamento é obituário, e a migração que ele destravaria serve uma população anterior a 2026 e quase nula. O escopo fica, o boot relata, e o usuário guarda a saída de exportar.
  - *Restaurar do espelho também a entrada de `dbSuffix` vazio.* O endereço dela é o que todo boot já sabe reivindicar, o nome de verdade dela está no registro de atlas em disco, e restaurá-la poderia reimportar uma reivindicação sobre bancos que uma exclusão já derrubou. Ela segue a regra normal do bootstrap, que passou a correr também quando o espelho diz que ela existia e a restauração não lhe deu dono.
  - *Reconciliar espelho e registro sempre, e não só com o registro vazio.* Seria uma segunda fonte de verdade para uma pergunta que o registro responde, e a primeira entrada velha ressuscitaria um atlas excluído. Tem caso de controle.
  - *Derivar reparo de `indexedDB.databases()` já nesta virada.* Fica para depois: o espelho cobre a perda do banco global, que é o caso medido, e a sonda exige as três portas que o B4 descreveu (só onde a API existe, só por gesto do usuário, só para PROPOR).
- **Consequências:** o boot ganha uma passada de `keys()` em quatro bancos no caminho em que o carimbo está ausente ou velho, e uma releitura do registro global no boot em que o slot nasce e em cada exclusão de atlas. `localStorage` passa a carregar uma cópia do registro de slots, que "limpar dados do site" apaga junto com o IndexedDB: o espelho cobre a perda do banco global, não a limpeza deliberada. A entrada do registro ganha o campo `adoptedLegacy`, e entradas escritas por builds anteriores não o têm, que é o que mantém a guarda da fila estreita. O pedido de persistência é feito uma vez por boot do mapa e nunca rejeita; `atlas.html` não o faz, então a linha de boot dela não traz o campo, o que é diferente de trazer "recusado". Os cinco sítios que escreviam chave de registro foram afunilados nos dois escritores (`persistRegistryEntry` e `removeRegistryEntry`), escrevendo o mesmo byte na mesma chave, para que o espelho não perdesse caminho. Guardas: `frontend/tests/store/boot-nao-apaga-sob-erro-de-leitura.test.js` (11 casos), `frontend/tests/store/adocao-concorrente-dos-bancos-sem-sufixo.test.js` (15), `frontend/tests/store/falha-de-migracao-no-boot.test.js` (5), `frontend/tests/store/espelho-do-registro-em-localstorage.test.js` (7, novo) e `frontend/tests/store/pedido-de-persistencia-no-boot.test.js` (8, novo); contra o HEAD intacto os cinco dão 24 vermelhos e 22 verdes de 46, e com o conserto 46 de 46. O C1 e o C2 foram vistos reprovando também o conserto ANTERIOR, com número (o sobrevivente `...002` onde se espera `...001`, e os 14 mapas em zero). O que NÃO se prova aqui: a corrida em navegador de verdade, porque o dublê é de um processo só (sem `blocked` real entre abas, sem aba congelada, sem bfcache), e o despejo por pressão de disco, que não se mede em vitest.
- **Status:** aceita.

### 2026-09-07: a Linha de Barreiras da 2.2 é ADOTADA pela Linha de Coordenação na leitura, e o balde velho é apagado

- **Contexto:** a outra linha do produto teve, na 2.2, a ferramenta Linha de Barreiras, que gravava no balde `barrier_lines` com `source: 'barrier_line'` (`layer.constants.js:100` e `features_tab.constants.js:56` daquela versão). A 2.3 dela a generalizou na Linha de Coordenação, um combobox sobre os dez símbolos lineares do MD33, e a linha de barreiras é o `290199` daquele catálogo, que é também o símbolo PADRÃO da ferramenta nova. A migração 2.2 para 2.3 de lá só ACRESCENTOU o balde novo vazio: não moveu nada. Resultado medido em 2026-09-07 com insumo forjado de cinco linhas sobre um `.ebgeo` 2.2 real: `grep barrier_lines` devolve **0 ocorrência** no código da `main` 2.3, da `main` 2.4 e desta linha; das 60 fontes geojson que o MapLibre monta, nenhuma tem esse nome; e as cinco feições atravessam o import, o store e a exportação 3.0 sem serem desenhadas, listadas, selecionadas nem contadas. Não é perda de bytes, é perda de alcance, e a população é quem desenhou Linha de Barreiras entre 2026-06-15 e 2026-09-03. **Não é defeito da integracao:** a `main` carrega o mesmo buraco desde 2026-09-03.
- **Decisão:** `ensureCoordinationLines` (`frontend/src/js/store/repository.utils.js`) passa a ADOTAR o balde velho em vez de conviver com ele: move cada feição para `coordination_lines`, carimba `source: 'coordination_line'` e `symbol_code: '290199'`, e APAGA a chave `barrier_lines`. Apagar a chave é o que mantém a passada idempotente, porque a segunda run não acha mais o balde velho e devolve `null`, que é o contrato que impede o chamador de reescrever um documento que ele só leu. Linha de coordenação já existente não é tocada nem reordenada; as adotadas entram depois dela. A tradução de propriedades foi MEDIDA nas duas fontes, não suposta: comparados `add_barrier_line_control.js:58-81` do commit `24b07975` da `main` e `add_coordination_line_control.js:110-135` desta linha, as duas tabelas diferem por UMA propriedade, `symbol_code`, e o contrato de zoom é o mesmo nos dois modelos, então `symbol_size`, `symbol_spacing`, `createdAtZoom` e `zoomCorrectionEnabled` atravessam intactos; o que faltar ganha o padrão da ferramenta nova, e o que é do usuário (nome, descrição, cor, camada, id) não se reescreve. A adoção recupera `baseCoordinates` da geometria da própria feição quando ela é um `LineString`, e só nesse caso. O mesmo conserto foi feito na `main`, na função gêmea de `v2.2-to-v2.3.migration.js`. Os literais do catálogo entram por CÓPIA, com guarda de paridade, porque `repository.utils.js` é ansioso na página do mapa e `teto-de-peso-da-pagina-do-mapa.test.js` orça `military_tools` em zero módulo ansioso.
- **Alternativas recusadas:**
  - *Deixar como está e medir a população pelo suporte.* Recusada porque o custo de descobrir é maior que o do conserto: a feição não aparece em lugar nenhum da tela, então o usuário não tem como relatar o que ele nunca viu sumir.
  - *Só renomear o balde, sem traduzir propriedade nenhuma.* Foi a primeira versão, e ela REPROVOU no navegador: `applyZoomCorrections` regenera a geometria de toda linha de coordenação na carga, e `generateCoordinationLineGeometry` sem `baseCoordinates` devolve `{ LineString, [[0,0],[0,0]] }`. A adoção ingênua tira a feição do lugar dela e a manda para a Ilha Nula, o que é pior que o defeito que ela conserta.
  - *Derivar `baseCoordinates` de qualquer geometria.* De um `MultiLineString` (a espinha interrompida mais um anel por losango) a espinha autorada não se recupera, e o que sairia seria um zigue-zague pelos vértices dos losangos. Melhor deixar a feição degradar como qualquer linha de coordenação sem espinha do que desenhar uma linha que ninguém autorou.
  - *Registrar `barrier_line` em `feature-type.registry.js`.* Uma linha ali cria um tipo VIVO, com rótulo, ícone, seleção e cópia, para uma ferramenta que não existe mais. O tipo a manter é um só.
  - *Um degrau de esquema para isto.* A decisão de 2026-09-03 vale igual aqui: uma forma que a leitura normaliza sozinha não merece uma versão, e o degrau 3.0 continua não transformando feição nenhuma.
  - *Importar `DEFAULT_SYMBOL_CODE` do catálogo em vez de copiar.* Deixaria `teto-de-peso-da-pagina-do-mapa.test.js` vermelho, porque o orçamento de `military_tools` no grafo ansioso da página do mapa é zero. A cópia é o preço, e a guarda de paridade é o troco.
- **Consequências:** um `.ebgeo` 2.2 aberto aqui deixa de esconder as linhas de barreiras dele: elas desenham o losango do 290199 e aparecem na aba como "Linha de Coordenação", com o nome que o usuário deu. O que este conserto NÃO alcança, e vale dito em voz alta: o payload que sobe ao servidor não passa por esta normalização. `frontend/src/js/import_export/local-atlas-to-server.js` lê os baldes crus e conta como `droppedFeatures` tudo que não está em `VALID_FEATURE_TYPES`, e os dois chamadores que o alimentam com dado não normalizado são `frontend/src/js/projects/import-ebgeo.service.js:66` (o `.ebgeo` direto para o servidor, sem `normalizeMapDataForCurrentVersion`) e `buildLocalAtlasExportData` em `frontend/src/js/projects/send-local-to-server.service.js`, que lê o localforage sem passar pelo repositório. Guardas: `frontend/tests/unit/coordination-line-balde.test.js` (14 casos novos; contra o código anterior o arquivo dá 16 vermelhos de 32, e 32 de 32 com o conserto) e `frontend/tests/e2e-ui/linha-de-barreiras-da-2.2-desenha.spec.js` (novo, em Chromium de verdade: cinco feições na fonte, todas MultiLineString com mais de duas partes, zero coordenada em `[0,0]`, `queryRenderedFeatures` maior ou igual a cinco, e cinco itens na aba com o rótulo certo). A spec registra também um fato do app que só o navegador dá: sem a ferramenta carregada, `setupCoordinationLineLayers` monta a camada com a geometria GUARDADA verbatim, porque `getControl` não responde antes do `await import()`.
- **Status:** aceita.

### 2026-09-07: o nome do mapa de um atlas local vem da CHAVE, e dois mapas no mesmo nome recusam o envio

- **Contexto:** medido em navegador real em 2026-09-07, sobre o slot de sufixo VAZIO adotado de uma instalação 2.4 da outra linha do produto, que é o acervo de quem atravessa e o gesto exato da virada. Do cartão local com 14 mapas, 805 feições e 149 imagens subiram ao servidor **2 mapas e 33 feições**, com toast VERDE de sucesso: 85,7% dos mapas e 95,9% das feições perdidos sem uma palavra. A causa não está no envio. `createMapCompat` da outra linha grava todo mapa novo com a CHAVE certa e `data.name = "Novo Mapa"`, porque a guarda dela (`if (!newMapData.name)`) nunca dispara sobre um `getEmptyMapData()` que já devolve esse nome; no dump do slot, 13 dos 14 registros de `ebgeo_maps` carregam o literal, com a chave correta ao lado. O campo era cosmético e inerte enquanto ninguém o lia, e `buildLocalAtlasExportData` (`frontend/src/js/projects/send-local-to-server.service.js`) foi o PRIMEIRO consumidor a preferi-lo à chave: os treze colidiam numa entrada só de `data.maps`, vencia o último iterado por ordem de chave, e 23 mais 10 dá exatamente os 33 que o servidor recebeu. Nenhuma migração repara o registro que já está no disco, e o slot criado por "Abrir arquivo .ebgeo" não é alcançado, porque o importador grava chave UUID com o nome certo.
- **Decisão:** num atlas local a CHAVE de `ebgeo_maps` é o nome, e ela vence o campo sempre que não for um identificador GERADO. O teste é `isValidId` (`frontend/src/js/utilities/uuid.js`), que é a definição desta casa para as duas formas que circulam, o UUID v4 e o id legado `<epoch>-<aleatório>`; chave que passa nesse teste continua cedendo a `data.name`, como antes, porque ali ela é mesmo um identificador e o nome só existe no campo. A metade que a regra não alcança, dois registros UUID-keyed cujo `data.name` coincide, RECUSA o envio antes de qualquer pedido de rede, com erro nomeado (`code: 'NOME_DE_MAPA_REPETIDO'`, `stage: 'leitura'`) cuja mensagem lista cada nome repetido e TODAS as chaves de cada um. A checagem roda ANTES de a primeira seção ser escrita, porque um caminho de erro que passa por um documento já mutilado é o defeito que se está fechando. A ordem dos mapas passa a deduplicar preservando a ordem, e o mapa corrente atravessa a MESMA tabela de tradução de chave para nome.
- **Alternativas recusadas:**
  - *Desambiguar no envio, renomeando o segundo para "Alfa (2)".* Inventa, dentro de um envio, um nome que não existe no acervo e que a pessoa não reconhece de volta no atlas do servidor. A recusa devolve a decisão a quem sabe qual dos dois mapas é qual.
  - *Uma migração que reescreva `data.name` a partir da chave nos registros herdados.* Mexe no disco do usuário para consertar um campo que só este caminho lê, e teria de decidir sozinha o que fazer com o registro em que os dois já concordam. O leitor resolve sem escrever nada, e o módulo inteiro é `getItem` e `iterate`.
  - *Continuar preferindo o campo e apenas AVISAR que houve colisão.* A perda continuaria acontecendo, com uma frase ao lado. O aviso entrou de qualquer forma, por outra decisão, e ele é a segunda linha de defesa, não a primeira.
  - *Deixar a chave vencer SEMPRE, sem o teste de identificador.* Passaria em toda a bateria do acervo herdado e entregaria ao servidor um atlas cujos mapas se chamam `aaaaaaaa-0000-4000-8000-000000000001`, que é o caso do atlas sincronizado. O controle que reprova essa variante está na suíte.
  - *Tratar como identificador só o UUID v4, e não o id legado.* Poria um carimbo de tempo (`1706123456789-abc45xy90`) na aba de mapas do servidor. Com `isValidId` esse registro cede ao campo, e se o campo colidir a recusa pega.
- **Consequências:** um atlas local com dois mapas de mesmo nome deixa de poder ser enviado até a pessoa renomear um deles, e esse é o preço declarado da recusa. Nada é escrito no slot de origem em nenhum caminho. Guardas: `frontend/tests/unit/acervo-herdado-nome-do-mapa.test.js` (15 casos, novo, 10 vermelhos contra o código anterior, sobre um slot fabricado igual ao disco da população: 14 registros de chave certa com `data.name = "Novo Mapa"` em 13 e feições somando 805), com três controles que impedem o conserto de virar "a chave sempre vence" (mapa UUID-keyed, id legado, e chave não identificadora sobre valor sem nome), e `frontend/tests/e2e-ui/envio-do-acervo-herdado.spec.js` (3 casos, novo). As réguas foram vistas reprovando com os números do achado: `expected 33 to be 805` e `expected [ 'Novo Mapa', 'Principal' ] to have a length of 14`. O controle negativo no navegador foi feito em três passos, e o segundo reproduziu o defeito byte a byte: com as duas metades desligadas, o toast volta a ser `"Acervo Herdado H1" foi enviado ao servidor (2 mapas, 33 feições, 2 camadas).`, em VERDE. Com só a regra da chave desligada, a recusa por nome repetido dispara e o envio não acontece, o que mostra que as duas metades estão acopladas de propósito.
- **Status:** aceita.

### 2026-09-07: a frase do envio conta o atlas inteiro, e só o envio sem perda navega

- **Contexto:** a frase de "Enviar ao servidor" dizia mapas, feições e imagens perdidas, e mais nada. As 21 camadas, os 3 grupos, os 2 briefings, os 7 slides, os 10 itens 3D e os 6 itens 360 do atlas medido não apareciam em número nenhum, nem quando o servidor descartava todos eles: com o catálogo do backend no estado de fábrica (0 tilesets, 0 projetos 360), 16 de 16 itens 3D e 360 foram podados no import e a frase saiu IDÊNTICA à do caso em que eles entraram. O servidor sempre relatou a poda (`summary.prunedResourceRefs`, contagem por superfície, em `backend/src/modules/atlas/atlas.service.js`) e o cliente guardava só `atlas.id`, jogando a resposta inteira fora. E o ramo de SUCESSO navega para o atlas novo, de modo que o toast morre com o documento que o desenhou: amostrando a lista a cada 20 ms, 400 vezes, a frase nunca foi lida no DOM. Era ela, e só ela, que dizia "2 mapa(s), 33 feição(ões)" contra os 14 e 805 do cartão local.
- **Decisão:** `sendLocalAtlasToServer` (`frontend/src/js/projects/send-local-to-server.service.js`) passa a devolver três coisas que descartava: as nove contagens do PAYLOAD (mapas, feições, camadas, grupos, briefings, slides, itens 3D, itens 360 e imagens citadas), o que o slot local tem, e o `summary` do servidor inteiro. `sendToServerNotice` (`frontend/src/js/projects/local-atlas-notices.js`) monta a frase com as nove contagens, dizendo mapas e feições SEMPRE e as outras sete só quando maiores que zero, que é a regra de `atlasContentsLines` pelo mesmo motivo (uma linha de zero ocupa o mesmo espaço de uma cheia e não ajuda a decidir nada). Sobre isso ela acumula QUATRO guardas de perda, cada um com os dois números: subiu menos do que o slot tem, o servidor gravou menos do que subiu (`summary.mapsImported` e `summary.featuresImported` contra o payload), o servidor descartou recurso 3D ou 360 fora do catálogo dele (com rótulo em português por superfície, e a chave crua quando a superfície for desconhecida), e imagem que não subiu. Qualquer um deles produz tom de AVISO e `openAtlasId` nulo, então a página fica na lista com a frase na tela; SUCESSO, que é o único ramo que navega, passa a significar que nada se perdeu. O denominador do primeiro guarda vem de `countAtlasContents` (`frontend/src/js/store/atlas-contents.js`), e não do documento de exportação.
- **Alternativas recusadas:**
  - *Contar o slot local pelo próprio documento de exportação, que já está em memória.* Foi a primeira versão, e o controle negativo a reprovou: com o leitor de nomes quebrado, o documento tinha 2 mapas e 33 feições, então numerador e denominador saíam do MESMO defeito, concordavam, e o toast saía VERDE anunciando "2 mapas, 33 feições" sobre um acervo de 14 e 805. Duas medidas que compartilham o erro não são duas medidas. O leitor independente custa uma passada em `ebgeo_maps` e as chaves de `ebgeo_images`, e é o que faz o guarda poder discordar.
  - *Deixar o ramo de sucesso navegar e persistir a frase na tela de destino.* Exige um segundo canal (uma chave no banco global lida pelo boot do mapa) para um caso em que, por construção, não há nada a dizer: se nada se perdeu, o atlas novo na tela diz o que a frase diria. O custo do aviso que fica é um clique a mais, e só no ramo em que a pessoa tem uma decisão a tomar.
  - *Cadastrar o catálogo 3D e 360 do servidor antes da virada e não mexer na frase.* As duas coisas não competem e a segunda não substitui a primeira: o catálogo cadastrado resolve a instalação de produção, e a frase resolve todo servidor cujo catálogo esteja incompleto, que é o estado normal de um servidor novo.
  - *Mostrar também `summary.remappedIds` na frase.* Recunhar um id que já estava ocupado é o servidor fazendo o CERTO, e não uma perda; anunciá-lo treinaria a pessoa a ignorar o aviso. O campo é guardado no resultado, à disposição de quem precisar dele.
  - *Um toast por perda.* Três toasts empilhados são três coisas para ler e uma para lembrar. Os avisos se somam numa frase só, na ordem em que mudam a decisão de quem lê.
- **Consequências:** o envio passa a ler o slot local uma vez a mais, por `countAtlasContents`, num escopo que ninguém montou. No fluxo mais comum da virada (atlas vindo de `.ebgeo` com foto JPEG) o ramo de aviso continua sendo o caminho padrão, então a pessoa abre o atlas de servidor com um clique a mais. Guardas: `frontend/tests/unit/frase-do-envio-conta-tudo.test.js` (23 casos, novo, 16 vistos vermelhos contra o código anterior, sendo 14 na primeira rodada e 2 no guarda da resposta do servidor), que mede a função PURA contra objetos escritos à mão e o SERVIÇO contra IndexedDB de verdade, porque um teste que só alimentasse a frase com um resultado fabricado provaria que ela sabe ler um objeto e nunca que alguém produz aquele objeto. O caso 2 de `frontend/tests/e2e-ui/envio-do-acervo-herdado.spec.js` forja a divergência na borda do navegador (o `summary` do import passa a dizer 13 mapas sobre os 14 que subiram) e lê na tela `O servidor gravou só 13 mapas dos 14 que subiram.`, com a página parada na lista, em captura lida. Um caso de `frontend/tests/unit/menu-do-cartao-local.test.js` teve a verdade antiga REESCRITA com a razão: a asserção casava com `7 feição(ões)`, a forma que dizia singular e plural de uma vez, e contar sete seções em vez de três tornou aquela forma insustentável.
- **Status:** aceita.

### 2026-09-07: a falha do envio nomeia a ETAPA, e o slot herdado se identifica no diálogo

- **Contexto:** dois pontos em que a tela calava ou falava errado no pior momento. (1) Medido em navegador real em 2026-09-07, abortando `**/images/bulk*`: `POST /atlas/import` respondeu **201** (atlas criado, 14 mapas, 805 feições, ZERO imagens), o pedido das imagens caiu com `net::ERR_FAILED`, e `sendLocalAtlasToServerFromPage` (`frontend/src/js/projects/projects-page.js`) mostrou um toast de erro com o texto literal do navegador, **"Failed to fetch"**. Nada em português, nada dizendo que o atlas JÁ ESTAVA no servidor, nada dizendo que ele estava sem imagem: a pessoa ficava com um atlas mudo e incompleto na lista e nenhuma frase que o explicasse. As duas falhas possíveis pedem decisões opostas, e tinham uma frase só. (2) Excluir o slot de sufixo VAZIO apagou 198 registros e os onze bancos sem sufixo, que são 14 mapas, 807 feições e 149 imagens. O diálogo já nomeava o atlas e contava a perda, o que o separa de um atlas de fábrica, mas nada no texto dizia que aquele cartão é o acervo herdado; o nome dele continua sendo "Meu Atlas", que é também o nome de fábrica, e a cópia chama-se "Meu Atlas (cópia)", de modo que a tela fica com dois cartões que começam pelas mesmas duas palavras.
- **Decisão:** o erro do envio passa a carregar a ETAPA em que caiu (`error.stage`, com `'leitura'`, `'import'` ou `'images'`) e o `atlasId` quando o atlas já existe no servidor, e o carimbo ANOTA o erro original em vez de embrulhá-lo, para não perder a pilha nem o `status` do `ApiError`, que é justamente o que alguém vai procurar. `sendFailureNotice` (`frontend/src/js/projects/local-atlas-notices.js`, pura como as vizinhas) traduz cada etapa: em `leitura` nada saiu deste navegador e a mensagem do erro já é a frase certa, escrita ao lado da regra que recusou; em `import` NADA foi criado no servidor, porque a rota roda inteira dentro de uma transação; em `images` o atlas EXISTE lá, sem parte das fotos, aparece na lista de cima, e reenviar cria um SEGUNDO atlas, porque este caminho copia e não sincroniza. Nos três a frase diz que o atlas local continua neste navegador, inteiro, que é a primeira pergunta de quem acabou de mandar o próprio acervo para algum lugar e leu um erro. O motivo sai de `classifyRequestFailure` (`frontend/src/js/utilities/request-failure.js`, folha sem imports, a definição única desta casa), e a linha que separa ecoar de traduzir é o STATUS: com status foi o SERVIDOR que falou e o que ele disse aparece; sem status quem falou foi o navegador, e é dali que vinha o "Failed to fetch". `deleteConfirmMessage` recebe `legacySlot`, preenchido pelo chamador com `atlas?.dbSuffix === ''`, e abre com um parágrafo dizendo que aquele é o acervo que veio da versão anterior do EBGeo, o único atlas que existia antes de o produto ter vários, mais a recomendação de exportar um arquivo `.ebgeo` antes de excluir.
- **Alternativas recusadas:**
  - *Uma frase única de falha, mais amável que o "Failed to fetch".* Continuaria dizendo a mesma coisa sobre dois estados opostos do servidor. O que a pessoa precisa saber é se existe ou não um atlas dela lá, porque disso depende se ela tenta de novo ou vai limpar a lista.
  - *Embrulhar o erro num `new Error(frase)` e propagar só a frase.* Perde `status` e pilha, e o `status` é exatamente o que distingue "o servidor falou" de "o navegador não conseguiu falar", que é a distinção inteira do motivo.
  - *Nunca mostrar o texto do servidor, para garantir português na tela.* Esconderia o corpo do 500, que na bancada era `erro forjado pela bancada` e num servidor real é a pista, cobrando uma ida ao console de quem não tem console.
  - *Recusar a exclusão do slot herdado, ou pedir uma segunda confirmação.* Excluir pode ser exatamente o que a pessoa quer, por exemplo depois de ter enviado o atlas ao servidor. Um diálogo que discute a decisão dela em vez de informar vira obstáculo que se aprende a atravessar sem ler.
  - *Reconhecer o slot herdado por `!atlas?.dbSuffix`.* Uma entrada malformada tem `dbSuffix` indefinido, e seria lida como sufixo vazio: a frase do acervo apareceria sobre um atlas qualquer, que é a mesma tela mentindo na direção contrária. A comparação é estrita, com controle na suíte.
  - *Acrescentar ao menu do cartão local a ação "Exportar .ebgeo", junto com a linha do diálogo.* Não coube neste lote e a razão está registrada: `frontend/src/js/import_export/export-import.service.js` exporta apenas a classe, o escritor do formato está inline em `handleExport` e depende do store MONTADO, do barril `@store`, dos modais e do JSZip, e a escolha da extensão da imagem é o método privado `getBlobExtension`. Uma terceira implementação do escritor cairia exatamente sobre a superfície que o conserto do MIME acabou de mexer. O que falta está nomeado: extrair de `handleExport` uma função pura `escreverArquivoEbgeo(data, blobsPorId)` e exportar `getBlobExtension`.
- **Consequências:** o caminho que a população encontra mudou de ramo na mesma onda. Com a subida por lotes passando a capturar POR LOTE (`frontend/src/js/import_export/atlas-image-upload.js`), o transporte que cai deixa de propagar e vira `imageStats.failed`, então a rede instável produz agora o AVISO que nomeia o que faltou e diz onde o atlas está, e não mais um toast de erro. O ramo `images` do erro fica como guarda fechada, sem gatilho pelas juntas públicas, e está prendido por um dublê declarado do módulo vizinho. Guardas: `frontend/tests/unit/falha-do-envio-nomeia-a-etapa.test.js` (27 casos, novo, 24 vermelhos contra o código anterior, com o pior caso da entrada em seis formas que não são erro nenhum e nunca produzem silêncio) e os casos novos de `frontend/tests/unit/exclusao-de-atlas-local-nomeia-a-perda.test.js` (22 para 33 casos, 5 vermelhos antes), com o controle de que um atlas comum NÃO recebe a frase do acervo, em três formas de a bandeira estar ausente e cinco valores que não são o booleano verdadeiro. O caso 3 de `frontend/tests/e2e-ui/envio-do-acervo-herdado.spec.js` abre o diálogo no navegador, lê o corpo, e confere no mesmo caso que o cartão do atlas descartável ao lado não recebe a frase; a captura foi lida.
- **Status:** aceita.

### 2026-09-07: o envio de um atlas local normaliza a coleção de feições na leitura

- **Contexto:** um mapa entra neste produto por quatro caminhos (o import de `.ebgeo`, o snapshot do servidor, a leitura do IndexedDB pelo repositório, e o leitor do envio ao servidor), e três deles passavam a coleção de feições por `ensureCoordinationLines`. O quarto, `buildLocalAtlasExportData` (`frontend/src/js/projects/send-local-to-server.service.js`), entregava a coleção CRUA. A Linha de Barreiras é da 2.2, e a migração 2.2 para 2.3 da outra linha do produto acrescentou `coordination_lines` VAZIO sem mover nada, então as feições continuam em `barrier_lines` no disco de quem veio de lá, atravessando 2.3, 2.4 e 3.0 sem nunca serem desenhadas. No envio a consequência é pior do que não desenhar: `buildFeatures` (`frontend/src/js/import_export/local-atlas-to-server.js`) resolve o tipo por `BUCKET_TO_SOURCE[balde] || props.source`, `barrier_lines` não está na tabela e `'barrier_line'` não está entre os tipos que o servidor aceita, então cada feição caía em `stats.droppedFeatures` e nunca era gravada. Medido com o insumo forjado de cinco linhas: 5 de 5 descartadas, `droppedFeatures` igual a 5, payload sem nenhuma delas.
- **Decisão:** a leitura do envio passa por `ensureCoordinationLines` (`frontend/src/js/store/repository.utils.js`), a mesma normalização que os outros três caminhos aplicam, na forma `ensureCoordinationLines(mapData?.features) ?? mapData?.features ?? {}`. O contrato de `null` daquela função (nulo significa "já está na forma, fique com o objeto que você tem") é o que mantém o custo em zero para todo mapa corrente. As feições adotadas ganham `source: 'coordination_line'`, o código MD33 da barreira em `symbol_code` e `baseCoordinates` derivadas da geometria, e a chave velha é removida da coleção, o que torna a passagem idempotente.
- **Alternativas recusadas:**
  - *Ensinar o mapeador do servidor a conhecer `barrier_lines`.* Espalharia por um segundo arquivo o conhecimento de um balde que esta linha do produto decidiu não ter, e o servidor passaria a aceitar um `feature_type` que a tela dele não desenha. A adoção acontece na leitura, uma vez, e daí para a frente existe um balde só.
  - *Passar `ensureMapDataShape`, que faz o mesmo um nível acima.* Devolveria um documento de mapa inteiro para um leitor que consome nove campos escolhidos a dedo, e alinharia por acidente campos que este caminho deliberadamente não leva.
  - *Deixar como está, já que o conserto da leitura na outra frente devolveu a Linha de Barreiras à tela.* Aquele conserto alcança o mapa montado; este caminho lê o disco sem montar nada, por desenho, e é o único que existe para a página de escolha. Sem esta linha, quem enviasse o acervo continuaria perdendo as feições, agora com elas visíveis no cartão local, que é pior.
  - *Passar também por `optimizeMapData` e pela poda de referência privada de catálogo, já que se está normalizando.* As duas continuam de fora pelo motivo que o cabeçalho do módulo sempre deu: as duas são REFEITAS adiante, `buildFeatures` de um lado e `pruneCatalogLayerDefinitions` dentro de `buildServerImportPayload` do outro. Esta não é refeita por ninguém, e é isso que a torna a exceção.
- **Consequências:** um mapa sem balde nenhum passa a sair do leitor com `coordination_lines` vazio, que não acrescenta feição ao payload e é a leitura honesta de "este mapa ainda não tem linha de coordenação". Guardas: cinco casos novos em `frontend/tests/unit/enviar-atlas-local-ao-servidor.test.js` (20 para 25 casos, 3 vermelhos contra o código anterior), sobre um mapa com `features.barrier_lines` de cinco feições e sem `coordination_lines`. A régua que mede o estrago é a do PAYLOAD, e não a da forma do documento intermediário: contra o leitor anterior ela reprovava com `expected 5 to be +0` em `stats.droppedFeatures`. Dois controles acompanham: um mapa que JÁ tem o balde novo não é reescrito nem duplicado (o `symbol_code` próprio dele sobrevive), e um mapa sem balde nenhum não ganha feição inventada. O `@fileoverview` da função, que listava o que ela deliberadamente NÃO faz, ganhou o parágrafo que explica por que esta normalização é a exceção às outras duas.
- **Status:** aceita.

### 2026-09-07: o degrau 3.0 repara `data.name` a partir da chave nos mapas que vieram da outra linha

- **Contexto:** a decisão da tarde ("o nome do mapa de um atlas local vem da CHAVE") consertou o LEITOR do envio e recusou, com razão declarada, "uma migração que reescreva `data.name` a partir da chave nos registros herdados". A bancada da noite mediu a consequência de parar ali (achado L-3): depois da adoção pela integracao, o slot de sufixo vazio continua com **13 de 14 registros de `ebgeo_maps` carregando `data.name = "Novo Mapa"`**, lido pela API crua do IndexedDB duas vezes. A `main` 2.4 ganhou no mesmo dia um reparo único no próprio boot (`repairPlaceholderMapNames`, `src/js/store/repository.js`), e ele não alcança esta população: quem sai de uma `main` de produção anterior àquele commit atravessa com o campo envenenado e nunca mais abre a `main`. O campo é inerte para todo consumidor conhecido DESTA linha, porque o atlas local é chaveado pelo nome e o leitor do envio passou a preferir a chave; ele volta a morder no primeiro consumidor que prefira o campo, que é exatamente o que o envio ao servidor fazia antes de `31b6dc76`, com 2 mapas e 33 feições chegando de 14 e 805. O chefe decidiu corrigir.
- **Decisão:** o degrau 3.0 (`frontend/src/js/store/migration/v2.x-to-v3.0.migration.js`) reescreve `data.name` a partir da CHAVE, uma vez, no momento em que adota os bancos da outra linha, antes do carimbo e sobre o escopo adotado. O gatilho é o predicado `owesLegacyAdoption` (`!legacyClaimed || claimedButNeverStepped`), o MESMO que já decide o descarte da fila legada: "estes bancos vieram da outra linha e este degrau ainda lhes deve a adoção" é um fato só, com duas consequências. A guarda contra repetir é o próprio ramo, e não uma chave de settings como na `main`: a travessia acontece uma vez por instalação, e depois dela o escopo está carimbado 3.0 e o degrau não corre mais; a idempotência ainda assim não depende disso, porque depois do reparo o campo É a chave e a segunda passada não acha marcador. As guardas são as do lote K, e cada uma nomeia um caso: só quando o campo É o marcador (nome escolhido pelo usuário nunca é tocado), só quando a chave DIFERE dele (quem quis mesmo um mapa "Novo Mapa" fica com ele), só quando a chave não é id gerado por `isValidId` (num atlas sincronizado a chave não é nome, e reescrever batizaria o mapa com o próprio UUID), escrita direta no store do escopo e nunca por `saveMap` (para não tocar a metade de sincronia nem enfileirar 13 operações fantasma), e dentro do próprio `try/catch` (um reparo cosmético nunca pode ser a razão de uma migração falhar). A contagem sai no log do boot, ao lado da contagem do descarte da fila.
- **Alternativas recusadas:**
  - *Não reparar, e viver com o campo envenenado no disco (o que a decisão da tarde tinha escolhido).* Continua certo quanto ao LEITOR, e é por isso que aquele conserto fica: a chave vence o campo, e nada no envio depende deste reparo. O que mudou é a medida: o campo envenenado sobrevive à travessia em 13 de 14 registros de todo mundo que vem da 2.2 ou da 2.3, e nenhum outro caminho desta linha o corrige. Deixar um dado errado no disco porque hoje ninguém o lê é apostar que o próximo leitor também não vai lê-lo, e foi essa aposta que custou 12 mapas e 772 feições no envio.
  - *Prender o reparo ao NOME do ramo (`adocao-do-legado`), como o brief do lote pedia ao pé da letra.* Medido em navegador: `atlas.html` chama `initLocalAtlases` e não roda migração, então quem abre "Seus atlas" antes do mapa chega ao degrau com os bancos já reivindicados, e o ramo responde `ja-adotado` sobre um disco vindo da outra linha; a bancada L viu esse caminho em 5 de 8 repetições. Preso ao nome, o reparo pularia justamente a população para a qual foi escrito. O predicado da fila já resolvia isso, e agora tem nome.
  - *Reparar também no ramo de quem JÁ atravessou.* Nesta linha o marcador não tem produtor (`createMapCompat` daqui já grava o nome pedido), então um registro assim veio de import, de cópia ou de um estado que este degrau não escreveu, e o degrau não é dono dele. Custaria uma chave nova em `ebgeo_app_settings` por escopo e uma leitura de todos os mapas de todos os slots no primeiro boot depois da atualização, para tocar disco de gente que nunca usou a outra linha. Há dois casos de controle prendendo isso.
  - *Copiar o desenho da `main`, com a chave a chave de settings do reparo da outra linha (placeholderMapNameRepairDone, que só existe lá).* Lá o reparo corre em todo boot e a chave é o que faz a leitura de todos os mapas ser paga uma vez; aqui o ramo já é essa guarda, e uma chave a mais no settings de todo usuário que atravessa é estado novo sem pergunta que ele responda. Medido: 25 chaves de settings antes e 25 depois, contra as 26 que a `main` consertada deixa.
  - *Reparar por `saveMap`, que é o caminho normal de escrita de mapa.* Tocaria `sync` e enfileiraria 13 operações que descrevem uma edição que ninguém fez, no exato boot em que o degrau acabou de descartar 428 operações inertes pela razão oposta.
- **Consequências:** todo boot de travessia paga uma leitura de todos os registros de `ebgeo_maps` do escopo adotado, uma vez, e reescreve N deles. Medido em navegador sobre a população real: 13 registros reescritos, 787 de 787 feições e 758 de 758 ids de feição preservados, 0 registros perdidos fora da fila legada em 606, e no dump de fundo o único campo de topo alterado nos 13 é `name`, com `sync` byte a byte igual (o único mapa com `sync` mexido é 'Principal', que o reparo não toca e que o app regrava por ser o mapa aberto). O `fileoverview` do degrau afirmava "WHAT THIS STEP MOVES: nothing", e a exceção passa a estar declarada lá, com a população e as guardas. Guardas: `frontend/tests/store/reparo-do-nome-de-mapa-no-degrau.test.js` (12 casos, novo), com 5 vermelhos contra o HEAD intacto e 12 de 12 com o conserto, sobre IndexedDB de verdade e a sequência real do boot; o dublê de `localforage` dos vizinhos foi recusado de propósito, porque ele vem com um mock de `utilities/uuid.js` que devolve `isValidId: () => true`, e sobre ele o controle da chave UUID passaria por omissão. O que NÃO se mede aqui: quantos usuários da `main` de produção têm mais de um mapa, que é a população real do reparo.
- **Status:** aceita.

### 2026-09-12: saída voluntária confirma e descarta pendências remotas

- **Decisão do dono:** ao sair explicitamente da conta, aceitar a perda das alterações não enviadas, mediante confirmação. Substitui o resgate automático na saída voluntária decidido em 2026-08-23. Expiração e perda involuntária de sessão continuam com tratamento próprio.
- **Comportamento:** o aviso soma as filas de todos os namespaces remotos registrados neste navegador, inclusive atlas fechados e de outras abas. Cancelar mantém a sessão e os dados; confirmar descarta pendências remotas. Contagem ilegível ou demorada exige confirmação com aviso de incerteza. Sem pendências, não há pergunta.
- **Isolamento:** registros locais, inclusive resgates já adotados como locais, ficam fora da contagem e do descarte. A saída não exclui conteúdo do servidor. A decisão aceita é gravada no registro remoto antes da desmontagem: uma abertura após limpeza interrompida esvazia o namespace antes de conectar, impedindo reenvio da fila descartada.
- **Implementação:** `frontend/src/js/session/confirm-logout.js`, entradas de mapa, atlas, administração e calibração, e `frontend/src/js/store/remote-atlas.api.js`.
- **Verificação:** testes de cancelamento, confirmação, contagem desconhecida, múltiplos atlas, proteção local, veto antigo e abertura após descarte interrompido. Navegador real com envio bloqueado e servidor de teste.
- **Status:** aceita.


### 2026-09-12: presença administrativa e correção da coleta de uso

O dono pediu implementar a revisão de observabilidade, mostrar logados/deslogados agora e incluir último login e atlas remotos por conta. Presença usa janela de 90 segundos, separada das sessões históricas; o anônimo é navegador, com deduplicação entre abas, e não pessoa identificada. A propriedade remota exclui a lixeira do número principal.

A coleta começa antes da preparação local e envia atualizações sem gestos. A alternativa de repetir contagens sem confirmação foi substituída por IDs de lote e deduplicação transacional; lotes não migram para outra conta. Preparar, sincronizar e confirmar descarte são resultados operacionais separados das ferramentas. Preferências permanecem agregadas, sem perfil individual ou replay. Sonda externa foi implementada como comando independente, com instalação interna ainda necessária; digest por e-mail continua fora do escopo.

Contrato, limites e guardas: o commit `fa0f0218`, e hoje as páginas [observabilidade](../wiki/observabilidade.md) e [presença administrativa](../wiki/presenca-administrativa.md), que absorveram o registro de implementação desta data.


### 2026-09-12: bases por dominio antes da primeira implantacao do backend

- **Pedido do dono:** consolidar todas as migracoes porque o backend ainda nao entrou em producao. Esta decisao supera a necessidade de manter os ajustes incrementais anteriores a essa primeira publicacao.
- **Decisao:** 21 arquivos viram 11 bases no estado final. Credenciais ficam com identidade; indices ficam com suas tabelas; metadados 360 nascem no projeto; defeitos nascem com nome e CHECK finais; uso, presenca e deduplicacao formam um dominio. O mapa esta em [bases do banco](../../backend/src/database/migrations/README.md).
- **Compatibilidade:** a primeira base recebe nome novo. O migrador recusa historico com nomes ausentes antes de aplicar arquivos pendentes; nao apaga nem remapeia tracking, nao recria bancos existentes e nao altera dados locais do navegador. Bancos de desenvolvimento anteriores exigem backup e banco novo, com transferencia explicita dos dados que precisem ser conservados.
- **Evidencia:** dois bancos descartaveis, criados pela sequencia anterior e pela consolidada, tiveram schema e seeds equivalentes. A repeticao do migrador preservou o estado. As guardas de tracking e higiene exercitam a recusa e a ausencia de reparos internos. Referencias a arquivos aposentados foram atualizadas para seus donos atuais.
- **Depois da publicacao:** bases imutaveis; evolucao apenas por novos arquivos incrementais.
- **Status:** aceita, autorizada pelo dono.


### 2026-09-12: orcamento de arquivos com presenca e telemetria antecipada

- **Medida:** build de producao apos as novas funcionalidades, 82 arquivos iniciais no mapa. Retirar o ponto de carga dinamica do monitor de pendencias reduziu para 81 arquivos e 3955 kB. A ativacao do leitor continua depois da preparacao local.
- **Decisao:** o teto de arquivos passa de 80 para 82, com uma unidade de folga sobre a medida. O teto de bytes permanece em 4150 kB. Os orcamentos de atlas, administracao e calibracao permanecem iguais e foram medidos em 578, 695 e 1840 kB, respectivamente.
- **Motivo:** a divisao por conjuntos de entradas do bundler fragmentou o codigo compartilhado das novas funcionalidades. O ajuste reconhece esse custo medido e nao autoriza aumento de peso acima do teto existente.
- **Guarda:** `frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js` continua verificando quantidade e bytes do build real; nenhuma etapa foi pulada.
- **Status:** aceita.

### 2026-09-12: diario remoto, recibos duraveis e conflitos explicitos

- **Autorizacao:** plano de correcao aprovado pelo dono, com execucao e registro intermediario em commit/push. A politica aceita conserva pendencias em falhas involuntarias; saida voluntaria confirmada continua descartando somente o trabalho remoto abrangido.
- **Decisao:** operacoes nao confirmadas deixam de expirar e de ser compactadas; a intencao deve anteceder a entidade. Recibos duraveis, vinculados ao autor e ao conteudo, sobrevivem a limpeza do historico. Recusa ou conflito nao representam versao vencedora.
- **Conflitos:** substituir a ultima chegada que vence por patches com base comprovada. Campos independentes podem conciliar; mesmo campo ou exclusao concorrente exigem decisao explicita. Geometria e uma unidade. O primeiro caminho implementado e o de feicoes; a expansao aos demais tipos e o bloqueio do protocolo antigo ainda estao pendentes.
- **Recuperacao:** montar snapshots completos em uma geracao separada e ativar dados/cursor juntos. Broadcast isolado nao comprova uma fronteira completa de replay. Operacoes e respostas assincronas pertencem ao escopo em que nasceram.
- **Schema:** novas tabelas pertencem a base logica de sync, pois o backend ainda nao foi implantado. Banco existente de desenvolvimento exige transicao explicita com backup; esta mudanca nao recria nem adapta automaticamente esse banco.
- **Estado:** implementacao intermediaria, sem liberacao para producao. Restam produtores, demais conflitos, painel de resolucao, uploads, descarte com estabilizacao completa, compatibilidade e homologacao. Detalhes e evidencias no commit `f8e109ea`, que carrega o plano aprovado pelo dono e o registro de execucao desta etapa; o mecanismo sobreviveu em [diario write-ahead](../wiki/diario-write-ahead.md) e [fila de saida](../wiki/fila-operacoes-outbound.md).


### 2026-09-12: descarte invalida escritores da sessao remota

O descarte voluntario autorizado pelo usuario ganha uma epoca persistida por namespace. Um callback de uma montagem antiga continua invalido apos uma nova entrada; a checagem ocorre tambem na fronteira da transacao IndexedDB, pois rejeitar somente depois do commit nao impede que uma exclusao antiga apague dados novos. Falha ao persistir o descarte nao e tratada como sucesso. Atlas locais e namespaces adotados como locais continuam excluidos. Antes do censo de pendencias, pausam-se escritores coordenados e envios automaticos desta aba; espera inconclusiva exige confirmacao de pendencias desconhecidas. A coordenacao anterior ao dialogo entre todas as abas permanecia em obra nesta data (commit `f8e109ea`), e fechou em 2026-09-13 como Web Lock por escopo remoto; ver [coordenacao entre abas](../wiki/coordenacao-entre-abas.md).

### 2026-09-12: movimentação e restauração são intenções explícitas

A correção dos contratos mantém o bloqueio à recriação antiga. Movimentar e restaurar declaram a intenção e exigem a revisão corrente, comprovada pela base ou pelo recibo de uma operação anterior do mesmo autor. Reabrir um upsert irrestrito faria testes antigos passarem, mas permitiria sobrescrever trabalho mais recente. A fila conserva somente a referência necessária ao recibo após o ACK, para desfazer/refazer continuar funcionando sem conservar o conteúdo excluído na fila. A exclusão voluntária do namespace também remove essa referência. Cobertura e limites no commit `f8e109ea`; o modelo que saiu daí está em [modelo de conflito](../wiki/modelo-conflito-lww.md).

### 2026-09-12: a camada padrão remota nasce no servidor

Criar o atlas grava o mapa inicial e sua camada; criar um mapa por sync ou excluir sua última camada grava a camada necessária na mesma transação e inclui o UUID confirmado no log, no ACK e no replay. O navegador sintetiza a camada default somente em atlas locais. Respostas atrasadas respeitam as versões e não regravam o documento inteiro do mapa. A regularização conserva feições e configurações existentes e exige snapshot dos clientes antigos. Uma edição que aponta explicitamente a uma camada excluída é recusada com motivo, sem transferência silenciosa. Detalhes e limites em [camada padrão remota](../wiki/camada-padrao-remota.md), que absorveu o documento de correção do commit `e70ccf3c`.

### 2026-09-12: protocolo obrigatório e conciliação de filas antigas por recibos

O plano de fechamento autorizado exige protocolo v2 explícito em todas as operações incrementais. HTTP, WebSocket e serviço recusam envelopes incompatíveis antes de aplicar o lote. HTTP usa 426: os clientes anteriores tratam 400/422 como descarte permanente e não devem apagar trabalho por incompatibilidade de versão. A negociação inicial confirma capacidade de escrita e consulta de recibos.

Fila remota antiga mantém envelope, ID e chave originais. A consulta de recibos é somente leitura, vinculada ao atlas, ao autor e ao hash exato; apenas uma confirmação inequívoca permite retirar a operação. Um leitor que perdeu escrita pode confirmar sua própria entrega anterior, respeitada a visibilidade de comentários. Ausência ou ambiguidade não significa que a operação nunca chegou ao servidor. O cliente bloqueia reenvio e projeção das intenções incompatíveis e seus dependentes, sem inventar uma base atual. Atlas locais não entram nessa quarentena. A política de descarte voluntário confirmado permanece vigente.

Este bloqueio não conclui os conflitos das demais entidades, a interface persistente de resolução nem as quatro exceções estruturais REST. Execução e limites no commit `b26f4e66`.

### 2026-09-12: intenção durável de briefing inclui os slides

O documento do briefing e as linhas de slides no servidor têm persistências distintas. Toda alteração local passa a derivar e registrar o conjunto de intenções antes da entidade. As marcas que liberam o envio desse conjunto são removidas numa transação IndexedDB única; recuperação reaplica a projeção com os IDs originais. A presença de slides no documento do pai não substitui a criação individual de cada filho.

Criar um briefing com slides, copiar e importar como novo no atlas remoto atribui novas identidades de pai/filhos; uma importação que sobrescreve o briefing existente conserva a identidade desse destino. Os objetos fornecidos pelo chamador não são alterados. Isso evita colisões entre cópias nas tabelas globais do servidor. Conflitos de conteúdo e de ordem, e a atomicidade remota dos comandos compostos, eram entregas próprias do plano autorizado daquele dia (commit `b26f4e66`) e fecharam em 2026-09-13; ver [modelo de conflito](../wiki/modelo-conflito-lww.md) e [lote lógico de gesto](../wiki/lote-logico-de-gesto.md).

### 2026-09-12: catálogo preserva mapa de destino e identidade textual no replay

As intenções de catálogo antecedem a gravação do mapa e usam a identidade do destino lido. O log mantém `operations.client_entity_id`, pois a identidade textual da camada não cabe no campo UUID que antes a substituía pelo atlas. Replay de histórico antigo sem identidade suficiente exige snapshot autorizado; exclusão com payload vazio não pode ter seu alvo inventado. A coluna entra na base lógica de sync (commit `d0c99dea`). **A instrução de transição aditiva que esta linha carregava foi retirada em 2026-09-13:** ela descrevia um banco implantado que não existe, e o que vale é a entrada de baseline congelada, adiante. Conflitos de revisões das camadas continuam pendentes.

Na reconstrução de recibo ausente, uma identidade textual perdida também impede confirmar a operação como aplicada. Duas exclusões com payload vazio não são equivalentes apenas porque o campo UUID guardou o atlas para ambas. A confirmação continua possível quando a identidade original está comprovada no histórico.

### 2026-09-13: a baseline consolidada é editável até a implantação e congelada depois

A linha de integração deste backend nunca foi implantada, e o dono confirmou isso em 2026-09-13. Logo não existe banco de produção para migrar, e a primeira implantação é uma instalação nova a partir das doze bases de `backend/src/database/migrations/README.md`. Enquanto o SHA candidato não for implantado, a baseline consolidada continua editável; banco de desenvolvimento aplicado antes de uma edição se recria, sem script de transição.

O congelamento entra em código já, e não na data da implantação: `backend/src/database/migrate.js` grava o sha256 do conteúdo de cada arquivo aplicado em `_migrations` e recusa, nomeando arquivo e os dois hashes, um arquivo já aplicado cujo conteúdo mudou. Em desenvolvimento a recusa se resolve recriando o banco; a partir do SHA implantado ela é o congelamento, e toda mudança de schema passa a entrar por arquivo numerado novo. Linha rastreada antes desta data não tem checksum e adota o do disco na primeira rodada, porque reprová-la criaria trabalho sem proteger banco nenhum.

A alternativa recusada foi escrever agora uma migração numerada de transição que acrescentasse o que `backend/src/database/migrations/004_sync.sql` ganhou depois da consolidação. Ela custaria um degrau permanente no histórico e um caminho de upgrade a manter, para reparar um único banco de desenvolvimento que se recria em minutos. Sem banco a transitar, o degrau seria só dívida. O que a motivou foi real: o rastreio por nome pulava a baseline editada em silêncio, e é essa classe que o checksum fecha. Contexto e achados no commit `841e1539`, que trouxe a auditoria de 2026-09-13 com os vinte e seis achados; o que dela continuava aberto foi resolvido ou realocado em 2026-09-19, na entrada "as pendências do lançamento saem de docs/reviews", adiante neste arquivo.

### 2026-09-13: as quatro decisões de condução do lançamento, e a pendente do reuso de imagem por conteúdo

A auditoria de 2026-09-13 (commit `841e1539`) abriu com seis perguntas que só o dono podia responder, e as respostas dele chegaram no mesmo dia. D1 (a origem da rede interna) virou medição, não decisão, e D6 (a baseline consolidada) tem entrada própria acima. As quatro que sobram são de condução e ficam registradas aqui, porque cada uma manda num bloco inteiro de execução.

**D2. A quarentena sobrevive ao logout.** As ops de protocolo antigo, ou recusadas pelo servidor, passam a ser exportadas para um registro global por atlas ANTES de o namespace ser destruído, ficam legíveis na tela de pendências e o aviso de saída passa a contar e nomear essas ops. A alternativa recusada está escrita no próprio plano, no item 2 do bloco B3: recusar o descarte enquanto houvesse problema sem decisão. Ela protege o mesmo dado prendendo a pessoa na conta, e o preço é que a única saída de um trabalho que o servidor já recusou passaria a ser não sair.

**D3. A política de gerações guarda a ativa mais uma anterior.** A poda é idempotente, feita na ativação da nova; geração preparada que falhou é apagada na hora. O plano não nomeia outra alternativa: o que a escolha descarta são os dois extremos, guardar só a geração ativa (sem nada para onde voltar quando a nova nasce quebrada) e guardar histórico sem teto (que cresce sem ninguém que o pode).

**D4. Comando composto é lote lógico por `batchId`.** O servidor aplica ou recusa o lote inteiro num único savepoint, o envio nunca corta dentro de um lote, e lote acima de um limite medido (a começar em 25 operações) é recusado nomeando o motivo. A alternativa recusada é a do próprio texto do dono: preparação durável com ativação no fim, que fica para importação grande e sai do recorte do lançamento. Ela é mais forte e é cara, porque exige estado preparado no servidor com ciclo de vida próprio, para um problema que o savepoint já resolve no tamanho de lote que o produto produz.

**D5. O id de sessão volta para o `sessionStorage`.** A alternativa recusada é o estado anterior a esta decisão: uma release havia movido o singleton para memória, e ali cada recarga cunha um id novo. A correlação de erro por sessão é o instrumento de diagnóstico, e recarregar é a primeira coisa que uma pessoa faz quando algo quebra, de modo que um id que reinicia no F5 parte em dois exatamente o rastro que alguém está seguindo. O comportamento está declarado no cabeçalho de `frontend/src/js/session/sessao-id.js`, que é onde ele tem de ser lido antes de a próxima release mover o valor de novo.

**D7, a sexta pergunta: o reuso de imagem por conteúdo, sem chave de tentativa.** O bloco B8 (commit `c0ce39f3`) fez a rota única de imagem reusar, na falta de chave de idempotência, a linha de mesmo hash de conteúdo no mesmo atlas. O efeito de superfície é que reenviar os mesmos bytes com outro nome devolve a linha antiga, com o nome antigo, e duas feições passam a compartilhar uma linha de imagem. Nenhum caminho do cliente chama a exclusão de imagem no servidor hoje, então não existe perda alcançável pelo produto, e é por isso que isto entrou como pendência e não como defeito. A alternativa era estreitar o reuso: casar só por chave de tentativa, aceitando que um reenvio sem chave grave uma segunda linha e um segundo arquivo em disco para os mesmos bytes. **O dono respondeu no mesmo dia, escolhendo estreitar, e a decisão tem entrada própria ao fim deste arquivo;** o efeito está nomeado em [imagens do atlas](../wiki/imagens-atlas.md).

### 2026-09-13: create sobre túmulo continua ressuscitando, e a recusa de create é só de 3D e 360

- **Decisão:** ao fechar os quatro buracos de túmulo do servidor (bloco B5), o UPDATE sobre linha excluída passou a ser recusado com motivo em sete alvos, e o CREATE sobre linha excluída continua RESSUSCITANDO em feição, mapa, camada, grupo, briefing e slide. Só `cesium3d` e `streetview360` recusam create.
- **Por quê:** create sobre túmulo É o desfazer. O Ctrl+Z de uma exclusão reenvia um create com o mesmo id, e os seis alvos acima compartilham esse contrato, cada um asserido em `backend/tests/integration/sync-service-coverage.test.js`. Recusar ali tiraria a capacidade de desfazer uma exclusão sincronizada, que é a operação que mais se desfaz.
- **Por que 3D e 360 são exceção:** eles nunca tiveram esse contrato. O create deles era inerte sobre linha existente por `ON CONFLICT DO NOTHING`, então nomear a recusa não tira capacidade nenhuma e troca um silêncio por um motivo.
- **Alternativa recusada:** uniformizar, recusando create sobre túmulo em todos. Ela é mais simples de descrever e custa o desfazer; a assimetria é feia e é o contrato que o produto já tinha.
- **O que continua aberto, declarado:** update sobre linha que NUNCA EXISTIU segue sendo acked como aplicado. O log de operações é expurgável, então ausência não prova exclusão, e recusar por ausência transformaria todo par create/update fora de ordem numa recusa permanente. O comportamento está medido no último caso daquele arquivo, para que uma mudança futura apareça.
- **Status:** aceita.

### 2026-09-13: catálogo, 3D e 360 disputam o documento inteiro, e entidade de uma unidade não guarda fronteira

- **Decisão:** a unidade de disputa das camadas de catálogo, do 3D e do 360 é o DOCUMENTO INTEIRO, unidade única, enquanto mapa, camada, grupo, briefing, slide e comentário têm unidades por campo (`DISPUTE_UNITS`, `backend/src/modules/sync/entity-conflicts.js`, espelhado em `frontend/src/js/store/sync/dispute-units.js`). Entidade de uma unidade só **não grava linha de fronteira** por unidade.
- **Por quê:** com uma unidade, "alguma unidade passou da sua base" é aritmeticamente igual a "a versão da linha passou da sua base", então a linha de fronteira seria uma segunda cópia de `version`, com um segundo lugar para divergir. O cliente dessas três famílias envia o documento inteiro, então declarar unidades por campo prometeria uma precisão que o payload não tem.
- **Consequência que resolve um problema de tipo:** a camada de catálogo tem id textual, enquanto a coluna de id da tabela de fronteiras é UUID (`backend/src/database/migrations/004_sync.sql`). Como ela não grava fronteira, nenhuma migração foi necessária: o que faltava era usar a coluna de tipo de entidade em vez de um literal.
- **Membresia de grupo não tem unidade nenhuma**, por ser junção com create e delete idempotentes.
- **Ordem de slide não é unidade de slide:** ela mora na coluna de ordem do briefing, então duas reordenações disputam sob a unidade do briefing. O esboço do plano pedia "conteúdo, ordem" para slide, e aquela coluna não existe.
- **Alternativa recusada:** estreitar o payload no cliente para que essas três famílias mandassem só o campo mudado. Ela só é segura depois que cada entidade tiver operação canônica, senão o par que recebe a transmissão perde os campos ausentes na substituição em bloco.
- **Status:** aceita; detalhe e armadilhas em [modelo de conflito](../wiki/modelo-conflito-lww.md).

### 2026-09-13: o servidor publica os quatro marcadores estruturais como um só, até o cliente novo estar em campo

- **Decisão:** as quatro exceções REST (merge de mapas, duplicação de mapa, clone de atlas, import de atlas) passaram a gravar marcador no log de operações, e o servidor publica os QUATRO sob o tipo do merge. O cliente já reconhece os quatro nomes; as três entradas novas ficam inertes.
- **Por quê:** o cliente antigo que receber um tipo que não conhece é o cliente que este mesmo lote ensinou a não derrubar o socket, mas a propriedade só vale para o build novo. Publicar o nome honesto antes de o cliente atualizado estar em campo entrega, ao build que está rodando hoje, um marcador que ele ignora, e o efeito é o mesmo replay vazio que o marcador existe para evitar.
- **O que destrava:** trocar o tipo é um commit dos DOIS pacotes, e ele é barato; o que ele exige é a certeza de que o cliente em campo é o novo, que é informação de implantação e não de código.
- **Alternativa recusada:** publicar o nome honesto já e aceitar que o cliente antigo ignore. Ela troca um defeito conhecido (o par offline conclui que está em dia) por outro do mesmo tamanho durante a janela de implantação, e a janela não tem prazo conhecido.
- **Status:** aceita, com a troca pendente de implantação; registrada em [lote lógico de gesto](../wiki/lote-logico-de-gesto.md).

### 2026-09-13: sem Web Locks a barreira de logout degrada para o regime por aba

- **Decisão:** a pausa que antecede a contagem de pendências do logout passou a ser um Web Lock por escopo remoto (`logoutBarrierLockName`), com o escritor em modo compartilhado e o diálogo em exclusivo com espera; **onde `navigator.locks` não existe, tudo degrada para o regime por aba anterior**, e o degradado não é bloqueio.
- **Por quê:** a decisão D1 do mesmo dia manteve a produção em HTTPS, então contexto seguro é o caso normal e o degradado é exceção. Recusar o logout inteiro na ausência da API prenderia a pessoa na conta por falta de um instrumento, o que é pior que contar de menos; e implementar um substituto por mensagens repetiria o erro que o Web Lock veio consertar, porque canal é relógio e mente por silêncio.
- **Preço declarado:** no regime degradado a contagem do diálogo volta a ser otimista, como era antes desta mudança. Ele está escrito no cabeçalho de `frontend/src/js/store/write-coordinator.js`.
- **O que isso transforma em medição:** `isSecureContext` e a presença de `navigator.locks` na origem interna REAL, porque certificado interno aceito à força pode negar o contexto seguro em algum navegador. Sem essa medição a barreira é uma afirmação sobre a bancada.
- **Alternativa recusada:** exigir contexto seguro para permitir o logout. Ela protege o dado e tranca a saída.
- **Status:** aceita; detalhe em [coordenação entre abas](../wiki/coordenacao-entre-abas.md).

### 2026-09-13: a poda de gerações usa trava PRÓPRIA, e a lista de conhecidas é reescrita depois dela

- **Decisão de mecanismo, complementando D3** (que fixou a política: sobrevivem a geração ativa e uma anterior): a poda toma uma trava por GERAÇÃO (`atlasGenerationLockName`), nunca a de montagem, e `pruneSupersededGenerations` reescreve a lista de gerações conhecidas DEPOIS da poda.
- **Por que não a trava de montagem:** a aba que poda é a que está montada, então ela seria recusada por si mesma. Uma trava por geração responde à pergunta certa, que é "outra aba ainda LÊ esta geração", e não "alguém tem este atlas montado".
- **Por que a lista é reescrita depois:** reescrevê-la antes deixaria a lista nomeando banco que saiu do disco, e a varredura seguinte deriva a lista de bancos do próprio ponteiro. Pela mesma razão, um delete que não confirma MANTÉM a geração na lista: sobrar dado de servidor que nenhum expurgo acha é pior que sobrar uma casca vazia.
- **A poda é best-effort e roda DEPOIS do commit do ponteiro**, então falha nela custa disco e nunca a recuperação; a próxima ativação poda de novo.
- **Alternativa recusada:** podar antes de ativar, para nunca guardar duas gerações. Ela deixa o usuário sem nada para onde voltar exatamente quando a geração nova nasce quebrada, que é o caso que a política de D3 existe para cobrir.
- **Status:** aceita; detalhe e limites em [namespace por atlas](../wiki/namespace-por-atlas.md).

### 2026-09-13: a rota única de imagem deduplica só por chave de tentativa, e conteúdo igual deixa de ser identidade

- **Decisão (D7, resposta do dono à sexta pergunta da auditoria):** a rota única de imagem reusa uma linha existente **apenas** quando a requisição traz a chave de tentativa no cabeçalho de idempotência. Sem chave, bytes idênticos criam linha nova e arquivo novo, que é o comportamento anterior ao commit `c0ce39f3`. A rota de lote não muda: ela mantém o reuso quando o id local coincide **e** o conteúdo é o mesmo (a retentativa legítima), e continua recusando id local igual com conteúdo diferente. O `content_hash` continua gravado em toda linha e o índice parcial não único continua existindo.
- **Por quê:** conteúdo igual não é a mesma intenção, e tratá-lo como se fosse mudava semântica visível em duas frentes. Reenviar os mesmos bytes com um nome NOVO devolvia a linha antiga, com o nome ANTIGO, ou seja, a rota respondia sobre um recurso que o chamador não nomeou. E duas feições passavam a compartilhar uma linha de imagem, o que a exclusão FÍSICA deste módulo (`DELETE_IMAGE`, `backend/src/modules/images/images.queries.js`) transformaria em perda para a feição que não pediu a exclusão. Que o cliente de hoje não chame aquela rota de exclusão é uma propriedade do cliente de hoje, não do servidor, e é fraca demais para sustentar uma linha compartilhada.
- **Por que a bulk fica como está:** lá a pergunta é feita ATRAVÉS de um id, porque o id é escolhido pelo cliente e preservado como chave primária. "Este id guarda estes bytes?" distingue retentativa de colisão sem nunca juntar duas feições que não se conhecem. A pergunta inversa, "que linha deste atlas tem estes bytes", é a que foi removida, e ela agora não tem consulta em lugar nenhum.
- **Preço aceito, declarado:** um reenvio sem chave custa uma linha e um arquivo a mais em disco. É o mesmo tipo de custo que este módulo já aceita em outro lugar (não existe coleta de blob órfão), e é preferível a uma resposta que fala de outro recurso. Hoje o preço é teórico, porque o cliente transporta imagem pela rota de lote.
- **Alternativa recusada:** manter o reuso por conteúdo, argumentando que ele economiza disco e que nenhum caminho do produto alcança a perda. Ela troca uma economia mensurável por uma resposta que engana em silêncio, e a proteção dela depende de o cliente nunca ganhar um caminho de exclusão, o que é uma aposta sobre código futuro.
- **Guarda:** `backend/tests/integration/imagens-idempotentes.repro.test.js`, cujo caso de conteúdo igual sem chave passou a cobrar linha nova, id novo e o NOME enviado. Controle negativo executado: com o reuso por conteúdo recolocado, esse caso é o único dos nove que reprova.
- **Status:** aceita; a regra está escrita em [imagens do atlas](../wiki/imagens-atlas.md).

### 2026-09-13: as cópias abandonadas da atualização são podadas com uma reserva, e a origem legada só sai por decisão explícita

- **Decisão (D8):** a varredura de boot apaga as cópias que a transição legada abandonou, guardando **uma reserva**, e recolhe as restaurações mortas; a **origem** (os bancos sem sufixo, o acervo que a linha anterior do produto ainda conhece) não é alcançada por varredura nenhuma e sai só pelo botão "Apagar a cópia antiga da versão anterior", na tela de recuperação, com confirmação que NOMEIA a contagem de registros do inventário.
- **Por que uma reserva, e por que a mesma regra das gerações de retrato (D3):** toda cópia abandonada é cópia inteira do mesmo acervo, e nada as apagava, então duas interrupções deixavam três cópias em disco que só o exportador de recuperação sabia nomear. A reserva é o piso de quem já estava lendo aquela cópia, e, uma vez apagada a origem, a única cópia completa que resta além da ativa; qualquer uma mais antiga já sobreviveu a um ciclo inteiro de interrupção sem ninguém resolvê-la. Delete que não confirma MANTÉM a entrada na lista, e a lista sobrevivente é reescrita DEPOIS dos deletes, pelo mesmo motivo de lá: lista que nomeia banco fora do disco é o vazamento que este caminho existe para fechar, e o inverso (banco em disco que lista nenhuma nomeia) é pior, porque ninguém mais o acha.
- **Por que a origem é exceção:** apagar automaticamente a única cópia pré-atualização não é decisão que código possa tomar. O único negócio da varredura com a origem é CONCLUIR uma exclusão já ordenada que morreu no meio, que é cumprir ordem e não tomá-la.
- **O prazo de sete dias para a restauração abandonada**, escolhido pelos dois modos de falha e não por gosto: apagar cedo demais destrói uma restauração apenas PAUSADA (a de alterações tardias retoma entre boots, sob o mesmo id, e quem começa numa sexta volta na segunda); apagar tarde demais custa só disco, que é justamente o que se está trocando. Uma semana é o maior intervalo em que uma interrupção ainda é retomada querida, e o carimbo é do INÍCIO da restauração, nunca renovado, então o relógio mede a tentativa inteira.
- **A intenção vai antes dos deletes.** O diário passa por um estado de exclusão em curso e só chega ao final com todos os deletes confirmados. A ordem inversa deixaria um acervo meio vazio que o diário descreve como inteiro, e a tela ofereceria "recuperar as alterações" de uma exclusão que o usuário pediu.
- **O que a exclusão da origem NÃO leva junto:** a fila de saída daquele endereço. O banco sem sufixo da fila é também `UNMOUNTED_QUEUE_SCOPE`, onde ESTA sessão estaciona operações enquanto nenhum atlas está montado, de modo que apagá-lo destruiria trabalho de agora no gesto cuja promessa inteira é levar só a cópia antiga. Daí a bandeira de dado-somente em `dropAtlasDatabases`.
- **O detector de schema deixou de perguntar por proteção** e passou a perguntar se a transição JÁ ACONTECEU (`legacyTransitionExists`). Apagada a origem, um "precisa migrar" sobre o endereço esvaziado mandaria a cadeia CRIAR um registro de atlas e registrar um slot #1 fantasma. Os outros consumidores continuam lendo `legacySourceIsProtected`, que agora responde falso, e para eles isso é a liberação pretendida.
- **Alternativa recusada:** apagar a origem sozinha, por prazo, como as cópias abandonadas. Ela fecha o disco sem perguntar, e a origem é a única cópia que o usuário ainda pode abrir na versão anterior do produto; a pendência deste lote pedia explicitamente poda condicionada a recuperação verificada, não poda automática.
- **Alternativa recusada:** esconder o comando quando ele não pode agir. Toda recusa aqui é reversível e quem lê a frase costuma ser quem a reverte, então o comando é desenhado, carrega `aria-disabled` e nunca a propriedade que impediria o clique, e o clique é o que entrega o motivo.
- **Status:** aceita; detalhe em [namespace por atlas](../wiki/namespace-por-atlas.md).

### 2026-09-14: o fecho de segurança dos vendors segue as oito recomendações da proposta

- **Decisão (D9, resposta do dono às oito perguntas da proposta de fecho do B10 de 2026-09-13, cujo documento foi absorvido por esta entrada e apagado em 2026-09-15):** V1, o three sai do snapshot 164dev e entra pelo npm em `three@0.164.0`, versão exata, num ponto único no modelo de `frontend/src/js/map/maplibre.js`. V2, `cesium-measure.js` deixa de ser vendor e vira código da casa, sob o ESLint e com os comentários traduzidos. V3, `cesium-viewshed.js` fica declarado por escrito como código ofuscado sem autor nem licença rodando com os privilégios da página, e a reescrita sobre a API pública de `ShadowMap` é o alvo, com prazo. V4, as sete bibliotecas nativas do WASM do GDAL sem versão determinável ficam aceitas e declaradas como lista fechada. V5, Draco e Basis dentro do `@manycore/aholo-viewer` ficam declarados como o ponto cego que resta, com o manifesto pedido ao fornecedor; `semver` e `fflate` NÃO entram como dependências diretas só para o `npm audit` falar delas. V6, os seis vendors sem consumidor são podados, num commit isolado com captura do 3D e do 360. V7, a segunda cópia do three em `frontend/public/street_view/build/` é podada e o inventário passa a cobrir todo `.js`, `.css` e `.wasm` de terceiro em `frontend/public/`, acusando arquivo fora das pastas conhecidas. V8, o digest do índice da imagem base é fixado nas duas linhas `FROM` do `backend/Dockerfile` no commit de lançamento, com construção de prova; a varredura do sistema operacional da imagem pode vir depois do lançamento.
- **Por quê:** cada item troca uma auditoria recorrente sobre código sem dono por um custo único, e o que não dá para fechar fica ESCRITO em vez de invisível. O inventário existe para que a conferência seguinte seja um diff.
- **Alternativa recusada:** declarar `semver` e `fflate` no lockfile para que o audit os veja (V5, opção 4): verde que não verifica, porque a cópia que roda é a vendorizada dentro do viewer, não a do lockfile.
- **Status:** aceita; V1, V2, V6 e V7 em execução; V3, V4 e V5 são declarações no inventário; V8 espera o SHA candidato.
- **V5 SUPERADO em 2026-09-15, por decisão do dono:** não existe pedido de manifesto ao fornecedor, e o texto que estava pronto foi apagado; os dois pontos cegos ou se resolviam pela internet ou ficavam declarados como aceitos. Os dois FECHARAM, por hash contra os artefatos publicados, que é o mesmo método que já havia fechado o Turf e os 392 arquivos do Cesium. **Draco é a 1.5.7** (285.948 bytes, sha256 `2516a4e43526d71787bf2f678f951329f7f858f8f15f42d4bc9e370b31a0da3a`, idêntico ao decodificador da release 1.5.7 de google/draco e ao do pacote npm `draco3d@1.5.7`, por quatro caminhos, um deles o blob SHA-1 que o próprio GitHub calcula; a 1.5.6 tem outro hash, então o hash discrimina). **O Basis é um intervalo de commits, não um número:** os 613.861 bytes são idênticos ao transcodificador de BinomialLLC/basis_universal nas tags v1_60_snapshot e v1_60_snapshot_final, nascidos no commit 5179a06343 e substituídos no a6bf1c00f2, e não são nem a release 1.60 nem a v2.0. Nenhum dos dois carrega remendo local no WebAssembly, e os dois módulos de cola JavaScript divergem do upstream por exatamente duas edições de empacotamento cada. **O que fica ACEITO sem fechar é a ausência de automação**: isto é a medição de UMA versão, a 1.8.1, feita à mão, e um 1.8.2 do fornecedor não deixaria teste nenhum vermelho. O que fechou os dois não foi o hash, foi o sourcemap que o pacote publica, e a leitura de 2026-09-14 tinha caminhado o binário certo sem abrir o mapa ao lado dele. Detalhe em [inventário de vendors](../wiki/inventario-de-vendors.md), item 4, que desde 2026-09-19 é o único lugar onde os dois veredictos moram: o bloco do manifesto que os declarava saiu com ele naquela data.

### 2026-09-14: recibos de sync são retidos pela versão mínima do atlas, e a expiração do JWT não derruba socket

- **Decisão (D10, A13):** `sync_receipts` ganha expurgo atrelado a `min_version`: sai o recibo mais velho que a versão que nenhum cliente pode mais pedir, e nunca por prazo solto. **Decisão (D11, A14):** socket aberto continua de pé depois de o JWT expirar; a varredura reconcilia autorização (conta, OM, papel, compartilhamento, publicação), nunca sessão, e isso passa a estar declarado na wiki em vez de só no código.
- **Por quê:** o recibo é o que torna o reenvio idempotente e mantém um lote recusado recusado, então purgar por prazo reabriria a reaplicação de ops antigas; o token expirado não muda o que a pessoa pode fazer, e a queda por autorização já é imposta.
- **Alternativa recusada:** purgar recibo junto com `operations` no mesmo expurgo do administrador, por data. Um cliente que ficou meses offline reenviaria ops que o recibo já tinha acked, e elas seriam aplicadas de novo.
- **Status:** aceita; A13 executada e A14 declarada em 2026-09-14. **Reconfirmada pelo dono em 2026-09-15** depois de a implementação medir o preço: a permanência dos recibos era contrato (três testes a prendiam), e o recibo também resolve a base da edição encadeada; abaixo da fronteira, um cliente de volta de ausência longa recebe conflito nomeado no painel em vez de "já aplicado", e nada reaplica. Mantida porque a fronteira só alcança o que o pull já responde com snapshot; a reversão é uma linha, dita em `backend/tests/integration/expurgo-de-recibos-por-min-version.test.js`.

### 2026-09-14: cem atlas vivos por conta, e um teto de mapas por importação

- **Decisão (D12, A15):** `POST /atlas`, `POST /atlas/import` e o clone recusam com 429 nomeado quando a conta já tem cem atlas vivos (lixeira não conta); a importação recusa acima de um teto de mapas por arquivo. Os dois valores são variáveis de ambiente com padrão, e zero desliga.
- **Por quê:** era o único limite de recurso sem dono depois do teto de sockets por principal: autenticado e atribuível, mas sem teto.
- **Alternativa recusada:** cota por OM. A lotação é auto-declarada no cadastro e não autoriza nada, então uma cota por OM seria contornável trocando a lotação.
- **Status:** aceita; em execução.

### 2026-09-14: a busca de usuários deixa de enumerar o efetivo, e o vídeo de prévia ganha gate

- **Decisão (D13, P8):** `GET /users/search` exige três caracteres, devolve no máximo vinte linhas e casa só nome e login; posto e OM saem do casamento e o limitador anônimo de rotas públicas passa a valer nela. **Decisão (D14, P9 e R6):** o vídeo de prévia de recurso do catálogo deixa de ser capacidade por URL: sai por rota gateada pelo mesmo predicado das outras mídias do recurso, e marcar o recurso privado re-cunha o nome do arquivo, para que a URL antiga morra.
- **Por quê:** a busca casando posto e OM devolvia o efetivo de outras organizações a qualquer conta; o vídeo era a única superfície em que marcar privado não movia byte nenhum, e declarar isso no censo deixaria escrito um vazamento.
- **Alternativa recusada:** manter a busca ampla e só limitar o número de linhas. Vinte linhas por consulta com posto e OM no casamento continuam sendo enumeração, só mais lenta.
- **Status:** aceita; em execução.


### 2026-09-14: o Cesium sai da pasta de vendors e entra pelo npm, e o viewshed continua pelo global

- **Decisão (V9, na mesma linha de trabalho de D9 e com a mesma forma de V1):** a distribuição do CesiumJS deixa de ser cópia versionada em `frontend/public/vendors/cesium/` (1.138.0, 390 arquivos, 14 MB, carregada por `<script>` injetado em runtime) e passa a vir do npm em `cesium@1.145.0`, versão EXATA, por um ponto único, `frontend/src/js/vendor/cesium.js`, no modelo de `frontend/src/js/map/maplibre.js` e de `frontend/src/js/vendor/three.js`. Ele é alcançado APENAS pelo `import()` que já trazia o motor (`3d_models_viewer_tool/map_3d.js`), então o motor continua no chunk lazy `cesium-integration`. Os quatro diretórios que o Cesium busca por URL depois do boot (`Assets/`, `ThirdParty/`, `Widgets/`, `Workers/`) NÃO são versionados: o plugin `ebgeo-cesium` do `frontend/vite.config.js` os copia do pacote a cada build, e `window.CESIUM_BASE_URL` os endereça (`frontend/src/js/vendor/cesium-base-url.js`). `cesium-viewshed.js` FICA em `frontend/public/vendors/cesium/`, ainda por `<script>`, e o ponto único publica `window.Cesium` para ele; o `<link rel="prefetch">` do Cesium sai do `index.html` sem substituto.
- **Por quê:** é o mesmo argumento de V1, e nas mesmas palavras: o custo daquela cópia nunca foi peso, foi CANAL. Trezentos e noventa arquivos que nenhum `npm audit` alcança e cuja identidade só se confirmava por uma conferência de 392 hashes contra o jsDelivr, que ninguém ia repetir. Em versão exata, a pergunta de amanhã ("há aviso publicado sobre ela?") volta a ter a quem ser feita. O peso da página não foi argumento nem custo: medido em build fresco dos dois lados, o payload ansioso do mapa ficou em 84 arquivos e 4098 kB contra 84 e 4097 antes, porque os 4,97 MB do motor saem num chunk que nenhum HTML referencia.
- **Alternativa recusada (1):** deixar os quatro diretórios de ativo onde estavam, versionados, e trocar só o motor. Seria a pior das combinações: motor 1.145.0 com workers 1.138.0, um par que não casa e cujo sintoma (terreno que não decodifica, malha que não desenha) chega longe da causa e sem erro.
- **Alternativa recusada (2):** manter o `prefetch` apontando para o chunk do motor. O nome dele carrega hash de conteúdo, então só se acerta adivinhando pelo RÓTULO do grupo, e o próprio `vite.config.js` registra que rótulo de chunk nunca prediz conteúdo; além disso um `href` para `/assets/` entra na conta de peso da página, somando 4 MB a um teto que existe para acusar exatamente isso. O preço aceito é a primeira abertura do 3D baixar o motor na hora, dito por extenso no `index.html`.
- **Alternativa recusada (3):** dar ao pacote um grupo próprio em `codeSplitting.groups`. A regra foi escrita, construída e jogada fora: dois builds completos, com e sem ela, emitem o MESMO chunk até o hash de conteúdo. Uma regra inerte é pior que nenhuma, porque parece estar fazendo alguma coisa (é o precedente do bloco do MapLibre naquele arquivo).
- **O que a migração cobrou, e que não estava previsto:** um namespace de módulo ES não é extensível e não carrega `__esModule`. A primeira propriedade quebra os três remendos que escrevem no objeto `Cesium` (o polyfill de `defaultValue`, o bloqueio do Ion e o próprio viewshed, que pendura `ViewShed3D` ali), e por isso o que se publica é uma CÓPIA rasa. A segunda quebra o interop de webpack DENTRO de `cesium-viewshed.js`: sem a marca, ele lê todo símbolo do Cesium como `undefined` sem lançar em nenhum, não define `ViewShed3D`, e a análise de visibilidade deixa de existir sem uma linha de erro em lugar nenhum, porque `cesium-compat.js` pula a classe ausente pelo próprio `continue` e `viewshed_tool_3d.js` desiste no próprio guarda. Nenhuma suíte deste repositório mudaria de cor: quem achou foi a captura do Playwright, e o que separou regressão de defeito preexistente foi rodar o caminho ANTIGO no mesmo spec.
- **Status:** aceita; em execução. O bump de 1.138.0 para 1.145.0 não exigiu um quarto remendo em `cesium-compat.js`, medido por uma captura que computou um viewshed sobre um tileset real; isso não diz nada sobre o próximo bump, e a 1.139 já anuncia que mais classes virarão classes ES6.

### 2026-09-15: o tutorial vira a QUINTA página do bundler, e o docsify entra pelo npm

- **Decisão (D16, do dono):** o tutorial deixa de ser a página estática `frontend/public/docs/doc.html`, que o `publicDir` copiava verbatim e que carregava o docsify 4.13.1 da pasta de vendors do frontend por tag, e passa a ser `frontend/tutorial.html`, a QUINTA entrada de `rollupOptions.input`, com o entry `frontend/src/js/tutorial/tutorial-page.js`. O docsify vem do npm em `docsify` 5.0.0, versão exata, por um ponto único, `frontend/src/js/vendor/docsify.js`, no modelo de `frontend/src/js/map/maplibre.js`; o CSS do tema vem do próprio pacote, o tema CORE publicado na pasta dist dele. Os dois artefatos que a pasta de vendors guardava para ele (o bundle minificado e a folha do tema vue) foram APAGADOS, e com eles `doc.html`. O markdown e as 42 mídias CONTINUAM em `frontend/public/docs/`, porque são conteúdo e não código. O padrão de `tutorialUrl` muda nos dois pacotes no mesmo commit.
- **Por quê:** é o mesmo argumento de D9 e de V9, e nas mesmas palavras: o custo daquela cópia nunca foi peso, foi CANAL. Eram os dois últimos artefatos de `public/vendors/` COM consumidor, e nenhum `npm audit` os alcançava; a identidade deles só se confirmava por hash contra o jsDelivr, conferência que ninguém ia repetir. Em versão exata, a pergunta de amanhã ("há aviso publicado sobre ela?") volta a ter a quem ser feita. De quebra, a página passa a ser alvo do ESLint, do Stylelint e do chunking da casa, como toda outra.
- **O que isso torna medido em vez de prometido:** o peso da página. Medido em build fresco na estreia, `tutorial.html` sai com 7 arquivos e 499 kB (189 kB do chunk moderno, 241 kB da passada legacy, 76 kB de polyfills legacy), mais 51 kB de CSS, dos quais 50 são o tema do pacote. Ela entrou na tabela `PAGINAS_DIST` de `frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js` com piso e teto, e é a mais leve das cinco; o payload do mapa não se moveu um byte (83 arquivos e 4098 kB, iguais aos de `HEAD`), porque nada dele alcança o docsify.
- **A quinta página não é uma quarta página sem mapa, e essa é a parte que se lê errado:** ela não abre banco, não tem sessão e não fala com o backend, então fica de fora do portão de migração, do tab-lock, da telemetria de erro e de uso, da presença e do leitor de pendências. Cada ausência é decisão com motivo escrito, e o que as sustenta é a classificação em `frontend/tests/unit/portao-de-migracao-nas-quatro-paginas.test.js`, que cobra o outro lado: o entry não pode citar uma porta do acervo (o portão, a varredura de namespaces, a fábrica de stores por escopo, a biblioteca de IndexedDB). Sem esse par, "não precisa de portão" seria uma afirmação sobre o passado.
- **O que a migração cobrou, e que não estava previsto:** o compilador do docsify só reescreve caminho relativo de imagem em sintaxe MARKDOWN, e as 42 mídias do tutorial são HTML cru. Em `/docs/doc.html` o `./images/...` resolvia contra a URL da própria página; em `/tutorial.html`, na raiz, ele vira 404 nas 42, e o sintoma é a página desenhar inteira, com barra lateral e texto, sem uma figura. A correção é um gancho `beforeEach` sobre uma função pura (`frontend/src/js/tutorial/caminhos-de-midia.js`), e não uma reescrita do `README.md`, que é lido também fora do produto e onde o caminho relativo é o certo. Controle negativo executado: com a reescrita desfeita, 5 dos 15 casos de `frontend/tests/unit/tutorial-pagina.test.js` reprovam.
- **Alternativa recusada (1):** manter a página estática e GERAR os dois arquivos de `public/vendors/` a partir do `node_modules` no build. Ela resolveria o pino de versão e abriria um buraco pior: o inventário deriva de `git ls-files`, então ele passaria a NÃO VER código de terceiro que o `dist/` publica, que é exatamente o vazio de escopo que o item V7 de D9 tinha acabado de fechar.
- **Alternativa recusada (2):** fazer do tutorial uma entrada ANINHADA (`docs/doc.html`), que preservaria a URL e dispensaria a reescrita das mídias. Ela colide com o `publicDir`, que copia `public/docs/` para o mesmo lugar, e esconde a página dentro da pasta de conteúdo, onde o próximo leitor a procuraria como conteúdo.
- **Alternativa recusada (3):** importar também o add-on de tema vue que o pacote publica ao lado do tema CORE, sucessor direto da folha apagada. A primeira linha dele é um `@import` de URL absoluta para o serviço de fontes do Google, e o Vite não inlina `@import` absoluto: ele sobreviveria ao build e sairia para a internet a cada abertura, numa rede fechada que não o alcança. A paleta dele (1,5 kB de custom properties) foi reescrita como folha da casa em `frontend/src/css/tutorial.css`.
- **Alternativa recusada (4):** configurar por `window.$docsify`, que é a porta documentada. O global impõe uma ordem que import estático não expressa (a configuração tem de existir antes de o módulo do docsify ser avaliado, e imports são içados), enquanto o argumento do construtor tem prioridade sobre ele no `Object.assign` da configuração do pacote. Fica valendo a nota de armadilha: a pasta lib do tarball da 5.0.0 ainda contém o build da v4, com um `console.warn` de depreciação anexado, então o caminho antigo resolve, roda e quase não avisa.
- **Status:** aceita; em execução. Detalhe em [inventário de vendors](../wiki/inventario-de-vendors.md).
### 2026-09-15: o viewshed 3D é reescrito como código da casa, e o desenho é congelado em pixel antes

- **Decisão (D15, do dono, que fixa o prazo que V3 deixou em aberto):** `frontend/public/vendors/cesium/cesium-viewshed.js` (154.710 bytes ofuscados, 1.933 linhas, sem autor, sem licença, sem versão, acoplado a onze campos privados de `ShadowMap` e carregado por `<script>` injetado em `map_3d.js`) sai, e no lugar entra código da casa sobre a API PÚBLICA do Cesium 1.145, replicando o comportamento inteiro e conferido POR VISÃO a cada passo. A ordem é fixa e é metade da decisão: **primeiro congelar o desenho atual em um teste de pixel**, depois inventariar o que o vendor faz, depois reescrever, depois cobrir de unidade o que for puro. Onde a API pública NÃO permitir reproduzir o desenho, a exigência não é contornar em silêncio: é declarar no cabeçalho qual campo privado sobrou e por quê, e prender cada um com um teste que leia o fonte do Cesium e acuse quando o nome mudar.
- **Por quê:** a dívida que V3 declarou em 2026-09-14 tem juros e um gatilho conhecido (o próximo bump do Cesium), e o custo dela não é peso nem desempenho: é que **ninguém neste projeto jamais leu aquele arquivo**, ele roda com os privilégios da página do produto, e num repositório público por decisão código de terceiro sem licença explícita é, por padrão, todos os direitos reservados. A metade que torna a troca possível é a primeira: até 2026-09-15 a análise de visibilidade era medida só como ENTIDADE, e nenhuma suíte construía um `ViewShed3D`, de modo que trocar o motor e ver a suíte verde não mediria o motor.
- **Alternativa recusada (1):** reescrever primeiro e conferir depois. O aceite de V3 já dizia que a prova é visual e que nenhuma suíte a dá; sem a referência congelada ANTES, "ficou parecido" é a única sentença possível, e ela é a que a constituição chama de chancelar a própria saída.
- **Alternativa recusada (2):** desofuscar o vendor e adotá-lo como código da casa, no modelo do `cesium-measure.js` (V2). Os dois casos não são o mesmo, e tratá-los como um foi o erro que a entrada de V3 corrigiu: o measure eram 27 kB indentados, com nomes de variável reais; o viewshed não tem um único nome com significado, tem vinte blocos de fluxo achatado e um dicionário que transforma o operador `==` em chamada de função. Desofuscar entrega código nosso derivado de um original sem licença, o que não resolve a metade jurídica.
- **Alternativa recusada (3):** adiar até o bump quebrar. É a decisão de 2026-09-14, e ela vale enquanto a dívida está declarada e não urgente; o dono a encerrou fixando o prazo, que era o que faltava.
- **Status:** aceita. O congelamento do desenho está em execução: `frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js` com a referência versionada em `frontend/tests/e2e-ui/__referencias__/viewshed-3d.png`.

### 2026-09-15: o empréstimo por atlas alcança o TILE, e a cláusula 6.7 fecha

- **Decisão (D17, do dono):** implementar por inteiro o empréstimo por atlas no tile vetorial e raster. O cliente carimba o atlas em foco na URL do tile das duas bases credenciadas (`frontend/src/js/map/credencial-de-tile.js`), o gate do `auth_request` lê esse carimbo e avalia o MESMO predicado SQL de empréstimo que a listagem usa (`backend/src/modules/auth/tile-access.js`), e a resposta que dependeu do empréstimo sai `private, no-cache` para o host copiar ao tile (`marcarEscopoDeTile`, `backend/src/utils/cache-scope.js`).
- **O defeito que ela fecha, e ele estava MEDIDO desde 2026-08-29:** o ramo de empréstimo de `fn_granted_resource_ids` depende do atlas em foco, e o gate do tile o lia de `req.query`, que na subrequisição do `auth_request` é sempre vazia. Quem alcançava uma camada privada SÓ pelo empréstimo via o item no payload aditivo do catálogo e recebia 401 nos bytes: a camada aparecia na lista e não desenhava. Isso contradizia a cláusula 6.3 exatamente onde ela mais importa, porque o visitante de link público alcança recurso privado **só** por empréstimo.
- **A CORREÇÃO NÃO PRECISOU DE CABEÇALHO NOVO NO NGINX, e a cláusula prometia que precisaria.** A 6.7 listava três pontas e a primeira era "o nginx repassar o atlas em cabeçalho". Ela não existia: `X-Original-URI` é `$request_uri`, a URI ORIGINAL com a query inteira, e é o cabeçalho que o gate já usava para resolver o CAMINHO desde 2026-08-29. O `?atlasId=` sempre esteve dentro dele, do mesmo jeito que o host já tira a chave de API daquele mesmo texto por um `map`. O que faltava era ler. Vale registrar a forma do erro, que é a mais cara desta linha de trabalho: uma observação verdadeira ("a subrequisição chega sem query") virou uma conclusão falsa ("o atlas não pode atravessar"), e a conclusão foi carregada por dezessete dias como escopo de trabalho.
- **Por que o carimbo vai no `transformRequest`, se o `fileoverview` de `frontend/src/js/street_view_tool/tile-scope.js` ELIMINA esse lugar.** A medição dele continua valendo e a conclusão não se transporta, porque o sujeito é outro. No MVT do 360 o carimbo escolhe CONTEÚDO (o mesmo z/x/y devolve feições diferentes por atlas) e o `TileManager` chaveia o cache por z/x/y, então um tile carregado sob o atlas A seria reentregue dentro do B sem pedido nenhum. No tile de uma camada de dados o carimbo só autoriza a BUSCA: o corpo é o mesmo para todo mundo, e o que o atlas decide é se o gate entrega. O que a reutilização por z/x/y produz ali não é conteúdo de outro escopo, é um tile já baixado continuar na tela depois de trocar de atlas, que é a mesma parcialidade já declarada para a camada viva depois de uma revogação.
- **Alternativa recusada (1):** carimbar cada URL de fonte na montagem do estilo, em vez de no `transformRequest`. É a regra espalhada por N sítios que o próprio `tile-scope.js` condena, e aqui os sítios são quatro famílias de endereço (`source`, `labelSource`, o raster de análise e `style.sources.*` de basemap) que o índice do servidor existe justamente porque já foram esquecidas uma a uma.
- **Alternativa recusada (2):** carimbar só o que for privado, para não fragmentar o cache de borda do tile público. O cliente não sabe quais endereços pertencem a linha privada, e saber exigiria uma segunda cópia de `tile-regime.js` no navegador. O preço fica DECLARADO: com um atlas aberto, todo tile das duas bases sai com `?atlasId=`, o da camada pública inclusive.
- **Alternativa recusada (3):** responder 404 na recusa, como fazem as outras superfícies de recurso. O `auth_request` do nginx entende 2xx, 401 e 403 e trata qualquer outro código como ERRO, então um 404 viraria 500 no cliente. A propriedade que o 404 dá em outras rotas (não confirmar a existência do recurso) já está de pé por outro caminho: caminho não reivindicado e caminho privado que o chamador não alcança respondem o MESMO 401, e a diferença entre eles só é legível em cabeçalho, para o log do host.
- **Alternativa recusada (4):** `no-store` no tile emprestado. Ele mataria também o cache do navegador, e um deslocamento de mapa rebaixaria a camada privada inteira à rede outra vez; `private` já proíbe a guarda em cache compartilhado, que é a exposição real.
- **O que continua sendo sonda com data no deploy:** que o host copie o regime de cache da subrequisição para o tile, e que ele esconda o `Cache-Control` do servidor de tiles caso este emita um próprio na linha privada. Nada neste repositório prova o que o nginx de produção faz, e o `location` do ambiente de medição (`dev/tile-privado/nginx/ebgeo.conf`) foi atualizado para a forma que a sonda deve conferir.
- **Uma armadilha de configuração que só apareceu ao medir:** `TILE_SERVER_URL` é uma BASE (`/tiles`, `http://host/tiles`), nunca um template com `{z}`. Escrita como template, a comparação por fronteira de caminho do cliente não casa nada e o carimbo fica inerte, calado, a camada emprestada volta a não desenhar, sem erro em lugar nenhum.
- **Guardas:** `frontend/tests/unit/tile-carimba-atlas-emprestado.test.js` (o carimbo e o controle negativo de host de terceiro), `backend/tests/integration/tile-emprestimo-por-atlas.test.js` (os quatro caminhos do gate mais o regime de cache) e `frontend/tests/e2e/tile-emprestimo-contrato.e2e.test.js` (a URL que o cliente monta é a que o servidor lê). Controle negativo executado nos três: revertido o carimbo, 6 casos do unitário e 2 do contrato reprovam; revertida a leitura do atlas no gate, 6 casos da integração reprovam.
- **Status:** aceita; em execução. A cláusula 6.7 passa a **vigente**. Detalhe em [tile privado](../wiki/tile-privado.md) e em [acesso a recurso privado](../wiki/acesso-a-recurso-privado.md).

### 2026-09-16: o cursor de presença ganha SUPERFÍCIE, e o apply remoto de documento lateral passa a tomar a trava

- **Contexto (do dono):** "quero que tenha presença do mouse e poder ver o mouse dos outros no 360", "quero presença/mouse no 3d também", e o relato de que a criação e a exclusão de marcador falhavam em sincronizar, com o 3D "não mostra ao criar, tem que sair e entrar no 3D para aparecer". As duas metades são independentes e foram medidas separadamente.
- **Decisão 1, o cursor por superfície:** o quadro `cursor` passa a carregar `surface` (`2d`/`3d`/`360`) e a mesma chave de escopo que a `selection` já tinha (`mapId`, `tilesetId`, `photoName`), e a POSIÇÃO muda de forma junto: `{lng,lat}` no mapa, `{heading,pitch}` na esfera do panorama, `{lng,lat,alt}` no ponto picado da cena 3D. Cada superfície tem a régua dela no servidor (`Joi.when('surface')`), porque `validatePresenceFrame` usa `stripUnknown` e um schema permissivo APAGA em silêncio o que não declara.
- **Por que não trafega pixel:** cada par olha o panorama de um yaw/pitch/FOV próprio e a cena 3D de uma câmera própria, então a coordenada de tela de um significa outra direção na tela do outro. O cursor apareceria plausível e apontando o lugar errado, que é pior do que não aparecer. Guarda: `frontend/tests/unit/streetview-cursor-remoto.test.js` faz a ida e volta (tela → esfera → tela) e exige que o MESMO ponto da esfera caia em pixel diferente para quem olha de outro ângulo.
- **Alternativa recusada (1):** um tipo de quadro novo por superfície (`cursor360`, `cursor3d`). Multiplicaria por três o roteamento dos dois lados, a lista de coalescáveis, a retenção no socket e o snapshot, para transportar a mesma coisa; a `selection` já tinha resolvido isso com um campo.
- **Alternativa recusada (2):** uma janela de throttle por superfície. O usuário aponta uma coisa de cada vez (as cenas imersivas cobrem o mapa) e o servidor guarda UM cursor por `clientId`: duas janelas só produziriam dois quadros disputando a mesma gaveta. O valor pendente é o QUADRO inteiro, e não só a posição, senão o envio atrasado de uma superfície sai rotulado como o da outra no instante da troca.
- **Decisão 2, a trava do documento lateral no caminho inbound:** `applyRemoteMarker360Op`, `applyRemoteOrientation360Op`, `applyRemoteCesium3dEntityOp`, `applyRemoteCameraOp`, o carimbo de revisão e a gravação de side-store do snapshot passam a rodar dentro de `withSideDocument`, com a MESMA chave do escritor local.
- **O defeito que ela fecha:** `serializeGuardedApply` serializa remoto contra remoto e nunca remoto contra local, e os dois lados fazem read-modify-write assíncrono do documento inteiro. A op do par que caísse dentro da janela de um `addMarker360`/`addMarker` local devolvia ao disco a versão lida antes, e a perda era silenciosa nos dois sentidos: o marcador recém-criado sumia e o recém-apagado voltava. Só o comentário tomava a trava dele, e o cabeçalho de `document-lock.js` já declarava o risco para 3D e 360 ("medido: 20 `addComment` concorrentes persistiram 1").
- **Decisão 3, a cena repinta ao receber a operação:** o visualizador 3D passa a assinar `MARKERS_3D_CHANGED` e reconciliar por `syncMarkersFromStore`, com 80 ms de coalescência. Ele NÃO reusa `refreshMarkersForCurrentTileset`, que limpa a cena e desseleciona: isso é correto numa troca de mapa e seria uma regressão aqui, porque tiraria o painel do usuário da frente dele a cada operação de um colega.
- **Alternativa recusada (3):** deixar o 3D como estava e documentar que é preciso reabrir. É a versão do produto que o dono reprovou em voz alta, e o mapa 2D já tinha fechado o mesmo buraco em `layers/remote-feature-render.js`.
- **Guardas e controle negativo:** `frontend/tests/integration/streetview360-write-ahead.test.js` (dois casos novos, com a intercalação perdedora FORÇADA por um portão, nunca sorteada: revertida a trava, os dois reprovam), `frontend/tests/integration/marcador-3d-cena-ao-vivo.test.js` (seis casos, o primeiro teste da história a importar `marker_tool_3d.js`; cortado o fio do evento, o caso que o mede reprova), `frontend/tests/unit/streetview-cursor-remoto.test.js`, `backend/tests/ws/collab-presence-payload-bound.repro.test.js` (a recusa da posição da superfície errada) e os casos novos em `presence-store`, `presence-bridge` e `remote-cursors-layer`.
- **Prova visual, com dois navegadores reais contra o acervo desta máquina:** na tela do segundo usuário aparecem o cursor rotulado do primeiro e o marcador que ele criou, sobre o panorama real do projeto `museu_cms`, e o marcador some quando o primeiro o apaga. No 3D o cursor rotulado do colega aparece na cena; o modelo não desenhou no ambiente de captura porque a imagery e o terreno não respondem ali.
- **Status:** aceita.

---

### 2026-09-17: o botão do meio gira e inclina o mapa, sem tecla nenhuma

- **Contexto:** o gesto de câmera por mouse exigia modificador (decisão de 2026-09-01: Ctrl inclina,
  Shift rotaciona, Ctrl+Shift faz os dois), e o dono pediu a versão sem tecla: "queria tb uma versão sem
  shift e ctrl com o botão do meio". A pergunta que ele fez primeiro tem resposta medida: o MapLibre NÃO
  permite configurar isto. Na 6.9.1 instalada, o botão de cada gesto é um literal dentro da fábrica do
  handler (os nomes do vendor, escritos sem crase porque não existem neste repositório: a fábrica
  generateMouseRotationHandler traz um checkCorrectEvent que aceita o botão esquerdo com Ctrl ou o botão
  direito, e nada mais), não há opção que o altere, e o gerenciador de handlers do mapa só expõe a lista
  interna deles. O app não depende disso porque declara `dragRotate: false` em `createMap` e traz o
  gesto próprio desde 2026-09-01.
- **Decisão:** `resolveDragMode` passa a devolver `DRAG_MODE.BOTH` para `button === 1`, ANTES da recusa
  por botão, e sem olhar modificador nenhum: o botão do meio é o gesto inteiro e responde igual com Ctrl,
  Shift ou Meta apertados. O botão do meio é o único livre no mapa (o esquerdo seleciona e arrasta, o
  direito abre o menu de contexto e encerra desenho em andamento). O `preventDefault` que já existia no
  `mousedown` mata o autoscroll do Windows de graça.
- **O que a mudança QUEBRAVA, e é a parte que só o handler vê:** `_onMouseUp` comparava o botão solto com
  o esquerdo FIXO e ignorava os demais, o que era certo para um clique com o direito não encerrar um
  arrasto do esquerdo (encerrar reabilita o `dragPan` com o esquerdo ainda apertado, e o MapLibre retoma a
  panorâmica do ponto velho). Com o botão do meio arrastando, a mesma linha faz o `mouseup` dele ser
  ignorado e o gesto NUNCA terminar: o mapa segue girando com o botão solto e o `dragPan` fica
  desabilitado, sem nada no console. O handler passa a guardar o botão que começou, e só ele termina. Pelo
  mesmo motivo, a engolida do clique sintético passa a ser de `auxclick` quando o gesto foi do meio, que é
  o evento que esse botão dispara.
- **Alternativas rejeitadas:**
  - *Trocar o predicado interno do MapLibre* (alcançar os `DragHandler` dentro de `map.dragRotate` e
    reescrever o predicado de botão deles, outro nome do vendor): três linhas, e nenhum contrato. Quebra numa atualização de menor
    versão sem aviso, e o app já tem o gesto próprio, que é onde a decisão pertence.
  - *Mapear o botão do meio para um eixo só*: o pedido é girar E inclinar, e o gesto sem tecla é o que
    precisa ser completo justamente porque não há modificador para escolher o eixo.
- **Guardas e controle negativo:** `frontend/tests/unit/drag-rotate-model.test.js` (bloco novo do botão do
  meio: ele basta sozinho, ignora todo modificador, e o `'1'` de evento sintético não vale) e
  `frontend/tests/unit/drag-rotate-botao-do-meio.test.js` (onze casos sobre o HANDLER, com `window` e o
  container do mapa duplicados). Controle negativo executado em 2026-09-17: devolvendo `e.button !== 0` ao
  `_onMouseUp`, reprovam os TRÊS casos do fim do gesto (a câmera continua andando com o botão solto, o
  `dragPan` não volta, e a engolida é armada no evento errado) e os oito restantes seguem verdes.
- **Prova visual, contra o ambiente real, com o botão do meio de verdade:** bearing de 0 para -60 e pitch
  de 0 para 27 num arrasto só; soltando o botão, mover o ponteiro por mais 400 px não mexe a câmera; e a
  panorâmica com o esquerdo volta a funcionar logo depois (o centro muda). O modal de atalhos mostra
  "Botão do meio+Arrastar", com a descrição "Inclinar e rotacionar, sem tecla".
- **Status:** aceita.

---

### 2026-09-19: o comentário da cena caminhável reusa a entidade do mapa, e a barra lateral vira a porta única

- **Contexto (do dono):** presença e comentário dentro da cena de primeira pessoa, como já existiam no mapa,
  no 3D e no 360.
- **Decisão 1, a entidade:** o comentário da cena caminhável é o MESMO comentário espacial do mapa, com o
  mesmo cartão compartilhado. A superfície nova de primeira pessoa (`SUPERFICIE`,
  `frontend/src/js/comment_tool/comment-card.js`) carrega `x`, `y`, `z` em METROS no referencial da cena, e
  a referência de recurso continua sendo o `tilesetId` do catálogo.
- **Por quê, e é o ponto que decide tudo:** a cena É uma linha do catálogo de modelos, então apontar para
  ela pelo `tilesetId` faz o comentário entrar de graça na poda de recurso privado da exportação e do
  compartilhamento, e nas permissões de sync. Metro no referencial da cena não é coordenada geográfica
  disfarçada: reprocessar o museu mudando o referencial exige outro recurso ou transformação explícita das
  âncoras, e trocar os bytes não transforma âncora nenhuma.
- **Alternativa recusada (1):** uma chave de cena própria, fora do catálogo. Ela escaparia da poda de
  recursos privados nas duas saídas (o `.ebgeo` e o clone), que é exatamente o que o registro de referências
  existe para impedir.
- **Decisão 2, a porta única:** o botão de novo comentário da barra lateral passa a atender a superfície
  ABERTA (2D, Cesium, 360 ou primeira pessoa), e os botões separados de comentário do 360 e do Cesium
  saíram. A primeira pessoa não ganhou botão próprio nem atalho de teclado.
- **Alternativa recusada (2):** um botão por visualizador, que era o desenho anterior. Com quatro
  superfícies ele vira quatro cópias do mesmo gesto, cada uma com o próprio caminho de recusa; a barra
  lateral já sabe qual superfície está aberta.
- **Decisão 3, a presença:** o quadro de presença da cena carrega a câmera da CAMINHADA, inclusive com o
  usuário parado, e nunca o ponto que o mouse acerta. Os pares são filtrados por socket de atlas, mapa e
  cena; fechar a cena ou trocar de contexto descarta a sobreposição e limpa a pose anunciada.
- **Por quê:** é a mesma razão da decisão de 2026-09-16 sobre o cursor por superfície: cada par olha a cena
  de uma câmera própria, então o que só faz sentido compartilhar é a posição do observador. O comentário, ao
  contrário, usa o raio contra a colisão, porque ali o alvo é um ponto do mundo e não um ponto de vista.
- **Guardas:** `frontend/tests/unit/collaboration-fp.test.js`.
- **Status:** aceita; detalhe em [primeira pessoa 3D](../wiki/primeira-pessoa-3d.md).

### 2026-09-19: a etiqueta de presença passa a dizer posto e nome de guerra

- **Decisão:** as etiquetas de posição das QUATRO superfícies passam a mostrar posto abreviado mais nome de
  guerra (por exemplo, "Maj Diniz"), com o nome de guerra numa coluna opcional própria
  (`users.nome_guerra`, hoje em `backend/src/database/migrations/001_identidade_e_credenciais.sql`), separada do nome completo. A autenticação e as
  duas listas de presença (a viva e a inicial) passam a carregar o campo.
- **Por quê separar a coluna, em vez de derivar do nome completo:** não existe regra que extraia nome de
  guerra de nome completo, e toda heurística erraria de forma constrangedora numa etiqueta que o colega lê.
- **Degradação declarada:** conta antiga cai no nome que já existia até alguém editar o cadastro. Não há
  backfill, e ele seria adivinhação.
- **Status:** aceita.

### 2026-09-19: o TEXTO de um comentário é do autor, e a hierarquia não o alcança

- **Contexto (do dono):** pedido explícito de que editar o texto alheio não fosse capacidade de ninguém.
- **Decisão:** editor, gestor, dono do atlas e administrador global NÃO editam o texto de um comentário ou
  de uma resposta de outra pessoa. A hierarquia continua regendo a MODERAÇÃO (resolver, reabrir, excluir),
  que é outra capacidade.
- **Por quê a separação, e não um nível a mais na escada:** moderar é decidir o que fica visível, e isso é
  gestão do atlas; reescrever o texto é falar pela boca de outra pessoa, e nenhum nível de atlas compra
  isso. Juntar as duas numa capacidade só daria ao gestor uma autoridade que o produto nunca quis conceder.
- **Alternativa recusada:** deixar a escada reger também o texto, como regia antes. Ela é uma linha mais
  curta de código e transforma todo co-Gestor num revisor invisível do que os outros escreveram.
- **Onde o gate mora:** o cartão compartilhado e a store local impõem a autoria no cliente; o servidor
  recusa a edição alheia em `commentEditDenialReason` (`backend/src/modules/sync/sync.service.js`), ANTES
  do log da operação e do broadcast, comparando com a coluna de autor guardada, depois de os patches de
  revisão estarem preparados. A moderação de status preserva o corpo guardado, inclusive para cliente
  antigo que mande o objeto de comentário inteiro.
- **Guardas:** `backend/tests/integration/comments-manage-tier.test.js` e
  `frontend/tests/unit/collaboration-fp.test.js`.
- **Status:** aceita.

### 2026-09-19: o contorno de um polígono vira linha ou limite, e o que se perde é nomeado

- **Decisão:** a engrenagem da feição passa a oferecer conversão de polígono para linha e para limite, pelo
  executor de conversão que já existia, com as permissões, o lote de desfazer e o gesto de sync dele. O
  contorno conserva o segmento de fechamento, o nome, a descrição, a camada, os atributos, as observações
  de segmento e o intervalo temporal; a conversão para linha conserva o estilo tracejado.
- **Decisão 2, a foto:** as fotos anexadas são copiadas em profundidade a cada conversão, em vez de
  descartadas em silêncio. Descartar era o comportamento anterior e é a forma de perda que ninguém percebe
  na hora, porque a feição nova desenha certa.
- **O que sai, e sai nomeado:** preenchimento, hachura e rótulo de área, pelo aviso de conversão que já
  existia; as fontes de rótulo de polígono são reconstruídas.
- **Por quê a opacidade do contorno fica em 1:** é o que o desenho de polígono já fazia, e ela é
  independente da opacidade de preenchimento. Herdar a do preenchimento produziria uma linha quase
  invisível a partir de um polígono translúcido, sem nada explicando.
- **Alternativa recusada:** aceitar buraco e multipolígono, descartando anéis ou partes. Eles são recusados
  EXPLICITAMENTE, porque a conversão silenciosa de uma geometria composta numa simples perde dado sem
  nenhum ponto da tela onde a pessoa pudesse notar.
- **Guardas e controle negativo:** regressão com Turf real, que confere o perímetro menos a folga do símbolo
  e a cobertura da aresta de fechamento, e reprova na implementação anterior; verificação em navegador da
  conversão pela engrenagem, da chegada num segundo cliente e do desfazer.
- **Status:** aceita.

### 2026-09-19: a tecla à esquerda do 1 cicla os mapas base

- **Decisão:** a tecla FÍSICA Backquote (à esquerda do 1, apóstrofo no ABNT2) cicla os mapas base
  habilitados pelo manipulador de troca que o seletor já tinha, voltando ao primeiro no fim da lista.
- **Por quê a tecla física e não o caractere:** o caractere que ela produz muda com o layout, e o gesto é
  posicional ("a tecla à esquerda do 1"), não alfabético.
- **O que suprime o atalho:** foco em campo de texto, modificador, composição, repetição de tecla, troca já
  em andamento, e o mesmo gate de edição do mapa que os outros atalhos consultam.
- **Status:** aceita.

### 2026-09-19: travar um mapa remoto é ato de GESTÃO, e não mais exceção do dono

- **Contexto (do dono):** pedido de que gestor e dono pudessem travar e destravar mapas remotos.
- **Decisão:** bloquear e desbloquear mapa remoto passa a exigir gestão ou acima, pela hierarquia que já
  existe, nos TRÊS pontos: o controlador, a capacidade da store e a autorização de sync do servidor
  (`operationDenialReason`, `backend/src/modules/sync/sync.service.js`, que compara por posto e nunca por
  igualdade). O cadeado NÃO é desenhado para quem está abaixo, e a visibilidade dele é refeita a cada
  mudança de sessão. Mapa local continua inteiramente sob controle de quem o tem.
- **Alternativa recusada:** a exceção anterior, `owner` estrito. Ela é a lista fechada que a constituição
  proíbe, na forma mais cara: excluía o co-Gestor em silêncio de um ato que é a definição de gestão.
- **A ponta que o gate de update sozinho não fecha:** a CRIAÇÃO de mapa por editor não pode contrabandear
  um estado já travado, e por isso o gate olha o campo nas duas portas (create com `locked === true` e
  update com `locked` presente).
- **Por que o controlador conserva o estado anterior na recusa:** a permissão pode mudar entre o desenho do
  botão e o clique, e a op de store devolve o mesmo valor no sucesso e na recusa; sem conservar, a tela
  anunciaria um sucesso fabricado sobre uma trava que não foi gravada.
- **Guardas:** `backend/tests/integration/sync-authz-lock.test.js`,
  `backend/tests/integration/sync-manage-tier.test.js` e
  `frontend/tests/e2e-ui/browser-collab-lock.spec.js`.
- **Status:** aceita.

### 2026-09-19: referência de mapa base vazia continua vazia

- **Decisão:** ao gravar a criação de um mapa, uma referência de base ausente ou vazia permanece vazia, em
  vez de receber o padrão histórico. Catálogo vazio, portanto, não inventa acesso a recurso nenhum.
- **Por quê:** o padrão histórico pode ser um recurso PRIVADO, e escrevê-lo por omissão concede, por
  default, um acesso que ninguém conferiu. A falha correta aqui é FECHADA: mapa sem base desenha vazio e a
  pessoa escolhe; mapa com base que ela não enxerga desenha quebrado e não diz por quê.
- **Status:** aceita.

### 2026-09-19: a seleção remota CARREGA a ferramenta, e não a ativa

- **Decisão:** ao receber a seleção de um colega sobre uma feição cuja ferramenta ainda não foi carregada,
  o cliente resolve o tipo pelos descritores de fonte registrados, lê a FEIÇÃO primeiro e carrega apenas a
  ferramenta correspondente, só para construir o contorno. Ele NÃO ativa a ferramenta e NÃO seleciona nada
  para o usuário que recebe.
- **Por quê:** presença é informação sobre o outro, nunca comando sobre mim. Ativar a ferramenta do colega
  trocaria o gesto em andamento de quem só estava olhando, que é a regressão que a decisão de 2026-09-16 já
  recusou no 3D pelo mesmo argumento.
- **Quadro legado:** quadro sem tipo reconhecido segue a MESMA busca pela fonte primeiro, em vez de ganhar
  um caminho próprio que envelheceria sozinho.
- **O que a guarda de geração preserva:** carga que chegue TARDE, depois de a seleção ser desfeita ou a
  cena desmontada, é descartada; e uma seleção que chegue ANTES da feição dela é retentada na próxima
  atualização de fonte.
- **Guardas:** `frontend/tests/e2e-ui/browser-collab-selection-tools.spec.js` (varredura derivada dos tipos
  selecionáveis, conferindo a CAMADA desenhada do MapLibre e não a entrada no store de presença),
  `frontend/tests/unit/remote-selections-passe-de-zoom.test.js` e
  `frontend/tests/unit/selection-box-legacy-lines.test.js`.
- **Status:** aceita.

### 2026-09-19: quem desativa um controle solta o cursor DELE, nunca o da tela

- **Decisão:** a limpeza de um controle de mapa libera apenas as interações que ele mesmo tomou e preserva
  o cursor da ferramenta que já está ativa; o arrasto só devolve a panorâmica quando cancela um arrasto
  PRÓPRIO. Sobreposição de catálogo (modelo 3D, rota 360, pino de panorama, pino de foto salva) cede a
  posse do cursor à ferramenta de mapa ativa.
- **Por quê:** `toolActivated` chega DEPOIS de a ferramenta nova já ter posto o cursor dela, então um
  controle inativo que "limpe o cursor" nesse evento apaga o da ferramenta que acabou de assumir. A regra
  que resolve não é de ordem de evento, é de posse: cada um solta o que tomou.
- **Consequência para escrita assíncrona:** ouvintes e cursor se liberam de forma SÍNCRONA. Um salvamento
  que espere por um nome antes de soltá-los apaga o cursor de uma ferramenta escolhida durante a espera.
- **Guardas:** `frontend/tests/e2e-ui/toolbar-cursors.spec.js` e
  `frontend/tests/unit/trajectory-cursor-ownership.test.js`.
- **Status:** aceita.

### 2026-09-19: o token de confirmação prova a CAIXA POSTAL, não a conta

- **Contexto:** o token de confirmação referenciava apenas a conta, enquanto o fluxo dizia provar posse de
  um endereço. Corrigir o endereço depois da emissão fazia uma prova antiga aprovar OUTRO destinatário.
- **Decisão 1, confirmação:** o link de confirmação só confirma o endereço para o qual foi enviado, e só
  enquanto a conta estiver ativa.
- **Decisão 2, recuperação:** o código de recuperação exige o mesmo endereço ainda confirmado E o mesmo
  corte de sessões da emissão, de modo que trocar a senha ou revogar todas as sessões o invalida. Emissão e
  resgate são serializados por conta antes de travar o código, e substituir um código é TRANSACIONAL.
- **Por quê a atomicidade, e não só uso único no resgate:** uso único no resgate protege contra reuso e não
  contra duas emissões concorrentes, que é o caso em que a segunda sobrescreve a primeira no meio e as duas
  se anunciam válidas. Falha de emissão preserva uma resposta externa uniforme, para não transformar o
  endpoint num oráculo de existência de conta.
- **Custo declarado da migração:** as duas colunas de vínculo de `email_verification_tokens`
  (hoje em `backend/src/database/migrations/001_identidade_e_credenciais.sql`) preservam contas e credenciais, mas
  links de confirmação e códigos de recuperação ANTERIORES não têm como ter o vínculo original
  estabelecido, e exigem novo envio.
- **O que NÃO muda:** a reserva indefinida do cadastro pendente e a política de organização auto-declarada
  continuam como estavam.
- **Decisão 3, produção:** habilitar o autocadastro em tempo de execução, pelo painel, passa a exigir a
  MESMA configuração de SMTP e URL base que a inicialização já exigia. Um override antigo não contorna.
- **Guardas:** `backend/tests/integration/self-registration-audit.test.js` e
  `backend/tests/integration/password-recovery-audit.test.js`.
- **Status:** aceita.

### 2026-09-19: a importação de atlas com imagem prepara antes de publicar, e a rota antiga recusa quem trouxer imagem

- **Decisão:** as três portas que criam atlas de servidor a partir de um acervo local (o `.ebgeo` na lista
  de atlas, o envio de um cartão local e "Salvar atlas local no servidor") deixaram de subir o atlas e só
  depois os blobs. Elas registram uma tentativa, mandam os bytes para uma área privada por conta e
  confirmam num commit só, que publica atlas, entidades, descritores de imagem, recibo e trilha juntos
  (as tabelas de importação, hoje em `backend/src/database/migrations/003_atlas.sql`, `commitImport` em
  `backend/src/modules/atlas/import-attempt.service.js`). A identidade da tentativa é do cliente e o que
  ele persiste é só a chave de recuperação (`atomicServerImport`,
  `frontend/src/js/import_export/atomic-server-import.js`), de modo que resposta perdida se resolve LENDO o
  recibo em vez de criar um segundo atlas. A importação LOCAL de `.ebgeo`, substitutiva e aditiva, ganhou a
  mesma forma no navegador: prepara num namespace que nenhum registro nomeia e publica por UMA escrita
  (`importLocalAtlasAtomically`, `frontend/src/js/store/local-atlas.api.js`).
- **Por quê:** medido em 2026-09-07 cortando a rede na subida, o import respondia 201 com o atlas inteiro e
  ZERO imagens, e o usuário ficava com um acervo mudo na lista do servidor e a frase "Failed to fetch" na
  tela. Quem separa criação de conteúdo compra, por construção, um desfecho que nenhuma mensagem conserta,
  porque reenviar cria um SEGUNDO atlas.
- **Isto SUPERA metade da decisão D4 de 2026-09-13**, que recusou a preparação durável no servidor para o
  lote de sync e a deixou escrita como "fica para importação grande, fora do lançamento". Ela é exatamente
  esta e foi feita. O lote lógico do sync continua resolvido por savepoint, sem preparação: a troca vale
  onde o gesto é um acervo inteiro, não onde é um punhado de ops.
- **A rota antiga recusa quem trouxer imagem, e o discriminante não é a rota.** `importAtlas`
  (`backend/src/modules/atlas/atlas.service.js`) lança quando `importImageIds` acha referência a original E
  a função de transação recebida é a padrão, isto é, quando a chamada não veio de dentro do commit da
  preparação. A frase manda atualizar a página porque o alvo é a ABA VELHA, aberta antes da implantação,
  que de outro modo seguiria publicando atlas pela metade. A consequência de implantação é simétrica nos
  dois sentidos, então migre e publique juntos.
- **Nada parcial sobe, e o preço tem nome.** Feição que o transform descartaria, original ausente e imagem
  fora da allowlist do servidor recusam o envio INTEIRO, antes de qualquer escrita de rede, nas três
  portas. O caso que surpreende é o ícone personalizado em SVG: ele cai em `skipped` por `buildImageUploads`
  (`frontend/src/js/import_export/atlas-image-upload.js`), e um atlas que tenha um deles passou a não ter
  caminho nenhum para o servidor até que o ícone saia. Antes ele subia sem o ícone.
- **E O ÍCONE EM SVG PASSOU A SER CONVERTIDO, NÃO RECUSADO** (decisão do dono, no mesmo dia, sobre o
  efeito acima). Na preparação do envio o SVG é rasterizado para PNG no navegador
  (`rasterizeSvgToPng`, `frontend/src/js/import_export/svg-to-png.js`, alcançado só por `import()` de
  dentro de `buildImageUploads`) e sobe como PNG **sob o mesmo id**, porque a rota bulk preserva o
  `localId` como id no servidor e toda feição referencia o ícone por esse id em `markerSymbol`. O
  servidor continua SEM SVG: a allowlist é png/jpeg/webp e a razão dela (XSS armazenado) não mudou. O
  registro LOCAL não é reescrito, então o disco de quem enviou continua guardando o vetor; só o blob
  que VIAJA muda de formato. O tamanho sai do `width`/`height` ou do `viewBox`, com teto de 256 px no
  maior lado e piso de 16, e entre os dois é verbatim, que é o que faz o par desenhar do mesmo tamanho
  que o autor. SVG que não decodifica (marcação quebrada, referência externa que contamina o canvas)
  continua em `skipped`, agora com motivo, e o envio segue recusado: a conversão falha ALTO, porque um
  PNG em branco subiria sob um id válido e nada a jusante o distinguiria de um ícone de verdade.
- **Alternativas recusadas para o SVG:** manter a recusa nomeando o ícone, que troca a perda por uma
  instrução ("apague o ícone e refaça o marcador") sobre um acervo que a pessoa não montou para isso; e
  subir sem o ícone avisando, que é o regime anterior com uma frase em cima e contraria "nada parcial
  sobe", a propriedade que esta entrada inteira comprou.
- **Guardas do SVG:** `frontend/tests/unit/icone-svg-rasteriza-no-envio.test.js` (a conversão com
  rasterizador injetado, a aritmética do tamanho e o controle negativo sem rasterizador) e o caso
  "ícone personalizado em SVG" de `frontend/tests/e2e-ui/browser-save-local-to-server.spec.js`, que lê
  do Postgres a linha de `images` do atlas publicado e exige `image/png` sob o id que a feição nomeia.
- **Limites declarados:** um encerramento abrupto do processo do servidor pode deixar arquivo no disco sem
  linha que o referencie, e não há coleta; é o mesmo custo que este módulo já aceita no blob órfão. Atlas
  parciais criados por versões anteriores não são reparados. A aditiva continua recusada dentro de atlas
  remoto.
- **Alternativa recusada:** manter o envio em duas etapas e melhorar a frase de erro. Ela troca uma perda
  por uma explicação, e a explicação certa seria "reenvie e aceite dois atlas".
- **Guardas:** `backend/tests/integration/atomic-atlas-import.test.js`,
  `frontend/tests/unit/atomic-server-import.test.js`, `frontend/tests/e2e-ui/atomic-import.spec.js`.
- **Status:** aceita; detalhe em [import de atlas offline](../wiki/atlas-import-offline.md) e
  [namespace por atlas](../wiki/namespace-por-atlas.md).

### 2026-09-19: abrir atlas de servidor deixa de apagar o cache, e a falha de abertura não rebaixa mais a origem

- **Decisão:** o caminho normal de `openRemoteAtlas` (`frontend/src/js/account/open-atlas.service.js`)
  deixou de chamar `clearAllDataStore` e passou a chamar `resetAtlasView`
  (`frontend/src/js/store/store.js`), que zera apresentação e caches em memória e não toca IndexedDB
  nem a fila. O wipe sobrevive num ramo só, o descarte EXPLICITAMENTE confirmado de trabalho
  resgatado (`confirmDiscardingRescuedWork`), e ali com `clearQueue: true`. No `catch`, o
  `markStoreLocal()` saiu: a origem continua REMOTA e o que se desfaz é a conexão
  (`disconnect({ forgetAtlas: true })`) mais a reivindicação da aba (`retractAtlasClaim`).
- **Por quê, metade um:** o wipe acontecia ANTES do `connect`, então um 403, um 404 ou uma queda de
  rede apagava a última projeção completa e os bytes de imagem ainda recuperáveis, e a pessoa ficava
  sem o atlas de servidor e sem o cache dele. Apagar deixou de ser necessário quando o retrato passou
  a entrar numa GERAÇÃO: `applyRemoteSnapshot` prepara os nove bancos de dado sob
  `__generation-<uuid>` e só ao fim publica `{active, cursor}`, de modo que a geração nova já é a
  substituição e a anterior continua sendo o que todo leitor resolve enquanto o pull não terminar. O
  que o wipe ainda fazia era destruir a rede de segurança antes de saber se havia rede nova.
- **Por quê, metade dois:** rebaixar a origem para LOCAL num erro de rede transformava dado de
  servidor em área de trabalho irrestrita, onde a edição não passa por gate de permissão nenhum e
  depois tenta subir. Retentar um atlas morto a cada F5, que era o motivo declarado do rebaixamento,
  custa um pedido; o rebaixamento custa o contrato de permissão.
- **Preço declarado:** o atalho de "esta geração já contém este retrato" (`activeGenerationHolds`)
  passou a ser derrotado quando a fila tem intenção PREPARADA, senão uma intenção gravada e não
  materializada antes do fechamento ficava fora de replay para sempre, já que ela não move a versão
  do servidor. É a condição `hasPrepared` no topo de `applyRemoteSnapshot`
  (`frontend/src/js/store/sync/remote-operation-handler.js`).
- **Alternativa recusada:** manter o wipe e reconstruir a projeção depois de um erro. Ela reintroduz
  a janela inteira entre apagar e receber, que é exatamente onde a rede falha.
- **Guardas:** `frontend/tests/integration/tab-lock-atlas-integration.test.js` (a ordem
  `activateRemoteAtlas`, `resetAtlasView`, `markStoreRemote`, `connect`) e
  `frontend/tests/integration/namespace-remoto-fiacao.test.js`.
- **Status:** aceita.

### 2026-09-19: a barreira de logout passa a cobrir TODO namespace do censo, sob um prazo só

- **Decisão:** `confirmLogoutWithPendingWork` (`frontend/src/js/session/confirm-logout.js`) deixou de
  tomar a barreira do escopo ATIVO e passa a tomá-la de CADA atlas de servidor que o censo cobre. A
  lista é derivada antes do pedido (`remoteEntriesToDiscard`, o mesmo conjunto que a contagem usa e
  que `requestRemoteAtlasDiscard` marca) e convertida em escopos por `barrierScopesFor`, que mantém o
  ativo dentro mesmo quando um atlas local reivindica o namespace dele. Quem pede é
  `holdLogoutBarriers` (`frontend/src/js/store/write-coordinator.js`): exclusivos em PARALELO, com um
  prazo ÚNICO de `BARRIER_DRAIN_TIMEOUT_MS` para o conjunto, nomes deduplicados, e soltura de todos
  ao cancelar. `holdLogoutBarrier` continua existindo como a forma de um escopo só.
  `enterCoordinatedWrite` não mudou: ela já toma o nome do escopo em que a escrita acontece.
- **Por quê:** a guarda estava apontada para o lado errado, e isso só apareceu medindo com duas abas
  reais. A barreira é nomeada por escopo, mas o censo conta `listRemoteAtlases()` inteiro e o descarte
  marca todos, e a regra do dono do tab-lock diz que duas abas no MESMO atlas colidem. Logo, a irmã
  que a barreira recusava era sempre uma aba BLOQUEADA, atrás de um overlay de tela inteira e sem
  gesto possível, enquanto a irmã que ela deixava passar era a que seguia VIVA em outro atlas de
  servidor, com barra de ferramentas. Medido: com o diálogo aberto, essa aba desenhava um ponto pela
  UI e a fila dela crescia DEPOIS do censo que o diálogo acabara de imprimir. O `fileoverview` do
  coordenador justificava a barreira exatamente com o fato que ela não cobria.
- **Por que o prazo é UM só:** N prazos em série fariam a espera do diálogo crescer com o número de
  atlas de servidor que a pessoa tenha na máquina, num diálogo cujo trabalho é responder depressa
  quanto se perde. O conjunto drena dentro da janela ou a contagem vira desconhecida, que é o mesmo
  veredito honesto de antes.
- **Preço declarado:** a lista é lida ANTES da barreira, então entre a pausa por aba e o pedido
  exclusivo passam as duas leituras de registro que o censo faria de qualquer jeito. A contagem
  continua acontecendo DEPOIS da concessão, que é a ordem que a torna crível. E a deduplicação não é
  higiene: o escopo ativo costuma estar no censo, e pedir o mesmo nome duas vezes faria a barreira
  esperar por ela mesma até o prazo e relatar "não drenou" sem ninguém escrevendo.
- **Alternativa recusada:** manter a cobertura só do escopo ativo e reescrever a justificativa do
  `fileoverview` para descrever o que o código fazia. Ela deixaria de pé uma barreira que recusa quem
  não consegue escrever e libera quem consegue, isto é, o custo do mecanismo sem a propriedade.
- **Guardas:** o caso L3 de `frontend/tests/e2e-ui/browser-logout-barrier-two-tabs.spec.js`, que era o
  achado e virou a guarda (a irmã viva em outro atlas agora tem de ser recusada), com 5 de 5 rodadas
  em série sob `--retries=0`; e quatro casos em
  `frontend/tests/integration/barreira-de-logout-entre-abas.test.js` (N namespaces com soltura de
  todos, um escritor em qualquer um deles tirando o censo do conjunto com o contraste do ativo sozinho
  drenando, o prazo único medido a relógio contra o custo em série, e lista vazia, só local e nome
  repetido). Controle negativo em duas mutações: a cobertura de volta ao ativo reprova L3 nomeando o
  namespace descoberto e deixa L1 e L2 verdes; `holdLogoutBarriers` cortada ao primeiro nome reprova
  os quatro casos de node.
- **Status:** aceita.


### 2026-09-19: as pendências do lançamento saem de docs/reviews, e o que continua aberto fica aqui

- **Contexto (do dono):** o documento de trabalho de pendências abertas, que morava em docs/reviews (posição de 2026-09-13, atualizada até 2026-09-16) foi lido item a item; o que estava aberto e cabia nesta máquina foi RESOLVIDO no mesmo dia, e o arquivo saiu do repositório. O que fechou está no `git log` e na wiki; esta entrada guarda só o que continua aberto e por quê.
- **Fechado em 2026-09-19, por bloco:** B5 (os dois achados visuais já estavam fechados desde 2026-09-15, a tabela é que envelhecera); B7.2 (a barreira de logout medida com duas abas REAIS, `frontend/tests/e2e-ui/browser-logout-barrier-two-tabs.spec.js`, 5 de 5 em série sem retry, e a cobertura ampliada para todos os namespaces do censo, na entrada anterior); B7.5 (a matriz de BroadcastChannel repetida em série, 3 de 3, e o caso de corrida sem retry); B10.1 (o inventário de vendors saiu com a pasta que inventariava, ver [[inventario-de-vendors]]); B10.2 (`npm audit` zero nos três lockfiles, medido em 2026-09-19); B10.3 e B10.4 (o pino da imagem base subido para o índice de 2026-09-19, build sem cache, ver [[deploy-backend]]); B10.5 (os três itens "ficam para o dono" já haviam sido fechados em 2026-09-14, D10 a D12); B10.7 (o teto de 72 bytes da senha passou a valer nos cinco campos que definem senha, regra única em `backend/src/modules/auth/password-rule.js`, guarda `backend/tests/unit/senha-teto-de-bytes-em-todo-schema.test.js`); as dez cláusulas de prova PARCIAL de [[permissoes-atlas]] viraram provadas (vinte casos, sete controles negativos medidos); o defeito de opacidade de `browser-default-layer.spec.js` já estava fechado no candidato por dois commits de 2026-09-13 (8 de 8 em série; o vermelho da homologação era sobre uma base que não é ancestral desta linha); os specs `browser-multi-tab-namespace`, `browser-multi-tab-teardown-queue`, `aparencia-atravessa-trocas-de-atlas` e `envio-do-acervo-herdado` remedidos em série (dois consertos de instrumento no último); §30.2 de `vazamento-viewers.spec.js` medindo com o acervo 3D local; e o ícone SVG rasterizado no envio (entrada própria, acima).
- **Continua aberto, e depende de REDE INTERNA (responsável com acesso ao servidor):** B9.1 e B9.2 (validação com telemetria real e instalação da sonda de disponibilidade em host separado, decisão do dono de 2026-09-15: depois da implantação); B11, as três premissas de origem real (Web Locks e `isSecureContext` na origem interna, cabeçalhos efetivos do NGINX sem `Clear-Site-Data` e com os assets das releases retidas servidos a aba pré-implantação, e o ensaio local não substitui a conferência na origem); B12 inteiro (versões compatíveis fixadas, backup e restauração ensaiados em ambiente separado inclusive dos arquivos referenciados, proxy e limites verificados, retorno definido ANTES de abrir escrita, piloto observado, aceite pelo responsável interno). Backup do servidor não protege dado que só existe no navegador.
- **Continua aberto, e depende do SHA de publicação (executável aqui quando o dono o fixar):** repetir o `npm audit` e o ensaio de troca de builds sobre o SHA candidato (o critério de preservação admite exatamente três diferenças e está em `frontend/tests/helpers/main-profile-upgrade.mjs`; construir a main exige `npm ci --legacy-peer-deps` sem editar o lockfile dela); reconfirmar a referência de produção, que é a main REMOTA.
- **Continua aberto, e é decisão do dono:** B5.6, linha que não existe acked como aplicada num update (aceite declarado: só muda junto com uma fronteira durável por entidade, ver [[modelo-conflito-lww]]); B6.1, o conjunto acima de `LOTE_MAX_OPS` fora de escopo por D4; B7.4, a remoção da chave de época não fecha todo escritor e duas tentativas já foram revertidas (o freio de desmontagem é a guarda, e qualquer conserto novo mantém o controle negativo dele reproduzindo); B8.1, a chave de tentativa da rota única de imagem sem chamador no cliente (porta de servidor sem usuário, não defeito); a matriz completa de homologação (documento 09: perfis envelhecidos, descarte de armazenamento injetado na fronteira nativa do IndexedDB, dois e três clientes com disputa e falha injetada, comparação por conteúdo e por relações), que é ensaio de liberação e não teste de suíte.
- **O que NÃO é pendência, e volta a parecer:** a queda do renderizador do Chromium ao bootar o mapa (`Target crashed`, 3,3% em 480 boots, nenhuma bandeira ajuda) está medida em `.claude/rules/testing.md` e não é trabalho de produto; o flake de `logoutUI` em B3 deu 0 de 8 em 2026-09-19 contra 3 de 7 em 2026-09-14 e ficou sem causa porque não reproduziu.
- **Status:** aceita; o documento saiu, e pendência nova se registra aqui, nunca numa lista de furos na wiki.

### 2026-09-20: a recuperação de senha abre pelo CÓDIGO POR E-MAIL, e o administrador vira a saída depois do envio

- **Contexto:** desde 2026-08-23 a recuperação abria mandando procurar o administrador ("é o caminho que
  sempre funciona") e só depois oferecia o código por e-mail, e a dica da senha nova lia "no máximo 72
  bytes em UTF-8". O dono leu as duas telas em 2026-09-20 e recusou as duas: a primeira manda embora quem
  pode se resolver sozinho, e a segunda lê a implementação em voz alta para quem está trancado fora.
- **Decisão 1, ordem:** a visão abre com uma frase, a do código por e-mail. A saída pelo administrador
  NÃO some: ela desce para uma linha discreta sob o resultado do envio, porque conta sem e-mail
  confirmado não recebe código nenhum e sem ela a pessoa fica presa. A frase não depende de o e-mail
  existir, então a neutralidade contra enumeração continua inteira. Onde a implantação não tem
  recuperação por e-mail, a visão inteira é a frase do administrador.
- **Decisão 2, vocabulário:** a pessoa nunca lê "byte". O teto de 72 bytes do bcrypt continua validado nos
  dois pacotes, e aparece só como recusa, em palavras simples e sem número, porque o número que ela citaria
  é maior que a contagem de caracteres que a pessoa acabou de digitar. A MESMA frase vale no cadastro e na
  recuperação, presa por teste de igualdade.
- **Decisão 3, forma:** entrar e recuperar são VISÕES mutuamente exclusivas do mesmo diálogo, a
  recuperação tem dois passos (pedir o código, redefinir) porque os onze elementos juntos não cabem em
  768 px de altura, e `Esc` na recuperação volta para entrar em vez de fechar.
- **Alternativa recusada:** apagar a saída do administrador, que é o que a leitura literal do pedido
  sugeria. Ela é o único caminho de quem não tem e-mail confirmado.
- **Pendente, decisão do dono:** o texto do e-mail enviado pelo backend ainda manda "clicar em Esqueci
  minha senha e colar o código"; com os dois passos, quem chega com o código na mão usa "Já tenho um
  código". Cruza pacote e não entrou neste lote.
- **Status:** aceita. Guardas: `frontend/tests/unit/login-recuperacao-modelo.test.js` e
  `frontend/tests/unit/confirmacao-de-senha.test.js`.

### 2026-09-20: mapa base e interruptor temporal viram VISTA DA PESSOA, e salvar posição passa a salvar a vista

- **Decisão:** o mapa base na tela e o liga/desliga da linha do tempo deixam de ser config sincronizada do
  mapa e passam a ser estado de vista de cada pessoa, em memória, como a câmera. O que viaja é a VISTA
  SALVA do mapa (câmera, base e interruptor), gravada pelo gesto "salvar posição" num lote só, e aplicada
  junta quando alguém ENTRA num mapa que tem posição salva. Sem posição salva, o que está na tela fica. O
  slide de briefing ganha base e interruptor próprios, nulos por padrão (nulo herda o salvo do mapa).
- **Por quê:** relato do dono. Um colega escolhendo base ou ligando a linha do tempo repintava a tela de
  todos, que é a forma errada de um gosto pessoal se comportar. A leitura do código achou mais dois custos
  da mesma raiz: leitor e mapa travado não podiam escolher base nem ligar a linha do tempo (o seletor fora
  escondido deles em 2026-09-17, porque a escolha era ESCRITA), e abrir um mapa cuja base o catálogo de
  quem entra não oferece REGRAVAVA a base para o atlas inteiro, porque o fallback era persistido.
- **O que continua sincronizado no temporal:** toda a CONFIG (janela, unidade, modo, origem). O que é da
  pessoa é o gesto de reprodução: ligar, desligar, play, stop, velocidade e revelar ocultas. Os quatro
  últimos já eram locais; o conserto foi só o interruptor.
- **Onde a escolha pessoal mora:** em memória. Por dispositivo ou por usuário no servidor foram recusados,
  porque uma preferência persistida disputaria precedência com a base salva, e a regra de entrada já
  resolve essa disputa a favor do salvo. O custo declarado: um F5 devolve a pessoa à vista salva.
- **Alternativa recusada para a vista salva:** pôr `base_layer` DENTRO da op de posição. Mexeria na
  whitelist de colunas por subtipo, na unidade de disputa dos dois espelhos e no extrator do gate de
  recurso, que só examina o subtipo de mapa base. O caminho adotado não muda o servidor: as três folhas
  (posição, base, config temporal) saem sob `withGestureBatch`, que o servidor já aplica ou recusa
  inteiro. Coluna nova só para a base salva também foi recusada: `maps.base_layer` já é a base do mapa.
- **Alternativa recusada para o slide:** derivar o interruptor do cursor temporal do slide (cursor não
  nulo = ligado). A captura só grava cursor com o controle ligado, mas um cursor sem janela definida vira
  nulo, então nulo não distingue desligado de ligado sem janela. Entraram duas colunas nulas em `slides`
  (hoje em `backend/src/database/migrations/003_atlas.sql`), e a base é referência de catálogo: registro de referências nos dois pacotes
  (`briefing.slide.baseLayer`), gate de escrita do sync e as duas podas.
- **Par conectado:** quando alguém salva a vista, ninguém é movido. O documento converge e o valor vale
  na próxima entrada, como a câmera salva sempre valeu.
- **Compatibilidade:** a fila de saída é append-only, então ops de mapa base e de config temporal de
  builds antigos ainda chegam; o servidor segue aceitando os dois subtipos e o par só grava o documento.
- **Onde se lê:** [`../wiki/vista-da-pessoa-e-vista-salva.md`](../wiki/vista-da-pessoa-e-vista-salva.md).
- **Status:** aceita; a metade "Onde a escolha pessoal mora" foi SUPERADA em 2026-09-22 pela entrada
  "a vista da pessoa passa a ser LEMBRADA neste computador", abaixo (a escolha é lembrada por
  dispositivo e vence a vista salva na entrada). O resto continua valendo.

### 2026-09-20: a apresentação de briefing é um palco limpo, e o slide escolhe o que volta

- **Decisão:** ao APRESENTAR um briefing, os controles do mapa ficam escondidos e só voltam quando o
  autor marcou a caixa daquele slide: seletor de mapa base, modelos 3D, imagens 360, terreno, controle
  de coordenadas, utilitários e, acrescentados pelo dono no mesmo dia, a busca e os controles de
  navegação (zoom, tela cheia e bússola, que são UMA caixa só). O padrão de todos é falso. A área da
  conta (o botão de entrar, ou a identidade de quem entrou com o menu dela), o selo com o nome do atlas,
  o selo de sincronia, a lista de quem está online e o "compartilhar esta vista" NÃO são escolha do
  autor: somem em todo slide. Os dois do meio só existem para quem entrou num atlas de servidor, e foram
  achados por um inventário do palco feito nesse cenário, porque uma captura anônima nunca os mostra. As caixas ficam abaixo
  do conteúdo no editor. A lista viva é `SLIDE_CONTROLS`; esta entrada dizia "seis" e envelheceu em
  uma hora, então a contagem saiu da prosa.
- **Por quê:** relato do dono. O palco herdava o que o mapa mostrava, e o que o público pode tocar é
  decisão do slide: um slide que convida a comparar bases quer o seletor, o seguinte não quer nada.
- **O editor não é afetado**, de propósito: o autor precisa do seletor e dos visualizadores para montar
  o slide. Só o apresentador liga a classe de apresentação.
- **Forma:** uma coluna JSONB nula em `slides` (hoje em `backend/src/database/migrations/003_atlas.sql`) sobre lista FECHADA,
  espelhada nos dois pacotes (`frontend/src/js/briefing/slide-controls.js` e
  `backend/src/modules/sync/slide-controls.js`). Uma coluna booleana por controle foi recusada: cada controle
  novo seria uma migração, e a lista fechada mais o normalizador dão a mesma garantia (chave de fora é
  descartada, e só `true` liga). Quem esconde e mostra é CSS sob classes do `body`, que é o mecanismo que
  a casa já usa para o modo de briefing; o controlador de perfis de visibilidade não tem nenhum elemento
  registrado, então passar por ele seria um no-op.
- **Compatibilidade:** slide anterior a esta data não tem o campo e apresenta com tudo escondido. Isso
  MUDA o que se via antes (busca, coordenadas, terreno e navegação apareciam ao apresentar), e é o
  padrão que o dono pediu.
- **Status:** aceita.

### 2026-09-20: a visita pública perde a faixa e o mouse, o leitor perde a alça, e o link público ganha endereço

- **Decisão (dono, em seis pedidos do mesmo dia):** (a) o canto da conta e a lista de quem está
  online escrevem posto mais nome de guerra, `Maj Diniz`, e não o login; (b) o dono de um atlas não
  pode ser adicionado como membro dele; (c) o link público sai como ENDEREÇO, sobre uma base
  configurável pelo administrador, com `https://ebgeo.dsg.eb.mil.br` de padrão; (d) o link público
  aberto por quem está logado abre pela conta; (e) a visita pública perde a faixa persistente e o
  cursor, e continua contada na lista de online; (f) quem não pode editar não ganha alça de vértice
  nem arrasta feição, como no mapa travado.
- **O que foi medido antes de mexer:** (b) a busca de pessoas não exclui quem pergunta e as duas
  telas filtravam só contra a lista de membros, de modo que o dono se achava, se adicionava e saía
  duas vezes na lista; o banco de desenvolvimento não tinha linha nenhuma assim, porque a unicidade
  de `atlas_shares` nunca esteve em jogo: a duplicata era entre o bloco `owner` e a lista `shares`
  do mesmo payload. (c) a tela mostrava e copiava o token cru de 32 caracteres. (d) com sessão, o
  link era engolido na primeira linha de `openPublicAtlasFromUrl` e o navegador terminava em
  `atlas.html`, sem pedido a `/atlas/public/` e sem aviso. (f) numa visita, o clique desenhava as
  alças, o arrasto MOVIA o polígono na tela, o store recusava e a tela ficava divergente do dado.
  (Esta linha atribuía a isso o relato "o mapa some as feições", e a atribuição estava ERRADA: a
  causa daquele sintoma era uma corrida no boot da visita, achada e corrigida em 2026-09-21, com
  registro no livro-razão. O defeito do arrasto era real e vizinho, não a causa.)
- **Onde cada uma mora:** `displayName` em `frontend/src/js/store/sync/session-context.js`,
  preservado quando o papel por atlas é re-posto sem dizer nada sobre a pessoa; `peoplePickOutcome`
  e `alreadyHoldsAtlas` em `frontend/src/js/catalog/grant-tree.js`, mais o 409 de `addUserShare`;
  `composePublicUrl` em `backend/src/modules/sharing/public-url.js`, sobre
  `app.urlBaseLinkPublico` (env `URL_BASE_LINK_PUBLICO`, override pela aba Sistema), servido como
  `publicUrl` AO LADO de `publicLink`, que continua sendo o token; `isEditSurfaceInert` em
  `frontend/src/js/tool_manager/edit-surface.js`; o corte do cursor em `sendCursorFrame` e em
  `handleCursor`.
- **Alternativas recusadas:** compor o endereço do link no cliente a partir de `window.location`,
  porque o atlas é publicado de dentro de uma rede e o link é lido de fora dela; abrir a visita
  anônima por cima de uma conta viva, porque a sessão de visitante anula a identidade; perguntar o
  papel por nome em `edit-surface.js`, porque a pergunta por capacidade (`GuardAction.UPDATE_FEATURE`)
  acerta sozinha o degrau que nascer depois; e trocar a lista de visitantes por um contador à parte,
  porque a contagem já estava certa e o pedido era só não perdê-la.
- **O defeito que apareceu no caminho, e não era do lote:** editar um vértice de polígono, linha ou
  seta DESSELECIONAVA a feição e deixava as alças na tela. O arrasto de alça virou de ponteiro com
  `preventDefault` no `pointerdown`, o que cancela o `mousedown` de compatibilidade e não o `click`;
  o MapLibre só suprime o clique de fim de arrasto comparando-o com o `mousedown` que viu, deixou
  de ver, e o clique saía onde o vértice foi solto. A regra voltou no único ponto que consome o
  clique do mapa (`isDragEndClick`, `frontend/src/js/tool_manager/click-after-drag.js`).
- **Limites declarados:** o segundo POST de share para a MESMA pessoa continua sendo upsert, porque
  várias suítes e o import montam share assim; o link morto aberto por quem está logado ainda perde
  o aviso quando a cadeia de boot navega para `atlas.html`, como já acontecia com `?atlas=`; e a
  superfície inerte é MUDA, como a trava, de modo que o leitor que tenta arrastar move o mapa e não
  recebe frase nenhuma.

### 2026-09-20: as migrações voltam a ser onze bases por domínio (segunda consolidação)

- **Decisão (dono):** como nada foi implantado, os nove arquivos que nasceram depois da consolidação
  de 12/09 são dobrados nas bases por domínio. A pasta volta a ter uma base por domínio, e a lista
  é a tabela de `backend/src/database/migrations/README.md`.
- **Como:** cada incremento de DDL entrou na base do domínio dele (identidade, atlas e sync), com
  as colunas novas no FIM de cada `CREATE TABLE`, na ordem em que os `ALTER` as tinham criado, para
  que até a posição física coincida. A regularização de camada padrão, que era só de DADOS, saiu
  sem substituto: uma instalação nova não tem linha para regularizar.
- **Prova:** dois bancos descartáveis, um pela sequência anterior e outro pelas bases, com os
  catálogos do PostgreSQL comparados sem ignorar a ordem das colunas. Coincidiram 564 colunas, 196
  constraints, 176 índices, 19 funções (por hash do corpo), seis triggers, três sequências e 28
  comentários de coluna. O comparador passou por controle negativo: com uma coluna retirada da base
  nova, acusou a coluna pelo nome.
- **Alternativa recusada:** reagrupar também as onze bases em menos arquivos (um por schema, por
  exemplo). A divisão por domínio é o que torna cada arquivo legível de ponta a ponta, a ordem já
  respeita as dependências, e fundir `008_acesso_a_recurso.sql` com o catálogo juntaria no mesmo
  arquivo as funções de autorização e as tabelas que elas leem, que é onde a revisão mais precisa de
  fronteira.
- **Custo declarado:** um banco de desenvolvimento aplicado pela sequência anterior tem schema
  idêntico e tracking divergente. O migrador o recusa na próxima vez que houver migração a aplicar,
  e a saída é recriá-lo. O servidor não migra no boot, então até lá ele continua servindo.

### 2026-09-21: a presença não leva o instante de ninguém, e a auditoria temporal é executada

- **Decisão (dono, P1):** o instante da linha do tempo de uma pessoa NÃO se propaga. A presença diz
  se a pessoa está no mapa ou não; a linha do tempo é visualização de cada um, como já eram o ligar
  e desligar, a reprodução e a velocidade desde 2026-09-20. O quadro temporal de presença saiu dos
  dois pacotes (envio, recepção, retenção no socket e o rótulo na lista de online), com dois guardas
  estruturais e um teste contra o backend real. Alternativa recusada: manter o quadro e só limpar o
  rótulo quando o colega desliga a linha do tempo, que era o que o achado S9 pedia.
- **Decisão (execução):** a auditoria do sistema temporal (seis frentes de leitura, 65 achados de
  pé depois de uma segunda passada que refutou um) foi executada no mesmo dia, por catorze frentes
  em paralelo com posse de arquivos disjunta: 64 corrigidos, e o do antimeridiano fora por decisão
  de custo (não é alcançável em operação no Brasil). O documento de diagnóstico foi REMOVIDO ao
  fim, por ordem do dono: a tabela de onde cada conserto ficou preso está no fim desta entrada, e
  o que continua aberto (N1 a N10) mora em [`docs/wiki/modulo-temporal.md`](../wiki/modulo-temporal.md),
  seção de limites conhecidos. O texto integral do diagnóstico está no histórico do git, nos
  commits `7cfc2dd3` e `4486fde7`.
- **Cinco decisões de desenho tomadas na execução, cada uma com a alternativa recusada:**
  1. **A lente não muda o dado.** A derivação de GDH automático roda em qualquer modo; o modo
     relativo trava só a CHAVE do vínculo (ligar e desligar). Recusada: pausar a derivação no modo
     relativo, que chegou a ser escrita e anulava a rederivação do reagendar, que só existe nesse modo.
  2. **Janela invertida nunca é visível, e nenhuma porta a grava.** O painel e a engrenagem recusam
     nomeando o campo; a importação e o servidor descartam o FIM, porque fim nulo é o limite
     automático e a leitura que nunca esconde feição. Recusada: trocar início e fim de lugar, que
     inventaria um intervalo que o arquivo não afirmou.
  3. **A velocidade é fração da janela.** 1x percorre a janela inteira em 60 s, em qualquer unidade.
     Recusada: manter unidades por segundo, que fazia o mesmo 1x durar dois quadros num mapa e sete
     minutos em outro.
  4. **Arrastar a feição leva a rota inteira**, como o celular e o colar já faziam. Arrastar o
     ponto-chave de partida dentro do editor continua movendo só ele.
  5. **O desfazer de propriedade é opt-in por gesto** (`recordUndo`), e a janela de validade fica
     de fora enquanto o GDH derivado for uma segunda escrita sem espera.
- **Contrato que mudou nos dois lados:** `temporal_config` e `temporal_cursor` têm domínio no
  servidor (`backend/src/modules/sync/temporal-config.js`, espelhado por
  `frontend/tests/unit/configuracao-temporal-espelha-cliente.test.js`). Valor fora do domínio
  degrada para o padrão e a op NUNCA é recusada, senão a fila de saída daquele cliente congela.
  Nenhuma migração: as colunas já existiam.
- **Onde cada conserto ficou preso** (os códigos são os das frentes da auditoria: M modelo, C
  controlador, S store e sync, E edição, V visualizadores e briefing, I importação, D documentação):

| achado | o que mudou | onde ficou preso |
|---|---|---|
| S1 (= I4) | renomear leva `temporal_<nome>` e `mapLocked_<nome>` nos dois ramos do repositório e re-chaveia config e vista em memória; o rename vindo do PAR transfere o disco por `transferNameKeyedSideStores` | `frontend/tests/integration/renomear-mapa-leva-config-temporal.repro.test.js`, `frontend/tests/integration/remote-operation-handler.test.js` |
| S4 | duplicar copia janela, unidade, modo, origem e o `ativo` SALVO, antes de entrar na cópia | `frontend/tests/integration/duplicar-mapa-leva-config-temporal.repro.test.js` |
| E1 | a conversão de ponto monta as propriedades por `buildConvertedPointProperties`: janela, trajetória, atributos, imagens e a posição de origem viajam | `frontend/tests/unit/conversao-de-ponto-preserva-tempo.repro.test.js` |
| E2 | a escrita de propriedade aceita `recordUndo`, aceso uma vez por gesto no editor e no painel de trajetória (Limpar, remover ponto, trocar instante) | `frontend/tests/unit/desfazer-escrita-de-propriedade.repro.test.js`, `frontend/tests/unit/editor-de-trajetoria-gestos.repro.test.js`, `frontend/tests/unit/painel-temporal-recusa-janela-e-ancora.test.js` |
| M4 (= I1), M5, I2, M11 | o leitor de datas casa formas declaradas (dia antes do mês, ISO com e sem fuso, GDH militar, epoch ms), recusa data impossível e aplica a faixa 1900 a 2200; `Date.parse` saiu | `frontend/tests/unit/leitor-de-data-da-importacao.repro.test.js` |
| I3, M6 (importação), I10 | coordenada ilegível descarta o ponto-chave, janela invertida perde o fim, e a precedência de chaves é declarada | `frontend/tests/unit/temporal-import.test.js` |
| I5 | célula de data ilegível e janela invertida são CONTADAS e avisadas, no CSV e no importador geral, pela mesma `describeTemporalIssues` | `frontend/tests/unit/csv-celula-temporal-ilegivel.repro.test.js`, `frontend/tests/unit/importacao-degradacao-temporal-avisa.repro.test.js` |
| I8 | os nomes temporais reservados saem de `TEMPORAL_SOURCE_KEYS`, sem cópia à mão, e a comparação ignora caixa | `frontend/tests/unit/nomes-temporais-reservados.repro.test.js`, `frontend/tests/unit/user-data-atributos-de-importacao.test.js` |
| C3 | um limite configurado completa o outro em vez de derrubar a régua para o relógio | `frontend/tests/unit/temporal-utils.test.js` |
| I6 | o KMZ exporta a janela como TimeSpan (`toKmlDateTime`) e declara em nota que a trajetória não é representada | `frontend/tests/unit/kmz-exporta-janela-temporal.repro.test.js` |
| C2, S2 | a config temporal pergunta pela trava AO DISCO; o reagendar virou `rescheduleMapTemporal`, um lote lógico que só grava o Dia D se as feições andaram | `frontend/tests/integration/temporal-mapa-travado.repro.test.js` |
| C4, C12 | fim anterior ao início é recusado nos dois modos sem fechar a tela; fechar é idempotente e não age com operação em curso | `frontend/tests/unit/temporal-settings-modelo.test.js`, `frontend/tests/unit/temporal-settings-modal-fechamento.test.js` |
| S6, S7 | o servidor saneia a config temporal por `normalizeTemporalConfig`, na coluna e no payload ecoado, sem recusar a op; o e2e passou a usar o contrato real | `backend/tests/integration/configuracao-temporal-saneada.repro.test.js`, `frontend/tests/unit/configuracao-temporal-espelha-cliente.test.js`, `frontend/tests/e2e/temporal-mapconfig.e2e.test.js` |
| S3 (= I7) | o cursor do slide viaja no clone, no import e no envio, e as três portas mais o sync incremental leem a mesma `normalizeEpochMs` | `backend/tests/integration/cursor-do-slide-sobrevive-a-copia.repro.test.js`, `backend/tests/integration/cursor-do-slide-saneado-no-sync.repro.test.js`, `frontend/tests/unit/cursor-do-slide-no-envio.test.js` |
| S8, S9 (= V2), decisão P1 | o quadro temporal de presença saiu dos dois pacotes: envio, recepção, retenção no socket e rótulo | `frontend/tests/unit/presenca-temporal-nao-volta.test.js`, `backend/tests/unit/presenca-temporal-nao-volta.test.js`, `backend/tests/ws/presenca-temporal-removida.test.js` |
| V4, E4, E8, E11, E12, M6 (painel) | painéis de marcador seguem a regra de somente leitura; troca de âncora e janela invertida são recusadas nomeando o campo; GDH vazio quando o instante some; o calendário não restringe; a caixa de GDH recusa o clique nomeando o estado | `frontend/tests/unit/painel-temporal-recusa-janela-e-ancora.test.js`, `frontend/tests/unit/gdh-automatico-com-instante-ausente.repro.test.js`, `frontend/tests/unit/rederiva-dtg-reagendar.repro.test.js` |
| M1 (= V6), M6, M9, V7 | uma regra de visibilidade: `isTemporallyVisibleInWindow`, consumida por 3D, 360 e legenda do PDF por `isVisibleUnderTemporal`, comparada com a expressão do filtro no mesmo corpus; janela invertida nunca é visível; o revelar alcança as três superfícies | `frontend/tests/unit/visibilidade-temporal-uma-regra-so.test.js` |
| M3, M2 | o revelar usa a janela do passo e virou um fator DENTRO do aplicador de opacidade (`setRevealDimWindow`), dono único da tinta | `frontend/tests/unit/revelar-ocultas-usa-a-janela.test.js`, `frontend/tests/unit/opacidade-de-camada-nao-escreve-a-toa.test.js` |
| V8 | o PDF declara o instante retratado, nos dois motores e na capa do mosaico | `frontend/tests/unit/pdf-declara-o-instante-temporal.test.js` |
| C1, E9, C11, M7, C10 | limites e cursor são zerados com o temporal desligado e na troca de mapa, com o cursor lembrado por mapa; o sync aplica por dentro da mesma cadeia; o ramo desligado só trabalha quando há o que desfazer; entrar em 3D ou 360 pausa | `frontend/tests/unit/temporal-controller-estado-e-aplicacao.repro.test.js`, `frontend/tests/unit/derivacao-nao-deriva-com-temporal-desligado.repro.test.js`, `frontend/tests/unit/temporal-render-retained-source.test.js` |
| C5, M10 | a velocidade é fração da janela (1x percorre a janela em 60 s) por `playbackAdvanceMs`, e o instante final mantém a última célula inteira | `frontend/tests/unit/temporal-playback-model.test.js` |
| V1 | a barra temporal é o nono controle do slide, oculta por padrão ao apresentar, e a engrenagem nunca aparece no palco | `frontend/tests/unit/controles-do-slide.test.js` |
| V3, V9, V5, V10, V11 | o instante do slide é capturado nos três modos por `captureSlideTemporal`, de uma fonte só; a saída devolve o instante da pessoa e para a reprodução; o cursor viaja com o nome do mapa; o interruptor do editor age no mapa do slide | `frontend/tests/unit/instante-do-slide-nos-tres-modos.repro.test.js`, `frontend/tests/unit/briefing-devolve-o-instante.repro.test.js`, `frontend/tests/unit/interruptor-temporal-do-slide-no-mapa-do-slide.repro.test.js` |
| S5, S12 | o retrato repõe o espelho da config temporal e o anuncia; a op temporal que chega antes do mapa espera por ele em vez de gravar sob o id | `frontend/tests/integration/remote-operation-handler.test.js` |
| E3, E5, E7 | o clique numa alça do editor não desseleciona (`isHandleAt`); o arrasto de alça é de ponteiro, com cancelamento que descarta; arrastar a feição leva a rota inteira | `frontend/tests/unit/editor-de-trajetoria-gestos.repro.test.js`, `frontend/tests/unit/rota-inteira-acompanha-o-arrasto.repro.test.js` |
| C7, C8, C9 | o arraste da régua é máquina de estados pura (`reduceDragEvent`) com as três saídas; a régua tem ARIA completo, foco no clique e Home, End, Page Up e Page Down (`cursorForKey`); a variável de altura sem leitor saiu | `frontend/tests/unit/barra-temporal-arraste-e-teclas.repro.test.js`, `frontend/tests/unit/barra-temporal-fiacao.test.js` |
| C6, E10, S11 | os três arquivos foram reescritos para medir o efeito; os dois de interface rodaram contra o app real | `frontend/tests/e2e-ui/temporal-local.spec.js`, `frontend/tests/e2e-ui/browser-temporal-advanced.spec.js`, `frontend/tests/unit/temporal-migration.test.js` |
| D1, D2, D3, D4 | a página do módulo e o tutorial descrevem o estado vigente | `docs/wiki/modulo-temporal.md`, `frontend/public/docs/README.md` |

### 2026-09-21: o que a versão anterior grava depois da transição entra sozinho, e a tela fica para o conflito

- **Decisão (dono):** a gravação tardia da versão anterior, no caso trivial, é incorporada pelo próprio portão de migração, sem tela. A tela de recuperação fica para quando as duas versões mexeram no mesmo mapa, quando a antiga apagou um mapa inteiro, ou quando a migração daquele acervo não se mostra estável. Até aqui toda gravação tardia parava o boot, mesmo com o atlas novo intocado.
- **O relato:** servidor de produção, com as duas linhas do produto na mesma origem. O atlas da versão nova era o antigo congelado às 09:13 e sem nenhuma edição desde então, e a antiga ganhou duas linhas de coordenação às 09:27 e às 09:28. A cópia de recuperação baixada pela pessoa mostrou os dois acervos iguais fora dessas linhas, da contagem de cores e do estilo da grade.
- **O desenho:** fusão de três vias por registro, com o MAPA como unidade de conflito, decidida só por impressão digital (`planLateLegacyChanges`). O lado antigo é comparado na forma migrada: o acervo antigo atual é copiado e migrado num escopo de trabalho, e o inventário dele se compara com a base migrada. As bases são duas, uma de cada lado, e as duas avançam a cada junção, porque colapsá-las lê a edição da versão nova como mudança da antiga e grava o valor velho por cima. O destino é escrito no lugar, com o plano gravado no diário antes da primeira escrita, e a retomada reaplica o mesmo plano.
- **Medido antes de escrever (navegador real):** abrir o atlas, arrastar e dar zoom não grava nada nele (0 de 9 registros, com controle positivo que a mesma régua enxergou), e desenhar um ponto muda o registro do mapa e a contagem de cores dele. Ou seja, quem só abriu a versão nova e voltou à antiga cai no caso trivial.
- **Correção no mesmo dia, porque a produção reprovou a primeira versão:** a pessoa atualizou o servidor e recebeu a mesma tela. A junção tinha rodado e recusado por "mesmo mapa nos dois lados", porque a primeira abertura da versão nova CRIA a contagem de cores de um mapa que não tinha nenhuma (`performInitialColorAnalysis`), e a regra leu isso como edição. Medido de novo, na fixture de 11 mapas e sem nenhuma edição: abrir e trocar de mapa grava a contagem de cores de cada mapa aberto, o ponteiro `lastActiveMap` e o PNG do diagrama de declinação que falte. A regra passou a tratar dois tipos de registro à parte: o CACHE que o app recalcula nunca é edição e segue o mapa que veio da antiga, e o PONTEIRO de navegação fica com o valor da versão nova quando os dois lados o mudaram. A recusa lembrada passou a levar a versão da regra (`LATE_RULE_VERSION`), senão os navegadores que já tinham recusado continuariam respondendo pela memória. O PNG regenerado continua sendo registro comum, e os dois lados regenerarem o mesmo dá conflito: separá-lo dos bytes de uma feição de imagem exige o tipo da feição, e fica como limite conhecido.
- **Segunda correção no mesmo dia, lida no navegador da pessoa e não mais deduzida:** com a regra 2 no servidor a tela voltou. O diário no IndexedDB dela dizia `same_unit`, e a única mudança do lado novo era `maps/Principal`, regravado às 09:13:56 pelo build daquela manhã mexendo só no `sync`, sem operação nenhuma na fila (as três operações dela eram a contagem de cores). O diário guarda impressões e não conteúdo, então a base não se compara sem o `sync`; o que se prova é que nada se perde: o mapa da nova, sem os carimbos, está contido no da antiga, campo a campo e feição a feição, e a fila não tem apagamento naquele mapa. Nesse caso a mudança não é edição. A contenção não enxerga apagamento, e é por isso que a fila entra: sem ela, uma feição apagada na nova e mantida na antiga voltaria. A regra subiu para a versão 3, e o estado do navegador dela, registro a registro, virou teste.
- **Com a página aberta não se funde:** a aba que tem o atlas montado regravaria o mapa inteiro na próxima edição, e o diário já diria que a junção aconteceu. O vigia avisa numa notificação e a junção acontece ao recarregar. A checagem é o trinco de montagem (`atlasMountLockName`), e a resposta "não sei" também adia.
- **Alternativas recusadas:**
  - *Trocar o atlas por uma cópia nova a cada junção.* Muda o endereço dos bancos por baixo de quem os tem montado e custa uma cópia inteira a mais; a escrita no lugar com o plano no diário dá a mesma atomicidade observável.
  - *Unidade por registro.* Deixaria entrar a contagem de cores de um lado com as feições do outro no mesmo mapa.
  - *Fundir feição a feição dentro do mapa.* Exige guardar o CONTEÚDO do acervo no instante da cópia, e não só a impressão, e só valeria para quem migrar depois. Fica condicionada à medida: o evento de migração ganhou os resultados de junção e de conflito, e a fusão por feição se constrói se o conflito aparecer de fato.
- **Onde ficou preso:** `frontend/tests/unit/late-legacy-plan.test.js` (a regra em tabela, com o pior caso de cada cláusula) e `frontend/tests/integration/alteracoes-tardias-legado.test.js` (o relato em forma sintética, o pior caso, as duas bases, o mapa pelo id, a montagem, a interrupção e a origem apagada). Controle negativo: cada uma das nove guardas foi desfeita, uma de cada vez, e o teste dela reprovou; duas não reprovavam na primeira escrita dos testes, e os casos foram refeitos para isolar a regra. O relato também foi reproduzido no navegador com a cópia de recuperação da pessoa, que não foi versionada porque o repositório é público, e a mesma prova reprovou o comportamento antigo.

### 2026-09-21: quatro pontos abertos da auditoria temporal são fechados, e a trava de ajuste de mapa vira convenção de cliente declarada

- **Decisão (dono, N3):** o servidor NÃO passa a recusar ajuste do próprio mapa em mapa travado. Ele
  tranca os alvos FILHOS (`LOCKABLE_CHILD_TARGETS`), e os ajustes cujo alvo é o mapa (config
  temporal, mapa base, posição, grade, notas e o nome) são convenção de CLIENTE, como já eram as
  travas de camada, de grupo e de feição. Alternativa recusada por ora: uma segunda regra no
  servidor para alvo `map` com sub-tipo. Os riscos que a adiaram: op recusada não sai da fila de
  saída e segura o lote, então cliente e servidor teriam de mudar no mesmo commit; salvar posição é
  um lote lógico, e recusar um membro recusa a câmera junto; o sub-tipo da própria trava teria de
  ficar de fora, senão ninguém destrava; clone e import escrevem esses ajustes pelo servidor. Reabrir
  se aparecer caso real de abuso.
- **O inventário que sustenta a convenção** (onze sítios em três arquivos, fechado por dois caminhos:
  o vocabulário de `frontend/src/js/store/sync/operation-types.js` e as colunas que o servidor aceita):

| operação | função | papel | trava | estado em 2026-09-21 |
|---|---|---|---|---|
| criar mapa, e as notas do mapa novo | `addMap` | `CREATE_MAP` | não pergunta | certo por natureza: o mapa não existe |
| excluir mapa | `removeMap` | `DELETE_MAP` | regra própria do menu | classificado, sem mudança |
| renomear | `renameMap` | `UPDATE_MAP` | memória OU disco | CORRIGIDO: perguntava só à memória |
| travar e destravar | `toggleMapLock` | `LOCK_MAP` | não pergunta | certo por desenho: precisa continuar destravável |
| mapa base salvo | `setBaseLayer` | `UPDATE_MAP` | disco, mais briefing | recusa era muda, agora avisa |
| posição salva, gravar e limpar | `updateMapPosition`, `clearMapPosition` | `UPDATE_MAP` | disco, mais briefing | recusa era muda, agora avisa |
| notas | `setMapNotes` | `UPDATE_MAP` | disco, mais briefing | CORRIGIDO: perguntava pelo mapa CORRENTE |
| grade | `setGridStyle` | `UPDATE_MAP` | disco, mais briefing | CORRIGIDO: perguntava pelo mapa CORRENTE |
| config temporal | `writeMapTemporalConfig` | `UPDATE_MAP` | disco | molde, sem mudança |

  O defeito das duas corrigidas: recebiam o nome do mapa e perguntavam `isCurrentMapLockedSync()`, que
  responde sobre o mapa corrente e descarta o argumento; em atlas LOCAL o conjunto em memória só
  conhece o mapa corrente, então numa aba recém-aberta a resposta era "destravado" para todos. O
  editor de notas dizia "Notas salvas com sucesso!" sem ler a resposta da store, o que era falso para
  todo Leitor. Guardas: `frontend/tests/unit/ajuste-de-mapa-pergunta-pela-trava.test.js` (censo: o
  sub-tipo novo reprova até ser classificado) e
  `frontend/tests/store/ajuste-de-mapa-em-mapa-travado.repro.test.js` (trava só no disco, conjunto
  vazio de propósito).
- **N1, o rename vindo do colega.** MEDIDO antes de consertar, em duas browsers: 17 asserções
  reprovavam, e o achado maior não era de tela. A feição que o par desenhava depois do rename caía
  num mapa FANTASMA (chave no nome velho) e a op morria na fila; um F5 consertava, então o defeito
  era de sessão viva. Conserto no desenho aprovado: o tratador de entrada emite
  `MAP_RENAMED_REMOTELY` depois do disco, e um assinante em `frontend/src/js/store/map.operations.js`
  chama as MESMAS duas re-chaveagens do autor (`renameMapInMemory` e a do resolvedor), o que respeita
  a proibição de importar o gerente de estado de dentro do tratador. Recusada: carimbar um evento do
  autor com origem remota, porque o autor não emite evento de rename e um evento compartilhado lhe
  daria um segundo caminho de re-chaveagem. Depois: 30 de 30 em série, sem retry
  (`frontend/tests/e2e-ui/browser-collab-rename-remoto.spec.js`). O que a medição abriu está na wiki
  do módulo como N12.
- **N2, a conversão de ponto.** Ganhou a tabela de decisão do irmão linear (`pointConversionActions`,
  em `frontend/src/js/tool_manager/helpers/point-conversion.model.js`), com as frases e a lista de
  capacidades IMPORTADAS dele: posto sem criar ou sem apagar esconde os dois itens; mapa travado,
  camada ou feição bloqueada desenham os itens e recusam o clique nomeando o estado. As duas funções
  reconsultam antes de qualquer efeito. Guarda:
  `frontend/tests/unit/conversao-de-ponto-respeita-trava.repro.test.js`.
- **N5, o aviso por quadro.** O tipo de mensagem desconhecido é avisado UMA vez por tipo por socket
  (`backend/src/modules/collab/unknown-type-warning.js`), com teto de 16 tipos e rótulo cortado em 64
  caracteres, porque o tipo vem do cliente e a correção não pode virar vetor de memória nem de volume
  de log. Nada responde ao remetente e nada fecha o socket. Limite declarado: o conjunto vive no
  socket, então um cliente em laço de reconexão ainda rende uma linha por reconexão. Guardas:
  `backend/tests/unit/aviso-de-tipo-desconhecido.test.js` e
  `backend/tests/ws/tipo-desconhecido-avisa-uma-vez.test.js`.

### 2026-09-21: o mapa fantasma é fechado pelas duas pontas, a marca do resolvedor e a escrita que fabricava

- **O defeito, conferido por leitura e depois MEDIDO em duas browsers.** Eram dois, independentes.
  D1: a ativação de um retrato do servidor limpava o resolvedor de mapas e re-registrava os pares
  sem repor a marca de inicializado, que só `initialize()` repunha. Medido logo depois de abrir um
  atlas de servidor: marca FALSA com o índice cheio, nos dois clientes, e a contagem de cores gravada
  só sob o NOME. Sozinho é degradação silenciosa, não perda. D2: a leitura tolerante devolve um
  documento vazio para mapa inexistente, e a escrita seguinte cunhava um registro com a CHAVE igual
  ao nome, o mapa FANTASMA; em atlas de servidor a op saía com contexto que não é UUID e o
  anti-vazamento a descartava, sem erro. Gesto aceito e jogado fora.
- **Os gatilhos medidos.** Retrato no meio da sessão com o mapa aberto renomeado enquanto a aba
  estava sem rede: disco no nome novo, memória no velho, `lastActiveMap` nulo, nenhum cartão marcado
  e o desenho não produzia feição. Mapa aberto EXCLUÍDO por um colega: com a aba Mapas aberta o
  produto já acertava; o achado foi a aba que NUNCA abriu a aba Mapas, porque as abas da barra
  lateral nascem sob demanda e o desvio morava só lá. Ela ficava no mapa excluído, muda.
- **O que mudou, pelas duas pontas.**
  - *A marca* (`replaceAll`, em `frontend/src/js/store/services/map-resolver.service.js`): limpa,
    registra e marca numa operação só. A contagem de cores volta a ser gravada sob o id.
  - *O retrato e o DELETE ao vivo reconciliam o mapa corrente*, por evento
    (`CURRENT_MAP_STALE_REMOTELY`), com o assinante em `frontend/src/js/store/map.operations.js`
    (`reconcileStaleCurrentMap`): mesmo id com outro nome re-chaveia pela MESMA rotina do rename ao
    vivo, ponteiro de navegação incluso; mapa que sumiu leva a aba ao mapa inicial do atlas, com
    aviso que nomeia os dois mapas. O anúncio só sai se o mapa estava de fato MONTADO, senão a
    abertura de um atlas cujo mapa padrão tem xará anunciaria uma perda que não houve. O ramo de
    exclusão da aba Mapas SAIU: com ele ficavam dois avisos e dois redirecionamentos correndo para
    mapas possivelmente diferentes.
  - *A escrita de conteúdo não fabrica mapa* (`frontend/src/js/store/mapa-inexistente.js`). O
    inventário classificou todo escritor em três classes: GESTO recusa com o motivo `map_missing` e
    a frase "Este mapa não existe mais neste atlas. Escolha outro mapa na aba Mapas."; DERIVADA
    (contagem de cores, ponteiro, bitmap regenerado) pula em silêncio, porque medido no mesmo dia
    abrir e trocar de mapa já grava sem edição nenhuma, e um aviso ali apareceria a cada troca;
    CRIAÇÃO (criar mapa, import, clone, retrato, boot) continua podendo escrever o que não existia.
    Vale só em escopo REMOTO: em atlas local o mapa chaveado por nome é o caminho normal, e o
    documento fabricado é a rede de segurança do mapa de emergência. 3D e 360 entram pela mesma
    porta, no funil único de cada arquivo. Os três ajustes de mapa tinham uma guarda que ESTOURAVA,
    e recusa que lança não chega à pessoa: ela passou a emitir o mesmo motivo. **A pergunta de
    existência mora DENTRO da transação, em todo sítio, e isso custou uma volta.** A primeira versão
    a punha antes da transação (nos ajustes de mapa e nos dois funis), para poupar à recusa a trava
    e um lote de intenções vazio; o guarda de troca de atlas de
    `frontend/tests/integration/map-settings-write-ahead.test.js` reprovou na rodada final, porque
    uma leitura de disco fora da transação fica fora do carimbo de escopo e a escrita podia cair no
    OUTRO atlas. Os funis de 3D e 360 tinham a mesma forma e nenhum teste olhando para aquela
    leitura; foram corrigidos junto, e o censo passou a exigir a pergunta dentro da transação.
  - *Quem anuncia sucesso leu a resposta.* Salvar câmera e salvar orientação devolviam `undefined`
    no sucesso e na recusa, e os dois visualizadores anunciavam sucesso sempre. Devolvem booleano.
- **Alternativa recusada:** mudar a leitura tolerante em si. Ela tem dezenas de leitores legítimos,
  e o defeito é de quem ESCREVE em cima do que ela fabrica.
- **Onde ficou preso:** `frontend/tests/e2e-ui/browser-collab-mapa-fantasma.spec.js` (12 de 12 em
  série, sem retry), `frontend/tests/store/resolvedor-troca-o-indice-inteiro.test.js`,
  `frontend/tests/store/retrato-reconcilia-mapa-corrente.test.js`,
  `frontend/tests/integration/retrato-repoe-a-marca-do-resolvedor.test.js`,
  `frontend/tests/store/escrita-de-conteudo-em-mapa-inexistente.repro.test.js`, o censo
  `frontend/tests/unit/escrita-de-conteudo-nao-fabrica-mapa.test.js` (escritor novo reprova até ser
  classificado, e a regra é CHAMAR a porta, não citá-la),
  `frontend/tests/unit/recusa-de-mapa-inexistente-fala.test.js` e
  `frontend/tests/unit/visualizador-le-a-resposta-da-store.test.js`.
- **Aberto, declarado** (os quatro foram fechados no mesmo dia, na entrada seguinte; o primeiro
  deles estava descrito ERRADO aqui). A função de descarte do import substitutivo limpa o resolvedor
  sem repor a marca, no caminho de import LOCAL, que não foi medido. A contagem de cores continua existindo TAMBÉM sob o
  nome, porque o ajuste de atlas que a sincroniza usa o nome como chave e é reidratado a cada
  retrato. Os laterais de camada e de grupo ainda deixam entrada órfã num mapa inexistente (classe
  derivada, sem registro de mapa nem op). Existem duas cópias vivas de `getEmptyMapData`.

### 2026-09-21: os quatro pontos que o mapa fantasma deixou abertos, conferidos um a um, e dois estavam descritos errado

- **A lição antes dos consertos:** os quatro vinham de relato de agente e foram para o diário de
  decisões sem conferência própria. Lidos no código, um não existia, um era mais sério do que o
  descrito, e só dois eram o que o relato dizia.
- **P1, o import substitutivo: a premissa caiu.** A função que limparia o resolvedor sem repor a
  marca não tinha chamador desde que a substituição de atlas por import virou atômica
  (`replaceAtlasFromImport`, `frontend/src/js/account/open-atlas.service.js`), que importa para um
  escopo preparado e monta pelo caminho normal. Era código morto, reexportado pelo barril e dublado
  em dois testes, com duas asserções de que ela "não foi chamada", que passavam por construção. Saiu
  tudo.
- **P2, a contagem de cores DEIXA DE SER SINCRONIZADA (decisão do dono).** Ela tinha duas chaves que
  nunca se entendiam: a escrita local gravava por id e sincronizava para os ajustes do atlas com o
  NOME do mapa como chave; o retrato regravava por nome; e o leitor, achando a chave por id, ignorava
  a por nome (a atualização do colega nunca chegava), ou a migrava e apagava, para o retrato seguinte
  recriá-la. O mapa renomeado ou excluído deixava o nome velho nos ajustes do atlas para sempre. O
  dado é DERIVADO: soma e subtrai a cada mudança de cor de feição, e é recalculado do zero quando
  falta. Saíram o envio (`setColorUsageCompat`, e o payload de enviar atlas local), a reidratação e a
  chave da lista de objetos mesclados do servidor. Cliente antigo que ainda mande a chave é ACEITO
  e a chave é descartada em silêncio, porque op recusada congela a fila de saída dele. O valor já
  gravado fica inerte na coluna, sem migração. O irmão `mapBadgeColors`, que é escolha do usuário,
  continua viajando, e um teste prende isso. O `.ebgeo` continua levando a contagem como seção
  opcional. Alternativa recusada: chavear o sync por id, que conserta o vaivém e mantém em trânsito
  um dado que cada cliente sabe calcular. Guardas:
  `frontend/tests/unit/contagem-de-cores-nao-sincroniza.test.js`,
  `frontend/tests/integration/remote-app-state-setting.test.js` e
  `backend/tests/integration/sync-atlas-settings-app-state.test.js`.
- **P3, camada e grupo: era a MESMA classe do mapa fantasma, e o inventário a tinha classificado
  errado.** A escrita de camada constava como derivada por causa de um comentário sobre uma
  persistência adiada que saiu da árvore em 2026-09-13. Ela é GESTO, em transação e com op de sync, e
  a de grupo também. Os dois funis fabricavam a estrutura do mapa inexistente e resolviam o id pelo
  próprio nome: em atlas de servidor, criar, renomear, travar ou reordenar camada, e agrupar
  feições, num mapa que o atlas não tem mais, era aceito e jogado fora. A pergunta de existência
  entrou nos dois funis, DENTRO da transação e antes da fabricação, e a resolução do nome nas
  escritas de camada deixou de fabricar o balde em memória. A transferência de camada recusa o
  destino inexistente antes de escrever: o "guardado pelo rollback" do inventário anterior era falso
  para a camada VAZIA, que voltava com sucesso deixando lateral órfão. O censo passou a varrer
  `frontend/src/js/` inteiro, e não só a pasta da store, com o barril como segunda âncora de import.
  Guardas: `frontend/tests/store/escrita-de-camada-e-grupo-em-mapa-inexistente.repro.test.js` e o
  censo `frontend/tests/unit/escrita-de-conteudo-nao-fabrica-mapa.test.js`.
- **P4, o documento de mapa vazio tem uma fonte só.** A cópia do repositório local passou a derivar
  da de `frontend/src/js/store/repository.utils.js`, acrescentando `id`, `name` e `sync`. Conferido
  antes de apagar: as duas eram idênticas linha a linha fora esses três campos, então nenhum
  comportamento mudou. Guarda: `frontend/tests/unit/documento-de-mapa-vazio-uma-fonte.test.js`.
- **Dois falsos sucessos antigos, achados no caminho:** o olho e o cadeado do GRUPO na aba de feições
  descartavam a resposta da store e pintavam o estado novo no mapa e na linha; e excluir a camada de
  origem numa transferência lia um valor falso como sucesso. Os dois leem a resposta
  (`frontend/tests/unit/item-de-grupo-le-a-resposta-da-store.test.js`).
- **Aberto, declarado, e desta vez conferido:** com o mapa de ORIGEM de uma transferência apagado
  por um par no meio do gesto e o cache hidratado, a transferência volta com sucesso e as feições
  ficam duplicadas no destino, que é o "duplicado recuperável" que o desenho daquela composta já
  declara aceitar. O valor antigo da contagem de cores continua na coluna de ajustes dos atlas
  existentes, inerte.

### 2026-09-21: mover camada diz o que aconteceu com a origem, e o "duplicado recuperável" ganha nome e saída medida

- **O que estava errado, conferido por leitura.** Mover uma camada entre mapas grava no destino as
  feições com os MESMOS ids e só depois esvazia a origem. O retorno do esvaziamento era
  DESCARTADO. Quando ele era recusado no meio do gesto (um par trava o mapa de origem, ou o papel é
  rebaixado, entre a escrita do destino e o esvaziamento), a operação voltava com sucesso e a tela
  anunciava "Camada movida. A camada vazia continuou no mapa de origem", falso duas vezes: a camada
  continuava CHEIA, e as mesmas feições ficavam nos dois mapas daquele computador enquanto o
  servidor, que aplica a feição de id conhecido como um upsert que troca o mapa da linha, as tinha só
  no destino. É o "duplicado recuperável" que o cabeçalho de
  `frontend/src/js/store/layer-transfer.operations.js` declara aceitar, e ninguém era avisado dele.
- **Uma correção ao que eu tinha dito:** o caso que nomeei primeiro, o mapa de origem EXCLUÍDO por um
  par, não deixa duplicado nenhum. O documento local vai embora com o mapa, e no servidor o upsert
  move ou ressuscita a linha no destino, nas duas ordens de chegada. O defeito ali era só a frase.
- **O que mudou.** O resultado da transferência ganhou `sourceEmptied`, `sourceMissing` e
  `sourceRefusal`, e o esvaziamento é RELIDO por caminho independente, como o destino já era, porque
  o retorno não distingue recusa de "nada a remover". Com a origem cheia o registro da camada não é
  tocado; com a origem excluída nada é tentado, senão a porta de gesto poria "este mapa não existe
  mais" sobre uma transferência que resgatou a camada. A frase saiu da aba para
  `frontend/src/js/features_tab/layer-transfer-phrases.js` (`transferOutcomeNotice`): origem cheia é
  AVISO, no mesmo canal da recusa, nomeando o estado; origem excluída é sucesso, sem o remendo. Com
  a origem cheia a aba não desseleciona nem apaga as feições das fontes do mapa.
- **Alternativa recusada:** desfazer o destino, ou emitir exclusão na origem. Com o id compartilhado
  e LWW por ordem de chegada, a exclusão apagaria a linha que a criação acabou de mover.
- **A saída que a frase promete foi MEDIDA, e a medição a estreitou.** A primeira versão dizia
  "recarregue o atlas para voltar ao estado do servidor", sem medição. Em duas browsers reais, três
  de três: recarregar TIRA da origem as feições que o mover levou, e não por retrato (a geração
  ativa é a mesma antes e depois). O cursor durável só avança quando um retrato é ativado, então a
  cauda que o recarregamento pede ainda contém as criações do próprio mover, e cada uma tira a
  feição do mapa ANTERIOR antes de gravá-la no destino. Um registro que só existe naquele disco
  SOBREVIVE ao recarregamento e só some num retrato inteiro (sair da conta e entrar de novo). A
  frase ficou específica: "para que elas saiam do mapa de origem". Guardas:
  `frontend/tests/store/layer-transfer.test.js`,
  `frontend/tests/unit/transferencia-de-camada-frase.test.js` e
  `frontend/tests/e2e-ui/browser-collab-transferencia-origem-cheia.spec.js`.
- **Aberto, achado pela medição:** como o cursor durável fica parado na versão da abertura, todo
  recarregamento da sessão repuxa a cauda INTEIRA desde que o atlas foi aberto, e numa sessão longa
  ela só cresce. É o mesmo mecanismo que fez a reconciliação acima funcionar, então mexer nele pede
  decisão: avançar o cursor a cada cauda aplicada economiza rede e tira esta reconciliação de graça.

### 2026-09-21: uma imagem sem arquivo deixa de impedir a exportação do atlas inteiro, e a perda vira pergunta

- **O que estava quebrado, e desde quando.** O commit `35f15bcb` (2026-09-19) fez o exportador de
  `.ebgeo` LANÇAR quando uma feição de imagem ou um ícone personalizado não tinha o blob, com a
  frase "Imagem (id) indisponível. Aguarde a conexão e tente exportar novamente". A intenção era
  fechar a perda muda de antes, em que o arquivo saía com um buraco que ninguém via. O efeito foi
  pior que o defeito: UMA imagem órfã tornava o atlas INTEIRO impossível de exportar, para sempre,
  e em atlas local a frase prometia uma saída que não existe, porque nenhuma conexão devolve um
  blob que só existiria naquele disco.
- **A órfã é real, e foi medida.** A fixture `frontend/tests/fixtures/ebgeo-2.2/01-completo.ebgeo`,
  cópia byte a byte de um arquivo da outra linha do produto, declara QUATRO feições de imagem e
  carrega o blob de TRÊS (conferido abrindo o arquivo: a quarta está no mapa "Principal"). Foi ela
  que manteve `frontend/tests/e2e-ui/ebgeo-round-trip-arquivo.spec.js` vermelho no HEAD limpo
  durante dois dias, lido como "vermelho de outra frente" em três lotes seguidos.
- **A regra que guarda as duas intenções: a perda nunca é MUDA e nunca é ARMADILHA.** O exportador
  lê os blobs ANTES de escrever o arquivo, conta o que falta entre o que é exigido (feição de imagem
  e ícone personalizado, por `requiredImagesOf`), nomeia a contagem e o mapa, e pergunta
  (`missingImagesConfirm`, em `frontend/src/js/import_export/ebgeo-missing-images.js`, folha de zero
  imports). Cancelar não produz arquivo nenhum. Confirmar exporta tudo, e a feição sem figura segue
  no arquivo sem ela, que é exatamente o estado que ela já tem naquele computador.
- **São DUAS frases, porque a saída é diferente.** Em atlas de servidor o blob pode só não ter sido
  baixado, então cancelar e tentar com conexão é opção real e a frase a nomeia. Em atlas local não
  é, e a frase diz "não há de onde recuperá-lo". Uma falha de LEITURA do blob (rede caída no meio)
  cai na mesma pergunta em vez de abortar, e a variante de servidor é a que cobre esse caso.
- **Alternativas recusadas.** Manter a recusa e corrigir só a frase: continuaria sendo uma trava
  sem chave em atlas local. Voltar ao pulo silencioso: reabriria o defeito que `35f15bcb` fechou.
  Retirar a feição órfã do arquivo: o exportador passaria a decidir sozinho o que o atlas contém, e
  o import do outro lado não teria como distinguir poda de perda.
- **Guardas:** `frontend/tests/unit/ebgeo-exporta-com-imagem-orfa.test.js` (a parte pura e a ordem
  da fiação), `frontend/tests/unit/mime-da-imagem-do-ebgeo.test.js` (cancelar não baixa nada,
  confirmar exporta, foto com arquivo não pergunta) e o spec de round-trip, que confirma o diálogo e
  reimporta o arquivo produzido. Controle negativo: com o retorno do cancelamento retirado, quatro
  casos reprovam.
- **Aberto ao ser escrito, FECHADO no mesmo dia (entrada seguinte), e é a MESMA órfã por outra porta.** Enviar um atlas local ao servidor recusava
  com "Uma imagem original está ausente. Nenhum atlas foi publicado", nas duas portas
  (`frontend/src/js/import_export/save-local-atlas.service.js` e
  `frontend/src/js/projects/send-local-to-server.service.js`), desde `07278ef6` (2026-09-19, a
  publicação atômica). É a mesma forma de armadilha: um atlas local com uma imagem sem blob nunca
  sobe, e nada na tela diz qual imagem nem o que fazer. Quem acusa é
  `frontend/tests/e2e-ui/cadeia-completa-atlas.spec.js`, vermelho duas de duas na perna 3, com a
  causa lida no console por uma cópia diagnóstica do spec (o toast de erro some em segundos e o
  retrato da falha não o mostra). NÃO foi consertado aqui, de propósito: a recusa é regra escrita
  daquele commit ("toda imagem precisa ser legível"), e trocá-la por pergunta é decidir que um
  atlas pode ser PUBLICADO sabendo-se incompleto, o que é diferente de gerar um arquivo. O conserto
  seria só de cliente: o servidor confere o manifesto que o cliente declara, então retirar a órfã
  do manifesto depois da confirmação passa na conferência de contagem do commit da tentativa.

### 2026-09-21: a figura sem arquivo vira pergunta também na subida ao servidor, a transferência recusada converge sozinha, e o cursor durável anda com a cauda

- **P1, a subida ao servidor.** As TRÊS portas por onde um atlas sobe recusavam na primeira imagem
  original sem arquivo: o atlas local montado (`frontend/src/js/import_export/save-local-atlas.service.js`),
  o cartão local da página de atlas (`frontend/src/js/projects/send-local-to-server.service.js`) e o
  `.ebgeo` importado direto para o servidor (`frontend/src/js/projects/import-ebgeo.service.js`). A
  terceira ganhou peso horas antes, no mesmo dia: o exportador passou a escrever um arquivo SABENDO que falta uma
  figura, e esse arquivo seria recusado ao subir. As três perguntam agora ANTES de qualquer escrita
  na rede (`missingImagesUploadConfirm` e `classifyMissingImages`, no mesmo módulo folha do
  exportador), com uma frase para o disco e outra para o arquivo, cancelar não publica nada e o
  chamador CALA no cancelamento, porque decisão não é falha.
- **Uma correção ao que eu tinha dito:** afirmei que o conserto seria só de cliente, porque o
  servidor conferiria só a contagem contra o manifesto declarado. Errado, e foi lendo
  `beginImport` que apareceu: ele exige que TODA imagem citada pelo payload esteja no manifesto. O
  conserto cruza os dois pacotes. O servidor aceita `missingImageIds`, conferido de três jeitos
  para não virar atalho (nada declarado ao mesmo tempo como enviado e ausente, nada declarado
  ausente que o atlas não cite, e todo original citado em exatamente uma das duas listas), não
  guarda coluna nova (o conjunto é DERIVADO de novo no commit, citados menos manifesto) e registra
  a contagem na trilha de auditoria (`missingImages`, em `ATLAS_CREATE`).
- **Alternativa recusada:** manter a recusa e só nomear a figura. Continuaria uma trava sem chave,
  porque a única saída da pessoa seria apagar a feição. **O custo aceito:** o atlas chega ao
  servidor com uma feição de imagem sem figura, e todo colega vê nela o marcador de erro, que é o
  que a pergunta diz antes de a pessoa confirmar.
- **P2, passo 1: já existia, e o que estava errado era a frase.** A proposta era fazer a origem de
  um mover recusado convergir sozinha. Lido o caminho vivo, ela já converge: o recibo do push traz
  a operação canônica com `previousMapId` e `resolveLocalEdit` a reaplica pelo caminho de entrada.
  Medido pelo gesto de tela, com a recusa injetada no instante certo, quatro de quatro: disco em
  0,5 a 1,5 s, fonte do mapa em até 2 s, sem recarregar. A primeira medição, da manhã do mesmo dia, reconstruía a
  divergência à mão DEPOIS de os recibos assentarem, e por isso nunca viu o recibo agir. A frase
  mandava "Recarregue a página" num toast de dez segundos que sobrevivia ao duplicado que
  descrevia; hoje ela diz que as feições saem sozinhas quando o servidor confirmar, que uma recusa
  do servidor é avisada na tela, e que a camada vazia fica no mapa de origem.
- **P2, passo 2: o cursor durável anda com a cauda** (`_advanceDurableCursor`,
  `frontend/src/js/store/sync/sync-engine.js`). Três condições, cada uma um jeito de o cursor
  mentir: toda operação gravada, mesma geração ativa, só para frente. **O preço, medido:**
  reaplicar a cauda desde a abertura consertava por acidente qualquer divergência local que ela
  descrevesse, e depois do primeiro recarregamento isso deixa de valer. **O ganho de rede não foi
  medido** em sessão longa real; ficou preso o mecanismo.
- **Um "achado" desta entrada era FALSO, e ficou no ar por algumas horas.** Ela dizia que o
  servidor aceita o mover de uma feição para FORA de um mapa travado, por `lockedMapDenialReason`
  ler só o mapa de destino. A função lê mesmo só `op.mapId`; o SÍTIO que a chama confere a origem
  dez linhas abaixo, com o mapa anterior da linha (`pushOperations`, em
  `backend/src/modules/sync/sync.service.js`), e o caso já estava preso em
  `backend/tests/integration/sync-feature-conflicts.test.js` ("a move from a locked source"). Quem
  acusou foi um teste de caracterização escrito para prender o achado, que voltou vermelho.
- **E a segunda medição do passo 1 media o caso errado.** A trava injetada existia só na memória do
  cliente; o servidor, destravado, aceitou o mover, e foi isso que "convergiu sozinho". Com o
  servidor travado DE VERDADE, que é o que a trava de um colega é, o lote inteiro volta RECUSADO em
  cerca de um segundo, a cópia no destino é desfeita, a camada continua cheia na origem, o motivo
  do servidor aparece num toast e os problemas ficam na fila. "Foi levada" e "a camada vazia
  continua" eram falsos justamente no caso para o qual a frase existe. O duplicado some sozinho nos
  DOIS desfechos, para lados opostos, e a frase passou a dizer os dois sem prometer qual. O spec
  ganhou o caso da trava real, e o caso da trava local perdeu a leitura imediata da árvore, que
  reprovou 1 vez em 5.
- **Guardas:** `backend/tests/integration/atomic-atlas-import.test.js`,
  `frontend/tests/unit/atlas-sobe-com-figura-orfa.test.js`,
  `frontend/tests/unit/enviar-blob-com-id-novo.test.js`,
  `frontend/tests/e2e-ui/cadeia-completa-atlas.spec.js`,
  `frontend/tests/unit/transferencia-de-camada-frase.test.js`,
  `frontend/tests/e2e-ui/browser-collab-transferencia-origem-cheia.spec.js` e
  `frontend/tests/integration/abertura-remota-aplica-dois-retratos.repro.test.js`.

### 2026-09-21: o lote F, seis agentes em paralelo sobre as reprovações da suíte de tela, e três delas eram do teste

Contexto: a rodada completa do Playwright fechou com 17 reprovações e 471 aprovados. Nenhuma era
instável, e cada uma foi atribuída antes de ser tocada.

- **A camada de tablet era recolhida pelo config errado (9 das 17).** `playwright.tablet.config.js`
  nasceu em 2026-09-20 com `testMatch: '**/*.tablet.spec.js'`, e esse sufixo TAMBÉM casa o
  `'**/*.spec.js'` do config padrão, que as rodava em Chrome de mesa, onde reprovam por construção.
  Nomear uma spec por sufixo não a separa de nada: quem cria um config derivado tem de excluir as
  specs dele do config pai no MESMO commit. Hoje o padrão exclui `*.tablet.spec.js`
  incondicionalmente, a camada tem `npm run test:e2e:tablet` (não tinha script nenhum, então
  ninguém a rodava), e o config dela recolhe também `_backend-required.spec.js`, porque uma spec
  tirada da rodada padrão sai de baixo do guarda que acusa verde por pulo. Os quatro configs de
  cenário continuam sem esse guarda, declarado e não fechado.
- **O painel de pendências deixou de abrir sem rede, e a regressão era minha (1 de 17).** O
  bisect apontou `c07d6dff`, o commit da manhã que parou de sincronizar a contagem de cores. O
  pré-carregamento do painel tinha UM gatilho, o tom da luz saindo de "tudo enviado", e na
  abertura de um atlas de servidor quem tirava a luz desse estado era, por acidente, a operação de
  contagem de cores. O cabeçalho do spec descrevia o acidente como desenho. Hoje o gatilho é
  DETERMINÍSTICO: sessão viva, atlas de servidor e conexão ONLINE (`_precarregarPorConexao`,
  `frontend/src/js/account/sync-status.control.js`), com o gatilho por tom como segunda via. O
  preço declarado: todo atlas de servidor baixa os 76 kB de fonte do painel na abertura, fora do
  boot anônimo, que é o medido pelo teto. Armadilha de instrumento medida no caminho: contar carga
  de módulo por `performance.getEntriesByType('resource')` dá zero para qualquer coisa tardia numa
  página que serve mais de 600 módulos, porque o buffer para em 250 entradas em silêncio.
- **O import aditivo reprovava por um campo que o produto não lê (1 de 17).** O caso lia `map.name`
  do documento cru no disco, e o mapa em branco semeado no boot nunca teve `name`, `id` nem `sync`:
  é gravado como conteúdo, e os sete leitores de nome do produto resolvem pela CHAVE quando ela não
  é um identificador, regra de 2026-09-07 adotada depois de uma perda medida. O caso passava
  porque entrar num mapa persistia o mapa base de recuo por `saveMap`, que carimba o nome; quando o
  mapa base virou vista da pessoa (`543c9e37`, 2026-09-20, decisão correta), o efeito colateral
  sumiu. Decisão: o nome de um mapa de atlas local vem da chave, e o spec passou a ler pelo leitor
  do produto. Guarda: `frontend/tests/integration/mapa-semeado-sem-nome.repro.test.js`. Forma
  latente declarada e não medida: `_isMapNameUsedByOther` é o único leitor sem recuo para a chave.
- **O spec de migração media a regra que a decisão do dia revogou (1 de 17).** O caso "main
  reaberta depois da atualização" exigia a tela de recuperação para uma gravação tardia trivial,
  que pela regra nova entra sozinha; sondado no navegador, o registro entra, o destino é o mesmo e
  o produto diz "1 registros" no console. O caso foi reescrito para a regra nova e ganhou um irmão
  que monta um conflito de verdade (`same_unit`, com a versão nova escrevendo por `setMapNotes` num
  mapa que o boot NÃO abre, porque abrir grava a contagem de cores sozinho e deixaria a causa
  ambígua) e exige a tela e o botão de recuperar em outro atlas. As outras três causas de conflito
  continuam com cobertura só de integração.
- **Os três diálogos do menu da conta saem do boot do mapa.** `account.control.js` é um `IControl`
  que `map_sig.js` instancia, então login, "novo atlas" e compartilhar viajavam no payload ansioso
  e só existem depois de um clique com servidor. Passaram a ser buscados no clique por um lançador
  único (`frontend/src/js/modals/account-modals-launcher.js`), no modelo do cadastro de 2026-09-20.
  Medido com build fresco dos dois lados: o mapa foi de 78 arquivos e 4 286 417 bytes para 77 e
  4 218 590, 66 kB a menos (17 kB em gzip); o critério de manter era 30 kB. `atlas.html` continua
  importando login e novo atlas de forma estática, de propósito. O preço é o do cadastro: três
  pontos novos de falha de carga, cada um dizendo a falha e mandando recarregar, nunca "tente de
  novo", porque `import()` que falha fica envenenado.
- **Dois tetos de peso construído estavam vermelhos com build fresco, e a suíte passava verde.**
  `admin.html` em 803 kB contra 790 e `calibracao.html` em 1987 contra 1980. A suíte da raiz passou
  o dia inteiro porque o `dist/` era de 2026-09-20: dist velho dá verde velho. Atribuído com build
  fresco em três commits e o grafo de imports dos dois entries: 758 e 1955 kB em 2026-09-13, 784 e
  1977 na manhã de hoje, 803 e 1987 à tarde; o crescimento do dia são os três commits de migração
  tardia (`late-legacy-plan.js` novo e `legacy-transition.js` maior, que entram pelo portão das
  quatro páginas) mais o seletor pesquisável novo do admin. Tetos recentrados em 830 e 2020, com a
  atribuição escrita ao lado.
- **O ganho de rede do cursor durável foi medido** (200 operações: 117 579 bytes no primeiro
  recarregamento, 66 no segundo; detalhe na wiki do namespace), e ganhou spec que afirma a rede.
- **O spec de primeira pessoa não é instável pela carga da cena, e a causa da falha "contêiner
  escondido" é o cache do `/api/config`.** Em 16 execuções isoladas as 44 esperas pelo contêiner
  foram satisfeitas com pior caso de 3,3 s, sem queda de renderizador, e a falha não reapareceu;
  ela só reaparece na rodada COMPLETA (1 em cada uma das duas do dia), e o trace dela trazia
  "scene not found: museu-1cgeo". O tileset é semeado por SQL, o harness liga o memo do
  `/api/config` de propósito (com invalidação só na escrita pela API e TTL de recuo de 30 s), e a
  página abria com o catálogo que o spec ANTERIOR aquecera, sem a cena; o visualizador registra o
  erro, esconde o contêiner e retorna sem lançar. Reproduzido de forma determinística com um spec
  vizinho aquecendo o cache logo antes: reprova sem o conserto, passa com ele. O conserto é
  `esperarCatalogoServido`, no helper de semeadura, que espera o catálogo SERVIDO refletir a linha
  antes de qualquer página abrir; os outros cinco specs que semeiam catálogo por SQL ficam com a
  mesma fresta e não foram tocados. O que reprova de outra causa, 3 em 16, é o comentário
  espacial não chegar ao Postgres em 10 s, e isso não foi investigado. Achado de produto no caminho: um Worker que não carrega deixa
  `parseSplatData` do motor pendurado para sempre, sem rejeitar e sem limite de tempo (439 ms com
  o worker alcançável, mais de 280 s sem uma linha de erro sem ele). O gatilho foi ambiental (o
  `node_modules` por junção dos worktrees de agente faz o `new URL` do pré-bundle do Vite sair da
  raiz do servidor), e é por isso que esse spec só mede o produto na árvore principal.

### 2026-09-22: o lote Q, quatro agentes sobre o que sobrou da suíte de tela, e duas premissas do plano caíram na medição

- **O comentário espacial que não chegava ao Postgres em 10 s NÃO era recusa, era a thread
  principal.** Medido em 18 execuções na árvore principal: o contexto do clique era idêntico ao da
  abertura (mapa, sessão, permissão), o cartão sempre fechou, zero `STORE_OPERATION_BLOCKED`. A
  escrita local custa cerca de 3 s e quase não varia; o que varia é a op já enviável esperando o
  flush, de 0,2 a 11 s, porque a cena de primeira pessoa deixa a página a dois quadros por segundo
  no harness sem GPU e o ciclo de flush caminha a fila inteira a cada tique de 1,5 s
  (`hasWorkToFlush` e depois `engine.flush`, cada caminhada de 4 s naquela condição, laço sempre em
  voo). Não é defeito de produto; é orçamento apertado para uma página nessa condição. Os três
  eventos de comentário entraram em `FLUSH_TRIGGER_EVENTS` (`frontend/src/js/store/sync/sync-flush.js`),
  porque têm produtor local e comentar é o gesto em que a pessoa mais espera o colega reagir; o
  spec passou a esperar por estado em degraus e pelo POST de sync antes do veredito. Prova: 8 de 8
  em série depois, contra 3 reprovações em 16 antes. **Aberto, declarado:** a caminhada dupla da
  fila por ciclo de flush é o lead mais forte para um ganho real de produto; e a recusa por mapa ou
  sessão em `aoEnviar` das superfícies que não são o 2D (primeira pessoa, 360, 3D) é MUDA, porque
  não passa por `guardComment`, embora não tenha sido exercitada uma vez sequer.
- **Um Worker que não carrega deixava o motor de primeira pessoa pendurado para sempre, e o teto
  é nosso.** O motor pinado decide `parseSplatData` só por mensagem do worker, sem `onerror`, e
  memoiza a URL do blob do worker pelo resto da vida da página (base errado fica errado). O teto de
  30 s mora em `frontend/src/js/first_person_3d_tool/splat-parse-timeout.js`, folha de zero imports,
  e é cerca de setenta vezes os 439 ms medidos com o worker de pé. O erro dele NÃO carrega `status`
  HTTP, contra o enunciado da tarefa e com razão: o servidor respondeu 200 com todos os bytes, e
  carimbar 504 faria o painel imprimir um código que ninguém observou; viaja `code`. A frase manda
  recarregar, nunca "tentar de novo". Medido no navegador: 31 195 ms do clique ao toast, e sem o
  teto nada aparece em 90 s. O worker num worktree por junção responde 403, e não 404 como a nota
  do lote dizia.
- **A fresta do memo do `/api/config` desceu para dentro dos semeadores, e o preço não era o
  suposto.** Só `seedTileset` e `seedBasemap` escrevem em tabela que o payload lê (`tilesets` é
  lista, `basemaps` é objeto chaveado por id, e nenhuma expõe `access_level`, então presença no
  payload anônimo é exatamente "pública e ativa": linha pública espera aparecer, privada espera
  sumir). `seedSv360Photo` e `seedModelo3d` não esperam, por medição. **Duas premissas do plano
  caíram:** os cinco specs dados como expostos passavam todos com o memo aquecido, porque nenhum
  resolve o id pelo `config` do cliente (os de Cesium usam o id só como referência de op, e o gate
  é SQL do servidor; os outros dois semeiam linha privada, que chega por uma rota não memoizada);
  e o custo não é "uma ida ao `/api/config`", é o RESTO DO TTL, 28 343 ms com o memo quente contra
  214 ms vencido, e duas semeaduras seguidas custam 58 885 ms porque a primeira rebobina o TTL.
  Decisão: a espera fica LIGADA por padrão, porque desligá-la reabriria a fresta para o próximo
  consumidor, que é a classe que o helper fecha; e os nove sítios dos specs de Cesium mais o do
  360 desligam com `esperarCatalogo: false` e o motivo medido na linha, que é onde o custo tinha
  consumidor pagando por nada. A espera anuncia no stdout quando de fato esperou. **Aberto,
  declarado:** o índice de modelos 3D é um memo de 60 s pendurado na mesma invalidação, e o
  semeador dele não tem porta de espera sem o arquivo em disco.
- **Os configs de cenário do Playwright passaram a coletar o guarda de verde por pulo, sob censo,
  e o defeito alcançável era um só.** Detalhe na regra de testes.
- **Guardas:** `frontend/tests/integration/sync-flush.test.js`,
  `frontend/tests/unit/teto-de-analise-do-splat.test.js`,
  `frontend/tests/unit/semeador-de-catalogo-espera-o-servido.test.js`,
  `frontend/tests/unit/configs-do-playwright-coletam-o-guarda.test.js` e
  `frontend/tests/e2e-ui/first-person-collaboration.spec.js`.

### 2026-09-22: a atualização se conserta sozinha, e a tela de recuperação fica com duas saídas

- **Decisão (dono):** "A migração deve ser o mais resiliente possível e, se falhar, a tela deve ter
  apenas duas opções: baixar o `.ebgeo` atual (ou o arquivo de restauração, se não for possível) e
  o botão de continuar, que zera o IndexedDB e abre." O dono foi avisado dos dois preços antes de
  mandar seguir: perde-se a escolha manual de recuperar as alterações tardias em outro atlas, e
  sai a restauração pela tela (a cópia bruta continua existindo como saída, mas reabri-la deixou de
  ser auto-serviço).
- **O que isto SUPERA:** a segunda metade da decisão de 2026-09-21 sobre a gravação tardia ("a tela
  fica para o conflito"). A primeira metade continua inteira: o caso trivial é absorvido pelo
  portão. O que mudou é o conflito: a saída conservadora que a tela oferecia num botão passou a ser
  TOMADA, não oferecida, porque ela é a única que não perde trabalho e não há como a pessoa julgar
  a outra. A regra do plano (`planLateLegacyChanges`) não foi tocada e os testes dela passam sem
  uma linha alterada; `prepareLegacyTransition` continua lançando `legacy_changes`. Mudou só o que
  o chamador faz com o lançamento.
- **Os dois reparos, e por que cada um tem orçamento** (`prepareLegacyTransitionResiliente`,
  `frontend/src/js/store/migration/transicao-resiliente.js`, fora de `ui/` para o orçamento ser
  medido em node). `source_changed` e `copy_failed`: a cópia é refeita do zero DUAS vezes, porque a
  causa quase sempre é outra janela gravando durante a cópia, e uma janela que grava uma vez tende
  a gravar de novo; a origem nunca é escrita, então cópia abandonada custa disco e a poda de boot a
  recolhe. `legacy_changes`: o que a versão antiga gravou vai para um atlas local NOVO
  (`recoverLateLegacyChanges`), UMA vez, porque cada execução cunha outro atlas, o registro guarda
  dez, e uma janela antiga que continue gravando gastaria os dez num boot só. O reparo que falha
  NÃO substitui a causa: a tela nomeia o erro original. O reparo vale nos DOIS sítios, o portão de
  boot e o vigia em sessão, senão a mesma pessoa veria a tela ou o toast conforme a janela.
- **A tela: uma, com duas saídas e treze causas.** Cada `code` mantém a frase dele, porque "o que
  aconteceu" é a única parte sobre a qual a pessoa pode agir; o que ela pode fazer é sempre o
  mesmo. "Baixar meus dados" tenta o `.ebgeo` primeiro e cai para a cópia bruta dizendo qual
  entregou e por que o outro não foi possível. "Continuar" pergunta uma vez, nomeando a contagem
  que o inventário acabou de ler, e apaga tudo o que esta origem conhece, com o banco global por
  último, porque até ali ele é a única coisa que nomeia o resto; um delete que não confirma para o
  gesto inteiro, e a frase diz que nada foi apagado. Enquanto a pergunta está na tela o comando
  se esconde, porque dois botões vermelhos um sobre o outro liam como dois atos (visto na
  captura). O `.ebgeo` da tela não passa pelo exportador normal, que lê o barril da store ainda não
  hidratado e devolveria um atlas VAZIO sem falhar: a folha nova lê os bancos de um escopo e tenta
  cada endereço que o mapa já teve, porque a regra de chave das lojas laterais mudou ao longo da
  vida do produto. Um `.ebgeo` é um atlas, então com mais de um acervo vivo a saída é a cópia bruta.
- **Um caso em que "Continuar" não resolve, declarado:** `api_unavailable`. Ali o portão já
  concluiu a migração (ele roda antes do `GET /api/config`), o "Baixar" entrega um `.ebgeo` do atlas
  inteiro, e "Continuar" apaga tudo e recarrega para a mesma tela de servidor fora do ar. A
  confirmação com a contagem é a única proteção; a frase daquela causa não avisa que continuar não
  abre o mapa enquanto o servidor não responder. Decisão do dono, se quiser a frase.
- **Alternativas recusadas:** deixar "Tentar novamente" (os reparos que ele existia para repetir
  são automáticos, e ele seria um botão que não muda nada); apagar só a origem sem sufixo, como
  fazia a D8 (enquanto qualquer banco de um acervo quebrado estiver no disco o portão volta à
  mesma tela, e "continuar" só é verdade se o produto abre); baixar sempre a cópia bruta (completa,
  mas desde que a restauração saiu só a equipe a reabre).
- **Aberto, declarado:** `dropLegacySource` e `describeLegacySource` perderam o chamador de
  produção e continuam por causa dos testes e do estado `DROPPING_SOURCE` que só eles escrevem; e
  o apagar confia em `dropAtlasDatabases` para esquecer geração e cerca de escrita, sem cenário de
  ponta a ponta com geração ativa.
- **Onde ficou preso:** `frontend/tests/integration/transicao-resiliente.test.js`,
  `frontend/tests/integration/tela-de-recuperacao-duas-saidas.test.js`,
  `frontend/tests/unit/migracao-frases-de-apagar-origem.test.js` e
  `frontend/tests/e2e-ui/browser-migracao-2.2.spec.js` (o conflito que não para mais o boot, o
  toast que nomeia o atlas, o `.ebgeo` com 11 mapas e 262 feições lido pelo leitor do produto, e
  "Continuar" apagando 40 registros e abrindo limpo). Controles negativos por cópia de arquivo:
  quatro do agente, com 4 de 7, 16 de 20, 3 de 20 e 1 de 8 reprovando, mais o do comando que se
  esconde. Navegador: 20 de 20 em duas passadas no worktree, 10 de 10 na árvore principal, e a tela
  lida como imagem.

### 2026-09-22: o cenário de ida e volta do dono passou a ser medido com a main de verdade

- **Contexto (do dono):** "1) Criar feições na versão do branch main 2) migrar para versão do
  integração backend 3) abrir na versão do branch main novamente e editar 4) abrir no integração
  backend novamente." `frontend/tests/e2e-ui/browser-migracao-2.2.spec.js` encena a linha anterior
  ESCREVENDO o disco dela (fixture 2.2 mais o tab-lock do commit 8b611113 importado numa página em
  branco) e nunca roda uma linha do app da main, então não responde a essa pergunta.
- **O instrumento:** `frontend/tests/helpers/main-round-trip.mjs` (script `test:e2e:ida-e-volta`
  do pacote web). Sobe o backend real pelo mesmo `global-setup` do Playwright, serve o `dist/` da
  main e o da integração ALTERNADOS na mesma porta com `/api` em proxy, e dirige um perfil
  Chromium persistente pelos quatro passos, em duas variantes com perfis separados: `trivial` (a
  integração só abre no passo 2) e `conflito` (a integração edita a nota do MESMO mapa no passo 2,
  que é `same_unit` na regra do plano). As feições nascem de gesto na barra da main, o IndexedDB
  é lido nativamente e nunca escrito (harness que semeia o disco mede a si mesmo), e o chunk de
  entrada do `index.html` de cada `dist/` é o que prova QUAL build a página executou, independente
  do que o script serviu. Ele é irmão de `frontend/tests/helpers/main-profile-upgrade.mjs`, que
  exige o acervo externo (`EBGEO_MIGRATION_DATA_DIR`) e por isso não roda na maioria das máquinas.
- **O que ele mediu, e a main de 2026-09-11 boota contra o backend de hoje** (zero `pageerror` nos
  oito boots de uma rodada; o único ruído é o 404 do preflight do 360, que não impede nada).
  Trivial: 3 feições nascem na main nos bancos sem sufixo; a integração as vê no atlas atualizado
  e na árvore de camadas, com `schemaVersion` 3.0 e UM atlas registrado; a main reabre o próprio
  acervo, vê as 3 e cria mais 2, sem alcançar o destino; a integração volta SEM tela com as 5, uma
  cada, zero duplicata, um atlas. Conflito, sob a regra de duas saídas do mesmo dia: a nota da
  integração não vaza para a main, a main reescreve a mesma nota, e no passo 4 o mapa abre sem
  tela, com o toast nomeando o atlas de recuperação, DOIS atlas (o atualizado com as 3 e a nota
  da integração, o recuperado com as 5 e a nota tardia da main) e a união por nome igual às 5.
  Três rodadas em série na árvore principal, 31 de 31 e 38 de 38 por rodada, e a captura do
  passo 4 lida como imagem: o mapa da integração com os pontos e o toast por cima. Controles
  negativos do agente, por cópia de arquivo sobre `planLateLegacyChanges`: sempre CONFLICT reprova
  em "a gravação tardia trivial não para o boot" e sempre NOTHING reprova em "as CINCO feições
  estão no atlas atualizado", asserções distintas e opostas.
- **Um fato sobre a MAIN, não sobre a integração, que custou três rodadas vermelhas.** Na main o
  nome de feição não vai ao store no Enter: `updateFeaturesProperty` toca só a fonte do MapLibre e
  a feição em memória, e quem grava é `saveFeatures`, disparada pelo botão Salvar que o painel só
  tem depois de renderizar por inteiro. Um deselect que chega antes do botão existir perde a
  edição em silêncio (medido: painel com o nome novo, disco com `Ponto #3`, quarenta iterações
  depois ainda o mesmo). É caminho real de perda de edição na main, fora do alcance desta linha do
  produto, e fica declarado para quem ainda a usa.
- **O que NÃO mede, declarado:** só ponto (linha e polígono fecham por gesto próprio na main, com
  modo de falha próprio, e cinco pontos determinísticos valeram mais que uma geometria a mais);
  nem link público nem login, porque o cenário do dono é local e anônimo nas duas pontas. E ele
  depende de dois `dist/` que o git não versiona: o da main, no worktree que o script aponta por
  padrão (ou `EBGEO_MAIN_CHECKOUT`), e o da integração, que tem de ser reconstruído depois da
  última escrita, senão a medição é do build velho.
- **Status:** aceita.

### 2026-09-22: o snap some para quem não desenha, e some também no mapa travado

- **Contexto (do dono):** "esconder snap no somente leitura, ou no bloqueado, ou comentário". O
  interruptor de snap da barra aparecia para Leitor e Comentarista num atlas de servidor. A trava
  do mapa já o escondia (a passada de trava da barra percorria os interruptores); o posto não,
  porque o interruptor não lia a bandeira `requiresEdit` que desfazer e refazer já liam, e por isso
  não levava a marca `edit-affordance`.
- **Decisão:** o snap é modificador de desenho e existe só onde há desenho. Ele some pelo POSTO
  (Leitor, Comentarista) e também pelo ESTADO (mapa travado). A segunda metade contraria de
  propósito a regra "o ESTADO recusa o clique", pelo mesmo argumento da alça de continuação de
  linha (`.claude/rules/architecture.md`, seção da continuação pela ponta): com o mapa travado
  todas as ferramentas que o snap modifica já sumiram, e um snap desenhado com `aria-disabled`
  seria a única superfície acionável de uma barra inerte, cujo clique não ensinaria nada que a
  ausência das ferramentas já não diga. Enquanto escondido o snap não age, com o Ctrl inclusive, e
  a preferência da pessoa (`ui.snapping.enabled`) não é escrita: quando a condição cai, o botão
  volta mostrando o estado que ela deixou.
- **Onde mora:** a regra em `frontend/src/js/snapping/snap-availability.js` (folha sem imports,
  `isSnapAvailable` e `isSnapEffective`); a barra lê `requiresEdit` da tabela
  (`frontend/src/js/toolbar/toolbar.constants.js`) pelo mesmo ajudante das ações; o serviço de snap
  recebe a regra por injeção em `frontend/src/js/map_sig.js`, perguntada à conta única dos dois
  eixos (`edicaoIndisponivelSync`). Guarda: `frontend/tests/unit/snap-some-sem-edicao.test.js`.
- **Alternativas rejeitadas:** desenhar o snap no mapa travado e recusar o clique nomeando a trava,
  pelo motivo acima; desligar o snap escrevendo `ui.snapping.enabled` como falso ao esconder, porque
  apagaria a escolha da pessoa e exigiria lembrar o valor antigo em algum lugar para devolvê-lo;
  importar a store dentro do serviço de snap, porque ele é carregado por suítes em node puro e roda
  em todo movimento de mouse.
- **Consequências:** o modo de visualização voluntário (Shift+E) também esconde o snap, porque a
  marca é a mesma que esconde as barras de desenho ali; nesse modo o snap continua valendo para um
  Editor que ative uma ferramenta pelo teclado, como as próprias ferramentas continuam.
- **Status:** aceita.

### 2026-09-22: o menu do clique direito deixa de oferecer "Exportar QAN", para geometria nenhuma

- **Contexto (do dono):** pedido de tirar o QAN do menu de botão direito do polígono. Desde
  2026-09-20 o menu o oferecia só para polígono (a linha tinha saído naquela data, também a pedido).
- **Decisão:** o menu de contexto do mapa não oferece "Exportar QAN" para geometria nenhuma. O item,
  o handler e o portão puro que decidia "só polígono" saíram de `frontend/src/js/context-menu/`; o
  portão foi APAGADO, e não deixado como predicado sem leitor.
- **O que fica:** a exportação continua pela aba Azimutes do painel da feição, para linha e
  polígono (`createObservationsSection`,
  `frontend/src/js/tool_manager/helpers/observations-editor.helpers.js`), porque essa porta não fez
  parte do pedido. O gerador `generateQAN` não muda.
- **Guarda:** `frontend/tests/unit/qan-fora-do-menu-de-linha.test.js`, que varre a PASTA do menu, e
  não só o controle, e prende na outra metade que a porta do painel continua existindo. O tutorial
  (`frontend/public/docs/README.md`) deixou de prometer o item.
- **Status:** aceita.

### 2026-09-22: a caixa "Projeção globo" sai da Administração, e a chave de deploy é podada de ponta a ponta

- **Contexto (do dono):** na aba Sistema de `admin.html`, a caixa "Projeção globo" parecia
  invertida: desmarcada, o mapa continuava globo.
- **Causa:** não era inversão, era caixa inerte. Em 2026-08-16 a projeção virou escolha do ATLAS
  (`atlas.settings.globeProjection`, globo por padrão) e o mapa parou de ler a config de deploy;
  a chave `map2d.globe_projection` continuou sendo gravada pela aba, validada pelo Joi, fundida pelo
  servidor e servida por `GET /api/config`, sem nenhum leitor no cliente, por um mês. O servidor
  estava coerente consigo mesmo; o que faltou foi podar a chave quando o leitor saiu.
- **Decisão (do dono):** a decisão de 2026-08-16 VOLTA A VALER inteira. O padrão é SEMPRE globo, e
  quem muda é o atlas, pela barra "Globo / Plano" das configurações dele. A caixa sai da aba
  Sistema, e a chave sai dos dois pacotes: do piso de `frontend/src/js/config.js`, de `MAP2D_BASE`
  (`backend/src/modules/config/config.static.js`), do importador do legado
  (`dev/import-config-catalog.mjs`) e do schema, que passa a RECUSÁ-LA com 422 nomeado
  (`Joi.any().forbidden()`, o mesmo gesto da faixa de zoom, porque `map2d` é `.unknown(true)` e uma
  chave só apagada voltaria a ser gravada em silêncio). O modal do atlas acende a barra por
  `resolveGlobeProjection`, a mesma função que o mapa usa, e o texto "Todo atlas começa como globo"
  continua verdadeiro.
- **O dado já gravado:** a instalação que salvou a caixa antes da atualização tem a chave na linha
  `app_config`. Ela é DESCARTADA na leitura e na fusão, pelo desenho de `podarZoomDeAplicacao`:
  `podarProjecaoDoPainel` (`backend/src/modules/config/config.service.js`) roda em
  `getConfigOverrides`, que alimenta o `GET /api/config` e o eco `overrides` do painel, e na escrita,
  onde a linha cicatriza no primeiro salvamento seguinte. Salvar pelo painel não reprova, porque o
  schema valida só o corpo que chega e a aba não manda mais a chave; quem ainda a mande (uma aba
  aberta antes da atualização) leva 422 nomeando o campo, em vez de um 200 sobre nada.
- **Alternativa recusada:** uma primeira versão do mesmo dia REANIMOU a chave, como padrão do atlas
  que não escolheu (duas camadas, com uma folha de regra compartilhada entre o mapa e o painel). O
  dono a recusou no mesmo dia: o padrão é sempre globo, e quem muda é o atlas. Aceitar a chave no
  corpo e ignorá-la também foi recusado, porque reproduz o defeito podado: um 200 que não faz nada.
- **Guardas:** `frontend/tests/unit/projecao-globo-do-painel.repro.test.js` (o resolvedor não lê
  config de deploy, a aba não desenha a caixa nem manda a chave, a casca não a declara, o servidor
  não a serve e a recusa, o modal acende o valor efetivo), `frontend/tests/unit/atlas-appearance.test.js`
  (com `config.map2d.globe_projection: false` plantado, o atlas sem escolha continua globo) e o caso
  de `globe_projection` em `backend/tests/integration/config-admin.test.js` (a linha antiga, escrita
  direto no banco, não quebra a leitura, não é servida, cicatriza no salvamento seguinte, e o corpo
  que a mande leva 422).
- **Status:** aceita. Supera a versão reanimada, que não chegou a ser commitada.

### 2026-09-22: o administrador informa o e-mail ao criar a conta, e o endereço novo nasce pendente

- **Contexto (do dono):** dois pedidos. Na aba "Minha conta", a pessoa define ou altera o próprio
  e-mail; na criação de usuário pela Administração, o administrador informa o e-mail. O primeiro já
  existia desde 2026-08-23 (`PUT /users/me/email`, convite para a caixa nova com a senha atual, a
  resposta uniforme contra enumeração e a conta intocada até o clique); o que faltava era a tela
  dizer "Cadastrar" sobre a conta sem endereço e dizer quem cadastra onde o servidor não entrega
  e-mail. O segundo não existia: `createUserAdminSchema` não tinha o campo.
- **Decisão:** a criação administrativa aceita `email`, opcional. Com endereço, a conta nasce
  PENDENTE, salvo se o mesmo pedido mandar `email_verified: true`, que é a regra da edição
  (`resolveAdminEmail`) aplicada a uma linha nova (`resolveCreationEmail`,
  `backend/src/modules/users/users.service.js`). A pendente recebe o MESMO link `?verify=` do
  auto-cadastro, depois do COMMIT e só onde `canDeliverAccountMail` vale. Endereço tomado responde
  409 com o motivo, como na edição administrativa. A trilha de `USER_CREATE` diz se houve endereço e
  se ele foi declarado conferido, nunca o endereço.
- **Alternativas rejeitadas:** nascer confirmada por padrão, que manteria a conta entrando na hora,
  porque o endereço confirmado é o canal de recuperação de senha e um erro de digitação entregaria o
  código de recuperação a um estranho; guardar o endereço só no token, como a troca do titular, que
  não reserva nada e não tranca o login, porque o administrador não veria o que gravou, a mensagem
  de "troca de e-mail" seria a errada para uma conta nova e numa produção sem relay o endereço nunca
  chegaria à conta; tornar o campo obrigatório como no auto-cadastro, porque a conta sem endereço
  continua sendo o estado legítimo deste caminho.
- **O que a tela corrige junto:** a caixa "E-mail verificado" do formulário de edição nascia com o
  estado guardado e era enviada sempre, então corrigir o endereço de uma conta confirmada sem tocar
  nela mandava a confirmação para um endereço que ninguém conferiu, e limpar o endereço com a caixa
  marcada gravava confirmado sobre NULL. Hoje a caixa mora ao lado do campo nas duas telas, aparece
  só com endereço, desmarca quando o endereço muda, e a marca só viaja com endereço
  (`frontend/src/js/admin/user-email-model.js`).
- **Consequência que se lê errado:** a conta criada com endereço e sem a marca NÃO entra na hora; o
  erro de login oferece o reenvio do link, e numa produção sem relay quem a destranca é o
  administrador (botão Aprovar da linha, ou a caixa). A dica do formulário e o aviso depois de criar
  dizem isso antes e depois do clique.
- **Guardas:** `backend/tests/integration/admin-cria-conta-com-email.test.js`,
  `frontend/tests/unit/admin-email-na-criacao.test.js`, o bloco novo de
  `frontend/tests/unit/recuperacao-e-email-espelham-servidor.test.js` (o cliente nunca recusa o que o
  servidor aceita) e o de `emailSectionCopy` em `frontend/tests/unit/conta-email-modelo.test.js`.
- **Status:** aceita.

### 2026-09-22: a vista da pessoa passa a ser LEMBRADA neste computador, por mapa, e continua sem viajar

- **Contexto (do dono):** "apesar do basemap e controle temporal não sincronizarem, ele tem que
  salvar a preferência do usuário naquele mapa localmente". Desde 2026-09-20 a base escolhida e o
  liga/desliga da linha do tempo moravam em memória, e um F5 devolvia a pessoa à vista salva do mapa.
- **Decisão:** o GESTO da pessoa (o seletor de mapa base e o interruptor sem `automatico`) é
  lembrado neste computador, por atlas e por mapa, em `localStorage`
  (`frontend/src/js/store/vista-da-pessoa.js`, sobre a folha `frontend/src/js/store/vista-da-pessoa-disco.js`).
  Nada disso vira op, entra no retrato, na fila de saída ou no banco de ajustes do atlas, e o
  gesto continua sem perguntar por papel nem por trava. A precedência na ENTRADA do mapa (troca de
  mapa, F5, reabrir o atlas) é: a lembrança da pessoa, quando válida; senão a vista salva; senão o
  que já valia (a tela fica, ou a base do documento na primeira pintura). A câmera não é lembrada.
- **Onde, e a alternativa recusada:** o banco de ajustes do namespace foi recusado, por três fatos
  do código: os bancos de dado de um atlas de servidor são geracionais (todo retrato completo os
  refaz, e a chave sumiria calada na próxima reparação de catálogo); "Salvar como local" copia
  aqueles bancos e poda só as referências que conhece, e um id de mapa base privado sairia por
  fora; e a entrada lê isso dentro de `setCurrentMap` e de `switchMap`, onde uma leitura síncrona
  com a chave do namespace capturada no mesmo tique não tem como responder por outro atlas. O
  banco global foi recusado pelo mesmo motivo da leitura síncrona. A chave é o sufixo do banco, e o
  mapa é chaveado pelo ID (nunca pelo nome, pela lição da contagem de cores); o mapa local legado
  sem id fica pelo nome e é levado no rename.
- **Por pessoa:** num atlas de servidor lembra-se para a conta que entrou, e outra conta no mesmo
  computador não lê nem herda (o registro tem dono e é substituído na primeira escolha dela). Num
  atlas local o dono é o computador, como a vista salva dele. O visitante de link público não é
  lembrado: o namespace dele é destruído no boot seguinte sem sessão, e a vista dele vale pela visita,
  em memória, como antes.
- **Salvar e restaurar:** salvar a vista ESQUECE a lembrança de quem salvou, campo por campo (o que
  a vista não levou fica), e "Restaurar posição" esquece tudo daquele mapa, então os dois gestos que
  alinham a tela com a vista salva devolvem a pessoa a segui-la. A lembrança dos outros é deles.
  Recusado: gravar os valores salvos COMO lembrança de quem salvou, que o congelaria naquele
  salvamento e faria um colega salvando depois nunca o alcançar.
- **Validade:** uma base lembrada que o catálogo da pessoa não oferece é pulada sem aviso (o aviso
  de base que não resolve continua sendo só de `switchLayer`) e FICA guardada, porque uma concessão
  que chegue depois a torna válida na próxima entrada.
- **Ciclo de vida:** a lembrança morre com o namespace (`clearAtlasDatabases`, `dropAtlasDatabases`)
  e com o wipe de conteúdo (`clearAllAtlasStores`); a reabertura de atlas não a apaga. Ficam de fora,
  declarados: a cópia de atlas local, o clone, "Salvar como local" e o `.ebgeo` não a levam.
- **Guardas:** `frontend/tests/integration/vista-da-pessoa-lembrada.test.js` (F5, precedência, por
  conta, nada na fila nem no banco de ajustes, morte com o atlas, salvar alinha quem salvou),
  `frontend/tests/unit/vista-da-pessoa-disco.test.js` (formato, dono, teto, degradação muda) e os
  blocos novos de `frontend/tests/integration/mapa-base-e-vista-da-pessoa.repro.test.js` e de
  `frontend/tests/integration/temporal-interruptor-e-vista.test.js`.
- **Status:** aceita. Supera a metade "Onde a escolha pessoal mora" da entrada de 2026-09-20.

### 2026-09-22: a presença sai quando a pessoa sai, e diz em qual visualizador ela está

- **Contexto (do dono):** dois relatos. "Tem algo errado na presença, ainda diz que tem usuário
  presente mesmo que depois de sair", e o pedido de saber, na tela de presença, em qual foto 360 ou
  em qual modelo 3D cada pessoa está.
- **Diagnóstico do primeiro, por superfície, lido no caminho vivo.** A lista do MAPA tinha um
  fantasma PERMANENTE e três transitórios. O permanente: o servidor anuncia `user_left` na hora e
  manda o cursor num lote por sala no tique seguinte (`enfileirarCursor`), então o último quadro de
  quem fechou a aba saía DEPOIS do anúncio, e `setCursor` do armazém cria a entrada quando a chave é
  desconhecida; a pessoa voltava à lista sem nome e nada mais anunciaria a saída dela. É provável
  sempre que o mouse ainda anda no fechamento, e quase certo na cena caminhável, que republica a
  pose a cada segundo. Os transitórios: as cenas 3D e 360 só repintam em evento de cursor e de
  seleção, e a saída não emitia nenhum dos dois; o `1006` do socket zumbi de quem já reconectou
  anunciava `user_away` que nada limpava; e a conexão PRÓPRIA caída congelava a lista inteira. O
  PAINEL DO ADMINISTRADOR tinha a outra metade: a linha de `uso_presenca` só deixava de contar
  quando a janela de 90 s passava, e a aba oculta nem pulsava.
- **Decisão 1, a lista do mapa:** o servidor descarta o cursor pendente de quem sai, no ramo de
  `removeConnection` que anuncia (`descartarCursorPendente`); o armazém põe a chave que saiu numa
  lápide de 30 s contra quadro de percepção atrasado, desfeita pelo `user_joined` de quem recarrega
  e pelo retrato novo; `userLeft`, `clear` e `setInitial` avisam as superfícies que perderam alguém;
  o `1006` com gêmeo vivo do mesmo par `(userId, clientId)` sai em silêncio (`temGemeoVivo`); e a
  ponte esvazia a lista quando a própria conexão sai de ONLINE. A graça de `away` para a queda de
  rede de um colega continua como estava.
- **Decisão 2, o painel do administrador:** o pulso ganha uma SAÍDA explícita no `pagehide`
  (`saindo: true`, com `keepalive`), que apaga a linha só se o último pulso foi do MESMO documento
  (coluna `aba_id` em `uso_presenca`, acrescentada por `backend/src/database/migrations/012_presenca_aba_e_miniaturas.sql`: a primeira tentativa editou a base de uso e presença, e foi desfeita no mesmo dia porque o stack de teste do servidor já aplicou as bases e guarda dados dos testadores);
  as abas irmãs são avisadas e pulsam na hora; e a aba OCULTA passa a pulsar, porque a pergunta do
  painel é quem está com o produto aberto. A janela de 90 s fica como rede de segurança do que não
  avisa. O pulso ao ENTRAR em segundo plano continua de fora, agora de propósito, porque ele antecede o `pagehide` e chegaria depois
  da saída.
- **Decisão 3, o contexto de visualizador, e onde ele aparece:** na LISTA DE QUEM ESTÁ ONLINE do
  mapa, e não no painel do administrador. É a tela que já diz "em que mapa" por pessoa; o painel só
  conta navegadores, e transformá-lo em lista nominal de onde cada um está seria outro produto (a
  página dele já recusa ler a contagem como desempenho individual). O quadro novo `viewer_context` leva a
  superfície (`3d`, `fp`, `360` ou `2d`) e o IDENTIFICADOR; o NOME sai do servidor, resolvido no
  catálogo, e é entregue POR DESTINATÁRIO: público a todos, privado com nome só a quem
  `fn_can_see_resource` responde sim no escopo do atlas da sala (o empréstimo conta), e com
  `recurso: null` ao resto. O retrato de entrada leva só a projeção que todos leem, e o privado
  chega ao recém-chegado que pode lê-lo num quadro à parte.
- **Decisão 4, o visitante de link público:** o contexto dele NÃO viaja nem fica retido, pela mesma
  razão que prendeu o cursor em 2026-09-20 (ele é contado, não acompanhado). Como destinatário ele é
  julgado com principal nulo e lê o público e o empréstimo do atlas.
- **P1 continua valendo:** o quadro novo não carrega instante nenhum da linha do tempo, e os dois
  guardas estruturais (`frontend/tests/unit/presenca-temporal-nao-volta.test.js` e
  `backend/tests/unit/presenca-temporal-nao-volta.test.js`) não citam nada do que entrou.
- **Alternativas recusadas:** resolver o nome no CLIENTE, pelo catálogo de quem lê (escondia o nome
  da tela e deixava o id privado no fio); mandar o nome pelo REMETENTE (poria na lista de todos o
  que o remetente escrevesse, e o privado junto); apagar a linha do painel pela saída sem conferir o
  documento (a navegação do mapa para `atlas.html` e a aba irmã apagariam navegador aberto); e
  encurtar a janela de 90 s em vez de mandar a saída (cobraria ausência de toda aba oculta
  estrangulada).
- **Decisão 5 (autorizada pelo dono no mesmo dia), o achado que esta entrada abriu:** os quadros de
  cursor e de seleção do 3D, da cena e do 360 levavam `tilesetId` e `photoName` à sala inteira
  desde 2026-09-16, visitante incluído, e a POSIÇÃO de um cursor 3D é uma coordenada geográfica
  sobre o modelo. Eles passaram pela MESMA regra do contexto de visualizador, num módulo só
  (`backend/src/modules/collab/collab.recorte.js`): escopo público vai inteiro a todos, escopo
  privado vai inteiro só a quem `fn_can_see_resource` libera no atlas da sala (empréstimo contando),
  e o resto recebe o quadro REDIGIDO: o cursor sem escopo e sem posição, a seleção vazia na mesma
  superfície. O visitante segue a regra vigente do cursor (sai sem posição) e, como destinatário,
  lê o público e o emprestado. O retrato de entrada leva o escopo privado redigido, e quem pode
  lê-lo recebe cursor e seleção à parte.
- **Por que redigir e não descartar:** o quadro redigido é o que limpa, na tela de quem não enxerga
  o modelo, o último ponteiro 2D do colega e o destaque antigo; descartado, o ponteiro ficaria
  congelado no mapa enquanto o colega está dentro do modelo. O redigido não diz mais que o contexto
  de visualizador já diz (a superfície e o mapa).
- **Identificador que não resolve é privado para todos:** mandá-lo em claro enquanto se esconde o
  privado conhecido faria da redação um oráculo de existência sobre o acervo privado. Os testes que
  usavam nomes inventados de modelo e de foto passaram a semear recurso público.
- **O custo do lote de 2026-08-28 fica:** sem escopo privado no tique, uma serialização por sala;
  com escopo privado, uma por classe de acesso (os destinatários agrupados pelo que podem ver), com
  a pergunta ao banco no memo de 30 s. Alternativa recusada: um payload por destinatário, que é o
  custo que o lote existe para eliminar. As descargas ficaram em série, e o lote confere na saída
  que o remetente ainda está na sala.
- **Guardas:** `backend/tests/ws/presenca-fantasma-apos-saida.repro.test.js`,
  `backend/tests/ws/presenca-escopo-recortado.repro.test.js`,
  `backend/tests/ws/presenca-contexto-do-visualizador.test.js`, os casos novos de
  `backend/tests/integration/monitoramento-presenca.test.js`, `frontend/tests/unit/presenca-saida-explicita.test.js`,
  `frontend/tests/unit/presenca-rotulo-do-visualizador.test.js`, os blocos novos de
  `frontend/tests/integration/presence-store.test.js`, `frontend/tests/integration/presence-bridge.test.js`
  e `frontend/tests/integration/online-users-control.test.js`, e o spec de duas browsers
  `frontend/tests/e2e-ui/presenca-saida-sem-fantasma.spec.js`. Detalhe em
  [presença colaborativa](../wiki/presenca-colaborativa.md) e
  [presença administrativa](../wiki/presenca-administrativa.md).
- **Status:** aceita.

### 2026-09-22: os endereços IP distintos entram no monitoramento, lidos do log que já os gravava

- **Contexto (do dono):** "na parte de monitoramento do admin poder ver os IPs distintos que estão
  usando o EBGeo ou usaram o EBGeo". O endereço já era gravado desde 2026-08-31 em toda linha de
  requisição do `.jsonl` (`clientAddress`, `backend/src/middleware/request-logger.js`), com a conta e
  a aba ao lado, e só aparecia agregado por grupo de erro no `npm run diag -- erros`. A trilha de
  auditoria também guarda o endereço de cada ato, o `LOGIN` inclusive. Presença, relato de erro e
  telemetria de uso não guardam endereço nenhum.
- **Decisão:** um relatório novo sobre o log existente, nas duas portas com um acumulador só
  (`criarRelatorioDeEnderecos`, `backend/src/utils/diag-enderecos.js`): `npm run diag -- enderecos`
  e `GET /api/v1/diag/enderecos`, atrás de `auth` e `requireAdmin`, e a seção "Endereços de acesso"
  no fim da aba Diagnóstico, sob a janela da aba. Por endereço: primeira e última requisição na
  janela, requisições (e quantas com erro), abas identificadas e as contas vistas; o anônimo e o
  visitante de link público contam como anônimo. "Usando agora" é o endereço com requisição nos
  últimos cinco minutos, tráfego e não presença. Os nomes das contas vêm do banco num bloco que se
  declara cego sozinho (`nomearContas`), e com o Postgres fora a lista sai inteira.
- **Nada novo é gravado, e a retenção é a do log:** `LOG_RETENTION_DAYS`, trinta dias por padrão,
  com a poda por idade do arquivo que já existia. A tela alcança sete dias, o teto de toda rota de
  log; o comando alcança a retenção inteira.
- **Privacidade e alcance:** só o administrador vê (`requireAdmin`, que recusa toda chave de API).
  O endereço NÃO entra em relato de erro, migalha nem lote de uso, e isso passou a ter guarda: os
  schemas daquelas duas rotas anônimas não declaram campo de endereço, a migalha recusa a chave, e
  as tabelas de defeito e de uso não têm coluna para ele. O `exemplo` do grupo de erros continua
  sem `ip`. Com NAT, um endereço pode ser uma OM inteira, e a tela diz isso.
- **Alternativas rejeitadas:** uma tabela de endereços no Postgres, que duplicaria o que o log já
  guarda e criaria um segundo prazo de retenção para dado pessoal; ler o endereço da trilha de
  auditoria, que só vê quem entrou (não o anônimo, nem a sessão que se renova) e não é podada; pôr
  a seção na aba Uso, que lê o banco, tem outro teto de janela e não tem a maquinaria de leitor cego
  das seções de log do Diagnóstico; e ler o "agora" do painel de presença, que é outra pergunta e
  outro código.
- **O que depende de produção:** o endereço é o do CLIENTE enquanto o nginx acrescentar o par TCP ao
  `X-Forwarded-For` (a forma `$proxy_add_x_forwarded_for`) e `TRUST_PROXY_HOPS` casar com os proxies
  à frente. A configuração de produção não mora nesta árvore; o requisito passou a estar escrito em
  [deploy do backend](../wiki/deploy-backend.md), ao lado do parágrafo de `trust proxy`, e precisa
  ser conferido lá: sem a linha toda requisição traz o endereço do nginx, e a ressalva do endereço
  único acende. Em DEV o proxy do Vite não repassa o cabeçalho, e todo endereço é o de loopback.
- **Guardas:** `backend/tests/unit/diag-enderecos-distintos.test.js`,
  `backend/tests/integration/diag-enderecos.test.js` (inclui o espelho entre a rota e o comando),
  `frontend/tests/unit/enderecos-frases.test.js`, `frontend/tests/e2e/diag-enderecos.e2e.test.js` e
  a varredura de seções de log de `frontend/tests/unit/diagnostico-secoes-de-log.test.js`, que
  alcança a seção nova sem edição. Detalhe em [observabilidade](../wiki/observabilidade.md).
- **Status:** aceita.

### 2026-09-22: a porta "Acessos" abre em Concessões, concede-se pelo painel, e cada um vê só as concessões que fez

- **Contexto (do dono, item 19):** três pedidos. (a) O botão "Acessos" que aparece para o
  credenciado deve levar à tela de Concessões; ele abria o painel na primeira aba da audiência, que
  era Grupos. (b) Deve ser possível compartilhar recurso na tela de Concessões; a única porta era o
  modal do recurso, dentro do mapa, e a decisão de 2026-08-24 (perfil produtor, item 6) dizia que o
  botão não nasce no painel, porque o motor de sync que o modal carregava não cabe numa página sem
  store. (c) As concessões listadas, no modal do recurso e em Concessões, devem ser só as que a
  própria conta fez; o modal listava a árvore inteira do recurso, com o que outras pessoas tinham
  concedido.
- **Decisão:**
  1. **"Concessões" passa a ser a primeira aba da audiência "Acessos"** (`ABAS_DE_QUEM_ENTROU`,
     `frontend/src/js/admin/admin-audience.js`). O mecanismo é o que já existia: sem `?aba=`, a
     primeira aba abre, então TODA porta que leva a `admin.html` sem parâmetro (o menu da conta no
     mapa, a barra de `atlas.html`, o rodapé do catálogo) chega lá sem mudar de endereço. A linha
     inteira muda, e não só o credenciado, porque a audiência não o distingue (D1 de 2026-08-20) e
     reintroduzir uma pergunta de papel global para escolher a aba de abertura desfaria aquilo. Para
     o usuário comum a troca também é a certa: "Acessos" nomeia acesso, e "Recebidos por mim" é a
     pergunta com que ele chega. Administrador e produtor NÃO mudam, porque o rótulo da porta deles
     ("Administração", "Catálogo") nomeia a primeira aba que eles recebem.
  2. **"Conceder acesso" nasce em "Concedidos por mim"**, e **supera o item 6 da decisão de
     2026-08-24** do perfil produtor. A lista de onde escolher o recurso é a do SERVIDOR: o payload
     aditivo sem atlas em foco, `shareable` mais a procedência `papel`, que juntos são exatamente o
     gate de repasse (`shareableResources`, `frontend/src/js/admin/shareable-resources.js`). O modal
     é o MESMO do mapa, partido em núcleo sem store (`frontend/src/js/catalog/resource-share.modal.core.js`)
     e entrada do mapa (`frontend/src/js/catalog/resource-share.modal.js`), no molde de
     `modals/sharing.modal.core.js`: a re-soma do catálogo privado depois de revogar, que era o que
     trazia o motor de sync, virou efeito INJETADO (`onAccessChanged`), que a entrada do mapa liga e a
     aba troca por reler as próprias listas. O motivo técnico da decisão superada continua valendo
     como restrição, e o grafo é o guarda. O POSTO SOME: sem recurso para compartilhar, o comando não
     se desenha e uma frase curta diz por quê. A dica da aba Catálogo passou a apontar esta porta.
  3. **A listagem de concessões de um recurso devolve só a autoria de quem pergunta**
     (`LIST_GRANTS_FOR_RESOURCE` com `granted_by` igual ao chamador, lido do token), decidido no
     servidor para que a concessão alheia nem chegue ao cliente. Vale para o administrador. A queda de
     cada linha continua sendo avisada, CONTADA e não nomeada, por `REVOCATION_FALL_PREVIEW`, montada
     com as mesmas quatro CTEs de leitura da poda (`CTES_DE_LEITURA_DA_PODA`); a poda continua byte a
     byte o statement de antes, conferido por comparação da string. "Concedidos por mim" já era só
     autoria (`grants/issued` filtra por `granted_by`) e não mudou. "Recebidos por mim" continua.
- **O que o administrador perde e onde a autoridade sobrevive:** perde a TELA que listava as
  concessões dos outros sobre um recurso, e com ela o caminho de clique até revogá-las. O gate de
  revogar (`requireGrantRevoker`) continua com o ramo largo, e sobrevivem a rota de revogação (o
  identificador da concessão está em cada `PERMISSION_GRANT` da trilha), a desativação da conta de
  quem concedeu e o rebaixamento de papel ou de escopo, que podam tudo o que a pessoa originou, e a
  exclusão do grupo beneficiário. Nenhuma tela nova de revogação administrativa foi criada.
- **Alternativas rejeitadas:**
  - *Um parâmetro de aba na URL de cada porta* (`admin.html?aba=grants` no menu da conta e na barra
    de `atlas.html`): três endereços para lembrar de manter, e a porta esquecida abriria em Grupos. A
    primeira aba já é o mecanismo.
  - *Uma rota nova de "recursos que posso compartilhar"*: o payload aditivo já responde, e uma
    segunda resposta à mesma pergunta divergiria no ramo do papel global.
  - *Filtrar a lista do modal na tela*: o dado alheio continuaria chegando ao cliente.
  - *Mandar ao cliente as linhas da subárvore para ele contar*: seriam as concessões alheias que o
    recorte existe para não entregar, e o resgate por grupo continuaria impossível de prever lá.
- **Guardas:** `backend/tests/integration/concessoes-do-recurso-so-autoria.test.js` (o recorte nos
  dois sentidos, a contagem por tipo e a prévia batendo com a revogação no caso de resgate),
  `backend/tests/integration/resource-grants-escalonamento.test.js` (ajustado ao recorte),
  `frontend/tests/unit/conceder-pelo-painel.test.js`, `frontend/tests/unit/compartilhar-sem-a-store.test.js`
  (o núcleo cabe em `admin.html`, e a página o alcança sem nenhum proibido) e
  `frontend/tests/unit/admin-audiencia.test.js`. Cláusula nova: 3.9 da
  [`CONSTITUICAO.md`](../../CONSTITUICAO.md). Detalhe em
  [acesso a recurso privado](../wiki/acesso-a-recurso-privado.md).
- **Status:** aceita e implementada; falta a captura de UI do comando e do modal no painel.

### 2026-09-22: o boot recusa subir com diretório de dados sem escrita, e o log desligado em runtime deixa rastro

- **Contexto (medido no stack de teste):** a imagem nova roda como `ebgeo`, uid 1001, e faz `chown`
  de `/app/data` na construção; o compose de lá monta `./data:/app/data`, e o diretório do host era
  1000:1000, criado por uma versão anterior. O bind mount mascarou o chown: desde a subida, às
  09:49, o log em arquivo se desligou na primeira linha (EACCES) e todo envio de imagem em lote
  respondeu 500 (EACCES no mkdir da pasta do atlas), com o healthcheck verde. Ninguém soube até ler
  o `docker logs`. A página de deploy já dizia que volume não gravável dava EACCES "na primeira
  escrita, não no boot": o risco estava escrito como limite, e o "fala alto ao nascer" do log só
  perguntava se o diretório podia ser CRIADO, o que o `mkdir` recursivo responde que sim sobre
  qualquer diretório que já exista.
- **Decisão 1, a sonda de escrita (do dono, no mesmo dia):** antes do `listen`,
  `verificarDiretoriosDeDados` (`backend/src/utils/sonda-de-escrita.js`) cria se faltar, escreve e
  apaga um arquivo de teste em cada diretório que o processo escreve (`LOG_DIR` só com o log em
  arquivo ligado, `IMAGES_DIR`, `CATALOG_VIDEO_DIR`, `SV360_DB_DIR`, `SV360_TMP_DIR`). Falha sai
  com código 1 e UMA mensagem em pt-BR com cada diretório, a variável, a função, o erro e a etapa, o
  uid/gid do processo, o dono atual (ou o do ancestral que recusou a criação) e o conserto provável
  por família de erro (`chown -R <uid>:<gid>` na origem do mount, tirar o `:ro`, liberar espaço). Os
  erros de `validateEnvVariables` entram no mesmo lançamento, para que um deploy errado nas duas
  coisas as descubra num reinício só.
- **O que fica de fora da sonda, de propósito:** os diretórios que o servidor só LÊ
  (`MODELS_3D_DIR`, `ASSETS_3D_DIR`, `ASSETS_3D_SQLITE`, `SONDA_DIR`, `EBGEO_MAPAS_DIR`), onde `:ro`
  é montagem legítima; e o subdiretório ou arquivo que já existe com outro dono (a pasta de um
  atlas, o arquivo do dia do log), que exigiria varrer o acervo no boot e acusaria diretório alheio,
  como o `lost+found` da raiz de um volume. É por isso que o conserto proposto é `chown -R`.
- **Preço declarado:** disco cheio também recusa o boot. Um volume sem espaço nem para o arquivo de
  teste quebra toda escrita, e o laço de reinício passa a repetir a causa em vez de subir um
  servidor que só lê. E o acervo 360 montado só leitura deixa de subir, porque o servidor escreve
  nele (ingestão pelo painel, miniaturas); não há variável que declare esse caso.
- **Decisão 2, o `Dockerfile`:** os cinco diretórios passam a existir na imagem com dono 1001. Sem
  isso o volume nomeado `ebgeo_logs` do compose de desenvolvimento, montado num caminho ausente da
  imagem, nasce com a raiz de root, e a sonda recusaria aquele stack. A premissa vem da cópia de
  conteúdo e dono que o Docker faz para um volume nomeado vazio, e não foi medida nesta sessão.
- **Decisão 3, o desligamento em runtime deixa rastro:** o log em arquivo continua resistente (disco
  cheio no meio da execução não derruba o processo), mas o desligamento fica em
  `estadoDoLogEmArquivo`, publicado por `GET /api/v1/diag/saude` e `/resumo` dentro de `janela`, e
  vira defeito de servidor (`defeitoDoLogDesligado`, assinatura aberta por `MARCADOR_LOG_DESLIGADO`
  e separada por código de erro), que o bloco de saúde do `resumo` acha e publica nos dois ramos,
  inclusive com a série vazia. O comando `saude` só lê disco e aponta para as duas testemunhas no
  "sem amostras".
- **Decisão 4, o `/health` não reprova pelo log desligado:** ele é a testemunha de disponibilidade
  da sonda externa, e um 503 ali escreveria queda com o produto atendendo; e um orquestrador que
  reinicia container unhealthy cairia na sonda de escrita, que recusa volume cheio ou sem permissão,
  transformando a perda do log em indisponibilidade total. Diretório sem escrita no BOOT nem chega
  ao `/health`, porque o processo não escuta. A decisão está escrita também ao lado do handler, em
  `backend/src/app.js`.
- **Alternativas rejeitadas:** o `/health` reprovando (acima); avisar no boot e seguir de pé, que é
  o estado que o incidente mediu; perguntar por permissão de acesso em vez de escrever, que não
  prova escrita sob ACL, SELinux ou volume de rede e economiza um arquivo de três bytes; varrer os
  subdiretórios; e o uid da imagem configurável por argumento de build, que resolveria o bind mount
  do lado da imagem mas amarra cada imagem a um host, e fica como proposta.
- **Guardas:** `backend/tests/unit/sonda-de-escrita.test.js`, os casos de sonda de
  `backend/tests/integration/boot-fail-fast.test.js` (subprocesso real que recusa subir e junta os
  dois portões), `backend/tests/unit/log-desligado-deixa-rastro.test.js`, os casos novos de
  `backend/tests/unit/log-diario.test.js`, `backend/tests/integration/diag-cli-resumo.test.js`,
  `backend/tests/integration/diag-rota-de-resumo.test.js` e
  `backend/tests/integration/diag-rotas-de-log-espelham-o-cli.test.js`. Detalhe em
  [deploy do backend](../wiki/deploy-backend.md) e [observabilidade](../wiki/observabilidade.md).
- **Status:** aceita; os testes foram escritos e não rodados nesta sessão.


## 2026-09-22: símbolos de engenharia como tipo próprio de ponto

- **Contexto:** pedido do usuário para implementar a tabela 6-4 do C 5-36 com o fluxo e os controles de Medidas de Coordenação, preservando os campos e desenhos revisados.
- **Decisão:** tipo `engineering_symbol`, coleção `engineering_symbols` e atributos de desenho em `engineering`. Compartilha o ciclo do controle de coordenação; gera a imagem a partir dos atributos em cada cliente. A migração incremental 013 amplia o CHECK de tipos, sem alterar feições existentes.
- **Motivo:** manter a identificação de Engenharia na seleção, lista e sincronização, sem misturar seu catálogo com os códigos das medidas de coordenação. Estradas de referência ficam fora da geometria; todos os itens aprovados são pontos.
- **Compatibilidade:** coleção ausente em mapas antigos recebe lista vazia na leitura. O fundo branco opcional dos cinco desenhos fechados começa desativado quando o atributo não existe.
- **Referência:** [escopo e implementação](../wiki/simbolos-engenharia.md).

### 2026-09-23: o navegador, o sistema e a máquina entram no Diagnóstico e no Uso

- **Contexto (do dono):** "Adicionar nas telas de administração de Uso e Diagnóstico o browser do
  usuário, sistema operacional, o que tiver disponível de informação da máquina que possa ajudar o
  debug." Metade de quem usa o EBGeo está no Firefox, e a auditoria de lançamento achou defeitos que
  só apareciam nele. Até aqui o relato de erro levava o user agent cru (a aba mostrava só a família)
  e o lote de uso levava só a família, em texto livre, sem que nenhum relatório a lesse.
- **Decisão, Diagnóstico:** cada OCORRÊNCIA de defeito leva o bloco `ambiente`
  (`defeito_ocorrencias.ambiente`): família e versão do navegador e do sistema, a versão real do
  sistema pelas dicas de cliente quando o navegador as dá, dispositivo e toque, tela, janela e
  escala, idioma e fuso, núcleos, memória, WebGL com placa e textura máxima, cota de armazenamento e
  quatro sinais do instante (rede, cookies, IndexedDB, conexão segura). Cada DEFEITO acumula o
  conjunto de famílias dos relatos que INFORMARAM o navegador (`defeitos.navegadores`, união), que
  vira a coluna "Navegadores" da lista; relatos de versões anteriores do EBGeo não informavam, e a
  dica da coluna diz que um defeito antigo pode ter ocorrido também noutro navegador. A gaveta
  mostra a distribuição das ocorrências guardadas e o bloco "Máquina desta ocorrência". O comando
  `npm run diag -- defeitos --id` imprime os dois.
- **Decisão, Uso:** a sessão guarda três dimensões de baixa cardinalidade, a família, a versão
  PRINCIPAL e a família do sistema, e a aba ganha a seção "Navegadores e sistemas" (sessões, fatia,
  sessões com erro, taxa de erro e pessoas, por navegador com as versões dentro, e por sistema).
  A taxa de erro por navegador é o cruzamento com os defeitos, com denominador.
- **Um parser só, no cliente:** `analisarUserAgent` (`frontend/src/js/session/ambiente-do-navegador.js`)
  serve o relato, o lote e o rótulo da aba para relatos antigos. O servidor nunca lê user agent; a
  família chega no corpo, validada contra o espelho. Os dois parsers anteriores discordavam sobre o
  Opera, e os dois mandavam o navegador do harness de teste (`HeadlessChrome`) para o Safari.
- **Vocabulário espelhado:** as famílias de navegador e de sistema, os tipos de dispositivo e de
  WebGL, os tetos e as formas moram num folha de zero imports em cada pacote e em três CHECK
  (`defeitos_navegadores_check`, `uso_sessoes_navegador_check`, `uso_sessoes_so_check`), pela
  migração `backend/src/database/migrations/014_ambiente_do_navegador.sql`, aditiva e idempotente.
  A coluna `uso_sessoes.navegador`, que aceitava texto livre numa rota anônima, passou a vocabulário
  fechado; o que houver fora da lista vira `outro` antes de o CHECK fechar.
- **Privacidade e recorte:** o bloco inteiro identifica uma máquina mais do que o user agent sozinho,
  e por isso fica só na ocorrência (no máximo vinte por defeito, podada com o defeito, lida só pelo
  administrador) e nunca no lote de uso nem na linha agregada. Nada de modelo do aparelho, fontes,
  plugins, hash de canvas ou de áudio, endereço ou identificador persistente. A cota de
  armazenamento viaja arredondada para uma potência de dois, nos dois lados: no Chromium ela é uma
  fração fixa do disco, e o número exato ligaria ocorrências anônimas da mesma máquina.
- **Custo:** as dicas de cliente e a estimativa de armazenamento são pedidas na instalação, sem
  esperar por elas; a sonda de WebGL cria UM contexto no primeiro relato da página, e não no boot, e
  o perde na hora para não empurrar o contexto do mapa para fora do limite do navegador.
- **Alternativas rejeitadas:** o user agent cru como dimensão do uso (cardinalidade de milhares e
  impressão digital numa tabela guardada por meses); parsear o user agent no servidor (uma segunda
  verdade que diverge da primeira); pôr o ambiente na linha do defeito (guardaria o do último relato
  e jogaria fora o das outras ocorrências); a biblioteca UAParser (peso nas quatro páginas para
  responder cinco famílias); a sonda de WebGL no boot (custo em toda carga, e contexto a mais no
  harness que já cai no boot do mapa); e uma tabela diária por navegador, que manteria a série além
  da retenção ao preço de multiplicar o agregado por versão. A seção de Uso conta só as sessões
  retidas e avisa quando a retenção encurtou o período.
- **Limites declarados:** o Firefox não dá dicas de cliente (o rótulo é "Windows 10 ou 11") nem
  memória, e mascara a placa numa classe genérica; o Safari mascara a placa; a memória do Chromium
  é arredondada e limitada. O Playwright reescreve user agent e dicas pelo descritor de dispositivo,
  então sistema e versão lidos no harness são os do descritor.
- **De carona, na mesma aba:** a ressalva da metade de uso dizia "sem nova tentativa: o que não
  chega se perde", e desde a fila de lotes de 12/09/2026 o que falha por rede ou servidor é tentado
  de novo por até um dia; a frase passou a dizer isso. As frases de horizonte deixaram de contar "as
  quatro seções", que já eram cinco e agora são seis.
- **Exige do dono:** aplicar a migração nova no banco de desenvolvimento (`npm run db:migrate` em
  `backend/`) e no stack de teste do servidor na próxima implantação. Sem ela o código novo fala de
  colunas que o banco não tem: o relato de erro responde 500 (e vai para a fila do navegador), o
  lote de uso responde 503 (e fica na fila de um dia), e a lista de defeitos e o resumo de uso
  respondem erro, ou seja, as duas abas falham até a migração entrar.
- **Guardas:** `frontend/tests/unit/ambiente-do-navegador.test.js`,
  `frontend/tests/unit/ambiente-do-navegador-espelha-backend.test.js`,
  `frontend/tests/unit/relato-com-ambiente.test.js`, `frontend/tests/unit/ambiente-frases.test.js`,
  `backend/tests/unit/ambiente-do-navegador-check.test.js` e
  `backend/tests/integration/ambiente-do-navegador.test.js`. Detalhe em
  [observabilidade](../wiki/observabilidade.md).
- **Status:** aceita.

### 2026-09-23: o boot dispara o pedido de armazenamento persistente e não o espera

- **Contexto:** desde 2026-09-15 o boot do mapa aguardava `pedirPersistencia`
  (`frontend/src/js/store/storage-persistence.js`) com prazo de 2000 ms, porque no Firefox
  `persist()` abre uma tarja de permissão e fica pendente até alguém responder. A auditoria de
  lançamento mediu que o prazo disparava em todo boot do Firefox no harness e era cancelado no
  Chromium: todo usuário de Firefox que não respondeu à tarja pagava 2 s a mais em toda carga e em
  toda troca de atlas por recarga. O dono informou que metade dos usuários está no Firefox.
- **Decisão (do dono):** `index.js` dispara o pedido e segue, sem `await`. O desfecho vira
  `pendente` no instante do pedido e se corrige sozinho quando o navegador responder; o prazo
  continua na função para quem aguardar a promessa.
- **Motivo:** a concessão vale para o grupo de origem inteiro, inclusive o que já foi gravado antes
  dela, então pedir antes de o store abrir os bancos nunca foi condição; esperar não comprava nada.
- **Alternativa rejeitada:** encurtar o prazo, que só diminuiria o custo e manteria um boot refém de
  um diálogo opcional.
- **Guarda:** `frontend/tests/store/pedido-de-persistencia-no-boot.test.js` (reprova um `await` de
  volta em `index.js`, e reprova o desfecho nulo durante o pedido). Detalhe em
  [sessão, boot e ciclo de vida](../wiki/sessao-boot-e-ciclo-de-vida.md).
- **Status:** aceita.

### 2026-09-23: a abertura de atlas de servidor que falha no boot não apaga nada

- **Contexto:** quando `?atlas=` falhava depois de montar o namespace, a cadeia de boot caía em `enterLocalMapOnBoot` ou em `openAtlasChooserOnBoot`, e os dois esvaziavam o escopo montado com os padrões de `clearAllDataStore`, cujo `clearQueue` segue `markLocal`. Isso levava a fila de saída e os bytes pendentes do atlas que falhou, deixava a aba morta (escopo remoto, origem local, escrita recusada) e, como a decisão lia o marcador de origem da instalação e não o escopo da aba, apagava um slot LOCAL no F5 quando outra aba tinha aberto um atlas de servidor. Medido nos dois navegadores: fila de 1 operação para 0 e a reabertura seguinte sem a edição, em 4 de 4 casos.
- **Decisão (do dono, Q1):** a abertura que falha preserva a fila e os bytes pendentes e descarta só a visão. O seletor só navega, levando o motivo em `?aviso=`; a queda para o mapa local entra no slot local pela troca viva (`enterLocalAtlasOnBoot`, `frontend/src/js/account/open-atlas.service.js`); a próxima abertura bem-sucedida entrega a fila. Junto, a causa provável da falha da matriz de 2026-09-22: `dropAtlasDatabases` passou a aguardar a remoção do espelho de época, `registerRemoteAtlas` reconcilia os ponteiros duráveis antes de ler a cerca, e o indicador de sincronização redesenha quando a origem vira local.
- **Motivo:** com namespace por atlas nada fica solto: a abertura normal já preserva desde 2026-09-19, e quem coleta é a saída da conta. "A rede falhou" nunca é abandono.
- **Alternativa rejeitada:** manter o wipe com `clearQueue: false`, que ainda apagaria a projeção e não tiraria a aba do estado morto.
- **Guardas:** `frontend/tests/integration/abertura-que-falha-preserva-a-fila.repro.test.js`, `frontend/tests/e2e-ui/abertura-remota-que-falha.repro.spec.js` e `frontend/tests/integration/descarte-que-sobrevive-a-saida.repro.test.js`. Detalhe em [sessão, boot e ciclo de vida](../wiki/sessao-boot-e-ciclo-de-vida.md).
- **Status:** aceita.

### 2026-09-23: o lote de uso de outra conta espera o dono, e só o gesto Sair apaga os lotes de uma conta

- **Contexto:** a fila de lotes de uso entre cargas de página (2026-09-12) apagava, na primeira descarga de cada carga, todo lote guardado de outra identidade, e contava cada um como falha. As quatro páginas instalam a telemetria antes de restaurar a sessão, então toda carga de quem está logado começa com identidade nula, e o lote apagado era o que a página anterior escreveu no `pagehide`. Medido nos dois navegadores, com 503 no lote da saída: 0 de 3 chegavam para quem estava logado, contra 3 de 3 do anônimo; toda navegação logada mandava duas falhas de coleta; e, com o token nos últimos 30 s, a descarga da saída disparava uma renovação dentro do `pagehide` e o `fetch` nunca saía.
- **Decisão (do dono, Q2):** lote de outra identidade é pulado, nunca apagado, e o pulo não é falha; a limpeza continua pela validade de 24 h e pelo teto de 30, que conta os lotes de todas as contas. No gesto Sair os lotes pendentes da conta que sai são apagados; na troca de página, no boot e na sessão perdida sem gesto, não. Junto: a sessão que assenta reenvia na hora os lotes dela, a descarga do `pagehide` usa o token em memória sem renovar, e os POSTs de uso e presença leem o corpo da resposta, porque cancelá-lo é o que o Chromium registra como ERR_ABORTED. Lote de conta sem credencial para levar é pulado, e 401 ou 409 num lote de conta o guarda para a próxima retomada; no lote anônimo continuam definitivos, porque não há credencial a consertar.
- **Motivo:** o lote de uma conta só é aceito sob ela, então apagar na chegada da identidade nula não protegia nada que o pulo não proteja; apagar no Sair atende a quem deixa um computador compartilhado sem custar o lote de quem só trocou de página.
- **Alternativas rejeitadas:** apagar os lotes da conta em toda perda de sessão, que perderia o trabalho de quem caiu sem escolher; reatribuir o lote à identidade corrente, que o contrato do servidor recusa por desenho.
- **Onde mora:** `criarTransporteDeUso` (`frontend/src/js/session/uso-transporte.js`) e `anunciarSaidaDaConta` (`frontend/src/js/session/uso-lote.js`), chamada por `confirmLogoutWithPendingWork` (`frontend/src/js/session/confirm-logout.js`).
- **Guardas:** `frontend/tests/unit/lote-de-uso-de-outra-conta.repro.test.js`, o caso novo de `frontend/tests/unit/confirm-logout.test.js` e `frontend/tests/e2e-ui/lote-de-uso-sobrevive-a-navegacao.spec.js`. Detalhe em [observabilidade](../wiki/observabilidade.md).
- **Status:** aceita.

### 2026-09-23: sessão num spec de navegador só por duas portas

- **Contexto:** `login()` dentro de `page.evaluate` numa `/` ainda bootando grava `ebgeo_auth` no meio do boot, e a fase -1 e a restauração da sessão (fase 2.5) levam a página para `atlas.html`. Medido: 10 de 10 no Firefox, 1 de 10 no Chromium, 3 de 3 com a trava do portão segurada; dois specs já tinham caído na auditoria de lançamento. O conserto por sítio (semear em `atlas.html`) deixava 73 sítios em 49 arquivos na forma que sequestra.
- **Decisão (do dono, Q3):** nenhum código de produto muda. Os testes de navegador ganham `clienteNaPagina` (credencial só em memória, por `setEphemeralToken`) e `sessaoDoApp` (a única escrita deliberada: `login()` em `atlas.html` e depois o destino), em `frontend/tests/e2e-ui/helpers/cliente-de-teste.js`. Todos os sítios migraram; três exceções ficam declaradas com motivo no censo.
- **Motivo:** esperar não conserta, porque a janela vai do início do documento até a fase 2.5; tirar a sessão do disco deixa o boot sem o que ler. O redirecionamento em si é o comportamento certo para uma pessoa real, que só grava sessão fora dessa janela.
- **Alternativas rejeitadas:** mudar o roteamento do produto; semear sempre em `atlas.html`, conserto por sítio que recorreu; esperar a fase 2.5 antes de cada login, que depende de cada autor lembrar.
- **Limites:** `clienteNaPagina` vale os 15 minutos do token de acesso, sem renovação; uma página servida por `route.fulfill` não fala com a porta do backend no Chromium.
- **Guardas:** `frontend/tests/unit/login-programatico-so-pelo-helper.test.js` e `frontend/tests/e2e-ui/login-programatico-no-boot.spec.js`.
- **Status:** aceita.

### 2026-09-23: a base com que o mapa nasce é escolha do administrador, na aba Sistema

- **Contexto:** o mapa nascia com uma constante do cliente (DEFAULT_LAYER, a carta topográfica), e todo documento de mapa novo também: o mapa em branco da primeira visita, o mapa criado na aba Mapas e o primeiro mapa de um atlas criado no servidor, que levava o padrão da coluna `maps.base_layer`.
- **Pedido do dono:** "Ao abrir: o mapa nasce com DEFAULT_LAYER = 'carta-topografica' - torne isso configurável na tela de administrador - Sistema".
- **Desenho:** a chave é `map2d.defaultBasemap`, servida por `GET /api/config` com padrão `carta-topografica` em `MAP2D_BASE`, então uma implantação sem override não muda. O administrador a escolhe num seletor da seção Mapa 2D da aba Sistema, que oferece os mapas base habilitados do catálogo em ordem de prioridade, a mesma lista do mini-mapa do 360. O cliente a lê na hora (`defaultBasemap`, `frontend/src/js/baselayers/default-basemap.js`): `initialBaseLayer` dá o estilo de nascimento, os ids que o controle assume e a crença inicial dele; `getEmptyMapData` a grava no documento novo; e `createAtlas` a grava no primeiro mapa do atlas de servidor (`getDefaultBasemap`). Quem não pode desenhar a base escolhida (desabilitada ou tornada privada depois de salva) nasce no primeiro mapa base oferecido, que é onde a primeira pintura já cairia.
- **Borda:** tipo no Joi (texto de até 100 caracteres, nunca vazio nem nulo) e existência no serviço (`assertDefaultBasemapKnown`): o id tem de estar entre os mapas base PÚBLICOS servidos, senão 422 com "O mapa base inicial ... não está no catálogo público. Escolha um da lista." O privado é recusado porque a base padrão é de todo visitante, o anônimo inclusive.
- **Alternativa rejeitada:** a borda só de forma, como a de `terrainPreferredBasemap` e a de `miniMapBasemap`. Aquelas só desenham; esta é gravada em documento, e um id errado se espalharia pelos mapas novos de todo mundo em vez de falhar uma vez no salvamento.
- **Limite:** um mapa que já existe continua abrindo na base que o documento dele carrega (ou na que a pessoa escolheu neste computador). Fazer o mapa sem vista salva abrir na base padrão mudaria a regra da vista da pessoa (2026-09-20), e não foi pedido.
- **Guardas:** `frontend/tests/unit/basemap-padrao-configuravel.test.js`, `frontend/tests/unit/basemap-padrao-documento-novo.test.js`, `frontend/tests/unit/admin-mapa-base-inicial.test.js`, `backend/tests/unit/config-mapa-base-inicial.test.js` e `backend/tests/integration/config-mapa-base-inicial.test.js`. Detalhe em [config dinâmico](../wiki/config-dinamico.md).
- **Status:** aceita.

### 2026-09-23: o Recuperado abre direto, e é um só enquanto ninguém trabalhar nele

- **Contexto:** quando a versão antiga grava depois da atualização, o resgate automático guarda o trabalho dela num atlas local que se chama Recuperado. O boot seguia no atlas atualizado, e cada novo resgate (a versão antiga gravando de novo) criava mais um atlas com o mesmo nome. As duas coisas foram medidas antes do conserto, no harness de `tests/integration/transicao-resiliente.test.js`.
- **Pedido do dono:** abrir direto essa cópia, e só criar esse atlas se ainda não houver um. Perguntado sobre o Recuperado que já existe, ele escolheu reusar se intocado: o Recuperado anterior só sai se ninguém trabalhou nele.
- **Desenho:** o resgate (`recovery-archive.js`) registra no diário da transição o Recuperado vigente com o inventário de nascimento, e move o anterior para `recoverySuperseded`. A poda que já roda depois do portão (`legacy-cleanup.js`) apaga o substituído só se o inventário for o de nascimento e nenhuma aba o tiver montado (a trava `atlasMountLockName`). Sem Web Locks não se apaga nada. Atlas em que a pessoa desenhou fica, e deixa de ser candidato. O novo sempre traz a origem inteira da versão antiga, então o que sai nunca tem algo que o vigente não tenha. Abrir o atlas não muda o inventário: medido no boot da store sobre o Recuperado, zero registros mudaram.
- **Abrir:** no portão, `apontarParaORecuperado` (`frontend/src/js/store/migration/abrir-recuperado.js`) faz os quatro passos da tela de atlas (origem local, ponteiro da instalação, ponteiro da aba apagado, intenção local), antes de a store montar qualquer coisa. Com o mapa aberto, o vigia troca ao vivo por `switchAtlas`. As outras três páginas só apontam. O aviso no mapa diz "que está aberto agora".
- **Guardas:** `frontend/tests/integration/recuperado-unico-e-aberto.test.js` (quatro das réguas reprovam o código anterior) e o passo 7 de `frontend/tests/e2e-ui/browser-migracao-2.2.spec.js`, que reprova com o apontamento desligado.
- **Status:** aceita.

### 2026-09-23: dados solares e lunares do PITCIC num painel do menu de contexto, sem ligação com a linha do tempo

- **Contexto:** a proposta de 2026-08-14 (revisada em 2026-09-23) calculava no navegador as linhas "Dados solares" e "Dados lunares" da matriz das condições meteorológicas do EB70-MC-10.336 e as levava a três superfícies: um painel pelo menu de contexto, uma faixa sob a régua da barra temporal e uma caixa no PDF.
- **Decisões do dono (D1 a D4):** primeira e última claridade a −18° (Fig 4-10), fase lunar pela janela de sete dias centrada na fase principal (Fig 4-11), "Ini Luar" e "Fim do luar" como a passagem da Lua que mais se sobrepõe à noite de D, e a biblioteca `suncalc` 2.0.2 em versão exata.
- **Decisões do dono depois de ver o painel funcionando:** saem a faixa na barra temporal e a caixa no PDF, e sai toda ligação com a linha do tempo, inclusive o Dia D tirado da âncora do mapa e o botão "Voltar ao Dia D"; o D é hoje ou a data escolhida no painel. "Copiar tabela" vira "Salvar tabela", que baixa um CSV. O cartão ficou mais largo (500 px), para não rolar de lado, com a barra de rolagem verde da casa.
- **Desenho:** o módulo mora em `frontend/src/js/utilities/luminosidade/`, chega por `import()` atrás de `carregarLuminosidade` e é aquecido em tempo ocioso depois que o mapa desenha; o pacote entra na lista de só-dinâmicos do teto de peso. As aberturas contam no uso do produto pelo evento `luminosidade.aberta`, que alarga o CHECK em `backend/src/database/migrations/015_uso_luminosidade.sql`.
- **Correções da proposta, medidas:** a tabela anual do USNO publica os crepúsculos náutico e astronômico (a proposta dizia que não), e é contra ela que o teste confere todo dia de 2026 em sete pontos; o dia solar usa o meio-dia solar médio local do dia D, e não o meio-dia de Brasília; a sobreposição entre Lua e noite é medida em minutos inteiros; os horários do exemplo da proposta estavam truncados (16:28 e 05:03 são 16:29 e 05:04 no USNO).
- **Alternativas rejeitadas:** a `astronomy-engine` (empata no minuto e pesa sete vezes mais); carregar o módulo no boot, como o WMM entrou; copiar a tabela para a área de transferência, trocada pelo arquivo.
- **Limites:** horizonte teórico ao nível do mar, sem relevo nem nuvens; a Lua e o crepúsculo astronômico da Estação Comandante Ferraz não são garantidos pela tabela; a precisão fora de 2026 não foi medida.
- **Guardas:** `frontend/tests/unit/luminosidade-referencia-usno.test.js`, `frontend/tests/unit/luminosidade-matriz-e-quadro.test.js`, `frontend/tests/unit/luminosidade-hora-brasilia.test.js`, o teto de peso e o censo de portas de carga. Detalhe em [luminosidade do PITCIC](../wiki/luminosidade-pitcic.md).
- **Status:** aceita.

### 2026-09-23: a previsão da matriz do PITCIC num painel próprio, consultada pelo navegador

- **Contexto:** a análise do EB70-MC-10.336 deixou fora da proposta solar as linhas da matriz das condições meteorológicas que dependem de previsão do tempo. A proposta meteorológica (`PROPOSTA-DADOS-METEOROLOGICOS.md`, na raiz) comparou três arranjos: o backend consulta a fonte (C1), o navegador consulta a fonte (C2), ou uma fonte instalada na rede (C3).
- **Decisões do dono:** luminosidade e meteorologia são telas separadas, cada uma com a sua entrada no menu de contexto; a consulta sai do NAVEGADOR (C2), e o backend não faz chamada de saída nenhuma.
- **Desenho:** o módulo mora em `frontend/src/js/utilities/meteorologia/` e chega por `import()` atrás de `carregarMeteorologia`, sem aquecimento. A bandeira `features.meteorologia` nasce LIGADA, por decisão do dono tomada depois de a primeira versão nascer desligada, e a raiz da fonte vem de `METEOROLOGIA_URL` (padrão, a API pública); as duas são sobrescritas na aba Sistema. A chamada vai sem credencial, sem Referer e sem cache em disco, com o ponto arredondado a 0,1°, e o modelo é fixo (GFS). Os dois painéis passaram a dividir uma casca (`frontend/src/js/utilities/painel-de-ponto/painel-de-ponto.js`), e `hora-brasilia.js` saiu da pasta da luminosidade para `frontend/src/js/utilities/hora-brasilia.js`. As aberturas contam pelo evento `meteorologia.aberta`, em `backend/src/database/migrations/016_uso_meteorologia.sql`.
- **Correções da proposta, medidas:** a altitude do ponto não é enviada, porque a fonte já corrige a temperatura pela altitude da célula e a devolve na resposta; o cabeçalho `Origin` sai sempre, porque o CORS o exige, e ele diz à fonte o endereço do EBGeo; a direção do vento é a média vetorial ponderada pela velocidade, a única que bate com a da fonte.
- **Alternativas rejeitadas:** C1, que exigiria saída de rede no servidor, ainda não confirmada; a mistura "best match" de modelos, que impede nomear uma rodada; copiar a casca do painel de luminosidade em vez de extraí-la.
- **Limites:** o gradiente de temperatura espera o limiar de um manual de fumígenos ou QBRN; não há regime de clima para dias fora do alcance; o teto de nuvens e a REDEMET ficam de fora, porque a chave vazaria no navegador; a visibilidade do GFS tem teto de cerca de 24 km; neblina local não aparece num modelo de 13 km. Com a fonte pública, cada consulta leva uma célula da área de interesse a terceiros.
- **Guardas:** `frontend/tests/unit/meteorologia-agregacao-e-quadro.test.js` (inclusive o caminho independente contra os agregados da própria fonte), `frontend/tests/unit/meteorologia-fonte.test.js`, o teto de peso, o censo de portas de carga e o catálogo de eventos de uso. Detalhe em [meteorologia do PITCIC](../wiki/meteorologia-pitcic.md).
- **Status:** aceita.

---

### 2026-09-23: a saída das análises de terreno é derivada por cada cliente e nunca viaja

- **Contexto:** a Linha de Visada e o Viewshed gravam uma ENTRADA (`los`, `visibility`) e uma SAÍDA (`processed_los`, `processed_visibility`, as metades verde e vermelha, que são o único desenho visível: a camada da entrada pinta com opacidade zero). A saída nascia com id de entrada mais o sufixo da metade, que não é UUID, e o servidor a recusa (`features.id` é UUID). Medido em dois navegadores num atlas de servidor: o autor ficava com duas recusas para sempre e perdia o desenho no F5, e o par nunca via a análise. O envio de um atlas local re-cunhava esses ids e quebrava o vínculo por prefixo, deixando a saída órfã. E toda edição posterior da entrada (arrastar vértice, altura do observador) nunca sincronizou, porque `batchUpdateAnalysisFeatures` não registrava a intenção.
- **Decisão (coordenador da caça noturna, sem mudar contrato, schema nem API):** a saída é função pura da entrada (`deriveAnalysisOutput`), a mesma na ferramenta do autor, no caminho de entrada do par, no retrato, na rajada de criações remotas e no desfazer/refazer (`replaceDerivedOutput`); a escrita dela é descartada pelo despachante por TIPO, pela lista única `DERIVED_OUTPUT_BUCKET_OF`, nunca por formato de id; linhas legadas de saída vindas do servidor são descartadas no retrato; o envio de atlas local não sobe a saída; as recusas antigas dessas ops são limpas da fila.
- **Alternativas recusadas:** UUID determinístico para a saída (quebra a relação por prefixo dos atlas locais existentes e exigiria cascata no servidor); aceitar id não-UUID no servidor (migração de `features.id`).
- **Precedente:** o raster de símbolo militar regenerado pelo par e a contagem de cores de 2026-09-21, ambos derivados do que sincroniza.
- **Status:** aceita pelo coordenador e confirmada pelo dono em 2026-09-24.

---

### 2026-09-23: o fim involuntário da sessão resgata a fila de TODO atlas de servidor com pendência

- **Contexto:** a troca de atlas promete guardar a fila do atlas deixado para a próxima abertura, mas o resgate da saída involuntária (inatividade, renovação recusada) olhava só o atlas MONTADO, e a varredura seguinte destruía a fila dos outros em silêncio (medido: banco de fila apagado, nenhum aviso). Um 503 no `/auth/me` do boot também varria tudo como se fosse logout, e uma segunda conta que entrasse depois de uma restauração adiada herdava a fila da primeira.
- **Decisão:** `preserveUnsyncedWorkOfOtherAtlases` roda antes de toda varredura involuntária (mapa, páginas sem mapa, boot deslogado, troca de conta por `endPreviousAccountIfReplaced`). Entra todo atlas remoto registrado com contagem positiva ou desconhecida, adotado como local sem mudar o atlas corrente; fica de fora o de descarte confirmado e o que outra aba viva tem montado (a saída daquela aba o resgata); acima do teto de atlas locais, o atlas fica retido (`retainRemoteAtlasForRescue`) com o prazo que resta dito na tela, e veto vencido conta como perdido. A guarda de boot não varre com par de tokens guardado, e o cursor durável carrega principal e nível do recorte.
- **Alternativa recusada:** só o veto de retenção de 24 h, que perde em silêncio depois do prazo.
- **Risco declarado para o dono:** o resgate no boot deslogado transforma o retrato de servidor com pendência em atlas local legível sem login, sem a poda de recursos privados que "Sair do servidor" aplica. A política já valia para o atlas montado; esta decisão a estende.
- **Status:** aceita pelo coordenador e confirmada pelo dono em 2026-09-24.

---

### 2026-09-23: a janela da versão antiga aberta durante a virada é ESPERA, não falha

- **Contexto:** com uma aba do `main` aberta durante a implantação (o caso mais comum da virada), o portão de migração desenhava a tela de duas saídas, cujo único comando além de baixar é "Continuar", que APAGA os dados deste computador; a saída certa (fechar a janela antiga) não tinha botão e o texto se contradizia.
- **Decisão (diretriz de resiliência de 2026-09-22):** o portão desenha "Há uma janela antiga do EBGeo aberta. Feche a outra janela do EBGeo neste computador. Esta página continua sozinha quando ela fechar." sem comando nenhum, sonda de novo a cada segundo e segue sozinho depois de duas ausências seguidas. A tela de duas saídas continua para as falhas reais. Medido com o build real do `main`: Chromium e Firefox esperam sem botão e retomam em 3 a 5 s depois de a janela antiga fechar, com a escrita tardia dela absorvida.
- **Alternativa recusada:** um terceiro botão "Recarregar" na tela de recuperação, que contraria a regra do dono de uma tela com duas saídas.
- **Status:** aceita pelo coordenador e confirmada pelo dono em 2026-09-24.

---

### 2026-09-24: abrir a versão antiga depois de um rollback não é alteração dela

- **Contexto:** medido com o build real do `main`: se a produção voltar para o `main` e a pessoa só ABRIR o app, a versão antiga regrava o `sync` do mapa ativo e o `mapBadgeColors`, e ao voltar a integração criava e ABRIA um "Recuperado" com a cópia velha no lugar do atlas em que a pessoa trabalhava.
- **Decisão:** um mapa da origem que mudou é inerte quando o conteúdo dele (sem `sync`) está contido no do destino, E a fila do `main` não tem exclusão de entidade daquele mapa desde o início da transição, E o destino não tem feição anterior à transição que falte na origem; sem marco de início ou com fila ilegível, nada é absolvido. `mapBadgeColors` entrou em `PREFERENCE_KEYS` e `LATE_RULE_VERSION` subiu. A decisão de 2026-09-23 sobre abrir o Recuperado direto continua valendo quando há alteração real.
- **Status:** aceita pelo coordenador e confirmada pelo dono em 2026-09-24.

---

### 2026-09-23: uma cauda de pull longa demais vira retrato no HTTP e pedido de ressincronização no socket

- **Contexto:** 300 edições de um polígono de 300 vértices geravam uma cauda de 7,5 MB contra um retrato de 14 KB, e o cliente aplicava a cauda op a op. Mandar o retrato pelo socket, porém, entrava em laço num link de 40 kbps: o quadro vai sem compressão e o heartbeat cortava antes de ele chegar.
- **Decisão:** acima de 500 ops ou de 2 MiB guardados, o pull REST responde o retrato (a forma `isSnapshot` que os dois caminhos já conheciam); pelo socket, o servidor avisa para re-puxar pelo HTTP, que tem compressão e prazo por silêncio, e nunca manda um quadro de retrato. Provado no cliente que a edição local pendente sobrevive e sobe.
- **Status:** aceita pelo coordenador.

---

### 2026-09-24: "Duplicar" mapa num atlas de servidor usa a rota de duplicação do servidor

- **Contexto:** o cliente montava a cópia localmente, gravando camadas sem op e feições dentro do documento do `map` CREATE, que o servidor não transforma em feição: a cópia ficava vazia no Postgres e depois do F5. A rota REST de duplicação existia, era uma das quatro exceções estruturais declaradas, e nenhum cliente a chamava.
- **Decisão:** em atlas remoto, `_duplicateOnServer` esvazia a fila, chama a rota com o nome pedido (corpo opcional com o nome, aditivo) e ressincroniza, então o autor recebe a cópia pelo mesmo caminho do par; sem conexão o comando é desenhado e o clique recusa nomeando o estado. Atlas local continua na montagem local.
- **Status:** aceita pelo coordenador.

---

### 2026-09-23: a importação de arquivo preserva o nome e as colunas reservadas, e não inventa atributos de estilo

- **Contexto:** importar KML, SHP, GeoJSON ou CSV descartava em silêncio toda coluna cujo nome colidia com uma propriedade de sistema, inclusive o NOME da feição (o nome do Placemark do KML, a coluna NOME do DBF), e a ida e volta do nosso próprio KMZ acrescentava cinco atributos de estilo por ponto e perdia a descrição ("[object Object]"). O `main` fazia o mesmo.
- **Decisão:** o nome vem do primeiro campo de nome não vazio do arquivo; chave reservada que nenhum leitor consome vira um atributo com o sufixo de importado; as chaves que a conversão de KML deriva do estilo não viram atributo, e o nosso KMZ carrega o próprio estilo e o restaura. Estilo de KML de terceiros continua sem ser aplicado aos campos nativos (proposta para o dono).
- **Status:** aceita pelo coordenador.

---

### 2026-09-23: navegadores Chrome e Edge 105 a 109 (Windows 7 e 8.1)

- **Contexto:** o build legado entrega o pacote moderno sem polyfill a todo navegador com `import.meta.resolve`, e a importação de shapefile usa `Array.prototype.toReversed` (Chrome 110) dentro do `shpjs`: no Chrome 109 a importação morria com "toReversed is not a function".
- **Decisão:** polyfill local, definido só se ausente, no ponto único `frontend/src/js/vendor/shpjs.js`. A varredura dos pacotes carregados sob demanda não achou outro uso alcançável de ES2023 sem guarda.
- **Navegador mínimo (decisão do dono, 2026-09-24):** Chrome e Edge 109 (o último do Windows 7 e 8.1) e Firefox ESR 115. Até aqui não havia política escrita; o que a varredura desta noite mediu contra essa superfície é o que a sustenta: só o `shpjs` usava API mais nova sem guarda. Uma dependência nova que use API acima dessa linha no caminho alcançável é defeito, não escolha.
- **Status:** aceita pelo coordenador.

---

### 2026-09-24: nenhum gesto deixa de chegar ao servidor por ter mais de 200 operações (decisão do dono, B6.1)

- **Contexto:** uma transação, ou um gesto ambiente, era um lote lógico só, e o servidor recusa inteiro o lote acima de `LOTE_MAX_OPS` (200); o cliente o recusava localmente e cada op virava pendência. Medido em 2026-09-24 no Chromium, atlas de servidor, 300 feições: importar arquivo, colar ou gravar saída de processamento (`addFeatures`) deixava zero no Postgres e os dados só naquele computador; mover para outra camada (`moveFeaturesToLayer`) e DESFAZER uma exclusão em massa ou um estilo em massa deixavam zero no servidor e o retrato de recuperação revertia a ação na tela; os gestos de uma feição por vez (excluir seleção, estilo em massa, editar a tabela de atributos) já chegavam. Era o item aberto B6.1 da entrada de 2026-09-19, "o conjunto acima de `LOTE_MAX_OPS` fora de escopo por D4".
- **Decisão (dono, 2026-09-24):** todo lote lógico acima do teto (uma transação ou um gesto ambiente, compostos inclusive) sobe em blocos de até 200 na ordem do `batchIndex`, cada bloco um lote próprio, e a primeira operação de cada bloco depende (`dependsOn`) da última do bloco anterior (`createBatchOperations`, `frontend/src/js/store/sync/operation-factory.js`; nos gestos, os ids e os elos vêm de `reserveGestureBatchSlots`, `frontend/src/js/store/sync/gesture-batch.js`). O elo reaproveita duas regras que a fila já tinha: o carregador não entrega operação cuja dependência tem problema (`PendingBlockade`, `frontend/src/js/store/sync/operation-queue.js`), e o envio manda um bloco por vez, com o recibo antes do seguinte. Então um bloco só sai depois de o anterior ser aplicado, e um bloco recusado SEGURA os seguintes, contados como problema. É o que impede o sucesso mudo de membro de grupo (o insert de `group_feature` sem o grupo escreve zero linhas e volta confirmado). O `batchIndex` é contínuo, e a frase da recusa (`describeRefusedPart`) diz qual parte, quantas alterações já chegaram e quantas ficaram nas pendências. O servidor ignora `dependsOn` (ele já viajava no envelope para o encadeamento de edição); nenhuma mudança de servidor nem de contrato.
- **O preço, declarado:** o gesto acima de 200 deixa de ser tudo-ou-nada no servidor: se um colega travar o mapa no meio, os blocos já enviados ficam, o recusado e os seguintes ficam nas pendências, e a pessoa ouve quanto chegou. Transferir uma camada, agrupar e desfazer também passam a ser parciais nesse caso; antes eles não chegavam nunca.
- **O que supera:** a metade de D4 (2026-09-13) que dizia que um gesto acima do teto "não pode ser partido para caber", e o item B6.1 da entrada de 2026-09-19. O lote lógico continua resolvido por savepoint no servidor, por bloco, e o teto continua 200. A primeira versão desta decisão (partir só o mesmo verbo sobre feições independentes, compostos atômicos) foi ampliada no mesmo dia, pelo dono, para todo gesto.
- **Guardas:** `frontend/tests/e2e-ui/importar-mais-de-200-no-servidor.repro.spec.js` (importar 450, mover 250, desfazer um estilo em massa de 300: Postgres, par e fila vazia), `frontend/tests/e2e/lote-partido-parte-recusada.e2e.test.js` (a parte recusada pelo servidor real e a frase) e `frontend/tests/integration/lote-partido.repro.test.js` (o recorte, os gestos e o espelho do teto contra o backend).
- **Status:** aceita pelo dono em 2026-09-24.

### 2026-09-24: as regras de agente ganham escopo por caminho e teto, e a história da correção sai delas

- **Contexto:** o Claude Code avisou que `CLAUDE.md` mais as três regras de `.claude/rules/` somavam 226,6k caracteres carregados em toda sessão e em todo subagente, contra 150k recomendados. O conteúdo era quase todo de área (sync, catálogo privado, chunks, 360, Playwright) e boa parte era história da própria linha.
- **Decisão (dono, 2026-09-24):** o núcleo que carrega sempre é `CLAUDE.md`, `.claude/rules/architecture.md` e `.claude/rules/testing.md`, com teto somado de 60k caracteres; todo o resto mora em arquivos com `paths:`, que o Claude Code carrega quando um arquivo da área é lido. Os três nomes antigos ficaram (`common-tasks.md` passou a ser só o 360) porque código, testes e esta própria decisão os citam; o núcleo tem um índice das seções que saíram. A história de cada correção vai para o livro-razão, nunca para a regra.
- **O preço, declarado:** regra com escopo só entra quando um arquivo que casa é LIDO (grep não dispara) e sai na compactação, então o que precisa valer antes de abrir qualquer arquivo tem de caber no núcleo. O volume total das regras quase não mudou (de 225,5k para 223,5k): o ganho é no que carrega sempre (54,4k), e a poda do resto é trabalho futuro. `backend/CLAUDE.md` (50k) segue fora do teto, porque carrega sob demanda ao ler o backend.
- **Guarda:** `frontend/tests/unit/instrucoes-do-agente-teto.test.js`.
- **Status:** aceita pelo dono em 2026-09-24.
### 2026-09-24: a camada ATIVA travada não recebe feição nova

- **Contexto:** a trava de camada é convenção do cliente (o servidor a guarda e não a consulta), e o caminho de criação não perguntava por ela. `setActiveLayer` (do gerente de camadas) já recusava tornar ativa uma camada travada, mas travar a camada que JÁ era a ativa deixava toda ferramenta de desenho gravando nela: medido com dois navegadores, um ponto do Dono e um do Editor chegaram ao servidor com o id da camada travada, sem aviso. As alternativas eram recusar o gesto nomeando o estado, trocar sozinho a camada ativa para a primeira destravada, ou as duas; trocar sozinho faz o desenho cair noutra camada sem a pessoa pedir.
- **Decisão (do dono em 2026-09-24):** recusar nomeando o estado. A ferramenta que cria feição continua desenhada e a ativação recusa com "Camada ativa bloqueada. Desbloqueie-a ou escolha outra camada na aba Camadas." (portão em `setActiveTool`, pergunta `lockedActiveLayerRefusal`; a continuação pela ponta não é perguntada, porque escreve na camada da própria feição). A trava que chega no MEIO do desenho é recusada no commit, sem gravação e sem pintura, pela guarda única do caminho de criação LOCAL da store (`refuseCreationInLockedLayer` em `addFeature` e `addFeatures`). Op remota nunca é recusada. Ficam fora da guarda, por declaração: restauração (desfazer, refazer, a metade de mover de uma transferência) e mapa que não é o corrente. Importação, saída de processamento e mesclagem de mapas criam camada nova e não se aplicam; colar e o modal de pontos em lote passaram a ler a resposta da store antes de pintar e anunciar.
- **Status:** decisão do dono em 2026-09-24.

### 2026-09-24: o cabeçalho de modal é a faixa verde compacta

- **Contexto:** a revisão de tipografia e cor achou três famílias de cabeçalho: a faixa verde de 60px com título de 20px nos modais de `ModalBase`, um cabeçalho branco com filete e título de 16 a 18px em dois modais feitos à mão (edição de coordenadas do 3D e prévia em vídeo do catálogo), e modal sem cabeçalho (entrar, cadastro, pergunta e confirmação). Foram capturadas três opções no app real: a atual, a faixa verde compacta e um cabeçalho claro.
- **Decisão (dono, 2026-09-24):** faixa verde compacta. Altura mínima `--modal-header-height` (52px), título de 18px semibold, ícone de 20px e botão de fechar de 32px, em `frontend/src/css/modals-redesign.css`; os dois modais feitos à mão passam a desenhar a mesma faixa (`frontend/src/css/panels-3d.css`, `frontend/src/css/catalog.css`). Continuam sem cabeçalho, de propósito, entrar e cadastro (a marca abre o modal) e as caixas curtas de pergunta e confirmação.
- **O preço, declarado:** em tela de toque o botão de fechar continua com o alvo mínimo de 44px, e a faixa cresce para 60px ali.
- **Status:** aceita pelo dono em 2026-09-24.

### 2026-09-24: tipografia e cor passam a sair só dos tokens: fonte herdada, três pesos, escala sem 13px, uma monoespaçada

- **Contexto:** a mesma revisão mediu o texto renderizado na tela do mapa. 273 de 637 elementos saíam em Arial 13,33px, porque botão e campo não herdam a fonte; o peso 500 sai idêntico ao 600 na Segoe UI do Windows (comparação de pixels), e com cerca de duzentas regras em 500 uns 70% do texto saíam semibold; 44 regras usavam 13px, degrau que a escala não tem; havia sete pilhas de fonte monoespaçada, e 13 regras liam um `--font-mono` que ninguém definia; 601 cores hexadecimais estavam escritas à mão, uma paleta Bootstrap inteira no meio, e o oliva aposentado em 2026-09-20 sobrevivia em `rgba()`.
- **Decisão (dono, 2026-09-24):** os cinco passos propostos. Botão, campo, lista e área de texto herdam a fonte (`base.css`, e `calibracao.css`, que não carrega aquela folha). Três pesos: controle, nome e título em semibold, rótulo e texto corrido em normal, aba e item de navegação em normal com o ativo marcado por cor; o token de peso médio saiu. Tamanho só da escala: no painel lateral rótulo em `--font-size-xs` e valor ou controle em `--font-size-sm`, em modal rótulo em `--font-size-sm`. Uma pilha monoespaçada, `--font-mono`. Cor por token: escalas de vermelho, âmbar e azul com os degraus em uso, as cores semânticas apontando para elas, os cinzas e cores Bootstrap levados ao token pela propriedade (cinza que era texto ilegível foi para o degrau que passa AA), e o oliva levado ao `--primary-rgb`.
- **O que fica de fora, de propósito:** paletas CATEGÓRICAS (fundo de ícone por tipo de feição, tipo de resultado de busca, selo da auditoria, legenda de declive e de visada, o arco-íris da cor personalizada), onde cada cor identifica uma categoria; glifos de 24px para cima; e a captura do painel de texto do PDF do briefing, medida em pixel porque decide a paginação.
- **O preço, declarado:** os botões que eram Arial Regular passam a Segoe Semibold e ficam visivelmente mais pesados; o menu de contexto e as linhas da árvore de camadas crescem de 13 para 14px.
- **Guardas:** `frontend/tests/unit/tres-pesos-de-fonte.test.js`, `frontend/tests/unit/escala-de-tipografia.test.js` (tamanho literal abaixo de 24px e o reset de fonte dos controles) e `frontend/tests/unit/um-verde-so.test.js` (o oliva em qualquer grafia).
---

### 2026-09-24: os atributos personalizados de uma feição convergem por chave (decisão do dono)

- **Contexto:** o patch de feição (`featureMutationContract`, `frontend/src/js/store/sync/feature-patch.js`) tratava cada chave de `properties` como uma unidade de disputa, e `properties.attributes`, a bolsa de atributos que a pessoa nomeia e preenche um a um, era UMA delas. Dois colegas partindo da mesma revisão, um excluindo o atributo "x" e o outro mudando "y", disputavam a bolsa inteira na fronteira do servidor (`prepareFeatureMutation`, `backend/src/modules/sync/feature-conflicts.js`): o segundo era recusado como conflito, parava na fila, e "Reaplicar" nas pendências mandava a bolsa inteira de novo e ressuscitava "x". O pedido original falava em "LWW por chegada, como no resto"; lido o código, o resto das propriedades de feição não é LWW, é base e revisão por caminho.
- **Decisão (dono, 2026-09-24):** a unidade de disputa dos atributos é a CHAVE. O patch leva uma entrada no caminho properties, attributes, chave para cada chave mudada, e a exclusão vai como remoção explícita daquela chave; o servidor funde na bolsa viva e registra a fronteira por chave; o cliente que recebe já aplica a feição canônica que o servidor fundiu. A MESMA chave pelos dois lados continua conflito, a regra de `nome`, `descricao` e toda outra propriedade. O desfazer (`keepLaterEdits`) passou a ler a bolsa por chave pela mesma razão.
- **Compatibilidade:** a bolsa inteira no caminho properties, attributes (o formato de filas gravadas antes, e ainda o que o cliente manda quando a bolsa some ou não é objeto) continua aceita e aplicada como substituição. Ela passa a ser disputada também por uma escrita de chave feita depois da base dela, porque substituir a bolsa apagaria essa escrita sem ninguém saber; e uma chave é disputada pela bolsa escrita depois da base dela.
- **O que não muda:** nenhuma migração de banco; o Joi já aceitava o caminho de três segmentos. O cliente novo exige o servidor novo (um servidor antigo recusaria o caminho de três segmentos como patch inválido), e os dois pacotes saem juntos.
- **Guardas:** `backend/tests/integration/atributos-por-chave.repro.test.js`, `frontend/tests/e2e/atributos-por-chave.e2e.test.js` (contrato com a fábrica real, importação de atlas inclusive), `frontend/tests/unit/atributos-por-chave.test.js` (patch e desfazer), `frontend/tests/integration/pendencias-acoes.test.js` (reaplicar) e `frontend/tests/e2e-ui/atributos-por-chave.repro.spec.js` (duas browsers, pela aba e pela tabela de atributos).
- **Status:** aceita pelo dono em 2026-09-24.

### 2026-09-24: cada commit roda os testes do que mudou; a suíte inteira da raiz fica para contrato, deploy e main

- **Contexto:** a regra era `npm run lint` + `npm test` da raiz antes de TODO commit. Medido no mesmo dia, a raiz custa cerca de 19 minutos: 55 s de frontend, 15 a 16 min de backend e 2 min de e2e. Uma sessão de mudanças só de CSS pagou 16 minutos de backend por commit, três vezes, sem que nenhum daqueles testes pudesse ver a mudança.
- **Decisão (dono, 2026-09-24):** a cada commit, `npm run lint` + `npm run test:tocados` (`dev/testes-tocados.mjs`), que lê o `git diff` e escolhe: frontend, documentação e instrução de agente vão para `test:frontend` (~1 min, sem banco, onde moram os censos e a integridade da documentação); backend vai para os testes que MIRAM o que mudou, numa rodada hermética só (um banco): os que o importam pelo grafo, cortado em `src/app.js` porque o helper de setup o importa e por ali 487 dos 635 testes alcançavam qualquer serviço, mais os de integração cujo nome carrega o módulo; e para a suíte inteira do backend quando o alvo passa de 80 arquivos, quando um arquivo tocado não é mirado por teste nenhum ou quando a mudança é de infraestrutura ou do ponto de composição. Medido sobre os 272 arquivos de `backend/src`: 210 saem com alvo (mediana de 13 arquivos; os 4 de grupo de acesso rodam em 18 s), 31 pedem a raiz e 31 a suíte do backend; contrato entre os pacotes (sync nos dois lados, `/api/config`, papéis, as quatro folhas espelhadas, migrações, o e2e) ou código dos dois pacotes vai para o `npm test` inteiro. A raiz inteira continua obrigatória antes de deploy e de levar à main.
- **O preço, declarado:** o grafo do backend só segue import relativo escrito com literal; a afinidade é por nome, então um teste de integração de outro módulo que exercite este por tabela não é mirado; e a lista de contrato é escrita à mão, não medida. Os três buracos só fecham na rodada completa.
- **Guardas:** `frontend/tests/unit/testes-tocados.test.js` (cada regra do plano, o grafo transitivo e um piso sobre o grafo real; controle negativo feito duas vezes: a lista de contrato vazia derruba onze casos, e o corte em `src/app.js` desfeito derruba o piso sobre o grafo real) e `frontend/tests/unit/scripts-da-raiz.test.js`.
- **Status:** aceita pelo dono em 2026-09-24.

### 2026-09-25: a foto anexa viaja como blob com referência, e a edição que a cita espera os bytes

- **Contexto:** a foto anexa a feição, a marcador 3D e a marcador 360 viajava INLINE, como data URL dentro da entidade, e toda edição levava os bytes nos dois lados do envelope. Medido no navegador: renomear uma feição com foto de 212 KB empurrava 432 KB.
- **Decisão (campanha de 2026-09-24, integrada em 2026-09-25):** o item de foto guarda id, nome, tipo, tamanho e miniatura; os bytes vão para `images` do atlas pela rota de lote que preserva o id, pela fila durável de blobs. A leitura aceita as duas formas para sempre (`frontend/src/js/user_data/photo-refs.js`), que é o que torna a transição do main segura sem passo atômico. A operação que cita uma foto com bytes pendentes nasce preparada e só sai quando TODAS as fotos citadas confirmam (`operacaoEsperaBlob`).
- **Alternativa recusada:** a operação que não espera a foto, que foi o desenho inicial. A primeira revisão mediu a perda: a 40 kbps a edição saía em um segundo e a foto levava minutos, "Sair" contava zero pendências, e o servidor ficava citando uma foto que nunca receberia.
- **As regras que se decidiram no caminho:** a foto inline antiga só é convertida quando a edição mexe nas fotos da feição; o 3D e o 360 convertem em qualquer escrita, porque são disputados como documento inteiro. O custo aceito é que uma edição sem relação leva os bytes da foto inline uma vez. A figura APNG sobe achatada num PNG parado, e a cópia local fica com o original. A recusa definitiva de uma foto CONVERTIDA vira problema nas operações que a citam, no atlas da foto e também nas que nascem ou são reprojetadas depois (o servidor mantém a cópia inline); a de uma foto ANEXADA deixa a operação sair com a referência. As transferências vão ao fio uma de cada vez (`emSerie`), menos as cópias e o ícone personalizado, que esperam a própria subida. "Salvar como local" e o resgate da saída baixam antes as fotos que faltam (`baixarFotosQueFaltam`). O blob de foto não é apagado quando a foto sai da entidade: o órfão fica para a coleta.
- **Guardas:** `frontend/tests/integration/op-espera-a-foto.repro.test.js`, `frontend/tests/integration/recusa-de-foto-convertida-no-atlas-certo.repro.test.js`, `frontend/tests/integration/retomadas-sobrepostas-sobem-uma-vez.repro.test.js`, `frontend/tests/integration/icone-nao-espera-a-fila-de-fotos.repro.test.js`, os specs de foto de `frontend/tests/e2e-ui/` (`frontend/tests/e2e-ui/foto-anexa-por-referencia.spec.js` e vizinhos) e a transição do main com fotos inline, byte a byte, em `frontend/tests/e2e-ui/transicao-main-fotos.spec.js`.
- **Em aberto:** a foto anexada recusada deixa um registro que nenhum gesto remove, e toda saída pergunta por ele; e um 413 com o token vencido vira recusa definitiva. Os dois estão no PENDENCIAS como perguntas.
- **Status:** integrada em 2026-09-25.

### 2026-09-24: o UPDATE e o DELETE de feições distintas de um gesto em massa saem independentes (decisão do dono, refina o B6.1)

- **Contexto:** excluir e estilizar em massa, e desfazer e refazer esses dois, passaram a gravar o documento do mapa uma vez numa transação só (`removeFeatures` e `updateFeatures`, `frontend/src/js/store/feature.operations.js`), e uma transação era um lote lógico, partido em blocos encadeados acima de 200 pela decisão B6.1 do mesmo dia. Medido em 2026-09-24 no Chromium, dois navegadores e Postgres: 1000 estilos com UMA feição apagada pelo colega no meio deixaram 599 feições vivas sem o estilo no servidor, porque a parte em que ela estava foi recusada inteira e segurou as seguintes. No caminho de uma transação por feição, a mesma interferência custava uma feição.
- **Decisão (dono, 2026-09-24):** o UPDATE e o DELETE de feições DISTINTAS gerados por esses gestos em massa (excluir, estilo, e o desfazer e o refazer deles) saem como operações INDEPENDENTES: sem `batchId`, sem `batchIndex` e sem o elo entre partes, a forma de `createOperation`, de modo que o servidor aplica ou recusa cada uma sozinha e um conflito custa só aquela feição. A gravação única do documento e a transação write-ahead única continuam. As operações plurais marcam cada operação de feição com `independent`, e `createBatchOperations` (`frontend/src/js/store/sync/operation-factory.js`) as tira do lote, emitindo antes, contíguas, as que continuam no lote (as de grupo da mesma exclusão). A marca é IGNORADA dentro de um gesto (`withGestureBatch`), e é isso que mantém inteiros os compostos: converter uma feição, fundir setas, transferir uma camada e desfazer um composto. O desfazer e o refazer de um gesto em massa (uma entrada `batch` só de edições ou só de remoções) correm fora da identidade de gesto (`isMassEntry`, `frontend/src/js/store/store-state-manager.js`); o desfazer de uma exclusão recria numa transação só, que é criação e continua um lote em partes encadeadas. O lote atômico e as partes encadeadas ficam para os compostos e para a criação (importar, colar, duplicar). Mover para outra camada não está na lista e continua um lote.
- **O preço, declarado:** um estilo ou uma exclusão em massa deixa de ser tudo-ou-nada no servidor mesmo abaixo de 200: o que o servidor recusar fica nas pendências feição a feição, e o resto chega. O envio sai 25 operações por pedido, como antes do lote (1000 estilos, 40 pedidos), em vez de 200.
- **O que refina:** a decisão B6.1 do mesmo dia, que partia TODO lote acima do teto em blocos encadeados. Ela continua valendo para tudo o que não é UPDATE ou DELETE de feições distintas de um gesto em massa.
- **Guardas:** `frontend/tests/integration/lote-partido.repro.test.js` (bloco "a marca independent": 450 estilos sem lote nem elo, o controle sem a marca em 200 + 200 + 50, o lote de grupo contíguo antes das independentes, a marca ignorada dentro de um gesto, e importar 450 ainda em partes encadeadas), `frontend/tests/e2e/lote-partido-parte-recusada.e2e.test.js` (caso 5, servidor real: 250 estilos com uma feição apagada antes do envio, 249 chegam e 1 fica nas pendências; sem a marca, 0), `frontend/tests/store/desfazer-em-massa-um-documento.repro.test.js` (o desfazer em massa fora do gesto, o composto dentro) e `frontend/tests/store/gesto-local-em-massa-um-documento.repro.test.js` (uma leitura e uma escrita do documento para 1000, e a marca em cada operação).
- **Status:** aceita pelo dono em 2026-09-24.
