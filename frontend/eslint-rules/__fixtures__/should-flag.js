// Path: eslint-rules/__fixtures__/should-flag.js
// NEGATIVE CONTROL (positive half): every construct below MUST be reported.
// `node eslint-rules/probe.js` fails loudly if any of these stops being
// flagged. Each block belongs to one rule; APPEND your block at the end, never
// rewrite or reorder what is already here.

// ---------------------------------------------------------------------------
// no-json-clone
// ---------------------------------------------------------------------------

export function cloneFeature(feature) {
    // EXPECT: no-json-clone
    return JSON.parse(JSON.stringify(feature));
}

export function snapshotMapState(state) {
    // EXPECT: no-json-clone
    const copy = JSON.parse(JSON.stringify(state, null, 2));
    return copy;
}

// ---------------------------------------------------------------------------
// no-event-string-literal
// ---------------------------------------------------------------------------

import { getEventBus } from '@store/services.js';

export function emitOnANamedBus(bus) {
    // EXPECT: no-event-string-literal
    bus.emit('layers:changed', { mapName: 'Principal' });
}

export function subscribeOnTheFactoryResult() {
    // EXPECT: no-event-string-literal
    return getEventBus().on('feature:created', () => {});
}

export class PanelWithBusField {
    constructor(eventBus) {
        this._eventBus = eventBus;
    }

    listen() {
        // EXPECT: no-event-string-literal
        this._eventBus.once('ui:layoutChanged', () => {});
    }

    stop() {
        // EXPECT: no-event-string-literal
        this._eventBus.off('ui:layoutChanged', this._handler);
    }
}

// The receiver name says nothing, but `dominio:acao` is the bus vocabulary.
export function emitThroughAnUnknownReceiver(emitter) {
    // EXPECT: no-event-string-literal
    emitter.emit('store:persistError', { erro: 'quota' });
}

// ---------------------------------------------------------------------------
// no-inline-style-assignment
// ---------------------------------------------------------------------------

const PREVIEW_WIDTH = 320;

// A stylesheet written inside the JS. One interpolated value does not rescue
// the eleven fixed declarations around it.
export function buildPreviewOverlay() {
    const container = document.createElement('div');
    // EXPECT: no-inline-style-assignment
    container.style.cssText = `
        position: absolute;
        top: 12px;
        left: 12px;
        width: ${PREVIEW_WIDTH}px;
        border-radius: 8px;
        overflow: hidden;
        z-index: 15;
        background: #11111b;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    `;
    return container;
}

// Same sin on one line, in a plain string.
export function buildOverlayCanvas() {
    const canvas = document.createElement('canvas');
    // EXPECT: no-inline-style-assignment
    canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    return canvas;
}

// The object form of the same block.
export function paintBadge(badge) {
    // EXPECT: no-inline-style-assignment
    Object.assign(badge.style, {
        position: 'absolute',
        borderRadius: '4px',
        background: '#f44336',
        color: 'white',
    });
    return badge;
}

// ---------------------------------------------------------------------------
// no-unescaped-innerhtml
// ---------------------------------------------------------------------------

import { escapeHtml } from '@utils/html-escape.js';

// The classic: a feature name straight into element content. The name is
// authored by one user and re-rendered in another's session via sync.
export function renderFeatureRow(feicao) {
    const row = document.createElement('div');
    // EXPECT: no-unescaped-innerhtml
    row.innerHTML = `<span class="feature-item__nome">${feicao.nome}</span>`;
    return row;
}

// The worse half: an attribute position. A value carrying a quote closes the
// attribute and installs a handler without ever using `<` or `>`.
export function renderPhotoCard(foto) {
    const card = document.createElement('div');
    // EXPECT: no-unescaped-innerhtml
    card.innerHTML = `<img class="card__img" alt="Previa de ${foto.display_name}" />`;
    return card;
}

// `+=` appends to the same parsed HTML, so it is the same hole.
export function appendComment(painel, comentario) {
    // EXPECT: no-unescaped-innerhtml
    painel.innerHTML += `<p class="comentario">${comentario}</p>`;
}

// Escaping one branch of a ternary does not escape the other.
export function renderMapTitle(mapa) {
    const titulo = document.createElement('h2');
    // EXPECT: no-unescaped-innerhtml
    titulo.innerHTML = `<span>${mapa.ativo ? escapeHtml(mapa.nome) : mapa.nome}</span>`;
    return titulo;
}

// ---------------------------------------------------------------------------
// require-path-comment
// ---------------------------------------------------------------------------
//
// This rule has NO block of its own here, and the reason is structural, not an
// omission. It is a FILE-level rule: its subject is line 1 of a file and the
// file's own location on disk, so a violation cannot be expressed as a snippet
// inside a shared fixture. Two consequences:
//
//   1. There is no `EXPECT:` marker for require-path-comment in this file.
//      Adding one would make the probe demand a report that cannot happen here.
//   2. This file is OUTSIDE `src/js/`, so the rule ignores it entirely — which
//      is the point: its line 1 declares `eslint-rules/__fixtures__/...`, a
//      package-relative path that would be reported as WRONG if the rule's
//      scope ever slipped past `src/js/`.
//
// Its positive half lives in real files with real paths, under
// `__fixtures__/require-path-comment/src/js/`: `missing-header.js` (no header,
// opens with a `/**` block, like the eleven `js/calibration/` files did) and
// `wrong-header.js` (header present, pointing somewhere else). Both carry the
// usual marker. To cover them, the probe must lint that subtree too.

// ---------------------------------------------------------------------------
// no-maplibre-global
// ---------------------------------------------------------------------------
//
// The four spellings of the same read. The first is the one 28 files of
// `src/js/` used while MapLibre was a `<script>` vendor; the other three are
// the ones a rule based on `no-restricted-globals` would let through, and the
// `globalThis` form with `?.` is the one that was actually living in the tree
// (`terrain-elevation.js`), invisible to a grep for `maplibregl.`.

export function abrirPopupPeloGlobal(mapa, texto) {
    // EXPECT: no-maplibre-global
    return new maplibregl.Popup({ closeButton: false }).setText(texto).addTo(mapa);
}

export function registrarProtocoloPeloGlobal(protocolo) {
    // EXPECT: no-maplibre-global
    maplibregl.addProtocol('pmtiles', protocolo.tile);
}

export function versaoPelaJanela() {
    // EXPECT: no-maplibre-global
    return window.maplibregl.getVersion();
}

export function lngLatPeloGlobalThis(coordenadas) {
    // EXPECT: no-maplibre-global
    const LngLat = globalThis.maplibregl?.LngLat;
    return LngLat ? LngLat.convert(coordenadas) : coordenadas;
}
