// Path: js/tool_manager/helpers/section-divider.helpers.js

/**
 * @fileoverview Section divider component for attribute panels.
 */

/**
 * Creates a section divider with a centered title.
 *
 * @param {string} title - The title text for the divider
 * @returns {HTMLElement} Section divider container element
 */
export function createSectionDivider(title) {
    const container = document.createElement('div');
    container.className = 'attr-section-divider';

    const leftLine = document.createElement('div');
    leftLine.className = 'attr-section-divider-line';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'attr-section-divider-title';
    titleSpan.textContent = title;

    const rightLine = document.createElement('div');
    rightLine.className = 'attr-section-divider-line';

    container.appendChild(leftLine);
    container.appendChild(titleSpan);
    container.appendChild(rightLine);

    return container;
}
