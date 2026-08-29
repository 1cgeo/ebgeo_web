# Bancadas de concorrência

Dez cenários que medem o backend com **vários usuários mexendo no mesmo dado ao mesmo tempo**.
Não entram no `npm test`. Não afirmam tempo. Imprimem número, e reprovam perda de dado.

**Este arquivo é o MÉTODO. O RESULTADO mora em `docs/wiki/capacidade-de-uma-instancia.md`**: os
tetos medidos, o que continua aberto e o que eles obrigam a decidir. A separação é de propósito,
porque um envelhece por mudança de bancada e o outro por mudança de produto. Um documento
`DIAGNOSTICO-DE-CARGA.md` na raiz do repositório carregou os dois juntos de 2026-08-26 a
2026-08-29, e foi apagado quando o durável dele chegou aos dois destinos.

Duas famílias, e elas medem coisas diferentes:

- **E1 a E7, escrita.** Um processo de driver, carga em forma de requisição, foco no `POST /sync`
  e no advisory lock que o serializa.
- **E8 a E10, população.** Vários processos de driver, carga em forma de QUADRO, tudo por
  WebSocket, com cursor e presença junto. É a única família que enxerga o fan-out.

## O gargalo que estes arquivos existem para medir

`pushOperations` (`src/modules/sync/sync.service.js`) toma `pg_advisory_xact_lock` por atlas
**antes** do primeiro INSERT do lote. Daí saem as três propriedades que mandam em tudo aqui:

1. A escrita no mesmo atlas é **serializada**. A vazão do atlas é o inverso da duração da
   transação, e não cresce com o número de escritores.
2. `SET LOCAL lock_timeout = '5s'` precede o lock. Espera maior vira **503 retentável**.
3. A conexão do pool fica **retida** durante a espera. `DATABASE_POOL_MAX` é 10 por padrão
   (`src/config.js`).

Nenhuma das três tinha número neste repositório antes destas bancadas.

## Como rodar

Cada bancada **cria e recria** o banco `ebgeo_bench_escrita`, sobe o servidor sozinha e o derruba
no fim.

### Antes da primeira rodada: a conexão de superusuário

`postgis` não é extensão *trusted*, então `CREATE EXTENSION postgis` exige superusuário, e o papel
da aplicação não é um. Sem isso a migração `006_ng.sql` morre no meio e deixa o banco com cinco
das onze migrações aplicadas. Aponte uma variável para um superusuário do **mesmo cluster**:

```bash
export BENCH_ADMIN_DATABASE_URL='postgresql://<super>:<senha>@localhost:5432/postgres'
```

O banco continua sendo **criado e possuído** pelo papel da aplicação, e as migrações rodam com os
mesmos privilégios que produção tem. O superusuário faz uma coisa só: cria as extensões dentro do
banco recém-nascido. Sem a variável a bancada para com mensagem que nomeia o conserto, em vez de
deixar a migração falhar longe da causa.

```bash
cd backend
node tests/bench/escrita-contencao.bench.mjs        # E1
node tests/bench/escrita-lote.bench.mjs             # E2
node tests/bench/escrita-caminho.bench.mjs          # E3
node tests/bench/escrita-multiatlas.bench.mjs       # E4
node tests/bench/escrita-fanout.bench.mjs           # E5
node tests/bench/escrita-sequencia.bench.mjs        # E6
node tests/bench/escrita-conflito.bench.mjs         # E7

node tests/bench/populacao-1000.bench.mjs           # E8  (~20 min)
node tests/bench/sala-limite.bench.mjs              # E9  (~17 min)
node tests/bench/sala-quantidade.bench.mjs          # E10 (~17 min)
```

Todo cenário aceita bandeiras. Comece pequeno:

```bash
node tests/bench/escrita-contencao.bench.mjs --degraus 2,4 --lotes 5 --ops 10
```

Banco alternativo, quando outra sessão já está usando o padrão:

```bash
BENCH_DATABASE_URL=postgresql://ebgeo:ebgeo_secret@localhost:5432/ebgeo_bench_2 \
  node tests/bench/escrita-contencao.bench.mjs
```

## Os sete cenários

| Arquivo | Eixo que varia | Pergunta que responde |
|---|---|---|
| `escrita-contencao` | escritores num atlas (2 a 32) | Em que degrau aparece o primeiro 503? |
| `escrita-lote` | ops por lote (1 a 500) | Que produto `escritores x lote` cruza os 5 s? |
| `escrita-caminho` | REST contra WebSocket | Quanto o cliente de socket não sabe se aplicou? |
| `escrita-multiatlas` | atlas (1, 4, 16), escritores fixos | A vazão escala entre atlas, e até onde? |
| `escrita-fanout` | ouvintes na sala (0, 10, 40) | Quanto a plateia custa a quem escreve? |
| `escrita-sequencia` | rodadas no mesmo atlas | Escrever fica mais caro conforme o ledger cresce? |
| `escrita-conflito` | alvos disjuntos contra comuns | A contenda de linha custa, e o estado converge? |

## Os três de população

| Arquivo | Eixo que varia | Pergunta que responde |
|---|---|---|
| `populacao-1000` | cadência (reunião, trabalho, exercício) | Mil usuários reais cabem? Onde dói primeiro? |
| `sala-limite` | tamanho de UMA sala (10 a 400) | Quantas pessoas cabem numa sala? |
| `sala-quantidade` | quantidade de salas de 2 (50 a 1000) | Quantas duplas cabem no processo? |

Os dois últimos são **eixos ortogonais** e nenhum substitui o outro. `sala-limite` mede o fan-out,
que é quadrático no tamanho da sala. `sala-quantidade` reduz o fan-out ao mínimo (cada quadro vai
para um par só) e mede o custo de EXISTIR: socket aberto, heartbeat, sala no mapa, conexão.

### Por que a presença é o centro, e não um enfeite

A sala é `atlasId -> Set<WebSocket>`, sem subcanal por mapa. Um usuário com o mouse em movimento
emite **12,5 quadros por segundo** (`CURSOR_THROTTLE_MS = 80`, no `presence-bridge.js`). Até
2026-08-28 cada quadro era retransmitido a todos os outros membros: numa sala de 100 com metade
mexendo o cursor, ~625 quadros por segundo entrando e ~62 mil saindo, contra ~100 descargas de
escrita. **Duas ordens de grandeza**, e as bancadas E1 a E7 não enxergam nada disso.

Dobrar a sala **quadruplica** o trabalho de transmissão. Isso é da forma do desenho, e nenhum
ajuste de pool ou de tamanho de lote muda.

**O que mudou, e o que NÃO mudou.** Desde 2026-08-28 o servidor acumula por sala e emite um lote
`cursors` a cada `WS_CURSOR_BATCH_MS` (100 ms), com a última posição de cada cliente: as escritas
caem de `S x f x 12,5 x (S-1)` para `S x 10` por segundo, e o limite operacional de sala subiu de
cinquenta para duzentas. A FORMA quadrática continua lá, adiada e não removida: a sala de 400
segue com ack de 89 s, agora limitada por carga útil em vez de syscall. `WS_CURSOR_BATCH_MS=0`
volta ao caminho antigo, que é como se mede um contra o outro.

**Efeito na régua:** com o agrupamento ligado, a fórmula antiga de perda de cursor mediria
COALESCÊNCIA em vez de descarte (ela acusou 26,6% de "perda" na sala de dez, que não tem
congestionamento nenhum). O denominador desconta o teto do lote, e a coalescência tem coluna
própria.

### As cadências, e de onde saem os números

Nenhum número foi inventado. O que a cadência varia é a FRAÇÃO do tempo em que a pessoa edita e a
fração em que ela mexe o mouse. O ritmo dentro de cada estado vem do cliente: 500 ms de descarga
de fila (`collab.quality.js`, banda padrão) e 80 ms de cursor.

| cadência | editando | cursor em movimento |
|---|---|---|
| reunião | 5% | 20% |
| trabalho | 15% | 50% |
| exercício | 40% | 80% |

O usuário virtual alterna rajada e ócio, e **a primeira espera é sorteada** em vez de ser um ócio
inteiro. Sem isso o começo da janela não teria escrita nenhuma: na cadência de trabalho o ócio
médio passa de um minuto e meio, e um piloto de 20 s registrou zero ops.

### Todo usuário pinga, e continua não sendo opcional

A varredura de 30 s (`heartbeatSweep`) termina qualquer socket que não tenha rearmado `isAlive`. Um
usuário virtual silencioso seria derrubado em até 60 s, e a bancada viraria uma tempestade de
reconexão medindo a si mesma.

**O que REARMA a marca mudou em 2026-08-28, e o driver não pode contar com isso.** Até então só o
`{type:'ping'}` da aplicação rearmava, e não havia handler de `pong`; hoje rearmam também qualquer
frame que chega e o pong do PROTOCOLO, que a varredura solicita por `ws.ping()`. Foi esta bancada
que achou os dois defeitos: sob saturação de CPU o ping do cliente chega tarde, e a varredura
ceifou 156 sockets na rampa de uma rodada, removendo 16% da população. **Isso era um descarte de
carga acidental**, e ao removê-lo o ack mediano sob saturação foi de 72 ms para 114 s. Ou seja, o
driver silencioso continua morrendo e o driver falante deixou de morrer, então a regra do usuário
virtual não muda: pingue.

### As três réguas de quebra, em ordem de gravidade

1. `perdaCursorPct` sobe. A sala não acompanha e a presença degrada. **Não é defeito**: quadro de
   presença é descartável por desenho, e o descarte se auto-cura.
2. `entregaP95` sobe. A EDIÇÃO passa a chegar tarde no par. Isto o usuário sente.
3. `derrubados` sobe. O servidor terminou sockets. A sala parou de funcionar.

A ORDEM em que elas quebram é parte do resultado. Perda de cursor bem antes da entrega significa
que o desenho está se protegendo como pretendido. As duas subindo juntas significa que não está.

### Como a população é medida

- **Vários processos de driver.** Mil sockets e milhares de quadros por segundo não cabem num laço
  de eventos sem o driver virar o gargalo. É a mesma separação que `servidor.mjs` faz entre
  servidor e driver, um nível mais para fora.
- **Um observador por sala.** Todo usuário registra o que ENVIOU; só o primeiro membro de cada
  sala registra o que RECEBEU. O atraso de entrega é o casamento dos dois, por `op_id`, feito pelo
  coordenador depois da rodada. Isso funciona porque o relógio de parede é comparável entre
  processos da mesma máquina, e **não sobreviveria a duas máquinas**.
- **A janela começa depois da rampa.** Mil handshakes, cada um com JWT e resolução de permissão,
  são uma tempestade de conexão que não é regime permanente. A rampa é cronometrada à parte e o
  que ela produziu é descartado.
- **Reconciliação por totais.** O registro por op não atravessa processo, então a prova vira:
  *ops enviadas e ausentes do ledger* tem de ser igual a *sem veredito + recusadas*. Qualquer
  outro número significa lote parcialmente aplicado e reportado como perdido, ou o contrário.

### O instrumento mede a si mesmo, e essa lição custou uma rodada inteira

A primeira rodada de mil usuários imprimiu uma tabela com cara de resultado: `ackP95` de **41
segundos**, 191 sockets derrubados, dezenas de milhares de ops sem veredito. Ao lado, na mesma
saída, o laço de eventos do **servidor** marcava p99 de 16 ms e máximo de 32 ms.

Os dois números não podem ser verdade sobre o mesmo processo. Quem travava eram os **drivers**:
seis trabalhadores para mil sockets dão 167 cada, e cada um desserializava milhares de quadros por
segundo. Um trabalhador cujo laço para por mais de 30 s não manda o ping, e o servidor ceifa o
socket — corretamente. As ops em voo se perdem, e a bancada acusava perda que ela mesma causou.

A bancada não tinha como saber, porque media o laço do SUJEITO e não o laço do INSTRUMENTO. Uma
checagem que não pode reprovar não é checagem.

Agora cada trabalhador mede o próprio laço e o relatório imprime os dois lado a lado, com veredito:

| nível | laço do driver | o que fazer |
|---|---|---|
| `SADIO` | p99 < 80 ms | ler os números |
| `APERTADO` | 80 a 250 ms | ler p50, desconfiar de p95 e p99 |
| `SATURADO` | p99 ≥ 250 ms ou max ≥ 5 s | **descartar**: sobe `--trabalhadores` e roda de novo |

Em `SATURADO` a tabela sai precedida de `>>> A TABELA ABAIXO NAO MEDE O SERVIDOR <<<`.

O limiar não é arbitrário: o usuário emite cursor a cada 80 ms e descarrega ops a cada 500 ms.
Driver que trava um quarto de segundo já está atrasado para os dois.

**Regra prática de dimensionamento:** cerca de 70 sockets por trabalhador. Mil usuários pedem 14
trabalhadores, não 6.

### Três guardas de instrumento, e cada uma nasceu de uma tabela que mentiu

| guarda | vigia | o que ela pegou |
|---|---|---|
| sonda do laço | o **servidor** | nada, sozinha: laço a 84,8% de ocupação reporta 16 ms de atraso |
| histograma do trabalhador | o **driver** | 167 sockets por processo produziram `ackP95` de 41 s com o servidor ocioso |
| carga da máquina | o **ambiente** | trabalho alheio disputando CPU com o experimento |

A terceira é a mais recente. A linha de base do E8 saiu com 95,9% de perda de cursor na sala de
cem, contra 85,6% na rodada do diagnóstico, e a sala de **duas** pessoas saltou de 9,1% para 65,1%,
com o backend idêntico entre as duas medidas. As duas leituras não podem ambas descrever o sistema.
Ou o cenário tem variância enorme, ou a máquina estava ocupada. **A bancada não tinha como
distinguir, e é isso que era o defeito.**

`os.cpus()` dá o tempo acumulado de cada núcleo. Duas leituras, início e fim da janela, dão a
ocupação real da máquina sem depender de contador de processo. Subtraindo o que o servidor e os
drivers gastaram, o que sobra é trabalho **alheio**:

| nível | núcleos alheios | leitura |
|---|---|---|
| `AMBIENTE LIMPO` | < 0,75 | os números valem |
| `AMBIENTE SUJO` | 0,75 a 2 | leia p50, desconfie de p95 e p99 |
| `MAQUINA OCUPADA` | 2 ou mais | descarte e meça de novo |

O limiar é em núcleos absolutos, não em porcentagem da máquina. Meio núcleo alheio atrapalha igual
numa máquina de 4 e numa de 20, porque o servidor é monothread e o que ele disputa é **um** núcleo,
nunca a média.

O resíduo é piso, não conta exata: sobra nele o Postgres, que roda em processo separado e é parte
legítima do experimento. Por isso o alarme é generoso, para pegar "tinha um build rodando junto" e
não para auditar milissegundos.

### Linha de base: gravar e comparar

```bash
node tests/bench/sala-limite.bench.mjs --gravar-base
node tests/bench/sala-limite.bench.mjs --comparar tests/bench/baselines/2026-08-27/sala-limite.json
```

`--gravar-base` grava `tests/bench/baselines/<data>/<cenario>.json` com as linhas e o cabeçalho da
máquina. A data está no diretório de propósito: base sem data é uma afirmação sobre "o sistema",
quando é uma afirmação sobre aquele dia, naquela máquina, naquele commit.

`--comparar` imprime a variação **por linha e por coluna**, nunca um número resumo. Uma mudança que
melhora a sala de 400 e piora a de 10 não pode aparecer como "melhorou 12%".

**A direção de cada coluna está declarada no comparador.** Queda de 30% em `ops/s` é regressão; a
mesma queda em `ackP95` é o objetivo. Sem essa tabela, o comparador imprimiria porcentagens e
deixaria a interpretação para quem está torcendo.

**Regressão não reprova a rodada.** A bancada não sabe se a mudança foi deliberada. Ela imprime e
avisa. Só perda de dado sai com código 1.

**A banda de ruído é medida, não arbitrada.** Antes de acreditar em qualquer melhora, a mesma
bancada roda duas vezes sem mudança nenhuma, e o espalhamento observado vira a banda.

### A reconciliação é uma banda, não uma igualdade

Op que ainda esperava ack quando o cronômetro parou pode ter sido gravada, ou não. As duas saídas
são legítimas, e juntar isso com "sem veredito por erro" reprovou toda sala na primeira rodada,
enquanto `ausentesDoLedger` dava **zero**. A prova agora é:

```
piso = semVeredito + recusadas
teto = piso + emVooNoFim
piso <= ausentesDoLedger <= teto
```

Abaixo do piso significa op recusada que foi gravada. Acima do teto significa op perdida sem
ninguém ter sido avisado. Só esses dois reprovam.

### O que a população NÃO mede

Atraso de quadro de cursor, um a um. Quadros de presença não têm id, e o gateway relaia só o valor
NORMALIZADO (`collab.schemas.js` explica por quê: o valor fica retido no socket e é reservido nos
`connected` seguintes). Então não há como carimbar um quadro e cronometrá-lo. O que dá para medir
é quantos saíram, quantos chegaram, e portanto a TAXA DE DESCARTE, que é o número que importa.

## O que sai na tela

Cabeçalho com a máquina, o commit e a configuração. Sem isso, o número não compara entre dias.

Depois a tabela por degrau. As colunas que mais dizem:

- `503` — recusa pelo `lock_timeout`. É o teto, e é o resultado principal de E1 e E2.
- `lockPico` — backends esperando em `Lock/advisory`, por amostragem de `pg_stat_activity` a
  cada 250 ms. É **piso**, nunca o máximo real: uma amostra não integra.
- `conexPico` — backends conectados. Comparado com `DATABASE_POOL_MAX`, diz se a contenda já
  está comendo o pool do processo inteiro.
- `lacoP99` e `lacoMax` — atraso do laço de eventos medido **dentro** do servidor.
- `aRetentar` — ops enviadas que não estão no ledger. É o trabalho que o cliente refaria.

Por fim, a contabilidade por degrau e o bloco de reconciliação.

## A parte que reprova

Latência aqui é descritiva. Correção não é. Toda rodada termina comparando o que o servidor
**disse** com o que o ledger **tem**, numa conexão nova:

- **P1** toda op com ack está em `operations`.
- **P2** toda op sem veredito (503, `error` de socket, silêncio) está **ausente**. O
  `lock_timeout` dispara antes do primeiro INSERT, então nada pode ter sobrado.
- **P3** toda op recusada por política está **ausente**.
- **P4** o cursor incremental viu toda op commitada. Esta é a razão de ser do advisory lock,
  escrita como diferença de conjuntos (E6).
- **P5** o estado final de cada feição disputada é o da op de maior `server_version` (E7).

Prova reprovada faz o processo sair com código 1.

A comparação é sempre por `op_id`. Nunca por contagem de linha, nunca por contiguidade de
versão: `atlas_version_seq` é global entre atlas, então buraco na numeração é op de outro atlas.
Detectar perda por não-contiguidade já causou tempestade de `sync_request` neste sistema.

## O que estes números NÃO cobrem

Está tudo no cabeçalho de cada rodada, e repetido aqui porque é o tipo de coisa que se esquece
ao citar um número seis meses depois:

- **Limitadores desligados.** O servidor sobe com `NODE_ENV=test`, e `src/middleware/rate-limit.js`
  pula todos nesse modo. Sem isso, dezenas de escritores mediriam o `authLimiter`.
- **Log silencioso.** `src/utils/logger.js` cala em teste. O custo por requisição do
  `requestLogger` de produção está **fora** destes números.
- **Sem `.env`.** O servidor da bancada sobe com `node src/index.js`, e não com o `start` do
  `package.json`, que carrega `--env-file-if-exists=.env`. É deliberado: assim a bancada nunca
  aponta para o banco de desenvolvimento por acidente. Também significa que ela não reproduz a
  configuração local de ninguém.
- **Uma instância.** Sala, presença e cursores vivem na memória do processo, sem Redis e sem
  pub/sub. Nada de E5 se estende a mais de uma instância sem sticky-session.
- **`DATABASE_POOL_MAX` e `lock_timeout` no padrão.** Nenhuma bancada os varre. Elas medem o
  padrão e mostram onde o joelho cai; mexer neles é decisão a registrar, não bandeira de bench.
- **O chão do histograma do laço é o tique do relógio.** No Windows a granularidade do timer é
  cerca de 15,6 ms, então `lacoP99` abaixo de ~16 ms não é medida, é o piso do instrumento. A
  coluna só começa a dizer algo bem acima disso.
- **A sonda do Postgres amostra a cada 250 ms.** Rodada curta (menos de um segundo) rende uma
  amostra ou nenhuma, e `lockPico` sai zero sem que isso signifique ausência de fila. Degrau
  precisa durar segundos para essa coluna valer.
- **Máquina ocupada contamina tudo.** Um `npm run dev` ou um Playwright em paralelo disputa CPU,
  banco e porta. Na primeira rodada real desta bancada eles seguraram a porta e a rodada morreu
  antes do primeiro pedido. Feche tudo antes de medir.
- **Windows não para o servidor com graça.** `kill()` mapeia para `TerminateProcess`, então o
  `SIGTERM` de `src/index.js` não roda e o Postgres colhe as conexões. Inofensivo num banco
  dedicado, e mais uma razão para ele ser dedicado.

## Arquitetura, em uma linha cada

- `lib/servidor.mjs` — sobe o servidor real em **processo próprio** e espera `/api/v1/health`
  responder 200. Nunca ancore espera em texto de log.
- `lib/sonda-laco.mjs` — histograma do laço de eventos, injetado no servidor por `--import`.
  Fica aqui, e não em `src/`, para não mudar código de produção por causa de bancada.
- `lib/sonda-pg.mjs` — amostra `pg_stat_activity` por fora, que é o único jeito de separar
  "esperando o lock" de "trabalhando".
- `lib/semear.mjs` — semeia por SQL reusando `tests/helpers/fixtures.js`, e cunha token pela
  rota real de login.
- `lib/escritor.mjs` — o usuário virtual, nos dois caminhos, com registro do que enviou.
- `lib/leitor.mjs` — o cursor incremental que prova P4.
- `lib/reconciliar.mjs` — as provas.
- `lib/bancada.mjs` — o andaime: aquecimento descartado, amostragem, tabela, código de saída.

## Por que dois processos

A bancada mais antiga desta pasta (`overview-capas.bench.mjs`) roda `createApp()` dentro do
processo que mede, e diz no próprio cabeçalho que a sonda do laço vira um teto sujo por causa
disso. Com dezenas de escritores a distorção deixa de ser ressalva e vira o resultado. Aqui o
servidor tem processo limpo, o driver tem outro, e o histograma do laço é colhido lá dentro.
