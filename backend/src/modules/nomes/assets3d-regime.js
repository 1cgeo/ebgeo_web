// Path: src/modules/nomes/assets3d-regime.js
// WHICH BYTES UNDER /assets3d BELONG TO A PRIVATE CATALOG ROW — an in-memory index,
// rebuilt on catalog writes, NEVER queried per asset request.
//
// Why an index instead of a lookup: nothing in the storage layer ties a path to a
// resource. The SQLite store is `assets(rel_path PK, data, ...)` and the filesystem is a
// tree; the ONLY link between a served path and a catalog row is a STRING, and it runs
// one way — from the row (`config.url`, `config.basePath`) to the path. Inverting it per
// request would mean a query per request, and Cesium issues one request per tile per LOD.
// So the inversion is computed once and kept, and the invalidation hangs on the same write
// that already invalidates the /api/config memo (`config.cache.js`).
//
// THREE THINGS THIS INDEX DELIBERATELY DOES NOT REACH, named here so nobody reads its
// coverage as complete:
//
//  1. A catalog URL that this route does not serve. Of the three canonical prefixes in
//     this repository only `/api/v1/assets3d/...` passes through here; `/3d/...` and
//     `/catalogo/modelos_catalogo/...` are served by nginx or by Vite in dev. Their paths
//     still ENTER the index (a request that arrives here with that path is gated), but a
//     deploy that serves them from the web server bypasses this file entirely. "The
//     private 3D bytes are closed" is true of this route, not of nginx.
//  2. A row whose path sits at the ROOT of the asset tree. Its prefix would be empty and
//     would match every request; such an entry is dropped in BOTH directions (a private
//     root would deny the whole route, a public root would shadow every private prefix).
//  3. Anything the catalog does not describe. A path no row claims is PUBLIC, which is
//     exactly today's behavior and is what keeps the public model from regressing. ATENÇÃO,
//     e esta é a inversão que separa este índice do irmão de tiles: aqui o caminho NÃO
//     REIVINDICADO é uma resposta que ENTREGA bytes, enquanto lá ele é 401. Por isso o teto
//     de regime vencido (ver `regimeDoCaminho`) alcança os DOIS lados do "não é privado"
//     (a linha pública e o caminho que ninguém reivindica), e não só o primeiro. Quem
//     copiar daqui a fiação do irmão, ou vice-versa, precisa refazer essa conta.
//
// `active` IS NOT FILTERED, and that is not an oversight: a soft-deleted private row keeps
// its bytes on disk, so dropping it from the index would turn "delete a private tileset"
// into "publish its bytes". Whether the caller still reaches a soft-deleted resource is
// decided downstream by `fn_can_see_resource`, which is where that question belongs.

import path from 'node:path';
// As quatro funcoes puras de caminho vivem num modulo FOLHA, compartilhado com o indice do
// prefixo de tiles (`tile-regime.js`). Elas saíram daqui em 2026-08-29, quando o segundo
// consumidor apareceu: as licoes do dobramento de barra invertida e do case-folding
// custaram um vazamento medido cada uma, e uma copia que nao as recebesse repetiria os dois
// defeitos noutro prefixo, com o mesmo desfecho e sem nenhum sinal.
import { normalizarRel, ordenarEntradas, acharEntrada } from './caminho-de-recurso.js';
import {
  criarVigiaDeRegime,
  afirmacaoPublicaVencida,
  RegimeVencidoAlemDoTetoError,
} from './regime-vencido.js';
import { query } from '../../database/index.js';
import { SELECT_LINHAS_DE_CATALOGO } from '../catalog/catalog.tables.js';
import config from '../../config.js';

// The catalog fields that address a FOLDER (everything under them belongs to the row) and
// the ones that address a SINGLE FILE. The split is the point: a tileset's `config.url` is
// the `tileset.json` at the root of its tree, so the tree is `dirname(url)`, while a
// first-person scene declares the folder itself (`basePath`). The preview clip and the
// thumbnail are file-addressed because they routinely live OUTSIDE the model's folder (the
// seeded PCL model put its preview in a shared `/3d/videos/`), where a folder rule would
// either miss them or drag every neighbour in with them.
const CAMPOS_DE_PASTA = Object.freeze(['basePath']);
const CAMPOS_DE_ARQUIVO = Object.freeze(['previewVideo', 'previewThumbnail', 'thumbnail']);
const CAMPO_RAIZ_DE_ARVORE = 'url';

// A consulta vive em `catalog.tables.js` desde 2026-08-29, porque o índice do prefixo de
// tiles (`tile-regime.js`) precisa exatamente das mesmas linhas: uma segunda cópia
// divergiria na primeira tabela de catálogo nova, e o índice esquecido trataria as linhas
// dela como caminho que ninguém reivindica — que é a resposta que os dois decidem de forma
// oposta.
const INDICE_SQL = SELECT_LINHAS_DE_CATALOGO;

/** Backstop only. The mechanism is invalidation on write; this bounds a write path nobody wired. */
const TTL_MS = 60_000;

/** @type {{ promise: Promise<Array>, expiresAt: number }|null} */
let entrada = null;
/** @type {Array|null} The last index that BUILT, kept so a database blip does not close the route. */
let ultimoBom = null;
/**
 * Quem torna ESCRITA a queda para o `ultimoBom`, que era muda. A janela que o comentário de
 * `invalidarRegimeDeAssets3d()` abaixo declara em vez de esconder passou a falar: uma linha
 * na entrada em regime vencido e uma na volta, nunca uma por consulta. O porquê da forma e
 * do nível está em `regime-vencido.js`, compartilhado com `tile-regime.js` porque a
 * pergunta "este índice está velho, e há quanto tempo" não depende do que ele indexa.
 */
const vigia = criarVigiaDeRegime('assets3d');

/**
 * Drops the index so the next asset request rebuilds it.
 *
 * Called from `invalidateAppConfigCache()`, which every catalog / visibility write already
 * calls. It does NOT clear `ultimoBom`: that copy is the fallback for a rebuild that FAILS,
 * and throwing it away would trade a stale answer for no answer at all.
 *
 * A janela que isto abre, e ela deixou de ser ilimitada em 2026-09-01: uma linha virada
 * public -> private cuja reconstrução seguinte falha continua sendo servida pelo regime
 * antigo até que alguma reconstrução dê certo, mas agora só até o teto
 * (`REGIME_STALE_MAX_MS`, 5 min por padrão), depois do qual a resposta pública deixa de sair
 * e vira 503. A alternativa (fechar em qualquer piscada) derruba os modelos públicos junto,
 * e é por isso que o teto é folgado em vez de zero.
 */
export function invalidarRegimeDeAssets3d() {
  entrada = null;
}

/**
 * A catalog URL as a path in the SAME vocabulary as `req.params[0]`, or null.
 *
 * Null for an absolute URL (`https://…`, `//host/…`): a row pointing at another origin is
 * not served by this route, and turning `https://x/y` into the prefix `https:/x/y` would
 * plant an entry that could only ever match by accident.
 *
 * @param {*} bruto
 * @returns {string|null}
 */
function relDaUrl(bruto) {
  if (typeof bruto !== 'string' || !bruto.trim()) return null;
  const s = bruto.trim();
  if (s.includes('://') || s.startsWith('//')) return null;
  const base = config.assets3d.baseUrl.replace(/\/+$/, '');
  const semBase = base && s.startsWith(`${base}/`) ? s.slice(base.length) : s;
  const rel = normalizarRel(semBase);
  return rel === '' || rel === '.' ? null : rel;
}

/**
 * The flat entry list, longest `alvo` first, so the FIRST match is the winner.
 *
 * `chave` is the comparison form (see `chaveDeCasamento`) and is precomputed here rather than
 * per request: the match runs on every asset request and the index changes only on a catalog
 * write, so folding the whole index on each of Cesium's thousands of tile requests would put
 * the cost on exactly the side this design keeps empty.
 *
 * @param {Array<{tipo: string, id: string, access_level: string, config: object}>} linhas
 * @returns {Array<{alvo: string, chave: string, arquivo: boolean, privado: boolean, tipo: string, resourceId: string}>}
 */
function montarIndice(linhas) {
  const entradas = [];
  for (const linha of linhas) {
    const cfg = linha.config && typeof linha.config === 'object' ? linha.config : {};
    const recurso = {
      privado: linha.access_level === 'private',
      tipo: linha.tipo,
      resourceId: linha.id,
    };
    // The tileset tree: the row addresses `<tree>/tileset.json`, so the tree is its folder.
    const raiz = relDaUrl(cfg[CAMPO_RAIZ_DE_ARVORE]);
    if (raiz) {
      const pasta = path.posix.dirname(raiz);
      if (pasta && pasta !== '.' && pasta !== '/') entradas.push({ alvo: pasta, arquivo: false, ...recurso });
    }
    for (const campo of CAMPOS_DE_PASTA) {
      const rel = relDaUrl(cfg[campo]);
      if (rel) entradas.push({ alvo: rel, arquivo: false, ...recurso });
    }
    for (const campo of CAMPOS_DE_ARQUIVO) {
      const rel = relDaUrl(cfg[campo]);
      if (rel) entradas.push({ alvo: rel, arquivo: true, ...recurso });
    }
  }
  // Longest first, and PRIVATE first on a tie — the fail-closed half, now in
  // `caminho-de-recurso.js` because the tile index needs exactly the same rule.
  return ordenarEntradas(entradas);
}

/** @returns {Promise<Array>} The index, built at most once per invalidation. */
function lerIndice() {
  const agora = Date.now();
  if (entrada && entrada.expiresAt > agora) return entrada.promise;

  const promise = query(INDICE_SQL, []).then(({ rows }) => {
    const indice = montarIndice(rows);
    ultimoBom = indice;
    // AFTER publishing: this stamps the age of the last good index, and it is what writes
    // the back-to-normal line when we were stale.
    vigia.anotarConstrucao();
    return indice;
  });

  const fresca = { promise, expiresAt: agora + TTL_MS };
  entrada = fresca;

  // A failed build must not be remembered, exactly as in `config.cache.js`: the next request
  // has to try again instead of replaying one rejection for the whole TTL.
  promise.catch(() => {
    if (entrada === fresca) entrada = null;
  });

  return promise;
}

/**
 * The access regime of ONE served path.
 *
 * LONGEST MATCH WINS, so a private model nested inside a public tree is still private and a
 * public model nested inside a private tree is still public. Matching runs on the NORMALIZED,
 * CASE-FOLDED path, because the variants (`./x`, `//x`, a collapsible `..`, a backslash, a
 * different case) miss the SQLite store's exact-equality index and are still served by the
 * filesystem branch, whose separator set and case sensitivity are the HOST's: normalizing after
 * the test would let the hole back in through the variant. See `normalizarRel` and
 * `chaveDeCasamento` for the two spellings that were measured serving private bytes.
 *
 * O TETO ALCANÇA UMA RESPOSTA SÓ, E É A QUE ENTREGA BYTES SEM CREDENCIAL. Passado o prazo
 * de `afirmacaoPublicaVencida`, um índice vencido perde o direito de dizer "isto não é
 * privado", e é aí que a inversão declarada no item 3 do cabeçalho cobra o seu preço: aqui
 * essa afirmação são DUAS, a linha pública e o caminho que nenhuma linha reivindica, porque
 * as duas são servidas. No irmão de tiles a segunda já é 401 e fica de fora. A consequência
 * precisa ser dita em voz alta, porque é a mais cara desta mudança: com o banco fora por
 * mais que o teto, esta rota passa a responder 503 para o acervo 3D INTEIRO, público e não
 * catalogado inclusive, e não só para as linhas públicas do catálogo.
 *
 * O ramo PRIVADO segue intacto nos dois lados do teto, e não por descuido: este índice não
 * decide o privado, só diz o tipo e o id; quem decide é `fn_can_see_resource`, no banco, por
 * `assets3d-acesso.js`. Fechá-lo junto derrubaria o gate que continua funcionando.
 *
 * @param {string} rel - `req.params[0]`, as the route received it.
 * @returns {Promise<{privado: boolean, tipo?: string, resourceId?: string}>}
 * @throws When the index has never been built and cannot be, or when the NOT-PRIVATE answer
 *   would come from an index stale beyond the ceiling. The caller answers 503 in both cases:
 *   with no trustworthy index there is no honest answer, and guessing means choosing between
 *   denying the public models and serving the private ones.
 */
export async function regimeDoCaminho(rel) {
  let indice;
  /** @type {number|null} `null` = o índice desta resposta é o vigente. */
  let vencidoHaMs = null;
  try {
    indice = await lerIndice();
  } catch (err) {
    if (!ultimoBom) throw err;
    // After the rethrow branch on purpose: that one answers 503 and is loud by itself,
    // while THIS one was serving stale state without a word anywhere.
    vigia.anotarQueda(err);
    vencidoHaMs = vigia.vencidoHaMs();
    indice = ultimoBom; // stale, but a stale answer beats closing the route on a blip
  }

  const e = acharEntrada(indice, rel);
  if (e && e.privado) return { privado: true, tipo: e.tipo, resourceId: e.resourceId };
  // Sem linha de log: a transição para o regime vencido já foi registrada uma vez, com a
  // idade, e este caminho corre uma vez por tile do Cesium. Ver `regime-vencido.js`.
  if (afirmacaoPublicaVencida(vencidoHaMs)) {
    throw new RegimeVencidoAlemDoTetoError('assets3d', vencidoHaMs, config.regimeIndex.staleMaxMs);
  }
  if (e) return { privado: false, tipo: e.tipo, resourceId: e.resourceId };
  return { privado: false };
}

/** Test seam: the pure halves, so a unit test can assert the derivation without a database. */
export const _internos = Object.freeze({ montarIndice, relDaUrl, normalizarRel, acharEntrada });
