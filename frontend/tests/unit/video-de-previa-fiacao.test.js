// Path: tests/unit/video-de-previa-fiacao.test.js

/**
 * @fileoverview A FIAÇÃO DO VÍDEO DE PRÉVIA, DA ESCRITA À LEITURA — e o que ela DELIBERADAMENTE
 * não alcança.
 *
 * O eixo tem duas metades e elas entraram no mesmo commit porque uma sem a outra é uma
 * feature fantasma: se o formulário do painel monta o campo e o cartão do catálogo não o lê,
 * o administrador preenche uma URL que nada mostra; se o cartão lê e ninguém escreve, o botão
 * nunca aparece. Este arquivo mede as duas pontas do lado do cliente, em node puro.
 *
 * O QUE ELE NÃO MEDE, dito para não ser lido como mais do que é: a TELA. O ambiente de teste
 * do frontend não tem DOM, então o botão "Prévia" e o modal de vídeo se verificam por captura
 * do Playwright, e a instrução está no relatório desta onda. O que se prende aqui é a fiação:
 * o dado chega ao item, o método do cliente monta a requisição certa, e o recorte de
 * categorias é o que foi decidido.
 *
 * E DOIS DOS CASOS ABAIXO LEEM TEXTO DE ARQUIVO, o que é mais fraco do que parece e está
 * dito aqui porque a fraqueza foi MEDIDA: com `footer.appendChild(previaBtn)` removido do
 * cartão (o botão nasce e é jogado fora, a feature some da tela por inteiro), os casos de
 * leitura de fonte seguem verdes. Leitura de fonte prova que a decisão está escrita, nunca
 * que ela roda. Por isso o último bloco IMPORTA os módulos de verdade: importar é o que
 * prova que o grafo resolve e que os aliases existem, e `enderecoDaPrevia` é a única parte
 * do modal que se exerce sem DOM.
 *
 * CONTROLES NEGATIVOS EXECUTADOS (os oito casos, um vermelho cada, e vermelhos DIFERENTES):
 * `enderecoDaPrevia` devolvendo a URL crua derruba só o caso do carimbo de escopo; o cartão
 * da cena indoor voltando a `scene.previewVideo || null` derruba só o caso da cena. Os dois
 * são os defeitos que a revisão adversarial achou, e nenhum dos cinco casos anteriores os
 * pegava.
 *
 * O RECORTE É A PARTE MAIS FÁCIL DE PERDER. Quatro tipos ganham o campo (3D, camada de dados,
 * camada de análise e 360) e o BASEMAP fica de fora por decisão de produto — ele é o único que
 * não tem cartão de catálogo, então não há superfície de leitura. Reabri-lo tem de ser um ato,
 * e é por isso que a ausência é asserida em vez de ficar só em prosa.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiClient } from '../../src/js/store/sync/api-client.js';
import { abrirPreviaDeVideo, enderecoDaPrevia } from '@catalog/components/preview-video.modal.js';
import { resourceScopeKey, setResourceScope, resetResourceScope } from '@store/sync/resource-scope.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lerFonte = (rel) => readFileSync(resolve(RAIZ, rel), 'utf8');

describe('apiClient.updateSv360ProjectMetadata — a porta de escrita do 360', () => {
    let api;
    let chamadas;

    beforeEach(() => {
        api = new ApiClient({ baseUrl: 'http://x/api/v1' });
        chamadas = [];
        api._request = async (method, path, opts) => {
            chamadas.push({ method, path, body: opts?.body });
            return {};
        };
    });

    it('grava a URL na rota de METADADO, com a OM que desambigua o slug', async () => {
        // PISO — a requisição acontece e é um PATCH na rota nova, não na de status. Sem esta
        // metade, as asserções de forma abaixo passariam num método que não chama nada.
        await api.updateSv360ProjectMetadata('projeto-a', { previewVideo: '/3d/v/a.webm' }, {
            orgId: '00000000-0000-0000-0000-000000000001',
        });
        expect(chamadas).toHaveLength(1);
        expect(chamadas[0].method).toBe('PATCH');
        expect(chamadas[0].path).toBe(
            '/sv360/admin/projects/projeto-a?orgId=00000000-0000-0000-0000-000000000001',
        );
        expect(chamadas[0].body).toEqual({ previewVideo: '/3d/v/a.webm' });

        // DISCRIMINAÇÃO — sem `orgId` a URL não ganha query nenhuma. Um `?orgId=undefined`
        // é o defeito que o método irmão (`setSv360ProjectStatus`) já pagou uma vez.
        await api.updateSv360ProjectMetadata('projeto-a', { previewVideo: '/x.webm' });
        expect(chamadas[1].path).toBe('/sv360/admin/projects/projeto-a');
    });

    it('a STRING VAZIA chega ao servidor: remover o vídeo não pode virar um PATCH sem corpo', async () => {
        // Este é o caso que o padrão vizinho erraria. `listAudit`, no mesmo arquivo, JOGA
        // FORA toda chave de valor vazio (para não montar filtro vazio numa query string), e
        // aplicar a mesma regra aqui transformaria "apagar o vídeo" num corpo `{}` — que o
        // Joi da rota recusa com 422, porque o schema é `.min(1)`.
        await api.updateSv360ProjectMetadata('projeto-a', { previewVideo: '' });
        expect(chamadas[0].body).toEqual({ previewVideo: '' });

        // E o payload ausente por inteiro também degrada para "remover", nunca para corpo
        // vazio: quem chama sem payload está limpando o campo.
        await api.updateSv360ProjectMetadata('projeto-a', null);
        expect(chamadas[1].body).toEqual({ previewVideo: '' });
    });
});

describe('o recorte de categorias do vídeo de prévia', () => {
    it('o FORMULÁRIO do painel monta o campo para três categorias, e não para o basemap', () => {
        const fonte = lerFonte('src/js/admin/catalog-tab.js');
        const bloco = /const CATEGORIAS_COM_VIDEO = Object\.freeze\(\[([^\]]*)\]\)/.exec(fonte);
        expect(bloco, 'a constante do recorte precisa existir com este nome').toBeTruthy();
        const categorias = [...bloco[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);

        // PISO — as três que TÊM formulário e ganham o campo.
        expect(categorias.sort()).toEqual(['analysis_layer', 'data_layer', 'tileset']);
        // DISCRIMINAÇÃO — a ausência do basemap é o ponto do caso, e ela é o que reabrir a
        // categoria tem de derrubar de propósito.
        expect(categorias).not.toContain('basemap');
        // E `sv360` também não está na lista, por outro motivo: aquela categoria não tem
        // formulário nenhum, e o vídeo dela é ação de linha da tabela (`_edit360Video`).
        expect(categorias).not.toContain('sv360');
        expect(fonte).toContain('_edit360Video');
        expect(fonte).toContain('updateSv360ProjectMetadata');
    });

    it('o CARTÃO decide pelo dado, e o basemap nunca chega lá', () => {
        const cartao = lerFonte('src/js/catalog/components/catalog-card.js');
        // PISO — o botão existe e é gateado pelo campo do item, não pelo tipo. Um gate por
        // tipo teria de ser editado a cada tipo novo; este não.
        expect(cartao).toMatch(/if \(item\.previewVideo\)/);
        expect(cartao).toContain('preview-video.modal.js');
        // DISCRIMINAÇÃO — nenhum ramo por tipo de item no gate do vídeo. Se alguém trocar
        // por uma lista fechada de tipos, esta asserção não cai sozinha, então o par acima é
        // o que segura: o gate é uma leitura de propriedade e nada mais.
        expect(cartao).not.toMatch(/previewVideo[\s\S]{0,120}CATALOG_ITEM_TYPES/);
    });

    it('`catalog.service.js` carrega `previewVideo` nas QUATRO famílias que têm cartão', () => {
        const fonte = lerFonte('src/js/catalog/catalog.service.js');
        const ocorrencias = [...fonte.matchAll(/^\s*previewVideo: /gm)];
        // Cinco atribuições para quatro famílias: `_getTilesets3D` e `_getFirstPersonScenes`
        // são as duas metades do 3D (Cesium e primeira pessoa), e as duas viram cartão.
        expect(ocorrencias.length).toBe(5);
        // DISCRIMINAÇÃO — o basemap não passa por `catalog.service.js` (ele vive no seletor
        // de camada base), então não há uma sexta a esperar. A asserção que segura isso é a
        // contagem exata acima; esta linha registra o porquê para quem a vir cair.
        expect(fonte).not.toContain('_getBasemaps');
    });
});

describe('o modal de prévia — o que se mede sem DOM', () => {
    const ATLAS = '11111111-2222-3333-4444-555555555555';

    beforeEach(() => {
        resetResourceScope();
    });

    it('SEM URL não abre nada, e a guarda roda ANTES de tocar o documento', () => {
        // Este caso vale por duas coisas, e a segunda é a que os casos de leitura de fonte
        // não dão: ele IMPORTA o módulo. Se o arquivo sumir, se um alias parar de resolver
        // ou se o grafo de import quebrar, a suíte fica vermelha aqui — antes, nada em
        // `npm test` provava sequer que `preview-video.modal.js` carrega.
        expect(abrirPreviaDeVideo({ url: '', titulo: 'Modelo' })).toBe(false);
        expect(abrirPreviaDeVideo({ url: null, titulo: 'Modelo' })).toBe(false);
        expect(abrirPreviaDeVideo({})).toBe(false);
        // O `return false` vem antes do `new`, então nada de `document` é tocado — é o que
        // permite este caso existir num ambiente sem DOM.
    });

    it('o endereço do `<video>` carrega o escopo do atlas: é a ÚNICA autorização que passa', () => {
        // PISO — com atlas em foco, o carimbo entra. Um `<video src>` é buscado pelo
        // NAVEGADOR e não carrega `Authorization`, então sem `?atlasId=` a prévia de um
        // recurso PRIVADO emprestado leva 404 e o operador lê a frase de erro como "a URL
        // está errada".
        setResourceScope(resourceScopeKey('usuario-1', ATLAS));
        expect(enderecoDaPrevia('/api/v1/assets3d/3d/PCL/previa.webm'))
            .toBe(`/api/v1/assets3d/3d/PCL/previa.webm?atlasId=${ATLAS}`);

        // DISCRIMINAÇÃO 1 — endereço de OUTRA ORIGEM sai intacto. O empréstimo é uma
        // afirmação sobre ESTE servidor, e carimbá-lo num host de terceiro só contaria a
        // ele em que atlas o usuário está. É o caso do 360, cuja coluna guarda URL livre.
        expect(enderecoDaPrevia('https://midia.om.example.mil.br/previa.webm'))
            .toBe('https://midia.om.example.mil.br/previa.webm');

        // DISCRIMINAÇÃO 2 — SEM atlas em foco a URL sai idêntica: o recurso público não
        // regride, e é ele a maioria do catálogo.
        resetResourceScope();
        expect(enderecoDaPrevia('/api/v1/assets3d/3d/PCL/previa.webm'))
            .toBe('/api/v1/assets3d/3d/PCL/previa.webm');
    });

    it('a CENA INDOOR resolve o caminho relativo, em vez de mandar o override cru para a tela', () => {
        // A chave `previewVideo` de uma cena de primeira pessoa é, por contrato do
        // `SCENE_LAYOUT`, um override RELATIVO ao `basePath` — o popup do marcador 3D
        // sempre a resolveu por `resolveSceneAssets`, e o cartão do catálogo a usava CRUA.
        // Mesma chave, duas resoluções no mesmo produto: uma cena com
        // `previewVideo: 'clipes/tour.webm'` tocava no marcador e quebrava no cartão.
        const fonte = lerFonte('src/js/catalog/catalog.service.js');
        expect(fonte).toContain('resolveSceneAssets(scene).previewVideo');
        // DISCRIMINAÇÃO — o GATE continua sendo a chave EXPLÍCITA, não o valor derivado:
        // o derivado é um caminho PADRÃO que quase nenhuma cena tem em disco, e gatear por
        // ele daria botão "Prévia" em toda cena indoor.
        expect(fonte).toMatch(/scene\.previewVideo \? resolveSceneAssets\(scene\)\.previewVideo : null/);
    });
});
