// Path: js/presence/viewer-label.js

/**
 * @fileoverview The words the roster writes for a colleague's open viewer (owner, 2026-09-22).
 *
 * A LEAF WITH ZERO IMPORTS, so the phrase is testable in node and there is one of it. The resource
 * NAME was resolved by the server for THIS recipient (`backend/src/modules/collab/collab.viewer.js`):
 * when the resource is private and this client may not read it, `recurso` arrives null and the
 * phrase names only the KIND of viewer. It never falls back to an id, and there is no id to fall
 * back to: the server did not send one.
 */

/**
 * The roster phrase for a presence `viewer` value, or null when the colleague is on the map.
 * @param {{ surface?: string, recurso?: ({ nome?: string, foto?: (string|null) }|null) }|null} viewer
 * @returns {string|null}
 */
export function viewerLabel(viewer) {
    if (!viewer || typeof viewer !== 'object') {
        return null;
    }
    const nome = typeof viewer.recurso?.nome === 'string' && viewer.recurso.nome !== ''
        ? viewer.recurso.nome
        : null;
    switch (viewer.surface) {
        case '3d':
            return nome ? `no 3D: ${nome}` : 'no visualizador 3D';
        case 'fp':
            return nome ? `na cena 3D: ${nome}` : 'numa cena 3D';
        case '360': {
            if (!nome) {
                return 'no visualizador 360°';
            }
            const foto = typeof viewer.recurso?.foto === 'string' && viewer.recurso.foto !== ''
                ? viewer.recurso.foto
                : null;
            return foto ? `no 360°: ${nome}, foto ${foto}` : `no 360°: ${nome}`;
        }
        default:
            return null;
    }
}
