// Path: js\controls_sig\save_load_control.js
import { mapStore, imageStore, getAllMapNames, getCurrentMapName, setCurrentMap, addMap } from './store.js';

class SaveLoadControl {
    constructor(mapControl, baseLayerControl) {
        this.mapControl = mapControl;
        this.baseLayerControl = baseLayerControl;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl save-load-control';
        
        this.container.innerHTML = `
            <button id="save-btn" class="save-load-icon" title="Exportar projeto">
                <img src="./images/icon_save_black.svg" alt="SAVE" />
            </button>
            <button id="load-btn" class="save-load-icon" title="Importar projeto (substitui atual)">
                <img src="./images/icon_load_black.svg" alt="LOAD" />
            </button>
            <button id="load-additive-btn" class="save-load-icon" title="Adicionar ao projeto atual">
                <img src="./images/icon_folder_plus_black.svg" alt="LOAD ADDITIVE" />
            </button>
            <input type="file" id="load-file" accept=".ebgeo" style="display: none;" />
            <input type="file" id="load-additive-file" accept=".ebgeo" style="display: none;" />
        `;

        // Export - IndexedDB para ZIP
        this.container.querySelector('#save-btn').addEventListener('click', async () => {
            try {
                const zip = new JSZip();
                
                // Verificar se há mapas selecionados
                const selectedMaps = this.mapControl.getSelectedMapNames();
                const mapsToExport = selectedMaps.length > 0 ? selectedMaps : await getAllMapNames();
                
                if (selectedMaps.length > 0) {
                    console.log(`Exportando ${selectedMaps.length} mapas selecionados`);
                }
                
                const allData = {
                    maps: {},
                    currentMap: getCurrentMapName(),
                };
                
                // Coletar apenas os mapas selecionados/todos
                for (const mapName of mapsToExport) {
                    const mapData = await mapStore.getItem(mapName);
                    if (mapData) {
                        allData.maps[mapName] = mapData;
                    }
                }
                
                zip.file('data.json', JSON.stringify(allData));
                
                // Coletar apenas imagens dos mapas selecionados
                const usedImageIds = new Set();
                for (const mapName of mapsToExport) {
                    const mapData = await mapStore.getItem(mapName);
                    if (mapData && mapData.features && mapData.features.images) {
                        mapData.features.images.forEach(img => {
                            if (img.properties && img.properties.imageId) {
                                usedImageIds.add(img.properties.imageId);
                            }
                        });
                    }
                }
                
                // Todas as imagens do imageStore (apenas as usadas nos mapas selecionados)
                const imgFolder = zip.folder('images');
                for (const imageId of usedImageIds) {
                    const blob = await imageStore.getItem(imageId);
                    if (blob) {
                        imgFolder.file(`${imageId}.png`, blob);
                    }
                }
                
                // Gerar nome do arquivo baseado na seleção
                const fileName = selectedMaps.length > 0 
                    ? `mapas_selecionados_${selectedMaps.length}.ebgeo`
                    : 'projeto_ebgeo.ebgeo';
                
                // Download
                const content = await zip.generateAsync({ type: 'blob' });
                const url = URL.createObjectURL(content);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                // Feedback visual
                this.showSaveSuccess(selectedMaps.length > 0 ? selectedMaps.length : mapsToExport.length);
                
            } catch (error) {
                console.error('Erro ao exportar dados:', error);
                alert('Erro ao exportar arquivo .ebgeo');
            }
        });

        this.container.querySelector('#load-btn').addEventListener('click', () => {
            this.container.querySelector('#load-file').click();
        });

        this.container.querySelector('#load-additive-btn').addEventListener('click', () => {
            this.container.querySelector('#load-additive-file').click();
        });

        // Import normal - substitui tudo
        this.container.querySelector('#load-file').addEventListener('change', async (event) => {
            await this.handleImport(event, false);
        });

        // Import aditivo - adiciona ao atual
        this.container.querySelector('#load-additive-file').addEventListener('change', async (event) => {
            await this.handleImport(event, true);
        });

        $('input[name="base-layer"]').on('change', this.changeButtonColors);
        this.changeButtonColors();

        return this.container;
    }

    async handleImport(event, isAdditiveImport) {
        const file = event.target.files[0];
        if (!file) return;
        
        try {
            const zip = await JSZip.loadAsync(file);
            
            if (!isAdditiveImport) {
                // Import normal - limpar tudo
                await mapStore.clear();
                await imageStore.clear();
            }
            
            // Buscar arquivo data.json
            let dataFile = zip.file('data.json');
            
            if (!dataFile) {
                throw new Error('Arquivo data.json não encontrado no .ebgeo');
            }
            
            const dataJson = await dataFile.async('string');
            const data = JSON.parse(dataJson);
            
            // Processar mapas
            let importedMapsCount = 0;
            if (isAdditiveImport) {
                const existingMapNames = await getAllMapNames();
                
                for (const [originalMapName, mapData] of Object.entries(data.maps)) {
                    let finalMapName = originalMapName;
                    let counter = 1;
                    
                    // Gerar nome único se houver conflito
                    while (existingMapNames.includes(finalMapName)) {
                        finalMapName = `${originalMapName}_importado${counter > 1 ? counter : ''}`;
                        counter++;
                    }
                    
                    await mapStore.setItem(finalMapName, mapData);
                    await addMap(finalMapName, mapData);
                    existingMapNames.push(finalMapName);
                    importedMapsCount++;
                }
            } else {
                // Salvar cada mapa no IndexedDB (comportamento original)
                for (const [mapName, mapData] of Object.entries(data.maps)) {
                    await mapStore.setItem(mapName, mapData);
                    await addMap(mapName, mapData);
                    importedMapsCount++;
                }
                
                // Atualizar mapa atual
                setCurrentMap(data.currentMap);
            }
            
            // Carregar imagens para imageStore
            const imageFiles = Object.keys(zip.files).filter(name => 
                name.startsWith('images/') && name.endsWith('.png')
            );
                            
            for (const fileName of imageFiles) {
                try {
                    const imageId = fileName.replace('images/', '').replace('.png', '');
                    const blob = await zip.file(fileName).async('blob');
                    await imageStore.setItem(imageId, blob);
                } catch (imgError) {
                    console.warn('Erro ao carregar imagem:', fileName, imgError);
                }
            }
            
            // Recarregar MapLibre (trigger styledata)
            let baseLayer = 'Carta';
            if (!isAdditiveImport) {
                const currentMapData = await mapStore.getItem(data.currentMap);
                baseLayer = currentMapData ? currentMapData.baseLayer : 'Carta';
            }
            
            this.baseLayerControl.switchLayer(baseLayer);
            this.mapControl.updateMapList();
            
            // Feedback personalizado baseado no tipo de importação
            const importType = isAdditiveImport ? 'adicionados' : 'carregados';
            this.showLoadSuccess(importedMapsCount, importType);
            
        } catch (error) {
            console.error('Erro ao importar arquivo:', error);
            alert('Erro ao carregar arquivo .ebgeo: ' + error.message);
        }
        
        // Limpar input
        event.target.value = '';
    }

    showSaveSuccess(mapCount) {
        const saveBtn = this.container?.querySelector('#save-btn');
        if (!saveBtn) {
            this.showToast(
                mapCount === 1 ? 
                `1 mapa exportado!` : 
                `${mapCount} mapas exportados!`, 
                'success'
            );
            return;
        }

        const originalContent = saveBtn.innerHTML;
        
        saveBtn.innerHTML = '<img src="./images/icon_check_green.svg" alt="SUCCESS" />';
        saveBtn.style.backgroundColor = '#28a745';
        
        setTimeout(() => {
            saveBtn.innerHTML = originalContent;
            saveBtn.style.backgroundColor = '';
        }, 1500);

        this.showToast(
            mapCount === 1 ? 
            `1 mapa exportado!` : 
            `${mapCount} mapas exportados!`, 
            'success'
        );
    }

    showLoadSuccess(mapCount, importType) {
        const loadBtn = this.container?.querySelector('#load-btn');
        if (!loadBtn) {
            this.showToast(
                mapCount === 1 ? 
                `1 mapa ${importType}!` : 
                `${mapCount} mapas ${importType}!`, 
                'success'
            );
            return;
        }

        const originalContent = loadBtn.innerHTML;
        
        loadBtn.innerHTML = '<img src="./images/icon_check_green.svg" alt="SUCCESS" />';
        loadBtn.style.backgroundColor = '#28a745';
        
        setTimeout(() => {
            loadBtn.innerHTML = originalContent;
            loadBtn.style.backgroundColor = '';
        }, 1500);

        this.showToast(
            mapCount === 1 ? 
            `1 mapa ${importType}!` : 
            `${mapCount} mapas ${importType}!`, 
            'success'
        );
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 18px;
            border-radius: 6px;
            color: white;
            font-size: 13px;
            font-weight: 500;
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.3s ease;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            background-color: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#17a2b8'};
        `;
        
        document.body.appendChild(toast);
        
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
        });
        
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }

    changeButtonColors = () => {
        // Manter funcionalidade existente se necessário
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }
}

export default SaveLoadControl;