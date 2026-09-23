// Path: js/session/uso-transporte.js
import { generateUUID } from '@utils/uuid.js';
import { apiClient } from '@store/sync/api-client.js';
import { resolveBackendBaseUrl } from '@store/sync/runtime-config.js';
import { descartarCorpo } from '@js/session/uso-lote.js';

/**
 * @fileoverview The usage-batch transport: one `localStorage` key per batch, resent until the
 * server acknowledges it, deduplicated there by `loteId`. See `docs/wiki/observabilidade.md`,
 * "O lado do CLIENTE".
 *
 * A BATCH OF ANOTHER ACCOUNT IS SKIPPED, NEVER ERASED (since 2026-09-23). The four pages install
 * the telemetry BEFORE restoring the session, so every page load of a signed-in person starts with
 * identity `null` and only then becomes the account. Until this date the first batch of that load
 * erased every stored batch of the account (and counted each one as a failure), which is exactly
 * the batch the previous page wrote on `pagehide`: a signed-in person lost it whenever it did not
 * arrive on the first try, and every signed-in navigation reported two collection failures to the
 * presence pulse. A batch of another account now waits for its owner; what bounds it is the 24 h
 * validity and the 30-batch ceiling, which counts every stored batch, the waiting ones included.
 * "A batch of one account is never sent by another" still holds: the identity is re-read right
 * before the request and on the server (409).
 *
 * THE WAY OUT DOES NOT RENEW. A flush on `pagehide` or on hiding may be the last thing the page
 * does, and `apiClient.authHeader()` rotates the refresh token when the access token is in its last
 * 30 s: the page is gone before the rotation answers, and the fetch waiting on it never leaves
 * (measured, 3 of 3). Those flushes use the token already in memory, synchronously, like the
 * presence exit.
 *
 * AN ACCOUNT'S BATCH NEVER LEAVES WITHOUT A CREDENTIAL, AND A CREDENTIAL REFUSAL NEVER ERASES IT.
 * Two windows send it with a credential the server cannot accept: the involuntary logout, which
 * clears the tokens several awaits before it clears the identity (a 30 s resend landing there got
 * `{}` from `authHeader()`), and a renewal that failed transiently and left an expired token. The
 * server reads both as anonymous and answers 409, and the batch used to be erased and counted. Now
 * a batch of an account with no `Authorization` to carry is skipped, like a batch of another
 * account, and a 401 or 409 on an account's batch keeps it for the next resend: for such a batch
 * the session row is keyed by the segment's own random id, so the only 409 left is the principal
 * one. An ANONYMOUS batch has no credential to fix, so there 401 and 409 stay final.
 */

const PREFIXO = 'ebgeo:telemetria:lote:';
const VALIDADE_MS = 86400000;
/** How many stored batches survive, counting every account's. */
export const TETO_DA_FILA = 30;
/** Flush reasons that can be the page's last act (see `uso-lote.js`). */
const MOTIVOS_DE_SAIDA = new Set(['saida', 'oculta']);
/** Refusals that no resend can fix, for any batch. */
const RECUSA_DEFINITIVA = new Set([400, 403, 422]);
/** Credential refusals: final for an anonymous batch, a stale token for an account's one. */
const RECUSA_DE_CREDENCIAL = new Set([401, 409]);

/** The `Authorization` header from the token in memory, without renewing it. */
function cabecalhoEmMemoria() {
    try {
        const token = apiClient.getAccessToken?.();
        return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
        return {};
    }
}

// Each batch owns a key, so two tabs cannot overwrite each other's queue.
export function criarTransporteDeUso({ alvo = globalThis, identidade = () => null } = {}) {
    const emVoo = new Set();
    let falhas = 0;
    const storage = () => { try { return alvo.localStorage; } catch { return null; } };
    const apagar = key => { try { storage()?.removeItem(key); } catch { /* best effort */ } };
    /** Well formed, for this server, and inside its validity. */
    const bemFormado = item => Boolean(item && typeof item === 'object' && item.corpo
        && Number.isFinite(item.expira) && item.url === `${resolveBackendBaseUrl()}/uso/eventos`
        && item.expira >= Date.now());
    /** Whether the current identity may send it: an anonymous batch, or one of this account. */
    const daVez = item => item.identidade === null || item.identidade === identidade();

    const enviarItem = async (item, key, { naSaida = false } = {}) => {
        if (emVoo.has(key)) return;
        if (!bemFormado(item)) { apagar(key); falhas++; return; }
        if (!daVez(item)) return;
        emVoo.add(key);
        try {
            // NO `await` ON THE WAY OUT: the fetch has to leave inside the `pagehide` handler.
            const auth = naSaida ? cabecalhoEmMemoria() : await apiClient.authHeader();
            if (!daVez(item)) return;
            // An account's batch sent without a credential is a 409 the server is bound to answer.
            if (item.identidade !== null && !auth?.Authorization) return;
            const response = await alvo.fetch(item.url, {
                method: 'POST', credentials: 'same-origin', keepalive: true,
                headers: { 'Content-Type': 'application/json', ...auth },
                body: JSON.stringify(item.corpo),
                signal: AbortSignal.timeout(10000),
            });
            descartarCorpo(response);
            if (response.ok) {apagar(key);} else {
                falhas++;
                const definitiva = RECUSA_DEFINITIVA.has(response.status)
                    || (item.identidade === null && RECUSA_DE_CREDENCIAL.has(response.status));
                if (definitiva) apagar(key);
            }
        } catch { falhas++; } finally { emVoo.delete(key); }
    };

    /**
     * Reads the stored queue: erases what is corrupt, expired or beyond the ceiling (and counts
     * it), and returns, newest first, what the current identity may send.
     */
    const coletar = () => {
        const guardados = [];
        try {
            const s = storage();
            // Snapshot keys before deleting: localStorage indexes shift on removal.
            const keys = Array.from({ length: s?.length ?? 0 }, (_, i) => s.key(i));
            for (const key of keys) {
                if (!key?.startsWith(PREFIXO)) continue;
                try {
                    const item = JSON.parse(s.getItem(key));
                    if (bemFormado(item)) {guardados.push([item, key]);} else { apagar(key); falhas++; }
                } catch { apagar(key); falhas++; }
            }
        } catch { falhas++; }
        guardados.reverse().sort((a, b) => b[0].expira - a[0].expira);
        for (const [, key] of guardados.slice(TETO_DA_FILA)) { apagar(key); falhas++; }
        return guardados.slice(0, TETO_DA_FILA).filter(([item]) => daVez(item));
    };
    const retomar = () => { for (const [item, key] of coletar()) enviarItem(item, key); };

    /**
     * Erases every stored batch of `conta`, in flight included (a request already sent still
     * lands; it is just never resent). For the explicit logout only, and not a failure.
     * @param {string|null} conta
     * @returns {number} How many were erased.
     */
    const esquecerDaConta = (conta) => {
        if (typeof conta !== 'string' || conta === '') return 0;
        let apagados = 0;
        try {
            const s = storage();
            const keys = Array.from({ length: s?.length ?? 0 }, (_, i) => s.key(i));
            for (const key of keys) {
                if (!key?.startsWith(PREFIXO)) continue;
                let item = null;
                try { item = JSON.parse(s.getItem(key)); } catch { continue; }
                if (item?.identidade === conta) { apagar(key); apagados++; }
            }
        } catch { /* Storage unavailable: there is nothing stored to erase. */ }
        return apagados;
    };

    return {
        retomar,
        esquecerDaConta,
        falhas: () => falhas,
        enviar(corpo, url, { motivo } = {}) {
            const loteId = generateUUID();
            const item = { corpo: { ...corpo, loteId, identidade: identidade() }, url,
                identidade: identidade(), expira: Date.now() + VALIDADE_MS };
            const key = PREFIXO + loteId;
            try { storage()?.setItem(key, JSON.stringify(item)); } catch { falhas++; }
            coletar();
            enviarItem(item, key, { naSaida: MOTIVOS_DE_SAIDA.has(motivo) });
            return true;
        },
    };
}
