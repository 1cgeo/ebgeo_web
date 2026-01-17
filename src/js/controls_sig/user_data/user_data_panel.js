// Path: js/controls_sig/user_data/user_data_panel.js

/**
 * @fileoverview User Data Panel - UI component for custom attributes and images.
 * Provides a tabbed interface that wraps existing attribute panels.
 *
 * Usage:
 *   const cleanup = wrapPanelWithTabs(panel, featureId, featureType, control);
 *   // Later, when panel is destroyed:
 *   cleanup();
 */

import userDataManager from './user_data_manager.js';
import { getEventBus } from '../services.js';
import { EventTypes, FeatureUpdateProperty } from '../events/event_types.js';

/**
 * Escapes HTML entities to prevent XSS.
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Debounces a function call.
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(fn, delay) {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    };
}

/**
 * Wraps an existing attribute panel with a tabbed interface.
 * Adds "Atributos" and "Imagens" tabs alongside the original "Propriedades" content.
 *
 * @param {HTMLElement} panel - The panel container element
 * @param {string} featureId - Unique feature identifier
 * @param {string} featureType - Feature type in singular form ('polygon', 'point', etc.)
 * @param {Object} control - The feature control instance (for potential callbacks)
 * @returns {Function} Cleanup function to call when panel is destroyed
 */
export function wrapPanelWithTabs(panel, featureId, featureType, control) {
    if (!panel || !featureId || !featureType) {
        console.warn('UserDataPanel: Invalid parameters for wrapPanelWithTabs');
        return () => {};
    }

    // Store original content
    const originalContent = document.createDocumentFragment();
    while (panel.firstChild) {
        originalContent.appendChild(panel.firstChild);
    }

    // Create tab structure
    const container = document.createElement('div');
    container.className = 'user-data-tabs-container';

    // Tab buttons
    const tabButtons = document.createElement('div');
    tabButtons.className = 'user-data-tab-buttons';

    const tabs = [
        { id: 'properties', label: 'Propriedades' },
        { id: 'attributes', label: 'Atributos' },
        { id: 'images', label: 'Imagens' },
    ];

    tabs.forEach((tab, index) => {
        const btn = document.createElement('button');
        btn.className = `user-data-tab-btn${index === 0 ? ' active' : ''}`;
        btn.textContent = tab.label;
        btn.dataset.tab = tab.id;
        btn.type = 'button';
        tabButtons.appendChild(btn);
    });

    container.appendChild(tabButtons);

    // Tab content containers
    const tabContents = {};
    tabs.forEach((tab, index) => {
        const content = document.createElement('div');
        content.className = `user-data-tab-content${index === 0 ? ' active' : ''}`;
        content.dataset.tab = tab.id;
        tabContents[tab.id] = content;
        container.appendChild(content);
    });

    // Move original content to properties tab
    tabContents.properties.appendChild(originalContent);

    // Append container to panel
    panel.appendChild(container);

    // Tab switching logic
    function switchTab(tabId) {
        tabButtons.querySelectorAll('.user-data-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });
        Object.values(tabContents).forEach(content => {
            content.classList.toggle('active', content.dataset.tab === tabId);
        });
    }

    tabButtons.addEventListener('click', (e) => {
        const btn = e.target.closest('.user-data-tab-btn');
        if (btn) {
            switchTab(btn.dataset.tab);
        }
    });

    // State for tracking
    let currentViewerOverlay = null;
    let eventUnsubscribe = null;

    // Render functions
    async function renderAttributesTab() {
        const content = tabContents.attributes;
        content.innerHTML = '';

        // Add form
        const addForm = document.createElement('div');
        addForm.className = 'user-data-add-form';

        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.placeholder = 'Nome do atributo';
        keyInput.maxLength = 50;

        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.placeholder = 'Valor';

        const addBtn = document.createElement('button');
        addBtn.textContent = 'Adicionar';
        addBtn.type = 'button';

        addBtn.addEventListener('click', async () => {
            const key = keyInput.value.trim();
            const value = valueInput.value;

            if (!key) return;

            const validation = userDataManager.validateAttributeKey(key);
            if (!validation.valid) {
                showError(content, validation.reason);
                return;
            }

            await userDataManager.setAttribute(featureId, featureType, key, value);
            keyInput.value = '';
            valueInput.value = '';
            keyInput.focus();
        });

        // Enter key support
        const handleEnter = (e) => {
            if (e.key === 'Enter') {
                addBtn.click();
            }
        };
        keyInput.addEventListener('keydown', handleEnter);
        valueInput.addEventListener('keydown', handleEnter);

        addForm.appendChild(keyInput);
        addForm.appendChild(valueInput);
        addForm.appendChild(addBtn);
        content.appendChild(addForm);

        // Attributes list
        const listContainer = document.createElement('div');
        listContainer.className = 'user-data-attr-list';
        content.appendChild(listContainer);

        // Load and render attributes
        const attributes = await userDataManager.getAttributes(featureId, featureType);
        const entries = Object.entries(attributes);

        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'user-data-empty';
            empty.innerHTML = `
                <div class="user-data-empty-icon">📋</div>
                <div class="user-data-empty-text">Nenhum atributo customizado</div>
            `;
            listContainer.appendChild(empty);
        } else {
            entries.forEach(([key, value]) => {
                const row = document.createElement('div');
                row.className = 'user-data-attr-row';

                const keyLabel = document.createElement('span');
                keyLabel.className = 'user-data-attr-key';
                keyLabel.textContent = key;

                const valueInputField = document.createElement('input');
                valueInputField.className = 'user-data-attr-value';
                valueInputField.type = 'text';
                valueInputField.value = value;

                // Debounced update on change
                const debouncedUpdate = debounce(async (newValue) => {
                    await userDataManager.setAttribute(featureId, featureType, key, newValue);
                }, 500);

                valueInputField.addEventListener('input', (e) => {
                    debouncedUpdate(e.target.value);
                });

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'user-data-attr-delete';
                deleteBtn.textContent = '✕';
                deleteBtn.type = 'button';
                deleteBtn.title = 'Remover atributo';

                deleteBtn.addEventListener('click', async () => {
                    await userDataManager.removeAttribute(featureId, featureType, key);
                });

                row.appendChild(keyLabel);
                row.appendChild(valueInputField);
                row.appendChild(deleteBtn);
                listContainer.appendChild(row);
            });
        }
    }

    async function renderImagesTab() {
        const content = tabContents.images;
        content.innerHTML = '';

        // Dropzone
        const dropzone = document.createElement('div');
        dropzone.className = 'user-data-dropzone';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/jpeg,image/png,image/gif,image/webp';
        fileInput.multiple = true;

        dropzone.innerHTML = `
            <div class="user-data-dropzone-icon">📷</div>
            <div class="user-data-dropzone-text">Clique ou arraste imagens aqui</div>
            <div class="user-data-dropzone-hint">JPEG, PNG, GIF ou WebP (máx. 10MB)</div>
        `;
        dropzone.appendChild(fileInput);

        // Click to upload
        dropzone.addEventListener('click', (e) => {
            if (e.target !== fileInput) {
                fileInput.click();
            }
        });

        // File selection
        fileInput.addEventListener('change', async (e) => {
            if (e.target.files?.length) {
                await handleFiles(Array.from(e.target.files));
                fileInput.value = '';
            }
        });

        // Drag and drop
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('dragover');
        });

        dropzone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('dragover');
        });

        dropzone.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('dragover');

            const files = Array.from(e.dataTransfer.files).filter(
                f => f.type.startsWith('image/')
            );
            if (files.length) {
                await handleFiles(files);
            }
        });

        content.appendChild(dropzone);

        // Gallery
        const gallery = document.createElement('div');
        gallery.className = 'user-data-gallery';
        content.appendChild(gallery);

        // Load and render images
        const images = await userDataManager.getImages(featureId, featureType);

        if (images.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'user-data-empty';
            empty.innerHTML = `
                <div class="user-data-empty-icon">🖼️</div>
                <div class="user-data-empty-text">Nenhuma imagem anexada</div>
            `;
            gallery.appendChild(empty);
        } else {
            images.forEach((image, index) => {
                const thumb = document.createElement('div');
                thumb.className = 'user-data-thumb';

                const img = document.createElement('img');
                img.src = image.thumbnail || image.data;
                img.alt = escapeHtml(image.name);
                img.loading = 'lazy';

                const overlay = document.createElement('div');
                overlay.className = 'user-data-thumb-overlay';

                const name = document.createElement('span');
                name.className = 'user-data-thumb-name';
                name.textContent = image.name;

                overlay.appendChild(name);
                thumb.appendChild(img);
                thumb.appendChild(overlay);

                thumb.addEventListener('click', () => {
                    openImageViewer(images, index);
                });

                gallery.appendChild(thumb);
            });
        }
    }

    async function handleFiles(files) {
        for (const file of files) {
            const validation = userDataManager.validateImageFile(file);
            if (!validation.valid) {
                showError(tabContents.images, `${file.name}: ${validation.reason}`);
                continue;
            }

            await userDataManager.addImage(featureId, featureType, file);
        }
    }

    function showError(container, message) {
        // Remove any existing error
        const existing = container.querySelector('.user-data-error');
        if (existing) existing.remove();

        const error = document.createElement('div');
        error.className = 'user-data-error';
        error.textContent = message;

        container.insertBefore(error, container.firstChild);

        // Auto-remove after 5 seconds
        setTimeout(() => error.remove(), 5000);
    }

    function openImageViewer(images, startIndex) {
        // Close any existing viewer
        if (currentViewerOverlay) {
            currentViewerOverlay.remove();
        }

        let currentIndex = startIndex;

        const overlay = document.createElement('div');
        overlay.className = 'user-data-viewer-overlay';
        currentViewerOverlay = overlay;

        function render() {
            const image = images[currentIndex];
            if (!image) {
                closeViewer();
                return;
            }

            overlay.innerHTML = `
                <div class="user-data-viewer-header">
                    <div class="user-data-viewer-title">
                        <span class="user-data-viewer-name">${escapeHtml(image.name)}</span>
                        <span class="user-data-viewer-counter">${currentIndex + 1} / ${images.length}</span>
                    </div>
                    <div class="user-data-viewer-actions">
                        <button class="user-data-viewer-btn" data-action="rename" type="button">✏️ Renomear</button>
                        <button class="user-data-viewer-btn" data-action="download" type="button">⬇️ Download</button>
                        <button class="user-data-viewer-btn danger" data-action="delete" type="button">🗑️ Excluir</button>
                    </div>
                    <button class="user-data-viewer-close" type="button">×</button>
                </div>
                <div class="user-data-viewer-body">
                    <button class="user-data-viewer-nav prev" type="button" ${currentIndex === 0 ? 'disabled' : ''}>‹</button>
                    <img class="user-data-viewer-image" src="${image.data}" alt="${escapeHtml(image.name)}">
                    <button class="user-data-viewer-nav next" type="button" ${currentIndex === images.length - 1 ? 'disabled' : ''}>›</button>
                </div>
            `;

            // Event handlers
            overlay.querySelector('.user-data-viewer-close').onclick = closeViewer;
            overlay.querySelector('.user-data-viewer-nav.prev').onclick = () => navigate(-1);
            overlay.querySelector('.user-data-viewer-nav.next').onclick = () => navigate(1);

            overlay.querySelector('[data-action="rename"]').onclick = () => startRename(image);
            overlay.querySelector('[data-action="download"]').onclick = () => userDataManager.downloadImage(image);
            overlay.querySelector('[data-action="delete"]').onclick = () => deleteImage(image);

            // Click outside to close
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay || e.target.classList.contains('user-data-viewer-body')) {
                    closeViewer();
                }
            });
        }

        function navigate(direction) {
            const newIndex = currentIndex + direction;
            if (newIndex >= 0 && newIndex < images.length) {
                currentIndex = newIndex;
                render();
            }
        }

        function startRename(image) {
            const titleContainer = overlay.querySelector('.user-data-viewer-title');
            const nameSpan = titleContainer.querySelector('.user-data-viewer-name');

            const input = document.createElement('input');
            input.className = 'user-data-viewer-name-input';
            input.type = 'text';
            input.value = image.name;

            nameSpan.replaceWith(input);
            input.focus();
            input.select();

            const saveRename = async () => {
                const newName = input.value.trim();
                if (newName && newName !== image.name) {
                    await userDataManager.updateImageName(featureId, featureType, image.id, newName);
                    image.name = newName;
                }
                render();
            };

            input.addEventListener('blur', saveRename);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    input.blur();
                } else if (e.key === 'Escape') {
                    render();
                }
            });
        }

        async function deleteImage(image) {
            if (!confirm(`Excluir a imagem "${image.name}"?`)) {
                return;
            }

            await userDataManager.removeImage(featureId, featureType, image.id);

            // Update local images array
            const idx = images.findIndex(img => img.id === image.id);
            if (idx !== -1) {
                images.splice(idx, 1);
            }

            if (images.length === 0) {
                closeViewer();
            } else {
                currentIndex = Math.min(currentIndex, images.length - 1);
                render();
            }
        }

        function closeViewer() {
            overlay.remove();
            currentViewerOverlay = null;
            document.removeEventListener('keydown', handleKeydown);
        }

        function handleKeydown(e) {
            if (e.key === 'Escape') {
                closeViewer();
            } else if (e.key === 'ArrowLeft') {
                navigate(-1);
            } else if (e.key === 'ArrowRight') {
                navigate(1);
            }
        }

        document.addEventListener('keydown', handleKeydown);
        document.body.appendChild(overlay);
        render();
    }

    // Initial render of dynamic tabs
    renderAttributesTab();
    renderImagesTab();

    // Subscribe to EventBus for reactive updates
    try {
        const eventBus = getEventBus();
        eventUnsubscribe = eventBus.on(EventTypes.FEATURE_UPDATED, (payload) => {
            // Only react to events for this specific feature
            if (payload.featureId !== featureId || payload.featureType !== featureType) {
                return;
            }

            if (payload.property === FeatureUpdateProperty.ATTRIBUTES) {
                renderAttributesTab();
            } else if (payload.property === FeatureUpdateProperty.IMAGES) {
                renderImagesTab();
            }
        });
    } catch (e) {
        console.debug('UserDataPanel: EventBus not available -', e.message);
    }

    // Cleanup function
    function cleanup() {
        if (eventUnsubscribe) {
            eventUnsubscribe();
            eventUnsubscribe = null;
        }

        if (currentViewerOverlay) {
            currentViewerOverlay.remove();
            currentViewerOverlay = null;
        }
    }

    return cleanup;
}
