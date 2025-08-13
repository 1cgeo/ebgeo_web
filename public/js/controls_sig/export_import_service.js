// Path: js\controls_sig\export_import_service.js
import {
    addMap,
    setCurrentMap,
    getAllMapNames,
    getCurrentMapName,
    mapStore,
    imageStore
} from './store.js';

export class ExportImportService {
    constructor(baseLayerControl) {
        this.baseLayerControl = baseLayerControl;
    }

    // Arredondar coordenadas para precisão de 1 metro (6 casas decimais)
    roundCoordinates(coords) {
        const precision = 6;
        const factor = Math.pow(10, precision);
        
        if (Array.isArray(coords[0])) {
            return coords.map(coord => this.roundCoordinates(coord));
        } else {
            return coords.map(coord => Math.round(coord * factor) / factor);
        }
    }

    // Otimizar feature individual
    optimizeFeature(feature) {
        const optimized = { ...feature };
        
        // Arredondar coordenadas
        if (optimized.geometry && optimized.geometry.coordinates) {
            optimized.geometry.coordinates = this.roundCoordinates(optimized.geometry.coordinates);
        }
        
        return optimized;
    }

    // Otimizar dados do mapa
    optimizeMapData(mapData) {
        const optimized = { ...mapData };
        
        if (optimized.features) {
            for (const [category, features] of Object.entries(optimized.features)) {
                if (Array.isArray(features)) {
                    optimized.features[category] = features.map(feature => 
                        this.optimizeFeature(feature)
                    );
                }
            }
        }
        
        return optimized;
    }

    // Criar botão de salvar
    createSaveButton() {
        const saveButton = document.createElement('button');
        saveButton.className = 'map-action-button save-action';
        saveButton.innerHTML = `<img src="./images/icon_save_black.svg" alt="Exportar projeto" />`;
        saveButton.title = 'Exportar projeto';

        saveButton.onclick = async () => {
            await this.handleExport();
        };

        return saveButton;
    }

    // Criar botão de carregar
    createLoadButton() {
        const loadButton = document.createElement('button');
        loadButton.className = 'map-action-button load-action';
        loadButton.innerHTML = `<img src="./images/icon_load_black.svg" alt="Importar projeto" />`;
        loadButton.title = 'Importar projeto (substitui atual)';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.ebgeo';
        fileInput.className = 'hidden-file-input';
        fileInput.onchange = async (event) => {
            await this.handleImport(event, false);
        };

        loadButton.onclick = () => {
            fileInput.click();
        };

        loadButton.appendChild(fileInput);
        return loadButton;
    }

    // Criar botão de carregar aditivo
    createLoadAdditiveButton() {
        const loadAdditiveButton = document.createElement('button');
        loadAdditiveButton.className = 'map-action-button load-action';
        loadAdditiveButton.innerHTML = `<img src="./images/icon_folder_plus_black.svg" alt="Adicionar ao projeto" />`;
        loadAdditiveButton.title = 'Adicionar ao projeto atual';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.ebgeo';
        fileInput.className = 'hidden-file-input';
        fileInput.onchange = async (event) => {
            await this.handleImport(event, true);
        };

        loadAdditiveButton.onclick = () => {
            fileInput.click();
        };

        loadAdditiveButton.appendChild(fileInput);
        return loadAdditiveButton;
    }

    // Manipular exportação
    async handleExport() {
        try {
            const zip = new JSZip();

            const mapsToExport = await getAllMapNames();

            if (mapsToExport.length === 0) {
                alert('Nenhum mapa para exportar');
                return;
            }

            const data = {
                version: '1.0',
                currentMap: await getCurrentMapName(),
                maps: {}
            };

            // Exportar dados dos mapas com otimização
            for (const mapName of mapsToExport) {
                const mapData = await mapStore.getItem(mapName);
                if (mapData) {
                    data.maps[mapName] = this.optimizeMapData(mapData);
                }
            }

            // Adicionar data.json ao ZIP sem indentação e com compressão máxima
            const jsonString = JSON.stringify(data);
            zip.file('data.json', jsonString, {
                compression: 'DEFLATE',
                compressionOptions: { level: 9 }
            });

            // Coletar e exportar imagens usadas
            const usedImages = new Set();
            for (const mapName of mapsToExport) {
                const mapData = await mapStore.getItem(mapName);
                if (mapData && mapData.features) {
                    for (const [category, features] of Object.entries(mapData.features)) {
                        if (Array.isArray(features)) {
                            features.forEach(feature => {
                                if (feature.properties && feature.properties.imageId) {
                                    usedImages.add(feature.properties.imageId);
                                }
                            });
                        }
                    }
                }
            }

            // Adicionar imagens ao ZIP com compressão máxima
            for (const imageId of usedImages) {
                try {
                    const blob = await imageStore.getItem(imageId);
                    if (blob) {
                        zip.file(`images/${imageId}.png`, blob, {
                            compression: 'DEFLATE',
                            compressionOptions: { level: 9 }
                        });
                    }
                } catch (error) {
                    console.warn('Imagem não encontrada:', imageId);
                }
            }

            // Gerar arquivo com compressão máxima
            const blob = await zip.generateAsync({ 
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 9 },
                streamFiles: true
            });

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `projeto_${new Date().toISOString().slice(0, 10)}.ebgeo`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.showSaveSuccess(mapsToExport.length);

        } catch (error) {
            console.error('Erro ao exportar dados:', error);
            alert('Erro ao exportar arquivo .ebgeo');
        }
    }

    // Manipular importação
    async handleImport(event, isAdditiveImport) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const zip = await JSZip.loadAsync(file);

            if (!isAdditiveImport) {
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

                    while (existingMapNames.includes(finalMapName)) {
                        finalMapName = `${originalMapName}_importado${counter > 1 ? `_${counter}` : ''}`;
                        counter++;
                    }

                    await mapStore.setItem(finalMapName, mapData);
                    await addMap(finalMapName, mapData);
                    existingMapNames.push(finalMapName);
                    importedMapsCount++;
                }
            } else {
                for (const [mapName, mapData] of Object.entries(data.maps)) {
                    await mapStore.setItem(mapName, mapData);
                    await addMap(mapName, mapData);
                    importedMapsCount++;
                }

                setCurrentMap(data.currentMap);
            }

            // Carregar imagens
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

            // Recarregar mapa
            let baseLayer = 'Carta';
            if (!isAdditiveImport) {
                const currentMapData = await mapStore.getItem(data.currentMap);
                baseLayer = currentMapData ? currentMapData.baseLayer : 'Carta';
            }

            this.baseLayerControl.switchLayer(baseLayer);

            const importType = isAdditiveImport ? 'adicionados' : 'carregados';
            this.showLoadSuccess(importedMapsCount, importType);

        } catch (error) {
            console.error('Erro ao importar arquivo:', error);
            alert('Erro ao carregar arquivo .ebgeo: ' + error.message);
        }

        event.target.value = '';
    }

    // Mostrar sucesso no salvamento
    showSaveSuccess(mapCount) {
        const saveBtn = document.querySelector('.save-action');
        if (saveBtn) {
            const originalContent = saveBtn.innerHTML;

            saveBtn.classList.add('success');
            saveBtn.innerHTML = '<img src="./images/icon_check_green.svg" alt="SUCCESS" />';

            setTimeout(() => {
                saveBtn.classList.remove('success');
                saveBtn.innerHTML = originalContent;
            }, 1500);
        }

        this.showToast(
            mapCount === 1 ? 
                `1 mapa exportado!` :
                `${mapCount} mapas exportados!`,
            'success'
        );
    }

    // Mostrar sucesso no carregamento
    showLoadSuccess(mapCount, importType) {
        const loadBtn = document.querySelector('.load-action');
        if (loadBtn) {
            const originalContent = loadBtn.innerHTML;

            loadBtn.classList.add('success');
            loadBtn.innerHTML = '<img src="./images/icon_check_green.svg" alt="SUCCESS" />';

            setTimeout(() => {
                loadBtn.classList.remove('success');
                loadBtn.innerHTML = originalContent;
            }, 1500);
        }

        this.showToast(
            mapCount === 1 ?
                `1 mapa ${importType}!` :
                `${mapCount} mapas ${importType}!`,
            'success'
        );
    }

    // Mostrar toast
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
}