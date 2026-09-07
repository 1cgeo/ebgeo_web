// Path: tests/unit/tipos-feicao-paridade-pacotes.test.js
//
// THE FOUR COPIES OF THE FEATURE-TYPE LIST, ACROSS THE PACKAGE BOUNDARY.
//
// The same closed list is written out four times, in three languages, in two packages, and
// nothing forces them to agree:
//
//   1. `VALID_FEATURE_TYPES` in `src/js/import_export/local-atlas-to-server.js` (client);
//   2. `VALID_FEATURE_TYPES` in `backend/src/modules/atlas/atlas.schemas.js` (Joi);
//   3. the `valid_feature_type` CHECK in `backend/src/database/migrations/*.sql` (database);
//   4. `typeToCollection` in `backend/src/modules/sync/sync.service.js` (snapshot).
//
// The four failure modes are all mute, and they are NOT the same failure:
//
//   missing from (1) -> the feature is dropped BEFORE the network, `stats.droppedFeatures` is
//     bumped, and no consumer of that counter renders it: the user sees a successful import;
//   missing from (2) -> the whole import takes a 400 and no atlas is born (loud, the mild one);
//   missing from (3) -> the write is refused by the database (loud for the import, and for sync
//     it poisons the ack path for that op);
//   missing from (4) -> THE WORST, and the reason this file exists: the row is WRITTEN and
//     never appears in any snapshot. Invisible to every client, forever, with no error anywhere.
//
// WHY A FRONTEND TEST READS BACKEND SOURCE, AND WHAT THAT COSTS YOU.
// This file lives in the frontend suite and opens files under `backend/`. That is deliberate:
// nothing else in the repository crosses that boundary, and the divergence being guarded is
// exactly a cross-boundary one. The PRICE, which you are meeting right now if this test is the
// red one: **a backend-only change can turn the FRONTEND leg of `npm test` red.** That is the
// guard working, not a broken frontend. Read the failure message, then edit the backend file it
// names. Do not go looking for the defect in `frontend/src/`.
//
// The other half of this guard is `backend/tests/integration/tipos-feicao-constraint-viva.test.js`,
// which asks the LIVE database (`pg_get_constraintdef`) instead of the migration text, because
// deployed schema and committed SQL are different facts. Text cannot answer that question.
// The pre-existing `backend/tests/unit/snapshot-tipos-vs-check.test.js` ties two of the four
// (the CHECK and `typeToCollection`); this file ties all four plus the collection skeleton.
//
// ACCEPTED FRAGILITIES (all of them break toward the FLOOR, which is a red with its own message,
// never a silent green): a copy that stops being a literal array/Set of quoted strings (generated
// list, values imported from elsewhere, a type spelled with a character outside `[a-z_]`); the Joi
// constant renamed; the CHECK renamed; `typeToCollection` turned into a `Map`. Each one makes an
// extractor return nothing, and the floor case fires first and says so.
//
// NO AST HERE, ON PURPOSE: `acorn` is not declared in any `package.json` of this repo, and
// declaring it touches the lockfile, which is a decision with an owner. Text + anchored regex.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildServerImportPayload } from '@js/import_export/local-atlas-to-server.js';

// `new URL` + `import.meta.url`, never a raw slash-joined path: this suite runs on Windows.
const ARQ_CLIENTE = fileURLToPath(
    new URL('../../src/js/import_export/local-atlas-to-server.js', import.meta.url),
);
const ARQ_JOI = fileURLToPath(
    new URL('../../../backend/src/modules/atlas/atlas.schemas.js', import.meta.url),
);
const ARQ_SYNC = fileURLToPath(
    new URL('../../../backend/src/modules/sync/sync.service.js', import.meta.url),
);
// Kept as a URL (not a path): `readdirSync` accepts one, and `new URL(nome, DIR)` is the only
// join that stays correct on Windows.
const DIR_MIGRACOES = new URL('../../../backend/src/database/migrations/', import.meta.url);

/** Every quoted lower-snake literal inside a source slice. */
function literais(trecho) {
    return [...trecho.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/**
 * Slices from `abertura` to the first `fecho` after it. Returns `null` when the anchor is gone,
 * so the caller's floor assertion (not a comparison against an empty set) reports the breakage.
 * @param {string} fonte
 * @param {string} abertura
 * @param {string} fecho
 * @returns {string|null}
 */
function fatia(fonte, abertura, fecho) {
    const i = fonte.indexOf(abertura);
    if (i === -1) return null;
    const j = fonte.indexOf(fecho, i + abertura.length);
    if (j === -1) return null;
    return fonte.slice(i, j);
}

/** Client allowlist: `const VALID_FEATURE_TYPES = new Set([ ... ]);` */
function tiposDoCliente(fonte) {
    const bloco = fatia(fonte, 'const VALID_FEATURE_TYPES = new Set([', ']);');
    return bloco ? literais(bloco) : [];
}

/**
 * Client bucket table: `const BUCKET_TO_SOURCE = { points: 'point', ... };`, INVERTED to
 * `type -> bucket`. It is the table `buildFeatures` asks first since the B3-5 fix, so it is what
 * the behavioural cases below have to place their features by.
 * @param {string} fonte
 * @returns {Object<string, string>}
 */
function baldesDoCliente(fonte) {
    const bloco = fatia(fonte, 'const BUCKET_TO_SOURCE = {', '};');
    if (!bloco) return {};
    const pares = [...bloco.matchAll(/([a-z_]+)\s*:\s*'([a-z_]+)'/g)];
    return Object.fromEntries(pares.map((m) => [m[2], m[1]]));
}

/** Joi allowlist: `const VALID_FEATURE_TYPES = [ ... ];` (backend, no `new Set`). */
function tiposDoJoi(fonte) {
    const bloco = fatia(fonte, 'const VALID_FEATURE_TYPES = [', '];');
    return bloco ? literais(bloco) : [];
}

/**
 * Database CHECK, read across ALL migrations with the LAST declaration winning: the house idiom
 * for widening a constraint is DROP + ADD in a later-numbered file, so the first match is the
 * stale one. Files are read in filename order, which is the order the runner applies them.
 * @param {URL} dir
 * @returns {string[]}
 */
function tiposDoCheck(dir) {
    const padrao = /valid_feature_type\s+CHECK\s*\(\s*feature_type\s+IN\s*\(([\s\S]*?)\)\s*\)/g;
    let ultimo = null;
    for (const nome of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
        const sql = readFileSync(new URL(nome, dir), 'utf8');
        for (const m of sql.matchAll(padrao)) ultimo = m[1];
    }
    return ultimo ? literais(ultimo) : [];
}

/** Keys of `typeToCollection` (feature types the snapshot knows how to place). */
function tiposDoMapaDeColecao(fonte) {
    const bloco = fatia(fonte, 'const typeToCollection = {', '};');
    return bloco ? [...bloco.matchAll(/^\s*([a-z_]+):\s*'/gm)].map((m) => m[1]) : [];
}

/** Values of `typeToCollection` (the bucket each type lands in). */
function colecoesDoMapaDeColecao(fonte) {
    const bloco = fatia(fonte, 'const typeToCollection = {', '};');
    return bloco ? [...bloco.matchAll(/^\s*[a-z_]+:\s*'([a-z_]+)'/gm)].map((m) => m[1]) : [];
}

/** Bucket names of the `transformFeaturesToFrontend` skeleton (`const result = { points: [], ... }`). */
function baldesDoEsqueleto(fonte) {
    // Anchored on the FUNCTION first: `const result = {` is not unique in sync.service.js (the
    // 3D and 360 transforms open the same way), and slicing on it alone would read the wrong one.
    const i = fonte.indexOf('function transformFeaturesToFrontend(');
    if (i === -1) return [];
    const bloco = fatia(fonte.slice(i), 'const result = {', '};');
    return bloco ? [...bloco.matchAll(/^\s*([a-z_]+):\s*\[\]/gm)].map((m) => m[1]) : [];
}

/**
 * Every "type X is missing from source Y" over the union of the given sources. Reporting the
 * union (instead of a pairwise deepEqual) makes a one-line omission name the ONE file to edit.
 * @param {Object<string, string[]>} fontes
 * @returns {string[]}
 */
function divergencias(fontes) {
    const uniao = [...new Set(Object.values(fontes).flat())].sort();
    const faltas = [];
    for (const [nome, lista] of Object.entries(fontes)) {
        const tem = new Set(lista);
        for (const tipo of uniao) if (!tem.has(tipo)) faltas.push(`'${tipo}' missing from ${nome}`);
    }
    return faltas.sort();
}

const fonteCliente = readFileSync(ARQ_CLIENTE, 'utf8');
const cliente = tiposDoCliente(fonteCliente);
const baldePorTipo = baldesDoCliente(fonteCliente);
const joi = tiposDoJoi(readFileSync(ARQ_JOI, 'utf8'));
const check = tiposDoCheck(DIR_MIGRACOES);
const sync = readFileSync(ARQ_SYNC, 'utf8');
const mapaTipos = tiposDoMapaDeColecao(sync);
const mapaColecoes = colecoesDoMapaDeColecao(sync);
const esqueleto = baldesDoEsqueleto(sync);

const QUATRO_FONTES = {
    'local-atlas-to-server.js (cliente)': cliente,
    'atlas.schemas.js (Joi)': joi,
    '003_atlas.sql (CHECK do banco)': check,
    'sync.service.js (typeToCollection)': mapaTipos,
};

// The four types whose absence has actually been paid for in this repository, spelled out so a
// pair of identically-wrong copies cannot pass by agreeing with each other.
const TIPOS_QUE_JA_FALTARAM = ['sector', 'magnetic_declination', 'processed_los', 'processed_visibility'];

describe('tipos de feicao: as quatro copias que cruzam os pacotes', () => {
    it('FLOOR: the five extractions found something (before any comparison)', () => {
        // Without this, the day an anchor breaks the diagnosis is inverted: the report would read
        // "the lists diverged" when the truth is "the extractor stopped working".
        expect(cliente.length, 'client VALID_FEATURE_TYPES not extracted').toBeGreaterThanOrEqual(20);
        expect(joi.length, 'Joi VALID_FEATURE_TYPES not extracted').toBeGreaterThanOrEqual(20);
        expect(check.length, 'valid_feature_type CHECK not extracted').toBeGreaterThanOrEqual(20);
        expect(mapaTipos.length, 'typeToCollection keys not extracted').toBeGreaterThanOrEqual(20);
        expect(esqueleto.length, 'transformFeaturesToFrontend skeleton not extracted').toBeGreaterThanOrEqual(20);
    });

    it('ABSOLUTE: each copy carries the types that have already been forgotten here', () => {
        // Comparative assertions alone would pass on four copies wrong in the same way.
        for (const [nome, lista] of Object.entries(QUATRO_FONTES)) {
            for (const tipo of TIPOS_QUE_JA_FALTARAM) {
                expect(lista, `${nome} lost '${tipo}'`).toContain(tipo);
            }
        }
    });

    it('the four copies carry exactly the same types', () => {
        // Its own floor, before comparing: a broken anchor makes one source empty and every type
        // of the other three "missing", burying the one true message under 20 invented ones.
        for (const [nome, lista] of Object.entries(QUATRO_FONTES)) {
            expect(lista.length, `${nome}: nothing extracted — read the FLOOR case, not this one`)
                .toBeGreaterThan(0);
        }
        // Exact parity, no allowlist: the four answer the SAME question. An allowlist empty on
        // day one would be empty coverage wearing the clothes of rigour.
        expect(divergencias(QUATRO_FONTES)).toEqual([]);
    });

    it('no copy repeats a type', () => {
        for (const [nome, lista] of Object.entries(QUATRO_FONTES)) {
            expect(new Set(lista).size, `${nome} has a duplicate entry`).toBe(lista.length);
        }
    });

    it('every collection typeToCollection points at exists in the snapshot skeleton', () => {
        // A SEPARATE assertion on purpose: the skeleton speaks BUCKET names (`points`, `setores`)
        // and the four copies above speak TYPE names (`point`, `sector`). Folding the two into one
        // parity check fails on 16 of the 20 by category error, not by drift.
        const baldes = new Set(esqueleto);
        expect(mapaColecoes.filter((c) => !baldes.has(c))).toEqual([]);
    });

    it('every bucket in the snapshot skeleton is reachable from some type', () => {
        const alvos = new Set(mapaColecoes);
        expect(esqueleto.filter((b) => !alvos.has(b))).toEqual([]);
    });
});

describe('tipos de feicao: leitura COMPORTAMENTAL do cliente', () => {
    // REESCRITO em 2026-09-07 junto com o achado B3-5, e a razão é que estes dois casos fixavam
    // a precedência ANTIGA. Eles empilhavam os vinte e um tipos dentro do balde `points` e
    // esperavam que `properties.source` decidisse por todos, o que era verdade enquanto o
    // produtor lia `props.source || BUCKET_TO_SOURCE[bucket]`. Essa precedência era o defeito:
    // o resultado de análise mora no balde `processed_los`/`processed_visibility` carregando
    // `source: 'los'`/`'visibility'`, então ler o source primeiro subia RESULTADO como
    // DEFINIÇÃO (medido: 3/6/3/6 no arquivo viraram 9/9/0/0 no servidor). Com o balde decidindo,
    // um insumo que põe tudo em `points` responde `point` vinte e uma vezes, e isso é o produtor
    // CERTO respondendo a uma pergunta errada. O que os dois casos passam a medir é a mesma
    // propriedade sobre o arranjo verdadeiro: cada tipo no balde onde ele mora de verdade.
    //
    // O ARRANJO NÃO SE ESCREVE À MÃO AQUI: ele sai do próprio `BUCKET_TO_SOURCE`, lido do texto
    // do cliente como as outras quatro cópias. Isso o torna uma QUINTA cópia vigiada, e ela é a
    // que decide desde o conserto: um tipo que entre em `VALID_FEATURE_TYPES` e falte no
    // `BUCKET_TO_SOURCE` deixa de ter balde nenhum, e o teste abaixo diz o nome dele.

    /** Minimal accepted feature. */
    const feicao = (source) => ({
        type: 'Feature',
        properties: { id: `id-${source}`, source },
        geometry: { type: 'Point', coordinates: [0, 0] },
    });

    it('FLOOR: o BUCKET_TO_SOURCE do cliente foi extraido, e cobre a lista compartilhada', () => {
        expect(Object.keys(baldePorTipo).length, 'BUCKET_TO_SOURCE not extracted').toBeGreaterThanOrEqual(20);
        const semBalde = check.filter((tipo) => !baldePorTipo[tipo]);
        expect(semBalde, 'types with no bucket in BUCKET_TO_SOURCE').toEqual([]);
    });

    it('pass 1: every type of the shared list survives buildServerImportPayload', () => {
        // Stronger than reading the constant's text: this is the gate as it actually runs.
        const buckets = {};
        for (const tipo of check) buckets[baldePorTipo[tipo]] = [feicao(tipo)];
        const { payload, stats } = buildServerImportPayload({ maps: { M: { features: buckets } } }, { name: 'A' });
        expect(check.length).toBeGreaterThanOrEqual(20); // floor, again: an empty map drops nothing
        expect(stats.droppedFeatures, 'types the client silently refuses').toBe(0);
        expect(payload.maps[0].features.map((f) => f.feature_type).sort()).toEqual([...check].sort());
    });

    it('pass 2: a bucket outside the list is dropped, silently, exactly as described', () => {
        // Positive control for pass 1: without this, a producer that accepted EVERYTHING would
        // also make pass 1 green, and the guard would be measuring nothing. O balde desconhecido
        // é a única porta de descarte que sobrou depois do B3-5, e é a que o `coordenadas`
        // (leitura efêmera de azimute) usa: balde que o produtor não conhece cai no `source`, e
        // um `source` fora da lista é descartado ali.
        const { payload, stats } = buildServerImportPayload({
            maps: { M: { features: { points: [feicao('point')], coordenadas: [feicao('tipo_que_nao_existe')] } } },
        }, { name: 'A' });
        expect(payload.maps[0].features).toHaveLength(1);
        expect(payload.maps[0].features[0].feature_type).toBe('point');
        expect(stats.droppedFeatures).toBe(1);
    });
});

describe('tipos de feicao: controle positivo dos extratores (fixtures sinteticas)', () => {
    // This guard is born green over correct code, which makes it indistinguishable from a blind
    // guard until someone proves it can see. These cases run the REAL extractors over synthetic
    // source text with a type deliberately removed, on every run, so the proof never expires.

    const CLIENTE_FALSO = `
        const VALID_FEATURE_TYPES = new Set([
            'point', 'line', 'sector',
        ]);
        const BUCKET_TO_SOURCE = {
            points: 'point', lines: 'line',
            setores: 'sector',
        };
    `;
    const JOI_FALSO = `
        const VALID_FEATURE_TYPES = [
          'point', 'line', 'sector',
        ];
    `;
    const CHECK_FALSO = `
        CONSTRAINT valid_feature_type CHECK (feature_type IN (
            'point', 'line', 'sector'
        ))
    `;
    const SYNC_FALSO = `
        function transformFeaturesToFrontend(features) {
          const result = {
            points: [],
            lines: [],
            setores: [],
          };
          const typeToCollection = {
            point: 'points',
            line: 'lines',
            sector: 'setores',
          };
        }
    `;

    it('the extractors read each shape they are pointed at', () => {
        expect(tiposDoCliente(CLIENTE_FALSO)).toEqual(['point', 'line', 'sector']);
        expect(tiposDoJoi(JOI_FALSO)).toEqual(['point', 'line', 'sector']);
        expect(literais(CHECK_FALSO)).toEqual(['point', 'line', 'sector']);
        expect(tiposDoMapaDeColecao(SYNC_FALSO)).toEqual(['point', 'line', 'sector']);
        expect(colecoesDoMapaDeColecao(SYNC_FALSO)).toEqual(['points', 'lines', 'setores']);
        expect(baldesDoEsqueleto(SYNC_FALSO)).toEqual(['points', 'lines', 'setores']);
        expect(baldesDoCliente(CLIENTE_FALSO)).toEqual({ point: 'points', line: 'lines', sector: 'setores' });
    });

    it('um tipo SEM balde no BUCKET_TO_SOURCE e visto, e o nome dele sai na lista', () => {
        // O controle positivo do caso FLOOR novo, que nasce verde sobre codigo certo. Sem ele,
        // um `BUCKET_TO_SOURCE` que perdesse uma linha deixaria o tipo sem balde nenhum e o
        // produtor o descartaria em silencio, com o guarda verde do lado.
        const baldes = baldesDoCliente(CLIENTE_FALSO.replace("setores: 'sector',", ''));
        expect(['point', 'line', 'sector'].filter((t) => !baldes[t])).toEqual(['sector']);
    });

    it('a type removed from ONE copy is seen, and the report names that copy', () => {
        const semSetorNoJoi = tiposDoJoi(JOI_FALSO.replace(", 'sector'", ''));
        expect(semSetorNoJoi).toEqual(['point', 'line']);
        expect(divergencias({
            'local-atlas-to-server.js (cliente)': tiposDoCliente(CLIENTE_FALSO),
            'atlas.schemas.js (Joi)': semSetorNoJoi,
            '003_atlas.sql (CHECK do banco)': literais(CHECK_FALSO),
            'sync.service.js (typeToCollection)': tiposDoMapaDeColecao(SYNC_FALSO),
        })).toEqual(["'sector' missing from atlas.schemas.js (Joi)"]);
    });

    it('a type removed from the snapshot map is seen — the worst of the four', () => {
        expect(divergencias({
            'local-atlas-to-server.js (cliente)': tiposDoCliente(CLIENTE_FALSO),
            'atlas.schemas.js (Joi)': tiposDoJoi(JOI_FALSO),
            '003_atlas.sql (CHECK do banco)': literais(CHECK_FALSO),
            'sync.service.js (typeToCollection)': tiposDoMapaDeColecao(
                SYNC_FALSO.replace("sector: 'setores',", ''),
            ),
        })).toEqual(["'sector' missing from sync.service.js (typeToCollection)"]);
    });

    it('a broken anchor yields NOTHING, which is what the floor case is for', () => {
        expect(tiposDoCliente('const OUTRO_NOME = new Set([\'point\']);')).toEqual([]);
        expect(tiposDoJoi('const OUTRO_NOME = [\'point\'];')).toEqual([]);
        expect(tiposDoMapaDeColecao('const outroMapa = { point: \'points\' };')).toEqual([]);
        expect(baldesDoEsqueleto('function outra() { const result = { points: [] }; }')).toEqual([]);
        expect(baldesDoCliente('const OUTRO_NOME = { points: \'point\' };')).toEqual({});
    });

    it('the CHECK reader lets the LAST declaration win over an earlier one', () => {
        // The DROP + ADD idiom: an earlier migration declares three types, a later one widens to
        // four. Reading the first match would report a list that the database left behind.
        const padrao = /valid_feature_type\s+CHECK\s*\(\s*feature_type\s+IN\s*\(([\s\S]*?)\)\s*\)/g;
        const antigo = "CONSTRAINT valid_feature_type CHECK (feature_type IN ('point','line'))";
        const novo = "ADD CONSTRAINT valid_feature_type CHECK (feature_type IN ('point','line','sector'))";
        const todos = [...`${antigo}\n${novo}`.matchAll(padrao)].map((m) => literais(m[1]));
        expect(todos).toHaveLength(2);
        expect(todos.at(-1)).toEqual(['point', 'line', 'sector']);
    });
});
