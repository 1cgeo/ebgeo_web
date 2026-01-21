// Path: js/tool_manager/helpers/hatch-control.helpers.js

/**
 * @fileoverview Hatch pattern control component for attribute panels.
 */

/**
 * Hatch pattern definitions.
 */
const HATCH_PATTERNS = [
    { id: 'none', label: 'Nenhuma', icon: null },
    { id: 'diagonal-right', label: 'Diagonal /', angle: 45 },
    { id: 'diagonal-left', label: 'Diagonal \\', angle: -45 },
    { id: 'horizontal', label: 'Horizontal', angle: 0 },
    { id: 'vertical', label: 'Vertical', angle: 90 },
    { id: 'cross', label: 'Cruz +', angles: [0, 90] },
    { id: 'cross-diagonal', label: 'Cruz X', angles: [45, -45] },
    { id: 'dots', label: 'Pontos', type: 'dots' },
];

/**
 * SVG icons.
 */
const ICONS = {
    settings: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>',
    x: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
};

/**
 * Creates a hatch pattern preview SVG.
 *
 * @param {Object} pattern - Hatch pattern object
 * @param {string} [color='#000000'] - Hatch color
 * @param {number} [size=24] - SVG size
 * @returns {string} SVG markup
 */
function createHatchPreviewSVG(pattern, color = '#000000', size = 24) {
    if (pattern.id === 'none') {
        return `
            <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
                <rect width="${size}" height="${size}" fill="#f3f4f6" rx="4"/>
                <line x1="4" y1="4" x2="${size - 4}" y2="${size - 4}" stroke="#9ca3af" stroke-width="2"/>
                <line x1="${size - 4}" y1="4" x2="4" y2="${size - 4}" stroke="#9ca3af" stroke-width="2"/>
            </svg>
        `;
    }

    const patternId = `hatch-preview-${pattern.id}-${Math.random().toString(36).substr(2, 9)}`;
    let patternContent = '';

    if (pattern.type === 'dots') {
        patternContent = `
            <pattern id="${patternId}" patternUnits="userSpaceOnUse" width="6" height="6">
                <circle cx="3" cy="3" r="1" fill="${color}"/>
            </pattern>
        `;
    } else if (pattern.angles) {
        const lines = pattern.angles.map(angle => {
            if (angle === 0) {
                return `<line x1="0" y1="4" x2="8" y2="4" stroke="${color}" stroke-width="1"/>`;
            } else if (angle === 90) {
                return `<line x1="4" y1="0" x2="4" y2="8" stroke="${color}" stroke-width="1"/>`;
            } else if (angle === 45) {
                return `<line x1="0" y1="8" x2="8" y2="0" stroke="${color}" stroke-width="1"/>`;
            } else {
                return `<line x1="0" y1="0" x2="8" y2="8" stroke="${color}" stroke-width="1"/>`;
            }
        }).join('');
        patternContent = `
            <pattern id="${patternId}" patternUnits="userSpaceOnUse" width="8" height="8">
                ${lines}
            </pattern>
        `;
    } else {
        let line = '';
        if (pattern.angle === 0) {
            line = `<line x1="0" y1="4" x2="8" y2="4" stroke="${color}" stroke-width="1"/>`;
        } else if (pattern.angle === 90) {
            line = `<line x1="4" y1="0" x2="4" y2="8" stroke="${color}" stroke-width="1"/>`;
        } else if (pattern.angle === 45) {
            line = `<line x1="0" y1="8" x2="8" y2="0" stroke="${color}" stroke-width="1"/>`;
        } else {
            line = `<line x1="0" y1="0" x2="8" y2="8" stroke="${color}" stroke-width="1"/>`;
        }
        patternContent = `
            <pattern id="${patternId}" patternUnits="userSpaceOnUse" width="8" height="8">
                ${line}
            </pattern>
        `;
    }

    return `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
            <defs>${patternContent}</defs>
            <rect width="${size}" height="${size}" fill="url(#${patternId})" rx="4"/>
            <rect width="${size}" height="${size}" fill="none" stroke="#d1d5db" stroke-width="1" rx="4"/>
        </svg>
    `;
}

/**
 * Creates a modern hatch control with toggle, pattern grid, and config panel.
 *
 * @param {Object} config - Configuration object
 * @param {boolean} config.enabled - Whether hatch is enabled
 * @param {Function} config.onToggle - Callback when toggle changes
 * @param {string} config.hatchType - Current hatch pattern ID
 * @param {Function} config.onTypeChange - Callback when pattern changes
 * @param {string} config.hatchColor - Current hatch color
 * @param {Function} config.onColorChange - Callback when color changes
 * @param {number} config.hatchSpacing - Current spacing value
 * @param {Function} config.onSpacingChange - Callback when spacing changes
 * @param {number} config.hatchLineWidth - Current line width
 * @param {Function} config.onLineWidthChange - Callback when line width changes
 * @param {string} [config.label='Hachura'] - Label text
 * @returns {HTMLElement} Hatch control container
 */
export function createModernHatchControl(config) {
    const {
        enabled,
        onToggle,
        hatchType,
        onTypeChange,
        hatchColor,
        onColorChange,
        hatchSpacing,
        onSpacingChange,
        hatchLineWidth,
        onLineWidthChange,
        label = 'Hachura'
    } = config;

    let isConfigOpen = false;
    let configPanel = null;

    const container = document.createElement('div');
    container.className = 'attr-modern-hatch';

    // Header with label and toggle
    const header = document.createElement('div');
    header.className = 'attr-modern-hatch-header';

    const labelEl = document.createElement('label');
    labelEl.className = 'attr-modern-hatch-label';
    labelEl.textContent = label;
    header.appendChild(labelEl);

    // Toggle switch
    const toggle = document.createElement('div');
    toggle.className = 'attr-modern-toggle-switch';
    if (enabled) {
        toggle.classList.add('active');
    }

    const toggleThumb = document.createElement('div');
    toggleThumb.className = 'attr-modern-toggle-thumb';
    toggle.appendChild(toggleThumb);

    toggle.addEventListener('click', () => {
        const newState = !toggle.classList.contains('active');
        toggle.classList.toggle('active', newState);
        updateControlsState(newState);
        onToggle(newState);
    });

    header.appendChild(toggle);
    container.appendChild(header);

    // Patterns content (grid + config)
    const contentWrapper = document.createElement('div');
    contentWrapper.style.cssText = enabled ? '' : 'opacity: 0.5; pointer-events: none;';

    // Pattern grid
    const grid = document.createElement('div');
    grid.className = 'attr-modern-hatch-grid';

    HATCH_PATTERNS.forEach(pattern => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'attr-modern-hatch-btn';
        btn.dataset.patternId = pattern.id;
        if (pattern.id === hatchType) {
            btn.classList.add('selected');
        }

        const preview = document.createElement('div');
        preview.className = 'attr-modern-hatch-preview';
        preview.innerHTML = createHatchPreviewSVG(pattern, hatchColor);
        btn.appendChild(preview);

        btn.title = pattern.label;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            // Update selection
            grid.querySelectorAll('.attr-modern-hatch-btn').forEach(b => {
                b.classList.toggle('selected', b.dataset.patternId === pattern.id);
            });
            onTypeChange(pattern.id);
        });

        grid.appendChild(btn);
    });

    contentWrapper.appendChild(grid);

    // Config button
    const configBtn = document.createElement('button');
    configBtn.type = 'button';
    configBtn.className = 'attr-modern-hatch-config-btn';
    configBtn.innerHTML = `${ICONS.settings}<span>Configurar hachura</span>`;

    const closeConfigPanel = () => {
        if (configPanel && configPanel.parentNode) {
            configPanel.remove();
            configPanel = null;
        }
        isConfigOpen = false;
    };

    const openConfigPanel = () => {
        if (isConfigOpen) {
            closeConfigPanel();
            return;
        }

        isConfigOpen = true;
        configPanel = document.createElement('div');
        configPanel.className = 'attr-modern-hatch-config-panel';

        const title = document.createElement('div');
        title.className = 'attr-modern-hatch-config-title';
        title.textContent = 'Configurações de Hachura';
        configPanel.appendChild(title);

        // Color row
        const colorRow = document.createElement('div');
        colorRow.className = 'attr-modern-hatch-config-row';

        const colorLabel = document.createElement('label');
        colorLabel.className = 'attr-modern-hatch-config-label';
        colorLabel.textContent = 'Cor da Hachura';
        colorRow.appendChild(colorLabel);

        const colorWrapper = document.createElement('div');
        colorWrapper.className = 'attr-modern-hatch-config-color';

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = hatchColor;
        colorInput.addEventListener('input', (e) => {
            colorText.textContent = e.target.value;
            onColorChange(e.target.value);
            updatePatternPreviews(e.target.value);
        });

        const colorText = document.createElement('span');
        colorText.textContent = hatchColor;

        colorWrapper.appendChild(colorInput);
        colorWrapper.appendChild(colorText);
        colorRow.appendChild(colorWrapper);
        configPanel.appendChild(colorRow);

        // Spacing row
        const spacingRow = document.createElement('div');
        spacingRow.className = 'attr-modern-hatch-config-row';

        const spacingLabel = document.createElement('label');
        spacingLabel.className = 'attr-modern-hatch-config-label';
        spacingLabel.textContent = `Espaçamento: ${hatchSpacing}px`;
        spacingRow.appendChild(spacingLabel);

        const spacingSlider = document.createElement('input');
        spacingSlider.type = 'range';
        spacingSlider.className = 'attr-modern-hatch-config-slider';
        spacingSlider.min = 4;
        spacingSlider.max = 24;
        spacingSlider.value = hatchSpacing;
        spacingSlider.addEventListener('input', (e) => {
            spacingLabel.textContent = `Espaçamento: ${e.target.value}px`;
            onSpacingChange(Number(e.target.value));
        });

        spacingRow.appendChild(spacingSlider);
        configPanel.appendChild(spacingRow);

        // Line width row
        const widthRow = document.createElement('div');
        widthRow.className = 'attr-modern-hatch-config-row';

        const widthLabel = document.createElement('label');
        widthLabel.className = 'attr-modern-hatch-config-label';
        widthLabel.textContent = `Espessura: ${hatchLineWidth}px`;
        widthRow.appendChild(widthLabel);

        const widthSlider = document.createElement('input');
        widthSlider.type = 'range';
        widthSlider.className = 'attr-modern-hatch-config-slider';
        widthSlider.min = 1;
        widthSlider.max = 6;
        widthSlider.value = hatchLineWidth;
        widthSlider.addEventListener('input', (e) => {
            widthLabel.textContent = `Espessura: ${e.target.value}px`;
            onLineWidthChange(Number(e.target.value));
        });

        widthRow.appendChild(widthSlider);
        configPanel.appendChild(widthRow);

        contentWrapper.appendChild(configPanel);

        // Close on click outside
        const handleClickOutside = (e) => {
            if (!contentWrapper.contains(e.target) || e.target === configBtn || configBtn.contains(e.target)) {
                return;
            }
            if (configPanel && !configPanel.contains(e.target)) {
                closeConfigPanel();
                document.removeEventListener('mousedown', handleClickOutside);
            }
        };
        setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 0);
    };

    configBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openConfigPanel();
    });

    contentWrapper.appendChild(configBtn);
    container.appendChild(contentWrapper);

    // Helper function to update controls state
    const updateControlsState = (isEnabled) => {
        contentWrapper.style.cssText = isEnabled ? '' : 'opacity: 0.5; pointer-events: none;';
        if (!isEnabled) {
            closeConfigPanel();
        }
    };

    // Helper function to update pattern previews when color changes
    const updatePatternPreviews = (color) => {
        const buttons = grid.querySelectorAll('.attr-modern-hatch-btn');
        buttons.forEach((btn, index) => {
            const pattern = HATCH_PATTERNS[index];
            const preview = btn.querySelector('.attr-modern-hatch-preview');
            if (preview) {
                preview.innerHTML = createHatchPreviewSVG(pattern, color);
            }
        });
    };

    return container;
}

/**
 * Gets all available hatch patterns.
 *
 * @returns {Array} Array of hatch pattern objects
 */
export function getHatchPatterns() {
    return [...HATCH_PATTERNS];
}
