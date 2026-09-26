// Path: js/store/sync/sem-tempo-real.js

/**
 * @fileoverview The decisions of the mode WITHOUT REAL TIME ("sem tempo real"): the server answers
 * over HTTP and the collaboration WebSocket does not open. Pure functions and constants, zero
 * imports, so every rule is testable in node without a socket, a store or a clock.
 *
 * WHY THE MODE EXISTS (owner's decision of 2026-09-25, to ship it). A corporate or military proxy
 * that does not forward the `Upgrade` header refuses the socket and lets every plain HTTP request
 * through; production has three proxies on the way (`TRUST_PROXY_HOPS` 3). Until this date a server
 * atlas did not open at all in that network: the opening waited for the socket's `connected` frame
 * (`syncEngine.connect`), and the flush only ran with the socket ONLINE (`hasWorkToFlush`,
 * `sync-flush.js`), although every byte it sends already goes over HTTP. Measured on 2026-09-23 by
 * the repro spec this mode replaced (`abertura-sem-tempo-real.repro.spec.js`, deleted with it): the
 * tab went back to the chooser on every attempt.
 *
 * WHAT CHANGES IN THE MODE, and what does not:
 *   - the OUTBOUND path is the same `engine.flush()` over HTTP push, with the same queue, the same
 *     logical batches and the same durable problems: no second way out exists, so the mode cannot
 *     send a refused operation or one out of order that the normal mode would not;
 *   - the INBOUND path is a periodic pull by cursor (`pullSync(lastVersion)`), applied exactly like
 *     the socket's `sync_response`, with backoff ({@link proximoIntervaloDoPoll}). The structural
 *     markers of the REST exceptions (merge, map duplication, clone, import) are in the log, so
 *     they arrive by the pull and resync as they do by the socket;
 *   - the per-atlas ROLE comes from `user_permission` of `GET /atlas/:atlasId` instead of the
 *     `connected` frame, and the server keeps imposing it on every push;
 *   - presence (who is online, cursors, selections, who edits a briefing) does not exist, and the
 *     roster clears;
 *   - the socket keeps being retried in the background, and the first `connected` frame brings the
 *     normal mode back by itself, without a reload; its `sync_request` departs from the version
 *     the pull reached.
 *
 * WHAT DOES NOT ARRIVE WITHOUT THE SOCKET, declared: the notices that exist only as live frames
 * (`atlas_settings_updated`, `sharing_updated`, `atlas_owner_changed`, `atlas_resources_updated`,
 * `atlas_updated`) and the author of an overwritten edit (the pull carries no `userId`). The
 * `map_duplicated` frame does not arrive either, and nothing is lost with it: the duplication
 * writes its own structural marker, and the pull resyncs on it. The role is re-read over HTTP every
 * {@link POLLS_POR_RELEITURA_DO_PAPEL} polls, which covers the two of those notices that change
 * what the person may do; the others wait for the next opening of the atlas.
 *
 * THE NUMBERS BELOW ARE ENGINEERING CHOICES, each with its reason next to it, and none was measured
 * against a real proxy: they are the owner's to confirm.
 */

/**
 * How long the opening waits for the socket's `connected` frame before going on without it, in ms.
 * A refused upgrade closes the socket at once; this bound is for a proxy that holds the upgrade
 * without answering. A `connected` that arrives later still brings the normal mode back, so a slow
 * but working socket costs a few seconds of the mode, never the atlas. Ten seconds is an order of
 * magnitude above a handshake on the 40 kbps link the product targets.
 */
export const PRAZO_DO_TEMPO_REAL_MS = 10000;

/**
 * Interval of the pull after a poll that brought something, or after entering the mode, in ms.
 * Twice the flush interval (1.5 s, `sync-flush.js`): a colleague's edit shows within a few seconds
 * while people are working, which is what the notice promises ("em alguns segundos").
 */
export const POLL_BASE_MS = 3000;

/**
 * Longest interval between two polls that keep coming back empty, in ms: an idle atlas costs one
 * small GET every ten seconds per tab, and only the tabs behind a proxy that refuses the socket.
 */
export const POLL_OCIOSO_MAX_MS = 10000;

/** Longest interval between two polls that keep failing, in ms: the socket's own reconnect ceiling. */
export const POLL_FALHA_MAX_MS = 30000;

/**
 * Consecutive failed polls after which the state stops saying "the server answers": from there
 * the badge says it is reconnecting, and the poll keeps going as the probe that brings it back.
 * One failure is noise (a dropped packet, a redeploy); two in a row are nine seconds without an
 * answer.
 */
export const FALHAS_ATE_RECONECTAR = 2;

/**
 * How long a socket that dropped may stay down before an HTTP probe is tried, in ms. The socket's
 * own backoff tries again at 1, 2 and 4 s first, so a blip that heals in that window never touches
 * the badge, and a proxy that cuts live sockets is noticed ten seconds after the cut.
 */
export const SONDA_APOS_QUEDA_MS = 10000;

/**
 * Every how many polls the per-atlas role is re-read over HTTP: between 30 s and 100 s, depending
 * on the backoff. A demotion reaches the screen that late; the server refuses the push at once.
 */
export const POLLS_POR_RELEITURA_DO_PAPEL = 10;

/** `code` of the error that marks the opening's wait for the socket as expired. */
export const PRAZO_DO_TEMPO_REAL_CODE = 'PRAZO_DO_TEMPO_REAL';

/**
 * Whether a failed attempt to open the socket means "go on over HTTP" rather than "the opening
 * failed".
 *
 * Only the two ways the socket fails while the server has just answered over HTTP qualify: the
 * handshake closed before the `connected` frame (a refused upgrade, `WS_HANDSHAKE_CLOSED` from
 * `ws-client.js`), and the wait expired ({@link PRAZO_DO_TEMPO_REAL_CODE}). Anything else (the
 * session was superseded by another opening, an abort, a bug) keeps failing the opening, which is
 * what it did before.
 * @param {*} erro - What `wsClient.connect` rejected with, or the expiry.
 * @returns {boolean}
 */
export function seguirSemTempoReal(erro) {
    const code = erro?.code;
    return code === 'WS_HANDSHAKE_CLOSED' || code === PRAZO_DO_TEMPO_REAL_CODE;
}

/**
 * The interval until the next poll.
 *
 * A poll that brought operations, or a mode just entered, goes back to {@link POLL_BASE_MS}: when
 * a colleague is working, the next change is likely soon. An empty poll grows the interval by half,
 * up to {@link POLL_OCIOSO_MAX_MS}, so an idle atlas costs a request every ten seconds and not
 * every three. A failure doubles it up to {@link POLL_FALHA_MAX_MS}: a server that is down is not
 * helped by being asked more often.
 *
 * FAILS SAFE on garbage: a previous interval that is not a positive finite number counts as the
 * base, so a `NaN` can never become a zero-delay loop.
 * @param {{ anterior?: number, trouxeOperacoes?: boolean, falhou?: boolean }} [entrada]
 * @returns {number}
 */
export function proximoIntervaloDoPoll({ anterior, trouxeOperacoes = false, falhou = false } = {}) {
    const base = Number.isFinite(anterior) && anterior > 0 ? anterior : POLL_BASE_MS;
    if (falhou) return Math.min(POLL_FALHA_MAX_MS, Math.max(base, POLL_BASE_MS) * 2);
    if (trouxeOperacoes) return POLL_BASE_MS;
    return Math.min(POLL_OCIOSO_MAX_MS, Math.round(Math.max(base, POLL_BASE_MS) * 1.5));
}

/**
 * What a failed poll means, from its HTTP status.
 *
 *   - `fim-do-acesso`: 403, 404 or 410. The atlas is gone for this person (deleted, share revoked),
 *     the same news the socket brings as `atlas_deleted` or a 4003 close; the caller takes the same
 *     exit, which is the one that rescues unsent work.
 *   - `credencial-vencida`: 401 for the PUBLIC-LINK VISITOR, whose token is ephemeral and has no
 *     refresh; the same end as the socket's `credentialExpired`. For an account a 401 is renewed by
 *     the HTTP client itself, and a renewal that fails for good is announced by the session-lost
 *     handler, so for an account it is only another failure.
 *   - `tentar-de-novo`: everything else (network, 5xx, 429), with backoff.
 * @param {*} status - `error.status` of the failed request.
 * @param {{ visitante?: boolean }} [contexto]
 * @returns {'fim-do-acesso'|'credencial-vencida'|'tentar-de-novo'}
 */
export function desfechoDaFalhaDoPoll(status, { visitante = false } = {}) {
    if (status === 403 || status === 404 || status === 410) return 'fim-do-acesso';
    if (status === 401 && visitante === true) return 'credencial-vencida';
    return 'tentar-de-novo';
}
