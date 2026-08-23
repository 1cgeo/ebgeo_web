// Path: tests/unit/streetview-piramide-escopo-de-atlas.test.js
/**
 * @fileoverview A LEITURA DA PIRAMIDE CARREGA O ATLAS EM FOCO.
 *
 * O DEFEITO QUE ESTE ARQUIVO MATA. O servidor honra `?atlasId=` em TODA leitura do
 * modulo 360 (`liftOptionalAtlasId` -> `requireAtlasScopeWhenPresent`), e sem ele um
 * projeto PRIVADO emprestado por um atlas responde 404. O cliente carimbava o escopo
 * nos tiles MVT do mapa 2D e, depois, nas quatorze leituras de
 * `streetview-api.service.js` — mas nao no carregador da PIRAMIDE, que monta as
 * proprias URLs. Consequencia: o ponto aparecia no mapa 2D, a foto abria, e a
 * panoramica nao pintava, com a mesma cara de "este projeto nao tem piramide".
 *
 * A ARMADILHA QUE ESTE TESTE PRENDE, e ela nao e obvia: o `template` do descritor e
 * RELATIVO ao proprio `tiles.json`, e `new URL(rel, base)` DESCARTA a query da base.
 * Carimbar so o `tiles.json` produz um descritor que chega e uma grade inteira de 404
 * logo atras — pior que nao carimbar nada, porque a foto anuncia niveis que ela nao
 * consegue baixar. Por isso o caso positivo mede TODA URL, e nao a primeira.
 *
 * O CONTROLE NEGATIVO E METADE DO ARQUIVO: sem atlas em foco (visitante anonimo, mapa
 * local, estudio de calibracao) a URL tem de sair identica a de hoje, caractere por
 * caractere. Um `atlasId=` vazio nao seria ruido: o servidor valida o campo como GUID,
 * entao ele derruba a leitura com 422 justamente para quem nunca teve atlas.
 *
 * O INSTRUMENTO E O SUJEITO COMPARTILHAM A INSTANCIA, e isso e deliberado: o registro
 * de escopo e estado de MODULO, entao o teste importa `resource-scope.js` DEPOIS do
 * `resetModules()` e no mesmo registro em que importa o carregador. Importar antes
 * mediria outra copia do modulo, e o carimbo pareceria nao acontecer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { montarEscada } from '@js/street_view_tool/pyramid-math.js';

vi.mock('../../src/vendor/three/three.module.js', () => ({
    SRGBColorSpace: 'srgb',
    // Os dois valores reais do three: a costura da equirretangular repete em S
    // e o polo continua grampeado em T. Ver o conserto em `reconstruirCanvas`.
    RepeatWrapping: 1000,
    ClampToEdgeWrapping: 1001,
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

/** Lado do tile na piramide do acervo. */
const TILE = 512;

/** O atlas que EMPRESTA o projeto privado. Um GUID, porque o servidor valida como tal. */
const ATLAS = '3f2b9c11-7a4d-4e5f-8b0c-1d2e3f4a5b6c';

/** Camera de monitor: pede o nivel nativo, entao o lote de tiles nao fica vazio. */
const MONITOR = { lon: 0, lat: 0, fov: 75, largura: 1904, altura: 985 };

/**
 * O descritor que ESTE servidor emite: `template` relativo ao `tiles.json`, com o
 * prefixo `tiles/`, sem extensao e com o token de geracao na query.
 * @returns {Object}
 */
function descritor() {
    return {
        schemaVersion: 1,
        tileSize: TILE,
        base: 'image?quality=preview',
        template: 'tiles/{level}/{x}/{y}?v=4242',
        levels: montarEscada(1024, 512, TILE, 2)
    };
}

/**
 * Instala o ambiente de navegador e devolve a lista viva de URLs pedidas.
 * @returns {string[]} as URLs, na ordem em que o carregador as pediu
 */
function instalarNavegador() {
    const pedidas = [];
    const corpoDescritor = new TextEncoder().encode(JSON.stringify(descritor())).buffer;
    const resposta = (corpo) => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        async arrayBuffer() { return corpo; }
    });

    vi.stubGlobal('document', {
        createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) })
    });
    vi.stubGlobal('location', { href: 'http://teste.local/', origin: 'http://teste.local' });
    vi.stubGlobal('fetch', async (url) => {
        const endereco = String(url);
        pedidas.push(endereco);
        return endereco.includes('tiles.json')
            ? resposta(corpoDescritor)
            : resposta(new ArrayBuffer(64));
    });
    vi.stubGlobal('createImageBitmap', async () => ({ width: TILE, height: TILE, close() {} }));
    return pedidas;
}

/**
 * Carrega uma foto com o escopo pedido e devolve as URLs que sairam.
 *
 * O `import()` dos DOIS modulos acontece aqui, depois do `resetModules`, para que o
 * registro de escopo que o teste escreve seja o MESMO que o carregador le.
 * @param {string|null} atlasId - o atlas em foco, ou null
 * @returns {Promise<string[]>}
 */
async function urlsDeUmaFoto(atlasId) {
    const pedidas = instalarNavegador();
    const escopo = await import('@store/sync/resource-scope.js');
    if (atlasId) escopo.setResourceScope(escopo.resourceScopeKey('u-1', atlasId));
    else escopo.resetResourceScope();

    const { createTileLoader } = await import('@js/street_view_tool/tile-loader.js');
    const carregador = createTileLoader({ gl: null, base: 'http://teste.local/api/v1/sv360' });
    try {
        carregador.atualizarCamera(MONITOR);
        await carregador.carregarFoto('foto-emprestada');
        return pedidas;
    } finally {
        carregador.dispose();
    }
}

describe('escopo de atlas na leitura da piramide 360', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('SEM atlas em foco a URL sai limpa, caractere por caractere', async () => {
        const pedidas = await urlsDeUmaFoto(null);

        expect(pedidas.length).toBeGreaterThan(1);
        expect(pedidas[0]).toBe('http://teste.local/api/v1/sv360/photos/foto-emprestada/tiles.json');
        for (const u of pedidas) {
            expect(u).not.toContain('atlasId');
        }
    });

    it('COM atlas em foco, o descritor E todo tile levam o mesmo atlasId', async () => {
        const pedidas = await urlsDeUmaFoto(ATLAS);

        // O descritor. Sem ele o 404 chega antes de qualquer tile.
        expect(pedidas[0]).toContain(`atlasId=${ATLAS}`);

        // OS TILES SAO O PONTO. `new URL(template, urlDoDescritor)` descarta a query
        // da base, entao carimbar so o descritor deixaria estes sem escopo.
        const tiles = pedidas.filter((u) => u.includes('/tiles/'));
        expect(tiles.length).toBeGreaterThan(0);
        for (const u of tiles) {
            expect(u).toContain(`atlasId=${ATLAS}`);
            // O token de geracao do descritor tem de sobreviver ao carimbo: ele e o
            // que quebra o cache imutavel do tile numa regeracao.
            expect(u).toContain('v=4242');
        }

        // UMA VEZ SO. Dois `atlasId` na mesma URL nao dao erro em lugar nenhum (o
        // Express fica com o ultimo, o Joi aceita), que e exatamente o tipo de
        // desacordo silencioso que sai mais barato tornar impossivel.
        for (const u of pedidas) {
            expect(u.match(/atlasId=/g)?.length ?? 0).toBeLessThanOrEqual(1);
        }
    });

    it('e o caminho da rota nao muda com o carimbo: o tile continua em /tiles/:level/:x/:y', async () => {
        const pedidas = await urlsDeUmaFoto(ATLAS);
        const tiles = pedidas.filter((u) => u.includes('/tiles/'));
        expect(tiles.length).toBeGreaterThan(0);
        for (const u of tiles) {
            // Discriminante contra um template com extensao (o da origem era
            // `{level}/{x}/{y}.webp`) e contra um prefixo perdido na resolucao.
            expect(u).toMatch(
                /^http:\/\/teste\.local\/api\/v1\/sv360\/photos\/foto-emprestada\/tiles\/\d+\/\d+\/\d+\?/
            );
            expect(u).not.toContain('.webp');
        }
    });
});
