// Path: js/store/sync/assets3d-request.js

/**
 * @fileoverview How a 3D ASSET request identifies itself to the server.
 *
 * Since F11 the bytes under `/api/v1/assets3d` follow the RESOURCE and not the route: a public
 * model is still served to anyone, a PRIVATE model goes through a gate and answers 404 to
 * whoever cannot reach it. The server decides from two inputs, and both have to travel in the
 * request Cesium (or a `fetch`) makes:
 *
 *   - `?atlasId=` — WHICH loan the caller wants to use. It is not a password: the server runs
 *     `requireAtlasPermission('read')` over it. It is the only one of the two that works for
 *     the ANONYMOUS visitor of a public-link atlas, and the only one that survives an `<img>`
 *     or a `<video>`, neither of which can carry a header.
 *   - `Authorization: Bearer` — WHO is asking, for the access that comes from a global role or
 *     a personal grant, with no atlas in focus at all.
 *
 * WHY THE HEADER SURVIVES CESIUM, which is what decides whether any of this works:
 * `Resource.clone()` copies `headers`, `queryParameters` and `retryCallback`, and
 * `getDerivedResource()` merges them into the child. So stamping the `tileset.json` reaches
 * every child tileset, every `.b3dm` and every external buffer derived from it. Verified in the
 * vendored bundle (`public/vendors/cesium/Cesium.js`, 1.138.0) before the design relied on it.
 *
 * WHAT THIS MODULE DOES NOT SOLVE, and it is better written here than discovered as a bug: an
 * address the BROWSER fetches on its own (`<img src>`, `<video src>`, a third-party loader that
 * accepts no headers) carries no `Authorization`. For those, access to a private resource
 * depends on the loan arm, that is, on there being an atlas in focus that lends it. Closing the
 * rest would require a session cookie, which is the authentication axis and not this one.
 */

import { apiClient } from './api-client.js';
import { currentResourceAtlasId } from './resource-scope.js';

/** A CROSS-ORIGIN address: stamping a credential on it would hand it to a third party. */
const OUTRA_ORIGEM_RE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/**
 * The atlas scope that should accompany an asset request, or null.
 * @returns {string|null}
 */
export function escopoDeAsset() {
    return currentResourceAtlasId();
}

/**
 * The same URL, with `atlasId` in the query when there is an atlas in focus.
 *
 * For an address the browser fetches on its own, this is the only stamp available. A
 * cross-origin address comes out UNTOUCHED: the loan is a claim about THIS server, and
 * attaching it to a third-party host would only tell that host which atlas the user is in.
 *
 * @param {string} url
 * @returns {string} The stamped URL, or the original when there is nothing to stamp.
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
 * Is this address served by the SAME origin that issued the token?
 *
 * A relative address is same-origin by construction. An absolute one is compared by
 * `URL.origin` (scheme, host and port), never by prefix, for the reason
 * `map/credencial-de-tile.js` states in as many words: `https://meu.host.mil.br.evil.example`
 * starts with the right string and is not the right host.
 *
 * WITH NO `location` TO COMPARE AGAINST (node, a worker without one) an absolute address is
 * refused. Failing that way costs a private asset that does not load, which is VISIBLE;
 * failing the other way hands the session token to whoever the address names, which is silent.
 *
 * @param {*} url
 * @returns {boolean}
 */
function ehMesmaOrigemDoServidor(url) {
    if (typeof url !== 'string' || url === '') return false;
    if (!OUTRA_ORIGEM_RE.test(url)) return true;
    const origem = globalThis.location?.origin;
    if (!origem || origem === 'null') return false;
    try {
        return new URL(url, origem).origin === origem;
    } catch {
        return false;
    }
}

/**
 * The credential headers of an asset request TO THIS SERVER.
 *
 * Delegates to `apiClient`, which refreshes the token before handing it back — and returns
 * `{}` with no session, because the anonymous path is normal here: most models are public.
 *
 * THE URL IS REQUIRED, AND THAT IS THE GUARD. `config.url` and `config.basePath` of a catalog
 * row are free text typed by an administrator or a producer, `joinScenePath`
 * (`first_person_3d_tool/scene-config.service.js`) honours an absolute value as written, and
 * the 422 that would refuse a third-party address on WRITE does not exist yet (clause 10.1 of
 * `CONSTITUICAO.md`). So a scene whose `basePath` names another host made every `fetch` of it
 * carry `Authorization: Bearer` to that host — the exact hazard `escoparUrlDeAsset` and
 * `descritorDeAsset` already refuse, on the one path that had no guard. A producer of one OM
 * could harvest the token of an administrator who merely opened the scene.
 *
 * Omitting the argument returns `{}` for the same reason it refuses a third-party address: a
 * caller that does not say where the request is going cannot be answered safely, and the
 * failure direction has to be the visible one.
 *
 * @param {string} url - The address the headers will be attached to.
 * @returns {Promise<Object>} Headers to spread into a `fetch`.
 */
export async function cabecalhosDeAsset(url) {
    if (!ehMesmaOrigemDoServidor(url)) return {};
    try {
        return await apiClient.authHeader();
    } catch {
        // Best-effort by design, like the rest of this axis: with no credential the request
        // goes out anonymous and the server decides. Failing here would take the PUBLIC model
        // down with it.
        return {};
    }
}

/**
 * The descriptor of an asset request, in the shape a `Cesium.Resource` accepts.
 *
 * Returns plain data and never touches `Cesium`: the one that builds the `Resource` is the 3D
 * viewer, which is lazy, and this module belongs to the store. `retryCallback` is the piece
 * that prevents the timing defect: the access token lives 15 min and a large tileset streams
 * for much longer, so without it the LOD requests would start taking 404s mid-session, with
 * tiles simply ceasing to appear. It refreshes and rewrites the header ON THE RESOURCE ITSELF,
 * which is the object the children cloned.
 *
 * @param {string} url
 * @returns {Promise<{url: string, queryParameters?: Object, headers?: Object, retryCallback?: Function, retryAttempts?: number}>}
 */
export async function descritorDeAsset(url) {
    const descritor = { url };
    if (OUTRA_ORIGEM_RE.test(String(url))) return descritor;

    const atlasId = escopoDeAsset();
    if (atlasId) descritor.queryParameters = { atlasId };

    const headers = await cabecalhosDeAsset(url);
    if (headers.Authorization) {
        descritor.headers = headers;
        descritor.retryAttempts = 1;
        descritor.retryCallback = async (recurso) => {
            const renovados = await cabecalhosDeAsset(url);
            if (!renovados.Authorization || !recurso) return false;
            // One attempt only, and only when the credential CHANGED: retrying with the same
            // token would turn a legitimate 404 (the resource is not this user's) into two
            // requests for the same answer, times the number of tiles.
            if (recurso.headers?.Authorization === renovados.Authorization) return false;
            recurso.headers.Authorization = renovados.Authorization;
            return true;
        };
    }
    return descritor;
}
