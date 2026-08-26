# Diagnóstico de carga: concorrência, presença e o teto de usuários

Registra o que as bancadas de `backend/tests/bench/` mediram, o que isso revela e o que dá para
fazer. Dez cenários, medidos em 2026-08-26.

**Commit:** `63daac3f` mais as bancadas de população.
**Máquina:** Windows 11, 20 CPUs, 15,6 GB, PostgreSQL 18.1 local.
**Configuração:** padrão de produção. `DATABASE_POOL_MAX` = 10, `lock_timeout` = 5 s.
Nenhum parâmetro foi varrido.
**Escopo:** uma instância. Sala e presença vivem na memória do processo.

Toda afirmação é marcada por classe de evidência:

- **(medido)** saiu de uma bancada, com número.
- **(lido)** saiu do código-fonte.
- **(inferência)** dedução a partir dos dois, ainda sem teste próprio.

---

## 1. A conclusão, em uma página

**O que quebra o EBGeo não é a quantidade de usuários. É a concentração deles numa sala.**

Dois cenários com o mesmo número de sockets e taxa de escrita parecida:

| | E8, população real | E10, 500 duplas |
|---|---|---|
| sockets | 1.000 | 1.000 |
| ops/s escritas | 618,8 | **661,7** |
| maior sala | **100 pessoas** | **2 pessoas** |
| ack mediano | **39.606 ms** | **12 ms** |
| sockets derrubados | 145 | **0** |
| conexões esperando lock | **9** de 10 | 1 |
| CPU do processo | 99,6% de um núcleo | 60,5% |

Mesma quantidade de gente. Mais escrita no caso que funciona. Resultado oposto.

### Capacidade operacional de uma instância

| limite | medido | o que acontece ao cruzar |
|---|---|---|
| **Pessoas por sala** | **50** | Em 100, o ack sai de 11 ms para 80 s no mesmo degrau |
| **Sockets no processo** | **1.000** | Em 2.000, ack de 70 s e 476 sockets derrubados |
| Escrita num atlas | ~800 ops/s | Fila do advisory lock; 503 quando `N x lote` passa de 3.300 |
| Escrita agregada | ~3.400 ops/s | Achata; o pool de 10 vira o teto |
| Quadros de socket | ~40 mil/s | O processo para de escrever, independente da demanda |

**Aguenta hoje, com folga: mil usuários distribuídos em salas de até cinquenta.**

**Não aguenta: uma sala de cem.**

### As três coisas a fazer, em ordem

1. **Agregar quadros de cursor no servidor** (ação A). Sozinha, muda o limite de sala de cinquenta
   para a casa das centenas.
2. **Pool dedicado para a varredura de autorização** (ação B). Impede que a fila de escrita
   desconecte usuários de outras salas.
3. **Incluir os `opIds` no frame de erro do socket** (ação C). Uma linha, e o cliente passa a saber
   o que reenviar.

---

## 2. Diagnóstico

### 2.1 Como foi medido

Dez bancadas, fora do `npm test`, em duas famílias:

- **E1 a E7, escrita.** Um processo de driver, carga em forma de requisição. Foco no `POST /sync` e
  no advisory lock que o serializa.
- **E8 a E10, população.** Vários processos de driver, carga em forma de quadro, tudo por
  WebSocket, com cursor e presença junto. É a única família que enxerga o fan-out.

Três decisões de método sustentam os números:

1. **Servidor e driver em processos separados.** Medir dentro do processo medido suja o resultado.
2. **Provas que reprovam.** Toda rodada compara o que o servidor disse com o que o ledger tem, numa
   conexão nova. Latência é descritiva; perda de dado reprova.
3. **O instrumento mede a si mesmo.** Cada driver reporta o próprio laço de eventos. Rodada com
   driver saturado é descartada, não publicada.

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

**A vazão de um atlas é plana (E1).** De 2 a 32 escritores, os mesmos ~80 lotes por segundo. O
custo de somar escritor é pago inteiro em latência, de 21,9 ms para 393,5 ms. É a serialização do
advisory lock, medida pela primeira vez.

A partir de **16 escritores num único atlas**, `conexPico` bate em 10, que é o pool inteiro.

**A regra do 503 (E2).** O serviço custa cerca de 1,5 ms por op. A fila do enésimo escritor é
`N x lote x 1,5 ms`, e cruza os 5 s do `lock_timeout` quando `N x lote` passa de **~3.300 ops**.
A regra fecha em três cenários independentes.

O ponto ótimo de lote é baixo: 10 ops rendem 762 ops/s, contra 581 em lote de 100 e 397 em lote de
1.

**Os dois caminhos são equivalentes em latência (E3).** REST e WebSocket chamam o mesmo
`pushOperations`. O que difere é o relato da falha, e isso vira o problema P5.

**A escala entre atlas funciona, até certo ponto (E4).** 32 escritores em 1, 4 e 16 atlas dão 814,
2.466 e 3.456 ops/s. O lock é mesmo por atlas. Mas o ganho achata: dez conexões a 1,5 ms por op
dariam ~6.600 ops/s, e a medida para na metade.

### 2.4 O tamanho da sala (E9)

Uma sala por degrau, cadência de trabalho, só o tamanho muda:

| sala | ops/s | entregue/s | teórico/s | perda | **ackP50** | derrubados | CPU |
|---|---|---|---|---|---|---|---|
| 10 | 7,3 | 503 | 503 | 0% | **9 ms** | 0 | 5,7% |
| 25 | 18,9 | 3.592 | 3.593 | 0% | **9 ms** | 0 | 12,3% |
| 50 | 35,4 | 13.813 | 13.823 | 0,1% | **11 ms** | 0 | 29,3% |
| 100 | 67,6 | 45.078 | 61.162 | 26,3% | **80.563 ms** | 27 | 86,8% |
| 200 | 121,6 | 36.210 | 245.407 | 85,2% | 69.530 ms | 159 | 87,5% |
| 400 | 244,0 | 36.617 | 980.543 | 96,3% | 66.802 ms | 384 | 92,7% |

**Sala de até 50 é perfeita.** A entrega bate com o teórico casa a casa, perda de 0,1%, ack de
11 ms, CPU em 29%. Nenhum sinal de esforço.

**O teto de entrega é de 36 a 45 mil quadros por segundo.** Acima disso o processo não escreve
mais, independente da demanda: a sala de 400 pede 980 mil por segundo e recebe os mesmos 36 mil da
sala de 200.

**Não existe degradação suave. É um precipício.** De 50 para 100 pessoas o ack sai de 11 ms para
80 segundos, um fator de 7.300. As três réguas quebram no mesmo degrau: 26,3% de perda de cursor,
80 s de ack e 27 sockets derrubados.

### 2.5 A quantidade de sockets (E10)

O eixo ortogonal. Salas de duas pessoas, quantidade crescendo, fan-out no mínimo possível:

| salas | sockets | ops/s | cursor env/s | perda | **ackP50** | derrubados | CPU | pgLock | RSS |
|---|---|---|---|---|---|---|---|---|---|
| 50 | 100 | 68,8 | 565 | 0% | **5 ms** | 0 | 11,8% | 1 | 215 MB |
| 100 | 200 | 134,2 | 1.135 | 0% | **6 ms** | 0 | 17,1% | 0 | 223 MB |
| 250 | 500 | 336,4 | 2.855 | 0% | **8 ms** | 0 | 34,9% | 0 | 226 MB |
| 500 | 1.000 | 661,7 | 5.754 | 0,1% | **12 ms** | 0 | 60,5% | 1 | 227 MB |
| 1.000 | 2.000 | 1.209,1 | 11.789 | 26,0% | **69.718 ms** | 476 | 96,9% | 1 | 776 MB |

**Mil sockets funcionam perfeitamente.** Ack de 12 ms, zero derrubados, CPU em 60,5%.

**Dois mil quebram.** CPU em 96,9%, ack de 70 segundos, 476 derrubados, e o RSS salta de 227 para
776 MB. O salto de memória é a fila de saída acumulando.

**A fila do advisory lock nunca se forma.** `pgLock` fica entre 0 e 1 em todos os degraus,
inclusive no que escreve 1.209 ops/s, a maior taxa de toda a investigação. Com a escrita espalhada
por mil atlas, o lock não tem em quem enfileirar.

**O custo por socket é real e independente do fan-out.** A CPU sobe de 11,8% para 60,5% entre 100 e
1.000 sockets, com tráfego de mensagens comparável ao da sala de 50 do E9, que custou 29,3%.
Socket aberto custa, mesmo quase parado.

### 2.6 A medida que quase virou conclusão errada

Na cadência de trabalho com mil usuários, o servidor reportou:

| medida | valor |
|---|---|
| ocupação do laço principal | 0,1% (478 ms ativos em 420 s) |
| CPU do processo | 418.485 ms em 420.285 ms, ou **99,6% de um núcleo** |
| repartição | 137 s de usuário, **281 s de sistema** |

As duas estão certas e medem coisas diferentes. O servidor esteve no talo, e quase nada passou pelo
laço de eventos do JavaScript. Dois terços do tempo são kernel: escrita em socket, executada fora
da thread principal.

**Consequência prática.** Otimizar serialização ou o `JSON.stringify` do fan-out renderia pouco. O
custo está no NÚMERO de escritas em socket. Só há dois jeitos de mexer nisso: mandar menos quadros,
ou mandar para menos gente.

*Ressalva: no Windows a divisão entre thread principal e IOCP pode não ser a mesma do Linux. O
total de CPU é comparável; a repartição, não necessariamente.*

### 2.7 O que a investigação ensinou sobre medir

Três erros de instrumento foram cometidos e corrigidos. Ficam registrados porque cada um produziu,
antes da correção, uma tabela com cara de resultado.

**O driver era o gargalo, e a bancada não sabia.** A primeira rodada de mil usuários acusou
`ackP95` de 41 segundos e 191 sockets perdidos, com o servidor ocioso. Eram seis processos de
driver com 167 sockets cada. Hoje cada driver mede o próprio laço e a rodada se declara
`SATURADO` em vez de publicar. Regra: **cerca de 70 sockets por processo de driver**.

**Atraso do laço não é ocupação do laço.** `monitorEventLoopDelay` mede bloqueio. Um laço que
processa trinta mil mensagens curtas por segundo nunca bloqueia, e o histograma marca 16 ms
enquanto o processo queima um núcleo. Demonstrado em bancada sintética: 84,8% de ocupação com p99
de 16 ms.

**O verificador precisa de um caminho independente.** Foi `process.cpuUsage()`, que vem do sistema
operacional, que desmentiu a ocupação do laço. Sem ele a conclusão teria sido "o servidor estava
ocioso", com o servidor no talo.

---

## 3. Problemas

Ordenados por causa, não por sintoma.

### P1. O fan-out de presença é quadrático e satura a E/S (medido)

**A raiz de tudo.** A sala é `atlasId -> Set<WebSocket>`, sem subcanal por mapa. O cursor do
cliente tem throttle de 80 ms, ou 12,5 quadros por segundo por usuário em movimento.

Quadros que o servidor precisa escrever: `S x f x 12,5 x (S - 1)`.

**Dobrar a sala quadruplica o trabalho.** Isso é da forma do desenho. Nenhum ajuste de pool, de
lote ou de compressão muda.

O descarte em si não é defeito: quadro de presença é descartável, e o descarte se auto-cura. O
defeito é o custo pago ANTES de descartar, e o que ele rouba das operações duráveis.

**Limite operacional: 50 pessoas por sala.**

### P2. A contrapressão não degrada suave, ela despenca (medido)

O descarte de presença só age quando o `bufferedAmount` do socket já estourou o teto. A essa
altura, as operações duráveis daquele socket já estão enfileiradas atrás dos quadros descartáveis.

De 50 para 100 pessoas, o ack sai de 11 ms para 80 segundos. Não existe região intermediária onde a
presença degrada e a edição continua fluida.

A contrapressão protege a MEMÓRIA do servidor, que era o objetivo declarado. Ela não protege a
latência do usuário, e nada no desenho hoje faz isso.

### P3. Fome de pool desconecta usuários de outras salas (medido)

A espera pelo advisory lock RETÉM a conexão do pool. Com mil usuários e uma sala de cem,
`pg_stat_activity` mostrou **10 conexões ativas e 9 esperando em `Lock/advisory`**. Sobra uma
conexão para o processo inteiro.

O dano não é óbvio. `reconcileAuthorization` roda a cada varredura de 30 s e consulta o banco. Sem
conexão, ela falha:

```js
ws.authzFailures = (ws.authzFailures || 0) + 1;
if (ws.authzFailures >= AUTHZ_MAX_CONSECUTIVE_FAILURES) {
  ws.close(4003, 'authorization unverifiable');
}
```

**145 sockets derrubados** numa janela de 3 minutos, espalhados por todas as salas, inclusive as de
duas pessoas com carga desprezível.

**A causa é concentração, não volume.** O E10 escreveu 1.209 ops/s espalhadas por mil atlas com
`pgLock` em 1 e zero derrubados. O E8 escreveu metade disso, concentrada, e sequestrou o pool.

### P4. O lote de 100 do cliente encosta no teto do lock (medido, lido)

`FLUSH_BATCH_SIZE = 100` em `frontend/src/js/store/sync/sync-engine.js`. Pela regra do E2, o 503
aparece quando `escritores x lote` passa de ~3.300 ops. Com lote de 100, isso são **33 escritores
simultâneos no mesmo atlas**.

O modo de falha é ruim: uma pessoa cola ou importa muita coisa, e **os outros** levam recusa.

### P5. O frame de erro do socket não diz o que falhou (medido)

Sob contenção, 3 de 16 lotes levaram `OPERATION_FAILED` e 750 ops ficaram em limbo. O frame é
`{ type, code, message }`, sem `opIds` e sem referência ao lote.

Reenviar é seguro por causa da idempotência, mas o cliente não sabe O QUÊ reenviar. Com mais de um
lote em voo, a falha é inatribuível.

O caminho REST não tem esse problema: responde 503 retentável, e o cliente sabe que nada foi
aplicado.

### P6. A janela do heartbeat tem 5 segundos de folga (lido, inferência)

O cliente pinga a cada 25 s (`DEFAULT_HEARTBEAT_MS`). O servidor varre a cada 30 s e **não tem
handler de `pong`**: só o `{type:'ping'}` da aplicação rearma `isAlive`.

Navegador estrangula temporizador de aba em segundo plano para cerca de um por minuto. Se isso
valer aqui, aba em segundo plano é ceifada de forma confiável em até 60 s. Recupera por reconexão,
mas com rotatividade de presença na sala inteira.

Teste que custa cinco minutos: duas abas, deixar uma em segundo plano por 90 s, ver se o socket
cai. **Ainda não feito.**

### P7. `heartbeatSweep` é O(sockets) de banco a cada 30 s (lido)

A varredura re-resolve autorização de TODO socket, com concorrência 4, contra o pool de 10. Com mil
sockets é uma rajada periódica de mil consultas sem relação com o que os usuários fazem. É o
combustível do P3.

### P8. Escala horizontal não existe hoje (lido)

Sala, presença e cursores vivem na memória de UMA instância, sem Redis e sem pub/sub. Dois usuários
do mesmo atlas em processos diferentes não se veem. Todo número deste documento vale para um
processo.

---

## 4. O que podemos agir

Ordenado por impacto sobre custo. Cada item diz o que medir depois, porque decisão sem medida de
volta é decreto.

### A. Agregar quadros de cursor no servidor — impacto decisivo, custo médio

Hoje cada quadro de cursor é retransmitido individualmente para cada par. Em vez disso, acumular
por sala e emitir um lote a cada 100 ms, com a ÚLTIMA posição de cada usuário.

As escritas em socket caem de `S x f x 12,5 x (S-1)` para `S x 10` por segundo. Na sala de 400, de
980.543 para cerca de 4.000, ou seja **um décimo do teto medido**.

Custo de UX: a presença passa de 80 ms para 100 ms de granularidade. Imperceptível.

**É a única ação que sozinha muda o limite de sala de cinquenta para a casa das centenas.**

*Medir depois:* E9 nos mesmos degraus. A previsão é `perdaCursorPct` voltar a zero em todos, e o
ack voltar para a faixa de 10 ms.

### B. Pool dedicado para a varredura de autorização — impacto alto, custo baixo

Dar ao `heartbeatSweep` um pool próprio, pequeno (2 a 3 conexões), separado do pool de escrita. A
fila do advisory lock deixa de poder derrubar sockets.

Ataca o P3 sem tocar no advisory lock. Melhor relação custo-benefício do documento.

*Medir depois:* E8 na cadência de trabalho. `derrubados` deve ir a zero com o mesmo `pgLock`.

### C. Incluir os `opIds` no frame de erro do socket — impacto médio, custo trivial

Uma linha em `collab.handlers.js`. Resolve o P5 e torna o reenvio atribuível.

### D. Alinhar a janela do heartbeat — impacto médio, custo trivial

Subir `WS_HEARTBEAT_INTERVAL_MS` para 60 s, ou baixar o ping do cliente para 10 s. Hoje a margem é
de 5 s, e ela não sobrevive ao estrangulamento de aba em segundo plano.

**Antes de mexer, fazer o teste de aba em segundo plano.** Se a hipótese estiver errada, a mudança
é gratuita e desnecessária.

### E. Baixar `FLUSH_BATCH_SIZE` do cliente — impacto médio, custo baixo

De 100 para 25 tira a sala de 100 pessoas da zona de 503. Custa mais round-trips.

O E2 mediu que o ponto ótimo de vazão é lote de 10 ops (762 ops/s) contra 581 em lote de 100.
**A mudança melhora as duas coisas ao mesmo tempo**, o que é raro o bastante para desconfiar e
medir.

*Medir depois:* E2 com os degraus 10, 25 e 50.

### F. Não reter a conexão enquanto espera o advisory lock — impacto alto, custo alto

Hoje a espera acontece dentro da transação, segurando a conexão. Alternativas:

1. `pg_try_advisory_xact_lock` com re-tentativa fora da transação.
2. Fila por atlas na memória do processo, serializando antes de pegar a conexão.

A segunda ataca a raiz e casa com o desenho atual, já que a sala é estado de processo. A primeira é
menos invasiva e mais barata de reverter.

Mudança de núcleo. Exige decisão registrada em `docs/decisions/`.

### G. Sub-canal por mapa dentro da sala — impacto alto, custo alto

Hoje o filtro por mapa é 100% do cliente. Filtrar no servidor corta o fan-out proporcionalmente ao
número de mapas do atlas.

Vale menos que a ação A e custa mais, porque muda o contrato da sala. Considerar só se A não
bastar.

### H. O que NÃO adianta

- **Subir `DATABASE_POOL_MAX`.** O E4 mostra a curva achatando com o lock já dissolvido, e o E10
  mostra `pgLock` em 1 no cenário de maior escrita. O teto de presença não é banco.
- **Otimizar a serialização do fan-out.** O E5 mostra que ela já é feita uma vez por transmissão, e
  a CPU está em tempo de sistema, não de usuário.
- **Comprimir os quadros.** Aumenta o tempo de usuário para reduzir bytes. O gargalo é o número de
  syscalls, não a banda.

### Sequência recomendada

1. **C** e **D**, triviais e independentes. Antes de D, o teste de aba em segundo plano.
2. **B**, barata, e para o sangramento do P3.
3. **A**, a mudança que importa. Medir com E9 antes e depois.
4. Reavaliar **E**, **F** e **G** com os números novos. É provável que A torne F desnecessária.

---

## 5. O que ainda não foi medido

- O teste de aba em segundo plano do P6.
- A varredura de `DATABASE_POOL_MAX` e de `lock_timeout`, deliberadamente adiada.
- Qualquer cenário com mais de uma instância.
- O caminho binário: upload de imagem e leitura de assets3d sob concorrência.
- O efeito de A a G, que só existe como previsão.

---

## 6. Plano de execução por grupos

Cada grupo é um conjunto coerente de mudanças, uma bancada que o valida, um número de PARTIDA
medido e um ALVO declarado antes de mexer no código. Grupo sem alvo declarado antes vira torcida.

Três regras valem para todos:

1. **A linha de base é congelada antes da primeira mudança.** Comparar contra número lembrado é
   como não comparar.
2. **Controle negativo.** Reverter a mudança e confirmar que a métrica piora de volta. Melhora que
   não some ao reverter não veio da mudança.
3. **A mesma máquina, limpa.** Rodada com outro processo disputando CPU não compara com nada.

---

### Grupo 0 — Congelar a linha de base (pré-requisito)

Os números da seção 2 vieram de versões diferentes da bancada, colhidas enquanto o instrumento
ainda estava sendo consertado. Servem para diagnosticar. **Não servem de referência para medir
melhoria.**

**O que fazer**

- Escrever o comparador: cada bancada grava `tests/bench/baselines/<data>/<cenario>.json`, e uma
  bandeira `--comparar <arquivo>` imprime a variação por coluna.
- Rodar E1, E2, E8 (cadência trabalho, 5 min), E9 e E10 com o código atual, máquina limpa.
- Commitar os JSON.

**Custo:** cerca de 1 hora de trabalho, 50 minutos de máquina.

**Como saber que terminou:** o comparador roda contra a própria linha de base e imprime variação
dentro do ruído em toda coluna.

---

### Grupo 1 — Medir a aba em segundo plano (sem mudar código)

O P6 é a única hipótese do documento sem teste próprio. Ela decide se o Grupo 2 leva a mudança do
heartbeat ou não.

**O que fazer**

Abrir duas abas no mesmo atlas, deixar uma em segundo plano por 90 s, observar se o socket cai.
Repetir cinco vezes, porque uma medida de coisa temporal não é medida.

**Alvo:** responder sim ou não. Não há código a mudar aqui.

**Se der não:** o item D sai do plano, e a economia é o próprio resultado.

---

### Grupo 2 — Higiene do socket (barato, independente)

**O que muda**

- `opIds` no frame de erro do socket (`collab.handlers.js`), resolvendo o P5.
- Se o Grupo 1 confirmar: `WS_HEARTBEAT_INTERVAL_MS` de 30 s para 60 s, resolvendo o P6.

**Mudança na bancada, necessária antes:** hoje o `escritorWs` conta toda op de um lote com erro
como sem veredito, porque não tem como saber quais falharam. Com os `opIds` no frame, ele passa a
atribuir. Sem essa mudança a melhoria fica invisível.

**Bancada:** E3 forçado, `--escritores 16 --lotes 1 --ops 250`.

| métrica | partida | alvo |
|---|---|---|
| ops inatribuíveis no caminho WS | 750 | **0** |
| ops sem veredito no caminho REST | 500 | 500, inalterado |
| P2 (sem veredito, sem escrita) | OK | OK |

**Controle negativo:** remover os `opIds` do frame e confirmar que as 750 voltam a ficar
inatribuíveis.

---

### Grupo 3 — Isolar a varredura de autorização

**O que muda**

Pool próprio, de 2 a 3 conexões, para `reconcileAuthorization`, separado do pool de escrita. A fila
do advisory lock deixa de poder derrubar socket.

**Bancada:** E8, cadência trabalho, 5 min, 14 trabalhadores.

| métrica | partida | alvo |
|---|---|---|
| sockets derrubados | 145 | **0** |
| conexões esperando lock | 9 | 9, inalterado |
| ack mediano | 39.606 ms | continua ruim, e isso é esperado |

**A leitura que importa:** este grupo NÃO conserta a latência. Ele impede que a fila de escrita
desconecte quem não tem nada com ela. Se o ack melhorar junto, alguma premissa está errada e vale
investigar antes de comemorar.

**Controle negativo:** devolver a varredura ao pool comum e confirmar que os derrubados voltam.

---

### Grupo 4 — Agregar quadros de cursor (a mudança que importa)

**O que muda**

O servidor deixa de retransmitir cada quadro de cursor. Ele acumula por sala e emite, a cada
100 ms, um lote com a ÚLTIMA posição de cada usuário.

**Cruza os dois pacotes.** O cliente precisa entender o frame novo. Pela constituição do repo, a
mudança é verificada dos dois lados no mesmo commit, e o contrato novo entra em
`docs/decisions/decisions-2026.md`.

**Mudança na bancada, necessária antes:** o usuário virtual conta `cursoresRecebidos` por frame. Com
o lote, ele precisa contar por POSIÇÃO dentro do lote. Sem isso, a perda de cursor vai ler 99% e a
bancada vai acusar uma regressão que não existe.

**Bancada:** E9, mesmos degraus (10, 25, 50, 100, 200, 400).

| sala | métrica | partida | alvo |
|---|---|---|---|
| 100 | perda de cursor | 26,3% | **0%** |
| 100 | ack mediano | 80.563 ms | **< 50 ms** |
| 100 | CPU | 86,8% | **< 40%** |
| 100 | derrubados | 27 | **0** |
| 200 | derrubados | 159 | **0** |
| 400 | perda de cursor | 96,3% | **< 5%** |
| 400 | ack mediano | 66.802 ms | **< 200 ms** |

**Base do cálculo:** a sala de 400 passa a pedir cerca de 4.000 quadros por segundo, contra
980.543 hoje. É um décimo do teto medido de 40 mil.

**Controle negativo:** bandeira que desliga a agregação, e a tabela volta aos números de partida.

**Se o alvo não for atingido**, a hipótese central do documento está errada, e o próximo suspeito é
o custo por socket que o E10 isolou.

---

### Grupo 5 — Lote do cliente

Só depois do Grupo 4, porque o teto de sala muda e a conta do 503 muda junto.

**O que muda:** `FLUSH_BATCH_SIZE` de 100 para 25.

**Bancada:** E2, `--escritores 8 --tamanhos 10,25,50,100`.

| métrica | partida | alvo |
|---|---|---|
| vazão em lote de 25 | não medida | **maior que os 581 ops/s do lote de 100** |
| escritores até o primeiro 503 | 33 | **> 100** |

**Controle negativo:** voltar para 100 e confirmar que a zona de 503 desce.

---

### Grupo 6 — Reavaliar o advisory lock

**Não começar por aqui.** Depois dos grupos 3 e 4, remedir E1 e E8 e decidir se o problema ainda
existe. É provável que não valha o custo.

Se valer, a alternativa preferida é a fila por atlas na memória do processo, que serializa antes de
pegar a conexão. Mudança de núcleo, com decisão registrada.

---

### Ordem e custo

| grupo | risco | máquina | validado por |
|---|---|---|---|
| 0, linha de base | nenhum | 50 min | o próprio comparador |
| 1, aba em segundo plano | nenhum | 10 min | observação, cinco repetições |
| 2, higiene do socket | baixo | 5 min | E3 forçado |
| 3, pool da varredura | baixo | 10 min | E8 trabalho |
| 4, agregar cursor | **alto** | 20 min | E9 completo |
| 5, lote do cliente | baixo | 5 min | E2 |
| 6, advisory lock | alto | 30 min | E1 e E8 |

Os grupos 0 a 3 são independentes entre si e podem ir em qualquer ordem. O 4 é o que muda o
produto, e os 5 e 6 só fazem sentido depois dele.

---

## 7. Como reproduzir

Detalhe em `backend/tests/bench/README.md`. Resumo:

```bash
cd backend
export BENCH_ADMIN_DATABASE_URL='postgresql://<super>:<senha>@localhost:5432/postgres'

node tests/bench/escrita-contencao.bench.mjs                                 # E1
node tests/bench/populacao-1000.bench.mjs --cadencias trabalho --trabalhadores 14
node tests/bench/sala-limite.bench.mjs --trabalhadores 14                    # E9
node tests/bench/sala-quantidade.bench.mjs --trabalhadores 14                # E10
```

Três regras de que o resultado depende:

- **Cerca de 70 sockets por processo de driver.** Mil usuários pedem 14 trabalhadores, não 6.
- **Rodada com `INSTRUMENTO SATURADO` não deve ser lida.** A tabela mede o driver.
- **Máquina limpa.** Um `npm run dev` ou um Playwright em paralelo disputa CPU, banco e porta.
