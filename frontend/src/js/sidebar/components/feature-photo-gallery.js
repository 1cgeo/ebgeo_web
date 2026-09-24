// Path: js/sidebar/components/feature-photo-gallery.js

/**
 * @fileoverview Compact photo gallery component for the feature panel.
 * Displays feature images in a grid with add button.
 *
 * WHO SEES THE WRITING COMMANDS is decided by `photo-gallery-affordance.js`, on BOTH axes: a
 * Leitor or a Comentarista (POSTO) and a locked map (ESTADO) get the pictures and the lightbox,
 * and no "Adicionar", no "+" card, no delete and no file input. Until 2026-09-22 this file asked
 * only about the lock, and the "+" card reached the picker for a reader.
 */

import userDataManager from '@js/user_data/user_data_manager.js';
import { getEventBus } from '@store/index.js';
import { edicaoIndisponivelSync, semEdicaoSync } from '@store/edicao-indisponivel.js';
import { unavailableEditNotice } from '@store/denial-phrases.js';
import { EventTypes, FeatureUpdateProperty } from '@events/index.js';
import { showConfirm } from '@modals/index.js';
import { showError, showWarning } from '@utils/index.js';
import { validateImagePayload, IMAGE_CONFIG } from '@utils/image_utils.js';
import { photoGalleryAffordances } from './photo-gallery-affordance.js';
import { mostrarFotoInteira } from '@js/user_data/photo-source.js';
import { photoNotArrivedNotice } from '@utils/image-limit-phrases.js';

/** @type {Array<Object>|null} Current gallery images for viewer navigation */
let _viewerImages = null;

/** @type {(() => void)|null} Closes the open lightbox, if any (for panel cleanup). */
let activeImageViewerClose = null;

/**
 * Re-asks, at the moment of a writing gesture, whether editing is still available, and says why
 * when it is not.
 *
 * The build already hid every writing command when editing was unavailable; this covers the
 * other order, a panel drawn while editing was free and a peer locking the map (or the role
 * dropping) before the click. The command is on screen then, so the click is how the reason
 * reaches the person, and it is refused NAMING the state or the capability, never in silence.
 * @returns {boolean} true when the gesture was refused (and the refusal was said).
 */
function refusedNow() {
    const notice = unavailableEditNotice(edicaoIndisponivelSync());
    if (!notice) return false;
    showWarning(notice);
    return true;
}

/**
 * Creates the photo gallery section for the feature panel.
 * @param {Object} options - Configuration options
 * @param {string} options.featureId - Feature ID
 * @param {string} options.featureType - Feature type
 * @param {boolean} [options.compact=true] - Use compact mode (3 columns grid)
 * @param {boolean} [options.readOnly] - Whether editing is unavailable (role or lock). The panel
 *   passes the answer it used for itself, so the two agree on the same instant; when omitted the
 *   gallery asks the single account of both axes (`semEdicaoSync`).
 * @returns {Promise<Object>} Object with element and cleanup function
 */
export async function createPhotoGallery(options) {
    const { featureId, featureType, compact = true } = options;

    const readOnly = typeof options.readOnly === 'boolean' ? options.readOnly : semEdicaoSync();
    // `canAdd`/`canRemove` do not depend on the count, so the header and the file input are
    // decided once here; the grid asks again per render, with the real count.
    const { canAdd } = photoGalleryAffordances({ readOnly, imageCount: 0, compact });
    const container = document.createElement('div');
    container.className = 'feature-photo-gallery';

    // Header
    const header = document.createElement('div');
    header.className = 'feature-photo-gallery-header';

    const title = document.createElement('span');
    title.className = 'feature-photo-gallery-title';
    title.textContent = 'Fotos / Imagens';

    header.appendChild(title);
    container.appendChild(header);

    // Grid container
    const grid = document.createElement('div');
    grid.className = 'feature-photo-gallery-grid';
    container.appendChild(grid);

    // Counter label
    const counter = document.createElement('div');
    counter.className = 'feature-photo-gallery-counter';
    container.appendChild(counter);

    // The file input exists only where adding exists: for whoever cannot edit there is no door
    // to a picker at all, not a hidden one.
    const fileInput = canAdd ? createFileInput() : null;
    if (fileInput) container.appendChild(fileInput);

    const openPicker = () => {
        if (!fileInput || refusedNow()) return;
        fileInput.click();
    };

    if (canAdd) {
        const addButton = document.createElement('button');
        addButton.className = 'feature-photo-gallery-add-btn';
        addButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Adicionar
        `;
        addButton.addEventListener('click', openPicker);
        header.appendChild(addButton);
    }

    /**
     * Renders the images in the grid.
     */
    async function renderImages() {
        grid.innerHTML = '';

        const images = await userDataManager.getImages(featureId, featureType);
        const view = photoGalleryAffordances({ readOnly, imageCount: images.length, compact });

        // Read-only with no picture: nothing to show and nothing to offer, so no section at all.
        container.classList.toggle('feature-photo-gallery--hidden', view.hidden);
        if (view.hidden) return;

        images.slice(0, view.visibleCount).forEach(img => {
            const card = view.canRemove
                ? createImageCard(img, featureId, featureType, renderImages, images)
                : createReadOnlyImageCard(img, images);
            grid.appendChild(card);
        });

        if (view.showAddCard) {
            grid.appendChild(createAddCard(openPicker));
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

    // File input handler. Asked AGAIN here, because the state can change while the picker is
    // open, and a picture chosen after the lock would otherwise be processed and then refused.
    fileInput?.addEventListener('change', async (e) => {
        if (refusedNow()) { fileInput.value = ''; return; }
        if (e.target.files?.length) {
            const arquivos = Array.from(e.target.files);
            for (const file of arquivos) {
                // ONE gate, shared with every other door a picture enters through. The pair of
                // hand-rolled tests that stood here repeated the 10 MB ceiling as a literal and
                // accepted formats (`image/*`) that `addImage` then refused with nothing but a
                // `console.warn`: the person picked a GIF and the gallery simply did not change.
                const validation = await validateImagePayload(file);
                if (!validation.valid) {
                    // The name only when there are several, or a single refusal reads as a list.
                    const rotulo = arquivos.length > 1 ? `${file.name}: ` : '';
                    showError(`${rotulo}${validation.reason}`);
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
        // Before the confirmation, not after: asking "remover?" to refuse the answer spends the
        // gesture on a no. `refusedNow` names the state or the capability.
        if (refusedNow()) return;
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
 * @param {() => void} openPicker - Opens the file picker, re-asking about editing first
 * @returns {HTMLElement} Add card element
 */
function createAddCard(openPicker) {
    const card = document.createElement('div');
    card.className = 'feature-photo-gallery-card feature-photo-gallery-add-card';
    card.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    card.title = 'Adicionar imagem';

    card.addEventListener('click', openPicker);

    return card;
}

/**
 * The hidden file input of the gallery, built only for whoever can add a picture.
 * @returns {HTMLInputElement}
 */
function createFileInput() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    // The allowlist the gate (and the server) actually enforce: offering GIF in the picker only
    // led to a file `addImage` refused with nothing but a `console.warn`.
    fileInput.accept = IMAGE_CONFIG.allowedTypes.join(',');
    fileInput.multiple = true;
    fileInput.className = 'feature-photo-gallery__file-input';
    return fileInput;
}

/**
 * Opens full-screen image viewer with navigation and download.
 *
 * Exported because it is the app's ONE lightbox: download button, styled close,
 * arrow-key navigation and a counter. Read-only callers outside this gallery
 * (the first-person marker card, for one) reuse it rather than growing a fourth
 * hand-rolled overlay: the repo already carries two simpler copies.
 *
 * `imageData` needs only `data` (anything `img.src` and `<a download>` accept,
 * including a plain same-origin URL) and `name` (the download filename).
 *
 * @param {Object} imageData - Image data object
 * @param {Array<Object>} [allImages=[]] - All images for navigation
 */
export function openImageViewer(imageData, allImages = []) {
    _viewerImages = allImages.length > 1 ? allImages : null;
    let currentIndex = _viewerImages
        ? _viewerImages.findIndex(i => i.id === imageData.id)
        : 0;

    const overlay = document.createElement('div');
    overlay.className = 'feature-photo-viewer-overlay';

    const viewer = document.createElement('div');
    viewer.className = 'feature-photo-viewer';

    const img = document.createElement('img');
    img.alt = imageData.name || 'Imagem';
    // The WHOLE photo, in either shape (inline or held by reference): the thumbnail at once, then
    // the photo; a photo whose bytes did not arrive yet keeps the thumbnail and says so.
    const aoFaltar = () => showWarning(photoNotArrivedNotice());
    let soltarFoto = mostrarFotoInteira(img, imageData, { aoFaltar });

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
        soltarFoto();
        soltarFoto = mostrarFotoInteira(img, current, { aoFaltar });
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
        soltarFoto();
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
