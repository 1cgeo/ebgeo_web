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
 *
 * The first-person pose is in the scene's own metric space (the octree frame),
 * not in geographic coordinates: it comes straight out of the walk controller.
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
 * Builds a shareable URL for a 360 photo view.
 * @param {string} photoName - Photo UUID
 * @param {number} lon - Horizontal rotation (degrees)
 * @param {number} lat - Vertical rotation (degrees)
 * @param {number} fov - Field of view (degrees)
 * @returns {string} Full URL with hash
 */
export function buildShareUrl360(photoName, lon, lat, fov) {
    const base = window.location.origin + window.location.pathname;
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
    const base = window.location.origin + window.location.pathname;
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
    const base = window.location.origin + window.location.pathname;
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
 */
export async function handleDeepLink() {
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
