// Path: tests/integration/boot-de-atlas-de-servidor-carimbado.repro.test.js
//
// TODO F5 NUM ATLAS DE SERVIDOR VIRAVA UM DEFEITO "ESCOPO PRESERVADO", e o escopo não tinha
// nada de misterioso. Medido em 2026-09-22 na tabela de defeitos da release 1c3c19c9: 13
// ocorrências em 5 assinaturas, 3 usuários, todas `console` na página do mapa.
//
// A CAUSA. O retrato do servidor entra numa GERAÇÃO nova de bancos (`applyRemoteSnapshot`), e a
// preparação gravava o registro de atlas (nascido por `createAtlas`, portanto na versão corrente)
// e NUNCA o carimbo `schemaVersion` do settings. Enquanto a abertura esvaziava o escopo na entrada,
// `clearAllDataStore` carimbava por ela; desde 2026-09-19 a abertura não esvazia nada, e nenhuma
// escrita chega àquela chave de uma geração. O boot seguinte (`checkAndCleanLegacyData`) lia
// "carimbo ausente sobre escopo com dado", que é a guarda de 2026-09-07, e relatava como ERRO. O
// caminho de preservação não escreve nada, então o próximo F5 repetia, para sempre.
//
// O CONSERTO TEM DUAS METADES, e este arquivo prende as duas mais a discriminação:
//   1. a geração NASCE carimbada (a raiz);
//   2. a geração que nasceu antes do conserto é reparada UMA vez pelo boot, porque o registro de
//      atlas do MESMO escopo testemunha a versão corrente; o boot seguinte fica calado;
//   3. sem essa testemunha a guarda continua gritando e continua não apagando nada.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    activateScope, clearAtlasDatabases, getStoreFor, remoteScope, StoreName, ATLAS_RECORD_KEY,
} from '../../src/js/store/atlas-namespace.js';
import { discardRemoteWrites } from '../../src/js/store/remote-write-fence.js';
import { getEmptyMapData } from '../../src/js/store/repositories/local.repository.js';
import { readGeneration } from '../../src/js/store/namespace-generation.js';
import { ATLAS_SCHEMA_VERSION, createAtlas } from '../../src/js/store/atlas/atlas.entity.js';
import { applyRemoteSnapshot, setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';
import { initializeRepository } from '../../src/js/store/repository.js';

const storage = new Map();
let contador = 0;

/** Um atlas de servidor montado num namespace PRÓPRIO por caso: o ponteiro de geração é global. */
async function montarAtlasDeServidor() {
    contador += 1;
    const atlasId = `52000000-0000-4000-8000-${String(contador).padStart(12, '0')}`;
    const mapId = `52000000-0000-4000-9000-${String(contador).padStart(12, '0')}`;
    const escopo = remoteScope(atlasId);
    activateScope(escopo);
    await clearAtlasDatabases(escopo);
    await applyRemoteSnapshot({
        atlas: { ...createAtlas('Remoto'), id: atlasId },
        maps: [{ ...getEmptyMapData(), id: mapId, name: 'Servidor' }],
        briefings: [],
        currentVersion: 7,
    });
    return { escopo, mapId };
}

/** Os bancos da geração ATIVA, lidos por nome absoluto e não pelo código sob teste. */
function geracaoAtiva(escopo) {
    const fisico = { ...escopo, dataGeneration: readGeneration(escopo).active };
    return {
        settings: getStoreFor(StoreName.SETTINGS, fisico),
        atlas: getStoreFor(StoreName.ATLAS, fisico),
        maps: getStoreFor(StoreName.MAPS, fisico),
    };
}

let erros;
let avisos;
let infos;

/** O console é MEDIDO a partir daqui, depois do retrato: é o boot que está sob teste. */
function medirConsole() {
    erros = [];
    avisos = [];
    infos = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => erros.push(a.map(String).join(' ')));
    vi.spyOn(console, 'warn').mockImplementation((...a) => avisos.push(a.map(String).join(' ')));
    vi.spyOn(console, 'info').mockImplementation((...a) => infos.push(a.map(String).join(' ')));
}

const falaDoCarimbo = (linhas) => linhas.filter(l => /ESCOPO PRESERVADO|Carimbo de esquema|carimbo de esquema/i.test(l));

beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('localStorage', {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key),
    });
    setRemoteHandlerEventBus({ emit: vi.fn() });
});
afterEach(() => vi.restoreAllMocks());

describe('o boot de um atlas de servidor', () => {
    it('a geração do retrato NASCE com o carimbo da versão corrente', async () => {
        const { escopo } = await montarAtlasDeServidor();

        expect(await geracaoAtiva(escopo).settings.getItem('schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);
    });

    it('e o F5 sobre ela não fala nada sobre carimbo, em canal nenhum', async () => {
        const { escopo, mapId } = await montarAtlasDeServidor();
        medirConsole();

        const entrada = await initializeRepository({ installation: false });

        expect(falaDoCarimbo([...erros, ...avisos, ...infos])).toEqual([]);
        expect(entrada).toBe(mapId);
        expect(await geracaoAtiva(escopo).maps.keys()).toEqual([mapId]);
    });

    it('REPRO: a geração nascida SEM carimbo não vira erro, é reparada uma vez, e o boot seguinte cala', async () => {
        // A geração como o build 1c3c19c9 a deixava: registro na versão corrente, settings sem a chave.
        const { escopo, mapId } = await montarAtlasDeServidor();
        await geracaoAtiva(escopo).settings.removeItem('schemaVersion');
        medirConsole();

        await initializeRepository({ installation: false });

        expect(erros.filter(l => l.includes('ESCOPO PRESERVADO'))).toEqual([]);
        expect(falaDoCarimbo(erros)).toEqual([]);
        expect(falaDoCarimbo(infos)).toHaveLength(1);
        expect(await geracaoAtiva(escopo).settings.getItem('schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);
        // NADA apagado: o mapa do servidor continua na geração ativa.
        expect(await geracaoAtiva(escopo).maps.keys()).toEqual([mapId]);

        medirConsole();
        await initializeRepository({ installation: false });
        expect(falaDoCarimbo([...erros, ...avisos, ...infos])).toEqual([]);
    });

    it('o reparo que não consegue gravar AVISA (não é defeito) e continua sem apagar nada', async () => {
        // A cerca de escrita fechada é o caso real: a saída da conta confirmada noutra aba condena
        // o namespace remoto, e toda escrita nele lança `AbortError`.
        const { escopo, mapId } = await montarAtlasDeServidor();
        await geracaoAtiva(escopo).settings.removeItem('schemaVersion');
        discardRemoteWrites(escopo);
        medirConsole();

        await initializeRepository({ installation: false });

        expect(falaDoCarimbo(erros)).toEqual([]);
        expect(falaDoCarimbo(avisos)).toHaveLength(1);
        expect(await geracaoAtiva(escopo).settings.getItem('schemaVersion')).toBeNull();
        expect(await geracaoAtiva(escopo).maps.keys()).toEqual([mapId]);
    });

    it('DISCRIMINAÇÃO: sem a testemunha do registro, a guarda continua gritando e não apaga nada', async () => {
        // Registro numa versão que NÃO é a corrente: o carimbo ausente volta a ser indistinguível
        // de "carimbo perdido", e o boot tem de tomar o caminho de 2026-09-07. Sem este caso, um
        // conserto que simplesmente calasse a linha passaria no arquivo inteiro.
        const { escopo, mapId } = await montarAtlasDeServidor();
        const { settings, atlas } = geracaoAtiva(escopo);
        await settings.removeItem('schemaVersion');
        const registro = await atlas.getItem(ATLAS_RECORD_KEY);
        await atlas.setItem(ATLAS_RECORD_KEY, { ...registro, schemaVersion: '2.4' });
        medirConsole();

        await initializeRepository({ installation: false });

        const linha = erros.find(l => l.includes('ESCOPO PRESERVADO'));
        expect(linha).toBeDefined();
        expect(linha).toContain('NADA foi apagado');
        expect(await settings.getItem('schemaVersion')).toBeNull();
        expect(await geracaoAtiva(escopo).maps.keys()).toEqual([mapId]);
    });
});
