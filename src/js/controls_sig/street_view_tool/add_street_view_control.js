// Path: src/js/controls_sig/street_view_tool/add_street_view_control.js

import * as THREE from '../../../vendor/three/three.module.js';
import { DragControls } from '../../../vendor/three/addons/controls/DragControls.js';
import config from '../../config.js';

class AddStreetViewControl {

    constructor() {
        this.queryMobile = window.matchMedia("(max-width: 650px)")
        this.isActive = false;
        this.IMAGES_LOCATION = "./street_view/IMG"
        this.METADATA_LOCATION = "./street_view/METADATA"
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
        this.miniMap = new maplibregl.Map({
            container: 'mini-map-street-view',
            style: './street_view/street-view-mini-map-style.json',
            attributionControl: false,
            zoom: 12.5,
            minZoom: 11,
            maxZoom: 17.9,
            validateStyle: false
        });
        this.isOpen = false,

        // Performance optimization properties
        this.animationId = null
        this.documentListeners = []
        this.arrowGeometry = null
        this.arrowTexture = null

        // High-impact performance caches
        this.textureCache = new Map()
        this.metadataCache = new Map()
        this.sphereGeometry = null
        this.miniMapHovered = false

        this.animate = this.animate.bind(this);
        this.update = this.update.bind(this);
        this.onPointerMove = this.onPointerMove.bind(this);
        this.onPointerUp = this.onPointerUp.bind(this);
        this.onDocumentMouseWheel = this.onDocumentMouseWheel.bind(this);
        this.setCurrentMouse = this.setCurrentMouse.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onStreetViewKeyDown = this.onStreetViewKeyDown.bind(this);

        this.photosSourceId = 'pmtiles-photos';

        this.nearbyFeaturesCache = new Map();
        this.cacheRadius = 1000;

        if (config.features.imagens_panoramicas){
            this.streetViewPointsLayer= {
            'id': 'street-view',
            'type': 'circle',
            'source': 'streetViewPointsSource',
            'visibility': 'none',
            'source-layer': config.map2d.streetViewPointsSourceLayer,
            'paint': {
                'circle-radius': 0,
                'circle-color': '#0d6efd',
                'circle-stroke-width': 0,
                'circle-stroke-color': '#0d6efd'
            }
        };

        this.streetViewLinesLayer= {
            'id': 'street-view-lines',
            'type': 'line',
            'source': config.map2d.streetViewLinesSourceLayer,
            'source-layer': 'fotos_linha',
            'paint': {
                'line-color': '#0d6efd',
                'line-width': 5
            }
        }
        };

    }

    onStreetViewKeyDown = (e) => {
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
            return;
        }

        const rotationSpeed = 0.1;
        let cameraRotated = false;

        switch (e.key) {
            case 'Escape':
                e.preventDefault();
                this.closeStreetView();
                break;

            case 'ArrowLeft':
            case 'a':
            case 'A':
                e.preventDefault();
                this.camera.rotation.y += rotationSpeed;
                cameraRotated = true;
                break;
            case 'ArrowRight':
            case 'd':
            case 'D':
                e.preventDefault();
                this.camera.rotation.y -= rotationSpeed;
                cameraRotated = true;
                break;
            case 'ArrowUp':
            case 'w':
            case 'W':
                e.preventDefault();
                this.camera.rotation.x = THREE.MathUtils.clamp(
                    this.camera.rotation.x + rotationSpeed,
                    -Math.PI / 2, Math.PI / 2
                );
                cameraRotated = true;
                break;
            case 'ArrowDown':
            case 's':
            case 'S':
                e.preventDefault();
                this.camera.rotation.x = THREE.MathUtils.clamp(
                    this.camera.rotation.x - rotationSpeed,
                    -Math.PI / 2, Math.PI / 2
                );
                cameraRotated = true;
                break;
        }

        if (cameraRotated) {
            this.setCurrentMouse();
        }
    }

    // Cached metadata loader for performance
    loadMetadataWithCache = async (name) => {
        if (this.metadataCache.has(name)) {
            return this.metadataCache.get(name);
        }

        const response = await fetch(`${this.METADATA_LOCATION}/${name}.json`);
        const data = await response.json();
        this.metadataCache.set(name, data);
        return data;
    }

    // Helper method for tracking document listeners
    addDocumentListener = (event, handler, options = false) => {
        document.addEventListener(event, handler, options);
        this.documentListeners.push({ event, handler, options });
    }

    // Remove all tracked document listeners
    removeAllDocumentListeners = () => {
        this.documentListeners.forEach(({ event, handler, options }) => {
            document.removeEventListener(event, handler, options);
        });
        this.documentListeners = [];
    }

    // Named method for mouse move instead of anonymous function
    onMouseMove = (event) => {
        event.preventDefault();
        this.mouse.x = (event.clientX / this.renderer.domElement.clientWidth) * 2 - 1;
        this.mouse.y = - (event.clientY / this.renderer.domElement.clientHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
    }

    // Complete Three.js cleanup method
    cleanupThreeJS = () => {
        // Stop animation loop
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        // Remove all document listeners
        this.removeAllDocumentListeners();

        // Cleanup Three.js resources
        if (this.scene) {
            // Clean arrows
            this.cleanArrows(this.arrows.map(i => i.arrow));
            this.arrows = [];

            // Clean main mesh
            if (this.mesh) {
                if (this.mesh.geometry) this.mesh.geometry.dispose();
                if (this.mesh.material) {
                    if (this.mesh.material.map) this.mesh.material.map.dispose();
                    this.mesh.material.dispose();
                }
                this.scene.remove(this.mesh);
                this.mesh = null;
            }

            // Clean controls
            if (this.controls) {
                this.controls.deactivate();
                this.controls = null;
            }
        }

        // Clean renderer
        if (this.renderer) {
            const container = document.getElementById('street-view-container');
            if (container && this.renderer.domElement.parentNode === container) {
                container.removeChild(this.renderer.domElement);
            }
            this.renderer.dispose();
            this.renderer = null;
        }

        // Clean cached resources
        if (this.arrowGeometry) {
            this.arrowGeometry.dispose();
            this.arrowGeometry = null;
        }
        if (this.arrowTexture) {
            this.arrowTexture.dispose();
            this.arrowTexture = null;
        }
        if (this.sphereGeometry) {
            this.sphereGeometry.dispose();
            this.sphereGeometry = null;
        }

        // Clean texture cache
        this.textureCache.forEach(texture => texture.dispose());
        this.textureCache.clear();

        // Clear metadata cache
        this.metadataCache.clear();

        // Clear PMTiles cache
        this.nearbyFeaturesCache.clear();

        // Reset state
        this.scene = null;
        this.camera = null;
        this.material = null;
    }


    loadData = async () => {
        try {
            if (!this.map.getSource(this.streetViewPointsLayer['source'])) {
                this.map.addSource(this.streetViewPointsLayer['source'], config.map2d.streetViewPointsSource);
                const onPhotosSourceData = (e) => {
                    if (e.sourceId === this.streetViewPointsLayer['source'] && this.map.isSourceLoaded(this.streetViewPointsLayer['source'])) {
                        if (!this.map.getLayer(this.streetViewPointsLayer['id'])) {
                            this.map.addLayer(this.streetViewPointsLayer);
                        }
                        this.showLayers();
                        this.map.off('sourcedata', onPhotosSourceData);
                    }
                };
                this.map.on('sourcedata', onPhotosSourceData);
            } else {
                this.showLayers();
            }


            if (!this.map.getSource(this.streetViewLinesLayer['source'])) {
                this.map.addSource(this.streetViewLinesLayer['source'], config.map2d.streetViewLinesSource);

                const onLinesSourceData = (e) => {
                    if (e.sourceId === this.streetViewLinesLayer['source'] && this.map.isSourceLoaded(this.streetViewLinesLayer['source'])) {
                        if (!this.map.getLayer(this.streetViewLinesLayer['id'])) {
                            this.map.addLayer(this.streetViewLinesLayer);
                        }
                        this.showLayers();
                        this.map.off('sourcedata', onLinesSourceData);
                    }
                };
                this.map.on('sourcedata', onLinesSourceData);
            } else {
                this.showLayers();
            }
        } catch (error) {
            console.error('Error loading PMTiles data:', error);
        }

    }

    getMeshRotationY = (data) => {
        return data.camera?.mesh_rotation_y ? data.camera.mesh_rotation_y : 270
    }

    onAdd(map) {
        this.map = map;

        if (typeof PMTiles !== 'undefined' && !this.map._pmtilesRegistered) {
            const protocol = new PMTiles.Protocol();
            maplibregl.addProtocol("pmtiles", protocol.tile);
            this.map._pmtilesRegistered = true;
        }
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl street-view-control controls-column-left';

        const button = document.createElement('button');
        button.setAttribute("id", "street-view-tool");
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.title = 'Adicionar imagens panorâmicas';
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_street_view_black.svg" />';
        button.onclick = () => this.toggleStreetView();

        this.container.appendChild(button);

        const isEnabled = config.features?.imagens_panoramicas ?? true;
        if (!isEnabled) {
            this.container.classList.add('disabled');
            button.disabled = true;
        }

        this.changeButtonColor()

        if (config.features.imagens_panoramicas){
            this.setupMiniMapWithPMTiles();
        }


        return this.container;
    }

    setupMiniMapWithPMTiles = async () => {
        this.miniMap.on('load', async () => {
            try {
                if (typeof PMTiles !== 'undefined') {
                    const protocol = new PMTiles.Protocol();
                    maplibregl.addProtocol("pmtiles", protocol.tile);
                }

                this.miniMap.addSource(this.streetViewPointsLayer['source'], config.map2d.streetViewPointsSource);

                const pointImage = await this.miniMap.loadImage('./street_view/point.png');
                await this.miniMap.addImage('point', pointImage.data);

                const pointSelectedImage = await this.miniMap.loadImage('./street_view/point-selected-v2.png');
                this.miniMap.addImage('point-selected', pointSelectedImage.data);

                this.miniMap.addLayer({
                    'id': 'points',
                    'type': 'symbol',
                    'source': this.streetViewPointsLayer['source'],
                    'source-layer': this.streetViewPointsLayer['source-layer'],
                    'layout': {
                        'icon-image': 'point'
                    }
                });

                this.miniMap.on('click', 'points', (e) => {
                    const properties = e.features[0].properties;
                    this.loadTarget(properties.nome_img, () => {
                        this.setIconDirection(this.currentInfo.camera.heading);
                    });
                });

                this.miniMap.on('mouseenter', 'points', () => {
                    this.miniMap.getCanvas().style.cursor = 'pointer';
                });

                this.miniMap.on('mouseleave', 'points', () => {
                    this.miniMap.getCanvas().style.cursor = '';
                });

                this.miniMap.getCanvas().addEventListener('mouseenter', () => {
                    this.miniMapHovered = true;
                });
                this.miniMap.getCanvas().addEventListener('mouseleave', () => {
                    this.miniMapHovered = false;
                });

            } catch (error) {
                console.error('Error setting up PMTiles minimap:', error);
            }
        });
    }

    changeButtonColor = () => {
        const btn = document.getElementById('street-view-tool');
        if (!btn) return;

        const isEnabled = config.features?.imagens_panoramicas ?? true;
        if (!isEnabled) {
            btn.innerHTML = '<img class="icon-sig-tool" src="./images/icon_street_view_gray.svg" />';
            return;
        }

        btn.innerHTML = '<img class="icon-sig-tool" src="./images/icon_street_view_black.svg" />';
        if (!this.isActive) return;
        btn.innerHTML = '<img class="icon-sig-tool" src="./images/icon_street_view_red.svg" />';
    }

    reload = async () => {
        if (this.isActive) {
            await this.loadData()
            this.showPhotos()
        }
    }

    onRemove() {
        this.cleanupThreeJS();
        this.container.parentNode.removeChild(this.container);
    }

    async activate() {
        const isEnabled = config.features?.imagens_panoramicas ?? true;
        if (!isEnabled) {
            return false;
        }

        if (this.isActive) {
            this.deactivate();
            return
        }
        const closeBtn = document.getElementById('close-street-view-button');
        if (closeBtn) closeBtn.addEventListener('click', this.closeStreetView);
        this.isActive = true;
        const btn = document.getElementById('street-view-tool');
        if (btn) btn.innerHTML = '<img class="icon-sig-tool" src="./images/icon_street_view_red.svg" />';
        await this.loadData()
        this.showPhotos()
    }

    toggleStreetView() {
        if (this.isActive) {
            this.deactivate();
        } else {
            this.activate();
        }
    }


    showPhotos = async () => {
        this.map.on('click', this.streetViewLinesLayer['id'], this.loadPoint);
        this.map.on('mouseenter', this.streetViewLinesLayer['id'], this.showHoverCursor);
        this.map.on('mouseleave', this.streetViewLinesLayer['id'], this.hideHoverCursor);

        if (this.miniMap.getLayer('selected')) {
            this.miniMap.removeLayer('selected');
        }
        this.miniMap.addLayer({
            'id': 'selected',
            'type': 'symbol',
            'source': this.streetViewPointsLayer['source'],
            'source-layer': this.streetViewPointsLayer['source-layer'],
            "filter": ["==", "nome_img", this.currentPhotoName || ""],
            'layout': {
                'icon-image': 'point-selected'
            }
        });
    }

    getNeighborFromPMTiles = async (point) => {
        try {
            const cacheKey = `${Math.round(point.lng * 1000)}_${Math.round(point.lat * 1000)}`;

            if (this.nearbyFeaturesCache.has(cacheKey)) {
                return this.nearbyFeaturesCache.get(cacheKey);
            }

            const pixelPoint = this.map.project([point.lng, point.lat]);

            const radius = 50;
            const bbox = [
                [pixelPoint.x - radius, pixelPoint.y - radius],
                [pixelPoint.x + radius, pixelPoint.y + radius]
            ];

            const features = this.map.queryRenderedFeatures(bbox, {
                layers: [this.streetViewPointsLayer['id']]
            });

            if (features.length === 0) {
                return await this.getNeighborWithBboxQuery(point);
            }

            const from = turf.point([point.lng, point.lat]);
            let minDistance = Infinity;
            let target = null;

            for (const feature of features) {
                const coords = feature.geometry.coordinates;
                const to = turf.point(coords);
                const distance = turf.distance(from, to);

                if (distance < minDistance) {
                    minDistance = distance;
                    target = feature;
                }
            }

            if (target) {
                this.nearbyFeaturesCache.set(cacheKey, target);
            }

            return target;

        } catch (error) {
            console.error('Error finding nearest neighbor:', error);
            return null;
        }
    }

    getNeighborWithBboxQuery = async (point) => {
        try {
            const bufferDistance = 0.001;
            const bbox = [
                point.lng - bufferDistance,
                point.lat - bufferDistance,
                point.lng + bufferDistance,
                point.lat + bufferDistance
            ];

            const features = this.map.querySourceFeatures(this.streetViewPointsLayer['source'], {
                sourceLayer: this.streetViewPointsLayer['source-layer'],
                bbox: bbox
            });

            if (features.length === 0) {
                return null;
            }

            const from = turf.point([point.lng, point.lat]);
            let minDistance = Infinity;
            let target = null;

            for (const feature of features) {
                const coords = feature.geometry.coordinates;
                const to = turf.point(coords);
                const distance = turf.distance(from, to);

                if (distance < minDistance) {
                    minDistance = distance;
                    target = feature;
                }
            }

            return target;

        } catch (error) {
            console.error('Error in bbox search:', error);
            return null;
        }
    }

    loadImageByName = async (name) => {
        const data = await this.loadMetadataWithCache(name);
        this.currentInfo = data
        this.loadStreetView(data)
        this.animate()
    };

    loadStreetView = (info) => {
        this.isOpen = true
        const container = document.getElementById('street-view-container');

        this.addDocumentListener('keydown', this.onStreetViewKeyDown);
        this.addDocumentListener('pointermove', this.setCurrentMouse, { passive: true });
        this.addDocumentListener('mousemove', this.onMouseMove, false);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, -0.1, 0)
        this.camera.rotation.order = 'YXZ';

        this.scene = new THREE.Scene();
        this.scene.add(this.camera)

        if (!this.sphereGeometry) {
            this.sphereGeometry = new THREE.SphereGeometry(500, 60, 40);
            this.sphereGeometry.scale(- 1, 1, 1);
        }

        this.setCurrentPhotoName(info.camera.img)

        const imagePath = `${this.IMAGES_LOCATION}/${info.camera.img}.jpg`;

        if (this.textureCache.has(imagePath)) {
            const texture = this.textureCache.get(imagePath);
            this.material = new THREE.MeshBasicMaterial({ map: texture });
            this.mesh = new THREE.Mesh(this.sphereGeometry, this.material);
            this.mesh.name = 'IMAGE_360';
        } else {
            const texture = new THREE.TextureLoader().load(
                imagePath,
                (loadedTexture) => {
                    loadedTexture.colorSpace = THREE.SRGBColorSpace;
                    this.textureCache.set(imagePath, loadedTexture);
                    if (this.material) {
                        this.material.map = loadedTexture;
                        this.material.needsUpdate = true;
                    }
                }
            );
            this.material = new THREE.MeshBasicMaterial({ map: texture });
            this.mesh = new THREE.Mesh(this.sphereGeometry, this.material);
            this.mesh.name = 'IMAGE_360';
        }

        this.setIconDirection(info.camera.heading)
        this.offsetRad = THREE.MathUtils.degToRad(this.getMeshRotationY(info) - info.camera.heading);
        this.mesh.rotation.y = this.offsetRad

        this.scene.add(this.mesh);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        container.appendChild(this.renderer.domElement);

        this.createControl()

        container.style.touchAction = 'none';
        container.addEventListener('pointerdown', this.onPointerDown);

        this.addDocumentListener('wheel', this.onDocumentMouseWheel, { passive: true });

        this.addDocumentListener('dragover', function (event) {

            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';

        });

        this.addDocumentListener('dragenter', function () {

            document.body.style.opacity = 0.5;

        });

        this.addDocumentListener('dragleave', function () {

            document.body.style.opacity = 1;

        });

        this.addDocumentListener('drop', function (event) {

            event.preventDefault();

            const reader = new FileReader();
            reader.addEventListener('load', function (event) {

                material.map.image.src = event.target.result;
                material.map.needsUpdate = true;

            });
            reader.readAsDataURL(event.dataTransfer.files[0]);

            document.body.style.opacity = 1;

        });

        window.addEventListener('resize', this.onWindowResize);

        const pt = turf.point([info.camera.lon, info.camera.lat])
        const distance = 50
        const bearing = info.camera.heading
        const destination = turf.rhumbDestination(pt, distance, bearing)
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

        if (this.miniMap.getLayer('selected')) {
            this.miniMap.setFilter('selected', ["==", "nome_img", this.currentPhotoName]);
        }

    }

    createControl = () => {
        this.cleanArrows(this.arrows.map(i => i.arrow));
        this.arrows = [];

        if (!this.arrowGeometry) {
            this.arrowGeometry = new THREE.CircleGeometry(0.5, 70);
        }
        if (!this.arrowTexture) {
            this.arrowTexture = new THREE.TextureLoader().load("./street_view/arrow.png");
        }

        const material = new THREE.MeshBasicMaterial({
            map: this.arrowTexture,
            side: THREE.DoubleSide,
            transparent: true
        });

        for (const target of this.currentInfo.targets) {
            const control = new THREE.Mesh(this.arrowGeometry, material);
            control.imgId = () => target.id;
            control.callback = () => this.loadTarget(target.id);
            this.arrows.push({ ...target, arrow: control });
            this.scene.add(control);
        }

        if (this.controls) this.controls.deactivate();
        this.controls = new DragControls(this.arrows.map(i => i.arrow), this.camera, this.renderer.domElement);
        this.controls.addEventListener('drag', (event) => {
            this.isDrag = true;
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

        this.updateArrowsVisibility();
    }

    clickObj = (event) => {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.arrows.filter(i => i.arrow.visible).map(i => i.arrow));
        if (intersects.length > 0) {
            intersects[0].object.callback();
        }
    }

    cleanArrows = (objects) => {
        for (const mesh of objects) {
            const object = this.scene.getObjectByProperty('uuid', mesh.uuid);
            if (!object) continue
            if (object.geometry !== this.arrowGeometry && object.geometry !== this.sphereGeometry) {
                object.geometry.dispose();
            }
            if (object.material && object.material.map &&
                object.material.map !== this.arrowTexture &&
                !Array.from(this.textureCache.values()).includes(object.material.map)) {
                object.material.dispose();
            }
            this.scene.remove(object);
        }
    }

    loadTarget = async (name, cb = () => { }) => {
        const data = await this.loadMetadataWithCache(name);
        this.currentInfo = data
        this.setCurrentMiniMap()
        this.createControl()
        this.setCurrentMouse()
        this.drawControl()
        this.setCurrentPhotoName(data.camera.img)

        const imagePath = `${this.IMAGES_LOCATION}/${data.camera.img}.jpg`;

        if (this.textureCache.has(imagePath)) {
            const texture = this.textureCache.get(imagePath);
            this.material.map = texture;
            this.offsetRad = THREE.MathUtils.degToRad(this.getMeshRotationY(data) - data.camera.heading);
            this.mesh.rotation.y = this.offsetRad;
            cb();
        } else {
            const texture = new THREE.TextureLoader().load(
                imagePath,
                (loadedTexture) => {
                    loadedTexture.colorSpace = THREE.SRGBColorSpace;
                    this.textureCache.set(imagePath, loadedTexture);
                    this.material.map = loadedTexture;
                    this.offsetRad = THREE.MathUtils.degToRad(this.getMeshRotationY(data) - data.camera.heading);
                    this.mesh.rotation.y = this.offsetRad;
                    cb();
                }
            );
        }
    };

    onPointerDown = (event) => {
        if (event.isPrimary === false || this.nextTarget) return;
        this.isUserInteracting = true;
        this.onPointerDownMouseX = event.clientX;
        this.onPointerDownMouseY = event.clientY;
        this.mouse.x = event.clientX / window.innerWidth * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects([this.scene.getObjectByName('IMAGE_360')], true);
        if (intersects.length > 0) {
            this.lastClickAt = intersects[0].point
        }
        document.addEventListener('pointermove', this.onPointerMove);
        document.addEventListener('pointerup', this.onPointerUp);
    }

    onPointerMove = (event) => {
        if (event.isPrimary === false || !this.isUserInteracting) return;
        const factor = 0.00005
        this.mouse.x = (this.onPointerDownMouseX - event.clientX) * factor
        this.mouse.y = (event.clientY - this.onPointerDownMouseY) * factor * 0.8
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects([this.scene.getObjectByName('IMAGE_360')], true);
        if (intersects.length > 0) {
            this.currentLookAt = intersects[0].point
        }
    }

    onPointerUp = (event) => {
        if (event.isPrimary === false) return;
        this.isUserInteracting = false;
        document.removeEventListener('pointermove', this.onPointerMove);
        document.removeEventListener('pointerup', this.onPointerUp);
    }

    onDocumentMouseWheel = (event) => {
        if (this.miniMapHovered || !this.isOpen) return

        const fov = this.camera.fov + event.deltaY * 0.05;
        this.camera.fov = THREE.MathUtils.clamp(fov, 10, 75);
        this.camera.updateProjectionMatrix();

        this.updateArrowsVisibility();
    }

    updateArrowsVisibility = () => {
        if (!this.arrows || this.arrows.length === 0) return;

        const HIDE_ARROWS_FOV = 35;
        const SCALE_ARROWS_FOV = 45;

        const currentFOV = this.camera.fov;

        this.arrows.forEach(item => {
            const arrow = item.arrow;

            if (currentFOV <= HIDE_ARROWS_FOV) {
                arrow.visible = false;
            } else if (currentFOV <= SCALE_ARROWS_FOV) {
                arrow.visible = true;
                const scaleFactor = (currentFOV - HIDE_ARROWS_FOV) / (SCALE_ARROWS_FOV - HIDE_ARROWS_FOV);
                const scale = 0.3 + (scaleFactor * 0.7);
                arrow.scale.setScalar(scale);
            } else {
                arrow.visible = true;
                arrow.scale.setScalar(1.0);
            }
        });
    }

    animate = () => {
        if (this.isOpen && this.isActive) {
            this.animationId = requestAnimationFrame(this.animate);
            this.update();
        } else {
            this.animationId = null;
        }
    }

    update = () => {
        const target = this.nextTarget || this.currentLookAt;
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
        const topBar = document.getElementById('top-bar');
        const mapSig = document.getElementById('map-sig');
        const miniMap = document.getElementById('mini-map-street-view');
        const streetViewContainer = document.getElementById('street-view-container');
        const closeBtn = document.getElementById('close-street-view-button');

        if (topBar) topBar.style.display = full ? 'flex' : 'none';
        if (mapSig) mapSig.style.display = full ? 'block' : 'none';
        if (miniMap) miniMap.style.display = full ? 'none' : 'block';
        if (streetViewContainer) streetViewContainer.style.display = full ? 'none' : 'block';
        if (closeBtn) closeBtn.style.display = full ? 'none' : 'flex';
    }

    onWindowResize = () => {
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
        const pt = turf.point([this.currentInfo.camera.lon, this.currentInfo.camera.lat])
        const buffered = turf.buffer(pt, 0.04)
        const bbox = turf.bbox(buffered)
        this.miniMap.fitBounds(bbox, {
            maxZoom: 15
        })
    }

    drawControl = () => {
        for (const [idx, item] of this.arrows.entries()) {
            const arrow = item.arrow;

            if (!arrow.visible) continue;

            const heading = this.camera.rotation.y;
            const radians = heading > 0 ? heading : (2 * Math.PI) + heading;
            const degrees = THREE.MathUtils.radToDeg(radians);
            const point1 = turf.point([this.currentInfo.camera.lon, this.currentInfo.camera.lat]);
            const point2 = turf.point([item.lon, item.lat]);
            const bearing = (turf.rhumbBearing(point1, point2) + degrees + 360) % 360;

            const center = turf.point([0, -0.4]);
            const distance = this.queryMobile.matches ? 55 : 35;
            const destination = turf.rhumbDestination(center, distance, bearing);

            const vector = new THREE.Vector3(
                destination.geometry.coordinates[0],
                destination.geometry.coordinates[1],
                0.5
            );

            vector.unproject(this.camera);
            const dir = vector.sub(this.camera.position).normalize();
            const distanceFromCamera = 5;
            const pos = this.camera.position.clone().add(dir.multiplyScalar(distanceFromCamera));
            arrow.position.copy(pos);
            arrow.lookAt(this.camera.position);
            arrow.rotation.z -= THREE.MathUtils.degToRad(bearing);

        }
    }

    loadPoint = async (e) => {
        try {
            let feature = await this.getNeighborFromPMTiles(e.lngLat);

            if (!feature) {
                feature = await this.getNeighborWithBboxQuery(e.lngLat);
            }

            if (feature && feature.properties && feature.properties.nome_img) {
                this.setFullMap(false);

                if (this.scene) {
                    this.loadTarget(feature.properties.nome_img);
                    return;
                }

                this.loadImageByName(feature.properties.nome_img);
            } else {
                console.warn('No photo found near clicked point');
            }

        } catch (error) {
            console.error('Error loading point:', error);
        }
    }

    showHoverCursor = () => {
        this.map.getCanvas().style.cursor = 'pointer';
    }

    hideHoverCursor = () => {
        this.map.getCanvas().style.cursor = '';
    }

    deactivate = () => {
        this.isActive = false;
        this.changeButtonColor()
        this.map.getCanvas().style.cursor = '';
        this.hidePhotos()
        const closeBtn = document.getElementById('close-street-view-button');
        if (closeBtn) closeBtn.removeEventListener('click', this.closeStreetView);
        if (this.isOpen) {
            this.setFullMap(true);
            this.isOpen = false;
        }
        this.cleanupThreeJS()
    }

    closeStreetView = () => {
        this.setFullMap(true)
        this.isOpen = false
        this.cleanupThreeJS()
    }


    hidePhotos = () => {
        this.map.off('click', this.streetViewLinesLayer['id'], this.loadPoint);
        this.map.off('mouseenter', this.streetViewLinesLayer['id'], this.showHoverCursor);
        this.map.off('mouseleave', this.streetViewLinesLayer['id'], this.hideHoverCursor);


        if (this.map.getLayer(this.streetViewPointsLayer['id'])) {
            this.map.setLayoutProperty(this.streetViewPointsLayer['id'], 'visibility', 'none');
        }
        if (this.map.getLayer(this.streetViewLinesLayer['id'])) {
            this.map.setLayoutProperty(this.streetViewLinesLayer['id'], 'visibility', 'none');
        }
    }

    showLayers = () => {
        if (this.map.getLayer(this.streetViewPointsLayer['id'])) {
            this.map.setLayoutProperty(this.streetViewPointsLayer['id'], 'visibility', 'visible');
        }

        if (this.map.getLayer(this.streetViewLinesLayer['id'])) {

            this.map.setLayoutProperty(this.streetViewLinesLayer['id'], 'visibility', 'visible');
        } else {
            this.map.addLayer(this.streetViewLinesLayer);

            this.map.setLayoutProperty(this.streetViewLinesLayer['id'], 'visibility', 'visible');
        }
    }

    clearCache = () => {
        this.nearbyFeaturesCache.clear();
    }

    handleMapClick(e) {

    }

    handleMouseDown(e) {

    }
}

export default AddStreetViewControl;
