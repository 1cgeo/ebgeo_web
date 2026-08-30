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
 * 3. A TROCA AO VIVO E CRONOMETRADA ATE DEPOIS DO FIM DELA, de proposito. A chamada so volta ao
 *    Node depois de `switchAtlas` resolver, o que so acontece depois do `switchMap` e da releitura
 *    de aparencia, e so ENTAO o criterio comum e conferido. A recarga para no criterio comum e
 *    nada mais. Ou seja, a medida da troca ao vivo e um TETO e a da recarga e um piso: o ganho
 *    relatado e o menor que os dados sustentam, nunca o maior.
 *
 * ============================ O GANCHO, PORQUE NAO HA GESTO ==================================
 *
 * A METADE AO VIVO CHAMA `globalThis.__ebgeoSwitchAtlas`, o gancho sem interface instalado por
 * `index.js`, E ISSO E UMA LIMITACAO DECLARADA, NAO UM ATALHO. Entre 2026-08-26 e 2026-08-30 esta
 * bancada dirigia o PRODUTO: abria o menu do avatar, clicava em "Seus atlas" e clicava no cartao
 * do destino, porque aquele clique abria um modal de troca ao vivo. O dono RECUSOU aquele modal em
 * 2026-08-30 e "Seus atlas" voltou a navegar para `atlas.html`, entao o gesto que esta metade
 * exercitava deixou de existir, junto com a serie `aPorta` que cronometrava abri-lo.
 *
 * O QUE ISSO CUSTA A HONESTIDADE DO NUMERO, dito em voz alta: o que este arquivo mede e que a
 * FUNCAO e mais barata que a recarga, e nao que alguem hoje colha essa economia pela tela. Nenhum
 * gesto do produto aciona `switchAtlas`; a troca que uma pessoa faz e a recarga, pela pagina de
 * atlas. A medida continua valendo para o que ela sempre respondeu (quanto custa a recarga, e
 * quanto dela e evitavel), e deixa de sustentar qualquer frase sobre ganho ENTREGUE.
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

        const porRecarga = [];
        const aoVivo = [];
        const soOBoot = [];

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

            // ---------- A TROCA AO VIVO: B -> A, PELO GANCHO ----------
            const t1 = Date.now();
            const trocou = await page.evaluate(
                (id) => globalThis.__ebgeoSwitchAtlas('remote', id),
                semente.a.atlasId
            );
            // A TROCA ACONTECEU DE VERDADE, e nao so devolveu cedo. `esperarAtlasPronto` prova a
            // chegada pela barra de enderecos e pelo mapa; esta linha prova que a funcao afirma o
            // mesmo. Uma troca que devolvesse `changed: false` (o no-op) chegaria ao criterio de
            // parada sem ter feito trabalho nenhum, e a medida seria de um caminho vazio.
            expect(trocou).toEqual({ ok: true, changed: true });
            await esperarAtlasPronto(page, semente.a.atlasId, semente.a.mapId);
            aoVivo.push(Date.now() - t1);
        }

        const medianaRecarga = mediana(porRecarga);
        const medianaAoVivo = mediana(aoVivo);
        const medianaBoot = mediana(soOBoot);
        const linha = [
            `troca POR RECARGA: ${porRecarga.map(Math.round).join(' / ')} ms (mediana ${medianaRecarga} ms)`,
            `troca AO VIVO (switchAtlas pelo gancho, SEM gesto no produto):`
                + ` ${aoVivo.map(Math.round).join(' / ')} ms (mediana ${medianaAoVivo} ms)`,
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

        // A CONFERENCIA DO INSTRUMENTO. Ela mudou de forma em 2026-08-26, e a razao e que a
        // primeira versao tinha a PREMISSA ERRADA.
        //
        // Ela afirmava que "recarga menos boot do mapa" e "troca ao vivo" mediam o mesmo termo por
        // caminhos independentes, e exigia que concordassem dentro de 60%. NAO MEDEM. A recarga
        // paga DOIS boots, nao um: o da pagina de atlas, onde a pessoa escolhe, e o da pagina do
        // mapa, para onde ela volta. Subtrair so o segundo deixa o primeiro inteiro dentro da
        // conta, e a troca ao vivo nao paga nenhum dos dois.
        //
        // O erro so apareceu quando o conserto ficou BOM: numa maquina livre a troca ao vivo caiu
        // para 1010 ms contra 2864 ms de recarga-menos-boot, e a conferencia reprovou por 65%.
        // Ou seja, ela reprovava o produto por ter melhorado. Um instrumento que dispara quando a
        // coisa medida melhora esta medindo outra coisa.
        //
        // O QUE SOBROU E O QUE DE FATO DISCRIMINA, e as tres afirmacoes juntas ainda pegam o
        // defeito que a versao antiga existia para pegar (um cronometro apontado para o alvo
        // errado): a troca ao vivo tem de ser POSITIVA (zero significa que o marco de chegada
        // resolveu antes de o trabalho comecar), tem de ser MENOR que recarga-menos-boot (porque
        // ela pula tambem o boot da pagina de atlas), e as duas tem de ficar dentro de uma ordem
        // de grandeza (fora disso, alguem esta cronometrando outra pagina).
        const semBoot = medianaRecarga - medianaBoot;
        expect(medianaAoVivo, 'troca ao vivo em zero: o marco de chegada resolveu cedo demais')
            .toBeGreaterThan(50);
        expect(medianaAoVivo, `troca ao vivo (${medianaAoVivo} ms) nao pode custar mais que `
            + `recarga-menos-boot (${semBoot} ms): ela pula tambem o boot da pagina de atlas`)
            .toBeLessThan(semBoot);
        expect(semBoot / medianaAoVivo, `recarga-menos-boot (${semBoot} ms) e troca ao vivo `
            + `(${medianaAoVivo} ms) estao a mais de uma ordem de grandeza: um dos dois cronometros `
            + 'esta medindo outra coisa').toBeLessThan(10);

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
