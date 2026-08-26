// Path: tests/unit/deep-link-gramatica.test.js

/**
 * @fileoverview A GRAMÁTICA DO LINK COMPARTILHADO, presa por vetor dourado.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Um link copiado do app vai parar num chat, num
 * e-mail, num relatório, e volta a ser aberto meses depois, por outra versão do
 * app. Isso faz da gramática um contrato congelado, e contrato que nada verifica é
 * intenção. Os vetores abaixo são ESCRITOS À MÃO de propósito: gerá-los pelo mesmo
 * construtor que eles deveriam vigiar seria o teste conferindo o código contra ele
 * mesmo, e passaria verde depois de qualquer renomeação de chave.
 *
 * O par deste arquivo precisa existir no branch `integracao_backend` com OS MESMOS
 * vetores. É a única forma de a promessa "o link abre nas duas versões" ser
 * verificada em vez de afirmada.
 *
 * O que ele NÃO alcança: que o recurso nomeado pelo link exista do outro lado. Um
 * id de tileset que mudou de espaço entre as versões passa por esta gramática
 * intacto e falha depois, na busca. Isso é medida contra o acervo, não teste.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/** Instala um `window.location` mínimo, que é tudo que o leitor e os construtores tocam. */
function fingirEndereco({ hash = '', search = '', pathname = '/', origin = 'https://ebgeo.exemplo' } = {}) {
    globalThis.window = { location: { hash, search, pathname, origin } };
}

const original = globalThis.window;
beforeEach(() => fingirEndereco());
afterEach(() => { globalThis.window = original; });

// Carregado dinamicamente DENTRO dos casos porque o módulo lê `window` no corpo das
// funções, não na importação; um import estático no topo ainda assim amarraria a
// ordem de avaliação ao `beforeEach`, e essa é a classe de acoplamento que faz um
// teste passar sozinho e falhar em suíte.
const lerGramatica = () => import('@js/deep-link/parse.js');

describe('gramática do deep link: vetores dourados', () => {
    it('lê um link 360 escrito à mão', async () => {
        fingirEndereco({ hash: '#view=360&photo=PANO-0042.jpg&lon=123.45&lat=-6.70&fov=75.0' });
        const { parseDeepLink } = await lerGramatica();

        expect(parseDeepLink()).toEqual({
            type: '360', photo: 'PANO-0042.jpg', lon: 123.45, lat: -6.7, fov: 75,
        });
    });

    it('lê um link 3D escrito à mão', async () => {
        fingirEndereco({
            hash: '#view=3d&tileset=hangar-01&lon=-43.200000&lat=-22.900000'
                + '&h=150.0&heading=1.5708&pitch=-0.5236&roll=0.0000',
        });
        const { parseDeepLink } = await lerGramatica();

        expect(parseDeepLink()).toEqual({
            type: '3d', tileset: 'hangar-01', lon: -43.2, lat: -22.9,
            height: 150, heading: 1.5708, pitch: -0.5236, roll: 0,
        });
    });

    it('lê um link de primeira pessoa escrito à mão', async () => {
        fingirEndereco({ hash: '#view=fp&scene=galpao&x=1.00&y=2.50&z=-3.25&yaw=0.7854&pitch=-0.1000' });
        const { parseDeepLink } = await lerGramatica();

        expect(parseDeepLink()).toEqual({
            type: 'fp', scene: 'galpao', x: 1, y: 2.5, z: -3.25, yaw: 0.7854, pitch: -0.1,
        });
    });

    it('lê um link de camada base escrito à mão', async () => {
        fingirEndereco({ hash: '#view=base&base=bdgex&lon=-43.180000&lat=-22.970000&z=14.50&b=30.0&p=45.0' });
        const { parseDeepLink } = await lerGramatica();

        expect(parseDeepLink()).toEqual({
            type: 'base', basemap: 'bdgex', lon: -43.18, lat: -22.97,
            zoom: 14.5, bearing: 30, pitch: 45,
        });
    });

    it('ignora chave desconhecida, que é o que deixa versão velha abrir link novo', async () => {
        fingirEndereco({ hash: '#view=base&base=osm&lon=-43.18&lat=-22.97&z=14.5&inventadaEmVersaoFutura=7' });
        const { parseDeepLink } = await lerGramatica();

        expect(parseDeepLink()).toMatchObject({ type: 'base', basemap: 'osm', zoom: 14.5 });
    });
});

describe('gramática do deep link: o que ela recusa', () => {
    it('recusa hash sem view, e recusa view que não conhece', async () => {
        const { parseDeepLink } = await lerGramatica();

        fingirEndereco({ hash: '#foo=bar' });
        expect(parseDeepLink()).toBeNull();

        fingirEndereco({ hash: '#view=holograma&base=osm' });
        expect(parseDeepLink()).toBeNull();
    });

    it('recusa link de camada base que não pede nada', async () => {
        fingirEndereco({ hash: '#view=base' });
        const { parseDeepLink } = await lerGramatica();

        // Descritor não nulo faria o chamador limpar o hash: o link sumiria da barra
        // de endereços sem ter feito nada, que é como o app engolir o link em silêncio.
        expect(parseDeepLink()).toBeNull();
    });

    it('recusa meia coordenada em vez de inventar a outra', async () => {
        fingirEndereco({ hash: '#view=base&lon=-43.18' });
        const { parseDeepLink } = await lerGramatica();

        expect(parseDeepLink()).toBeNull();
    });

    it('trata número ilegível como ausente, nunca como zero', async () => {
        fingirEndereco({ hash: '#view=base&base=osm&lon=-43.18&lat=-22.97&z=muito&b=&p=12abc' });
        const { parseDeepLink } = await lerGramatica();

        // Zero é uma posição real: um `Number("")` que virasse 0 apontaria a câmera
        // para o norte e para o horizonte sem ninguém ter pedido.
        expect(parseDeepLink()).toEqual({
            type: 'base', basemap: 'osm', lon: -43.18, lat: -22.97,
            zoom: null, bearing: null, pitch: null,
        });
    });

    it('aceita camada base sem câmera, e câmera sem camada base', async () => {
        const { parseDeepLink } = await lerGramatica();

        fingirEndereco({ hash: '#view=base&base=imagens' });
        expect(parseDeepLink()).toMatchObject({ type: 'base', basemap: 'imagens', lon: null, lat: null });

        fingirEndereco({ hash: '#view=base&lon=-43.18&lat=-22.97' });
        expect(parseDeepLink()).toMatchObject({ type: 'base', basemap: null, lon: -43.18, lat: -22.97 });
    });
});
