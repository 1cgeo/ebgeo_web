// Path: js/3d_models_viewer_tool/tools/mouse_coordinates_3d.js
import {
    COORDINATE_FORMATS,
    getPlaceholderForFormat,
    parseCoordinates,
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
    copyButton.addEventListener('mouseenter', () => { copyButton.style.opacity = '1'; });
    copyButton.addEventListener('mouseleave', () => { copyButton.style.opacity = '0.7'; });

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
    flyToButton.addEventListener('click', (e) => {
        e.stopPropagation();
        openFlyToModal();
    });
    flyToButton.addEventListener('mouseenter', () => { flyToButton.style.opacity = '1'; });
    flyToButton.addEventListener('mouseleave', () => { flyToButton.style.opacity = '0.7'; });

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
    flyToModal.id = 'fly-to-modal-3d';
    flyToModal.className = 'modal-overlay';
    flyToModal.setAttribute('data-visible', 'false');
    // Override position to absolute for 3D container context
    flyToModal.style.cssText = `
        position: absolute;
        z-index: 1000;
    `;

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-container goto-modal-container';

    modalContent.innerHTML = `
        <div class="modal-header">
            <div class="modal-title-wrap">
                <div class="modal-title-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="3 11 22 2 13 21 11 13 3 11"/>
                    </svg>
                </div>
                <h2 class="modal-title">Ir para Coordenadas</h2>
            </div>
            <button type="button" class="modal-close-btn" id="modal-close-3d" aria-label="Fechar">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        </div>
        <div class="modal-body">
            <div class="goto-modal-content">
                <div class="goto-modal-field">
                    <label class="goto-modal-label" for="goto-format-select-3d">Formato</label>
                    <select id="goto-format-select-3d" class="goto-modal-select">
                        ${COORDINATE_FORMATS.map(f => `<option value="${f.id}">${f.label}</option>`).join('')}
                    </select>
                </div>
                <div class="goto-modal-field">
                    <label class="goto-modal-label" for="goto-coords-input-3d">Coordenadas</label>
                    <div class="goto-modal-input-row">
                        <input type="text" id="goto-coords-input-3d" class="goto-modal-input" autocomplete="off">
                        <button type="button" class="goto-modal-btn goto-modal-btn-primary" id="fly-btn-3d">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                                <circle cx="12" cy="10" r="3"/>
                            </svg>
                            <span>Ir para</span>
                        </button>
                    </div>
                    <div class="goto-validation-message" id="validation-msg-3d"></div>
                </div>
            </div>
        </div>
    `;

    flyToModal.appendChild(modalContent);
    // Append to 3D container to ensure proper z-index stacking
    const map3dContainer = document.getElementById('map-3d-container');
    if (map3dContainer) {
        map3dContainer.appendChild(flyToModal);
    } else {
        document.body.appendChild(flyToModal);
    }

    // Event listeners
    flyToModal.querySelector('#modal-close-3d').addEventListener('click', closeFlyToModal);
    flyToModal.querySelector('#fly-btn-3d').addEventListener('click', handleFlyTo);
    flyToModal.addEventListener('click', (e) => {
        if (e.target === flyToModal) closeFlyToModal();
    });

    // Enter key to submit
    flyToModal.querySelector('#goto-coords-input-3d').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            handleFlyTo();
        }
    });

    // Update placeholder on format change
    const formatSelect = flyToModal.querySelector('#goto-format-select-3d');
    const coordsInput = flyToModal.querySelector('#goto-coords-input-3d');
    formatSelect.addEventListener('change', (e) => {
        coordsInput.placeholder = getPlaceholderForFormat(e.target.value);
    });
}

function openFlyToModal() {
    // Create modal if it doesn't exist
    if (!flyToModal) {
        createFlyToModal();
    }

    if (flyToModal) {
        const formatSelect = flyToModal.querySelector('#goto-format-select-3d');
        const coordsInput = flyToModal.querySelector('#goto-coords-input-3d');
        const validationMsg = flyToModal.querySelector('#validation-msg-3d');

        formatSelect.value = currentFormat;
        coordsInput.value = '';
        coordsInput.placeholder = getPlaceholderForFormat(currentFormat);
        validationMsg.textContent = '';
        validationMsg.classList.remove('error');
        coordsInput.classList.remove('input-error');

        // Show modal using data-visible attribute (required by modal-overlay CSS)
        flyToModal.setAttribute('data-visible', 'true');
        setTimeout(() => coordsInput.focus(), 100);
    }
}

function closeFlyToModal() {
    if (flyToModal) {
        flyToModal.setAttribute('data-visible', 'false');
    }
}

async function handleFlyTo() {
    if (!viewerInstance || !flyToModal) return;

    const formatSelect = flyToModal.querySelector('#goto-format-select-3d');
    const coordsInput = flyToModal.querySelector('#goto-coords-input-3d');
    const validationMsg = flyToModal.querySelector('#validation-msg-3d');

    const coordinates = await parseCoordinates(coordsInput.value.trim(), formatSelect.value);

    if (coordinates) {
        viewerInstance.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(coordinates.lng, coordinates.lat, 1000),
            duration: 2.0
        });
        closeFlyToModal();
    } else {
        validationMsg.textContent = 'Coordenadas inválidas para o formato selecionado';
        validationMsg.classList.add('error');
        coordsInput.classList.add('input-error');
    }
}

export { initMouseCoordinates3D, cleanupMouseCoordinates3D };
