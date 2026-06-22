// Path: js/modals/atlas-settings.modal.js

/**
 * @fileoverview Atlas settings modal — a Gestor configures which capabilities (3D, 360, terrain)
 * and which basemaps are available in this atlas. Saves via `apiClient.updateAtlasSettings`
 * (manage-level server-side); the backend broadcasts `atlas_settings_updated`, so every connected
 * client re-gates the UI (the per-atlas overlay is a RESTRICTION over the deploy config — it can
 * only turn capabilities OFF, never enable what the deployment disabled).
 *
 * Exports {@link showAtlasSettingsModal}.
 */

import { ModalBase } from './modal.base.js';
import { addScopedDomListener, clearScopedListeners } from '@utils/event-cleanup.js';
import { escapeHtml } from '@utils/html-escape.js';
import { apiClient } from '@store/sync/api-client.js';
import { showError, showSuccess } from '@utils/toast_service.js';
import config from '@js/config.js';

/** Feature switches exposed in the modal (backend `settings.features` keys). */
const FEATURE_FIELDS = [
    { key: 'map_3d', label: 'Mapa 3D' },
    { key: 'panoramic_images', label: 'Imagens panorâmicas (360°)' },
    { key: 'terrain_3d', label: 'Terreno 3D' },
];

/**
 * Atlas settings modal.
 * @extends ModalBase
 */
export class AtlasSettingsModal extends ModalBase {
    /**
     * @param {string} atlasId
     * @param {Object} [options]
     * @param {string} [options.atlasName] - Display name for the header title.
     */
    constructor(atlasId, { atlasName } = {}) {
        super({
            id: 'atlas-settings-modal',
            title: atlasName ? `Configurar ${atlasName}` : 'Configurar projeto',
            destroyOnHide: true,
        });
        this._atlasId = atlasId;
        /** @type {Object|null} */
        this._settings = null;
        /** @type {boolean} */
        this._busy = false;
    }

    /** @returns {HTMLElement} */
    render() {
        const overlay = super.render();
        this._overlay.dataset.testid = 'atlas-settings-modal';
        this.getBody().innerHTML = '<div class="sharing__state" data-testid="atlas-settings-loading">Carregando…</div>';
        document.body.appendChild(overlay);
        this._load();
        return overlay;
    }

    /** @private Loads the current settings and renders the form. */
    async _load() {
        try {
            this._settings = (await apiClient.getAtlasSettings(this._atlasId)) || {};
            this._renderBody();
        } catch {
            this.getBody().innerHTML =
                '<div class="sharing__state sharing__state--error" data-testid="atlas-settings-error">Não foi possível carregar as configurações.</div>';
        }
    }

    /** @private @returns {string[]} All basemap ids known to the deploy config. */
    _allBasemapIds() {
        return config.basemaps ? Object.keys(config.basemaps) : [];
    }

    /** @private */
    _renderBody() {
        clearScopedListeners(this, 'body');
        const features = this._settings.features || {};
        const allowed = Array.isArray(this._settings.basemaps) ? this._settings.basemaps : [];
        const noRestriction = allowed.length === 0;

        const featureRows = FEATURE_FIELDS.map((f) => `
            <label class="settings-field atlas-settings__row">
                <span class="settings-field__label">${escapeHtml(f.label)}</span>
                <input type="checkbox" data-feature="${escapeHtml(f.key)}"${features[f.key] !== false ? ' checked' : ''}>
            </label>
        `).join('');

        const basemapRows = this._allBasemapIds().map((id) => {
            const name = config.basemaps[id]?.name || id;
            const checked = noRestriction || allowed.includes(id);
            return `
                <label class="settings-field atlas-settings__row">
                    <span class="settings-field__label">${escapeHtml(name)}</span>
                    <input type="checkbox" data-basemap="${escapeHtml(id)}"${checked ? ' checked' : ''}>
                </label>
            `;
        }).join('');

        this.getBody().innerHTML = `
            <div class="atlas-settings">
                <section class="sharing-section">
                    <h3 class="sharing-section__title">Recursos disponíveis</h3>
                    ${featureRows}
                </section>
                <section class="sharing-section">
                    <h3 class="sharing-section__title">Mapas base disponíveis</h3>
                    <p class="settings-field__description">Desmarque para restringir neste projeto. Tudo marcado = sem restrição.</p>
                    ${basemapRows}
                </section>
                <div class="atlas-settings__actions">
                    <button type="button" class="prompt-modal-btn prompt-modal-btn-confirm"
                            data-action="save" data-testid="atlas-settings-save">Salvar</button>
                </div>
            </div>
        `;

        const save = this.getBody().querySelector('[data-action="save"]');
        if (save) addScopedDomListener(this, 'body', save, 'click', () => this._handleSave());
    }

    /** @private Collects the form, patches the atlas settings, and closes on success. */
    async _handleSave() {
        if (this._busy) return;
        this._busy = true;
        const body = this.getBody();

        const features = {};
        for (const f of FEATURE_FIELDS) {
            features[f.key] = !!body.querySelector(`[data-feature="${f.key}"]`)?.checked;
        }

        const allIds = this._allBasemapIds();
        const checked = allIds.filter((id) => body.querySelector(`[data-basemap="${CSS.escape(id)}"]`)?.checked);
        // Empty OR full selection means "no restriction" ([]); a strict subset is the allowlist.
        const basemaps = (checked.length === 0 || checked.length === allIds.length) ? [] : checked;

        try {
            await apiClient.updateAtlasSettings(this._atlasId, { features, basemaps });
            showSuccess('Configurações salvas.');
            this.hide();
        } catch {
            showError('Não foi possível salvar as configurações.');
        } finally {
            this._busy = false;
        }
    }

    /** Hides the modal, clearing scoped listeners first. */
    hide() {
        clearScopedListeners(this, 'body');
        super.hide();
    }
}

/**
 * Shows the atlas settings modal. The caller decides whether to offer it (Gestor-only); the
 * backend independently enforces 'manage' on the PATCH.
 * @param {string} atlasId
 * @param {Object} [options]
 * @param {string} [options.atlasName]
 * @returns {AtlasSettingsModal}
 */
export function showAtlasSettingsModal(atlasId, options = {}) {
    const modal = new AtlasSettingsModal(atlasId, options);
    modal.render();
    modal.show();
    return modal;
}
