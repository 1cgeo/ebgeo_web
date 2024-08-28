import { map } from './map.js';

let isIdentifyActive = false;

function toggleIdentifyTool() {
    isIdentifyActive = !isIdentifyActive;
    updateIdentifyButtonState();
}

function updateIdentifyButtonState() {
    const identifyButton = document.getElementById('identify-tool');
    if (isIdentifyActive) {
        identifyButton.classList.add('active-tool-3d');
    } else {
        identifyButton.classList.remove('active-tool-3d');
    }
}

function handleFeatureClick(event) {
    if (!isIdentifyActive) return;

    const canvas = map.scene.canvas;
    const rect = canvas.getBoundingClientRect();
    const position = new Cesium.Cartesian2(
        event.clientX - rect.left,
        event.clientY - rect.top
    );

    var scene = map.scene;
    var pickedFeature = scene.pick(position);
    if (Cesium.defined(pickedFeature)) {
        var cartesian = scene.pickPosition(position);
        if (Cesium.defined(cartesian)) {
            var cartographic = Cesium.Cartographic.fromCartesian(cartesian);
            var longitude = Cesium.Math.toDegrees(cartographic.longitude);
            var latitude = Cesium.Math.toDegrees(cartographic.latitude);
            var height = cartographic.height;

            fetchFeatureInfo(longitude, latitude, height);
        }
    }
}

function fetchFeatureInfo(lon, lat, z) {
    console.log(lat,lon,z)
    return fetch(`http://localhost:3000/feicoes?lat=${lat}&lon=${lon}&z=${z}`)
        .then(response => {
            if (!response.ok) {
                throw new Error('Erro na resposta do servidor');
            }
            return response.json();
        })
        .then(data => {
            displayFeatureInfo(data);
        })
        .catch(error => {
            console.error('Erro ao buscar informações da feição:', error);
        });
}

function displayFeatureInfo(featureData) {
    const featureInfoElement = document.getElementById('feature-info');
    const featureInfoContent = document.getElementById('feature-info-content');
    
    if (featureData.message) {
        featureInfoContent.innerHTML = `<p>${featureData.message}</p>`;
    } else {
        featureInfoContent.innerHTML = `
            <p><strong>Nome:</strong> ${featureData.nome}</p>
            <p><strong>Município:</strong> ${featureData.municipio}</p>
            <p><strong>Estado:</strong> ${featureData.estado}</p>
            <p><strong>Tipo:</strong> ${featureData.tipo}</p>
            <p><strong>Altitude Base:</strong> ${featureData.altitude_base} m</p>
            <p><strong>Altitude Topo:</strong> ${featureData.altitude_topo} m</p>
        `;
    }
    
    featureInfoElement.style.display = 'block';
}

function closeFeatureInfo() {
    const featureInfoElement = document.getElementById('feature-info');
    featureInfoElement.style.display = 'none';
    isIdentifyActive = false;
    updateIdentifyButtonState();
}

function initIdentifyTool() {
    map.scene.canvas.addEventListener('click', handleFeatureClick);
    document.getElementById('close-feature-info').addEventListener('click', closeFeatureInfo);
}

export { initIdentifyTool, toggleIdentifyTool, closeFeatureInfo };