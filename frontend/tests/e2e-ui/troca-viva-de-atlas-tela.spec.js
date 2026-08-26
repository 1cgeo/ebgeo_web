// Path: e2e-ui/troca-viva-de-atlas-tela.spec.js

/**
 * @fileoverview O QUE FICA VELHO NA TELA DEPOIS DE UMA TROCA DE ATLAS AO VIVO — OBSERVADO, e nao
 * deduzido de quem assina o que.
 *
 * POR QUE UM ARQUIVO SO PARA ISSO. A analise que abriu esta onda listou os paineis stale lendo as
 * ASSINATURAS de cada um (quem chama `subscribe` para qual evento). Isso responde "por que
 * ficaria velho", nunca "ficou velho": um painel pode se curar por um caminho que a leitura de
 * assinaturas nao ve (um `show()` que recarrega, um cache que expira), e outro pode continuar
 * velho apesar de assinar o evento certo. Este caso troca de atlas de verdade, no navegador, com
 * conteudo real dos dois lados, e LE A TELA.
 *
 * A FORMA E UM A/B, E ELE E O QUE TORNA O RESULTADO LEGIVEL. Uma leitura so, com a correcao ja no
 * lugar, provaria "esta limpo" sem nunca mostrar que havia sujeira — e uma tela limpa tambem e o
 * que se ve quando a troca nao aconteceu. Entao cada dimensao e lida DUAS vezes: com o aviso
 * `ATLAS_SWITCHED` DESLIGADO no barramento (`bus.offAll`), que reproduz o estado anterior a esta
 * onda, e com ele ligado, que e o produto. Desligar em tempo de execucao, em vez de editar a
 * fonte, e o que faz as duas metades rodarem no MESMO navegador contra os MESMOS atlas.
 *
 * QUATRO PASSAGENS, E NAO UMA, porque o painel lateral monta UMA aba de cada vez: abrir
 * "Briefings" DESMONTA "Camadas". Medido aqui, e nao suposto — a primeira versao deste arquivo
 * abria as duas e lia string vazia da que tinha saido, o que teria feito o "depois" parecer limpo
 * sem medir nada.
 *
 * A TROCA MEDIDA E PARA UM ATLAS LOCAL, que e o caso severo: nao existe quadro `connected` para
 * repovoar o roster de presenca, entao e a unica troca que pode deixar colegas de outro projeto
 * na tela.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { addSharedUser, openClient } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Espera a barra de enderecos e o mapa concordarem que o atlas pedido esta aberto. */
async function esperarAtlasPronto(page, atlasId, mapId) {
    await page.waitForFunction(({ id, mapa }) => {
        const p = new URLSearchParams(location.search);
        return p.get('atlas') === id && p.get('map') === mapa
            && Boolean(globalThis.__ebgeoMap?.loaded?.());
    }, { id: atlasId, mapa: mapId }, { timeout: 60000, polling: 'raf' });
}

/**
 * O texto da aba aberta e o roster de presenca, no mesmo instante.
 *
 * Os SELETORES sao os que o usuario ve, nao os involucros: `.layers-tab` e um shell vazio, e quem
 * desenha a arvore de camadas e feicoes e `.features-tab-content`. A presenca vem da store da
 * presenca porque o roster e o dado que TODAS as sobreposicoes desenham, e le-lo direto nao
 * depende de qual delas esta na tela.
 * @param {import('@playwright/test').Page} page
 * @param {string} seletor - O container da aba aberta.
 * @returns {Promise<{painel: string, presenca: string[], mapa: string|null}>}
 */
function lerTela(page, seletor) {
    return page.evaluate(async (sel) => {
        const { presenceStore } = await import('/src/js/presence/presence-store.js');
        const store = await import('/src/js/store/index.js');
        return {
            painel: [...document.querySelectorAll(sel)]
                .map((el) => el.innerText ?? '').join(' | ').trim(),
            // O DESCRITOR DO PAR VARIA DE CAMPO conforme o quadro que o criou, entao o rotulo
            // cai para o id: o que este arquivo mede e QUANTAS pessoas de outro atlas sobraram
            // no roster, nunca como elas se chamam.
            presenca: presenceStore.getUsers()
                .map((u) => u.nome || u.name || u.userId || u.clientId || u.id || '(sem nome)'),
            mapa: store.getCurrentMapNameSync(),
        };
    }, seletor);
}

/** Abre uma aba do painel lateral e espera o conteudo esperado aparecer nela. */
async function abrirAbaCom(page, aba, seletor, marca) {
    await page.locator(`.sidebar-nav-btn[data-tab="${aba}"]`).click();
    await expect
        .poll(async () => (await lerTela(page, seletor)).painel, {
            timeout: 40000,
            message: `a aba "${aba}" mostrou "${marca}"`,
        })
        .toContain(marca);
}

describeOrSkip('o que fica velho na tela depois da troca ao vivo', () => {
    test('camadas, briefings e presenca, lidos com e sem o aviso', async ({ browser }, testInfo) => {
        test.setTimeout(600000);
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);

        const dono = await createVerifiedUser({ prefix: 'tela', nome: 'Dono da tela' });
        await page.goto('/');
        const semente = await page.evaluate(async ({ base, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const api = new ApiClient({ baseUrl: `${base}/api/v1` });
            await api.login(u.username, u.password);
            const atlas = await api.createAtlas({ name: 'Atlas A da tela' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'MAPA-A' }),
                // A CAMADA NASCE NO SERVIDOR, entao chega ao cliente pelo snapshot da abertura,
                // como a de qualquer projeto de verdade.
                createOperation('layer', 'create', crypto.randomUUID(), mapId, {
                    name: 'CAMADA-SO-DO-A', visible: true, mapId
                }),
            ]);
            return { atlasId: atlas.id, mapId, mapa: 'MAPA-A' };
        }, { base: state.baseUrl, u: dono });

        // UM PAR DE VERDADE PARA A PRESENCA. O roster so tem alguem quando alguem esta la, e duas
        // abas do MESMO perfil no mesmo atlas sao justamente o que o tab-lock impede — entao o
        // par e outro usuario, com o atlas compartilhado com ele.
        const convidado = await addSharedUser(page, state.baseUrl, dono, semente.atlasId,
            { permission: 'write', label: 'convidada' });

        await page.goto(`/?atlas=${semente.atlasId}`);
        await esperarAtlasPronto(page, semente.atlasId, semente.mapId);

        // O BRIEFING NASCE PELA API DA PROPRIA STORE, com o atlas ja aberto: `createBriefing`
        // grava no escopo montado e registra a operacao de saida, que e o caminho de verdade.
        // Semear por operacao crua exigiria acertar a forma do documento por fora, e uma forma
        // errada produz um briefing que nao aparece — silencio que se leria como "limpo".
        await page.evaluate(async () => {
            const { createBriefing } = await import('/src/js/store/index.js');
            await createBriefing({ name: 'BRIEFING-SO-DO-A', description: 'so do A' });
        });

        const paginaDoPar = await openClient(browser, state.baseUrl, semente.atlasId, convidado,
            { expectMapName: semente.mapa });

        const slotLocal = await page.evaluate(async () => {
            const { listLocalAtlases } = await import('/src/js/store/local-atlas.api.js');
            return listLocalAtlases()[0]?.id ?? null;
        });
        expect(slotLocal, 'existe um slot local para onde ir').toBeTruthy();

        /**
         * Uma passagem do A/B: volta ao atlas de servidor, abre a aba, confere que o conteudo
         * daquele atlas esta na tela, troca AO VIVO para o slot local e le a tela.
         * @param {{aba: string, seletor: string, marca: string, avisoLigado: boolean}} caso
         * @returns {Promise<{painel: string, presenca: string[], mapa: string|null}>}
         */
        async function passagem({ aba, seletor, marca, avisoLigado }) {
            // A RECARGA E O QUE RESTAURA OS ASSINANTES depois de uma passagem que os desligou, e
            // e tambem o que garante que cada passagem parte do mesmo estado.
            await page.goto(`/?atlas=${semente.atlasId}`);
            await esperarAtlasPronto(page, semente.atlasId, semente.mapId);
            await abrirAbaCom(page, aba, seletor, marca);
            await expect.poll(async () => (await lerTela(page, seletor)).presenca.length,
                { timeout: 40000, message: 'o par apareceu no roster' }).toBeGreaterThan(0);

            if (!avisoLigado) {
                const n = await page.evaluate(async () => {
                    const { getEventBus } = await import('/src/js/store/services.js');
                    const bus = getEventBus();
                    const contagem = bus.listenerCount('atlas:switched');
                    bus.offAll('atlas:switched');
                    return contagem;
                });
                // CONTROLE DO PROPRIO A/B: sem assinante para desligar, as duas metades seriam a
                // mesma leitura e este arquivo nao mediria nada.
                //
                // O NUMERO E >= 2, E NAO 3, E ISSO E UMA OBSERVACAO E NAO UMA FROUXIDAO. Uma aba
                // do painel lateral so assina no seu primeiro `render()`, entao numa passagem
                // que nunca abriu "Briefings" existem dois assinantes (presenca e a aba
                // Camadas), e nao tres. Quem garante que o assinante DESTA passagem esta entre
                // eles e o `abrirAbaCom` acima: o painel mostrou o conteudo do atlas, logo ele
                // esta montado, logo ele assinou.
                expect(n, 'havia assinantes de ATLAS_SWITCHED para desligar')
                    .toBeGreaterThanOrEqual(2);
            }

            const troca = await page.evaluate(
                (id) => globalThis.__ebgeoSwitchAtlas('local', id), slotLocal
            );
            expect(troca).toMatchObject({ ok: true, changed: true });
            // A cura, quando existe, e assincrona (o painel relê da store). Dois segundos sao
            // ordens de grandeza mais do que ela precisa, e nao escondem uma ausencia de cura.
            await page.waitForTimeout(2000);
            return lerTela(page, seletor);
        }

        const CAMADAS = { aba: 'camadas', seletor: '.features-tab-content', marca: 'CAMADA-SO-DO-A' };
        const BRIEFINGS = { aba: 'briefings', seletor: '.briefings-list', marca: 'BRIEFING-SO-DO-A' };
        const camadasSem = await passagem({ ...CAMADAS, avisoLigado: false });
        const camadasCom = await passagem({ ...CAMADAS, avisoLigado: true });
        const briefSem = await passagem({ ...BRIEFINGS, avisoLigado: false });
        const briefCom = await passagem({ ...BRIEFINGS, avisoLigado: true });

        const velho = (t, marca) => (t.painel.includes(marca) ? 'VELHO' : 'limpo');
        const roster = (t) => (t.presenca.length
            ? `VELHO (${t.presenca.length} pessoa(s): ${t.presenca.join(', ')})` : 'limpo');
        const relato = [
            'depois de trocar AO VIVO de um atlas de servidor para um atlas LOCAL:',
            '',
            'DIMENSAO             | SEM o aviso ATLAS_SWITCHED | COM o aviso (produto)',
            `aba Camadas/Feicoes  | ${velho(camadasSem, CAMADAS.marca)} | ${velho(camadasCom, CAMADAS.marca)}`,
            `aba Briefings        | ${velho(briefSem, BRIEFINGS.marca)} | ${velho(briefCom, BRIEFINGS.marca)}`,
            `presenca (passagem 1)| ${roster(camadasSem)} | ${roster(camadasCom)}`,
            `presenca (passagem 2)| ${roster(briefSem)} | ${roster(briefCom)}`,
            `mapa corrente        | ${camadasSem.mapa} | ${camadasCom.mapa}`,
        ].join('\n');
        console.info(`\n[o que fica velho na troca ao vivo]\n${relato}\n`);
        await testInfo.attach('tela-apos-troca.txt', { body: relato, contentType: 'text/plain' });

        // O PRODUTO: nada do atlas de servidor sobra na tela depois de sair dele.
        expect(camadasCom.painel, 'a aba Camadas ficou com a camada do atlas anterior')
            .not.toContain(CAMADAS.marca);
        expect(briefCom.painel, 'a aba Briefings ficou com o briefing do atlas anterior')
            .not.toContain(BRIEFINGS.marca);
        expect(camadasCom.presenca, 'a presenca ficou com os colegas do atlas anterior').toEqual([]);
        expect(briefCom.presenca, 'a presenca ficou com os colegas do atlas anterior').toEqual([]);

        await paginaDoPar.context().close();
        await ctx.close();
    });
});
