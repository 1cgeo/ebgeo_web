// Path: js/tool_manager/helpers/form-controls.helpers.js

/**
 * @fileoverview Form control components for attribute panels.
 */

/**
 * Creates a standardized toggle checkbox.
 *
 * @param {boolean} checked - Initial checked state
 * @param {Function} onChange - Callback when checkbox changes
 * @returns {HTMLElement} Checkbox label element
 */
export function createCheckbox(checked, onChange) {
    const label = document.createElement('label');
    label.className = 'switch';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.classList.add('slider-check-input');

    const slider = document.createElement('div');
    slider.className = 'slider-check round';

    label.appendChild(input);
    label.appendChild(slider);
    input.onchange = onChange;
    return label;
}

/**
 * Creates a line style select with visual preview patterns.
 *
 * @param {string} currentValue - Currently selected line style
 * @param {Function} onChange - Callback when selection changes
 * @returns {HTMLElement} Container with select element
 */
export function createLineStyleSelect(currentValue, onChange) {
    const container = document.createElement('div');
    container.style.cssText = 'position: relative; width: 100%;';

    const select = document.createElement('select');
    select.className = 'form-select line-style-select';
    select.style.cssText = `
        width: 100%;
        padding: 8px 12px;
        border-radius: 4px;
        border: 1px solid #ccc;
        background: white;
        font-size: 18px;
        appearance: none;
        background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><path d="M0 0l6 6 6-6z" fill="%23999"/></svg>');
        background-repeat: no-repeat;
        background-position: right 8px center;
        padding-right: 28px;
        font-family: 'Courier New', monospace;
        text-align: center
    `;

    const options = [
        { value: 'solid', label: 'Contínuo', pattern: '────────────' },
        { value: 'dashed', label: 'Tracejado', pattern: '── ── ── ──' },
        { value: 'dotted', label: 'Pontilhado', pattern: ' - - - - - -' },
        { value: 'dash-dot', label: 'Traço-Ponto', pattern: '── - ── - ──' },
    ];

    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = `${opt.pattern}`;
        option.selected = opt.value === currentValue;
        select.appendChild(option);
    });

    select.onchange = (e) => onChange(e.target.value);
    container.appendChild(select);

    return container;
}

/**
 * Creates a standardized attribute row with label and input.
 *
 * @param {string} labelText - Label text
 * @param {HTMLElement} inputElement - Input element
 * @returns {HTMLElement} Attribute row container
 */
export function createAttributeRow(labelText, inputElement) {
    const container = document.createElement('div');
    container.className = 'attr-container-row';

    const label = document.createElement('label');
    label.textContent = labelText;

    const attrName = document.createElement('div');
    attrName.className = 'attr-name';
    attrName.appendChild(label);

    const attrInput = document.createElement('div');
    attrInput.className = 'attr-input';
    attrInput.appendChild(inputElement);

    container.appendChild(attrName);
    container.appendChild(attrInput);

    return container;
}
