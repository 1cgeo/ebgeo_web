// Path: e2e-ui/migracao-cortina-do-boot.repro.spec.js

/**
 * @fileoverview A TELA DE PROGRESSO DA MIGRAÇÃO LEVAVA A CORTINA DO BOOT JUNTO, e o mapa terminava
 * de montar exposto e clicável.
 *
 * O DEFEITO. `runLegacyUpgradeGate` (`ui/migration-recovery.js`) arma o cartão "Preparando seus
 * dados", e o cartão aparece quando a cópia do acervo antigo manda o primeiro tique de progresso
 * (`showNow`) ou quando o portão passa de 700 ms. Ao aparecer, `makeScreen` REMOVIA o
 * `#initial-loader` do documento, e nada o devolvia quando o portão terminava bem. A cortina
 * existe para cobrir o boot até `renderBootMap` (`map_sig.js`) terminar `switchMap`, que é quem
 * cria as fontes de feição; sem ela, o resto do boot (estilo, store, `setupMapFeatures`, alguns
 * segundos num acervo grande) corre com a barra de ferramentas na mão da pessoa.
 *
 * QUEM CAI NISSO: TODO usuário que chega do `main` com dados, no primeiro carregamento da
 * integração, em qualquer navegador, porque a cópia do acervo sempre manda tique de progresso. E
 * qualquer máquina lenta em que o portão, mesmo sem acervo, passe dos 700 ms.
 *
 * O QUE CUSTAVA, medido no pacote de produção no WebKit (onde o portão passa de 700 ms nesta
 * máquina mesmo sem acervo): um ponto desenhado na janela exposta, 12 tentativas em série. Em 8 o
 * ponto ficou, mas o painel de atributos lançou "Error during batch save" (a fonte `points` ainda
 * não existia); em 2 o ponto SUMIU sem aviso nenhum (nem no disco, nem na fonte); em 1 sumiu com
 * o aviso FALSO "O mapa de origem não está mais aberto. O desenho não foi salvo em outro atlas.",
 * porque o escopo ativo ainda estava sendo montado. Chromium e Firefox, sem acervo, não abriam a
 * janela nesta máquina: a ferramenta, carregada por `import()`, ficava pronta depois das fontes.
 *
 * O QUE ESTE SPEC PRENDE é o invariante, e não a corrida: em nenhuma amostra do boot a página pode
 * estar SEM cortina, SEM o cartão de migração e SEM a fonte de feições ao mesmo tempo. A amostra
 * começa a contar só depois de a cortina ter sido vista uma vez, porque antes disso o HTML ainda
 * não foi lido. O acervo semeado é o da fixture 2.2 de produção, então o tique de progresso é
 * certo e a interleaving perdedora é determinística.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { buildLegacyEntries, LEGACY_STORE_IDS, loadEbgeoFixture } from '../helpers/ebgeo-fixture.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
test.describe.configure({ retries: 0 });

/** Documento vazio da MESMA origem, para semear o IndexedDB com o app sem bootar. */
const BLANK_PATH = '/__seed-cortina__';

describeOrSkip('A cortina do boot sobrevive à tela de progresso da migração', () => {
    test('com acervo antigo para copiar, o mapa nunca fica exposto antes das fontes de feição', async ({ page }) => {
        test.setTimeout(240000);
        const fixture = await loadEbgeoFixture('01-completo.ebgeo');
        const entries = buildLegacyEntries(fixture, { imageValue: bytes => Array.from(bytes), now: 1755000000000 });

        await page.route(`**${BLANK_PATH}`, route => route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><meta charset="utf-8"><title>semeadura</title>',
        }));
        await page.goto(BLANK_PATH);
        await page.evaluate(async ({ porStore, ids }) => {
            const ns = await import('/src/js/store/atlas-namespace.js');
            const legado = ns.localScope('legacy-workspace', ns.LEGACY_DB_SUFFIX);
            for (const id of ids) {
                const store = ns.getStoreFor(id, legado);
                for (const [chave, valor] of Object.entries(porStore[id] ?? {})) {
                    await store.setItem(chave, id === 'images' ? new Blob([new Uint8Array(valor)], { type: 'image/png' }) : valor);
                }
            }
        }, { porStore: entries, ids: LEGACY_STORE_IDS });

        // A sonda nasce antes de o documento ser lido e para quando a fonte de feições existe.
        await page.addInitScript(() => {
            const amostras = [];
            globalThis.__amostrasDaCortina = amostras;
            const t0 = performance.now();
            const amostrar = () => {
                const mapa = globalThis.__ebgeoMap;
                const pontos = !!mapa?.getSource?.('points');
                amostras.push({
                    t: Math.round(performance.now() - t0),
                    cortina: !!document.getElementById('initial-loader'),
                    cartao: !!document.querySelector('[data-testid="migration-recovery"]'),
                    pontos,
                });
                if (!pontos && amostras.length < 20000) setTimeout(amostrar, 5);
            };
            amostrar();
        });
        await page.goto('/');
        await expect.poll(() => page.evaluate(() => globalThis.__amostrasDaCortina?.at(-1)?.pontos === true),
            { timeout: 120000, message: 'a fonte de feições nunca apareceu' }).toBe(true);

        const amostras = await page.evaluate(() => globalThis.__amostrasDaCortina);
        const primeiraComCortina = amostras.findIndex(a => a.cortina);
        expect(primeiraComCortina, 'a cortina do boot chegou a existir').toBeGreaterThanOrEqual(0);
        // CONTROLE DO INSTRUMENTO: o cartão de progresso apareceu. Sem ele o caso mede um boot sem
        // migração, e o verde abaixo não diria nada sobre o defeito.
        expect(amostras.some(a => a.cartao), 'o cartão "Preparando seus dados" apareceu').toBe(true);

        const expostas = amostras.slice(primeiraComCortina).filter(a => !a.cortina && !a.cartao && !a.pontos);
        const resumo = expostas.length
            ? `de ${expostas[0].t} ms a ${expostas.at(-1).t} ms (${expostas.length} amostras)`
            : 'nenhuma';
        console.log(`[cortina] amostras=${amostras.length} expostas=${resumo}`);
        expect(expostas, `o mapa ficou sem cortina e sem fontes de feição: ${resumo}`).toEqual([]);
    });
});
