// Path: js/temporal/temporal-settings.modal.js

/**
 * @fileoverview Per-map temporal settings modal: division unit (MINUTO / HORA /
 * DIA / SEMANA) and the map-wide timeline start/end. Edits are buffered and only
 * committed on "Salvar" (via setMapTemporalConfig, which emits
 * TEMPORAL_CONFIG_CHANGED so the controller re-syncs); "Cancelar" discards them.
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
        this._pending = null;
        setupCleanup(this);
    }

    async show() {
        const config = await getMapTemporalConfig(this._mapName);
        this._pending = { ...config };
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

        // Header
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

        // Body (scrollable)
        const body = document.createElement('div');
        body.className = 'modal-body temporal-settings-body';

        body.appendChild(
            this._field(
                'Unidade de divisão',
                'Granularidade da régua de tempo e do passo do cursor.',
                this._unitSelect()
            )
        );

        this._startInput = this._datetimeInput(this._pending.inicio, (epoch) => {
            this._pending.inicio = epoch;
        });
        body.appendChild(
            this._field('Início do mapa', 'Deixe em branco para usar o início automático das feições.', this._startInput)
        );

        this._endInput = this._datetimeInput(this._pending.fim, (epoch) => {
            this._pending.fim = epoch;
        });
        body.appendChild(
            this._field('Fim do mapa', 'Deixe em branco para usar o fim automático das feições.', this._endInput)
        );

        container.appendChild(body);

        // Footer
        const footer = document.createElement('div');
        footer.className = 'modal-footer temporal-settings-footer';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'temporal-settings-btn temporal-settings-btn--cancel';
        cancelBtn.textContent = 'Cancelar';
        addDomListener(this, cancelBtn, 'click', () => this._close());
        footer.appendChild(cancelBtn);

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'temporal-settings-btn temporal-settings-btn--save';
        saveBtn.textContent = 'Salvar';
        addDomListener(this, saveBtn, 'click', () => this._save());
        footer.appendChild(saveBtn);

        container.appendChild(footer);
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
            if (key === this._pending.unidade) opt.selected = true;
            select.appendChild(opt);
        }
        addDomListener(this, select, 'change', () => {
            this._pending.unidade = select.value;
        });
        return select;
    }

    _datetimeInput(epoch, onChange) {
        const input = document.createElement('input');
        input.type = 'datetime-local';
        input.className = 'temporal-settings__datetime';
        input.value = Number.isFinite(epoch) ? epochToDatetimeLocal(epoch) : '';
        addDomListener(this, input, 'change', () => onChange(datetimeLocalToEpoch(input.value)));
        return input;
    }

    async _save() {
        try {
            await setMapTemporalConfig(this._mapName, {
                unidade: this._pending.unidade,
                inicio: this._pending.inicio,
                fim: this._pending.fim,
            });
        } catch (error) {
            console.warn('Failed to persist temporal settings:', error);
        }
        this._close();
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
