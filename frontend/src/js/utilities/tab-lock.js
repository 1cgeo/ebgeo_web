// Path: js/utilities/tab-lock.js

/**
 * @module tab-lock
 * @description WhatsApp Web-style single-tab enforcement using BroadcastChannel.
 *
 * Only one tab can be active at a time. When a second tab opens, it shows a
 * blocking overlay with a "Usar aqui" button. Clicking it sends a TAKEOVER
 * message that forces the other tab into the blocked state.
 */

const CHANNEL_NAME = 'ebgeo-tab-lock';
const PING_TIMEOUT_MS = 1500;

/** Message types for the BroadcastChannel protocol. */
const Msg = Object.freeze({
    PING: 'PING',
    PONG: 'PONG',
    TAKEOVER: 'TAKEOVER',
});

/** SVG icon for the overlay (monitor). */
const MONITOR_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;

let channel = null;
let overlay = null;
let isActive = false;

/**
 * Creates the blocking overlay DOM element.
 * @returns {HTMLElement}
 */
function createOverlay() {
    const el = document.createElement('div');
    el.className = 'tab-lock-overlay';
    el.innerHTML =
        `<div class="tab-lock-overlay__card">` +
            `<div class="tab-lock-overlay__icon">${MONITOR_ICON}</div>` +
            `<h2 class="tab-lock-overlay__title">EBGeo Web está aberto em outra janela</h2>` +
            `<p class="tab-lock-overlay__message">Clique no botão abaixo para usar nesta janela. A outra aba será desativada.</p>` +
            `<button class="tab-lock-overlay__button" type="button">Usar aqui</button>` +
        `</div>`;

    el.querySelector('.tab-lock-overlay__button').addEventListener('click', () => {
        takeover();
    });

    document.body.appendChild(el);
    return el;
}

/**
 * Shows the blocking overlay.
 */
function showOverlay() {
    if (!overlay) overlay = createOverlay();
    requestAnimationFrame(() => {
        overlay.classList.add('tab-lock-overlay--visible');
    });
    isActive = false;
}

/**
 * Hides the blocking overlay.
 */
function hideOverlay() {
    if (overlay) {
        overlay.classList.remove('tab-lock-overlay--visible');
    }
    isActive = true;
}

/**
 * Sends TAKEOVER to claim the active session.
 */
function takeover() {
    if (channel) {
        channel.postMessage({ type: Msg.TAKEOVER });
    }
    hideOverlay();
}

/**
 * Handles incoming BroadcastChannel messages.
 * @param {MessageEvent} event
 */
function handleMessage(event) {
    const { type } = event.data || {};

    switch (type) {
    case Msg.PING:
        if (isActive && channel) {
            channel.postMessage({ type: Msg.PONG });
        }
        break;

    case Msg.TAKEOVER:
        showOverlay();
        break;
    }
}

/**
 * Initializes the tab lock system.
 *
 * Sends a PING and waits briefly for a PONG. If another tab responds,
 * shows the blocking overlay over the already-loaded app.
 */
export function initTabLock() {
    // Already initialized (HMR guard)
    if (channel) return;

    // BroadcastChannel not supported — skip silently
    if (typeof BroadcastChannel === 'undefined') {
        isActive = true;
        return;
    }

    channel = new BroadcastChannel(CHANNEL_NAME);

    let responded = false;

    // Temporarily listen for PONG during the detection window
    const onPong = (event) => {
        if (event.data?.type === Msg.PONG && !responded) {
            responded = true;
            showOverlay();
        }
    };

    channel.addEventListener('message', onPong);

    // Ask if any tab is already active
    channel.postMessage({ type: Msg.PING });

    setTimeout(() => {
        channel.removeEventListener('message', onPong);
        if (!responded) {
            isActive = true;
        }
        // Set permanent handler after the probe window
        channel.onmessage = handleMessage;
    }, PING_TIMEOUT_MS);
}
