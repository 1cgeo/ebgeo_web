// Path: eslint-rules/__fixtures__/should-pass.js
// NEGATIVE CONTROL (negative half): nothing below may be reported. A rule that
// fires here is a false positive, and with `--max-warnings 0` a false positive
// gets the rule switched off. Each block belongs to one rule; APPEND your block
// at the end, never rewrite or reorder what is already here.

// ---------------------------------------------------------------------------
// no-json-clone
// ---------------------------------------------------------------------------

import { deepClone } from '@utils/deep-utils.js';

export function cloneFeatureProperly(feature) {
    return deepClone(feature);
}

export function cloneViaStructuredClone(value) {
    return structuredClone(value);
}

// Explicit polyfill: the fast path is a real deep clone, the JSON round trip is
// only the fallback for a runtime without structuredClone.
export function cloneWithFallback(value) {
    return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

// Plain serialization, one direction at a time.
export function parseServerPayload(text) {
    return JSON.parse(text);
}

export function serializeForStorage(state) {
    return JSON.stringify(state);
}

// A reviver exists to rebuild what JSON dropped, so the author already knows.
export function roundTripRevivingDates(config) {
    return JSON.parse(JSON.stringify(config), (key, value) =>
        key === 'atualizadoEm' ? new Date(value) : value
    );
}

// A real replacer is a projection of a subset of fields, not a copy.
export function projectPublicFields(usuario) {
    return JSON.parse(JSON.stringify(usuario, ['id', 'nome']));
}

// ---------------------------------------------------------------------------
// no-event-string-literal
// ---------------------------------------------------------------------------

import { EventTypes } from '@events';
import { StoreErrorEvents } from '@store/store-errors.js';

// The right way: a constant, so a typo becomes a ReferenceError.
export function emitViaConstant(bus) {
    bus.emit(EventTypes.LAYERS_CHANGED, { mapName: 'Principal' });
    bus.on(EventTypes.FEATURE_MODIFIED, () => {});
    bus.emit(StoreErrorEvents.STORE_PERSIST_ERROR, { erro: 'quota' });
}

const marcadorArrastavel = { on: () => {} };

// MapLibre: third-party vocabulary, string literal is the only way to call it.
export function wireMapHandlers(map, onClick) {
    map.on('click', 'point-layer', onClick);
    map.on('mousemove', onClick);
    map.once('styledata', onClick);
    map.off('click', 'point-layer', onClick);
    marcadorArrastavel.on('dragend', onClick);
}

// DOM: also third-party, also legitimate.
export function wireDomHandlers(botao, onKey) {
    botao.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onKey);
    botao.removeEventListener('keydown', onKey);
}

// Private mini-emitters with their own vocabulary, absent from EventTypes.
export function wirePrivateEmitters(toolManager, wsClient) {
    toolManager.on('toolActivated', () => {});
    toolManager.off('viewerDeactivated', () => {});
    wsClient.on('operation', () => {});
    wsClient.on('syncResponse', () => {});
}

// Dynamic names: legitimate fan-out over a list of constants.
export function wireManyEvents(bus, eventos) {
    for (const evt of eventos) bus.on(evt, () => {});
    bus.emit(eventos[0], {});
}

// Not an event name at all: same method names on other receivers/positions.
export function nonEventUsesOfTheSameNames(mapaDeCores, texto) {
    mapaDeCores.on = 'ligado';
    return texto.split(':').length + Object.keys(mapaDeCores).length;
}

// ---------------------------------------------------------------------------
// no-inline-style-assignment
// ---------------------------------------------------------------------------

// The right way: appearance lives in a BEM class, JS only toggles it.
export function markPanelAsActive(painel) {
    painel.classList.add('feature-panel--ativo');
    painel.classList.remove('feature-panel--oculto');
}

// The exception the constitution grants: values computed at runtime. Single
// property assignment is never reported, whatever the value.
export function positionTooltip(tooltip, ponto, corDaFeicao) {
    tooltip.style.transform = `translate(${ponto.x}px, ${ponto.y}px)`;
    tooltip.style.display = 'block';
    tooltip.style.backgroundColor = corDaFeicao;
    tooltip.style.cursor = 'crosshair';
    tooltip.style.zIndex = '10';
}

// Feeding a custom property from JS is the tokens system working as designed.
export function applyAccent(raiz, cor) {
    raiz.style.setProperty('--ebgeo-cor-destaque', cor);
}

// cssText whose every declaration is interpolated: computed style by
// construction, exactly what the exception covers.
export function placeGhost(ghost, x, y, escala) {
    ghost.style.cssText = `left:${x}px;top:${y}px;transform:scale(${escala})`;
}

// Two declarations are a mechanical trick (an off-screen textarea for the
// clipboard fallback), not an appearance decision.
export function makeOffscreenTextarea(texto) {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.style.cssText = 'position:fixed;left:-9999px';
    return ta;
}

// The CSS text comes from elsewhere: not inspectable here, so not guessed at.
export function applyComputedCss(el, cssCalculado) {
    el.style.cssText = cssCalculado;
}

// Object form with computed values only.
export function placeCursorRemoto(cursor, x, y, cor) {
    Object.assign(cursor.style, {
        transform: `translate(${x}px, ${y}px)`,
        borderColor: cor,
    });
}

// Object.assign onto something that is not a `.style`, with as many literals as
// it likes.
export function withDefaults(opcoes) {
    return Object.assign({}, opcoes, {
        modo: 'absoluto',
        unidade: 'hora',
        origem: 'mapa',
        ativo: true,
    });
}

// ---------------------------------------------------------------------------
// no-unescaped-innerhtml
// ---------------------------------------------------------------------------

import { escapeHtml } from '@utils/html-escape.js';
import { sanitizeQuillHtml } from '@utils/quill-helpers.js';

// Emptying an element is the most common innerHTML there is, and it carries
// nothing. A literal with no interpolation is the same case.
export function limparPainel(painel) {
    painel.innerHTML = '';
    painel['innerHTML'] = '';
    painel.innerHTML = `<div class="painel__vazio">Nenhuma feicao neste mapa</div>`;
}

// The fix itself, in both positions: attribute and content.
export function renderFeatureRowSeguro(feicao) {
    const row = document.createElement('div');
    row.innerHTML = `<span title="${escapeHtml(feicao.nome)}">${escapeHtml(feicao.nome)}</span>`;
    return row;
}

// The indirection the already-corrected call sites use: escaped once into a
// const, interpolated twice afterwards.
export function renderPhotoCardSeguro(foto) {
    const safeDisplayName = escapeHtml(foto.display_name);
    const card = document.createElement('div');
    card.innerHTML = `<img alt="Previa de ${safeDisplayName}" /><span>${safeDisplayName}</span>`;
    return card;
}

// Rich text goes through DOMPurify, the sanitizer this content is built for.
export function renderNota(painel, htmlDoQuill) {
    painel.innerHTML = `<div class="nota">${sanitizeQuillHtml(htmlDoQuill)}</div>`;
}

// Icons, labels and counts are constants of the code, not user data. This is
// the population the rule must stay quiet about: it is the overwhelming
// majority of the interpolations in `src/js/`.
export function renderToolbarButton(botao, config, total) {
    botao.innerHTML = `${config.icon}<span>${config.label}</span><b>${total}</b>`;
}

// A call is opaque on purpose: the helper may escape internally, and a render
// helper returning HTML is the normal idiom here.
export function renderLista(lista, feicoes) {
    lista.innerHTML = `<ul>${feicoes.map(renderFeatureRowSeguro).join('')}</ul>`;
}

// A URL interpolated through encodeURIComponent cannot break out either.
export function renderDownloadLink(el, nomeArquivo) {
    el.innerHTML = `<a href="/api/v1/export/${encodeURIComponent(nomeArquivo)}">Baixar</a>`;
}

// ---------------------------------------------------------------------------
// require-path-comment
// ---------------------------------------------------------------------------
//
// This file IS the fixture. It sits outside `src/js/`, and its line 1 declares
// `eslint-rules/__fixtures__/should-pass.js` — package-relative, not the
// `js/...` form the rule expects. Silence here therefore proves the scope
// boundary: a rule that fired would be reporting the ~100 files of
// `frontend/tests/` and every config file at the package root, and with
// `--max-warnings 0` that is a rule someone switches off the same day.
//
// The compliant-file half lives in `__fixtures__/require-path-comment/src/js/`
// (`correct-header.js`, `nested/deep-file.js`), plus a `tests/out-of-scope.js`
// with no header at all.

// A path comment is only a path comment on line 1. The same text produced or
// matched by code is data, and must never be read as a header.
const CABECALHO_ESPERADO = '// Path: js/store/store.js';

export function montarCabecalho(caminhoRelativo) {
    return `// Path: ${caminhoRelativo}`;
}

export function pareceCabecalho(linha) {
    return linha.startsWith('// Path: ') && linha !== CABECALHO_ESPERADO;
}

// ---------------------------------------------------------------------------
// no-maplibre-global
// ---------------------------------------------------------------------------

import { maplibregl } from '@js/map/maplibre.js';

// The fix itself: the name is now a module binding, so the rule is silent by
// construction and the call sites below did not have to change.
export function abrirPopupPeloPontoUnico(mapa, texto) {
    return new maplibregl.Popup({ closeButton: false }).setText(texto).addTo(mapa);
}

// A parameter of the same name (the shape a test double takes) shadows the
// global, and so does any other local binding.
export function comDubleInjetado(maplibregl, mapa) {
    return new maplibregl.Marker().addTo(mapa);
}

// `window` itself shadowed: then `.maplibregl` is somebody else's property, not
// the global spelled another way.
export function lerDeUmaJanelaFalsa(window) {
    return window.maplibregl;
}

// A property named `maplibregl` on an ordinary object is a key, not the global.
export function empacotarDuble(duble) {
    const ambiente = { maplibregl: duble };
    return ambiente.maplibregl;
}

// The DOM class the library writes is a string, and shares only the prefix.
export function selecionarCanvasDoMapa(pagina) {
    return pagina.locator('#map-sig .maplibregl-canvas');
}
