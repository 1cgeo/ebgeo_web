// Path: js/briefing/export/slide-capture.service.js

/**
 * @fileoverview Slide capture service for briefing PDF export.
 * Reuses existing screenshot tools for each viewer type:
 * - 2D: ScreenshotControl.captureMapAsDataUrl (screenshot.control.js)
 * - 3D: captureScreenshotAsDataUrl (screenshot_tool.js)
 * - 360: captureScreenshot360AsDataUrl (screenshot_tool_360.js)
 *
 * @module briefing/export/slide-capture.service
 */

import { SlideMode } from '@store/index.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Captures a screenshot of the current slide view based on its mode.
 * The transition service must have already navigated to the slide.
 *
 * @param {Object} slide - Slide data (mode, position, etc.)
 * @param {Object} map - MapLibre map instance (for 2D capture)
 * @returns {Promise<string|null>} Data URL of captured image, or null on failure
 */
export async function captureSlide(slide, map) {
    const mode = slide.mode || SlideMode.MAP_2D;

    switch (mode) {
        case SlideMode.MAP_2D:
            return await capture2DSlide(map);
        case SlideMode.VIEWER_3D:
            return await capture3DSlide();
        case SlideMode.VIEWER_360:
            return await capture360Slide();
        default:
            console.warn(`Unknown slide mode: ${mode}`);
            return await capture2DSlide(map);
    }
}

// ============================================================================
// 2D MAP CAPTURE
// ============================================================================

/**
 * Captures the 2D MapLibre map using the existing ScreenshotControl utility.
 * @param {Object} map - MapLibre map instance
 * @returns {Promise<string|null>} Data URL or null
 */
async function capture2DSlide(map) {
    try {
        const { default: ScreenshotControl } = await import(
            '@js/import_export/screenshot.control.js'
        );
        return await ScreenshotControl.captureMapAsDataUrl(map);
    } catch (error) {
        console.error('Error capturing 2D slide:', error);
        return null;
    }
}

// ============================================================================
// 3D (CESIUM) CAPTURE
// ============================================================================

/**
 * Captures the 3D Cesium viewer using the existing screenshot tool.
 * @returns {Promise<string|null>} Data URL or null
 */
async function capture3DSlide() {
    try {
        const { getCesiumViewer } = await import(
            '@js/3d_models_viewer_tool/map_3d.js'
        );
        const viewer = getCesiumViewer();

        if (!viewer) {
            console.warn('Cesium viewer not available for capture');
            return null;
        }

        const { captureScreenshotAsDataUrl } = await import(
            '@js/3d_models_viewer_tool/tools/screenshot_tool.js'
        );
        return await captureScreenshotAsDataUrl(viewer);
    } catch (error) {
        console.error('Error capturing 3D slide:', error);
        return null;
    }
}

// ============================================================================
// 360 (THREE.JS) CAPTURE
// ============================================================================

/**
 * Captures the 360 Three.js viewer using the existing screenshot tool.
 * @returns {Promise<string|null>} Data URL or null
 */
async function capture360Slide() {
    try {
        const { captureScreenshot360AsDataUrl } = await import(
            '@js/street_view_tool/tools/screenshot_tool_360.js'
        );
        return await captureScreenshot360AsDataUrl();
    } catch (error) {
        console.error('Error capturing 360 slide:', error);
        return null;
    }
}
