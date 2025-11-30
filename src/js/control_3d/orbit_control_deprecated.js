// Path: js/control_3d/orbit_control_deprecated.js

// ===== MODULE STATE =====
// Orbit control variables
let isOrbiting = false;
let orbitRemoveCallback = null;
let currentTileset = null;
let viewerInstance = null;

/**
 * Starts orbit around the specified tileset
 * @param {Cesium.Cesium3DTileset} tileset - The tileset to orbit around
 */
function startOrbit(tileset) {
    if (!tileset || isOrbiting) return;
    
    // Stop any existing orbit
    stopOrbit();
    
    currentTileset = tileset;
    isOrbiting = true;
    
    
    // Wait for tileset to be ready
    tileset.readyPromise.then(() => {
        if (!isOrbiting) return; // Check if orbit should continue
        
        // Get tileset bounding sphere
        const boundingSphere = tileset.boundingSphere;
        const center = boundingSphere.center;
        const radius = boundingSphere.radius;
        
        if (radius === 0 || !center) {
            console.log('Invalid bounding sphere data');
            stopOrbit();
            return;
        }
        
        // Configure orbit parameters
        const camera = viewerInstance.camera;
        const range = radius * 2.5; // Distance from target
        const orbitSpeed = 0.4; // Degrees per frame
        const pitch = -25; // View angle (looking slightly down)
        
        let currentHeading = 0;
        
        // Initial camera position
        camera.lookAt(center, new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(currentHeading), 
            Cesium.Math.toRadians(pitch),
            range
        ));
        
        // Start orbit animation using clock tick
        orbitRemoveCallback = viewerInstance.clock.onTick.addEventListener(function(clock) {
            if (!isOrbiting) return;
            
            // Increment heading
            currentHeading += orbitSpeed;
            if (currentHeading >= 360) {
                currentHeading = 0;
            }
            
            // Update camera position
            camera.lookAt(center, new Cesium.HeadingPitchRange(
                Cesium.Math.toRadians(currentHeading),
                Cesium.Math.toRadians(pitch),
                range
            ));
        });
        
    }).catch(error => {
        console.error('Error starting orbit:', error);
        stopOrbit();
    });
}

/**
 * Stops the current orbit
 */
function stopOrbit() {
    if (!isOrbiting) return;
    
    isOrbiting = false;
    currentTileset = null;
    
    if (orbitRemoveCallback) {
        orbitRemoveCallback();
        orbitRemoveCallback = null;
    }
    
}

/**
 * Cancels orbit on user interaction
 */
function cancelOrbitOnUserInteraction() {
    if (isOrbiting) {
        stopOrbit();
    }
}

/**
 * Sets up listeners to detect user interactions and cancel orbit
 */
function setupUserInteractionListeners() {
    const canvas = viewerInstance.canvas;
    
    // Mouse interactions
    canvas.addEventListener('mousedown', cancelOrbitOnUserInteraction);
    canvas.addEventListener('wheel', cancelOrbitOnUserInteraction);
    
    // Touch interactions (mobile devices)
    canvas.addEventListener('touchstart', cancelOrbitOnUserInteraction);
    canvas.addEventListener('touchmove', cancelOrbitOnUserInteraction);
    
    // Navigation keys
    document.addEventListener('keydown', (event) => {
        // Cancel orbit when using camera navigation keys
        const navigationKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];
        if (navigationKeys.includes(event.code)) {
            cancelOrbitOnUserInteraction();
        }
    });
}

/**
 * Starts orbit after flying to location
 * @param {Object} location - {lat, lon, height}
 * @param {Cesium.Cesium3DTileset} tileset - Tileset to orbit around
 */
function flyToAndOrbit(location, tileset) {
    if (!location || !tileset) return;
    
    const { lat, lon, height } = location;
    
    // Stop current orbit if exists
    stopOrbit();
    
    // Fly to location
    viewerInstance.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        duration: 2.0, // Flight duration in seconds
        complete: function() {
            // Start orbit after completing flight
            setTimeout(() => {
                startOrbit(tileset);
            }, 800); // Small delay to ensure flight is complete
        }
    });
}

/**
 * Checks if currently orbiting
 * @returns {boolean}
 */
function isCurrentlyOrbiting() {
    return isOrbiting;
}

/**
 * Initializes user interaction listeners
 */
function initOrbitControl(viewer) {
    viewerInstance = viewer
    setupUserInteractionListeners();
}

/**
 * Cleans up orbit resources
 */
function cleanupOrbitControl() {
    stopOrbit();
    // Event listeners are automatically removed when canvas is destroyed
}

export { 
    startOrbit, 
    stopOrbit, 
    flyToAndOrbit, 
    isCurrentlyOrbiting, 
    initOrbitControl, 
    cleanupOrbitControl 
};