// Path: src/modules/users/api-key-terms.js
/**
 * @fileoverview O VOCABULÁRIO DA CHAVE DE API: prazo e alcance, num módulo FOLHA.
 *
 * ZERO IMPORTS, por contrato, e o motivo é o mesmo de `catalog/grant-tree.js` no
 * cliente: este arquivo é lido por um middleware (`require-admin.js`), pelo `auth`
 * estrito, pelo serviço de usuários e por teste de node puro. Um import daqui para o
 * banco ou para os erros de HTTP faria o gate arrastar meia aplicação.
 *
 * O QUE ELE EXISTE PARA IMPEDIR. A cláusula 10.7 da constituição decidiu que a chave
 * de API passa a ser a credencial que o nginx valida nas rotas do servidor de tiles.
 * A frase que resume o risco está lá: "uma chave que vaza de um log de tile é uma
 * sessão de administrador sem prazo". As três amarras (prazo, escopo, revogação que
 * não seja só a rotação) precisam vir ANTES daquele `location`, e duas delas são
 * decididas por este arquivo.
 *
 * O ALCANCE É UMA TABELA, NÃO UM `if`. `API_KEY_SCOPE_REACH` é o inventário: uma
 * linha por escopo, uma coluna por superfície. Escrever `scope === 'full'` espalhado
 * pelos gates seria a lista fechada que a constituição proíbe nos dois eixos de
 * permissão — a diferença é que aqui ela falharia ABERTO, porque o escopo que alguém
 * inventar depois deste build cairia no `else` de quem comparou por igualdade.
 * `apiKeyReaches` devolve `false` para escopo desconhecido, que é a direção certa.
 *
 * A COLUNA `administracao` É FALSA EM TODA LINHA, e isso é o desenho, não uma lacuna
 * esperando o valor que falta. Uma chave existe para buscar dado; configurar o
 * sistema é ato de sessão, com senha, prazo curto e corte em massa. Ela fica escrita
 * como DADO, e não como um `return false` escondido dentro do gate, exatamente para
 * que acrescentar um escopo obrigue quem o acrescenta a responder a pergunta.
 *
 * SOBRE O SLOT LEGADO. `users.api_key` é anterior a este vocabulário e resolve como
 * `full`, que é o comportamento que ele sempre teve (menos administração, que passa a
 * ser negada a toda chave). Ele continua existindo porque migração é forward-only e
 * porque integradores o carregam hoje; o caminho de saída, quando ninguém mais
 * depender dele, é uma migração própria que o apague depois de as contas terem
 * migrado para chaves nomeadas. Enquanto ele viver, `FIND_USER_BY_API_KEY` é o único
 * lugar onde os dois se encontram.
 */

/** O escopo que uma chave nomeada recebe quando o pedido não diz outro. */
export const API_KEY_SCOPE_DEFAULT = 'tiles';

/** O escopo com que o slot legado (`users.api_key`) resolve. */
export const API_KEY_SCOPE_LEGACY = 'full';

/**
 * O ALCANCE DE CADA ESCOPO, por superfície.
 *
 * `estrito`: as rotas que exigem o middleware `auth` (escrita e leitura de conta).
 * `administracao`: as rotas atrás de `requireAdmin`.
 *
 * Nenhuma das duas cobre as rotas SÓ-FLEXÍVEIS (360, nomes, assets3d, catálogo, e o
 * tile quando o nginx passar a validar aqui): lá a chave sempre alcança, e o recorte
 * é do predicado SQL de recurso privado, que é onde ele já mora.
 */
export const API_KEY_SCOPE_REACH = {
  tiles: { estrito: false, administracao: false },
  full: { estrito: true, administracao: false },
};

/** O vocabulário fechado, derivado da tabela de alcance para não haver segunda lista. */
export const API_KEY_SCOPES = Object.keys(API_KEY_SCOPE_REACH);

/**
 * A escada de prazos oferecida, em dias, e o teto.
 *
 * O TETO COPIA O DA CONCESSÃO DE RECURSO (um ano, `resource_grants_expires_at_check`),
 * e a igualdade é deliberada: são as duas credenciais duráveis do sistema, e um teto
 * diferente em cada uma faria "o prazo máximo" ser duas respostas.
 */
export const API_KEY_TERMS = [30, 90, 180, 365];
export const API_KEY_TERM_DEFAULT_DAYS = 90;
export const API_KEY_TERM_MAX_DAYS = 365;

/** Quantas chaves VIVAS uma conta pode ter ao mesmo tempo. */
export const API_KEY_LIVE_LIMIT = 10;

/**
 * Se um escopo alcança uma superfície.
 *
 * FALHA FECHADO nos dois eixos: escopo que não está na tabela (nulo, valor de um
 * servidor mais novo, string do chamador) não alcança nada, e superfície que não é
 * coluna também não. É o oposto do `else` de uma lista fechada, e é a razão de este
 * predicado existir em vez de uma comparação por igualdade em cada gate.
 *
 * @param {string|null|undefined} scope
 * @param {'estrito'|'administracao'} superficie
 * @returns {boolean}
 */
export function apiKeyReaches(scope, superficie) {
  const linha = API_KEY_SCOPE_REACH[scope];
  if (!linha) return false;
  return linha[superficie] === true;
}

/**
 * O prazo pedido, aparado no teto e devolvido em dias.
 *
 * Pedido ausente vira o padrão; pedido acima do teto vira o TETO, e não um erro,
 * pela mesma razão que a renovação de concessão apara em vez de recusar: quem pede
 * mais recebe o máximo, e a tela mostra o prazo EFETIVO. Pedido inválido (não
 * finito, zero, negativo) vira o padrão — `?? 0` não guarda `NaN`, então a checagem
 * é `Number.isFinite`.
 *
 * @param {number|null|undefined} dias
 * @returns {number} Dias entre 1 e `API_KEY_TERM_MAX_DAYS`.
 */
export function clampApiKeyTermDays(dias) {
  if (!Number.isFinite(dias) || dias <= 0) return API_KEY_TERM_DEFAULT_DAYS;
  return Math.min(Math.floor(dias), API_KEY_TERM_MAX_DAYS);
}
