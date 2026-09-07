import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Regression test for the map name written to disk.
//
// Root cause (B3-11): createMapCompat (store/repositories/index.js) filled a missing name from
// the requested one, but `getEmptyMapData()` (repositories/local.repository.js) already returns
// the placeholder 'Novo Mapa', so the guard NEVER fired and every map created without caller
// data was stored under the right KEY with the wrong FIELD.
//
// Inside this application the field was cosmetic and inert, which is why it survived: maps are
// keyed by name, and the `.ebgeo` export is keyed by name and does not carry the field. It bites
// where something PREFERS the field to the key. Measured on the real acervo of the crossing to
// the server product: 13 of 14 map records carried 'Novo Mapa', the reader indexed by the field,
// the 13 collided into one entry and the last one iterated won: 2 maps and 33 features reaching
// the server out of 14 and 805, with a green success toast.
//
// Fix, in two halves: the WRITE stops overriding the requested name for a fresh map (imported or
// duplicated data keeps its own, which `IDUtils.regenerateMapIds` already sets to the new name),
// and a one-shot boot REPAIR rewrites `data.name` from the key on the records already on disk,
// which is the only thing that protects an acervo that was created before this commit.

// In-memory localforage, one Map per store name (mirrors import-phantom-map.repro.test.js).
const { stores } = vi.hoisted(() => ({ stores: {} }));
vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(({ name }) => {
            if (!stores[name]) {
                const map = new Map();
                stores[name] = {
                    setItem: vi.fn(async (k, v) => { map.set(k, v); }),
                    getItem: vi.fn(async (k) => (map.has(k) ? map.get(k) : null)),
                    removeItem: vi.fn(async (k) => { map.delete(k); }),
                    keys: vi.fn(async () => [...map.keys()]),
                    clear: vi.fn(async () => { map.clear(); }),
                    iterate: vi.fn(async (cb) => { for (const [k, v] of map.entries()) cb(v, k); }),
                    _map: map
                };
            }
            return stores[name];
        })
    }
}));

import { createMapCompat } from '../../src/js/store/repositories/index.js';
import { getEmptyMapData } from '../../src/js/store/repositories/local.repository.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import { initializeRepository } from '../../src/js/store/repository.js';
import { ATLAS_SCHEMA_VERSION, createAtlas } from '../../src/js/store/atlas/atlas.entity.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';
import { makeFeature } from '../helpers/test-utils.js';

const MAPS = 'ebgeo_maps';
const APP = 'ebgeo_app_settings';
const ATLAS = 'ebgeo_atlas';

const loja = (nome) => stores[nome];

// DERIVED FROM THE SOURCE, not retyped: the boot repair carries the same value as a literal
// (repository.js), and this is what pins the two together. Note that the `getEmptyMapData` of
// repositories/local.repository.js is a DIFFERENT function from the same-named one in
// repository.utils.js, which has no `name` field at all; only this one is the placeholder's home.
const PLACEHOLDER = getEmptyMapData().name;

/** The 14 map names of the measured production acervo. */
const NOMES_DOS_MAPAS = [
    'Principal', '02 Estilos', '03 Camadas', '04 Notas', '05 Simbologia', '06 Medidas',
    '07 Visadas', '08 Imagens', '09 Briefing', '10 Temporal', '11 Grupos', '12 Lote',
    '13 Rotulos', '14 Bordas'
];

/**
 * Fabricates the disk of the real population: 14 maps keyed by the right name, and 13 of them
 * carrying `data.name = 'Novo Mapa'`. Only the first one ever created has both equal, because
 * it was seeded by the boot and not by createMapCompat.
 */
async function semearAcervoEnvenenado() {
    for (const [i, nome] of NOMES_DOS_MAPAS.entries()) {
        await loja(MAPS).setItem(nome, {
            id: nome,
            name: i === 0 ? nome : PLACEHOLDER,
            features: { points: [makeFeature(`feicao-${i}`)] }
        });
    }
    await loja(APP).setItem('schemaVersion', ATLAS_SCHEMA_VERSION);
    await loja(APP).setItem('lastActiveMap', 'Principal');
    const atlas = createAtlas('Meu Atlas');
    atlas.mapOrder = [...NOMES_DOS_MAPAS];
    await loja(ATLAS).setItem('current_atlas', atlas);
    vi.clearAllMocks();
}

/** The names as a reader that prefers the FIELD to the key would see them. */
async function nomesPeloCampo() {
    const keys = await loja(MAPS).keys();
    const nomes = [];
    for (const key of keys) {
        const data = await loja(MAPS).getItem(key);
        nomes.push(String(data?.name || key));
    }
    return nomes;
}

beforeEach(() => {
    for (const nome of Object.keys(stores)) stores[nome]._map.clear();
    mapResolver.clear();
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('B3-11: a escrita do nome do mapa', () => {
    it('PIOR CASO: o mapa novo criado pela tela grava o nome PEDIDO, nao o do modelo vazio', async () => {
        // O insumo degenerado e o gesto mais comum do produto: "Adicionar Mapa" com um nome.
        // Sem esta regua o campo envenenado passa despercebido, porque a chave esta certa e a
        // tela le a chave.
        expect(PLACEHOLDER).toBe('Novo Mapa');

        await createMapCompat('02 Estilos');

        expect((await loja(MAPS).getItem('02 Estilos')).name).toBe('02 Estilos');
    });

    it('catorze mapas criados pela tela sao catorze nomes distintos pelo CAMPO', async () => {
        // A regua no tamanho do dano: pelo campo, os catorze colidiam em treze 'Novo Mapa'.
        for (const nome of NOMES_DOS_MAPAS) {
            await createMapCompat(nome);
        }

        expect(await nomesPeloCampo()).toEqual(NOMES_DOS_MAPAS);
        expect(new Set(await nomesPeloCampo()).size).toBe(14);
    });

    it('CONTROLE: dado importado ou duplicado mantem o proprio nome', async () => {
        // `IDUtils.regenerateMapIds` ja grava o nome NOVO no dado que a copia e o import
        // aditivo passam, entao respeitar o dado do chamador e o que preserva a intencao dele.
        const dadoDuplicado = { name: '02 Estilos (copia)', features: { points: [] } };

        await createMapCompat('02 Estilos (copia)', dadoDuplicado);

        expect((await loja(MAPS).getItem('02 Estilos (copia)')).name).toBe('02 Estilos (copia)');
    });

    it('CONTROLE: dado do chamador SEM nome ainda toma o nome pedido', async () => {
        await createMapCompat('04 Notas', { features: { points: [] } });

        expect((await loja(MAPS).getItem('04 Notas')).name).toBe('04 Notas');
    });

    it('CONTROLE: quem pede mesmo um mapa chamado "Novo Mapa" continua tendo um', async () => {
        await createMapCompat(PLACEHOLDER);

        expect((await loja(MAPS).getItem(PLACEHOLDER)).name).toBe(PLACEHOLDER);
    });
});

describe('B3-11: o reparo do que ja esta no disco', () => {
    it('PIOR CASO: o acervo herdado de 14 mapas sai do boot com os 14 nomes certos', async () => {
        await semearAcervoEnvenenado();

        await initializeRepository();

        expect(await nomesPeloCampo()).toEqual(NOMES_DOS_MAPAS);
    });

    it('o reparo e IDEMPOTENTE: o segundo boot nao reescreve mapa nenhum', async () => {
        await semearAcervoEnvenenado();
        await initializeRepository();
        vi.clearAllMocks();

        await initializeRepository();

        expect(loja(MAPS).setItem).not.toHaveBeenCalled();
        expect(await nomesPeloCampo()).toEqual(NOMES_DOS_MAPAS);
    });

    it('nao encosta nas feicoes nem na metade de sincronia do registro', async () => {
        await semearAcervoEnvenenado();
        const antes = await loja(MAPS).getItem('05 Simbologia');

        await initializeRepository();

        const depois = await loja(MAPS).getItem('05 Simbologia');
        expect(depois.features).toEqual(antes.features);
        expect(depois.sync).toEqual(antes.sync);
        expect(depois.id).toBe(antes.id);
    });

    it('CONTROLE: um mapa que o usuario chamou mesmo de "Novo Mapa" fica como esta', async () => {
        await semearAcervoEnvenenado();
        await loja(MAPS).setItem(PLACEHOLDER, {
            id: PLACEHOLDER, name: PLACEHOLDER, features: { points: [] }
        });
        vi.clearAllMocks();

        await initializeRepository();

        expect((await loja(MAPS).getItem(PLACEHOLDER)).name).toBe(PLACEHOLDER);
    });

    it('CONTROLE: registro cuja CHAVE e um id gerado nao e reescrito com o id', async () => {
        // Onde a chave e um id, ela nao e um nome, e reescrever o campo a partir dela trocaria
        // um nome ruim por um pior.
        await semearAcervoEnvenenado();
        const chaveUuid = generateUUID();
        await loja(MAPS).setItem(chaveUuid, {
            id: chaveUuid, name: PLACEHOLDER, features: { points: [] }
        });
        vi.clearAllMocks();

        await initializeRepository();

        expect((await loja(MAPS).getItem(chaveUuid)).name).toBe(PLACEHOLDER);
    });
});
