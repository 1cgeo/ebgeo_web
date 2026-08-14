// Path: js/ui/view-mode.controller.js

/**
 * @fileoverview Safe view ↔ edit driver. Toggles the `is-view-only` body class, which hides the
 * create/edit toolbars (draw/military/analysis) via CSS. A role that cannot edit the connected
 * remote atlas (Visualizador/Comentarista) is locked to the safe view automatically; a role that
 * CAN edit may toggle into it voluntarily ("Editar mapa", Shift+E — à la Felt).
 *
 * A body class (not the ui-visibility profile system) is used deliberately: nothing registers the
 * toolbars with that controller, so applyProfile would be a no-op for them. The class is independent
 * of the briefing/application modes, so it survives a briefing round-trip without extra bookkeeping.
 *
 * "Can edit" comes from the same permission-guard the store ops use: local/offline is always
 * editable; a connected remote atlas is role-gated.
 */

import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { checkPermission } from '@store/sync/permission-guard.js';
import { syncEngine } from '@store/sync/sync-engine.js';
import { showToast } from '@utils';

const VIEW_ONLY_CLASS = 'is-view-only';

class ViewModeController {
    constructor() {
        /** @type {boolean} An editor's voluntary "view" toggle (ignored for a no-edit role). */
        this._manualView = false;
        /** @type {string|null} The connected atlas the manual toggle belongs to (per-atlas preference). */
        this._lastAtlasId = null;
        this._wired = false;
    }

    /** Wires the session/connection listeners and applies the initial state. Idempotent. */
    init() {
        if (this._wired) return;
        this._wired = true;
        const bus = getEventBus();
        bus.on(EventTypes.SESSION_CHANGED, () => this._sync());
        bus.on(EventTypes.CONNECTION_STATE_CHANGED, () => this._sync());
        this._sync();
    }

    /** @returns {boolean} Whether the current session can edit the active store. */
    canEdit() {
        return checkPermission('UPDATE_FEATURE').allowed;
    }

    /** @private Reflects the effective view-only state onto the body class. */
    _sync() {
        const canEdit = this.canEdit();
        // The voluntary "view" toggle is a per-connected-atlas preference: drop it when the user can't
        // edit at all (forced view) OR when the atlas/session boundary changes (login/logout, connect/
        // disconnect, switching atlas) — otherwise it would leak into a workspace that never asked for it.
        const atlasId = syncEngine.atlasId ?? null;
        if (!canEdit || atlasId !== this._lastAtlasId) this._manualView = false;
        this._lastAtlasId = atlasId;
        document.body.classList.toggle(VIEW_ONLY_CLASS, !canEdit || this._manualView);
    }

    /**
     * Toggles the voluntary "view" mode for users who CAN edit. For a no-edit role (already locked to
     * the safe view) it is a no-op with a hint.
     * @returns {boolean} the resulting view-only state.
     */
    toggleManualView() {
        if (!this.canEdit()) {
            showToast('Acesso somente leitura — você não pode editar este projeto.', 'info');
            return true;
        }
        this._manualView = !this._manualView;
        document.body.classList.toggle(VIEW_ONLY_CLASS, this._manualView);
        showToast(this._manualView ? 'Modo de visualização' : 'Modo de edição', 'info');
        return this._manualView;
    }
}

let _instance = null;

/** @returns {ViewModeController} The singleton view-mode driver. */
export function getViewModeController() {
    if (!_instance) _instance = new ViewModeController();
    return _instance;
}

