// Path: js/first_person_3d_tool/components/marker-panel-fp.js

/**
 * @fileoverview Content of the feature panel for a first-person scene marker.
 *
 * THIS IS NOT A PANEL. It builds the CONTENT that goes inside the application's
 * one feature panel — the same panel that opens when a feature is selected in
 * 2D, in Cesium or in the 360 viewer. The panel itself (position, width,
 * slide-in, header, close button) is owned by `sidebar/components/feature-panel.js`
 * and is reached through `MARKER_FP_CLICKED` → `sidebar.control.js`, exactly the
 * route `marker-panel-360.js` takes.
 *
 * Starting from the house panel and adapting it to first-person content is
 * deliberate, and it is the opposite of what the prototype did: the prototype
 * drew its own dark card floating in the corner. A visitor who has clicked a
 * feature anywhere else in this app already knows where the panel appears and
 * how it reads, and a second panel with its own geometry would spend that
 * knowledge for nothing.
 *
 * READ-ONLY, unlike its 2D/3D/360 siblings. A scene marker is curated content
 * shipped in the scene folder's marcadores.json, not a feature anybody can edit
 * or delete from here, so this content has no name editor, no description
 * editor, no style tabs and no delete button. The sections it does use are the
 * house ones, so it still looks like the others.
 *
 * Every field comes from external JSON and is written with textContent — never
 * innerHTML. The only innerHTML is static inline SVG.
 */

/**
 * @typedef {Object} FpMarker
 * @property {string} id - Marker id.
 * @property {string} titulo - Title shown on the label and on the panel.
 * @property {string} texto - Explanatory text.
 * @property {number} [item] - Item number in the collection catalog.
 * @property {string} [foto] - Photo path, relative to the scene basePath.
 * @property {string} [detalhes] - Manufacturer, date, serial number.
 * @property {string} [fonte] - Where the information came from.
 * @property {number} x - World position, in meters (splat reference frame).
 * @property {number} y - World position, in meters.
 * @property {number} z - World position, in meters.
 */

// The app's one lightbox: styled close, download button, Escape and arrow keys.
// The 3D panel carries an older, plainer copy — this is the one to use.
import { openImageViewer } from '@sidebar/components/feature-photo-gallery.js';

/** Item icon, at the weight the other feature panels use. */
const ICON_ITEM = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;

/**
 * Builds the feature-panel content for a first-person marker.
 *
 * Same return shape as `createMarkerPanel360Content`, so `sidebar.control.js`
 * mounts it through the identical path.
 *
 * @param {FpMarker} marker - Marker data (external JSON, treated as untrusted text).
 * @param {string} sceneName - Display name of the scene the marker belongs to.
 * @param {string|null} [photoUrl] - Photo URL already resolved against the scene folder.
 * @returns {{element: HTMLElement, cleanup: Function}} Content and its teardown.
 */
export function createMarkerPanelFpContent(marker, sceneName, photoUrl = null) {
    const container = document.createElement('div');
    container.className = 'marker-fp-panel-content';

    buildIdentificationSection(container, marker, sceneName);

    const photoCleanup = photoUrl
        ? buildPhotoSection(container, marker, photoUrl)
        : null;

    buildDescriptionSection(container, marker);

    const cleanup = () => {
        photoCleanup?.();
    };

    return { element: container, cleanup };
}

/**
 * Header: icon, title, type and the scene the item belongs to.
 * Mirrors `buildIdentificationSection` of the 360 panel, minus the name editor.
 * @param {HTMLElement} container - Parent container.
 * @param {FpMarker} marker - Marker data.
 * @param {string} sceneName - Scene display name.
 */
function buildIdentificationSection(container, marker, sceneName) {
    const section = document.createElement('div');
    section.className = 'feature-identification';

    const iconContainer = document.createElement('div');
    iconContainer.className = 'feature-identification-icon feature-icon-bg-gray';
    iconContainer.innerHTML = ICON_ITEM;

    const info = document.createElement('div');
    info.className = 'feature-identification-info';

    const nameContainer = document.createElement('div');
    nameContainer.className = 'feature-identification-name-container';

    // A div, not the editable name of the other panels: there is nothing to edit.
    const name = document.createElement('div');
    name.className = 'feature-identification-name marker-fp-name';
    name.textContent = marker.titulo || 'Sem nome';
    nameContainer.appendChild(name);

    const type = document.createElement('div');
    type.className = 'feature-identification-type';
    type.textContent = Number.isFinite(marker.item)
        ? `Tipo: Item ${marker.item} do acervo`
        : 'Tipo: Item do acervo';

    info.appendChild(nameContainer);
    info.appendChild(type);

    if (sceneName) {
        const scene = document.createElement('div');
        scene.className = 'feature-identification-layer';
        scene.textContent = `Cena: ${sceneName}`;
        info.appendChild(scene);
    }

    section.appendChild(iconContainer);
    section.appendChild(info);
    container.appendChild(section);
}

/**
 * Photo of the piece, in the house gallery frame but read-only: no add button,
 * no delete button, no counter.
 *
 * CLICKING OPENS IT FULL SCREEN, through the very `openImageViewer` the 2D, 3D
 * and 360 panels use — the same overlay, the same close button, the same Escape.
 * A museum piece in a 360-pixel column is a thumbnail of a thumbnail; the whole
 * point of the card is being able to look at the object.
 *
 * One photo, so the grid drops to a single centred column and the image is
 * `contain`, not `cover` (see first-person-3d.css). The house gallery crops to a
 * square because it shows several attachments at once; cropping the only photo
 * of an instrument to a square cuts the instrument.
 *
 * @param {HTMLElement} container - Parent container.
 * @param {FpMarker} marker - Marker data.
 * @param {string} photoUrl - Resolved photo URL.
 * @returns {Function} Teardown that detaches the listeners.
 */
function buildPhotoSection(container, marker, photoUrl) {
    const caption = marker.titulo || 'Foto do item';

    const section = document.createElement('div');
    section.className = 'feature-photo-gallery';

    const header = document.createElement('div');
    header.className = 'feature-photo-gallery-header';
    const title = document.createElement('span');
    title.className = 'feature-photo-gallery-title';
    title.textContent = 'Foto';
    header.appendChild(title);
    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'feature-photo-gallery-grid marker-fp-photo-grid';

    const card = document.createElement('div');
    card.className = 'feature-photo-gallery-card marker-fp-photo-card';
    card.title = 'Clique para ampliar';

    const img = document.createElement('img');
    img.alt = caption;
    img.loading = 'lazy';

    // A missing file must not leave a broken-image frame inside the panel. The
    // scene folder is authored by hand, so a photo named in the JSON and absent
    // from itens/ is a normal authoring slip, not an exceptional condition.
    const onError = () => section.remove();
    // The overlay reads `data` and `name`: our photo is a URL, not the stored
    // blob the gallery normally hands it, and a URL is all `img.src` needs.
    // `name` becomes the DOWNLOAD FILENAME, so it is the file's own basename and
    // not the item title — a title carries spaces, accents and quotes, and the
    // point of the download button is landing a usable file on disk.
    const onOpen = () => openImageViewer({ data: photoUrl, name: photoFileName(photoUrl) });

    img.addEventListener('error', onError);
    img.addEventListener('click', onOpen);
    img.src = photoUrl;

    card.appendChild(img);
    grid.appendChild(card);
    section.appendChild(grid);
    container.appendChild(section);

    return () => {
        img.removeEventListener('error', onError);
        img.removeEventListener('click', onOpen);
    };
}

/**
 * The explanatory text, in the house description block, read-only.
 * @param {HTMLElement} container - Parent container.
 * @param {FpMarker} marker - Marker data.
 */
function buildDescriptionSection(container, marker) {
    const text = typeof marker.texto === 'string' ? marker.texto.trim() : '';
    if (!text) return;

    const section = document.createElement('div');
    section.className = 'feature-location-section';

    const header = document.createElement('div');
    header.className = 'feature-location-header';
    header.textContent = 'Descrição';
    section.appendChild(header);

    const body = document.createElement('div');
    body.className = 'feature-description-text marker-fp-text';
    body.textContent = text;
    section.appendChild(body);

    container.appendChild(section);
}

/**
 * Basename of a photo URL, for the lightbox download filename.
 *
 * Query string and fragment are dropped, and an unusable result falls back to a
 * generic name: `<a download="">` with an empty value is ignored by the browser,
 * which then saves whatever the URL ends in.
 *
 * @param {string} url - Resolved photo URL.
 * @returns {string} File name with extension.
 */
function photoFileName(url) {
    const path = String(url).split(/[?#]/)[0];
    const name = path.slice(path.lastIndexOf('/') + 1);
    return name || 'foto.jpg';
}
