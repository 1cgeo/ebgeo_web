// Path: js\controls_sig\export_import_service.js
import {
    getAllMapNames,
    getCurrentMapName,
    mapStore,
    imageStore,
    appStore,
    resetMemoryStore,
    getCurrentBaseLayer,
    setBaseLayer,
    MIN_SCHEMA_VERSION,
    MAX_SCHEMA_VERSION,
    SCHEMA_VERSION,
    compareVersions,
    addMap,
    setCurrentMap
} from './store/store.js';

import { IDUtils } from './id_utils.js';

export class ExportImportService {
    constructor(baseLayerControl, mapControl, mapManager) {
        this.baseLayerControl = baseLayerControl;
        this.mapControl = mapControl;
        this.mapManager = mapManager;
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

    // Detectar extensão correta do blob baseado no tipo MIME
    getBlobExtension(blob) {
        const mimeType = blob.type || 'image/png';
        switch (mimeType) {
            case 'image/svg+xml': return 'svg';
            case 'image/jpeg': return 'jpg';
            case 'image/webp': return 'webp';
            case 'image/png':
            default: return 'png';
        }
    }

    // XOR simples para mascarar dados
    xorData(data, key = 0xAA) {
        const result = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) {
            result[i] = data[i] ^ key;
        }
        return result;
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
            this.mapControl.deactivateActiveTools();

            const zip = new JSZip();

            const mapsToExport = await getAllMapNames();

            if (mapsToExport.length === 0) {
                alert('Nenhum mapa para exportar');
                return;
            }

            const data = {
                version: SCHEMA_VERSION,
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
                                if (feature.properties && feature.properties.id) {
                                    usedImages.add(feature.properties.id);
                                }
                            });
                        }
                    }
                }
            }

            // Adicionar imagens ao ZIP com extensão correta baseada no tipo MIME
            for (const imageId of usedImages) {
                try {
                    const blob = await imageStore.getItem(imageId);
                    if (blob) {
                        const extension = this.getBlobExtension(blob);
                        zip.file(`images/${imageId}.${extension}`, blob, {
                            compression: 'DEFLATE',
                            compressionOptions: { level: 9 }
                        });
                    }
                } catch (error) {
                    console.warn('Imagem não encontrada:', imageId);
                }
            }

            // Gerar arquivo ZIP
            const zipBlob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 9 },
                streamFiles: true
            });

            // Aplicar XOR nos dados ZIP para mascarar
            const zipArray = new Uint8Array(await zipBlob.arrayBuffer());
            const maskedData = this.xorData(zipArray);

            // Adicionar identificador no início para detectar arquivo XOR
            const identifier = new TextEncoder().encode('EBGXOR');
            const finalArray = new Uint8Array(identifier.length + maskedData.length);
            finalArray.set(identifier, 0);
            finalArray.set(maskedData, identifier.length);

            // Criar blob final
            const finalBlob = new Blob([finalArray], {
                type: 'application/vnd.ebgeo'
            });

            const url = URL.createObjectURL(finalBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `projeto-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.ebgeo`;
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
        this.mapControl.deactivateActiveTools();

        const file = event.target.files[0];
        if (!file) return;

        try {
            const fileBuffer = await file.arrayBuffer();
            const fileArray = new Uint8Array(fileBuffer);

            let zipData;
            const identifier = new TextDecoder().decode(fileArray.slice(0, 6));

            if (identifier === 'EBGXOR') {
                const maskedData = fileArray.slice(6);
                zipData = this.xorData(maskedData);
            } else {
                zipData = fileArray;
            }

            const zip = await JSZip.loadAsync(zipData);

            if (!isAdditiveImport) {
                resetMemoryStore();
                await mapStore.clear();
                await imageStore.clear();
                await appStore.clear();
            }

            const dataFile = zip.file('data.json');
            if (!dataFile) {
                throw new Error('Arquivo data.json não encontrado no .ebgeo');
            }

            const dataJson = await dataFile.async('string');
            const data = JSON.parse(dataJson);

            if (!data.version) {
                throw new Error('Arquivo .ebgeo sem informação de versão. Use a versão mais recente da aplicação para gerar o arquivo.');
            }

            if (compareVersions(data.version, MIN_SCHEMA_VERSION) < 0) {
                throw new Error(`Arquivo .ebgeo incompatível. Versão do arquivo: ${data.version}, versão mínima aceita: ${MIN_SCHEMA_VERSION}`);
            }
            if (compareVersions(data.version, MAX_SCHEMA_VERSION) > 0) {
                throw new Error(`Arquivo .ebgeo incompatível - versão muito recente. Versão do arquivo: ${data.version}, versão máxima aceita: ${MAX_SCHEMA_VERSION}. Atualize a aplicação para usar este arquivo.`);
            }
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);

            let importedMapsCount = 0;

            if (isAdditiveImport) {
                await this.loadImagesFromZip(zip);

                const existingMapNames = await getAllMapNames();
                const mapsToImport = Object.keys(data.maps).length;

                if (existingMapNames.length + mapsToImport > 30) {
                    throw new Error(`Limite de mapas excedido. Você tem ${existingMapNames.length} mapas, tentando importar ${mapsToImport}. Limite: 30 mapas.`);
                }

                for (const [originalMapName, mapData] of Object.entries(data.maps)) {
                    // Encontrar nome único
                    let finalMapName = originalMapName;
                    let counter = 1;
                    while (existingMapNames.includes(finalMapName)) {
                        finalMapName = `${originalMapName}_${counter}`;
                        counter++;
                    }

                    // Regenerar IDs das feições e duplicar recursos
                    // Agora as imagens já estão carregadas no imageStore
                    const { newMapData } = await IDUtils.regenerateMapIds(mapData, finalMapName);

                    // Criar novo mapa
                    await addMap(finalMapName, newMapData);
                    existingMapNames.push(finalMapName);
                    importedMapsCount++;
                }
            } else {
                // IMPORTAÇÃO COM SUBSTITUIÇÃO: Manter IDs originais
                for (const [mapName, mapData] of Object.entries(data.maps)) {
                    await addMap(mapName, mapData);
                    importedMapsCount++;
                }
                setCurrentMap(data.currentMap);

                // Carregar imagens após processamento dos mapas (import normal)
                await this.loadImagesFromZip(zip);
            }

            const baseLayer = isAdditiveImport ?
                await getCurrentBaseLayer() :
                (await mapStore.getItem(await getCurrentMapName()))?.baseLayer || 'carta-topografica';

            setBaseLayer(baseLayer);

            await this.baseLayerControl.switchMap();
            await this.mapControl.updateMapList();

            const importType = isAdditiveImport ? 'adicionados' : 'carregados';
            this.showLoadSuccess(importedMapsCount, importType);

        } catch (error) {
            console.error('Erro ao importar arquivo:', error);
            alert('Erro ao carregar arquivo .ebgeo: ' + error.message);
        }

        event.target.value = '';
    }

    async loadImagesFromZip(zip) {
        const imageFiles = Object.keys(zip.files).filter(name =>
            name.startsWith('images/') &&
            /\.(png|jpe?g|svg|webp)$/i.test(name)
        );

        for (const fileName of imageFiles) {
            try {
                const imageId = fileName.replace('images/', '').replace(/\.(png|jpe?g|svg|webp)$/i, '');
                const blob = await zip.file(fileName).async('blob');
                await imageStore.setItem(imageId, blob);
            } catch (imgError) {
                console.warn('Erro ao carregar imagem:', fileName, imgError);
            }
        }
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

    /**
     * Processa arquivo .ebgeo diretamente (para drag & drop)
     */
    async processFileDirectly(file, isAdditiveImport = false) {
        // Simular evento fake para reutilizar lógica existente
        const fakeEvent = {
            target: {
                files: [file],
                value: '' // Para resetar após processamento
            }
        };

        await this.handleImport(fakeEvent, isAdditiveImport);
    }
}