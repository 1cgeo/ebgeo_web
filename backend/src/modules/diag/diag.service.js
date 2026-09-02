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
  parseJanela, parseIntervalo, diasDaJanela, parseLinha,
  agruparErros, resumirLatencia, resumirStatus, resumirAmostras,
} from '../../utils/diag-consulta.js';
import { MARCADOR_AMOSTRA } from '../../utils/amostra-de-saude.js';

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
 * ─── `casa`: O MODO DE FILTRO, PARA O GREP CRU ───
 *
 * O PREDICADO DESCE ATÉ AQUI, e o texto não sobe até o chamador. A primeira versão desta peça
 * retinha a LINHA CRUA ao lado de cada registro (`comBruta`) para que `linhas()` filtrasse
 * depois, e o preço era dobrar o anel: 200 mil strings de log são dezenas de MB retidas dentro
 * de um processo que também atende sync, para devolver no máximo 2000 delas. Com o predicado
 * aqui, o que se retém é só o que CASOU, num anel do tamanho do `limite` do chamador, e a
 * linha crua morre no fim da iteração em que nasceu.
 *
 * O PREDICADO RECEBE A LINHA COMO ELA ESTÁ NO DISCO, e isso é o contrato inteiro: um
 * `JSON.parse` seguido de `JSON.stringify` normaliza o ESCAPE, então um caractere acentuado
 * gravado em forma escapada sai da re-serialização em forma literal. Filtrar o texto
 * re-serializado casaria a forma que o arquivo NÃO tem e deixaria de casar a que ele tem, e o
 * resultado deixaria de ser conferível com um `grep` no mesmo arquivo, que é a propriedade que
 * o `--filtro` do comando existe para ter.
 *
 * NESTE MODO NÃO HÁ ANEL DE REGISTROS, e a consequência precisa ser lida: `registros` volta
 * VAZIO (ninguém pediu a janela inteira), `linhas` é a contagem COMPLETA do que a janela tem, e
 * `truncado` é FALSO por construção, porque nada foi descartado da varredura. O corte que
 * existe neste modo é o do `limiteCasados`, e ele é publicado à parte pelo chamador: os dois
 * cortes significam coisas diferentes e não podem virar um campo só.
 *
 * @param {Object} opts
 * @param {string} opts.diretorio - onde os `.jsonl` moram
 * @param {number} opts.desdeMs - largura da janela, em ms
 * @param {Date} [opts.agora] - fim da janela (injetável para teste)
 * @param {string} [opts.prefixo]
 * @param {number} [opts.maxRegistros]
 * @param {Function|null} [opts.casa] - predicado sobre a LINHA CRUA
 * @param {number} [opts.limiteCasados] - quantos casados reter (só com `casa`)
 * @returns {Promise<{diretorio: string, diretorioAusente: boolean, arquivos: number,
 *   linhas: number, truncado: boolean, inicio: Date, registros: Object[],
 *   casados: Object[]|null, total: number|null, casouTudo: boolean|null}>}
 */
export async function lerJanela({
  diretorio,
  desdeMs,
  agora = new Date(),
  prefixo = PREFIXO_PADRAO,
  maxRegistros = MAX_REGISTROS,
  casa = null,
  limiteCasados = 0,
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
    // `null` E NÃO `[]`/`0` QUANDO NINGUÉM FILTROU: lista vazia e total zero se leem como
    // "nada casou", que é um fato sobre o arquivo; `null` diz que ninguém perguntou, que é um
    // fato sobre a chamada. A distinção é a mesma do `releases` de `GET /diag/status`.
    casados: casa ? [] : null,
    total: casa ? 0 : null,
    casouTudo: casa ? false : null,
  };

  // Diretório ausente é um ESTADO NORMAL, não uma falha: `LOG_TO_FILE=off`, uma instalação
  // que ainda não escreveu a primeira linha, um `LOG_DIR` apontando para volume que não
  // subiu. A resposta diz qual é o caminho e que ele não está lá, que é o que permite ao
  // operador consertar; um 500 diria só que o diagnóstico também quebrou.
  if (!fs.existsSync(diretorio)) {
    return { ...base, diretorioAusente: true };
  }

  // NO MODO DE FILTRO O ANEL É O DOS CASADOS, e `escritos` passa a contar a janela inteira em
  // vez do que foi retido. São os dois papéis que a variável acumulava sem que a diferença
  // aparecesse: quantos EXISTEM e quantos CABEM.
  const anel = [];
  const tamanhoDoAnel = casa ? Math.max(1, limiteCasados) : maxRegistros;
  let escritos = 0;
  let casados = 0;

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
        escritos += 1;
        if (casa) {
          // A LINHA CRUA MORRE AQUI, e é isso que o modo compra: ela existe só dentro desta
          // iteração, e o que sobrevive é o registro já parseado que casou.
          if (!casa(linha)) continue;
          anel[casados % tamanhoDoAnel] = reg;
          casados += 1;
          continue;
        }
        anel[(escritos - 1) % tamanhoDoAnel] = reg;
      }
    } finally {
      leitor.close();
      entrada.destroy();
    }
  }

  // Desenrola o anel de volta à ordem cronológica. Nenhuma agregação depende da ordem (todas
  // indexam por chave), mas uma lista fora de ordem é a próxima armadilha para quem escrever a
  // quarta consulta lendo `registros` direto — e no modo de filtro a ordem É contrato, porque o
  // chamador publica "as últimas que casaram".
  const desenrolar = (a, quantos) => (quantos > tamanhoDoAnel
    ? [...a.slice(quantos % tamanhoDoAnel), ...a.slice(0, quantos % tamanhoDoAnel)]
    : a.slice(0, quantos));

  if (casa) {
    return {
      ...base,
      // Nada foi descartado da VARREDURA: o anel deste modo é o dos casados, e o corte dele é
      // o do `limiteCasados`, publicado pelo chamador. Um `truncado: true` aqui afirmaria que a
      // janela perdeu registros antigos, que é outra coisa e não aconteceu.
      truncado: false,
      linhas: escritos,
      registros: [],
      casados: desenrolar(anel, casados),
      total: casados,
      // ZERO DE ZERO NÃO É "CASOU TUDO": numa janela vazia a frase leria como se o filtro
      // tivesse alcançado tudo o que há, quando não há nada.
      casouTudo: escritos > 0 && casados === escritos,
    };
  }

  const registros = desenrolar(anel, escritos);
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
 * A PREMISSA da resposta, no formato que as rotas NOVAS publicam: um objeto `janela`.
 *
 * ELA DIZ A MESMA COISA QUE `metadados` E NÃO NO MESMO LUGAR, e a divergência é deliberada,
 * não descuido. As três rotas antigas (`erros`, `lento`, `status`) espalham a procedência na
 * RAIZ da resposta, e o shape delas está congelado pela aba de Administração; as duas novas
 * (`saude`, `linhas`) a aninham sob `janela`, exatamente como o envelope do `--json` do
 * comando faz. Duas razões, e a segunda é a que decide: aninhar deixa a comparação entre as
 * duas portas ser "tire UMA chave dos dois documentos e compare o resto", que é o que
 * `tests/integration/diag-rotas-de-log-espelham-o-cli.test.js` faz; e em `saude` a raiz JÁ
 * tem um campo `janela` de outro dono (`resumirAmostras` devolve as pontas da SÉRIE), que o
 * comando renomeia para `janelaDaSerie` e que já apagou a procedência do documento inteiro
 * uma vez, sem nada ficar vermelho.
 *
 * `desde` É A STRING PEDIDA, e não o instante: `inicio` e `fim` já dão os dois instantes em
 * epoch ms, e o que falta para a resposta ser falsificável é o que a pessoa DIGITOU, porque é
 * ele que a rota pode ter entendido de outro jeito. (Em `metadados`, `desde` é o instante de
 * início; os dois nomes não podem ser unificados sem quebrar o shape congelado das três.)
 *
 * @param {Object} j - o resultado de `lerJanela`
 * @param {string} desde - a janela como o chamador a escreveu
 * @param {Date} agora - o fim da janela, o MESMO que `lerJanela` recebeu
 * @returns {Object}
 */
function premissa(j, desde, agora) {
  return {
    desde,
    inicio: j.inicio.getTime(),
    fim: agora.getTime(),
    diretorio: j.diretorio,
    diretorioAusente: j.diretorioAusente,
    truncado: j.truncado,
    arquivos: j.arquivos,
    linhas: j.linhas,
  };
}

/**
 * A forma de saída de um grupo de erros.
 *
 * O `exemplo` é um RECORTE do registro cru, e não o registro. O que fica é o que responde
 * "onde e o quê"; o que sai é todo o resto, porque uma linha de log desta casa pode
 * carregar `userId` e outros campos que ninguém pediu e que só engordam o payload.
 *
 * O ENDEREÇO DO CLIENTE NÃO ENTRA NO `exemplo`, E É POR ISSO QUE ELE PRECISOU DE CAMPO
 * PRÓPRIO. `requestLogPayload` (`src/middleware/request-logger.js`) carimba `ip` em toda
 * linha de requisição, então o registro cru já carrega o endereço de UMA ocorrência, e
 * deixá-lo passar pelo recorte seria a pior das duas saídas: um dado pessoal na tela que
 * não responde a pergunta que ele parece responder ("este pico de 401 é um endereço ou
 * trezentos?"), porque um exemplo não distingue um cliente de trezentos. Quem responde é a
 * AGREGAÇÃO por grupo (`enderecos`, cunhada em `agruparErros`), e é só ela que atravessa.
 *
 * A SESSÃO DO NAVEGADOR (`sessaoId`) SEGUE A MESMA REGRA DO ENDEREÇO, e por isso também
 * fica de fora deste recorte. O registro fundido a carrega (é o que liga o erro do servidor
 * ao erro que o navegador relatou na mesma aba), mas o `exemplo` é a ocorrência mais
 * RECENTE: publicar UMA sessão sobre um grupo de mil se lê como "foi esta aba", quando a
 * pergunta que interessa é se o pico veio de uma aba ou de trezentas. O recorte é uma
 * ALLOWLIST justamente para que campo novo na linha de log não vaze para cá por omissão.
 *
 * A AUSÊNCIA DO CAMPO É UM ESTADO QUE O CLIENTE LÊ, distinto de zero endereços distintos, e
 * é por isso que a chave só nasce quando o agregador a produziu. Um `enderecos: undefined`
 * escrito sempre some do JSON e sobrevive como CHAVE no objeto, o que faria a resposta e o
 * objeto discordarem sobre o que existe.
 *
 * EXPORTADA PARA QUE A FORMA SEJA TESTÁVEL, pelo mesmo motivo de `requestLogPayload` estar
 * separada do middleware que a usa: o que se quer prender aqui é o CONJUNTO DE CHAVES, e
 * cobrá-lo por dentro de `erros()` só alcança o recorte que a agregação vigente produz.
 * @param {Object} g - Um grupo de `agruparErros`.
 * @returns {Object}
 */
export function mapearGrupo(g) {
  const reg = g.exemplo || {};
  const stack = reg.err && reg.err.stack ? String(reg.err.stack) : null;
  const saida = {
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
  if (g.enderecos) saida.enderecos = g.enderecos;
  return saida;
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
 *
 * `porRelease` É O `--por-release` DO COMANDO, e ele chegou aqui em 2026-09-02 porque faltava
 * para que "a porta HTTP cobre o comando" fosse verdade. Com ele ligado a chave do agrupamento
 * passa a ser o PAR (rota, build), e a mesma rota aparece numa linha por release: é a única
 * forma que responde "isto ficou mais lento depois do deploy?", porque a média de duas builds
 * numa linha só ESCONDE a regressão, e esconde mais na janela larga, que é a que se olha
 * depois de um deploy ruim.
 *
 * O MODO VIAJA NO PAYLOAD, e não fica só na tabela: sem ele, dois documentos do mesmo endpoint
 * sobre o mesmo arquivo teriam a mesma forma e contagens de `rotas` diferentes, sem nada
 * dizendo por quê. É a mesma razão pela qual o envelope do `--json` carrega `comando`.
 *
 * @param {{diretorio: string, desde: string, limite: number, porRelease?: boolean,
 *   agora?: Date}} opts
 */
export async function lento({ diretorio, desde, limite, porRelease = false, agora }) {
  const j = await lerJanela({ diretorio, desdeMs: parseJanela(desde), agora });
  const rotas = resumirLatencia(j.registros, { porRelease });
  return { ...metadados(j), porRelease, total: rotas.length, rotas: rotas.slice(0, limite) };
}

/**
 * O PULSO: quantas REQUISIÇÕES, em que faixas, e quantas falharam.
 *
 * AS TRÊS CONTAGENS SAEM DO MESMO DENOMINADOR desde 2026-09-02, e a correção tem número:
 * a aba mostrou **144 requisições, 288 erros e taxa de erro 200,0%**. `erros` era contado
 * aqui, com `ehErro` sobre a janela inteira, enquanto `total` vinha de `resumirStatus`, que
 * conta só a linha do `request-logger`. Uma requisição falha escreve DUAS linhas, então a
 * razão ia exatamente a 2 quando tudo falhava. A wiki DECLARAVA a contagem por registro, e a
 * declaração não salvava: uma taxa acima de 100% não se lê como decisão de contagem, se lê
 * como tela quebrada. A regra passou para dentro de `criarResumoDeStatus`, onde numerador e
 * denominador são incrementados no mesmo ramo e não têm como divergir de fonte.
 *
 * O QUE CONTINUA DIFERENTE, de propósito: `/diag/erros` conta assinaturas DISTINTAS, depois
 * de fundir as duas linhas por `reqId`. Aquela pergunta é "quantos defeitos"; esta é "quantas
 * requisições falharam", e os dois números seguem sem ter de bater.
 * @param {{diretorio: string, desde: string, agora?: Date}} opts
 */
export async function status({ diretorio, desde, agora }) {
  const j = await lerJanela({ diretorio, desdeMs: parseJanela(desde), agora });
  return { ...metadados(j), ...resumirStatus(j.registros) };
}

/**
 * A SAÚDE DO PROCESSO pela série de amostras, e sobretudo pelos BURACOS dela.
 *
 * É a SEGUNDA PORTA de `npm run diag -- saude`, e a análise é literalmente a mesma função
 * (`resumirAmostras`, pura, em `src/utils/diag-consulta.js`): o documento que sai daqui é o do
 * `--json` do comando menos o envelope. Uma segunda verdade sobre o que "amostra faltando"
 * significa faria a tela e o terminal divergirem sobre a mesma queda, e nada indicaria qual
 * dos dois está certo.
 *
 * O `janela` DO RESUMO É RENOMEADO PARA `janelaDaSerie`, exatamente como o comando faz, e o
 * motivo é que existem DOIS objetos com esse nome e donos diferentes: o da PROCEDÊNCIA
 * (diretório, arquivos, linhas, truncamento) e o das PONTAS DA SÉRIE que `resumirAmostras`
 * recebeu. Enquanto o comando escrevia o envelope antes do espalhamento, o segundo apagava o
 * primeiro e o documento saía sem dizer de qual diretório veio, sem nada ficar vermelho.
 * Renomear é melhor que descartar: um leitor que compare os dois está fazendo a conferência
 * certa.
 *
 * O QUE MUDA ENTRE AS DUAS PORTAS É O LEITOR, e a diferença tem consequência aqui mais que
 * nas irmãs: o comando lê em FLUXO e vê o arquivo inteiro; esta rota lê pelo anel de 200 mil,
 * então uma janela movimentada pode ter perdido o começo, e um buraco ANTIGO some junto. É
 * por isso que `janela.truncado` é a premissa, e não um detalhe: com ele verdadeiro, "nenhuma
 * amostra faltando" vale só para o trecho que sobreviveu ao anel.
 *
 * O INTERVALO ENTRA COMO A STRING DO CHAMADOR e é reconvertido aqui, pela mesma razão de
 * `desde`: o Joi da borda valida a FORMA e devolve o texto, para que a mensagem de erro possa
 * citar o que a pessoa escreveu. Ausente, `resumirAmostras` INFERE da própria série e diz na
 * resposta que inferiu, com que percentil e sobre quantas distâncias.
 *
 * @param {{diretorio: string, desde: string, intervalo?: string|null, agora?: Date}} opts
 */
export async function saude({ diretorio, desde, intervalo = null, agora }) {
  const quando = agora ?? new Date();
  const j = await lerJanela({ diretorio, desdeMs: parseJanela(desde), agora: quando });
  // O FILTRO É AQUI E NÃO DENTRO DE `resumirAmostras`, como no comando: a função aceita a
  // janela inteira e ignora o que não é amostra, mas passar centenas de milhares de linhas de
  // requisição para ela seria pagar uma varredura a mais por nada. A série é pequena por
  // construção (uma linha a cada poucos minutos por processo).
  const amostras = j.registros.filter((r) => r && r.amostra === MARCADOR_AMOSTRA);
  const { janela: janelaDaSerie, ...resto } = resumirAmostras(amostras, {
    intervaloMs: intervalo ? parseIntervalo(intervalo) : null,
    agora: quando.getTime(),
    inicio: j.inicio.getTime(),
  });
  return { janela: premissa(j, desde, quando), ...resto, janelaDaSerie };
}

/**
 * O ORÇAMENTO DE BYTES da resposta de `linhas()`, em bytes de JSON serializado.
 *
 * QUATRO MB, e o número é uma ordem de grandeza e não uma medição: uma linha de log desta casa
 * tem algumas centenas de bytes, então o teto de 2000 itens já responde numa fração disto, e
 * este orçamento só morde quando as linhas são anormalmente grandes. Ele existe justamente
 * para esse caso, e a razão é que os dois cortes contam coisas diferentes: o `limite` conta
 * ITENS, e quem escolhe o TAMANHO de um item é quem escreveu a linha de log, nunca quem
 * consulta. Uma pilha de erro no teto do Joi, um `details` de driver, um payload de sync
 * recusado: 2000 daquilo é uma resposta de dezenas de MB montada dentro do processo que também
 * atende sync.
 */
const ORCAMENTO_DE_BYTES = 4 * 1024 * 1024;

/**
 * Corta a lista pelo orçamento de bytes, mantendo as ENTRADAS MAIS RECENTES.
 *
 * A CONTAGEM É POR REGISTRO E DE TRÁS PARA A FRENTE, na mesma direção do anel: o corte cai
 * sobre o começo da lista, que é o que já era descartado primeiro quando o `limite` mordia.
 * Contar de frente entregaria o começo da janela e jogaria fora o fim, que é o oposto da
 * pergunta.
 *
 * UM REGISTRO SOZINHO MAIOR QUE O ORÇAMENTO É ENTREGUE, e não descartado. Devolver lista vazia
 * ao lado de um `total` positivo se lê como rota quebrada, e o caso real que produziria isso é
 * exatamente aquele em que a pessoa está olhando: a linha patológica é o que ela procura.
 *
 * `Buffer.byteLength` E NÃO `.length` DA STRING, porque a resposta viaja em UTF-8 e um
 * caractere acentuado ocupa dois bytes: contar unidades de código subestimaria o payload
 * justamente num log escrito em português.
 *
 * @param {Object[]} registros - em ordem cronológica
 * @returns {{itens: Object[], truncadoPorBytes: boolean}}
 */
function aparadoPorBytes(registros) {
  let usados = 0;
  let primeiro = 0;
  for (let i = registros.length - 1; i >= 0; i -= 1) {
    usados += Buffer.byteLength(JSON.stringify(registros[i]), 'utf8');
    if (usados > ORCAMENTO_DE_BYTES) {
      // `i + 1` deixaria a lista vazia quando o PRIMEIRO conferido já estoura; o `Math.min`
      // guarda o último, que é a linha mais recente e a que interessa.
      primeiro = Math.min(i + 1, registros.length - 1);
      break;
    }
  }
  return { itens: registros.slice(primeiro), truncadoPorBytes: primeiro > 0 };
}

/**
 * O DESPEJO CRU FILTRADO: as linhas do `.jsonl` que contêm um texto, como elas estão no disco.
 *
 * É a segunda porta de `npm run diag -- linhas --filtro`, e ela existe porque o agente que
 * opera de fora do host não tem `grep` no `.jsonl`. O que ela responde e as quatro agregações
 * irmãs não respondem é a pergunta ESTREITA: "o que o servidor escreveu em volta DESTA sessão,
 * DESTE id, DESTE endereço" — que é justamente a costura entre o erro que o navegador relatou
 * e as linhas do mesmo instante.
 *
 * O CASAMENTO É POR SUBSTRING, SENSÍVEL À CAIXA, SOBRE A LINHA CRUA, como no comando. As três
 * propriedades são a mesma decisão: o que se casa e o que se devolve tem de ser conferível com
 * um `grep` no mesmo arquivo, e um texto re-serializado a partir do objeto não existe em
 * arquivo nenhum (ver `comBruta`, em `lerJanela`).
 *
 * `filtro` É OBRIGATÓRIO NA BORDA, e essa é a única divergência de contrato com o comando, que
 * aceita `linhas` sem filtro. Aqui um despejo sem filtro seria a janela inteira atravessando o
 * ciclo HTTP; e a pergunta que sobra sem filtro ("o que aconteceu") já tem quatro rotas.
 *
 * O PREDICADO VAI PARA DENTRO DO LEITOR (`casa`), e é isso que faz esta rota caber na memória:
 * o que se retém é o anel de CASADOS, do tamanho do `limite`, e a linha crua de cada registro
 * morre na iteração em que nasceu. A versão anterior retinha as 200 mil linhas cruas da janela
 * para filtrar depois. Uma consequência que o payload publica: neste modo o anel geral não
 * existe, então `janela.linhas` é a contagem COMPLETA da janela e `janela.truncado` é falso por
 * construção — nada foi descartado da varredura.
 *
 * `casouTudo` DIZ QUANDO O FILTRO NÃO ESTREITOU NADA, e é o mesmo aviso que o comando escreve
 * em prosa. Ele existe porque a expectativa errada mais natural é que o filtro case só VALOR:
 * a linha crua carrega o NOME de cada campo, então `time`, `level` e `msg` casam toda linha
 * que os tenha, e sem este campo o resultado se lê como "tudo isto tem a ver com o que
 * procuro".
 *
 * SÃO TRÊS CAMPOS DE CORTE E ELES DIZEM COISAS DIFERENTES, e é preciso ler os três:
 * `janela.truncado` é o ANEL GERAL, que neste modo não existe e por isso é sempre falso aqui;
 * `truncado` da raiz é o `limite` (casaram mais linhas do que couberam em `itens`, e as que
 * ficaram são as mais RECENTES); e `truncadoPorBytes` é o ORÇAMENTO, que morde quando as linhas
 * são grandes o bastante para o `limite` não ser o corte que valeu. Colapsá-los num campo só
 * apagaria a distinção entre "não li tudo", "não te mostrei tudo o que li" e "o que eu ia te
 * mostrar não cabia".
 *
 * AS LINHAS SAEM PARSEADAS (`itens`), e aqui a rota diverge do comando de propósito. O `--json`
 * do terminal devolve texto cru porque o destino dele é um `jq -R 'fromjson'` ou o olho; esta
 * resposta já é JSON, e devolver um objeto como STRING dentro dele obrigaria todo consumidor a
 * um segundo parse. O que se perde é só o escape exato, e ele já cumpriu o papel dele no
 * casamento, que é onde ele importa.
 *
 * O CONTEÚDO É O QUE O ARQUIVO TEM, e ele já foi redigido na ESCRITA: `redactUrl` reescreve a
 * URL da requisição antes do log (é o que impede a chave de API vinda da query string de virar
 * registro permanente) e `elidirSql` troca por marcador os literais dentro de um texto de SQL,
 * no hook do banco e no serializer de erro. Esta rota não redige nada por cima: ela é a porta
 * HTTP de um `grep`, e um segundo filtro aqui faria a resposta divergir do arquivo que ela
 * afirma estar mostrando. O gate é `requireAdmin`, e o que ele libera é o log do servidor.
 *
 * @param {{diretorio: string, desde: string, filtro: string, limite: number, agora?: Date}} opts
 */
export async function linhas({ diretorio, desde, filtro, limite, agora }) {
  const quando = agora ?? new Date();
  // O PREDICADO DESCE, E AS ÚLTIMAS `limite` CASADAS SOBEM. O anel de casados é do tamanho do
  // `limite` e vale a mesma regra do anel geral: quem cai é a mais ANTIGA, porque quem pergunta
  // "o que quebrou" quer o fim da janela, e um corte que guardasse o começo responderia sobre
  // ontem com cara de resposta sobre agora.
  const j = await lerJanela({
    diretorio,
    desdeMs: parseJanela(desde),
    agora: quando,
    casa: (linha) => linha.includes(filtro),
    limiteCasados: limite,
  });

  const { itens, truncadoPorBytes } = aparadoPorBytes(j.casados);

  return {
    janela: premissa(j, desde, quando),
    filtro,
    // A contagem ANTES dos dois cortes: sem ela, uma lista de 200 é indistinguível de uma lista
    // de 200 que era de 4.000, e quem lê conclui que viu tudo.
    total: j.total,
    // O CORTE DO `limite` SE MEDE CONTRA O ANEL, e não contra `itens`: com `itens` no lugar de
    // `j.casados.length` os dois campos colapsam, porque toda vez que o ORÇAMENTO corta este
    // aqui também vira verdadeiro. Medido: uma lista de 5 casados com 5 no anel e 3 entregues
    // saía dizendo que o `limite` mordeu, e o `limite` era 100.
    truncado: j.total > j.casados.length,
    truncadoPorBytes,
    casouTudo: j.casouTudo,
    itens,
  };
}
