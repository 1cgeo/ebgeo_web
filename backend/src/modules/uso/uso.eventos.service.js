// Path: src/modules/uso/uso.eventos.service.js
/**
 * @fileoverview A ESCRITA do uso de produto: o lote que chega do navegador, e a passada de
 * manutenção que agrega o dia fechado e poda as sessões vencidas.
 *
 * POR QUE ELE NÃO MORA EM `uso.service.js`. Aquele arquivo é o RELATÓRIO, e o `fileoverview`
 * dele carrega uma promessa que este arquivo quebra: "a peça que NÃO instrumenta nada".
 * Instrumentação nova tem outra régua (entrada anônima, teto de tamanho, transação,
 * manutenção que APAGA linha) e outra frequência de leitura, e misturá-las faria a próxima
 * pessoa ler as decisões do relatório como se valessem para a rota de escrita. São dois
 * serviços no mesmo módulo, como `diag.service.js` e `defeitos.service.js` são no vizinho, e
 * pela mesma razão: metade A lê, metade B escreve.
 *
 * A ORDEM DA PASSADA DE MANUTENÇÃO É O CONTRATO: AGREGAR E SÓ ENTÃO PODAR. Invertida, a poda
 * leva embora as sessões de um dia que ainda não virou linha em `uso_diario`, e o dia some do
 * relatório sem erro nenhum, sem log e sem nada ficar vermelho. É o único acoplamento de
 * ordem deste arquivo, e é por isso que as duas são UMA função e não duas exportadas lado a
 * lado: duas exportadas convidam a chamar só a segunda.
 */

import config from '../../config.js';
import logger from '../../utils/logger.js';
import { any, tx } from '../../database/index.js';
import { ServiceUnavailableError } from '../../utils/errors.js';
import { instantesDoLote, devePassar } from './uso.lote.js';
import {
  UPSERT_EVENTOS_DIA,
  UPSERT_SESSAO,
  AGREGAR_DIAS_FECHADOS,
  DELETE_SESSOES_EXPIRADAS,
} from './uso.queries.js';

/** `''` é o que um cliente manda quando não tem o campo; no banco isso é NULL. */
const vazioVirando = (v) => (v === undefined || v === null || v === '' ? null : v);

/**
 * O MAIOR VITAL QUE UMA COLUNA `integer` PRECISA GUARDAR: uma hora, em milissegundos.
 *
 * Ele NÃO existe para validar a medida, existe para que a medida absurda não custe o LOTE. O
 * Joi tem `min(0)` e nenhum teto superior nos três vitais em milissegundos, de propósito (um
 * teto escrito lá seria um limite inventado sobre o relógio do cliente), e o que estava
 * faltando era o outro lado: `2^31` milissegundos são 24 dias, então um `lcpMs` acima disso
 * estoura a coluna com `22003` DENTRO da transação, e o lote inteiro (com todas as contagens
 * de eventos daquele intervalo) morre por causa de um único número.
 *
 * UMA HORA É O CORTE, e ele é generoso de propósito: nenhum LCP, INP ou tempo até o mapa
 * legítimo chega perto, e qualquer coisa acima é relógio quebrado ou aba hibernada. O que
 * acontece com o valor acima do teto é o mínimo possível: o VITAL vira `null` e o resto do
 * lote sobrevive. Descartar um percentil vale muito mais que descartar as contagens.
 */
export const TETO_DE_VITAL_MS = 3_600_000;

/**
 * Um número opcional do corpo, arredondado e limitado, ou `null`.
 *
 * `Math.round` PORQUE AS COLUNAS DE VITAIS SÃO `integer` E O JOI ACEITA FRAÇÃO. O navegador
 * entrega `lcpMs` com casas decimais (a API de performance é `DOMHighResTimeStamp`), e um
 * `1234.5` num `integer` é `22P02` dentro da transação, ou seja um 500 na rota anônima que
 * existe para medir. Recusar a fração no Joi seria o outro caminho e é pior: obrigaria o
 * cliente a arredondar, e um cliente de outra versão que esquecesse perderia o lote inteiro.
 *
 * O TETO É A MESMA DECISÃO PELO OUTRO LADO: ver {@link TETO_DE_VITAL_MS}. As duas moram aqui
 * porque aqui é onde a passagem de número do corpo para coluna `integer` acontece, e espalhar
 * uma delas para o Joi faria duas bordas decidirem a mesma coisa.
 *
 * `cls` NÃO PASSA POR AQUI, e essa é a exceção que dá sentido à função: a coluna é
 * `NUMERIC(6,3)` justamente porque o valor é uma fração pequena, e arredondá-lo para inteiro
 * transformaria toda medida boa em zero. O teto dele é o `max(100)` do Joi, que a coluna
 * comporta.
 *
 * @param {number|null|undefined} v
 * @returns {number|null}
 */
const inteiroOuNulo = (v) => (
  Number.isFinite(v) && v <= TETO_DE_VITAL_MS ? Math.round(v) : null
);

/**
 * O INTERVALO MÍNIMO ENTRE DUAS PASSADAS de manutenção, no mesmo processo.
 *
 * Uma hora, o mesmo de `INTERVALO_MINIMO_DE_PODA_MS` (`diag/defeitos.service.js`), e pela
 * mesma razão: a manutenção pega carona na escrita, sem agendador, sem timer e sem processo
 * novo. A propriedade que isso compra é a que um agendador não tem: se ninguém usa o produto,
 * não nascem sessões, logo não há o que agregar nem o que podar, e um timer acordando de hora
 * em hora num servidor ocioso seria trabalho por trabalho.
 */
export const INTERVALO_MINIMO_DE_MANUTENCAO_MS = 3_600_000;

/**
 * O teto de linhas por passada de poda. Ver `DELETE_SESSOES_EXPIRADAS`: ele existe pelo
 * LOCK, e o que sobrar sai na passada seguinte.
 */
export const MAX_SESSOES_POR_PASSADA = 5_000;

/**
 * O RELÓGIO DA GUARDA É DO PROCESSO, com a mesma consequência (e a mesma resposta) do
 * relógio de `talvezPodar`: com N instâncias do backend no ar, a manutenção roda até N vezes
 * por hora em vez de uma. Isso é inofensivo e deliberado, porque as duas metades são
 * idempotentes por construção (o `ON CONFLICT DO NOTHING` da agregação e o `DELETE` que
 * simplesmente não acha mais linha), e uma tabela de controle compartilhada custaria uma
 * escrita e um round-trip a mais em TODA requisição de telemetria para economizar isso.
 */
let ultimaManutencaoEm = 0;

/**
 * Zera o relógio da guarda. SÓ PARA TESTE.
 *
 * Ele existe porque o relógio é estado de MÓDULO e a suíte importa o módulo uma vez: um caso
 * que exercite a passada deixaria o carimbo posto para todos os seguintes, e o segundo caso
 * mediria o `motivo: 'intervalo'` achando que mediu a manutenção. A alternativa (receber o
 * carimbo por parâmetro em produção) poria um argumento no caminho quente para servir só ao
 * teste, e a de `defeitos.service.js` não tem gêmea justamente porque lá nenhum caso precisa
 * de duas passadas.
 */
export function _zerarRelogioDeManutencao() {
  ultimaManutencaoEm = 0;
}

/**
 * Agrega os dias FECHADOS em `uso_diario` e depois poda as sessões vencidas. NUNCA LANÇA.
 *
 * A MANUTENÇÃO NÃO É PARTE DO CONTRATO DA ROTA: quando ela falha, o lote já foi gravado e a
 * resposta segue 204. Deixar a exceção subir daria 503 numa rota ANÔNIMA por causa de higiene
 * de outras linhas, ou seja, a rota que existe para medir deixaria de medir por um motivo que
 * nada tem a ver com o que ela acabou de receber.
 *
 * MAS FALHA DE MANUTENÇÃO NÃO PODE SER MUDA: um `catch` vazio aqui é o verificador quebrando
 * calado, e o sintoma (a tabela de sessões crescendo para sempre, ou o dia que nunca vira
 * agregado) só apareceria meses depois, como disco cheio ou como um buraco na série. Ela sai
 * em `warn`, com a causa.
 *
 * O CARIMBO DO RELÓGIO É POSTO ANTES DO TRABALHO, e não depois, pela mesma razão de
 * `talvezPodar`: marcar só no sucesso faria CADA requisição seguinte tentar de novo e
 * escrever uma linha de aviso, ou seja, um defeito de manutenção viraria uma tempestade de
 * log em cima de um banco que já está sofrendo.
 *
 * AS DUAS METADES SÃO SEPARADAS NO `try`, E ISSO É DELIBERADO: se a agregação falha, a poda
 * NÃO roda. Ela é a metade destrutiva, e rodá-la depois de uma agregação que não aconteceu é
 * exatamente o modo de falha que a ordem existe para impedir.
 *
 * @param {Object} [opts] - injeções; em produção nenhuma é passada
 * @returns {Promise<{passou: boolean, motivo?: string, agregados?: number, apagadas?: number}>}
 */
export async function agregarEPodar({
  agoraMs = Date.now(),
  intervaloMs = INTERVALO_MINIMO_DE_MANUTENCAO_MS,
  emTeste = config.isTest,
  retencaoDias = config.log.retencaoDias,
  teto = MAX_SESSOES_POR_PASSADA,
  registrar = logger,
} = {}) {
  const decisao = devePassar({
    agoraMs, ultimaPassadaEm: ultimaManutencaoEm, intervaloMs, emTeste,
  });
  if (!decisao.passar) return { passou: false, motivo: decisao.motivo };

  ultimaManutencaoEm = agoraMs;

  let agregados;
  try {
    agregados = await any(AGREGAR_DIAS_FECHADOS, [new Date(agoraMs), retencaoDias]);
  } catch (err) {
    registrar.warn({ err }, 'falha ao agregar o uso diario');
    return { passou: false, motivo: 'falha-agregacao' };
  }

  try {
    const apagadas = await any(DELETE_SESSOES_EXPIRADAS, [retencaoDias, teto]);
    if (agregados.length > 0 || apagadas.length > 0) {
      registrar.info(
        { agregados: agregados.length, apagadas: apagadas.length, retencaoDias, teto },
        'manutencao do uso de produto'
      );
    }
    return { passou: true, agregados: agregados.length, apagadas: apagadas.length };
  } catch (err) {
    registrar.warn({ err, retencaoDias, teto }, 'falha ao podar sessoes de uso');
    return { passou: false, motivo: 'falha-poda', agregados: agregados.length };
  }
}

/**
 * Grava um lote de uso: as contagens do dia e a linha da sessão, na MESMA transação.
 *
 * `userId` É PARÂMETRO, e é o chamador (o controller) que o tira de `req.user`. Escrever
 * `lote.userId` aqui seria aceitar do corpo a identidade de quem relata, ou seja, deixar
 * qualquer anônimo atribuir sessões a outra pessoa e mexer no número de "usuários distintos"
 * da instalação. A assinatura existe assim para que esse erro precise ser cometido de
 * propósito, e é a mesma de `registrarErroDeCliente`.
 *
 * A TRANSAÇÃO NÃO É ZELO: as duas escritas são a MESMA medida contada de dois jeitos (a
 * contagem por evento e o total de eventos da sessão), e uma metade sem a outra produziria
 * uma sessão cujo `eventos` não bate com a soma das contagens daquele dia. Um relatório em
 * que dois números da mesma tela discordam custa mais que o lote perdido.
 *
 * A INSTRUÇÃO DE CONTAGENS É PULADA QUANDO O LOTE VEM VAZIO, e o lote vazio é legítimo e
 * frequente (uma aba que só ficou aberta ainda tem duração, vitais e erros para reportar).
 * Sem o desvio, `unnest` de três arrays vazios devolveria zero linhas e o `INSERT ... SELECT`
 * não escreveria nada, o que é o mesmo resultado pagando um round-trip; o desvio é para não
 * pagá-lo.
 *
 * O ERRO DO DRIVER VIRA 503, E NUNCA 500, e a escolha tem um lado prático: 503 é a resposta
 * que diz ao cliente "tente de novo mais tarde", que é exatamente o que um cliente de
 * telemetria deve fazer com um lote que ele ainda tem em memória. Um 500 diria "não adianta
 * repetir". A causa vai em `cause` e em lugar nenhum mais, porque o serializer do pino dobra
 * `message` e `stack` da causa e NÃO copia os campos do driver (`detail` com a linha que
 * falhou, `query` com a credencial embutida): pendurá-la noutro campo enumerável vazaria os
 * dois para o log.
 *
 * @param {Object} lote - o corpo já validado por `eventosDeUsoSchema`
 * @param {string|null} userId - o principal autenticado, ou null (anônimo)
 * @param {Object} [opcoesDeManutencao] - injeções repassadas a `agregarEPodar` (só teste)
 * @returns {Promise<void>}
 */
export async function registrarLoteDeUso(lote, userId, opcoesDeManutencao) {
  const agoraMs = Date.now();
  // A RETENÇÃO ENTRA NA APARA, e não só na poda: `uso_eventos_dia` e `uso_diario` NÃO são
  // podadas, então um `ultimoSinal` datado de 1970 escreveria linhas permanentes nas duas. Ver
  // `instantesDoLote`.
  const { inicio, ultimoSinal } = instantesDoLote(lote, agoraMs, config.log.retencaoDias);
  const eventos = lote.eventos ?? [];
  const vitais = lote.vitais ?? {};

  try {
    await tx(async (t) => {
      if (eventos.length > 0) {
        await t.none(UPSERT_EVENTOS_DIA, [
          ultimoSinal,
          lote.pagina,
          eventos.map((e) => e.evento),
          eventos.map((e) => e.prop ?? ''),
          eventos.map((e) => e.contagem),
        ]);
      }

      await t.none(UPSERT_SESSAO, [
        lote.sessaoId,
        userId ?? null,
        lote.pagina,
        vazioVirando(lote.release),
        vazioVirando(lote.navegador),
        inicio,
        ultimoSinal,
        // O total do LOTE, não o número de linhas: dez ativações da mesma ferramenta são uma
        // entrada com `contagem: 10`, e contar entradas mediria descargas em vez de gestos.
        eventos.reduce((soma, e) => soma + e.contagem, 0),
        lote.erros ?? 0,
        inteiroOuNulo(vitais.lcpMs),
        inteiroOuNulo(vitais.inpMs),
        // Ver `inteiroOuNulo`: `cls` é a exceção, e o `?? null` existe porque `undefined`
        // chegaria ao driver como o literal `undefined` e não como NULL.
        Number.isFinite(vitais.cls) ? vitais.cls : null,
        inteiroOuNulo(vitais.tempoAteMapaMs),
      ]);
    });
  } catch (err) {
    throw new ServiceUnavailableError(
      'Não foi possível registrar o uso agora. Tente novamente em instantes.',
      { cause: err }
    );
  }

  // DEPOIS da escrita, e AGUARDADA em vez de solta como promessa pendente: uma promessa sem
  // dono que rejeitasse viraria `unhandledRejection`, e no Node 22 isso derruba o processo.
  // `agregarEPodar` não lança, e o CUSTO dela está declarado no cabeçalho: ela não é grátis,
  // ela é RARA (no máximo uma por hora por processo) e limitada por dois tetos.
  //
  // O CUSTO MEDIDO, para quem for mexer: a agregação é uma varredura de `uso_sessoes` recortada
  // em `dia >= hoje - retenção` (o índice `idx_uso_sessoes_dia` a guia) com `percentile_cont`
  // sobre cinco colunas, agrupada por (dia, página); com trinta dias de retenção isso é da
  // ordem de trinta vezes quatro grupos, e o trabalho cresce com o número de SESSÕES da
  // retenção, não com o histórico. A poda é um `DELETE` com `LIMIT` de cinco mil. A requisição
  // que pagar essa conta é uma em cada hora, e ela já respondeu 204 antes: o que se atrasa é o
  // fim do handler, nunca o registro do lote.
  await agregarEPodar(opcoesDeManutencao);
}
