// Path: js/tool_manager/helpers/hatch-control.helpers.js

/**
 * @fileoverview Hatch pattern control component for attribute panels.
 * Hatch color follows the fill color automatically.
 */

import { createModernSlider } from './slider.helpers.js';

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
 * Creates a modern hatch control with pattern grid and inline sliders.
 * The "none" pattern option serves as the disabled state.
 * Hatch color follows the fill color automatically.
 * Sliders appear when a hatch pattern is selected (not "none").
 *
 * @param {Object} config - Configuration object
 * @param {string} config.hatchType - Current hatch pattern ID
 * @param {Function} config.onTypeChange - Callback when pattern changes
 * @param {string} config.fillColor - Fill color (used for hatch color)
 * @param {number} config.hatchSpacing - Current spacing value
 * @param {Function} config.onSpacingChange - Callback when spacing changes
 * @param {number} config.hatchLineWidth - Current line width
 * @param {Function} config.onLineWidthChange - Callback when line width changes
 * @param {string} [config.label='Hachura'] - Label text
 * @returns {HTMLElement} Hatch control container
 */
export function createModernHatchControl(config) {
    const {
        hatchType,
        onTypeChange,
        fillColor = '#000000',
        hatchSpacing,
        onSpacingChange,
        hatchLineWidth,
        onLineWidthChange,
        label = 'Hachura'
    } = config;

    const container = document.createElement('div');
    container.className = 'attr-modern-hatch';

    // Header with label only (no toggle - "none" pattern serves as disabled)
    const labelEl = document.createElement('label');
    labelEl.className = 'attr-modern-hatch-label';
    labelEl.textContent = label;
    labelEl.style.marginBottom = '8px';
    labelEl.style.display = 'block';
    container.appendChild(labelEl);

    // Patterns content (grid + sliders)
    const contentWrapper = document.createElement('div');

    // Pattern grid
    const grid = document.createElement('div');
    grid.className = 'attr-modern-hatch-grid';

    // Use fillColor for preview
    const previewColor = fillColor;

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
        preview.innerHTML = createHatchPreviewSVG(pattern, previewColor, 36);
        btn.appendChild(preview);

        btn.title = pattern.label;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            // Update selection
            grid.querySelectorAll('.attr-modern-hatch-btn').forEach(b => {
                b.classList.toggle('selected', b.dataset.patternId === pattern.id);
            });
            onTypeChange(pattern.id);
            // Show/hide sliders based on pattern
            updateSlidersVisibility(pattern.id !== 'none');
        });

        grid.appendChild(btn);
    });

    contentWrapper.appendChild(grid);

    // Sliders container (shown when hatch is active)
    const slidersContainer = document.createElement('div');
    slidersContainer.className = 'attr-modern-hatch-sliders';

    // Spacing slider using createModernSlider (same as "Espessura da Borda")
    const spacingSlider = createModernSlider({
        label: 'Espaçamento da Hachura',
        min: 4,
        max: 24,
        step: 1,
        value: hatchSpacing,
        unit: 'px',
        onChange: onSpacingChange
    });
    slidersContainer.appendChild(spacingSlider);

    // Line width slider using createModernSlider (same as "Espessura da Borda")
    const widthSlider = createModernSlider({
        label: 'Espessura da Hachura',
        min: 1,
        max: 6,
        step: 1,
        value: hatchLineWidth,
        unit: 'px',
        onChange: onLineWidthChange
    });
    slidersContainer.appendChild(widthSlider);

    contentWrapper.appendChild(slidersContainer);
    container.appendChild(contentWrapper);

    // Function to show/hide sliders
    const updateSlidersVisibility = (show) => {
        slidersContainer.style.display = show ? 'block' : 'none';
    };

    // Initial visibility based on current hatch type
    updateSlidersVisibility(hatchType !== 'none');

    // Helper function to update pattern previews when fill color changes
    container.updatePreviewColor = (color) => {
        const buttons = grid.querySelectorAll('.attr-modern-hatch-btn');
        buttons.forEach((btn, index) => {
            const pattern = HATCH_PATTERNS[index];
            const preview = btn.querySelector('.attr-modern-hatch-preview');
            if (preview) {
                preview.innerHTML = createHatchPreviewSVG(pattern, color, 36);
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
