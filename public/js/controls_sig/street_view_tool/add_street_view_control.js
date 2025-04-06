// Path: js\controls_sig\street_view_tool\add_street_view_control.js

import * as THREE from 'three';
import { DragControls } from 'DragControls';

class AddStreetViewControl {
    constructor(toolManager) {
        this.queryMobile = window.matchMedia("(max-width: 650px)")
        this.toolManager = toolManager;
        this.isActive = false;
        this.IMAGES_LOCATION = "/street_view/IMG"
        this.METADATA_LOCATION = "/street_view/METADATA"
        this.arrows = []
        this.camera = null
        this.scene = null
        this.renderer = null
        this.offsetRad = null
        this.material = null
        this.mesh = null
        this.control = null
        this.controls = null
        this.nextTarget = null
        this.lastClickAt = null
        this.currentLookAt = null
        this.isUserInteracting = false
        this.onPointerDownMouseX = 0
        this.onPointerDownMouseY = 0
        this.currentHoveElement = null
        this.raycaster = new THREE.Raycaster()
        this.mouse = new THREE.Vector2()
        this.currentHeading = null
        this.currentMouseLocation = { x: 0, y: 0 }
        this.currentInfo = null
        this.currentPhotoName = ''
        this.nextPhotoTarget = null
        this.isDrag = false
        this.miniMap = null
        this.isOpen = false
        this.animationFrameId = null
        this.eventListeners = []
        this.mapListeners = []

        // Reutilize geometrias e materiais para evitar criação repetida
        this.arrowGeometry = null;
        this.arrowTexture = null;
        this.arrowMaterial = null;

        this.animate = this.animate.bind(this);
        this.update = this.update.bind(this);
        this.onPointerMove = this.onPointerMove.bind(this);
        this.onPointerUp = this.onPointerUp.bind(this);
        this.onDocumentMouseWheel = this.onDocumentMouseWheel.bind(this);
        this.setCurrentMouse = this.setCurrentMouse.bind(this);
        this.loadPoint = this.loadPoint.bind(this);
        this.showHoverCursor = this.showHoverCursor.bind(this);
        this.hideHoverCursor = this.hideHoverCursor.bind(this);
        this.closeStreetView = this.closeStreetView.bind(this);
    }

    loadData = async () => {
        try {
            this.photosGeojson = await $.getJSON("/street_view/fotos.geojson")
            this.photosLinhasGeoJson = await $.getJSON("/street_view/fotos_linha.geojson")
            this.centroid = turf.centroid(this.photosGeojson)

            // Tentar configurar a fonte apenas se estiver pronta
            if (this.map && this.map.getSource('lines-street-view')) {
                this.map.getSource('lines-street-view').setData(this.photosLinhasGeoJson);
            }
        } catch (error) {
            console.error("Erro ao carregar dados do street view:", error);
        }
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl';

        const button = document.createElement('button');
        button.setAttribute("id", "street-view-tool");
        button.className = 'custom-tool-sig-button';
        button.title = 'Adicionar street view';
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_street_view_black.svg" />';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);
        this.changeButtonColor()
        
        // Registrar os event listeners para atualização posterior
        this.addJQueryListener($('input[name="base-layer"]'), 'change', this.changeButtonColor);
        this.addJQueryListener($('input[name="base-layer"]'), 'change', this.reload);
        
        return this.container;
    }
    
    // Método para adicionar event listeners e rastreá-los para remoção posterior
    addEventListenerWithTracking(element, event, handler) {
        element.addEventListener(event, handler);
        this.eventListeners.push({ element, event, handler });
    }
    
    // Método para adicionar jQuery event listeners
    addJQueryListener(jqElement, event, handler) {
        jqElement.on(event, handler);
        this.eventListeners.push({ type: 'jquery', jqElement, event, handler });
    }
    
    // Método para remover todos os event listeners rastreados
    removeAllEventListeners() {
        this.eventListeners.forEach(listener => {
            if (listener.type === 'jquery') {
                listener.jqElement.off(listener.event, listener.handler);
            } else if (listener.element) {
                listener.element.removeEventListener(listener.event, listener.handler);
            }
        });
        this.eventListeners = [];
    }

    changeButtonColor = () => {
        const color = $('input[name="base-layer"]:checked').val() == 'Carta' ? 'black' : 'white'
        $("#street-view-tool").html(`<img class="icon-sig-tool" src="./images/icon_street_view_${color}.svg" />`);
        if (!this.isActive) return
        $("#street-view-tool").html('<img class="icon-sig-tool" src="./images/icon_street_view_red.svg" />');
    }

    reload = async () => {
        if (this.isActive) {
            await this.loadData()
            this.showPhotos()
        } 
    }

    onRemove() {
        this.deactivate();
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        
        // Garantir limpeza total de recursos
        this.cleanupResources();
        this.map = undefined;
    }

    async activate() {
        if (this.isActive) {
            this.toolManager.deactivateCurrentTool();
            return
        }
        
        this.addJQueryListener($('#close-street-view-button'), 'click', this.closeStreetView);
        this.isActive = true;
        $("#street-view-tool").empty().append('<img class="icon-sig-tool" src="./images/icon_street_view_red.svg" />');
        await this.loadData()
        this.showPhotos()
    }

    showPhotos = async () => {
        // Adicionar listeners ao mapa e rastreá-los para remoção posterior
        this.addMapListener('click', 'street-view', this.loadPoint);
        this.addMapListener('touchend', 'street-view', this.loadPoint);
        this.addMapListener('mouseenter', 'street-view', this.showHoverCursor);
        this.addMapListener('mouseleave', 'street-view', this.hideHoverCursor);

        // Criar minimap
        this.createMiniMap();
    }
    
    // Método para adicionar listeners do mapa e rastreá-los
    addMapListener(event, layer, handler) {
        this.map.on(event, layer, handler);
        this.mapListeners.push({ event, layer, handler });
    }
    
    // Método para remover todos os listeners do mapa
    removeMapListeners() {
        this.mapListeners.forEach(listener => {
            this.map.off(listener.event, listener.layer, listener.handler);
        });
        this.mapListeners = [];
    }

    createMiniMap() {
        // Se já existe um minimap, limpe-o primeiro
        if (this.miniMap) {
            this.miniMap.remove();
            this.miniMap = null;
        }
        
        this.miniMap = new maplibregl.Map({
            container: 'mini-map-street-view',
            style: '/street_view/street-view-map-style.json',
            center: this.centroid.geometry.coordinates,
            attributionControl: false,
            zoom: 12.5,
            minZoom: 11,
            maxZoom: 17.9
        });

        // Carregar imagens e configurar camadas
        this.miniMap.on('load', async () => {
            try {
                let pointImage = await this.miniMap.loadImage('/street_view/point.png');
                await this.miniMap.addImage('point', pointImage.data);
                this.miniMap.addSource('points', {
                    'type': 'geojson',
                    'data': this.photosGeojson
                });
                this.miniMap.addLayer({
                    'id': 'points',
                    'type': 'symbol',
                    'source': 'points',
                    'layout': {
                        'icon-image': 'point'
                    }
                });
                
                let pointSelectedImage = await this.miniMap.loadImage('/street_view/point-selected-v2.png');
                this.miniMap.addImage('point-selected', pointSelectedImage.data);
                this.miniMap.addSource('selected', {
                    'type': 'geojson',
                    'data': this.photosGeojson
                });
                this.miniMap.addLayer({
                    'id': 'selected',
                    'type': 'symbol',
                    'source': 'selected',
                    "filter": [
                        "all",
                        [
                            "==",
                            "nome_img",
                            this.currentPhotoName
                        ]
                    ],
                    'layout': {
                        'icon-image': 'point-selected'
                    }
                });
                
                // Adicionar event listeners do minimapa
                this.miniMap.on('click', 'points', (e) => {
                    this.loadTarget(e.features[0].properties.nome_img, () => {
                        this.setIconDirection(this.currentInfo.camera.heading)
                    })
                });
                
                this.miniMap.on('mouseenter', 'points', () => {
                    this.miniMap.getCanvas().style.cursor = 'pointer';
                });
                
                this.miniMap.on('mouseleave', 'points', () => {
                    this.miniMap.getCanvas().style.cursor = '';
                });
            } catch (error) {
                console.error("Erro ao configurar o minimap:", error);
            }
        });
    }

    getNeighbor = (point, points) => {
        var from = turf.point([point.lng, point.lat])
        var minDistance, target;
        for (let p of points) {
            let to = turf.point([p.geometry.coordinates[0], p.geometry.coordinates[1]])
            let distance = turf.distance(from, to)
            if (!minDistance || distance < minDistance) {
                target = p
                minDistance = distance
            }
        }
        return target
    }

    loadImageByName = (name) => {
        $.getJSON(`${this.METADATA_LOCATION}/${name}.json`, (data) => {
            this.currentInfo = data
            this.loadStreetView(data)
            this.startAnimationLoop()
        });
    }

    loadStreetView = (info) => {
        this.isOpen = true
        const container = document.getElementById('street-view-container');
        
        // Limpar listeners anteriores e recursos se necessário
        this.cleanupResources();

        // Configurar o raycaster uma única vez em vez de recriá-lo
        if (!this.raycaster) {
            this.raycaster = new THREE.Raycaster();
        }

        this.addEventListenerWithTracking(document, 'pointermove', this.setCurrentMouse);
        this.addEventListenerWithTracking(document, 'mousemove', (event) => {
            event.preventDefault();
            this.mouse.x = (event.clientX / this.renderer?.domElement.clientWidth) * 2 - 1 || 0;
            this.mouse.y = -(event.clientY / this.renderer?.domElement.clientHeight) * 2 + 1 || 0;
            
            if (this.raycaster && this.camera) {
                this.raycaster.setFromCamera(this.mouse, this.camera);
                if (this.arrows && this.arrows.length > 0) {
                    var intersects = this.raycaster.intersectObjects(this.arrows.filter(i => i.arrow.visible).map(i => i.arrow));
                    if (intersects.length > 0) {
                        // Interseção encontrada
                    }
                }
            }
        });

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, -0.1, 0)
        this.camera.rotation.order = 'YXZ';

        // Limpar cena anterior se existir
        if (this.scene) {
            this.disposeSceneObjects(this.scene);
        }
        
        this.scene = new THREE.Scene();
        this.scene.add(this.camera)

        // Reutilizar geometria se possível
        const geometry = new THREE.SphereGeometry(500, 60, 40);
        geometry.scale(- 1, 1, 1);
        this.setCurrentPhotoName(info.camera.img)
        
        // Gerenciar texturas - disposar texturas antigas
        if (this.material && this.material.map) {
            this.material.map.dispose();
        }
        
        let texture = new THREE.TextureLoader().load(
            `${this.IMAGES_LOCATION}/${info.camera.img}.jpg`,
            (loadedTexture) => {
                loadedTexture.colorSpace = THREE.SRGBColorSpace;
                // Callback para garantir que a textura seja carregada antes de ser usada
                if (this.material) {
                    this.material.map = loadedTexture;
                    this.material.needsUpdate = true;
                }
            }
        );
        
        // Disposar material anterior se existir
        if (this.material) {
            this.material.dispose();
        }
        
        this.material = new THREE.MeshBasicMaterial({ map: texture });
        
        // Disposar mesh anterior se existir
        if (this.mesh) {
            this.scene.remove(this.mesh);
            if (this.mesh.geometry && this.mesh.geometry !== geometry) {
                this.mesh.geometry.dispose();
            }
            // Material será limpo acima
        }
        
        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.name = 'IMAGE_360';

        this.setIconDirection(info.camera.heading)
        this.offsetRad = THREE.MathUtils.degToRad(info.camera.fix_heading);
        this.mesh.rotation.y = this.offsetRad

        this.scene.add(this.mesh);

        // Criar ou reutilizar renderer
        if (!this.renderer) {
            this.renderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: true,
                powerPreference: 'high-performance'
            });
            this.renderer.setPixelRatio(window.devicePixelRatio);
        }
        
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        if (!container.contains(this.renderer.domElement)) {
            container.appendChild(this.renderer.domElement);
        }

        this.createControl()

        container.style.touchAction = 'none';
        this.addEventListenerWithTracking(container, 'pointerdown', this.onPointerDown);

        this.addEventListenerWithTracking(document, 'wheel', this.onDocumentMouseWheel, { passive: true });

        this.addEventListenerWithTracking(window, 'resize', this.onWindowResize);

        var pt = turf.point([info.camera.lon, info.camera.lat])
        var distance = 50
        var bearing = info.camera.heading
        var destination = turf.rhumbDestination(pt, distance, bearing)
        const [x, y, z] = this.calculateTargetPositionInMeters(
            {
                latitude: info.camera.lat,
                longitude: info.camera.lon
            },
            {
                latitude: destination.geometry.coordinates[1],
                longitude: destination.geometry.coordinates[0]
            }
        )
        this.camera.lookAt(x, y, z)
        this.renderer.render(this.scene, this.camera);
        this.setCurrentMiniMap()
        this.setCurrentMouse()
        this.drawControl()
        this.setCurrentMouse()
    }

    // Iniciar o loop de animação
    startAnimationLoop() {
        // Cancelar qualquer loop existente para evitar múltiplos loops
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.animate();
    }
    
    // Parar o loop de animação
    stopAnimationLoop() {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    setCurrentMouse = (event) => {
        if (!this.camera) return
        const heading = this.camera.rotation.y;
        const radians = heading > 0 ? heading : (2 * Math.PI) + heading;
        let degrees = THREE.MathUtils.radToDeg(radians);
        degrees = -1 * degrees
        this.currentHeading = (degrees + 360) % 360
        this.setIconDirection(this.currentHeading)
    }

    setIconDirection = (degrees) => {
        if (this.miniMap) this.miniMap.setLayoutProperty('selected', 'icon-rotate', degrees)
    }

    setCurrentPhotoName = (name) => {
        this.currentPhotoName = name
        if (this.miniMap) {
            this.miniMap.setFilter(
                'selected',
                [
                    "all",
                    [
                        "==",
                        "nome_img",
                        this.currentPhotoName
                    ]
                ],
            );
            let found = this.photosGeojson.features.find(item => item.properties.nome_img == this.currentPhotoName)
            if (found) {
                let long = found.geometry.coordinates[0]
                let lat = found.geometry.coordinates[1]
                this.miniMap.setCenter([long, lat]);
            }
        }
    }

    createControl = () => {
        this.cleanArrows(this.arrows.map(i => i.arrow))
        this.arrows = []

        // Reutilizar geometria e material para as setas
        if (!this.arrowGeometry) {
            this.arrowGeometry = new THREE.CircleGeometry(0.5, 70);
        }
        
        if (!this.arrowTexture) {
            this.arrowTexture = new THREE.TextureLoader().load("/street_view/arrow.png");
        }
        
        if (!this.arrowMaterial) {
            this.arrowMaterial = new THREE.MeshBasicMaterial({ 
                map: this.arrowTexture, 
                side: THREE.DoubleSide, 
                transparent: true 
            });
        }

        for (let target of this.currentInfo.targets) {
            const control = new THREE.Mesh(this.arrowGeometry, this.arrowMaterial);
            control.imgId = () => target.id;
            control.callback = () => this.loadTarget(target.id);
            this.arrows.push({ ...target, arrow: control });
            this.scene.add(control);
        }

        if (this.controls) {
            this.controls.deactivate();
            this.controls.dispose();
        }
        
        this.controls = new DragControls(this.arrows.map(i => i.arrow), this.camera, this.renderer.domElement);
        this.controls.addEventListener('drag', (event) => {
            this.isDrag = true
        });
        this.controls.addEventListener('dragstart', (event) => {
            this.dragStartTime = Date.now();
            this.dragStartPosition = { x: event.object.position.x, y: event.object.position.y };
        });
        this.controls.addEventListener('dragend', (event) => {
            const dragEndTime = Date.now();
            const dragDuration = dragEndTime - this.dragStartTime;
            const dragDistance = Math.sqrt(
                Math.pow(event.object.position.x - this.dragStartPosition.x, 2) +
                Math.pow(event.object.position.y - this.dragStartPosition.y, 2)
            );

            if (dragDuration < 200 && dragDistance < 5) {
                // This was likely intended as a click, not a drag
                this.clickObj(event.object);
            }
            
            this.isDrag = false;
            this.dragStartTime = null;
            this.dragStartPosition = null;
        });
    }

    clickObj = (object) => {
        if (object && typeof object.callback === 'function') {
            object.callback();
        }
    }

    // Método melhorado para limpeza eficiente de setas
    cleanArrows = (objects) => {
        for (let mesh of objects) {
            const object = this.scene?.getObjectByProperty('uuid', mesh.uuid);
            if (!object) continue;
            
            // Não dispose de geometrias e materiais compartilhados
            // Apenas remova o objeto da cena
            this.scene.remove(object);
        }
    }

    loadTarget = (name, cb = () => { }) => {
        $.getJSON(`${this.METADATA_LOCATION}/${name}.json`, (data) => {
            this.currentInfo = data
            this.setCurrentMiniMap()
            this.createControl()
            this.setCurrentMouse()
            this.drawControl()
            this.setCurrentMouse()
            this.setCurrentPhotoName(data.camera.img)
            
            // Gerenciar texturas corretamente
            if (this.material && this.material.map) {
                this.material.map.dispose();
            }
            
            let texture = new THREE.TextureLoader().load(
                `${this.IMAGES_LOCATION}/${data.camera.img}.jpg`,
                (texture) => {
                    texture.colorSpace = THREE.SRGBColorSpace
                    if (this.material) {
                        this.material.map = texture
                        this.material.needsUpdate = true
                    }
                    this.offsetRad = THREE.MathUtils.degToRad(data.camera.fix_heading);
                    if (this.mesh) {
                        this.mesh.rotation.y = this.offsetRad
                    }
                    cb()
                },
            );
        });
    }

    onPointerDown = (event) => {
        if (event.isPrimary === false || this.nextTarget) return;
        this.isUserInteracting = true;
        this.onPointerDownMouseX = event.clientX;
        this.onPointerDownMouseY = event.clientY;
        this.mouse.x = event.clientX / window.innerWidth * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        if (this.raycaster && this.camera && this.scene) {
            this.raycaster.setFromCamera(this.mouse, this.camera);
            var intersects = this.raycaster.intersectObjects([this.scene.getObjectByName('IMAGE_360')], true);
            if (intersects.length > 0) {
                this.lastClickAt = intersects[0].point
            }
        }
        this.addEventListenerWithTracking(document, 'pointermove', this.onPointerMove);
        this.addEventListenerWithTracking(document, 'pointerup', this.onPointerUp);
    }

    onPointerMove = (event) => {
        if (event.isPrimary === false || !this.isUserInteracting) return;
        let factor = (0.00005 * 1768) / window.innerWidth
        this.mouse.x = (this.onPointerDownMouseX - event.clientX) * factor
        this.mouse.y = (event.clientY - this.onPointerDownMouseY) * factor * 0.8
        if (this.raycaster && this.camera && this.scene) {
            this.raycaster.setFromCamera(this.mouse, this.camera);
            var intersects = this.raycaster.intersectObjects([this.scene.getObjectByName('IMAGE_360')], true);
            if (intersects.length > 0) {
                this.currentLookAt = intersects[0].point
            }
        }
    }

    onPointerUp = (event) => {
        if (event.isPrimary === false) return;
        this.isUserInteracting = false;
        document.removeEventListener('pointermove', this.onPointerMove);
        document.removeEventListener('pointerup', this.onPointerUp);
    }

    onDocumentMouseWheel = (event) => {
        if ($('#mini-map-street-view:hover').length == 1 || !this.isOpen || !this.camera) return
        const fov = this.camera.fov + event.deltaY * 0.05;
        this.camera.fov = THREE.MathUtils.clamp(fov, 10, 75);
        this.camera.updateProjectionMatrix();
    }

    animate = () => {
        if (!this.isOpen) {
            this.stopAnimationLoop();
            return;
        }
        
        this.animationFrameId = requestAnimationFrame(this.animate);
        this.update();
    }

    update = () => {
        if (!this.camera || !this.renderer || !this.scene) return;
        
        let target = this.nextTarget || this.currentLookAt;
        if (target) {
            this.setCurrentMouse();
            this.drawControl();
            this.setCurrentMouse();
            this.camera.lookAt(target.x, THREE.MathUtils.clamp(target.y, -360, 250), target.z);
        }
        this.nextTarget = null;
        this.currentLookAt = null;
        this.renderer.render(this.scene, this.camera);
    }

    setFullMap = (full) => {
        $('#top-bar').css({
            display: full ? 'flex' : 'none'
        });
        $('#map-sig').css({
            display: full ? 'block' : 'none'
        });
        $('#mini-map-street-view').css({
            display: full ? 'none' : 'block'
        });
        $('#street-view-container').css({
            display: full ? 'none' : 'block'
        });
        $('#close-street-view-button').css({
            display: full ? 'none' : 'flex'
        });
    }

    onWindowResize = () => {
        if (!this.camera || !this.renderer) return;
        
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    calculateTargetPositionInMeters = (
        cameraLocation,
        targetLocation
    ) => {
        const cameraLocationGeojson = turf.point([
            cameraLocation.longitude,
            cameraLocation.latitude
        ]);
        const xDest = {
            longitude: targetLocation.longitude,
            latitude: cameraLocation.latitude
        };
        const xDestGeojson = turf.point([xDest.longitude, xDest.latitude]);
        let x = turf.distance(cameraLocationGeojson, xDestGeojson);
        x = x * 1000
        x *= targetLocation.longitude > cameraLocation.longitude ? 1 : -1;
        const zDest = {
            longitude: cameraLocation.longitude,
            latitude: targetLocation.latitude
        };
        const zDestGeojson = turf.point([zDest.longitude, zDest.latitude]);
        let z = turf.distance(cameraLocationGeojson, zDestGeojson);
        z = z * 1000
        z *= targetLocation.latitude > cameraLocation.latitude ? -1 : 1;
        return [x, 0, z];
    };

    setCurrentMiniMap = () => {
        if (!this.miniMap || !this.currentInfo) return;
        
        var pt = turf.point([this.currentInfo.camera.lon, this.currentInfo.camera.lat])
        var buffered = turf.buffer(pt, 0.04)
        var bbox = turf.bbox(buffered)
        this.miniMap.fitBounds(bbox)
    }

    drawControl = () => {
        if (!this.camera || !this.currentInfo || !this.arrows || this.arrows.length === 0) return;
        
        for (let [idx, item] of this.arrows.entries()) {
            let arrow = item.arrow
            const heading = this.camera.rotation.y;
            const radians = heading > 0 ? heading : (2 * Math.PI) + heading;
            let degrees = THREE.MathUtils.radToDeg(radians);
            var point1 = turf.point([this.currentInfo.camera.lon, this.currentInfo.camera.lat])
            var point2 = turf.point([item.lon, item.lat])
            var bearing = (turf.rhumbBearing(point1, point2) + degrees + 360) % 360
            let center = turf.point([0, -0.4])
            var distance = this.queryMobile.matches ? 55 : 35
            var destination = turf.rhumbDestination(center, distance, bearing)
            var vector = new THREE.Vector3(
                destination.geometry.coordinates[0],
                destination.geometry.coordinates[1],
                0.5
            )
            //control.visible = vector.y <= -0.15 ? true : false
            vector.unproject(this.camera);
            var dir = vector.sub(this.camera.position).normalize();
            var distance = 5;
            var pos = this.camera.position.clone().add(dir.multiplyScalar(distance));
            arrow.position.copy(pos);
            arrow.lookAt(this.camera.position);
            arrow.rotation.z -= THREE.MathUtils.degToRad(bearing)
        }
    }

    loadPoint = (e) => {
        let f = this.getNeighbor(e.lngLat, this.photosGeojson.features)
        this.setFullMap(false)
        if (this.scene) {
            this.loadTarget(f.properties.nome_img)
            return
        }
        this.loadImageByName(f.properties.nome_img)
    }

    showHoverCursor = () => {
        if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    }

    hideHoverCursor = () => {
        if (this.map) this.map.getCanvas().style.cursor = '';
    }

    deactivate = () => {
        this.isActive = false;
        this.changeButtonColor();
        if (this.map) this.map.getCanvas().style.cursor = '';
        this.hidePhotos();
        this.closeStreetView();
        this.cleanupResources();
        this.removeAllEventListeners();
        this.removeMapListeners();
    }

    // Método para limpar todos os recursos
    cleanupResources() {
        // Parar o loop de animação
        this.stopAnimationLoop();
        
        // Disposar objetos da cena
        if (this.scene) {
            this.disposeSceneObjects(this.scene);
        }
        
        // Disposar texturas e materiais compartilhados
        if (this.arrowTexture) {
            this.arrowTexture.dispose();
            this.arrowTexture = null;
        }
        
        if (this.arrowMaterial) {
            this.arrowMaterial.dispose();
            this.arrowMaterial = null;
        }
        
        if (this.arrowGeometry) {
            this.arrowGeometry.dispose();
            this.arrowGeometry = null;
        }
        
        // Limpar controles
        if (this.controls) {
            this.controls.deactivate();
            this.controls.dispose();
            this.controls = null;
        }
        
        // Limpar o renderer
        if (this.renderer) {
            // Não destrua o renderer completamente para reutilizá-lo
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
            // Optionally: this.renderer.dispose();
            // this.renderer = null;
        }
        
        // Remover event listeners
        this.removeAllEventListeners();
    }
    
    // Método para disposar objetos da cena
    disposeSceneObjects(scene) {
        if (!scene) return;
        
        // Primeiro limpe as arrows que são objetos específicos
        this.cleanArrows(this.arrows.map(i => i.arrow));
        this.arrows = [];
        
        // Remova mesh principal
        if (this.mesh) {
            scene.remove(this.mesh);
            if (this.mesh.geometry) {
                // Não destrua a geometria se estiver sendo reutilizada
                // this.mesh.geometry.dispose();
            }
            
            if (this.mesh.material) {
                if (this.mesh.material.map) {
                    this.mesh.material.map.dispose();
                }
                this.mesh.material.dispose();
            }
            this.mesh = null;
        }
        
        // Percorra outros objetos da cena
        scene.traverse((object) => {
            if (object.isMesh) {
                if (object.geometry && object.geometry !== this.arrowGeometry) {
                    object.geometry.dispose();
                }
                
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(material => {
                            if (material.map) material.map.dispose();
                            if (material !== this.arrowMaterial) {
                                material.dispose();
                            }
                        });
                    } else {
                        if (object.material.map) object.material.map.dispose();
                        if (object.material !== this.arrowMaterial) {
                            object.material.dispose();
                        }
                    }
                }
            }
        });
        
        // Limpar a cena
        while (scene.children.length > 0) {
            scene.remove(scene.children[0]);
        }
    }

    closeStreetView = () => {
        this.isOpen = false;
        this.setFullMap(true);
        this.stopAnimationLoop();
    }

    hidePhotos = () => {
        // Remover listeners de mapa
        this.removeMapListeners();
        
        // Remover o minimap
        if (this.miniMap) {
            this.miniMap.remove();
            this.miniMap = null;
        }
        
        // Limpar dados do mapa
        if (this.map && this.map.getSource('lines-street-view')) {
            this.map.getSource('lines-street-view').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
        
        // Esconder elementos visuais
        $('#mini-map-street-view').css({ display: 'none' });
    }

    handleMapClick(e) {
        // Método vazio para compatibilidade com interface
    }

    handleMouseDown(e) {
        // Método vazio para compatibilidade com interface
    }
}

export default AddStreetViewControl;