// Path: js/tool_manager/helpers/line-extension.helpers.js

/**
 * @fileoverview THE TWO HANDLES that continue a selected `line`, `arrow` or `boundary` from
 * either of its ends. The decisions live in `line-extension.model.js` (pure); everything impure
 * lives here: the store locks, the rank of whoever is asking, the DOM buttons and the MapLibre
 * markers that carry them.
 *
 * ================= THE AFFORDANCE, AND WHY IT GROWS NO NEW SURFACE ==========
 *
 * The house rule has two sides (`.claude/rules/architecture.md`, UI Architecture): a block by
 * RANK disappears, a block by STATE is drawn and refuses the click NAMING the state. Both sides
 * exist here, and only one of them produces a surface:
 *
 *   - RANK DISAPPEARS, and it is the FIRST question `extensionDenialReason` asks. Whoever lacks
 *     `UPDATE_FEATURE` gets no handle at all: continuing is an update, and a dead handle reading
 *     "requires Editor" turns the end of a feature into a catalogue of what the person is not.
 *     Today a reader still gets the VERTEX handles (a defect that predates this batch, and of
 *     another scope); this handle is born with the gate instead of inheriting that.
 *   - STATE GETS NO NEW COMMAND, and that IS the decision, not an omission. The handle rides
 *     with the vertex handle: it is wired in `createEditHandles`, which `selectFeature` does NOT
 *     call on a locked map, and a locked feature cannot even be selected. Drawing a continuation
 *     handle where the tool has already decided to draw nothing would invent the only actionable
 *     surface on a screen the product chose to leave inert. What state does get is the RE-ASK on
 *     click: a peer can lock the map while the handle sits on screen, and in that case
 *     `startExtending` asks again and the refusal names the state.
 *
 * ================= WHY A DOM MARKER, AND NOT A GeoJSON HANDLE ==============
 *
 * The three tools already draw their vertex handles as circles in a `*-edit-handles` source, and
 * a fourth kind of circle at the SAME coordinate as the first and last vertex would be
 * indistinguishable from them under `queryRenderedFeatures` and would steal the drag that moves
 * the vertex. A `maplibregl.Marker` is a separate DOM node, sits ABOVE the vertex
 * (`HANDLE_OFFSET_PX`) so the two targets never overlap, and is a real `<button>`, reachable by
 * keyboard and legible as a command.
 *
 * ================= WHY EVERY POINTER EVENT IS SWALLOWED ====================
 *
 * Marker elements are appended to `map.getCanvasContainer()`, which is exactly where MapLibre
 * and this app hang their own listeners: `MoveHandler` starts a feature drag on `mousedown` and
 * `touchstart`, the arrow and boundary controls open a handle drag on `pointerdown`, and
 * `SelectionManager._handleMapClick` deselects (or, with a tool active, draws) on `click`.
 * Without `stopPropagation` on all FOUR, one press on this button would drag the whole feature
 * AND drop a phantom vertex.
 *
 * ================= WHY THE CLICK IS DEFERRED BY ONE FRAME ==================
 *
 * `startExtending` switches the active tool, and it is that switch which installs the map click
 * listener that collects the drawing points. Calling it from inside the click handler would let
 * the very click that OPENS the mode reach, on the same tick, the listener the switch has just
 * installed: the handle would become the first drawn vertex.
 */

import { isCurrentMapLockedSync, isFeatureEffectivelyLocked } from '@store';
import { checkPermission } from '@store/sync/permission-guard.js';
import { denialNotice } from '@store/denial-phrases.js';
import { canExtendFeature, resolveEndpoints, EXTENSION_ENDS } from './line-extension.model.js';
import { maplibregl } from '@js/map/maplibre.js';

/**
 * The `GuardAction` key that continuing a feature consumes.
 *
 * THE KEY, never the value: `checkPermission` resolves `GuardAction[action]` internally and
 * returns the value in `required`, which is what `denialNotice` knows how to translate. Passing
 * the value works by accident (the `|| action` fallback) and loses the readable half of the
 * report.
 *
 * ONE capability, not two as in the conversion: continuing rewrites the spine of the SAME
 * feature, with the same id, so it is an update and nothing else. Asking for `DELETE_FEATURE`
 * alongside would hide the handle from an Editor who can do exactly what it does.
 * @type {string}
 */
const EXTENSION_CAPABILITY = 'UPDATE_FEATURE';

/** The locked-map sentence, a copy of the one `linear-conversion.model.js` declares. @type {string} */
const LOCKED_MAP_NOTICE = 'Este mapa está bloqueado. Destrave-o para fazer esta alteração.';

/** The sentence for a feature locked by its layer or by its group. @type {string} */
const LOCKED_CONTAINER_NOTICE = 'A camada ou o grupo desta feição está bloqueado.';

/**
 * Vertical offset, in pixels, between the vertex and the button that continues it. It must clear
 * the 8 px radius of the vertex circle plus half the button, so neither target sits on top of
 * the other.
 * @type {number}
 */
const HANDLE_OFFSET_PX = -26;

/** Pointer events swallowed by the button. @type {readonly string[]} */
const SWALLOWED_EVENTS = Object.freeze(['click', 'mousedown', 'pointerdown', 'touchstart']);

/** The command's pt-BR label. @type {string} */
const HANDLE_TITLE = 'Continuar a partir desta ponta';

/**
 * The static plus-in-a-circle glyph.
 *
 * STATIC SVG, without a single interpolation: no user data ever reaches this string, which is
 * the condition under which the constitution allows `innerHTML` for an icon.
 * @type {string}
 */
const HANDLE_ICON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9"/>
        <line x1="12" y1="8" x2="12" y2="16"/>
        <line x1="8" y1="12" x2="16" y2="12"/>
    </svg>
`;

/**
 * The live handles, keyed by map instance.
 *
 * A `WeakMap`, and not a module-level variable, because two maps can exist at once (the main map
 * and the hidden map of the PDF mosaic) and a shared slot would let one of them tear down the
 * other's buttons.
 * @type {WeakMap<Object, Array<{marker: Object, element: HTMLElement, handlers: Array}>>}
 */
const handlesByMap = new WeakMap();

/**
 * WHY THIS FEATURE CANNOT BE CONTINUED RIGHT NOW, in pt-BR, or `null` when it can.
 *
 * ONE predicate for both the affordance and the action: the handle is not drawn when this
 * returns a sentence, and `startExtending` asks again on click, because a peer can lock the map
 * while the handle sits on screen.
 *
 * THE ORDER IS THE RULE'S, not convenience: rank first (the one that makes the handle
 * DISAPPEAR), then the states, from the most surprising to the most local. It FAILS CLOSED: a
 * `checkPermission` that throws hides the handle, because losing a click costs less than
 * offering work the store refuses in silence.
 *
 * @param {Object} [feature] - Candidate feature
 * @returns {string|null} The refusal sentence, or null when the continuation is allowed
 */
export function extensionDenialReason(feature) {
    // RANK. Disappears.
    let perm;
    try {
        perm = checkPermission(EXTENSION_CAPABILITY);
    } catch (error) {
        console.warn('Permission check threw while deciding the continuation handles:', error);
        return denialNotice(null);
    }
    if (perm?.allowed !== true) return denialNotice(perm?.required);

    // STATE. Only refuses here; the handle never gets to exist, because the one who wires it is
    // `createEditHandles`, which these same states already keep from running.
    if (isCurrentMapLockedSync()) return LOCKED_MAP_NOTICE;

    const verdict = canExtendFeature(feature);
    if (!verdict.ok) return verdict.reason;

    if (isFeatureEffectivelyLocked(feature)) return LOCKED_CONTAINER_NOTICE;

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
 * Remove both handles from a map. IDEMPOTENT: safe to call with none up, which is the case for
 * nearly every deselection.
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
 * @returns {boolean} True when both handles were drawn
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
                // One frame late, so this very click cannot reach the map listener the tool
                // switch is about to install.
                requestAnimationFrame(() => control.startExtending(feature, end));
            };
            element.addEventListener(type, handler);
            handlers.push([type, handler]);
        }

        const marker = new maplibregl.Marker({
            element,
            offset: [0, HANDLE_OFFSET_PX],
            anchor: 'center',
        })
            .setLngLat(endpoints[end])
            .addTo(map);

        entries.push({ marker, element, handlers });
    }

    handlesByMap.set(map, entries);
    return true;
}
