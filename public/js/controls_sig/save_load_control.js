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
            <button id="save-btn" class="save-load-icon">
                <img src="./images/icon_save_black.svg" alt="SAVE" />
            </button>
            <button id="load-btn" class="save-load-icon">
                <img src="./images/icon_load_black.svg" alt="LOAD" />
            </button>
            <input type="file" id="load-file" accept=".ebgeo" style="display: none;" />
        `;

        // Export - IndexedDB para ZIP
        this.container.querySelector('#save-btn').addEventListener('click', async () => {
            try {
                const zip = new JSZip();
                
                // Dados de todos os mapas do IndexedDB
                const allMapKeys = await getAllMapNames();
                const allData = {
                    maps: {},
                    currentMap: getCurrentMapName(),
                };
                
                for (const mapName of allMapKeys) {
                    const mapData = await mapStore.getItem(mapName);
                    if (mapData) {
                        allData.maps[mapName] = mapData;
                    }
                }
                
                zip.file('data.json', JSON.stringify(allData));
                
                // Todas as imagens do imageStore
                const imgFolder = zip.folder('images');
                const imageKeys = await imageStore.keys();
                
                for (const key of imageKeys) {
                    const blob = await imageStore.getItem(key);
                    if (blob) {
                        imgFolder.file(`${key}.png`, blob);
                    }
                }
                
                // Download
                const content = await zip.generateAsync({ type: 'blob' });
                const url = URL.createObjectURL(content);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = 'maps_data.ebgeo';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (error) {
                console.error('Erro ao exportar dados:', error);
                alert('Erro ao exportar arquivo .ebgeo');
            }
        });

        this.container.querySelector('#load-btn').addEventListener('click', () => {
            this.container.querySelector('#load-file').click();
        });

        // Import - ZIP para IndexedDB + MapLibre
        this.container.querySelector('#load-file').addEventListener('change', async (event) => {
            const file = event.target.files[0];
            if (!file) return;
            
            try {
                const zip = await JSZip.loadAsync(file);
                
                // Limpar IndexedDB
                await mapStore.clear();
                await imageStore.clear();
                
                // Buscar arquivo data.json (com diferentes possibilidades)
                let dataFile = zip.file('data.json');
                
                if (!dataFile) {
                    throw new Error('Arquivo data.json não encontrado no .ebgeo');
                }
                
                const dataJson = await dataFile.async('string');
                const data = JSON.parse(dataJson);
                
                // Salvar cada mapa no IndexedDB
                for (const [mapName, mapData] of Object.entries(data.maps)) {
                    await mapStore.setItem(mapName, mapData);
                    await addMap(mapName, mapData);
                }
                
                // Atualizar mapa atual
                setCurrentMap(data.currentMap);
                
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
                const currentMapData = await mapStore.getItem(data.currentMap);
                const baseLayer = currentMapData ? currentMapData.baseLayer : 'Carta';
                this.baseLayerControl.switchLayer(baseLayer);
                this.mapControl.updateMapList();
                
                alert('Arquivo .ebgeo carregado com sucesso!');
                
            } catch (error) {
                console.error('Erro ao importar arquivo:', error);
                alert('Erro ao carregar arquivo .ebgeo: ' + error.message);
            }
            
            event.target.value = '';
        });

        $('input[name="base-layer"]').on('change', this.changeButtonColors);
        this.changeButtonColors()

        return this.container;
    }

    changeButtonColors = () => {
        // const color = $('input[name="base-layer"]:checked').val() == 'Carta' ? 'black' : 'white'
        // $("#load-btn").html(`<img src="./images/icon_load_${color}.svg" alt="LOAD" />`);
        // $("#save-btn").html(`<img src="./images/icon_save_${color}.svg" alt="SAVE" />`);
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }
}

export default SaveLoadControl;