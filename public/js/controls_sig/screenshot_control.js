// Path: js/controls_sig/screenshot_control.js
class ScreenshotControl {
    constructor() {
        this.map = null;
        this.container = null;
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

    changeButtonColor = () => {
        $("#screenshot-tool").html(`<img class="icon-sig-tool" src="./images/icon_screenshot_black.svg" alt="SCREENSHOT" />`);
    }

    takeScreenshot() {
        try {
            const button = this.container.querySelector('button');
            button.disabled = true;

            if (this.map.loaded()) {
                this.captureMapCanvas();
            } else {
                this.map.once('idle', () => {
                    this.captureMapCanvas();
                });
            }

            setTimeout(() => {
                button.disabled = false;
            }, 1000);

        } catch (error) {
            console.error('Error capturing screenshot:', error);
            alert('Não foi possível capturar o screenshot');
            const button = this.container.querySelector('button');
            button.disabled = false;
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
                } catch (securityError) {
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
                } catch (blobError) {
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
                center: center,
                zoom: zoom,
                bearing: bearing,
                pitch: pitch,
                preserveDrawingBuffer: true,
                interactive: false,
                validateStyle: false
            });

            tempMap.once('load', () => {
                tempMap.once('idle', () => {
                    setTimeout(() => {
                        try {
                            const canvas = tempMap.getCanvas();
                            const dataURL = canvas.toDataURL('image/png');

                            this.downloadImageFromDataURL(dataURL);

                            tempMap.remove();
                            document.body.removeChild(tempContainer);
                        } catch (error) {
                            console.error('Error in alternative method:', error);
                            alert('Não foi possível capturar o screenshot');
                            tempMap.remove();
                            document.body.removeChild(tempContainer);
                        }
                    }, 500);
                });
            });

        } catch (error) {
            console.error('Error creating temporary map:', error);
            alert('Não foi possível capturar o screenshot. Tente novamente.');
        }
    }

    downloadImageFromDataURL(dataURL) {
        try {
            const link = document.createElement('a');
            link.download = `ebgeo-map-${new Date().toISOString().slice(0, 10)}.png`;
            link.href = dataURL;

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (error) {
            console.error('Error downloading via dataURL:', error);
        }
    }

    downloadImageFromBlob(blob) {
        try {
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.download = `ebgeo-map-${new Date().toISOString().slice(0, 10)}.png`;
            link.href = url;

            link.addEventListener('click', () => {
                setTimeout(() => {
                    URL.revokeObjectURL(url);
                }, 100);
            });

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (error) {
            console.warn('Error with blob URL, converting to dataURL');
            const reader = new FileReader();
            reader.onload = (event) => {
                this.downloadImageFromDataURL(event.target.result);
            };
            reader.onerror = () => {
                console.error('Error reading blob');
                alert('Não foi possível processar a imagem');
            };
            reader.readAsDataURL(blob);
        }
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }
}

export default ScreenshotControl;
