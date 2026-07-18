// Path: js/military_tools/military_symbol_tool/attributes/symbol-gallery.section.js

/**
 * @fileoverview Symbol gallery section for the military symbol modal.
 * Displays symbols currently on the map for quick selection.
 */

/**
 * Creates a gallery item element.
 *
 * @param {Object} feature - Symbol feature with properties
 * @param {string} dataURL - Symbol preview image data URL
 * @param {Function} onSymbolClick - Callback when symbol is clicked
 * @returns {HTMLElement} Gallery item element
 */
function createGalleryItem(feature, dataURL, onSymbolClick) {
    const item = document.createElement('div');
    item.className = 'symbol-gallery__item';

    const img = document.createElement('img');
    img.className = 'symbol-gallery__item-image';
    img.src = dataURL;
    img.title = `${feature.properties.nome || 'Símbolo'} (${feature.usageCount}x)`;

    item.onclick = () => onSymbolClick(feature.properties.sidc);

    item.appendChild(img);
    return item;
}

/**
 * Creates the symbol gallery column for the modal.
 *
 * @param {Object} militarySymbolControl - Military symbol control instance
 * @param {Function} onSymbolClick - Callback when a symbol is clicked
 * @returns {Promise<HTMLElement>} Gallery column element
 */
export async function createSymbolGallery(militarySymbolControl, onSymbolClick) {
    const galleryColumn = document.createElement('div');
    galleryColumn.className = 'symbol-selector-gallery';

    const galleryTitle = document.createElement('h4');
    galleryTitle.textContent = 'Símbolos do Mapa';

    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'symbol-gallery-scroll';

    const gallery = document.createElement('div');
    gallery.className = 'symbol-gallery-grid';

    const distinctSymbols = await militarySymbolControl.getDistinctSymbolsByUsage();

    if (distinctSymbols.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'symbol-gallery__empty';
        emptyMessage.textContent = 'Nenhum símbolo no mapa';
        gallery.appendChild(emptyMessage);
    } else {
        for (const feature of distinctSymbols) {
            try {
                const sidc = feature.properties.sidc;
                const dataURL = await militarySymbolControl.symbolGenerator.generatePreviewDataURL(sidc, 60);

                if (dataURL) {
                    gallery.appendChild(createGalleryItem(feature, dataURL, onSymbolClick));
                }
            } catch (error) {
                console.warn(`Error generating symbol ${feature.properties.id}:`, error);
            }
        }
    }

    scrollContainer.appendChild(gallery);
    galleryColumn.appendChild(galleryTitle);
    galleryColumn.appendChild(scrollContainer);

    return galleryColumn;
}
