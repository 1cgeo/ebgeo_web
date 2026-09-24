// Path: e2e-ui/duplicar-mapa-no-servidor.repro.spec.js

/**
 * @fileoverview "DUPLICAR" UM MAPA NUM ATLAS DE SERVIDOR: a copia chega inteira ao servidor e ao par.
 *
 * A HIPOTESE. `MapManager.copyMap` (`map/map.manager.js`) duplica as CAMADAS do mapa
 * (`duplicateMapLayers`) ANTES de criar o mapa novo (`addMap`), e so' depois os grupos. Num atlas
 * de servidor a escrita de camada e' GESTO e passa pela porta que recusa escrever em mapa que nao
 * existe (`store/mapa-inexistente.js`), entao a copia pode nascer sem as camadas, com feicoes que
 * apontam para ids de camada que nunca existiram. O spec que ja' existe (`browser-map-dup-snapshot`)
 * so' conta os REGISTROS de mapa; ninguem olhava o conteudo da copia.
 *
 * O GESTO, pela tela: A desenha uma linha e duplica o mapa pelo menu do cartao. O veredito e' o
 * conteudo da copia em tres lugares: o Postgres (camadas e feicoes do mapa novo), o disco de B, e o
 * disco de A depois de um F5.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test duplicar-mapa-no-servidor --retries=0 --workers=1
 */

import { collabTest, expect, drawLineUI } from './helpers/collab.fixtures.js';

const NOME_COPIA = 'Mapa Tático (cópia)';

/** O conteudo de um mapa no disco, pelo NOME: camadas e feicoes (id e camada de cada uma). */
const conteudoNoDisco = (page, nome) => page.evaluate(async (n) => {
    const { getRepository, getAllMapKeysCompat } = await import('/src/js/store/repositories/index.js');
    const repo = getRepository();
    for (const chave of (await getAllMapKeysCompat()) ?? []) {
        const doc = await repo.getMap(chave);
        if (doc?.name !== n) continue;
        const camadas = (await repo.getLayers?.(chave)) ?? [];
        const feicoes = Object.values(doc.features ?? {}).flat().filter(Boolean)
            .map((f) => ({ id: f.properties?.id, camada: f.properties?.layerId ?? null }));
        return { chave, camadas: (Array.isArray(camadas) ? camadas : Object.values(camadas)).map((l) => l.id), feicoes };
    }
    return null;
}, nome);

collabTest.describe('Duplicar mapa num atlas de servidor', () => {
    collabTest('a copia leva camada e feicao ao servidor, ao par e ao F5', async ({ collab }) => {
        collabTest.setTimeout(240000);
        const A = collab.author;
        const B = collab.peers[0];

        const linha = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]]);
        await collab.expectFullSync({ entityId: linha, type: 'lines', operationType: 'create' });
        await A.keyboard.press('Escape');

        // Duplicar pelo menu do cartao do mapa, na aba Mapas.
        if (!(await A.locator('.maps-tab').isVisible().catch(() => false))) await A.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        const cartao = A.locator(`.maps-tab .map-list-item[data-map-name="${collab.mapName}"]`);
        await expect(cartao).toBeVisible({ timeout: 15000 });
        await cartao.locator('.menu-btn').click();
        await A.locator('.map-context-menu .map-context-menu-item', { hasText: 'Duplicar' }).click();
        const campo = A.locator('.prompt-modal-input');
        await expect(campo).toBeVisible({ timeout: 5000 });
        await campo.fill(NOME_COPIA);
        await A.locator('.prompt-modal-btn-confirm').click();

        // A copia existe no disco de A.
        let copiaA = null;
        await expect.poll(async () => {
            copiaA = await conteudoNoDisco(A, NOME_COPIA);
            return copiaA?.feicoes?.length ?? 0;
        }, { timeout: 20000, message: 'a copia nunca apareceu no disco de A' }).toBe(1);

        // O servidor.
        const idCopia = async () => (await collab.db.raw.oneOrNone(
            'SELECT id FROM maps WHERE atlas_id = $1 AND name = $2 AND deleted_at IS NULL', [collab.atlasId, NOME_COPIA]))?.id ?? null;
        await expect.poll(idCopia, { timeout: 30000, message: 'o mapa copiado nunca chegou ao servidor' }).toBeTruthy();
        const mapaCopia = await idCopia();
        await expect.poll(async () => (await collab.db.raw.any(
            'SELECT id FROM features WHERE map_id = $1 AND deleted_at IS NULL', [mapaCopia])).length,
        { timeout: 30000 }).toBeGreaterThan(0).catch(() => {});
        const servidor = {
            camadas: (await collab.db.raw.any('SELECT id FROM layers WHERE map_id = $1 AND deleted_at IS NULL', [mapaCopia])).map((r) => r.id),
            feicoes: await collab.db.raw.any('SELECT id, layer_id FROM features WHERE map_id = $1 AND deleted_at IS NULL', [mapaCopia]),
        };

        // O par.
        let copiaB = null;
        await expect.poll(async () => {
            copiaB = await conteudoNoDisco(B, NOME_COPIA);
            return copiaB?.feicoes?.length ?? 0;
        }, { timeout: 30000 }).toBe(1).catch(() => {});

        console.log(`\n===== RETRATO =====\n${JSON.stringify({ copiaA, servidor, copiaB }, null, 2)}\n`);

        expect.soft(copiaA.camadas.length, 'a copia tem camada no disco de A').toBeGreaterThan(0);
        expect.soft(copiaA.feicoes.every((f) => copiaA.camadas.includes(f.camada)),
            'toda feicao da copia aponta para uma camada da copia, no disco de A').toBe(true);
        expect.soft(servidor.feicoes.length, 'a feicao da copia chegou ao servidor').toBe(1);
        expect.soft(servidor.camadas.length, 'a camada da copia chegou ao servidor').toBeGreaterThan(0);
        expect.soft(servidor.feicoes.every((f) => servidor.camadas.includes(f.layer_id)),
            'no servidor, a feicao da copia aponta para uma camada da copia').toBe(true);
        expect.soft(copiaB?.feicoes?.length, 'a copia chegou ao par com a feicao').toBe(1);
        expect.soft(copiaB?.camadas?.length ?? 0, 'a copia chegou ao par com camada').toBeGreaterThan(0);
    });
});
