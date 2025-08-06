// Path: js\controls_sig\map_control.js
import { 
    addMap, 
    removeMap, 
    renameMap, 
    setCurrentMap, 
    updateMapPosition, 
    getCurrentBaseLayer, 
    getMapPosition,
    getAllMapNames,
    getCurrentMapName,
    mapStore
} from './store.js';

class MapControl {
    constructor(baseLayerControl) {
        this.baseLayerControl = baseLayerControl;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.id = 'map-list'
        this.container.className = 'list-map-container';

        const col = $("<div>", { id: 'header-map-list', class: "header-container-column" })
        const headerContainer = $("<div>", { class: "header-container-row" }).append(col)
        const titleContainer = $("<div>", { id: 'menu-map-list', class: "attr-container-row" });
        const title = document.createElement('h2');
        title.textContent = 'Mapas';
        titleContainer.append(title)
        col.append(titleContainer)
        $(this.container).append(headerContainer);

        this.mapList = document.createElement('ul');
        this.mapList.className = 'map-list';
        this.updateMapList();
        this.container.appendChild(this.mapList);

        return this.container;
    }

    loadMenu() {
        $('#save-btn').appendTo('#menu-map-list');
        $('#load-btn').appendTo('#menu-map-list');
        const addButton = document.createElement('button');
        addButton.className = 'add-map-button';
        addButton.innerHTML = `
            <img src="./images/icon_add.svg" alt="ADD" />
        `
        addButton.title = 'Adicionar mapa';
        addButton.onclick = async () => {
            const allMapNames = await getAllMapNames();
            if (allMapNames.length < 10) {
                const mapName = prompt("Digite o nome do mapa:");
                if (mapName) {
                    await addMap(mapName);
                    setCurrentMap(mapName);
                    await this.switchMap();
                    await this.updateMapList();
                }
            } else {
                alert("Você não pode adicionar mais de 10 mapas.");
            }
        };
        $('#menu-map-list').append(addButton)
        $('.base-layer-control').appendTo('#header-map-list');
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }

    async updateMapList() {
        this.mapList.innerHTML = '';

        const allMapNames = await getAllMapNames();
        const currentMapName = getCurrentMapName();
        const sortedMapNames = allMapNames.sort();

        for (let i = 0; i < sortedMapNames.length; i++) {
            const mapName = sortedMapNames[i];
            const listItem = $("<li>");
            
            if (mapName === currentMapName) listItem.addClass('current-map');
            
            $(listItem).append(
                $('<button>', { class: "map-name-button" })
                    .append(mapName)
                    .click(async (e) => {
                        e.preventDefault();
                        setCurrentMap(mapName);
                        await this.switchMap();
                        await this.updateMapList();
                    })
            );
            
            $(listItem).append(
                $("<div>", { class: "dropdown" })
                    .append(
                        $("<button>", { class: "more-info-icon" })
                            .append($('<img>', { src: "./images/icon_more_info.svg" }))
                            .click(function () {
                                let display = $(`.dropdown-content.more-info-${i}`).css('display') == 'block' ? 'none' : 'block'
                                $(`.dropdown-content.more-info-${i}`).css('display', display)
                                display == 'block' ? $(this).addClass('active-buton') : $(this).removeClass('active-buton')
                            })
                    )
                    .append(
                        $("<div>", { class: `dropdown-content more-info-${i}` })
                            .append(
                                $("<button>", { class: "menu-button" })
                                    .append('Salvar posição')
                                    .click(async (e) => {
                                        e.preventDefault();
                                        alert(`Posição salva do mapa ${mapName}`);
                                        const center = this.map.getCenter();
                                        const zoom = this.map.getZoom();
                                        
                                        const center_lat = center.lat;
                                        const center_long = center.lng;
                                        await updateMapPosition(center_lat, center_long, zoom);
                                        await this.updateMapList();
                                    })
                            )
                            .append(
                                $("<button>", { class: "menu-button" })
                                    .append('Copiar')
                                    .click(async (e) => {
                                        e.preventDefault();
                                        const allMapNames = await getAllMapNames();
                                        if (allMapNames.length < 10) {
                                            const newMapName = prompt("Digite o nome para o novo mapa:");
                                            if (newMapName) {
                                                const copiedMapData = await mapStore.getItem(mapName);
                                                await addMap(newMapName, copiedMapData);
                                                setCurrentMap(newMapName);
                                                await this.switchMap();
                                                await this.updateMapList();
                                            }
                                        } else {
                                            alert("Você não pode adicionar mais de 10 mapas.");
                                        }
                                    })
                            )
                            .append(
                                $("<button>", { class: "menu-button" })
                                    .append('Renomear')
                                    .click(async (e) => {
                                        e.preventDefault();
                                        const newMapName = prompt("Digite o novo nome do mapa:");
                                        if (newMapName) {
                                            const oldMapName = mapName;
                                            await renameMap(oldMapName, newMapName);
                                            setCurrentMap(newMapName);
                                            await this.switchMap();
                                            await this.updateMapList();
                                        }
                                    })
                            )
                            .append(
                                $("<button>", { class: "menu-button" })
                                    .append('Excluir')
                                    .click(async (e) => {
                                        e.preventDefault();
                                        const allMapNames = await getAllMapNames();
                                        if (allMapNames.length > 1) {
                                            if (confirm("Você tem certeza que deseja deletar este mapa?")) {
                                                await removeMap(mapName);

                                                if (currentMapName === mapName) {
                                                    const remainingMaps = await getAllMapNames();
                                                    setCurrentMap(remainingMaps[0]);
                                                    await this.switchMap();
                                                }

                                                await this.updateMapList();
                                            }
                                        } else {
                                            alert("Deve haver pelo menos um mapa.");
                                        }
                                    })
                            )
                    )
            );
            
            $(this.mapList).append(listItem);
        }
    }

    async switchMap() {
        const baseLayer = await getCurrentBaseLayer();
        const { center_lat, center_long, zoom } = await getMapPosition();
        this.setMapCenterAndZoom(center_lat, center_long, zoom);
        this.baseLayerControl.switchLayer(baseLayer);
    }

    setMapCenterAndZoom(center_lat, center_long, zoom) {
        if (center_lat !== null && center_long !== null && zoom !== null) {
            this.map.setCenter([center_long, center_lat]);
            this.map.setZoom(zoom);
        }
    }
}

export default MapControl;