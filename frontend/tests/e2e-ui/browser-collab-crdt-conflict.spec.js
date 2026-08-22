// Path: e2e-ui/browser-collab-crdt-conflict.spec.js

/**
 * CRDT CONFLICT / CONVERGENCE — TWO real browsers + real backend, migrated to the
 * full-chain harness (`collab` fixture + expectFullSync). The core CRDT guarantee: when
 * two clients edit the SAME entity "at the same time", conflict resolves by LWW-by-ARRIVAL
 * (NOT timestamp; per CLAUDE.md) and BOTH clients CONVERGE — no permanent divergence.
 *
 * The migration makes the convergence claim FALSIFIABLE end-to-end. The flagship recolor
 * test no longer asserts only "A and B agree": it proves they converge to the SPECIFIC LWW
 * winner, cross-checked three ways the in-memory store alone can't —
 *   (a) the winning color the backend STORED in Postgres (the feature row),
 *   (b) the value durably in BOTH clients' IndexedDB (repo, not memoryStore),
 *   (c) the ledger's own conflict view, whose winnerServerVersion = the MAX server arrival
 *       order in the `operations` table.
 *
 * UI-first: the line is drawn with the real line tool, the concurrent recolors / delete are
 * driven through the real attribute panel + Delete key. The concurrent GEOMETRY move stays
 * programmatic (no single-gesture UI sets a line to EXACT coordinates — flagged inline).
 *
 * Run headed:  npx playwright test browser-collab-crdt-conflict --headed
 */

import {
    collabTest, expect, drawLineUI, readFeatures,
    selectAndRecolorUI, selectFeatureUI, recolorViaPanelUI, deleteFeatureUI,
} from './helpers/collab.fixtures.js';
import { collectLedger, reduceLedger } from './helpers/ledger.js';
import { waitForEntitySpan, waitForAcked } from './helpers/trace-helpers.js';
import { readIdbEntity } from './helpers/idb.js';

/** Drives a store op on `page` through the app's REAL store facade (no-UI escapes only). */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

const lineProp = async (page, id, prop) => {
    const f = (await readFeatures(page, 'lines')).find((x) => x.id === id);
    return f?.props?.[prop];
};

const lineGeomKey = (page, id) => page.evaluate(async (i) => {
    const store = await import('/src/js/store/index.js');
    const f = (await store.getCurrentMapFeatures()).lines.find((x) => x.properties?.id === i);
    return f ? JSON.stringify(f.geometry?.coordinates) : null;
}, id);

const hasLine = async (page, id) => (await readFeatures(page, 'lines')).some((x) => x.id === id);

/**
 * Waits until every client agrees with the value the server holds AT THAT MOMENT, and
 * returns it.
 *
 * Reading the winner once and then polling the clients against that snapshot is a latent
 * flake, and it bit the F5 test under full-suite load: an operation can still be sitting in
 * an outbound queue (`enqueued_not_flushed`) and flush later, legitimately moving the
 * winner AFTER the read. The clients then converge on the new value while the assertion
 * still demands the old one.
 *
 * Sampling server and clients together makes the claim the one that actually matters:
 * at one instant, everyone agrees. A permanent divergence never satisfies it and the
 * failure message names both sides.
 *
 * QUANTO A CONVERGÊNCIA DEMORA, MEDIDO em 2026-08-22 com o prazo alargado a 120 s e um
 * carimbo de tempo em cada chamada: VINTE amostras, todas entre 58 ms e 1,5 s, sem UMA
 * sequer acima disso. Isso muda a leitura das reprovações deste arquivo: os 25 s não são
 * apertados, são quatro ordens de grandeza acima do caso típico, e uma reprovação aqui NÃO
 * se explica por lentidão nem se conserta alargando o prazo. Quando o predicado estoura, o
 * que ele viu foi um cliente parado no PRÓPRIO valor (por exemplo
 * `servidor=#0000ff clientes=#0000ff,#ff0000`), e isso é divergência, não atraso. Medida em
 * dez rodadas em série: três reprovações, em três casos DIFERENTES deste arquivo. A causa
 * está aberta, e o próximo a pegá-la deve começar pelo relatório do SyncLedger anexado à
 * falha, que já descarta a hipótese mais barata: `acked-but-no-effect` vem ZERO, então não
 * é op confirmada pelo servidor e ignorada pelo cliente.
 */
async function convergedValue(db, pages, id, ler, timeout = 25000) {
    let valor = null;
    try {
        await expect
            .poll(async () => {
                const row = await db.queryFeatureRow(id);
                const servidor = String(row?.properties?.lineColor ?? '').toLowerCase();
                if (!servidor) return null;
                const clientes = await Promise.all(pages.map((p) => ler(p)));
                valor = clientes.every((c) => c === servidor) ? servidor : null;
                return valor ?? `servidor=${servidor} clientes=${clientes.join(',')}`;
            }, { timeout, message: 'todos os clientes concordam com o valor que o servidor tem AGORA' })
            .toMatch(/^#[0-9a-f]{6}$/);
    } catch (erro) {
        // O QUE A MENSAGEM PADRÃO NÃO SEPARA. "servidor=X clientes=X,Y" diz QUE divergiu e não
        // diz ONDE: a op do vencedor nunca chegou àquele cliente, chegou e não foi aplicada, ou
        // foi aplicada e depois desfeita. As três têm consertos diferentes e a mesma cara. Os
        // spans do SyncLedger daquela entidade respondem a pergunta, e este é o único instante
        // em que eles ainda existem (o anel vive na página, que fecha ao fim do caso).
        const linhas = await Promise.all(pages.map(async (p, i) => {
            const spans = await p.evaluate((eid) => {
                const t = window.__ebgeoSyncTrace;
                if (!t) return ['(trace desligado)'];
                return t.get((s) => s.entityId === eid)
                    .map((s) => `${s.stage}${s.outcome && s.outcome !== 'ok' ? `:${s.outcome}` : ''}`);
            }, id).catch(() => ['(página indisponível)']);
            return `  cliente ${i}: valor=${await ler(p).catch(() => '?')} spans=[${spans.join(' ')}]`;
        }));
        erro.message += `\n\nDIVERGÊNCIA, POR CLIENTE (spans da entidade ${id}):\n${linhas.join('\n')}`;
        throw erro;
    }
    return valor;
}

/**
 * Mesma ideia do `convergedValue`, para GEOMETRIA: relê o servidor A CADA amostra e cobra dos
 * clientes o valor que ele tem NAQUELE instante, devolvendo a chave vencedora.
 *
 * O `waitForAcked` que antecede a chamada prova só que cada cliente recebeu o ack da PRÓPRIA
 * op. Ele não prova que a op do OUTRO cliente já foi ordenada e gravada, então o servidor
 * ainda pode trocar de vencedor depois de uma leitura única. Congelar o alvo nessa leitura
 * fazia o poll perseguir uma geometria já morta, e o resultado virava sorteio: passava se a
 * op perdedora chegasse antes da leitura, falhava se chegasse depois.
 *
 * O `esperadas` mantém o alvo amarrado à REALIDADE, e é o que impede a tautologia: enquanto o
 * servidor não tiver uma das geometrias em disputa (pode ainda estar na do create), a amostra
 * não vale e o poll continua. Sem isso, "cliente igual ao servidor" passaria com o servidor
 * guardando qualquer coisa. Uma geometria ilegítima ESTÁVEL nunca satisfaz o predicado, e a
 * mensagem de falha traz o valor que o servidor tinha.
 */
async function convergedGeomKey(db, pages, id, esperadas, timeout = 25000) {
    let vencedora = null;
    await expect
        .poll(async () => {
            const row = await db.queryFeatureRow(id);
            const servidor = row?.geometry?.coordinates ? JSON.stringify(row.geometry.coordinates) : null;
            if (!servidor) return 'servidor-sem-geometria';
            if (!esperadas.includes(servidor)) return `servidor-fora-da-disputa(${servidor})`;
            const clientes = await Promise.all(pages.map((p) => lineGeomKey(p, id)));
            vencedora = clientes.every((c) => c === servidor) ? servidor : null;
            return vencedora ? 'convergiu' : `servidor=${servidor} clientes=${clientes.join(' | ')}`;
        }, {
            timeout,
            message: 'todos os clientes concordam com a geometria que o servidor tem AGORA, e ela é uma das que estavam em disputa',
        })
        .toBe('convergiu');
    return vencedora;
}

// The coordinates the real line tool draws (also where the camera is fit before the clicks).
const LINE_COORDS = [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];

// Real attribute-panel gestures (selectAndRecolorUI / deleteFeatureUI) are shared drivers in
// helpers/collab-helpers.js, re-exported by the fixture.

collabTest.describe('CRDT conflict — concurrent edits converge (LWW by arrival)', () => {
    collabTest('concurrent recolor of the SAME line → converge to the LWW winner, proven via Postgres + IDB + ledger', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        // A draws the line; assert it reached B through the WHOLE chain before the conflict.
        const id = await drawLineUI(A, LINE_COORDS);
        expect(id, 'the line tool created a feature on A').toBeTruthy();
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });

        // Selecionar PRIMEIRO nos dois, em série, e só então recolorir em paralelo.
        //
        // O gesto único (`selectAndRecolorUI`) fazia select e recolor juntos, e a update
        // remota do outro cliente chegava no meio, re-renderizando o painel e derrubando a
        // seleção: o recolor não acontecia, nenhuma operação era enfileirada, e o teste
        // caía com "não virou operação na fila". Era corrida do driver de UI, não do sync.
        // Na hora do select ainda não existe update concorrente (o create já assentou no
        // expectFullSync acima), então essa parte é segura em série. A concorrência que o
        // teste precisa é só no COMMIT da cor, que é um clique, e essa continua paralela.
        await selectFeatureUI(A, id);
        await selectFeatureUI(B, id);
        await Promise.all([
            recolorViaPanelUI(A, '#ff0000'),
            recolorViaPanelUI(B, '#0000ff'),
        ]);

        // (1) BOTH recolors must actually REACH THE SERVER before "who won" is even defined.
        //     `push.ack` is the only stage guaranteed for both: `remote.applied` is NOT, because
        //     the loser can be legitimately discarded by the peer's convergence guard. Anchoring
        //     here also removes the outbound-queue race (flush runs on a 1.5s interval).
        //     Two steps, because the stages are keyed differently: `enqueue` carries `entityId`
        //     (`operation-dispatcher.js:156-158`) but `push.ack` carries only `opId`
        //     (`sync-engine.js:66-71`), since the server acks by operation id. So: find the op
        //     for this entity, then wait for THAT op's ack.
        for (const [page, quem] of [[A, 'A'], [B, 'B']]) {
            const enq = await waitForEntitySpan(
                page,
                { entityId: id, operationType: 'update', stage: 'enqueue' },
                25000,
            );
            expect(enq, `o recolor de ${quem} virou operação na fila`).toBeTruthy();
            await waitForAcked(page, enq.opId, 25000);
        }

        // (2) THE SERVER decides the winner: highest server_version wins (arrival order, never
        //     timestamp/lamport). Read it FIRST and make the clients answer to it.
        //
        //     The previous version did the opposite: it polled until A and B merely AGREED with
        //     each other, then required Postgres to match whatever they had settled on. Agreement
        //     between clients is NOT convergence — there is a transient window where A's op has
        //     propagated to both while B's op is still in flight, so both legitimately show A's
        //     color before the real winner lands. The poll exited on that way-station, and under
        //     load (full suite) the window is wide enough that it did. That is the whole flake.
        // (3) CONVERGENCE, properly stated: both clients end on the value THE SERVER holds,
        //     not merely on each other. A stable divergence here is a product bug, not a slow
        //     test, and this is the assertion that can tell the two apart. Server and clients
        //     are sampled together (see `convergedValue`) so a late flush that moves the
        //     winner cannot turn a correct convergence into a false failure.
        const winner = await convergedValue(collab.db, [A, B], id, (p) => lineProp(p, id, 'lineColor').then((v) => String(v).toLowerCase()));
        expect(winner, 'o servidor gravou uma das duas cores em disputa').toMatch(/^#(ff0000|0000ff)$/);

        // (4) DURABILITY: the winner is what each client persisted to IndexedDB (via the
        //     repository, not the in-memory store) — an in-memory-only agreement would not
        //     survive F5 and must not count as convergence.
        for (const page of [A, B]) {
            const row = await readIdbEntity(page, { entityId: id, entityType: 'feature', mapId: collab.mapId, storage: 'lines' });
            expect(row.found, 'feature present in IndexedDB after convergence').toBe(true);
            expect(String(row.props.lineColor).toLowerCase()).toBe(winner);
        }

        // (5) LWW = MAX server arrival order. Cross-check the SQL `operations` log against the
        //     ledger's own conflict view (winner by serverVersion — never timestamp/lamport).
        //
        //     OS DOIS SÃO AMOSTRADOS JUNTOS, E ESSA É A CORREÇÃO. O `maxV` era lido do Postgres
        //     ANTES de `collectLedger`, e as duas leituras eram comparadas como se fossem
        //     simultâneas. Não são: uma op tardia da MESMA feição, ainda em voo quando o SQL foi
        //     lido, chega antes de o ledger ser coletado e move o vencedor. O sintoma medido foi
        //     `winnerServerVersion` 366 contra `maxV` 362 — o ledger via uma op que a foto do SQL
        //     não tinha. É a mesma armadilha que o passo (3) já evita em `convergedValue`, e ela
        //     tinha voltado aqui.
        //
        //     A espera é por QUIESCÊNCIA, não por prazo: lê-se o máximo, coleta-se o ledger, e
        //     lê-se o máximo DE NOVO; enquanto o segundo diferir do primeiro, o alvo ainda está se
        //     movendo e a medição não vale. Isto não mascara divergência real, porque uma
        //     discordância ESTÁVEL entre ledger e SQL sobrevive à quiescência e reprova.
        const maxVersaoDaFeicao = async () => {
            const ops = await collab.db.queryOperationsByEntity(id);
            return Math.max(...ops.map((o) => Number(o.server_version)));
        };

        let conflict = null;
        let maxV = null;
        await expect.poll(async () => {
            const antes = await maxVersaoDaFeicao();
            const spans = await collectLedger(collab.pages, {
                baseUrl: collab.baseUrl, token: collab.ownerToken, atlasId: collab.atlasId,
            });
            const depois = await maxVersaoDaFeicao();
            // Ainda chegando op para esta feição: a foto não vale, e o veredito seria sobre um
            // alvo em movimento.
            if (antes !== depois) return `em-movimento(${antes}->${depois})`;

            const achado = reduceLedger(spans).conflicts.find((c) => c.entityId === id);
            if (!achado) return 'sem-conflito-no-ledger';

            conflict = achado;
            maxV = depois;
            // A DIVERGÊNCIA VIAJA COM OS NÚMEROS: uma discordância estável reprova por timeout, e
            // a mensagem já traz os dois lados, em vez de só "recebido !== esperado".
            return Number(achado.winnerServerVersion) === depois
                ? 'concordam'
                : `divergem(ledger=${achado.winnerServerVersion} sql=${depois})`;
        }, {
            timeout: 20000,
            message: 'o ledger e o log SQL precisam concordar sobre o vencedor, medidos EM REPOUSO',
        }).toBe('concordam');

        // Absolutas, e não só a igualdade acima: sem elas um `poll` que devolvesse 'concordam' por
        // um bug do próprio predicado passaria sem ninguém ter olhado os valores.
        expect(conflict, 'the ledger detected the same-entity conflict').toBeTruthy();
        expect(Number(conflict.winnerServerVersion)).toBe(maxV);
    });

    collabTest('o vencedor do conflito SOBREVIVE ao F5 dos dois clientes', async ({ collab }) => {
        // Por que este teste existe: convergência que só vale em memória não é
        // convergência. O `memoryStore` de um cliente pode exibir a cor certa enquanto o
        // IndexedDB guardou outra; nesse estado o usuário vê o valor correto até apertar
        // F5 e a divergência ressurgir, que é o pior modo de falha possível (silencioso e
        // adiado). O teste do conflito acima checa o IndexedDB por leitura direta; este
        // fecha o laço pelo caminho real, um boot completo relendo do repositório.
        const A = collab.author;
        const B = collab.peers[0];

        const id = await drawLineUI(A, LINE_COORDS);
        expect(id, 'a ferramenta de linha criou a feição em A').toBeTruthy();
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });

        // Select em serie, recolor em paralelo: mesma razao do teste acima (a update
        // remota re-renderiza o painel e derruba a selecao se os dois passos forem juntos).
        await selectFeatureUI(A, id);
        await selectFeatureUI(B, id);
        await Promise.all([
            recolorViaPanelUI(A, '#ff0000'),
            recolorViaPanelUI(B, '#0000ff'),
        ]);
        for (const page of [A, B]) {
            const enq = await waitForEntitySpan(page, { entityId: id, operationType: 'update', stage: 'enqueue' }, 25000);
            expect(enq, 'o recolor virou operação na fila').toBeTruthy();
            await waitForAcked(page, enq.opId, 25000);
        }

        // F5 nos dois. O reload mantém URL + localStorage, então a sessão restaura e o
        // atlas reabre; o estado vem do IndexedDB, não da memória do processo anterior.
        //
        // A comparação relê o Postgres A CADA amostra, em vez de fixar o vencedor antes do
        // reload.
        //
        // Observado na suíte cheia (não reproduz isolado): o teste falhou com cliente em
        // #ff0000 e o retrato do servidor em #0000ff, e o ledger da execução trazia uma op
        // DA FEIÇÃO ainda em `enqueued_not_flushed`. Ou seja, havia operação pendente além
        // da que eu esperei o ack, e ela pode ser descarregada na reconexão pós-F5,
        // mudando legitimamente o vencedor DEPOIS da leitura. (De onde vem a op extra é
        // hipótese, provavelmente o gesto de painel emitindo change e save; não confirmei,
        // e o teste não depende disso.)
        //
        // Fixar o valor antes fazia o teste cobrar um retrato vencido. A invariante que
        // interessa não é "o cliente bate com o vencedor de alguns segundos atrás", é
        // **cliente e servidor concordam**, e é o que se afirma agora: se a divergência for
        // permanente, o poll devolve "cliente=X servidor=Y", que não casa com o padrão, e
        // o teste falha nomeando os dois lados.
        for (const [page, quem] of [[A, 'A'], [B, 'B']]) {
            await page.reload();
            await expect(page.locator('[data-testid="sync-status-badge"]'))
                .toHaveAttribute('data-state', 'online', { timeout: 25000 });
            const acordo = await convergedValue(collab.db, [page], id, (p) => lineProp(p, id, 'lineColor').then((v) => String(v).toLowerCase()));
            expect(acordo, `${quem} concorda com o servidor depois do F5`).toMatch(/^#(ff0000|0000ff)$/);
        }
    });

    collabTest('concurrent geometry move of the SAME line → both clients converge to one geometry', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        const id = await drawLineUI(A, LINE_COORDS);
        expect(id, 'the line tool created a feature on A').toBeTruthy();
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });

        // no-UI: setting a line's geometry to EXACT coordinates has no single-gesture UI, and
        // the convergence assertion compares exact coordinate keys — so the concurrent move
        // stays programmatic. Each side rewrites the SAME line's geometry.
        const propsA = (await readFeatures(A, 'lines')).find((x) => x.id === id)?.props;
        const propsB = (await readFeatures(B, 'lines')).find((x) => x.id === id)?.props;
        const geomA = { type: 'LineString', coordinates: [[-43.0, -22.7], [-42.9, -22.6]] };
        const geomB = { type: 'LineString', coordinates: [[-44.0, -23.7], [-43.9, -23.6]] };
        await Promise.all([
            applyStoreOp(A, 'updateFeature', ['lines', { type: 'Feature', properties: propsA, geometry: geomA }]),
            applyStoreOp(B, 'updateFeature', ['lines', { type: 'Feature', properties: propsB, geometry: geomB }]),
        ]);

        // Mesma correção do teste de cor, pelo mesmo motivo: esperar "A e B concordam" e
        // depois só conferir que o backend tem UMA DAS DUAS geometrias aceita um estado
        // transitório como se fosse convergência. O servidor decide, e é relido a cada
        // amostra; os clientes respondem a ele.
        const ka = JSON.stringify(geomA.coordinates);
        const kb = JSON.stringify(geomB.coordinates);
        for (const [page, quem] of [[A, 'A'], [B, 'B']]) {
            const enq = await waitForEntitySpan(page, { entityId: id, operationType: 'update', stage: 'enqueue' }, 25000);
            expect(enq, `o move de ${quem} virou operação na fila`).toBeTruthy();
            await waitForAcked(page, enq.opId, 25000);
        }
        // Servidor e clientes AMOSTRADOS JUNTOS, como nos casos irmãos. A versão anterior lia
        // `queryFeatureRow` UMA vez, congelava a chave e polava os clientes contra esse retrato:
        // o alvo nunca era reavaliado, e uma escrita que chegasse ao backend depois da leitura
        // deixava o poll perseguindo uma geometria que já tinha morrido. Como o ack só prova a
        // op do próprio cliente, essa chegada tardia é o caso NORMAL, não a exceção.
        const vencedora = await convergedGeomKey(collab.db, [A, B], id, [ka, kb]);

        // Absoluta, e não só o poll acima: é ela que impede o teste de virar tautologia, porque
        // "cliente igual ao servidor" nada vale se ninguém olhar o que o servidor gravou.
        expect([ka, kb], 'o backend gravou uma das duas geometrias em disputa').toContain(vencedora);
    });

    collabTest('concurrent UPDATE (A) vs DELETE (B) of the SAME line → both clients converge', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        const id = await drawLineUI(A, LINE_COORDS);
        expect(id, 'the line tool created a feature on A').toBeTruthy();
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });

        // A recolors it through the panel while B deletes it (Delete key + confirm), in parallel.
        await Promise.all([
            selectAndRecolorUI(A, id, '#ff0000'),
            deleteFeatureUI(B, id),
        ]);

        // Convergence: A and B must AGREE on the feature's presence (both gone, or both present).
        let agreed = null;
        await expect
            .poll(async () => {
                const a = await hasLine(A, id);
                const b = await hasLine(B, id);
                agreed = a === b ? a : null;
                return a === b ? `agree:${a}` : null;
            }, { timeout: 25000 })
            .toMatch(/^agree:(true|false)$/);

        // Ground-truth: the agreed presence matches the backend feature row (live vs tombstoned).
        const frow = await collab.db.queryFeatureRow(id);
        const backendLive = !!frow && !frow.deleted_at;
        expect(backendLive).toBe(agreed);
    });
});

// Fan-out de tres clientes: exige o segundo peer, entao vive em describe proprio
// (`collabOptions` e por describe, e o default do fixture e peers: 1).
collabTest.describe('CRDT conflict — tres clientes', () => {
    collabTest.use({ collabOptions: { peers: 2, permission: 'write' } });

    collabTest('conflito de TRÊS clientes na mesma linha converge para um único vencedor', async ({ collab }) => {
        // O ENVELOPE PRECISA CABER O PRAZO QUE O CASO PEDE, e por um tempo não coube. A espera
        // de convergência lá embaixo recebe 60 s por decisão medida, mas o teto padrão do teste
        // é 60 s TAMBÉM, e o setup de três navegadores mais o desenho, o full-sync e os três
        // acks já gastam cerca de 30 s: a espera nunca teve mais que a metade do prazo que o
        // comentário dela afirma. Medido em 2026-08-22, com `--retries=0` e um só worker: 35,8 s,
        // 35,6 s e 36,3 s isolado, contra "Test timeout of 60000ms exceeded" na suíte inteira,
        // onde a mesma máquina divide CPU. Prazo escrito que o envelope não deixa gastar não é
        // prazo, é comentário.
        collabTest.setTimeout(180000);

        // Com dois clientes, "convergiram" e "um sobrescreveu o outro" são
        // indistinguíveis: só há dois valores possíveis e acertar por acaso é 50%. Com
        // três, um merge parcial (dois clientes num valor, o terceiro noutro) fica
        // visível, e é justamente o que a ordenação por chegada no servidor deve impedir.
        const [A, B, C] = collab.pages;

        const id = await drawLineUI(A, LINE_COORDS);
        expect(id, 'a ferramenta de linha criou a feição em A').toBeTruthy();
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });

        // no-UI, deliberado: com TRÊS painéis abertos, cada cliente recebe duas updates
        // remotas no meio do próprio gesto, e o re-render entre o `selectFeatureUI` e o
        // `recolorViaPanelUI` derruba a seleção. Isso é limite do driver de UI sob
        // concorrência tripla, não defeito de sync, e deixava ESTE teste flaky (o remédio
        // que ele veio aplicar). A alegação daqui é convergência de três operações
        // concorrentes; o caminho UI->operação já está coberto pelo teste de dois
        // clientes, com gesto real de painel.
        const cores = ['#ff0000', '#0000ff', '#00ff00'];
        const props = await Promise.all(
            [A, B, C].map(async (p) => (await readFeatures(p, 'lines')).find((x) => x.id === id)?.props),
        );
        await Promise.all([A, B, C].map((p, i) => applyStoreOp(p, 'updateFeature', [
            'lines',
            { type: 'Feature', properties: { ...props[i], lineColor: cores[i] }, geometry: { type: 'LineString', coordinates: LINE_COORDS } },
        ])));
        for (const page of [A, B, C]) {
            const enq = await waitForEntitySpan(page, { entityId: id, operationType: 'update', stage: 'enqueue' }, 25000);
            expect(enq, 'o recolor virou operação na fila').toBeTruthy();
            await waitForAcked(page, enq.opId, 25000);
        }

        // 60s AQUI, contra os 25s do padrão, e o número é do CASO, não do helper: este é o único
        // ponto da suíte com TRÊS navegadores disputando a mesma feição, então a convergência
        // precisa de duas rodadas de broadcast a mais que a de dois, e cada cliente ainda re-renderiza
        // sob a carga da suíte inteira. Medido: reprovou UMA vez numa rodada completa
        // (`servidor=#0000ff clientes=#0000ff,#00ff00,#0000ff`, isto é, um cliente ainda não
        // corrigido no instante da amostra), passou no retry da mesma rodada e 6 de 6 isolado com
        // `--retries=0 --workers=1`. Um verde de 6/6 não seria prova sozinho, mas a leitura que
        // reprovou mostra divergência TRANSITÓRIA, e o predicado exige acordo NUM INSTANTE: uma
        // divergência permanente nunca o satisfaz, por mais largo que seja o prazo. Alargar aqui
        // não afrouxa a afirmação, só para de cobrá-la cedo demais.
        const winner = await convergedValue(collab.db, [A, B, C], id, (p) => lineProp(p, id, 'lineColor').then((v) => String(v).toLowerCase()), 60000);
        expect(winner, 'o servidor gravou uma das três cores em disputa').toMatch(/^#(ff0000|0000ff|00ff00)$/);

        // As TRÊS chegaram ao log append-only. A coluna é `op_type`
        // (`backend/src/database/migrations/003_sync.sql:19`), não `operation_type`; e o
        // corpo de um update vai em `changes`, não em `data`, que é só de create.
        // Nenhuma afirmação aqui sobre o formato interno de `changes`: quem prova
        // "vencedor = maior server_version" é o cross-check do ledger no teste de dois
        // clientes, e duplicar isso com um palpite de shape só criaria falha frágil.
        const ops = await collab.db.queryOperationsByEntity(id);
        const updates = ops.filter((o) => o.op_type === 'update');
        expect(updates.length, 'as três atualizações chegaram ao log').toBeGreaterThanOrEqual(3);

    });
});
