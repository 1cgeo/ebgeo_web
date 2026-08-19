// Path: tests/e2e/nomes-busca-anon.e2e.test.js

/**
 * @fileoverview E2E: anonymous gazetteer search (`GET /api/v1/nomes/busca`).
 *
 * The frontend's gazetteer IS this backend — `search/gazetteer-url.js`
 * (`gazetteerSearchUrl()`) builds the URL from the backend base URL. (This header
 * used to cite `config.search.apiUrl`, a field REMOVED from the frozen `/api/config`
 * contract; `config.search` stays in the shape and stays empty, which
 * `config-contract.e2e.test.js` asserts.) The route must work for the ANONYMOUS
 * path: no `auth` middleware guards `/nomes/busca`. It returns a FROZEN contract —
 * a bare JSON array (up to 5 results), NOT the `{ data }` envelope.
 *
 * This suite hits the live backend with a plain `fetch` and NO Authorization
 * header, and adds negative assertions for the Joi query schema (`q` min 3,
 * `lat`/`lon` required).
 *
 * SEEDING. `ng.nomes_geograficos` is READ-ONLY reference data: there is no REST
 * write route for it (by design), and the migrations create the table empty, so
 * every assertion about the RESULT used to be vacuous — the body was always `[]`,
 * `body.length <= 5` passed on zero and the per-entry loop never ran (exactly the
 * empty-coverage shape the backend's own `no-unasserted-loop-assert` lint rule
 * forbids). The suite therefore seeds its own rows straight into the e2e database,
 * the same connection `global-setup.js` provisions (pg-promise resolved from the
 * backend's node_modules, since it is not a frontend dependency), and removes them
 * afterwards. Seeded names carry a synthetic prefix so nothing else can match them.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { getBaseUrl, E2E_SKIP } from './helpers/harness.js';

// Same resolution as global-setup.js: the backend of this monorepo, overridable.
const BACKEND_DIR =
    process.env.EBGEO_BACKEND_DIR ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');
const backendRequire = createRequire(pathToFileURL(`${BACKEND_DIR}/package.json`).href);
const pgPromise = backendRequire('pg-promise');

// Same connection global-setup.js migrates and the spawned backend serves.
const DB_NAME = process.env.EBGEO_E2E_DB_NAME || 'ebgeo_e2e';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '5432';
const DB_USER = process.env.DB_USER || 'ebgeo';
const DB_PASSWORD = process.env.DB_PASSWORD || 'ebgeo_secret';
const E2E_DB_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

/** Synthetic toponym base: nothing else in the gazetteer can be trigram-similar to it. */
const PUBLIC_BASE = 'Guaporanga';
/** SEVEN public rows against a frozen LIMIT of 5 — the cap becomes observable. */
const PUBLIC_NAMES = [
    `${PUBLIC_BASE}`,
    `${PUBLIC_BASE} do Sul`,
    `${PUBLIC_BASE} Velha`,
    `${PUBLIC_BASE} Nova`,
    `${PUBLIC_BASE} de Cima`,
    `${PUBLIC_BASE} de Baixo`,
    `${PUBLIC_BASE} Grande`,
];
/** A PRIVATE row, matched by its own term: the anonymous path must never see it. */
const PRIVATE_BASE = 'Marisbelo';
const PRIVATE_NAME = `${PRIVATE_BASE} Escondido`;

describe.skipIf(E2E_SKIP)('e2e: nomes-busca-anon', () => {
    const url = (qs) => `${getBaseUrl()}/api/v1/nomes/busca?${qs}`;

    /** @type {Object} pg-promise root, kept to close the pool in afterAll. */
    let pgp;
    /** @type {Object} pg-promise database handle. */
    let db;

    beforeAll(async () => {
        pgp = pgPromise();
        db = pgp(E2E_DB_URL);

        // Public rows, clustered around the query point (SRID 4674, like the table).
        for (const [i, nome] of PUBLIC_NAMES.entries()) {
            await db.none(
                `INSERT INTO ng.nomes_geograficos (nome, tipo, municipio, estado, geom)
                 VALUES ($1, $2, 'Município E2E', 'RJ',
                         ST_SetSRID(ST_MakePoint($3, $4), 4674))`,
                [nome, i === 0 ? 'Cidade' : 'Morro', -43.2 + i * 0.01, -22.9 + i * 0.01]
            );
        }
        await db.none(
            `INSERT INTO ng.nomes_geograficos (nome, tipo, municipio, estado, geom)
             VALUES ($1, 'Cidade', 'Município E2E', 'RJ',
                     ST_SetSRID(ST_MakePoint(-43.2, -22.9), 4674))`,
            [PRIVATE_NAME]
        );

        // Mandatory post-load step (clusters + tipo_peso), as a real FME load does.
        await db.one('SELECT ng.refresh_busca()');
    }, 20000);

    afterAll(async () => {
        try {
            await db?.none(
                `DELETE FROM ng.nomes_geograficos WHERE nome LIKE $1 OR nome LIKE $2`,
                [`${PUBLIC_BASE}%`, `${PRIVATE_BASE}%`]
            );
        } finally {
            await pgp?.end();
        }
    });

    it('returns HTTP 200 and a bare JSON array with no auth header', async () => {
        const res = await fetch(url(`q=${PUBLIC_BASE}&lat=-22.9&lon=-43.2`), {
            headers: { Accept: 'application/json' },
        });

        expect(res.status).toBe(200);

        const body = await res.json();
        // Frozen contract: a bare array (NOT a `{ data: [...] }` envelope).
        expect(Array.isArray(body)).toBe(true);
        expect(body).not.toHaveProperty('data');
        // SEVEN rows match; the frozen contract caps the answer at 5. Asserting the
        // exact length is what makes the loop below verify anything at all.
        expect(body).toHaveLength(5);

        for (const entry of body) {
            expect(entry).toBeTypeOf('object');
            expect(entry).not.toBeNull();
            // Frozen record shape (nomes.service.js): every field the frontend reads.
            expect(PUBLIC_NAMES).toContain(entry.nome);
            expect(entry.municipio).toBe('Município E2E');
            expect(entry.estado).toBe('RJ');
            expect(typeof entry.tipo).toBe('string');
            expect(Number.isFinite(entry.longitude)).toBe(true);
            expect(Number.isFinite(entry.latitude)).toBe(true);
            // The score survives as a number in [0,1], the range the ranking encodes.
            expect(Number.isFinite(entry.score)).toBe(true);
            expect(entry.score).toBeGreaterThan(0);
            expect(entry.score).toBeLessThanOrEqual(1);
        }

        // `ORDER BY score DESC` reaches the client as a non-increasing sequence.
        const scores = body.map((e) => e.score);
        expect(scores).toEqual([...scores].sort((a, b) => b - a));
    });

    it('a busca NÃO tem eixo de acesso: o anônimo recebe todo nome semeado', async () => {
        // ESTE CASO FOI INVERTIDO EM 2026-08-19, e a inversão é o registro da decisão.
        // Ele afirmava que o anônimo recebia ZERO resultados para este termo, porque a
        // linha era `access_level = 'private'` e a consulta filtrava. O eixo inteiro foi
        // REMOVIDO (a coluna, o índice, o predicado e as zonas geográficas que o
        // sustentavam): busca de topônimo é aberta, por decisão do dono, e era sistema
        // antigo com API de admin e nenhuma tela.
        //
        // O caso fica, invertido, em vez de sair: ele é o que reprova se alguém
        // reintroduzir um filtro aqui, e a inversão de um teste é como esta casa
        // registra que uma propriedade mudou de sinal em vez de deixar de ser medida.
        const res = await fetch(url(`q=${PRIVATE_BASE}&lat=-22.9&lon=-43.2`), {
            headers: { Accept: 'application/json' },
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeGreaterThan(0);
        expect(body.some((r) => r.nome === PRIVATE_NAME)).toBe(true);
    });

    it('rejects a too-short query (`q` min 3) with HTTP 422', async () => {
        const res = await fetch(url('q=ri&lat=-22.9&lon=-43.2'), {
            headers: { Accept: 'application/json' },
        });
        // Joi validation at the border fails before the handler runs.
        expect(res.status).toBe(422);
    });

    it('rejects a missing required coordinate (`lon`) with HTTP 422', async () => {
        const res = await fetch(url('q=rio&lat=-22.9'), {
            headers: { Accept: 'application/json' },
        });
        expect(res.status).toBe(422);
    });
});
