// Path: js/ui/loading-screen-3d.js

/**
 * @module ui/loading-screen-3d
 * @description Loading screen management for the 3D viewer.
 * Shows a loading overlay over the 3D container while Cesium initializes.
 * Only relevant for the first open (when Cesium has not yet been loaded).
 */

const LOADING_3D_ID = 'loading-screen-3d';

/**
 * Creates and injects the 3D loading screen DOM element if it doesn't exist.
 * @private
 */
function ensureLoadingElement() {
    if (document.getElementById(LOADING_3D_ID)) return;

    const el = document.createElement('div');
    el.id = LOADING_3D_ID;
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Carregando visualizador 3D');
    el.innerHTML = `
        <div class="loading-3d-content">
            <img src="./images/logo_ebgeo.webp" alt="EBGeo" class="loading-3d-logo">
            <div class="loading-3d-bar">
                <div class="loading-3d-bar-fill"></div>
            </div>
        </div>
    `;

    // Insert into map-3d-container or body as fallback
    const container = document.getElementById('map-3d-container') || document.body;
    container.appendChild(el);
}

/**
 * Shows the 3D loading screen overlay.
 * Call this before initiating the 3D viewer load.
 */
export function showLoading3DScreen() {
    ensureLoadingElement();
    const el = document.getElementById(LOADING_3D_ID);
    if (!el) return;

    // Reset animation
    el.classList.remove('loading-3d-hidden');
    el.style.display = 'flex';

    // Force reflow to restart animation
    el.offsetHeight;
    el.classList.add('loading-3d-visible');
}

/**
 * Hides the 3D loading screen with a fade-out animation.
 * Call this when the 3D viewer is ready to be shown.
 */
export function hideLoading3DScreen() {
    const el = document.getElementById(LOADING_3D_ID);
    if (!el) return;

    el.classList.remove('loading-3d-visible');
    el.classList.add('loading-3d-hidden');

    setTimeout(() => {
        if (el.classList.contains('loading-3d-hidden')) {
            el.style.display = 'none';
            el.classList.remove('loading-3d-hidden');
        }
    }, 500);
}
