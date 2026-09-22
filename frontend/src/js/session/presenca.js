// Path: js/session/presenca.js

/**
 * @fileoverview The administrative presence pulse: one row per browser on the server, counted by
 * the administration panel ("Agora no EBGeo"). See `docs/wiki/presenca-administrativa.md`.
 *
 * WHAT CHANGED ON 2026-09-22 (owner: "ainda diz que tem usuário presente mesmo que depois de
 * sair"). Until then the only way a row stopped counting was the 90 s window running out, so a
 * person who closed the tab stayed "logged in" on the panel for a minute and a half, plus the 15 s
 * of the panel's own cycle. Three changes, and the window stays as the safety net for what does
 * not announce itself (a crashed tab, a suspended laptop, a dropped network):
 *
 *   1. EXPLICIT EXIT on `pagehide`: a last pulse with `saindo: true`, sent with `keepalive` so it
 *      survives the unload. The server deletes the row only if THIS DOCUMENT was the last one to
 *      pulse (`abaId`, new on every page load), which is what keeps two normal situations from
 *      erasing a browser that is still open: the navigation from the map to `atlas.html` (the new
 *      page may pulse before the old page's exit lands) and closing one of two tabs of the same
 *      browser (both pulse under the same `navegadorId`).
 *   2. THE SIBLING TABS ARE TOLD, over a BroadcastChannel, and pulse at once, so a surviving tab
 *      re-creates the row a moment after the exit instead of waiting for its next beat.
 *   3. A HIDDEN TAB KEEPS PULSING. It used to skip the beat, which made a tab left in the
 *      background disappear from the panel after 90 s while the product was open in it. The
 *      browser throttles the timer of a hidden page (measured in Chrome: one run per minute after
 *      about five minutes, see `heartbeatSweep` in `backend/src/modules/collab/collab.gateway.js`),
 *      which still fits the 90 s window. What stays out, now with a written reason, is a pulse on
 *      the way INTO hiding: closing a tab fires `visibilitychange` right before `pagehide`, and
 *      that pulse would land after the exit and bring the row back for the whole window.
 */

import { generateUUID, isValidUUID } from '@utils/uuid.js';
import { resolveBackendBaseUrl } from '@store/sync/runtime-config.js';
import { apiClient } from '@store/sync/api-client.js';

/** The channel the tabs of one browser use to tell each other that one of them is leaving. */
const CANAL_DE_PRESENCA = 'ebgeo:presenca';

let lerPendencias = null;
export function configurarPendenciasDePresenca(ler) { lerPendencias = ler; }

export function instalarPresenca({ alvo = globalThis, falhas = () => 0 } = {}) {
    let id = generateUUID();
    try {
        const chave = 'ebgeo:telemetria:navegador';
        const salvo = alvo.localStorage?.getItem(chave);
        if (isValidUUID(salvo)) id = salvo;
        else alvo.localStorage?.setItem(chave, id);
    } catch { /* Storage unavailable: presence is per page. */ }
    // THIS DOCUMENT, not this tab: a navigation inside the tab is a new page with a new id, and
    // that difference is what makes the exit of the old page harmless to the new one.
    const abaId = generateUUID();
    let ocupado = false;
    let vivo = true;
    // Set on `pagehide` and cleared on `pageshow`: a page on its way out (or frozen in the
    // back-forward cache) must not send a pulse that lands after its own exit.
    let saiu = false;
    let prazo = null;
    let falhasLocais = 0;
    let repetir = false;
    let controller = null;
    const url = () => `${resolveBackendBaseUrl()}/uso/presenca`;
    const pulsar = async () => {
        if (!vivo || saiu) return;
        if (ocupado) { repetir = true; return; }
        ocupado = true;
        try {
            const pendencias = lerPendencias ? await Promise.race([
                Promise.resolve().then(() => lerPendencias()).catch(() => { falhasLocais++; return {}; }),
                new Promise(resolve => { prazo = alvo.setTimeout(() => resolve({}), 3000); }),
            ]) : {};
            alvo.clearTimeout?.(prazo);
            prazo = null;
            const auth = await apiClient.authHeader();
            if (!vivo || saiu) return;
            controller = new AbortController();
            prazo = alvo.setTimeout(() => controller?.abort(), 10000);
            await alvo.fetch(url(), {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', ...auth },
                body: JSON.stringify({ navegadorId: id, abaId, ...pendencias, falhasColeta: falhas() + falhasLocais }),
                signal: controller.signal,
            });
        } catch { /* A missing pulse expires on the server. */ } finally {
            alvo.clearTimeout?.(prazo); prazo = null; ocupado = false;
            controller = null;
            if (repetir && vivo) { repetir = false; pulsar(); }
        }
    };

    let canal = null;
    try {
        if (typeof alvo.BroadcastChannel === 'function') {
            canal = new alvo.BroadcastChannel(CANAL_DE_PRESENCA);
            canal.onmessage = (evento) => {
                const dado = evento?.data;
                if (dado?.tipo === 'saida' && dado.abaId !== abaId) pulsar();
            };
        }
    } catch { canal = null; }

    const aoMudarVisibilidade = () => {
        if (alvo.document?.visibilityState !== 'hidden') pulsar();
    };
    const aoSair = () => {
        if (!vivo || saiu) return;
        saiu = true;
        repetir = false;
        controller?.abort();
        try { canal?.postMessage({ tipo: 'saida', abaId }); } catch { /* channel closed */ }
        try {
            // No credential: the exit identifies the row by (browser, document), and an async
            // token read would not finish inside `pagehide`.
            const envio = alvo.fetch?.(url(), {
                method: 'POST', credentials: 'same-origin', keepalive: true,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ navegadorId: id, abaId, saindo: true }),
            });
            envio?.catch?.(() => {});
        } catch { /* The window expires the row. */ }
    };
    const aoVoltar = (evento) => {
        // Restored from the back-forward cache: the exit already went out, so this page is a
        // browser that came back.
        if (!evento?.persisted || !vivo) return;
        saiu = false;
        pulsar();
    };

    const timer = alvo.setInterval?.(pulsar, 30000);
    alvo.document?.addEventListener('visibilitychange', aoMudarVisibilidade);
    alvo.addEventListener?.('pagehide', aoSair);
    alvo.addEventListener?.('pageshow', aoVoltar);
    pulsar();
    return { pulsar, sair: aoSair, desinstalar() {
        vivo = false;
        controller?.abort();
        alvo.clearTimeout?.(prazo);
        alvo.clearInterval?.(timer);
        alvo.document?.removeEventListener('visibilitychange', aoMudarVisibilidade);
        alvo.removeEventListener?.('pagehide', aoSair);
        alvo.removeEventListener?.('pageshow', aoVoltar);
        try { canal?.close(); } catch { /* already closed */ }
        canal = null;
    } };
}
