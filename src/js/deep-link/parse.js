// Path: js/deep-link/parse.js

/**
 * @module deep-link/parse
 * @description Reading of the URL hash into a typed viewer descriptor. Pure: it
 * touches `window.location` and nothing else.
 *
 * WHY IT IS NOT IN `deep-link.js`. That module imports `@store` and the `@utils`
 * barrel, because OPENING a viewer needs both. READING the hash needs neither, and
 * the grammar is the one part of deep linking that has to be verifiable on its own:
 * a link that someone shared last year has to keep resolving to the same descriptor
 * after any refactor. Splitting the reader out is what lets a test assert that
 * without booting the app.
 *
 * THE GRAMMAR IS A FROZEN CONTRACT. Every link ever copied out of the app is a
 * promise this parser has to keep. Three rules follow, and they are the reason the
 * shapes below look conservative:
 *   - a key is only ever ADDED, never renamed or removed;
 *   - a missing or unreadable value falls back to the caller's default, never to
 *     zero, because zero is a real coordinate;
 *   - an unknown key is ignored in silence, so a link written by a newer build
 *     still opens on an older one, losing only what that build cannot express.
 *
 * The grammars, one per viewer:
 *   #view=360&photo=<uuid>&lon=<deg>&lat=<deg>&fov=<deg>
 *   #view=3d&tileset=<id>&lon=<deg>&lat=<deg>&h=<m>&heading=<rad>&pitch=<rad>&roll=<rad>
 *   #view=fp&scene=<id>&x=<m>&y=<m>&z=<m>&yaw=<rad>&pitch=<rad>
 *   #view=base&base=<id>&lon=<deg>&lat=<deg>&z=<n>&b=<deg>&p=<deg>
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
 *         | { type: 'base', basemap: string|null, lon: number|null, lat: number|null, zoom: number|null, bearing: number|null, pitch: number|null }
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

    if (view === 'base') {
        const basemap = params.get('base') || null;
        const lon = parseFiniteParam(params.get('lon'));
        const lat = parseFiniteParam(params.get('lat'));

        // A LINK THAT ASKS FOR NOTHING IS NOT A LINK. The other three viewers each
        // have a mandatory subject (a photo, a tileset, a scene) and return null
        // without it; this one has two optional halves, so the guard is that at
        // least ONE has to be usable. It matters beyond tidiness: a non-null
        // descriptor makes the caller wipe the hash, so `#view=base` alone would
        // erase itself from the address bar and do nothing, which reads to the
        // person as the app silently swallowing their link.
        //
        // A HALF COORDINATE IS NOT A POSITION either. Longitude without latitude
        // would place the camera on a meridian at whatever latitude happened to be
        // showing, which is not a place anyone chose.
        const hasPosition = lon !== null && lat !== null;
        if (!basemap && !hasPosition) return null;

        return {
            type: 'base',
            basemap,
            lon: hasPosition ? lon : null,
            lat: hasPosition ? lat : null,
            zoom: parseFiniteParam(params.get('z')),
            bearing: parseFiniteParam(params.get('b')),
            pitch: parseFiniteParam(params.get('p'))
        };
    }

    return null;
}
