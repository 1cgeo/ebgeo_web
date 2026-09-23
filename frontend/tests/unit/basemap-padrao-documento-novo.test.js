// Path: tests/unit/basemap-padrao-documento-novo.test.js

/**
 * @fileoverview O DOCUMENTO DE MAPA NOVO NASCE COM A BASE PADRÃO QUE O ADMINISTRADOR ESCOLHEU.
 *
 * O mapa abre na base que o documento dele carrega (a primeira pintura lê `baseLayer`, ver
 * `switchMap`), então escolher a base de NASCIMENTO do mapa e deixar o documento novo em
 * `carta-topografica` faria a escolha valer por um instante e sumir na primeira pintura. As portas
 * que fabricam documento do nada leem `getEmptyMapData()` (`store/repository.utils.js`): o mapa em
 * branco da primeira visita (`seedBlankDefaultMap`), o mapa criado na aba Mapas (`mintMapDocument`),
 * a base que "limpar vista salva" devolve (`birthBaseLayer`) e o `.ebgeo` sem mapa nenhum. O
 * primeiro mapa de um atlas criado NO SERVIDOR é do backend
 * (`backend/tests/integration/config-mapa-base-inicial.test.js`).
 *
 * E O PISO DO CLIENTE É O PADRÃO DO SERVIDOR: `FACTORY_DEFAULT_BASEMAP` (usado quando `config` não
 * traz a chave) e `MAP2D_BASE.defaultBasemap` são duas cópias do mesmo fato, e o último caso as
 * prende juntas.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import config from '../../src/js/config.js';
import { initConfigHelpers } from '../../src/js/config.helpers.js';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';
import { mintMapDocument } from '../../src/js/store/repositories/index.js';
import { FACTORY_DEFAULT_BASEMAP, defaultBasemap } from '../../src/js/baselayers/default-basemap.js';
import { MAP2D_BASE } from '../../../backend/src/modules/config/config.static.js';

initConfigHelpers();
const original = { basemaps: config.basemaps, map2d: config.map2d };

beforeEach(() => {
    config.basemaps = {
        'carta-topografica': { enabled: true, priority: 1 },
        osm: { enabled: true, priority: 4 },
        imagens: { enabled: true, priority: 5 },
    };
    config.map2d = { ...original.map2d };
});

afterEach(() => {
    config.basemaps = original.basemaps;
    config.map2d = original.map2d;
});

describe('o documento vazio carrega a base configurada', () => {
    it('sem a chave servida, o documento nasce como antes', () => {
        delete config.map2d.defaultBasemap;
        expect(getEmptyMapData().baseLayer).toBe('carta-topografica');
    });

    it('com a escolha do administrador, o documento nasce com ela', () => {
        config.map2d.defaultBasemap = 'imagens';
        expect(getEmptyMapData().baseLayer).toBe('imagens');
    });

    it('lida a cada documento, nunca guardada no carregamento do módulo', () => {
        config.map2d.defaultBasemap = 'imagens';
        expect(getEmptyMapData().baseLayer).toBe('imagens');
        config.map2d.defaultBasemap = 'osm';
        expect(getEmptyMapData().baseLayer).toBe('osm');
    });

    it('a escolha vazia ou de tipo errado vale o piso, nunca um documento sem base', () => {
        // O servidor recusa as duas formas em 422; esta é a rede para o documento que chegar
        // mesmo assim (um `/api/config` de outra versão, um override gravado à mão no banco).
        for (const ruim of ['', '   ', null, 42, {}]) {
            config.map2d.defaultBasemap = ruim;
            expect(getEmptyMapData().baseLayer).toBe('carta-topografica');
        }
    });
});

describe('o mapa novo da aba Mapas', () => {
    it('nasce com a base configurada quando o catálogo a oferece', () => {
        config.map2d.defaultBasemap = 'imagens';
        expect(mintMapDocument('Novo mapa').document.baseLayer).toBe('imagens');
    });

    it('e com o primeiro oferecido quando não oferece, como sempre fez com a constante', () => {
        // A resolução contra o catálogo é de `mintMapDocument` (anterior a esta mudança), e ela
        // continua valendo para a base configurada: o CREATE nunca referencia um id que este
        // visitante não pode oferecer.
        config.map2d.defaultBasemap = 'acervo-privado';
        expect(mintMapDocument('Novo mapa').document.baseLayer).toBe('carta-topografica');
    });
});

describe('o piso do cliente e o padrão do servidor são o mesmo fato', () => {
    it('`FACTORY_DEFAULT_BASEMAP` é `MAP2D_BASE.defaultBasemap`', () => {
        expect(MAP2D_BASE.defaultBasemap).toBe('carta-topografica');
        expect(FACTORY_DEFAULT_BASEMAP).toBe(MAP2D_BASE.defaultBasemap);
        delete config.map2d.defaultBasemap;
        expect(defaultBasemap()).toBe(MAP2D_BASE.defaultBasemap);
    });
});
