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
 *
 * THREE DECISIONS OF THIS MODAL LIVE OUTSIDE IT, in `temporal-settings.model.js` (pure, node
 * testable) and in `store/temporal.operations.js` (`rescheduleMapTemporal`). It is where the
 * window validation and the "did Reagendar earn the right to move the D-Day" rule belong: both
 * were wrong here, and neither had a test, because reaching this file needs a DOM and the store
 * barrel. What is left here is the screen: reading the inputs, saying the sentence, closing or
 * NOT closing.
 *
 * A REFUSED WRITE DOES NOT CLOSE THE MODAL. `setMapTemporalConfig` answers an expected refusal
 * (role too low, map locked) with `null` and never throws, so the old `_save` closed exactly like
 * a successful save and the person watched their settings evaporate. The blocked toast is written
 * by the global listener (`store/store-error-listener.js`); what this file owes is to keep the
 * screen open so the sentence lands on something.
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement,
} from '../utilities/event-cleanup.js';
import { getMapTemporalConfig, setMapTemporalConfig, getControl } from '../store';
// By FILE, not through the barrel above: `rescheduleMapTemporal` is not re-exported by
// `store/store.js` (that file is outside this change), and a store module is imported by file
// anyway. No extra weight: the barrel is already in this module's graph, one line up.
import { rescheduleMapTemporal } from '../store/temporal.operations.js';
import { showConfirm } from '../modals/index.js';
import { showSuccess, showWarning, showToast } from '../utilities/index.js';
import { TEMPORAL_UNIT_KEYS, TEMPORAL_UNITS, TEMPORAL_MODES } from './temporal.constants.js';
import { resolverPatchDaConfig, avisoDoReagendamento, pendenteSobreAAtual, patchSoDoQueMudou } from './temporal-settings.model.js';
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
        this._opened = null;
        this._body = null;
        this._prefixSpans = [];
        /**
         * TRUE WHILE A CHILD CONFIRMATION OR A WRITE IS IN FLIGHT. It is what keeps Escape (and
         * the X, Cancel and backdrop gestures) from tearing the modal down under an await: the
         * old `_close` nulled `this._overlay` inside a 200 ms timer, so a reschedule that
         * finished afterwards dereferenced null, and with the `showConfirm` open one Escape
         * closed BOTH dialogs at once (C12).
         */
        this._busy = false;
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
        // The whole config as read now: at save, a field is the person's only if it differs from
        // this, and every other field is taken from the config as stored then (a colleague's).
        this._opened = { ...config };

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
        addDomListener(this, closeBtn, 'click', () => this._requestClose());
        header.appendChild(closeBtn);
        container.appendChild(header);

        // Body (scrollable)
        const body = document.createElement('div');
        body.className = 'modal-body temporal-settings-body';
        body.dataset.mode = this._pending.modo;
        this._body = body;

        body.appendChild(
            this._field('Modo', 'Datas reais (absoluto) ou contagem militar D+N (relativo).', this._modeSelect())
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
            this._field('Início', 'Deslocamento a partir do Dia D (normalmente 0).', this._relativeOffsetField('inicio'))
        );
        relGroup.appendChild(
            this._field('Fim', 'Ex.: 300 para D+300.', this._relativeOffsetField('fim'))
        );
        this._dDateInput = this._datetimeInput(this._pending.dDate, (epoch) => {
            // Pure lens: keep the absolute bounds, just re-label the D+N axis.
            this._pending.dDate = epoch;
            this._refreshOffsetInputs();
        });
        relGroup.appendChild(
            this._field(
                'Data de D (origem)',
                'Só muda o rótulo D+N da régua; as feições não se movem. Para movê-las, use "Reagendar".',
                this._dDateInput
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
        addDomListener(this, cancelBtn, 'click', () => this._requestClose());
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
            if (e.target === this._overlay) this._requestClose();
        });
        // LISTENER EM `document`, E POR ISSO ELE PRECISA DO FREIO. Ele continua vivo enquanto o
        // `showConfirm` do Reagendar está aberto (a confirmação também escuta `document`), então
        // sem `_busy` um Escape fechava os DOIS diálogos de uma vez, e um Escape durante o
        // reagendamento derrubava o modal por baixo do await.
        addDomListener(this, document, 'keydown', (e) => {
            if (e.key === 'Escape') this._requestClose();
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
        if (this._busy) return;
        if (!Number.isFinite(newD)) {
            showWarning('Informe a nova data do Dia D para reagendar.');
            return;
        }
        // O FREIO COBRE TODO O TRECHO ASSÍNCRONO, e não só a escrita: um Escape entre dois awaits
        // quaisquer derrubava o modal por baixo do resto do gesto, e com o `showConfirm` aberto
        // ele fechava os DOIS diálogos.
        this._busy = true;
        try {
            const cfg = await getMapTemporalConfig(this._mapName);
            const refD = Number.isFinite(cfg.origem) ? cfg.origem : this._defaultOrigin();
            const delta = newD - refD;
            if (delta === 0) {
                showToast('A data do Dia D não mudou. Não há nada a reagendar.', 'info');
                return;
            }

            const confirmed = await showConfirm('Reagendar todas as feições?', {
                message:
                    'As feições temporais e as trajetórias passam para o novo Dia D. Os valores D+N não mudam; as datas, sim.\n' +
                    'Esta ação não pode ser desfeita.',
                confirmText: 'Reagendar',
            });
            if (!confirmed) return;

            // UM LOTE LÓGICO, E A ORIGEM SÓ ANDA SE AS FEIÇÕES ANDARAM: as duas regras moram na op
            // de store, que é quem conhece `withGestureBatch` e quem lê o retorno do deslocamento.
            const control = getControl('TemporalControl');
            const { decisao, gravou } = await rescheduleMapTemporal(this._mapName, {
                delta,
                novaOrigem: newD,
                deslocarFeicoes: control ? (d) => control.shiftFeatureTimes(d) : null,
            });
            this._announceReschedule(decisao, gravou);
            // Só fecha quando alguma coisa de fato aconteceu. Fechar numa recusa era o que fazia
            // a tela se comportar igual nos dois desfechos.
            if (gravou === true) this._close();
        } catch (error) {
            console.warn('Failed to reschedule features:', error);
            showWarning('Não foi possível reagendar as feições. Tente de novo.');
        } finally {
            this._busy = false;
        }
    }

    /**
     * Reports what "Reagendar" actually did. It used to announce success no matter what,
     * which is how a refused write looked exactly like a completed one. Zero shifted
     * features has TWO causes and they need different words: the map had nothing timed,
     * or the store refused the write (role too low, or the map is locked).
     *
     * The sentence needs BOTH halves: what the shift did and whether the D-Day was actually
     * stored, because since the config write gained its own lock gate a shift can succeed while
     * the config write is refused. The table itself is pure (`temporal-settings.model.js`).
     *
     * @param {{gravarOrigem: boolean, motivo: string, reagendadas: number}} decisao
     * @param {boolean|null} gravou - Whether the config write happened (null = not attempted).
     */
    _announceReschedule(decisao, gravou) {
        const { tipo, texto } = avisoDoReagendamento(decisao, { gravou });
        if (tipo === 'success') showSuccess(texto);
        else if (tipo === 'warning') showWarning(texto);
        else showToast(texto, 'info');
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
        if (this._busy) return;
        // Rebased over the config as stored NOW: the fields the person did not touch take a
        // colleague's value saved while this dialog was open (`pendenteSobreAAtual`).
        const atual = await getMapTemporalConfig(this._mapName);
        const p = pendenteSobreAAtual(this._pending, this._opened, atual);

        // A JANELA É VALIDADA NOS DOIS MODOS, E A INVERSÃO É RECUSADA, NÃO CONSERTADA. O relativo
        // empurrava o fim para `inicio + unidade` em silêncio (a pessoa salvava uma janela que
        // nunca tinha pedido) e o absoluto gravava cru, e uma janela invertida gravada faz a
        // feição sumir do 3D, do 360 e da legenda do PDF, porque nenhum cursor passa no predicado.
        const veredito = resolverPatchDaConfig(p, {
            origemFallback: Number.isFinite(atual?.origem)
                ? atual.origem
                : this._defaultOrigin(),
            unitMs: unitToMs(p.unidade),
        });
        if (!veredito.ok) {
            showWarning(veredito.mensagem);
            this._focusField(veredito.campo);
            return;
        }

        this._busy = true;
        try {
            // `null` É RECUSA ESPERADA, NÃO EXCEÇÃO (papel insuficiente, ou mapa travado desde
            // 2026-09-21): a frase já vem do ouvinte global de `STORE_OPERATION_BLOCKED`, e o que
            // falta é não fechar a tela como se tivesse salvo.
            const patch = patchSoDoQueMudou(veredito.patch, atual);
            if (Object.keys(patch).length > 0) {
                const config = await setMapTemporalConfig(this._mapName, patch);
                if (config === null) return;
            }
        } catch (error) {
            console.warn('Failed to persist temporal settings:', error);
            showWarning('Não foi possível salvar a linha do tempo. Tente de novo.');
            return;
        } finally {
            this._busy = false;
        }
        this._close();
    }

    /**
     * Puts the caret back on the field the refusal named, in whichever group is on screen.
     * @param {string} campo - 'fim' | 'origem'
     * @private
     */
    _focusField(campo) {
        const relativo = this._pending?.modo === TEMPORAL_MODES.RELATIVO;
        const alvo = campo === 'fim'
            ? (relativo ? this._endOffsetInput : this._endInput)
            : this._dDateInput;
        alvo?.focus?.();
    }

    /**
     * A close asked for by a GESTURE (Escape, backdrop, X, Cancel), which is refused while a
     * child confirmation or a write is in flight. {@link _close} is the teardown itself and stays
     * callable from the code paths that know they are done.
     * @private
     */
    _requestClose() {
        if (this._busy) return;
        this._close();
    }

    /**
     * IDEMPOTENTE E À PROVA DE NULO. A versão anterior desreferenciava `this._overlay` na entrada
     * e o zerava DENTRO do timer de 200 ms, então dois gestos na mesma janela (ou um await
     * terminando depois de um Escape) batiam em nulo. O overlay é capturado e o campo é zerado
     * IMEDIATAMENTE, que é o que torna a segunda chamada inofensiva sem esperar o timer.
     * @private
     */
    _close() {
        const overlay = this._overlay;
        if (!overlay) return;
        this._overlay = null;
        overlay.dataset.visible = 'false';
        setTimeout(() => {
            cleanup(this);
            removeElement(overlay);
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
