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
 * REGRA ÚNICA DE CAMPO AUSENTE: um campo que não pôde ser medido **não aparece** na linha.
 * Uma convenção só para a linha inteira (em vez de `null` num campo e ausência noutro) é o
 * que permite ao leitor concluir "não foi possível medir" sem consultar tabela nenhuma.
 * Hoje isso vale para `pool` (se o objeto do pg mudar de forma) e para `sockets` (que só
 * existe quando quem monta o amostrador tem o `WebSocketServer` em mãos).
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
 * O conteúdo da amostra, dado um estado. Puro: é aqui que se testa O QUE a linha diz.
 *
 * @param {Object} estado
 * @param {{ok: boolean, ms: number, motivo?: string, erro?: string}} estado.banco
 * @param {Object|null} [estado.pool] - objeto do pg-pool, cru
 * @param {Object|null} [estado.memoria] - saída de `process.memoryUsage()`
 * @param {number} [estado.uptimeS] - `process.uptime()`
 * @param {number|null} [estado.sockets] - conexões WebSocket vivas, se alcançáveis
 * @returns {Object} a linha, sem a mensagem
 */
export function montarAmostra({ banco, pool = null, memoria = null, uptimeS, sockets = null }) {
  const linha = { amostra: MARCADOR_AMOSTRA, banco };

  const descricaoPool = descreverPool(pool);
  if (descricaoPool) linha.pool = descricaoPool;

  const descricaoMemoria = descreverMemoria(memoria);
  if (descricaoMemoria) linha.memoria = descricaoMemoria;

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
  registrar,
  agendar = setInterval,
  cancelar = clearInterval,
}) {
  /**
   * Uma amostra. NUNCA rejeita: ver a propriedade (1) do cabeçalho.
   * @returns {Promise<Object|null>} a linha emitida, ou null se nem isso deu certo
   */
  async function amostrarAgora() {
    try {
      const banco = await sondarBanco();
      const linha = montarAmostra({
        banco,
        pool: lerPool(),
        memoria: lerMemoria(),
        uptimeS: lerUptime(),
        sockets: contarSockets ? contarSockets() : null,
      });
      // Banco fora é `warn`, não `error`: é um fato observado sobre a dependência, e o
      // relatório desta casa já conta `warn` como erro (`ehErro` em diag-consulta.js), então
      // ele não some da consulta por ser warn. `error` fica reservado para o amostrador
      // quebrado, que é outra coisa e precisa se distinguir na saída.
      if (banco && banco.ok) registrar.info(linha, MSG_AMOSTRA);
      else registrar.warn(linha, MSG_AMOSTRA);
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
