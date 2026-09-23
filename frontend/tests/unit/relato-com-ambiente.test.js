// Path: tests/unit/relato-com-ambiente.test.js

/**
 * @fileoverview THE ENVIRONMENT BLOCK ON THE WIRE: an error report built by the real capturer
 * carries the machine it happened on, cut to the closed shape, and a broken collector never costs
 * the report.
 *
 * NEGATIVE CONTROLS (checked by reverting): removing the `ambienteSeguro` around the collector in
 * `erro-telemetria.js` lets the injected extra key through (the route would refuse the whole
 * report); removing the `try` around it makes the throwing collector cost the report.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { instalarTelemetriaDeErro, relatarErro } from '@js/session/erro-telemetria.js';

const SESSAO = '5b1c1a7e-1f2b-4c3d-8e9f-0a1b2c3d4e5f';
let desinstalar = null;

afterEach(() => {
    desinstalar?.();
    desinstalar = null;
});

/** A window with a Firefox navigator and no WebGL, and a transport that keeps the bodies. */
function instalar({ coletorDeAmbiente } = {}) {
    const enviados = [];
    const alvo = {
        location: { href: 'http://local/admin.html', pathname: '/admin.html' },
        navigator: {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
            language: 'pt-BR',
            hardwareConcurrency: 4,
        },
        screen: { width: 1366, height: 768 },
        addEventListener() {},
        removeEventListener() {},
    };
    const r = instalarTelemetriaDeErro({
        alvo,
        enviar: (corpo) => { enviados.push(corpo); },
        resolverAtlasId: () => null,
        resolverBase: () => '/api/v1',
        resolverSessaoId: () => SESSAO,
        fila: { enfileirar: () => false, drenar: () => [] },
        ...(coletorDeAmbiente ? { coletorDeAmbiente } : {}),
    });
    desinstalar = r.desinstalar;
    return enviados;
}

describe('the error report carries the machine', () => {
    it('the default collector reads the window the capturer was installed on', () => {
        const enviados = instalar();
        expect(relatarErro(new Error('quebrou no Firefox'))).toBe(true);
        expect(enviados).toHaveLength(1);
        expect(enviados[0].ambiente).toEqual({
            navegador: 'firefox',
            navegadorVersao: '143.0',
            so: 'windows',
            soVersao: '10.0',
            dispositivo: 'desktop',
            telaLargura: 1366,
            telaAltura: 768,
            idioma: 'pt-BR',
            nucleos: 4,
            indexedDB: false,
        });
        // The raw UA still travels beside it, as before: it is what the `title` shows.
        expect(enviados[0].userAgent).toContain('Firefox/143.0');
    });

    it('whatever the collector returns is cut to the closed shape before it travels', () => {
        const enviados = instalar({
            coletorDeAmbiente: {
                iniciar() {},
                coletar: () => ({ navegador: 'chrome', modelo: 'Pixel 7', so: 'Windows 11' }),
            },
        });
        relatarErro(new Error('chave a mais'));
        expect(enviados[0].ambiente).toEqual({ navegador: 'chrome' });
    });

    it('a collector that throws, at install or at capture, never costs the report', () => {
        const enviados = instalar({
            coletorDeAmbiente: {
                iniciar() { throw new Error('iniciar'); },
                coletar() { throw new Error('coletar'); },
            },
        });
        expect(relatarErro(new Error('o relato sai mesmo assim'))).toBe(true);
        expect(enviados).toHaveLength(1);
        expect(Object.hasOwn(enviados[0], 'ambiente')).toBe(false);
        expect(enviados[0].mensagem).toContain('o relato sai mesmo assim');
    });
});
