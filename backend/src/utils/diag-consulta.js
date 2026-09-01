// Path: src/utils/diag-consulta.js
/**
 * @fileoverview A parte PURA da consulta ao log em arquivo. O comando vive em
 * `scripts/diag.js`; aqui ficam só funções sem efeito, que é o que as torna testáveis em
 * node e o que impede a próxima pessoa de conferir agregação à mão.
 *
 * PARA QUEM ISTO É. Para o operador no terminal e para um agente. As duas leituras pedem a
 * mesma coisa: texto determinístico, agrupado, com contagem. Um painel resolve para o
 * primeiro e é opaco para o segundo, e a operação desta instalação vai ser feita pelos dois.
 *
 * A DECISÃO QUE MOLDA TUDO: o agrupamento é por ASSINATURA, não por linha. Mil ocorrências
 * do mesmo defeito são uma linha com contagem mil, senão a saída é uma rolagem em que o
 * defeito raro (que costuma ser o grave) fica soterrado pelo defeito barulhento. Foi
 * exatamente essa a forma do incidente de 2026-08-30: dezenove linhas idênticas no console,
 * uma causa só.
 *
 * O ÚNICO IMPORT DAQUI é o marcador da amostra de saúde, e ele é import justamente para não
 * ser uma string digitada duas vezes: `amostra-de-saude.js` é folha de zero imports (não
 * arrasta `config.js`, que exigiria `DATABASE_URL` para ler log), e é essa propriedade que
 * torna o símbolo barato. Ver `resumirAmostras`.
 */

import { MARCADOR_AMOSTRA } from './amostra-de-saude.js';

/** Quanto tempo cada sufixo vale, em ms. */
const UNIDADES = Object.freeze({ m: 60_000, h: 3_600_000, d: 86_400_000 });

/**
 * Converte uma janela escrita à mão (`30m`, `24h`, `7d`) em milissegundos.
 *
 * Devolve `null` no que não entende, em vez de lançar ou de cair num default: um comando
 * que aceita `--desde 24hs` calado e mostra a última hora responde a outra pergunta e não
 * avisa, e quem lê a saída acha que viu as 24 horas.
 * @param {string} texto
 * @returns {number|null} milissegundos, ou null se a forma não for reconhecida
 */
export function parseJanela(texto) {
  const m = /^(\d+)([mhd])$/.exec(String(texto || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n <= 0) return null;
  return n * UNIDADES[m[2]];
}

/**
 * Os dias (AAAA-MM-DD, fuso local) cobertos por uma janela, do mais antigo ao mais novo.
 *
 * É o que decide QUAIS arquivos abrir. Inclui as duas pontas: uma janela de uma hora às
 * 00h30 atravessa a meia-noite e precisa do arquivo de ontem, e essa é justamente a hora em
 * que ninguém pensa nisso.
 * @param {Date} inicio
 * @param {Date} fim
 * @returns {string[]}
 */
export function diasDaJanela(inicio, fim) {
  const dias = [];
  const cursor = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
  const ultimo = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate());
  while (cursor <= ultimo) {
    const mes = String(cursor.getMonth() + 1).padStart(2, '0');
    const dia = String(cursor.getDate()).padStart(2, '0');
    dias.push(`${cursor.getFullYear()}-${mes}-${dia}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

const RE_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const RE_NUMERO_LONGO = /\b\d{3,}\b/g;

/**
 * A rota sem os identificadores, para que mil atlas diferentes virem uma linha.
 *
 * Sem isto o agrupamento não agrupa nada: cada `POST /atlas/<uuid>/sync` é uma assinatura
 * distinta, e o relatório volta a ser a rolagem que ele existe para substituir. A query
 * string sai inteira porque ela carrega valor, não estrutura (e porque pode carregar
 * credencial, embora `redactUrl` já cuide disso na escrita).
 * @param {string} url
 * @returns {string}
 */
export function normalizarRota(url) {
  const semQuery = String(url || '').split('?')[0];
  return semQuery.replace(RE_UUID, ':id').replace(RE_NUMERO_LONGO, ':n');
}

/**
 * É um registro de erro?
 *
 * TRÊS termos em OU, e os dois últimos são os que se esquecem: `level >= 50` pega tudo que
 * foi logado como `error`/`fatal`, mas o `errorHandler` desta casa loga 4xx em `warn` de
 * propósito (erro do cliente não é falha do servidor), e essas linhas entram pelos outros
 * dois: a PRESENÇA de `err`, que a linha do `errorHandler` carrega em qualquer nível, e o
 * `statusCode >= 400` da linha do `request-logger`. Sem o segundo e o terceiro, todo 400,
 * 401, 403 e 404 sumiria do relatório, inclusive o 400 em laço que motivou esta ferramenta.
 *
 * A contagem esteve escrita como DUAS até 2026-08-31, e a subcontagem não foi cosmética:
 * quem escolheu o nível da linha da amostra de saúde raciocinou sobre um `ehErro` menor que
 * o real, com ar de decisão verificada.
 * @param {Object} reg
 * @returns {boolean}
 */
export function ehErro(reg) {
  if (!reg || typeof reg !== 'object') return false;
  if (typeof reg.level === 'number' && reg.level >= 50) return true;
  return Boolean(reg.err) || (typeof reg.statusCode === 'number' && reg.statusCode >= 400);
}

/**
 * O que distingue DUAS amostras de saúde que reprovaram por motivos opostos.
 *
 * A amostra periódica não tem `url`, não tem `err.type` e não tem `statusCode`, então sobra
 * a `msg` e as linhas de "o Postgres caiu" e "o nosso pool está entupido" colapsam na MESMA
 * assinatura, somadas numa contagem só. As duas pedem providências opostas, e é exatamente
 * essa diferença que `sondarBancoComPrazo` (`amostra-de-saude.js`) se dá o trabalho de
 * preservar em `banco.motivo` (`'erro'` contra `'prazo'`).
 *
 * A DERIVAÇÃO É DO CAMPO ESTRUTURAL, nunca do texto da `msg`: casar por mensagem é o mesmo
 * acoplamento frágil que `fundirPorRequisicao` recusa por extenso, e aqui ele custaria o
 * dobro, porque a `msg` da amostra é declaradamente cosmética (`MSG_AMOSTRA` diz isso).
 *
 * Registro que não é amostra devolve string vazia e sai da junção pelo `filter(Boolean)`:
 * nenhuma assinatura existente muda de forma.
 * @param {Object} reg
 * @returns {string}
 */
function detalheDeAmostra(reg) {
  if (!reg || reg.amostra !== MARCADOR_AMOSTRA) return '';
  // A falha do PRÓPRIO amostrador é outra coisa que a falha do banco, e ela não traz
  // `banco` nenhum: sem este ramo ela se juntaria às linhas saudáveis pela mensagem.
  if (reg.falhou === true) return 'amostrador falhou';
  if (!reg.banco || reg.banco.ok !== false) return '';
  return `banco fora (${reg.banco.motivo || 'motivo não declarado'})`;
}

/**
 * A chave de agrupamento de um registro de erro.
 * @param {Object} reg
 * @returns {string}
 */
export function assinaturaDeErro(reg) {
  const tipo = reg.err && reg.err.type ? reg.err.type : '';
  const msg = (reg.err && reg.err.message) || reg.msg || '(sem mensagem)';
  const rota = reg.url ? `${reg.method || ''} ${normalizarRota(reg.url)}`.trim() : '';
  const status = typeof reg.statusCode === 'number' ? ` [${reg.statusCode}]` : '';
  return [rota, tipo, msg, detalheDeAmostra(reg)].filter(Boolean).join(' | ') + status;
}

/**
 * Funde as DUAS linhas que uma requisição falha produz.
 *
 * O `errorHandler` loga o objeto de erro com a pilha; o `request-logger` loga status e
 * duração. São linhas diferentes, da mesma requisição, e sem isto cada erro entrava no
 * relatório DUAS vezes e ainda em duas assinaturas distintas (medido em 2026-08-30: quatro
 * ocorrências para dois erros reais).
 *
 * A REGRA NÃO OLHA O TEXTO DA MENSAGEM. Ficaria uma linha mais curta perguntar por
 * `msg === 'request error'`, e seria a mesma classe de acoplamento frágil que já custou
 * caro aqui: renomear a mensagem deixaria o relatório calado e correto na aparência. A
 * regra é estrutural: para um mesmo `reqId`, fica o registro que carrega `err`, porque é o
 * que tem tipo e pilha; o outro é descartado com o `statusCode` copiado para dentro dele,
 * que é a única informação que só ele tinha.
 *
 * Registro sem `reqId` passa intacto: é o caso da falha anterior ao logger de requisição, e
 * o de qualquer `logger.error` fora do ciclo HTTP (o sweep do WS, um job).
 *
 * O CUSTO É LINEAR, E ISSO NÃO É MICRO-OTIMIZAÇÃO. Até 2026-08-31 o parceiro era procurado
 * com um `registros.find(...)` DENTRO do laço de saída, ou seja, uma varredura da lista
 * inteira por requisição falha. Medido nesta máquina: 100 mil registros levavam 8,9 s e 200
 * mil (que é exatamente o `MAX_REGISTROS` de `src/modules/diag/diag.service.js`) passavam de
 * meio minuto, com o event loop preso o tempo todo. O gatilho é o administrador abrir a aba
 * Diagnóstico DURANTE um incidente, que é a única hora em que a janela tem esse volume: o
 * diagnóstico derrubava o servidor exatamente quando ele é preciso.
 *
 * OS DOIS CANDIDATOS, que é a parte que não se adivinha. A busca linear excluía o próprio
 * registro rico (`r !== rico`), e o rico de um `reqId` só se conhece no FIM da passada,
 * porque com dois ricos no mesmo `reqId` o `ricos.set` mantém o último. Guardar só o
 * primeiro `statusCode` mudaria a resposta no caso realista em que a linha do
 * `errorHandler` também carrega status: ela viraria o próprio parceiro e o status da linha
 * de requisição sumiria. Como a busca excluía UM objeto, guardar os DOIS primeiros
 * candidatos DISTINTOS basta para reproduzi-la, e a distinção é por IDENTIDADE porque a
 * mesma referência pode aparecer duas vezes na lista, e a busca pulava as duas ocorrências.
 * A alternativa recusada foi uma segunda passada só para isto: seria igualmente linear e
 * uma passada a mais sobre a lista maior que esta ferramenta manipula.
 * @param {Object[]} registros
 * @returns {Object[]}
 */
export function fundirPorRequisicao(registros) {
  const ricos = new Map();
  const candidatos = new Map();
  for (const reg of registros) {
    if (!reg || !reg.reqId) continue;
    if (reg.err) ricos.set(reg.reqId, reg);
    if (typeof reg.statusCode !== 'number') continue;
    const par = candidatos.get(reg.reqId);
    if (!par) candidatos.set(reg.reqId, [reg]);
    else if (par.length === 1 && par[0] !== reg) par.push(reg);
  }
  const saida = [];
  for (const reg of registros) {
    if (!reg || !reg.reqId) { saida.push(reg); continue; }
    const rico = ricos.get(reg.reqId);
    if (!rico) { saida.push(reg); continue; }
    if (reg !== rico) continue;
    // O status vive só na linha de requisição; sem copiá-lo, a fusão perderia o 400/404
    // que a assinatura mostra entre colchetes.
    const pares = candidatos.get(reg.reqId);
    const par = pares && (pares[0] !== rico ? pares[0] : pares[1]);
    saida.push(par ? { ...rico, statusCode: par.statusCode } : rico);
  }
  return saida;
}

/**
 * Agrupa erros por assinatura, do mais frequente para o menos.
 *
 * O desempate é pela ocorrência MAIS RECENTE, e não é enfeite: duas assinaturas com a mesma
 * contagem quase sempre são o mesmo incidente visto de dois ângulos, e quem investiga quer
 * o lado que ainda está acontecendo em cima.
 * @param {Object[]} registros
 * @returns {Array<{assinatura: string, total: number, primeira: number, ultima: number, exemplo: Object}>}
 */
export function agruparErros(registros) {
  const mapa = new Map();
  for (const reg of fundirPorRequisicao(registros)) {
    if (!ehErro(reg)) continue;
    const chave = assinaturaDeErro(reg);
    const t = typeof reg.time === 'number' ? reg.time : 0;
    const atual = mapa.get(chave);
    if (!atual) {
      mapa.set(chave, { assinatura: chave, total: 1, primeira: t, ultima: t, exemplo: reg });
      continue;
    }
    atual.total += 1;
    if (t < atual.primeira) atual.primeira = t;
    if (t > atual.ultima) { atual.ultima = t; atual.exemplo = reg; }
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total || b.ultima - a.ultima);
}

/**
 * Percentil por posto (nearest-rank), sobre uma lista JÁ ordenada.
 *
 * Nearest-rank e não interpolação linear: o valor devolvido é uma medição que de fato
 * ocorreu, o que importa quando o número vai virar um "a rota X levou 4,2 s" numa conversa.
 * @param {number[]} ordenados - ascendente
 * @param {number} p - 0..100
 * @returns {number|null} null para lista vazia, porque zero seria uma medição inventada
 */
export function percentil(ordenados, p) {
  if (!ordenados.length) return null;
  const posto = Math.ceil((p / 100) * ordenados.length);
  return ordenados[Math.min(Math.max(posto, 1), ordenados.length) - 1];
}

/**
 * Latência por rota, a partir do `duration` que o `requestLogger` já carimba em toda
 * requisição. Nenhuma instrumentação nova: a medição já existia e ninguém a guardava.
 *
 * Ordenado por p95 e não por média, porque média esconde exatamente a cauda que faz o
 * usuário dizer "está lento".
 * @param {Object[]} registros
 * @returns {Array<{rota: string, n: number, p50: number, p95: number, max: number}>}
 */
export function resumirLatencia(registros) {
  const porRota = new Map();
  for (const reg of registros) {
    if (!reg || typeof reg.duration !== 'number' || !reg.url) continue;
    const rota = `${reg.method || ''} ${normalizarRota(reg.url)}`.trim();
    if (!porRota.has(rota)) porRota.set(rota, []);
    porRota.get(rota).push(reg.duration);
  }
  const linhas = [];
  for (const [rota, valores] of porRota) {
    valores.sort((a, b) => a - b);
    linhas.push({
      rota,
      n: valores.length,
      p50: percentil(valores, 50),
      p95: percentil(valores, 95),
      max: valores[valores.length - 1],
    });
  }
  return linhas.sort((a, b) => b.p95 - a.p95);
}

/**
 * Contagem por faixa de status, para a pergunta "como está o serviço agora".
 * @param {Object[]} registros
 * @returns {{total: number, porFaixa: Object<string, number>}}
 */
export function resumirStatus(registros) {
  const porFaixa = {};
  let total = 0;
  for (const reg of registros) {
    if (!reg || typeof reg.statusCode !== 'number') continue;
    total += 1;
    const faixa = `${Math.floor(reg.statusCode / 100)}xx`;
    porFaixa[faixa] = (porFaixa[faixa] || 0) + 1;
  }
  return { total, porFaixa };
}

/**
 * Converte um intervalo escrito à mão (`30s`, `5m`, `1h`) em milissegundos.
 *
 * Existe à parte de `parseJanela` por um motivo só: a amostra de saúde pode ser mais
 * frequente que um minuto (o piso de `HEALTH_SAMPLE_INTERVAL_MS` é 10 s), e a janela do
 * relatório não pode, então acrescentar o segundo lá alargaria uma gramática que não precisa
 * disso.
 *
 * O SUFIXO É OBRIGATÓRIO, e recusar o número nu é a decisão: quem configurou o amostrador
 * leu `HEALTH_SAMPLE_INTERVAL_MS=300000` e pensa em MILISSEGUNDOS, enquanto um número nu
 * neste comando só poderia ser lido como segundos. As duas leituras diferem por mil, e a
 * saída inteira é uma conta sobre esse número: um default calado aqui produziria "faltaram
 * 4999 amostras" com cara de medição. `null` faz o comando reclamar, que é o mesmo contrato
 * de `parseJanela`.
 * @param {string} texto
 * @returns {number|null}
 */
export function parseIntervalo(texto) {
  const m = /^(\d+)([smhd])$/.exec(String(texto || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n <= 0) return null;
  return n * (m[2] === 's' ? 1000 : UNIDADES[m[2]]);
}

/**
 * A série da AMOSTRA PERIÓDICA DE SAÚDE, e sobretudo os BURACOS dela.
 *
 * O `fileoverview` de `amostra-de-saude.js` diz o que esta função existe para exercer: um
 * amostrador dentro do processo não testemunha a própria morte, então nenhuma linha vai
 * dizer "eu caí"; o que revela a queda é o SILÊNCIO entre duas amostras. A pergunta é
 * "quantas amostras faltaram e quando", e até 2026-08-31 ela não tinha comando, consulta nem
 * tela: `MARCADOR_AMOSTRA` era exportado para ser filtrado e não tinha um só importador.
 *
 * O INTERVALO NÃO VEM DO CONFIG, e essa é a primeira decisão. `src/config.js` exige
 * `DATABASE_URL` e `JWT_SECRET` na avaliação do módulo, e a hora em que se lê log é
 * justamente a hora em que o banco pode não estar configurado (é o mesmo motivo pelo qual
 * `scripts/diag.js` importa o config tarde e `diag.service.js` não o importa). Ele é
 * INFERIDO dos próprios dados, pela MEDIANA das distâncias entre amostras consecutivas, e a
 * mediana e não a média porque um único buraco de seis horas puxaria a média para cima e
 * faria o relatório concluir que nada faltou. `intervaloMs` sobrepõe a inferência, e a saída
 * diz qual dos dois caminhos valeu (`intervaloOrigem`): sem isso o número de faltantes é uma
 * conta sobre uma premissa invisível.
 *
 * DUAS AUSÊNCIAS QUE NÃO SÃO BOA NOTÍCIA, e é por isso que `situacao` é campo de primeira
 * classe em vez de sair como zero:
 *  - `sem-amostras` não é "nenhuma queda", é instrumento que não produziu NADA (amostrador
 *    desligado, `LOG_TO_FILE=off`, processo que nunca subiu na janela). Uma tela que
 *    desenhasse "0 faltantes" aqui estaria afirmando saúde a partir de ausência de medição.
 *  - `amostra-unica` não tem distância nenhuma para medir: não há intervalo a inferir e não
 *    dá para afirmar coisa alguma sobre buraco. `faltantes` e `esperadas` saem `null`, nunca
 *    zero, mesmo com `--intervalo` informado.
 *
 * O TRECHO ANTES DA PRIMEIRA AMOSTRA É DESCONHECIDO, NÃO BURACO (`desconhecidoAntesMs`).
 * Contá-lo como faltantes inventaria queda toda vez que a janela for mais larga que o tempo
 * de vida do processo, que é o caso comum de `--desde 7d` depois de um deploy. Já a distância
 * entre a ÚLTIMA amostra e o instante da consulta (`desdeUltimaMs`) é o sinal mais importante
 * do relatório, porque é o único que fala do AGORA: se ela passa do intervalo, o processo
 * pode estar fora neste momento. Ela sai em campo próprio, e não diluída na lista de buracos.
 *
 * Amostra que FALHOU (`falhou: true`) continua contando na série: ela prova que o processo
 * estava vivo para logar, que é a pergunta desta função. Quantas foram sai à parte, porque a
 * pergunta "o amostrador está quebrado" é outra.
 *
 * @param {Object[]} registros
 * @param {Object} [opcoes]
 * @param {number|null} [opcoes.intervaloMs] - sobrepõe a inferência
 * @param {number} [opcoes.agora] - epoch ms do instante da consulta
 * @param {number|null} [opcoes.inicio] - epoch ms do começo da janela
 * @returns {Object}
 */
export function resumirAmostras(registros, { intervaloMs = null, agora = Date.now(), inicio = null } = {}) {
  const instantes = [];
  let semHorario = 0;
  let falhasDoAmostrador = 0;
  let bancoFora = 0;

  for (const reg of registros) {
    if (!reg || reg.amostra !== MARCADOR_AMOSTRA) continue;
    if (reg.falhou === true) falhasDoAmostrador += 1;
    if (reg.banco && reg.banco.ok === false) bancoFora += 1;
    // Sem `time` a amostra existe mas não tem lugar na série. Ela é contada à parte em vez
    // de descartada calada: a série ficaria mais curta do que foi, e o relatório inventaria
    // um buraco que é do instrumento de leitura, não do processo.
    if (typeof reg.time !== 'number') { semHorario += 1; continue; }
    instantes.push(reg.time);
  }

  instantes.sort((a, b) => a - b);
  const total = instantes.length;
  const primeira = total ? instantes[0] : null;
  const ultima = total ? instantes[total - 1] : null;

  const distancias = [];
  for (let i = 1; i < total; i += 1) distancias.push(instantes[i] - instantes[i - 1]);
  distancias.sort((a, b) => a - b);

  const informado = Number.isFinite(intervaloMs) && intervaloMs > 0;
  const inferido = percentil(distancias, 50);
  const intervalo = informado ? intervaloMs : inferido;
  const situacao = total === 0 ? 'sem-amostras' : (total === 1 ? 'amostra-unica' : 'medida');

  const buracos = [];
  if (situacao === 'medida' && intervalo) {
    for (let i = 1; i < total; i += 1) {
      const duracaoMs = instantes[i] - instantes[i - 1];
      // Arredondar, e não dividir seco: o timer tem deriva, e uma distância de 61 s num
      // intervalo de 60 s não é meia amostra faltando, é a mesma amostra atrasada.
      const faltaram = Math.max(0, Math.round(duracaoMs / intervalo) - 1);
      if (faltaram > 0) buracos.push({ inicio: instantes[i - 1], fim: instantes[i], duracaoMs, faltantes: faltaram });
    }
  }

  const mensuravel = situacao === 'medida' && Boolean(intervalo);
  const faltantes = mensuravel ? buracos.reduce((s, b) => s + b.faltantes, 0) : null;

  return {
    situacao,
    total,
    semHorario,
    primeira,
    ultima,
    janela: { inicio, fim: agora },
    intervaloMs: intervalo ?? null,
    intervaloOrigem: intervalo ? (informado ? 'informado' : 'inferido') : null,
    // Derivadas dos buracos, e NÃO da largura da janela dividida pelo intervalo: a janela
    // antes da primeira amostra é desconhecida, e a conta pela largura a transformaria em
    // ausência medida.
    esperadas: faltantes === null ? null : total + faltantes,
    faltantes,
    buracos,
    maiorBuraco: buracos.length
      ? buracos.reduce((maior, b) => (b.duracaoMs > maior.duracaoMs ? b : maior))
      : null,
    desconhecidoAntesMs: inicio !== null && primeira !== null ? Math.max(0, primeira - inicio) : null,
    desdeUltimaMs: ultima === null ? null : agora - ultima,
    ultimaAtrasada: ultima === null || !intervalo ? null : agora - ultima > intervalo,
    falhasDoAmostrador,
    bancoFora,
  };
}

/**
 * Interpreta uma linha do arquivo.
 *
 * Devolve `null` para o que não é JSON, e engolir isso é a decisão certa AQUI (e só aqui):
 * a última linha de um arquivo que está sendo escrito neste instante pode estar pela
 * metade, e uma ferramenta de diagnóstico que morre por causa disso é uma ferramenta que
 * falha exatamente durante o incidente.
 * @param {string} linha
 * @returns {Object|null}
 */
export function parseLinha(linha) {
  const t = linha.trim();
  if (!t || t[0] !== '{') return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
