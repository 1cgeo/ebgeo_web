// Path: js/tool_manager/helpers/line-style.helpers.js

/**
 * @fileoverview Line style selector component for attribute panels.
 */

/**
 * Line style definitions with SVG dash arrays.
 */
const LINE_STYLES = [
    { id: 'solid', label: 'Sólida', dasharray: null },
    { id: 'dashed', label: 'Tracejada', dasharray: '8 4' },
    { id: 'dotted', label: 'Pontilhada', dasharray: '2 3' },
    { id: 'dash-dot', label: 'Traço-ponto', dasharray: '8 4 2 4' },
    { id: 'long-dash', label: 'Traço longo', dasharray: '16 6' },
    { id: 'short-dash', label: 'Traço curto', dasharray: '4 4' },
    { id: 'dot-dot-dash', label: 'Ponto-ponto-traço', dasharray: '2 2 2 2 8 2' },
];

/**
 * Creates a line style preview SVG.
 *
 * @param {Object} style - Line style object
 * @param {number} [width=60] - SVG width
 * @param {number} [height=16] - SVG height
 * @returns {string} SVG markup
 */
function createLinePreviewSVG(style, width = 60, height = 16) {
    const dasharray = style.dasharray ? `stroke-dasharray="${style.dasharray}"` : '';
    return `
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
            <line
                x1="4"
                y1="${height / 2}"
                x2="${width - 4}"
                y2="${height / 2}"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                ${dasharray}
            />
        </svg>
    `;
}

/**
 * Creates a modern line style selector with visual buttons in a grid layout.
 * All styles are displayed in two rows (4 + 3).
 *
 * @param {Object} config - Configuration object
 * @param {string} config.value - Currently selected line style ID
 * @param {Function} config.onChange - Callback when style changes
 * @param {string} [config.label='Estilo da Linha'] - Label text
 * @returns {HTMLElement} Line style selector container
 */
export function createModernLineStyleSelect(config) {
    const { value, onChange, label = 'Estilo da Linha' } = config;
    let currentValue = value || 'solid';

    const container = document.createElement('div');
    container.className = 'attr-modern-line-style';

    const labelEl = document.createElement('label');
    labelEl.className = 'attr-modern-line-style-label';
    labelEl.textContent = label;
    container.appendChild(labelEl);

    // Grid container for all styles (2 rows, 4 columns)
    const gridContainer = document.createElement('div');
    gridContainer.className = 'attr-modern-line-style-grid';

    const updateSelection = (styleId) => {
        currentValue = styleId;

        // Update all buttons
        gridContainer.querySelectorAll('.attr-modern-line-style-btn').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.styleId === styleId);
        });

        onChange(styleId);
    };

    // Create buttons for all styles
    LINE_STYLES.forEach(style => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'attr-modern-line-style-btn';
        btn.dataset.styleId = style.id;
        if (style.id === currentValue) {
            btn.classList.add('selected');
        }
        btn.innerHTML = createLinePreviewSVG(style, 50, 12);
        btn.title = style.label;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            updateSelection(style.id);
        });

        gridContainer.appendChild(btn);
    });

    container.appendChild(gridContainer);

    return container;
}

