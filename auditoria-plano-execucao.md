# Plano de execução da auditoria

Ordem de ataque dos 418 itens pendentes dos três relatórios, e o registro do que
foi feito enquanto o usuário dormia (sessão de 2026-07-24).

Estado e handoff anterior: [`auditoria-continuacao.md`](auditoria-continuacao.md).
Os achados vivem em [`bugs-backend.md`](bugs-backend.md),
[`documentacao-backend.md`](documentacao-backend.md) e
[`testes-backend.md`](testes-backend.md).

## Inventário medido

Contagem mecânica (bloco `### N.` que contém marcador `CORRIGIDO` no corpo, não só
no título), não estimada:

| Relatório | Total | Feitos | Pendentes |
|---|---|---|---|
| `bugs-backend.md` | 116 | 38 | **78** — 0 crítico, 12 alto, 25 médio, 41 baixo |
| `documentacao-backend.md` | 155 | 0 | **155** — 45 alta, 77 média, 33 baixa |
| `testes-backend.md` | 185 | 0 | **185** — 71 P1, 83 P2, 31 P3 |

> A `auditoria-continuacao.md` fala em "50 médios e 27 baixos". A diferença é de
> critério: aquele número agrupa por tema e atravessa severidades (o grupo dele
> inclui achados que o arquivo marca como Alto). A contagem acima é mecânica e
> reproduzível pelo script; é a que este plano usa.
>
> **Correção 2026-07-24.** A primeira versão desta tabela dizia "122 alta, 33 baixa"
> para a documentação. Era erro do meu script de contagem: a seção do meio chama-se
> `## Severidade média`, e a regex usava `\w+`, que não casa o acento — os 77 itens
> de média eram atribuídos em silêncio à seção anterior. O verificador quebrou e
> quebrou calado, que é exatamente a quarta forma de `verificacao-fantasma` escrita
> na constituição horas antes. Pego ao cruzar com uma segunda contagem que discordou.

## Ordem escolhida, e por quê

Não é a ordem do relatório. O critério é **risco corrigido por hora de trabalho**,
com os multiplicadores primeiro — item que torna os seguintes verificáveis vale
mais que um item isolado de severidade maior.

1. **Inversão da regex do `docs-integridade.test.js`.** Sozinha converte 14 itens de
   documentação de "erro silencioso" para "falha de teste": os prefixos pré-monorepo
   `ebgeo_backend/` e `ebgeo_web/` escapam da alternação fechada da regex, então 53
   citações em 22 páginas nunca foram verificadas. Primeiro porque muda o regime de
   verificação de todo o eixo de documentação.
2. **Os 12 achados ALTO pendentes.** Maior severidade real ainda aberta.
3. **Os 25 MÉDIOS**, na ordem de grupo da `auditoria-continuacao.md` (defeitos do
   mesmo grupo se reforçam e compartilham teste).
4. **Documentação: alta (45), depois média (77).** Volume grande, risco baixo,
   altamente paralelizável — é onde os agentes rendem.
5. **Testes (185).** Acrescentam cobertura em vez de corrigir defeito; valem depois
   que os defeitos pararam de se mover.
6. **Os 41 BAIXOS.** Por último por decisão registrada do usuário ("avaliarmos
   juntos"); vários são "teste que não prende sobre código correto".

## O que NÃO faço sozinho

Três achados dependem de decisão de produto e ficam parados até o usuário decidir
(registrado em `auditoria-continuacao.md` §"Decisões que dependem de você"):

- **nº 34** — `POST /auth/register` é oráculo de existência de e-mail; fechar muda a
  UX do cadastro.
- **nº 54** — PUT parcial de override do sv360 zera os não enviados; precisa definir
  replace-total vs patch-parcial.
- **nº 33** — autodeclaração de OM, buraco já aceito por decisão explícita.

## Protocolo por achado (o que deu resultado antes)

1. Ler o mecanismo no relatório **e confirmar no código** — vários achados descrevem
   o mecanismo certo e a consequência errada.
2. Escrever o teste e **vê-lo falhar**.
3. Corrigir.
4. **Controle negativo:** reverter o fix e confirmar que o teste cai.
5. Suíte cheia, sozinha.
6. Anotar no bloco do achado; lição durável vai para o `livro-razao.md`.

## Regra de paralelismo

Agentes trabalham em **investigação e em módulos disjuntos**, e **nunca rodam a
suíte do backend**. O runner cria e dropa o mesmo `ebgeo_test`: duas execuções
concorrentes se corrompem, e isso já produziu dois diagnósticos falsos registrados
no `livro-razao.md` (2026-07-19). A verificação é serializada por mim.

## Registro de execução

<!-- append-only; um bloco por lote concluído -->

### Lote 1 — inversão da regex do `docs-integridade` (item 1 do plano)

**Feito.** 9 itens de `documentacao-backend.md` (#16, #43, #79, #107, #109, #111,
#112, #116, #119). O relatório previa 14; a diferença é que alguns itens descrevem
o problema sem citar o prefixo, então a contagem mecânica é 9.

O que mudou de regime: o prefixo deixou de ser lista fechada e virou asserção. A
regex coleta qualquer token com cara de caminho e extensão conhecida, e a existência
do arquivo é que decide — resolvendo contra as raízes reais dos pacotes e contra o
diretório do próprio documento. Prefixo desconhecido passa a falhar em vez de
escapar. É a segunda vez que este mesmo arquivo silencia por lista fechada (a
primeira foi o sufixo `:linha`, no livro-razão), e a lição registrada era mudar a
abordagem em vez de re-anotar.

Números medidos: 131 quebrados na primeira coleta ampla → 45 depois de resolver as
raízes legítimas → 0. Foram 55 citações com prefixo pré-monorepo reescritas com
verificação de existência do destino, 29 referências de diretório, 8 citações
relativas a módulo resolvidas **por contexto** (`sync/index.js` existe nos dois
pacotes) e 1 isenção honesta (`./aman/x.json` é string de exemplo em prosa sobre
path traversal, o único falso-positivo em 65 páginas).

Três ponteiros `MUST stay in lockstep` viviam em comentário de CÓDIGO, fora do
alcance de qualquer varredura de `.md`. O de `trace-stages.js` estava morto duas
vezes: prefixo legado mais um diretório `collab/trace/` que nunca existiu.

Controle negativo: com as citações legadas restauradas e a regex nova, 44 são
pegas; com a regex antiga, nenhuma.

### Lote 2 — documentação, 11 itens

Todos verificados contra o código antes de reescrever; nenhum aceito pela prosa do
relatório.

- **#4, #17, #18, #38** já tinham sido resolvidos mais cedo nesta mesma sessão (o
  gate de `canToggleLock`, o marcador do `config-dinamico` e o ponteiro do
  `trace-stages.js`). Anotados, não retrabalhados.
- **#21, #22, #23** — `backend/CLAUDE.md` afirmava que `maps` tem "apenas GET". A
  constituição mentia sobre o próprio repositório: existem três escritas REST, e
  elas são deliberadas. Reescrito como escrita **incremental** só via sync, com as
  três exceções nomeadas e o critério que as une (operação de entidade INTEIRA,
  cujo efeito não é representável como sequência de ops). A enumeração de módulos
  saiu inteira: estava errada em dois pontos e é a mesma classe da árvore que
  apodreceu em `.claude/rules/architecture.md`.
- **#20, #32, #39** — citações de linha erradas em `backend/src/config.js`. A pior
  era a âncora da allowlist HS256 apontando para `poolMax`, e o default de CORS
  documentado com valor e linha errados numa página de segurança de borda enquanto
  outra página já dizia o valor certo.
- **#30** — as duas páginas diziam que o boot acumula todos os erros numa mensagem
  só. Não acumula as duas mais importantes: `DATABASE_URL` e `JWT_SECRET` passam por
  `required()`, que lança na avaliação do módulo, antes de a validação rodar.

Uma armadilha que este lote produziu e que vale registrar: a reescrita mecânica de
prefixos **quebra prosa que fala SOBRE o caminho**. Três frases comparavam dois
caminhos e viraram "X difere de X". Detectadas por um verificador escrito para isso
(linha que cita o mesmo caminho duas vezes), com três falso-positivos legítimos
(mesmo arquivo, linhas diferentes). O caminho morto voltou ao texto **sem crase**,
porque agora toda citação entre crases é verificada.

### Lote 3 — documentação, 4 itens (e o terceiro vão do mesmo teste)

- **#36** — `sintese-contrato-erros-http.md` afirmava três coisas falsas sobre 503.
  São dois emissores, não um: além do `/health` inline, o push de sync lança
  `ServiceUnavailableError` quando o `lock_timeout` do advisory lock dispara. A
  distinção que importa ao cliente é que 503 do push é transitório e vale retry.
- **#41** — o README atribuía os seis campos de sync às feições; `addCreatedTimestamp`
  põe três. Os seis são de Atlas/Mapa/Grupo. Assimetria agora declarada.
- **#42** — o README dizia que a UI se verifica manualmente por lint e test,
  contradizendo a linha logo acima dele e a regra em `.claude/rules/testing.md`.
- **#44** — link para `backend/docs/implementado/`, diretório absorvido pela wiki.

O #44 rendeu mais que um link: era o **único** link markdown morto do corpus, e
escapava porque `RE_LINK` exige extensão conhecida, então link para DIRETÓRIO nunca
foi checado. É a **terceira** instância da mesma classe neste mesmo arquivo de teste
— prefixo, sufixo e agora diretório. O que a regra não casa, ela abençoa. Fechado
com `RE_LINK_DIR`, e com controle negativo de fiação (não só do detector): com o link
morto de volta, o teste acusa `README.md → backend/docs/implementado/ (diretório)`.

### Lote 4 — os últimos ALTO: #9, #18, #19, #29

**Todos os 24 achados ALTO e os 5 CRÍTICOS estão fechados.** Restam 25 médios e
41 baixos.

Três agentes em módulos disjuntos, com banco de teste próprio por agente
(`TEST_DB_NAME`), e a suíte cheia rodada por mim depois, com a árvore quieta:
**1487 testes, 0 falhas**.

O padrão que se repetiu e vale registrar: **em três dos quatro achados o relatório
descrevia o mecanismo certo e subestimava a correção.**

- **#9 (presença)** — a correção sugerida teria QUEBRADO o cliente em dois pontos:
  `Joi.string().uuid()` recusaria id de marcador 3D/360 (que não é UUID), e clampar
  `lng` a ±180 recusaria cursor legítimo, porque o MapLibre não clampa longitude ao
  cruzar o antimeridiano — e há teste pinando isso. Os limites adotados vieram de
  medição do que o cliente real emite, não de chute.
- **#18** — o `lock_timeout` da lição anterior estava em outro ponto do sync; a
  ingestão nunca herdou. Recorrência real, não duplicata.
- **#29** — eram SETE queries por mapa, não seis: o relatório não contou
  `GET_MAP_LAYERS`.

O #19 é o mais grave dos quatro: escrita cross-tenant, um upload de uma organização
escondendo foto de outra globalmente.

Dois detalhes de método que custaram execução vermelha e ficam registrados: as
opções do pg-promise vivem em `db.$config.options` e não em `pgp.options`; e
`map.features` no snapshot é objeto por tipo, não array.
