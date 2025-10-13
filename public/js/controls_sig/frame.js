import { FRAME_LAYERS, initFrameLayers } from './frameLayersConfig.js';

class FrameControl {
    constructor(map, buttonContainer) {
        this._map = map;
        this._frameVisible = false;
        this._currentScale = 'scale_25k';
        this._buttonContainer = buttonContainer;
        this._frameButton = null;
        this.FRAME_LAYERS = FRAME_LAYERS;
        this._fillMode = 'normal'; // "normal" ou "sem_fill"
        this._fillVisible = true;
        this._transitioning = false;
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

        // Linha separadora visual
        const separator = document.createElement('div');
        separator.style.borderTop = '1px solid rgba(0,0,0,0.1)';
        separator.style.margin = '4px 0';
        this._contextMenu.appendChild(separator);

        // Opção Alternar preenchimento
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
        if (scale === this._currentScale) {
            item.classList.add('active');
            item.style.backgroundColor = '#e6f7ff';
            item.style.fontWeight = 'bold';
        }

        // Evento de click
        item.addEventListener('click', (e) => {
            e.stopPropagation();

            if (this._transitioning) return;

            if (scale === 'off') {
                this._frameVisible = false;
                this._getFrame(this._currentScale);
                this._updateButtonState();
            }
            else if (scale === 'toggle_fill') {
                if (!this._frameVisible) {
                    item.classList.add('disabled');
                    return;
                }
                this._toggleFillVisibility(item);
            }
            else {
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


        if (this._transitioning) {
            this._frameButton.style.opacity = 0.4;
            this._frameButton.style.backgroundColor = '#ccc';
            this._frameButton.title = 'Carregando molduras...';
            return;
        }

        if (this._frameVisible) {
            // Frame ativo - botão com estilo ativo
            this._frameButton.style.opacity = 1;
        } else {
            // Frame inativo - botão com estilo normal
            this._frameButton.style.backgroundColor = '';
            this._frameButton.style.opacity = 0.5;
            this._frameButton.title = "Exibir produtos";
        }

        if (!this._contextMenu) return;

        const toggleItem = this._contextMenu.querySelector('[data-format="toggle_fill"]');
        if (!toggleItem) return;

        if (!this._frameVisible) {
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

    _getFrame(scale) {
        this._transitioning = true;

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

            const fillLayer = `moldura_fill_${scale.split('_')[1]}`;
            const borderLayer = `moldura_border_${scale.split('_')[1]}`;
            if (this._fillMode === 'sem_fill') {
                // Garante que o novo conjunto também fique sem preenchimento
                this._map.setLayoutProperty(fillLayer, 'visibility', 'none');
                this._map.setPaintProperty(borderLayer, 'line-color', '#aaaaaaff');
                this._map.setPaintProperty(borderLayer, 'line-width', 1);
                this._map.setPaintProperty(borderLayer, 'line-offset', 0);

                // Atualiza o item do menu se estiver aberto
                const toggleItem = this._contextMenu?.querySelector('[data-format="toggle_fill"]');
                if (toggleItem) toggleItem.textContent = 'Mostrar produtos disp.';
            } else {
                // Garante que o novo conjunto tenha preenchimento visível
                this._map.setLayoutProperty(fillLayer, 'visibility', 'visible');

                // Atualiza o item do menu se estiver aberto
                const toggleItem = this._contextMenu?.querySelector('[data-format="toggle_fill"]');
                if (toggleItem) toggleItem.textContent = 'Ocultar produtos disp.';
            }
        }
        // Termina transição depois de um pequeno delay (evita clique duplo)
        setTimeout(() => {
            this._transitioning = false;
            this._updateButtonState();
        }, 300);
    }

    _toggleFillVisibility(item) {
        if (!this._map || !this._frameVisible) return;

        this._fillVisible = !this._fillVisible;
        this._fillMode = this._fillMode === 'normal' ? 'sem_fill' : 'normal';
        const scale = this._currentScale;
        const fillLayer = `moldura_fill_${scale.split('_')[1]}`;
        const borderLayer = `moldura_border_${scale.split('_')[1]}`;

        // Se for desligar o preenchimento
        if (!this._fillVisible) {
            // Guarda estilos originais
            this._originalFillColor = this._map.getPaintProperty(fillLayer, 'fill-color');
            this._originalLineColor = this._map.getPaintProperty(borderLayer, 'line-color');
            this._originalLineWidth = this._map.getPaintProperty(borderLayer, 'line-width');
            this._originalLineOffset = this._map.getPaintProperty(borderLayer, 'line-offset');

            // Remove o preenchimento e deixa a borda preta
            this._map.setLayoutProperty(fillLayer, 'visibility', 'none');
            this._map.setPaintProperty(borderLayer, 'line-color', '#aaaaaaff');
            this._map.setPaintProperty(borderLayer, 'line-width', 1);
            this._map.setPaintProperty(borderLayer, 'line-offset', 0);

            item.textContent = 'Mostrar produtos disp.';
        }
        else {
            // Restaura estilos originais
            if (this._originalFillColor)
                this._map.setPaintProperty(fillLayer, 'fill-color', this._originalFillColor);
            if (this._originalLineColor)
                this._map.setPaintProperty(borderLayer, 'line-color', this._originalLineColor);
            if (this._originalLineWidth)
                this._map.setPaintProperty(borderLayer, 'line-width', this._originalLineWidth);
            if (this._originalLineOffset)
                this._map.setPaintProperty(borderLayer, 'line-offset', this._originalLineOffset);

            // Reexibe o preenchimento
            this._map.setLayoutProperty(fillLayer, 'visibility', 'visible');
            item.textContent = 'Ocultar produtos disp.';
        }

        this._updateButtonState();
    }




}

export default FrameControl;