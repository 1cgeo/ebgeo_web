// Path: js/tool_manager/helpers/text-alignment.helpers.js

/**
 * @fileoverview Text alignment selector component for attribute panels.
 */

/**
 * Alignment options with SVG icons.
 */
const ALIGNMENTS = [
    {
        id: 'left',
        label: 'Esquerda',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="17" y1="18" x2="3" y2="18"></line></svg>'
    },
    {
        id: 'center',
        label: 'Centro',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="10" x2="6" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="18" y1="18" x2="6" y2="18"></line></svg>'
    },
    {
        id: 'right',
        label: 'Direita',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="10" x2="7" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="21" y1="18" x2="7" y2="18"></line></svg>'
    }
];

/**
 * Creates a modern text alignment selector with icon buttons.
 *
 * @param {Object} config - Configuration object
 * @param {string} config.value - Currently selected alignment ID
 * @param {Function} config.onChange - Callback when alignment changes
 * @param {string} [config.label='Alinhamento'] - Label text
 * @param {boolean} [config.disabled=false] - Whether the control is disabled
 * @returns {HTMLElement} Text alignment selector container
 */
export function createModernTextAlignment(config) {
    const { value, onChange, label = 'Alinhamento', disabled = false } = config;
    let currentValue = value || 'center';
    let isDisabled = disabled;

    const container = document.createElement('div');
    container.className = 'attr-modern-alignment';

    const labelEl = document.createElement('label');
    labelEl.className = 'attr-modern-alignment-label';
    labelEl.textContent = label;
    container.appendChild(labelEl);

    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'attr-modern-alignment-buttons';

    ALIGNMENTS.forEach(alignment => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'attr-modern-alignment-btn';
        btn.dataset.alignmentId = alignment.id;
        if (alignment.id === currentValue) {
            btn.classList.add('selected');
        }
        if (isDisabled) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        }

        btn.innerHTML = alignment.icon;
        btn.title = alignment.label;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (isDisabled) return;

            currentValue = alignment.id;

            // Update selection
            buttonsContainer.querySelectorAll('.attr-modern-alignment-btn').forEach(b => {
                b.classList.toggle('selected', b.dataset.alignmentId === alignment.id);
            });

            onChange(alignment.id);
        });

        buttonsContainer.appendChild(btn);
    });

    container.appendChild(buttonsContainer);

    // Add method to update disabled state
    container.setDisabled = (newDisabledState) => {
        isDisabled = newDisabledState;
        buttonsContainer.querySelectorAll('.attr-modern-alignment-btn').forEach(btn => {
            btn.disabled = newDisabledState;
            btn.style.opacity = newDisabledState ? '0.5' : '';
            btn.style.cursor = newDisabledState ? 'not-allowed' : '';
        });
    };

    // Add method to update value externally
    container.setValue = (newValue) => {
        currentValue = newValue;
        buttonsContainer.querySelectorAll('.attr-modern-alignment-btn').forEach(b => {
            b.classList.toggle('selected', b.dataset.alignmentId === newValue);
        });
    };

    return container;
}

/**
 * Gets all available alignment options.
 *
 * @returns {Array} Array of alignment objects
 */
export function getAlignments() {
    return [...ALIGNMENTS];
}
