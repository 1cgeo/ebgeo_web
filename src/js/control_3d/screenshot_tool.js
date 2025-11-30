// Path: js/control_3d/screenshot_tool.js
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
        alert('Could not capture 3D screenshot');
        return false;
    }
}

/**
 * Checks if preserveDrawingBuffer is active in WebGL context
 */
function checkPreserveDrawingBuffer() {
    try {
        const canvas = viewerInstance.scene.canvas;
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

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
 * Waits for all imagery layers to be ready
 */
function waitForImageryLayers() {
    return new Promise((resolve) => {
        const imageryLayers = viewerInstance.imageryLayers;
        if (imageryLayers._layers.length <=1) {
            resolve();
            return;
        }

        let readyCount = 0;
        const totalLayers = imageryLayers.length;

        const checkReady = () => {
            readyCount = 0;
            for (let i = 0; i < imageryLayers.length; i++) {
                const layer = imageryLayers.get(i);
                if (layer.ready) {
                    readyCount++;
                }
            }

            if (readyCount === totalLayers) {
                resolve();
            } else {
                setTimeout(checkReady, 100);
            }
        };

        checkReady();
    });
}

/**
 * Waits for terrain to be loaded in current view
 */
function waitForTerrain() {
    return new Promise((resolve) => {
        const scene = viewerInstance.scene;
        const globe = scene.globe;
        // If using EllipsoidTerrainProvider, no need to wait
        if (!globe.terrainProvider._availability) {
            resolve();
            return;
        }

        // For CesiumTerrainProvider, wait until ready
        const checkTerrain = () => {
            if (globe.terrainProvider.ready) {
                // Wait a bit more to ensure tiles are loaded
                setTimeout(resolve, 200);
            } else {
                setTimeout(checkTerrain, 100);
            }
        };

        checkTerrain();
    });
}

/**
 * Waits for 3D tilesets to be loaded
 */
function waitForTilesets() {
    return new Promise((resolve) => {
        const primitives = viewerInstance.scene.primitives;
        const tilesets = [];

        // Find all tilesets
        for (let i = 0; i < primitives.length; i++) {
            const primitive = primitives.get(i);
            if (primitive instanceof Cesium.Cesium3DTileset) {
                tilesets.push(primitive);
            }
        }

        if (tilesets.length === 0) {
            resolve();
            return;
        }

        // Wait for all to be ready
        const checkTilesets = () => {
            const allReady = tilesets.every(tileset => tileset.ready);

            if (allReady) {
                // Wait a bit more for tile loading in current view
                setTimeout(resolve, 300);
            } else {
                setTimeout(checkTilesets, 100);
            }
        };

        checkTilesets();
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
        testCanvas.width = Math.min(canvas.width, 100); // Amostra pequena para performance
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
            alert('Screenshot não pôde ser capturado. Tente aguardar o carregamento completo da cena.');
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

export { takeScreenshot };
