// Path: js/store/sync/sync-session.js
import { getActiveScope } from '@store/atlas-namespace.js';
import { operationQueue } from '@store/sync/operation-queue.js';
import { captureRemoteWriteFence } from '../remote-write-fence.js';

/** Captured destination and cancellation boundary for one mounted collaboration session. */
export class SyncSession {
    constructor(atlasId, principalId) {
        this.atlasId = atlasId;
        this.principalId = principalId;
        this.scope = getActiveScope();
        this.assertWritable = captureRemoteWriteFence(this.scope);
        this.queue = this.scope ? operationQueue.forScope(this.scope) : operationQueue;
        this.controller = new AbortController();
        this.flushPromise = null;
        this.recovering = true;
        /** Per-atlas server permission, once the socket tells it (`SyncEngine._markRecorteLevel`). */
        this.nivel = null;

        // THE MODE WITHOUT REAL TIME BELONGS TO THE SESSION (`store/sync/sem-tempo-real.js`): the
        // pull timer and the probe timer die with it, so closing the session (another atlas, a
        // disconnect, the tab-lock brake) can never leave a poll running against the atlas the tab
        // left. The fields are declared here, and not stuck on the instance by the engine, so the
        // whole state of the mode is readable in one place.
        /** @type {ReturnType<typeof setTimeout>|null} The next pull of the mode. */
        this.pollTimer = null;
        /** @type {ReturnType<typeof setTimeout>|null} The HTTP probe after the socket dropped. */
        this.sondaTimer = null;
        /** Consecutive pulls that failed (the state leaves "sem tempo real" after a few). */
        this.falhasDoPoll = 0;
        /** Pulls since the per-atlas role was last read over HTTP. */
        this.pollsDesdeOPapel = 0;
        /** The per-atlas permission `GET /atlas/:atlasId` answered, when the socket did not. */
        this.permissaoHttp = null;
        /** Whether this session already told the person it is without real time. */
        this.avisouSemTempoReal = false;
        /**
         * Whether the HTTP probe already answered once while the socket was down, and the socket was
         * asked to retry at once (`WsClient.reconectarAgora`). The mode is entered on the SECOND
         * answer, so it always follows a fresh refusal of the socket.
         */
        this.sondaRespondeu = false;
        this.signal.addEventListener('abort', () => this.pararSemTempoReal(), { once: true });
    }

    /** Stops the pull and the probe of the mode without real time. Idempotent. */
    pararSemTempoReal() {
        clearTimeout(this.pollTimer);
        clearTimeout(this.sondaTimer);
        this.pollTimer = null;
        this.sondaTimer = null;
    }

    get signal() { return this.controller.signal; }

    assertActive() {
        this.assertWritable();
        this.signal.throwIfAborted();
        if (getActiveScope() !== this.scope) {
            this.close();
            this.signal.throwIfAborted();
        }
    }

    close() {
        this.controller.abort(new DOMException('A sessão deste atlas foi encerrada.', 'AbortError'));
    }
}
