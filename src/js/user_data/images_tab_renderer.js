// Path: js/user_data/images_tab_renderer.js

/**
 * @fileoverview Renderer para a tab de Imagens.
 */

import userDataManager from './user_data_manager.js';
import { showConfirm } from '../modals/index.js';
import { isCurrentMapLockedSync } from '../store/index.js';

/**
 * Renderiza o conteúdo da tab de Imagens.
 *
 * @param {HTMLElement} container - Container onde renderizar
 * @param {string} featureId - ID da feature
 * @param {string} featureType - Tipo da feature
 * @returns {Promise<void>}
 */
export async function renderImagesContent(container, featureId, featureType) {
    container.innerHTML = '';

    const dropzone = createDropzone(featureId, featureType);
    container.appendChild(dropzone);

    const grid = document.createElement('div');
    grid.className = 'user-data-images-grid';
    container.appendChild(grid);

    const images = await userDataManager.getImages(featureId, featureType);

    if (images.length === 0) {
        renderEmptyState(grid, 'Nenhuma imagem anexada', '🖼️');
    } else {
        images.forEach(img => {
            const card = createImageCard(img, featureId, featureType);
            grid.appendChild(card);
        });
    }
}

/**
 * Cria dropzone para upload de imagens.
 * @private
 * @param {string} featureId - ID da feature
 * @param {string} featureType - Tipo da feature
 * @returns {HTMLElement} Elemento dropzone
 */
function createDropzone(featureId, featureType) {
    const dropzone = document.createElement('div');
    dropzone.className = 'user-data-dropzone';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/gif,image/webp';
    fileInput.multiple = true;
    fileInput.style.display = 'none';

    dropzone.innerHTML = `
        <div class="user-data-dropzone-icon">📷</div>
        <div class="user-data-dropzone-text">Clique ou arraste imagens aqui</div>
        <div class="user-data-dropzone-hint">JPEG, PNG, GIF ou WebP (máx. 10MB)</div>
    `;
    dropzone.appendChild(fileInput);

    const handleFiles = async (files) => {
        for (const file of files) {
            if (!file.type.startsWith('image/')) continue;
            if (file.size > 10 * 1024 * 1024) {
                alert(`${file.name} excede 10MB`);
                continue;
            }
            await userDataManager.addImage(featureId, featureType, file);
        }
    };

    dropzone.addEventListener('click', (e) => {
        if (isCurrentMapLockedSync()) return;
        if (e.target !== fileInput) fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
        if (isCurrentMapLockedSync()) { fileInput.value = ''; return; }
        if (e.target.files?.length) {
            await handleFiles(Array.from(e.target.files));
            fileInput.value = '';
        }
    });

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (isCurrentMapLockedSync()) return;
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (files.length) await handleFiles(files);
    });

    return dropzone;
}

/**
 * Cria card de imagem.
 * @private
 * @param {Object} imageData - Dados da imagem
 * @param {string} featureId - ID da feature
 * @param {string} featureType - Tipo da feature
 * @returns {HTMLElement} Elemento do card
 */
function createImageCard(imageData, featureId, featureType) {
    const card = document.createElement('div');
    card.className = 'user-data-image-card';

    const img = document.createElement('img');
    img.src = imageData.thumbnail || imageData.data;
    img.alt = imageData.name || 'Imagem';
    img.loading = 'lazy';

    img.addEventListener('click', () => {
        openImageViewer(imageData);
    });

    const overlay = document.createElement('div');
    overlay.className = 'user-data-image-overlay';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'user-data-image-delete';
    deleteBtn.innerHTML = '🗑️';
    deleteBtn.title = 'Remover imagem';

    deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (isCurrentMapLockedSync()) return;
        const confirmed = await showConfirm('Remover esta imagem?', { destructive: true });
        if (confirmed) {
            await userDataManager.removeImage(featureId, featureType, imageData.id);
        }
    });

    overlay.appendChild(deleteBtn);
    card.appendChild(img);
    card.appendChild(overlay);

    return card;
}

/**
 * Abre visualizador de imagem em tela cheia.
 * @private
 * @param {Object} imageData - Dados da imagem
 */
function openImageViewer(imageData) {
    const overlay = document.createElement('div');
    overlay.className = 'user-data-image-viewer-overlay';

    overlay.innerHTML = `
        <div class="user-data-image-viewer">
            <img src="${imageData.data}" alt="${escapeHtml(imageData.name || 'Imagem')}">
            <button class="user-data-viewer-close" title="Fechar">✕</button>
        </div>
    `;

    const closeViewer = () => overlay.remove();

    overlay.querySelector('.user-data-viewer-close').addEventListener('click', closeViewer);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeViewer();
    });

    document.body.appendChild(overlay);
}

/**
 * Renderiza estado vazio.
 * @private
 * @param {HTMLElement} container - Container onde renderizar
 * @param {string} text - Texto a exibir
 * @param {string} icon - Ícone a exibir
 */
function renderEmptyState(container, text, icon) {
    const empty = document.createElement('div');
    empty.className = 'user-data-empty';
    empty.innerHTML = `
        <div class="user-data-empty-icon">${icon}</div>
        <div class="user-data-empty-text">${text}</div>
    `;
    container.appendChild(empty);
}

/**
 * Escapa HTML para prevenir XSS.
 * @private
 * @param {string} str - String a escapar
 * @returns {string} String escapada
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
