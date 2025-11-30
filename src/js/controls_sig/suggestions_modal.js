// Path: js/controls_sig/suggestions_modal.js

/**
 * Manages the suggestions/support modal for EBGeo application
 */
class SuggestionsModal {
    constructor() {
        this.modal = null;
        this.modalInitialized = false;

        this.handleModalKeyDown = this.handleModalKeyDown.bind(this);
    }

    /**
     * Initializes the suggestions modal and sets up event listeners
     */
    init() {
        if (this.modalInitialized) {
            return;
        }

        const button = document.getElementById('suggestions-button');
        if (!button) {
            console.warn('Suggestions button not found');
            return;
        }

        this.modal = document.getElementById('suggestions-modal');
        if (!this.modal) {
            console.warn('Suggestions modal not found');
            return;
        }

        this.setupEventListeners();
        this.modalInitialized = true;
    }

    /**
     * Sets up all event listeners for the modal
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
     * Sets up copy-to-clipboard functionality for email buttons
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
     * Copies text to clipboard and shows visual feedback
     * @param {string} text - Text to copy
     * @param {HTMLElement} button - Button that triggered the action
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
            console.error('Error copying:', err);
            this.copyToClipboardFallback(text, button);
        }
    }

    /**
     * Fallback method for copying to clipboard in older browsers
     * @param {string} text - Text to copy
     * @param {HTMLElement} button - Button that triggered the action
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
            console.error('Error copying (fallback):', err);
        }

        document.body.removeChild(textArea);
    }

    /**
     * Handles ESC key to close modal
     * @param {KeyboardEvent} e - Keyboard event
     */
    handleModalKeyDown(e) {
        if (e.key === 'Escape' && this.modal && this.modal.style.display === 'block') {
            this.hide();
        }
    }

    /**
     * Shows the suggestions modal
     */
    show() {
        if (!this.modal) {
            console.warn('Suggestions modal not initialized');
            return;
        }

        this.modal.style.display = 'block';
        this.modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Hides the suggestions modal
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
     * Cleans up event listeners and closes modal
     */
    destroy() {
        if (this.modalInitialized) {
            document.removeEventListener('keydown', this.handleModalKeyDown);
        }

        this.hide();
    }
}

export default SuggestionsModal;
