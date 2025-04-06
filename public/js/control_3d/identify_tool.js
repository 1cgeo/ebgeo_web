// Path: js\control_3d\identify_tool.js
import { map } from './map.js';
import config from '../config.js';

let isIdentifyActive = false;
let clickListener = null;
let closeButtonListener = null;

function toggleIdentifyTool() {
    isIdentifyActive = !isIdentifyActive;
    updateIdentifyButtonState();
}

function updateIdentifyButtonState() {
    const identifyButton = document.getElementById('identify-tool');
    if (identifyButton) {
        if (isIdentifyActive) {
            identifyButton.classList.add('active-tool-3d');
        } else {
            identifyButton.classList.remove('active-tool-3d');
        }
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
    const apiUrl = config.map3d.identifyTool.apiUrl;
    
    return fetch(`${apiUrl}?lat=${lat}&lon=${lon}&z=${z}`)
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
    // Primeiro, vamos limpar qualquer info existente
    closeFeatureInfo();
    
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
    if (featureInfoElement) {
        featureInfoElement.style.display = 'none';
        // Limpar o conteúdo para liberar memória
        const featureInfoContent = document.getElementById('feature-info-content');
        if (featureInfoContent) {
            featureInfoContent.innerHTML = '';
        }
    }
    isIdentifyActive = false;
    updateIdentifyButtonState();
}

function initIdentifyTool() {
    // Remover event listeners anteriores, se existirem
    if (clickListener) {
        map.scene.canvas.removeEventListener('click', clickListener);
    }
    
    if (closeButtonListener) {
        const closeButton = document.getElementById('close-feature-info');
        if (closeButton) {
            closeButton.removeEventListener('click', closeButtonListener);
        }
    }
    
    // Criar novos listeners e armazenar referências
    clickListener = handleFeatureClick;
    closeButtonListener = closeFeatureInfo;
    
    map.scene.canvas.addEventListener('click', clickListener);
    
    const closeButton = document.getElementById('close-feature-info');
    if (closeButton) {
        closeButton.addEventListener('click', closeButtonListener);
    }
}

// Função para limpeza completa de recursos
function cleanupIdentifyTool() {
    // Desativar ferramenta
    isIdentifyActive = false;
    updateIdentifyButtonState();
    
    // Fechar e limpar informações
    closeFeatureInfo();
    
    // Remover event listeners
    if (clickListener) {
        map.scene.canvas.removeEventListener('click', clickListener);
        clickListener = null;
    }
    
    if (closeButtonListener) {
        const closeButton = document.getElementById('close-feature-info');
        if (closeButton) {
            closeButton.removeEventListener('click', closeButtonListener);
        }
        closeButtonListener = null;
    }
}

export { initIdentifyTool, toggleIdentifyTool, closeFeatureInfo, cleanupIdentifyTool };