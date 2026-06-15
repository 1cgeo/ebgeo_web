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

import { showToast } from '@utils/index.js';
import {
    getControl,
    updateFeatureProperty,
    isMapTemporalEnabledSync,
} from '@store';
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
 * Builds the trajectory section for trajectory-capable features.
 * @param {Object} opts
 * @param {Object} opts.feature - The single selected feature.
 * @param {string} opts.featureType - Feature type (source string).
 * @param {Object} [opts.map] - MapLibre map (for live source update on clear).
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
    const refreshInfo = () => {
        const count = normalizeTrajectory(feature.properties?.trajetoria).length;
        info.textContent = count === 0 ? 'Sem trajetória (mudança instantânea).' : `${count} ponto(s) de trajetória.`;
    };
    refreshInfo();
    section.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'temporal-attr-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'temporal-attr-btn temporal-attr-btn--primary';
    editBtn.textContent = 'Editar no mapa';
    editBtn.addEventListener('click', () => {
        if (!isMapTemporalEnabledSync()) {
            showToast('Habilite o controle temporal deste mapa para editar trajetórias.', 'warning');
            return;
        }
        getControl('TrajectoryEditControl')?.start(feature);
    });
    actions.appendChild(editBtn);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'temporal-attr-btn';
    clearBtn.textContent = 'Limpar';
    clearBtn.addEventListener('click', () => {
        feature.properties.trajetoria = [];
        const sourceId = TRAJECTORY_TYPE_TO_SOURCE[featureType];
        if (map && sourceId) {
            updateSourceFeatureProperty(map, sourceId, feature.properties.id, 'trajetoria', []);
        }
        updateFeatureProperty(featureType, feature.properties.id, 'trajetoria', []);
        getControl('TemporalControl')?.focusFeature(null);
        getControl('TemporalControl')?.sync();
        refreshInfo();
    });
    actions.appendChild(clearBtn);

    section.appendChild(actions);
    return section;
}
