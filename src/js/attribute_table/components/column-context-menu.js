// Path: js/attribute_table/components/column-context-menu.js

/**
 * @fileoverview Context menu for attribute column headers.
 */

import { ATTRIBUTE_TABLE_ICONS } from '../attribute-table.constants.js';
import { showConfirm } from '../../modals/index.js';

/**
 * @typedef {Object} ContextMenuCallbacks
 * @property {Function} onRemoveColumn - Remove column callback (columnKey)
 */

let activeMenu = null;
let activeClickHandler = null;
let activeEscapeHandler = null;

/**
 * Shows the column context menu.
 * @param {string} columnKey - Column key
 * @param {MouseEvent} event - Mouse event
 * @param {ContextMenuCallbacks} callbacks - Callbacks
 */
export function showColumnContextMenu(columnKey, event, callbacks) {
    // Close any existing menu
    hideColumnContextMenu();

    const menu = document.createElement('div');
    menu.className = 'attribute-table-column-menu';

    // Position menu
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;

    // Remove column option
    const removeItem = document.createElement('div');
    removeItem.className = 'attribute-table-column-menu-item danger';
    removeItem.innerHTML = `${ATTRIBUTE_TABLE_ICONS.DELETE}<span>Remover atributo</span>`;
    removeItem.title = `Remover "${columnKey}" de todas as feições`;

    removeItem.addEventListener('click', async (e) => {
        e.stopPropagation();
        hideColumnContextMenu();

        // Confirm before removing
        const confirmed = await showConfirm(`Remover o atributo "${columnKey}"?`, {
            message: 'Esta ação removerá o atributo de todas as feições desta camada e não pode ser desfeita.',
            destructive: true
        });

        if (confirmed && callbacks.onRemoveColumn) {
            callbacks.onRemoveColumn(columnKey);
        }
    });

    menu.appendChild(removeItem);

    // Add to document
    document.body.appendChild(menu);
    activeMenu = menu;

    // Adjust position if off-screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        menu.style.left = `${window.innerWidth - rect.width - 10}px`;
    }
    if (rect.bottom > window.innerHeight) {
        menu.style.top = `${window.innerHeight - rect.height - 10}px`;
    }

    // Close on click outside
    activeClickHandler = (e) => {
        if (!menu.contains(e.target)) {
            hideColumnContextMenu();
        }
    };

    // Delay to prevent immediate close
    setTimeout(() => {
        document.addEventListener('click', activeClickHandler);
    }, 10);

    // Close on escape
    activeEscapeHandler = (e) => {
        if (e.key === 'Escape') {
            hideColumnContextMenu();
        }
    };
    document.addEventListener('keydown', activeEscapeHandler);
}

/**
 * Hides the column context menu.
 */
export function hideColumnContextMenu() {
    if (activeClickHandler) {
        document.removeEventListener('click', activeClickHandler);
        activeClickHandler = null;
    }
    if (activeEscapeHandler) {
        document.removeEventListener('keydown', activeEscapeHandler);
        activeEscapeHandler = null;
    }
    if (activeMenu) {
        activeMenu.remove();
        activeMenu = null;
    }
}
