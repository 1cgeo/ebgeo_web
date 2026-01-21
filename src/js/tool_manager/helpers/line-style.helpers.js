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
 * SVG icons.
 */
const ICONS = {
    chevronDown: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>',
    check: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
};

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
 * Creates a modern line style selector with visual buttons.
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
    let isDropdownOpen = false;
    let dropdown = null;

    const container = document.createElement('div');
    container.className = 'attr-modern-line-style';

    const labelEl = document.createElement('label');
    labelEl.className = 'attr-modern-line-style-label';
    labelEl.textContent = label;
    container.appendChild(labelEl);

    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'attr-modern-line-style-buttons';

    // Primary styles (first 3)
    const primaryStyles = LINE_STYLES.slice(0, 3);
    const otherStyles = LINE_STYLES.slice(3);

    const updateSelection = (styleId) => {
        currentValue = styleId;

        // Update primary buttons
        primaryStyles.forEach((style, index) => {
            const btn = buttonsContainer.children[index];
            if (btn) {
                btn.classList.toggle('selected', style.id === styleId);
            }
        });

        // Update "others" button
        const othersBtn = buttonsContainer.querySelector('.attr-modern-line-style-others');
        if (othersBtn) {
            const isOtherSelected = otherStyles.some(s => s.id === styleId);
            othersBtn.classList.toggle('selected', isOtherSelected);
        }

        // Update current label
        const currentLabel = container.querySelector('.attr-modern-line-style-current');
        if (currentLabel) {
            const selectedStyle = LINE_STYLES.find(s => s.id === styleId);
            currentLabel.textContent = selectedStyle ? selectedStyle.label : 'Sólida';
        }

        onChange(styleId);
    };

    // Create primary style buttons
    primaryStyles.forEach(style => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'attr-modern-line-style-btn';
        if (style.id === currentValue) {
            btn.classList.add('selected');
        }
        btn.innerHTML = createLinePreviewSVG(style, 40, 12);
        btn.title = style.label;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            updateSelection(style.id);
        });

        buttonsContainer.appendChild(btn);
    });

    // Create "Others" dropdown button
    const othersWrapper = document.createElement('div');
    othersWrapper.style.position = 'relative';

    const othersBtn = document.createElement('button');
    othersBtn.type = 'button';
    othersBtn.className = 'attr-modern-line-style-others';
    if (otherStyles.some(s => s.id === currentValue)) {
        othersBtn.classList.add('selected');
    }
    othersBtn.innerHTML = `<span>Outros</span>${ICONS.chevronDown}`;

    const closeDropdown = () => {
        if (dropdown && dropdown.parentNode) {
            dropdown.remove();
            dropdown = null;
        }
        isDropdownOpen = false;
    };

    const openDropdown = () => {
        if (isDropdownOpen) {
            closeDropdown();
            return;
        }

        isDropdownOpen = true;
        dropdown = document.createElement('div');
        dropdown.className = 'attr-modern-line-style-dropdown';

        otherStyles.forEach(style => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'attr-modern-line-style-option';
            if (style.id === currentValue) {
                option.classList.add('selected');
            }

            const preview = document.createElement('div');
            preview.className = 'attr-modern-line-style-option-preview';
            preview.innerHTML = createLinePreviewSVG(style, 60, 16);

            const labelSpan = document.createElement('span');
            labelSpan.className = 'attr-modern-line-style-option-label';
            labelSpan.textContent = style.label;

            option.appendChild(preview);
            option.appendChild(labelSpan);

            if (style.id === currentValue) {
                const checkIcon = document.createElement('span');
                checkIcon.className = 'attr-modern-line-style-option-check';
                checkIcon.innerHTML = ICONS.check;
                option.appendChild(checkIcon);
            }

            option.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                updateSelection(style.id);
                closeDropdown();
            });

            dropdown.appendChild(option);
        });

        othersWrapper.appendChild(dropdown);

        // Close on click outside
        const handleClickOutside = (e) => {
            if (!othersWrapper.contains(e.target)) {
                closeDropdown();
                document.removeEventListener('mousedown', handleClickOutside);
            }
        };
        setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 0);
    };

    othersBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDropdown();
    });

    othersWrapper.appendChild(othersBtn);
    buttonsContainer.appendChild(othersWrapper);

    container.appendChild(buttonsContainer);

    // Current selection label
    const currentLabel = document.createElement('div');
    currentLabel.className = 'attr-modern-line-style-current';
    const selectedStyle = LINE_STYLES.find(s => s.id === currentValue);
    currentLabel.textContent = selectedStyle ? selectedStyle.label : 'Sólida';
    container.appendChild(currentLabel);

    return container;
}

/**
 * Gets the dash array for a line style ID.
 *
 * @param {string} styleId - Line style ID
 * @returns {string|null} Dash array string or null for solid
 */
export function getLineDashArray(styleId) {
    const style = LINE_STYLES.find(s => s.id === styleId);
    return style ? style.dasharray : null;
}

/**
 * Gets all available line styles.
 *
 * @returns {Array} Array of line style objects
 */
export function getLineStyles() {
    return [...LINE_STYLES];
}
