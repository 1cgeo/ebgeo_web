import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { seedDatabase, storeAt, resetIndexedDB } from '../helpers/idb-helpers.js';

/**
 * Alterações que a versão anterior grava DEPOIS da transição (decisão do dono, 2026-09-21): o caso
 * trivial entra sozinho no atlas atualizado, e a tela de recuperação fica só para o conflito.
 *
 * A FIXTURE TEM A FORMA DO RELATO, e não os dados dele: o repositório é público. O relato era uma
 * instalação 2.4 da `main` com o mapa Principal, aberta na versão nova às 09:13, e duas linhas de
 * coordenação desenhadas na versão antiga às 09:27 e 09:28, com a contagem de cores e o estilo da
 * grade gravados junto.
 */

beforeEach(async () => { vi.resetModules(); await resetIndexedDB(); });
afterEach(async () => { vi.restoreAllMocks(); await resetIndexedDB(); });

const SEGUNDO_ID = '6f1c1d0e-4b3a-4d52-9a57-2f3c8e5b7a10';

function linha(n) {
    const id = `00000000-0000-4000-8000-00000000000${n}`;
    return {
        type: 'Feature', id,
        geometry: { type: 'LineString', coordinates: [[-53.03, -24.68], [-53.02, -24.67 - n / 1000]] },
        properties: {
            id, nome: `Linha de Coordenação #${n}`, color: '#000000', layerId: 'default',
            source: 'coordination_line', symbol_code: '290302', visivel: true, bloqueado: false
        }
    };
}

function mapa(nome, id, linhas = [], pontos = []) {
    return {
        id, name: nome, baseLayer: 'osm-overture', catalogLayers: [], analysisLayers: {},
        bearing: null, pitch: null, zoom: null, center_lat: null, center_long: null,
        features: { coordination_lines: linhas, points: pontos, lines: [], polygons: [] },
        sync: { createdAt: 1, updatedAt: 1, version: 1, deleted: false, deletedAt: null, dirty: true, ownerId: null }
    };
}

async function seed24() {
    await seedDatabase('ebgeo_atlas', { current_atlas: {
        id: '76cfc275-0000-4000-8000-000000000000', name: 'Meu Atlas', schemaVersion: '2.4',
        lastActiveMapId: 'Principal', mapOrder: ['Principal', 'Segundo'], settings: { terrainExaggeration: 1.5 }
    } });
    await seedDatabase('ebgeo_maps', { Principal: mapa('Principal', 'Principal'), Segundo: mapa('Segundo', SEGUNDO_ID) });
    await seedDatabase('ebgeo_app_settings', {
        schemaVersion: '2.4', lastActiveMap: 'Principal', color_usage_Principal: {}, color_usage_Segundo: {},
        mapBadgeColors: { Principal: '#3b82f6', Segundo: '#22c55e' }
    });
    await seedDatabase('ebgeo_cesium3d', { cesium3d_Principal: { cameraPositions: {}, markers: [], measurements: [], viewsheds: [] } });
}

/** O que a versão antiga grava quando desenha `n` linhas no mapa Principal. */
async function antigaDesenha(n = 2) {
    const linhas = Array.from({ length: n }, (_, i) => linha(i + 1));
    await seedDatabase('ebgeo_maps', { Principal: { ...mapa('Principal', 'Principal', linhas), sync: { createdAt: 1, updatedAt: 26, version: 26 } } });
    await seedDatabase('ebgeo_app_settings', { color_usage_Principal: { '#000000': n }, gridStyle_Principal: { format: 'latlong', visible: false } });
}

async function modules() {
    return {
        ns: await import('@store/atlas-namespace.js'),
        transition: await import('@store/migration/legacy-transition.js'),
        state: await import('@store/migration/transition-state.js')
    };
}

async function transicao() {
    const m = await modules();
    const { state } = await m.transition.prepareLegacyTransition();
    const destino = m.ns.localScope(state.entry.id, state.destination);
    const loja = id => m.ns.getStoreFor(id, destino);
    return { ...m, destino, loja, origem: m.ns.localScope('origem', '') };
}

/** O que a versão NOVA grava quando desenha um ponto num mapa (medido no navegador em 2026-09-21). */
async function novaDesenhaPonto(loja, ns, chave) {
    const atual = await loja(ns.StoreName.MAPS).getItem(chave);
    atual.features.points = [...(atual.features.points || []), {
        type: 'Feature', geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
        properties: { id: `ponto-${chave}`, nome: 'Ponto novo', color: '#ff0000', source: 'point' }
    }];
    await loja(ns.StoreName.MAPS).setItem(chave, atual);
    await loja(ns.StoreName.SETTINGS).setItem(`color_usage_${chave}`, { '#ff0000': 1 });
}

it('o caso do relato: duas linhas da versão antiga entram sozinhas, com a contagem de cores e a grade', async () => {
    await seed24();
    const { transition, ns, loja, origem, state } = await transicao();
    await antigaDesenha(2);
    const origemAntes = await transition.inventoryScope(origem);

    const boot = await transition.prepareLegacyTransition();

    expect(boot.late).toMatchObject({ outcome: 'absorbed', records: 3 });
    const principal = await loja(ns.StoreName.MAPS).getItem('Principal');
    expect(principal.features.coordination_lines.map(f => f.properties.nome))
        .toEqual(['Linha de Coordenação #1', 'Linha de Coordenação #2']);
    expect(await loja(ns.StoreName.SETTINGS).getItem('color_usage_Principal')).toEqual({ '#000000': 2 });
    expect(await loja(ns.StoreName.SETTINGS).getItem('gridStyle_Principal')).toEqual({ format: 'latlong', visible: false });
    expect(await loja(ns.StoreName.SETTINGS).getItem('schemaVersion')).toBe('3.0');
    expect(await transition.inventoryScope(origem)).toEqual(origemAntes);
    expect(await transition.legacyHasChanged()).toBe(false);
    const journal = await state.readLegacyTransition();
    expect(journal.late).toBeUndefined();
    expect(journal.history).toHaveLength(1);
});

// O QUE A PRODUÇÃO MOSTROU NO MESMO DIA, e o caso acima não pegava: a fixture dele já tinha a
// contagem de cores do Principal, e a da pessoa não tinha. A primeira abertura da versão nova CRIA
// o registro (`performInitialColorAnalysis`), e a primeira versão da regra leu isso como edição do
// Principal e deu a tela. Medido no navegador com a cópia de recuperação da pessoa.
it('o relato como a produção mostrou: a versão nova cria a contagem de cores ao abrir, e a junção passa', async () => {
    await seed24();
    await storeAt('ebgeo_app_settings').removeItem('color_usage_Principal');
    const { transition, ns, loja } = await transicao();
    expect(await loja(ns.StoreName.SETTINGS).getItem('color_usage_Principal')).toBeNull();
    await loja(ns.StoreName.SETTINGS).setItem('color_usage_Principal', {});
    await antigaDesenha(2);

    expect((await transition.prepareLegacyTransition()).late).toMatchObject({ outcome: 'absorbed' });
    expect((await loja(ns.StoreName.MAPS).getItem('Principal')).features.coordination_lines).toHaveLength(2);
    expect(await loja(ns.StoreName.SETTINGS).getItem('color_usage_Principal')).toEqual({ '#000000': 2 });
});

it('conflito lembrado por uma regra mais antiga é decidido de novo', async () => {
    await seed24();
    const { transition, ns, loja, destino, origem, state } = await transicao();
    await antigaDesenha(2);
    // O diário como a primeira versão da regra o deixou: a recusa lembrada, sem versão.
    const journal = await state.readLegacyTransition();
    journal.lateConflict = {
        reason: 'same_unit',
        legacy: await transition.inventoryScope(origem),
        destination: await transition.inventoryScope(destino)
    };
    await ns.getGlobalStore().setItem(state.LEGACY_TRANSITION_KEY, journal);

    expect((await transition.prepareLegacyTransition()).late).toMatchObject({ outcome: 'absorbed' });
    expect((await loja(ns.StoreName.MAPS).getItem('Principal')).features.coordination_lines).toHaveLength(2);
    expect((await state.readLegacyTransition()).lateConflict).toBeUndefined();
});

it('o pior caso: as duas versões desenharam no mesmo mapa, a tela fica e nada é escrito', async () => {
    await seed24();
    const { transition, ns, loja, destino, origem, state } = await transicao();
    await novaDesenhaPonto(loja, ns, 'Principal');
    await antigaDesenha(2);
    const destinoAntes = await transition.inventoryScope(destino);
    const origemAntes = await transition.inventoryScope(origem);

    await expect(transition.prepareLegacyTransition()).rejects.toMatchObject({ code: 'legacy_changes' });

    expect(await transition.inventoryScope(destino)).toEqual(destinoAntes);
    expect(await transition.inventoryScope(origem)).toEqual(origemAntes);
    const primeira = await state.readLegacyTransition();
    expect(primeira.lateConflict).toMatchObject({ reason: 'same_unit' });

    // O MESMO PAR DE ACERVOS RESPONDE PELO DIÁRIO: nenhuma cópia nova da origem a cada boot.
    await expect(transition.prepareLegacyTransition()).rejects.toMatchObject({ code: 'legacy_changes' });
    expect((await state.readLegacyTransition()).history).toEqual(primeira.history);
});

it('o mapa é a unidade: a versão nova mexeu só nas camadas, a antiga só no mapa, e isso conflita', async () => {
    await seed24();
    const { transition, ns, loja, destino } = await transicao();
    await loja(ns.StoreName.LAYERS).setItem('layers_Principal', [{ id: 'camada-nova', name: 'Camada nova' }]);
    // SÓ o registro do mapa, de propósito: com outro registro dele junto, os dois lados teriam
    // mexido no MESMO registro, e o caso passaria sem exercitar a regra do mapa.
    await seedDatabase('ebgeo_maps', { Principal: mapa('Principal', 'Principal', [linha(1)]) });
    const destinoAntes = await transition.inventoryScope(destino);
    await expect(transition.prepareLegacyTransition()).rejects.toMatchObject({ code: 'legacy_changes' });
    expect(await transition.inventoryScope(destino)).toEqual(destinoAntes);
});

it('o mapa se reconhece pelo id: o estilo da grade que a versão nova guarda pelo id ainda é o mesmo mapa', async () => {
    await seed24();
    const { transition, ns, loja, destino } = await transicao();
    // A versão nova chaveia as preferências do mapa pelo id resolvido (`setGridStyleCompat`). A
    // chave entra na base com uma primeira junção de outro mapa, para que o caso abaixo mexa SÓ
    // numa chave que nomeia o mapa pelo id.
    await loja(ns.StoreName.SETTINGS).setItem(`gridStyle_${SEGUNDO_ID}`, { format: 'latlong', visible: false });
    await antigaDesenha(1);
    expect((await transition.prepareLegacyTransition()).late).toMatchObject({ outcome: 'absorbed' });

    await loja(ns.StoreName.SETTINGS).setItem(`gridStyle_${SEGUNDO_ID}`, { format: 'utm', visible: true });
    await seedDatabase('ebgeo_maps', { Segundo: mapa('Segundo', SEGUNDO_ID, [linha(1)]) });
    const destinoAntes = await transition.inventoryScope(destino);
    await expect(transition.prepareLegacyTransition()).rejects.toMatchObject({ code: 'legacy_changes' });
    expect(await transition.inventoryScope(destino)).toEqual(destinoAntes);
});

it('mapas diferentes entram juntos, e a segunda junção não confunde a edição da versão nova com mudança da antiga', async () => {
    await seed24();
    const { transition, ns, loja } = await transicao();
    await novaDesenhaPonto(loja, ns, 'Segundo');
    await antigaDesenha(2);

    expect((await transition.prepareLegacyTransition()).late).toMatchObject({ outcome: 'absorbed' });
    const segundoDaNova = await loja(ns.StoreName.MAPS).getItem('Segundo');
    expect(segundoDaNova.features.points).toHaveLength(1);
    expect((await loja(ns.StoreName.MAPS).getItem('Principal')).features.coordination_lines).toHaveLength(2);

    // A antiga volta a desenhar no Principal. O Segundo dela continua o de antes do ponto, e é
    // ele que uma base única (a do destino) leria como "mudança da antiga" e gravaria por cima.
    await antigaDesenha(3);
    expect((await transition.prepareLegacyTransition()).late).toMatchObject({ outcome: 'absorbed' });
    expect(await loja(ns.StoreName.MAPS).getItem('Segundo')).toEqual(segundoDaNova);
    expect(await loja(ns.StoreName.SETTINGS).getItem('color_usage_Segundo')).toEqual({ '#ff0000': 1 });
    expect((await loja(ns.StoreName.MAPS).getItem('Principal')).features.coordination_lines).toHaveLength(3);
});

it('mapa apagado na versão antiga não se propaga calado', async () => {
    await seed24();
    const { transition, ns, loja } = await transicao();
    await storeAt('ebgeo_maps').removeItem('Segundo');
    await storeAt('ebgeo_app_settings').removeItem('color_usage_Segundo');
    await expect(transition.prepareLegacyTransition()).rejects.toMatchObject({ code: 'legacy_changes' });
    expect(await loja(ns.StoreName.MAPS).getItem('Segundo')).toBeTruthy();
});

it('atlas montado em alguma aba adia sem escrever, e a próxima abertura sem ninguém nele incorpora', async () => {
    await seed24();
    const { transition, ns, loja, destino, state } = await transicao();
    await antigaDesenha(2);
    const destinoAntes = await transition.inventoryScope(destino);
    let soltar;
    const segurado = new Promise(resolve => { soltar = resolve; });
    const concedido = new Promise(resolve => {
        navigator.locks.request(ns.atlasMountLockName(destino.dbSuffix), { mode: 'shared' }, () => { resolve(); return segurado; });
    });
    await concedido;

    const adiado = await transition.prepareLegacyTransition();
    expect(adiado.late).toEqual({ outcome: 'deferred' });
    expect(await transition.inventoryScope(destino)).toEqual(destinoAntes);
    expect(await transition.legacyHasChanged()).toBe(true);
    expect((await state.readLegacyTransition()).late).toBeUndefined();

    soltar();
    await vi.waitFor(async () => {
        const snapshot = await navigator.locks.query();
        expect(snapshot.held.some(l => l.name === ns.atlasMountLockName(destino.dbSuffix))).toBe(false);
    });
    expect((await transition.prepareLegacyTransition()).late).toMatchObject({ outcome: 'absorbed' });
    expect((await loja(ns.StoreName.MAPS).getItem('Principal')).features.coordination_lines).toHaveLength(2);
});

it('interrupção no meio da escrita retoma o MESMO plano no boot seguinte', async () => {
    await seed24();
    const m = await transicao();
    await antigaDesenha(2);
    const global = m.ns.getGlobalStore();
    await global.ready();
    const gravar = global.setItem.bind(global);
    let armado = false;
    vi.spyOn(global, 'setItem').mockImplementation(async (key, value) => {
        await gravar(key, value);
        if (!armado && key === m.state.LEGACY_TRANSITION_KEY && value.late?.status === 'applying') {
            armado = true;
            const settings = m.loja(m.ns.StoreName.SETTINGS);
            await settings.ready();
            vi.spyOn(settings, 'setItem').mockRejectedValueOnce(new Error('interrupção'));
        }
        return value;
    });
    await expect(m.transition.prepareLegacyTransition()).rejects.toThrow('interrupção');
    const pendente = await m.state.readLegacyTransition();
    expect(pendente.late.status).toBe('applying');

    vi.restoreAllMocks(); vi.resetModules();
    const fresco = await modules();
    expect((await fresco.transition.prepareLegacyTransition()).late).toMatchObject({ outcome: 'absorbed', records: 3 });
    const destino = fresco.ns.localScope(pendente.entry.id, pendente.destination);
    expect(await fresco.ns.getStoreFor(fresco.ns.StoreName.SETTINGS, destino).getItem('color_usage_Principal')).toEqual({ '#000000': 2 });
    const final = await fresco.state.readLegacyTransition();
    expect(final.history.filter(s => s === pendente.late.staging)).toHaveLength(1);
});

it('origem apagada por ordem não serve de base: o que uma aba antiga escrever depois vai para a tela', async () => {
    await seed24();
    const { transition, ns, loja, destino } = await transicao();
    const { dropLegacySource } = await import('@store/migration/legacy-cleanup.js');
    await dropLegacySource();
    await seed24();
    await antigaDesenha(1);
    const destinoAntes = await transition.inventoryScope(destino);
    await expect(transition.prepareLegacyTransition()).rejects.toMatchObject({ code: 'legacy_changes' });
    expect(await transition.inventoryScope(destino)).toEqual(destinoAntes);
    expect((await loja(ns.StoreName.MAPS).getItem('Principal')).features.coordination_lines).toHaveLength(0);
});
