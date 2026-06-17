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

import { getControl, updateFeatureProperty, getMapTemporalConfigSync } from '@store';
import {
    epochToDatetimeLocal,
    datetimeLocalToEpoch,
    epochToOffset,
    offsetToEpoch,
    unitLetter,
    formatTimelineLabel,
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
    const startAnchor = bounds && Number.isFinite(bounds.inicio)
        ? bounds.inicio
        : (Number.isFinite(cfg.inicio) ? cfg.inicio : null);
    const anchor = cfg.modo === TEMPORAL_MODES.RELATIVO
        ? (Number.isFinite(cfg.origem) ? cfg.origem : startAnchor)
        : startAnchor;
    return { modo: cfg.modo, origem: cfg.origem, unidade: cfg.unidade, anchor };
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
            updateFeatureProperty(featureType, feature.properties.id, prop, value);
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
    const ctx = timeContext || getActiveTimeContext();

    const section = document.createElement('div');
    section.className = 'temporal-attr-section';

    const title = document.createElement('div');
    title.className = 'temporal-attr-section__title';
    title.textContent = 'Validade temporal';
    section.appendChild(title);

    const hint = document.createElement('div');
    hint.className = 'temporal-attr-section__hint';
    hint.textContent = 'Em branco = permanente (visível em qualquer instante).';
    section.appendChild(hint);

    section.appendChild(
        buildTimeRow({ labelText: 'Início', epoch: inicio, timeContext: ctx, onChange: (epoch) => onChange('temporalInicio', epoch) })
    );
    section.appendChild(
        buildTimeRow({ labelText: 'Fim', epoch: fim, timeContext: ctx, onChange: (epoch) => onChange('temporalFim', epoch) })
    );
    return section;
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
            offsetView ? buildOffsetInput(current, ctx, emit) : buildDatetimeInput(current, emit)
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

function buildDatetimeInput(epoch, emit) {
    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.className = 'temporal-attr-row__input';
    input.value = Number.isFinite(epoch) ? epochToDatetimeLocal(epoch) : '';
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

/** Average speed (km/h, pt-BR comma), or null when undefined (no duration/distance). */
function formatSpeed(meters, durationMs) {
    if (!(durationMs > 0) || !(meters > 0)) return null;
    const kmh = (meters / (durationMs / 1000)) * 3.6;
    return `${kmh.toFixed(1).replace('.', ',')} km/h`;
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

    const timeContext = getActiveTimeContext();

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
        updateFeatureProperty(featureType, feature.properties.id, 'trajetoria', sorted);
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
                renderList();
            },
        });
        fields.appendChild(timeField);

        const coord = document.createElement('span');
        coord.className = 'temporal-trajectory-row__coord';
        coord.textContent = `${kp.lng.toFixed(5)}, ${kp.lat.toFixed(5)}`;
        fields.appendChild(coord);

        row.appendChild(fields);

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
    renderList();

    // Show this feature's trajectory on the map (path + draggable point markers)
    // while it's selected, with the list as the onChange target.
    getControl('TrajectoryEditControl')?.show(feature, { onChange: renderList });

    return section;
}
