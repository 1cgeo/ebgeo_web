// Path: js/3d_models_viewer_tool/tools/mouse_coordinates_3d.js
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
    coordinatesContainer.style.cssText = `
        position: absolute;
        bottom: 10px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1000;
        min-width: 280px;
        width: auto;
        padding: 6px 10px;
        font-family: monospace;
        font-size: 12px;
        white-space: nowrap;
        background: rgba(255, 255, 255, 0.9);
        border-radius: 4px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
    `;

    // Create coordinates text display
    coordinatesText = document.createElement('div');
    coordinatesText.style.cssText = `
        flex-grow: 1;
        display: flex;
        gap: 10px;
        min-width: 160px;
    `;

    // Create controls container
    const controlsContainer = document.createElement('div');
    controlsContainer.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: 8px;
    `;

    // Copy button
    const copyButton = document.createElement('div');
    copyButton.className = 'coordinates-copy-button';
    copyButton.innerHTML = '📋';
    copyButton.title = 'Copiar coordenadas';
    copyButton.style.cssText = `
        opacity: 0.7;
        cursor: pointer;
        font-size: 14px;
        transition: opacity 0.2s;
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    copyButton.addEventListener('click', copyCoordinates);
    copyButton.addEventListener('mouseenter', () => { copyButton.style.opacity = '1'; });
    copyButton.addEventListener('mouseleave', () => { copyButton.style.opacity = '0.7'; });

    // Format button
    const formatButton = document.createElement('div');
    formatButton.innerHTML = `<img src="./images/gear_icon.svg" alt="Settings" width="16" height="16" />`;
    formatButton.title = 'Mudar formato de coordenadas';
    formatButton.style.cssText = `
        opacity: 0.7;
        cursor: pointer;
        transition: opacity 0.2s;
        display: flex;
        align-items: center;
        width: 16px;
        height: 16px;
    `;
    formatButton.addEventListener('click', toggleFormatSelector);
    formatButton.addEventListener('mouseenter', () => { formatButton.style.opacity = '1'; });
    formatButton.addEventListener('mouseleave', () => { formatButton.style.opacity = '0.7'; });

    // Create format selector dropdown
    formatSelector = document.createElement('div');
    formatSelector.style.cssText = `
        position: absolute;
        bottom: 100%;
        right: 0;
        background-color: white;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
        padding: 5px 0;
        display: none;
        z-index: 1001;
    `;

    // Add format options
    COORDINATE_FORMATS.forEach(format => {
        const option = document.createElement('div');
        option.textContent = format.label;
        option.dataset.format = format.id;
        option.style.cssText = `
            padding: 5px 15px;
            cursor: pointer;
            white-space: nowrap;
            ${format.id === currentFormat ? 'background-color: #f0f0f0; font-weight: bold;' : ''}
        `;
        option.addEventListener('click', () => setFormat(format.id));
        option.addEventListener('mouseenter', () => {
            if (format.id !== currentFormat) option.style.backgroundColor = '#f0f0f0';
        });
        option.addEventListener('mouseleave', () => {
            if (format.id !== currentFormat) option.style.backgroundColor = '';
        });
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
        latSpan.textContent = `Lat: ${lat.toFixed(5)}°`;
        const lngSpan = document.createElement('span');
        lngSpan.textContent = `Lon: ${lng.toFixed(5)}°`;
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
    const copyButton = coordinatesContainer.querySelector('.coordinates-copy-button');
    if (copyButton) {
        const originalContent = copyButton.innerHTML;
        copyButton.innerHTML = '✅';
        copyButton.style.color = '#28a745';

        setTimeout(() => {
            copyButton.innerHTML = originalContent;
            copyButton.style.color = '';
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
    const options = formatSelector.querySelectorAll('div');
    options.forEach(option => {
        if (option.dataset.format === formatId) {
            option.style.backgroundColor = '#f0f0f0';
            option.style.fontWeight = 'bold';
        } else {
            option.style.backgroundColor = '';
            option.style.fontWeight = '';
        }
    });

    formatSelector.style.display = 'none';
    updateCoordinates(currentCoordinates.lat, currentCoordinates.lng);
}

export { initMouseCoordinates3D, cleanupMouseCoordinates3D };
