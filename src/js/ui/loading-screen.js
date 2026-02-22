// Path: js/ui/loading-screen.js

/**
 * @module ui/loading-screen
 * @description Loading screen management.
 * Extracted from index.js to break the circular dependency with map_sig.js.
 */

/**
 * Hides the loading screen with fade-out animation.
 * Shows elements marked with 'loading-hidden' class.
 */
export function hideLoadingScreen() {
    const loadingBg = document.querySelector('.loading-background');
    if (loadingBg) {
        loadingBg.style.transition = 'opacity 0.5s';
        loadingBg.style.opacity = '0';
        setTimeout(() => loadingBg.remove(), 500);
    }

    document.querySelectorAll('.loading-hidden').forEach(function (el) {
        el.classList.add('loaded');
    });
}
