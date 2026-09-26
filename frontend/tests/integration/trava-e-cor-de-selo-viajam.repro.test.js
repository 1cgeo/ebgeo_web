// Path: tests/integration/trava-e-cor-de-selo-viajam.repro.test.js

/**
 * @fileoverview A TRAVA DE CADA MAPA E AS CORES DE SELO VIAJAM NAS CÓPIAS (decisão do dono de
 * 2026-09-26, "levar nos dois").
 *
 * Antes, "Enviar ao servidor" mandava `locked: false` para todo mapa e nenhum `.ebgeo` levava a
 * trava: o mapa que a pessoa travou chegava destravado em toda cópia, e cada mapa ganhava uma cor
 * de selo nova. As duas moram no app setting do atlas, chaveadas pelo NOME do mapa
 * (`mapLocked_<nome>`, que é o que a troca de mapa lê, e `mapBadgeColors`, nome → cor).
 *
 * Os casos passam pelos quatro lugares onde isso se decide, sobre IndexedDB de verdade
 * (`fake-indexeddb`, instalado para toda a suíte): quem LÊ o atlas local para o envio, quem monta
 * o payload do servidor, quem GRAVA o `.ebgeo` num atlas novo e quem o ACRESCENTA a um atlas que
 * já tem mapas, onde o nome do mapa importado pode mudar. O quinto produtor é o `.ebgeo` de
 * recuperação da migração.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { resetIndexedDB } from '../helpers/idb-helpers.js';

const UUID_ALFA = 'a1b2c3d4-0000-4000-8000-0000000000a1';
const semCatalogo = layers => ({ processed: layers, unavailableCount: 0 });

let ns;
beforeEach(async () => {
    await resetIndexedDB();
    // A fábrica guarda um handle por (store, escopo) no nível do módulo.
    vi.resetModules();
    ns = await import('@store/atlas-namespace.js');
});

const gravar = (scope, banco, chave, valor) => ns.getStoreFor(ns.StoreName[banco], scope).setItem(chave, valor);
const ler = (scope, banco, chave) => ns.getStoreFor(ns.StoreName[banco], scope).getItem(chave);

/** Dois mapas: o Alfa, chaveado por UUID e TRAVADO; o Bravo, chaveado pelo nome e livre. */
async function semearAtlasLocal(scope) {
    await gravar(scope, 'MAPS', UUID_ALFA, { id: UUID_ALFA, name: 'Mapa Alfa', features: {} });
    await gravar(scope, 'MAPS', 'Mapa Bravo', { id: 'Mapa Bravo', name: 'Mapa Bravo', features: {} });
    // A trava é chaveada pelo NOME, não pela chave do mapa: a chave do UUID não vale.
    await gravar(scope, 'SETTINGS', 'mapLocked_Mapa Alfa', true);
    await gravar(scope, 'SETTINGS', `mapLocked_${UUID_ALFA}`, false);
    await gravar(scope, 'SETTINGS', 'mapLocked_Mapa Bravo', false);
    // Uma cor de um mapa que já não existe fica para trás.
    await gravar(scope, 'SETTINGS', 'mapBadgeColors',
        { 'Mapa Alfa': '#aa0000', 'Mapa Bravo': '#00bb00', 'Mapa Apagado': '#123456' });
}

describe('Enviar ao servidor', () => {
    it('REPRO: o mapa travado sobe travado, e as cores de selo sobem no settings do atlas', async () => {
        const scope = ns.localScope('atlas-alvo', 'alvo');
        await semearAtlasLocal(scope);
        const { buildLocalAtlasExportData } = await import('@js/projects/send-local-to-server.service.js');
        const { buildServerImportPayload } = await import('@js/import_export/local-atlas-to-server.js');

        const data = await buildLocalAtlasExportData(scope);
        expect({ ...data.mapLocks }).toEqual({ 'Mapa Alfa': true });
        expect(data.mapBadgeColors).toEqual({ 'Mapa Alfa': '#aa0000', 'Mapa Bravo': '#00bb00' });

        const { payload } = buildServerImportPayload(data, { name: 'Atlas' });
        const travado = Object.fromEntries(payload.maps.map(m => [m.name, m.locked]));
        expect(travado).toEqual({ 'Mapa Alfa': true, 'Mapa Bravo': false });
        expect(payload.atlas.settings.mapBadgeColors).toEqual({ 'Mapa Alfa': '#aa0000', 'Mapa Bravo': '#00bb00' });
    });

    it('um documento antigo, sem as duas seções, sobe como antes: destravado e sem cor', async () => {
        const { buildServerImportPayload } = await import('@js/import_export/local-atlas-to-server.js');
        const { payload } = buildServerImportPayload({ maps: { A: { features: {} } } }, { name: 'Antigo' });
        expect(payload.maps[0].locked).toBe(false);
        expect(payload.atlas.settings).not.toHaveProperty('mapBadgeColors');
    });

    it('só `true` trava: um valor que não é booleano não sobe como trava', async () => {
        const { buildServerImportPayload } = await import('@js/import_export/local-atlas-to-server.js');
        const { payload } = buildServerImportPayload({
            maps: { A: { features: {} }, B: { features: {} } },
            mapLocks: { A: 'true', B: 1 },
            mapBadgeColors: { A: 7, B: '' },
        }, { name: 'Torto' });
        expect(payload.maps.map(m => m.locked)).toEqual([false, false]);
        expect(payload.atlas.settings).not.toHaveProperty('mapBadgeColors');
    });
});

describe('.ebgeo aberto num atlas novo', () => {
    it('REPRO: a trava é gravada sob a chave que a troca de mapa lê, e as cores voltam', async () => {
        const scope = ns.localScope('atlas-novo', 'novo');
        const { prepareEbgeoScope } = await import('@js/import_export/prepare-ebgeo-scope.js');
        await prepareEbgeoScope(scope, { id: 'atlas-novo', name: 'Novo' }, {
            maps: { A: { features: {} }, B: { features: {} } },
            mapLocks: { A: true, B: false },
            mapBadgeColors: { A: '#aa0000', B: '#00bb00', Fora: '#123456' },
        }, new JSZip(), semCatalogo);

        expect(await ler(scope, 'SETTINGS', 'mapLocked_A')).toBe(true);
        expect(await ler(scope, 'SETTINGS', 'mapLocked_B')).toBeNull();
        expect(await ler(scope, 'SETTINGS', 'mapBadgeColors')).toEqual({ A: '#aa0000', B: '#00bb00' });
    });

    it('o arquivo antigo não escreve cor nenhuma, e a atribuição automática segue valendo', async () => {
        const scope = ns.localScope('atlas-velho', 'velho');
        const { prepareEbgeoScope } = await import('@js/import_export/prepare-ebgeo-scope.js');
        await prepareEbgeoScope(scope, { id: 'atlas-velho', name: 'Velho' },
            { maps: { A: { features: {} } } }, new JSZip(), semCatalogo);
        expect(await ler(scope, 'SETTINGS', 'mapBadgeColors')).toBeNull();
        expect(await ler(scope, 'SETTINGS', 'mapLocked_A')).toBeNull();
    });

    it('o documento completo do envio, gravado de volta, devolve a trava do mapa certo', async () => {
        const origem = ns.localScope('atlas-alvo', 'alvo');
        await semearAtlasLocal(origem);
        const { buildLocalAtlasExportData } = await import('@js/projects/send-local-to-server.service.js');
        const { prepareEbgeoScope } = await import('@js/import_export/prepare-ebgeo-scope.js');
        const destino = ns.localScope('atlas-copia', 'copia');

        await prepareEbgeoScope(destino, { id: 'atlas-copia', name: 'Cópia' },
            await buildLocalAtlasExportData(origem), new JSZip(), semCatalogo);

        expect(await ler(destino, 'SETTINGS', 'mapLocked_Mapa Alfa')).toBe(true);
        expect(await ler(destino, 'SETTINGS', 'mapLocked_Mapa Bravo')).toBeNull();
    });
});

describe('.ebgeo acrescentado a um atlas que já tem mapas', () => {
    it('REPRO: o mapa renomeado leva a trava e a cor sob o NOME NOVO, e o do atlas fica como estava', async () => {
        const origem = ns.localScope('atlas', 'original');
        const destino = ns.localScope('atlas', 'preparado');
        await gravar(origem, 'MAPS', 'A', { name: 'A', features: {} });
        await gravar(origem, 'MAPS', 'B', { name: 'B', features: {} });
        await gravar(origem, 'SETTINGS', 'mapBadgeColors', { A: '#111111', B: '#333333' });
        await gravar(origem, 'ATLAS', 'current_atlas', { id: 'atlas', name: 'Original' });
        const { prepareAdditiveScope } = await import('@js/import_export/prepare-additive-scope.js');

        await prepareAdditiveScope(origem, destino, { id: 'atlas', name: 'Original' }, {
            maps: { A: { features: {} } },
            // `B` não é mapa deste arquivo: nem a trava nem a cor dele podem tocar o B do atlas.
            mapLocks: { A: true, B: true },
            mapBadgeColors: { A: '#222222', B: '#999999' },
        }, new JSZip(), semCatalogo);

        expect(await ler(destino, 'SETTINGS', 'mapLocked_A_1')).toBe(true);
        expect(await ler(destino, 'SETTINGS', 'mapLocked_A')).toBeNull();
        expect(await ler(destino, 'SETTINGS', 'mapLocked_B')).toBeNull();
        expect(await ler(destino, 'SETTINGS', 'mapBadgeColors')).toEqual({ A: '#111111', B: '#333333', A_1: '#222222' });
        // O original não é tocado pela preparação.
        expect(await ler(origem, 'SETTINGS', 'mapBadgeColors')).toEqual({ A: '#111111', B: '#333333' });
    });
});

describe('.ebgeo de recuperação da migração', () => {
    it('leva a trava e as cores do acervo, pelo nome', async () => {
        const scope = ns.localScope('atlas-rec', 'rec');
        await semearAtlasLocal(scope);
        const { montarDocumentoEbgeo } = await import('@store/migration/ebgeo-de-recuperacao.js');

        const { data } = await montarDocumentoEbgeo(scope);

        expect({ ...data.mapLocks }).toEqual({ 'Mapa Alfa': true });
        expect(data.mapBadgeColors).toEqual({ 'Mapa Alfa': '#aa0000', 'Mapa Bravo': '#00bb00' });
    });
});
