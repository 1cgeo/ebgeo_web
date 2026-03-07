// Path: js/azimuth_distance_tool/components/reference-point.component.js

/**
 * @fileoverview Reference Point component for the azimuth distance tool.
 * Displays the origin point status and allows setting it.
 *
 * @module azimuth_distance_tool/components/reference-point
 */

import { COLORS } from '../azimuth_distance_constants.js';

/**
 * Create reference point component.
 *
 * @param {Object} options - Component options
 * @param {Array<number>|null} options.referencePoint - [lng, lat] or null
 * @param {Function} options.onClickMap - Callback when click-on-map is requested
 * @param {Function} options.onEditCoordinates - Callback when manual entry is requested
 * @param {Function} options.onReset - Callback when point is reset (optional)
 * @returns {{container: HTMLElement, update: Function}}
 */
export function createReferencePointComponent(options) {
    const container = document.createElement('div');
    container.className = 'azimuth-distance-reference-point';

    function render(opts) {
        const { referencePoint, onClickMap, onEditCoordinates, onReset } = opts;
        const hasPoint = referencePoint && Array.isArray(referencePoint) && referencePoint.length >= 2;

        container.innerHTML = '';

        const box = document.createElement('div');
        box.className = 'reference-point-box';
        box.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.15s;
            background: ${hasPoint ? COLORS.primary50 : COLORS.red50};
            border: 1px ${hasPoint ? 'solid' : 'dashed'} ${hasPoint ? COLORS.primary600 : '#fca5a5'};
        `;

        // Hover effect
        box.addEventListener('mouseenter', () => {
            if (hasPoint) {
                box.style.background = 'rgba(22,163,74,0.12)';
                box.style.borderColor = COLORS.primary700;
            }
        });
        box.addEventListener('mouseleave', () => {
            box.style.background = hasPoint ? COLORS.primary50 : COLORS.red50;
            box.style.borderColor = hasPoint ? COLORS.primary600 : '#fca5a5';
        });

        // Reticle icon
        const iconColor = hasPoint ? COLORS.primary600 : COLORS.red600;
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('width', '14');
        icon.setAttribute('height', '14');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('fill', 'none');
        icon.setAttribute('stroke', iconColor);
        icon.setAttribute('stroke-width', '2.5');
        icon.innerHTML = `
            <circle cx="12" cy="12" r="3"/>
            <line x1="12" y1="2" x2="12" y2="8"/>
            <line x1="12" y1="16" x2="12" y2="22"/>
            <line x1="2" y1="12" x2="8" y2="12"/>
            <line x1="16" y1="12" x2="22" y2="12"/>
        `;
        box.appendChild(icon);

        // Text content
        const text = document.createElement('span');
        text.style.cssText = `
            font-size: 11.5px;
            font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
            font-weight: 500;
            color: ${hasPoint ? COLORS.primary700 : COLORS.red600};
            flex: 1;
        `;

        if (hasPoint) {
            text.textContent = `${referencePoint[1].toFixed(6)}, ${referencePoint[0].toFixed(6)}`;
        } else {
            text.textContent = 'Clique no mapa para definir';
        }

        box.appendChild(text);

        // Buttons container (when point is set)
        if (hasPoint) {
            const buttonsContainer = document.createElement('div');
            buttonsContainer.style.cssText = `display: flex; gap: 4px;`;

            // Edit button
            const editBtn = document.createElement('button');
            editBtn.title = 'Editar coordenadas';
            editBtn.style.cssText = `
                width: 22px;
                height: 22px;
                border: none;
                background: transparent;
                cursor: pointer;
                padding: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                color: ${COLORS.gray500};
                transition: all 0.15s;
                border-radius: 4px;
            `;
            editBtn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
            `;

            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                onEditCoordinates();
            });

            editBtn.addEventListener('mouseenter', () => {
                editBtn.style.color = COLORS.primary600;
                editBtn.style.background = 'rgba(22,163,74,0.1)';
            });
            editBtn.addEventListener('mouseleave', () => {
                editBtn.style.color = COLORS.gray500;
                editBtn.style.background = 'transparent';
            });

            buttonsContainer.appendChild(editBtn);

            // Reset/reselect button
            const resetBtn = document.createElement('button');
            resetBtn.title = 'Escolher novo ponto no mapa';
            resetBtn.style.cssText = `
                width: 22px;
                height: 22px;
                border: none;
                background: transparent;
                cursor: pointer;
                padding: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                color: ${COLORS.gray500};
                transition: all 0.15s;
                border-radius: 4px;
            `;
            resetBtn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                    <path d="M3 3v5h5"/>
                    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                    <path d="M16 21h5v-5"/>
                </svg>
            `;

            resetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Reset point and trigger map click mode
                if (onReset) {
                    onReset();
                }
                onClickMap();
            });

            resetBtn.addEventListener('mouseenter', () => {
                resetBtn.style.color = COLORS.amber600;
                resetBtn.style.background = 'rgba(245,158,11,0.1)';
            });
            resetBtn.addEventListener('mouseleave', () => {
                resetBtn.style.color = COLORS.gray500;
                resetBtn.style.background = 'transparent';
            });

            buttonsContainer.appendChild(resetBtn);
            box.appendChild(buttonsContainer);
        }

        // Click handler for the whole box
        box.addEventListener('click', (e) => {
            // Don't trigger if clicking on buttons
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                return;
            }

            if (!hasPoint) {
                // No point yet - enter map click mode
                onClickMap();
            } else {
                // Has point - reset and enter map click mode
                if (onReset) {
                    onReset();
                }
                onClickMap();
            }
        });

        container.appendChild(box);
    }

    render(options);

    return {
        container,
        update: (newOptions) => render({ ...options, ...newOptions })
    };
}

/**
 * Create section label component.
 *
 * @param {string} text - Label text
 * @returns {HTMLElement}
 */
export function createSectionLabel(text) {
    const label = document.createElement('div');
    label.className = 'azd-section-label';
    label.textContent = text;
    return label;
}
