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
 * CADA AGREGAÇÃO TEM DUAS PORTAS, e a de fluxo é a original. `resumirStatus`,
 * `resumirLatencia` e `agruparErros` recebem a janela inteira e são hoje FACHADAS de um
 * acumulador (`criarResumoDeStatus`, `criarResumoDeLatencia`, `criarAgrupadorDeErros`) que
 * recebe um registro por vez e nunca segura a lista. Quem tem a janela em memória é a rota
 * (`diag.service.js`, sob um anel de 200 mil); o comando (`scripts/diag.js`) lê em fluxo e
 * não tem teto. Uma segunda implementação por porta faria as duas divergirem no dia em que
 * alguém consertasse uma, e é por isso que a fachada delega em vez de repetir.
 *
 * O ENDEREÇO ENTRA AGREGADO, DENTRO DO GRUPO, E NUNCA NA ASSINATURA. `enderecos` responde
 * "este pico de 401 é UM endereço ou trezentos", que é pergunta sem comando até aqui; pôr o
 * endereço na assinatura explodiria a cardinalidade e desfaria o agrupamento, que é a decisão
 * que este módulo inteiro existe para sustentar. Ver `resumirEnderecos` e
 * `criarCensoDeEnderecos`, que é o par dele: a leitura de um grupo com endereço único depende
 * do censo da janela e não do grupo.
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
 * DUAS COISAS ATRAVESSAM HOJE, NÃO UMA: o `statusCode` e o `sessaoId`. O segundo entrou em
 * 2026-09-01 e a regra dele é a mesma do endereço em `criarAgrupadorDeErros` — quem escreve
 * a sessão é a linha do `request-logger`, e é ela que a fusão descarta. O `errorHandler`
 * passou a ecoar o campo no mesmo commit, então esta cópia é a REDE, não o caminho
 * principal: ela alcança o log já escrito antes do eco existir.
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
  const sessoes = new Map();
  for (const reg of registros) {
    if (!reg || !reg.reqId) continue;
    if (reg.err) ricos.set(reg.reqId, reg);
    // A SESSÃO SEGUE A MESMA REGRA DO ENDEREÇO, e pela mesma razão: ela é escrita pela
    // linha do `request-logger`, e a fusão fica com a do `errorHandler`. Ele hoje ECOA o
    // campo, então o caso comum não depende desta cópia; ela é o que mantém a correlação
    // viva sobre log JÁ ESCRITO (antes do eco existir) e sobre qualquer produtor futuro que
    // esqueça de ecoá-lo. O primeiro valor visto vence, porque uma requisição tem uma
    // sessão só e a segunda leitura seria a mesma.
    if (typeof reg.sessaoId === 'string' && reg.sessaoId && !sessoes.has(reg.reqId)) {
      sessoes.set(reg.reqId, reg.sessaoId);
    }
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
    const sessao = rico.sessaoId ? null : sessoes.get(reg.reqId);
    // O registro sai INTACTO quando não há nada a acrescentar, e a identidade importa:
    // `criarAgrupadorDeErros` compara referências para decidir desempate, e clonar por via
    // das dúvidas trocaria um objeto por outro igual em todo caminho de fusão.
    if (!par && !sessao) { saida.push(rico); continue; }
    const fundido = { ...rico };
    if (par) fundido.statusCode = par.statusCode;
    if (sessao) fundido.sessaoId = sessao;
    saida.push(fundido);
  }
  return saida;
}

/** Quantos endereços cada grupo NOMEIA, no máximo. Ver `resumirEnderecos`. */
export const MAX_ENDERECOS_PRINCIPAIS = 5;

/**
 * O endereço que uma linha registra, ou `null` quando ela não registra nenhum.
 *
 * AUSENTE NÃO É `'unknown'`, e os dois estados precisam continuar distinguíveis. O campo
 * nasceu em 2026-08-31 (`clientAddress`, `middleware/request-logger.js`), então a esmagadora
 * maioria das linhas existentes não o tem, e nenhuma linha fora do ciclo HTTP jamais terá
 * (o sweep do WS, um job, a amostra de saúde). Já `'unknown'` é uma resposta do produtor:
 * ele olhou o socket e não havia endereço. Este lado devolve `null` para o primeiro e a
 * string para o segundo, que é o que faz `'unknown'` aparecer no relatório como o valor que
 * ele é, em vez de sumir dentro da contagem de quem não tem campo nenhum.
 * @param {Object} reg
 * @returns {string|null}
 */
function enderecoDe(reg) {
  const ip = reg && reg.ip;
  if (typeof ip !== 'string') return null;
  const limpo = ip.trim();
  return limpo || null;
}

/**
 * Endereços agregados: quantos DISTINTOS, e quais dominam.
 *
 * A FORMA É AGREGADA, e o `exemplo` do grupo não serve para isto. O exemplo é a ocorrência
 * mais RECENTE (é o que `adicionar` mantém), então publicar o endereço dele sobre um grupo
 * de mil lê como "a origem" quando é só o último a chegar. A pergunta que o campo responde
 * é outra e não tem outro comando: "este pico de 401 é UM endereço ou trezentos".
 *
 * A ORDEM É TOTAL E DETERMINÍSTICA (contagem decrescente, e o próprio endereço como
 * desempate), porque o corte em `MAX_ENDERECOS_PRINCIPAIS` é feito DEPOIS dela: com empate
 * desempatado pela ordem de chegada, dois endereços de mesma contagem trocariam de lugar
 * conforme a ordem de leitura, e o que muda com eles é QUEM APARECE, não só onde.
 * @param {Map<string, number>} contagem
 * @returns {{distintos: number, principais: Array<{ip: string, total: number}>}}
 */
function resumirEnderecos(contagem) {
  const principais = [...contagem.entries()]
    .map(([ip, total]) => ({ ip, total }))
    .sort((a, b) => b.total - a.total || (a.ip < b.ip ? -1 : (a.ip > b.ip ? 1 : 0)))
    .slice(0, MAX_ENDERECOS_PRINCIPAIS);
  return { distintos: contagem.size, principais };
}

/**
 * Os `reqId` que têm linha RICA (com `err`) na janela. É a primeira das duas passadas.
 *
 * Sem este índice não há agrupamento em FLUXO: para decidir o que fazer com a linha do
 * `request-logger` é preciso saber se existe, em QUALQUER lugar da janela, uma linha do
 * `errorHandler` com o mesmo `reqId` — inclusive depois dela. Guardar toda linha até o fim
 * para descobrir isso é exatamente o que o fluxo existe para não fazer.
 * @param {Object[]} registros
 * @returns {Set<string>}
 */
export function indexarRequisicoesComErro(registros) {
  const indice = criarIndiceDeRequisicoesComErro();
  for (const reg of registros) indice.ver(reg);
  return indice.resultado();
}

/**
 * O mesmo índice, em FLUXO, e ele existe para que "linha RICA" tenha UMA definição.
 *
 * A primeira passada do comando poderia perguntar `reg.reqId && reg.err` na cara, e foi
 * assim que ela nasceu: são nove caracteres. O problema é o dia em que a definição de linha
 * rica mudar aqui dentro e a passada de fora continuar com a antiga, porque a divergência
 * não dá erro nenhum, ela só deixa de fundir algumas requisições e o relatório passa a
 * contar erros a mais, com cara de relatório certo.
 * @returns {{ver: (reg: Object) => void, resultado: () => Set<string>}}
 */
export function criarIndiceDeRequisicoesComErro() {
  const ricos = new Set();
  return {
    ver(reg) {
      if (reg && reg.reqId && reg.err) ricos.add(reg.reqId);
    },
    resultado() {
      return ricos;
    },
  };
}

/**
 * O agrupador de erros em FLUXO: recebe um registro por vez e nunca segura a janela.
 *
 * A REGRA DE FUSÃO NÃO É REESCRITA AQUI. `fundirPorRequisicao` continua sendo a única
 * definição dela, e este agrupador só decide QUEM precisa esperar por ela: as linhas de um
 * `reqId` que o índice acusa como tendo erro (duas por requisição falha, e nada mais) ficam
 * num buffer até o fim; todo o resto é agregado na hora e o registro é solto. O que sobra na
 * memória é proporcional ao número de ERROS da janela, não ao número de linhas dela, e é essa
 * a propriedade toda: num log saudável de 400 mil linhas o buffer tem dezenas.
 *
 * O AGRUPAMENTO É INDEPENDENTE DA ORDEM DE CHEGADA, e isso é obrigação, não conveniência: os
 * registros fundidos entram todos no fim, muito depois dos que passaram intactos, e a saída
 * precisa ser a mesma da versão que percorria a lista fundida em ordem. Por isso cada
 * registro carrega a POSIÇÃO que tinha no fluxo, e ela decide os dois desempates que a ordem
 * decidia sozinha: qual registro vira `exemplo` quando dois empatam no instante mais recente
 * (o de posição menor, que era o primeiro a ser visto), e qual grupo vem antes quando total e
 * `ultima` empatam (o que apareceu primeiro, que era a ordem de inserção no Map).
 *
 * @param {Set<string>} reqIdsComErro - saída de `indexarRequisicoesComErro` sobre a MESMA janela
 * @returns {{ver: (reg: Object) => void, grupos: () => Array<Object>}}
 */
export function criarAgrupadorDeErros(reqIdsComErro) {
  const mapa = new Map();
  // Só linhas de requisição que TÊM erro: o buffer é limitado pelos erros da janela.
  const espera = [];
  const posicaoDoRico = new Map();
  const enderecoDoPedido = new Map();
  let posicao = 0;

  function adicionar(reg, pos, ip) {
    const chave = assinaturaDeErro(reg);
    const t = typeof reg.time === 'number' ? reg.time : 0;
    let g = mapa.get(chave);
    if (!g) {
      g = {
        assinatura: chave, total: 0, primeira: t, ultima: t, exemplo: reg,
        posicaoInicial: pos, posicaoDoExemplo: pos, enderecos: new Map(),
      };
      mapa.set(chave, g);
    }
    g.total += 1;
    if (t < g.primeira) g.primeira = t;
    if (t > g.ultima || (t === g.ultima && pos < g.posicaoDoExemplo)) {
      g.ultima = t;
      g.exemplo = reg;
      g.posicaoDoExemplo = pos;
    }
    if (pos < g.posicaoInicial) g.posicaoInicial = pos;
    // O ENDEREÇO NÃO ENTRA NA ASSINATURA, e a tentação é real: ele explodiria a cardinalidade
    // e desfaria o agrupamento, que é a decisão que este módulo inteiro existe para sustentar.
    // Ele é contado DENTRO do grupo, que é onde a pergunta "um endereço ou trezentos" mora.
    if (ip) g.enderecos.set(ip, (g.enderecos.get(ip) || 0) + 1);
  }

  return {
    ver(reg) {
      const pos = posicao;
      posicao += 1;
      if (!reg || typeof reg !== 'object') return;
      if (reg.reqId && reqIdsComErro.has(reg.reqId)) {
        espera.push(reg);
        if (reg.err) posicaoDoRico.set(reg.reqId, pos);
        // O ENDEREÇO DA REQUISIÇÃO VEM DA OUTRA LINHA, e sem isto o campo nasceria vazio no
        // caso mais comum de todos: a linha do `errorHandler` (`requestErrorLogPayload`) NÃO
        // carrega `ip`, e é justamente ela que a fusão mantém. O endereço é o primeiro que
        // qualquer linha daquele `reqId` registrar, que na prática é a do `request-logger`.
        const ip = enderecoDe(reg);
        if (ip && !enderecoDoPedido.has(reg.reqId)) enderecoDoPedido.set(reg.reqId, ip);
        return;
      }
      if (ehErro(reg)) adicionar(reg, pos, enderecoDe(reg));
    },
    grupos() {
      for (const fundido of fundirPorRequisicao(espera)) {
        if (!ehErro(fundido)) continue;
        // `posicaoDoRico` sempre tem a chave quando o índice veio da mesma janela. O default
        // cobre o caso em que o arquivo cresceu ENTRE as duas passadas: ali a linha rica pode
        // ter sumido do buffer, `fundirPorRequisicao` devolve os registros intactos e o pior
        // que acontece é um desempate decidido por posição zero.
        const pos = posicaoDoRico.get(fundido.reqId) ?? 0;
        adicionar(fundido, pos, enderecoDe(fundido) || enderecoDoPedido.get(fundido.reqId) || null);
      }
      espera.length = 0;
      return [...mapa.values()]
        .sort((a, b) => b.total - a.total || b.ultima - a.ultima || a.posicaoInicial - b.posicaoInicial)
        .map((g) => ({
          assinatura: g.assinatura,
          total: g.total,
          primeira: g.primeira,
          ultima: g.ultima,
          exemplo: g.exemplo,
          enderecos: resumirEnderecos(g.enderecos),
        }));
    },
  };
}

/**
 * Agrupa erros por assinatura, do mais frequente para o menos, com a janela toda em memória.
 *
 * É a fachada de `criarAgrupadorDeErros` para quem já tem a lista (a rota de diagnóstico, que
 * lê sob um anel de 200 mil). Uma segunda implementação do agrupamento aqui faria as duas
 * portas divergirem no dia em que alguém consertasse uma.
 *
 * O desempate é pela ocorrência MAIS RECENTE, e não é enfeite: duas assinaturas com a mesma
 * contagem quase sempre são o mesmo incidente visto de dois ângulos, e quem investiga quer
 * o lado que ainda está acontecendo em cima.
 * @param {Object[]} registros
 * @returns {Array<{assinatura: string, total: number, primeira: number, ultima: number, exemplo: Object, enderecos: Object}>}
 */
export function agruparErros(registros) {
  const agrupador = criarAgrupadorDeErros(indexarRequisicoesComErro(registros));
  for (const reg of registros) agrupador.ver(reg);
  return agrupador.grupos();
}

/**
 * O CENSO DE ENDEREÇOS DA JANELA INTEIRA, que é o que desambigua o grupo de um endereço só.
 *
 * Um grupo com `distintos: 1` e muitas ocorrências tem DUAS leituras, e nenhuma das duas é
 * dedutível de dentro do grupo: pode ser um endereço único insistindo, ou pode ser
 * `TRUST_PROXY_HOPS` em desacordo com o número de proxies à frente, caso em que TODA linha
 * registra o endereço do proxy e o campo vira constante (o `fileoverview` de `clientAddress`
 * teme esse caso em voz alta e nada o vigiava). O que separa as duas está FORA do grupo: se a
 * janela inteira tem um endereço só, a hipótese do proxy está viva; se ela tem trezentos, o
 * grupo está concentrado e a hipótese do proxy não explica o resto do arquivo.
 *
 * Ele conta LINHAS, não requisições, e de propósito: a pergunta aqui é sobre o campo, e uma
 * requisição falha escreve duas linhas das quais só uma o carrega.
 * @returns {{ver: (reg: Object) => void, resultado: () => {distintos: number, linhas: number, principais: Array<{ip: string, total: number}>}}}
 */
export function criarCensoDeEnderecos() {
  const contagem = new Map();
  let linhas = 0;
  return {
    ver(reg) {
      const ip = enderecoDe(reg);
      if (!ip) return;
      linhas += 1;
      contagem.set(ip, (contagem.get(ip) || 0) + 1);
    },
    resultado() {
      return { ...resumirEnderecos(contagem), linhas };
    },
  };
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
 * O rótulo do grupo cuja linha NÃO declara `release`.
 *
 * ELE É DE APRESENTAÇÃO, e o dado continua sendo `release: null`. A distinção não é
 * cerimônia: `null` é falsificável (o consumidor do `--json` sabe que o campo faltou), e uma
 * string mágica no dado se confunde com uma release que alguém chamasse assim. O rótulo mora
 * aqui, e não no comando, porque quem imprime a tabela de `lento` e quem imprime o bloco de
 * latência do `resumo` são dois sítios, e duas redações do mesmo grupo divergem.
 */
export const ROTULO_SEM_RELEASE = '(sem release)';

/**
 * Latência por rota, a partir do `duration` que o `requestLogger` já carimba em toda
 * requisição. Nenhuma instrumentação nova: a medição já existia e ninguém a guardava.
 *
 * Ordenado por p95 e não por média, porque média esconde exatamente a cauda que faz o
 * usuário dizer "está lento".
 * @param {Object[]} registros
 * @param {{porRelease?: boolean}} [opcoes] - ver `criarResumoDeLatencia`
 * @returns {Array<{rota: string, release: string|null, n: number, p50: number, p95: number, max: number}>}
 */
export function resumirLatencia(registros, opcoes) {
  const resumo = criarResumoDeLatencia(opcoes);
  for (const reg of registros) resumo.ver(reg);
  return resumo.resultado();
}

/**
 * A mesma latência, em FLUXO.
 *
 * É a única agregação desta casa que precisa de amostra, e ela precisa: percentil por posto
 * exige a distribuição, e não existe forma exata de obtê-lo de contadores. O que ela guarda,
 * porém, são NÚMEROS e não registros — oito bytes por requisição, contra as centenas de bytes
 * de um objeto de log. Dois milhões de linhas ficam na ordem de 16 MB, que é o preço de
 * responder p95 sem estimador aproximado.
 *
 * ─── `porRelease`, E POR QUE ELE NÃO É UM SEGUNDO ACUMULADOR ───
 *
 * Com a opção ligada, a chave do agrupamento passa a ser o PAR (rota, release), e a mesma
 * rota aparece numa linha por build. A pergunta que só essa forma responde é a que um deploy
 * levanta: "isto ficou mais lento depois de subir?". Sem ela, a média de duas builds numa
 * linha só ESCONDE a regressão em proporção ao tempo que a build antiga dominou a janela, e
 * esconde mais justamente na janela larga, que é a que se olha depois de um deploy ruim.
 *
 * Um irmão `criarResumoDeLatenciaPorRelease` seria uma segunda cópia de percentil, de
 * ordenação e de normalização de rota, e a segunda cópia é a que fica para trás no dia em
 * que a primeira for consertada. O que muda de fato é UMA linha, a da chave.
 *
 * A LINHA SEM `release` NÃO É DESCARTADA, e isso é o ponto que se erra: `EBGEO_RELEASE` só
 * existe desde o lote A, e num arquivo que atravesse aquele dia a maioria das linhas não tem
 * o campo. Filtrá-las faria a tabela responder sobre uma fatia sem dizer que era uma fatia,
 * ou seja, a comparação entre duas builds seria feita ignorando a mais antiga das duas. Elas
 * caem num grupo próprio, com `release: null` (rótulo em `ROTULO_SEM_RELEASE`).
 *
 * `release` NÃO-STRING TAMBÉM CAI NO GRUPO NULO. O campo vem de `JSON.parse` de uma linha de
 * arquivo, que pode ter sido escrita por outro produtor ou editada à mão: um número ali
 * viraria uma chave de agrupamento que nenhuma outra linha casa, e a tabela ganharia um
 * grupo de uma linha só com cara de build.
 *
 * @param {{porRelease?: boolean}} [opcoes]
 * @returns {{ver: (reg: Object) => void, resultado: () => Array<Object>}}
 */
export function criarResumoDeLatencia({ porRelease = false } = {}) {
  // A CHAVE É COMPOSTA COM O BYTE NULO, e não com espaço nem barra: os dois aparecem dentro
  // uma rota normalizada (`POST /atlas/:id/sync`) e dentro de uma release (`1.0.0+abc def`
  // não é impossível), e um separador que ocorra no valor faz duas chaves diferentes
  // colidirem numa só, calado. O byte nulo não é produzido nem pelo
  // carimbo de release nem pela normalização de rota, e vai escrito como escape
  // (`\u0000`) porque byte de controle literal em fonte não sobrevive a um editor
  // descuidado.
  const porChave = new Map();
  return {
    ver(reg) {
      if (!reg || typeof reg.duration !== 'number' || !reg.url) return;
      const rota = `${reg.method || ''} ${normalizarRota(reg.url)}`.trim();
      const release = porRelease && typeof reg.release === 'string' && reg.release !== ''
        ? reg.release
        : null;
      const chave = porRelease ? `${rota}\u0000${release ?? ''}` : rota;
      if (!porChave.has(chave)) porChave.set(chave, { rota, release, valores: [] });
      porChave.get(chave).valores.push(reg.duration);
    },
    resultado() {
      const linhas = [];
      for (const { rota, release, valores } of porChave.values()) {
        valores.sort((a, b) => a - b);
        linhas.push({
          rota,
          // `release` sai SEMPRE, e vale `null` quando o agrupamento não é por build. Um
          // campo que existisse só num dos modos faria o consumidor do `--json` precisar
          // saber qual modo produziu o documento para saber se pode lê-lo.
          release,
          n: valores.length,
          p50: percentil(valores, 50),
          p95: percentil(valores, 95),
          max: valores[valores.length - 1],
        });
      }
      // O DESEMPATE É PELA ROTA e depois pela release, e ele existe para a saída ser
      // DETERMINÍSTICA: com `porRelease`, duas builds da mesma rota empatam em p95 com
      // frequência (a mesma rota rápida em duas builds mede o mesmo), e sem desempate a
      // ordem passa a ser a de inserção no Map, ou seja, a ordem em que as linhas caíram no
      // disco. Duas rodadas sobre o mesmo arquivo dariam tabelas diferentes.
      return linhas.sort((a, b) => (
        b.p95 - a.p95
        || a.rota.localeCompare(b.rota)
        || String(a.release ?? '').localeCompare(String(b.release ?? ''))
      ));
    },
  };
}

/**
 * Contagem por REQUISIÇÃO, para a pergunta "como está o serviço agora".
 * @param {Object[]} registros
 * @returns {{total: number, porFaixa: Object<string, number>, erros: number}}
 */
export function resumirStatus(registros) {
  const resumo = criarResumoDeStatus();
  for (const reg of registros) resumo.ver(reg);
  return resumo.resultado();
}

/**
 * A mesma contagem, em FLUXO. Puro contador: nada aqui precisa da amostra.
 *
 * ─── AS TRÊS SAEM DO MESMO DENOMINADOR, E ISSO É CORREÇÃO DE 2026-09-02 ───
 *
 * `erros` NASCEU AQUI DENTRO naquela data, e antes era contado FORA, pelos três chamadores,
 * com `ehErro` sobre a janela inteira. O sintoma foi medido na captura da aba: **144
 * requisições, 288 erros, taxa de erro 200,0%**. Um número impossível na tela.
 *
 * A causa não era um defeito de contagem, era um denominador diferente do numerador.
 * `ehErro` (logo acima) tem TRÊS termos de propósito, porque a pergunta DELE é "esta LINHA é
 * um registro de erro?", e ela precisa alcançar o que foi logado fora do ciclo HTTP (o sweep
 * do WS, um job, a amostra de saúde com o banco fora). A pergunta do PULSO é outra: "quantas
 * REQUISIÇÕES falharam?". Uma requisição que falha escreve DUAS linhas (a do `errorHandler`,
 * com `err`, e a do `request-logger`, com `statusCode`), e `ehErro` pega as duas enquanto
 * `total` conta só a segunda. Com todas as requisições falhando, a razão vai exatamente a 2.
 *
 * A wiki DECLARAVA esse comportamento ("o `erros` de `/diag/status` conta REGISTROS"), e a
 * declaração não o salvava: uma taxa acima de 100% não se lê como decisão de contagem, se lê
 * como tela quebrada, e uma tela que se lê como quebrada não é consultada. Documentar uma
 * razão de duas fontes diferentes é mais barato que corrigi-la e vale menos que nada.
 *
 * A CORREÇÃO É O NUMERADOR CAIR DENTRO DO MESMO `if` DO DENOMINADOR, e a estrutura é a
 * garantia: as três contagens são incrementadas no mesmo ramo, sobre a mesma linha, então
 * elas não têm como divergir de fonte. Contá-lo fora, mesmo com o predicado certo, é o que
 * já divergiu uma vez — e divergiu em TRÊS chamadores, que é o que acontece quando a regra
 * mora no ponto de uso em vez de no acumulador.
 *
 * O QUE ESTA MUDANÇA **NÃO** ALCANÇA, e continua certo: `diag -- erros` e `GET /diag/erros`
 * seguem usando `ehErro` e seguem contando OUTRA coisa (assinaturas distintas, depois de
 * fundir as duas linhas por `reqId`). Os dois números continuam diferentes de propósito, e a
 * diferença agora é explicável (defeitos distintos contra requisições falhas) em vez de ser
 * o mesmo fato contado duas vezes num dos lados.
 *
 * @returns {{ver: (reg: Object) => void, resultado: () => {total: number, porFaixa: Object<string, number>, erros: number}}}
 */
export function criarResumoDeStatus() {
  const porFaixa = {};
  let total = 0;
  let erros = 0;
  return {
    ver(reg) {
      // A LINHA DO `errorHandler` NÃO ENTRA, nem no numerador nem no denominador, e é ela
      // que a guarda abaixo barra: ela carrega `err` e NÃO carrega `statusCode` no topo (o
      // handler o omite de propósito, senão a requisição seria contada duas vezes aqui). O
      // `statusCode` daquela requisição chega pela linha do `request-logger`, que é uma por
      // requisição, e é essa linha que o pulso conta.
      if (!reg || typeof reg.statusCode !== 'number') return;
      total += 1;
      if (reg.statusCode >= 400) erros += 1;
      const faixa = `${Math.floor(reg.statusCode / 100)}xx`;
      porFaixa[faixa] = (porFaixa[faixa] || 0) + 1;
    },
    resultado() {
      return { total, porFaixa, erros };
    },
  };
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
 * A leitura de disco de UMA linha de amostra, ou `null` se ela não trouxer nenhuma.
 *
 * ABSENTE NÃO É ZERO, e aqui isso é correção e não estilo: zero byte livre é o valor mais
 * ALARMANTE que o campo pode carregar, então converter ausência em zero inverteria o alarme
 * na direção mais cara possível. `montarAmostra` (`amostra-de-saude.js`) omite o campo que
 * não pôde medir, e é essa convenção que este lado precisa preservar.
 *
 * A VALIDAÇÃO SE REPETE DE PROPÓSITO, embora `descreverDisco` já valide na escrita: o que
 * chega aqui não veio daquela função, veio de `JSON.parse` de uma linha de arquivo, que pode
 * ser de um build anterior ao campo, de outro produtor, ou editada à mão. Aceitar o que não é
 * par de números publicaria `undefined MB livres` no relatório.
 *
 * NADA É DERIVADO. Nem fração, nem faixa, nem rótulo: o comando publica o que a amostra
 * registrou, e quem julga é quem lê. Um limiar escolhido sem distribuição observada seria
 * palpite com cara de medição, e a decisão de recusar a fração já foi tomada na escrita, com
 * o argumento por extenso no `fileoverview` de `descreverDisco`.
 * @param {Object} reg
 * @returns {{livreMb: number, totalMb: number}|null}
 */
function lerDisco(reg) {
  const d = reg && reg.disco;
  if (!d || typeof d !== 'object') return null;
  if (!Number.isFinite(d.livreMb) || !Number.isFinite(d.totalMb)) return null;
  return { livreMb: d.livreMb, totalMb: d.totalMb };
}

/**
 * O percentil das distâncias que estima o intervalo nominal do amostrador.
 *
 * Baixo de propósito, e o número é orçamento medido: ver "O PERCENTIL É UM ORÇAMENTO" no
 * `fileoverview` de `resumirAmostras`, que é onde a escolha está justificada.
 */
const PERCENTIL_DO_INTERVALO = 10;

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
 * INFERIDO dos próprios dados, por um PERCENTIL BAIXO das distâncias entre amostras
 * consecutivas (`PERCENTIL_DO_INTERVALO`). `intervaloMs` sobrepõe a inferência, e a saída diz
 * qual dos dois caminhos valeu (`intervaloOrigem`), com que percentil e sobre quantas
 * distâncias: sem isso o número de faltantes é uma conta sobre uma premissa invisível.
 *
 * PERCENTIL BAIXO E NÃO MEDIANA, e a mediana esteve aqui até 2026-09-01, mentindo. O
 * argumento é do domínio e não de estatística: um timer ATRASA e nunca adianta, então as
 * MENORES distâncias são as que melhor estimam a cadência nominal, e as MAIORES são
 * justamente os buracos que se quer contar. Buraco só ALONGA distância, nunca encurta, de
 * modo que o viés da mediana é de mão única e para o lado tranquilizador: quando a queda vira
 * MAIORIA das distâncias, a mediana sobe junto com a queda e a conta de faltantes desaparece
 * exatamente no incidente que esta função existe para achar. Foi observado, não deduzido:
 * amostrador nominal de 5 min, oito horas reiniciando de hora em hora, e o comando dizia
 * "Intervalo considerado: 55min (INFERIDO)" mais "Nenhuma amostra faltando", enquanto
 * `--intervalo 5m` sobre o MESMO arquivo achava 74 faltando de 85.
 *
 * O PERCENTIL É UM ORÇAMENTO, e o número saiu de medição. Com posto (nearest-rank), pK
 * atravessa até (100 menos K) por cento de distâncias que são BURACO e tolera até (K menos 1)
 * por cento de distâncias CURTAS DEMAIS, que é a rajada de um processo reiniciando mais
 * rápido que o próprio intervalo: p50 aguenta 50 e 49, p25 aguenta 75 e 24, p10 aguenta 90 e
 * 9. A escolha é p10 porque os dois erros NÃO custam o mesmo. Estimativa alta demais produz
 * SILÊNCIO ("nada faltou"), que é a mentira que ninguém investiga; estimativa baixa demais
 * produz um número absurdo ao lado do intervalo absurdo que a saída imprime na linha de cima,
 * que é ruído alto e acionável. O orçamento se gasta do lado do buraco, que é o incidente.
 *
 * O QUE NENHUM PERCENTIL ALCANÇA, declarado em vez de escondido: uma série em que NENHUMA
 * distância é nominal (o processo emitiu UMA amostra por reinício e morreu antes do tique
 * seguinte) não carrega a cadência em lugar nenhum, e a inferência devolve o buraco como se
 * fosse o intervalo. Só `--intervalo` resolve esse caso, e é por isso que toda linha
 * tranquilizadora da saída NOMEIA a premissa em vez de afirmar saúde sozinha.
 *
 * TRÊS AUSÊNCIAS QUE NÃO SÃO BOA NOTÍCIA, e é por isso que `situacao` é campo de primeira
 * classe em vez de sair como zero:
 *  - `sem-amostras` não é "nenhuma queda", é instrumento que não produziu NADA (amostrador
 *    desligado, `LOG_TO_FILE=off`, processo que nunca subiu na janela). Uma tela que
 *    desenhasse "0 faltantes" aqui estaria afirmando saúde a partir de ausência de medição.
 *  - `amostra-unica` não tem distância nenhuma para medir: não há intervalo a inferir e não
 *    dá para afirmar coisa alguma sobre buraco. `faltantes` e `esperadas` saem `null`, nunca
 *    zero, mesmo com `--intervalo` informado.
 *  - INTERVALO INESTIMÁVEL com a série de pé (`intervaloMs: null` e `situacao: 'medida'`): a
 *    inferência exige DUAS distâncias úteis, porque UMA dividida por si mesma dá zero
 *    faltantes por aritmética pura, sem que nada avise. A guarda antiga contava AMOSTRAS, e
 *    era por isso que duas amostras a seis horas de distância saíam como "nada faltou".
 *    `faltantes`, `esperadas` e `ultimaAtrasada` saem `null`, e quem imprime tem de honrar
 *    esse terceiro estado: `imprimirSaude` (`scripts/diag.js`) escrevia "FALTARAM null" e
 *    desreferenciava `maiorBuraco` nulo, saindo com código 1.
 *
 * O BURACO TEM DUAS CAUSAS E UMA ASSINATURA SÓ, e é isso que o `disco` da amostra desfaz (o
 * campo nasceu em `amostra-de-saude.js`, cujo `fileoverview` traz o argumento inteiro). Quando
 * o volume do log enche, `log-diario.js` desliga o destino de arquivo sozinho e a série some
 * do `.jsonl` com o processo VIVO, produzindo um buraco idêntico ao da queda. Cada buraco
 * carrega então a leitura de disco da amostra que o ABRE, porque a amostra que falta é
 * justamente a que não existe para ser lida, e um resumo da janela responderia sobre outro
 * instante.
 *
 * TRÊS COISAS QUE O CAMPO NÃO FAZ, e cada uma foi uma tentação:
 *  - ele não afirma CAUSA. Pouco espaço livre antes de um buraco é INDÍCIO, e o processo pode
 *    ter morrido por outro motivo com o disco cheio por coincidência. Quem publica número
 *    deixa a conclusão para quem lê; quem publica veredito manda consertar a coisa errada.
 *  - ele não deriva LIMIAR. Nada de "pouco espaço", nada de porcentagem de corte: sem
 *    distribuição observada, um corte é palpite com cara de medição. Saem `livreMb` e
 *    `totalMb` como a amostra os registrou, que é o par de que o leitor precisa (800 MB é
 *    folga num volume de 20 GB e é véspera de incidente num de 2 TB).
 *  - ele não trata AUSÊNCIA como zero. O campo é novo e vai faltar na maioria das linhas
 *    existentes; zero byte livre, ao contrário, é o valor mais alarmante que ele pode
 *    carregar. `buracos[].disco` sai `null` quando a amostra anterior não trouxe leitura, e
 *    `amostrasComDisco` diz se ALGUMA linha da janela trouxe, que é o que separa "a janela é
 *    anterior ao campo" de "faltou justo naquela amostra".
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
  // PONTOS, e não só instantes: cada amostra carrega junto a leitura de disco dela, porque a
  // testemunha de um buraco é a amostra ANTERIOR a ele (ver o parágrafo da ambiguidade). Um
  // vetor paralelo se desalinharia na ordenação, que é onde esse tipo de erro não aparece.
  const pontos = [];
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
    pontos.push({ t: reg.time, disco: lerDisco(reg) });
  }

  pontos.sort((a, b) => a.t - b.t);
  const instantes = pontos.map((p) => p.t);
  const total = instantes.length;
  const primeira = total ? instantes[0] : null;
  const ultima = total ? instantes[total - 1] : null;

  const distancias = [];
  for (let i = 1; i < total; i += 1) distancias.push(instantes[i] - instantes[i - 1]);
  distancias.sort((a, b) => a - b);

  // Distância ZERO é carimbo repetido (duas linhas no mesmo milissegundo), nunca cadência.
  // Mantê-la na base de estimativa fazia o percentil devolver 0, e intervalo 0 não é
  // intervalo: era daí que saía o `faltantes: null` que o comando desreferenciava. Ela
  // continua na série e continua valendo 0 faltantes na contagem de buracos; o que ela não
  // pode é ESTIMAR.
  const uteis = distancias.filter((d) => d > 0);

  const informado = Number.isFinite(intervaloMs) && intervaloMs > 0;
  // DUAS distâncias, não duas amostras: com UMA, o percentil devolve a própria distância e a
  // divisão dá zero faltantes por aritmética, que é como "duas amostras a seis horas de
  // distância" virava um relatório tranquilo.
  const inferido = uteis.length >= 2 ? percentil(uteis, PERCENTIL_DO_INTERVALO) : null;
  const intervalo = informado ? intervaloMs : inferido;
  // Abaixo de dez distâncias o posto do p10 é 1, ou seja, a estimativa É a menor distância e
  // perde toda a tolerância à rajada de reinício. O limiar não é gosto, é a aritmética do
  // nearest-rank, e por isso ele é DERIVADO em vez de escrito como número.
  const posto = inferido === null ? 0 : Math.ceil((PERCENTIL_DO_INTERVALO / 100) * uteis.length);
  // A guarda conta DISTÂNCIA, não amostra: é a distância que se divide pelo intervalo.
  const situacao = total === 0 ? 'sem-amostras' : (distancias.length === 0 ? 'amostra-unica' : 'medida');

  const buracos = [];
  if (situacao === 'medida' && intervalo) {
    for (let i = 1; i < total; i += 1) {
      const duracaoMs = instantes[i] - instantes[i - 1];
      // Arredondar, e não dividir seco: o timer tem deriva, e uma distância de 61 s num
      // intervalo de 60 s não é meia amostra faltando, é a mesma amostra atrasada.
      const faltaram = Math.max(0, Math.round(duracaoMs / intervalo) - 1);
      // A leitura de disco viaja DENTRO do buraco, e é a da amostra que o ABRE: a amostra que
      // falta é justamente a que não existe para ser lida, e um resumo de disco da janela
      // inteira responderia sobre outro instante que não o da véspera do silêncio.
      if (faltaram > 0) {
        buracos.push({
          inicio: instantes[i - 1],
          fim: instantes[i],
          duracaoMs,
          faltantes: faltaram,
          disco: pontos[i - 1].disco,
        });
      }
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
    // A PROCEDÊNCIA da estimativa é do relatório, não do leitor: "nenhuma amostra faltando"
    // só é honesto acompanhado do intervalo suposto, de onde ele veio e de quantas distâncias
    // o sustentam. Sem estes campos a frase tranquilizadora não tem como nomear a premissa, e
    // foi exatamente ela que enganou.
    distancias: distancias.length,
    distanciasUteis: uteis.length,
    intervaloPercentil: informado || inferido === null ? null : PERCENTIL_DO_INTERVALO,
    intervaloBase: informado || inferido === null ? null : uteis.length,
    estimativaFragil: informado || inferido === null ? null : posto === 1,
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
    // Quantas amostras da janela trouxeram leitura de disco. Ela distingue os DOIS silêncios
    // que um buraco sem leitura pode ter: a janela inteira é anterior ao campo (nenhuma tem),
    // ou o campo existe e faltou justo naquela amostra (alguma tem).
    amostrasComDisco: pontos.filter((p) => p.disco !== null).length,
    // A testemunha do silêncio que AINDA está aberto é a última amostra, pela mesma regra dos
    // buracos: a que não veio não pode ser lida.
    discoNaUltima: total ? pontos[total - 1].disco : null,
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

/** Quantos defeitos o bloco 1 nomeia. Cinco é o que cabe numa tela sem virar rolagem. */
export const TOPO_DE_DEFEITOS = 5;

/** Quantas rotas o bloco 2 compara entre as duas janelas. */
export const ROTAS_COMPARADAS = 5;

/**
 * A COMPARAÇÃO ENTRE DUAS JANELAS, para UMA rota.
 *
 * `null` NA JANELA ANTERIOR NÃO É ZERO, e é a distinção inteira desta função: uma rota que
 * não existia antes (deploy que a criou, ou janela anterior fora do arquivo) não ficou
 * infinitamente mais lenta, ela simplesmente não tem base de comparação. Zero ali produziria
 * um delta enorme em toda rota nova, ou seja, o relatório gritaria exatamente onde não há
 * nada a dizer, e quem lê aprenderia a ignorar a coluna.
 *
 * O PERCENTUAL SÓ EXISTE COM BASE MAIOR QUE ZERO, pelo mesmo motivo aritmético: dividir por
 * um p95 anterior de 0 ms devolve `Infinity`, que se imprime como um número e não é um.
 *
 * @param {number|null} agora - p95 da janela atual
 * @param {number|null} antes - p95 da janela anterior
 * @returns {{p95: number|null, p95Anterior: number|null, delta: number|null, deltaPct: number|null}}
 */
export function compararP95(agora, antes) {
  const temAgora = Number.isFinite(agora);
  const temAntes = Number.isFinite(antes);
  return {
    p95: temAgora ? agora : null,
    p95Anterior: temAntes ? antes : null,
    delta: temAgora && temAntes ? agora - antes : null,
    deltaPct: temAgora && temAntes && antes > 0
      ? Math.round(((agora - antes) / antes) * 1000) / 10
      : null,
  };
}

/**
 * O RELATÓRIO DE UMA TELA: `npm run diag -- resumo`.
 *
 * ELE NÃO LÊ NADA, e essa é a razão de morar aqui em vez de no comando: recebe as peças já
 * calculadas e só COMPÕE. Quem abre arquivo, quem abre pool e quem decide a janela é
 * `scripts/diag.js`. O que se ganha é o que esta casa ganha sempre com a separação, e desta
 * vez com um caso extra: a composição tem cinco blocos com cinco modos de indisponibilidade
 * diferentes, e um teste que precisasse de disco e de Postgres para exercer "o banco está
 * fora" não seria escrito.
 *
 * ─── A REGRA QUE VALE PARA OS CINCO BLOCOS, E ELA É A RAZÃO DESTA FUNÇÃO EXISTIR ───
 *
 * **Bloco cuja fonte não respondeu DIZ ISSO, e nunca imprime zero.** É a lição que a aba de
 * Diagnóstico já pagou com `diretorioAusente` (ver `docs/wiki/observabilidade.md`): "nenhum
 * erro nas últimas 24 horas" desenhado a partir de um instrumento DESLIGADO é cobertura
 * vazia passando verde na forma de interface, e num relatório de uma tela isso é pior, porque
 * as cinco linhas aparecem juntas e a boa notícia falsa fica ao lado de quatro verdadeiras.
 * Aqui a diferença é estrutural: cada bloco carrega `disponivel` e, quando `false`, um
 * `motivo`. Nenhuma contagem sai ao lado de `disponivel: false`.
 *
 * **E todo bloco carrega a PREMISSA, mesmo quando a notícia é boa.** É a mesma correção que
 * `resumirAmostras` levou em 2026-09-01: uma frase tranquilizadora sem a premissa visível
 * ("nenhuma amostra faltando") mentiu por meses. Aqui a premissa tem forma diferente por
 * bloco, e cada uma responde a uma pergunta que a contagem sozinha não responde: os dois
 * blocos de banco declaram se a lista veio PARCIAL (o `LIMIT` da consulta é menor que o total
 * da janela, então "os cinco maiores" são os cinco maiores DENTRE OS QUE VIERAM); os três
 * blocos de arquivo declaram diretório, arquivos abertos e linhas lidas, que é o que torna
 * uma lista vazia falsificável.
 *
 * ─── OS CINCO BLOCOS ───
 *
 *  1. `defeitos`     — novos, regressões, os cinco maiores e o recorte cliente/servidor;
 *  2. `latencia`     — p95 das rotas mais chamadas, contra a janela ANTERIOR do mesmo
 *                      tamanho, mais a contagem de queries lentas;
 *  3. `saude`        — buracos na série de amostras e o disco da última;
 *  4. `indisponivel` — os defeitos de origem `indisponivel`, que é a queda vista pelo
 *                      CLIENTE;
 *  5. `status`       — requisições, erros e taxa.
 *
 * **O BLOCO 4 NÃO É REDUNDANTE COM O 3, E É A JUNÇÃO QUE DÁ VALOR AOS DOIS.** O 3 é o que o
 * SERVIDOR sabe de si (buraco na série de amostras), e o `fileoverview` de
 * `amostra-de-saude.js` diz em voz alta o que ele não alcança: um amostrador dentro do
 * processo não testemunha a própria morte, e o buraco tem duas causas indistinguíveis (o
 * processo caiu, ou o log em arquivo se desligou). O 4 é o que o NAVEGADOR viu (a tela
 * "EBGeo indisponível", relatada com origem `indisponivel`), e ele é a única testemunha da
 * queda que vem de FORA do processo. Lidos lado a lado eles se desambiguam: buraco na série
 * COM relato de indisponibilidade é queda; buraco SEM relato nenhum é, mais provavelmente, o
 * log tendo se desligado com o servidor de pé.
 *
 * ─── O NOME `periodo`, E POR QUE NÃO `janela` ───
 *
 * O envelope do `--json` já tem um campo `janela`, com a PROCEDÊNCIA da leitura, e
 * `escreverJson` LANÇA quando a estrutura do comando colide com ele. Esse choque já
 * aconteceu uma vez, calado, com `resumirAmostras` (ver `estruturaDeSaude` em
 * `scripts/diag.js`): o resumo sobrescrevia o envelope e o documento saía sem dizer de qual
 * diretório veio. Aqui o campo nasce com outro nome de propósito.
 *
 * @param {Object} p
 * @param {{desde: string, desdeMs: number, inicio: number, fim: number}} p.periodo
 * @param {{diretorio: string, ausente: boolean, arquivos: number, linhas: number,
 *          truncado?: boolean}|null} p.leitura
 *   - a procedência do ARQUIVO; `null` significa que nem se tentou ler. `truncado` é
 *   OPCIONAL de propósito: ver a premissa de arquivo, adiante.
 * @param {{itens: Object[], totalDefeitos: number}|null} p.defeitos - de `listarDefeitos`
 * @param {string|null} [p.defeitosErro] - por que o banco não respondeu
 * @param {Object[]} [p.latencia] - de `resumirLatencia` sobre a janela ATUAL
 * @param {Object[]} [p.latenciaAnterior] - o mesmo, sobre a janela anterior
 * @param {{janela: number, anterior: number}} [p.queriesLentas]
 * @param {Object|null} [p.amostras] - de `resumirAmostras`
 * @param {{total: number, porFaixa: Object, erros: number}|null} [p.status]
 * @returns {Object}
 */
export function montarResumo({
  periodo,
  leitura = null,
  defeitos = null,
  defeitosErro = null,
  latencia = [],
  latenciaAnterior = [],
  queriesLentas = null,
  amostras = null,
  status = null,
}) {
  // A INDISPONIBILIDADE DO ARQUIVO É UM ESTADO SÓ para os três blocos que o leem, e é
  // decidida UMA vez: diretório ausente e leitura nem tentada dizem a mesma coisa para quem
  // lê ("não há como afirmar nada a partir do log"), e distingui-las em três lugares
  // produziria três frases levemente diferentes para o mesmo fato.
  const arquivoCego = leitura === null || leitura.ausente === true;
  const premissaDeArquivo = arquivoCego
    ? null
    : {
      fonte: 'arquivo',
      diretorio: leitura.diretorio ?? null,
      arquivos: leitura.arquivos ?? 0,
      linhas: leitura.linhas ?? 0,
      // `truncado` NASCE SÓ QUANDO O LEITOR TEM TETO, e a chave AUSENTE é o terceiro estado.
      //
      // Ele pertence à premissa de ARQUIVO inteira, e não só ao bloco de latência, porque o
      // anel descarta o registro mais ANTIGO: o que se perde primeiro é a janela de
      // comparação do delta, mas a contagem por faixa de status e a série de amostras saem
      // recortadas pelo mesmo corte.
      //
      // O CLI lê em FLUXO, sem teto, e por isso não passa o campo: um `truncado: false` lá
      // seria uma promessa sobre um mecanismo que não existe naquela porta, indistinguível
      // da rota tendo medido e não cortado. `false` VINDO DA ROTA é medição (o anel rodou e
      // não mordeu) e por isso é publicado; a ausência é "a pergunta não se aplica".
      ...(leitura.truncado === undefined ? {} : { truncado: leitura.truncado }),
    };
  const motivoDeArquivo = leitura === null
    ? 'o log em arquivo não foi lido nesta invocação'
    : 'o diretório de log não existe: o instrumento está CEGO, e isto não é "nada aconteceu"';

  const bancoCego = defeitos === null;
  const motivoDeBanco = defeitosErro
    || 'o banco não respondeu: `defeitos` e o recorte de indisponibilidade vêm das tabelas, não do log';

  // A PREMISSA DOS DOIS BLOCOS DE BANCO É A MESMA LISTA, e ela é montada uma vez pelo mesmo
  // motivo: os dois recortam a MESMA consulta, então uma lista parcial os afeta igualmente e
  // duas premissas separadas poderiam divergir por descuido.
  const premissaDeBanco = bancoCego
    ? null
    : {
      fonte: 'banco',
      vistos: defeitos.itens.length,
      total: defeitos.totalDefeitos,
      // PARCIAL É O CAMPO QUE SALVA O "TOPO 5" DE MENTIR: a consulta ordena por `ultima_em`
      // e corta por `LIMIT`, então os cinco maiores calculados aqui são os cinco maiores
      // DENTRE OS QUE VIERAM. Com a lista completa isso é a mesma coisa; com ela cortada,
      // não é, e a diferença precisa estar escrita ao lado do número.
      parcial: defeitos.itens.length < defeitos.totalDefeitos,
    };

  const itens = bancoCego ? [] : defeitos.itens;
  const dentroDaJanela = (t) => Number.isFinite(t) && t >= periodo.inicio;

  const blocoDefeitos = bancoCego
    ? { disponivel: false, motivo: motivoDeBanco, premissa: null }
    : {
      disponivel: true,
      premissa: premissaDeBanco,
      // NOVO É `primeira_em` DENTRO DA JANELA, e não "ainda aberto": um defeito nascido
      // hoje e já resolvido continua sendo novo, e é justamente o que se quer ver depois
      // de um dia de trabalho.
      novos: itens.filter((d) => dentroDaJanela(d.primeiraEm)).length,
      // REGRESSÃO É O ESTADO, e o estado é escrito pela máquina (o CASE de
      // `UPSERT_DEFEITO`), nunca à mão. O recorte é por `ultima_em` porque é a ocorrência
      // NOVA que caracteriza a regressão; um defeito marcado `regrediu` semanas atrás e
      // parado desde então não é notícia desta janela.
      regressoes: itens.filter((d) => d.estado === 'regrediu' && dentroDaJanela(d.ultimaEm)).length,
      porOrigem: {
        // O RECORTE É TERNÁRIO E NÃO BINÁRIO, e o terceiro balde é o maior deles na
        // prática: a esmagadora maioria das linhas tem `origem` NULA (o cliente não
        // declarou), e somá-las ao lado do cliente inventaria procedência, enquanto
        // escondê-las faria as duas contagens não fecharem com o total.
        servidor: itens.filter((d) => d.origem === 'servidor').length,
        cliente: itens.filter((d) => typeof d.origem === 'string' && d.origem !== 'servidor').length,
        semOrigem: itens.filter((d) => d.origem === null || d.origem === undefined).length,
      },
      topo: [...itens]
        .sort((a, b) => (b.ocorrencias ?? 0) - (a.ocorrencias ?? 0) || String(a.id).localeCompare(String(b.id)))
        .slice(0, TOPO_DE_DEFEITOS)
        .map((d) => ({
          id: d.id,
          mensagem: d.mensagem,
          estado: d.estado,
          origem: d.origem ?? null,
          ocorrencias: d.ocorrencias,
          primeiraEm: d.primeiraEm,
          ultimaEm: d.ultimaEm,
        })),
    };

  // AS ROTAS COMPARADAS SÃO AS MAIS CHAMADAS, E NÃO AS MAIS LENTAS. `resumirLatencia` já
  // devolve ordenado por p95, e reusar aquela ordem aqui responderia outra pergunta: as mais
  // lentas de um sistema são quase sempre as mesmas poucas rotas caras chamadas duas vezes
  // por dia, cujo p95 oscila com qualquer coisa. O que um deploy piora de forma visível é o
  // que o produto de fato usa, e "usa" é `n`.
  const anteriorPorRota = new Map(latenciaAnterior.map((l) => [l.rota, l]));
  const blocoLatencia = arquivoCego
    ? { disponivel: false, motivo: motivoDeArquivo, premissa: null }
    : {
      disponivel: true,
      premissa: {
        ...premissaDeArquivo,
        // A JANELA ANTERIOR VAI DECLARADA, porque o delta é uma conta entre DOIS períodos e
        // quem lê precisa saber qual foi o segundo. Ela tem exatamente o mesmo tamanho da
        // atual: comparar 24h com 7d produziria um p95 anterior mais estável por
        // construção, e todo delta pareceria uma piora.
        janelaAnterior: {
          inicio: periodo.inicio - periodo.desdeMs,
          fim: periodo.inicio,
        },
      },
      rotas: [...latencia]
        .sort((a, b) => b.n - a.n || a.rota.localeCompare(b.rota))
        .slice(0, ROTAS_COMPARADAS)
        .map((l) => ({
          rota: l.rota,
          n: l.n,
          ...compararP95(l.p95, anteriorPorRota.get(l.rota)?.p95 ?? null),
        })),
      // A CONTAGEM DE QUERY LENTA MORA NO BLOCO DE LATÊNCIA e não num sexto bloco: ela
      // responde à mesma pergunta ("o que está devagar") por outro andar, e um número solto
      // longe da tabela de rotas obrigaria quem lê a costurar os dois de cabeça. Ela sai
      // com a janela anterior ao lado pela mesma razão que o p95 sai.
      queriesLentas: queriesLentas ?? { janela: 0, anterior: 0 },
    };

  const blocoSaude = arquivoCego || amostras === null
    ? { disponivel: false, motivo: motivoDeArquivo, premissa: null }
    : {
      disponivel: true,
      premissa: premissaDeArquivo,
      // O RESUMO INTEIRO NÃO CABE NUMA TELA, então o bloco carrega o RECORTE que responde
      // "o processo esteve de pé?" e nada mais. Quem precisa dos buracos um a um tem
      // `diag -- saude`, que é o comando dedicado, e o campo `situacao` viaja junto para
      // que os três estados de ausência (`sem-amostras`, `amostra-unica`, intervalo
      // inestimável) cheguem inteiros em vez de virarem zero.
      situacao: amostras.situacao,
      amostras: amostras.total,
      faltantes: amostras.faltantes,
      esperadas: amostras.esperadas,
      buracos: amostras.buracos.length,
      maiorBuracoMs: amostras.maiorBuraco ? amostras.maiorBuraco.duracaoMs : null,
      desdeUltimaMs: amostras.desdeUltimaMs,
      ultimaAtrasada: amostras.ultimaAtrasada,
      // A PREMISSA DO NÚMERO DE FALTANTES VIAJA JUNTO, e não só a premissa da leitura: a
      // contagem é uma divisão por um intervalo que o próprio comando costuma INFERIR, e
      // foi exatamente a frase sem esta procedência que mentiu por meses.
      intervaloMs: amostras.intervaloMs,
      intervaloOrigem: amostras.intervaloOrigem,
      estimativaFragil: amostras.estimativaFragil,
      discoNaUltima: amostras.discoNaUltima,
    };

  const blocoIndisponivel = bancoCego
    ? { disponivel: false, motivo: motivoDeBanco, premissa: null }
    : {
      disponivel: true,
      premissa: premissaDeBanco,
      // A QUEDA VISTA PELO CLIENTE. `indisponivel` é escrita pela tela "EBGeo indisponível"
      // uma vez por vida da página, e o relato ENFILEIRA sem tentar quando a causa é o
      // servidor inalcançável, ou seja, ele chega DEPOIS, na próxima carga bem-sucedida.
      // Isso tem uma consequência que precisa estar escrita: uma queda em curso NÃO aparece
      // aqui, e a ausência de relato numa janela recente não é prova de disponibilidade.
      defeitos: itens.filter((d) => d.origem === 'indisponivel').length,
      ocorrencias: itens
        .filter((d) => d.origem === 'indisponivel')
        .reduce((s, d) => s + (d.ocorrencias ?? 0), 0),
    };

  const blocoStatus = arquivoCego || status === null
    ? { disponivel: false, motivo: motivoDeArquivo, premissa: null }
    : {
      disponivel: true,
      premissa: premissaDeArquivo,
      total: status.total,
      porFaixa: status.porFaixa,
      erros: status.erros,
      // A TAXA É `null` COM ZERO REQUISIÇÕES, e nunca 0: uma janela sem tráfego nenhum não
      // tem taxa de erro de 0%, ela não tem taxa. Imprimir 0,0% ali afirmaria saúde a
      // partir de ausência de medição, que é o mesmo erro do `faltantes` da amostra.
      taxaDeErro: status.total > 0 ? Math.round((status.erros / status.total) * 1000) / 10 : null,
    };

  return {
    periodo,
    defeitos: blocoDefeitos,
    latencia: blocoLatencia,
    saude: blocoSaude,
    indisponivel: blocoIndisponivel,
    status: blocoStatus,
  };
}
