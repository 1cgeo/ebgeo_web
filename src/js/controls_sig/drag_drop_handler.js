// Path: js/controls_sig/drag_drop_handler.js
import { showError } from './utilities/toast_service.js';

class DragDropHandler {
    static FILE_TYPES = {
        EBGEO: ['.ebgeo'],
        GEO_IMPORT: ['.geojson', '.json', '.zip', '.kml', '.kmz', '.gpx'],
        IMAGE: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
    };

    constructor(mapElement, toolManager, importControl, mapControl, imageControl) {
        this.mapElement = mapElement;
        this.toolManager = toolManager;
        this.importControl = importControl;
        this.mapControl = mapControl;
        this.imageControl = imageControl;

        this.isDragOver = false;
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
                const fileType = this.getFileType(file.name);
                this.showDropOverlay(fileType, file.name);
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

        const files = Array.from(event.dataTransfer.files);

        if (files.length === 0) {
            return;
        }

        if (files.length > 1) {
            showError('Por favor, arraste apenas um arquivo por vez.');
            return;
        }

        const file = files[0];
        const fileType = this.getFileType(file.name);

        if (!this.isValidFile(file)) {
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
        if (items && items.length > 0) {
            const item = items[0];
            if (item.kind === 'file') {
                return item.getAsFile();
            }
        }

        const files = event.dataTransfer.files;
        if (files && files.length > 0) {
            return files[0];
        }

        return null;
    }

    getFileType(fileName) {
        const extension = this.getFileExtension(fileName);

        if (DragDropHandler.FILE_TYPES.EBGEO.includes(extension)) {
            return 'EBGEO';
        }

        if (DragDropHandler.FILE_TYPES.GEO_IMPORT.includes(extension)) {
            return 'GEO_IMPORT';
        }

        if (DragDropHandler.FILE_TYPES.IMAGE.includes(extension)) {
            return 'IMAGE';
        }

        return 'INVALID';
    }

    getFileExtension(fileName) {
        return fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
    }

    isValidFile(file) {
        const fileType = this.getFileType(file.name);
        return fileType !== 'INVALID';
    }

    async processFile(file, fileType, dropCoordinates = null) {
        switch (fileType) {
            case 'EBGEO':
                const result = await this.askImportMode();
                if (result.cancelled) {
                    return;
                }
                await this.mapControl.exportImportService.processFileDirectly(file, result.additive);
                break;

            case 'GEO_IMPORT':
                await this.importControl.processFileDirectly(file);
                break;

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

        const reader = new FileReader();

        return new Promise((resolve, reject) => {
            reader.onload = async () => {
                try {
                    const imageBase64 = reader.result;
                    await this.imageControl.addImageFeature(lngLat, imageBase64);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => {
                reject(new Error('Erro ao ler arquivo de imagem'));
            };

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
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white;
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            max-width: 400px;
            width: 90%;
        `;

        dialog.innerHTML = `
            <h3 style="margin: 0 0 16px 0; color: #333;">Importar Projeto</h3>
            <p style="margin: 0 0 20px 0; color: #666; line-height: 1.4;">
                Como deseja importar este projeto?
            </p>
            <div style="display: flex; gap: 12px; justify-content: flex-end;">
                <button id="btn-replace" style="
                    padding: 8px 16px;
                    border: 1px solid #dc3545;
                    background: #dc3545;
                    color: white;
                    border-radius: 4px;
                    cursor: pointer;
                ">Substituir Atual</button>
                <button id="btn-add" style="
                    padding: 8px 16px;
                    border: 1px solid #28a745;
                    background: #28a745;
                    color: white;
                    border-radius: 4px;
                    cursor: pointer;
                ">Adicionar ao Atual</button>
            </div>
        `;

        const cleanup = () => {
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
        };

        dialog.querySelector('#btn-replace').onclick = () => {
            cleanup();
            resolve({ cancelled: false, additive: false });
        };

        dialog.querySelector('#btn-add').onclick = () => {
            cleanup();
            resolve({ cancelled: false, additive: true });
        };

        modal.onclick = (e) => {
            if (e.target === modal) {
                cleanup();
                resolve({ cancelled: true });
            }
        };

        modal.appendChild(dialog);
        return modal;
    }

    // ===== VISUAL FEEDBACK =====

    showDropOverlay(fileType, fileName) {
        this.hideDropOverlay();

        this.overlay = document.createElement('div');
        this.overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: ${this.getOverlayColor(fileType)};
            border: 3px dashed ${this.getBorderColor(fileType)};
            border-radius: 8px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            pointer-events: none;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        `;

        const icon = this.getFileIcon(fileType);
        const message = this.getDropMessage(fileType, fileName);

        this.overlay.innerHTML = `
            <div style="font-size: 48px; margin-bottom: 16px;">${icon}</div>
            <div style="color: white; font-size: 18px; font-weight: 600; text-align: center; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">
                ${message}
            </div>
        `;

        this.mapElement.style.position = 'relative';
        this.mapElement.appendChild(this.overlay);
    }

    hideDropOverlay() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
            this.overlay = null;
        }
    }

    getOverlayColor(fileType) {
        switch (fileType) {
            case 'EBGEO':
                return 'rgba(40, 167, 69, 0.85)';
            case 'GEO_IMPORT':
                return 'rgba(0, 123, 255, 0.85)';
            case 'IMAGE':
                return 'rgba(255, 193, 7, 0.85)';
            case 'INVALID':
            default:
                return 'rgba(220, 53, 69, 0.85)';
        }
    }

    getBorderColor(fileType) {
        switch (fileType) {
            case 'EBGEO':
                return '#28a745';
            case 'GEO_IMPORT':
                return '#007bff';
            case 'IMAGE':
                return '#ffc107';
            case 'INVALID':
            default:
                return '#dc3545';
        }
    }

    getFileIcon(fileType) {
        switch (fileType) {
            case 'EBGEO':
                return '';
            case 'GEO_IMPORT':
                return '';
            case 'INVALID':
            default:
                return '';
        }
    }

    getDropMessage(fileType, fileName) {
        const shortName = fileName.length > 30 ? fileName.substring(0, 30) + '...' : fileName;

        switch (fileType) {
            case 'EBGEO':
                return `Importar Projeto<br><em style="font-size: 14px; opacity: 0.9;">${shortName}</em>`;
            case 'GEO_IMPORT':
                return `Importar Geometrias<br><em style="font-size: 14px; opacity: 0.9;">${shortName}</em>`;
            case 'IMAGE':
                return `Adicionar Imagem<br><em style="font-size: 14px; opacity: 0.9;">${shortName}</em>`;
            case 'INVALID':
            default:
                return `Arquivo não suportado<br><em style="font-size: 14px; opacity: 0.9;">${shortName}</em>`;
        }
    }
}

export default DragDropHandler;
