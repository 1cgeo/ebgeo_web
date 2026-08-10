// Path: js/street_view_tool/components/floor-selector-360.js
/**
 * @module street_view_tool/components/floor-selector-360
 * @description Vertical floor picker for indoor 360 projects, plus the state of
 * which floor the map layers are showing.
 *
 * WHY A FLOOR PICKER IS NOT A CONVENIENCE HERE. An indoor survey stacks photos
 * vertically over the same footprint. In the Beira-Rio project, 91 of 350
 * photos have a photo of a DIFFERENT floor closer than 5 m in plan, the nearest
 * pair at 0,7 m, against a step of 8 to 13 m within a floor. Drawn together,
 * the floors are an unreadable blob and no click lands where the user aimed.
 *
 * IT ALSO RESCUES A DEFECT IN THE DATA. The delivered navigation graph has no
 * link between floor 6 and anything else: those 18 photos are an island. The
 * picker is the only way to reach them until the survey team adds the stair.
 *
 * WHAT IT DOES NOT DO: it never filters the markers drawn INSIDE the panorama.
 * Those are the stairs and the doors. Hiding a target because it leads to
 * another floor would delete the way out of the room. Instead the viewer calls
 * `setActiveFloor` when the user walks through one, and the picker follows.
 */

import { fetchProjectFloors } from '../streetview-api.service.js';

/** @type {HTMLElement|null} */
let containerEl = null;
/** @type {HTMLElement|null} */
let rootEl = null;
/** @type {Array<Object>} */
let floors = [];
/** @type {number|null} */
let activeLevel = null;
/** @type {string|null} */
let loadedSlug = null;
/** @type {Function|null} */
let onChangeCallback = null;

/**
 * Short label for a button. The full label goes in the tooltip: the strip is
 * a column of narrow buttons and "1º andar" would not fit.
 * @param {Object} floor - Floor payload
 * @returns {string} One to three characters
 */
export function shortLabel(floor) {
    if (floor.level === 0) return 'Ext';
    if (floor.level < 0) return `S${-floor.level}`;
    return String(floor.level);
}

/**
 * Which floor to open on. Exported so it can be tested without a DOM.
 *
 * A photo's own floor wins whenever the project actually has it. The fallback
 * is the LOWEST floor, not the first in the array: the list arrives top-first
 * (6, 5, ..., 0) and opening a building on its top floor would put the user
 * somewhere they never asked to be. Ground level is where one walks in.
 *
 * @param {Array<Object>} list - Floors, top level first
 * @param {number|null|undefined} requested - Floor of the photo being opened
 * @returns {number|null} Level to activate, or null when there are no floors
 */
export function resolveInitialLevel(list, requested) {
    if (!Array.isArray(list) || list.length === 0) return null;
    if (list.some(f => f.level === requested)) return requested;
    return list[list.length - 1].level;
}

/**
 * Mounts the picker for a project and returns whether it has floors at all.
 *
 * @param {HTMLElement} container - Element the strip is appended to
 * @param {string} slug - Project slug
 * @param {Object} [options] - Options
 * @param {Function} [options.onChange] - Called with (level, floor) on change
 * @param {number|null} [options.initialLevel] - Floor to start on
 * @returns {Promise<boolean>} true when the project has floors
 */
export async function initFloorSelector(container, slug, options = {}) {
    containerEl = container;
    onChangeCallback = options.onChange || null;

    // Cache por projeto: navegar entre fotos do MESMO levantamento nao refaz a
    // chamada, e trocar de projeto refaz.
    if (slug !== loadedSlug) {
        floors = await fetchProjectFloors(slug);
        loadedSlug = slug;
        activeLevel = null;
    }

    if (floors.length === 0) {
        destroyFloorSelector();
        return false;
    }

    if (activeLevel === null) {
        activeLevel = resolveInitialLevel(floors, options.initialLevel);
    }

    render();
    return true;
}

/** Builds (or rebuilds) the strip. */
function render() {
    if (!containerEl) return;

    if (!rootEl) {
        rootEl = document.createElement('div');
        rootEl.className = 'sv360-floors';
        // Delegacao num unico listener: os botoes sao reescritos a cada troca,
        // e um listener por botao vazaria um a cada clique.
        rootEl.addEventListener('click', (ev) => {
            const botao = ev.target.closest('.sv360-floors__btn');
            if (botao) setActiveFloor(Number(botao.dataset.level));
        });
        containerEl.appendChild(rootEl);
    }

    rootEl.replaceChildren(...floors.map(f => {
        const b = document.createElement('button');
        b.className = 'sv360-floors__btn';
        if (f.level === activeLevel) b.classList.add('sv360-floors__btn--active');
        b.dataset.level = String(f.level);
        b.type = 'button';
        b.title = `${f.label} (${f.photoCount} fotos)`;
        b.textContent = shortLabel(f);
        return b;
    }));
}

/**
 * Switches the active floor and notifies the listener.
 *
 * Called both by a click on the strip and by the viewer when the user walks
 * through a cross-floor target, which is why it is idempotent and tolerates a
 * level the project does not have.
 *
 * @param {number} level - Floor level to activate
 * @returns {boolean} true when the floor changed
 */
export function setActiveFloor(level) {
    if (floors.length === 0) return false;
    if (level === activeLevel) return false;
    if (!floors.some(f => f.level === level)) return false;

    activeLevel = level;
    render();

    if (onChangeCallback) {
        onChangeCallback(activeLevel, floors.find(f => f.level === activeLevel) || null);
    }
    return true;
}

/**
 * The floor currently shown, or null when the project has none.
 * @returns {number|null} Active level
 */
export function getActiveFloor() {
    return floors.length > 0 ? activeLevel : null;
}

/**
 * The plan of the active floor, as GeoJSON, or null.
 * @returns {Object|null} FeatureCollection of lines
 */
export function getActiveFloorPlan() {
    if (floors.length === 0) return null;
    return floors.find(f => f.level === activeLevel)?.plan || null;
}

/**
 * Whether the loaded project has floors at all.
 * @returns {boolean}
 */
export function hasFloors() {
    return floors.length > 0;
}

/** Removes the strip and clears the state. */
export function destroyFloorSelector() {
    if (rootEl) {
        rootEl.remove();
        rootEl = null;
    }
    activeLevel = null;
    onChangeCallback = null;
}

/** Full teardown, including the per-project cache. Used when the viewer closes. */
export function resetFloorSelector() {
    destroyFloorSelector();
    floors = [];
    loadedSlug = null;
    containerEl = null;
}
