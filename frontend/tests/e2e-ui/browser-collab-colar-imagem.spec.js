// Path: e2e-ui/browser-collab-colar-imagem.spec.js

/**
 * REGRESSÃO DE TELA, duas browsers reais e backend real: colar uma feição de IMAGEM num atlas
 * de SERVIDOR tem de fazer os BYTES chegarem ao par, não só a feição.
 *
 * O DEFEITO. `paste()` cunha um id novo e chama `IDUtils.duplicateImageResource`, que é
 * `getImage` + `storeImage`: as duas escrevem no IndexedDB desta máquina e nenhuma sobe byte
 * nenhum. Não existe op incremental de imagem no vocabulário de sync, então a op da feição
 * viajava sozinha. No par, `getImage(idNovo)` errava localmente, caía no backend, tomava 404, e
 * o carregador instalava o PLACEHOLDER DE ERRO. Nada lançava, dos dois lados. Consertado com a
 * subida pela porta bulk (a única que preserva o `localId` como id), por
 * `uploadCopiedBlobsIfRemote` (`frontend/src/js/store/upload-copied-blobs.js`), ANTES de
 * `addFeatures` logar as ops.
 *
 * ================= COMO ESTE SPEC DISTINGUE O CONSERTO DO DEFEITO =================
 *
 * `__ebgeoMap.hasImage(idNovo)` NÃO é o sinal decisivo aqui, e é justamente onde este spec
 * diverge do modelo (`browser-collab-symbol-snapshot-regen.spec.js`). Quando o blob falta,
 * `loadSingleImage` (`layers/layer_setup.js`) instala uma imagem de ERRO sob o MESMO id, então
 * o mapa "tem imagem" nos dois desfechos: uma asserção só nele fecharia verde sobre o defeito.
 *
 * O sinal decisivo é o BLOB. `store.hasImage` lê SÓ o cache local e `store.getImage` cai no
 * backend quando o cache erra, cacheando o que voltar. O par nunca teve estes bytes por
 * nenhuma outra via (a colagem aconteceu na outra browser, e a imagem não é regenerável a
 * partir das propriedades, ao contrário de símbolo militar, medida de coordenação e
 * declinação). Logo: `getImage(idNovo)` devolver bytes no par significa que o SERVIDOR os
 * tinha, e é isso que era falso antes do conserto. O TAMANHO entra junto, porque um blob de
 * zero byte ou o PNG de outro id passariam num `!!blob`.
 *
 * DOIS CONTROLES, um de cada lado do sinal:
 *   - a imagem ORIGINAL resolve no par (ela subiu por `uploadImageBlob` na criação). Sem ele,
 *     um caminho de busca completamente quebrado se leria como "o defeito continua".
 *   - um id INVENTADO não resolve no par. Sem ele, um `getImage` que devolvesse qualquer coisa
 *     para qualquer id passaria em tudo acima.
 *
 * A COLAGEM É A REAL, pelo `ClipboardManager` do registro de controles, que é o mesmo caminho
 * de Ctrl+V, de "Colar Aqui" e de "Duplicar Seleção" (`context-menu/context-menu.control.js`).
 * A criação da feição, essa sim, é por op de store: a ferramenta de imagem depende de um
 * seletor de arquivo e de redimensionamento em canvas, e o sujeito aqui é a colagem.
 *
 * Run headed:  npx playwright test browser-collab-colar-imagem --headed
 */

import { collabTest, expect, readFeatures } from './helpers/collab.fixtures.js';
import { realFeature } from '../helpers/real-fixtures.js';

/** PNG 1x1 de verdade: o servidor confere os magic bytes contra o mime declarado. */
const PNG_1X1_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * Cria uma feição de imagem do jeito que a ferramenta cria: sobe o blob (o servidor cunha o
 * id), guarda-o localmente sob esse id e grava a feição.
 * @param {import('@playwright/test').Page} page
 * @param {Object} feature - Envelope da feição, sem o id (ele vem do servidor)
 * @returns {Promise<{ id: string|null, tamanho: number }>}
 */
async function criarImagem(page, feature) {
    return page.evaluate(async ({ base64, molde }) => {
        const store = await import('/src/js/store/index.js');
        const { uploadImageBlob } = await import('/src/js/store/sync/image-sync.js');

        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'image/png' });

        // O id da feição de imagem É o id do registro no servidor (o mesmo contrato de
        // `draw_tools/image_tool/add_image_control.js`).
        const registro = await uploadImageBlob(blob, 'colar.png');
        if (!registro?.id) return { id: null, tamanho: blob.size };

        await store.storeImage(registro.id, blob);
        const feicao = {
            ...molde,
            properties: { ...molde.properties, id: registro.id, nome: 'Imagem colável' },
        };
        await store.addFeature('images', feicao);
        return { id: registro.id, tamanho: blob.size };
    }, { base64: PNG_1X1_BASE64, molde: feature });
}

/** Seleciona a feição e roda o copiar/colar REAL (o caminho de "Duplicar Seleção"). */
async function copiarEColar(page, featureId) {
    await page.evaluate(async (id) => {
        const store = await import('/src/js/store/index.js');
        const features = await store.getCurrentMapFeatures();
        const feature = (features?.images || []).find((f) => f.properties?.id === id);

        const sm = store.getStateManager();
        sm.batchUpdate(() => {
            sm.clearSelection();
            sm.addToSelection('images', String(id), feature);
        });

        const clipboard = store.getControl('ClipboardManager');
        // `copy()` é assíncrona desde a carga tardia das ferramentas: sem o await, `paste()`
        // colaria o clipboard anterior.
        await clipboard.copy();
        await clipboard.paste();
    }, featureId);
}

/**
 * O estado da imagem `id` na página: o blob (que pode vir do servidor) e o registro no mapa.
 * @param {import('@playwright/test').Page} page
 * @param {string} id
 * @returns {Promise<{ temBlob: boolean, tamanho: number, blobLocal: boolean, imagemNoMapa: boolean }>}
 */
function estadoDaImagem(page, id) {
    return page.evaluate(async (fid) => {
        const store = await import('/src/js/store/index.js');
        const map = globalThis.__ebgeoMap;
        // `getImage` cai no backend quando o cache local erra, e cacheia o que voltar: é ele
        // que responde "o servidor tem estes bytes".
        const blob = await store.getImage(fid);
        return {
            temBlob: !!blob && blob.size > 0,
            tamanho: blob?.size ?? 0,
            blobLocal: await store.hasImage(fid),
            // NÃO é o discriminador: o placeholder de erro ocupa o mesmo id (ver cabeçalho).
            imagemNoMapa: !!(map && map.hasImage(fid)),
        };
    }, id);
}

collabTest.describe('Colar uma imagem num atlas de servidor leva os BYTES ao par', () => {
    collabTest('o par resolve o blob do id NOVO, em vez do placeholder de erro', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        // ----- A cria a imagem original (blob no servidor, id do servidor) -----
        const molde = realFeature('image', {
            // As propriedades que `prepareForPaste` do controle de imagem lê para recalcular a
            // caixa de seleção. Sem elas a colagem produziria NaN na caixa, o que não é o
            // assunto deste spec.
            width: 64, height: 64, size: 1, rotation: 0, opacity: 1,
            createdAtZoom: 0, calculatedSize: 1, zoomCorrectionEnabled: true, selectionBox: null,
        });
        const original = await criarImagem(A, molde);
        expect(original.id, 'o blob da imagem original não subiu ao servidor').toBeTruthy();
        expect(original.tamanho).toBeGreaterThan(0);

        await collab.expectFullSync({
            entityId: original.id, type: 'images', operationType: 'create', skipRender: true,
        });

        // ----- A copia e cola pelo ClipboardManager real -----
        await copiarEColar(A, original.id);

        let idNovo = null;
        await expect
            .poll(async () => {
                const ids = (await readFeatures(A, 'images')).map((f) => f.id);
                idNovo = ids.find((x) => x !== original.id) ?? null;
                return idNovo;
            }, { timeout: 15000, message: 'a colagem nao cunhou um id novo em "images"' })
            .toBeTruthy();

        // A feição colada percorre a cadeia inteira (skipRender: imagem desenha por camada de
        // ícone, não por fonte GeoJSON, então o último elo se apoia em remote.applied + IDB).
        await collab.expectFullSync({
            entityId: idNovo, type: 'images', operationType: 'create', skipRender: true,
        });

        // ----- A ASSERÇÃO DO DEFEITO, no par -----
        // Antes do conserto: `getImage(idNovo)` tomava 404 e devolvia null, e o mapa ficava com
        // o placeholder de erro. O par nunca teve estes bytes por outra via.
        await expect
            .poll(() => estadoDaImagem(B, idNovo), { timeout: 20000 })
            .toMatchObject({ temBlob: true, tamanho: original.tamanho });

        const noPar = await estadoDaImagem(B, idNovo);
        expect(noPar.blobLocal, 'o blob que voltou do servidor não foi cacheado no par').toBe(true);
        // ESPERA, E NÃO ASSERÇÃO SECA, e a razão foi MEDIDA, não suposta. O registro da imagem
        // no mapa do par chega por um caminho DEBOUNCED e POSTERIOR ao blob: `FEATURE_CREATED`
        // → `wireRemoteFeatureRender` (80 ms de coalescência) → `setupMapFeatures` →
        // `setImages` → busca do blob → `map.addImage`. A espera do blob acima resolve na
        // PRIMEIRA busca que responde, que é a do próprio teste, e nada garante que a passada de
        // desenho do par já tenha corrido. Medido em três rodadas em série nesta máquina, OCIOSA:
        // o valor lido no instante seguinte foi `true`, `true` e `false`, com o registro
        // chegando 4 ms, 275 ms e 635 ms depois. Numa máquina carregada perde as três (medido
        // fora daqui: 3 de 3 vermelhas, sempre nesta linha). Uma asserção seca aqui media a
        // carga da máquina, não o produto.
        //
        // E ela NÃO é o discriminador do defeito: o placeholder de erro ocupa o MESMO id, então
        // isto é verdadeiro nos dois desfechos. Vale como prova de que a passada de desenho do
        // par correu para este id; a prova do conserto é a espera do BLOB, acima.
        await expect
            .poll(() => estadoDaImagem(B, idNovo).then((e) => e.imagemNoMapa), { timeout: 20000 })
            .toBe(true);

        // ----- CONTROLE 1: a imagem ORIGINAL resolve no par -----
        // Ela subiu na criação, por `uploadImageBlob`. Sem este caso, um caminho de busca
        // quebrado por completo se leria como "o defeito continua".
        await expect
            .poll(() => estadoDaImagem(B, original.id), { timeout: 20000 })
            .toMatchObject({ temBlob: true, tamanho: original.tamanho });

        // ----- CONTROLE 2: um id inventado NÃO resolve no par -----
        // Sem este caso, um `getImage` que devolvesse qualquer coisa passaria em tudo acima.
        const inventado = await estadoDaImagem(B, '00000000-0000-4000-8000-000000000000');
        expect(inventado.temBlob, 'getImage devolveu bytes para um id que ninguém criou').toBe(false);
    });
});
