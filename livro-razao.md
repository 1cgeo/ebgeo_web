# Livro-razão de correções

Espelho das **correções**, não dos sucessos: uma linha por vez em que um desvio foi pego, seja por você, seja pela realidade (teste que quebrou, bug que voltou, produção que reprovou). Existe para que a retrospectiva e o agente **percebam padrão e recorrência** ao longo do tempo, não para virar placar.

É memória lida por raciocínio, **nunca métrica a maximizar**: no instante em que se otimiza este arquivo, a armadilha mecânica voltou. Registro de sucesso premiaria covardia (fazer menos para o número subir); registro de correção alimenta aprendizado. A correção é sinal de primeira classe, presente, não falta.

Doutrina: [`docs/doutrina.md`](docs/doutrina.md), princípios 1, 2, 5 e 6.

## Como usar

- **ESCREVER** (qualquer sessão, no momento da correção): uma linha por evento, append-only. Não é toda ida e volta, só o **desvio real**. O conserto curado vai para o learnings da skill, a regra ou o teste; aqui fica só o evento, para a recorrência ficar visível — que o learnings, curado e podado, descarta.
- **LER** (na retrospectiva): alguma classe recorreu? Recorrência na **mesma** skill significa que o learnings não pegou: mudar a abordagem, não só re-anotar. Recorrência **entre** skills é lacuna de doutrina ou de constituição: subir, não tratar caso a caso.
- **PODAR** (na retrospectiva): classe resolvida e sem reincidência vira uma linha de síntese e os eventos crus saem.

## O gate que evita o teatro

Uma entrada só vale se responder **onde a lição foi codificada**. Sem isso vira anedota acumulada, o modo de falha clássico do postmortem que ninguém lê. Em software o gancho tem forma preferencial:

1. **teste de regressão** (o mais forte: falha se a lição for esquecida),
2. regra na constituição ou em `.claude/rules/`,
3. learning da skill,
4. página de wiki ou decisão registrada.

Correção sem nenhum dos quatro é sinal de que ela não foi entendida ainda.

## Duas fontes (a da realidade é o ouro)

- `sessao` — o desvio foi pego no meio da tarefa. Rápido, mas é julgamento na hora.
- `realidade` — o mundo rendeu o veredito: teste quebrou, controle negativo mostrou que o teste não prendia nada, bug voltou, comportamento no ambiente contradisse o esperado. Verdade-terreno; é o dado externo que sustenta o laço (princípio 2).

## Vocabulário de classes (extensível)

`doc-sobre-codigo` (afirmou a partir da prosa que descreve o código, em vez do código real) · `eco-de-sessao` (repetiu conclusão de sessão anterior sem reconferir) · `verificacao-fantasma` (deu como verificado o que não foi; assumiu que um comando fez efeito sem conferir) · `teste-que-nao-prende` (teste passa com e sem o fix; faltou controle negativo) · `escopo` (fez mais ou menos que o pedido) · `premissa-inventada` (agiu sobre premissa que não foi dada nem confirmada) · `aprovacao-presumida` (tratou esclarecimento de escopo como autorização para ação específica) · `estado-como-fato` (gravou na memória durável algo que é estado efêmero) · `default-irreal` (default que só funciona por acidente do ambiente de dev) · `regressao-propria` (o fix introduziu o defeito seguinte)

## Sínteses (classes resolvidas)

Classes resolvidas e sem reincidência posterior, condensadas dos eventos crus. Toda classe com qualquer recorrência (ou 2+ eventos) permanece crua abaixo.

_(vazio)_

## Eventos

<!-- Formato: - AAAA-MM-DD `classe` [fonte] sintoma -> causa -> onde foi codificada -->

- 2026-07-18 `aprovacao-presumida` [sessao] Rodei `git merge origin/main` no `integracao_backend` depois de perguntar se devia. A resposta reafirmava o escopo, não aprovava o merge -> tratei esclarecimento de escopo como autorização, e a premissa de que o branch voltaria para a main era invenção minha -> desfeito com `git reset --hard`; regra "não presuma aprovação" na constituição.
- 2026-07-18 `doc-sobre-codigo` [realidade] O `99-pendencias-e-desvios.md`, que se anunciava como referência única para integradores, documentava a permissão por atlas como `owner/write/read`. O CHECK real tem cinco níveis -> a mesma lacuna produziu o bug do `handleSelection`, que descartava a seleção do co-Gestor -> teste `docs-integridade.test.js` + regra dos 5 níveis no CLAUDE.md dos dois pacotes.
- 2026-07-18 `verificacao-fantasma` [sessao] Medi o backend três vezes achando que media o código novo. O `pkill` do Git Bash não mata processo Node do Windows, e o processo velho seguia servindo -> assumi que o comando teve efeito em vez de conferir -> matar por PID via `Get-NetTCPConnection` + `Stop-Process`; conferir a porta antes de medir.
- 2026-07-18 `regressao-propria` [realidade] O advisory lock que adicionei no push de sync era tomado depois de abrir a transação, retendo conexão do pool sem timeout; com o dispatcher WS sem `await`, um cliente sozinho esgotava o pool -> revisão multi-agente pegou; a maioria dos achados confirmados eram regressões minhas da mesma sessão -> `lock_timeout` + serialização por socket + `ServiceUnavailableError`.
- 2026-07-18 `default-irreal` [realidade] `SEARCH_API_URL` apontava para um `:3001` inexistente e `SV360_SERVICE_URL` para `localhost:3000` (a porta do Vite). Ambos "funcionavam" por acidente do proxy de dev -> o config real de produção mostrou que toda URL é relativa -> defaults derivados/relativos + teste de contrato do `/api/config`.
- 2026-07-18 `teste-que-nao-prende` [realidade] Meu teste do P1 usava `/auth/me`, rota que relê o usuário por conta própria e retornaria 401 mesmo sem o fix do middleware -> o controle negativo revelou; sem ele o teste teria entrado verde e inútil -> troquei para `/atlas`; controle negativo virou passo obrigatório.
- 2026-07-18 `regressao-propria` [sessao] Fatiei a semeadura da wiki por tema e seis fatias escreveram o mesmo conceito com slugs diferentes; a dedupe por slug não via duplicata semântica -> eu tinha escrito o aviso "procure parecida e funda antes de criar" no `wiki-schema.md` horas antes de cair nele -> detector de duplicata por Jaccard >= 0.45 no `lint_wiki.py` (prosa não pegou; o detector pega).
- 2026-07-18 `doc-sobre-codigo` [realidade] A primeira auditoria da wiki acusou 125 erros, mas 117 eram contradições contra guias que eu mesmo tinha acabado de apagar -> marquei contradição contra a prosa em vez de contra o código, e o alvo deixou de existir -> viraram nota histórica; só contradição sobre código vivo é erro que acorda o gate.
- 2026-07-18 `verificacao-fantasma` [realidade] Commitei o teste de integridade rodando `npm run lint` na MESMA linha de comando do commit: a saída do lint apareceu depois do commit já ter passado, com 2 erros reais -> verificação que chega depois da ação não é verificação -> lint e teste em comando separado, antes do `git commit`.
- 2026-07-18 `teste-que-nao-prende` [realidade] A reescrita da wiki encurtou 1.054 citações para o basename (`sync.service.js:755`). O teste de integridade só casa caminhos com prefixo conhecido, então passava **vazio** nessas páginas: verde sem verificar nada -> reancorei no caminho real; o aviso "não cita nenhum arquivo de código" do `lint_wiki.py` é o detector dessa cobertura vazia (34 -> 14).
- 2026-07-18 `verificacao-fantasma` [realidade] Ao apagar o docs/deploy.md (removido) conferi as referências com `grep` em `CLAUDE.md` e `README.md` da raiz e dei por completo; sobraram 4 links em `backend/CLAUDE.md` e `backend/README.md` -> conferi um subconjunto e tratei como o conjunto -> o `docs-integridade.test.js` pegou as 8; a lição é não conferir referência à mão quando existe teste que varre tudo.
- 2026-07-18 `verificacao-fantasma` [realidade] Os DOIS hooks do `.claude/settings.json` estavam mortos desde sempre: liam `$TOOL_INPUT_FILE_PATH`, variável que o Claude Code não define (a entrada vem por JSON no stdin), e o de bloqueio ainda usava `exit 1`, que não bloqueia (precisa de 2 ou de `permissionDecision: deny`). Dois defeitos independentes, cada um bastando sozinho. A constituição prometia proteção de `deploy/` e lint a cada escrita; nenhum dos dois acontecia -> nunca provei o guard, só li a config -> reescritos em `.claude/hooks/*.js` e **provados por sonda** (escrever em `deploy/` e ver recusar); regra "se mexer no hook, sonde" em `.claude/rules/testing.md`.
- 2026-07-18 `regressao-propria` [realidade] Minutos depois de ler o achado de que `prepare-deploy.js` estava morto por usar `require` sob `"type": "module"`, escrevi `require` no meu próprio hook e o matei do mesmo jeito -> ler o defeito não imuniza contra cometê-lo; só a execução prende -> a sonda pegou na hora, e o hook agora distingue "lint limpo" de "lint não rodou", que era o silêncio que escondia o defeito.
- 2026-07-18 `teste-que-nao-prende` [realidade] O teste de conflito CRDT esperava até "A e B mostrarem a mesma cor" e só então cobrava que o Postgres batesse. Concordância entre clientes **não é** convergência: existe janela em que a op de A já chegou aos dois enquanto a de B ainda está em voo, e o poll saía nessa parada de caminho -> o predicado aceitava estado transitório como estado final, então o teste não conseguia distinguir "lento" de "divergência permanente", que seria bug de produto -> inverti a ordem (servidor decide o vencedor, clientes respondem a ele) e ancorei em `push.ack`; 15/15 com `--repeat-each=3`, e a mesma correção valeu para o teste de geometria, que tinha o predicado idêntico.
- 2026-07-18 `eco-de-sessao` [realidade] Agi sobre uma nota de memória que mandava "migrar de `pollPeerFeature` para os deterministic-waits do SyncLedger" para matar um flake. Ao ler o código: `pollPeerFeature` **já** chama `waitForRemoteEntity` por dentro, e o spec do flake nem usava `pollPeerFeature` (já estava migrado) -> a nota descrevia um mundo anterior e eu ia "consertar" o que já estava feito, sem tocar na causa -> memória corrigida com o mecanismo real; a regra que vale é a mesma de sempre, memória orienta onde olhar, o código decide o que é verdade.
- 2026-07-18 `teste-que-nao-prende` [realidade] A regex do `docs-integridade` exigia a crase logo após a extensão, então **toda** citação no formato `arquivo:linha` escapava da checagem: 1116 não verificadas contra 210 verificadas, e `arquivo:linha` é justamente o formato que o `wiki-schema.md` manda usar. O teste passava verde medindo a minoria, e eu só descobri porque a reescrita do movimento para `frontend/` usou a mesma regex e deixou 1116 citações para trás -> cobertura vazia mede o que a regra casa, não o que a regra deveria casar -> sufixo `:linha` opcional na regex; as 1116 entraram na checagem e passaram.
- 2026-07-18 `regressao-propria` [realidade] Ao mover o pacote web para `frontend/`, o `RAIZ` do `docs-integridade` (calculado como `../..` a partir do teste) passou a apontar para `frontend/` em vez da raiz do monorepo, e a lista de documentos vigiados **zerou** -> o primeiro teste a falhar foi o guarda "lista os documentos vigiados (contra a lista esvaziar em silêncio)", escrito exatamente para esse caso -> guarda de lista não-vazia é barato e pega a classe inteira de "o coletor parou de coletar"; replicar onde houver varredura.
- 2026-07-18 `doc-sobre-codigo` [realidade] O `.claude/rules/architecture.md` listava quatro papéis de sessão (`owner/admin/editor/viewer`) onde o código tem seis, omitindo `manager` e `commenter` -> é exatamente a lista fechada que a constituição proíbe em dois lugares por já ter causado bug real duas vezes, cometida pelo arquivo que deveria codificar a lição -> corrigido com citação de `session-context.js:29-36`; a árvore de 92 linhas que apodreceu junto (faltavam `admin/` e `session/` inteiros) foi substituída pelo que um `ls` não conta.
