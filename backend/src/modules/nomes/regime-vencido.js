// Path: src/modules/nomes/regime-vencido.js
/**
 * @fileoverview QUANDO UM ÍNDICE DE REGIME PASSA A RESPONDER POR ESTADO VELHO, QUANDO ELE
 * VOLTA AO NORMAL, E ATÉ QUANDO O ESTADO VELHO AINDA VALE. A única cópia dessa
 * contabilidade, compartilhada pelos dois índices.
 *
 * ============================================================================
 * O FATO QUE ESTE ARQUIVO EXISTE PARA TORNAR ESCRITO. `tile-regime.js` e
 * `assets3d-regime.js` mantêm um índice em memória do regime de acesso do catálogo, e
 * quando a reconstrução falha os dois caem para o ÚLTIMO ÍNDICE BOM e seguem servindo. A
 * queda é deliberada (fechar derrubaria o acervo público inteiro por uma piscada de banco)
 * e está declarada nos dois cabeçalhos, mas era MUDA. A consequência é a que decide a
 * gravidade: a invalidação na escrita preserva o `ultimoBom` de propósito, então uma linha
 * recém-marcada PRIVADA continua a ser servida como pública, e com
 * `Cache-Control: public, immutable`, enquanto o banco estiver fora. Um gate de acesso
 * operando sobre estado velho sem dizer que está. (Desde 2026-09-01 esse "enquanto" tem
 * limite: ver `afirmacaoPublicaVencida`. O que ele NÃO tem limite de é a linha de log, que
 * continua sendo uma por transição.)
 *
 * O ESCOPO ERA SÓ FAZER O FATO EXISTIR POR ESCRITO, e deixou de ser em 2026-09-01, quando o
 * dono decidiu o TETO (ver `afirmacaoPublicaVencida` abaixo). O que este módulo passou a
 * decidir é UMA coisa, e é bom nomear as três que ele continua não decidindo: ele NÃO muda o
 * `Cache-Control`, NÃO muda o ramo privado e NÃO recusa nada por si (quem recusa é o índice,
 * que lança, e o gate, que responde). O que ele decide é por quanto tempo um índice vencido
 * ainda tem direito de AFIRMAR que um caminho pode ser servido sem credencial.
 * ============================================================================
 *
 * UMA LINHA POR TRANSIÇÃO, NUNCA POR CONSULTA, e esta é a decisão de forma inteira. O
 * índice é consultado uma vez por TILE (e o Cesium pede um por LOD por tile), que é
 * justamente a razão de ele existir em memória. Uma linha por consulta em regime vencido
 * poria o amplificador de log mais violento do sistema no caminho mais quente dele, e
 * escreveria a rajada inteira num arquivo no disco do backend. O precedente da casa é o
 * `shouldLogDenial` de `src/middleware/rate-limit.js`, que fala uma vez por janela pelo
 * mesmo motivo: a repetição não carrega fato novo.
 *
 * A diferença de forma em relação àquele é que aqui a agregação NÃO pode ser derivada de um
 * contador alheio: não existe janela, existe um ESTADO (vencido ou normal) que dura o que
 * durar. Então este módulo guarda dois números por índice, e só dois, o que o mantém O(1) e
 * sem nada para podar.
 *
 * O QUE CADA LINHA PRECISA CARREGAR, e é o que separa um alarme de um ruído:
 *   - a ENTRADA diz QUAL índice, DE QUANDO é o último bom e POR QUE a reconstrução falhou.
 *     Sem a idade não se distingue "o banco piscou por dois segundos durante um deploy" de
 *     "estamos servindo o estado de ontem", que são o mesmo evento com gravidades
 *     incomparáveis;
 *   - a SAÍDA diz há quanto tempo o índice estava vencido, que é o número que resolve
 *     retroativamente a gravidade da entrada.
 *
 * O NÍVEL: ENTRADA EM `error`, SAÍDA EM `info`. O raciocínio é sobre o `ehErro` REAL
 * (`src/utils/diag-consulta.js`), que admite um registro por TRÊS termos em OU: `level >= 50`,
 * a presença de `err`, ou `statusCode >= 400`. Estas linhas não carregam `err` (ver abaixo) e
 * não carregam `statusCode`, então o NÍVEL é o único termo que pode admiti-las em
 * `npm run diag -- erros`. Ou seja, escolher o nível aqui não é rotular gravidade, é decidir
 * se um humano chega a ver o fato.
 *
 * A tensão é real: servir estado velho por dois segundos durante um deploy do banco é outra
 * coisa que servir por uma hora, e o nível é fixo. Ela se resolve por DUAS observações. A
 * primeira é que a linha de entrada é escrita no instante em que a duração é, por
 * construção, desconhecida: no momento da queda ninguém sabe se serão dois segundos ou uma
 * hora, então o nível tem de ser escolhido pela pior leitura, porque a assimetria de custo é
 * enorme. Um alarme falso custa UMA linha, que a linha de saída fecha dois segundos depois.
 * Um alarme perdido custa um gate de acesso servindo bytes privados como públicos e
 * imutáveis, sem que ninguém veja. A segunda é que o alarme falso só é barato POR CAUSA da
 * forma acima: com uma linha por transição, o deploy de dois segundos produz exatamente duas
 * linhas no total, e a de entrada carrega a `idadeMs`, que permite a quem lê rebaixar o
 * evento sozinho, na hora, sem abrir mais nada.
 *
 * A saída fica em `info` porque é notícia boa, e pô-la em `error` inflaria exatamente o
 * relatório que a entrada existe para alcançar: uma recuperação apareceria ali como um
 * segundo defeito. A CONSEQUÊNCIA DISSO PRECISA SER DITA EM VOZ ALTA, como
 * `limiterDenialPayload` diz da sua: quem lê SÓ `npm run diag -- erros` vê a entrada e não
 * vê a recuperação, e uma queda já resolvida se lê como ainda aberta. A saída se lê crua,
 * com `npm run diag -- linhas --filtro`, e é por isso que as duas mensagens são o par
 * `MSG_ENTRADA`/`MSG_SAIDA` abaixo, casáveis pelo campo `indice`.
 *
 * NÃO VAI `err` NEM `reqId`, e os dois são deliberados. O objeto de erro inteiro passaria
 * pelo `errSerializer`, que carrega `err.query`, `err.params` e o `detail` do driver com o
 * `Failing row contains (...)`, e não compraria nada: a consulta que falhou é uma constante
 * (`SELECT_LINHAS_DE_CATALOGO`), sem parâmetro e sem linha, então o `codigo` estrutural mais
 * a mensagem aparada dizem tudo o que há para dizer. O `reqId` é pior que inútil: a
 * transição não é propriedade da requisição que por acaso a disparou, e carimbá-lo faria
 * `fundirPorRequisicao` (`diag-consulta.js`) fundir esta linha com a linha de erro de banco
 * do mesmo pedido e DESCARTAR uma das duas, que é a perda que este arquivo existe para
 * impedir.
 */
import config from '../../config.js';
import logger from '../../utils/logger.js';

/** Teto do texto do motivo. A mensagem do pg é curta; o teto é contra o caso patológico. */
const TETO_DO_MOTIVO = 200;

/**
 * As duas mensagens do par. Ficam constantes e exportadas porque quem tem a linha de
 * entrada em mãos precisa saber o que procurar para achar a saída, e casar por texto
 * digitado à mão é como um par de linhas deixa de ser um par.
 */
export const MSG_ENTRADA = 'resource regime index went stale';
export const MSG_SAIDA = 'resource regime index recovered';

/**
 * A razão da falha como texto, aparada e sem caractere de controle.
 *
 * O aparo de controle é a mesma lição de `usernameForLog` (`middleware/rate-limit.js`): a
 * linha é impressa num terminal por `npm run diag -- linhas`, e uma quebra de linha dentro
 * de um campo forja linhas de log naquela tela. Aqui o texto vem do driver e não de um
 * chamador anônimo, então o risco é menor, mas o custo de aparar é nulo e a origem do texto
 * pode mudar sem que este arquivo saiba.
 *
 * @param {*} erro
 * @returns {string}
 */
export function motivoDaFalha(erro) {
  const bruto = erro && typeof erro.message === 'string' ? erro.message : String(erro ?? '');
  const cortado = bruto.slice(0, TETO_DO_MOTIVO + 1);
  let limpo = '';
  for (const ch of cortado) {
    const code = ch.codePointAt(0);
    if (code > 0x1f && code !== 0x7f) limpo += ch;
  }
  return limpo.length > TETO_DO_MOTIVO ? `${limpo.slice(0, TETO_DO_MOTIVO)}...` : limpo;
}

/**
 * O objeto entregue ao pino quando um índice ENTRA em regime vencido.
 *
 * Separado do escritor para que a FORMA seja testável: sob `NODE_ENV=test` o logger roda em
 * nível `silent`, então um teste que espiasse a saída do pino reportaria verde com a linha
 * inteira ausente. Mesma separação, e pelo mesmo motivo, que `queryLogPayload` e
 * `dbErrorLogPayload` em `src/database/index.js`.
 *
 * `codigo` é o campo ESTRUTURAL (SQLSTATE do Postgres, ou o `errno` do Node quando a
 * conexão nem chega a abrir), e `motivo` é o texto. Os dois, e nessa ordem de confiança,
 * pela lição de `detalheDeAmostra` (`utils/diag-consulta.js`): derivar do campo estrutural,
 * nunca do texto da mensagem.
 *
 * `idadeMs` é `null` quando não houve construção anotada. Isso não deveria acontecer (a
 * queda exige um `ultimoBom`, e ele nasce junto com o carimbo), e é justamente por isso que
 * o campo devolve `null` em vez de um zero: um zero aqui leria como "o índice acabou de ser
 * construído", que é o oposto do que a ausência significa.
 *
 * @param {{indice: string, erro?: *, ultimoBomEm: number|null, agora: number}} args
 * @returns {object}
 */
export function entradaEmRegimeVencidoPayload({ indice, erro, ultimoBomEm, agora }) {
  return {
    indice,
    regime: 'vencido',
    ultimoBomEm: typeof ultimoBomEm === 'number' ? ultimoBomEm : null,
    idadeMs: typeof ultimoBomEm === 'number' ? agora - ultimoBomEm : null,
    codigo: erro && erro.code != null ? String(erro.code) : null,
    motivo: motivoDaFalha(erro),
  };
}

/**
 * O objeto entregue ao pino quando um índice VOLTA ao regime normal.
 *
 * `vencidoPorMs` é a razão inteira desta linha existir: é o número que resolve
 * retroativamente a gravidade da entrada, e ele só pode ser sabido aqui.
 *
 * @param {{indice: string, vencidoDesde: number, agora: number}} args
 * @returns {object}
 */
export function saidaDeRegimeVencidoPayload({ indice, vencidoDesde, agora }) {
  return {
    indice,
    regime: 'normal',
    vencidoDesde,
    vencidoPorMs: agora - vencidoDesde,
  };
}

/**
 * ATÉ QUANDO UM ÍNDICE VENCIDO AINDA PODE AFIRMAR QUE UM CAMINHO É SERVÍVEL SEM CREDENCIAL.
 *
 * A DECISÃO INTEIRA, escrita aqui porque é a única linha deste arquivo que muda o que o
 * usuário recebe. A queda para o último índice bom é resiliência comprada de propósito, e
 * ela era ILIMITADA: enquanto o banco estivesse fora, um recurso recém-marcado privado
 * seguia saindo como público e `immutable`. O teto derruba SÓ a afirmação que um índice
 * velho não tem direito de fazer, e é por isso que ele mora numa função que só o lado
 * PÚBLICO chama: o ramo privado continua consultando `fn_can_see_resource` a cada decisão
 * (memoizada por 30 s em `assets3d-acesso.js`), então ele não depende deste índice para
 * dizer "não", e passar o teto não pode fechá-lo junto.
 *
 * O SENTIDO DA COMPARAÇÃO É `>=`, e não `>`, porque é o que dá significado ao teto ZERO: com
 * `>` um teto de zero ainda deixaria passar a consulta do instante exato da queda, e o
 * regime mais estrito que a configuração oferece não seria estrito.
 *
 * `null` (regime NORMAL) NUNCA vence, e as DUAS guardas são explícitas em vez de um `!=
 * null`, porque `idade >= NaN` é sempre falso e um NaN em qualquer dos lados viraria um teto
 * que NUNCA FECHA, com a aparência de estar configurado. As duas guardas são assimétricas de
 * propósito:
 *
 *   - a IDADE só é ignorada quando não é número ou é NaN. Uma idade INFINITA vence (é o
 *     limite de "velho"), e tratá-la como regime normal seria a única forma de a função
 *     abrir a janela sozinha;
 *   - o TETO não-finito devolve `false`, que é o lado aberto, e essa escolha só é aceitável
 *     porque ela é INALCANÇÁVEL: `REGIME_STALE_MAX_MS` tem faixa em `NUMERIC_ENV_RULES` e o
 *     boot é fail-fast, então um teto ilegível não chega até aqui. Fechar nesse caso
 *     derrubaria o acervo público inteiro por um erro de digitação já pego no boot.
 *
 * @param {number|null} vencidoHaMs - de `vigia.vencidoHaMs()`; `null` em regime normal.
 * @param {number} [teto] - o teto configurado, em ms.
 * @returns {boolean} se a afirmação pública deste índice já não vale.
 */
export function afirmacaoPublicaVencida(vencidoHaMs, teto = config.regimeIndex.staleMaxMs) {
  if (typeof vencidoHaMs !== 'number' || Number.isNaN(vencidoHaMs)) return false;
  if (!Number.isFinite(teto)) return false;
  return vencidoHaMs >= teto;
}

/**
 * O que um índice lança quando o teto acima é ultrapassado.
 *
 * NÃO é um `AppError`, e isso é a mesma separação que o cabeçalho de `tile-regime.js` já
 * declara ("este módulo não decide a recusa"): os índices resolvem caminho, e quem traduz
 * uma falha em status HTTP é o gate. Os dois gates a traduzem para 503, que é o desfecho
 * que os dois já usam para "não consigo decidir", e não para 401: passado o teto o servidor
 * não está NEGANDO acesso, está dizendo que não tem como decidir. Para o nginx, que só
 * repassa 401 e 403 ao cliente, essa diferença é justamente a que separa negação de erro.
 *
 * ELA NÃO CHEGA AO LOG, e isso precisa estar escrito para não ser lido ao contrário: os
 * dois gates a DESCARTAM ao traduzir para 503, então o `errorHandler` registra a frase
 * genérica do `ServiceUnavailableError` e o 503 do teto é indistinguível do 503 de índice
 * que nunca foi construído. Quem distingue é a linha de TRANSIÇÃO deste mesmo arquivo, que
 * já saiu antes com a idade e o motivo, e é assim de propósito: uma linha por 503 seria uma
 * linha por tile. Os três campos existem para o teste e para o dia em que alguém quiser
 * levar a causa adiante; não conte com eles num relatório.
 */
export class RegimeVencidoAlemDoTetoError extends Error {
  /**
   * @param {string} indice
   * @param {number} vencidoHaMs
   * @param {number} teto
   */
  constructor(indice, vencidoHaMs, teto) {
    super(`índice de regime '${indice}' vencido há ${vencidoHaMs} ms (teto ${teto} ms)`);
    this.name = 'RegimeVencidoAlemDoTetoError';
    this.indice = indice;
    this.vencidoHaMs = vencidoHaMs;
    this.teto = teto;
  }
}

/**
 * O nível de cada uma das duas linhas, como TABELA e não como `if`, para que a decisão
 * argumentada no cabeçalho seja um dado asserível em vez de um ramo enterrado no escritor.
 * Mudar um valor aqui muda se o fato alcança `npm run diag -- erros`, e é por isso que há um
 * teste que o prende: quem mexer passa pelo argumento antes de passar pelo verde.
 */
export const NIVEL_POR_TIPO = Object.freeze({ entrada: 'error', saida: 'info' });

/** O escritor de verdade. Trocável para que o teste observe a decisão sem espiar o pino. */
function escreverNoLog(tipo, payload) {
  logger[NIVEL_POR_TIPO[tipo]](payload, tipo === 'entrada' ? MSG_ENTRADA : MSG_SAIDA);
}

/**
 * O vigia de UM índice: guarda quando foi a última construção boa e se estamos vencidos.
 *
 * POR QUE ISTO É COMPARTILHADO DE VERDADE entre os dois índices, e não copiado. As
 * diferenças entre eles são todas sobre o CONTEÚDO do índice e sobre como o gate lê o
 * resultado (o de tiles casa por prefixo de caminho e recusa o não reivindicado; o de 3D
 * indexa duas formas de recurso, a árvore de `.3dtiles` e a pasta da cena caminhável, e
 * publica o não reivindicado). Nada disso toca a pergunta que este arquivo responde, que é
 * "este índice está velho, e há quanto tempo". Duas cópias divergiriam na primeira correção
 * de uma delas, e o índice esquecido voltaria a ser mudo, que é o defeito de origem. É a
 * mesma razão pela qual `caminho-de-recurso.js` existe, escrita no cabeçalho de lá.
 *
 * O `agora` é argumento com default em vez de `Date.now()` embutido para que o teste
 * comande o relógio sem falsear o relógio global, que é compartilhado com o pool do banco.
 *
 * @param {string} indice - o nome do índice, como aparece na linha.
 * @param {(tipo: 'entrada'|'saida', payload: object) => void} [escrever]
 */
export function criarVigiaDeRegime(indice, escrever = escreverNoLog) {
  /** @type {number|null} Quando o último índice bom foi CONSTRUÍDO. */
  let ultimoBomEm = null;
  /** @type {number|null} Desde quando estamos servindo por ele. `null` = regime normal. */
  let vencidoDesde = null;

  return {
    /**
     * Uma reconstrução deu certo. Chamar DEPOIS de publicar o índice novo.
     * @param {number} [agora]
     */
    anotarConstrucao(agora = Date.now()) {
      if (vencidoDesde !== null) {
        escrever('saida', saidaDeRegimeVencidoPayload({ indice, vencidoDesde, agora }));
        vencidoDesde = null;
      }
      ultimoBomEm = agora;
    },

    /**
     * Uma consulta caiu para o último índice bom. Chamar DEPOIS do ramo que relança quando
     * não há cópia anterior: aquele caminho responde 503 e é alto por si, enquanto este é o
     * que era mudo.
     *
     * O silêncio a partir da segunda é a propriedade que impede o amplificador, e ele é
     * necessário mesmo dentro de um único incidente: a promessa rejeitada é compartilhada,
     * então todas as consultas em voo caem no mesmo `catch` e chegam aqui em rajada.
     *
     * @param {*} erro
     * @param {number} [agora]
     * @returns {boolean} se esta queda foi a que escreveu a linha.
     */
    anotarQueda(erro, agora = Date.now()) {
      if (vencidoDesde !== null) return false;
      vencidoDesde = agora;
      escrever('entrada', entradaEmRegimeVencidoPayload({ indice, erro, ultimoBomEm, agora }));
      return true;
    },

    /**
     * Há quanto tempo estamos servindo pelo último índice bom, ou `null` em regime normal.
     *
     * CONTA DESDE A QUEDA, e não desde a última construção boa, e a diferença é o que o teto
     * mede. Enquanto o banco responde, o índice é reconstruído a cada escrita de catálogo e,
     * no pior caso, a cada TTL, então a idade da CONSTRUÇÃO é limitada por desenho e não diz
     * nada sobre risco. O que abre a janela é o tempo em que não se consegue mais confirmar
     * nada, e ele começa na queda. Uma recuperação zera (via `anotarConstrucao`), então dois
     * incidentes separados por um minuto bom não somam idade, que seria a leitura errada.
     *
     * @param {number} [agora]
     * @returns {number|null}
     */
    vencidoHaMs(agora = Date.now()) {
      return vencidoDesde === null ? null : agora - vencidoDesde;
    },
  };
}
