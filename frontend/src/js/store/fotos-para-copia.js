// Path: js/store/fotos-para-copia.js

/**
 * @fileoverview Bringing the photos of a server atlas to THIS computer before a copy that leaves the
 * server: "Salvar como local" (a copy database by database) and the rescue of unsent work (the
 * namespace adopted as a local atlas, zero bytes moved).
 *
 * WHY (2026-09-24, second review of the attached photos). A photo held by reference lives, in this
 * browser, only if someone here opened it or attached it: a colleague's photo (phase 2b) and an old
 * inline photo that another client converted (phase 2c) are fetched from the server on demand
 * (`getImage` falls back to it), and a LOCAL atlas has no server to fall back to. Both copies carried
 * the image store as it was, so those photos were left with their thumbnail forever, while the dialog
 * promised that the drawn content "vai inteiro". Now the missing ones are downloaded first, and the
 * ones that do not come (offline, refused, deleted on the server) are listed, so the person reads the
 * loss before it is permanent.
 *
 * It reads the scope's databases by address (`getStoreFor`), mounts nothing and moves no pointer, so
 * it runs the same on the map and on the pages without one (the rescue runs on both).
 */

import { StoreName, getStoreFor } from '@store/atlas-namespace.js';
import { apiClient } from './sync/api-client.js';
import { captureRemoteWriteFence } from './remote-write-fence.js';
import { fenceStore } from './fenced-store.js';
import { fotosPorReferencia } from '@js/user_data/photo-refs.js';

/** How long the whole download may take before the rest is declared missing, in ms. */
export const PRAZO_PADRAO_MS = 20000;

/**
 * The atlas document of a scope, in the shape `fotosPorReferencia` walks: maps by key, and the 3D and
 * 360 documents by key.
 * @param {Object} scope
 * @returns {Promise<{maps: Object, cesium3d: Object, streetview360: Object}>}
 */
async function documentoDoEscopo(scope) {
    const ler = async (storeName) => {
        const saida = {};
        await getStoreFor(storeName, scope).iterate((valor, chave) => {
            if (valor && typeof valor === 'object') saida[chave] = valor;
        });
        return saida;
    };
    return {
        maps: await ler(StoreName.MAPS),
        cesium3d: await ler(StoreName.CESIUM3D),
        streetview360: await ler(StoreName.STREETVIEW360),
    };
}

/**
 * Downloads the photos the atlas cites by reference and this computer does not have yet.
 *
 * NEVER THROWS: every failure is a photo in `faltaram`, which is the whole point. The download stops
 * at `prazoMs` and the rest is declared missing, because the person is waiting on a dialog or on the
 * way out of the account.
 *
 * @param {Object} scope - The scope whose image store receives the bytes (the server atlas's own)
 * @param {string|null} atlasId - The server atlas to download from; null lists without downloading
 * @param {Object} [opcoes]
 * @param {number} [opcoes.prazoMs] - Budget for the whole download
 * @param {Object} [opcoes.cliente] - The HTTP client (for tests)
 * @param {(quantas: number) => void} [opcoes.aoBaixar] - Called once, before the first request, with how
 *   many photos will be asked: the caller that has a person waiting says what the wait is for
 * @returns {Promise<{total: number, baixadas: number, faltaram: Array<{id: string, nome: (string|null)}>}>}
 */
export async function baixarFotosQueFaltam(scope, atlasId, { prazoMs = PRAZO_PADRAO_MS, cliente = apiClient, aoBaixar = null } = {}) {
    let fotos = [];
    let imagens;
    try {
        fotos = fotosPorReferencia(await documentoDoEscopo(scope));
        // Fenced like every write into a server atlas's databases: a discard of this namespace
        // (a confirmed logout) refuses the write instead of resurrecting server data after it.
        imagens = fenceStore(getStoreFor(StoreName.IMAGES, scope), captureRemoteWriteFence(scope));
    } catch (error) {
        console.warn('[fotos-para-copia] could not read the atlas to list its photos:', error);
        return { total: 0, baixadas: 0, faltaram: [] };
    }
    const faltantes = [];
    for (const foto of fotos) {
        let tem = false;
        try {
            tem = !!(await imagens.getItem(foto.id));
        } catch {
            tem = false;
        }
        if (!tem) faltantes.push(foto);
    }
    const resultado = { total: fotos.length, baixadas: 0, faltaram: [] };
    if (faltantes.length === 0) return resultado;
    if (typeof atlasId !== 'string' || !atlasId) {
        resultado.faltaram = faltantes;
        return resultado;
    }

    try {
        aoBaixar?.(faltantes.length);
    } catch {
        // A notice that fails does not stop the download.
    }
    const limite = Date.now() + Math.max(0, prazoMs);
    for (const foto of faltantes) {
        const resta = limite - Date.now();
        if (resta <= 0) {
            resultado.faltaram.push(foto);
            continue;
        }
        let timer;
        try {
            const blob = await Promise.race([
                cliente.fetchImageBlob(atlasId, foto.id),
                new Promise((_, rejeitar) => { timer = setTimeout(() => rejeitar(new Error('prazo')), resta); }),
            ]);
            if (!blob) throw new Error('sem bytes');
            await imagens.setItem(foto.id, blob);
            resultado.baixadas += 1;
        } catch {
            resultado.faltaram.push(foto);
        } finally {
            clearTimeout(timer);
        }
    }
    return resultado;
}
