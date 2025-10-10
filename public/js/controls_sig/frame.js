import { FRAME_LAYERS, initFrameLayers } from './frameLayersConfig.js';

class FrameControl {
    constructor(map, buttonContainer) {
        this._map = map;
        this._frameVisible = false;
        this._currentScale = 'scale_25k';
        this._buttonContainer = buttonContainer;
        this._frameButton = null;
        this.FRAME_LAYERS = FRAME_LAYERS;
        this._createContextMenu();

    }

    _showFrameMenu(e) {
        e.preventDefault();
        e.stopPropagation();

        // Se o menu já está visível, fecha
        const isVisible = this._contextMenu.style.display === 'block';

        if (isVisible) {
            this._contextMenu.style.display = 'none';
            return;
        }

        // Atualiza a marcação visual dos itens do menu antes de abrir
        const items = this._contextMenu.querySelectorAll('.coordinates-format-option');
        items.forEach(item => {
            const scale = item.dataset.format;

            if (scale === 'off' && !this._frameVisible) {
                item.classList.add('active');
                item.style.backgroundColor = '#e6f7ff';
                item.style.fontWeight = 'bold';
            } else if (scale === this._currentScale && this._frameVisible) {
                item.classList.add('active');
                item.style.backgroundColor = '#e6f7ff';
                item.style.fontWeight = 'bold';
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
        if (scale === this._currentScale) {
            item.classList.add('active');
        }

        // Marca o item ativo
        if (scale === this._currentScale) {
            item.style.backgroundColor = '#e6f7ff';
            item.style.fontWeight = 'bold';
        }

        // Evento de click
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            if (scale === 'off') {
                this._frameVisible = false;
                this._getFrame(this._currentScale);
                this._updateButtonState();
            } else {
                this._currentScale = scale;
                this._frameVisible = true;
                this._getFrame(scale);
                this._updateButtonState();
            }
            this._contextMenu.style.display = 'none';
        });

        return item;
    }

    _updateButtonState() {
        if (!this._frameButton) return;

        if (this._frameVisible) {
            // Frame ativo - botão com estilo ativo
            this._frameButton.style.backgroundColor = 'rgba(80, 141, 78, 0.2)';
            this._frameButton.style.opacity = 1;
            this._frameButton.title = `Alterar exibição de produtos`;
        } else {
            // Frame inativo - botão com estilo normal
            this._frameButton.style.backgroundColor = '';
            this._frameButton.style.opacity = 0.5;
            this._frameButton.title = "Exibir produtos";
        }
    }

    setButton(frameButton) {
        this._frameButton = frameButton;
        this._updateButtonState();
    }


    _initFrameLayers() {
        initFrameLayers(this._map);
    }

    _getFrame(scale) {

        Object.keys(this.FRAME_LAYERS).forEach(key => {
            this.FRAME_LAYERS[key].forEach(layerId => {
                if (this._map.getLayer(layerId)) {
                    this._map.setLayoutProperty(layerId, 'visibility', 'none');
                }
            });
        });

        if (this._frameVisible && this.FRAME_LAYERS[scale]) {
            this.FRAME_LAYERS[scale].forEach(layerId => {
                if (this._map.getLayer(layerId)) {
                    this._map.setLayoutProperty(layerId, 'visibility', 'visible');
                }
            });
        }
    }



}

export default FrameControl;