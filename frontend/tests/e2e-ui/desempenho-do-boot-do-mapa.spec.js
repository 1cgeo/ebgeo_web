// Path: e2e-ui/desempenho-do-boot-do-mapa.spec.js

/**
 * @fileoverview O CORREDOR de `helpers/peso-de-boot.js`: o que o boot do mapa pesa hoje, medido
 * em serie, com piso e teto datados.
 *
 * DOIS CASOS, e a divisao nao e organizacional. O primeiro mede o BOOT FRIO, que e a unica janela
 * em que os bytes ansiosos sao comparaveis entre rodadas (contexto novo, cache vazio). O segundo
 * mede as TRANSICOES, que e onde o produto passa a maior parte do tempo depois do primeiro
 * minuto: abrir um atlas de servidor, ir de servidor para local, voltar, e sair da conta. Um
 * emagrecimento que so melhora o boot frio e um emagrecimento que quase ninguem sente.
 *
 * ESTA CAMADA RODA EM DESENVOLVIMENTO, com o Vite servindo modulo a modulo sem empacotar. Os
 * numeros daqui sao MAIORES que os de producao por construcao, e nao ha conversao entre os dois.
 * Entao os tetos abaixo saem da medida FEITA AQUI, e nunca de um numero de producao transposto.
 * Os numeros de producao de 2026-08-25, guardados so como ordem de grandeza: boot frio 1529 a
 * 1841 ms, F5 1508 a 1532 ms, abrir atlas remoto 2939 a 2959 ms, remoto para local 1784 a
 * 1873 ms, local para remoto 3011 a 3091 ms, logout 2544 a 2551 ms.
 *
 * O QUE FOI MEDIDO AQUI EM 2026-08-25 (N=5 por metrica, duas baterias completas em serie, uma
 * maquina de trabalho comum, Vite em desenvolvimento):
 *
 *   | metrica                                    | mediana 1a / 2a | serie das 10       |
 *   |--------------------------------------------|-----------------|--------------------|
 *   | boot frio, bytes ansiosos de script        | identica nas 2  | 46 856 910 nas 10  |
 *   | boot frio, requisicoes de script           | 559 / 559       | 559 nas 10         |
 *   | boot frio, ms ate a barra da conta         | 1434 / 1403     | 849 a 2450         |
 *   | boot frio, ms ate o mapa vivo              | 3975 / 4031     | 3546 a 4569        |
 *   | boot frio, bytes DEPOIS do boot (6 s)      | 0 / 0           | 0 nas 10           |
 *   | abrir atlas remoto, ms ate a badge online  | 2863 / 3151     | 2570 a 3286        |
 *   | abrir atlas remoto, ms ate o mapa do atlas | 3514 / 3855     | 3347 a 4108        |
 *   | remoto para local, ms ate o mapa vivo      | 3339 / 3664     | 3204 a 3817        |
 *   | local para remoto, ms ate o mapa do atlas  | 3525 / 3948     | 3204 a 4801        |
 *   | logout, ms ate o mapa local assentar       | 3363 / 3594     | 3289 a 3759        |
 *
 * A TABELA E DE DUAS BATERIAS COM A MAQUINA OCIOSA. Outras duas rodaram com ela CARREGADA (outro
 * trabalho no mesmo computador), e elas e que calibraram os TETOS de tempo: a mediana da barra da
 * conta subiu de ~1420 para 1951 e 2480 ms, e um boot chegou a 4232. As colunas de BYTE, essas,
 * nao se mexeram dentro de nenhuma bateria: 46 968 009 nas cinco rodadas de uma, 46 973 492 nas
 * cinco da outra. O numero MUDA ENTRE baterias porque o `src/` deste checkout estava sendo editado
 * em paralelo, e essa e a leitura correta do instrumento, nao um defeito dele: dentro de uma
 * bateria a medida e exata, e entre baterias ela acusa que o codigo mudou. A faixa de +-5% absorve
 * essa deriva; um `src/` que mude de verdade estoura o teto e pede uma remedicao, que e o que a
 * data em `MEDIDO_EM` existe para datar.
 *
 * REMEDIDO NA MESMA NOITE, DEPOIS DA ONDA DE CARGA SOB DEMANDA. Turf, gdal e as ferramentas
 * militares, de desenho, de analise e de medida sairam do payload ansioso, e as duas colunas
 * deterministicas cairam: bytes de 46 856 910 para 38 456 561 (-18%) e requisicoes de 559 para
 * 476 (-15%), de novo identicas ate o byte em 5 de 5 rodadas.
 *
 * E O GUARDA REPROVOU SOZINHO quando isso aconteceu, que e o ponto do bicondicional: um
 * orcamento que so proibe subir envelhece por cima e deixa de medir o que se conquistou. As
 * bandas abaixo carregam o numero NOVO, editado no mesmo commit que o produziu.
 *
 * TRES COISAS QUE ESTA TABELA DIZ E QUE UMA MEDIA NAO DIRIA. Primeira: a coluna de bytes do boot
 * frio repetiu o MESMO numero ate o byte em dez rodadas, e e isso, e nao a opiniao de ninguem, que
 * autoriza um teto de 5% ali e proibe um teto justo nas colunas de tempo. Segunda: as quatro
 * transicoes custam entre 3,4 e 3,9 s, mais do que o boot frio ate a barra da conta, entao
 * emagrecer so o boot frio emagrece o que o usuario paga uma vez por sessao. Terceira: a badge de
 * sincronia acende ~700 ms antes de o mapa do atlas assentar, e essa distancia e o pedaco que uma
 * medida so nao mostrava.
 *
 * COMO RODAR, e o alerta que vem junto:
 *
 *   DB_USER=postgres DB_PASSWORD=postgres npx playwright test desempenho-do-boot-do-mapa
 *   EBGEO_E2E_PESO=1 ... (uma linha por rodada no stdout, para recalibrar)
 *
 * As coordenadas desta camada sao FIXAS (Vite 4321, backend 3912, banco `ebgeo_ui_e2e`, um
 * trabalhador so). NUNCA rode duas copias ao mesmo tempo: `reuseExistingServer` faz o Playwright
 * REUSAR um Vite ja na 4321, servindo o `src/` do OUTRO checkout, e a medida sai verde medindo
 * codigo que ninguem esta editando.
 *
 * `retries: 0` PARA O ARQUIVO INTEIRO. A suite tem `retries: 1`, que e certo para os specs de
 * colaboracao e errado aqui: uma serie que estoura o teto e re-executada ate passar vira "flaky",
 * que e uma rodada verde, e o numero que se queria vigiar volta a nao ser vigiado por ninguem.
 *
 * O QUE ESTE ARQUIVO NAO MEDE, dito para nao ser lido como se medisse:
 *
 *   - O F5 (recarga com cache quente). Ele responderia do cache e a coluna de bytes desabaria
 *     para perto de zero, que e a assinatura exata de "o app nao carregou": o piso reprovaria um
 *     comportamento correto. Medir F5 exige outra faixa, nao a mesma.
 *   - O PESO DE PRODUCAO. Aqui nao ha empacotamento, entao a contagem de requisicoes de script e
 *     de modulos servidos pelo Vite, e nao de chunks. A coluna serve para comparar HOJE com
 *     AMANHA nesta mesma camada, nunca para prever quantos chunks o `dist` tera.
 *   - A barra da conta nas TRANSICOES. Do seletor de projetos o marco ja esta satisfeito, entao
 *     ele mediria zero e se leria como otimizacao. Por isso as quatro transicoes partem todas do
 *     seletor, onde `__ebgeoMap` comprovadamente nao existe: e o que impede o predicado de mapa
 *     vivo de casar com o mapa da tela ANTERIOR e devolver uma transicao instantanea falsa.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import {
    instalarPesoDeBoot,
    medirBootFrio,
    medirJanela,
    repetir,
    resumir,
    anexarSerie,
    expectDeterministico,
    expectTempoPelaMediana,
} from './helpers/peso-de-boot.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Uma medicao unica de algo probabilistico nao e medicao. */
const N = 5;

/** A janela de ociosidade do controle negativo. Curta de proposito: 60 s inflaria a suite. */
const OCIOSIDADE_MS = 6000;

const PROJETOS = '/atlas.html';

/**
 * A data em que TODOS os tetos deste arquivo foram medidos, nesta maquina, nesta camada.
 *
 * Uma constante so, e nao uma por faixa, porque as faixas saem TODAS da mesma bateria (e foram
 * confirmadas na segunda): datas diferentes por faixa sugeririam medidas independentes que nunca
 * existiram.
 */
const MEDIDO_EM = '2026-08-25';

describeOrSkip('o boot do mapa: quanto pesa e quanto demora', () => {
    // Ver o `fileoverview`: repetir uma serie que estourou ate ela passar e reportar isso como
    // "flaky" transforma a medida em decoracao.
    test.describe.configure({ retries: 0 });

    test('boot frio: bytes ansiosos, requisicoes, os dois marcos e o que vem DEPOIS', async ({ browser }, testInfo) => {
        test.setTimeout(180000);

        const rodadas = await repetir(N, (i) => medirBootFrio(browser, {
            rotulo: `boot-frio-${i + 1}`,
            barraDaConta: true,
            mapaVivo: true,
            ociosidadeMs: OCIOSIDADE_MS,
        }));
        await anexarSerie(testInfo, 'boot-frio', rodadas);

        // O CONTROLE DO PROPRIO INSTRUMENTO, antes das faixas. Uma rodada em que a pesagem falhou
        // soma bytes a menos, e bytes a menos LEEM-SE como emagrecimento: sem esta linha, o modo
        // de falha do medidor e indistinguivel do sucesso do produto. Medido 1 em 10 de 10 boots
        // frios; o teto de 10 e menos de 2% das 559 respostas.
        //
        // E ELE NAO E O CONTROLE PRINCIPAL, dito aqui para nao ser lido como se fosse: uma
        // resposta servida do cache resolve como ZERO e conta como PESADA, entao um cache quente
        // colapsa a soma sem mover este contador (medido nas transicoes, onde a mesma janela deu
        // 17 MB numa rodada e 0 na seguinte, com 12 nao pesadas nas duas). Quem reprova o colapso
        // e o PISO da faixa de bytes, logo abaixo. Este contador cobre o outro caso, o da resposta
        // que o navegador nao soube dimensionar.
        const naoPesadas = resumir(rodadas, 'naoPesadas');
        expect(naoPesadas.max, `respostas que nao puderam ser pesadas: ${naoPesadas.valores}`)
            .toBeLessThanOrEqual(10);

        // 1 e 2. DETERMINISTICOS: teto justo (~5% de folga) e piso que reprova "o app nao subiu".
        expectDeterministico(rodadas, 'bytesDeScript', {
            piso: 36_500_000, teto: 40_400_000, medidoEm: MEDIDO_EM,
            porque: 'medido 38 456 561 bytes em 5 de 5 rodadas, o MESMO numero ate o byte. '
                + 'Era 46 856 910 antes da onda de carga sob demanda (turf, gdal, ferramentas '
                + 'militares, de desenho, de analise e de medida sairam do payload ansioso): '
                + 'queda de 8,4 MB, 18%. O guarda REPROVOU quando o numero baixou, que e o lado '
                + 'do bicondicional que impede o orcamento de envelhecer por cima. '
                + 'Faixa de +-5% do valor medido. Abaixo do piso o que carregou nao foi o app: a '
                + 'tela de "EBGeo indisponivel" passaria em qualquer teto sozinho.',
        });
        expectDeterministico(rodadas, 'requisicoesDeScript', {
            piso: 452, teto: 500, medidoEm: MEDIDO_EM,
            porque: 'medido 476 modulos servidos pelo Vite em 5 de 5 rodadas, faixa de +-5%. '
                + 'Eram 559 antes da carga sob demanda: 83 modulos a menos, 15%. '
                + 'Contagem que sobe sem os bytes subirem e fragmentacao de chunk; bytes que sobem '
                + 'sem a contagem subir e import estatico novo. Duas causas, duas correcoes.',
        });

        // 3 e 4. TEMPO: mediana e teto folgado. Ver `expectTempoPelaMediana`.
        expectTempoPelaMediana(rodadas, 'msBarraDaConta', {
            piso: 300, teto: 9000, medidoEm: MEDIDO_EM,
            porque: 'medianas de 1434 e 1403 ms com a maquina ociosa, e de 1951 e 2480 ms com ela '
                + 'CARREGADA (serie completa de 849 a 4232). O teto e ~3,6x a mediana carregada e '
                + 'nao ~1,2x o maximo, e foi AFROUXADO de 5000 depois que a bateria sob carga '
                + 'chegou a 4232 num boot: 5000 deixava 18% de folga sobre a pior observacao, que '
                + 'e um teto justo disfarcado. Teto justo de tempo so ensina a subir o teto ate '
                + 'parar de doer. Em 9000 ele ainda reprova um boot que dobre.',
        });
        expectTempoPelaMediana(rodadas, 'msMapaVivo', {
            piso: 1000, teto: 15000, medidoEm: MEDIDO_EM,
            porque: 'medianas de 3975 e 4031 ms com a maquina ociosa, e de 4448 e 4980 ms com ela '
                + 'CARREGADA (serie completa de 3546 a 6553). Teto ~3x a mediana carregada, pela '
                + 'mesma razao do marco anterior, mais o estilo do mapa, que depende de rede '
                + 'externa que esta camada nao controla.',
        });

        // 5. O CONTROLE NEGATIVO. Sem piso, e a isencao esta nomeada em `peso-de-boot.js`: zero
        // byte depois do boot e o estado desejado, entao um piso aqui proibiria o alvo.
        expectDeterministico(rodadas, 'bytesDeScriptDepoisDoBoot', {
            piso: 0, teto: 150_000, medidoEm: MEDIDO_EM,
            porque: 'medido ZERO em 10 de 10 janelas de 6 s. O teto e ABSOLUTO e nao proporcional, '
                + 'porque 5% de zero e zero: 150 KB tolera um modulo tardio solto e ainda assim '
                + 'reprova o que importa, ja que em dev nao ha empacotamento e qualquer subsistema '
                + 'adiado (Cesium, graficos) chega em megabytes. E a coluna que impede "ficou mais '
                + 'leve" de significar "adiou por 200 ms".',
        });
    });

    test('transicoes: abrir atlas remoto, remoto para local, local para remoto e sair da conta', async ({ browser }, testInfo) => {
        test.setTimeout(600000);

        const creds = await createVerifiedUser({ prefix: 'peso', nome: 'Peso de Boot' });

        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        instalarPesoDeBoot(page);
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);

        // Dois atlas de servidor, semeados pelo transporte real dentro da pagina (o mesmo caminho
        // de `aparencia-atravessa-trocas-de-atlas.spec.js`). `clearTokens` no fim porque a
        // primeira metade do caso e anonima: com sessao viva, a URL nua manda para o seletor.
        await page.goto('/');
        await page.evaluate(async ({ base, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const api = new ApiClient({ baseUrl: `${base}/api/v1` });
            await api.login(u.username, u.password);
            await api.createAtlas({ name: 'AAA Servidor um' });
            await api.createAtlas({ name: 'ZZZ Servidor dois' });
            api.clearTokens();
        }, { base: state.baseUrl, u: creds });

        /** Entra pela UI e para no seletor de projetos, com os cartoes ja desenhados. */
        const entrar = async () => {
            await page.waitForTimeout(2500); // ver `voltarAoSeletor`: o app assenta antes
            await page.goto(PROJETOS);
            await page.locator('[data-testid="projects-login"]').click();
            await page.locator('[data-testid="login-username"]').fill(creds.username);
            await page.locator('[data-testid="login-password"]').fill(creds.password);
            await page.locator('[data-testid="login-submit"]').click();
            await expect(page.locator('[data-testid="project-picker-item"]').first())
                .toBeVisible({ timeout: 30000 });
        };

        const abrirRemoto = 0, paraLocal = 1, voltarRemoto = 2, sair = 3;
        const series = [[], [], [], []];

        /**
         * Volta ao seletor e deixa o app ASSENTAR antes da proxima janela.
         *
         * O ASSENTAMENTO NAO E SUPERSTICAO, e foi medido: sem ele, a primeira bateria travou na
         * abertura do segundo atlas remoto, com a badge parada em `offline`/`local` por 30 s. A
         * janela anterior terminava no instante em que o mapa ficava vivo, e o pipeline de
         * abertura segue trabalhando DEPOIS disso (wipe de escopo, marcacao de origem, ativacao do
         * mapa) — navegar para o seletor no meio daquilo deixava a abertura seguinte pendurada. O
         * que este arquivo mede, entao, e a transicao a partir de um app QUIESCENTE, e nao a
         * partir de um usuario que clica mais rapido do que o produto termina. Sao coisas
         * diferentes, e so a primeira e comparavel entre rodadas.
         */
        const voltarAoSeletor = async () => {
            await page.waitForTimeout(2500);
            await page.goto(PROJETOS);
            await expect(page.locator('[data-testid="project-picker-item"]').first())
                .toBeVisible({ timeout: 30000 });
        };

        for (let i = 0; i < N; i += 1) {
            await entrar();

            // TODAS as quatro janelas comecam no SELETOR, e o motivo esta no `fileoverview`: la
            // `__ebgeoMap` nao existe, entao o predicado de mapa vivo nao pode casar com o mapa da
            // tela anterior e devolver uma transicao de zero milissegundo.
            //
            // As DUAS aberturas de servidor esperam `mapaDoAtlasAtivo`, e nao so `mapaVivo`: um
            // segundo depois do clique o mapa vivo ainda e o LOCAL (medido). A serie carrega as
            // duas colunas, e a distancia entre elas e justamente o custo da troca de mapa.
            series[abrirRemoto].push(await medirJanela(page, {
                rotulo: `abrir-atlas-remoto-${i + 1}`,
                acao: () => page.locator('[data-testid="project-picker-item"]', { hasText: 'AAA Servidor um' }).click(),
                barraDaConta: false,
                sincroniaOnline: true,
                mapaDoAtlasAtivo: true,
            }));

            await voltarAoSeletor();
            series[paraLocal].push(await medirJanela(page, {
                rotulo: `remoto-para-local-${i + 1}`,
                acao: () => page.locator('[data-testid="local-atlas-item"]').first().click(),
                barraDaConta: false,
            }));

            await voltarAoSeletor();
            series[voltarRemoto].push(await medirJanela(page, {
                rotulo: `local-para-remoto-${i + 1}`,
                acao: () => page.locator('[data-testid="project-picker-item"]', { hasText: 'ZZZ Servidor dois' }).click(),
                barraDaConta: false,
                sincroniaOnline: true,
                mapaDoAtlasAtivo: true,
            }));

            await voltarAoSeletor();
            series[sair].push(await medirJanela(page, {
                rotulo: `logout-${i + 1}`,
                acao: () => page.locator('[data-testid="app-bar-logout"]').click(),
                barraDaConta: false,
            }));
        }

        await anexarSerie(testInfo, 'abrir-atlas-remoto', series[abrirRemoto]);
        await anexarSerie(testInfo, 'remoto-para-local', series[paraLocal]);
        await anexarSerie(testInfo, 'local-para-remoto', series[voltarRemoto]);
        await anexarSerie(testInfo, 'logout', series[sair]);

        // AS QUATRO SAO TEMPO, entao mediana e teto folgado. O PISO e a parte que trabalha aqui:
        // ele reprova a transicao instantanea FALSA, que e o modo de falha proprio desta medida
        // (um marco ja satisfeito antes do gesto mede quase zero e le-se como otimizacao).
        expectTempoPelaMediana(series[abrirRemoto], 'msMapaDoAtlasAtivo', {
            piso: 500, teto: 12000, medidoEm: MEDIDO_EM,
            porque: 'medianas de 3514 e 3855 ms em dev (producao: ~2,95 s). Abre socket, sincroniza '
                + 'e ativa o mapa do atlas. Teto ~3x a mediana.',
        });
        expectTempoPelaMediana(series[paraLocal], 'msMapaVivo', {
            piso: 500, teto: 11000, medidoEm: MEDIDO_EM,
            porque: 'medianas de 3339 e 3664 ms em dev (producao: ~1,83 s). E a mais barata das '
                + 'quatro, e a unica sem servidor no caminho.',
        });
        expectTempoPelaMediana(series[voltarRemoto], 'msMapaDoAtlasAtivo', {
            piso: 500, teto: 12000, medidoEm: MEDIDO_EM,
            porque: 'medianas de 3525 e 3948 ms em dev (producao: ~3,05 s). Irma de abrir-remoto, e '
                + 'medida a parte porque sair de um atlas LOCAL passa pelo wipe de escopo.',
        });
        expectTempoPelaMediana(series[sair], 'msMapaVivo', {
            piso: 500, teto: 11000, medidoEm: MEDIDO_EM,
            porque: 'medianas de 3363 e 3594 ms em dev (producao: ~2,55 s), do clique ate o mapa '
                + 'local assentar.',
        });

        // A badge online e o unico marco INTERMEDIARIO das transicoes de servidor, e vale medi-lo
        // a parte: sincronia rapida com mapa lento e defeito de render, o inverso e defeito de
        // rede, e uma coluna so nao separa os dois.
        expectTempoPelaMediana(series[abrirRemoto], 'msSincroniaOnline', {
            piso: 300, teto: 10000, medidoEm: MEDIDO_EM,
            porque: 'medianas de 2863 e 3151 ms em dev, contra 3514 e 3855 ate o mapa do atlas: a '
                + 'sincronia chega de 650 a 700 ms antes do mapa.',
        });

        // A UNICA COLUNA DETERMINISTICA DAS TRANSICOES, e a excecao explica a regra: a contagem de
        // modulos do grafo da pagina do mapa nao muda com o cache, entao ela e afericao. Os BYTES
        // das transicoes NAO SAO MEDIDA aqui, por dois motivos medidos: eles variam com o que o
        // cache ja tem (15,9 a 24,1 MB nas janelas equivalentes) e, com cache de memoria quente, o
        // Chromium chega a nao dimensionar a resposta (ver o segundo defeito na sondagem de
        // `peso-de-boot.js`). Entao a serie os REGISTRA no anexo e nao os assere: teto de byte
        // sobre cache quente e um numero que reprova por sorte.
        expectDeterministico(series[abrirRemoto], 'requisicoesDeScript', {
            piso: 452, teto: 500, medidoEm: MEDIDO_EM,
            porque: 'medido 559 em 40 de 40 janelas de transicao, o mesmo numero do boot frio: a '
                + 'pagina do mapa carrega o mesmo grafo de modulos por qualquer das quatro portas.',
        });

        await ctx.close();
    });
});
