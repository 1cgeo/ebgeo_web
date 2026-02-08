// Path: js/modals/shortcuts.modal.js

/**
 * @fileoverview Shortcuts modal.
 * Displays keyboard shortcuts organized by category.
 */

import { ModalBase } from './modal.base.js';
import { TOOLBAR_ICONS } from '../toolbar/toolbar.constants.js';

/**
 * SVG icons for shortcuts modal categories.
 * Uses consistent icons from toolbar.
 */
const SHORTCUT_ICONS = {
    system: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><path d="M6 8h.001"/><path d="M10 8h.001"/><path d="M14 8h.001"/><path d="M18 8h.001"/><path d="M8 12h.001"/><path d="M12 12h.001"/><path d="M16 12h.001"/><path d="M7 16h10"/></svg>`,
    draw: TOOLBAR_ICONS.draw,
    military: TOOLBAR_ICONS.military,
    analysis: TOOLBAR_ICONS.analysis,
    other: TOOLBAR_ICONS.featureInfo,
    viewer3d: TOOLBAR_ICONS.viewer3d,
};

/**
 * Shortcuts data organized by category.
 */
const SHORTCUTS_DATA = {
    system: {
        title: 'Sistema',
        icon: SHORTCUT_ICONS.system,
        shortcuts: [
            { key: 'Delete', description: 'Deletar feições selecionados' },
            { key: 'Escape', description: 'Desativar ferramenta / desselecionar' },
            { key: 'Ctrl+Z', description: 'Desfazer última ação' },
            { key: 'Ctrl+Y', description: 'Refazer última ação' },
            { key: 'Ctrl+C', description: 'Copiar feições selecionados' },
            { key: 'Ctrl+V', description: 'Colar feições' },
        ],
    },
    drawing: {
        title: 'Desenho',
        icon: SHORTCUT_ICONS.draw,
        shortcuts: [
            { key: 'P', icon: TOOLBAR_ICONS.point, description: 'Ponto' },
            { key: 'L', icon: TOOLBAR_ICONS.line, description: 'Linha' },
            { key: 'A', icon: TOOLBAR_ICONS.polygon, description: 'Polígono' },
            { key: 'R', icon: TOOLBAR_ICONS.rectangle, description: 'Retângulo' },
            { key: 'C', icon: TOOLBAR_ICONS.circle, description: 'Círculo' },
            { key: 'E', icon: TOOLBAR_ICONS.ellipse, description: 'Elipse' },
            { key: 'T', icon: TOOLBAR_ICONS.text, description: 'Texto' },
            { key: 'I', icon: TOOLBAR_ICONS.image, description: 'Imagem' },
            { key: 'B', icon: TOOLBAR_ICONS.brush, description: 'Pincel' },
            { key: 'U', icon: TOOLBAR_ICONS.sector, description: 'Setor' },
            { key: 'Z', icon: TOOLBAR_ICONS.azimuthDistance, description: 'Azimute e distância' },
        ],
    },
    military: {
        title: 'Militar',
        icon: SHORTCUT_ICONS.military,
        shortcuts: [
            { key: 'M', icon: TOOLBAR_ICONS.militarySymbol, description: 'Símbolo militar' },
            { key: 'K', icon: TOOLBAR_ICONS.coordination, description: 'Medida de coordenação' },
            { key: 'S', icon: TOOLBAR_ICONS.arrow, description: 'Seta' },
            { key: 'D', icon: TOOLBAR_ICONS.boundary, description: 'Linha de limite' },
            { key: 'F', icon: TOOLBAR_ICONS.occupiedFront, description: 'Frente ocupada' },
        ],
    },
    analysis: {
        title: 'Análise (requer terreno)',
        icon: SHORTCUT_ICONS.analysis,
        shortcuts: [
            { key: 'V', icon: TOOLBAR_ICONS.visibility, description: 'Análise de visibilidade' },
            { key: 'O', icon: TOOLBAR_ICONS.los, description: 'Linha de visada' },
        ],
    },
    other: {
        title: 'Utilitários',
        icon: SHORTCUT_ICONS.other,
        shortcuts: [
            { key: 'Q', icon: TOOLBAR_ICONS.select, description: 'Seleção retangular' },
            { key: 'N', icon: TOOLBAR_ICONS.featureInfo, description: 'Informações da carta' },
            { key: 'G', icon: TOOLBAR_ICONS.snapping, description: 'Ativar/desativar snap' },
        ],
    },
    viewer3d: {
        title: 'Visualizador 3D',
        icon: SHORTCUT_ICONS.viewer3d,
        shortcuts: [
            { key: 'Delete', description: 'Deletar feição selecionada' },
            { key: 'V', icon: TOOLBAR_ICONS.visibility, description: 'Análise de visibilidade' },
            { key: 'D', icon: TOOLBAR_ICONS.measureDistance, description: 'Medir distância' },
            { key: 'A', icon: TOOLBAR_ICONS.measureArea, description: 'Medir área' },
            { key: 'M', icon: TOOLBAR_ICONS.marker3d, description: 'Adicionar marcador' },
        ],
    },
};

/**
 * Shortcuts modal class.
 */
export class ShortcutsModal extends ModalBase {
    constructor() {
        super({
            id: 'shortcuts-modal-new',
            title: 'Atalhos de Teclado',
            icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><path d="M6 8h.001"/><path d="M10 8h.001"/><path d="M14 8h.001"/><path d="M18 8h.001"/><path d="M8 12h.001"/><path d="M12 12h.001"/><path d="M16 12h.001"/><path d="M7 16h10"/></svg>`,
        });
    }

    /**
     * Renders the modal with shortcuts content.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        const body = this.getBody();

        if (body) {
            body.innerHTML = this._createContent();
        }

        // Add specific class for width
        this._container.classList.add('shortcuts-modal-container');

        return overlay;
    }

    /**
     * Creates the shortcuts content HTML.
     * @private
     * @returns {string}
     */
    _createContent() {
        let html = '<div class="shortcuts-sections">';

        Object.values(SHORTCUTS_DATA).forEach(category => {
            html += `
                <div class="shortcuts-section">
                    <div class="shortcuts-section-header">
                        <span class="shortcuts-section-icon">${category.icon}</span>
                        <h3 class="shortcuts-section-title">${category.title}</h3>
                    </div>
                    <div class="shortcuts-list">
            `;

            category.shortcuts.forEach(shortcut => {
                const toolIcon = shortcut.icon ? `<span class="shortcut-tool-icon">${shortcut.icon}</span>` : '';
                html += `
                    <div class="shortcut-item">
                        <kbd class="shortcut-key">${this._formatKey(shortcut.key)}</kbd>
                        ${toolIcon}
                        <span class="shortcut-description">${shortcut.description}</span>
                    </div>
                `;
            });

            html += '</div></div>';
        });

        html += '</div>';
        return html;
    }

    /**
     * Formats key display (adds visual separators for combos).
     * @private
     * @param {string} key - Key string
     * @returns {string}
     */
    _formatKey(key) {
        if (key.includes('+')) {
            return key.split('+').map(k => `<span>${k}</span>`).join('<span class="key-separator">+</span>');
        }
        return `<span>${key}</span>`;
    }
}
