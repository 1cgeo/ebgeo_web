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
 */

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
 * DUAS condições, e a segunda é a que se esquece: `level >= 50` pega tudo que foi logado
 * como `error`/`fatal`, mas o `errorHandler` desta casa loga 4xx em `warn` de propósito
 * (erro do cliente não é falha do servidor). Sem o segundo termo, todo 400, 401, 403 e 404
 * sumiria do relatório — inclusive o 400 em laço que motivou esta ferramenta.
 * @param {Object} reg
 * @returns {boolean}
 */
export function ehErro(reg) {
  if (!reg || typeof reg !== 'object') return false;
  if (typeof reg.level === 'number' && reg.level >= 50) return true;
  return Boolean(reg.err) || (typeof reg.statusCode === 'number' && reg.statusCode >= 400);
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
  return [rota, tipo, msg].filter(Boolean).join(' | ') + status;
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
 * @param {Object[]} registros
 * @returns {Object[]}
 */
export function fundirPorRequisicao(registros) {
  const ricos = new Map();
  for (const reg of registros) {
    if (reg && reg.reqId && reg.err) ricos.set(reg.reqId, reg);
  }
  const saida = [];
  for (const reg of registros) {
    if (!reg || !reg.reqId) { saida.push(reg); continue; }
    const rico = ricos.get(reg.reqId);
    if (!rico) { saida.push(reg); continue; }
    if (reg === rico) {
      // O status vive só na linha de requisição; sem copiá-lo, a fusão perderia o 400/404
      // que a assinatura mostra entre colchetes.
      const par = registros.find((r) => r && r.reqId === reg.reqId && r !== rico && typeof r.statusCode === 'number');
      saida.push(par ? { ...rico, statusCode: par.statusCode } : rico);
    }
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
