// Path: js/temporal/temporal-attributes-section.js

/**
 * @fileoverview Attribute-panel sections for the Temporal Module:
 *  - a "Validade temporal" section (temporalInicio/temporalFim) for ALL feature
 *    types;
 *  - a "Trajetória" section (launch the map editor + clear) only for
 *    point / military_symbol / coordination_measure.
 *
 * Both self-persist on change (live source via the control, store via
 * updateFeatureProperty) and ask the TemporalController to re-apply render.
 */

import { getControl, updateFeatureProperty } from '@store';
import { epochToDatetimeLocal, datetimeLocalToEpoch } from './temporal.utils.js';
import { normalizeTrajectory } from './temporal-model.js';
import { TRAJECTORY_FEATURE_TYPES, TRAJECTORY_TYPE_TO_SOURCE } from './temporal.constants.js';
import { updateSourceFeatureProperty } from './temporal-render.service.js';

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
 * datetime-local rows). Shared by the 2D feature panel and the 3D/360 marker
 * panels — each supplies only its own persistence callback.
 * @param {Object} opts
 * @param {number} [opts.inicio] - Current temporalInicio (epoch ms).
 * @param {number} [opts.fim] - Current temporalFim (epoch ms).
 * @param {(prop: ('temporalInicio'|'temporalFim'), epoch: (number|null)) => void} opts.onChange
 * @returns {HTMLElement}
 */
export function createTemporalValiditySection({ inicio, fim, onChange }) {
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

    section.appendChild(buildDateRow('Início', inicio, (epoch) => onChange('temporalInicio', epoch)));
    section.appendChild(buildDateRow('Fim', fim, (epoch) => onChange('temporalFim', epoch)));
    return section;
}

function buildDateRow(labelText, epoch, onChange) {
    const row = document.createElement('div');
    row.className = 'temporal-attr-row';

    const label = document.createElement('label');
    label.className = 'temporal-attr-row__label';
    label.textContent = labelText;

    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.className = 'temporal-attr-row__input';
    input.value = Number.isFinite(epoch) ? epochToDatetimeLocal(epoch) : '';
    input.addEventListener('change', () => onChange(datetimeLocalToEpoch(input.value)));

    row.appendChild(label);
    row.appendChild(input);
    return row;
}

/**
 * Builds the trajectory section for trajectory-capable features: a waypoint list
 * (per-point time editing + delete), an "Adicionar no mapa" action that launches
 * the point-by-point map editor, and a "Limpar" action. The list refreshes live
 * while the map editor adds points (via its onChange callback).
 * @param {Object} opts
 * @param {Object} opts.feature - The single selected feature.
 * @param {string} opts.featureType - Feature type (source string).
 * @param {Object} [opts.map] - MapLibre map (for live source updates).
 * @returns {HTMLElement|null} The section, or null for non-trajectory types.
 */
export function createTrajectorySection({ feature, featureType, map }) {
    if (!TRAJECTORY_FEATURE_TYPES.includes(featureType)) return null;

    const section = document.createElement('div');
    section.className = 'temporal-attr-section';

    const title = document.createElement('div');
    title.className = 'temporal-attr-section__title';
    title.textContent = 'Trajetória';
    section.appendChild(title);

    const info = document.createElement('div');
    info.className = 'temporal-attr-section__hint';
    section.appendChild(info);

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
            ? 'Sem trajetória (mudança instantânea). Use "Adicionar no mapa" para criar.'
            : `${waypoints.length} ponto(s) — edite o instante aqui; arraste os pontos no mapa para reposicionar.`;
        clearBtn.disabled = waypoints.length === 0;

        waypoints.forEach((kp, index) => list.appendChild(buildWaypointRow(kp, index)));
    };

    function buildWaypointRow(kp, index) {
        const row = document.createElement('div');
        row.className = 'temporal-trajectory-row';

        const badge = document.createElement('span');
        badge.className = 'temporal-trajectory-row__badge';
        badge.textContent = String(index + 1);
        row.appendChild(badge);

        const fields = document.createElement('div');
        fields.className = 'temporal-trajectory-row__fields';

        const timeInput = document.createElement('input');
        timeInput.type = 'datetime-local';
        timeInput.className = 'temporal-trajectory-row__time';
        timeInput.value = Number.isFinite(kp.t) ? epochToDatetimeLocal(kp.t) : '';
        timeInput.addEventListener('change', () => {
            const epoch = datetimeLocalToEpoch(timeInput.value);
            if (epoch === null) return;
            kp.t = epoch; // mutate the shared keypoint object
            persist();
            renderList();
        });
        fields.appendChild(timeInput);

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
