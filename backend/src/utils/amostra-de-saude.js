// Path: src/utils/amostra-de-saude.js
/**
 * @fileoverview A AMOSTRA PERIÓDICA DE SAÚDE: uma linha de log estruturada, em intervalo
 * configurável, dizendo se o processo está no ar e como ele está por dentro.
 *
 * POR QUE ELE EXISTE. `GET /api/v1/health` responde a quem PERGUNTA, e nesta instalação não
 * há orquestrador nem monitor externo perguntando: rede fechada, um desenvolvedor, e boa
 * parte da operação feita por um agente. Sem alguém perguntando, a resposta nunca existe, e
 * o que se sabe do servidor de ontem à noite é nada. Esta é a metade que pergunta sozinha e
 * deixa rastro no mesmo `.jsonl` diário que o resto do log (`log-diario.js`), para que o
 * relatório e a tela do painel possam ler depois sem nenhuma infraestrutura nova.
 *
 * O LIMITE, E ELE É O PRIMEIRO PARÁGRAFO DE PROPÓSITO: **um amostrador DENTRO do processo
 * não consegue testemunhar a própria morte.** Se o processo é morto pelo OOM killer, se o
 * event loop trava, se a máquina reinicia, não sai amostra nenhuma dizendo isso — sai
 * SILÊNCIO. O que revela a queda é o BURACO na série (a distância entre duas amostras
 * consecutivas maior que o intervalo), nunca uma amostra confessando. Quem for escrever o
 * relatório ou a tela em cima disto: a pergunta certa é "quantas amostras faltaram e
 * quando", não "alguma amostra disse que caiu". Nenhuma vai dizer. Um monitor externo (um
 * `curl` no `/health` a partir de outra máquina) é a única coisa que testemunha a morte, e
 * ele não existe aqui; esta camada não substitui aquilo e não promete substituir.
 *
 * O BURACO NA SÉRIE TINHA DUAS CAUSAS E UMA ASSINATURA SÓ, e é isso que o campo `disco`
 * desfaz. Quando o disco enche, `log-diario.js` DESLIGA o destino de arquivo e avisa uma vez
 * no stderr, que num container não sobrevive a ninguém. Da segunda amostra em diante a série
 * some do `.jsonl`, exatamente como se o processo tivesse morrido: o `npm run diag -- saude`
 * conta os mesmos buracos e a wiki manda lê-los como queda. Ou seja, a ÚNICA pergunta que
 * esta camada existe para responder tinha duas respostas possíveis e nenhum meio de
 * separá-las. Publicar o espaço livre do volume onde mora o `LOG_DIR` é o que separa: a
 * amostra ANTERIOR ao buraco diz se o disco estava acabando. Se dizia, o buraco é o destino
 * de arquivo desligado e o processo pode estar vivo e servindo; se não dizia, o buraco é o
 * que a wiki afirma. A leitura é sempre da amostra anterior, nunca da que falta, porque a
 * amostra que falta é justamente a que não existe.
 *
 * De todas as métricas que faltam aqui (atraso de event loop, ocupação de CPU e outras), esta
 * é a única que foi acrescentada, e o critério não é a utilidade: é que só ela produzia sinal
 * AMBÍGUO. As outras faltavam produzindo sinal NENHUM, que é um buraco de cobertura honesto;
 * um instrumento cuja saída tem dois significados é pior que um instrumento ausente, porque
 * ele é lido com confiança.
 *
 * AS QUATRO PROPRIEDADES QUE ELE PRECISA TER, cada uma com teste próprio:
 *
 * 1. **Nunca ser o motivo de uma queda.** Ele roda em timer, fora de toda requisição, então
 *    uma exceção que suba daqui não tem quem a pegue: vira `unhandledRejection` e, no Node
 *    22, derruba o processo. Um amostrador de saúde que MATA o servidor é a piada mais cara
 *    possível. Toda falha é engolida e vira uma linha `falhou: true` com o mesmo marcador —
 *    porque a falha do amostrador também é dado, e enterrá-la em silêncio seria trocar um
 *    modo de falha ruidoso por um mudo.
 * 2. **O timer é `unref()`.** Um `setInterval` referenciado segura o event loop, e o processo
 *    deixa de terminar sozinho: o `npm test` penduraria depois do último caso, sem nada na
 *    saída explicando o quê. Foi o mesmo cuidado que o `forceExit` de `src/index.js` e o
 *    prazo do `/health` já tomam.
 * 3. **A sonda ao banco tem PRAZO PRÓPRIO**, pela mesma razão escrita por extenso no
 *    comentário do `/health` em `src/app.js`: o pool é construído sem
 *    `connectionTimeoutMillis` e sem `statement_timeout`, então um `SELECT 1` com o pool
 *    esgotado nem resolve nem rejeita — ele fica na fila. Sem o prazo, a amostra desapareceria
 *    exatamente no incidente que ela existe para testemunhar, e cada amostra ainda
 *    ENFILEIRARIA mais um esperando no pool exausto. Com o prazo, o incidente vira uma linha
 *    `banco: { ok: false, motivo: 'prazo' }`, que é o dado.
 * 4. **Ele não sobe em teste**, por gate de ambiente (`deveAmostrar`), no mesmo espírito do
 *    log em arquivo e do SyncLedger. A suíte não pode ganhar um timer nem tráfego de pool
 *    que ninguém pediu.
 *
 * FORMATO DA LINHA. Um marcador estrutural, `amostra: 'saude'` (`MARCADOR_AMOSTRA`), e não
 * uma mensagem de texto: quem consultar filtra por campo, como `fundirPorRequisicao` faz em
 * `diag-consulta.js`, porque casar pela `msg` deixaria o relatório calado e correto na
 * aparência no dia em que alguém reescrevesse a frase.
 *
 * O NÍVEL DA LINHA É CONTRATO COM O RELATÓRIO, não estilo: `ehErro` (`diag-consulta.js`)
 * só reconhece um registro como erro por `level >= 50`, por ter `err` ou por
 * `statusCode >= 400`, e a amostra não tem os dois últimos. Por isso banco fora sai em
 * `error` e a amostra saudável fica em `info`. O porquê, a alternativa recusada e o que
 * acontece com `prazo` estão no comentário do ponto de emissão, em `amostrarAgora`.
 *
 * REGRA ÚNICA DE CAMPO AUSENTE: um campo que não pôde ser medido **não aparece** na linha.
 * Uma convenção só para a linha inteira (em vez de `null` num campo e ausência noutro) é o
 * que permite ao leitor concluir "não foi possível medir" sem consultar tabela nenhuma.
 * Hoje isso vale para `pool` (se o objeto do pg mudar de forma), para `sockets` (que só
 * existe quando quem monta o amostrador tem o `WebSocketServer` em mãos) e para `disco`.
 *
 * No `disco` a regra deixa de ser convenção e vira correção: zero byte livre é um valor
 * LEGÍTIMO, e é o mais alarmante que o campo pode carregar. Publicar zero para dizer "não
 * consegui medir" inverteria o alarme, e inverteria justo na direção que produz a leitura
 * errada mais cara possível, um disco saudável se declarando cheio no meio de um incidente.
 * É por isso que `descreverDisco` recusa a medição inteira em vez de aparar campo a campo.
 */

/**
 * O marcador da linha. Exportado como SÍMBOLO para que o relatório e a tela filtrem por ele
 * em vez de digitar a string, que é como as duas pontas divergem sem nada ficar vermelho.
 */
export const MARCADOR_AMOSTRA = 'saude';

/** A mensagem do pino. Cosmética: a filtragem é pelo campo acima, nunca por aqui. */
export const MSG_AMOSTRA = 'amostra de saúde';

const BYTES_POR_MB = 1024 * 1024;

/**
 * O prazo default da medição de disco, em ms. Curto de propósito: ver `criarMedidorDeDisco`.
 * Ele NÃO vem de `config.js` porque quem monta o amostrador passa o que quiser; o default é a
 * segunda amarra, para o uso programático que não passa pelo boot, como em `deveAmostrar`.
 */
export const PRAZO_DISCO_MS_PADRAO = 2000;

/**
 * Descreve o pool de conexões a partir do objeto do `pg-pool` (`db.$pool` do pg-promise).
 *
 * Puro e defensivo: `$pool` é um interno de biblioteca, e uma atualização que mude os nomes
 * dos contadores deve produzir a AUSÊNCIA do campo (regra única acima), nunca `NaN` numa
 * série temporal, que é o valor que estraga um gráfico e uma média sem parecer errado.
 *
 * `esperando` é o número que importa num incidente: total e ocioso descrevem o repouso, mas
 * quem espera na fila é a assinatura do pool esgotado, que é o modo de falha que a
 * propriedade (3) do cabeçalho descreve.
 *
 * @param {{totalCount?: number, idleCount?: number, waitingCount?: number, options?: {max?: number}}} pool
 * @returns {{emUso: number, ocioso: number, total: number, esperando: number, max: number}|null}
 */
export function descreverPool(pool) {
  if (!pool) return null;
  const total = pool.totalCount;
  const ocioso = pool.idleCount;
  const esperando = pool.waitingCount;
  if (!Number.isFinite(total) || !Number.isFinite(ocioso) || !Number.isFinite(esperando)) {
    return null;
  }
  const max = pool.options && Number.isFinite(pool.options.max) ? pool.options.max : undefined;
  const descricao = { emUso: total - ocioso, ocioso, total, esperando };
  if (max !== undefined) descricao.max = max;
  return descricao;
}

/**
 * Memória do processo, em MB inteiros.
 *
 * Arredondado porque a série é para leitura humana e de agente: byte a byte não distingue
 * nada em nenhuma escala de tempo que interesse aqui, e enche a linha.
 * @param {{heapUsed?: number, rss?: number}} uso - saída de `process.memoryUsage()`
 * @returns {{heapMb: number, rssMb: number}|null}
 */
export function descreverMemoria(uso) {
  if (!uso || !Number.isFinite(uso.heapUsed) || !Number.isFinite(uso.rss)) return null;
  return {
    heapMb: Math.round(uso.heapUsed / BYTES_POR_MB),
    rssMb: Math.round(uso.rss / BYTES_POR_MB),
  };
}

/**
 * Descreve o sistema de arquivos onde mora o `LOG_DIR`, a partir da saída de `fs.statfs`.
 *
 * QUE CAMPOS SAEM, E POR QUÊ SÃO DOIS. A pergunta que este campo precisa responder é "o log
 * vai parar de escrever em breve, e por isso a série pode sumir sem o processo ter morrido".
 * `livreMb` sozinho não a responde: 800 MB livres é folga num volume de 20 GB e é véspera de
 * incidente num de 2 TB, e quem lê a linha meses depois não tem como saber qual dos dois era.
 * `totalMb` é a escala que falta, e com os dois o leitor deriva o que quiser.
 *
 * A FRAÇÃO FOI RECUSADA, embora `descreverPool` publique um derivado (`emUso`). Dois motivos:
 * ela é subtração de dois números que já estão na linha, ao contrário de `emUso`, que nomeia
 * um estado sem outro nome; e ela é o derivado ERRADO para esta pergunta, porque o que decide
 * se o log para de escrever é o número ABSOLUTO de MB que a rotação ainda precisa, não uma
 * proporção. Uma fração arredondada a inteiro ainda perderia resolução exatamente na faixa
 * perigosa, onde 0% cobre de 0 a 5 GB num volume grande.
 *
 * `bavail` E NÃO `bfree`, medido: no Windows os dois são iguais, no Linux `bfree` inclui a
 * reserva do root, que o processo do servidor não pode gastar. Publicar `bfree` anunciaria
 * uma folga que o escritor do log não tem, e o erro sairia na direção de tranquilizar.
 *
 * `files`/`ffree` (inodes) FICAM DE FORA, e a razão é a regra de campo ausente do cabeçalho:
 * medido nesta plataforma, o Windows devolve ZERO nos dois, não porque acabaram, mas porque
 * o conceito não existe ali. Publicá-los faria toda amostra do Windows anunciar "zero inodes
 * livres", que é o alarme máximo, com valor de aparência plausível. Esgotamento de inode com
 * bytes de sobra é modo de falha real no Linux e continua SEM cobertura aqui, declarado.
 *
 * `type` também sai: é 0 no Windows e não carrega decisão nenhuma.
 *
 * Puro e defensivo pela mesma razão de `descreverPool`, com uma amarra a mais: `bsize` zero
 * (que uma forma inesperada produziria) zeraria os dois produtos e a linha diria "disco
 * cheio". Por isso a recusa é da medição INTEIRA, e é `null` que sai daqui.
 *
 * @param {{bsize?: number, blocks?: number, bavail?: number}|null} estatistica - saída de `fs.statfs`
 * @returns {{livreMb: number, totalMb: number}|null}
 */
export function descreverDisco(estatistica) {
  if (!estatistica) return null;
  const { bsize, blocks, bavail } = estatistica;
  if (!Number.isFinite(bsize) || !Number.isFinite(blocks) || !Number.isFinite(bavail)) {
    return null;
  }
  // Zero e negativo não são medições, são formas quebradas: ver o parágrafo do `bsize` acima.
  if (bsize <= 0 || blocks <= 0 || bavail < 0) return null;

  const livre = bsize * bavail;
  const total = bsize * blocks;
  // `isSafeInteger` cobre de uma vez o finito, o inteiro e o teto de precisão do double. Ele
  // recusa volume acima de ~9 PB, e recusar é o desfecho certo: acima disso a aritmética já
  // não é exata, e número inexato numa série é o que estraga média e gráfico sem parecer
  // errado. `livre > total` pega a forma incoerente que nenhum dos testes acima pegaria.
  if (!Number.isSafeInteger(livre) || !Number.isSafeInteger(total) || livre > total) {
    return null;
  }

  return {
    livreMb: Math.round(livre / BYTES_POR_MB),
    totalMb: Math.round(total / BYTES_POR_MB),
  };
}

/**
 * Roda a consulta de sonda com um prazo PRÓPRIO e devolve o desfecho, nunca uma exceção.
 *
 * São TRÊS desfechos, e distingui-los é o ponto: `ok` (com a latência, que é metade do
 * valor da amostra), `motivo: 'erro'` (o banco respondeu que não dá — ECONNREFUSED, senha,
 * banco derrubado) e `motivo: 'prazo'` (não respondeu nada dentro do prazo — pool esgotado,
 * pacote sendo descartado). Colapsar os dois últimos em "banco fora" apagaria justamente a
 * diferença entre "o Postgres caiu" e "o Postgres está de pé e o nosso pool está entupido",
 * que pedem providências opostas.
 *
 * O `ms` sai também nos dois desfechos ruins: quanto tempo se esperou antes de desistir é
 * dado, e no caso do prazo é a única medida que existe.
 *
 * O temporizador é injetável para que o teste do prazo seja DETERMINÍSTICO, e não uma espera
 * real: teste que dorme é teste que flakeia. Ele é `unref`ado pelo mesmo motivo do timer
 * principal — este aqui vive por segundos, mas segundos são suficientes para atrasar o fim
 * do processo justo no desligamento.
 *
 * @param {Object} opts
 * @param {() => Promise<unknown>} opts.consultar - a ida ao banco (ex.: `() => one('SELECT 1')`)
 * @param {number} opts.prazoMs
 * @param {() => number} [opts.agora] - relógio injetável
 * @param {(fn: Function, ms: number) => any} [opts.agendar]
 * @param {(id: any) => void} [opts.cancelar]
 * @returns {Promise<{ok: boolean, ms: number, motivo?: 'erro'|'prazo', erro?: string}>}
 */
export async function sondarBancoComPrazo({
  consultar,
  prazoMs,
  agora = () => Date.now(),
  agendar = setTimeout,
  cancelar = clearTimeout,
}) {
  const inicio = agora();
  let id = null;
  const marcaPrazo = Symbol('prazo');

  try {
    const resultado = await Promise.race([
      consultar(),
      new Promise((resolve) => {
        id = agendar(() => resolve(marcaPrazo), prazoMs);
        // O prazo NUNCA pode segurar o event loop: ver a propriedade (2) do cabeçalho.
        if (id && typeof id.unref === 'function') id.unref();
      }),
    ]);
    if (resultado === marcaPrazo) {
      return { ok: false, ms: agora() - inicio, motivo: 'prazo' };
    }
    return { ok: true, ms: agora() - inicio };
  } catch (err) {
    return {
      ok: false,
      ms: agora() - inicio,
      motivo: 'erro',
      erro: err && err.message ? String(err.message) : String(err),
    };
  } finally {
    cancelar(id);
  }
}

/**
 * Cria o medidor de disco: uma função que devolve a saída crua de `fs.statfs`, ou `null`, e
 * NUNCA rejeita nem lança. O `null` vira ausência do campo, pela regra do cabeçalho.
 *
 * TEM PRAZO PRÓPRIO, pela mesma razão da propriedade (3), e a razão aqui é ainda mais direta:
 * `statfs` é uma chamada de sistema ao VOLUME, e num volume de rede (um NFS ou um SMB
 * pendurado, que é cenário plausível para um diretório de log) ela não retorna nem falha, ela
 * espera. Sem prazo, a amostra inteira ficaria pendurada atrás do campo novo, e o campo que
 * existe para explicar buracos na série passaria a ABRIR buracos nela. Dois segundos de
 * default: uma leitura de metadados de volume local custa microssegundos, então qualquer
 * coisa perto disso já é o volume em apuros, e o valor cabe com folga dentro do intervalo de
 * amostragem, que é de minutos.
 *
 * A GUARDA DE VOO É A METADE QUE O PRAZO NÃO RESOLVE, e ela é o que impede o medidor de virar
 * o incidente. O prazo abandona a ESPERA, não a chamada: o `fs.statfs` do Node roda no
 * threadpool do libuv, que tem QUATRO slots por default, e é o MESMO threadpool que serve o
 * DNS, o zlib e a escrita em arquivo do próprio log. Num volume pendurado, uma medição por
 * intervalo satura os quatro slots em quatro amostras e leva junto o subsistema que grava o
 * `.jsonl`. É a armadilha que a propriedade (3) descreve para o pool do banco ("cada amostra
 * ainda ENFILEIRARIA mais um"), na versão de sistema de arquivos. Enquanto uma medição não
 * assentou, a próxima não é emitida: ela devolve `null` na hora, e o campo some. Campo ausente
 * durante um travamento de volume é a resposta certa, e não perda de dado: o que o leitor
 * precisa saber daquele momento não é o espaço livre, é que a medição não voltou.
 *
 * A ALTERNATIVA RECUSADA foi `statfsSync`. Ela dispensa prazo e guarda, e é justamente por
 * isso que é pior: sem threadpool para segurar o dano, o volume pendurado trava o EVENT LOOP
 * inteiro, e o servidor para de responder a todo mundo por causa do amostrador de saúde, que
 * é a piada da propriedade (1) escrita de outro jeito.
 *
 * @param {Object} opts
 * @param {string} opts.caminho - o diretório a medir (o `config.log.dir`)
 * @param {(caminho: string) => Promise<Object>} opts.statfs - injetado (`fs.promises.statfs`)
 * @param {number} [opts.prazoMs]
 * @param {(fn: Function, ms: number) => any} [opts.agendar]
 * @param {(id: any) => void} [opts.cancelar]
 * @returns {() => Promise<Object|null>}
 */
export function criarMedidorDeDisco({
  caminho,
  statfs,
  prazoMs = PRAZO_DISCO_MS_PADRAO,
  agendar = setTimeout,
  cancelar = clearTimeout,
}) {
  let emVoo = false;

  return async function medirDisco() {
    if (emVoo) return null;
    emVoo = true;

    let id = null;
    const marcaPrazo = Symbol('prazo');
    // O `Promise.resolve().then` existe para que um `statfs` que lance SINCRONAMENTE (um
    // duplo mal montado, ou o campo não sendo função) vire rejeição tratável em vez de uma
    // exceção subindo por um callback de timer, que é o que a propriedade (1) proíbe.
    // A baixa do `emVoo` é pendurada na MEDIÇÃO, não na corrida: é isso que faz a guarda
    // valer enquanto a chamada ainda ocupa o slot do threadpool, que é o ponto dela.
    const medicao = Promise.resolve()
      .then(() => statfs(caminho))
      .then(
        (estatistica) => { emVoo = false; return estatistica; },
        (err) => { emVoo = false; throw err; }
      );

    try {
      const resultado = await Promise.race([
        medicao,
        new Promise((resolve) => {
          id = agendar(() => resolve(marcaPrazo), prazoMs);
          // Nem o prazo daqui segura o event loop: propriedade (2).
          if (id && typeof id.unref === 'function') id.unref();
        }),
      ]);
      return resultado === marcaPrazo ? null : resultado;
    } catch {
      // ENOENT (o LOG_DIR ainda não existe), EACCES, volume desmontado. Todos são "não
      // consegui medir", que é ausência do campo, nunca um número.
      return null;
    } finally {
      cancelar(id);
    }
    // Se o prazo vence e a medição rejeita DEPOIS, a rejeição já tem dono: `Promise.race`
    // assina todas as promessas que recebe, então ela é absorvida ali e não vira
    // `unhandledRejection`. É a mesma propriedade de que `sondarBancoComPrazo` depende.
  };
}

/**
 * O conteúdo da amostra, dado um estado. Puro: é aqui que se testa O QUE a linha diz.
 *
 * @param {Object} estado
 * @param {{ok: boolean, ms: number, motivo?: string, erro?: string}} estado.banco
 * @param {Object|null} [estado.pool] - objeto do pg-pool, cru
 * @param {Object|null} [estado.memoria] - saída de `process.memoryUsage()`
 * @param {number} [estado.uptimeS] - `process.uptime()`
 * @param {number|null} [estado.sockets] - conexões WebSocket vivas, se alcançáveis
 * @param {Object|null} [estado.disco] - saída de `fs.statfs` sobre o `LOG_DIR`, crua
 * @returns {Object} a linha, sem a mensagem
 */
export function montarAmostra({
  banco,
  pool = null,
  memoria = null,
  uptimeS,
  sockets = null,
  disco = null,
}) {
  const linha = { amostra: MARCADOR_AMOSTRA, banco };

  const descricaoPool = descreverPool(pool);
  if (descricaoPool) linha.pool = descricaoPool;

  const descricaoMemoria = descreverMemoria(memoria);
  if (descricaoMemoria) linha.memoria = descricaoMemoria;

  const descricaoDisco = descreverDisco(disco);
  if (descricaoDisco) linha.disco = descricaoDisco;

  // Segundos inteiros: a fração não distingue nada e polui a comparação entre duas amostras.
  if (Number.isFinite(uptimeS)) linha.uptimeS = Math.round(uptimeS);

  if (Number.isFinite(sockets)) linha.sockets = sockets;

  return linha;
}

/**
 * A decisão de LIGAR o amostrador, com o motivo nomeado quando a resposta é não.
 *
 * Separada do amostrador e pura porque é ela que o gate de ambiente da propriedade (4)
 * carrega: um `if (config.isTest)` enterrado dentro do `criarAmostrador` seria a mesma
 * decisão sem forma de conferi-la sem subir um timer.
 *
 * O intervalo entra aqui porque `setInterval(NaN)` dispara a cada 1 ms (é o estrago
 * documentado em `NUMERIC_ENV_RULES`): o boot já recusa a env malformada, e esta é a
 * segunda amarra, para o uso programático que não passa pelo boot.
 *
 * @param {{ativa?: boolean, isTest?: boolean, intervaloMs?: number}} opts
 * @returns {{ligar: boolean, motivo?: 'desligado'|'teste'|'intervalo-invalido'}}
 */
export function deveAmostrar({ ativa, isTest, intervaloMs } = {}) {
  if (isTest) return { ligar: false, motivo: 'teste' };
  if (!ativa) return { ligar: false, motivo: 'desligado' };
  if (!Number.isFinite(intervaloMs) || intervaloMs <= 0) {
    return { ligar: false, motivo: 'intervalo-invalido' };
  }
  return { ligar: true };
}

/**
 * Cria o amostrador. Não decide se deve rodar: quem chama pergunta a `deveAmostrar` antes
 * (é o que mantém a decisão testável sem timer nenhum).
 *
 * @param {Object} opts
 * @param {number} opts.intervaloMs
 * @param {() => Promise<{ok: boolean, ms: number, motivo?: string, erro?: string}>} opts.sondarBanco
 * @param {() => Object|null} [opts.lerPool] - devolve o objeto do pg-pool
 * @param {() => Object} [opts.lerMemoria]
 * @param {() => number} [opts.lerUptime]
 * @param {(() => number)|null} [opts.contarSockets] - null quando não alcançável
 * @param {(() => Promise<Object|null>)|null} [opts.medirDisco] - de `criarMedidorDeDisco`
 * @param {{info: Function, warn: Function, error: Function}} opts.registrar - o logger da casa
 * @param {(fn: Function, ms: number) => any} [opts.agendar]
 * @param {(id: any) => void} [opts.cancelar]
 * @returns {{amostrarAgora: () => Promise<Object|null>, parar: () => void}}
 */
export function criarAmostradorDeSaude({
  intervaloMs,
  sondarBanco,
  lerPool = () => null,
  lerMemoria = () => process.memoryUsage(),
  lerUptime = () => process.uptime(),
  contarSockets = null,
  medirDisco = null,
  registrar,
  agendar = setInterval,
  cancelar = clearInterval,
}) {
  /**
   * A medição de disco com um `try/catch` PRÓPRIO, e essa é a diferença que não se adivinha
   * olhando o vizinho: `contarSockets` que lança derruba a amostra INTEIRA para a linha
   * `falhou: true`, e isso está certo lá, porque ele é a leitura síncrona de um objeto
   * dentro do processo, e uma que lance significa que o processo está em apuros.
   *
   * O disco não é isso. Ele atravessa para o sistema operacional, e o sistema de arquivos em
   * apuros é PRECISAMENTE o cenário que o campo existe para testemunhar. Deixar a exceção
   * subir trocaria a linha rica por uma linha de falha exatamente no incidente, apagando
   * banco, pool, memória e uptime junto, e reabrindo o buraco na série pela mão do campo que
   * foi acrescentado para explicar buracos. A regra fica: falha da MEDIÇÃO custa o CAMPO,
   * nunca a linha.
   *
   * `criarMedidorDeDisco` já não rejeita por construção; esta é a segunda amarra, para o
   * medidor que outra pessoa monte à mão.
   */
  async function medirDiscoSemPerderALinha() {
    if (!medirDisco) return null;
    try {
      return await medirDisco();
    } catch {
      return null;
    }
  }

  /**
   * Uma amostra. NUNCA rejeita: ver a propriedade (1) do cabeçalho.
   * @returns {Promise<Object|null>} a linha emitida, ou null se nem isso deu certo
   */
  async function amostrarAgora() {
    try {
      const banco = await sondarBanco();
      const disco = await medirDiscoSemPerderALinha();
      const linha = montarAmostra({
        banco,
        pool: lerPool(),
        memoria: lerMemoria(),
        uptimeS: lerUptime(),
        sockets: contarSockets ? contarSockets() : null,
        disco,
      });
      // BANCO FORA SAI EM `error`, E QUEM DECIDE ISSO É O `ehErro` REAL, não a impressão de
      // gravidade. `ehErro` (`diag-consulta.js`) classifica um registro por UM de três
      // termos: `level >= 50`, a presença do campo `err`, ou `statusCode >= 400`. Esta linha
      // não tem os dois últimos, e nem poderia: o texto da falha mora em `banco.erro`, que é
      // um nome de campo diferente de `err`. Em `warn`, como esteve até 2026-08-31, ela não
      // satisfazia termo nenhum, e o efeito medido foi o pior possível para uma camada de
      // observabilidade: `npm run diag -- erros` enxergava o amostrador QUEBRADO (que carrega
      // `err`) e NÃO enxergava o banco de dados caído. Isso não é o limite declarado no topo
      // deste arquivo (o amostrador não testemunha a própria morte); a queda do Postgres é
      // justamente o caso que ele CONSEGUE testemunhar, e estava deixando escapar.
      //
      // O comentário que morava aqui justificava o `warn` afirmando que "o relatório desta
      // casa já conta warn como erro". Isso nunca foi verdade, e a afirmação é o defeito:
      // ela fez a escolha de nível parecer conferida, então ninguém foi ler `ehErro`.
      //
      // A ALTERNATIVA RECUSADA foi manter o `warn` e acrescentar um campo `err` à linha para
      // satisfazer o segundo termo. Ela cria dois nomes para a mesma falha na mesma linha, e
      // `err` não é um campo qualquer no lado do relatório: `fundirPorRequisicao` e
      // `assinaturaDeErro` o tratam como objeto de erro com `type` e `message`, então a
      // amostra passaria a se parecer com uma requisição falha. Mudar o NÍVEL não mexe na
      // forma da linha nem na regra de campo ausente, e é o termo que o `ehErro` cobra
      // primeiro.
      //
      // PRAZO E ERRO SAEM OS DOIS EM `error`, de propósito. A distinção da propriedade (3)
      // continua inteira e continua onde sempre esteve, no campo `banco.motivo`, que é o que
      // diz se a providência é levantar o Postgres ou destravar o pool. O nível responde a
      // OUTRA pergunta ("isto entra no relatório de erros?") e para ela os dois têm a mesma
      // resposta: o servidor não está falando com o banco. Deixar `prazo` em `warn` esconderia
      // da consulta exatamente o incidente que a propriedade (3) existe para testemunhar, o
      // pool esgotado, que seria este mesmo defeito de novo, só que mais estreito.
      //
      // A AMOSTRA SAUDÁVEL FICA EM `info`, o nível baixo de hoje. Ela sai a cada intervalo,
      // para sempre, e o que denuncia a queda nela é o BURACO na série, não o nível. Promovê-la
      // faria de todo intervalo saudável um erro, e como o relatório agrupa por assinatura, a
      // campeã absoluta da lista de erros passaria a ser a linha que diz que está tudo bem.
      if (banco && banco.ok) registrar.info(linha, MSG_AMOSTRA);
      else registrar.error(linha, MSG_AMOSTRA);
      return linha;
    } catch (err) {
      // Chega aqui quem quebrou no CAMINHO da amostra: `process.memoryUsage` de um processo
      // em apuros, um `contarSockets` cujo servidor já fechou, uma sonda que lançou em vez de
      // devolver desfecho. Vira dado com o MESMO marcador, para que a consulta que procura a
      // série encontre também os buracos que o próprio amostrador abriu.
      try {
        registrar.error(
          { amostra: MARCADOR_AMOSTRA, falhou: true, err },
          'amostra de saúde falhou'
        );
      } catch {
        // O logger quebrou. Não há terceiro lugar para reclamar, e um `throw` daqui subiria
        // por um callback de timer, que é exatamente o que a propriedade (1) proíbe.
      }
      return null;
    }
  }

  const id = agendar(() => {
    // `amostrarAgora` já é à prova de rejeição; o `.catch` é a segunda amarra, para um
    // defeito NO PRÓPRIO tratamento acima. Rejeição de callback de timer não tem dono.
    void amostrarAgora().catch(() => {});
  }, intervaloMs);

  // PROPRIEDADE (2): sem isto o processo não termina sozinho.
  if (id && typeof id.unref === 'function') id.unref();

  return {
    amostrarAgora,
    parar() {
      cancelar(id);
    },
  };
}
