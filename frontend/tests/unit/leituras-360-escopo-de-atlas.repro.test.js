// Path: tests/unit/leituras-360-escopo-de-atlas.repro.test.js
//
// AS LEITURAS DO 360 CARREGAM O ATLAS EM FOCO -- TODAS, NAO SO O TILE.
//
// A CAUSA RAIZ, e ela e uma entrega pela METADE, nao um esquecimento inteiro. A decisao de
// 2026-08-18 ligou `?atlasId=` nas quatorze rotas de leitura do modulo 360 no servidor
// (`validate` -> `liftOptionalAtlasId` -> `requireAtlasScopeWhenPresent`, que compoe um
// `requireAtlasPermission('read')` de verdade). Do lado do cliente so o template dos tiles MVT
// recebeu o carimbo (`tiles-360-escopo-de-atlas.test.js` e quem prende aquela metade). As outras
// leituras -- `/projects`, `/photos/nearest`, `/photos/:uuid`, `/photos/by-name/:nome`,
// `/projects/:slug/floors`, `/photos/:uuid/image` -- saiam sem escopo.
//
// O SINTOMA E O PIOR ARRANJO POSSIVEL DOS DOIS: o panorama privado emprestado por um atlas
// APARECIA como ponto na camada 2D (os tiles levavam o escopo) e SUMIA em todo o resto. O clique
// no ponto chamava `/photos/nearest` sem escopo, recebia 404, `fetchNearestPhoto` devolvia null --
// que e exatamente como ele trata "nao ha foto por perto" -- e nada abria, com o console limpo. O
// mapa provava que o recurso existia e a interface o recusava.
//
// O QUE ESTE ARQUIVO MEDE, e o segundo bloco vale tanto quanto o primeiro:
//
//   1. com atlas em foco, TODA leitura dos dois clientes (o do mapa e o do estudio de
//      calibracao) leva o `atlasId` certo, com o separador certo quando ja havia query;
//   2. SEM atlas em foco a URL sai LIMPA. Procurar so a substring "atlasId" deixaria passar uma
//      implementacao que carimbasse `atlasId=undefined` ou `atlasId=` -- e nenhuma das duas e
//      ruido: `atlasScopeQuerySchema` valida o campo como GUID, entao as duas viram 422 e
//      derrubam a leitura para o visitante anonimo e para o mapa local, que sao a maioria.
//
// O ambiente e `node` puro, entao o que se mede e a CONSTRUCAO DA URL, nunca o `fetch`: as
// funcoes que devolvem endereco sao exercitadas direto, e as que buscam sao exercitadas com um
// `fetch` de mentira que so registra a URL recebida.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SERVICO = '/api/v1/sv360';
const ATLAS = '11111111-2222-4333-8444-555555555555';
const FOTO = 'aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee';

/** As URLs que o `fetch` de mentira viu, na ordem. */
let vistas = [];

/** Um `fetch` que nao vai a lugar nenhum e so anota o endereco pedido. */
function fetchEspiao(corpo = {}) {
    return vi.fn(async (url) => {
        vistas.push(String(url));
        return { ok: true, status: 200, json: async () => corpo };
    });
}

/**
 * Monta os dois clientes de 360 com o escopo de recurso apontando para `atlasId`.
 *
 * O escopo NAO e injetado por parametro: ele e declarado pelo mesmo registro que o resto do app
 * usa (`setResourceScope`, escrito por `refreshVisibleResources`). Injeta-lo criaria um segundo
 * conceito de escopo dentro do teste e o teste deixaria de medir a fiacao.
 * @param {string|null} atlasId
 * @returns {Promise<{mapa: Object, calibracao: Object}>}
 */
async function montar(atlasId) {
    vi.resetModules();
    vi.doMock('../../src/js/config.js', () => ({
        default: { streetView360: { serviceUrl: SERVICO } },
    }));
    vi.doMock('../../src/js/store/sync/api-client.js', () => ({
        apiClient: { getAccessToken: () => null, authHeader: async () => ({}) },
        ApiError: class ApiError extends Error {},
    }));

    const escopo = await import('../../src/js/store/sync/resource-scope.js');
    if (atlasId) escopo.setResourceScope(escopo.resourceScopeKey('u-1', atlasId));
    else escopo.resetResourceScope();

    return {
        mapa: await import('../../src/js/street_view_tool/streetview-api.service.js'),
        calibracao: await import('../../src/js/calibration/api.js'),
    };
}

beforeEach(() => {
    vistas = [];
    globalThis.window = { location: { origin: 'https://mapa.example.mil.br' } };
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

// ============================================================
// 1 -- com atlas em foco, toda leitura o nomeia
// ============================================================

describe('com um atlas em foco, as leituras do 360 do MAPA carimbam ?atlasId=', () => {
    it('as que so montam endereco', async () => {
        const { mapa } = await montar(ATLAS);
        expect(mapa.sv360AtlasScope()).toBe(ATLAS);
        expect(mapa.sv360ReadUrl('/projects')).toBe(`${SERVICO}/projects?atlasId=${ATLAS}`);
        // Query ja existente: `&`, nunca um segundo `?`.
        expect(mapa.getPhotoImageUrl(FOTO, 'preview'))
            .toBe(`${SERVICO}/photos/${FOTO}/image?quality=preview&atlasId=${ATLAS}`);
    });

    it('as que buscam: projetos, foto por uuid, foto por nome, vizinha, andares', async () => {
        const { mapa } = await montar(ATLAS);
        vi.stubGlobal('fetch', fetchEspiao({ photo: { id: FOTO }, floors: [], camera: {} }));

        await mapa.fetchProjects(true);
        await mapa.fetchPhotoMetadata(FOTO);
        await mapa.fetchPhotoMetadata('MULTICAPTURA_0466_001369');
        await mapa.fetchNearestPhoto(-43.2, -22.9);
        await mapa.fetchProjectFloors('quartel-general');
        await mapa.validatePhoto(FOTO);

        expect(vistas).toEqual([
            `${SERVICO}/projects?atlasId=${ATLAS}`,
            `${SERVICO}/photos/${FOTO}?atlasId=${ATLAS}`,
            `${SERVICO}/photos/by-name/MULTICAPTURA_0466_001369?atlasId=${ATLAS}`,
            `${SERVICO}/photos/nearest?lon=-43.2&lat=-22.9&atlasId=${ATLAS}`,
            `${SERVICO}/projects/quartel-general/floors?atlasId=${ATLAS}`,
            `${SERVICO}/photos/${FOTO}?atlasId=${ATLAS}`,
        ]);
    });

    it('O CLIQUE QUE MORRIA: /photos/nearest e a leitura que o ponto do mapa 2D dispara', async () => {
        // O repro fiel do defeito. O ponto ja estava desenhado (o tile levava o escopo); sem ele
        // aqui a rota respondia 404 e `fetchNearestPhoto` devolvia null -- indistinguivel de
        // "nao ha foto por perto". Este caso prende que a pergunta chega ESCOPADA, e a
        // discriminacao esta no bloco 2: sem atlas, a mesma URL sai sem parametro nenhum.
        const { mapa } = await montar(ATLAS);
        vi.stubGlobal('fetch', fetchEspiao({ photo: { id: FOTO } }));

        const foto = await mapa.fetchNearestPhoto(-43.2, -22.9);
        expect(foto).toEqual({ id: FOTO });
        expect(vistas).toEqual([`${SERVICO}/photos/nearest?lon=-43.2&lat=-22.9&atlasId=${ATLAS}`]);
    });
});

describe('com um atlas em foco, as leituras do ESTUDIO de calibracao carimbam ?atlasId=', () => {
    // O estudio boota sem o motor de sync, entao HOJE o escopo dele e sempre nulo. O que estes
    // casos medem e que ele nao carrega uma SEGUNDA nocao de escopo: declarado o mesmo registro,
    // as leituras dele o nomeiam pela mesma funcao do cliente do mapa.
    it('as sete leituras e a URL de imagem', async () => {
        const { calibracao } = await montar(ATLAS);
        vi.stubGlobal('fetch', fetchEspiao({ floors: [], runs: [], stats: {}, photos: [] }));

        await calibracao.fetchProjects();
        await calibracao.fetchPhotoMetadata(FOTO);
        await calibracao.fetchProjectPhotos('qg');
        await calibracao.fetchAllReviewStats();
        await calibracao.fetchProjectRuns('qg');
        await calibracao.fetchProjectFloors('qg');
        await calibracao.fetchProjectMap('qg');
        await calibracao.fetchNearbyPhotos(FOTO, 100, { floor: 'all' });

        expect(vistas).toEqual([
            `${SERVICO}/projects?atlasId=${ATLAS}`,
            `${SERVICO}/photos/${FOTO}?include_hidden=true&atlasId=${ATLAS}`,
            `${SERVICO}/projects/qg/photos?atlasId=${ATLAS}`,
            `${SERVICO}/projects/review-stats?atlasId=${ATLAS}`,
            `${SERVICO}/projects/qg/runs?atlasId=${ATLAS}`,
            `${SERVICO}/projects/qg/floors?atlasId=${ATLAS}`,
            `${SERVICO}/projects/qg/map?atlasId=${ATLAS}`,
            `${SERVICO}/photos/${FOTO}/nearby?radius=100&floor=all&atlasId=${ATLAS}`,
        ]);

        expect(calibracao.getPhotoImageUrl(FOTO))
            .toBe(`${SERVICO}/photos/${FOTO}/image?quality=full&atlasId=${ATLAS}`);
    });
});

// ============================================================
// 2 -- A DISCRIMINACAO: sem atlas em foco a URL sai LIMPA
// ============================================================

describe('O CONTROLE NEGATIVO: sem atlas em foco nenhuma leitura ganha parametro', () => {
    /**
     * Nem `atlasId`, nem a string `undefined`, nem um `?` a mais.
     *
     * Esta e a asercao que separa a correcao certa de uma que so "contem atlasId": a query e
     * validada como GUID no servidor, entao `atlasId=` e `atlasId=undefined` sao 422, e o
     * caminho que eles derrubam e o do visitante anonimo e o do mapa local.
     * @param {string[]} urls
     */
    function limpas(urls) {
        for (const url of urls) {
            expect(url, `${url} nao pode carregar escopo nenhum`).not.toContain('atlasId');
            expect(url).not.toContain('undefined');
        }
    }

    it('o cliente do MAPA sai como sai hoje, caractere por caractere', async () => {
        const { mapa } = await montar(null);
        expect(mapa.sv360AtlasScope()).toBe(null);
        expect(mapa.sv360ReadUrl('/projects')).toBe(`${SERVICO}/projects`);
        expect(mapa.sv360ReadUrl('/projects')).not.toContain('?');
        expect(mapa.getPhotoImageUrl(FOTO)).toBe(`${SERVICO}/photos/${FOTO}/image?quality=full`);

        vi.stubGlobal('fetch', fetchEspiao({ photo: null, floors: [] }));
        await mapa.fetchProjects(true);
        await mapa.fetchPhotoMetadata(FOTO);
        await mapa.fetchNearestPhoto(-43.2, -22.9);
        await mapa.fetchProjectFloors('qg');

        expect(vistas).toEqual([
            `${SERVICO}/projects`,
            `${SERVICO}/photos/${FOTO}`,
            `${SERVICO}/photos/nearest?lon=-43.2&lat=-22.9`,
            `${SERVICO}/projects/qg/floors`,
        ]);
        limpas(vistas);
    });

    it('o ESTUDIO sai como sai hoje, que e o unico estado que ele conhece', async () => {
        const { calibracao } = await montar(null);
        vi.stubGlobal('fetch', fetchEspiao({ floors: [], stats: {} }));

        await calibracao.fetchProjects();
        await calibracao.fetchPhotoMetadata(FOTO);
        await calibracao.fetchProjectFloors('qg');

        expect(vistas).toEqual([
            `${SERVICO}/projects`,
            `${SERVICO}/photos/${FOTO}?include_hidden=true`,
            `${SERVICO}/projects/qg/floors`,
        ]);
        limpas(vistas);
        limpas([calibracao.getPhotoImageUrl(FOTO)]);
    });
});

// ============================================================
// A FIACAO: uma fonte de verdade so, e ela e a que ja existia
// ============================================================

describe('o atlas das leituras e o MESMO que decide o payload de recursos privados', () => {
    it('trocar de atlas troca a URL; sair do atlas a devolve limpa', async () => {
        const { mapa, calibracao } = await montar(null);
        const escopo = await import('../../src/js/store/sync/resource-scope.js');
        const OUTRO = '99999999-8888-4777-8666-555555555555';

        expect(mapa.sv360ReadUrl('/projects')).toBe(`${SERVICO}/projects`);

        escopo.setResourceScope(escopo.resourceScopeKey('u-1', ATLAS));
        expect(mapa.sv360ReadUrl('/projects')).toBe(`${SERVICO}/projects?atlasId=${ATLAS}`);
        expect(calibracao.getPhotoImageUrl(FOTO)).toContain(`atlasId=${ATLAS}`);

        escopo.setResourceScope(escopo.resourceScopeKey('u-1', OUTRO));
        expect(mapa.sv360ReadUrl('/projects')).toBe(`${SERVICO}/projects?atlasId=${OUTRO}`);

        escopo.resetResourceScope();
        expect(mapa.sv360ReadUrl('/projects')).toBe(`${SERVICO}/projects`);
        expect(calibracao.getPhotoImageUrl(FOTO)).not.toContain('atlasId');
    });

    it('a resposta em cache e rotulada com o MESMO atlas que a URL nomeou', async () => {
        // A armadilha que este caso fecha: `fetchProjects` le o escopo para decidir o carimbo do
        // cache E para montar a URL. Se fossem duas leituras, a lista buscada sob um atlas
        // poderia ser rotulada com o seguinte, e o proximo leitor confiaria no rotulo.
        const { mapa } = await montar(ATLAS);
        vi.stubGlobal('fetch', fetchEspiao([{ id: 'p1' }]));

        expect(await mapa.fetchProjects(true)).toEqual([{ id: 'p1' }]);
        expect(vistas).toEqual([`${SERVICO}/projects?atlasId=${ATLAS}`]);
        // Mesmo escopo: acerto de cache, sem segunda ida a rede.
        expect(mapa.getCachedProjects()).toEqual([{ id: 'p1' }]);
        expect(vistas).toHaveLength(1);

        // Escopo trocado: o cache vira MISS, e a rebusca nomeia o atlas novo.
        const escopo = await import('../../src/js/store/sync/resource-scope.js');
        escopo.resetResourceScope();
        expect(mapa.getCachedProjects()).toBe(null);
        await mapa.fetchProjects();
        expect(vistas[1]).toBe(`${SERVICO}/projects`);
    });
});
