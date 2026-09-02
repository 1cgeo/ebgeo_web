// Path: js/modals/layer-transfer.modal.js

/**
 * @fileoverview Destination picker for moving/copying a whole layer to another
 * map of the atlas.
 *
 * Single selection, unlike the sibling combine-maps modal: a layer goes to ONE
 * map. Locked maps are listed and refused rather than hidden, because a lock is
 * a reversible state the user can undo, and a map that simply disappears from
 * the list teaches nothing about why.
 */

import { ModalBase } from './modal.base.js';
import { addDomListener } from '@utils/event-cleanup.js';
import { escapeHtml } from '@utils/html-escape.js';
import { getAllMapNamesStore, getCurrentMapNameSync, isMapLocked } from '@store';
import { showToast } from '@utils/toast_service.js';

/**
 * Icons used in the modal.
 */
const ICONS = {
    move: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="5 9 2 12 5 15"/>
        <polyline points="9 5 12 2 15 5"/>
        <polyline points="15 19 12 22 9 19"/>
        <polyline points="19 9 22 12 19 15"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <line x1="12" y1="2" x2="12" y2="22"/>
    </svg>`,
    copy: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
    </svg>`,
    lock: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>`
};

/** Per-mode wording. */
const MODE_TEXT = Object.freeze({
    move: {
        title: 'Mover camada',
        icon: ICONS.move,
        verb: 'Mover',
        description: 'A camada e as feições dela saem do mapa atual.'
    },
    copy: {
        title: 'Copiar camada',
        icon: ICONS.copy,
        verb: 'Copiar',
        description: 'A camada permanece no mapa atual e uma cópia é criada no destino.'
    }
});

/**
 * Layer transfer modal.
 * @extends ModalBase
 */
export class LayerTransferModal extends ModalBase {
    /**
     * @param {Object} options
     * @param {string} options.layerName - Name of the layer being transferred
     * @param {string} options.mode - 'move' or 'copy'
     * @param {Array<{name: string, locked: boolean}>} options.maps - Candidate destination maps
     */
    constructor(options = {}) {
        const text = MODE_TEXT[options.mode] || MODE_TEXT.move;

        super({
            id: 'layer-transfer-modal',
            title: text.title,
            icon: text.icon,
            destroyOnHide: true
        });

        this._text = text;
        this._layerName = options.layerName || '';
        this._maps = options.maps || [];
        this._selectedMap = null;
        this._resolve = null;
    }

    /**
     * Renders the modal content.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._container.classList.add('layer-transfer-modal-container');

        const body = this.getBody();
        body.innerHTML = this._createBodyContent();

        this._setupListeners();

        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * Creates the body content HTML.
     * @private
     * @returns {string}
     */
    _createBodyContent() {
        return `
            <div class="layer-transfer-modal-content">
                <div class="layer-transfer-description">
                    Selecione o mapa de destino para a camada
                    <strong>"${escapeHtml(this._layerName)}"</strong>.
                    ${escapeHtml(this._text.description)}
                </div>

                <div class="layer-transfer-list" role="listbox" aria-label="Mapas de destino">
                    ${this._renderMapsList()}
                </div>

                <div class="layer-transfer-warning" role="note">
                    Esta ação não pode ser desfeita.
                </div>

                <div class="layer-transfer-modal-actions">
                    <button type="button" class="layer-transfer-modal-btn layer-transfer-modal-btn-cancel">
                        Cancelar
                    </button>
                    <button type="button" class="layer-transfer-modal-btn layer-transfer-modal-btn-confirm" disabled>
                        <span>${escapeHtml(this._text.verb)}</span>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Renders the destination maps list HTML.
     * @private
     * @returns {string}
     */
    _renderMapsList() {
        if (this._maps.length === 0) {
            return `
                <div class="layer-transfer-empty">
                    Não há outro mapa neste atlas
                </div>
            `;
        }

        return this._maps.map(({ name, locked }) => {
            const initial = escapeHtml(name.charAt(0).toUpperCase());
            const lockedClass = locked ? ' layer-transfer-item--locked' : '';
            const lockedBadge = locked
                ? `<span class="layer-transfer-locked-badge">${ICONS.lock}<span>travado</span></span>`
                : '';

            return `
                <div class="layer-transfer-item${lockedClass}"
                     data-map="${escapeHtml(name)}"
                     role="option"
                     aria-selected="false"
                     ${locked ? 'aria-disabled="true"' : 'tabindex="0"'}>
                    <span class="layer-transfer-checkbox-custom">${ICONS.check}</span>
                    <span class="layer-transfer-badge">${initial}</span>
                    <span class="layer-transfer-name">${escapeHtml(name)}</span>
                    ${lockedBadge}
                </div>
            `;
        }).join('');
    }

    /**
     * Sets up event listeners.
     * @private
     */
    _setupListeners() {
        const body = this.getBody();

        const cancelBtn = body.querySelector('.layer-transfer-modal-btn-cancel');
        addDomListener(this, cancelBtn, 'click', () => this.hide());

        const confirmBtn = body.querySelector('.layer-transfer-modal-btn-confirm');
        addDomListener(this, confirmBtn, 'click', () => this._handleConfirm());

        const items = body.querySelectorAll('.layer-transfer-item');
        items.forEach(item => {
            // A locked destination is listed and refuses the click by NAMING the
            // state. A dead click would read as a broken row: the lock is
            // reversible, and the click is how the reason reaches the person.
            if (item.classList.contains('layer-transfer-item--locked')) {
                addDomListener(this, item, 'click', () => {
                    showToast(
                        `"${item.dataset.map}" está travado. Destrave-o para receber a camada.`,
                        'warning'
                    );
                });
                return;
            }

            addDomListener(this, item, 'click', () => this._select(item.dataset.map));
            addDomListener(this, item, 'keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this._select(item.dataset.map);
                }
            });
        });
    }

    /**
     * Opens the modal and resolves with the chosen map name (or null).
     * @returns {Promise<string|null>}
     */
    open() {
        return new Promise((resolve) => {
            this._resolve = resolve;
            this.show();
        });
    }

    /**
     * Hides the modal, resolving with null when nothing was confirmed.
     * @override
     */
    hide() {
        const resolve = this._resolve;
        this._resolve = null;
        super.hide();
        if (resolve) resolve(null);
    }

    /**
     * Selects a destination map.
     * @private
     * @param {string} mapName
     */
    _select(mapName) {
        this._selectedMap = mapName;
        this._updateUI();
    }

    /**
     * Updates the UI to reflect the current selection.
     * @private
     */
    _updateUI() {
        const body = this.getBody();
        if (!body) return;

        body.querySelectorAll('.layer-transfer-item').forEach(item => {
            const isSelected = item.dataset.map === this._selectedMap;
            item.classList.toggle('selected', isSelected);
            item.setAttribute('aria-selected', String(isSelected));
        });

        const confirmBtn = body.querySelector('.layer-transfer-modal-btn-confirm');
        confirmBtn.disabled = !this._selectedMap;
    }

    /**
     * Confirms the transfer, resolving with the chosen map.
     * @private
     */
    _handleConfirm() {
        if (!this._selectedMap) return;

        const chosen = this._selectedMap;
        const resolve = this._resolve;
        this._resolve = null;
        super.hide();
        if (resolve) resolve(chosen);
    }
}

/**
 * Shows the layer transfer modal and resolves with the chosen map name.
 *
 * Reads the map list itself (the caller only knows the layer), and asks each
 * map for its lock state so a locked destination can be shown as refused
 * instead of silently missing.
 *
 * @param {Object} options
 * @param {string} options.layerName - Layer being transferred
 * @param {string} options.mode - 'move' or 'copy'
 * @returns {Promise<string|null>} Chosen map name, or null if cancelled
 */
export async function showLayerTransferModal({ layerName, mode }) {
    const currentMapName = getCurrentMapNameSync();
    const allMapNames = await getAllMapNamesStore();
    const candidates = (allMapNames || []).filter(name => name !== currentMapName);
    const lockStates = await Promise.all(candidates.map(name => isMapLocked(name)));

    const maps = candidates.map((name, index) => ({
        name,
        locked: Boolean(lockStates[index])
    }));

    const modal = new LayerTransferModal({ layerName, mode, maps });
    modal.render();
    return modal.open();
}
