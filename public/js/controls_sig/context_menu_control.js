// Path: js\controls_sig\context_menu_control.js
import { formatCoordinates } from './utilities/coordinate_converter.js';
import { showSuccess } from './utilities/toast_service.js';

class ContextMenuControl {
    constructor(mouseCoordinatesControl, toolManager) {
        this._map = null;
        this._mouseCoordinatesControl = mouseCoordinatesControl;
        this._toolManager = toolManager;
        this._contextMenu = null;
        this._lastCoordinates = null;
        
        this._onRightClick = this._onRightClick.bind(this);
        this._onMapClick = this._onMapClick.bind(this);
        this._onDocumentClick = this._onDocumentClick.bind(this);
        this._onCopyCoordinates = this._onCopyCoordinates.bind(this);
    }

    onAdd(map) {
        this._map = map;
        this._createContextMenu();
        
        // Add event listeners
        this._map.getCanvas().addEventListener('contextmenu', this._onRightClick);
        this._map.on('click', this._onMapClick);
        document.addEventListener('click', this._onDocumentClick);
        
        return document.createElement('div'); // Empty container as this is not a UI control
    }

    onRemove() {
        if (this._map) {
            this._map.getCanvas().removeEventListener('contextmenu', this._onRightClick);
            this._map.off('click', this._onMapClick);
        }
        document.removeEventListener('click', this._onDocumentClick);
        
        if (this._contextMenu && this._contextMenu.parentNode) {
            this._contextMenu.parentNode.removeChild(this._contextMenu);
        }
        
        this._map = null;
    }

    _createContextMenu() {
        this._contextMenu = document.createElement('div');
        this._contextMenu.className = 'context-menu';
        this._contextMenu.style.cssText = `
            position: absolute;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            padding: 8px 0;
            z-index: 10000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            min-width: 150px;
            display: none;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        // Create menu items
        const copyItem = document.createElement('div');
        copyItem.className = 'context-menu-item';
        copyItem.textContent = 'Copiar Coordenadas';
        copyItem.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            font-size: 13px;
            user-select: none;
        `;
        
        // Add hover effects
        copyItem.addEventListener('mouseenter', () => {
            copyItem.style.backgroundColor = '#f5f5f5';
        });
        
        copyItem.addEventListener('mouseleave', () => {
            copyItem.style.backgroundColor = '';
        });
        
        copyItem.addEventListener('click', this._onCopyCoordinates);

        // Create reset north item
        const resetNorthItem = document.createElement('div');
        resetNorthItem.className = 'context-menu-item';
        resetNorthItem.textContent = 'Orientar para Norte';
        resetNorthItem.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            font-size: 13px;
            user-select: none;
        `;
        
        // Add hover effects
        resetNorthItem.addEventListener('mouseenter', () => {
            resetNorthItem.style.backgroundColor = '#f5f5f5';
        });
        
        resetNorthItem.addEventListener('mouseleave', () => {
            resetNorthItem.style.backgroundColor = '';
        });
        
        resetNorthItem.addEventListener('click', this._onResetNorth.bind(this));
        
        this._contextMenu.appendChild(copyItem);
        this._contextMenu.appendChild(resetNorthItem);
        document.body.appendChild(this._contextMenu);
    }

    _onRightClick(e) {
        e.preventDefault();
        
        // Check if there's an active tool - block context menu if there is
        if (this._toolManager && this._toolManager.hasActiveTool()) {
            return;
        }
        
        // Get coordinates from the click position
        const coordinates = this._map.unproject([e.offsetX, e.offsetY]);
        this._lastCoordinates = { lat: coordinates.lat, lng: coordinates.lng };
        
        this._showMenu(e.clientX, e.clientY);
    }

    _onMapClick() {
        this._hideMenu();
    }

    _onDocumentClick(e) {
        if (this._contextMenu && !this._contextMenu.contains(e.target)) {
            this._hideMenu();
        }
    }

    _showMenu(x, y) {
        if (!this._contextMenu) return;
        
        this._contextMenu.style.left = `${x}px`;
        this._contextMenu.style.top = `${y}px`;
        this._contextMenu.style.display = 'block';
        
        // Adjust position if menu would be off-screen
        const rect = this._contextMenu.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        if (rect.right > windowWidth) {
            this._contextMenu.style.left = `${x - rect.width}px`;
        }
        
        if (rect.bottom > windowHeight) {
            this._contextMenu.style.top = `${y - rect.height}px`;
        }
    }

    _hideMenu() {
        if (this._contextMenu) {
            this._contextMenu.style.display = 'none';
        }
    }

    _onCopyCoordinates() {
        if (!this._lastCoordinates || !this._mouseCoordinatesControl) {
            this._hideMenu();
            return;
        }
        
        const { lat, lng } = this._lastCoordinates;
        const currentFormat = this._mouseCoordinatesControl.getCurrentFormat();
        const textToCopy = formatCoordinates(lat, lng, currentFormat);
        
        this._copyToClipboard(textToCopy);
        this._hideMenu();
    }

    _onResetNorth() {
        if (this._map) {
            this._map.easeTo({
                pitch: 0,
                bearing: 0
            });
        }
        this._hideMenu();
    }

    _copyToClipboard(text) {
        if (!text || text.trim() === '') return;

        // Try modern clipboard API first
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => {
                showSuccess('Coordenadas copiadas!');
            }).catch(() => {
                this._fallbackCopyTextToClipboard(text);
            });
        } else {
            this._fallbackCopyTextToClipboard(text);
        }
    }

    _fallbackCopyTextToClipboard(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";

        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            document.execCommand('copy');
            showSuccess('Coordenadas copiadas!');
        } catch (err) {
            console.error('Error copying text:', err);
        }

        document.body.removeChild(textArea);
    }
}

export default ContextMenuControl;