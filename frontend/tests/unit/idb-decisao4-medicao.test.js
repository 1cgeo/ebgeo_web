// Path: tests/unit/idb-decisao4-medicao.test.js

/**
 * @fileoverview RE-MEASUREMENT of the two claims the namespace design rests on
 * (`src/js/store/atlas-namespace.js`, the `@fileoverview` header and Decision 4).
 *
 * The claims, quoted:
 *   (i)  "Creating a database with a new name while another tab holds sibling databases
 *        open completed 21/21 with zero `blocked` events and ~1 ms each."
 *   (ii) "Creating a new object store INSIDE a shared database is an IndexedDB version
 *        upgrade: ... stays PENDING for as long as any holder refuses to close, with
 *        `blocked` as the only signal and nobody listening to it (measured: 21/21 pending
 *        until released)."
 *   (iii) Decision 4: "`deleteDatabase` fires `versionchange` on every other connection and
 *        stays PENDING while any holder refuses to close (21 of 21 pending until the holder
 *        released)."
 *
 * WHY RE-MEASURE. All three turn on the phrase "a holder that refuses to close", and in
 * this application NO holder refuses: localforage installs
 * `db.onversionchange = e => e.target.close()` on every connection it opens
 * (`node_modules/localforage/dist/localforage.js`, in `_getConnection`), and reopens on the
 * next `createTransaction`. Every one of the ten per-atlas databases is opened by
 * localforage and by nothing else, so the holder in the real product yields by
 * construction. If the valve fires, the "pending" half of the measurement describes a
 * holder this codebase does not have.
 *
 * THIS FILE IS A MEASUREMENT, NOT A BEHAVIOUR ASSERTION ABOUT THE APP. It changes no
 * production code and asserts nothing about `atlas-namespace.js`. What it does assert is
 * that the instrument DISCRIMINATES: the arms with a non-yielding holder must come back
 * pending in EVERY run. Without that control, "nothing was blocked" would be
 * indistinguishable from "this fake cannot block", and the whole re-measurement would be
 * worthless.
 *
 * WHAT THE NUMBERS PROVE, AND WHAT THEY DO NOT.
 *  - They prove, over a real IDB implementation, that the `versionchange` valve localforage
 *    installs is enough to let a delete AND an object-store upgrade complete, and that the
 *    same operations do stay pending against a holder without the valve.
 *  - They do NOT prove anything about two real OS tabs. `fake-indexeddb` runs in one
 *    process, so a background tab that is frozen or throttled and therefore never RUNS its
 *    `versionchange` handler is unreachable here. That tab is precisely a holder without a
 *    working valve, i.e. arm B/D, so the pending case remains real in the field; what the
 *    measurement removes is the claim that it is the ORDINARY case.
 *
 * WHERE THE CONTRADICTED TEXT LIVES, AND WHY THAT IS PINNED HERE. A measurement that only
 * lives in a report is a measurement that never reaches the module it corrects, and the two
 * paragraphs it corrects are read as INSTRUCTION by every agent that opens
 * `src/js/store/atlas-namespace.js`. The exact sentences are quoted in `TEXTO_A_REESCREVER`
 * below and a plain `it` asserts they are STILL THERE. That case is a PENDING MARKER: it is
 * green while the wrong prose stands and goes RED on the commit that rewrites it, at which
 * point it is deleted along with the pendency. E0 may not touch `src/`, so the correction
 * itself belongs to E1 or later.
 *
 * NO WALL-CLOCK ASSERTION LIVES HERE ANY MORE. The argument each arm makes is "completed
 * N of N" versus "completed 0 of N", and it never needed a millisecond threshold; the two
 * `maxMs < 5 ms` assertions that used to sit in arms A and F were the only time-dependent
 * lines in the file, measured at 0.69 ms and 0.03 ms, i.e. a margin that says nothing and a
 * flake waiting for a slower machine. The timings are still MEASURED and printed, they are
 * simply not what any case turns on.
 *
 * Measured 2026-08-15, node v24.13.1, fake-indexeddb 6.2.5, localforage 1.10.0. The table
 * is printed at the end of the run.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import localforage from 'localforage';
import { resetIndexedDB, holdDatabaseOpen, listDatabases } from '../helpers/idb-helpers.js';

/** Serial runs per arm, for the arms whose answer is a RATE. */
const N = 21;

/**
 * Serial runs for the three arms whose holder never yields.
 *
 * Fewer on purpose: what those arms prove is BINARY ("completed 0 of N, blocked N of N"),
 * each run costs a full `BOUND_MS` of pure waiting, and at 21 runs the three of them spent
 * ~1.58 s of a ~6 s suite doing nothing. Seven still separates "never" from "sometimes"
 * (a 1-in-7 completion would show), and the corresponding valve arms keep the full 21.
 */
const N_PENDING = 7;

/**
 * Upper bound on one operation. Three orders of magnitude above the observed completion
 * time (~0.01 ms median, 0.54 ms worst), so the cutoff separates "instant" from "never" and
 * never sits near the decision boundary.
 */
const BOUND_MS = 25;

/** Where the file whose prose this measurement corrects lives. */
const NAMESPACE_SOURCE = join(
    dirname(fileURLToPath(import.meta.url)),
    '..', '..', 'src', 'js', 'store', 'atlas-namespace.js'
);

/**
 * The two sentences of `atlas-namespace.js` this measurement contradicts, quoted verbatim
 * (line breaks and leading ` * ` removed, so a re-wrap does not trip the marker on its own).
 *
 * The first is in the header block ("THE NAMESPACE GOES IN THE DATABASE NAME"); the second
 * is the opening of DECISION 4. Both state the pending behaviour as a property of the
 * OPERATION. The measurement below says it is a property of the HOLDER, and that no holder
 * in this codebase is of that kind.
 */
const TEXTO_A_REESCREVER = Object.freeze([
    'stays PENDING for as long as any holder refuses to close, with `blocked` as the only '
    + 'signal and nobody listening to it (measured: 21/21 pending until released)',
    'stays PENDING while any holder refuses to close (21 of 21 pending until the holder '
    + 'released)'
]);

/** @type {Array<{ arm: string, runs: number, completed: number, blocked: number, medianMs: number, maxMs: number }>} */
const table = [];

/**
 * @param {string} arm - Human label.
 * @param {Array<{ completed: boolean, blocked: boolean, ms: number }>} runs
 * @returns {{ completed: number, blocked: number, runs: number, medianMs: number, maxMs: number }}
 */
function summarize(arm, runs) {
    const times = runs.map(r => r.ms).sort((a, b) => a - b);
    const row = {
        arm,
        runs: runs.length,
        completed: runs.filter(r => r.completed).length,
        blocked: runs.filter(r => r.blocked).length,
        medianMs: Number(times[Math.floor(times.length / 2)].toFixed(2)),
        maxMs: Number(times[times.length - 1].toFixed(2))
    };
    table.push(row);
    return row;
}

/**
 * Deletes a database and reports what happened instead of hanging.
 * @param {string} name - Absolute database name.
 * @returns {Promise<{ completed: boolean, blocked: boolean, ms: number }>}
 */
function measureDelete(name) {
    return new Promise(resolve => {
        const started = performance.now();
        let blocked = false;
        let settled = false;
        const finish = completed => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ completed, blocked, ms: performance.now() - started });
        };
        const timer = setTimeout(() => finish(false), BOUND_MS);
        const request = indexedDB.deleteDatabase(name);
        request.onblocked = () => { blocked = true; };
        request.onsuccess = () => finish(true);
        request.onerror = () => finish(false);
    });
}

/**
 * Opens a database at version+1 to create a NEW object store inside it, which is the
 * "shared database" alternative the header rejected.
 * @param {string} name - Absolute database name.
 * @param {number} version - Version to upgrade to.
 * @returns {Promise<{ completed: boolean, blocked: boolean, ms: number }>}
 */
function measureNewObjectStore(name, version) {
    return new Promise(resolve => {
        const started = performance.now();
        let blocked = false;
        let settled = false;
        const finish = completed => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ completed, blocked, ms: performance.now() - started });
        };
        const timer = setTimeout(() => finish(false), BOUND_MS);
        const request = indexedDB.open(name, version);
        request.onblocked = () => { blocked = true; };
        request.onupgradeneeded = () => { request.result.createObjectStore('novo_store'); };
        request.onerror = () => finish(false);
        request.onsuccess = () => { request.result.close(); finish(true); };
    });
}

/**
 * Creates a brand NEW database, the option the header adopted.
 * @param {string} name - Absolute database name.
 * @returns {Promise<{ completed: boolean, blocked: boolean, ms: number }>}
 */
function measureNewDatabase(name) {
    return new Promise(resolve => {
        const started = performance.now();
        let blocked = false;
        const request = indexedDB.open(name);
        request.onblocked = () => { blocked = true; };
        request.onupgradeneeded = () => { request.result.createObjectStore('s'); };
        request.onerror = () => resolve({ completed: false, blocked, ms: performance.now() - started });
        request.onsuccess = () => {
            request.result.close();
            resolve({ completed: true, blocked, ms: performance.now() - started });
        };
    });
}

/**
 * The path production actually takes (`dropAtlasDatabases` calls `localforage.dropInstance`).
 * localforage swallows `onblocked` into a `console.warn`, so the caller never sees the
 * event: the only two observable outcomes are "resolved" and "still waiting".
 * @param {string} name - Absolute database name.
 * @returns {Promise<{ completed: boolean, blocked: boolean, ms: number, warned: boolean }>}
 */
function measureDropInstance(name) {
    const started = performance.now();
    let warned = false;
    const originalWarn = console.warn;
    console.warn = (...args) => {
        if (typeof args[0] === 'string' && args[0].includes('dropInstance blocked')) warned = true;
        else originalWarn(...args);
    };
    const dropped = localforage.dropInstance({ name }).then(() => true, () => false);
    const expired = new Promise(resolve => setTimeout(() => resolve(false), BOUND_MS));
    return Promise.race([dropped, expired]).then(completed => {
        console.warn = originalWarn;
        return { completed, blocked: warned, ms: performance.now() - started, warned };
    });
}

/**
 * @param {string} name - Absolute database name.
 * @returns {Promise<number>} Current version, 0 when the database does not exist.
 */
async function currentVersion(name) {
    const entry = (await indexedDB.databases()).find(d => d.name === name);
    return entry ? entry.version : 0;
}

beforeEach(async () => {
    await resetIndexedDB();
});

afterAll(() => {
    const lines = table.map(r =>
        `  ${r.arm.padEnd(52)} completou ${String(r.completed).padStart(2)}/${r.runs}` +
        `  blocked ${String(r.blocked).padStart(2)}/${r.runs}` +
        `  mediana ${String(r.medianMs).padStart(6)}ms  max ${String(r.maxMs).padStart(7)}ms`
    );
    console.log(`\nMEDIÇÃO Decisão 4 (${N} rodadas em série por braço):\n${lines.join('\n')}\n`);
});

describe('medição :: a pendência que esta medição abre', () => {
    // MARCADOR DE PENDÊNCIA, não asserção de comportamento. Verde enquanto a prosa errada
    // continuar em `atlas-namespace.js`; VERMELHO no commit que a reescrever, que é quando
    // este caso sai junto. Sem ele a medição fica presa a um relatório e o módulo segue
    // instruindo o contrário do que foi medido. Nenhum guarda da casa pega isso sozinho:
    // `docs-integridade` valida caminho e símbolo, nunca a veracidade de um número citado.
    //
    // Se ele ficar vermelho por uma reescrita que NÃO é a correção (uma re-quebra de linha,
    // por exemplo), leia a medição antes de reajustar a string: é para isso que ele existe.
    it('PENDENTE :: o texto contradito ainda está em src/js/store/atlas-namespace.js', () => {
        const fonte = readFileSync(NAMESPACE_SOURCE, 'utf8')
            .replace(/\r?\n\s*\*\s?/g, ' ')
            .replace(/\s+/g, ' ');

        // ASSERÇÃO ABSOLUTA, uma por sentença: um `some()` sobre as duas ficaria verde com
        // metade da correção feita.
        expect(fonte).toContain(TEXTO_A_REESCREVER[0]);
        expect(fonte).toContain(TEXTO_A_REESCREVER[1]);
    });
});

describe('medição :: controles que provam que o instrumento discrimina', () => {
    // Without this arm, every "completou 21/21" below could just mean "this fake never
    // blocks anything", and the re-measurement would be an empty green.
    it('CONTROLE A :: delete SEM holder completa 21/21', async () => {
        const runs = [];
        for (let i = 0; i < N; i++) {
            const name = `medicao_A_${i}`;
            (await holdDatabaseOpen(name)).close();
            runs.push(await measureDelete(name));
        }
        const row = summarize('A  delete, sem holder', runs);

        expect(row.completed).toBe(N);
        expect(row.blocked).toBe(0);
    });

    // The discriminating control: a holder that never answers `versionchange` DOES keep the
    // delete pending, 21/21, and `blocked` DOES fire. So the fake implements the mechanism.
    it('CONTROLE B :: delete com holder que NÃO fecha fica pendente em TODAS as rodadas', async () => {
        const runs = [];
        for (let i = 0; i < N_PENDING; i++) {
            const name = `medicao_B_${i}`;
            const holder = await holdDatabaseOpen(name, { withVersionChangeValve: false });
            runs.push(await measureDelete(name));
            holder.close();
        }
        const row = summarize('B  delete, holder SEM válvula', runs);

        expect(row.runs).toBe(N_PENDING);
        expect(row.completed).toBe(0);
        expect(row.blocked).toBe(N_PENDING);
    });
});

describe('medição :: a afirmação (iii), o delete da Decisão 4', () => {
    // THE FINDING. With the valve localforage installs on every connection it opens, the
    // delete completes 21/21 in ~0.01 ms and `blocked` never fires. The header's "21 of 21
    // pending" is literally true only of a holder that refuses to close, and no holder in
    // this codebase refuses: `getStoreFor()` is the only opener of these ten databases and
    // it opens them through localforage.
    it('com a válvula do localforage, o delete completa 21/21 e a válvula dispara 21/21', async () => {
        const runs = [];
        let valvula = 0;
        for (let i = 0; i < N; i++) {
            const name = `medicao_C_${i}`;
            const holder = await holdDatabaseOpen(name, { withVersionChangeValve: true });
            runs.push(await measureDelete(name));
            if (holder.closedByVersionChange()) valvula++;
            holder.close();
        }
        const row = summarize('C  delete, holder COM válvula (localforage)', runs);

        expect(valvula).toBe(N);
        expect(row.completed).toBe(N);
        expect(row.blocked).toBe(0);
    });

    // Same fact through the API `dropAtlasDatabases` really calls.
    it('localforage.dropInstance sob holder COM válvula completa 21/21', async () => {
        const runs = [];
        for (let i = 0; i < N; i++) {
            const name = `medicao_C2_${i}`;
            const holder = await holdDatabaseOpen(name, { withVersionChangeValve: true });
            runs.push(await measureDropInstance(name));
            holder.close();
        }
        const row = summarize('C2 dropInstance, holder COM válvula', runs);

        expect(row.completed).toBe(N);
        expect(row.blocked).toBe(0);
    });

    // AND THE HALF OF DECISION 4 THAT SURVIVES INTACT, measured for the first time: against
    // a holder without the valve, `dropInstance` never resolves AND never tells the caller
    // why. The `blocked` event is swallowed into a `console.warn` inside localforage, so
    // the bounded wait of `dropOneDatabase` is not belt-and-braces, it is the only thing
    // standing between a logout and an unbounded hang.
    it('dropInstance sob holder SEM válvula nunca resolve, e só avisa por console.warn', async () => {
        const runs = [];
        for (let i = 0; i < N_PENDING; i++) {
            const name = `medicao_C3_${i}`;
            const holder = await holdDatabaseOpen(name, { withVersionChangeValve: false });
            runs.push(await measureDropInstance(name));
            holder.close();
        }
        const row = summarize('C3 dropInstance, holder SEM válvula', runs);

        expect(row.runs).toBe(N_PENDING);
        expect(row.completed).toBe(0);
        // `blocked` here counts the console.warn, because that is the ONLY channel the
        // caller has: `dropInstance` exposes no `onblocked` of its own.
        expect(runs.every(r => r.warned)).toBe(true);
    });
});

describe('medição :: as afirmações (i) e (ii), banco novo vs object store novo', () => {
    // (ii) reproduced EXACTLY as written: a holder that refuses to close keeps the upgrade
    // pending 21/21. The header's sentence is accurate about this holder.
    it('object store novo em banco compartilhado, holder SEM válvula: pendente em todas', async () => {
        const runs = [];
        for (let i = 0; i < N_PENDING; i++) {
            const name = `medicao_D_${i}`;
            const holder = await holdDatabaseOpen(name, { withVersionChangeValve: false });
            runs.push(await measureNewObjectStore(name, await currentVersion(name) + 1));
            holder.close();
        }
        const row = summarize('D  object store novo, holder SEM válvula', runs);

        expect(row.runs).toBe(N_PENDING);
        expect(row.completed).toBe(0);
        expect(row.blocked).toBe(N_PENDING);
    });

    // THE SECOND FINDING, and the one that touches the header's headline argument: with the
    // valve, the very same upgrade completes 21/21 in ~0.01 ms. So "creating an object
    // store inside a shared database stays pending" is not a property of the operation, it
    // is a property of the holder, and the holders in this product all yield.
    it('object store novo em banco compartilhado, holder COM válvula: completa 21/21', async () => {
        const runs = [];
        let valvula = 0;
        for (let i = 0; i < N; i++) {
            const name = `medicao_E_${i}`;
            const holder = await holdDatabaseOpen(name, { withVersionChangeValve: true });
            runs.push(await measureNewObjectStore(name, await currentVersion(name) + 1));
            if (holder.closedByVersionChange()) valvula++;
            holder.close();
        }
        const row = summarize('E  object store novo, holder COM válvula', runs);

        expect(valvula).toBe(N);
        expect(row.completed).toBe(N);
        expect(row.blocked).toBe(0);
    });

    // (i) CONFIRMED, and it is the claim the adopted design actually rests on: a brand new
    // database name is untouched by any number of held siblings, even siblings whose
    // holders refuse to close. This half of the header needs no correction.
    it('banco NOVO com 10 irmãos segurados por holders SEM válvula: 21/21, sem blocked', async () => {
        const holders = [];
        for (let i = 0; i < 10; i++) {
            holders.push(await holdDatabaseOpen(`medicao_F_irmao_${i}`, { withVersionChangeValve: false }));
        }
        const runs = [];
        for (let i = 0; i < N; i++) {
            runs.push(await measureNewDatabase(`medicao_F_novo_${i}`));
        }
        const row = summarize('F  banco NOVO, 10 irmãos segurados', runs);

        expect(row.completed).toBe(N);
        expect(row.blocked).toBe(0);
        // Positive assertion that the siblings were really there and really held: without
        // it, "no blocking" could just mean nothing was open.
        const nomes = await listDatabases();
        expect(nomes).toContain('medicao_F_irmao_0');
        expect(nomes).toContain('medicao_F_irmao_9');
        expect(nomes).toContain('medicao_F_novo_20');

        holders.forEach(h => h.close());
    });
});
