// Path: js/frame/frame.control.js
import { FRAME_LAYERS, initFrameLayers } from './frame-layers.config.js';
import { getCurrentMapNameSync, getFrameStyle, setFrameStyle } from '../store';

class FrameControl {
    constructor(map, buttonContainer) {
        this._map = map;
        this.frameVisible = false;
        this.currentScale = 'scale_25k';
        this._buttonContainer = buttonContainer;
        this._frameButton = null;
        this.FRAME_LAYERS = FRAME_LAYERS;
        this._fillMode = 'normal'; // "normal" ou "sem_fill"
        this._fillVisible = true;
        this._transitioning = false;
        this._createContextMenu();

    }


    async _showFrameMenu(e) {
        e.preventDefault();
        e.stopPropagation();

        const isVisible = this._contextMenu.style.display === 'block';

        if (isVisible) {
            this._contextMenu.style.display = 'none';
            return;
        }

         try {
            const mapName = getCurrentMapNameSync();
            const savedFrame = await getFrameStyle(mapName);
            if (savedFrame) {
                this.currentScale = savedFrame.scale || 'scale_25k';
                this.frameVisible = !!savedFrame.visible;
                this._fillVisible = savedFrame.fillVisible || false;
                if (this.frameVisible) {
                    this._fillMode = this._fillVisible ? 'normal' : 'sem_fill';
                    this._getFrame(this.currentScale);
                }
            } else{
                this.currentScale = 'scale_25k';
                this.frameVisible = false;
                this._fillVisible = true;
            }
        } catch (err) {
            console.warn('Error checking frame state:', err);
        }
        const items = this._contextMenu.querySelectorAll('.coordinates-format-option');
        items.forEach(item => {
            const scale = item.dataset.format;

            if (scale === 'off' && !this.frameVisible) {
                item.classList.add('active');
                item.style.backgroundColor = '#e6f7ff';
                item.style.fontWeight = 'bold';
            } else if (scale === this.currentScale && this.frameVisible) {
                item.classList.add('active');
                item.style.backgroundColor = '#e6f7ff';
                item.style.fontWeight = 'bold';
            } else if (scale === 'toggle_fill' && (!this._fillVisible || !this.frameVisible)) {
                item.classList.add('disabled');
            } else {
                item.classList.remove('active');
                item.style.backgroundColor = '';
                item.style.fontWeight = '';
            }
        });

        // Mostra o menu
        this._contextMenu.style.display = 'block';
    }

    _createContextMenu() {
        // Cria o container do menu
        this._contextMenu = document.createElement('div');
        this._contextMenu.className = 'grid-format-selector';

        // Opção 25k
        const scale25kOption = this._createMenuItem('1:25.000', 'scale_25k');
        this._contextMenu.appendChild(scale25kOption);

        // Opção 50k
        const scale50kOption = this._createMenuItem('1:50.000', 'scale_50k');
        this._contextMenu.appendChild(scale50kOption);

        // Opção 100k
        const scale100kOption = this._createMenuItem('1:100.000', 'scale_100k');
        this._contextMenu.appendChild(scale100kOption);

        // Opção 250k
        const scale250kOption = this._createMenuItem('1:250.000', 'scale_250k');
        this._contextMenu.appendChild(scale250kOption);

        // Opção Desligar
        const offOption = this._createMenuItem('Desligar', 'off');
        this._contextMenu.appendChild(offOption);

        const separator = document.createElement('div');
        separator.style.borderTop = '1px solid rgba(0,0,0,0.1)';
        separator.style.margin = '4px 0';
        this._contextMenu.appendChild(separator);
        const toggleFillOption = this._createMenuItem('Ocultar produtos disp.', 'toggle_fill');
        toggleFillOption.classList.add('toggle-fill-option');
        this._contextMenu.appendChild(toggleFillOption);

        if (this._buttonContainer) {
            this._buttonContainer.appendChild(this._contextMenu);
        } else {
            document.body.appendChild(this._contextMenu);
        }

        // Fecha o menu ao clicar fora
        document.addEventListener('click', (e) => {
            if (!this._contextMenu.contains(e.target)) {
                this._contextMenu.style.display = 'none';
            }
        });
    }

    _createMenuItem(label, scale) {
        const item = document.createElement('div');
        item.className = 'coordinates-format-option';
        item.textContent = label;
        item.dataset.format = scale;

        // Marca o item ativo
        if (scale === this.currentScale) {
            item.classList.add('active');
            item.style.backgroundColor = '#e6f7ff';
            item.style.fontWeight = 'bold';
        }

        item.addEventListener('click', async(e) => {
            e.stopPropagation();

            if (this._transitioning) return;

            if (scale === 'off') {
                this.frameVisible = false;
                this._getFrame(this.currentScale);
                this._updateButtonState();
            } else if (scale === 'toggle_fill') {
                if (!this.frameVisible) {
                    item.classList.add('disabled');
                    return;
                }
                this._toggleFillVisibility(item, this.currentScale, !this._fillVisible);
            } else {
                this.currentScale = scale;
                this.frameVisible = true;
                this._getFrame(scale);
                this._updateButtonState();
            }
            this._contextMenu.style.display = 'none';

            const mapName = getCurrentMapNameSync();
            await setFrameStyle(mapName, {
                scale: this.currentScale,
                visible: this.frameVisible,
                fillVisible: this._fillVisible
            });
        });

        return item;
    }

    _updateButtonState(frameVisible=this.frameVisible) {
        if (this._transitioning) {
            this._frameButton.style.opacity = 0.4;
            this._frameButton.style.backgroundColor = '';
            this._frameButton.title = 'Carregando molduras...';
            return;
        }

        if (frameVisible) {
            this._frameButton.style.opacity = 1;
        } else {
            this._frameButton.style.backgroundColor = '';
            this._frameButton.style.opacity = 0.5;
            this._frameButton.title = "Exibir produtos";
        }

        if (!this._contextMenu) return;

        const toggleItem = this._contextMenu.querySelector('[data-format="toggle_fill"]');
        if (!toggleItem) return;

        if (!frameVisible) {
            toggleItem.classList.add('disabled');
            toggleItem.style.opacity = 0.4;
            toggleItem.style.pointerEvents = 'none';
        } else {
            toggleItem.classList.remove('disabled');
            toggleItem.style.opacity = 1;
            toggleItem.style.pointerEvents = 'auto';
        }
    }

    setButton(frameButton) {
        this._frameButton = frameButton;
        this._updateButtonState();
    }


    _initFrameLayers() {
        initFrameLayers(this._map);
    }

    _getFrame(scale, frameVisible=this.frameVisible, fillVisible=this._fillVisible) {
        this._transitioning = true;

        Object.keys(this.FRAME_LAYERS).forEach(key => {
            this.FRAME_LAYERS[key].forEach(layerId => {
                if (this._map.getLayer(layerId)) {
                    this._map.setLayoutProperty(layerId, 'visibility', 'none');
                }
            });
        });

        if (frameVisible && this.FRAME_LAYERS[scale]) {
            this.FRAME_LAYERS[scale].forEach(layerId => {
                if (this._map.getLayer(layerId)) {
                    this._map.setLayoutProperty(layerId, 'visibility', 'visible');
                }
            });

            const fillLayer = `moldura_fill_${scale.split('_')[1]}`;
            const borderLayer = `moldura_border_${scale.split('_')[1]}`;
            if (!fillVisible) {
                this._map.setLayoutProperty(fillLayer, 'visibility', 'none');
                this._map.setPaintProperty(borderLayer, 'line-color', '#aaaaaaff');
                this._map.setPaintProperty(borderLayer, 'line-width', 1);
                this._map.setPaintProperty(borderLayer, 'line-offset', 0);

                const toggleItem = this._contextMenu?.querySelector('[data-format="toggle_fill"]');
                if (toggleItem) toggleItem.textContent = 'Mostrar produtos disp.';
            } else {
                this._map.setLayoutProperty(fillLayer, 'visibility', 'visible');

                const toggleItem = this._contextMenu?.querySelector('[data-format="toggle_fill"]');
                if (toggleItem) toggleItem.textContent = 'Ocultar produtos disp.';
            }
        }
        this._transitioning = false;
        this._updateButtonState();
    }

    _toggleFillVisibility(item, scale, fillVisible, frameVisible=this.frameVisible) {
        if (!this._map || !frameVisible) return;

        this._fillVisible = fillVisible;
        this._fillMode = this._fillMode === 'normal' ? 'sem_fill' : 'normal';
        const fillLayer = `moldura_fill_${scale.split('_')[1]}`;
        const borderLayer = `moldura_border_${scale.split('_')[1]}`;

        if (!this._map.getLayer(fillLayer) || !this._map.getLayer(borderLayer)) {
            console.warn('Frame layers not found');
            return;
        }

        if (!fillVisible) {
            this._originalFillColor = this._map.getPaintProperty(fillLayer, 'fill-color');
            this._originalLineColor = this._map.getPaintProperty(borderLayer, 'line-color');
            this._originalLineWidth = this._map.getPaintProperty(borderLayer, 'line-width');
            this._originalLineOffset = this._map.getPaintProperty(borderLayer, 'line-offset');

            this._map.setLayoutProperty(fillLayer, 'visibility', 'none');
            this._map.setPaintProperty(borderLayer, 'line-color', '#aaaaaaff');
            this._map.setPaintProperty(borderLayer, 'line-width', 1);
            this._map.setPaintProperty(borderLayer, 'line-offset', 0);
            if (item){
                item.textContent = 'Mostrar produtos disp.';
            }
        } else {
            if (this._originalFillColor) {this._map.setPaintProperty(fillLayer, 'fill-color', this._originalFillColor);}
            if (this._originalLineColor) {this._map.setPaintProperty(borderLayer, 'line-color', this._originalLineColor);}
            if (this._originalLineWidth) {this._map.setPaintProperty(borderLayer, 'line-width', this._originalLineWidth);}
            if (this._originalLineOffset) {this._map.setPaintProperty(borderLayer, 'line-offset', this._originalLineOffset);}

            this._map.setLayoutProperty(fillLayer, 'visibility', 'visible');

            if (item){
                item.textContent = 'Ocultar produtos disp.';
            }
        }

        this._updateButtonState();
    }


}

export default FrameControl;
