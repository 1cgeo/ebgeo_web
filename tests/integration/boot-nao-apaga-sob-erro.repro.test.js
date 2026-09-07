import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Regression tests for what the boot does to the user's data when a read FAILS.
//
// Root cause (B4-1): the `catch` of `appStore.getItem('schemaVersion')` in
// checkAndCleanLegacyData (store/repository.js) called clearLegacyStores(), which empties
// ebgeo_maps, ebgeo_images, ebgeo_app_settings, ebgeo_groups and ebgeo_layers. Any transient
// IndexedDB error (an InvalidStateError after another tab's versionchange, an UnknownError
// from disk, a quota failure) was therefore read as "this data is too old" and the whole
// repository was destroyed. ebgeo_atlas is NOT in that list, so the record survived
// describing maps that no longer existed, which made the NEXT boot look normal.
//
// Same predicate, second half (B4-6): a MISSING `schemaVersion` means two indistinguishable
// things (an installation older than the marker, which is empty, and a scope whose marker
// was lost, which may be full), and the destructive reading was applied to both.
//
// Third symptom (B4-1b): clearLegacyStores was SERIAL, so a rejected clear() left the earlier
// stores empty and skipped the stamp; the boot then read a null version and
// runLegacyMigrations(null) stamped `SCHEMA_VERSION`, the LEGACY '1.7', the very state that
// commit 2bd89de2 removed from "Limpar Todos os Dados", written here by the boot itself.
//
// Fourth (B4-4): the `catch` of initializeRepository returned DEFAULT_MAP_NAME always, and in
// an acervo where no map is called 'Principal' the user landed inside a map the acervo does
// not have, with everything still on disk and nothing on screen.
//
// Fix: a read that fails answers "I do not know" and destroys nothing; clearing on an absent
// or too-old marker only runs over a scope with NO data; the legacy chain does not run over a
// marker that cannot be trusted; the clearing is parallel with the first failure rethrown; and
// the boot's last resort is a map that EXISTS.

// In-memory localforage, one Map per store name, with failure injection (mirrors
// limpar-tudo-carimba-versao.repro.test.js and import-phantom-map.repro.test.js).
const { stores, falhas } = vi.hoisted(() => ({
    stores: {},
    // `getItem` maps `${banco}:${chave}` to the remaining number of rejections; `clear` and
    // `setItem` map `${banco}` / `${banco}:${chave}` the same way. Injection is by COUNT so a
    // transient error (the realistic one) can be told apart from a permanent one.
    falhas: { getItem: new Map(), setItem: new Map(), clear: new Map() }
}));
vi.mock('localforage', () => {
    const consome = (mapa, chave) => {
        const restantes = mapa.get(chave);
        if (!restantes) return null;
        if (restantes.vezes <= 1) mapa.delete(chave);
        else restantes.vezes -= 1;
        return restantes.erro;
    };
    return {
        default: {
            createInstance: vi.fn(({ name }) => {
                if (!stores[name]) {
                    const map = new Map();
                    stores[name] = {
                        setItem: vi.fn(async (k, v) => {
                            const erro = consome(falhas.setItem, `${name}:${k}`);
                            if (erro) throw erro;
                            map.set(k, v);
                        }),
                        getItem: vi.fn(async (k) => {
                            const erro = consome(falhas.getItem, `${name}:${k}`);
                            if (erro) throw erro;
                            return map.has(k) ? map.get(k) : null;
                        }),
                        removeItem: vi.fn(async (k) => { map.delete(k); }),
                        keys: vi.fn(async () => {
                            const erro = consome(falhas.getItem, `${name}:__keys__`);
                            if (erro) throw erro;
                            return [...map.keys()];
                        }),
                        clear: vi.fn(async () => {
                            const erro = consome(falhas.clear, name);
                            if (erro) throw erro;
                            map.clear();
                        }),
                        iterate: vi.fn(async (cb) => { for (const [k, v] of map.entries()) cb(v, k); }),
                        _map: map
                    };
                }
                return stores[name];
            })
        }
    };
});

import { initializeRepository } from '../../src/js/store/repository.js';
import { SCHEMA_VERSION } from '../../src/js/store/repository.utils.js';
import { ATLAS_SCHEMA_VERSION, createAtlas } from '../../src/js/store/atlas/atlas.entity.js';
import { DEFAULT_MAP_NAME } from '../../src/js/store/store.constants.js';
import { makeFeature } from '../helpers/test-utils.js';

const MAPS = 'ebgeo_maps';
const IMAGES = 'ebgeo_images';
const APP = 'ebgeo_app_settings';
const GROUPS = 'ebgeo_groups';
const LAYERS = 'ebgeo_layers';
const ATLAS = 'ebgeo_atlas';

const loja = (nome) => stores[nome];
const conta = (nome) => loja(nome)._map.size;

/** Injects `vezes` consecutive rejections of `getItem(chave)` on `banco`. */
function falharLeitura(banco, chave, erro, vezes = 1) {
    falhas.getItem.set(`${banco}:${chave}`, { erro, vezes });
}

/** The 14 map names of the measured production acervo. None of them is 'Principal'. */
const NOMES_DOS_MAPAS = [
    '01 Basico', '02 Estilos', '03 Camadas', '04 Notas', '05 Simbologia', '06 Medidas',
    '07 Visadas', '08 Imagens', '09 Briefing', '10 Temporal', '11 Grupos', '12 Lote',
    '13 Rotulos', '14 Bordas'
];

/**
 * Seeds an installation on the current version: 14 maps, 149 image blobs, layers, groups,
 * the atlas record and the settings. This is the shape the boot must never destroy.
 *
 * The seeding calls are forgotten at the end, so every assertion about what was WRITTEN sees
 * only what the boot did.
 */
async function semearAcervo({ carimbo = ATLAS_SCHEMA_VERSION } = {}) {
    for (const [i, nome] of NOMES_DOS_MAPAS.entries()) {
        await loja(MAPS).setItem(nome, {
            id: nome,
            name: nome,
            features: { points: [makeFeature(`feicao-${i}-a`), makeFeature(`feicao-${i}-b`)] }
        });
        await loja(LAYERS).setItem(`layers_${nome}`, [{ id: 'default', name: 'Padrao' }]);
        await loja(GROUPS).setItem(nome, {});
    }
    for (let i = 0; i < 149; i++) {
        await loja(IMAGES).setItem(`blob-${i}`, `bytes-${i}`);
    }
    await loja(APP).setItem('lastActiveMap', '05 Simbologia');
    if (carimbo !== null) await loja(APP).setItem('schemaVersion', carimbo);

    const atlas = createAtlas('Meu Atlas');
    atlas.schemaVersion = carimbo === null ? ATLAS_SCHEMA_VERSION : carimbo;
    atlas.mapOrder = [...NOMES_DOS_MAPAS];
    await loja(ATLAS).setItem('current_atlas', atlas);

    vi.clearAllMocks();
}

/** Every value the boot wrote into `schemaVersion`, in order. */
function carimbosEscritos() {
    return loja(APP).setItem.mock.calls
        .filter(([chave]) => chave === 'schemaVersion')
        .map(([, valor]) => valor);
}

let erroSpy;

beforeEach(() => {
    for (const nome of Object.keys(stores)) stores[nome]._map.clear();
    falhas.getItem.clear();
    falhas.setItem.clear();
    falhas.clear.clear();
    vi.clearAllMocks();
    erroSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('B4-1: um erro de leitura do carimbo nao e um veredito sobre o dado', () => {
    it('PIOR CASO: a leitura do carimbo falha e os 14 mapas e 149 blobs continuam no disco', async () => {
        // O insumo degenerado: uma instalacao 2.4 inteira, e a PRIMEIRA leitura de
        // `schemaVersion` rejeitando com o erro que outra aba produz ao disparar
        // `versionchange`. A rejeicao e transitoria de proposito, que e o caso realista e o
        // mais dificil para o conserto: uma segunda leitura responderia certo.
        await semearAcervo();
        falharLeitura(APP, 'schemaVersion', new DOMException('closing', 'InvalidStateError'));

        await initializeRepository();

        expect(conta(MAPS)).toBe(14);
        expect(conta(IMAGES)).toBe(149);
        expect(conta(LAYERS)).toBe(14);
        expect(conta(GROUPS)).toBe(14);
        expect(await loja(APP).getItem('schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);
    });

    it('e o boot diz por escrito que nao mediu o carimbo e que nao vai apagar', async () => {
        await semearAcervo();
        falharLeitura(APP, 'schemaVersion', new DOMException('closing', 'InvalidStateError'));

        await initializeRepository();

        const ditos = erroSpy.mock.calls.map((args) => String(args[0]));
        expect(ditos.some((linha) => /marker/i.test(linha) && /erased/i.test(linha))).toBe(true);
    });

    it('o mapa de entrada continua sendo um dos 14, nao um nome que o acervo nao tem', async () => {
        await semearAcervo();
        falharLeitura(APP, 'schemaVersion', new DOMException('closing', 'InvalidStateError'));

        const entrada = await initializeRepository();

        expect(NOMES_DOS_MAPAS).toContain(entrada);
    });

    it('CONTROLE: sem erro nenhum, a mesma instalacao abre no ultimo mapa ativo e nada muda', async () => {
        await semearAcervo();

        const entrada = await initializeRepository();

        expect(entrada).toBe('05 Simbologia');
        expect(conta(MAPS)).toBe(14);
        expect(conta(IMAGES)).toBe(149);
        expect(carimbosEscritos()).toEqual([]);
    });
});

describe('B4-6: a ausencia do carimbo nao e prova de idade', () => {
    it('carimbo AUSENTE sobre um escopo COM dado nao apaga nada', async () => {
        // O carimbo perdido e o carimbo que nunca existiu sao indistinguiveis pela leitura, e
        // so a PERGUNTA SOBRE CONTEUDO os separa. Aqui o registro de atlas ainda diz 2.4, que
        // e o estado de quem perdeu so a chave do settings.
        await semearAcervo({ carimbo: null });

        await initializeRepository();

        expect(conta(MAPS)).toBe(14);
        expect(conta(IMAGES)).toBe(149);
        expect(conta(LAYERS)).toBe(14);
        expect(conta(GROUPS)).toBe(14);
    });

    it('e o boot loga o ERRO nomeado do escopo com dado e carimbo em que nao se confia', async () => {
        await semearAcervo({ carimbo: null });

        await initializeRepository();

        const ditos = erroSpy.mock.calls.map((args) => String(args[0]));
        expect(ditos.some((linha) => /scope/i.test(linha) && /erased/i.test(linha))).toBe(true);
    });

    it('CONTROLE: carimbo ausente sobre escopo VAZIO continua limpando e carimbando a versao corrente', async () => {
        // Sem este controle, "nunca apagar" passaria. A instalacao nova TEM de nascer limpa,
        // carimbada na versao corrente, com o mapa padrao semeado e com registro de atlas: e
        // o registro que guarda o exagero do terreno, e nada mais o cria.
        const entrada = await initializeRepository();

        expect(entrada).toBe(DEFAULT_MAP_NAME);
        expect(await loja(APP).getItem('schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);
        expect([...loja(MAPS)._map.keys()]).toEqual([DEFAULT_MAP_NAME]);
        expect(await loja(ATLAS).getItem('current_atlas')).toBeTruthy();
    });
});

describe('B4-1b: o boot nao escreve o carimbo legado 1.7', () => {
    it('a instalacao NOVA nasce em 2.4 sem passar pelo 1.7', async () => {
        await initializeRepository();

        expect(SCHEMA_VERSION).toBe('1.7');
        expect(carimbosEscritos()).not.toContain(SCHEMA_VERSION);
        expect(carimbosEscritos()).toContain(ATLAS_SCHEMA_VERSION);
    });

    it('PIOR CASO: um clear() que rejeita tenta TODOS os bancos e nao carimba 1.7', async () => {
        // A limpeza serial parava no banco que falhou: os anteriores ficavam vazios, o
        // ebgeo_layers nem era tentado, o carimbo era pulado, e o boot lia null e gravava o
        // legado '1.7'. Com `allSettled` todos sao tentados e a primeira falha e relancada.
        falhas.clear.set(GROUPS, { erro: new DOMException('io', 'UnknownError'), vezes: 99 });

        const entrada = await initializeRepository();

        expect(loja(LAYERS).clear).toHaveBeenCalled();
        expect(carimbosEscritos()).not.toContain(SCHEMA_VERSION);
        expect(entrada).toBe(DEFAULT_MAP_NAME);
    });

    it('nem o erro de leitura faz o boot carimbar 1.7 sobre o acervo', async () => {
        await semearAcervo();
        falharLeitura(APP, 'schemaVersion', new DOMException('closing', 'InvalidStateError'));

        await initializeRepository();

        expect(carimbosEscritos()).not.toContain(SCHEMA_VERSION);
    });
});

describe('B4-4: o mapa de entrada quando a inicializacao falha no meio', () => {
    it('a migracao que estoura a cota nao joga o usuario num mapa que o acervo nao tem', async () => {
        // Uma instalacao 2.3 com os 14 mapas: o degrau 2.3 -> 2.4 reescreve o registro de
        // atlas, e e essa escrita que a cota derruba. `safelyMigrate` lanca, o `catch` de
        // `initializeRepository` assume, e nenhum dos 14 mapas se chama 'Principal'.
        await semearAcervo({ carimbo: '2.3' });
        falhas.setItem.set(`${ATLAS}:current_atlas`, {
            erro: new DOMException('cota', 'QuotaExceededError'), vezes: 99
        });

        const entrada = await initializeRepository();

        expect(entrada).not.toBe(DEFAULT_MAP_NAME);
        expect(NOMES_DOS_MAPAS).toContain(entrada);
        expect(conta(MAPS)).toBe(14);
    });

    it('CONTROLE: sem a cota, o mesmo degrau termina e a entrada e o ultimo mapa ativo', async () => {
        await semearAcervo({ carimbo: '2.3' });

        const entrada = await initializeRepository();

        expect(entrada).toBe('05 Simbologia');
        expect(await loja(APP).getItem('schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);
    });

    it('sem mapa nenhum no escopo, a entrada continua sendo o mapa padrao', async () => {
        // Aqui a ignorancia e o estado, e nao um palpite: o repositorio so sabe semear um nome.
        falhas.getItem.set(`${APP}:schemaVersion`, {
            erro: new DOMException('closing', 'InvalidStateError'), vezes: 99
        });
        falhas.getItem.set(`${MAPS}:__keys__`, {
            erro: new DOMException('io', 'UnknownError'), vezes: 99
        });

        const entrada = await initializeRepository();

        expect(entrada).toBe(DEFAULT_MAP_NAME);
    });
});
