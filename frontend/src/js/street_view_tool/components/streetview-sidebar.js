// Path: js/street_view_tool/components/streetview-sidebar.js

/**
 * @fileoverview Toolbar and UI management for Street View 360.
 * Handles toolbar visibility, button states, active tool chip, and help popup.
 * Based on the 3D viewer toolbar pattern from map_3d.js.
 */

import { assinarEdicaoIndisponivel, semEdicaoSync } from '@store/edicao-indisponivel.js';

// =========================================================================
// STATE
// =========================================================================

let isInitialized = false;
/** Desassina o observador de "edicao indisponivel", para o init nao acumular um por abertura. */
let soltarEdicao = null;
let helpPopupOpen = false;

// DOM element references (cached after init)
const elements = {
    toolbar: null,
    activeToolChip: null,
    activeToolChipName: null,
    activeToolChipClose: null,
    helpPopup: null,
    helpButton: null,
    addMarkerButton: null,
    screenshotButton: null,
    saveOrientationButton: null,
    clearOrientationButton: null
};

// =========================================================================
// INITIALIZATION
// =========================================================================

/**
 * Initialize toolbar 360 event listeners and cache DOM elements.
 * Should be called once when the 360 viewer module loads.
 * @param {Object} [options]
 * @param {Function} [options.onDeactivateTool] - Viewer-owned cancellation command.
 */
export function initToolbar360({ onDeactivateTool } = {}) {
    if (isInitialized) return;

    // Cache DOM elements
    elements.toolbar = document.getElementById('toolbar-360');
    elements.activeToolChip = document.getElementById('active-tool-chip-360');
    elements.activeToolChipName = document.getElementById('active-tool-chip-360-name');
    elements.activeToolChipClose = document.getElementById('active-tool-chip-360-close');
    elements.helpPopup = document.getElementById('nav-help-popup-360');
    elements.helpButton = document.getElementById('help-360');
    elements.addMarkerButton = document.getElementById('add-marker-360');
    elements.screenshotButton = document.getElementById('screenshot-360');
    elements.saveOrientationButton = document.getElementById('salvar-orientacao-360');
    elements.clearOrientationButton = document.getElementById('limpar-orientacao-360');

    // Setup help popup
    if (elements.helpButton && elements.helpPopup) {
        elements.helpButton.addEventListener('click', toggleHelpPopup);
        setupHelpPopupTabs();
    }

    // Setup active tool chip close button
    if (elements.activeToolChipClose) {
        elements.activeToolChipClose.addEventListener('click', () => {
            onDeactivateTool?.();
        });
    }

    // Close help popup when clicking outside
    document.addEventListener('click', (e) => {
        if (helpPopupOpen && elements.helpPopup && elements.helpButton) {
            if (!elements.helpPopup.contains(e.target) && !elements.helpButton.contains(e.target)) {
                closeHelpPopup();
            }
        }
    });

    // A BARRA 360 SOME QUANDO NAO SE PODE EDITAR (pedido do dono, 2026-09-17), e sao DOIS consertos
    // no mesmo lugar. O primeiro: a conta era so a trava do mapa, entao quem entrava por
    // compartilhamento `read` ou por link publico via "adicionar marcador" e "salvar orientacao",
    // clicava, e a escrita morria no guarda da store. O segundo: nada aplicava o estado na ABERTURA,
    // so no evento, de modo que a barra nascia inteira sobre um mapa travado e so se corrigia se
    // alguem destravasse e travasse de novo. O assinante chama o callback uma vez, o que fecha os
    // dois. A regra de CSS ja existia (`#toolbar-360.map-locked .button-tool-360:not(#help-360)`).
    try {
        soltarEdicao?.();
        soltarEdicao = assinarEdicaoIndisponivel(() => {
            if (elements.toolbar) {
                elements.toolbar.classList.toggle('map-locked', semEdicaoSync());
            }
        });
    } catch (error) {
        console.warn('[streetview-sidebar] EventBus not available:', error);
    }

    isInitialized = true;
}

/**
 * Setup tab switching for help popup.
 */
function setupHelpPopupTabs() {
    const tabs = elements.helpPopup?.querySelectorAll('.nav-help-tab-360');
    const panels = elements.helpPopup?.querySelectorAll('.nav-help-panel-360');

    if (!tabs || !panels) return;

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetPanel = tab.dataset.tab;

            // Update tab states
            tabs.forEach(t => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');

            // Update panel visibility
            panels.forEach(p => {
                p.classList.toggle('active', p.dataset.panel === targetPanel);
            });
        });
    });
}

// =========================================================================
// TOOLBAR VISIBILITY
// =========================================================================

// =========================================================================
// ACTIVE TOOL CHIP
// =========================================================================

/**
 * Hide the active tool chip.
 */
export function hideActiveToolChip360() {
    if (elements.activeToolChip) {
        elements.activeToolChip.style.display = 'none';
    }
}

// =========================================================================
// ORIENTATION BUTTON STATE
// =========================================================================

// =========================================================================
// HELP POPUP
// =========================================================================

/**
 * Toggle the help popup visibility.
 */
function toggleHelpPopup() {
    if (helpPopupOpen) {
        closeHelpPopup();
    } else {
        openHelpPopup();
    }
}

/**
 * Open the help popup.
 */
function openHelpPopup() {
    if (elements.helpPopup && elements.helpButton) {
        elements.helpPopup.hidden = false;
        elements.helpButton.setAttribute('aria-expanded', 'true');
        helpPopupOpen = true;
    }
}

/**
 * Close the help popup.
 */
function closeHelpPopup() {
    if (elements.helpPopup && elements.helpButton) {
        elements.helpPopup.hidden = true;
        elements.helpButton.setAttribute('aria-expanded', 'false');
        helpPopupOpen = false;
    }
}

/**
 * Check if help popup is currently open.
 * @returns {boolean}
 */
export function isHelpPopupOpen360() {
    return helpPopupOpen;
}

// =========================================================================
// BUTTON EVENT REGISTRATION
// =========================================================================

/**
 * Register a click handler for the add marker button.
 * @param {Function} handler - Click handler function
 */
export function onAddMarkerClick(handler) {
    if (elements.addMarkerButton) {
        elements.addMarkerButton.addEventListener('click', () => {
            // Mesma conta do desenho (papel e trava): o comando escondido ainda pode ser
            // alcancado por atalho de teclado, e o portao e o que fecha esse caminho.
            if (semEdicaoSync()) return;
            handler();
        });
    }
}

/**
 * Register a click handler for the save orientation button.
 * @param {Function} handler - Click handler function
 */
export function onSaveOrientationClick(handler) {
    if (elements.saveOrientationButton) {
        elements.saveOrientationButton.addEventListener('click', () => {
            // Mesma conta do desenho (papel e trava): o comando escondido ainda pode ser
            // alcancado por atalho de teclado, e o portao e o que fecha esse caminho.
            if (semEdicaoSync()) return;
            handler();
        });
    }
}

/**
 * Register a click handler for the clear orientation button.
 * @param {Function} handler - Click handler function
 */
export function onClearOrientationClick(handler) {
    if (elements.clearOrientationButton) {
        elements.clearOrientationButton.addEventListener('click', () => {
            // Mesma conta do desenho (papel e trava): o comando escondido ainda pode ser
            // alcancado por atalho de teclado, e o portao e o que fecha esse caminho.
            if (semEdicaoSync()) return;
            handler();
        });
    }
}

/**
 * Set the active state of the marker button.
 * @param {boolean} active - Whether the button should appear active
 */
export function setMarkerButtonActive(active) {
    if (elements.addMarkerButton) {
        elements.addMarkerButton.classList.toggle('active', active);
    }
}

// =========================================================================
// CLEANUP
// =========================================================================

