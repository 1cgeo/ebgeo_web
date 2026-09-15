// Path: js/utilities/toast_service.js

/**
 * @fileoverview Toast notification service.
 * Styles defined in src/css/toast.css using BEM classes and design tokens.
 *
 * A TOAST IS BORN AT THE BOTTOM WHILE A MODAL IS OPEN, and that is the one rule here that is not
 * plain configuration. The house default is `top-center` at 80 px with 60 px per stacked toast,
 * and `--z-toast` (220) is above `--z-modal` (60), so a toast always draws ON TOP of an open
 * modal: two of them cover the header and the first row of whatever the modal is showing. The
 * pendency panel measured this in a capture (B5d) and worked around it by passing an explicit
 * position on all nine of its own calls, which fixed that panel and nothing else: the warnings
 * that actually covered it come from `sync-flush.js`, a module that knows nothing about panels.
 * Deciding here, from the state of the DOM, is what covers every caller including future ones.
 *
 * THE SIGNAL IS THE OVERLAY, NOT A REGISTRY. Every modal in this app renders `.modal-overlay` and
 * flips `dataset.visible` to open and close it (`modal.base.js` plus the four subclasses that
 * build their own overlay: confirm, prompt, preview-video and temporal-settings), and the CSS
 * keys visibility off that same attribute. So one `querySelector` answers the question for all of
 * them, with no bookkeeping to keep in sync and nothing to leak when a modal is destroyed rather
 * than hidden. An explicit `options.position` still wins: the decision only fills in the default.
 *
 * DECIDIR SÓ NO NASCIMENTO DEIXAVA METADE DO DEFEITO VIVA, e era a metade que a captura
 * continuava fotografando. Medido no Playwright em 2026-09-15, com o painel de pendências aberto:
 * ele ERA reconhecido (`.modal-overlay[data-visible="true"]` casava com ele) e os dois avisos
 * continuavam em `top: 80px` e `top: 140px`, sobre o cabeçalho. Eles nasceram segundos ANTES,
 * quando não havia modal nenhum, e o laço de envio lhes dá 8 s de vida (`sync-flush.js`): a pessoa
 * abre o painel pela luz de sync JUSTAMENTE porque aqueles avisos acabaram de aparecer, então o
 * aviso que cobre é, por construção, sempre o que antecede o painel. Uma regra aplicada uma vez,
 * na criação, nunca alcança essa ordem.
 *
 * ENTÃO A POSIÇÃO É REVISTA ENQUANTO O AVISO VIVE, e o gatilho é o mesmo atributo do overlay,
 * observado em vez de sondado ({@link revisaoDePosicoes} decide, e um `MutationObserver` no corpo
 * do documento diz quando). O observador fica ligado só enquanto há aviso na tela (segundos por
 * vez) e cai com o último, então a página não paga nada enquanto nada está sendo mostrado. Só o
 * aviso que NÃO nomeou lugar se move, e nos dois sentidos: quem nomeou é obedecido pela vida
 * inteira da mensagem, não só no primeiro quadro dela.
 */

/** @type {number} */
const DEFAULT_DURATION = 3000;

/** @type {string} */
const DEFAULT_POSITION = 'top-center';

/** @type {string} Where a toast is born while a modal is open. */
const MODAL_OPEN_POSITION = 'bottom-center';

/** @type {string} An open modal of any kind: the shared overlay class plus its visibility flag. */
const OPEN_MODAL_SELECTOR = '.modal-overlay[data-visible="true"]';

/** @type {number} Spacing between stacked toasts in pixels */
const TOAST_STACK_GAP = 60;

/** @type {number} Base offset for top-center position */
const TOP_CENTER_BASE = 80;

/** @type {number} Base offset for other positions */
const EDGE_BASE = 20;

/** @type {number} CSS transition duration in ms (must match --transition-slow) */
const TRANSITION_MS = 300;

/** @type {Set<HTMLElement>} */
const activeToasts = new Set();

/** @type {Map<string, HTMLElement>} */
const channelToasts = new Map();

/**
 * Whether a modal is on screen right now.
 *
 * Guarded because this module is imported by seams that also run headless (tests, a worker): a
 * missing or minimal `document` must degrade to the default position, never throw over a message
 * the caller wanted shown.
 * @returns {boolean}
 */
function isModalOpen() {
    try {
        return document.querySelector(OPEN_MODAL_SELECTOR) !== null;
    } catch {
        return false;
    }
}

/**
 * Where a toast is born. Pure, so the rule is testable without a DOM.
 *
 * An explicit request always wins, including an explicit `top-center`: a caller that named a place
 * has a reason, and overriding it would make this function the second author of every position.
 * @param {string|undefined} requested - `options.position`, when the caller gave one.
 * @param {boolean} modalOpen - Whether a modal is currently on screen.
 * @returns {string} The position identifier to use.
 */
export function resolveToastPosition(requested, modalOpen) {
    if (requested) return requested;
    return modalOpen ? MODAL_OPEN_POSITION : DEFAULT_POSITION;
}

/**
 * Onde cada aviso JÁ NA TELA deveria estar agora. Pura, como a de nascimento, e pela mesma razão.
 *
 * Ela devolve `null` para quem não muda, e não a posição atual, porque mexer no DOM de um aviso
 * que já está no lugar certo é trabalho por nada a cada mutação observada, e o observador recebe
 * muito mais mutação do que troca de modal. Quem pediu lugar explícito nunca aparece com posição
 * nova aqui: {@link resolveToastPosition} devolve o pedido dele, que é o que ele já tem.
 * @param {Array<{pedida: (string|undefined), atual: string}>} avisos - Um item por aviso vivo.
 * @param {boolean} modalAberto - Se há modal na tela AGORA.
 * @returns {Array<string|null>} A nova posição de cada aviso, ou `null` quando ele fica onde está.
 */
export function revisaoDePosicoes(avisos, modalAberto) {
    if (!Array.isArray(avisos)) return [];
    return avisos.map(({ pedida, atual } = {}) => {
        const alvo = resolveToastPosition(pedida, modalAberto);
        return alvo === atual ? null : alvo;
    });
}

/**
 * Applies vertical position to a toast element based on its stack index.
 * @param {HTMLElement} toast - Toast element
 * @param {string} position - Position identifier
 * @param {number} stackIndex - Index in the active toast stack
 */
function applyPosition(toast, position, stackIndex) {
    const offset = stackIndex * TOAST_STACK_GAP;
    const isTop = position.startsWith('top');
    const prop = isTop ? 'top' : 'bottom';
    const base = (position === 'top-center') ? TOP_CENTER_BASE : EDGE_BASE;

    toast.style[prop] = `${base + offset}px`;

    if (position.endsWith('right')) {
        toast.style.right = `${EDGE_BASE}px`;
    } else if (position.endsWith('left')) {
        toast.style.left = `${EDGE_BASE}px`;
    }
}

/**
 * Builds CSS class list for a toast element.
 * @param {string} type - Toast type (success, error, info, warning)
 * @param {string} position - Position identifier
 * @returns {string[]} Array of CSS class names
 */
function buildClassList(type, position) {
    const classes = ['toast', `toast--${type}`];
    const isTop = position.startsWith('top');

    classes.push(isTop ? 'toast--top' : 'toast--bottom');

    if (position.endsWith('center')) {
        classes.push('toast--center');
    }

    return classes;
}

/**
 * Creates toast DOM element.
 * @param {string} message - Message to display
 * @param {string} type - Toast type
 * @param {Object} config - Toast configuration
 * @returns {HTMLElement} Toast element
 */
function createToastElement(message, type, config) {
    const toast = document.createElement('div');
    toast.className = buildClassList(type, config.position).join(' ');
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');

    const content = document.createElement('div');
    content.className = 'toast__content';

    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    content.appendChild(messageSpan);

    if (config.closable) {
        const closeButton = document.createElement('button');
        closeButton.className = 'toast__close';
        closeButton.textContent = '\u00D7';
        closeButton.addEventListener('click', () => hideToast(toast));
        content.appendChild(closeButton);
    }

    toast.appendChild(content);
    return toast;
}

/**
 * Move um aviso vivo para a outra borda da tela.
 *
 * Só troca o par de classes e limpa a borda antiga; o deslocamento vertical fica com
 * {@link repositionActiveToasts}, que reempilha todo mundo depois. A classe `toast--center` não é
 * tocada porque quem se move é sempre `top-center` ↔ `bottom-center`: o aviso com lugar pedido não
 * entra nesta função.
 * @param {HTMLElement} toast - Aviso na tela.
 * @param {string} position - A nova posição.
 */
function moveToast(toast, position) {
    const isTop = position.startsWith('top');
    toast.classList.remove(isTop ? 'toast--bottom' : 'toast--top');
    toast.classList.add(isTop ? 'toast--top' : 'toast--bottom');
    toast.style[isTop ? 'bottom' : 'top'] = '';
    toast.dataset.position = position;
}

/**
 * Revê onde cada aviso vivo deve estar, agora que o DOM mudou.
 *
 * Chamada pelo observador, isto é, muitas vezes por segundo no pior caso: por isso a saída cedo
 * com a pilha vazia e o `null` de {@link revisaoDePosicoes} para quem não muda. A consulta ao DOM
 * acontece UMA vez por chamada, e não uma por aviso.
 */
function reviewToastPositions() {
    if (activeToasts.size === 0) return;
    const avisos = [...activeToasts];
    const revisao = revisaoDePosicoes(
        avisos.map((toast) => ({
            pedida: toast.dataset.requestedPosition || undefined,
            atual: toast.dataset.position,
        })),
        isModalOpen()
    );

    let mudou = false;
    revisao.forEach((posicao, i) => {
        if (!posicao) return;
        moveToast(avisos[i], posicao);
        mudou = true;
    });
    if (mudou) repositionActiveToasts();
}

/** @type {MutationObserver|null} Vive só enquanto há aviso na tela. */
let modalObserver = null;

/**
 * Liga o observador com o primeiro aviso e o desliga com o último.
 *
 * O FILTRO É O ATRIBUTO DO OVERLAY, e o `childList` está junto porque um modal pode chegar ao
 * documento já visível, caso em que não há mutação de atributo nenhuma para observar. O custo é
 * limitado pela vida de um aviso (segundos), e o retorno do observador é a saída cedo acima.
 *
 * Tudo é protegido porque este módulo é importado por costuras que rodam sem DOM (testes, um
 * worker): sem `MutationObserver` ou sem corpo de documento, o aviso continua nascendo no lugar
 * decidido na criação, que é o comportamento anterior.
 */
function syncModalObserver() {
    try {
        if (activeToasts.size > 0) {
            if (modalObserver || typeof MutationObserver !== 'function' || !document?.body) return;
            modalObserver = new MutationObserver(reviewToastPositions);
            modalObserver.observe(document.body, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ['data-visible'],
            });
            return;
        }
        modalObserver?.disconnect();
        modalObserver = null;
    } catch {
        modalObserver = null;
    }
}

/**
 * Repositions all active toasts after one is removed.
 */
function repositionActiveToasts() {
    let index = 0;
    for (const toast of activeToasts) {
        const position = toast.dataset.position;
        const isTop = position.startsWith('top');
        const prop = isTop ? 'top' : 'bottom';
        const base = (position === 'top-center') ? TOP_CENTER_BASE : EDGE_BASE;

        toast.style[prop] = `${base + index * TOAST_STACK_GAP}px`;
        index++;
    }
}

/**
 * Hides a specific toast with exit animation.
 * @param {HTMLElement} toast - Toast element to hide
 */
function hideToast(toast) {
    if (!toast || !toast.parentNode) return;

    toast.classList.remove('toast--visible');

    setTimeout(() => {
        toast.remove();
        activeToasts.delete(toast);
        repositionActiveToasts();
        syncModalObserver();
    }, TRANSITION_MS);
}

/**
 * Displays a toast notification.
 * @param {string} message - Message to display
 * @param {string} [type='info'] - Toast type (success, error, info, warning)
 * @param {Object} [options] - Additional options
 * @param {number} [options.duration] - Duration in ms (0 = infinite)
 * @param {string} [options.position] - Toast position. Omitted, it is `top-center`, or
 *   `bottom-center` while a modal is open (see {@link resolveToastPosition}).
 * @param {boolean} [options.closable] - Whether manually closable
 * @returns {HTMLElement} Toast element
 */
function showToast(message, type = 'info', options = {}) {
    const config = {
        duration: options.duration ?? DEFAULT_DURATION,
        position: resolveToastPosition(options.position, isModalOpen()),
        closable: options.closable ?? false,
    };

    const toast = createToastElement(message, type, config);
    toast.dataset.position = config.position;
    // O PEDIDO DO CHAMADOR FICA GUARDADO, e não só o lugar resolvido: é ele que distingue, na
    // revisão, quem escolheu um lugar de quem recebeu o padrão. Sem esta marca a revisão teria de
    // adivinhar pela posição atual, e um `top-center` pedido seria indistinguível do padrão.
    toast.dataset.requestedPosition = options.position ?? '';

    applyPosition(toast, config.position, activeToasts.size);
    document.body.appendChild(toast);
    activeToasts.add(toast);
    syncModalObserver();

    requestAnimationFrame(() => {
        toast.classList.add('toast--visible');
    });

    if (config.duration > 0) {
        setTimeout(() => hideToast(toast), config.duration);
    }

    return toast;
}

/**
 * Displays a success toast.
 * @param {string} message - Success message
 * @param {Object} [options] - Additional options
 * @returns {HTMLElement} Toast element
 */
function showSuccess(message, options = {}) {
    return showToast(message, 'success', options);
}

/**
 * Displays an error toast with extended duration.
 * @param {string} message - Error message
 * @param {Object} [options] - Additional options
 * @returns {HTMLElement} Toast element
 */
function showError(message, options = {}) {
    return showToast(message, 'error', { duration: 4000, ...options });
}

/**
 * Displays a warning toast.
 * @param {string} message - Warning message
 * @param {Object} [options] - Additional options
 * @returns {HTMLElement} Toast element
 */
function showWarning(message, options = {}) {
    return showToast(message, 'warning', options);
}

/**
 * Shows a toast in a named channel, replacing any existing toast in that channel
 * immediately (no fade-out delay). Prevents stacking on rapid repeated calls.
 *
 * @param {string} channel - Channel name (e.g., 'undo-redo')
 * @param {string} message - Message to display
 * @param {string} [type='info'] - Toast type
 * @param {Object} [options] - Additional options
 * @returns {HTMLElement} Toast element
 */
function showInChannel(channel, message, type = 'info', options = {}) {
    const existing = channelToasts.get(channel);
    if (existing && existing.parentNode) {
        existing.remove();
        activeToasts.delete(existing);
        repositionActiveToasts();
    }

    const toast = showToast(message, type, options);
    channelToasts.set(channel, toast);
    return toast;
}

export { showToast, showSuccess, showError, showWarning, showInChannel };

export default {
    showToast,
    showSuccess,
    showError,
    showWarning,
    showInChannel,
};
