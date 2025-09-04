// Path: js\controls_sig\map_notes_panel.js
import { showSuccess, showError } from './utilities/toast_service.js';
import { 
    getMapNotes, 
    setMapNotes, 
    getCurrentMapNameSync 
} from './store/store.js';

/**
 * Manager class that coordinates between view and edit panels
 */
export class MapNotesManager {
    constructor(mapControl, mapManager) {
        this.mapControl = mapControl;
        this.mapManager = mapManager;
        
        this.viewPanel = null;
        this.editPanel = null;
        this.currentMapName = null;
        this.isVisible = false;
    }

    createPanels() {
        this.viewPanel = new MapNotesViewPanel(this);
        this.editPanel = new MapNotesEditPanel(this);
        
        // Append panels to body
        document.body.appendChild(this.viewPanel.createUI());
        document.body.appendChild(this.editPanel.createUI());
    }

    async showViewPanel(mapName) {
        this.currentMapName = mapName;
        
        // Collapse map control
        this.mapControl.collapsePanel();
        
        // Load notes data
        const notesData = await this.loadNotes(mapName);
        
        // Hide edit panel and show view panel
        this.editPanel.hide();
        this.viewPanel.show(mapName, notesData);
        
        this.isVisible = true;
    }

    async switchToEditMode() {
        if (!this.currentMapName) return;
        
        // Load fresh data for editing
        const notesData = await this.loadNotes(this.currentMapName);
        
        // Switch panels
        this.viewPanel.hide();
        this.editPanel.show(this.currentMapName, notesData);
    }

    async switchToViewMode(savedData = null) {
        if (!this.currentMapName) return;
        
        // Load data (use saved data if provided, otherwise reload)
        let notesData;
        if (savedData) {
            notesData = savedData;
        } else {
            notesData = await this.loadNotes(this.currentMapName);
        }
        
        // Switch panels
        this.editPanel.hide();
        this.viewPanel.show(this.currentMapName, notesData);
    }

    hideAllPanels() {
        if (!this.isVisible) return;
        
        this.viewPanel.hide();
        this.editPanel.hide();
        this.currentMapName = null;
        this.isVisible = false;
        
        // Expand map control
        this.mapControl.expandPanel();
    }

    async loadNotes(mapName) {
        try {
            const notes = await getMapNotes(mapName);
            
            if (notes && (notes.title || notes.description)) {
                return {
                    title: notes.title || '',
                    description: notes.description || ''
                };
            } else {
                return {
                    title: '',
                    description: ''
                };
            }
        } catch (error) {
            console.error('Erro ao carregar notas:', error);
            showError('Erro ao carregar notas do mapa');
            return {
                title: '',
                description: ''
            };
        }
    }

    async saveNotes(title, description) {
        if (!this.currentMapName) return false;
        
        try {
            // Clean description - don't save empty Quill content
            const cleanDescription = description === '<p><br></p>' ? '' : description;
            
            const notes = {
                title: title.trim(),
                description: cleanDescription
            };
            
            await setMapNotes(this.currentMapName, notes);
            showSuccess('Notas salvas com sucesso!');
            
            return notes;
        } catch (error) {
            console.error('Erro ao salvar notas:', error);
            showError('Erro ao salvar notas');
            return false;
        }
    }

    // Methods for map_control.js compatibility
    get isEditMode() {
        return this.editPanel && this.editPanel.isVisible;
    }

    async saveCurrentMapNotes() {
        if (this.editPanel && this.editPanel.isVisible) {
            await this.editPanel.saveNotes();
        }
    }

    destroy() {
        if (this.viewPanel) {
            this.viewPanel.destroy();
            this.viewPanel = null;
        }
        
        if (this.editPanel) {
            this.editPanel.destroy();
            this.editPanel = null;
        }
        
        this.isVisible = false;
    }
}

/**
 * View-only panel for displaying notes
 */
class MapNotesViewPanel {
    constructor(manager) {
        this.manager = manager;
        this.container = null;
        this.titleDisplay = null;
        this.descriptionDisplay = null;
        this.isVisible = false;
    }

    createUI() {
        if (this.container) return this.container;

        this.container = document.createElement('div');
        this.container.className = 'map-notes-view-panel';
        this.container.style.display = 'none';

        // Header
        const header = document.createElement('div');
        header.className = 'map-notes-header';

        const closeButton = document.createElement('button');
        closeButton.className = 'map-notes-close-btn';
        closeButton.title = 'Fechar notas';
        closeButton.innerHTML = `
            <svg viewBox="0 0 24 24" width="20" height="20">
                <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
            </svg>
        `;
        closeButton.addEventListener('click', () => this.manager.hideAllPanels());

        const title = document.createElement('span');
        title.className = 'map-notes-header-title';
        title.textContent = 'Notas do Mapa';

        const editButton = document.createElement('button');
        editButton.className = 'map-notes-edit-btn';
        editButton.title = 'Editar notas';
        editButton.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
        `;
        editButton.addEventListener('click', () => this.manager.switchToEditMode());

        header.appendChild(closeButton);
        header.appendChild(title);
        header.appendChild(editButton);

        // Content
        const content = document.createElement('div');
        content.className = 'map-notes-content';

        // Title display
        this.titleDisplay = document.createElement('h2');
        this.titleDisplay.className = 'map-notes-title-display';

        // Description display
        this.descriptionDisplay = document.createElement('div');
        this.descriptionDisplay.className = 'map-notes-description-display';

        content.appendChild(this.titleDisplay);
        content.appendChild(this.descriptionDisplay);

        this.container.appendChild(header);
        this.container.appendChild(content);

        return this.container;
    }

    show(mapName, notesData) {
        // Update content
        this.titleDisplay.textContent = notesData.title || 'Título do Mapa';
        
        if (notesData.description && notesData.description.trim()) {
            this.descriptionDisplay.innerHTML = notesData.description;
        } else {
            this.descriptionDisplay.innerHTML = '<p class="map-notes-placeholder">Clique em editar para adicionar uma descrição...</p>';
        }

        // Show panel
        this.container.style.display = 'block';
        this.isVisible = true;
    }

    hide() {
        this.container.style.display = 'none';
        this.isVisible = false;
    }

    destroy() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.container = null;
        this.isVisible = false;
    }
}

/**
 * Edit panel with Quill editor
 */
class MapNotesEditPanel {
    constructor(manager) {
        this.manager = manager;
        this.container = null;
        this.titleInput = null;
        this.descriptionEditor = null;
        this.quillInstance = null;
        this.isVisible = false;
        this.originalData = null;
    }

    createUI() {
        if (this.container) return this.container;

        this.container = document.createElement('div');
        this.container.className = 'map-notes-edit-panel';
        this.container.style.display = 'none';

        // Header
        const header = document.createElement('div');
        header.className = 'map-notes-header';

        const cancelButton = document.createElement('button');
        cancelButton.className = 'map-notes-cancel-btn';
        cancelButton.title = 'Cancelar edição';
        cancelButton.innerHTML = `
            <svg viewBox="0 0 24 24" width="20" height="20">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
        `;
        cancelButton.addEventListener('click', () => this.cancelEdit());

        const title = document.createElement('span');
        title.className = 'map-notes-header-title';
        title.textContent = 'Editar Notas';

        const saveButton = document.createElement('button');
        saveButton.className = 'map-notes-header-save-btn';
        saveButton.title = 'Salvar notas';
        saveButton.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
        `;
        saveButton.addEventListener('click', () => this.saveNotes());

        header.appendChild(cancelButton);
        header.appendChild(title);
        header.appendChild(saveButton);

        // Content
        const content = document.createElement('div');
        content.className = 'map-notes-content';

        // Title input
        const titleSection = document.createElement('div');
        titleSection.className = 'map-notes-title-section';

        this.titleInput = document.createElement('input');
        this.titleInput.type = 'text';
        this.titleInput.className = 'map-notes-title-input';
        this.titleInput.placeholder = 'Digite o título do mapa...';
        this.titleInput.maxLength = 100;

        titleSection.appendChild(this.titleInput);

        // Description editor
        const descriptionSection = document.createElement('div');
        descriptionSection.className = 'map-notes-description-section';

        this.descriptionEditor = document.createElement('div');
        this.descriptionEditor.className = 'map-notes-description-editor';

        descriptionSection.appendChild(this.descriptionEditor);

        // Action buttons
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'map-notes-actions';

        const cancelBtnBottom = document.createElement('button');
        cancelBtnBottom.className = 'map-notes-cancel-bottom-btn';
        cancelBtnBottom.textContent = 'Cancelar';
        cancelBtnBottom.addEventListener('click', () => this.cancelEdit());

        const saveBtnBottom = document.createElement('button');
        saveBtnBottom.className = 'map-notes-save-btn';
        saveBtnBottom.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18">
                <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
            </svg>
            Salvar
        `;
        saveBtnBottom.addEventListener('click', () => this.saveNotes());

        actionsContainer.appendChild(cancelBtnBottom);
        actionsContainer.appendChild(saveBtnBottom);

        content.appendChild(titleSection);
        content.appendChild(descriptionSection);
        content.appendChild(actionsContainer);

        this.container.appendChild(header);
        this.container.appendChild(content);

        return this.container;
    }

    setupQuillEditor() {
        if (this.quillInstance || typeof Quill === 'undefined') return;

        this.quillInstance = new Quill(this.descriptionEditor, {
            theme: 'snow',
            placeholder: 'Digite a descrição do mapa...',
            modules: {
                toolbar: [
                    ['bold', 'italic'],
                    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                    ['link'],
                    ['clean']
                ]
            }
        });
    }

    show(mapName, notesData) {
        // Store original data for cancel functionality
        this.originalData = { ...notesData };

        // Setup Quill editor
        if (!this.quillInstance) {
            this.setupQuillEditor();
        }

        // Populate form
        this.titleInput.value = notesData.title || '';
        
        if (this.quillInstance) {
            this.quillInstance.root.innerHTML = notesData.description || '';
        }

        // Show panel and focus title
        this.container.style.display = 'block';
        this.isVisible = true;
        
        // Focus title input after a brief delay to ensure visibility
        setTimeout(() => {
            this.titleInput.focus();
        }, 100);
    }

    hide() {
        this.container.style.display = 'none';
        this.isVisible = false;
    }

    async saveNotes() {
        const title = this.titleInput.value.trim();
        const description = this.quillInstance ? this.quillInstance.root.innerHTML.trim() : '';
        
        const savedData = await this.manager.saveNotes(title, description);
        
        if (savedData) {
            // Switch back to view panel with saved data
            await this.manager.switchToViewMode(savedData);
        }
    }

    cancelEdit() {
        // Switch back to view panel with original data
        this.manager.switchToViewMode(this.originalData);
    }

    destroy() {
        if (this.quillInstance) {
            // Clean up Quill instance
            this.quillInstance = null;
        }
        
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        
        this.container = null;
        this.isVisible = false;
    }
}

// Default export for backward compatibility
export default MapNotesManager;