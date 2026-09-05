// Path: js/tool_manager/vizinho-do-ponto-unico.js
// FIXTURE, the forbidden half: an ordinary module under the SAME `src/js/`
// tree as the entry point next door. It exists to prove the exception is not
// too broad, which is the dangerous direction: an exception that matched the
// folder, or `src/js/` at large, would silence the whole rule and still look
// green in a probe that only checked the allowed file for silence.

export function abrirPopup(mapa, texto) {
    // EXPECT: no-maplibre-global
    return new maplibregl.Popup().setText(texto).addTo(mapa);
}

export function versaoDaBiblioteca() {
    // EXPECT: no-maplibre-global
    return window.maplibregl.getVersion();
}
