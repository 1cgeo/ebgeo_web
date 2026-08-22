/**
 * O catálogo depois que o preflight preenche o config.
 *
 * O `models-api.service.js` já tem teste próprio, e ele prova que
 * `config.tilesets` e `config.firstPerson3d.scenes` ficam preenchidos. O que
 * faltava era o outro lado: o `CatalogService` lendo esses arrays e produzindo
 * os cartões. Entre um e outro cabe um contrato inteiro, e ele vive em dois
 * arquivos que não se conhecem.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import config from '../../src/js/config.js';
import { CatalogService } from '../../src/js/catalog/catalog.service.js';
import { CATALOG_ITEM_TYPES } from '../../src/js/catalog/catalog.constants.js';
import { initConfigHelpers } from '../../src/js/config.helpers.js';

// O `_getTilesets3D` chama `config.hasTilesets()`, que NAO nasce no config: o
// `index.js` a pendura ali na partida, por `initConfigHelpers`. Sem esta linha
// o teste estoura com "hasTilesets is not a function", acusando o catálogo por
// uma etapa de inicialização que ele não faz.
initConfigHelpers();

const BASE = 'http://servico/api/v1';

/** `config.tilesets` como o preflight o deixa. */
const TILESET_DO_SERVICO = {
    url: `${BASE}/models/ponte-quatis/tileset.json`,
    id: 'ponte-quatis',
    name: 'Ponte General Osorio (Quatis)',
    type: '3dtiles',
    heightOffset: 0,
    description: 'Ponte sobre o rio Paraiba do Sul',
    local: 'Quatis, RJ',
    keywords: ['ponte'],
    locate: { lon: -44.286984, lat: -22.400374, height: 843.2 },
};

/** `config.firstPerson3d.scenes` como o preflight a deixa. */
const CENA_DO_SERVICO = {
    id: 'museu-1cgeo',
    name: 'Sala Historica General Malan',
    basePath: `${BASE}/scenes/museu-1cgeo`,
    description: 'Acervo do 1o CGEO',
    local: 'Porto Alegre, RS',
    data_captura: '04/08/2026',
    keywords: ['museu'],
    locate: { lon: -51.2, lat: -30.03 },
};

let original;

beforeEach(() => {
    original = {
        tilesets: config.tilesets,
        firstPerson3d: config.firstPerson3d,
        features: { ...config.features },
    };
    // O preflight do 360 falha nesta máquina, e a feature cai. O catálogo tem de
    // sobreviver a isso, senão o 3D some junto com o 360.
    config.features.imagens_panoramicas = false;
});

afterEach(() => {
    config.tilesets = original.tilesets;
    config.firstPerson3d = original.firstPerson3d;
    Object.assign(config.features, original.features);
    vi.restoreAllMocks();
});

describe('catálogo com o config preenchido pelo preflight', () => {
    it('mostra o modelo 3D que veio do serviço', async () => {
        config.tilesets = [{ ...TILESET_DO_SERVICO }];
        config.firstPerson3d = { enabled: true, scenes: [] };

        const itens = await CatalogService.getAllItems();
        const modelo = itens.find(i => i.id === '3d-ponte-quatis');

        expect(modelo, `catálogo veio com ${itens.length} itens: ${itens.map(i => i.id).join(', ')}`)
            .toBeDefined();
        expect(modelo.type).toBe(CATALOG_ITEM_TYPES.MODEL_3D);
        expect(modelo.viewer).toBe('cesium');
        expect(modelo.name).toBe('Ponte General Osorio (Quatis)');
        expect(modelo.location).toEqual(TILESET_DO_SERVICO.locate);
    });

    it('mostra a cena navegável que veio do serviço', async () => {
        config.tilesets = [];
        config.firstPerson3d = { enabled: true, scenes: [{ ...CENA_DO_SERVICO }] };

        const itens = await CatalogService.getAllItems();
        const cena = itens.find(i => i.id === 'fp-museu-1cgeo');

        expect(cena, `catálogo veio com ${itens.length} itens: ${itens.map(i => i.id).join(', ')}`)
            .toBeDefined();
        expect(cena.viewer).toBe('firstPerson');
        // A miniatura DERIVA do basePath, e o basePath aponta o serviço.
        expect(cena.thumbnail).toContain(BASE);
    });

    it('o modelo SEM data e SEM miniatura nao derruba o catalogo', async () => {
        // NENHUM modelo importado hoje tem `data_captura` nem prévia: os campos
        // vêm nulos do serviço. Um catálogo que exigisse qualquer um dos dois
        // ficaria vazio sem erro no console, e foi por isso que este teste
        // existe.
        config.tilesets = [{
            url: `${BASE}/models/silo/tileset.json`,
            id: 'silo',
            name: 'Silo',
            type: '3dtiles',
            heightOffset: 0,
        }];
        config.firstPerson3d = { enabled: true, scenes: [] };

        const itens = await CatalogService.getAllItems();
        const silo = itens.find(i => i.id === '3d-silo');
        expect(silo).toBeDefined();
        expect(silo.date).toBeNull();
        expect(silo.thumbnail).toBeTruthy();
    });

    it('os dois convivem, e o 3dtiles nao apaga a cena', async () => {
        config.tilesets = [{ ...TILESET_DO_SERVICO }];
        config.firstPerson3d = { enabled: true, scenes: [{ ...CENA_DO_SERVICO }] };

        const itens = await CatalogService.getAllItems();
        const tresD = itens.filter(i => i.type === CATALOG_ITEM_TYPES.MODEL_3D);
        expect(tresD.map(i => i.id).sort()).toEqual(['3d-ponte-quatis', 'fp-museu-1cgeo']);
    });

    it('config vazio nao estoura, so nao traz item 3D', async () => {
        config.tilesets = [];
        config.firstPerson3d = { enabled: true, scenes: [] };

        const itens = await CatalogService.getAllItems();
        expect(itens.filter(i => i.type === CATALOG_ITEM_TYPES.MODEL_3D)).toHaveLength(0);
    });
});
