// Path: src/modules/diag/client-errors.service.js
/**
 * @fileoverview Metade B: o erro do NAVEGADOR, que sem isto não existia em lugar nenhum.
 *
 * ESTE ARQUIVO TAMBÉM É QUEM PODA A TABELA, e a poda mora aqui porque é aqui que a tabela
 * cresce. Até 2026-09-01 `client_errors` não tinha um DELETE em lugar nenhum do pacote:
 * nem rota, nem job, nem roteiro. A dedupe por assinatura só segura quando a assinatura
 * REPETE, e a assinatura é montada no cliente, então dentro do próprio limitador de um
 * endereço só cabiam dezenas de milhares de linhas novas por dia, permanentes. O cabeçalho
 * de `src/database/migrations/014_observabilidade.sql` diz que a tabela existe para evitar
 * que a telemetria vire o segundo incidente; sem poda, ela virava.
 */

import config from '../../config.js';
import logger from '../../utils/logger.js';
import { none, any } from '../../database/index.js';
import { parseJanela } from '../../utils/diag-consulta.js';
import {
  UPSERT_CLIENT_ERROR,
  LIST_CLIENT_ERRORS,
  DELETE_CLIENT_ERRORS_EXPIRADOS,
} from './client-errors.queries.js';

/** `''` é o que um cliente manda quando não tem o campo; no banco isso é NULL. */
const vazioVirando = (v) => (v === undefined || v === null || v === '' ? null : v);

/**
 * O INTERVALO MÍNIMO ENTRE DUAS PASSADAS, no mesmo processo.
 *
 * A poda é OPORTUNISTA: ela pega carona na escrita, sem agendador, sem timer e sem
 * processo novo, no mesmo espírito do log em arquivo, que poda no momento da rotação
 * (`podar` em `src/utils/log-diario.js`). A propriedade que isso compra é a que um
 * agendador não tem: se ninguém escreve, nada cresce, logo não há nada para podar, e um
 * timer acordando de hora em hora num servidor ocioso seria trabalho por trabalho.
 */
export const INTERVALO_MINIMO_DE_PODA_MS = 3_600_000;

/**
 * O teto de linhas por passada. Ver o cabeçalho de `DELETE_CLIENT_ERRORS_EXPIRADOS`: ele
 * existe pelo LOCK, e o que sobrar sai na passada seguinte.
 */
export const MAX_LINHAS_POR_PASSADA = 5_000;

/**
 * O RELÓGIO DA GUARDA É DO PROCESSO, e essa escolha tem uma consequência que alguém vai
 * querer "consertar": com N instâncias do backend no ar, a poda roda até N vezes por hora
 * em vez de uma. Isso é inofensivo e deliberado. O DELETE é idempotente (a segunda passada
 * simplesmente não acha mais nada para apagar), é limitado por teto e é barato; trocar isso
 * por uma tabela de controle compartilhada custaria uma escrita e um round-trip a mais em
 * TODA requisição de relato, mais um estado novo que pode ficar preso, para economizar um
 * DELETE que não acha linha nenhuma. Não troque.
 */
let ultimaPodaEm = 0;

/**
 * Decide se a poda deve rodar agora. Puro, para ser testável sem banco e sem relógio.
 *
 * `emTeste` é o mesmo gate de ambiente de `deveAmostrar` (`src/utils/amostra-de-saude.js`)
 * e do log em arquivo, e existe pela mesma razão: a suíte não pode ganhar um DELETE que
 * ninguém pediu no meio de uma asserção sobre a tabela. Um teste que QUEIRA podar chama
 * `talvezPodar({ emTeste: false })` de propósito, que é o caminho explícito.
 *
 * @param {Object} opts
 * @param {number} opts.agoraMs
 * @param {number} opts.ultimaPodaEm - 0 quando ainda não houve passada neste processo
 * @param {number} opts.intervaloMs
 * @param {boolean} opts.emTeste
 * @returns {{podar: boolean, motivo?: string}}
 */
export function devePodar({ agoraMs, ultimaPodaEm: ultima, intervaloMs, emTeste }) {
  if (emTeste) return { podar: false, motivo: 'teste' };
  if (!Number.isFinite(intervaloMs) || intervaloMs <= 0) {
    return { podar: false, motivo: 'intervalo-invalido' };
  }
  // A PRIMEIRA passada roda na primeira escrita depois do boot, e não uma hora depois
  // dela: um processo que sobe, recebe um relato e cai nunca teria podado nada.
  if (ultima > 0 && agoraMs - ultima < intervaloMs) return { podar: false, motivo: 'intervalo' };
  return { podar: true };
}

/**
 * Roda a poda se o intervalo já passou. NUNCA LANÇA.
 *
 * A poda é efeito de MANUTENÇÃO e não parte do contrato da rota: quando ela falha, o
 * registro do erro do cliente já aconteceu e a resposta segue normal. Deixar a exceção
 * subir daria 500 na única rota anônima que escreve, ou seja, a rota que existe para
 * registrar falhas produziria a sua, que é exatamente o modo de falha que os tetos de Joi
 * já fecharam do outro lado.
 *
 * MAS FALHA DE PODA NÃO PODE SER MUDA: um `catch` vazio aqui é o verificador quebrando
 * calado, e o sintoma (a tabela crescendo para sempre) só apareceria como disco cheio meses
 * depois. Ela sai em `warn`, com a causa.
 *
 * O CARIMBO DO RELÓGIO É POSTO ANTES DO DELETE, e não depois. Se a poda falha (permissão,
 * indisponibilidade, prazo), marcar só no sucesso faria CADA requisição seguinte tentar de
 * novo e escrever uma linha de aviso: um defeito de manutenção viraria uma tempestade de
 * log em cima de um banco que já está sofrendo. Com o carimbo antes, a falha custa uma
 * tentativa por hora, que é a mesma cadência do sucesso.
 *
 * @param {Object} [opts] - injeções; em produção nenhuma é passada
 * @returns {Promise<{podou: boolean, motivo?: string, apagadas?: number}>}
 */
export async function talvezPodar({
  agoraMs = Date.now(),
  intervaloMs = INTERVALO_MINIMO_DE_PODA_MS,
  emTeste = config.isTest,
  retencaoDias = config.log.retencaoDias,
  teto = MAX_LINHAS_POR_PASSADA,
  registrar = logger,
} = {}) {
  const decisao = devePodar({ agoraMs, ultimaPodaEm, intervaloMs, emTeste });
  if (!decisao.podar) return { podou: false, motivo: decisao.motivo };

  ultimaPodaEm = agoraMs;

  try {
    const apagadas = await any(DELETE_CLIENT_ERRORS_EXPIRADOS, [retencaoDias, teto]);
    if (apagadas.length > 0) {
      registrar.info(
        { podadas: apagadas.length, retencaoDias, teto },
        'poda de client_errors'
      );
    }
    return { podou: true, apagadas: apagadas.length };
  } catch (err) {
    registrar.warn({ err, retencaoDias, teto }, 'falha ao podar client_errors');
    return { podou: false, motivo: 'falha' };
  }
}

/**
 * Registra (ou incrementa) um erro de navegador.
 *
 * `userId` é PARÂMETRO, e é o chamador (o controller) que o tira de `req.user`. Escrever
 * `relato.userId` aqui seria aceitar do corpo a identidade de quem relata, ou seja,
 * deixar qualquer anônimo carimbar um erro no nome de outra pessoa. A assinatura desta
 * função existe assim para que esse erro precise ser cometido de propósito.
 *
 * A PODA VEM DEPOIS DO UPSERT, e a ordem é o contrato: primeiro o serviço (registrar),
 * depois a higiene (apagar o que envelheceu). Ela é AGUARDADA em vez de solta como promessa
 * pendente porque uma promessa sem dono que rejeitasse viraria `unhandledRejection`, e no
 * Node 22 isso derruba o processo: trocar um DELETE de meio segundo por hora pelo risco de
 * matar o servidor é o câmbio errado. `talvezPodar` não lança e é barata por construção.
 *
 * @param {Object} relato - o corpo já validado por Joi (tetos de tamanho aplicados)
 * @param {string|null} userId - o principal autenticado, ou null (anônimo)
 * @param {Object} [opcoesDePoda] - injeções repassadas a `talvezPodar` (só teste)
 * @returns {Promise<void>}
 */
export async function registrarErroDeCliente(relato, userId, opcoesDePoda) {
  await none(UPSERT_CLIENT_ERROR, [
    relato.assinatura,
    relato.mensagem,
    vazioVirando(relato.stack),
    vazioVirando(relato.url),
    vazioVirando(relato.pagina),
    vazioVirando(relato.userAgent),
    vazioVirando(relato.release),
    userId ?? null,
    vazioVirando(relato.atlasId),
    vazioVirando(relato.sessaoId),
    vazioVirando(relato.stackBruta),
    vazioVirando(relato.origem),
    // O JSONB vai como OBJETO, não como texto: o pg-promise serializa objeto para JSON, e
    // um `JSON.stringify` aqui gravaria a STRING JSON dentro do JSONB (aspas e escapes
    // inclusive), que lê como um valor plausível e quebra toda consulta por chave. O
    // `vazioVirando` continua servindo porque o cliente pode mandar o campo ausente.
    vazioVirando(relato.contexto),
  ]);

  await talvezPodar(opcoesDePoda);
}

/**
 * Os erros de navegador da janela, do mais recente para o mais antigo.
 *
 * A janela é aplicada sobre `ultima_em` e não sobre `primeira_em`: o que interessa é o
 * defeito que AINDA está acontecendo. Um erro que nasceu há um mês e disparou hoje é o
 * caso mais relevante da lista, e ancorar em `primeira_em` o esconderia. É o mesmo
 * critério da poda, de propósito.
 *
 * `totalAssinaturas` É O NÚMERO DE ANTES DO CORTE, e sem ele a tela não tem como avisar
 * que a lista foi truncada: "50 assinaturas" fica indistinguível de "50 de 400", e quem lê
 * conclui que viu tudo. É a mesma correção que a metade A já tinha em `assinaturas`
 * (`diag.service.js`). Ele vem da PRIMEIRA linha porque a subconsulta escalar o repete em
 * todas; a lista vazia significa total zero porque o predicado é literalmente o mesmo, e
 * isso está escrito no cabeçalho de `LIST_CLIENT_ERRORS`.
 *
 * @param {{desde: string, limite: number}} query - já validada
 * @returns {Promise<{desde: number, totalAssinaturas: number, itens: Object[]}>}
 */
export async function listarErrosDeCliente({ desde, limite }) {
  const inicio = new Date(Date.now() - parseJanela(desde));
  const linhas = await any(LIST_CLIENT_ERRORS, [inicio, limite]);
  return {
    desde: inicio.getTime(),
    totalAssinaturas: linhas.length > 0 ? linhas[0].total_assinaturas : 0,
    itens: linhas.map((l) => ({
      id: l.id,
      assinatura: l.assinatura,
      mensagem: l.mensagem,
      stack: l.stack,
      url: l.url,
      pagina: l.pagina,
      userAgent: l.user_agent,
      release: l.release,
      userId: l.user_id,
      username: l.username,
      atlasId: l.atlas_id,
      // As quatro de `017_erro_cliente_identidade.sql`. Elas saem SEMPRE, com `null` quando
      // o relato não as trouxe, ao contrário do que a metade A faz com `enderecos`: ali a
      // chave ausente distingue "servidor antigo" de "zero endereços", e aqui não há esse
      // segundo estado — a coluna existe para toda linha, e `null` significa exatamente uma
      // coisa, que é "o cliente não declarou".
      sessaoId: l.sessao_id,
      stackBruta: l.stack_bruta,
      origem: l.origem,
      contexto: l.contexto,
      ocorrencias: l.ocorrencias,
      // Epoch ms, como toda data desta família de rotas: a metade A carimba `primeira` e
      // `ultima` assim (é o `time` do pino), e duas unidades de tempo na mesma tela é
      // conversão errada esperando para acontecer.
      primeiraEm: new Date(l.primeira_em).getTime(),
      ultimaEm: new Date(l.ultima_em).getTime(),
    })),
  };
}
