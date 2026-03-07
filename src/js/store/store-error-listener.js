// Path: js/store/store-error-listener.js

/**
 * @module store/store-error-listener
 * @description Subscribes to store error events and shows user-facing feedback.
 * Initialized once during app startup via initStoreEvents().
 *
 * Uses showInChannel to prevent toast stacking on rapid failures
 * (e.g. IndexedDB quota exceeded during batch operations).
 */

import { StoreErrorEvents } from './store-errors.js';
import { showInChannel } from '../utilities/toast_service.js';

/** Minimum interval between "blocked" toasts (ms) */
const BLOCKED_DEBOUNCE_MS = 3000;

let _lastBlockedToastAt = 0;

/**
 * Registers error event listeners on the EventBus.
 * @param {import('../events/event_bus.js').EventBus} eventBus
 */
export function registerStoreErrorListeners(eventBus) {
    eventBus.on(StoreErrorEvents.STORE_PERSIST_ERROR, (payload) => {
        showInChannel(
            'store-persist-error',
            'Erro ao salvar dados. Verifique o armazenamento do navegador.',
            'error',
            { duration: 5000 }
        );
        console.error('[Store] Persistence error:', payload);
    });

    eventBus.on(StoreErrorEvents.STORE_SYNC_ERROR, (payload) => {
        if (payload.consecutiveFailures >= 3) {
            showInChannel(
                'store-sync-error',
                'Erro na fila de sincronização. Algumas alterações podem não ser sincronizadas.',
                'warning',
                { duration: 4000 }
            );
        }
    });

    eventBus.on(StoreErrorEvents.STORE_OPERATION_BLOCKED, () => {
        const now = Date.now();
        if (now - _lastBlockedToastAt < BLOCKED_DEBOUNCE_MS) return;

        _lastBlockedToastAt = now;
        showInChannel(
            'store-blocked',
            'Mapa bloqueado. Desbloqueie para editar.',
            'warning',
            { duration: 2000 }
        );
    });
}
