// Path: e2e-ui/browser-temporal-advanced.spec.js

/**
 * §29.13-20 O DADO TEMPORAL AVANÇADO, EM DOIS NÍVEIS: o que o CLIENTE escreve e o que o
 * SERVIDOR guarda.
 *
 * O ARQUIVO TINHA DOIS CASOS QUE NÃO EXECUTAVAM O CÓDIGO QUE ANUNCIAVAM (achado E10 da
 * auditoria de 2026-09-21). Um se chamava "trajectory edit: move/insert/remove keypoints" e
 * nunca tocava no editor de trajetória: ele montava arrays de pontos-chave à mão e os empurrava
 * pela API, de modo que apagar `trajectory-edit-control.js` inteiro o deixava verde. O outro se
 * chamava "autoDtg derives canonical DTG/GDH values" e não derivava nada: os GDH eram literais
 * escritos no próprio teste, e escritos ERRADOS (`011200ZJAN24`), num formato que o produto não
 * produz em lugar nenhum. `formatDTG` (`temporal/temporal.utils.js`) escreve `DDHHMM<MON><YY>`
 * para o símbolo militar (sem Z, o Zulu é por definição) e `DDHHMMZ <MON>` para a medida de
 * coordenação. Um teste que afirma um formato inventado é pior que nenhum: ele CONGELA o
 * formato errado como se fosse contrato.
 *
 * A DIVISÃO QUE ESTE ARQUIVO PASSA A TER, e por que as duas metades precisam existir:
 *
 *  - "transporte" (backend real): o servidor NÃO interpreta as chaves temporais, ele persiste o
 *    JSONB e o `pullSync` o devolve. O que se mede é o envelope: a janela sobrevive, o array de
 *    trajetória é uma unidade só, a chave OMITIDA é apagada, e uma feição irmã sem tempo nenhum
 *    nunca adquire essas chaves. Nada disso exercita o cliente;
 *  - "autoria" (mapa LOCAL, anônimo): o editor de trajetória e a derivação de GDH são código de
 *    CLIENTE, e o sinal que vale é a propriedade GRAVADA NA STORE depois do gesto. Sem backend,
 *    porque não há nada de sync nos dois.
 *
 * O GDH ESPERADO É CALCULADO AQUI, por uma implementação independente de seis linhas
 * ({@link gdhMilitarEsperado}), a partir do epoch que a própria store gravou. Importar
 * `formatDTG` para comparar o produto com ele mesmo seria tautologia: o teste passaria com
 * qualquer formato, inclusive um errado.
 *
 * A CHAVE OMITIDA CONTINUA SUMINDO, MAS POR OUTRO MECANISMO, e é o contrato de `5f91f2e9`
 * (2026-09-13). Este spec dizia que o update era "a FULL JSONB replace of `properties`" e
 * empurrava ops cruas; hoje a op declara a base observada (`baseVersion`, a
 * `properties.confirmedVersion` da linha do snapshot) mais um PATCH das unidades que mudou, e
 * uma op sem base é recusada por `RAZAO_SEM_BASE` antes de escrever. A propriedade que os casos
 * de transporte medem é a mesma, porque é o patch que a produz: uma chave AUSENTE do payload
 * vira um `remove` explícito, então "apagar a janela temporal deixando os campos em branco" e
 * "limpar a trajetória" continuam sendo o gesto de omitir, e continuam apagando. A base sai de
 * `helpers/base-confirmada.js` e é RELIDA a cada edição, porque cada escrita aceita move a
 * revisão da feição.
 *
 * Cada caso de transporte se provisiona sozinho (usuário + atlas + mapa) para isolamento total.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { instalarBaseConfirmada } from './helpers/base-confirmada.js';
import {
    clicarNoMapaUI,
    drawMilitarySymbolUI,
    drawPointUI,
    readFeatures,
    selectFeatureUI,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Abreviaturas de mês em pt-BR, na ordem do calendário. */
const MESES_GDH = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

/**
 * O GDH militar que o produto DEVE ter escrito para um instante: `DDHHMM<MON><YY>` em Zulu.
 *
 * Implementação independente de propósito: comparar a saída do produto com `formatDTG`, que é
 * quem a produz, não distinguiria "o formato certo" de "o formato que estiver lá".
 * @param {number} epoch - Instante (epoch ms).
 * @returns {string}
 */
function gdhMilitarEsperado(epoch) {
    const d = new Date(epoch);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}`
        + `${MESES_GDH[d.getUTCMonth()]}${p2(d.getUTCFullYear() % 100)}`;
}

/**
 * O GDH de medida de coordenação para um instante: `DDHHMMZ <MON>`.
 * @param {number} epoch - Instante (epoch ms).
 * @returns {string}
 */
function gdhDeCoordenacaoEsperado(epoch) {
    const d = new Date(epoch);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}Z ${MESES_GDH[d.getUTCMonth()]}`;
}

/** Instantes usados pelos casos de transporte (fixos, para os literais serem conferíveis). */
const T_INICIO = Date.UTC(2024, 0, 1, 12, 0, 0);
const T_FIM = Date.UTC(2024, 0, 1, 13, 30, 0);

/**
 * Seeds a fresh user + atlas + map and stashes the live ApiClient + factory on
 * `window.__tmp` so later `page.evaluate` calls reuse them.
 *
 * A CONTA nasce no NODE (`helpers/accounts.js`), porque o cadastro exige e-mail e o token
 * que o confirma só existe como linha no Postgres, fora do alcance do `page.evaluate`.
 * Dentro do browser sobra o `login()`, e o atlas + mapa contra o backend real.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl - backend origin (without the `/api/v1` suffix)
 * @param {string} prefix - username prefix, for readable test isolation
 * @returns {Promise<{ atlasId: string, mapId: string }>}
 */
async function seed(page, baseUrl, prefix) {
    const user = await createVerifiedUser({ prefix, nome: 'Temporal E2E' });
    // `window.__ebgeoBase`: as edições daqui declaram a base observada, e ela é lida do
    // snapshot dentro da própria página (ver o cabeçalho).
    await instalarBaseConfirmada(page);
    return page.evaluate(
        async ({ baseUrl: url, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${url}/api/v1` });
            await api.login(u.username, u.password);

            const atlas = await api.createAtlas({ name: 'Temporal Advanced Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            window.__tmp = { api, createOperation };
            return { atlasId: atlas.id, mapId };
        },
        { baseUrl, u: user },
    );
}

/** Boot anônimo no mapa local (os casos de autoria não falam com o backend). */
async function bootLocal(page) {
    await page.goto('/');
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 20000 },
    );
}

/**
 * As propriedades que a STORE guarda para uma feição do mapa corrente.
 * @param {import('@playwright/test').Page} page
 * @param {string} bucket - Balde de armazenamento ('points', 'military_symbols', ...).
 * @param {string} id - Id da feição.
 * @returns {Promise<Object|null>}
 */
async function propsNaStore(page, bucket, id) {
    const lista = await readFeatures(page, bucket);
    return lista.find((f) => f.id === id)?.props ?? null;
}

describeOrSkip('Temporal: autoria no cliente (Chromium real, mapa local)', () => {
    test('§29.15 a trajetória nasce do EDITOR de verdade: âncora + um ponto-chave por clique no mapa', async ({ page }) => {
        await bootLocal(page);

        const id = await drawPointUI(page, [-47.9, -15.8]);
        expect(id, 'o ponto foi criado').toBeTruthy();

        // ASSERÇÃO POSITIVA DO ANTES: a feição nasce SEM trajetória, senão "ganhou 3 pontos"
        // seria indistinguível de uma trajetória que já estava lá.
        expect((await propsNaStore(page, 'points', id))?.trajetoria).toBeUndefined();

        // O painel da feição é o que monta a seção Trajetória e entrega a feição ao editor
        // (`TrajectoryEditControl.show`), então selecionar é parte do caminho real.
        await selectFeatureUI(page, id);
        const painel = page.locator('.feature-panel[data-expanded="true"]');
        const adicionar = painel.locator('.temporal-attr-btn--primary', { hasText: 'Adicionar no mapa' });
        await expect(adicionar).toBeVisible({ timeout: 10000 });

        await adicionar.click();
        // A barra de "Cancelar / Concluir" é a prova de que o modo de acréscimo abriu: sem ela
        // os cliques abaixo cairiam na seleção de feições e o caso mediria outra coisa.
        const barraDoEditor = page.locator('.trajectory-edit-toolbar');
        await expect(barraDoEditor).toBeVisible({ timeout: 10000 });

        // Os alvos saem de PIXEIS da tela e voltam para lng/lat: uma coordenada escrita à mão
        // cai fora da viewport, porque desenhar o ponto já mexeu no zoom. E são lidos DEPOIS de
        // o modo de acréscimo abrir: entrar nele recolhe o painel e o mapa se desloca, e um alvo
        // tomado antes ia parar em x = 1280, a borda da janela, onde o clique não chega ao canvas
        // (medido em 2026-09-21: dois cliques, um só `click` do mapa, dois pontos-chave em vez de três).
        const alvos = await page.evaluate(() => [[700, 260], [820, 380]].map(([x, y]) => {
            const p = globalThis.__ebgeoMap.unproject([x, y]);
            return [p.lng, p.lat];
        }));

        for (const alvo of alvos) {
            const clique = await clicarNoMapaUI(page, alvo);
            expect(clique.coberto, `o clique caiu sob ${clique.porQuem}`).toBe(false);
        }

        await barraDoEditor.locator('.trajectory-edit-toolbar__done').click();
        await expect(barraDoEditor).toHaveCount(0, { timeout: 10000 });

        // O EFEITO, na store: âncora (a posição de origem da feição) mais um ponto-chave por
        // clique, em ordem crescente de tempo.
        await expect
            .poll(async () => (await propsNaStore(page, 'points', id))?.trajetoria?.length ?? 0, { timeout: 15000 })
            .toBe(alvos.length + 1);

        const props = await propsNaStore(page, 'points', id);
        const traj = props.trajetoria;
        for (let i = 1; i < traj.length; i++) {
            expect(traj[i].t, `o ponto-chave ${i} é posterior ao anterior`).toBeGreaterThan(traj[i - 1].t);
        }
        // A ÂNCORA É A CASA DA FEIÇÃO, comparada com a geometria que a store guarda e não com o
        // lng/lat pedido ao desenhar: o clique de desenho passa por pixel arredondado, então o
        // literal seria uma terceira medida e não a verdade contra a qual comparar.
        const casa = await page.evaluate(async (fid) => {
            const store = await import('/src/js/store/index.js');
            const colecao = await store.getCurrentMapFeatures();
            return (colecao?.points || []).find((f) => f.properties?.id === fid)?.geometry?.coordinates ?? null;
        }, id);
        expect(casa, 'a feição tem geometria na store').not.toBeNull();
        expect(traj[0].lng).toBeCloseTo(casa[0], 4);
        expect(traj[0].lat).toBeCloseTo(casa[1], 4);
        // E os dois cliques viraram os dois pontos-chave seguintes, cada um onde se clicou.
        for (let i = 0; i < alvos.length; i++) {
            expect(traj[i + 1].lng).toBeCloseTo(alvos[i][0], 2);
            expect(traj[i + 1].lat).toBeCloseTo(alvos[i][1], 2);
        }
    });

    test('§29.20 o GDH automático é DERIVADO ao mudar o Início, no formato que o produto escreve', async ({ page }) => {
        await bootLocal(page);

        const id = await drawMilitarySymbolUI(page, [-47.9, -15.8]);
        expect(id, 'o símbolo militar foi criado').toBeTruthy();

        await selectFeatureUI(page, id);
        const painel = page.locator('.feature-panel[data-expanded="true"]');

        // 1) Ligar o vínculo "GDH automático". Com a janela ainda vazia ele não deriva nada,
        //    que é o estado a partir do qual a mudança do Início é a ÚNICA causa possível.
        const gdhToggle = painel
            .locator('label.temporal-auto-binding', { hasText: 'GDH automático' })
            .locator('input[type="checkbox"]');
        await expect(gdhToggle).toBeVisible({ timeout: 10000 });
        await gdhToggle.check();
        await expect
            .poll(async () => (await propsNaStore(page, 'military_symbols', id))?.autoDtg, { timeout: 10000 })
            .toBe(true);
        // Vazio antes: o padrão do símbolo é `dateTimeGroup: null`, e a forma abaixo trata
        // igual o nulo e a string vazia, que são os dois jeitos de "ainda não tem GDH".
        expect(String((await propsNaStore(page, 'military_symbols', id))?.dateTimeGroup ?? '')).toBe('');

        // 2) Mudar o Início pelo campo real da seção "Validade temporal".
        const validade = painel.locator('.temporal-attr-section').filter({
            has: page.locator('.temporal-attr-section__title', { hasText: 'Validade temporal' }),
        });
        const linhas = validade.locator('.temporal-attr-row');
        await expect(linhas.nth(0).locator('.temporal-attr-row__label')).toHaveText('Início');
        const campoInicio = linhas.nth(0).locator('input');
        await campoInicio.fill('2024-03-01T08:00');
        // `fill` já dispara `change`; o disparo explícito é o cinto de segurança, e reescrever o
        // mesmo instante é idempotente.
        await campoInicio.dispatchEvent('change');

        // 3) O EFEITO: o instante chegou à store, e o GDH foi derivado DELE.
        await expect
            .poll(async () => String((await propsNaStore(page, 'military_symbols', id))?.dateTimeGroup ?? ''), { timeout: 15000 })
            .not.toBe('');

        const props = await propsNaStore(page, 'military_symbols', id);
        expect(Number.isFinite(props.temporalInicio), 'o Início virou epoch ms').toBe(true);
        expect(props.dateTimeGroup).toBe(gdhMilitarEsperado(props.temporalInicio));
        // A FORMA, afirmada em separado, porque é ela que o teste anterior afirmava errado:
        // seis dígitos, três letras de mês e dois dígitos de ano, SEM `Z`.
        expect(props.dateTimeGroup).toMatch(/^\d{6}[A-Z]{3}\d{2}$/);
        expect(props.dateTimeGroup).not.toContain('Z');
    });
});

describeOrSkip('Temporal: transporte das chaves (Chromium real + backend real)', () => {
    test('§29.13 edit temporal validity: set → shift → blank-clears; sibling stays untouched', async ({
        page,
    }) => {
        // Transport-only: avoid the map boot redirect racing ApiClient.login's stored tokens.
        await page.goto('/atlas.html');
        const { atlasId, mapId } = await seed(page, state.baseUrl, 'tmp_validity');

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid, inicio, fim }) => {
                const { api, createOperation } = window.__tmp;

                // §29.13: temporal window is a pair of epoch-ms scalars in properties.
                const movingId = crypto.randomUUID();
                const plainId = crypto.randomUUID();

                const corpo = (props, coords = [-43.2, -22.9]) => ({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: coords },
                    properties: { source: 'point', layerId: null, ...props },
                });
                const criar = (id, props, coords) =>
                    createOperation('feature', 'create', id, mid, corpo(props, coords));
                /** Edição declarando a base que o snapshot confirma AGORA. */
                const editar = (id, props, coords) =>
                    window.__ebgeoBase.opDeEdicao(api, aid, mid, id, corpo(props, coords));

                // Create a temporal point + a plain sibling (no temporal data).
                await api.pushOperations(aid, [
                    criar(movingId, { nome: 'Unidade Movel', temporalInicio: inicio, temporalFim: fim }),
                    criar(plainId, { nome: 'Marco Fixo' }, [-44.0, -23.5]),
                ]);

                const pull = async () => {
                    const r = await api.pullSync(aid, 0);
                    const map = r.snapshot?.maps?.find((m) => m.id === mid);
                    return (id) => map?.features?.points?.find((f) => f.properties.id === id);
                };

                let find = await pull();
                const created = find(movingId);
                const plainCreated = find(plainId);

                // §29.13: shift the window +1h (datetime edit). O payload continua carregando
                // o objeto inteiro, `source` incluso; o que o servidor aplica é o patch das
                // duas unidades que mudaram.
                const newInicio = inicio + 3_600_000;
                const newFim = fim + 3_600_000;
                const ackShift = await api.pushOperations(aid, [
                    await editar(movingId, {
                        nome: 'Unidade Movel',
                        temporalInicio: newInicio,
                        temporalFim: newFim,
                    }),
                ]);
                find = await pull();
                const shifted = find(movingId);

                // §29.13: blank = permanent. Um update SEM as chaves temporais tem de
                // DERRUBÁ-LAS: elas viram dois `remove` no patch, e não sobra janela velha.
                const ackClear = await api.pushOperations(aid, [
                    await editar(movingId, { nome: 'Unidade Parada' }),
                ]);
                find = await pull();
                const cleared = find(movingId);
                const plainAfter = find(plainId);

                return {
                    acks: [ackShift, ackClear].map((a) => ({
                        success: a.results?.[0]?.success ?? null,
                        reason: a.results?.[0]?.reason ?? null,
                    })),
                    created: {
                        present: Boolean(created),
                        inicio: created?.properties.temporalInicio,
                        fim: created?.properties.temporalFim,
                        inicioIsNumber: typeof created?.properties.temporalInicio === 'number',
                    },
                    plainCreated: {
                        present: Boolean(plainCreated),
                        hasInicio: plainCreated?.properties.temporalInicio !== undefined,
                    },
                    shifted: {
                        inicio: shifted?.properties.temporalInicio,
                        fim: shifted?.properties.temporalFim,
                        version: shifted?.properties.version,
                    },
                    cleared: {
                        present: Boolean(cleared),
                        nome: cleared?.properties.nome,
                        hasInicio: cleared?.properties.temporalInicio !== undefined,
                        hasFim: cleared?.properties.temporalFim !== undefined,
                    },
                    plainAfter: {
                        present: Boolean(plainAfter),
                        hasInicio: plainAfter?.properties.temporalInicio !== undefined,
                    },
                    expected: { inicio, fim, newInicio, newFim },
                };
            },
            { atlasId, mapId, inicio: T_INICIO, fim: T_FIM },
        );

        // As duas edições foram aceitas: base recusada deixaria a janela antiga na linha, e o
        // vermelho seria "a janela não mudou", que aponta para o lugar errado.
        expect(result.acks.map((a) => a.success), JSON.stringify(result.acks)).toEqual([true, true]);

        // Create: window persisted as exact epoch-ms numbers (no string drift).
        expect(result.created.present).toBe(true);
        expect(result.created.inicio).toBe(result.expected.inicio);
        expect(result.created.fim).toBe(result.expected.fim);
        expect(result.created.inicioIsNumber).toBe(true);
        // Sibling never acquired temporal data at create time.
        expect(result.plainCreated.present).toBe(true);
        expect(result.plainCreated.hasInicio).toBe(false);

        // Shift: window moved; version advanced past the initial create (real write).
        expect(result.shifted.inicio).toBe(result.expected.newInicio);
        expect(result.shifted.fim).toBe(result.expected.newFim);
        expect(result.shifted.version).toBeGreaterThan(1);

        // Blank-clears: a omissão das chaves derrubou a janela (negativo — não é fusão rasa).
        expect(result.cleared.present).toBe(true);
        expect(result.cleared.nome).toBe('Unidade Parada');
        expect(result.cleared.hasInicio).toBe(false);
        expect(result.cleared.hasFim).toBe(false);

        // Isolation: the plain sibling still has no temporal data after all edits.
        expect(result.plainAfter.present).toBe(true);
        expect(result.plainAfter.hasInicio).toBe(false);
    });

    test('§29.15/17 o array de trajetória VIAJA como uma unidade só, e a omissão o derruba', async ({
        page,
    }) => {
        // Transport-only: avoid the map boot redirect racing ApiClient.login's stored tokens.
        await page.goto('/atlas.html');
        const { atlasId, mapId } = await seed(page, state.baseUrl, 'tmp_traj');

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid, inicio, fim }) => {
                const { api, createOperation } = window.__tmp;
                const featureId = crypto.randomUUID();

                // §29.15: trajectory is a sampled keypoint array [{t,lng,lat}].
                const traj0 = [
                    { t: inicio, lng: -43.2, lat: -22.9 },
                    { t: inicio + 1_800_000, lng: -43.15, lat: -22.85 },
                    { t: fim, lng: -43.1, lat: -22.8 },
                ];

                const corpo = (props) => ({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                    properties: { source: 'point', layerId: null, ...props },
                });
                /** Edição declarando a base que o snapshot confirma AGORA. */
                const editar = (props) => window.__ebgeoBase.opDeEdicao(api, aid, mid, featureId, corpo(props));

                await api.pushOperations(aid, [
                    createOperation('feature', 'create', featureId, mid,
                        corpo({ nome: 'Movel', temporalInicio: inicio, temporalFim: fim, trajetoria: traj0 })),
                ]);

                const pull = async () => {
                    const r = await api.pullSync(aid, 0);
                    const map = r.snapshot?.maps?.find((m) => m.id === mid);
                    return map?.features?.points?.find((f) => f.properties.id === featureId);
                };

                const created = await pull();

                // §29.15/16: o array inteiro é UMA unidade, então ele viaja inteiro no patch e
                // substitui o anterior (um kp movido, um inserido, o último removido).
                const traj1 = [
                    { t: inicio, lng: -43.05, lat: -22.75 }, // moved
                    { t: inicio + 900_000, lng: -43.0, lat: -22.7 }, // inserted
                    { t: inicio + 1_800_000, lng: -43.15, lat: -22.85 },
                    // last keypoint of traj0 removed
                ];
                const ackEdit = await api.pushOperations(aid, [
                    await editar({ nome: 'Movel', temporalInicio: inicio, temporalFim: fim, trajetoria: traj1 }),
                ]);
                const edited = await pull();

                // §29.17: clear trajectory — um update SEM `trajetoria` a derruba (um `remove`
                // no patch), enquanto a janela temporal sobrevive (só o caminho foi limpo).
                const ackClear = await api.pushOperations(aid, [
                    await editar({ nome: 'Movel', temporalInicio: inicio, temporalFim: fim }),
                ]);
                const trajCleared = await pull();

                return {
                    acks: [ackEdit, ackClear].map((a) => ({
                        success: a.results?.[0]?.success ?? null,
                        reason: a.results?.[0]?.reason ?? null,
                    })),
                    created: {
                        traj: created?.properties.trajetoria,
                        len: created?.properties.trajetoria?.length,
                    },
                    edited: {
                        traj: edited?.properties.trajetoria,
                        len: edited?.properties.trajetoria?.length,
                        firstMoved: edited?.properties.trajetoria?.[0],
                        inserted: edited?.properties.trajetoria?.[1],
                    },
                    trajCleared: {
                        present: Boolean(trajCleared),
                        hasTraj: trajCleared?.properties.trajetoria !== undefined,
                        keptInicio: trajCleared?.properties.temporalInicio,
                    },
                    expected: { traj0, traj1, inicio },
                };
            },
            { atlasId, mapId, inicio: T_INICIO, fim: T_FIM },
        );

        expect(result.acks.map((a) => a.success), JSON.stringify(result.acks)).toEqual([true, true]);

        // Create: the full keypoint array round-trips structurally identical.
        expect(result.created.traj).toEqual(result.expected.traj0);
        expect(result.created.len).toBe(3);

        // Edit: o array inteiro foi substituído — novo comprimento, 1º kp movido, kp inserido.
        expect(result.edited.traj).toEqual(result.expected.traj1);
        expect(result.edited.len).toBe(3);
        expect(result.edited.firstMoved).toEqual({ t: result.expected.inicio, lng: -43.05, lat: -22.75 });
        expect(result.edited.inserted).toEqual({ t: result.expected.inicio + 900_000, lng: -43.0, lat: -22.7 });

        // Clear: trajectory gone (negative — not a deep merge), window preserved.
        expect(result.trajCleared.present).toBe(true);
        expect(result.trajCleared.hasTraj).toBe(false);
        expect(result.trajCleared.keptInicio).toBe(result.expected.inicio);
    });

    test('§29.18/19/20 as bandeiras automáticas persistem, e o GDH derivado viaja verbatim', async ({
        page,
    }) => {
        // Transport-only: avoid the map boot redirect racing ApiClient.login's stored tokens.
        await page.goto('/atlas.html');
        const { atlasId, mapId } = await seed(page, state.baseUrl, 'tmp_auto');

        // OS GDH SÃO CALCULADOS AQUI, pelo formatador independente do topo do arquivo, e não
        // escritos à mão: a versão anterior deste caso carregava `011200ZJAN24`, um formato que
        // o produto não produz, e o congelava como se fosse contrato.
        const dtgMilitar = gdhMilitarEsperado(T_INICIO);
        const gdhIni = gdhDeCoordenacaoEsperado(T_INICIO);
        const gdhFim = gdhDeCoordenacaoEsperado(T_FIM);

        const result = await page.evaluate(
            async ({ atlasId: aid, mapId: mid, inicio, fim, dtg, gIni, gFim }) => {
                const { api, createOperation } = window.__tmp;
                const symbolId = crypto.randomUUID();
                const measureId = crypto.randomUUID();

                // A military_symbol carries autoDirection/autoSpeed/autoDtg flags. The
                // flags persist; derived direction/speed are LOCAL-display only (never
                // persisted), but the client-derived `dateTimeGroup` (autoDtg) rides
                // along in properties verbatim.
                await api.pushOperations(aid, [
                    createOperation('feature', 'create', symbolId, mid, {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                        properties: {
                            source: 'military_symbol',
                            layerId: null,
                            sidc: '10031000001211000000',
                            temporalInicio: inicio,
                            temporalFim: fim,
                            autoDirection: true,
                            autoSpeed: true,
                            autoDtg: true,
                            dateTimeGroup: dtg,
                        },
                    }),
                    // §29.20: a coordination_measure with autoDtg derives gdhIni/gdhFim.
                    createOperation('feature', 'create', measureId, mid, {
                        type: 'Feature',
                        geometry: {
                            type: 'Polygon',
                            coordinates: [[[-43.2, -22.9], [-43.1, -22.9], [-43.1, -22.8], [-43.2, -22.9]]],
                        },
                        properties: {
                            source: 'coordination_measure',
                            layerId: null,
                            temporalInicio: inicio,
                            temporalFim: fim,
                            autoDtg: true,
                            gdhIni: gIni,
                            gdhFim: gFim,
                        },
                    }),
                ]);

                const pull = async () => {
                    const r = await api.pullSync(aid, 0);
                    const map = r.snapshot?.maps?.find((m) => m.id === mid);
                    return {
                        symbol: map?.features?.military_symbols?.find((f) => f.properties.id === symbolId),
                        measure: map?.features?.coordination_measures?.find((f) => f.properties.id === measureId),
                    };
                };

                const created = await pull();

                // §29.18/19: toggling autoDirection OFF must persist. A edição declara a base
                // observada, e o patch dela tem uma unidade só (`properties.autoDirection`).
                const ackToggle = await api.pushOperations(aid, [
                    await window.__ebgeoBase.opDeEdicao(api, aid, mid, symbolId, {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                        properties: {
                            source: 'military_symbol',
                            layerId: null,
                            sidc: '10031000001211000000',
                            temporalInicio: inicio,
                            temporalFim: fim,
                            autoDirection: false,
                            autoSpeed: true,
                            autoDtg: true,
                            dateTimeGroup: dtg,
                        },
                    }),
                ]);
                const toggled = await pull();

                return {
                    ackToggle: {
                        success: ackToggle.results?.[0]?.success ?? null,
                        reason: ackToggle.results?.[0]?.reason ?? null,
                    },
                    symbol: {
                        present: Boolean(created.symbol),
                        bucket: 'military_symbols',
                        source: created.symbol?.properties.source,
                        autoDirection: created.symbol?.properties.autoDirection,
                        autoSpeed: created.symbol?.properties.autoSpeed,
                        autoDtg: created.symbol?.properties.autoDtg,
                        dateTimeGroup: created.symbol?.properties.dateTimeGroup,
                    },
                    measure: {
                        present: Boolean(created.measure),
                        source: created.measure?.properties.source,
                        autoDtg: created.measure?.properties.autoDtg,
                        gdhIni: created.measure?.properties.gdhIni,
                        gdhFim: created.measure?.properties.gdhFim,
                    },
                    toggled: {
                        autoDirection: toggled.symbol?.properties.autoDirection,
                        autoSpeed: toggled.symbol?.properties.autoSpeed,
                    },
                };
            },
            { atlasId, mapId, inicio: T_INICIO, fim: T_FIM, dtg: dtgMilitar, gIni: gdhIni, gFim: gdhFim },
        );

        // military_symbol landed in its own bucket with flags + derived DTG persisted.
        expect(result.symbol.present).toBe(true);
        expect(result.symbol.source).toBe('military_symbol');
        expect(result.symbol.autoDirection).toBe(true);
        expect(result.symbol.autoSpeed).toBe(true);
        expect(result.symbol.autoDtg).toBe(true);
        expect(result.symbol.dateTimeGroup).toBe(dtgMilitar);

        // §29.20: coordination_measure autoDtg with derived GDH window round-trips.
        expect(result.measure.present).toBe(true);
        expect(result.measure.source).toBe('coordination_measure');
        expect(result.measure.autoDtg).toBe(true);
        expect(result.measure.gdhIni).toBe(gdhIni);
        expect(result.measure.gdhFim).toBe(gdhFim);

        // §29.18/19: the flag toggle persisted (autoDirection now false, autoSpeed kept).
        expect(result.ackToggle.success, `toggle recusado: ${result.ackToggle.reason}`).toBe(true);
        expect(result.toggled.autoDirection).toBe(false);
        expect(result.toggled.autoSpeed).toBe(true);
    });
});
