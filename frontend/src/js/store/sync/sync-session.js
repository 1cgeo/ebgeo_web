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
