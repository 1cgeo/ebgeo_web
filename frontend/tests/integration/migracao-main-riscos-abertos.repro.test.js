// Auditoria da transicao main -> integracao_backend, 2026-09-12.
// As assercoes expressam preservacao de dados. Falhas sao bloqueadores abertos,
// nao devem ser convertidas em skips nem em expectativas do comportamento defeituoso.
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { seedDatabase, readKey, resetIndexedDB } from '../helpers/idb-helpers.js';

async function seedV1() {
    await seedDatabase('ebgeo_app_settings', { schemaVersion: '1.7', lastActiveMap: 'Operacao' });
    await seedDatabase('ebgeo_maps', {
        Operacao: {
            features: { images: [{
                type: 'Feature', geometry: { type: 'Point', coordinates: [-47, -15] },
                properties: { id: 'foto-antiga', source: 'image', layerId: 'camada-antiga', groupId: 'grupo-antigo' }
            }] }
        }
    });
    await seedDatabase('ebgeo_images', { 'foto-antiga': new Uint8Array([137, 80, 78, 71]) });
    await seedDatabase('ebgeo_layers', {
        layers_Operacao: [{ id: 'camada-antiga', name: 'Reconhecimento' }],
        activeLayer_Operacao: 'camada-antiga'
    });
    await seedDatabase('ebgeo_groups', {
        Operacao: { 'grupo-antigo': {
            id: 'grupo-antigo', features: [{ id: 'foto-antiga', type: 'images' }]
        } }
    });
}

// O IMPORT A FRIO FICA FORA DO ORÇAMENTO DOS CASOS. Medido em 2026-09-20, com a mesma máquina em
// repouso e com 96 processos ocupando 32 núcleos: a migração leva de 9 a 19 ms nas DUAS condições,
// e o `import()` a frio do grafo atrás de `migration.service.js` vai de 175 ms para 7,7 a 11,2 s,
// caindo a 320 ms quando o cache de transformação do worker aquece. Com o import DENTRO do caso, o
// orçamento padrão de 5 s era gasto pelo empacotador e não pelo código sob teste: 2 de 10 rodadas
// reprovavam sob carga, com "Test timed out in 5000ms" no primeiro caso que importa e no seguinte
// por cascata. Isolado dava 5 de 5, e foi assim que uma sessão o relatou como flake alheio.
// O `vi.resetModules()` de cada caso continua valendo: ele refaz a AVALIAÇÃO dos módulos, que é
// barata; o que este aquecimento paga uma vez é a TRANSFORMAÇÃO, que é a cara.
beforeAll(async () => {
    await import('@store/migration/migration.service.js');
    await import('@store/migration/v1-to-v2.migration.js');
    await import('@store/migration/migration-scope.js');
    await import('@store/atlas-namespace.js');
    await import('@utils/tab-lock.js');
}, 120000);

beforeEach(async () => {
    vi.resetModules();
    await resetIndexedDB();
    await seedV1();
});

afterEach(async () => {
    vi.restoreAllMocks();
    await resetIndexedDB();
});

describe('bloqueadores de preservacao na migracao de usuarios ausentes', () => {
    it('controle: o acervo 1.7 tem imagem, camada e grupo alcançaveis antes de migrar', async () => {
        const map = await readKey('ebgeo_maps', 'Operacao');
        const feature = map.features.images[0];
        expect(await readKey('ebgeo_images', feature.properties.id)).toEqual(new Uint8Array([137, 80, 78, 71]));
        expect((await readKey('ebgeo_layers', 'layers_Operacao'))[0].id).toBe(feature.properties.layerId);
        expect((await readKey('ebgeo_groups', 'Operacao'))[feature.properties.groupId].features[0].id)
            .toBe(feature.properties.id);
    });

    it('1.7 -> 3.0 mantém a imagem alcançavel pela feicao migrada', async () => {
        const { safelyMigrate } = await import('@store/migration/migration.service.js');
        await safelyMigrate();
        const map = await readKey('ebgeo_maps', 'Operacao');
        expect(await readKey('ebgeo_app_settings', 'schemaVersion')).toBe('3.0');
        expect(await readKey('ebgeo_images', map.features.images[0].properties.id))
            .toEqual(new Uint8Array([137, 80, 78, 71]));
    });

    it('retoma apos falha ao gravar o mapa sem romper referencias de grupos e camadas', async () => {
        const ns = await import('@store/atlas-namespace.js');
        const { legacyScope } = await import('@store/migration/migration-scope.js');
        const { migrateToV2 } = await import('@store/migration/v1-to-v2.migration.js');
        const maps = ns.getStoreFor(ns.StoreName.MAPS, legacyScope());
        await maps.ready();
        const write = vi.spyOn(maps, 'setItem').mockRejectedValueOnce(new Error('falha de disco simulada'));
        await expect(migrateToV2()).rejects.toThrow('falha de disco simulada');
        write.mockRestore();
        // Novo carregamento dos modulos: so o IndexedDB sobrevive ao fechamento da aba.
        vi.resetModules();
        const { safelyMigrate } = await import('@store/migration/migration.service.js');
        await safelyMigrate();
        const map = await readKey('ebgeo_maps', 'Operacao');
        const feature = map.features.images[0];
        const layers = await readKey('ebgeo_layers', 'layers_Operacao');
        const groups = await readKey('ebgeo_groups', 'Operacao');
        expect.soft(layers.map(layer => layer.id)).toContain(feature.properties.layerId);
        expect.soft(groups[feature.properties.groupId]?.features[0]?.id).toBe(feature.properties.id);
    });

    it('registro 2.0 sem marcador de settings ainda recebe o backfill 2.1', async () => {
        await seedDatabase('ebgeo_app_settings', { schemaVersion: null });
        await seedDatabase('ebgeo_atlas', { current_atlas: {
            id: 'atlas-antigo', name: 'Acervo antigo', schemaVersion: '2.0'
        } });
        await seedDatabase('ebgeo_maps', { Operacao: { features: { points: [{
            type: 'Feature', geometry: { type: 'Point', coordinates: [-47, -15] },
            properties: { id: 'ponto-antigo' }
        }] } } });
        const { safelyMigrate } = await import('@store/migration/migration.service.js');
        await safelyMigrate();
        const map = await readKey('ebgeo_maps', 'Operacao');
        expect(map.features.points[0].properties.sizeCreatedAtZoom).toBe(10);
    });

    it('aba main aberta e aba nova nao recebem permissao simultanea de escrita', async () => {
        // Codigo real da main publicada, preservado na fixture pelo commit.
        const source = readFileSync(new URL('../fixtures/migration-review/tab-lock-main-8b611113.txt', import.meta.url), 'utf8');
        const old = runInNewContext(
            source.replace('export function initTabLock', 'function initTabLock')
            + '\n({ initTabLock, active: () => isActive, close: () => channel?.close() })',
            { BroadcastChannel, setTimeout }
        );
        const { createTabLock, localAtlasKey } = await import('@utils/tab-lock.js');
        let lock;
        try {
            old.initTabLock();
            await new Promise(resolve => setTimeout(resolve, 1550));
            expect(old.active()).toBe(true);
            lock = createTabLock({ overlayHost: null, autoPulse: false, settleMs: 50 });
            // Este caso mede a compatibilidade do protocolo no canal real. Sob a
            // suite paralela a entrega pode levar mais que os 50 ms injetados;
            // aguarde o PONG real antes de afirmar sobre a arbitragem.
            await expect.poll(() => lock.legacyPeerDetected, { timeout: 5000 }).toBe(true);
            const acquired = await lock.acquire(localAtlasKey('atlas-local-legado'));
            expect(acquired.degraded).toBe(false);
            expect({ antigaEditavel: old.active(), novaEditavel: acquired.granted })
                .not.toEqual({ antigaEditavel: true, novaEditavel: true });
        } finally {
            lock?.destroy();
            old.close();
        }
    });
});
