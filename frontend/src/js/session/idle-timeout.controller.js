// Path: js/session/idle-timeout.controller.js

/**
 * @fileoverview Idle session timeout for the MAP page. While logged in, inactivity for N minutes
 * ends the session — but first a warning gives the user a chance to stay connected (the
 * banking/Google pattern). On expiry the account control tears the session down to anonymous and
 * re-opens login.
 *
 * Lifecycle is driven by SESSION_CHANGED: the watch runs only while authenticated and stops on
 * logout. Everything below the session lifecycle — activity detection, the warning overlay, the
 * timing core — lives in `idle-watch.js`, so the admin page (which has no event bus and no control
 * registry) can reuse it with its own expiry action.
 */

import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { sessionContext } from '@store/sync/session-context.js';
import { getControl } from '@store';
import { setupCleanup, subscribe } from '@utils/event-cleanup.js';
import { startIdleWatch } from './idle-watch.js';

export class IdleTimeoutController {
    constructor() {
        /** @type {(function(): void)|null} Stops the active watch. */
        this._stopWatch = null;
        setupCleanup(this);
    }

    /** Wire the session listener and sync to the current state. Idempotent; call once at boot. */
    init() {
        subscribe(this, getEventBus(), EventTypes.SESSION_CHANGED, () => this._syncFromSession());
        this._syncFromSession();
    }

    /** @private Start the watch when authenticated, stop it otherwise. */
    _syncFromSession() {
        if (sessionContext.isAuthenticated()) this._start();
        else this._stop();
    }

    /** @private */
    _start() {
        if (this._stopWatch) return;
        this._stopWatch = startIdleWatch({
            onExpire: () => this._expire(),
            onLeaveNow: () => this._leaveNow(),
        });
    }

    /** @private */
    _stop() {
        if (!this._stopWatch) return;
        this._stopWatch();
        this._stopWatch = null;
    }

    /** @private The warning LAPSED: nobody decided anything, so the session expired. */
    _expire() {
        this._stop();
        const account = getControl('account');
        if (account && typeof account.handleSessionLost === 'function') {
            account.handleSessionLost('Sua sessão expirou por inatividade. Entre novamente.');
        }
    }

    /**
     * @private A pessoa clicou "Sair agora" no aviso. NÃO é expiração.
     *
     * Os dois caminhos compartilhavam este corpo, e o efeito era dizer a quem acabara de escolher
     * sair que a sessão dela expirou, e reabrir o login em seguida: a tela desfazendo o gesto e
     * atribuindo a ele uma causa que não aconteceu.
     *
     * O caminho certo é o MESMO do botão "Sair" do menu da conta, que já resgata o trabalho não
     * enviado, informa por toast e não reabre login nenhum.
     */
    _leaveNow() {
        this._stop();
        const account = getControl('account');
        if (account && typeof account.leaveByUserGesture === 'function') {
            account.leaveByUserGesture();
        }
    }
}

