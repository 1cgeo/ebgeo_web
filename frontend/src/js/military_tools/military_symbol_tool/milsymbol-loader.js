// Path: js/military_tools/military_symbol_tool/milsymbol-loader.js

/**
 * @fileoverview On-demand loader for the milsymbol global (`window.ms`).
 *
 * WHY THIS EXISTS. milsymbol is 855 kB and used to be an eager `<script>` in `index.html`, 14,6%
 * of the map page's eager JavaScript. Measured with a Proxy on `window.ms` in a real browser: it
 * is never read during boot, not even on F5 with military symbols already on the map. The first
 * read is the first symbol drawn.
 *
 * THE RACE THIS CLOSES, and why the loader alone is not enough. `window.ms` is not only read by a
 * user gesture: `layers/layer_setup.js` regenerates symbol PNGs when a remote atlas snapshot
 * arrives, with nobody touching anything. If the library were simply not loaded, that path would
 * find `ms` undefined. So the await belongs at the top of `generateSymbol`, the single chokepoint
 * every caller passes through, not at each call site, which is the version that forgets one.
 *
 * O TRANSPORTE MUDOU EM 2026-09-14, E O COMPORTAMENTO NAO. Ate ali este modulo injetava uma tag
 * `<script>` apontando `vendors/milsymbol.min.js` (a 3.0.3, resolvida por hash), e a mecanica
 * dessa injecao vivia em `utilities/vendor-loader.js`. Agora a biblioteca vem do npm
 * (`milsymbol` 3.0.4), por um `import()` do ponto unico `js/vendor/milsymbol.js`, que e quem
 * publica o global. Quem espera continua sendo `ensureMilsymbol()`, e continua sendo a primeira
 * geracao de simbolo que paga.
 *
 * AS QUATRO DECISOES DO INJETOR DE TAG, e o que o `import()` faz com cada uma:
 *
 *   1. A PROMESSA E MEMOIZADA, e nao a tag. Dois chamadores concorrentes dividem UMA carga. O
 *      registro de modulos do motor ja o garante, e o memo abaixo o garante tambem, porque ele
 *      guarda a promessa.
 *   2. `onload` NAO E PROVA de que o global existe. Deixou de haver `onload`: a promessa do
 *      `import()` so resolve depois de o modulo ter EXECUTADO, e executar e escrever o global.
 *      Mesmo assim o predicado continua reavaliado abaixo, e uma ausencia vira erro alto.
 *   3. A FALHA LIMPA O MEMO, e esta e a unica das quatro que continua sendo trabalho NOSSO. Ela
 *      tambem e a unica que o `import()` ENFRAQUECE, e vale dizer em voz alta: o registro de
 *      modulos do motor guarda o modulo que falhou ao AVALIAR, entao a segunda tentativa recebe
 *      o mesmo erro sem refazer nada. Limpar o memo continua certo (e o que permite a tentativa
 *      existir, e o que cobre a falha de REDE, em que o modulo nem chegou a avaliar), mas nao
 *      promete mais que a segunda tentativa conserte. `tests/unit/milsymbol-loader.test.js` mede
 *      exatamente essa borda, em vez de afirma-la.
 *   4. O `src` SAI DO `BASE_URL`. Deixou de existir como decisao: o bundler emite o chunk com a
 *      `base` do build ja aplicada, entao o deploy sob sub-caminho resolve sozinho.
 *
 * `utilities/vendor-loader.js` continua de pe para o GDAL, que e o ultimo vendor de `public/` com
 * carga sob demanda por tag.
 *
 * @module military_tools/military_symbol_tool/milsymbol-loader
 */

/** Carga em voo (ou ja resolvida). Memoizada para os concorrentes dividirem uma so. */
let carregando = null;

/**
 * Ensures `window.ms` is available, loading the library on first use.
 *
 * Safe to call on every symbol generation: after the first resolve it is a
 * property read.
 *
 * @returns {Promise<Object>} the milsymbol global
 * @throws {Error} when the library cannot be loaded, or loads without defining `ms`
 */
export function ensureMilsymbol() {
    if (typeof globalThis.ms !== 'undefined') return Promise.resolve(globalThis.ms);
    if (carregando) return carregando;

    carregando = import('@js/vendor/milsymbol.js')
        .then(() => {
            // Ver a decisao 2 do `@fileoverview`: o modulo ter executado nao e, por si so, prova
            // de que o global esta la. Perguntar ao global custa uma leitura e mantem a falha alta.
            if (typeof globalThis.ms === 'undefined') {
                throw new Error('js/vendor/milsymbol.js carregou sem definir "ms"');
            }
            return globalThis.ms;
        })
        .catch((err) => {
            // Ver a decisao 3: sem esta linha nem a tentativa seguinte existiria.
            carregando = null;
            throw err;
        });

    return carregando;
}

/**
 * Test seam: forgets the memoized load.
 * @returns {void}
 */
export function resetMilsymbolLoader() {
    carregando = null;
}
