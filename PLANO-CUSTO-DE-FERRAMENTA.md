# Plano: o custo de acrescentar uma ferramenta

**Status: plano, não implementação.** Escrito em 2026-08-15, contra o commit `c27cc930`, no branch `integracao_backend`. Nenhuma linha de código foi alterada.

Origem: um estudo comparativo do GeoLibre (`opengeos/GeoLibre`, MIT, snapshot v2.6.0) pedido pelo dono, e a pergunta que saiu dele: **o modelo de dados mais simples daquele projeto valeria aqui, já que vamos acrescentar mais ferramentas e acrescentar ferramenta tem custo?** A resposta curta é não para o modelo deles, e sim para generalizar, mas na direção que este repositório já usa do outro lado da fronteira. O resto do documento é a medição que sustenta isso e o plano que decorre dela.

> **Divergência declarada.** A raiz do monorepo tem hoje três `.md` de propósito, e este é um quarto, colocado aqui a pedido do dono. A raiz **não** é varrida por `frontend/tests/unit/docs-integridade.test.js`, que vigia `CLAUDE.md`, `README.md` e as pastas `docs/`, `.claude/rules/`, `.claude/skills/` e `.claude/agents/`. Ou seja, **este arquivo não tem guarda**: caminho ou símbolo que apodreça aqui não fica vermelho em lugar nenhum. Ele é transitório e deve sair quando os itens forem executados, com o conteúdo perene migrando para `docs/wiki/` e para `docs/livro-razao.md`.

**Convenção de leitura.** Caminho e símbolo entre crases existem no código hoje, e todos os citados aqui foram conferidos um a um contra `c27cc930`. Arquivo a ser criado aparece em prosa, sem crase, e vem marcado como novo. Essa é a regra da casa (crase promete código que existe) e ela vale aqui mesmo sem guarda, para o caso de alguém acrescentar este arquivo à lista vigiada.

---

## 0. Revisão de 2026-08-16, contra o código depois da fase multi-aba

Este plano foi escrito contra `c27cc930`, o primeiro commit da fase de namespace por atlas.
Aquela fase seguiu por mais seis commits e mudou o núcleo do store, então o plano foi reconferido
inteiro. **Ele sobreviveu**, e o que segue é o que mudou, o que envelheceu e o que ele ganhou.

### 0.1 As âncoras continuam de pé, e isso foi MEDIDO

Extraí do texto os 57 caminhos de arquivo e os 57 símbolos entre crases e verifiquei um a um
contra a árvore: **nenhum caminho ausente, nenhum símbolo sem ocorrência no código.** É o mesmo
que o `docs-integridade` faria, e vale registrar que ele **não** varre a raiz, então esta
conferência é manual por construção e precisa ser repetida à mão a cada revisão.

### 0.2 Os dois bugs vivos continuam vivos, e a fase não os tocou

- **Item 1**: `FEATURE_SOURCES` (`frontend/src/js/layers/layer.constants.js`) segue com 17
  entradas e **sem** a declinação magnética.
- **Item 1, segunda metade**: `shiftFeatureTimes`
  (`frontend/src/js/temporal/temporal-controller.js`) segue chamando `shiftMapTemporalTimes` sem
  consumir o retorno, e `GuardAction` continua com **zero** ocorrências em
  `frontend/src/js/temporal/`.
- **Item 2**: `rederiveAutoDtg` (`frontend/src/js/store/feature.operations.js`) segue comparando
  contra os singulares `military_symbol` e `coordination_measure`.

### 0.3 ~~UMA IMPRECISÃO~~ — ESTA SEÇÃO ESTAVA ERRADA, e a execução a refutou

> **Retratação, escrita em 2026-08-16 pelo mesmo autor da revisão.** O texto original desta seção
> afirmava que `LOS: 'los'` e `VISIBILITY: 'visibility'` ERAM as duas saídas de processamento com
> grafia errada, e concluía que o conserto seria **reescrever duas entradas**. **Isso é falso.**
>
> Medido em `frontend/src/js/layers/styles/tactical.layers.js`: existem **QUATRO** fontes vivas,
> duas por análise, criadas lado a lado no mesmo módulo. `'los'` e `'visibility'` são a geometria
> de **ENTRADA** da análise (baldes `los` e `visibility`); `'processed-los'` e
> `'processed-visibility'` são a **SAÍDA** (baldes `processed_los` e `processed_visibility`).
> Quatro baldes, quatro fontes.
>
> Logo, as entradas `LOS`/`VISIBILITY` de `FEATURE_SOURCES` estavam **certas**, e o que faltava
> eram **três** entradas, não duas reescritas: a declinação magnética e as DUAS saídas.
> **Seguir esta seção teria trocado um buraco por outro**, removendo da lista as fontes de
> entrada da análise. A seção 5 original estava certa no efeito e no diagnóstico; foi esta
> "correção" que confundiu entrada com saída.
>
> **A lição, que vale mais que o caso:** a revisão leu a lista de constantes e a lista de fontes
> e casou os nomes por semelhança, sem abrir o módulo que CRIA as fontes. Semelhança de nome não
> é identidade de papel. O executor pegou o erro porque a instrução dele dizia, em tantas
> palavras, que onde o plano e o código discordarem **o código decide** — e ele foi conferir.
>
> O conserto real está feito: `FEATURE_SOURCES` foi de 17 para 20 entradas, para 21 baldes, com
> `coordenadas` em allowlist por não ter fonte nem camada.

### 0.4 O que a fase multi-aba mudou e este plano precisa saber

Nada que invalide o argumento central, e três coisas que mudam o terreno:

- **A fila de saída é FÍSICA por atlas** (`OPERATION_QUEUE.perAtlas`), e a operação carrega o
  endereço do escopo em que nasceu mais o `atlasId` de servidor. A seção 2.4 mede o custo por
  classe de sincronização e continua válida, mas o envelope deixou de ser o mesmo objeto: quem
  acrescentar uma classe nova agora também decide o que ela carimba.
- **O schema de sync do backend passou a declarar os campos novos explicitamente**
  (`backend/src/modules/sync/sync.schemas.js`), pelo mesmo motivo que o `traceId` já era
  declarado: não se confia no `.unknown(true)`. Isso reforça o item 6 (o guarda de paridade entre
  os pacotes) em vez de enfraquecê-lo.
- **A wiki mudou** em `docs/wiki/coordenacao-entre-abas.md` e `docs/wiki/namespace-por-atlas.md`.
  A afirmação da seção 2.3 sobre `docs/wiki/atlas-import-offline.md` (registra três das quatro
  cópias e omite a quarta) foi reconferida e **continua verdadeira**.

### 0.5 O regime de verificação da seção 4 foi validado na prática, e ganha duas regras

As quatro regras da seção 4 não são teoria: a fase multi-aba as praticou por seis commits e cada
uma delas pegou defeito real. Duas lições novas, que a fase pagou caro para aprender, entram
aqui porque valem para qualquer item deste plano:

5. **Mutação que passa verde pode ser linha REDUNDANTE, não teste vazio.** Aconteceu com a defesa
   em profundidade do resgate: duas linhas sustentavam a mesma garantia, e mutar uma delas não
   mudava nada. Antes de condenar um teste, mute o CONJUNTO que sustenta a garantia.
6. **Um teste que modela o mundo antigo não reconhece o conserto.** Aconteceu duas vezes: um
   `it.fails` que lia uma chave aposentada ficava verde existisse ou não o defeito, e um helper
   que simulava o import como escrita crua mantinha o caso vermelho depois de a correção existir.
   **Ao promover um caso, conserte o helper dele primeiro**, senão o defeito some do relatório sem
   ninguém perceber que fechou.

E uma advertência de escopo, aprendida na marra: **reverter uma mutação com `git checkout` num
repositório cujo trabalho não está commitado apaga o trabalho.** Reverta pela operação inversa.

### 0.6 O que NÃO foi reconferido

As medições de arqueologia da seção 2 (as datas em que cada lista aprendeu o setor, as contagens
de ocorrência por `EntityType`) foram tomadas por leitura de histórico e **não** foram refeitas
nesta revisão. Elas sustentam o argumento e não a execução: se algum item depender de um daqueles
números, meça de novo antes.

---

## 1. De onde isto vem

O GeoLibre foi clonado e lido por leitura de código, não de roadmap. O que interessa dele para esta decisão cabe em três frases. Ele tem um store global imutável, um único reconciliador que projeta o estado no MapLibre, e um modelo de dado deliberadamente plano, onde camada é um registro raso e estilo é um objeto de cerca de oitenta campos escalares por camada. Com isso, desfazer, salvar projeto, colaborar e exportar viram a mesma operação, que é fatiar o mesmo objeto. O preço é que ele **não tem camada de operações**, logo não tem o que transmitir além do documento inteiro: a colaboração dele é broadcast do projeto com last-write-wins por ordem de chegada, sem fila offline, e a edição feita com o socket caído se perde em silêncio.

O EBGeo comprou o oposto. A persistência é a verdade, a escrita passa por `runTransaction` persistence-first, e cada gesto vira uma operação numa fila com compactação, relógio de Lamport, idempotência por `op_id` e cinco níveis de permissão por atlas. Isso torna cada entidade nova cara, e em troca não existe aquela classe de falha.

**Conclusão que fecha o eixo:** o custo por classe de sincronização que se paga aqui é exatamente o que compra a correção do sync. Ele não é para reduzir, é para tornar verificável. Adotar o modelo do GeoLibre (uma source por camada, estilo por camada) exigiria reescrever todos os controles de desenho, o dispatcher e o filtro de visibilidade, e ainda perderia o que o produto precisa, que é estilo autoral por feição no calco militar.

Sobra a pergunta certa: **quanto do custo de acrescentar uma ferramenta é essencial e quanto é acidental?**

---

## 2. O que foi medido

### 2.1 O commit de uma ferramenta

A ferramenta mais recente é o setor (`0c8cf2e5`, 2026-02-08). Custou 14 arquivos e 1573 linhas, assim divididas:

| parte | linhas | natureza |
|---|---|---|
| control, geometria e painel de atributos | 1402 | a ferramenta em si, 89% |
| `frontend/src/js/layers/styles/shape.layers.js` | 133 | estilo MapLibre, trabalho real |
| fiação em dez arquivos | cerca de 45 | **o imposto** |

O imposto é pequeno em digitação e alto em memória: quarenta e cinco linhas espalhadas por dez arquivos, cada uma numa lista fechada diferente, e nenhuma delas falha alto quando é esquecida.

### 2.2 O imposto não é pago à vista

Rastreando quando cada lista aprendeu que o setor existia:

| lista | nasceu em | aprendeu o setor em | atraso |
|---|---|---|---|
| `frontend/src/js/features_tab/features_tab.constants.js` | 2026-01-18 | 2026-02-16 | 8 dias |
| `frontend/src/js/layers/layer.constants.js` | 2026-01-18 | 2026-02-16 | 8 dias |
| `frontend/src/js/import_export/pdf-export.tab.js` | 2026-01-18 | 2026-02-21 | 13 dias |
| `backend/src/modules/sync/sync.service.js` | 2026-03-08 | 2026-06-22 | nasceu depois, aprendeu 3 meses após |
| `frontend/src/js/import_export/kmz/kmz-feature-types.js` | 2026-07-20 | já nasceu certo | nenhum |

A ferramenta entrou num dia e o sistema levou semanas para saber dela por inteiro. O commit da ferramenta parece completo e não é.

### 2.3 As listas já divergiram

Existem hoje **três** constantes chamadas `FEATURE_SOURCES`, com conteúdos diferentes, e **duas** chamadas `FEATURE_DISPLAY_NAMES`, com chaves em espaços de nome diferentes:

- `frontend/src/js/layers/layer.constants.js`, objeto, 17 entradas, **sem** a declinação magnética;
- `frontend/src/js/features_tab/features_tab.constants.js`, array, 18 entradas, com ela;
- `frontend/src/js/store/store.constants.js`, derivado de `FEATURE_TYPE_MAPPINGS`, 20 entradas, incluindo as duas saídas de processamento.

E `SOURCE_TYPES`, que o próprio comentário declara canônico, **não é exportado**: ele só ordena os mapas irmãos escritos à mão no mesmo arquivo, e tem um único leitor. Não existe hoje símbolo importável que signifique "todos os tipos", exceto `getAllStorageTypes()`, que é derivado e já dá o tipo novo de graça aos seis pontos que o consomem.

Cruzando a fronteira dos pacotes, a lista de tipos tem **quatro** cópias, hoje alinhadas em 20:

- `frontend/src/js/import_export/local-atlas-to-server.js` (cliente);
- `VALID_FEATURE_TYPES` em `backend/src/modules/atlas/atlas.schemas.js` (Joi);
- a constraint `valid_feature_type` em `backend/src/database/migrations/002_atlas.sql` (banco);
- `typeToCollection` e o esqueleto de `transformFeaturesToFrontend` em `backend/src/modules/sync/sync.service.js`.

A wiki já registra três dessas em `docs/wiki/atlas-import-offline.md`, e omite a quarta, que é justamente a de dano mais silencioso.

### 2.4 O custo por classe de sincronização não é uniforme

Contagem de pontos que citam cada `EntityType` nos dois pacotes:

| classe | backend | frontend | como é representada |
|---|---|---|---|
| `mapTemporal` | 1 arquivo, 3 ocorrências | 2 arquivos | coluna JSONB em `maps` |
| marcadores 3D e 360 | 1 arquivo, 2 a 4 ocorrências | poucos | tabela polimórfica com discriminador |
| `catalogLayer` | 3 arquivos, 17 ocorrências | 16 arquivos | tabela e coluna legada |
| `briefing` | 13 arquivos, 135 ocorrências | 45 arquivos | tabela própria |
| `comment` | 26 arquivos, 95 ocorrências | 38 arquivos | tabela própria e degrau de permissão |

Três ordens de grandeza entre a mais barata e a mais cara. O que decide não é a importância da funcionalidade: o módulo temporal é grande no frontend, e o custo de **sincronizá-lo** foi uma coluna e uma linha.

---

## 3. O que decide o custo, e por que a resposta não é copiar o GeoLibre

**O backend já é o modelo genérico.** As três tabelas de dado colaborativo são polimórficas: discriminador em CHECK e payload opaco em JSONB. Ele não tem quinze listas, tem três constraints e dois mapas de tradução. Portanto generalizar o frontend não é copiar um projeto de fora, é **alinhar o frontend ao modelo que esta casa já usa do outro lado da fronteira**.

**O custo se divide em três níveis, e só o primeiro é acidental.**

1. **Ferramenta de desenho nova.** Reusa `EntityType.FEATURE` inteiro. No backend custa uma linha na constraint, uma no Joi e duas nos mapas, tudo já genérico. No frontend custa as quinze listas. É aqui que a generalização paga.
2. **Ferramenta que traz configuração por mapa** (como a temporal). Já resolvida pelo padrão de `createMapSettingLogger` mais coluna JSONB. Uma coluna e uma linha.
3. **Ferramenta que traz entidade colaborativa própria.** Custa dezenas de arquivos nos dois pacotes, e o caro é **irredutível**: não é duplicação, são cinco decisões de modelagem que falham em silêncio se erradas, todas já enumeradas em `docs/wiki/tipos-entidade-sync.md`. Faltar o `case` inbound morre num `console.warn`. Ficar fora de `CONVERGENCE_GUARDED` não gera erro, só divergência. Reusar o id do mapa colide na compactação. Errar o lado (compartilhado contra local) é o bug mais comum de feature nova. E o degrau de permissão próprio.

Generalizar o modelo de dados reduz o nível 1 e não toca o nível 3. Por isso o plano abaixo começa por bugs vivos e por guardas mecânicos, e só termina no registro de tipos.

---

## 4. O regime de verificação, que vale para todos os itens

Quatro regras. Sem elas, metade dos itens vira verificação fantasma, que é a classe mais recorrente de `docs/livro-razao.md`.

1. **Controle negativo nominal, ou o item não é declarado pronto.** Reverta a linha, nomeie o teste que fica vermelho, transcreva a mensagem no corpo do commit. Verde de suíte não é controle negativo.
2. **Cinco itens nascem verdes por construção**, porque são guardas sobre código hoje correto. Esses carregam **controle positivo obrigatório**: uma fixture sintética ou uma mutação deliberada que prove que o teste enxerga. Guarda que nasce verde e nunca foi visto vermelho é indistinguível de guarda cego.
3. **Nenhum texto congelado cita número de linha.** Só nome de arquivo e símbolo. O `docs-integridade` valida caminho e símbolo, nunca linha, e não alcança arquivo de teste: linha em texto congelado apodrece sem nada ficar vermelho.
4. **Piso anti-vazio antes de toda comparação.** Todo guarda que extrai da fonte roda primeiro a asserção "a extração achou alguma coisa", com mensagem própria. Sem ela, o dia em que a âncora quebrar produz o diagnóstico errado: lê-se "as listas divergiram" onde o certo é "o extrator parou de funcionar".

Duas restrições de ambiente, medidas e não negociáveis:

- **Não use `npm run build` como guarda de nada aqui.** O `frontend/vite.config.js` fixa o limite de tamanho de chunk e diz por extenso que um chunk o estoura de propósito. Guarda que exija build sem aviso nasce vermelho por desenho do projeto.
- **Não use análise por AST.** O `acorn` não está declarado em `package.json` nenhum; um teste existente só o resolve por hoisting transitivo. Declarar a dependência toca o lockfile, que a constituição trata como frágil, e vira decisão com dono.

E uma escolha de forma, já feita: **teste, não regra de lint.** As regras do frontend só rodam sobre `src/`, e o desvio de todos estes itens é invisível no arquivo que o comete. Quem acrescenta um `EntityType` não vê, ali, o switch de outro arquivo.

---

## 5. Os oito itens, em ordem de risco de erro silencioso

### Item 1. Reagendar deixa a fonte viva fora de fase, e metade do gesto escreve sem gate de permissão

**Nasce vermelho. Bug vivo.**

**O defeito.** Depois de Reagendar, o IndexedDB tem a janela nova e a fonte viva tem a antiga. `shiftMapTemporalTimes` (`frontend/src/js/store/feature.operations.js`) itera `Object.keys` sobre os 21 baldes de `getEmptyMapData`, que é lista aberta. `shiftSourcesTemporal` (`frontend/src/js/temporal/temporal-render.service.js`) itera `Object.values(FEATURE_SOURCES)`, que é lista fechada de 17 e não contém a declinação magnética nem as duas saídas de processamento. Como o filtro temporal é expressão MapLibre lendo `temporalInicio` **da fonte** (`frontend/src/js/layers/visibility-filter.js`) e a camada da declinação está em `FEATURE_LAYER_IDS`, o diagrama aparece e some no instante errado até um F5. A fonte existe (`frontend/src/js/layers/styles/symbol.layers.js`) e o painel anexa validade temporal sem gate de tipo (`frontend/src/js/sidebar/panels/feature-panel-content.js`).

**O segundo defeito, no mesmo gesto.** `shiftFeatureTimes` (`frontend/src/js/temporal/temporal-controller.js`) chama a metade gateada, que devolve 0 quando `guardWrite` bloqueia, **ignora esse retorno** e chama a metade sem gate. Hoje um usuário `read` ou `comment` num atlas remoto clica em Reagendar, vê 17 fontes deslocadas na tela, o store intacto, e `_rescheduleFeatures` (`frontend/src/js/temporal/temporal-settings.modal.js`) anuncia sucesso de qualquer jeito. Buscar por `GuardAction` em `frontend/src/js/temporal/` devolve zero. **Corrigir a lista sem fechar o gate leva esse número de 17 para 20, ou seja, piora a violação.**

**Passos.**

1. Escrever o repro (arquivo novo, em `frontend/tests/unit/`, sufixo `.repro.test.js`), no molde narrativo de `frontend/tests/integration/import-phantom-map.repro.test.js`. Importar a produção, nunca copiá-la.
2. Reusar o duplo de source de `frontend/tests/unit/temporal-render-retained-source.test.js`. O `getData` assíncrono é obrigatório: o laço exige que ele seja função e sem isso faz `continue`, deixando o teste verde por engano.
3. Povoar três fontes: símbolos militares (controle positivo, tipo que já está na lista), declinações magnéticas (o sujeito) e a saída de linha de visada **com hífen**, que é a grafia real da fonte viva em `frontend/src/js/layers/styles/tactical.layers.js`.
4. Asserções nesta ordem: (a) o controle positivo deslocou; (b) a declinação deslocou início e fim; (c) a fonte com hífen deslocou. Se (a) falhar, o instrumento está quebrado, não o produto.
5. Guarda estrutural no mesmo arquivo: todo balde de `getEmptyMapData` tem fonte viva declarada em `FEATURE_SOURCES`. **Não** use normalização genérica trocando hífen por underscore: ela apaga exatamente a única diferença que importa e deixaria o guarda verde com a grafia errada. Use tabela explícita de grafia.
6. Allowlist com motivo escrito para `coordenadas`, que são leituras efêmeras sem fonte nem camada e são declaradas ausentes do contrato do servidor em `frontend/src/js/import_export/local-atlas-to-server.js`.
7. Pisos anti-vazio antes de qualquer comparação, mais uma asserção absoluta ao lado da comparativa, no molde de `frontend/tests/unit/calibracao-espelha-marcador-andar.test.js`.
8. Rodar só este arquivo **antes** de tocar em `src/`. Exigência: (a) verde, (b) e (c) vermelhas, e o estrutural vermelho listando exatamente três baldes.
9. Corrigir `FEATURE_SOURCES` com as três entradas, hífen nas duas de processamento, e trocar o JSDoc por um que declare o contrato.
10. Fechar o gate reusando o que já existe: `shiftFeatureTimes` consome o retorno de `shiftMapTemporalTimes` e sai cedo quando for 0, antes de chamar `shiftSourcesTemporal`. **Não** duplique a hierarquia de permissão num segundo lugar.
11. Acrescentar um quarto caso: com o guard bloqueando, nenhuma fonte recebe `setData`.
12. `_rescheduleFeatures` deixa de anunciar sucesso incondicionalmente. Cuidado: zero também ocorre legitimamente num mapa sem feição temporal, então a mensagem precisa distinguir os dois casos.
13. Conferir por caminho independente do teste que os consumidores de `FEATURE_SOURCES` continuam sendo três. Consumidor novo significa que a mudança não é local: pare e releia.
14. Rodar `frontend/tests/unit/despachante-sem-escrita-crua.test.js` antes e depois. Sem o "antes", um vermelho pré-existente seria atribuído a este item.
15. Registrar uma linha em `docs/livro-razao.md` dizendo onde a lição foi codificada, nomeando a classe (metade aberta contra metade fechada no mesmo gesto). **Não** acrescente parágrafo a `.claude/rules/architecture.md` pedindo para lembrar de editar a lista: foi exatamente essa forma que falhou.

**Controle negativo.** Quatro, um por vez. (1) Reverter a linha da declinação deixa duas asserções vermelhas. (2) Trocar o hífen por underscore deixa vermelho o caso que a normalização genérica deixaria passar. (3) Reverter o consumo do retorno deixa vermelho o caso do guard bloqueando. (4) Do instrumento, exibir e reverter: apagar o `getData` assíncrono do duplo faz o repro ficar verde por engano.

**Pronto quando.** Quatro casos verdes; a execução anterior ao fix transcrita; os quatro controles negativos executados com as mensagens transcritas; `npm run lint` e `npm test` da raiz rodados como dois comandos separados antes do commit, com a contagem de skips anotada.

**Arquivos.** Um teste novo; `frontend/src/js/layers/layer.constants.js`; `frontend/src/js/temporal/temporal-controller.js`; `frontend/src/js/temporal/temporal-settings.modal.js`; `docs/livro-razao.md`. Cinco arquivos, não cruza a fronteira dos pacotes.

---

### Item 2. Os dois ramos de `rederiveAutoDtg` são inalcançáveis

**Nasce vermelho. Bug vivo.**

**O defeito.** `rederiveAutoDtg` (`frontend/src/js/store/feature.operations.js`) compara o tipo contra os singulares `military_symbol` e `coordination_measure`, mas é chamada dentro do laço de `shiftMapTemporalTimes` com a chave vinda de `Object.keys`, que são os **plurais** dos baldes. Nenhum ramo executa. O JSDoc da própria função diz "Storage feature type", que é o espaço de nome plural: a documentação registra o erro. Sintoma: depois de Reagendar, o rótulo de data do símbolo militar fica no dia velho enquanto a janela foi para o novo, sem erro.

Vem em segundo, e não junto do item 1, porque dois fixes num commit produzem um vermelho só e apagam a atribuição de causa.

**Passos.**

1. Escrever o repro (arquivo novo em `frontend/tests/unit/`) dirigindo a função pública `shiftMapTemporalTimes`, nunca a privada.
2. Duas asserções: o deslocamento em si (controle positivo, já funciona) e a re-derivação do grupo data-hora (o repro, que reprova hoje). A primeira verde com a segunda vermelha é o que prova que o teste mede a re-derivação e não o deslocamento.
3. Caso irmão para a medida de coordenação: os dois ramos estão mortos, não um.
4. Rodar antes do fix e transcrever. Se nascer verde, a leitura estava errada e o item muda, não o teste.
5. Corrigir convertendo a chave para o tipo antes da chamada, com `getSourceTypeFromStorage`, que já existe em `frontend/src/js/store/store.constants.js` e já é consumido por `frontend/src/js/utilities/feature_navigation_utils.js`. **Não** duplique a tabela dentro do arquivo.
6. Registrar a linha em `docs/livro-razao.md` nomeando a classe: comparação entre dois espaços de nome, num sítio onde nenhum dos dois lados lança.

**Controle negativo.** Reverter a conversão deixa as duas asserções de data vermelhas com a de deslocamento verde. Do instrumento: desligar a opção de derivação automática na fixture e confirmar que os dois casos ficam verdes, o que prova que o teste mede o opt-in.

**Arquivos.** Um teste novo; `frontend/src/js/store/feature.operations.js`; `docs/livro-razao.md`. Três arquivos.

---

### Item 3. Todo `EntityType` emitido tem `case` em `applyRemoteOperation`

**Nasce verde. Guarda.**

**A classe.** Op cujo tipo não tem `case` cai no ramo padrão de `applyRemoteOperation` (`frontend/src/js/store/sync/remote-operation-handler.js`), vira `console.warn`, e o par nunca converge sem que nada falhe.

Vem antes dos outros guardas por três razões ordenadas: é o mais barato (arquivo e regex, zero import de módulo de produção); é o de maior severidade; e é o que expõe a anomalia de que o item 4 depende. `EntityType` tem 21 membros e o switch principal tem 20 `case`. O ausente é `ATLAS`, que é membro morto do enum.

**Passos.**

1. Criar o guarda em `frontend/tests/unit/` (arquivo novo), na forma canônica da casa: leitura de fonte com `readFileSync` mais regex, como `frontend/tests/unit/scripts-da-raiz.test.js` e `frontend/tests/unit/despachante-sem-escrita-crua.test.js`.
2. Extrair os roteados **fatiando** de `applyRemoteOperation` até o primeiro ramo padrão. Fatiar importa: existe um segundo switch em `applyRemoteMapSettingOp`, com cinco rótulos que são subconjunto do principal, e regex de arquivo inteiro deixaria passar a remoção de um `case` do principal. A âncora do switch deve aceitar discriminante de qualquer nome, para renomear a variável não quebrar o guarda.
3. Extrair os emitidos varrendo `frontend/src/js/store/sync/operation-dispatcher.js` pelas duas fábricas, `createEntityLogger` e `createMapSettingLogger`, mais as chamadas diretas de log.
4. Controle positivo **antes** de qualquer varredura real: rodar o extrator contra uma fixture sintética inline com dois switches, provando que ele pega o primeiro e ignora o segundo.
5. Piso antes da propriedade, com mensagem própria dizendo que a âncora quebrou e que o teste passaria vazio.
6. Propriedade: emitidos menos roteados é vazio; e o fecho do universo, `EntityType` menos roteados menos allowlist é vazio. Importar `EntityType` direto de `frontend/src/js/store/sync/operation-types.js`, que não tem nenhum import e é seguro em node puro.
7. `ATLAS` entra como marcador de lacuna conhecida que quebra **nos dois sentidos**: quando ganhar emissor ou quando for removido do enum. Não como allowlist que fica verde para sempre.
8. Mensagem de falha que ensina a correção, avisando que o switch interno não conta e que tipo que é no-op inbound de propósito (como o slide, que converge pelo briefing pai) precisa do `case` assim mesmo.
9. Escrever no cabeçalho as fragilidades aceitas: quebram trocar o switch por tabela de funções, trocar o rótulo por literal de string, renomear o enum com alias, e inserir outro switch antes do principal. Todas quebram para o lado seguro, que é o piso vermelho.
10. Registrar a linha em `docs/livro-razao.md` e atualizar `docs/wiki/tipos-entidade-sync.md`, que hoje descreve esta decisão como disciplina e passa a ter guarda executável.

**Controle negativo.** Três. (1) Comentar o `case` do comentário espacial. (2) Apagar o switch inteiro, que deve deixar vermelho o **piso**, antes da propriedade. (3) O que nenhuma outra forma pega: apagar um `case` do switch principal mantendo o do switch interno.

**Arquivos.** Um teste novo; `docs/wiki/tipos-entidade-sync.md`; `docs/livro-razao.md`. Zero arquivos de produção.

---

### Item 4. Decisão escrita sobre `CONVERGENCE_GUARDED` para cada um dos 21 tipos

**Nasce verde. Guarda.**

**A classe, com custo já pago aqui.** `CONVERGENCE_GUARDED` (`frontend/src/js/store/sync/remote-operation-handler.js`) reúne os tipos cujo update substitui o objeto inteiro e que por isso precisam de last-write-wins por versão do servidor. O briefing ficou fora até 2026-07-25 e, como o inbound grava o briefing inteiro com o array de slides, dois usuários editando slides do mesmo briefing não tinham proteção nenhuma: o último a chegar apagava o trabalho do outro, sem erro. O Set governa três metades do guarda, então ficar de fora não gera erro, só divergência entre pares.

**Passos.**

1. Criar o teste em `frontend/tests/unit/` (arquivo novo). Import **direto** do arquivo, nunca pelo barrel: o Set não aparece em `frontend/src/js/store/sync/index.js`, então importar pelo barrel devolve indefinido e toda asserção passaria em vazio. Um caso do teste afirma que o import funcionou de fato.
2. Duas tabelas congeladas cobrindo o enum inteiro, sem interseção, cada entrada com o motivo escrito. O Set tem hoje dez membros.
3. `MAP` entra como marcador de lacuna conhecida, não como entrada comum com motivo que diz "contestado". Pela leitura, o inbound dele grava o documento inteiro, que é a mesma forma que custou o briefing. Registrar comportamento observado como esperado é uma recorrência de cinco eventos do `docs/livro-razao.md`; o idioma da casa é o marcador que **quebra** quando alguém fechar o buraco.
4. Casos: piso e sanidade do import; cobertura do universo, com a mensagem dizendo que não existe ramo padrão aqui; paridade nos dois sentidos, separando "só no código" de "só no teste"; e anti-tapete, no molde de `frontend/tests/unit/despachante-sem-escrita-crua.test.js`, com motivo mínimo e sem entrada apontando para chave inexistente.
5. Escrever no cabeçalho o que o verde **não** prova: que a decisão esteja certa. O teste converte omissão silenciosa em afirmação escrita, e não adjudica a afirmação.
6. Contingência a confirmar na primeira execução: este arquivo importa o handler, que puxa repositórios e o namespace de atlas. O setup de IndexedDB falso roda para todo arquivo (`frontend/vitest.config.js`) e `frontend/tests/integration/sync-engine.test.js` já carrega o módulo real, o que prova que o grafo resolve sob vitest. Ainda assim é pressuposto, não fato medido.

**Controle negativo.** Quatro. (1) Remover o briefing do Set. (2) Acrescentar um valor ao enum sem tocar nas tabelas. (3) Trocar o import para o barrel, que fica vermelho porque indefinido não é Set. (4) Acrescentar `MAP` ao Set, que deixa vermelho o marcador de lacuna: fechar o buraco obriga a revisar a decisão.

**Arquivos.** Um teste novo; `docs/wiki/tipos-entidade-sync.md`; `docs/livro-razao.md`. Zero de produção.

---

### Item 5. Fixtures que mentem: 18 tipos num sweep que se anuncia como "todos"

**Nasce vermelho. Falso verde ativo.**

**O defeito.** `frontend/tests/helpers/real-fixtures.js` e `backend/tests/helpers/real-fixtures.js` declaram no comentário os "18 tipos válidos" e omitem o setor e a declinação magnética, enquanto a constraint, o Joi, o cliente e o mapa de coleções aceitam 20. `backend/tests/integration/features-real-shape.test.js` tranca esse número num `assert.equal`. E `frontend/tests/e2e-ui/browser-collab-all-types.spec.js` se anuncia como cada tipo pela cadeia inteira de sync, e pula dois. É a cópia mais perigosa do repositório, porque veste roupa de verificação.

Vem antes do item 6 porque corrigi-la **pode expor uma lacuna real de sync** nesses dois tipos, e essa descoberta muda o que o item 6 precisa guardar.

**Passos.**

1. Commit A, com as duas mudanças juntas obrigatoriamente: acrescentar os dois tipos aos dois fixtures, corrigir o comentário de cabeçalho, e trocar no mesmo commit o `assert.equal` literal por piso derivado do tamanho da fonte. Separados, o vermelho esperado seria lido como regressão.
2. Conferir que os dois fixtures ficaram iguais entre si, item a item, e transcrever a comparação. São cópias gêmeas em pacotes diferentes e a divergência entre elas seria o mesmo defeito com outra roupa.
3. Renomear o caso que hoje carrega a contagem no nome. Nome de teste com número cravado é a mesma armadilha do assert literal.
4. Rodar `npm run test:backend` e conferir verde.
5. Commit B, separado: rodar a spec de Playwright com os 20 tipos. **Atenção declarada**: uma reprovação no setor ou na declinação pode ser lacuna real de sync, não defeito do teste. Investigue e relate **antes** de tocar no spec.
6. Registrar a linha em `docs/livro-razao.md` nomeando a classe: fixture que afirma completude sobre um subconjunto.

**Controle negativo.** Dois, independentes. (1) Reverter só o assert mantendo os fixtures com 20 prova que a asserção lê o tamanho da fonte. (2) Reverter só a fixture mantendo o piso prova que o piso não é decorativo. Se qualquer um passar verde, a correção não está ligada em nada. Este item nasce vermelho por construção, e essa é a diferença dele para os guardas.

**Arquivos.** Os dois `real-fixtures.js`; `backend/tests/integration/features-real-shape.test.js`; `docs/livro-razao.md`. Quatro arquivos em dois commits. **Cruza a fronteira dos pacotes.** O commit A exige PostgreSQL; o commit B exige Playwright com backend real, que fica fora do `npm test`.

---

### Item 6. Paridade das quatro cópias que cruzam os pacotes, mais a constraint viva do banco

**Nasce verde. Guarda de fronteira.**

**A classe.** As quatro estão alinhadas em 20 hoje, então não há dano ativo, só exposição a skew de deploy. Mas as quatro formas de dano são distintas e todas mudas, e a pior não tem guarda nenhum: tipo ausente de `typeToCollection` faz a linha ser **gravada e nunca aparecer em snapshot**, invisível para todo cliente, sem erro em lugar algum. O único guarda existente, `backend/tests/unit/snapshot-tipos-vs-check.test.js`, amarra duas das quatro.

**Passos.**

1. Antes de escrever fixture, ler `frontend/src/js/import_export/local-atlas-to-server.js` e o teste que já existe em `frontend/tests/unit/local-atlas-to-server.test.js`, que já constrói entrada válida e já lê `droppedFeatures`.
2. Criar o teste de paridade em `frontend/tests/unit/` (arquivo novo). Ler os arquivos do backend com `new URL` mais `import.meta.url`, exatamente a forma de `frontend/tests/unit/client-id-por-aba.test.js`, e não caminho com barra crua: o ambiente é Windows.
3. Leitor da constraint: varrer **todas** as migrações de `backend/src/database/migrations/`, achar toda ocorrência de `valid_feature_type` e deixar a última declaração vencer, porque o idioma da casa para alargar constraint é DROP mais ADD num arquivo posterior.
4. Leitor do Joi: âncora textual em `VALID_FEATURE_TYPES`. **Não** usar a descrição do schema: o caminho aninhado vira indefinido em silêncio numa reorganização.
5. Do `backend/src/modules/sync/sync.service.js`, extrair **dois** conjuntos: as chaves de `typeToCollection` e as chaves do esqueleto de `transformFeaturesToFrontend`.
6. **Duas asserções separadas**, e esta foi a correção de um defeito que bloqueava o plano: (i) paridade de tipos entre as quatro fontes reais; (ii) à parte, todo valor de `typeToCollection` é chave do esqueleto. Unir as cinco numa só reprovaria em 16 dos 20 por erro de categoria, porque o esqueleto fala nomes de coleção e as outras falam nomes de tipo.
7. Leitura comportamental do cliente, em duas passadas, mais forte que ler o texto da lista e possível só na suíte do frontend, onde o alias resolve.
8. Piso anti-vacuidade **separado e antes** da paridade: as cinco extrações foram encontradas e cada uma devolve pelo menos 20. Mais uma asserção absoluta.
9. Paridade exata, sem allowlist: as quatro respondem à mesma pergunta e têm hoje os mesmos 20. Allowlist vazia no dia um seria cobertura vazia com cara de rigor.
10. Criar o guarda vivo em `backend/tests/integration/` (arquivo novo), modelado em `backend/tests/integration/permission-levels-invariant.test.js`: consultar a constraint real com `pg_get_constraintdef`, exigir exatamente uma sobre o tipo, com âncora de comprimento antes de comparar. É a única autoridade sobre deploy que texto não pode ser.
11. Acrescentar duas ou três linhas ao cabeçalho de `backend/tests/unit/snapshot-tipos-vs-check.test.js` dizendo que ele cobre duas das quatro cópias e onde vive a paridade das quatro.
12. Corrigir `docs/wiki/atlas-import-offline.md`, que hoje conta três cópias e omite a quarta, e acrescentar a frase de ordem de deploy em `docs/wiki/deploy-backend.md` como bullet, não como passo próprio. A topologia (troca de symlink, imagem que não roda migração, compose fora do repositório) não permite guarda mecânico; prometer um seria prometer o que o repositório não pode entregar.

**Controle negativo.** Quatro, um por fonte, mais um do piso. Rode **primeiro** o de remover um tipo de `typeToCollection`, porque ele também deixa vermelho o guarda que já existe: mede-se o guarda antigo antes de construir por cima dele. Renomear a constante do Joi deve deixar vermelho o **piso**, não a paridade. Ao relatar, declare em qual das duas camadas cada vermelho apareceu.

**Pronto quando.** Além dos verdes: o guarda vivo foi **executado** com PostgreSQL no ar e a contagem relatada, não pulado, porque skip é verde sem verificação e esta peça tem uma perna inteira que some sem banco.

**Arquivos.** Dois testes novos; `backend/tests/unit/snapshot-tipos-vs-check.test.js` (só cabeçalho); `docs/wiki/atlas-import-offline.md`; `docs/wiki/deploy-backend.md`; `docs/livro-razao.md`. **Cruza a fronteira nas duas direções**: um teste do frontend lê fonte do backend, o que faz mudança backend-only reprovar na perna do frontend, e isso precisa estar escrito no cabeçalho do arquivo.

---

### Item 7. Compactação da fila: tipos cujo `entityId` não identifica uma entidade única

**Nasce verde. Dano latente.**

**A classe.** A compactação agrupa por escopo, tipo e id, e `_compactEntityOps` (`frontend/src/js/store/sync/operation-queue.js`) mantém só a última operação do grupo. `logAtlasSetting` (`frontend/src/js/store/sync/operation-dispatcher.js`) usa o id do atlas, ou a sentinela, como `entityId` para **todas** as preferências, e o payload é um **patch parcial**. Os quatro patches caem no mesmo grupo e três somem sem erro. Chamadores reais conferidos: ícones customizados (`frontend/src/js/store/customIcons.operations.js`), ordem dos mapas e cores de badge (`frontend/src/js/store/map.operations.js`) e uso de cor (`frontend/src/js/store/repositories/index.js`).

O dano é latente porque a compactação só dispara acima de `MAX_QUEUE_SIZE`, alcançável numa rajada offline mas não no uso normal. Entra mesmo assim porque a instância viva já existe e nunca foi escrita em lugar nenhum.

**Passos.**

1. Criar o teste em `frontend/tests/unit/` (arquivo novo). Metade comportamental, sem IndexedDB: usar o singleton já exportado, ou instanciar a classe, cujo construtor é inerte.
2. Três updates do mesmo grupo colapsam para o último, com piso para não rodar sobre lista vazia.
3. A chave de grupo real inclui o `scopeSuffix`, que entrou com o namespace por atlas em 2026-08-15. Toda mensagem e todo motivo devem citar a chave completa, dizendo que o escopo isola atlas mas não isola os quatro patches dentro do mesmo atlas.
4. **Releia o arquivo antes de escrever.** Cinco citações de linha do plano original estavam desatualizadas. Nenhum motivo congelado cita número de linha.
5. Metade estrutural: derivar da fonte do dispatcher quais tipos têm id não único, por leitura e regex sobre as duas fábricas.
6. Tabela congelada, uma entrada por tipo derivado, com o shape do id e a afirmação de perda.
7. A entrada da configuração de atlas lista os quatro patches **observados nos chamadores**, não os do JSDoc: um deles aparece só na documentação e não tem chamador.
8. Asserções: piso primeiro, para que "a extração quebrou" nunca seja lido como "as listas divergiram"; conjunto derivado igual às chaves da tabela; anti-tapete.
9. Mensagem que ensina a saída certa: só é sem perda se o payload for o valor inteiro daquele tipo para aquele id. Se for patch parcial, a saída **não** é uma entrada na tabela, é dar ao tipo um id próprio ou ensinar a compactação a fundir o payload.
10. Cabeçalho com as fragilidades: a regex das fábricas cai a zero se os loggers virarem um mapa gerado, e testar método privado é deliberado, por ser a única forma de exercitar o mecanismo sem IndexedDB.

**Controle negativo.** Três. (1) Trocar o retorno final da compactação. (2) Acrescentar um logger novo sem tocar na tabela. (3) Remover um logger sem tirar a entrada, que reprova por entrada morta.

**Arquivos.** Um teste novo; `docs/livro-razao.md`. Zero de produção.

---

### Item 8. Registro único de tipo de feição, só o núcleo

**Nasce verde. Sem instância viva.**

**Por que por último.** É o único item que não corrige bug nenhum: ele só impede que a próxima ferramenta tenha onde se esconder. O escopo foi cortado de catorze passos para quatro mais a decisão registrada. Os passos de migração não impedem classe nenhuma que o guarda de cobertura já não impeça, e custariam três mudanças de saída observável (rótulo de fronteira, legenda do PDF, saída do KMZ), um teste de equivalência que enquanto vive reprova correção legítima por comparar com o passado, e uma allowlist usada como barra de progresso, que é um estado indistinguível de allowlist esquecida.

**Passos.**

1. **Escrever a decisão primeiro**, antes do código. O item aciona dois dos três gatilhos registrados em `docs/decisions/DECISIONS.md` (cria padrão obrigatório, é caro de reverter) e a proposta original não registrava nada. Entrada em `docs/decisions/decisions-2026.md` no formato da casa, mais a linha no índice. As alternativas rejeitadas precisam constar, porque é o que não se deduz do código: lista plana de vinte strings (regressão, as duas saídas de processamento passariam a aparecer na aba, na legenda e na seleção), pasta própria com barrel (o barrel é justamente o perigo, porque o barrel de store puxa a store inteira) e derivar do backend em tempo de build (a fronteira se guarda por teste de paridade, que é o item 6).
2. Criar o registro em `frontend/src/js/store/`, ao lado de `store.constants.js`, com **zero imports**. É essa propriedade que torna `store.constants.js` e `frontend/src/js/store/repository.utils.js` carregáveis em node puro sem resolução de alias, e ela deve ser asserida por teste, não confiada à leitura. Fora dos dois barrels.
3. Escrever as vinte linhas com campos de identidade, apresentação e capacidade. Os campos de capacidade existem porque a matriz mostrou ausências **deliberadas**, e não só esquecimento: `SELECTION_BOX_TYPES` (`frontend/src/js/utilities/feature_navigation_utils.js`) e `IMAGE_RESOURCE_FEATURE_TYPES` (`frontend/src/js/store/store.constants.js`) divergem em dois tipos, então são campos separados e não um só.
4. Guarda de cobertura **derivado do versionamento**, não de alvos enumerados à mão. Enumerar à mão é a classe mais recorrente de `docs/livro-razao.md`, "conferir um subconjunto e tratar como o conjunto", com sete eventos, e a abordagem que o próprio livro declara ter adotado é derivar todo inventário do versionamento. Concretamente: coletar os arquivos versionados de `frontend/src/js/`, procurar em cada um qualquer bloco com cinco ou mais literais do conjunto de tipos, e exigir que todo arquivo assim encontrado esteja derivando do registro **ou** declarado com motivo escrito. Se a varredura se provar ruidosa, o mínimo aceitável é manter alvos conhecidos **mais** um segundo caso que falhe quando existir arquivo fora da lista com cinco ou mais literais, e o cabeçalho tem de dizer, na primeira linha, que verde não significa cobertura das demais.
5. Derivar as seis constantes de `frontend/src/js/store/store.constants.js`, sem mudar nenhum consumidor, porque os símbolos exportados mantêm nome e forma.

**Controle negativo.** Quatro, e o principal é o **positivo**: acrescentar ao registro uma linha falsa completa e não tocar em nenhuma lista periférica. O guarda de cobertura tem que ficar vermelho nomeando **todas** as listas de uma vez; se ficar vermelho em uma só, ele não varre o que promete. Hoje, sem esse guarda, essa mesma mudança passa verde no `npm test` inteiro. Os outros três: apagar uma linha do registro; acrescentar o registro a um dos barrels, que deve reprovar; esvaziar um motivo da allowlist.

**Arquivos.** `docs/decisions/decisions-2026.md`; `docs/decisions/DECISIONS.md` (linha de índice); um arquivo de registro novo em `frontend/src/js/store/`; três testes novos; `frontend/src/js/store/store.constants.js`; `.claude/rules/architecture.md`; a skill `new-tool`; `docs/livro-razao.md`. Dez arquivos, não cruza a fronteira.

---

## 6. O que foi descartado, e por quê

Quinze propostas saíram. As seis que mais custariam se tivessem entrado:

| Proposta | Motivo do corte |
|---|---|
| Derivar `FEATURE_LAYER_IDS` do registro | Risco máximo com cobertura marginal quase nula. São **42 ids**, não 41 como a proposta afirmava, então um teste que congelasse a contagem nasceria vermelho por aritmética. Os ids são consumidos por três subsistemas independentes e cada omissão produz três falhas **visuais** distintas, que a suíte node não captura. O guarda de cobertura do item 8 já reprova a omissão de tipo, que era o benefício real. |
| Migrar as dez listas periféricas | Migração não impede classe nenhuma que o guarda já não impeça, e custa três mudanças de saída observável. Substituição: cada lista migra no commit do **bug que ela causa**, com repro próprio, justificada pelo repro e nunca pela unificação. Duas já têm bug conhecido: a ausência da declinação em `_collectFeatureStats` (`frontend/src/js/import_export/pdf-export.tab.js`), onde duas omissões se cancelam e a feição nunca aparece na legenda, e `frontend/tests/unit/kmz-feature-types.repro.test.js`, que hoje é cobertura vazia por construção porque assere só que o resultado pertence ao enum, e o valor de fallback é membro do enum. |
| Converter as chamadas de `frontend/src/js/layers/layer_setup.js` num laço | A **ordem** daquelas chamadas é o z-order dos layers, e o sintoma de perdê-la é visual. Trocar ordem semântica por iteração sobre objeto é assumir risco que nenhum teste deste repositório observa. |
| Incluir `SUPPORTED_GEOMETRY_TYPES` (`frontend/src/js/processing/processing.constants.js`) no guarda | Alvo errado duas vezes: é lista de tipos, não de chaves de armazenamento, e as ausências ali são semânticas (o que o turf sabe processar), não esquecimento. Cobrá-las só encheria a allowlist. |
| Incluir `SNAPPABLE_LAYER_IDS` (`frontend/src/js/snapping/snapping.constants.js`) | É a mesma classe, mas o próprio comentário do símbolo a declara subset **deliberado**, porque só vértice e aresta de forma geométrica são alvo útil de snap. Sem defeito observado, cobrá-la produziria dez entradas permanentes de allowlist. Fica em riscos residuais. |
| Esconder a seção temporal da declinação para "resolver" o item 1 | A decisão de produto já está tomada e implementada: validade temporal para todo tipo, trajetória só para três. Esconder trocaria um bug de sincronia por uma regressão de funcionalidade. |

Também descartados: unificar os três registries de `frontend/src/js/map_sig.js` (é a peça que de fato zeraria o custo, e não cabe aqui), derivar a letra de atalho, e levar `droppedFeatures` ao aviso de conclusão do import, que é o único gancho mecânico honesto para a perda muda por skew de deploy mas exige verificação por imagem e é item próprio.

---

## 7. O que a próxima ferramenta ainda vai pagar

Com os oito itens executados. Isto não é lista de tarefas, é o preço que fica.

1. **O vocabulário continua quádruplo** e este plano unifica dois lados. Além do tipo e da chave de armazenamento, existem o id da ferramenta e o nome da classe do control, e `frontend/src/js/map_sig.js` mantém **três registries** com três chaves para a mesma ferramenta. Uma ferramenta nova continua exigindo três edições ali, e registrar o control sozinho continua não fazendo o botão da toolbar funcionar. O custo cai; não vai a zero.
2. **A letra de atalho continua declarada em três lugares** sem guarda de concordância nem de colisão. Uma ferramenta pode estrear com atalho que já pertence a outra, ou aparecer na modal de ajuda com uma letra e responder a outra.
3. **O z-order continua sendo a ordem das chamadas** em `frontend/src/js/layers/layer_setup.js`, ordenada à mão e invisível para a suíte node.
4. **No backend, um tipo novo continua exigindo quatro edições manuais**: o Joi, uma migração com DROP e ADD da constraint, o `typeToCollection` e o esqueleto do snapshot. O item 6 apenas **detecta** a divergência depois que ela existe. Ele nunca a previne, e nada deriva uma lista da outra através da fronteira, nem poderia: são pacotes separados e nada cruza em tempo de build.
5. **A ordem de implantação permanece inverificável** por qualquer teste daqui. Depois deste plano ela é doutrina escrita em duas páginas de wiki, e um cliente publicado antes do banco continua descartando feição em silêncio.
6. **`droppedFeatures` continua sem consumidor de interface.** Uma feição de tipo que o cliente não conhece some antes da rede e o usuário vê um import bem-sucedido.
7. **`SNAPPABLE_LAYER_IDS` segue como cópia manual.** Ferramenta geométrica nova não ganha snap automaticamente e nada avisa.
8. **Três decisões de produto ficam pendentes e sem dono**, cada uma com efeito em produção: (a) remover `ATLAS` do enum ou lhe dar emissor; (b) decidir se `MAP` entra em `CONVERGENCE_GUARDED`, sendo candidato ao mesmo defeito que custou o briefing; (c) resolver o patch parcial na compactação, cuja saída certa **não** é alargar a chave de grupo, porque isso mudaria a semântica do flush inteiro (mais grupos significa menos compactação e fila maior), mas dar ao tipo um id próprio ou ensinar a compactação a fundir o payload. Os itens 3, 4 e 7 transformam as três em afirmações escritas que quebram ao serem fechadas. Nenhum as decide.
9. **A metade do enum que vive no servidor continua sem guarda.** Os itens 3 e 4 vigiam o roteador do cliente; o modo de falha do lado do servidor depende de dois mapas em `backend/src/modules/sync/sync.service.js` que nenhum dos oito itens amarra ao enum. Um tipo novo pode estrear no cliente e ser recusado pelo servidor sem nenhum teste vermelho.
10. **O degrau de permissão por tipo de entidade não foi modelado.** A tabela do item 4 seria o lugar barato para carregar também esse campo; ficou de fora para não inventar campo sem consumidor, e continua sendo disciplina.
11. **O item 1 fecha o gate de permissão só no caminho do Reagendar.** Depois dele existe proteção indireta, não um gate próprio do módulo temporal. Qualquer outro caminho que venha a escrever na fonte viva nasce sem gate pelo mesmo motivo que este nasceu.

---

## 8. Como este documento foi produzido, e o que ele não prova

Vinte e oito agentes em dois lotes: seis exploradores do GeoLibre e sete dos pontos marcados pelo dono, mais uma síntese e uma crítica adversarial; depois seis de levantamento no EBGeo, quatro de desenho, duas críticas e uma consolidação. Mais de 1400 leituras de arquivo. As duas críticas reabriram os arquivos citados e derrubaram três defeitos que bloqueavam, resolvidos por reescrita e não por anexo: uma asserção tautológica que comparava o valor derivado consigo mesmo, uma asserção de paridade que reprovaria em 16 dos 20 por erro de categoria, e o guarda de cobertura enumerado à mão.

Antes desta publicação, quatro fatos que sustentam os itens 1, 2 e 7 foram reconferidos por leitura direta: a contagem de 42 ids em `FEATURE_LAYER_IDS`, a chave de grupo com `scopeSuffix`, a comparação entre singular e plural em `rederiveAutoDtg`, e os dois retornos ignorados em `shiftFeatureTimes`. Todos os caminhos e símbolos entre crases foram verificados contra `c27cc930`.

**O que este documento não prova:**

- **Nada foi observado, só lido.** Nenhum dos dois repositórios foi executado durante a produção deste plano. As afirmações de comportamento são deduções de leitura de código, e a constituição trata comportamento observado como voz separada. Os itens 1, 2 e 5 nascem vermelhos justamente para converter dedução em medição, e é isso que valida (ou refuta) o diagnóstico.
- **Se um repro nascer verde, o item muda, não o teste.** Repro que nunca ficou vermelho é verificação fantasma com nome de guarda.
- **Nenhum número de teste foi executado.** As contagens de arquivos e ocorrências são estáticas.
- **A licença do GeoLibre é MIT** (copyright 2026 Qiusheng Wu), lida no arquivo. Portar trecho de código é permitido, com o aviso de copyright e da licença preservados no destino. Nenhum item deste plano porta código de lá; o que veio de lá foi método.
- **`docs/decisions/DECISIONS.md` e `docs/decisions/decisions-2026.md` foram lidos inteiros** durante a crítica: nenhum item contradiz decisão registrada e nenhum refaz alternativa já rejeitada. O único desvio de doutrina encontrado foi no sentido inverso, e virou o passo 1 do item 8.

