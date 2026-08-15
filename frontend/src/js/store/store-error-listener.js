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

/**
 * Block reasons that mean "the map is locked" (vs an insufficient-role / read-only block). The store
 * ops emit `map_locked` (current map) and `target_map_locked` (a move into a locked destination map);
 * every other reason is a permission string from the permission-guard.
 */
const LOCK_REASONS = new Set(['map_locked', 'target_map_locked']);

/** Last toast time PER KIND, so a lock toast doesn't debounce-swallow a differing read-only one. */
const _lastBlockedToastAt = { lock: 0, denied: 0, explicit: 0 };

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

    eventBus.on(StoreErrorEvents.STORE_OPERATION_BLOCKED, (payload) => {
        // Distinguish the two block kinds the store ops carry (previously both showed the lock
        // message): a locked map vs insufficient role on a remote atlas (a Visualizador) — the latter
        // must read as read-only access.
        // A block that ships its OWN message wins: the two canned texts below describe the
        // map-lock and the read-only role, and showing either of them for an unrelated
        // refusal (a local-atlas cap, say) would be actively misleading.
        const explicit = typeof payload?.message === 'string' && payload.message.length > 0;
        const isLock = LOCK_REASONS.has(payload?.reason);
        const kind = explicit ? 'explicit' : (isLock ? 'lock' : 'denied');

        const now = Date.now();
        if (now - _lastBlockedToastAt[kind] < BLOCKED_DEBOUNCE_MS) return;
        _lastBlockedToastAt[kind] = now;

        let text;
        if (explicit) {
            text = payload.message;
        } else if (isLock) {
            text = 'Mapa bloqueado. Desbloqueie para editar.';
        } else {
            text = 'Acesso somente leitura — você não pode editar este projeto.';
        }

        showInChannel('store-blocked', text, 'warning', { duration: 2500 });
    });
}
