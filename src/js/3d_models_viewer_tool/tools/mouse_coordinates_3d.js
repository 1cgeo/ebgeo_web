// Path: js/3d_models_viewer_tool/tools/mouse_coordinates_3d.js

/**
 * @fileoverview Mouse coordinate display for the Cesium 3D viewer.
 * Shows lat/lon under the cursor with format switching and copy support.
 * Styles in src/css/panels-3d.css (.coordinates-control-3d*).
 */

import {
    COORDINATE_FORMATS,
    formatCoordinates,
    getDisplayFormat
} from '../../utilities';

let viewerInstance = null;

let coordinatesContainer = null;
let coordinatesText = null;
let formatSelector = null;
let currentFormat = 'latlong';
let currentCoordinates = { lat: 0, lng: 0 };
let mouseMoveHandler = null;

function initMouseCoordinates3D(viewer) {
    if (!viewer) return;
    viewerInstance = viewer;

    // Remove existing container if any
    cleanupMouseCoordinates3D();

    // Create coordinates container
    coordinatesContainer = document.createElement('div');
    coordinatesContainer.className = 'coordinates-control-3d';

    // Create coordinates text display
    coordinatesText = document.createElement('div');
    coordinatesText.className = 'coordinates-control-3d__text';

    // Create controls container
    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'coordinates-control-3d__controls';

    // Copy button
    const copyButton = document.createElement('div');
    copyButton.className = 'coordinates-control-3d__btn coordinates-control-3d__btn--copy coordinates-copy-button';
    copyButton.textContent = '\u{1F4CB}';
    copyButton.title = 'Copiar coordenadas';
    copyButton.addEventListener('click', copyCoordinates);

    // Format button
    const formatButton = document.createElement('div');
    formatButton.className = 'coordinates-control-3d__btn';
    formatButton.innerHTML = '<img src="./images/gear_icon.svg" alt="Settings" width="16" height="16" />';
    formatButton.title = 'Mudar formato de coordenadas';
    formatButton.addEventListener('click', toggleFormatSelector);

    // Create format selector dropdown
    formatSelector = document.createElement('div');
    formatSelector.className = 'coordinates-control-3d__dropdown';

    // Add format options
    COORDINATE_FORMATS.forEach(format => {
        const option = document.createElement('div');
        option.textContent = format.label;
        option.dataset.format = format.id;
        option.className = 'coordinates-control-3d__option' +
            (format.id === currentFormat ? ' coordinates-control-3d__option--active' : '');
        option.addEventListener('click', () => setFormat(format.id));
        formatSelector.appendChild(option);
    });

    // Assemble components
    controlsContainer.appendChild(copyButton);
    controlsContainer.appendChild(formatButton);
    coordinatesContainer.appendChild(coordinatesText);
    coordinatesContainer.appendChild(controlsContainer);
    coordinatesContainer.appendChild(formatSelector);

    // Add to map container
    document.getElementById('map-3d-container').appendChild(coordinatesContainer);

    // Setup mouse move listener
    mouseMoveHandler = onMouseMove;
    viewerInstance.scene.canvas.addEventListener('mousemove', mouseMoveHandler);

    // Setup click outside listener for format selector
    document.addEventListener('click', closeFormatSelector);

    // Initial coordinates display
    updateCoordinates(0, 0);
}

function cleanupMouseCoordinates3D() {
    if (mouseMoveHandler && viewerInstance) {
        viewerInstance.scene.canvas.removeEventListener('mousemove', mouseMoveHandler);
        mouseMoveHandler = null;
    }

    if (coordinatesContainer && coordinatesContainer.parentNode) {
        coordinatesContainer.parentNode.removeChild(coordinatesContainer);
        coordinatesContainer = null;
    }

    document.removeEventListener('click', closeFormatSelector);
}

function onMouseMove(e) {
    if (!viewerInstance) return;

    const canvas = viewerInstance.scene.canvas;
    const rect = canvas.getBoundingClientRect();
    const position = new Cesium.Cartesian2(
        e.clientX - rect.left,
        e.clientY - rect.top
    );

    const cartesian = viewerInstance.camera.pickEllipsoid(position, viewerInstance.scene.globe.ellipsoid);

    if (cartesian) {
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        const longitude = Cesium.Math.toDegrees(cartographic.longitude);
        const latitude = Cesium.Math.toDegrees(cartographic.latitude);

        currentCoordinates = { lat: latitude, lng: longitude };
        updateCoordinates(latitude, longitude);
    }
}

async function updateCoordinates(lat, lng) {
    if (!coordinatesText) return;

    coordinatesText.innerHTML = '';

    try {
        const displayFormat = await getDisplayFormat(lat, lng, currentFormat);

        displayFormat.parts.forEach(part => {
            const span = document.createElement('span');
            span.textContent = `${part.label}: ${part.value}`;
            coordinatesText.appendChild(span);
        });
    } catch (error) {
        console.error('Error converting coordinates:', error);
        // Fallback
        const latSpan = document.createElement('span');
        latSpan.textContent = `Lat: ${lat.toFixed(5)}\u00B0`;
        const lngSpan = document.createElement('span');
        lngSpan.textContent = `Lon: ${lng.toFixed(5)}\u00B0`;
        coordinatesText.appendChild(latSpan);
        coordinatesText.appendChild(lngSpan);
    }
}

async function copyCoordinates() {
    const { lat, lng } = currentCoordinates;
    const textToCopy = await formatCoordinates(lat, lng, currentFormat);

    if (!textToCopy || textToCopy.trim() === '') return;

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(textToCopy).then(() => {
            showCopyFeedback();
        }).catch(() => {
            fallbackCopyTextToClipboard(textToCopy);
        });
    } else {
        fallbackCopyTextToClipboard(textToCopy);
    }
}

function fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        document.execCommand('copy');
        showCopyFeedback();
    } catch (err) {
        console.error('Error copying text:', err);
    }

    document.body.removeChild(textArea);
}

function showCopyFeedback() {
    const copyButton = coordinatesContainer?.querySelector('.coordinates-copy-button');
    if (copyButton) {
        const originalContent = copyButton.textContent;
        copyButton.textContent = '\u2705';

        setTimeout(() => {
            copyButton.textContent = originalContent;
        }, 1000);
    }
}

function toggleFormatSelector(e) {
    e.stopPropagation();
    const isVisible = formatSelector.style.display === 'block';
    formatSelector.style.display = isVisible ? 'none' : 'block';
}

function closeFormatSelector(e) {
    if (formatSelector && !formatSelector.contains(e.target)) {
        formatSelector.style.display = 'none';
    }
}

function setFormat(formatId) {
    if (currentFormat === formatId) return;

    currentFormat = formatId;

    // Update dropdown options
    const options = formatSelector.querySelectorAll('.coordinates-control-3d__option');
    options.forEach(option => {
        option.classList.toggle('coordinates-control-3d__option--active', option.dataset.format === formatId);
    });

    formatSelector.style.display = 'none';
    updateCoordinates(currentCoordinates.lat, currentCoordinates.lng);
}

export { initMouseCoordinates3D, cleanupMouseCoordinates3D };
