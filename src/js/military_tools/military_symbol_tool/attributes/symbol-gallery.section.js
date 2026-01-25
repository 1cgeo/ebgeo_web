// Path: js/military_tools/military_symbol_tool/attributes/symbol-gallery.section.js

/**
 * @fileoverview Symbol gallery section for the military symbol modal.
 * Displays symbols currently on the map for quick selection.
 */

/**
 * @typedef {Object} GallerySymbol
 * @property {Object} properties - Feature properties
 * @property {string} properties.id - Feature ID
 * @property {string} properties.sidc - Symbol SIDC code
 * @property {string} [properties.nome] - Symbol name
 * @property {number} usageCount - Number of times this symbol is used
 */

/**
 * Creates a gallery item element.
 *
 * @param {GallerySymbol} feature - Symbol feature
 * @param {string} dataURL - Symbol preview image data URL
 * @param {Function} onSymbolClick - Callback when symbol is clicked
 * @returns {HTMLElement} Gallery item element
 */
function createGalleryItem(feature, dataURL, onSymbolClick) {
    const item = document.createElement('div');
    item.style.cssText = `
        width: 60px;
        height: 60px;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        background: white;
    `;

    const img = document.createElement('img');
    img.src = dataURL;
    img.style.cssText = 'max-width: 50px; max-height: 50px;';
    img.title = `${feature.properties.nome || 'Símbolo'} (${feature.usageCount}x)`;

    item.onclick = () => {
        onSymbolClick(feature.properties.sidc);
    };

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
    scrollContainer.style.cssText = `
        max-height: 500px;
        overflow-y: auto;
        padding-right: 4px;
    `;

    const gallery = document.createElement('div');
    gallery.className = 'symbol-gallery-grid';
    gallery.style.cssText = `
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        justify-items: center;
    `;

    const distinctSymbols = await militarySymbolControl.getDistinctSymbolsByUsage();

    if (distinctSymbols.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.textContent = 'Nenhum símbolo no mapa';
        emptyMessage.style.cssText = 'color: #999; font-style: italic; font-size: 14px; text-align: center; padding: 20px; grid-column: 1 / -1;';
        gallery.appendChild(emptyMessage);
    } else {
        for (const feature of distinctSymbols) {
            try {
                const sidc = feature.properties.sidc;
                const dataURL = await militarySymbolControl.symbolGenerator.generatePreviewDataURL(sidc, 60);

                if (dataURL) {
                    const item = createGalleryItem(feature, dataURL, onSymbolClick);
                    gallery.appendChild(item);
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
