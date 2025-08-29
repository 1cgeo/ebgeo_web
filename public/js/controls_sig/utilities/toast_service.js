// Path: js/controls_sig/utilities/toast_service.js

class ToastService {
    static DEFAULT_DURATION = 3000;
    static DEFAULT_POSITION = 'top-center';
    static Z_INDEX = 10000;
    
    static TYPES = {
        SUCCESS: 'success',
        ERROR: 'error', 
        INFO: 'info',
        WARNING: 'warning'
    };

    static COLORS = {
        [ToastService.TYPES.SUCCESS]: '#28a745',
        [ToastService.TYPES.ERROR]: '#dc3545',
        [ToastService.TYPES.INFO]: '#17a2b8',
        [ToastService.TYPES.WARNING]: '#ffc107'
    };

    static activeToasts = new Set();

    /**
     * Exibe um toast com configurações personalizadas
     * @param {string} message - Mensagem a ser exibida
     * @param {string} type - Tipo do toast (success, error, info, warning)
     * @param {Object} options - Opções adicionais
     * @param {number} options.duration - Duração em ms (0 = infinito)
     * @param {string} options.position - Posição do toast
     * @param {boolean} options.closable - Se pode ser fechado manualmente
     */
    static showToast(message, type = ToastService.TYPES.INFO, options = {}) {
        const config = {
            duration: options.duration ?? ToastService.DEFAULT_DURATION,
            position: options.position ?? ToastService.DEFAULT_POSITION,
            closable: options.closable ?? false,
            ...options
        };

        const toast = ToastService.createToastElement(message, type, config);
        ToastService.positionToast(toast, config.position);
        ToastService.showToastElement(toast, config);
        
        return toast;
    }

    /**
     * Exibe toast de sucesso
     * @param {string} message - Mensagem de sucesso
     * @param {Object} options - Opções adicionais
     */
    static showSuccess(message, options = {}) {
        return ToastService.showToast(message, ToastService.TYPES.SUCCESS, options);
    }

    /**
     * Exibe toast de erro
     * @param {string} message - Mensagem de erro
     * @param {Object} options - Opções adicionais
     */
    static showError(message, options = {}) {
        return ToastService.showToast(message, ToastService.TYPES.ERROR, {
            duration: 4000, // Erros ficam um pouco mais tempo
            ...options
        });
    }

    /**
     * Exibe toast informativo
     * @param {string} message - Mensagem informativa
     * @param {Object} options - Opções adicionais
     */
    static showInfo(message, options = {}) {
        return ToastService.showToast(message, ToastService.TYPES.INFO, options);
    }

    /**
     * Exibe toast de aviso
     * @param {string} message - Mensagem de aviso
     * @param {Object} options - Opções adicionais
     */
    static showWarning(message, options = {}) {
        return ToastService.showToast(message, ToastService.TYPES.WARNING, options);
    }

    /**
     * Cria elemento DOM do toast
     * @private
     */
    static createToastElement(message, type, config) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'polite');
        
        // Estilo base do toast
        toast.style.cssText = `
            position: fixed;
            padding: 12px 18px;
            border-radius: 6px;
            color: white;
            font-size: 13px;
            font-weight: 500;
            z-index: ${ToastService.Z_INDEX};
            opacity: 0;
            transition: opacity 0.3s ease, transform 0.3s ease;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            background-color: ${ToastService.COLORS[type]};
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 90vw;
            word-wrap: break-word;
            transform: translateY(-10px);
        `;

        // Container para mensagem e botão de fechar
        const content = document.createElement('div');
        content.style.cssText = 'display: flex; align-items: center; gap: 8px;';
        
        const messageSpan = document.createElement('span');
        messageSpan.textContent = message;
        content.appendChild(messageSpan);

        // Botão de fechar se configurado
        if (config.closable) {
            const closeButton = document.createElement('button');
            closeButton.innerHTML = '×';
            closeButton.style.cssText = `
                background: none;
                border: none;
                color: white;
                font-size: 18px;
                cursor: pointer;
                padding: 0;
                margin-left: 8px;
                opacity: 0.8;
                line-height: 1;
            `;
            
            closeButton.addEventListener('click', () => {
                ToastService.hideToast(toast);
            });
            
            closeButton.addEventListener('mouseenter', () => {
                closeButton.style.opacity = '1';
            });
            
            closeButton.addEventListener('mouseleave', () => {
                closeButton.style.opacity = '0.8';
            });
            
            content.appendChild(closeButton);
        }

        toast.appendChild(content);
        return toast;
    }

    /**
     * Posiciona o toast na tela
     * @private
     */
    static positionToast(toast, position) {
        const activeCount = ToastService.activeToasts.size;
        const offsetY = activeCount * 60; // 60px entre toasts
        
        switch (position) {
            case 'top-center':
                toast.style.top = `${80 + offsetY}px`;
                toast.style.left = '50%';
                toast.style.transform = 'translateX(-50%) translateY(-10px)';
                break;
            case 'top-right':
                toast.style.top = `${20 + offsetY}px`;
                toast.style.right = '20px';
                break;
            case 'top-left':
                toast.style.top = `${20 + offsetY}px`;
                toast.style.left = '20px';
                break;
            case 'bottom-center':
                toast.style.bottom = `${20 + offsetY}px`;
                toast.style.left = '50%';
                toast.style.transform = 'translateX(-50%) translateY(10px)';
                break;
            case 'bottom-right':
                toast.style.bottom = `${20 + offsetY}px`;
                toast.style.right = '20px';
                break;
            case 'bottom-left':
                toast.style.bottom = `${20 + offsetY}px`;
                toast.style.left = '20px';
                break;
            default:
                // Fallback para top-center
                toast.style.top = `${80 + offsetY}px`;
                toast.style.left = '50%';
                toast.style.transform = 'translateX(-50%) translateY(-10px)';
        }
    }

    /**
     * Exibe o toast com animação
     * @private
     */
    static showToastElement(toast, config) {
        document.body.appendChild(toast);
        ToastService.activeToasts.add(toast);

        // Animar entrada
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            
            if (config.position.includes('top')) {
                toast.style.transform = toast.style.transform.replace('translateY(-10px)', 'translateY(0)');
            } else if (config.position.includes('bottom')) {
                toast.style.transform = toast.style.transform.replace('translateY(10px)', 'translateY(0)');
            }
        });

        // Auto-hide se configurado
        if (config.duration > 0) {
            setTimeout(() => {
                ToastService.hideToast(toast);
            }, config.duration);
        }
    }

    /**
     * Esconde um toast específico
     * @param {HTMLElement} toast - Elemento do toast para esconder
     */
    static hideToast(toast) {
        if (!toast || !toast.parentNode) return;

        toast.style.opacity = '0';
        
        // Animar saída
        if (toast.style.transform.includes('translateY(0)')) {
            if (toast.style.top) {
                toast.style.transform = toast.style.transform.replace('translateY(0)', 'translateY(-10px)');
            } else {
                toast.style.transform = toast.style.transform.replace('translateY(0)', 'translateY(10px)');
            }
        }

        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
            ToastService.activeToasts.delete(toast);
            ToastService.repositionActiveToasts();
        }, 300);
    }

    /**
     * Reposiciona toasts ativos após remoção
     * @private
     */
    static repositionActiveToasts() {
        const activeToastsArray = Array.from(ToastService.activeToasts);
        
        activeToastsArray.forEach((toast, index) => {
            const offsetY = index * 60;
            
            if (toast.style.top) {
                // Toast no topo
                const baseTop = toast.style.top.includes('80px') ? 80 : 20;
                toast.style.top = `${baseTop + offsetY}px`;
            } else if (toast.style.bottom) {
                // Toast no fundo  
                toast.style.bottom = `${20 + offsetY}px`;
            }
        });
    }

    /**
     * Remove todos os toasts ativos
     */
    static clearAllToasts() {
        const activeToastsArray = Array.from(ToastService.activeToasts);
        activeToastsArray.forEach(toast => {
            ToastService.hideToast(toast);
        });
    }

    /**
     * Verifica se há toasts ativos
     * @returns {boolean}
     */
    static hasActiveToasts() {
        return ToastService.activeToasts.size > 0;
    }

    /**
     * Retorna o número de toasts ativos
     * @returns {number}
     */
    static getActiveToastCount() {
        return ToastService.activeToasts.size;
    }
}

// Exportar métodos estáticos para facilitar uso
export const showToast = ToastService.showToast.bind(ToastService);
export const showSuccess = ToastService.showSuccess.bind(ToastService);
export const showError = ToastService.showError.bind(ToastService);
export const showInfo = ToastService.showInfo.bind(ToastService);
export const showWarning = ToastService.showWarning.bind(ToastService);
export const clearAllToasts = ToastService.clearAllToasts.bind(ToastService);

export default ToastService;