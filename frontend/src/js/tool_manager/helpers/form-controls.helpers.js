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
 * @param {string} [config.className] - Optional extra CSS class for the toggle container
 * @returns {HTMLElement} Toggle container element
 */
export function createModernToggle(config) {
    const { label, checked, onChange, id, className } = config;

    const container = document.createElement('div');
    container.className = 'attr-modern-toggle';
    if (id) container.id = id;
    if (className) container.classList.add(className);

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
 * Creates modern tabs navigation with optional content management.
 *
 * @param {Object} config - Configuration object
 * @param {Array<{id: string, label: string, content?: HTMLElement}>} config.tabs - Tab definitions
 * @param {string} [config.activeTab] - Initially active tab ID (legacy)
 * @param {string} [config.defaultTab] - Initially active tab ID (alias for activeTab)
 * @param {Function} [config.onTabChange] - Callback when tab changes (receives tab ID)
 * @returns {HTMLElement} Tabs container element (includes content panels if provided)
 */
export function createModernTabs(config) {
    const { tabs, activeTab, defaultTab, onTabChange } = config;
    const initialTab = activeTab || defaultTab || (tabs.length > 0 ? tabs[0].id : null);
    const hasContent = tabs.some(tab => tab.content);

    const wrapper = document.createElement('div');
    wrapper.className = 'attr-modern-tabs-wrapper';

    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'attr-modern-tabs';

    // Create content container if tabs have content
    let contentContainer = null;
    const contentPanels = new Map();

    if (hasContent) {
        contentContainer = document.createElement('div');
        contentContainer.className = 'attr-modern-tabs-content';
    }

    tabs.forEach(tab => {
        const tabBtn = document.createElement('button');
        tabBtn.type = 'button';
        tabBtn.className = 'attr-modern-tab';
        tabBtn.dataset.tabId = tab.id;
        tabBtn.textContent = tab.label;

        if (tab.id === initialTab) {
            tabBtn.classList.add('active');
        }

        // Create content panel if content provided
        if (tab.content && contentContainer) {
            const panel = document.createElement('div');
            panel.className = 'attr-modern-tab-panel';
            panel.dataset.tabId = tab.id;
            panel.appendChild(tab.content);

            if (tab.id !== initialTab) {
                panel.style.display = 'none';
            }

            contentPanels.set(tab.id, panel);
            contentContainer.appendChild(panel);
        }

        tabBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Update active tab button
            tabsContainer.querySelectorAll('.attr-modern-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.tabId === tab.id);
            });

            // Update content panels visibility
            if (hasContent) {
                contentPanels.forEach((panel, id) => {
                    panel.style.display = id === tab.id ? '' : 'none';
                });
            }

            if (onTabChange) {
                onTabChange(tab.id);
            }
        });

        tabsContainer.appendChild(tabBtn);
    });

    wrapper.appendChild(tabsContainer);

    if (contentContainer) {
        wrapper.appendChild(contentContainer);
    }

    // Add method to programmatically change tab
    wrapper.setActiveTab = (tabId) => {
        tabsContainer.querySelectorAll('.attr-modern-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tabId === tabId);
        });
        if (hasContent) {
            contentPanels.forEach((panel, id) => {
                panel.style.display = id === tabId ? '' : 'none';
            });
        }
    };

    return wrapper;
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

