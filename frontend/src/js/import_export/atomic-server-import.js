// Path: js/import_export/atomic-server-import.js
import { getGlobalStore } from '@store/atlas-namespace.js';
import { generateUUID } from '@utils/uuid.js';

/** Persist only the attempt identity locally. Server-side preparation owns its contents. */
const pending = new Map();
function account(client) {
    try { return JSON.parse(atob(client.getAccessToken().split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub; } catch { return null; }
}
function stableSource(value, opaque = false) {
    if (Array.isArray(value)) return value.map(child => stableSource(child, opaque));
    if (!value || typeof value !== 'object') return value;
    // Generated sync stamps and synthesized default-layer dates are not content.
    return Object.fromEntries(Object.keys(value).sort().filter(key => opaque || (key !== 'sync'
        && !(value.id === 'default' && ['createdAt', 'updatedAt'].includes(key))))
        .map(key => [key, stableSource(value[key], opaque || key === 'attributes')]));
}

/**
 * @param {Object} client - The ApiClient
 * @param {Object} payload - Server import payload
 * @param {Array<Object>} images - Upload items (`localId`, `mimeType`, `data`, `filename`)
 * @param {Object} source - What identifies the content across retries
 * @param {string[]} [missingImageIds] - Originals the payload cites and the client DECLARES it does
 *   not have, after the person confirmed (`missingImagesUploadConfirm`). The server refuses a
 *   manifest that leaves a cited original out of both lists, so an undeclared hole still cannot
 *   be published. Not part of the source key: it is a function of the content and of the blobs.
 */
export async function atomicServerImport(client, payload, images, source, missingImageIds = []) {
    const owner = account(client);
    if (!owner) throw new Error('Entre na sua conta antes de importar.');
    const bytes = new TextEncoder().encode(JSON.stringify({ source: stableSource(source), images: images.map(({ mimeType, data }) => ({ mimeType, data })) }));
    const sourceKey = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const key = `__server_import_attempt__:${client.baseUrl}:${owner}:${sourceKey}`;
    if (pending.has(key)) return pending.get(key);
    const work = async lock => {
        if (lock === null) throw new Error('Esta importação já está em andamento em outra aba. Aguarde sua conclusão.');
        return run(client, payload, images, sourceKey, key, owner, missingImageIds);
    };
    const promise = (globalThis.navigator?.locks
        ? navigator.locks.request(`ebgeo-import:${key}`, { ifAvailable: true }, work)
        : work()).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
}

async function run(client, payload, images, sourceKey, key, owner, missingImageIds) {
    const store = getGlobalStore();
    const baseUrl = client.baseUrl;
    const assertContext = () => {
        if (account(client) !== owner || client.baseUrl !== baseUrl) throw new Error('A conta ou o servidor mudou durante a importação. Volte à conta e ao servidor originais para retomá-la.');
    };
    const request = (method, path, body) => {
        assertContext();
        return client._request(method, path, { body, timeoutMs: 120000, assertContext });
    };
    let id = await store.getItem(key);
    let attempt;
    if (id) {
        try { attempt = await request('GET', `/atlas/imports/${id}`); } catch (error) {
            if (![404, 409].includes(error.status)) throw error;
            id = null;
        }
    }
    if (!id) {
        id = generateUUID();
        await store.setItem(key, id); // Before network: failure must not create an untraceable attempt.
    }
    const finish = async result => {
        await store.removeItem(key).catch(() => {});
        return result;
    };
    try {
        if (!attempt) {
            const begin = { id, sourceKey, payload, imageIds: images.map(image => image.localId) };
            // Sent only when there is something to declare, so the ordinary request is unchanged.
            if (missingImageIds.length) begin.missingImageIds = missingImageIds;
            attempt = await request('POST', '/atlas/imports', begin);
        }
        if (attempt.result) return finish(attempt.result);
        if (attempt.imageIds.length !== images.length) throw new Error('A preparação não corresponde às imagens deste arquivo.');
        // One image per request keeps the existing per-request upload ceiling useful.
        // The server verifies bytes and accepts an identical retransmission.
        for (let index = 0; index < images.length; index++) {
            await request('POST', `/atlas/imports/${id}/images`, { images: [{ ...images[index], localId: attempt.imageIds[index] }] });
        }
        return await finish(await request('POST', `/atlas/imports/${id}/commit`, {}));
    } catch (cause) {
        // The failure may be only the lost response AFTER commit. Read the receipt before
        // reporting a failure, and retain the same key for an explicit retry after reload.
        try {
            const recovered = await request('GET', `/atlas/imports/${id}`);
            if (recovered.result) return await finish(recovered.result);
        } catch { /* Offline: the next attempt can read the same receipt. */ }
        const reason = Number.isFinite(cause?.status) ? ` Motivo: ${cause.message}` : '';
        const error = new Error(`Não foi possível concluir ou confirmar a importação. O original foi preservado. Tente novamente com o mesmo conteúdo para retomar com segurança.${reason}`, { cause });
        error.stage = 'preparation';
        error.status = cause?.status;
        error.importAttemptId = id;
        throw error;
    }
}
