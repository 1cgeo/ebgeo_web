// Path: js/modals/shortcuts.modal.js

/**
 * @fileoverview Shortcuts modal.
 * Displays keyboard shortcuts organized by category.
 */

import { ModalBase } from './modal.base.js';

/**
 * Shortcuts data organized by category.
 */
const SHORTCUTS_DATA = {
    system: {
        title: 'Sistema',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
        shortcuts: [
            { key: 'Delete', description: 'Deletar elementos selecionados' },
            { key: 'Backspace', description: 'Deletar elementos selecionados' },
            { key: 'Escape', description: 'Desativar ferramenta / desselecionar' },
            { key: 'Ctrl+Z', description: 'Desfazer ultima acao' },
            { key: 'Ctrl+Y', description: 'Refazer ultima acao' },
            { key: 'Ctrl+C', description: 'Copiar elementos selecionados' },
            { key: 'Ctrl+V', description: 'Colar elementos' },
            { key: 'Ctrl+S', description: 'Salvar notas do mapa' },
        ],
    },
    drawing: {
        title: 'Ferramentas de Desenho',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>`,
        shortcuts: [
            { key: 'Q', description: 'Selecao retangular' },
            { key: 'P', description: 'Ferramenta de ponto' },
            { key: 'L', description: 'Ferramenta de linha' },
            { key: 'A', description: 'Ferramenta de poligono' },
            { key: 'R', description: 'Ferramenta de retangulo' },
            { key: 'C', description: 'Ferramenta de circulo' },
            { key: 'E', description: 'Ferramenta de elipse' },
            { key: 'T', description: 'Ferramenta de texto' },
            { key: 'I', description: 'Ferramenta de imagem' },
            { key: 'B', description: 'Ferramenta de pincel' },
        ],
    },
    military: {
        title: 'Ferramentas Militares',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
        shortcuts: [
            { key: 'M', description: 'Simbolo militar' },
            { key: 'K', description: 'Medidas de coordenacao' },
            { key: 'S', description: 'Ferramenta de seta' },
            { key: 'D', description: 'Ferramenta de fronteira' },
            { key: 'F', description: 'Frente ocupada' },
        ],
    },
    analysis: {
        title: 'Analise (requer terreno)',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`,
        shortcuts: [
            { key: 'V', description: 'Analise de visibilidade' },
            { key: 'O', description: 'Linha de visada' },
        ],
    },
    other: {
        title: 'Outras Ferramentas',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v10"/><path d="M1 12h6m6 0h10"/></svg>`,
        shortcuts: [
            { key: 'N', description: 'Informacoes da carta topografica' },
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
                html += `
                    <div class="shortcut-item">
                        <kbd class="shortcut-key">${this._formatKey(shortcut.key)}</kbd>
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
