// Path: js/utilities/gdal-loader.js

/**
 * @fileoverview On-demand loader for the gdal3.js global (`window.initGdalJs`).
 *
 * WHY THIS EXISTS. `gdal3.js` is 187 kB and used to be a `defer`red `<script>` in
 * `index.html`. `defer` moves WHEN it runs, never WHETHER it downloads: the map
 * page paid those 187 kB on every load, and pays them again on each of the four
 * transitions the user complains about (log in, log out, switch atlas either
 * way). Measured in a real browser against the production bundle on 2026-08-25:
 * `/vendors/gdal/gdal3.js` was 187 kB of the 4509 kB of script the map page
 * downloads at boot.
 *
 * AND NOBODY NEEDED IT AT BOOT. The only consumer in the whole source tree is
 * `import_export/pdf-export.tab.js`, and its constructor does not touch GDAL.
 * The first and only touch on the normal UI path is the EXPORT CLICK
 * (`handleExport`). The `_preInitGdal()` warm-up that `show()` fires does not
 * count: measured by browser probe on 2026-08-25, opening the PDF tab requests
 * no GDAL at all, because `sidebar/tabs/export.tab.js` inlines the body of
 * `show()` instead of calling it. So the library was already on demand in its
 * USE and eager only in its DOWNLOAD, which is the cheapest waste to remove.
 *
 * THE `.wasm` AND `.data` STILL RESOLVE, and this is the part that had to be
 * checked before pulling the tag. `gdal3.js` resolves its sibling files through
 * `Module.locateFile`, and the minified wrapper builds that path from the
 * `path` OPTION passed to `initGdalJs` — `document.currentScript.src` is only
 * the Emscripten fallback, which this app never reaches. `pdf-export.tab.js`
 * always passes `path: this._getGdalPath()`, an absolute `origin + BASE_URL +
 * vendors/gdal` URL. Where the `<script>` tag lives therefore has no bearing on
 * where the 28 MB `.wasm` and the 11 MB `.data` are fetched from. Injecting the
 * script from here changes nothing for them.
 *
 * A MECANICA (memo da promessa em vez da tag, `onload` que nao e prova, memo
 * limpo na falha, `src` derivado do `BASE_URL`) MUDOU DE CASA em 2026-08-25:
 * vive agora em `utilities/vendor-loader.js`, que traz o porque de cada uma das
 * quatro decisoes. Ela era literalmente a mesma nos tres carregadores da casa
 * (este, o do milsymbol e o novo do Turf), e a terceira copia foi o momento de
 * parar. O `BASE_URL` continua importando aqui pelo motivo do paragrafo acima:
 * `pdf-export.tab.js:_getGdalPath` deriva o diretorio dos irmaos `.wasm`/`.data`
 * dele, e um `/vendors/...` cravado no script divergiria sob sub-caminho.
 *
 * @module utilities/gdal-loader
 */

import { criarCarregadorDeVendor } from './vendor-loader.js';

const carregador = criarCarregadorDeVendor({
    caminho: 'vendors/gdal/gdal3.js',
    nome: 'initGdalJs',
    pronto: () => (typeof globalThis.initGdalJs === 'function' ? globalThis.initGdalJs : null),
});

/**
 * Ensures `window.initGdalJs` is available, loading the vendor bundle on first use.
 *
 * Safe to call on every export-tab open: after the first resolve it is a
 * property read.
 *
 * @returns {Promise<Function>} the `initGdalJs` global
 * @throws {Error} when the bundle cannot be loaded, or loads without defining `initGdalJs`
 */
export function ensureGdal() {
    return carregador.ensure();
}

/**
 * Test seam: forgets the memoized load.
 * @returns {void}
 */
export function resetGdalLoader() {
    carregador.reset();
}
