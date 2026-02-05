// Path: js/military_tools/azimuth_distance_tool/components/leg-row.component.js

/**
 * @fileoverview Leg Row component for the azimuth distance tool.
 * Each row represents one leg in the Quadro de Azimutes (azimuth table).
 *
 * @module military_tools/azimuth_distance_tool/components/leg-row
 */

import { COLORS, ANGULAR_UNIT, DISTANCE_UNIT, MILS_PER_CIRCLE, DEGREES_PER_CIRCLE } from '../azimuth_distance_constants.js';
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
    row.className = 'azimuth-distance-leg-row';
    row.dataset.index = index;
    row.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 0;
        border-bottom: 1px solid ${COLORS.gray100};
        border-radius: 4px;
        background: ${isActive ? 'rgba(22,163,74,0.05)' : 'transparent'};
        transition: background 0.15s;
        cursor: pointer;
    `;

    // Row click handler
    row.addEventListener('click', (e) => {
        // Don't trigger if clicking on inputs or buttons
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') {
            return;
        }
        onFocus(index);
    });

    // Leg number badge
    const badge = document.createElement('div');
    badge.className = 'leg-badge';
    badge.style.cssText = `
        width: 28px;
        height: 28px;
        border-radius: 50%;
        flex-shrink: 0;
        background: ${isActive ? COLORS.primary600 : COLORS.gray200};
        color: ${isActive ? COLORS.white : COLORS.gray500};
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 700;
        font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    `;
    badge.textContent = index + 1;
    row.appendChild(badge);

    // Azimuth input container
    const azContainer = document.createElement('div');
    azContainer.style.cssText = 'display: flex; align-items: center; gap: 3px; flex: 1 1 0;';

    const azInput = document.createElement('input');
    azInput.type = 'number';
    azInput.value = leg.azimuth !== '' && leg.azimuth != null ? leg.azimuth : '';
    azInput.placeholder = 'Az';
    azInput.min = 0;
    azInput.max = maxAz;
    azInput.step = azStep;
    azInput.style.cssText = `
        width: 100%;
        padding: 8px 6px;
        border: 1px solid ${COLORS.gray300};
        border-radius: 4px;
        font-size: 14px;
        font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
        text-align: right;
        outline: none;
        background: ${COLORS.white};
        color: ${COLORS.gray900};
    `;

    // Use 'change' event for validation, 'input' for live updates
    azInput.addEventListener('change', (e) => {
        e.stopPropagation();
        const value = e.target.value;
        if (value === '') {
            onChange(index, 'azimuth', '');
        } else {
            let n = parseFloat(value);
            if (!isNaN(n)) {
                n = Math.max(0, Math.min(maxAz, n));
                e.target.value = n;
                onChange(index, 'azimuth', n);
            }
        }
    });

    azInput.addEventListener('input', (e) => {
        e.stopPropagation();
        // Allow typing without immediate validation
        const value = e.target.value;
        if (value === '' || value === '-') {
            onChange(index, 'azimuth', '');
        } else {
            const n = parseFloat(value);
            if (!isNaN(n)) {
                onChange(index, 'azimuth', n);
            }
        }
    });

    azInput.addEventListener('focus', (e) => {
        e.stopPropagation();
        onFocus(index);
    });

    azContainer.appendChild(azInput);

    const azLabel = document.createElement('span');
    azLabel.style.cssText = `font-size: 12px; color: ${COLORS.gray500}; flex-shrink: 0; width: 14px; text-align: left;`;
    azLabel.textContent = azSuffix;
    azContainer.appendChild(azLabel);

    row.appendChild(azContainer);

    // Contra-azimuth button
    const flipBtn = document.createElement('button');
    flipBtn.type = 'button';
    flipBtn.title = 'Contra-azimute (Az±180°)';
    flipBtn.innerHTML = '↻';
    flipBtn.style.cssText = `
        width: 28px;
        height: 28px;
        border: 1px solid ${COLORS.gray300};
        border-radius: 4px;
        background: ${COLORS.white};
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        font-size: 14px;
        color: ${COLORS.gray500};
        padding: 0;
        line-height: 1;
    `;

    flipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (leg.azimuth !== '' && leg.azimuth != null) {
            const contra = calculateContraAzimuth(Number(leg.azimuth), angularUnit);
            onChange(index, 'azimuth', contra);
        }
    });

    row.appendChild(flipBtn);

    // Distance input container
    const distContainer = document.createElement('div');
    distContainer.style.cssText = 'display: flex; align-items: center; gap: 3px; flex: 1 1 0;';

    const distInput = document.createElement('input');
    distInput.type = 'number';
    distInput.value = leg.distance !== '' && leg.distance != null ? leg.distance : '';
    distInput.placeholder = 'Dist';
    distInput.min = 0;
    distInput.step = dStep;
    distInput.style.cssText = `
        width: 100%;
        padding: 8px 6px;
        border: 1px solid ${COLORS.gray300};
        border-radius: 4px;
        font-size: 14px;
        font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
        text-align: right;
        outline: none;
        background: ${COLORS.white};
        color: ${COLORS.gray900};
    `;

    distInput.addEventListener('change', (e) => {
        e.stopPropagation();
        const value = e.target.value;
        if (value === '') {
            onChange(index, 'distance', '');
        } else {
            let n = parseFloat(value);
            if (!isNaN(n)) {
                n = Math.max(0, n);
                e.target.value = n;
                onChange(index, 'distance', n);
            }
        }
    });

    distInput.addEventListener('input', (e) => {
        e.stopPropagation();
        const value = e.target.value;
        if (value === '' || value === '-') {
            onChange(index, 'distance', '');
        } else {
            const n = parseFloat(value);
            if (!isNaN(n)) {
                onChange(index, 'distance', n);
            }
        }
    });

    distInput.addEventListener('focus', (e) => {
        e.stopPropagation();
        onFocus(index);
    });

    distContainer.appendChild(distInput);

    const distLabel = document.createElement('span');
    distLabel.style.cssText = `font-size: 12px; color: ${COLORS.gray500}; flex-shrink: 0; width: 20px; text-align: left;`;
    distLabel.textContent = dSuffix;
    distContainer.appendChild(distLabel);

    row.appendChild(distContainer);

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.innerHTML = '×';
    removeBtn.title = 'Remover perna';
    removeBtn.style.cssText = `
        width: 28px;
        height: 28px;
        border: none;
        border-radius: 4px;
        padding: 0;
        background: ${canRemove ? COLORS.red100 : 'transparent'};
        color: ${canRemove ? COLORS.red600 : COLORS.gray300};
        cursor: ${canRemove ? 'pointer' : 'default'};
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        flex-shrink: 0;
        line-height: 1;
    `;

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

        const {
            legs,
            activeIndex,
            angularUnit,
            distanceUnit,
            onChange,
            onRemove,
            onFocus,
            onAdd
        } = opts;

        // Column headers
        const headers = document.createElement('div');
        headers.style.cssText = `
            display: flex;
            align-items: center;
            padding: 8px 0 4px;
            gap: 6px;
            border-bottom: 1px solid ${COLORS.gray200};
        `;

        const headerStyle = `font-size: 10px; font-weight: 700; color: ${COLORS.gray400}; text-transform: uppercase; text-align: center; letter-spacing: 0.5px;`;

        headers.innerHTML = `
            <div style="width: 28px;"></div>
            <div style="${headerStyle} flex: 1 1 0;">Azimute</div>
            <div style="width: 28px;"></div>
            <div style="${headerStyle} flex: 1 1 0;">Distância</div>
            <div style="width: 28px;"></div>
        `;
        container.appendChild(headers);

        // Legs list (scrollable)
        const legsList = document.createElement('div');
        legsList.className = 'legs-list';
        legsList.style.cssText = `
            max-height: 220px;
            overflow-y: auto;
            flex: 1;
        `;

        legs.forEach((leg, i) => {
            const row = createLegRow({
                leg,
                index: i,
                angularUnit,
                distanceUnit,
                isActive: i === activeIndex,
                canRemove: legs.length > 1,
                onChange,
                onRemove,
                onFocus
            });
            legsList.appendChild(row);
        });

        container.appendChild(legsList);

        // Add leg button
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'add-leg-btn';
        addBtn.style.cssText = `
            width: 100%;
            padding: 10px;
            border-radius: 6px;
            border: 1px dashed ${COLORS.gray300};
            background: ${COLORS.white};
            cursor: pointer;
            font-size: 13px;
            color: ${COLORS.gray500};
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            font-weight: 500;
            transition: all 0.15s;
            margin-top: 10px;
        `;
        addBtn.innerHTML = '<span style="font-size: 18px; line-height: 1;">+</span> Adicionar Perna';

        addBtn.addEventListener('click', (e) => {
            e.preventDefault();
            onAdd();
        });
        addBtn.addEventListener('mouseenter', () => {
            addBtn.style.borderColor = COLORS.primary600;
            addBtn.style.color = COLORS.primary600;
        });
        addBtn.addEventListener('mouseleave', () => {
            addBtn.style.borderColor = COLORS.gray300;
            addBtn.style.color = COLORS.gray500;
        });

        container.appendChild(addBtn);
    }

    render(options);

    return {
        container,
        update: (newOptions) => render(newOptions)
    };
}
