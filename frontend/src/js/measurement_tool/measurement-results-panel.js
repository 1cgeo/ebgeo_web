// Path: js/measurement_tool/measurement-results-panel.js

/**
 * @module measurement_tool/measurement-results-panel
 * @description Results panel shown after a measurement is completed.
 * Displayed inside the sidebar feature panel area.
 */

import {
    DISTANCE_UNITS, DEFAULT_DISTANCE_UNIT,
    AREA_UNITS, DEFAULT_AREA_UNIT,
    ANGLE_UNITS,
} from './measurement.constants.js';
import { formatDistance, formatArea, formatAngle } from './measurement-geometry.js';

/**
 * Creates a results panel for distance measurement.
 * @param {Object} options
 * @param {number[]} options.segmentDistances - Distance per segment in meters
 * @param {number} options.totalDistance - Total distance in meters
 * @param {Function} [options.onSave] - Called when user clicks "Salvar como feicao"
 * @param {Function} [options.onClear] - Called when user clicks "Limpar"
 * @param {Function} [options.onUnitChange] - Called when unit changes, receives { unit }
 * @returns {HTMLElement}
 */
export function createDistanceResultsPanel({ segmentDistances, totalDistance, onSave, onClear, onUnitChange }) {
    const container = document.createElement('div');
    container.className = 'measurement-results-panel';

    let currentUnit = DISTANCE_UNITS.find(u => u.id === DEFAULT_DISTANCE_UNIT);

    const unitSelect = _createUnitSelect(DISTANCE_UNITS, currentUnit.id);
    const totalEl = document.createElement('div');
    totalEl.className = 'measurement-results-panel__total';

    const segmentList = document.createElement('div');
    segmentList.className = 'measurement-results-panel__segment-list';

    function refresh() {
        totalEl.textContent = formatDistance(totalDistance, currentUnit);

        segmentList.replaceChildren();
        segmentDistances.forEach((dist, i) => {
            const item = document.createElement('div');
            item.className = 'measurement-results-panel__segment-item';
            item.textContent = `Segmento ${i + 1}: ${formatDistance(dist, currentUnit)}`;
            segmentList.appendChild(item);
        });
    }

    unitSelect.addEventListener('change', (e) => {
        currentUnit = DISTANCE_UNITS.find(u => u.id === e.target.value);
        refresh();
        if (onUnitChange) onUnitChange({ unit: currentUnit });
    });

    const header = document.createElement('div');
    header.className = 'measurement-results-panel__header';
    header.textContent = 'Medição de Distância';
    container.appendChild(header);

    container.appendChild(unitSelect);

    const totalLabel = document.createElement('div');
    totalLabel.className = 'measurement-results-panel__label';
    totalLabel.textContent = 'Distância total:';
    container.appendChild(totalLabel);
    container.appendChild(totalEl);

    if (segmentDistances.length > 1) {
        const segLabel = document.createElement('div');
        segLabel.className = 'measurement-results-panel__label';
        segLabel.textContent = 'Segmentos:';
        container.appendChild(segLabel);
        container.appendChild(segmentList);
    }

    container.appendChild(_createActions(onSave, onClear));

    refresh();
    return container;
}

/**
 * Creates a results panel for area measurement.
 * @param {Object} options
 * @param {number} options.area - Area in m2
 * @param {number} options.perimeter - Perimeter in meters
 * @param {Function} [options.onSave] - Called when user clicks "Salvar como feicao"
 * @param {Function} [options.onClear] - Called when user clicks "Limpar"
 * @param {Function} [options.onUnitChange] - Called when unit changes, receives { areaUnit }
 * @returns {HTMLElement}
 */
export function createAreaResultsPanel({ area, perimeter, onSave, onClear, onUnitChange }) {
    const container = document.createElement('div');
    container.className = 'measurement-results-panel';

    let currentAreaUnit = AREA_UNITS.find(u => u.id === DEFAULT_AREA_UNIT);
    const currentDistUnit = DISTANCE_UNITS.find(u => u.id === DEFAULT_DISTANCE_UNIT);

    const areaUnitSelect = _createUnitSelect(AREA_UNITS, currentAreaUnit.id);
    const areaValueEl = document.createElement('div');
    areaValueEl.className = 'measurement-results-panel__total';

    const perimeterEl = document.createElement('div');
    perimeterEl.className = 'measurement-results-panel__value';

    function refresh() {
        areaValueEl.textContent = formatArea(area, currentAreaUnit);
        perimeterEl.textContent = formatDistance(perimeter, currentDistUnit);
    }

    areaUnitSelect.addEventListener('change', (e) => {
        currentAreaUnit = AREA_UNITS.find(u => u.id === e.target.value);
        refresh();
        if (onUnitChange) onUnitChange({ areaUnit: currentAreaUnit });
    });

    const header = document.createElement('div');
    header.className = 'measurement-results-panel__header';
    header.textContent = 'Medição de Área';
    container.appendChild(header);

    container.appendChild(areaUnitSelect);

    const areaLabel = document.createElement('div');
    areaLabel.className = 'measurement-results-panel__label';
    areaLabel.textContent = 'Área:';
    container.appendChild(areaLabel);
    container.appendChild(areaValueEl);

    const perimLabel = document.createElement('div');
    perimLabel.className = 'measurement-results-panel__label';
    perimLabel.textContent = 'Perímetro:';
    container.appendChild(perimLabel);
    container.appendChild(perimeterEl);

    container.appendChild(_createActions(onSave, onClear));

    refresh();
    return container;
}

/**
 * Creates a results panel for angle measurement.
 * @param {Object} options
 * @param {number} options.angleDegrees - Angle in degrees
 * @param {Function} [options.onClear] - Called when user clicks "Limpar"
 * @returns {HTMLElement}
 */
export function createAngleResultsPanel({ angleDegrees, onClear }) {
    const container = document.createElement('div');
    container.className = 'measurement-results-panel';

    const header = document.createElement('div');
    header.className = 'measurement-results-panel__header';
    header.textContent = 'Medição de Ângulo';
    container.appendChild(header);

    for (const unit of ANGLE_UNITS) {
        const row = document.createElement('div');
        row.className = 'measurement-results-panel__angle-row';

        const label = document.createElement('span');
        label.className = 'measurement-results-panel__angle-label';
        label.textContent = `${unit.label}:`;

        const value = document.createElement('span');
        value.className = 'measurement-results-panel__angle-value';
        value.textContent = formatAngle(angleDegrees, unit);

        row.appendChild(label);
        row.appendChild(value);
        container.appendChild(row);
    }

    const actions = document.createElement('div');
    actions.className = 'measurement-results-panel__actions';

    if (onClear) {
        const clearBtn = document.createElement('button');
        clearBtn.className = 'measurement-results-panel__clear-btn';
        clearBtn.textContent = 'Limpar';
        clearBtn.addEventListener('click', onClear);
        actions.appendChild(clearBtn);
    }

    container.appendChild(actions);
    return container;
}

/**
 * @param {Array} units - Unit definitions
 * @param {string} defaultId - Default selected unit ID
 * @returns {HTMLSelectElement}
 */
function _createUnitSelect(units, defaultId) {
    const select = document.createElement('select');
    select.className = 'measurement-results-panel__unit-selector';

    for (const unit of units) {
        const option = document.createElement('option');
        option.value = unit.id;
        option.textContent = unit.label;
        if (unit.id === defaultId) option.selected = true;
        select.appendChild(option);
    }

    return select;
}

/**
 * @param {Function} [onSave]
 * @param {Function} [onClear]
 * @returns {HTMLElement}
 */
function _createActions(onSave, onClear) {
    const actions = document.createElement('div');
    actions.className = 'measurement-results-panel__actions';

    if (onSave) {
        const saveBtn = document.createElement('button');
        saveBtn.className = 'measurement-results-panel__save-btn';
        saveBtn.textContent = 'Salvar como feição';
        saveBtn.addEventListener('click', onSave);
        actions.appendChild(saveBtn);
    }

    if (onClear) {
        const clearBtn = document.createElement('button');
        clearBtn.className = 'measurement-results-panel__clear-btn';
        clearBtn.textContent = 'Limpar';
        clearBtn.addEventListener('click', onClear);
        actions.appendChild(clearBtn);
    }

    return actions;
}
