// Path: e2e-ui/troca-viva-de-atlas-medida.spec.js

/**
 * @fileoverview A BANCADA DA TROCA AO VIVO. Ela nao afirma "ficou mais rapido": ela MEDE, no
 * mesmo navegador, na mesma rodada e com o mesmo instrumento, as duas formas de trocar de atlas.
 *
 * POR QUE UMA MEDIDA E NAO UMA CONTA. A troca por recarga custa o boot inteiro da pagina do mapa
 * (4203 kB de JavaScript executados), e quanto disso e rede, quanto e parse e quanto e IndexedDB
 * nao se deduz do tamanho do pacote. E a terceira possibilidade, a que este arquivo trata com o
 * cuidado maior, e o INSTRUMENTO estar errado: dois cronometros diferentes para os dois caminhos
 * produziriam um "ganho" que e so a diferenca entre eles.
 *
 * ============================ AS TRES DECISOES DO INSTRUMENTO ================================
 *
 * 1. UM RELOGIO SO, o do lado Node (`Date.now()`), envolvendo as duas medidas. O custo de uma ida
 *    e volta ao navegador (uns poucos milissegundos) entra nas DUAS, entao ele nao inclina a
 *    comparacao para nenhum lado.
 *
 * 2. O MESMO CRITERIO DE CHEGADA, e ele e um FATO DO ATLAS DE DESTINO, nao um sinal que so um dos
 *    caminhos emite: `syncEngine.atlasId` e o do destino E o mapa corrente e o mapa DAQUELE atlas.
 *    Por isso os dois atlas nascem com mapas de nomes diferentes (`MAPA-A`, `MAPA-B`), semeados
 *    pelo servidor: com o mesmo nome nos dois, o criterio pararia no atlas errado.
 *
 * 3. A TROCA AO VIVO E CRONOMETRADA ATE DEPOIS DO FIM DELA, de proposito. O clique no cartao so
 *    volta ao Node depois de a porta ter fechado, o que so acontece depois do `switchMap` e da
 *    releitura de aparencia, e so ENTAO o criterio comum e conferido. A recarga para no criterio
 *    comum e nada mais. Ou seja, a medida da troca ao vivo e um TETO e a da recarga e um piso: o
 *    ganho relatado e o menor que os dados sustentam, nunca o maior.
 *
 * ============================ O CLIQUE, E NAO O GANCHO =======================================
 *
 * A METADE AO VIVO PASSA PELO PRODUTO, e essa e a correcao que fecha a onda. Ate 2026-08-26 este
 * arquivo chamava `globalThis.__ebgeoSwitchAtlas`, o gancho sem interface instalado por
 * `index.js`. Ele media que a FUNCAO era mais barata, o que e verdade e nao e o que interessa:
 * enquanto nenhum gesto a acionava, a economia media aqui nao chegava a ninguem. Agora a metade
 * ao vivo abre o menu do avatar, clica em "Seus atlas" e clica no cartao do atlas de destino, que
 * e exatamente o que uma pessoa faz. O gancho sobrevive para a guarda de no-op no fim do caso,
 * onde o que se quer e o VALOR DE RETORNO de `switchAtlas`, e a porta nao o devolve para fora.
 *
 * A PORTA E CRONOMETRADA SEPARADO, e nao junto nem escondida. Abrir a porta custa um `import()`
 * dinamico mais um `GET /atlas`, e enfia-los na mesma medida faria a troca ao vivo parecer mais
 * cara do que ela e; deixa-los de fora sem dizer nada esconderia um custo real. Entao a serie
 * `aPorta` sai no relatorio ao lado das outras duas, e o leitor soma o que quiser somar. A
 * comparacao honesta com a recarga continua sendo a troca em si: do outro lado, o gesto completo
 * tambem tem uma etapa a mais, que e ir ate `atlas.html` e esperar aquela pagina bootar, e essa
 * etapa NAO entra na medida da recarga.
 *
 * ============================ O QUE ELE NAO MEDE ==============================================
 *
 * Isto roda sobre o Vite de desenvolvimento, com modulos servidos um a um e sem minificacao. O
 * numero ABSOLUTO daqui nao e o do pacote de producao; o que ele mede honestamente e a RAZAO
 * entre os dois caminhos na mesma bancada, que e a pergunta desta onda.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Quantas trocas de cada tipo entram na mediana. Impar, para a mediana ser um valor medido. */
const REPETICOES = 3;

/**
 * O criterio de chegada, identico para os dois caminhos.
 *
 * O PREDICADO E SINCRONO, E ISSO E UMA CORRECAO DE INSTRUMENTO, NAO ESTILO. A primeira versao
 * deste arquivo usava um predicado `async` que importava a store e lia `syncEngine.atlasId`. O
 * `waitForFunction` do Playwright NAO aguarda a promessa devolvida: ele testa a VERDADE do valor
 * de retorno, e uma promessa e sempre verdadeira. O criterio passava na primeira sondagem, sempre,
 * e as duas medidas teriam sido o tempo de uma ida e volta ao navegador — um "ganho" de instrumento
 * quebrado. O sintoma que denunciou foi outro (a asercao seguinte encontrou a pagina ainda sem o
 * gancho de medicao instalado), e sem ela o numero teria saido lindo e falso.
 *
 * O QUE ELE LE, e por que serve aos dois caminhos: a barra de enderecos. `deep-link/
 * atlas-url-sync.js` escreve `?atlas=<uuid>&map=<uuid>` REATIVAMENTE, em `CONNECTION_STATE_CHANGED`
 * e em `MAP_LOCK_CHANGED`, sem que nenhum caminho de abertura precise se lembrar dela — entao ela e
 * o mesmo marco na recarga e na troca ao vivo, e nao um sinal que so um dos dois emite. O `map=`
 * e a metade que DISCRIMINA na recarga: a URL ja chega com `atlas=` (foi ela que navegou), e o
 * `map=` so aparece quando o mapa daquele atlas ficou corrente.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} atlasId - Atlas de destino.
 * @param {string} mapId - UUID do mapa que so existe naquele atlas.
 * @returns {Promise<void>}
 */
async function esperarAtlasPronto(page, atlasId, mapId) {
    await page.waitForFunction(({ id, mapa }) => {
        const p = new URLSearchParams(location.search);
        return p.get('atlas') === id
            && p.get('map') === mapa
            && Boolean(globalThis.__ebgeoMap?.loaded?.());
    }, { id: atlasId, mapa: mapId }, { timeout: 60000, polling: 'raf' });
}

/** @param {number[]} v @returns {number} A mediana, arredondada. */
function mediana(v) {
    const ordenado = [...v].sort((a, b) => a - b);
    return Math.round(ordenado[Math.floor(ordenado.length / 2)]);
}

/**
 * ABRE A PORTA PELO GESTO, e para so quando o cartao de destino esta clicavel.
 *
 * O CRITERIO DE PARADA E O CARTAO, E NAO A MOLDURA. Esperar so o modal aparecer terminaria antes
 * de `GET /atlas` responder, e o clique seguinte cairia num vazio ou, pior, entraria na medida da
 * troca. E assim que o custo de abrir a porta se disfarcaria de custo de trocar de atlas.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} atlasId - Atlas cujo cartao precisa estar na tela.
 * @returns {Promise<import('@playwright/test').Locator>} O cartao, pronto para o clique.
 */
async function abrirPorta(page, atlasId) {
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    await page.locator('[data-testid="account-projects-btn"]').click();
    const cartao = page.locator(
        `[data-testid="atlas-switch-modal"] [data-testid="atlas-switch-item"][data-atlas-id="${atlasId}"]`
    );
    await expect(cartao).toBeVisible({ timeout: 30000 });
    return cartao;
}

describeOrSkip('a troca de atlas ao vivo contra a troca por recarga', () => {
    test('mede as duas na mesma bancada e no mesmo relogio', async ({ browser }, testInfo) => {
        test.setTimeout(420000);
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);

        const creds = await createVerifiedUser({ prefix: 'medida', nome: 'Medida' });
        await page.goto('/');
        const semente = await page.evaluate(async ({ base, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const api = new ApiClient({ baseUrl: `${base}/api/v1` });
            await api.login(u.username, u.password);
            const feito = {};
            for (const [rotulo, nomeAtlas, nomeMapa] of [
                ['a', 'Atlas A da medida', 'MAPA-A'],
                ['b', 'Atlas B da medida', 'MAPA-B'],
            ]) {
                const atlas = await api.createAtlas({ name: nomeAtlas });
                const mapId = crypto.randomUUID();
                await api.pushOperations(atlas.id, [
                    createOperation('map', 'create', mapId, null, { name: nomeMapa })
                ]);
                feito[rotulo] = { atlasId: atlas.id, mapId, mapa: nomeMapa };
            }
            return feito;
        }, { base: state.baseUrl, u: creds });

        // A CARGA INICIAL NAO ENTRA NA CONTA. Ela paga o cache frio do Vite (cada modulo servido
        // uma vez), que nao e nem a recarga nem a troca ao vivo.
        await page.goto(`/?atlas=${semente.a.atlasId}`);
        await esperarAtlasPronto(page, semente.a.atlasId, semente.a.mapId);
        // E o gancho de medicao existe: sem ele, a metade "ao vivo" nao teria como ser exercitada.
        expect(await page.evaluate(() => typeof globalThis.__ebgeoSwitchAtlas)).toBe('function');

        // E A PORTA EXISTE, antes de a bancada depender dela. Sem esta linha, um gesto que
        // deixasse de abrir a porta apareceria mais adiante como um `click` que esgotou o tempo,
        // e o relatorio culparia a troca de atlas por um defeito do menu.
        await expect(page.locator('[data-testid="account-projects-btn"]')).toBeAttached({ timeout: 30000 });

        const porRecarga = [];
        const aoVivo = [];
        const soOBoot = [];
        const aPorta = [];

        for (let i = 0; i < REPETICOES; i += 1) {
            // ---------- A TROCA POR RECARGA: A -> B ----------
            const t0 = Date.now();
            await page.goto(`/?atlas=${semente.b.atlasId}`);
            // O TERMO DO BOOT, medido dentro da propria recarga. O gancho e instalado no boot
            // IMEDIATAMENTE ANTES do roteamento que abre o atlas, entao o instante em que ele
            // aparece separa "carregar a pagina" de "abrir o atlas". E ele existe para uma
            // conferencia, nao para o relatorio: recarga menos boot tem de bater com a troca ao
            // vivo, porque as duas rodam o MESMO `openRemoteAtlas`. Duas medidas do mesmo termo
            // que discordassem seriam defeito do instrumento, nao um ganho.
            await page.waitForFunction(
                () => typeof globalThis.__ebgeoSwitchAtlas === 'function',
                null, { timeout: 60000, polling: 'raf' }
            );
            soOBoot.push(Date.now() - t0);
            await esperarAtlasPronto(page, semente.b.atlasId, semente.b.mapId);
            porRecarga.push(Date.now() - t0);

            // ---------- A PORTA: o gesto que precede a troca ao vivo ----------
            const tPorta = Date.now();
            const cartao = await abrirPorta(page, semente.a.atlasId);
            aPorta.push(Date.now() - tPorta);

            // ---------- A TROCA AO VIVO: B -> A, PELO CLIQUE ----------
            const t1 = Date.now();
            await cartao.click();
            await esperarAtlasPronto(page, semente.a.atlasId, semente.a.mapId);
            aoVivo.push(Date.now() - t1);

            // A TROCA ACONTECEU E A PORTA SAIU DA FRENTE. `esperarAtlasPronto` ja prova que a
            // barra de enderecos e o mapa concordam sobre o atlas A, o que substitui, com o mesmo
            // rigor, o `{ ok: true, changed: true }` que o gancho devolvia. Esta segunda asercao
            // e a metade que so o caminho do PRODUTO tem: uma porta que trocasse de atlas e
            // ficasse aberta por cima do mapa novo passaria na primeira e reprova nesta.
            await expect(page.locator('[data-testid="atlas-switch-modal"]')).toHaveCount(0);
        }

        const medianaRecarga = mediana(porRecarga);
        const medianaAoVivo = mediana(aoVivo);
        const medianaBoot = mediana(soOBoot);
        const medianaPorta = mediana(aPorta);
        const linha = [
            `troca POR RECARGA: ${porRecarga.map(Math.round).join(' / ')} ms (mediana ${medianaRecarga} ms)`,
            `troca AO VIVO (clique real no cartao): ${aoVivo.map(Math.round).join(' / ')} ms`
                + ` (mediana ${medianaAoVivo} ms)`,
            `  abrir a PORTA, medido a parte: ${aPorta.map(Math.round).join(' / ')} ms`
                + ` (mediana ${medianaPorta} ms)`,
            `  do qual e BOOT da pagina (so a recarga paga): ${soOBoot.map(Math.round).join(' / ')}`
                + ` ms (mediana ${medianaBoot} ms)`,
            `  recarga menos boot = ${medianaRecarga - medianaBoot} ms, contra ${medianaAoVivo} ms`
                + ` da troca ao vivo (e o MESMO openRemoteAtlas dos dois lados)`,
            `economia: ${medianaRecarga - medianaAoVivo} ms por troca`
                + ` (${(medianaRecarga / medianaAoVivo).toFixed(2)}x)`,
        ].join('\n');
        console.info(`\n[medida da troca de atlas]\n${linha}\n`);
        await testInfo.attach('medida-troca-de-atlas.txt', { body: linha, contentType: 'text/plain' });

        // O PISO E DELIBERADAMENTE FROUXO. Este caso existe para PRODUZIR o numero, e um limite
        // apertado o transformaria num guarda de desempenho que reprova por carga da maquina. O
        // que ele afirma e a direcao: eliminar a recarga nao pode sair MAIS CARO que a recarga.
        expect(medianaAoVivo).toBeLessThan(medianaRecarga);

        // A CONFERENCIA DO INSTRUMENTO, e ela vale mais que o piso acima. Os dois caminhos rodam o
        // MESMO `openRemoteAtlas`, entao "recarga menos boot" e "troca ao vivo" medem o mesmo termo
        // por dois caminhos independentes. Uma divergencia grande aqui diz que um dos dois
        // cronometros esta medindo outra coisa — que foi exatamente o defeito da primeira versao
        // deste arquivo. A folga e larga de proposito: sao medidas de mundo real, com rede e disco.
        const semBoot = medianaRecarga - medianaBoot;
        expect(Math.abs(semBoot - medianaAoVivo) / medianaAoVivo,
            `recarga-menos-boot (${semBoot} ms) e troca ao vivo (${medianaAoVivo} ms) discordam`)
            .toBeLessThan(0.6);

        // A guarda de no-op, no navegador de verdade: trocar para o atlas ja montado nao repete o
        // trabalho e nao re-carimba a reivindicacao do tab-lock.
        const noop = await page.evaluate(
            (id) => globalThis.__ebgeoSwitchAtlas('remote', id),
            semente.a.atlasId
        );
        expect(noop).toEqual({ ok: true, changed: false });

        await ctx.close();
    });
});
