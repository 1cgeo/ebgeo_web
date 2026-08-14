// Path: js/deep-link/parse.js

/**
 * @module deep-link/parse
 * @description Reading of the URL hash into a typed viewer descriptor. Pure: it
 * touches `window.location` and nothing else.
 *
 * WHY IT IS NOT IN `deep-link.js`. That module imports `@store` and the `@utils`
 * barrel, because OPENING a viewer needs both. Deciding the boot route needs
 * neither, and `route-decision.js` runs at phase -1 of the boot, before anything
 * is built. With the parser living next to the openers, importing it from the
 * router made `deep-link.js` statically reachable from the entry, which cost two
 * things at once: the module and its barrels landed in the boot chunk, and the
 * four `import('./deep-link.js')` call sites elsewhere became inert (Rolldown
 * says so out loud, as INEFFECTIVE_DYNAMIC_IMPORT). Splitting the reader from the
 * openers is what keeps the openers lazy.
 *
 * The grammars, one per viewer:
 *   #view=360&photo=<uuid>&lon=<deg>&lat=<deg>&fov=<deg>
 *   #view=3d&tileset=<id>&lon=<deg>&lat=<deg>&h=<m>&heading=<rad>&pitch=<rad>&roll=<rad>
 *   #view=fp&scene=<id>&x=<m>&y=<m>&z=<m>&yaw=<rad>&pitch=<rad>
 */

/**
 * Parses one hash parameter as a finite number.
 *
 * Everything in the hash is third-party text: it can be truncated by a chat
 * client, hand-edited or plain garbage. `parseFloat('12abc')` returns 12 and
 * `Number('')` returns 0 - both would send the camera somewhere nobody asked
 * for. This accepts only a value that reads as a whole finite number, and
 * reports anything else as absent so the caller can fall back.
 *
 * @param {string|null} raw - Raw parameter value
 * @returns {number|null} The number, or null when it is missing or invalid
 */
function parseFiniteParam(raw) {
    if (raw === null || raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

/**
 * Parses the URL hash into a typed deep link descriptor.
 * @returns {{ type: '360', photo: string, lon: number, lat: number, fov: number }
 *         | { type: '3d', tileset: string, lon: number, lat: number, height: number, heading: number, pitch: number, roll: number }
 *         | { type: 'fp', scene: string, x: number|null, y: number|null, z: number|null, yaw: number|null, pitch: number|null }
 *         | null}
 */
export function parseDeepLink() {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return null;

    const params = new URLSearchParams(hash.substring(1));
    const view = params.get('view');

    if (view === '360') {
        const photo = params.get('photo');
        if (!photo) return null;
        return {
            type: '360',
            photo,
            lon: parseFloat(params.get('lon')),
            lat: parseFloat(params.get('lat')),
            fov: parseFloat(params.get('fov'))
        };
    }

    if (view === '3d') {
        const tileset = params.get('tileset');
        if (!tileset) return null;
        return {
            type: '3d',
            tileset,
            lon: parseFloat(params.get('lon')),
            lat: parseFloat(params.get('lat')),
            height: parseFloat(params.get('h')),
            heading: parseFloat(params.get('heading')),
            pitch: parseFloat(params.get('pitch')),
            roll: parseFloat(params.get('roll'))
        };
    }

    if (view === 'fp') {
        const scene = params.get('scene');
        if (!scene) return null;
        return {
            type: 'fp',
            scene,
            x: parseFiniteParam(params.get('x')),
            y: parseFiniteParam(params.get('y')),
            z: parseFiniteParam(params.get('z')),
            yaw: parseFiniteParam(params.get('yaw')),
            pitch: parseFiniteParam(params.get('pitch'))
        };
    }

    return null;
}
