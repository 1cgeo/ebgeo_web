// Path: js/utilities/pointer-utils.js
/**
 * Pointer/Touch Utilities
 * Utilitários para suporte unificado a mouse e touch
 */

/**
 * Detecta se o dispositivo suporta touch
 * @returns {boolean}
 */
export const isTouchDevice = () => {
    return 'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        window.matchMedia('(pointer: coarse)').matches;
};

/**
 * Detecta se é um dispositivo mobile (tela pequena + touch)
 * @returns {boolean}
 */
export const isMobileDevice = () => {
    return isTouchDevice() && window.innerWidth < 768;
};

/**
 * Obtém a posição do pointer (mouse ou touch) relativa ao canvas
 * @param {PointerEvent|MouseEvent|TouchEvent} event
 * @param {HTMLElement} canvas
 * @returns {{x: number, y: number}}
 */
export const getPointerPosition = (event, canvas) => {
    const rect = canvas.getBoundingClientRect();

    // Touch event
    if (event.touches && event.touches.length > 0) {
        return {
            x: event.touches[0].clientX - rect.left,
            y: event.touches[0].clientY - rect.top
        };
    }

    // Changed touches (touchend)
    if (event.changedTouches && event.changedTouches.length > 0) {
        return {
            x: event.changedTouches[0].clientX - rect.left,
            y: event.changedTouches[0].clientY - rect.top
        };
    }

    // Mouse/Pointer event
    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
};

/**
 * Calcula o ponto médio entre dois touches
 * @param {TouchList} touches
 * @returns {{x: number, y: number}}
 */
export const getTouchesMidpoint = (touches) => {
    if (touches.length < 2) {
        return { x: touches[0].clientX, y: touches[0].clientY };
    }
    return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2
    };
};

/**
 * Calcula o ângulo entre dois touches (para rotação)
 * @param {TouchList} touches
 * @returns {number} Ângulo em graus
 */
export const getTouchesAngle = (touches) => {
    if (touches.length < 2) return 0;
    const dx = touches[1].clientX - touches[0].clientX;
    const dy = touches[1].clientY - touches[0].clientY;
    return Math.atan2(dy, dx) * (180 / Math.PI);
};

/**
 * Calcula a distância entre dois touches (para pinch-zoom)
 * @param {TouchList} touches
 * @returns {number}
 */
export const getTouchesDistance = (touches) => {
    if (touches.length < 2) return 0;
    const dx = touches[1].clientX - touches[0].clientX;
    const dy = touches[1].clientY - touches[0].clientY;
    return Math.hypot(dx, dy);
};

/**
 * Cria um handler de long-press com cancelamento por movimento
 * @param {HTMLElement} element
 * @param {Function} callback - Chamado quando long-press é detectado
 * @param {Object} options
 * @param {number} options.duration - Duração em ms (default: 500)
 * @param {number} options.moveThreshold - Pixels de movimento para cancelar (default: 10)
 * @returns {Function} Função para remover os listeners
 */
export const createLongPressHandler = (element, callback, options = {}) => {
    const { duration = 500, moveThreshold = 10 } = options;

    let timer = null;
    let startPos = null;
    let isLongPressTriggered = false;

    const onTouchStart = (e) => {
        if (e.touches.length !== 1) return;

        isLongPressTriggered = false;
        startPos = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY
        };

        timer = setTimeout(() => {
            isLongPressTriggered = true;
            // Haptic feedback se disponível
            if (navigator.vibrate) {
                navigator.vibrate(50);
            }
            callback(e, startPos);
        }, duration);
    };

    const onTouchMove = (e) => {
        if (!timer || !startPos) return;

        const touch = e.touches[0];
        const dist = Math.hypot(
            touch.clientX - startPos.x,
            touch.clientY - startPos.y
        );

        if (dist > moveThreshold) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const onTouchEnd = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        startPos = null;
    };

    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: true });
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', onTouchEnd);

    // Retorna função de cleanup
    return () => {
        element.removeEventListener('touchstart', onTouchStart);
        element.removeEventListener('touchmove', onTouchMove);
        element.removeEventListener('touchend', onTouchEnd);
        element.removeEventListener('touchcancel', onTouchEnd);
        if (timer) clearTimeout(timer);
    };
};

/**
 * Cria um handler para two-finger tap
 * @param {HTMLElement} element
 * @param {Function} callback - Chamado com (event, midpoint)
 * @param {Object} options
 * @param {number} options.maxDuration - Duração máxima do tap em ms (default: 300)
 * @param {number} options.maxDistance - Distância máxima de movimento (default: 20)
 * @returns {Function} Função para remover os listeners
 */
export const createTwoFingerTapHandler = (element, callback, options = {}) => {
    const { maxDuration = 300, maxDistance = 20 } = options;

    let twoFingerStart = null;

    const onTouchStart = (e) => {
        if (e.touches.length === 2) {
            twoFingerStart = {
                time: Date.now(),
                midpoint: getTouchesMidpoint(e.touches),
                distance: getTouchesDistance(e.touches)
            };
        } else {
            twoFingerStart = null;
        }
    };

    const onTouchMove = (e) => {
        if (!twoFingerStart || e.touches.length !== 2) return;

        const currentMidpoint = getTouchesMidpoint(e.touches);
        const dist = Math.hypot(
            currentMidpoint.x - twoFingerStart.midpoint.x,
            currentMidpoint.y - twoFingerStart.midpoint.y
        );

        if (dist > maxDistance) {
            twoFingerStart = null;
        }
    };

    const onTouchEnd = (e) => {
        if (!twoFingerStart) return;

        // Verifica se todos os dedos foram levantados
        if (e.touches.length === 0) {
            const elapsed = Date.now() - twoFingerStart.time;
            if (elapsed < maxDuration) {
                callback(e, twoFingerStart.midpoint);
            }
        }
        twoFingerStart = null;
    };

    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: true });
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', () => { twoFingerStart = null; });

    return () => {
        element.removeEventListener('touchstart', onTouchStart);
        element.removeEventListener('touchmove', onTouchMove);
        element.removeEventListener('touchend', onTouchEnd);
        element.removeEventListener('touchcancel', () => { twoFingerStart = null; });
    };
};

/**
 * Cria um handler para two-finger drag (rotação/pitch)
 * @param {HTMLElement} element
 * @param {Object} callbacks
 * @param {Function} callbacks.onStart - Chamado ao iniciar com (initialAngle, initialMidpoint)
 * @param {Function} callbacks.onMove - Chamado durante drag com (angleDelta, midpointDelta)
 * @param {Function} callbacks.onEnd - Chamado ao finalizar
 * @returns {Function} Função para remover os listeners
 */
export const createTwoFingerDragHandler = (element, callbacks) => {
    const { onStart, onMove, onEnd } = callbacks;

    let initialState = null;
    let isActive = false;

    const onTouchStart = (e) => {
        if (e.touches.length !== 2) return;

        e.preventDefault();
        isActive = true;

        initialState = {
            angle: getTouchesAngle(e.touches),
            midpoint: getTouchesMidpoint(e.touches),
            distance: getTouchesDistance(e.touches)
        };

        if (onStart) {
            onStart(initialState);
        }
    };

    const onTouchMove = (e) => {
        if (!isActive || e.touches.length !== 2 || !initialState) return;

        e.preventDefault();

        const currentAngle = getTouchesAngle(e.touches);
        const currentMidpoint = getTouchesMidpoint(e.touches);

        const angleDelta = currentAngle - initialState.angle;
        const midpointDelta = {
            x: currentMidpoint.x - initialState.midpoint.x,
            y: currentMidpoint.y - initialState.midpoint.y
        };

        if (onMove) {
            onMove(angleDelta, midpointDelta, currentMidpoint);
        }
    };

    const onTouchEnd = (e) => {
        if (!isActive) return;

        if (e.touches.length < 2) {
            isActive = false;
            initialState = null;
            if (onEnd) {
                onEnd();
            }
        }
    };

    element.addEventListener('touchstart', onTouchStart, { passive: false });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', onTouchEnd);

    return () => {
        element.removeEventListener('touchstart', onTouchStart);
        element.removeEventListener('touchmove', onTouchMove);
        element.removeEventListener('touchend', onTouchEnd);
        element.removeEventListener('touchcancel', onTouchEnd);
    };
};

/**
 * Previne gestos padrão do browser em um elemento
 * Útil para áreas de desenho
 * @param {HTMLElement} element
 */
export const preventDefaultGestures = (element) => {
    element.style.touchAction = 'none';
    element.style.userSelect = 'none';
    element.style.webkitUserSelect = 'none';
    element.style.webkitTouchCallout = 'none';
};

/**
 * Restaura gestos padrão do browser
 * @param {HTMLElement} element
 */
export const restoreDefaultGestures = (element) => {
    element.style.touchAction = '';
    element.style.userSelect = '';
    element.style.webkitUserSelect = '';
    element.style.webkitTouchCallout = '';
};
