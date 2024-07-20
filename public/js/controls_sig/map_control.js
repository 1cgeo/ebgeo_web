import store, { addMap, removeMap, setCurrentMap, getCurrentMapFeatures, getCurrentBaseLayer } from './store.js';

class MapControl {
    constructor(baseLayerControl) {
        this.baseLayerControl = baseLayerControl;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl map-control-panel';

        const titleContainer = document.createElement('div');
        titleContainer.className = 'map-control-title-container';

        const title = document.createElement('h3');
        title.className = 'map-control-title';
        title.textContent = 'Mapas';

        const addButton = document.createElement('button');
        addButton.className = 'add-map-button';
        addButton.textContent = '+';
        addButton.title = 'Adicionar mapa';
        addButton.onclick = () => {
            const mapName = prompt("Digite o nome do mapa:");
            if (mapName) {
                addMap(mapName);
                setCurrentMap(mapName);
                const baseLayer = getCurrentBaseLayer();
                this.baseLayerControl.switchLayer(baseLayer);
                this.updateMapList();
            }
        };

        titleContainer.appendChild(title);
        titleContainer.appendChild(addButton);

        this.mapList = document.createElement('ul');
        this.mapList.className = 'map-list';

        this.updateMapList();

        this.container.appendChild(titleContainer);
        this.container.appendChild(this.mapList);

        return this.container;
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }

    updateMapList() {
        this.mapList.innerHTML = '';
        Object.keys(store.maps).forEach(mapName => {
            const listItem = document.createElement('li');
            listItem.textContent = mapName;
            listItem.className = mapName === store.currentMap ? 'current-map' : '';

            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'button-container';

            const changeButton = document.createElement('button');
            changeButton.className = 'change-map-button';
            changeButton.textContent = '👁️';
            changeButton.title = 'Alterar';
            changeButton.onclick = (e) => {
                e.stopPropagation();
                setCurrentMap(mapName);
                const baseLayer = getCurrentBaseLayer();
                this.baseLayerControl.switchLayer(baseLayer);
                this.updateMapList();
            };


            const copyButton = document.createElement('button');
            copyButton.className = 'copy-map-button';
            copyButton.textContent = '📋';
            copyButton.title = 'Copiar mapa';
            copyButton.onclick = (e) => {
                e.stopPropagation();
                const newMapName = prompt("Digite o nome para o novo mapa:");
                if (newMapName) {
                    const copiedMap = JSON.parse(JSON.stringify(store.maps[mapName]));
                    addMap(newMapName, copiedMap);
                    setCurrentMap(newMapName);
                    const baseLayer = getCurrentBaseLayer();
                    this.baseLayerControl.switchLayer(baseLayer);
                    this.updateMapList();
                }
            };
            
            const removeButton = document.createElement('button');
            removeButton.className = 'remove-map-button';
            removeButton.textContent = 'X';
            removeButton.title = 'Excluir';
            removeButton.onclick = (e) => {
                e.stopPropagation();
                if (Object.keys(store.maps).length > 1) {
                    if (confirm("Você tem certeza que deseja deletar este mapa?")) {
                        removeMap(mapName);

                        if (store.currentMap === mapName) {
                            const remainingMaps = Object.keys(store.maps);
                            setCurrentMap(remainingMaps[0]);
                            const baseLayer = getCurrentBaseLayer();
                            this.baseLayerControl.switchLayer(baseLayer);
                        }

                        this.updateMapList();
                    }
                } else {
                    alert("Deve haver pelo menos um mapa.");
                }
            };

            buttonContainer.appendChild(changeButton);
            buttonContainer.appendChild(copyButton);
            buttonContainer.appendChild(removeButton);
            listItem.appendChild(buttonContainer);
            this.mapList.appendChild(listItem);
        });
    }
}

export default MapControl;
