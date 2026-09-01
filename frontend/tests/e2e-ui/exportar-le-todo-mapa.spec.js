// Path: e2e-ui/exportar-le-todo-mapa.spec.js

/**
 * @fileoverview O documento de exportacao tem de trazer as camadas e os grupos de TODO mapa do
 * atlas, e nao so os do mapa que a pessoa abriu.
 *
 * O DEFEITO. A tabela de secoes opcionais do `.ebgeo`
 * (`frontend/src/js/import_export/export-optional-sections.js`) lia camada e grupo pelos getters
 * SINCRONOS do store, que leem `memoryStore`. A memoria e hidratada UM MAPA POR VEZ:
 * `setCurrentMap` carrega camadas e grupos do mapa corrente, e nada carrega os demais. Entao
 * exportar sem visitar cada mapa entregava, para todo mapa nao visitado, uma unica camada
 * `default` INVENTADA pela sintese de camada padrao, e a secao de grupos inteira vazia. As duas
 * formas de falha sao diferentes, e a de camada e a pior: grupo falha FECHADO (a secao some) e
 * camada falha ABERTO (um numero plausivel, que ninguem confere). A correcao trocou os dois
 * getters pelos gemeos de REPOSITORIO (`getLayersRepo` e `getMapGroupsFromDB`).
 *
 * O F5 E O SUJEITO DA MEDICAO, e sem ele este arquivo nao mede nada. Importar e exportar na MESMA
 * sessao povoa a memoria por efeito colateral do proprio import (`importMapGroups` escreve memoria
 * para TODOS os mapas, enquanto o irmao de camada so escreve para o mapa corrente), de modo que
 * uma spec sem reload mede o caso afortunado e passa VERDE com o defeito de pe. Recarregar deixa
 * em memoria apenas o mapa corrente, que e exatamente o estado de quem abre o app noutro dia e
 * manda exportar sem passear pelos mapas. Quem apagar o `page.reload()` daqui nao torna a spec
 * mais rapida: torna-a vazia.
 *
 * A REFERENCIA E INDEPENDENTE, e essa e a razao de haver duas leituras. O esperado nao e um objeto
 * escrito a mao nesta spec: e o documento que `buildLocalAtlasExportData`
 * (`frontend/src/js/projects/send-local-to-server.service.js`) monta lendo o namespace do slot
 * local CRU, sem montar store nenhuma e sem passar por memoria alguma. Ele e um segundo leitor do
 * formato de disco, ja medido como correto, e por isso serve de verdade de solo para o exportador
 * do mapa. Comparar o exportador consigo mesmo (com a memoria que ele acabou de povoar) e o erro
 * que este arquivo existe para nao cometer.
 *
 * OS ABSOLUTOS SAO O PONTO. Com o defeito, `07 Camadas` devolvia UMA camada em vez de sete e a
 * secao `groups` saia VAZIA: um "maior que zero" passaria verde nos dois casos, e o total de
 * camadas cairia de 17 para 11 sem nada ficar vermelho. Por isso as contagens sao exatas, e vem do
 * ARQUIVO (`countFixture` sobre a mesma fixture que o navegador importa), nunca de numero digitado
 * aqui.
 *
 * O QUE UM VERDE AQUI NAO PROVA:
 *   - nada sobre o ZIP `.ebgeo` gravado em disco: o que se compara e o documento em memoria que o
 *     exportador monta, antes de serializar;
 *   - nada sobre as outras oito secoes opcionais (temporal, gridStyle, comentarios, cesium3d, 360,
 *     notas, uso de cor), cujos getters nao sao exercitados por estas assercoes;
 *   - nada sobre um atlas REMOTO montado: o sujeito e um slot LOCAL, e a hidratacao de memoria e a
 *     mesma, mas a fonte nao;
 *   - nada sobre o envio ao servidor nem sobre o reimport do arquivo produzido;
 *   - e nada sobre o mapa CORRENTE, que e justamente o unico que passava mesmo com o defeito.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { fileURLToPath } from 'node:url';
import { loadEbgeoFixture, countFixture } from '../helpers/ebgeo-fixture.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Um `.ebgeo` real, o mesmo que a suite de migracao e a spec vizinha de atlas local usam. */
const FIXTURE = fileURLToPath(new URL('../fixtures/ebgeo-2.2/01-completo.ebgeo', import.meta.url));

/** O mapa da fixture com MAIS de uma camada: e nele que a camada inventada se ve. */
const MAPA_DE_CAMADAS = '07 Camadas';

/** O unico mapa da fixture com grupos: e nele que a secao vazia se ve. */
const MAPA_DE_GRUPOS = '08 Grupos';

/** Espera o mapa 2D estar de pe. */
async function esperarMapa(page) {
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 30000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 30000 },
    );
}

describeOrSkip('exportar le o repositorio, e nao a memoria do mapa corrente', () => {
    test('camadas e grupos de mapa NAO visitado entram no documento, depois de um F5', async ({ page }) => {
        test.setTimeout(240000);

        const fixture = await loadEbgeoFixture('01-completo.ebgeo');
        const esperado = countFixture(fixture);
        // DERIVADOS DO ARQUIVO, nao digitados: trocar a fixture nao deixa este caso afirmando o
        // conteudo da anterior.
        const camadasEsperadasPorMapa = Object.fromEntries(
            Object.entries(fixture.data.layers).map(([mapa, lista]) => [mapa, lista.length]),
        );
        const gruposEsperadosPorMapa = Object.fromEntries(
            Object.entries(fixture.data.groups).map(([mapa, porId]) => [mapa, Object.keys(porId).length]),
        );

        // Deslogado: a metade local e o produto inteiro para quem nao tem conta, e o defeito nao
        // dependia de sessao nenhuma.
        await page.goto('/atlas.html');
        await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 20000 });
        await page.locator('[data-testid="local-atlas-file-input"]').setInputFiles(FIXTURE);

        // A tela entrega o arquivo e NAVEGA; quem importa e o boot do mapa.
        await page.waitForURL((url) => !url.pathname.endsWith('atlas.html'), { timeout: 30000 });
        await esperarMapa(page);

        // ESPERA PELO FIM DO IMPORT INTEIRO, ancorada no toast porque ele e a ULTIMA linha do fluxo
        // (mapas, grupos, camadas, 3D/360, temporal, comentarios, briefings, ordem, imagens e
        // icones ja foram escritos quando ele aparece). Ancorar na propria quantia que se vai
        // asserir transformaria a assercao num timeout mudo no dia em que o defeito voltar.
        await expect(page.locator('.toast', { hasText: `${esperado.maps} mapas carregados!` }))
            .toBeVisible({ timeout: 60000 });

        // ============================ O ATO SOB MEDICAO ============================
        // Sem esta linha, a memoria continua povoada pelo import e o documento sai certo mesmo com
        // o defeito de pe. Ver o `@fileoverview`.
        await page.reload();
        await esperarMapa(page);

        // PRONTIDAO DO BOOT, e ela e uma PREMISSA, nunca o sujeito. O escopo do slot importado so
        // fica ativo depois de `activateBootAtlasScope` e da remontagem do resolvedor de nomes;
        // exportar antes disso leria os bancos errados, e o vermelho falaria de outra coisa. O
        // numero de MAPAS nao e nenhuma das quantias asseridas abaixo (camadas e grupos), entao
        // esperar por ele nao esconde o defeito que este caso mede.
        await page.waitForFunction(
            async (mapasEsperados) => {
                const store = await import('/src/js/store/index.js');
                return (await store.getAllMapNamesStore()).length === mapasEsperados;
            },
            esperado.maps,
            { timeout: 60000 },
        );

        const medido = await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            const { getControl } = await import('/src/js/store/control.registry.js');
            const ns = await import('/src/js/store/atlas-namespace.js');
            const { buildLocalAtlasExportData } =
                await import('/src/js/projects/send-local-to-server.service.js');

            // O DOCUMENTO REAL DO EXPORTADOR, pelo mesmo caminho que o `.ebgeo` e o "Salvar atlas
            // local no servidor" usam: `buildExportDataObject` sobre todos os nomes de mapa.
            const nomes = await store.getAllMapNamesStore();
            const doc = await getControl('exportImport').buildExportDataObject(nomes);

            // A VERDADE DE SOLO, lida do DISCO sem montar nada: o escopo do slot local corrente.
            const atual = await ns.getGlobalStore().getItem(ns.GlobalKey.CURRENT_LOCAL_ATLAS);
            const slots = await ns.readLocalAtlasRegistry();
            const slot = slots.find((s) => s.id === atual);
            if (!slot) {
                // Falha NOMEADA: sem o slot, `localScope` estouraria com uma mensagem que nao diz
                // qual premissa caiu.
                throw new Error(`slot local corrente ausente do registro (atual=${String(atual)})`);
            }
            const docDisco = await buildLocalAtlasExportData(ns.localScope(slot.id, slot.dbSuffix));

            // Projecoes pequenas e comparaveis. A IDENTIDADE de cada camada entra (`id` e `name`),
            // que e o que distingue as sete camadas reais da unica `default` inventada; os carimbos
            // de tempo ficam de fora porque a camada padrao sintetizada recebe `Date.now()` na
            // leitura, e compara-los produziria vermelho por relogio.
            const camadas = (secao) => Object.fromEntries(
                Object.entries(secao ?? {}).map(([mapa, lista]) =>
                    [mapa, (lista ?? []).map((c) => `${c?.id}|${c?.name}`)]),
            );
            const grupos = (secao) => Object.fromEntries(
                Object.entries(secao ?? {}).map(([mapa, porId]) =>
                    [mapa, Object.keys(porId ?? {}).sort()]),
            );
            const totalDeCamadas = (secao) => Object.values(secao ?? {})
                .reduce((soma, lista) => soma + (lista?.length ?? 0), 0);

            return {
                nomes,
                mapaCorrente: await store.getCurrentMapName(),
                exportador: {
                    camadas: camadas(doc.layers),
                    grupos: grupos(doc.groups),
                    total: totalDeCamadas(doc.layers),
                },
                disco: {
                    camadas: camadas(docDisco.layers),
                    grupos: grupos(docDisco.groups),
                    total: totalDeCamadas(docDisco.layers),
                },
            };
        });

        // PREMISSA DA MEDICAO, asserida em vez de suposta: os dois mapas sob exame NAO sao o mapa
        // corrente. O corrente e o unico cuja memoria o boot hidrata, e portanto o unico que
        // passava mesmo com o defeito; se a fixture mudasse e um deles virasse o corrente, este
        // caso passaria a medir o caso afortunado sem avisar ninguem.
        expect(medido.mapaCorrente, 'o mapa aberto no boot e o que a fixture declara')
            .toBe(fixture.data.currentMap);
        expect([MAPA_DE_CAMADAS, MAPA_DE_GRUPOS], 'nenhum dos mapas sob exame foi visitado')
            .not.toContain(medido.mapaCorrente);
        expect(medido.nomes, 'o documento foi montado sobre os mapas todos do arquivo')
            .toHaveLength(esperado.maps);

        // ===================== OS ABSOLUTOS QUE O DEFEITO QUEBRAVA =====================
        // SETE camadas, nao uma. Com o defeito era exatamente 1, a `default` inventada pela sintese
        // de camada padrao, e um "> 0" passaria verde.
        expect(medido.exportador.camadas[MAPA_DE_CAMADAS],
            `as ${camadasEsperadasPorMapa[MAPA_DE_CAMADAS]} camadas de "${MAPA_DE_CAMADAS}" entraram no documento`)
            .toHaveLength(camadasEsperadasPorMapa[MAPA_DE_CAMADAS]);

        // DOIS grupos, nao secao ausente. Com o defeito a secao inteira saia vazia, e um "existe a
        // chave" tambem passaria verde no dia em que ela voltasse vazia.
        expect(medido.exportador.grupos[MAPA_DE_GRUPOS],
            `os ${gruposEsperadosPorMapa[MAPA_DE_GRUPOS]} grupos de "${MAPA_DE_GRUPOS}" entraram no documento`)
            .toHaveLength(gruposEsperadosPorMapa[MAPA_DE_GRUPOS]);

        // A SECAO DE GRUPOS TEM EXATAMENTE O MAPA QUE TEM GRUPO: nem vazia (o defeito), nem inflada
        // por um mapa que nao tem grupo nenhum.
        expect(Object.keys(medido.exportador.grupos).sort(), 'so o mapa com grupos aparece na secao')
            .toEqual(Object.keys(gruposEsperadosPorMapa).sort());

        // O TOTAL, que e onde a perda aparecia como numero plausivel: 11 camadas (uma por mapa) no
        // lugar das 17 do arquivo.
        expect(medido.exportador.total, 'o total de camadas e o que o arquivo declara')
            .toBe(esperado.layers);

        // POR MAPA, e nao so no total: um total certo com as camadas no mapa errado passaria pela
        // assercao acima.
        expect(
            Object.fromEntries(Object.entries(medido.exportador.camadas).map(([m, l]) => [m, l.length])),
            'cada mapa do arquivo levou o proprio numero de camadas',
        ).toEqual(camadasEsperadasPorMapa);

        // ===================== A COMPARACAO COM A LEITURA INDEPENDENTE =====================
        // Secao por secao, contra o leitor CRU de disco. Ele nao passa por memoria nenhuma, entao
        // uma igualdade aqui e a afirmacao de que o exportador viu o disco inteiro, e nao so a
        // parte dele que o boot hidratou.
        expect(medido.exportador.camadas, 'a secao de camadas casa com o que esta no disco')
            .toEqual(medido.disco.camadas);
        expect(medido.exportador.grupos, 'a secao de grupos casa com o que esta no disco')
            .toEqual(medido.disco.grupos);

        // CONTROLE DA PROPRIA REFERENCIA: se o leitor cru tivesse lido de menos, as duas igualdades
        // acima poderiam ser dois erros iguais que concordam. Este numero vem do ARQUIVO.
        expect(medido.disco.total, 'a referencia independente tambem ve as camadas todas')
            .toBe(esperado.layers);
    });
});
