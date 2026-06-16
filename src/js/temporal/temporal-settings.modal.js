// Path: js/temporal/temporal-settings.modal.js

/**
 * @fileoverview Per-map temporal settings modal: division unit (MINUTO / HORA /
 * DIA / SEMANA), reference mode (absolute real dates vs relative military D+N),
 * and the map-wide timeline bounds. In absolute mode the bounds are real
 * start/end datetimes; in relative mode they are unit offsets (Início/Fim) around
 * an optional "Data de D" origin. Edits are buffered and committed on "Salvar"
 * (via setMapTemporalConfig, which emits TEMPORAL_CONFIG_CHANGED so the controller
 * re-syncs); "Cancelar" discards them. Changing D within relative mode shifts all
 * features so they keep their D+N offset.
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement,
} from '../utilities/event-cleanup.js';
import { getMapTemporalConfig, setMapTemporalConfig, getControl } from '../store';
import { TEMPORAL_UNIT_KEYS, TEMPORAL_UNITS, TEMPORAL_MODES } from './temporal.constants.js';
import { epochToDatetimeLocal, datetimeLocalToEpoch, unitToMs, unitLetter } from './temporal.utils.js';

class TemporalSettingsModal {
    constructor(mapName) {
        this._mapName = mapName;
        this._overlay = null;
        this._previousActiveElement = null;
        this._pending = null;
        this._original = null;
        this._body = null;
        this._prefixSpans = [];
        setupCleanup(this);
    }

    async show() {
        const config = await getMapTemporalConfig(this._mapName);
        const unitMs = unitToMs(config.unidade);
        const origem = Number.isFinite(config.origem) ? config.origem : null;
        const isRelative = config.modo === TEMPORAL_MODES.RELATIVO && Number.isFinite(origem);

        this._pending = {
            modo: config.modo || TEMPORAL_MODES.ABSOLUTO,
            unidade: config.unidade,
            // Absolute bounds (epoch ms).
            inicio: config.inicio,
            fim: config.fim,
            // Relative working values (unit offsets + optional D-Day epoch).
            startOffset: isRelative && Number.isFinite(config.inicio) ? (config.inicio - origem) / unitMs : 0,
            endOffset: isRelative && Number.isFinite(config.fim) ? (config.fim - origem) / unitMs : 30,
            dDate: origem,
        };
        this._original = { modo: config.modo, origem };

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
        body.dataset.mode = this._pending.modo;
        this._body = body;

        body.appendChild(
            this._field('Modo', 'Datas reais (absoluto) ou offsets militares D+N (relativo).', this._modeSelect())
        );
        body.appendChild(
            this._field('Unidade de divisão', 'Granularidade da régua de tempo e do passo do cursor.', this._unitSelect())
        );

        // Absolute group: real start/end datetimes.
        const absGroup = document.createElement('div');
        absGroup.className = 'temporal-settings-group';
        absGroup.dataset.when = TEMPORAL_MODES.ABSOLUTO;
        this._startInput = this._datetimeInput(this._pending.inicio, (epoch) => {
            this._pending.inicio = epoch;
        });
        absGroup.appendChild(
            this._field('Início do mapa', 'Deixe em branco para usar o início automático das feições.', this._startInput)
        );
        this._endInput = this._datetimeInput(this._pending.fim, (epoch) => {
            this._pending.fim = epoch;
        });
        absGroup.appendChild(
            this._field('Fim do mapa', 'Deixe em branco para usar o fim automático das feições.', this._endInput)
        );
        body.appendChild(absGroup);

        // Relative group: offsets around an optional D-Day origin.
        const relGroup = document.createElement('div');
        relGroup.className = 'temporal-settings-group';
        relGroup.dataset.when = TEMPORAL_MODES.RELATIVO;
        relGroup.appendChild(
            this._field('Início', 'Offset da origem (normalmente 0 = D).', this._offsetInput(this._pending.startOffset, (n) => {
                this._pending.startOffset = n;
            }))
        );
        relGroup.appendChild(
            this._field('Fim', 'Ex.: 300 para D+300.', this._offsetInput(this._pending.endOffset, (n) => {
                this._pending.endOffset = n;
            }))
        );
        relGroup.appendChild(
            this._field(
                'Data de D (opcional)',
                'Define a data real de D. Alterá-la desloca as feições junto (mantém o offset).',
                this._datetimeInput(this._pending.dDate, (epoch) => {
                    this._pending.dDate = epoch;
                })
            )
        );
        body.appendChild(relGroup);

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

    _modeSelect() {
        const select = document.createElement('select');
        select.className = 'temporal-settings__select';
        const options = [
            [TEMPORAL_MODES.ABSOLUTO, 'Absoluto (datas reais)'],
            [TEMPORAL_MODES.RELATIVO, 'Relativo (D+N)'],
        ];
        for (const [value, text] of options) {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = text;
            if (value === this._pending.modo) opt.selected = true;
            select.appendChild(opt);
        }
        addDomListener(this, select, 'change', () => {
            this._pending.modo = select.value;
            if (this._body) this._body.dataset.mode = select.value;
        });
        return select;
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
            const letter = unitLetter(select.value);
            this._prefixSpans.forEach((span) => {
                span.textContent = `${letter}+`;
            });
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

    _offsetInput(value, onChange) {
        const wrap = document.createElement('div');
        wrap.className = 'temporal-settings__offset';

        const prefix = document.createElement('span');
        prefix.className = 'temporal-settings__offset-prefix';
        prefix.textContent = `${unitLetter(this._pending.unidade)}+`;
        this._prefixSpans.push(prefix);
        wrap.appendChild(prefix);

        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.className = 'temporal-settings__datetime temporal-settings__offset-input';
        input.value = Number.isFinite(value) ? String(value) : '';
        addDomListener(this, input, 'change', () => {
            const raw = input.value.trim().replace(',', '.');
            onChange(raw === '' ? null : Number(raw));
        });
        wrap.appendChild(input);
        return wrap;
    }

    /** Default relative origin when none is set: resolved timeline start, else today 00:00. */
    _defaultOrigin() {
        const bounds = getControl('TemporalControl')?.getBounds?.();
        if (bounds && Number.isFinite(bounds.inicio)) return bounds.inicio;
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    }

    async _save() {
        const p = this._pending;
        let patch;

        if (p.modo === TEMPORAL_MODES.RELATIVO) {
            const unitMs = unitToMs(p.unidade);
            const origemNew = Number.isFinite(p.dDate)
                ? p.dDate
                : (Number.isFinite(this._original.origem) ? this._original.origem : this._defaultOrigin());
            const start = Number.isFinite(p.startOffset) ? p.startOffset : 0;
            let end = Number.isFinite(p.endOffset) ? p.endOffset : start + 1;
            if (end <= start) end = start + 1;

            // Keep existing features' D+N offset when D moves (only within relative mode).
            if (this._original.modo === TEMPORAL_MODES.RELATIVO && Number.isFinite(this._original.origem)) {
                const delta = origemNew - this._original.origem;
                if (delta !== 0) {
                    try {
                        await getControl('TemporalControl')?.shiftFeatureTimes(delta);
                    } catch (error) {
                        console.warn('Failed to shift feature times:', error);
                    }
                }
            }

            patch = {
                modo: TEMPORAL_MODES.RELATIVO,
                unidade: p.unidade,
                inicio: origemNew + start * unitMs,
                fim: origemNew + end * unitMs,
                origem: origemNew,
            };
        } else {
            patch = {
                modo: TEMPORAL_MODES.ABSOLUTO,
                unidade: p.unidade,
                inicio: p.inicio,
                fim: p.fim,
            };
        }

        try {
            await setMapTemporalConfig(this._mapName, patch);
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
