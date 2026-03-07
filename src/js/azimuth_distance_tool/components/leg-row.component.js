// Path: js/azimuth_distance_tool/components/leg-row.component.js

/**
 * @fileoverview Leg Row component for the azimuth distance tool.
 * Each row represents one leg in the Quadro de Azimutes (azimuth table).
 *
 * @module azimuth_distance_tool/components/leg-row
 */

import { ANGULAR_UNIT, DISTANCE_UNIT, MILS_PER_CIRCLE, DEGREES_PER_CIRCLE } from '../azimuth_distance_constants.js';
import { calculateContraAzimuth } from '../azimuth_distance_geometry.js';

/**
 * Create a leg row element.
 *
 * @param {Object} options - Component options
 * @param {Object} options.leg - Leg data { azimuth, distance }
 * @param {number} options.index - Leg index (0-based)
 * @param {string} options.angularUnit - Angular unit
 * @param {string} options.distanceUnit - Distance unit
 * @param {boolean} options.isActive - Whether this leg is active
 * @param {boolean} options.canRemove - Whether this leg can be removed
 * @param {Function} options.onChange - Callback when values change (index, field, value)
 * @param {Function} options.onRemove - Callback when remove is clicked (index)
 * @param {Function} options.onFocus - Callback when row is focused (index)
 * @returns {HTMLElement} Row element
 */
export function createLegRow(options) {
    const {
        leg,
        index,
        angularUnit,
        distanceUnit,
        isActive,
        canRemove,
        onChange,
        onRemove,
        onFocus
    } = options;

    const maxAz = angularUnit === ANGULAR_UNIT.MILS ? MILS_PER_CIRCLE : DEGREES_PER_CIRCLE;
    const azStep = angularUnit === ANGULAR_UNIT.MILS ? 10 : 1;
    const dStep = distanceUnit === DISTANCE_UNIT.KILOMETERS ? 0.1 : 10;
    const azSuffix = angularUnit === ANGULAR_UNIT.MILS ? '₥' : '°';
    const dSuffix = distanceUnit === DISTANCE_UNIT.KILOMETERS ? 'km' : 'm';

    const row = document.createElement('div');
    row.className = `azd-leg-row${isActive ? ' azd-leg-row--active' : ''}`;
    row.dataset.index = index;

    // Row click handler (ignore clicks on inputs or buttons)
    row.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
        onFocus(index);
    });

    // Badge
    const badge = document.createElement('div');
    badge.className = 'azd-leg-badge';
    badge.textContent = index + 1;
    row.appendChild(badge);

    // Azimuth input group
    row.appendChild(createInputGroup({
        value: leg.azimuth,
        placeholder: 'Az',
        min: 0,
        max: maxAz,
        step: azStep,
        suffix: azSuffix,
        suffixClass: 'azd-leg-suffix azd-leg-suffix--az',
        index,
        field: 'azimuth',
        clampMax: maxAz,
        onChange,
        onFocus
    }));

    // Contra-azimuth button
    const flipBtn = document.createElement('button');
    flipBtn.type = 'button';
    flipBtn.title = 'Contra-azimute (Az\u00B1180\u00B0)';
    flipBtn.className = 'azd-flip-btn';
    flipBtn.textContent = '\u21BB';
    flipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (leg.azimuth !== '' && leg.azimuth != null) {
            const contra = calculateContraAzimuth(Number(leg.azimuth), angularUnit);
            onChange(index, 'azimuth', contra);
        }
    });
    row.appendChild(flipBtn);

    // Distance input group
    row.appendChild(createInputGroup({
        value: leg.distance,
        placeholder: 'Dist',
        min: 0,
        max: undefined,
        step: dStep,
        suffix: dSuffix,
        suffixClass: 'azd-leg-suffix azd-leg-suffix--dist',
        index,
        field: 'distance',
        clampMax: undefined,
        onChange,
        onFocus
    }));

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '\u00D7';
    removeBtn.title = 'Remover perna';
    removeBtn.className = canRemove ? 'azd-remove-btn azd-remove-btn--enabled' : 'azd-remove-btn azd-remove-btn--disabled';

    if (canRemove) {
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            onRemove(index);
        });
    }
    row.appendChild(removeBtn);

    return row;
}

/**
 * Create an input group (input + suffix label) for azimuth or distance.
 *
 * @param {Object} opts - Input options
 * @returns {HTMLElement}
 */
function createInputGroup(opts) {
    const { value, placeholder, min, max, step, suffix, suffixClass, index, field, clampMax, onChange, onFocus } = opts;

    const container = document.createElement('div');
    container.className = 'azd-leg-input-group';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'azd-leg-input';
    input.value = value !== '' && value != null ? value : '';
    input.placeholder = placeholder;
    input.min = min;
    if (max != null) input.max = max;
    input.step = step;

    input.addEventListener('change', (e) => {
        e.stopPropagation();
        const val = e.target.value;
        if (val === '') {
            onChange(index, field, '');
        } else {
            let n = parseFloat(val);
            if (!isNaN(n)) {
                n = Math.max(0, clampMax != null ? Math.min(clampMax, n) : n);
                e.target.value = n;
                onChange(index, field, n);
            }
        }
    });

    input.addEventListener('input', (e) => {
        e.stopPropagation();
        const val = e.target.value;
        if (val === '' || val === '-') {
            onChange(index, field, '');
        } else {
            const n = parseFloat(val);
            if (!isNaN(n)) onChange(index, field, n);
        }
    });

    input.addEventListener('focus', (e) => {
        e.stopPropagation();
        onFocus(index);
    });

    container.appendChild(input);

    const label = document.createElement('span');
    label.className = suffixClass;
    label.textContent = suffix;
    container.appendChild(label);

    return container;
}

/**
 * Create the legs table component.
 *
 * @param {Object} options - Options
 * @param {Array<Object>} options.legs - Array of leg objects
 * @param {number} options.activeIndex - Active leg index
 * @param {string} options.angularUnit - Angular unit
 * @param {string} options.distanceUnit - Distance unit
 * @param {Function} options.onChange - Callback (index, field, value)
 * @param {Function} options.onRemove - Callback (index)
 * @param {Function} options.onFocus - Callback (index)
 * @param {Function} options.onAdd - Callback to add leg
 * @returns {{container: HTMLElement, update: Function}}
 */
export function createLegsTable(options) {
    const container = document.createElement('div');
    container.className = 'azimuth-distance-legs-container';

    function render(opts) {
        container.innerHTML = '';

        const { legs, activeIndex, angularUnit, distanceUnit, onChange, onRemove, onFocus, onAdd } = opts;

        // Column headers
        const headers = document.createElement('div');
        headers.className = 'azd-legs-header';

        const spacer1 = document.createElement('div');
        spacer1.className = 'azd-legs-header__spacer';
        headers.appendChild(spacer1);

        const azHeader = document.createElement('div');
        azHeader.className = 'azd-legs-header__label';
        azHeader.textContent = 'Azimute';
        headers.appendChild(azHeader);

        const spacer2 = document.createElement('div');
        spacer2.className = 'azd-legs-header__spacer';
        headers.appendChild(spacer2);

        const distHeader = document.createElement('div');
        distHeader.className = 'azd-legs-header__label';
        distHeader.textContent = 'Dist\u00E2ncia';
        headers.appendChild(distHeader);

        const spacer3 = document.createElement('div');
        spacer3.className = 'azd-legs-header__spacer';
        headers.appendChild(spacer3);

        container.appendChild(headers);

        // Legs list (scrollable)
        const legsList = document.createElement('div');
        legsList.className = 'azd-legs-list';

        legs.forEach((leg, i) => {
            legsList.appendChild(createLegRow({
                leg,
                index: i,
                angularUnit,
                distanceUnit,
                isActive: i === activeIndex,
                canRemove: legs.length > 1,
                onChange,
                onRemove,
                onFocus
            }));
        });

        container.appendChild(legsList);

        // Add leg button
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'azd-add-leg-btn';

        const plusIcon = document.createElement('span');
        plusIcon.className = 'azd-add-leg-btn__icon';
        plusIcon.textContent = '+';
        addBtn.appendChild(plusIcon);

        addBtn.appendChild(document.createTextNode(' Adicionar Perna'));

        addBtn.addEventListener('click', (e) => {
            e.preventDefault();
            onAdd();
        });

        container.appendChild(addBtn);
    }

    render(options);

    return {
        container,
        update: (newOptions) => render(newOptions)
    };
}
