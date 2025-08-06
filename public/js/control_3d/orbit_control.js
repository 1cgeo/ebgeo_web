// Path: js\control_3d\orbit_control.js

// Orbit control variables
let isOrbiting = false;
let orbitRemoveCallback = null;
let currentTileset = null;
let viewerInstance = null;

/**
 * Inicia a órbita ao redor do tileset especificado
 * @param {Cesium.Cesium3DTileset} tileset - O tileset para orbitar
 */
function startOrbit(tileset) {
    if (!tileset || isOrbiting) return;
    
    // Para qualquer órbita existente
    stopOrbit();
    
    currentTileset = tileset;
    isOrbiting = true;
    
    console.log('Iniciando órbita...');
    
    // Aguarda o tileset estar carregado
    tileset.readyPromise.then(() => {
        if (!isOrbiting) return; // Verifica se ainda deve orbitar
        
        // Pega o bounding sphere do tileset
        const boundingSphere = tileset.boundingSphere;
        const center = boundingSphere.center;
        const radius = boundingSphere.radius;
        
        if (radius === 0 || !center) {
            console.log('Dados do bounding sphere inválidos');
            stopOrbit();
            return;
        }
        
        // Configura parâmetros da órbita
        const camera = viewerInstance.camera;
        const range = radius * 2.5; // Distância do alvo
        const orbitSpeed = 0.4; // Graus por frame
        const pitch = -25; // Ângulo de visão (olhando ligeiramente para baixo)
        
        let currentHeading = 0;
        
        // Posição inicial da câmera
        camera.lookAt(center, new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(currentHeading), 
            Cesium.Math.toRadians(pitch),
            range
        ));
        
        // Inicia a animação da órbita usando clock tick
        orbitRemoveCallback = viewerInstance.clock.onTick.addEventListener(function(clock) {
            if (!isOrbiting) return;
            
            // Incrementa o heading
            currentHeading += orbitSpeed;
            if (currentHeading >= 360) {
                currentHeading = 0;
            }
            
            // Atualiza posição da câmera
            camera.lookAt(center, new Cesium.HeadingPitchRange(
                Cesium.Math.toRadians(currentHeading),
                Cesium.Math.toRadians(pitch),
                range
            ));
        });
        
        console.log(`Órbita iniciada ao redor do modelo (raio: ${radius.toFixed(2)}m)`);
    }).catch(error => {
        console.error('Erro ao iniciar órbita:', error);
        stopOrbit();
    });
}

/**
 * Para a órbita atual
 */
function stopOrbit() {
    if (!isOrbiting) return;
    
    isOrbiting = false;
    currentTileset = null;
    
    if (orbitRemoveCallback) {
        orbitRemoveCallback();
        orbitRemoveCallback = null;
    }
    
    console.log('Órbita parada');
}

/**
 * Cancela a órbita em caso de interação do usuário
 */
function cancelOrbitOnUserInteraction() {
    if (isOrbiting) {
        console.log('Órbita cancelada por interação do usuário');
        stopOrbit();
    }
}

/**
 * Configura listeners para detectar interações do usuário e cancelar a órbita
 */
function setupUserInteractionListeners() {
    const canvas = viewerInstance.canvas;
    
    // Interações do mouse
    canvas.addEventListener('mousedown', cancelOrbitOnUserInteraction);
    canvas.addEventListener('wheel', cancelOrbitOnUserInteraction);
    
    // Interações touch (dispositivos móveis)
    canvas.addEventListener('touchstart', cancelOrbitOnUserInteraction);
    canvas.addEventListener('touchmove', cancelOrbitOnUserInteraction);
    
    // Teclas de navegação
    document.addEventListener('keydown', (event) => {
        // Cancela órbita ao usar teclas de navegação da câmera
        const navigationKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];
        if (navigationKeys.includes(event.code)) {
            cancelOrbitOnUserInteraction();
        }
    });
}

/**
 * Inicia órbita após voo para localização
 * @param {Object} location - {lat, lon, height}
 * @param {Cesium.Cesium3DTileset} tileset - Tileset para orbitar
 */
function flyToAndOrbit(location, tileset) {
    if (!location || !tileset) return;
    
    const { lat, lon, height } = location;
    
    // Para órbita atual se existir
    stopOrbit();
    
    // Voa para a localização
    viewerInstance.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        duration: 2.0, // Duração do voo em segundos
        complete: function() {
            // Inicia órbita após completar o voo
            setTimeout(() => {
                startOrbit(tileset);
            }, 800); // Pequeno delay para garantir que o voo terminou
        }
    });
}

/**
 * Verifica se está orbitando atualmente
 * @returns {boolean}
 */
function isCurrentlyOrbiting() {
    return isOrbiting;
}

/**
 * Inicializa os listeners de interação do usuário
 */
function initOrbitControl(viewer) {
    viewerInstance = viewer
    setupUserInteractionListeners();
}

/**
 * Limpa os recursos da órbita
 */
function cleanupOrbitControl() {
    stopOrbit();
    // Os event listeners são automaticamente removidos quando o canvas é destruído
}

export { 
    startOrbit, 
    stopOrbit, 
    flyToAndOrbit, 
    isCurrentlyOrbiting, 
    initOrbitControl, 
    cleanupOrbitControl 
};