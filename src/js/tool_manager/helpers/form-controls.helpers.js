// Path: js/tool_manager/helpers/form-controls.helpers.js

/**
 * @fileoverview Form control components for attribute panels.
 */

/**
 * Creates a modern toggle switch.
 *
 * @param {Object} config - Configuration object
 * @param {string} config.label - Label text
 * @param {boolean} config.checked - Initial checked state
 * @param {Function} config.onChange - Callback when toggle changes (receives boolean)
 * @param {string} [config.id] - Optional ID for the toggle container
 * @returns {HTMLElement} Toggle container element
 */
export function createModernToggle(config) {
    const { label, checked, onChange, id } = config;

    const container = document.createElement('div');
    container.className = 'attr-modern-toggle';
    if (id) container.id = id;

    const labelEl = document.createElement('label');
    labelEl.className = 'attr-modern-toggle-label';
    labelEl.textContent = label;
    container.appendChild(labelEl);

    const toggle = document.createElement('div');
    toggle.className = 'attr-modern-toggle-switch';
    if (checked) {
        toggle.classList.add('active');
    }

    const thumb = document.createElement('div');
    thumb.className = 'attr-modern-toggle-thumb';
    toggle.appendChild(thumb);

    toggle.addEventListener('click', () => {
        const newState = !toggle.classList.contains('active');
        toggle.classList.toggle('active', newState);
        onChange(newState);
    });

    container.appendChild(toggle);

    // Add method to programmatically set state
    container.setChecked = (isChecked) => {
        toggle.classList.toggle('active', isChecked);
    };

    return container;
}

/**
 * Creates a modern select dropdown.
 *
 * @param {Object} config - Configuration object
 * @param {string} config.label - Label text
 * @param {string} config.value - Currently selected value
 * @param {Function} config.onChange - Callback when selection changes (receives value string)
 * @param {Array<{value: string, label: string}>} config.options - Select options
 * @returns {HTMLElement} Select container element
 */
export function createModernSelect(config) {
    const { label, value, onChange, options } = config;

    const container = document.createElement('div');
    container.className = 'attr-modern-select';

    const labelEl = document.createElement('label');
    labelEl.className = 'attr-modern-select-label';
    labelEl.textContent = label;
    container.appendChild(labelEl);

    const select = document.createElement('select');
    select.className = 'attr-modern-select-input';

    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        option.selected = opt.value === value;
        select.appendChild(option);
    });

    select.addEventListener('change', (e) => {
        onChange(e.target.value);
    });

    container.appendChild(select);

    return container;
}

/**
 * Creates a modern textarea input.
 *
 * @param {Object} config - Configuration object
 * @param {string} [config.label] - Label text (optional)
 * @param {string} config.value - Initial text value
 * @param {Function} config.onChange - Callback when text changes (receives text string)
 * @param {number} [config.rows=3] - Number of rows
 * @param {string} [config.placeholder=''] - Placeholder text
 * @returns {HTMLElement} Textarea container element
 */
export function createModernTextarea(config) {
    const { label, value, onChange, rows = 3, placeholder = '' } = config;

    const container = document.createElement('div');
    container.className = 'attr-modern-textarea';

    if (label) {
        const labelEl = document.createElement('label');
        labelEl.className = 'attr-modern-textarea-label';
        labelEl.textContent = label;
        container.appendChild(labelEl);
    }

    const textarea = document.createElement('textarea');
    textarea.className = 'attr-modern-textarea-input';
    textarea.value = value || '';
    textarea.rows = rows;
    textarea.placeholder = placeholder;

    textarea.addEventListener('input', (e) => {
        onChange(e.target.value);
    });

    container.appendChild(textarea);

    // Add method to get textarea element for external manipulation
    container.getTextarea = () => textarea;

    return container;
}

/**
 * Creates modern tabs navigation.
 *
 * @param {Object} config - Configuration object
 * @param {Array<{id: string, label: string}>} config.tabs - Tab definitions
 * @param {string} config.activeTab - Initially active tab ID
 * @param {Function} config.onTabChange - Callback when tab changes (receives tab ID)
 * @returns {HTMLElement} Tabs container element
 */
export function createModernTabs(config) {
    const { tabs, activeTab, onTabChange } = config;

    const container = document.createElement('div');
    container.className = 'attr-modern-tabs';

    tabs.forEach(tab => {
        const tabBtn = document.createElement('button');
        tabBtn.type = 'button';
        tabBtn.className = 'attr-modern-tab';
        tabBtn.dataset.tabId = tab.id;
        tabBtn.textContent = tab.label;

        if (tab.id === activeTab) {
            tabBtn.classList.add('active');
        }

        tabBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Update active tab
            container.querySelectorAll('.attr-modern-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.tabId === tab.id);
            });
            onTabChange(tab.id);
        });

        container.appendChild(tabBtn);
    });

    // Add method to programmatically change tab
    container.setActiveTab = (tabId) => {
        container.querySelectorAll('.attr-modern-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tabId === tabId);
        });
    };

    return container;
}

/**
 * Creates a modern info box for displaying read-only information.
 *
 * @param {Object} config - Configuration object
 * @param {string} [config.title] - Optional title
 * @param {Array<{color?: string, text: string}>} config.rows - Info rows
 * @returns {HTMLElement} Info box container element
 */
export function createModernInfoBox(config) {
    const { title, rows } = config;

    const container = document.createElement('div');
    container.className = 'attr-modern-info-box';

    if (title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'attr-modern-info-title';
        titleEl.textContent = title;
        container.appendChild(titleEl);
    }

    rows.forEach(row => {
        const rowEl = document.createElement('div');
        rowEl.className = 'attr-modern-info-row';

        if (row.color) {
            const colorEl = document.createElement('div');
            colorEl.className = 'attr-modern-info-color';
            colorEl.style.backgroundColor = row.color;
            rowEl.appendChild(colorEl);
        }

        const textEl = document.createElement('span');
        textEl.className = 'attr-modern-info-text';
        textEl.textContent = row.text;
        rowEl.appendChild(textEl);

        container.appendChild(rowEl);
    });

    return container;
}

// ============================================================================
// LEGACY API - Maintain backward compatibility
// ============================================================================

/**
 * Creates a standardized toggle checkbox.
 * @deprecated Use createModernToggle instead
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
 * @deprecated Use createModernLineStyleSelect from line-style.helpers.js instead
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
