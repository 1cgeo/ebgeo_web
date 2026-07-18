// Path: js/deep-link/deep-link.js

/**
 * @module deep-link
 * @description URL hash-based deep linking for 360 photos and 3D models.
 * Allows sharing a URL that opens a specific viewer with camera position/orientation.
 *
 * URL formats:
 *   #view=360&photo=<uuid>&lon=<deg>&lat=<deg>&fov=<deg>
 *   #view=3d&tileset=<id>&lon=<deg>&lat=<deg>&h=<meters>&heading=<rad>&pitch=<rad>&roll=<rad>
 */

import { getControl } from '@store';
import { showSuccess, showError } from '@utils';

// ===== URL PARSING =====

/**
 * Parses the URL hash into a typed deep link descriptor.
 * @returns {{ type: '360', photo: string, lon: number, lat: number, fov: number }
 *         | { type: '3d', tileset: string, lon: number, lat: number, height: number, heading: number, pitch: number, roll: number }
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

    return null;
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

            // Small delay for tileset to finish loading before setting camera
            await new Promise(resolve => setTimeout(resolve, 500));

            const viewer = getCesiumViewer();
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
