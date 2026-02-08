// Path: js/sidebar/components/feature-photo-gallery.js

/**
 * @fileoverview Compact photo gallery component for the feature panel.
 * Displays feature images in a grid with add button.
 */

import userDataManager from '../../user_data/user_data_manager.js';
import { getEventBus, isCurrentMapLockedSync } from '../../store/index.js';
import { EventTypes, FeatureUpdateProperty } from '../../events/index.js';
import { showConfirm } from '../../modals/index.js';
import { showWarning } from '../../utilities';

/**
 * Creates the photo gallery section for the feature panel.
 * @param {Object} options - Configuration options
 * @param {string} options.featureId - Feature ID
 * @param {string} options.featureType - Feature type
 * @param {boolean} [options.compact=true] - Use compact mode (3 columns grid)
 * @returns {Promise<Object>} Object with element and cleanup function
 */
export async function createPhotoGallery(options) {
    const { featureId, featureType, compact = true } = options;

    const container = document.createElement('div');
    container.className = 'feature-photo-gallery';

    // Header
    const header = document.createElement('div');
    header.className = 'feature-photo-gallery-header';

    const title = document.createElement('span');
    title.className = 'feature-photo-gallery-title';
    title.textContent = 'Fotos / Imagens';

    const addButton = document.createElement('button');
    addButton.className = 'feature-photo-gallery-add-btn';
    addButton.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Adicionar
    `;

    header.appendChild(title);
    header.appendChild(addButton);
    container.appendChild(header);

    // Grid container
    const grid = document.createElement('div');
    grid.className = 'feature-photo-gallery-grid';
    container.appendChild(grid);

    // Counter label
    const counter = document.createElement('div');
    counter.className = 'feature-photo-gallery-counter';
    container.appendChild(counter);

    // Hidden file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/gif,image/webp';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    container.appendChild(fileInput);

    /**
     * Renders the images in the grid.
     */
    async function renderImages() {
        grid.innerHTML = '';

        const images = await userDataManager.getImages(featureId, featureType);

        // Show images (limited to 5 in compact mode + add button)
        const maxVisible = compact ? 5 : images.length;
        const visibleImages = images.slice(0, maxVisible);

        visibleImages.forEach(img => {
            const card = createImageCard(img, featureId, featureType, renderImages);
            grid.appendChild(card);
        });

        // Add button card (hide when map is locked)
        if (!isCurrentMapLockedSync() && images.length <= 2) {
            const addCard = createAddCard(fileInput);
            grid.appendChild(addCard);
        }

        // Update counter
        if (images.length > 0) {
            counter.textContent = `${images.length} ${images.length === 1 ? 'imagem anexada' : 'imagens anexadas'}`;
            counter.style.display = 'block';
        } else {
            counter.textContent = '';
            counter.style.display = 'none';
        }
    }

    // File input handler
    fileInput.addEventListener('change', async (e) => {
        if (isCurrentMapLockedSync()) { fileInput.value = ''; return; }
        if (e.target.files?.length) {
            for (const file of Array.from(e.target.files)) {
                if (!file.type.startsWith('image/')) continue;
                if (file.size > 10 * 1024 * 1024) {
                    showWarning(`${file.name} excede 10MB`);
                    continue;
                }
                await userDataManager.addImage(featureId, featureType, file);
            }
            fileInput.value = '';
        }
    });

    // Add button click
    addButton.addEventListener('click', () => {
        if (isCurrentMapLockedSync()) return;
        fileInput.click();
    });

    // Subscribe to image updates
    let unsubscribe = null;
    try {
        const eventBus = getEventBus();
        unsubscribe = eventBus.on(EventTypes.FEATURE_UPDATED, (payload) => {
            if (payload.featureId === featureId &&
                payload.featureType === featureType &&
                payload.property === FeatureUpdateProperty.IMAGES) {
                renderImages();
            }
        });
    } catch {
        // EventBus not available
    }

    // Initial render
    await renderImages();

    return {
        element: container,
        cleanup: () => {
            if (unsubscribe) unsubscribe();
        },
        refresh: renderImages
    };
}

/**
 * Creates an image card for the grid.
 * @param {Object} imageData - Image data object
 * @param {string} featureId - Feature ID
 * @param {string} featureType - Feature type
 * @param {Function} onDelete - Callback after delete
 * @returns {HTMLElement} Image card element
 */
function createImageCard(imageData, featureId, featureType, onDelete) {
    const card = document.createElement('div');
    card.className = 'feature-photo-gallery-card';

    const img = document.createElement('img');
    img.src = imageData.thumbnail || imageData.data;
    img.alt = imageData.name || 'Imagem';
    img.loading = 'lazy';

    // Click to view full size
    img.addEventListener('click', () => {
        openImageViewer(imageData);
    });

    // Delete button (shown on hover)
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'feature-photo-gallery-delete';
    deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
    deleteBtn.title = 'Remover imagem';

    deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = await showConfirm('Remover esta imagem?', { destructive: true });
        if (confirmed) {
            await userDataManager.removeImage(featureId, featureType, imageData.id);
            if (onDelete) onDelete();
        }
    });

    card.appendChild(img);
    card.appendChild(deleteBtn);

    return card;
}

/**
 * Creates the add button card.
 * @param {HTMLInputElement} fileInput - Hidden file input
 * @returns {HTMLElement} Add card element
 */
function createAddCard(fileInput) {
    const card = document.createElement('div');
    card.className = 'feature-photo-gallery-card feature-photo-gallery-add-card';
    card.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    card.title = 'Adicionar imagem';

    card.addEventListener('click', () => {
        if (isCurrentMapLockedSync()) return;
        fileInput.click();
    });

    return card;
}

/**
 * Opens full-screen image viewer.
 * @param {Object} imageData - Image data object
 */
function openImageViewer(imageData) {
    const overlay = document.createElement('div');
    overlay.className = 'feature-photo-viewer-overlay';

    const viewer = document.createElement('div');
    viewer.className = 'feature-photo-viewer';

    const img = document.createElement('img');
    img.src = imageData.data;
    img.alt = imageData.name || 'Imagem';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'feature-photo-viewer-close';
    closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    closeBtn.title = 'Fechar';

    // Escape key to close - declared before closeViewer so it can be removed in all close paths
    const handleKeydown = (e) => {
        if (e.key === 'Escape') {
            closeViewer();
        }
    };

    const closeViewer = () => {
        document.removeEventListener('keydown', handleKeydown);
        overlay.remove();
    };

    closeBtn.addEventListener('click', closeViewer);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeViewer();
    });

    document.addEventListener('keydown', handleKeydown);

    viewer.appendChild(img);
    viewer.appendChild(closeBtn);
    overlay.appendChild(viewer);
    document.body.appendChild(overlay);
}
