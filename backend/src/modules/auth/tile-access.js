// Path: src/modules/auth/tile-access.js
/**
 * @fileoverview O ENDPOINT DE `auth_request` DO NGINX PARA AS ROTAS DO SERVIDOR DE TILES.
 *
 * O nginx valida a credencial contra este endereço antes de fazer o proxy (cláusula 10.7
 * da constituição, decisão do dono de 2026-08-23; a apuração das cinco opções está em
 * `PENDENCIA-TILE-PRIVADO.md`). Este arquivo é o lado deste servidor.
 *
 * ============================================================================
 * ELE DECIDE POR RECURSO DESDE 2026-08-29, e antes disso não decidia. A versão anterior
 * respondia sobre a CREDENCIAL e nunca sobre a CAMADA: qualquer chave viva alcançava o
 * tile de qualquer camada privada, inclusive de outra organização, e isso ficou registrado
 * como limitação declarada. Foi MEDIDO em
 * `dev/tile-privado/scripts/confere-martin-nginx.sh` (um usuário comum que não vê a camada
 * em nenhuma das duas portas do catálogo baixava os tiles dela), e o dono decidiu fechar.
 * A secção (f) daquele arquivo carrega as cinco decisões; as quatro que este arquivo
 * implementa estão nomeadas nos comentários abaixo, uma por ramo.
 * ============================================================================
 *
 * OS QUATRO DESFECHOS, e a ordem entre eles é o desenho:
 *
 *   1. CAMINHO NÃO REIVINDICADO -> 401. Nenhuma linha de catálogo endereça este caminho.
 *      É a decisão 4, e ela INVERTE a regra do irmão do 3D, onde caminho não reivindicado
 *      é público. Lá isso é seguro (o Node serve o acervo inteiro e há arquivos legítimos
 *      fora do catálogo); aqui o endereço é texto livre digitado à mão, e serão centenas
 *      de camadas: um erro de digitação numa linha privada publicaria os bytes em
 *      silêncio. O preço é que uma fonte publicada sem cadastro deixa de desenhar, o que
 *      é um defeito VISÍVEL, ao contrário do outro.
 *
 *   2. LINHA PÚBLICA -> 200, SEM CREDENCIAL NENHUMA. É a decisão 5, e é ela que devolve o
 *      produto: o visitante anônimo volta a ver camada de dados, e o tile público volta a
 *      ser cacheável na borda. Antes desta versão o `location` exigia chave de todo mundo,
 *      o que fechava o vazamento e apagava o mapa de quem não tinha login.
 *
 *   3. LINHA PRIVADA, sem principal que resolva -> 401.
 *
 *   4. LINHA PRIVADA, com principal -> o MESMO predicado de todo o resto
 *      (`fn_can_see_resource`, por `recursoPrivadoLiberado`), memoizado por (chamador,
 *      empréstimo, recurso).
 *
 * O CUSTO, e ele é a razão de o índice existir: ZERO consulta no caminho público. O
 * regime sai de um índice em memória, reconstruído só na escrita de catálogo
 * (`tile-regime.js`), e a decisão do privado é memoizada por 30 s. Um mapa com cinco
 * camadas ligadas pede da ordem de cem tiles por deslocamento, e responder cada um com uma
 * ida ao banco poria essa vazão no mesmo pool de dez conexões que serve o sync, o socket de
 * colaboração e o `GET /api/config`, cuja falha impede o boot.
 *
 * SÓ-`flexibleAuth`, NUNCA O `auth` ESTRITO, e isto não é preferência de estilo. O `auth`
 * estrito recusa a chave de escopo `tiles` de propósito (`apiKeyReaches(scope, 'estrito')`),
 * então montar o gate estrito aqui faria este endpoint recusar exatamente a credencial que
 * ele existe para aceitar, e o sintoma seria um 401 em TODO tile.
 *
 * SEM TRILHA DE AUDITORIA, e a ausência é decisão, não esquecimento. Duas razões
 * independentes: `audit_trail.action` não tem ação de LEITURA nenhuma, e seria uma linha
 * por TILE, o que afogaria a trilha inteira no evento de maior frequência do sistema. O
 * que É auditado continua sendo o ciclo de vida da credencial.
 *
 * NÃO HÁ MEMOIZAÇÃO DA RESPOSTA HTTP AQUI, e a ausência é deliberada: um memo de resposta
 * faria a chave revogada, vencida ou cortada em massa continuar valendo pelo TTL. Se o
 * volume apertar, o lugar de cachear é o `proxy_cache` da própria subrequisição no nginx,
 * chaveado por (credencial, fonte) — a fonte precisa entrar na chave, porque a resposta
 * agora VARIA por recurso —, onde o atraso de revogação fica visível como uma diretiva com
 * prazo escrito.
 */
import config from '../../config.js';
import { API_KEY_SCOPES } from '../users/api-key-terms.js';
import { regimeDoTile } from '../nomes/tile-regime.js';
import { recursoPrivadoLiberado } from '../nomes/assets3d-acesso.js';

/**
 * Os motivos de recusa, nomeados para que um teste possa dizer POR QUAL TERMO a recusa
 * aconteceu. Sem isso os 401 deste endpoint são indistinguíveis entre si, e um deles
 * poderia estar acontecendo pelo motivo errado sem nada acusar.
 */
export const TILE_ACCESS_DENIAL = Object.freeze({
  /** Nenhuma linha de catálogo endereça este caminho (decisão 4). */
  CAMINHO_NAO_REIVINDICADO: 'caminho-nao-reivindicado',
  /** A linha é privada e não veio credencial que resolvesse. */
  SEM_CREDENCIAL: 'sem-credencial',
  /** A credencial resolveu e o recurso não a alcança. */
  RECURSO_NAO_ALCANCADO: 'recurso-nao-alcancado',
  /** A credencial é uma chave de API cujo escopo não alcança a superfície de tile. */
  ESCOPO_NAO_ALCANCA: 'escopo-nao-alcanca-tile',
});

/**
 * Se um escopo de chave alcança a superfície de TILE.
 *
 * O PREDICADO É "ESTÁ NO VOCABULÁRIO", e a razão é o desenho declarado em
 * `api-key-terms.js`: `API_KEY_SCOPE_REACH` tem uma coluna por superfície RESTRITA
 * (`estrito`, `administracao`), e o cabeçalho daquele arquivo diz que as rotas
 * só-flexíveis, "e o tile quando o nginx passar a validar aqui", são alcançadas por toda
 * chave que resolve. Escrever aqui uma segunda tabela seria uma lista duplicada esperando
 * a próxima divergência.
 *
 * FALHA FECHADO: escopo nulo, indefinido, ou um valor que um servidor mais novo tenha
 * inventado não está no vocabulário deste build e não alcança nada. O oposto (comparar por
 * igualdade e cair no `else`) falharia ABERTO.
 *
 * NO DIA EM QUE EXISTIR UM ESCOPO QUE NÃO DEVA ALCANÇAR O TILE, a mudança certa é uma
 * coluna `tile` em `API_KEY_SCOPE_REACH`, lida por `apiKeyReaches(scope, 'tile')`, e não um
 * `if` acrescentado a esta função: é lá que o vocabulário mora, e é lá que acrescentar um
 * escopo obriga quem o acrescenta a responder a pergunta.
 *
 * @param {string|null|undefined} scope
 * @returns {boolean}
 */
export function scopeReachesTile(scope) {
  return typeof scope === 'string' && API_KEY_SCOPES.includes(scope);
}

/**
 * O caminho pedido, no vocabulário do índice: sem o prefixo público e sem a query.
 *
 * O NGINX MANDA A URI ORIGINAL INTEIRA (`X-Original-URI`), e não o caminho já recortado,
 * porque recortar exigiria uma captura no `location` e faria a configuração do host
 * carregar conhecimento sobre o formato do endereço. Aqui o recorte usa a MESMA base que
 * o índice usa para indexar (`appConfig.tileServerUrl`), o que garante que os dois lados
 * concordem sobre onde o prefixo termina.
 *
 * DEVOLVE `null` QUANDO NÃO HÁ CABEÇALHO, e o chamador lê isso como recusa: um nginx
 * configurado sem o cabeçalho não pode receber "sim" para tudo, que seria a falha aberta.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
export function caminhoDoTile(req) {
  const bruto = req.get('x-original-uri');
  if (typeof bruto !== 'string' || !bruto.trim()) return null;
  const semQuery = bruto.split('?')[0].split('#')[0];

  const base = String(config.appConfig?.tileServerUrl ?? '').trim().replace(/\/+$/, '');
  // A base pode ser absoluta (`http://host/tiles`) ou um caminho (`/tiles`); o que o nginx
  // manda é sempre um caminho, então o que interessa é a parte de caminho dela.
  const prefixo = base.replace(/^https?:\/\/[^/]+/, '');
  // O prefixo NU (`/tiles`, sem barra) não endereça fonte nenhuma, e é tratado junto com
  // `/tiles/` para que os dois caiam no mesmo `null`. O nginx não produz essa forma num
  // `location` de prefixo, mas o custo de cobri-la é uma comparação e a direção é fechada.
  if (prefixo && semQuery === prefixo) return null;
  const semPrefixo = prefixo && semQuery.startsWith(`${prefixo}/`)
    ? semQuery.slice(prefixo.length)
    : semQuery;

  const rel = semPrefixo.replace(/^\/+/, '');
  return rel === '' ? null : rel;
}

/**
 * O gate. Assíncrono porque consulta o índice (memória) e, só no ramo privado, o predicado.
 *
 * RESPONDE SEM CORPO, e por isso não lança `UnauthorizedError`: o `errorHandler`
 * serializaria um envelope JSON que o `auth_request` descarta sem ler (ele só olha o
 * status), e isso seria banda desperdiçada uma vez POR TILE.
 *
 * @type {import('express').RequestHandler}
 */
export async function requireTileAccess(req, res, next) {
  const caminho = caminhoDoTile(req);
  if (!caminho) return recusar(res, TILE_ACCESS_DENIAL.CAMINHO_NAO_REIVINDICADO);

  let regime;
  try {
    regime = await regimeDoTile(caminho);
  } catch (erro) {
    // Sem índice e sem cópia anterior não há decisão possível. Servir vazaria e recusar
    // derrubaria o acervo público inteiro, então nenhum dos dois é respondido em silêncio:
    // 503 diz "não consigo decidir", e o nginx o repassa como erro em vez de como negação.
    return next(erro);
  }

  // 1. Decisão 4: o que ninguém reivindica não sai.
  if (!regime.reivindicado) return recusar(res, TILE_ACCESS_DENIAL.CAMINHO_NAO_REIVINDICADO);

  // 2. Decisão 5: o público sai para qualquer um, sem credencial e sem consulta.
  if (!regime.privado) return liberar(res);

  // 3. Privado exige um principal que `flexibleAuth` tenha resolvido. Vale o JWT (por
  //    cabeçalho ou por cookie) e a chave de API.
  if (!req.user) return recusar(res, TILE_ACCESS_DENIAL.SEM_CREDENCIAL);

  //    E quando a credencial É uma chave, o escopo dela precisa alcançar esta superfície.
  //    A checagem fica DENTRO deste ramo de propósito: aplicá-la ao JWT compararia um
  //    vocabulário de chave com uma sessão que não tem escopo nenhum, e o `undefined`
  //    resultante recusaria toda sessão de usuário — falha fechada, porém errada.
  if (req.authVia === 'api_key' && !scopeReachesTile(req.user.apiKeyScope)) {
    return recusar(res, TILE_ACCESS_DENIAL.ESCOPO_NAO_ALCANCA);
  }

  // 4. E então o mesmo predicado de todo o resto do acervo privado.
  const liberado = await recursoPrivadoLiberado(req, { tipo: regime.tipo, resourceId: regime.resourceId });
  return liberado ? liberar(res) : recusar(res, TILE_ACCESS_DENIAL.RECURSO_NAO_ALCANCADO);
}

/**
 * O SIM. Sem corpo.
 * @param {import('express').Response} res
 */
function liberar(res) {
  res.status(200).end();
}

/**
 * O NÃO, com o motivo em CABEÇALHO e não em corpo.
 *
 * A distinção é o que o mantém barato: um cabeçalho de doze bytes não é payload por tile,
 * e o `auth_request` só olha o status (para o operador, o motivo é alcançável por
 * `auth_request_set`, que é como ele chega ao log de erro do host).
 *
 * ELE NÃO É UM ORÁCULO. Os três motivos distinguem de onde veio a recusa — do catálogo, da
 * credencial ausente ou do predicado —, e nenhum deles diz se um recurso EXISTE: um
 * caminho não reivindicado e um caminho privado que o chamador não alcança respondem o
 * mesmo 401, e a diferença entre eles só é legível para quem já tem a credencial.
 *
 * @param {import('express').Response} res
 * @param {string} motivo
 */
function recusar(res, motivo) {
  res.setHeader('X-EBGeo-Tile-Denial', motivo);
  res.status(401).end();
}
