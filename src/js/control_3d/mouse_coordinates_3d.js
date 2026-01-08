// Path: js/control_3d/mouse_coordinates_3d.js
import {
    COORDINATE_FORMATS,
    getPlaceholderForFormat,
    parseCoordinates,
    formatCoordinates,
    getDisplayFormat
} from '../controls_sig/utilities/coordinate_converter.js';

let viewerInstance = null;

let coordinatesContainer = null;
let coordinatesText = null;
let formatSelector = null;
let currentFormat = 'latlong';
let currentCoordinates = { lat: 0, lng: 0 };
let mouseMoveHandler = null;
let flyToModal = null;

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
    copyButton.addEventListener('mouseenter', () => copyButton.style.opacity = '1');
    copyButton.addEventListener('mouseleave', () => copyButton.style.opacity = '0.7');

    // Fly to button
    const flyToButton = document.createElement('div');
    flyToButton.innerHTML = `<img src="./images/fly_to_icon.svg" alt="Fly to" width="16" height="16" />`;
    flyToButton.title = 'Ir para coordenadas';
    flyToButton.style.cssText = `
        opacity: 0.7;
        cursor: pointer;
        transition: opacity 0.2s;
        display: flex;
        align-items: center;
        width: 16px;
        height: 16px;
    `;
    flyToButton.addEventListener('click', openFlyToModal);
    flyToButton.addEventListener('mouseenter', () => flyToButton.style.opacity = '1');
    flyToButton.addEventListener('mouseleave', () => flyToButton.style.opacity = '0.7');

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
    formatButton.addEventListener('mouseenter', () => formatButton.style.opacity = '1');
    formatButton.addEventListener('mouseleave', () => formatButton.style.opacity = '0.7');

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
    controlsContainer.appendChild(flyToButton);
    controlsContainer.appendChild(formatButton);
    coordinatesContainer.appendChild(coordinatesText);
    coordinatesContainer.appendChild(controlsContainer);
    coordinatesContainer.appendChild(formatSelector);

    // Add to map container
    document.getElementById('map-3d-container').appendChild(coordinatesContainer);

    // Create modal
    createFlyToModal();

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

    if (flyToModal && flyToModal.parentNode) {
        flyToModal.parentNode.removeChild(flyToModal);
        flyToModal = null;
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

function createFlyToModal() {
    flyToModal = document.createElement('div');
    flyToModal.style.cssText = `
        display: none;
        position: fixed;
        z-index: 1001;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.4);
    `;

    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background-color: white;
        margin: 10% auto;
        padding: 20px;
        border-radius: 4px;
        width: 90%;
        max-width: 400px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
    `;

    modalContent.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h3 style="margin: 0;">Ir para coordenadas</h3>
            <span id="modal-close" style="color: #aaa; font-size: 28px; font-weight: bold; cursor: pointer;">&times;</span>
        </div>
        <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold;">Formato:</label>
            <select id="format-select" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                ${COORDINATE_FORMATS.map(f => `<option value="${f.id}">${f.label}</option>`).join('')}
            </select>
        </div>
        <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold;">Coordenadas:</label>
            <input type="text" id="coords-input" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">
        </div>
        <div id="validation-msg" style="min-height: 20px; margin-bottom: 15px; color: #d32f2f;"></div>
        <div style="display: flex; justify-content: flex-end; gap: 10px;">
            <button id="fly-btn" style="padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; background-color: #508D4E; color: white;">Ir para</button>
            <button id="cancel-btn" style="padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; background-color: #f0f0f0; color: #333;">Cancelar</button>
        </div>
    `;

    flyToModal.appendChild(modalContent);
    document.body.appendChild(flyToModal);

    // Event listeners
    flyToModal.querySelector('#modal-close').addEventListener('click', closeFlyToModal);
    flyToModal.querySelector('#cancel-btn').addEventListener('click', closeFlyToModal);
    flyToModal.querySelector('#fly-btn').addEventListener('click', handleFlyTo);
    flyToModal.addEventListener('click', (e) => {
        if (e.target === flyToModal) closeFlyToModal();
    });

    // Update placeholder on format change
    const formatSelect = flyToModal.querySelector('#format-select');
    const coordsInput = flyToModal.querySelector('#coords-input');
    formatSelect.addEventListener('change', (e) => {
        coordsInput.placeholder = getPlaceholderForFormat(e.target.value);
    });
}

function openFlyToModal() {
    if (flyToModal) {
        const formatSelect = flyToModal.querySelector('#format-select');
        const coordsInput = flyToModal.querySelector('#coords-input');
        const validationMsg = flyToModal.querySelector('#validation-msg');

        formatSelect.value = currentFormat;
        coordsInput.value = '';
        coordsInput.placeholder = getPlaceholderForFormat(currentFormat);
        validationMsg.textContent = '';

        flyToModal.style.display = 'block';
        setTimeout(() => coordsInput.focus(), 100);
    }
}

function closeFlyToModal() {
    if (flyToModal) {
        flyToModal.style.display = 'none';
    }
}

async function handleFlyTo() {
    if (!viewerInstance || !flyToModal) return;

    const formatSelect = flyToModal.querySelector('#format-select');
    const coordsInput = flyToModal.querySelector('#coords-input');
    const validationMsg = flyToModal.querySelector('#validation-msg');

    const coordinates = await parseCoordinates(coordsInput.value.trim(), formatSelect.value);

    if (coordinates) {
        viewerInstance.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(coordinates.lng, coordinates.lat, 1000),
            duration: 2.0
        });
        closeFlyToModal();
    } else {
        validationMsg.textContent = 'Coordenadas inválidas para o formato selecionado';
    }
}

export { initMouseCoordinates3D, cleanupMouseCoordinates3D };
