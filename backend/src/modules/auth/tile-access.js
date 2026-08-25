// Path: src/modules/auth/tile-access.js
/**
 * @fileoverview O ENDPOINT DE `auth_request` DO NGINX PARA AS ROTAS DO MARTIN.
 *
 * O nginx passa a exigir a chave de API nas rotas servidas pelo servidor de tiles e
 * valida a credencial contra este endereço antes de fazer o proxy (cláusula 10.7 da
 * constituição, decisão do dono de 2026-08-23; a apuração das cinco opções está em
 * `PENDENCIA-TILE-PRIVADO.md`). Este arquivo é o lado deste servidor: um SIM ou NÃO
 * sobre a CREDENCIAL, sem corpo.
 *
 * ============================================================================
 * O QUE ELE COMPRA, E O QUE ELE NÃO COMPRA. Leia os dois parágrafos antes de
 * escrever qualquer tela ou qualquer frase que fale em "tile privado".
 * ============================================================================
 *
 * COMPRA: os bytes do tile saem de "abertos para a internet inteira" para "exigem uma
 * chave de API VIVA, de escopo que alcance tile". O estado de hoje é um `location` do
 * nginx apontando para o Martin sem predicado nenhum, com a URL gravada como texto
 * livre em `config` JSONB pelo administrador: quem adivinhasse ou já tivesse visto o
 * endereço baixava a camada privada. Depois disto, o público deixa de ser "qualquer
 * um" e passa a ser "quem porta uma chave viva". É um estreitamento real e medível.
 *
 * NÃO COMPRA: privacidade POR RECURSO. Este endpoint responde sobre a CREDENCIAL,
 * nunca sobre a CAMADA. Ele não recebe o caminho do tile, não sabe qual camada está
 * sendo pedida, e `fn_can_see_resource` não entra na história em ponto nenhum. Dito
 * sem eufemismo: um usuário COMUM com uma chave viva alcança os bytes do tile de uma
 * camada privada que o catálogo não lhe mostra, inclusive de outra organização. O que
 * o sim/não simples muda é o TAMANHO do público; ele não decide quem, dentro desse
 * público, pode ver o quê. Uma tela que prometer "tile privado fechado" a partir daqui
 * estará prometendo mais do que este endpoint entrega.
 *
 * A DECISÃO DE FICAR NO SIM/NÃO É DO DONO, de 2026-08-24, e a alternativa recusada
 * está escrita para que ninguém a redescubra do zero: o endpoint receberia o CAMINHO
 * repassado pelo nginx, extrairia dele a camada e consultaria o predicado de recurso.
 * O que isso custaria, e é por isso que não foi feito agora: o caminho do tile é texto
 * livre digitado no cadastro (não há mapa caminho -> linha de catálogo), a consulta
 * seria por TILE e não por sessão, e o acervo privado ainda divide prefixo com o
 * público, de modo que não existe recorte a aplicar. O item 2 da lista de
 * `PENDENCIA-TILE-PRIVADO.md` deixou de ser decisão pendente e passou a ser LIMITAÇÃO
 * DECLARADA por causa desta decisão.
 *
 * SÓ-`flexibleAuth`, NUNCA O `auth` ESTRITO, e isto não é preferência de estilo. O
 * `auth` estrito recusa a chave de escopo `tiles` de propósito (`apiKeyReaches(scope,
 * 'estrito')` em `middleware/auth.js`, que é como a amarra 2 foi implementada), então
 * montar o gate estrito aqui faria este endpoint recusar exatamente a credencial que
 * ele existe para aceitar, e o sintoma seria um 401 em TODO tile.
 *
 * SEM TRILHA DE AUDITORIA, e a ausência é decisão, não esquecimento. Duas razões
 * independentes: `audit_trail.action` não tem ação de LEITURA nenhuma, e inventar uma
 * para dizer que um portador buscou um tile gravaria uma afirmação que ninguém apurou
 * (este endpoint não sabe o que foi buscado, só que a credencial resolve); e seria uma
 * linha por TILE, o que afogaria a trilha inteira no evento de maior frequência do
 * sistema. O que É auditado continua sendo o ciclo de vida da chave (emissão e
 * revogação), que é onde a decisão humana acontece.
 *
 * O CUSTO, medido em I/O: ZERO consulta própria. O trabalho todo já foi feito por
 * `flexibleAuth`, que roda globalmente e gasta UMA consulta indexada
 * (`FIND_USER_BY_API_KEY`, `api_keys.api_key` e `users.api_key` são ambas UNIQUE),
 * e nem essa acontece quando a query não tem forma de UUID: a peneira `UUID_RE` do
 * middleware devolve o passante antes do banco. Este módulo lê só o que aquele já
 * pôs em `req`. NÃO HÁ MEMOIZAÇÃO AQUI, e a ausência é deliberada: um memo faria a
 * chave revogada, vencida ou cortada em massa continuar valendo pelo TTL, que é
 * exatamente a amarra 3 sendo desfeita em silêncio; e ele teria de morar em
 * `flexibleAuth`, cujo raio de alcance é o servidor inteiro, não o tile. Se o volume
 * apertar, o lugar de cachear é o `proxy_cache` da própria subrequisição no nginx,
 * onde o atraso de revogação fica visível como uma diretiva com prazo escrito, e não
 * escondido num Map de processo que ninguém invalida.
 */
import { API_KEY_SCOPES } from '../users/api-key-terms.js';

/**
 * Os DOIS motivos de recusa, nomeados para que um teste possa dizer POR QUAL TERMO a
 * recusa aconteceu. Sem isso, os oito casos de 401 deste endpoint são indistinguíveis
 * entre si, e um deles poderia estar passando pelo motivo errado sem nada acusar.
 */
export const TILE_ACCESS_DENIAL = Object.freeze({
  /** A credencial não é uma chave de API que RESOLVEU. */
  SEM_CHAVE_VIVA: 'sem-chave-viva',
  /** A chave resolveu e o escopo dela não alcança a superfície de tile. */
  ESCOPO_NAO_ALCANCA: 'escopo-nao-alcanca-tile',
});

/**
 * Se um escopo de chave alcança a superfície de TILE.
 *
 * O PREDICADO É "ESTÁ NO VOCABULÁRIO", e a razão é o desenho declarado em
 * `api-key-terms.js`: `API_KEY_SCOPE_REACH` tem uma coluna por superfície RESTRITA
 * (`estrito`, `administracao`), e o cabeçalho daquele arquivo diz por extenso que as
 * rotas SÓ-FLEXÍVEIS, "e o tile quando o nginx passar a validar aqui", são alcançadas
 * por toda chave que resolve. Escrever aqui uma segunda tabela com `tiles: true, full:
 * true` seria uma lista duplicada esperando a próxima divergência.
 *
 * FALHA FECHADO, que é a única direção aceitável: escopo nulo, indefinido, ou um valor
 * que um servidor mais novo tenha inventado não está no vocabulário deste build e não
 * alcança nada. O oposto (comparar por igualdade e cair no `else`) falharia ABERTO.
 *
 * NO DIA EM QUE EXISTIR UM ESCOPO QUE NÃO DEVA ALCANÇAR O TILE, a mudança certa é uma
 * coluna `tile` em `API_KEY_SCOPE_REACH`, lida por `apiKeyReaches(scope, 'tile')`, e
 * não um `if` acrescentado a esta função: é lá que o vocabulário mora, e é lá que
 * acrescentar um escopo obriga quem o acrescenta a responder a pergunta.
 *
 * @param {string|null|undefined} scope
 * @returns {boolean}
 */
export function scopeReachesTile(scope) {
  return typeof scope === 'string' && API_KEY_SCOPES.includes(scope);
}

/**
 * O predicado PURO da recusa, testável em node sem banco e sem Express.
 *
 * @param {{authVia?: string, apiKeyScope?: string|null}} credencial
 * @returns {string|null} O motivo (`TILE_ACCESS_DENIAL`), ou `null` quando passa.
 */
export function tileAccessDenial(credencial = {}) {
  if (credencial.authVia !== 'api_key') return TILE_ACCESS_DENIAL.SEM_CHAVE_VIVA;
  if (!scopeReachesTile(credencial.apiKeyScope)) return TILE_ACCESS_DENIAL.ESCOPO_NAO_ALCANCA;
  return null;
}

/**
 * O gate da rota de `auth_request`.
 *
 * RESPONDE SEM CORPO, e por isso NÃO lança `UnauthorizedError`: o `errorHandler`
 * serializaria um envelope JSON que o `auth_request` do nginx descarta sem ler (ele só
 * olha o status), e isso seria banda desperdiçada uma vez POR TILE.
 */
export function requireTileKey(req, res, next) {
  const motivo = tileAccessDenial({ authVia: req.authVia, apiKeyScope: req.user?.apiKeyScope });
  if (motivo) {
    // O MOTIVO SAI EM CABEÇALHO, NÃO EM CORPO, e a distinção é o que o mantém barato:
    // um cabeçalho de doze bytes não é payload por tile, e o `auth_request` do nginx só
    // olha o status (para o operador, ele é alcançável por `auth_request_set`, que é
    // como o motivo chega ao log de erro do host).
    //
    // ELE NÃO É UM ORÁCULO, e vale dizer por que: o desfecho `escopo-nao-alcanca-tile`
    // só é alcançável por quem JÁ porta uma chave que resolve, então distingui-lo de
    // `sem-chave-viva` não ajuda ninguém a enumerar chave nenhuma. O que ele compra é a
    // única coisa que faz um 401 sem corpo ser diagnosticável: saber se a recusa veio da
    // credencial ou do escopo dela.
    res.setHeader('X-EBGeo-Tile-Denial', motivo);
    res.status(401).end();
    return;
  }
  next();
}

/** O SIM. Sem corpo, pela mesma razão do NÃO. */
export function tileAccess(req, res) {
  res.status(200).end();
}
