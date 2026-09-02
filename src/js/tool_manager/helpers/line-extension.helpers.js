// Path: js/tool_manager/helpers/line-extension.helpers.js

/**
 * @fileoverview The two clickable handles that let the user CONTINUE a selected
 * `line`, `arrow` or `boundary` from either of its ends. The decisions live in
 * `line-extension.model.js` (pure); everything impure lives here: the store
 * locks, the DOM buttons and the MapLibre markers that carry them.
 *
 * WHY A DOM MARKER AND NOT A GeoJSON HANDLE. The three tools already draw their
 * vertex handles as circles in a `*-edit-handles` source, and a fourth kind of
 * circle at the SAME coordinate as the first and last vertex would be
 * indistinguishable from them under `queryRenderedFeatures` and would steal the
 * drag that moves the vertex. A `maplibregl.Marker` is a separate DOM node, sits
 * ABOVE the vertex (`HANDLE_OFFSET_PX`) so the two targets never overlap, and is
 * a real `<button>`, so it is reachable by keyboard and reads as a command.
 *
 * WHY EVERY POINTER EVENT IS STOPPED. Marker elements are appended to
 * `map.getCanvasContainer()`, which is exactly where MapLibre and this app hang
 * their own listeners: `MoveHandler` starts a feature drag on `mousedown` and
 * `touchstart`, the arrow and boundary controls open a handle drag on
 * `pointerdown`, and `SelectionManager._handleMapClick` deselects (or, with a
 * tool active, draws) on `click`. Without `stopPropagation` on all four, one
 * press on this button would drag the whole feature AND drop a phantom vertex.
 *
 * WHY THE CLICK IS DEFERRED BY ONE FRAME. `startExtending` switches the active
 * tool, which is what installs the map click listener that collects the drawing
 * points. Calling it inside the click handler would let the very click that
 * opened the mode reach the freshly installed listener on the same tick. This is
 * the pattern `draw_tools/line_tool/line-split.js` documents.
 */

import { isCurrentMapLockedSync, isFeatureEffectivelyLocked } from '@store';
import { canExtendFeature, resolveEndpoints, EXTENSION_ENDS } from './line-extension.model.js';

/**
 * Vertical offset, in pixels, between the vertex and its continuation button.
 * It must clear the 8 px radius of the vertex circle plus half the button, so
 * neither target sits on top of the other.
 * @constant {number}
 */
const HANDLE_OFFSET_PX = -26;

/** Pointer events swallowed by the button. @constant {string[]} */
const SWALLOWED_EVENTS = Object.freeze(['click', 'mousedown', 'pointerdown', 'touchstart']);

/** pt-BR label of the command. @constant {string} */
const HANDLE_TITLE = 'Continuar a partir desta ponta';

/** Static plus-in-a-circle glyph. @constant {string} */
const HANDLE_ICON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9"/>
        <line x1="12" y1="8" x2="12" y2="16"/>
        <line x1="8" y1="12" x2="16" y2="12"/>
    </svg>
`;

/**
 * Live handles, keyed by map instance. A WeakMap (not a module-level variable)
 * because two maps can exist at once (the main map and a hidden export map) and
 * a shared slot would let one of them tear down the other's buttons.
 * @type {WeakMap<Object, Array<{marker: Object, element: HTMLElement, handlers: Array}>>}
 */
const handlesByMap = new WeakMap();

/**
 * Why the surrounding state forbids continuing this feature right now.
 *
 * ONE predicate for both the affordance and the action: the handle is not drawn
 * when this returns a reason, and `startExtending` re-asks at click time because
 * the map can be locked while the handle sits on screen.
 *
 * @param {Object} [feature] - Candidate feature
 * @returns {string|null} pt-BR reason, or null when the continuation is allowed
 */
export function extensionDenialReason(feature) {
    if (isCurrentMapLockedSync()) return 'Mapa está bloqueado';

    const verdict = canExtendFeature(feature);
    if (!verdict.ok) return verdict.reason;

    if (isFeatureEffectivelyLocked(feature)) return 'Feição está bloqueada';

    return null;
}

/**
 * Build one continuation button.
 * @param {string} end - Which end it continues ('start' | 'end')
 * @returns {HTMLButtonElement} The button element
 */
function buildHandleElement(end) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `line-extension-handle line-extension-handle--${end}`;
    button.dataset.end = end;
    button.title = HANDLE_TITLE;
    button.setAttribute('aria-label', HANDLE_TITLE);
    button.innerHTML = HANDLE_ICON;
    return button;
}

/**
 * Remove both handles from a map. Idempotent: safe to call when none are up.
 * @param {Object} map - MapLibre map instance
 */
export function hideExtensionHandles(map) {
    const entries = handlesByMap.get(map);
    if (!entries) return;

    for (const { marker, element, handlers } of entries) {
        for (const [type, handler] of handlers) {
            element.removeEventListener(type, handler);
        }
        marker.remove();
    }

    handlesByMap.delete(map);
}

/**
 * Draw a continuation button on the first and the last vertex of `feature`.
 *
 * @param {Object} map - MapLibre map instance
 * @param {Object} feature - Selected linear feature
 * @param {Object} control - The feature's own control, which owns `startExtending`
 * @returns {boolean} True when the handles were drawn
 */
export function showExtensionHandles(map, feature, control) {
    hideExtensionHandles(map);

    if (!map || typeof control?.startExtending !== 'function') return false;
    if (extensionDenialReason(feature)) return false;

    const endpoints = resolveEndpoints(feature);
    if (!endpoints) return false;

    const entries = [];

    for (const end of EXTENSION_ENDS) {
        const element = buildHandleElement(end);
        const handlers = [];

        for (const type of SWALLOWED_EVENTS) {
            const handler = (event) => {
                event.stopPropagation();
                if (type !== 'click') return;
                event.preventDefault();
                // One frame late, so this very click cannot reach the map
                // listener the tool switch is about to install.
                requestAnimationFrame(() => control.startExtending(feature, end));
            };
            element.addEventListener(type, handler);
            handlers.push([type, handler]);
        }

        const marker = new maplibregl.Marker({
            element,
            offset: [0, HANDLE_OFFSET_PX],
            anchor: 'center'
        })
            .setLngLat(endpoints[end])
            .addTo(map);

        entries.push({ marker, element, handlers });
    }

    handlesByMap.set(map, entries);
    return true;
}
