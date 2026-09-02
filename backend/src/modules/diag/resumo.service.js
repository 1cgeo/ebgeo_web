// Path: src/modules/diag/resumo.service.js
/**
 * @fileoverview O GATHERING do `resumo`: as peças que `montarResumo` compõe.
 *
 * A COMPOSIÇÃO NÃO MORA AQUI, e essa divisão é a mesma de sempre nesta camada:
 * `montarResumo` (`src/utils/diag-consulta.js`) é pura, recebe as peças prontas e decide o
 * que cada bloco DIZ quando a fonte dele não respondeu. Aqui fica o que abre arquivo e o que
 * abre banco. Duplicar a composição faria a tela e o terminal divergirem no dia em que um
 * dos dois fosse consertado, que é exatamente o que a página de observabilidade chama de
 * "duas portas, uma verdade".
 *
 * ─── POR QUE ESTE ARQUIVO NASCEU, E DE ONDE ELE SAIU ───
 *
 * O gathering vivia inteiro dentro de `comandoResumo` (`scripts/diag.js`), e enquanto ele
 * viveu lá o relatório de uma tela só existia no terminal. A decisão do dono em 2026-09-02
 * foi que o `resumo` precisa ser VISÍVEL na interface (e que não haverá digest diário por
 * e-mail), então a mesma coleta passou a servir `GET /api/v1/diag/resumo`. O que se moveu foi
 * a ACUMULAÇÃO (`criarColetaDoResumo`), que é onde mora a regra difícil; o que NÃO se moveu é
 * o leitor de disco.
 *
 * ─── O LEITOR É QUE MUDA, E A DIFERENÇA É DELIBERADA ───
 *
 * O comando lê em FLUXO, sem teto: ele vê o arquivo inteiro, e é isso que permite a ele
 * responder sobre janelas longas num arquivo de centenas de MB (medido: `readFileSync` morre
 * com ERR_STRING_TOO_LONG antes de qualquer filtro). A rota lê pelo anel de 200 mil de
 * `lerJanela` (`diag.service.js`), porque um arquivo de dia cheio no heap do processo que
 * também atende sync não é aceitável, e porque o teto de 7 dias limita ARQUIVOS abertos e não
 * LINHAS dentro deles. Trazer o anel para o comando mudaria respostas em silêncio; tirar o
 * anel da rota é um jeito de derrubar o servidor pela porta do diagnóstico.
 *
 * Por isso o que se compartilha é o ACUMULADOR e não o leitor: `criarColetaDoResumo` recebe
 * um registro por vez e não sabe de onde ele veio, exatamente como `criarResumoDeLatencia` e
 * `criarResumoDeStatus`, dos quais ela é feita.
 *
 * ─── O QUE ESTE ARQUIVO NÃO IMPORTA NO TOPO, E POR QUE ISSO IMPORTA ───
 *
 * `defeitos.service.js` entra por `import()` TARDIO dentro de `montarResumoCompleto`, nunca
 * no topo. Ele importa `config.js` e o pool, que exigem `DATABASE_URL` e `JWT_SECRET` na
 * avaliação do módulo, e `scripts/diag.js` importa ESTE arquivo estaticamente para reusar o
 * acumulador: um import no topo faria os cinco comandos de log passarem a exigir banco
 * configurado, que é a única propriedade que os justifica (a hora de ler log é a hora em que
 * alguma coisa não está de pé). É a mesma razão pela qual o comando abre o pool tarde.
 *
 * O leitor de banco também é INJETÁVEL (`lerDefeitos`), e isso é o que torna a coleta inteira
 * exercível em node sem disco e sem Postgres: os cinco caminhos de indisponibilidade não se
 * exercitam derrubando o banco.
 */

import {
  parseJanela, parseIntervalo, criarResumoDeLatencia, criarResumoDeStatus, resumirAmostras,
  montarResumo,
} from '../../utils/diag-consulta.js';
import { MARCADOR_AMOSTRA } from '../../utils/amostra-de-saude.js';
import { MARCADOR_QUERY_LENTA } from '../../utils/query-lenta.js';
import { lerJanela } from './diag.service.js';

/**
 * Quantos defeitos a consulta traz por padrão, nas DUAS portas.
 *
 * É o TETO do Joi da rota, e de propósito: o bloco 1 calcula "os cinco maiores" sobre a lista
 * que veio, e quanto mais linhas vierem menos frequente é a discordância entre esse topo e o
 * topo real. Ele não pode ser ilimitado (a tabela cresce com a VARIEDADE de defeitos, que é
 * limitada, mas não é um), e a lista PARCIAL sai declarada na premissa do bloco, que é o que
 * impede o número de mentir quando o corte morde.
 *
 * O comando importa esta constante em vez de carregar a própria: duas portas com padrões
 * diferentes fariam a MESMA janela sair "parcial" numa e completa na outra, sobre os mesmos
 * defeitos, e quem comparasse as duas saídas concluiria que uma delas está errada.
 */
export const DEFEITOS_DO_RESUMO = 200;

/**
 * O teto do texto de erro do banco que viaja no `motivo` do bloco cego.
 *
 * O mesmo 300 dos campos de texto curto do relato de erro (`diag.schemas.js`), e pela mesma
 * razão: é texto de origem externa (o driver) entrando num payload de tela.
 */
const MAX_MOTIVO = 300;

/**
 * O ACUMULADOR DAS TRÊS PEÇAS DE ARQUIVO, mais o corte entre as DUAS janelas.
 *
 * A REGRA DIFÍCIL É O CORTE, e ela é a razão de esta função existir em vez de o cálculo ser
 * repetido nos dois chamadores. O bloco de latência compara a janela ATUAL com a
 * imediatamente ANTERIOR, do MESMO tamanho, então quem lê o arquivo varre o DOBRO da janela e
 * cada registro cai num de dois acumuladores pelo `time`. Errar esse corte é silencioso: as
 * duas janelas ficariam iguais e todo delta seria zero, que se lê como "nada mudou".
 *
 * SEM `time` A LINHA CONTA COMO DA JANELA ATUAL, e não é descuido: os dois leitores já a
 * deixaram passar pelo mesmo critério (os dois só cortam o que TEM `time` e é antigo), e
 * mandá-la para a janela anterior a colocaria na base de comparação de um período que ela não
 * representa. A direção do erro é conservadora: ela infla o "agora", que é o lado que o
 * operador olha com atenção.
 *
 * AS `linhas` SÃO AS DA JANELA ATUAL, e não as do dobro lido. É o campo que existe para
 * tornar a resposta falsificável, e publicar o total lido faria a premissa do relatório dizer
 * o dobro do que os blocos mediram.
 *
 * @param {{inicio: number}} p - `inicio` é o epoch ms em que a janela ATUAL começa.
 * @returns {{ver: (reg: Object) => void, resultado: (o?: {intervaloMs?: number|null, agora?: number}) => Object}}
 */
export function criarColetaDoResumo({ inicio }) {
  const atual = criarResumoDeLatencia();
  const passada = criarResumoDeLatencia();
  const contagem = criarResumoDeStatus();
  const linhasDeAmostra = [];
  const queriesLentas = { janela: 0, anterior: 0 };
  let linhasNaJanela = 0;

  return {
    ver(reg) {
      if (!reg) return;
      const naJanela = typeof reg.time !== 'number' || reg.time >= inicio;
      if (!naJanela) {
        passada.ver(reg);
        if (reg.msg === MARCADOR_QUERY_LENTA) queriesLentas.anterior += 1;
        return;
      }
      linhasNaJanela += 1;
      atual.ver(reg);
      contagem.ver(reg);
      if (reg.amostra === MARCADOR_AMOSTRA) linhasDeAmostra.push(reg);
      if (reg.msg === MARCADOR_QUERY_LENTA) queriesLentas.janela += 1;
    },
    resultado({ intervaloMs = null, agora = Date.now() } = {}) {
      return {
        linhas: linhasNaJanela,
        latencia: atual.resultado(),
        latenciaAnterior: passada.resultado(),
        queriesLentas,
        // O `inicio` VIAJA para `resumirAmostras` porque o trecho ANTERIOR à primeira
        // amostra é DESCONHECIDO e não buraco: sem ele, um processo que subiu no meio da
        // janela inventa uma queda do tamanho do que veio antes dele.
        amostras: resumirAmostras(linhasDeAmostra, { intervaloMs, agora, inicio }),
        status: contagem.resultado(),
      };
    },
  };
}

/** O que os três blocos de arquivo valem quando não houve arquivo para ler. */
const SEM_ARQUIVO = Object.freeze({
  linhas: 0,
  // OS ARRAYS SÃO CONGELADOS UM A UM porque `Object.freeze` é RASO: sem isto, dois valores de
  // MÓDULO seriam entregues a toda requisição que caísse neste ramo, e um `sort`/`push` a
  // jusante (`montarResumo` faz `[...latencia].sort`, mas o próximo consumidor pode não fazer)
  // mutaria a constante para todas as requisições seguintes do processo.
  latencia: Object.freeze([]),
  latenciaAnterior: Object.freeze([]),
  queriesLentas: Object.freeze({ janela: 0, anterior: 0 }),
  // `null` E NÃO UM RESUMO VAZIO: `montarResumo` já marca os três blocos cegos pelo
  // `leitura.ausente`, e um objeto de amostras montado sobre lista vazia seria uma segunda
  // afirmação sobre uma série que ninguém leu.
  amostras: null,
  status: null,
});

/**
 * O RESUMO INTEIRO, das DUAS fontes, para `GET /api/v1/diag/resumo`.
 *
 * ELE TOLERA A AUSÊNCIA DE CADA FONTE, uma de cada vez, e é isso que o separa das outras
 * rotas do módulo. Diretório de log ausente é estado NORMAL aqui (os três blocos de arquivo
 * se declaram cegos) e banco fora também (os dois blocos de banco se declaram cegos), e nos
 * dois casos a resposta continua sendo 200 com a metade que a outra fonte sustenta. Um
 * relatório de uma tela que morresse inteiro porque metade dele não pôde ser calculada seria
 * inútil justamente durante o incidente, que é quando uma das duas fontes está fora. É a
 * mesma razão pela qual `GET /diag/status` embrulha a consulta de release num `.catch`.
 *
 * A LEITURA É UMA PASSADA SOBRE O DOBRO DA JANELA, e o anel guarda os registros mais
 * RECENTES: sob truncamento quem é descartado primeiro é a janela ANTERIOR, ou seja, a base
 * de comparação, e não o período que a tela está mostrando. A direção é a certa e mesmo assim
 * precisa ser dita, e por isso `truncado` viaja na resposta: um delta calculado contra uma
 * base cortada é uma conta sobre uma premissa, e premissa invisível não se confere.
 *
 * O DOCUMENTO DE SAÍDA É O DO `--json` DO COMANDO, menos o campo `comando`: os cinco blocos e
 * o `periodo` vêm de `montarResumo` sem uma linha de diferença, e `janela` é a mesma
 * PROCEDÊNCIA que o envelope do terminal carrega. Duas portas que respondessem a mesma
 * pergunta em documentos diferentes obrigariam quem lê a aprender dois vocabulários para o
 * mesmo fato.
 *
 * @param {Object} p
 * @param {string} p.diretorio - onde os `.jsonl` moram; quem decide é o controller
 * @param {string} p.desde - a janela, na gramática de `parseJanela` (já validada na borda)
 * @param {Date} [p.agora] - fim da janela (injetável para teste)
 * @param {string|null} [p.intervalo] - o `--intervalo` do comando, na gramática de
 *   `parseIntervalo` (já validada na borda); ausente, o bloco de saúde INFERE da própria série
 * @param {number} [p.limite] - quantos defeitos a consulta traz
 * @param {Function} [p.ler] - o leitor de disco; default é o anel de `diag.service.js`
 * @param {Function} [p.lerDefeitos] - o leitor de banco; default é o import tardio
 * @returns {Promise<Object>}
 */
export async function montarResumoCompleto({
  diretorio,
  desde,
  agora = new Date(),
  intervalo = null,
  limite = DEFEITOS_DO_RESUMO,
  ler = lerJanela,
  lerDefeitos = null,
}) {
  const desdeMs = parseJanela(desde);
  const fim = agora.getTime();
  const inicio = fim - desdeMs;

  const j = await ler({ diretorio, desdeMs: desdeMs * 2, agora });

  let disco = SEM_ARQUIVO;
  if (!j.diretorioAusente) {
    const coleta = criarColetaDoResumo({ inicio });
    for (const reg of j.registros) coleta.ver(reg);
    // O INTERVALO ATRAVESSA COMO TEXTO até aqui, como `desde`, e é reconvertido no último
    // ponto: o Joi da borda valida a FORMA e guarda a string, para que a recusa possa citar o
    // que a pessoa escreveu. Ausente, `resumirAmostras` infere do p10 das distâncias e DIZ na
    // resposta que inferiu — é a premissa do bloco de saúde, e ela não pode ficar invisível.
    disco = coleta.resultado({
      agora: fim,
      intervaloMs: intervalo ? parseIntervalo(intervalo) : null,
    });
  }

  let defeitos = null;
  let defeitosErro = null;
  try {
    const listar = lerDefeitos ?? (await import('./defeitos.service.js')).listarDefeitos;
    defeitos = await listar({ desde, limite });
  } catch (err) {
    // A MENSAGEM DO DRIVER VIAJA, como no comando: "o banco não respondeu" não distingue
    // Postgres fora de `DATABASE_URL` ausente, e as duas pedem coisas opostas. Ela é lida por
    // um administrador, atrás de `auth` + `requireAdmin`, na tela que existe para diagnosticar.
    //
    // `String(err?.message ?? err)` E NÃO `err.message`: nem tudo que se lança é `Error`. Uma
    // rejeição com string, com objeto ou com `undefined` produzia literalmente "o banco não
    // respondeu (undefined)", que é uma frase sem informação nenhuma no lugar onde ela mais
    // importa. E o TETO existe porque o texto não passou por Joi nenhum: um erro de driver
    // pode carregar a query inteira, e esta string vai para dentro de um payload de tela.
    defeitosErro = `o banco não respondeu (${String(err?.message ?? err).slice(0, MAX_MOTIVO)})`;
  }

  const resumo = montarResumo({
    periodo: { desde, desdeMs, inicio, fim },
    leitura: {
      diretorio: j.diretorio,
      ausente: j.diretorioAusente,
      arquivos: j.arquivos,
      linhas: disco.linhas,
      // ELE VAI PARA DENTRO DA PREMISSA DE CADA BLOCO DE ARQUIVO, e não só para o envelope:
      // quem lê "p95 de 300 ms, era 30 ms" precisa saber ali, ao lado do número, se a base do
      // delta foi cortada. O envelope responde sobre a LEITURA, a premissa responde sobre o
      // BLOCO, e é a segunda que fica ao lado da conta. O comando não passa o campo (não tem
      // anel), e a chave então não nasce: ver `montarResumo`.
      truncado: j.truncado,
    },
    defeitos,
    defeitosErro,
    latencia: disco.latencia,
    latenciaAnterior: disco.latenciaAnterior,
    queriesLentas: disco.queriesLentas,
    amostras: disco.amostras,
    status: disco.status,
  });

  return {
    ...resumo,
    // A PROCEDÊNCIA, com os mesmos nomes do envelope do `--json`. Sem ela, uma lista vazia
    // vinda de um diretório errado é indistinguível de uma janela limpa, e quem lê esta
    // resposta é justamente quem não tem terminal para desconfiar.
    janela: {
      desde,
      desdeMs,
      inicio,
      fim,
      dir: j.diretorio,
      diretorioAusente: j.diretorioAusente,
      // SÓ A ROTA TEM ESTE CAMPO, porque só ela tem anel. No comando ele não existiria com
      // valor `false`, ele não existiria de todo: o leitor de fluxo não tem teto para
      // estourar, e um `truncado: false` lá seria uma promessa sobre um mecanismo ausente.
      // Ele aparece TAMBÉM na premissa dos três blocos de arquivo, pela razão dita na
      // `leitura` acima; aqui ele é a propriedade da LEITURA, lá é a premissa da CONTA.
      truncado: j.truncado,
      arquivos: j.arquivos,
      linhas: disco.linhas,
      // `banco` É A MESMA AFIRMAÇÃO que `defeitos.disponivel` e `indisponivel.disponivel`
      // fazem por bloco, e é UM nome só de propósito: dois vocabulários para o mesmo fato é
      // como uma tela passa a mostrar metade cega e metade viva sobre a mesma fonte.
      banco: defeitosErro === null,
    },
    // Epoch ms, como todo instante desta família. Duas unidades de tempo no mesmo documento é
    // conversão errada esperando para acontecer.
    // O nome fica em snake_case porque é a MESMA chave do envelope `--json` do comando: as duas
    // portas do resumo não podem chamar o mesmo campo de dois jeitos.
    gerado_em: fim,
  };
}
