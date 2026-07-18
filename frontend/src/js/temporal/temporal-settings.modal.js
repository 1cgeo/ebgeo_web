// Path: js/temporal/temporal-settings.modal.js

/**
 * @fileoverview Per-map temporal settings modal: division unit (MINUTO / HORA /
 * DIA / SEMANA), reference mode (absolute real dates vs relative military D+N),
 * and the map-wide timeline bounds. In absolute mode the bounds are real
 * start/end datetimes; in relative mode they are unit offsets (Início/Fim) around
 * an optional "Data de D" origin. Edits are buffered and committed on "Salvar"
 * (via setMapTemporalConfig, which emits TEMPORAL_CONFIG_CHANGED so the controller
 * re-syncs); "Cancelar" discards them.
 *
 * Canonical model: feature times are absolute epoch ms; `modo`, `unidade` and
 * `origem` are pure display lenses that NEVER mutate feature data. The map bounds
 * are stored absolute, so changing the unit or the D-origin only re-labels the
 * D+N axis (the offset inputs recompute) — it does not move features or rescale
 * the absolute window. Moving features in time is a separate, explicit action:
 * "Reagendar" shifts every feature/trajectory by a deliberate delta (confirmed).
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement,
} from '../utilities/event-cleanup.js';
import { getMapTemporalConfig, setMapTemporalConfig, getControl } from '../store';
import { showConfirm } from '../modals/index.js';
import { showSuccess, showWarning, showToast } from '../utilities/index.js';
import { TEMPORAL_UNIT_KEYS, TEMPORAL_UNITS, TEMPORAL_MODES } from './temporal.constants.js';
import {
    epochToDatetimeLocal,
    datetimeLocalToEpoch,
    unitToMs,
    unitLetter,
    epochToOffset,
    offsetToEpoch,
} from './temporal.utils.js';

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
        const origem = Number.isFinite(config.origem) ? config.origem : null;

        this._pending = {
            modo: config.modo || TEMPORAL_MODES.ABSOLUTO,
            unidade: config.unidade,
            // Absolute bounds (epoch ms) are the source of truth in both modes; the
            // relative offset inputs are just a lens derived from these + dDate.
            inicio: config.inicio,
            fim: config.fim,
            dDate: origem, // display anchor (D); null until set
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
            this._field('Início', 'Offset da origem (normalmente 0 = D).', this._relativeOffsetField('inicio'))
        );
        relGroup.appendChild(
            this._field('Fim', 'Ex.: 300 para D+300.', this._relativeOffsetField('fim'))
        );
        relGroup.appendChild(
            this._field(
                'Data de D (origem)',
                'Apenas a referência de exibição do D+N. NÃO move as feições — só rotula a régua. Para mover, use "Reagendar".',
                this._datetimeInput(this._pending.dDate, (epoch) => {
                    // Pure lens: keep the absolute bounds, just re-label the D+N axis.
                    this._pending.dDate = epoch;
                    this._refreshOffsetInputs();
                })
            )
        );
        relGroup.appendChild(this._rescheduleField());
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
            // Re-sync the now-visible group's inputs with the shared absolute bounds.
            if (select.value === TEMPORAL_MODES.RELATIVO) this._refreshOffsetInputs();
            else this._refreshAbsoluteInputs();
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
            // Unit is a display lens too: keep the absolute bounds, relabel the offsets.
            this._refreshOffsetInputs();
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

    /** Anchor used to convert between absolute bounds and displayed D+N offsets. */
    _effectiveAnchor() {
        return Number.isFinite(this._pending.dDate) ? this._pending.dDate : this._defaultOrigin();
    }

    /** Current offset (in units) shown for a bound, derived from the absolute value. */
    _offsetDisplay(which) {
        const anchor = this._effectiveAnchor();
        const abs = which === 'inicio'
            ? (Number.isFinite(this._pending.inicio) ? this._pending.inicio : anchor)
            : (Number.isFinite(this._pending.fim) ? this._pending.fim : anchor + 30 * unitToMs(this._pending.unidade));
        const n = epochToOffset(abs, anchor, this._pending.unidade);
        return n === null ? '' : String(Math.round(n * 100) / 100);
    }

    /** Writes an edited offset back to the absolute bound (offset is just the lens). */
    _setOffset(which, n) {
        const abs = offsetToEpoch(n, this._effectiveAnchor(), this._pending.unidade);
        if (abs === null) return;
        if (which === 'inicio') this._pending.inicio = abs;
        else this._pending.fim = abs;
    }

    /** Re-renders both offset inputs from the (unchanged) absolute bounds. */
    _refreshOffsetInputs() {
        if (this._startOffsetInput) this._startOffsetInput.value = this._offsetDisplay('inicio');
        if (this._endOffsetInput) this._endOffsetInput.value = this._offsetDisplay('fim');
    }

    /** Re-renders the absolute datetime inputs from the shared absolute bounds. */
    _refreshAbsoluteInputs() {
        if (this._startInput) {
            this._startInput.value = Number.isFinite(this._pending.inicio) ? epochToDatetimeLocal(this._pending.inicio) : '';
        }
        if (this._endInput) {
            this._endInput.value = Number.isFinite(this._pending.fim) ? epochToDatetimeLocal(this._pending.fim) : '';
        }
    }

    _relativeOffsetField(which) {
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
        input.value = this._offsetDisplay(which);
        addDomListener(this, input, 'change', () => {
            const raw = input.value.trim().replace(',', '.');
            this._setOffset(which, raw === '' ? null : Number(raw));
        });
        wrap.appendChild(input);

        if (which === 'inicio') this._startOffsetInput = input;
        else this._endOffsetInput = input;
        return wrap;
    }

    /** Builds the explicit "Reagendar" action (deliberate bulk time shift). */
    _rescheduleField() {
        const field = document.createElement('div');
        field.className = 'settings-field temporal-settings-field';

        const label = document.createElement('div');
        label.className = 'settings-field__label';
        label.textContent = 'Reagendar feições';
        field.appendChild(label);

        const desc = document.createElement('div');
        desc.className = 'settings-field__description';
        desc.textContent =
            'Move todas as feições e trajetórias no tempo para que o Dia D caia em outra data real, mantendo os offsets D+N. Use ao reprogramar a operação.';
        field.appendChild(desc);

        const row = document.createElement('div');
        row.className = 'temporal-settings-reschedule__row';

        const input = document.createElement('input');
        input.type = 'datetime-local';
        input.className = 'temporal-settings__datetime';
        input.value = Number.isFinite(this._pending.dDate) ? epochToDatetimeLocal(this._pending.dDate) : '';
        row.appendChild(input);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'temporal-settings-btn temporal-settings-btn--save';
        btn.textContent = 'Reagendar';
        addDomListener(this, btn, 'click', () => this._rescheduleFeatures(datetimeLocalToEpoch(input.value)));
        row.appendChild(btn);

        field.appendChild(row);
        return field;
    }

    /**
     * Deliberately shifts every feature/trajectory in time so D falls on `newD`,
     * keeping their D+N offsets (the absolute dates move). Confirmed; not undoable.
     * @param {number|null} newD - New real date for D (epoch ms).
     */
    async _rescheduleFeatures(newD) {
        if (!Number.isFinite(newD)) {
            showWarning('Informe a nova data do Dia D para reagendar.');
            return;
        }
        const cfg = await getMapTemporalConfig(this._mapName);
        const refD = Number.isFinite(cfg.origem) ? cfg.origem : this._defaultOrigin();
        const delta = newD - refD;
        if (delta === 0) {
            showToast('A data do Dia D não mudou — nada a reagendar.', 'info');
            return;
        }

        const confirmed = await showConfirm('Reagendar todas as feições?', {
            message:
                'As feições temporais e trajetórias serão deslocadas no tempo para o novo Dia D.\n' +
                'Os offsets D+N são mantidos; as datas reais mudam. Esta ação não pode ser desfeita.',
            confirmText: 'Reagendar',
        });
        if (!confirmed) return;

        try {
            // Shift features (store + live), then persist the moved origin/bounds so
            // the D+N picture is identical and the controller re-syncs once.
            await getControl('TemporalControl')?.shiftFeatureTimes(delta);
            await setMapTemporalConfig(this._mapName, {
                origem: newD,
                inicio: Number.isFinite(cfg.inicio) ? cfg.inicio + delta : cfg.inicio,
                fim: Number.isFinite(cfg.fim) ? cfg.fim + delta : cfg.fim,
            });
            showSuccess('Feições reagendadas para o novo Dia D.');
        } catch (error) {
            console.warn('Failed to reschedule features:', error);
            showWarning('Falha ao reagendar as feições.');
        }
        this._close();
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
            const origem = Number.isFinite(p.dDate)
                ? p.dDate
                : (Number.isFinite(this._original.origem) ? this._original.origem : this._defaultOrigin());
            // Bounds are absolute (offset edits already wrote them); default a window
            // when unset. Changing the origin/unit is a PURE LENS here — features are
            // never shifted. Use the explicit "Reagendar" action to move them in time.
            const inicio = Number.isFinite(p.inicio) ? p.inicio : origem;
            let fim = Number.isFinite(p.fim) ? p.fim : origem + 30 * unitMs;
            if (fim <= inicio) fim = inicio + unitMs;

            patch = {
                modo: TEMPORAL_MODES.RELATIVO,
                unidade: p.unidade,
                inicio,
                fim,
                origem,
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
