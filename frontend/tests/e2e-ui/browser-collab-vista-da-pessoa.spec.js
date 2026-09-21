// Path: e2e-ui/browser-collab-vista-da-pessoa.spec.js

/**
 * O MAPA BASE E O INTERRUPTOR TEMPORAL SÃO VISTA DA PESSOA: dois navegadores reais e o backend
 * real (decisão do dono, 2026-09-20).
 *
 * O DEFEITO DE PRODUTO QUE ESTE ARQUIVO PRENDE. Escolher mapa base e ligar a linha do tempo eram
 * escritas sincronizadas, então o gesto de UMA pessoa repintava a tela de TODAS. Os testes de
 * unidade e de integração provam cada metade isolada (o controle não grava, o handler remoto não
 * repinta, o patch de config não leva o interruptor da tela); só aqui se mede a cadeia inteira,
 * que é onde a propagação voltaria sem nenhum deles acusar, por exemplo por um caminho novo de
 * escrita que ninguém censou.
 *
 * COMO SE PROVA UMA AUSÊNCIA SEM ESPERAR POR TEMPO. "A tela do par não mudou" medido logo depois
 * do gesto passaria verde mesmo com a propagação inteira de pé, porque a op ainda estaria na fila.
 * Então cada caso põe uma SENTINELA depois do gesto: um ponto desenhado por A, que É sincronizado.
 * A fila de saída é FIFO, de modo que quando o ponto chega a B qualquer op anterior de base ou de
 * temporal já teria chegado também. A ausência é lida DEPOIS da sentinela, e além da tela ela é
 * lida no BANCO, que é o caminho independente: `maps.base_layer`, `maps.temporal_config` e o log
 * de operações do mapa.
 *
 * O terceiro caso é o lado positivo do mesmo contrato: salvar posição LEVA a base e o interruptor
 * ao servidor num lote só, e mesmo assim NÃO mexe na tela de quem já está no mapa.
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';
import { drawPointUI, pollPeerFeature } from './helpers/collab-helpers.js';

const MAPA = 'Mapa Tático';

/** O que está DESENHADO: a crença do controle, que ele reescreve depois de todo fallback. */
const baseNaTela = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return store.getControl('BaseLayerControl')?.currentLayer ?? null;
});

const temporalNaTela = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return store.isMapTemporalEnabledSync();
});

const idDoMapa = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return store.getCurrentMapIdSync();
});

/** Escolhe uma base pelo seletor REAL, que é o gesto do usuário. */
async function escolherBaseUI(page, layerId) {
    await page.locator('#base-layer-selector .base-layer-collapsed').click();
    const opcao = page.locator(`#base-layer-selector .base-layer-option[data-layer-id="${layerId}"]`);
    await expect(opcao).toBeVisible({ timeout: 10000 });
    await opcao.click();
    await expect.poll(() => baseNaTela(page), { timeout: 20000 }).toBe(layerId);
}

/** Uma base que o catálogo desta pessoa oferece e que não é a que está na tela. */
const outraBase = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    const controle = store.getControl('BaseLayerControl');
    return controle.availableBasemaps.find((id) => id !== controle.currentLayer) ?? null;
});

/** A sentinela: um gesto de A que É sincronizado, esperado em B. */
async function sentinela(A, B, lngLat) {
    const id = await drawPointUI(A, lngLat);
    expect(id, 'o ponto sentinela foi criado').toBeTruthy();
    await pollPeerFeature(B, 'points', id);
}

collabTest.describe('Vista da pessoa: base e interruptor temporal não propagam', () => {
    collabTest('A troca o mapa base: a tela de B e o banco não mudam', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];
        const mapId = await idDoMapa(A);
        const baseDeB = await baseNaTela(B);
        const baseNoBanco = (await collab.db.queryEntityRow('maps', mapId)).base_layer;

        const alvo = await outraBase(A);
        expect(alvo, 'o catálogo de teste oferece ao menos duas bases').toBeTruthy();
        expect(alvo).not.toBe(baseDeB);
        await escolherBaseUI(A, alvo);

        await sentinela(A, B, [-47.9, -15.8]);

        expect(await baseNaTela(B), 'a tela de B continua com a base que B tinha').toBe(baseDeB);
        expect((await collab.db.queryEntityRow('maps', mapId)).base_layer).toBe(baseNoBanco);
        const ops = await collab.db.queryOperationsByEntity(mapId);
        expect(ops.filter((op) => op.entity_type === 'baseLayer' || op.client_entity_type === 'baseLayer'),
            'escolher base não pode virar operação').toEqual([]);
    });

    collabTest('A liga a linha do tempo: a de B continua desligada e a config do banco não muda', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];
        const mapId = await idDoMapa(A);
        expect(await temporalNaTela(B)).toBe(false);

        await A.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        await expect(A.locator('.maps-tab #current-map-name-input')).not.toHaveValue('', { timeout: 15000 });
        const relogio = A.locator('#current-map-temporal-btn');
        await relogio.click();
        await expect(relogio).toHaveAttribute('data-temporal', 'true', { timeout: 15000 });
        await expect(A.locator('.temporal-bar')).toHaveAttribute('data-hidden', 'false', { timeout: 15000 });

        await sentinela(A, B, [-47.8, -15.7]);

        expect(await temporalNaTela(B), 'B nunca tocou no interruptor').toBe(false);
        await expect(B.locator('.temporal-bar')).toHaveAttribute('data-hidden', 'true');
        const linha = await collab.db.queryEntityRow('maps', mapId);
        expect(linha.temporal_config?.ativo === true, 'o valor SALVO não foi tocado pelo interruptor').toBe(false);
    });

    collabTest('a JANELA temporal continua sincronizada, e chega a B sem ligar a linha do tempo dele', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        // A interleaving que devolveria a propagação: A liga na PRÓPRIA tela e depois edita a janela.
        // O payload da config tem de levar o `ativo` SALVO (falso), nunca o da tela de A.
        await A.evaluate(async (mapa) => {
            const store = await import('/src/js/store/index.js');
            store.setMapTemporalView(mapa, true);
            await store.setMapTemporalConfig(mapa, { unidade: 'SEMANA', inicio: 1700000000000, fim: 1700003600000 });
        }, MAPA);

        await expect.poll(() => B.evaluate(async (mapa) => {
            const store = await import('/src/js/store/index.js');
            const cfg = await store.getMapTemporalConfig(mapa);
            return cfg.unidade === 'SEMANA' ? cfg.inicio : null;
        }, MAPA), { timeout: 20000 }).toBe(1700000000000);

        expect(await temporalNaTela(B), 'a janela chegou; o interruptor de B não').toBe(false);
        expect(await temporalNaTela(A), 'e a tela de quem editou continua ligada').toBe(true);
    });

    collabTest('salvar posição LEVA base e interruptor ao servidor, e NÃO mexe na tela de quem já está no mapa', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];
        const mapId = await idDoMapa(A);
        const baseDeB = await baseNaTela(B);

        const alvo = await outraBase(A);
        await escolherBaseUI(A, alvo);
        await A.evaluate(async (mapa) => {
            const store = await import('/src/js/store/index.js');
            store.setMapTemporalView(mapa, true);
        }, MAPA);

        await A.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        const cartao = A.locator(`.maps-tab .map-list-item[data-map-name="${MAPA}"]`);
        await cartao.locator('.menu-btn').click();
        const salvar = A.locator('.map-context-menu-item', { hasText: /Salvar posição|Atualizar posição/ });
        await expect(salvar).toBeVisible({ timeout: 5000 });
        await salvar.click();

        // O servidor recebe a vista INTEIRA.
        await expect.poll(async () => (await collab.db.queryEntityRow('maps', mapId)).base_layer,
            { timeout: 30000 }).toBe(alvo);
        const linha = await collab.db.queryEntityRow('maps', mapId);
        expect(linha.temporal_config?.ativo).toBe(true);
        expect(linha.center_lat).not.toBeNull();
        // E num LOTE só: a unidade que o servidor aplica ou recusa inteira.
        const ops = (await collab.db.queryOperationsByEntity(mapId)).filter((op) => op.batch_id);
        const lotesDaVista = new Set(ops.map((op) => op.batch_id));
        expect(lotesDaVista.size, 'posição, base e temporal saem sob UM batchId').toBe(1);
        expect(ops.length).toBe(3);

        // O documento de B converge (vale na PRÓXIMA entrada dele)...
        await expect.poll(() => B.evaluate(async (mapa) => {
            const store = await import('/src/js/store/index.js');
            return store.getCurrentBaseLayer(mapa);
        }, MAPA), { timeout: 20000 }).toBe(alvo);
        // ...e a TELA de B não foi tocada: ninguém é movido pelo salvamento de um colega.
        expect(await baseNaTela(B)).toBe(baseDeB);
        expect(await temporalNaTela(B)).toBe(false);
    });
});
