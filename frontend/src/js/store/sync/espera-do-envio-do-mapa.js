// Path: js/store/sync/espera-do-envio-do-mapa.js

/**
 * @fileoverview Before the server copies a map, what this computer still owes it for that map has
 * to arrive, and a flush alone does not deliver all of it.
 *
 * "Duplicar" in a server atlas asks the SERVER to copy the map (`MapManager._duplicateOnServer`),
 * so the copy has what the server has. The door already flushed first, and that covered an edit
 * waiting for the next 1.5 s tick. It did NOT cover a picture placed a moment before: the feature
 * of an image is born PREPARED and the outbound dispatcher holds it until the bytes are confirmed
 * (`blob-upload-queue.js`), so the flush sends nothing for it, and the copy came out without the
 * picture, with no word (measured 2026-09-24,
 * `tests/e2e-ui/copia-sem-figura-recem-posta.repro.spec.js`).
 *
 * So the door WAITS, briefly, for the map's debt to reach zero, flushing as it goes (the held
 * operation is released the moment its bytes land, and the next flush carries it). When the time
 * runs out, or when all that is left is work the flush will never send (a refused operation), the
 * caller asks the person instead of copying in silence.
 *
 * The decision is a pure function ({@link decidirEsperaDaCopia}), tested in node; the reads and
 * the loop are around it.
 */

import { operationQueue } from './operation-queue.js';
import { idsComBlobPendente } from './blob-upload-queue.js';

/** How long the door waits for the map's debt before asking. Short: the person is looking at it. */
export const PRAZO_DA_ESPERA_DA_COPIA_MS = 8000;

/**
 * How the wait ended. PENDENTE and RECUSADO are different on purpose, because what the person can
 * do is different: pending work goes out by itself if they wait, refused work never does, and only
 * the Pendências panel lets them decide about it.
 */
export const DesfechoDaEspera = Object.freeze({
    ENVIADO: 'enviado',
    PENDENTE: 'pendente',
    RECUSADO: 'recusado',
    DESCONHECIDO: 'desconhecido',
});

/** What the loop does next: keep waiting, or end with a {@link DesfechoDaEspera}. */
export const ESPERAR = 'esperar';

/**
 * The split of the map's debt that the phrase needs: work that is still on its way (it goes out
 * if the person waits) and work the server refused (it never does).
 * @param {{operacoes: number, problemas: number, figuras: number}} divida
 * @returns {{enviaveis: boolean, recusadas: boolean}}
 */
export function partesDaDivida({ operacoes, problemas, figuras }) {
    return {
        enviaveis: Number(operacoes) - Number(problemas) > 0 || Number(figuras) > 0,
        recusadas: Number(problemas) > 0,
    };
}

/**
 * @param {Object} divida
 * @param {number} divida.operacoes - Queued operations of the map (any state).
 * @param {number} divida.problemas - Of those, how many the flush will never send (refused, or
 *   blocked behind a refusal).
 * @param {number} divida.figuras - Pictures of the map whose bytes are not confirmed.
 * @param {boolean} divida.esgotado - The deadline passed.
 * @returns {string} {@link ESPERAR}, or the {@link DesfechoDaEspera} that ends the wait.
 */
export function decidirEsperaDaCopia({ operacoes, problemas, figuras, esgotado }) {
    const numeros = [operacoes, problemas, figuras].map(Number);
    if (numeros.some(n => !Number.isFinite(n) || n < 0)) return DesfechoDaEspera.DESCONHECIDO;
    const [ops, probs, figs] = numeros;
    if (ops === 0 && figs === 0) return DesfechoDaEspera.ENVIADO;
    // Only refused work left: waiting cannot change it, so the door asks at once.
    if (figs === 0 && ops <= probs) return DesfechoDaEspera.RECUSADO;
    return esgotado ? DesfechoDaEspera.PENDENTE : ESPERAR;
}

/** Between two reads of the debt. Each read walks the queue, so not every frame. */
const PASSO_MS = 300;

/**
 * Every feature id of a map document, whatever its storage bucket.
 * @param {Object} mapData
 * @returns {Set<string>}
 */
function idsDasFeicoes(mapData) {
    const ids = new Set();
    for (const lista of Object.values(mapData?.features ?? {})) {
        if (!Array.isArray(lista)) continue;
        for (const f of lista) {
            const id = f?.properties?.id ?? f?.id;
            if (id !== undefined && id !== null) ids.add(String(id));
        }
    }
    return ids;
}

/**
 * What this computer still owes the server for one map of the mounted atlas.
 * @param {string} mapId
 * @param {Set<string>} featureIds
 * @returns {Promise<{operacoes: number, problemas: number, figuras: number}>}
 */
async function lerDivida(mapId, featureIds) {
    const [ops, pendentes] = await Promise.all([operationQueue.getByMapId(mapId), idsComBlobPendente()]);
    let problemas = 0;
    if (ops.length > 0) {
        // The queue's own rule for what the flush will never send. A gesture split between a
        // refused member and held ones is under-counted there today; the fix belongs to
        // `getProblems` (following the whole batch), not to a second rule here.
        const recusadas = new Set((await operationQueue.getProblems()).map(p => p.operation?.id));
        problemas = ops.filter(op => recusadas.has(op.id)).length;
    }
    const figuras = [...pendentes].filter(id => featureIds.has(String(id))).length;
    return { operacoes: ops.length, problemas, figuras };
}

/**
 * Waits for the map's debt to reach zero, flushing between reads.
 * @param {Object} params
 * @param {string} params.mapId - The map's UUID (operations carry it).
 * @param {Object} params.mapData - The map document (its features name the pictures).
 * @param {() => Promise<unknown>} params.flush - Sends what can be sent now.
 * @param {() => void} [params.aoEsperar] - Called ONCE, when there is something to wait for, so the
 *   person is told why the copy is not immediate.
 * @param {number} [params.prazoMs]
 * @returns {Promise<{desfecho: string, enviaveis: boolean, recusadas: boolean}>} The
 *   {@link DesfechoDaEspera}, and which kinds of debt were left at the end (for the phrase).
 */
export async function esperarEnvioDoMapa({ mapId, mapData, flush, aoEsperar = null, prazoMs = PRAZO_DA_ESPERA_DA_COPIA_MS }) {
    const featureIds = idsDasFeicoes(mapData);
    const limite = Date.now() + prazoMs;
    let avisado = false;
    for (;;) {
        let divida;
        try {
            divida = await lerDivida(mapId, featureIds);
        } catch (error) {
            console.warn('[map-copy] could not read what this map still owes the server:', error);
            return { desfecho: DesfechoDaEspera.DESCONHECIDO, enviaveis: false, recusadas: false };
        }
        const passo = decidirEsperaDaCopia({ ...divida, esgotado: Date.now() >= limite });
        if (passo !== ESPERAR) return { desfecho: passo, ...partesDaDivida(divida) };
        if (!avisado && aoEsperar) { avisado = true; aoEsperar(); }
        await flush().catch(() => {});
        await new Promise(resolve => setTimeout(resolve, PASSO_MS));
    }
}
