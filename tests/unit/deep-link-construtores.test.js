// Path: tests/unit/deep-link-construtores.test.js

/**
 * @fileoverview OS CONSTRUTORES DE LINK: a volta do vetor dourado.
 *
 * `deep-link-gramatica.test.js` prende a LEITURA contra links escritos à mão. Este
 * prende a ESCRITA, e a asserção que importa é a de ida e volta: o que o app emite
 * tem que voltar pelo leitor como o mesmo descritor. Sem esse par, uma renomeação
 * de chave feita nos dois lados ao mesmo tempo passaria verde e quebraria todo link
 * já distribuído, que é exatamente o modo de falha que este par existe para pegar.
 *
 * A SEGUNDA PROPRIEDADE É A QUERY. Os construtores montavam a URL a partir de
 * origem e caminho, e a busca morria junto. Ela é onde os outros deep links deste
 * app moram, então o link dizia "esta vista, no padrão" quando a pessoa quis dizer
 * "esta vista, onde eu estou". Aqui isso vira asserção nos QUATRO construtores, e
 * não só no novo: o defeito era compartilhado.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const original = globalThis.window;

/** Instala o `window.location` mínimo que os construtores leem. */
function fingirEndereco({ search = '', pathname = '/', origin = 'https://ebgeo.exemplo', hash = '' } = {}) {
    globalThis.window = { location: { hash, search, pathname, origin } };
}

/** Reaponta o endereço para o link recém-construído, e o devolve pelo leitor. */
async function relerComoLink(url) {
    const { parseDeepLink } = await import('@js/deep-link/parse.js');
    const alvo = new URL(url);
    fingirEndereco({ origin: alvo.origin, pathname: alvo.pathname, search: alvo.search, hash: alvo.hash });
    return parseDeepLink();
}

beforeEach(() => fingirEndereco());
afterEach(() => { globalThis.window = original; });

const QUERY = '?atlas=11111111-1111-4111-8111-111111111111';

describe('construtores de link: ida e volta pelo leitor', () => {
    it('360', async () => {
        const { buildShareUrl360 } = await import('@js/deep-link/deep-link.js');
        const url = buildShareUrl360('PANO-0042.jpg', 123.45, -6.7, 75);

        expect(url).toBe('https://ebgeo.exemplo/#view=360&photo=PANO-0042.jpg&lon=123.45&lat=-6.70&fov=75.0');
        expect(await relerComoLink(url)).toEqual({
            type: '360', photo: 'PANO-0042.jpg', lon: 123.45, lat: -6.7, fov: 75,
        });
    });

    it('3D', async () => {
        const { buildShareUrl3D } = await import('@js/deep-link/deep-link.js');
        const url = buildShareUrl3D('hangar-01', -43.2, -22.9, 150, 1.5708, -0.5236, 0);

        expect(await relerComoLink(url)).toEqual({
            type: '3d', tileset: 'hangar-01', lon: -43.2, lat: -22.9,
            height: 150, heading: 1.5708, pitch: -0.5236, roll: 0,
        });
    });

    it('primeira pessoa', async () => {
        const { buildShareUrlFirstPerson } = await import('@js/deep-link/deep-link.js');
        const url = buildShareUrlFirstPerson('galpao', 1, 2.5, -3.25, 0.7854, -0.1);

        expect(await relerComoLink(url)).toEqual({
            type: 'fp', scene: 'galpao', x: 1, y: 2.5, z: -3.25, yaw: 0.7854, pitch: -0.1,
        });
    });

    it('camada base', async () => {
        const { buildShareUrlBasemap } = await import('@js/deep-link/deep-link.js');
        const url = buildShareUrlBasemap('bdgex', -43.18, -22.97, 14.5, 30, 45);

        expect(url).toBe(
            'https://ebgeo.exemplo/#view=base&base=bdgex&lon=-43.180000&lat=-22.970000&z=14.50&b=30.0&p=45.0',
        );
        expect(await relerComoLink(url)).toEqual({
            type: 'base', basemap: 'bdgex', lon: -43.18, lat: -22.97,
            zoom: 14.5, bearing: 30, pitch: 45,
        });
    });
});

describe('construtores de link: a query sobrevive', () => {
    it('os quatro construtores preservam a busca do endereço atual', async () => {
        fingirEndereco({ search: QUERY });
        const {
            buildShareUrl360, buildShareUrl3D, buildShareUrlFirstPerson, buildShareUrlBasemap,
        } = await import('@js/deep-link/deep-link.js');

        const links = [
            buildShareUrl360('p.jpg', 1, 2, 75),
            buildShareUrl3D('t', 1, 2, 3, 0, 0, 0),
            buildShareUrlFirstPerson('c', 1, 2, 3, 0, 0),
            buildShareUrlBasemap('osm', 1, 2, 10, 0, 0),
        ];

        for (const url of links) {
            expect(url).toContain(QUERY);
            // A busca fica ANTES do fragmento, senão ela vira parte do hash e o
            // leitor a encontraria como chave desconhecida em vez de query.
            expect(url.indexOf(QUERY)).toBeLessThan(url.indexOf('#'));
        }
    });

    it('o hash antigo é substituído, nunca acumulado', async () => {
        fingirEndereco({ hash: '#view=360&photo=antiga.jpg' });
        const { buildShareUrlBasemap } = await import('@js/deep-link/deep-link.js');

        const url = buildShareUrlBasemap('osm', 1, 2, 10, 0, 0);
        expect(url).not.toContain('antiga.jpg');
        expect(url.match(/#/g)).toHaveLength(1);
    });
});

describe('construtor de camada base: os valores que ninguém escolheu', () => {
    it('sem camada base, a chave fica AUSENTE em vez de vazia', async () => {
        const { buildShareUrlBasemap } = await import('@js/deep-link/deep-link.js');
        const url = buildShareUrlBasemap(null, -43.18, -22.97, 14.5, 0, 0);

        // `base=` com nada depois significaria a mesma coisa que a ausência, com
        // cara de valor. Um jeito só de dizer uma coisa só.
        expect(url).not.toContain('base=');
        expect(await relerComoLink(url)).toMatchObject({ type: 'base', basemap: null });
    });

    it('número não finito vira zero no texto, nunca a palavra NaN', async () => {
        const { buildShareUrlBasemap } = await import('@js/deep-link/deep-link.js');
        const url = buildShareUrlBasemap('osm', -43.18, -22.97, NaN, undefined, Infinity);

        expect(url).not.toContain('NaN');
        expect(url).toContain('z=0.00');
        expect(await relerComoLink(url)).toMatchObject({ zoom: 0, bearing: 0, pitch: 0 });
    });
});
