// Path: js/store/sync/assets3d-request.js

/**
 * @fileoverview Como uma requisição de ASSET 3D se identifica ao servidor.
 *
 * Desde a fase F11 os bytes sob `/api/v1/assets3d` seguem o RECURSO e não a rota: modelo
 * público continua servido a qualquer um, modelo PRIVADO passa por um gate e responde 404
 * para quem não o alcança. O servidor decide com duas entradas, e as duas precisam viajar
 * na requisição que o Cesium (ou um `fetch`) faz:
 *
 *   - `?atlasId=` — QUAL empréstimo o chamador quer usar. Não é senha: o servidor roda
 *     `requireAtlasPermission('read')` sobre ele. É o único dos dois que funciona para o
 *     visitante ANÔNIMO de um atlas de link público, e o único que atravessa um `<img>` ou
 *     um `<video>`, que não têm como carregar cabeçalho.
 *   - `Authorization: Bearer` — QUEM está pedindo, para o acesso que vem de papel global ou
 *     de concessão pessoal, sem atlas nenhum em foco.
 *
 * POR QUE O CABEÇALHO ATRAVESSA O CESIUM, que é o ponto que decide se isto funciona:
 * `Resource.clone()` copia `headers`, `queryParameters` e `retryCallback`, e
 * `getDerivedResource()` os funde no filho. Ou seja, carimbar o `tileset.json` alcança todo
 * tileset filho, todo `.b3dm` e todo buffer externo que ele derivar. Verificado no bundle
 * vendorizado (`public/vendors/cesium/Cesium.js`, 1.138.0) antes de o desenho depender disso.
 *
 * O QUE ESTE MÓDULO NÃO RESOLVE, e é melhor estar escrito aqui do que ser descoberto como
 * bug: um endereço que o NAVEGADOR busca sozinho (`<img src>`, `<video src>`, um loader de
 * terceiros que não aceita cabeçalho) não carrega `Authorization`. Para esses, o acesso a
 * um recurso privado depende do braço de empréstimo, isto é, de haver um atlas em foco que
 * o empreste. Fechar o resto exigiria cookie de sessão, que é o eixo de autenticação e não
 * o desta fase.
 */

import { apiClient } from './api-client.js';
import { currentResourceAtlasId } from './resource-scope.js';

/** Endereço de OUTRA origem: carimbar credencial nele seria vazá-la para terceiro. */
const OUTRA_ORIGEM_RE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/**
 * O escopo de atlas que deve acompanhar uma requisição de asset, ou null.
 * @returns {string|null}
 */
export function escopoDeAsset() {
    return currentResourceAtlasId();
}

/**
 * A mesma URL, com `atlasId` na query quando há atlas em foco.
 *
 * Para o endereço que o navegador busca sozinho, este é o único carimbo possível. Endereço
 * de outra origem sai INTACTO: o empréstimo é uma afirmação sobre este servidor, e anexá-la
 * a um host de terceiro só contaria a ele em que atlas o usuário está.
 *
 * @param {string} url
 * @returns {string} A URL carimbada, ou a original quando não há o que carimbar.
 */
export function escoparUrlDeAsset(url) {
    if (typeof url !== 'string' || !url) return url;
    const atlasId = escopoDeAsset();
    if (!atlasId || OUTRA_ORIGEM_RE.test(url)) return url;
    if (/[?&]atlasId=/.test(url)) return url;
    const [semHash, hash = ''] = url.split('#');
    const separador = semHash.includes('?') ? '&' : '?';
    return `${semHash}${separador}atlasId=${encodeURIComponent(atlasId)}${hash ? `#${hash}` : ''}`;
}

/**
 * Os cabeçalhos de credencial de uma requisição de asset.
 *
 * Delega ao `apiClient`, que renova o token antes de devolvê-lo — e devolve `{}` sem sessão,
 * porque o caminho anônimo é normal aqui: a maioria dos modelos é pública.
 *
 * @returns {Promise<Object>} Cabeçalhos para espalhar num `fetch`.
 */
export async function cabecalhosDeAsset() {
    try {
        return await apiClient.authHeader();
    } catch {
        // Best-effort por desenho, como o resto deste eixo: sem credencial o pedido segue
        // anônimo e o servidor decide. Falhar aqui derrubaria o modelo PÚBLICO junto.
        return {};
    }
}

/**
 * O descritor de uma requisição de asset, no formato que um `Cesium.Resource` aceita.
 *
 * Devolve dado puro, sem tocar em `Cesium`: quem monta o `Resource` é o visualizador 3D, que
 * é lazy, e este módulo é do store. `retryCallback` é a peça que impede o defeito de tempo:
 * o token de acesso vive 15 min e um tileset grande streama por muito mais, então sem ele as
 * requisições de LOD começariam a levar 404 no meio da sessão, com os tiles simplesmente
 * parando de aparecer. Ele renova e reescreve o cabeçalho DO PRÓPRIO recurso, que é o objeto
 * que os filhos clonaram.
 *
 * @param {string} url
 * @returns {Promise<{url: string, queryParameters?: Object, headers?: Object, retryCallback?: Function, retryAttempts?: number}>}
 */
export async function descritorDeAsset(url) {
    const descritor = { url };
    if (OUTRA_ORIGEM_RE.test(String(url))) return descritor;

    const atlasId = escopoDeAsset();
    if (atlasId) descritor.queryParameters = { atlasId };

    const headers = await cabecalhosDeAsset();
    if (headers.Authorization) {
        descritor.headers = headers;
        descritor.retryAttempts = 1;
        descritor.retryCallback = async (recurso) => {
            const renovados = await cabecalhosDeAsset();
            if (!renovados.Authorization || !recurso) return false;
            // Uma tentativa só, e só quando a credencial MUDOU: repetir com o mesmo token
            // transformaria um 404 legítimo (o recurso não é deste usuário) em duas
            // requisições para a mesma resposta, vezes o número de tiles.
            if (recurso.headers?.Authorization === renovados.Authorization) return false;
            recurso.headers.Authorization = renovados.Authorization;
            return true;
        };
    }
    return descritor;
}
