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
 * ============================ AS QUATRO DECISOES DO INSTRUMENTO ==============================
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
 * 4. O HOST DE TILES DO CATALOGO QUE ESTA CAMADA NAO TEM FALHA NA HORA (desde 2026-09-23). O
 *    catalogo semeado pela migracao de catalogo aponta tres fontes para `http://localhost/tiles/...`
 *    (declividade e hipsometria, as duas com a MESMA URL de DEM, mais rodovias e municipios), com
 *    a URL declarada como placeholder, e nesta camada nada escuta a porta 80. Todo mapa RECEM-CRIADO
 *    pede as tres, e `map.loaded()` (metade do criterio de chegada) so fica verdadeiro quando elas
 *    FALHAM. Quanto demora falhar e do sistema operacional e do navegador, nao do produto: medido
 *    FORA do app nesta maquina, recusa de conexao em `localhost:80` custa de 2,0 a 2,3 s nos dois
 *    navegadores, e o Firefox 151 leva de 6,3 a 6,4 s para recusar o SEGUNDO de dois pedidos
 *    iguais em paralelo (o Chromium 149, 2,6 s), que e o que a URL de DEM repetida produz. A troca
 *    ao vivo nao paga nada disso, porque o mapa dela ja tem as tres fontes em erro. Sem esta rota,
 *    "recarga menos boot" media a recusa de conexao: no relogio da propria pagina, o trabalho
 *    depois do gancho custava de 0,5 a 1,1 s nos dois navegadores, e o Node so via o mapa
 *    carregado 6,2 s depois disso no Firefox (2,2 s no Chromium). A conferencia la embaixo
 *    reprovou o Firefox por isso, e ela estava CERTA: o cronometro da recarga media outra coisa.
 *    O preco declarado: `page.route` intercepta todo pedido da pagina, e isso muda o transporte do
 *    BOOT. No Firefox some o recuo de ~2 s do documento (o Vite desta camada escuta so em `::1`, e
 *    o Firefox tenta IPv4 primeiro): mediana do boot de 5753 para 3718 ms. No Chromium a
 *    interceptacao SOMA: de 740 para 1313 ms. Cinco rodadas de cada lado. O boot e o subtraendo, e
 *    nenhuma asercao o limita.
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
import { clienteNaPagina, sessaoDoApp } from './helpers/cliente-de-teste.js';

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
        // MapLibre may be loaded while openRemoteAtlas still rebuilds the application's
        // content. The boot curtain stops blocking only after that work finishes.
        const curtain = document.querySelector('.loading-background');
        return p.get('atlas') === id
            && p.get('map') === mapa
            && (!curtain || curtain.style.pointerEvents === 'none')
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
        // O HOST DE TILES DO CATALOGO QUE ESTA CAMADA NAO TEM FALHA NA HORA: ver a decisao 4 do
        // `fileoverview`. Sem isto, o cronometro da recarga mede quanto o sistema operacional e o
        // navegador demoram para recusar uma conexao (de 2,3 a 6,4 s), e nao a abertura do atlas.
        let recusadosNaHora = 0;
        await page.route('http://localhost/tiles/**', (route) => {
            recusadosNaHora += 1;
            return route.abort('connectionrefused');
        });

        const creds = await createVerifiedUser({ prefix: 'medida', nome: 'Medida' });
        await page.goto('/');
        const semente = await page.evaluate(async ({ api }) => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const feito = {};
            for (const [rotulo, nomeAtlas, nomeMapa] of [
                ['a', 'Atlas A da medida', 'MAPA-A'],
                ['b', 'Atlas B da medida', 'MAPA-B'],
            ]) {
                const atlas = await api.createAtlas({ name: nomeAtlas });
                // ADOTA o mapa que o servidor semeia ao criar o atlas, como `seedSharedAtlas` já
                // faz. `POST /atlas` deixou de devolver atlas vazio em 2026-09-12 (`e70ccf3c`), e
                // um segundo mapa ao lado deixa `esperarAtlasPronto` esperando por um `map=` que
                // a abertura pode não escolher.
                const mapId = atlas.map_order?.[0];
                if (!mapId) throw new Error('O servidor não criou o mapa inicial do atlas.');
                await api.pushOperations(atlas.id, [
                    createOperation('map', 'update', mapId, null, { name: nomeMapa })
                ]);
                feito[rotulo] = { atlasId: atlas.id, mapId, mapa: nomeMapa };
            }
            return feito;
        }, { api: await clienteNaPagina(page, creds) });

        // A CARGA INICIAL NAO ENTRA NA CONTA. Ela paga o cache frio do Vite (cada modulo servido
        // uma vez), que nao e nem a recarga nem a troca ao vivo. E ela e a que entra LOGADA: a
        // semeadura acima nao grava sessao (`clienteNaPagina`), e `sessaoDoApp` faz o login real
        // numa pagina que nao boota antes de abrir o atlas. As recargas seguintes herdam a sessao.
        await sessaoDoApp(page, creds, `/?atlas=${semente.a.atlasId}`);
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
            `pedidos ao host de tiles ausente, recusados na hora: ${recusadosNaHora}`,
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
        // caminhos independentes, e exigia que concordassem dentro de 60%. Numa maquina livre a
        // troca ao vivo caiu para 1010 ms contra 2864 ms de recarga-menos-boot, a conferencia
        // reprovou por 65%, e a explicacao escrita entao foi que "a recarga paga DOIS boots, o da
        // pagina de atlas e o do mapa". ESSA EXPLICACAO ERA FALSA, e a medida de 2026-09-23 a
        // desmente pelas duas pontas. A recarga desta bancada nao passa pela pagina de atlas: a
        // Navigation Timing registra uma navegacao so, direto para `/?atlas=`, e o gancho nasce
        // nesse mesmo documento. E os ~2,3 s de diferenca eram a recusa de conexao ao host de
        // tiles que esta camada nao tem (decisao 4 do `fileoverview`): sem a rota, o Chromium dava
        // de 2684 a 2867 ms de recarga-menos-boot; com ela, de 1207 a 1373.
        //
        // O QUE AS TRES AFIRMACOES PEGAM, e elas pegaram de verdade: no Firefox, sem a rota, a
        // terceira reprovou a 11,3 a 12,4 vezes, porque o cronometro da recarga media a recusa de
        // conexao (6,4 s) e nao a abertura do atlas. A troca ao vivo tem de ser POSITIVA (zero
        // significa que o marco de chegada resolveu antes de o trabalho comecar), tem de ser MENOR
        // que recarga-menos-boot, e as duas tem de ficar dentro de uma ordem de grandeza (fora
        // disso, alguem esta cronometrando outra coisa).
        //
        // POR QUE A SEGUNDA VALE, com o motivo medido e nao o antigo: depois do gancho a recarga
        // constroi um MAPA NOVO (estilo, fontes e os tiles do mapa base, e so entao `map.loaded()`),
        // e a troca ao vivo reusa a instancia. No relogio da pagina, do gancho a cortina cair: de
        // 0,5 a 1,1 s na recarga; do pedido a URL nomear o mapa: 0,45 a 0,5 s na troca ao vivo; e
        // a recarga ainda espera de 0,45 a 0,73 s pelos tiles depois da cortina. Com a rota, dez
        // rodadas de cada navegador em duas baterias, com outros agentes rodando Playwright na
        // mesma maquina (CPU media de 35 a 45%, picos de 85%): recarga-menos-boot de 1050 a 2096
        // ms contra 549 a 745 no Firefox (razao de 1,8 a 3,1), e de 1175 a 1373 contra 594 a 755
        // no Chromium (razao de 1,7 a 2,1). Sem a rota, a mesma bancada dava razao de 11,3 a 12,4
        // no Firefox.
        const semBoot = medianaRecarga - medianaBoot;
        expect(medianaAoVivo, 'troca ao vivo em zero: o marco de chegada resolveu cedo demais')
            .toBeGreaterThan(50);
        expect(medianaAoVivo, `troca ao vivo (${medianaAoVivo} ms) nao pode custar mais que `
            + `recarga-menos-boot (${semBoot} ms): a recarga refaz o mapa inteiro depois do gancho`)
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
