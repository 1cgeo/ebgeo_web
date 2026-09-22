// Path: e2e-ui/first-person-collaboration.spec.js
/**
 * O QUE ESTE SPEC TEM DE INSTAVEL, MEDIDO EM 2026-09-21, e nao e' a carga da cena.
 *
 * A rodada completa daquele dia o reprovou uma vez em `toBeVisible` de `#first-person-container`
 * ("Received: hidden"), e a leitura natural era o motor de primeira pessoa (chunk grande com WASM
 * mais uma cena de 20 MB) estourando os 10 s. Medido em serie, 16 execucoes (10 num worktree com o
 * motor sem pre-bundle, 6 na arvore principal com o harness padrao): as 44 esperas pelo container
 * foram satisfeitas, pior caso 3318 ms, tres vezes dentro do orcamento; zero queda de
 * renderizador, zero erro de pagina. A falha "hidden" so' reaparece na RODADA COMPLETA (1 em
 * cada uma das duas do dia), e o trace dela disse a causa: `[first-person] scene not found:
 * museu-1cgeo`. O tileset e' semeado por SQL, o `/api/config` e' memoizado pelo harness com
 * invalidacao so' na escrita pela API, e a pagina abria com o catalogo que o spec ANTERIOR
 * aquecera, sem a cena; `doOpenFirstPersonViewer` registra o erro, esconde o container e retorna
 * sem lancar. Fechado por `esperarCatalogoServido` (helper de semeadura), que espera o catalogo
 * SERVIDO refletir a linha antes de qualquer pagina abrir.
 *
 * O que reprovava de verdade, 3 vezes em 16 (uma em cada seis, nas duas arvores), era outro passo:
 * o comentario espacial nao chegava ao Postgres em 10 s (`expect.poll` sobre `comments`). MEDIDO
 * em 2026-09-22, na arvore principal, com uma sonda passiva dentro da pagina e 10 execucoes em
 * serie. O gesto NUNCA e' recusado e a op NUNCA se perde: nas 10, o contexto do clique era
 * identico ao da abertura da cena (mesmo mapa corrente, mesmo usuario, atlas remoto, permissao
 * concedida), com ZERO `STORE_OPERATION_BLOCKED`, zero toast e `problemas: 0` no censo da fila; o
 * cartao de compose sempre fechou, isto e', o `aoEnviar` sempre devolveu verdadeiro.
 *
 * O TEMPO SE PARTE EM DOIS, E SO' O SEGUNDO VARIA. A escrita local (clique ate `COMMENT_CREATED`)
 * custou de 2,73 a 3,26 s em 17 das 18 execucoes das duas baterias. O que oscila e' a op JA'
 * ENVIAVEL esperando o flush, com o intervalo do auto-flush em 1,5 s: de 0,24 a 11,3 s na
 * primeira bateria (10 execucoes, 5 passariam nos 10 s) e de 7,3 a 10,5 s na SEGUNDA (8
 * execucoes com a sonda reduzida ao minimo, nenhuma passaria). A segunda bateria e' o controle
 * do instrumento, e ela saiu PIOR, o que descarta a sonda como causa.
 *
 * A causa e' a thread principal. O motor de primeira pessoa a mantem ocupada: um temporizador de
 * 250 ms dentro da pagina foi entregue a cada 0,50 a 0,58 s na mediana, com pior caso de 0,87 s,
 * ou seja a pagina roda a cerca de 2 quadros por segundo. Cada salto de IndexedDB espera um
 * desses quadros, e o ciclo de flush faz muitos: ele comeca por uma caminhada inteira da fila
 * (`operationQueue.countByState()`, medida em ~4 s com uma op) e, so' entao, `engine.flush()`
 * caminha de novo para montar o lote. Um ciclo que comece antes de a op existir gasta a primeira
 * caminhada para responder zero, e o proximo gasta outra para enfim ver a op. Nada disso e'
 * defeito de produto (num navegador com GPU o quadro custa ~16 ms), mas os 10 s de `expect.poll`
 * sobre o Postgres eram um orcamento apertado demais para uma pagina nessa condicao.
 *
 * POR ISSO A ESPERA E' POR ESTADO, e por REDE e nao por leitura da fila: medido, a fila deste
 * cliente so' zera de 5,9 a 8,9 s DEPOIS de a linha existir no Postgres (o recibo tambem paga
 * saltos de IndexedDB), de modo que esperar pelo censo custaria mais que o proprio veredito, e
 * cada leitura dele dentro da pagina disputa com o flush. Na mesma data os tres `COMMENT_*`
 * entraram em `FLUSH_TRIGGER_EVENTS` (`store/sync/sync-flush.js`): e' o gatilho certo, porque o
 * comentario tem produtor local, mas ele economiza no maximo um tique de 1,5 s e AQUI nem isso,
 * porque com ciclos de ~4 s o laco esta sempre em voo e `flushOnce` volta na hora. Quem tira a
 * corrida e' a espera por estado.
 *
 * E UM ACHADO DE PRODUTO que a medicao deixou: um Worker que nao carrega deixa `parseSplatData` do
 * motor pendurado para sempre, sem rejeitar e sem limite de tempo, com a tela em "19,1 MB de
 * 19,1 MB" (worker alcancavel: 439 ms; worker recusado: mais de 280 s sem uma linha de erro). O
 * gatilho medido foi ambiental (num worktree cujo `node_modules` e' juncao, o `new URL` do
 * pre-bundle do Vite sai da raiz do servidor e o worker responde 404), mas o silencio e' do motor.
 * Por isso este spec NAO roda num worktree de agente: so' a arvore principal mede o produto.
 */
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readState } from './state.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';
import { seedTileset, esperarCatalogoServido } from './helpers/catalog-seed.js';
import { createDb, closeDb } from './helpers/db.js';

const state = readState();
const museum = new URL('../../public/3d/primeira-pessoa/museu-1cgeo/cena.sog', import.meta.url);
test.describe.configure({ retries: 0, timeout: 180000 });
test.use({ screenshot: 'only-on-failure', trace: 'retain-on-failure' });
test.skip(state.skip || !existsSync(museum), 'Requires the locally installed museum splat and real backend');

async function openMuseum(page, pose) {
    await page.bringToFront();
    await page.evaluate(async (pose) => {
        const viewer = await import('/src/js/first_person_3d_tool/first_person_viewer.js');
        await viewer.openFirstPersonViewer('museu-1cgeo', { pose });
    }, pose);
    await expect(page.locator('#first-person-container')).toBeVisible();
    await expect(page.locator('#first-person-loading')).toBeHidden();
}

test('museum: walker presence, sidebar comment, peer persistence and reopening', async ({ browser }, info) => {
    const db = createDb(state.dbName);
    // `esperarCatalogo: false`: o UPDATE do config vem depois, e a espera única é a de baixo,
    // senão a do semeador rebobina o TTL do memo e a segunda paga o tempo inteiro de novo.
    await seedTileset(state.dbName, { id: 'museu-1cgeo', name: 'Sala Histórica General Malan', esperarCatalogo: false });
    await db.raw.none('UPDATE tilesets SET config = $1 WHERE id = $2', [{
        viewer: 'firstPerson', forma3d: 'indoor', basePath: '/3d/primeira-pessoa/museu-1cgeo', fov: 60,
        locate: { lon: -51.2, lat: -30.03 }, poseInicial: { x: 3.82, y: 0.55, z: 1.42, yaw: 0, pitch: 0 },
    }, 'museu-1cgeo']);
    // O catálogo SERVIDO precisa ter a cena antes de qualquer página abrir: ver o helper.
    await esperarCatalogoServido(state.baseUrl, 'tilesets',
        (item) => item?.id === 'museu-1cgeo' && item?.viewer === 'firstPerson');
    const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'comment' });
    await db.raw.none("UPDATE users SET nome = 'Felipe de Carvalho Diniz', nome_guerra = 'Diniz', rank_id = (SELECT id FROM ranks WHERE nome_abrev = 'Maj' LIMIT 1) WHERE id = $1", [seed.userA.id]);
    const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
    const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
    try {
        await A.setViewportSize({ width: 1000, height: 720 });
        await B.setViewportSize({ width: 1000, height: 720 });
        await test.step('open author museum', () => openMuseum(A));
        await test.step('open peer museum', () => openMuseum(B, { x: 3.82, y: 0.55, z: 3.42, yaw: 0, pitch: 0 }));
        await expect(B.locator('.fp3d-person')).toContainText('Maj Diniz', { timeout: 15000 });
        const readPeer = () => B.evaluate(async () => {
            const { presenceStore } = await import('/src/js/presence/presence-store.js');
            return presenceStore.getCursors('fp', 'museu-1cgeo').find((p) => p.userName === 'Maj Diniz')?.position;
        });
        const before = await readPeer();
        const canvas = A.locator('#first-person-canvas');
        const box = await canvas.boundingBox();
        await A.mouse.move(box.x + 100, box.y + 100);
        await A.mouse.move(box.x + box.width - 100, box.y + box.height - 100);
        await expect.poll(async () => {
            const p = await readPeer(); return Math.hypot(p.x - before.x, p.z - before.z);
        }).toBeLessThan(0.01);
        await A.bringToFront();
        await A.keyboard.down('KeyW');
        await expect.poll(async () => {
            const p = await readPeer(); return Math.hypot(p.x - before.x, p.z - before.z);
        }).toBeGreaterThan(0.15);
        await A.keyboard.up('KeyW');

        // Use the existing sidebar control; no extra comment button in the viewer.
        await A.locator('[data-tab="mapas"]').click();
        await A.locator('[data-testid="comments-new"]').click();
        await expect(A.locator('#first-person-container')).toHaveClass(/fp3d-commenting/);
        await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
        await expect(A.locator('.comment-card--compose textarea')).toBeVisible();
        await A.locator('.comment-card--compose textarea').fill('Revisar vitrine do museu');
        // A ESPERA E' POR ESTADO, EM DOIS DEGRAUS ANTES DO VEREDITO, e a razao esta no cabecalho.
        // O envio e' armado ANTES do clique, senao a resposta pode chegar antes da espera. Nenhum
        // dos dois degraus roda codigo DENTRO da pagina, de proposito: ler a fila por
        // `page.evaluate` custa a mesma caminhada de IndexedDB que o proprio flush faz, e com a
        // thread principal a ~2 quadros por segundo o instrumento disputa com o que esta medindo.
        const envioDoComentario = A.waitForResponse(
            (r) => r.url().endsWith('/sync') && r.request().method() === 'POST' && r.status() === 200,
            { timeout: 60000 });
        await A.locator('.comment-card--compose .comment-composer__btn--primary').click();
        // Primeiro degrau, e ele separa RECUSA de LENTIDAO: o `aoEnviar` de `collaboration-fp.js`
        // devolve `false` em silencio quando o mapa corrente ou a sessao mudaram, e nesse caso o
        // cartao NAO fecha e nenhuma linha vai existir nunca. Esperar pelo Postgres primeiro gasta
        // o orcamento inteiro para depois dizer "esperava 1, recebeu 0".
        await expect(A.locator('.comment-card--compose')).toHaveCount(0, { timeout: 60000 });
        // Segundo degrau: a op saiu deste cliente e o servidor aceitou o lote. Medido em
        // 2026-09-22, este e' o UNICO POST de sync que A faz ate aqui (10 execucoes em serie, zero
        // requisicoes antes do clique), entao a primeira resposta que casa e' a do comentario.
        // Depois dela a linha ja esta commitada e a assercao abaixo e' veredito, nao corrida.
        await envioDoComentario;
        await expect.poll(async () => (await db.raw.any('SELECT data FROM comments WHERE map_id = $1', [seed.mapId])).length).toBe(1);
        const [saved] = await db.raw.any('SELECT id, data FROM comments WHERE map_id = $1', [seed.mapId]);
        expect(saved.data).toMatchObject({ surface: 'fp', tilesetId: 'museu-1cgeo', text: 'Revisar vitrine do museu' });
        expect([saved.data.x, saved.data.y, saved.data.z].every(Number.isFinite)).toBe(true);
        await expect.poll(() => B.evaluate(async (id) => {
            const store = await import('/src/js/store/index.js');
            return (await store.getComments(store.getCurrentMapNameSync()))[id]?.text;
        }, saved.id)).toBe('Revisar vitrine do museu');
        await B.evaluate(async (id) => (await import('/src/js/first_person_3d_tool/first_person_viewer.js')).focusFirstPersonComment(id), saved.id);
        await expect(B.locator('.comment-card')).toContainText('Revisar vitrine');
        await B.locator('.comment-card textarea').fill('Conferido');
        // A resposta corre a MESMA corrida do comentario raiz, e no cliente B, que tambem tem a
        // cena de primeira pessoa aberta. Mesmo degrau, mesma razao.
        const envioDaResposta = B.waitForResponse(
            (r) => r.url().endsWith('/sync') && r.request().method() === 'POST' && r.status() === 200,
            { timeout: 60000 });
        await B.locator('.comment-card .comment-composer__btn--primary').click();
        await envioDaResposta;
        await expect.poll(async () => (await db.raw.any('SELECT id FROM comments WHERE map_id = $1', [seed.mapId])).length).toBe(2);
        await B.screenshot({ path: info.outputPath('museum-comments-presence.png') });
        await B.locator('#close-first-person-button').click();
        await openMuseum(B);
        await B.evaluate(async (id) => (await import('/src/js/first_person_3d_tool/first_person_viewer.js')).focusFirstPersonComment(id), saved.id);
        await expect(B.locator('.comment-card')).toContainText('Conferido');
        await B.locator('.comment-card textarea').click();
        await expect(B.locator('.comment-card')).toBeVisible();
        await B.locator('#first-person-canvas').click({ position: { x: 30, y: 120 } });
        await expect(B.locator('.comment-card')).toHaveCount(0);
        await A.locator('#close-first-person-button').click();
        await expect(B.locator('.fp3d-person')).toHaveCount(0);
    } finally {
        await Promise.allSettled([A.context().close(), B.context().close()]);
        await closeDb();
    }
});
