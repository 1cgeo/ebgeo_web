// Path: js/temporal/temporal-settings.modal.js

/**
 * @fileoverview Per-map temporal settings modal: division unit (MINUTO / HORA /
 * DIA / SEMANA) and the map-wide timeline start/end. Persists through
 * setMapTemporalConfig, which emits TEMPORAL_CONFIG_CHANGED so the controller
 * re-syncs the timeline bar live.
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement,
} from '../utilities/event-cleanup.js';
import { getMapTemporalConfig, setMapTemporalConfig } from '../store';
import { TEMPORAL_UNIT_KEYS, TEMPORAL_UNITS } from './temporal.constants.js';
import { epochToDatetimeLocal, datetimeLocalToEpoch } from './temporal.utils.js';

class TemporalSettingsModal {
    constructor(mapName) {
        this._mapName = mapName;
        this._overlay = null;
        this._previousActiveElement = null;
        setupCleanup(this);
    }

    async show() {
        this._config = await getMapTemporalConfig(this._mapName);
        this._previousActiveElement = document.activeElement;
        this._render();
        document.body.appendChild(this._overlay);
        requestAnimationFrame(() => {
            this._overlay.dataset.visible = 'true';
        });
    }

    _render() {
        this._overlay = document.createElement('div');
        this._overlay.className = 'modal-overlay temporal-settings-overlay';
        this._overlay.setAttribute('role', 'dialog');
        this._overlay.setAttribute('aria-modal', 'true');
        this._overlay.dataset.visible = 'false';

        const container = document.createElement('div');
        container.className = 'modal-container temporal-settings-container';

        const header = document.createElement('div');
        header.className = 'modal-header';
        const title = document.createElement('h2');
        title.className = 'modal-title';
        title.textContent = 'Configurações temporais';
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close-btn';
        closeBtn.setAttribute('aria-label', 'Fechar');
        closeBtn.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        addDomListener(this, closeBtn, 'click', () => this._close());
        header.appendChild(closeBtn);
        container.appendChild(header);

        const body = document.createElement('div');
        body.className = 'modal-body temporal-settings-body';

        // Division unit
        body.appendChild(
            this._field(
                'Unidade de divisão',
                'Granularidade da régua de tempo e do passo do cursor.',
                this._unitSelect()
            )
        );

        // Map start
        this._startInput = this._datetimeInput(this._config.inicio);
        body.appendChild(
            this._field('Início do mapa', 'Deixe em branco para usar o início automático das feições.', this._startInput)
        );

        // Map end
        this._endInput = this._datetimeInput(this._config.fim);
        body.appendChild(
            this._field('Fim do mapa', 'Deixe em branco para usar o fim automático das feições.', this._endInput)
        );

        container.appendChild(body);
        this._overlay.appendChild(container);

        addDomListener(this, this._overlay, 'click', (e) => {
            if (e.target === this._overlay) this._close();
        });
        addDomListener(this, document, 'keydown', (e) => {
            if (e.key === 'Escape') this._close();
        });
    }

    _field(labelText, descText, control) {
        const field = document.createElement('div');
        field.className = 'settings-field temporal-settings-field';

        const label = document.createElement('div');
        label.className = 'settings-field__label';
        label.textContent = labelText;
        field.appendChild(label);

        const desc = document.createElement('div');
        desc.className = 'settings-field__description';
        desc.textContent = descText;
        field.appendChild(desc);

        field.appendChild(control);
        return field;
    }

    _unitSelect() {
        const select = document.createElement('select');
        select.className = 'temporal-settings__select';
        for (const key of TEMPORAL_UNIT_KEYS) {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = TEMPORAL_UNITS[key].label;
            if (key === this._config.unidade) opt.selected = true;
            select.appendChild(opt);
        }
        addDomListener(this, select, 'change', () => this._persist({ unidade: select.value }));
        return select;
    }

    _datetimeInput(epoch) {
        const input = document.createElement('input');
        input.type = 'datetime-local';
        input.className = 'temporal-settings__datetime';
        input.value = Number.isFinite(epoch) ? epochToDatetimeLocal(epoch) : '';
        addDomListener(this, input, 'change', () => this._onRangeChange());
        return input;
    }

    _onRangeChange() {
        this._persist({
            inicio: datetimeLocalToEpoch(this._startInput.value),
            fim: datetimeLocalToEpoch(this._endInput.value),
        });
    }

    async _persist(patch) {
        try {
            this._config = await setMapTemporalConfig(this._mapName, patch);
        } catch (error) {
            console.warn('Failed to persist temporal settings:', error);
        }
    }

    _close() {
        this._overlay.dataset.visible = 'false';
        setTimeout(() => {
            cleanup(this);
            removeElement(this._overlay);
            this._overlay = null;
            this._previousActiveElement?.focus?.();
        }, 200);
    }
}

/**
 * Opens the per-map temporal settings modal.
 * @param {string} mapName - Map to configure.
 * @returns {Promise<void>}
 */
export async function showTemporalSettingsModal(mapName) {
    const modal = new TemporalSettingsModal(mapName);
    await modal.show();
}
