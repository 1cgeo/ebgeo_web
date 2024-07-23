import * as THREE from 'three';
import { DragControls } from 'DragControls';

const IMAGES_LOCATION = "/street_view/IMG"
const METADATA_LOCATION = "/street_view/METADATA"
const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);

var camera, _camera, scene, renderer, offsetRad, material, mesh, control, controls;
var arrows = []
var nextTarget = null
var lastClickAt = null
var currentLookAt = null
var objects = []
var isUserInteracting = false,
    onPointerDownMouseX = 0, onPointerDownMouseY = 0;
var currentHoveElement = null
var raycaster = new THREE.Raycaster();
var mouse = new THREE.Vector2();
var currentHeading
var currentMouseLocation = { x: 0, y: 0 }
var currentInfo
var currentPhotoName = ''
var nextPhotoTarget
var imageName = urlParams.get('image')
var isDrag = false
var map
var miniMap2
var photosGeojson
var photosLinhasGeoJson

$('#mini-map').css({
    display: 'none'
});

var photos = {}

// if (imageName) {
//     loadImageByName(imageName)
// }

const setCurrentPhotoName = (name) => {
    currentPhotoName = name
    miniMap2.setFilter(
        'selected',
        [
            "all",
            [
                "==",
                "nome_img",
                currentPhotoName
            ]
        ],
    );
    let found = photos.features.find(item => item.properties.nome_img == currentPhotoName)
    let long = found.geometry.coordinates[0]
    let lat = found.geometry.coordinates[1]
    miniMap2.setCenter([long, lat]);

}

const loadImageByName = (name) => {
    console.log(name)
    $.getJSON(`${METADATA_LOCATION}/${name}.json`, function (data) {
        currentInfo = data
        init(data);
        animate();
    });
}

const setCurrentHoveElement = (name) => {
    currentHoveElement = name
    map.scrollZoom.enable();
    if (currentHoveElement != 'map') {
        map.scrollZoom.disable();
    }
}

module.setCurrentHoveElement = setCurrentHoveElement

const calculateTargetPositionInMeters = (
    cameraLocation,
    targetLocation
) => {
    const cameraLocationGeojson = turf.point([
        cameraLocation.longitude,
        cameraLocation.latitude
    ]);
    // x
    const xDest = {
        longitude: targetLocation.longitude,
        latitude: cameraLocation.latitude
    };

    const xDestGeojson = turf.point([xDest.longitude, xDest.latitude]);

    // TODO: turf??
    // let x = computeDistanceMeters(cameraLocation, xDest);
    let x = turf.distance(cameraLocationGeojson, xDestGeojson);
    x = x * 1000
    x *= targetLocation.longitude > cameraLocation.longitude ? 1 : -1;

    // console.log("x", x);
    // z
    const zDest = {
        longitude: cameraLocation.longitude,
        latitude: targetLocation.latitude
    };
    const zDestGeojson = turf.point([zDest.longitude, zDest.latitude]);

    // TODO: turf??
    // let z = computeDistanceMeters(cameraLocation, zDest);
    let z = turf.distance(cameraLocationGeojson, zDestGeojson);
    z = z * 1000
    z *= targetLocation.latitude > cameraLocation.latitude ? -1 : 1;



    // console.log("z", z);

    // console.log(targetLocation.latitude > cameraLocation.latitude);


    return [x, 0, z]; // [x, y, z]
};

const removeSceneObjects = (objects) => {
    for (let mesh of objects) {
        const object = scene.getObjectByProperty('uuid', mesh.uuid);
        object.geometry.dispose();
        object.material.dispose();
        scene.remove(object);
    }
}

const cleanArrows = (objects) => {
    for (let mesh of objects) {
        const object = scene.getObjectByProperty('uuid', mesh.uuid);
        object.geometry.dispose();
        object.material.dispose();
        scene.remove(object);
    }
}

const loadTarget = (name, cb = () => { }) => {
    console.log(name)
    removeSceneObjects(objects)
    objects = []

    $.getJSON(`${METADATA_LOCATION}/${name}.json`, (data) => {

        // let lastCurrentInfo = currentInfo
        currentInfo = data
        setCurrentMiniMap()
        createControll()
        setCurrentMouse()
        drawControl()
        setCurrentMouse()

        // var offset
        // let last = nearestPointOnLine(lastCurrentInfo.camera, photosLinhasGeoJson)
        // let current = nearestPointOnLine(currentInfo.camera, photosLinhasGeoJson)

        // var point1 = current
        // var point2 = last
        // offset = (turf.rhumbBearing(point1, point2) + 360) % 360
        // offsetRad = THREE.MathUtils.degToRad(offset)
        setCurrentPhotoName(data.camera.img)
                //asdfasd
        // let texture = new THREE.TextureLoader().load(
        //     `${IMAGES_LOCATION}/${info.camera.img}.jpg`
        // );
    
        // material = new THREE.MeshBasicMaterial({ map: texture });
        // scene.remove( scene.getObjectByProperty( 'uuid', mesh ) );

        // mesh = new THREE.Mesh(geometry, material);
        // mesh.name = 'IMAGE_360';
        // offsetRad = THREE.MathUtils.degToRad(info.camera.fix_heading);
        // mesh.rotation.y = offsetRad
    
        // scene.add(mesh);
        //asdfsadf
        let texture = new THREE.TextureLoader().load(
            `${IMAGES_LOCATION}/${data.camera.img}.jpg`,
            (texture) => {
                material.map = texture
                //mesh.rotation.y = currentInfo.camera.heading
                //addCube(data);
                //nextTarget = lastClickAt
                offsetRad = THREE.MathUtils.degToRad(data.camera.fix_heading);
                mesh.rotation.y = offsetRad
                // objects.forEach(mesh => mesh.quaternion.copy(camera.quaternion))
                // renderer.render(scene, camera);
                cb()
            },
        );

    });

}

const addCube = (info) => {
    for (let target of info.targets) {
        const [x, y, z] = calculateTargetPositionInMeters(
            {
                latitude: info.camera.lat,
                longitude: info.camera.lon
            },
            {
                latitude: target.lat,
                longitude: target.lon
            }
        )
        //const geom = new THREE.CircleGeometry(0.5, 70);
        const geom = target.icon ? new THREE.PlaneGeometry(1.3, 1) : new THREE.CircleGeometry(0.5, 70);
        let texture = new THREE.TextureLoader().load(
            `${target.icon ? target.icon : "arrow"}.png`
        );
        let material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
        material.transparent = true
        var mesh = new THREE.Mesh(geom, material);
        mesh.quaternion.copy(camera.quaternion);
        /* offsetRad = THREE.MathUtils.degToRad(-75);
        mesh.rotation.x = offsetRad */
        mesh.position.set(x, y, z);
        scene.add(mesh);
        mesh.callback = () => { loadTarget(target.id); }
        objects.push(mesh)
        if (!lastClickAt && target.next) {
            nextTarget = { x, y, z }
        }
    }
}

const createControll = () => {
    cleanArrows(arrows.map(i => i.arrow))
    arrows = []
    for (let target of currentInfo.targets) {
        const geom = new THREE.CircleGeometry(0.5, 70)
        let texture = new THREE.TextureLoader().load(
            `arrow.png`
        );
        let material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
        material.transparent = true
        control = new THREE.Mesh(geom, material);
        //control.rotation.x = Math.PI / 2;
        control.imgId = () => target.id
        arrows.push({
            ...target,
            arrow: control
        })
        control.callback = () => { loadTarget(target.id); }
        scene.add(control)


    }
    if(controls) controls.deactivate()
    controls = new DragControls(arrows.map(i => i.arrow), camera, renderer.domElement);
    controls.addEventListener('drag', function (event) {
        isDrag = true

    });
    controls.addEventListener('dragstart', function (event) {

        isDrag = false

    });
    controls.addEventListener('dragend', function (event) {
        console.log('click')
        if (!isDrag) {
            clickObj()
        }

    });


}

function init(info) {
    const container = document.getElementById('container');
    document.addEventListener('pointermove', setCurrentMouse);
    document.addEventListener('mousemove', (event) => {
        event.preventDefault();

        mouse.x = (event.clientX / renderer.domElement.clientWidth) * 2 - 1;
        mouse.y = - (event.clientY / renderer.domElement.clientHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        var intersects = raycaster.intersectObjects(arrows.filter(i => i.arrow.visible).map(i => i.arrow));
        if (intersects.length > 0) {
            console.log(intersects[0].object.imgId())
        }
    }, false);




    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    //camera.rotation.reorder("YXZ");
    camera.position.set(0, -0.1, 0)
    camera.rotation.order = 'YXZ';
    _camera = camera.clone()

    scene = new THREE.Scene();
    scene.add(camera)

    const geometry = new THREE.SphereGeometry(500, 60, 40);
    // invert the geometry on the x-axis so that all of the faces point inward
    geometry.scale(- 1, 1, 1);
    setCurrentPhotoName(info.camera.img)
    let texture = new THREE.TextureLoader().load(
        `${IMAGES_LOCATION}/${info.camera.img}.jpg`
    );

    material = new THREE.MeshBasicMaterial({ map: texture });
    mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'IMAGE_360';

    setIconDirection(info.camera.heading)
    offsetRad = THREE.MathUtils.degToRad(info.camera.fix_heading);
    mesh.rotation.y = offsetRad

    scene.add(mesh);

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    ///
    createControll()

    container.style.touchAction = 'none';
    container.addEventListener('pointerdown', onPointerDown);
    //container.addEventListener('pointerdown', clickObj);

    document.addEventListener('wheel', onDocumentMouseWheel);

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
    window.addEventListener('resize', onWindowResize);


    /////
    //addCube(info)

    var pt = turf.point([info.camera.lon, info.camera.lat])
    var distance = 50
    var bearing = info.camera.heading
    var destination = turf.rhumbDestination(pt, distance, bearing)
    const [x, y, z] = calculateTargetPositionInMeters(
        {
            latitude: info.camera.lat,
            longitude: info.camera.lon
        },
        {
            latitude: destination.geometry.coordinates[1],
            longitude: destination.geometry.coordinates[0]
        }
    )
    camera.lookAt(x, y, z)
    objects.forEach(mesh => mesh.quaternion.copy(camera.quaternion))
    renderer.render(scene, camera);
    setCurrentMiniMap()
    setCurrentMouse()
    drawControl()
    setCurrentMouse()

}

const setCurrentMiniMap = () => {
    var pt = turf.point([currentInfo.camera.lon, currentInfo.camera.lat])
    var buffered = turf.buffer(pt, 0.04)
    var bbox = turf.bbox(buffered)
    miniMap2.fitBounds(bbox)
    //miniMap2.zoomTo(19, {duration: 2000})
}

function setCurrentMouse(event) {

    const heading = camera.rotation.y;
    const radians = heading > 0 ? heading : (2 * Math.PI) + heading;
    let degrees = THREE.MathUtils.radToDeg(radians);
    degrees = -1 * degrees
    currentHeading = (degrees + 360) % 360
    setIconDirection(currentHeading)
}

function getNextTargetByMouse() {
    var distance = 5;
    var destination = turf.rhumbDestination(turf.point([currentInfo.camera.lon, currentInfo.camera.lat]), distance, currentHeading)
    var minDistance
    var selection
    for (let target of currentInfo['targets']) {
        let distance = turf.distance(turf.point([target.lon, target.lat]), destination)
        if (!minDistance || distance < minDistance) {
            minDistance = distance
            selection = {
                "id": target.id,
                "img": target.img,
                "lon": target.lon,
                "lat": target.lat
            }
        }
    }
    return selection
}

function drawControl() {
    for (let [idx, item] of arrows.entries()) {
        let arrow = item.arrow
        const heading = camera.rotation.y;
        const radians = heading > 0 ? heading : (2 * Math.PI) + heading;
        let degrees = THREE.MathUtils.radToDeg(radians);
        var point1 = turf.point([currentInfo.camera.lon, currentInfo.camera.lat])
        var point2 = turf.point([item.lon, item.lat])
        var bearing = (turf.rhumbBearing(point1, point2) + degrees + 360) % 360
        let center = turf.point([0, -0.4])
        var distance = 35
        var destination = turf.rhumbDestination(center, distance, bearing)
        var vector = new THREE.Vector3(
            destination.geometry.coordinates[0],
            destination.geometry.coordinates[1],
            0.5
        )
        //control.visible = vector.y <= -0.15 ? true : false
        vector.unproject(camera);
        var dir = vector.sub(camera.position).normalize();
        var distance = 5;
        var pos = camera.position.clone().add(dir.multiplyScalar(distance));
        arrow.position.copy(pos);
        arrow.lookAt(camera.position);
        arrow.rotation.z -= THREE.MathUtils.degToRad(bearing)
    }
}

function setIconDirection(degrees) {
    if (miniMap2) miniMap2.setLayoutProperty('selected', 'icon-rotate', degrees)
    //if (map) map.setLayoutProperty('selected', 'icon-rotate', degrees)
}

function clickObj(event) {
    // console.log('NEXT')
    // event.preventDefault();

    // mouse.x = (event.clientX / renderer.domElement.clientWidth) * 2 - 1;
    // mouse.y = - (event.clientY / renderer.domElement.clientHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    var intersects = raycaster.intersectObjects(arrows.filter(i => i.arrow.visible).map(i => i.arrow));

    if (intersects.length > 0) {
        intersects[0].object.callback();

    }

}


function onWindowResize() {

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);

}

function onPointerDown(event) {
    if (event.isPrimary === false || nextTarget) return;

    isUserInteracting = true;

    onPointerDownMouseX = event.clientX;
    onPointerDownMouseY = event.clientY;

    mouse.x = event.clientX / window.innerWidth * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    var intersects = raycaster.intersectObjects([scene.getObjectByName('IMAGE_360')], true);
    if (intersects.length > 0) {
        lastClickAt = intersects[0].point
    }
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);

}

function onPointerMove(event) {

    if (event.isPrimary === false || !isUserInteracting) return;

    mouse.x = (onPointerDownMouseX - event.clientX) * 0.00005
    mouse.y = (event.clientY - onPointerDownMouseY) * 0.00005
    raycaster.setFromCamera(mouse, camera);
    var intersects = raycaster.intersectObjects([scene.getObjectByName('IMAGE_360')], true);
    if (intersects.length > 0) {
        currentLookAt = intersects[0].point
    }



}

function onPointerUp(event) {

    if (event.isPrimary === false) return;

    isUserInteracting = false;

    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);

}

function onDocumentMouseWheel(event) {
    if (currentHoveElement != 'street') return
    const fov = camera.fov + event.deltaY * 0.05;

    camera.fov = THREE.MathUtils.clamp(fov, 10, 75);

    camera.updateProjectionMatrix();

}

function animate() {
    requestAnimationFrame(animate);
    update();
    //controls.update();
}

function update() {
    let target = nextTarget ? nextTarget : currentLookAt ? currentLookAt : null
    if (target) {
        setCurrentMouse()
        drawControl()
        setCurrentMouse()

        camera.lookAt(target.x, target.y, target.z);
        nextTarget = null
        currentLookAt = null
    }
    objects.forEach(mesh => mesh.quaternion.copy(camera.quaternion))
    


    renderer.render(scene, camera);

}

// map.on('mouseup', () => {
//     // console.log(map.getZoom())
//     // let bounds = map.getBounds()
//     // console.log([
//     //     [bounds._sw.lng, bounds._sw.lat],
//     //     [bounds._ne.lng, bounds._ne.lat]
//     // ])
//     // console.log(map.getCenter())
// });

const setFullMap = (full) => {
    $('#map').css({
        display: full ? 'block' : 'none'
    });
    $('#mini-map').css({
        display: full ? 'none' : 'block'
    });
}





// $.getJSON("fotos.geojson", function (json) {




// });

const nearestPointOnLine = (point, line) => {
    return turf.nearestPoint(turf.point([point.lon, point.lat]), photos);
}

const getNeighbor = (point, points) => {
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

const getPositionTargets = () => {
    let refX = currentInfo.camera.lon
    let refY = currentInfo.camera.lat

    var center = turf.point([refX, refY]);

    var radius = 10;

    var sector1 = turf.sector(center, radius, currentHeading + 270, currentHeading + 90);

    function yFromX(point1, point2, x) {
        var gradient = (point2.y - point1.y) / (point2.x - point1.x);
        var intercept = point1.y - (gradient * point1.x);
        return gradient * x + intercept;
    }

    var distance = 10;
    var destination1 = turf.destination(center, distance, currentHeading);
    var destination2 = turf.destination(center, distance, currentHeading + 180);
    let line1 = turf.lineString(
        [
            [refX, refY],
            destination1.geometry.coordinates
        ]
    )
    let line2 = turf.lineString(
        [
            [refX, refY],
            destination2.geometry.coordinates
        ]
    )

    let front = []
    let right = []
    let back = []
    let left = []

    let values = []
    for (let target of currentInfo.targets) {
        let distanceFront = turf.pointToLineDistance(point, line1)
        let distanceBack = turf.pointToLineDistance(point, line2)

        values.push(
            {
                ...target,
                distanceFront,
                distanceBack,
                isFront: turf.booleanPointInPolygon(point, sector1)
            }
        )
    }


    front = [
        values
            .filter(i => i.isFront)
            .reduce(function (prev, curr) {
                return (prev.distanceFront < curr.distanceFront) ? prev : curr;
            })
    ]
    back = [
        values
            .filter(i => !i.isFront)
            .reduce(function (prev, curr) {
                return (prev.distanceBack < curr.distanceBack) ? prev : curr;
            })
    ]

    // if f(x1) > y1 it means, that(x1, y1) below the line.

    // if f(x1) < y1 means point(x1, y1) above the line.

    // if f(x1) = y1 - point on a line.

    // right = [
    //     values
    //         .filter(i => !front.concat(back).map(a => a.id).includes(i.id))
    //         .map(i => {
    //             return {
    //                 ...i,
    //                 fx1: yFromX(
    //                     { x: destination1.geometry.coordinates[0], y: destination1.geometry.coordinates[1] },
    //                     { x: destination2.geometry.coordinates[0], y: destination2.geometry.coordinates[1] },
    //                     i.lon
    //                 )
    //             }
    //         })
    //         .find(i => i.fx1 < i.lat)
    // ]

    // left = values
    //     .find(i => !front.concat(back).concat(left).map(a => a.id).includes(i.id))
    return [
        front,
        right,
        back,
        left
    ]
}

const main = async () => {
    photos = await $.getJSON("fotos.geojson")
    photosGeojson = photos

    photosLinhasGeoJson = await $.getJSON("fotos_linha.geojson")

    const centroid = turf.centroid(photos)
    map = new maplibregl.Map({
        container: 'map',
        style: 'map-style.json',
        center: centroid.geometry.coordinates,
        zoom: 12.5
    });

    miniMap2 = new maplibregl.Map({
        container: 'mini-map',
        style: 'map-style.json',
        center: centroid.geometry.coordinates,
        zoom: 12.5
    });

    map.on('load', function () {

        map.loadImage(
            '/point.png',
            function (error, image) {
                if (error) throw error;
                map.addImage('point', image);

                map.addSource('points', {
                    'type': 'geojson',
                    'data': photos
                });

                map.addSource('linhas', {
                    'type': 'geojson',
                    'data': photosLinhasGeoJson
                });

                // map.addLayer({
                //     'id': 'points',
                //     'type': 'symbol',
                //     'source': 'points',
                //     'layout': {
                //         'icon-image': 'point'
                //     }
                // });
                map.addLayer({
                    'id': 'linhas',
                    'type': 'line',
                    'source': 'linhas',
                    'layout': {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    'paint': {
                        'line-color': '#0d6efd',
                        'line-width': 2
                    }
                });

                map.on('click', 'linhas', function (e) {
                    let f = getNeighbor(e.lngLat, photosGeojson.features)
                    setFullMap(false)
                    if (scene) {
                        loadTarget(f.properties.nome_img)
                        return
                    }

                    loadImageByName(f.properties.nome_img)

                });

                map.on('mouseenter', 'linhas', function () {
                    map.getCanvas().style.cursor = 'pointer';
                });

                map.on('mouseleave', 'linhas', function () {
                    map.getCanvas().style.cursor = '';
                });
            }
        );

        map.loadImage(
            '/point-selected-v2.png',
            function (error, image) {
                map.addImage('point-selected', image);
                map.addSource('selected', {
                    'type': 'geojson',
                    'data': photos
                });
                map.addLayer({
                    'id': 'selected',
                    'type': 'symbol',
                    'source': 'selected',
                    "filter": [
                        "all",
                        [
                            "==",
                            "nome_img",
                            currentPhotoName
                        ]
                    ],
                    'layout': {
                        'icon-image': 'point-selected'
                    }
                });
            }
        )


    });


    miniMap2.on('load', function () {

        miniMap2.loadImage(
            '/point.png',
            function (error, image) {
                if (error) throw error;
                miniMap2.addImage('point', image);

                miniMap2.addSource('points', {
                    'type': 'geojson',
                    'data': photos
                });

                miniMap2.addLayer({
                    'id': 'points',
                    'type': 'symbol',
                    'source': 'points',
                    'layout': {
                        'icon-image': 'point'
                    }
                });

                miniMap2.on('click', 'points', function (e) {
                    loadTarget(e.features[0].properties.nome_img, () => {
                        console.log(currentInfo.camera.heading)
                        setIconDirection(currentInfo.camera.heading)
                    })


                });

                miniMap2.on('mouseenter', 'points', function () {
                    miniMap2.getCanvas().style.cursor = 'pointer';
                });

                miniMap2.on('mouseleave', 'points', function () {
                    miniMap2.getCanvas().style.cursor = '';
                });
            }
        );

        miniMap2.loadImage(
            '/point-selected-v2.png',
            function (error, image) {
                miniMap2.addImage('point-selected', image);
                miniMap2.addSource('selected', {
                    'type': 'geojson',
                    'data': photos
                });
                miniMap2.addLayer({
                    'id': 'selected',
                    'type': 'symbol',
                    'source': 'selected',
                    "filter": [
                        "all",
                        [
                            "==",
                            "nome_img",
                            currentPhotoName
                        ]
                    ],
                    'layout': {
                        'icon-image': 'point-selected'
                    }
                });
                if (!imageName) return
                loadImageByName(imageName)
                $('#close-full-map').click()
            }
        )
    });
}

main()

$('.float-element').on("click", function () {
    var btnId = $(this).attr('id');
    let handle = {
        'open-full-map': () => setFullMap(true),
        'close-full-map': () => setFullMap(false)
    }
    handle[btnId]()
});