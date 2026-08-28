# Diagnóstico de carga: concorrência, presença e o teto de usuários

Registra o que as bancadas de `backend/tests/bench/` mediram, o que isso revela e o que dá para
fazer. Dez cenários.

**Medição válida:** 2026-08-27, máquina livre, com a sonda de ambiente confirmando isso em cada
rodada. As linhas de base estão em `backend/tests/bench/baselines/2026-08-27/`.
**Commit:** `c34c8001`.
**Máquina:** Windows 11, 20 CPUs, 15,6 GB, PostgreSQL 18.1 local. Piso ocioso medido: 0,62 a 0,70
núcleo.
**Configuração:** padrão de produção. `DATABASE_POOL_MAX` = 10, `lock_timeout` = 5 s. Nenhum
parâmetro foi varrido.
**Escopo:** uma instância. Sala e presença vivem na memória do processo.

> **Aviso sobre a primeira versão deste documento.** A rodada de 2026-08-26 foi colhida com a
> máquina ocupada, e duas conclusões dela eram artefato de ambiente. Os números abaixo são os da
> repetição controlada. O que mudou está na seção 2.8.

Toda afirmação é marcada por classe de evidência:

- **(medido)** saiu de uma bancada, com número.
- **(lido)** saiu do código-fonte.
- **(inferência)** dedução a partir dos dois, ainda sem teste próprio.

---

## 1. A conclusão, em uma página

**O que quebra o EBGeo não é a quantidade de usuários. É a concentração deles numa sala.**

Dois cenários medidos no mesmo dia, na mesma máquina:

| | E10, 1.000 duplas | E8, população real |
|---|---|---|
| sockets | **2.000** | 1.000 |
| ops/s escritas | 1.235 | 616 |
| maior sala | 2 pessoas | **100 pessoas** |
| perda de presença | **~0%** | 21% a 76% |
| sockets derrubados | **0** | 138 (*na rampa; ver P3*) |
| ack mediano | 2.311 ms | 281 ms |

**O dobro dos sockets e o dobro da escrita, com zero perda e zero desconexão.** O que separa os
dois é o tamanho da maior sala.

### Capacidade operacional de uma instância

| limite | medido | o que acontece ao cruzar |
|---|---|---|
| **Pessoas por sala** | 50 → **200** | Em 400, o ack ainda vai a 89 s |
| **Sockets no processo** | **2.000** | Não foi encontrado. Em 2.000 a CPU está em 95% |
| Escrita num atlas | ~1.100 ops/s | Fila do advisory lock; 503 quando `N x lote` passa de ~4.000 |
| Quadros de socket | ~60 mil/s | O máximo observado, na sala de 100 |

**Depois da ação A** (`b931cdcb`), a sala de 200 ficou saudável: ack de 34 ms e zero desconexões.
A de 100 ficou indistinguível da de 50.

**Aguenta com folga:** mil usuários em salas de até duzentas pessoas.
**Não aguenta:** uma sala de quatrocentas, que continua com ack de 89 s.

### O que já entrou

| ação | commit | efeito medido |
|---|---|---|
| **A**, agregar cursor no servidor | `b931cdcb` | Sala de 200: ack de 84.961 ms para **34 ms**, 147 desconexões para **zero** |
| **E**, lote do cliente de 100 para 25 | `48b91f3f` | Vazão de 706 para 968 ops/s, ack por envio de 1.095 ms para 213 ms |
| **C**, opIds no frame de erro | `4b8baa86` | 750 operações saíram do limbo |
| vivacidade por qualquer frame | `403c7c41` | Zerou as desconexões, **e revelou que elas eram um descarte de carga acidental** |
| vivacidade pelo ping do protocolo | (este) | Aba oculta deixa de ser ceifada. Medido: o Chrome trava o ping em 60 s depois de 5 min |

A ação **B** (pool dedicado) foi **cancelada**: a medida mostrou que o pool nunca era o problema.

### O que falta

- **A sala de 400**, que continua com ack de 89 s. Ela deixou de ser limitada por syscall e passou
  a ser limitada por carga útil, e esse teto não foi medido.
- **Grupo 6**, reavaliar o advisory lock. Provavelmente não vale mais.

---

## 2. Diagnóstico

### 2.1 Como foi medido

Dez bancadas, fora do `npm test`, em duas famílias:

- **E1 a E7, escrita.** Um processo de driver, carga em forma de requisição. Foco no `POST /sync` e
  no advisory lock que o serializa.
- **E8 a E10, população.** Vários processos de driver, carga em forma de quadro, tudo por
  WebSocket, com cursor e presença junto. É a única família que enxerga o fan-out.

Quatro decisões de método sustentam os números:

1. **Servidor e driver em processos separados.** Medir dentro do processo medido suja o resultado.
2. **Provas que reprovam.** Toda rodada compara o que o servidor disse com o que o ledger tem, numa
   conexão nova. Latência é descritiva; perda de dado reprova.
3. **Três guardas de instrumento.** A bancada mede o laço do servidor, o laço de cada driver e a
   CPU alheia da máquina. Rodada com qualquer um deles saturado é descartada, não publicada.
4. **Linha de base e banda de ruído medidas.** Duas rodadas idênticas definem o que conta como
   variação. Ver 2.7.

### 2.2 O que está correto no sistema

| propriedade | evidência |
|---|---|
| O advisory lock cumpre o que promete | 40.000 ops, 8 escritores, cursor incremental sem perder nenhuma (E6) |
| O rollback é limpo | Toda op sem veredito ficou ausente do ledger, nos dois caminhos (E2, E3) |
| Idempotência funciona | 800 ops reenviadas absorvidas, sem versão nova nem linha duplicada (E2) |
| Convergência LWW correta sob contenda | Zero divergentes, e contenda de linha custa zero (E7) |
| O ledger não degrada | Latência estável de 8 mil a 40 mil linhas por atlas (E6) |
| Fan-out serializa uma vez, não por destinatário | 0 para 10 ouvintes custa 21%, 10 para 40 custa zero (E5) |
| Socket sobrevive à expiração do token | `reconcileAuthorization` re-resolve permissão, não reverifica o JWT (lido) |
| Nenhuma op foi perdida em nenhum cenário | A reconciliação passou em todas as rodadas válidas |

Isso não é pouco. A maioria dos sistemas colaborativos erra pelo menos um desses.

### 2.3 O caminho de escrita (E1 a E7)

**A vazão de um atlas é plana (E1).**

| escritores | p50 | lotes/s | ops/s | esperando lock | conexões |
|---|---|---|---|---|---|
| 2 | 19,1 ms | 85,8 | 858 | 0 | 3 |
| 4 | 36,2 ms | 101,5 | 1.015 | 2 | 4 |
| 8 | 75,1 ms | 98,3 | 983 | 6 | 8 |
| 16 | 145,3 ms | 107,7 | 1.077 | 9 | **10** |
| 32 | 271,6 ms | 110,9 | 1.109 | 9 | **10** |

Dezesseis vezes mais escritores rendem 29% mais vazão. O custo é pago em latência, que cresce
linearmente. É a serialização do advisory lock, medida.

A partir de **16 escritores num único atlas**, as conexões chegam a 10, que é o pool inteiro.

**A regra do 503 (E2).**

| lote | p50 | 503 | ops/s |
|---|---|---|---|
| 1 op | 11,8 ms | 0 | 531 |
| 10 ops | 67,3 ms | 0 | **1.020** |
| 100 ops | 1.007 ms | 0 | 753 |
| 500 ops | 4.545 ms | **2 de 8** | 491 |

O serviço custa cerca de 1,26 ms por op. A fila do enésimo escritor é `N x lote x 1,26 ms`, e cruza
os 5 s do `lock_timeout` quando `N x lote` passa de **~4.000 ops**.

O ponto ótimo de lote é baixo: **10 ops rendem 1.020 ops/s**, contra 753 em lote de 100 e 531 em
lote de 1.

**Os dois caminhos são equivalentes em latência (E3).** REST e WebSocket chamam o mesmo
`pushOperations`. O que difere é o relato da falha, e isso vira o problema P5.

**A escala entre atlas funciona (E4).** 32 escritores em 1, 4 e 16 atlas dão 814, 2.466 e 3.456
ops/s. O lock é mesmo por atlas.

### 2.4 O tamanho da sala (E9)

Uma sala por degrau, cadência de trabalho, só o tamanho muda:

| sala | ops/s | entregue/s | teórico/s | perda | **ackP50** | derrubados | CPU |
|---|---|---|---|---|---|---|---|
| 10 | 5,8 | 510 | 510 | 0% | **18 ms** | 0 | 8,2% |
| 25 | 15,8 | 3.410 | 3.410 | 0% | **13 ms** | 0 | 15,7% |
| 50 | 35,6 | 13.848 | 13.847 | 0% | **16 ms** | 0 | 29,5% |
| 100 | 69,0 | **60.636** | 61.707 | **1,7%** | **3.844 ms** | **0** | 84,8% |
| 200 | 117,9 | 46.436 | 246.302 | 81,1% | 84.961 ms | 147 | 87,0% |
| 400 | 243,8 | 46.584 | 971.086 | 95,2% | 67.955 ms | 371 | 90,7% |

**Sala de até 50 é perfeita.** A entrega bate com o teórico casa a casa, perda zero, ack de 16 ms,
CPU em 29,5%.

**Sala de 100 funciona, degradada.** Entrega 98,3% do fan-out teórico, perde 1,7% e não derruba
ninguém. Mas o ack sai de 16 ms para 3,8 s, um fator de 240.

**Sala de 200 quebra.** A perda salta para 81,1%, o ack para 85 s e 147 sockets caem.

**O máximo de entrega observado foi 60.636 quadros por segundo**, na sala de 100. Quando a sala
dobra, a entrega absoluta CAI para 46 mil: parte da CPU passa a ser gasta decidindo descartar e
administrando o dobro de sockets.

### 2.5 A quantidade de sockets (E10)

O eixo ortogonal. Salas de duas pessoas, quantidade crescendo, fan-out no mínimo possível:

| salas | sockets | ops/s | cursor env/s | perda | **ackP50** | derrubados | CPU | RSS |
|---|---|---|---|---|---|---|---|---|
| 50 | 100 | 67,4 | 564 | 0% | **11 ms** | 0 | 21,5% | 215 MB |
| 100 | 200 | 134,0 | 1.136 | 0% | **8 ms** | 0 | 24,8% | 223 MB |
| 250 | 500 | 338,9 | 2.843 | 0% | **8 ms** | 0 | 35,4% | 228 MB |
| 500 | 1.000 | 664,5 | 5.773 | 0% | **10 ms** | 0 | 53,0% | 234 MB |
| 1.000 | **2.000** | 1.235,3 | 11.798 | **~0%** | **2.311 ms** | **0** | 95,0% | 331 MB |

**Dois mil sockets funcionam.** Zero perda, zero derrubados, e a maior taxa de escrita de toda a
investigação: 1.235 ops/s. O ack mediano sobe para 2,3 s, que é degradação, não colapso.

**O teto de sockets não foi encontrado.** Em 2.000 a CPU está em 95%, então ele está perto, mas
nada quebrou.

**A fila do advisory lock nunca se forma.** Com a escrita espalhada por mil atlas, o lock não tem
em quem enfileirar, mesmo a 1.235 ops/s.

**Socket aberto custa, independente do fan-out.** Mil sockets com 5.773 quadros/s custam 53% de
CPU; cinquenta sockets do E9 com 13.848 quadros/s custam 29,5%. Mais quadros, menos sockets, menos
CPU. Os dois tetos existem e se chega a eles por caminhos diferentes.

### 2.6 A medida que quase virou conclusão errada

Na cadência de trabalho com mil usuários, o servidor reportou:

| medida | valor |
|---|---|
| ocupação do laço principal | 0,1% (487 ms ativos em 527 s) |
| CPU do processo | 516.282 ms em 526.804 ms, ou **98,0% de um núcleo** |
| repartição | 168 s de usuário, **348 s de sistema** |

As duas estão certas e medem coisas diferentes. O servidor esteve no talo, e quase nada passou pelo
laço de eventos do JavaScript. Dois terços do tempo são kernel: escrita em socket, executada fora
da thread principal.

**Consequência prática.** Otimizar serialização ou o `JSON.stringify` do fan-out renderia pouco. O
custo está no NÚMERO de escritas em socket. Só há dois jeitos de mexer nisso: mandar menos quadros,
ou mandar para menos gente.

*Ressalva: no Windows a divisão entre thread principal e IOCP pode não ser a mesma do Linux. O
total de CPU é comparável; a repartição, não necessariamente.*

### 2.7 A banda de ruído, medida

O E9 rodou **duas vezes em sequência**, sem mudança nenhuma. Nos degraus quebrados a repetição é
quase perfeita:

| sala | perda 1ª | perda 2ª | derrubados 1ª | derrubados 2ª |
|---|---|---|---|---|
| 200 | 81,1% | 81,2% | 147 | 146 |
| 400 | 95,2% | 95,2% | 371 | 369 |

Nos degraus pequenos, o comparador acusou dezoito "regressões" que são todas ruído:

| linha | variação | absoluto |
|---|---|---|
| sala 10, `entregaP99` | +59,5% | **22 ms** |
| sala 100, `perdaCursorPct` | −23,5% | 0,4 ponto |

Porcentagem sozinha mente quando o valor absoluto é pequeno. A banda passou a ser **dupla**: 20%
**e** um piso absoluto por unidade (50 ms para latência, 2 pontos para percentual, 5 para contagem,
100 MB para memória). Com ela, o mesmo par de rodadas idênticas imprime "indistinguível da base".

### 2.8 O que a versão anterior deste documento errou

A rodada de 2026-08-26 foi colhida com a máquina ocupada. Repetida com ela livre:

| medida | contaminado | limpo |
|---|---|---|
| E10, 1.000 sockets, derrubados | 303 | **0** |
| E10, 2.000 sockets, derrubados | 476 | **0** |
| E9, sala de 100, perda | 26,3% e 67,8% | **1,7% e 1,3%** |
| E8, ack mediano | 39.606 ms | **281 ms** |

Duas afirmações caíram: *"mil sockets é o teto"* (dois mil funcionam) e *"o teto de entrega é 36 a
45 mil quadros/s"* (a sala de 100 entrega 60.636). Uma terceira foi enfraquecida: o precipício não
está em 100 pessoas, está entre 100 e 200.

**O achado central sobreviveu**, e ficou mais limpo, porque a comparação passou a ser entre 2.000
sockets em duplas e 1.000 sockets com uma sala grande.

### 2.9 O que a investigação ensinou sobre medir

Quatro erros de instrumento, cada um cometido e corrigido. Ficam registrados porque cada um
produziu, antes da correção, uma tabela com cara de resultado.

**O driver era o gargalo, e a bancada não sabia.** Seis processos com 167 sockets cada produziram
`ackP95` de 41 s com o servidor ocioso. Hoje cada driver mede o próprio laço. Regra: **cerca de 70
sockets por processo de driver**.

**Atraso do laço não é ocupação do laço.** `monitorEventLoopDelay` mede bloqueio. Um laço que
processa trinta mil mensagens curtas por segundo nunca bloqueia, e o histograma marca 16 ms
enquanto o processo queima um núcleo. Demonstrado em bancada sintética: 84,8% de ocupação com p99
de 16 ms.

**O verificador precisa de um caminho independente.** Foi `process.cpuUsage()`, do sistema
operacional, que desmentiu a ocupação do laço.

**A máquina também é instrumento.** Cinco linhas de base foram jogadas fora por causa disso. A
sonda de ambiente desconta servidor, drivers e Postgres, e compara o resíduo com o piso ocioso
MEDIDO da máquina. Ela própria teve um defeito que quase passou: lia a CPU do banco com
`Get-Process | Measure-Object CPU`, que devolve nulo para serviço de outra conta e soma nulos como
ZERO. Dez processos vivos, 120 s de CPU acumulada, e a sonda relatando zero.

---

## 3. Problemas

Ordenados por causa, não por sintoma.

### P1. O fan-out de presença é quadrático (medido)

**A raiz de tudo.** A sala é `atlasId -> Set<WebSocket>`, sem subcanal por mapa. O cursor do
cliente tem throttle de 80 ms, ou 12,5 quadros por segundo por usuário em movimento.

Quadros que o servidor precisa escrever: `S x f x 12,5 x (S - 1)`.

| sala | teórico/s | entregue/s | descartado |
|---|---|---|---|
| 50 | 13.847 | 13.848 | 0% |
| 100 | 61.707 | 60.636 | 1,7% |
| 200 | 246.302 | 46.436 | 81,1% |
| 400 | 971.086 | 46.584 | 95,2% |

**Dobrar a sala quadruplica o trabalho.** Isso é da forma do desenho. Nenhum ajuste de pool, de
lote ou de compressão muda.

**Limite operacional: 100 pessoas por sala, e já degradado. Cem funciona; duzentos não.**

### P2. Na sala de 100, a edição fica lenta antes de qualquer coisa quebrar (medido)

O ack mediano sai de 16 ms na sala de 50 para **3.844 ms** na de 100, com perda de presença de
apenas 1,7% e zero sockets derrubados. Nenhuma das réguas de alarme dispara, e o usuário espera
quase quatro segundos para ver a própria edição confirmada.

A contrapressão protege a memória do servidor, que era o objetivo declarado. Ela não protege a
latência do usuário, e nada no desenho hoje faz isso.

### P3. A varredura de vivacidade era um descarte de carga acidental (medido)

**A primeira versão deste problema estava errada, e o erro vale registrar.** Ela dizia que a fome
de pool derrubava sockets: `reconcileAuthorization` falharia e fecharia com `4003`. Três medidas
desmontaram isso:

1. O pool **não tem `connectionTimeoutMillis`**. Ele espera em vez de lançar, e sem exceção o
   `catch` que incrementa `authzFailures` nunca roda. Estava no código o tempo todo; o mecanismo
   foi deduzido lendo o `catch` sem verificar se algo o alcança.
2. Os códigos de fechamento, uma vez instrumentados, saíram **todos `1006`**: 156 na rampa e 16 na
   janela. Nenhum `4003`. `1006` é `terminate()` da varredura de heartbeat.
3. O laço do driver **durante a rampa** marcou p99 de 19 ms. Os pings saíram no horário. Quem não
   os processou a tempo foi o servidor, ocupado com o fan-out de presença.

**O mecanismo real.** A varredura terminava todo socket cujo `isAlive` estivesse falso, e só o
`ping` rearmava a marca. Sob saturação de CPU o `ping` chega tarde, e um cliente que manda doze
quadros de cursor por segundo era, para a varredura, indistinguível de um cliente morto.

**Consertado** (`403c7c41`): qualquer frame que chega rearma a marca. Derrubados foram a zero.

**E o conserto revelou o problema de verdade.** Ao ceifar 156 sockets, a varredura removia 16% da
população, e os sobreviventes recebiam serviço decente. Sem ela:

| | antes | depois |
|---|---|---|
| derrubados na rampa | 156 | 0 |
| **ackP50 sob saturação** | 72 ms | **114.427 ms** |

**O sistema atravessava a saturação desconectando usuários em silêncio.** Ninguém projetou isso. O
conserto não melhora desempenho: ele troca desconexão invisível por latência visível.

Custo medido contra a linha de base: **zero até 50 pessoas por sala**; na de 100, ack de 3.844 para
6.775 ms. O dano começa onde o sistema já estava fora do limite.

**Isto não autoriza subir o limite de 50 por sala, nem ir a produção sem a ação A.**

### P4. O lote de 100 do cliente encosta no teto do lock (medido, lido)

`FLUSH_BATCH_SIZE = 100` em `frontend/src/js/store/sync/sync-engine.js`. Pela regra do E2, o 503
aparece quando `escritores x lote` passa de ~4.000 ops. Com lote de 100, isso são **40 escritores
simultâneos no mesmo atlas**.

O modo de falha é ruim: uma pessoa cola ou importa muita coisa, e **os outros** levam recusa.

### P5. O frame de erro do socket não dizia o que falhou. **RESOLVIDO** em `4b8baa86`

Sob contenção, 3 de 16 lotes levavam `OPERATION_FAILED` e 750 ops ficavam em limbo, porque o frame
era `{ type, code, message }`, sem `opIds`.

O frame ganhou `opIds` e `retryable`, ambos aditivos. Medido no E3 forçado: **750 ops
inatribuíveis viraram zero**. Inversão que vale registrar: o socket agora informa mais que o REST,
porque o 503 do REST também não traz veredito por op.

### P6. Aba em segundo plano era ceifada. **MEDIDO e RESOLVIDO**

O cliente pingava a cada 25 s e o servidor varre a cada 30 s, com **nenhum handler de `pong`**:
só o `{type:'ping'}` da aplicação rearmava a marca de vida.

**A medida, com sonda própria no Chrome** e um socket WebSocket aberto, para não medir uma página
inerte:

| fase | intervalo do ping |
|---|---|
| oculta, primeiros ~5 min | **25.000 ms**, exatos |
| oculta, além de ~5,6 min | **60.000 ms**, seis amostras consecutivas |

O socket aberto **não** isentou a página, que era a dúvida do desenho. Com ping de 60 s contra
varredura de 30 s, o socket morre de forma determinística: a varredura baixa a marca e a
seguinte, trinta segundos depois, não encontrou ping nenhum.

Numa sala de 200 pessoas, cada volta de aba esquecida virava rotatividade de presença para as
outras 199.

**Consertado com o ping do PROTOCOLO**, respondido pela pilha de rede do navegador. Não passa
pelo JavaScript da página, então não existe temporizador para estrangular; a API de WebSocket nem
expõe ping e pong ao script.

A marca deixa de provar que o laço de JavaScript roda e passa a provar que a conexão e o processo
do navegador estão vivos. **Isso é o conserto, não uma perda**: aba em segundo plano É uma página
com o laço estrangulado, e matá-la era o falso positivo.

### P7. `heartbeatSweep` é O(sockets) de banco a cada 30 s (lido)

A varredura re-resolve autorização de TODO socket, com concorrência 4, contra o pool de 10. É o
combustível do P3.

### P8. Escala horizontal não existe hoje (lido)

Sala, presença e cursores vivem na memória de UMA instância, sem Redis e sem pub/sub. Todo número
deste documento vale para um processo.

---

## 4. O que podemos agir

### A. Agregar quadros de cursor no servidor. **FEITO** em `b931cdcb`

Acumular por sala e emitir um lote a cada 100 ms, com a ÚLTIMA posição de cada usuário. As
escritas em socket caem de `S x f x 12,5 x (S-1)` para `S x 10` por segundo.

Na sala de 200, de 246.302 para cerca de 2.000 quadros/s. Na de 400, de 971.086 para 4.000. Contra
um máximo observado de 60 mil, as duas passam a caber com folga de uma ordem de grandeza.

Custo de UX: a presença passa de 80 ms para 100 ms de granularidade. Imperceptível.

*Medir depois:* E9 nos mesmos degraus, contra a base de 2026-08-27.

### B. Pool dedicado para a varredura de autorização. **CANCELADA**

Ela pressupunha que a fila do advisory lock derrubava sockets por falha de autorização. A medida
mostrou que não: nenhum fechamento `4003`, e o pool nem lança, porque não tem
`connectionTimeoutMillis`. O conserto certo custou uma linha e está no P3.

### C. Incluir os `opIds` no frame de erro do socket. **FEITO** em `4b8baa86`

De 750 ops inatribuíveis para zero, medido no E3 forçado.

### D. Alinhar a janela do heartbeat. **DESCARTADA**, e substituída pelo ping do protocolo

Subir o intervalo da varredura era remendo: aceitava que a prova de vida dependesse de um
temporizador que o navegador tem o direito de estrangular, e pagava com socket morto ocupando
memória e presença fantasma por minutos. Baixar o ping do cliente é impossível, porque o piso do
estrangulamento é de um por minuto e nenhum temporizador o vence.

O conserto real usa o ping do protocolo. Ver P6.

### E. Baixar o lote do cliente de 100 para 25. **FEITO** em `48b91f3f`

De 100 para 25. O E2 mediu que o ponto ótimo de vazão é lote de 10 ops (1.020 ops/s) contra 753 em
lote de 100. A mudança melhora vazão E afasta o 503 ao mesmo tempo.

### F. Não reter a conexão enquanto espera o advisory lock — impacto alto, custo alto

Alternativas: `pg_try_advisory_xact_lock` com re-tentativa fora da transação, ou fila por atlas na
memória do processo. Mudança de núcleo, com decisão registrada.

### G. O que NÃO adianta

- **Subir `DATABASE_POOL_MAX`.** O E10 mostra o lock vazio no cenário de maior escrita. O teto de
  presença não é banco.
- **Otimizar a serialização do fan-out.** Ela já é feita uma vez por transmissão, e a CPU está em
  tempo de sistema, não de usuário.
- **Comprimir os quadros.** O gargalo é o número de syscalls, não a banda.

---

## 4.1 O resultado das ações, medido

Tudo contra a linha de base congelada de 2026-08-27, com ambiente limpo declarado em cada rodada.

**Ação A, agrupamento de cursor** (E9, mesmos degraus):

| sala | ackP50 antes | ackP50 depois | CPU antes | CPU depois | derrubados |
|---|---|---|---|---|---|
| 100 | 3.844 ms | **17 ms** | 84,8% | **22,2%** | 0 → 0 |
| 200 | 84.961 ms | **34 ms** | 87,0% | **44,3%** | **147 → 0** |
| 400 | 67.955 ms | 89.344 ms | 90,7% | 83,0% | **371 → 0** |

A previsão bateu: a sala de 400 saiu de 971.086 escritas em socket por segundo para cerca de 4.000.

**Ação E, lote do cliente** (E2, três rodadas):

| lote | ops/s | p50 por envio |
|---|---|---|
| 10 | 818 / 725 / 691 | ~89 ms |
| **25** | **968 / 773 / 752** | ~213 ms |
| 100 | 706 / 677 | ~1.095 ms |

Cem perdia nos dois eixos. Entre 10 e 25, uma rodada não decidia (18% de diferença está dentro da
banda de ruído de 20%), e foram precisas três para ver o sinal consistente. O desempate veio de
fora da bancada, e fica declarado como inferência: 25 gera duas vezes e meia menos mensagens.

---

## 5. O que ainda não foi medido

- **O lado do CLIENTE do heartbeat.** `ws-client.js` fecha a conexão com 4000 se um `pong`
  ficar pendente de um tick para o outro. O conserto do P6 é do servidor, e essa regra
  continua de pé. Na sonda ela não disparou: a aba estava estrangulada, não congelada, e o
  laço seguia processando as respostas. **Inferência, não medida:** se o Chrome CONGELAR a
  página logo depois de um ping, ela acorda com o `pong` pendente e fecha sozinha. Aba com
  conexão aberta costuma ser isenta de congelamento, e por isso não se mexeu aqui.
- A varredura de `DATABASE_POOL_MAX` e de `lock_timeout`, deliberadamente adiada.
- O teto de sockets, que em 2.000 ainda não apareceu.
- Qualquer cenário com mais de uma instância.
- O caminho binário: upload de imagem e leitura de assets3d sob concorrência.

---

## 6. Plano de execução por grupos

Três regras valem para todos:

1. **A linha de base está congelada** em `baselines/2026-08-27/`. Toda mudança compara contra ela
   com `--comparar`.
2. **Controle negativo.** Reverter a mudança e confirmar que a métrica piora de volta.
3. **Máquina limpa.** A rodada declara o ambiente; a que sair `MAQUINA OCUPADA` é descartada.

### Grupo 0 — Linha de base. **FEITO** em 2026-08-27

Cinco cenários congelados, banda de ruído medida, três guardas de instrumento no ar.

### Grupo 1 — Medir a aba em segundo plano. **FEITO**, e virou conserto

O teste de 90 s que este grupo propunha **não teria provado nada**: o Chrome só entra em
estrangulamento agressivo depois de CINCO minutos de aba oculta, e antes disso o temporizador de
25 s roda exato. Um teste curto daria "passou" e fecharia o assunto errado.

Medido com sonda própria, aba oculta por 17 minutos, socket aberto: 25.000 ms exatos até os ~5,6
min, depois **60.000 ms** em seis amostras consecutivas.

O item D saiu do plano, mas não pela economia que este grupo previa: ele foi **substituído** por
um conserto melhor, o ping do protocolo. Ver P6.

### Grupo 2 — Higiene do socket. **FEITO** em `4b8baa86`

`opIds` no frame de erro, e o item D se o Grupo 1 confirmar.

**Antes, mudar a bancada:** hoje o `escritorWs` conta todo lote com erro como sem veredito, porque
não tem como saber quais falharam. Sem isso a melhoria fica invisível.

*Bancada:* E3 forçado, `--escritores 16 --lotes 1 --ops 250`.

| métrica | partida | alvo |
|---|---|---|
| ops inatribuíveis no caminho WS | 750 | **0** |

### Grupo 3 — Isolar a varredura de autorização. **CANCELADO**, e substituído em `403c7c41`

O alvo era `derrubados` de 138 a zero por meio de um pool dedicado. A medida mostrou que a causa
não era o pool, e o conserto certo custou uma linha. Ver P3.

**O alvo foi atingido e o problema não.** Zero derrubados, e a latência sob saturação piorou por
isso mesmo. Fica dependente da ação A.

<details><summary>O plano original, mantido para registro</summary>

*Bancada:* E8, cadência trabalho, contra a base.

| métrica | partida | alvo |
|---|---|---|
| sockets derrubados | 138 | **0** |
| conexões esperando lock | 9 | 9, inalterado |
| ack mediano | 281 ms | continua igual, e isso é esperado |

**Este grupo não conserta a latência.** Se o ack melhorar junto, alguma premissa está errada.

</details>

### Grupo 4 — Agregar quadros de cursor. **FEITO** em `b931cdcb`

Cruza os dois pacotes. Contrato novo em `docs/decisions/decisions-2026.md`.

**Antes, mudar a bancada:** o usuário virtual conta `cursoresRecebidos` por frame; com o lote,
precisa contar por POSIÇÃO dentro do lote, ou a bancada acusa 99% de perda e uma regressão que não
existe.

*Bancada:* E9, mesmos degraus.

O critério é de **classificação, não de percentual**, porque a sala de 100 já está no meio da
transição:

| sala | tem de se comportar como |
|---|---|
| 100 | a sala de 50 hoje: perda < 1%, **ack < 50 ms**, zero derrubados |
| 200 | a sala de 100 hoje ou melhor: perda < 5%, zero derrubados |
| 400 | perda < 20%, menos de 50 derrubados |

**Se o alvo não for atingido**, a hipótese central está errada, e o próximo suspeito é o custo por
socket que o E10 isolou.

### Grupo 5 — Lote do cliente. **FEITO** em `48b91f3f`

`FLUSH_BATCH_SIZE` de 100 para 25. *Bancada:* E2, degraus 10, 25, 50, 100.

### Grupo 6 — Reavaliar o advisory lock

Depois dos grupos 3 e 4, remedir E1 e E8. É provável que não valha o custo.

---

## 7. Como reproduzir

```bash
cd backend
export BENCH_ADMIN_DATABASE_URL='postgresql://<super>:<senha>@localhost:5432/postgres'

node tests/bench/sala-limite.bench.mjs --trabalhadores 14 \
  --comparar tests/bench/baselines/2026-08-27/sala-limite.json
```

Três regras de que o resultado depende:

- **Cerca de 70 sockets por processo de driver.** Mil usuários pedem 14 trabalhadores, não 6.
- **Rodada com `INSTRUMENTO SATURADO` ou `MAQUINA OCUPADA` não deve ser lida.**
- **Máquina limpa.** A diferença entre medir com e sem outra coisa rodando chegou a inverter
  conclusões deste documento.

Detalhe em `backend/tests/bench/README.md`.
