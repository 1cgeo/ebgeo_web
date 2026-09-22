// Path: tests/helpers/main-round-trip.mjs

/**
 * @fileoverview The owner's round trip, with the REAL build of `main` at both ends.
 *
 * ===========================================================================================
 * WHAT THIS MEASURES THAT `browser-migracao-2.2.spec.js` CANNOT
 * ===========================================================================================
 * That spec stages the previous product line by WRITING ITS DISK: it seeds a 2.2 fixture into
 * the unsuffixed databases and imports the tab-lock source of commit 8b611113 into a blank page.
 * It is the right shape for the cases it covers (quota, races, recovery archives), and it never
 * runs a line of `main`'s application code. So it cannot answer the question the owner asked on
 * 2026-09-22: create features IN main, migrate, go BACK to main and edit, come back.
 *
 * Here both ends are the real thing. `main`'s own `dist/` is served on the app port, the
 * features are drawn with `main`'s own toolbar, and the profile that carries the disk between
 * the two builds is a persistent Chromium profile, not a fixture.
 *
 * ===========================================================================================
 * THE TWO VARIANTS, AND WHY BOTH ARE NEEDED
 * ===========================================================================================
 * The late-join rule (`store/migration/late-legacy-plan.js`, owner's decision of 2026-09-21)
 * splits on whether BOTH sides touched the same map:
 *
 *   trivial   the new version only opened the atlas; what `main` wrote afterwards is absorbed
 *             with no screen and no second atlas.
 *   conflito  the new version edited the SAME map (`same_unit`); what `main` wrote goes to a
 *             separate local atlas ON ITS OWN (`prepareLegacyTransitionResiliente`, owner's
 *             decision of 2026-09-22), a toast names that atlas, and the map opens with no
 *             recovery screen. The screen would only appear if that rescue itself failed.
 *
 * Running only the trivial one would let a regression that turns every round trip into a
 * conflict pass green; running only the conflict one would let the opposite pass.
 *
 * ===========================================================================================
 * WHAT IS NOT MEASURED HERE, ON PURPOSE
 * ===========================================================================================
 * No external acervo: every feature is born from a gesture, so this harness runs on a checkout
 * that has nothing but the two builds (the sibling `main-profile-upgrade.mjs` needs
 * `EBGEO_MIGRATION_DATA_DIR`, which is why it does not run on most machines). IndexedDB is read
 * natively and never written: a harness that seeded the disk would be measuring itself.
 *
 * Run from `frontend/`:
 *   EBGEO_UI_E2E_APP_PORT=… EBGEO_UI_E2E_BACKEND_PORT=… node tests/helpers/main-round-trip.mjs
 */

import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import setup from '../e2e-ui/global-setup.js';
import teardown from '../e2e-ui/global-teardown.js';
import { readState } from '../e2e-ui/state.js';
import { APP_PORT, APP_ORIGIN, BACKEND_PORT } from '../e2e-ui/constants.js';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const mainRoot = resolve(process.env.EBGEO_MAIN_CHECKOUT
    || join(root, '../.claude/worktrees/migration-main-8b611113'));
const output = resolve(process.env.EBGEO_ROUND_TRIP_OUTPUT
    || join(root, `test-results/main-round-trip-${new Date().toISOString().replace(/[:.]/g, '-')}`));

/** The map both product lines meet on. It is the map `main` boots into, so no navigation is needed. */
const MAPA = 'Principal';

/** Named in step 1, inside `main`. */
const FEICOES_INICIAIS = Object.freeze(['Ponto main 1', 'Ponto main 2', 'Ponto main 3']);

/** Named in step 3, inside `main`, AFTER the transition committed. */
const FEICOES_TARDIAS = Object.freeze(['Ponto main tardio 1', 'Ponto main tardio 2']);

const TODAS_AS_FEICOES = Object.freeze([...FEICOES_INICIAIS, ...FEICOES_TARDIAS]);

/** Canvas positions, spaced so a click lands on empty map and later re-selects one feature. */
const POSICOES = Object.freeze([
    { x: 560, y: 380 }, { x: 700, y: 440 }, { x: 840, y: 500 },
    { x: 620, y: 560 }, { x: 760, y: 620 },
]);

/** Somewhere with nothing drawn, used to drop the selection. */
const VAZIO = Object.freeze({ x: 1120, y: 300 });

const NOTA_MAIN = 'Nota escrita na main antes da transição';
const NOTA_INTEGRACAO = 'Nota escrita na integração depois da transição';
const NOTA_MAIN_TARDIA = 'Nota reescrita na main depois da transição';

const mime = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
    '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
    '.pbf': 'application/x-protobuf', '.data': 'application/octet-stream', '.ico': 'image/x-icon',
};

const report = {
    origin: APP_ORIGIN, mainRoot, integrationRoot: root, output,
    startedAt: new Date().toISOString(), builds: {}, variants: {}, errors: [],
};

let server;
let servedFrom = null;
/**
 * The context currently open, so a failure INSIDE a step still closes the browser.
 * Without it the process survives the failure: the first-person engine keeps a worker alive and
 * announces a ten-minute startup timeout, which reads like a hang of this harness.
 */
let openContext = null;
/** Paths the static server answered 404 for, per build label. Asset 404s mean the wrong build. */
const missed = [];

/**
 * Serves one `dist/` on the app port, proxying `/api` to the backend the global setup spawned.
 * Closing the previous server first is what makes the SWAP between builds atomic for the profile.
 * @param {string} directory - Absolute path of the `dist/` to serve.
 * @param {string} label - `main` or `integração`, for the report.
 * @returns {Promise<void>}
 */
async function serve(directory, label) {
    if (server) {
        server.closeAllConnections();
        await new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
    }
    servedFrom = label;
    server = createServer(async (req, res) => {
        if (req.url.startsWith('/api/')) {
            const proxied = request({
                hostname: '127.0.0.1', port: BACKEND_PORT, path: req.url,
                method: req.method, headers: req.headers,
            }, reply => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); });
            proxied.on('error', () => { res.writeHead(502); res.end(); });
            req.pipe(proxied);
            return;
        }
        let pathname = '/';
        try {
            pathname = decodeURIComponent(new URL(req.url, APP_ORIGIN).pathname);
            const file = resolve(directory, '.' + (pathname === '/' ? '/index.html' : pathname));
            if (!file.startsWith(directory + sep) || !(await stat(file)).isFile()) throw new Error('missing');
            res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
            res.setHeader('Cache-Control', extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600');
            res.end(await readFile(file));
        } catch {
            missed.push({ build: label, pathname });
            res.writeHead(404);
            res.end();
        }
    });
    await new Promise((done, fail) => { server.once('error', fail); server.listen(APP_PORT, 'localhost', done); });
}

/**
 * The entry chunk a `dist/index.html` names. The hash differs between the two builds, so it is
 * what proves WHICH build a page actually executed, independently of what this script served.
 * @param {string} directory - Absolute path of a `dist/`.
 * @returns {Promise<string>} File name, e.g. `main-BUBd0vV2.js`.
 */
async function entryChunk(directory) {
    const html = await readFile(join(directory, 'index.html'), 'utf8');
    const found = html.match(/src="\/assets\/(main-(?!legacy)[A-Za-z0-9_-]+\.js)"/);
    assert(found, `o index.html de ${directory} não nomeia um chunk de entrada`);
    return found[1];
}

/**
 * Opens the persistent profile against whatever build is being served, and waits for the FIRST of
 * the two legitimate outcomes.
 *
 * Waiting only for the map turns the regression this harness exists to catch (the recovery screen
 * coming back for a trivial round trip) into an unnamed 60 s timeout.
 * @param {Object} variant - Variant record, for error collection.
 * @param {string} profile - Profile directory.
 * @returns {Promise<{context: Object, page: Object}>}
 */
async function launch(variant, profile) {
    const context = await chromium.launchPersistentContext(profile, {
        headless: true, viewport: { width: 1440, height: 1000 }, acceptDownloads: true,
    });
    openContext = context;
    const page = context.pages()[0] || await context.newPage();
    page.on('pageerror', error => variant.errors.push({ build: servedFrom, message: error.message }));
    page.on('console', message => {
        variant.console.push(message.text());
        if (message.type() === 'error') console.info('BROWSER_ERROR', message.text());
    });
    await page.goto(APP_ORIGIN);
    await page.waitForFunction(
        () => Boolean(document.querySelector('[data-testid="migration-recovery"]'))
            || Boolean(document.querySelector('#nav-btn-zoom-in')),
        { timeout: 90000 });
    return { context, page };
}

/** Dismisses the "server unavailable" notice the map shows when the backend answers late. */
async function dismissNotice(page) {
    const notice = page.locator('.server-notice--visible');
    await notice.waitFor({ state: 'visible', timeout: 2000 }).catch(() => { });
    if (await notice.isVisible().catch(() => false)) {
        await notice.getByRole('button').last().click().catch(() => { });
    }
}

/**
 * Native read-only dump of every `ebgeo*` database plus `localStorage`.
 * Independent of both applications and of both serializers: a harness that asked the app under
 * test what it saved would be asking the suspect for an alibi.
 * @param {Object} page
 * @returns {Promise<Object>}
 */
function disk(page) {
    return page.evaluate(async () => {
        async function encode(value) {
            if (value instanceof Blob) return { $blob: value.type, size: value.size };
            if (value instanceof ArrayBuffer) return { $arrayBuffer: value.byteLength };
            if (ArrayBuffer.isView(value)) return { $typed: value.constructor.name, size: value.byteLength };
            if (value instanceof Date) return { $date: value.toISOString() };
            if (Array.isArray(value)) return Promise.all(value.map(encode));
            if (value && typeof value === 'object') {
                return Object.fromEntries(await Promise.all(
                    Object.keys(value).sort().map(async key => [key, await encode(value[key])])));
            }
            return value;
        }
        const databases = {};
        for (const { name } of (await indexedDB.databases()).sort((a, b) => a.name.localeCompare(b.name))) {
            if (!name || !name.startsWith('ebgeo')) continue;
            const db = await new Promise((done, fail) => {
                const r = indexedDB.open(name);
                r.onsuccess = () => done(r.result);
                r.onerror = () => fail(r.error);
            });
            databases[name] = {};
            try {
                for (const store of db.objectStoreNames) {
                    const raw = await new Promise((done, fail) => {
                        const rowsRead = [];
                        const tx = db.transaction(store, 'readonly');
                        const r = tx.objectStore(store).openCursor();
                        r.onsuccess = () => { const c = r.result; if (c) { rowsRead.push([c.key, c.value]); c.continue(); } };
                        tx.oncomplete = () => done(rowsRead);
                        tx.onerror = () => fail(tx.error);
                    });
                    databases[name][store] = Object.fromEntries(
                        await Promise.all(raw.map(async ([key, value]) => [key, await encode(value)])));
                }
            } finally { db.close(); }
        }
        return {
            databases,
            localStorage: Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])),
        };
    });
}

/** @returns {Object} The localforage records of one database (`keyvaluepairs`). */
function rows(snapshot, name) {
    return snapshot.databases[name]?.keyvaluepairs || {};
}

/** @returns {Object|null} The transition journal, read from `ebgeo_global` with no app code. */
function transition(snapshot) {
    return rows(snapshot, 'ebgeo_global').legacy_transition_v1 ?? null;
}

/** @returns {Array<Object>} The registered local atlases, newest last. */
function atlasEntries(snapshot) {
    return Object.entries(rows(snapshot, 'ebgeo_global'))
        .filter(([key]) => key.startsWith('local_atlas:'))
        .map(([, value]) => value);
}

/**
 * How many times each of the five named features appears in one atlas's databases.
 * Counted by NAME and per map: a total alone would accept five features piled into one map, and
 * a presence check alone would accept a duplicate.
 * @param {Object} snapshot
 * @param {string} suffix - `''` for the pre-namespace acervo, `__<dbSuffix>` for an atlas.
 * @returns {Object<string, number>}
 */
function featureTally(snapshot, suffix) {
    const tally = Object.fromEntries(TODAS_AS_FEICOES.map(nome => [nome, 0]));
    for (const doc of Object.values(rows(snapshot, 'ebgeo_maps' + suffix))) {
        for (const list of Object.values(doc?.features || {})) {
            if (!Array.isArray(list)) continue;
            for (const feature of list) {
                const nome = feature?.properties?.nome;
                if (nome in tally) tally[nome] += 1;
            }
        }
    }
    return tally;
}

/**
 * Every feature name in one atlas, with its map. Only used to DESCRIBE a failure: no assertion
 * reads it, because a count of names nobody chose is not a property of the product.
 * @returns {Array<{map: string, nome: *}>}
 */
function allFeatureNames(snapshot, suffix) {
    const found = [];
    for (const [mapKey, doc] of Object.entries(rows(snapshot, 'ebgeo_maps' + suffix))) {
        for (const [bucket, list] of Object.entries(doc?.features || {})) {
            if (!Array.isArray(list)) continue;
            for (const feature of list) found.push({ map: mapKey, bucket, nome: feature?.properties?.nome });
        }
    }
    return found;
}

/** @returns {string[]} The five names present exactly once, sorted. */
function presentOnce(tally) {
    return Object.entries(tally).filter(([, n]) => n === 1).map(([nome]) => nome).sort();
}

/** @returns {string[]} Names appearing more than once: always a defect. */
function duplicated(tally) {
    return Object.entries(tally).filter(([, n]) => n > 1).map(([nome]) => nome).sort();
}

/** @returns {*} The saved notes record of `MAPA` in one atlas. */
function notes(snapshot, suffix) {
    return rows(snapshot, 'ebgeo_app_settings' + suffix)[`map_notes_${MAPA}`] ?? null;
}

/** @returns {string} `__` plus the db suffix of the atlas the transition wrote into. */
function destinationSuffix(snapshot) {
    const state = transition(snapshot);
    assert(state?.destination, 'o diário da transição não nomeia um destino');
    return '__' + state.destination;
}

/**
 * Records an assertion with its measured value and fails the run.
 * Every check goes through here, so the report carries the numbers and not the verdict.
 */
function check(variant, label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    variant.assertions.push({ label, actual, expected, ok });
    console.info(`${ok ? 'OK  ' : 'FALHOU'} [${variant.name}] ${label} => ${JSON.stringify(actual)}`);
    assert.deepEqual(actual, expected, `${label} (medido: ${JSON.stringify(actual)})`);
}

/**
 * Proves the page executed the build this script meant to serve.
 * The two entry chunks carry different content hashes, so a cached chunk from the other build
 * would show up here: the check is on the network, not on what the server intended.
 */
async function assertBuild(variant, page, label, chunk) {
    const loaded = await page.evaluate(() => performance.getEntriesByType('resource')
        .map(entry => entry.name.split('/').pop())
        .filter(name => /^main-[A-Za-z0-9_-]+\.js$/.test(name)));
    check(variant, `${label}: o navegador executou o chunk de entrada daquele dist`, loaded, [chunk]);
}

/** Opens a drawing tool by label, unfolding the group only when the tool is not already shown. */
async function activateTool(page, label) {
    const tool = page.getByRole('button', { name: label, exact: true });
    if (!(await tool.isVisible().catch(() => false))) {
        await page.getByRole('button', { name: 'Desenho', exact: true }).click();
        await tool.waitFor({ state: 'visible', timeout: 10000 });
    }
    await tool.click();
}

/**
 * Draws one point and names it, confirming the NAME on disk before moving on.
 *
 * THE NAMING GESTURE IS RETRIED, AND THE CLICK IS DISPATCHED. Measured on the first run of this
 * harness, against main's own build: the feature panel re-renders after the selection lands, so
 * `.feature-identification-name` is detached while Playwright is still waiting for it to be
 * "stable", and `click()` retries that until the 30 s timeout without ever firing. It is the
 * same class `testing.md` records for a handler that replaces its own node: dispatch the event
 * instead of waiting for stability. What makes the retry honest is that the loop's exit
 * condition is the DISK, not the DOM: a gesture that drew a point and lost the name keeps
 * looping and then fails, instead of being discovered five steps later as a missing feature.
 *
 * AND THE DESELECT IS PART OF THE GESTURE, NOT CLEANUP. Measured on 2026-09-22: in `main`,
 * `updateFeaturesProperty` (`draw_tools/point_tool/add_point_control.js`) writes the MapLibre
 * source and the in-memory feature and NOTHING ELSE; the store write is `saveFeatures`, which
 * runs when the selection is dropped. So between Enter and the click on empty map the panel
 * shows the new name while IndexedDB still holds `Ponto #1`. A disk poll placed before the
 * deselect waits forever on a write nobody asked for yet, which is how this harness read the
 * commit model wrong on its first three runs.
 */
async function drawNamedPoint(page, position, nome) {
    await activateTool(page, 'Ponto');
    await page.locator('.maplibregl-canvas').click({ position });
    await page.keyboard.press('Escape');
    const trace = [];
    try {
        await expect.poll(async () => {
            const step = {};
            trace.push(step);
            const registrar = valor => { step.r = valor; return valor; };
            // CADA AÇÃO LEVA TETO PRÓPRIO, e sem eles o laço não é laço. Medido na segunda rodada
            // em série: uma iteração pegou o nó do nome no instante em que o painel o trocou,
            // `innerText` devolveu nulo e o `dispatchEvent` seguinte esperou o padrão de 30 s por
            // um elemento que não voltava, consumindo o orçamento inteiro numa tentativa só. Com
            // teto curto a iteração ruim custa segundos e a próxima pega o nó novo.
            const teto = { timeout: 4000 };
            try {
                await page.locator('.maplibregl-canvas').click({ position, ...teto });
                const salvar = page.locator('.feature-panel .attr-modern-btn-save').first();
                if (!await salvar.isVisible({ timeout: 8000 }).catch(() => false)) return registrar('sem botão salvar');
                const display = page.locator('.feature-identification-name').first();
                step.paineis = await page.locator('.feature-identification-name').count();
                if (!await display.isVisible(teto).catch(() => false)) return registrar('sem painel');
                step.antes = await display.textContent(teto).catch(() => null);
                await display.dispatchEvent('click', undefined, teto);
                const input = page.locator(
                    '.feature-identification-name-input:not(.feature-identification-name-input--hidden)').first();
                if (!await input.isVisible(teto).catch(() => false)) return registrar('sem campo');
                // MEMÓRIA À FRENTE DO DISCO: uma tentativa anterior chegou a `properties.nome` e
                // não ao store. `saveEdit` só chama o store quando o texto MUDA, e `saveFeatures`
                // só grava a feição que difere do que a abertura do painel guardou, então repetir
                // o mesmo nome não grava nada e o laço nunca sairia. Passar por um valor
                // intermediário devolve ao commit a diferença que ele exige.
                await input.fill(step.antes === nome ? `${nome} (rascunho)` : nome, teto);
                step.digitado = await input.inputValue(teto).catch(() => null);
                await input.press('Enter', teto);
                step.depois = await display.textContent(teto).catch(() => null);
                await salvar.dispatchEvent('click', undefined, teto);
                await page.locator('.maplibregl-canvas').click({ position: VAZIO, ...teto });
            } catch (error) {
                return registrar(`gesto: ${error.message.split('\n')[0]}`);
            }
            return registrar(featureTally(await disk(page), '')[nome]);
        }, { timeout: 120000, intervals: [750] }).toBe(1);
    } catch (error) {
        const dump = join(output, `falha-nomear-${nome.replace(/\W+/g, '-')}`);
        await writeFile(`${dump}.json`, JSON.stringify({
            nome, position, trace, todosOsNomes: allFeatureNames(await disk(page), ''),
            painel: await page.locator('.feature-panel, .feature-identification').first()
                .innerHTML().catch(() => '(sem painel)'),
        }, null, 2));
        await page.screenshot({ path: `${dump}.png` }).catch(() => { });
        throw error;
    }
}

/**
 * Writes the notes of the current map through the product's own panel, in either build.
 * Both lines use the same class names and the same toast, which is why one helper serves both.
 */
async function writeNotes(page, title, body) {
    await page.getByRole('button', { name: 'Mapas', exact: true }).click();
    await page.locator('#current-map-notes-btn').click();
    await page.locator('.map-notes-sidebar-edit-btn').click();
    await page.locator('.map-notes-sidebar-title-input').fill(title);
    await page.locator('.map-notes-quill-editor .ql-editor').fill(body);
    await page.locator('.map-notes-sidebar-save-btn').click();
    await expect(page.getByText('Notas salvas com sucesso!', { exact: true })).toBeVisible({ timeout: 20000 });
}

/** Closes a context and waits for it, so the tab-lock of that build is released before the swap. */
async function close(context) {
    await context.close();
    if (openContext === context) openContext = null;
}

/**
 * One full round trip.
 * @param {string} name - `trivial` or `conflito`.
 * @param {boolean} integracaoEdita - Whether step 2 edits the SAME map, which is what decides
 *   between the two branches of the late-join rule.
 * @returns {Promise<Object>} The variant record.
 */
async function runVariant(name, integracaoEdita) {
    const variant = { name, integracaoEdita, assertions: [], errors: [], console: [], steps: {} };
    report.variants[name] = variant;
    const profile = join(output, `profile-${name}`);
    const mainDist = join(mainRoot, 'dist');
    const integrationDist = join(root, 'dist');
    let context;
    let page;

    // ---------------------------------------------------------------------------------------
    // PASSO 1 — a versão da main cria o acervo.
    // ---------------------------------------------------------------------------------------
    await serve(mainDist, 'main');
    ({ context, page } = await launch(variant, profile));
    await dismissNotice(page);
    await assertBuild(variant, page, 'passo 1 (main)', report.builds.mainChunk);
    check(variant, 'passo 1: a main abriu no mapa, sem tela de recuperação',
        await page.getByTestId('migration-recovery').count(), 0);

    for (let i = 0; i < FEICOES_INICIAIS.length; i++) {
        await drawNamedPoint(page, POSICOES[i], FEICOES_INICIAIS[i]);
    }
    await writeNotes(page, NOTA_MAIN, 'Corpo da nota escrita na main.');
    await page.screenshot({ path: join(output, `${name}-1-main.png`) });

    let snapshot = await disk(page);
    variant.steps.passo1 = {
        tally: featureTally(snapshot, ''), notas: notes(snapshot, ''),
        bancos: Object.keys(snapshot.databases).sort(),
    };
    check(variant, 'passo 1: as três feições nasceram na main, uma vez cada',
        presentOnce(featureTally(snapshot, '')), FEICOES_INICIAIS.slice().sort());
    check(variant, 'passo 1: a nota do mapa foi gravada pela main',
        notes(snapshot, '')?.title ?? null, NOTA_MAIN);
    check(variant, 'passo 1: a main escreve nos bancos SEM sufixo',
        Object.keys(snapshot.databases).filter(n => n.includes('__')), []);
    check(variant, 'passo 1: nenhuma transição existe ainda', transition(snapshot), null);
    await close(context);

    // ---------------------------------------------------------------------------------------
    // PASSO 2 — a integração migra o acervo no boot.
    // ---------------------------------------------------------------------------------------
    await serve(integrationDist, 'integração');
    ({ context, page } = await launch(variant, profile));
    await dismissNotice(page);
    await assertBuild(variant, page, 'passo 2 (integração)', report.builds.integrationChunk);
    check(variant, 'passo 2: a migração não parou na tela de recuperação',
        await page.getByTestId('migration-recovery').count(), 0);
    await expect(page.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 90000 });

    snapshot = await disk(page);
    const destino = destinationSuffix(snapshot);
    variant.steps.passo2 = {
        destino, diario: transition(snapshot)?.status,
        tallyDestino: featureTally(snapshot, destino), tallyLegado: featureTally(snapshot, ''),
        notasDestino: notes(snapshot, destino), atlas: atlasEntries(snapshot).length,
    };
    check(variant, 'passo 2: o diário da transição fechou', transition(snapshot).status, 'committed');
    check(variant, 'passo 2: as três feições chegaram ao atlas atualizado, uma vez cada',
        presentOnce(featureTally(snapshot, destino)), FEICOES_INICIAIS.slice().sort());
    check(variant, 'passo 2: nenhuma feição duplicada no atlas atualizado',
        duplicated(featureTally(snapshot, destino)), []);
    check(variant, 'passo 2: a nota da main chegou ao atlas atualizado',
        notes(snapshot, destino)?.title ?? null, NOTA_MAIN);
    check(variant, 'passo 2: o acervo sem sufixo continua com as três feições',
        presentOnce(featureTally(snapshot, '')), FEICOES_INICIAIS.slice().sort());
    check(variant, 'passo 2: existe UM atlas local registrado', atlasEntries(snapshot).length, 1);
    check(variant, 'passo 2: o carimbo de schema do destino subiu',
        rows(snapshot, 'ebgeo_app_settings' + destino).schemaVersion, '3.0');

    // A ÁRVORE DE CAMADAS É O CAMINHO INDEPENDENTE DO DISCO: as duas leituras podem divergir, e
    // foi assim que o defeito de memória por mapa não carregado se anunciou noutra medição.
    // A aba se chama "Camadas", e é `feature-organizer.service.js` que desenha `properties.nome`.
    await page.getByRole('button', { name: 'Camadas', exact: true }).click();
    const naTela = await page.evaluate(async nomes => {
        for (let espera = 0; espera < 60; espera++) {
            const texto = document.body.innerText;
            const vistos = nomes.filter(nome => texto.includes(nome));
            if (vistos.length === nomes.length) return vistos;
            await new Promise(done => setTimeout(done, 250));
        }
        return nomes.filter(nome => document.body.innerText.includes(nome));
    }, FEICOES_INICIAIS.slice());
    variant.steps.passo2.naTela = naTela;
    check(variant, 'passo 2: as três feições aparecem na árvore de camadas',
        naTela.slice().sort(), FEICOES_INICIAIS.slice().sort());

    if (integracaoEdita) {
        await writeNotes(page, NOTA_INTEGRACAO, 'Corpo da nota escrita na integração.');
        snapshot = await disk(page);
        check(variant, 'passo 2: a integração gravou a nota no MESMO mapa',
            notes(snapshot, destino)?.title ?? null, NOTA_INTEGRACAO);
        check(variant, 'passo 2: a edição da integração NÃO alcança o acervo sem sufixo',
            notes(snapshot, '')?.title ?? null, NOTA_MAIN);
        variant.steps.passo2.notasDepoisDaEdicao = notes(snapshot, destino);
    }
    await page.screenshot({ path: join(output, `${name}-2-integracao.png`) });
    await close(context);

    // ---------------------------------------------------------------------------------------
    // PASSO 3 — a main volta e trabalha no acervo sem sufixo, que a transição preservou.
    // ---------------------------------------------------------------------------------------
    await serve(mainDist, 'main');
    ({ context, page } = await launch(variant, profile));
    await dismissNotice(page);
    await assertBuild(variant, page, 'passo 3 (main)', report.builds.mainChunk);
    check(variant, 'passo 3: a main reabre o próprio acervo e vê as três feições',
        presentOnce(featureTally(await disk(page), '')), FEICOES_INICIAIS.slice().sort());

    for (let i = 0; i < FEICOES_TARDIAS.length; i++) {
        await drawNamedPoint(page, POSICOES[FEICOES_INICIAIS.length + i], FEICOES_TARDIAS[i]);
    }
    if (integracaoEdita) await writeNotes(page, NOTA_MAIN_TARDIA, 'Corpo reescrito na main.');
    await page.screenshot({ path: join(output, `${name}-3-main.png`) });

    snapshot = await disk(page);
    variant.steps.passo3 = {
        tallyLegado: featureTally(snapshot, ''), tallyDestino: featureTally(snapshot, destino),
        notasLegado: notes(snapshot, ''), notasDestino: notes(snapshot, destino),
    };
    check(variant, 'passo 3: a main tem as cinco feições no acervo sem sufixo',
        presentOnce(featureTally(snapshot, '')), TODAS_AS_FEICOES.slice().sort());
    check(variant, 'passo 3: a main NÃO alcança os bancos do atlas atualizado',
        presentOnce(featureTally(snapshot, destino)), FEICOES_INICIAIS.slice().sort());
    await close(context);

    // ---------------------------------------------------------------------------------------
    // PASSO 4 — a integração volta e decide o que fazer com a gravação tardia.
    // ---------------------------------------------------------------------------------------
    await serve(integrationDist, 'integração');
    ({ context, page } = await launch(variant, profile));
    await assertBuild(variant, page, 'passo 4 (integração)', report.builds.integrationChunk);
    const telaVisivel = await page.getByTestId('migration-recovery').count() > 0;
    variant.steps.passo4 = { tela: telaVisivel };

    if (!integracaoEdita) {
        // ------- Variante trivial: a junção tardia entra sozinha, sem tela e sem atlas novo. ----
        check(variant, 'passo 4: a gravação tardia trivial não para o boot na tela', telaVisivel, false);
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 90000 });
        await dismissNotice(page);
        snapshot = await disk(page);
        variant.steps.passo4 = {
            ...variant.steps.passo4,
            tallyDestino: featureTally(snapshot, destino), tallyLegado: featureTally(snapshot, ''),
            atlas: atlasEntries(snapshot).map(e => e.dbSuffix), diario: transition(snapshot),
        };
        check(variant, 'passo 4: as CINCO feições estão no atlas atualizado, uma vez cada',
            presentOnce(featureTally(snapshot, destino)), TODAS_AS_FEICOES.slice().sort());
        check(variant, 'passo 4: nenhuma feição duplicada no atlas atualizado',
            duplicated(featureTally(snapshot, destino)), []);
        check(variant, 'passo 4: nenhum atlas de recuperação foi criado',
            atlasEntries(snapshot).length, 1);
        check(variant, 'passo 4: o atlas continua sendo o MESMO destino, não uma cópia nova',
            '__' + transition(snapshot).destination, destino);
        check(variant, 'passo 4: nenhuma incorporação ficou em voo',
            transition(snapshot).late ?? null, null);
        check(variant, 'passo 4: nenhuma recusa foi lembrada',
            transition(snapshot).lateConflict ?? null, null);
        check(variant, 'passo 4: as duas bases da junção avançaram',
            Boolean(transition(snapshot).lateBase), true);
        check(variant, 'passo 4: a incorporação não escreveu no acervo sem sufixo',
            presentOnce(featureTally(snapshot, '')), TODAS_AS_FEICOES.slice().sort());
        await page.screenshot({ path: join(output, `${name}-4-integracao.png`) });
    } else {
        // ------- Variante de conflito: desde 2026-09-22 (decisão do dono) o conflito NÃO para o
        // boot. O que a main gravou vai sozinho para um atlas local novo, a pessoa lê um toast
        // que nomeia esse atlas, e o mapa abre. A tela de recuperação só apareceria se nem o
        // resgate automático tivesse dado certo. -------
        check(variant, 'passo 4: o conflito NÃO para o boot na tela', telaVisivel, false);
        const toast = page.locator('.toast', { hasText: 'foram guardadas no atlas' });
        await expect(toast).toBeVisible({ timeout: 60000 });
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 90000 });
        // A CAPTURA ESPERA A OPACIDADE, não a visibilidade: o toast nasce a 0 e a primeira versão
        // desta linha fotografou o splash de abertura por cima dele (2026-09-22).
        await expect.poll(() => toast.first().evaluate(el => Number(getComputedStyle(el).opacity)), { timeout: 10000 })
            .toBeGreaterThan(0.9);
        variant.steps.passo4.toast = await toast.first().innerText();
        await page.screenshot({ path: join(output, `${name}-4-toast.png`) });
        snapshot = await disk(page);
        check(variant, 'passo 4: nada da main entrou no atlas atualizado',
            presentOnce(featureTally(snapshot, destino)), FEICOES_INICIAIS.slice().sort());
        check(variant, 'passo 4: a nota da integração não foi substituída',
            notes(snapshot, destino)?.title ?? null, NOTA_INTEGRACAO);
        const entradas = atlasEntries(snapshot);
        const recuperado = entradas.find(entry => '__' + entry.dbSuffix !== destino);
        assert(recuperado, 'nenhum atlas de recuperação apareceu no registro');
        const recuperadoSuffix = '__' + recuperado.dbSuffix;
        variant.steps.passo4 = {
            ...variant.steps.passo4,
            atlas: entradas.map(e => ({ nome: e.name, dbSuffix: e.dbSuffix })),
            tallyDestino: featureTally(snapshot, destino),
            tallyRecuperado: featureTally(snapshot, recuperadoSuffix),
            tallyLegado: featureTally(snapshot, ''),
            notasDestino: notes(snapshot, destino), notasRecuperado: notes(snapshot, recuperadoSuffix),
        };
        check(variant, 'passo 4: agora são DOIS atlas locais', entradas.length, 2);
        check(variant, 'passo 4: o atlas de recuperação se anuncia como tal',
            recuperado.name.includes('Recuperado'), true);
        check(variant, 'passo 4: o atlas de recuperação tem as CINCO feições, uma vez cada',
            presentOnce(featureTally(snapshot, recuperadoSuffix)), TODAS_AS_FEICOES.slice().sort());
        check(variant, 'passo 4: nenhuma feição duplicada no atlas de recuperação',
            duplicated(featureTally(snapshot, recuperadoSuffix)), []);
        check(variant, 'passo 4: o atlas atualizado segue com as três, uma vez cada',
            presentOnce(featureTally(snapshot, destino)), FEICOES_INICIAIS.slice().sort());
        check(variant, 'passo 4: nenhuma feição duplicada no atlas atualizado',
            duplicated(featureTally(snapshot, destino)), []);
        check(variant, 'passo 4: a nota tardia da main está no atlas de recuperação',
            notes(snapshot, recuperadoSuffix)?.title ?? null, NOTA_MAIN_TARDIA);
        check(variant, 'passo 4: o destino da transição não mudou',
            '__' + transition(snapshot).destination, destino);

        // A UNIÃO DOS DOIS ATLAS COBRE AS CINCO: é a asserção que o dono pediu, e ela precisa da
        // união e não da soma, porque as três do passo 1 vivem legitimamente nos dois lados.
        const uniao = [...new Set([
            ...presentOnce(featureTally(snapshot, destino)),
            ...presentOnce(featureTally(snapshot, recuperadoSuffix)),
        ])].sort();
        check(variant, 'passo 4: nenhuma feição dos passos 1 e 3 se perdeu', uniao, TODAS_AS_FEICOES.slice().sort());
        check(variant, 'passo 4: o acervo sem sufixo continua intacto',
            presentOnce(featureTally(snapshot, '')), TODAS_AS_FEICOES.slice().sort());

        check(variant, 'passo 4: o boot passou sem tela de recuperação',
            await page.getByTestId('migration-recovery').count(), 0);
        await page.screenshot({ path: join(output, `${name}-4-integracao.png`) });
    }

    check(variant, 'nenhum erro de página em nenhum dos quatro passos',
        variant.errors.map(e => `${e.build}: ${e.message}`), []);
    await close(context);
    variant.success = true;
    return variant;
}

await mkdir(output, { recursive: true });
// O `dist/` da main não é construído por esta árvore e o `dist/` da integração é ignorado pelo
// git: os dois faltam por motivos diferentes, e o ENOENT cru de um `readFile` não diz qual.
for (const [name, directory] of [['main', mainRoot], ['integration', root]]) {
    const html = join(directory, 'dist/index.html');
    assert(await stat(html).then(s => s.isFile(), () => false),
        `falta o dist de ${name}: ${html}.` + (name === 'main'
            ? ' Aponte EBGEO_MAIN_CHECKOUT para o worktree da main (o padrão vale só na árvore principal).'
            : ' Rode `npm run build` neste pacote.'));
    report.builds[name] = createHash('sha256')
        .update(await readFile(join(directory, 'dist/index.html'))).digest('hex');
    report.builds[`${name}Chunk`] = await entryChunk(join(directory, 'dist'));
    report.builds[`${name}Commit`] = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
}
assert.notEqual(report.builds.mainChunk, report.builds.integrationChunk,
    'os dois dist têm o mesmo chunk de entrada: a troca de build não seria observável');

// O ramo de conflito mede a regra de 2026-09-22 (resgate automático, sem tela); a versão que
// dependia da decisão anterior está no histórico deste arquivo.

try {
    await setup();
    assert.equal(readState().skip, false, 'Backend necessário: sem PostgreSQL esta medição não acontece');
    await runVariant('trivial', false);
    await runVariant('conflito', true);
    report.missed404 = missed.filter(m => m.pathname.startsWith('/assets/'));
    assert.deepEqual(report.missed404, [], 'um chunk foi pedido ao dist errado');
    report.success = true;
} catch (error) {
    report.failure = error.stack;
    process.exitCode = 1;
} finally {
    await openContext?.close().catch(() => { });
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    await teardown();
    report.finishedAt = new Date().toISOString();
    report.missed = missed;
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.info('ROUND_TRIP_OUTPUT', output);
    for (const variant of Object.values(report.variants)) {
        console.info(`--- variante ${variant.name}: ${variant.assertions.filter(a => a.ok).length}/${variant.assertions.length} asserções ---`);
    }
    if (report.failure) console.info('ROUND_TRIP_FAILURE', report.failure);
}
