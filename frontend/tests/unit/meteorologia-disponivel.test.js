// Path: tests/unit/meteorologia-disponivel.test.js

/**
 * @fileoverview Whether the context menu offers the weather panel
 * (`utilities/meteorologia/carregador.js`).
 *
 * The flag ships ON (owner, 2026-09-23), and the source root decides the rest. The env path has no
 * schema check, so the gate checks the root itself: a root without a scheme would make `fetch`
 * resolve against the app's OWN origin and put the coordinate in our own proxy's access log.
 */

import { describe, it, expect } from 'vitest';
import { meteorologiaDisponivel, raizDaFonteValida } from '../../src/js/utilities/meteorologia/carregador.js';

const ligado = (raiz) => ({ features: { meteorologia: true }, services: { meteorologiaUrl: raiz } });

describe('meteorologiaDisponivel', () => {
    it('ligado com raiz http(s) completa: oferece', () => {
        expect(meteorologiaDisponivel(ligado('https://api.open-meteo.com'))).toBe(true);
        expect(meteorologiaDisponivel(ligado('http://open-meteo.intranet:8080/'))).toBe(true);
    });

    it('desligado, ou sem a bandeira: não oferece', () => {
        expect(meteorologiaDisponivel({ features: { meteorologia: false }, services: { meteorologiaUrl: 'https://api.open-meteo.com' } })).toBe(false);
        expect(meteorologiaDisponivel({ features: {}, services: { meteorologiaUrl: 'https://api.open-meteo.com' } })).toBe(false);
        expect(meteorologiaDisponivel(null)).toBe(false);
    });

    it('raiz vazia, sem esquema ou de outro esquema: não oferece', () => {
        for (const raiz of ['', '   ', 'api.open-meteo.com', '/api/meteo', 'ftp://x.test', 'javascript:alert(1)', undefined, 42]) {
            expect(raizDaFonteValida(raiz), String(raiz)).toBe(false);
            expect(meteorologiaDisponivel(ligado(raiz)), String(raiz)).toBe(false);
        }
    });
});
