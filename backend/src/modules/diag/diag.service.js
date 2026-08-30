// Path: src/modules/diag/diag.service.js
/**
 * @fileoverview Metade A do diagnóstico: o log em ARQUIVO, sem banco nenhum.
 *
 * TODA A AGREGAÇÃO É DE `src/utils/diag-consulta.js`, e nenhuma linha dela é reescrita
 * aqui. O motivo é o que a página de observabilidade chama de "duas portas, uma
 * verdade": o terminal (`scripts/diag.js`) e esta rota respondem à MESMA pergunta, e uma
 * segunda implementação do agrupamento faria as duas divergirem no dia em que alguém
 * consertasse uma. O que sobra aqui é leitura de disco.
 *
 * O QUE ESTE ARQUIVO NÃO IMPORTA, e a ausência é deliberada: `config`. O diretório entra
 * por argumento, o relógio também, e é isso que o torna testável em node sem `DATABASE_URL`
 * nem `JWT_SECRET` — as mesmas duas variáveis que obrigam `scripts/diag.js` a importar o
 * config tarde. Quem sabe onde o log mora é o controller.
 *
 * A LEITURA DUPLICA `lerRegistros` DO COMANDO, e a duplicação é declarada em vez de
 * escondida: são requisitos diferentes. Lá, diretório ausente é `process.exit(1)` com uma
 * mensagem para o operador; aqui, é uma resposta bem-formada e vazia, porque um 500 na
 * porta do diagnóstico se lê como "o servidor está pior do que está". Lá, `readFileSync` de
 * arquivo inteiro é aceitável; aqui, um arquivo de dia cheio no heap de um processo que
 * também atende sync não é.
 *
 * O ANEL É O QUE FECHA ESSA SEGUNDA PONTA. O teto de 7 dias limita quantos ARQUIVOS se
 * abre, não quantas linhas eles têm, e uma instalação movimentada pode ter milhões numa
 * semana. Passando de `maxRegistros`, o mais ANTIGO é descartado e a resposta diz
 * `truncado: true`. Descartar o antigo, e não parar de ler: quem pergunta "o que quebrou"
 * quer o fim da janela, e um corte que guardasse o começo responderia sobre a semana
 * passada com cara de resposta sobre agora.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {
  parseJanela, diasDaJanela, parseLinha,
  agruparErros, resumirLatencia, resumirStatus, ehErro,
} from '../../utils/diag-consulta.js';

/** O prefixo que `criarLogDiario` usa por padrão, e portanto o que existe no disco. */
export const PREFIXO_PADRAO = 'ebgeo';

/**
 * Quantos registros a janela retém, no máximo. Uma linha de log desta casa tem ~200 bytes
 * de JSON e vira um objeto de algumas centenas: 200 mil ficam na casa das dezenas de MB,
 * que é o que uma requisição pode gastar sem competir com o resto do processo.
 */
export const MAX_REGISTROS = 200_000;

/** O tamanho máximo da pilha que viaja no exemplo de um grupo. Ver `mapearGrupo`. */
const MAX_STACK = 4000;

/**
 * Lê os registros da janela, dos arquivos que ela toca.
 *
 * @param {Object} opts
 * @param {string} opts.diretorio - onde os `.jsonl` moram
 * @param {number} opts.desdeMs - largura da janela, em ms
 * @param {Date} [opts.agora] - fim da janela (injetável para teste)
 * @param {string} [opts.prefixo]
 * @param {number} [opts.maxRegistros]
 * @returns {Promise<{diretorio: string, diretorioAusente: boolean, arquivos: number,
 *   linhas: number, truncado: boolean, inicio: Date, registros: Object[]}>}
 */
export async function lerJanela({
  diretorio,
  desdeMs,
  agora = new Date(),
  prefixo = PREFIXO_PADRAO,
  maxRegistros = MAX_REGISTROS,
}) {
  const inicio = new Date(agora.getTime() - desdeMs);
  const base = {
    diretorio: path.resolve(diretorio),
    diretorioAusente: false,
    arquivos: 0,
    linhas: 0,
    truncado: false,
    inicio,
    registros: [],
  };

  // Diretório ausente é um ESTADO NORMAL, não uma falha: `LOG_TO_FILE=off`, uma instalação
  // que ainda não escreveu a primeira linha, um `LOG_DIR` apontando para volume que não
  // subiu. A resposta diz qual é o caminho e que ele não está lá, que é o que permite ao
  // operador consertar; um 500 diria só que o diagnóstico também quebrou.
  if (!fs.existsSync(diretorio)) {
    return { ...base, diretorioAusente: true };
  }

  const anel = [];
  let escritos = 0;

  for (const dia of diasDaJanela(inicio, agora)) {
    const alvo = path.join(diretorio, `${prefixo}-${dia}.jsonl`);
    if (!fs.existsSync(alvo)) continue;
    base.arquivos += 1;

    const entrada = fs.createReadStream(alvo, 'utf8');
    const leitor = readline.createInterface({ input: entrada, crlfDelay: Infinity });
    try {
      for await (const linha of leitor) {
        const reg = parseLinha(linha);
        if (!reg) continue;
        // O arquivo é do DIA inteiro; a janela pode ser de uma hora. Sem este segundo
        // filtro, `desde=1h` às 00h30 devolveria o dia de ontem inteiro junto.
        if (typeof reg.time === 'number' && reg.time < inicio.getTime()) continue;
        anel[escritos % maxRegistros] = reg;
        escritos += 1;
      }
    } finally {
      leitor.close();
      entrada.destroy();
    }
  }

  // Desenrola o anel de volta à ordem cronológica. Nenhuma agregação depende da ordem
  // (todas indexam por chave), mas uma lista fora de ordem é a próxima armadilha para
  // quem escrever a quarta consulta lendo `registros` direto.
  const corte = escritos % maxRegistros;
  const registros = escritos > maxRegistros
    ? [...anel.slice(corte), ...anel.slice(0, corte)]
    : anel.slice(0, escritos);

  return {
    ...base,
    truncado: escritos > maxRegistros,
    linhas: registros.length,
    registros,
  };
}

/** Os campos de janela que TODA resposta da metade A carrega. */
function metadados(j) {
  return {
    // Epoch ms, a mesma unidade de `primeira`/`ultima` nos grupos: um instante em duas
    // unidades diferentes na mesma resposta é o tipo de coisa que o cliente converte
    // errado uma vez e ninguém percebe.
    desde: j.inicio.getTime(),
    diretorio: j.diretorio,
    diretorioAusente: j.diretorioAusente,
    arquivos: j.arquivos,
    linhas: j.linhas,
    truncado: j.truncado,
  };
}

/**
 * A forma de saída de um grupo de erros.
 *
 * O `exemplo` é um RECORTE do registro cru, e não o registro. O que fica é o que responde
 * "onde e o quê"; o que sai é todo o resto, porque uma linha de log desta casa pode
 * carregar `userId` e outros campos que ninguém pediu e que só engordam o payload.
 */
function mapearGrupo(g) {
  const reg = g.exemplo || {};
  const stack = reg.err && reg.err.stack ? String(reg.err.stack) : null;
  return {
    assinatura: g.assinatura,
    total: g.total,
    primeira: g.primeira,
    ultima: g.ultima,
    exemplo: {
      url: reg.url ?? null,
      method: reg.method ?? null,
      statusCode: typeof reg.statusCode === 'number' ? reg.statusCode : null,
      // A pilha vai INTEIRA até o teto (o comando corta em três linhas, porque lá o
      // destino é um terminal): quem lê isto numa tela pode rolar, e a linha que importa
      // costuma ser a quarta. O teto existe porque uma pilha patológica não pode decidir
      // o tamanho da resposta.
      stack: stack ? stack.slice(0, MAX_STACK) : null,
    },
  };
}

/**
 * Erros agrupados por assinatura, do mais frequente para o menos.
 * @param {{diretorio: string, desde: string, limite: number, agora?: Date}} opts
 */
export async function erros({ diretorio, desde, limite, agora }) {
  const j = await lerJanela({ diretorio, desdeMs: parseJanela(desde), agora });
  const grupos = agruparErros(j.registros);
  return {
    ...metadados(j),
    // A contagem ANTES do corte: sem ela, uma lista de 20 é indistinguível de uma lista
    // de 20 que era de 400, e quem lê conclui que viu tudo.
    assinaturas: grupos.length,
    grupos: grupos.slice(0, limite).map(mapearGrupo),
  };
}

/**
 * Latência por rota (p50/p95/máx), sobre o `duration` que o `requestLogger` já carimba.
 * @param {{diretorio: string, desde: string, limite: number, agora?: Date}} opts
 */
export async function lento({ diretorio, desde, limite, agora }) {
  const j = await lerJanela({ diretorio, desdeMs: parseJanela(desde), agora });
  const rotas = resumirLatencia(j.registros);
  return { ...metadados(j), total: rotas.length, rotas: rotas.slice(0, limite) };
}

/**
 * Contagem por faixa de status, mais o total de registros de ERRO.
 *
 * As duas contagens não são o mesmo número e a diferença é o ponto: `porFaixa` conta
 * requisições (linha do `requestLogger`), enquanto `erros` usa `ehErro`, que alcança
 * também o que foi logado fora do ciclo HTTP (o sweep do WS, um job) e não tem status.
 *
 * `erros` conta REGISTROS, não defeitos, e a distinção morde: uma requisição falha escreve
 * DUAS linhas, então ela soma dois. É a mesma conta de `npm run diag -- status`, mantida
 * igual de propósito — a pergunta desta rota é "como está o serviço agora", e quem quer o
 * número de defeitos distintos usa `/diag/erros`, que funde por requisição antes de agrupar.
 * @param {{diretorio: string, desde: string, agora?: Date}} opts
 */
export async function status({ diretorio, desde, agora }) {
  const j = await lerJanela({ diretorio, desdeMs: parseJanela(desde), agora });
  const { total, porFaixa } = resumirStatus(j.registros);
  return { ...metadados(j), total, porFaixa, erros: j.registros.filter(ehErro).length };
}
