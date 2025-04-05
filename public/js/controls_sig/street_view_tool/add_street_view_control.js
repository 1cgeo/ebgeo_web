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

        this.animate = this.animate.bind(this);
        this.update = this.update.bind(this);
        this.onPointerMove = this.onPointerMove.bind(this);
        this.onPointerUp = this.onPointerUp.bind(this);
        this.onDocumentMouseWheel = this.onDocumentMouseWheel.bind(this);
        this.setCurrentMouse = this.setCurrentMouse.bind(this);
    }

    loadData = async () => {
        this.photosGeojson = await $.getJSON("/street_view/fotos.geojson")
        this.photosLinhasGeoJson = await $.getJSON("/street_view/fotos_linha.geojson")
        this.centroid = turf.centroid(this.photosGeojson)

        try {
            this.map.getSource('lines-street-view').setData(this.photosLinhasGeoJson);

        } catch (error) {

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
        $('input[name="base-layer"]').on('change', this.changeButtonColor);
        $('input[name="base-layer"]').on('change', this.reload);
        return this.container;
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
        this.container.parentNode.removeChild(this.container);
    }

    async activate() {
        if (this.isActive) {
            this.toolManager.deactivateCurrentTool();
            return
        }
        $('#close-street-view-button').on('click', this.closeStreetView)
        this.isActive = true;
        $("#street-view-tool").empty().append('<img class="icon-sig-tool" src="./images/icon_street_view_red.svg" />');
        await this.loadData()
        this.showPhotos()
    }

    showPhotos = async () => {

        this.map.on('click', 'street-view', this.loadPoint);

        this.map.on('touchend', 'street-view', this.loadPoint);

        this.map.on('mouseenter', 'street-view', this.showHoverCursor);

        this.map.on('mouseleave', 'street-view', this.hideHoverCursor);

        // this.map.flyTo({
        //     center: centroid.geometry.coordinates
        // });

        this.miniMap = new maplibregl.Map({
            container: 'mini-map-street-view',
            style: '/street_view/street-view-map-style.json',
            center: this.centroid.geometry.coordinates,
            attributionControl: false,
            zoom: 12.5,
            minZoom: 11,
            maxZoom: 17.9
        });

        let pointImage = await this.miniMap.loadImage('/street_view/point.png')
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

        let pointSelectedImage = await this.miniMap.loadImage('/street_view/point-selected-v2.png')
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
            this.animate()
        });
    }

    loadStreetView = (info) => {
        this.isOpen = true
        const container = document.getElementById('street-view-container');

        document.addEventListener('pointermove', this.setCurrentMouse, { passive: true });
        document.addEventListener('mousemove', (event) => {
            event.preventDefault();
            this.mouse.x = (event.clientX / this.renderer.domElement.clientWidth) * 2 - 1;
            this.mouse.y = - (event.clientY / this.renderer.domElement.clientHeight) * 2 + 1;
            this.raycaster.setFromCamera(this.mouse, this.camera);
            var intersects = this.raycaster.intersectObjects(this.arrows.filter(i => i.arrow.visible).map(i => i.arrow));
            if (intersects.length > 0) {
                //console.log(intersects[0].object.imgId())
            }
        }, false);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        //camera.rotation.reorder("YXZ");
        this.camera.position.set(0, -0.1, 0)
        this.camera.rotation.order = 'YXZ';

        this.scene = new THREE.Scene();
        this.scene.add(this.camera)

        const geometry = new THREE.SphereGeometry(500, 60, 40);
        geometry.scale(- 1, 1, 1);
        this.setCurrentPhotoName(info.camera.img)
        let texture = new THREE.TextureLoader().load(
            `${this.IMAGES_LOCATION}/${info.camera.img}.jpg`
        );
        texture.colorSpace = THREE.SRGBColorSpace
        this.material = new THREE.MeshBasicMaterial({ map: texture });
        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.name = 'IMAGE_360';

        this.setIconDirection(info.camera.heading)
        this.offsetRad = THREE.MathUtils.degToRad(info.camera.fix_heading);
        this.mesh.rotation.y = this.offsetRad

        this.scene.add(this.mesh);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        container.appendChild(this.renderer.domElement);

        ///
        this.createControl()

        container.style.touchAction = 'none';
        container.addEventListener('pointerdown', this.onPointerDown);
        //container.addEventListener('pointerdown', clickObj);

        document.addEventListener('wheel', this.onDocumentMouseWheel, { passive: true });

        //

        document.addEventListener('dragover', function (event) {

            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';

        });

        document.addEventListener('dragenter', function () {

            document.body.style.opacity = 0.5;

        });

        document.addEventListener('dragleave', function () {

            document.body.style.opacity = 1;

        });

        document.addEventListener('drop', function (event) {

            event.preventDefault();

            const reader = new FileReader();
            reader.addEventListener('load', function (event) {

                material.map.image.src = event.target.result;
                material.map.needsUpdate = true;

            });
            reader.readAsDataURL(event.dataTransfer.files[0]);

            document.body.style.opacity = 1;

        });

        //
        window.addEventListener('resize', this.onWindowResize);


        /////
        //addCube(info)

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
        let long = found.geometry.coordinates[0]
        let lat = found.geometry.coordinates[1]
        this.miniMap.setCenter([long, lat]);

    }

    createControl = () => {
        this.cleanArrows(this.arrows.map(i => i.arrow))
        this.arrows = []

        const geometry = new THREE.CircleGeometry(0.5, 70);
        const texture = new THREE.TextureLoader().load("/street_view/arrow.png");
        const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true });

        for (let target of this.currentInfo.targets) {
            const control = new THREE.Mesh(geometry, material);
            control.imgId = () => target.id;
            control.callback = () => this.loadTarget(target.id);
            this.arrows.push({ ...target, arrow: control });
            this.scene.add(control);
        }

        if (this.controls) this.controls.deactivate()
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

    clickObj = (event) => {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        var intersects = this.raycaster.intersectObjects(this.arrows.filter(i => i.arrow.visible).map(i => i.arrow));
        if (intersects.length > 0) {
            intersects[0].object.callback();
        }
    }

    cleanArrows = (objects) => {
        for (let mesh of objects) {
            const object = this.scene.getObjectByProperty('uuid', mesh.uuid);
            if (!object) continue
            object.geometry.dispose();
            object.material.dispose();
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
            let texture = new THREE.TextureLoader().load(
                `${this.IMAGES_LOCATION}/${data.camera.img}.jpg`,
                (texture) => {
                    texture.colorSpace = THREE.SRGBColorSpace
                    this.material.map = texture
                    this.offsetRad = THREE.MathUtils.degToRad(data.camera.fix_heading);
                    this.mesh.rotation.y = this.offsetRad
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
        this.raycaster.setFromCamera(this.mouse, this.camera);
        var intersects = this.raycaster.intersectObjects([this.scene.getObjectByName('IMAGE_360')], true);
        if (intersects.length > 0) {
            this.lastClickAt = intersects[0].point
        }
        document.addEventListener('pointermove', this.onPointerMove);
        document.addEventListener('pointerup', this.onPointerUp);
    }

    onPointerMove = (event) => {
        if (event.isPrimary === false || !this.isUserInteracting) return;
        let factor = (0.00005 * 1768) / window.innerWidth
        this.mouse.x = (this.onPointerDownMouseX - event.clientX) * factor
        this.mouse.y = (event.clientY - this.onPointerDownMouseY) * factor * 0.8
        this.raycaster.setFromCamera(this.mouse, this.camera);
        var intersects = this.raycaster.intersectObjects([this.scene.getObjectByName('IMAGE_360')], true);
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
        if ($('#mini-map-street-view:hover').length == 1 || !this.isOpen) return
        const fov = this.camera.fov + event.deltaY * 0.05;
        this.camera.fov = THREE.MathUtils.clamp(fov, 10, 75);
        this.camera.updateProjectionMatrix();
    }

    animate = () => {
        requestAnimationFrame(this.animate)
        this.update()
    }

    update = () => {
        let target = this.nextTarget || this.currentLookAt;
        if (target) {
            this.setCurrentMouse()
            this.drawControl()
            this.setCurrentMouse()
            this.camera.lookAt(target.x, THREE.MathUtils.clamp(target.y, -360, 250), target.z);
            
        }
        this.nextTarget = null
        this.currentLookAt = null
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
        var pt = turf.point([this.currentInfo.camera.lon, this.currentInfo.camera.lat])
        var buffered = turf.buffer(pt, 0.04)
        var bbox = turf.bbox(buffered)
        this.miniMap.fitBounds(bbox)
        //miniMap2.zoomTo(19, {duration: 2000})
    }

    drawControl = () => {
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
        $('#close-street-view-button').off('click', this.closeStreetView)
    }

    closeStreetView = () => {
        this.setFullMap(true)
        this.isOpen = false
    }

    hidePhotos = () => {
        this.map.off('click', 'street-view', this.loadPoint);

        this.map.off('mouseenter', 'street-view', this.showHoverCursor);

        this.map.off('mouseleave', 'street-view', this.hideHoverCursor);


        this.map.getSource('lines-street-view').setData({
            type: 'FeatureCollection',
            features: []
        });
    }

    handleMapClick(e) {

    }

    handleMouseDown(e) {

    }
}

export default AddStreetViewControl;
