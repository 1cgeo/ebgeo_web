// Path: js/sidebar/components/feature-photo-gallery.js

/**
 * @fileoverview Compact photo gallery component for the feature panel.
 * Displays feature images in a grid with add button.
 */

import userDataManager from '@js/user_data/user_data_manager.js';
import { getEventBus, isCurrentMapLockedSync } from '@store/index.js';
import { EventTypes, FeatureUpdateProperty } from '@events/index.js';
import { showConfirm } from '@modals/index.js';
import { showWarning } from '@utils/index.js';

/** @type {Array<Object>|null} Current gallery images for viewer navigation */
let _viewerImages = null;

/** @type {(() => void)|null} Closes the open lightbox, if any (for panel cleanup). */
let activeImageViewerClose = null;

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

    const mapLocked = isCurrentMapLockedSync();
    const container = document.createElement('div');
    container.className = 'feature-photo-gallery';

    // Header
    const header = document.createElement('div');
    header.className = 'feature-photo-gallery-header';

    const title = document.createElement('span');
    title.className = 'feature-photo-gallery-title';
    title.textContent = 'Fotos / Imagens';

    header.appendChild(title);

    if (!mapLocked) {
        const addButton = document.createElement('button');
        addButton.className = 'feature-photo-gallery-add-btn';
        addButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Adicionar
        `;
        addButton.addEventListener('click', () => {
            if (isCurrentMapLockedSync()) return;
            fileInput.click();
        });
        header.appendChild(addButton);
    }

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
    fileInput.className = 'feature-photo-gallery__file-input';
    container.appendChild(fileInput);

    /**
     * Renders the images in the grid.
     */
    async function renderImages() {
        grid.innerHTML = '';

        const images = await userDataManager.getImages(featureId, featureType);

        // When map is locked and no images, hide the entire gallery
        if (mapLocked && images.length === 0) {
            container.classList.add('feature-photo-gallery--hidden');
            return;
        }
        container.classList.remove('feature-photo-gallery--hidden');

        // Show images (limited to 5 in compact mode + add button)
        const maxVisible = compact ? 5 : images.length;
        const visibleImages = images.slice(0, maxVisible);

        visibleImages.forEach(img => {
            const card = mapLocked
                ? createReadOnlyImageCard(img, images)
                : createImageCard(img, featureId, featureType, renderImages, images);
            grid.appendChild(card);
        });

        // Add button card (hide when map is locked)
        if (!mapLocked && images.length <= 2) {
            const addCard = createAddCard(fileInput);
            grid.appendChild(addCard);
        }

        // Update counter
        if (images.length > 0) {
            counter.textContent = `${images.length} ${images.length === 1 ? 'imagem anexada' : 'imagens anexadas'}`;
            counter.classList.remove('feature-photo-gallery-counter--hidden');
        } else {
            counter.textContent = '';
            counter.classList.add('feature-photo-gallery-counter--hidden');
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
            // Close any open lightbox so its overlay + document keydown listener
            // are not orphaned when the panel closes without an explicit close.
            if (activeImageViewerClose) activeImageViewerClose();
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
 * @param {Array<Object>} allImages - All images for navigation
 * @returns {HTMLElement} Image card element
 */
function createImageCard(imageData, featureId, featureType, onDelete, allImages) {
    const card = document.createElement('div');
    card.className = 'feature-photo-gallery-card';

    const img = document.createElement('img');
    img.src = imageData.thumbnail || imageData.data;
    img.alt = imageData.name || 'Imagem';
    img.loading = 'lazy';

    // Click to view full size
    img.addEventListener('click', () => {
        openImageViewer(imageData, allImages);
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
 * Creates a read-only image card (no delete button).
 * @param {Object} imageData - Image data object
 * @param {Array<Object>} allImages - All images for navigation
 * @returns {HTMLElement} Image card element
 */
function createReadOnlyImageCard(imageData, allImages) {
    const card = document.createElement('div');
    card.className = 'feature-photo-gallery-card';

    const img = document.createElement('img');
    img.src = imageData.thumbnail || imageData.data;
    img.alt = imageData.name || 'Imagem';
    img.loading = 'lazy';

    img.addEventListener('click', () => {
        openImageViewer(imageData, allImages);
    });

    card.appendChild(img);
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
 * Opens full-screen image viewer with navigation and download.
 * @param {Object} imageData - Image data object
 * @param {Array<Object>} [allImages=[]] - All images for navigation
 */
function openImageViewer(imageData, allImages = []) {
    _viewerImages = allImages.length > 1 ? allImages : null;
    let currentIndex = _viewerImages
        ? _viewerImages.findIndex(i => i.id === imageData.id)
        : 0;

    const overlay = document.createElement('div');
    overlay.className = 'feature-photo-viewer-overlay';

    const viewer = document.createElement('div');
    viewer.className = 'feature-photo-viewer';

    const img = document.createElement('img');
    img.src = imageData.data;
    img.alt = imageData.name || 'Imagem';

    // Top-right actions (download + close)
    const actionsBar = document.createElement('div');
    actionsBar.className = 'feature-photo-viewer-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'feature-photo-viewer-action-btn';
    downloadBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    downloadBtn.title = 'Baixar imagem';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'feature-photo-viewer-action-btn';
    closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    closeBtn.title = 'Fechar';

    actionsBar.appendChild(downloadBtn);
    actionsBar.appendChild(closeBtn);

    // Counter label
    const counterLabel = document.createElement('div');
    counterLabel.className = 'feature-photo-viewer-counter';

    function updateCounter() {
        if (_viewerImages) {
            counterLabel.textContent = `${currentIndex + 1} / ${_viewerImages.length}`;
            counterLabel.classList.remove('feature-photo-viewer-counter--hidden');
        } else {
            counterLabel.classList.add('feature-photo-viewer-counter--hidden');
        }
    }

    // Navigation arrows
    let prevBtn = null;
    let nextBtn = null;

    if (_viewerImages) {
        prevBtn = document.createElement('button');
        prevBtn.className = 'feature-photo-viewer-nav feature-photo-viewer-nav--prev';
        prevBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
        prevBtn.title = 'Anterior';

        nextBtn = document.createElement('button');
        nextBtn.className = 'feature-photo-viewer-nav feature-photo-viewer-nav--next';
        nextBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
        nextBtn.title = 'Próxima';

        prevBtn.addEventListener('click', (e) => { e.stopPropagation(); navigate(-1); });
        nextBtn.addEventListener('click', (e) => { e.stopPropagation(); navigate(1); });
    }

    function navigate(direction) {
        if (!_viewerImages) return;
        currentIndex = (currentIndex + direction + _viewerImages.length) % _viewerImages.length;
        const current = _viewerImages[currentIndex];
        img.src = current.data;
        img.alt = current.name || 'Imagem';
        updateCounter();
    }

    function getCurrentImage() {
        return _viewerImages ? _viewerImages[currentIndex] : imageData;
    }

    downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userDataManager.downloadImage(getCurrentImage());
    });

    const handleKeydown = (e) => {
        if (e.key === 'Escape') {
            closeViewer();
        } else if (_viewerImages && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
            e.preventDefault();
            navigate(-1);
        } else if (_viewerImages && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
            e.preventDefault();
            navigate(1);
        }
    };

    const closeViewer = () => {
        document.removeEventListener('keydown', handleKeydown);
        _viewerImages = null;
        overlay.remove();
        activeImageViewerClose = null;
    };
    // Expose so the gallery's cleanup() can close an open lightbox when the feature
    // panel closes without an explicit viewer close (overlay + keydown leak).
    activeImageViewerClose = closeViewer;

    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeViewer(); });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeViewer();
    });

    document.addEventListener('keydown', handleKeydown);

    viewer.appendChild(img);
    viewer.appendChild(actionsBar);
    viewer.appendChild(counterLabel);
    if (prevBtn) viewer.appendChild(prevBtn);
    if (nextBtn) viewer.appendChild(nextBtn);
    overlay.appendChild(viewer);
    document.body.appendChild(overlay);

    updateCounter();
}
