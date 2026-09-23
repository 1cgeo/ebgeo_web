// Path: e2e-ui/browser-collab-imagem-retomada.spec.js

/**
 * REGRESSÃO DE TELA, duas browsers reais e backend real: uma subida de blob INTERROMPIDA e depois
 * RETOMADA tem de terminar com o par ABRINDO a figura, e não com um buraco sob o mesmo id.
 *
 * O QUE ESTE SPEC PROVA, e o irmão `browser-collab-colar-imagem.spec.js` não prova. Aquele mede o
 * caminho feliz (os bytes sobem no gesto, a op viaja depois). Este mede a janela em que os bytes
 * NÃO sobem: a rota bulk é abortada por `page.route`, a fila durável
 * (`frontend/src/js/store/sync/blob-upload-queue.js`) grava a pendência antes do primeiro byte e a
 * op da FEIÇÃO fica PREPARADA, isto é, não sai no `peek`. Enquanto isso o par não recebe nada, que
 * é a única coisa melhor do que receber a op sem os bytes. Depois a subida é retomada sob o MESMO
 * id, por dois gatilhos diferentes (a volta ao ONLINE e o `connect` de um F5), e só então a op é
 * liberada e o par abre a figura.
 *
 * ================= O SINAL DECISIVO, E O SINAL QUE MENTE =================
 *
 * `__ebgeoMap.hasImage(id)` responde VERDADEIRO nos dois desfechos, porque um 404 instala o
 * placeholder de erro sob o mesmo id (`addErrorImageIfNeeded`, `layers/layer_setup.js`). Então ele
 * é inútil como discriminador, e o terceiro caso deste arquivo existe para mostrar isso ao vivo: a
 * mesma feição sem fila nenhuma chega ao par com `hasImage` verdadeiro e sem um byte no servidor.
 *
 * O sinal decisivo é o BLOB, por `store.getImage`, que cai no backend quando o cache local erra. O
 * par nunca teve estes bytes por outra via: a figura nasceu na outra browser e não é regenerável a
 * partir das propriedades (ao contrário de símbolo militar, medida de coordenação e declinação).
 * Junto vem o que o MAPA do par de fato desenha, lido em pixel por `map.getImage`: a figura tem 8
 * por 8 e a cor sólida escolhida aqui, o placeholder tem 64 por 64 e um X vermelho. Largura e cor
 * separam os dois sem depender de nenhuma promessa do cliente.
 *
 * A TERCEIRA TESTEMUNHA É O POSTGRES, e ela é independente das duas browsers: a linha de `images`
 * sob o id da feição, com `size_bytes` igual ao tamanho do blob do autor. Um `getImage` que
 * devolvesse qualquer coisa não moveria essa linha.
 *
 * ================= OS DOIS DEFEITOS QUE ESTE SPEC ENCONTROU =================
 *
 * Os dois viviam no caminho do F5, os dois eram mudos, e nenhuma suíte os alcançava:
 *
 *   1. O WIPE DE ENTRADA APAGAVA A DÍVIDA. `openRemoteAtlas` chama `clearAllDataStore`, que
 *      esvaziava os dez bancos de dado do escopo, e `ebgeo_images` é um deles: morriam a pendência
 *      E os bytes. O `connect` seguinte rodava a retomada e não achava nada para retomar, e a op da
 *      feição ficava PREPARADA para sempre, parando a fila de saída inteira por retenção
 *      head-of-line. Consertado poupando a dívida que o servidor não tem (o blob segue a fila de
 *      saída, porque é o payload dela): `unmountCurrentAtlas` → `preserveBlobUploads`. Repro em
 *      `frontend/tests/integration/wipe-poupa-blob-pendente.repro.test.js`.
 *   2. O RETRATO LIBERAVA A OP ANTES DOS BYTES. `applyRemoteSnapshot` reprojeta toda intenção
 *      pendente e marcava TODAS como materializadas, inclusive a da imagem cujo blob ainda subia.
 *      Medido três vezes em três: o par pedia a figura cerca de 1 s antes do fim da subida, tomava
 *      404 e instalava o placeholder de erro sob aquele id, que nunca mais é trocado. Consertado
 *      com o mesmo filtro do despachante, lido do DISCO. Repro em
 *      `frontend/tests/integration/retrato-nao-libera-op-sem-blob.repro.test.js`.
 *
 * Run headed:  npx playwright test browser-collab-imagem-retomada --headed
 */

import { collabTest, expect, readFeatures } from './helpers/collab.fixtures.js';
import { realFeature } from '../helpers/real-fixtures.js';

// A CORRIDA É O SUJEITO AQUI (subida interrompida, retomada, ordem entre op e bytes), então o
// retry do config mediria uma vez algo probabilístico e fecharia verde sobre a interleaving
// perdedora. Mesmo opt-out de `browser-multi-tab-namespace.spec.js`.
collabTest.describe.configure({ retries: 0 });

/** A rota que leva os BYTES. Não há op incremental de imagem: abortá-la é cortar o único caminho. */
const ROTA_BULK = '**/atlas/*/images/bulk';

/** Lado da figura de teste, em pixels. O placeholder de erro tem 64, então 8 os separa. */
const LADO = 8;

/** Cor sólida da figura de teste, escolhida longe do cinza e do vermelho do placeholder. */
const COR = Object.freeze({ r: 255, g: 0, b: 170 });

/** Quanto a rede fica fora. Dois batimentos de 25 s: ver {@link quedaEVoltaDaConexao}. */
const JANELA_OFFLINE_MS = 55000;

/**
 * Cria uma feição de imagem do jeito que a ferramenta cria: CUNHA o id localmente, guarda o blob
 * sob ele, manda o blob para a fila durável e só então grava a feição.
 *
 * `comFila: false` é o CONTROLE NEGATIVO, e ele não é uma simulação: é literalmente o produto sem
 * a fila de blobs, isto é, a feição gravada com o blob só no IndexedDB desta máquina. A op sai na
 * hora porque nada a segura, que é o desfecho que a fila existe para impedir.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} molde - Envelope da feição, sem o id (ele é cunhado aqui).
 * @param {{comFila: boolean}} opcoes
 * @returns {Promise<{id: string, tamanho: number, confirmado: boolean, estado: string|null}>}
 */
async function criarFeicaoDeImagem(page, molde, { comFila }) {
    return page.evaluate(async ({ base, fila, cor, lado }) => {
        const store = await import('/src/js/store/index.js');
        const { uploadImageBlob } = await import('/src/js/store/sync/image-sync.js');
        const { generateUUID } = await import('/src/js/utilities/uuid.js');

        // A figura é DESENHADA aqui, e não colada como base64, porque o teste precisa conhecer a
        // cor exata para lê-la de volta no bitmap do par. `toBlob` produz um PNG de verdade, cujos
        // magic bytes o servidor confere contra o mime declarado.
        const canvas = document.createElement('canvas');
        canvas.width = lado;
        canvas.height = lado;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = `rgb(${cor.r}, ${cor.g}, ${cor.b})`;
        ctx.fillRect(0, 0, lado, lado);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

        const imageId = generateUUID();
        await store.storeImage(imageId, blob);

        let envio = null;
        if (fila) envio = await uploadImageBlob(blob, imageId, { origem: 'feicao-de-imagem' });

        const feicao = {
            ...base,
            id: imageId,
            properties: { ...base.properties, id: imageId, nome: 'Foto de reconhecimento' },
        };
        await store.addFeature('images', feicao);
        return {
            id: imageId,
            tamanho: blob.size,
            confirmado: !!envio?.confirmado,
            estado: envio?.estado ?? null,
        };
    }, { base: molde, fila: comFila, cor: COR, lado: LADO });
}

/**
 * O estado da pendência e da fila de saída no AUTOR, para um id de imagem.
 *
 * `prontaParaEnvio` é a pergunta que importa: `peek` é o que o flush manda, e uma op preparada não
 * aparece nele. `naFila` prova ao mesmo tempo que a op existe, senão "não está no peek" seria
 * verdade também para uma op que nunca foi registrada.
 * @param {import('@playwright/test').Page} page
 * @param {string} imageId
 * @returns {Promise<Object>}
 */
function filaDeBlobs(page, imageId) {
    return page.evaluate(async (fid) => {
        const fila = await import('/src/js/store/sync/blob-upload-queue.js');
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        const { connectionState } = await import('/src/js/store/sync/connection-state.js');
        const { isImageSyncOnline } = await import('/src/js/store/sync/image-sync.js');
        const store = await import('/src/js/store/index.js');
        const registros = await fila.listarPendenciasDeBlob();
        const meu = registros.find((r) => r.imageId === fid) ?? null;
        const todas = await operationQueue.getAll();
        const prontas = await operationQueue.peek(50);
        return {
            estado: meu?.estado ?? null,
            tentativas: meu?.tentativas ?? null,
            ultimoErro: meu?.ultimoErro ?? null,
            tamanhoRegistrado: meu?.tamanho ?? null,
            segurando: fila.blobUploadPending(fid),
            naFila: todas.some((op) => op.entityId === fid),
            prontaParaEnvio: prontas.some((op) => op.entityId === fid),
            censo: await operationQueue.countByState(),
            // A RETOMADA TEM GATILHOS DECLARADOS, então quando ela não acontece a primeira
            // pergunta é se o gatilho chegou. Sem estes dois campos, "continua pendente" cobre
            // igualmente "ninguém tentou" e "tentou e o servidor recusou", que têm donos
            // diferentes.
            conexao: connectionState.getState(),
            imageSyncOnline: isImageSyncOnline(),
            // Os BYTES ainda existem nesta máquina? Uma pendência sem bytes não tem retomada
            // possível, e essa é a diferença entre um transporte que falhou e um wipe que passou.
            blobLocal: await store.hasImage(fid),
        };
    }, imageId);
}

/** O recorte de {@link filaDeBlobs} que uma espera de retomada precisa mostrar ao falhar. */
const retomada = (page, imageId) => filaDeBlobs(page, imageId).then((f) => ({
    estado: f.estado, tentativas: f.tentativas, ultimoErro: f.ultimoErro,
    conexao: f.conexao, imageSyncOnline: f.imageSyncOnline, blobLocal: f.blobLocal,
}));

/**
 * Espera a pendência de `imageId` ser CONFIRMADA e devolve a última leitura, boa ou má.
 *
 * DEVOLVE EM VEZ DE REPROVAR, e é por isso que não é um `expect.poll`: aquele imprime só as
 * chaves comparadas, e as chaves que explicam uma retomada que não aconteceu (o estado da
 * conexão, o número de tentativas, se os bytes ainda existem no disco) são justamente as que
 * ficariam de fora. Quem chama põe a leitura inteira na mensagem.
 * @param {import('@playwright/test').Page} page
 * @param {string} imageId
 * @param {number} [timeout]
 * @returns {Promise<Object>}
 */
async function esperarRetomada(page, imageId, timeout = 60000) {
    const limite = Date.now() + timeout;
    let ultima = await retomada(page, imageId);
    while (ultima.estado !== 'confirmado' && Date.now() < limite) {
        await page.waitForTimeout(500);
        ultima = await retomada(page, imageId);
    }
    return ultima;
}

/**
 * O estado da imagem `id` numa página: o blob (que pode vir do servidor) e o BITMAP que o mapa
 * desenha, em pixel.
 *
 * `imagemNoMapa` NÃO é o discriminador (o placeholder ocupa o mesmo id); `larguraNoMapa` e `pixel`
 * são, porque o placeholder tem 64 por 64 e um X vermelho no centro.
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 * @returns {Promise<Object>}
 */
function estadoDaImagem(page, id) {
    return page.evaluate(async (fid) => {
        const store = await import('/src/js/store/index.js');
        const map = globalThis.__ebgeoMap;
        // `getImage` cai no backend quando o cache local erra, e cacheia o que voltar: é ele que
        // responde "o servidor tem estes bytes".
        const blob = await store.getImage(fid);
        const bruta = map && typeof map.getImage === 'function' ? map.getImage(fid) : null;
        const bitmap = bruta?.data ?? bruta ?? null;
        const largura = bitmap?.width ?? null;
        const altura = bitmap?.height ?? null;
        let pixel = null;
        if (bitmap?.data && largura && altura) {
            const posicao = (Math.floor(altura / 2) * largura + Math.floor(largura / 2)) * 4;
            pixel = [
                bitmap.data[posicao], bitmap.data[posicao + 1],
                bitmap.data[posicao + 2], bitmap.data[posicao + 3],
            ];
        }
        return {
            temBlob: !!blob && blob.size > 0,
            tamanho: blob?.size ?? 0,
            blobLocal: await store.hasImage(fid),
            imagemNoMapa: !!(map && map.hasImage(fid)),
            larguraNoMapa: largura,
            pixel,
        };
    }, id);
}

/**
 * Derruba a conexão de A do jeito que a rede a derruba, e ESPERA o app notar antes de devolvê-la.
 *
 * A JANELA É LONGA DE PROPÓSITO, E O ESTADO NÃO MUDA DENTRO DELA. As duas metades foram medidas
 * nesta bancada em 2026-09-15, com uma sonda descartável, e as duas contrariam a intuição:
 *
 *   1. o app NÃO descobre um cabo desligado. O socket do WebSocket para o loopback sobrevive à
 *      emulação de offline, e o que acusa a queda é um PONG que não volta, com batimento de 25 s
 *      (`ws-client.js`): são precisos DOIS ticks (um marca o pong pendente, o outro fecha), ou
 *      seja, até 50 s. Com a janela de 1,5 s que o spec vizinho de reconexão usa, transição
 *      nenhuma acontece, e a retomada, que é assinante da transição, simplesmente não roda. O
 *      vermelho que isso produz se lê como defeito do produto (a pendência fica pendente, com
 *      `tentativas: 1`) e é do teste;
 *   2. e o `close` disparado pelo batimento só CHEGA quando a rede volta. A sonda registrou
 *      `online->reconnecting` 61,6 s depois do início e `reconnecting->online` 1,0 s adiante, com
 *      a rede já restaurada no segundo 60: esperar o estado sair de `online` ANTES de restaurar é
 *      esperar para sempre, e era o que a primeira versão desta função fazia.
 *
 * DAÍ O RECONHECIMENTO SER PELA TRANSIÇÃO, e não pelo estado final: "está online" é verdade também
 * para uma conexão que nunca caiu, de modo que a asserção seguinte estaria medindo nada. O
 * gravador é instalado antes da queda, e o que se espera é a volta a ONLINE aparecer nele.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function quedaEVoltaDaConexao(page) {
    await page.evaluate(async () => {
        const { connectionState } = await import('/src/js/store/sync/connection-state.js');
        globalThis.__ebgeoTransicoes = [];
        if (globalThis.__ebgeoOuveConexao) return;
        globalThis.__ebgeoOuveConexao = true;
        connectionState.onStateChanged((e) => {
            globalThis.__ebgeoTransicoes?.push(`${e.previousState}->${e.currentState}`);
        });
    });

    await page.context().setOffline(true);
    // Firefox bloqueia novos sockets em offline, mas continua entregando frames no socket
    // existente. Fechar o transporte garante uma queda real nos dois navegadores; o cliente
    // continua responsavel por detectar a queda, reconectar e retomar a fila de blobs.
    await page.evaluate(async () => {
        const { wsClient } = await import('/src/js/store/sync/ws-client.js');
        wsClient._socket?.close(4000, 'network fault injection');
    });
    await page.waitForTimeout(JANELA_OFFLINE_MS);
    await page.context().setOffline(false);

    await expect
        .poll(() => page.evaluate(() => globalThis.__ebgeoTransicoes ?? []), {
            timeout: 120000,
            message: 'a conexão não voltou a ONLINE por uma TRANSIÇÃO (que é o gatilho da retomada)',
        })
        .toContain('reconnecting->online');
}

/** A linha de `images` no Postgres, que é a testemunha independente das duas browsers. */
async function linhaDeImagem(collab, imageId) {
    if (!collab.db) return null;
    return collab.db.raw.oneOrNone('SELECT id, size_bytes FROM images WHERE id = $1', [imageId]);
}

/** O molde da feição de imagem, com as props que o desenho do ícone lê. */
const moldeDeImagem = () => realFeature('image', {
    width: 64, height: 64, size: 1, rotation: 0, opacity: 1,
    createdAtZoom: 0, calculatedSize: 1, zoomCorrectionEnabled: true, selectionBox: null,
});

/**
 * Começa a anotar o que o par diz sobre imagens, para o caso de ele desenhar o placeholder.
 *
 * `loadSingleImage` (`layers/layer_setup.js`) escreve no console a ÚNICA linha que distingue "o
 * blob não estava lá quando eu desenhei" de "desenhei outra coisa", e essa informação existe uma
 * vez e some. Sem ela, um mapa com o ícone de erro só sabe dizer que tem 64 px de largura.
 * @param {import('@playwright/test').Page} par
 * @returns {string[]} O balde, que segue enchendo.
 */
function anotarImagensDoPar(par) {
    const ditas = [];
    const t0 = Date.now();
    par.on('console', (msg) => {
        const texto = msg.text();
        if (/imagem/i.test(texto)) ditas.push(`+${Date.now() - t0}ms ${msg.type()}: ${texto}`.slice(0, 220));
    });
    // A RESPOSTA HTTP É A OUTRA METADE, e é a que diz de quem é a culpa: "não encontrada no store"
    // cobre igualmente "o servidor respondeu 404" e "o pedido nem chegou". O status separa os dois.
    par.on('response', (res) => {
        if (!/\/images\//.test(res.url())) return;
        ditas.push(`+${Date.now() - t0}ms HTTP ${res.status()} ${res.url().slice(-48)}`);
    });
    return ditas;
}

/**
 * Afirma que o par abriu a FIGURA: os bytes vieram do servidor e o bitmap desenhado é o da figura,
 * não o do placeholder de erro.
 * @param {import('@playwright/test').Page} par
 * @param {{id: string, tamanho: number}} foto
 * @param {string[]} [ditas] - O balde de {@link anotarImagensDoPar}, para o diagnóstico.
 * @returns {Promise<void>}
 */
async function esperarFiguraNoPar(par, foto, ditas = []) {
    await expect
        .poll(() => estadoDaImagem(par, foto.id), {
            timeout: 30000,
            message: 'o par nao conseguiu abrir o blob da imagem pelo servidor',
        })
        .toMatchObject({ temBlob: true, tamanho: foto.tamanho });

    try {
        await expect
            .poll(() => estadoDaImagem(par, foto.id).then((e) => e.larguraNoMapa), {
                timeout: 30000,
                message: `o mapa do par nao desenhou a figura de ${LADO}px (64 e o placeholder de erro)`,
            })
            .toBe(LADO);
    } catch (erro) {
        erro.message += `\n  [o que o par disse sobre imagens] ${ditas.join(' | ') || '(nada)'}`;
        throw erro;
    }

    const noPar = await estadoDaImagem(par, foto.id);
    expect(noPar.blobLocal, 'o blob que voltou do servidor não foi cacheado no par').toBe(true);
    const [r, g, b, a] = noPar.pixel;
    expect(a, 'o pixel central do ícone desenhado no par está transparente').toBe(255);
    // Folga de 12 na soma dos três canais: o ida e volta canvas -> PNG -> decode do Chromium é
    // sem perda, mas a asserção exata mediria o gerenciamento de cor do navegador, e a distância
    // até o placeholder (cinza claro ou vermelho) é de centenas.
    expect(
        Math.abs(r - COR.r) + Math.abs(g - COR.g) + Math.abs(b - COR.b),
        `o pixel central no par é rgb(${r},${g},${b}) e deveria ser a cor da figura`,
    ).toBeLessThanOrEqual(12);
}

collabTest.describe('Uma subida de blob interrompida e retomada entrega a figura ao par', () => {
    collabTest('a op espera o blob, e a volta ao ONLINE retoma a subida sob o mesmo id', async ({ collab }) => {
        // O orçamento padrão é de 60 s e este caso espera DUAS coisas lentas de propósito: a
        // janela em que curar a rota não retoma nada, e os dois batimentos que o WebSocket leva
        // para notar a queda (ver `quedaEVoltaDaConexao`).
        collabTest.setTimeout(360000);
        const A = collab.author;
        const B = collab.peers[0];
        const ditas = anotarImagensDoPar(B);

        // ----- A rota dos BYTES cai, e só ela -----
        await A.route(ROTA_BULK, (route) => route.abort('failed'));

        const foto = await criarFeicaoDeImagem(A, moldeDeImagem(), { comFila: true });
        expect(foto.confirmado, 'a subida foi confirmada com a rota abortada').toBe(false);
        expect(foto.estado, 'uma falha de TRANSPORTE tem de ficar pendente, nunca recusada').toBe('pendente');

        // ----- A pendência existe e a op da feição está PRESA -----
        const presa = await filaDeBlobs(A, foto.id);
        expect(presa.estado).toBe('pendente');
        expect(presa.segurando, 'a fila não está segurando o id da imagem').toBe(true);
        expect(presa.naFila, 'a op da feição não chegou a ser registrada').toBe(true);
        expect(presa.prontaParaEnvio, 'a op da feição saiu no peek antes de os bytes subirem').toBe(false);
        expect(presa.censo.preparadas).toBeGreaterThanOrEqual(1);

        // ----- O par não recebe NADA, que é melhor do que receber a op sem os bytes -----
        await collab.expectNotSynced(
            { entityId: foto.id, type: 'images', operationType: 'create' },
            { settle: 5000 },
        );
        expect(await linhaDeImagem(collab, foto.id), 'o servidor guardou bytes com a rota abortada').toBeNull();

        // ----- CONTROLE: curar a rota NÃO retoma nada sozinho -----
        // A retomada tem gatilhos declarados (a transição para ONLINE e o `connect`), e não um
        // temporizador. Sem este trecho, o verde adiante não distinguiria "a retomada funcionou"
        // de "o tempo passou e alguma retentativa anônima pegou".
        await A.unroute(ROTA_BULK);
        await A.waitForTimeout(3000);
        expect((await filaDeBlobs(A, foto.id)).estado, 'algo retomou a subida sem gatilho nenhum').toBe('pendente');
        expect(await linhaDeImagem(collab, foto.id)).toBeNull();

        // ----- A VOLTA AO ONLINE retoma, sob o MESMO id -----
        await quedaEVoltaDaConexao(A);

        const desfecho = await esperarRetomada(A, foto.id);
        expect(
            desfecho.estado,
            `a pendência não foi confirmada depois da volta ao online: ${JSON.stringify(desfecho)}`,
        ).toBe('confirmado');

        // Testemunha independente das duas browsers: a linha no Postgres, sob o id da FEIÇÃO.
        await expect
            .poll(() => linhaDeImagem(collab, foto.id).then((l) => l?.size_bytes ?? null), { timeout: 20000 })
            .toBe(foto.tamanho);

        // ----- Liberada, a op percorre a cadeia inteira até o par -----
        await collab.expectFullSync({
            entityId: foto.id, type: 'images', operationType: 'create', skipRender: true, timeout: 40000,
        });
        await esperarFiguraNoPar(B, foto, ditas);

        // Controle do instrumento: um id que ninguém criou não resolve no par. Sem ele, um
        // `getImage` que devolvesse qualquer coisa passaria em tudo acima.
        const inventado = await estadoDaImagem(B, '00000000-0000-4000-8000-000000000000');
        expect(inventado.temBlob, 'getImage devolveu bytes para um id que ninguém criou').toBe(false);
    });

    collabTest('a pendência sobrevive ao F5 e o connect a retoma', async ({ collab }) => {
        collabTest.setTimeout(360000);
        const A = collab.author;
        const B = collab.peers[0];
        const ditas = anotarImagensDoPar(B);

        await A.route(ROTA_BULK, (route) => route.abort('failed'));
        const foto = await criarFeicaoDeImagem(A, moldeDeImagem(), { comFila: true });
        expect(foto.estado).toBe('pendente');

        const presa = await filaDeBlobs(A, foto.id);
        expect(presa.segurando).toBe(true);
        expect(presa.prontaParaEnvio).toBe(false);

        await collab.expectNotSynced(
            { entityId: foto.id, type: 'images', operationType: 'create' },
            { settle: 4000 },
        );

        // ----- F5 NO MEIO. A pendência mora no banco de IMAGENS do escopo, então ela atravessa o
        // recarregamento junto com os bytes que ela nomeia, e quem a lê de novo é o `connect`. -----
        await A.unroute(ROTA_BULK);
        await A.reload();
        await A.waitForFunction(
            () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.loaded === 'function'
                && globalThis.__ebgeoMap.loaded(),
            null,
            { timeout: 40000 },
        );

        const desfecho = await esperarRetomada(A, foto.id);
        expect(
            desfecho.estado,
            `o connect depois do F5 não retomou a pendência: ${JSON.stringify(desfecho)}`,
        ).toBe('confirmado');
        await expect
            .poll(() => linhaDeImagem(collab, foto.id).then((l) => l?.size_bytes ?? null), { timeout: 20000 })
            .toBe(foto.tamanho);

        // O par recebe a op liberada. O `expectFullSync` não serve aqui: o anel de trace do autor
        // nasceu de novo com o F5, então o `apply.persist` do elo 1 não está mais nele. O que
        // sobra é o que o par de fato tem, mais a linha da feição no Postgres.
        await expect
            .poll(async () => (await readFeatures(B, 'images')).some((f) => f.id === foto.id), {
                timeout: 60000,
                message: 'a op liberada depois do F5 não chegou ao par',
            })
            .toBe(true);
        expect(
            await collab.db.raw.oneOrNone('SELECT id FROM features WHERE id = $1', [foto.id]),
            'a feição liberada não chegou ao Postgres',
        ).not.toBeNull();

        await esperarFiguraNoPar(B, foto, ditas);
    });

    collabTest('CONTROLE NEGATIVO: sem a fila, a op chega antes dos bytes e map.hasImage mente', async ({ collab }) => {
        collabTest.setTimeout(120000);
        const A = collab.author;
        const B = collab.peers[0];

        // Sem a fila durável, a feição é gravada com o blob só no IndexedDB do autor. É o produto
        // de antes de B8, e é o desfecho que os dois casos acima existem para impedir.
        const foto = await criarFeicaoDeImagem(A, moldeDeImagem(), { comFila: false });

        const semFila = await filaDeBlobs(A, foto.id);
        expect(semFila.estado, 'houve pendência registrada onde o controle não registra nenhuma').toBeNull();
        expect(semFila.segurando, 'a fila segurou um id que ela nunca recebeu').toBe(false);

        // A op sai na hora, porque nada a segura, e percorre a cadeia inteira.
        await collab.expectFullSync({
            entityId: foto.id, type: 'images', operationType: 'create', skipRender: true, timeout: 30000,
        });
        expect(
            await linhaDeImagem(collab, foto.id),
            'os bytes chegaram ao servidor sem a fila, e então este controle não controla nada',
        ).toBeNull();

        // ----- A RÉGUA ERRADA RESPONDE VERDADEIRO SOBRE UM BURACO -----
        await expect
            .poll(() => estadoDaImagem(B, foto.id).then((e) => e.imagemNoMapa), {
                timeout: 30000,
                message: 'o par nem chegou a registrar uma imagem sob este id',
            })
            .toBe(true);

        const noPar = await estadoDaImagem(B, foto.id);
        expect(noPar.imagemNoMapa, 'map.hasImage deveria responder verdadeiro com o placeholder de 404').toBe(true);
        expect(noPar.larguraNoMapa, 'o que o par desenhou não é o placeholder de erro de 64px').toBe(64);
        // ----- A RÉGUA CERTA ACUSA -----
        expect(noPar.temBlob, 'o par abriu bytes que nunca subiram ao servidor').toBe(false);
        expect(noPar.blobLocal, 'o par tem o blob localmente, e ele só existia no autor').toBe(false);
    });
});
