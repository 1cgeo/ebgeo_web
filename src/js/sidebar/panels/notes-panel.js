// Path: js/sidebar/panels/notes-panel.js

/**
 * @fileoverview Map notes panel with Quill.js rich text editing.
 * Provides view/edit modes for map notes with image compression.
 *
 * @module sidebar/panels/notes-panel
 */

import { getMapNotes, setMapNotes } from '@store/index.js';
import {
    sanitizeQuillHtml,
    cleanQuillContent,
    handleQuillImageUpload
} from '@utils/quill-helpers.js';
import { showSuccess, showError } from '@utils/index.js';

// Re-export for backward compatibility
export { sanitizeQuillHtml, cleanQuillContent } from '@utils/quill-helpers.js';

// Alias export for backward compatibility with code that imports sanitizeHtml
export const sanitizeHtml = sanitizeQuillHtml;

// ============================================================================
// NOTES PANEL CONTENT CREATION
// ============================================================================

/**
 * Creates the notes panel content with view/edit modes.
 *
 * @param {Object} options - Options
 * @param {string} options.mapName - Map name for notes
 * @param {boolean} [options.readOnly=false] - Whether notes are read-only (locked map)
 * @returns {Promise<{ element: HTMLElement, cleanup: Function }>}
 */
export async function createNotesPanelContent({ mapName, readOnly = false }) {
    // Load notes
    let notesData;
    try {
        const notes = await getMapNotes(mapName);
        notesData = {
            title: notes?.title || '',
            description: notes?.description || ''
        };
    } catch (error) {
        console.error('Error loading notes:', error);
        notesData = { title: '', description: '' };
    }

    // Create content wrapper
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'map-notes-sidebar-content';

    // Track Quill instance
    let quillInstance = null;

    // --- VIEW MODE ELEMENTS ---
    const viewContainer = document.createElement('div');
    viewContainer.className = 'map-notes-view-container';

    // Edit button (shown in view mode)
    const editBtn = document.createElement('button');
    editBtn.className = 'map-notes-sidebar-edit-btn';
    editBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Editar
    `;

    // Title display (view mode)
    const titleDisplay = document.createElement('div');
    titleDisplay.className = 'map-notes-sidebar-title-display';
    titleDisplay.textContent = notesData.title || 'Sem título';
    if (!notesData.title) {
        titleDisplay.classList.add('map-notes-sidebar-placeholder');
    }

    // Description display (view mode) - renders sanitized HTML from Quill
    const descDisplay = document.createElement('div');
    descDisplay.className = 'map-notes-sidebar-desc-display map-notes-quill-content';
    if (notesData.description) {
        // Sanitize HTML before rendering to prevent XSS
        descDisplay.innerHTML = sanitizeQuillHtml(notesData.description);
    } else {
        descDisplay.innerHTML = '<p class="map-notes-sidebar-placeholder">Clique em editar para adicionar uma descrição...</p>';
    }

    // Download button (shown in view mode)
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'map-notes-sidebar-download-btn';
    downloadBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Baixar
    `;
    downloadBtn.onclick = () => {
        _downloadNotes(notesData, mapName);
    };

    // Button row
    const viewBtnRow = document.createElement('div');
    viewBtnRow.className = 'map-notes-sidebar-view-actions';

    if (!readOnly) {
        viewBtnRow.appendChild(editBtn);
    }
    viewBtnRow.appendChild(downloadBtn);

    viewContainer.appendChild(viewBtnRow);
    viewContainer.appendChild(titleDisplay);
    viewContainer.appendChild(descDisplay);

    // --- EDIT MODE ELEMENTS ---
    const editContainer = document.createElement('div');
    editContainer.className = 'map-notes-edit-container map-notes-edit-container--hidden';

    // Title section
    const titleSection = document.createElement('div');
    titleSection.className = 'map-notes-sidebar-title-section';

    const titleLabel = document.createElement('label');
    titleLabel.textContent = 'Título';
    titleLabel.className = 'map-notes-sidebar-label';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'map-notes-sidebar-title-input';
    titleInput.placeholder = 'Título da nota...';
    titleInput.value = notesData.title;
    titleInput.maxLength = 100;

    titleSection.appendChild(titleLabel);
    titleSection.appendChild(titleInput);

    // Description section with Quill editor
    const descSection = document.createElement('div');
    descSection.className = 'map-notes-sidebar-desc-section';

    const descLabel = document.createElement('label');
    descLabel.textContent = 'Descrição';
    descLabel.className = 'map-notes-sidebar-label';

    // Quill editor container
    const quillContainer = document.createElement('div');
    quillContainer.className = 'map-notes-quill-container';

    const quillEditor = document.createElement('div');
    quillEditor.className = 'map-notes-quill-editor';

    quillContainer.appendChild(quillEditor);
    descSection.appendChild(descLabel);
    descSection.appendChild(quillContainer);

    // Buttons container
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'map-notes-sidebar-buttons';

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'map-notes-sidebar-cancel-btn';
    cancelBtn.textContent = 'Cancelar';

    // Save button
    const saveBtn = document.createElement('button');
    saveBtn.className = 'map-notes-sidebar-save-btn';
    saveBtn.textContent = 'Salvar';

    buttonsContainer.appendChild(cancelBtn);
    buttonsContainer.appendChild(saveBtn);

    editContainer.appendChild(titleSection);
    editContainer.appendChild(descSection);
    editContainer.appendChild(buttonsContainer);

    // --- QUILL INITIALIZATION ---
    const initQuill = async () => {
        if (quillInstance) return;

        // Dynamic import Quill and its CSS
        const [{ default: Quill }] = await Promise.all([
            import('quill'),
            import('quill/dist/quill.snow.css')
        ]);

        quillInstance = new Quill(quillEditor, {
            theme: 'snow',
            placeholder: 'Digite a descrição...',
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'color': [] }, { 'background': [] }],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    [{ 'indent': '-1' }, { 'indent': '+1' }],
                    [{ 'align': [] }],
                    ['link', 'image'],
                    ['clean']
                ]
            }
        });

        // Set initial content (sanitized for safety)
        if (notesData.description) {
            quillInstance.root.innerHTML = sanitizeQuillHtml(notesData.description);
        }

        // Setup image handler for compression
        const toolbar = quillInstance.getModule('toolbar');
        toolbar.addHandler('image', () => handleQuillImageUpload(quillInstance));
    };

    // --- MODE SWITCHING ---
    const switchToEditMode = async () => {
        viewContainer.classList.add('map-notes-view-container--hidden');
        editContainer.classList.remove('map-notes-edit-container--hidden');

        // Initialize Quill on first edit
        await initQuill();

        // Reset content to current stored data (sanitized for safety)
        if (quillInstance) {
            quillInstance.root.innerHTML = sanitizeQuillHtml(notesData.description || '');
        }

        titleInput.focus();
    };

    const switchToViewMode = (updatedData = null) => {
        editContainer.classList.add('map-notes-edit-container--hidden');
        viewContainer.classList.remove('map-notes-view-container--hidden');

        if (updatedData) {
            // Update view with new data
            titleDisplay.textContent = updatedData.title || 'Sem título';
            titleDisplay.classList.toggle('map-notes-sidebar-placeholder', !updatedData.title);

            if (updatedData.description) {
                // Sanitize HTML before rendering to prevent XSS
                descDisplay.innerHTML = sanitizeQuillHtml(updatedData.description);
                descDisplay.classList.remove('map-notes-sidebar-placeholder');
            } else {
                descDisplay.innerHTML = '<p class="map-notes-sidebar-placeholder">Clique em editar para adicionar uma descrição...</p>';
            }
        }
    };

    // Edit button click
    editBtn.onclick = switchToEditMode;

    // Cancel button click
    cancelBtn.onclick = () => {
        // Reset inputs to original values
        titleInput.value = notesData.title;
        if (quillInstance) {
            quillInstance.root.innerHTML = sanitizeQuillHtml(notesData.description || '');
        }
        switchToViewMode();
    };

    // Save button click
    saveBtn.onclick = async () => {
        try {
            const description = quillInstance ? cleanQuillContent(quillInstance.root.innerHTML) : '';
            const notes = {
                title: titleInput.value.trim(),
                description: description
            };
            await setMapNotes(mapName, notes);

            // Update stored data
            notesData.title = notes.title;
            notesData.description = notes.description;

            // Switch back to view mode with updated data
            switchToViewMode(notes);

            showSuccess('Notas salvas com sucesso!');
        } catch (error) {
            console.error('Error saving notes:', error);
            showError('Erro ao salvar notas');
        }
    };

    contentWrapper.appendChild(viewContainer);
    contentWrapper.appendChild(editContainer);

    // Cleanup function
    const cleanup = () => {
        if (quillInstance) {
            quillInstance = null;
        }
    };

    return {
        element: contentWrapper,
        cleanup,
        title: `Notas: ${mapName}`
    };
}

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Downloads notes as an HTML file.
 * @param {Object} notesData - Notes data with title and description
 * @param {string} mapName - Map name for filename
 */
function _downloadNotes(notesData, mapName) {
    const title = notesData.title || 'Sem título';
    const description = notesData.description || '';

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; }
h1 { border-bottom: 2px solid #e5e7eb; padding-bottom: 12px; }
img { max-width: 100%; height: auto; }
</style>
</head>
<body>
<h1>${title}</h1>
${description}
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${mapName}_notas.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
