# Capacidade de uma instância

Quantas pessoas cabem num processo do backend, medido em bancada, e qual eixo quebra primeiro. Números de [`backend/tests/bench/`](../../backend/tests/bench/README.md), que é onde mora o MÉTODO; aqui fica o RESULTADO e o que ele obriga a decidir.

**Medição válida:** 2026-08-27 (linha de base) e 2026-08-28 (depois do agrupamento de cursor), máquina livre, com a sonda de ambiente declarando isso em cada rodada. Windows 11, 20 CPUs, 15,6 GB, PostgreSQL 18.1 local, `DATABASE_POOL_MAX` = 10 e `lock_timeout` de 5 s, tudo no padrão. Nenhum parâmetro foi varrido.

Todo número desta página vale para **um processo**. Sala, presença e cursor vivem na memória dele, sem Redis e sem pub/sub. Ver [[presenca-colaborativa]] e [[deploy-backend]].

## O achado: o que quebra é a concentração, não a quantidade

Dois cenários do mesmo dia, na mesma máquina, medem eixos ORTOGONAIS e dão respostas opostas:

| | mil duplas | população real |
|---|---|---|
| sockets | **2.000** | 1.000 |
| ops/s escritas | 1.235 | 616 |
| maior sala | 2 pessoas | **100 pessoas** |
| perda de presença | ~0% | 21% a 76% |
| sockets derrubados | 0 | 138 |

O dobro dos sockets e o dobro da escrita, com zero perda. O que separa os dois é o tamanho da maior sala, e a razão é a forma do desenho: a sala é `atlasId -> Set<WebSocket>` sem subcanal por mapa ([[sintese-limites-collab]] §1), então dobrar a sala QUADRUPLICA o trabalho de transmissão. Nenhum ajuste de pool, de lote ou de compressão muda isso.

## Os quatro tetos

| limite | valor | o que acontece ao cruzar |
|---|---|---|
| **Pessoas por sala** | **200** | Em 400, o ack mediano vai a 89 s |
| **Sockets no processo** | **2.000**, teto não encontrado | Em 2.000 a CPU está em 95% e nada quebrou |
| Escrita num atlas | ~1.100 ops/s | Fila do advisory lock: 503 quando `escritores x lote` passa de ~4.000 ops |
| Quadros de socket | ~60 mil/s | O máximo já observado, na sala de 100 antes do agrupamento |

**Aguenta com folga:** mil usuários em salas de até duzentas pessoas.
**Não aguenta:** uma sala de quatrocentas.

O limite de sala era **cinquenta** até 2026-08-28, quando o cursor passou a sair em lote por sala (decisão em [`../decisions/decisions-2026.md`](../decisions/decisions-2026.md)). A sala de 200 foi de ack de 84.961 ms e 147 sockets derrubados para 34 ms e zero; a de 100 ficou indistinguível da de 50. A de 400 continua com 89 s: ela deixou de ser limitada por syscall e passou a ser limitada por carga útil, e esse teto **não foi medido**.

## O que a carga CONFIRMOU, e que vale mais que os tetos

Latência é descritiva na bancada; correção é que reprova. Toda rodada termina comparando o que o servidor DISSE com o que o ledger TEM, numa conexão nova. Oito propriedades que a documentação afirmava e que passaram a ter medida:

| propriedade | evidência |
|---|---|
| O advisory lock cumpre o que promete | 40.000 ops, 8 escritores, cursor incremental sem perder nenhuma |
| O rollback é limpo | Toda op sem veredito ficou ausente do ledger, nos dois caminhos |
| Idempotência funciona | 800 ops reenviadas absorvidas, sem versão nova nem linha duplicada |
| Convergência LWW correta sob contenda | Zero divergentes, e contenda de linha custa zero |
| O ledger não degrada com o tamanho | Latência estável de 8 mil a 40 mil linhas por atlas |
| Fan-out serializa uma vez, não por destinatário | 0 para 10 ouvintes custa 21%, 10 para 40 custa zero |
| Socket sobrevive à expiração do token | `reconcileAuthorization` re-resolve permissão, não reverifica o JWT |
| **Nenhuma op foi perdida em nenhum cenário** | A reconciliação passou em todas as rodadas válidas |

**Nenhum dos tetos desta página é perda de dado.** Eles são latência e descarte de PRESENÇA, que é descartável por desenho ([[presenca-colaborativa]]). A ordem em que as réguas quebram é parte do resultado: perda de cursor bem antes de atraso de entrega significa que o desenho está se protegendo como pretendido, e as duas subindo juntas significa que não está.

## A escrita é plana por atlas, e a latência é que paga

`pushOperations` (`backend/src/modules/sync/sync.service.js`) toma `pg_advisory_xact_lock` por atlas antes do primeiro INSERT do lote, então a escrita num mesmo atlas é serializada. Dezesseis vezes mais escritores rendem 29% mais vazão, e o custo sai em latência, que cresce linearmente. A partir de dezesseis escritores num único atlas as conexões chegam a dez, que é o pool inteiro.

O serviço custa cerca de **1,26 ms por op**, e daí sai a regra do 503: a fila do enésimo escritor é `escritores x lote x 1,26 ms`, e cruza os 5 s do `lock_timeout` quando o produto passa de ~4.000 ops. O modo de falha é ruim, e é a razão de `FLUSH_BATCH_SIZE` ter caído para 25: uma pessoa cola ou importa muita coisa, e **os outros** levam recusa.

O ponto ótimo de lote é baixo. Lote de 10 rende ~1.020 ops/s, lote de 100 rende 753 e lote de 1 rende 531. Entre atlas a vazão escala de verdade: 32 escritores em 1, 4 e 16 atlas dão 814, 2.466 e 3.456 ops/s, ou seja o lock é mesmo por atlas.

## Onde a CPU está, e por que quase toda otimização de fan-out não paga

Com mil usuários na cadência de trabalho, o servidor reportou ocupação de laço de eventos de **0,1%** e, ao mesmo tempo, 98% de um núcleo de CPU, com **dois terços em tempo de sistema**. As duas medidas estão certas e medem coisas diferentes: quase nada passa pelo laço do JavaScript, porque o custo é escrita em socket, executada fora da thread principal.

A consequência dirige a escolha de conserto. Otimizar serialização, `JSON.stringify` ou compressão renderia pouco, porque o gargalo é o NÚMERO de escritas em socket, não a banda nem o tempo de usuário. Só há dois jeitos de mexer nisso: **mandar menos quadros, ou mandar para menos gente**. O agrupamento de cursor é o primeiro; o subcanal por mapa, que não existe, seria o segundo.

*Ressalva medida: no Windows a divisão entre thread principal e IOCP pode não ser a mesma do Linux. O total de CPU é comparável; a repartição, não necessariamente.*

## O que a saturação faz com o usuário, na ordem em que dói

A contrapressão protege a MEMÓRIA do servidor, e essa é a garantia que ela dá. Ela **não protege a latência de quem edita**, e nada no desenho hoje faz isso: na sala de 100 antes do agrupamento, o ack mediano ia de 16 ms para 3.844 ms com perda de presença de apenas 1,7% e zero sockets derrubados. Nenhuma régua de alarme disparava, e a pessoa esperava quatro segundos para ver a própria edição confirmada. Ao dimensionar sala, o número que dói primeiro é o ack, não a perda.

**E o sistema atravessava a saturação DESCONECTANDO gente em silêncio.** A varredura de vivacidade terminava todo socket que não tivesse rearmado a marca, e sob saturação de CPU o ping do cliente chega tarde: um cliente que manda doze quadros de cursor por segundo era, para a varredura, indistinguível de um cliente morto. Ao ceifar 156 sockets ela removia 16% da população, e os sobreviventes recebiam serviço decente. Consertada a vivacidade (ver [[canal-collab-websocket]]), os derrubados foram a zero e o ack sob saturação subiu de 72 ms para 114 s. **O conserto não melhora desempenho: ele troca desconexão invisível por latência visível**, e o custo é zero até 50 pessoas por sala, ou seja o dano começa onde o sistema já estava fora do limite. Ninguém projetou aquele descarte de carga, e é o tipo de coisa que só aparece quando o conserto certo a remove.

## O que NÃO foi medido, e continua aberto

- **A sala de 400**, cujo teto novo é de carga útil e não de syscall.
- **Reavaliar o advisory lock** depois do agrupamento. Não reter a conexão enquanto se espera o lock (`pg_try_advisory_xact_lock` com re-tentativa fora da transação, ou fila por atlas na memória) é mudança de núcleo, e é provável que já não valha o custo. Remedir antes de decidir.
- **A varredura de `DATABASE_POOL_MAX` e de `lock_timeout`**, adiada de propósito: mexer neles é decisão a registrar, não bandeira de bancada.
- **O teto de sockets**, que em 2.000 ainda não apareceu.
- **Qualquer cenário com mais de uma instância.**
- **O caminho binário:** upload de imagem e leitura de assets 3D sob concorrência.
- **O lado CLIENTE do heartbeat.** `frontend/src/js/store/sync/ws-client.js` fecha com 4000 se um `pong` ficar pendente de um tique para o outro, e essa regra continua de pé. Inferência não medida: se o navegador CONGELAR a página logo depois de um ping, ela acorda com o pong pendente e fecha sozinha. Aba com conexão aberta costuma ser isenta de congelamento, e por isso não se mexeu aqui.

## Três coisas que o número não diz sozinho

- **Toda medição aqui vale para o padrão de produção com os limitadores DESLIGADOS** (`NODE_ENV=test` pula `backend/src/middleware/rate-limit.js`) e o log calado. O custo por requisição do log de produção está fora destes números.
- **Máquina ocupada inverte conclusão.** A primeira versão deste diagnóstico afirmou que mil sockets era o teto e que a entrega máxima era 45 mil quadros/s; as duas eram artefato de ambiente, e a repetição controlada deu 2.000 sockets e 60.636 quadros/s. A bancada hoje declara o ambiente em cada rodada, e a que sair `MAQUINA OCUPADA` não deve ser lida.
- **Porcentagem sozinha mente quando o absoluto é pequeno.** O comparador da bancada usa banda DUPLA: 20% **e** um piso absoluto por unidade (50 ms para latência, 2 pontos para percentual, 5 para contagem). Sem o piso, duas rodadas idênticas imprimem dezoito regressões, uma delas de "+59,5%" sobre 22 ms.

## Relacionados

[[sintese-limites-collab]] · [[presenca-colaborativa]] · [[canal-collab-websocket]] · [[fila-operacoes-outbound]] · [[tabela-operations]] · [[qualidade-conexao-adaptativa]] · [[deploy-backend]]
