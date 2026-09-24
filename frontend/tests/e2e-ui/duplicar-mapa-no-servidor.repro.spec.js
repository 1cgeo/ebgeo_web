// Path: e2e-ui/duplicar-mapa-no-servidor.repro.spec.js

/**
 * @fileoverview "DUPLICAR" UM MAPA NUM ATLAS DE SERVIDOR: a copia chega inteira ao servidor e ao par.
 *
 * O DEFEITO, MEDIDO EM 2026-09-23. `MapManager.copyMap` (`map/map.manager.js`) compunha a copia no
 * cliente: as CAMADAS por uma escrita crua de repositorio (`duplicateMapLayers`), antes de o mapa
 * existir e sem op nenhuma, e as feicoes DENTRO do documento entregue a `addMap`, cujo map CREATE o
 * servidor nao le para criar feicao. Resultado medido: no Postgres a copia tinha uma camada padrao e
 * ZERO feicoes (o F5 mostrava a copia vazia), no disco do autor a feicao apontava para uma camada
 * que nunca existiu, e o par recebia a feicao pelo envelope, igualmente orfa. O spec que ja' existe
 * (`browser-map-dup-snapshot`) so' conta os REGISTROS de mapa; ninguem olhava o conteudo da copia.
 *
 * O CONSERTO (decisao do coordenador, opcao a): num atlas de servidor "Duplicar" chama a rota REST
 * de duplicacao, uma das excecoes estruturais declaradas, e o autor recebe a copia pelo mesmo
 * caminho do par (o retrato). Sem conexao, o comando continua desenhado e o clique recusa nomeando
 * o estado.
 *
 * O GESTO, pela tela: A desenha uma linha e duplica o mapa pelo menu do cartao. O veredito e' o
 * conteudo da copia no Postgres (camadas e feicoes do mapa novo), no disco de A e no de B, e de
 * novo nos dois depois de um F5.
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

/** Duplica o mapa pelo menu do cartao, na aba Mapas, com o nome pedido. */
async function duplicarUI(page, mapa, nome) {
    if (!(await page.locator('.maps-tab').isVisible().catch(() => false))) await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    const cartao = page.locator(`.maps-tab .map-list-item[data-map-name="${mapa}"]`);
    await expect(cartao).toBeVisible({ timeout: 15000 });
    await cartao.locator('.menu-btn').click();
    await page.locator('.map-context-menu .map-context-menu-item', { hasText: 'Duplicar' }).click();
    const campo = page.locator('.prompt-modal-input');
    await expect(campo).toBeVisible({ timeout: 5000 });
    await campo.fill(nome);
    await page.locator('.prompt-modal-btn-confirm').click();
}

/** F5 de verdade: a barra de enderecos carrega `?atlas=`, e o boot reabre o atlas por ela. */
async function recarregar(page) {
    await page.reload();
    await expect(page.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
}

collabTest.describe('Duplicar mapa num atlas de servidor', () => {
    collabTest('a copia leva camada e feicao ao servidor, ao par e ao F5', async ({ collab }) => {
        collabTest.setTimeout(240000);
        const A = collab.author;
        const B = collab.peers[0];

        const linha = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]]);
        await collab.expectFullSync({ entityId: linha, type: 'lines', operationType: 'create' });
        await A.keyboard.press('Escape');

        await duplicarUI(A, collab.mapName, NOME_COPIA);

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
        expect.soft(copiaB?.feicoes?.every((f) => copiaB.camadas.includes(f.camada)),
            'no par, a feicao da copia aponta para uma camada da copia').toBe(true);
        expect.soft(copiaA.chave, 'a copia no disco de A e o mapa do servidor').toBe(mapaCopia);

        // F5 NOS DOIS: a copia sobrevive com a feicao e a camada.
        for (const [rotulo, page] of [['A', A], ['B', B]]) {
            await recarregar(page);
            let depois = null;
            await expect.poll(async () => {
                depois = await conteudoNoDisco(page, NOME_COPIA);
                return depois?.feicoes?.length ?? 0;
            }, { timeout: 30000 }).toBe(1).catch(() => {});
            console.log(`
===== ${rotulo} DEPOIS DO F5 =====
${JSON.stringify(depois, null, 2)}
`);
            expect.soft(depois?.feicoes?.length, `a copia tem a feicao em ${rotulo} depois do F5`).toBe(1);
            expect.soft(depois?.feicoes?.every((f) => depois.camadas.includes(f.camada)),
                `em ${rotulo} depois do F5, a feicao aponta para uma camada da copia`).toBe(true);
        }
    });

    collabTest('sem conexao, Duplicar recusa nomeando o estado e nao cria nada', async ({ collab }) => {
        collabTest.setTimeout(120000);
        const A = collab.author;
        const mapasAntes = (await collab.db.raw.any('SELECT id FROM maps WHERE atlas_id = $1 AND deleted_at IS NULL', [collab.atlasId])).length;

        // A rede cai. O socket so' percebe no batimento seguinte, entao o clique pode chegar com o
        // cliente ainda achando que esta' conectado; os dois caminhos tem de dar a mesma recusa.
        await A.context().setOffline(true);
        await duplicarUI(A, collab.mapName, 'Copia sem rede');
        const aviso = A.locator('.toast', { hasText: 'Sem conexão com o servidor' });
        await expect(aviso).toBeVisible({ timeout: 10000 });
        console.log(`AVISO: ${await aviso.first().innerText()}`);
        expect(await conteudoNoDisco(A, 'Copia sem rede'), 'nenhuma copia local sem rede').toBeNull();

        await A.context().setOffline(false);
        await expect(A.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
        expect((await collab.db.raw.any('SELECT id FROM maps WHERE atlas_id = $1 AND deleted_at IS NULL', [collab.atlasId])).length,
            'nenhum mapa novo no servidor').toBe(mapasAntes);
    });
});
