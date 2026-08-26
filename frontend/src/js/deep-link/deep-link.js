// Path: js/deep-link/deep-link.js

/**
 * @module deep-link
 * @description URL hash-based deep linking for 360 photos, 3D models and
 * first-person (Gaussian splatting) scenes.
 * Allows sharing a URL that opens a specific viewer with camera position/orientation.
 *
 * URL formats:
 *   #view=360&photo=<uuid>&lon=<deg>&lat=<deg>&fov=<deg>
 *   #view=3d&tileset=<id>&lon=<deg>&lat=<deg>&h=<meters>&heading=<rad>&pitch=<rad>&roll=<rad>
 *   #view=fp&scene=<id>&x=<m>&y=<m>&z=<m>&yaw=<rad>&pitch=<rad>
 *   #view=base&base=<id>&lon=<deg>&lat=<deg>&z=<n>&b=<deg>&p=<deg>
 *
 * The first-person pose is in the scene's own metric space (the octree frame),
 * not in geographic coordinates: it comes straight out of the walk controller.
 *
 * The grammar itself lives in `./parse.js`, and it is a FROZEN CONTRACT shared
 * with the `main` line of the product: the rules and the golden vectors that hold
 * them are named in that file's header.
 */

import { getControl } from '@store';
import { showSuccess, showError } from '@utils';
import { parseDeepLink } from './parse.js';

// The reader lives in `./parse.js` so the boot router can consult it without
// dragging the openers (and `@store`, and the `@utils` barrel) into the entry
// chunk. Re-exported here because every existing call site imports it from this
// module, and the split is an internal matter.
export { parseDeepLink };

// ===== URL PARSING =====

/**
 * Formats a number for the hash, falling back to zero when it is not finite.
 * `NaN.toFixed(2)` writes the literal "NaN" into a link that then gets shared.
 * @param {number} value - Value to format
 * @param {number} digits - Decimal places
 * @returns {string}
 */
function formatFixed(value, digits) {
    return (Number.isFinite(value) ? value : 0).toFixed(digits);
}

// ===== URL BUILDING =====

/**
 * The part of the current address a shared link keeps: origin, path AND query.
 *
 * THE QUERY USED TO BE DROPPED HERE, and in this package that omission had teeth:
 * `?atlas=` and `?map=` live in the query, so a share URL built from origin+path
 * alone forgot which atlas the person was in. The hash and the query are
 * orthogonal by design (`deep-link/atlas-link.js` says so) and never collide, so
 * keeping the query costs nothing.
 *
 * WHAT IT DOES NOT FIX, said out loud so nobody reads more into it: the atlas in
 * the query is not yet consulted when the viewer opens. The 360 and 3D deep links
 * fire from the map's `load` handler, and the atlas scope is only declared when
 * the sync engine connects, which happens after. So a link to a resource that is
 * only reachable through an atlas LOAN still fails, and this is a separate fix.
 * A public resource, which is what these links are for, needs no scope at all.
 *
 * The existing hash is deliberately NOT kept: it is about to be replaced by the
 * one the caller is building.
 * @returns {string} Everything up to (and excluding) the fragment.
 */
function shareUrlBase() {
    return window.location.origin + window.location.pathname + window.location.search;
}

/**
 * Builds a shareable URL for a 360 photo view.
 * @param {string} photoName - Photo UUID
 * @param {number} lon - Horizontal rotation (degrees)
 * @param {number} lat - Vertical rotation (degrees)
 * @param {number} fov - Field of view (degrees)
 * @returns {string} Full URL with hash
 */
export function buildShareUrl360(photoName, lon, lat, fov) {
    const base = shareUrlBase();
    const params = new URLSearchParams();
    params.set('view', '360');
    params.set('photo', photoName);
    params.set('lon', lon.toFixed(2));
    params.set('lat', lat.toFixed(2));
    params.set('fov', fov.toFixed(1));
    return `${base}#${params.toString()}`;
}

/**
 * Builds a shareable URL for a 3D model view.
 * @param {string} tilesetId - Tileset identifier
 * @param {number} lon - Camera longitude (degrees)
 * @param {number} lat - Camera latitude (degrees)
 * @param {number} height - Camera height (meters)
 * @param {number} heading - Camera heading (radians)
 * @param {number} pitch - Camera pitch (radians)
 * @param {number} roll - Camera roll (radians)
 * @returns {string} Full URL with hash
 */
export function buildShareUrl3D(tilesetId, lon, lat, height, heading, pitch, roll) {
    const base = shareUrlBase();
    const params = new URLSearchParams();
    params.set('view', '3d');
    params.set('tileset', tilesetId);
    params.set('lon', lon.toFixed(6));
    params.set('lat', lat.toFixed(6));
    params.set('h', height.toFixed(1));
    params.set('heading', heading.toFixed(4));
    params.set('pitch', pitch.toFixed(4));
    params.set('roll', roll.toFixed(4));
    return `${base}#${params.toString()}`;
}

/**
 * Builds a shareable URL for a first-person scene view.
 * Distances are metres with 2 decimals (centimetre precision, which is the
 * voxel scale of the collision octree) and angles are radians with 4 decimals,
 * the same precision the 3D link uses.
 * @param {string} sceneId - Scene identifier
 * @param {number} x - Camera X in the scene's metric space (metres)
 * @param {number} y - Camera Y in the scene's metric space (metres)
 * @param {number} z - Camera Z in the scene's metric space (metres)
 * @param {number} yaw - Camera yaw (radians)
 * @param {number} pitch - Camera pitch (radians)
 * @returns {string} Full URL with hash
 */
export function buildShareUrlFirstPerson(sceneId, x, y, z, yaw, pitch) {
    const base = shareUrlBase();
    const params = new URLSearchParams();
    params.set('view', 'fp');
    params.set('scene', sceneId);
    params.set('x', formatFixed(x, 2));
    params.set('y', formatFixed(y, 2));
    params.set('z', formatFixed(z, 2));
    params.set('yaw', formatFixed(yaw, 4));
    params.set('pitch', formatFixed(pitch, 4));
    return `${base}#${params.toString()}`;
}

/**
 * Builds a shareable URL for the 2D map: a base layer, seen from a camera.
 *
 * WHY THE BASE LAYER AND NOT THE WHOLE SCREEN. This link answers "look at THIS,
 * from HERE", and the base layer is the only part of the 2D view that is both a
 * catalogued thing with a stable id and cheap to name in a URL. Which catalogue
 * layers were on, what the temporal cursor read, which features were drawn: none
 * of that fits in a fragment, and most of it is not the recipient's to see. The
 * atlas, which IS the way to share the rest, already travels in the query.
 *
 * PRECISION IS CHOSEN, NOT COPIED. Six decimals of degree is about 10 cm, past
 * what the base layer itself has to show; zoom keeps two decimals because
 * MapLibre zoom is continuous and a rounded one visibly jumps; bearing and pitch
 * keep one, finer than anyone can aim by dragging.
 *
 * `basemapId` MAY BE NULL and then the key is simply absent, rather than present
 * and empty. The parser reads an absent base as "keep whatever the recipient has",
 * and `base=` with nothing after it would mean the same thing while looking like a
 * value. One way to say one thing.
 * @param {string|null} basemapId - Base layer id, or null to share only the camera
 * @param {number} lon - Camera longitude (degrees)
 * @param {number} lat - Camera latitude (degrees)
 * @param {number} zoom - Zoom level
 * @param {number} bearing - Camera bearing (degrees)
 * @param {number} pitch - Camera pitch (degrees)
 * @returns {string} Full URL with hash
 */
export function buildShareUrlBasemap(basemapId, lon, lat, zoom, bearing, pitch) {
    const base = shareUrlBase();
    const params = new URLSearchParams();
    params.set('view', 'base');
    if (basemapId) params.set('base', basemapId);
    params.set('lon', formatFixed(lon, 6));
    params.set('lat', formatFixed(lat, 6));
    params.set('z', formatFixed(zoom, 2));
    params.set('b', formatFixed(bearing, 1));
    params.set('p', formatFixed(pitch, 1));
    return `${base}#${params.toString()}`;
}

// ===== CLIPBOARD UTILITY =====

/**
 * Copies text to clipboard with fallback for non-HTTPS environments.
 * @param {string} text - Text to copy
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        // Fallback for HTTP environments (military deployments)
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
    }
}

/**
 * Copies a share URL to clipboard and shows feedback toast.
 * @param {string} url - URL to copy
 */
export async function copyShareUrl(url) {
    try {
        await copyToClipboard(url);
        showSuccess('Link copiado para a área de transferência!');
    } catch {
        showError('Não foi possível copiar o link');
    }
}

// ===== HASH MANAGEMENT =====

/**
 * Removes the hash fragment from the URL without triggering a page reload.
 */
function clearHash() {
    if (window.location.hash) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
    }
}

// ===== READINESS =====

/**
 * Polls `produce()` until it returns something truthy, or gives up.
 *
 * Deliberately a POLL and not a subscription: what we are waiting on (a lazily
 * constructed Cesium viewer) publishes no event, and the one-shot-event variant of
 * this wait is what silently wedged the 360 viewer — a listener attached after the
 * event fired waits forever. Polling cannot miss a state that is already true.
 *
 * Resolves with `null` on timeout rather than throwing: the caller decides whether
 * a missing dependency is fatal, and here it is not (the model still opens).
 *
 * @param {() => T|null|undefined} produce - Called until it yields a truthy value
 * @param {number} [timeoutMs=5000] - Give up after this long
 * @param {number} [intervalMs=100] - Gap between attempts
 * @returns {Promise<T|null>} the value, or null if it never arrived
 * @template T
 */
export function waitFor(produce, timeoutMs = 5000, intervalMs = 100) {
    // The same guard as inside the loop, and for the same reason: `produce` is
    // typically a getter over a lazily built module, so "not ready" can surface as
    // a throw (`Cesium is not defined`) rather than a falsy value. Letting the
    // FIRST call throw would abort the wait before it started.
    const attempt = () => {
        try {
            return produce();
        } catch {
            return null;
        }
    };

    const immediate = attempt();
    if (immediate) return Promise.resolve(immediate);

    return new Promise(resolve => {
        const deadline = Date.now() + timeoutMs;
        const timer = setInterval(() => {
            const value = attempt();
            if (value) {
                clearInterval(timer);
                resolve(value);
            } else if (Date.now() >= deadline) {
                clearInterval(timer);
                resolve(null);
            }
        }, intervalMs);
    });
}

// ===== DEEP LINK HANDLER =====

/**
 * Handles a deep link on app initialization.
 * Reads the URL hash, opens the appropriate viewer, and clears the hash.
 * Must be called after all controls are registered and the map is ready.
 *
 * WHY THE 2D VIEW IS THE ONE THAT CAN BE DEFERRED, AND HAS TO BE. The other three
 * viewers own their camera: nothing else in the boot moves it, so opening them
 * from the map's `load` handler is safe. The 2D camera is contested. This boot
 * paints in one of two places, and BOTH end by moving it: the local slot through
 * `renderBootMap` (`switchMap(true)` finishes in `applyMapSavedPosition`), and a
 * server atlas through `openRemoteAtlas`, which runs LATER than this handler and
 * ends the same way. Applying the shared view here would leave no error behind,
 * just the recipient's own last view where the sender's was meant to be.
 *
 * So the caller decides. `map_sig.js` calls this with `deferSharedView` and
 * `index.js` applies it in the `finally` of the boot routing, which is the one
 * point that has run in every outcome. Outside the boot (a link pasted into an
 * open tab) nothing is racing, and the default applies it right here.
 *
 * @param {{deferSharedView?: boolean}} [options]
 * @param {boolean} [options.deferSharedView=false] - Leave a `#view=base` link for
 *   the caller to apply once the boot has finished painting. The hash is cleared
 *   either way, so the caller must have captured the descriptor beforehand.
 */
export async function handleDeepLink({ deferSharedView = false } = {}) {
    const link = parseDeepLink();
    if (!link) return;

    // Clear hash immediately to prevent re-triggering on manual reload
    clearHash();

    if (link.type === '360') {
        await openDeepLink360(link);
    } else if (link.type === '3d') {
        await openDeepLink3D(link);
    } else if (link.type === 'fp') {
        await openDeepLinkFp(link);
    } else if (link.type === 'base' && !deferSharedView) {
        await applySharedView(link);
    }
}

// ===== HASHCHANGE LISTENER =====

let _hashChangeHandler = null;
let _hashChangeDebounce = null;

/**
 * Starts listening for URL hash changes so that sharing a link into an already-open
 * tab (paste URL + Enter) correctly opens the corresponding viewer.
 *
 * Must be called once, after the map and all controls are fully initialized.
 */
export function initDeepLinkListener() {
    if (_hashChangeHandler) return; // already registered

    _hashChangeHandler = () => {
        // Debounce: browsers may fire hashchange twice in quick succession
        clearTimeout(_hashChangeDebounce);
        _hashChangeDebounce = setTimeout(() => {
            handleDeepLink().catch(err =>
                console.warn('[deep-link] hashchange handler error:', err)
            );
        }, 100);
    };

    window.addEventListener('hashchange', _hashChangeHandler);
}

/**
 * Removes the hashchange listener. Call on app teardown / beforeunload.
 */
export function destroyDeepLinkListener() {
    if (_hashChangeHandler) {
        window.removeEventListener('hashchange', _hashChangeHandler);
        _hashChangeHandler = null;
    }
    clearTimeout(_hashChangeDebounce);
}

/**
 * Opens a 360 viewer from a deep link descriptor.
 * @param {{ photo: string, lon: number, lat: number, fov: number }} link
 */
async function openDeepLink360(link) {
    try {
        const { openViewer360WithPhoto } = await import(
            '@js/street_view_tool/street_view_viewer.js'
        );
        const streetViewControl = getControl('streetView');

        const orientation = {};
        if (!isNaN(link.lon)) orientation.lon = link.lon;
        if (!isNaN(link.lat)) orientation.lat = link.lat;
        if (!isNaN(link.fov)) orientation.fov = link.fov;

        await openViewer360WithPhoto(link.photo, {
            miniMap: streetViewControl?.miniMap,
            controlInstance: streetViewControl,
            targetOrientation: Object.keys(orientation).length > 0 ? orientation : undefined
        });
    } catch (error) {
        console.error('[deep-link] Failed to open 360 viewer:', error);
        showError('Erro ao abrir foto 360');
    }
}

/**
 * Opens a 3D viewer from a deep link descriptor.
 * @param {{ tileset: string, lon: number, lat: number, height: number, heading: number, pitch: number, roll: number }} link
 */
async function openDeepLink3D(link) {
    try {
        const modelsViewer = getControl('modelsViewer');
        if (!modelsViewer) {
            showError('Visualizador 3D não disponível');
            return;
        }

        await modelsViewer.openViewer(link.tileset);

        // Apply camera position if valid coordinates are present
        const hasPosition = !isNaN(link.lon) && !isNaN(link.lat) && !isNaN(link.height);
        if (hasPosition) {
            const { getCesiumViewer } = await import(
                '@js/3d_models_viewer_tool/map_3d.js'
            );

            // Settle delay, KEPT: opening a tileset moves the camera to frame it,
            // and that move lands after openViewer resolves — applying the shared
            // viewpoint any earlier just gets overwritten by it.
            await new Promise(resolve => setTimeout(resolve, 500));

            // ...but a fixed delay is a GUESS about someone else's timing, and on a
            // cold boot (Cesium lazy-loaded, tileset over the network) 500 ms can
            // expire with no viewer yet. The old code then took the `if (viewer)`
            // false branch and dropped the camera position in silence: the model
            // opened at its default view and the shared link's entire payload — the
            // viewpoint someone meant to show — vanished with nothing logged.
            // Same failure class as the 360 deep link, milder symptom.
            const viewer = await waitFor(getCesiumViewer, 5000);
            if (!viewer) {
                console.warn(
                    '[deep-link] 3D viewer never became available — the shared camera position was not applied'
                );
            }
            if (viewer) {
                const destination = Cesium.Cartesian3.fromDegrees(
                    link.lon, link.lat, link.height
                );
                const orientation = {};
                if (!isNaN(link.heading)) orientation.heading = link.heading;
                if (!isNaN(link.pitch)) orientation.pitch = link.pitch;
                if (!isNaN(link.roll)) orientation.roll = link.roll;

                viewer.camera.setView({ destination, orientation });
            }
        }
    } catch (error) {
        console.error('[deep-link] Failed to open 3D viewer:', error);
        showError('Erro ao abrir modelo 3D');
    }
}

/**
 * Applies a 2D map view (base layer plus camera) from a deep link descriptor.
 *
 * EXPORTED, unlike the other three openers, because the boot has to call it at a
 * point `handleDeepLink` cannot reach: after the atlas is mounted and painted.
 * See that function's header for why the 2D camera is the contested one.
 *
 * BOTH HALVES ARE OPTIONAL AND INDEPENDENT. A link may carry only a base layer
 * (share what to look at, from wherever the recipient is), only a camera (share
 * where to look, on whatever base layer they have), or both.
 *
 * @param {{ basemap: string|null, lon: number|null, lat: number|null, zoom: number|null, bearing: number|null, pitch: number|null }} link
 * @returns {Promise<void>}
 */
export async function applySharedView(link) {
    try {
        const baseLayerControl = getControl('BaseLayerControl');
        const map = baseLayerControl?.map;
        if (!map) {
            showError('Não foi possível abrir o link: o mapa não está pronto');
            return;
        }

        if (link.basemap) {
            const applied = await baseLayerControl.applySharedBasemap(link.basemap);

            // THE SWAP IS ANNOUNCED, and this is why the method returns what it
            // applied. A base layer the recipient cannot see (private, or simply
            // not in this deploy) falls back to one they can, and staying quiet
            // hands them a map that looks like the one they were sent and is not.
            // Naming the layer that IS on screen is the part they can act on.
            if (applied && applied !== link.basemap) {
                showError(`A camada base do link não está disponível. Mostrando "${applied}".`);
            }
        }

        // MapLibre constrains zoom, bearing and pitch to the map's own limits, so a
        // hand-edited hash asking for zoom 99 is clamped rather than refused. Each
        // key is omitted when absent instead of passed as a default, so what the
        // link is silent about keeps whatever the recipient already had.
        if (link.lon !== null && link.lat !== null) {
            const camera = { center: [link.lon, link.lat] };
            if (link.zoom !== null) camera.zoom = link.zoom;
            if (link.bearing !== null) camera.bearing = link.bearing;
            if (link.pitch !== null) camera.pitch = link.pitch;
            map.jumpTo(camera);
        }
    } catch (error) {
        console.error('[deep-link] Failed to apply map view:', error);
        showError('Erro ao abrir a vista compartilhada');
    }
}

/**
 * Merges the pose from the link with the scene's configured starting pose.
 *
 * Any component the hash did not carry as a finite number falls back to
 * `poseInicial`. If a component is missing on both sides the whole pose is
 * dropped, so the viewer applies its own default instead of receiving a
 * half-built pose that would put the camera at an arbitrary zero.
 *
 * @param {{ x: number|null, y: number|null, z: number|null, yaw: number|null, pitch: number|null }} link
 * @param {{ x: number, y: number, z: number, yaw: number, pitch: number }|null} [poseInicial]
 * @returns {{ x: number, y: number, z: number, yaw: number, pitch: number }|null}
 */
export function resolveFpPose(link, poseInicial = null) {
    const fallback = poseInicial || {};
    const pose = {};

    for (const key of ['x', 'y', 'z', 'yaw', 'pitch']) {
        if (Number.isFinite(link[key])) {
            pose[key] = link[key];
        } else if (Number.isFinite(fallback[key])) {
            pose[key] = fallback[key];
        } else {
            return null;
        }
    }

    return pose;
}

/**
 * Opens a first-person viewer from a deep link descriptor.
 * @param {{ scene: string, x: number|null, y: number|null, z: number|null, yaw: number|null, pitch: number|null }} link
 */
async function openDeepLinkFp(link) {
    try {
        const [{ openFirstPersonViewer }, { getFirstPersonSceneById }] = await Promise.all([
            import('@js/first_person_3d_tool/first_person_viewer.js'),
            import('@js/first_person_3d_tool/scene-config.service.js')
        ]);

        const scene = getFirstPersonSceneById(link.scene);
        if (!scene) {
            showError('Cena 3D não encontrada');
            return;
        }

        const pose = resolveFpPose(link, scene.poseInicial);
        await openFirstPersonViewer(link.scene, pose ? { pose } : {});
    } catch (error) {
        console.error('[deep-link] Failed to open first-person viewer:', error);
        showError('Erro ao abrir cena 3D');
    }
}
