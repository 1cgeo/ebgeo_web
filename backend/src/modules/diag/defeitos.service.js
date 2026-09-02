// Path: src/modules/diag/defeitos.service.js
/**
 * @fileoverview Metade B: o erro do NAVEGADOR, que sem isto não existia em lugar nenhum,
 * mais o DEFEITO como entidade com ciclo de vida e ocorrências.
 *
 * ESTE ARQUIVO TAMBÉM É QUEM PODA A TABELA, e a poda mora aqui porque é aqui que a tabela
 * cresce. Até 2026-09-01 `client_errors` (hoje `defeitos`) não tinha um DELETE em lugar
 * nenhum do pacote: nem rota, nem job, nem roteiro. A dedupe por assinatura só segura quando
 * a assinatura REPETE, e a assinatura é montada no cliente, então dentro do próprio limitador
 * de um endereço só cabiam dezenas de milhares de linhas novas por dia, permanentes. O
 * cabeçalho de `src/database/migrations/014_observabilidade.sql` diz que a tabela existe para
 * evitar que a telemetria vire o segundo incidente; sem poda, ela virava.
 *
 * O DEFEITO E A OCORRÊNCIA SÃO ESCRITOS NA MESMA TRANSAÇÃO, e o teto de vinte é aplicado
 * dentro dela. Ver `gravarDefeitoComOcorrencia`.
 */

import config from '../../config.js';
import logger from '../../utils/logger.js';
import { any, oneOrNone, tx } from '../../database/index.js';
import { createAudit } from '../../utils/audit.js';
import { ValidationError } from '../../utils/errors.js';
import { parseJanela } from '../../utils/diag-consulta.js';
import {
  UPSERT_DEFEITO,
  INSERT_OCORRENCIA,
  DELETE_OCORRENCIAS_EXCEDENTES,
  LIST_OCORRENCIAS,
  LIST_DEFEITOS,
  SELECT_DEFEITO_POR_ID,
  SELECT_ESTADO_DE_DEFEITO,
  UPDATE_ESTADO_DE_DEFEITO,
  SELECT_ATOR_POR_USERNAME,
  LIST_ERROS_CLIENTE,
  DELETE_DEFEITOS_EXPIRADOS,
} from './defeitos.queries.js';

/** `''` é o que um cliente manda quando não tem o campo; no banco isso é NULL. */
const vazioVirando = (v) => (v === undefined || v === null || v === '' ? null : v);

/**
 * A INVARIANTE: TODO parâmetro que vai para uma coluna JSONB passa por aqui.
 *
 * Não é um ajuste de `migalhas`, é a regra de passagem desta camada, e ela é escrita assim
 * porque a exceção é INVISÍVEL no ponto de uso. O pg-promise serializa um OBJETO para JSON
 * sozinho, mas formata um ARRAY como literal de array do POSTGRES (`array[...]`), que a
 * coluna `jsonb` recusa com 42804. Medido, não suposto: o sintoma é um 500 na única rota
 * anônima que escreve, ou seja, a rota que existe para registrar falhas produzindo a sua, e
 * ele aparece só quando o valor daquele campo é um array. Um campo hoje sempre-objeto que
 * passe a aceitar array (uma lista de causas em `contexto`, por exemplo) quebraria em
 * produção sem nada ficar vermelho.
 *
 * Por isso ela envolve os DOIS campos JSONB nos DOIS sítios de escrita, mesmo onde o array
 * ainda não é possível: aplicar caso a caso transforma uma regra em quatro decisões, e a
 * quarta é a que alguém esquece. É INÓCUA para objeto, `null` e `undefined` (devolve o
 * mesmo valor), então o custo de aplicá-la sempre é zero.
 *
 * A conversão é para TEXTO e não para objeto-embrulhado porque o texto é coagido a `jsonb`
 * pela própria coluna, sem `::jsonb` na query, e a query fica igual para os dois campos.
 */
const comoJsonb = (v) => (Array.isArray(v) ? JSON.stringify(v) : v);

/**
 * QUANTAS OCORRÊNCIAS UM DEFEITO GUARDA. Ver o cabeçalho de
 * `DELETE_OCORRENCIAS_EXCEDENTES`, que é onde mora o argumento.
 *
 * Vinte, e não cem nem cinco: é o bastante para responder "quantas abas diferentes", "só na
 * página X?" e "só depois de perder a conexão?", que são as três perguntas que a linha
 * agregada não responde, e é pouco o suficiente para que o pior caso do produto (um laço de
 * render em toda a OM durante um deploy ruim) custe um teto conhecido de linhas por defeito
 * em vez de um crescimento sem limite.
 */
export const TETO_DE_OCORRENCIAS = 20;

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
 * O teto de linhas por passada. Ver o cabeçalho de `DELETE_DEFEITOS_EXPIRADOS`: ele
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
    const apagadas = await any(DELETE_DEFEITOS_EXPIRADOS, [retencaoDias, teto]);
    if (apagadas.length > 0) {
      registrar.info(
        { podadas: apagadas.length, retencaoDias, teto },
        'poda de defeitos'
      );
    }
    return { podou: true, apagadas: apagadas.length };
  } catch (err) {
    registrar.warn({ err, retencaoDias, teto }, 'falha ao podar defeitos');
    return { podou: false, motivo: 'falha' };
  }
}

/**
 * Escreve o defeito (upsert) e UMA ocorrência, e aplica o teto. TUDO na mesma transação.
 *
 * A ATOMICIDADE É O PONTO, e ela tem duas metades. A primeira é o par defeito/ocorrência:
 * a ocorrência referencia o defeito por FK, e escrevê-la fora da transação abriria a janela
 * em que a poda (ou um administrador excluindo) apaga o defeito entre as duas escritas, o
 * que resulta em 23503 no caminho que existe para registrar falhas. A segunda é o TETO:
 * aplicado fora, ele deixa de ser invariante e vira "quase sempre vinte", com o pico
 * exatamente durante a rajada que ele existe para conter.
 *
 * ELE RECEBE O CONTEXTO `t` EM VEZ DE ABRIR A TRANSAÇÃO, porque a descarga do agregador de
 * servidor grava vários defeitos e precisa decidir por si o agrupamento (ver
 * `defeitos-de-servidor.js`). É a mesma convenção de `createAudit(req, p, t)`.
 *
 * @param {Object} t - contexto de transação do pg-promise
 * @param {Object} dados
 * @returns {Promise<string>} o id do defeito
 */
export async function gravarDefeitoComOcorrencia(t, dados) {
  const {
    assinatura, mensagem, stack = null, url = null, pagina = null, userAgent = null,
    release = null, userId = null, atlasId = null, sessaoId = null, stackBruta = null,
    origem = null, contexto = null, migalhas = null, reqId = null, rota = null,
    statusCode = null, incremento = 1, teto = TETO_DE_OCORRENCIAS,
  } = dados;

  const { id } = await t.one(UPSERT_DEFEITO, [
    assinatura, mensagem, stack, url, pagina, userAgent, release, userId, atlasId,
    sessaoId, stackBruta, origem, comoJsonb(contexto), incremento,
  ]);

  await t.none(INSERT_OCORRENCIA, [
    id, release, sessaoId, userId, pagina, url, userAgent, origem,
    comoJsonb(migalhas), comoJsonb(contexto), reqId, rota, statusCode,
  ]);

  await t.none(DELETE_OCORRENCIAS_EXCEDENTES, [id, teto]);
  return id;
}

/**
 * Registra (ou incrementa) um erro de navegador.
 *
 * `userId` é PARÂMETRO, e é o chamador (o controller) que o tira de `req.user`. Escrever
 * `relato.userId` aqui seria aceitar do corpo a identidade de quem relata, ou seja,
 * deixar qualquer anônimo carimbar um erro no nome de outra pessoa. A assinatura desta
 * função existe assim para que esse erro precise ser cometido de propósito.
 *
 * A PODA VEM DEPOIS DA ESCRITA, e a ordem é o contrato: primeiro o serviço (registrar),
 * depois a higiene (apagar o que envelheceu). Ela é AGUARDADA em vez de solta como promessa
 * pendente porque uma promessa sem dono que rejeitasse viraria `unhandledRejection`, e no
 * Node 22 isso derruba o processo: trocar um DELETE de meio segundo por hora pelo risco de
 * matar o servidor é o câmbio errado. `talvezPodar` não lança e é barata por construção.
 *
 * A PODA FICA FORA DA TRANSAÇÃO de propósito: ela é higiene de OUTRAS linhas, e prendê-la à
 * mesma transação faria uma falha dela desfazer o relato que acabou de ser gravado, que é o
 * oposto do que a rota existe para fazer.
 *
 * @param {Object} relato - o corpo já validado por Joi (tetos de tamanho aplicados)
 * @param {string|null} userId - o principal autenticado, ou null (anônimo)
 * @param {Object} [opcoesDePoda] - injeções repassadas a `talvezPodar` (só teste)
 * @returns {Promise<void>}
 */
export async function registrarErroDeCliente(relato, userId, opcoesDePoda) {
  await tx((t) => gravarDefeitoComOcorrencia(t, {
    assinatura: relato.assinatura,
    mensagem: relato.mensagem,
    stack: vazioVirando(relato.stack),
    url: vazioVirando(relato.url),
    pagina: vazioVirando(relato.pagina),
    userAgent: vazioVirando(relato.userAgent),
    release: vazioVirando(relato.release),
    userId: userId ?? null,
    atlasId: vazioVirando(relato.atlasId),
    sessaoId: vazioVirando(relato.sessaoId),
    stackBruta: vazioVirando(relato.stackBruta),
    origem: vazioVirando(relato.origem),
    // O `vazioVirando` continua servindo porque o cliente pode mandar o campo ausente; quem
    // decide a FORMA de passagem para o JSONB é `comoJsonb`, uma camada abaixo, e ele é o
    // único ponto que precisa saber que objeto e array atravessam o driver de jeitos
    // diferentes.
    contexto: vazioVirando(relato.contexto),
    // As MIGALHAS só existem na ocorrência, nunca no defeito. Elas são o rastro daquela
    // aba naquele instante, e agregá-las na linha do defeito significaria guardar as do
    // último relato e jogar fora as das outras dezenove, que é a informação toda.
    migalhas: vazioVirando(relato.migalhas),
  }));

  await talvezPodar(opcoesDePoda);
}

/**
 * O item da listagem, na forma que o cliente lê. Compartilhado pelas duas rotas.
 *
 * ELE PARA NO SHAPE ANTIGO de propósito: é o que `GET /diag/erros-cliente` devolve, e aquele
 * contrato está congelado enquanto a aba de Administração o consumir. Quem precisa do ciclo
 * de vida usa `itemDeDefeitoCompleto`, logo abaixo.
 */
function itemDeDefeito(l) {
  return {
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
  };
}

/**
 * O item COM o ciclo de vida: o que `GET /diag/defeitos` e `obterDefeito` devolvem.
 *
 * UM MAPEADOR SÓ PARA OS DOIS, e é a razão de ele existir separado: a listagem e a busca por
 * id passam pelo MESMO formatador na saída do comando, então um campo que só um dos dois
 * preenchesse apareceria como `undefined` numa tela e com valor na outra, o que se lê como
 * dado ausente no banco. As colunas das duas queries são iguais (ver `SELECT_DEFEITO_POR_ID`)
 * justamente para que este mapeador sirva as duas sem um ramo condicional.
 *
 * @param {Object} l - linha de `LIST_DEFEITOS` ou de `SELECT_DEFEITO_POR_ID`
 * @returns {Object}
 */
function itemDeDefeitoCompleto(l) {
  return {
    ...itemDeDefeito(l),
    estado: l.estado,
    resolvidoEm: l.resolvido_em === null ? null : new Date(l.resolvido_em).getTime(),
    resolvidoPor: l.resolvido_por,
    resolvidoPorUsername: l.resolvido_por_username,
    resolvidoNaRelease: l.resolvido_na_release,
    resolvidoNoCommit: l.resolvido_no_commit,
    primeiraRelease: l.primeira_release,
    ultimaRelease: l.ultima_release,
  };
}

/**
 * Os erros de navegador da janela, do mais recente para o mais antigo. TRANSITÓRIA.
 *
 * O SHAPE É CONGELADO ENQUANTO A ABA DE ADMINISTRAÇÃO A CONSUMIR (troca no lote C): mesmas
 * chaves, mesmo `totalAssinaturas`, mesma ordem. O que mudou embaixo dela é o nome da tabela
 * e o recorte por origem, e nada disso atravessa para o cliente.
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
 * isso está escrito no cabeçalho de `LIST_ERROS_CLIENTE`.
 *
 * @param {{desde: string, limite: number}} query - já validada
 * @returns {Promise<{desde: number, totalAssinaturas: number, itens: Object[]}>}
 */
export async function listarErrosDeCliente({ desde, limite }) {
  const inicio = new Date(Date.now() - parseJanela(desde));
  const linhas = await any(LIST_ERROS_CLIENTE, [inicio, limite]);
  return {
    desde: inicio.getTime(),
    totalAssinaturas: linhas.length > 0 ? linhas[0].total_assinaturas : 0,
    itens: linhas.map(itemDeDefeito),
  };
}

/**
 * Os DEFEITOS da janela, com o ciclo de vida, do mais recente para o mais antigo.
 *
 * É a listagem de `GET /diag/defeitos`, e o que ela tem a mais que a transitória acima é
 * exatamente o lote B: `estado`, quem resolveu, em qual release e em qual commit, mais as
 * duas releases de avistamento. O `origem` NÃO é recortado aqui: o 5xx do servidor é um
 * defeito como os outros, e quem quiser separá-los usa o filtro `origem`.
 *
 * OS FILTROS AUSENTES VIRAM `null`, e é o SQL que decide o que fazer com eles (ver o
 * cabeçalho de `LIST_DEFEITOS`). O `novos` vira BOOLEANO aqui, e não string: é o único
 * parâmetro cuja ausência tem um valor natural (falso), e deixá-lo chegar como `undefined`
 * ao driver faria o `NOT $6::boolean` avaliar NULL e devolver ZERO linhas, calado.
 *
 * @param {{desde: string, estado?: string, origem?: string, release?: string,
 *          pagina?: string, novos?: boolean, limite: number}} query - já validada
 * @returns {Promise<{desde: number, totalDefeitos: number, itens: Object[]}>}
 */
export async function listarDefeitos({ desde, estado, origem, release, pagina, novos, limite }) {
  const inicio = new Date(Date.now() - parseJanela(desde));
  const linhas = await any(LIST_DEFEITOS, [
    inicio,
    estado ?? null,
    origem ?? null,
    release ?? null,
    pagina ?? null,
    novos === true,
    limite,
  ]);
  return {
    desde: inicio.getTime(),
    totalDefeitos: linhas.length > 0 ? linhas[0].total_defeitos : 0,
    itens: linhas.map(itemDeDefeitoCompleto),
  };
}

/**
 * UM defeito pelo id, no MESMO shape que a listagem devolve, ou `null`.
 *
 * ELA EXISTE PARA QUE HAJA UM MAPEAMENTO SÓ. O comando `diag defeitos --id` e o `diag pilha`
 * precisavam desta consulta e, enquanto este módulo esteve congelado, carregaram uma cópia do
 * SELECT e do mapeador dentro do próprio comando. Duas cópias de um mapeamento de colunas
 * divergem no primeiro campo novo, e a divergência é SILENCIOSA: `defeitos` e `defeitos --id`
 * passariam a responder objetos diferentes sobre o mesmo defeito, que é exatamente a
 * comparação que um agente faz para se orientar.
 *
 * `oneOrNone` E NÃO `one`: id que não existe é desfecho NORMAL, não erro. A poda por idade
 * apaga defeito e ocorrências juntos, então um id que a listagem mostrou minutos atrás pode
 * ter envelhecido, e quem chama precisa poder dizer isso com as próprias palavras em vez de
 * receber uma exceção do driver.
 *
 * @param {string} id - UUID; a validação de forma é de quem chama (o 22P02 do driver é
 *   ilegível no terminal, e a rota tem `guid()` no Joi por isso)
 * @returns {Promise<Object|null>}
 */
export async function obterDefeito(id) {
  const linha = await oneOrNone(SELECT_DEFEITO_POR_ID, [id]);
  return linha === null ? null : itemDeDefeitoCompleto(linha);
}

/**
 * As ocorrências de um defeito (no máximo `TETO_DE_OCORRENCIAS`), da mais recente à mais
 * antiga.
 *
 * NÃO HÁ PAGINAÇÃO, e a ausência é consequência do teto, não esquecimento: a tabela nunca
 * guarda mais de vinte por defeito, então "a próxima página" não existe. Um `?offset=` aqui
 * prometeria um histórico que a escrita apaga por desenho.
 *
 * DEFEITO INEXISTENTE DEVOLVE LISTA VAZIA, não 404: a poda pode ter passado entre a
 * listagem que o administrador está olhando e o clique dele, e um 404 nesse caso leria como
 * "a rota está quebrada" em vez de "isto envelheceu".
 *
 * @param {string} defeitoId
 * @returns {Promise<{itens: Object[]}>}
 */
export async function listarOcorrencias(defeitoId) {
  const linhas = await any(LIST_OCORRENCIAS, [defeitoId, TETO_DE_OCORRENCIAS]);
  return {
    itens: linhas.map((l) => ({
      id: l.id,
      defeitoId: l.defeito_id,
      em: new Date(l.em).getTime(),
      release: l.release,
      sessaoId: l.sessao_id,
      userId: l.user_id,
      username: l.username,
      pagina: l.pagina,
      url: l.url,
      userAgent: l.user_agent,
      origem: l.origem,
      migalhas: l.migalhas,
      contexto: l.contexto,
      reqId: l.req_id,
      rota: l.rota,
      statusCode: l.status_code,
    })),
  };
}

/**
 * A AÇÃO DA TRILHA para os três atos de ciclo de vida.
 *
 * UMA para as três transições, e não uma por transição. A pergunta que `idx_audit_target`
 * responde é "tudo que já foi feito com este defeito", e três ações partiriam a história de
 * um mesmo defeito em três listas que não se cruzam. O que distingue os atos é o `de`/`para`
 * dos detalhes, que é onde a informação de fato está. O argumento por extenso está no
 * cabeçalho de `019_defeito_estado_auditado.sql`.
 */
export const ACAO_DE_ESTADO = 'DEFEITO_ESTADO';

/**
 * O teto do `target_name` desta linha de trilha.
 *
 * `audit_trail.target_name` é `VARCHAR(255)` e a `assinatura` é `VARCHAR(300)`: sem corte,
 * uma assinatura longa derruba o INSERT com 22001 DENTRO da transação do ato, e o
 * administrador recebe 500 ao resolver um defeito, por um motivo sem relação aparente com o
 * que ele pediu. 200 e não 255 porque a folga também precisa sobreviver a alguém alargar a
 * assinatura depois; o valor inteiro continua na própria linha de `defeitos`, que a trilha
 * referencia por `target_id`.
 */
export const TETO_DO_ALVO_NA_TRILHA = 200;

/**
 * O TETO DO `commit`, e ele mora AQUI porque as bordas são DUAS.
 *
 * O CHECK da coluna (`018_defeitos_e_ocorrencias.sql`) recusa acima de 64, que é o
 * comprimento de um SHA-256 em hexadecimal. A rota já tinha o teto no Joi e respondia 422
 * nomeando o campo; o COMANDO não tinha nada, e um `--commit` de 65 caracteres descia até o
 * banco e voltava como 23514 com pilha crua no terminal, ou seja, a mesma classe de erro
 * ilegível que a validação de uuid na borda existe para evitar.
 *
 * A CORREÇÃO É O PONTO COMUM, e não uma segunda cópia do teto no comando: uma verificação
 * por borda é uma verificação que a próxima borda esquece, e já são duas. Aqui ela vale para
 * as duas e valeria para uma terceira. O Joi da rota CONTINUA existindo, e isso não é
 * redundância inútil: ele recusa ANTES de abrir transação e devolve o 422 que o contrato
 * HTTP promete, enquanto este é o piso que nenhum chamador contorna.
 *
 * RECUSA E NÃO TRUNCAGEM. Aparar um hash de commit em silêncio produziria uma referência que
 * não resolve em `git show`, com cara de referência boa; a frase nomeia o campo e o
 * comprimento, que é o que a pessoa precisa para corrigir.
 */
export const TETO_DO_COMMIT = 64;

/**
 * Resolve a conta que o COMANDO vai usar como ator, ou diz por que não dá.
 *
 * ELE EXISTE PORQUE O TERMINAL NÃO TEM SESSÃO e `audit_trail.actor_id` é `NOT NULL`. As duas
 * saídas fáceis foram recusadas: ator nulo esbarra no schema, e um id de sistema inventado
 * produziria uma trilha em que o ato mais consequente deste módulo não tem autor. Quem
 * digitou o comando foi uma pessoa, e `--como` obriga a dizer qual.
 *
 * `--como` NÃO É AUTENTICAÇÃO, e a honestidade sobre isso é o que impede alguém de tratá-lo
 * como se fosse: quem tem shell no servidor já tem `DATABASE_URL` e pode escrever na tabela
 * direto. O que a bandeira compra é ATRIBUIÇÃO, não controle de acesso, ou seja a trilha
 * passa a dizer quem operou em vez de dizer "o sistema", que é a resposta que nenhuma
 * investigação aceita. O gate de papel existe pela mesma razão de ser honesto: o comando não
 * deve permitir carimbar como ator uma conta que a ROTA equivalente recusaria, senão a
 * trilha ganharia atos de administrador assinados por quem não administra nada.
 *
 * A DISTINÇÃO ENTRE OS DOIS MOTIVOS É O PONTO DA FUNÇÃO. "Não existe" e "não é
 * administrador" mandam fazer coisas opostas (conferir o que se digitou, ou pedir a outra
 * pessoa), e é por isso que o papel NÃO entra no predicado do SQL: filtrado lá, os dois
 * casos voltariam como a mesma lista vazia e o comando teria de escolher uma frase, errada
 * em metade das vezes.
 *
 * @param {string} username
 * @returns {Promise<{ator: {id: string, username: string}|null, motivo: string|null}>}
 */
export async function resolverAtorAdministrador(username) {
  const linha = await oneOrNone(SELECT_ATOR_POR_USERNAME, [username]);
  if (!linha) return { ator: null, motivo: 'inexistente' };
  // O EIXO AQUI É O GLOBAL, e ele NÃO é uma escada: `producer` e `credenciado` não contêm
  // nem são contidos por `admin`, então a comparação é de igualdade e nunca de ordem. É o
  // mesmo gate de `requireAdmin` (`src/middleware/require-admin.js`), pela mesma razão:
  // manter acervo e ler recurso privado não são administrar o sistema.
  if (linha.role !== 'admin') return { ator: null, motivo: 'sem-papel' };
  return { ator: { id: linha.id, username: linha.username }, motivo: null };
}

/**
 * Muda o ESTADO de um defeito, e deixa trilha. É o ato do lote C.
 *
 * TODA TRANSIÇÃO É PERMITIDA A PARTIR DE QUALQUER ESTADO, e a ausência de máquina de estados
 * é decisão, não esquecimento. O ganho de proibir (digamos) ignorar um defeito já ignorado
 * seria nenhum; o custo é concreto e cai sempre sobre a pessoa certa pelo motivo errado: um
 * administrador que clicou em "resolvido" por engano precisa poder reabrir, e um que
 * resolveu sem anotar o commit precisa poder resolver de novo com ele. Uma guarda aqui
 * transformaria o conserto de um erro humano num 409 sem saída pela tela. O estado ANTERIOR
 * não se perde: ele vai para a trilha, em `details.de`, e é ali que a sequência de atos fica
 * legível.
 *
 * `regrediu` NÃO É ESCRITO POR AQUI, e quem impede são as duas bordas: `ESTADOS_MANUAIS` no
 * Joi da rota e a mesma lista na validação do comando. Ele é a única transição automática do
 * produto (o CASE de `UPSERT_DEFEITO`) e significa um FATO sobre duas releases, não um juízo.
 *
 * A TRILHA VAI NA MESMA TRANSAÇÃO (`createAudit(req, payload, t)`), e não em best-effort: um
 * estado que muda sem linha de trilha é exatamente o buraco que `LOGIN`, `LOGOUT` e
 * `ATLAS_DELETE` tiveram desde o primeiro dia, e o custo de perder a linha aqui é mais alto
 * que o de recusar o ato, porque o ato é raro e refazível. O oposto vale para o LOGIN, e é
 * por isso que ele usa `createAuditBestEffort`: lá a trilha vale menos que a operação.
 *
 * O `de` VEM DE UM `SELECT ... FOR UPDATE`, e não da leitura otimista: `UPSERT_DEFEITO`
 * escreve a mesma linha a cada relato e pode mover `resolvido` para `regrediu` no meio. Ver
 * `SELECT_ESTADO_DE_DEFEITO`.
 *
 * A RELEASE É A DO SERVIDOR (`config.release`), NUNCA um campo do corpo. Ela responde "em
 * qual build o conserto entrou", e o único que sabe isso é o processo que está rodando o
 * conserto. Aceitá-la do chamador deixaria um administrador anotar uma build que nunca
 * existiu, e `resolvido_na_release` é justamente a coluna que decide REGRESSÃO: um valor
 * inventado ali faz o produto acusar (ou deixar de acusar) regressão para sempre. Em
 * desenvolvimento ela é `undefined`, e o `?? null` a grava como "não anotada", que é o que
 * `imprimirUmDefeito` já sabe dizer.
 *
 * O QUE "NÃO ANOTADA" CUSTA, e a leitura natural é o INVERSO do fato. A tentação é concluir
 * que sem release o defeito fica resolvido para sempre; é o contrário: `NULL` faz o
 * `IS DISTINCT FROM` do CASE de `UPSERT_DEFEITO` ser VERDADEIRO contra qualquer valor, então
 * a próxima ocorrência que TRAGA release reabre o defeito como `regrediu`. É o desfecho
 * conservador certo (sem saber em qual build o conserto entrou, não dá para afirmar que a
 * ocorrência nova veio da build velha), e o comando avisa em voz alta, porque quem resolveu
 * precisa esperar ver o defeito voltar. Ocorrência SEM release não move nada, pelo
 * `AND EXCLUDED.release IS NOT NULL` do mesmo CASE.
 *
 * @param {Object} params
 * @param {string} params.id - UUID do defeito; a forma é validada por quem chama
 * @param {string} params.estado - um de `ESTADOS_MANUAIS`
 * @param {string|null} [params.commit] - só faz sentido com `resolvido`
 * @param {string} params.userId - o ator; da sessão na rota, de `--como` no comando
 * @param {Object|null} [params.req] - Express req, ou um parcial `{ ip, get }` (o comando
 *   não tem nenhum, e `createAudit` degrada para `ip: 'system'`)
 * @returns {Promise<{item: Object, de: string, para: string}|null>} `null` se o id não existe
 */
export async function mudarEstadoDoDefeito({ id, estado, commit = null, userId, req = null }) {
  const release = config.release ?? null;
  const commitLimpo = vazioVirando(commit);

  // A GUARDA VEM ANTES DA TRANSAÇÃO, e a ordem importa: dentro dela a recusa custaria um
  // `SELECT ... FOR UPDATE` e um rollback para dizer que um argumento estava longo demais.
  if (commitLimpo !== null && commitLimpo.length > TETO_DO_COMMIT) {
    throw new ValidationError(
      `commit: no máximo ${TETO_DO_COMMIT} caracteres (recebi ${commitLimpo.length}). `
      + 'É o teto do CHECK da coluna, que é o comprimento de um SHA-256 em hexadecimal.'
    );
  }

  return tx(async (t) => {
    const antes = await t.oneOrNone(SELECT_ESTADO_DE_DEFEITO, [id]);
    // NULO E NÃO EXCEÇÃO: id inexistente é desfecho normal aqui pela mesma razão de
    // `obterDefeito`. A poda por idade apaga defeito e ocorrências juntos, então um id que a
    // tela mostrou minutos atrás pode ter envelhecido, e quem chama precisa poder dizer isso
    // com as próprias palavras (404 na rota, frase própria no comando).
    if (!antes) return null;

    await t.none(UPDATE_ESTADO_DE_DEFEITO, [id, estado, userId, release, commitLimpo]);

    await createAudit(req, {
      action: ACAO_DE_ESTADO,
      actorId: userId,
      // 'SYSTEM' porque um defeito não é recurso de acesso: não pertence a OM nenhuma, não é
      // concedível e não tem dono. E `targetId` VAI PREENCHIDO, que é o que separa este uso
      // do abuso que o cabeçalho de `002_auditoria.sql` denuncia: 'SYSTEM' significa
      // sistema, e já foi depósito do alvo que não coube.
      targetType: 'SYSTEM',
      targetId: id,
      targetName: String(antes.assinatura ?? '').slice(0, TETO_DO_ALVO_NA_TRILHA),
      // O `de`/`para` é o que faz UMA ação servir às três transições. `commit` entra mesmo
      // nulo: a ausência dele numa linha de `resolvido` é informação (ninguém anotou), e
      // omitir a chave faria "não anotou" e "versão antiga do servidor" ficarem iguais.
      details: { de: antes.estado, para: estado, commit: commitLimpo },
    }, t);

    const depois = await t.one(SELECT_DEFEITO_POR_ID, [id]);
    return { item: itemDeDefeitoCompleto(depois), de: antes.estado, para: estado };
  });
}
