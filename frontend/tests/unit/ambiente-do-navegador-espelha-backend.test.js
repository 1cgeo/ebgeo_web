// Path: tests/unit/ambiente-do-navegador-espelha-backend.test.js

/**
 * @fileoverview The browser environment vocabulary lives in TWO leaves, one per package
 * (`frontend/src/js/session/ambiente-do-navegador.js` and
 * `backend/src/modules/uso/ambiente-do-navegador.js`). The backend one feeds the Joi of both
 * anonymous telemetry routes and is repeated in three CHECK constraints (compared on that side by
 * `backend/tests/unit/ambiente-do-navegador-check.test.js`). A value added on one side only costs
 * the whole error report or usage batch in a 422, and this file turns that red at build time.
 *
 * SAME SHAPE AS `eventos-de-uso-espelha-backend.test.js`: a floor against an empty comparison,
 * the absolute lists, and only then the comparison of the two sides.
 *
 * NEGATIVE CONTROL (checked by reverting): adding a family only to the client leaf turns the
 * list case red; loosening a text shape (say `gpu` to any character) on one side turns the shape
 * case red; changing a ceiling on one side turns the ceiling case red; and adding a FIELD only to
 * the client rule table, or only to `ambienteSchema`, turns the fields case red.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as cliente from '../../src/js/session/ambiente-do-navegador.js';
import * as servidor from '../../../backend/src/modules/uso/ambiente-do-navegador.js';

const LISTAS = ['FAMILIAS_DE_NAVEGADOR', 'FAMILIAS_DE_SO', 'TIPOS_DE_DISPOSITIVO', 'VERSOES_DE_WEBGL'];

describe('the browser environment vocabulary of the backend mirrors the frontend', () => {
    it('both modules were really loaded (floor against an empty comparison)', () => {
        for (const nome of LISTAS) {
            expect(cliente[nome]?.length, `client ${nome}`).toBeGreaterThanOrEqual(3);
            expect(servidor[nome]?.length, `server ${nome}`).toBeGreaterThanOrEqual(3);
        }
    });

    it('the lists are exactly the expected ones, on BOTH sides and in the same order', () => {
        const esperadas = {
            FAMILIAS_DE_NAVEGADOR: ['chrome', 'firefox', 'edge', 'safari', 'opera', 'outro'],
            FAMILIAS_DE_SO: ['windows', 'macos', 'linux', 'chromeos', 'android', 'ios', 'outro'],
            TIPOS_DE_DISPOSITIVO: ['desktop', 'movel', 'tablet'],
            VERSOES_DE_WEBGL: ['webgl2', 'webgl', 'nenhum'],
        };
        for (const nome of LISTAS) {
            expect([...cliente[nome]], `client ${nome}`).toEqual(esperadas[nome]);
            expect([...servidor[nome]], `server ${nome}`).toEqual(esperadas[nome]);
            expect(Object.isFrozen(cliente[nome])).toBe(true);
            expect(Object.isFrozen(servidor[nome])).toBe(true);
        }
    });

    it('the ceilings are identical, key by key', () => {
        expect(Object.keys(cliente.TETOS_DE_AMBIENTE).sort()).toEqual(Object.keys(servidor.TETOS_DE_AMBIENTE).sort());
        for (const [chave, valor] of Object.entries(cliente.TETOS_DE_AMBIENTE)) {
            expect(servidor.TETOS_DE_AMBIENTE[chave], chave).toBe(valor);
        }
    });

    it('the text shapes are identical, by source and flags', () => {
        const formas = Object.keys(cliente.FORMAS_DE_AMBIENTE);
        expect(formas.sort()).toEqual(['fuso', 'gpu', 'idioma', 'versao']);
        expect(Object.keys(servidor.FORMAS_DE_AMBIENTE).sort()).toEqual(formas);
        for (const chave of formas) {
            expect(servidor.FORMAS_DE_AMBIENTE[chave].source, chave).toBe(cliente.FORMAS_DE_AMBIENTE[chave].source);
            expect(servidor.FORMAS_DE_AMBIENTE[chave].flags, chave).toBe(cliente.FORMAS_DE_AMBIENTE[chave].flags);
        }
    });

    it('the FIELDS of the block are the same on both sides, and they are the keys of the Joi', () => {
        // A field that only one side knows is a 422 on the WHOLE report, and the capturer does
        // not queue a 4xx: the report is lost in silence. Three lists must agree: the client rule
        // table (whose keys ARE `CAMPOS_DE_AMBIENTE`, so the cut cannot emit anything else), the
        // backend list, and the keys written in `ambienteSchema`. The last one is read from the
        // SOURCE, like `origens-de-erro.test.js` does, because the backend is not a dependency of
        // this package; the backend suite pins the same Joi to its list by `describe()`.
        expect(cliente.CAMPOS_DE_AMBIENTE.length).toBe(26);
        expect([...servidor.CAMPOS_DE_AMBIENTE]).toEqual([...cliente.CAMPOS_DE_AMBIENTE]);

        const fonte = readFileSync(fileURLToPath(new URL('../../../backend/src/modules/diag/diag.schemas.js', import.meta.url)), 'utf8');
        const inicio = fonte.indexOf('const ambienteSchema = Joi.object({');
        expect(inicio, '`ambienteSchema` moved or was renamed: this mirror lost its target').toBeGreaterThan(-1);
        const fim = fonte.indexOf('}).unknown(false);', inicio);
        expect(fim).toBeGreaterThan(inicio);
        const doJoi = [...fonte.slice(inicio, fim).matchAll(/^ {2}([A-Za-z]+):/gm)].map((m) => m[1]);
        expect(doJoi).toEqual([...cliente.CAMPOS_DE_AMBIENTE]);
    });

    it('a full, valid block survives the cut field by field (the table accepts what it lists)', () => {
        // Without this, a rule that refused every value would keep the field in the list and never
        // send it: the lists would agree and the field would be dead.
        const completo = {
            navegador: 'firefox', navegadorVersao: '143.0', so: 'windows', soVersao: '10.0',
            soVersaoCh: '15.0.0', dispositivo: 'desktop', toque: 0, telaLargura: 1920, telaAltura: 1080,
            janelaLargura: 1536, janelaAltura: 730, escala: 1.25, idioma: 'pt-BR', fuso: 'America/Sao_Paulo',
            nucleos: 8, memoriaGb: 8, webgl: 'webgl2', gpu: 'ANGLE (Intel)', texturaMax: 16384,
            armazenamentoUsoMb: 12, armazenamentoCotaMb: 2048, armazenamentoPersistente: false,
            online: true, cookies: true, contextoSeguro: true, indexedDB: true,
        };
        expect(Object.keys(completo)).toEqual([...cliente.CAMPOS_DE_AMBIENTE]);
        expect(Object.keys(cliente.ambienteSeguro(completo))).toEqual([...cliente.CAMPOS_DE_AMBIENTE]);
    });

    it('every family the parser can return is in the vocabulary the server accepts', () => {
        // The parser is client-only; the server trusts its output. This is the edge where a new
        // branch (a "brave" family, say) would be sent before the server knew it.
        const saidas = ['', 'curl/1', 'Firefox/1', 'Chrome/1', 'Edg/1', 'OPR/1', 'Version/1 Safari/1',
            'Windows NT 10.0', 'Mac OS X 10_15', 'Linux', 'CrOS x 1', 'Android 14', 'iPhone OS 17_4', 'iPad',
            'Mobile', 'Tablet'];
        for (const ua of saidas) {
            const r = cliente.analisarUserAgent(`Mozilla/5.0 (${ua}) ${ua}`);
            expect(servidor.FAMILIAS_DE_NAVEGADOR, ua).toContain(r.navegador);
            expect(servidor.FAMILIAS_DE_SO, ua).toContain(r.so);
            expect(servidor.TIPOS_DE_DISPOSITIVO, ua).toContain(r.dispositivo);
        }
    });
});
