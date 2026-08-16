// Path: js/import_export/drag-drop.handler.js
import { showError, showWarning } from '@utils/toast_service.js';
import { isCurrentMapLockedSync } from '@store';

/** @type {Record<string, string[]>} */
const FILE_TYPES = {
    EBGEO: ['.ebgeo'],
    GEO_IMPORT: ['.geojson', '.json', '.zip', '.kml', '.kmz', '.gpx', '.csv', '.tsv', '.rar', '.7z'],
    IMAGE: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
};

/**
 * Returns the file type category for a given filename.
 * @param {string} fileName
 * @returns {'EBGEO'|'GEO_IMPORT'|'IMAGE'|'INVALID'}
 */
function classifyFile(fileName) {
    const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));

    for (const [type, extensions] of Object.entries(FILE_TYPES)) {
        if (extensions.includes(ext)) return type;
    }

    return 'INVALID';
}

/**
 * Truncates a filename for display.
 * @param {string} name
 * @param {number} max
 * @returns {string}
 */
function truncateName(name, max = 30) {
    return name.length > max ? name.substring(0, max) + '...' : name;
}

/** Overlay theme per file type. */
const OVERLAY_THEME = {
    EBGEO:      { bg: 'rgba(40, 167, 69, 0.85)',  border: '#28a745', icon: '', label: 'Importar Atlas' },
    GEO_IMPORT: { bg: 'rgba(0, 123, 255, 0.85)',  border: '#007bff', icon: '', label: 'Importar Geometrias' },
    IMAGE:      { bg: 'rgba(255, 193, 7, 0.85)',   border: '#ffc107', icon: '', label: 'Adicionar Imagem' },
    INVALID:    { bg: 'rgba(220, 53, 69, 0.85)',   border: '#dc3545', icon: '', label: 'Arquivo não suportado' },
};

class DragDropHandler {
    constructor(mapElement, toolManager, importControl, exportImportService, imageControl) {
        this.mapElement = mapElement;
        this.toolManager = toolManager;
        this.importControl = importControl;
        this.exportImportService = exportImportService;
        this.imageControl = imageControl;

        this.dragCounter = 0;
        this.overlay = null;

        this.handleDragEnter = this.handleDragEnter.bind(this);
        this.handleDragOver = this.handleDragOver.bind(this);
        this.handleDragLeave = this.handleDragLeave.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
    }

    enable() {
        this.mapElement.addEventListener('dragenter', this.handleDragEnter);
        this.mapElement.addEventListener('dragover', this.handleDragOver);
        this.mapElement.addEventListener('dragleave', this.handleDragLeave);
        this.mapElement.addEventListener('drop', this.handleDrop);
    }

    disable() {
        this.mapElement.removeEventListener('dragenter', this.handleDragEnter);
        this.mapElement.removeEventListener('dragover', this.handleDragOver);
        this.mapElement.removeEventListener('dragleave', this.handleDragLeave);
        this.mapElement.removeEventListener('drop', this.handleDrop);

        this.hideDropOverlay();
    }

    // ===== EVENT HANDLERS =====

    handleDragEnter(event) {
        event.preventDefault();
        this.dragCounter++;

        if (this.dragCounter === 1) {
            const file = this.getFirstFile(event);
            if (file) {
                this.showDropOverlay(classifyFile(file.name), file.name);
            }
        }
    }

    handleDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }

    handleDragLeave(event) {
        event.preventDefault();
        this.dragCounter--;

        if (this.dragCounter === 0) {
            this.hideDropOverlay();
        }
    }

    async handleDrop(event) {
        event.preventDefault();
        this.dragCounter = 0;
        this.hideDropOverlay();

        if (isCurrentMapLockedSync()) {
            showWarning('Mapa bloqueado');
            return;
        }

        const files = Array.from(event.dataTransfer.files);

        if (files.length === 0) return;

        if (files.length > 1) {
            showError('Por favor, arraste apenas um arquivo por vez.');
            return;
        }

        const file = files[0];
        const fileType = classifyFile(file.name);

        if (fileType === 'INVALID') {
            showError(`Tipo de arquivo não suportado: ${file.name}. Formatos aceitos: .ebgeo, .geojson, .json, .zip, .kml, .kmz, .gpx`);
            return;
        }

        let dropCoordinates = null;
        if (fileType === 'IMAGE') {
            const rect = this.mapElement.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            dropCoordinates = this.imageControl.map.unproject([x, y]);
        }

        this.toolManager.deactivateCurrentTool();

        try {
            await this.processFile(file, fileType, dropCoordinates);
        } catch (error) {
            console.error('Error processing file via drag & drop:', error);
            showError(`Erro ao processar arquivo: ${error.message}`);
        }
    }

    // ===== UTILITY METHODS =====

    getFirstFile(event) {
        const items = event.dataTransfer.items;
        if (items && items.length > 0 && items[0].kind === 'file') {
            return items[0].getAsFile();
        }

        const files = event.dataTransfer.files;
        if (files && files.length > 0) {
            return files[0];
        }

        return null;
    }

    async processFile(file, fileType, dropCoordinates = null) {
        const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

        switch (fileType) {
            case 'EBGEO': {
                const result = await this.askImportMode();
                if (result.cancelled) return;
                await this.exportImportService.processFileDirectly(file, result.additive);
                break;
            }

            case 'GEO_IMPORT': {
                if (ext === '.csv' || ext === '.tsv') {
                    showWarning('Para importar CSV, use a aba Importar na barra lateral');
                    return;
                }
                await this.importControl.processFileDirectly(file);
                break;
            }

            case 'IMAGE':
                await this.processImageFile(file, dropCoordinates);
                break;

            default:
                throw new Error(`Tipo de arquivo não suportado: ${fileType}`);
        }
    }

    async processImageFile(file, lngLat) {
        if (!lngLat || isNaN(lngLat.lng) || isNaN(lngLat.lat)) {
            throw new Error('Coordenadas inválidas para posicionamento da imagem');
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async () => {
                try {
                    await this.imageControl.addImageFeature(lngLat, reader.result);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('Erro ao ler arquivo de imagem'));

            reader.readAsDataURL(file);
        });
    }

    async askImportMode() {
        return new Promise((resolve) => {
            const modal = this.createImportModeModal(resolve);
            document.body.appendChild(modal);
        });
    }

    createImportModeModal(resolve) {
        const modal = document.createElement('div');
        modal.className = 'import-mode-modal';

        const dialog = document.createElement('div');
        dialog.className = 'import-mode-modal__dialog';

        const title = document.createElement('h3');
        title.className = 'import-mode-modal__title';
        title.textContent = 'Importar Atlas';

        const description = document.createElement('p');
        description.className = 'import-mode-modal__description';
        description.textContent = 'Como deseja importar este atlas?';

        const actions = document.createElement('div');
        actions.className = 'import-mode-modal__actions';

        const btnReplace = document.createElement('button');
        btnReplace.className = 'import-mode-modal__btn import-mode-modal__btn--replace';
        btnReplace.textContent = 'Substituir Atual';

        const btnAdd = document.createElement('button');
        btnAdd.className = 'import-mode-modal__btn import-mode-modal__btn--add';
        btnAdd.textContent = 'Adicionar ao Atual';

        actions.appendChild(btnReplace);
        actions.appendChild(btnAdd);
        dialog.appendChild(title);
        dialog.appendChild(description);
        dialog.appendChild(actions);
        modal.appendChild(dialog);

        function cleanup() {
            modal.remove();
        }

        btnReplace.onclick = () => {
            cleanup();
            resolve({ cancelled: false, additive: false });
        };

        btnAdd.onclick = () => {
            cleanup();
            resolve({ cancelled: false, additive: true });
        };

        modal.onclick = (e) => {
            if (e.target === modal) {
                cleanup();
                resolve({ cancelled: true });
            }
        };

        return modal;
    }

    // ===== VISUAL FEEDBACK =====

    showDropOverlay(fileType, fileName) {
        this.hideDropOverlay();

        const theme = OVERLAY_THEME[fileType] || OVERLAY_THEME.INVALID;

        this.overlay = document.createElement('div');
        this.overlay.className = 'drag-drop-overlay';
        // Dynamic colors must be inline (runtime-computed values)
        this.overlay.style.setProperty('--drag-drop-bg-color', theme.bg);
        this.overlay.style.setProperty('--drag-drop-border-color', theme.border);

        const iconEl = document.createElement('div');
        iconEl.className = 'drag-drop-overlay__icon';
        iconEl.textContent = theme.icon;

        const messageEl = document.createElement('div');
        messageEl.className = 'drag-drop-overlay__message';

        const labelText = document.createTextNode(theme.label);
        const br = document.createElement('br');
        const fileNameEl = document.createElement('em');
        fileNameEl.className = 'drag-drop-overlay__filename';
        fileNameEl.textContent = truncateName(fileName);

        messageEl.appendChild(labelText);
        messageEl.appendChild(br);
        messageEl.appendChild(fileNameEl);

        this.overlay.appendChild(iconEl);
        this.overlay.appendChild(messageEl);

        this.mapElement.style.position = 'relative';
        this.mapElement.appendChild(this.overlay);
    }

    hideDropOverlay() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
    }
}

export default DragDropHandler;
