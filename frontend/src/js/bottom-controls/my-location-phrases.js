// Path: js/bottom-controls/my-location-phrases.js

/**
 * @fileoverview "Ir para minha localização": when the browser cannot give a position, and what
 * each failure tells the person. Zero imports, so node tests read it and the notice-style census
 * (`tests/unit/avisos-de-tela-estilo.test.js`) scans it as a phrase module.
 *
 * The command is ALWAYS drawn, and the click refuses naming the state (the house rule for a
 * reversible state): a page served without HTTPS, or a browser without the location API, is
 * something the person or the administrator can change.
 *
 * @module bottom-controls/my-location-phrases
 */

/** What the browser is asked for: a fresh-enough fix, precise when the device can. */
export const MY_LOCATION_OPTIONS = Object.freeze({
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 60000,
});

/** Zoom the camera goes to at least, so the person lands close enough to recognise the place. */
export const MY_LOCATION_MIN_ZOOM = 15;

/**
 * Why a position cannot even be asked for, or null when it can.
 * @param {{isSecureContext?: boolean, geolocation?: Object}} env - `window.isSecureContext` and
 *   `navigator.geolocation`
 * @returns {string|null}
 */
export function myLocationUnavailableNotice(env) {
    if (!env?.isSecureContext) {
        return 'O navegador só informa a localização em conexão segura. Abra o EBGeo pelo endereço com https e tente de novo.';
    }
    if (!env.geolocation || typeof env.geolocation.getCurrentPosition !== 'function') {
        return 'Este navegador não informa a localização. Use outro navegador para ir até a sua posição.';
    }
    return null;
}

/**
 * What a failed request tells the person, by the GeolocationPositionError code.
 * @param {{code?: number}|null|undefined} error
 * @returns {string}
 */
export function myLocationErrorNotice(error) {
    switch (error?.code) {
        case 1: // PERMISSION_DENIED
            return 'A localização está bloqueada para este site. Libere a localização nas configurações do navegador e tente de novo.';
        case 3: // TIMEOUT
            return 'A localização demorou demais para responder. Tente de novo em instantes.';
        case 2: // POSITION_UNAVAILABLE
        default:
            return 'Não foi possível obter a sua localização. Verifique se a localização do computador está ligada e tente de novo.';
    }
}
