import store, { addMap, removeMap, renameMap, setCurrentMap, getCurrentMapFeatures, getCurrentBaseLayer } from './store.js';

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
        addButton.onclick = () => {
            if (Object.keys(store.maps).length < 10) {
                const mapName = prompt("Digite o nome do mapa:");
                if (mapName) {
                    addMap(mapName);
                    setCurrentMap(mapName);
                    this.switchMap()
                    this.updateMapList();
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

    updateMapList() {

        this.mapList.innerHTML = '';

        const sortedMapNames = Object.keys(store.maps).sort();

        sortedMapNames.forEach((mapName, i) => {
            const listItem = $("<li>")
            if (mapName === store.currentMap) listItem.addClass('current-map')
            // $(listItem).append($('<span>').text(i+1))
            $(listItem).append(
                $('<button>', { class: "map-name-button" })
                    .append(mapName)
                    .click(
                        (e) => {
                            e.preventDefault()
                            setCurrentMap(mapName);
                            this.switchMap()
                            this.updateMapList();
                        }
                    )
            )
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
                                    .append('Copiar')
                                    .click((e) => {
                                        e.preventDefault();
                                        if (Object.keys(store.maps).length < 10) {
                                            const newMapName = prompt("Digite o nome para o novo mapa:");
                                            if (newMapName) {
                                                const copiedMap = JSON.parse(JSON.stringify(store.maps[mapName]));
                                                addMap(newMapName, copiedMap);
                                                setCurrentMap(newMapName);
                                                this.switchMap()
                                                this.updateMapList();
                                            }
                                        } else {
                                            alert("Você não pode adicionar mais de 10 mapas.");
                                        }
                                    })
                            )
                            .append(
                                $("<button>", { class: "menu-button" })
                                    .append('Renomear')
                                    .click((e) => {
                                        e.preventDefault();
                                        const newMapName = prompt("Digite o novo nome do mapa:");
                                        if (newMapName) {
                                            const oldMapName = mapName;
                                            renameMap(oldMapName, newMapName);
                                            setCurrentMap(newMapName);
                                            this.switchMap()
                                            this.updateMapList();
                                        }
                                    })
                            )
                            .append(
                                $("<button>", { class: "menu-button" })
                                    .append('Excluir')
                                    .click((e) => {
                                        e.preventDefault();
                                        if (Object.keys(store.maps).length > 1) {
                                            if (confirm("Você tem certeza que deseja deletar este mapa?")) {
                                                removeMap(mapName);

                                                if (store.currentMap === mapName) {
                                                    const remainingMaps = Object.keys(store.maps);
                                                    setCurrentMap(remainingMaps[0]);
                                                    this.switchMap()
                                                }

                                                this.updateMapList();
                                            }
                                        } else {
                                            alert("Deve haver pelo menos um mapa.");
                                        }
                                    })
                            )
                    )

            )
            $(this.mapList).append(listItem);
        });
    }

    switchMap() {
        const baseLayer = getCurrentBaseLayer();
        this.baseLayerControl.switchLayer(baseLayer);
    }
}

export default MapControl;