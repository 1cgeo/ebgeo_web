// Path: src/utils/audit-diff.js
// O DE-PARA DA TRILHA: o que mudou, em três regimes, e nunca o segredo.
//
// ================================ O PROBLEMA =================================
//
// Até aqui `CATALOG_UPDATE` gravava só os NOMES dos campos tocados
// (`details.fields`), e isso era decisão escrita, com um motivo que continua
// válido: `config` carrega URL de serviço (às vezes com credencial na query
// string) e `previewThumbnail`/`thumbnail` são data URL de até 256 kB. A trilha é
// lida por qualquer administrador e, desde a onda de auditoria por OM, por
// qualquer produtor da OM dona — e a trilha NÃO SE EDITA. O que entra ali entra
// para sempre.
//
// Só que "o nome do campo" não responde a pergunta que a investigação faz. "Fulano
// alterou `config`" não distingue trocar a opacidade de apontar a camada para outro
// servidor, e não responde de jeito nenhum a pergunta mais frequente de uma
// investigação: *mudou e depois voltou ao que era?*
//
// ================================ A DECISÃO ==================================
//
// Três regimes, por uma lista FECHADA de caminhos pontilhados:
//
//   1. VALOR literal ({@link CAMPOS_COM_VALOR}) — campos pequenos, não-endereçáveis
//      e sem chance de carregar segredo: nome, descrição, ordem, forma do 3D, zoom,
//      opacidade, deslocamento de altura, data de captura, local. Uma string
//      inesperadamente longa (acima de {@link LIMITE_VALOR_LITERAL}) CAI para o
//      regime 2, porque "campo pequeno" é uma expectativa e não uma garantia.
//   2. IMPRESSÃO ({@link CAMPOS_COM_IMPRESSAO}) — tudo que é ENDEREÇO ou MÍDIA:
//      `url`, `basePath`, `source`, `style`, `previewVideo`, os dois thumbnails,
//      `locate`, `bounds`, `keywords`. A linha registra um HMAC truncado do valor
//      antigo e do novo. Isso responde "mudou?" e "voltou ao que era?" sem carregar
//      um único byte do valor.
//   3. NOME-SÓ (`outros`) — qualquer chave que ninguém classificou. É EXATAMENTE a
//      garantia de hoje, preservada como PISO: o desconhecido nunca ganha valor
//      nem impressão, só o nome. Uma chave nova em `config` entra por aqui, calada
//      e fechada, sem que ninguém precise lembrar deste arquivo.
//
// A LISTA É FECHADA E A DIREÇÃO DO ERRO É DELIBERADA. Classificar de menos custa
// informação; classificar de mais custa um vazamento permanente. Por isso o default
// é o regime 3 e por isso `CAMPOS_COM_VALOR` não tem nenhum campo cujo nome sugira
// endereço, arquivo, chave ou credencial.
//
// ============================ AS FAMÍLIAS ====================================
//
// As listas são GLOBAIS e não por família, e isso é escolha, não descuido. Elas
// nasceram cobrindo catálogo e 360; em 2026-08-23 a família de USUÁRIOS entrou pelo
// mesmo caminho (cláusula 9.3), e a alternativa recusada foi um segundo par de listas
// com um segundo motor de comparação. O motivo é o de sempre nesta casa: a segunda
// cópia da regra é a que envelhece sozinha, e a pergunta que o de-para responde
// ("mudou? voltou ao que era? sem carregar o segredo") não muda com a família.
//
// O PREÇO DA ESCOLHA, dito por extenso, porque ele é real: os nomes de campo passam a
// competir num espaço único. Hoje não há colisão (a linha de catálogo tem `name` e a
// de conta tem `nome`; nenhuma família tem coluna com o nome da outra), e o guarda que
// mede isso é a asserção de disjunção entre as duas listas em
// `tests/unit/audit-diff.test.js`. Família nova com nome repetido precisa parar aqui e
// decidir, em vez de herdar o regime da vizinha por acidente.
//
// ============================ O QUE FICA DE FORA =============================
//
// Dito por extenso, porque "o que o guarda não pega" é a parte que envelhece se não
// for escrita:
//
//   - `config.url`, `config.basePath`, `config.source`, `config.labelSource` —
//     ENDEREÇO de serviço. Uma URL de tile de OM pode trazer `?api_key=` ou um
//     token de assinatura na query, e a trilha não é lugar de credencial. Só a
//     impressão entra.
//   - `config.previewThumbnail`, `config.thumbnail`, `config.image` — MÍDIA
//     EMBUTIDA. O painel grava a miniatura como data URL WebP de até ~256 kB;
//     literal, uma edição encheria a trilha e a linha estouraria qualquer teto.
//   - `config.previewVideo` — endereço de mídia, pelo mesmo motivo da `url`.
//   - `config.style` — o override de estilo MapLibre é um documento inteiro, com
//     `sources` que são endereços. Impressão.
//   - `config.locate`, `config.bounds`, `config.keywords` — não são segredo, mas são
//     estruturas de tamanho livre; literal, uma delas sozinha come o teto de 4 kB e
//     empurra o resto do de-para para o regime 3, que é o pior desfecho possível
//     (perder a informação ÚTIL para caber a inútil).
//   - QUALQUER OUTRA CHAVE de `config` — regime nome-só, por construção.
//   - A SENHA e qualquer campo de credencial de conta: eles não passam por aqui de
//     jeito nenhum. `updatePassword` grava `PASSWORD_RESET` com `{ self: true }` e
//     nada mais; este módulo nunca vê o corpo daquela rota. Desde a entrada da família
//     de usuários há também a rede explícita de {@link CAMPOS_FORA_DO_DEPARA}, abaixo.
//
// E DA FAMÍLIA DE USUÁRIOS, que entrou em 2026-08-23:
//
//   - `nome`, `username` e `email` são IMPRESSÃO, nunca valor. Os três identificam uma
//     PESSOA, e a trilha não se edita: gravar o nome civil de alguém literalmente, para
//     sempre, legível por todo administrador, é dado pessoal a mais do que a pergunta
//     da auditoria exige. A impressão responde "mudou? voltou ao que era?", que é a
//     pergunta de uma investigação de identidade (renomear uma conta para se passar por
//     outra, e desfazer depois). O `username` acompanha os outros dois porque ele é
//     METADE de uma credencial, e o `email` porque ele é o canal de recuperação da
//     conta.
//   - `password`, `password_hash`, `api_key` e `sessions_valid_from` NÃO ENTRAM NEM
//     COMO NOME. São o único fator de autenticação da casa e a chave de API que vale
//     pelo usuário inteiro; para eles o piso nome-só é generoso demais, porque o
//     próprio NOME do campo numa linha de trilha convida a próxima revisão a "melhorar"
//     pondo o valor. Eles são elididos antes da comparação.
//   - `id`, `created_at`, `updated_at` e `last_login_at` ficam de fora por RUÍDO, não
//     por segredo: `updated_at` muda em TODA gravação por construção (`SET updated_at =
//     NOW()`), então sem esta linha toda edição de conta traria uma entrada nome-só que
//     não informa nada e empurra o resto para perto do teto.
//   - `posto_graduacao` e `organizacao_militar` ficam de fora por DERIVAÇÃO: são nomes
//     trazidos por `LEFT JOIN` a partir de `rank_id` e `organization_id`, que estão
//     classificados. Registrar os dois lados diria a mesma mudança duas vezes, e o id é
//     o que dura (renomear a OM amanhã não reescreve a história de hoje).
//
// O QUE O REGIME 2 DIVULGA, E É DELIBERADO: além da impressão, a entrada grava o
// COMPRIMENTO EXATO em bytes de cada lado (`bytesDe`/`bytesPara`). Não é um byte do
// valor, mas é um oráculo de tamanho sobre uma URL que pode carregar `?api_key=`,
// gravado para sempre e legível por qualquer administrador e por qualquer produtor da
// OM dona. Fica porque responde "encolheu ou cresceu?" sem carregar conteúdo, e está
// dito aqui porque é o ÚNICO metadado do valor que a impressão deixa escapar — a frase
// "sem carregar um único byte do valor", acima, é literal e não é a história inteira.
//
// ============================== A IMPRESSÃO ==================================
//
// HMAC-SHA256 truncado em 12 hex, chaveado por `config.security.auditFingerprintKey`
// (derivada do segredo de JWT com separação de domínio; ver `src/config.js`).
//
// POR QUE HMAC E NÃO HASH NU: um hash sem chave transforma a trilha em oráculo de
// adivinhação — quem a lê testa um palpite de URL contra o digest e confirma. Com
// chave de servidor, confirmar exige a chave, que não sai em resposta nenhuma. Isso
// PRECISA continuar verdade: nada de endpoint que aceite um valor do cliente e
// devolva a impressão dele.
//
// POR QUE TRUNCAR EM 12: a impressão responde uma pergunta de IGUALDADE entre duas
// linhas da mesma trilha, não de unicidade global. 48 bits dão colisão desprezível
// no volume de uma trilha de catálogo (dezenas de milhares de linhas) e mantêm a
// linha legível na tela. Não é identificador; não o use como chave de nada.
//
// ================================= O TETO ====================================
//
// {@link LIMITE_DETALHES_BYTES}. Se o de-para serializado passar dele, a função
// DEGRADA INTEIRA para o regime nome-só e marca `truncado: true`. Degradar para
// menos informação é o único desfecho seguro: um de-para pela metade seria uma
// linha de trilha que mente por omissão sem dizer que omitiu.
import { createHmac } from 'node:crypto';
import config from '../config.js';

/** Tamanho da impressão, em dígitos hexadecimais. */
export const TAMANHO_IMPRESSAO = 12;

/** Acima disto, um campo do regime VALOR cai para IMPRESSÃO. */
export const LIMITE_VALOR_LITERAL = 200;

/** Teto duro do de-para serializado, em bytes UTF-8. */
export const LIMITE_DETALHES_BYTES = 4096;

/**
 * Os caminhos cujo valor entra LITERAL na trilha.
 *
 * Todo item desta lista é pequeno, fechado e não-endereçável. Acrescentar um campo
 * aqui é uma decisão de segurança, não de conveniência: o que entrar não sai mais.
 */
export const CAMPOS_COM_VALOR = Object.freeze([
  // --- conta (família USUÁRIOS) --------------------------------------------
  // O MIOLO DO QUE SE AUDITA NUMA CONTA. `role` e `producer_org_id` são os dois
  // fundamentos de concessão de RAIZ (`fundamentoDeRaizPerdido`, em
  // `src/modules/users/users.service.js`): mudar qualquer um dos dois derruba tudo o
  // que a pessoa concedeu, e uma trilha que diga "houve USER_UPDATE" sem dizer o que
  // virou o quê não responde a pergunta que essa queda levanta. Os quatro seguintes
  // são escalares fechados (um id de lista controlada, um id de OM, dois booleanos):
  // pequenos, não-endereçáveis e sem chance de carregar segredo, que é o critério
  // desta lista. `nome`, `username` e `email` NÃO estão aqui de propósito; ver o
  // cabeçalho.
  'role',
  'producer_org_id',
  'organization_id',
  'rank_id',
  'is_active',
  'email_verified',
  // --- catálogo e 360 -------------------------------------------------------
  'name',
  'description',
  'sort_order',
  'config.forma3d',
  'config.enabled',
  'config.priority',
  'config.minzoom',
  'config.maxzoom',
  'config.opacity',
  'config.tileSize',
  'config.sourceLayer',
  'config.heightOffset',
  'config.data_captura',
  'config.local',
]);

/**
 * Os caminhos que só entram como IMPRESSÃO: endereço, mídia ou estrutura livre.
 *
 * Estar aqui é mais forte do que estar fora das duas listas: o campo NÃO cai para
 * nome-só, ele ganha a impressão, que é o que permite responder "voltou ao que era".
 */
export const CAMPOS_COM_IMPRESSAO = Object.freeze([
  // --- conta (família USUÁRIOS) --------------------------------------------
  // Os TRÊS CAMPOS DE IDENTIDADE. Estar aqui é uma decisão de dois lados: eles não
  // caem para nome-só (a trilha continua respondendo "voltou ao que era?", que é a
  // pergunta de quem investiga uma conta renomeada) e não entram literais (a trilha
  // não se edita, e o nome civil de uma pessoa gravado para sempre é dado pessoal a
  // mais do que a auditoria precisa).
  'nome',
  'username',
  'email',
  // --- catálogo e 360 -------------------------------------------------------
  'config.url',
  'config.basePath',
  'config.source',
  'config.labelSource',
  'config.style',
  'config.previewVideo',
  'config.previewThumbnail',
  'config.thumbnail',
  'config.image',
  'config.locate',
  'config.bounds',
  'config.keywords',
]);

/**
 * Os caminhos que NÃO CHEGAM À TRILHA, nem sequer como nome.
 *
 * Esta lista é o único ponto do módulo em que o piso nome-só é considerado generoso
 * DEMAIS, e ela tem duas metades com razões diferentes, escritas porque a cláusula 9.3
 * manda escrever o que fica de fora:
 *
 *   - CREDENCIAL. `password`, `password_hash`, `api_key`, `sessions_valid_from`. Nome de
 *     campo de credencial numa linha de trilha não vaza nada hoje e convida a próxima
 *     revisão a "melhorar" pondo o valor; senha em log já foi defeito real neste
 *     projeto duas vezes. Nenhuma das consultas que alimentam o de-para hoje traz estas
 *     colunas, então a lista é rede e não conserto: ela existe para o dia em que um
 *     `SELECT *` alargar a projeção sem que ninguém pense nisto aqui.
 *   - RUÍDO E DERIVAÇÃO. `updated_at` muda em TODA gravação por construção; `id`,
 *     `created_at` e `last_login_at` não são editáveis pelos caminhos que produzem
 *     de-para; `posto_graduacao` e `organizacao_militar` são nomes trazidos por
 *     `LEFT JOIN` a partir de `rank_id` e `organization_id`, que já estão
 *     classificados, e diriam a mesma mudança duas vezes.
 *
 * ELA NÃO SUBSTITUI O PISO, e a distinção decide o comportamento de uma coluna NOVA:
 * uma coluna que ninguém classificar continua caindo em nome-só, calada e fechada. É só
 * o que está NESTA lista que desaparece.
 */
export const CAMPOS_FORA_DO_DEPARA = Object.freeze([
  'password',
  'password_hash',
  'api_key',
  'sessions_valid_from',
  'id',
  'created_at',
  'updated_at',
  'last_login_at',
  'posto_graduacao',
  'organizacao_militar',
]);

const COM_VALOR = new Set(CAMPOS_COM_VALOR);
const COM_IMPRESSAO = new Set(CAMPOS_COM_IMPRESSAO);
const FORA = new Set(CAMPOS_FORA_DO_DEPARA);

/**
 * As chaves de primeiro nível cujos FILHOS estão classificados (hoje: `config`).
 *
 * Derivada das duas listas em vez de escrita à mão: uma classificação nova sob uma
 * raiz nova passa a ser percorrida sem que ninguém precise editar uma segunda lista.
 */
const RAIZES_COM_FILHOS = new Set(
  [...CAMPOS_COM_VALOR, ...CAMPOS_COM_IMPRESSAO]
    .filter((c) => c.includes('.'))
    .map((c) => c.slice(0, c.indexOf('.')))
);

/** Um objeto simples (nem null, nem array, nem escalar). */
function ehObjeto(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Serialização CANÔNICA (chaves ordenadas em toda profundidade).
 *
 * As duas perguntas deste módulo — "mudou?" e "qual a impressão?" — precisam
 * responder igual para dois objetos iguais escritos em ordem diferente, e
 * `JSON.stringify` cru não faz isso: `{a:1,b:2}` e `{b:2,a:1}` produzem strings
 * distintas, o que fabricaria uma mudança onde não houve nenhuma.
 * @param {*} valor
 * @returns {string}
 */
function canonico(valor) {
  if (valor === undefined || valor === null) return 'null';
  if (typeof valor === 'string') return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (ehObjeto(valor)) {
    const partes = Object.keys(valor)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(valor[k])}`);
    return `{${partes.join(',')}}`;
  }
  return JSON.stringify(valor) ?? 'null';
}

/**
 * A IMPRESSÃO de um valor: HMAC-SHA256 chaveado, truncado em {@link TAMANHO_IMPRESSAO} hex.
 *
 * Determinística para o mesmo par (valor, chave), e é essa determinismo que faz a
 * trilha responder "voltou ao que era". Ela NÃO é reversível e NÃO carrega nenhuma
 * fatia do valor original.
 *
 * `chave` é parâmetro para que o teste possa provar que a saída DEPENDE dela sem
 * remexer em variável de ambiente; nenhum chamador de produção a passa.
 * @param {*} valor - String, número, objeto ou array. `null`/`undefined` viram `null`.
 * @param {Buffer|string} [chave] - Default: `config.security.auditFingerprintKey`.
 * @returns {string} 12 dígitos hexadecimais minúsculos.
 */
export function impressaoDeValor(valor, chave = config.security.auditFingerprintKey) {
  return createHmac('sha256', chave)
    .update(canonico(valor), 'utf8')
    .digest('hex')
    .slice(0, TAMANHO_IMPRESSAO);
}

/** O tamanho em bytes do valor, para a linha dizer o que a impressão não diz. */
function bytesDe(valor) {
  if (valor === undefined || valor === null) return 0;
  return Buffer.byteLength(typeof valor === 'string' ? valor : canonico(valor), 'utf8');
}

/** Um valor cabe LITERAL? Escalar sempre; string só até o teto; estrutura nunca. */
function cabeLiteral(valor) {
  if (valor === undefined || valor === null) return true;
  if (typeof valor === 'string') return valor.length <= LIMITE_VALOR_LITERAL;
  return typeof valor === 'number' || typeof valor === 'boolean';
}

/** O valor num caminho pontilhado, ou `undefined`. */
function valorEm(objeto, caminho) {
  return caminho.split('.').reduce((o, k) => (ehObjeto(o) ? o[k] : undefined), objeto);
}

/** A união ordenada das chaves de dois objetos. */
function chavesUniao(a, b) {
  return [...new Set([...Object.keys(ehObjeto(a) ? a : {}), ...Object.keys(ehObjeto(b) ? b : {})])];
}

/**
 * Todos os caminhos a comparar, em ordem estável.
 *
 * Duas profundidades e não uma varredura recursiva: as classificações vão até dois
 * segmentos (`config.x`), e descer mais fundo produziria caminhos que nenhuma das
 * duas listas alcança, isto é, mais entradas no regime nome-só sem informação nova.
 *
 * A RAIZ QUE DEIXA DE SER OBJETO vira ela mesma um caminho não classificado, em vez
 * de sumir: se `config` for substituído por um escalar, não há filhos a percorrer, e
 * o silêncio seria a única saída pior que o nome-só.
 */
function caminhosComparaveis(antes, depois) {
  const saida = [];
  for (const chave of chavesUniao(antes, depois)) {
    // A ELISÃO VEM ANTES DE TUDO, inclusive da descida nos filhos: o que está em
    // {@link CAMPOS_FORA_DO_DEPARA} não é comparado, não vira nome e não conta para o
    // teto. Filtrar depois deixaria o valor passar pelo comparador, que é onde o
    // descuido de amanhã moraria.
    if (FORA.has(chave)) continue;
    if (!RAIZES_COM_FILHOS.has(chave)) {
      saida.push(chave);
      continue;
    }
    const a = antes?.[chave];
    const d = depois?.[chave];
    const aOk = a === undefined || a === null || ehObjeto(a);
    const dOk = d === undefined || d === null || ehObjeto(d);
    if (!aOk || !dOk) {
      saida.push(chave);
      continue;
    }
    for (const sub of chavesUniao(a, d)) saida.push(`${chave}.${sub}`);
  }
  return saida.sort();
}

/**
 * @typedef {Object} DePara
 * @property {Array<Object>} mudou - Uma entrada por campo classificado que mudou. No
 *   regime VALOR ela é `{ campo, de, para }`; no regime IMPRESSÃO ela traz
 *   `regime: 'impressao'` e os pares `de`/`para` são impressões, com `bytesDe`/`bytesPara`.
 * @property {string[]} outros - Nomes (só nomes) dos campos mudados sem classificação.
 * @property {boolean} truncado - `true` quando o teto derrubou tudo para nome-só.
 */

/**
 * O de-para AUDITÁVEL entre duas versões de uma linha (catálogo, 360 ou conta).
 *
 * Comparação por VALOR canônico, nunca por identidade de objeto: o chamador entrega
 * a linha lida antes da escrita e a linha devolvida pelo `RETURNING`, que são dois
 * objetos distintos sempre. Um walker que comparasse referências reportaria "mudou"
 * em todo campo de toda edição.
 *
 * Uma edição que não muda nada devolve as duas listas vazias — e isso importa: o
 * painel reenvia o `config` inteiro a cada gravação, então sem esta propriedade toda
 * gravação fabricaria um de-para de dez campos idênticos.
 * @param {Object|null} antes
 * @param {Object|null} depois
 * @returns {DePara}
 */
export function diffAuditavel(antes, depois) {
  const mudou = [];
  const outros = [];

  for (const campo of caminhosComparaveis(antes, depois)) {
    const de = valorEm(antes, campo);
    const para = valorEm(depois, campo);
    if (canonico(de) === canonico(para)) continue;

    if (COM_VALOR.has(campo) && cabeLiteral(de) && cabeLiteral(para)) {
      mudou.push({ campo, de: de === undefined ? null : de, para: para === undefined ? null : para });
      continue;
    }
    if (COM_VALOR.has(campo) || COM_IMPRESSAO.has(campo)) {
      mudou.push({
        campo,
        regime: 'impressao',
        de: de === undefined || de === null ? null : impressaoDeValor(de),
        para: para === undefined || para === null ? null : impressaoDeValor(para),
        bytesDe: bytesDe(de),
        bytesPara: bytesDe(para),
      });
      continue;
    }
    outros.push(campo);
  }

  const tamanho = Buffer.byteLength(JSON.stringify({ mudou, outros }), 'utf8');
  if (tamanho > LIMITE_DETALHES_BYTES) {
    return { mudou: [], outros: [...outros, ...mudou.map((m) => m.campo)].sort(), truncado: true };
  }
  return { mudou, outros, truncado: false };
}
