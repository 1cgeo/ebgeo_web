// Path: js/street_view_tool/tools/screenshot_tool_360.js

/**
 * @fileoverview Screenshot tool for Street View 360.
 * Captures the current view without UI elements and downloads as PNG.
 */

import { showSuccess, showError } from '../../utilities/toast_service.js';

/**
 * Hides 360 UI elements and captures the canvas as a data URL.
 * Shared logic used by both takeScreenshot360 (download) and
 * captureScreenshot360AsDataUrl (programmatic use).
 * @returns {Promise<string|null>} Data URL or null on failure
 */
async function captureCleanCanvas() {
    const { getViewer360State, getNavigator } = await import('../street_view_viewer.js');
    const state = getViewer360State();
    const navigator = getNavigator();

    if (!state || !state.renderer) {
        console.warn('360 viewer not ready for screenshot');
        return null;
    }

    // 1. Collect UI elements to hide
    const elementsToHide = [
        document.getElementById('toolbar-360'),
        document.getElementById('active-tool-chip-360'),
        document.getElementById('streetview-minimap-wrapper'),
        document.getElementById('close-street-view-button')
    ];

    // Store original display values
    const originalVisibility = elementsToHide.map(el => el?.style.display);

    // Hide UI elements
    elementsToHide.forEach(el => {
        if (el) el.style.display = 'none';
    });

    // Hide navigation canvas overlay
    if (navigator && typeof navigator.setVisible === 'function') {
        navigator.setVisible(false);
    }

    try {
        // 2. Force a render frame to update the scene without UI
        await new Promise(resolve => requestAnimationFrame(resolve));

        // Render the scene
        state.renderer.render(state.scene, state.camera);

        // 3. Capture the canvas
        const canvas = state.renderer.domElement;
        return canvas.toDataURL('image/png');
    } finally {
        // 4. Restore UI elements
        elementsToHide.forEach((el, i) => {
            if (el) el.style.display = originalVisibility[i] ?? '';
        });

        // Restore navigation canvas
        if (navigator && typeof navigator.setVisible === 'function') {
            navigator.setVisible(true);
        }
    }
}

/**
 * Takes a screenshot of the 360 viewer without UI elements.
 * Hides toolbar, minimap, close button, and navigation overlay before capture.
 * @returns {Promise<boolean>} True if screenshot was successful
 */
export async function takeScreenshot360() {
    try {
        const dataUrl = await captureCleanCanvas();

        if (!dataUrl) {
            showError('Visualizador 360 não está pronto');
            return false;
        }

        // Download the image
        const link = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        link.download = `streetview-360-${timestamp}.png`;
        link.href = dataUrl;
        link.click();

        showSuccess('Captura de tela salva');
        return true;
    } catch (error) {
        console.error('Failed to take screenshot:', error);
        showError('Erro ao capturar tela');
        return false;
    }
}

/**
 * Captures a screenshot of the 360 viewer and returns it as a data URL.
 * Unlike takeScreenshot360(), this does not download the image — it returns
 * the data URL for programmatic use (e.g. PDF export).
 * @returns {Promise<string|null>} Data URL of the captured image, or null on failure
 */
export async function captureScreenshot360AsDataUrl() {
    try {
        return await captureCleanCanvas();
    } catch (error) {
        console.error('Failed to capture 360 screenshot as data URL:', error);
        return null;
    }
}
