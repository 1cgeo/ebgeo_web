---
paths:
  - "frontend/tests/unit/**"
  - "frontend/tests/integration/**"
  - "frontend/tests/store/**"
  - "frontend/vitest.config.js"
  - "frontend/eslint-rules/**"
  - "frontend/eslint.config.js"
  - "frontend/stylelint.config.js"
  - ".claude/hooks/**"
  - ".claude/settings.json"
---

# Testes do frontend (vitest), lint e o hook

- **"Test timed out in 5000ms" NUM ARQUIVO QUE NINGUÉM TOCOU, E QUE PASSA SOZINHO, QUASE NUNCA É O
CÓDIGO SOB TESTE: É O `import()` A FRIO** (medido em 2026-09-20, três flakes do mesmo dia com esta
raiz). O vitest dá 5 s a cada caso, e um caso que faz `await import(...)` de um grafo grande paga
ali dentro a TRANSFORMAÇÃO dos módulos na primeira vez que o worker os vê. Medido em
`frontend/tests/integration/migracao-main-riscos-abertos.repro.test.js`, com a máquina em repouso
e com 96 processos ocupando 32 núcleos: a migração leva de 9 a 19 ms nas DUAS condições; o import
a frio vai de 175 ms para 7,7 a 11,2 s, e cai a 320 ms com o cache do worker quente. Taxa antes do
conserto, em série sob carga: 8 de 10 verdes; depois, 12 de 12.

Três coisas que a medição ensinou e a intuição erra:

- **carga "moderada" não reproduz.** Trinta processos numa máquina de 32 núcleos deram 8 de 8
  verdes, porque sobrava núcleo. Só a sobrecarga (três vezes os núcleos) reproduziu, e é ela que
  corresponde a duas ou três sessões rodando suíte e Playwright ao mesmo tempo;
- **a primeira hipótese estava errada.** O arquivo tem um caso com folga de 50 ms sobre um
  temporizador e uma janela de 50 ms de `BroadcastChannel`, que é onde o olho vai. Nenhum dos
  dois falhou em 28 execuções; quem falhou foram os dois casos que IMPORTAM;
- **o segundo vermelho era cascata.** O caso seguinte ao que estoura também estoura, sem ter
  defeito próprio. Leia o PRIMEIRO vermelho do arquivo.

O conserto é tirar o import a frio do orçamento do caso, não subir o orçamento às cegas: um
`beforeAll` com tempo próprio que importa os módulos uma vez. O `vi.resetModules()` de cada caso
continua valendo, porque ele refaz a AVALIAÇÃO, que é barata, e o que se paga uma vez é a
transformação. Caso que carrega uma ferramenta inteira (o ESLint, em
`frontend/tests/unit/maplibre-construtores-regua.test.js`) leva orçamento próprio no terceiro
argumento do `it`. **Desde 2026-09-20 o tempo limite global de caso do frontend é de 20 s**, no
lugar dos 5 s padrão do vitest, por autorização do dono, e o número é o pior caso medido (11,2 s)
com folga; ele está escrito em `frontend/vitest.config.js` com a medição ao lado. O preço
declarado: um caso que TRAVA de verdade é denunciado em 20 s em vez de 5. Isso não aposenta o
aquecimento: 20 s cala o sintoma, e o `beforeAll` é o que tira o carregador da conta do caso.

**Última sondagem: 2026-08-23, viva nos quatro caminhos.** `.js` sujo no frontend
(pegou `no-unused-vars`), `.css` sujo no frontend (pegou
`declaration-block-no-duplicate-properties` e `color-hex-length`), `.js` sujo no
backend (o walk-up achou o outro pacote e a saída veio como erro) e arquivo limpo
(silêncio). A sondagem foi por caminho INDEPENDENTE do que produz o resultado no
dia a dia: payload real no stdin do `.claude/hooks/lint-on-write.js`, e não o
texto que ele injeta de volta na sessão, porque conferir o hook pela saída que o
próprio hook põe na conversa é o verificador chancelando a si mesmo. (Sondagem
anterior: 2026-08-14, mesmo resultado.) Anote a data e o resultado ao re-sondar:
sem isso "probe it" é conselho sem prazo de validade, e foi assim que a versão
anterior passou meses morta.

**ARMADILHA DA PRÓPRIA SONDAGEM, descoberta em 2026-08-23, e ela devolve verde sem
ter provado nada.** No Git Bash o `pwd` devolve caminho POSIX (`/c/Users/...`).
Montar o `file_path` do payload a partir dele entrega ao hook uma string que o
`path.resolve` do Node no Windows lê como RELATIVA à raiz do drive, virando
`C:\c\Users\...`: caminho que não existe, fora da raiz do projeto, e cujo walk-up
não acha `eslint.config.js` em lugar nenhum. O hook então sai por `process.exit(0)`
SEM escrever coisa alguma, que é byte a byte o que ele faz para um arquivo limpo.
Quem sondar assim vê silêncio, conclui "não acusou nada" e registra uma sondagem
que não sondou. Passe o caminho no formato do Windows (`C:\...`) ao montar o
payload. Esta é a classe "o verificador também quebra, e quebra calado" da
constituição, na volta mais irônica possível: o defeito estava no aparelho de medir
o aparelho de medir.

- It resolves the linter by walking up from the edited file to the nearest package
that CONFIGURES it (`eslint.config.js` / `stylelint.config.js`), which is what
makes it work in both packages. Silence means clean; a broken install says so out
loud. Do not "fix" a noisy hook by making it fail quiet, which is how the
previous one hid.

- **O frontend TAMBÉM tem regras próprias, desde 2026-08** (`frontend/eslint-rules/`,
ligadas em `frontend/eslint.config.js` sobre `src/**/*.js`, e o `lint:js` roda o
`eslint-rules/probe.js` ANTES do eslint, como no backend): `require-path-comment`,
`no-event-string-literal`, `no-json-clone`, `no-inline-style-assignment` e
`no-unescaped-innerhtml`.

- **Saiba o alcance delas, que é estreito de propósito.** Com `--max-warnings 0` uma
regra ruidosa é uma regra que alguém desliga, então cada uma foi medida contra a
árvore INTEIRA de `frontend/src/js/` e comprada com zero falso positivo, pagando em
falso negativo. O que cada uma deliberadamente NÃO pega está escrito no topo do
próprio arquivo, e vale ler antes de concluir "o lint não reclamou, então está
dentro da convenção". Os buracos que mais custam: `no-unescaped-innerhtml` só
dispara quando a interpolação usa os nomes de campo de dado do usuário (`nome`,
`descricao` e afins), e ignora toda interpolação fora desse léxico;
`no-inline-style-assignment` ignora a atribuição de UMA propriedade
(`el.style.left = ...`, a esmagadora maioria legitimamente computada) e só acusa o
bloco estático; `no-json-clone` não pega a forma em dois passos (`stringify` numa
linha, `parse` na outra); `no-event-string-literal` só reconhece o barramento da
casa pelo nome do receptor, então mini-emissor privado (`toolManager`, `wsClient`)
passa. **Import por alias continua sem regra nenhuma**, cobrado por leitura.

`no-unescaped-innerhtml` acha **zero** violações hoje, porque as três reais foram corrigidas. Zero achados NÃO é a regra
morta, e a distinção é exatamente a que a constituição chama de cobertura vazia:
quem prova que ela continua discriminando é o `eslint-rules/probe.js` do frontend,
contra fixtures sintéticas, e é ele que se deve rodar para saber. Os cabeçalhos das
próprias regras ainda carregam absolutos medidos em 2026-08-13 (a contagem de
arquivos e a de interpolações cruas em
`frontend/eslint-rules/no-unescaped-innerhtml.js`); ao mexer num deles, troque o
número pela propriedade em vez de remedi-lo.

- Verde do lint no frontend significa hoje "sem erro de sintaxe, sem variável não
usada e sem violação das cinco regras acima **no recorte que elas cobrem**", não
"dentro da convenção". E **metade dele é tolerante a warning**: o `lint:js` roda
`eslint . --max-warnings 0`, mas o `lint:css` roda `stylelint` **sem** essa
bandeira, e o `lint` do frontend é os dois em sequência. Hoje isso é inócuo, porque
nenhuma regra do `frontend/stylelint.config.js` está em severidade de aviso (as
ligadas são `true` ou valor, que é erro), então não existe warning para tolerar. É
uma propriedade da CONFIGURAÇÃO, não do script: no dia em que alguém puser uma regra
em `warning`, ou em que o `stylelint-config-standard` trouxer uma nova assim numa
atualização, o CSS passa a reprovar sem reprovar, e nada avisa. Se for mexer aí,
ponha a bandeira no `package.json` no mesmo commit.
