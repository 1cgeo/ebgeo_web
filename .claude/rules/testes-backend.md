---
paths:
  - "backend/tests/**"
  - "backend/scripts/run-tests.js"
  - "backend/.c8rc.json"
  - "backend/eslint-rules/**"
  - "backend/package.json"
---

# Testes do backend: tempos, atalhos e rodadas que colidem

O essencial (o que o `npm test` da raiz exige, a tabela de quem possui o quê, o isolamento) está em [testing.md](testing.md), que carrega sempre. Aqui fica o detalhe medido.

**O laço apertado, com os tempos medidos em 2026-08-16** (o dono reclamou de
lentidão, e a primeira explicação que dei estava errada por não ter medido):

| comando | tempo |
|---|---|
| `npm test --prefix frontend` (a suíte inteira: tudo em `tests/`, menos os dois diretórios de e2e que o `vitest.config.js` exclui) | 8 s |
| `npm run test:fast --prefix backend -- <arquivo>` | 1,5 s |
| `npm test --prefix backend -- <arquivo>` | 2,8 s |

Ou seja: **o ciclo de banco do backend custa ~1,2 s, não os 40 s que a intuição
atribuía a ele**, e nenhum dos dois pacotes é lento por arquivo. O que demora é a
suíte INTEIRA do backend (sob `c8`, verificando o piso) e a perna de e2e. Antes de
otimizar qualquer coisa aqui, meça.

**NÃO reponha o atalho que o backend teve até 2026-08-23**, e é útil saber que ele
existiu, porque a próxima pessoa incomodada com o tempo de rodada reinventa
exatamente aquilo. Era um script que chamava `node --test` direto sobre os arquivos
de teste: sem criar banco, sem aplicar migração pendente, sem passar pelo
`scripts/run-tests.js` e portanto sem `c8` e sem o piso de cobertura. Saiu do
`package.json` naquela data.

A lição é o contraste com o `test:fast`, que é o atalho legítimo. Ele compra tempo
entregando UMA propriedade (hermeticidade) e continua aplicando migração pendente,
que é o que o impede de virar "rápido contra o schema velho"; e recusa a suíte
inteira, para não ser confundido com a rodada que vale. Pular a migração entrega o
vermelho ERRADO (schema defasado reprovando código certo) e o verde errado (código
que só passa porque a coluna nova ainda não existe); pular o `c8` reporta verde sem
o piso. Nenhum dos dois se anuncia: quem rodou vê a mesma linha de sucesso da rodada
hermética, e é aí que o atalho deixa de ser troca informada e vira medição falsa. A
rodada que vale antes do commit é HERMÉTICA: o `npm run test:tocados` da raiz (que
roda os testes mirados numa rodada hermética, sem `--reuse-db`), o `npm test` sem
argumento no pacote, ou o `npm test` da raiz.

**DUAS RODADAS DO BACKEND NA MESMA MÁQUINA SE ATROPELAM, e o vermelho que sai disso
se lê como regressão** (medido em 2026-08-29). Elas compartilham o banco
`ebgeo_test`: a que começa depois o dropa e recria no meio da primeira, e o sintoma
é `3D000 database ... does not exist`, `42P01 relação ... não existe` e casos que
terminam `cancelled`, tudo em arquivos sem relação com o que você mexeu, e nada na
saída aponta para a causa. Antes de diagnosticar, confirme que não há outra rodada
viva (a de um agente em paralelo, a sua de dois terminais atrás). A saída é dar
banco próprio a uma delas por `TEST_DB_NAME`, que `backend/scripts/run-tests.js` lê
(no PowerShell, `$env:TEST_DB_NAME='ebgeo_test_2'` antes do comando; o Bash aceita
o prefixo na mesma linha). Reconfirme o vermelho sozinho antes de tratá-lo como
código quebrado: é a mesma regra do banco reaproveitado do `test:fast`.

**E O BANCO NÃO É O ÚNICO RECURSO COMPARTILHADO: A COBERTURA TAMBÉM COLIDE, e essa
colisão é PIOR, porque não grita** (medido em 2026-09-01). O `c8` coleta por
`NODE_V8_COVERAGE` num diretório temporário (`backend/coverage/tmp`) e o `.c8rc.json`
tem `clean: true`: duas rodadas simultâneas apagam os arquivos de cobertura uma da
outra. O sintoma não é erro nenhum, é um NÚMERO PLAUSÍVEL E MENOR, com todos os
testes passando, e o piso reprovando por causa dele. Medido no mesmo dia, sobre o
MESMO commit e os MESMOS 4368 casos verdes, três rodadas contaminadas deram statements
de 90,11%, 97,37% e 97,9%, com o piso reprovando nas duas primeiras; duas rodadas
isoladas deram 97,9% (43434/44362), idênticas no numerador e no denominador.

Três coisas que essa medição ensinou e que a intuição erra:

- **o número baixo é o artefato, não o alto.** A leitura natural ("cobertura caiu,
  alguém commitou código sem teste") aponta para código e para pessoa, e foi assim que
  uma sessão acusou o lote de outra sem ter isolado o instrumento;
- **contaminação não só SUBTRAI.** O argumento de que ela só pode derrubar o número
  (perde-se arquivo de cobertura, nunca teste) é quase certo e não é hermético: as duas
  rodadas medem a mesma suíte, então o que a outra escreveu no diretório pode SOMAR
  cobertura à sua. Um verde obtido com o diretório compartilhado, portanto, também não
  prova nada;
- **o denominador denuncia.** Com `all: true` o total de funções deveria ser fixo pelo
  conjunto de arquivos; nas três rodadas contaminadas ele foi 882, 887 e 925. Total que
  muda entre rodadas do mesmo commit é a evidência de que o instrumento, e não o código,
  está variando. Olhe o denominador antes de acreditar na porcentagem.

Postos lado a lado, os três dizem uma coisa que nenhum deles diz sozinho: **a graduação não
é de gravidade do recurso, é de quanto o modo de falha foi instrumentado.** A porta grita e
se nomeia, porque alguém escreveu aquela frase; o banco grita mal, com `3D000` e `42P01` em
arquivos sem relação com o que se mexeu; a cobertura não grita, e devolve uma porcentagem
crível que acusa o código de outra pessoa. O trabalho, quando um recurso novo passar a ser
compartilhado, é escrever a frase, não descobrir o sintoma depois.

**E NÃO USE `backend/coverage/tmp` COMO SEMÁFORO DE RODADA VIVA.** É a verificação que a
leitura deste texto sugere e ela responde sempre a mesma coisa: o `clean: true` limpa no
INÍCIO da rodada, então o resíduo de uma rodada TERMINADA fica lá até a próxima começar.
Medido em 2026-09-01 com ZERO processos node vivos: 819 arquivos no diretório. Diretório
cheio é o estado de repouso, e quem o usar como semáforo lê "ocupado" sempre, ignora o
semáforo em uma semana e volta a medir cobertura contaminada achando que conferiu. O sinal
válido é a lista de processos (`tasklist | grep -c node.exe`, ou o equivalente do seu
shell), e ele foi o que de fato acusou a rodada paralela naquele dia; a contagem de
arquivos foi citada junto, como se corroborasse, e não corroborava nada.

A saída é isolar os DOIS eixos, não um: banco por `TEST_DB_NAME` e diretório de
cobertura próprio, rodando `npx c8 --temp-directory <dir> node scripts/run-tests.js`
de dentro de `backend/` (com `NODE_V8_COVERAGE` posto pelo c8, `run-tests.js` não
se auto-eleva de novo, então não há dupla instrumentação). Isolar só o banco deixa a
cobertura exposta, e foi o que produziu duas das três medições divergentes.

**E o runner monta o ambiente do processo de teste EXPLICITAMENTE, sem ler o
arquivo .env.test.** Variável posta lá fica inócua com cara de configurada, que é a
classe "o verificador também quebra calado": ela tem de entrar na lista de
`backend/scripts/run-tests.js`. Foi o que aconteceu com `TILE_SERVER_URL` em
2026-08-29, e o modo de falha dela é o pior tipo: o índice de regime só indexa
endereço que caia sob aquela base, então sem ela o índice sai VAZIO, e índice vazio
significa recusar tudo, de modo que um teste de tile passaria medindo a ausência de
configuração em vez do gate.

- **Três regras de lint próprias vigiam cobertura vazia em teste** (backend,
`backend/eslint-rules/`): `no-conditional-assert` (assert dentro de `if` cuja
condição não foi asserida), `no-disjunctive-assert` (`assert.ok(A || B)`) e
`no-unasserted-loop-assert` (laço sobre coleção de tamanho não asserido). Na
primeira execução acharam **46 violações reais** em 28 arquivos. O
`npm run lint` do backend roda `eslint-rules/probe.js` ANTES do eslint: o probe
verifica as regras contra fixtures de deve-pegar e não-deve-pegar, porque
regra de lint também é verificador e verificador quebra calado.

**Caso síncrono que atravessa código que lê `Date.now()` e agenda `setTimeout` liga `mock.timers.enable({ apis: ['setTimeout', 'Date'] })` e avança o relógio ele mesmo.** No relógio de parede, um milissegundo que vira no meio do caso muda o ramo que o produto toma, e o timer agendado só dispara depois do fim síncrono: o vermelho sai numa fração das execuções e passa sozinho, o que já o fez ser lido como "ambiente da suíte". Medido em 2026-09-25 em `backend/tests/unit/presenca-fluxo-por-destinatario.test.js`: 8 de 60 vermelhos antes, 0 de 60 depois.
