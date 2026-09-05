// Path: js/import_export/screenshot.control.js

/**
 * @fileoverview Screenshot control for capturing map canvas as PNG image.
 * Provides multiple fallback methods for different browser security contexts.
 */

import { showError } from '@utils/toast_service.js';
import { maplibregl } from '@js/map/maplibre.js';

class ScreenshotControl {
    /**
     * Upper bound for any capture step that waits on a MapLibre event.
     * 'load'/'idle' may never fire (style or tile load failure) and the programmatic
     * consumers (PDF/briefing export) await without a timeout of their own.
     */
    static CAPTURE_TIMEOUT_MS = 15000;

    constructor() {
        this.map = null;
        this.container = null;
    }

    /**
     * Sets the map reference for use outside of toolbar context (e.g., sidebar export tab)
     * @param {Object} map - MapLibre GL map instance
     */
    setMap(map) {
        this.map = map;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl screenshot-control controls-column-left';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "screenshot-tool");
        button.title = 'Salvar tela';
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_screenshot_black.svg" alt="SCREENSHOT" />';
        button.onclick = this.takeScreenshot.bind(this);

        this.container.appendChild(button);

        this.changeButtonColor();

        return this.container;
    }

    changeButtonColor() {
        const btn = document.getElementById('screenshot-tool');
        if (btn) btn.innerHTML = `<img class="icon-sig-tool" src="./images/icon_screenshot_black.svg" alt="SCREENSHOT" />`;
    }

    takeScreenshot() {
        try {
            // Get button if container exists (may be null when called externally)
            const button = this.container?.querySelector('button');
            if (button) {
                button.disabled = true;
            }

            if (!this.map) {
                console.error('Map not available for screenshot');
                showError('Mapa não disponível para captura');
                return;
            }

            if (this.map.loaded()) {
                this.captureMapCanvas();
            } else {
                this.map.once('idle', () => {
                    this.captureMapCanvas();
                });
            }

            if (button) {
                setTimeout(() => {
                    button.disabled = false;
                }, 1000);
            }

        } catch (error) {
            console.error('Error capturing screenshot:', error);
            showError('Não foi possível capturar o screenshot');
            const button = this.container?.querySelector('button');
            if (button) {
                button.disabled = false;
            }
        }
    }

    captureMapCanvas() {
        this.map.triggerRepaint();

        requestAnimationFrame(() => {
            try {
                const canvas = this.map.getCanvas();

                try {
                    const dataURL = canvas.toDataURL('image/png');
                    this.downloadImageFromDataURL(dataURL);
                } catch (_securityError) {
                    console.warn('Security error with dataURL, trying blob method...');
                    this.captureWithBlob(canvas);
                }

            } catch (error) {
                console.error('Error processing canvas:', error);
                this.captureWithPreserveDrawingBuffer();
            }
        });
    }

    captureWithBlob(canvas) {
        try {
            const offscreenCanvas = document.createElement('canvas');
            offscreenCanvas.width = canvas.width;
            offscreenCanvas.height = canvas.height;

            const ctx = offscreenCanvas.getContext('2d');

            ctx.drawImage(canvas, 0, 0);

            const imageData = ctx.getImageData(0, 0, 1, 1);
            const pixel = imageData.data;
            const isEmpty = pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0 && pixel[3] === 0;

            if (isEmpty) {
                this.captureWithPreserveDrawingBuffer();
            } else {
                try {
                    offscreenCanvas.toBlob((blob) => {
                        if (blob) {
                            this.downloadImageFromBlob(blob);
                        } else {
                            const dataURL = offscreenCanvas.toDataURL('image/png');
                            this.downloadImageFromDataURL(dataURL);
                        }
                    }, 'image/png');
                } catch (_blobError) {
                    console.warn('Error with blob, using dataURL as fallback');
                    const dataURL = offscreenCanvas.toDataURL('image/png');
                    this.downloadImageFromDataURL(dataURL);
                }
            }

        } catch (error) {
            console.error('Error processing canvas with blob:', error);
            this.captureWithPreserveDrawingBuffer();
        }
    }

    captureWithPreserveDrawingBuffer() {
        console.warn('Trying alternative method for screenshot capture...');

        try {
            const center = this.map.getCenter();
            const zoom = this.map.getZoom();
            const bearing = this.map.getBearing();
            const pitch = this.map.getPitch();

            const tempContainer = document.createElement('div');
            tempContainer.style.position = 'absolute';
            tempContainer.style.left = '-9999px';
            tempContainer.style.width = this.map.getCanvas().width + 'px';
            tempContainer.style.height = this.map.getCanvas().height + 'px';
            document.body.appendChild(tempContainer);

            const tempMap = new maplibregl.Map({
                container: tempContainer,
                style: this.map.getStyle(),
                center, zoom, bearing, pitch,
                preserveDrawingBuffer: true,
                interactive: false,
                validateStyle: false,
                // MapLibre 6.x: mesmo motivo do construtor principal em map_sig.js. Sem isto o
                // padrão novo (4) fatia os tiles e desloca o rótulo de centro de polígono, e a
                // imagem capturada deixaria de bater com a da tela.
                zoomLevelsToOverscale: undefined,
            });

            const cleanupTempMap = () => {
                try { tempMap.remove(); } catch (_e) { /* already removed */ }
                if (tempContainer.parentNode) {
                    document.body.removeChild(tempContainer);
                }
            };

            // Failsafe: if 'load' never fires (style/tile load failure) the tempMap
            // (WebGL context) and the off-screen container would leak. Bail out and
            // clean up after a timeout. `settled` guards against double cleanup.
            let settled = false;
            const failsafe = setTimeout(() => {
                if (settled) return;
                settled = true;
                console.error('Screenshot temporary map timed out before load');
                showError('Não foi possível capturar o screenshot');
                cleanupTempMap();
            }, 15000);

            tempMap.once('load', () => {
                tempMap.once('idle', () => {
                    setTimeout(() => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(failsafe);
                        try {
                            const canvas = tempMap.getCanvas();
                            const dataURL = canvas.toDataURL('image/png');

                            this.downloadImageFromDataURL(dataURL);
                        } catch (error) {
                            console.error('Error in alternative method:', error);
                            showError('Não foi possível capturar o screenshot');
                        } finally {
                            cleanupTempMap();
                        }
                    }, 500);
                });
            });

        } catch (error) {
            console.error('Error creating temporary map:', error);
            showError('Não foi possível capturar o screenshot. Tente novamente.');
        }
    }

    /** @returns {string} Timestamped filename for the screenshot. */
    _getScreenshotFilename() {
        return `ebgeo-map-${new Date().toISOString().slice(0, 10)}.png`;
    }

    /** Triggers a download from a data URL. */
    downloadImageFromDataURL(dataURL) {
        try {
            const link = document.createElement('a');
            link.download = this._getScreenshotFilename();
            link.href = dataURL;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error('Error downloading via dataURL:', error);
        }
    }

    /** Triggers a download from a Blob, falling back to data URL on failure. */
    downloadImageFromBlob(blob) {
        try {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = this._getScreenshotFilename();
            link.href = url;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (_error) {
            console.warn('Error with blob URL, converting to dataURL');
            const reader = new FileReader();
            reader.onload = (event) => {
                this.downloadImageFromDataURL(event.target.result);
            };
            reader.onerror = () => {
                console.error('Error reading blob');
                showError('Não foi possível processar a imagem');
            };
            reader.readAsDataURL(blob);
        }
    }

    /**
     * Captures the map canvas and returns a data URL without downloading.
     * Tries direct canvas capture first, then falls back to a hidden map
     * with preserveDrawingBuffer. Used by PDF export and other programmatic consumers.
     * @param {Object} map - MapLibre GL map instance
     * @returns {Promise<string|null>} Data URL of the captured image, or null on failure
     */
    static async captureMapAsDataUrl(map) {
        if (!map) return null;

        // Wait for idle if not loaded. Bounded: 'idle' may never fire (style/tile
        // failure) and the caller (PDF/briefing export) has no timeout of its own,
        // so an unbounded await would hang the export with no error.
        if (!map.loaded()) {
            await new Promise(resolve => {
                let idleTimer = null;
                const onIdle = () => {
                    if (idleTimer) clearTimeout(idleTimer);
                    resolve();
                };
                idleTimer = setTimeout(() => {
                    map.off('idle', onIdle);
                    resolve();
                }, ScreenshotControl.CAPTURE_TIMEOUT_MS);
                map.once('idle', onIdle);
            });
        }

        // Force repaint
        map.triggerRepaint();
        await new Promise(resolve => requestAnimationFrame(resolve));

        const canvas = map.getCanvas();

        // Try direct capture
        try {
            const dataUrl = canvas.toDataURL('image/png');
            if (dataUrl.length > 200) {
                // Verify canvas is not empty by sampling a pixel
                const testCanvas = document.createElement('canvas');
                testCanvas.width = 1;
                testCanvas.height = 1;
                const ctx = testCanvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(canvas, 0, 0, 1, 1);
                const pixel = ctx.getImageData(0, 0, 1, 1).data;

                if (pixel[0] !== 0 || pixel[1] !== 0 || pixel[2] !== 0 || pixel[3] !== 0) {
                    return dataUrl;
                }
            }
        } catch {
            // Security error or empty canvas — fall through to hidden map
        }

        // Fallback: hidden map with preserveDrawingBuffer
        return await ScreenshotControl._captureWithHiddenMap(map);
    }

    /**
     * Creates a hidden map with preserveDrawingBuffer and captures its canvas.
     * @param {Object} map - MapLibre GL map instance
     * @returns {Promise<string|null>} Data URL or null
     */
    static _captureWithHiddenMap(map) {
        return new Promise(resolve => {
            let tempContainer;
            let tempMap;
            let settled = false;
            let failsafe = null;

            const cleanupTempMap = () => {
                try { tempMap?.remove(); } catch (_e) { /* already removed */ }
                if (tempContainer?.parentNode) {
                    document.body.removeChild(tempContainer);
                }
            };

            // Bail out on any outcome exactly once: the WebGL context and the
            // off-screen container must not leak, and the caller must not await forever.
            const settle = (dataUrl) => {
                if (settled) return;
                settled = true;
                if (failsafe) clearTimeout(failsafe);
                cleanupTempMap();
                resolve(dataUrl);
            };

            try {
                tempContainer = document.createElement('div');
                tempContainer.style.position = 'absolute';
                tempContainer.style.left = '-9999px';
                tempContainer.style.width = map.getCanvas().width + 'px';
                tempContainer.style.height = map.getCanvas().height + 'px';
                document.body.appendChild(tempContainer);

                tempMap = new maplibregl.Map({
                    container: tempContainer,
                    style: map.getStyle(),
                    center: map.getCenter(),
                    zoom: map.getZoom(),
                    bearing: map.getBearing(),
                    pitch: map.getPitch(),
                    preserveDrawingBuffer: true,
                    interactive: false,
                    validateStyle: false,
                    // MapLibre 6.x: mesmo motivo do construtor principal em map_sig.js. Sem isto o
                    // padrão novo (4) fatia os tiles e desloca o rótulo de centro de polígono, e a
                    // imagem capturada deixaria de bater com a da tela.
                    zoomLevelsToOverscale: undefined,
                });

                failsafe = setTimeout(() => {
                    if (settled) return;
                    console.error('Screenshot temporary map timed out before load');
                    settle(null);
                }, ScreenshotControl.CAPTURE_TIMEOUT_MS);

                // A style failure emits 'error' and never 'load', so it needs its own exit.
                tempMap.once('error', (error) => {
                    console.error('Error in hidden map capture:', error?.error || error);
                    settle(null);
                });

                tempMap.once('load', () => {
                    tempMap.once('idle', () => {
                        setTimeout(() => {
                            if (settled) return;
                            let dataUrl = null;
                            try {
                                const captured = tempMap.getCanvas().toDataURL('image/png');
                                dataUrl = captured.length > 200 ? captured : null;
                            } catch {
                                dataUrl = null;
                            }
                            settle(dataUrl);
                        }, 500);
                    });
                });
            } catch {
                settle(null);
            }
        });
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }
}

export default ScreenshotControl;
