// Path: js/temporal/temporal-attributes-section.js

/**
 * @fileoverview Attribute-panel sections for the Temporal Module:
 *  - a "Validade temporal" section (temporalInicio/temporalFim) for ALL feature
 *    types;
 *  - a "Trajetória" section (launch the map editor + clear) only for
 *    point / military_symbol / coordination_measure.
 *
 * Times are entered as an exact date (datetime-local) OR as a unit offset. In
 * relative mode the input is always an offset (D+N); in absolute mode each field
 * has a ⇄ toggle between exact date and offset. Either way the stored value is an
 * epoch ms (offsets are resolved against the active time context's anchor).
 *
 * Both self-persist on change (live source via the control, store via
 * updateFeatureProperty) and ask the TemporalController to re-apply render.
 */

import { getControl, getEventBus, updateFeatureProperty, getStorageTypeFromSource, getMapTemporalConfigSync } from '@store';
import { EventTypes } from '@events/event_types.js';
import {
    epochToDatetimeLocal,
    datetimeLocalToEpoch,
    epochToOffset,
    offsetToEpoch,
    unitLetter,
    formatTimelineLabel,
    formatDTG,
} from './temporal.utils.js';
import { normalizeTrajectory, trajectoryStats } from './temporal-model.js';
import {
    TRAJECTORY_FEATURE_TYPES,
    TRAJECTORY_TYPE_TO_SOURCE,
    TEMPORAL_MODES,
} from './temporal.constants.js';
import { updateSourceFeatureProperty } from './temporal-render.service.js';

/**
 * Resolves the active map's time context for input rendering/conversion.
 * `anchor` is the epoch that offset 0 maps to: the relative origin (D) in
 * relative mode, otherwise the resolved timeline start (for absolute offsets).
 * @returns {{modo: string, origem: (number|null), unidade: string, anchor: (number|null)}}
 */
export function getActiveTimeContext() {
    const cfg = getMapTemporalConfigSync();
    const bounds = getControl('TemporalControl')?.getBounds?.() || null;
    // Timeline window (temporal-bar start/end): the resolved bounds, falling back to
    // the configured início/fim. Exposed so date pickers can highlight the window.
    const inicio = bounds && Number.isFinite(bounds.inicio)
        ? bounds.inicio
        : (Number.isFinite(cfg.inicio) ? cfg.inicio : null);
    const fim = bounds && Number.isFinite(bounds.fim)
        ? bounds.fim
        : (Number.isFinite(cfg.fim) ? cfg.fim : null);
    const anchor = cfg.modo === TEMPORAL_MODES.RELATIVO
        ? (Number.isFinite(cfg.origem) ? cfg.origem : inicio)
        : inicio;
    return { modo: cfg.modo, origem: cfg.origem, unidade: cfg.unidade, anchor, inicio, fim };
}

/**
 * Re-renders a temporal section whenever the active map's time lens changes
 * (mode/unit/origin), so an open attribute panel reflects timeline-bar edits
 * live. The lens never mutates feature times — only how they're displayed/entered
 * (offset vs date, unit letter), so a rebuild is all that's needed. The
 * subscription self-removes once `host` leaves the DOM (panel closed or rebuilt),
 * since these presentation-only sections expose no explicit cleanup hook.
 * @param {HTMLElement} host - The section element (doubles as the liveness probe).
 * @param {() => void} render - Rebuilds the section's body from current state.
 */
function bindTimeContextRerender(host, render) {
    let bus;
    try {
        bus = getEventBus();
    } catch {
        bus = null;
    }
    if (!bus) return;
    const unsubs = [];
    const handler = () => {
        if (!host.isConnected) {
            unsubs.forEach((off) => off());
            unsubs.length = 0;
            return;
        }
        render();
    };
    unsubs.push(bus.on(EventTypes.TEMPORAL_CONFIG_CHANGED, handler));
    unsubs.push(bus.on(EventTypes.MAP_TEMPORAL_CHANGED, handler));
}

/**
 * Builds the temporal validity section (start/end datetime).
 * @param {Object} opts
 * @param {Object} opts.feature - The single selected feature.
 * @param {string} opts.featureType - Feature type (source string).
 * @param {Array} opts.selectedFeatures - Selected features (for the live control update).
 * @param {Object} opts.control - The feature type's control (live source update).
 * @returns {HTMLElement}
 */
export function createTemporalAttributesSection({ feature, featureType, selectedFeatures, control }) {
    return createTemporalValiditySection({
        inicio: feature.properties?.temporalInicio,
        fim: feature.properties?.temporalFim,
        onChange: (prop, epoch) => {
            const value = Number.isFinite(epoch) ? epoch : null;
            control?.updateFeaturesProperty?.(selectedFeatures, prop, value);
            // updateFeatureProperty keys by STORAGE type ('points'), not the source
            // type ('point') the panel passes — convert or the store write silently fails.
            updateFeatureProperty(getStorageTypeFromSource(featureType), feature.properties.id, prop, value);
            if (feature.properties) feature.properties[prop] = value;
            // Keep a linked DTG/GDH amplifier in sync with the temporal window.
            deriveDtgFields(feature, featureType);
            getControl('TemporalControl')?.sync();
        },
    });
}

/**
 * Presentation-only "Validade temporal" section (title + hint + start/end
 * rows). Shared by the 2D feature panel and the 3D/360 marker panels — each
 * supplies only its own persistence callback. The time context defaults to the
 * active map (so 3D/360 callers need no extra wiring).
 * @param {Object} opts
 * @param {number} [opts.inicio] - Current temporalInicio (epoch ms).
 * @param {number} [opts.fim] - Current temporalFim (epoch ms).
 * @param {(prop: ('temporalInicio'|'temporalFim'), epoch: (number|null)) => void} opts.onChange
 * @param {Object} [opts.timeContext] - Override the active time context (testing).
 * @returns {HTMLElement}
 */
export function createTemporalValiditySection({ inicio, fim, onChange, timeContext }) {
    const section = document.createElement('div');
    section.className = 'temporal-attr-section';

    // Live snapshot of the two times so a lens-change rebuild keeps any edits made
    // in this panel (the inputs are recreated, but the values must persist).
    const times = {
        temporalInicio: Number.isFinite(inicio) ? inicio : null,
        temporalFim: Number.isFinite(fim) ? fim : null,
    };

    const handleChange = (prop, epoch) => {
        times[prop] = Number.isFinite(epoch) ? epoch : null;
        onChange(prop, times[prop]);
    };

    const renderBody = () => {
        const ctx = timeContext || getActiveTimeContext();
        section.replaceChildren();

        const title = document.createElement('div');
        title.className = 'temporal-attr-section__title';
        title.textContent = 'Validade temporal';
        section.appendChild(title);

        const hint = document.createElement('div');
        hint.className = 'temporal-attr-section__hint';
        hint.textContent = 'Em branco = permanente (visível em qualquer instante).';
        section.appendChild(hint);

        section.appendChild(
            buildTimeRow({ labelText: 'Início', epoch: times.temporalInicio, timeContext: ctx, onChange: (epoch) => handleChange('temporalInicio', epoch) })
        );
        section.appendChild(
            buildTimeRow({ labelText: 'Fim', epoch: times.temporalFim, timeContext: ctx, onChange: (epoch) => handleChange('temporalFim', epoch) })
        );
    };

    renderBody();

    // Reflect timeline-bar lens changes (mode/unit/origin) live. A fixed timeContext
    // (explicit caller / tests) opts out, since there's no active map to track.
    if (!timeContext) bindTimeContextRerender(section, renderBody);

    return section;
}

/**
 * Read-only temporal summary for the locked-map feature panel: the validity
 * window (Início/Fim) plus a one-line trajectory summary, formatted under the
 * active time lens. Returns null when the feature carries no temporal data, so the
 * caller renders nothing for purely-spatial features.
 * @param {Object} opts
 * @param {Object} opts.feature - The single selected feature.
 * @returns {HTMLElement|null}
 */
export function createTemporalReadonlySection({ feature }) {
    const p = feature?.properties || {};
    const hasInicio = Number.isFinite(p.temporalInicio);
    const hasFim = Number.isFinite(p.temporalFim);
    const waypoints = normalizeTrajectory(p.trajetoria);
    const hasTrajectory = waypoints.length > 0;
    if (!hasInicio && !hasFim && !hasTrajectory) return null;

    const section = document.createElement('div');
    section.className = 'temporal-attr-section temporal-attr-section--readonly';

    const render = () => {
        const ctx = getActiveTimeContext();
        section.replaceChildren();

        const title = document.createElement('div');
        title.className = 'temporal-attr-section__title';
        title.textContent = 'Temporal';
        section.appendChild(title);

        // Validity window (em-dash when one bound is open / permanent).
        if (hasInicio || hasFim) {
            section.appendChild(buildReadonlyRow('Início', hasInicio ? formatTimelineLabel(p.temporalInicio, ctx) : '—'));
            section.appendChild(buildReadonlyRow('Fim', hasFim ? formatTimelineLabel(p.temporalFim, ctx) : '—'));
        }

        // Trajectory summary: point count + span · total distance · average speed.
        if (hasTrajectory) {
            section.appendChild(buildReadonlyRow('Trajetória', `${waypoints.length} ponto(s)`));
            const s = trajectoryStats(waypoints);
            if (s.count >= 2) {
                const span = `${formatTimelineLabel(waypoints[0].t, ctx)} → ${formatTimelineLabel(waypoints[s.count - 1].t, ctx)}`;
                const parts = [span, formatDistance(s.distanceMeters)];
                const speed = formatSpeed(s.distanceMeters, s.durationMs);
                if (speed) parts.push(speed);
                const statsEl = document.createElement('div');
                statsEl.className = 'temporal-trajectory-stats';
                statsEl.textContent = parts.join(' · ');
                section.appendChild(statsEl);
            }
        }
    };

    render();
    // Reflect timeline-bar lens changes (mode/unit/origin) live, like the editable sections.
    bindTimeContextRerender(section, render);

    return section;
}

/** A read-only label/value row for the locked temporal summary. */
function buildReadonlyRow(labelText, valueText) {
    const row = document.createElement('div');
    row.className = 'temporal-attr-row temporal-attr-row--readonly';

    const label = document.createElement('span');
    label.className = 'temporal-attr-row__label';
    label.textContent = labelText;
    row.appendChild(label);

    const value = document.createElement('span');
    value.className = 'temporal-attr-row__value';
    value.textContent = valueText;
    row.appendChild(value);

    return row;
}

/**
 * A labelled time row (label + swappable date/offset field).
 * @param {{labelText: string, epoch: (number|undefined), onChange: (epoch:(number|null))=>void, timeContext: Object}} opts
 * @returns {HTMLElement}
 */
function buildTimeRow({ labelText, epoch, onChange, timeContext }) {
    const row = document.createElement('div');
    row.className = 'temporal-attr-row';

    const label = document.createElement('label');
    label.className = 'temporal-attr-row__label';
    label.textContent = labelText;
    row.appendChild(label);

    row.appendChild(buildTimeField({ epoch, onChange, timeContext }));
    return row;
}

/**
 * The swappable time field. Relative mode: offset input only. Absolute mode:
 * datetime-local by default with a ⇄ toggle to a unit-offset input (when an
 * anchor exists). Always emits an epoch ms (or null) through onChange.
 * @param {{epoch: (number|undefined), onChange: (epoch:(number|null))=>void, timeContext: Object}} opts
 * @returns {HTMLElement}
 */
function buildTimeField({ epoch, onChange, timeContext }) {
    const ctx = timeContext || {};
    const isRelative = ctx.modo === TEMPORAL_MODES.RELATIVO;
    const canOffset = Number.isFinite(ctx.anchor);

    let current = Number.isFinite(epoch) ? epoch : null;
    let offsetView = isRelative;

    const field = document.createElement('div');
    field.className = 'temporal-attr-row__field';

    const emit = (value) => {
        current = Number.isFinite(value) ? value : null;
        onChange(current);
    };

    const render = () => {
        field.replaceChildren();
        field.appendChild(
            offsetView ? buildOffsetInput(current, ctx, emit) : buildDatetimeInput(current, emit, ctx)
        );
        // Toggle only in absolute mode and only when offsets can be resolved.
        if (!isRelative && canOffset) {
            field.appendChild(
                buildSwapBtn(offsetView, () => {
                    offsetView = !offsetView;
                    render();
                })
            );
        }
    };

    render();
    return field;
}

function buildDatetimeInput(epoch, emit, timeContext) {
    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.className = 'temporal-attr-row__input';
    input.value = Number.isFinite(epoch) ? epochToDatetimeLocal(epoch) : '';
    // Highlight the temporal-bar window in the native calendar: bound selectable
    // dates to [início, fim] so the timeline start/end stand out while picking.
    const ctx = timeContext || {};
    if (Number.isFinite(ctx.inicio)) input.min = epochToDatetimeLocal(ctx.inicio);
    if (Number.isFinite(ctx.fim)) input.max = epochToDatetimeLocal(ctx.fim);
    input.addEventListener('change', () => emit(datetimeLocalToEpoch(input.value)));
    return input;
}

function buildOffsetInput(epoch, ctx, emit) {
    const { unidade, anchor } = ctx;
    const wrap = document.createElement('div');
    wrap.className = 'temporal-attr-offset';

    const prefix = document.createElement('span');
    prefix.className = 'temporal-attr-offset__prefix';
    prefix.textContent = `${unitLetter(unidade)}+`;
    wrap.appendChild(prefix);

    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.className = 'temporal-attr-row__input temporal-attr-offset__input';
    input.title = `Offset em ${unitLetter(unidade)} a partir da origem (use negativo para antes)`;
    const off = epochToOffset(epoch, anchor, unidade);
    input.value = off === null ? '' : String(Math.round(off * 100) / 100);
    input.addEventListener('change', () => {
        const raw = input.value.trim();
        if (raw === '') {
            emit(null);
            return;
        }
        const n = Number(raw.replace(',', '.'));
        emit(Number.isFinite(n) ? offsetToEpoch(n, anchor, unidade) : null);
    });
    wrap.appendChild(input);
    return wrap;
}

function buildSwapBtn(offsetView, onToggle) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'temporal-attr-row__swap';
    btn.textContent = '⇄';
    btn.title = offsetView ? 'Usar data exata' : 'Usar offset na unidade';
    btn.setAttribute('aria-label', btn.title);
    btn.addEventListener('click', onToggle);
    return btn;
}

/** Formats a path length: metres under 1 km, otherwise km (pt-BR comma). */
function formatDistance(meters) {
    if (!Number.isFinite(meters) || meters <= 0) return '0 m';
    if (meters < 1000) return `${Math.round(meters)} m`;
    const km = meters / 1000;
    return `${km.toFixed(km < 10 ? 2 : 1).replace('.', ',')} km`;
}

/**
 * Average speed (pt-BR comma), or null when undefined (no duration/distance). Uses
 * adaptive precision so slow tracks don't collapse to "0,0 km/h": more decimals
 * under 10 km/h, and m/s once even two decimals of km/h would round to zero.
 */
function formatSpeed(meters, durationMs) {
    if (!(durationMs > 0) || !(meters > 0)) return null;
    const mps = meters / (durationMs / 1000);
    const kmh = mps * 3.6;
    if (kmh >= 10) return `${kmh.toFixed(1).replace('.', ',')} km/h`;
    if (kmh >= 0.1) return `${kmh.toFixed(2).replace('.', ',')} km/h`;
    return `${mps.toFixed(mps >= 1 ? 1 : 2).replace('.', ',')} m/s`;
}

/** Registry name of the symbol control that owns each trajectory-capable type. */
const SYMBOL_CONTROL_BY_TYPE = {
    military_symbol: 'AddMilitarySymbolControl',
    coordination_measure: 'AddCoordinationMeasureControl',
};

/** Writes a property to the live symbol source (regenerating) and the store. */
function persistSymbolProperty(feature, featureType, prop, value) {
    getControl(SYMBOL_CONTROL_BY_TYPE[featureType])?.updateFeaturesProperty?.([feature], prop, value);
    updateFeatureProperty(getStorageTypeFromSource(featureType), feature.properties.id, prop, value);
}

/**
 * Derives the DTG / GDH amplifier(s) from the feature's temporal window when the
 * `autoDtg` binding is on: military `dateTimeGroup`, or coordination `gdhIni`/`gdhFim`.
 */
function deriveDtgFields(feature, featureType) {
    const p = feature.properties || {};
    if (p.autoDtg !== true) return;
    if (featureType === 'military_symbol') {
        if (Number.isFinite(p.temporalInicio)) {
            persistSymbolProperty(feature, featureType, 'dateTimeGroup', formatDTG(p.temporalInicio, 'military'));
        }
    } else if (featureType === 'coordination_measure') {
        if (Number.isFinite(p.temporalInicio)) {
            persistSymbolProperty(feature, featureType, 'gdhIni', formatDTG(p.temporalInicio, 'coordination'));
        }
        if (Number.isFinite(p.temporalFim)) {
            persistSymbolProperty(feature, featureType, 'gdhFim', formatDTG(p.temporalFim, 'coordination'));
        }
    }
}

/**
 * Builds the "Vínculos automáticos" toggles for symbol types: opt-in derivation of
 * direction/speed (dynamic, from the trajectory at the cursor) and DTG/GDH (from the
 * temporal window). Non-destructive — off by default.
 * @returns {HTMLElement|null}
 */
function buildAutoBindings(feature, featureType) {
    const defs = featureType === 'military_symbol'
        ? [
            ['autoDirection', 'Direção automática (azimute da trajetória)'],
            ['autoSpeed', 'Velocidade automática (da trajetória)'],
            ['autoDtg', 'GDH automático (da validade temporal)'],
        ]
        : featureType === 'coordination_measure'
            ? [['autoDtg', 'GDH Início/Fim automático (da validade temporal)']]
            : [];
    if (defs.length === 0) return null;

    // GDH is an absolute date-time group, so auto-deriving it makes no sense under
    // the relative (D+N) lens — disable that one binding while in relative mode.
    const isRelative = getActiveTimeContext().modo === TEMPORAL_MODES.RELATIVO;

    const section = document.createElement('div');
    section.className = 'temporal-attr-section';

    const title = document.createElement('div');
    title.className = 'temporal-attr-section__title';
    title.textContent = 'Vínculos automáticos';
    section.appendChild(title);

    const hint = document.createElement('div');
    hint.className = 'temporal-attr-section__hint';
    hint.textContent = 'Derivados da trajetória/tempo durante a reprodução. Editar o campo manualmente substitui o valor.';
    section.appendChild(hint);

    for (const [key, label] of defs) {
        const row = document.createElement('label');
        row.className = 'temporal-auto-binding';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = feature.properties?.[key] === true;

        const dtgDisabled = key === 'autoDtg' && isRelative;
        if (dtgDisabled) {
            cb.disabled = true;
            row.classList.add('temporal-auto-binding--disabled');
            row.title = 'Indisponível no modo relativo (GDH usa data absoluta).';
        }

        cb.addEventListener('change', () => {
            persistSymbolProperty(feature, featureType, key, cb.checked);
            if (key === 'autoDtg' && cb.checked) deriveDtgFields(feature, featureType);
            // Re-sync the symbol image so turning a binding OFF drops its derived
            // modifier (direction/speed) instead of leaving the last value baked in.
            if (featureType === 'military_symbol') {
                getControl('TemporalDerivation')?.reapplyFeature?.(feature.properties?.id);
            }
        });

        const span = document.createElement('span');
        span.textContent = dtgDisabled ? `${label} (somente modo absoluto)` : label;

        row.append(cb, span);
        section.appendChild(row);
    }
    return section;
}

/**
 * Builds the trajectory section for trajectory-capable features: a stats line, a
 * waypoint list (per-point time editing, jump-to-instant, hover-to-highlight,
 * delete), an "Adicionar no mapa" action that launches the map editor, and a
 * "Limpar" action. The list refreshes live while the map editor edits points (via
 * its onChange callback).
 * @param {Object} opts
 * @param {Object} opts.feature - The single selected feature.
 * @param {string} opts.featureType - Feature type (source string).
 * @param {Object} [opts.map] - MapLibre map (for live source updates).
 * @returns {HTMLElement|null} The section, or null for non-trajectory types.
 */
export function createTrajectorySection({ feature, featureType, map }) {
    if (!TRAJECTORY_FEATURE_TYPES.includes(featureType)) return null;

    // Re-read on lens change so waypoint times (offset vs date, unit) stay current.
    let timeContext = getActiveTimeContext();

    const section = document.createElement('div');
    section.className = 'temporal-attr-section';

    const title = document.createElement('div');
    title.className = 'temporal-attr-section__title';
    title.textContent = 'Trajetória';
    section.appendChild(title);

    const info = document.createElement('div');
    info.className = 'temporal-attr-section__hint';
    section.appendChild(info);

    const stats = document.createElement('div');
    stats.className = 'temporal-trajectory-stats';
    stats.hidden = true;
    section.appendChild(stats);

    const list = document.createElement('div');
    list.className = 'temporal-trajectory-list';
    section.appendChild(list);

    const sourceId = TRAJECTORY_TYPE_TO_SOURCE[featureType];

    // Persist the current (in-place mutated) trajectory to the store + live source,
    // re-apply temporal render, and refresh the map trajectory display. Never
    // replaces feature.properties.trajetoria's array reference, so the active map
    // editor (which shares it) stays in sync.
    const persist = () => {
        const sorted = normalizeTrajectory(feature.properties?.trajetoria);
        if (map && sourceId) {
            updateSourceFeatureProperty(map, sourceId, feature.properties.id, 'trajetoria', sorted);
        }
        updateFeatureProperty(getStorageTypeFromSource(featureType), feature.properties.id, 'trajetoria', sorted);
        getControl('TemporalControl')?.sync();
        getControl('TrajectoryEditControl')?.refreshDisplay();
    };

    const renderList = () => {
        list.replaceChildren();
        // Sorted view; objects are shared with feature.properties.trajetoria, so
        // mutating a keypoint's time / splicing by reference updates the source array.
        const waypoints = normalizeTrajectory(feature.properties?.trajetoria);
        info.textContent = waypoints.length === 0
            ? 'Sem trajetória (mudança instantânea). Crie com "Adicionar no mapa" ou arrastando um ponto médio da linha no mapa.'
            : `${waypoints.length} ponto(s) — clique no nº para ir ao instante; arraste, insira (ponto médio) ou remova (botão direito) vértices no mapa.`;
        renderStats(waypoints);
        clearBtn.disabled = waypoints.length === 0;

        waypoints.forEach((kp, index) => list.appendChild(buildWaypointRow(kp, index)));
    };

    /** Compact stats line: time span · total distance · average speed. */
    const renderStats = (waypoints) => {
        const s = trajectoryStats(waypoints);
        if (s.count < 2) {
            stats.hidden = true;
            stats.textContent = '';
            return;
        }
        const span = `${formatTimelineLabel(waypoints[0].t, timeContext)} → ${formatTimelineLabel(waypoints[s.count - 1].t, timeContext)}`;
        const parts = [span, formatDistance(s.distanceMeters)];
        const speed = formatSpeed(s.distanceMeters, s.durationMs);
        if (speed) parts.push(speed);
        stats.textContent = parts.join(' · ');
        stats.hidden = false;
    };

    function buildWaypointRow(kp, index) {
        const row = document.createElement('div');
        row.className = 'temporal-trajectory-row';
        // Hovering a row haloes the matching vertex on the map (panel ↔ map link).
        row.addEventListener('mouseenter', () => getControl('TrajectoryEditControl')?.highlightVertex(index));
        row.addEventListener('mouseleave', () => getControl('TrajectoryEditControl')?.highlightVertex(null));

        const badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'temporal-trajectory-row__badge';
        badge.textContent = String(index + 1);
        badge.title = 'Ir para este instante na linha do tempo';
        badge.setAttribute('aria-label', `Ir para o ponto ${index + 1} na linha do tempo`);
        // Move the timeline cursor to this keypoint's instant (feature jumps there).
        badge.addEventListener('click', () => getControl('TemporalControl')?.setCursor(kp.t));
        row.appendChild(badge);

        const fields = document.createElement('div');
        fields.className = 'temporal-trajectory-row__fields';

        const timeField = buildTimeField({
            epoch: kp.t,
            timeContext,
            onChange: (epoch) => {
                if (epoch === null) return;
                kp.t = epoch; // mutate the shared keypoint object
                persist();
                // Don't renderList() here: re-sorting the rows as the user fills in
                // each date is disorienting. persist() already sorts the stored array;
                // the visible order stabilises on the next full render. Refresh stats only.
                renderStats(normalizeTrajectory(feature.properties?.trajetoria));
            },
        });
        fields.appendChild(timeField);

        const coord = document.createElement('span');
        coord.className = 'temporal-trajectory-row__coord';
        coord.textContent = `${kp.lng.toFixed(5)}, ${kp.lat.toFixed(5)}`;
        fields.appendChild(coord);

        row.appendChild(fields);

        // The first keypoint is the feature's start position (its anchor) and can't
        // be removed; clear the whole trajectory with "Limpar" instead.
        if (index === 0) {
            badge.title = 'Ponto inicial (posição da feição) — não pode ser removido';
            const lock = document.createElement('span');
            lock.className = 'temporal-trajectory-row__anchor';
            lock.textContent = '⚓';
            lock.title = 'Ponto inicial fixo';
            lock.setAttribute('aria-label', 'Ponto inicial fixo');
            row.appendChild(lock);
        } else {
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'temporal-trajectory-row__delete';
            del.title = 'Remover ponto';
            del.setAttribute('aria-label', 'Remover ponto');
            del.textContent = '✕';
            del.addEventListener('click', () => {
                const arr = feature.properties?.trajetoria;
                const i = Array.isArray(arr) ? arr.indexOf(kp) : -1;
                if (i >= 0) arr.splice(i, 1); // mutate in place, keep array reference
                persist();
                renderList();
            });
            row.appendChild(del);
        }

        return row;
    }

    const actions = document.createElement('div');
    actions.className = 'temporal-attr-actions';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'temporal-attr-btn temporal-attr-btn--primary';
    addBtn.textContent = 'Adicionar no mapa';
    addBtn.addEventListener('click', () => {
        getControl('TrajectoryEditControl')?.startAdding();
    });
    actions.appendChild(addBtn);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'temporal-attr-btn';
    clearBtn.textContent = 'Limpar';
    clearBtn.addEventListener('click', () => {
        if (Array.isArray(feature.properties?.trajetoria)) {
            feature.properties.trajetoria.length = 0; // keep array reference
        }
        persist();
        renderList();
    });
    actions.appendChild(clearBtn);

    section.appendChild(actions);

    // Auto-binding toggles (direction/speed/DTG) for symbol types. Hosted in a slot
    // so they rebuild on lens change (the GDH toggle is disabled in relative mode).
    const bindingsSlot = document.createElement('div');
    section.appendChild(bindingsSlot);
    const renderBindings = () => {
        bindingsSlot.replaceChildren();
        const bindings = buildAutoBindings(feature, featureType);
        if (bindings) bindingsSlot.appendChild(bindings);
    };

    renderList();
    renderBindings();

    // Reflect timeline-bar lens changes (mode/unit/origin): re-time the waypoints and
    // re-evaluate the GDH-in-relative-mode gate.
    bindTimeContextRerender(section, () => {
        timeContext = getActiveTimeContext();
        renderList();
        renderBindings();
    });

    // Show this feature's trajectory on the map (path + draggable point markers)
    // while it's selected, with the list as the onChange target.
    getControl('TrajectoryEditControl')?.show(feature, { onChange: renderList });

    return section;
}
