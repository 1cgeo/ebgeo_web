// Path: js\controls_sig\suggestions_modal.js

/**
 * Gerenciador do modal de sugestões/suporte do EBGeo
 * Responsável por abrir/fechar o modal e gerenciar interações
 */
class SuggestionsModal {
    constructor() {
        this.modal = null;
        this.modalInitialized = false;
        
        this.handleModalKeyDown = this.handleModalKeyDown.bind(this);
    }

    /**
     * Inicializa o modal de sugestões
     */
    init() {
        if (this.modalInitialized) {
            return;
        }

        const button = document.getElementById('suggestions-button');
        if (!button) {
            console.warn('Botão de sugestões não encontrado');
            return;
        }

        this.modal = document.getElementById('suggestions-modal');
        if (!this.modal) {
            console.warn('Modal de sugestões não encontrado');
            return;
        }

        this.setupEventListeners();
        this.modalInitialized = true;
    }

    /**
     * Configura todos os event listeners do modal
     */
    setupEventListeners() {
        const button = document.getElementById('suggestions-button');
        const closeBtn = this.modal.querySelector('.shortcuts-modal-close');

        if (button) {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                this.show();
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.hide();
            });
        }

        if (this.modal) {
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.hide();
                }
            });
        }

        document.addEventListener('keydown', this.handleModalKeyDown);

        this.setupCopyButtons();
    }

    /**
     * Configura botões de copiar email
     */
    setupCopyButtons() {
        const copyButtons = this.modal.querySelectorAll('.copy-email-btn');
        
        copyButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const email = button.dataset.email;
                this.copyToClipboard(email, button);
            });
        });
    }

    /**
     * Copia texto para clipboard e mostra feedback
     */
    async copyToClipboard(text, button) {
        try {
            await navigator.clipboard.writeText(text);
            
            const originalText = button.innerHTML;
            button.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span>Copiado!</span>
            `;
            button.classList.add('copied');
            
            setTimeout(() => {
                button.innerHTML = originalText;
                button.classList.remove('copied');
            }, 2000);
            
        } catch (err) {
            console.error('Erro ao copiar:', err);
            this.copyToClipboardFallback(text, button);
        }
    }

    /**
     * Fallback para copiar em navegadores que não suportam clipboard API
     */
    copyToClipboardFallback(text, button) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        
        try {
            document.execCommand('copy');
            
            const originalText = button.innerHTML;
            button.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span>Copiado!</span>
            `;
            button.classList.add('copied');
            
            setTimeout(() => {
                button.innerHTML = originalText;
                button.classList.remove('copied');
            }, 2000);
        } catch (err) {
            console.error('Erro ao copiar (fallback):', err);
        }
        
        document.body.removeChild(textArea);
    }

    /**
     * Handler para tecla ESC
     */
    handleModalKeyDown(e) {
        if (e.key === 'Escape' && this.modal && this.modal.style.display === 'block') {
            this.hide();
        }
    }

    /**
     * Mostra o modal de sugestões
     */
    show() {
        if (!this.modal) {
            console.warn('Modal de sugestões não inicializado');
            return;
        }

        this.modal.style.display = 'block';
        this.modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Esconde o modal de sugestões
     */
    hide() {
        if (!this.modal) {
            return;
        }

        this.modal.style.display = 'none';
        this.modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = 'auto';
    }

    /**
     * Cleanup - remove event listeners e fecha modal
     */
    destroy() {
        if (this.modalInitialized) {
            document.removeEventListener('keydown', this.handleModalKeyDown);
        }
        
        this.hide();
    }
}

export default SuggestionsModal;