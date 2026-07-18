// Path: js/modals/info.modal.js

/**
 * @fileoverview Info/support modal.
 * Displays support contacts and system information.
 */

import { ModalBase } from './modal.base.js';
import { setupCleanup, addDomListener, cleanup } from '@utils/event-cleanup.js';

/**
 * CGEO support centers data.
 */
const CGEO_CENTERS = [
    {
        name: '1° CGEO',
        url: 'http://www.1cgeo.eb.mil.br/',
        region: 'Comando Militar do Sul',
    },
    {
        name: '2° CGEO',
        url: 'http://www.2cgeo.eb.mil.br/',
        region: 'Comando Militar do Oeste e Comando Militar do Planalto',
    },
    {
        name: '3° CGEO',
        url: 'http://www.3cgeo.eb.mil.br/',
        region: 'Comando Militar do Nordeste',
    },
    {
        name: '4° CGEO',
        url: 'http://www.4cgeo.eb.mil.br/',
        region: 'Comando Militar da Amazônia e Comando Militar do Norte',
    },
    {
        name: '5° CGEO',
        url: 'http://www.5cgeo.eb.mil.br/',
        region: 'Comando Militar do Leste e Comando Militar do Sudeste',
    },
];

/**
 * Info modal class.
 */
export class InfoModal extends ModalBase {
    constructor() {
        super({
            id: 'info-modal-new',
            title: 'Informações e Suporte',
            icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><circle cx="12" cy="8" r="0.5" fill="currentColor"/></svg>`,
        });
        setupCleanup(this);
    }

    /**
     * Renders the modal with info content.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        const body = this.getBody();

        if (body) {
            body.innerHTML = this._createContent();
            this._setupCopyButton(body);
        }

        // Add specific class for width
        this._container.classList.add('info-modal-container');

        return overlay;
    }

    /**
     * Creates the info content HTML.
     * @private
     * @returns {string}
     */
    _createContent() {
        let html = '<div class="info-sections">';

        // Support section
        html += `
            <div class="info-section">
                <div class="info-section-header">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    <h3>Suporte ao Usuário</h3>
                </div>
                <p class="info-description">
                    Entre em contato com o Centro de Geoinformação correspondente ao Comando Militar de Área:
                </p>
                <div class="cgeo-cards">
        `;

        CGEO_CENTERS.forEach(center => {
            html += `
                <a href="${center.url}" target="_blank" rel="noopener noreferrer" class="cgeo-card">
                    <div class="cgeo-card-header">
                        <span class="cgeo-name">${center.name}</span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15 3 21 3 21 9"/>
                            <line x1="10" y1="14" x2="21" y2="3"/>
                        </svg>
                    </div>
                    <span class="cgeo-region">${center.region}</span>
                </a>
            `;
        });

        html += '</div></div>';

        // Suggestions section
        html += `
            <div class="info-section">
                <div class="info-section-header">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                        <polyline points="22,6 12,13 2,6"/>
                    </svg>
                    <h3>Sugestões para o Sistema</h3>
                </div>
                <p class="info-description">
                    Entre em contato com a <strong>Diretoria de Serviço Geográfico</strong>, responsável pelo desenvolvimento do sistema:
                </p>
                <div class="email-box">
                    <div class="email-display">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                            <polyline points="22,6 12,13 2,6"/>
                        </svg>
                        <span>ebgeo@dsg.eb.mil.br</span>
                    </div>
                    <button class="copy-btn" data-email="ebgeo@dsg.eb.mil.br" aria-label="Copiar email">
                        <svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        <svg class="check-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        <span>Copiar</span>
                    </button>
                </div>
            </div>
        `;

        html += '</div>';
        return html;
    }

    /**
     * Sets up copy button functionality.
     * @private
     * @param {HTMLElement} body - Modal body element
     */
    _setupCopyButton(body) {
        const copyBtn = body.querySelector('.copy-btn');
        if (!copyBtn) return;

        addDomListener(this, copyBtn, 'click', async () => {
            const email = copyBtn.dataset.email;
            await this._copyToClipboard(email, copyBtn);
        });
    }

    /**
     * Copies text to clipboard with visual feedback.
     * @private
     * @param {string} text - Text to copy
     * @param {HTMLElement} btn - Button element
     */
    async _copyToClipboard(text, btn) {
        try {
            await navigator.clipboard.writeText(text);
            this._showCopySuccess(btn);
        } catch (_err) {
            this._copyFallback(text, btn);
        }
    }

    /**
     * Fallback copy method for older browsers.
     * @private
     * @param {string} text - Text to copy
     * @param {HTMLElement} btn - Button element
     */
    _copyFallback(text, btn) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();

        try {
            document.execCommand('copy');
            this._showCopySuccess(btn);
        } catch (err) {
            console.error('Copy failed:', err);
        }

        document.body.removeChild(textarea);
    }

    /**
     * Shows copy success feedback.
     * @private
     * @param {HTMLElement} btn - Button element
     */
    _showCopySuccess(btn) {
        const copyIcon = btn.querySelector('.copy-icon');
        const checkIcon = btn.querySelector('.check-icon');
        const label = btn.querySelector('span:last-child');

        if (copyIcon) copyIcon.style.display = 'none';
        if (checkIcon) checkIcon.style.display = 'block';
        if (label) label.textContent = 'Copiado!';

        btn.classList.add('copied');

        setTimeout(() => {
            if (copyIcon) copyIcon.style.display = 'block';
            if (checkIcon) checkIcon.style.display = 'none';
            if (label) label.textContent = 'Copiar';
            btn.classList.remove('copied');
        }, 2000);
    }

    /**
     * Destroys the modal and cleans up resources.
     */
    destroy() {
        cleanup(this);
        super.destroy();
    }
}
