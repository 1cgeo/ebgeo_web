// Path: e2e-ui/vite.e2e.config.js

/**
 * @fileoverview The Vite dev server the Playwright layer runs against: the repo's real
 * `vite.config.js` with the FILE WATCHER AND HMR REMOVED, and nothing else changed.
 *
 * WHY, MEASURED (2026-08-15). The browser-E2E layer is served by a dev server that watches
 * `src/`. Any write to a source file during a run makes Vite re-serve that module with a
 * `?t=<epoch>` cache-bust and, for a non-accepting module, reload the page. In a run of
 * `browser-multi-tab-namespace.spec.js` that happened while another worktree edited the
 * migration files, and one spec file produced four different corpses at once:
 *
 *   - `page.evaluate: ReferenceError: localforage is not defined` at
 *     `store/migration/v2-to-v2.1.migration.js?t=1786818899456` (the `?t=` is the signature);
 *   - `page.evaluate: Execution context was destroyed, most likely because of a navigation`,
 *     twice, in tests that navigate nowhere at that point;
 *   - `page.evaluate: TypeError: Failed to fetch` inside the seeding `ApiClient`.
 *
 * Six of ten cases went red, none of them for a reason belonging to the app. A run of the same
 * file minutes earlier and minutes later was clean. This is the "instrument measuring another
 * copy of the subject" trap of the constitution, in its coarsest form: the page under
 * measurement was swapped mid-measurement.
 *
 * WHY THIS IS NOT MASKING A RACE. Nothing in `tests/e2e-ui/` ever edits a source file, so the
 * watcher has no legitimate work during a run: every event it can deliver is an artifact of the
 * editor (or of a parallel agent) and not of the product. Removing it does not widen a timing
 * window, it deletes an input the product does not have in production. `server.watch: null` is
 * Vite's own supported switch for this (it installs a noop watcher, `vite/dist/node`), and
 * `hmr: false` removes the HMR socket, so the reload path is structurally absent rather than
 * merely quiet.
 *
 * THE CONTROL that proves it is in effect: `browser-multi-tab-namespace.spec.js` asserts that a
 * booted tab opened NO WebSocket back to the app origin (the HMR socket) and fetched no
 * `?t=<epoch>` module. Without a control, "no reload happened" and "reloads happen but not this
 * time" read the same.
 *
 * ===========================================================================================
 * E O CANAL, QUE `hmr: false` NAO REMOVIA, AGORA E REMOVIDO (2026-09-15)
 * ===========================================================================================
 * O caso A0z daquele arquivo ja media, desde 2026-08-15, que `hmr: false` desliga o HMR sem
 * remover o SOQUETE: o cliente `/@vite/client` continua injetado e continua abrindo
 * `ws://localhost:<porta>/?token=...`. A assercao de la foi enfraquecida por isso, de "nao ha
 * canal" para "nada foi re-servido", e a topologia ficou como custo aceito.
 *
 * Ela deixou de ser aceitavel quando o SEGUNDO NAVEGADOR entrou na matriz de homologacao (B11).
 * O driver de Firefox do Playwright 1.61.1 quebra ao ver um WebSocket cujo aperto de mao ele nao
 * registrou: `FFPage._onWebSocketOpened` chama `assert(request)` sobre um mapa que so recebe
 * pedidos do contexto principal, e o `/@vite/client` que o Vite injeta DENTRO do worker do
 * MapLibre abre um soquete que nasce fora dele. O efeito nao e um teste vermelho, e o PROCESSO
 * do Playwright morrendo com `Error: Assertion error` e levando a rodada junto. Reproduzido em
 * quatro linhas, sem uma linha do EBGeo: pagina em branco, `import('/src/js/map/maplibre.js')`
 * (VIVE), mais `new maplibregl.Map(...)`, que sobe o worker (MORRE).
 *
 * O `semSoqueteDeHmr` abaixo troca as tres construcoes de `WebSocket` do cliente por um duble
 * inerte, no SERVIDOR, de modo que a troca alcanca o worker do mesmo jeito que a pagina (nenhuma
 * rota de Playwright alcanca o worker). Isso nao enfraquece medicao nenhuma: e exatamente a
 * ausencia de canal que a versao forte de A0z queria e nao conseguia, e o watcher continua sendo
 * quem garante que nao ha o que empurrar.
 *
 * ELE FALHA ALTO SE DEIXAR DE CASAR. Um Vite que reescreva o cliente faria o `replace` acertar
 * zero ocorrencias e devolver o cliente intacto, isto e, o crash de volta com o conserto ainda
 * escrito no arquivo. Por isso a contagem e conferida e um desencontro LANCA na hora de servir.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import baseConfig from '../../vite.config.js';

/** `frontend/` — pinned absolutely because the base config says `root: '.'`, which would
 *  resolve against this file's directory or the cwd instead of the package. */
const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Quantas construcoes de `WebSocket` o cliente do Vite tem hoje (duas de HMR, uma de ping). */
const SOQUETES_ESPERADOS = 3;

/**
 * Troca o `WebSocket` do cliente do Vite por um duble inerte.
 *
 * O duble precisa apenas ser CONSTRUIVEL e aceitar o que o cliente chama nele antes do primeiro
 * evento (`addEventListener`, `send`, `close`); como nenhum evento chega, o cliente nunca entra
 * no laco de reconexao, que e o que o mantem quieto em vez de ocupado.
 *
 * @returns {import('vite').Plugin}
 */
function semSoqueteDeHmr() {
    const DUBLE = 'class __EbgeoSoqueteMudo{constructor(){this.readyState=0;}'
        + 'addEventListener(){}removeEventListener(){}send(){}close(){}}\n';
    return {
        name: 'ebgeo:sem-soquete-de-hmr',
        enforce: 'post',
        transform(code, id) {
            if (!id.replace(/\\/g, '/').endsWith('/vite/dist/client/client.mjs')) return null;
            const trocado = code.replaceAll('new WebSocket(', 'new __EbgeoSoqueteMudo(');
            const achados = code.split('new WebSocket(').length - 1;
            if (achados !== SOQUETES_ESPERADOS) {
                throw new Error(
                    `[ebgeo:sem-soquete-de-hmr] o cliente do Vite tem ${achados} construcoes de `
                    + `WebSocket e este conserto espera ${SOQUETES_ESPERADOS}. Sem casar, o soquete `
                    + 'volta e o Firefox do Playwright morre com "Assertion error". Reveja o plugin '
                    + 'em tests/e2e-ui/vite.e2e.config.js antes de seguir.'
                );
            }
            return { code: DUBLE + trocado, map: null };
        },
    };
}

export default async (env) => {
    const base = typeof baseConfig === 'function' ? await baseConfig(env) : baseConfig;
    return {
        ...base,
        root: FRONTEND_ROOT,
        plugins: [...(base.plugins ?? []), semSoqueteDeHmr()],
        server: {
            ...base.server,
            // No browser window per e2e run (the base config opens one for `npm run dev`).
            open: false,
            // No HMR socket: nothing can push an update or a reload into a page under test.
            hmr: false,
            // No file watcher: a source edit mid-run cannot invalidate a module either.
            watch: null,
        },
    };
};
