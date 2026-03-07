// Path: js/azimuth_distance_tool/components/reference-point.component.js

/**
 * @fileoverview Reference Point component for the azimuth distance tool.
 * Displays the origin point status and allows setting it.
 *
 * @module azimuth_distance_tool/components/reference-point
 */

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
        box.className = hasPoint ? 'azd-ref-box azd-ref-box--set' : 'azd-ref-box azd-ref-box--empty';

        // Reticle icon
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('width', '14');
        icon.setAttribute('height', '14');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('fill', 'none');
        icon.setAttribute('stroke', 'currentColor');
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
        text.className = hasPoint ? 'azd-ref-text azd-ref-text--set' : 'azd-ref-text azd-ref-text--empty';
        text.textContent = hasPoint
            ? `${referencePoint[1].toFixed(6)}, ${referencePoint[0].toFixed(6)}`
            : 'Clique no mapa para definir';
        box.appendChild(text);

        // Action buttons (when point is set)
        if (hasPoint) {
            const buttonsContainer = document.createElement('div');
            buttonsContainer.className = 'azd-ref-buttons';

            buttonsContainer.appendChild(createActionButton(
                'Editar coordenadas',
                'azd-ref-action-btn azd-ref-action-btn--edit',
                createEditIcon(),
                (e) => { e.stopPropagation(); onEditCoordinates(); }
            ));

            buttonsContainer.appendChild(createActionButton(
                'Escolher novo ponto no mapa',
                'azd-ref-action-btn azd-ref-action-btn--reset',
                createResetIcon(),
                (e) => {
                    e.stopPropagation();
                    onReset?.();
                    onClickMap();
                }
            ));

            box.appendChild(buttonsContainer);
        }

        // Click handler for the whole box
        box.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
            onReset?.();
            onClickMap();
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
 * Create an action button with an SVG icon.
 *
 * @param {string} title - Button tooltip
 * @param {string} className - CSS class name
 * @param {SVGElement} iconSvg - SVG icon element
 * @param {Function} onClick - Click handler
 * @returns {HTMLButtonElement}
 */
function createActionButton(title, className, iconSvg, onClick) {
    const btn = document.createElement('button');
    btn.title = title;
    btn.className = className;
    btn.appendChild(iconSvg);
    btn.addEventListener('click', onClick);
    return btn;
}

/**
 * Create the edit (pencil) SVG icon.
 * @returns {SVGElement}
 */
function createEditIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.innerHTML = `
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    `;
    return svg;
}

/**
 * Create the reset (refresh) SVG icon.
 * @returns {SVGElement}
 */
function createResetIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.innerHTML = `
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
        <path d="M3 3v5h5"/>
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
        <path d="M16 21h5v-5"/>
    `;
    return svg;
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
