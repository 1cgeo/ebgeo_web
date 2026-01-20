// Path: js/modals/info.modal.js

/**
 * @fileoverview Info/support modal.
 * Displays support contacts and system information.
 */

import { ModalBase } from './modal.base.js';
import { addDomListener, trackTimer } from '../utilities/event-cleanup.js';

/**
 * CGEO support centers data.
 */
const CGEO_CENTERS = [
    {
        name: '1o CGEO',
        url: 'http://www.1cgeo.eb.mil.br/',
        region: 'Comando Militar do Sul',
    },
    {
        name: '2o CGEO',
        url: 'http://www.2cgeo.eb.mil.br/',
        region: 'Comando Militar do Oeste e Comando Militar do Planalto',
    },
    {
        name: '3o CGEO',
        url: 'http://www.3cgeo.eb.mil.br/',
        region: 'Comando Militar do Nordeste',
    },
    {
        name: '4o CGEO',
        url: 'http://www.4cgeo.eb.mil.br/',
        region: 'Comando Militar da Amazonia e Comando Militar do Norte',
    },
    {
        name: '5o CGEO',
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
            title: 'Informacoes e Suporte',
            icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
        });
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
            this._setupCopyButtons(body);
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
                    <h3>Suporte ao Usuario</h3>
                </div>
                <p class="info-description">
                    Entre em contato com o Centro de Geoinformacao correspondente ao Comando Militar de Area:
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
                    <h3>Sugestoes para o Sistema</h3>
                </div>
                <p class="info-description">
                    Entre em contato com o <strong>1o Centro de Geoinformacao</strong>, responsavel pelo desenvolvimento do sistema:
                </p>
                <div class="email-box">
                    <a href="mailto:ebgeo@1cgeo.eb.mil.br" class="email-link">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                            <polyline points="22,6 12,13 2,6"/>
                        </svg>
                        <span>ebgeo@1cgeo.eb.mil.br</span>
                    </a>
                    <button class="copy-btn" data-email="ebgeo@1cgeo.eb.mil.br" aria-label="Copiar email">
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
    _setupCopyButtons(body) {
        const copyBtns = body.querySelectorAll('.copy-btn');

        copyBtns.forEach(btn => {
            addDomListener(this, btn, 'click', async () => {
                const email = btn.dataset.email;
                await this._copyToClipboard(email, btn);
            });
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
            // Fallback for older browsers
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

        const timerId = setTimeout(() => {
            if (copyIcon) copyIcon.style.display = 'block';
            if (checkIcon) checkIcon.style.display = 'none';
            if (label) label.textContent = 'Copiar';
            btn.classList.remove('copied');
        }, 2000);

        trackTimer(this, timerId, 'timeout');
    }
}
