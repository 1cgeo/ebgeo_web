import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * O CACHE DO CLIENTE NÃO ATRAVESSA ESCOPO (F9, item 7).
 *
 * `GET /sv360/projects` é decidido POR CHAMADOR: papel global, concessão pessoal e — com um atlas
 * em foco — o que aquele atlas EMPRESTA. O braço de empréstimo só devolve o projeto enquanto
 * aquele atlas é o que está sendo perguntado, e é essa condição que o cache de módulo do cliente
 * apagava: aquecido dentro do atlas que empresta, `getCachedProjects()` continuava servindo o
 * projeto emprestado à busca, ao briefing, ao catálogo e à camada de marcadores 2D depois que o
 * usuário saiu dele. O servidor recusaria; ninguém perguntava de novo.
 *
 * O que se mede aqui é o CARIMBO comparado na leitura, e não uma limpeza chamada no disconnect:
 * a limpeza só alcança o cache que alguém lembrou de registrar, e este módulo é um chunk lazy que
 * o motor de sync não tem por que importar. Carimbo divergente é MISS.
 *
 * CONTROLE NEGATIVO, MEDIDO (contagem, não binário): tirar a guarda de `getCachedProjects` deixa
 * 4 casos vermelhos (troca de atlas, sair do atlas, logout, resposta em voo) e 3 verdes; tirá-la
 * de `fetchProjects` deixa exatamente 1 (o do chamador direto, que é a camada de marcadores 2D).
 * Os dois sítios são cobrados por casos DISJUNTOS, que é o que prova que o teste não está medindo
 * o mesmo caminho duas vezes.
 */

const h = vi.hoisted(() => ({
    respostas: [],
    chamadas: 0,
}));

vi.mock('../../src/js/config.js', () => ({
    default: { streetView360: { serviceUrl: 'http://backend.test/api/v1/sv360' } },
}));

vi.mock('../../src/js/store/sync/api-client.js', () => ({
    apiClient: {
        getVisibleResources: vi.fn(async () => ({
            basemaps: [], tilesets: [], dataLayers: [], analysisLayers: [], views360: [],
        })),
    },
}));

vi.mock('../../src/js/store/sync/atlas-settings.service.js', () => ({
    mergeGrantedIntoBaseline: vi.fn(),
    revertGrantedResources: vi.fn(),
}));

vi.mock('../../src/js/store/sync/session-context.js', () => ({
    sessionContext: { userId: 'u-1', hasGlobalDataAccess: () => false },
}));

const { fetchProjects, getCachedProjects, getPhotoDisplayName } = await import('../../src/js/street_view_tool/streetview-api.service.js');
const { refreshVisibleResources, clearVisibleResources } = await import('../../src/js/store/sync/resource-access.service.js');
const { resourceScopeKey } = await import('../../src/js/store/sync/resource-scope.js');

/** Um `fetch` que devolve a próxima lista da fila e conta as chamadas. */
function stubFetch() {
    h.chamadas = 0;
    globalThis.fetch = vi.fn(async () => {
        const corpo = h.respostas[Math.min(h.chamadas, h.respostas.length - 1)];
        h.chamadas += 1;
        return { ok: true, json: async () => corpo };
    });
}

const PUBLICO = [{ id: 'pub', name: 'Público' }];
const COM_EMPRESTADO = [{ id: 'pub', name: 'Público' }, { id: 'priv', name: 'Emprestado pelo atlas' }];

describe('cache de projetos 360 por escopo de acesso', () => {
    beforeEach(async () => {
        clearVisibleResources();
        h.respostas = [COM_EMPRESTADO, PUBLICO];
        stubFetch();
        // Zera o cache do módulo pelo caminho público: uma leitura no escopo anônimo,
        // que é o que `clearVisibleResources` acabou de declarar.
        getCachedProjects();
    });

    it('dentro do MESMO escopo, a lista é servida do cache (uma requisição só)', async () => {
        await refreshVisibleResources('atlas-A');
        const primeira = await fetchProjects();
        const segunda = await fetchProjects();

        expect(primeira).toEqual(COM_EMPRESTADO);
        expect(segunda).toBe(primeira);
        expect(h.chamadas).toBe(1);
        expect(getCachedProjects()).toBe(primeira);
    });

    it('trocar de atlas invalida a lista aquecida no atlas anterior', async () => {
        await refreshVisibleResources('atlas-A');
        expect(await fetchProjects()).toEqual(COM_EMPRESTADO);

        await refreshVisibleResources('atlas-B');

        // O emprestado NÃO pode aparecer no atlas que não o empresta, e a leitura
        // síncrona é justamente a que a busca e o briefing usam.
        expect(getCachedProjects()).toBeNull();
        expect(await fetchProjects()).toEqual(PUBLICO);
        expect(h.chamadas).toBe(2);
    });

    it('quem chama `fetchProjects` DIRETO também não herda a lista do escopo anterior', async () => {
        // A camada de marcadores 2D (`streetview_markers.js::loadMarkers`) não passa por
        // `getCachedProjects`: ela chama `fetchProjects` e recebe o cache de dentro dele.
        // Sem a guarda LÁ, este caminho continuaria desenhando o emprestado no atlas errado.
        await refreshVisibleResources('atlas-A');
        expect(await fetchProjects()).toEqual(COM_EMPRESTADO);

        await refreshVisibleResources('atlas-B');

        expect(await fetchProjects()).toEqual(PUBLICO);
        expect(h.chamadas).toBe(2);
    });

    it('sair do atlas (sem trocar de conta) já muda o escopo', async () => {
        await refreshVisibleResources('atlas-A');
        await fetchProjects();

        await refreshVisibleResources(null);

        expect(getCachedProjects()).toBeNull();
    });

    it('o logout invalida a lista, mesmo sem atlas nenhum em foco', async () => {
        await refreshVisibleResources(null);
        await fetchProjects();
        expect(getCachedProjects()).not.toBeNull();

        clearVisibleResources();

        expect(getCachedProjects()).toBeNull();
    });

    it('a resposta que chega DEPOIS da troca de escopo não é adotada pelo escopo novo', async () => {
        // A corrida é determinística de propósito: a troca de escopo acontece entre o
        // disparo e a resolução da requisição, que é a interleaving perdedora. Medir
        // isso por tempo não convergiria.
        let resolver;
        globalThis.fetch = vi.fn(() => new Promise((resolve) => {
            resolver = () => resolve({ ok: true, json: async () => COM_EMPRESTADO });
        }));

        await refreshVisibleResources('atlas-A');
        const emVoo = fetchProjects();
        await refreshVisibleResources('atlas-B');
        resolver();
        await emVoo;

        expect(getCachedProjects()).toBeNull();
    });

    it('o nome de exibição da foto também não atravessa escopo', async () => {
        // Mesma classe, alvo menor: o nome vem do metadado de uma foto que pode ser de
        // projeto privado. Um cache que sobrevive à troca conta o que havia lá.
        const uuid = '0f9a1c2e-7b3d-5c8e-9a1b-2c3d4e5f6a7b';
        const nomes = ['Ponto emprestado', 'Ponto público'];
        let n = 0;
        globalThis.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ camera: { display_name: nomes[Math.min(n++, 1)] } }),
        }));

        await refreshVisibleResources('atlas-A');
        expect(await getPhotoDisplayName(uuid)).toBe('Ponto emprestado');
        expect(await getPhotoDisplayName(uuid)).toBe('Ponto emprestado');

        await refreshVisibleResources('atlas-B');

        expect(await getPhotoDisplayName(uuid)).toBe('Ponto público');
    });

    it('a chave de escopo separa usuário E atlas, porque os dois decidem a resposta', () => {
        expect(resourceScopeKey('u-1', 'atlas-A')).not.toBe(resourceScopeKey('u-1', 'atlas-B'));
        expect(resourceScopeKey('u-1', null)).not.toBe(resourceScopeKey('u-2', null));
        expect(resourceScopeKey('u-1', 'atlas-A')).toBe(resourceScopeKey('u-1', 'atlas-A'));
        // Deslogado é UM escopo, não a ausência de escopo.
        expect(resourceScopeKey(null, null)).toBe(resourceScopeKey(undefined, undefined));
    });
});
