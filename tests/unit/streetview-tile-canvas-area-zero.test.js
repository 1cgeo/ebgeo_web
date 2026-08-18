// Path: tests/unit/streetview-tile-canvas-area-zero.test.js
/**
 * @fileoverview O tamanho do canvas de textura quando a TELA NAO TEM AREA.
 *
 * O DEFEITO QUE ESTE ARQUIVO MATA. Em `larguraDoCanvas` a guarda de area zero
 * devolvia o TETO, que e `min(largura do nivel, maxTextura)`, ou seja o pior
 * caso. Painel recolhido, aba trocada ou container de altura zero levavam o
 * canvas ao nivel nativo: 7680x3840, 118 MB de textura reconstruidos para quem
 * nao esta vendo nada. `nivelDesejado` ja tratava o MESMO estado ao contrario,
 * segurando o nivel em uso, entao as duas contas discordavam e mandava a errada.
 *
 * AQUI O GATILHO E DIRETO, e nao teorico: `street_view_viewer.js` chama
 * `setSize` no resize sem piso nenhum, entao o container em altura zero chega
 * inteiro ate esta conta.
 *
 * O teste mede pela LARGURA REAL do canvas que o carregador criou, e nao por uma
 * copia da formula: copia da conta mediria a copia. A asercao aponta um numero,
 * porque intervalo aceitaria a conta errada junto com a certa.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { montarEscada } from '@js/street_view_tool/pyramid-math.js';

// O three de mentira entra no lugar do modulo vendorizado de 1,3 MB. Ele nao
// muda a conta sob teste, e evita carregar uma biblioteca de WebGL inteira num
// ambiente `node`, sem `document` e sem contexto grafico.
vi.mock('../../src/vendor/three/three.module.js', () => ({
    SRGBColorSpace: 'srgb',
    LinearFilter: 1006,
    CanvasTexture: class {
        constructor(imagem) {
            this.image = imagem;
            this.needsUpdate = false;
        }

        dispose() {
            this.descartada = true;
        }
    }
}));

/** Lado do tile em toda a piramide do acervo. */
const TILE = 512;

/** Camera do monitor MEDIDO no piloto: 1904x985 pede 6119 px de panoramica. */
const MONITOR = { lon: 0, lat: 0, fov: 75, largura: 1904, altura: 985 };

/**
 * Um canvas de mentira que guarda largura e altura. E o unico observavel do
 * teste: o carregador escreve `canvas.width` e o entrega dentro da textura.
 * @returns {Object}
 */
function canvasFalso() {
    return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage() {} })
    };
}

/**
 * Um descritor `tiles.json` valido, na escada real do formato pedido.
 * @param {number} largura - Largura nativa em pixels.
 * @param {number} altura - Altura nativa em pixels.
 * @param {number} razao - A razao daquele formato: 1,6 em 7680, 2 no resto.
 * @returns {Object}
 */
function descritorDe(largura, altura, razao) {
    return {
        schemaVersion: 1,
        tileSize: TILE,
        base: 'preview.webp',
        template: '{level}/{x}/{y}.webp',
        levels: montarEscada(largura, altura, TILE, razao)
    };
}

/**
 * Instala o ambiente de navegador que o carregador exige. O `fetch` responde o
 * descritor pedido, e qualquer outra coisa vira um corpo curto, que o
 * `createImageBitmap` de mentira transforma num tile qualquer.
 * @param {Object} descritor
 * @returns {void}
 */
function instalarNavegador(descritor) {
    const corpoDescritor = new TextEncoder().encode(JSON.stringify(descritor)).buffer;
    const resposta = (corpo) => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        async arrayBuffer() { return corpo; }
    });

    vi.stubGlobal('document', { createElement: () => canvasFalso() });
    vi.stubGlobal('location', { href: 'http://teste.local/', origin: 'http://teste.local' });
    vi.stubGlobal('fetch', async (url) => (
        String(url).endsWith('tiles.json')
            ? resposta(corpoDescritor)
            : resposta(new ArrayBuffer(64))
    ));
    vi.stubGlobal('createImageBitmap', async () => ({
        width: TILE,
        height: TILE,
        close() {}
    }));
}

/**
 * Cria um carregador ja apontado para uma base absoluta de mentira.
 * @returns {Promise<Object>} A API do carregador.
 */
async function novoCarregador() {
    const { createTileLoader } = await import('@js/street_view_tool/tile-loader.js');
    return createTileLoader({ gl: null, base: 'http://teste.local/api/v1' });
}

describe('largura do canvas com a tela sem area', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('SEGURA o canvas em uso, em vez de ir ao nativo', async () => {
        // O formato pesado do acervo: 22 mil fotos de 7680x3840, razao 1,6.
        const descritor = descritorDe(7680, 3840, 1.6);
        const nativo = descritor.levels[descritor.levels.length - 1].width;
        instalarNavegador(descritor);
        const carregador = await novoCarregador();

        try {
            carregador.atualizarCamera(MONITOR);
            await carregador.carregarFoto('foto-1');

            // 6119 px quantizados para cima em passos de 1024 dao 6144, e o
            // nativo de 7680 fica de fora: e a conta que consertou o travamento.
            const texturaAntes = carregador.getTextura();
            expect(texturaAntes.image.width).toBe(6144);

            // O painel recolhe, ou a aba troca. `fixarNivel(null)` nao muda
            // estado nenhum (o nivel ja e automatico), e serve so para disparar
            // `reavaliar` na hora, sem esperar o debounce de 120 ms.
            carregador.atualizarCamera({ largura: 0, altura: 0 });
            carregador.fixarNivel(null);

            const depois = carregador.getTextura();
            expect(depois.image.width).not.toBe(nativo);
            expect(depois.image.width).toBe(6144);
            // Mesma textura, ou seja o canvas nem chegou a ser refeito. A versao
            // antiga trocava o objeto aqui, porque 7680 diferia de 6144.
            expect(depois).toBe(texturaAntes);
        } finally {
            carregador.dispose();
        }
    });

    it('sem canvas ainda, pega o menor degrau e nao o teto', async () => {
        // Primeira foto com o container ja recolhido: nao ha canvas para segurar.
        const descritor = descritorDe(5760, 2880, 2);
        instalarNavegador(descritor);
        const carregador = await novoCarregador();

        try {
            carregador.atualizarCamera({ lon: 0, lat: 0, fov: 75, largura: 0, altura: 0 });
            await carregador.carregarFoto('foto-2');

            // O nivel escolhido e o 0, o mais grosso, porque `nivelDesejado` ja
            // segurava esse caso. A largura antiga era o TETO desse nivel, 1440.
            expect(carregador.getEstatisticas().nivel).toBe(0);
            expect(descritor.levels[0].width).toBe(1440);
            expect(carregador.getTextura().image.width).toBe(1024);
        } finally {
            carregador.dispose();
        }
    });

    it('com area, o canvas continua quantizado em passos de 1024', async () => {
        // Guarda de regressao: o conserto so pode tocar no ramo de area zero.
        const descritor = descritorDe(7680, 3840, 1.6);
        instalarNavegador(descritor);
        const carregador = await novoCarregador();

        try {
            // O notebook do piloto, 1350x673, pede 4264 px. O degrau sobe para
            // 5120, e o TETO do nivel escolhido, o de 4800, e quem corta: canvas
            // nunca passa do nivel que o enche, senao o tile sairia esticado.
            carregador.atualizarCamera({ lon: 0, lat: 0, fov: 75, largura: 1350, altura: 673 });
            await carregador.carregarFoto('foto-3');

            expect(carregador.getEstatisticas().nivel).toBe(2);
            expect(descritor.levels[2].width).toBe(4800);
            expect(carregador.getTextura().image.width).toBe(4800);
        } finally {
            carregador.dispose();
        }
    });
});
