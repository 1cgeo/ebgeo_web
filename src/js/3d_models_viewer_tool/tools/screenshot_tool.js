// Path: js/3d_models_viewer_tool/tools/screenshot_tool.js

import { showToast } from '@utils/index.js';

let viewerInstance = null;

/**
 * Main function to capture screenshot from Cesium viewer
 * @param {Cesium.Viewer} viewer - Cesium viewer instance
 * @returns {Promise<boolean>} - True if captured successfully, false otherwise
 */
async function takeScreenshot(viewer) {
    viewerInstance = viewer;

    try {

        // Check if preserveDrawingBuffer is active
        if (!checkPreserveDrawingBuffer()) {
            console.warn('preserveDrawingBuffer is not active, trying workaround...');
        }

        // Wait for everything to be loaded and rendered
        await ensureFullyRendered();

        // Capture screenshot with robust method
        const success = await captureScreenshotRobust();

        return success;

    } catch (error) {
        console.error('Error capturing 3D screenshot:', error);
        showToast('Erro ao capturar screenshot 3D', 'error');
        return false;
    }
}

/**
 * Captures a screenshot from the Cesium viewer and returns it as a data URL.
 * Unlike takeScreenshot(), this does not download the image — it returns
 * the data URL for programmatic use (e.g. PDF export).
 * @param {Cesium.Viewer} viewer - Cesium viewer instance
 * @returns {Promise<string|null>} Data URL of the captured image, or null on failure
 */
async function captureScreenshotAsDataUrl(viewer) {
    viewerInstance = viewer;

    try {
        if (!checkPreserveDrawingBuffer()) {
            console.warn('preserveDrawingBuffer is not active, trying workaround...');
        }

        await ensureFullyRendered();

        const canvas = viewerInstance.scene.canvas;

        if (await isCanvasEmpty(canvas)) {
            console.warn('Empty canvas detected, trying workaround for data URL capture...');
            return await captureDataUrlWithWorkaround();
        }

        const dataUrl = canvas.toDataURL('image/png');
        return dataUrl.length > 100 ? dataUrl : null;

    } catch (error) {
        console.error('Error capturing 3D screenshot as data URL:', error);
        return null;
    }
}

/**
 * Workaround for data URL capture when canvas is initially empty.
 * @returns {Promise<string|null>} Data URL or null
 */
async function captureDataUrlWithWorkaround() {
    const scene = viewerInstance.scene;
    const originalRequestRenderMode = scene.requestRenderMode;

    try {
        scene.requestRenderMode = false;
        await new Promise(resolve => setTimeout(resolve, 1000));

        for (let i = 0; i < 10; i++) {
            viewerInstance.render();
            await new Promise(resolve => requestAnimationFrame(resolve));
        }

        const dataUrl = viewerInstance.scene.canvas.toDataURL('image/png');
        return dataUrl.length > 100 ? dataUrl : null;
    } finally {
        scene.requestRenderMode = originalRequestRenderMode;
    }
}

/**
 * Checks if preserveDrawingBuffer is active in WebGL context.
 * Cesium 1.107+ may use WebGL2 so we access the GL context via Cesium's internal context.
 */
function checkPreserveDrawingBuffer() {
    try {
        // Access the GL context from Cesium's internal context (works with both WebGL1 and WebGL2)
        const gl = viewerInstance.scene.context._gl
            || viewerInstance.scene.canvas.getContext('webgl2')
            || viewerInstance.scene.canvas.getContext('webgl');

        if (gl) {
            const contextAttributes = gl.getContextAttributes();
            return contextAttributes && contextAttributes.preserveDrawingBuffer;
        }

        return false;
    } catch (error) {
        console.warn('Error checking preserveDrawingBuffer:', error);
        return false;
    }
}

/**
 * Waits for scene to be fully loaded and rendered
 */
async function ensureFullyRendered() {

    // 1. Wait for imagery layers to be ready
    await waitForImageryLayers();

    // 2. Wait for terrain to be loaded
    await waitForTerrain();

    // 3. Wait for tilesets to be loaded
    await waitForTilesets();

    // 4. Force multiple renders to ensure everything is drawn
    await renderMultipleFrames();

}

/**
 * Waits for all imagery layers to be ready.
 * In Cesium 1.107+ imagery providers are ready when created.
 */
function waitForImageryLayers() {
    return new Promise((resolve) => {
        // Imagery providers created in Cesium 1.107+ are ready on creation.
        // Small delay to allow tile loading for the current view.
        setTimeout(resolve, 200);
    });
}

/**
 * Waits for terrain to be loaded in current view.
 * In Cesium 1.107+ terrain providers created via fromUrl() are ready immediately.
 */
function waitForTerrain() {
    return new Promise((resolve) => {
        // Terrain providers created via fromUrl() are ready on creation.
        // Small delay to ensure terrain tiles for the current view are loaded.
        setTimeout(resolve, 200);
    });
}

/**
 * Waits for 3D tilesets to be loaded.
 * In Cesium 1.107+ tilesets created via fromUrl() are ready immediately.
 */
function waitForTilesets() {
    return new Promise((resolve) => {
        // Tilesets created via fromUrl() are ready on creation.
        // Small delay to ensure tiles for the current view are loaded.
        setTimeout(resolve, 300);
    });
}

/**
 * Renders multiple frames to ensure everything is drawn
 */
function renderMultipleFrames() {
    return new Promise((resolve) => {
        let frameCount = 0;
        const maxFrames = 5;

        function renderFrame() {
            frameCount++;

            // Force render
            viewerInstance.render();

            if (frameCount >= maxFrames) {
                // Wait one more frame to ensure
                requestAnimationFrame(() => {
                    viewerInstance.render();
                    resolve();
                });
            } else {
                requestAnimationFrame(renderFrame);
            }
        }

        renderFrame();
    });
}

/**
 * Captures screenshot with robust strategy
 */
async function captureScreenshotRobust() {
    const canvas = viewerInstance.scene.canvas;

    // Method 1: Check if canvas has valid content
    if (await isCanvasEmpty(canvas)) {
        console.warn('Empty canvas detected, trying alternative method...');
        return await captureWithWorkaround();
    }

    // Method 2: Direct canvas capture (best quality)
    try {
        const dataURL = canvas.toDataURL('image/png');

        // Check if dataURL is valid (not just header)
        if (dataURL.length > 100) { // A valid PNG has more than 100 characters
            await downloadImageFromDataURL(dataURL);
            return true;
        } else {
            throw new Error('DataURL too small, probably empty');
        }

    } catch (error) {
        console.warn('Error in direct capture, trying alternative method:', error);
        return await captureWithWorkaround();
    }
}

/**
 * Checks if canvas is empty (black or transparent)
 */
async function isCanvasEmpty(canvas) {
    try {
        // Create temporary canvas for testing
        const testCanvas = document.createElement('canvas');
        testCanvas.width = Math.min(canvas.width, 100); // Small sample for performance
        testCanvas.height = Math.min(canvas.height, 100);

        const ctx = testCanvas.getContext('2d');

        // Copy a small area from original canvas
        ctx.drawImage(canvas, 0, 0, testCanvas.width, testCanvas.height);

        // Get pixel data
        const imageData = ctx.getImageData(0, 0, testCanvas.width, testCanvas.height);
        const data = imageData.data;

        // Check for non-black pixels
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            // If any pixel is not black/transparent
            if ((r > 0 || g > 0 || b > 0) && a > 0) {
                return false; // Canvas is not empty
            }
        }

        return true; // Canvas is empty

    } catch (error) {
        console.warn('Error checking if canvas is empty:', error);
        return false; // On error, assume not empty
    }
}

/**
 * Alternative capture method when canvas is empty
 */
async function captureWithWorkaround() {

    try {
        // Save current settings
        const scene = viewerInstance.scene;
        const originalRequestRenderMode = scene.requestRenderMode;

        // Temporarily disable optimized render mode
        scene.requestRenderMode = false;

        // Wait longer for reload
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Force multiple renders
        for (let i = 0; i < 10; i++) {
            viewerInstance.render();
            await new Promise(resolve => requestAnimationFrame(resolve));
        }

        // Try to capture again
        const canvas = viewerInstance.scene.canvas;
        const dataURL = canvas.toDataURL('image/png');

        // Restore original settings
        scene.requestRenderMode = originalRequestRenderMode;

        if (dataURL.length > 100) {
            await downloadImageFromDataURL(dataURL);
            return true;
        } else {
            throw new Error('Still producing empty canvas after workaround');
        }

    } catch (error) {
        console.error('Workaround failed:', error);
        return await captureLastResort();
    }
}

/**
 * Last resort capture method
 */
async function captureLastResort() {
    console.warn('Using last resort for screenshot...');

    try {
        // Wait longer
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Force render with less optimized settings
        const scene = viewerInstance.scene;
        const originalFXAA = scene.fxaa;
        const originalRequestRenderMode = scene.requestRenderMode;

        scene.fxaa = true;
        scene.requestRenderMode = false;

        // Multiple renders
        for (let i = 0; i < 15; i++) {
            viewerInstance.render();
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        const canvas = viewerInstance.scene.canvas;
        const dataURL = canvas.toDataURL('image/png');

        // Restore settings
        scene.fxaa = originalFXAA;
        scene.requestRenderMode = originalRequestRenderMode;

        if (dataURL === 'data:,' || dataURL.length < 100) {
            console.error('Canvas remains empty even after last resort');
            showToast('Screenshot não pôde ser capturado. Tente aguardar o carregamento completo da cena.', 'error');
            return false;
        }

        await downloadImageFromDataURL(dataURL);
        return true;

    } catch (error) {
        console.error('Last resort failed completely:', error);
        return false;
    }
}

/**
 * Downloads image using dataURL
 */
async function downloadImageFromDataURL(dataURL) {
    try {
        const link = document.createElement('a');
        link.download = `ebgeo-3d-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
        link.href = dataURL;

        // Simulate click to start download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (error) {
        console.error('Error downloading via dataURL:', error);
        throw error;
    }
}

export { takeScreenshot, captureScreenshotAsDataUrl };
