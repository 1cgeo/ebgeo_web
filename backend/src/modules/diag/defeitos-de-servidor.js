// Path: src/modules/diag/defeitos-de-servidor.js
/**
 * @fileoverview O 5xx do PRÓPRIO SERVIDOR virando defeito, por um agregador em memória.
 *
 * O BURACO QUE ISTO FECHA. Até aqui as duas metades da observabilidade respondiam perguntas
 * diferentes e nenhuma respondia a do administrador: o `.jsonl` responde "o que aconteceu às
 * 16h54" (sequencial, e some do terminal de quem não guardou o arquivo), e `defeitos`
 * respondia "quais defeitos, e quantas vezes" só para o NAVEGADOR. O erro do servidor
 * existia apenas como linha de log, sem contagem, sem ciclo de vida e sem estado: para saber
 * se o 500 de hoje é o mesmo de ontem era preciso reler dois arquivos. A partir daqui ele
 * entra na MESMA tabela, com `origem = 'servidor'`, e ganha de graça o `estado`, a contagem
 * e a regressão por release.
 *
 * ─── POR QUE UM AGREGADOR EM MEMÓRIA, E NÃO UMA ESCRITA POR ERRO ───
 *
 * Escrever no banco de dentro do `errorHandler` é o desenho que se escreve primeiro e é o
 * errado, por duas razões que se somam justamente no pior momento. A primeira é o volume: o
 * 5xx que importa chega em RAJADA (um deploy ruim, uma migração faltando, o pool esgotado),
 * e uma escrita por erro põe N escritas em cima de um banco que já está sofrendo. A segunda
 * é circular e é a pior: quando a causa do 5xx É o banco, cada erro tenta uma escrita que
 * também falha, e a tentativa de registrar amplifica o incidente que ela deveria registrar.
 *
 * O agregador troca as duas por uma janela de dez segundos: N erros idênticos viram UM
 * upsert com `ocorrencias + N`. É a mesma decisão do `ON CONFLICT (assinatura)` da tabela,
 * tomada um nível acima, e é irmã do `limiterDenialPayload` (`middleware/rate-limit.js`),
 * que fala uma vez por janela em vez de uma por recusa.
 *
 * ─── O QUE SE PERDE, DITO EM VOZ ALTA ───
 *
 * A janela é MEMÓRIA DE PROCESSO: um `SIGKILL` no meio dela perde o lote. É aceitável
 * porque o `.jsonl` já registrou cada erro individualmente, linha a linha, ANTES de qualquer
 * coisa aqui acontecer (o `errorHandler` loga primeiro e anota depois). Ou seja, esta camada
 * nunca é a única testemunha: ela é o AGRUPAMENTO, e o log é a evidência. É o mesmo motivo
 * pelo qual a descarga que falha DESCARTA o lote em vez de retê-lo (ver
 * `descarregarDefeitosDeServidor`).
 *
 * ─── A AMOSTRA É A ÚLTIMA, NÃO A PRIMEIRA ───
 *
 * Cada entrada guarda a contagem e UMA amostra, e a amostra que fica é a MAIS RECENTE. É o
 * contrário do que a intuição pede ("a primeira é a que originou"), e a razão é o
 * `reqId`: a amostra existe para levar quem lê ao log em arquivo, e quanto mais recente ela
 * for, mais provável é que a linha correspondente ainda esteja na janela que o comando
 * consegue abrir. A primeira ocorrência de um defeito crônico pode ser de trinta dias atrás,
 * e um `reqId` que não resolve para nada é pior que nenhum.
 */

import config from '../../config.js';
import logger from '../../utils/logger.js';
import { tx as txPadrao } from '../../database/index.js';
import { assinaturaDeErro, normalizarRota } from '../../utils/diag-consulta.js';
import { OrigemDeErro } from './origens-de-erro.js';
import { gravarDefeitoComOcorrencia } from './defeitos.service.js';

/**
 * A cadência da descarga. Dez segundos, e o número tem dois lados.
 *
 * Para baixo: menos que isso e a agregação deixa de agregar numa rajada curta, que é
 * exatamente o caso que ela existe para cobrir. Para cima: mais que isso e o administrador
 * que está olhando a tela DURANTE o incidente vê um número velho, o que é pior que um número
 * ausente, porque ele parece atual.
 *
 * O TIMER NÃO NASCE AQUI, e isso é contrato, não estilo: ele é criado em `src/index.js`,
 * como a amostra de saúde e pelo mesmo motivo escrito lá. `app.js` é importado pela suíte
 * via supertest em todo arquivo de teste, e um timer que nascesse dele subiria em toda
 * rodada, escrevendo no banco de teste no meio das asserções de outro arquivo.
 */
export const INTERVALO_DE_DESCARGA_MS = 10_000;

/**
 * O TETO DE ASSINATURAS DISTINTAS na janela.
 *
 * A agregação por assinatura já limita o caso comum (mil erros iguais são uma entrada), mas
 * NÃO o adversário: uma rota que gere assinatura nova a cada requisição (uma mensagem com
 * id dentro, por exemplo) faria o mapa crescer sem limite entre duas descargas, e o
 * agregador que existe para não amplificar o incidente viraria o vazamento de memória dele.
 * Passado o teto, a assinatura nova é DESCARTADA (a contagem das que já estão no mapa
 * continua subindo), porque descartar o mais novo preserva o que já se sabe.
 *
 * E O DESCARTE FALA, uma vez por descarga: ver `MARCADOR_TETO_ESTOURADO`. Um teto que corta
 * calado é indistinguível de um produto que não tem aquele defeito, e a hora em que ele
 * corta é exatamente a hora em que alguém está olhando a tela.
 */
export const MAX_ASSINATURAS_NA_JANELA = 500;

/**
 * A palavra que a linha de aviso da descarga falha carrega, para que ela seja
 * ACHÁVEL no log (`npm run diag -- linhas --filtro`).
 *
 * Símbolo exportado e não string digitada em dois lugares, pelo mesmo motivo de
 * `MARCADOR_AMOSTRA` e da mensagem de recusa do sync: quem lê o log precisa de um termo que
 * o teste também use, senão renomear a mensagem deixa o filtro mudo e correto na aparência.
 * Sem acento, porque é termo de busca.
 */
export const MARCADOR_DESCARGA_PERDIDA = 'descarga de defeitos de servidor perdida';

/**
 * A palavra do OUTRO silêncio desta camada: o teto de assinaturas cortou.
 *
 * ELE É DIFERENTE DA DESCARGA PERDIDA, e por isso é um marcador próprio. A descarga perdida
 * diz "o banco não aceitou", e a evidência sobreviveu no `.jsonl`; este diz "havia mais
 * defeitos DISTINTOS do que a janela comporta", que é um fato sobre o PRODUTO e não sobre a
 * infraestrutura: ou alguém está gerando assinatura nova a cada requisição (uma mensagem com
 * id dentro, o defeito que o teto existe para conter), ou o servidor está com centenas de
 * falhas distintas ao mesmo tempo. As duas pedem providências opostas, e colapsá-las numa
 * mensagem só é a mesma perda que `detalheDeAmostra` (`utils/diag-consulta.js`) se dá o
 * trabalho de evitar entre "o Postgres caiu" e "o pool entupiu". Sem acento, porque é termo
 * de busca.
 */
export const MARCADOR_TETO_ESTOURADO = 'teto de assinaturas de defeito de servidor estourado';

/** assinatura -> { contagem, amostra }. Ver o cabeçalho sobre "a amostra é a última". */
const janela = new Map();

/**
 * Quantas anotações a janela RECUSOU por teto desde a última descarga.
 *
 * Ele é zerado junto com a janela, e não no fim da descarga: o par (janela, contador) é UMA
 * unidade, e zerar em dois momentos diferentes faria o número da descarga seguinte incluir
 * descartes que a anterior já relatou.
 */
let descartadasPorTeto = 0;

/**
 * Anota um defeito de servidor. NUNCA LANÇA, NUNCA TOCA A REDE, NUNCA TOCA O BANCO.
 *
 * Ela roda dentro do `errorHandler`, ou seja, no caminho de uma requisição que JÁ falhou.
 * Tudo o que ela faz é um `Map.get`/`Map.set`. Qualquer coisa além disso (uma escrita, um
 * `await`, uma serialização cara) transformaria o handler de erro numa segunda fonte de
 * erro, que é o modo de falha que a casa inteira recusa nesta camada.
 *
 * @param {Object} anotacao
 * @param {string} anotacao.assinatura - a MESMA de `assinaturaDeErro`; ver `defeitoDeRequisicao`
 * @returns {{contagem: number}|null} a entrada, ou null quando não foi anotada
 */
export function anotarDefeitoDeServidor(anotacao) {
  if (!anotacao || typeof anotacao.assinatura !== 'string' || anotacao.assinatura === '') {
    return null;
  }
  const atual = janela.get(anotacao.assinatura);
  if (atual) {
    atual.contagem += 1;
    atual.amostra = anotacao;
    return atual;
  }
  if (janela.size >= MAX_ASSINATURAS_NA_JANELA) {
    descartadasPorTeto += 1;
    return null;
  }
  const entrada = { contagem: 1, amostra: anotacao };
  janela.set(anotacao.assinatura, entrada);
  return entrada;
}

/** Quantas assinaturas distintas esperam a próxima descarga. Para teste e diagnóstico. */
export function defeitosDeServidorPendentes() {
  return janela.size;
}

/** Quantas anotações a janela recusou por teto desde a última descarga. */
export function defeitosDeServidorDescartados() {
  return descartadasPorTeto;
}

/** Esvazia a janela sem escrever nada. Existe para o isolamento entre casos de teste. */
export function limparDefeitosDeServidor() {
  janela.clear();
  descartadasPorTeto = 0;
}

/**
 * Descarrega a janela no banco. NUNCA LANÇA.
 *
 * A JANELA É ESVAZIADA ANTES DA ESCRITA, e essa ordem é a decisão inteira. Se ela fosse
 * esvaziada depois, um erro do banco deixaria o lote no mapa, a descarga seguinte tentaria
 * o mesmo lote MAIOR, e com o banco fora por alguns minutos o mapa cresceria até o teto
 * segurando trabalho que nunca vai passar. Esvaziando antes, uma falha custa exatamente um
 * lote e a janela seguinte começa limpa.
 *
 * DESCARTAR É O DESENHO, NÃO UMA DESISTÊNCIA. A pergunta "por que não guardar para tentar de
 * novo" tem resposta: o `.jsonl` já tem cada um destes erros escrito linha a linha, com
 * pilha, `reqId` e a URL redigida, e o `npm run diag -- erros` os agrupa pela MESMA
 * `assinaturaDeErro` que esta camada usa. Ou seja, quando esta descarga falha a evidência
 * não se perde, só o AGRUPAMENTO no banco fica com um buraco, e é isso que a linha de aviso
 * diz em voz alta, com a contagem que foi perdida, para que o buraco não seja silencioso.
 *
 * O AVISO É UM POR DESCARGA, nunca um por assinatura: uma indisponibilidade de banco
 * produziria uma linha por defeito distinto a cada dez segundos, e o log que existe para
 * diagnosticar a queda seria soterrado por ela.
 *
 * @param {Object} [opts]
 * @param {Function} [opts.transacao] - injeção do `tx` do banco (teste)
 * @param {Object} [opts.registrar] - injeção do logger (teste)
 * @param {string|null} [opts.release] - injeção da release (teste)
 * O DESCARTE POR TETO É RELATADO AQUI, e não na anotação: relatar por anotação faria o
 * adversário que gera assinatura nova a cada requisição produzir uma linha de log por
 * requisição, ou seja, o aviso viraria a amplificação que o teto existe para impedir. Uma
 * linha por descarga, com a contagem, é a mesma disciplina do `limiterDenialPayload`.
 *
 * @returns {Promise<{descarregados: number, ocorrencias: number, descartadas: number,
 *                    motivo?: string}>}
 */
export async function descarregarDefeitosDeServidor({
  transacao = txPadrao,
  registrar = logger,
  release = config.release ?? null,
} = {}) {
  // O contador é lido e zerado JUNTO com a janela, mesmo no caminho de janela vazia: um
  // descarte só acontece com a janela cheia, mas o zeramento tem de acompanhar a leitura em
  // todo caminho de saída, senão a contagem vaza para a descarga seguinte.
  const descartadas = descartadasPorTeto;
  descartadasPorTeto = 0;
  if (descartadas > 0) {
    registrar.warn(
      { descartadas, teto: MAX_ASSINATURAS_NA_JANELA, pendentes: janela.size },
      MARCADOR_TETO_ESTOURADO
    );
  }

  if (janela.size === 0) {
    return { descarregados: 0, ocorrencias: 0, descartadas, motivo: 'vazia' };
  }

  const lote = [...janela.entries()];
  janela.clear();

  const ocorrencias = lote.reduce((soma, [, e]) => soma + e.contagem, 0);

  try {
    await transacao(async (t) => {
      for (const [assinatura, entrada] of lote) {
        const a = entrada.amostra;
        // Em SÉRIE, dentro de uma transação só: paralelizar aqui disputaria a MESMA
        // conexão do pg-promise e serializaria do mesmo jeito, trocando ordem
        // determinística por nada.
        await gravarDefeitoComOcorrencia(t, {
          assinatura,
          mensagem: a.mensagem,
          stack: a.stack ?? null,
          release,
          origem: OrigemDeErro.SERVIDOR,
          userId: a.userId ?? null,
          sessaoId: a.sessaoId ?? null,
          reqId: a.reqId ?? null,
          rota: a.rota ?? null,
          statusCode: a.statusCode ?? null,
          incremento: entrada.contagem,
        });
      }
    });
    return { descarregados: lote.length, ocorrencias, descartadas };
  } catch (err) {
    registrar.warn(
      { err, assinaturas: lote.length, ocorrencias },
      MARCADOR_DESCARGA_PERDIDA
    );
    return { descarregados: 0, ocorrencias: 0, descartadas, motivo: 'falha' };
  }
}

/**
 * A anotação de uma requisição que falhou com 5xx. PURA.
 *
 * A ASSINATURA É `assinaturaDeErro` (`utils/diag-consulta.js`), a MESMA do comando e da
 * rota que leem o `.jsonl`, e isso é o contrato desta função. Uma segunda regra de
 * agrupamento aqui faria a tabela e o `npm run diag -- erros` discordarem sobre o que é "o
 * mesmo defeito": o administrador leria dez defeitos numa tela e três na outra, sobre os
 * mesmos erros, e nada indicaria qual das duas está certa. Por isso o registro é montado com
 * a FORMA que aquela função espera (`err.type`, `err.message`, `method`, `url`,
 * `statusCode`) em vez de uma concatenação própria.
 *
 * O `statusCode` ENTRA AQUI e não entra na linha de log, e a assimetria é deliberada: o log
 * o omite de propósito no topo (`requestErrorLogPayload`), para que `resumirStatus` não
 * conte a requisição duas vezes, e o CLI o recupera pela FUSÃO com a linha do
 * `request-logger` (`fundirPorRequisicao`). Aqui não há fusão nenhuma, então ele precisa
 * vir junto, senão a assinatura desta camada perderia o `[500]` que a do comando tem e as
 * duas deixariam de casar exatamente onde o cabeçalho acima promete que casam.
 *
 * @param {{campos: Object, mensagem: string, statusRegistrado: number}} linha - o retorno de
 *   `requestErrorLogPayload` (`middleware/error-handler.js`)
 * @returns {Object} a anotação
 */
export function defeitoDeRequisicao(linha) {
  const campos = linha?.campos ?? {};
  const err = campos.err && typeof campos.err === 'object' ? campos.err : null;
  const registro = {
    err: campos.err,
    msg: linha?.mensagem,
    method: campos.method,
    url: campos.url,
    statusCode: linha?.statusRegistrado,
  };
  return {
    assinatura: assinaturaDeErro(registro).slice(0, 300),
    // O MESMO TETO DE 300 DO JOI DA BORDA, e pelo mesmo motivo ESTRUTURAL: `assinatura` é
    // chave única em btree, que recusa valor acima de ~2.700 bytes. A borda do cliente já
    // corta; este caminho não passa por Joi nenhum, então o corte é aqui ou é um 500 dentro
    // do caminho que existe para registrar falhas.
    mensagem: String((err && err.message) || linha?.mensagem || '(sem mensagem)').slice(0, 500),
    stack: err && typeof err.stack === 'string' ? err.stack.slice(0, 4000) : null,
    rota: campos.url ? `${campos.method || ''} ${normalizarRota(campos.url)}`.trim() : null,
    statusCode: typeof linha?.statusRegistrado === 'number' ? linha.statusRegistrado : null,
    reqId: campos.reqId ?? null,
    sessaoId: campos.sessaoId ?? null,
    userId: campos.userId ?? null,
  };
}

/**
 * A anotação de uma QUEDA do processo. PURA.
 *
 * ELA NÃO PASSA POR `requestErrorLogPayload` porque não há requisição: `causa` é o que o
 * `uncaughtException`/`unhandledRejection` entregou, que pode não ser um `Error` (rejeitar
 * uma string é legal em JavaScript, e é justamente o caso em que a diagnose é mais difícil).
 * Daí a leitura defensiva de `name`, `message` e `stack`.
 *
 * A ASSINATURA CARREGA O TIPO DA QUEDA, e sem ele duas quedas de causas opostas colapsariam
 * na mesma linha: `uncaughtException` e `unhandledRejection` com a mesma mensagem pedem
 * providências diferentes, e é a mesma distinção que `detalheDeAmostra`
 * (`utils/diag-consulta.js`) preserva entre "o Postgres caiu" e "o pool entupiu".
 *
 * O `statusCode` FICA NULO de propósito: não houve resposta HTTP nenhuma, e escrever 500
 * aqui inventaria um desfecho que não existiu.
 *
 * @param {string} tipo - `TIPO_DE_QUEDA.EXCECAO` ou `.REJEICAO`
 * @param {unknown} causa
 * @param {string} [origem] - o `origin` do evento, quando diverge do tipo
 * @returns {Object} a anotação
 */
export function defeitoDaQueda(tipo, causa, origem) {
  const ehObjeto = Boolean(causa) && typeof causa === 'object';
  const mensagem = ehObjeto && typeof causa.message === 'string' && causa.message !== ''
    ? causa.message
    : String(causa);
  const nome = ehObjeto && typeof causa.name === 'string' ? causa.name : typeof causa;
  const registro = {
    err: { type: nome, message: mensagem },
    msg: `queda: ${tipo}${origem && origem !== tipo ? ` (${origem})` : ''}`,
  };
  return {
    // A `msg` do registro entra na assinatura pela regra de `assinaturaDeErro`: sem `url`
    // não há rota, e o que sobra é `tipo | mensagem`, mais o `queda:` que a distingue de um
    // erro de rota com a mesma mensagem.
    assinatura: `${registro.msg} | ${assinaturaDeErro(registro)}`.slice(0, 300),
    mensagem: mensagem.slice(0, 500),
    stack: ehObjeto && typeof causa.stack === 'string' ? causa.stack.slice(0, 4000) : null,
    rota: null,
    statusCode: null,
    reqId: null,
    sessaoId: null,
    userId: null,
  };
}
